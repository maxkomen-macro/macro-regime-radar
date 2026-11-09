"""scripts/memo_queue.py — once-per-session memos from a durable queue (CS-2).

Max, 2026-11-05 19:14 UTC, item 6: the first validated full refresh after the
close sends the daily memo, once per completed NYSE session. Design
.loop/design-CS2.md v16 (Codex design review, approved on pass 15). This module
holds every rule of that design that is not page rendering:

- keys: a daily key is an NYSE session date S, a weekly key an ISO week
  GGGG-Www; `covers` decides which sessions a validated database covers;
- records: the source registry docs/memo/sources.json (written only by
  refresh-data's "Record memo sources" step) and the ledgers
  docs/memo/ledger-{daily,weekly}.json (written only by the memo workflows),
  all read from a fresh origin/main and written through
  scripts/publish_artifacts.sh with --expect (compare-and-swap; exit 4 means
  the file changed under this run, and the run stops);
- discovery: which validated attempt first covered each key, from the run
  history and the validated-meta-<attempt> artifacts, complete or not at all;
- plan, reconcile, reserve, publish, finalize and record: the memo workflow's
  steps, one key per run.

Content (the price pin, the session-dated market metrics and the market alert
fix-up) lives in scripts/memo_content.py and is re-exported here.

Delivery claim: the automated path never sends a key again after SMTP may have
accepted it (anything unclear is `ambiguous`, which only an owner resend can
follow). That is at-most-once for automation with visible failures, not
exactly-once delivery.

Subcommands (one per workflow step): meta, sources, plan, verify, pin,
market-metrics, market-alerts, reserve, publish, finalize, outcome, record.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import sqlite3
import subprocess
import sys
import zipfile
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable, Iterable

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data import session  # noqa: E402  (stdlib only)
from scripts.memo_content import fix_market_alerts, pin, store_market_metrics  # noqa: E402,F401  (re-exported)
from scripts.close_sentinel import (  # noqa: E402
    Budget, Clock, GhError, OutOfTime, asset_symbols, calendar_known, market_symbols,
)

UTC = timezone.utc

# ── constants ─────────────────────────────────────────────────────────────────

# The first key the queue ever expects: the first NYSE session after the CS-2
# merge (design section 3, DR-33). It must be confirmed when the PR merges;
# no daily or weekly key before it is ever queued. Until this date only manual
# runs produce memos.
QUEUE_START = date(2026, 11, 16)

CLOSE_LAG = timedelta(minutes=15)       # rule 2: a session counts 15 minutes after its close
DAILY_WINDOW = timedelta(days=30)       # discovery window, daily keys
WEEKLY_WINDOW = timedelta(days=35)      # discovery window, weekly keys
NEWEST_COVERED_SEARCH = 10              # sessions searched back for a weekly pin
# A re-run is possible "up to 30 days after its initial run" (GitHub docs, re-running
# workflows), and a job on a GitHub-hosted runner runs for at most 6 hours (usage
# limits). An attempt is a memo source only when validated within 31 days of its
# run's creation: a definition, not a derivation (DR-61).
ELIGIBLE_AFTER_CREATE = timedelta(days=31)
JOB_LIMIT = timedelta(hours=6)
SOURCE_RETENTION = timedelta(days=3)    # validated-db's retention-days (unchanged)
MAX_TRIES = 3
MAX_PAGES = 50
MAX_REQUESTS = 300
PER_PAGE = 100
DAY_RUN_LIMIT = 1000                    # the `created` filter returns at most 1,000 runs

REFRESH_WORKFLOW = "refresh-data.yml"
REFRESH_JOB = "refresh"
RECORD_STEP = "Record the validated run for downstream memos"
VALIDATE_STEP = "Validate the refreshed database"
MEMO_JOB = "email-memo"
PLAN_STEP = "Plan the memo"
SEND_STEP = "Send memo email"
LEGACY_MARKER = "scripts/memo_queue.py"   # absent at a run's head_sha: the run is pre-CS-2

KINDS = ("daily", "weekly")
LEDGER = {"daily": "docs/memo/ledger-daily.json", "weekly": "docs/memo/ledger-weekly.json"}
SOURCES = "docs/memo/sources.json"
PAGE = {"daily": "docs/memo/daily_memo.html", "weekly": "docs/memo/weekly_memo.html"}
MEMO_WORKFLOW = {"daily": "daily-memo.yml", "weekly": "weekly-memo.yml"}
PAGE_URL = {
    "daily": "https://maxkomen-macro.github.io/macro-regime-radar/memo/daily_memo.html",
    "weekly": "https://maxkomen-macro.github.io/macro-regime-radar/memo/weekly_memo.html",
}
BUNDLE = ROOT / "output" / "memo-bundle"
FINAL = ROOT / "output" / "memo-final"
OUTCOME_DIR = ROOT / "output" / "memo-outcome"
SENT_DATE_TOKEN = "__MEMO_SENT_DATE__"
ALERT_NOTE = ROOT / "output" / "memo-alert-note.txt"   # read by src/memo.py under MEMO_SESSION

STATES = ("attempt", "sending", "sent", "not_sent", "ambiguous", "failed", "skipped", "blocked")
TERMINAL = frozenset({"sent", "ambiguous", "failed", "skipped", "blocked"})
ENTRY_FIELDS = frozenset({"state", "tries", "source", "memo_run_id", "run_attempt", "output_artifact",
                          "updated_at", "note", "overrides", "paid_generation"})
SOURCE_FIELDS = frozenset({"state", "origin_run_id", "origin_attempt", "validated_at", "db_sha256",
                           "validation_sha256", "pin_session", "reason"})
HEX64 = re.compile(r"[0-9a-f]{64}")
WEEK_RE = re.compile(r"(\d{4})-W(\d{2})")


# ── errors ────────────────────────────────────────────────────────────────────


class QueueError(RuntimeError):
    """Stops the step with nothing sent (exit 1)."""


class RecordError(QueueError):
    """A ledger or registry that is missing, invalid or of an unknown version (DR-66)."""


class CasConflict(QueueError):
    """publish_artifacts.sh exit 4: the file changed under this run."""


class Incomplete(QueueError):
    """Discovery could not read everything it needs; nothing is chosen or written."""


class Unknown(QueueError):
    """A prior execution whose outcome cannot be established; the walk stops."""


# ── time helpers ──────────────────────────────────────────────────────────────


def ts(value: str | None) -> datetime | None:
    if not value:
        return None
    d = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if d.tzinfo is None:
        raise ValueError(f"timestamp without a zone: {value!r}")
    return d.astimezone(UTC)


def iso(d: datetime) -> str:
    return d.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def day_of(value: str) -> date:
    d = date.fromisoformat(value)
    if d.isoformat() != value:
        raise ValueError(f"not a YYYY-MM-DD date: {value!r}")
    return d


def close_grace_until(s: date) -> datetime:
    """api/freshness.close_grace_until: 06:00 UTC on the calendar day after s (pinned by a test)."""
    return datetime.combine(s + timedelta(days=1), time(6, 0), tzinfo=UTC)


# ── keys ──────────────────────────────────────────────────────────────────────


def close_utc(s: date) -> datetime:
    c = session.session_close_utc(s)
    if c is None:
        raise ValueError(f"{s} is not an NYSE session")
    return c


def session_done(s: date, t: datetime) -> bool:
    """Rules 1 and 2: s is a session of a known calendar year and its close passed 15 minutes before t."""
    return calendar_known(s) and session.is_trading_day(s) and close_utc(s) + CLOSE_LAG <= t


def sessions(first: date, last: date) -> list[date]:
    """NYSE sessions first..last inclusive, in known calendar years only."""
    out, d = [], first
    while d <= last:
        if calendar_known(d) and session.is_trading_day(d):
            out.append(d)
        d += timedelta(days=1)
    return out


def missing_at(conn: sqlite3.Connection, s: date, market: list[str], assets: list[str]) -> list[str]:
    """Rule 3: the required symbols with no row dated exactly s (per symbol, no substitution)."""
    iso_s = s.isoformat()
    out = []
    for sym in market:
        if conn.execute("SELECT 1 FROM market_daily WHERE symbol = ? AND date = ? LIMIT 1", (sym, iso_s)).fetchone() is None:
            out.append(f"market_daily:{sym}")
    for sym in assets:
        if conn.execute("SELECT 1 FROM asset_prices WHERE symbol = ? AND interval = '1d' AND date = ? LIMIT 1",
                        (sym, iso_s)).fetchone() is None:
            out.append(f"asset_prices:{sym}")
    return out


def covers(conn: sqlite3.Connection, s: date, t: datetime, market: list[str], assets: list[str]) -> bool:
    """Rules 1-3 (design section 1): a snapshot validated at t covers session s."""
    return session_done(s, t) and not missing_at(conn, s, market, assets)


def daily_window_start(t: datetime) -> date:
    return max(QUEUE_START, (t - DAILY_WINDOW).date())


def expected_daily(t: datetime, start: date | None = None) -> list[date]:
    """Every session from `start` (QUEUE_START) whose close passed at t (rule 2)."""
    first = start or QUEUE_START
    return [s for s in sessions(first, t.date()) if session_done(s, t)]


def covered_daily(conn: sqlite3.Connection, t: datetime, market: list[str], assets: list[str]) -> list[date]:
    """The daily keys of the discovery window this snapshot covers (section 2a)."""
    return [s for s in expected_daily(t, daily_window_start(t)) if not missing_at(conn, s, market, assets)]


def newest_covered(conn: sqlite3.Connection, t: datetime, market: list[str], assets: list[str]) -> date | None:
    """The newest session this snapshot covers, searched back over at most 10 sessions from
    the newest whose close passed at t, with no QUEUE_START bound (the weekly pin, DR-60)."""
    d, seen = t.date(), 0
    while seen < NEWEST_COVERED_SEARCH and calendar_known(d):
        if session.is_trading_day(d) and session_done(d, t):
            seen += 1
            if not missing_at(conn, d, market, assets):
                return d
        d -= timedelta(days=1)
    return None


def week_key(d: date) -> str:
    g, w, _ = d.isocalendar()
    return f"{g:04d}-W{w:02d}"


def monday(key: str) -> date:
    m = WEEK_RE.fullmatch(key or "")
    if not m:
        raise ValueError(f"not an ISO week key: {key!r}")
    d = date.fromisocalendar(int(m.group(1)), int(m.group(2)), 1)
    if week_key(d) != key:
        raise ValueError(f"not an ISO week key: {key!r}")
    return d


def next_week(key: str) -> str:
    return week_key(monday(key) + timedelta(days=7))


def monday_utc(key: str) -> datetime:
    return datetime.combine(monday(key), time(0, 0), tzinfo=UTC)


def expected_weekly(started: date, start: date | None = None) -> list[str]:
    """Every week W with start <= monday(W) <= started (section 3), ascending by monday."""
    first = start or QUEUE_START
    d = first + timedelta(days=(7 - first.weekday()) % 7)   # the first Monday on or after `first`
    out = []
    while d <= started:
        out.append(week_key(d))
        d += timedelta(days=7)
    return out


def valid_key(kind: str, key: str) -> bool:
    try:
        if kind == "daily":
            s = day_of(key)
            return calendar_known(s) and session.is_trading_day(s)
        monday(key)
        return True
    except (ValueError, TypeError):
        return False


def key_order(kind: str, key: str) -> date:
    return day_of(key) if kind == "daily" else monday(key)


def key_close(kind: str, key: str) -> datetime:
    """F's ingredient (section 3): a daily key's close, a weekly key's Monday 00:00 UTC."""
    return close_utc(day_of(key)) if kind == "daily" else monday_utc(key)


