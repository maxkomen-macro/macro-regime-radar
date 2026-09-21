"""api/recession_cache.py — the recession model's results, as the API serves them.

src.analytics.recession.get_recession_metrics() trains a LogisticRegression
in-process on every call (there is no model artifact on disk). Since
fix/prelaunch-1 the background worker (api/worker.py) does that once per
database generation, off the request path: the "recession" item holds the
metrics converted here to JSON-serializable point lists, and the
"recession_model" item the fitted model the sensitivity POST scores against.
Both are rebuilt whenever the database file key moves (B-H1), replacing the
15-minute TTL caches that outlived a swap.

Note: this returns the *recession model's* probability
(src/analytics/recession.py), which is a different number from the regime
classifier's `regimes.prob_recession` column.
"""

from __future__ import annotations

import pandas as pd

_SERIES_KEYS = ("recession_prob_series", "yield_curve_series", "usrec_series")


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
    from api.worker import get_worker

    return get_worker().result("recession")


def peek_baseline_prob() -> float | None:
    """The published generation's headline probability, for the sensitivity
    POST's delta readout: the same generation the model came from, never a
    retrain. None before the first generation or when the model has no data."""
    from api.worker import get_worker

    gen = get_worker().current
    data = gen.results.get("recession") if gen is not None else None
    return data.get("recession_prob") if isinstance(data, dict) else None


# ── Sensitivity scoring (against the generation's fitted model) ──────────────
# The Streamlit sensitivity panel recomputes probability from user-set inputs
# against the fitted LogisticRegression + StandardScaler
# (dashboard/components/recession_tab.py:590-601). The worker fits it once per
# generation; the POST only scores.


def _get_cached_model():
    from api.worker import get_worker

    return get_worker().result("recession_model")


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
