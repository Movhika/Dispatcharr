"""Provider details are fetched again only when they changed (or after a week)."""

from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, TestCase, override_settings
from django.utils import timezone

from apps.accounts.models import User
from apps.m3u.models import M3UAccount
from apps.output.views import xc_get_series_info
from apps.vod.models import (
    Episode,
    M3UEpisodeRelation,
    M3UMovieRelation,
    M3USeriesRelation,
    Movie,
    Series,
)
from apps.vod.provider_details import (
    details_due,
    episodes_due,
    mark_details_fetched,
    mark_episodes_fetched,
)
from apps.vod.tasks import refresh_movie_advanced_data


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class ProviderDetailsTests(TestCase):
    def setUp(self):
        self.account = M3UAccount.objects.create(
            name="Provider", account_type="XC", priority=10, is_active=True,
            server_url="http://provider.example.com", username="u", password="p",
        )
        self.series = Series.objects.create(name="Show", year=2020)
        self.movie = Movie.objects.create(name="Film", year=2020)

    def series_source(self, account=None, external="1", fetched=True, **props):
        source = M3USeriesRelation.objects.create(
            m3u_account=account or self.account,
            series=self.series,
            external_series_id=external,
            last_episode_refresh=timezone.now() if fetched else None,
            custom_properties={
                "basic_data": {"last_modified": "100"},
                "episodes_fetched": fetched,
                "detailed_fetched": fetched,
                **props,
            },
        )
        if fetched:
            mark_episodes_fetched(source, source.custom_properties)
            source.save(update_fields=["custom_properties"])
        return source

    def movie_source(self):
        source = M3UMovieRelation.objects.create(
            m3u_account=self.account,
            movie=self.movie,
            stream_id="1",
            last_advanced_refresh=timezone.now(),
            custom_properties={
                "basic_data": {"added": "100", "container_extension": "mkv"},
                "detailed_fetched": True,
            },
        )
        mark_details_fetched(source, source.custom_properties)
        source.save(update_fields=["custom_properties"])
        return source

    def test_episodes_are_due_only_when_the_provider_changed_them(self):
        source = self.series_source()
        self.assertFalse(episodes_due(source))
        # A day later nothing changed: the old 24-hour rule no longer applies.
        self.assertFalse(episodes_due(source, timezone.now() + timedelta(days=1)))
        source.custom_properties["basic_data"]["last_modified"] = "200"
        self.assertTrue(episodes_due(source))

    def test_a_week_old_list_is_fetched_again_as_a_safety_net(self):
        source = self.series_source()
        self.assertTrue(episodes_due(source, timezone.now() + timedelta(days=8)))
        self.assertTrue(episodes_due(self.series_source(external="2", fetched=False)))

    def test_lists_fetched_before_markers_follow_the_age_rule(self):
        source = self.series_source()
        del source.custom_properties["episodes_marker"]
        source.custom_properties["basic_data"]["last_modified"] = "200"
        self.assertFalse(episodes_due(source))
        self.assertTrue(episodes_due(source, timezone.now() + timedelta(days=8)))

    def test_movie_details_follow_the_added_date_and_container(self):
        source = self.movie_source()
        self.assertFalse(details_due(source))
        source.custom_properties["basic_data"]["added"] = "200"
        self.assertTrue(details_due(source))

    @patch("core.xtream_codes.Client")
    def test_unchanged_movie_details_are_not_fetched_again(self, client):
        source = self.movie_source()
        refresh_movie_advanced_data(source.pk)
        client.assert_not_called()
        M3UMovieRelation.objects.filter(pk=source.pk).update(
            custom_properties={
                **source.custom_properties,
                "basic_data": {"added": "200", "container_extension": "mkv"},
            }
        )
        client.return_value.__enter__.return_value.get_vod_info.return_value = {
            "info": {"name": "Film"}
        }
        refresh_movie_advanced_data(source.pk)
        client.assert_called_once()
        source.refresh_from_db()
        self.assertEqual(source.custom_properties["details_marker"], "200|mkv")

    @patch("apps.vod.tasks.refresh_series_episodes")
    def test_series_info_fetches_further_sources_that_are_due(self, refresh):
        other = M3UAccount.objects.create(
            name="Other", account_type="XC", priority=1, is_active=True,
            server_url="http://other.example.com", username="u", password="p",
        )
        self.series_source()
        further = self.series_source(account=other, external="2", fetched=False)
        episode = Episode.objects.create(
            series=self.series, name="E1", season_number=1, episode_number=1
        )
        M3UEpisodeRelation.objects.create(
            m3u_account=self.account,
            episode=episode,
            series_relation=M3USeriesRelation.objects.get(external_series_id="1"),
            stream_id="e1",
        )
        user = User.objects.create_user(username="viewer", password="x", user_level=10)
        xc_get_series_info(RequestFactory().get("/"), user, str(self.series.pk))
        # The first source is current; only the never fetched one is asked.
        refresh.assert_called_once()
        self.assertEqual(refresh.call_args.args[2], further.external_series_id)
