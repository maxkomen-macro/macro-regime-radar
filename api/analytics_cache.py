"""api/analytics_cache.py — TTL-cached, JSON-safe wrappers around src/analytics
modules for the Regime Lab, Credit, and Tools endpoints.

Same posture as api/recession_cache.py (the established precedent): the source
computations stay in src/analytics/ — nothing quantitative is ported — and this
module only (a) shields the request path behind module-level TTL caches, and
(b) converts pandas/numpy members into JSON-serializable structures.

All wrapped modules are standalone (no src.config import, so no FRED_API_KEY
requirement): intelligence.py, credit.py, lbo.py, regimes.py. allocation.py is
the exception — it imports yfinance at module level and downloads return
histories over the network on every cold call (~30–60 s), so it is imported
lazily inside its cache and guarded with a long TTL + a single-flight lock.

Deliberate deviation, same as the recession cache: these src modules open their
own read-write SQLite connections (WAL pragma). Accepted — identical to what
the Streamlit dashboard has always done.
"""

from __future__ import annotations

import math
import threading
import time
from typing import Any, Callable

import numpy as np
import pandas as pd


# ── JSON conversion ───────────────────────────────────────────────────────────

def jsonable(obj: Any) -> Any:
    """Recursively convert pandas/numpy members to JSON-safe structures.

    - Series on a DatetimeIndex → [{"date": "YYYY-MM-DD", "value": float}]
    - Series on any other index → {str(key): value}
    - DataFrame → {"index": [...], "columns": [...], "data": [[...]]}
    - numpy scalars/arrays → Python scalars/lists; NaN/inf → None
    """
    if obj is None or isinstance(obj, (str, bool, int)):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return v if math.isfinite(v) else None
    if isinstance(obj, np.ndarray):
        return [jsonable(v) for v in obj.tolist()]
    if isinstance(obj, (pd.Timestamp,)):
        return obj.strftime("%Y-%m-%d")
    if isinstance(obj, pd.Series):
        if isinstance(obj.index, pd.DatetimeIndex):
            return [
                {"date": idx.strftime("%Y-%m-%d"), "value": jsonable(v)}
                for idx, v in obj.items()
                if pd.notna(v)
            ]
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, pd.DataFrame):
        return {
            "index": [jsonable(i) if not isinstance(i, str) else i for i in obj.index],
            "columns": [str(c) for c in obj.columns],
            "data": [[jsonable(v) for v in row] for row in obj.to_numpy().tolist()],
        }
    if isinstance(obj, dict):
        return {str(k): jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [jsonable(v) for v in obj]
    return str(obj)


# ── TTL cache (single-flight per cache) ──────────────────────────────────────

class _TTLCache:
    """Single-flight TTL cache with a short failure backoff (a raising
    compute() would otherwise re-attempt a 30–60 s download on every request).

    Lock-ordering note: the intelligence/analogue caches call into the credit
    and recession caches from INSIDE their compute() — that ordering (intel →
    credit/recession) must stay one-directional; a credit compute() that
    reached back into the intel cache would deadlock."""

    FAIL_BACKOFF_SECONDS = 30.0

    def __init__(self, ttl_seconds: float) -> None:
        self.ttl = ttl_seconds
        self._at = 0.0
        self._data: Any = None
        self._fail_at: float | None = None
        self._fail_exc: BaseException | None = None
        self._lock = threading.Lock()

    def get(self, compute: Callable[[], Any]) -> Any:
        with self._lock:
            now = time.monotonic()
            if self._data is None or now - self._at > self.ttl:
                if (
                    self._fail_at is not None
                    and now - self._fail_at < self.FAIL_BACKOFF_SECONDS
                    and self._fail_exc is not None
                ):
                    raise self._fail_exc
                try:
                    self._data = compute()
                    self._at = now
                    self._fail_at = None
                    self._fail_exc = None
                except BaseException as exc:
                    self._fail_at = now
                    self._fail_exc = exc
                    raise
            return self._data


# Monthly-cadence analytics; TTLs mirror the Streamlit cache postures
# (@st.cache_data ttl=3600 for credit/allocation, ttl=60–900 elsewhere).
_credit = _TTLCache(3600)
_intel = _TTLCache(900)
_duration = _TTLCache(900)
_transitions = _TTLCache(900)
_analogues = _TTLCache(900)
_allocation = _TTLCache(3600)


# ── Credit ───────────────────────────────────────────────────────────────────

def get_raw_credit_metrics() -> dict:
    """Uncoverted get_credit_metrics() result (pandas Series intact) — for
    functions that take the metrics dict as an input (takeaway, analogues)."""
    from src.analytics.credit import get_credit_metrics

    return _credit.get(get_credit_metrics)


def get_cached_credit_metrics() -> dict:
    return jsonable(get_raw_credit_metrics())


# ── Regime Lab: intelligence bundle ──────────────────────────────────────────

def _current_regime_label() -> str:
    from api import db

    row = db.latest_regime()
    return row["label"] if row else "Goldilocks"


def get_cached_takeaway() -> dict:
    """generate_market_takeaway with its inputs assembled exactly the way the
    Streamlit Intelligence tab assembles them (probs, label, credit metrics,
    recession-model probability)."""

    def compute() -> dict:
        from api import db
        from api.recession_cache import get_cached_recession_metrics
        from src.analytics.intelligence import generate_market_takeaway
        from src.analytics.regimes import get_current_regime_probs

        probs = get_current_regime_probs()
        label = _current_regime_label()
        credit = get_raw_credit_metrics()
        rec_prob = get_cached_recession_metrics().get("recession_prob")
        if rec_prob is None:
            # Never narrate a fabricated 0% — degrade to 503 instead.
            raise db.DBUnavailable("Recession model has no data — takeaway unavailable.")
        out = generate_market_takeaway(probs, label, credit, rec_prob)
        out["regime_probs"] = probs
        out["current_regime"] = label
        return jsonable(out)

    return _intel.get(compute)


def get_cached_duration() -> dict:
    from src.analytics.intelligence import get_regime_duration

    return _duration.get(lambda: jsonable(get_regime_duration()))


def get_cached_transitions() -> dict:
    from src.analytics.intelligence import get_transition_narrative

    return _transitions.get(
        lambda: jsonable(get_transition_narrative(_current_regime_label()))
    )


def get_cached_analogues() -> list[dict]:
    """find_historical_analogues fed with the same live inputs the Streamlit
    tab uses: current regime, HY-spread percentile, recession-model prob."""

    def compute() -> list[dict]:
        from api import db
        from api.recession_cache import get_cached_recession_metrics
        from src.analytics.intelligence import find_historical_analogues

        credit = get_raw_credit_metrics()
        rec_prob = get_cached_recession_metrics().get("recession_prob")
        hy_pct = credit.get("hy_pct_rank")
        if rec_prob is None or hy_pct is None:
            # The similarity scores are meaningless without their live inputs —
            # never substitute a median and caption it as measured.
            raise db.DBUnavailable("Analogue inputs unavailable (credit percentile / recession model).")
        return jsonable(
            find_historical_analogues(_current_regime_label(), hy_pct, rec_prob, 4)
        )

    return _analogues.get(compute)


def get_playbooks() -> dict:
    """All four static regime playbooks in one payload (reference content —
    the client's selector switches without a refetch)."""
    from src.analytics.intelligence import get_regime_playbook

    return {
        r: jsonable(get_regime_playbook(r))
        for r in ("Goldilocks", "Overheating", "Stagflation", "Recession Risk")
    }


def get_scenario_defs() -> list[dict]:
    """The five prebuilt scenario definitions, key included."""
    from src.analytics.intelligence import SCENARIOS

    return [{"key": k, **jsonable(v)} for k, v in SCENARIOS.items()]


def run_scenario_cached_inputs(
    scenario_key: str | None, custom_shocks: dict | None
) -> dict:
    """run_scenario is fast (reads the regimes table + arithmetic) — no TTL,
    every POST recomputes against the latest stored probabilities."""
    from src.analytics.intelligence import run_scenario

    return jsonable(run_scenario(scenario_key=scenario_key, custom_shocks=custom_shocks))


# ── Allocation (heavy: yfinance downloads on cold call) ──────────────────────

def get_cached_allocation() -> dict:
    """get_allocation_data() — ~30–60 s cold (network downloads via yfinance),
    then served from cache for an hour. The single-flight lock in _TTLCache
    keeps concurrent cold calls from doubling the download."""

    def compute() -> dict:
        from src.analytics.allocation import get_allocation_data

        return jsonable(get_allocation_data())

    return _allocation.get(compute)
