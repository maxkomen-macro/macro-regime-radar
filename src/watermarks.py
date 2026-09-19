"""Source watermarks: when each source's newest observation last advanced (B6, 2026-09-18).

raw_series stores every daily FRED series as one row per month dated the 1st,
so the stored date says nothing about how fresh a daily value is; counting lag
from it produced a false "nine business days behind" on current values. This
table records, per source, the true date of the newest observation, its value,
when that date last moved forward (advanced_at) and when the source was last
checked (checked_at). A source that keeps being checked without advancing is
the watchdog's signal of a missed publication cycle. Additive: no stored
history changes. Stdlib only (it runs on the lean market requirement set).
Read by api/freshness.py (through api/db.py) and scripts/validate_db.py.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone

DDL = """
CREATE TABLE IF NOT EXISTS source_watermarks (
    source      TEXT PRIMARY KEY,
    last_obs    TEXT,
    last_value  REAL,
    advanced_at TEXT,
    checked_at  TEXT NOT NULL,
    status      TEXT NOT NULL,
    detail      TEXT
)
"""
COLUMNS = ("source", "last_obs", "last_value", "advanced_at", "checked_at", "status", "detail")


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(DDL)


def _stamp(now: datetime | None) -> str:
    return (now or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def record(
    conn: sqlite3.Connection,
    source: str,
    last_obs: str | None,
    last_value: float | None = None,
    *,
    status: str = "ok",
    detail: str | None = None,
    now: datetime | None = None,
) -> str:
    """Upsert one source and return the status recorded.

    advanced_at moves only when last_obs moves forward. A backward move (a
    provider revision) is recorded as served, flagged status='revised', and is
    not an advance. last_obs=None is a check that observed nothing (an error):
    the previous observation is kept and the status and detail say why.
    """
    ensure_table(conn)
    ts = _stamp(now)
    row = conn.execute("SELECT last_obs, last_value, advanced_at FROM source_watermarks WHERE source = ?", (source,)).fetchone()
    prev_obs, prev_value, prev_adv = (row[0], row[1], row[2]) if row else (None, None, None)
    if last_obs is None:
        last_obs, last_value, advanced = prev_obs, prev_value, prev_adv
    elif prev_obs is None or last_obs > prev_obs:
        advanced = ts
    else:
        advanced = prev_adv
        if last_obs < prev_obs and status == "ok":
            status = "revised"
            detail = detail or f"newest observation moved back from {prev_obs}"
    conn.execute(
        """
        INSERT INTO source_watermarks (source, last_obs, last_value, advanced_at, checked_at, status, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source) DO UPDATE SET
            last_obs = excluded.last_obs, last_value = excluded.last_value,
            advanced_at = excluded.advanced_at, checked_at = excluded.checked_at,
            status = excluded.status, detail = excluded.detail
        """,
        (source, last_obs, last_value, advanced, ts, status, detail),
    )
    return status


def read_all(conn: sqlite3.Connection) -> dict[str, dict]:
    """Every watermark keyed by source; {} when the table does not exist yet."""
    exists = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'source_watermarks'").fetchone()
    if not exists:
        return {}
    rows = conn.execute(f"SELECT {', '.join(COLUMNS)} FROM source_watermarks").fetchall()
    return {r[0]: dict(zip(COLUMNS, tuple(r))) for r in rows}
