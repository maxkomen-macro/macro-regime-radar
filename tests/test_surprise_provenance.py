"""The daily-sourced surprises' rules and the provenance the computation stores (V1, Oct 2026).

Each daily move spans exactly one session of its series' calendar; each weekly
change compares two consecutive W-FRI weeks; the 10Y-2Y spread takes both legs
from one date; the date a row read is written beside it (`<raw metric>_obs`,
`<SERIES>_daily_newest`) and api/db serves exactly that; a sentence's direction
word follows the move it prints; a VIX alert needs a rise and an observation date.
"""

from __future__ import annotations

import sqlite3
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from api import db as api_db
from src.analytics import alerts, surprise
from src.analytics.surprise_dates import SUPPORTED_DATES, date_from_ordinal, parse_source_date
from src.utils.format import z_interpretation

ROOT = Path(__file__).resolve().parent.parent

DERIVED = """CREATE TABLE derived_metrics (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
    date TEXT NOT NULL, value REAL NOT NULL, computed_at TEXT NOT NULL, UNIQUE(name, date))"""
ALERTS = """CREATE TABLE alert_feed (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL,
    alert_type TEXT NOT NULL, name TEXT NOT NULL, level TEXT NOT NULL, value REAL, threshold REAL,
    direction TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL)"""


def _series(pairs, name="X"):
    return pd.Series([v for _, v in pairs], index=pd.DatetimeIndex([d for d, _ in pairs]), dtype=float, name=name)


# ── the loader ────────────────────────────────────────────────────────────────

def test_the_loader_keeps_only_canonical_supported_dates_and_usable_values():
    rows = [
        ("2026-10-19", 18.0),
        ("2026-10-20 10:00:00", 20.0),  # a time of day is dropped, never truncated to its day
        ("2026-10-20T16:00", 30.0),
        ("20261020", 25.0),
        ("2026-02-30", 25.0),
        ("0001-01-01", 25.0),
        ("9999-12-31", 25.0),
        ("2026-10-21", float("nan")),
        ("2026-10-21", float("inf")),
        ("2026-10-21", 2e6),
        ("2026-10-21", "text"),
        ("2026-10-21", None),
        ("2026-10-22", 19.0),
        ("2026-10-22", 19.5),  # a repeated date keeps its last row
    ]
    s = surprise._daily_series(rows, "VIX")
    assert [d.date() for d in s.index] == [date(2026, 10, 19), date(2026, 10, 22)]
    assert list(s) == [18.0, 19.5]


def test_two_stamps_on_one_day_never_make_a_move():
    s = surprise._daily_series([("2026-10-20 10:00:00", 20.0), ("2026-10-20 16:00:00", 30.0)], "VIX", surprise.is_vix_session)
    assert surprise.one_session_moves(s, surprise.is_vix_session).empty


def test_parse_and_ordinal_share_the_supported_range():
    assert parse_source_date("1900-01-01") == date(1900, 1, 1) and parse_source_date("1899-12-31") is None
    assert parse_source_date("2100-12-31") == date(2100, 12, 31) and parse_source_date("2101-01-01") is None
    assert date_from_ordinal(float(date(2026, 10, 21).toordinal())) == date(2026, 10, 21)
    for bad in (None, 739910.5, float("nan"), float(SUPPORTED_DATES[1].toordinal() + 1), True, "739910"):
        assert date_from_ordinal(bad) is None


# ── one-session moves ─────────────────────────────────────────────────────────

def test_a_vix_close_on_a_closed_day_is_quarantined():
    # Memorial Day 2026-05-25: the store has a ^VIX row that day; the move is Fri -> Tue
    rows = [("2026-05-21", 15.0), ("2026-05-22", 16.0), ("2026-05-25", 25.0), ("2026-05-26", 17.0)]
    s = surprise._daily_series(rows, "VIX", surprise.is_vix_session)
    moves = surprise.one_session_moves(s, surprise.is_vix_session)
    assert moves.to_dict() == {pd.Timestamp("2026-05-22"): 1.0, pd.Timestamp("2026-05-26"): 1.0}


