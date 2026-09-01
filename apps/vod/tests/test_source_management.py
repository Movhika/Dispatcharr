from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.models import M3UAccount
from core.models import CoreSettings
from apps.output.views import xc_get_vod_categories, xc_get_vod_streams
from apps.vod.metadata import (
    category_defaults_for_relation,
    compatible_video_features,
    ensure_source_asset,
    ensure_source_assets,
    detect_video_features,
    normalize_language_list,
    relation_declared_metadata,
)
from apps.vod.playback import episode_history_name, record_playback_selection
from apps.vod.serializers import (
    VODAccessPolicySerializer,
    VODPlaybackSessionSerializer,
)
from apps.vod.models import (
    M3UMovieRelation,
    M3UEpisodeRelation,
    M3USeriesRelation,
    M3UVODCategoryRelation,
    Movie,
    Episode,
    Series,
    VODAccessPolicy,
    VODMovieProfileSelection,
    VODPlaybackSession,
    VODPolicyCategory,
    VODSourceAsset,
    VODCategory,
)
from apps.vod.policies import (
    ordered_failover_candidates,
    relation_allowed,
    select_relation_ids_for_policy,
    select_relations_for_policy,
)
from apps.vod.api_views import (
    _vod_relation_sql,
    MovieViewSet,
    UnifiedContentViewSet,
    VODPlaybackSessionViewSet,
    VODSourceAssetViewSet,
    VODAccessPolicyViewSet,
)
from apps.vod.catalog_cache import (
    SELECTION_GENERATION_KEY,
    bump_catalog_generation,
    selection_catalog_generation,
)
from apps.vod.profile_selection import (
    ProfileBuildAlreadyRunning,
    build_vod_profile_selection,
    enqueue_all_profile_selection_rebuilds,
    prepared_relation_ids,
)
from apps.vod.tasks import rebuild_all_vod_profile_selections


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

    def test_first_matching_category_rule_overrides_default_source_constraints(self):
        self.english_category.metadata_defaults = {
            "audio_languages": ["eng"],
            "subtitle_languages": ["ger"],
            "resolution": "1080p",
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger"],
            "allow_unknown_metadata": False,
            "source_rules": [
                {
                    "name": "German subtitles for anime",
                    "category_regex": "ANIME",
                    "enabled": True,
                    "required_audio_languages": [],
                    "required_subtitle_languages": ["ger"],
                    "language_match_mode": "all",
                    "allow_unknown_metadata": False,
                },
                {
                    "name": "Would reject if evaluated",
                    "category_regex": "NETFLIX",
                    "enabled": True,
                    "excluded_audio_languages": ["eng"],
                },
            ],
        }

        self.assertTrue(relation_allowed(self.english_relation, self.policy))
        self.assertTrue(relation_allowed(self.german_relation, self.policy))

    def test_category_rule_can_exclude_video_features(self):
        self.english_category.metadata_defaults = {
            "audio_languages": ["eng"],
            "subtitle_languages": ["ger"],
            "resolution": "2160p",
            "video_features": ["dv"],
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "allow_unknown_metadata": False,
            "source_rules": [
                {
                    "name": "No DV anime",
                    "category_regex": "ANIME",
                    "enabled": True,
                    "required_audio_languages": [],
                    "required_subtitle_languages": ["ger"],
                    "excluded_video_features": ["dv", "3d"],
                    "language_match_mode": "all",
                    "allow_unknown_metadata": False,
                }
            ],
        }

        self.assertFalse(relation_allowed(self.english_relation, self.policy))

    def test_ordered_stream_filters_use_first_matching_category_decision(self):
        self.policy.hard_constraints = {
            "source_rules": [
                {
                    "match_field": "category",
                    "regex_pattern": "GERMANY",
                    "required_audio_languages": ["ger"],
                    "result": "include",
                },
                {
                    "match_field": "category",
                    "regex_pattern": ".*",
                    "result": "exclude",
                },
            ]
        }

        self.assertTrue(relation_allowed(self.german_relation, self.policy))
        self.assertFalse(relation_allowed(self.english_relation, self.policy))

    def test_stream_filter_can_match_provider_specific_source_name(self):
        self.english_relation.custom_properties = {
            "basic_data": {"name": "| USA | Avatar"}
        }
        self.english_relation.save(update_fields=["custom_properties"])
        self.policy.hard_constraints = {
            "source_rules": [
                {
                    "match_field": "stream",
                    "regex_pattern": r"^\| USA \|",
                    "result": "exclude",
                }
            ]
        }

        self.assertTrue(relation_allowed(self.german_relation, self.policy))
        self.assertFalse(relation_allowed(self.english_relation, self.policy))

    def test_stream_filter_metadata_is_part_of_the_first_match(self):
        self.english_category.metadata_defaults = {
            "audio_languages": ["eng"],
            "subtitle_languages": ["ger"],
            "resolution": "1080p",
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "source_rules": [
                {
                    "match_field": "category",
                    "regex_pattern": "ANIME",
                    "required_subtitle_languages": ["ger"],
                    "result": "include",
                },
                {
                    "match_field": "category",
                    "regex_pattern": ".*",
                    "result": "exclude",
                },
            ]
        }

        self.assertTrue(relation_allowed(self.english_relation, self.policy))
        self.assertFalse(relation_allowed(self.german_relation, self.policy))

    def test_failover_can_prefer_lower_resolution(self):
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.ranking = [
            "resolution_asc",
            "audio_language",
            "subtitle_language",
            "metadata_completeness",
        ]
        self.policy.save(update_fields=["hard_constraints", "ranking", "updated_at"])

        ordered = ordered_failover_candidates(
            [self.english_relation, self.german_relation],
            self.policy,
        )

        self.assertEqual(
            [relation.id for relation in ordered],
            [self.german_relation.id, self.english_relation.id],
        )

    def test_failover_can_place_unknown_metadata_last(self):
        self.german_category.metadata_defaults = {}
        self.german_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.ranking = [
            "metadata_completeness",
            "audio_language",
            "subtitle_language",
            "resolution_desc",
        ]
        self.policy.save(update_fields=["hard_constraints", "ranking", "updated_at"])

        ordered = ordered_failover_candidates(
            [self.german_relation, self.english_relation],
            self.policy,
        )

        self.assertEqual(
            [relation.id for relation in ordered],
            [self.english_relation.id, self.german_relation.id],
        )

    def test_language_aliases_use_english_iso_639_2_b_codes(self):
        self.assertEqual(
            normalize_language_list(["deu", "de", "Deutsch", "eng"]),
            ["ger", "eng"],
        )

    def test_category_allowlist_and_audio_or_subtitle_policy(self):
        self.english_category.metadata_defaults = {
            "audio_languages": ["eng"],
            "subtitle_languages": ["ger"],
            "resolution": "1080p",
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger"],
            "required_subtitle_languages": ["ger"],
            "language_match_mode": "any",
            "allow_unknown_metadata": False,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])
        VODPolicyCategory.objects.create(
            policy=self.policy,
            category_relation=self.english_category,
            enabled=True,
        )

        self.assertTrue(relation_allowed(self.english_relation, self.policy))
        self.assertFalse(relation_allowed(self.german_relation, self.policy))

    def test_audio_or_subtitle_does_not_accept_a_known_mismatch_plus_unknown(self):
        self.english_category.metadata_defaults = {
            "audio_languages": ["eng"],
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger"],
            "required_subtitle_languages": ["ger"],
            "language_match_mode": "any",
            "allow_unknown_metadata": True,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])

        self.assertFalse(relation_allowed(self.english_relation, self.policy))

    def test_resolution_constraints_use_vertical_resolution_names(self):
        self.policy.hard_constraints = {
            "min_resolution": 720,
            "max_resolution": 1080,
            "allow_unknown_metadata": False,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])

        self.assertTrue(relation_allowed(self.german_relation, self.policy))
        self.assertFalse(relation_allowed(self.english_relation, self.policy))

    def test_series_technical_sql_can_match_episode_metadata_and_format(self):
        joins, conditions, params, canonical_column = _vod_relation_sql(
            {
                "audio_language": "deu",
                "subtitle_language": "ger",
                "resolution": "1080p",
                "container_extension": "mkv",
            },
            "series",
        )

        sql = " ".join(conditions)
        self.assertEqual(canonical_column, "series_id")
        self.assertIn("vod_m3useriesrelation", joins)
        self.assertIn("vod_m3uepisoderelation", sql)
        self.assertIn("episode_relation.container_extension", sql)
        for value in ("ger", "1080p", "mkv"):
            self.assertIn(value, params)
        self.assertNotIn("deu", params)

    def test_episode_inherits_defaults_from_its_series_category(self):
        series = Series.objects.create(name="Avatar Series")
        series_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=self.german,
            external_series_id="avatar-series",
        )
        episode = Episode.objects.create(
            series=series,
            name="Episode 1",
            season_number=1,
            episode_number=1,
        )
        episode_relation = M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            episode=episode,
            series_relation=series_relation,
            stream_id="avatar-episode-1",
        )

        self.assertEqual(
            category_defaults_for_relation(episode_relation)["audio_languages"],
            ["deu"],
        )

    def test_fast_catalog_container_is_declared_source_metadata(self):
        self.german_relation.container_extension = "MKV"
        self.german_relation.save(update_fields=["container_extension"])

        self.assertEqual(
            relation_declared_metadata(self.german_relation)[
                "container_extension"
            ],
            "mkv",
        )

    def test_legacy_manual_container_does_not_override_provider_format(self):
        self.german_relation.container_extension = "mkv"
        self.german_relation.save(update_fields=["container_extension"])
        asset = ensure_source_asset(self.german_relation)
        asset.manual_metadata = {"container_extension": "mp4"}
        asset.locked_fields = ["container_extension"]
        asset.save(update_fields=["manual_metadata", "locked_fields"])

        effective = asset.effective_metadata(
            relation_declared=relation_declared_metadata(self.german_relation)
        )

        self.assertEqual(effective["values"]["container_extension"], "mkv")
        self.assertEqual(effective["provenance"]["container_extension"], "relation")

    def test_detailed_provider_metadata_exposes_known_technical_fields(self):
        self.german_relation.custom_properties = {
            "detailed_info": {
                "video": {
                    "codec_name": "hevc",
                    "width": 1920,
                    "height": 1080,
                    "avg_frame_rate": "24000/1001",
                    "bit_rate": "8000000",
                },
                "audio": {
                    "codec_name": "eac3",
                    "tags": {"language": "deu"},
                },
                "subtitles": [{"tags": {"language": "eng"}}],
            },
            "movie_data": {"size": "1.5 GiB"},
        }

        metadata = relation_declared_metadata(self.german_relation)

        self.assertEqual(metadata["video_codec"], "hevc")
        self.assertEqual(metadata["audio_codec"], "eac3")
        self.assertEqual(metadata["audio_languages"], ["ger"])
        self.assertEqual(metadata["subtitle_languages"], ["eng"])
        self.assertEqual(metadata["resolution"], "1080p")
        self.assertEqual(metadata["bitrate_kbps"], 8000)
        self.assertEqual(metadata["file_size_bytes"], 1610612736)

    def test_video_features_are_detected_and_can_bound_a_profile(self):
        self.assertEqual(
            detect_video_features("Movie.3D.HSBS.HDR10+.mkv"),
            ["3d", "hdr"],
        )
        self.german_category.metadata_defaults = {
            "video_features": ["3d", "hdr"]
        }
        self.german_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "required_video_features": ["3d"],
            "allow_unknown_metadata": False,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])

        self.assertTrue(relation_allowed(self.german_relation, self.policy))
        self.assertFalse(relation_allowed(self.english_relation, self.policy))
        self.assertEqual(compatible_video_features("hdr"), ["hdr"])

    def test_profile_exclusions_override_allowed_languages_and_features(self):
        self.german_category.metadata_defaults = {
            "audio_languages": ["ger"],
            "subtitle_languages": ["eng"],
            "video_features": ["3d"],
        }
        self.german_category.save(update_fields=["metadata_defaults"])
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger"],
            "excluded_subtitle_languages": ["eng"],
            "excluded_video_features": ["3d"],
            "allow_unknown_metadata": True,
        }
        self.policy.save(update_fields=["hard_constraints", "updated_at"])

        self.assertFalse(relation_allowed(self.german_relation, self.policy))

    def test_lowest_bitrate_still_ranks_unknown_after_known(self):
        self.english_relation.custom_properties = {
            "detailed_info": {"bitrate": 9000}
        }
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.ranking = ["bitrate_asc", "metadata_completeness"]
        self.policy.save(update_fields=["hard_constraints", "ranking", "updated_at"])

        ordered = ordered_failover_candidates(
            [self.german_relation, self.english_relation],
            self.policy,
        )

        self.assertEqual(
            [relation.id for relation in ordered],
            [self.english_relation.id, self.german_relation.id],
        )

    def test_failover_can_prefer_lower_known_bitrate(self):
        self.german_relation.custom_properties = {
            "detailed_info": {"bitrate": 3500}
        }
        self.english_relation.custom_properties = {
            "detailed_info": {"bitrate": 9000}
        }
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.ranking = [
            "bitrate_asc",
            "audio_language",
            "subtitle_language",
            "resolution_desc",
            "metadata_completeness",
        ]
        self.policy.save(update_fields=["hard_constraints", "ranking", "updated_at"])

        ordered = ordered_failover_candidates(
            [self.english_relation, self.german_relation],
            self.policy,
        )

        self.assertEqual(
            [relation.id for relation in ordered],
            [self.german_relation.id, self.english_relation.id],
        )

    def test_language_preference_wins_over_account_and_category_priority(self):
        self.policy.hard_constraints = {
            "required_audio_languages": ["ger", "eng"],
            "min_resolution": 720,
            "max_resolution": 2160,
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

    def test_profile_build_materializes_compact_output_and_normalizes_metadata(self):
        counts = build_vod_profile_selection(self.policy.id)

        self.policy.refresh_from_db()
        rows = VODMovieProfileSelection.objects.filter(
            policy=self.policy,
            generation=self.policy.active_selection_generation,
        )
        self.assertEqual(self.policy.selection_status, "ready")
        self.assertEqual(rows.count(), 1)
        self.assertEqual(rows.get().relation_id, self.german_relation.id)
        self.assertEqual(rows.get().audio_languages, ["ger"])
        self.assertEqual(counts["movies"]["candidate_sources"], 2)
        self.assertEqual(counts["movies"]["eligible_sources"], 1)
        self.assertEqual(counts["movies"]["output_entries"], 1)
        self.assertEqual(self.policy.selection_progress["phase"], "Ready")
        self.assertEqual(self.policy.selection_progress["percent"], 100)

    def test_profile_build_does_not_overlap_an_active_build(self):
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.BUILDING,
            selection_started_at=timezone.now(),
        )

        with self.assertRaises(ProfileBuildAlreadyRunning):
            build_vod_profile_selection(self.policy.id)

    def test_xc_uses_current_prepared_profile_without_cold_python_selection(self):
        user = get_user_model().objects.create_user(
            username="prepared-profile-user",
            password="test-password",
        )
        self.policy.users.add(user)
        build_vod_profile_selection(self.policy.id)
        request = RequestFactory().get("/player_api.php")

        with patch(
            "apps.vod.policies.select_relation_ids_for_policy",
            side_effect=AssertionError("cold selector should not run"),
        ):
            rows = xc_get_vod_streams(request, user)

        self.assertEqual(
            [row["stream_id"] for row in rows],
            [self.german_relation.id],
        )

    def test_catalog_change_keeps_last_prepared_generation_available(self):
        build_vod_profile_selection(self.policy.id)
        self.policy.refresh_from_db()
        self.assertIsNotNone(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            )
        )

        bump_catalog_generation()

        self.assertEqual(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            ),
            [self.german_relation.id],
        )

    def test_user_assignment_keeps_prepared_profile_current(self):
        build_vod_profile_selection(self.policy.id)
        user = get_user_model().objects.create_user(
            username="profile-assignment-user",
            password="test-password",
        )

        self.policy.users.add(user)
        self.policy.refresh_from_db()

        self.assertEqual(self.policy.selection_status, "ready")
        self.assertEqual(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            ),
            [self.german_relation.id],
        )

    def test_account_runtime_status_keeps_prepared_profile_current(self):
        build_vod_profile_selection(self.policy.id)

        self.account_a.status = M3UAccount.Status.PARSING
        self.account_a.last_message = "Refreshing VOD metadata"
        self.account_a.save(update_fields=["status", "last_message"])
        self.policy.refresh_from_db()

        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.READY,
        )
        self.assertIsNotNone(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            )
        )

    def test_account_runtime_full_save_keeps_prepared_profile_current(self):
        build_vod_profile_selection(self.policy.id)

        self.account_a.status = M3UAccount.Status.PARSING
        self.account_a.last_message = "Refreshing VOD metadata"
        self.account_a.save()
        self.policy.refresh_from_db()

        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.READY,
        )

    def test_episode_inventory_change_keeps_prepared_profile_current(self):
        build_vod_profile_selection(self.policy.id)
        series = Series.objects.create(name="Progress series")
        series_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=self.german,
            external_series_id="progress-series",
        )
        episode = Episode.objects.create(
            series=series,
            season_number=1,
            episode_number=1,
            name="Pilot",
        )

        # The series relation itself changes selectable output and therefore
        # queues a rebuild. Complete that rebuild before testing the episode-only
        # inventory change.
        build_vod_profile_selection(self.policy.id)
        M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            series_relation=series_relation,
            episode=episode,
            stream_id="progress-episode",
        )
        self.policy.refresh_from_db()

        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.READY,
        )

    def test_canonical_metadata_refresh_keeps_prepared_profile_current(self):
        build_vod_profile_selection(self.policy.id)

        self.movie.description = "Updated provider description"
        self.movie.save(update_fields=["description"])
        self.policy.refresh_from_db()

        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.READY,
        )
        self.assertIsNotNone(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            )
        )

    def test_account_priority_change_marks_prepared_profile_pending(self):
        build_vod_profile_selection(self.policy.id)

        self.account_a.priority = 50
        self.account_a.save(update_fields=["priority"])
        self.policy.refresh_from_db()

        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.PENDING,
        )

    def test_prepared_generation_survives_an_empty_runtime_cache(self):
        from django.core.cache import cache

        build_vod_profile_selection(self.policy.id)
        self.policy.refresh_from_db()
        expected = self.policy.selection_catalog_generation

        cache.delete(SELECTION_GENERATION_KEY)

        self.assertEqual(str(selection_catalog_generation()), expected)

    def test_profile_preview_filters_prepared_rows(self):
        build_vod_profile_selection(self.policy.id)
        admin = get_user_model().objects.create_user(
            username="profile-preview-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().get(
            f"/api/vod/access-policies/{self.policy.id}/selections/",
            {
                "type": "movie",
                "audio_language": "deu",
                "resolution": "1080p",
            },
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"get": "selections"})(
            request,
            pk=self.policy.id,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["relation_id"],
            self.german_relation.id,
        )
        self.assertEqual(
            response.data["results"][0]["metadata"]["audio_languages"],
            ["ger"],
        )

    def test_draft_stream_filter_preview_respects_order_and_category_scope(self):
        admin = get_user_model().objects.create_user(
            username="draft-filter-preview-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().post(
            "/api/vod/access-policies/preview-stream-filter/",
            {
                "target_rule_id": "english-only",
                "category_relation_ids": [
                    self.german_category.id,
                    self.english_category.id,
                ],
                "source_rules": [
                    {
                        "id": "german-first",
                        "match_field": "category",
                        "regex_pattern": "GERMANY",
                        "result": "include",
                    },
                    {
                        "id": "english-only",
                        "match_field": "category",
                        "regex_pattern": "NETFLIX",
                        "required_audio_languages": ["eng"],
                        "result": "exclude",
                    },
                ],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view(
            {"post": "preview_stream_filter"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["id"], self.english_relation.id
        )
        self.assertEqual(response.data["results"][0]["result"], "exclude")

    def test_empty_category_expression_applies_feature_filter_globally(self):
        self.english_category.metadata_defaults = {
            **self.english_category.metadata_defaults,
            "video_features": ["3d"],
        }
        self.english_category.save(update_fields=["metadata_defaults"])
        admin = get_user_model().objects.create_user(
            username="global-feature-preview-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().post(
            "/api/vod/access-policies/preview-stream-filter/",
            {
                "target_rule_id": "exclude-3d",
                "category_relation_ids": [],
                "source_rules": [
                    {
                        "id": "exclude-3d",
                        "match_field": "category",
                        "regex_pattern": "",
                        "required_video_features": ["3d"],
                        "result": "exclude",
                    }
                ],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view(
            {"post": "preview_stream_filter"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["id"], self.english_relation.id
        )

    def test_pending_profile_previews_and_serves_last_completed_generation(self):
        build_vod_profile_selection(self.policy.id)
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            selection_progress={"phase": "Waiting for worker", "percent": 0},
        )
        self.policy.refresh_from_db()

        self.assertEqual(
            prepared_relation_ids(
                self.policy,
                M3UMovieRelation,
                {"m3u_account__is_active": True},
            ),
            [self.german_relation.id],
        )

        admin = get_user_model().objects.create_user(
            username="stale-profile-preview-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().get(
            f"/api/vod/access-policies/{self.policy.id}/selections/",
            {"type": "movie"},
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"get": "selections"})(
            request,
            pk=self.policy.id,
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["current"])
        self.assertTrue(response.data["available"])
        self.assertEqual(response.data["count"], 1)

    def test_variants_preview_uses_each_provider_source_name(self):
        self.german_relation.custom_properties = {
            "basic_data": {"name": "| DE | Avatar source"}
        }
        self.german_relation.save(update_fields=["custom_properties", "updated_at"])
        self.english_relation.custom_properties = {
            "basic_data": {"name": "| EN | Avatar source"}
        }
        self.english_relation.save(update_fields=["custom_properties", "updated_at"])
        self.policy.export_mode = VODAccessPolicy.ExportMode.VARIANTS
        self.policy.hard_constraints = {"allow_unknown_metadata": True}
        self.policy.save(
            update_fields=["export_mode", "hard_constraints", "updated_at"]
        )
        build_vod_profile_selection(self.policy.id)

        admin = get_user_model().objects.create_user(
            username="variants-preview-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().get(
            f"/api/vod/access-policies/{self.policy.id}/selections/",
            {"type": "movie"},
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"get": "selections"})(
            request,
            pk=self.policy.id,
        )

        self.assertEqual(response.status_code, 200, response.data)
        rows = {row["relation_id"]: row for row in response.data["results"]}
        self.assertEqual(
            rows[self.german_relation.id]["name"], "| DE | Avatar source"
        )
        self.assertEqual(
            rows[self.english_relation.id]["name"], "| EN | Avatar source"
        )
        self.assertEqual(
            rows[self.german_relation.id]["category_name"], self.german.name
        )
        self.assertEqual(
            rows[self.english_relation.id]["category_name"], self.english.name
        )

    def test_switching_profile_to_variants_queues_catalog_update(self):
        admin = get_user_model().objects.create_user(
            username="variants-update-admin",
            password="test-password",
            user_level=10,
        )
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            selection_progress={"phase": "Ready", "percent": 100},
        )
        request = APIRequestFactory().patch(
            f"/api/vod/access-policies/{self.policy.pk}/",
            {"export_mode": VODAccessPolicy.ExportMode.VARIANTS},
            format="json",
        )
        force_authenticate(request, user=admin)

        with (
            patch(
                "apps.vod.tasks.rebuild_vod_profile_selection.delay"
            ) as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            delay.return_value.id = "variants-update-task"
            response = VODAccessPolicyViewSet.as_view(
                {"patch": "partial_update"}
            )(request, pk=self.policy.pk)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["export_mode"], VODAccessPolicy.ExportMode.VARIANTS
        )
        self.assertEqual(
            response.data["selection_status"],
            VODAccessPolicy.SelectionStatus.PENDING,
        )
        delay.assert_called_once_with(self.policy.pk)

    def test_deleting_default_profile_promotes_an_active_replacement(self):
        admin = get_user_model().objects.create_user(
            username="profile-delete-admin",
            password="test-password",
            user_level=10,
        )
        VODAccessPolicy.objects.exclude(pk=self.policy.pk).update(
            is_default=False,
            is_active=False,
        )
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            is_default=True,
            is_active=True,
        )
        replacement = VODAccessPolicy.objects.create(
            name="Active replacement",
            is_active=True,
            is_default=False,
        )
        request = APIRequestFactory().delete(
            f"/api/vod/access-policies/{self.policy.pk}/"
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"delete": "destroy"})(
            request,
            pk=self.policy.pk,
        )

        self.assertEqual(response.status_code, 204, response.data)
        self.assertFalse(VODAccessPolicy.objects.filter(pk=self.policy.pk).exists())
        replacement.refresh_from_db()
        self.assertTrue(replacement.is_default)

    def test_last_active_default_profile_cannot_be_deleted(self):
        admin = get_user_model().objects.create_user(
            username="last-profile-delete-admin",
            password="test-password",
            user_level=10,
        )
        VODAccessPolicy.objects.exclude(pk=self.policy.pk).update(
            is_default=False,
            is_active=False,
        )
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            is_default=True,
            is_active=True,
        )
        request = APIRequestFactory().delete(
            f"/api/vod/access-policies/{self.policy.pk}/"
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"delete": "destroy"})(
            request,
            pk=self.policy.pk,
        )

        self.assertEqual(response.status_code, 409, response.data)
        self.assertTrue(VODAccessPolicy.objects.filter(pk=self.policy.pk).exists())

    def test_global_rebuild_schedules_a_followup_for_late_invalidation(self):
        second_policy = VODAccessPolicy.objects.create(
            name="Second profile",
            export_mode=VODAccessPolicy.ExportMode.COMPACT,
            is_active=True,
            hard_constraints={"allow_unknown_metadata": True},
        )
        VODAccessPolicy.objects.exclude(
            pk__in=[self.policy.pk, second_policy.pk]
        ).update(is_active=False)
        VODAccessPolicy.objects.filter(
            pk__in=[self.policy.pk, second_policy.pk]
        ).update(selection_status=VODAccessPolicy.SelectionStatus.PENDING)
        built = []

        def complete_build(policy_id):
            VODAccessPolicy.objects.filter(pk=policy_id).update(
                selection_status=VODAccessPolicy.SelectionStatus.READY
            )
            built.append(policy_id)
            if len(built) == 2:
                VODAccessPolicy.objects.filter(pk=built[0]).update(
                    selection_status=VODAccessPolicy.SelectionStatus.PENDING
                )
            return {}

        with (
            patch(
                "apps.vod.profile_selection.build_vod_profile_selection",
                side_effect=complete_build,
            ),
            patch.object(
                rebuild_all_vod_profile_selections,
                "apply_async",
            ) as apply_async,
        ):
            rebuild_all_vod_profile_selections.run()

        self.assertEqual(len(built), 2)
        apply_async.assert_called_once_with(countdown=1)

    def test_catalog_invalidation_republishes_an_existing_pending_profile(self):
        VODAccessPolicy.objects.exclude(pk=self.policy.pk).update(is_active=False)
        started_at = timezone.now() - timedelta(minutes=2)
        progress = {
            "phase": "Waiting in Celery queue",
            "percent": 0,
            "task_id": "existing-task-id",
        }
        VODAccessPolicy.objects.filter(pk=self.policy.pk).update(
            selection_status=VODAccessPolicy.SelectionStatus.PENDING,
            selection_started_at=started_at,
            selection_progress=progress,
        )

        with (
            patch("django.core.cache.cache.add", return_value=True),
            patch(
                "apps.vod.tasks.rebuild_all_vod_profile_selections.delay"
            ) as delay,
            self.captureOnCommitCallbacks(execute=True),
        ):
            delay.return_value.id = "replacement-task-id"
            queued = enqueue_all_profile_selection_rebuilds()

        self.policy.refresh_from_db()
        self.assertTrue(queued)
        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.PENDING,
        )
        self.assertEqual(self.policy.selection_started_at, started_at)
        self.assertEqual(
            self.policy.selection_progress["task_id"], "replacement-task-id"
        )
        delay.assert_called_once_with()

    def test_admin_can_create_a_reusable_vod_output_profile(self):
        admin = get_user_model().objects.create_user(
            username="profile-create-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().post(
            "/api/vod/access-policies/",
            {
                "name": "German 1080p",
                "export_mode": "compact",
                "is_active": True,
                "is_default": False,
                "hard_constraints": {
                    "required_audio_languages": ["deu"],
                    "required_subtitle_languages": ["ger"],
                    "language_match_mode": "any",
                    "min_resolution": 720,
                    "max_resolution": 1080,
                    "allow_unknown_metadata": False,
                },
                "ranking": [
                    "audio_language",
                    "subtitle_language",
                    "resolution",
                ],
                "category_rules": [
                    {
                        "category_relation": self.german_category.id,
                        "enabled": True,
                        "priority": 0,
                    }
                ],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"post": "create"})(request)

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data["selection_status"],
            VODAccessPolicy.SelectionStatus.PENDING,
        )
        self.assertEqual(
            response.data["selection_progress"]["phase"],
            "Publishing background task",
        )
        created = VODAccessPolicy.objects.get(name="German 1080p")
        self.assertEqual(
            created.hard_constraints["required_audio_languages"], ["ger"]
        )
        self.assertEqual(
            created.ranking,
            ["audio_language", "subtitle_language", "resolution_desc"],
        )
        self.assertEqual(
            list(
                created.vodpolicycategory_set.values_list(
                    "category_relation_id", flat=True
                )
            ),
            [self.german_category.id],
        )

    def test_profile_rejects_conflicting_resolution_ranking_directions(self):
        serializer = VODAccessPolicySerializer(
            data={
                "name": "Conflicting resolution directions",
                "ranking": ["resolution_desc", "resolution_asc"],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("ranking", serializer.errors)

    def test_profile_rejects_conflicting_bitrate_ranking_directions(self):
        serializer = VODAccessPolicySerializer(
            data={
                "name": "Conflicting bitrate directions",
                "ranking": ["bitrate_desc", "bitrate_asc"],
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("ranking", serializer.errors)

    def test_profile_rejects_invalid_source_rule_expression(self):
        serializer = VODAccessPolicySerializer(
            data={
                "name": "Invalid category rule",
                "hard_constraints": {
                    "source_rules": [
                        {
                            "name": "Broken",
                            "category_regex": "[",
                        }
                    ]
                },
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("hard_constraints", serializer.errors)

    def test_profile_rejects_duplicate_stream_filters(self):
        rule = {
            "match_field": "category",
            "regex_pattern": "ANIME",
            "required_subtitle_languages": ["ger"],
            "result": "include",
        }
        serializer = VODAccessPolicySerializer(
            data={
                "name": "Duplicate filters",
                "hard_constraints": {"source_rules": [rule, rule]},
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("hard_constraints", serializer.errors)

    def test_profile_keeps_simplified_stream_filter_payload_compact(self):
        serializer = VODAccessPolicySerializer(
            data={
                "name": "Stream filters only",
                "hard_constraints": {
                    "source_rules": [
                        {
                            "match_field": "category",
                            "regex_pattern": "ANIME",
                            "required_subtitle_languages": ["deu"],
                            "result": "include",
                        }
                    ]
                },
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        constraints = serializer.validated_data["hard_constraints"]
        self.assertEqual(set(constraints), {"source_rules"})
        self.assertEqual(
            constraints["source_rules"][0]["required_subtitle_languages"],
            ["ger"],
        )

    def test_admin_can_replace_vod_output_profile_categories(self):
        admin = get_user_model().objects.create_user(
            username="profile-update-admin",
            password="test-password",
            user_level=10,
        )
        VODPolicyCategory.objects.create(
            policy=self.policy,
            category_relation=self.german_category,
            enabled=True,
        )
        request = APIRequestFactory().patch(
            f"/api/vod/access-policies/{self.policy.pk}/",
            {
                "category_rules": [
                    {
                        "category_relation": self.english_category.id,
                        "enabled": True,
                        "priority": 0,
                    }
                ]
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODAccessPolicyViewSet.as_view({"patch": "partial_update"})(
            request,
            pk=self.policy.pk,
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            response.data["selection_status"],
            VODAccessPolicy.SelectionStatus.PENDING,
        )
        self.assertEqual(
            [rule["category_relation"] for rule in response.data["category_rules"]],
            [self.english_category.id],
        )
        self.assertEqual(
            list(
                self.policy.vodpolicycategory_set.values_list(
                    "category_relation_id", flat=True
                )
            ),
            [self.english_category.id],
        )

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

    def test_xc_categories_follow_the_user_category_allowlist(self):
        user = get_user_model().objects.create_user(
            username="limited-category-user",
            password="test-password",
        )
        self.policy.users.add(user)
        VODPolicyCategory.objects.create(
            policy=self.policy,
            category_relation=self.german_category,
            enabled=True,
        )

        rows = xc_get_vod_categories(user)

        self.assertEqual(
            [row["category_id"] for row in rows],
            [str(self.german.id)],
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
        self.assertEqual(playback.failover_count, 0)
        self.assertEqual(playback.bytes_sent, 0)
        self.assertIsNotNone(self.german_relation.source_asset_id)

    def test_playback_history_counts_rejected_failover_attempts(self):
        playback = record_playback_selection(
            session_id="redirect-test-failover",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.REDIRECT,
            status=VODPlaybackSession.Status.REDIRECTED,
            failover_chain=[
                {"relation_id": self.english_relation.id, "result": "upstream_error"},
                {"relation_id": self.german_relation.id, "result": "selected"},
            ],
        )

        self.assertEqual(playback.failover_count, 1)

    def test_range_reconnect_clears_stale_playback_end_time(self):
        record_playback_selection(
            session_id="proxy-range-reconnect",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.PROXYING,
        )
        playback = record_playback_selection(
            session_id="proxy-range-reconnect",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        self.assertIsNotNone(playback.ended_at)

        playback = record_playback_selection(
            session_id="proxy-range-reconnect",
            user=None,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.PROXYING,
        )

        self.assertEqual(playback.status, VODPlaybackSession.Status.PROXYING)
        self.assertIsNone(playback.ended_at)

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

    def test_episode_history_keeps_only_the_played_episode_title(self):
        provider_title = "| DE | Mushoku Tensei - S03E09 - 058 - Lament"
        canonical_title = (
            "NF - Mushoku Tensei (2021) - S03E09 - " + provider_title
        )

        self.assertEqual(
            episode_history_name(canonical_title),
            provider_title,
        )
        legacy = VODPlaybackSession(
            content_type=VODSourceAsset.AssetType.EPISODE,
            content_name=canonical_title,
            custom_properties={},
        )
        self.assertEqual(
            VODPlaybackSessionSerializer(legacy).data["content_name"],
            provider_title,
        )

    def test_playback_history_filters_by_user_title_and_time_on_the_server(self):
        admin = get_user_model().objects.create_user(
            username="history-admin",
            password="test-password",
            user_level=10,
        )
        maria = get_user_model().objects.create_user(
            username="Maria",
            password="test-password",
        )
        playback = record_playback_selection(
            session_id="history-filter-match",
            user=maria,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        old = record_playback_selection(
            session_id="history-filter-old",
            user=maria,
            relation=self.english_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        VODPlaybackSession.objects.filter(pk=old.pk).update(
            started_at=timezone.now() - timedelta(days=10)
        )
        request = APIRequestFactory().get(
            "/api/vod/playback-sessions/",
            {
                "username": "mari",
                "search": "Avatar",
                "status": "completed",
                "started_after": (
                    timezone.now() - timedelta(days=1)
                ).isoformat(),
            },
        )
        force_authenticate(request, user=admin)

        response = VODPlaybackSessionViewSet.as_view({"get": "list"})(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["id"], playback.id)

        account_search = APIRequestFactory().get(
            "/api/vod/playback-sessions/",
            {"search": self.account_a.name},
        )
        force_authenticate(account_search, user=admin)
        account_response = VODPlaybackSessionViewSet.as_view({"get": "list"})(
            account_search
        )
        self.assertEqual(account_response.data["count"], 0)

    def test_playback_history_facets_and_stats_use_stable_string_ids(self):
        admin = get_user_model().objects.create_user(
            username="history-facets-admin",
            password="test-password",
            user_level=10,
        )
        playback = record_playback_selection(
            session_id="history-facets-match",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
            failover_chain=[
                {
                    "relation_id": self.english_relation.id,
                    "result": "at_capacity",
                },
                {"relation_id": self.german_relation.id, "result": "selected"},
            ],
        )
        VODPlaybackSession.objects.filter(pk=playback.pk).update(
            bytes_sent=1048576,
            watched_seconds=90,
        )

        facets_request = APIRequestFactory().get(
            "/api/vod/playback-sessions/facets/"
        )
        force_authenticate(facets_request, user=admin)
        facets = VODPlaybackSessionViewSet.as_view({"get": "facets"})(
            facets_request
        )

        self.assertEqual(facets.status_code, 200)
        self.assertIn(
            {"value": str(admin.id), "label": admin.username},
            facets.data["users"],
        )
        self.assertIn(
            {"value": str(self.account_a.id), "label": self.account_a.name},
            facets.data["accounts"],
        )
        self.assertIn(
            {
                "value": str(self.german.id),
                "label": self.german.name,
                "m3u_account": str(self.account_a.id),
            },
            facets.data["categories"],
        )

        stats_request = APIRequestFactory().get(
            "/api/vod/playback-sessions/stats/",
            {"user": str(admin.id), "category": str(self.german.id)},
        )
        force_authenticate(stats_request, user=admin)
        stats_response = VODPlaybackSessionViewSet.as_view({"get": "stats"})(
            stats_request
        )

        self.assertEqual(stats_response.status_code, 200)
        self.assertEqual(stats_response.data["sessions"], 1)
        self.assertEqual(stats_response.data["failover_sessions"], 1)
        self.assertEqual(stats_response.data["watched_seconds"], 90)
        self.assertEqual(stats_response.data["bytes_sent"], 1048576)

    @patch("apps.vod.tasks.cleanup_vod_playback_history.delay")
    @patch.object(
        CoreSettings,
        "set_vod_playback_history_retention_days",
        return_value=30,
    )
    def test_admin_can_configure_playback_history_retention(
        self,
        set_retention,
        cleanup_delay,
    ):
        admin = get_user_model().objects.create_user(
            username="history-retention-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().put(
            "/api/vod/playback-sessions/retention/",
            {"retention_days": 30},
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODPlaybackSessionViewSet.as_view({"put": "retention"})(
            request
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["retention_days"], 30)
        set_retention.assert_called_once_with(30)
        cleanup_delay.assert_called_once_with()

    def test_playback_history_bulk_delete_honors_filtered_select_all(self):
        admin = get_user_model().objects.create_user(
            username="history-delete-admin",
            password="test-password",
            user_level=10,
        )
        matching = record_playback_selection(
            session_id="history-delete-match",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.FAILED,
        )
        retained = record_playback_selection(
            session_id="history-delete-retain",
            user=admin,
            relation=self.english_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().post(
            "/api/vod/playback-sessions/bulk-delete/",
            {
                "select_all": True,
                "exclude_ids": [],
                "filters": {"status": "failed"},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODPlaybackSessionViewSet.as_view(
            {"post": "bulk_delete"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["deleted_sessions"], 1)
        self.assertFalse(VODPlaybackSession.objects.filter(pk=matching.pk).exists())
        self.assertTrue(VODPlaybackSession.objects.filter(pk=retained.pk).exists())

    def test_non_admin_cannot_delete_playback_history(self):
        user = get_user_model().objects.create_user(
            username="history-viewer",
            password="test-password",
        )
        playback = record_playback_selection(
            session_id="history-delete-forbidden",
            user=user,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().post(
            "/api/vod/playback-sessions/bulk-delete/",
            {"ids": [playback.id]},
            format="json",
        )
        force_authenticate(request, user=user)

        response = VODPlaybackSessionViewSet.as_view(
            {"post": "bulk_delete"}
        )(request)

        self.assertEqual(response.status_code, 403)
        self.assertTrue(VODPlaybackSession.objects.filter(pk=playback.pk).exists())

    def test_playback_history_bulk_metadata_updates_each_source_once(self):
        admin = get_user_model().objects.create_user(
            username="history-metadata-admin",
            password="test-password",
            user_level=10,
        )
        first = record_playback_selection(
            session_id="history-metadata-first",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        second = record_playback_selection(
            session_id="history-metadata-second",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().patch(
            "/api/vod/playback-sessions/bulk-metadata/",
            {
                "ids": [first.id, second.id],
                "updates": {
                    "resolution": {"mode": "set", "value": "1080p"},
                    "subtitle_languages": {
                        "mode": "set",
                        "value": ["deu"],
                    },
                },
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        with (
            patch(
                "apps.vod.profile_selection.refresh_profile_selections_for_content",
                return_value={
                    "profiles_updated": 1,
                    "queued_full_rebuild": False,
                },
            ) as refresh_profiles,
            patch(
                "apps.vod.profile_selection.enqueue_all_profile_selection_rebuilds"
            ) as enqueue_full_rebuild,
        ):
            response = VODPlaybackSessionViewSet.as_view(
                {"patch": "bulk_metadata"}
            )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_sessions"], 2)
        self.assertEqual(response.data["updated_sources"], 1)
        self.assertEqual(response.data["affected_titles"], 1)
        self.assertEqual(response.data["profile_update"], "inline")
        refresh_profiles.assert_called_once_with(
            movie_ids={self.movie.id},
            series_ids=set(),
        )
        enqueue_full_rebuild.assert_not_called()
        asset = VODSourceAsset.objects.get(pk=first.source_asset_id)
        self.assertEqual(asset.manual_metadata["resolution"], "1080p")
        self.assertEqual(asset.manual_metadata["subtitle_languages"], ["ger"])
        self.assertIn("resolution", asset.locked_fields)

    def test_playback_history_episode_metadata_refreshes_parent_series_inline(self):
        admin = get_user_model().objects.create_user(
            username="history-episode-metadata-admin",
            password="test-password",
            user_level=10,
        )
        series = Series.objects.create(name="History Series", year=2026)
        episode = Episode.objects.create(
            series=series,
            season_number=1,
            episode_number=1,
            name="History Episode",
        )
        series_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=self.german,
            external_series_id="history-series-source",
        )
        episode_relation = M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            episode=episode,
            series_relation=series_relation,
            stream_id="history-episode-source",
            container_extension="mkv",
        )
        playback = record_playback_selection(
            session_id="history-episode-metadata",
            user=admin,
            relation=episode_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().patch(
            "/api/vod/playback-sessions/bulk-metadata/",
            {
                "ids": [playback.id],
                "updates": {
                    "subtitle_languages": {
                        "mode": "set",
                        "value": ["deu"],
                    },
                },
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        with patch(
            "apps.vod.profile_selection.refresh_profile_selections_for_content",
            return_value={
                "profiles_updated": 1,
                "queued_full_rebuild": False,
            },
        ) as refresh_profiles:
            response = VODPlaybackSessionViewSet.as_view(
                {"patch": "bulk_metadata"}
            )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["affected_titles"], 1)
        self.assertEqual(response.data["profile_update"], "inline")
        refresh_profiles.assert_called_once_with(
            movie_ids=set(),
            series_ids={series.id},
        )

    def test_playback_history_select_all_queues_one_full_profile_refresh(self):
        admin = get_user_model().objects.create_user(
            username="history-select-all-admin",
            password="test-password",
            user_level=10,
        )
        playback = record_playback_selection(
            session_id="history-select-all",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().patch(
            "/api/vod/playback-sessions/bulk-metadata/",
            {
                "select_all": True,
                "filters": {"user": str(admin.id)},
                "updates": {
                    "resolution": {"mode": "set", "value": "1080p"},
                },
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        with (
            patch("apps.vod.catalog_cache.bump_catalog_generation") as bump,
            patch(
                "apps.vod.profile_selection.enqueue_all_profile_selection_rebuilds"
            ) as enqueue_full_rebuild,
            patch(
                "apps.vod.profile_selection.refresh_profile_selections_for_content"
            ) as refresh_profiles,
        ):
            response = VODPlaybackSessionViewSet.as_view(
                {"patch": "bulk_metadata"}
            )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_sessions"], 1)
        self.assertEqual(response.data["updated_sources"], 1)
        self.assertIsNone(response.data["affected_titles"])
        self.assertEqual(response.data["profile_update"], "queued")
        self.assertTrue(
            VODSourceAsset.objects.filter(
                pk=playback.source_asset_id,
                manual_metadata__resolution="1080p",
            ).exists()
        )
        bump.assert_called_once_with()
        enqueue_full_rebuild.assert_called_once_with()
        refresh_profiles.assert_not_called()

    def test_playback_history_explicit_selection_queues_above_inline_limit(self):
        admin = get_user_model().objects.create_user(
            username="history-inline-limit-admin",
            password="test-password",
            user_level=10,
        )
        playback = record_playback_selection(
            session_id="history-inline-limit",
            user=admin,
            relation=self.german_relation,
            mode=VODPlaybackSession.Mode.PROXY,
            status=VODPlaybackSession.Status.COMPLETED,
        )
        request = APIRequestFactory().patch(
            "/api/vod/playback-sessions/bulk-metadata/",
            {
                "ids": [playback.id],
                "updates": {
                    "resolution": {"mode": "set", "value": "1080p"},
                },
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        with (
            patch("apps.vod.api_views.PLAYBACK_METADATA_INLINE_TITLE_LIMIT", 0),
            patch("apps.vod.catalog_cache.bump_catalog_generation") as bump,
            patch(
                "apps.vod.profile_selection.enqueue_all_profile_selection_rebuilds"
            ) as enqueue_full_rebuild,
            patch(
                "apps.vod.profile_selection.refresh_profile_selections_for_content"
            ) as refresh_profiles,
        ):
            response = VODPlaybackSessionViewSet.as_view(
                {"patch": "bulk_metadata"}
            )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertIsNone(response.data["affected_titles"])
        self.assertEqual(response.data["profile_update"], "queued")
        bump.assert_called_once_with()
        enqueue_full_rebuild.assert_called_once_with()
        refresh_profiles.assert_not_called()

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

    def test_provider_list_exposes_metadata_for_each_exact_relation(self):
        admin = get_user_model().objects.create_user(
            username="vod-provider-list-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().get(
            f"/api/vod/movies/{self.movie.id}/providers/"
        )
        force_authenticate(request, user=admin)

        response = MovieViewSet.as_view({"get": "get_providers"})(
            request, pk=self.movie.id
        )

        self.assertEqual(response.status_code, 200)
        sources = {row["id"]: row for row in response.data}
        self.assertEqual(
            sources[self.german_relation.id]["source_metadata"]["values"][
                "audio_languages"
            ],
            ["ger"],
        )
        self.assertEqual(
            sources[self.english_relation.id]["source_metadata"]["values"][
                "resolution"
            ],
            "2160p",
        )

    def test_relation_manual_metadata_only_updates_the_selected_source(self):
        admin = get_user_model().objects.create_user(
            username="vod-exact-source-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/relation-manual-metadata/",
            {
                "content_type": "movie",
                "relation_id": self.german_relation.id,
                "metadata": {
                    "audio_languages": ["deu"],
                    "resolution": "720p",
                },
                "locked_fields": ["audio_languages", "resolution"],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "relation_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()
        self.assertIsNotNone(self.german_relation.source_asset_id)
        self.assertIsNone(self.english_relation.source_asset_id)
        self.assertEqual(
            self.german_relation.source_asset.manual_metadata[
                "audio_languages"
            ],
            ["ger"],
        )
        self.assertEqual(
            response.data["source_metadata"]["provenance"]["resolution"],
            "manual",
        )

    def test_manual_metadata_incrementally_updates_ready_profiles(self):
        """One edited title must not queue a full-catalog Celery rebuild."""
        build_vod_profile_selection(self.policy.id)
        self.policy.refresh_from_db()
        self.assertEqual(
            list(
                VODMovieProfileSelection.objects.filter(
                    policy=self.policy,
                    generation=self.policy.active_selection_generation,
                ).values_list("relation_id", flat=True)
            ),
            [self.german_relation.id],
        )
        self.assertEqual(self.policy.selection_counts["output_entries"], 1)
        self.assertEqual(
            self.policy.selection_counts["movies"]["canonical_titles"], 1
        )
        admin = get_user_model().objects.create_user(
            username="vod-incremental-metadata-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/relation-manual-metadata/",
            {
                "content_type": "movie",
                "relation_id": self.german_relation.id,
                "metadata": {"audio_languages": ["eng"]},
                "locked_fields": ["audio_languages"],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        with patch(
            "apps.vod.tasks.rebuild_all_vod_profile_selections.delay"
        ) as full_rebuild:
            response = VODSourceAssetViewSet.as_view(
                {"patch": "relation_manual_metadata"}
            )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.policy.refresh_from_db()
        self.assertEqual(
            self.policy.selection_status,
            VODAccessPolicy.SelectionStatus.READY,
        )
        self.assertEqual(
            self.policy.selection_catalog_generation,
            str(selection_catalog_generation()),
        )
        self.assertFalse(
            VODMovieProfileSelection.objects.filter(
                policy=self.policy,
                generation=self.policy.active_selection_generation,
                movie=self.movie,
            ).exists()
        )
        self.assertEqual(self.policy.selection_counts["output_entries"], 0)
        self.assertEqual(
            self.policy.selection_counts["movies"]["canonical_titles"], 0
        )
        self.assertEqual(
            self.policy.selection_progress["phase"],
            "Ready after metadata update",
        )
        full_rebuild.assert_not_called()

    def test_relation_manual_metadata_rejects_provider_container_format(self):
        admin = get_user_model().objects.create_user(
            username="vod-format-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/relation-manual-metadata/",
            {
                "content_type": "movie",
                "relation_id": self.german_relation.id,
                "metadata": {"container_extension": "mp4"},
                "locked_fields": ["container_extension"],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "relation_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 400)
        self.assertIn("container_extension", str(response.data))

    def test_series_manual_metadata_updates_episode_sources_and_overview(self):
        series = Series.objects.create(name="Exact metadata series")
        category = VODCategory.objects.create(
            name="EXACT SERIES", category_type="series"
        )
        M3UVODCategoryRelation.objects.create(
            m3u_account=self.account_a,
            category=category,
            enabled=True,
            metadata_defaults={
                "audio_languages": ["eng"],
                "subtitle_languages": ["eng"],
                "resolution": "720p",
            },
        )
        series_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=category,
            external_series_id="exact-metadata-series",
        )
        episode = Episode.objects.create(
            series=series,
            name="Episode 1",
            season_number=1,
            episode_number=1,
        )
        episode_relation = M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            episode=episode,
            series_relation=series_relation,
            stream_id="exact-metadata-episode",
            container_extension="mkv",
        )
        admin = get_user_model().objects.create_user(
            username="vod-series-metadata-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/relation-manual-metadata/",
            {
                "content_type": "series",
                "relation_id": series_relation.id,
                "metadata": {
                    "audio_languages": ["deu"],
                    "subtitle_languages": ["deu"],
                    "resolution": "1080p",
                },
                "locked_fields": [
                    "audio_languages",
                    "subtitle_languages",
                    "resolution",
                ],
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "relation_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200, response.data)
        episode_relation.refresh_from_db()
        self.assertIsNotNone(episode_relation.source_asset_id)
        self.assertEqual(
            episode_relation.source_asset.manual_metadata["audio_languages"],
            ["ger"],
        )
        self.assertEqual(
            episode_relation.source_asset.manual_metadata["resolution"],
            "1080p",
        )

        overview_request = APIRequestFactory().get(
            "/api/vod/", {"type": "series", "search": series.name}
        )
        force_authenticate(overview_request, user=admin)
        overview = UnifiedContentViewSet.as_view({"get": "list"})(
            overview_request
        )

        self.assertEqual(overview.status_code, 200, overview.data)
        row = overview.data["results"][0]
        self.assertEqual(row["source_metadata"]["audio_languages"], ["ger"])
        self.assertEqual(row["source_metadata"]["subtitle_languages"], ["ger"])
        self.assertEqual(row["source_metadata"]["resolutions"], ["1080p"])
        self.assertEqual(row["source_metadata"]["container_extensions"], ["mkv"])

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

    def test_bulk_title_cleaning_updates_only_filtered_canonical_titles(self):
        self.movie.name = "┃DE┃ Avatar"
        self.movie.save(update_fields=["name"])
        other_movie = Movie.objects.create(name="┃DE┃ Unrelated title")
        M3UMovieRelation.objects.create(
            m3u_account=self.account_a,
            movie=other_movie,
            category=self.german,
            stream_id="other-title",
        )
        admin = get_user_model().objects.create_user(
            username="vod-title-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "select_all": True,
                "filters": {"type": "movies", "search": "Avatar"},
                "exclude_selections": [],
                "metadata": {},
                "canonical_title": {"mode": "clean"},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated_titles"], 1)
        self.movie.refresh_from_db()
        other_movie.refresh_from_db()
        self.assertEqual(self.movie.display_name, "Avatar")
        self.assertEqual(other_movie.display_name, "")

    def test_bulk_title_regex_requires_a_pattern(self):
        admin = get_user_model().objects.create_user(
            username="vod-title-regex-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "selections": [{"content_type": "movie", "id": self.movie.id}],
                "metadata": {},
                "canonical_title": {"mode": "regex", "pattern": ""},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 400)

    def test_bulk_metadata_limits_selected_movie_to_filtered_account_and_category(self):
        admin = get_user_model().objects.create_user(
            username="vod-filtered-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "selections": [
                    {"content_type": "movie", "id": self.movie.id},
                ],
                "filters": {
                    "type": "movies",
                    "search": "Avatar",
                    "category": f"{self.german.name}|movie",
                    "m3u_account": str(self.account_a.id),
                },
                "metadata": {"resolution": "1080p"},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_sources"], 1)
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()
        self.assertIsNotNone(self.german_relation.source_asset_id)
        self.assertIsNone(self.english_relation.source_asset_id)

    def test_account_and_category_filters_require_one_matching_source_relation(self):
        admin = get_user_model().objects.create_user(
            username="vod-cross-filter-admin",
            password="test-password",
            user_level=10,
        )
        query = {
            "m3u_account": str(self.account_a.id),
            "category": f"{self.english.name}|movie",
            "page_size": 24,
        }

        for viewset in (MovieViewSet, UnifiedContentViewSet):
            request = APIRequestFactory().get("/api/vod/", query)
            force_authenticate(request, user=admin)
            response = viewset.as_view({"get": "list"})(request)

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data["count"], 0)
            self.assertEqual(response.data["results"], [])

    def test_unified_list_reports_movie_and_series_edition_counts(self):
        series = Series.objects.create(name="Avatar Series", year=2005)
        german_series = VODCategory.objects.create(
            name="GERMANY SERIES", category_type="series"
        )
        english_series = VODCategory.objects.create(
            name="NETFLIX SERIES", category_type="series"
        )
        M3UVODCategoryRelation.objects.create(
            m3u_account=self.account_a,
            category=german_series,
            enabled=True,
        )
        M3UVODCategoryRelation.objects.create(
            m3u_account=self.account_b,
            category=english_series,
            enabled=True,
        )
        german_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=german_series,
            external_series_id="series-a",
        )
        english_relation = M3USeriesRelation.objects.create(
            m3u_account=self.account_b,
            series=series,
            category=english_series,
            external_series_id="series-b",
        )
        episode = Episode.objects.create(
            name="The Boy in the Iceberg",
            series=series,
            season_number=1,
            episode_number=1,
        )
        M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            episode=episode,
            series_relation=german_relation,
            stream_id="episode-a",
        )
        M3UEpisodeRelation.objects.create(
            m3u_account=self.account_b,
            episode=episode,
            series_relation=english_relation,
            stream_id="episode-b",
        )
        admin = get_user_model().objects.create_user(
            username="vod-source-count-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().get(
            "/api/vod/", {"page_size": 24}
        )
        force_authenticate(request, user=admin)

        response = UnifiedContentViewSet.as_view({"get": "list"})(request)

        self.assertEqual(response.status_code, 200)
        counts = {
            (item["content_type"], item["name"]): item["source_count"]
            for item in response.data["results"]
        }
        self.assertEqual(counts[("movie", "Avatar")], 2)
        self.assertEqual(counts[("series", "Avatar Series")], 2)

    def test_select_all_does_not_cross_match_account_and_category(self):
        admin = get_user_model().objects.create_user(
            username="vod-cross-bulk-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "select_all": True,
                "filters": {
                    "type": "movies",
                    "category": f"{self.english.name}|movie",
                    "m3u_account": str(self.account_a.id),
                },
                "exclude_selections": [],
                "metadata": {"resolution": "2160p"},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_sources"], 0)
        self.german_relation.refresh_from_db()
        self.english_relation.refresh_from_db()
        self.assertIsNone(self.german_relation.source_asset_id)
        self.assertIsNone(self.english_relation.source_asset_id)

    def test_select_all_limits_series_and_episodes_to_filtered_account(self):
        series = Series.objects.create(name="Filtered series")
        series_category = VODCategory.objects.create(
            name="GERMAN SERIES", category_type="series"
        )
        other_category = VODCategory.objects.create(
            name="ENGLISH SERIES", category_type="series"
        )
        relation_a = M3USeriesRelation.objects.create(
            m3u_account=self.account_a,
            series=series,
            category=series_category,
            external_series_id="series-a",
        )
        relation_b = M3USeriesRelation.objects.create(
            m3u_account=self.account_b,
            series=series,
            category=other_category,
            external_series_id="series-b",
        )
        episode = Episode.objects.create(
            series=series,
            name="Episode 1",
            season_number=1,
            episode_number=1,
        )
        episode_a = M3UEpisodeRelation.objects.create(
            m3u_account=self.account_a,
            episode=episode,
            series_relation=relation_a,
            stream_id="episode-a",
        )
        episode_b = M3UEpisodeRelation.objects.create(
            m3u_account=self.account_b,
            episode=episode,
            series_relation=relation_b,
            stream_id="episode-b",
        )
        admin = get_user_model().objects.create_user(
            username="vod-series-filtered-admin",
            password="test-password",
            user_level=10,
        )
        request = APIRequestFactory().patch(
            "/api/vod/source-assets/bulk-manual-metadata/",
            {
                "select_all": True,
                "filters": {
                    "type": "series",
                    "search": "Filtered",
                    "category": f"{series_category.name}|series",
                    "m3u_account": str(self.account_a.id),
                },
                "exclude_selections": [],
                "metadata": {"audio_languages": ["ger"]},
            },
            format="json",
        )
        force_authenticate(request, user=admin)

        response = VODSourceAssetViewSet.as_view(
            {"patch": "bulk_manual_metadata"}
        )(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["updated_sources"], 2)
        relation_a.refresh_from_db()
        relation_b.refresh_from_db()
        episode_a.refresh_from_db()
        episode_b.refresh_from_db()
        self.assertIsNotNone(relation_a.source_asset_id)
        self.assertIsNotNone(episode_a.source_asset_id)
        self.assertIsNone(relation_b.source_asset_id)
        self.assertIsNone(episode_b.source_asset_id)