def hold_deadline(kind: str, key: str) -> datetime:
    """When a key with no registry entry stops holding the walk (section 4)."""
    if kind == "daily":
        return close_grace_until(day_of(key)) + timedelta(hours=24)
    return datetime.combine(monday(key) + timedelta(days=2), time(6, 0), tzinfo=UTC)


def expected_keys(kind: str, now: datetime) -> list[str]:
    if kind == "daily":
        return [s.isoformat() for s in expected_daily(now)]
    return expected_weekly(now.date())


def completed_newer(kind: str, key: str, now: datetime) -> bool:
    """Delayed, second arm (DR-62): a newer key has completed by the wall clock."""
    if kind == "daily":
        s = day_of(key)
        return any(session_done(x, now) for x in sessions(s + timedelta(days=1), now.date()))
    return now >= monday_utc(next_week(key))


def is_delayed(kind: str, key: str, registry: dict, now: datetime) -> bool:
    """Section 6: a newer key of the same kind has a registry source, or has completed by the clock."""
    order = key_order(kind, key)
    for k, src in registry[kind].items():
        if key_order(kind, k) > order and src.get("state") == "source":
            return True
    return completed_newer(kind, key, now)


# ── records ───────────────────────────────────────────────────────────────────


def dumps(obj: dict) -> str:
    return json.dumps(obj, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def empty_ledger(kind: str) -> dict:
    return {"version": 1, "kind": kind, "published": None, "keys": {}}


def empty_registry() -> dict:
    return {"version": 1, "daily": {}, "weekly": {}}


def _check_source(kind: str, key: str, src) -> None:
    where = f"sources.json {kind} {key}"
    if not isinstance(src, dict) or not set(src) <= SOURCE_FIELDS:
        raise RecordError(f"{where}: not a source record")
    state = src.get("state")
    if state == "source":
        for f in ("origin_run_id", "origin_attempt"):
            if not isinstance(src.get(f), int) or isinstance(src.get(f), bool) or src[f] < 1:
                raise RecordError(f"{where}: {f} is not a positive integer")
        for f in ("db_sha256", "validation_sha256"):
            if not isinstance(src.get(f), str) or not HEX64.fullmatch(src[f]):
                raise RecordError(f"{where}: {f} is not a sha256")
        try:
            if ts(src.get("validated_at")) is None:
                raise ValueError("validated_at is empty")
            day_of(src.get("pin_session"))
        except (ValueError, TypeError) as exc:
            raise RecordError(f"{where}: {exc}") from exc
    elif state == "blocked":
        if not isinstance(src.get("reason"), str) or not src["reason"]:
            raise RecordError(f"{where}: a blocked record needs a reason")
    else:
        raise RecordError(f"{where}: unknown state {state!r}")


def parse_registry(text: str) -> dict:
    try:
        reg = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RecordError(f"{SOURCES} is not valid JSON: {exc}") from exc
    if not isinstance(reg, dict) or reg.get("version") != 1:
        raise RecordError(f"{SOURCES}: unknown version {reg.get('version') if isinstance(reg, dict) else reg!r}")
    if set(reg) != {"version", "daily", "weekly"}:
        raise RecordError(f"{SOURCES}: unexpected fields {sorted(set(reg) ^ {'version', 'daily', 'weekly'})}")
    for kind in KINDS:
        if not isinstance(reg[kind], dict):
            raise RecordError(f"{SOURCES}: {kind} is not an object")
        for key, src in reg[kind].items():
            if not valid_key(kind, key):
                raise RecordError(f"{SOURCES}: invalid {kind} key {key!r}")
            _check_source(kind, key, src)
    return reg


def parse_ledger(kind: str, text: str) -> dict:
    path = LEDGER[kind]
    try:
        led = json.loads(text)
    except (json.JSONDecodeError, TypeError) as exc:
        raise RecordError(f"{path} is not valid JSON: {exc}") from exc
    if not isinstance(led, dict) or led.get("version") != 1:
        raise RecordError(f"{path}: unknown version {led.get('version') if isinstance(led, dict) else led!r}")
    if set(led) != {"version", "kind", "published", "keys"} or led["kind"] != kind:
        raise RecordError(f"{path}: not a {kind} ledger")
    if led["published"] is not None and not valid_key(kind, led["published"]):
        raise RecordError(f"{path}: invalid published key {led['published']!r}")
    if not isinstance(led["keys"], dict):
        raise RecordError(f"{path}: keys is not an object")
    for key, e in led["keys"].items():
        if not valid_key(kind, key):
            raise RecordError(f"{path}: invalid key {key!r}")
        if not isinstance(e, dict) or not set(e) <= ENTRY_FIELDS or e.get("state") not in STATES:
            raise RecordError(f"{path}: {key}: not a ledger entry")
        if not isinstance(e.get("tries", 0), int) or isinstance(e.get("tries", 0), bool) or e.get("tries", 0) < 0:
            raise RecordError(f"{path}: {key}: tries is not a count")
        if not isinstance(e.get("overrides", []), list):
            raise RecordError(f"{path}: {key}: overrides is not a list")
    return led


def new_entry() -> dict:
    return {"state": "attempt", "tries": 0, "source": None, "memo_run_id": None, "run_attempt": None,
            "output_artifact": None, "updated_at": None, "note": "", "overrides": [], "paid_generation": None}


def outcome_artifact(kind: str, key: str, run_id: int | str, attempt: int | str) -> str:
    return f"memo-outcome-{kind}-{key}-{run_id}-{attempt}"


# ── git: read from a fresh origin/main, write through the publisher ──────────


Runner = Callable[..., subprocess.CompletedProcess]


class Store:
    """The ledgers and the registry on main: read from a fresh fetch, written with --expect."""

    def __init__(self, root: Path = ROOT, runner: Runner = subprocess.run, remote: str = "origin", branch: str = "main"):
        self.root, self.runner, self.ref = Path(root), runner, f"{remote}/{branch}"
        self.remote, self.branch = remote, branch

    def _git(self, *args: str, timeout: float = 120, check: bool = True) -> subprocess.CompletedProcess:
        cp = self.runner(["git", *args], cwd=self.root, capture_output=True, text=True, timeout=timeout)
        if check and cp.returncode != 0:
            raise QueueError(f"git {' '.join(args[:2])} failed: {(cp.stderr or '').strip()[:300]}")
        return cp

    def fetch(self) -> None:
        last = ""
        for _ in range(2):   # at most 2 x 60 s, so a fetch plus one publish fits a 15-minute step
            try:
                cp = self._git("fetch", "--quiet", self.remote, self.branch, timeout=60, check=False)
            except subprocess.TimeoutExpired:
                last = "timed out"
                continue
            if cp.returncode == 0:
                return
            last = (cp.stderr or "").strip()[:300]
        raise QueueError(f"git fetch {self.remote} {self.branch} failed: {last}")

    def read(self, path: str) -> tuple[str, str]:
        """(text, blob sha) of path at the fetched main. A missing file is an error (DR-66)."""
        cp = self._git("rev-parse", "--verify", "--quiet", f"{self.ref}:{path}", check=False)
        blob = (cp.stdout or "").strip()
        if cp.returncode != 0 or not blob:
            raise RecordError(f"{path} is missing on main. It is never treated as empty: restore it from git "
                              f"history (git log -- {path}) through a reviewed pull request.")
        text = self._git("cat-file", "blob", blob).stdout
        return text, blob

    def has_code(self, sha: str) -> bool:
        """True when commit `sha` contains scripts/memo_queue.py (a CS-2 run); False when it does not
        (a legacy run). A commit this clone does not hold is an error, never a guess."""
        if not re.fullmatch(r"[0-9a-f]{40}", sha or ""):
            raise Incomplete(f"run head_sha {sha!r} is not a commit sha")
        if self._git("cat-file", "-e", f"{sha}^{{commit}}", check=False).returncode != 0:
            raise Incomplete(f"commit {sha} is not in this clone; cannot tell whether its run is pre-CS-2")
        return self._git("cat-file", "-e", f"{sha}:{LEGACY_MARKER}", check=False).returncode == 0

    def publish(self, message: str, files: dict[str, str], expects: dict[str, str]) -> dict[str, str]:
        """Write files into the checkout and publish them in one commit with --expect for each
        expected path. Returns each written file's blob (main's blob after success)."""
        for rel, text in files.items():
            p = self.root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text, encoding="utf-8")
        cmd = ["bash", "scripts/publish_artifacts.sh"]
        for rel, blob in expects.items():
            cmd += ["--expect", f"{rel}={blob}"]
        cmd += [message, *files]
        cp = self.runner(cmd, cwd=self.root, capture_output=True, text=True, timeout=14 * 60)
        sys.stdout.write(cp.stdout or "")
        sys.stderr.write(cp.stderr or "")
        if cp.returncode == 4:
            raise CasConflict("a ledger or the registry changed under this run (publish_artifacts.sh exit 4); "
                              "nothing was committed, and the next run re-reads it")
        if cp.returncode != 0:
            raise QueueError(f"publish_artifacts.sh failed ({cp.returncode}); nothing is assumed published")
        return {rel: self._git("hash-object", "--", rel).stdout.strip() for rel in files}


