"""The close sentinel (CS-1, Max 2026-11-05 item 6): scripts/close_sentinel.py and
.github/workflows/close-sentinel.yml.

Every GitHub call goes through a fake gh (no network); the clock is fake, so
the waits are counted, not slept. The synthetic databases use invented prices
(.claude/rules/test-data.md)."""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import close_sentinel as cs  # noqa: E402

WF = ROOT / ".github" / "workflows"
HOME = "maxkomen-macro/macro-regime-radar"
PRIVATE = "maxkomen-macro/macro-radar-data"
MARKET = ["SPY", "QQQ", "TLT"]
ASSETS = ["SPY", "^GSPC", "GLD"]
UTC = timezone.utc


def utc(*a) -> datetime:
    return datetime(*a, tzinfo=UTC)


def iso(t: datetime) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def make_db(path: Path, market: dict[str, str | None], assets: dict[str, str | None]) -> Path:
    """market/assets: symbol -> newest stored date (None = no rows). Invented closes."""
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL)")
    conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL)")
    for sym, d in market.items():
        if d:
            conn.execute("INSERT INTO market_daily VALUES (?, '2026-01-02', 100.0)", (sym,))
            conn.execute("INSERT INTO market_daily VALUES (?, ?, 101.0)", (sym, d))
    for sym, d in assets.items():
        if d:
            conn.execute("INSERT INTO asset_prices VALUES (?, '1d', ?, 50.0)", (sym, d))
            conn.execute("INSERT INTO asset_prices VALUES (?, '1mo', '2030-01-01', 50.0)", (sym,))  # monthly rows never count
    conn.commit()
    conn.close()
    return path


def current(d: str) -> tuple[dict, dict]:
    return {s: d for s in MARKET}, {s: d for s in ASSETS}


# ── a fake clock and a fake gh ───────────────────────────────────────────────


class FakeClock(cs.Clock):
    def __init__(self, wall: datetime):
        self.t = 0.0
        self.wall0 = wall
        self.sleeps: list[float] = []

    def mono(self) -> float:
        return self.t

    def now(self) -> datetime:
        return self.wall0 + timedelta(seconds=self.t)

    def sleep(self, seconds: float) -> None:
        assert seconds > 0
        self.sleeps.append(seconds)
        self.t += seconds


