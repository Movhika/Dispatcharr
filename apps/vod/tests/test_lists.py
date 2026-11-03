from datetime import date, datetime, timedelta
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from django_celery_beat.models import PeriodicTask
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.output.views import (
    xc_get_vod_categories,
    xc_get_vod_info,
    xc_get_vod_streams,
)
from apps.vod import lists
from apps.vod.library import relation_queryset
from apps.vod.library_filters import period_window, season_start
from apps.vod.models import VODList, VODListItem, VODProfileList
# Imported as a module so its test case does not run twice.
from apps.vod.tests import test_profile_catalog


class RecurringTests(SimpleTestCase):
    def test_named_periods_follow_the_date(self):
        day = date(2027, 2, 3)
        self.assertEqual(season_start(day), date(2027, 1, 1))
        self.assertEqual(season_start(day, -1), date(2026, 10, 1))
        self.assertEqual(period_window("week", day), (date(2027, 2, 1), date(2027, 2, 7)))
        self.assertEqual(period_window("month", day), (date(2027, 2, 1), date(2027, 2, 28)))
        self.assertEqual(period_window("season", day), (date(2027, 1, 1), date(2027, 3, 31)))
        self.assertEqual(period_window("year", day), (date(2027, 1, 1), date(2027, 12, 31)))
        # A yearly day range may span the turn of the year.
        self.assertEqual(
            period_window("yearly", date(2027, 1, 3), "12-01", "01-06"),
            (date(2026, 12, 1), date(2027, 1, 6)),
        )
        self.assertEqual(
            period_window("yearly", date(2026, 12, 24), "12-01", "01-06"),
            (date(2026, 12, 1), date(2027, 1, 6)),
        )
        self.assertEqual(
            period_window("yearly", date(2027, 3, 1), "02-29", "03-31"),
            (date(2027, 2, 28), date(2027, 3, 31)),
        )

    def test_name_placeholders_follow_the_season(self):
        vod_list = VODList(name="Anime {season} {year}")
        self.assertEqual(
            lists.display_name(vod_list, date(2027, 8, 2)), "Anime Summer 2027"
        )
        self.assertEqual(lists.display_name(vod_list, date(2027, 11, 2)), "Anime Fall 2027")

    def test_visible_period_may_span_the_turn_of_the_year(self):
        christmas = VODList(name="Christmas", visible_from="12-01", visible_until="01-06")
        self.assertTrue(lists.is_visible(christmas, date(2026, 12, 24)))
        self.assertTrue(lists.is_visible(christmas, date(2027, 1, 3)))
        self.assertFalse(lists.is_visible(christmas, date(2027, 2, 1)))
        horror = VODList(name="Horror", visible_from="10-01", visible_until="10-31")
        self.assertTrue(lists.is_visible(horror, date(2026, 10, 31)))
        self.assertFalse(lists.is_visible(horror, date(2026, 11, 1)))
        self.assertTrue(lists.is_visible(VODList(name="Always")))
        self.assertFalse(lists.is_visible(VODList(name="Off", is_enabled=False)))


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class ListCatalogTests(TestCase):
    setUp = test_profile_catalog.ProfileCatalogTests.setUp
    source = test_profile_catalog.ProfileCatalogTests.source
    profile = test_profile_catalog.ProfileCatalogTests.profile
    build = test_profile_catalog.ProfileCatalogTests.build

    def make_list(self, name, list_type="manual", **fields):
        vod_list = VODList.objects.create(name=name, list_type=list_type, **fields)
        lists.build_list(vod_list)
        return vod_list

    def manual(self, name, *refs):
        vod_list = VODList.objects.create(name=name)
        lists.add_items(vod_list, refs)
        lists.build_list(vod_list)
        return vod_list

    def list_profile(self, *vod_lists, **fields):
        profile = self.profile(output_groups="lists", **fields)
        for order, vod_list in enumerate(vod_lists):
            VODProfileList.objects.create(profile=profile, vod_list=vod_list, order=order)
        return profile

    def names(self, **kwargs):
        return [row["name"] for row in xc_get_vod_streams(self.request, self.user, **kwargs)]

    def test_rules_lists_choose_titles_by_library_filters(self):
        german = self.make_list(
            "German",
            "rules",
            filters={"category": self.german.pk, "audio_language": "eng"},
        )
        # File data is the profile's choice; lists ignore it.
        self.assertEqual(list(german.items.values_list("movie", flat=True)), [self.film.pk])
        self.assertEqual(german.build_counts["titles"], 1)

    def test_lists_become_client_categories(self):
        german = self.make_list("German", "rules", filters={"category": self.german.pk})
        picks = self.manual(
            "Picks",
            ("movie", self.other.pk),
            ("movie", self.film.pk),
        )
        self.build(self.list_profile(german, picks, include_unsorted=False))
        german_id = str(lists.list_category_id(german.pk))
        picks_id = str(lists.list_category_id(picks.pk))
        self.assertEqual(
            [row["category_id"] for row in xc_get_vod_categories(self.user)],
            [german_id, picks_id],
        )
        # The profile chooses the source; a title is the same in every list.
        self.assertEqual(self.names(category_id=german_id), ["Film"])
        self.assertEqual(
            self.names(category_id=picks_id),
            ["Other", "Film"],
        )
        rows = {row["name"]: row for row in xc_get_vod_streams(self.request, self.user)}
        self.assertEqual(set(rows), {"Film", "Other"})
        film = rows["Film"]
        self.assertEqual(film["category_id"], german_id)
        self.assertEqual(film["category_ids"], [int(german_id), int(picks_id)])
        info = xc_get_vod_info(self.request, self.user, film["stream_id"])
        self.assertEqual(info["movie_data"]["category_id"], german_id)

    def test_unsorted_keeps_titles_in_no_list(self):
        picks = self.manual("Picks", ("movie", self.other.pk))
        profile = self.list_profile(picks)
        self.build(profile)
        self.assertEqual(
            [row["category_name"] for row in xc_get_vod_categories(self.user)],
            ["Picks", "Unsorted"],
        )
        self.assertEqual(
            self.names(category_id=str(lists.UNSORTED_CATEGORY_ID)),
            ["Film"],
        )
        profile.include_unsorted = False
        profile.save()
        self.build(profile)
        self.assertEqual(self.names(), ["Other"])

    def test_hidden_lists_leave_the_output_until_their_period(self):
        picks = self.manual(
            "Christmas {year}",
            ("movie", self.other.pk),
        )
        profile = self.list_profile(picks)
        with patch("apps.vod.lists.timezone.localdate", return_value=date(2026, 12, 10)):
            picks.visible_from, picks.visible_until = "12-01", "12-31"
            picks.save()
            self.build(profile)
            self.assertEqual(
                [row["category_name"] for row in xc_get_vod_categories(self.user)],
                ["Christmas 2026", "Unsorted"],
            )
        with patch("apps.vod.lists.timezone.localdate", return_value=date(2027, 2, 1)):
            self.build(profile)
            self.assertEqual(
                [row["category_name"] for row in xc_get_vod_categories(self.user)],
                ["Unsorted"],
            )

    def test_a_list_category_follows_the_list_order(self):
        picks = self.manual(
            "Picks",
            ("movie", self.film.pk),
            ("movie", self.other.pk),
        )
        self.build(self.list_profile(picks))
        category = str(lists.list_category_id(picks.pk))
        self.assertEqual(
            self.names(category_id=category),
            ["Film", "Other"],
        )
        lists.reorder_items(
            picks, list(picks.items.order_by("-position").values_list("pk", flat=True))
        )
        self.assertEqual(
            self.names(category_id=category),
            ["Other", "Film"],
        )

    def test_tmdb_lists_keep_titles_missing_from_the_library(self):
        self.film.tmdb_match_id = "11"
        self.film.save()
        pages = {
            1: {
                "total_pages": 2,
                "results": [
                    {"id": 99, "title": "Missing", "release_date": "2026-05-01"},
                    {"id": 11, "title": "Film", "release_date": "2020-01-01"},
                ],
            },
            2: {"total_pages": 2, "results": [{"id": 11, "title": "Duplicate"}]},
        }
        client = type("Client", (), {"get": lambda self, path, page, **params: pages[page]})()
        with patch("apps.vod.library.tmdb_client", return_value=client):
            trending = self.make_list(
                "Trending", "tmdb", tmdb_source="trending", content_type="movie"
            )
        items = list(trending.items.order_by("position"))
        self.assertEqual([item.tmdb_id for item in items], ["99", "11"])
        self.assertEqual([item.movie_id for item in items], [None, self.film.pk])
        counts = trending.build_counts
        self.assertEqual((counts["titles"], counts["available"]), (2, 1))
        self.assertGreaterEqual(counts["seconds"], 0)
        # Library matches made later are linked without downloading again.
        self.other.tmdb_match_id = "99"
        self.other.save()
        lists.build_list(trending, fetch=False)
        self.assertEqual(trending.items.filter(movie=self.other).count(), 1)

    def test_discover_lists_ask_tmdb_for_the_release_window(self):
        options = lists.discover_options(
            "series",
            {
                "release_mode": "season",
                "anime": True,
                "genres": ["16", "10765"],
                "original_language": "ja",
            },
            today=date(2027, 4, 20),
        )
        self.assertEqual(
            options,
            {
                "sort_by": "popularity.desc",
                "first_air_date.gte": "2027-04-01",
                "first_air_date.lte": "2027-06-30",
                "with_genres": "16|10765",
                "with_keywords": lists.TMDB_ANIME_KEYWORD,
                "with_original_language": "ja",
            },
        )
        # A streaming service is its own source: everything it offers.
        self.assertEqual(
            lists.provider_options("series", {"provider_id": "283", "region": "DE"}),
            {
                "sort_by": "popularity.desc",
                "watch_region": "DE",
                "with_watch_providers": "283",
                "with_watch_monetization_types": "flatrate",
            },
        )
        self.assertEqual(
            lists.discover_options(
                "movie", {"release_mode": "days", "release_days": 7}, date(2027, 4, 20)
            )["primary_release_date.gte"],
            "2027-04-14",
        )
        self.assertEqual(
            lists.discover_options(
                "series",
                {"release_mode": "season", "release_anchor": "2024-10-01"},
                date(2027, 4, 20),
            )["first_air_date.lte"],
            "2024-12-31",
        )
        christmas = [{"id": "207317", "name": "christmas"}, {"id": "1", "name": "santa"}]
        self.assertEqual(
            lists.discover_options("movie", {"keywords": christmas})["with_keywords"],
            "207317|1",
        )
        self.assertEqual(
            lists.discover_options(
                "movie", {"keywords": christmas, "keyword_match": "all"}
            )["with_keywords"],
            "207317,1",
        )
        # With Anime every keyword applies, as TMDB cannot mix any and all.
        self.assertEqual(
            lists.discover_options("movie", {"keywords": christmas, "anime": True})[
                "with_keywords"
            ],
            f"{lists.TMDB_ANIME_KEYWORD},207317,1",
        )

    def test_dated_rules_lists_follow_the_season_by_themselves(self):
        from apps.vod.tasks import refresh_dated_vod_lists

        self.film.tmdb_metadata = {"release_date": "2027-02-01"}
        self.film.save()
        season = self.make_list(
            "Season {season}",
            "rules",
            filters={"released_period": "season"},
        )
        fixed = self.make_list("Fixed", "rules", filters={"genre": "Drama"})
        later = timezone.now() + timedelta(days=1)
        past = self.make_list(
            "Fall 2026",
            "rules",
            filters={"released_period": "season", "released_period_anchor": "2026-10-01"},
        )
        with patch("apps.vod.lists.timezone.localdate", return_value=date(2027, 2, 2)):
            self.assertTrue(lists.dated(season))
            self.assertFalse(lists.dated(fixed))
            self.assertFalse(lists.dated(past))
            with patch("apps.vod.library_filters.timezone.localdate", return_value=date(2027, 2, 2)), patch(
                "apps.vod.lists.timezone.now", return_value=later
            ):
                refresh_dated_vod_lists()
        season.refresh_from_db()
        self.assertEqual(list(season.items.values_list("movie", flat=True)), [self.film.pk])

    def test_hidden_lists_skip_scheduled_downloads_until_they_show(self):
        from apps.vod.tasks import refresh_dated_vod_lists, refresh_vod_list

        christmas = VODList.objects.create(
            name="Christmas",
            list_type="tmdb",
            tmdb_source="trending",
            refresh_interval=24,
            visible_from="12-01",
            visible_until="12-31",
            built_at=timezone.make_aware(datetime(2026, 11, 20, 12)),
        )
        november, december = date(2026, 11, 30), date(2026, 12, 1)
        with patch("apps.vod.lists.build_list") as build, patch(
            "apps.vod.lists.timezone.localdate", return_value=november
        ):
            refresh_vod_list(christmas.pk, scheduled=True)
            build.assert_not_called()
            refresh_vod_list(christmas.pk)
            build.assert_called_once()
        self.assertFalse(lists.revealed(christmas, november))
        self.assertTrue(lists.revealed(christmas, december))
        with patch("apps.vod.lists.build_list") as build, patch(
            "apps.vod.lists.timezone.localdate", return_value=december
        ):
            refresh_dated_vod_lists()
        build.assert_called_once()
        christmas.built_at = timezone.make_aware(datetime(2026, 12, 1, 1))
        self.assertFalse(lists.revealed(christmas, december))
        christmas.refresh_interval = 0
        christmas.built_at = None
        self.assertFalse(lists.revealed(christmas, december))

    def test_preview_filters_by_the_profile_lists(self):
        from apps.vod import profile_catalog

        picks = self.manual("Picks", ("movie", self.film.pk))
        profile = self.list_profile(picks, include_unsorted=True)
        # The preview shows the built catalogue.
        self.build(profile)
        result = profile_catalog.preview(profile, "movie")
        self.assertEqual(
            result["categories"],
            [
                {"value": lists.list_category_id(picks.pk), "label": "Picks"},
                {"value": lists.UNSORTED_CATEGORY_ID, "label": "Unsorted"},
            ],
        )

        def titles(category):
            result = profile_catalog.preview(profile, "movie", category=category)
            return [row["title"] for row in result["results"]]

        self.assertEqual(titles(lists.list_category_id(picks.pk)), ["Film"])
        self.assertEqual(titles(lists.UNSORTED_CATEGORY_ID), ["Other"])
        # Provider categories are no client categories of list output.
        self.assertEqual(titles(self.english.pk), [])

    def test_list_changes_only_rebuild_profiles_using_them(self):
        picks = self.manual("Picks", ("movie", self.other.pk))
        using = self.list_profile(picks)
        self.build(using)
        self.build(self.default)
        with patch("apps.vod.profile_catalog.request_catalog_build") as request_build:
            lists.add_items(picks, [("movie", self.film.pk)])
            lists.build_list(picks)
            lists.refresh_profiles(picks)
        request_build.assert_called_once_with([using.pk], countdown=5)


