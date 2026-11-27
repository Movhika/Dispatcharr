"""Test provider streams and order channel streams by the result.

A test uses one free connection slot of the stream's account profile, the
same way playback does, so it never pushes an account over its connection
limit: streams whose profiles are all busy are skipped.

For MPEG-TS streams the test downloads a short sample over that single
connection, which gives the start time and the real bitrate, and closes the
connection before analysing the sample locally: ffprobe for codecs and
resolution, ffmpeg for brightness (black screen), frozen video and the frame
rate actually delivered. HLS playlists are checked with ffprobe directly.
Results are merged into ``Stream.stream_stats`` next to the values playback
records.
"""

import json
import logging
import os
import re
import subprocess
import tempfile
import time

import requests
from django.db import transaction
from django.utils import timezone

logger = logging.getLogger(__name__)

FFPROBE = "ffprobe"
FFMPEG = "ffmpeg"
PROBE_TIMEOUT_SECONDS = 20
SAMPLE_SECONDS = 6
SAMPLE_MAX_BYTES = 64 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 10
READ_TIMEOUT_SECONDS = 10
ANALYSE_TIMEOUT_SECONDS = 60
RETRY_DELAY_SECONDS = 2
ACCOUNT_HOLD_SECONDS = 10
ACCOUNT_SPACING_SECONDS = 1.5
DEFAULT_LOW_FPS = 20
DEFAULT_TEST_SETTINGS = {
    "low_fps": DEFAULT_LOW_FPS,
    "sample_seconds": SAMPLE_SECONDS,
    "sort": "quality",
}
# Average luma in TV range: 16 is pure black, normal pictures are about
# 40-90. Below 20 are black screens, dark slates and off-air pictures.
BLACK_LUMA_THRESHOLD = 20
# Frozen when one freeze covers most of the sample.
FROZEN_SHARE = 0.8
SORT_MODES = ("none", "quality", "startup")

OK = "ok"
FAILED = "failed"
BUSY = "busy"

TRANSIENT_MARKERS = (
    "500", "502", "503", "504", "520", "5XX",
    "Connection reset", "Broken pipe", "Stream ends prematurely",
    "Input/output error", "IncompleteRead", "ChunkedEncodingError",
)
OVERLOAD_MARKERS = ("429", "Too Many Requests", "500", "502", "503", "520", "5XX")


class ProbeError(Exception):
    @property
    def transient(self):
        text = str(self)
        return "404" not in text and any(marker in text for marker in TRANSIENT_MARKERS)

    @property
    def overload(self):
        return any(marker in str(self) for marker in OVERLOAD_MARKERS)


def _clean_error(text, url):
    # Errors repeat the URL, which carries the account credentials.
    text = (text or "").replace(url, "<stream>").strip()
    return text.splitlines()[-1][:200] if text else ""


def run_ffprobe(source, user_agent=None, timeout=PROBE_TIMEOUT_SECONDS, url=None):
    """Return ffprobe's JSON for a URL or a sample file and the time it took."""
    command = [
        FFPROBE,
        "-v", "error",
        "-hide_banner",
        "-print_format", "json",
        "-show_streams",
        "-show_format",
        "-analyzeduration", "5000000",
        "-probesize", "5000000",
    ]
    if "://" in source:
        command += ["-rw_timeout", str((timeout - 5) * 1_000_000)]
        if user_agent:
            command += ["-user_agent", user_agent]
    command.append(source)
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=timeout, check=False
        )
    except subprocess.TimeoutExpired as exc:
        raise ProbeError(f"No answer within {timeout} seconds") from exc
    except OSError as exc:
        raise ProbeError(f"ffprobe could not start: {exc}") from exc
    elapsed = int((time.monotonic() - started) * 1000)
    if completed.returncode != 0:
        raise ProbeError(_clean_error(completed.stderr, url or source) or "ffprobe failed")
    try:
        data = json.loads(completed.stdout or "{}")
    except ValueError as exc:
        raise ProbeError("ffprobe returned no readable result") from exc
    if not any(s.get("codec_type") == "video" for s in data.get("streams", [])):
        raise ProbeError("No video found")
    return data, elapsed


def _request_error(exc):
    """A short message for a failed download that names no host or URL."""
    text = str(exc)
    if isinstance(exc, requests.ConnectTimeout):
        return "Connection timed out"
    if isinstance(exc, requests.ReadTimeout):
        return f"No data within {READ_TIMEOUT_SECONDS} seconds"
    if isinstance(exc, requests.exceptions.ChunkedEncodingError):
        return "Stream ends prematurely"
    if "reset" in text.lower():
        return "Connection reset by the server"
    if isinstance(exc, requests.ConnectionError):
        return "Connection failed"
    return type(exc).__name__


