"""The VIX and Treasury weekly surprises are built from daily stores (Oct 2026).

raw_series holds VIXCLS, DGS10 and DGS2 month-stamped (one row a month, the
newest in-month value), so a "weekly" change read from it was a month-over-month
change dated to the first Friday of the month, and it moved every day as the
month's row was rewritten (the VIX_shock alert dated 2026-10-02 came and went).
These pin that each weekly change is Friday's daily close against the prior
Friday's, and that no row of the old computation survives a run.
"""

from __future__ import annotations

import sqlite3

import numpy as np
import pandas as pd
import pytest

from src.analytics import surprise


def _store(path, *, vix=True, desk=True):
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE derived_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
            date TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL, UNIQUE(name, date));
        CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL, fetched_at TEXT);
        CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL);
        """
    )
    days = pd.bdate_range("2024-01-01", "2026-10-21")
    rng = np.random.default_rng(7)
    if vix:
        conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT, volume REAL)")
        closes = 15 + np.cumsum(rng.normal(0, 0.5, len(days)))
        conn.executemany(
            "INSERT INTO asset_prices VALUES ('^VIX', '1d', ?, ?, 'test', NULL)",
            [(d.strftime("%Y-%m-%d"), float(c)) for d, c in zip(days, closes)],
        )
        # a monthly row of the same symbol must never be read as a daily close
        conn.execute("INSERT INTO asset_prices VALUES ('^VIX', '1mo', '2026-10-01', 99.0, 'test', NULL)")
    if desk:
        conn.execute("CREATE TABLE desk_series (series_id TEXT, date TEXT, value REAL, provider TEXT)")
        for sid, base in (("DGS10", 4.0), ("DGS2", 3.5)):
            vals = base + np.cumsum(rng.normal(0, 0.03, len(days)))
            conn.executemany(
                "INSERT INTO desk_series VALUES (?, ?, ?, 'fred')",
                [(sid, d.strftime("%Y-%m-%d"), float(v)) for d, v in zip(days, vals)],
            )
    # the month-stamped rows the old computation read
    for sid in ("VIXCLS", "DGS10", "DGS2"):
        conn.executemany(
            "INSERT INTO raw_series VALUES (?, ?, ?, 'x')",
            [(sid, m.strftime("%Y-%m-%d"), 20.0 + i % 3) for i, m in enumerate(pd.date_range("2020-01-01", "2026-10-01", freq="MS"))],
        )
    # a row the old computation left behind: it must not survive the run
    conn.execute("INSERT INTO derived_metrics (name, date, value, computed_at) VALUES ('VIX_weekly_chg_z', '1985-01-04', 2.1, 'x')")
    conn.commit()
    conn.close()


def _run(path, monkeypatch, tmp_path):
    monkeypatch.setattr(surprise, "DB_PATH", path)
    monkeypatch.setattr(surprise, "ROOT", tmp_path)  # no config/assets.yml: the default symbol list
    surprise.run()
    conn = sqlite3.connect(path)
    try:
        return pd.read_sql_query("SELECT name, date, value FROM derived_metrics", conn)
    finally:
        conn.close()


def _daily(path, sql):
    conn = sqlite3.connect(path)
    try:
        s = pd.read_sql_query(sql, conn, parse_dates=["date"]).set_index("date")["v"]
    finally:
        conn.close()
    return s


def _metric(df, name):
    return df[df["name"] == name].set_index("date")["value"].sort_index()


def test_vix_weekly_change_is_friday_close_against_the_prior_friday(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path)
    got = _metric(_run(path, monkeypatch, tmp_path), "VIX_weekly_chg")
    closes = _daily(path, "SELECT date, close AS v FROM asset_prices WHERE symbol='^VIX' AND interval='1d'")
    want = closes.resample("W-FRI").last().diff().dropna()
    assert len(got) == len(want)
    for day in ("2026-10-16", "2026-10-09", "2025-03-07"):
        assert got[day] == pytest.approx(float(want[pd.Timestamp(day)]))
    # the current, partial week runs to the newest close (Wed 2026-10-21)
    assert got.index[-1] == "2026-10-23"
    assert got["2026-10-23"] == pytest.approx(float(closes.iloc[-1] - closes[pd.Timestamp("2026-10-16")]))


def test_yield_weekly_changes_read_daily_yields(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path)
    df = _run(path, monkeypatch, tmp_path)
    ten = _daily(path, "SELECT date, value AS v FROM desk_series WHERE series_id='DGS10'").resample("W-FRI").last()
    two = _daily(path, "SELECT date, value AS v FROM desk_series WHERE series_id='DGS2'").resample("W-FRI").last()
    assert _metric(df, "DGS10_weekly_chg")["2026-10-16"] == pytest.approx(float(ten.diff()[pd.Timestamp("2026-10-16")]))
    assert _metric(df, "SPREAD_weekly_chg")["2026-10-16"] == pytest.approx(float((ten - two).diff()[pd.Timestamp("2026-10-16")]))
    # weekly, not month-start: consecutive rows a week apart
    gaps = pd.to_datetime(_metric(df, "DGS2_weekly_chg").index).to_series().diff().dropna().dt.days
    assert set(gaps) == {7}


def test_no_row_of_the_old_computation_survives(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path)
    df = _run(path, monkeypatch, tmp_path)
    assert "1985-01-04" not in set(_metric(df, "VIX_weekly_chg_z").index)


def test_without_the_daily_stores_the_rows_are_empty_not_monthly(tmp_path, monkeypatch):
    """A store without asset_prices or desk_series never falls back to the
    month-stamped rows: the metrics are absent until the full refresh stores them."""
    path = tmp_path / "s.db"
    _store(path, vix=False, desk=False)
    df = _run(path, monkeypatch, tmp_path)
    assert not set(df["name"]) & set(surprise.DAILY_SOURCED_METRICS)


def test_daily_moves_are_one_session_changes_dated_by_session(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path)
    df = _run(path, monkeypatch, tmp_path)
    closes = _daily(path, "SELECT date, close AS v FROM asset_prices WHERE symbol='^VIX' AND interval='1d'")
    vix = _metric(df, "VIX_daily_chg")
    assert vix.index[-1] == "2026-10-21"
    assert vix["2026-10-21"] == pytest.approx(float(closes.iloc[-1] - closes.iloc[-2]))
    want_z = surprise.rolling_zscore(closes.diff().dropna(), surprise.DAILY_ZSCORE_WINDOW, surprise.DAILY_MIN_PERIODS)
    assert _metric(df, "VIX_daily_chg_z")["2026-10-21"] == pytest.approx(float(want_z.iloc[-1]))
    ten = _daily(path, "SELECT date, value AS v FROM desk_series WHERE series_id='DGS10'")
    assert _metric(df, "DGS10_daily_chg")["2026-10-21"] == pytest.approx(float(ten.iloc[-1] - ten.iloc[-2]))
    assert "DGS2_daily_chg_z" in set(df["name"])
