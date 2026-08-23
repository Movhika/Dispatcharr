from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.models import M3UAccount
from apps.output.views import xc_get_vod_categories, xc_get_vod_streams
from apps.vod.metadata import (
    ensure_source_asset,
    ensure_source_assets,
    normalize_language_list,
)
from apps.vod.playback import record_playback_selection
from apps.vod.serializers import VODPlaybackSessionSerializer
from apps.vod.models import (
    M3UMovieRelation,
    M3UVODCategoryRelation,
    Movie,
    VODAccessPolicy,
    VODPlaybackSession,
    VODSourceAsset,
    VODCategory,
)
from apps.vod.policies import (
    ordered_failover_candidates,
    select_relation_ids_for_policy,
    select_relations_for_policy,
)
from apps.vod.api_views import VODSourceAssetViewSet


class VODSourceManagementTests(TestCase):
    def setUp(self):
        self.movie = Movie.objects.create(name="Avatar", year=2005)
        self.german = VODCategory.objects.create(
            name="GERMANY KINDER", category_type="movie"
        )
        self.english = VODCategory.objects.create(
            name="NETFLIX ANIME", category_type="movie"
        )
        self.account_a = M3UAccount.objects.create(
            name="provider-a",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="a",
            password="secret",
            priority=1,
        )
        self.account_b = M3UAccount.objects.create(
            name="provider-b",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="b",
            password="secret",
            priority=10,
        )
        self.german_category = M3UVODCategoryRelation.objects.create(
            m3u_account=self.account_a,
            category=self.german,
            enabled=True,
            metadata_defaults={
                "audio_languages": ["deu"],
                "resolution": "1080p",
            },
        )
        self.english_category = M3UVODCategoryRelation.objects.create(
            m3u_account=self.account_b,
            category=self.english,
            enabled=True,
            metadata_defaults={
                "audio_languages": ["eng"],
                "resolution": "2160p",
            },
        )
        self.german_relation = M3UMovieRelation.objects.create(
            m3u_account=self.account_a,
            movie=self.movie,
            category=self.german,
            stream_id="42",
        )
        self.english_relation = M3UMovieRelation.objects.create(
            m3u_account=self.account_b,
            movie=self.movie,
            category=self.english,
            stream_id="42",
        )
        self.policy = VODAccessPolicy.objects.create(
            name="German only",
            export_mode=VODAccessPolicy.ExportMode.COMPACT,
            hard_constraints={
                "required_audio_languages": ["deu"],
                "allow_unknown_metadata": False,
            },
            ranking=["audio_language", "subtitle_language", "resolution"],
        )

    def test_failover_never_uses_disallowed_language(self):
        ordered = ordered_failover_candidates(
            [self.english_relation, self.german_relation],
            self.policy,
        )
        self.assertEqual([relation.id for relation in ordered], [self.german_relation.id])

    def test_language_aliases_use_english_iso_639_2_b_codes(self):
        self.assertEqual(
            normalize_language_list(["deu", "de", "Deutsch", "eng"]),
            ["ger", "eng"],
        )

    def test_language_preference_wins_over_account_and_category_priority(self):
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger", "eng"],
            "preferred_resolutions": ["1080p", "2160p"],
            "allow_unknown_metadata": False,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])

        ordered = ordered_failover_candidates(
            [self.english_relation, self.german_relation], self.policy
        )

        self.assertEqual(ordered[0].id, self.german_relation.id)

    def test_compact_and_variants_share_explicit_asset_identity(self):
        compact = select_relations_for_policy(
            [self.german_relation, self.english_relation],
            self.policy,
            "movie_id",
        )
        self.assertEqual([relation.id for relation in compact], [self.german_relation.id])

        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.export_mode = VODAccessPolicy.ExportMode.VARIANTS
        self.policy.save()
        variants = select_relations_for_policy(
            [self.german_relation, self.english_relation],
            self.policy,
            "movie_id",
        )
        self.assertEqual(len(variants), 2)

        asset = ensure_source_asset(self.german_relation)
        self.english_relation.source_asset = asset
        self.english_relation.save(update_fields=["source_asset"])
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()
        linked = select_relations_for_policy(
            [self.german_relation, self.english_relation],
            self.policy,
            "movie_id",
        )
        self.assertEqual(len(linked), 1)

    def test_streaming_compact_selection_returns_only_winner_ids(self):
        ids = select_relation_ids_for_policy(
            iter([self.english_relation, self.german_relation]),
            self.policy,
            "movie_id",
        )

        self.assertEqual(ids, [self.german_relation.id])

    def test_compact_xc_category_requests_do_not_duplicate_the_title(self):
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.save(update_fields=["hard_constraints", "updated_at"])
        user = get_user_model().objects.create_user(
            username="compact-user",
            password="test-password",
        )
        self.policy.users.add(user)
        request = RequestFactory().get("/player_api.php")

        all_rows = xc_get_vod_streams(request, user)
        german_rows = xc_get_vod_streams(
            request,
            user,
            category_id=self.german.id,
        )
        english_rows = xc_get_vod_streams(
            request,
            user,
            category_id=self.english.id,
        )

        self.assertEqual(
            [row["stream_id"] for row in all_rows],
            [self.english_relation.id],
        )
        self.assertEqual(german_rows, [])
        self.assertEqual(
            [row["stream_id"] for row in english_rows],
            [self.english_relation.id],
        )

    def test_xc_categories_follow_global_enabled_categories_not_old_priorities(self):
        user = get_user_model().objects.create_user(
            username="category-user",
            password="test-password",
        )
        self.policy.users.add(user)

        rows = xc_get_vod_categories(user)

        self.assertEqual(
            {row["category_id"] for row in rows},
            {str(self.german.id), str(self.english.id)},
        )

    def test_same_provider_id_is_not_automatically_linked_across_accounts(self):
        first = ensure_source_asset(self.german_relation)
        second = ensure_source_asset(self.english_relation)

        self.assertNotEqual(first.id, second.id)
        self.assertEqual(first.provider_asset_id, second.provider_asset_id)
        self.assertEqual(first.provider_origin_key, second.provider_origin_key)

    def test_bulk_source_asset_creation_keeps_relations_distinct(self):
        asset_ids = ensure_source_assets(
            [self.german_relation, self.english_relation]
        )
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()

        self.assertEqual(len(asset_ids), 2)
        self.assertNotEqual(
            self.german_relation.source_asset_id,
            self.english_relation.source_asset_id,
        )

    def test_manual_metadata_wins_and_is_not_overwritten(self):
        asset = VODSourceAsset.objects.create(
            asset_type=VODSourceAsset.AssetType.MOVIE,
            observed_metadata={"audio_languages": ["eng"], "resolution": "720p"},
            manual_metadata={"audio_languages": ["deu"]},
            locked_fields=["audio_languages"],
        )

        asset.apply_observation({
            "audio_languages": ["fra"],
            "resolution": "1080p",
        })
        asset.refresh_from_db()

        self.assertEqual(asset.observed_metadata["audio_languages"], ["eng"])
        self.assertEqual(asset.observed_metadata["resolution"], "1080p")
        self.assertEqual(
            asset.effective_metadata()["values"]["audio_languages"],
            ["ger"],
        )

    def test_playback_history_keeps_the_exact_account_and_category(self):
        playback = record_playback_selection(
            session_id="redirect-test-1",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.REDIRECT,
            status=VODPlaybackSession.Status.REDIRECTED,
            failover_chain=[
                {"relation_id": self.german_relation.id, "result": "selected"}
            ],
        )

        self.german_relation.refresh_from_db()
        self.assertEqual(playback.m3u_account_id, self.account_a.id)
        self.assertEqual(playback.category_id, self.german.id)
        self.assertEqual(playback.relation_id, self.german_relation.id)
        self.assertEqual(playback.status, VODPlaybackSession.Status.REDIRECTED)
        self.assertEqual(playback.bytes_sent, 0)
        self.assertIsNotNone(self.german_relation.source_asset_id)

    def test_playback_history_exposes_the_recorded_technical_snapshot(self):
        playback = record_playback_selection(
            session_id="proxy-test-1",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.PROXYING,
            custom_properties={
                "source_effective_metadata": {
                    "audio_languages": ["deu"],
                    "resolution": "1080p",
                }
            },
        )

        metadata = VODPlaybackSessionSerializer(playback).data[
            "source_effective_metadata"
        ]
        self.assertEqual(metadata["values"]["audio_languages"], ["ger"])
        self.assertEqual(metadata["values"]["resolution"], "1080p")
        self.assertEqual(metadata["provenance"]["resolution"], "playback")

    def test_metadata_precedence_is_category_provider_observed_manual(self):
        asset = VODSourceAsset.objects.create(
            asset_type=VODSourceAsset.AssetType.MOVIE,
            declared_metadata={
                "audio_languages": ["eng"],
                "resolution": "720p",
            },
            observed_metadata={"resolution": "1080p"},
            manual_metadata={"audio_languages": ["deu"]},
            locked_fields=["audio_languages"],
        )

        effective = asset.effective_metadata(
            category_defaults={
                "audio_languages": ["fra"],
                "subtitle_languages": ["deu"],
                "resolution": "576p",
            },
            relation_declared={"resolution": "2160p"},
        )

        self.assertEqual(effective["values"]["audio_languages"], ["ger"])
        self.assertEqual(effective["provenance"]["audio_languages"], "manual")
        self.assertEqual(effective["values"]["resolution"], "1080p")
        self.assertEqual(effective["provenance"]["resolution"], "observed")
        self.assertEqual(effective["values"]["subtitle_languages"], ["ger"])
        self.assertEqual(
            effective["provenance"]["subtitle_languages"], "category"
        )

    def test_bulk_metadata_can_target_all_filtered_titles(self):
        other_movie = Movie.objects.create(name="Unrelated title", year=2026)
        other_relation = M3UMovieRelation.objects.create(
            m3u_account=self.account_a,
            movie=other_movie,
            category=self.german,
            stream_id="other-43",
        )
        admin = get_user_model().objects.create_user(
            username="vod-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "select_all": True,
                "filters": {
                    "type": "movies",
                    "search": "Avatar",
                    "category": "",
                },
                "exclude_selections": [],
                "metadata": {"resolution": "1080p"},
            },
            format="json",
        )
        force_authenticate(request, user=admin)
        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()
        other_relation.refresh_from_db()
        self.assertIsNotNone(self.german_relation.source_asset_id)
        self.assertIsNotNone(self.english_relation.source_asset_id)
        self.assertIsNone(other_relation.source_asset_id)
        self.assertEqual(
            self.german_relation.source_asset.manual_metadata["resolution"],
            "1080p",
        )