def test_a_move_across_a_missing_session_is_dropped():
    s = _series([("2026-10-14", 1.0), ("2026-10-15", 2.0), ("2026-10-19", 9.0), ("2026-10-20", 10.0)])  # no Fri 10-16
    moves = surprise.one_session_moves(s, surprise.is_vix_session)
    assert list(moves.index) == [pd.Timestamp("2026-10-15"), pd.Timestamp("2026-10-20")]


def test_treasury_sessions_follow_the_bond_calendar_and_its_published_exceptions():
    # Good Friday 2025-04-18 had no Treasury observation: Thu -> Mon is one session
    s = _series([("2025-04-17", 4.3), ("2025-04-21", 4.4)])
    assert len(surprise.one_session_moves(s, surprise.is_treasury_session)) == 1
    # Good Friday 2026-04-03 had one (a jobs report): Thu -> Mon without it spans a session
    s = _series([("2026-04-02", 4.3), ("2026-04-06", 4.4)])
    assert surprise.one_session_moves(s, surprise.is_treasury_session).empty
    # Columbus Day: NYSE open, bond market closed
    s = _series([("2026-10-09", 4.1), ("2026-10-13", 4.2)])
    assert len(surprise.one_session_moves(s, surprise.is_treasury_session)) == 1
    assert len(surprise.one_session_moves(s, surprise.is_vix_session)) == 0


def test_treasury_extra_sessions_match_the_stored_series():
    path = ROOT / "data" / "macro_radar.db"
    if not path.exists():
        pytest.skip("no local database")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        if not conn.execute("SELECT 1 FROM sqlite_master WHERE name='desk_series'").fetchone():
            pytest.skip("database predates desk_series")
        dates = {date.fromisoformat(r[0]) for r in conn.execute(
            "SELECT date FROM desk_series WHERE series_id IN ('DGS10', 'DGS2') AND value IS NOT NULL")}
    finally:
        conn.close()
    from api import calendar as cal
    assert {d for d in dates if not cal.is_bond_trading_day(d)} == set(surprise.TREASURY_EXTRA_SESSIONS)


# ── weekly rule and spread ───────────────────────────────────────────────────

def test_a_weekly_change_never_spans_a_missing_week():
    s = _series([("2026-09-25", 1.0), ("2026-10-02", 2.0), ("2026-10-16", 5.0), ("2026-10-21", 6.0)])  # no week of 10-09
    levels, obs = surprise.weekly_levels(s)
    chg = surprise.consecutive_week_change(levels)
    assert chg.to_dict() == {pd.Timestamp("2026-10-02"): 1.0, pd.Timestamp("2026-10-23"): 1.0}
    assert obs[pd.Timestamp("2026-10-23")] == pd.Timestamp("2026-10-21")


def _store(path, *, drop_dgs2_last=False, gap_before_last=False):
    conn = sqlite3.connect(path)
    conn.executescript(DERIVED + ";" + """
        CREATE TABLE raw_series (series_id TEXT, date TEXT, value REAL, fetched_at TEXT);
        CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL);
        CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT, volume REAL);
        CREATE TABLE desk_series (series_id TEXT, date TEXT, value REAL, provider TEXT);""")
    from api import calendar as cal
    weekdays = pd.bdate_range("2024-01-01", "2026-10-21")
    nyse = [d for d in weekdays if cal.is_trading_day(d.date())]
    bond = [d for d in weekdays if cal.is_bond_trading_day(d.date())]
    if gap_before_last:
        nyse = nyse[:-2] + nyse[-1:]  # the session before the newest is missing
    conn.executemany("INSERT INTO asset_prices VALUES ('^VIX', '1d', ?, ?, 't', NULL)",
                     [(d.strftime("%Y-%m-%d"), 15.0 + (i % 7) * 0.5) for i, d in enumerate(nyse)])
    conn.executemany("INSERT INTO desk_series VALUES ('DGS10', ?, ?, 'fred')",
                     [(d.strftime("%Y-%m-%d"), 4.0 + (i % 5) * 0.01) for i, d in enumerate(bond)])
    two = bond[:-1] if drop_dgs2_last else bond
    conn.executemany("INSERT INTO desk_series VALUES ('DGS2', ?, ?, 'fred')",
                     [(d.strftime("%Y-%m-%d"), 3.5 + (i % 3) * 0.01) for i, d in enumerate(two)])
    conn.executemany("INSERT INTO market_daily VALUES ('SPY', ?, ?)",
                     [(d.strftime("%Y-%m-%d"), 500.0 + i) for i, d in enumerate(nyse)])
    conn.commit()
    conn.close()


