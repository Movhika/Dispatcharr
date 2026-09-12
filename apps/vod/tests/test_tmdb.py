import os
from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.models import M3UAccount
from apps.vod.api_views import VODMetadataViewSet, VODSourceAssetViewSet
from apps.vod.models import (
    Episode,
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    Movie,
    Series,
    VODMetadataState,
)
from apps.vod.tasks import enqueue_tmdb_enrichment, reconcile_vod_metadata_queue
from apps.vod.tmdb import (
    Client,
    clean_lookup_title,
    normalize_details,
    normalize_title_rules,
    preferred_title,
)
from core.models import CoreSettings


class TMDBMetadataTests(SimpleTestCase):
    def test_lookup_title_cleanup_handles_provider_prefixes_and_release_year(self):
        for raw in (
            "4K-AMZ - Bliss (2021)",
            "DE - Bliss (2021)",
            "AMZ - Bliss (2021)",
            "┃DE┃ Bliss (2021)",
        ):
            with self.subTest(raw=raw):
                self.assertEqual(
                    clean_lookup_title(raw, year=2021),
                    "Bliss",
                )

    def test_lookup_title_cleanup_also_cleans_a_canonical_display_name(self):
        self.assertEqual(
            clean_lookup_title(
                "provider fallback",
                display_name="4K-AMZ - Bliss (2021)",
                year=2021,
            ),
            "Bliss",
        )

    def test_lookup_title_cleanup_applies_ordered_custom_rules(self):
        self.assertEqual(
            clean_lookup_title(
                "WEB Bliss Director Cut [2021]",
                year=2021,
                rules=[
                    {"pattern": r"^WEB\s+", "replacement": ""},
                    {"pattern": r"\s+Director Cut", "replacement": ""},
                ],
            ),
            "Bliss",
        )
        with self.assertRaisesRegex(ValueError, "invalid expression"):
            normalize_title_rules([{"pattern": "[", "replacement": ""}])

    def test_normalizes_original_localized_and_watch_provider_data(self):
        metadata = normalize_details(
            {
                "id": 76600,
                "title": "Avatar: The Way of Water",
                "original_title": "Avatar: The Way of Water",
                "original_language": "en",
                "release_date": "2022-12-14",
                "genres": [{"id": 878, "name": "Science Fiction"}],
                "production_countries": [
                    {"iso_3166_1": "US", "name": "United States of America"}
                ],
                "credits": {
                    "cast": [{"name": "Sam Worthington"}, {"name": "Zoe Saldaña"}],
                    "crew": [
                        {"name": "James Cameron", "job": "Director"},
                        {"name": "Someone Else", "job": "Producer"},
                    ],
                },
                "videos": {
                    "results": [
                        {
                            "site": "YouTube",
                            "key": "trailer-key",
                            "type": "Trailer",
                            "official": True,
                            "size": 1080,
                        }
                    ]
                },
                "release_dates": {
                    "results": [
                        {
                            "iso_3166_1": "DE",
                            "release_dates": [
                                {"certification": "12", "type": 3}
                            ],
                        }
                    ]
                },
                "poster_path": "/poster.jpg",
                "backdrop_path": "/backdrop.jpg",
                "external_ids": {
                    "imdb_id": "tt1630029",
                    "wikidata_id": "Q27964338",
                },
                "translations": {
                    "translations": [
                        {
                            "iso_639_1": "de",
                            "iso_3166_1": "DE",
                            "data": {
                                "title": "Avatar: The Way of Water",
                                "overview": "Deutsche Beschreibung",
                            },
                        },
                        {
                            "iso_639_1": "en",
                            "iso_3166_1": "US",
                            "data": {
                                "title": "Avatar: The Way of Water",
                                "overview": "English overview",
                            },
                        },
                    ]
                },
                "watch/providers": {
                    "results": {
                        "DE": {
                            "link": "https://www.themoviedb.org/movie/76600/watch",
                            "flatrate": [
                                {
                                    "provider_id": 337,
                                    "provider_name": "Disney Plus",
                                    "logo_path": "/logo.jpg",
                                    "display_priority": 1,
                                }
                            ],
                        }
                    }
                },
            },
            "movie",
            ["de-DE", "en-US"],
            match_method="provider_tmdb_id",
        )

        self.assertNotIn("original_title", metadata)
        self.assertEqual(
            metadata["localized"]["de-DE"]["overview"],
            "Deutsche Beschreibung",
        )
        self.assertEqual(
            metadata["watch_providers"]["DE"]["flatrate"][0]["name"],
            "Disney Plus",
        )
        self.assertEqual(preferred_title(metadata, "en-US"), "Avatar: The Way of Water")
        self.assertEqual(
            metadata["poster_url"],
            "https://image.tmdb.org/t/p/w500/poster.jpg",
        )
        self.assertEqual(
            metadata["backdrop_url"],
            "https://image.tmdb.org/t/p/w1280/backdrop.jpg",
        )
        self.assertEqual(metadata["external_ids"]["imdb_id"], "tt1630029")
        self.assertEqual(metadata["director"], "James Cameron")
        self.assertEqual(metadata["actors"], "Sam Worthington, Zoe Saldaña")
        self.assertEqual(metadata["crew"], "Someone Else (Producer)")
        self.assertEqual(metadata["country"], "United States of America")
        self.assertEqual(metadata["youtube_trailer"], "trailer-key")
        self.assertEqual(metadata["age_rating"], "12")

    def test_detail_request_includes_richer_movie_metadata(self):
        response = Mock(status_code=200, headers={})
        response.raise_for_status.return_value = None
        response.json.return_value = {"id": 613911, "title": "Bliss"}
        session = Mock()
        session.get.return_value = response

        Client("v3-api-key", session=session, min_interval=0).details(
            "613911", "movie", ["de-DE", "en-US"], match_method="manual"
        )

        params = session.get.call_args.kwargs["params"]
        appended = set(params["append_to_response"].split(","))
        self.assertTrue(
            {
                "translations",
                "external_ids",
                "watch/providers",
                "credits",
                "videos",
                "release_dates",
            }.issubset(appended)
        )

    def test_search_accepts_only_one_exact_title_and_year_match(self):
        response = Mock(status_code=200, headers={})
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "results": [
                {
                    "id": 1,
                    "title": "Avatar",
                    "original_title": "Avatar",
                    "release_date": "2009-12-10",
                },
                {
                    "id": 2,
                    "title": "Avatar 2",
                    "original_title": "Avatar 2",
                    "release_date": "2022-12-14",
                },
            ]
        }
        session = Mock()
        session.get.return_value = response
        client = Client("v3-api-key", session=session, min_interval=0)

        self.assertEqual(client.search("Avatar", 2009, "movie", "de-DE"), "1")

    def test_search_rejects_ambiguous_exact_matches(self):
        response = Mock(status_code=200, headers={})
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "results": [
                {"id": 1, "name": "The Office", "first_air_date": "2005-03-24"},
                {"id": 2, "name": "The Office", "first_air_date": "2005-01-01"},
            ]
        }
        session = Mock()
        session.get.return_value = response
        client = Client("v3-api-key", session=session, min_interval=0)

        self.assertEqual(client.search("The Office", 2005, "tv", "en-US"), "")


