import os
from datetime import timedelta
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.vod.api_views import VODMetadataViewSet
from apps.vod.models import VODMetadataState
from apps.vod.tasks import reconcile_vod_metadata_queue
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
