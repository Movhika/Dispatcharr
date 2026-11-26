"""Match provider streams to channels by their normalized names.

Provider names carry country prefixes, quality tags and different spellings
("DE┃ PRO7 FHD", "De: ProSieben HD +"). Both sides are reduced to a compact
key; aliases map whole names that providers spell differently ("Nitro" and
"RTL Nitro"). Quality only orders the streams inside a channel.
"""

from dataclasses import dataclass, field
import difflib
import re
import unicodedata

from django.db import transaction

CATCHUP_MODES = ("include", "exclude", "only")
SIMILARITY_CUTOFF = 0.88

# Lower ranks are tried first. Plus variants ("HD +") follow their quality.
QUALITY_RANKS = {
    "FHD": 0,
    "FULLHD": 0,
    "1080P": 0,
    "HD": 1,
    "720P": 1,
    "UHD": 2,
    "4K": 2,
    "2160P": 2,
    "8K": 2,
    "HEVC": 3,
    "H265": 3,
    "RAW": 4,
    "SD": 5,
}
DEFAULT_RANK = 1
# Only an explicit "UHD" marks a separate UHD channel; "4K" is a quality.
UHD_TOKEN = "UHD"
# Tags that describe the feed but not the channel.
NOISE_TOKENS = {"HDR", "DOLBY", "5.1", "50FPS", "60FPS", "HD+", "LIVE"}

# Word spellings that providers mix (applied to whole words).
WORD_ALIASES = (
    (r"PRO ?7(?=SAT|\b)", "PROSIEBEN"),
    (r"RTL (?:II|2)\b", "RTL ZWEI"),
    (r"KABEL ?1\b", "KABEL EINS"),
    (r"SAT ?1\b", "SAT1"),
    (r"3 ?SAT\b", "3SAT"),
)

# Whole-name aliases offered as editable defaults. Each entry is a set of names
# that mean the same channel.
DEFAULT_NAME_ALIASES = [
    ["RTL Nitro", "Nitro"],
    ["Nickelodeon", "Nick"],
    ["Super RTL", "Super RTL / Toggo"],
    ["Sky Cinema Highlights", "Sky Cinema Highlight"],
    ["Sky Cinema Premieren", "Sky Cinema Premiere"],
    ["DAZN Champions League", "DAZN UEFA Champions League"],
]

_FOLD = str.maketrans({"ß": "SS", "Æ": "AE", "Ø": "O", "Œ": "OE"})
# "DE┃ ", "De: ", "UK | ", "UCL┃ ": a short provider prefix before the name.
_PREFIX = re.compile(r"^\s*([A-Z]{2,3})\s*(?:┃|\||:)\s*")
_COUNTRY_TAG = re.compile(r"\[([A-Z]{2,3})\]")
THREE_LETTER_COUNTRIES = {"USA", "GER", "ENG", "ITA", "ESP", "FRA", "POR", "NLD", "TUR"}
# "+1" or "+24" after a space is a timeshift copy; "Sport+ 1" is a brand.
_TIMESHIFT = re.compile(r"(?<![A-Z])\+\s?\d+\b")
_DIVIDER = re.compile(r"([^\w\s])\1{2,}|^[\W_]+$")
_QUALITY = re.compile(
    r"(?<![\w.])(?:"
    + "|".join(
        re.escape(token)
        for token in sorted(
            set(QUALITY_RANKS) | NOISE_TOKENS, key=len, reverse=True
        )
    )
    + r")(?![\w.])"
)
_PLUS_VARIANT = re.compile(r"\bHD\s*\+\s*$")


@dataclass(frozen=True)
class ParsedName:
    key: str
    rank: float = DEFAULT_RANK
    uhd: bool = False
    country: str | None = None


def _fold(value):
    value = unicodedata.normalize("NFKD", value.upper().translate(_FOLD))
    return "".join(char for char in value if not unicodedata.combining(char))


def compact(value):
    return re.sub(r"[^A-Z0-9+]", "", value)


