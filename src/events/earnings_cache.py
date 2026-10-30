"""src/events/earnings_cache.py — the Options Finder's earnings cache: the refresh step, its probe and its report.

The step (plan rev 2, D1-D5; capability report rev 2, R1-R5; design EC section 1) asks Finnhub's earnings
calendar for the whole market (no symbol) in 7-day windows over 120 days, then the past 7 days, splitting any
reply of 1,000 rows or more (a 1,500-row reply is never whole), checks the 12 tape names' stored dates against
it, and merges what it saw into the encrypted vault of src/events/earnings_store.py. It writes nothing else.
Every safeguard fails toward "skip": weekday US trading hours, a passing run less than 10 hours ago, a run that
is not a scheduled first attempt of a full refresh, 40 calls a run and 80 a UTC day, 10 calls a minute (5 for
24 hours after a 429), no retry, an absolute limit on each call and on the run. One summary line, counts only.

    python -m src.events.earnings_cache [--db PATH]          the step (data/macro_radar.db by default)
    python -m src.events.earnings_cache --report [--db PATH] counts per state (needs EARNINGS_CACHE_KEY)
    python -m src.events.earnings_cache --fetch-ledger       the workflow's ledger fetch (src/events/earnings_ledger.py)
    python -m src.events.earnings_cache --publish-ledger     the workflow's always-run ledger upload

The step's accounting and invalidation state persist in the durable ledger, a set of sequenced, encrypted
release assets on data-latest, whether or not the refresh's database validates or publishes (design EC section 9,
Amendment A-1). The run reserves its calls in the ledger before the first one and makes none when the ledger
cannot be read or written; uncertain accounting restarts conservatively, never at zero.

The read-only probe the plan ran first, unchanged: it says whether the free plan's assumptions hold and writes
nothing, no database row and no file.

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
import json
import math
import os
import sqlite3
import sys
import tempfile
import threading
import time as _time
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable, Mapping

import requests

ROOT = Path(__file__).resolve().parent.parent.parent
if str(ROOT) not in sys.path:  # `python src/events/earnings_cache.py` as well as `-m`
    sys.path.insert(0, str(ROOT))

from src.events.earnings import (  # noqa: E402  (reuse, never modify)
    DB_PATH,
    EARNINGS_SYMBOLS,
    FINNHUB_URL,
    NY,
    SOURCE as STORED_SOURCE,
    TIMEOUT_S,
    _api_key,
    _when,
)
from src.events import earnings_ledger as ledger  # noqa: E402
from src.events import earnings_store as store  # noqa: E402

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
    _parse(items, window, rep)
    return rep


def _parse(items: list, window: Window, rep: Reply, keep: list | None = None) -> None:
    """Count malformed rows and rows outside the window; keep the rest (and, into `keep`, each row's fiscal
    label and whether it carries actual figures)."""
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
        hour = str(item.get("hour") or "").strip().lower()
        rep.rows.append((sym, day, hour))
        if keep is not None:
            actuals = tuple(item.get(k) if _finite(item.get(k)) else None for k in ("epsActual", "revenueActual"))
            keep.append({"s": sym, "d": day, "h": hour if hour in RELEASE_CODES else "unknown",
                         "y": _plain(item.get("year")), "q": _plain(item.get("quarter")),
                         "r": any(a is not None for a in actuals),
                         "a": actuals})  # for the split check only (Codex S-5); the vault keeps "r"


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _plain(v):
    """A label field as stored: a finite number or a short string, else None (the label check is the store's)."""
    if _finite(v):
        return v
    return v[:16] if isinstance(v, str) else None


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


# ── the cache run (design EC section 1: plan rev 2 D4, capability report R1, R3, R5) ──────────────────

SPLIT_AT, CAP = 1000, 1500  # R1: a reply this large is split; one this large is never whole
LOOKBACK_DAYS = 7  # R2: the past week, asked last, for the quarters seen reported
RUN_CAP, DAY_CAP = 40, 80  # calls a run (splits included) and a UTC day (plan D4)
SPACING = timedelta(hours=10)  # since the last passing run
SLOW_PACE_S = 12.0  # 5 calls a minute for 24 hours after any 429
SLOW_FOR = timedelta(hours=24)
GAP_S = 60.0  # after the pipeline's other Finnhub steps
DEADLINE = timedelta(minutes=8)  # no call starts later
HARD_STOP = DEADLINE + timedelta(seconds=45)  # no call runs later; the step's timeout is 10 minutes
CALL_S = 15.0  # one call's absolute limit
MAX_BODY = 4 * 1024 * 1024  # bytes; a 1,500-row reply is about 0.2 MB
CHUNK = 64 * 1024
LATE = timedelta(hours=12)  # a scheduled run starting this long after its cron slot does not call
KEEP_RUNS = timedelta(days=90)
KEEP_OCC_DAYS = 400
KEEP_DAYS_BEFORE = LOOKBACK_DAYS + 1
TAG = "[earnings-cache]"
# The two full-mode crons of refresh-data.yml as (hour, minute, ISO weekdays); tests/test_earnings_cache.py
# pins them equal to scripts/workflow_mode.py's full entries.
FULL_CRONS = {"17 11 * * *": (11, 17, frozenset(range(1, 8))), "23 0 * * 2-6": (0, 23, frozenset(range(2, 7)))}


def fetch_until(window: Window, api_key: str, get, until: datetime,
                clock: Callable[[], datetime]) -> tuple[list[dict], Reply]:
    """One whole-market call under an absolute deadline (design EC 1.2): streamed, read in chunks, abandoned
    once the clock passes `until` or the body passes MAX_BODY. Never raises; keeps no URL or exception text.

    Requests' timeouts bound each socket wait, not the call: a reply that keeps dripping bytes can hold
    `iter_content` past any deadline (Codex S-8). So the call runs on its own daemon thread and this thread
    waits for it at most until `until`, in wall-clock seconds; past that the call is abandoned (its response
    closed, its result ignored) and answers "time limit", whatever stage it was in: connect, headers or body."""
    rep = Reply(window)
    left = (until - clock()).total_seconds()
    if left <= 0:
        rep.failure = "time limit"
        return [], rep
    box: dict = {}

    def call() -> None:
        try:
            box["out"] = _fetch(window, api_key, get or requests.get, until, clock, left, box)
        except Exception as exc:  # noqa: BLE001 — the type only, never the text
            box["error"] = type(exc).__name__
        except BaseException as exc:  # an interrupt or exit is the run's, not the call's: raised again below
            box["fatal"] = exc

    worker = threading.Thread(target=call, name="earnings-cache-call", daemon=True)
    worker.start()
    worker.join(left)
    if "fatal" in box:
        raise box["fatal"]
    if "out" in box:
        return box["out"]
    box["abandoned"] = True
    if box.get("resp") is not None:
        # closed on a thread of its own: a close waits for the read it would interrupt (the buffered reader's
        # lock), so closing here would wait out the drip
        threading.Thread(target=_close_quietly, args=(box["resp"],), name="earnings-cache-close", daemon=True).start()
    rep.failure = "time limit" if worker.is_alive() else box.get("error", "error")
    return [], rep


def _close_quietly(resp) -> None:
    try:
        resp.close()
    except Exception:  # noqa: BLE001
        pass


def _fetch(window: Window, api_key: str, get, until: datetime, clock: Callable[[], datetime], left: float,
           box: dict) -> tuple[list[dict], Reply]:
    """The call itself, on fetch_until's thread; `box["resp"]` lets the waiting thread close the response."""
    rep, kept = Reply(window), []
    try:
        resp = get(FINNHUB_URL, params={"from": window.start.isoformat(), "to": window.end.isoformat(), "token": api_key},
                   timeout=(left, left), stream=True)
    except Exception as exc:  # the message names the URL, token included: keep the type only
        rep.failure = type(exc).__name__
        return kept, rep
    box["resp"] = resp
    try:
        rep.status = resp.status_code
        if resp.status_code != 200:
            rep.failure = f"HTTP {resp.status_code}"
            return kept, rep
        body = bytearray()
        try:
            for chunk in resp.iter_content(CHUNK):
                body += chunk
                if len(body) > MAX_BODY:
                    rep.failure = "reply too large"
                    return kept, rep
                if clock() >= until or box.get("abandoned"):
                    rep.failure = "time limit"
                    return kept, rep
        except Exception as exc:  # noqa: BLE001 — a read timeout or a dropped connection: the type only
            rep.failure = type(exc).__name__
            return kept, rep
        try:
            payload = json.loads(bytes(body).decode("utf-8"))
        except ValueError:
            rep.failure = "unreadable reply"
            return kept, rep
        items = payload.get("earningsCalendar") if isinstance(payload, dict) else None
        if not isinstance(items, list):
            rep.failure = "unexpected reply"
            return kept, rep
        _parse(items, window, rep, kept)
        return kept, rep
    finally:
        try:
            resp.close()
        except Exception:  # noqa: BLE001
            pass


def scheduled_slot(cron: str, start: datetime) -> datetime | None:
    """The newest firing of a full-mode cron at or before `start` (UTC), or None for any other cron."""
    spec = FULL_CRONS.get(cron.strip())
    if spec is None:
        return None
    hour, minute, days = spec
    d = start.astimezone(timezone.utc).date()
    for back in range(8):
        day = d - timedelta(days=back)
        slot = datetime(day.year, day.month, day.day, hour, minute, tzinfo=timezone.utc)
        if slot <= start and day.isoweekday() in days:
            return slot
    return None


def actions_gate(env: Mapping[str, str], start: datetime) -> str | None:
    """In GitHub Actions, the reason a run must not call (design EC 1.1a), or None. Outside Actions, None."""
    if env.get("GITHUB_ACTIONS") != "true":
        return None
    if env.get("GITHUB_EVENT_NAME") != "schedule" or env.get("GITHUB_RUN_ATTEMPT", "1") != "1":
        return "not a scheduled full refresh"
    try:
        cron = str(json.loads(Path(env.get("GITHUB_EVENT_PATH", "")).read_text()).get("schedule") or "")
    except (OSError, ValueError, AttributeError):
        return "not a scheduled full refresh"
    slot = scheduled_slot(cron, start)
    if slot is None:
        return "not a scheduled full refresh"
    if start - slot >= LATE:
        return "started too late"
    return None


class _Stop(Exception):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@dataclass
class _Answer:
    window: Window
    rows: list[dict]  # {s, d, h, y, q, r}
    split: bool = False


@dataclass
class _Run:
    key: str
    get: Callable | None
    sleep: Callable[[float], None]
    clock: Callable[[], datetime]
    started: datetime
    pace: float
    charged: dict[str, int]  # calls the other runs charged to each UTC date
    calls: int = 0
    saw_429: bool = False
    answers: list[_Answer] = field(default_factory=list)
    unanswered: list[Window] = field(default_factory=list)  # requests sent that got no answer (Codex S-1)
    splits: int = 0
    split_ok: int = 0
    split_bad: int = 0
    malformed: int = 0
    outside: int = 0

    def call(self, w: Window) -> _Answer:
        """Every check runs after the wait and just before the request (design EC 1.2)."""
        if self.calls:
            self.sleep(self.pace)
        now = self.clock().astimezone(timezone.utc)
        day = self.started.date().isoformat()
        if self.calls >= RUN_CAP:
            raise _Stop("call cap")
        if now.date().isoformat() != day:
            raise _Stop("UTC date changed")
        if self.charged.get(day, 0) + self.calls >= DAY_CAP:
            raise _Stop("daily call cap")
        if in_trading_hours(now):
            raise _Stop("US trading hours")
        if now >= self.started + DEADLINE:
            raise _Stop("time limit")
        self.calls += 1
        rows, rep = fetch_until(w, self.key, self.get, min(now + timedelta(seconds=CALL_S), self.started + HARD_STOP),
                                self.clock)
        if rep.failure is not None:
            self.saw_429 = self.saw_429 or rep.status == 429
            self.unanswered.append(w)
            raise _Stop(rep.failure)
        self.malformed += rep.malformed
        self.outside += rep.outside
        ans = _Answer(w, rows)
        self.answers.append(ans)
        return ans

    def ask(self, w: Window) -> Counter:
        """The rows under `w`, whole (every field the cache reads, the actual figures themselves included) and
        counted: a reply of SPLIT_AT rows or more is asked again as its halves (R1) and checked against them (R3;
        Codex S-3, S-5: a changed release time, label or actual figure, or a duplicate, fails the check). A stop part-way leaves every answer so far in place."""
        ans = self.call(w)
        whole = Counter((x["s"], x["d"], x["h"], x["y"], x["q"], x["a"]) for x in ans.rows)
        span = (w.end - w.start).days + 1
        if len(ans.rows) < SPLIT_AT or span == 1:
            return whole
        ans.split = True
        self.splits += 1
        first = Window(w.start, w.start + timedelta(days=span // 2 - 1))
        union = self.ask(first)
        union += self.ask(Window(first.end + timedelta(days=1), w.end))
        ok = union == whole if len(ans.rows) < CAP else not (whole - union)
        self.split_ok += ok
        self.split_bad += not ok
        return union


@dataclass
class RunResult:
    status: str  # passing | partial | inconsistent | failed | skipped
    line: str  # the one public summary line: counts only
    wrote: bool


def _charged(vault: Mapping, exclude: str | None = None) -> dict[str, int]:
    out: dict[str, int] = defaultdict(int)
    for r in vault.get("runs") or []:
        if r.get("id") != exclude:
            for day, n in (r.get("calls_by_utc_date") or {}).items():
                out[day] += int(n)
    return dict(out)


def _prune_runs(vault: dict, now: datetime) -> None:
    vault["runs"] = [r for r in vault.get("runs") or [] if now - store.at(r["finished"]) <= KEEP_RUNS]


RESERVATION_SPAN = timedelta(minutes=10)  # the step's timeout: a reservation's run ends by then (DR-23)
UNCERTAIN = "accounting uncertain"


@dataclass
class _Start:
    vault: dict
    m: int  # the highest seq observed: every ledger asset listed (opened or not) and the vault table (DR-22)
    note: str = ""
    restart: str | None = None  # why the accounting is uncertain (design 9.3), else None


def _start_state(conn, secret: str, st: "ledger.State", start: datetime) -> _Start | str:
    """The state the run starts from (design 9.1, 9.3), or the reason it must stop without any write."""
    table = store.open_vault(conn, secret)
    t_vault = table.vault if table.status == "ok" else None
    t_seq = int(t_vault.get("seq") or 0) if t_vault is not None else 0
    m = max([t_seq] + [store.ledger_seq(n) for n in st.names])
    opened: list[tuple[int, dict]] = []
    top_ok = True
    for seq in sorted(st.files, reverse=True):
        try:
            o = store.open_ledger(st.files[seq].read_bytes(), secret, seq)
        except OSError:
            o = store.Opened("unreadable")
        if o.status == "ok":
            opened.append((seq, o.vault))
        elif seq == st.top:
            top_ok = False
    restart = None
    if st.state == "ok" and (not top_ok or not opened or opened[0][0] != st.top):
        restart = "the newest ledger asset does not open"
    if st.state == "absent" and t_vault is not None and t_vault.get("seq") is not None:
        restart = "the ledger is missing"
    best = opened[0] if opened else None
    if best is not None and t_vault is not None and t_seq == best[0] and t_vault != best[1]:
        restart = "the ledger and the vault disagree"
    if best is None and table.status == "unreadable" and restart is None:
        return "the vault does not open"  # never overwrite a corrupt blob silently (design 1.1)
    if best is not None and (t_vault is None or best[0] >= t_seq):
        base = best[1]
    elif t_vault is not None:
        base = t_vault
    else:
        base = store.empty_vault()
    for k, v in store.empty_vault().items():
        base.setdefault(k, v)
    note = "" if (best is not None or table.status == "ok") else f" (new vault: {table.status})"
    return _Start(base, m, note, restart)


def _write_final(conn, vault: dict, secret: str, seq: int, now: datetime, directory: Path, gh) -> bool:
    """A final state (design 9.4): the vault table, then a new ledger asset marked pending, then one upload try;
    the always-run step uploads it if this try fails. True when it reached the release now."""
    vault["seq"] = seq
    store.write_vault(conn, vault, secret, now)
    path = ledger.write_local(directory, seq, store.seal_ledger(vault, secret, seq, now))
    ledger.mark_pending(directory, path)
    if ledger.upload(directory, path, gh):
        ledger.mark_pending(directory, None)
        return True
    return False


def _record_skip(conn, start: _Start, secret: str, now: datetime, reason: str, directory: Path, gh) -> RunResult:
    vault = start.vault
    vault["runs"].append({"id": store.iso(now), "started": store.iso(now), "finished": store.iso(now),
                          "status": store.SKIPPED, "calls": 0, "calls_by_utc_date": {}, "saw_429": False,
                          "reason": reason})
    _prune_runs(vault, now)
    _write_final(conn, vault, secret, start.m + 1, now, directory, gh)
    return RunResult(store.SKIPPED, f"{TAG} skipped: {reason}", True)


def _restart(conn, start: _Start, secret: str, now: datetime, directory: Path, gh) -> RunResult:
    """Conservative restart (design 9.3): uncertain accounting is never reset to zero. A synthetic record charges
    the whole day and assumes a 429 now; a barrier withdraws every day, so no older read supports any day."""
    vault = start.vault
    today = now.astimezone(NY).date()
    vault["runs"].append({"id": store.iso(now), "started": store.iso(now), "finished": store.iso(now),
                          "status": store.PARTIAL, "calls": DAY_CAP,
                          "calls_by_utc_date": {now.date().isoformat(): DAY_CAP}, "saw_429": True,
                          "reason": UNCERTAIN})
    days = {(today + timedelta(days=n)).isoformat() for n in range(-KEEP_DAYS_BEFORE, HORIZON_DAYS)}
    days |= set(vault.get("days") or {}) | set(vault.get("withdrawn") or {})
    for p in (vault.get("provisional") or {}).values():
        days |= set(p.get("days") or ())
    withdrawn = vault.setdefault("withdrawn", {})
    for d in days:
        withdrawn[d] = store.iso(now)
    vault["provisional"] = {}
    _prune_runs(vault, now)
    _write_final(conn, vault, secret, start.m + 1, now, directory, gh)
    return RunResult(store.SKIPPED, f"{TAG} skipped: {UNCERTAIN} ({start.restart})", True)


def _holds(r: Mapping) -> bool:
    """A record that may stand for a run that passed or whose accounting is uncertain: spacing counts it (9.5)."""
    return r.get("status") == store.PASSING or r.get("provisional") is True or r.get("reason") == UNCERTAIN


def run_cache(db_path: Path, *, now: datetime | None = None, get=None, sleep: Callable[[float], None] = _time.sleep,
              clock: Callable[[], datetime] | None = None, api_key: str | None = None,
              cache_key: str | None = None, env: Mapping[str, str] | None = None,
              ledger_dir: Path | None = None, gh=None) -> RunResult:
    """One run of the step (design EC sections 1 and 9). Never raises for Finnhub, the key, the vault or the
    ledger: every end is a RunResult with one summary line."""
    clock = clock or (lambda: datetime.now(timezone.utc))
    start = (now or clock()).astimezone(timezone.utc)
    env = os.environ if env is None else env
    key = _api_key() if api_key is None else api_key
    if not key:
        return RunResult(store.SKIPPED, f"{TAG} skipped: no Finnhub key", False)
    secret = env.get(store.KEY_ENV, "").strip() if cache_key is None else cache_key
    if not secret:
        return RunResult(store.SKIPPED, f"{TAG} skipped: no cache key", False)
    directory = Path(ledger_dir) if ledger_dir is not None else Path(db_path).parent
    gh = gh or ledger.gh_cli(env)
    st = ledger.read_state(directory)
    if st.state == "unavailable":  # the run cannot know a newer ledger: no call and no competing seq (9.3)
        return RunResult(store.SKIPPED, f"{TAG} skipped: the ledger could not be read", False)
    conn = sqlite3.connect(db_path)
    try:
        s0 = _start_state(conn, secret, st, start)
        if isinstance(s0, str):
            return RunResult(store.SKIPPED, f"{TAG} skipped: {s0}", False)
        if s0.restart:
            return _restart(conn, s0, secret, start, directory, gh)
        vault = s0.vault
        gate = actions_gate(env, start)
        if gate:
            return RunResult(store.SKIPPED, f"{TAG} skipped: {gate}", False)
        if in_trading_hours(start):
            return _record_skip(conn, s0, secret, start, "US trading hours", directory, gh)
        held = [store.at(r["finished"]) for r in vault["runs"] if _holds(r)]
        if held and start - max(held) < SPACING:
            return _record_skip(conn, s0, secret, start, "a complete run finished less than 10 hours ago",
                                directory, gh)
        slow = any(r.get("saw_429") and start - store.at(r["finished"]) < SLOW_FOR for r in vault["runs"])
        rid = store.iso(start)
        today = start.astimezone(NY).date()
        plan = windows(today) + [Window(today - timedelta(days=LOOKBACK_DAYS), today - timedelta(days=1))]
        # the reservation (design 9.4): durable in the release before any call, or no call at all
        vault["runs"].append({"id": rid, "started": rid, "finished": store.iso(start + RESERVATION_SPAN),
                              "status": store.PARTIAL, "calls": RUN_CAP,
                              "calls_by_utc_date": {start.date().isoformat(): RUN_CAP}, "saw_429": True,
                              "provisional": True, "reason": "interrupted"})
        planned = sorted({(w.start + timedelta(days=n)).isoformat() for w in plan
                          for n in range((w.end - w.start).days + 1)})
        vault.setdefault("provisional", {})[rid] = {"at": rid, "days": planned}
        vault["seq"] = s0.m + 1
        path = ledger.write_local(directory, s0.m + 1, store.seal_ledger(vault, secret, s0.m + 1, start))
        if not ledger.upload(directory, path, gh):
            path.unlink(missing_ok=True)
            return RunResult(store.SKIPPED, f"{TAG} skipped: the ledger could not be written", False)
        try:
            store.write_vault(conn, vault, secret, start)
        except sqlite3.Error:
            pass  # the reservation is durable in the release; the final write retries the table
        r = _Run(key, get, sleep, clock, start, SLOW_PACE_S if slow else PACE_S, _charged(vault, exclude=rid))
        stopped = None
        sleep(GAP_S)
        try:
            for w in plan:
                r.ask(w)
        except _Stop as stop:
            stopped = stop.reason
        finished = clock().astimezone(timezone.utc)
        # other runs' provisional withdrawals: those runs are over (data-write concurrency), so they now count
        vault["provisional"].pop(rid, None)
        withdrawn = vault.setdefault("withdrawn", {})
        for p in vault["provisional"].values():
            for d in p.get("days") or ():
                withdrawn[d] = max(withdrawn.get(d, p["at"]), p["at"])
        vault["provisional"] = {}
        status, counts = _merge(db_path, vault, r, today, start, finished, stopped)
        rec = next(x for x in vault["runs"] if x["id"] == rid)
        rec.pop("provisional", None)
        rec.update(finished=store.iso(finished), status=status, calls=r.calls,
                   calls_by_utc_date={start.date().isoformat(): r.calls} if r.calls else {}, saw_429=r.saw_429,
                   reason=stopped or "", counts=counts)
        _prune_runs(vault, finished)
        _write_final(conn, vault, secret, s0.m + 2, finished, directory, gh)
        line = (f"{TAG} {status}{s0.note}: " + ", ".join(f"{k} {v}" for k, v in counts.items())
                + (f"; stopped: {stopped}" if stopped else ""))
        return RunResult(status, line, True)
    finally:
        conn.close()


def _covering(answers: list[_Answer], d: date) -> _Answer | None:
    """The smallest answered window that contains `d` (design EC 1.4)."""
    best = None
    for a in answers:
        if a.window.start <= d <= a.window.end and (best is None or a.window.end - a.window.start < best.window.end - best.window.start):
            best = a
    return best


def _merge(db_path: Path, vault: dict, r: _Run, today: date, start: datetime, finished: datetime,
           stopped: str | None) -> tuple[str, dict]:
    covered: dict[date, tuple[_Answer, bool]] = {}
    for a in r.answers:
        d = a.window.start
        while d <= a.window.end:
            if d not in covered:
                c = _covering(r.answers, d)
                covered[d] = (c, not c.split and len(c.rows) < CAP)  # a split parent covers only an unanswered half
            d += timedelta(days=1)
    capped = sum(1 for c, _ in covered.values() if c.window.start == c.window.end and len(c.rows) >= CAP)
    incomplete = sum(1 for _, ok in covered.values() if not ok)
    stored = stored_dates(db_path, today, start)
    wanted = [(s, d) for s, ds in sorted(stored.items()) for d in sorted(ds) if d in covered and covered[d][1]]
    seen = {(x["s"], x["d"]) for c, _ in covered.values() for x in c.rows}
    missed = sum(1 for p in wanted if p not in seen)
    if not r.answers:
        status = store.FAILED
    elif r.malformed or r.outside or r.split_bad or missed or not wanted:
        status = store.INCONSISTENT
    elif stopped is not None or capped or incomplete:
        status = store.PARTIAL
    else:
        status = store.PASSING
    at = store.iso(finished)
    days = vault.setdefault("days", {})
    for d, (c, ok) in sorted(covered.items()):
        rows = sorted([x["s"], x["h"], x["y"], x["q"], x["r"]] for x in c.rows if x["d"] == d)
        entry = {"run": store.iso(start), "at": at, "status": status, "complete": ok, "rows": rows}
        days[d.isoformat()] = ([entry] + list(days.get(d.isoformat()) or []))[: store.DAY_ENTRIES]
    # a request sent and not answered withdraws every day it asked for (Codex S-1, R5): older reads of those days
    # stop counting until two newer passing reads agree again; days never asked keep their reads
    withdrawn = vault.setdefault("withdrawn", {})
    for w in r.unanswered:
        d = w.start
        while d <= w.end:
            withdrawn[d.isoformat()] = at
            d += timedelta(days=1)
    keep_from = (today - timedelta(days=KEEP_DAYS_BEFORE)).isoformat()
    for k in [k for k in days if k < keep_from]:
        del days[k]
    for k in [k for k in withdrawn if k < keep_from]:
        del withdrawn[k]
    occ = vault.setdefault("occ", {})
    for a in r.answers:  # every answered reply, replaced parents included (R5: additions always count)
        for x in a.rows:
            k = f"{x['s']}|{x['d'].isoformat()}"
            o = occ.get(k) or {"s": x["s"], "d": x["d"].isoformat(), "labels": [], "reported": [], "f": at}
            o["h"], o["l"] = x["h"], at
            lab = store.label(x["y"], x["q"])
            if lab is not None and list(lab) not in o["labels"]:
                o["labels"].append(list(lab))
            # reported evidence is bound to the label it was seen with, from a passing run only (design EC 1.6)
            if status == store.PASSING and x["r"] and lab is not None and x["d"] <= today and list(lab) not in o["reported"]:
                o["reported"].append(list(lab))
                # provenance of a retained anchor (Amendment A-1): the first passing run that saw it reported
                o.setdefault("reported_by", []).append([lab[0], lab[1], store.iso(start), at])
            occ[k] = o
    cutoff = (today - timedelta(days=KEEP_OCC_DAYS)).isoformat()
    for k in [k for k, o in occ.items() if o["d"] < cutoff]:
        del occ[k]
    counts = {"calls": r.calls, "replies": len(r.answers), "rows": sum(len(a.rows) for a in r.answers),
              "windows split": r.splits, "split checks passed": r.split_ok, "split checks failed": r.split_bad,
              "capped days": capped, "cross-check": f"{len(wanted) - missed} of {len(wanted)}"}
    counts.update(reader_counts(vault, today, finished))
    return status, counts


def reader_counts(vault: Mapping, session: date, now: datetime) -> dict:
    """Counts only: names with a valid label, names reconciled, possible events open (design EC 1.7)."""
    labelled = reconciled = possible = 0
    for raws in store.index(vault).values():
        labelled += any(raw.get("labels") for raw in raws)
        cov = store.coverage(vault, raws, session, now)
        reconciled += cov.state == "reconciled"
        possible += sum(1 for o in cov.events if o.possible)
    return {"names labelled": labelled, "names reconciled": reconciled, "possible events": possible}


def report(db_path: Path, secret: str, now: datetime) -> list[str]:
    """`--report`: the vault's health as counts per state, for the owner's local check (needs the key)."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        opened = store.open_vault(conn, secret)
    finally:
        conn.close()
    if opened.status != "ok":
        return [f"{TAG} report: the vault is {opened.status}"]
    vault = opened.vault
    states: dict[str, int] = defaultdict(int)
    session = now.astimezone(NY).date()
    for raws in store.index(vault).values():
        states[store.coverage(vault, raws, session, now).state] += 1
    runs = vault.get("runs") or []
    out = [f"{TAG} report: {len(runs)} runs kept; last 5: " + ", ".join(r.get("status", "?") for r in runs[-5:])]
    d = store.stable_through(vault, session, now)
    out.append(f"{TAG} report: stable days from today: {(d - session).days + 1 if d else 0}")
    out.append(f"{TAG} report: names by state: " + ", ".join(f"{k} {v}" for k, v in sorted(states.items())))
    return out


def _announced(key: str, db: Path, now: datetime) -> Report:
    print(f"[earnings-cache probe] calling Finnhub: {len(windows(now.astimezone(NY).date())) + 1 + 2 * HEAVY_WINDOWS} calls, about 2.5 minutes ...")
    return probe(key, db, now=now)


def main(argv: list[str] | None = None, *, now: datetime | None = None) -> int:
    ap = argparse.ArgumentParser(description="The Options Finder's earnings cache: one run of the refresh step by "
                                             "default, or the read-only probe, or a local report.")
    ap.add_argument("--probe", action="store_true", help="run the read-only free-plan probe")
    ap.add_argument("--report", action="store_true", help="print the vault's counts per state (needs the cache key)")
    ap.add_argument("--fetch-ledger", action="store_true", help="the workflow's step before the run: list and "
                                                               "download the durable ledger (design 9.2)")
    ap.add_argument("--publish-ledger", action="store_true", help="the workflow's always-run step: upload a final "
                                                                 "ledger state still pending (design 9.2)")
    ap.add_argument("--db", help="the database (the step: data/macro_radar.db; the probe: default a temporary copy "
                                 "of the public data-latest database)")
    args = ap.parse_args(argv)
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    if args.fetch_ledger or args.publish_ledger:
        directory = (Path(args.db) if args.db else DB_PATH).parent
        try:
            if args.fetch_ledger:
                st = ledger.fetch(directory, ledger.gh_cli())
                print(f"{TAG} ledger: {st.state}, {len(st.names)} assets" + (f" ({st.reason})" if st.reason else ""))
            else:
                print(f"{TAG} ledger publish: {ledger.publish_pending(directory, ledger.gh_cli())}")
        except Exception as exc:  # never fail the refresh
            print(f"{TAG} ledger failed: {type(exc).__name__}")
        return 0
    if not args.probe:
        db = Path(args.db) if args.db else DB_PATH
        if args.report:
            secret = os.environ.get(store.KEY_ENV, "").strip()
            if not secret or not db.exists():
                print(f"{TAG} report: needs {store.KEY_ENV} and an existing --db")
                return 2
            for line in report(db, secret, now):
                print(line)
            return 0
        try:
            res = run_cache(db, now=now)
        except Exception as exc:  # never fail the refresh, never print a message that could carry the key
            print(f"{TAG} failed: {type(exc).__name__}")
            return 0
        print(res.line)
        return 0
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
