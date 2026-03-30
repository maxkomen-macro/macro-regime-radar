"""
src/analytics/regimes.py — Regime probability helpers.

Standalone module (no src.config imports — avoids FRED_API_KEY EnvironmentError).

Primary entry point:
    from src.analytics.regimes import get_current_regime_probs
    probs = get_current_regime_probs()
    # Returns: {"goldilocks": 0.19, "overheating": 0.59, ...}
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

# Historical base rates (proportion of months in each regime, ~1996–present)
REGIME_BASE_RATES: dict[str, float] = {
    "Goldilocks":    0.30,
    "Overheating":   0.35,
    "Stagflation":   0.20,
    "Recession Risk": 0.15,
}


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def get_current_regime_probs() -> dict[str, float]:
    """
    Return approximate regime probabilities as floats (0–1) for the most recent month.

    Since exact softmax probabilities are not stored in the regimes table, we derive
    them from the stored confidence score using historical base rates as priors.

    Keys: 'goldilocks', 'overheating', 'stagflation', 'recession_risk'
    """
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT label, confidence FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {k.lower().replace(" ", "_"): 0.25 for k in REGIME_BASE_RATES}

        label = row["label"]
        confidence = float(row["confidence"])

        remaining = 1.0 - confidence
        other_total = sum(v for k, v in REGIME_BASE_RATES.items() if k != label)

        probs: dict[str, float] = {}
        for regime, base in REGIME_BASE_RATES.items():
            key = regime.lower().replace(" ", "_")
            if regime == label:
                probs[key] = round(confidence, 4)
            else:
                probs[key] = round((base / other_total) * remaining, 4)
        return probs
    finally:
        conn.close()