class LibraryRecurringFilterTests(TestCase):
    def setUp(self):
        from apps.m3u.models import M3UAccount
        from apps.vod.models import M3UMovieRelation, Movie, VODCategory

        account = M3UAccount.objects.create(name="A", account_type="XC", is_active=True)
        category = VODCategory.objects.create(name="Movies", category_type="movie")
        self.movies = {}
        for name, metadata in (
            (
                "Winter",
                {
                    "release_date": "2027-02-10",
                    "age_ratings": {"DE": "12", "US": "PG-13"},
                    "keywords": [{"id": 1, "name": "christmas"}],
                },
            ),
            ("Autumn", {"release_date": "2026-10-20", "age_ratings": {"US": "R"}}),
            ("December", {"release_date": "2019-12-24", "age_rating": "FSK 6"}),
        ):
            movie = Movie.objects.create(name=name, tmdb_metadata=metadata)
            M3UMovieRelation.objects.create(
                m3u_account=account, movie=movie, category=category, stream_id=name
            )
            self.movies[name] = movie

    def matching(self, **filters):
        with patch(
            "apps.vod.library_filters.timezone.localdate", return_value=date(2027, 3, 1)
        ):
            return set(
                relation_queryset("movie", filters).values_list("movie__name", flat=True)
            )

    def test_named_release_periods(self):
        self.assertEqual(self.matching(released_period="season"), {"Winter"})
        self.assertEqual(self.matching(released_period="year"), {"Winter"})
        self.assertEqual(self.matching(released_period="month"), set())
        # A chosen season or year stays, e.g. Fall 2026 or the year 2019.
        self.assertEqual(
            self.matching(
                released_period="season", released_period_anchor=date(2026, 11, 1)
            ),
            {"Autumn"},
        )
        self.assertEqual(
            self.matching(released_period="year", released_period_anchor=date(2019, 1, 1)),
            {"December"},
        )
        self.assertEqual(self.matching(released_last_days=30), {"Winter"})
        self.assertEqual(
            self.matching(
                released_period="yearly",
                released_from_day="10-01",
                released_until_day="02-15",
            ),
            {"Winter", "Autumn"},
        )
        self.assertEqual(self.matching(released_last_days=30), {"Winter"})

    def test_lists_combine_provider_categories(self):
        from apps.m3u.models import M3UAccount
        from apps.vod.models import M3UMovieRelation, Movie, VODCategory

        account = M3UAccount.objects.get(name="A")
        kids = VODCategory.objects.create(name="Kids", category_type="movie")
        family = VODCategory.objects.create(name="Family", category_type="movie")
        for name, category in (("Cartoon", kids), ("Picnic", family)):
            M3UMovieRelation.objects.create(
                m3u_account=account,
                movie=Movie.objects.create(name=name),
                category=category,
                stream_id=name,
            )
        combined = VODList.objects.create(
            name="Kids & Family",
            list_type="rules",
            filters=lists.stored_filters({"category": f"{kids.pk},{family.pk}"}),
        )
        self.assertEqual(combined.filters, {"category": f"{kids.pk},{family.pk}"})
        lists.build_list(combined)
        self.assertEqual(
            set(combined.items.values_list("movie__name", flat=True)),
            {"Cartoon", "Picnic"},
        )
        self.assertEqual(self.matching(category=[kids.pk]), {"Cartoon"})
        # A name pattern also picks up categories the provider adds later.
        pattern = VODList.objects.create(
            name="Kids by name",
            list_type="rules",
            filters=lists.stored_filters({"category_match": "^(kids|family)$"}),
        )
        lists.build_list(pattern)
        self.assertEqual(
            set(pattern.items.values_list("movie__name", flat=True)),
            {"Cartoon", "Picnic"},
        )

    def test_age_rating_and_keywords(self):
        self.assertEqual(self.matching(max_age_rating=12), {"Winter", "December"})
        self.assertEqual(self.matching(max_age_rating=6), {"December"})
        # A country counts only its own rating: PG-13 is 13.
        self.assertEqual(
            self.matching(max_age_rating=12, age_rating_country="US"), set()
        )
        self.assertEqual(
            self.matching(max_age_rating=12, age_rating_country="DE"), {"Winter"}
        )
        self.assertEqual(self.matching(keyword="Christ"), {"Winter"})


