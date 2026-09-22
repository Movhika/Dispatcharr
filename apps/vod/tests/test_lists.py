from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.models import M3UAccount
from apps.vod.api_views import VODListViewSet
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
