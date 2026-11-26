"""Event details are read from the stream names of event categories."""

from datetime import datetime, timezone

from django.test import SimpleTestCase

from apps.m3u.event_parser import (
    ENDED,
    LIVE,
    NONE,
    UNKNOWN,
    UPCOMING,
    normalize_config,
    parse_event,
)

NOW = datetime(2026, 11, 25, 18, 30, tzinfo=timezone.utc)


def parse(name, **config):
    return parse_event(name, config, now=NOW)


class ParseEventTests(SimpleTestCase):
    def test_reads_title_and_start_with_named_timezones(self):
        event = parse("UEFA Champions League 04: Sporting CP - Manchester United @ 25 Nov 07:00 PM London")
        self.assertEqual(event.title, "Sporting CP - Manchester United")
        self.assertEqual(event.start, datetime(2026, 11, 25, 19, 0, tzinfo=timezone.utc))
        self.assertEqual(event.status, UPCOMING)
        event = parse("NFL Game Pass 02: Green Bay Packers vs Los Angeles Rams @ Nov 25 08:00 PM ET")
        self.assertEqual(event.start, datetime(2026, 11, 26, 1, 0, tzinfo=timezone.utc))
        self.assertEqual((event.home, event.away), ("Green Bay Packers", "Los Angeles Rams"))
        event = parse("MLS 03 | Nashville SC vs. FC Cincinnati (English) @ 25 Nov 05:10 PM ET")
        self.assertEqual(event.title, "Nashville SC vs. FC Cincinnati (English)")
        self.assertEqual(event.status, UPCOMING)

    def test_status_follows_start_and_duration(self):
        self.assertEqual(parse("Bundesliga 01: Augsburg vs. Mainz @ 25 Nov 05:00 PM UTC").status, LIVE)
        self.assertEqual(
            parse("Bundesliga 01: Augsburg vs. Mainz @ 25 Nov 05:00 PM UTC", event_duration_minutes=60).status,
            ENDED,
        )
        # Without a year the date nearest to now counts: August is past.
        self.assertEqual(
            parse("Sky Sports + DE 01: ATP Winston-Salem M. Bellucci - L. Darderi Aug 25 7:55 PM CEST").status,
            ENDED,
        )

    def test_start_and_stop_keys_use_the_category_timezone(self):
        event = parse(
            "UFC event: 1 name: UFC FIGHT NIGHT: PROCHAZKA VS STIRLING  start:2026-11-25 18:55:00 stop:2026-11-25 22:00:00",
            event_timezone="Europe/Berlin",
        )
        self.assertEqual(event.title, "UFC FIGHT NIGHT: PROCHAZKA VS STIRLING")
        self.assertEqual(event.start, datetime(2026, 11, 25, 17, 55, tzinfo=timezone.utc))
        self.assertEqual(event.end, datetime(2026, 11, 25, 21, 0, tzinfo=timezone.utc))
        self.assertEqual(event.status, LIVE)

    def test_provider_quirks(self):
        event = parse("NFL Game Pass 04: [4K] Green Bay Packers vs Los Angeles Rams @ Nov 25 08:00 PM ET - NF Feed")
        self.assertEqual(event.title, "[4K] Green Bay Packers vs Los Angeles Rams - NF Feed")
        self.assertEqual(parse("UCL┃ TABII SPOR 6 HD [TR]").title, "UCL┃ TABII SPOR 6 HD [TR]")
        event = parse("Great Britain vs Germany @ Nov 26 10:00 AM - Davis Cup :Tennis  02")
        self.assertEqual(event.title, "Great Britain vs Germany - Davis Cup")
        event = parse("USA Soccer06: Europe - UEFA Champions League : PSG vs Tottenham @ 03:00pm EST")
        self.assertEqual(event.title, "Europe - UEFA Champions League : PSG vs Tottenham")
        self.assertEqual(event.start, datetime(2026, 11, 25, 20, 0, tzinfo=timezone.utc))
        self.assertEqual(parse("☰☰☰☰ PPV EVENT┃ ☰☰☰☰").status, NONE)
        # Dates far ahead belong to the past year: an old slot from March.
        event = parse("DE┃ UFC EVENT 7 | SAMOURAI MMA 13 SAT 8 MAR 12:00AM ET")
        self.assertEqual((event.start.year, event.status), (2026, ENDED))

    def test_time_only_names_start_today(self):
        event = parse("LIVE EVENT 02 - 8PM AEW Dynamite (Commercial Free)", event_timezone="ET")
        self.assertEqual(event.title, "AEW Dynamite (Commercial Free)")
        self.assertEqual(event.start, datetime(2026, 11, 26, 1, 0, tzinfo=timezone.utc))

    def test_empty_slots_and_no_event_names(self):
        for name in (
            "UFC 05 :",
            "LIVE EVENT 34 -",
            ":Tennis  50",
            "USA Soccer70:",
            "DE┃ PPV LIVE EVENT 34 |",
            "UEFA Champions League 18: NO EVENT",
            "UEFA Champions League 20",
            "[PPV EVENT 40]",
            "",
        ):
            with self.subTest(name=name):
                self.assertEqual(parse(name).status, NONE)

    def test_titles_without_time_are_unknown(self):
        event = parse("LIVE EVENT 32 - QUASAR Live From Coachella 2026")
        self.assertEqual((event.status, event.title), (UNKNOWN, "QUASAR Live From Coachella 2026"))
        self.assertEqual(parse("Sky Box Office 4: HEVC FHD Eubank Jr vs Benn").status, UNKNOWN)

    def test_custom_pattern_wins_and_falls_back(self):
        pattern = r"^EVENT (?P<time>\d{2}:\d{2}) (?P<title>.+)$"
        event = parse("EVENT 20:15 Derby", event_pattern=pattern, event_timezone="UTC")
        self.assertEqual(event.title, "Derby")
        self.assertIsNone(event.start)
        pattern = r"^(?P<title>.+?) \| (?P<date>\d{2}\.\d{2}\.\d{4}) (?P<time>\d{2}:\d{2})$"
        event = parse("Derby | 25.11.2026 20:15", event_pattern=pattern, event_timezone="Europe/Berlin")
        self.assertEqual(event.start, datetime(2026, 11, 25, 19, 15, tzinfo=timezone.utc))
        self.assertEqual(parse("MLS 11: NO EVENT", event_pattern=pattern).status, NONE)


class NormalizeConfigTests(SimpleTestCase):
    def test_defaults_and_validation(self):
        self.assertEqual(
            normalize_config({}),
            {
                "event_timezone": "UTC",
                "event_duration_minutes": 180,
                "event_pattern": "",
                "event_filter": "all",
                "event_channel_name": False,
            },
        )
        self.assertEqual(normalize_config({"event_timezone": "ET"})["event_timezone"], "ET")
        for config in (
            {"event_timezone": "Mars/Base"},
            {"event_duration_minutes": 0},
            {"event_duration_minutes": "long"},
            {"event_pattern": "(unclosed"},
            {"event_pattern": "no title"},
            {"event_filter": "some"},
        ):
            with self.subTest(config=config), self.assertRaises(ValueError):
                normalize_config(config)