def parse_name(name, aliases=None):
    """Return the channel key and quality of a name, or None to skip it."""
    text = _fold(name or "").strip()
    if not text or _DIVIDER.search(text) or _TIMESHIFT.search(text):
        return None
    country = None
    # Some providers start with the separator too: "┃DE┃ ZDF".
    text = text.lstrip("┃| ")
    prefix = _PREFIX.match(text)
    if prefix:
        code = prefix.group(1)
        if len(code) == 2 or code in THREE_LETTER_COUNTRIES:
            country = code
        text = text[prefix.end():]
    tag = _COUNTRY_TAG.search(text)
    if tag:
        # A tag names the feed's country even after a non-country prefix.
        country = tag.group(1)
        text = _COUNTRY_TAG.sub(" ", text)
    text = text.replace("┃", " ")
    plus_variant = bool(_PLUS_VARIANT.search(text))
    if plus_variant:
        text = _PLUS_VARIANT.sub("HD", text)
    tokens = {token.upper() for token in _QUALITY.findall(text)}
    ranks = [QUALITY_RANKS[token] for token in tokens if token in QUALITY_RANKS]
    rank = DEFAULT_RANK
    if ranks:
        # Encoding tags outrank the resolution they are attached to.
        rank = max(ranks) if tokens & {"HEVC", "H265", "RAW"} else min(ranks)
    text = re.sub(r"\s+", " ", _QUALITY.sub(" ", text)).strip(" -|/")
    for pattern, replacement in WORD_ALIASES:
        text = re.sub(rf"\b{pattern}", replacement, text)
    key = compact(text)
    if not key:
        return None
    return ParsedName(
        key=resolve_alias(key, aliases),
        rank=rank + (0.5 if plus_variant else 0),
        uhd=UHD_TOKEN in tokens,
        country=country,
    )


def resolve_alias(key, aliases):
    """An alias covers the name itself and numbered names like "Name 3"."""
    if not aliases:
        return key
    if key in aliases:
        return aliases[key]
    match = re.fullmatch(r"(.*?)(\d+)", key)
    if match and match.group(1) in aliases:
        return aliases[match.group(1)] + match.group(2)
    return key


def alias_map(groups):
    """Map every name of an alias group to the key of its first name."""
    result = {}
    for names in groups or []:
        keys = [
            parsed.key
            for parsed in (parse_name(name) for name in names if isinstance(name, str))
            if parsed
        ]
        for key in keys[1:]:
            result.setdefault(key, keys[0])
    return result


def normalize_alias_groups(groups):
    if not isinstance(groups, list):
        raise ValueError("Aliases must be a list of name lists.")
    cleaned = []
    for names in groups:
        if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
            raise ValueError("Each alias must be a list of names.")
        names = list(dict.fromkeys(n.strip() for n in names if n.strip()))
        if len(names) >= 2:
            cleaned.append(names)
    return cleaned


@dataclass
class Candidate:
    stream_id: int
    name: str
    account_id: int
    account_name: str
    account_priority: int
    group_name: str | None
    catchup: bool
    parsed: ParsedName


@dataclass
class ChannelMatch:
    channel_id: int
    name: str
    number: float | None
    streams: list = field(default_factory=list)
    removed: list = field(default_factory=list)
    current_ids: list = field(default_factory=list)

    @property
    def stream_ids(self):
        return [row["id"] for row in self.streams]

    @property
    def changed(self):
        return self.stream_ids != self.current_ids


def candidate_streams(account_ids=None, catchup="include"):
    """Streams of enabled, non-event categories of active accounts."""
    from apps.channels.models import ChannelGroupM3UAccount, Stream

    memberships = ChannelGroupM3UAccount.objects.filter(
        enabled=True,
        ignored=False,
        m3u_account__is_active=True,
    ).exclude(metadata_defaults__contains={"is_event": True})
    if account_ids:
        memberships = memberships.filter(m3u_account_id__in=account_ids)
    allowed = set(memberships.values_list("m3u_account_id", "channel_group_id"))
    streams = Stream.objects.filter(
        m3u_account_id__in={account for account, _ in allowed},
        is_stale=False,
    ).select_related("m3u_account", "channel_group")
    if catchup == "exclude":
        streams = streams.filter(is_catchup=False)
    elif catchup == "only":
        streams = streams.filter(is_catchup=True)
    for stream in streams.iterator(chunk_size=2000):
        if (stream.m3u_account_id, stream.channel_group_id) not in allowed:
            continue
        parsed = parse_name(stream.name)
        if parsed is None:
            continue
        yield Candidate(
            stream_id=stream.id,
            name=stream.name,
            account_id=stream.m3u_account_id,
            account_name=stream.m3u_account.name,
            account_priority=stream.m3u_account.priority or 0,
            group_name=stream.channel_group.name if stream.channel_group else None,
            catchup=stream.is_catchup,
            parsed=parsed,
        )


