"""Provider credentials stay out of status messages and System Events."""

from unittest.mock import MagicMock, patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from apps.epg.models import EPGSource
from apps.epg.serializers import EPGSourceSerializer
from apps.m3u.models import M3UAccount
from apps.m3u.serializers import M3UAccountSerializer
from apps.m3u.tasks import _set_m3u_account_status
from core.api_views import get_system_events
from core.models import SystemEvent
from core.utils import log_system_event, redact_display_data

PROVIDER_URL = (
    "http://provider.example:8080/player_api.php?username=alice&password=hunter2"
)
MESSAGE = f"Error fetching {PROVIDER_URL}: 404 Client Error"


def assert_masked(test, value):
    test.assertNotIn("hunter2", value)
    test.assertNotIn("alice", value)
    test.assertNotIn("provider.example", value)


class RedactDisplayDataTests(SimpleTestCase):
    def test_strings_lose_provider_credentials_and_host(self):
        masked = redact_display_data(MESSAGE)
        assert_masked(self, masked)
        self.assertIn("404 Client Error", masked)

    def test_nested_details_keep_their_shape(self):
        masked = redact_display_data(
            {"message": MESSAGE, "password": "plain", "items": [MESSAGE], "count": 3}
        )
        assert_masked(self, masked["message"])
        assert_masked(self, masked["items"][0])
        self.assertEqual(masked["password"], "[password]")
        self.assertEqual(masked["count"], 3)

    def test_text_without_credentials_is_unchanged(self):
        for value in ("Connection timed out", "", None, 5):
            self.assertEqual(redact_display_data(value), value)


class SystemEventRedactionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(
            username="events_admin", password="x", user_level=User.UserLevel.ADMIN
        )

    def events(self):
        request = APIRequestFactory().get("/api/core/system-events/")
        force_authenticate(request, user=self.admin)
        return get_system_events(request).data["events"]

    @patch("core.utils._dispatch_system_event_integrations")
    def test_stored_events_are_masked_but_integrations_get_the_original(
        self, dispatch
    ):
        log_system_event("m3u_error", account_name="Redaction test", message=MESSAGE)

        # Other test classes may leave events behind; find this one.
        event = SystemEvent.objects.filter(
            details__account_name="Redaction test"
        ).get()
        assert_masked(self, event.details["message"])
        self.assertEqual(dispatch.call_args.kwargs["message"], MESSAGE)

    def test_events_stored_before_masking_are_masked_on_the_way_out(self):
        stored = SystemEvent.objects.create(
            event_type="epg_error",
            channel_name=MESSAGE,
            details={"message": MESSAGE},
        )

        event = next(row for row in self.events() if row["id"] == stored.id)
        assert_masked(self, event["details"]["message"])
        assert_masked(self, event["channel_name"])


class StatusMessageRedactionTests(TestCase):
    def setUp(self):
        User = get_user_model()
        admin = User.objects.create_user(
            username="status_admin", password="x", user_level=User.UserLevel.ADMIN
        )
        request = APIRequestFactory().get("/")
        request.user = admin
        self.context = {"request": request}

    def test_m3u_account_status_message_is_masked(self):
        account = M3UAccount.objects.create(name="Provider", last_message=MESSAGE)
        data = M3UAccountSerializer(account, context=self.context).data
        assert_masked(self, data["last_message"])
        # The stored message stays complete for troubleshooting on the server.
        self.assertEqual(M3UAccount.objects.get(pk=account.pk).last_message, MESSAGE)

    def test_epg_source_status_message_is_masked(self):
        source = EPGSource.objects.create(name="Guide", last_message=MESSAGE)
        data = EPGSourceSerializer(source, context=self.context).data
        assert_masked(self, data["last_message"])


class StatusErrorNotificationTests(SimpleTestCase):
    @patch("apps.m3u.tasks.log_system_event")
    @patch("apps.m3u.tasks.send_m3u_update")
    @patch("apps.m3u.tasks.M3UAccount")
    @patch("apps.m3u.tasks._release_task_db_connection")
    def test_error_notification_is_masked(self, _release, model, notify, _event):
        model.objects.filter.return_value = MagicMock()

        _set_m3u_account_status(
            account_id=10,
            status=M3UAccount.Status.ERROR,
            last_message=MESSAGE,
            notify_error=True,
        )

        assert_masked(self, notify.call_args.kwargs["error"])
