"""The programme guide of event channels, built from the event itself.

Event channels need no guide source: an event group stores the title,
competition, start and end of each event, and the channels of an event
category with its own event channels parse the name of their stream. The
guide shows the event between its start and end with upcoming and ended
entries around it. A guide assigned to the channel by hand still wins.
"""

from dataclasses import dataclass
from datetime import timedelta

from django.db import models
from django.utils import timezone

from apps.m3u.event_parser import (
    DEFAULT_DURATION_MINUTES,
    NONE,
    is_event_relation,
    normalize_config,
    parse_event,
)


@dataclass(frozen=True)
class EventGuide:
    title: str
    start: object = None
    end: object = None
    competition: str = ""


def event_guides_for_channels(channels):
    """Map channel id to its EventGuide, with a few queries for any number of channels."""
    from .models import ChannelGroupM3UAccount, ChannelStream, EventChannel

    channels = list(channels)
    ids = [channel.id for channel in channels]
    guides = {
        event_channel.channel_id: EventGuide(
            event_channel.title,
            event_channel.start,
            event_channel.end,
            event_channel.competition,
        )
        for event_channel in EventChannel.objects.filter(channel_id__in=ids)
    }
    relation_ids = {
        channel.auto_created_from_id
        for channel in channels
        if channel.id not in guides and getattr(channel, "auto_created_from_id", None)
    }
    relations = {
        relation.id: relation
        for relation in ChannelGroupM3UAccount.objects.filter(id__in=relation_ids)
        if is_event_relation(relation)
    }
    slot_channels = [
        channel for channel in channels if getattr(channel, "auto_created_from_id", None) in relations
    ]
    first_streams = {}
    for link in (
        ChannelStream.objects.filter(channel_id__in=[c.id for c in slot_channels])
        .select_related("stream")
        .order_by("channel_id", "order", "id")
    ):
        first_streams.setdefault(link.channel_id, link.stream.name)
    for channel in slot_channels:
        name = first_streams.get(channel.id)
        if not name:
            continue
        relation = relations[channel.auto_created_from_id]
        try:
            config = normalize_config(relation.custom_properties or {})
        except ValueError:
            config = normalize_config({})
        event = parse_event(name, config)
        if event.status != NONE and event.title:
            guides[channel.id] = EventGuide(event.title, event.start, event.end)
    return guides


def event_status(guide, now=None):
    """live, upcoming, ended, or unknown when the event has no start."""
    if guide.start is None:
        return "unknown"
    now = now or timezone.now()
    end = guide.end or guide.start + timedelta(minutes=DEFAULT_DURATION_MINUTES)
    if now < guide.start:
        return "upcoming"
    return "live" if now < end else "ended"


STATUS_ORDER = {"live": 0, "upcoming": 1, "unknown": 2, "ended": 3}


def event_channel_rows(now=None):
    """Every channel whose guide comes from an event, live events first."""
    from .models import Channel, ChannelGroupM3UAccount, EventChannel

    now = now or timezone.now()
    group_names = dict(EventChannel.objects.values_list("channel_id", "group__name"))
    event_relations = [
        relation
        for relation in ChannelGroupM3UAccount.objects.filter(
            metadata_defaults__contains={"is_event": True}
        ).select_related("m3u_account", "channel_group")
        if is_event_relation(relation)
    ]
    relation_names = {
        relation.id: f"{relation.m3u_account.name} · {relation.channel_group.name}"
        for relation in event_relations
    }
    channels = list(
        Channel.objects.filter(id__in=list(group_names))
        | Channel.objects.filter(auto_created_from_id__in=list(relation_names))
    )
    guides = event_guides_for_channels(channels)
    stream_counts = dict(
        Channel.objects.filter(id__in=[channel.id for channel in channels])
        .annotate(count=models.Count("channelstream"))
        .values_list("id", "count")
    )
    rows = []
    for channel in channels:
        guide = guides.get(channel.id)
        if guide is None:
            continue
        if channel.id in group_names:
            source, source_name = "group", group_names[channel.id]
        else:
            source, source_name = "category", relation_names.get(channel.auto_created_from_id, "")
        rows.append({
            "channel_id": channel.id,
            "channel_number": channel.channel_number,
            "channel_name": channel.name,
            "source": source,
            "source_name": source_name,
            "title": guide.title,
            "competition": guide.competition,
            "start": guide.start,
            "end": guide.end,
            "status": event_status(guide, now),
            "stream_count": stream_counts.get(channel.id, 0),
        })
    far = now + timedelta(days=36500)
    rows.sort(key=lambda row: (
        STATUS_ORDER[row["status"]], row["start"] or far, row["channel_number"] or 0
    ))
    return rows


def _blocks(start, end, step, backwards=False):
    """Cut [start, end) into blocks of `step`, aligned to end when backwards."""
    blocks = []
    if backwards:
        cursor = end
        while cursor > start:
            block_start = max(start, cursor - step)
            blocks.append((block_start, cursor))
            cursor = block_start
        return list(reversed(blocks))
    cursor = start
    while cursor < end:
        block_end = min(end, cursor + step)
        blocks.append((cursor, block_end))
        cursor = block_end
    return blocks


def event_programs(guide, window_start, window_end, block_hours=4, max_programs=None):
    """Programmes of one event channel between window_start and window_end."""
    step = timedelta(hours=block_hours or 4)
    description = f"{guide.competition}: {guide.title}" if guide.competition else guide.title
    programs = []

    def add(start, end, title, desc, live=False):
        program = {
            "start_time": start,
            "end_time": end,
            "title": title,
            "description": desc,
            "custom_properties": {"live": True} if live else {},
        }
        if guide.competition and live:
            program["sub_title"] = guide.competition
        programs.append(program)

    if guide.start is None:
        for start, end in _blocks(window_start, window_end, step):
            add(start, end, guide.title, description)
    else:
        event_end = guide.end or guide.start + timedelta(minutes=DEFAULT_DURATION_MINUTES)
        for start, end in _blocks(window_start, min(guide.start, window_end), step, backwards=True):
            add(start, end, f"Upcoming: {guide.title}", f"Upcoming: {description}")
        if guide.start < window_end and event_end > window_start:
            add(guide.start, event_end, guide.title, description, live=True)
        for start, end in _blocks(max(event_end, window_start), window_end, step):
            add(start, end, f"Ended: {guide.title}", f"Ended: {description}")
    programs.sort(key=lambda program: program["start_time"])
    if max_programs is not None:
        programs = programs[:max_programs]
    return programs
