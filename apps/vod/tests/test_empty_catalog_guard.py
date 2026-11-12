"""
A provider that suddenly lists no movies or series must not wipe their sources.

The stale cleanup after a refresh deletes every source the refresh did not see.
When a provider answers with an empty list for one content type, that would
delete all sources of that type, so they are kept until a refresh lists titles.
"""
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TransactionTestCase
from django.utils import timezone

from apps.m3u.models import M3UAccount
from apps.vod.models import (
    M3UMovieRelation,
    M3UVODCategoryRelation,
    Movie,
    VODCategory,
)
from apps.vod.tasks import _refresh_vod_content_impl, cleanup_orphaned_vod_content


class EmptyCatalogGuardTests(TransactionTestCase):
    def setUp(self):
        self.account = M3UAccount.objects.create(
            name="Provider",
            server_url="http://example.com",
            username="user",
            password="pass",
            account_type=M3UAccount.Types.XC,
            is_active=True,
            custom_properties={
                "enable_vod": True,
                "vod_catalog_counts": {
                    "movies": {"provider_total": 120, "selected_total": 1}
                },
            },
        )
        self.category = VODCategory.objects.create(name="Movies", category_type="movie")
        M3UVODCategoryRelation.objects.create(
            category=self.category, m3u_account=self.account, enabled=True
        )
        self.movie = Movie.objects.create(name="Film", year=2020)
        self.source = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=self.movie,
            category=self.category,
            stream_id="1",
        )
        M3UMovieRelation.objects.filter(pk=self.source.pk).update(
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
            patch("apps.vod.profile_catalog.request_catalog_build"),
        ):
            client_class.return_value.__enter__.return_value = client
            _refresh_vod_content_impl(self.account.id)
        return notify

    def test_an_empty_movie_list_keeps_the_movie_sources(self):
        notify = self.refresh(movies=0)
        self.assertTrue(M3UMovieRelation.objects.filter(pk=self.source.pk).exists())
        self.assertTrue(Movie.objects.filter(pk=self.movie.pk).exists())
        self.account.refresh_from_db()
        # The counts keep describing the sources that are still there.
        self.assertEqual(
            self.account.custom_properties["vod_catalog_counts"]["movies"],
            {"provider_total": 120, "selected_total": 1},
        )
        message = notify.call_args.kwargs["message"]
        self.assertIn("listed no movies", message)
        self.assertEqual(notify.call_args.kwargs["status"], "success")

    def test_a_listing_with_titles_still_removes_unseen_sources(self):
        notify = self.refresh(movies=5)
        self.assertFalse(M3UMovieRelation.objects.filter(pk=self.source.pk).exists())
        self.assertNotIn("listed no", notify.call_args.kwargs["message"])

    def test_cleanup_keeps_only_the_named_content_types(self):
        start = timezone.now()
        result = cleanup_orphaned_vod_content(
            account_id=self.account.id, scan_start_time=start, keep=["movie"]
        )
        self.assertIn("0 stale movie relations", result)
        self.assertTrue(M3UMovieRelation.objects.filter(pk=self.source.pk).exists())
        cleanup_orphaned_vod_content(account_id=self.account.id, scan_start_time=start)
        self.assertFalse(M3UMovieRelation.objects.filter(pk=self.source.pk).exists())
