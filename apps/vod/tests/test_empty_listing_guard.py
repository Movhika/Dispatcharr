"""
Regression test for empty VOD title listings wiping an account's sources.

After a refresh, cleanup_orphaned_vod_content deletes every relation the refresh
did not see. When a provider transiently returns an empty movie or series
list, that removed all of the account's sources of that type, and the movies
or series only that account provided.
"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TransactionTestCase
from django.utils import timezone

from apps.m3u.models import M3UAccount
from apps.vod.models import M3UMovieRelation, M3UVODCategoryRelation, Movie, VODCategory
from apps.vod.tasks import cleanup_orphaned_vod_content, refresh_vod_content


class EmptyVODListingGuardTests(TransactionTestCase):
    def setUp(self):
        self.account = M3UAccount.objects.create(
            name="Test XC Provider",
            server_url="http://example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
        )
        self.category = VODCategory.objects.create(name="Movies", category_type="movie")
        M3UVODCategoryRelation.objects.create(
            category=self.category, m3u_account=self.account, enabled=True
        )
        self.movie = Movie.objects.create(name="Film", year=2020)
        self.relation = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=self.movie,
            category=self.category,
            stream_id="1",
        )
        M3UMovieRelation.objects.filter(pk=self.relation.pk).update(
            last_seen=timezone.now() - timedelta(days=1)
        )

    def refresh(self, movies):
        client = MagicMock()
        client.get_vod_categories.return_value = [
            {"category_id": "1", "category_name": "Movies"}
        ]
        client.get_series_categories.return_value = []
        with (
            patch("apps.m3u.models.M3UAccount.get_user_agent_string", return_value="Test/1.0"),
            patch("apps.vod.tasks.XtreamCodesClient") as client_class,
            patch(
                "apps.vod.tasks.batch_create_categories",
                side_effect=[{self.category.name: self.category}, {}],
            ),
            patch("apps.vod.tasks.refresh_movies", return_value=movies),
            patch("apps.vod.tasks.refresh_series", return_value=0),
            patch("apps.m3u.tasks.send_m3u_update") as notify,
        ):
            client_class.return_value.__enter__.return_value = client
            result = refresh_vod_content(self.account.id)
        return result, notify

    def test_empty_movie_listing_keeps_existing_movie_sources(self):
        result, notify = self.refresh(movies=0)

        self.assertTrue(M3UMovieRelation.objects.filter(pk=self.relation.pk).exists())
        self.assertTrue(Movie.objects.filter(pk=self.movie.pk).exists())
        self.assertIn("listed no movies", result)
        self.assertEqual(notify.call_args.kwargs["status"], "success")
        self.assertIn("listed no movies", notify.call_args.kwargs["message"])

    def test_listing_with_titles_still_removes_unseen_sources(self):
        result, notify = self.refresh(movies=5)

        self.assertFalse(M3UMovieRelation.objects.filter(pk=self.relation.pk).exists())
        self.assertNotIn("listed no", result)
        self.assertNotIn("listed no", notify.call_args.kwargs["message"])

    def test_cleanup_keeps_only_the_named_content_types(self):
        start = timezone.now()

        result = cleanup_orphaned_vod_content(
            account_id=self.account.id, scan_start_time=start, keep=["movie"]
        )
        self.assertIn("0 stale movie relations", result)
        self.assertTrue(M3UMovieRelation.objects.filter(pk=self.relation.pk).exists())

        cleanup_orphaned_vod_content(account_id=self.account.id, scan_start_time=start)
        self.assertFalse(M3UMovieRelation.objects.filter(pk=self.relation.pk).exists())
