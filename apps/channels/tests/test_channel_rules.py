"""Stream rules let a channel find its streams like a Library title its sources."""

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.channels.channel_rules import apply_rules
from apps.channels.models import (
    Channel,
    ChannelGroup,
    ChannelGroupM3UAccount,
    ChannelStream,
    ChannelStreamRule,
    Stream,
)
from apps.m3u.models import M3UAccount


class ChannelRuleTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="rules-admin", user_level=10)
        )
        self.provider_t = M3UAccount.objects.create(name="ProviderT", account_type="XC", priority=2)
        self.provider_c = M3UAccount.objects.create(name="ProviderC", account_type="XC")
        self.group_t = self.group(self.provider_t, "DE┃ ALLGEMEINES")
        self.group_c = self.group(self.provider_c, "Germany")
        self.zdf_fhd = self.stream(self.provider_t, self.group_t, "DE┃ ZDF FHD")
        self.zdf_hd_archive = self.stream(self.provider_t, self.group_t, "DE┃ ZDF HD", is_catchup=True)
        self.zdf_c = self.stream(self.provider_c, self.group_c, "De: ZDF HD")
        self.zdf_uk = self.stream(self.provider_c, self.group_c, "UK┃ ZDF HD")
        self.zdf_neo = self.stream(self.provider_t, self.group_t, "DE┃ ZDF NEO FHD")
        self.zdf_info_raw = self.stream(self.provider_c, self.group_c, "ZDFinfo RAW")
        self.channel = Channel.objects.create(name="ZDF", channel_number=3)
        self.manual = self.stream(self.provider_c, self.group_c, "My own ZDF feed")
        ChannelStream.objects.create(channel=self.channel, stream=self.manual, order=0)

    def group(self, account, name):
        group, _ = ChannelGroup.objects.get_or_create(name=name)
        ChannelGroupM3UAccount.objects.create(channel_group=group, m3u_account=account, enabled=True)
        return group

    def stream(self, account, group, name, **values):
        return Stream.objects.create(
            name=name, url=f"http://example.test/{account.pk}/{name}",
            m3u_account=account, channel_group=group, **values,
        )

    def links(self, channel=None):
        return [
            (link.stream.name, link.origin)
            for link in ChannelStream.objects.filter(channel=channel or self.channel)
            .select_related("stream").order_by("order")
        ]

    def put_rule(self, **values):
        return self.client.put(
            f"/api/channels/channels/{self.channel.id}/stream-rule/", values, format="json"
        )

    def test_rule_adds_matching_streams_after_the_manual_ones(self):
        response = self.put_rule(countries=["DE"])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            self.links(),
            [
                ("My own ZDF feed", "manual"),
                ("DE┃ ZDF FHD", "rule"),
                ("DE┃ ZDF HD", "rule"),
                ("De: ZDF HD", "rule"),
            ],
        )
        self.assertIsNotNone(response.data["last_applied_at"])

    def test_filters_regex_and_further_names(self):
        self.put_rule(catchup="only")
        self.assertEqual([name for name, _ in self.links()], ["My own ZDF feed", "DE┃ ZDF HD"])
        self.put_rule(catchup="exclude", exclude_regex=r"^UK", account_ids=[self.provider_t.id])
        self.assertEqual([name for name, _ in self.links()], ["My own ZDF feed", "DE┃ ZDF FHD"])
        self.put_rule(match_name=False, include_regex=r"zdf ?info", account_ids=[], catchup="include")
        self.assertEqual([name for name, _ in self.links()], ["My own ZDF feed", "ZDFinfo RAW"])
        self.put_rule(match_name=True, include_regex="", names=["ZDFneo"], exclude_regex="")
        self.assertIn("DE┃ ZDF NEO FHD", [name for name, _ in self.links()])
        self.assertEqual(self.put_rule(include_regex="(").status_code, 400)

    def test_removed_rule_streams_stay_excluded_and_pinned_ones_stay(self):
        self.put_rule(countries=["DE"])
        ids = [link.stream_id for link in ChannelStream.objects.filter(channel=self.channel).order_by("order")]
        # Removing a rule stream by hand, like the channel editor does.
        response = self.client.patch(
            f"/api/channels/channels/{self.channel.id}/",
            {"streams": [i for i in ids if i != self.zdf_c.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        rule = ChannelStreamRule.objects.get(channel=self.channel)
        self.assertEqual(rule.excluded_stream_ids, [self.zdf_c.id])
        apply_rules()
        self.assertNotIn("De: ZDF HD", [name for name, _ in self.links()])

        response = self.client.patch(
            f"/api/channels/channels/{self.channel.id}/streams/{self.zdf_fhd.id}/origin/",
            {"origin": "manual"},
            format="json",
        )
        self.assertEqual(response.status_code, 204)
        self.put_rule(account_ids=[self.provider_c.id])
        names = dict(self.links())
        self.assertEqual(names["DE┃ ZDF FHD"], "manual")
        self.assertNotIn("DE┃ ZDF HD", names)

        # Adding the excluded stream back by hand allows it again.
        ids = [link.stream_id for link in ChannelStream.objects.filter(channel=self.channel).order_by("order")]
        self.client.patch(
            f"/api/channels/channels/{self.channel.id}/",
            {"streams": ids + [self.zdf_c.id]},
            format="json",
        )
        rule.refresh_from_db()
        self.assertEqual(rule.excluded_stream_ids, [])

    def test_preview_saves_nothing_and_delete_keeps_streams_as_manual(self):
        url = f"/api/channels/channels/{self.channel.id}/stream-rule/"
        response = self.client.post(url + "preview/", {"catchup": "only"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [(row["name"], row["status"]) for row in response.data["streams"]],
            [("My own ZDF feed", "manual"), ("DE┃ ZDF HD", "added")],
        )
        self.assertFalse(ChannelStreamRule.objects.exists())
        self.put_rule(catchup="only")
        response = self.client.post(url + "preview/", {"catchup": "exclude", "countries": ["DE"]}, format="json")
        statuses = {row["name"]: row["status"] for row in response.data["streams"] + response.data["removed"]}
        self.assertEqual(statuses["DE┃ ZDF HD"], "removed")
        self.assertEqual(statuses["DE┃ ZDF FHD"], "added")

        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual({origin for _, origin in self.links()}, {"manual"})
        self.assertEqual(len(self.links()), 2)

    def test_bulk_rules_skip_auto_sync_channels_and_keep_names(self):
        neo = Channel.objects.create(name="ZDF Neo", channel_number=4)
        auto = Channel.objects.create(name="ZDF", channel_number=9000, auto_created=True)
        self.put_rule(names=["ZDF HD"])
        response = self.client.post(
            "/api/channels/channels/stream-rules/bulk/",
            {"channel_ids": [self.channel.id, neo.id, auto.id], "rule": {"countries": ["DE"], "names": ["x"]}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rules"], 2)
        self.assertEqual(ChannelStreamRule.objects.get(channel=self.channel).names, ["ZDF HD"])
        self.assertEqual([name for name, _ in self.links(neo)], ["DE┃ ZDF NEO FHD"])
        self.assertFalse(ChannelStreamRule.objects.filter(channel=auto).exists())
        response = self.client.put(f"/api/channels/channels/{auto.id}/stream-rule/", {}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn(self.zdf_fhd.id, self.client.get(f"/api/channels/channels/{self.channel.id}/").data["rule_stream_ids"])
