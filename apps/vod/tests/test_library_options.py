"""Library account choices follow stored VOD sources and viewing permissions."""

from django.test import TestCase, override_settings

from apps.m3u.models import M3UAccount
from apps.vod import library
from apps.vod.models import M3UMovieRelation, M3USeriesRelation, Movie, Series

from . import test_library as fixtures


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class LibraryAccountOptionTests(TestCase):
    setUp = fixtures.LibraryTests.setUp
    endpoint = fixtures.LibraryTests.endpoint

    def options(self, **filters):
        response = self.client.get(self.endpoint("filter-options"), filters)
        self.assertEqual(response.status_code, 200, response.data)
        return {row["id"] for row in response.json()["accounts"]}

    def test_active_accounts_without_vod_sources_are_not_offered(self):
        empty = M3UAccount.objects.create(name="test-m3u", is_active=True)
        custom = M3UAccount.get_custom_account()
        custom.is_active = True
        custom.save()
        self.assertEqual(self.options(), {self.account.pk})
        self.assertNotIn(empty.pk, self.options())
        self.assertNotIn(custom.pk, self.options())

    def test_choices_follow_movie_series_and_disabled_content_types(self):
        account = M3UAccount.objects.create(name="Series only", is_active=True)
        series = Series.objects.create(name="Series")
        M3USeriesRelation.objects.create(
            m3u_account=account, series=series, external_series_id="1"
        )
        self.assertEqual(self.options(), {self.account.pk, account.pk})
        self.assertEqual(self.options(type="movie"), {self.account.pk})
        self.assertEqual(self.options(type="series"), {account.pk})
        self.user.custom_properties = {"vod_movies_enabled": False}
        self.user.save()
        self.client.force_authenticate(self.user)
        self.assertEqual(self.options(), {account.pk})
        self.assertEqual(self.options(type="movie"), set())

    def test_source_existence_not_account_name_or_type_decides(self):
        account = M3UAccount.objects.create(
            name="Standard with stored VOD",
            account_type=M3UAccount.Types.STADNARD,
            is_active=True,
        )
        M3UMovieRelation.objects.create(
            movie=self.movie, m3u_account=account, stream_id="1"
        )
        self.assertEqual(self.options(), {self.account.pk, account.pk})
        account.is_active = False
        account.save()
        self.assertEqual(self.options(), {self.account.pk})

    def test_hidden_adult_only_accounts_are_not_leaked(self):
        account = M3UAccount.objects.create(name="Adult only", is_active=True)
        movie = Movie.objects.create(name="Adult", is_adult=True)
        M3UMovieRelation.objects.create(movie=movie, m3u_account=account, stream_id="1")
        self.assertIn(account.pk, self.options())
        self.user.custom_properties = {"hide_adult_content": True}
        self.user.save()
        self.client.force_authenticate(self.user)
        self.assertEqual(self.options(), {self.account.pk})

    def test_current_account_filter_does_not_remove_other_choices(self):
        account = M3UAccount.objects.create(name="Second provider", is_active=True)
        M3UMovieRelation.objects.create(
            movie=self.movie, m3u_account=account, stream_id="1"
        )
        self.assertEqual(
            self.options(account=self.account.pk), {self.account.pk, account.pk}
        )

    def test_available_accounts_use_one_database_query(self):
        with self.assertNumQueries(1):
            rows = library.available_accounts({}, ["movie", "series"])
        self.assertEqual([row["id"] for row in rows], [self.account.pk])
