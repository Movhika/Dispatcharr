"""Public fixtures give event groups official names and kick-off times."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from apps.channels import fixtures
from apps.channels.event_matching import EventItem, cluster_events, team_alias_map
from core.models import CoreSettings

KICKOFF = datetime(2026, 11, 27, 19, 30, tzinfo=timezone.utc)

OPENLIGADB = [
    {
        "matchDateTimeUTC": "2026-11-27T19:30:00Z",
        "leagueName": "1. Fußball-Bundesliga 2026/2027",
        "matchIsFinished": False,
        "team1": {"teamName": "SV Werder Bremen", "shortName": "Bremen"},
        "team2": {"teamName": "Borussia Mönchengladbach", "shortName": "Gladbach"},
    },
    {
        "matchDateTimeUTC": "2026-11-20T19:30:00Z",
        "leagueName": "1. Fußball-Bundesliga 2026/2027",
        "matchIsFinished": True,
        "team1": {"teamName": "FC Bayern München", "shortName": "Bayern"},
        "team2": {"teamName": "1. FC Köln", "shortName": "Köln"},
    },
]


def response(data):
    mocked = MagicMock()
    mocked.json.return_value = data
    mocked.raise_for_status.return_value = None
    return mocked


class FixtureSourceTests(SimpleTestCase):
    def setUp(self):
        cache.delete("event-fixtures:openligadb:bl1")
        cache.delete("event-fixtures:thesportsdb:4331")
        self.addCleanup(cache.delete, "event-fixtures:openligadb:bl1")
        self.addCleanup(cache.delete, "event-fixtures:thesportsdb:4331")

    def test_openligadb_skips_finished_matches_and_is_cached(self):
        with patch("requests.get", return_value=response(OPENLIGADB)) as get:
            first = fixtures.openligadb_fixtures("bl1")
            second = fixtures.openligadb_fixtures("bl1")
        get.assert_called_once()
        self.assertEqual(first, second)
        self.assertEqual(
            [(f.home, f.away, f.start, f.home_alias) for f in first],
            [("SV Werder Bremen", "Borussia Mönchengladbach", KICKOFF, "Bremen")],
        )

    def test_failing_sources_are_skipped(self):
        with patch("requests.get", side_effect=fixtures.requests.ConnectionError("down")):
            self.assertEqual(fixtures.openligadb_fixtures("bl1"), [])

    def test_thesportsdb_needs_a_key(self):
        settings = {"openligadb_leagues": [], "thesportsdb_leagues": ["4331"], "thesportsdb_key": ""}
        with patch("requests.get") as get:
            self.assertEqual(fixtures.load_fixtures(settings), [])
        get.assert_not_called()
        events = {"events": [{"strHomeTeam": "Werder Bremen", "strAwayTeam": "Gladbach",
                              "strTimestamp": "2026-11-27T19:30:00", "strLeague": "German Bundesliga"}]}
        with patch("requests.get", return_value=response(events)) as get:
            result = fixtures.load_fixtures({**settings, "thesportsdb_key": "secret"})
        self.assertIn("/secret/eventsnextleague.php?id=4331", get.call_args.args[0])
        self.assertEqual(result[0].start, KICKOFF)

    def test_fixtures_correct_names_and_kickoff_of_matching_events(self):
        with patch("requests.get", return_value=response(OPENLIGADB)):
            found = fixtures.openligadb_fixtures("bl1")
        aliases = team_alias_map(fixtures.fixture_aliases(found))
        items = [
            EventItem(1, "a", 1, "C", 0, "Bremen vs Gladbach", KICKOFF - timedelta(minutes=30), "upcoming"),
            EventItem(2, "b", 2, "T", 0, "Werder Bremen - Borussia Monchengladbach", KICKOFF, "upcoming"),
            EventItem(3, "c", 1, "C", 0, "Bremen vs Gladbach", KICKOFF + timedelta(days=7), "upcoming"),
        ]
        clusters = fixtures.apply_fixtures(cluster_events(items, aliases), found, aliases)
        self.assertEqual(len(clusters), 2)
        self.assertEqual(clusters[0].title, "SV Werder Bremen - Borussia Mönchengladbach")
        self.assertEqual(clusters[0].start, KICKOFF)
        self.assertEqual(clusters[0].competition, "1. Fußball-Bundesliga 2026/2027")
        self.assertEqual(len(clusters[0].items), 2)
        # A week later is another match: no fixture, the provider title stays.
        self.assertEqual((clusters[1].title, clusters[1].competition), ("Bremen - Gladbach", ""))


class FixtureSettingsApiTests(TestCase):
    def test_settings_keep_the_key_secret(self):
        self.addCleanup(CoreSettings.set_event_fixture_settings, None)
        client = APIClient()
        client.force_authenticate(get_user_model().objects.create_user(username="fixtures-admin", user_level=10))
        url = "/api/channels/event-groups/fixture-settings/"
        response = client.get(url)
        self.assertEqual(response.data["openligadb_leagues"], ["bl1", "bl2", "dfb", "ucl"])
        self.assertFalse(response.data["thesportsdb_key_set"])
        response = client.put(
            url,
            {"openligadb_leagues": ["bl1", "bl1"], "thesportsdb_leagues": ["4331"], "thesportsdb_key": " key "},
            format="json",
        )
        self.assertEqual(response.data, {
            "openligadb_leagues": ["bl1"], "thesportsdb_leagues": ["4331"], "thesportsdb_key_set": True,
        })
        self.assertNotIn("thesportsdb_key", response.data)
        self.assertEqual(CoreSettings.get_event_fixture_settings()["thesportsdb_key"], "key")
        client.put(url, {"openligadb_leagues": []}, format="json")
        self.assertEqual(CoreSettings.get_event_fixture_settings()["thesportsdb_key"], "key")
        client.put(url, {"thesportsdb_key": ""}, format="json")
        self.assertFalse(client.get(url).data["thesportsdb_key_set"])
        self.assertEqual(client.put(url, {"thesportsdb_leagues": ["abc"]}, format="json").status_code, 400)
