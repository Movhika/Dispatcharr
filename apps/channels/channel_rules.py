"""Stream rules: a channel finds its streams like a Library title its sources.

A rule matches stream names against the channel name and its further names
(with the global aliases), and optionally against a regular expression.
Filters narrow the result: catch-up, accounts, country prefixes and a
regular expression to leave streams out. Streams a rule found are marked as
rule streams; when they stop matching they go again. Manual streams stay,
and streams removed by hand are excluded so the rule does not add them back.
"""

from dataclasses import dataclass
import logging

import regex
from django.db import transaction
from django.utils import timezone

from .stream_matching import (
    DEFAULT_NAME_ALIASES,
    alias_map,
    candidate_streams,
    parse_name,
    resolve_alias,
)

logger = logging.getLogger(__name__)

REGEX_TIMEOUT_SECONDS = 0.1


def global_aliases():
    from core.models import CoreSettings

    saved = CoreSettings.get_stream_matching_aliases()
    return DEFAULT_NAME_ALIASES if saved is None else saved


def compile_pattern(pattern):
    """Compile a rule pattern; raises ValueError with a readable message."""
    if not pattern:
        return None
    try:
        return regex.compile(pattern, regex.IGNORECASE)
    except regex.error as exc:
        raise ValueError(f"Invalid regular expression: {exc}") from exc


@dataclass
class RuleView:
    """The rule values used for matching, saved or not."""

    channel_name: str
    match_name: bool = True
    names: tuple = ()
    include_regex: str = ""
    exclude_regex: str = ""
    catchup: str = "include"
    account_ids: tuple = ()
    countries: tuple = ()
    excluded_stream_ids: tuple = ()

    @classmethod
    def from_rule(cls, rule, **overrides):
        values = {
            "channel_name": rule.channel.name,
            "match_name": rule.match_name,
            "names": tuple(rule.names or ()),
            "include_regex": rule.include_regex or "",
            "exclude_regex": rule.exclude_regex or "",
            "catchup": rule.catchup,
            "account_ids": tuple(rule.account_ids or ()),
            "countries": tuple(rule.countries or ()),
            "excluded_stream_ids": tuple(rule.excluded_stream_ids or ()),
        }
        values.update(overrides)
        return cls(**values)


class RuleMatcher:
    """Candidates and aliases shared by every rule evaluated in one run."""

    def __init__(self):
        from .models import Channel

        self.aliases = alias_map(global_aliases())
        self.candidates = list(candidate_streams(None, "include"))
        self.by_key = {}
        for candidate in self.candidates:
            key = resolve_alias(candidate.parsed.key, self.aliases)
            self.by_key.setdefault(key, []).append(candidate)
        # Names with "UHD" are separate UHD channels; their streams do not
        # also go to the channel of the same name without UHD.
        self.uhd_keys = set()
        for name in Channel.objects.values_list("name", flat=True):
            parsed = parse_name(name, self.aliases)
            if parsed and parsed.uhd:
                self.uhd_keys.add(parsed.key)

    def match(self, view):
        include = compile_pattern(view.include_regex)
        exclude = compile_pattern(view.exclude_regex)
        found = {}
        if view.match_name:
            for name in (view.channel_name, *view.names):
                parsed = parse_name(name, self.aliases)
                if parsed is None:
                    continue
                for candidate in self.by_key.get(parsed.key, []):
                    if parsed.uhd and not candidate.parsed.uhd:
                        continue
                    if not parsed.uhd and candidate.parsed.uhd and parsed.key in self.uhd_keys:
                        continue
                    found[candidate.stream_id] = candidate
        if include is not None:
            for candidate in self.candidates:
                if include.search(candidate.name, timeout=REGEX_TIMEOUT_SECONDS):
                    found[candidate.stream_id] = candidate
        accounts = {int(a) for a in view.account_ids}
        countries = {c.upper() for c in view.countries}
        excluded = {int(s) for s in view.excluded_stream_ids}
        result = []
        for candidate in found.values():
            if candidate.stream_id in excluded:
                continue
            if exclude is not None and exclude.search(candidate.name, timeout=REGEX_TIMEOUT_SECONDS):
                continue
            if view.catchup == "only" and not candidate.catchup:
                continue
            if view.catchup == "exclude" and candidate.catchup:
                continue
            if accounts and candidate.account_id not in accounts:
                continue
            country = candidate.parsed.country
            if countries and country and country not in countries:
                continue
            result.append(candidate)
        result.sort(key=lambda c: (
            c.parsed.rank, -c.account_priority, c.account_name, c.name, c.stream_id
        ))
        return result


