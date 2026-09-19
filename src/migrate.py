"""
src/migrate.py — Add Trader Pack tables to macro_radar.db.

Run once (safe to re-run — all CREATE TABLE IF NOT EXISTS):
    python src/migrate.py

Does NOT import src.config to avoid FRED_API_KEY EnvironmentError.
"""
import sqlite3
import sys
from pathlib import Path

ROOT    = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "data" / "macro_radar.db"

# The base event_calendar table. B5 (2026-09-19): the nullable `symbol` and
# `kind` columns and the unique index arrive through
# ensure_event_calendar_schema(), so one path upgrades old and new files alike.
EVENT_CALENDAR_DDL = """
CREATE TABLE IF NOT EXISTS event_calendar (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name     TEXT    NOT NULL,
    event_datetime TEXT    NOT NULL,          -- ISO 8601: YYYY-MM-DDTHH:MM:SSZ
    importance     TEXT    NOT NULL,          -- "high" | "medium" | "low"
    source         TEXT    NOT NULL DEFAULT 'manual_csv',
    created_at     TEXT    NOT NULL
);
"""
EVENT_CALENDAR_INDEX = "idx_event_calendar_uniq"

MIGRATION_SQL = """
CREATE TABLE IF NOT EXISTS market_daily (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT    NOT NULL,
    date       TEXT    NOT NULL,              -- YYYY-MM-DD
    open       REAL    NOT NULL,
    high       REAL    NOT NULL,
    low        REAL    NOT NULL,
    close      REAL    NOT NULL,
    volume     REAL    NOT NULL,
    vwap       REAL,                          -- nullable
    source     TEXT    NOT NULL DEFAULT 'polygon',
    fetched_at TEXT    NOT NULL,
    UNIQUE(symbol, date)
);

CREATE TABLE IF NOT EXISTS market_intraday (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT    NOT NULL,
    ts         TEXT    NOT NULL,              -- ISO 8601 UTC: YYYY-MM-DDTHH:MM:SSZ
    interval   TEXT    NOT NULL DEFAULT '5m',
    open       REAL    NOT NULL,
    high       REAL    NOT NULL,
    low        REAL    NOT NULL,
    close      REAL    NOT NULL,
    volume     REAL    NOT NULL,
    vwap       REAL,
    source     TEXT    NOT NULL DEFAULT 'polygon',
    fetched_at TEXT    NOT NULL,
    UNIQUE(symbol, ts, interval)
);

CREATE TABLE IF NOT EXISTS derived_metrics (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT    NOT NULL,             -- e.g. "SPY_weekly_ret"
    date        TEXT    NOT NULL,             -- YYYY-MM-DD (week-end Friday)
    value       REAL    NOT NULL,
    computed_at TEXT    NOT NULL,
    UNIQUE(name, date)
);

CREATE TABLE IF NOT EXISTS alert_feed (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,             -- YYYY-MM-DD
    alert_type  TEXT    NOT NULL,             -- "macro_signal" | "market"
    name        TEXT    NOT NULL,
    level       TEXT    NOT NULL,             -- "info" | "watch" | "risk"
    value       REAL,
    threshold   REAL,
    direction   TEXT,                         -- "above" | "below" | NULL
    message     TEXT    NOT NULL,
    created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS backtest_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    test_name   TEXT    NOT NULL,             -- e.g. "SPY_signal_yield_curve_inversion"
    cohort      TEXT    NOT NULL,             -- signal_name or regime_label
    horizon     TEXT    NOT NULL,             -- "1M" | "3M" | "6M" | "12M"
    metric      TEXT    NOT NULL,             -- "avg_return" | "median_return" | "hit_rate" | "n"
    value       REAL    NOT NULL,
    computed_at TEXT    NOT NULL
);
""" + EVENT_CALENDAR_DDL + """
CREATE TABLE IF NOT EXISTS factor_data (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    date        TEXT    NOT NULL,             -- YYYY-MM-DD
    mkt_rf      REAL,                         -- Mkt minus Rf, decimal (not %)
    smb         REAL,                         -- Small-minus-Big
    hml         REAL,                         -- High-minus-Low
    rmw         REAL,                         -- Robust-minus-Weak
    cma         REAL,                         -- Conservative-minus-Aggressive
    rf          REAL,                         -- risk-free (decimal)
    source      TEXT    NOT NULL DEFAULT 'openbb_kenneth_french',
    fetched_at  TEXT    NOT NULL,
    UNIQUE(date)
);
"""


def ensure_event_calendar_schema(conn: sqlite3.Connection) -> None:
    """Additive, idempotent event_calendar upgrade (B5, 2026-09-19).

    - `symbol` and `kind`: nullable TEXT columns for rows that belong to one
      ticker (src/events/earnings.py writes kind 'earnings'); hand-maintained
      rows leave both NULL. Added with ALTER TABLE only when missing.
    - idx_event_calendar_uniq on (event_name, event_datetime), which the
      published database already carries (it was added outside this script)
      and load_events.py's INSERT OR IGNORE relies on. An existing index of
      that name is left exactly as it is. When duplicate pairs are already
      stored the index is not created and no row is removed; a warning says so.
    """
    conn.execute(EVENT_CALENDAR_DDL)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(event_calendar)")}
    for col in ("symbol", "kind"):
        if col not in cols:
            conn.execute(f"ALTER TABLE event_calendar ADD COLUMN {col} TEXT")
    if conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?", (EVENT_CALENDAR_INDEX,)
    ).fetchone():
        return
    if conn.execute(
        "SELECT 1 FROM event_calendar GROUP BY event_name, event_datetime HAVING COUNT(*) > 1 LIMIT 1"
    ).fetchone():
        print(
            f"[migrate] WARNING: event_calendar holds duplicate (event_name, event_datetime) pairs; "
            f"{EVENT_CALENDAR_INDEX} not created and no row removed.",
            file=sys.stderr,
        )
        return
    conn.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {EVENT_CALENDAR_INDEX} ON event_calendar(event_name, event_datetime)")


def run_migration() -> None:
    if not DB_PATH.exists():
        print(f"[migrate] ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        sys.exit(1)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        conn.executescript(MIGRATION_SQL)
        ensure_event_calendar_schema(conn)
        conn.commit()
        print("[migrate] All Trader Pack tables created (or already exist).")
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).fetchall()
        print(f"[migrate] Tables in DB: {[t[0] for t in tables]}")
    finally:
        conn.close()


if __name__ == "__main__":
    run_migration()
