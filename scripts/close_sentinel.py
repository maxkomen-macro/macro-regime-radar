"""scripts/close_sentinel.py — the close sentinel (CS-1, Max 2026-11-05 item 6).

GitHub starts this repo's scheduled runs 5-9.5 hours late, so the after-close
full refresh (cron 23 0 * * 2-6) routinely finishes after the 06:00 UTC
freshness deadline (api/freshness.close_grace_until). A workflow_dispatch
starts within seconds. close-sentinel.yml runs this script from a few
low-frequency weekday crons: whichever one GitHub delivers first waits until
17:30 New York time on the session day, checks whether the published database
already holds that session's closes, and if it does not, dispatches the
existing full refresh once (refresh-data.yml, mode=full). It is a measured
improvement, not a scheduler guarantee: the backup crons, the data-write
concurrency group, validation before publish and the 06:00 deadline are all
unchanged.

Two subcommands, one per workflow step:

    plan                    wait (bounded) until a dispatch is due and allowed;
                            write session=YYYY-MM-DD to $GITHUB_OUTPUT, or nothing
    dispatch --session S    count the reservations for S (the workflow uploads one
                            before this step), recheck, dispatch, confirm; release
                            this run's reservation on a definitive skip

Rules (design .loop/design-CS1.md, reviewed by Codex in three passes):

- dispatch_at(S) is 17:30 New York time on trading day S; nothing is ever
  dispatched for a session before then, for a non-trading day, or for a year
  the NYSE tables in src/market_data/session.py do not cover (exit 1, so the
  calendar gets extended rather than guessed).
- S is "published" only when every configured daily market symbol
  (config/assets.yml `daily`, the list fetch_market stores) and every
  configured daily asset series (asset_history.DAILY_SYMBOLS) has a stored
  close dated S or later in the published database. No symbol is ever left out
  automatically; one that lags keeps S unpublished, which costs at most the
  capped dispatches below.
- At most MAX_DISPATCHES sentinel dispatches per session, counted from the
  close-sentinel-dispatch-<S> artifacts each run uploads before it dispatches.
  Watchers are serialized by the close-sentinel concurrency group; a run that
  decides not to dispatch after reserving (S got published, or a refresh is
  running) deletes its own reservation; an uncertain outcome keeps it.
- No dispatch while any refresh-data run is queued, running or waiting, and
  none within RETRY_GAP of a finished sentinel dispatch for the same session.
- Every call and sleep is bounded by the step's remaining budget, so each
  step ends inside its own timeout.

The database and release reads follow the private-storage setting (#49):
DATA_RELEASE_REPO names the repo whose data-latest release holds the database;
when it is another repo those reads use DATA_RELEASE_TOKEN and stop before any
call without it. Run and artifact listing and the dispatch always use the
workflow's own token on this repo. The script writes nothing but its
GITHUB_OUTPUT line, the reservation file the workflow uploads, the deletion of
its own reservation and the one dispatch: no database, release asset or git.
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import time as _time
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.market_data import session  # noqa: E402  (stdlib only)

NY = session.NY
DISPATCH_T = time(17, 30)
MAX_DISPATCHES = 2
RETRY_GAP = timedelta(minutes=60)
SEARCH_DAYS = 7          # catch-up reaches back this many days
AHEAD_DAYS = 10          # the next session is searched this many days ahead
PLAN_BUDGET_S = 305 * 60
WAIT_WINDOW = timedelta(minutes=300)
DISPATCH_BUDGET_S = 12 * 60
CONFIRM_S = 10 * 60
CALL_TIMEOUT_S = 120
MARGIN_S = 10
MIN_LEFT_S = 30
TRY_PAUSES_S = (10, 30)
CHUNK_S = 30 * 60
OWN_WAIT_S = 120         # how long the dispatch step waits for its own reservation to be listed
OWN_POLL_S = 15
ACTIVE_WAIT_S = 5 * 60
PER_PAGE = 100
MAX_PAGES = 50
ACTIVE_STATUSES = ("queued", "in_progress", "waiting", "requested", "pending")
WORKFLOW = "refresh-data.yml"
DB_ASSET = "macro_radar.db"
TITLE = "Refresh Data (close {})"
RESERVATION = "close-sentinel-dispatch-{}"
TOKEN_ERROR = "DATA_RELEASE_REPO names another repo but the DATA_RELEASE_TOKEN secret is not set"


# ── calendar ─────────────────────────────────────────────────────────────────


class CalendarError(RuntimeError):
    """A date the NYSE tables do not cover."""


def calendar_known(d: date) -> bool:
    return d.year in session.HOLIDAYS and d.year in session.EARLY_CLOSES


def _check(d: date) -> None:
    if not calendar_known(d):
        raise CalendarError(f"NYSE calendar has no {d.year}; add it to src/market_data/session.py")


def is_session(d: date) -> bool:
    _check(d)
    return session.is_trading_day(d)


def dispatch_at(s: date) -> datetime:
    """17:30 New York time on trading day s, in UTC."""
    if not is_session(s):
        raise ValueError(f"{s} is not a trading day")
    return datetime.combine(s, DISPATCH_T, tzinfo=NY).astimezone(timezone.utc)


def due_session(now: datetime) -> date | None:
    """The latest trading day whose dispatch time has passed, searched back SEARCH_DAYS."""
    today = now.astimezone(NY).date()
    for back in range(SEARCH_DAYS + 1):
        d = today - timedelta(days=back)
        if is_session(d) and dispatch_at(d) <= now:
            return d
    return None


def next_session(now: datetime) -> date:
    """The earliest trading day whose dispatch time is still ahead."""
    today = now.astimezone(NY).date()
    for ahead in range(AHEAD_DAYS + 1):
        d = today + timedelta(days=ahead)
        if is_session(d) and dispatch_at(d) > now:
            return d
    raise CalendarError(f"no trading day within {AHEAD_DAYS} days of {today}")


def iso_date(value: str) -> date:
    d = date.fromisoformat(value)
    if d.isoformat() != value:
        raise ValueError(f"not a YYYY-MM-DD date: {value!r}")
    return d


# ── what the published database holds ────────────────────────────────────────


def market_symbols() -> list[str]:
    """config/assets.yml `daily`: the same expression fetch_market._load_assets() uses."""
    import yaml

    try:
        with open(ROOT / "config" / "assets.yml") as f:
            daily = (yaml.safe_load(f) or {}).get("daily")
    except (OSError, yaml.YAMLError, AttributeError) as exc:
        raise ValueError(f"config/assets.yml could not be read: {exc}") from exc
    if not isinstance(daily, list) or not daily or not all(isinstance(s, str) and s for s in daily):
        raise ValueError("config/assets.yml has no daily symbol list")
    return list(dict.fromkeys(daily))


def asset_symbols() -> list[str]:
    """Every configured daily asset series, from the module that writes them."""
    from src.market_data.asset_history import DAILY_SYMBOLS

    if not DAILY_SYMBOLS:
        raise ValueError("asset_history.DAILY_SYMBOLS is empty")
    return list(dict.fromkeys(DAILY_SYMBOLS))


def required_held(conn: sqlite3.Connection, table: str, symbols: list[str], interval: str | None = None) -> tuple[str | None, list[str]]:
    """(the newest date every required symbol has a close for, or None when any
    has none; the symbols missing or behind the newest), one query per symbol."""
    sql = f"SELECT MAX(date) FROM {table} WHERE symbol = ?" + (" AND interval = ?" if interval else "")
    latest: dict[str, str | None] = {}
    for sym in symbols:
        latest[sym] = conn.execute(sql, (sym, interval) if interval else (sym,)).fetchone()[0]
    have = [d for d in latest.values() if d]
    newest = max(have) if have else None
    behind = sorted(s for s, d in latest.items() if d is None or d < newest)
    if any(d is None for d in latest.values()):
        return None, behind
    return min(have), behind


@dataclass(frozen=True)
class Held:
    market: str | None
    asset: str | None
    behind: tuple[str, ...]

    def covers(self, s: date) -> bool:
        iso = s.isoformat()
        return bool(self.market and self.asset and self.market >= iso and self.asset >= iso)


def held(conn: sqlite3.Connection, market: list[str], assets: list[str]) -> Held:
    m, mb = required_held(conn, "market_daily", market)
    a, ab = required_held(conn, "asset_prices", assets, "1d")
    return Held(m, a, tuple([f"market_daily:{s}" for s in mb] + [f"asset_prices:{s}" for s in ab]))


def held_from_file(path: Path, market: list[str], assets: list[str]) -> Held:
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return held(conn, market, assets)
    finally:
        conn.close()


# ── the clock and the budget ──────────────────────────────────────────────────


class Clock:
    def mono(self) -> float:
        return _time.monotonic()

    def now(self) -> datetime:
        return datetime.now(timezone.utc)

    def sleep(self, seconds: float) -> None:
        _time.sleep(seconds)


class Budget:
    """A step's remaining time: every call and sleep is clamped to it."""

    def __init__(self, clock: Clock, seconds: float):
        self.clock = clock
        self.end = clock.mono() + seconds

    def left(self) -> float:
        return self.end - self.clock.mono()

    def exhausted(self) -> bool:
        return self.left() <= MIN_LEFT_S

    def call_timeout(self) -> float | None:
        """The timeout for one call, or None when no call may start."""
        if self.exhausted():
            return None
        return max(1.0, min(CALL_TIMEOUT_S, self.left() - MARGIN_S))

    def sleep(self, seconds: float) -> None:
        s = min(seconds, self.left() - MIN_LEFT_S)
        if s > 0:
            self.clock.sleep(s)


