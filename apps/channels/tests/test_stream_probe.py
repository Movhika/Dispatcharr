"""Streams are tested with free connection slots and sorted by the result."""

import os
import subprocess
from unittest.mock import ANY, MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.channels import stream_probe
from apps.channels.models import Channel, ChannelStream, Stream
from apps.channels.tasks import STREAM_TEST_LOCK
from apps.m3u.models import M3UAccount

FFPROBE_JSON = {
    "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080,
         "avg_frame_rate": "50/1"},
        {"codec_type": "audio", "codec_name": "aac", "channel_layout": "stereo"},
    ],
    "format": {"duration": "6.0"},
}
URL = "http://host/live/user/secret/1.ts"


def fake_response(status=200, chunks=(b"x" * 1000,), content_type="video/mp2t", url=URL):
    response = MagicMock()
    response.status_code = status
    response.reason = "Forbidden" if status == 403 else "OK"
    response.headers = {"Content-Type": content_type}
    response.url = url
    response.iter_content.return_value = iter(chunks)
    response.__enter__.return_value = response
    return response


class FfprobeTests(SimpleTestCase):
    def test_summary_uses_the_playback_stat_keys(self):
        self.assertEqual(
            stream_probe.summarize(FFPROBE_JSON),
            {
                "video_codec": "h264",
                "width": 1920,
                "height": 1080,
                "source_fps": 50.0,
                "audio_codec": "aac",
                "audio_channels": "stereo",
                "resolution": "1920x1080",
            },
        )

    def test_errors_hide_the_url_and_timeouts_are_reported(self):
        failed = subprocess.CompletedProcess([], 1, "", f"{URL}: Server returned 403 Forbidden\n")
        with patch("subprocess.run", return_value=failed):
            with self.assertRaisesMessage(stream_probe.ProbeError, "<stream>: Server returned 403"):
                stream_probe.run_ffprobe(URL)
        with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("ffprobe", 20)):
            with self.assertRaisesMessage(stream_probe.ProbeError, "No answer"):
                stream_probe.run_ffprobe(URL)
        audio_only = subprocess.CompletedProcess([], 0, '{"streams": [{"codec_type": "audio"}]}', "")
        with patch("subprocess.run", return_value=audio_only):
            with self.assertRaisesMessage(stream_probe.ProbeError, "No video"):
                stream_probe.run_ffprobe("/tmp/sample.ts")

    def test_error_classes(self):
        self.assertTrue(stream_probe.ProbeError("Server returned 503").transient)
        self.assertTrue(stream_probe.ProbeError("Server returned 503").overload)
        self.assertFalse(stream_probe.ProbeError("Server returned 403 Forbidden").transient)
        self.assertTrue(stream_probe.ProbeError("Server returned 429 Too Many Requests").overload)
        self.assertFalse(stream_probe.ProbeError("Server returned 404 Not Found").overload)


