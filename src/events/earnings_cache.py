"""src/events/earnings_cache.py — the Options Finder's earnings cache (planned), probe only for now.

This first piece is the read-only probe the cache plan runs before anything is
built: it asks Finnhub's earnings calendar for the whole market (no symbol) over
the cache's 120-day horizon and says whether the plan's free-plan assumptions
hold. It writes nothing: no database row, no file.

    python -m src.events.earnings_cache --probe [--db PATH]

Calls: 18 seven-day windows from today (New York) through day 119 (the last
window is day 119 alone), one 28-day window over days 0-27, and the two halves
of each of the two fullest 7-day windows, for the truncation check: 23 calls,
one every 6 s (10 a minute), stopping at the first failure without a retry. It
refuses to start on a weekday between 09:00 and 17:00 New York time, when the
dashboard's fundamentals use the same account.

Checks (pass thresholds fixed in the plan):
  P1 access       the first window answers HTTP 200 with an earningsCalendar list
  P2 shape        0 malformed rows and 0 rows outside their requested dates
  P3 coverage     every window has rows; rows per window and names per 30-day band
  P4 cross-check  every stored future Finnhub date of the 12 tape names inside the
                  horizon (event_calendar, source finnhub_earnings) is in the reply
                  on the same New York date; for a miss it says on which day
                  offsets the whole-market reply lists that ticker, if any
  P5 truncation   the 28-day reply equals the union of its four 7-day windows, or,
                  when it holds fewer rows (a reply cap of that size), every 7-day
                  reply is below that size and each of the two fullest 7-day
                  windows equals the union of its two halves
  P6 depth        names with two listed reports, the last day with a row, the
                  share with a release time (reported only)

Outcome: pass (P1-P5), sparse (P1, P2 and P4 pass, P3 does not), fail (P1 refused
or P2 finds malformed rows), otherwise ambiguous. A run stopped by a 429 or an
error part-way is ambiguous unless P1 already failed.

The cross-check reads event_calendar from --db, or from a temporary copy of the
public data-latest database that is deleted afterwards. Output is counts and
pass/fail lines; tickers are printed only for the 12 tape names the cross-check
misses, and no date, key or URL is ever printed.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
import time as _time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable

import requests

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:  # `python src/events/earnings_cache.py` as well as `-m`
    sys.path.insert(0, str(ROOT))

from src.events.earnings import (  # noqa: E402  (reuse, never modify)
    EARNINGS_SYMBOLS,
    FINNHUB_URL,
    NY,
    SOURCE as STORED_SOURCE,
    TIMEOUT_S,
    _api_key,
    _when,
)

HEAVY_WINDOWS = 2  # the fullest 7-day windows re-asked as halves
NOT_ASKED = "not asked"  # a second half skipped after its first half failed
HORIZON_DAYS = 120  # days 0..119 (plan D2)
WINDOW_DAYS = 7
TRUNCATION_DAYS = 28
PACE_S = 6.0  # 10 calls a minute (plan D4)
TRADING_START, TRADING_END = time(9, 0), time(17, 0)  # weekday New York hours the probe will not start in
BAND_DAYS = 30
RELEASE_CODES = {"bmo", "amc", "dmh"}
PUBLIC_DB_URL = "https://github.com/maxkomen-macro/macro-regime-radar/releases/download/data-latest/macro_radar.db"
DOWNLOAD_TIMEOUT_S = 120


@dataclass(frozen=True)
class Window:
    start: date
    end: date  # inclusive

    def offset(self, today: date) -> tuple[int, int]:
        return (self.start - today).days, (self.end - today).days


def windows(today: date) -> list[Window]:
    """The cache's 7-day windows from today through day HORIZON_DAYS - 1."""
    last = today + timedelta(days=HORIZON_DAYS - 1)
    out, d = [], today
    while d <= last:
        out.append(Window(d, min(d + timedelta(days=WINDOW_DAYS - 1), last)))
        d += timedelta(days=WINDOW_DAYS)
    return out


def in_trading_hours(now: datetime) -> bool:
    ny = now.astimezone(NY)
    return ny.weekday() < 5 and TRADING_START <= ny.time() < TRADING_END


@dataclass
class Reply:
    window: Window
    status: int | None = None  # HTTP status, None for a network error
    failure: str | None = None  # label for a failed call, else None
    rows: list[tuple[str, date, str]] = field(default_factory=list)  # (symbol, day, release code)
    malformed: int = 0
    outside: int = 0


