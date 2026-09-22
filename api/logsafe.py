"""api/logsafe.py — keep provider tokens out of every log line (2026-09-06).

httpx logs "HTTP Request: GET <full url>" at INFO, and EODHD authenticates
with an api_token query parameter, so a bare basicConfig(INFO) would print
the token on every provider call. Two layers: the httpx/httpcore loggers are
held at WARNING, and a redaction filter on every handler rewrites any
api_token/token/api_key query value, signed-URL credential or Bearer header
that still slips through, in the rendered message and in the traceback.
"""

from __future__ import annotations

import logging
import re

_PATTERNS = [
    re.compile(r"(api_token=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(api_key=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(token=)[^&\s\"']+", re.IGNORECASE),
    # Signed download URLs (GitHub's release-asset CDN and S3-style links):
    # credentials valid for minutes, never for a log (launch-1 verify loop 1).
    re.compile(r"((?:sig|jwt|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+"),
]


def redact(text: str) -> str:
    for pat in _PATTERNS:
        text = pat.sub(r"\1***", text)
    return text


def _redact_arg(value):
    """One logging argument, redacted without changing its shape: numbers and
    None pass through (a %d still needs an int), anything else is compared as
    text and replaced by the redacted text only when redaction changed it
    (httpx passes the URL as an httpx.URL, not a str)."""
    if value is None or isinstance(value, (bool, int, float)):
        return value
    text = value if isinstance(value, str) else str(value)
    red = redact(text)
    return red if red != text else value


class RedactingFilter(logging.Filter):
    """Redacts the message, each of its arguments and uvicorn's colour copy of
    it, keeping the arguments' shape: formatters such as uvicorn's access
    formatter unpack them (launch-1 verify loop 2: clearing them lost every
    access line). Tracebacks and stack text are redacted as a formatter would
    print them."""

    _formatter = logging.Formatter()

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.args, dict):
                record.args = {k: _redact_arg(v) for k, v in record.args.items()}
            elif isinstance(record.args, tuple):
                record.args = tuple(_redact_arg(a) for a in record.args)
            elif isinstance(record.msg, str):
                # A message with no arguments is its own text. A template is
                # never rewritten: "api_token=%s" would lose its placeholder.
                record.msg = redact(record.msg)
            colour = getattr(record, "color_message", None)
            if isinstance(colour, str) and not record.args:
                record.color_message = redact(colour)
            # The last net (verify loop 3 follow-up): a key in the template
            # with the secret as its own argument, or an exception passed as
            # the message. Only when the rendered text still carries one is
            # the record flattened to its redacted text.
            rendered = record.getMessage()
            if redact(rendered) != rendered:
                record.msg, record.args = redact(rendered), None
                if hasattr(record, "color_message"):
                    record.color_message = record.msg
        except Exception:  # noqa: BLE001 — a filter must never break logging
            pass
        try:
            if record.exc_info and not record.exc_text:
                record.exc_text = self._formatter.formatException(record.exc_info)
            if record.exc_text:
                record.exc_text = redact(record.exc_text)
            if record.stack_info:
                record.stack_info = redact(record.stack_info)
        except Exception:  # noqa: BLE001
            pass
        return True


_installed = False


def install() -> None:
    """Idempotent: quiet httpx and attach the redaction filter to every root
    handler (and to handlers added later via a logging.Logger subclass hook)."""
    global _installed
    for name in ("httpx", "httpcore", "httpcore.http11", "httpcore.connection"):
        logging.getLogger(name).setLevel(logging.WARNING)
    flt = RedactingFilter()
    # Every handler that already exists, not only the root's: uvicorn builds
    # its handlers from its logging config before the app is imported
    # (launch-1 verify loop 1).
    loggers = [logging.getLogger()] + [lg for lg in logging.Logger.manager.loggerDict.values() if isinstance(lg, logging.Logger)]
    for lg in loggers:
        for h in lg.handlers:
            if not any(isinstance(f, RedactingFilter) for f in h.filters):
                h.addFilter(flt)
    if not _installed:
        _installed = True
        # Handlers added after install() (uvicorn's, a test's caplog) get the
        # filter too — wrap Logger.addHandler once.
        original = logging.Logger.addHandler

        def add_handler(self: logging.Logger, hdlr: logging.Handler) -> None:
            if not any(isinstance(f, RedactingFilter) for f in hdlr.filters):
                hdlr.addFilter(RedactingFilter())
            original(self, hdlr)

        logging.Logger.addHandler = add_handler  # type: ignore[method-assign]
