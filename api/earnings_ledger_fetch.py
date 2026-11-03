"""api/earnings_ledger_fetch.py — one bounded GitHub request for the earnings ledger reader (design LR 2, 2.2).

Run only as a child process by api/earnings_ledger_reader.py, by absolute path with `python -I` (DR-34), so the
parent can always kill it at its deadline, whatever stage the request is in (DNS included, DR-32):

    python -I /app/api/earnings_ledger_fetch.py list <release URL> <deadline s>
    python -I /app/api/earnings_ledger_fetch.py asset <asset API URL> <deadline s>

It imports only the standard library and httpx: `-I` keeps the checkout off sys.path. The token is read from the
environment (GH_DB_TOKEN), never from argv. stdout carries the result only; nothing is logged.

Exit codes (DR-35): 0 success (stdout: for `list`, a JSON list of {"name", "id"}; for `asset`, the bytes);
20 confirmed invalid and 30 transient (stdout: one reason word). The parent treats any other outcome as transient.
"""

import json
import math
import os
import signal
import sys

OK, INVALID, TRANSIENT = 0, 20, 30
MAX_ASSET = 8 * 1024 * 1024  # bytes (design LR 2)
MAX_LISTING = 4 * 1024 * 1024
CHUNK = 64 * 1024


def _out(code: int, payload: bytes) -> int:
    sys.stdout.buffer.write(payload)
    sys.stdout.buffer.flush()
    return code


def classify(op: str, status: int, headers) -> tuple[int, str]:
    """A non-200 response's typed result (design LR 2.2)."""
    if status == 401:
        return INVALID, "unauthorized"
    if status == 403:
        if headers.get("x-ratelimit-remaining") == "0" or headers.get("retry-after") is not None:
            return TRANSIENT, "rate_limited"
        return INVALID, "forbidden"
    if status == 404:
        return (INVALID, "missing") if op == "list" else (TRANSIENT, "gone")
    if status == 410 and op == "asset":
        return TRANSIENT, "gone"
    return TRANSIENT, f"status_{int(status)}"


def _read(resp, cap: int) -> bytes | None:
    """The body, or None once it passes `cap`."""
    buf = bytearray()
    for chunk in resp.iter_bytes(CHUNK):
        buf += chunk
        if len(buf) > cap:
            return None
    return bytes(buf)


def main(argv: list[str]) -> int:
    try:
        op, url, deadline = argv[1], argv[2], float(argv[3])
        if op not in ("list", "asset") or not math.isfinite(deadline) or deadline <= 0:
            raise ValueError
    except (IndexError, ValueError):
        return _out(TRANSIENT, b"usage")
    if hasattr(signal, "alarm"):
        signal.alarm(int(math.ceil(deadline)) + 2)  # dies on its own if the parent is gone (design LR 2)
    token = os.environ.get("GH_DB_TOKEN", "").strip()
    if not token:
        return _out(INVALID, b"unauthorized")
    import httpx

    headers = {"Authorization": f"Bearer {token}", "User-Agent": "macro-regime-radar-api",
               "Accept": "application/vnd.github+json" if op == "list" else "application/octet-stream"}
    try:
        with httpx.Client(timeout=10.0, follow_redirects=True, max_redirects=3) as client:
            with client.stream("GET", url, headers=headers) as resp:
                if resp.status_code != 200:
                    code, word = classify(op, resp.status_code, resp.headers)
                    return _out(code, word.encode())
                if op == "asset":
                    body = _read(resp, MAX_ASSET)
                    return _out(INVALID, b"oversized") if body is None else _out(OK, body)
                body = _read(resp, MAX_LISTING)
    except Exception:  # noqa: BLE001 — timeouts, DNS, TLS, redirects: transient, with no detail
        return _out(TRANSIENT, b"network")
    try:
        assets = json.loads(body).get("assets") if body is not None else None
        if not isinstance(assets, list):
            raise ValueError
        listing = [{"name": str(a["name"]), "id": int(a["id"])} for a in assets]
    except (ValueError, TypeError, KeyError, AttributeError):
        return _out(INVALID, b"malformed")
    return _out(OK, json.dumps(listing).encode())


if __name__ == "__main__":
    sys.exit(main(sys.argv))
