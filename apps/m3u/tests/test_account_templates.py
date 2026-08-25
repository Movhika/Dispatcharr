from django.test import TestCase

from apps.m3u.account_templates import (
    apply_account_template,
    capture_account_template,
)
from apps.m3u.models import M3UAccount, M3UFilter, M3UGroupRule
from apps.m3u.serializers import M3UAccountSerializer


class M3UAccountTemplateTests(TestCase):
    def setUp(self):
        self.source = M3UAccount.objects.create(
            name="source-account",
            account_type=M3UAccount.Types.XC,
            server_url="https://provider.example",
            username="secret-user",
            password="secret-password",
            max_streams=3,
            refresh_interval=12,
            stale_stream_days=14,
            priority=7,
            custom_properties={
                "enable_vod": True,
                "use_group_rules_live": True,
                "use_group_rules_movie": True,
                "use_group_rules_series": False,
                "provider_secret": "must-not-be-copied",
            },
        )
        M3UFilter.objects.create(
            m3u_account=self.source,
            filter_type="group",
            regex_pattern=r"adult|xxx",
            exclude=True,
            order=0,
        )
        M3UGroupRule.objects.create(
            m3u_account=self.source,
            scope=M3UGroupRule.Scope.MOVIE,
            regex_pattern=r"^GERMANY",
            action=M3UGroupRule.Action.ENABLE,
            metadata_defaults={
                "audio_languages": ["ger"],
                "video_features": ["hdr"],
            },
            order=0,
        )

    def test_capture_and_apply_copy_only_portable_settings_and_rules(self):
        template = capture_account_template(
            self.source,
            name="Provider defaults",
            description="Portable setup",
        )

        serialized = str(
            {
                "settings": template.account_settings,
                "filters": template.filters,
                "rules": template.group_rules,
            }
        )
        self.assertNotIn("secret-user", serialized)
        self.assertNotIn("secret-password", serialized)
        self.assertNotIn("provider_secret", serialized)

        target = M3UAccount.objects.create(
            name="target-account",
            server_url="https://other-provider.example",
            username="target-user",
            password="target-password",
        )
        M3UFilter.objects.create(
            m3u_account=target,
            filter_type="name",
            regex_pattern="old",
        )

        apply_account_template(target, template)
        target.refresh_from_db()

        self.assertEqual(target.server_url, "https://other-provider.example")
        self.assertEqual(target.username, "target-user")
        self.assertEqual(target.password, "target-password")
        self.assertEqual(target.max_streams, 3)
        self.assertEqual(target.refresh_interval, 12)
        self.assertTrue(target.custom_properties["enable_vod"])
        self.assertNotIn("provider_secret", target.custom_properties)
        self.assertEqual(
            list(target.filters.values_list("regex_pattern", flat=True)),
            [r"adult|xxx"],
        )
        copied_rule = target.group_rules.get()
        self.assertEqual(copied_rule.regex_pattern, r"^GERMANY")
        self.assertEqual(
            copied_rule.metadata_defaults["video_features"], ["hdr"]
        )

    def test_catalog_counts_are_split_by_content_type(self):
        self.source.custom_properties.update(
            {
                "live_catalog_counts": {
                    "provider_total": 500,
                    "selected_total": 120,
                },
                "vod_catalog_counts": {
                    "movies": {
                        "provider_total": 200,
                        "selected_total": 40,
                    },
                    "series": {
                        "provider_total": 90,
                        "selected_total": 12,
                    },
                },
            }
        )
        self.source.save(update_fields=["custom_properties"])

        counts = M3UAccountSerializer(self.source).data["catalog_counts"]

        self.assertEqual(counts["live"], {"original": 500, "selected": 120})
        self.assertEqual(counts["movies"], {"original": 200, "selected": 40})
        self.assertEqual(counts["series"], {"original": 90, "selected": 12})
