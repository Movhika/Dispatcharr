"""The first matching rule decides the import result and all its metadata."""

import tempfile

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.m3u.group_rules import compile_group_rules, evaluate_group_rules
from apps.m3u.models import M3UAccount, M3UGroupRule
from apps.vod.models import Movie, M3UMovieRelation, M3UVODCategoryRelation, VODCategory
from apps.vod.tasks import batch_create_categories


def rule_values(**values):
    return {
        "scope": "movie",
        "match_field": "group_name",
        "match_mode": "any",
        "regex_pattern": "GER",
        "action": "enable",
        "case_sensitive": False,
        "enabled": True,
        "order": 0,
        "metadata_defaults": {"audio_languages": ["ger"]},
        **values,
    }


class MetadataRuleEvaluationTests(SimpleTestCase):
    def evaluate(self, *values):
        rules = [
            M3UGroupRule(id=index + 1, **rule_values(**row))
            for index, row in enumerate(values)
        ]
        return evaluate_group_rules(
            compile_group_rules(rules), group_name="GER ENG 1080p HDR"
        )

    def test_the_first_match_decides_import_and_all_metadata(self):
        decision = self.evaluate(
            {"regex_pattern": "^ENG", "metadata_defaults": {"resolution": "720p"}},
            {"action": "enable", "metadata_defaults": {"resolution": "1080p"}},
            {"regex_pattern": "HDR", "metadata_defaults": {"video_features": ["hdr"]}},
            {"regex_pattern": "ENG", "metadata_defaults": {"audio_languages": ["eng"]}},
        )
        self.assertTrue(decision.enabled)
        self.assertEqual(decision.matched_rule_id, 2)
        # Later matches fill no empty field of the first match.
        self.assertEqual(decision.metadata_defaults, {"resolution": "1080p"})
        decision = self.evaluate(
            {"action": "disable", "metadata_defaults": {}},
            {"regex_pattern": "1080p", "metadata_defaults": {"resolution": "1080p"}},
        )
        self.assertFalse(decision.enabled)
        self.assertEqual(decision.metadata_defaults, {})

    def test_empty_lists_are_explicit_and_disabled_rules_do_not_contribute(self):
        decision = self.evaluate(
            {"enabled": False},
            {"metadata_defaults": {"audio_languages": []}},
            {},
        )
        self.assertTrue(decision.enabled)
        self.assertEqual(decision.matched_rule_id, 2)
        self.assertEqual(decision.metadata_defaults, {"audio_languages": []})

    def test_satisfied_fields_do_not_evaluate_later_expressions(self):
        for action in ("enable", "disable"):
            with self.subTest(action=action):
                rules = [
                    M3UGroupRule(id=1, **rule_values(action=action)),
                    M3UGroupRule(id=2, **rule_values(regex_pattern="(a+)+$")),
                ]
                decision = evaluate_group_rules(
                    compile_group_rules(rules), group_name="GER" + "a" * 10000 + "!"
                )
                self.assertEqual(decision.enabled, action == "enable")
                self.assertEqual(
                    decision.metadata_defaults, {"audio_languages": ["ger"]}
                )


