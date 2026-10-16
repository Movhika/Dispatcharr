"""Log privacy is unconditional, including exception output and old exports."""

import io
import logging
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest import TestCase, mock

from dispatcharr.log_redaction import (
    REDACTED,
    redact_log_bytes,
    redact_log_text,
    redacted_log_lines,
)
from dispatcharr.startup_log import DisplayTimezoneFormatter, startup_log


class LogRedactionTests(TestCase):
    def test_direct_collector_script_needs_no_application_bootstrap(self):
        script = Path(__file__).resolve().parents[2] / "dispatcharr/log_collector.py"
        with tempfile.TemporaryDirectory() as log_dir:
            result = subprocess.run(
                [sys.executable, "-S", str(script), log_dir],
                input=b'Failed https://example.invalid?password=secret status=403\n',
                capture_output=True,
                timeout=15,
                check=True,
            )
            self.assertNotIn(b'example.invalid', result.stdout)
            self.assertNotIn(b'secret', result.stdout)
            self.assertIn(b'status=403', result.stdout)

    def test_complete_urls_are_removed_including_encoded_or_escaped_urls(self):
        urls = (
            "https://user:password@example.invalid/live/user/password/123.ts?token=secret",
            "http://example.invalid/player_api.php?username=alice&password=secret",
            "rtsp://alice:secret@example.invalid/stream",
            r"https:\/\/example.invalid\/player_api.php?password=secret",
            "https%3A%2F%2Fexample.invalid%2Fstream%3Fpassword%3Dsecret",
        )
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(
                    redact_log_text(f"Failed {url} status=403"),
                    f"Failed {REDACTED} status=403",
                )

    def test_labelled_credentials_and_headers_are_removed(self):
        messages = (
            'username=alice password=secret status=403',
            '''{"username": "alice", "password": "secret", "status": 403}''',
            "{'xc_username': 'alice', 'xc_password': 'secret'}",
            "USERNAME: alice; PASSWORD: secret",
            "username alice password secret",
            "username is alice password is secret",
            "--username alice --password 'secret value'",
            'Authorization: Bearer secret',
            'Proxy-Authorization: Basic secret',
            'access_token=secret refresh_token=secret API_KEY=secret',
            'Cookie: sessionid=secret; another=secret',
            'Set-Cookie: sessionid=secret; HttpOnly',
            'password="secret value without a closing quote',
        )
        for message in messages:
            with self.subTest(message=message):
                redacted = redact_log_text(message)
                self.assertNotIn("alice", redacted)
                self.assertNotIn("secret", redacted)
                self.assertIn(REDACTED, redacted)
                self.assertEqual(redact_log_text(redacted), redacted)

    def test_relative_xc_paths_do_not_expose_path_credentials(self):
        for kind in ("live", "movie", "series", "timeshift"):
            with self.subTest(kind=kind):
                redacted = redact_log_text(f'GET /{kind}/alice/secret/123.ts HTTP/1.1 403')
                self.assertEqual(
                    redacted,
                    f'GET /{kind}/{REDACTED}/{REDACTED}/123.ts HTTP/1.1 403',
                )

    def test_split_request_exception_parts_do_not_expose_the_provider(self):
        message = (
            "HTTPConnectionPool(host='example.invalid', port=80): "
            "failed with url: /get.php?username=alice&password=secret"
        )
        redacted = redact_log_text(message)
        for sensitive in ('example.invalid', 'get.php', 'alice', 'secret'):
            self.assertNotIn(sensitive, redacted)
        self.assertIn('port=80', redacted)

    def test_credential_sql_does_not_expose_positional_values(self):
        line = (
            "ERROR postgres INSERT INTO accounts_user "
            "(username,password) VALUES ('alice','secret')"
        )
        self.assertEqual(
            redact_log_text(line),
            'ERROR postgres [REDACTED credential SQL statement]',
        )

    def test_diagnostic_fields_routes_and_non_ascii_bytes_are_preserved(self):
        text = 'WARNING provider account_id=4 status=403 elapsed=1.2 GET /api/core/logs/'
        self.assertEqual(redact_log_text(text), text)
        self.assertEqual(redact_log_bytes(b'unchanged \xff\n'), b'unchanged \xff\n')

    def test_bounded_stream_does_not_leak_credentials_across_chunk_boundaries(self):
        limit = 128
        line = b'x' * 113 + b' password="cross-boundary-secret" tail\nnext record\n'
        result = b''.join(redacted_log_lines(io.BytesIO(line), max_line_bytes=limit))
        self.assertNotIn(b'cross', result)
        self.assertNotIn(b'boundary', result)
        self.assertNotIn(b'secret', result)
        self.assertIn(REDACTED.encode(), result)
        self.assertIn(b'omitted oversized continuation', result)
        self.assertTrue(result.endswith(b'next record\n'))

    def test_stream_keeps_complete_normal_lines_and_redacts_a_final_fragment(self):
        data = b'normal\npassword=secret'
        self.assertEqual(
            b''.join(redacted_log_lines(io.BytesIO(data))),
            b'normal\npassword=[REDACTED]',
        )

    def test_all_credential_split_positions_fail_closed(self):
        for position in range(110, 133):
            for field in (
                b'password="cross-boundary-secret"',
                b'https://alice:secret@example.invalid/path',
            ):
                with self.subTest(position=position, field=field):
                    data = b'x' * position + b' ' + field + b'\nafter\n'
                    output = b''.join(redacted_log_lines(io.BytesIO(data), max_line_bytes=128))
                    self.assertNotIn(b'alice', output)
                    self.assertNotIn(b'cross', output)
                    self.assertNotIn(b'secret', output)
                    self.assertTrue(output.endswith(b'after\n'))

    def test_startup_messages_and_both_formatter_modes_redact_without_mutating_records(self):
        message = 'Failed https://example.invalid?password=secret username=alice'
        output = io.StringIO()
        startup_log(message, stream=output)
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('alice', output.getvalue())
        for fronted in (False, True):
            with mock.patch('dispatcharr.startup_log.collector_running', return_value=fronted):
                formatter = DisplayTimezoneFormatter()
            record = logging.LogRecord('test', logging.ERROR, __file__, 1, '%s', (message,), None)
            rendered = formatter.format(record)
            self.assertNotIn('secret', rendered)
            self.assertNotIn('alice', rendered)
            self.assertEqual(record.msg, '%s')
            self.assertEqual(record.args, (message,))

    def test_exception_traceback_is_redacted_too(self):
        with mock.patch('dispatcharr.startup_log.collector_running', return_value=False):
            formatter = DisplayTimezoneFormatter()
        try:
            raise ValueError('Failed https://example.invalid?password=secret')
        except ValueError:
            record = logging.LogRecord(
                'test', logging.ERROR, __file__, 1,
                'Request failed', (), sys.exc_info(),
            )
        rendered = formatter.format(record)
        self.assertIn('ValueError', rendered)
        self.assertNotIn('example.invalid', rendered)
        self.assertNotIn('secret', rendered)