def download_sample(url, user_agent=None, seconds=SAMPLE_SECONDS, directory=None):
    """Download a few seconds of a stream over one connection.

    Returns (path, startup_ms, bitrate_kbps), or None for an HLS playlist,
    which needs ffprobe to follow its segments.
    """
    headers = {"User-Agent": user_agent} if user_agent else {}
    started = time.monotonic()
    try:
        response = requests.get(
            url,
            headers=headers,
            stream=True,
            timeout=(CONNECT_TIMEOUT_SECONDS, READ_TIMEOUT_SECONDS),
        )
    except requests.RequestException as exc:
        raise ProbeError(_request_error(exc)) from exc
    with response:
        if response.status_code >= 400:
            raise ProbeError(f"Server returned {response.status_code} {response.reason or ''}".strip())
        content_type = response.headers.get("Content-Type", "").lower()
        if "mpegurl" in content_type or response.url.split("?")[0].endswith(".m3u8"):
            return None
        handle, path = tempfile.mkstemp(suffix=".ts", dir=directory)
        size = 0
        first_byte = None
        try:
            with os.fdopen(handle, "wb") as sample:
                for chunk in response.iter_content(chunk_size=65536):
                    if not chunk:
                        continue
                    now = time.monotonic()
                    if first_byte is None:
                        first_byte = now
                    sample.write(chunk)
                    size += len(chunk)
                    if now - first_byte >= seconds or size >= SAMPLE_MAX_BYTES:
                        break
        except requests.RequestException as exc:
            os.unlink(path)
            raise ProbeError(_request_error(exc)) from exc
        except BaseException:
            os.unlink(path)
            raise
    if first_byte is None or size == 0:
        os.unlink(path)
        raise ProbeError("Stream ends prematurely: no data received")
    duration = max(time.monotonic() - first_byte, 0.001)
    startup_ms = int((first_byte - started) * 1000)
    return path, startup_ms, int(size * 8 / duration / 1000)


_LUMA = re.compile(r"lavfi\.signalstats\.YAVG=([\d.]+)")
_FREEZE_DURATION = re.compile(r"lavfi\.freezedetect\.freeze_duration=([\d.]+)")
_FREEZE_START = re.compile(r"lavfi\.freezedetect\.freeze_start=([\d.]+)")
_FREEZE_END = re.compile(r"lavfi\.freezedetect\.freeze_end=([\d.]+)")


def parse_picture_stats(output, duration):
    """Read average brightness, frame count and frozen video from ffmpeg output."""
    lumas = [float(value) for value in _LUMA.findall(output)]
    if not lumas:
        return {}
    frozen_seconds = sum(float(value) for value in _FREEZE_DURATION.findall(output))
    starts = [float(value) for value in _FREEZE_START.findall(output)]
    if len(starts) > len(_FREEZE_END.findall(output)) and duration:
        # A freeze that lasts until the end of the sample has no end line.
        frozen_seconds += max(duration - starts[-1], 0)
    result = {
        "brightness": round(sum(lumas) / len(lumas), 1),
        "frames": len(lumas),
    }
    if duration:
        result["measured_fps"] = round(len(lumas) / duration, 1)
        result["frozen"] = frozen_seconds >= duration * FROZEN_SHARE
    return result


def analyse_picture(path, duration):
    """Measure brightness, freezes and delivered frames of a local sample."""
    command = [
        FFMPEG,
        "-hide_banner",
        "-nostats",
        "-i", path,
        "-map", "0:v:0",
        "-vf",
        "freezedetect=n=0.003:d=2,signalstats,"
        "metadata=mode=print:key=lavfi.signalstats.YAVG,"
        "metadata=mode=print:key=lavfi.freezedetect.freeze_start,"
        "metadata=mode=print:key=lavfi.freezedetect.freeze_duration,"
        "metadata=mode=print:key=lavfi.freezedetect.freeze_end",
        "-an",
        "-f", "null",
        "-",
    ]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=ANALYSE_TIMEOUT_SECONDS,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        logger.warning("Picture analysis of a stream sample failed: %s", type(exc).__name__)
        return {}
    return parse_picture_stats(completed.stderr or "", duration)


def _fps(value):
    try:
        numerator, denominator = (value or "0/0").split("/")
        return round(int(numerator) / int(denominator), 2) if int(denominator) else None
    except (ValueError, ZeroDivisionError):
        return None


