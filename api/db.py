"""api/db.py — read-only data access for the local Macro Radar API.

Mirrors the read-only URI pattern used by the chat agent
(src/analytics/chat.py:_ro_conn) but is fully self-contained: no src.config
import (avoids the FRED_API_KEY requirement) and no anthropic import. A fresh
short-lived connection is opened per call and closed immediately, so the
service tolerates the local DB file being swapped by the git session routine
and concurrent WAL writes from refresh jobs.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "macro_radar.db"


class DBUnavailable(RuntimeError):
    """Raised when the SQLite file is missing or cannot be opened read-only."""


def db_present() -> bool:
    return DB_PATH.exists()


def _connect() -> sqlite3.Connection:
    if not DB_PATH.exists():
        raise DBUnavailable(f"Database not found at {DB_PATH}")
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def latest_regime() -> dict | None:
    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT date, label, confidence, growth_trend, inflation_trend, "
            "prob_goldilocks, prob_overheating, prob_stagflation, prob_recession "
            "FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def latest_signals() -> dict | None:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT date, signal_name, value, triggered FROM signals "
            "WHERE date = (SELECT MAX(date) FROM signals) ORDER BY signal_name"
        ).fetchall()
    if not rows:
        return None
    return {
        "date": rows[0]["date"],
        "signals": [
            {
                "signal_name": r["signal_name"],
                "value": r["value"],
                "triggered": bool(r["triggered"]),
            }
            for r in rows
        ],
    }


def list_series() -> list[str]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT DISTINCT series_id FROM raw_series ORDER BY series_id"
        ).fetchall()
    return [r["series_id"] for r in rows]


def latest_series_all() -> list[dict]:
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT r.series_id, r.date, r.value FROM raw_series r "
            "JOIN (SELECT series_id, MAX(date) AS md FROM raw_series GROUP BY series_id) m "
            "  ON r.series_id = m.series_id AND r.date = m.md "
            "ORDER BY r.series_id"
        ).fetchall()
    return [dict(r) for r in rows]


def latest_series_one(series_id: str) -> dict | None:
    with closing(_connect()) as conn:
        row = conn.execute(
            "SELECT series_id, date, value FROM raw_series "
            "WHERE series_id = ? ORDER BY date DESC LIMIT 1",
            (series_id,),
        ).fetchone()
    return dict(row) if row else None


# ── React-migration endpoints (/api/*) ────────────────────────────────────────
# Queries mirror the Streamlit dashboard loaders (dashboard/app.py:query_df,
# dashboard/components/db_helpers.py, events_tab.load_news) so the React client
# sees the same rows the current UI renders.

_REGIME_COLS = (
    "date, label, confidence, growth_trend, inflation_trend, "
    "prob_goldilocks, prob_overheating, prob_stagflation, prob_recession"
)

# Symbol universes copied from dashboard/components/db_helpers.py.
WATCHLIST_SYMBOLS = ["SPY", "QQQ", "IWM", "TLT", "HYG", "LQD", "UUP", "GLD", "USO"]
INTRADAY_SYMBOLS = ["SPY", "QQQ"]

# Signal trigger definitions — threshold + direction per signal_name, matching
# src/config.py:36–41 and the comparisons in src/signals.py. Kept as a constant
# because api/ deliberately never imports src.config (it must run without
# FRED_API_KEY); tests/test_api.py::test_signal_defs_match_src_config AST-parses
# src/config.py so any drift fails the suite instead of silently lying.
SIGNAL_DEFS: dict[str, dict] = {
    "yield_curve_inversion": {"threshold": 0.0, "direction": "below"},
    "unemployment_spike": {"threshold": 0.3, "direction": "above"},
    "cpi_hot": {"threshold": 4.0, "direction": "above"},
    "cpi_cold": {"threshold": 1.0, "direction": "below"},
    "vix_spike": {"threshold": 30.0, "direction": "above"},
}

# FRED credit series (src/config.py:CREDIT_SERIES) + the 10Y yield. Values in
# raw_series are stored as percent; ×100 for bps.
CREDIT_OAS_SERIES = [
    ("BAMLC0A0CM", "IG"),
    ("BAMLH0A0HYM2", "HY"),
    ("BAMLH0A1HYBB", "BB"),
    ("BAMLH0A2HYB", "B"),
    ("BAMLH0A3HYC", "CCC"),
    ("DGS10", "UST10Y"),
]

_HORIZON_ORDER = {"1M": 0, "3M": 1, "6M": 2, "12M": 3}

# What's Priced metric registry — (group, derived_metrics base name, label,
# unit), mirroring dashboard/components/whats_priced.py::METRIC_GROUPS.
PRICED_METRICS = [
    ("Policy rate proxies", "FEDFUNDS", "Fed Funds", "%"),
    ("Policy rate proxies", "SOFR", "SOFR", "%"),
    ("Inflation breakevens", "T5YIE", "5Y breakeven", "%"),
    ("Inflation breakevens", "T10YIE", "10Y breakeven", "%"),
    ("Real yields (TIPS)", "DFII5", "5Y real yield", "%"),
    ("Real yields (TIPS)", "DFII10", "10Y real yield", "%"),
]

# Surprise z-score registry — (z metric, raw metric, label), mirroring
# dashboard/components/db_helpers.py::_Z_LABELS / _Z_TO_RAW.
SURPRISE_Z_METRICS = [
    ("SPY_weekly_ret_z", "SPY_weekly_ret", "SPY weekly return"),
    ("QQQ_weekly_ret_z", "QQQ_weekly_ret", "QQQ weekly return"),
    ("IWM_weekly_ret_z", "IWM_weekly_ret", "IWM weekly return"),
    ("TLT_weekly_ret_z", "TLT_weekly_ret", "TLT (20Y Treasury)"),
    ("HYG_weekly_ret_z", "HYG_weekly_ret", "HYG (HY Credit)"),
    ("LQD_weekly_ret_z", "LQD_weekly_ret", "LQD (IG Credit)"),
    ("GLD_weekly_ret_z", "GLD_weekly_ret", "GLD (Gold)"),
    ("UUP_weekly_ret_z", "UUP_weekly_ret", "UUP (USD)"),
    ("USO_weekly_ret_z", "USO_weekly_ret", "USO (Oil)"),
    ("DGS10_weekly_chg_z", "DGS10_weekly_chg", "10Y Treasury yield"),
    ("DGS2_weekly_chg_z", "DGS2_weekly_chg", "2Y Treasury yield"),
    ("SPREAD_weekly_chg_z", "SPREAD_weekly_chg", "10Y–2Y Yield Spread"),
    ("UNRATE_weekly_chg_z", "UNRATE_weekly_chg", "Unemployment rate"),
    ("CPI_yoy_z", "CPI_yoy", "CPI YoY"),
    ("VIX_weekly_chg_z", "VIX_weekly_chg", "VIX (volatility)"),
]


def _latest_metric(conn: sqlite3.Connection, name: str) -> sqlite3.Row | None:
    """Most recent row for one derived_metrics name (value is NOT NULL by
    schema, so this matches the dashboard's per-column dropna().iloc[0])."""
    return conn.execute(
        "SELECT date, value FROM derived_metrics WHERE name = ? "
        "ORDER BY date DESC LIMIT 1",
        (name,),
    ).fetchone()


def priced_metrics() -> list[dict]:
    """What's Priced — policy proxies, breakevens, real yields written to
    derived_metrics by src/analytics/priced.py, each from its own most-recent
    date (per-name latest, mirroring db_helpers.get_derived_latest)."""
    out: list[dict] = []
    with closing(_connect()) as conn:
        for group, base, label, unit in PRICED_METRICS:
            val = _latest_metric(conn, f"{base}_latest")
            if not val:
                continue
            chg = _latest_metric(conn, f"{base}_mom_chg")
            out.append(
                {
                    "group": group,
                    "metric": base,
                    "label": label,
                    "unit": unit,
                    "date": val["date"],
                    "value": val["value"],
                    "mom_chg": chg["value"] if chg else None,
                }
            )
    return out


def top_surprises(top_n: int) -> list[dict]:
    """Top-|z| weekly surprises from derived_metrics, mirroring
    db_helpers.build_surprises_df (each z from its own most-recent date).
    Phrasing comes from src.utils.format.z_interpretation — a standalone
    module (no src.config import), so the API, dashboard, and memo all speak
    the same sentence."""
    from src.utils.format import z_interpretation

    rows: list[dict] = []
    with closing(_connect()) as conn:
        for z_name, raw_name, label in SURPRISE_Z_METRICS:
            z = _latest_metric(conn, z_name)
            if not z:
                continue
            raw = _latest_metric(conn, raw_name)
            raw_val = raw["value"] if raw else None
            rows.append(
                {
                    "metric": z_name,
                    "label": label,
                    "date": z["date"],
                    "z_score": z["value"],
                    "raw_value": raw_val,
                    "interpretation": z_interpretation(z_name, label, z["value"], raw_val),
                }
            )
    rows.sort(key=lambda r: abs(r["z_score"]), reverse=True)
    return rows[:top_n]


def _distance_pct(value: float, threshold: float, direction: str) -> float:
    """Threshold-proximity fill %, the exact shared_styles.py gauge formula
    (both zero-value branches included). 100 means at or past the trigger."""
    if direction == "above":
        fill = (value / threshold * 100.0) if threshold != 0 else (100.0 if value > 0 else 0.0)
    else:
        if value <= threshold:
            fill = 100.0
        elif value != 0:
            fill = threshold / value * 100.0
        else:
            fill = 0.0
    return max(0.0, min(100.0, fill))


def _signal_status(triggered: bool, distance_pct: float) -> str:
    """Closed vocabulary: Clear / Watch / Triggered. The stored `triggered`
    flag owns Triggered (one number, one truth — the old client-side ≥75%
    rule could label an untriggered signal Triggered); distance owns the rest."""
    if triggered:
        return "Triggered"
    return "Watch" if distance_pct >= 50.0 else "Clear"


def latest_signals_full() -> dict | None:
    """Latest row PER SIGNAL for /api/signals/latest — the carry-forward rule:
    a monthly signal keeps reporting its most recent print (with its true
    as-of date) between releases instead of dropping out at the max common
    date. A signal with any history never comes back empty. Threshold,
    direction, distance-to-trigger, and status are computed here so clients
    never mirror config."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT s.signal_name, s.date, s.value, s.triggered FROM signals s "
            "JOIN (SELECT signal_name, MAX(date) AS md FROM signals GROUP BY signal_name) m "
            "  ON s.signal_name = m.signal_name AND s.date = m.md "
            "ORDER BY s.signal_name"
        ).fetchall()
    if not rows:
        return None
    signals: list[dict] = []
    for r in rows:
        d = SIGNAL_DEFS.get(r["signal_name"])
        triggered = bool(r["triggered"])
        distance = (
            _distance_pct(r["value"], d["threshold"], d["direction"]) if d else None
        )
        signals.append(
            {
                "signal_name": r["signal_name"],
                "date": r["date"],
                "value": r["value"],
                "triggered": triggered,
                "threshold": d["threshold"] if d else None,
                "direction": d["direction"] if d else None,
                "distance_pct": distance,
                "status": (
                    _signal_status(triggered, distance)
                    if distance is not None
                    else ("Triggered" if triggered else None)
                ),
            }
        )
    return {"date": max(r["date"] for r in rows), "signals": signals}


def regime_history(start: str | None, end: str | None, limit: int | None) -> list[dict]:
    sql = f"SELECT {_REGIME_COLS} FROM regimes"
    clauses, params = [], []
    if start:
        clauses.append("date >= ?")
        params.append(start)
    if end:
        clauses.append("date <= ?")
        params.append(end)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY date"
    if limit:
        # keep the most recent `limit` rows while returning ascending order
        sql = f"SELECT * FROM ({sql.replace('ORDER BY date', 'ORDER BY date DESC')} LIMIT ?) ORDER BY date"
        params.append(limit)
    with closing(_connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def alert_feed(level: str | None, alert_type: str | None, limit: int) -> list[dict]:
    sql = (
        "SELECT id, date, alert_type, name, level, value, threshold, direction, "
        "message, created_at FROM alert_feed"
    )
    clauses, params = [], []
    if level:
        clauses.append("level = ?")
        params.append(level)
    if alert_type:
        clauses.append("alert_type = ?")
        params.append(alert_type)
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY date DESC, id DESC LIMIT ?"
    params.append(limit)
    with closing(_connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def news_feed(
    hours: int, category: str | None, min_significance: float | None, limit: int
) -> list[dict]:
    # published_at mixes formats in the DB ("2026-08-06T08:17:15+00:00" vs
    # "2026-07-30 02:08:34") while datetime('now', ...) yields the space form —
    # lexicographic 'T' > ' ' let same-day rows leak past the window boundary
    # (a "30h ago" row inside a 24H filter, found live; same family as the
    # intraday `since` fix). Normalize to "YYYY-MM-DD HH:MM:SS" for comparison.
    sql = (
        "SELECT id, headline, summary, url, source, category, published_at, fetched_at, "
        "market_impact, deal_size, sector_relevance, time_sensitivity, regime_relevance, "
        "overall_significance, regime_interpretation, perplexity_research, ticker "
        "FROM news_feed "
        "WHERE replace(substr(published_at, 1, 19), 'T', ' ') >= datetime('now', ?)"
    )
    params: list = [f"-{hours} hours"]
    if category:
        sql += " AND category = ?"
        params.append(category)
    if min_significance is not None:
        sql += " AND overall_significance >= ?"
        params.append(min_significance)
    sql += " ORDER BY overall_significance DESC, published_at DESC LIMIT ?"
    params.append(limit)
    with closing(_connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


_NEWS_COLS = (
    "id, headline, summary, url, source, category, published_at, fetched_at, "
    "market_impact, deal_size, sector_relevance, time_sensitivity, regime_relevance, "
    "overall_significance, regime_interpretation, perplexity_research, ticker"
)


def news_latest(category: str | None, limit: int) -> list[dict]:
    """Latest-available fallback (mirrors events_tab.load_latest_news): when the
    recency-windowed feed is empty, the client shows the most recent stored
    headlines with their dates instead of a zero screen."""
    sql = f"SELECT {_NEWS_COLS} FROM news_feed"
    params: list = []
    if category:
        sql += " WHERE category = ?"
        params.append(category)
    sql += " ORDER BY published_at DESC LIMIT ?"
    params.append(limit)
    with closing(_connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def calendar_recent(limit: int) -> list[dict]:
    """Most recent PAST events, newest first — the calendar's latest-available
    fallback for when the upcoming window is empty (the DB snapshot's
    event_calendar can lag the source CSV)."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT id, event_name, event_datetime, importance, source "
            "FROM event_calendar "
            "WHERE event_datetime < strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
            "ORDER BY event_datetime DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def market_daily(symbols: list[str], days: int) -> list[dict]:
    """OHLCV bars plus trailing returns (1d/5-row/21-row pct changes, matching
    the pandas pct_change(1/5/21) computation in db_helpers.load_market_daily)."""
    placeholders = ",".join("?" for _ in symbols)
    with closing(_connect()) as conn:
        rows = conn.execute(
            f"SELECT symbol, date, open, high, low, close, volume, vwap "
            f"FROM market_daily WHERE symbol IN ({placeholders}) "
            f"AND date >= date('now', ?) ORDER BY symbol, date",
            [*symbols, f"-{days} days"],
        ).fetchall()
    out: list[dict] = []
    prev_closes: dict[str, list[float]] = {}
    for r in rows:
        d = dict(r)
        closes = prev_closes.setdefault(d["symbol"], [])
        for key, lag in (("ret_1d", 1), ("ret_1w", 5), ("ret_1m", 21)):
            if len(closes) >= lag and closes[-lag]:
                d[key] = (d["close"] / closes[-lag] - 1.0) * 100.0
            else:
                d[key] = None
        closes.append(d["close"])
        out.append(d)
    return out


def market_intraday(symbols: list[str], since: str | None) -> list[dict]:
    placeholders = ",".join("?" for _ in symbols)
    sql = (
        f"SELECT symbol, ts, close, volume FROM market_intraday "
        f"WHERE symbol IN ({placeholders})"
    )
    params: list = [*symbols]
    if since:
        # Stored ts is naive "YYYY-MM-DD HH:MM:SS" (ET session bars). An ISO
        # "T"/"Z" since-value compares wrong lexicographically on the SAME
        # calendar day (" " < "T" drops every same-day row — found live when
        # the intraday chart came up empty), so normalize to the stored shape.
        sql += " AND ts >= ?"
        params.append(since.replace("T", " ").replace("Z", ""))
    sql += " ORDER BY symbol, ts"
    with closing(_connect()) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


def event_calendar(days: int) -> list[dict]:
    """Upcoming events in [now, now + days], mirroring get_upcoming_events()."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT id, event_name, event_datetime, importance, source "
            "FROM event_calendar "
            "WHERE event_datetime >= strftime('%Y-%m-%dT%H:%M:%SZ', 'now') "
            "AND event_datetime <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) "
            "ORDER BY event_datetime ASC",
            (f"+{days} days",),
        ).fetchall()
    return [dict(r) for r in rows]


def backtests() -> list[dict]:
    """backtest_results pivoted long→wide: one row per (test_name, cohort,
    horizon) with metric columns, mirroring db_helpers.pivot_backtest."""
    with closing(_connect()) as conn:
        rows = conn.execute(
            "SELECT test_name, cohort, horizon, metric, value, computed_at "
            "FROM backtest_results ORDER BY test_name, cohort, horizon, metric"
        ).fetchall()
    grouped: dict[tuple, dict] = {}
    for r in rows:
        key = (r["test_name"], r["cohort"], r["horizon"])
        rec = grouped.setdefault(
            key,
            {
                "test_name": r["test_name"],
                "cohort": r["cohort"],
                "horizon": r["horizon"],
                "avg_return": None,
                "median_return": None,
                "hit_rate": None,
                "n": None,
                "computed_at": r["computed_at"],
            },
        )
        if r["metric"] in ("avg_return", "median_return", "hit_rate", "n"):
            rec[r["metric"]] = r["value"]
    return sorted(
        grouped.values(),
        key=lambda x: (x["test_name"], x["cohort"], _HORIZON_ORDER.get(x["horizon"], 99)),
    )


def credit_oas(days: int) -> dict:
    """Latest OAS (pct + bps) with ~1-week change and a history window for
    sparklines, for the five BAML series plus the 10Y UST yield."""
    series_out: list[dict] = []
    as_of: str | None = None
    with closing(_connect()) as conn:
        for series_id, label in CREDIT_OAS_SERIES:
            rows = conn.execute(
                "SELECT date, value FROM raw_series WHERE series_id = ? "
                "AND date >= date('now', ?) AND value IS NOT NULL ORDER BY date",
                (series_id, f"-{days} days"),
            ).fetchall()
            if not rows:
                continue
            latest = rows[-1]
            week_ago_cut = conn.execute(
                "SELECT date(?, '-7 days')", (latest["date"],)
            ).fetchone()[0]
            prior = next(
                (r for r in reversed(rows) if r["date"] <= week_ago_cut), None
            )
            change_1w_bps = (
                (latest["value"] - prior["value"]) * 100.0 if prior else None
            )
            series_out.append(
                {
                    "series_id": series_id,
                    "label": label,
                    "date": latest["date"],
                    "value_pct": latest["value"],
                    "value_bps": latest["value"] * 100.0,
                    "change_1w_bps": change_1w_bps,
                    "history": [{"date": r["date"], "value": r["value"]} for r in rows],
                }
            )
            if label != "UST10Y":
                as_of = max(as_of, latest["date"]) if as_of else latest["date"]
    return {"as_of": as_of, "series": series_out}


def freshness() -> dict:
    """Latest data timestamps per feed — for the shell's data-freshness line."""
    queries = {
        "regimes_date": "SELECT MAX(date) FROM regimes",
        "signals_date": "SELECT MAX(date) FROM signals",
        "market_daily_date": "SELECT MAX(date) FROM market_daily",
        "market_intraday_ts": "SELECT MAX(ts) FROM market_intraday",
        "news_published_at": "SELECT MAX(published_at) FROM news_feed",
        "raw_series_date": "SELECT MAX(date) FROM raw_series",
    }
    out: dict = {}
    with closing(_connect()) as conn:
        for key, sql in queries.items():
            out[key] = conn.execute(sql).fetchone()[0]
    return out
