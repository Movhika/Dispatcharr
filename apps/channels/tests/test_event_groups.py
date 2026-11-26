"""Event groups build one channel per event from several providers."""

from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.channels.event_groups import build
from apps.channels.models import (
    Channel,
    ChannelGroup,
    ChannelGroupM3UAccount,
    ChannelProfile,
    EventChannel,
    EventChannelGroup,
    Stream,
)
from apps.m3u.models import M3UAccount
from core.models import CoreSettings

FMT = "%Y-%m-%d %H:%M:%S"


def ufc(number, title, start, minutes=180):
    stop = start + timedelta(minutes=minutes)
    return f"UFC event: {number} name: {title} start:{start.strftime(FMT)} stop:{stop.strftime(FMT)}"


class EventGroupTests(TestCase):
    def setUp(self):
        self.now = timezone.now().replace(microsecond=0).astimezone(timezone.get_fixed_timezone(0))
        self.target = ChannelGroup.objects.create(name="Events")
        self.relations = []
        self.streams = {}
        for account_name, priority in (("ProviderC", 0), ("ProviderT", 5)):
            account = M3UAccount.objects.create(name=account_name, account_type="XC", priority=priority)
            group = ChannelGroup.objects.create(name=f"{account_name} PPV")
            self.relations.append(ChannelGroupM3UAccount.objects.create(
                m3u_account=account, channel_group=group, enabled=True,
                custom_properties={"event_timezone": "UTC"},
                metadata_defaults={"is_event": True},
            ))
        self.add(0, "c-main", ufc(1, "Lille vs Bayern Munich", self.now + timedelta(hours=2)))
        self.add(1, "t-main", ufc(7, "Lille vs FC Bayern München", self.now + timedelta(hours=2, minutes=5)))
        self.add(0, "c-live", ufc(2, "Inter vs Stuttgart", self.now - timedelta(hours=1)))
        self.add(0, "c-ended", ufc(3, "Old Fight", self.now - timedelta(hours=6), 60))
        self.add(1, "t-far", ufc(8, "Next Week", self.now + timedelta(days=7)))
        self.add(1, "t-empty", "UFC 05 :")
        self.group = EventChannelGroup.objects.create(
            name="PPV events", channel_group=self.target, start_number=2950, end_number=2952,
        )
        self.group.sources.set(self.relations)

    def add(self, relation_index, key, name):
        relation = self.relations[relation_index]
        self.streams[key] = Stream.objects.create(
            name=name, url=f"http://example.test/{key}", m3u_account=relation.m3u_account,
            channel_group=relation.channel_group, last_seen=timezone.now(),
        )

    def channels(self):
        return {
            channel.channel_number: (channel.name, list(channel.streams.order_by("channelstream__order").values_list("id", flat=True)))
            for channel in Channel.objects.filter(channel_group=self.target)
        }

    def test_build_creates_updates_and_removes_event_channels(self):
        self.group.name_format = EventChannelGroup.NameFormat.TITLE
        self.group.save()
        ChannelProfile.objects.create(name="Living room")
        summary = build(self.group)
        self.assertEqual(summary["events"], 2)
        self.assertEqual(summary["created"], 2)
        channels = self.channels()
        self.assertEqual(
            channels,
            {
                2950.0: ("Inter - Stuttgart", [self.streams["c-live"].id]),
                2951.0: ("Lille - Bayern Munich", [self.streams["t-main"].id, self.streams["c-main"].id]),
            },
        )
        lille = Channel.objects.get(channel_number=2951)
        self.assertEqual(lille.channelprofilemembership_set.count(), ChannelProfile.objects.count())

        # The live event ends; the Lille channel keeps its number.
        self.streams["c-live"].name = "UFC 05 :"
        self.streams["c-live"].save()
        summary = build(self.group)
        self.assertEqual((summary["removed"], summary["created"]), (1, 0))
        self.assertEqual(list(self.channels()), [2951.0])
        self.assertEqual(EventChannel.objects.filter(group=self.group).count(), 1)

    def test_event_channels_get_a_guide_with_the_event_time(self):
        from apps.output.dummy_epg import generate_custom_dummy_programs

        build(self.group)
        lille = Channel.objects.get(channel_number=2951)
        self.assertEqual(lille.epg_data.epg_source.name, "Event channels")
        self.assertEqual(lille.epg_data.epg_source.source_type, "dummy")
        programs = generate_custom_dummy_programs(
            lille.id, lille.name, self.now, 2, lille.epg_data.epg_source.custom_properties
        )
        main = [p for p in programs if p["title"] == "Lille - Bayern Munich"]
        self.assertEqual(len(main), 1)
        # The guide starts at the event start in the name (minute precision).
        self.assertEqual(
            main[0]["start_time"],
            (self.now + timedelta(hours=2)).replace(second=0),
        )
        self.assertTrue(any(p["title"].startswith("Upcoming") for p in programs))

        self.group.epg_enabled = False
        self.group.save()
        lille.epg_data = None
        lille.save()
        build(self.group)
        lille.refresh_from_db()
        self.assertIsNone(lille.epg_data)

    def test_periodic_rebuild_covers_enabled_groups(self):
        from apps.channels.tasks import rebuild_event_groups

        paused = EventChannelGroup.objects.create(name="Paused", channel_group=self.target, enabled=False)
        paused.sources.set(self.relations)
        with patch("core.utils.send_websocket_update") as announce:
            results = rebuild_event_groups()
        self.assertEqual(list(results), ["PPV events"])
        self.assertEqual(results["PPV events"]["created"], 2)
        announce.assert_called_once()

    def test_paused_groups_keep_their_channels_and_ranges_limit_new_ones(self):
        self.group.end_number = 2950
        self.group.save()
        summary = build(self.group)
        self.assertEqual((summary["created"], summary["skipped"]), (1, 1))
        self.group.enabled = False
        self.group.save()
        self.assertEqual(build(self.group)["removed"], 0)
        self.assertEqual(len(self.channels()), 1)

    def test_api_preview_build_aliases_and_delete(self):
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username="events-admin", user_level=10))
        base = "/api/channels/event-groups/"
        response = client.post(base + "preview/", {"sources": [r.id for r in self.relations], "lookahead_hours": 240}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["title"] for row in response.data], ["Inter - Stuttgart", "Lille - Bayern Munich", "Next Week"])
        self.assertEqual(len(response.data[1]["streams"]), 2)

        response = client.post(base + f"{self.group.id}/build/")
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(client.get(base).data[0]["channel_count"], 2)

        # Settings are cached outside the test transaction: reset them after.
        self.addCleanup(CoreSettings.set_event_team_aliases, None)
        response = client.put(base + "team-aliases/", {"aliases": [["Lille", "LOSC"]]}, format="json")
        self.assertEqual(response.data["aliases"], [["Lille", "LOSC"]])
        self.assertEqual(client.put(base + "team-aliases/", {"aliases": "x"}, format="json").status_code, 400)

        response = client.patch(base + f"{self.group.id}/", {"start_number": 10, "end_number": 5}, format="json")
        self.assertEqual(response.status_code, 400)
        options = client.get(base + "source-options/").data
        self.assertTrue(options[0]["is_event"])

        with patch("apps.proxy.live_proxy.services.channel_service.ChannelService.stop_channels"):
            self.assertEqual(client.delete(base + f"{self.group.id}/").status_code, 204)
        self.assertFalse(Channel.objects.filter(channel_group=self.target).exists())