class FakeGitHub:
    """Enough of gh for the sentinel: run and artifact listing (filtered, paginated), artifact
    deletion, the release asset's metadata and download, and workflow dispatch."""

    def __init__(self, clock: FakeClock, db: Path | None, run_id: str = "9001"):
        self.clock = clock
        self.db = db
        self.db_stamp = "2026-11-05T07:19:20Z"
        self.runs: list[dict] = []
        self.artifacts: list[dict] = []
        self.calls: list[dict] = []
        self.dispatches: list[list[str]] = []
        self.fail: dict[str, int] = {}     # call kind -> remaining failures
        self.fail_always: set[str] = set()
        self.hooks: dict[str, callable] = {}
        self.visible = True                # whether a dispatched run appears in listings
        self.run_id = run_id
        self.next_id = 1

    def env(self, repo=HOME, data_repo=HOME, token="") -> dict:
        e = {"GITHUB_REPOSITORY": repo, "GITHUB_RUN_ID": self.run_id, "GH_TOKEN": "builtin", "DATA_RELEASE_REPO": data_repo}
        if token:
            e["DATA_RELEASE_TOKEN"] = token
        return e

    def add_run(self, title="Refresh Data", status="completed", conclusion="success", event="schedule", created=None, updated=None):
        r = {"id": 5000 + self.next_id, "display_title": title, "status": status, "conclusion": conclusion, "event": event,
             "created_at": iso(created or self.clock.now()), "updated_at": iso(updated or self.clock.now()),
             "html_url": f"https://github.com/{HOME}/actions/runs/{5000 + self.next_id}"}
        self.next_id += 1
        self.runs.append(r)
        return r

    def reserve(self, session: str, run_id: str | None = None) -> dict:
        a = {"id": 700 + self.next_id, "name": cs.RESERVATION.format(session), "workflow_run": {"id": int(run_id or self.run_id)},
             "created_at": iso(self.clock.now()), "expired": False}
        self.next_id += 1
        self.artifacts.append(a)
        return a

    def _fail(self, kind: str) -> bool:
        if kind in self.fail_always:
            return True
        if self.fail.get(kind, 0) > 0:
            self.fail[kind] -= 1
            return True
        return False

    def __call__(self, args, env=None, capture_output=True, text=True, timeout=None):
        assert args[0] == "gh" and capture_output and text and timeout is not None and timeout > 0
        rest = args[1:]
        kind = self._kind(rest)
        self.calls.append({"args": rest, "token": (env or {}).get("GH_TOKEN"), "timeout": timeout, "kind": kind, "at": self.clock.t})
        if kind in self.hooks:
            self.hooks[kind](self, rest)
        if self._fail(kind):
            return subprocess.CompletedProcess(args, 1, "", f"{kind} failed")
        out = getattr(self, "_" + kind)(rest)
        return subprocess.CompletedProcess(args, 0, out if isinstance(out, str) else json.dumps(out), "")

    @staticmethod
    def _kind(rest: list[str]) -> str:
        if rest[:2] == ["release", "view"]:
            return "release_view"
        if rest[:2] == ["release", "download"]:
            return "release_download"
        if rest[:2] == ["workflow", "run"]:
            return "dispatch"
        if rest[:3] == ["api", "-X", "DELETE"]:
            return "delete"
        if rest[:3] == ["api", "-X", "GET"]:
            return "artifacts" if rest[3].endswith("/actions/artifacts") else "runs"
        raise AssertionError(f"unexpected gh call {rest}")

    @staticmethod
    def _fields(rest: list[str]) -> dict:
        out = {}
        for i, a in enumerate(rest):
            if a == "-f":
                k, v = rest[i + 1].split("=", 1)
                out[k] = v
        return out

    def _page(self, items: list[dict], f: dict, key: str) -> dict:
        per, page = int(f["per_page"]), int(f["page"])
        return {key: items[(page - 1) * per: page * per], "total_count": len(items)}

    def _runs(self, rest):
        assert rest[3] == f"repos/{HOME}/actions/workflows/refresh-data.yml/runs", rest[3]
        f = self._fields(rest)
        items = list(self.runs)
        if "status" in f:
            items = [r for r in items if r["status"] == f["status"]]
        if "event" in f:
            items = [r for r in items if r["event"] == f["event"]]
        if "created" in f:
            assert f["created"].startswith(">=")
            items = [r for r in items if r["created_at"] >= f["created"][2:]]
        return self._page(sorted(items, key=lambda r: r["created_at"], reverse=True), f, "workflow_runs")

    def _artifacts(self, rest):
        assert rest[3] == f"repos/{HOME}/actions/artifacts", rest[3]
        f = self._fields(rest)
        return self._page([a for a in self.artifacts if a["name"] == f["name"]], f, "artifacts")

    def _delete(self, rest):
        aid = int(rest[3].rsplit("/", 1)[1])
        assert rest[3] == f"repos/{HOME}/actions/artifacts/{aid}"
        self.artifacts = [a for a in self.artifacts if a["id"] != aid]
        return ""

    def _release_view(self, rest):
        return {"assets": [{"name": "validation.json", "updatedAt": "x"}, {"name": "macro_radar.db", "updatedAt": self.db_stamp}]}

    def _release_download(self, rest):
        if self.db is None:
            raise AssertionError("no db")
        dest = Path(rest[rest.index("-D") + 1])
        shutil.copy(self.db, dest / "macro_radar.db")
        return ""

    def _dispatch(self, rest):
        self.dispatches.append(rest)
        f = self._fields(rest)
        if self.visible:
            self.add_run(title=cs.TITLE.format(f["close_session"]), status="queued", conclusion=None, event="workflow_dispatch")
        return ""

    def kinds(self) -> list[str]:
        return [c["kind"] for c in self.calls]


def cov(gh):
    return cs.Coverage(gh, lambda: list(MARKET), lambda: list(ASSETS))


def plan(fake: FakeGitHub, clock: FakeClock, tmp_path: Path, env: dict | None = None) -> tuple[int, str | None]:
    out = tmp_path / "gh_output.txt"
    out.write_text("")
    e = dict(env or fake.env())
    e["GITHUB_OUTPUT"] = str(out)
    rc = cs.run_plan(e, clock, runner=fake, coverage_factory=cov, reservation_path=tmp_path / "reservation.json")
    lines = [ln for ln in out.read_text().splitlines() if ln.startswith("session=")]
    return rc, (lines[0].split("=", 1)[1] if lines else None)


def dispatch(fake: FakeGitHub, clock: FakeClock, s: str, env: dict | None = None) -> int:
    return cs.run_dispatch(env or fake.env(), clock, date.fromisoformat(s), runner=fake, coverage_factory=cov)


# ── the calendar ──────────────────────────────────────────────────────────────


@pytest.mark.parametrize("day, expected", [
    ("2026-11-05", utc(2026, 11, 5, 22, 30)),   # EST
    ("2026-10-30", utc(2026, 10, 30, 21, 30)),  # EDT
    ("2026-11-02", utc(2026, 11, 2, 22, 30)),   # first session after the 2026-11-01 switch
    ("2026-03-06", utc(2026, 3, 6, 22, 30)),    # last EST session before 2026-03-08
    ("2026-03-09", utc(2026, 3, 9, 21, 30)),    # first EDT session
    ("2026-11-27", utc(2026, 11, 27, 22, 30)),  # early close (13:00 ET): still 17:30 ET
    ("2026-12-24", utc(2026, 12, 24, 22, 30)),  # early close
])
def test_dispatch_time_is_1730_new_york_on_every_session(day, expected):
    assert cs.dispatch_at(date.fromisoformat(day)) == expected


@pytest.mark.parametrize("day", ["2026-11-26", "2026-11-07", "2026-11-08", "2026-12-25"])
def test_no_dispatch_time_exists_for_a_closed_day(day):
    with pytest.raises(ValueError):
        cs.dispatch_at(date.fromisoformat(day))


