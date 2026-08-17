"""api/recession_cache.py — TTL-cached, JSON-safe wrapper around the recession model.

src.analytics.recession.get_recession_metrics() trains a LogisticRegression
in-process on every call (there is no model artifact on disk) — the Streamlit
tab hides that behind @st.cache_resource. This module gives the FastAPI layer
the same protection with a simple module-level TTL cache, and converts the
pandas Series members of the metrics dict into JSON-serializable point lists.

Deliberate deviation from api/db.py's strict read-only contract: recession.py
opens its own read-write SQLite connection (WAL pragma). Accepted — identical
to what the Streamlit dashboard has always done. See CLAUDE.md.

Note: this returns the *recession model's* probability
(src/analytics/recession.py), which is a different number from the regime
classifier's `regimes.prob_recession` column.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import pandas as pd

from src.analytics.recession import get_recession_metrics

TTL_SECONDS = 900  # match the dashboard's @st.cache_resource(ttl=900) posture

_SERIES_KEYS = ("recession_prob_series", "yield_curve_series", "usrec_series")

_cache: dict[str, Any] = {"at": 0.0, "data": None}
# Single-flight locks — a cold /api/recession/probability racing a cold
# /api/regime/intelligence must not train the model twice.
_cache_lock = threading.Lock()
_model_lock = threading.Lock()


def _series_to_points(s: pd.Series) -> list[dict]:
    return [
        {"date": idx.strftime("%Y-%m-%d"), "value": float(v)}
        for idx, v in s.items()
        if pd.notna(v)
    ]


def _to_jsonable(metrics: dict) -> dict:
    out = {
        "probability_source": "recession_model",  # not regimes.prob_recession
        "current_inputs": {
            "unrate": metrics.get("_current_unrate"),
            "hy_oas": metrics.get("_current_hy_oas"),
            "indpro_yoy": metrics.get("_current_indpro_yoy"),
            "lei": metrics.get("_current_lei"),
        },
    }
    for key, value in metrics.items():
        if key.startswith("_"):
            continue
        out[key] = _series_to_points(value) if key in _SERIES_KEYS else value
    return out


def get_cached_recession_metrics() -> dict:
    with _cache_lock:
        now = time.monotonic()
        if _cache["data"] is None or now - _cache["at"] > TTL_SECONDS:
            _cache["data"] = _to_jsonable(get_recession_metrics())
            _cache["at"] = now
        return _cache["data"]


def peek_baseline_prob() -> float | None:
    """The last computed headline probability WITHOUT triggering a (re)train —
    the sensitivity POST wants a reference number, not a mid-drag training
    pause. Stale-by-≤TTL is acceptable for a delta readout; None if no
    metrics have been computed yet this process."""
    with _cache_lock:
        data = _cache["data"]
    return data.get("recession_prob") if data else None


# ── Sensitivity scoring (the trained model itself, cached) ───────────────────
# The Streamlit sensitivity panel recomputes probability from user-set inputs
# against the fitted LogisticRegression + StandardScaler
# (dashboard/components/recession_tab.py:590-601). The model trains in-process
# (no artifact on disk), so it gets the same TTL treatment as the metrics.

_model_cache: dict[str, Any] = {"at": 0.0, "data": None}


def _get_cached_model():
    from src.analytics.recession import train_recession_model

    with _model_lock:
        now = time.monotonic()
        if _model_cache["data"] is None or now - _model_cache["at"] > TTL_SECONDS:
            _model_cache["data"] = train_recession_model()
            _model_cache["at"] = now
        return _model_cache["data"]


def score_recession_scenario(
    yield_curve_bps: float,
    unemployment: float,
    hy_oas_bps: float,
    indpro_yoy: float,
    lei: float,
) -> float | None:
    """Probability (0–100) for user-set inputs — the exact recession_tab math:
    yield curve arrives in bps and is divided by 100 to match the training
    units; everything else passes through the fitted scaler as-is. The feature
    vector is assembled BY NAME from the trained feature order, so a reorder
    in train_recession_model can never silently swap inputs."""
    import numpy as np

    model, scaler, features = _get_cached_model()
    if model is None or scaler is None:
        return None
    by_name = {
        "yield_curve": yield_curve_bps / 100.0,  # bps → % to match training units
        "unemployment": unemployment,
        "hy_spread": hy_oas_bps,
        "indpro_yoy": indpro_yoy,
        "lei_proxy": lei,
    }
    try:
        x = np.array([[by_name[f] for f in features]])
    except KeyError:
        return None  # feature set drifted — refuse to guess an ordering
    x_scaled = scaler.transform(x)
    classes = list(model.classes_)
    if 1 not in classes:
        return None  # no positive class trained — a probability would be fiction
    rec_idx = classes.index(1)
    return float(model.predict_proba(x_scaled)[0, rec_idx]) * 100.0