def _run(path, monkeypatch, tmp_path):
    monkeypatch.setattr(surprise, "DB_PATH", path)
    monkeypatch.setattr(surprise, "ROOT", tmp_path)
    surprise.run()
    conn = sqlite3.connect(path)
    try:
        return {(n, d): v for n, d, v in conn.execute("SELECT name, date, value FROM derived_metrics")}
    finally:
        conn.close()


def test_provenance_rows_name_the_observation_each_row_read(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path, drop_dgs2_last=True)
    got = _run(path, monkeypatch, tmp_path)
    o = lambda iso: float(date.fromisoformat(iso).toordinal())  # noqa: E731
    # the partial week to Wed 2026-10-21, bucketed at Fri 2026-10-23
    assert got[("VIX_weekly_chg_obs", "2026-10-23")] == o("2026-10-21")
    assert got[("DGS10_weekly_chg_obs", "2026-10-23")] == o("2026-10-21")
    assert got[("DGS2_weekly_chg_obs", "2026-10-23")] == o("2026-10-20")
    # the spread reads only dates both legs have: Tue 10-20, and its value is that day's
    assert got[("SPREAD_weekly_chg_obs", "2026-10-23")] == o("2026-10-20")
    conn = sqlite3.connect(path)
    leg = lambda sid, d: conn.execute("SELECT value FROM desk_series WHERE series_id=? AND date=?", (sid, d)).fetchone()[0]  # noqa: E731
    want = (leg("DGS10", "2026-10-20") - leg("DGS2", "2026-10-20")) - (leg("DGS10", "2026-10-16") - leg("DGS2", "2026-10-16"))
    conn.close()
    assert got[("SPREAD_weekly_chg", "2026-10-23")] == pytest.approx(want)
    assert got[("SPY_weekly_ret_obs", "2026-10-23")] == o("2026-10-21")
    assert got[("VIX_daily_newest", "2026-10-21")] == o("2026-10-21")


def test_without_an_eligible_move_for_the_newest_session_no_daily_row_is_current(tmp_path, monkeypatch):
    path = tmp_path / "s.db"
    _store(path, gap_before_last=True)
    got = _run(path, monkeypatch, tmp_path)
    assert ("VIX_daily_newest", "2026-10-21") in got
    assert ("VIX_daily_chg", "2026-10-21") not in got  # Mon -> Wed spans Tuesday's missing session
    assert ("VIX_daily_chg", "2026-10-19") in got


# ── what the API serves ──────────────────────────────────────────────────────

def _derived(path, rows):
    conn = sqlite3.connect(path)
    conn.executescript(DERIVED + ";" + ALERTS)
    conn.executemany("INSERT INTO derived_metrics (name, date, value, computed_at) VALUES (?, ?, ?, 'x')", rows)
    conn.commit()
    conn.close()


def _connect_to(path):
    def _c():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        return conn
    return _c


ORD = lambda iso: float(date.fromisoformat(iso).toordinal())  # noqa: E731


def test_as_of_is_the_stored_observation_never_re_derived(tmp_path):
    path = tmp_path / "d.db"
    _derived(path, [("VIX_weekly_chg_obs", "2026-10-23", ORD("2026-10-21")), ("SPY_weekly_ret_obs", "2026-10-16", 739.5)])
    conn = _connect_to(path)()
    try:
        assert api_db._surprise_as_of(conn, "VIX_weekly_chg_z", "2026-10-23") == "2026-10-21"
        assert api_db._surprise_as_of(conn, "DGS10_weekly_chg_z", "2026-10-23") is None  # an older store
        assert api_db._surprise_as_of(conn, "SPY_weekly_ret_z", "2026-10-16") is None  # not an ordinal
        assert api_db._surprise_as_of(conn, "VIX_daily_chg_z", "2026-10-21") == "2026-10-21"
        assert api_db._surprise_as_of(conn, "UNRATE_weekly_chg_z", "2026-10-23") is None
    finally:
        conn.close()


