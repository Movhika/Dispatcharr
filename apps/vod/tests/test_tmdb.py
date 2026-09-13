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
    VODAccessPolicy,
    VODMovieProfileSelection,
    VODMetadataState,
)
from apps.vod.profile_selection import profile_ids_using_canonical_content
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
    def test_lookup_title_does_not_hide_provider_prefix_cleanup(self):
        self.assertEqual(
            clean_lookup_title("4K-AMZ - Bliss (2021)", year=2021),
            "4K-AMZ - Bliss",
        )

    def test_lookup_title_uses_the_canonical_display_name_verbatim(self):
        self.assertEqual(
            clean_lookup_title(
                "provider fallback",
                display_name="4K-AMZ - Bliss (2021)",
                year=2021,
            ),
            "4K-AMZ - Bliss",
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
                "keywords": {
                    "keywords": [
                        {"id": 210024, "name": "anime"},
                        {"id": 9715, "name": "superhero"},
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
        self.assertEqual(
            metadata["keywords"],
            [
                {"id": 210024, "name": "anime"},
                {"id": 9715, "name": "superhero"},
            ],
        )
        self.assertTrue(metadata["is_anime"])

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
                "keywords",
                "release_dates",
            }.issubset(appended)
        )

    def test_manual_overrides_keep_the_tmdb_identity(self):
        from apps.vod.tmdb import apply_manual_overrides

        metadata = apply_manual_overrides(
            {"id": "613911", "rating": 5.5},
            {"id": "", "rating": "7.0"},
        )

        self.assertEqual(metadata["id"], "613911")
        self.assertEqual(metadata["rating"], "7.0")
        self.assertEqual(metadata["_manual_overrides"], {"rating": "7.0"})

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

    def test_canonical_changes_only_mark_profiles_that_embed_the_title(self):
        account = M3UAccount.objects.create(
            name="Canonical profile scope",
            server_url="http://provider.example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
        )
        movie = Movie.objects.create(name="Bliss")
        relation = M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            stream_id="movie-1",
        )
        compact = VODAccessPolicy.objects.create(
            name="Compact canonical",
            export_mode=VODAccessPolicy.ExportMode.COMPACT,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="compact-generation",
        )
        provider_variants = VODAccessPolicy.objects.create(
            name="Provider variants",
            export_mode=VODAccessPolicy.ExportMode.VARIANTS,
            metadata_source=VODAccessPolicy.MetadataSource.PROVIDER,
            naming_mode=VODAccessPolicy.NamingMode.MODE_DEFAULT,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="provider-generation",
        )
        canonical_variants = VODAccessPolicy.objects.create(
            name="Canonical variants",
            export_mode=VODAccessPolicy.ExportMode.VARIANTS,
            metadata_source=VODAccessPolicy.MetadataSource.CANONICAL,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="canonical-generation",
        )
        excluded_compact = VODAccessPolicy.objects.create(
            name="Excluded compact",
            export_mode=VODAccessPolicy.ExportMode.COMPACT,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="excluded-generation",
        )
        for policy in (compact, provider_variants, canonical_variants):
            VODMovieProfileSelection.objects.create(
                policy=policy,
                generation=policy.active_selection_generation,
                movie=movie,
                relation=relation,
            )

        policy_ids = profile_ids_using_canonical_content(movie_ids=[movie.id])

        self.assertEqual(
            policy_ids,
            sorted([compact.id, canonical_variants.id]),
        )
        self.assertNotIn(provider_variants.id, policy_ids)
        self.assertNotIn(excluded_compact.id, policy_ids)

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

    @patch("apps.vod.tmdb.Client.search_candidates")
    def test_tmdb_lookup_returns_candidates_without_writing_content(self, search):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["en-US"],
            auto_enrich=False,
            match_missing=False,
        )
        search.return_value = [
            {
                "id": "613911",
                "title": "Bliss",
                "year": 2021,
                "overview": "Search preview",
            }
        ]
        request = self.factory.post(
            "/api/vod/metadata/tmdb-lookup/",
            {"content_type": "movie", "query": "Bliss", "year": 2021},
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "tmdb_lookup"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["id"], "613911")
        search.assert_called_once_with("Bliss", 2021, "movie", "en-US")

    def test_canonical_metadata_editor_persists_keywords_and_manual_values(self):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["de-DE", "en-US"],
            auto_enrich=False,
            match_missing=False,
        )
        movie = Movie.objects.create(
            name="Provider Bliss",
            tmdb_metadata={"id": "613911", "status": "matched"},
            tmdb_status="matched",
        )
        request = self.factory.patch(
            "/api/vod/metadata/content/",
            {
                "content_type": "movie",
                "id": movie.id,
                "values": {
                    "title": "Bliss",
                    "secondary_title": "Bliss",
                    "description": "Deutsche Beschreibung",
                    "secondary_description": "English overview",
                    "year": "2021",
                    "release_date": "2021-02-05",
                    "duration_minutes": "103",
                    "rating": "6.5",
                    "genre": "Science Fiction, Drama",
                    "age_rating": "12",
                    "director": "Mike Cahill",
                    "actors": "Owen Wilson, Salma Hayek",
                    "crew": "Crew Member",
                    "country": "United States",
                    "youtube_trailer": "trailer-key",
                    "poster_url": "https://image.example/poster.jpg",
                    "backdrop_url": "https://image.example/backdrop.jpg",
                    "tmdb_id": "613911",
                    "imdb_id": "tt10333426",
                    "tvdb_id": "",
                    "wikidata_id": "Q123",
                    "keywords": ["anime", "virtual reality"],
                    "is_anime": True,
                    "adult": False,
                },
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        with patch(
            "apps.vod.profile_selection.mark_profile_selections_outdated"
        ) as mark_outdated:
            response = VODMetadataViewSet.as_view({"patch": "update_content"})(
                request
            )

        self.assertEqual(response.status_code, 200, response.data)
        movie.refresh_from_db()
        self.assertEqual(movie.display_name, "Bliss")
        self.assertEqual(movie.duration_secs, 103 * 60)
        self.assertEqual(movie.tmdb_match_id, "613911")
        self.assertEqual(movie.tmdb_metadata["external_ids"]["imdb_id"], "tt10333426")
        self.assertEqual(
            [row["name"] for row in movie.tmdb_metadata["keywords"]],
            ["anime", "virtual reality"],
        )
        self.assertTrue(movie.tmdb_metadata["is_anime"])
        self.assertEqual(
            movie.custom_properties["_manual_metadata"]["display_name"],
            "Bliss",
        )
        mark_outdated.assert_called_once_with(
            trigger_reason="Canonical VOD metadata was edited manually",
            policy_ids=[],
        )

    def test_manual_enrichment_requires_an_explicit_selection(self):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["en-US"],
            auto_enrich=False,
            match_missing=False,
        )
        request = self.factory.post(
            "/api/vod/metadata/refresh/",
            {"selections": []},
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "refresh"})(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("selections", response.data)

    @patch("apps.vod.tasks.enqueue_tmdb_enrichment")
    def test_manual_enrichment_can_select_all_matching_server_side(self, enqueue):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["en-US"],
            auto_enrich=False,
            match_missing=False,
        )
        enqueue.return_value = {
            "queued": True,
            "task_id": "task",
            "status": "queued",
        }
        request = self.factory.post(
            "/api/vod/metadata/refresh/",
            {
                "select_all": True,
                "selections": [],
                "exclude_selections": [
                    {"id": 9, "content_type": "movie"}
                ],
                "filters": {
                    "type": "movies",
                    "search": "Bliss",
                    "metadata_status": "missing_metadata",
                },
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "refresh"})(request)

        self.assertEqual(response.status_code, 202)
        enqueue.assert_called_once_with(
            trigger_reason="Manual TMDB metadata refresh",
            force=True,
            movie_ids=None,
            series_ids=None,
            selection_filters={
                "type": "movies",
                "search": "Bliss",
                "metadata_status": "missing_metadata",
            },
            exclude_movie_ids=[9],
            exclude_series_ids=[],
        )

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
                        "pattern": r"^(?:DE|AMZ)\s*-\s*",
                        "replacement": "",
                        "enabled": True,
                    },
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

    @patch("apps.vod.tasks.enqueue_tmdb_enrichment")
    def test_tmdb_reset_clears_only_curated_snapshot_then_reloads_selection(
        self, enqueue
    ):
        CoreSettings.set_vod_metadata_settings(
            api_token="stored-secret",
            languages=["en-US"],
            auto_enrich=False,
            match_missing=False,
        )
        movie = Movie.objects.create(
            name="Provider title",
            display_name="TMDB title",
            tmdb_id="123",
            description="Provider description",
            tmdb_match_id="123",
            tmdb_imdb_id="tt123",
            tmdb_metadata={"id": "123", "status": "matched"},
            tmdb_status="matched",
            tmdb_enriched_at=timezone.now(),
            tmdb_enrichment_signature="old-signature",
        )
        enqueue.return_value = {"queued": True, "task_id": "task", "status": "queued"}
        request = self.factory.post(
            "/api/vod/metadata/reset/",
            {
                "mode": "tmdb",
                "selections": [{"id": movie.id, "content_type": "movie"}],
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "reset"})(request)

        self.assertEqual(response.status_code, 202)
        movie.refresh_from_db()
        self.assertEqual(movie.name, "Provider title")
        self.assertEqual(movie.description, "Provider description")
        self.assertEqual(movie.tmdb_id, "123")
        self.assertEqual(movie.display_name, "")
        self.assertEqual(movie.tmdb_metadata, {})
        self.assertEqual(movie.tmdb_status, "")
        self.assertEqual(movie.tmdb_match_id, "123")
        self.assertEqual(movie.tmdb_imdb_id, "tt123")
        enqueue.assert_called_once_with(
            trigger_reason="Selected VOD metadata was reset",
            force=True,
            movie_ids=[movie.id],
            series_ids=[],
        )

    def test_provider_reset_rebuilds_canonical_fields_from_stored_sources(self):
        account = M3UAccount.objects.create(
            name="Provider metadata",
            server_url="http://provider.example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
        )
        movie = Movie.objects.create(
            name="Provider title",
            display_name="TMDB title",
            description="Stale description",
            custom_properties={
                "_manual_metadata": {
                    "description": "Manual description",
                    "youtube_trailer": "manual-trailer",
                }
            },
            tmdb_metadata={"id": "123", "status": "matched"},
            tmdb_match_id="123",
            tmdb_status="matched",
            tmdb_enriched_at=timezone.now(),
        )
        M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            stream_id="movie-1",
            custom_properties={
                "detailed_info": {
                    "name": "Fresh provider title",
                    "plot": "Fresh provider description",
                    "trailer": "provider-trailer",
                }
            },
        )
        request = self.factory.post(
            "/api/vod/metadata/reset/",
            {
                "mode": "provider",
                "selections": [{"id": movie.id, "content_type": "movie"}],
            },
            format="json",
        )
        force_authenticate(request, user=self.admin)

        response = VODMetadataViewSet.as_view({"post": "reset"})(request)

        self.assertEqual(response.status_code, 200)
        movie.refresh_from_db()
        self.assertEqual(movie.description, "Fresh provider description")
        self.assertEqual(movie.display_name, "Fresh provider title")
        self.assertEqual(movie.tmdb_metadata, {})
        self.assertEqual(movie.tmdb_status, "")
        self.assertEqual(
            movie.custom_properties["youtube_trailer"], "provider-trailer"
        )
        self.assertNotIn("_manual_metadata", movie.custom_properties)

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
                "apps.vod.profile_selection.mark_profile_selections_outdated"
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
        bump_catalog.assert_called_once_with(invalidate_selections=False)

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
                "apps.vod.profile_selection.mark_profile_selections_outdated"
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
        bump_catalog.assert_called_once_with(invalidate_selections=False)

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
