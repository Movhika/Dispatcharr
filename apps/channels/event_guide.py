"""The programme guide of event channels, built from the event itself.

Event channels need no guide source: an event group stores the title,
competition, start and end of each event, and the channels of an event
category with its own event channels parse the name of their stream. The
guide shows the event between its start and end with upcoming and ended
entries around it. A guide assigned to the channel by hand still wins.
"""

from dataclasses import dataclass
from datetime import timedelta

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
