from unittest.mock import patch

from django.core.cache import cache
from django.http import Http404
from django.test import RequestFactory, SimpleTestCase, TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.m3u.models import M3UAccount
from apps.output.views import (
    xc_get_series,
    xc_get_series_info,
    xc_get_vod_categories,
    xc_get_vod_info,
    xc_get_vod_streams,
)
from apps.vod import profile_catalog
from apps.vod.models import (
    M3UMovieRelation,
    M3UVODCategoryRelation,
    Movie,
    VODCategory,
    VODProfile,
    VODProfileAssignment,
    VODProfileCategoryRule,
    VODProfileEntry,
)
from apps.vod.profiles import (
    normalize_edition_rules,
    output_name,
    profile_output_name,
)
from apps.vod.references import output_reference


class OutputNameTests(SimpleTestCase):
    metadata = {"audio_languages": ["ger", "eng"], "resolution": "2160p"}

    template = "{title} [{dub} · {resolution} · {features}]"

    def test_name_labels_replace_placeholder_values(self):
        labels = [
            {"field": "resolution", "values": ["1080p"], "label": "FHD"},
            {"field": "dub", "values": ["eng"], "label": "ENGLISH"},
            {"field": "dub", "values": ["several"], "label": "MULTI-DUB"},
            {"field": "sub", "values": ["several"], "label": "MULTI-SUB"},
            {"field": "features", "values": ["hdr"], "label": ""},
        ]
        template = "{title} [{dub} · {sub} · {resolution} · {features}]"
        self.assertEqual(
            output_name(
                template,
                "Film",
                {
                    "audio_languages": ["eng"],
                    "subtitle_languages": ["ger", "eng"],
                    "resolution": "1080p",
                    "video_features": ["hdr"],
                },
                labels=labels,
            ),
            "Film [ENGLISH · MULTI-SUB · FHD]",
        )
        self.assertEqual(
            output_name(template, "Film", self.metadata, labels=labels),
            "Film [MULTI-DUB · 2160p]",
        )

    def test_name_label_combinations_win_and_other_values_fall_back(self):
        labels = [
            {"field": "dub", "values": ["eng", "ger"], "label": "DUAL"},
            {"field": "dub", "values": ["several"], "label": "MULTI"},
            {"field": "dub", "values": ["other"], "label": ""},
            {"field": "resolution", "values": ["2160p"], "label": "4K"},
            {"field": "resolution", "values": ["other"], "label": ""},
            {"field": "features", "values": ["dv"], "label": "DOLBY VISION"},
            {"field": "features", "values": ["other"], "label": ""},
        ]
        template = "{title} [{dub} · {resolution} · {features}]"

        def name(**metadata):
            return output_name(template, "Film", metadata, labels=labels)

        self.assertEqual(
            name(audio_languages=["ger", "eng"], resolution="2160p"), "Film [DUAL · 4K]"
        )
        self.assertEqual(
            name(audio_languages=["ger", "eng", "fre"], resolution="1080p"),
            "Film [MULTI]",
        )
        self.assertEqual(
            name(audio_languages=["eng"], video_features=["hdr", "dv"]),
            "Film [DOLBY VISION]",
        )

    def test_empty_placeholders_leave_no_brackets(self):
        self.assertEqual(
            output_name(self.template, "Film", self.metadata),
            "Film [GER/ENG · 2160p]",
        )
        self.assertEqual(output_name(self.template, "Film", {}), "Film")
        self.assertEqual(
            output_name(self.template, "|USA| Film -", self.metadata),
            "|USA| Film - [GER/ENG · 2160p]",
        )
        self.assertEqual(
            output_name(self.template, "Film", {"video_features": ["hdr"]}),
            "Film [HDR]",
        )

    def test_compact_names_show_only_title_year_and_edition(self):
        labels = [{"field": "dub", "values": ["ger", "eng"], "label": "DUAL"}]
        profile = VODProfile(
            name_template="{title} ({year}) [{dub}]", name_labels=labels
        )
        self.assertEqual(
            profile_output_name(
                profile, "Film", self.metadata, year=2020, edition="4K", provider="A"
            ),
            "Film 4K (2020)",
        )
        profile.output_mode = VODProfile.OutputMode.VARIANTS
        self.assertEqual(
            profile_output_name(profile, "Film", self.metadata, year=2020),
            "Film (2020) [DUAL]",
        )

    def test_placeholders_and_edition(self):
        self.assertEqual(
            output_name(
                "{title} ({year}) - {dub} {format}",
                "Film",
                self.metadata,
                year=2020,
                extension="mkv",
            ),
            "Film (2020) - GER/ENG MKV",
        )
        self.assertEqual(output_name("{title} ({year})", "Film", {}), "Film")
        self.assertEqual(
            output_name("{title} ({sub} | {provider})", "Film", {}, provider="A"),
            "Film (A)",
        )
        self.assertEqual(
            output_name(self.template, "Film", self.metadata, edition="4K"),
            "Film 4K [GER/ENG · 2160p]",
        )
        self.assertEqual(
            output_name("{title} | {edition}", "Film", {}, edition="4K"), "Film | 4K"
        )


