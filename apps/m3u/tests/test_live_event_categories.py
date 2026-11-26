"""Live TV import rules and the category editor mark event categories."""

import tempfile

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.channels.models import ChannelGroup, ChannelGroupM3UAccount
from apps.m3u.models import M3UAccount, M3UGroupRule
from apps.m3u.tasks import process_groups


def live_rule(**values):
    return {
        "scope": "live",
        "match_field": "group_name",
        "match_mode": "any",
        "regex_pattern": "PPV",
        "action": "enable",
        "case_sensitive": False,
        "enabled": True,
        "order": 0,
        "metadata_defaults": {"is_event": True},
        **values,
    }


class LiveEventCategoryTests(TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        settings = self.settings(M3U_FILTER_CATALOG_ROOT=directory.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.account = M3UAccount.objects.create(
            name="event-category-account", account_type="XC"
        )
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(
                username="event-category-admin", user_level=10
            )
        )
        self.rules_url = f"/api/m3u/accounts/{self.account.pk}/group-rules/"

    def relation(self, name, **values):
        group, _ = ChannelGroup.objects.get_or_create(name=name)
        return ChannelGroupM3UAccount.objects.create(
            channel_group=group, m3u_account=self.account, **values
        )

    def test_live_rules_accept_only_the_event_flag(self):
        response = self.client.post(self.rules_url, live_rule(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["metadata_defaults"], {"is_event": True})
        for values in (
            {"metadata_defaults": {"is_event": "yes"}},
            {"metadata_defaults": {"audio_languages": ["ger"]}},
            {"regex_pattern": "MOVIE", "scope": "movie"},
        ):
            with self.subTest(values=values):
                response = self.client.post(
                    self.rules_url, live_rule(**values), format="json"
                )
                self.assertEqual(response.status_code, 400, response.data)

    def test_new_categories_get_the_flag_of_their_first_matching_rule(self):
        M3UGroupRule.objects.create(m3u_account=self.account, **live_rule())
        M3UGroupRule.objects.create(
            m3u_account=self.account,
            **live_rule(regex_pattern=".*", order=1, metadata_defaults={}),
        )
        existing = self.relation("PPV┃ OLD", enabled=False)
        process_groups(
            self.account,
            {"PPV┃ UFC": {"xc_id": "1"}, "DE┃ NEWS": {"xc_id": "2"}, "PPV┃ OLD": {}},
        )
        rows = {
            row.channel_group.name: row
            for row in ChannelGroupM3UAccount.objects.filter(m3u_account=self.account)
        }
        self.assertEqual(rows["PPV┃ UFC"].metadata_defaults, {"is_event": True})
        self.assertTrue(rows["PPV┃ UFC"].enabled)
        self.assertEqual(rows["DE┃ NEWS"].metadata_defaults, {})
        # Existing categories keep their state until rules are applied.
        existing.refresh_from_db()
        self.assertEqual((existing.enabled, existing.metadata_defaults), (False, {}))

    def test_apply_all_sets_and_clears_the_flag(self):
        event = self.relation("PPV┃ BOXING", enabled=True)
        news = self.relation("DE┃ NEWS", enabled=True, metadata_defaults={"is_event": True})
        M3UGroupRule.objects.create(m3u_account=self.account, **live_rule())
        M3UGroupRule.objects.create(
            m3u_account=self.account,
            **live_rule(regex_pattern="NEWS", order=1, metadata_defaults={}),
        )
        url = self.rules_url + "apply-all/"
        response = self.client.post(url, {"scope": "live", "dry_run": True}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["metadata"], 2)
        response = self.client.post(url, {"scope": "live"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        event.refresh_from_db()
        news.refresh_from_db()
        self.assertEqual(event.metadata_defaults, {"is_event": True})
        self.assertEqual(news.metadata_defaults, {})

    def test_group_settings_set_keep_and_reset_the_flag(self):
        relation = self.relation("PPV┃ UFC", enabled=True)
        url = f"/api/m3u/accounts/{self.account.pk}/group-settings/"

        def patch(**values):
            return self.client.patch(
                url,
                {"group_settings": [
                    {"channel_group": relation.channel_group_id, "enabled": True, **values}
                ]},
                format="json",
            )

        self.assertEqual(patch(metadata_defaults={"is_event": True}).status_code, 200)
        relation.refresh_from_db()
        self.assertEqual(relation.metadata_defaults, {"is_event": True})
        self.assertEqual(patch(auto_channel_sync=True).status_code, 200)
        relation.refresh_from_db()
        self.assertEqual(relation.metadata_defaults, {"is_event": True})
        self.assertEqual(patch(metadata_defaults={"is_event": None}).status_code, 200)
        relation.refresh_from_db()
        self.assertEqual(relation.metadata_defaults, {})
        self.assertEqual(patch(metadata_defaults={"is_event": 1}).status_code, 400)


class CategoryModeTests(TestCase):
    """A live category is used for streams, one channel per stream or events."""

    def setUp(self):
        from apps.channels.models import EventChannelGroup

        self.account = M3UAccount.objects.create(name="mode-account", account_type="XC")
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="mode-admin", user_level=10)
        )
        group = ChannelGroup.objects.create(name="PPV┃ UFC")
        self.relation = ChannelGroupM3UAccount.objects.create(
            channel_group=group, m3u_account=self.account, enabled=True, auto_channel_sync=True
        )
        self.events = EventChannelGroup.objects.create(name="Fights")
        self.other = EventChannelGroup.objects.create(name="Other")
        self.url = f"/api/m3u/accounts/{self.account.pk}/group-settings/"

    def patch(self, **values):
        return self.client.patch(
            self.url,
            {"group_settings": [{
                "channel_group": self.relation.channel_group_id,
                "enabled": True,
                **values,
            }]},
            format="json",
        )

    def test_event_categories_feed_one_event_group_without_own_auto_sync(self):
        response = self.patch(
            auto_channel_sync=True,
            metadata_defaults={"is_event": True},
            event_group=self.events.id,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.relation.refresh_from_db()
        self.assertFalse(self.relation.auto_channel_sync)
        self.assertEqual(list(self.relation.event_channel_groups.all()), [self.events])

        self.patch(metadata_defaults={"is_event": True}, event_group=self.other.id)
        self.assertEqual(list(self.relation.event_channel_groups.all()), [self.other])
        # Leaving out event_group keeps the choice.
        self.patch(metadata_defaults={"is_event": True})
        self.assertEqual(list(self.relation.event_channel_groups.all()), [self.other])

        account = self.client.get(f"/api/m3u/accounts/{self.account.pk}/").data
        rows = {row["channel_group"]: row for row in account["channel_groups"]}
        self.assertEqual(rows[self.relation.channel_group_id]["event_group"], self.other.id)

        # One channel per current event: no group, auto sync may be on.
        self.patch(metadata_defaults={"is_event": True}, event_group=None, auto_channel_sync=True)
        self.relation.refresh_from_db()
        self.assertTrue(self.relation.auto_channel_sync)
        self.assertFalse(self.relation.event_channel_groups.exists())

    def test_leaving_events_mode_leaves_event_groups_and_unknown_groups_fail(self):
        self.patch(metadata_defaults={"is_event": True}, event_group=self.events.id)
        self.patch(metadata_defaults={"is_event": None}, auto_channel_sync=True)
        self.assertFalse(self.relation.event_channel_groups.exists())
        response = self.patch(metadata_defaults={"is_event": True}, event_group=999999)
        self.assertEqual(response.status_code, 400)
