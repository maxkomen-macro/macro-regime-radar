"""src/events/earnings.py — large-cap earnings dates on the event calendar (B5, 2026-09-19).

The twelve single names the Markets tape streams (api/stream.py
SINGLE_NAMES_US; tests/test_earnings.py pins the two lists equal) get their
next reports from Finnhub's earnings calendar, 90 days ahead, one request per
symbol. Each report becomes one event_calendar row:

    event_name      "NVDA earnings (Q3 2027)" (the fiscal period only when Finnhub gives quarter and year)
    event_datetime  full UTC 'YYYY-MM-DDTHH:MM:SSZ' from New York wall time, DST-correct:
                    bmo 08:00, amc 16:30, dmh 12:00, blank or unknown 12:00
    importance      'medium'
    source          'finnhub_earnings'
    kind            'earnings'
    symbol          the ticker

Merge rules:
  - Rows this loader does not own (any source but finnhub_earnings; today the
    hand-maintained calendar.csv rows) are never modified or deleted.
  - A hand-maintained row naming the same symbol's earnings (its `symbol`
    column, or an event_name carrying the ticker as a word plus "earnings",
    case-insensitive) on the same New York date wins: the Finnhub row is not
    stored, and an existing future Finnhub row for that symbol and date is
    removed, whatever Finnhub answers that day.
  - Finnhub rows are upserted per (symbol, fiscal period), or per (symbol, New
    York date) when Finnhub gives no period; a moved date updates the old
    future row in place (same id).
  - Past rows are never deleted or modified, and a report whose period or date
    is already on a past row is not added again.

/api/calendar and /api/calendar/recent leave these rows out unless
?include=earnings, and the memos list macro releases only.

Never fails the refresh: a missing FINNHUB_API_KEY, an HTTP error, a network
error or a malformed reply ends in one summary line and exit code 0. Finnhub
takes the key in the query string, so no URL, exception message or response
body is ever printed, only HTTP status codes and exception type names. When
no symbol could be fetched, no row is touched.

Run from the repo root:
    python -m src.events.earnings [--db PATH] [--days 90]
"""

from __future__ import annotations

import argparse
import os
import re
import sqlite3
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:  # `python src/events/earnings.py` as well as `-m`
    sys.path.insert(0, str(ROOT))

from src.migrate import ensure_event_calendar_schema  # noqa: E402  (stdlib only)

DB_PATH = ROOT / "data" / "macro_radar.db"
ENV_FILE = ROOT / ".env"

# Mirrors api/stream.py SINGLE_NAMES_US, the Markets tape's single names.
EARNINGS_SYMBOLS = (
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META",
    "TSLA", "AVGO", "TSM", "MU", "AMD", "COIN",
)
FINNHUB_URL = "https://finnhub.io/api/v1/calendar/earnings"
HORIZON_DAYS = 90
TIMEOUT_S = 15
SOURCE = "finnhub_earnings"
KIND = "earnings"
IMPORTANCE = "medium"

NY = ZoneInfo("America/New_York")
# Finnhub's `hour` codes as New York wall time; blank or unknown is midday.
SESSION_TIMES = {"bmo": time(8, 0), "amc": time(16, 30), "dmh": time(12, 0)}
DEFAULT_TIME = time(12, 0)
# A rejected key fails the same way for every symbol, so the rest are not asked.
AUTH_STATUSES = {401, 403}

COUNTS = ("new", "moved", "updated", "unchanged", "withheld", "removed", "past", "conflicts")
_PERIOD = re.compile(r"\(Q([1-4]) (\d{4})\)\s*$")
_TICKER = {s: re.compile(rf"(?<![A-Za-z0-9]){re.escape(s)}(?![A-Za-z0-9])", re.IGNORECASE) for s in EARNINGS_SYMBOLS}


