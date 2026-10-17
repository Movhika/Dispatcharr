"""Guided setup persists progress and never recreates an account or EPG on retry."""

from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.exceptions import APIException
from rest_framework.test import APIClient

from apps.channels.models import ChannelGroup, ChannelGroupM3UAccount
from apps.epg.models import EPGSource
from apps.m3u.account_setup import (
    advance_account_setup,
    discover_setup_categories,
)
from apps.m3u.models import M3UAccount
from apps.m3u.serializers import M3UAccountSerializer


class AccountSetupTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = get_user_model().objects.create_user(
            username="setup-admin", user_level=10
        )
        self.client.force_authenticate(self.admin)
        for target in (
            "apps.m3u.api_views.refresh_m3u_groups",
            "apps.m3u.signals.refresh_m3u_groups.delay",
            "apps.m3u.tasks.prepare_account_setup.delay",
            "apps.epg.signals.refresh_epg_data.delay",
        ):
            patcher = patch(target)
            patcher.start()
            self.addCleanup(patcher.stop)

    def account(self, **values):
        return M3UAccount.objects.create(
            **{
                "name": "Example setup",
                "account_type": "XC",
                "server_url": "https://provider.example.invalid/base/player_api.php",
                "username": "example&user",
                "password": "example?password&=",
                "setup_step": "epg",
                **values,
            }
        )

    def action(self, account, action):
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(
                f"/api/m3u/accounts/{account.id}/setup/",
                {"action": action},
                format="json",
            )

    def group(self, account):
        return ChannelGroupM3UAccount.objects.create(
            m3u_account=account,
            channel_group=ChannelGroup.objects.create(name="Example category"),
            enabled=True,
        )

    def test_new_xc_and_standard_accounts_start_at_their_next_setup_step(self):
        for kind, step in (("XC", "epg"), ("STD", "categories")):
            with self.subTest(kind=kind):
                response = self.client.post(
                    "/api/m3u/accounts/",
                    {
                        "name": f"New {kind}",
                        "account_type": kind,
                        "server_url": "https://provider.example.invalid",
                        "username": "example",
                        "password": "example",
                        "start_setup": True,
                    },
                    format="json",
                )
                self.assertEqual(response.status_code, 201, response.data)
                self.assertEqual(response.data["setup_step"], step)
                self.assertNotIn("start_setup", response.data)

    def test_api_clients_without_guided_setup_keep_existing_behavior(self):
        serializer = M3UAccountSerializer(
            data={"name": "Existing API workflow", "account_type": "XC"}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.save().setup_step, "")

    def test_new_guided_accounts_require_connection_details(self):
        for kind, fields in (
            ("XC", {"server_url", "username", "password"}),
            ("STD", {"server_url"}),
        ):
            serializer = M3UAccountSerializer(
                data={
                    "name": "Missing details",
                    "account_type": kind,
                    "start_setup": True,
                }
            )
            self.assertFalse(serializer.is_valid())
            self.assertEqual(set(serializer.errors), fields)

    def test_file_source_is_valid_for_standard_guided_setup(self):
        serializer = M3UAccountSerializer(
            data={
                "name": "File setup",
                "account_type": "STD",
                "start_setup": True,
                "file_path": "/data/example.m3u",
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)

    @patch("apps.m3u.api_views.os.remove")
    @patch("apps.m3u.api_views.os.path.exists", return_value=True)
    @patch("apps.m3u.api_views.os.makedirs")
    @patch("builtins.open")
    def test_switch_to_uploaded_file_clears_old_url(
        self, open_file, makedirs, exists, remove
    ):
        account = self.account(account_type="STD", setup_step="categories")
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/",
            {
                "account_type": "STD",
                "server_url": "",
                "file": SimpleUploadedFile("example.m3u", b"#EXTM3U\n"),
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        account.refresh_from_db()
        self.assertFalse(account.server_url)
        self.assertEqual(account.file_path, "/data/uploads/m3us/example.m3u")
        remove.assert_not_called()

    @patch("apps.m3u.api_views.os.remove")
    @patch("apps.m3u.api_views.os.path.exists", return_value=True)
    @patch("apps.m3u.api_views.os.makedirs")
    @patch("builtins.open")
    def test_replacing_same_filename_does_not_delete_the_new_upload(
        self, open_file, makedirs, exists, remove
    ):
        account = self.account(
            account_type="STD", server_url="",
            file_path="/data/uploads/m3us/example.m3u",
        )
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/",
            {"file": SimpleUploadedFile("example.m3u", b"#EXTM3U\n")},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        remove.assert_not_called()

    def test_switch_to_url_clears_file_and_file_edits_keep_saved_source(self):
        account = self.account(
            account_type="STD", server_url="",
            file_path="/data/uploads/m3us/example.m3u",
        )
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/",
            {"name": "Renamed file", "server_url": ""}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        account.refresh_from_db()
        self.assertEqual(account.file_path, "/data/uploads/m3us/example.m3u")
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/",
            {"server_url": "https://provider.example.invalid/playlist.m3u", "file_path": ""},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        account.refresh_from_db()
        self.assertEqual(account.server_url, "https://provider.example.invalid/playlist.m3u")
        self.assertFalse(account.file_path)

    def test_refresh_error_and_normal_edits_preserve_the_setup_step(self):
        account = self.account(status="error", last_message="Provider denied access")
        response = self.client.patch(
            f"/api/m3u/accounts/{account.id}/",
            {"name": "Edited setup", "setup_step": "", "start_setup": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "epg")
        response = self.client.get(f"/api/m3u/accounts/{account.id}/")
        self.assertEqual(response.data["setup_step"], "epg")
        self.assertEqual(response.data["status"], "error")

    @patch("apps.epg.signals.refresh_epg_data.delay")
    def test_epg_retry_preserves_base_path_and_credentials(self, refresh):
        account = self.account()
        for _ in range(2):
            response = self.action(account, "create_epg")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["setup_step"], "categories")
        self.assertEqual(EPGSource.objects.count(), 1)
        self.assertEqual(M3UAccount.objects.filter(name=account.name).count(), 1)
        url = urlsplit(EPGSource.objects.get().url)
        self.assertEqual(url.path, "/base/xmltv.php")
        self.assertEqual(
            parse_qs(url.query),
            {"username": [account.username], "password": [account.password]},
        )
        refresh.assert_called_once()

    def test_account_type_edits_align_unfinished_setup(self):
        for previous_type, step, new_type, expected_step in (
            ("XC", "epg", "STD", "categories"),
            ("XC", "categories", "STD", "categories"),
            ("STD", "categories", "XC", "epg"),
            ("XC", "categories", "XC", "categories"),
            ("STD", "epg", "STD", "categories"),
        ):
            with self.subTest(previous_type=previous_type, step=step):
                account = self.account(
                    name=f"Type change {previous_type} {step} {new_type}",
                    account_type=previous_type,
                    setup_step=step,
                    refresh_interval=24,
                )
                response = self.client.patch(
                    f"/api/m3u/accounts/{account.id}/",
                    {"account_type": new_type},
                    format="json",
                )
                self.assertEqual(response.status_code, 200, response.data)
                self.assertEqual(response.data["setup_step"], expected_step)
                account.refresh_from_db()
                self.assertEqual(account.setup_step, expected_step)
                self.assertFalse(account.refresh_task.enabled)
        self.assertFalse(EPGSource.objects.exists())

    def test_account_type_edits_do_not_restart_completed_setup(self):
        for previous_type, new_type in (("XC", "STD"), ("STD", "XC")):
            with self.subTest(previous_type=previous_type):
                account = self.account(
                    name=f"Completed {previous_type}",
                    account_type=previous_type,
                    setup_step="",
                )
                response = self.client.patch(
                    f"/api/m3u/accounts/{account.id}/",
                    {"account_type": new_type},
                    format="json",
                )
                self.assertEqual(response.status_code, 200, response.data)
                account.refresh_from_db()
                self.assertEqual(account.setup_step, "")

    def test_skipping_epg_is_persisted_without_creating_a_source(self):
        account = self.account()
        response = self.action(account, "skip_epg")
        self.assertEqual(response.status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "categories")
        self.assertFalse(EPGSource.objects.exists())

    @patch("apps.m3u.tasks.refresh_single_m3u_account.delay")
    def test_automatic_refreshes_wait_until_setup_is_complete(self, refresh):
        account = self.account(
            custom_properties={"enable_vod": True},
            refresh_interval=24,
            vod_refresh_after_live=False,
            vod_refresh_interval=6,
        )
        self.assertFalse(account.refresh_task.enabled)
        self.assertFalse(account.vod_refresh_task.enabled)
        self.action(account, "skip_epg")
        account.refresh_from_db()
        self.assertFalse(account.refresh_task.enabled)
        self.group(account)
        self.assertEqual(self.action(account, "complete").status_code, 200)
        account.refresh_from_db()
        self.assertTrue(account.refresh_task.enabled)
        self.assertTrue(account.vod_refresh_task.enabled)
        self.assertFalse(EPGSource.objects.exists())

    def test_epg_validation_failure_leaves_step_resumable(self):
        account = self.account()
        EPGSource.objects.create(name=account.name, source_type="dummy")
        response = self.action(account, "create_epg")
        self.assertEqual(response.status_code, 400)
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "epg")
        self.assertEqual(EPGSource.objects.count(), 1)

    @patch("apps.m3u.tasks.refresh_single_m3u_account.delay")
    def test_completion_queues_initial_import_only_once(self, refresh):
        account = self.account(
            setup_step="categories", custom_properties={"enable_vod": True}
        )
        self.group(account)
        for _ in range(2):
            response = self.action(account, "complete")
            self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual(response.data["setup_step"], "")
        refresh.assert_called_once_with(account.id, include_vod=True)

    @patch(
        "apps.m3u.tasks.refresh_single_m3u_account.delay",
        side_effect=RuntimeError("broker unavailable"),
    )
    def test_failed_import_dispatch_restores_category_step(self, refresh):
        account = self.account(setup_step="categories", refresh_interval=24)
        self.group(account)
        with (
            self.assertRaises(APIException),
            self.captureOnCommitCallbacks(execute=True),
        ):
            advance_account_setup(account.id, "complete")
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "categories")
        self.assertFalse(account.refresh_task.enabled)

    def test_completion_requires_epg_decision_and_loaded_categories(self):
        account = self.account()
        self.assertEqual(self.action(account, "complete").status_code, 400)
        self.action(account, "skip_epg")
        self.assertEqual(self.action(account, "complete").status_code, 400)
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "categories")

    @patch("apps.m3u.tasks.prepare_account_setup.delay")
    def test_retry_requests_discovery_not_another_account(self, refresh):
        account = self.account(setup_step="categories", status="error")
        response = self.action(account, "retry_categories")
        self.assertEqual(response.status_code, 200)
        refresh.assert_called_once_with(account.id)
        self.assertEqual(response.data["setup_step"], "categories")
        self.assertEqual(response.data["status"], "fetching")

    @patch(
        "apps.m3u.tasks.prepare_account_setup.delay",
        side_effect=RuntimeError("broker unavailable"),
    )
    def test_failed_dispatch_returns_created_account(self, dispatch):
        response = self.client.post(
            "/api/m3u/accounts/",
            {"name": "Saved despite broker failure", "account_type": "XC",
             "server_url": "https://example.invalid", "username": "example",
             "password": "example", "start_setup": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["setup_step"], "epg")
        self.assertEqual(response.data["status"], "error")
        self.assertEqual(
            M3UAccount.objects.filter(name=response.data["name"]).count(), 1
        )

    @patch("apps.vod.tasks.refresh_categories", return_value=({}, {}))
    @patch("apps.m3u.tasks.refresh_m3u_groups", return_value=([], {"Example": {}}))
    def test_discovery_loads_live_and_vod_categories_without_importing(self, live, vod):
        account = self.account(custom_properties={"enable_vod": True})
        with patch("apps.m3u.tasks.send_m3u_update") as notify:
            discover_setup_categories(account.id)
        self.assertEqual(notify.call_args.kwargs["status"], "pending_setup")
        live.assert_called_once_with(account.id, full_refresh=True)
        vod.assert_called_once_with(account.id)
        account.refresh_from_db()
        self.assertEqual(account.status, "pending_setup")
        self.assertEqual(account.setup_step, "epg")

    @patch("apps.vod.tasks.refresh_categories", return_value=None)
    @patch("apps.m3u.tasks.refresh_m3u_groups", return_value=([], {"Example": {}}))
    def test_partial_discovery_failure_keeps_setup_resumable(self, live, vod):
        account = self.account(
            setup_step="categories", custom_properties={"enable_vod": True}
        )
        with patch("apps.m3u.tasks.send_m3u_update") as notify:
            discover_setup_categories(account.id)
        self.assertEqual(notify.call_args.kwargs["status"], "error")
        account.refresh_from_db()
        self.assertEqual(account.status, "error")
        self.assertEqual(account.setup_step, "categories")

    def test_unfinished_discovery_cannot_complete_using_partial_groups(self):
        account = self.account(setup_step="categories", status="fetching")
        self.group(account)
        self.assertEqual(self.action(account, "complete").status_code, 400)
        account.refresh_from_db()
        self.assertEqual(account.setup_step, "categories")

    @patch("core.utils.is_task_lock_held", return_value=False)
    @patch("apps.m3u.tasks.prepare_account_setup.delay")
    def test_stale_fetching_status_can_be_retried(self, dispatch, held):
        account = self.account(setup_step="categories", status="fetching")
        self.assertEqual(self.action(account, "retry_categories").status_code, 200)
        dispatch.assert_called_once_with(account.id)

    @patch("core.utils.is_task_lock_held", return_value=True)
    @patch("apps.m3u.tasks.prepare_account_setup.delay")
    def test_retry_does_not_duplicate_running_discovery(self, dispatch, held):
        account = self.account(setup_step="categories", status="fetching")
        self.assertEqual(self.action(account, "retry_categories").status_code, 200)
        dispatch.assert_not_called()

    def test_setup_action_is_described_in_openapi(self):
        from drf_spectacular.generators import SchemaGenerator

        schema = SchemaGenerator().get_schema(public=True)
        operation = schema["paths"]["/api/m3u/accounts/{id}/setup/"]["post"]
        self.assertIn("requestBody", operation)
        self.assertIn("200", operation["responses"])

    def test_standard_user_cannot_advance_setup(self):
        account = self.account()
        viewer = get_user_model().objects.create_user(
            username="setup-viewer", user_level=1
        )
        self.client.force_authenticate(viewer)
        self.assertEqual(self.action(account, "create_epg").status_code, 403)
        self.assertFalse(EPGSource.objects.exists())

    def test_legacy_accounts_are_not_enrolled_by_setup_requests(self):
        account = self.account(setup_step="")
        response = self.action(account, "create_epg")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["setup_step"], "")
        self.assertFalse(EPGSource.objects.exists())