def test_top_surprises_ranks_only_the_latest_sessions_move_with_its_own_raw(tmp_path, monkeypatch):
    path = tmp_path / "d.db"
    _derived(path, [
        # the newest VIX observation is 10-21, but its move was dropped: 10-19's is history
        ("VIX_daily_chg_z", "2026-10-19", 3.5), ("VIX_daily_chg", "2026-10-19", 4.0),
        ("VIX_daily_newest", "2026-10-21", ORD("2026-10-21")),
        # the 10Y's newest move is current
        ("DGS10_daily_chg_z", "2026-10-20", -1.2), ("DGS10_daily_chg", "2026-10-20", -0.05),
        ("DGS10_daily_newest", "2026-10-20", ORD("2026-10-20")),
        # an older store: no newest row, so the 2Y's move is never treated as current
        ("DGS2_daily_chg_z", "2026-10-20", 2.9), ("DGS2_daily_chg", "2026-10-20", 0.1),
        # a weekly row whose raw column has a newer date must print the raw at its own date
        ("VIX_weekly_chg_z", "2026-10-16", -2.5), ("VIX_weekly_chg", "2026-10-16", 1.0),
        ("VIX_weekly_chg", "2026-10-23", 9.0), ("VIX_weekly_chg_obs", "2026-10-16", ORD("2026-10-16")),
    ])
    monkeypatch.setattr(api_db, "_connect", _connect_to(path))
    rows = {r["metric"]: r for r in api_db.top_surprises(15)}
    assert set(rows) == {"DGS10_daily_chg_z", "VIX_weekly_chg_z"}
    assert rows["DGS10_daily_chg_z"]["as_of"] == "2026-10-20"
    vix = rows["VIX_weekly_chg_z"]
    assert vix["raw_value"] == 1.0 and vix["as_of"] == "2026-10-16"
    assert vix["interpretation"] == "VIX (volatility) rose (+1.0 pts on the week) — 2.5σ below its usual move"


# ── sentences ────────────────────────────────────────────────────────────────

def test_the_direction_word_follows_the_move():
    f = z_interpretation
    # agreeing signs: today's sentence, unchanged
    assert f("VIX_weekly_chg_z", "VIX", 2.6, 4.0) == "VIX surged sharply (+4.0 pts on the week) — 2.6σ move"
    assert f("SPY_weekly_ret_z", "SPY", -1.6, -0.02) == "SPY fell notably (-2.00% on the week) — 1.6σ move"
    # a rise smaller than the usual rise
    assert f("VIX_daily_chg_z", "VIX (daily)", -2.5, 1.0) == "VIX (daily) rose (+1.0 pts on the day) — 2.5σ below its usual move"
    # a fall smaller than the usual fall
    assert f("DGS10_weekly_chg_z", "10Y", 1.2, -0.03) == "10Y fell (-3 bps on the week) — 1.2σ above its usual move"
    assert f("SPY_weekly_ret_z", "SPY", 1.0, 0.0) == "SPY was unchanged (+0.00% on the week) — 1.0σ above its usual move"
    assert f("SPY_weekly_ret_z", "SPY", 1.0, -0.0) == "SPY was unchanged (+0.00% on the week) — 1.0σ above its usual move"
    assert f("DGS10_weekly_chg_z", "10Y", 0.0, -0.0004) == "10Y fell (-0 bps on the week) — at its usual move"
    # no raw move: no direction word
    assert f("VIX_weekly_chg_z", "VIX", 2.6, None) == "VIX: a 2.6σ weekly move above its usual move"
    assert f("VIX_daily_chg_z", "VIX (daily)", -1.0, float("nan")) == "VIX (daily): a 1.0σ one-day move below its usual move"
    # CPI is a level, unchanged
    assert f("CPI_yoy_z", "CPI YoY", 3.9, 3.46) == "CPI runs at 3.46% YoY — a 3.9σ high reading vs its recent range"


