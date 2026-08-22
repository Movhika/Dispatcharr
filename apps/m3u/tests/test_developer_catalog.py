from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.m3u.api_views import M3UAccountViewSet
from apps.m3u.models import M3UAccount
from apps.vod.models import M3UMovieRelation, Movie, VODCategory


class M3UDeveloperCatalogTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.admin = user_model.objects.create_user(
            username="catalog-admin",
            password="test",
            user_level=user_model.UserLevel.ADMIN,
        )
        self.standard = user_model.objects.create_user(
            username="catalog-user",
            password="test",
            user_level=user_model.UserLevel.STANDARD,
        )
        self.account = M3UAccount.objects.create(
            name="provider-a",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="xc-user",
            password="xc-password",
        )
        category = VODCategory.objects.create(
            name="GERMANY MOVIES", category_type="movie"
        )
        movie = Movie.objects.create(name="Avatar", year=2025)
        self.relation = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=movie,
            category=category,
            stream_id="1234",
            container_extension="mkv",
        )
        self.factory = APIRequestFactory()
        self.view = M3UAccountViewSet.as_view({"get": "developer_catalog"})

    def test_admin_can_search_the_parsed_movie_catalog(self):
        request = self.factory.get(
            "/api/m3u/accounts/1/developer-catalog/",
            {"scope": "movie", "search": "Avatar"},
        )
        force_authenticate(request, user=self.admin)

        response = self.view(request, pk=self.account.pk)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["provider_id"], "1234")
        self.assertEqual(response.data["results"][0]["group"], "GERMANY MOVIES")

    def test_non_admin_cannot_open_the_developer_catalog(self):
        request = self.factory.get(
            "/api/m3u/accounts/1/developer-catalog/", {"scope": "movie"}
        )
        force_authenticate(request, user=self.standard)

        response = self.view(request, pk=self.account.pk)

        self.assertEqual(response.status_code, 403)
