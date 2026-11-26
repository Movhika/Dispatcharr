"""Read event details from the stream names of Live TV event categories.

Providers reuse numbered slots for events and write the current event into
the name: "UEFA Champions League 03: Sporting CP - Man United @ 25 Nov
07:00 PM London", "MLS 11: NO EVENT", "UFC event: 1 name: Fight Night
start:2026-11-21 18:55:00 stop:2026-11-21 22:00:00". The parser finds the
title and start time in these names and decides whether the slot holds a
current event. A category can add its own pattern when the automatic
recognition does not fit.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import regex

REGEX_TIMEOUT_SECONDS = 0.1
DEFAULT_DURATION_MINUTES = 180
MAX_DURATION_MINUTES = 24 * 60

NONE = "none"
UPCOMING = "upcoming"
LIVE = "live"
ENDED = "ended"
UNKNOWN = "unknown"
# Slots that "only current events" keeps: without a time the event may be on.
CURRENT_STATUSES = frozenset({UPCOMING, LIVE, UNKNOWN})

TIMEZONE_ALIASES = {
    "UTC": "UTC",
    "GMT": "UTC",
    "Z": "UTC",
    "UK": "Europe/London",
    "LONDON": "Europe/London",
    "BST": "Europe/London",
    "ET": "America/New_York",
    "EST": "America/New_York",
    "EDT": "America/New_York",
    "CT": "America/Chicago",
    "CST": "America/Chicago",
    "CDT": "America/Chicago",
    "MT": "America/Denver",
    "PT": "America/Los_Angeles",
    "PST": "America/Los_Angeles",
    "PDT": "America/Los_Angeles",
    "CET": "Europe/Berlin",
    "CEST": "Europe/Berlin",
    "MEZ": "Europe/Berlin",
    "MESZ": "Europe/Berlin",
    "BERLIN": "Europe/Berlin",
    "AMSTERDAM": "Europe/Amsterdam",
    "PARIS": "Europe/Paris",
    "MADRID": "Europe/Madrid",
    "ROME": "Europe/Rome",
}

MONTHS = {
    name: index
    for index, names in enumerate(
        (
            ("JAN", "JANUARY", "JANUAR"),
            ("FEB", "FEBRUARY", "FEBRUAR"),
            ("MAR", "MARCH", "MÄR", "MAERZ", "MÄRZ"),
            ("APR", "APRIL"),
            ("MAY", "MAI"),
            ("JUN", "JUNE", "JUNI"),
            ("JUL", "JULY", "JULI"),
            ("AUG", "AUGUST"),
            ("SEP", "SEPT", "SEPTEMBER"),
            ("OCT", "OCTOBER", "OKT", "OKTOBER"),
            ("NOV", "NOVEMBER"),
            ("DEC", "DECEMBER", "DEZ", "DEZEMBER"),
        ),
        start=1,
    )
    for name in names
}

_MONTH = r"(?P<month>[A-Za-zÄä]{3,9})\.?"
_TIME = r"(?P<hour>\d{1,2})[:.](?P<minute>\d{2})(?::\d{2})?\s*(?P<ampm>[AaPp]\.?[Mm]\.?)?"
_ZONE = r"(?:\s+(?P<zone>[A-Za-z][A-Za-z_/]{0,30}))?"
_DATE_TIME_PATTERNS = (
    # 25 Nov 05:40 PM London
    regex.compile(rf"(?P<day>\d{{1,2}})\.?\s+{_MONTH}(?:\s+(?P<year>\d{{4}}))?,?\s+{_TIME}{_ZONE}"),
    # Nov 25 08:00 PM ET
    regex.compile(rf"{_MONTH}\s+(?P<day>\d{{1,2}})(?:,?\s+(?P<year>\d{{4}}))?,?\s+{_TIME}{_ZONE}"),
    # 2026-11-21 20:00 / 21.11.2026 20:00
    regex.compile(rf"(?P<year>\d{{4}})-(?P<month_num>\d{{2}})-(?P<day>\d{{2}})[ T]{_TIME}{_ZONE}"),
    regex.compile(rf"(?P<day>\d{{1,2}})\.(?P<month_num>\d{{1,2}})\.(?P<year>\d{{4}})?\s+{_TIME}{_ZONE}"),
)
_TIME_ONLY = regex.compile(r"\b(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>[ap]m)\b", regex.IGNORECASE)
# "@ 03:00pm EST": a time of today after the title.
_AT_TIME = regex.compile(
    r"@\s*(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<ampm>[ap]m)(?:\s+(?P<zone>[A-Za-z]{2,4})\b)?",
    regex.IGNORECASE,
)
# Dates without a year are announced at most this far ahead; later dates
# belong to the past year (stale slots are common, far bookings are not).
MAX_DAYS_AHEAD = 60
_DIVIDER = regex.compile(r"([^\w\s])\1{2,}")
# ":Tennis  02" at the end names the slot.
_TRAILING_LABEL = regex.compile(r"\s+:\s*[^\d:|]+?\s*\d{1,3}$")
_START_STOP = regex.compile(
    r"\bstart:\s*(?P<start>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)"
    r"(?:\s+(?:stop|end):\s*(?P<stop>\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?))?",
    regex.IGNORECASE,
)
_NAME_KEY = regex.compile(r"\bname:\s*(?P<title>.*?)\s*(?=\bstart:|$)", regex.IGNORECASE)
# "UEFA Champions League 03:", "MLS 11 |", "LIVE EVENT 01 -", "UFC event: 0"
_SLOT_LABEL = regex.compile(r"^(?P<label>[^:|]*?\d{1,3})\s*(?::|\||\s-\s)\s*")
_PLACEHOLDER = regex.compile(r"^[^\d:|]*?\s?\d{1,3}$")
_NO_EVENT = regex.compile(
    r"^(?:no\s+events?(?:\s+streaming)?|off\s*air|tba|tbd|coming\s+soon|-+|\.+)$",
    regex.IGNORECASE,
)
# Only "vs" and "v" name two sides; "-" also separates show titles.
_TEAMS = regex.compile(r"^(?P<home>.+?)\s+(?:vs\.?|v\.?)\s+(?P<away>.+)$", regex.IGNORECASE)


@dataclass(frozen=True)
class EventInfo:
    status: str
    title: str = ""
    home: str | None = None
    away: str | None = None
    start: datetime | None = None
    end: datetime | None = None

    def as_dict(self):
        return {
            "status": self.status,
            "title": self.title,
            "home": self.home,
            "away": self.away,
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
        }


def resolve_timezone(value, default="UTC"):
    """Return a ZoneInfo for an alias, an IANA name, or the default."""
    for candidate in (value, default, "UTC"):
        if not candidate:
            continue
        name = TIMEZONE_ALIASES.get(str(candidate).upper(), candidate)
        try:
            return ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return ZoneInfo("UTC")


def known_zone(value):
    if not value:
        return False
    if value.upper() in TIMEZONE_ALIASES:
        return True
    try:
        ZoneInfo(value)
        return "/" in value
    except (ZoneInfoNotFoundError, ValueError):
        return False


def normalize_config(config):
    """Validated parser settings of a category (stored in custom_properties)."""
    config = config if isinstance(config, dict) else {}
    zone = config.get("event_timezone") or "UTC"
    if not known_zone(zone) and zone != "UTC":
        raise ValueError(f"Unknown event timezone: {zone}")
    try:
        duration = config.get("event_duration_minutes")
        duration = int(DEFAULT_DURATION_MINUTES if duration in (None, "") else duration)
    except (TypeError, ValueError) as exc:
        raise ValueError("Event duration must be a number of minutes.") from exc
    if not 1 <= duration <= MAX_DURATION_MINUTES:
        raise ValueError("Event duration must be between 1 and 1440 minutes.")
    pattern = config.get("event_pattern") or ""
    if pattern:
        try:
            compiled = regex.compile(pattern, regex.IGNORECASE)
        except regex.error as exc:
            raise ValueError(f"Invalid event pattern: {exc}") from exc
        if "title" not in compiled.groupindex:
            raise ValueError("The event pattern needs a named group 'title'.")
    event_filter = config.get("event_filter") or "all"
    if event_filter not in ("all", "current"):
        raise ValueError("Event filter must be 'all' or 'current'.")
    return {
        "event_timezone": zone,
        "event_duration_minutes": duration,
        "event_pattern": pattern,
        "event_filter": event_filter,
        "event_channel_name": bool(config.get("event_channel_name")),
    }


def _hour(match):
    hour = int(match.group("hour"))
    ampm = (match.group("ampm") or "").replace(".", "").upper()
    if ampm == "PM" and hour < 12:
        hour += 12
    elif ampm == "AM" and hour == 12:
        hour = 0
    return hour


def _closest_year(build, now):
    """Names rarely carry a year: take the latest one not too far ahead."""
    latest = now + timedelta(days=MAX_DAYS_AHEAD)
    candidates = []
    for year in (now.year - 1, now.year, now.year + 1):
        try:
            value = build(year)
        except ValueError:
            continue
        if value <= latest:
            candidates.append(value)
    return max(candidates) if candidates else None


def _find_start(text, zone, now):
    """Return the start and the matched text span of the first date and time."""
    matches = (
        match
        for pattern in _DATE_TIME_PATTERNS
        for match in pattern.finditer(text, timeout=REGEX_TIMEOUT_SECONDS)
    )
    for match in matches:
        groups = match.groupdict()
        if groups.get("month_num"):
            month = int(groups["month_num"])
        else:
            month = MONTHS.get((groups.get("month") or "").upper())
        if not month:
            continue
        hour, minute, day = _hour(match), int(match.group("minute")), int(groups["day"])
        named = groups.get("zone")
        span_end = match.end()
        if named and not known_zone(named):
            # A word after the time that is no timezone belongs to the title.
            span_end = match.start("zone") - 1
            named = None
        tz = resolve_timezone(named, None) if named else zone

        def build(year, month=month, day=day, hour=hour, minute=minute, tz=tz):
            return datetime(year, month, day, hour, minute, tzinfo=tz)

        try:
            start = build(int(groups["year"])) if groups.get("year") else _closest_year(build, now)
        except ValueError:
            continue
        if start is not None:
            return start, (match.start(), span_end)
    return None, None


def _parse_iso(value, zone):
    value = value.replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=zone)
        except ValueError:
            continue
    return None


def _clean(text):
    text = regex.sub(r"\s@(?=\s|$)", " ", text or "")
    text = regex.sub(r"\s+", " ", text).strip(" -|:@,")
    if text.startswith("[") and text.endswith("]") and text.count("[") == 1:
        text = text[1:-1].strip()
    return text


def _teams(title):
    match = _TEAMS.match(title)
    if not match:
        return None, None
    return match.group("home").strip(), match.group("away").strip()


def _status(start, end, title, now):
    if start is None:
        return UNKNOWN if title else NONE
    if now < start:
        return UPCOMING
    if end is not None and now > end:
        return ENDED
    return LIVE


def parse_event(name, config=None, now=None):
    """Parse one stream name with the settings of its category."""
    config = config or {}
    now = now or datetime.now(dt_timezone.utc)
    zone = resolve_timezone(config.get("event_timezone"))
    duration = timedelta(
        minutes=int(config.get("event_duration_minutes") or DEFAULT_DURATION_MINUTES)
    )
    text = (name or "").strip()
    start = end = None
    if _DIVIDER.search(text):
        return EventInfo(NONE)

    pattern = config.get("event_pattern")
    if pattern:
        match = regex.search(pattern, text, regex.IGNORECASE, timeout=REGEX_TIMEOUT_SECONDS)
        if match:
            groups = match.groupdict()
            title = _clean(groups.get("title"))
            when = " ".join(
                groups[key] for key in ("date", "time", "zone") if groups.get(key)
            )
            if when:
                start, _ = _find_start(when, zone, now)
            if title and _NO_EVENT.match(title):
                return EventInfo(NONE)
            end = start + duration if start else None
            home, away = _teams(title)
            return EventInfo(_status(start, end, title, now), title, home, away, start, end)

    start_stop = _START_STOP.search(text, timeout=REGEX_TIMEOUT_SECONDS)
    if start_stop:
        start = _parse_iso(start_stop.group("start"), zone)
        if start_stop.group("stop"):
            end = _parse_iso(start_stop.group("stop"), zone)
        named = _NAME_KEY.search(text, timeout=REGEX_TIMEOUT_SECONDS)
        title = _clean(named.group("title") if named else text[: start_stop.start()])
    else:
        start, span = _find_start(text, zone, now)
        if span:
            text = text[: span[0]] + " " + text[span[1]:]
        title = text

    if start is None:
        at_time = _AT_TIME.search(title, timeout=REGEX_TIMEOUT_SECONDS)
        if at_time:
            named = at_time.group("zone")
            tz = resolve_timezone(named, None) if known_zone(named) else zone
            start = now.astimezone(tz).replace(
                hour=_hour(at_time),
                minute=int(at_time.group("minute") or 0),
                second=0,
                microsecond=0,
            )
            title = title[: at_time.start()] + " " + title[at_time.end():]
    label = _SLOT_LABEL.match(title)
    if label:
        title = title[label.end():]
    title = _TRAILING_LABEL.sub("", title)
    title = _clean(title)
    if start is None and title:
        time_only = _TIME_ONLY.search(title, timeout=REGEX_TIMEOUT_SECONDS)
        if time_only and time_only.start() == 0:
            local = now.astimezone(zone)
            start = local.replace(
                hour=_hour(time_only),
                minute=int(time_only.group("minute") or 0),
                second=0,
                microsecond=0,
            )
            title = _clean(title[time_only.end():])

    if not title or _NO_EVENT.match(title) or (
        start is None and not label and _PLACEHOLDER.match(title)
    ):
        return EventInfo(NONE)
    if start is not None and end is None:
        end = start + duration
    home, away = _teams(title)
    return EventInfo(_status(start, end, title, now), title, home, away, start, end)


def is_event_relation(relation):
    return bool((getattr(relation, "metadata_defaults", None) or {}).get("is_event"))