def fetch(window: Window, api_key: str, get=None) -> Reply:
    """One whole-market call; never raises, never keeps the URL or an exception message."""
    get = get or requests.get
    rep = Reply(window)
    try:
        resp = get(FINNHUB_URL, params={"from": window.start.isoformat(), "to": window.end.isoformat(), "token": api_key},
                   timeout=TIMEOUT_S)
    except Exception as exc:  # the message names the URL, token included: keep the type only
        rep.failure = type(exc).__name__
        return rep
    rep.status = resp.status_code
    if resp.status_code != 200:
        rep.failure = f"HTTP {resp.status_code}"
        return rep
    try:
        payload = resp.json()
    except ValueError:
        rep.failure = "unreadable reply"
        return rep
    items = payload.get("earningsCalendar") if isinstance(payload, dict) else None
    if not isinstance(items, list):
        rep.failure = "unexpected reply"
        return rep
    for item in items:
        sym = str(item.get("symbol") or "").strip().upper() if isinstance(item, dict) else ""
        try:
            day = date.fromisoformat(str(item.get("date") or "")[:10]) if sym else None
        except ValueError:
            day = None
        if not sym or day is None:
            rep.malformed += 1
            continue
        if not window.start <= day <= window.end:
            rep.outside += 1
            continue
        rep.rows.append((sym, day, str(item.get("hour") or "").strip().lower()))
    return rep


def stored_dates(db_path: Path, today: date, now: datetime) -> dict[str, set[date]]:
    """{ticker: New York dates} of the tape names' stored future Finnhub reports inside the horizon (read-only)."""
    last = today + timedelta(days=HORIZON_DAYS - 1)
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cols = {r[1] for r in conn.execute("PRAGMA table_info(event_calendar)")}
        if not {"symbol", "kind", "source"} <= cols:
            return {}
        out: dict[str, set[date]] = defaultdict(set)
        for sym, stamp in conn.execute(
            "SELECT symbol, event_datetime FROM event_calendar WHERE kind = 'earnings' AND source = ?", (STORED_SOURCE,)
        ):
            at, day = _when(stamp)
            tick = (sym or "").strip().upper()
            if tick in EARNINGS_SYMBOLS and day is not None and today <= day <= last and (at is None or at >= now):
                out[tick].add(day)
        return dict(out)
    finally:
        conn.close()


def _download_public_db(dest: Path, get=None) -> None:
    get = get or requests.get
    resp = get(PUBLIC_DB_URL, timeout=DOWNLOAD_TIMEOUT_S)
    if resp.status_code != 200:
        raise RuntimeError(f"public database download answered HTTP {resp.status_code}")
    dest.write_bytes(resp.content)


@dataclass
class Report:
    lines: list[str]
    outcome: str