@pytest.mark.parametrize("now, due, nxt", [
    (utc(2026, 11, 5, 15, 0), "2026-11-04", "2026-11-05"),   # before today's close: yesterday is due, today next
    (utc(2026, 11, 5, 22, 30), "2026-11-05", "2026-11-06"),  # exactly at today's dispatch time
    (utc(2026, 11, 6, 2, 0), "2026-11-05", "2026-11-06"),    # after 00:00 UTC, before 00:00 New York
    (utc(2026, 11, 7, 5, 30), "2026-11-06", "2026-11-09"),   # DR-16: Saturday 00:30 NY catches up Friday
    (utc(2026, 11, 26, 18, 0), "2026-11-25", "2026-11-27"),  # DR-16: Thanksgiving catches up Wednesday
    (utc(2026, 11, 27, 23, 0), "2026-11-27", "2026-11-30"),  # after the early close's dispatch time
])
def test_due_and_next_sessions_target_trading_days_only(now, due, nxt):
    assert cs.due_session(now) == date.fromisoformat(due)
    assert cs.next_session(now) == date.fromisoformat(nxt)
    assert cs.is_session(cs.due_session(now)) and cs.is_session(cs.next_session(now))


def test_a_year_the_calendar_does_not_cover_fails_closed():
    assert max(cs.session.HOLIDAYS) == 2027  # the day this test goes stale, extend both tables together
    with pytest.raises(cs.CalendarError, match="NYSE calendar has no 2028"):
        cs.due_session(utc(2028, 1, 4, 23, 0))
    with pytest.raises(cs.CalendarError):
        cs.next_session(utc(2027, 12, 31, 23, 0))  # searching ahead into 2028