def test_the_unemployment_sentence_says_what_the_weekly_difference_measures():
    f = z_interpretation
    assert f("UNRATE_weekly_chg_z", "Unemployment rate", 2.0, 0.2) == (
        "Unemployment rate surged notably (+0.20pp, latest print vs a week earlier) — 2.0σ move")
    # a week with no new print
    assert f("UNRATE_weekly_chg_z", "Unemployment rate", 0.3, 0.0) == (
        "Unemployment rate was unchanged (+0.00pp, latest print vs a week earlier) — 0.3σ above its usual move")


def test_the_memo_prints_the_vix_raw_move_from_the_z_rows_date():
    from src import memo
    wide = pd.DataFrame(
        {"VIX_weekly_chg_z": [None, -2.5], "VIX_weekly_chg": [9.0, 1.0]},
        index=pd.DatetimeIndex(["2026-10-23", "2026-10-16"]),
    )
    rows = memo.build_surprise_ranking(wide)
    assert rows[0]["raw_value"] == 1.0
    assert rows[0]["interpretation"] == "VIX (volatility) rose (+1.0 pts on the week) — 2.5σ below its usual move"


# ── alerts ───────────────────────────────────────────────────────────────────

def _alerts_on(path, rows):
    _derived(path, rows)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [(r[2], r[0], r[3]) for r in alerts.build_market_alerts(conn)]
    finally:
        conn.close()


def test_a_weekly_vix_shock_is_dated_by_its_observation_and_needs_a_rise(tmp_path):
    base = [("VIX_weekly_chg_z", "2026-10-23", 3.2), ("VIX_weekly_chg_obs", "2026-10-23", ORD("2026-10-19"))]
    assert _alerts_on(tmp_path / "a.db", base + [("VIX_weekly_chg", "2026-10-23", 6.0)]) == [("VIX_shock", "2026-10-19", "risk")]
    assert _alerts_on(tmp_path / "b.db", base + [("VIX_weekly_chg", "2026-10-23", -0.01)]) == []
    assert _alerts_on(tmp_path / "c.db", base + [("VIX_weekly_chg", "2026-10-23", 0.0)]) == []
    assert _alerts_on(tmp_path / "d.db", base) == []  # no raw move
    # no observation row: never dated by the bucket
    assert _alerts_on(tmp_path / "e.db", [("VIX_weekly_chg_z", "2026-10-23", 3.2), ("VIX_weekly_chg", "2026-10-23", 6.0)]) == []


def test_a_daily_vix_jump_is_the_newest_sessions_rise_only(tmp_path):
    newest = ("VIX_daily_newest", "2026-10-21", ORD("2026-10-21"))
    rise = [("VIX_daily_chg_z", "2026-10-21", 2.4), ("VIX_daily_chg", "2026-10-21", 3.0)]
    assert _alerts_on(tmp_path / "a.db", rise + [newest]) == [("VIX_daily_jump", "2026-10-21", "watch")]
    assert _alerts_on(tmp_path / "b.db", rise) == []  # an older store: not known to be current
    assert _alerts_on(tmp_path / "c.db", rise + [("VIX_daily_newest", "2026-10-22", ORD("2026-10-22"))]) == []
    fall = [("VIX_daily_chg_z", "2026-10-21", 11.1), ("VIX_daily_chg", "2026-10-21", -0.01), newest]
    assert _alerts_on(tmp_path / "d.db", fall) == []


def test_a_stored_jump_is_cleared_when_the_newest_move_is_ineligible(tmp_path, monkeypatch):
    path = tmp_path / "t.db"
    _derived(path, [("VIX_daily_chg_z", "2026-10-19", 3.5), ("VIX_daily_chg", "2026-10-19", 4.0),
                    ("VIX_daily_newest", "2026-10-21", ORD("2026-10-21"))])
    conn = sqlite3.connect(path)
    conn.execute("INSERT INTO alert_feed (date, alert_type, name, level, value, threshold, direction, message, created_at) "
                 "VALUES ('2026-10-19', 'market', 'VIX_daily_jump', 'risk', 3.5, 3.0, 'above', 'x', 'x')")
    conn.commit()
    conn.close()
    monkeypatch.setattr(alerts, "DB_PATH", path)
    monkeypatch.setattr(alerts, "build_macro_alerts", lambda conn: [])
    alerts.run()
    with sqlite3.connect(path) as conn:
        assert conn.execute("SELECT COUNT(*) FROM alert_feed").fetchone()[0] == 0
