"""Build the channels of event groups: one channel per event, all providers.

An event group reads the event categories it lists, parses their stream
names with each category's event settings, groups the events that show the
same match and keeps one channel per current event. Channels of events that
ended or disappeared are removed; channel numbers of kept events stay.
"""

from datetime import timedelta
import logging

from django.db import transaction
from django.utils import timezone

from apps.m3u.event_parser import LIVE, UNKNOWN, UPCOMING, normalize_config, parse_event

from .event_matching import (
    DEFAULT_TEAM_ALIASES,
    START_TOLERANCE,
    EventItem,
    cluster_events,
    team_alias_map,
)

logger = logging.getLogger(__name__)

CHANNEL_NAME_MAX = 512
EPG_SOURCE_NAME = "Event channels"
# Channel names end with " · 26 Nov 19:55" in the server timezone; the
# managed dummy guide reads title, date and time back from them.
NAME_TIME_FORMAT = "%d %b %H:%M"
_NAME_SUFFIX = r" · \d{1,2} [A-Za-z]{3} \d{2}:\d{2}$"
EPG_PROPERTIES = {
    "title_pattern": r"^(?<title>.+?)(?:" + _NAME_SUFFIX[:-1] + r")?$",
    "time_pattern": r" · \d{1,2} [A-Za-z]{3} (?<hour>\d{2}):(?<minute>\d{2})$",
    "date_pattern": r" · (?<day>\d{1,2}) (?<month>[A-Za-z]{3}) \d{2}:\d{2}$",
    "program_duration": 180,
    "title_template": "{title}",
    "upcoming_title_template": "Upcoming: {title}",
    "ended_title_template": "Ended: {title}",
}


def team_aliases():
    from core.models import CoreSettings

    saved = CoreSettings.get_event_team_aliases()
    return DEFAULT_TEAM_ALIASES if saved is None else saved


def collect_items(group, now=None, sources=None):
    """Current events of the group's sources as EventItems.

    ``sources`` replaces the saved sources, for previews of unsaved groups.
    """
    from .models import ChannelGroupM3UAccount, Stream

    now = now or timezone.now()
    until = now + timedelta(hours=group.lookahead_hours)
    items = []
    if sources is None:
        sources = group.sources.all()
    sources = ChannelGroupM3UAccount.objects.filter(
        id__in=[source.id for source in sources]
    ).filter(
        enabled=True, ignored=False, m3u_account__is_active=True
    ).select_related("m3u_account", "channel_group")
    for relation in sources:
        try:
            config = normalize_config(relation.custom_properties or {})
        except ValueError:
            config = normalize_config({})
        streams = Stream.objects.filter(
            m3u_account=relation.m3u_account,
            channel_group=relation.channel_group,
            is_stale=False,
        ).only("id", "name")
        for stream in streams:
            event = parse_event(stream.name, config, now)
            if event.status == UNKNOWN:
                if not group.include_untimed:
                    continue
            elif event.status not in (LIVE, UPCOMING):
                continue
            elif event.start and event.start > until:
                continue
            items.append(EventItem(
                stream_id=stream.id,
                stream_name=stream.name,
                account_id=relation.m3u_account_id,
                account_name=relation.m3u_account.name,
                account_priority=relation.m3u_account.priority or 0,
                title=event.title,
                start=event.start,
                status=event.status,
            ))
    return items


def preview(group, now=None, sources=None, fixtures=None):
    """Grouped current events; public fixtures correct names and kick-off."""
    from .fixtures import apply_fixtures, fixture_aliases, load_fixtures

    items = collect_items(group, now, sources)
    if fixtures is None:
        fixtures = load_fixtures() if items else []
    aliases = team_alias_map(list(team_aliases()) + fixture_aliases(fixtures))
    clusters = apply_fixtures(cluster_events(items, aliases), fixtures, aliases)
    clusters.sort(key=lambda c: (c.start is None, c.start or 0, c.title))
    return clusters


def channel_name(group, cluster):
    name = cluster.title
    if group.name_format == group.NameFormat.TITLE_TIME and cluster.start:
        local = timezone.localtime(cluster.start)
        name = f"{name} · {local.strftime(NAME_TIME_FORMAT)}"
    return name[:CHANNEL_NAME_MAX]


def event_epg_data():
    """The guide entry of the managed dummy source for event channels."""
    from django.conf import settings

    from apps.epg.models import EPGData, EPGSource

    source, _created = EPGSource.objects.get_or_create(
        name=EPG_SOURCE_NAME,
        defaults={
            "source_type": "dummy",
            "custom_properties": {
                **EPG_PROPERTIES,
                "timezone": settings.TIME_ZONE or "UTC",
            },
        },
    )
    if source.source_type != "dummy":
        return None
    return EPGData.objects.filter(epg_source=source).first()


def _base_key(key):
    return key.split("@", 1)[0]