class SampleTests(SimpleTestCase):
    def test_download_measures_startup_and_bitrate(self):
        with patch("requests.get", return_value=fake_response()):
            path, startup_ms, bitrate = stream_probe.download_sample(URL, "UA", seconds=0)
        try:
            self.assertEqual(os.path.getsize(path), 1000)
            self.assertGreaterEqual(startup_ms, 0)
            self.assertGreater(bitrate, 0)
        finally:
            os.unlink(path)

    def test_download_errors_and_playlists(self):
        with patch("requests.get", return_value=fake_response(status=403)):
            with self.assertRaisesMessage(stream_probe.ProbeError, "Server returned 403 Forbidden"):
                stream_probe.download_sample(URL)
        with patch("requests.get", return_value=fake_response(chunks=())):
            with self.assertRaisesMessage(stream_probe.ProbeError, "no data"):
                stream_probe.download_sample(URL)
        playlist = fake_response(content_type="application/vnd.apple.mpegurl")
        with patch("requests.get", return_value=playlist):
            self.assertIsNone(stream_probe.download_sample(URL))
        error = stream_probe.requests.ConnectionError(f"Connection reset by peer for {URL}")
        with patch("requests.get", side_effect=error):
            with self.assertRaises(stream_probe.ProbeError) as raised:
                stream_probe.download_sample(URL)
        self.assertEqual(str(raised.exception), "Connection reset by the server")
        self.assertTrue(raised.exception.transient)
        timeout = stream_probe.requests.ReadTimeout("HTTPSConnectionPool(host='cdn.example'): Read timed out.")
        with patch("requests.get", side_effect=timeout):
            with self.assertRaisesMessage(stream_probe.ProbeError, "No data within 10 seconds"):
                stream_probe.download_sample(URL)

    def test_picture_stats_find_black_frozen_and_frame_rate(self):
        output = "\n".join(
            ["lavfi.signalstats.YAVG=16.2"] * 100
            + ["lavfi.freezedetect.freeze_start=0.5", "lavfi.freezedetect.freeze_duration=2.0",
               "lavfi.freezedetect.freeze_end=2.5", "lavfi.freezedetect.freeze_start=2.6"]
        )
        stats = stream_probe.parse_picture_stats(output, 5.0)
        self.assertEqual(stats["brightness"], 16.2)
        self.assertEqual(stats["measured_fps"], 20.0)
        # 2.0 s closed plus 2.4 s still frozen at the end of 5 s.
        self.assertTrue(stats["frozen"])
        self.assertEqual(stream_probe.parse_picture_stats("no stats", 5.0), {})

    def test_check_url_combines_sample_results(self):
        with patch.object(stream_probe, "download_sample", return_value=("/tmp/x.ts", 420, 5800)), \
                patch.object(stream_probe, "run_ffprobe", return_value=(FFPROBE_JSON, 30)), \
                patch.object(stream_probe, "analyse_picture",
                             return_value={"brightness": 17.0, "measured_fps": 12.5, "frozen": False}), \
                patch("os.unlink"):
            stats, details = stream_probe.check_url(URL, low_fps=20)
        self.assertEqual(stats["source_bitrate"], 5800)
        self.assertEqual(
            details,
            {"startup_ms": 420, "brightness": 17.0, "black": True, "frozen": False,
             "measured_fps": 12.5, "low_fps": True},
        )
        with patch.object(stream_probe, "download_sample", return_value=None), \
                patch.object(stream_probe, "run_ffprobe", return_value=(FFPROBE_JSON, 900)) as probe:
            stats, details = stream_probe.check_url("http://host/list.m3u8")
        probe.assert_called_once_with("http://host/list.m3u8", None, url="http://host/list.m3u8")
        self.assertEqual(details, {"startup_ms": 900})
        with_rate = {**FFPROBE_JSON, "format": {"duration": "6.0", "bit_rate": "4200000"}}
        with patch.object(stream_probe, "download_sample", return_value=("/tmp/x.ts", 420, 22000)), \
                patch.object(stream_probe, "run_ffprobe", return_value=(with_rate, 30)), \
                patch.object(stream_probe, "analyse_picture", return_value={}), \
                patch("os.unlink"):
            stats, _details = stream_probe.check_url(URL)
        # The sample's media duration wins over the burst download rate.
        self.assertEqual(stats["source_bitrate"], 4200)


