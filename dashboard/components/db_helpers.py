"""
dashboard/components/db_helpers.py — Shared DB loaders for Trader Pack tables.

Standalone module (no src.config import).
All loaders use @st.cache_data(ttl=300) for 5-minute cache.
"""

import json
import sqlite3
from pathlib import Path

import pandas as pd
import streamlit as st

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "macro_radar.db"
PLAYBOOK_PATH = Path(__file__).resolve().parent.parent.parent / "output" / "playbook.json"

WATCHLIST_SYMBOLS = ["SPY", "QQQ", "IWM", "TLT", "HYG", "LQD", "UUP", "GLD", "USO"]
INTRADAY_SYMBOLS  = ["SPY", "QQQ"]


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@st.cache_data(ttl=300)
def _query(sql: str, params: tuple = ()) -> pd.DataFrame:
    conn = _get_conn()
    try:
        return pd.read_sql_query(sql, conn, params=params)
    finally:
        conn.close()


# ─────────────────────────────────────────────────────────────────────────────
# Raw series helpers
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=3600)
def fetch_raw_series_n(series_id: str, n_months: int = 24) -> tuple:
    """Return the last n_months values (oldest→newest) from raw_series as a tuple of floats."""
    df = _query(
        "SELECT value FROM raw_series WHERE series_id=? ORDER BY date DESC LIMIT ?",
        (series_id, n_months),
    )
    if df.empty:
        return ()
    return tuple(df["value"].iloc[::-1].dropna().tolist())


# ─────────────────────────────────────────────────────────────────────────────
# Availability checks
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def has_market_data() -> bool:
    """True if market_daily has at least one row."""
    try:
        conn = _get_conn()
        cur  = conn.execute("SELECT COUNT(*) FROM market_daily")
        n    = cur.fetchone()[0]
        conn.close()
        return n > 0
    except Exception:
        return False


@st.cache_data(ttl=300)
def has_table(table: str) -> bool:
    try:
        conn = _get_conn()
        cur  = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", (table,)
        )
        exists = cur.fetchone()[0] > 0
        if exists:
            cur2 = conn.execute(f"SELECT COUNT(*) FROM {table}")
            exists = cur2.fetchone()[0] > 0
        conn.close()
        return exists
    except Exception:
        return False


# ─────────────────────────────────────────────────────────────────────────────
# Market data loaders
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_market_daily(symbols: tuple | None = None) -> pd.DataFrame:
    """
    Load market_daily and compute 1D/1W/1M returns per symbol.
    Returns a DataFrame indexed by (symbol, date) with added return columns.
    """
    try:
        if symbols:
            placeholders = ",".join("?" * len(symbols))
            sql = f"SELECT symbol, date, open, high, low, close, volume, vwap FROM market_daily WHERE symbol IN ({placeholders}) ORDER BY symbol, date"
            df = _query(sql, tuple(symbols))
        else:
            df = _query("SELECT symbol, date, open, high, low, close, volume, vwap FROM market_daily ORDER BY symbol, date")
        if df.empty:
            return df
        df = df.assign(date=pd.to_datetime(df["date"]))
        # Compute returns per symbol
        result_parts = []
        for sym, grp in df.groupby("symbol"):
            g = grp.sort_values("date").copy()
            g["ret_1d"] = g["close"].pct_change(1) * 100
            g["ret_1w"] = g["close"].pct_change(5) * 100
            g["ret_1m"] = g["close"].pct_change(21) * 100
            result_parts.append(g)
        return pd.concat(result_parts).reset_index(drop=True)
    except Exception:
        return pd.DataFrame()


