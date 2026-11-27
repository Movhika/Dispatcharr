"""Manual accounts hold streams entered in Dispatcharr instead of a source."""

from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.channels.models import Channel, ChannelGroupM3UAccount, Stream
from apps.m3u.models import M3UAccount
from apps.m3u.tasks import _refresh_single_m3u_account_impl


class ManualAccountTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            get_user_model().objects.create_user(username="manual-admin", user_level=10)
        )
        for target in (
            "apps.channels.tasks.build_event_groups_for_account.delay",
            "apps.channels.tasks.apply_channel_stream_rules.delay",
            "apps.m3u.tasks.send_m3u_update",
            "apps.m3u.tasks._release_task_db_connection",
            "apps.output.streaming_chunk_cache.invalidate_output_caches_after_m3u_refresh",
        ):
            patcher = patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

    def create_account(self):
        response = self.client.post(
            "/api/m3u/accounts/",
            {"name": "My streams", "account_type": "MAN", "start_setup": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return M3UAccount.objects.get(id=response.data["id"])

    def add(self, account, **values):
        payload = {
            "name": "Webcam Harbour",
            "url": "rtsp://cam.example.test/harbour",
            "category": "Webcams",
            **values,
        }
        # The refresh starts after the commit, while delay is still patched.
        with patch(
            "apps.m3u.tasks.refresh_single_m3u_account.delay"
        ) as refresh, self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                f"/api/m3u/accounts/{account.id}/streams/", payload, format="json"
            )
        return response, refresh

    def test_manual_account_needs_no_source_or_setup(self):
        with patch("apps.m3u.signals.refresh_m3u_groups.delay") as fetch:
            account = self.create_account()
        fetch.assert_not_called()
        self.assertEqual(account.account_type, M3UAccount.Types.MANUAL)
        self.assertFalse(account.setup_step)
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/", {"account_type": "STD"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("account_type", response.data)

    def test_streams_are_added_edited_and_removed_with_their_category(self):
        account = self.create_account()
        response, refresh = self.add(account)
        self.assertEqual(response.status_code, 201, response.data)
        refresh.assert_called_once_with(account.id)
        stream = Stream.objects.get(id=response.data["id"])
        self.assertTrue(stream.is_custom)
        self.assertTrue(stream.stream_hash)
        self.assertEqual(response.data["category"], "Webcams")
        relation = ChannelGroupM3UAccount.objects.get(m3u_account=account)
        self.assertEqual((relation.channel_group.name, relation.enabled), ("Webcams", True))

        response, _refresh = self.add(account, url="file:///etc/passwd")
        self.assertEqual(response.status_code, 400)
        self.assertIn("url", response.data)

        url = f"/api/m3u/accounts/{account.id}/streams/{stream.id}/"
        with patch("apps.m3u.tasks.refresh_single_m3u_account.delay"):
            response = self.client.patch(url, {"category": "Radio", "tvg_id": "harbour.cam"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        stream.refresh_from_db()
        self.assertEqual((stream.channel_group.name, stream.tvg_id), ("Radio", "harbour.cam"))
        self.assertEqual(
            [row["name"] for row in self.client.get(f"/api/m3u/accounts/{account.id}/streams/").data],
            ["Webcam Harbour"],
        )
        with patch("apps.m3u.tasks.refresh_single_m3u_account.delay"):
            self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Stream.objects.filter(id=stream.id).exists())

        other = M3UAccount.objects.create(name="Provider", server_url="http://example.test/list.m3u")
        self.assertEqual(self.client.get(f"/api/m3u/accounts/{other.id}/streams/").status_code, 404)

    def test_refresh_keeps_streams_and_auto_synced_channels(self):
        account = self.create_account()
        response, _refresh = self.add(account)
        relation = ChannelGroupM3UAccount.objects.get(m3u_account=account)
        relation.auto_channel_sync = True
        relation.auto_sync_channel_start = 900
        relation.save()
        for _run in (1, 2):
            message = _refresh_single_m3u_account_impl(account.id)
            account.refresh_from_db()
            self.assertEqual(account.status, M3UAccount.Status.SUCCESS)
            self.assertEqual(account.last_message, message)
            self.assertTrue(Stream.objects.filter(id=response.data["id"], is_stale=False).exists())
            channels = Channel.objects.filter(auto_created_by=account)
            self.assertEqual(list(channels.values_list("name", flat=True)), ["Webcam Harbour"])
        self.assertTrue(message.startswith("Manual streams: 1."), message)
        self.assertEqual(
            account.custom_properties["live_catalog_counts"],
            {"provider_total": 1, "selected_total": 1},
        )