def test_an_uncovered_year_stops_the_plan_before_any_call(tmp_path):
    clock = FakeClock(utc(2028, 1, 4, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2027-12-31")))
    rc, session = plan(fake, clock, tmp_path)
    assert rc == 1 and session is None and fake.calls == []


# ── what the published database holds (DR-03) ────────────────────────────────


def test_every_required_symbol_current_publishes_the_session(tmp_path):
    h = cs.held_from_file(make_db(tmp_path / "db", *current("2026-11-05")), MARKET, ASSETS)
    assert h == cs.Held("2026-11-05", "2026-11-05", ())
    assert h.covers(date(2026, 11, 5)) and not h.covers(date(2026, 11, 6))


def test_one_market_symbol_behind_holds_the_session_back(tmp_path):
    m, a = current("2026-11-05")
    m["QQQ"] = "2026-11-04"
    h = cs.held_from_file(make_db(tmp_path / "db", m, a), MARKET, ASSETS)
    assert h.market == "2026-11-04" and "market_daily:QQQ" in h.behind and not h.covers(date(2026, 11, 5))


def test_a_configured_symbol_with_no_rows_is_never_left_out(tmp_path):
    m, a = current("2026-11-05")
    m["QQQ"] = None
    h = cs.held_from_file(make_db(tmp_path / "db", m, a), MARKET, ASSETS)
    assert h.market is None and "market_daily:QQQ" in h.behind and not h.covers(date(2026, 11, 5))
    # long-stale is not "discontinued" either: it holds coverage back however old it is
    m["QQQ"] = "2026-09-01"
    h = cs.held_from_file(make_db(tmp_path / "db2", m, a), MARKET, ASSETS)
    assert h.market == "2026-09-01" and not h.covers(date(2026, 11, 5))


def test_a_newly_configured_asset_without_rows_keeps_the_session_unpublished(tmp_path):
    m, a = current("2026-11-05")
    db = make_db(tmp_path / "db", m, a)
    conn = sqlite3.connect(db)
    conn.execute("CREATE TABLE source_watermarks (source TEXT, last_obs TEXT)")
    conn.execute("INSERT INTO source_watermarks VALUES ('asset_prices', '2026-11-05')")  # the old aggregate says current
    conn.commit()
    conn.close()
    h = cs.held_from_file(db, MARKET, ASSETS + ["XLK"])
    assert h.asset is None and "asset_prices:XLK" in h.behind and not h.covers(date(2026, 11, 5))


def test_an_asset_series_behind_or_only_monthly_holds_the_session_back(tmp_path):
    m, a = current("2026-11-05")
    a["GLD"] = "2026-11-04"
    h = cs.held_from_file(make_db(tmp_path / "db", m, a), MARKET, ASSETS)
    assert h.asset == "2026-11-04" and not h.covers(date(2026, 11, 5))
    a["GLD"] = None  # only its (future-dated) monthly row would remain if one existed
    h = cs.held_from_file(make_db(tmp_path / "db2", m, a), MARKET, ASSETS)
    assert h.asset is None


def test_a_database_without_the_tables_is_unknown_and_nothing_counts_as_published(tmp_path):
    db = tmp_path / "db"
    sqlite3.connect(db).close()
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, db)
    gh = cs.Gh(fake.env(), cs.Budget(clock, 600), fake)
    assert cov(gh).read() is None


def test_the_required_lists_are_the_ones_the_pipeline_stores():
    from src.market_data import asset_history, fetch_market

    assert cs.market_symbols() == list(dict.fromkeys(fetch_market._load_assets()["daily"]))
    assert cs.market_symbols() == yaml.safe_load((ROOT / "config" / "assets.yml").read_text())["daily"]
    assert cs.asset_symbols() == list(dict.fromkeys(asset_history.DAILY_SYMBOLS)) and len(cs.asset_symbols()) > 10


def test_with_every_symbol_current_the_market_date_matches_the_validator(tmp_path):
    from scripts import validate_db

    db = make_db(tmp_path / "db", *current("2026-11-05"))
    assert cs.held_from_file(db, MARKET, ASSETS).market == validate_db.inspect(db)["fresh"]["market_daily_date"] == "2026-11-05"


def test_the_database_is_downloaded_again_only_when_the_asset_changes(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-05")))
    c = cov(cs.Gh(fake.env(), cs.Budget(clock, 3600), fake))
    assert c.read().covers(date(2026, 11, 5)) and c.read().covers(date(2026, 11, 5))
    assert fake.kinds().count("release_download") == 1
    fake.db_stamp = "2026-11-05T23:10:00Z"
    c.read()
    assert fake.kinds().count("release_download") == 2


# ── decide ───────────────────────────────────────────────────────────────────


WINDOW = utc(2026, 11, 6, 4, 0)


def test_before_todays_close_with_yesterday_published_it_waits_for_today():
    now = utc(2026, 11, 5, 15, 0)
    d = cs.decide(now, WINDOW, date(2026, 11, 4), True, [], [], 0)
    assert d.kind == "wait" and d.until == utc(2026, 11, 5, 22, 30)


def test_an_unpublished_due_session_is_planned():
    d = cs.decide(utc(2026, 11, 5, 22, 31), WINDOW, date(2026, 11, 5), False, [], [], 0)
    assert d == cs.Decision("plan", session=date(2026, 11, 5), reason=d.reason)


def test_an_active_refresh_means_wait_not_dispatch():
    now = utc(2026, 11, 5, 22, 31)
    d = cs.decide(now, WINDOW, date(2026, 11, 5), False, [{"id": 1, "status": "in_progress"}], [], 0)
    assert d.kind == "wait" and d.until == now + timedelta(minutes=5)


def test_with_its_dispatches_used_it_waits_for_the_next_session_or_leaves():
    now = utc(2026, 11, 5, 23, 0)
    d = cs.decide(now, WINDOW, date(2026, 11, 5), False, [], [], 2)
    assert d.kind == "exit"  # next is 11-06 22:30, past this watcher's window
    d = cs.decide(now, utc(2026, 11, 7, 0, 0), date(2026, 11, 5), False, [], [], 2)
    assert d.kind == "wait" and d.until == utc(2026, 11, 6, 22, 30)


def test_a_second_dispatch_waits_an_hour_after_the_first_finished():
    now = utc(2026, 11, 5, 23, 0)
    sent = [{"status": "completed", "updated_at": iso(now - timedelta(minutes=30))}]
    d = cs.decide(now, WINDOW, date(2026, 11, 5), False, [], sent, 1)
    assert d.kind == "wait" and d.until == now + timedelta(minutes=30)
    sent = [{"status": "completed", "updated_at": iso(now - timedelta(minutes=61))}]
    assert cs.decide(now, WINDOW, date(2026, 11, 5), False, [], sent, 1).kind == "plan"


def test_a_watcher_starting_early_without_a_delay_leaves_rather_than_hold_a_runner():
    now = utc(2026, 11, 5, 12, 7)
    d = cs.decide(now, now + cs.WAIT_WINDOW, date(2026, 11, 4), True, [], [], 0)
    assert d.kind == "exit"


# ── the plan step ─────────────────────────────────────────────────────────────


def test_a_watcher_before_the_close_waits_then_dispatches_today(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 19, 40))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    rc, session = plan(fake, clock, tmp_path)
    assert rc == 0 and session == "2026-11-05"
    assert clock.now() >= utc(2026, 11, 5, 22, 30) and all(s <= cs.CHUNK_S for s in clock.sleeps)
    assert json.loads((tmp_path / "reservation.json").read_text())["session"] == "2026-11-05"
    assert "dispatch" not in fake.kinds()  # plan never dispatches


def test_a_late_watcher_catches_up_the_unpublished_session_on_saturday(tmp_path):
    clock = FakeClock(utc(2026, 11, 7, 5, 30))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-05")))
    assert plan(fake, clock, tmp_path) == (0, "2026-11-06")


def test_a_published_session_plans_nothing(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-05")))
    assert plan(fake, clock, tmp_path) == (0, None)
    assert not any(k in fake.kinds() for k in ("runs", "artifacts"))


def test_a_backup_that_publishes_while_waiting_ends_the_wait(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 35))
    fake = FakeGitHub(clock, make_db(tmp_path / "old", *current("2026-11-04")))
    fake.add_run(status="in_progress", conclusion=None)

    def publish(f, rest):
        if clock.t >= 600:
            f.runs = [dict(r, status="completed") for r in f.runs]
            f.db = make_db(tmp_path / "new", *current("2026-11-05")) if not (tmp_path / "new").exists() else tmp_path / "new"
            f.db_stamp = "2026-11-05T22:50:00Z"
    fake.hooks["release_view"] = publish
    assert plan(fake, clock, tmp_path) == (0, None)
    assert "dispatch" not in fake.kinds()


def test_a_run_or_artifact_listing_that_fails_never_plans(tmp_path):
    for kind in ("runs", "artifacts"):
        clock = FakeClock(utc(2026, 11, 5, 23, 0))
        fake = FakeGitHub(clock, make_db(tmp_path / f"db-{kind}", *current("2026-11-04")))
        fake.fail_always.add(kind)
        assert plan(fake, clock, tmp_path) == (1, None), kind


def test_an_active_run_on_a_later_page_is_honoured(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    for _ in range(cs.PER_PAGE + 1):
        fake.add_run(status="waiting", conclusion=None)
    gh = cs.Gh(fake.env(), cs.Budget(clock, 3600), fake)
    assert len(gh.active_runs()) == cs.PER_PAGE + 1
    pages = [c for c in fake.calls if "status=waiting" in c["args"]]
    assert len(pages) == 2


def test_a_failed_later_page_is_incomplete_not_empty(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    for _ in range(cs.PER_PAGE + 5):
        fake.add_run(status="queued", conclusion=None)
    gh = cs.Gh(fake.env(), cs.Budget(clock, 3600), fake)

    def fail_page_two(f, rest):
        if "page=2" in rest:
            f.fail_always.add("runs")
    fake.hooks["runs"] = fail_page_two
    with pytest.raises(cs.GhError):
        gh.active_runs()


def test_a_sentinel_completion_on_a_later_page_still_holds_the_retry_gap(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 30))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.add_run(title=cs.TITLE.format("2026-11-05"), event="workflow_dispatch", created=utc(2026, 11, 5, 22, 31),
                 updated=utc(2026, 11, 5, 23, 0))
    fake.reserve("2026-11-05", run_id="8000")
    for i in range(cs.PER_PAGE):  # newer manual dispatches push it to page 2
        fake.add_run(title="Refresh Data", event="workflow_dispatch", created=utc(2026, 11, 5, 23, 1) + timedelta(seconds=i))
    gh = cs.Gh(fake.env(), cs.Budget(clock, 3600), fake)
    assert [r["display_title"] for r in gh.sentinel_runs(date(2026, 11, 5))] == ["Refresh Data (close 2026-11-05)"]
    d = cs.decide(clock.now(), WINDOW, date(2026, 11, 5), False, [], gh.sentinel_runs(date(2026, 11, 5)), 1)
    assert d.kind == "wait" and d.until == utc(2026, 11, 6, 0, 0)


# ── the budget (DR-02) ────────────────────────────────────────────────────────


def test_near_the_deadline_no_call_can_run_past_it_and_no_late_plan_is_emitted(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))

    class SlowRunner:  # every call takes as long as it is allowed to
        def __call__(self, args, **kw):
            fake.calls.append({"args": args[1:], "timeout": kw["timeout"], "kind": "slow", "at": clock.t})
            clock.t += kw["timeout"]
            raise subprocess.TimeoutExpired(args, kw["timeout"])

    start_offset = cs.PLAN_BUDGET_S - 200  # enter the loop with 200 s left
    real_budget = cs.Budget

    class LateBudget(real_budget):
        def __init__(self, c, seconds):
            super().__init__(c, seconds)
            self.end -= start_offset

    cs_budget, cs.Budget = cs.Budget, LateBudget
    try:
        out = tmp_path / "o"
        out.write_text("")
        rc = cs.run_plan({**fake.env(), "GITHUB_OUTPUT": str(out)}, clock, runner=SlowRunner(), coverage_factory=cov,
                         reservation_path=tmp_path / "r.json")
    finally:
        cs.Budget = cs_budget
    assert rc in (0, 1) and out.read_text() == ""
    assert clock.t <= 200 - cs.MARGIN_S + 1e-6  # never past the deadline
    for c in fake.calls:
        assert c["at"] + c["timeout"] <= 200 - cs.MARGIN_S + 1e-6


def test_every_sleep_is_clamped_to_the_budget():
    clock = FakeClock(utc(2026, 11, 5, 12, 0))
    b = cs.Budget(clock, 100)
    b.sleep(1000)
    assert clock.t == 100 - cs.MIN_LEFT_S and b.exhausted() and b.call_timeout() is None
    b.sleep(5)
    assert clock.t == 100 - cs.MIN_LEFT_S


def test_a_timed_out_call_counts_as_a_failed_try(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    seen = []

    def runner(args, **kw):
        seen.append(kw["timeout"])
        if len(seen) == 1:
            raise subprocess.TimeoutExpired(args, kw["timeout"])
        return subprocess.CompletedProcess(args, 0, json.dumps({"artifacts": []}), "")

    gh = cs.Gh(FakeGitHub(clock, None).env(), cs.Budget(clock, 3600), runner)
    assert gh.reservations(date(2026, 11, 5)) == [] and len(seen) == 2 and all(t <= cs.CALL_TIMEOUT_S for t in seen)


def test_the_plan_step_ends_inside_its_budget_when_nothing_happens(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 35))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.add_run(status="in_progress", conclusion=None)  # a refresh that never finishes
    assert plan(fake, clock, tmp_path) == (0, None)
    assert clock.t <= cs.PLAN_BUDGET_S and "dispatch" not in fake.kinds()


# ── the dispatch step (DR-01, DR-10, DR-17) ──────────────────────────────────


def test_a_reserved_session_is_dispatched_once_and_confirmed(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    assert dispatch(fake, clock, "2026-11-05") == 0
    assert fake.dispatches == [["workflow", "run", "refresh-data.yml", "--repo", HOME, "-f", "mode=full", "-f", "close_session=2026-11-05"]]
    assert len(fake.artifacts) == 1  # the reservation stays with the dispatch


def test_a_third_reservation_never_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05", "1")
    fake.reserve("2026-11-05", "2")
    fake.reserve("2026-11-05")
    assert dispatch(fake, clock, "2026-11-05") == 1 and fake.dispatches == []


def test_a_reservation_listing_that_fails_never_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    fake.fail_always.add("artifacts")
    assert dispatch(fake, clock, "2026-11-05") == 1 and fake.dispatches == []


def test_a_reservation_not_listed_yet_never_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    assert dispatch(fake, clock, "2026-11-05") == 1 and fake.dispatches == []


def test_a_reservation_listed_a_little_late_still_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    listings = []

    def appear_on_second(f, rest):
        listings.append(clock.t)
        if len(listings) == 2:
            f.reserve("2026-11-05")
    fake.hooks["artifacts"] = appear_on_second
    assert dispatch(fake, clock, "2026-11-05") == 0 and len(fake.dispatches) == 1
    assert listings[1] - listings[0] <= cs.OWN_POLL_S


def test_a_reservation_never_listed_waits_a_bounded_time_and_never_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    assert dispatch(fake, clock, "2026-11-05") == 1 and fake.dispatches == []
    assert cs.OWN_WAIT_S <= clock.t <= cs.OWN_WAIT_S + cs.OWN_POLL_S


def test_the_confirmation_names_only_the_new_run(tmp_path, capsys):
    clock = FakeClock(utc(2026, 11, 5, 23, 40))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    first = fake.add_run(title=cs.TITLE.format("2026-11-05"), event="workflow_dispatch", created=utc(2026, 11, 5, 22, 31),
                         updated=utc(2026, 11, 5, 22, 39))
    fake.reserve("2026-11-05", run_id="111")
    fake.reserve("2026-11-05")
    fake.visible = False
    assert dispatch(fake, clock, "2026-11-05") == 0
    out = capsys.readouterr().out
    assert first["html_url"] not in out and "not listed yet" in out and len(fake.dispatches) == 1


@pytest.mark.parametrize("attempt", ["2", "3"])
def test_a_rerun_watcher_never_plans_or_dispatches(tmp_path, attempt):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    env = {**fake.env(), "GITHUB_RUN_ATTEMPT": attempt}
    assert plan(fake, clock, tmp_path, env=env) == (0, None)
    assert dispatch(fake, clock, "2026-11-05", env=env) == 1
    assert fake.calls == [] and len(fake.artifacts) == 1
    assert plan(fake, clock, tmp_path, env={**fake.env(), "GITHUB_RUN_ATTEMPT": "1"}) == (0, "2026-11-05")


def test_a_missing_or_broken_symbol_config_stops_cleanly(tmp_path, monkeypatch):
    monkeypatch.setattr(cs, "ROOT", tmp_path)
    with pytest.raises(ValueError, match="could not be read"):
        cs.market_symbols()
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "assets.yml").write_text("daily: [SPY\n")
    with pytest.raises(ValueError, match="could not be read"):
        cs.market_symbols()
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    out = tmp_path / "o"
    out.write_text("")
    rc = cs.run_plan({**fake.env(), "GITHUB_OUTPUT": str(out)}, clock, runner=fake,
                     coverage_factory=lambda gh: cs.Coverage(gh, cs.market_symbols, lambda: list(ASSETS)), reservation_path=tmp_path / "r")
    assert rc == 1 and out.read_text() == "" and "dispatch" not in fake.kinds()


def test_a_listing_without_its_items_is_an_error_not_an_empty_list(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))

    def runner(args, **kw):
        return subprocess.CompletedProcess(args, 0, json.dumps({"message": "Not Found"}), "")

    gh = cs.Gh(FakeGitHub(clock, None).env(), cs.Budget(clock, 3600), runner)
    with pytest.raises(cs.GhError):
        gh.reservations(date(2026, 11, 5))


