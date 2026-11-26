"""Streams are matched to channels by their normalized names."""

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.channels.models import (
    Channel,
    ChannelGroup,
    ChannelGroupM3UAccount,
    ChannelStream,
    Stream,
)
from apps.channels.stream_matching import alias_map, parse_name
from apps.m3u.models import M3UAccount
from core.models import CoreSettings


class ParseNameTests(SimpleTestCase):
    def key(self, name, aliases=None):
        parsed = parse_name(name, alias_map(aliases))
        return parsed.key if parsed else None

    def test_prefixes_quality_and_spellings_share_one_key(self):
        for name in (
            "DE┃ PROSIEBEN FHD",
            "De: ProSieben HD +",
            "DE: Pro7 4K",
            "UCL┃ PROSIEBEN HD [DE]",
            "┃DE┃ PROSIEBEN FHD",
            "ProSieben HEVC",
        ):
            with self.subTest(name=name):
                self.assertEqual(self.key(name), "PROSIEBEN")
        self.assertEqual(self.key("DE┃ PRO7SAT.1 4K UHD"), "PROSIEBENSAT1")
        self.assertEqual(self.key("RTL II HD"), self.key("RTL ZWEI"))
        self.assertEqual(self.key("N-TV"), self.key("NTV HD"))
        self.assertEqual(self.key("BR FERNSEHEN SÜD"), self.key("BR FERNSEHEN SUD HD"))

    def test_quality_country_and_uhd_are_reported(self):
        parsed = parse_name("UCL┃ DAZN 1 HD [DE]")
        self.assertEqual((parsed.key, parsed.country, parsed.rank), ("DAZN1", "DE", 1))
        self.assertLess(parse_name("ZDF FHD").rank, parse_name("ZDF HD").rank)
        self.assertLess(parse_name("ZDF HD").rank, parse_name("ZDF HD +").rank)
        self.assertLess(parse_name("ZDF HD +").rank, parse_name("ZDF 4K").rank)
        self.assertTrue(parse_name("RTL 4K UHD").uhd)
        self.assertFalse(parse_name("RTL 4K").uhd)

    def test_timeshift_and_dividers_are_skipped(self):
        for name in ("Cinema Premiere +24 4K", "SPORTDIGITAL +1 HD", "☰☰☰ PAKET 4K ☰☰☰", "#####"):
            with self.subTest(name=name):
                self.assertIsNone(parse_name(name))
        self.assertEqual(self.key("Sky Sport+ 1"), "SKYSPORT+1")

    def test_aliases_cover_numbered_names(self):
        aliases = [["DAZN Champions League", "DAZN UEFA Champions League"], ["RTL Nitro", "Nitro"]]
        self.assertEqual(
            self.key("DE┃ DAZN UEFA CHAMPIONS LEAGUE 7", aliases),
            self.key("DAZN CHAMPIONS LEAGUE 7", aliases),
        )
        self.assertEqual(self.key("NITRO FHD", aliases), self.key("RTL NITRO", aliases))
        self.assertNotEqual(self.key("NITRO FHD"), self.key("RTL NITRO"))


class MatchStreamsApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="match-admin", user_level=10)
        )
        self.first = M3UAccount.objects.create(name="first", account_type="XC", priority=1)
        self.second = M3UAccount.objects.create(name="second", account_type="XC")
        self.url = "/api/channels/channels/match-streams/"

    def group(self, account, name, **values):
        group, _ = ChannelGroup.objects.get_or_create(name=name)
        ChannelGroupM3UAccount.objects.create(
            channel_group=group, m3u_account=account, enabled=True, **values
        )
        return group

    def stream(self, account, group, name, **values):
        return Stream.objects.create(
            name=name,
            url=f"http://example.test/{account.pk}/{name}",
            m3u_account=account,
            channel_group=group,
            **values,
        )

    def post(self, channels, **values):
        return self.client.post(
            self.url, {"channel_ids": [c.id for c in channels], **values}, format="json"
        )

    def test_preview_orders_by_quality_then_account_and_apply_writes(self):
        de = self.group(self.first, "DE┃ ALLGEMEINES")
        other = self.group(self.second, "Germany")
        hd = self.stream(self.first, de, "DE┃ PROSIEBEN HD")
        fhd_second = self.stream(self.second, other, "De: ProSieben FHD")
        fhd_first = self.stream(self.first, de, "DE┃ PRO7 FHD")
        uhd = self.stream(self.first, de, "DE┃ PROSIEBEN 4K")
        self.stream(self.first, de, "DE┃ PROSIEBEN MAXX FHD")
        channel = Channel.objects.create(name="ProSieben", channel_number=24)

        response = self.post([channel])
        self.assertEqual(response.status_code, 200, response.data)
        row = response.data["channels"][0]
        self.assertTrue(row["changed"])
        self.assertEqual(
            [s["id"] for s in row["streams"]],
            [fhd_first.id, fhd_second.id, hd.id, uhd.id],
        )
        self.assertFalse(ChannelStream.objects.filter(channel=channel).exists())

        response = self.post([channel], dry_run=False)
        self.assertTrue(response.data["applied"])
        self.assertEqual(
            list(channel.streams.order_by("channelstream__order").values_list("id", flat=True)),
            [fhd_first.id, fhd_second.id, hd.id, uhd.id],
        )
        response = self.post([channel])
        self.assertEqual(response.data["changed"], 0)

    def test_only_enabled_non_event_categories_of_active_accounts_count(self):
        live = self.group(self.first, "DE┃ SPORT")
        event = self.group(self.first, "PPV┃ EVENTS", metadata_defaults={"is_event": True})
        disabled = self.group(self.second, "DE┃ OFF")
        ChannelGroupM3UAccount.objects.filter(channel_group=disabled).update(enabled=False)
        kept = self.stream(self.first, live, "DAZN 1 FHD")
        self.stream(self.first, event, "DAZN 1 HD")
        self.stream(self.second, disabled, "DAZN 1 SD")
        stale = self.stream(self.first, live, "DAZN 1 RAW", is_stale=True)
        channel = Channel.objects.create(name="DAZN 1")
        ChannelStream.objects.create(channel=channel, stream=stale, order=0)

        row = self.post([channel]).data["channels"][0]
        self.assertEqual([(s["id"], s["match"]) for s in row["streams"]], [(kept.id, "exact"), (stale.id, "kept")])
        row = self.post([channel], keep_unmatched=False).data["channels"][0]
        self.assertEqual([s["id"] for s in row["streams"]], [kept.id])
        self.assertEqual([s["id"] for s in row["removed"]], [stale.id])

    def test_catchup_country_uhd_and_similar_names(self):
        group = self.group(self.first, "MIXED")
        live = self.stream(self.first, group, "DE┃ RTL FHD")
        archive = self.stream(self.first, group, "DE┃ RTL HD", is_catchup=True)
        uk = self.stream(self.first, group, "UK┃ RTL HD")
        rtl_4k = self.stream(self.first, group, "DE┃ RTL 4K")
        rtl_uhd = self.stream(self.first, group, "DE┃ RTL 4K UHD")
        typo = self.stream(self.first, group, "RTL+ SHOPING QUEEN")
        rtl = Channel.objects.create(name="RTL")
        uhd_channel = Channel.objects.create(name="RTL UHD")
        queen = Channel.objects.create(name="RTL+ Shopping Queen")

        data = self.post([rtl, uhd_channel, queen], countries=["DE"], catchup="exclude").data
        rows = {row["name"]: row for row in data["channels"]}
        self.assertEqual([s["id"] for s in rows["RTL"]["streams"]], [live.id, rtl_4k.id])
        self.assertEqual([s["id"] for s in rows["RTL UHD"]["streams"]], [rtl_uhd.id])
        self.assertEqual(
            [(s["id"], s["match"]) for s in rows["RTL+ Shopping Queen"]["streams"]],
            [(typo.id, "similar")],
        )
        self.assertEqual(data["countries"], {"DE": 3, "UK": 1})
        row = self.post([rtl], catchup="only").data["channels"][0]
        self.assertEqual([s["id"] for s in row["streams"]], [archive.id])
        row = self.post([rtl]).data["channels"][0]
        self.assertIn(uk.id, [s["id"] for s in row["streams"]])

    def test_aliases_default_are_saved_on_apply_and_validated(self):
        group = self.group(self.first, "DE")
        nitro = self.stream(self.first, group, "DE┃ NITRO FHD")
        channel = Channel.objects.create(name="RTL Nitro")
        data = self.post([channel]).data
        self.assertIn(["RTL Nitro", "Nitro"], data["aliases"])
        self.assertEqual([s["id"] for s in data["channels"][0]["streams"]], [nitro.id])

        data = self.post([channel], aliases=[]).data
        self.assertEqual(data["channels"][0]["streams"], [])
        self.assertIsNone(CoreSettings.get_stream_matching_aliases())
        # Settings are cached outside the test transaction: reset them after.
        self.addCleanup(CoreSettings.set_stream_matching_aliases, None)
        self.post([channel], aliases=[["RTL Nitro", " Nitro ", ""]], dry_run=False)
        self.assertEqual(CoreSettings.get_stream_matching_aliases(), [["RTL Nitro", "Nitro"]])
        self.assertEqual(self.post([channel], aliases="Nitro").status_code, 400)
        self.assertEqual(self.post([]).status_code, 400)