@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class ProfileCatalogTests(TestCase):
    SOURCE_FORMAT = "{title} [{dub} · {resolution} · {features}]"

    def setUp(self):
        self.request = RequestFactory().get("/player_api.php")
        self.user = User.objects.create_user(
            username="catalog-user", password="test", user_level=1
        )
        self.high = M3UAccount.objects.create(
            name="High", account_type="XC", priority=10, is_active=True
        )
        self.low = M3UAccount.objects.create(
            name="Low", account_type="XC", priority=1, is_active=True
        )
        self.german = VODCategory.objects.create(
            name="DE | Movies", category_type="movie"
        )
        self.english = VODCategory.objects.create(
            name="EN | Movies", category_type="movie"
        )
        for account in (self.high, self.low):
            for category in (self.german, self.english):
                M3UVODCategoryRelation.objects.create(
                    m3u_account=account, category=category, enabled=True
                )
        self.film = Movie.objects.create(name="Film", year=2020)
        self.film_en = self.source(self.high, self.film, self.english, ["eng"], "1080p")
        self.film_de = self.source(self.low, self.film, self.german, ["ger"], "1080p")
        self.film_4k = self.source(self.low, self.film, self.german, ["ger"], "2160p")
        self.other = Movie.objects.create(name="Other", year=2021)
        self.other_en = self.source(
            self.high, self.other, self.english, ["eng"], "720p"
        )
        self.default = VODProfile.objects.get(is_default=True)

    def source(self, account, movie, category, languages, resolution):
        return M3UMovieRelation.objects.create(
            m3u_account=account,
            movie=movie,
            category=category,
            stream_id=f"{account.pk}-{movie.pk}-{resolution}-{languages[0]}",
            container_extension="mkv",
            declared_metadata={
                "audio_languages": languages,
                "resolution": resolution,
            },
        )

    def streams(self, user=None):
        return {
            row["name"]: row["stream_id"]
            for row in xc_get_vod_streams(self.request, user or self.user)
        }

    def profile(self, rules=((".*", "enable"),), **fields):
        profile = VODProfile.objects.create(name="Custom", **fields)
        VODProfileAssignment.objects.create(user=self.user, profile=profile)
        for order, (pattern, action, *case_sensitive) in enumerate(rules):
            VODProfileCategoryRule.objects.create(
                profile=profile,
                scope="movie",
                regex_pattern=pattern,
                action=action,
                case_sensitive=bool(case_sensitive),
                order=order,
            )
        return profile

    def build(self, profile):
        counts = profile_catalog.build_catalog(profile)
        profile.refresh_from_db()
        return counts

    def test_default_catalogue_reproduces_live_output(self):
        live = xc_get_vod_streams(self.request, self.user)
        live_german = xc_get_vod_streams(
            self.request, self.user, category_id=self.german.pk
        )
        live_categories = xc_get_vod_categories(self.user)
        self.assertEqual([row["name"] for row in live], ["Film", "Other"])
        self.assertEqual([row["name"] for row in live_german], ["Film"])
        self.assertNotEqual(live_german[0]["stream_id"], self.film.pk)
        counts = self.build(self.default)
        self.assertEqual(self.default.catalog_status, VODProfile.CatalogStatus.READY)
        # Film's best German source is kept for category requests only.
        self.assertEqual(
            counts["movie"], {"titles": 2, "entries": 2, "editions": {"": 2}}
        )
        self.assertEqual(VODProfileEntry.objects.count(), 3)
        self.assertEqual(xc_get_vod_streams(self.request, self.user), live)
        self.assertEqual(
            xc_get_vod_streams(self.request, self.user, category_id=self.german.pk),
            live_german,
        )
        self.assertEqual(xc_get_vod_categories(self.user), live_categories)
        self.assertEqual(len(live_categories), 2)

    def test_unbuilt_custom_profile_offers_nothing(self):
        self.profile()
        self.assertEqual(self.streams(), {})
        with self.assertRaises(Http404):
            xc_get_vod_info(self.request, self.user, self.film.pk)

    def test_filters_and_ranking_choose_the_source(self):
        self.build(
            self.profile(
                content_filters={"audio_languages": ["ger"]},
                ranking=["resolution_desc", "provider"],
            )
        )
        self.assertEqual(list(self.streams()), ["Film"])
        entry = VODProfileEntry.objects.get(profile__name="Custom")
        self.assertEqual(entry.relation_id, self.film_4k.pk)
        self.assertEqual(entry.public_id, self.film.pk)
        # Every source the profile offers stands in, the selected version first.
        self.assertEqual(entry.source_ids, [self.film_4k.pk, self.film_de.pk])
        with self.assertRaises(Http404):
            xc_get_vod_info(self.request, self.user, self.other.pk)

    def test_client_names_use_the_profile_name_labels(self):
        profile = self.profile(
            output_mode="variants",
            name_template=self.SOURCE_FORMAT,
            name_labels=[
                {"field": "resolution", "values": ["1080p"], "label": "FHD"},
                {"field": "dub", "values": ["eng"], "label": "ENGLISH"},
            ],
        )
        self.build(profile)
        name = "Film [ENGLISH · FHD]"
        info = xc_get_vod_info(self.request, self.user, self.streams()[name])
        self.assertEqual(info["info"]["name"], name)
        # Compact entries fall back to other sources, so they show none.
        profile.output_mode = "compact"
        profile.save()
        self.build(profile)
        self.assertEqual(sorted(self.streams()), ["Film", "Other"])

    def test_excluded_titles_are_left_out(self):
        self.build(
            self.profile(
                excluded_titles=[{"content_type": "movie", "id": self.film.pk}]
            )
        )
        self.assertEqual(list(self.streams()), ["Other"])
        with self.assertRaises(Http404):
            xc_get_vod_info(self.request, self.user, self.film.pk)

    def test_import_rules_first_match_decides_and_unmatched_is_disabled(self):
        profile = self.profile(
            rules=[("^EN", "disable"), ("^DE", "enable", True)]
        )
        self.build(profile)
        self.assertEqual(list(self.streams()), ["Film"])
        self.assertEqual(
            [row["category_name"] for row in xc_get_vod_categories(self.user)],
            ["DE | Movies"],
        )
        profile.category_rules.update(regex_pattern="^de")
        self.build(profile)
        self.assertEqual(self.streams(), {})

    def test_manual_choices_win_over_import_rules(self):
        low_german, high_english = (
            M3UVODCategoryRelation.objects.get(m3u_account=account, category=category)
            for account, category in (
                (self.low, self.german),
                (self.high, self.english),
            )
        )
        profile = self.profile(
            rules=[("^DE", "disable")],
            category_choices=[{"relation": low_german.pk, "enabled": True}],
        )
        self.build(profile)
        self.assertEqual(
            VODProfileEntry.objects.get(profile=profile).relation_id, self.film_de.pk
        )
        profile.category_choices = [
            {"relation": low_german.pk, "enabled": False},
            {"relation": high_english.pk, "enabled": True},
        ]
        profile.save()
        self.build(profile)
        self.assertEqual(
            sorted(
                VODProfileEntry.objects.filter(profile=profile).values_list(
                    "relation_id", flat=True
                )
            ),
            [self.film_en.pk, self.other_en.pk],
        )

    def test_editions_get_their_own_entry_and_public_id(self):
        self.build(
            self.profile(
                content_filters={"audio_languages": ["ger"]},
                edition_rules=[
                    {
                        "id": "uhd",
                        "name": "4K",
                        "title_suffix": "4K",
                        "min_resolution": 2160,
                        "max_resolution": 0,
                        "required_audio_languages": [],
                        "required_subtitle_languages": [],
                        "required_video_features": [],
                    }
                ],
            )
        )
        streams = self.streams()
        self.assertEqual(set(streams), {"Film", "Film 4K"})
        self.assertEqual(streams["Film"], self.film.pk)
        self.assertNotEqual(streams["Film 4K"], self.film.pk)
        info = xc_get_vod_info(self.request, self.user, streams["Film 4K"])
        self.assertEqual(info["info"]["name"], "Film 4K")

    def test_editions_follow_required_and_excluded_values(self):
        edition_of = profile_catalog._edition_matcher(
            normalize_edition_rules(
                [
                    {
                        "title_suffix": "4K",
                        "min_resolution": 2160,
                        "excluded_video_features": ["hdr"],
                    },
                    {
                        "title_suffix": "4K HDR",
                        "min_resolution": 2160,
                        "required_video_features": ["hdr"],
                    },
                ]
            )
        )
        self.assertEqual(
            edition_of({"resolution": "2160p", "video_features": ["hdr"]}), "4K HDR"
        )
        self.assertEqual(edition_of({"resolution": "2160p"}), "4K")
        self.assertEqual(edition_of({"resolution": "1080p"}), "")

    def uhd_profile(self, suffix="4K", **fields):
        return self.profile(
            edition_rules=[
                {
                    "id": "uhd",
                    "name": suffix,
                    "title_suffix": suffix,
                    "min_resolution": 2160,
                    "max_resolution": 0,
                    "required_audio_languages": [],
                    "required_subtitle_languages": [],
                    "required_video_features": [],
                }
            ],
            **fields,
        )

    def entry_ids(self):
        return {
            entry.edition: entry.public_id
            for entry in VODProfileEntry.objects.filter(
                profile__name="Custom", content_id=self.film.pk, primary=True
            )
        }

    def test_ids_stay_when_sources_are_added_removed_or_reordered(self):
        profile = self.uhd_profile(content_filters={"audio_languages": ["ger"]})
        self.build(profile)
        before = self.entry_ids()
        # A new provider with more languages leads both editions now.
        newcomer = M3UAccount.objects.create(
            name="New", account_type="XC", priority=50, is_active=True
        )
        M3UVODCategoryRelation.objects.create(
            m3u_account=newcomer, category=self.german, enabled=True
        )
        multi = self.source(newcomer, self.film, self.german, ["ger", "eng"], "1080p")
        hdr = self.source(newcomer, self.film, self.german, ["ger"], "2160p")
        hdr.declared_metadata["video_features"] = ["hdr"]
        hdr.save(update_fields=["declared_metadata"])
        self.build(profile)
        self.assertEqual(self.entry_ids(), before)
        entry = VODProfileEntry.objects.get(
            profile=profile, content_id=self.film.pk, edition=""
        )
        # The older German source still stands in for the new leader.
        self.assertEqual(entry.source_ids, [multi.pk, self.film_de.pk])
        uhd = VODProfileEntry.objects.get(
            profile=profile, content_id=self.film.pk, edition="4K"
        )
        self.assertEqual(uhd.source_ids, [hdr.pk, self.film_4k.pk])
        multi.delete()
        self.low.priority = 60
        self.low.save(update_fields=["priority"])
        self.build(profile)
        self.assertEqual(self.entry_ids(), before)

    def test_edition_ids_follow_the_edition_name(self):
        from apps.proxy.vod_proxy.views import _get_content_and_relation
        from apps.vod.models import VODContentAlias

        profile = self.uhd_profile()
        self.build(profile)
        uhd_id = self.entry_ids()["4K"]
        alias = VODContentAlias.objects.get(legacy_id=uhd_id)
        _content, relation, candidates = _get_content_and_relation(
            "movie", str(alias.legacy_uuid), user=self.user
        )
        # The edition never plays a source of another edition.
        self.assertEqual(candidates, [self.film_4k])
        # Another profile naming the same edition shares its ID.
        other = VODProfile.objects.create(
            name="Second", edition_rules=profile.edition_rules
        )
        VODProfileCategoryRule.objects.create(
            profile=other, scope="movie", regex_pattern=".*", action="enable", order=0
        )
        self.build(other)
        self.assertEqual(
            VODProfileEntry.objects.get(profile=other, edition="4K").public_id, uhd_id
        )
        profile.edition_rules[0]["title_suffix"] = "UHD"
        profile.save(update_fields=["edition_rules"])
        self.build(profile)
        self.assertNotIn(uhd_id, self.entry_ids().values())
        self.assertEqual(self.entry_ids()[""], self.film.pk)

    def test_a_category_of_another_version_plays_only_that_version(self):
        from apps.proxy.vod_proxy.views import _get_content_and_relation
        from apps.vod.models import VODContentAlias

        self.build(self.profile())
        german = xc_get_vod_streams(self.request, self.user, category_id=self.german.pk)
        english = xc_get_vod_streams(self.request, self.user, category_id=self.english.pk)
        self.assertEqual(english[0]["stream_id"], self.film.pk)
        version = german[0]["stream_id"]
        self.assertNotEqual(version, self.film.pk)
        alias = VODContentAlias.objects.get(legacy_id=version)
        _content, relation, candidates = _get_content_and_relation(
            "movie", str(alias.legacy_uuid), user=self.user
        )
        self.assertEqual(candidates, [self.film_de])

    def test_sources_entries_list_every_provider_source(self):
        from apps.proxy.vod_proxy.views import _get_content_and_relation
        from apps.vod.models import VODContentAlias

        # The same German 1080p copy from a second account stays separate.
        copy = self.source(self.high, self.film, self.german, ["ger"], "1080p")
        counts = self.build(
            self.profile(output_mode="variants", name_template=self.SOURCE_FORMAT)
        )
        self.assertEqual(
            counts["movie"], {"titles": 2, "entries": 5, "editions": {"": 2}}
        )
        rows = xc_get_vod_streams(self.request, self.user)
        self.assertEqual(
            sorted(row["name"] for row in rows),
            [
                "Film [ENG · 1080p]",
                "Film [GER · 1080p]",
                "Film [GER · 1080p]",
                "Film [GER · 2160p]",
                "Other [ENG · 720p]",
            ],
        )
        self.assertEqual(len({row["stream_id"] for row in rows}), 5)
        entries = dict(
            VODProfileEntry.objects.filter(profile__name="Custom").values_list(
                "relation_id", "source_ids"
            )
        )
        # Each entry plays only its own source, so there is no failover.
        self.assertEqual(entries[copy.pk], [copy.pk])
        self.assertEqual(entries[self.film_de.pk], [self.film_de.pk])
        for relation in (copy, self.film_de):
            entry = VODProfileEntry.objects.get(
                profile__name="Custom", relation_id=relation.pk
            )
            alias = VODContentAlias.objects.get(legacy_id=entry.public_id)
            _content, selected, candidates = _get_content_and_relation(
                "movie", str(alias.legacy_uuid), user=self.user
            )
            self.assertEqual((selected, candidates), (relation, [relation]))
            info = xc_get_vod_info(self.request, self.user, entry.public_id)
            self.assertEqual(info["movie_data"]["stream_id"], entry.public_id)

    def test_titles_without_tmdb_id_can_be_left_out_or_listed(self):
        Movie.objects.filter(pk=self.film.pk).update(tmdb_match_id="15916")
        Movie.objects.filter(pk=self.other.pk).update(tmdb_id="")
        profile = self.profile(content_filters={"missing_tmdb_mode": "exclude"})
        self.build(profile)
        self.assertEqual(list(self.streams()), ["Film"])
        profile.content_filters = {"missing_tmdb_mode": "only"}
        profile.save()
        self.build(profile)
        self.assertEqual(list(self.streams()), ["Other"])

    def test_enriched_metadata_sends_the_library_ids(self):
        Movie.objects.filter(pk=self.film.pk).update(
            tmdb_match_id="15916", tmdb_imdb_id="tt0208502", tmdb_id="", imdb_id=""
        )
        self.build(self.default)

        def film():
            rows = xc_get_vod_streams(self.request, self.user)
            return next(row for row in rows if row["name"].startswith("Film"))

        self.assertEqual((film()["tmdb_id"], film()["imdb_id"]), ("", ""))
        self.default.metadata_source = "enriched"
        self.default.save()
        self.assertEqual(
            (film()["tmdb_id"], film()["imdb_id"]), ("15916", "tt0208502")
        )
        info = xc_get_vod_info(self.request, self.user, film()["stream_id"])
        self.assertEqual(info["info"]["tmdb_id"], "15916")

    def test_sources_entries_ignore_editions(self):
        self.build(
            self.profile(
                output_mode="variants",
                name_template=self.SOURCE_FORMAT,
                edition_rules=[
                    {
                        "id": "uhd",
                        "name": "4K",
                        "title_suffix": "4K",
                        "min_resolution": 2160,
                        "max_resolution": 0,
                        "required_audio_languages": [],
                        "required_subtitle_languages": [],
                        "required_video_features": [],
                    }
                ],
            )
        )
        self.assertIn("Film [GER · 2160p]", self.streams())

    def test_grouped_output_offers_one_category_per_type(self):
        from apps.vod.profiles import GROUP_CATEGORY_IDS

        self.build(self.profile(output_groups="movie_series"))
        group = GROUP_CATEGORY_IDS["movie"]
        self.assertEqual(
            xc_get_vod_categories(self.user),
            [{"category_id": str(group), "category_name": "Movies", "parent_id": 0}],
        )
        rows = xc_get_vod_streams(self.request, self.user)
        self.assertEqual(len(rows), 2)
        self.assertEqual({row["category_id"] for row in rows}, {str(group)})
        self.assertEqual(
            xc_get_vod_streams(self.request, self.user, category_id=str(group)), rows
        )
        self.assertEqual(
            xc_get_vod_streams(self.request, self.user, category_id=self.german.pk),
            [],
        )
        info = xc_get_vod_info(self.request, self.user, rows[0]["stream_id"])
        self.assertEqual(info["movie_data"]["category_id"], str(group))

    def test_clean_titles_use_the_library_cleanup_only(self):
        Movie.objects.filter(pk=self.film.pk).update(
            clean_title="Clean Film",
            tmdb_metadata={"localized": {"en-US": {"title": "Translated"}}},
        )
        self.build(self.profile(title_source="clean"))
        self.assertIn("Clean Film", self.streams())

    def test_public_ids_are_shared_between_profiles(self):
        live = self.streams()
        self.build(self.profile())
        self.assertEqual(self.streams(), live)

    def test_rebuild_switches_generation_and_keeps_old_on_failure(self):
        self.build(self.default)
        first = self.default.catalog_generation
        self.build(self.default)
        self.assertNotEqual(self.default.catalog_generation, first)
        self.assertFalse(VODProfileEntry.objects.filter(generation=first).exists())
        current = self.default.catalog_generation
        with patch.object(
            profile_catalog, "_write", side_effect=RuntimeError("disk full")
        ):
            with self.assertRaises(RuntimeError):
                profile_catalog.build_catalog(self.default)
        self.default.refresh_from_db()
        self.assertEqual(self.default.catalog_status, VODProfile.CatalogStatus.FAILED)
        self.assertEqual(self.default.catalog_generation, current)
        self.assertEqual(self.default.catalog_error, "disk full")
        self.assertEqual(len(self.streams()), 2)

    def test_settings_saved_during_a_build_stay_pending(self):
        original = profile_catalog._build_content

        def change_settings(profile, generation, content_type):
            VODProfile.objects.filter(pk=profile.pk).update(ranking=["resolution_asc"])
            return original(profile, generation, content_type)

        with patch.object(profile_catalog, "_build_content", change_settings):
            self.build(self.default)
        self.assertEqual(self.default.catalog_status, VODProfile.CatalogStatus.PENDING)

    def test_playback_follows_profile_sources(self):
        from apps.proxy.vod_proxy.views import _get_content_and_relation
        from apps.vod.models import VODContentAlias

        self.build(
            self.profile(
                content_filters={"audio_languages": ["ger"]},
                ranking=["resolution_asc"],
            )
        )
        entry = VODProfileEntry.objects.get(profile__name="Custom")
        self.assertEqual(entry.public_id, self.film.pk)
        self.assertFalse(VODContentAlias.objects.exists())
        _content, relation, candidates = _get_content_and_relation(
            "movie", str(self.film.uuid), user=self.user
        )
        self.assertEqual(relation, self.film_de)
        self.assertEqual(candidates, [self.film_de, self.film_4k])
        # An ID clients kept from an earlier version still plays that version.
        old = output_reference(
            "movie", self.film.pk, {"audio_languages": ["ger"], "resolution": "1080p"}
        )
        _content, relation, candidates = _get_content_and_relation(
            "movie", str(old.legacy_uuid), user=self.user
        )
        self.assertEqual(candidates, [self.film_de])
        _content, relation, _candidates = _get_content_and_relation(
            "movie", str(self.other.uuid), user=self.user
        )
        self.assertIsNone(relation)
        _content, relation, _candidates = _get_content_and_relation(
            "movie", str(self.film.uuid)
        )
        self.assertEqual(relation, self.film_en)

    @patch("apps.vod.profile_catalog.request_catalog_build")
    def test_saving_relevant_settings_queues_a_build(self, request_build):
        admin = User.objects.create_user(
            username="catalog-admin", password="test", user_level=10
        )
        client = APIClient()
        client.force_authenticate(admin)
        url = reverse("api:vod:profile-detail", args=[self.default.pk])
        self.build(self.default)
        response = client.patch(url, {"name_template": "{title}"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["catalog_status"], "ready")
        request_build.assert_not_called()
        response = client.patch(url, {"ranking": ["resolution_desc"]}, format="json")
        self.assertEqual(response.data["catalog_status"], "pending")
        request_build.assert_called_once_with([self.default.pk], countdown=5)

    def test_title_and_metadata_sources(self):
        from apps.vod import library

        settings = {**library.library_settings(), "languages": ["en-US", "de-DE"]}
        patcher = patch("apps.vod.library.library_settings", return_value=settings)
        patcher.start()
        self.addCleanup(patcher.stop)
        Movie.objects.filter(pk=self.film.pk).update(
            description="Provider plot",
            genre="Provider genre",
            tmdb_metadata={
                "genres": [{"name": "Drama"}, {"name": "Fantasy"}],
                "rating": 7.5,
                "release_date": "2010-09-27",
                "director": "Colin Levy",
                "localized": {
                    "en-US": {"title": "The Film", "overview": "English plot"},
                    "de-DE": {"title": "Der Film", "overview": "Deutscher Text"},
                },
            },
        )
        self.build(self.default)

        def film(rows):
            return next(row for row in rows if "Film" in row["name"])

        # Provider titles and metadata, as clients get them today.
        row = film(xc_get_vod_streams(self.request, self.user))
        self.assertEqual(row["name"], "Film")
        self.assertEqual(
            (row["plot"], row["genre"]), ("Provider plot", "Provider genre")
        )
        # The title source changes only the title.
        self.default.title_source = "de-DE"
        self.default.save()
        row = film(xc_get_vod_streams(self.request, self.user))
        self.assertEqual(row["name"], "Der Film")
        self.assertEqual(row["plot"], "Provider plot")
        # Library metadata follows the title language.
        self.default.metadata_source = "enriched"
        self.default.save()
        row = film(xc_get_vod_streams(self.request, self.user))
        self.assertEqual(
            (row["plot"], row["genre"], row["rating"], row["year"]),
            ("Deutscher Text", "Drama, Fantasy", "7.5", 2010),
        )
        info = xc_get_vod_info(self.request, self.user, row["stream_id"])["info"]
        self.assertEqual(
            (info["plot"], info["genre"], info["director"], info["release_date"]),
            ("Deutscher Text", "Drama, Fantasy", "Colin Levy", "2010-09-27"),
        )
        # Provider titles with Library metadata use the first Library language.
        self.default.title_source = "provider"
        self.default.save()
        row = film(xc_get_vod_streams(self.request, self.user))
        self.assertEqual(
            (row["name"], row["plot"]), ("Film", "English plot")
        )

@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
@override_settings(
    CACHES={"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
)
class SeriesEpisodeIdTests(TestCase):
    def setUp(self):
        from django.utils import timezone

        from apps.vod.models import Episode, M3UEpisodeRelation, M3USeriesRelation, Series

        self.request = RequestFactory().get("/player_api.php")
        self.user = User.objects.create_user(
            username="series-user", password="test", user_level=1
        )
        high = M3UAccount.objects.create(
            name="High", account_type="XC", priority=10, is_active=True
        )
        low = M3UAccount.objects.create(
            name="Low", account_type="XC", priority=1, is_active=True
        )
        category = VODCategory.objects.create(name="Shows", category_type="series")
        self.series = Series.objects.create(name="Show", year=2020)
        self.sources = {}
        for account, external, metadata in (
            (high, "1", {"audio_languages": ["eng"], "resolution": "1080p"}),
            (low, "2", {"audio_languages": ["ger"], "resolution": "2160p"}),
        ):
            M3UVODCategoryRelation.objects.create(
                m3u_account=account, category=category, enabled=True
            )
            self.sources[external] = M3USeriesRelation.objects.create(
                m3u_account=account,
                series=self.series,
                category=category,
                external_series_id=external,
                declared_metadata=metadata,
                last_episode_refresh=timezone.now(),
                custom_properties={"episodes_fetched": True, "detailed_fetched": True},
            )
        self.first = Episode.objects.create(
            series=self.series, name="E1", season_number=1, episode_number=1
        )
        self.second = Episode.objects.create(
            series=self.series, name="E2", season_number=1, episode_number=2
        )
        for external, episodes in (("1", [self.first]), ("2", [self.first, self.second])):
            source = self.sources[external]
            for episode in episodes:
                M3UEpisodeRelation.objects.create(
                    m3u_account=source.m3u_account,
                    episode=episode,
                    series_relation=source,
                    stream_id=f"{external}-{episode.pk}",
                    declared_metadata=source.declared_metadata,
                )

    def profile(self, **fields):
        profile = VODProfile.objects.create(name="Shows", **fields)
        VODProfileAssignment.objects.create(user=self.user, profile=profile)
        VODProfileCategoryRule.objects.create(
            profile=profile, scope="series", regex_pattern=".*", action="enable", order=0
        )
        profile_catalog.build_catalog(profile)
        return profile

    def episode_ids(self, series_id):
        info = xc_get_series_info(self.request, self.user, str(series_id))
        return {
            episode["episode_num"]: episode["id"]
            for episodes in info["episodes"].values()
            for episode in episodes
        }

    def test_edition_episodes_keep_their_edition(self):
        self.profile(
            edition_rules=[
                {
                    "id": "uhd",
                    "name": "4K",
                    "title_suffix": "4K",
                    "min_resolution": 2160,
                    "max_resolution": 0,
                    "required_audio_languages": [],
                    "required_subtitle_languages": [],
                    "required_video_features": [],
                }
            ]
        )
        listed = {
            row["name"]: row["series_id"]
            for row in xc_get_series(self.request, self.user)
        }
        self.assertEqual(listed["Show"], self.series.pk)
        uhd = listed["Show 4K"]
        info = xc_get_series_info(self.request, self.user, str(uhd))
        self.assertEqual(info["info"]["name"], "Show 4K")
        self.assertEqual(self.episode_ids(self.series.pk), {1: self.first.pk})
        uhd_episodes = self.episode_ids(uhd)
        self.assertEqual(set(uhd_episodes), {1, 2})
        self.assertNotIn(self.first.pk, uhd_episodes.values())
        order = profile_catalog.profile_source_order
        self.assertEqual(
            order(self.user, "episode", self.first, uhd_episodes[1]),
            [self.sources["2"].pk],
        )
        self.assertEqual(
            order(self.user, "episode", self.first, self.first.pk),
            [self.sources["1"].pk],
        )

    def test_sources_entry_episodes_play_only_their_source(self):
        self.profile(
            output_mode=VODProfile.OutputMode.VARIANTS,
            name_template="{title} [{dub} · {resolution}]",
        )
        listed = {
            row["name"]: row["series_id"]
            for row in xc_get_series(self.request, self.user)
        }
        low = listed["Show [GER · 2160p]"]
        episodes = self.episode_ids(low)
        self.assertEqual(set(episodes), {1, 2})
        self.assertEqual(
            profile_catalog.profile_source_order(
                self.user, "episode", self.first, episodes[1]
            ),
            [self.sources["2"].pk],
        )


class CatalogRebuildTriggerTests(TestCase):
    def test_account_changes_that_change_output_rebuild_catalogues(self):
        account = M3UAccount.objects.create(name="Trigger", account_type="XC")
        with patch("apps.vod.profile_catalog.request_catalog_build") as build:
            # Refresh status updates change nothing a client sees.
            account.status = M3UAccount.Status.ERROR
            account.save(update_fields=["status"])
            build.assert_not_called()
            account.priority = 5
            account.save()
            account.is_active = False
            account.save(update_fields=["is_active"])
            self.assertEqual(build.call_count, 2)
            account.delete()
            self.assertEqual(build.call_count, 3)


class ProfileEditorApiTests(TestCase):
    setUp = ProfileCatalogTests.setUp
    source = ProfileCatalogTests.source

    def admin_client(self):
        admin, _ = User.objects.get_or_create(
            username="editor-admin", defaults={"user_level": 10}
        )
        client = APIClient()
        client.force_authenticate(admin)
        return client

    def test_options_list_users_accounts_and_categories(self):
        response = self.admin_client().get(reverse("api:vod:profile-options"))
        self.assertEqual(response.status_code, 200, response.data)
        self.assertIn(
            {"id": self.user.pk, "name": "catalog-user"}, response.data["users"]
        )
        self.assertEqual(
            [row["name"] for row in response.data["accounts"]], ["High", "Low"]
        )
        self.assertEqual(len(response.data["categories"]), 4)
        self.assertEqual(
            set(response.data["categories"][0]),
            {
                "id",
                "name",
                "category",
                "category_type",
                "account",
                "enabled",
                "custom_properties",
            },
        )
        self.assertIn("metadata_languages", response.data)
        # The value lists read every source, so they come on their own.
        self.assertNotIn("resolutions", response.data)

    def test_options_offer_the_values_sources_have_and_profiles_use(self):
        def values():
            cache.clear()
            response = self.admin_client().get(reverse("api:vod:profile-values"))
            self.assertEqual(response.status_code, 200, response.data)
            return response.data

        data = values()
        self.assertEqual(
            [item["value"] for item in data["languages"]], ["eng", "ger"]
        )
        self.assertEqual(data["resolutions"], ["2160p", "1080p", "720p"])
        self.assertEqual(data["video_features"], [])
        # A saved choice stays offered although no source has it.
        self.default.content_filters = {"excluded_features": ["dv"]}
        self.default.audio_language_order = ["fre"]
        self.default.save()
        data = values()
        self.assertEqual(data["video_features"], ["dv"])
        self.assertIn("fre", [item["value"] for item in data["languages"]])

    def saved(self, fields):
        response = self.admin_client().post(
            reverse("api:vod:profile-list"),
            {"name": f"Preview {VODProfile.objects.count()}", **fields},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        profile = VODProfile.objects.get(pk=response.data["id"])
        # Like the default profile, every category is enabled.
        VODProfileCategoryRule.objects.create(
            profile=profile, scope="movie", regex_pattern=".*", action="enable"
        )
        return profile

    def preview(self, fields, **query):
        """The preview of a profile saved and built with these settings."""
        profile = self.saved(fields)
        profile_catalog.build_catalog(profile)
        return self.admin_client().get(
            reverse("api:vod:profile-preview", args=[profile.pk]),
            {"content_type": "movie", **query},
        )

    def test_preview_lists_the_titles_of_the_built_catalogue(self):
        unbuilt = self.saved({})
        response = self.admin_client().get(
            reverse("api:vod:profile-preview", args=[unbuilt.pk]),
            {"content_type": "movie"},
        )
        self.assertEqual(response.status_code, 400)
        response = self.preview(
            {
                "name_template": "{title} ({year})",
                "content_filters": {"audio_languages": ["ger"]},
                "ranking": ["resolution_desc"],
            }
        )
        self.assertEqual(response.status_code, 200, response.data)
        # "Other" has no German source, so it is not part of the preview.
        self.assertEqual(response.data["count"], 1)
        (film,) = response.data["results"]
        self.assertEqual(film["entries"][0]["name"], "Film (2020)")
        self.assertEqual(film["entries"][0]["metadata"]["resolution"], "2160p")
        self.assertEqual(film["entries"][0]["provider"], "Low")
        self.assertEqual(film["entries"][0]["category"], "DE | Movies")

    def test_preview_explains_each_source(self):
        response = self.preview(
            {
                "content_filters": {"audio_languages": ["ger"]},
                "ranking": ["resolution_asc"],
            },
            search="film",
        )
        sources = {
            row["id"]: (row["state"], row["reason"])
            for row in response.data["results"][0]["sources"]
        }
        self.assertEqual(
            sources,
            {
                self.film_de.pk: ("selected", ""),
                # Another version, but still offered by the profile.
                self.film_4k.pk: ("fallback", ""),
                self.film_en.pk: ("skipped", "Does not match the content filters."),
            },
        )

    def test_preview_pages_offered_titles_and_lists_excluded_ones(self):
        response = self.preview({}, page_size=1, page=2)
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(
            [row["title"] for row in response.data["results"]], ["Other"]
        )
        response = self.preview({}, account=self.low.pk)
        self.assertEqual([row["title"] for row in response.data["results"]], ["Film"])
        # The filter narrows the titles; the entry still uses the best source.
        self.assertEqual(
            response.data["results"][0]["entries"][0]["source_id"], self.film_en.pk
        )
        response = self.preview({}, category=self.english.pk)
        self.assertEqual(response.data["count"], 2)
        # The account filter offers the accounts the profile takes from.
        self.assertEqual(
            [account["label"] for account in response.data["accounts"]],
            ["High", "Low"],
        )
        # The filter offers the categories the profile enables, unsaved.
        self.assertEqual(
            response.data["categories"],
            [
                {"value": self.german.pk, "label": "DE | Movies"},
                {"value": self.english.pk, "label": "EN | Movies"},
            ],
        )
        relation = M3UVODCategoryRelation.objects.get(
            m3u_account=self.high, category=self.english
        )
        choices = {"category_choices": [{"relation": relation.pk, "enabled": False}]}
        response = self.preview(choices, account=self.high.pk)
        self.assertEqual(
            [category["label"] for category in response.data["categories"]],
            ["DE | Movies"],
        )
        response = self.preview({"output_groups": "movie_series"})
        self.assertEqual(
            response.data["categories"], [{"value": 2_000_000_000, "label": "Movies"}]
        )
        response = self.preview(
            {"output_groups": "movie_series"}, category=2_000_000_000
        )
        self.assertEqual(response.data["count"], 2)
        excluded = {"excluded_titles": [{"content_type": "movie", "id": self.film.pk}]}
        response = self.preview(excluded)
        self.assertEqual([row["title"] for row in response.data["results"]], ["Other"])
        response = self.preview(excluded, excluded=True)
        self.assertEqual(response.data["count"], 1)
        self.assertTrue(response.data["results"][0]["excluded"])
        self.assertEqual(
            response.data["results"][0]["reason"], "Excluded from this profile."
        )

    def test_preview_lists_the_titles_of_one_edition(self):
        profile = {"edition_rules": [{"title_suffix": "4K", "min_resolution": 2160}]}
        response = self.preview(profile, edition="4K")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["title"] for row in response.data["results"]], ["Film"])
        # "" lists the titles with an entry without edition.
        response = self.preview(profile, edition="")
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(self.preview(profile, edition="UHD").data["count"], 0)
        # Every preview counts the offered titles per edition, like the build.
        self.assertEqual(response.data["editions"], {"4K": 1, "": 2})
        built = VODProfile.objects.order_by("-pk").first()
        self.assertEqual(built.catalog_counts["movie"]["editions"], {"4K": 1, "": 2})

    def test_edition_counts_follow_unsaved_settings(self):
        response = self.admin_client().post(
            reverse("api:vod:profile-edition-counts"),
            {
                "profile": {
                    "edition_rules": [{"title_suffix": "4K", "min_resolution": 2160}]
                },
                "profile_id": self.default.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data, {"movie": {"4K": 1, "": 2}, "series": {}})
        self.assertFalse(VODProfileEntry.objects.exists())

    def test_preview_leaves_out_titles_the_filters_drop(self):
        disabled = M3UVODCategoryRelation.objects.get(
            m3u_account=self.high, category=self.english
        )
        profile = {"category_choices": [{"relation": disabled.pk, "enabled": False}]}
        self.assertEqual(self.preview(profile, search="oth").data["count"], 0)
        film = self.preview(profile, search="film").data["results"][0]
        reasons = {source["id"]: source["reason"] for source in film["sources"]}
        self.assertEqual(reasons[self.film_en.pk], "Category disabled in this profile.")
        Movie.objects.filter(pk=self.other.pk).update(genre="Horror")
        response = self.preview(
            {"content_filters": {"excluded_genres": ["horror"]}}, search="Other"
        )
        self.assertEqual(response.data["count"], 0)

    @patch("apps.vod.profile_catalog.request_catalog_build")
    def test_rebuild_queues_an_immediate_build(self, request_build):
        response = self.admin_client().post(
            reverse("api:vod:profile-rebuild", args=[self.default.pk])
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["catalog_status"], "pending")
        request_build.assert_called_once_with([self.default.pk], countdown=0)