def test_the_final_recheck_finding_the_session_published_releases_the_reservation(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-05")))
    fake.reserve("2026-11-05")
    assert dispatch(fake, clock, "2026-11-05") == 0
    assert fake.dispatches == [] and fake.artifacts == [] and "delete" in fake.kinds()


def test_two_definitive_skips_release_their_reservations_and_a_third_watcher_still_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 31))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    for watcher in ("101", "102"):
        fake.run_id = watcher
        rc, session = plan(fake, clock, tmp_path)
        assert (rc, session) == (0, "2026-11-05")
        fake.reserve(session)  # the workflow's upload step
        news = fake.add_run(status="in_progress", conclusion=None)  # an hourly news run starts during the recheck
        assert dispatch(fake, clock, session) == 0 and fake.dispatches == []
        news["status"] = "completed"
        clock.t += 3600
    assert fake.artifacts == []
    fake.run_id = "103"
    rc, session = plan(fake, clock, tmp_path)
    assert session == "2026-11-05"
    fake.reserve(session)
    assert dispatch(fake, clock, session) == 0 and len(fake.dispatches) == 1


def test_a_release_that_fails_keeps_the_reservation(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-05")))
    fake.reserve("2026-11-05")
    fake.fail_always.add("delete")
    assert dispatch(fake, clock, "2026-11-05") == 0 and fake.dispatches == [] and len(fake.artifacts) == 1


def test_an_incomplete_recheck_keeps_the_reservation_and_never_dispatches(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    fake.fail_always.add("runs")
    assert dispatch(fake, clock, "2026-11-05") == 1 and fake.dispatches == [] and len(fake.artifacts) == 1


def test_a_failed_dispatch_call_is_never_retried_and_keeps_the_reservation(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    fake.fail_always.add("dispatch")
    assert dispatch(fake, clock, "2026-11-05") == 1
    assert fake.kinds().count("dispatch") == 1 and len(fake.artifacts) == 1


def test_an_accepted_dispatch_that_never_appears_is_not_dispatched_again(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 32))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    fake.visible = False
    assert dispatch(fake, clock, "2026-11-05") == 0
    assert fake.kinds().count("dispatch") == 1 and len(fake.artifacts) == 1
    assert clock.t <= cs.DISPATCH_BUDGET_S


def test_watchers_in_sequence_share_the_cap_of_two(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 22, 31))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))  # the provider never posts 11-05
    for n, watcher in enumerate(("201", "202", "203"), start=1):
        fake.run_id = watcher
        rc, session = plan(fake, clock, tmp_path)
        if n == 3:
            assert session is None  # both dispatches used: the backups remain
            break
        assert session == "2026-11-05"
        fake.reserve(session)
        assert dispatch(fake, clock, session) == 0
        for r in fake.runs:
            r["status"], r["conclusion"], r["updated_at"] = "completed", "success", iso(clock.now())
        clock.t += 3601
    assert len(fake.dispatches) == 2


