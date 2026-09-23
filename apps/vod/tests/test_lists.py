from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import Mock, patch
from datetime import datetime, timedelta

from apps.m3u.models import M3UAccount
from apps.output.views import (
    VOD_MOVIES_CATEGORY_ID,
    VOD_SERIES_CATEGORY_ID,
    _xc_order_relations_by_list,
    xc_get_series_categories,
    xc_get_vod_categories,
)
from apps.vod.api_views import VODAccessPolicyViewSet, VODListViewSet
from apps.vod.lists import dynamic_rule_matches, rebuild_dynamic_list, rebuild_tmdb_list
from apps.vod.profile_selection import (
    enqueue_selected_list_profile_rebuilds,
    profile_selection_signature,
)
from apps.vod.tasks import rebuild_vod_list
from apps.vod.models import (
    M3UMovieRelation,
    Movie,
    Series,
    VODList,
    VODListItem,
    VODListSourceMembership,
    VODAccessPolicy,
    VODMovieProfileSelection,
    VODPolicyList,
)


class VODListAPITests(TestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.admin = get_user_model().objects.create_user(
            username="list-admin",
            password="secret",
            user_level=10,
        )
        self.user = get_user_model().objects.create_user(
            username="list-user",
            password="secret",
            user_level=0,
        )
        self.movie = Movie.objects.create(
            name="Source Movie",
            display_name="Curated Movie",
            year=2026,
            tmdb_poster_url="https://image.example/movie.jpg",
        )
        self.series = Series.objects.create(name="Source Series", year=2025)
        self.account = M3UAccount.objects.create(
            name="list-provider",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="user",
            password="pass",
        )
        self.movie_relation = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=self.movie,
            stream_id="movie-1",
        )

    def _request(self, method, path, action, data=None, user=None, pk=None):
        request = getattr(self.factory, method)(path, data or {}, format="json")
        force_authenticate(request, user=user or self.admin)
        view = VODListViewSet.as_view({method: action})
        return view(request, **({"pk": pk} if pk is not None else {}))

    def test_list_summary_keeps_unavailable_external_titles(self):
        vod_list = VODList.objects.create(
            name="TMDB Trending",
            list_type=VODList.ListType.EXTERNAL,
            provider="tmdb",
            external_key="trending-movies",
        )
        VODListItem.objects.create(
            list=vod_list,
            generation=vod_list.active_generation,
            content_type="movie",
            movie=self.movie,
            include_all_sources=True,
            position=0,
        )
        VODListItem.objects.create(
            list=vod_list,
            generation=vod_list.active_generation,
            content_type="movie",
            external_provider="tmdb",
            external_id="999999",
            title="Not in Library",
            year=2024,
            poster_url="https://image.example/missing.jpg",
            position=1,
        )

        response = self._request("get", "/api/vod/lists/", "list")

        self.assertEqual(response.status_code, 200)
        payload = response.data[0]
        self.assertEqual(payload["item_count"], 2)
        self.assertEqual(payload["available_item_count"], 1)
        self.assertEqual(len(payload["preview"]), 2)
        self.assertTrue(payload["preview"][0]["is_available"])
        self.assertEqual(payload["preview"][0]["source_count"], 1)
        self.assertFalse(payload["preview"][1]["is_available"])
        self.assertEqual(payload["preview"][1]["display_title"], "Not in Library")

    def test_manual_replace_publishes_new_generation_with_exact_source(self):
        vod_list = VODList.objects.create(name="3D Movies")
        old_item = VODListItem.objects.create(
            list=vod_list,
            generation=vod_list.active_generation,
            content_type="series",
            series=self.series,
            include_all_sources=True,
        )

        response = self._request(
            "put",
            f"/api/vod/lists/{vod_list.pk}/manual-items/",
            "manual_items",
            data={
                "items": [
                    {
                        "content_type": "movie",
                        "canonical_id": self.movie.pk,
                        "relation_ids": [self.movie_relation.pk],
                    }
                ]
            },
            pk=vod_list.pk,
        )

        self.assertEqual(response.status_code, 200)
        vod_list.refresh_from_db()
        self.assertEqual(vod_list.active_generation, 2)
        self.assertFalse(VODListItem.objects.filter(pk=old_item.pk).exists())
        item = VODListItem.objects.get(list=vod_list)
        self.assertEqual(item.generation, 2)
        self.assertFalse(item.include_all_sources)
        membership = VODListSourceMembership.objects.get(item=item)
        self.assertEqual(membership.movie_relation, self.movie_relation)
        self.assertEqual(response.data["item_count"], 1)
        self.assertEqual(response.data["preview"][0]["display_title"], "Curated Movie")

    def test_list_preview_filters_exact_sources_and_returns_membership_ids(self):
        self.movie_relation.manual_metadata = {
            "audio_languages": ["ger"],
            "video_features": ["3d"],
        }
        self.movie_relation.save(update_fields=["manual_metadata"])
        vod_list = VODList.objects.create(name="German 3D")
        item = VODListItem.objects.create(
            list=vod_list,
            generation=vod_list.active_generation,
            content_type="movie",
            movie=self.movie,
            include_all_sources=False,
        )
        VODListSourceMembership.objects.create(
            item=item,
            movie_relation=self.movie_relation,
        )

        basic_preview = self._request(
            "get",
            f"/api/vod/lists/{vod_list.pk}/items/",
            "items",
            data={"search": "Curated", "availability": "available"},
            pk=vod_list.pk,
        )
        self.assertEqual(basic_preview.data["count"], 1)
        for field, value in (
            ("audio_language", "deu"),
            ("video_feature", "3d"),
        ):
            single_filter = self._request(
                "get",
                f"/api/vod/lists/{vod_list.pk}/items/",
                "items",
                data={
                    "search": "Curated",
                    "availability": "available",
                    field: value,
                },
                pk=vod_list.pk,
            )
            self.assertEqual(single_filter.data["count"], 1, field)

        response = self._request(
            "get",
            f"/api/vod/lists/{vod_list.pk}/items/",
            "items",
            data={
                "search": "Curated",
                "availability": "available",
                "audio_language": "deu",
                "video_feature": "3d",
            },
            pk=vod_list.pk,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(
            response.data["results"][0]["relation_ids"],
            [self.movie_relation.pk],
        )

        options = self._request(
            "get",
            f"/api/vod/lists/{vod_list.pk}/filter-options/",
            "filter_options",
            pk=vod_list.pk,
        )
        self.assertEqual(options.status_code, 200)
        self.assertEqual(options.data["audio_languages"], ["ger"])
        self.assertEqual(options.data["video_features"], ["3d"])

    def test_list_order_uses_original_release_or_library_added_dates(self):
        older_release = Movie.objects.create(
            name="Older release",
            year=2024,
            tmdb_metadata={"release_date": "2024-03-01"},
        )
        newer_release = Movie.objects.create(
            name="Newer release",
            year=2026,
            tmdb_metadata={"release_date": "2026-04-15"},
        )
        now = timezone.now()
        older_release.library_added_at = now
        older_release.save(update_fields=["library_added_at"])
        newer_release.library_added_at = now - timedelta(days=3)
        newer_release.save(update_fields=["library_added_at"])
        vod_list = VODList.objects.create(name="Ordered movies")
        VODListItem.objects.create(
            list=vod_list, content_type="movie", movie=older_release, position=0,
        )
        VODListItem.objects.create(
            list=vod_list, content_type="movie", movie=newer_release, position=1,
        )

        def item_ids():
            response = self._request(
                "get", f"/api/vod/lists/{vod_list.pk}/items/", "items",
                pk=vod_list.pk,
            )
            self.assertEqual(response.status_code, 200)
            return [row["canonical_id"] for row in response.data["results"]]

        self.assertEqual(item_ids(), [older_release.pk, newer_release.pk])
        vod_list.settings = {"sort_mode": "release_date_desc"}
        vod_list.save(update_fields=["settings"])
        self.assertEqual(item_ids(), [newer_release.pk, older_release.pk])
        vod_list.settings = {"sort_mode": "library_added_desc"}
        vod_list.save(update_fields=["settings"])
        self.assertEqual(item_ids(), [older_release.pk, newer_release.pk])

        rows = [{"movie_id": newer_release.pk}, {"movie_id": older_release.pk}]
        _xc_order_relations_by_list(rows, vod_list.pk, "movie")
        self.assertEqual(
            [row["movie_id"] for row in rows],
            [older_release.pk, newer_release.pk],
        )

    def test_external_release_sort_includes_unavailable_titles(self):
        vod_list = VODList.objects.create(
            name="External dates",
            list_type=VODList.ListType.EXTERNAL,
            provider="tmdb",
            external_key="trending-movies",
            settings={"sort_mode": "release_date_desc"},
        )
        VODListItem.objects.create(
            list=vod_list,
            content_type="movie",
            movie=self.movie,
            position=0,
            year=2026,
            metadata={"release_date": "2026-01-01"},
        )
        VODListItem.objects.create(
            list=vod_list,
            content_type="movie",
            title="Not yet available",
            position=1,
            year=2026,
            metadata={"release_date": "2026-08-01"},
        )

        response = self._request(
            "get", f"/api/vod/lists/{vod_list.pk}/items/", "items",
            pk=vod_list.pk,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["results"][0]["display_title"], "Not yet available")

    def test_list_rejects_unsupported_sort_mode(self):
        response = self._request(
            "post", "/api/vod/lists/", "create",
            data={"name": "Invalid order", "settings": {"sort_mode": "random"}},
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("settings", response.data)

    def test_profile_preview_names_the_list_instead_of_provider_category(self):
        vod_list = VODList.objects.create(name="AppleTV")
        policy = VODAccessPolicy.objects.create(
            name="List preview",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="ready-generation",
            selection_counts={"category_mode": "lists", "export_mode": "compact"},
        )
        VODMovieProfileSelection.objects.create(
            policy=policy,
            generation="ready-generation",
            movie=self.movie,
            relation=self.movie_relation,
            list_ids=[vod_list.pk],
        )
        request = self.factory.get(
            f"/api/vod/access-policies/{policy.pk}/selections/",
            {"type": "movie"},
        )
        force_authenticate(request, user=self.admin)
        response = VODAccessPolicyViewSet.as_view({"get": "selections"})(
            request, pk=policy.pk
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["category_name"], "AppleTV")
        self.assertEqual(response.data["results"][0]["list_ids"], [vod_list.pk])

    def test_movie_series_mode_uses_one_group_per_content_type(self):
        policy = VODAccessPolicy.objects.create(
            name="Single content-type groups",
            category_mode=VODAccessPolicy.CategoryMode.MOVIE_SERIES,
            selection_status=VODAccessPolicy.SelectionStatus.READY,
            active_selection_generation="group-generation",
            selection_counts={
                "category_mode": "movie_series",
                "export_mode": "compact",
            },
        )
        policy.users.add(self.user)
        VODMovieProfileSelection.objects.create(
            policy=policy,
            generation="group-generation",
            movie=self.movie,
            relation=self.movie_relation,
        )
        request = self.factory.get(
            f"/api/vod/access-policies/{policy.pk}/selections/",
            {"type": "movie", "category": "group:movie"},
        )
        force_authenticate(request, user=self.admin)
        response = VODAccessPolicyViewSet.as_view({"get": "selections"})(
            request, pk=policy.pk
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["category_name"], "Movies")
        wrong_group = self.factory.get(
            f"/api/vod/access-policies/{policy.pk}/selections/",
            {"type": "movie", "category": "group:series"},
        )
        force_authenticate(wrong_group, user=self.admin)
        self.assertEqual(
            VODAccessPolicyViewSet.as_view({"get": "selections"})(
                wrong_group, pk=policy.pk
            ).status_code,
            400,
        )
        self.assertEqual(
            xc_get_vod_categories(self.user),
            [{
                "category_id": str(VOD_MOVIES_CATEGORY_ID),
                "category_name": "Movies",
                "parent_id": 0,
            }],
        )
        self.assertEqual(
            xc_get_series_categories(self.user),
            [{
                "category_id": str(VOD_SERIES_CATEGORY_ID),
                "category_name": "Series",
                "parent_id": 0,
            }],
        )

    def test_dynamic_list_keeps_only_matching_source_variants(self):
        self.movie_relation.manual_metadata = {"video_features": ["3d"]}
        self.movie_relation.save(update_fields=["manual_metadata"])
        other_account = M3UAccount.objects.create(
            name="second-provider",
            account_type=M3UAccount.Types.XC,
            server_url="https://second.example",
            username="user",
            password="pass",
        )
        other_relation = M3UMovieRelation.objects.create(
            m3u_account=other_account,
            movie=self.movie,
            stream_id="movie-2d",
            manual_metadata={"resolution": "1080p"},
        )
        vod_list = VODList.objects.create(
            name="3D only",
            list_type=VODList.ListType.DYNAMIC,
            content_type=VODList.ContentType.MOVIE,
            rules=[{"required_video_features": ["3d"]}],
        )

        rebuild_dynamic_list(vod_list)

        vod_list.refresh_from_db()
        item = VODListItem.objects.get(
            list=vod_list,
            generation=vod_list.active_generation,
        )
        self.assertFalse(item.include_all_sources)
        self.assertEqual(
            list(
                item.source_memberships.values_list(
                    "movie_relation_id", flat=True
                )
            ),
            [self.movie_relation.pk],
        )
        self.assertNotIn(
            other_relation.pk,
            item.source_memberships.values_list("movie_relation_id", flat=True),
        )

    def test_dynamic_list_matches_tmdb_release_window(self):
        self.movie.tmdb_metadata = {
            "release_date": "2026-02-12",
            "is_anime": True,
        }
        self.movie.save(update_fields=["tmdb_metadata"])
        vod_list = VODList.objects.create(
            name="Winter anime",
            list_type=VODList.ListType.DYNAMIC,
            content_type=VODList.ContentType.MOVIE,
            rules=[
                {
                    "anime_mode": "yes",
                    "release_date_after": "2026-01-01",
                    "release_date_before": "2026-04-30",
                }
            ],
        )

        rebuild_dynamic_list(vod_list)

        vod_list.refresh_from_db()
        item = VODListItem.objects.get(
            list=vod_list,
            generation=vod_list.active_generation,
        )
        self.assertEqual(item.movie, self.movie)
        self.assertEqual(item.source_memberships.count(), 1)

    def test_dynamic_time_windows_use_current_season_and_recent_days(self):
        reference = timezone.make_aware(datetime(2026, 9, 22, 12, 0))
        self.movie.tmdb_metadata = {"release_date": "2026-02-12"}
        self.movie.library_added_at = reference - timedelta(days=3)
        self.movie.save(update_fields=["tmdb_metadata", "library_added_at"])

        self.assertTrue(dynamic_rule_matches(
            self.movie_relation,
            {"release_yearly_from": "01-01", "release_yearly_until": "04-30"},
            {},
            now=reference,
        ))
        self.assertFalse(dynamic_rule_matches(
            self.movie_relation,
            {"release_yearly_from": "06-01", "release_yearly_until": "08-31"},
            {},
            now=reference,
        ))
        self.assertTrue(dynamic_rule_matches(
            self.movie_relation,
            {"library_added_last_days": 7},
            {},
            now=reference,
        ))
        self.assertFalse(dynamic_rule_matches(
            self.movie_relation,
            {"library_added_last_days": 2},
            {},
            now=reference,
        ))
        self.assertFalse(dynamic_rule_matches(
            self.movie_relation,
            {"release_last_days": 30},
            {},
            now=reference,
        ))

    def test_dynamic_list_rejects_mixed_date_sources(self):
        response = self._request(
            "post",
            "/api/vod/lists/",
            "create",
            data={
                "name": "Conflicting dates",
                "list_type": "dynamic",
                "content_type": "movie",
                "rules": [{
                    "release_date_after": "2026-01-01",
                    "library_added_after": "2026-01-01",
                }],
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("rules", response.data)

    @patch("apps.vod.profile_selection.enqueue_profile_selection_rebuild")
    def test_enabling_list_rebuilds_selected_profiles(self, enqueue):
        vod_list = VODList.objects.create(name="Anime", is_enabled=False)
        policy = VODAccessPolicy.objects.create(
            name="Anime profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        VODPolicyList.objects.create(policy=policy, vod_list=vod_list)

        response = self._request(
            "patch",
            f"/api/vod/lists/{vod_list.pk}/",
            "partial_update",
            data={"is_enabled": True},
            pk=vod_list.pk,
        )

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_enabled"])
        enqueue.assert_called_once_with(
            policy.pk,
            trigger_reason="A selected VOD list was enabled or disabled",
        )

    @patch("apps.vod.profile_selection.enqueue_profile_selection_rebuild")
    def test_list_rebuild_targets_only_profiles_selecting_that_list(self, enqueue):
        selected_list = VODList.objects.create(name="Selected list")
        other_list = VODList.objects.create(name="Other list")
        inactive_list = VODList.objects.create(
            name="Disabled list", is_enabled=False
        )
        selected = VODAccessPolicy.objects.create(
            name="Selected profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        also_selected = VODAccessPolicy.objects.create(
            name="Also selected",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        disabled_rule = VODAccessPolicy.objects.create(
            name="Disabled rule",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        other = VODAccessPolicy.objects.create(
            name="Other list profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        non_list = VODAccessPolicy.objects.create(
            name="Provider profile",
            category_mode=VODAccessPolicy.CategoryMode.PROVIDER,
        )
        inactive = VODAccessPolicy.objects.create(
            name="Inactive list profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
            is_active=False,
        )
        list_disabled = VODAccessPolicy.objects.create(
            name="Disabled list profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        for policy in (selected, also_selected, non_list, inactive):
            VODPolicyList.objects.create(policy=policy, vod_list=selected_list)
        VODPolicyList.objects.create(
            policy=disabled_rule, vod_list=selected_list, enabled=False
        )
        VODPolicyList.objects.create(policy=also_selected, vod_list=other_list)
        VODPolicyList.objects.create(policy=other, vod_list=other_list)
        VODPolicyList.objects.create(
            policy=list_disabled, vod_list=inactive_list
        )
        enqueue.return_value = True

        queued = enqueue_selected_list_profile_rebuilds(
            [selected_list.pk, other_list.pk, inactive_list.pk],
            trigger_reason="Lists changed",
        )

        self.assertEqual(queued, 3)
        self.assertEqual(
            {call.args[0] for call in enqueue.call_args_list},
            {selected.pk, also_selected.pk, other.pk},
        )
        self.assertTrue(all(
            call.kwargs["trigger_reason"] == "Lists changed"
            for call in enqueue.call_args_list
        ))

    def test_list_generation_changes_list_profile_build_signature(self):
        vod_list = VODList.objects.create(name="Changing list")
        policy = VODAccessPolicy.objects.create(
            name="List profile",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        VODPolicyList.objects.create(policy=policy, vod_list=vod_list)
        before = profile_selection_signature(policy)

        VODList.objects.filter(pk=vod_list.pk).update(active_generation=2)

        self.assertNotEqual(before, profile_selection_signature(policy))

    def test_disabled_list_generation_does_not_restart_list_profile_build(self):
        vod_list = VODList.objects.create(
            name="Disabled list generation", is_enabled=False
        )
        policy = VODAccessPolicy.objects.create(
            name="List profile with disabled list",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        VODPolicyList.objects.create(policy=policy, vod_list=vod_list)
        before = profile_selection_signature(policy)

        VODList.objects.filter(pk=vod_list.pk).update(active_generation=2)
        self.assertEqual(before, profile_selection_signature(policy))

        VODList.objects.filter(pk=vod_list.pk).update(is_enabled=True)
        self.assertNotEqual(before, profile_selection_signature(policy))

    @patch("apps.vod.profile_selection.enqueue_selected_list_profile_rebuilds")
    @patch("apps.vod.tasks._run_vod_list_builder")
    def test_rebuild_task_only_enqueues_selected_list_profiles(
        self, build_list, enqueue
    ):
        vod_list = VODList.objects.create(name="Changing list")
        build_list.return_value = {
            "id": vod_list.pk, "name": vod_list.name, "status": "complete",
        }

        rebuild_vod_list.run(vod_list.pk)

        enqueue.assert_called_once_with(
            [vod_list.pk],
            trigger_reason='VOD list "Changing list" was rebuilt',
        )

    @patch("apps.vod.lists.CoreSettings.get_tmdb_languages", return_value=["de-DE"])
    @patch("apps.vod.lists.CoreSettings.get_tmdb_api_token", return_value="token")
    @patch("apps.vod.tmdb.Client.get")
    def test_tmdb_watch_provider_is_an_external_list(
        self,
        get,
        _token,
        _languages,
    ):
        self.movie.tmdb_id = "777"
        self.movie.save(update_fields=["tmdb_id"])
        get.return_value = {
            "page": 1,
            "total_pages": 1,
            "results": [
                {
                    "id": 777,
                    "title": "Curated Movie",
                    "release_date": "2026-02-12",
                },
                {
                    "id": 777,
                    "title": "Curated Movie",
                    "release_date": "2026-02-12",
                },
                {
                    "id": 888,
                    "title": "Remote Only",
                    "release_date": "2025-10-01",
                },
                {
                    "id": 888,
                    "title": "Remote Only",
                    "release_date": "2025-10-01",
                },
            ],
        }
        vod_list = VODList.objects.create(
            name="Apple TV movies",
            list_type=VODList.ListType.EXTERNAL,
            content_type=VODList.ContentType.MOVIE,
            provider="tmdb",
            external_key="watch-provider",
            settings={
                "watch_provider_id": "350",
                "watch_region": "DE",
                "watch_monetization_types": "flatrate",
            },
        )

        rebuild_tmdb_list(vod_list)

        get.assert_called_once_with(
            "discover/movie",
            page=1,
            language="de-DE",
            watch_region="DE",
            with_watch_providers="350",
            with_watch_monetization_types="flatrate",
            sort_by="popularity.desc",
        )
        items = list(
            vod_list.items.order_by("position").values_list(
                "movie_id", "external_id", "title"
            )
        )
        self.assertEqual(items[0], (self.movie.pk, "777", "Curated Movie"))
        self.assertEqual(items[1], (None, "888", "Remote Only"))

    @patch("apps.vod.tasks.rebuild_vod_list.delay")
    def test_rebuild_endpoint_queues_and_returns_immediately(self, delay):
        delay.return_value = Mock(id="list-task-1")
        vod_list = VODList.objects.create(
            name="Metadata list",
            list_type=VODList.ListType.DYNAMIC,
            content_type=VODList.ContentType.MOVIE,
            rules=[{"required_genres": ["Drama"]}],
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self._request(
                "post",
                f"/api/vod/lists/{vod_list.pk}/rebuild/",
                "rebuild",
                pk=vod_list.pk,
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.data["sync_status"], "queued")
        delay.assert_called_once_with(vod_list.pk, True)

    def test_manual_add_and_remove_uses_atomic_generations(self):
        vod_list = VODList.objects.create(name="Watch next")
        add_response = self._request(
            "post",
            f"/api/vod/lists/{vod_list.pk}/add-items/",
            "add_items",
            data={
                "selections": [
                    {
                        "content_type": "movie",
                        "canonical_id": self.movie.pk,
                        "relation_id": self.movie_relation.pk,
                    }
                ]
            },
            pk=vod_list.pk,
        )
        self.assertEqual(add_response.status_code, 200)
        item_id = add_response.data["preview"][0]["id"]

        remove_response = self._request(
            "post",
            f"/api/vod/lists/{vod_list.pk}/remove-items/",
            "remove_items",
            data={"item_ids": [item_id]},
            pk=vod_list.pk,
        )

        self.assertEqual(remove_response.status_code, 200)
        self.assertEqual(remove_response.data["item_count"], 0)
        vod_list.refresh_from_db()
        self.assertEqual(vod_list.active_generation, 3)

    def test_external_list_requires_provider_and_key(self):
        response = self._request(
            "post",
            "/api/vod/lists/",
            "create",
            data={
                "name": "Broken external list",
                "list_type": "external",
                "content_type": "movie",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("provider", response.data)

    def test_clients_cannot_create_system_lists(self):
        response = self._request(
            "post",
            "/api/vod/lists/",
            "create",
            data={
                "name": "Client-created remainder",
                "list_type": "system",
                "content_type": "all",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("list_type", response.data)

    def test_standard_user_cannot_manage_lists(self):
        response = self._request(
            "get",
            "/api/vod/lists/",
            "list",
            user=self.user,
        )

        self.assertEqual(response.status_code, 403)

    def test_system_list_cannot_be_deleted(self):
        vod_list = VODList.objects.create(
            name="Unsorted",
            list_type=VODList.ListType.SYSTEM,
            is_system=True,
            is_visible=False,
        )

        response = self._request(
            "delete",
            f"/api/vod/lists/{vod_list.pk}/",
            "destroy",
            pk=vod_list.pk,
        )

        self.assertEqual(response.status_code, 409)
        self.assertTrue(VODList.objects.filter(pk=vod_list.pk).exists())

    @patch("apps.vod.profile_selection.enqueue_profile_selection_rebuild")
    def test_deleting_list_rebuilds_only_profiles_using_it(self, enqueue):
        deleted_list = VODList.objects.create(name="Delete this list")
        other_list = VODList.objects.create(name="Keep this list")
        selected = VODAccessPolicy.objects.create(
            name="Uses deleted list",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        other = VODAccessPolicy.objects.create(
            name="Uses another list",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        disabled_rule = VODAccessPolicy.objects.create(
            name="Disabled list rule",
            category_mode=VODAccessPolicy.CategoryMode.LISTS,
        )
        provider_mode = VODAccessPolicy.objects.create(
            name="Provider group mode",
            category_mode=VODAccessPolicy.CategoryMode.PROVIDER,
        )
        VODPolicyList.objects.create(policy=selected, vod_list=deleted_list)
        VODPolicyList.objects.create(policy=other, vod_list=other_list)
        VODPolicyList.objects.create(
            policy=disabled_rule, vod_list=deleted_list, enabled=False
        )
        VODPolicyList.objects.create(
            policy=provider_mode, vod_list=deleted_list
        )
        VODAccessPolicy.objects.filter(
            pk__in=[selected.pk, other.pk, disabled_rule.pk, provider_mode.pk]
        ).update(selection_status=VODAccessPolicy.SelectionStatus.READY)

        response = self._request(
            "delete",
            f"/api/vod/lists/{deleted_list.pk}/",
            "destroy",
            pk=deleted_list.pk,
        )

        self.assertEqual(response.status_code, 204)
        enqueue.assert_called_once_with(
            selected.pk,
            trigger_reason='VOD list "Delete this list" was deleted',
        )
        self.assertFalse(VODList.objects.filter(pk=deleted_list.pk).exists())
        self.assertEqual(
            set(VODAccessPolicy.objects.filter(
                pk__in=[other.pk, disabled_rule.pk, provider_mode.pk],
                selection_status=VODAccessPolicy.SelectionStatus.READY,
            ).values_list("pk", flat=True)),
            {other.pk, disabled_rule.pk, provider_mode.pk},
        )
