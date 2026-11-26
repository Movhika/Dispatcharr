"""Auto sync of event categories keeps current events and names their channels."""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.channels.models import Channel, ChannelGroup, ChannelGroupM3UAccount, Stream
from apps.m3u.models import M3UAccount
from apps.m3u.tasks import sync_auto_channels


def slot(number, title, start, stop):
    fmt = "%Y-%m-%d %H:%M:%S"
    return (
        f"UFC event: {number} name: {title} "
        f"start:{start.strftime(fmt)} stop:{stop.strftime(fmt)}"
    )


class EventAutoSyncTests(TestCase):
    def setUp(self):
        self.account = M3UAccount.objects.create(
            name="Event Provider", server_url="http://example.com/events.m3u"
        )
        self.group = ChannelGroup.objects.create(name="PPV┃ UFC PPV")
        now = timezone.now().astimezone(timezone.get_fixed_timezone(0))
        self.names = {
            "live": slot(1, "Fight Night", now - timedelta(hours=1), now + timedelta(hours=2)),
            "upcoming": slot(2, "Main Card", now + timedelta(hours=3), now + timedelta(hours=6)),
            "ended": slot(3, "Prelims", now - timedelta(hours=6), now - timedelta(hours=3)),
            "none": "UFC 05 :",
        }
        for index, name in enumerate(self.names.values()):
            Stream.objects.create(
                name=name,
                url=f"http://example.com/ufc/{index}.ts",
                m3u_account=self.account,
                channel_group=self.group,
                last_seen=timezone.now(),
            )
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="event-admin", user_level=10)
        )

    def relation(self, *, event=True, **custom):
        return ChannelGroupM3UAccount.objects.create(
            m3u_account=self.account,
            channel_group=self.group,
            enabled=True,
            auto_channel_sync=True,
            auto_sync_channel_start=2950,
            custom_properties={"event_timezone": "UTC", **custom},
            metadata_defaults={"is_event": True} if event else {},
        )

    def sync(self):
        result = sync_auto_channels(
            self.account.id,
            scan_start_time=(timezone.now() - timedelta(minutes=1)).isoformat(),
        )
        self.assertEqual(result.get("status"), "ok", result)
        return set(
            Channel.objects.filter(auto_created_by=self.account).values_list("name", flat=True)
        )

    def test_current_filter_keeps_live_upcoming_and_names_by_event(self):
        relation = self.relation(event_filter="current", event_channel_name=True)
        self.assertEqual(self.sync(), {"Fight Night", "Main Card"})
        # Without event names the channels keep the provider names.
        relation.custom_properties["event_channel_name"] = False
        relation.save()
        names = self.sync()
        self.assertEqual(names, {self.names["live"], self.names["upcoming"]})

    def test_without_filter_or_event_mark_every_stream_gets_a_channel(self):
        relation = self.relation()
        self.assertEqual(len(self.sync()), 4)
        relation.metadata_defaults = {}
        relation.custom_properties = {"event_filter": "current", "event_channel_name": True}
        relation.save()
        # Settings of categories that are no event category are ignored.
        self.assertEqual(self.sync(), set(self.names.values()))

    def test_preview_parses_unsaved_settings(self):
        url = f"/api/m3u/accounts/{self.account.pk}/event-preview/"
        response = self.client.post(
            url,
            {"channel_group": self.group.id, "custom_properties": {"event_filter": "current"}},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["counts"], {"live": 1, "upcoming": 1, "ended": 1, "none": 1}
        )
        rows = {row["title"]: row for row in response.data["rows"]}
        self.assertTrue(rows["Fight Night"]["kept"])
        self.assertFalse(rows["Prelims"]["kept"])
        self.assertEqual(rows["Fight Night"]["status"], "live")
        response = self.client.post(
            url,
            {"channel_group": self.group.id, "custom_properties": {"event_pattern": "("}},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_group_settings_validate_and_complete_event_settings(self):
        relation = self.relation(event=True)
        url = f"/api/m3u/accounts/{self.account.pk}/group-settings/"

        def patch(custom):
            return self.client.patch(
                url,
                {"group_settings": [{
                    "channel_group": self.group.id,
                    "enabled": True,
                    "auto_channel_sync": True,
                    "custom_properties": custom,
                }]},
                format="json",
            )

        self.assertEqual(patch({"event_timezone": "Nowhere"}).status_code, 400)
        self.assertEqual(patch({"event_filter": "current"}).status_code, 200)
        relation.refresh_from_db()
        self.assertEqual(relation.custom_properties["event_filter"], "current")
        self.assertEqual(relation.custom_properties["event_duration_minutes"], 180)
