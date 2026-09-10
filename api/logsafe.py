"""api/logsafe.py — keep provider tokens out of every log line (2026-09-06).

httpx logs "HTTP Request: GET <full url>" at INFO, and EODHD authenticates
with an api_token query parameter, so a bare basicConfig(INFO) would print
the token on every provider call. Two layers: the httpx/httpcore loggers are
held at WARNING, and a redaction filter on the root logger rewrites any
api_token/token/api_key query value or Bearer header that still slips
through, in the message and in its args.
"""

from __future__ import annotations

import logging
import re

_PATTERNS = [
    re.compile(r"(api_token=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(api_key=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(token=)[^&\s\"']+", re.IGNORECASE),
    re.compile(r"(Bearer\s+)[A-Za-z0-9._\-]+"),
]


def redact(text: str) -> str:
    for pat in _PATTERNS:
        text = pat.sub(r"\1***", text)
    return text


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                record.msg = redact(record.msg)
            if record.args:
                if isinstance(record.args, dict):
                    record.args = {k: redact(v) if isinstance(v, str) else v for k, v in record.args.items()}
                else:
                    record.args = tuple(redact(a) if isinstance(a, str) else a for a in record.args)
        except Exception:  # noqa: BLE001 — a filter must never break logging
            pass
        return True


_installed = False


def install() -> None:
    """Idempotent: quiet httpx and attach the redaction filter to every root
    handler (and to handlers added later via a logging.Logger subclass hook)."""
    global _installed
    for name in ("httpx", "httpcore", "httpcore.http11", "httpcore.connection"):
        logging.getLogger(name).setLevel(logging.WARNING)
    root = logging.getLogger()
    flt = RedactingFilter()
    for h in root.handlers:
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
