"""Django-free redaction shared by log producers, collection and exports.

This is deliberately independent of UI preferences. Do not feed the result back
into application state: only diagnostic output is redacted.
"""

import re


REDACTED = "[REDACTED]"
MAX_LINE_BYTES = 256 * 1024
_OVERSIZE_NOTICE = b" ... [log redaction omitted oversized continuation]\n"

_URL = re.compile(
    r"\b[a-z][a-z0-9+.-]*(?::(?:\\?/){2}|%3a(?:%2f){2})[^\s<>\"']+",
    re.IGNORECASE,
)
_KEY = (
    r"(?:[\w-]+[_-])?"
    r"(?:user(?:[_-]?name)?|password|passwd|pwd|api[_-]?key|"
    r"access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|"
    r"token|authorization|auth|cookie|session[_-]?id|url|uri|host(?:name)?)"
)
_VALUE = (
    re.escape(REDACTED)
    + r'|"(?:\\.|[^"\\])*"'
    + r"|'(?:\\.|[^'\\])*'"
    + r'|"(?:\\.|[^"\\])*$'
    + r"|'(?:\\.|[^'\\])*$"
    + r"|(?:Bearer|Basic)\s+[^\s,;\"']+"
    + r"|[^\s,;&}\])\"']+"
)
_FIELD = re.compile(
    rf"(?P<prefix>\b{_KEY}\b[\"']?(?:\s*[:=]\s*|[ \t]+(?:is[ \t]+)?))"
    rf"(?P<value>{_VALUE})",
    re.IGNORECASE,
)
_CLI = re.compile(
    rf"(?P<prefix>--{_KEY}(?:=|[ \t]+))(?P<value>{_VALUE})",
    re.IGNORECASE,
)
_AUTH = re.compile(r"\b(Bearer|Basic)[ \t]+[^\s,;\"']+", re.IGNORECASE)
_COOKIE = re.compile(
    r"(?P<prefix>\b(?:set[-_])?cookie\b[\"']?\s*[:=]\s*)"
    r'''(?P<value>"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]*)''',
    re.IGNORECASE,
)
_XC_PATH = re.compile(
    r"(?P<prefix>/(?:live|movie|series|timeshift)/)"
    r"[^/\s?\"']+/[^/\s?\"']+",
    re.IGNORECASE,
)
_SQL_WRITE = re.compile(
    r"\b(?:INSERT\s+INTO|UPDATE)\b[^\r\n]*"
    r"\b(?:username|password|passwd|api_key|access_token|refresh_token)\b[^\r\n]*",
    re.IGNORECASE,
)


def _replace_value(match):
    value = match.group("value")
    if value[:1] in ('"', "'"):
        quote = value[0]
        value = f"{quote}{REDACTED}{quote}"
    else:
        value = REDACTED
    return match.group("prefix") + value


def redact_log_text(text):
    """Remove URLs, labelled credentials, auth tokens and XC path credentials.

    Labels and error/status information remain useful. Unlabelled arbitrary
    text cannot be identified as a secret; callers must not log raw payloads.
    """
    text = _SQL_WRITE.sub("[REDACTED credential SQL statement]", text)
    text = _URL.sub(REDACTED, text)
    text = _COOKIE.sub(_replace_value, text)
    text = _CLI.sub(_replace_value, text)
    text = _FIELD.sub(_replace_value, text)
    text = _AUTH.sub(lambda match: match.group(1) + " " + REDACTED, text)
    return _XC_PATH.sub(
        lambda match: match.group("prefix") + REDACTED + "/" + REDACTED,
        text,
    )


def redact_log_bytes(data):
    # Latin-1 is a reversible byte mapping; leave unrelated bytes untouched.
    return redact_log_text(data.decode("latin-1")).encode("latin-1")


def redacted_log_lines(stream, max_line_bytes=MAX_LINE_BYTES):
    """Yield redacted lines with bounded memory, including a final fragment.

    A record beyond the bound is redacted up to that point; its continuation is
    omitted so a credential split across input chunks can never escape alone.
    Ordinary records (including large tracebacks) are not truncated here.
    """
    skipping = False
    while True:
        chunk = stream.readline(max_line_bytes)
        if not chunk:
            return
        complete = chunk.endswith(b"\n")
        if skipping:
            skipping = not complete
            continue
        oversized = not complete and len(chunk) == max_line_bytes
        redacted = redact_log_bytes(chunk)
        if oversized:
            redacted += _OVERSIZE_NOTICE
            skipping = True
        yield redacted