# ── GitHub API ────────────────────────────────────────────────────────────────


class Api:
    """The GitHub REST calls, through the gh CLI, bounded by a time budget and a request count."""

    def __init__(self, env: dict, budget: Budget, runner: Runner = subprocess.run, max_requests: int = MAX_REQUESTS):
        self.repo = env.get("GITHUB_REPOSITORY", "")
        if not self.repo or "/" not in self.repo:
            raise QueueError("GITHUB_REPOSITORY is not set")
        self.env = {k: v for k, v in env.items() if k != "DATA_RELEASE_TOKEN"}
        self.budget, self.runner = budget, runner
        self.requests, self.max_requests = 0, max_requests

    def _call(self, args: list[str], binary: bool = False):
        if self.requests >= self.max_requests:
            raise Incomplete(f"more than {self.max_requests} GitHub requests")
        timeout = self.budget.call_timeout()
        if timeout is None:
            raise OutOfTime("no time left for " + " ".join(args[:3]))
        self.requests += 1
        try:
            cp = self.runner(["gh", *args], env=self.env, capture_output=True, text=not binary, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise GhError(f"gh {' '.join(args[:3])} timed out") from exc
        except OSError as exc:
            raise GhError(f"gh could not start: {exc}") from exc
        if cp.returncode != 0:
            err = cp.stderr if isinstance(cp.stderr, str) else (cp.stderr or b"").decode("utf-8", "replace")
            raise GhError(f"gh {' '.join(args[:3])} failed ({cp.returncode}): {err.strip()[:300]}")
        return cp.stdout

    def _tries(self, fn: Callable[[], object]) -> object:
        last: Exception | None = None
        for attempt in range(3):
            try:
                return fn()
            except (OutOfTime, Incomplete):
                raise
            except (GhError, ValueError, KeyError, TypeError) as exc:
                last = exc
                print(f"  try {attempt + 1} failed: {exc}")
                if attempt < 2:
                    self.budget.sleep((10, 30)[attempt])
        raise GhError(f"gave up after 3 tries: {last}")

    def get(self, path: str, params: dict | None = None) -> dict:
        args = ["api", "-X", "GET", path]
        for k, v in (params or {}).items():
            args += ["-f", f"{k}={v}"]
        body = self._tries(lambda: json.loads(self._call(args)))
        if not isinstance(body, dict):
            raise GhError(f"{path}: not an object")
        return body

    def pages(self, path: str, params: dict, key: str, cap: int | None = None) -> list[dict]:
        """Every item of a paginated listing, read until `total_count` items are read. A short
        page before that, a listing past MAX_PAGES, or `total_count` above `cap` is Incomplete."""
        items: list[dict] = []
        total = None
        for page in range(1, MAX_PAGES + 1):
            body = self.get(path, {**params, "per_page": PER_PAGE, "page": page})
            batch, count = body.get(key), body.get("total_count")
            if not isinstance(batch, list) or not isinstance(count, int):
                raise Incomplete(f"{path}: malformed listing")
            if total is None:
                total = count
                if cap is not None and total > cap:
                    raise Incomplete(f"{path} {params}: {total} results, more than the {cap} the API returns")
            items.extend(batch)
            if len(items) >= total:
                return items
            if len(batch) < PER_PAGE:
                raise Incomplete(f"{path} {params}: a short page before total_count ({len(items)} of {total})")
        raise Incomplete(f"{path} {params}: more than {MAX_PAGES} pages")

    def download(self, path: str) -> bytes:
        return self._tries(lambda: self._call(["api", "-X", "GET", path], binary=True))

    def dispatch(self, workflow: str, inputs: dict) -> None:
        args = ["workflow", "run", workflow, "--repo", self.repo]
        for k, v in inputs.items():
            args += ["-f", f"{k}={v}"]
        self._call(args)

    # listings
    def runs_on_day(self, d: date) -> list[dict]:
        return self.pages(f"repos/{self.repo}/actions/workflows/{REFRESH_WORKFLOW}/runs",
                          {"created": f"{d.isoformat()}T00:00:00Z..{d.isoformat()}T23:59:59Z", "branch": "main"},
                          "workflow_runs", cap=DAY_RUN_LIMIT)

    def artifacts_named(self, name: str) -> list[dict]:
        return self.pages(f"repos/{self.repo}/actions/artifacts", {"name": name}, "artifacts")

    def run_artifacts(self, run_id: int, name: str) -> list[dict]:
        return self.pages(f"repos/{self.repo}/actions/runs/{int(run_id)}/artifacts", {"name": name}, "artifacts")

    def attempt(self, run_id: int, n: int) -> dict:
        return self.get(f"repos/{self.repo}/actions/runs/{int(run_id)}/attempts/{int(n)}")

    def attempt_jobs(self, run_id: int, n: int) -> list[dict]:
        return self.pages(f"repos/{self.repo}/actions/runs/{int(run_id)}/attempts/{int(n)}/jobs", {}, "jobs")

    def run(self, run_id: int) -> dict:
        return self.get(f"repos/{self.repo}/actions/runs/{int(run_id)}")

    def artifact_zip(self, artifact_id: int) -> zipfile.ZipFile:
        return zipfile.ZipFile(io.BytesIO(self.download(f"repos/{self.repo}/actions/artifacts/{int(artifact_id)}/zip")))


# ── coverage metadata (section 2a) ────────────────────────────────────────────


@dataclass(frozen=True)
class Meta:
    run_id: int
    attempt: int
    started_at: datetime
    validated_at: datetime
    covered_daily: tuple[date, ...]
    newest_covered: date | None
    ineligible: bool
    db_sha256: str
    validation_sha256: str

    def order(self) -> tuple:
        return (self.validated_at, self.run_id, self.attempt)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def format_meta(m: Meta) -> str:
    lines = [
        "mode=full",
        f"run_id={m.run_id}",
        f"run_attempt={m.attempt}",
        f"started_at={iso(m.started_at)}",
        f"validated_at={iso(m.validated_at)}",
        "covered_daily=" + ",".join(s.isoformat() for s in m.covered_daily),
        "newest_covered=" + (m.newest_covered.isoformat() if m.newest_covered else ""),
    ]
    if m.ineligible:
        lines.append("ineligible=late-rerun")
    lines += [f"db_sha256={m.db_sha256}", f"validation_sha256={m.validation_sha256}"]
    return "\n".join(lines) + "\n"


def parse_meta(text: str) -> Meta:
    kv: dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip():
            continue
        k, sep, v = line.partition("=")
        if not sep or k in kv:
            raise ValueError(f"metadata line {line!r}")
        kv[k] = v
    try:
        if kv.get("mode") != "full":
            raise ValueError("not a full refresh")
        cov = tuple(day_of(x) for x in kv["covered_daily"].split(",") if x)
        newest = day_of(kv["newest_covered"]) if kv["newest_covered"] else None
        ineligible = kv.get("ineligible", "")
        if ineligible not in ("", "late-rerun"):
            raise ValueError(f"ineligible={ineligible!r}")
        m = Meta(int(kv["run_id"]), int(kv["run_attempt"]), ts(kv["started_at"]), ts(kv["validated_at"]),
                 cov, newest, ineligible == "late-rerun", kv["db_sha256"], kv["validation_sha256"])
    except KeyError as exc:
        raise ValueError(f"metadata without {exc}") from exc
    if m.started_at is None or m.validated_at is None or m.run_id < 1 or m.attempt < 1:
        raise ValueError("metadata identity incomplete")
    if not HEX64.fullmatch(m.db_sha256) or not HEX64.fullmatch(m.validation_sha256):
        raise ValueError("metadata hashes malformed")
    if m.ineligible and (m.covered_daily or m.newest_covered):
        raise ValueError("an ineligible attempt records no coverage")
    return m


def build_meta(db: Path, validation: Path, run_id: int, attempt: int, started_at: datetime, validated_at: datetime,
               created_at: datetime, market: list[str], assets: list[str]) -> Meta:
    """This attempt's metadata. Validated more than 31 days after its run's creation it is
    ineligible (DR-61): no coverage, ineligible=late-rerun."""
    ineligible = validated_at > created_at + ELIGIBLE_AFTER_CREATE
    cov: tuple[date, ...] = ()
    newest = None
    if not ineligible:
        conn = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            cov = tuple(covered_daily(conn, validated_at, market, assets))
            newest = newest_covered(conn, validated_at, market, assets)
        finally:
            conn.close()
    return Meta(run_id, attempt, started_at, validated_at, cov, newest, ineligible, sha256_file(db), sha256_file(validation))


# ── discovery (section 3) ─────────────────────────────────────────────────────


@dataclass(frozen=True)
class UnknownAttempt:
    """A validated attempt with no metadata: its coverage is unknown (DR-55, DR-72)."""
    run_id: int
    attempt: int
    started: datetime        # the refresh job's start (weekly eligibility)
    validated_lo: datetime   # the validation step's start: a lower bound of validated_at
    validated_hi: datetime   # the record step's finish: an upper bound of validated_at

    def eligible(self, kind: str, key: str) -> bool:
        if kind == "daily":
            return self.validated_hi >= close_utc(day_of(key)) + CLOSE_LAG
        return self.started.date() == monday(key)

    def precedes(self, m: Meta | None) -> bool:
        if m is None:
            return True
        return (self.validated_lo, self.run_id, self.attempt) <= m.order()


def _step(job: dict, name: str) -> dict | None:
    hits = [s for s in job.get("steps") or [] if s.get("name") == name]
    return hits[0] if len(hits) == 1 else None


def classify_attempt(api: Api, run_id: int, n: int) -> UnknownAttempt | None:
    """From an attempt's jobs: None when it did not validate (its record step did not
    conclude success), else an UnknownAttempt with bounds on its validation time."""
    jobs = [j for j in api.attempt_jobs(run_id, n) if j.get("name") == REFRESH_JOB]
    if not jobs:
        return None   # cancelled before its job started: nothing validated
    if len(jobs) != 1:
        raise Incomplete(f"run {run_id} attempt {n}: {len(jobs)} '{REFRESH_JOB}' jobs")
    job = jobs[0]
    if int(job.get("run_attempt") or 0) != n or int(job.get("run_id") or 0) != run_id:
        raise Incomplete(f"run {run_id} attempt {n}: the jobs listing names another attempt")
    if job.get("status") != "completed":
        raise Incomplete(f"run {run_id} attempt {n} has not completed")
    rec = _step(job, RECORD_STEP)
    if rec is None or rec.get("conclusion") != "success":
        return None
    val = _step(job, VALIDATE_STEP)
    lo = ts((val or {}).get("started_at"))
    hi = ts(rec.get("completed_at"))
    started = ts(job.get("started_at"))
    if lo is None or hi is None or started is None:
        raise Incomplete(f"run {run_id} attempt {n}: step times missing")
    return UnknownAttempt(run_id, n, started, lo, hi)


@dataclass
class Discovery:
    metas: list[Meta] = field(default_factory=list)
    unknown: list[UnknownAttempt] = field(default_factory=list)


def discover(api: Api, store: Store, own: Meta, f_time: datetime, now: datetime) -> Discovery:
    """Every candidate attempt with validated_at >= F - 6 h (section 3, step 3). Raises
    Incomplete rather than return a partial answer."""
    lower = f_time - JOB_LIMIT
    c_day = (lower - ELIGIBLE_AFTER_CREATE).date()
    runs: dict[int, dict] = {}
    d = c_day
    while d <= now.date():
        for r in api.runs_on_day(d):
            runs[int(r["id"])] = r
        d += timedelta(days=1)
    runs.setdefault(own.run_id, {"id": own.run_id, "run_attempt": own.attempt, "status": "in_progress",
                                 "updated_at": iso(now), "head_sha": ""})
    m_max = max(int(r.get("run_attempt") or 1) for r in runs.values())

    metas: dict[tuple[int, int], Meta] = {(own.run_id, own.attempt): own}
    for n in range(1, m_max + 1):
        for a in api.artifacts_named(f"validated-meta-{n}"):
            rid = int((a.get("workflow_run") or {}).get("id") or 0)
            if rid not in runs or (rid, n) in metas:
                continue   # a run created before C: ineligible by definition
            created = ts(a.get("created_at"))
            if created is None or created < lower:
                continue   # uploaded before F - 6 h, so validated before it
            if a.get("expired"):
                raise Incomplete(f"validated-meta-{n} of run {rid} has expired")
            with api.artifact_zip(int(a["id"])) as z:
                m = parse_meta(z.read("validated-meta.txt").decode("utf-8"))
            if (m.run_id, m.attempt) != (rid, n):
                raise Incomplete(f"validated-meta-{n} of run {rid} names run {m.run_id} attempt {m.attempt}")
            metas[(rid, n)] = m

    with_meta = {rid for rid, _ in metas}
    unknown: list[UnknownAttempt] = []
    for rid, r in sorted(runs.items()):
        upd = ts(r.get("updated_at"))
        if upd is None or upd < lower:
            continue   # every attempt of it finished before F - 6 h
        legacy = None
        if rid not in with_meta and rid != own.run_id:
            legacy = not store.has_code(str(r.get("head_sha") or ""))
        for n in range(1, int(r.get("run_attempt") or 1) + 1):
            if (rid, n) in metas or (rid, n) == (own.run_id, own.attempt):
                continue
            if n == int(r.get("run_attempt") or 1):
                status, conclusion = r.get("status"), r.get("conclusion")
            else:
                a = api.attempt(rid, n)
                status, conclusion = a.get("status"), a.get("conclusion")
            if status != "completed":
                if status == "in_progress":
                    raise Incomplete(f"run {rid} attempt {n} is in progress")
                continue   # queued, waiting, pending or requested: it has validated nothing yet
            if conclusion == "success" and not legacy:
                continue   # a successful CS-2 attempt that validated uploaded its metadata
            u = classify_attempt(api, rid, n)
            if u is not None:
                unknown.append(u)
    return Discovery(sorted(metas.values(), key=Meta.order), unknown)


def _source(m: Meta, pin: date) -> dict:
    return {"state": "source", "origin_run_id": m.run_id, "origin_attempt": m.attempt,
            "validated_at": iso(m.validated_at), "db_sha256": m.db_sha256,
            "validation_sha256": m.validation_sha256, "pin_session": pin.isoformat(), "reason": None}


def _blocked(reason: str, m: Meta | None = None) -> dict:
    out = {"state": "blocked", "reason": reason}
    if m is not None:
        out.update(origin_run_id=m.run_id, origin_attempt=m.attempt, validated_at=iso(m.validated_at))
    return out


def bytes_state(api: Api, m: Meta, own: Meta) -> str:
    """'usable', 'expired' or 'not-retained' for the run's validated-db and attempt m (DR-53)."""
    if (m.run_id, m.attempt) == (own.run_id, own.attempt):
        return "usable"   # this step runs after this attempt's own upload succeeded
    arts = [a for a in api.run_artifacts(m.run_id, "validated-db") if a.get("name") == "validated-db"]
    if not arts:
        return "not-retained"
    if len(arts) != 1:
        raise Incomplete(f"run {m.run_id} has {len(arts)} validated-db artifacts")
    if arts[0].get("expired"):
        return "expired"
    with api.artifact_zip(int(arts[0]["id"])) as z:
        held = parse_meta(z.read("refresh-meta.txt").decode("utf-8"))
        h = hashlib.sha256()
        with z.open("macro_radar.db") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
    if (held.run_id, held.attempt) != (m.run_id, m.attempt) or h.hexdigest() != m.db_sha256:
        return "not-retained"
    return "usable"


def decide_key(kind: str, key: str, disc: Discovery, api: Api, own: Meta) -> dict | None:
    """Section 3, step 4: the registry record for one unresolved key, or None (stays unresolved)."""
    if kind == "daily":
        s = day_of(key)
        covering = [m for m in disc.metas if not m.ineligible and s in m.covered_daily]
    else:
        covering = [m for m in disc.metas if not m.ineligible and m.started_at.date() == monday(key)]
    first = min(covering, key=Meta.order) if covering else None
    for u in disc.unknown:
        if u.eligible(kind, key) and u.precedes(first):
            return _blocked(f"an earlier validated attempt's coverage is lost (run {u.run_id} attempt {u.attempt})")
    if first is None:
        return None
    state = bytes_state(api, first, own)
    if state == "expired":
        return _blocked("first source's bytes expired", first)
    if state == "not-retained":
        return _blocked("first source's bytes were not retained (re-run attempt)", first)
    pin = day_of(key) if kind == "daily" else first.newest_covered
    if pin is None:
        return _blocked("no covered session in the last 10", first)
    return _source(first, pin)


def unresolved(registry: dict, own: Meta) -> dict[str, list[str]]:
    """Window keys (from QUEUE_START) with no registry entry (section 3, step 2)."""
    daily = [s.isoformat() for s in expected_daily(own.validated_at, daily_window_start(own.validated_at))]
    wk_start = max(QUEUE_START, (own.validated_at - WEEKLY_WINDOW).date())
    weekly = expected_weekly(own.started_at.date(), wk_start)
    return {"daily": [k for k in daily if k not in registry["daily"]],
            "weekly": [k for k in weekly if k not in registry["weekly"]]}


def run_sources(api: Api, store: Store, own: Meta, now: datetime) -> dict:
    """The "Record memo sources" step. Returns the decisions written ({} when none)."""
    store.fetch()
    text, blob = store.read(SOURCES)
    registry = parse_registry(text)
    todo = unresolved(registry, own)
    if not todo["daily"] and not todo["weekly"]:
        print("Every window key already has a source record.")
        return {}
    f_time = min(key_close(kind, k) for kind in KINDS for k in todo[kind])
    disc = discover(api, store, own, f_time, now)
    print(f"discovery: {len(disc.metas)} attempts with metadata, {len(disc.unknown)} validated without, "
          f"{api.requests} GitHub requests")
    decided: dict[str, dict] = {"daily": {}, "weekly": {}}
    for kind in KINDS:
        for k in todo[kind]:
            rec = decide_key(kind, k, disc, api, own)
            if rec is not None:
                decided[kind][k] = rec
    if not decided["daily"] and not decided["weekly"]:
        print("No unresolved key is covered yet; every later run rechecks them.")
        return {}
    for kind in KINDS:
        registry[kind].update(decided[kind])
    store.publish("Memo sources [skip ci]", {SOURCES: dumps(registry)}, {SOURCES: blob})
    for kind in KINDS:
        for k, rec in sorted(decided[kind].items()):
            what = (f"source run {rec['origin_run_id']} attempt {rec['origin_attempt']}, pin {rec['pin_session']}"
                    if rec["state"] == "source" else f"blocked: {rec['reason']}")
            print(f"{kind} {k}: {what}")
    return decided


# ── the memo workflow: plan and reconcile (sections 4 and 5) ─────────────────


@dataclass
class Ctx:
    kind: str
    run_id: int
    run_attempt: int
    api: Api
    store: Store
    clock: Clock
    env: dict


def reconcile(ctx: Ctx, key: str, e: dict) -> tuple[str, str]:
    """(state, note) for a leftover attempt/sending entry, from its outcome artifact or the
    jobs API (DR-13, DR-47). Unknown and still-running raise; nothing is then sent."""
    rid, n = e.get("memo_run_id"), e.get("run_attempt")
    if not isinstance(rid, int) or not isinstance(n, int):
        raise Unknown(f"{key}: the {e['state']} entry names no execution")
    if (rid, n) == (ctx.run_id, ctx.run_attempt):
        raise Unknown(f"{key}: the {e['state']} entry names this very execution before it wrote anything")
    name = outcome_artifact(ctx.kind, key, rid, n)
    arts = [a for a in ctx.api.artifacts_named(name) if a.get("name") == name and not a.get("expired")]
    if len(arts) > 1:
        raise Unknown(f"{key}: {len(arts)} outcome artifacts named {name}")
    if arts:
        with ctx.api.artifact_zip(int(arts[0]["id"])) as z:
            out = json.loads(z.read("outcome.json").decode("utf-8"))
        if out.get("state") in ("sent", "not_sent", "ambiguous"):
            return out["state"], f"reconciled from {name}"
        raise Unknown(f"{key}: {name} holds no outcome")
    try:
        jobs = [j for j in ctx.api.attempt_jobs(rid, n) if j.get("name") == MEMO_JOB]
    except (GhError, Incomplete) as exc:
        raise Unknown(f"{key}: run {rid} attempt {n}: jobs unreadable ({exc})") from exc
    if len(jobs) != 1:
        raise Unknown(f"{key}: run {rid} attempt {n} has {len(jobs)} '{MEMO_JOB}' jobs")
    job = jobs[0]
    if job.get("run_id") != rid or job.get("run_attempt") != n or not isinstance(job.get("steps"), list):
        raise Unknown(f"{key}: run {rid} attempt {n}: the job record does not identify the execution")
    plan = _step(job, PLAN_STEP)
    if plan is None or plan.get("conclusion") != "success":
        raise Unknown(f"{key}: run {rid} attempt {n}: no successful plan step")
    if job.get("status") != "completed":
        raise Unknown(f"{key}: prior execution run {rid} attempt {n} is still running")
    send = _step(job, SEND_STEP)
    if send is None:
        raise Unknown(f"{key}: run {rid} attempt {n}: the send step is absent")
    if send.get("status") == "completed" and send.get("conclusion") == "skipped":
        return "not_sent", f"run {rid} attempt {n}: send step skipped"
    if send.get("status") == "completed" and send.get("conclusion") == "success":
        return "sent", f"run {rid} attempt {n}: send step succeeded"
    return "ambiguous", f"run {rid} attempt {n}: send step {send.get('status')}/{send.get('conclusion')}"


def source_expired(ctx: Ctx, src: dict, now: datetime) -> bool:
    """The origin run's validated-db is gone, or past its 3-day retention (ST)."""
    if ts(src["validated_at"]) + SOURCE_RETENTION <= now:
        return True
    arts = [a for a in ctx.api.run_artifacts(src["origin_run_id"], "validated-db") if a.get("name") == "validated-db"]
    return not arts or any(a.get("expired") for a in arts)


@dataclass
class Plan:
    go: bool = False
    key: str = ""
    source: dict | None = None
    delayed: bool = False
    more: bool = False
    mode: str = "auto"
    alarm: bool = False      # a key became ambiguous, failed or blocked: the job fails at its end
    log: list[str] = field(default_factory=list)


def _touch(e: dict, ctx: Ctx, now: datetime, state: str, note: str) -> dict:
    e = {**new_entry(), **e}
    e.update(state=state, note=note, updated_at=iso(now))
    return e


def plan_auto(ctx: Ctx, ledger: dict, registry: dict, now: datetime) -> tuple[Plan, bool]:
    """The ordered walk (section 4, step 1). Returns (plan, ledger changed)."""
    kind, p, changed = ctx.kind, Plan(), False
    keys = set(expected_keys(kind, now)) | set(ledger["keys"]) | set(registry[kind])
    work = sorted((k for k in keys if key_order(kind, k) >= QUEUE_START), key=lambda k: key_order(kind, k))
    for i, k in enumerate(work):
        e = ledger["keys"].get(k)
        if e is not None and e["state"] in TERMINAL:
            continue
        if e is not None and e["state"] in ("attempt", "sending"):
            state, note = reconcile(ctx, k, e)
            e = _touch(e, ctx, now, state, note)
            ledger["keys"][k] = e
            changed = True
            p.log.append(f"{k}: reconciled {state} ({note})")
            p.alarm = p.alarm or state == "ambiguous"
            if state in TERMINAL:
                continue
        src = registry[kind].get(k)
        if src is None:
            newer_source = any(registry[kind].get(x, {}).get("state") == "source" for x in work[i + 1:])
            if now >= hold_deadline(kind, k) and newer_source:
                ledger["keys"][k] = _touch(e or {}, ctx, now, "skipped", "not covered by the hold deadline")
                changed = True
                p.log.append(f"{k}: skipped (not covered by the hold deadline)")
                continue
            p.log.append(f"{k}: holding the queue, awaiting a validated source")
            return p, changed
        if src["state"] == "blocked":
            ledger["keys"][k] = _touch(e or {}, ctx, now, "blocked", src.get("reason") or "")
            changed = True
            p.log.append(f"{k}: blocked ({src.get('reason')})")
            p.alarm = True
            continue
        tries = int((e or {}).get("tries") or 0)
        if tries >= MAX_TRIES:
            ledger["keys"][k] = _touch(e or {}, ctx, now, "failed", f"{tries} tries without sent")
            changed = True
            p.log.append(f"{k}: failed after {tries} tries")
            p.alarm = True
            continue
        if source_expired(ctx, src, now):
            ledger["keys"][k] = _touch(e or {}, ctx, now, "skipped", "source expired")
            changed = True
            p.log.append(f"{k}: skipped (source expired)")
            continue
        e = _touch(e or {}, ctx, now, "attempt", "")
        e.update(tries=tries + 1, memo_run_id=ctx.run_id, run_attempt=ctx.run_attempt, source=dict(src),
                 output_artifact=outcome_artifact(kind, k, ctx.run_id, ctx.run_attempt))
        ledger["keys"][k] = e
        p.go, p.key, p.source, changed = True, k, dict(src), True
        p.delayed = is_delayed(kind, k, registry, now)
        p.more = any((ledger["keys"].get(x) or {}).get("state") not in TERMINAL and x in registry[kind]
                     for x in work[i + 1:])
        p.log.append(f"{k}: claimed, try {tries + 1}" + (" (delayed)" if p.delayed else ""))
        return p, changed
    return p, changed


def resend_allowed(kind: str, key: str, ledger: dict, registry: dict) -> dict:
    """Section 7: only a terminal entry with a registry source may be resent. Returns the source."""
    if not valid_key(kind, key):
        raise QueueError(f"resend_key {key!r} is not a {kind} key")
    e = ledger["keys"].get(key)
    if e is None or e["state"] not in TERMINAL:
        raise QueueError(f"{key} is {e['state'] if e else 'not in the ledger'}: only a terminal entry may be resent "
                         "(automation still owns it)")
    src = registry[kind].get(key)
    if not src or src.get("state") != "source":
        raise QueueError(f"{key} has no registry source to resend from")
    return dict(src)


def run_plan(ctx: Ctx, wake: str, resend_key: str) -> Plan:
    if wake and resend_key:
        raise QueueError("set either wake or resend_key, not both")
    now = ctx.clock.now()
    ctx.store.fetch()
    ltext, lblob = ctx.store.read(LEDGER[ctx.kind])
    ledger = parse_ledger(ctx.kind, ltext)
    registry = parse_registry(ctx.store.read(SOURCES)[0])
    if resend_key:
        src = resend_allowed(ctx.kind, resend_key, ledger, registry)
        if source_expired(ctx, src, now):
            raise QueueError(f"{resend_key}: the origin run's validated-db has expired; it cannot be resent")
        return Plan(go=True, key=resend_key, source=src, mode="resend",
                    delayed=is_delayed(ctx.kind, resend_key, registry, now), log=[f"{resend_key}: owner resend"])
    p, changed = plan_auto(ctx, ledger, registry, now)
    if changed:
        msg = f"Memo ledger ({ctx.kind}{': ' + p.key if p.go else ''}) [skip ci]"
        ctx.store.publish(msg, {LEDGER[ctx.kind]: dumps(ledger)}, {LEDGER[ctx.kind]: lblob})
    return p


# ── reserve, publish, finalize, record (sections 4-7) ─────────────────────────


def _read_ledger(ctx: Ctx) -> tuple[dict, str]:
    ctx.store.fetch()
    text, blob = ctx.store.read(LEDGER[ctx.kind])
    return parse_ledger(ctx.kind, text), blob


def _own_entry(ctx: Ctx, ledger: dict, key: str, mode: str) -> dict:
    e = ledger["keys"].get(key)
    if e is None:
        raise QueueError(f"{key} is not in the ledger")
    if mode == "resend":
        if e["state"] not in TERMINAL:
            raise QueueError(f"{key} is no longer terminal ({e['state']}); the resend stops")
        return e
    if (e.get("memo_run_id"), e.get("run_attempt")) != (ctx.run_id, ctx.run_attempt):
        raise QueueError(f"{key} is held by run {e.get('memo_run_id')} attempt {e.get('run_attempt')}, not this one")
    return e


def _delayed_now(ctx: Ctx, key: str) -> bool:
    registry = parse_registry(ctx.store.read(SOURCES)[0])
    return is_delayed(ctx.kind, key, registry, ctx.clock.now())


def run_reserve(ctx: Ctx, key: str, mode: str) -> str:
    """Checkpoint 1 and the paid-generation reservation (DR-57, DR-65): 'paid', 'unavailable'
    (already reserved once) or 'omitted' (delayed). A failed write raises: no provider call."""
    ledger, blob = _read_ledger(ctx)
    e = _own_entry(ctx, ledger, key, mode)
    if _delayed_now(ctx, key):
        return "omitted"
    if e.get("paid_generation"):
        return "unavailable"
    e["paid_generation"] = {"run": ctx.run_id, "run_attempt": ctx.run_attempt, "at": iso(ctx.clock.now())}
    ctx.store.publish(f"Memo ledger ({ctx.kind}: {key} paid generation) [skip ci]",
                      {LEDGER[ctx.kind]: dumps(ledger)}, {LEDGER[ctx.kind]: blob})
    return "paid"


def load_bundle(kind: str, key: str) -> dict:
    meta = json.loads((BUNDLE / "meta.json").read_text(encoding="utf-8"))
    if meta.get("kind") != kind or meta.get("key") != key:
        raise QueueError(f"the generated bundle is for {meta.get('kind')} {meta.get('key')}, not {kind} {key}")
    return meta


def materialize(kind: str, variant: str, sent: date) -> tuple[str, str, str]:
    """finalize(content, delayed): (page html, email html, subject) of one rendered variant.
    The delayed variant's line, its [Delayed] subject prefix and its omitted commentary were
    rendered together by the generator; only the sent date is filled in here."""
    if variant not in ("normal", "delayed"):
        raise QueueError(f"unknown variant {variant!r}")
    page = (BUNDLE / f"page-{variant}.html").read_text(encoding="utf-8")
    email = (BUNDLE / f"email-{variant}.html").read_text(encoding="utf-8")
    subject = (BUNDLE / f"subject-{variant}.txt").read_text(encoding="utf-8").strip()
    stamp = sent.isoformat()
    page, email, subject = (x.replace(SENT_DATE_TOKEN, stamp) for x in (page, email, subject))
    header = (
        '<div style="font-family: Arial, sans-serif; font-size: 16px; padding: 15px; background-color: #f0f4f8; '
        'border-radius: 8px; margin-bottom: 20px;">\n'
        f'  📊 <a href="{PAGE_URL[kind]}" style="color: #1f77b4; text-decoration: none; font-weight: bold;">'
        + ("View this memo in your browser" if kind == "daily" else "View full memo with charts in your browser")
        + "</a>\n  &nbsp;|&nbsp;\n"
        '  📈 <a href="https://macro-economic-radar.vercel.app/" style="color: #1f77b4; text-decoration: none; '
        'font-weight: bold;">Live Dashboard</a>\n</div>\n<hr style="border: 1px solid #ddd; margin-bottom: 20px;">\n'
    )
    return page, header + email, subject


def _variant_file() -> Path:
    return FINAL / "variant.txt"


def current_variant() -> str | None:
    p = _variant_file()
    return p.read_text().strip() if p.exists() else None


def choose_variant(delayed: bool) -> str:
    """Once a try has rendered the delayed version it never reverts (DR-65)."""
    v = "delayed" if delayed or current_variant() == "delayed" else "normal"
    FINAL.mkdir(parents=True, exist_ok=True)
    _variant_file().write_text(v + "\n")
    return v


def run_publish(ctx: Ctx, key: str, mode: str) -> dict:
    """Checkpoint 2, then the page and `sending` (or the resend override) in one CAS commit.
    The page goes in when key >= published (DR-12, DR-73); published only rises."""
    load_bundle(ctx.kind, key)
    ledger, blob = _read_ledger(ctx)
    e = _own_entry(ctx, ledger, key, mode)
    variant = choose_variant(_delayed_now(ctx, key))
    now = ctx.clock.now()
    page, _, _ = materialize(ctx.kind, variant, now.date())
    files: dict[str, str] = {}
    pub = ledger["published"]
    if pub is None or key_order(ctx.kind, key) >= key_order(ctx.kind, pub):
        files[PAGE[ctx.kind]] = page
        if pub is None or key_order(ctx.kind, key) > key_order(ctx.kind, pub):
            ledger["published"] = key
    if mode == "resend":
        e.setdefault("overrides", []).append({"by": "owner", "run": ctx.run_id, "run_attempt": ctx.run_attempt,
                                              "state": "sending", "at": iso(now), "variant": variant})
    else:
        e.update(state="sending", updated_at=iso(now))
    files[LEDGER[ctx.kind]] = dumps(ledger)
    ctx.store.publish(f"{ctx.kind.title()} memo {key} [skip ci]", files, {LEDGER[ctx.kind]: blob})
    return {"variant": variant, "page": PAGE[ctx.kind] in files}


def run_finalize(ctx: Ctx, key: str) -> dict:
    """Checkpoint 3, immediately before SMTP: the delayed version if a boundary has passed
    since checkpoint 2. Writes the message the send step sends."""
    load_bundle(ctx.kind, key)
    ctx.store.fetch()
    before = current_variant()
    variant = choose_variant(_delayed_now(ctx, key))
    page, email, subject = materialize(ctx.kind, variant, ctx.clock.now().date())
    FINAL.mkdir(parents=True, exist_ok=True)
    (FINAL / "page.html").write_text(page, encoding="utf-8")
    (FINAL / f"{ctx.kind}_memo.html").write_text(page, encoding="utf-8")   # the attachment, under its usual name
    (FINAL / "email.html").write_text(email, encoding="utf-8")
    (FINAL / "subject.txt").write_text(subject + "\n", encoding="utf-8")
    switched = before == "normal" and variant == "delayed"
    (FINAL / "republish").write_text("true\n" if switched else "false\n")
    return {"variant": variant, "republish": switched}


def write_outcome(kind: str, key: str, run_id: int, attempt: int, send_outcome: str, now: datetime) -> dict:
    """The outcome file the record step uploads: send_memo.py's outcome.json when it wrote one;
    otherwise ambiguous (a send step that failed without one may have reached SMTP)."""
    src = FINAL / "outcome.json"
    out = json.loads(src.read_text(encoding="utf-8")) if src.exists() else {}
    if out.get("state") not in ("sent", "not_sent", "ambiguous"):
        out = {"state": "ambiguous", "detail": f"no outcome written; send step {send_outcome}"}
    out.update(kind=kind, key=key, run=run_id, run_attempt=attempt, recorded_at=iso(now),
               variant=current_variant())
    OUTCOME_DIR.mkdir(parents=True, exist_ok=True)
    (OUTCOME_DIR / "outcome.json").write_text(json.dumps(out, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return out


def run_record(ctx: Ctx, key: str, mode: str) -> dict:
    """Section 4, step 6: the outcome's CAS ledger write (and the delayed page when checkpoint 3
    switched to it and key == published)."""
    out = json.loads((OUTCOME_DIR / "outcome.json").read_text(encoding="utf-8"))
    state = out["state"]
    ledger, blob = _read_ledger(ctx)
    e = _own_entry(ctx, ledger, key, mode) if mode == "resend" else ledger["keys"].get(key)
    if e is None:
        raise QueueError(f"{key} is not in the ledger")
    now = ctx.clock.now()
    if mode == "resend":
        mine = [o for o in e.get("overrides", []) if (o.get("run"), o.get("run_attempt")) == (ctx.run_id, ctx.run_attempt)]
        if not mine:
            raise QueueError(f"{key}: this resend's override is not in the ledger")
        mine[-1].update(state=state, at=iso(now), detail=out.get("detail", ""))
    else:
        if (e.get("memo_run_id"), e.get("run_attempt")) != (ctx.run_id, ctx.run_attempt) or e["state"] != "sending":
            raise QueueError(f"{key} is no longer this run's sending entry; the outcome artifact records it")
        if state == "not_sent" and int(e.get("tries") or 0) >= MAX_TRIES:
            state = "failed"
        e.update(state=state, updated_at=iso(now), note=out.get("detail", "") or "")
    files = {LEDGER[ctx.kind]: dumps(ledger)}
    if (FINAL / "republish").exists() and (FINAL / "republish").read_text().strip() == "true" \
            and ledger["published"] == key and (FINAL / "page.html").exists():
        files[PAGE[ctx.kind]] = (FINAL / "page.html").read_text(encoding="utf-8")
    ctx.store.publish(f"{ctx.kind.title()} memo {key}: {state} [skip ci]", files, {LEDGER[ctx.kind]: blob})
    return {"state": state, "terminal": state in TERMINAL}


# ── the refresh side: metadata and wake-ups ───────────────────────────────────


def run_meta(api: Api, env: dict, db: Path, validation: Path, started_at: str, validated_at: str,
             out_refresh: Path, out_meta: Path) -> Meta:
    run_id, attempt = int(env["GITHUB_RUN_ID"]), int(env["GITHUB_RUN_ATTEMPT"])
    created = ts(api.run(run_id).get("created_at"))
    if created is None:
        raise QueueError(f"run {run_id} has no created_at")
    m = build_meta(db, validation, run_id, attempt, ts(started_at), ts(validated_at), created,
                   market_symbols(), asset_symbols())
    text = format_meta(m)
    for p in (out_refresh, out_meta):
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)
    if not calendar_known(m.validated_at.date()):
        print(f"::warning::the NYSE calendar does not cover {m.validated_at.year}: no daily key is covered")
    if m.ineligible:
        print(f"::warning::validated more than {ELIGIBLE_AFTER_CREATE.days} days after run {run_id} was created: "
              "ineligible as a memo source (ineligible=late-rerun)")
    print(text, end="")
    return m


# ── CLI ───────────────────────────────────────────────────────────────────────


def _out(env: dict, **pairs) -> None:
    path = env.get("GITHUB_OUTPUT")
    lines = [f"{k}={'true' if v is True else 'false' if v is False else v}" for k, v in pairs.items()]
    if path:
        with open(path, "a") as f:
            f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


def _summary(env: dict, text: str) -> None:
    path = env.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a") as f:
            f.write(text.rstrip() + "\n")
    print(text)


def _ctx(env: dict, kind: str, budget_s: float, clock: Clock, runner: Runner) -> Ctx:
    return Ctx(kind, int(env["GITHUB_RUN_ID"]), int(env.get("GITHUB_RUN_ATTEMPT") or 1),
               Api(env, Budget(clock, budget_s), runner), Store(ROOT, runner), clock, env)


def main(argv: list[str] | None = None, env: dict | None = None, clock: Clock | None = None,
         runner: Runner = subprocess.run) -> int:
    from scripts import memo_content

    env = dict(os.environ if env is None else env)
    clock = clock or Clock()
    ap = argparse.ArgumentParser(prog="memo_queue")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("meta")
    p.add_argument("--db", required=True, type=Path)
    p.add_argument("--validation", required=True, type=Path)
    p.add_argument("--started-at", required=True)
    p.add_argument("--validated-at", required=True)
    p.add_argument("--out", required=True, type=Path)
    p.add_argument("--out-meta", required=True, type=Path)
    p = sub.add_parser("sources")
    p.add_argument("--meta", required=True, type=Path)
    for name in ("plan", "reserve", "publish", "finalize", "outcome", "record"):
        p = sub.add_parser(name)
        p.add_argument("--kind", required=True, choices=KINDS)
        if name == "plan":
            p.add_argument("--wake", default="")
            p.add_argument("--resend-key", default="")
        else:
            p.add_argument("--key", required=True)
            p.add_argument("--mode", default="auto", choices=("auto", "resend"))
        if name == "outcome":
            p.add_argument("--send-outcome", default="")
    p = sub.add_parser("verify")
    p.add_argument("--db", required=True, type=Path)
    p.add_argument("--validation", required=True, type=Path)
    p.add_argument("--db-sha256", required=True)
    p.add_argument("--validation-sha256", required=True)
    for name in ("pin", "market-metrics", "market-alerts"):
        p = sub.add_parser(name)
        p.add_argument("--db", required=True, type=Path)
        p.add_argument("--session", required=True)
    a = ap.parse_args(argv)

    try:
        if a.cmd == "meta":
            api = Api(env, Budget(clock, 5 * 60), runner)
            run_meta(api, env, a.db, a.validation, a.started_at, a.validated_at, a.out, a.out_meta)
            return 0
        if a.cmd == "sources":
            own = parse_meta(a.meta.read_text())
            # discovery's API budget leaves room for the fetch and the publish inside the 20-minute step
            api = Api(env, Budget(clock, 270), runner)
            decided = run_sources(api, Store(ROOT, runner), own, clock.now())
            for kind in KINDS:
                for k, rec in sorted(decided.get(kind, {}).items()):
                    _summary(env, f"- memo source {kind} {k}: {rec['state']}"
                                  + (f" (run {rec['origin_run_id']} attempt {rec['origin_attempt']})" if rec["state"] == "source"
                                     else f" ({rec['reason']})"))
            return 0
        if a.cmd == "verify":
            got = (sha256_file(a.db), sha256_file(a.validation))
            if got != (a.db_sha256, a.validation_sha256):
                print(f"::error::the downloaded snapshot does not match its registry hashes: {got}")
                return 1
            print("snapshot hashes match the registry")
            return 0
        if a.cmd in ("pin", "market-metrics", "market-alerts"):
            p_day = day_of(a.session)
            conn = sqlite3.connect(a.db)
            try:
                if a.cmd == "pin":
                    print(memo_content.pin(conn, p_day, market_symbols(), asset_symbols()))
                elif a.cmd == "market-metrics":
                    print(memo_content.store_market_metrics(conn, market_symbols(), p_day))
                else:
                    note = memo_content.fix_market_alerts(conn, p_day)
                    ALERT_NOTE.parent.mkdir(parents=True, exist_ok=True)
                    ALERT_NOTE.write_text(note + "\n" if note else "", encoding="utf-8")
                    if note:
                        _summary(env, note)
            finally:
                conn.close()
            return 0

        ctx = _ctx(env, a.kind, 240, clock, runner)
        if a.cmd == "plan":
            p = run_plan(ctx, a.wake.strip(), a.resend_key.strip())
            for line in p.log:
                _summary(env, f"- {line}")
            src = p.source or {}
            _out(env, go=p.go, key=p.key, mode=p.mode, delayed=p.delayed, more=p.more, alarm=p.alarm,
                 origin_run_id=src.get("origin_run_id", ""), origin_attempt=src.get("origin_attempt", ""),
                 validated_at=src.get("validated_at", ""), pin_session=src.get("pin_session", ""),
                 db_sha256=src.get("db_sha256", ""), validation_sha256=src.get("validation_sha256", ""))
            if p.go:
                _summary(env, f"{a.kind} memo {p.key} ({p.mode}): source run {src['origin_run_id']} attempt "
                              f"{src['origin_attempt']}, validated {src['validated_at']}, pinned to {src['pin_session']}, "
                              f"db {src['db_sha256'][:12]}, memo run {ctx.run_id} attempt {ctx.run_attempt}")
            return 0
        if a.cmd == "reserve":
            _out(env, commentary=run_reserve(ctx, a.key, a.mode))
            return 0
        if a.cmd == "publish":
            r = run_publish(ctx, a.key, a.mode)
            _summary(env, f"published {a.kind} {a.key} as {r['variant']}" + ("" if r["page"] else " (page unchanged: an older key)"))
            return 0
        if a.cmd == "finalize":
            r = run_finalize(ctx, a.key)
            _out(env, variant=r["variant"], republish=r["republish"])
            return 0
        if a.cmd == "outcome":
            out = write_outcome(a.kind, a.key, ctx.run_id, ctx.run_attempt, a.send_outcome, clock.now())
            _out(env, state=out["state"], artifact=outcome_artifact(a.kind, a.key, ctx.run_id, ctx.run_attempt))
            return 0
        if a.cmd == "record":
            r = run_record(ctx, a.key, a.mode)
            _out(env, state=r["state"], terminal=r["terminal"])
            _summary(env, f"{a.kind} memo {a.key}: {r['state']}")
            return 0 if r["state"] == "sent" else 1
    except (QueueError, GhError, OutOfTime) as exc:
        print(f"::error::{exc}")
        _summary(env, f"**Stopped:** {exc}")
        return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
