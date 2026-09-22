"""B6 (2026-09-18): scripts/restate_market_daily.py, written and never run here.

Four stored daily "closes" are mid-session prices (2026-09-01, 09-02, 09-03 and
09-10 for all 23 symbols). The owner decided: write a restatement script, do
not run it and leave the published rows alone. These tests pin its behaviour
on a temporary database with a stubbed fetch: dry-run by default, --apply
overwrites only the named rows that exist, and an unfinished session is refused.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

import pandas as pd
import pytest

from scripts import restate_market_daily as rs

COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "vwap"]
AFTER_CLOSE = datetime(2026, 9, 19, 0, 30, tzinfo=timezone.utc)


class Official:
    """Official daily bars as the vendor serves them after the close."""

    def __init__(self):
        self.bars = {
            ("SPY", "2026-09-02"): 766.0,
            ("SPY", "2026-09-03"): 773.11,
            ("QQQ", "2026-09-03"): 640.5,
        }

    def fetch_daily(self, symbol, start, end):
        rows = [(s, d, c, c, c, c, 1.0, None) for (s, d), c in self.bars.items() if s == symbol and start <= d <= end]
        return pd.DataFrame(rows, columns=COLS)


@pytest.fixture()
def db(tmp_path):
    path = tmp_path / "md.db"
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE market_daily (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,"
        " volume REAL, vwap REAL, source TEXT, fetched_at TEXT, UNIQUE(symbol, date))"
    )
    conn.executemany(
        "INSERT INTO market_daily (symbol, date, open, high, low, close, volume, source, fetched_at) VALUES (?,?,?,?,?,?,?,?,?)",
        [
            ("SPY", "2026-09-03", 770.0, 771.0, 767.0, 768.66, 5.0, "yfinance", "2026-09-03T17:47:00"),
            ("SPY", "2026-09-04", 770.0, 772.0, 769.0, 770.0, 9.0, "yfinance", "2026-09-05T04:00:00"),
            ("QQQ", "2026-09-03", 639.0, 640.0, 637.0, 638.0, 4.0, "yfinance", "2026-09-03T17:47:00"),
        ],
    )
    conn.commit()
    conn.close()
    return path


def _close(path, symbol, day):
    conn = sqlite3.connect(path)
    try:
        row = conn.execute("SELECT close FROM market_daily WHERE symbol=? AND date=?", (symbol, day)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


def test_dry_run_reports_and_writes_nothing(db):
    plan = rs.restate(db, dates=["2026-09-03"], symbols=["SPY", "QQQ"], client=Official(), apply=False, now=AFTER_CLOSE)
    diffs = {(p["symbol"], p["date"]): p for p in plan}
    assert diffs[("SPY", "2026-09-03")]["stored_close"] == 768.66
    assert diffs[("SPY", "2026-09-03")]["official_close"] == 773.11
    assert _close(db, "SPY", "2026-09-03") == 768.66  # untouched


def test_apply_overwrites_only_the_named_rows_that_exist(db):
    rs.restate(db, dates=["2026-09-02", "2026-09-03"], symbols=["SPY"], client=Official(), apply=True, now=AFTER_CLOSE)
    assert _close(db, "SPY", "2026-09-03") == 773.11
    assert _close(db, "QQQ", "2026-09-03") == 638.0  # not named
    assert _close(db, "SPY", "2026-09-04") == 770.0  # not named
    assert _close(db, "SPY", "2026-09-02") is None  # never inserted: restating is not backfilling


def test_an_unfinished_session_is_refused(db):
    mid_session = datetime(2026, 9, 18, 15, 0, tzinfo=timezone.utc)
    with pytest.raises(SystemExit):
        rs.restate(db, dates=["2026-09-18"], symbols=["SPY"], client=Official(), apply=True, now=mid_session)


def test_the_cli_defaults_to_a_dry_run():
    args = rs.parse_args(["--dates", "2026-09-01,2026-09-02", "--db", "x.db"])
    assert args.apply is False and args.dates == ["2026-09-01", "2026-09-02"]
    assert rs.BAD_CLOSE_DATES == ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10"]