class ProbeAndSortTests(TestCase):
    def setUp(self):
        cache.delete(STREAM_TEST_LOCK)
        self.account = M3UAccount.objects.create(name="probe-account", account_type="XC")
        self.profile = self.account.profiles.get(is_default=True)
        self.channel = Channel.objects.create(name="ZDF", channel_number=3)
        self.streams = []
        for index, name in enumerate(("ZDF SD", "ZDF FHD", "ZDF 4K", "ZDF HD")):
            stream = Stream.objects.create(
                name=name, url=f"http://example.test/{index}", m3u_account=self.account
            )
            ChannelStream.objects.create(channel=self.channel, stream=stream, order=index)
            self.streams.append(stream)

    def probe(self, stream, *, profile=True, reserved=True, check=None):
        with patch(
            "apps.proxy.live_proxy.url_utils.pick_stream_m3u_profile_id",
            return_value=self.profile.id if profile else None,
        ), patch(
            "apps.m3u.connection_pool.reserve_profile_slot",
            return_value=(reserved, 1, None),
        ), patch(
            "apps.m3u.connection_pool.release_profile_slot"
        ) as release, patch(
            "apps.proxy.live_proxy.url_utils._resolve_live_stream_url",
            return_value="http://example.test/play",
        ), patch.object(stream_probe, "check_url", side_effect=check) as checked, \
                patch.object(stream_probe, "RETRY_DELAY_SECONDS", 0):
            outcome = stream_probe.probe_stream(stream, redis_client=object())
        return outcome, release, checked

    def test_probe_stores_results_retries_transient_errors_and_frees_the_slot(self):
        stream = self.streams[1]
        good = (stream_probe.summarize(FFPROBE_JSON), {"startup_ms": 850, "black": False})
        (result, error), release, checked = self.probe(
            stream, check=[stream_probe.ProbeError("Server returned 503"), good]
        )
        self.assertEqual((result, error), (stream_probe.OK, None))
        self.assertEqual(checked.call_count, 2)
        release.assert_called_once_with(self.profile.id, ANY)
        stream.refresh_from_db()
        self.assertEqual(stream.stream_stats["resolution"], "1920x1080")
        self.assertEqual(stream.stream_stats["probe"]["startup_ms"], 850)

        for _attempt in (1, 2):
            (result, error), release, checked = self.probe(
                stream, check=stream_probe.ProbeError("Server returned 403 Forbidden")
            )
            self.assertEqual(result, stream_probe.FAILED)
            self.assertEqual(checked.call_count, 1)
            release.assert_called_once()
        stream.refresh_from_db()
        self.assertEqual(stream.stream_stats["probe"]["failures"], 2)
        # Earlier technical values stay; only the test result changes.
        self.assertEqual(stream.stream_stats["resolution"], "1920x1080")

    def test_busy_profiles_are_skipped_without_touching_stats(self):
        for kwargs in ({"profile": False}, {"reserved": False}):
            (result, _error), release, checked = self.probe(self.streams[0], **kwargs)
            self.assertEqual(result, stream_probe.BUSY)
            release.assert_not_called()
            checked.assert_not_called()
        self.streams[0].refresh_from_db()
        self.assertNotIn("probe", self.streams[0].stream_stats or {})

    def set_stats(self, stream, **stats):
        stream.stream_stats = stats
        stream.save(update_fields=["stream_stats"])

    def order(self):
        return list(
            ChannelStream.objects.filter(channel=self.channel)
            .order_by("order")
            .values_list("stream__name", flat=True)
        )

    def test_sorting_puts_working_streams_first_and_problems_last(self):
        sd, fhd, uhd, hd = self.streams
        self.set_stats(sd, height=576, probe={"ok": True, "startup_ms": 300})
        self.set_stats(fhd, height=1080, probe={"ok": True, "startup_ms": 900, "black": True})
        self.set_stats(uhd, height=2160, probe={"ok": False, "error": "403"})
        self.set_stats(hd, height=720, probe={"ok": True, "startup_ms": 400, "low_fps": True})
        self.assertTrue(stream_probe.sort_channel_streams(self.channel, "quality"))
        self.assertEqual(self.order(), ["ZDF SD", "ZDF HD", "ZDF FHD", "ZDF 4K"])
        self.set_stats(hd, height=720, probe={"ok": True, "startup_ms": 100})
        self.assertTrue(stream_probe.sort_channel_streams(self.channel, "startup"))
        self.assertEqual(self.order(), ["ZDF HD", "ZDF SD", "ZDF FHD", "ZDF 4K"])
        self.assertFalse(stream_probe.sort_channel_streams(self.channel, "startup"))
        self.assertFalse(stream_probe.sort_channel_streams(self.channel, "none"))

    def test_run_tests_each_stream_once_and_pauses_overloaded_accounts(self):
        other = Channel.objects.create(name="ZDF copy", channel_number=603)
        ChannelStream.objects.create(channel=other, stream=self.streams[0], order=0)
        results = iter([
            (stream_probe.OK, None),
            (stream_probe.FAILED, stream_probe.ProbeError("Server returned 429")),
            (stream_probe.BUSY, None),
            (stream_probe.OK, None),
        ])

        def fake_probe(stream, low_fps, sample_seconds):
            outcome = next(results)
            if outcome[0] == stream_probe.OK:
                stream.stream_stats = {"probe": {"ok": True, "black": stream.name == "ZDF SD"}}
            return outcome

        with patch.object(stream_probe, "probe_stream", side_effect=fake_probe) as probe, \
                patch.object(stream_probe.time, "sleep") as sleep:
            summary = stream_probe.test_channels([self.channel.id, other.id], "quality")
        self.assertEqual(probe.call_count, 4)
        self.assertEqual(
            {key: summary[key] for key in ("total", "ok", "failed", "busy", "black")},
            {"total": 4, "ok": 2, "failed": 1, "busy": 1, "black": 1},
        )
        waits = [call.args[0] for call in sleep.call_args_list]
        self.assertTrue(any(wait > stream_probe.ACCOUNT_SPACING_SECONDS for wait in waits))

    def test_endpoint_starts_one_run_at_a_time(self):
        client = APIClient()
        client.force_authenticate(
            get_user_model().objects.create_user(username="probe-admin", user_level=10)
        )
        url = "/api/channels/channels/test-streams/"
        with patch("apps.channels.tasks.test_channel_streams.delay") as delay:
            response = client.post(url, {"channel_ids": [self.channel.id], "sort": "quality"}, format="json")
            self.assertEqual(response.status_code, 202, response.data)
            delay.assert_called_once_with([self.channel.id], "quality", 20)
            response = client.post(url, {"channel_ids": [self.channel.id]}, format="json")
            self.assertEqual(response.status_code, 409)
        cache.delete(STREAM_TEST_LOCK)
        self.assertEqual(client.post(url, {"channel_ids": []}, format="json").status_code, 400)
        self.assertEqual(
            client.post(url, {"channel_ids": [1], "low_fps_threshold": 0}, format="json").status_code,
            400,
        )

    def test_saved_settings_are_the_defaults_of_every_test(self):
        from core.models import CoreSettings

        self.addCleanup(CoreSettings.set_stream_test_settings, None)
        client = APIClient()
        client.force_authenticate(
            get_user_model().objects.create_user(username="probe-settings", user_level=10)
        )
        url = "/api/channels/channels/stream-test-settings/"
        self.assertEqual(
            client.get(url).data, {"low_fps": 20, "sample_seconds": 6, "sort": "quality"}
        )
        saved = {"low_fps": 25, "sample_seconds": 10, "sort": "startup"}
        self.assertEqual(client.put(url, saved, format="json").data, saved)
        self.assertEqual(
            client.put(url, {**saved, "sample_seconds": 99}, format="json").status_code, 400
        )

        with patch("apps.channels.tasks.test_channel_streams.delay") as delay:
            response = client.post(
                "/api/channels/channels/test-streams/", {"channel_ids": [self.channel.id]}, format="json"
            )
            self.assertEqual(response.status_code, 202, response.data)
            delay.assert_called_once_with([self.channel.id], "startup", 25)
        cache.delete(STREAM_TEST_LOCK)

        with patch.object(
            stream_probe, "probe_stream", return_value=(stream_probe.BUSY, None)
        ) as probe, patch.object(stream_probe.time, "sleep"):
            stream_probe.test_channels([self.channel.id])
        self.assertEqual(probe.call_args.kwargs, {"low_fps": 25, "sample_seconds": 10})

        user = get_user_model().objects.create_user(username="probe-viewer", user_level=1)
        client.force_authenticate(user)
        self.assertEqual(client.get(url).status_code, 403)
