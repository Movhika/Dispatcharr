from unittest import mock

from django.db import IntegrityError, transaction
from django.test import SimpleTestCase, TestCase
from django.urls import reverse
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.m3u.models import M3UAccount
from apps.vod import profiles
from apps.vod.models import (
    M3UVODCategoryRelation,
    Movie,
    VODCategory,
    VODProfile,
    VODProfileAssignment,
    VODProfileCategoryRule,
)


class ProfileSchemaTests(SimpleTestCase):
    def test_profile_openapi_schema_validates_in_isolation(self):
        from django.urls import include, path
        from drf_spectacular.generators import SchemaGenerator
        from drf_spectacular.validation import validate_schema
        from rest_framework.routers import SimpleRouter

        from apps.vod.profile_api import (
            VODProfileCategoryRuleViewSet,
            VODProfileViewSet,
        )

        router = SimpleRouter()
        router.register(
            r"profiles/(?P<profile_id>\d+)/category-rules",
            VODProfileCategoryRuleViewSet,
            basename="profile-category-rule",
        )
        router.register("profiles", VODProfileViewSet, basename="profile")
        schema = SchemaGenerator(
            patterns=[path("api/vod/", include(router.urls))]
        ).get_schema(public=True)
        validate_schema(schema)
        self.assertIn("/api/vod/profiles/", schema["paths"])
        self.assertIn("/api/vod/profiles/{id}/", schema["paths"])
        rules = "/api/vod/profiles/{profile_id}/category-rules/"
        for suffix in ("", "{id}/", "preview-draft/", "save-apply/", "reorder/"):
            self.assertIn(rules + suffix, schema["paths"])


