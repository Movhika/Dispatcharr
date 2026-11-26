"""Public fixtures that give event groups official kick-off times and names.

OpenLigaDB is free and covers German leagues, the DFB-Pokal and the
Champions League. TheSportsDB covers many sports and leagues but needs a
personal API key for useful results. Fixtures are cached for a while, and a
failing source is skipped: event groups work without fixtures.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone as dt_timezone
import logging

import requests
from django.core.cache import cache

from .event_matching import team_key

logger = logging.getLogger(__name__)

CACHE_SECONDS = 30 * 60
REQUEST_TIMEOUT = 10
HEADERS = {"User-Agent": "Dispatcharr event groups"}
OPENLIGADB_URL = "https://api.openligadb.de/getmatchdata/{league}"
THESPORTSDB_URL = "https://www.thesportsdb.com/api/v1/json/{key}/{endpoint}.php?id={league}"
DEFAULT_SETTINGS = {
    "openligadb_leagues": ["bl1", "bl2", "dfb", "ucl"],
    "thesportsdb_leagues": [],
    "thesportsdb_key": "",
}
# A fixture belongs to an event when both start within this time.
FIXTURE_TOLERANCE = timedelta(hours=3)


@dataclass(frozen=True)
class Fixture:
    home: str
    away: str
    start: datetime
    competition: str
    home_alias: str = ""
    away_alias: str = ""


def fixture_settings():
    from core.models import CoreSettings

    saved = CoreSettings.get_event_fixture_settings() or {}
    return {**DEFAULT_SETTINGS, **{k: v for k, v in saved.items() if k in DEFAULT_SETTINGS}}


def _get_json(url):
    response = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return response.json()


def _cached(key, loader):
    fixtures = cache.get(key)
    if fixtures is None:
        try:
            fixtures = loader()
        except (requests.RequestException, ValueError, KeyError, TypeError) as exc:
            logger.warning("Fixture source %s failed: %s", key, type(exc).__name__)
            fixtures = []
        cache.set(key, fixtures, CACHE_SECONDS)
    return fixtures


def _parse_time(value):
    value = (value or "").replace("Z", "+00:00")
    start = datetime.fromisoformat(value)
    return start if start.tzinfo else start.replace(tzinfo=dt_timezone.utc)


def openligadb_fixtures(league):
    def load():
        result = []
        for match in _get_json(OPENLIGADB_URL.format(league=league)):
            if match.get("matchIsFinished"):
                continue
            team1, team2 = match.get("team1") or {}, match.get("team2") or {}
            result.append(Fixture(
                home=team1.get("teamName", ""),
                away=team2.get("teamName", ""),
                start=_parse_time(match.get("matchDateTimeUTC")),
                competition=match.get("leagueName", league),
                home_alias=team1.get("shortName") or "",
                away_alias=team2.get("shortName") or "",
            ))
        return result

    return _cached(f"event-fixtures:openligadb:{league}", load)


def thesportsdb_fixtures(key, league):
    def load():
        url = THESPORTSDB_URL.format(key=key, endpoint="eventsnextleague", league=league)
        events = _get_json(url).get("events") or []
        return [
            Fixture(
                home=event.get("strHomeTeam", ""),
                away=event.get("strAwayTeam", ""),
                start=_parse_time(event.get("strTimestamp")),
                competition=event.get("strLeague", ""),
            )
            for event in events
            if event.get("strTimestamp")
        ]

    return _cached(f"event-fixtures:thesportsdb:{league}", load)


def load_fixtures(settings=None):
    settings = settings or fixture_settings()
    fixtures = []
    for league in settings["openligadb_leagues"]:
        fixtures += openligadb_fixtures(league)
    if settings["thesportsdb_key"]:
        for league in settings["thesportsdb_leagues"]:
            fixtures += thesportsdb_fixtures(settings["thesportsdb_key"], league)
    return fixtures


def fixture_aliases(fixtures):
    """Short names of fixture teams as alias groups ("Bremen" = "SV Werder Bremen")."""
    groups = []
    for fixture in fixtures:
        for name, alias in ((fixture.home, fixture.home_alias), (fixture.away, fixture.away_alias)):
            if name and alias and team_key(alias) != team_key(name):
                groups.append([name, alias])
    return groups


def apply_fixtures(clusters, fixtures, aliases):
    """Give clusters the official names and kick-off of their fixture."""
    by_pair = {}
    for fixture in fixtures:
        pair = tuple(sorted((team_key(fixture.home, aliases), team_key(fixture.away, aliases))))
        by_pair.setdefault(pair, []).append(fixture)
    for cluster in clusters:
        if not cluster.teams:
            continue
        pair = tuple(sorted(team_key(side, aliases) for side in cluster.teams))
        candidates = [
            fixture
            for fixture in by_pair.get(pair, [])
            if cluster.start is None or abs(fixture.start - cluster.start) <= FIXTURE_TOLERANCE
        ]
        if not candidates:
            continue
        fixture = min(
            candidates,
            key=lambda f: abs(f.start - cluster.start) if cluster.start else timedelta(0),
        )
        cluster.fixture = fixture
        cluster.title = f"{fixture.home} - {fixture.away}"
        cluster.start = fixture.start
    return clusters