def summarize(data):
    """Map ffprobe output to the keys playback stores in stream_stats."""
    streams = data.get("streams", [])
    video = next(s for s in streams if s.get("codec_type") == "video")
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    stats = {
        "video_codec": video.get("codec_name"),
        "width": video.get("width"),
        "height": video.get("height"),
        "source_fps": _fps(video.get("avg_frame_rate")) or _fps(video.get("r_frame_rate")),
        "audio_codec": audio.get("codec_name"),
        "audio_channels": audio.get("channel_layout"),
    }
    if stats["width"] and stats["height"]:
        stats["resolution"] = f"{stats['width']}x{stats['height']}"
    bitrate = (data.get("format") or {}).get("bit_rate")
    if bitrate and str(bitrate).isdigit():
        stats["source_bitrate"] = int(bitrate) // 1000
    return {key: value for key, value in stats.items() if value is not None}


def stream_test_settings():
    """Saved defaults of stream tests merged over the built-in ones."""
    from core.models import CoreSettings

    saved = CoreSettings.get_stream_test_settings() or {}
    return {
        **DEFAULT_TEST_SETTINGS,
        **{key: value for key, value in saved.items() if key in DEFAULT_TEST_SETTINGS},
    }


def check_url(url, user_agent=None, low_fps=DEFAULT_LOW_FPS, sample_seconds=SAMPLE_SECONDS):
    """Test one URL; returns (stats, probe details) or raises ProbeError."""
    sample = download_sample(url, user_agent, seconds=sample_seconds)
    if sample is None:
        data, elapsed = run_ffprobe(url, user_agent, url=url)
        return summarize(data), {"startup_ms": elapsed}
    path, startup_ms, bitrate = sample
    try:
        data, _elapsed = run_ffprobe(path, url=url)
        stats = summarize(data)
        # Providers send a buffered burst first, so the download rate is too
        # high; the sample's own duration gives the real bitrate.
        stats.setdefault("source_bitrate", bitrate)
        try:
            duration = float((data.get("format") or {}).get("duration") or 0)
        except ValueError:
            duration = 0
        picture = analyse_picture(path, duration)
    finally:
        os.unlink(path)
    details = {"startup_ms": startup_ms}
    if "brightness" in picture:
        details["brightness"] = picture["brightness"]
        details["black"] = picture["brightness"] < BLACK_LUMA_THRESHOLD
    if "frozen" in picture:
        details["frozen"] = picture["frozen"]
    fps = picture.get("measured_fps") or stats.get("source_fps")
    if fps:
        details["measured_fps"] = fps
        details["low_fps"] = fps < low_fps
    return stats, details


def _store(stream, stats, probe):
    current = dict(stream.stream_stats or {})
    current.update(stats)
    current["probe"] = probe
    stream.stream_stats = current
    stream.stream_stats_updated_at = timezone.now()
    stream.save(update_fields=["stream_stats", "stream_stats_updated_at"])


def probe_stream(
    stream, redis_client=None, low_fps=DEFAULT_LOW_FPS, retries=1, sample_seconds=SAMPLE_SECONDS
):
    """Test one stream with a free profile slot.

    Returns (result, error); result is ok, failed or busy.
    """
    from apps.m3u.connection_pool import release_profile_slot, reserve_profile_slot
    from apps.m3u.models import M3UAccountProfile
    from apps.proxy.live_proxy.url_utils import (
        _resolve_live_stream_url,
        pick_stream_m3u_profile_id,
    )
    from core.utils import RedisClient

    redis_client = redis_client or RedisClient.get_client()
    account = stream.m3u_account
    profile_id = pick_stream_m3u_profile_id(stream)
    if profile_id is None:
        return BUSY, None
    profile = M3UAccountProfile.objects.get(id=profile_id)
    reserved, _count, _reason = reserve_profile_slot(profile, redis_client)
    if not reserved:
        return BUSY, None
    tested_at = timezone.now().isoformat()
    previous = (stream.stream_stats or {}).get("probe") or {}
    try:
        url = _resolve_live_stream_url(stream, account, profile)
        if not url:
            raise ProbeError("No stream URL for this account profile")
        attempt = 0
        while True:
            try:
                stats, details = check_url(
                    url, account.get_user_agent_string(), low_fps, sample_seconds
                )
                break
            except ProbeError as exc:
                if attempt >= retries or not exc.transient:
                    raise
                attempt += 1
                time.sleep(RETRY_DELAY_SECONDS)
    except ProbeError as exc:
        _store(stream, {}, {
            "ok": False,
            "error": str(exc),
            "tested_at": tested_at,
            "failures": int(previous.get("failures") or 0) + 1,
        })
        return FAILED, exc
    finally:
        release_profile_slot(profile.id, redis_client)
    _store(stream, stats, {"ok": True, "tested_at": tested_at, **details})
    return OK, None