class MetadataRuleApiTests(TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        settings = self.settings(M3U_FILTER_CATALOG_ROOT=directory.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.account = M3UAccount.objects.create(
            name="metadata-rule-account", account_type="XC"
        )
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(
                username="metadata-rule-admin", user_level=10
            )
        )
        self.url = f"/api/m3u/accounts/{self.account.pk}/group-rules/"

    def category(self, name="GER 1080p", *, account=None, enabled=True):
        category, _ = VODCategory.objects.get_or_create(
            name=name, category_type="movie"
        )
        return M3UVODCategoryRelation.objects.create(
            category=category,
            m3u_account=account or self.account,
            enabled=enabled,
            metadata_defaults={"video_features": ["hdr"]},
        )

    def draft(self, *rows, target="1", endpoint="preview-draft/"):
        return self.client.post(
            self.url + endpoint,
            {
                "rules": [
                    {"preview_id": f"new-{index + 1}", **row}
                    for index, row in enumerate(rows)
                ],
                "target_id": f"new-{target}",
            },
            format="json",
        )

    def test_normalizes_iso_codes_and_rejects_invalid_or_live_metadata(self):
        response = self.client.post(
            self.url,
            rule_values(
                metadata_defaults={
                    "audio_languages": ["de", "deu", "eng"],
                    "resolution": "4K",
                    "video_features": ["HDR", "custom:imax"],
                }
            ),
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data["metadata_defaults"],
            {
                "audio_languages": ["ger", "eng"],
                "resolution": "2160p",
                "video_features": ["hdr", "custom:imax"],
            },
        )
        for values in (
            {"scope": "live"},
            {"metadata_defaults": {"audio_languages": ["invalid"]}},
            {"metadata_defaults": {"resolution": None}},
            {"action": "ignore"},
            {"metadata_defaults": {"unknown": []}},
        ):
            with self.subTest(values=values):
                response = self.client.post(
                    self.url, rule_values(**values), format="json"
                )
                self.assertEqual(response.status_code, 400, response.data)

    def test_identical_import_predicates_are_rejected_even_for_different_metadata(self):
        first = self.client.post(self.url, rule_values(), format="json")
        second = self.client.post(
            self.url,
            rule_values(metadata_defaults={"resolution": "1080p"}),
            format="json",
        )
        self.assertEqual((first.status_code, second.status_code), (201, 400))
        duplicate = self.client.post(self.url, rule_values(), format="json")
        self.assertEqual(duplicate.status_code, 400)

    def test_preview_counts_only_first_matches_and_is_read_only(self):
        category = self.category()
        response = self.draft(
            rule_values(action="enable", metadata_defaults={}),
            rule_values(regex_pattern="^GER", order=1),
            rule_values(
                regex_pattern="1080p",
                order=2,
                metadata_defaults={"resolution": "1080p"},
            ),
            target="2",
        )
        self.assertEqual(response.status_code, 200, response.data)
        # Rule 1 matches first, so rule 2 sets nothing on this category.
        self.assertEqual(response.data["count"], 0)
        self.assertEqual(
            [row["count"] for row in response.data["rule_coverage"]], [1, 0, 0]
        )
        response = self.draft(
            rule_values(regex_pattern="1080p", metadata_defaults={"resolution": "1080p"}),
            rule_values(regex_pattern="^GER", order=1),
            target="1",
        )
        row = response.data["results"][0]
        self.assertTrue(row["would_enable"])
        self.assertEqual(row["metadata_defaults"], {"resolution": "1080p"})
        category.refresh_from_db()
        self.assertEqual(category.metadata_defaults, {"video_features": ["hdr"]})
        self.assertFalse(M3UGroupRule.objects.exists())

    def test_apply_all_follows_the_rule_order_and_leaves_unmatched_alone(self):
        german = self.category("GER 1080p", enabled=False)
        english = self.category("ENG 720p")
        french = self.category("FR Kids")
        M3UGroupRule.objects.create(
            m3u_account=self.account, **rule_values(regex_pattern="^GER")
        )
        M3UGroupRule.objects.create(
            m3u_account=self.account,
            **rule_values(
                regex_pattern="GER|ENG", action="disable", order=1, metadata_defaults={}
            ),
        )
        url = self.url + "apply-all/"
        response = self.client.post(
            url, {"scope": "movie", "dry_run": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            {
                key: response.data[key]
                for key in ("matched", "changed", "enable", "disable", "metadata")
            },
            {"matched": 2, "changed": 2, "enable": 1, "disable": 1, "metadata": 2},
        )
        german.refresh_from_db()
        self.assertFalse(german.enabled)
        response = self.client.post(url, {"scope": "movie"}, format="json")
        self.assertEqual(response.data["updated"], 2)
        for row in (german, english, french):
            row.refresh_from_db()
        # The first match decides: GER is enabled by rule 1, not disabled by 2.
        self.assertEqual(
            (german.enabled, german.metadata_defaults),
            (True, {"audio_languages": ["ger"]}),
        )
        self.assertEqual((english.enabled, english.metadata_defaults), (False, {}))
        self.assertEqual(
            (french.enabled, french.metadata_defaults),
            (True, {"video_features": ["hdr"]}),
        )

    def test_apply_sets_import_result_and_replaces_defaults_of_this_account(self):
        category = self.category(enabled=False)
        other = self.category(
            account=M3UAccount.objects.create(name="other-metadata-account")
        )
        rule = M3UGroupRule.objects.create(m3u_account=self.account, **rule_values())
        response = self.client.post(self.url + f"{rule.pk}/apply/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["enabled"])
        category.refresh_from_db()
        other.refresh_from_db()
        self.assertTrue(category.enabled)
        # The rule's defaults replace earlier ones; other accounts keep theirs.
        self.assertEqual(category.metadata_defaults, {"audio_languages": ["ger"]})
        self.assertEqual(other.metadata_defaults, {"video_features": ["hdr"]})
        self.assertEqual(
            response.data["category_updates"][0]["metadata_defaults"],
            {"audio_languages": ["ger"]},
        )

    def test_save_apply_leaves_categories_of_earlier_rules_alone(self):
        category = self.category()
        response = self.draft(
            rule_values(),
            rule_values(
                order=1,
                regex_pattern="1080p",
                metadata_defaults={
                    "audio_languages": ["eng"],
                    "resolution": "1080p",
                },
            ),
            target="2",
            endpoint="save-apply/",
        )
        self.assertEqual(response.status_code, 200, response.data)
        category.refresh_from_db()
        # Rule 1 matches "GER 1080p" first, so rule 2 changes nothing there.
        self.assertEqual(category.metadata_defaults, {"video_features": ["hdr"]})
        self.assertEqual(response.data["updated"], 0)
        self.assertEqual(M3UGroupRule.objects.count(), 2)

    def test_discovery_only_populates_new_account_categories_and_source_facts_win(self):
        existing = self.category()
        M3UGroupRule.objects.create(
            m3u_account=self.account, **rule_values(action="enable")
        )
        result = batch_create_categories(
            [
                {"category_name": "GER 1080p"},
                {"category_name": "GER new"},
            ],
            "movie",
            self.account,
        )
        existing.refresh_from_db()
        self.assertEqual(existing.metadata_defaults, {"video_features": ["hdr"]})
        created = M3UVODCategoryRelation.objects.get(
            category=result["GER new"], m3u_account=self.account
        )
        self.assertEqual(created.metadata_defaults, {"audio_languages": ["ger"]})
        source = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            category=created.category,
            movie=Movie.objects.create(name="Shared identity"),
            stream_id="metadata-source",
            declared_metadata={"audio_languages": ["eng"]},
        )
        self.assertEqual(
            source.effective_metadata()["values"]["audio_languages"], ["eng"]
        )