# ── GitHub ────────────────────────────────────────────────────────────────────


class GhError(RuntimeError):
    """A gh call that failed, timed out, or was not started for lack of time."""


class OutOfTime(GhError):
    pass


class SetupError(RuntimeError):
    """A setting that stops the step before any call."""


def data_release_repo(env: dict) -> str:
    """#49's setting, validated by the same function the API uses."""
    from api import bootstrap

    saved = os.environ.get("DATA_RELEASE_REPO")
    os.environ["DATA_RELEASE_REPO"] = env.get("DATA_RELEASE_REPO", "")
    try:
        return bootstrap.data_release_repo()
    except bootstrap.DataRepoError as exc:
        raise SetupError(str(exc)) from exc
    finally:
        if saved is None:
            os.environ.pop("DATA_RELEASE_REPO", None)
        else:
            os.environ["DATA_RELEASE_REPO"] = saved


Runner = Callable[..., subprocess.CompletedProcess]


class Gh:
    """Every GitHub call the sentinel makes, through the gh CLI, bounded by a budget."""

    def __init__(self, env: dict, budget: Budget, runner: Runner = subprocess.run):
        self.budget = budget
        self.runner = runner
        self.repo = env.get("GITHUB_REPOSITORY", "")
        if not self.repo or "/" not in self.repo:
            raise SetupError("GITHUB_REPOSITORY is not set")
        self.run_id = str(env.get("GITHUB_RUN_ID", ""))
        self.data_repo = data_release_repo(env)
        self.env = {k: v for k, v in env.items() if k != "DATA_RELEASE_TOKEN"}
        if self.data_repo == self.repo:
            self.data_env = self.env
        else:
            token = env.get("DATA_RELEASE_TOKEN", "")
            if not token:
                raise SetupError(TOKEN_ERROR)
            self.data_env = {**self.env, "GH_TOKEN": token}

    # one call
    def _run(self, args: list[str], *, data: bool = False) -> str:
        timeout = self.budget.call_timeout()
        if timeout is None:
            raise OutOfTime("no time left for " + " ".join(args[:3]))
        try:
            cp = self.runner(["gh", *args], env=self.data_env if data else self.env, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise GhError(f"gh {' '.join(args[:3])} timed out after {timeout:.0f}s") from exc
        except OSError as exc:
            raise GhError(f"gh could not start: {exc}") from exc
        if cp.returncode != 0:
            raise GhError(f"gh {' '.join(args[:3])} failed ({cp.returncode}): {(cp.stderr or '').strip()[:300]}")
        return cp.stdout

    def tries(self, fn: Callable[[], object]) -> object:
        """Up to three tries, pausing 10 s and 30 s (clamped to the budget)."""
        last: Exception | None = None
        for attempt in range(len(TRY_PAUSES_S) + 1):
            try:
                return fn()
            except OutOfTime:
                raise
            except (GhError, ValueError, KeyError, TypeError) as exc:
                last = exc
                print(f"  try {attempt + 1} failed: {exc}")
                if attempt < len(TRY_PAUSES_S):
                    if self.budget.left() - MIN_LEFT_S < TRY_PAUSES_S[attempt]:
                        break
                    self.budget.sleep(TRY_PAUSES_S[attempt])
        raise GhError(f"gave up after retries: {last}")

    def _api_pages(self, path: str, params: dict, key: str) -> list[dict]:
        """Every item of a paginated GET, or GhError when any page fails (never a partial list)."""
        items: list[dict] = []
        for page in range(1, MAX_PAGES + 1):
            args = ["api", "-X", "GET", path, "-f", f"per_page={PER_PAGE}", "-f", f"page={page}"]
            for k, v in params.items():
                args += ["-f", f"{k}={v}"]
            body = self.tries(lambda a=args: json.loads(self._run(a)))
            batch = body.get(key) if isinstance(body, dict) else None
            if not isinstance(batch, list):
                raise GhError(f"{path}: {key} is not a list")
            items.extend(batch)
            if len(batch) < PER_PAGE:
                return items
        raise GhError(f"{path}: more than {MAX_PAGES} pages")

    # reads
    def active_runs(self) -> list[dict]:
        out: list[dict] = []
        for status in ACTIVE_STATUSES:
            out += self._api_pages(f"repos/{self.repo}/actions/workflows/{WORKFLOW}/runs", {"status": status}, "workflow_runs")
        return out

    def sentinel_runs(self, s: date) -> list[dict]:
        since = dispatch_at(s).strftime("%Y-%m-%dT%H:%M:%SZ")
        runs = self._api_pages(f"repos/{self.repo}/actions/workflows/{WORKFLOW}/runs",
                               {"event": "workflow_dispatch", "created": f">={since}"}, "workflow_runs")
        return [r for r in runs if r.get("display_title") == TITLE.format(s.isoformat())]

    def reservations(self, s: date) -> list[dict]:
        return self._api_pages(f"repos/{self.repo}/actions/artifacts", {"name": RESERVATION.format(s.isoformat())}, "artifacts")

    def db_updated_at(self) -> str:
        body = self.tries(lambda: json.loads(self._run(["release", "view", "data-latest", "--repo", self.data_repo, "--json", "assets"], data=True)))
        for a in body.get("assets") or []:
            if a.get("name") == DB_ASSET:
                return str(a.get("updatedAt") or "")
        raise GhError(f"data-latest on {self.data_repo} has no {DB_ASSET}")

    def download_db(self, directory: Path) -> Path:
        self.tries(lambda: self._run(["release", "download", "data-latest", "-p", DB_ASSET, "-D", str(directory), "--clobber",
                                      "--repo", self.data_repo], data=True))
        return directory / DB_ASSET

    # writes
    def delete_artifact(self, artifact_id: int) -> None:
        self.tries(lambda: self._run(["api", "-X", "DELETE", f"repos/{self.repo}/actions/artifacts/{int(artifact_id)}"]))

    def dispatch(self, s: date) -> None:
        """One dispatch call, never retried: a failed call may still have been accepted."""
        self._run(["workflow", "run", WORKFLOW, "--repo", self.repo, "-f", "mode=full", "-f", f"close_session={s.isoformat()}"])


class Coverage:
    """The published database's coverage, downloaded again only when the asset changes."""

    def __init__(self, gh: Gh, market: Callable[[], list[str]] = market_symbols, assets: Callable[[], list[str]] = asset_symbols):
        self.gh = gh
        self.market = market
        self.assets = assets
        self._stamp: str | None = None
        self._held: Held | None = None

    def read(self) -> Held | None:
        """What the published database holds, or None when it cannot be read (nothing then counts as published)."""
        try:
            stamp = self.gh.db_updated_at()
            if stamp and stamp == self._stamp and self._held is not None:
                return self._held
            with tempfile.TemporaryDirectory(prefix="close-sentinel-") as tmp:
                path = self.gh.download_db(Path(tmp))
                h = held_from_file(path, self.market(), self.assets())
        except OutOfTime:
            raise
        except (GhError, sqlite3.Error, OSError) as exc:
            print(f"::warning::published database unreadable ({exc}); nothing counts as published")
            self._stamp, self._held = None, None
            return None
        self._stamp, self._held = stamp, h
        print(f"published database: market closes through {h.market}, asset prices through {h.asset}"
              + (f"; behind: {', '.join(h.behind)}" if h.behind else ""))
        return h


# ── the decision ──────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Decision:
    kind: str  # plan | wait | exit
    session: date | None = None
    until: datetime | None = None
    reason: str = ""


def _ts(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def decide(now: datetime, window_end: datetime, due: date | None, published: bool,
           active: list[dict], sent: list[dict], reserved: int) -> Decision:
    """Pure: what this watcher does next. `due` is due_session(now)."""
    if due is not None and not published:
        if active:
            ids = ", ".join(str(r.get("id")) for r in active[:5])
            return Decision("wait", until=now + timedelta(seconds=ACTIVE_WAIT_S), reason=f"a refresh is active ({ids}); it may publish {due}")
        if reserved < MAX_DISPATCHES:
            recent = [t for t in (_ts(r.get("updated_at")) for r in sent if r.get("status") == "completed") if t and now - t < RETRY_GAP]
            if recent:
                return Decision("wait", until=max(recent) + RETRY_GAP, reason=f"a sentinel refresh for {due} finished less than {RETRY_GAP} ago")
            return Decision("plan", session=due, reason=f"{due} is not published; dispatch {reserved + 1} of {MAX_DISPATCHES}")
        print(f"{due} is not published but its {MAX_DISPATCHES} dispatches are used; the backup crons remain")
    nxt = next_session(now)
    at = dispatch_at(nxt)
    if at <= window_end:
        return Decision("wait", until=at, reason=f"next dispatch time {at:%Y-%m-%d %H:%M}Z for {nxt}")
    return Decision("exit", reason=f"next dispatch time {at:%Y-%m-%d %H:%M}Z for {nxt} is past this watcher's window")


# ── the two steps ─────────────────────────────────────────────────────────────


def _write_output(env: dict, line: str) -> None:
    path = env.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a") as f:
            f.write(line + "\n")
    print(line)


def run_plan(env: dict, clock: Clock, runner: Runner = subprocess.run, coverage_factory: Callable[[Gh], Coverage] = Coverage,
             reservation_path: Path | None = None) -> int:
    if str(env.get("GITHUB_RUN_ATTEMPT") or "1") != "1":
        print("a re-run of a watcher never plans (its reservation could not be told apart); the next watcher decides")
        return 0
    budget = Budget(clock, PLAN_BUDGET_S)
    start = clock.now()
    window_end = start + WAIT_WINDOW
    try:
        gh = Gh(env, budget, runner)
    except SetupError as exc:
        print(f"::error::{exc}")
        return 1
    cov = coverage_factory(gh)
    try:
        while True:
            if budget.exhausted():
                print("deadline: this watcher stops without dispatching")
                return 0
            now = clock.now()
            due = due_session(now)
            next_session(now)  # fails closed on an uncovered year before anything is planned
            h = cov.read() if due is not None else None
            published = bool(due is not None and h is not None and h.covers(due))
            active: list[dict] = []
            sent: list[dict] = []
            reserved = 0
            if due is not None and not published:
                active = gh.active_runs()
                sent = gh.sentinel_runs(due)
                reserved = len(gh.reservations(due))
            d = decide(now, window_end, due, published, active, sent, reserved)
            print(f"[{now:%Y-%m-%d %H:%M:%S}Z] {d.kind}: {d.reason}")
            if d.kind == "plan":
                if budget.exhausted():
                    print("deadline: no time left to dispatch")
                    return 0
                rp = reservation_path or Path("reservation.json")
                rp.write_text(json.dumps({"session": d.session.isoformat(), "sentinel_run_id": gh.run_id,
                                          "reserved_at": now.strftime("%Y-%m-%dT%H:%M:%SZ")}) + "\n")
                _write_output(env, f"session={d.session.isoformat()}")
                return 0
            if d.kind == "exit":
                return 0
            budget.sleep(min(CHUNK_S, max(0.0, (d.until - now).total_seconds())))
    except CalendarError as exc:
        print(f"::error::{exc}")
        return 1
    except OutOfTime:
        print("deadline: this watcher stops without dispatching")
        return 0
    except GhError as exc:
        print(f"::error::GitHub could not be read completely ({exc}); nothing is dispatched")
        return 1
    except (ValueError, ImportError) as exc:
        print(f"::error::the required symbol lists could not be read ({exc}); nothing is dispatched")
        return 1


def run_dispatch(env: dict, clock: Clock, s: date, runner: Runner = subprocess.run,
                 coverage_factory: Callable[[Gh], Coverage] = Coverage) -> int:
    if str(env.get("GITHUB_RUN_ATTEMPT") or "1") != "1":
        print("::error::a re-run of a watcher never dispatches; nothing is dispatched")
        return 1
    budget = Budget(clock, DISPATCH_BUDGET_S)
    try:
        gh = Gh(env, budget, runner)
        if not is_session(s):
            print(f"::error::{s} is not a trading day; nothing is dispatched")
            return 1
    except (SetupError, CalendarError) as exc:
        print(f"::error::{exc}")
        return 1
    try:
        # the upload just finished; give the repository listing up to OWN_WAIT_S to show it
        listed_by = clock.mono() + OWN_WAIT_S
        while True:
            res = gh.reservations(s)
            own = [a for a in res if str((a.get("workflow_run") or {}).get("id")) == gh.run_id]
            if own or clock.mono() >= listed_by or budget.exhausted():
                break
            budget.sleep(min(OWN_POLL_S, listed_by - clock.mono()))
        if len(res) > MAX_DISPATCHES:
            print(f"::error::{len(res)} reservations for {s} (cap {MAX_DISPATCHES}); nothing is dispatched")
            return 1
        if not own:
            print(f"::error::this run's reservation for {s} is not listed after {OWN_WAIT_S}s; nothing is dispatched (it stays counted)")
            return 1
        h = coverage_factory(gh).read()
        published = bool(h and h.covers(s))
        active = gh.active_runs()
        seen = {r.get("id") for r in gh.sentinel_runs(s)}  # earlier dispatches for s, so the confirmation names only the new run
    except OutOfTime:
        print("::error::no time left to recheck; nothing is dispatched")
        return 1
    except GhError as exc:
        print(f"::error::recheck incomplete ({exc}); nothing is dispatched, the reservation stays")
        return 1
    except (ValueError, ImportError) as exc:
        print(f"::error::the required symbol lists could not be read ({exc}); nothing is dispatched, the reservation stays")
        return 1
    if published or active:
        why = f"{s} is now published" if published else f"a refresh is active ({', '.join(str(r.get('id')) for r in active[:5])})"
        print(f"{why}: not dispatching; releasing this run's reservation")
        try:
            for a in own:
                gh.delete_artifact(int(a["id"]))
        except GhError as exc:
            print(f"::warning::the reservation could not be released ({exc}); it stays counted")
        return 0
    try:
        gh.dispatch(s)
    except GhError as exc:
        print(f"::error::the dispatch call failed ({exc}); it may still have been accepted, so the reservation stays")
        return 1
    print(f"dispatched {WORKFLOW} mode=full for {s} ({len(res)} of {MAX_DISPATCHES})")
    end = clock.mono() + CONFIRM_S
    while clock.mono() < end and not budget.exhausted():
        try:
            runs = gh.sentinel_runs(s)
        except GhError as exc:
            print(f"  confirm: {exc}")
            runs = []
        runs = [r for r in runs if r.get("id") not in seen]
        if runs:
            newest = max(runs, key=lambda r: r.get("created_at") or "")
            print(f"confirmed: {newest.get('html_url')}")
            return 0
        budget.sleep(min(30, end - clock.mono()))
    print(f"::warning::the dispatched run for {s} is not listed yet; it is not dispatched again (the reservation stays)")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("plan")
    d = sub.add_parser("dispatch")
    d.add_argument("--session", required=True)
    args = ap.parse_args(argv)
    env = dict(os.environ)
    if args.cmd == "plan":
        return run_plan(env, Clock())
    try:
        s = iso_date(args.session)
    except ValueError as exc:
        print(f"::error::{exc}")
        return 1
    return run_dispatch(env, Clock(), s)


if __name__ == "__main__":
    raise SystemExit(main())
