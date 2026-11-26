"""Events of several providers that show the same match are grouped."""

from datetime import datetime, timedelta, timezone

from django.test import SimpleTestCase

from apps.channels.event_matching import (
    DEFAULT_TEAM_ALIASES,
    EventItem,
    cluster_events,
    split_teams,
    team_alias_map,
    team_key,
)

START = datetime(2026, 11, 25, 19, 55, tzinfo=timezone.utc)
ALIASES = team_alias_map(DEFAULT_TEAM_ALIASES)


def item(stream_id, title, start=START, account="C", priority=0):
    return EventItem(stream_id, f"stream {stream_id}", 1, account, priority, title, start, "upcoming")


class TeamTests(SimpleTestCase):
    def test_split_teams_takes_the_match_after_labels(self):
        self.assertEqual(split_teams("Lille - Bayern Munich"), ("Lille", "Bayern Munich"))
        self.assertEqual(
            split_teams("UEFA Europa League | League Phase: AZ Alkmaar - Juventus"),
            ("AZ Alkmaar", "Juventus"),
        )
        self.assertEqual(
            split_teams("Green Bay Packers vs Los Angeles Rams - NF Feed"),
            ("Green Bay Packers", "Los Angeles Rams"),
        )
        self.assertEqual(
            split_teams("Nashville SC vs. FC Cincinnati (English)"),
            ("Nashville SC", "FC Cincinnati"),
        )
        self.assertIsNone(split_teams("MLS Wrap-Up (English)"))

    def test_team_keys_ignore_club_words_accents_and_aliases(self):
        self.assertEqual(team_key("FC Bayern München", ALIASES), team_key("Bayern Munich", ALIASES))
        self.assertEqual(team_key("PSG", ALIASES), team_key("Paris Saint-Germain", ALIASES))
        self.assertEqual(team_key("Atlético Madrid"), team_key("Atletico Madrid"))
        self.assertEqual(team_key("VfB Stuttgart"), team_key("Stuttgart"))
        self.assertNotEqual(team_key("Inter"), team_key("Internazionale"))
        self.assertEqual(team_key("Inter", ALIASES), team_key("Internazionale", ALIASES))


class ClusterTests(SimpleTestCase):
    def test_same_match_from_two_providers_is_one_event(self):
        clusters = cluster_events(
            [
                item(1, "Lille - Bayern Munich"),
                item(2, "Europe - UEFA Champions League : Lille vs FC Bayern München",
                     START + timedelta(minutes=5), account="T", priority=5),
                item(3, "Paris Saint-Germain - Roma", START - timedelta(minutes=10)),
                item(4, "PSG vs Roma", START - timedelta(minutes=10), account="T"),
                item(5, "Lille - Bayern Munich", START + timedelta(days=7)),
            ],
            ALIASES,
        )
        self.assertEqual(
            [(cluster.title, [i.stream_id for i in cluster.items]) for cluster in clusters],
            [
                ("Paris Saint-Germain - Roma", [3, 4]),
                ("Lille - Bayern Munich", [2, 1]),
                ("Lille - Bayern Munich", [5]),
            ],
        )

    def test_untimed_events_group_by_title(self):
        clusters = cluster_events(
            [item(1, "UFC 334: Multiview", None), item(2, "UFC 334: MULTIVIEW", None),
             item(3, "UFC 334: Multiview")],
        )
        self.assertEqual([len(cluster.items) for cluster in clusters], [1, 2])
        self.assertEqual(clusters[1].status, "upcoming")
