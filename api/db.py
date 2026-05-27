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
    with _connect() as conn:
        row = conn.execute(
            "SELECT date, label, confidence, growth_trend, inflation_trend, "
            "prob_goldilocks, prob_overheating, prob_stagflation, prob_recession "
            "FROM regimes ORDER BY date DESC LIMIT 1"
        ).fetchone()
    return dict(row) if row else None


def latest_signals() -> dict | None:
    with _connect() as conn:
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
    with _connect() as conn:
        rows = conn.execute(
            "SELECT DISTINCT series_id FROM raw_series ORDER BY series_id"
        ).fetchall()
    return [r["series_id"] for r in rows]


def latest_series_all() -> list[dict]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT r.series_id, r.date, r.value FROM raw_series r "
            "JOIN (SELECT series_id, MAX(date) AS md FROM raw_series GROUP BY series_id) m "
            "  ON r.series_id = m.series_id AND r.date = m.md "
            "ORDER BY r.series_id"
        ).fetchall()
    return [dict(r) for r in rows]


def latest_series_one(series_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute(
            "SELECT series_id, date, value FROM raw_series "
            "WHERE series_id = ? ORDER BY date DESC LIMIT 1",
            (series_id,),
        ).fetchone()
    return dict(row) if row else None
