from django.test import TestCase

from apps.accounts.models import User
from apps.accounts.serializers import UserSerializer
from apps.vod.models import VODAccessPolicy


class UserSerializerValidationTests(TestCase):
    def test_username_validation_allows_supported_characters(self):
        serializer = UserSerializer(
            data={
                "username": "joe.smith_123@test-user",
                "password": "testpassword123",
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_username_validation_rejects_unsupported_characters(self):
        # Use +, which Django allows but our XC-safe allow-list rejects.
        serializer = UserSerializer(
            data={
                "username": "joe+smith",
                "password": "testpassword123",
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("username", serializer.errors)
        self.assertIn(
            "Username may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)",
            str(serializer.errors["username"]),
        )

    def test_xc_password_allows_supported_characters(self):
        serializer = UserSerializer(
            data={
                "username": "joe",
                "password": "testpassword123",
                "custom_properties": {
                    "xc_password": "pass.word_123@test-user",
                },
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)

    def test_xc_password_rejects_unsupported_characters(self):
        serializer = UserSerializer(
            data={
                "username": "joe",
                "password": "testpassword123",
                "custom_properties": {
                    "xc_password": "pass!word",
                },
            }
        )

        self.assertFalse(serializer.is_valid())
        self.assertIn("custom_properties", serializer.errors)
        self.assertIn(
            "XC password may only contain letters, numbers, periods (.), underscores (_), at signs (@), and hyphens (-)",
            str(serializer.errors["custom_properties"]),
        )

    def test_vod_preferences_are_saved_per_user_and_normalize_languages(self):
        serializer = UserSerializer(
            data={
                "username": "vod-user",
                "password": "testpassword123",
                "vod_policy_settings": {
                    "export_mode": "compact",
                    "hard_constraints": {
                        "required_audio_languages": ["deu", "eng"],
                        "required_subtitle_languages": ["de"],
                        "preferred_resolutions": ["1080p", "720p"],
                        "allow_unknown_metadata": False,
                    },
                    "ranking": [
                        "audio_language",
                        "subtitle_language",
                        "resolution",
                    ],
                },
            }
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        user = serializer.save()
        policy = user.vod_access_policies.get()
        self.assertEqual(
            policy.hard_constraints["required_audio_languages"],
            ["ger", "eng"],
        )
        self.assertEqual(
            policy.hard_constraints["required_subtitle_languages"],
            ["ger"],
        )
        self.assertEqual(policy.export_mode, "compact")

    def test_vod_preferences_do_not_modify_a_policy_shared_by_other_users(self):
        first = User.objects.create_user(username="first", password="secret")
        second = User.objects.create_user(username="second", password="secret")
        shared = VODAccessPolicy.objects.create(
            name="Shared policy",
            export_mode="compact",
            hard_constraints={"required_audio_languages": ["eng"]},
        )
        shared.users.set([first, second])

        serializer = UserSerializer(
            first,
            data={
                "vod_policy_settings": {
                    "export_mode": "variants",
                    "hard_constraints": {
                        "required_audio_languages": ["deu"],
                    },
                    "ranking": ["audio_language"],
                }
            },
            partial=True,
        )

        self.assertTrue(serializer.is_valid(), serializer.errors)
        serializer.save()
        shared.refresh_from_db()
        self.assertEqual(shared.hard_constraints["required_audio_languages"], ["eng"])
        self.assertEqual(shared.users.count(), 1)
        personal = first.vod_access_policies.get()
        self.assertEqual(personal.export_mode, "variants")
        self.assertEqual(
            personal.hard_constraints["required_audio_languages"], ["ger"]
        )