@st.cache_data(ttl=300)
def load_market_intraday(symbols: tuple | None = None) -> pd.DataFrame:
    """Load market_intraday (5m bars). Returns latest bars per symbol."""
    try:
        if symbols:
            placeholders = ",".join("?" * len(symbols))
            sql = f"SELECT symbol, ts, close, volume FROM market_intraday WHERE symbol IN ({placeholders}) ORDER BY symbol, ts"
            df = _query(sql, tuple(symbols))
        else:
            df = _query("SELECT symbol, ts, close, volume FROM market_intraday ORDER BY symbol, ts")
        if df.empty:
            return df
        df = df.assign(ts=pd.to_datetime(df["ts"]))
        return df
    except Exception:
        return pd.DataFrame()


def get_current_prices(intraday_df: pd.DataFrame, daily_df: pd.DataFrame) -> dict:
    """
    Return dict of {symbol: price} using latest intraday 5m close,
    falling back to latest daily close if intraday unavailable.
    """
    prices = {}
    if not intraday_df.empty:
        latest_intra = (
            intraday_df.sort_values("ts")
            .groupby("symbol")
            .last()["close"]
            .to_dict()
        )
        prices.update(latest_intra)
    if not daily_df.empty:
        latest_daily = (
            daily_df.sort_values("date")
            .groupby("symbol")
            .last()["close"]
            .to_dict()
        )
        for sym, px in latest_daily.items():
            if sym not in prices:
                prices[sym] = px
    return prices


# ─────────────────────────────────────────────────────────────────────────────
# Derived metrics
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_derived_metrics() -> pd.DataFrame:
    """
    Load derived_metrics and pivot to wide format: rows=date, cols=name.
    Sorted by date descending so latest row is first.
    """
    try:
        df = _query("SELECT name, date, value FROM derived_metrics ORDER BY date")
        if df.empty:
            return df
        df = df.assign(date=pd.to_datetime(df["date"]))
        wide = df.pivot_table(index="date", columns="name", values="value", aggfunc="last")
        wide.columns.name = None
        return wide.sort_index(ascending=False)
    except Exception:
        return pd.DataFrame()


def get_derived_latest(dm: pd.DataFrame, name: str) -> float | None:
    """Return the most recent non-null value for a given metric name."""
    if dm.empty or name not in dm.columns:
        return None
    s = dm[name].dropna()
    return float(s.iloc[0]) if not s.empty else None


# ─────────────────────────────────────────────────────────────────────────────
# Alert feed
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_alert_feed() -> pd.DataFrame:
    """Load alert_feed sorted newest first."""
    try:
        df = _query(
            "SELECT id, date, alert_type, name, level, value, threshold, direction, message, created_at "
            "FROM alert_feed ORDER BY date DESC, id DESC"
        )
        if not df.empty:
            df = df.assign(date=pd.to_datetime(df["date"]))
        return df
    except Exception:
        return pd.DataFrame()


# ─────────────────────────────────────────────────────────────────────────────
# Backtest results
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_backtest_results() -> pd.DataFrame:
    """Load backtest_results."""
    try:
        return _query(
            "SELECT test_name, cohort, horizon, metric, value, computed_at "
            "FROM backtest_results ORDER BY test_name, horizon, metric"
        )
    except Exception:
        return pd.DataFrame()


