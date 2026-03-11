"""
src/events/load_events.py — Load events/calendar.csv into event_calendar table.

Does NOT import src.config to avoid FRED_API_KEY EnvironmentError.

Run:
    python src/events/load_events.py

CSV must have headers: event_name, event_datetime, importance
Rows with blank required fields are skipped with a warning.
Duplicate (event_name, event_datetime) pairs are silently ignored on re-runs
(INSERT OR IGNORE semantics).
"""
import csv
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent.parent
DB_PATH  = ROOT / "data" / "macro_radar.db"
CSV_PATH = ROOT / "events" / "calendar.csv"

REQUIRED_COLS = {"event_name", "event_datetime", "importance"}
VALID_IMPORTANCE = {"high", "medium", "low"}


def _get_conn() -> sqlite3.Connection:
    if not DB_PATH.exists():
        print(f"[events] ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        print("[events] Run: python src/migrate.py first.", file=sys.stderr)
        sys.exit(1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _validate_iso_datetime(dt_str: str) -> bool:
    """Return True if the string is ISO 8601 parseable."""
    for fmt in ("%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d"):
        try:
            datetime.strptime(dt_str, fmt)
            return True
        except ValueError:
            continue
    return False


def load_events() -> int:
    """
    Read CSV and upsert rows into event_calendar.
    Returns count of rows successfully inserted.
    """
    if not CSV_PATH.exists():
        print(f"[events] ERROR: Calendar CSV not found at {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    created_at = datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
    good_rows: list[tuple] = []
    skipped = 0

    with open(CSV_PATH, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = set(reader.fieldnames or [])
        missing = REQUIRED_COLS - fieldnames
        if missing:
            print(f"[events] ERROR: CSV missing required columns: {missing}", file=sys.stderr)
            sys.exit(1)

        for lineno, row in enumerate(reader, start=2):
            name  = row.get("event_name",     "").strip()
            dt    = row.get("event_datetime",  "").strip()
            imp   = row.get("importance",      "").strip().lower()

            if not (name and dt and imp):
                print(f"[events] WARNING: line {lineno} — blank required field, skipping.")
                skipped += 1
                continue

            if not _validate_iso_datetime(dt):
                print(
                    f"[events] WARNING: line {lineno} — "
                    f"invalid datetime '{dt}', skipping."
                )
                skipped += 1
                continue

            if imp not in VALID_IMPORTANCE:
                print(
                    f"[events] WARNING: line {lineno} — "
                    f"unknown importance '{imp}', defaulting to 'medium'."
                )
                imp = "medium"

            good_rows.append((name, dt, imp, created_at))

    conn = _get_conn()
    try:
        before = conn.execute("SELECT COUNT(*) FROM event_calendar").fetchone()[0]
        conn.executemany(
            """
            INSERT OR IGNORE INTO event_calendar
                (event_name, event_datetime, importance, source, created_at)
            VALUES (?, ?, ?, 'manual_csv', ?)
            """,
            good_rows,
        )
        conn.commit()
        after   = conn.execute("SELECT COUNT(*) FROM event_calendar").fetchone()[0]
        inserted = after - before
    finally:
        conn.close()

    total   = len(good_rows)
    ignored = total - inserted  # duplicates silently ignored
    print(
        f"[events] Loaded {inserted} new events "
        f"({skipped} invalid skipped, {ignored} duplicates ignored)."
    )
    return inserted


if __name__ == "__main__":
    count = load_events()
    # Print summary
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT event_name, event_datetime, importance FROM event_calendar "
        "ORDER BY event_datetime"
    ).fetchall()
    conn.close()
    print(f"\n--- Event Calendar ({len(rows)} total events) ---")
    for r in rows:
        print(f"  {r['event_datetime']}  [{r['importance']:6s}]  {r['event_name']}")