def _number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def problem_rank(stream):
    """0 working, 1 untested, 2 low frame rate, 3 frozen, 4 black, 5 failed."""
    probe = (stream.stream_stats or {}).get("probe") or {}
    if probe.get("ok") is False:
        return 5
    if not probe.get("ok"):
        return 1
    if probe.get("black"):
        return 4
    if probe.get("frozen"):
        return 3
    if probe.get("low_fps"):
        return 2
    return 0


def stream_sort_key(stream, mode, position):
    """Working streams first, problems after them by severity; then by the mode."""
    stats = stream.stream_stats or {}
    probe = stats.get("probe") or {}
    rank = problem_rank(stream)
    height = -_number(stats.get("height"))
    fps = -_number(probe.get("measured_fps") or stats.get("source_fps"))
    bitrate = -_number(stats.get("source_bitrate"))
    startup = _number(probe.get("startup_ms")) or float("inf")
    if mode == "startup":
        return (rank, startup, height, position)
    return (rank, height, fps, bitrate, startup, position)


def sort_channel_streams(channel, mode):
    """Reorder the streams of one channel; returns whether the order changed."""
    from apps.channels.models import ChannelStream

    if mode not in ("quality", "startup"):
        return False
    rows = list(
        ChannelStream.objects.filter(channel=channel)
        .select_related("stream")
        .order_by("order", "id")
    )
    ordered = [
        row
        for _, row in sorted(
            enumerate(rows),
            key=lambda pair: stream_sort_key(pair[1].stream, mode, pair[0]),
        )
    ]
    if ordered == rows:
        return False
    with transaction.atomic():
        for order, row in enumerate(ordered):
            if row.order != order:
                row.order = order
                row.save(update_fields=["order"])
    return True


def _wait_for_account(account_id, held_until, last_end):
    """Pause after overload errors and leave providers a moment between tests."""
    now = time.monotonic()
    wait = max(
        held_until.get(account_id, 0) - now,
        last_end.get(account_id, 0) + ACCOUNT_SPACING_SECONDS - now,
        0,
    )
    if wait:
        time.sleep(wait)


def test_channels(channel_ids, sort="none", progress=None, low_fps=None, sample_seconds=None):
    """Test every stream of the channels once, then sort them if asked.

    Missing values come from the saved stream test settings.
    """
    from apps.channels.models import Channel, Stream

    settings = stream_test_settings()
    low_fps = low_fps or settings["low_fps"]
    sample_seconds = sample_seconds or settings["sample_seconds"]

    channels = list(Channel.objects.filter(id__in=channel_ids).order_by("channel_number", "id"))
    stream_ids = list(
        dict.fromkeys(
            Stream.objects.filter(channels__in=channels, m3u_account__isnull=False)
            .order_by("channelstream__channel__channel_number", "channelstream__order")
            .values_list("id", flat=True)
        )
    )
    summary = {
        "total": len(stream_ids),
        OK: 0, FAILED: 0, BUSY: 0,
        "black": 0, "frozen": 0, "low_fps": 0,
        "sorted": 0,
    }
    held_until, last_end = {}, {}
    for index, stream_id in enumerate(stream_ids):
        stream = Stream.objects.select_related("m3u_account").get(id=stream_id)
        account_id = stream.m3u_account_id
        if not stream.m3u_account or not stream.m3u_account.is_active:
            summary[BUSY] += 1
            continue
        _wait_for_account(account_id, held_until, last_end)
        try:
            result, error = probe_stream(stream, low_fps=low_fps, sample_seconds=sample_seconds)
        except Exception:  # one broken stream must not end the run
            logger.exception("Stream test failed unexpectedly for stream %s", stream_id)
            result, error = FAILED, None
        last_end[account_id] = time.monotonic()
        if error is not None and error.overload:
            held_until[account_id] = last_end[account_id] + ACCOUNT_HOLD_SECONDS
        summary[result] += 1
        if result == OK:
            probe = stream.stream_stats.get("probe", {})
            for flag in ("black", "frozen", "low_fps"):
                summary[flag] += bool(probe.get(flag))
        if progress:
            progress(index + 1, summary, stream.name)
    for channel in channels:
        summary["sorted"] += sort_channel_streams(channel, sort)
    return summary
