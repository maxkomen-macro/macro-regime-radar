"""Bounded EODHD entitlement probes, cached in-process (2026-09-06).

One tiny request per API family, run in the background at startup when a
token exists and re-run only after the TTL or on explicit refresh. Results
record capability, availability, HTTP status, a sanitized reason, coverage
metadata and the check time — never the token, never a payload. Live calls in
market.py also feed back here (a 403 on a real request marks the family
unavailable; a 200 marks it available), so the status page reflects reality
between probes without extra calls.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any

from api.providers import eodhd as eod
from api.providers.errors import MissingToken, ProviderError

log = logging.getLogger("mrr.providers.entitlements")

FAMILIES = [
    "historical",
    "intraday",
    "realtime",
    "search",
    "splits_dividends",
    "exchange_details",
    "fundamentals",
    "options",
    "ticks",
    "websocket",
]

TTL_SECONDS = 6 * 3600.0


@dataclass
class Entitlement:
    family: str
    available: bool | None  # None = not checked / unknown
    status: int | None
    reason: str
    coverage: dict[str, Any] = field(default_factory=dict)
    checked_at: str | None = None
    source: str = "probe"  # probe | live

    def as_dict(self) -> dict:
        return asdict(self)


_state: dict[str, Entitlement] = {}
_lock = threading.Lock()
_last_full_probe: float = 0.0


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _set(family: str, available: bool | None, status: int | None, reason: str, coverage: dict | None = None, source: str = "probe") -> Entitlement:
    ent = Entitlement(family, available, status, reason, coverage or {}, _now(), source)
    with _lock:
        _state[family] = ent
    return ent


def get(family: str) -> Entitlement | None:
    with _lock:
        return _state.get(family)


def snapshot() -> dict[str, dict]:
    with _lock:
        return {k: v.as_dict() for k, v in _state.items()}


def record_live(family: str, ok: bool, status: int | None, reason: str) -> None:
    """Feedback from a real request so status stays honest between probes."""
    _set(family, ok, status, reason, source="live")


def is_blocked(family: str) -> Entitlement | None:
    """A cached, still-fresh 'unavailable' verdict blocks the family without a
    call; anything else lets the call proceed."""
    ent = get(family)
    if ent is None or ent.available is not False or ent.checked_at is None:
        return None
    try:
        checked = datetime.strptime(ent.checked_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    if datetime.now(timezone.utc) - checked > timedelta(seconds=TTL_SECONDS):
        return None
    # A network-side failure is not an entitlement verdict.
    if ent.status in (401, 403) or ent.reason.startswith("missing_token"):
        return ent
    return None


def _probe_one(client: eod.EodhdClient, family: str) -> Entitlement:
    today = datetime.now(timezone.utc).date()
    week_ago = (today - timedelta(days=9)).isoformat()
    now_ts = int(time.time())
    try:
        if family == "historical":
            rows = client.eod("AAPL.US", from_=week_ago, to=today.isoformat())
            return _set(family, True, 200, "ok", {"sample_rows": len(rows)})
        if family == "intraday":
            rows = client.intraday("AAPL.US", interval="5m", from_ts=now_ts - 3 * 86400, to_ts=now_ts)
            return _set(family, True, 200, "ok" if rows else "ok_empty_window", {"sample_rows": len(rows)})
        if family == "realtime":
            rows = client.realtime("AAPL.US")
            return _set(family, True, 200, "ok", {"delay": "15-20 min (stocks); ~1 min FX"})
        if family == "search":
            rows = client.search("AAPL", limit=1)
            return _set(family, True, 200, "ok", {"sample_rows": len(rows)})
        if family == "splits_dividends":
            client.splits("AAPL.US", from_=f"{today.year - 1}-01-01")
            return _set(family, True, 200, "ok")
        if family == "exchange_details":
            d = client.exchange_details("US")
            return _set(family, True, 200, "ok", {"timezone": d.get("Timezone"), "is_open": d.get("isOpen")})
        if family == "fundamentals":
            client.fundamentals("AMZN.US", filter_="General::Code")
            return _set(family, True, 200, "ok")
        if family == "options":
            d = client.options_contracts("AAPL", limit=1, fields="contract,exp_date")
            n = len(d.get("data") or [])
            return _set(family, True, 200, "ok", {"end_of_day": True, "sample_rows": n})
        if family == "ticks":
            # A two-minute window on the most recent weekday morning, one row.
            d = today
            while d.weekday() >= 5:
                d -= timedelta(days=1)
            start = int(datetime(d.year, d.month, d.day, 14, 30, tzinfo=timezone.utc).timestamp())
            client.ticks("AAPL", from_ts=start, to_ts=start + 120, limit=1)
            return _set(family, True, 200, "ok", {"scope": "US equities", "units": "ts milliseconds"})
        if family == "websocket":
            return _set(family, None, None, "not_probed: verified by the relay feed state (/api/stream/debug)")
    except MissingToken:
        return _set(family, False, None, "missing_token")
    except ProviderError as exc:
        return _set(family, False, exc.status, f"{exc.kind}: {exc.public}")
    except Exception as exc:  # noqa: BLE001 — a probe must never take the app down
        return _set(family, False, None, f"error: {type(exc).__name__}")
    return _set(family, None, None, "unknown family")


def probe_all(client: eod.EodhdClient, *, force: bool = False, families: list[str] | None = None) -> dict[str, dict]:
    """Run the bounded probes once per TTL (or when forced). Thread-safe;
    concurrent callers wait for the running probe instead of re-probing."""
    global _last_full_probe
    with _lock:
        fresh = time.monotonic() - _last_full_probe < TTL_SECONDS
        if fresh and not force and _state:
            return {k: v.as_dict() for k, v in _state.items()}
        _last_full_probe = time.monotonic()
    if not client.token:
        for fam in FAMILIES:
            _set(fam, False if fam != "websocket" else None, None, "missing_token")
        return snapshot()
    for fam in families or FAMILIES:
        _probe_one(client, fam)
    log.info("entitlement probe complete: %s", {k: v.available for k, v in _state.items()})
    return snapshot()


def reset_for_tests() -> None:
    global _last_full_probe
    with _lock:
        _state.clear()
        _last_full_probe = 0.0
