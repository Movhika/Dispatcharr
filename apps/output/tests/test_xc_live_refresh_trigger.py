from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from apps.output.views import _xc_stream_live_streams_then_refresh


class XcLiveRefreshTriggerTests(SimpleTestCase):
    def test_refresh_is_requested_only_after_current_catalog_is_served(self):
        request = RequestFactory().get(
            "/player_api.php?action=get_live_streams"
        )
        user = SimpleNamespace(id=4)

        with patch(
            "apps.output.views._xc_stream_live_streams",
            return_value=iter(["[", "]"]),
        ), patch(
            "apps.m3u.client_refresh.handle_xc_live_catalog_request"
        ) as handle:
            response = _xc_stream_live_streams_then_refresh(request, user)
            self.assertEqual(next(response), "[")
            handle.assert_not_called()
            self.assertEqual(next(response), "]")
            handle.assert_not_called()
            with self.assertRaises(StopIteration):
                next(response)

        handle.assert_called_once_with(request, user)

    def test_failed_catalog_response_does_not_trigger_refresh(self):
        request = RequestFactory().get(
            "/player_api.php?action=get_live_streams"
        )
        user = SimpleNamespace(id=4)

        def broken_stream():
            yield "["
            raise RuntimeError("catalog failed")

        with patch(
            "apps.output.views._xc_stream_live_streams",
            return_value=broken_stream(),
        ), patch(
            "apps.m3u.client_refresh.handle_xc_live_catalog_request"
        ) as handle:
            response = _xc_stream_live_streams_then_refresh(request, user)
            self.assertEqual(next(response), "[")
            with self.assertRaises(RuntimeError):
                next(response)

        handle.assert_not_called()
