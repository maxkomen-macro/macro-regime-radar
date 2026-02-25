from src.utils.db import get_connection

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS raw_series (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id   TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    value       REAL    NOT NULL,
    fetched_at  TEXT    NOT NULL,
    UNIQUE(series_id, date)
);

CREATE TABLE IF NOT EXISTS regimes (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    date             TEXT    NOT NULL UNIQUE,
    label            TEXT    NOT NULL,
    confidence       REAL    NOT NULL,
    growth_trend     REAL,
    inflation_trend  REAL,
    computed_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,
    signal_name  TEXT    NOT NULL,
    value        REAL    NOT NULL,
    triggered    INTEGER NOT NULL,
    computed_at  TEXT    NOT NULL,
    UNIQUE(date, signal_name)
);
"""


def init_db() -> None:
    """Create all tables if they do not already exist. Safe to call on every run."""
    conn = get_connection()
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
        print("[database] Schema initialized.")
    finally:
        conn.close()
