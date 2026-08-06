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
    Return the stored softmax regime probabilities as floats (0–1) for the most
    recent month, read from the regimes table's prob_* columns (written by
    src/regime.py). Falls back to a confidence-based approximation only for
    legacy rows where the prob_* columns are NULL.

    Keys: 'goldilocks', 'overheating', 'stagflation', 'recession_risk'
    """
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT label, confidence, prob_goldilocks, prob_overheating, "
            "prob_stagflation, prob_recession "
            "FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
        if not row:
            return {k.lower().replace(" ", "_"): 0.25 for k in REGIME_BASE_RATES}

        stored = {
            "goldilocks":     row["prob_goldilocks"],
            "overheating":    row["prob_overheating"],
            "stagflation":    row["prob_stagflation"],
            "recession_risk": row["prob_recession"],
        }
        if all(v is not None for v in stored.values()):
            return {k: round(float(v), 4) for k, v in stored.items()}

        # Legacy fallback: prob_* columns NULL — approximate from confidence
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
