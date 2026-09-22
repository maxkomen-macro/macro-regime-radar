"""B6 (2026-09-18): a daily bar is stored only once its session is complete.

Main's morning full runs fire hours late and landed mid-session, so the
incremental fetch stored today's unfinished bar as the "close" and, starting
from max date + 1, never revisited it (2026-09-01/02/03/10). The session rule
uses the real NYSE session end (16:00 ET, 13:00 ET on half-days) plus a buffer;
waiting longer is fine, writing a partial bar is not. src/ may not import
api/calendar.py (lean market requirements), so a parity test pins the copy.
"""

from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta, timezone

import pandas as pd
import pytest

from api import calendar as cal
from src import watermarks
from src.market_data import fetch_market as fm
from src.market_data import session

DAILY_COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "vwap"]
INTRADAY_COLS = ["symbol", "ts", "open", "high", "low", "close", "volume", "vwap"]


def _utc(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


# ── the session rule ─────────────────────────────────────────────────────────


def test_session_tables_match_api_calendar():
    assert session.HOLIDAYS == cal.HOLIDAYS
    assert session.EARLY_CLOSES == cal.EARLY_CLOSES
    d = date(2025, 1, 1)
    while d <= date(2027, 12, 31):
        bounds = cal.session_bounds(d)
        close = session.session_close_utc(d)
        assert (bounds[1] if bounds else None) == close, d
        d += timedelta(days=1)


def test_regular_day_bar_completes_after_the_close_plus_buffer():
    bar = date(2026, 9, 17)  # Thursday, 16:00 EDT = 20:00Z
    assert session.bar_is_complete(bar, _utc(2026, 9, 17, 14, 41)) is False  # 10:41 ET: mid-session
    assert session.bar_is_complete(bar, _utc(2026, 9, 17, 20, 10)) is False  # 16:10 ET: inside the buffer
    assert session.bar_is_complete(bar, _utc(2026, 9, 17, 20, 30)) is True  # 16:30 ET
    assert session.bar_is_complete(bar, _utc(2026, 9, 18, 0, 23)) is True  # the 00:23Z post-close run
    assert session.bar_is_complete(date(2026, 9, 16), _utc(2026, 9, 17, 14, 41)) is True


def test_half_day_uses_the_real_one_pm_close():
    bar = date(2026, 11, 27)  # day after Thanksgiving, 13:00 EST = 18:00Z
    assert session.bar_is_complete(bar, _utc(2026, 11, 27, 18, 10)) is False
    assert session.bar_is_complete(bar, _utc(2026, 11, 27, 18, 30)) is True


def test_unknown_year_waits_for_a_full_session():
    # 2029 is not in the published tables: a possible half-day is treated as a
    # full 16:00 session, which only ever waits longer.
    assert session.bar_is_complete(date(2029, 11, 23), _utc(2029, 11, 23, 18, 30)) is False
    assert session.bar_is_complete(date(2029, 11, 23), _utc(2029, 11, 23, 21, 30)) is True


# ── the fetch paths ──────────────────────────────────────────────────────────


class StubClient:
    def __init__(self, bars: dict[str, list[tuple[str, float]]]):
        self.bars = bars
        self.daily_calls: list[tuple[str, str, str]] = []

    def fetch_daily(self, symbol, start, end):
        self.daily_calls.append((symbol, start, end))
        rows = [(symbol, d, c, c, c, c, 1000.0, None) for d, c in self.bars.get(symbol, []) if start <= d <= end]
        return pd.DataFrame(rows, columns=DAILY_COLS)

    def fetch_intraday_5m(self, symbol, start, end):
        return pd.DataFrame(columns=INTRADAY_COLS)


@pytest.fixture()
def db(tmp_path, monkeypatch):
    path = tmp_path / "market.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE market_daily (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,
            volume REAL, vwap REAL, source TEXT, fetched_at TEXT, UNIQUE(symbol, date));
        CREATE TABLE market_intraday (symbol TEXT, ts TEXT, interval TEXT, open REAL, high REAL, low REAL,
            close REAL, volume REAL, vwap REAL, source TEXT, fetched_at TEXT, UNIQUE(symbol, ts, interval));
        """
    )
    conn.executemany(
        "INSERT INTO market_daily (symbol, date, close, source) VALUES (?,?,?,?)",
        [("SPY", "2026-09-16", 700.0, "yfinance"), ("QQQ", "2026-09-16", 600.0, "yfinance")],
    )
    conn.commit()
    conn.close()
    monkeypatch.setattr(fm, "DB_PATH", path)
    return path


def _stored(path, symbol):
    conn = sqlite3.connect(path)
    try:
        return dict(conn.execute("SELECT date, close FROM market_daily WHERE symbol=? ORDER BY date", (symbol,)).fetchall())
    finally:
        conn.close()


def _watermark(path, source):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return watermarks.read_all(conn).get(source)
    finally:
        conn.close()


BARS = {"SPY": [("2026-09-16", 700.0), ("2026-09-17", 705.5)], "QQQ": [("2026-09-16", 600.0), ("2026-09-17", 603.0)]}
ASSETS = {"daily": ["SPY", "QQQ"], "intraday": []}


def test_mid_session_incremental_never_stores_todays_bar(db):
    fm.run_incremental(StubClient(BARS), ASSETS, now=_utc(2026, 9, 17, 14, 41))
    assert "2026-09-17" not in _stored(db, "SPY")
    wm = _watermark(db, "market_daily")
    assert wm["last_obs"] == "2026-09-16" and wm["status"] == "ok"


def test_post_close_incremental_stores_the_official_close(db):
    fm.run_incremental(StubClient(BARS), ASSETS, now=_utc(2026, 9, 17, 14, 41))
    first = _watermark(db, "market_daily")
    fm.run_incremental(StubClient(BARS), ASSETS, now=_utc(2026, 9, 18, 0, 23))
    assert _stored(db, "SPY")["2026-09-17"] == 705.5
    wm = _watermark(db, "market_daily")
    assert wm["last_obs"] == "2026-09-17"
    assert wm["advanced_at"] > first["advanced_at"]


def test_half_day_incremental_waits_for_the_early_close(db, monkeypatch):
    bars = {"SPY": [("2026-11-27", 710.0)], "QQQ": [("2026-11-27", 610.0)]}
    conn = sqlite3.connect(db)
    conn.execute("UPDATE market_daily SET date='2026-11-25'")
    conn.commit()
    conn.close()
    fm.run_incremental(StubClient(bars), ASSETS, now=_utc(2026, 11, 27, 18, 10))
    assert "2026-11-27" not in _stored(db, "SPY")
    fm.run_incremental(StubClient(bars), ASSETS, now=_utc(2026, 11, 27, 18, 30))
    assert _stored(db, "SPY")["2026-11-27"] == 710.0


def test_market_daily_watermark_names_laggards(db):
    bars = {"SPY": BARS["SPY"], "QQQ": BARS["QQQ"][:1]}  # QQQ has no bar for the 17th
    fm.run_incremental(StubClient(bars), ASSETS, now=_utc(2026, 9, 18, 0, 23))
    wm = _watermark(db, "market_daily")
    assert wm["last_obs"] == "2026-09-16"  # the earliest latest date across symbols
    assert "QQQ" in (wm["detail"] or "")


def test_backfill_drops_the_unfinished_bar(db):
    fm.run_backfill(StubClient(BARS), ASSETS, 1, now=_utc(2026, 9, 17, 15, 0))
    assert "2026-09-17" not in _stored(db, "SPY")


def test_post_close_intraday_run_captures_the_close(db):
    client = StubClient(BARS)
    assets = {"daily": ["SPY", "QQQ"], "intraday": ["SPY"]}
    fm.run_intraday_only(now=_utc(2026, 9, 17, 15, 0), client=client, assets=assets)
    assert "2026-09-17" not in _stored(db, "SPY")
    assert client.daily_calls == []  # mid-session: the daily path is not touched
    fm.run_intraday_only(now=_utc(2026, 9, 17, 20, 45), client=client, assets=assets)
    assert _stored(db, "SPY")["2026-09-17"] == 705.5
    assert _stored(db, "QQQ")["2026-09-17"] == 603.0
