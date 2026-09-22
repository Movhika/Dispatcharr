from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate
from unittest.mock import Mock, patch

from apps.m3u.models import M3UAccount
from apps.vod.api_views import VODListViewSet
from apps.vod.lists import rebuild_dynamic_list, rebuild_tmdb_list
from apps.vod.models import (
    M3UMovieRelation,
    Movie,
    Series,
    VODList,
    VODListItem,
    VODListSourceMembership,
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
