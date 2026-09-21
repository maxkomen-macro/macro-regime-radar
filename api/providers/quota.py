"""api/providers/quota.py — what this process spends at EODHD (launch-1).

The plan is metered in "API calls", and the weights differ by endpoint. From
EODHD's published limits page, read 2026-09-21:

    End-of-day, splits/dividends, search, exchanges, calendar   1 call
    Live (delayed) quotes                                       1 call per symbol
    Intraday                                                    5 calls
    Fundamentals                                                10 calls
    Marketplace products (the options chain)                    10 calls, separate quota
    WebSocket                                                   none

Idle, almost all of it goes on timers: the relay's delayed-quote sweep and VIX
poll, and the market prefetch. Counting it in the process is what lets the
runbook state a daily figure from the deployment itself rather than from a
measurement session, and what makes the session-aware cadence (launch-1,
item 5) checkable after it ships. Counts and paths only: no query strings, so
no token can pass through here.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

# Marketplace products bill against a separate allowance; counted here too, and
# reported separately so the daily figure is not overstated.
MARKETPLACE_PREFIX = "/mp/"

_WEIGHTS: tuple[tuple[str, int], ...] = (
    ("/intraday/", 5),
    ("/fundamentals/", 10),
    ("/mp/", 10),
    ("/technical/", 5),
    ("/bulk-", 100),
    ("/eod/", 1),
    ("/div/", 1),
    ("/splits/", 1),
    ("/search/", 1),
    ("/exchange-details/", 1),
    ("/exchanges-list", 1),
    ("/ticks", 1),
)

_lock = threading.Lock()
_since_mono = time.monotonic()
_since_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
_requests = 0
_units = 0
_by_family: dict[str, dict[str, int]] = {}
_marketplace_units = 0


def weight_for(path: str, tickers: int = 1) -> int:
    """API calls one request costs. `tickers` is the count in a delayed-quote
    request, which bills per symbol."""
    if "/real-time/" in path:
        return max(1, int(tickers))
    for prefix, weight in _WEIGHTS:
        if prefix in path:
            return weight
    return 1


def record(path: str, *, family: str = "other", tickers: int = 1) -> int:
    """Count one upstream call. Returns the units it cost."""
    global _requests, _units, _marketplace_units
    units = weight_for(path, tickers)
    with _lock:
        _requests += 1
        _units += units
        if MARKETPLACE_PREFIX in path:
            _marketplace_units += units
        slot = _by_family.setdefault(family, {"requests": 0, "units": 0})
        slot["requests"] += 1
        slot["units"] += units
    return units


def snapshot(elapsed_override_s: float | None = None) -> dict:
    """Totals since the process started (or the last reset), with the rate they
    imply. The projection is a straight extrapolation: honest for the timers
    that dominate an idle deploy, and stated as a projection for the rest."""
    with _lock:
        elapsed = elapsed_override_s if elapsed_override_s is not None else max(1e-6, time.monotonic() - _since_mono)
        hours = elapsed / 3600.0
        return {
            "since": _since_iso,
            "elapsed_s": round(elapsed, 1),
            "requests": _requests,
            "units": _units,
            "marketplace_units": _marketplace_units,
            "by_family": {k: dict(v) for k, v in sorted(_by_family.items())},
            "units_per_hour": round(_units / hours, 1) if hours > 0 else 0.0,
            "units_per_day_projected": round(_units / hours * 24, 1) if hours > 0 else 0.0,
            "requests_per_hour": round(_requests / hours, 1) if hours > 0 else 0.0,
        }


def reset() -> None:
    global _requests, _units, _marketplace_units, _since_mono, _since_iso, _by_family
    with _lock:
        _requests = 0
        _units = 0
        _marketplace_units = 0
        _by_family = {}
        _since_mono = time.monotonic()
        _since_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