def plan(channel, view, matcher):
    """What applying a rule would do: rows in their new order with a status."""
    from .models import ChannelStream

    matched = matcher.match(view)
    matched_ids = {candidate.stream_id for candidate in matched}
    rows = list(
        ChannelStream.objects.filter(channel=channel)
        .select_related("stream__m3u_account", "stream__channel_group")
        .order_by("order", "id")
    )
    present = {row.stream_id for row in rows}
    result, removed = [], []
    for row in rows:
        stream = row.stream
        entry = {
            "id": stream.id,
            "name": stream.name,
            "account": stream.m3u_account.name if stream.m3u_account else None,
            "group": stream.channel_group.name if stream.channel_group else None,
            "catchup": stream.is_catchup,
            "origin": row.origin,
        }
        if row.origin == ChannelStream.Origin.MANUAL:
            result.append({**entry, "status": "manual"})
        elif stream.id in matched_ids:
            result.append({**entry, "status": "kept"})
        else:
            removed.append({**entry, "status": "removed"})
    for candidate in matched:
        if candidate.stream_id in present:
            continue
        result.append({
            "id": candidate.stream_id,
            "name": candidate.name,
            "account": candidate.account_name,
            "group": candidate.group_name,
            "catchup": candidate.catchup,
            "origin": ChannelStream.Origin.RULE,
            "status": "added",
        })
    return result, removed


def apply_rule(rule, matcher):
    """Bring the rule streams of one channel up to date. Returns (added, removed)."""
    from .models import ChannelStream

    rows, removed = plan(rule.channel, RuleView.from_rule(rule), matcher)
    added = [row for row in rows if row["status"] == "added"]
    with transaction.atomic():
        if removed:
            ChannelStream.objects.filter(
                channel=rule.channel, stream_id__in=[row["id"] for row in removed]
            ).delete()
        current = {
            link.stream_id: link
            for link in ChannelStream.objects.filter(channel=rule.channel)
        }
        for order, row in enumerate(rows):
            link = current.get(row["id"])
            if link is None:
                ChannelStream.objects.create(
                    channel=rule.channel,
                    stream_id=row["id"],
                    order=order,
                    origin=ChannelStream.Origin.RULE,
                )
            elif link.order != order:
                link.order = order
                link.save(update_fields=["order"])
        rule.last_applied_at = timezone.now()
        rule.save(update_fields=["last_applied_at"])
    return len(added), len(removed)


def apply_rules(rules=None):
    """Apply enabled rules; all of them by default."""
    from .models import ChannelStreamRule

    if rules is None:
        rules = ChannelStreamRule.objects.filter(enabled=True).select_related("channel")
    rules = list(rules)
    summary = {"channels": 0, "added": 0, "removed": 0, "failed": 0}
    if not rules:
        return summary
    matcher = RuleMatcher()
    for rule in rules:
        try:
            added, removed = apply_rule(rule, matcher)
        except (ValueError, TimeoutError):
            logger.warning("Stream rule of channel %s could not be applied", rule.channel_id)
            summary["failed"] += 1
            continue
        summary["channels"] += bool(added or removed)
        summary["added"] += added
        summary["removed"] += removed
    return summary


def note_manual_changes(channel, removed_stream_ids, added_stream_ids):
    """Removing a rule stream by hand excludes it; adding one back allows it again."""
    from .models import ChannelStream, ChannelStreamRule

    rule = ChannelStreamRule.objects.filter(channel=channel).first()
    if rule is None:
        return
    excluded = [int(s) for s in rule.excluded_stream_ids or []]
    excluded = [s for s in excluded if s not in set(added_stream_ids)]
    excluded += [s for s in removed_stream_ids if s not in excluded]
    if excluded != rule.excluded_stream_ids:
        rule.excluded_stream_ids = excluded
        rule.save(update_fields=["excluded_stream_ids"])
    ChannelStream.objects.filter(channel=channel, stream_id__in=added_stream_ids).update(
        origin=ChannelStream.Origin.MANUAL
    )