class ProfileRuleTests(SimpleTestCase):
    def test_filter_and_edition_errors_name_their_field(self):
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_content_filters(
                {"resolution_min": 2160, "resolution_max": 1080}
            )
        self.assertEqual(caught.exception.field, "resolution_max")
        self.assertIsNone(caught.exception.index)
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_edition_rules(
                [
                    {"title_suffix": "4K", "min_resolution": 2160},
                    {"title_suffix": "HDR"},
                ]
            )
        self.assertEqual(
            (caught.exception.index, caught.exception.field), (1, "conditions")
        )

    def test_category_choices_keep_the_last_choice_per_category(self):
        self.assertEqual(
            profiles.normalize_category_choices(
                [
                    {"relation": 9, "enabled": True},
                    {"relation": 2, "enabled": True},
                    {"relation": 9, "enabled": False},
                ]
            ),
            [{"relation": 2, "enabled": True}, {"relation": 9, "enabled": False}],
        )
        for choices in (
            {"relation": 1},
            [{"relation": "1", "enabled": True}],
            [{"relation": True, "enabled": True}],
            [{"relation": 1, "enabled": "yes"}],
        ):
            with self.assertRaises(ValueError):
                profiles.normalize_category_choices(choices)

    def test_excluded_titles_are_unique_movies_and_series(self):
        self.assertEqual(
            profiles.normalize_excluded_titles(
                [
                    {"content_type": "series", "id": 3, "title": "Show"},
                    {"content_type": "movie", "id": 7},
                    {"content_type": "series", "id": 3},
                ]
            ),
            [{"content_type": "movie", "id": 7}, {"content_type": "series", "id": 3}],
        )
        for titles in (
            {"content_type": "movie", "id": 1},
            [{"content_type": "episode", "id": 1}],
            [{"content_type": "movie", "id": "1"}],
            [{"content_type": "movie", "id": 0}],
        ):
            with self.assertRaises(ValueError):
                profiles.normalize_excluded_titles(titles)

    def test_content_filters_normalize_and_drop_empty_values(self):
        self.assertEqual(
            profiles.normalize_content_filters(
                {
                    "audio_languages": ["de", "ger"],
                    "resolution_min": "720",
                    "excluded_features": ["3D"],
                    "excluded_genres": [" Horror ", "", "Horror"],
                    "anime_mode": "exclude",
                    "adult_mode": "",
                }
            ),
            {
                "audio_languages": ["ger"],
                "resolution_min": 720,
                "excluded_features": ["3d"],
                "excluded_genres": ["Horror"],
                "anime_mode": "exclude",
            },
        )
        for filters in (
            {"unknown": True},
            {"resolution_min": 2160, "resolution_max": 1080},
            {"required_features": ["hdr"], "excluded_features": ["hdr"]},
            {"anime_mode": "hide"},
        ):
            with self.assertRaises(ValueError):
                profiles.normalize_content_filters(filters)

    def test_edition_rules_need_a_condition_and_unique_suffix(self):
        rules = profiles.normalize_edition_rules(
            [{"name": "4K", "min_resolution": 2160}]
        )
        self.assertEqual(rules[0]["title_suffix"], "4K")
        self.assertEqual(rules[0]["min_resolution"], 2160)
        with self.assertRaises(ValueError):
            profiles.normalize_edition_rules([{"name": "Any"}])
        with self.assertRaises(ValueError):
            profiles.normalize_edition_rules(
                [
                    {"name": "4K", "min_resolution": 2160},
                    {"title_suffix": "4k", "required_video_features": ["hdr"]},
                ]
            )

    def test_editions_may_not_share_a_source(self):
        uhd = {"title_suffix": "4K", "min_resolution": 2160}
        hdr = {
            "title_suffix": "4K HDR",
            "min_resolution": 2160,
            "required_video_features": ["hdr"],
        }
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_edition_rules([uhd, hdr])
        self.assertEqual(
            (caught.exception.index, caught.exception.field), (1, "conditions")
        )
        self.assertEqual(
            str(caught.exception),
            "4K and 4K HDR overlap: 2160p HDR sources fit both. "
            "Exclude HDR from 4K.",
        )
        rules = profiles.normalize_edition_rules(
            [{**uhd, "excluded_video_features": ["hdr"]}, hdr]
        )
        self.assertEqual(rules[0]["excluded_video_features"], ["hdr"])
        self.assertEqual(rules[1]["excluded_audio_languages"], [])
        # Resolutions that do not meet never share a source.
        profiles.normalize_edition_rules(
            [uhd, {"title_suffix": "HD", "max_resolution": 1080}]
        )
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_edition_rules(
                [
                    {"title_suffix": "German", "required_audio_languages": ["ger"]},
                    {"title_suffix": "English", "required_audio_languages": ["eng"]},
                ]
            )
        self.assertEqual(
            str(caught.exception),
            "German and English overlap: ENG/GER sources fit both. "
            "Exclude ENG from German.",
        )
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_edition_rules([uhd, {**uhd, "title_suffix": "UHD"}])
        self.assertEqual(str(caught.exception), "4K and UHD have the same conditions.")
        with self.assertRaises(profiles.FieldError) as caught:
            profiles.normalize_edition_rules(
                [{**hdr, "excluded_video_features": ["hdr"]}]
            )
        self.assertEqual(caught.exception.field, "excluded_video_features")

    def test_ranking_order_and_name_template(self):
        self.assertEqual(
            profiles.normalize_ranking(["provider", "resolution_desc", "provider"]),
            ["provider", "resolution_desc"],
        )
        for ranking in (["popularity"], ["resolution_desc", "resolution_asc"]):
            with self.assertRaises(ValueError):
                profiles.normalize_ranking(ranking)
        self.assertEqual(profiles.normalize_provider_order(["2", 1, 2]), [2, 1])
        with self.assertRaises(ValueError):
            profiles.normalize_provider_order([0])
        self.assertEqual(
            profiles.normalize_name_template(" {title} ({year}) [{dub}] "),
            "{title} ({year}) [{dub}]",
        )
        for template in (
            "{year}",
            "{title} {quality}",
            "{title} {tags}",
            "{title} {}",
            "{title",
        ):
            with self.assertRaises(ValueError):
                profiles.normalize_name_template(template)

    def test_name_labels_normalize_their_values(self):
        self.assertEqual(
            profiles.normalize_name_labels(
                [
                    {"field": "resolution", "values": ["1080P"], "label": " FHD "},
                    {"field": "resolution", "values": ["other"], "label": ""},
                    {"field": "dub", "values": ["en", "de"], "label": "DUAL"},
                    {"field": "sub", "values": ["several"], "label": "MULTI-SUB"},
                    {"field": "features", "value": "HDR", "label": ""},
                ]
            ),
            [
                {"field": "resolution", "values": ["1080p"], "label": "FHD"},
                {"field": "resolution", "values": ["other"], "label": ""},
                {"field": "dub", "values": ["eng", "ger"], "label": "DUAL"},
                {"field": "sub", "values": ["several"], "label": "MULTI-SUB"},
                {"field": "features", "values": ["hdr"], "label": ""},
            ],
        )
        for labels in (
            [{"field": "title", "values": ["x"], "label": "y"}],
            [{"field": "resolution", "values": ["1234p"], "label": "y"}],
            [{"field": "resolution", "values": ["1080p", "720p"], "label": "y"}],
            [{"field": "features", "values": ["several"], "label": "y"}],
            [{"field": "dub", "values": ["several", "eng"], "label": "y"}],
            [{"field": "dub", "values": [], "label": "y"}],
            [
                {"field": "dub", "values": ["en", "de"], "label": "DUAL"},
                {"field": "dub", "values": ["ger", "eng"], "label": "BOTH"},
            ],
        ):
            with self.assertRaises(ValueError):
                profiles.normalize_name_labels(labels)

class ProfileTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = User.objects.create_user(
            username="profile-admin", password="test", user_level=10
        )
        self.user = User.objects.create_user(
            username="profile-user", password="test", user_level=1
        )
        self.client.force_authenticate(self.admin)
        account = M3UAccount.objects.create(
            name="Provider", account_type="XC", is_active=True
        )
        self.category = M3UVODCategoryRelation.objects.create(
            m3u_account=account,
            category=VODCategory.objects.create(name="Movies", category_type="movie"),
            enabled=True,
        )
        self.default = VODProfile.objects.get(is_default=True)

    def endpoint(self, pk=None):
        if pk is None:
            return reverse("api:vod:profile-list")
        return reverse("api:vod:profile-detail", args=[pk])

    def create(self, **data):
        response = self.client.post(
            self.endpoint(), {"name": "Kids", **data}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        return VODProfile.objects.get(pk=response.data["id"])

    def test_migration_creates_default_that_keeps_current_output(self):
        self.assertEqual(self.default.name, "Default")
        self.assertTrue(self.default.is_active)
        self.assertEqual(self.default.output_mode, VODProfile.OutputMode.COMPACT)
        self.assertEqual(self.default.category_choices, [])
        self.assertEqual(
            list(
                self.default.category_rules.values_list(
                    "scope", "regex_pattern", "action", "enabled"
                )
            ),
            [("movie", ".*", "enable", True), ("series", ".*", "enable", True)],
        )
        self.assertEqual(self.default.ranking, ["provider"])
        # Provider titles, as clients got them before profiles.
        self.assertEqual(self.default.title_source, "provider")
        self.assertEqual(self.default.metadata_source, "provider")
        self.assertEqual(self.default.name_template, "{title}")
        self.assertEqual(profiles.profile_for_user(self.user), self.default)

    def test_database_allows_one_active_default(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            VODProfile.objects.create(name="Second", is_default=True)
        with self.assertRaises(IntegrityError), transaction.atomic():
            VODProfile.objects.filter(pk=self.default.pk).update(is_active=False)

    def test_lost_default_is_recreated_without_name_clash(self):
        self.default.is_default = False
        self.default.save()
        profile = profiles.default_profile()
        self.assertTrue(profile.is_default)
        self.assertEqual(profile.name, "Default 2")
        self.assertEqual(profile.category_rules.count(), 2)

    def test_compact_names_only_show_what_every_source_shares(self):
        response = self.client.patch(
            self.endpoint(self.default.pk),
            {"name_template": "{title} [{dub}]"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name_template", response.data)
        self.create(name="Years", name_template="{title} ({year}) {edition}")
        sources = self.create(output_mode="variants", name_template="{title} [{dub}]")
        response = self.client.patch(
            self.endpoint(sources.pk), {"output_mode": "compact"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name_template", response.data)

    def user_endpoint(self, user):
        return reverse("api:accounts:user-detail", args=[user.pk])

    def assign(self, user, profile):
        return self.client.patch(
            self.user_endpoint(user),
            {"vod_profile": getattr(profile, "pk", profile)},
            format="json",
        )

    def test_assigned_active_profile_applies_otherwise_default(self):
        profile = self.create()
        self.assertEqual(self.assign(self.user, profile).status_code, 200)
        self.assertEqual(profiles.profile_for_user(self.user), profile)
        profile.is_active = False
        profile.save()
        self.assertEqual(profiles.profile_for_user(self.user), self.default)
        profile.delete()
        self.assertFalse(VODProfileAssignment.objects.exists())
        self.assertEqual(profiles.profile_for_user(self.user), self.default)

    def test_users_get_their_profile_in_the_user_settings(self):
        first = self.create()
        second = self.create(name="Adults")
        response = self.client.get(self.user_endpoint(self.user))
        self.assertIsNone(response.data["vod_profile"])
        self.assertEqual(self.assign(self.user, first).data["vod_profile"], first.pk)
        self.assertEqual(self.assign(self.user, second).status_code, 200)
        self.assertEqual(self.assign(self.admin, second).status_code, 200)
        self.assertFalse(first.assignments.exists())
        response = self.client.get(self.endpoint(second.pk))
        self.assertEqual(response.data["users"], sorted([self.user.pk, self.admin.pk]))
        response = self.client.patch(
            self.endpoint(second.pk), {"users": []}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["users"]), 2)
        self.assertIsNone(self.assign(self.user, None).data["vod_profile"])
        self.assertEqual(profiles.profile_for_user(self.user), self.default)

    def test_inactive_profiles_cannot_be_newly_assigned(self):
        profile = self.create()
        self.assign(self.user, profile)
        profile.is_active = False
        profile.save()
        response = self.client.patch(
            self.user_endpoint(self.user),
            {"vod_profile": profile.pk, "first_name": "Kid"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.assign(self.admin, profile)
        self.assertEqual(response.status_code, 400)
        self.assertIn("vod_profile", response.data)
        response = self.client.post(
            reverse("api:accounts:user-list"),
            {"username": "new-kid", "password": "test", "vod_profile": profile.pk},
            format="json",
        )
        self.assertIn("vod_profile", response.data)

    def test_list_returns_default_first_with_rules(self):
        self.create(edition_rules=[{"name": "4K", "min_resolution": 2160}])
        response = self.client.get(self.endpoint())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row["name"] for row in response.data], ["Default", "Kids"])
        self.assertEqual(response.data[1]["edition_rules"][0]["title_suffix"], "4K")
        self.assertEqual(
            response.data[0]["category_rule_counts"], {"movie": 1, "series": 1}
        )
        self.assertEqual(
            response.data[0]["category_rule_states"], {str(self.category.pk): True}
        )
        self.assertEqual(
            response.data[1]["category_rule_states"], {str(self.category.pk): False}
        )
        self.assertEqual(response.data[0]["catalog_status"], "pending")

    def test_making_another_profile_default(self):
        response = self.client.post(
            self.endpoint(),
            {"name": "Kids", "is_default": True, "is_active": False},
            format="json",
        )
        self.assertIn("is_active", response.data)
        profile = self.create(is_default=True)
        self.default.refresh_from_db()
        self.assertTrue(profile.is_default)
        self.assertTrue(profile.is_active)
        self.assertFalse(self.default.is_default)
        response = self.client.patch(
            self.endpoint(profile.pk), {"is_default": False}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("is_default", response.data)
        response = self.client.patch(
            self.endpoint(profile.pk), {"is_active": False}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("is_active", response.data)

    def test_default_cannot_be_deleted(self):
        response = self.client.delete(self.endpoint(self.default.pk))
        self.assertEqual(response.status_code, 400)
        self.assertTrue(VODProfile.objects.filter(pk=self.default.pk).exists())
        profile = self.create()
        self.assertEqual(self.client.delete(self.endpoint(profile.pk)).status_code, 204)

    def test_validation_errors_are_reported_per_field(self):
        response = self.client.post(
            self.endpoint(),
            {
                "name": "default",
                "name_template": "{year}",
                "ranking": ["popularity"],
                "category_choices": [{"relation": 999999, "enabled": True}],
                "title_source": "xx-XX",
                "content_filters": {"resolution_min": 2160, "resolution_max": 720},
                "edition_rules": [
                    {"title_suffix": "4K", "min_resolution": 2160},
                    {"title_suffix": "4k", "required_video_features": ["hdr"]},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            set(response.data),
            {
                "name",
                "name_template",
                "ranking",
                "title_source",
                "content_filters",
                "edition_rules",
            },
        )
        self.assertIn("resolution_max", response.data["content_filters"])
        self.assertIn("title_suffix", response.data["edition_rules"]["1"])

    def test_category_choices_are_stored_per_account_category(self):
        profile = self.create(
            category_choices=[{"relation": self.category.pk, "enabled": False}],
        )
        self.assertEqual(
            profile.category_choices,
            [{"relation": self.category.pk, "enabled": False}],
        )
        response = self.client.patch(
            self.endpoint(profile.pk), {"name": "Children"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["category_choices"]), 1)

    def test_removed_categories_and_titles_never_block_a_save(self):
        from apps.vod.identity import remember_alias

        film = Movie.objects.create(name="Film", year=2020)
        merged = Movie.objects.create(name="Film duplicate", year=2020)
        profile = self.create(
            category_choices=[{"relation": self.category.pk, "enabled": False}],
            excluded_titles=[
                {"content_type": "movie", "id": film.pk},
                {"content_type": "movie", "id": merged.pk},
            ],
        )
        # A provider refresh removes the category; a merge retires a title.
        remember_alias(merged, film, "movie")
        merged.delete()
        self.category.delete()
        response = self.client.patch(
            self.endpoint(profile.pk),
            {
                "category_choices": profile.category_choices,
                "excluded_titles": [
                    *profile.excluded_titles,
                    {"content_type": "series", "id": 999999},
                ],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["category_choices"], [])
        self.assertEqual(
            response.data["excluded_titles"], [{"content_type": "movie", "id": film.pk}]
        )

    def test_profiles_are_admin_only(self):
        self.client.force_authenticate(self.user)
        self.assertEqual(self.client.get(self.endpoint()).status_code, 403)

    def test_title_source_is_provider_clean_or_a_library_language(self):
        from apps.vod import library

        settings = {**library.library_settings(), "languages": ["en-US", "de-DE"]}
        with mock.patch("apps.vod.library.library_settings", return_value=settings):
            profile = self.create(title_source="de-DE")
            self.assertEqual(profiles.profile_languages(profile), ["de-DE", "en-US"])
            profile.title_source = "provider"
            self.assertEqual(profiles.profile_languages(profile), ["en-US", "de-DE"])
            profile.title_source = profiles.CLEAN_TITLES
            self.assertEqual(profiles.profile_languages(profile), [])
            response = self.client.patch(
                self.endpoint(profile.pk), {"title_source": "clean"}, format="json"
            )
            self.assertEqual(response.status_code, 200, response.data)
            response = self.client.patch(
                self.endpoint(profile.pk),
                {"title_source": "fr-FR"},
                format="json",
            )
        self.assertEqual(response.status_code, 400)
        self.assertIn("title_source", response.data)


class ProfileImportRuleTests(TestCase):
    """Profile import rules answer like the M3U import rule endpoints."""

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(
            User.objects.create_user(
                username="rules-admin", password="test", user_level=10
            )
        )
        account = M3UAccount.objects.create(
            name="Provider", account_type="XC", is_active=True
        )

        def category(name, enabled=True):
            return M3UVODCategoryRelation.objects.create(
                m3u_account=account,
                category=VODCategory.objects.create(name=name, category_type="movie"),
                enabled=enabled,
            )

        self.kids = category("Kids")
        self.german = category("DE Action")
        self.english = category("EN Action")
        self.hidden = category("Hidden", enabled=False)
        self.profile = VODProfile.objects.create(
            name="Kids",
            category_choices=[{"relation": self.german.pk, "enabled": True}],
        )

    def url(self, suffix=""):
        return f"/api/vod/profiles/{self.profile.pk}/category-rules/{suffix}"

    def rule(self, pattern, action="enable", **values):
        response = self.client.post(
            self.url(),
            {"scope": "movie", "regex_pattern": pattern, "action": action, **values},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def states(self):
        response = self.client.get(f"/api/vod/profiles/{self.profile.pk}/")
        return response.data["category_rule_states"]

    def test_rules_are_saved_one_by_one_and_decide_unchosen_categories(self):
        self.assertEqual(set(self.states().values()), {False})
        action = self.rule("action")
        self.rule("^de", action="disable")
        self.assertEqual(
            self.states(),
            {
                str(self.kids.pk): False,
                str(self.german.pk): True,
                str(self.english.pk): True,
                str(self.hidden.pk): False,
            },
        )
        response = self.client.get(self.url("?scope=movie"))
        self.assertEqual(
            [row["regex_pattern"] for row in response.data], ["action", "^de"]
        )
        response = self.client.post(
            self.url(), {"scope": "movie", "regex_pattern": "action"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("regex_pattern", response.data)
        response = self.client.post(
            self.url(), {"scope": "movie", "regex_pattern": "("}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        response = self.client.patch(
            self.url(f"{action['id']}/"), {"enabled": False}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.delete(self.url(f"{action['id']}/"))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.profile.category_rules.count(), 1)

    def test_preview_reports_matches_and_coverage_like_m3u(self):
        first = self.rule("action")
        second = self.rule("^de", action="disable")
        response = self.client.post(
            self.url("preview-draft/?page=1&page_size=50"),
            {
                "rules": [
                    {**first, "preview_id": str(first["id"])},
                    {**second, "preview_id": str(second["id"])},
                ],
                "target_id": str(first["id"]),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        # Only categories the accounts enable are part of the inventory.
        self.assertEqual(response.data["inventory_count"], 3)
        self.assertEqual(
            {row["rule_id"]: row["count"] for row in response.data["rule_coverage"]},
            {str(first["id"]): 2, str(second["id"]): 0},
        )
        self.assertEqual(
            {
                row["name"]: row["currently_enabled"]
                for row in response.data["results"]
            },
            {"DE Action": True, "EN Action": True},
        )

    def test_reorder_and_apply_hand_matches_back_to_the_rule(self):
        first = self.rule("action")
        second = self.rule("^de", action="disable")
        response = self.client.post(
            self.url("reorder/"),
            {
                "ids": [second["id"], first["id"]],
                "positions": [0, 1],
                "scope": "movie",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        rules = [
            {**second, "order": 0, "preview_id": str(second["id"])},
            {**first, "order": 1, "preview_id": str(first["id"])},
        ]
        response = self.client.post(
            self.url("save-apply/"),
            {"rules": rules, "target_id": str(second["id"])},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated"], 1)
        self.assertEqual(
            response.data["category_updates"][0]["target_id"], self.german.pk
        )
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.category_choices, [])
        self.assertFalse(self.states()[str(self.german.pk)])