def _utc_text(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def event_timestamp(day: date | str, hour: str | None) -> str:
    """Finnhub's date and session code as full UTC 'YYYY-MM-DDTHH:MM:SSZ',
    read as New York wall time (zoneinfo applies the DST offset of that day)."""
    d = day if isinstance(day, date) else date.fromisoformat(str(day)[:10])
    wall = SESSION_TIMES.get(str(hour or "").strip().lower(), DEFAULT_TIME)
    return _utc_text(datetime.combine(d, wall, tzinfo=NY))


def _as_int(value) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    try:
        return int(str(value).strip())
    except ValueError:
        return None


def fiscal_period(quarter, year) -> str | None:
    q, y = _as_int(quarter), _as_int(year)
    if q is None or y is None or not 1 <= q <= 4 or not 1900 < y < 2200:
        return None
    return f"Q{q} {y}"


def event_name(symbol: str, quarter, year) -> str:
    period = fiscal_period(quarter, year)
    return f"{symbol} earnings ({period})" if period else f"{symbol} earnings"


@dataclass(frozen=True)
class Report:
    """One report as Finnhub states it."""

    symbol: str
    day: date  # New York date
    event_datetime: str  # full UTC
    event_name: str
    period: str | None

    @property
    def at(self) -> datetime:
        return datetime.strptime(self.event_datetime, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def parse_item(item, symbol: str, start: date, end: date) -> Report | None:
    """A Finnhub earningsCalendar entry for `symbol` inside [start, end], else None."""
    if not isinstance(item, dict) or str(item.get("symbol") or "").strip().upper() != symbol:
        return None
    try:
        day = date.fromisoformat(str(item.get("date") or "")[:10])
    except ValueError:
        return None
    if not start <= day <= end:
        return None
    period = fiscal_period(item.get("quarter"), item.get("year"))
    name = f"{symbol} earnings ({period})" if period else f"{symbol} earnings"
    return Report(symbol, day, event_timestamp(day, item.get("hour")), name, period)


class FetchError(Exception):
    """A per-symbol failure described without the URL, the key or the reply body."""

    def __init__(self, label: str, status: int | None = None):
        super().__init__(label)
        self.label = label
        self.status = status


def fetch_symbol(symbol: str, api_key: str, start: date, end: date) -> list:
    try:
        resp = requests.get(
            FINNHUB_URL,
            params={"from": start.isoformat(), "to": end.isoformat(), "symbol": symbol, "token": api_key},
            timeout=TIMEOUT_S,
        )
    except Exception as exc:  # the message names the URL, token included: keep the type only
        raise FetchError(type(exc).__name__) from None
    if resp.status_code != 200:
        raise FetchError(f"HTTP {resp.status_code}", resp.status_code)
    try:
        payload = resp.json()
    except ValueError:
        raise FetchError("unreadable reply") from None
    items = payload.get("earningsCalendar") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        raise FetchError("unexpected reply")
    return items


def fetch_reports(api_key: str, start: date, end: date) -> tuple[list[Report], list[str], dict[str, str], int]:
    """(reports, symbols fetched, {symbol: failure label}, symbols not requested)."""
    reports: list[Report] = []
    fetched: list[str] = []
    failures: dict[str, str] = {}
    for i, sym in enumerate(EARNINGS_SYMBOLS):
        try:
            items = fetch_symbol(sym, api_key, start, end)
        except FetchError as err:
            failures[sym] = err.label
            if err.status in AUTH_STATUSES:
                return reports, fetched, failures, len(EARNINGS_SYMBOLS) - i - 1
            continue
        fetched.append(sym)
        reports.extend(r for r in (parse_item(it, sym, start, end) for it in items) if r)
    return reports, fetched, failures, 0


# ── merge ────────────────────────────────────────────────────────────────────

@dataclass
class _Row:
    id: int
    event_name: str
    event_datetime: str
    importance: str | None
    source: str | None
    symbol: str | None
    kind: str | None
    at: datetime | None  # UTC instant; None for a date-only or unreadable stamp
    day: date | None  # New York date
    gone: bool = False

    @property
    def ticker(self) -> str:
        return (self.symbol or "").strip().upper()

    @property
    def period(self) -> str | None:
        m = _PERIOD.search(self.event_name or "")
        return f"Q{m.group(1)} {m.group(2)}" if m else None


def _when(stamp: str | None) -> tuple[datetime | None, date | None]:
    """(UTC instant, New York date) of a stored event_datetime. A date-only
    value is that date; a naive stamp is UTC, as the API compares it."""
    s = (stamp or "").strip()
    if len(s) == 10:
        try:
            return None, date.fromisoformat(s)
        except ValueError:
            return None, None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None, None
    dt = (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).astimezone(timezone.utc)
    return dt, dt.astimezone(NY).date()


def _load_rows(conn: sqlite3.Connection) -> list[_Row]:
    rows = []
    for rid, name, stamp, imp, src, sym, kind in conn.execute(
        "SELECT id, event_name, event_datetime, importance, source, symbol, kind FROM event_calendar"
    ):
        at, day = _when(stamp)
        rows.append(_Row(rid, name, stamp, imp, src, sym, kind, at, day))
    return rows


def _claims(rows: list[_Row]) -> set[tuple[str, date]]:
    """(symbol, New York date) pairs a hand-maintained row already covers."""
    out: set[tuple[str, date]] = set()
    for r in rows:
        if r.source == SOURCE or r.day is None:
            continue
        if r.ticker:
            out.add((r.ticker, r.day))
        if "earnings" in (r.event_name or "").lower():
            out.update((s, r.day) for s in EARNINGS_SYMBOLS if _TICKER[s].search(r.event_name))
    return out


def _dedupe(reports: list[Report]) -> list[Report]:
    """One report per (symbol, day), preferring one with a period; then one per
    (symbol, period), the earliest."""
    by_day: dict[tuple[str, date], Report] = {}
    for rep in sorted(reports, key=lambda r: (r.symbol, r.day, r.period is None)):
        by_day.setdefault((rep.symbol, rep.day), rep)
    out, periods = [], set()
    for rep in sorted(by_day.values(), key=lambda r: (r.symbol, r.day)):
        if rep.period is not None:
            if (rep.symbol, rep.period) in periods:
                continue
            periods.add((rep.symbol, rep.period))
        out.append(rep)
    return out


def merge(conn: sqlite3.Connection, reports: list[Report], *, now: datetime) -> dict[str, int]:
    """Apply the merge rules above inside the caller's transaction."""
    counts = dict.fromkeys(COUNTS, 0)
    now = now.astimezone(timezone.utc)
    now_text = _utc_text(now)
    rows = _load_rows(conn)
    claims = _claims(rows)
    owned = [r for r in rows if r.source == SOURCE]

    def upcoming(r: _Row) -> bool:
        return not r.gone and r.at is not None and r.at >= now

    def same_report(r: _Row, rep: Report) -> bool:
        return r.ticker == rep.symbol and (r.day == rep.day or (rep.period is not None and r.period == rep.period))

    def remove(r: _Row) -> None:
        # Guarded in SQL as well: only this loader's rows, only future ones.
        cur = conn.execute(
            "DELETE FROM event_calendar WHERE id = ? AND source = ? AND event_datetime >= ?", (r.id, SOURCE, now_text)
        )
        if cur.rowcount:
            r.gone = True
            counts["removed"] += 1

    # 1. A hand-maintained row wins, whatever Finnhub answers today.
    for r in owned:
        if upcoming(r) and (r.ticker, r.day) in claims:
            remove(r)

    # 2. Upsert each report.
    for rep in _dedupe(reports):
        same = [r for r in owned if upcoming(r) and same_report(r, rep)]
        if (rep.symbol, rep.day) in claims:
            for r in same:
                remove(r)
            counts["withheld"] += 1
            continue
        if not same:
            already_past = any(
                not r.gone and r.at is not None and r.at < now and same_report(r, rep) for r in owned
            )
            if rep.at < now or already_past:
                counts["past"] += 1
                continue
            try:
                cur = conn.execute(
                    "INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (rep.event_name, rep.event_datetime, IMPORTANCE, SOURCE,
                     now.replace(tzinfo=None).isoformat(timespec="seconds"), rep.symbol, KIND),
                )
            except sqlite3.IntegrityError:  # that (event_name, event_datetime) pair is taken
                counts["conflicts"] += 1
                continue
            owned.append(_Row(cur.lastrowid, rep.event_name, rep.event_datetime, IMPORTANCE, SOURCE,
                              rep.symbol, KIND, rep.at, rep.day))
            counts["new"] += 1
            continue
        keep = min(same, key=lambda r: ((r.event_name, r.event_datetime) != (rep.event_name, rep.event_datetime),
                                        r.period != rep.period, r.id))
        for r in same:
            if r is not keep:
                remove(r)
        if (keep.event_name, keep.event_datetime, keep.importance, keep.symbol, keep.kind) == (
            rep.event_name, rep.event_datetime, IMPORTANCE, rep.symbol, KIND
        ):
            counts["unchanged"] += 1
            continue
        try:
            conn.execute(
                "UPDATE event_calendar SET event_name = ?, event_datetime = ?, importance = ?, symbol = ?, kind = ? "
                "WHERE id = ? AND source = ? AND event_datetime >= ?",
                (rep.event_name, rep.event_datetime, IMPORTANCE, rep.symbol, KIND, keep.id, SOURCE, now_text),
            )
        except sqlite3.IntegrityError:
            counts["conflicts"] += 1
            continue
        counts["moved" if keep.event_datetime != rep.event_datetime else "updated"] += 1
        keep.event_name, keep.event_datetime, keep.importance = rep.event_name, rep.event_datetime, IMPORTANCE
        keep.symbol, keep.kind, keep.at, keep.day = rep.symbol, KIND, rep.at, rep.day
    return counts


# ── run ──────────────────────────────────────────────────────────────────────

def _api_key() -> str:
    """FINNHUB_API_KEY from the environment, else the repo-root .env. Never printed."""
    val = os.environ.get("FINNHUB_API_KEY", "").strip()
    if val:
        return val
    try:
        for line in ENV_FILE.read_text().splitlines():
            line = line.strip()
            if line.startswith("FINNHUB_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")
    except OSError:
        pass
    return ""


def _summary(res: dict) -> str:
    head = f"[earnings] Finnhub {res['fetched']}/{len(EARNINGS_SYMBOLS)} symbols"
    if res["failures"]:
        detail = ", ".join(f"{sym} {label}" for sym, label in res["failures"].items())
        if res["not_requested"]:
            detail += f"; key rejected, {res['not_requested']} not requested"
        head += f" (failed: {detail})"
    if not res["fetched"]:
        return head + "; no row changed"
    parts = [f"{res['new']} new", f"{res['moved']} moved", f"{res['unchanged']} unchanged"]
    for key, label in (
        ("updated", "renamed"),
        ("withheld", "withheld (hand-maintained row wins)"),
        ("removed", "removed"),
        ("past", "skipped (already past)"),
        ("conflicts", "skipped (name and time taken)"),
    ):
        if res[key]:
            parts.append(f"{res[key]} {label}")
    return head + "; event_calendar: " + ", ".join(parts)


def run(db_path: Path | str = DB_PATH, *, api_key: str | None = None, days: int = HORIZON_DAYS,
        now: datetime | None = None) -> dict:
    """Fetch, merge and commit. Returns the counts, the status and the summary line."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    res: dict = {"status": "skipped", "fetched": 0, "failures": {}, "not_requested": 0, **dict.fromkeys(COUNTS, 0)}
    key = (api_key if api_key is not None else _api_key()).strip()
    if not key:
        res["summary"] = "[earnings] skipped: FINNHUB_API_KEY is not set; no row changed"
        return res
    path = Path(db_path)
    if not path.exists():
        res["summary"] = f"[earnings] skipped: no database at {path}; nothing fetched"
        return res
    start = now.astimezone(NY).date()
    reports, fetched, failures, not_requested = fetch_reports(key, start, start + timedelta(days=max(1, days)))
    res.update(fetched=len(fetched), failures=failures, not_requested=not_requested)
    if fetched:
        conn = sqlite3.connect(path)
        try:
            ensure_event_calendar_schema(conn)
            res.update(merge(conn, reports, now=now))
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            conn.close()
    res["status"] = "ok" if not failures else ("partial" if fetched else "failed")
    res["summary"] = _summary(res)
    return res


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Load large-cap earnings dates from Finnhub into event_calendar.")
    ap.add_argument("--db", default=str(DB_PATH), help="SQLite database to update (default: data/macro_radar.db)")
    ap.add_argument("--days", type=int, default=HORIZON_DAYS, help="look-ahead window in days (default: 90)")
    args = ap.parse_args(argv)
    try:
        res = run(Path(args.db), days=args.days)
        line, trouble = res["summary"], res["status"] != "ok"
    except Exception as exc:  # never fail the refresh; an exception's text may carry the URL
        line, trouble = f"[earnings] failed: {type(exc).__name__}; no row changed", True
    if trouble and os.environ.get("GITHUB_ACTIONS") == "true":
        line = "::warning::" + line  # visible in the run summary without failing the job
    print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
