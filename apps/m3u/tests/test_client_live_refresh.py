from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from apps.m3u.client_refresh import handle_xc_live_catalog_request
from apps.m3u.models import M3UAccount
from apps.m3u.tasks import refresh_single_m3u_account
from apps.output.views import _xc_stream_live_streams_then_refresh


class ClientLiveRefreshTests(SimpleTestCase):
    def setUp(self):
        self.user = SimpleNamespace(
            id=7,
            custom_properties={
                "xc_live_refresh_on_request": True,
                "xc_live_refresh_request_interval_minutes": 30,
            },
        )
        self.account = SimpleNamespace(
            id=11,
            name="provider",
            xc_live_refresh_min_age_minutes=45,
            updated_at=timezone.now() - timedelta(hours=2),
            status=M3UAccount.Status.SUCCESS,
        )

    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    @patch("apps.m3u.client_refresh.cache.add", return_value=True)
    @patch("apps.m3u.client_refresh.is_task_lock_held", return_value=False)
    @patch("apps.m3u.client_refresh._visible_live_accounts")
    def test_opted_in_user_queues_live_only_refresh(
        self, visible_accounts, _lock, cache_add, apply_async
    ):
        visible_accounts.return_value = [self.account]

        handle_xc_live_catalog_request(self.user)

        self.assertEqual(cache_add.call_count, 2)
        kwargs = apply_async.call_args.kwargs["kwargs"]
        self.assertEqual(kwargs["account_id"], self.account.id)
        self.assertIs(kwargs["include_vod"], False)
        self.assertEqual(kwargs["minimum_age_seconds"], 45 * 60)

    @patch("apps.m3u.client_refresh._visible_live_accounts")
    def test_disabled_user_does_not_query_providers(self, visible_accounts):
        self.user.custom_properties["xc_live_refresh_on_request"] = False
        handle_xc_live_catalog_request(self.user)
        visible_accounts.assert_not_called()

    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    @patch("apps.m3u.client_refresh._visible_live_accounts")
    def test_recent_success_does_not_queue(self, visible_accounts, apply_async):
        self.account.updated_at = timezone.now() - timedelta(minutes=10)
        visible_accounts.return_value = [self.account]
        handle_xc_live_catalog_request(self.user)
        apply_async.assert_not_called()

    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    @patch("apps.m3u.client_refresh.cache.delete")
    @patch("apps.m3u.client_refresh.cache.add", side_effect=[True, False])
    @patch("apps.m3u.client_refresh.is_task_lock_held", return_value=False)
    @patch("apps.m3u.client_refresh._visible_live_accounts")
    def test_queued_provider_releases_unused_user_cooldown(
        self, visible_accounts, _lock, cache_add, cache_delete, apply_async
    ):
        visible_accounts.return_value = [self.account]
        # cache.get normally returns the token reserved by the first add.
        with patch("apps.m3u.client_refresh.cache.get", side_effect=lambda key: cache_add.call_args_list[0].args[1]):
            handle_xc_live_catalog_request(self.user)
        cache_delete.assert_called_once()
        apply_async.assert_not_called()

    @patch("apps.output.views._xc_stream_live_streams", return_value=iter(["[", "]"]))
    @patch("apps.m3u.client_refresh.handle_xc_live_catalog_request")
    def test_refresh_starts_after_catalog_is_complete(self, handle, _stream):
        output = _xc_stream_live_streams_then_refresh(None, self.user)
        self.assertEqual(next(output), "[")
        handle.assert_not_called()
        self.assertEqual(list(output), ["]"])
        handle.assert_called_once_with(self.user)


class ConditionalTaskFreshnessTests(SimpleTestCase):
    @patch("apps.m3u.tasks.release_task_lock")
    @patch("apps.m3u.tasks.acquire_task_lock", return_value=True)
    @patch("apps.m3u.tasks._refresh_single_m3u_account_impl")
    @patch("apps.m3u.tasks.M3UAccount.objects.filter")
    def test_refresh_skips_recent_provider_update(
        self, account_filter, refresh_impl, _acquire, release
    ):
        account_filter.return_value.values_list.return_value.first.return_value = timezone.now()
        result = refresh_single_m3u_account(
            11,
            include_vod=False,
            minimum_age_seconds=3600,
        )
        self.assertIn("Skipped conditional", result)
        refresh_impl.assert_not_called()
        release.assert_called_once_with("refresh_single_m3u_account", 11)
