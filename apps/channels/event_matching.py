"""Group parsed events of several providers that show the same match.

Providers spell teams differently ("Bayern Munich", "FC Bayern München",
"PSG" and "Paris Saint-Germain") and label the same match with different
titles and times. Events are grouped when their normalized team pair is the
same and their start times are close; events without teams are grouped by
their normalized title. Editable alias groups name the same team.
"""

from dataclasses import dataclass, field
from datetime import timedelta
import re
import unicodedata

START_TOLERANCE = timedelta(minutes=90)

# Club prefixes and suffixes that providers add or leave out.
TEAM_NOISE = {
    "FC", "SC", "CF", "AFC", "AC", "AS", "SS", "SV", "SSC", "FK", "SK", "NK",
    "CD", "UD", "RC", "OGC", "VFL", "VFB", "TSG", "BSC", "1", "CLUB", "DE",
    "THE", "CALCIO", "HOTSPUR",
}

DEFAULT_TEAM_ALIASES = [
    ["Bayern Munich", "Bayern München", "FC Bayern"],
    ["Paris Saint-Germain", "PSG", "Paris SG"],
    ["Manchester United", "Man United", "Man Utd"],
    ["Manchester City", "Man City"],
    ["Inter", "Internazionale", "Inter Milan"],
    ["Atlético Madrid", "Atletico Madrid", "Atleti"],
    ["Borussia Dortmund", "Dortmund", "BVB"],
    ["Borussia Mönchengladbach", "Gladbach", "M'gladbach"],
    ["Bayer Leverkusen", "Leverkusen"],
    ["Eintracht Frankfurt", "Frankfurt"],
    ["Werder Bremen", "Bremen"],
    ["Hamburger SV", "Hamburg", "HSV"],
    ["RB Leipzig", "Leipzig"],
    ["Sporting CP", "Sporting Lisbon", "Sporting"],
]

_FOLD = str.maketrans({"ß": "SS", "Æ": "AE", "Ø": "O", "Œ": "OE"})
_BRACKETS = re.compile(r"\s*[\(\[][^\)\]]*[\)\]]")
# Separators between two sides; "-" only with spaces around it.
_SIDES = re.compile(r"\s+(?:vs\.?|v\.?|–|-|@)\s+", re.IGNORECASE)


def fold(text):
    text = unicodedata.normalize("NFKD", (text or "").upper().translate(_FOLD))
    return "".join(char for char in text if not unicodedata.combining(char))


def team_key(name, aliases=None):
    """Compact key of a team name without club prefixes."""
    words = re.findall(r"[A-Z0-9]+", fold(_BRACKETS.sub("", name or "")))
    key = "".join(word for word in words if word not in TEAM_NOISE) or "".join(words)
    if aliases:
        key = aliases.get(key, key)
    return key


def team_alias_map(groups):
    """Map every name of an alias group to the key of its first name."""
    result = {}
    for names in groups or []:
        keys = [team_key(name) for name in names if isinstance(name, str) and name.strip()]
        for key in keys[1:]:
            if key and keys[0]:
                result.setdefault(key, keys[0])
    return result


def split_teams(title):
    """Return the two sides of a match title, or None.

    The part after the last ":" or "|" holds the match in titles like
    "UEFA Europa League | League Phase: AZ Alkmaar - Juventus"; feed notes
    after a second separator ("Rams - NF Feed") and brackets are dropped.
    """
    text = _BRACKETS.sub("", title or "")
    text = re.split(r"\s*[:|]\s*", text)[-1].strip()
    parts = _SIDES.split(text)
    if len(parts) < 2:
        return None
    home, away = parts[0].strip(), parts[1].strip()
    if not home or not away or len(home) > 40 or len(away) > 40:
        return None
    return home, away


def title_key(title):
    return re.sub(r"[^A-Z0-9]", "", fold(_BRACKETS.sub("", title or "")))


@dataclass
class EventItem:
    stream_id: int
    stream_name: str
    account_id: int
    account_name: str
    account_priority: int
    title: str
    start: object = None
    status: str = "unknown"


@dataclass
class EventCluster:
    key: str
    title: str
    start: object = None
    teams: tuple | None = None
    items: list = field(default_factory=list)
    fixture: object = None

    @property
    def competition(self):
        return getattr(self.fixture, "competition", "") or ""

    @property
    def status(self):
        statuses = {item.status for item in self.items}
        for status in ("live", "upcoming", "unknown"):
            if status in statuses:
                return status
        return next(iter(statuses), "unknown")


def _display_title(items, teams):
    if teams:
        return f"{teams[0]} - {teams[1]}"
    return min((item.title for item in items), key=len)


def cluster_events(items, aliases=None):
    """Group event items; returns clusters sorted by start time and title."""
    clusters = []
    by_key = {}
    for item in sorted(items, key=lambda i: (i.start is None, i.start or 0, i.stream_id)):
        sides = split_teams(item.title)
        if sides:
            pair = tuple(sorted(team_key(side, aliases) for side in sides))
            base = "teams:" + "|".join(pair)
        else:
            base = "title:" + title_key(item.title)
        match = None
        for cluster in by_key.get(base, []):
            if item.start is None or cluster.start is None:
                if item.start is None and cluster.start is None:
                    match = cluster
                    break
                continue
            if abs(item.start - cluster.start) <= START_TOLERANCE:
                match = cluster
                break
        if match is None:
            day = item.start.strftime("%Y%m%d%H%M") if item.start else "none"
            match = EventCluster(key=f"{base}@{day}", title="", start=item.start, teams=sides)
            by_key.setdefault(base, []).append(match)
            clusters.append(match)
        match.items.append(item)
    for cluster in clusters:
        cluster.title = _display_title(cluster.items, cluster.teams)
        cluster.items.sort(key=lambda i: (-i.account_priority, i.account_name, i.stream_name))
    return clusters
