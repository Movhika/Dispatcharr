"""Ordered import policy, account isolation and complete draft previews."""

import os
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.channels.models import ChannelGroup, ChannelGroupM3UAccount, Stream
from apps.m3u.filter_catalog import (
    discard_live_filter_catalog,
    has_live_filter_catalog,
    iter_live_filter_catalog,
    publish_live_filter_catalog,
    write_live_filter_catalog,
)
from apps.m3u.group_rules import compile_group_rules, evaluate_group_rules
from apps.m3u.models import M3UAccount, M3UFilter, M3UGroupRule
from apps.m3u.tasks import process_groups
from apps.vod.models import (
    Movie,
    M3UMovieRelation,
    M3UVODCategoryRelation,
    VODCategory,
)


def draft(rule_id="new", **values):
    return {
        "preview_id": str(rule_id),
        "scope": "live",
        "match_field": "group_name",
        "match_mode": "any",
        "regex_pattern": ".*",
        "action": "enable",
        "case_sensitive": False,
        "enabled": True,
        "order": 0,
        **values,
    }


class RuleEvaluationTests(SimpleTestCase):
    def evaluate(self, *rules, **values):
        objects = [
            M3UGroupRule(id=index + 1, **rule) for index, rule in enumerate(rules)
        ]
        return evaluate_group_rules(compile_group_rules(objects), **values)

    def test_first_matching_rule_wins(self):
        result = self.evaluate(
            {"regex_pattern": "news", "action": "ignore"},
            {"regex_pattern": ".*", "action": "enable"},
            group_name="NEWS",
        )
        self.assertTrue(result.ignored)
        self.assertEqual(result.matched_rule_id, 1)

    def test_inactive_rule_and_case_sensitive_rule_do_not_match(self):
        result = self.evaluate(
            {"regex_pattern": ".*", "enabled": False},
            {"regex_pattern": "news", "case_sensitive": True},
            group_name="NEWS",
            default_enabled=True,
        )
        self.assertTrue(result.enabled)
        self.assertIsNone(result.matched_rule_id)

    def test_any_and_all_contained_items(self):
        for mode, expected in (("any", True), ("all", False)):
            with self.subTest(mode=mode):
                result = self.evaluate(
                    {
                        "regex_pattern": "news",
                        "match_field": "item_name",
                        "match_mode": mode,
                        "action": "enable",
                    },
                    group_name="Group",
                    item_names=["News", "Sport"],
                )
                self.assertEqual(result.enabled, expected)

    def test_empty_group_does_not_match_all_items(self):
        result = self.evaluate(
            {
                "regex_pattern": ".*",
                "match_field": "item_name",
                "match_mode": "all",
                "action": "enable",
            },
            group_name="Empty",
            item_names=[],
        )
        self.assertFalse(result.enabled)


class FilterCatalogTests(SimpleTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.settings_override = self.settings(
            M3U_FILTER_CATALOG_ROOT=self.directory.name
        )
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)

    def stream(self, name):
        return {
            "name": name,
            "url": "http://private.invalid/secret",
            "attributes": {"group-title": "News"},
        }

    def test_persists_full_prefilter_inventory_with_private_permissions(self):
        self.assertTrue(
            write_live_filter_catalog(1, [self.stream("###"), self.stream("News")])
        )
        self.assertEqual(
            [row["name"] for row in iter_live_filter_catalog(1)], ["###", "News"]
        )
        path = os.path.join(self.directory.name, "1.live-filter-preview.jsonl.gz")
        self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)

    def test_failed_write_keeps_previous_completed_catalog(self):
        write_live_filter_catalog(1, [self.stream("old")])

        def broken():
            yield self.stream("partial")
            raise RuntimeError("upstream failed")

        self.assertFalse(write_live_filter_catalog(1, broken()))
        self.assertEqual(next(iter_live_filter_catalog(1))["name"], "old")
        self.assertEqual(len(os.listdir(self.directory.name)), 1)

    def test_staged_inventory_is_not_visible_until_completed(self):
        staged = write_live_filter_catalog(1, [self.stream("new")], publish=False)
        self.assertFalse(has_live_filter_catalog(1))
        publish_live_filter_catalog(1, staged)
        self.assertTrue(has_live_filter_catalog(1))
        discarded = write_live_filter_catalog(
            1, [self.stream("partial")], publish=False
        )
        discard_live_filter_catalog(discarded)
        self.assertEqual(next(iter_live_filter_catalog(1))["name"], "new")


class ImportRuleApiTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.override = self.settings(M3U_FILTER_CATALOG_ROOT=self.directory.name)
        self.override.enable()
        self.addCleanup(self.override.disable)
        self.account = M3UAccount.objects.create(name="rules", account_type="XC")
        self.other = M3UAccount.objects.create(name="other", account_type="XC")
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(
            username="rule-admin", user_level=10
        )
        self.client.force_authenticate(self.admin)
        self.url = f"/api/m3u/accounts/{self.account.id}/group-rules/"

    def group(self, name, enabled=False, account=None):
        group = ChannelGroup.objects.create(name=name)
        return ChannelGroupM3UAccount.objects.create(
            m3u_account=account or self.account,
            channel_group=group,
            enabled=enabled,
        )

    def post_preview(self, rules, target="new", query=""):
        return self.client.post(
            self.url + "preview-draft/" + query,
            {"rules": rules, "target_id": str(target)},
            format="json",
        )

    def test_preview_is_read_only_and_evaluates_complete_ordered_draft(self):
        relation = self.group("News")
        response = self.post_preview(
            [
                draft("earlier", action="disable", regex_pattern="News"),
                draft("new", order=1),
            ]
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)
        self.assertFalse(M3UGroupRule.objects.exists())
        relation.refresh_from_db()
        self.assertFalse(relation.enabled)

    def test_preview_paginates_all_matches_without_200_row_cap(self):
        groups = ChannelGroup.objects.bulk_create(
            [ChannelGroup(name=f"Group {i}") for i in range(230)]
        )
        ChannelGroupM3UAccount.objects.bulk_create(
            [
                ChannelGroupM3UAccount(m3u_account=self.account, channel_group=group)
                for group in groups
            ]
        )
        self.group("Other account", account=self.other)
        response = self.post_preview([draft()], query="?page=5&page_size=50")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 230)
        self.assertEqual(len(response.data["results"]), 30)

    def test_save_does_not_change_existing_selections(self):
        relation = self.group("News")
        values = draft()
        values.pop("preview_id")
        response = self.client.post(self.url, values, format="json")
        self.assertEqual(response.status_code, 201)
        relation.refresh_from_db()
        self.assertFalse(relation.enabled)

    def test_save_apply_updates_target_only_and_keeps_other_properties(self):
        relation = self.group("News")
        relation.custom_properties = {"channel_numbering_mode": "provider"}
        relation.save()
        untouched = self.group("Sport")
        foreign = self.group("News other", account=self.other)
        response = self.client.post(
            self.url + "save-apply/",
            {
                "rules": [draft(regex_pattern="^News$")],
                "target_id": "new",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["target_ids"], [relation.channel_group_id])
        relation.refresh_from_db()
        untouched.refresh_from_db()
        foreign.refresh_from_db()
        self.assertTrue(relation.enabled)
        self.assertEqual(
            relation.custom_properties["channel_numbering_mode"], "provider"
        )
        self.assertFalse(untouched.enabled)
        self.assertFalse(foreign.enabled)

    def test_stale_or_foreign_draft_cannot_overwrite_saved_rules(self):
        rule = M3UGroupRule.objects.create(
            m3u_account=self.other, scope="live", regex_pattern="News"
        )
        response = self.client.post(
            self.url + "save-apply/",
            {
                "rules": [draft(rule.id)],
                "target_id": str(rule.id),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        rule.refresh_from_db()
        self.assertEqual(rule.m3u_account_id, self.other.id)
        self.assertFalse(self.account.group_rules.exists())

    def test_ignore_cannot_delete_or_apply_to_existing_entries(self):
        relation = self.group("News", enabled=True)
        response = self.client.post(
            self.url + "save-apply/",
            {
                "rules": [draft(action="ignore")],
                "target_id": "new",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertTrue(
            ChannelGroupM3UAccount.objects.filter(pk=relation.pk, enabled=True).exists()
        )

    def test_invalid_regex_scope_target_and_pagination_are_rejected(self):
        for rows, target, query in (
            ([draft(regex_pattern="[")], "new", ""),
            ([draft(), draft("series", scope="series")], "new", ""),
            ([draft()], "missing", ""),
            ([draft(), draft()], "new", ""),
            ([draft()], "new", "?page=0"),
            ([draft()], "new", "?page_size=101"),
        ):
            with self.subTest(rows=rows, query=query):
                self.assertEqual(
                    self.post_preview(rows, target, query).status_code, 400
                )

    def test_reorder_changes_only_order_and_rejects_foreign_ids(self):
        first = M3UGroupRule.objects.create(
            m3u_account=self.account, scope="live", regex_pattern="News"
        )
        second = M3UGroupRule.objects.create(
            m3u_account=self.account, scope="live", regex_pattern="Sport", order=1
        )
        response = self.client.post(
            self.url + "reorder/",
            {
                "ids": [second.id, first.id],
                "positions": [0, 2],
                "scope": "live",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual((first.order, second.order), (2, 0))
        self.assertEqual(first.regex_pattern, "News")
        bad = self.client.post(
            self.url + "reorder/", {"ids": [first.id], "scope": "live"}, format="json"
        )
        self.assertEqual(bad.status_code, 400)

    def test_custom_actions_require_admin(self):
        user = get_user_model().objects.create_user(username="rule-user", user_level=5)
        self.client.force_authenticate(user)
        for suffix in ("preview-draft/", "save-apply/", "reorder/"):
            self.assertEqual(
                self.client.post(self.url + suffix, {}, format="json").status_code, 403
            )
        filters = f"/api/m3u/accounts/{self.account.id}/filters/"
        for suffix in ("preview-draft/", "reorder/"):
            self.assertEqual(
                self.client.post(filters + suffix, {}, format="json").status_code, 403
            )
        self.assertEqual(
            self.client.get(
                self.url + "content-preview/?scope=live&group_id=1"
            ).status_code,
            403,
        )

    def test_filter_preview_keeps_excluded_streams_without_exposing_urls(self):
        write_live_filter_catalog(
            self.account.id,
            [
                {
                    "name": f"### {i}",
                    "url": "http://private.invalid/password",
                    "attributes": {"group-title": "Events"},
                }
                for i in range(215)
            ],
        )
        filters = [
            {
                "preview_id": "new",
                "filter_type": "name",
                "regex_pattern": "###",
                "exclude": True,
                "order": 0,
                "custom_properties": {"case_sensitive": False},
            }
        ]
        response = self.client.post(
            f"/api/m3u/accounts/{self.account.id}/filters/preview-draft/?page=5&page_size=50",
            {"rules": filters, "target_id": "new"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (response.data["count"], response.data["inventory_count"]), (215, 215)
        )
        self.assertEqual(len(response.data["results"]), 15)
        self.assertTrue(response.data["catalog_complete"])
        self.assertNotIn("password", str(response.data))
        self.assertFalse(M3UFilter.objects.exists())

    def test_account_deletion_cleans_catalog(self):
        account_id = self.account.id
        for scope in ("live", "movie", "series"):
            write_live_filter_catalog(account_id, [], scope=scope)
        self.account.delete()
        for scope in ("live", "movie", "series"):
            self.assertFalse(has_live_filter_catalog(account_id, scope))

    def test_contained_item_preview_includes_disabled_vod_category(self):
        category = VODCategory.objects.create(name="Season", category_type="movie")
        relation = M3UVODCategoryRelation.objects.create(
            category=category, m3u_account=self.account, enabled=False
        )
        write_live_filter_catalog(
            self.account.id,
            [
                {"name": "Anime title", "attributes": {"group-title": "Season"}},
            ],
            scope="movie",
        )
        response = self.post_preview(
            [draft(scope="movie", match_field="item_name", regex_pattern="Anime")]
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["item_count"], 1)
        self.assertTrue(response.data["catalog_complete"])
        relation.refresh_from_db()
        self.assertFalse(relation.enabled)

    def test_filter_preview_uses_snapshot_timestamp_not_newer_failed_refresh(self):
        write_live_filter_catalog(self.account.id, [])
        response = self.client.post(
            f"/api/m3u/accounts/{self.account.id}/filters/preview-draft/",
            {
                "rules": [
                    {
                        "preview_id": "new",
                        "filter_type": "name",
                        "regex_pattern": ".*",
                        "exclude": True,
                    }
                ],
                "target_id": "new",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.data["last_completed_refresh"])

    def test_group_content_is_exactly_scoped_to_account_and_category(self):
        category = VODCategory.objects.create(name="Movies", category_type="movie")
        M3UVODCategoryRelation.objects.create(
            category=category, m3u_account=self.account
        )
        M3UVODCategoryRelation.objects.create(category=category, m3u_account=self.other)
        for account, title in ((self.account, "Wanted"), (self.other, "Private")):
            movie = Movie.objects.create(name=title)
            M3UMovieRelation.objects.create(
                movie=movie, m3u_account=account, category=category, stream_id=title
            )
        response = self.client.get(
            self.url + f"content-preview/?scope=movie&group_id={category.id}"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["name"] for row in response.data["results"]], ["Wanted"])

    def test_new_live_group_rules_preserve_existing_manual_selection(self):
        relation = self.group("News", enabled=False)
        M3UGroupRule.objects.create(
            m3u_account=self.account,
            scope="live",
            regex_pattern="News|Sport",
            action="enable",
        )
        M3UGroupRule.objects.create(
            m3u_account=self.account,
            scope="live",
            regex_pattern="Ignored",
            action="ignore",
            order=1,
        )
        with patch("apps.m3u.tasks.send_m3u_update"):
            process_groups(self.account, {"News": {}, "Sport": {}, "Ignored": {}})
        relation.refresh_from_db()
        self.assertFalse(relation.enabled)
        self.assertTrue(
            ChannelGroupM3UAccount.objects.get(
                m3u_account=self.account, channel_group__name="Sport"
            ).enabled
        )
        self.assertFalse(ChannelGroup.objects.filter(name="Ignored").exists())