def _find_existing(existing, cluster):
    base = _base_key(cluster.key)
    for event_channel in existing:
        if event_channel.event_key != base:
            continue
        if event_channel.start is None and cluster.start is None:
            return event_channel
        if (
            event_channel.start is not None
            and cluster.start is not None
            and abs(event_channel.start - cluster.start) <= START_TOLERANCE
        ):
            return event_channel
    return None


def _free_numbers(group, count):
    from .models import Channel

    used = set(Channel.objects.exclude(channel_number=None).values_list("channel_number", flat=True))
    numbers = []
    number = float(group.start_number or 1)
    while len(numbers) < count:
        if group.end_number is not None and number > group.end_number:
            break
        if number not in used:
            numbers.append(number)
        number += 1
    return numbers


def _set_streams(channel, stream_ids):
    from .models import ChannelStream

    current = list(
        ChannelStream.objects.filter(channel=channel).order_by("order").values_list("stream_id", flat=True)
    )
    if current == stream_ids:
        return False
    ChannelStream.objects.filter(channel=channel).delete()
    for order, stream_id in enumerate(stream_ids):
        ChannelStream.objects.create(channel=channel, stream_id=stream_id, order=order)
    return True


def build(group, now=None):
    """Create, update and remove the channels of one event group."""
    from apps.m3u.tasks import _delete_channels_stopping_streams

    from .models import Channel, ChannelProfile, ChannelProfileMembership, EventChannel

    summary = {"events": 0, "created": 0, "updated": 0, "removed": 0, "skipped": 0}
    if not group.enabled or group.channel_group_id is None:
        # A paused group keeps its channels until it is enabled or deleted.
        return summary
    clusters = preview(group, now)
    summary["events"] = len(clusters)
    existing = list(group.event_channels.select_related("channel"))
    kept, new = [], []
    for cluster in clusters:
        match = _find_existing(existing, cluster)
        if match is not None:
            existing.remove(match)
            kept.append((match, cluster))
        else:
            new.append(cluster)

    profile_ids = [int(pid) for pid in group.channel_profile_ids or [] if str(pid).isdigit()]
    profiles = list(
        ChannelProfile.objects.filter(id__in=profile_ids) if profile_ids else ChannelProfile.objects.all()
    )
    epg_data = event_epg_data() if group.epg_enabled else None
    with transaction.atomic():
        removed = [event_channel.channel for event_channel in existing]
        summary["removed"] = _delete_channels_stopping_streams(removed)

        for event_channel, cluster in kept:
            channel = event_channel.channel
            changed = _set_streams(channel, [item.stream_id for item in cluster.items])
            name = channel_name(group, cluster)
            fields = []
            if channel.name != name or channel.channel_group_id != group.channel_group_id:
                channel.name = name
                channel.channel_group_id = group.channel_group_id
                fields += ["name", "channel_group"]
            if epg_data is not None and channel.epg_data_id is None:
                channel.epg_data = epg_data
                fields.append("epg_data")
            if fields:
                channel.save(update_fields=fields)
                changed = True
            if event_channel.start != cluster.start or event_channel.title != cluster.title:
                event_channel.start = cluster.start
                event_channel.title = cluster.title[:512]
                event_channel.save(update_fields=["start", "title"])
            summary["updated"] += changed

        numbers = _free_numbers(group, len(new))
        summary["skipped"] = len(new) - len(numbers)
        for cluster, number in zip(new, numbers):
            channel = Channel.objects.create(
                name=channel_name(group, cluster),
                channel_number=number,
                channel_group_id=group.channel_group_id,
                epg_data=epg_data,
            )
            _set_streams(channel, [item.stream_id for item in cluster.items])
            ChannelProfileMembership.objects.bulk_create(
                [
                    ChannelProfileMembership(channel=channel, channel_profile=profile, enabled=True)
                    for profile in profiles
                ],
                ignore_conflicts=True,
            )
            EventChannel.objects.create(
                group=group,
                channel=channel,
                event_key=_base_key(cluster.key),
                title=cluster.title[:512],
                start=cluster.start,
            )
            summary["created"] += 1
        group.last_built_at = timezone.now()
        group.save(update_fields=["last_built_at"])
    return summary


def build_all():
    """Rebuild every enabled event group: events start and end over time."""
    from .models import EventChannelGroup

    results = {}
    for group in EventChannelGroup.objects.filter(enabled=True):
        try:
            results[group.name] = build(group)
        except Exception:
            logger.exception("Building event group %s failed", group.name)
    return results


def build_for_account(account_id):
    """Rebuild every enabled event group fed by categories of this account."""
    from .models import EventChannelGroup

    results = {}
    groups = EventChannelGroup.objects.filter(
        enabled=True, sources__m3u_account_id=account_id
    ).distinct()
    for group in groups:
        try:
            results[group.name] = build(group)
        except Exception:
            logger.exception("Building event group %s failed", group.name)
    return results
