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


def preview(group, now=None, sources=None):
    return cluster_events(
        collect_items(group, now, sources), team_alias_map(team_aliases())
    )


def channel_name(group, cluster):
    name = cluster.title
    if group.name_format == group.NameFormat.TITLE_TIME and cluster.start:
        local = timezone.localtime(cluster.start)
        name = f"{name} · {local.strftime('%d %b %H:%M')}"
    return name[:CHANNEL_NAME_MAX]


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
    with transaction.atomic():
        removed = [event_channel.channel for event_channel in existing]
        summary["removed"] = _delete_channels_stopping_streams(removed)

        for event_channel, cluster in kept:
            channel = event_channel.channel
            changed = _set_streams(channel, [item.stream_id for item in cluster.items])
            name = channel_name(group, cluster)
            if channel.name != name or channel.channel_group_id != group.channel_group_id:
                channel.name = name
                channel.channel_group_id = group.channel_group_id
                channel.save(update_fields=["name", "channel_group"])
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
