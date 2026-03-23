"""
src/analytics/credit.py — Credit spread analytics using BAML/ICE BofA OAS indices.

Standalone module — does NOT import src.config (avoids FRED_API_KEY EnvironmentError).

Data source: raw_series table (populated by python main.py after adding CREDIT_SERIES
to src/config.py).

Primary entry point:
    from src.analytics.credit import get_credit_metrics
    m = get_credit_metrics()

Returns a dict with:
  hy_oas, ig_oas, ccc_oas, bb_oas, b_oas   — latest values in bps (float | None)
  hy_1w_change, ig_1w_change, ...           — 5-business-day change in bps (float | None)
  hy_ig_ratio                               — hy_oas / ig_oas (float | None)
  distress_ratio                            — ccc_oas / 1000 * 100 as % (float | None)
  lbo_all_in_cost                           — (FEDFUNDS + hy_oas/100) as "X.XX%" (str | None)
  credit_label                              — "Normal" | "Tight" | "Stressed" | "Crisis" | "No data"
  credit_label_color                        — hex color for label
  hy_pct_rank, ig_pct_rank                 — 0-100 percentile rank in full history (int | None)
  hy_series, ig_series                      — full pd.Series with DatetimeIndex (for charting)
  data_as_of                                — date string of most recent HY OAS observation
  transition_3m, transition_6m             — {state: {state: probability}} dicts
"""

import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd

ROOT    = Path(__file__).resolve().parent.parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

LOOKBACK_YEARS = 30

CREDIT_STATES = ["Normal", "Tight", "Stressed", "Crisis"]

_LABEL_COLORS = {
    "Normal":  "#2ecc71",
    "Tight":   "#3498db",
    "Stressed": "#e67e22",
    "Crisis":  "#e74c3c",
    "No data": "#8b949e",
}


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _load_series(series_id: str, conn: sqlite3.Connection, scale: float = 1.0) -> pd.Series:
    """
    Load a raw_series by FRED series_id.
    Returns pd.Series with DatetimeIndex, sorted ascending, NaN dropped.
    Empty Series if no data.

    scale: multiply all values by this factor. Use scale=100 for BAML OAS series
           which FRED stores as percentage (e.g. 3.27) but we want basis points (327).
    """
    rows = conn.execute(
        "SELECT date, value FROM raw_series WHERE series_id=? ORDER BY date",
        (series_id,),
    ).fetchall()
    if not rows:
        return pd.Series(dtype=float, name=series_id)
    df = pd.DataFrame(rows, columns=["date", "value"])
    df = df.assign(date=pd.to_datetime(df["date"])).set_index("date").sort_index()
    s = df["value"].dropna()
    if scale != 1.0:
        s = s * scale
    s.name = series_id
    return s


def _load_fedfunds(conn: sqlite3.Connection) -> float | None:
    """Return the most recent FEDFUNDS value from raw_series."""
    row = conn.execute(
        "SELECT value FROM raw_series WHERE series_id='FEDFUNDS' ORDER BY date DESC LIMIT 1"
    ).fetchone()
    return float(row[0]) if row and row[0] is not None else None


# ─────────────────────────────────────────────────────────────────────────────
# Analytics helpers
# ─────────────────────────────────────────────────────────────────────────────

def _pct_rank(series: pd.Series, current_val: float) -> int:
    """
    Percentile rank of current_val in the full series history.
    Returns integer 0-100.
    """
    if series.empty:
        return 50
    return int(round((series.values < current_val).mean() * 100))


def _classify(hy_oas: float, ig_oas: float | None) -> tuple[str, str]:
    """
    Classify credit conditions into one of four states.
    Returns (label, color).
    """
    if hy_oas > 700:
        return "Crisis", _LABEL_COLORS["Crisis"]
    elif hy_oas > 400:
        return "Stressed", _LABEL_COLORS["Stressed"]
    elif ig_oas is not None and ig_oas > 150:
        return "Tight", _LABEL_COLORS["Tight"]
    else:
        return "Normal", _LABEL_COLORS["Normal"]


def _classify_hy_only(hy_oas: float, ig_oas: float | None = None) -> str:
    """
    Classify using HY + optional IG OAS.
    Mirrors _classify() but returns only the label string (no color).
    """
    label, _ = _classify(hy_oas, ig_oas)
    return label


