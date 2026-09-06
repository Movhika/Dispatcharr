from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from apps.m3u.client_refresh import (
    CLIENT_REFRESH_MIN_AGE_SECONDS,
    handle_xc_live_catalog_request,
)
from apps.m3u.models import M3UAccount


def _user(*, enabled):
    return SimpleNamespace(
        id=7,
        username="xc-user",
        custom_properties={"xc_live_refresh_on_request": enabled},
    )


def _account(*, minutes_old=120):
    return SimpleNamespace(
        id=11,
        name="Provider One",
        status=M3UAccount.Status.SUCCESS,
        updated_at=timezone.now() - timezone.timedelta(minutes=minutes_old),
    )


class ClientLiveRefreshTests(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory().get(
            "/player_api.php?action=get_live_streams",
            HTTP_USER_AGENT="XC Test Client",
            REMOTE_ADDR="192.0.2.10",
        )

    @patch("apps.m3u.client_refresh.log_system_event")
    @patch("apps.m3u.client_refresh.cache.add", return_value=True)
    def test_disabled_user_is_logged_but_does_not_query_accounts(
        self, cache_add, log_event
    ):
        with patch("apps.m3u.client_refresh._visible_live_accounts") as visible:
            result = handle_xc_live_catalog_request(
                self.request,
                _user(enabled=False),
            )

        visible.assert_not_called()
        self.assertEqual(result["queued"], [])
        self.assertEqual(result["skipped"], ["disabled for user"])
        log_event.assert_called_once()

    @patch("apps.m3u.client_refresh.log_system_event")
    @patch("apps.m3u.client_refresh.cache.add", return_value=True)
    @patch("apps.m3u.client_refresh.is_task_lock_held", return_value=False)
    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    def test_stale_account_queues_live_only_refresh(
        self, apply_async, task_locked, cache_add, log_event
    ):
        account = _account(minutes_old=120)
        with patch(
            "apps.m3u.client_refresh._visible_live_accounts",
            return_value=[account],
        ):
            result = handle_xc_live_catalog_request(
                self.request,
                _user(enabled=True),
            )

        apply_async.assert_called_once_with(
            kwargs={
                "account_id": account.id,
                "include_vod": False,
                "minimum_age_seconds": CLIENT_REFRESH_MIN_AGE_SECONDS,
            }
        )
        self.assertEqual(result["queued"], [account.name])
        log_event.assert_called_once()

    @patch("apps.m3u.client_refresh.log_system_event")
    @patch("apps.m3u.client_refresh.cache.add", return_value=True)
    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    def test_recent_success_skips_refresh(self, apply_async, cache_add, log_event):
        account = _account(minutes_old=10)
        with patch(
            "apps.m3u.client_refresh._visible_live_accounts",
            return_value=[account],
        ):
            result = handle_xc_live_catalog_request(
                self.request,
                _user(enabled=True),
            )

        apply_async.assert_not_called()
        self.assertEqual(
            result["skipped"],
            [f"{account.name}: recently refreshed"],
        )

    @patch("apps.m3u.client_refresh.log_system_event")
    @patch("apps.m3u.client_refresh.cache.add", side_effect=[False, True])
    @patch("apps.m3u.client_refresh.is_task_lock_held", return_value=False)
    @patch("apps.m3u.tasks.refresh_single_m3u_account.apply_async")
    def test_provider_queue_key_coalesces_users(
        self, apply_async, task_locked, cache_add, log_event
    ):
        account = _account(minutes_old=120)
        with patch(
            "apps.m3u.client_refresh._visible_live_accounts",
            return_value=[account],
        ):
            result = handle_xc_live_catalog_request(
                self.request,
                _user(enabled=True),
            )

        apply_async.assert_not_called()
        self.assertEqual(result["skipped"], [f"{account.name}: already queued"])