def judge(replies: list[Reply], trunc: Reply | None, stored: dict[str, set[date]], today: date,
          planned: int, halves: list[tuple[Reply, Reply, Reply]] = ()) -> Report:
    """The probe's verdict from its replies (pure: no call, no clock). `halves` holds (whole, first half,
    second half) for each re-asked 7-day window."""
    lines: list[str] = []
    done = [r for r in replies if r.failure is None]
    extra = ([trunc] if trunc else []) + [h for _, a, b in halves for h in (a, b) if h.failure != NOT_ASKED]
    stopped = next((r for r in replies + extra if r.failure is not None), None)
    calls = len(replies) + len(extra)
    lines.append(f"calls: {calls} of {planned}" + (f" (stopped: {stopped.failure})" if stopped else ""))

    # P1
    first = replies[0] if replies else None
    p1 = first is not None and first.failure is None
    lines.append(f"P1 access: {'PASS' if p1 else 'FAIL'}"
                 + ("" if p1 else f" ({first.failure if first else 'no call made'})"))

    # P2
    answered = done + [r for r in extra if r.failure is None]
    malformed = sum(r.malformed for r in answered)
    outside = sum(r.outside for r in answered)
    p2 = p1 and malformed == 0 and outside == 0
    lines.append(f"P2 shape: {'PASS' if p2 else 'FAIL'} ({malformed} malformed, {outside} outside their dates)")

    # P3
    all_windows = len(done) == len(windows(today))
    empty = [i for i, r in enumerate(done) if not r.rows]
    p3 = p1 and all_windows and not empty
    lines.append(f"P3 coverage: {'PASS' if p3 else 'FAIL'} ({len(done)} of {len(windows(today))} windows answered, "
                 f"{len(empty)} empty)")
    lines.append("   rows per window: " + ", ".join(str(len(r.rows)) for r in done))
    bands: dict[int, set[str]] = defaultdict(set)
    for r in done:
        for sym, day, _ in r.rows:
            bands[(day - today).days // BAND_DAYS].add(sym)
    lines.append("   names per 30-day band: " + ", ".join(
        f"days {b * BAND_DAYS}-{min((b + 1) * BAND_DAYS, HORIZON_DAYS) - 1}: {len(bands.get(b, ()))}"
        for b in range((HORIZON_DAYS + BAND_DAYS - 1) // BAND_DAYS)))

    # P4: only dates inside the windows that answered can be judged
    seen = {(sym, day) for r in done for sym, day, _ in r.rows}
    covered = [r.window for r in done]
    wanted = [(s, d) for s, ds in sorted(stored.items()) for d in sorted(ds)
              if any(w.start <= d <= w.end for w in covered)]
    unjudged = sum(len(ds) for ds in stored.values()) - len(wanted)
    missed = sorted({s for s, d in wanted if (s, d) not in seen})
    p4 = p1 and bool(wanted) and unjudged == 0 and not missed  # nothing to compare is not a pass
    lines.append(f"P4 cross-check: {'PASS' if p4 else 'FAIL'} ({len(wanted) - sum(1 for s, d in wanted if (s, d) not in seen)}"
                 f" of {len(wanted)} stored tape-name dates found"
                 + (f"; {unjudged} not judged, their window did not answer" if unjudged else "")
                 + (f"; missed for {', '.join(missed)}" if missed else "") + ")")
    if not stored:
        lines.append("   no stored tape-name dates in the horizon: the cross-check had nothing to compare")
    for s, d in wanted:
        if (s, d) in seen:
            continue
        listed = sorted({(day - today).days for r in done for sym, day, _ in r.rows if sym == s})
        lines.append(f"   {s}: stored on day {(d - today).days}; the whole-market reply lists it "
                     + (f"on day {', '.join(map(str, listed))}" if listed else "nowhere in the horizon"))

    # P5
    biggest = max((len(r.rows) for r in done), default=0)
    if trunc is not None and trunc.failure is None and len(done) >= TRUNCATION_DAYS // WINDOW_DAYS:
        whole = {(s, d) for s, d, _ in trunc.rows}
        parts = {(s, d) for r in done[: TRUNCATION_DAYS // WINDOW_DAYS] for s, d, _ in r.rows}
        cap = len(trunc.rows) if whole < parts else None  # a strict subset: cut short, nothing changed
        split_ok, detail = [], []
        for w, a, b in halves:
            if a.failure is None and b.failure is None:
                both = {(s, d) for s, d, _ in a.rows} | {(s, d) for s, d, _ in b.rows}
                split_ok.append(both == {(s, d) for s, d, _ in w.rows})
                detail.append(f"   halves of the {len(w.rows)}-row window (days {w.window.offset(today)[0]}-"
                             f"{w.window.offset(today)[1]}): {len(a.rows)} + {len(b.rows)} rows, "
                             + ("the same rows" if split_ok[-1] else "different rows"))
        halves_ok = all(split_ok) and len(split_ok) == len(halves)
        if whole == parts:
            p5, why = halves_ok, f"28-day reply {len(trunc.rows)} rows, its four 7-day windows {len(parts)} distinct rows"
        elif cap is not None:
            p5 = biggest < cap and len(split_ok) == HEAVY_WINDOWS and halves_ok
            why = (f"28-day reply {len(trunc.rows)} rows, its four 7-day windows {len(parts)} distinct rows: "
                   f"a reply cap of {cap} rows; the largest 7-day reply had {biggest} rows")
        else:
            p5, why = False, (f"28-day reply {len(trunc.rows)} rows, its four 7-day windows {len(parts)} distinct "
                              "rows, and the sets differ")
        lines.append(f"P5 truncation: {'PASS' if p5 else 'FAIL'} ({why})")
        lines.extend(detail)
        if cap is not None:
            lines.append(f"   reply cap observed: {cap} rows; a reply of that size is cut short")
    else:
        p5 = False
        lines.append("P5 truncation: NOT RUN (the run stopped before it)")

    # P6 (reported only)
    reports: dict[str, set[date]] = defaultdict(set)
    hours = total = 0
    for r in done:
        for sym, day, hour in r.rows:
            reports[sym].add(day)
            total += 1
            hours += hour in RELEASE_CODES
    two = sum(1 for ds in reports.values() if len(ds) >= 2)
    last = max((d for ds in reports.values() for d in ds), default=None)
    lines.append(f"P6 depth: {len(reports)} names, {two} with two or more listed reports, last row on day "
                 f"{(last - today).days if last else '-'}, {round(100.0 * hours / total) if total else 0}% with a release time")
    lines.append(f"   rows in the horizon: {total}")

    if not p1 or malformed:
        outcome = "fail"
    elif p2 and p3 and p4 and p5 and not stopped:
        outcome = "pass"
    elif p2 and p4 and not p3 and all_windows and not stopped:
        outcome = "sparse"
    else:
        outcome = "ambiguous"
    lines.append(f"OUTCOME: {outcome.upper()}")
    return Report(lines, outcome)


def probe(api_key: str, db_path: Path, *, now: datetime | None = None, get=None,
          sleep: Callable[[float], None] = _time.sleep) -> Report:
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    today = now.astimezone(NY).date()
    stored = stored_dates(db_path, today, now)
    plan = windows(today)
    replies: list[Reply] = []
    trunc = None
    for i, w in enumerate(plan):
        if i:
            sleep(PACE_S)
        rep = fetch(w, api_key, get)
        replies.append(rep)
        if rep.failure is not None:
            break
    halves: list[tuple[Reply, Reply, Reply]] = []
    if all(r.failure is None for r in replies) and len(replies) == len(plan):
        sleep(PACE_S)
        trunc = fetch(Window(today, today + timedelta(days=TRUNCATION_DAYS - 1)), api_key, get)
        full = [r for r in replies if (r.window.end - r.window.start).days == WINDOW_DAYS - 1]
        for w in sorted(full, key=lambda r: -len(r.rows))[:HEAVY_WINDOWS] if trunc.failure is None else []:
            mid = w.window.start + timedelta(days=WINDOW_DAYS // 2)
            pair = []
            for half in (Window(w.window.start, mid - timedelta(days=1)), Window(mid, w.window.end)):
                sleep(PACE_S)
                pair.append(fetch(half, api_key, get))
                if pair[-1].failure is not None:
                    break
            if len(pair) < 2:
                pair.append(Reply(Window(mid, w.window.end), failure=NOT_ASKED))
            halves.append((w, pair[0], pair[1]))
            if any(h.failure is not None for h in pair):
                break
    return judge(replies, trunc, stored, today, len(plan) + 1 + 2 * HEAVY_WINDOWS, halves)


def _announced(key: str, db: Path, now: datetime) -> Report:
    print(f"[earnings-cache probe] calling Finnhub: {len(windows(now.astimezone(NY).date())) + 1 + 2 * HEAVY_WINDOWS} calls, about 2.5 minutes ...")
    return probe(key, db, now=now)


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description="Options Finder earnings cache (probe only for now).")
    ap.add_argument("--probe", action="store_true", help="run the read-only free-plan probe")
    ap.add_argument("--db", help="database to read the stored tape-name dates from "
                                 "(default: a temporary copy of the public data-latest database)")
    args = ap.parse_args(argv)
    if not args.probe:
        ap.error("nothing to do: pass --probe")
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if in_trading_hours(now):
        print("[earnings-cache probe] not started: it is US trading hours in New York (weekdays 09:00-17:00), "
              "when the dashboard uses the same Finnhub account. Run it outside those hours.")
        return 2
    key = _api_key()
    if not key:
        print("[earnings-cache probe] not started: FINNHUB_API_KEY is not set (environment or the repo's .env).")
        return 2
    try:
        if args.db:
            db = Path(args.db)
            if not db.exists():
                print("[earnings-cache probe] not started: the --db file does not exist.")
                return 2
            report = _announced(key, db, now)
        else:
            with tempfile.TemporaryDirectory() as tmp:
                db = Path(tmp) / "data-latest.db"
                print("[earnings-cache probe] downloading the public data-latest database for the cross-check ...")
                _download_public_db(db)
                report = _announced(key, db, now)
    except Exception as exc:  # never print a message that could carry a URL or the key
        print(f"[earnings-cache probe] failed: {type(exc).__name__}")
        return 2
    for line in report.lines:
        print(line)
    return 0 if report.outcome == "pass" else 1


if __name__ == "__main__":
    sys.exit(main())