class ListApiTests(TestCase):
    def setUp(self):
        from apps.m3u.models import M3UAccount
        from apps.vod.models import M3UMovieRelation, Movie, VODCategory

        self.client = APIClient()
        admin = User.objects.create_user(username="admin", password="x", user_level=10)
        self.client.force_authenticate(admin)
        account = M3UAccount.objects.create(name="A", account_type="XC", is_active=True)
        category = VODCategory.objects.create(name="Movies", category_type="movie")
        self.movie = Movie.objects.create(name="Film")
        self.sources = [
            M3UMovieRelation.objects.create(
                m3u_account=account, movie=self.movie, category=category, stream_id=key
            )
            for key in ("a", "b")
        ]

    def create(self, **data):
        with self.captureOnCommitCallbacks(execute=False):
            return self.client.post(reverse("api:vod:list-list"), data, format="json")

    def test_manual_lists_take_titles_also_from_the_sources_view(self):
        response = self.create(name="Picks")
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data["id"]
        url = reverse("api:vod:list-add-items", args=[pk])
        response = self.client.post(
            url,
            {"items": [{"content_type": "movie", "id": self.sources[1].pk}], "sources": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            list(VODListItem.objects.filter(vod_list_id=pk).values_list("movie", flat=True)),
            [self.movie.pk],
        )
        # The same title again from the Titles view adds nothing.
        self.client.post(
            url, {"items": [{"content_type": "movie", "id": self.movie.pk}]}, format="json"
        )
        preview = self.client.get(reverse("api:vod:list-detail", args=[pk])).data["preview"]
        self.assertEqual(preview[0]["content_id"], self.movie.pk)
        items = self.client.get(reverse("api:vod:list-items", args=[pk])).data
        self.assertEqual(items["count"], 1)
        self.assertEqual(items["results"][0]["title"], "Film")
        self.assertTrue(items["results"][0]["available"])

    def test_rules_lists_store_validated_library_filters(self):
        response = self.create(
            name="Anime {season}",
            list_type="rules",
            filters={
                "anime_mode": "only",
                "released_period": "season",
                "view": "sources",
                "resolution": "2160p",
            },
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data["filters"],
            {"anime_mode": "only", "released_period": "season"},
        )
        # Released after the Added period: no title can match.
        response = self.create(
            name="Never",
            list_type="rules",
            filters={"added_until": "2020-12-31", "released_since": "2021-01-01"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("released_since", response.data["filters"])
        response = self.create(
            name="Added lately, released long ago",
            list_type="rules",
            filters={"added_after_days": 30, "released_until": "1990-12-31"},
        )
        self.assertEqual(response.status_code, 201, response.data)
        response = self.create(name="Bad", list_type="rules", filters={"released_period": "yearly"})
        self.assertEqual(response.status_code, 400)
        self.assertIn("released_until_day", response.data["filters"])

    def test_tmdb_and_schedule_validation(self):
        response = self.create(
            name="Service",
            list_type="tmdb",
            tmdb_source="watch-provider",
            tmdb_settings={"provider_id": "8"},
        )
        # A streaming service lists movies or series, not both.
        self.assertEqual(set(response.data), {"tmdb_source"})
        response = self.create(
            name="Service",
            list_type="tmdb",
            tmdb_source="watch-provider",
            content_type="movie",
            tmdb_settings={"provider_id": "8"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data["tmdb_settings"]), {"region"})
        response = self.create(
            name="Discover",
            list_type="tmdb",
            tmdb_source="discover",
            content_type="movie",
            tmdb_settings={"release_mode": "days"},
        )
        self.assertEqual(set(response.data["tmdb_settings"]), {"release_days"})
        response = self.create(
            name="Anime season",
            list_type="tmdb",
            tmdb_source="discover",
            content_type="series",
            tmdb_settings={
                "release_mode": "season",
                "anime": True,
                "keywords": [{"id": 207317, "name": "christmas"}],
                "genres": [16],
                "original_language": "JA",
                "unknown": "dropped",
            },
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            response.data["tmdb_settings"],
            {
                "release_mode": "season",
                "anime": True,
                "keywords": [{"id": "207317", "name": "christmas"}],
                "genres": ["16"],
                "original_language": "ja",
            },
        )
        # Content decides what a source offers: no popular mix of both.
        response = self.create(name="Popular", list_type="tmdb", tmdb_source="popular")
        self.assertEqual(response.status_code, 400)
        self.assertIn("tmdb_source", response.data)
        response = self.create(
            name="Trending",
            list_type="tmdb",
            tmdb_source="trending",
            content_type="series",
            refresh_interval=24,
            visible_from="12-01",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("visible_until", response.data)
        response = self.create(
            name="Trending",
            list_type="tmdb",
            tmdb_source="trending",
            content_type="series",
            refresh_interval=24,
        )
        self.assertEqual(response.status_code, 201, response.data)
        task = PeriodicTask.objects.get(name=f"vod-list-{response.data['id']}-refresh")
        self.assertIn('"scheduled": true', task.kwargs)
        self.assertEqual(task.task, "apps.vod.tasks.refresh_vod_list")
        self.client.delete(reverse("api:vod:list-detail", args=[response.data["id"]]))
        self.assertFalse(PeriodicTask.objects.filter(pk=task.pk).exists())
        # Rules lists follow the Library and get no download schedule.
        rules = self.create(name="Rules", list_type="rules", filters={}, refresh_interval=24)
        self.assertFalse(
            PeriodicTask.objects.filter(name=f"vod-list-{rules.data['id']}-refresh").exists()
        )

    def test_tmdb_options_for_discover_lists(self):
        answers = {
            "watch/providers/regions": {
                "results": [{"iso_3166_1": "DE", "english_name": "Germany"}]
            },
            "watch/providers/tv": {
                "results": [
                    {"provider_id": 283, "provider_name": "Crunchyroll", "display_priority": 2},
                    {"provider_id": 8, "provider_name": "Netflix", "display_priority": 1},
                ]
            },
            "genre/tv/list": {"genres": [{"id": 16, "name": "Animation"}]},
        }
        client = type("Client", (), {"get": lambda self, path, **params: answers[path]})()
        with patch("apps.vod.library.tmdb_client", return_value=client):
            response = self.client.get(
                reverse("api:vod:list-tmdb-options"),
                {"content_type": "series", "region": "de"},
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["regions"], [{"value": "DE", "label": "Germany"}])
        self.assertEqual(
            [row["label"] for row in response.data["providers"]],
            ["Netflix", "Crunchyroll"],
        )
        self.assertEqual(response.data["genres"], [{"value": "16", "label": "Animation"}])
        self.assertIn(
            {"value": "ja", "label": "Japanese (jpn)"}, response.data["languages"]
        )

    def test_tmdb_keywords_are_searched_by_name(self):
        page = {"results": [{"id": 207317, "name": "christmas"}, {"id": 2, "name": ""}]}
        client = type("Client", (), {"get": lambda self, path, **params: page})()
        with patch("apps.vod.library.tmdb_client", return_value=client):
            response = self.client.get(
                reverse("api:vod:list-tmdb-keywords"), {"query": "christ"}
            )
        self.assertEqual(response.data, [{"value": "207317", "label": "christmas"}])

    def test_changing_the_type_replaces_the_titles(self):
        pk = self.create(name="Picks").data["id"]
        self.client.post(
            reverse("api:vod:list-add-items", args=[pk]),
            {"items": [{"content_type": "movie", "id": self.movie.pk}]},
            format="json",
        )
        with self.captureOnCommitCallbacks(execute=False):
            response = self.client.patch(
                reverse("api:vod:list-detail", args=[pk]),
                {"list_type": "rules", "filters": {"genre": "Drama"}},
                format="json",
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["list_type"], "rules")
        self.assertFalse(VODListItem.objects.filter(vod_list_id=pk).exists())

    def test_saving_changed_rules_reports_the_pending_rebuild(self):
        pk = self.create(name="Rules", list_type="rules", filters={}).data["id"]
        VODList.objects.filter(pk=pk).update(build_status=VODList.BuildStatus.READY)
        url = reverse("api:vod:list-detail", args=[pk])
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            response = self.client.patch(
                url, {"filters": {"genre": "Drama"}}, format="json"
            )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["build_status"], "pending")
        self.assertEqual(VODList.objects.get(pk=pk).build_status, "pending")
        self.assertTrue(callbacks)
        # Renaming changes no titles, so the list stays as it is.
        VODList.objects.filter(pk=pk).update(build_status=VODList.BuildStatus.READY)
        with self.captureOnCommitCallbacks(execute=False):
            response = self.client.patch(url, {"name": "Drama"}, format="json")
        self.assertEqual(response.data["build_status"], "ready")

    def test_only_manual_lists_are_edited_by_hand(self):
        pk = self.create(name="Rules", list_type="rules", filters={}).data["id"]
        response = self.client.post(
            reverse("api:vod:list-remove-items", args=[pk]), {"ids": [1]}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_profiles_store_their_ordered_lists(self):
        first = self.create(name="First").data["id"]
        second = self.create(name="Second").data["id"]
        response = self.client.post(
            reverse("api:vod:profile-list"),
            {"name": "Lists", "output_groups": "lists", "lists": [second, first]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["lists"], [second, first])