def _transition_matrix(hy_series: pd.Series, ig_series: pd.Series | None = None) -> tuple[dict, dict]:
    """
    Compute credit state transition matrices for 3-month and 6-month horizons.

    Uses monthly OAS data (data is already monthly from FRED pipeline).
    Classifies each month into a credit state using _classify() with both HY and IG.
    For each observation at month i, records the state at i+3 and i+6.

    Returns (transition_3m, transition_6m) where each is:
        {from_state: {to_state: probability_float}}

    Returns ({}, {}) if fewer than 60 monthly observations exist.
    """
    if hy_series.empty:
        return {}, {}

    monthly = hy_series.resample("ME").last().dropna()
    if len(monthly) < 60:
        return {}, {}

    # Align IG series if available
    if ig_series is not None and not ig_series.empty:
        ig_monthly = ig_series.resample("ME").last().dropna()
        ig_aligned = ig_monthly.reindex(monthly.index)
    else:
        ig_aligned = pd.Series(index=monthly.index, dtype=float)

    # Classify all months using full _classify() logic
    states = [
        _classify_hy_only(float(hy), float(ig) if not pd.isna(ig) else None)
        for hy, ig in zip(monthly.values, ig_aligned.values)
    ]
    n = len(states)

    results = {}
    for horizon in (3, 6):
        # Count transitions: from_state → to_state
        counts: dict[str, dict[str, int]] = {s: {t: 0 for t in CREDIT_STATES} for s in CREDIT_STATES}
        for i in range(n - horizon):
            from_s = states[i]
            to_s   = states[i + horizon]
            counts[from_s][to_s] += 1

        # Convert to probabilities
        probs: dict[str, dict[str, float]] = {}
        for from_s in CREDIT_STATES:
            row_total = sum(counts[from_s].values())
            probs[from_s] = {}
            for to_s in CREDIT_STATES:
                try:
                    probs[from_s][to_s] = round(counts[from_s][to_s] / row_total, 4) if row_total > 0 else 0.0
                except ZeroDivisionError:
                    probs[from_s][to_s] = 0.0
        results[horizon] = probs

    return results.get(3, {}), results.get(6, {})


# ─────────────────────────────────────────────────────────────────────────────
# Main entry point
# ─────────────────────────────────────────────────────────────────────────────

def _empty_metrics() -> dict:
    """Return a safe all-None dict for when BAML data is unavailable."""
    return {
        "hy_oas":           None,
        "ig_oas":           None,
        "ccc_oas":          None,
        "bb_oas":           None,
        "b_oas":            None,
        "hy_1w_change":     None,
        "ig_1w_change":     None,
        "ccc_1w_change":    None,
        "bb_1w_change":     None,
        "b_1w_change":      None,
        "hy_ig_ratio":      None,
        "distress_ratio":   None,
        "lbo_all_in_cost":  None,
        "credit_label":     "No data",
        "credit_label_color": _LABEL_COLORS["No data"],
        "hy_pct_rank":      None,
        "ig_pct_rank":      None,
        "hy_series":        pd.Series(dtype=float),
        "ig_series":        pd.Series(dtype=float),
        "data_as_of":       None,
        "transition_3m":    {},
        "transition_6m":    {},
        "tight_count":      0,
    }