def pivot_backtest(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pivot backtest_results to one row per (cohort, horizon) with
    columns: avg_return, median_return, hit_rate, n.
    """
    if df.empty:
        return df
    pivoted = df.pivot_table(
        index=["cohort", "horizon"],
        columns="metric",
        values="value",
        aggfunc="last",
    ).reset_index()
    pivoted.columns.name = None
    # Ensure horizon ordering
    horizon_order = {"1M": 0, "3M": 1, "6M": 2, "12M": 3}
    pivoted["_h_order"] = pivoted["horizon"].map(horizon_order).fillna(99)
    pivoted = pivoted.sort_values(["cohort", "_h_order"]).drop(columns="_h_order")
    return pivoted


# ─────────────────────────────────────────────────────────────────────────────
# Event calendar
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_event_calendar() -> pd.DataFrame:
    """Load event_calendar sorted by event_datetime ascending."""
    try:
        df = _query(
            "SELECT id, event_name, event_datetime, importance, source "
            "FROM event_calendar ORDER BY event_datetime ASC"
        )
        if not df.empty:
            df = df.assign(event_dt=pd.to_datetime(df["event_datetime"], utc=True))
        return df
    except Exception:
        return pd.DataFrame()


def get_upcoming_events(cal: pd.DataFrame, days: int = 14) -> pd.DataFrame:
    """Filter events to the next `days` days from today (UTC)."""
    if cal.empty:
        return cal
    now     = pd.Timestamp.now(tz="UTC").tz_localize(None)
    cutoff  = now + pd.Timedelta(days=days)
    cal_loc = cal.copy()
    cal_loc["event_dt_naive"] = cal_loc["event_dt"].dt.tz_localize(None)
    return cal_loc[
        (cal_loc["event_dt_naive"] >= now) & (cal_loc["event_dt_naive"] <= cutoff)
    ].reset_index(drop=True)


# ─────────────────────────────────────────────────────────────────────────────
# Playbook
# ─────────────────────────────────────────────────────────────────────────────

@st.cache_data(ttl=300)
def load_playbook() -> dict:
    """Load output/playbook.json. Returns {} if file missing or malformed."""
    try:
        with open(PLAYBOOK_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Market data freshness
# ─────────────────────────────────────────────────────────────────────────────

def get_market_freshness() -> dict:
    """
    Return dict with:
      last_daily_date  — MAX(date) from market_daily (YYYY-MM-DD str or None)
      last_intraday_ts — MAX(ts) from market_intraday (ISO str or None)
    Not cached so it always reflects the current DB state.
    """
    try:
        conn = _get_conn()
        row_d = conn.execute("SELECT MAX(date) FROM market_daily").fetchone()
        row_i = conn.execute("SELECT MAX(ts) FROM market_intraday").fetchone()
        conn.close()
        return {
            "last_daily_date":  row_d[0] if row_d and row_d[0] else None,
            "last_intraday_ts": row_i[0] if row_i and row_i[0] else None,
        }
    except Exception:
        return {}


# ─────────────────────────────────────────────────────────────────────────────
# Shared surprise renderer
# ─────────────────────────────────────────────────────────────────────────────

# Mapping of metric_name_z → human label
_Z_LABELS = {
    "SPY_weekly_ret_z":    "SPY weekly return",
    "QQQ_weekly_ret_z":    "QQQ weekly return",
    "IWM_weekly_ret_z":    "IWM weekly return",
    "TLT_weekly_ret_z":    "TLT (20Y Treasury)",
    "HYG_weekly_ret_z":    "HYG (HY Credit)",
    "LQD_weekly_ret_z":    "LQD (IG Credit)",
    "GLD_weekly_ret_z":    "GLD (Gold)",
    "UUP_weekly_ret_z":    "UUP (USD)",
    "USO_weekly_ret_z":    "USO (Oil)",
    "GS10_weekly_chg_z":   "10Y Treasury yield",
    "GS2_weekly_chg_z":    "2Y Treasury yield",
    "SPREAD_weekly_chg_z": "10Y–2Y Yield Spread",
    "UNRATE_weekly_chg_z": "Unemployment rate",
    "CPI_yoy_z":           "CPI YoY",
    "VIX_weekly_chg_z":    "VIX (volatility)",
}

# Corresponding raw-value column for each z-score column
_Z_TO_RAW = {
    "SPY_weekly_ret_z":    "SPY_weekly_ret",
    "QQQ_weekly_ret_z":    "QQQ_weekly_ret",
    "IWM_weekly_ret_z":    "IWM_weekly_ret",
    "TLT_weekly_ret_z":    "TLT_weekly_ret",
    "HYG_weekly_ret_z":    "HYG_weekly_ret",
    "LQD_weekly_ret_z":    "LQD_weekly_ret",
    "GLD_weekly_ret_z":    "GLD_weekly_ret",
    "UUP_weekly_ret_z":    "UUP_weekly_ret",
    "USO_weekly_ret_z":    "USO_weekly_ret",
    "GS10_weekly_chg_z":   "GS10_weekly_chg",
    "GS2_weekly_chg_z":    "GS2_weekly_chg",
    "SPREAD_weekly_chg_z": "SPREAD_weekly_chg",
    "UNRATE_weekly_chg_z": "UNRATE_weekly_chg",
    "CPI_yoy_z":           "CPI_yoy",
    "VIX_weekly_chg_z":    "VIX_weekly_chg",
}


def _z_interpretation(label: str, z: float, raw_val: float | None) -> str:
    direction = "surged" if z > 0 else "fell"
    mag = "sharply" if abs(z) >= 2.5 else ("notably" if abs(z) >= 1.5 else "modestly")
    raw_str = f" ({raw_val:+.2f}%)" if raw_val is not None else ""
    return f"{label} {direction} {mag}{raw_str} — {abs(z):.1f}σ move"


def build_surprises_df(dm: pd.DataFrame, top_n: int = 10) -> pd.DataFrame:
    """
    Extract top-N z-score surprises from derived_metrics wide DataFrame.
    Returns a DataFrame with columns: metric, label, z_score, raw_value, interpretation.

    Uses per-column dropna().iloc[0] so each z-score comes from its own most-recent
    non-null date — avoiding the issue where the global most-recent date row contains
    only _latest/_mom_chg metrics (from priced.py) and NaN for all z-score columns.
    """
    if dm.empty:
        return pd.DataFrame()
    rows = []
    for col in _Z_LABELS:
        if col not in dm.columns:
            continue
        col_series = dm[col].dropna()
        if col_series.empty:
            continue
        z = float(col_series.iloc[0])
        raw_col = _Z_TO_RAW.get(col)
        raw_val = None
        if raw_col and raw_col in dm.columns:
            raw_series = dm[raw_col].dropna()
            if not raw_series.empty:
                raw_val = float(raw_series.iloc[0])
        label = _Z_LABELS[col]
        rows.append({
            "metric":         col,
            "label":          label,
            "z_score":        z,
            "raw_value":      raw_val,
            "interpretation": _z_interpretation(label, z, raw_val),
        })
    if not rows:
        return pd.DataFrame()
    result = pd.DataFrame(rows).sort_values("z_score", key=abs, ascending=False)
    return result.head(top_n).reset_index(drop=True)


def render_surprises(dm: pd.DataFrame, top_n: int = 10, title: str = "Top Surprises This Week") -> None:
    """
    Render top-N z-score surprises as a Streamlit component.
    Shared helper used in Decision View and Market Snapshot.
    """
    import streamlit as st
    from components.shared_styles import section_header
    surprises = build_surprises_df(dm, top_n)
    if surprises.empty:
        st.info("No surprise data available — run `python -m src.analytics.surprise`")
        return

    section_header(title.upper())
    for i, row in surprises.iterrows():
        z    = row["z_score"]
        icon = "🔴" if abs(z) >= 2.5 else ("🟡" if abs(z) >= 1.5 else "🔵")
        bar_pct = min(int(abs(z) / 3.0 * 100), 100)
        bar_color = "#e74c3c" if abs(z) >= 2.5 else ("#f39c12" if abs(z) >= 1.5 else "#3498db")
        st.markdown(
            f"""<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
  <span style="font-size:16px">{icon}</span>
  <div style="flex:1">
    <div style="font-size:13px;line-height:1.4">{row['interpretation']}</div>
    <div style="height:4px;border-radius:2px;background:#21262d;margin-top:3px">
      <div style="width:{bar_pct}%;height:4px;background:{bar_color};border-radius:2px"></div>
    </div>
  </div>
  <span style="font-size:13px;font-weight:700;color:{bar_color};min-width:42px;text-align:right">{z:+.1f}σ</span>
</div>""",
            unsafe_allow_html=True,
        )