def test_dispatch_refuses_a_closed_day_or_a_malformed_session():
    clock = FakeClock(utc(2026, 11, 26, 23, 0))
    fake = FakeGitHub(clock, None)
    assert cs.run_dispatch(fake.env(), clock, date(2026, 11, 26), runner=fake) == 1 and fake.calls == []
    assert cs.main(["dispatch", "--session", "2026-11-5"]) == 1


# ── private storage (#49) ─────────────────────────────────────────────────────


def test_another_data_repo_without_its_token_stops_before_any_call(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    assert plan(fake, clock, tmp_path, env=fake.env(data_repo=PRIVATE)) == (1, None)
    fake.reserve("2026-11-05")
    assert dispatch(fake, clock, "2026-11-05", env=fake.env(data_repo=PRIVATE)) == 1
    assert fake.calls == []


def test_release_reads_use_the_data_token_only_for_another_repo_and_github_calls_never_do(tmp_path):
    clock = FakeClock(utc(2026, 11, 5, 23, 0))
    fake = FakeGitHub(clock, make_db(tmp_path / "db", *current("2026-11-04")))
    fake.reserve("2026-11-05")
    assert dispatch(fake, clock, "2026-11-05", env=fake.env(data_repo=PRIVATE, token="data-secret")) == 0
    for c in fake.calls:
        if c["kind"].startswith("release"):
            assert c["token"] == "data-secret" and c["args"][c["args"].index("--repo") + 1] == PRIVATE
        else:
            assert c["token"] == "builtin"
            if "--repo" in c["args"]:
                assert c["args"][c["args"].index("--repo") + 1] == HOME
    fake2 = FakeGitHub(clock, make_db(tmp_path / "db2", *current("2026-11-04")))
    fake2.reserve("2026-11-05")
    assert dispatch(fake2, clock, "2026-11-05", env=fake2.env(token="data-secret")) == 0
    assert {c["token"] for c in fake2.calls} == {"builtin"}  # this repo: the secret is never used


# ── the workflows ─────────────────────────────────────────────────────────────


def _load(name: str) -> dict:
    return yaml.safe_load((WF / name).read_text())


def _on(doc: dict) -> dict:
    return doc.get("on") or doc.get(True)


def test_the_sentinel_workflow_is_low_frequency_serialized_bounded_and_off_by_default():
    doc = _load("close-sentinel.yml")
    on = _on(doc)
    assert [c["cron"] for c in on["schedule"]] == ["7 12 * * 1-5", "37 14 * * 1-5", "7 17 * * 1-5", "37 19 * * 1-5"]
    assert "workflow_dispatch" in on and not (on["workflow_dispatch"] or {}).get("inputs")
    assert doc["permissions"] == {"actions": "write", "contents": "read"}
    assert doc["concurrency"] == {"group": "close-sentinel", "cancel-in-progress": False}
    job = doc["jobs"]["sentinel"]
    steps = job["steps"]
    assert job["timeout-minutes"] == 355 and sum(s["timeout-minutes"] for s in steps) <= 355
    assert steps[0]["if"] == "vars.CLOSE_SENTINEL_ENABLED != 'true'" and "held:" in steps[0]["run"]
    for s in steps[1:]:
        assert s["if"].startswith("vars.CLOSE_SENTINEL_ENABLED == 'true'"), s["name"]
    names = [s["name"] for s in steps]
    plan_step, reserve, disp = steps[names.index("Wait for the close and decide")], steps[names.index("Reserve the dispatch")], \
        steps[names.index("Dispatch the full refresh for the session")]
    assert names.index("Reserve the dispatch") < names.index("Dispatch the full refresh for the session")
    assert plan_step["run"] == "python scripts/close_sentinel.py plan" and plan_step["timeout-minutes"] * 60 > cs.PLAN_BUDGET_S
    assert reserve["uses"] == "actions/upload-artifact@v4" and reserve["with"]["name"] == "close-sentinel-dispatch-${{ steps.plan.outputs.session }}"
    assert reserve["with"]["if-no-files-found"] == "error" and reserve["with"]["retention-days"] == 90
    for s in (reserve, disp):
        assert "steps.plan.outputs.session != ''" in s["if"]
    assert disp["run"] == 'python scripts/close_sentinel.py dispatch --session "$SESSION"' and disp["timeout-minutes"] * 60 > cs.DISPATCH_BUDGET_S
    checkout = steps[names.index("Checkout repo")]
    assert checkout["with"]["persist-credentials"] is False


def test_the_sentinel_holds_only_two_secrets_and_writes_nothing():
    text = (WF / "close-sentinel.yml").read_text()
    import re

    assert set(re.findall(r"secrets\.([A-Z_]+)", text)) == {"GITHUB_TOKEN", "DATA_RELEASE_TOKEN"}
    for bad in ("git push", "git commit", "publish_artifacts", "gh release upload", "gh release create", "contents: write", "gh workflow run"):
        assert bad not in text, bad
    src = (ROOT / "scripts" / "close_sentinel.py").read_text()
    assert '"upload"' not in src and "release\", \"upload" not in src and "release\", \"create" not in src
    assert src.count('"workflow", "run"') == 1 and "refresh-data.yml" in src


def test_refresh_data_gains_only_the_label_and_keeps_its_schedules_group_and_memo_rule():
    doc = _load("refresh-data.yml")
    on = _on(doc)
    assert [c["cron"] for c in on["schedule"]] == ["17 11 * * *", "23 0 * * 2-6", "41 * * * *"]
    assert doc["concurrency"] == {"group": "data-write", "cancel-in-progress": False}
    assert on["workflow_dispatch"]["inputs"]["close_session"] == {
        "description": "Set by close-sentinel.yml: the NYSE session this full refresh is for (a label only; leave empty)",
        "type": "string", "default": ""}
    assert doc["run-name"] == ("${{ github.event_name == 'workflow_dispatch' && inputs.close_session != '' && "
                               "format('Refresh Data (close {0})', inputs.close_session) || 'Refresh Data' }}")
    assert cs.TITLE.format("2026-11-05") == "Refresh Data (close 2026-11-05)"
    text = (WF / "refresh-data.yml").read_text()
    assert text.count("close_session") == 3  # the input and the run-name only: no step reads it
    steps = {s["name"]: s for s in doc["jobs"]["refresh"]["steps"]}
    assert "slot == 'morning'" in steps["Dispatch the memo workflows (validated morning full refresh only)"]["if"]  # CS-2 is separate


def test_a_sentinel_dispatch_resolves_to_a_full_refresh():
    from scripts.workflow_mode import resolve

    assert resolve("workflow_dispatch", "", "full") == "full"


def test_sentinel_refreshes_make_no_earnings_calls_and_the_budgets_are_unchanged(tmp_path):
    from src.events import earnings_cache as ec
    from src.market_data import option_snapshots as osn

    env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch", "GITHUB_RUN_ATTEMPT": "1"}
    assert ec.actions_gate(env, utc(2026, 11, 5, 22, 31)) == "not a scheduled full refresh"
    assert ec.actions_gate(env, utc(2026, 11, 6, 15, 0)) == "not a scheduled full refresh"  # a mid-session catch-up too
    assert (ec.RUN_CAP, ec.DAY_CAP, ec.LATE) == (40, 80, timedelta(hours=12))
    assert osn.MAX_REQUESTS == 200