class VODMetadataAPITests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username="tmdb-admin",
            password="test-password",
            user_level=10,
        )
        self.factory = APIRequestFactory()

    @patch.dict(
        os.environ,
        {"TMDB_API_READ_ACCESS_TOKEN": "", "TMDB_API_KEY": ""},
    )
    def test_status_reports_configuration_without_exposing_token(self):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["de-DE", "en-US"],
            auto_enrich=True,
            match_missing=False,
        )
        request = self.factory.get("/api/vod/metadata/")
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"get": "list"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["settings"]["token_configured"])
        self.assertEqual(response.data["settings"]["token_source"], "stored")
        self.assertNotIn("api_token", response.data["settings"])

    def test_settings_normalizes_at_most_two_locales(self):
        request = self.factory.put(
            "/api/vod/metadata/settings/",
            {
                "languages": ["de-de", "en-us"],
                "auto_enrich": True,
                "match_missing": True,
                "api_token": "stored-secret",
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"put": "update_settings"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["settings"]["languages"], ["de-DE", "en-US"])
        self.assertTrue(CoreSettings.get_tmdb_match_missing())

    def test_api_key_only_update_preserves_library_metadata_preferences(self):
        CoreSettings.set_vod_metadata_settings(
            api_token="old-secret",
            languages=["de-DE", "en-US"],
            auto_enrich=False,
            match_missing=True,
            prefer_artwork=False,
            title_rules=[
                {"pattern": r"^AMZ\s*-\s*", "replacement": ""}
            ],
        )
        request = self.factory.put(
            "/api/vod/metadata/settings/",
            {"api_token": "new-secret", "auto_enrich": True},
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"put": "update_settings"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(CoreSettings.get_tmdb_languages(), ["de-DE", "en-US"])
        self.assertTrue(CoreSettings.get_tmdb_match_missing())
        self.assertFalse(CoreSettings.get_tmdb_prefer_artwork())
        self.assertTrue(CoreSettings.get_tmdb_auto_enrich())
        self.assertEqual(
            CoreSettings.get_tmdb_title_rules(),
            [
                {
                    "pattern": r"^AMZ\s*-\s*",
                    "replacement": "",
                    "enabled": True,
                }
            ],
        )

    def test_title_preview_uses_the_requested_visible_canonical_rows(self):
        movie = Movie.objects.create(
            name="DE - Bliss (2021)",
            display_name="DE - Bliss (2021)",
            year=2021,
        )
        series = Series.objects.create(
            name="AMZ - The Office [2005]",
            display_name="AMZ - The Office [2005]",
            year=2005,
        )
        request = self.factory.post(
            "/api/vod/metadata/title-preview/",
            {
                "title_rules": [
                    {
                        "pattern": r"^The\s+",
                        "replacement": "",
                        "enabled": True,
                    }
                ],
                "items": [
                    {"id": series.id, "content_type": "series"},
                    {"id": movie.id, "content_type": "movie"},
                ],
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "title_preview"})(
            request
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [
                (row["content_type"], row["id"], row["before"], row["after"])
                for row in response.data["results"]
            ],
            [
                (
                    "series",
                    series.id,
                    "AMZ - The Office [2005]",
                    "Office",
                ),
                ("movie", movie.id, "DE - Bliss (2021)", "Bliss"),
            ],
        )

    def test_manual_tmdb_match_moves_only_the_selected_provider_source(self):
        account = M3UAccount.objects.create(
            name="TMDB test",
            server_url="http://provider.example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
        )
        movie = Movie.objects.create(
            name="Wrong provider match",
            tmdb_id="111",
            tmdb_match_id="111",
            tmdb_metadata={"id": "111", "status": "matched"},
            tmdb_status="matched",
            tmdb_enriched_at=timezone.now(),
        )
        target = Movie.objects.create(
            name="Correct title",
            tmdb_id="76600",
            tmdb_match_id="76600",
            tmdb_metadata={"id": "76600", "status": "matched"},
            tmdb_status="matched",
        )
        relation = M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            stream_id="movie-1",
        )
        request = self.factory.patch(
            "/api/vod/source-assets/relation-tmdb-match/",
            {
                "tmdb_id": "76600",
                "selections": [
                    {"content_type": "movie", "relation_id": relation.id}
                ],
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        view = VODSourceAssetViewSet.as_view({"patch": "relation_tmdb_match"})
        response = view(request)

        self.assertEqual(response.status_code, 409)

        confirmed_request = self.factory.patch(
            "/api/vod/source-assets/relation-tmdb-match/",
            {
                "tmdb_id": "76600",
                "confirmed": True,
                "selections": [
                    {"content_type": "movie", "relation_id": relation.id}
                ],
            },
            format="json",
        )
        force_authenticate(confirmed_request, user=self.admin)
        with (
            patch(
                "apps.vod.profile_selection.refresh_profile_selections_for_content"
            ),
            patch("apps.vod.catalog_cache.bump_catalog_generation") as bump_catalog,
        ):
            response = view(confirmed_request)

        movie.refresh_from_db()
        relation.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(movie.tmdb_id, "111")
        self.assertEqual(relation.movie_id, target.id)
        self.assertEqual(relation.tmdb_override_id, "76600")
        self.assertEqual(response.data["moved_sources"], 1)
        bump_catalog.assert_not_called()

    def test_manual_series_match_moves_its_episode_sources(self):
        account = M3UAccount.objects.create(
            name="TMDB series test",
            server_url="http://provider.example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
        )
        original = Series.objects.create(
            name="Wrong series",
            tmdb_id="111",
            tmdb_match_id="111",
        )
        target = Series.objects.create(
            name="Correct series",
            tmdb_id="1399",
            tmdb_match_id="1399",
            tmdb_metadata={"id": "1399", "status": "matched"},
            tmdb_status="matched",
        )
        relation = M3USeriesRelation.objects.create(
            m3u_account=account,
            series=original,
            external_series_id="series-1",
        )
        episode = Episode.objects.create(
            series=original,
            name="Provider episode",
            season_number=1,
            episode_number=2,
        )
        episode_relation = M3UEpisodeRelation.objects.create(
            m3u_account=account,
            series_relation=relation,
            episode=episode,
            stream_id="episode-1",
        )
        request = self.factory.patch(
            "/api/vod/source-assets/relation-tmdb-match/",
            {
                "tmdb_id": "1399",
                "confirmed": True,
                "selections": [
                    {"content_type": "series", "relation_id": relation.id}
                ],
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        with (
            patch(
                "apps.vod.profile_selection.refresh_profile_selections_for_content"
            ),
            patch("apps.vod.catalog_cache.bump_catalog_generation") as bump_catalog,
        ):
            response = VODSourceAssetViewSet.as_view(
                {"patch": "relation_tmdb_match"}
            )(request)

        relation.refresh_from_db()
        episode_relation.refresh_from_db()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(relation.series_id, target.id)
        self.assertEqual(episode_relation.episode.series_id, target.id)
        self.assertEqual(episode_relation.episode.season_number, 1)
        self.assertEqual(episode_relation.episode.episode_number, 2)
        bump_catalog.assert_not_called()

    def test_watchdog_ends_a_lost_running_status(self):
        state = VODMetadataState.objects.create(
            status=VODMetadataState.Status.RUNNING,
            task_id="lost-task",
            progress={"phase": "Fetching TMDB metadata", "percent": 12},
        )
        VODMetadataState.objects.filter(pk=state.pk).update(
            updated_at=timezone.now() - timedelta(minutes=20)
        )

        with (
            patch("celery.result.AsyncResult") as async_result,
            patch("apps.vod.tasks.is_task_lock_held", return_value=False),
        ):
            async_result.return_value.state = "PENDING"
            result = reconcile_vod_metadata_queue.run()

        state.refresh_from_db()
        self.assertTrue(result["repaired"])
        self.assertEqual(state.status, VODMetadataState.Status.FAILED)

    def test_active_enrichment_records_one_follow_up_pass(self):
        state = VODMetadataState.objects.create(
            status=VODMetadataState.Status.RUNNING,
            task_id="active-task",
        )

        result = enqueue_tmdb_enrichment(
            trigger_reason="A manual match changed during the active pass",
        )

        state.refresh_from_db()
        self.assertFalse(result["queued"])
        self.assertTrue(state.rerun_requested)