def get_credit_metrics() -> dict:
    """
    Compute all credit spread metrics from raw_series.

    Returns a dict with all metrics. If BAML series are not yet in the DB,
    returns a safe fallback dict with all numeric values as None and
    credit_label = "No data" — the dashboard will not crash.
    """
    conn = _get_conn()
    try:
        # FRED stores BAML OAS as percent (e.g. 3.27 = 327 bps) — scale × 100
        hy_s   = _load_series("BAMLH0A0HYM2", conn, scale=100.0)
        ig_s   = _load_series("BAMLC0A0CM",   conn, scale=100.0)
        ccc_s  = _load_series("BAMLH0A3HYC",  conn, scale=100.0)
        bb_s   = _load_series("BAMLH0A1HYBB", conn, scale=100.0)
        b_s    = _load_series("BAMLH0A2HYB",  conn, scale=100.0)
        fedfunds = _load_fedfunds(conn)
    finally:
        conn.close()

    # ── Graceful fallback if no data ─────────────────────────────────────────
    if hy_s.empty:
        return _empty_metrics()

    # ── Latest values ────────────────────────────────────────────────────────
    def _latest(s: pd.Series) -> float | None:
        return float(s.iloc[-1]) if not s.empty else None

    hy_oas  = _latest(hy_s)
    ig_oas  = _latest(ig_s)
    ccc_oas = _latest(ccc_s)
    bb_oas  = _latest(bb_s)
    b_oas   = _latest(b_s)

    # ── 1-month changes (FRED pipeline resamples everything to monthly) ─────
    # iloc[-2] = previous month's value
    def _1w_chg(s: pd.Series) -> float | None:
        if len(s) >= 2:
            return float(s.iloc[-1] - s.iloc[-2])
        return None

    # ── Derived metrics ───────────────────────────────────────────────────────
    hy_ig_ratio = round(hy_oas / ig_oas, 2) if (hy_oas and ig_oas and ig_oas != 0) else None
    distress_ratio = round(ccc_oas / 1000 * 100, 1) if ccc_oas is not None else None

    # LBO all-in cost: FEDFUNDS (already in %) + HY OAS converted to %
    lbo_all_in_cost = None
    if fedfunds is not None and hy_oas is not None:
        lbo_val = fedfunds + hy_oas / 100
        lbo_all_in_cost = f"{lbo_val:.2f}%"

    # Credit regime classification
    credit_label, credit_label_color = _classify(hy_oas, ig_oas)

    # Percentile ranks
    hy_pct_rank = _pct_rank(hy_s, hy_oas) if hy_oas is not None else None
    ig_pct_rank = _pct_rank(ig_s, ig_oas) if ig_oas is not None else None

    # Data as-of date — cap to today so FRED end-of-month dates don't show future dates
    today = pd.Timestamp.today().normalize()
    valid_hy = hy_s[hy_s.index <= today]
    data_as_of = valid_hy.index[-1].strftime("%b %d, %Y") if not valid_hy.empty else None

    # Count historical months in Tight state (HY ≤ 400 bps AND IG > 150 bps)
    monthly_hy = hy_s.resample("ME").last().dropna()
    if not ig_s.empty:
        monthly_ig = ig_s.resample("ME").last().dropna().reindex(monthly_hy.index)
    else:
        monthly_ig = pd.Series(index=monthly_hy.index, dtype=float)
    tight_count = sum(
        1 for hy, ig in zip(monthly_hy.values, monthly_ig.values)
        if not pd.isna(hy) and not pd.isna(ig) and ig > 150 and hy <= 400
    )

    # Transition matrices (pass IG series so Tight state can be detected)
    transition_3m, transition_6m = _transition_matrix(hy_s, ig_s)

    return {
        "hy_oas":             hy_oas,
        "ig_oas":             ig_oas,
        "ccc_oas":            ccc_oas,
        "bb_oas":             bb_oas,
        "b_oas":              b_oas,
        "hy_1w_change":       _1w_chg(hy_s),
        "ig_1w_change":       _1w_chg(ig_s),
        "ccc_1w_change":      _1w_chg(ccc_s),
        "bb_1w_change":       _1w_chg(bb_s),
        "b_1w_change":        _1w_chg(b_s),
        "hy_ig_ratio":        hy_ig_ratio,
        "distress_ratio":     distress_ratio,
        "lbo_all_in_cost":    lbo_all_in_cost,
        "credit_label":       credit_label,
        "credit_label_color": credit_label_color,
        "hy_pct_rank":        hy_pct_rank,
        "ig_pct_rank":        ig_pct_rank,
        "hy_series":          hy_s,
        "ig_series":          ig_s,
        "data_as_of":         data_as_of,
        "transition_3m":      transition_3m,
        "transition_6m":      transition_6m,
        "tight_count":        tight_count,
    }


# ─────────────────────────────────────────────────────────────────────────────
# CLI runner (for testing)
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    m = get_credit_metrics()
    print(f"Credit label : {m['credit_label']}")
    print(f"HY OAS       : {m['hy_oas']} bps  (as of {m['data_as_of']})")
    print(f"IG OAS       : {m['ig_oas']} bps")
    print(f"CCC OAS      : {m['ccc_oas']} bps")
    print(f"HY 1W chg    : {m['hy_1w_change']} bps")
    print(f"HY/IG ratio  : {m['hy_ig_ratio']}")
    print(f"Distress %   : {m['distress_ratio']}%")
    print(f"LBO all-in   : {m['lbo_all_in_cost']}")
    print(f"HY pct rank  : {m['hy_pct_rank']}th percentile")
    print(f"IG pct rank  : {m['ig_pct_rank']}th percentile")
    if m["transition_3m"]:
        print(f"3M matrix states: {list(m['transition_3m'].keys())}")
    else:
        print("Transition matrix: insufficient data")
