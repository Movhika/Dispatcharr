from unittest.mock import patch

from django.test import SimpleTestCase
from django.utils import timezone

from apps.m3u.tasks import refresh_single_m3u_account


class ConditionalM3URefreshTests(SimpleTestCase):
    @patch("apps.m3u.tasks._refresh_single_m3u_account_impl")
    @patch("apps.m3u.tasks.release_task_lock")
    @patch("apps.m3u.tasks.acquire_task_lock", return_value=True)
    @patch("apps.m3u.tasks.M3UAccount.objects.filter")
    def test_fresh_account_skips_before_provider_download(
        self,
        account_filter,
        acquire_lock,
        release_lock,
        refresh_impl,
    ):
        account_filter.return_value.values_list.return_value.first.return_value = (
            timezone.now()
        )

        result = refresh_single_m3u_account.run(
            account_id=11,
            include_vod=False,
            minimum_age_seconds=3300,
        )

        refresh_impl.assert_not_called()
        release_lock.assert_called_once_with("refresh_single_m3u_account", 11)
        self.assertIn("fresh", result)