def _sort_key(row):
    return (row["rank"], -row["account_priority"], row["account"], row["name"], row["id"])


def match_channels(
    channels,
    *,
    account_ids=None,
    countries=None,
    catchup="include",
    keep_unmatched=True,
    alias_groups=None,
):
    """Propose the stream list of each channel. Nothing is written.

    Returns the proposals and how many matched streams each country prefix
    has, counted before the country filter so it can be offered as choices.
    """
    from apps.channels.models import ChannelStream

    countries = {country.upper() for country in countries or []}
    country_counts = {}

    aliases = alias_map(alias_groups)
    channels = list(channels)
    plain, uhd = {}, {}
    for channel in channels:
        parsed = parse_name(channel.name, aliases)
        if parsed is None:
            continue
        (uhd if parsed.uhd else plain).setdefault(parsed.key, []).append(channel.id)

    by_key = {}
    for candidate in candidate_streams(account_ids, catchup):
        key = resolve_alias(candidate.parsed.key, aliases)
        by_key.setdefault(key, []).append(candidate)

    current = {}
    for row in (
        ChannelStream.objects.filter(channel__in=channels)
        .select_related("stream__m3u_account", "stream__channel_group")
        .order_by("order")
    ):
        current.setdefault(row.channel_id, []).append(row.stream)

    # Keys of streams that no channel name equals, for the similarity
    # fallback. Bucketing by the first characters keeps the scan small.
    channel_keys = set(plain) | set(uhd)
    loose_keys = {}
    for key in sorted(set(by_key) - channel_keys):
        loose_keys.setdefault(key[:3], []).append(key)

    results = []
    for channel in channels:
        existing = current.get(channel.id, [])
        result = ChannelMatch(
            channel_id=channel.id,
            name=channel.name,
            number=channel.channel_number,
            current_ids=[stream.id for stream in existing],
        )
        parsed = parse_name(channel.name, aliases)
        rows = {}
        if parsed is not None:
            matches = []
            for candidate in by_key.get(parsed.key, []):
                if parsed.uhd and not candidate.parsed.uhd:
                    continue
                if (
                    not parsed.uhd
                    and candidate.parsed.uhd
                    and parsed.key in uhd
                ):
                    continue
                matches.append((candidate, "exact"))
            if not matches:
                similar = difflib.get_close_matches(
                    parsed.key,
                    loose_keys.get(parsed.key[:3], []),
                    n=1,
                    cutoff=SIMILARITY_CUTOFF,
                )
                if similar:
                    matches = [(c, "similar") for c in by_key[similar[0]]]
            for candidate, how in matches:
                country = candidate.parsed.country
                if country:
                    country_counts[country] = country_counts.get(country, 0) + 1
                if countries and country and country not in countries:
                    continue
                rows[candidate.stream_id] = {
                    "id": candidate.stream_id,
                    "name": candidate.name,
                    "account": candidate.account_name,
                    "account_id": candidate.account_id,
                    "account_priority": candidate.account_priority,
                    "group": candidate.group_name,
                    "catchup": candidate.catchup,
                    "country": candidate.parsed.country,
                    "rank": candidate.parsed.rank,
                    "match": how,
                    "new": candidate.stream_id not in result.current_ids,
                }
        result.streams = sorted(rows.values(), key=_sort_key)
        for stream in existing:
            if stream.id in rows:
                continue
            row = {
                "id": stream.id,
                "name": stream.name,
                "account": stream.m3u_account.name if stream.m3u_account else None,
                "group": stream.channel_group.name if stream.channel_group else None,
                "catchup": stream.is_catchup,
            }
            if keep_unmatched:
                result.streams.append({**row, "match": "kept", "new": False})
            else:
                result.removed.append(row)
        results.append(result)
    return results, country_counts


def apply_matches(results):
    """Replace the stream lists of changed channels in one transaction."""
    from apps.channels.models import ChannelStream

    changed = [result for result in results if result.changed]
    with transaction.atomic():
        for result in changed:
            ChannelStream.objects.filter(channel_id=result.channel_id).delete()
            for order, stream_id in enumerate(result.stream_ids):
                ChannelStream.objects.create(
                    channel_id=result.channel_id, stream_id=stream_id, order=order
                )
    return len(changed)
