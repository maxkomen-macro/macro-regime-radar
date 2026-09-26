"""api/provenance.py — which refresh committed each Desk row (desk/hardening, Codex R-14, R-15).

Every `desk_series` row carries the refresh run that committed it (`run_id`) and
when (`ingested_at`, UTC), and `desk_series_runs` records each run: when it
started, its New York date (`as_of`), and when its first write committed. The
Desk reads a stored row only when a committed run wrote it and its date passes
the date checks, one of which is the run's New York date: the store never
commits a row dated after its run's day (market rows stop at the last
completed session; a tier-2 FRED row dated after the run is quarantined), so a
row dated after it is set aside as future-dated. A row without provenance
(`run_id` NULL, or naming a run that never committed) was not written by the
store: the reader sets it aside as hand-inserted, counted, warned and hashed
like a malformed date (verifier V-22), and validate_db fails one in a tier-1
series. Eligibility no longer comes from the `advanced_at` watermark
(verifier V-34), which a successful FRED fetch moved past a hand row it never
replaced (R-14) and a repaired future print left behind (R-15).

The schema change (`migrate`) is additive and idempotent. It adds the two
columns and the runs table, and back-fills the rows stored before it, once,
with one synthetic run, `pre-provenance`, marked committed and dated the
migration's New York date, so a store written before provenance stays
readable. A row inserted after that has no provenance until a refresh writes
it. The store applies it at the start of every refresh; the API applies it to
each generation's in-memory copy when it stages one (the file stays
read-only). A reader of a file not yet migrated reads it as the migration
would leave it: every row committed, dated no later than the read's as-of.

Stdlib + api only: api/freshness.py and scripts/validate_db.py import it.
"""

from __future__ import annotations

import secrets
import sqlite3
import time
from datetime import datetime, timezone

from api import calendar as cal

RUNS = "desk_series_runs"
PRE_PROVENANCE = "pre-provenance"
RUNS_DDL = f"""
CREATE TABLE IF NOT EXISTS {RUNS} (
    run_id       TEXT PRIMARY KEY,
    started_at   TEXT NOT NULL,   -- UTC
    as_of        TEXT NOT NULL,   -- the run's New York date: no row it commits is dated after it
    committed_at TEXT,            -- UTC, when its first write committed; NULL while nothing has
    status       TEXT NOT NULL    -- started | committed
) WITHOUT ROWID
"""


def _stamp(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def ny_date(now: datetime) -> str:
    return now.astimezone(cal.NY).date().isoformat()


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}


# Codex R-27: a schema read that raises is retried up to three times, and one that still raises
# is an error, never "legacy": a store is read without provenance only when a read that
# completed shows the columns absent. The retries are 0.2, 0.3 and 0.5 s apart, but each read,
# the first and the three retries, may also wait out SQLite's busy timeout (Python's default,
# 5 s): 4 × 5 s + 1 s, about 23 s at worst as measured (verifier V-48, 22.8 s).
SCHEMA_RETRY_WAITS_S = (0.2, 0.3, 0.5)
SQLITE_BUSY_DEFAULT_S = 5.0


class SchemaCheckFailed(sqlite3.OperationalError):
    """Whether desk_series carries provenance (or a table exists) could not be read."""


def _schema_read(what: str, read):
    last: Exception | None = None
    for attempt in range(len(SCHEMA_RETRY_WAITS_S) + 1):
        try:
            return read()
        except sqlite3.OperationalError as exc:  # locked, busy: a schema read that did not complete
            last = exc
            if attempt < len(SCHEMA_RETRY_WAITS_S):
                time.sleep(SCHEMA_RETRY_WAITS_S[attempt])
    tries = len(SCHEMA_RETRY_WAITS_S) + 1
    raise SchemaCheckFailed(f"could not read {what} ({type(last).__name__}: {last}) after {tries} tries: the read and "
                            f"{tries - 1} retries, {sum(SCHEMA_RETRY_WAITS_S):g} s apart in all, each waiting up to "
                            f"SQLite's busy timeout ({SQLITE_BUSY_DEFAULT_S:g} s by default), so about 23 s at worst") from last


def is_migrated(conn: sqlite3.Connection) -> bool:
    """True when desk_series carries provenance and the runs table exists; False
    only when both reads completed and show it does not (Codex R-27). A read that
    keeps failing raises SchemaCheckFailed."""
    def read() -> bool:
        has_runs = conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (RUNS,)).fetchone()
        return bool(has_runs) and {"run_id", "ingested_at"} <= _columns(conn, "desk_series")
    return _schema_read("whether desk_series carries provenance", read)


def table_exists(conn: sqlite3.Connection, name: str) -> bool:
    """Whether a table exists, read the same fail-closed way (Codex R-27)."""
    return _schema_read(f"whether the {name} table exists", lambda: conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (name,)).fetchone() is not None)


def migrate(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Add provenance to desk_series, idempotently, in one savepoint. Rows stored
    before it are back-filled once with the committed `pre-provenance` run, dated
    `now`'s New York date; returns how many. A database without desk_series, or
    one already migrated, is left as it is (0)."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'desk_series'").fetchone():
        return 0
    if is_migrated(conn):
        return 0
    now = now or datetime.now(timezone.utc)
    conn.execute("SAVEPOINT desk_provenance")
    try:
        conn.execute(RUNS_DDL)
        cols = _columns(conn, "desk_series")
        if "run_id" not in cols:
            conn.execute("ALTER TABLE desk_series ADD COLUMN run_id TEXT")
        if "ingested_at" not in cols:
            conn.execute("ALTER TABLE desk_series ADD COLUMN ingested_at TEXT")
        n = conn.execute("SELECT COUNT(*) FROM desk_series WHERE run_id IS NULL").fetchone()[0]
        if n:
            stamp = _stamp(now)
            conn.execute(f"INSERT OR IGNORE INTO {RUNS} (run_id, started_at, as_of, committed_at, status) VALUES (?, ?, ?, ?, 'committed')",
                         (PRE_PROVENANCE, stamp, ny_date(now), stamp))
            conn.execute("UPDATE desk_series SET run_id = ?, ingested_at = ? WHERE run_id IS NULL", (PRE_PROVENANCE, stamp))
        conn.execute("RELEASE desk_provenance")
    except BaseException:
        conn.execute("ROLLBACK TO desk_provenance")
        conn.execute("RELEASE desk_provenance")
        raise
    return int(n)


def start_run(conn: sqlite3.Connection, now: datetime) -> tuple[str, str]:
    """Record a refresh run as started; returns (run_id, its New York date)."""
    run_id = f"{now.astimezone(timezone.utc):%Y%m%dT%H%M%SZ}-{secrets.token_hex(4)}"
    as_of = ny_date(now)
    conn.execute(f"INSERT INTO {RUNS} (run_id, started_at, as_of, committed_at, status) VALUES (?, ?, ?, NULL, 'started')",
                 (run_id, _stamp(now), as_of))
    return run_id, as_of


def mark_committed(conn: sqlite3.Connection, run_id: str, now: datetime) -> None:
    """Inside the savepoint of a write: the run has committed a write, so its
    rows are eligible (idempotent; the first commit's time is kept)."""
    conn.execute(f"UPDATE {RUNS} SET status = 'committed', committed_at = COALESCE(committed_at, ?) WHERE run_id = ?",
                 (_stamp(now), run_id))


# The reader's join (alias `d` for desk_series, `r` for the committing run): `r.run_id`
# is NULL for a row without provenance, including one naming a run that never committed.
COMMITTED_JOIN = f"LEFT JOIN {RUNS} r ON r.run_id = d.run_id AND r.status = 'committed'"
