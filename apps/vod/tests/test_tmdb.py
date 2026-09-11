import os
from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.models import M3UAccount
from apps.vod.api_views import MovieViewSet, VODMetadataViewSet
from apps.vod.models import M3UMovieRelation, Movie, VODMetadataState
from apps.vod.tasks import enqueue_tmdb_enrichment, reconcile_vod_metadata_queue
from apps.vod.tmdb import Client, normalize_details, preferred_title
from core.models import CoreSettings


class TMDBMetadataTests(SimpleTestCase):
    def test_normalizes_original_localized_and_watch_provider_data(self):
        metadata = normalize_details(
            {
                "id": 76600,
                "title": "Avatar: The Way of Water",
                "original_title": "Avatar: The Way of Water",
                "original_language": "en",
                "release_date": "2022-12-14",
                "genres": [{"id": 878, "name": "Science Fiction"}],
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

        self.assertEqual(metadata["original_title"], "Avatar: The Way of Water")
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

        response = VODMetadataViewSet.as_view({"put": "settings"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["settings"]["languages"], ["de-DE", "en-US"])
        self.assertTrue(CoreSettings.get_tmdb_match_missing())

    @patch.dict(
        os.environ,
        {"TMDB_API_READ_ACCESS_TOKEN": "", "TMDB_API_KEY": ""},
    )
    def test_manual_tmdb_match_preserves_provider_identity(self):
        CoreSettings.set_vod_metadata_settings(
            api_token="",
            languages=["de-DE", "en-US"],
            auto_enrich=True,
            match_missing=False,
        )
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
        )
        M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            stream_id="movie-1",
        )
        request = self.factory.patch(
            f"/api/vod/movies/{movie.id}/tmdb-match/",
            {"tmdb_id": "76600"},
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = MovieViewSet.as_view({"patch": "tmdb_match"})(
            request, pk=movie.pk
        )

        movie.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(movie.tmdb_id, "111")
        self.assertEqual(movie.tmdb_override_id, "76600")
        self.assertEqual(response.data["tmdb"]["id"], "76600")
        self.assertEqual(response.data["refresh"]["status"], "token_not_configured")

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
