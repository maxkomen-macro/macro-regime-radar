"""CS-2: the memo queue (scripts/memo_queue.py), design .loop/design-CS2.md v16.

Keys and coverage, the strict records, the coverage metadata, discovery against a
fake GitHub, and the memo workflow's steps (plan, reconcile, reserve, publish,
finalize, record) against real git repositories: every ledger and registry write
goes through scripts/publish_artifacts.sh with --expect, as in the workflows.
No network; the clock is fake. Synthetic databases use invented prices
(.claude/rules/test-data.md)."""

from __future__ import annotations

import hashlib
import io
import json
import sqlite3
import subprocess
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts import memo_queue as mq  # noqa: E402
from tests.test_close_sentinel import FakeClock, make_db  # noqa: E402
from tests.test_publish_artifacts import REAL_GIT, Race, _git, _identity, _write  # noqa: E402

UTC = timezone.utc
QS = date(2026, 11, 16)           # the tests' queue start: a Monday session
H64 = "ab" * 32


def utc(*a) -> datetime:
    return datetime(*a, tzinfo=UTC)


@pytest.fixture(autouse=True)
def _queue_start(monkeypatch):
    # QUEUE_START is confirmed at merge; the rules are tested from a fixed start
    monkeypatch.setattr(mq, "QUEUE_START", QS)


def test_the_configured_queue_start_is_an_nyse_session_of_a_known_year():
    from scripts.close_sentinel import calendar_known
    from src.market_data import session

    s = mq.QUEUE_START
    assert calendar_known(s) and session.is_trading_day(s)


# ── keys and coverage (design section 1) ──────────────────────────────────────


@pytest.mark.parametrize("s,close", [
    (date(2026, 11, 16), utc(2026, 11, 16, 21, 0)),    # EST
    (date(2026, 7, 1), utc(2026, 7, 1, 20, 0)),        # EDT
    (date(2026, 11, 27), utc(2026, 11, 27, 18, 0)),    # early close, the day after Thanksgiving
])
def test_a_session_counts_fifteen_minutes_after_its_close(s, close):
    assert not mq.session_done(s, close + timedelta(minutes=14, seconds=59))
    assert mq.session_done(s, close + timedelta(minutes=15))


def test_a_holiday_a_weekend_and_an_unknown_year_are_never_sessions():
    late = utc(2030, 1, 1)
    assert not mq.session_done(date(2026, 11, 26), late)          # Thanksgiving
    assert not mq.session_done(date(2026, 11, 21), late)          # Saturday
    assert not mq.session_done(date(2028, 1, 3), late)            # no 2028 calendar: fails closed
    assert mq.sessions(date(2026, 11, 23), date(2026, 11, 29)) == [
        date(2026, 11, 23), date(2026, 11, 24), date(2026, 11, 25), date(2026, 11, 27)]
    assert mq.sessions(date(2027, 12, 30), date(2028, 1, 5)) == [date(2027, 12, 30), date(2027, 12, 31)]
    assert not mq.valid_key("daily", "2028-01-03") and not mq.valid_key("daily", "2026-11-26")
    assert not mq.valid_key("daily", "2026-11-6") and mq.valid_key("daily", "2026-11-16")


def _db(tmp_path: Path, rows: dict[str, list[str]], assets: dict[str, list[str]] | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(tmp_path / "cov.db")
    conn.execute("CREATE TABLE market_daily (symbol TEXT, date TEXT, close REAL)")
    conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL)")
    for sym, ds in rows.items():
        conn.executemany("INSERT INTO market_daily VALUES (?, ?, 100.0)", [(sym, d) for d in ds])
    for sym, ds in (assets or {}).items():
        conn.executemany("INSERT INTO asset_prices VALUES (?, '1d', ?, 50.0)", [(sym, d) for d in ds])
    conn.commit()
    return conn


def test_coverage_needs_a_row_dated_exactly_the_session_for_every_symbol(tmp_path):
    t = utc(2026, 11, 17, 2, 0)
    conn = _db(tmp_path, {"SPY": ["2026-11-13", "2026-11-16"], "TLT": ["2026-11-13", "2026-11-17"]},
               {"GLD": ["2026-11-16"]})
    s = date(2026, 11, 16)
    # TLT has a row after the session but none at it: no substitution of a later (or earlier) row
    assert mq.missing_at(conn, s, ["SPY", "TLT"], ["GLD"]) == ["market_daily:TLT"]
    assert not mq.covers(conn, s, t, ["SPY", "TLT"], ["GLD"])
    assert mq.covers(conn, s, t, ["SPY"], ["GLD"])
    # a symbol with no rows at all is missing, never left out
    assert mq.missing_at(conn, s, ["SPY", "IWM"], []) == ["market_daily:IWM"]
    # a monthly asset row dated the session does not count
    conn.execute("INSERT INTO asset_prices VALUES ('USO', '1mo', '2026-11-16', 1.0)")
    assert mq.missing_at(conn, s, [], ["USO"]) == ["asset_prices:USO"]
    # before the close lag the session is not covered, whatever the rows say
    assert not mq.covers(conn, s, utc(2026, 11, 16, 21, 10), ["SPY"], ["GLD"])


def test_covered_daily_and_newest_covered(tmp_path):
    conn = _db(tmp_path, {"SPY": ["2026-11-12", "2026-11-13", "2026-11-16", "2026-11-18"]})
    t = utc(2026, 11, 19, 2, 0)          # sessions 16, 17 and 18 have closed; 17 has no row
    assert mq.covered_daily(conn, t, ["SPY"], []) == [date(2026, 11, 16), date(2026, 11, 18)]
    assert mq.newest_covered(conn, t, ["SPY"], []) == date(2026, 11, 18)
    # the weekly pin has no QUEUE_START bound: before the queue starts it still finds a session
    t2 = utc(2026, 11, 15, 12, 0)
    assert mq.covered_daily(conn, t2, ["SPY"], []) == []
    assert mq.newest_covered(conn, t2, ["SPY"], []) == date(2026, 11, 13)
    # none of the last 10 sessions covered: None
    assert mq.newest_covered(conn, utc(2026, 12, 15, 2, 0), ["SPY"], []) is None


def test_iso_week_keys_including_week_53():
    assert mq.week_key(date(2026, 11, 16)) == "2026-W47"
    assert mq.monday("2026-W53") == date(2026, 12, 28)
    assert mq.next_week("2026-W53") == "2027-W01"
    assert mq.week_key(date(2027, 1, 3)) == "2026-W53"        # a Sunday in 2027 belongs to 2026-W53
    for bad in ("2025-W53", "2026-W54", "2026-W00", "2026-W7", "2026W47", ""):
        assert not mq.valid_key("weekly", bad), bad
    assert mq.expected_weekly(date(2026, 11, 30)) == ["2026-W47", "2026-W48", "2026-W49"]
    assert mq.expected_weekly(date(2026, 11, 15)) == []


def test_hold_deadlines_and_the_close_grace_equal_the_freshness_rule():
    from api.freshness import close_grace_until

    for s in (date(2026, 11, 16), date(2026, 11, 27), date(2026, 12, 31), date(2027, 3, 12)):
        assert mq.close_grace_until(s) == close_grace_until(s)
        assert mq.hold_deadline("daily", s.isoformat()) == close_grace_until(s) + timedelta(hours=24)
    assert mq.hold_deadline("weekly", "2026-W47") == utc(2026, 11, 18, 6, 0)


def test_delayed_by_a_newer_source_or_a_completed_newer_key():
    reg = mq.empty_registry()
    k = "2026-11-16"
    assert not mq.is_delayed("daily", k, reg, utc(2026, 11, 17, 21, 14))
    assert mq.is_delayed("daily", k, reg, utc(2026, 11, 17, 21, 15))    # the 17th's close + 15 min
    reg["daily"]["2026-11-17"] = {"state": "source"}
    assert mq.is_delayed("daily", k, reg, utc(2026, 11, 17, 3, 0))
    reg["daily"]["2026-11-17"] = {"state": "blocked", "reason": "x"}
    assert not mq.is_delayed("daily", k, reg, utc(2026, 11, 17, 3, 0))
    assert not mq.is_delayed("weekly", "2026-W47", reg, utc(2026, 11, 22, 23, 59))
    assert mq.is_delayed("weekly", "2026-W47", reg, utc(2026, 11, 23, 0, 0))


# ── records (DR-66) ───────────────────────────────────────────────────────────


def test_the_initial_records_parse_and_are_canonical():
    for kind in mq.KINDS:
        assert mq.parse_ledger(kind, mq.dumps(mq.empty_ledger(kind))) == mq.empty_ledger(kind)
    assert mq.parse_registry(mq.dumps(mq.empty_registry())) == mq.empty_registry()


def test_the_committed_records_parse_and_are_canonical():
    # Until the first queued memo these files held the initial (empty) records; since
    # 2026-11-12 the workflows write them (a12237a2 claimed daily 2026-11-11), so the
    # committed bytes are whatever the queue last wrote: they must still parse under the
    # strict readers and be exactly the canonical serialization of what they hold.
    for kind in mq.KINDS:
        text = (ROOT / mq.LEDGER[kind]).read_text()
        assert text == mq.dumps(mq.parse_ledger(kind, text))
    text = (ROOT / mq.SOURCES).read_text()
    assert text == mq.dumps(mq.parse_registry(text))


def _src(**kw) -> dict:
    base = {"state": "source", "origin_run_id": 400, "origin_attempt": 1, "validated_at": "2026-11-16T23:00:00Z",
            "db_sha256": H64, "validation_sha256": H64, "pin_session": "2026-11-16", "reason": None}
    base.update(kw)
    return base


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(version=2),
    lambda r: r.update(extra=1),
    lambda r: r["daily"].update({"2026-11-26": _src()}),                       # a holiday
    lambda r: r["daily"].update({"2026-11-16": _src(state="maybe")}),
    lambda r: r["daily"].update({"2026-11-16": _src(origin_run_id=True)}),
    lambda r: r["daily"].update({"2026-11-16": _src(db_sha256="abc")}),
    lambda r: r["daily"].update({"2026-11-16": _src(validated_at="2026-11-16T23:00:00")}),
    lambda r: r["daily"].update({"2026-11-16": _src(surprise=1)}),
    lambda r: r["daily"].update({"2026-11-16": {"state": "blocked", "reason": ""}}),
    lambda r: r["weekly"].update({"2025-W53": _src()}),
])
def test_an_invalid_registry_stops(mutate):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-17"] = _src()
    assert mq.parse_registry(mq.dumps(reg))
    mutate(reg)
    with pytest.raises(mq.RecordError):
        mq.parse_registry(json.dumps(reg))
    with pytest.raises(mq.RecordError):
        mq.parse_registry("{not json")


@pytest.mark.parametrize("mutate", [
    lambda d: d.update(kind="weekly"),
    lambda d: d.update(published="2026-11-26"),
    lambda d: d["keys"].update({"2026-11-16": {"state": "done"}}),
    lambda d: d["keys"].update({"2026-11-16": {"state": "sent", "tries": -1}}),
    lambda d: d["keys"].update({"2026-11-16": {"state": "sent", "tries": True}}),
    lambda d: d["keys"].update({"2026-11-16": {"state": "sent", "overrides": {}}}),
    lambda d: d["keys"].update({"2026-11-16": {"state": "sent", "colour": "red"}}),
    lambda d: d.pop("published"),
])
def test_an_invalid_ledger_stops(mutate):
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-17"] = {**mq.new_entry(), "state": "sent", "tries": 1}
    assert mq.parse_ledger("daily", mq.dumps(led))
    mutate(led)
    with pytest.raises(mq.RecordError):
        mq.parse_ledger("daily", json.dumps(led))


# ── coverage metadata (section 2a, DR-61) ─────────────────────────────────────


def meta(run_id=400, attempt=1, started=utc(2026, 11, 16, 22, 30), validated=utc(2026, 11, 16, 23, 0),
         covered=(date(2026, 11, 16),), newest=date(2026, 11, 16), ineligible=False, db=H64, val=H64) -> mq.Meta:
    return mq.Meta(run_id, attempt, started, validated, tuple(covered), newest, ineligible, db, val)


def test_metadata_round_trips_and_rejects_anything_else():
    m = meta()
    assert mq.parse_meta(mq.format_meta(m)) == m
    late = meta(covered=(), newest=None, ineligible=True)
    assert "ineligible=late-rerun" in mq.format_meta(late) and mq.parse_meta(mq.format_meta(late)) == late
    good = mq.format_meta(m)
    for bad in (good.replace("mode=full", "mode=news-only"), good + "run_id=1\n", good.replace("run_attempt=1", "run_attempt=0"),
                good.replace(H64, "abc", 1), good.replace("2026-11-16T23:00:00Z", "2026-11-16T23:00:00"),
                good.replace("newest_covered=2026-11-16\n", ""),
                mq.format_meta(late).replace("covered_daily=", "covered_daily=2026-11-16")):
        with pytest.raises(ValueError):
            mq.parse_meta(bad)


def test_build_meta_records_coverage_and_marks_a_late_rerun_ineligible(tmp_path):
    db = make_db(tmp_path / "m.db", {"SPY": "2026-11-16"}, {"GLD": "2026-11-16"})
    val = tmp_path / "validation.json"
    val.write_text('{"verdict": "pass"}')
    v = utc(2026, 11, 17, 2, 0)
    m = mq.build_meta(db, val, 9, 1, utc(2026, 11, 17, 0, 30), v, utc(2026, 11, 17, 0, 23), ["SPY"], ["GLD"])
    assert m.covered_daily == (date(2026, 11, 16),) and m.newest_covered == date(2026, 11, 16) and not m.ineligible
    assert m.db_sha256 == hashlib.sha256(db.read_bytes()).hexdigest()
    created = v - mq.ELIGIBLE_AFTER_CREATE - timedelta(seconds=1)
    late = mq.build_meta(db, val, 9, 2, v, v, created, ["SPY"], ["GLD"])
    assert late.ineligible and late.covered_daily == () and late.newest_covered is None


# ── the GitHub listing: complete or nothing (section 3) ──────────────────────


class GhRunner:
    """A fake `gh api` over a scripted listing; counts calls."""

    def __init__(self, pages: list[dict], fail_first: int = 0):
        self.pages, self.calls, self.fail_first = pages, [], fail_first

    def __call__(self, args, env=None, capture_output=True, text=True, timeout=None):
        self.calls.append(args)
        if self.fail_first:
            self.fail_first -= 1
            return subprocess.CompletedProcess(args, 1, "", "HTTP 502")
        page = int(next(a.split("=", 1)[1] for a in args if a.startswith("page=")))
        return subprocess.CompletedProcess(args, 0, json.dumps(self.pages[page - 1]), "")


def _api(runner, max_requests=mq.MAX_REQUESTS) -> mq.Api:
    clock = FakeClock(utc(2026, 11, 17))
    return mq.Api({"GITHUB_REPOSITORY": "o/r"}, mq.Budget(clock, 600), runner, max_requests)


def _runs(n0, n):
    return [{"id": i} for i in range(n0, n0 + n)]


def test_a_listing_is_read_to_its_total_count():
    pages = [{"total_count": 230, "workflow_runs": _runs(0, 100)}, {"total_count": 230, "workflow_runs": _runs(100, 100)},
             {"total_count": 230, "workflow_runs": _runs(200, 30)}]
    got = _api(GhRunner(pages)).pages("p", {}, "workflow_runs")
    assert [r["id"] for r in got] == list(range(230))


def test_a_short_page_a_cap_or_too_many_requests_is_incomplete():
    short = [{"total_count": 230, "workflow_runs": _runs(0, 100)}, {"total_count": 230, "workflow_runs": _runs(100, 99)}]
    with pytest.raises(mq.Incomplete, match="short page"):
        _api(GhRunner(short)).pages("p", {}, "workflow_runs")
    over = [{"total_count": 1001, "workflow_runs": _runs(0, 100)}]
    with pytest.raises(mq.Incomplete, match="more than the 1000"):
        _api(GhRunner(over)).runs_on_day(date(2026, 11, 16))
    full = [{"total_count": 230, "workflow_runs": _runs(0, 100)}] * 3
    with pytest.raises(mq.Incomplete, match="GitHub requests"):
        _api(GhRunner(full), max_requests=2).pages("p", {}, "workflow_runs")
    with pytest.raises(mq.Incomplete, match="malformed"):
        _api(GhRunner([{"workflow_runs": []}])).pages("p", {}, "workflow_runs")


def test_a_failed_call_is_tried_three_times_and_the_day_listing_is_main_only():
    r = GhRunner([{"total_count": 1, "workflow_runs": _runs(0, 1)}], fail_first=2)
    assert len(_api(r).runs_on_day(date(2026, 11, 16))) == 1 and len(r.calls) == 3
    assert "created=2026-11-16T00:00:00Z..2026-11-16T23:59:59Z" in r.calls[-1] and "branch=main" in r.calls[-1]
    with pytest.raises(mq.GhError, match="3 tries"):
        _api(GhRunner([], fail_first=3)).get("p")


# ── discovery against a fake GitHub (section 3, DR-53, DR-55, DR-72) ─────────


def zbytes(files: dict[str, bytes | str]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


class FakeApi:
    def __init__(self):
        self.runs: dict[int, dict] = {}
        self.attempts: dict[tuple[int, int], dict] = {}
        self.jobs: dict[tuple[int, int], list] = {}
        self.artifacts: list[dict] = []
        self.zips: dict[int, bytes] = {}
        self.requests = 0
        self.dispatched: list = []
        self._next = 1000

    def add_run(self, rid, created, updated, attempts=1, status="completed", conclusion="success", head_sha="c" * 40):
        self.runs[rid] = {"id": rid, "run_attempt": attempts, "status": status, "conclusion": conclusion,
                          "created_at": mq.iso(created), "updated_at": mq.iso(updated), "head_sha": head_sha}

    def add_artifact(self, run_id, name, files, created, expired=False) -> dict:
        self._next += 1
        a = {"id": self._next, "name": name, "workflow_run": {"id": run_id}, "created_at": mq.iso(created), "expired": expired}
        self.artifacts.append(a)
        self.zips[a["id"]] = zbytes(files)
        return a

    def add_meta(self, m: mq.Meta, created=None):
        return self.add_artifact(m.run_id, f"validated-meta-{m.attempt}", {"validated-meta.txt": mq.format_meta(m)},
                                 created or m.validated_at + timedelta(minutes=1))

    def add_db(self, m: mq.Meta, db: bytes, expired=False, held: mq.Meta | None = None):
        return self.add_artifact(m.run_id, "validated-db", {"refresh-meta.txt": mq.format_meta(held or m),
                                                            "macro_radar.db": db, "validation.json": "{}"},
                                 m.validated_at + timedelta(minutes=1), expired)

    def runs_on_day(self, d):
        self.requests += 1
        return [r for r in self.runs.values() if mq.ts(r["created_at"]).date() == d]

    def artifacts_named(self, name):
        self.requests += 1
        return [a for a in self.artifacts if a["name"] == name]

    def run_artifacts(self, run_id, name):
        self.requests += 1
        return [a for a in self.artifacts if a["name"] == name and a["workflow_run"]["id"] == run_id]

    def attempt(self, run_id, n):
        return self.attempts[(run_id, n)]

    def attempt_jobs(self, run_id, n):
        if (run_id, n) not in self.jobs:
            raise mq.GhError(f"no jobs for {run_id}/{n}")
        return self.jobs[(run_id, n)]

    def run(self, run_id):
        return self.runs[run_id]

    def artifact_zip(self, artifact_id):
        return zipfile.ZipFile(io.BytesIO(self.zips[artifact_id]))

    def dispatch(self, workflow, inputs):
        self.dispatched.append((workflow, inputs))


class FakeStore:
    def __init__(self, code: dict[str, bool] | None = None):
        self.code = code or {}

    def has_code(self, sha):
        return self.code.get(sha, True)


def refresh_job(rid, n, started, val_start, rec_done, rec_conclusion="success", status="completed",
                marker="success", legacy=False):
    """A refresh job's record. CS-2: "Record the validation time" runs from val_start to val_start + 5 s
    (skipped when marker is "skipped": not a passing full run); legacy: no such step."""
    steps = [{"name": mq.VALIDATE_STEP, "started_at": mq.iso(val_start)}]
    if not legacy:
        steps.append({"name": mq.VALIDATED_STEP, "conclusion": marker, "started_at": mq.iso(val_start),
                      "completed_at": mq.iso(val_start + timedelta(seconds=5))})
    steps.append({"name": mq.RECORD_STEP, "conclusion": rec_conclusion, "completed_at": mq.iso(rec_done)})
    return [{"name": "refresh", "run_id": rid, "run_attempt": n, "status": status, "started_at": mq.iso(started),
             "steps": steps}]


DB400, DB500 = b"invented db 400", b"invented db 500"


def _scenario():
    """Run 400 (started Monday 2026-11-16 22:30, validated 23:00) and this run 500 (validated
    the 17th 02:00) both cover the 16th; 400 is first."""
    api = FakeApi()
    m400 = meta(400, db=hashlib.sha256(DB400).hexdigest(), newest=date(2026, 11, 16))
    own = meta(500, started=utc(2026, 11, 17, 0, 30), validated=utc(2026, 11, 17, 2, 0),
               db=hashlib.sha256(DB500).hexdigest())
    api.add_run(400, utc(2026, 11, 16, 22, 25), utc(2026, 11, 16, 23, 10))
    api.add_run(500, utc(2026, 11, 17, 0, 25), utc(2026, 11, 17, 2, 5), status="in_progress", conclusion=None)
    api.add_meta(m400)
    api.add_meta(own)
    api.add_db(m400, DB400)
    api.add_db(own, DB500)
    return api, m400, own


def test_the_first_validated_attempt_that_covers_a_key_is_its_source():
    api, m400, own = _scenario()
    now = utc(2026, 11, 17, 2, 10)
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16, 0, 0), now)
    assert [(m.run_id, m.attempt) for m in got.metas] == [(400, 1), (500, 1)] and got.unknown == []
    rec = mq.decide_key("daily", "2026-11-16", got, api, own)
    assert rec == mq._source(m400, date(2026, 11, 16))
    wk = mq.decide_key("weekly", "2026-W47", got, api, own)     # 400's job started on Monday the 16th
    assert wk["state"] == "source" and wk["origin_run_id"] == 400 and wk["pin_session"] == "2026-11-16"
    assert mq.decide_key("daily", "2026-11-17", got, api, own) is None       # not covered yet: unresolved


def test_an_earlier_validated_attempt_without_metadata_blocks_the_key():
    api, m400, own = _scenario()
    legacy = "d" * 40
    api.add_run(300, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 40), head_sha=legacy)
    api.jobs[(300, 1)] = refresh_job(300, 1, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 0), utc(2026, 11, 16, 22, 5),
                                     legacy=True)
    got = mq.discover(api, FakeStore({legacy: False}), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert [(u.run_id, u.attempt) for u in got.unknown] == [(300, 1)]
    rec = mq.decide_key("daily", "2026-11-16", got, api, own)
    assert rec["state"] == "blocked" and "run 300 attempt 1" in rec["reason"]
    assert mq.decide_key("weekly", "2026-W47", got, api, own)["state"] == "blocked"
    # the same attempt validated before the close cannot have covered the 16th: no block
    api.jobs[(300, 1)] = refresh_job(300, 1, utc(2026, 11, 16, 20, 0), utc(2026, 11, 16, 20, 30), utc(2026, 11, 16, 21, 10),
                                     legacy=True)
    got = mq.discover(api, FakeStore({legacy: False}), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert mq.decide_key("daily", "2026-11-16", got, api, own)["origin_run_id"] == 400


def test_an_unknown_attempt_after_the_first_source_does_not_block():
    api, m400, own = _scenario()
    api.add_run(450, utc(2026, 11, 16, 23, 30), utc(2026, 11, 17, 0, 40), conclusion="failure")
    api.jobs[(450, 1)] = refresh_job(450, 1, utc(2026, 11, 16, 23, 30), utc(2026, 11, 17, 0, 0), utc(2026, 11, 17, 0, 5))
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert [(u.run_id, u.attempt) for u in got.unknown] == [(450, 1)]   # a failed CS-2 attempt that recorded no metadata
    assert mq.decide_key("daily", "2026-11-16", got, api, own)["origin_run_id"] == 400


@pytest.mark.parametrize("rec", ["failure", "cancelled", "skipped"])
def test_a_validated_attempt_whose_metadata_was_not_recorded_blocks_the_keys_it_may_cover(rec):
    # S-1: validation is established by "Record the validation time", not by the metadata step
    api, m400, own = _scenario()
    api.add_run(300, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 40), conclusion="failure")
    api.jobs[(300, 1)] = refresh_job(300, 1, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 0),
                                     utc(2026, 11, 16, 22, 5), rec_conclusion=rec)
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert [(u.run_id, u.attempt) for u in got.unknown] == [(300, 1)]
    u = got.unknown[0]
    assert (u.validated_lo, u.validated_hi) == (utc(2026, 11, 16, 22, 0), utc(2026, 11, 16, 22, 0, 5))
    rec_ = mq.decide_key("daily", "2026-11-16", got, api, own)
    assert rec_["state"] == "blocked" and "run 300 attempt 1" in rec_["reason"]


@pytest.mark.parametrize("legacy", [False, True])
def test_an_attempt_that_did_not_validate_is_not_a_candidate(legacy):
    api, m400, own = _scenario()
    api.add_run(300, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 40), conclusion="failure", head_sha="d" * 40)
    api.jobs[(300, 1)] = refresh_job(300, 1, utc(2026, 11, 16, 21, 30), utc(2026, 11, 16, 22, 0),
                                     utc(2026, 11, 16, 22, 5), rec_conclusion="skipped", marker="skipped", legacy=legacy)
    got = mq.discover(api, FakeStore({"d" * 40: not legacy}), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert got.unknown == []


def test_the_step_names_the_queue_reads_exist_in_the_workflows():
    import yaml

    wf = ROOT / ".github" / "workflows"
    refresh = yaml.safe_load((wf / "refresh-data.yml").read_text())["jobs"]
    assert mq.REFRESH_JOB in refresh
    names = [s["name"] for s in refresh[mq.REFRESH_JOB]["steps"]]
    for n in (mq.VALIDATE_STEP, mq.VALIDATED_STEP, mq.RECORD_STEP):
        assert names.count(n) == 1, n
    marker = next(s for s in refresh[mq.REFRESH_JOB]["steps"] if s["name"] == mq.VALIDATED_STEP)
    assert marker["if"] == "steps.mode.outputs.mode == 'full' && steps.validate.outputs.verdict == 'pass'"
    assert "continue-on-error" not in marker
    for kind in mq.KINDS:
        jobs = yaml.safe_load((wf / mq.MEMO_WORKFLOW[kind]).read_text())["jobs"]
        assert list(jobs) == [mq.MEMO_JOB]
        names = [s["name"] for s in jobs[mq.MEMO_JOB]["steps"]]
        assert names.count(mq.PLAN_STEP) == 1 and names.count(mq.SEND_STEP) == 1


def test_a_running_attempt_or_an_expired_or_mismatched_metadata_makes_discovery_incomplete():
    api, m400, own = _scenario()
    api.add_run(460, utc(2026, 11, 17, 0, 0), utc(2026, 11, 17, 1, 0), status="in_progress", conclusion=None)
    with pytest.raises(mq.Incomplete, match="in progress"):
        mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    api.runs[460]["status"] = "queued"          # queued: it has validated nothing yet
    mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))

    api, m400, own = _scenario()
    next(a for a in api.artifacts if a["name"] == "validated-meta-1" and a["workflow_run"]["id"] == 400)["expired"] = True
    with pytest.raises(mq.Incomplete, match="expired"):
        mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))

    api, m400, own = _scenario()
    api.artifacts = [a for a in api.artifacts if not (a["name"] == "validated-meta-1" and a["workflow_run"]["id"] == 400)]
    api.add_artifact(400, "validated-meta-1", {"validated-meta.txt": mq.format_meta(meta(401))}, utc(2026, 11, 16, 23, 1))
    with pytest.raises(mq.Incomplete, match="names run 401"):
        mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))


def test_metadata_uploaded_before_the_lower_bound_is_skipped_unread():
    api, m400, own = _scenario()
    old = meta(200, started=utc(2026, 11, 14), validated=utc(2026, 11, 14, 1), covered=(), newest=date(2026, 11, 13))
    api.add_run(200, utc(2026, 11, 14), utc(2026, 11, 14, 2))
    a = api.add_meta(old)
    del api.zips[a["id"]]                       # never downloaded
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert 200 not in [m.run_id for m in got.metas]


def test_an_ineligible_late_rerun_never_covers():
    api, m400, own = _scenario()
    api.artifacts = [a for a in api.artifacts if a["workflow_run"]["id"] != 400]
    late = meta(400, attempt=2, covered=(), newest=None, ineligible=True)
    api.runs[400]["run_attempt"] = 2
    api.attempts[(400, 1)] = {"status": "completed", "conclusion": "failure"}
    api.jobs[(400, 1)] = refresh_job(400, 1, utc(2026, 11, 16, 22, 30), utc(2026, 11, 16, 22, 50),
                                     utc(2026, 11, 16, 22, 55), rec_conclusion="skipped", marker="skipped")
    api.add_meta(late)
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert mq.decide_key("daily", "2026-11-16", got, api, own)["origin_run_id"] == 500


def test_bytes_that_expired_or_belong_to_another_attempt_block_the_key():
    api, m400, own = _scenario()
    next(a for a in api.artifacts if a["name"] == "validated-db" and a["workflow_run"]["id"] == 400)["expired"] = True
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    rec = mq.decide_key("daily", "2026-11-16", got, api, own)
    assert rec["state"] == "blocked" and "expired" in rec["reason"] and rec["origin_run_id"] == 400

    api, m400, own = _scenario()        # the run's validated-db was overwritten by a later attempt
    api.artifacts = [a for a in api.artifacts if not (a["name"] == "validated-db" and a["workflow_run"]["id"] == 400)]
    api.add_db(m400, DB400, held=meta(400, attempt=2))
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert "not retained" in mq.decide_key("daily", "2026-11-16", got, api, own)["reason"]

    api, m400, own = _scenario()        # same attempt, other bytes
    api.artifacts = [a for a in api.artifacts if not (a["name"] == "validated-db" and a["workflow_run"]["id"] == 400)]
    api.add_db(m400, b"other bytes")
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert "not retained" in mq.decide_key("daily", "2026-11-16", got, api, own)["reason"]
    assert mq.bytes_state(api, own, own) == "usable"


def test_a_weekly_key_with_no_covered_session_in_the_last_ten_is_blocked():
    api, m400, own = _scenario()
    api.artifacts = [a for a in api.artifacts if not (a["name"] == "validated-meta-1" and a["workflow_run"]["id"] == 400)]
    api.add_meta(meta(400, covered=(), newest=None, db=hashlib.sha256(DB400).hexdigest()))
    got = mq.discover(api, FakeStore(), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    assert "no covered session" in mq.decide_key("weekly", "2026-W47", got, api, own)["reason"]


# ── real git: the registry and the ledgers on a fresh main ────────────────────

pytestmark_git = pytest.mark.skipif(REAL_GIT is None, reason="needs git")


class Repo:
    """origin (bare) with the publisher and the initial records; `root` is the job's checkout."""

    def __init__(self, tmp: Path, ledger: dict | None = None, registry: dict | None = None, kind="daily"):
        tmp.mkdir(parents=True, exist_ok=True)
        self.race = Race(tmp)
        self.env = self.race.env
        self.kind = kind
        self.seed({mq.LEDGER["daily"]: mq.dumps(ledger if kind == "daily" and ledger else mq.empty_ledger("daily")),
                   mq.LEDGER["weekly"]: mq.dumps(ledger if kind == "weekly" and ledger else mq.empty_ledger("weekly")),
                   mq.SOURCES: mq.dumps(registry or mq.empty_registry())})
        self.race.checkout_runner()
        self.root = self.race.runner
        _identity(self.root, self.env)
        self.before_publish = None

    def seed(self, files: dict[str, str], message="seed") -> None:
        dev = self.race.dev
        _git(dev, "pull", "--quiet", "--ff-only", "origin", "main", env=self.env)
        for rel, text in files.items():
            _write(dev, rel, text)
            _git(dev, "add", "--", rel, env=self.env)
        _git(dev, "commit", "--quiet", "-m", message, env=self.env)
        _git(dev, "push", "--quiet", "origin", "main", env=self.env)

    def runner(self, cmd, **kw):
        if cmd[:2] == ["bash", "scripts/publish_artifacts.sh"] and self.before_publish:
            hook, self.before_publish = self.before_publish, None
            hook()
        kw.pop("env", None)
        return subprocess.run(cmd, env=self.env, **kw)

    def store(self) -> mq.Store:
        return mq.Store(self.root, self.runner)

    def main_text(self, rel: str) -> str:
        return _git(self.race.origin, "show", f"main:{rel}", env=self.env)

    def ledger(self) -> dict:
        return json.loads(self.main_text(mq.LEDGER[self.kind]))

    def tip(self) -> str:
        return self.race.tip()


@pytestmark_git
def test_a_missing_record_is_an_error_never_empty(tmp_path):
    repo = Repo(tmp_path)
    store = repo.store()
    store.fetch()
    with pytest.raises(mq.RecordError, match="restore it from git history"):
        store.read("docs/memo/ledger-nothing.json")
    text, blob = store.read(mq.SOURCES)
    assert mq.parse_registry(text) == mq.empty_registry() and len(blob) == 40


@pytestmark_git
def test_has_code_tells_a_cs2_run_from_a_legacy_one(tmp_path):
    repo = Repo(tmp_path)
    store = repo.store()
    legacy = repo.tip()
    repo.seed({"scripts/memo_queue.py": "# CS-2\n"}, "CS-2")
    store.fetch()
    cs2 = _git(repo.root, "rev-parse", "origin/main", env=repo.env)
    assert store.has_code(cs2) is True and store.has_code(legacy) is False
    with pytest.raises(mq.Incomplete):
        store.has_code("0" * 40)          # not in the clone: never a guess
    with pytest.raises(mq.Incomplete):
        store.has_code("")


@pytestmark_git
def test_run_sources_writes_new_decisions_once_and_never_changes_a_record(tmp_path):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-17"] = {"state": "blocked", "reason": "set earlier"}
    repo = Repo(tmp_path, registry=reg)
    api, m400, own = _scenario()
    own = meta(500, started=utc(2026, 11, 18, 0, 30), validated=utc(2026, 11, 18, 2, 0),
               covered=(date(2026, 11, 16), date(2026, 11, 17)), newest=date(2026, 11, 17),
               db=hashlib.sha256(DB500).hexdigest())
    api.artifacts = [a for a in api.artifacts if a["workflow_run"]["id"] != 500]
    api.add_meta(own)
    decided = mq.run_sources(api, repo.store(), own, utc(2026, 11, 18, 2, 10))
    assert set(decided["daily"]) == {"2026-11-16"} and decided["daily"]["2026-11-16"]["origin_run_id"] == 400
    assert set(decided["weekly"]) == {"2026-W47"}
    stored = mq.parse_registry(repo.main_text(mq.SOURCES))
    assert stored["daily"]["2026-11-17"] == {"state": "blocked", "reason": "set earlier"}
    assert stored["daily"]["2026-11-16"] == mq._source(m400, date(2026, 11, 16))
    tip = repo.tip()
    assert mq.run_sources(api, repo.store(), own, utc(2026, 11, 18, 2, 20)) == {} and repo.tip() == tip


@pytestmark_git
def test_run_sources_stops_when_the_registry_changed_under_it(tmp_path):
    repo = Repo(tmp_path)
    api, m400, own = _scenario()
    owner = mq.empty_registry()
    owner["daily"]["2026-11-16"] = {"state": "blocked", "reason": "owner abandoned it"}
    repo.before_publish = lambda: repo.seed({mq.SOURCES: mq.dumps(owner)}, "owner PR")
    with pytest.raises(mq.CasConflict):
        mq.run_sources(api, repo.store(), own, utc(2026, 11, 17, 2, 10))
    assert mq.parse_registry(repo.main_text(mq.SOURCES)) == owner


# ── the plan walk (section 4) ────────────────────────────────────────────────


def _ctx(repo: Repo, api: FakeApi, now: datetime, run_id=900, attempt=1, kind="daily") -> mq.Ctx:
    return mq.Ctx(kind, run_id, attempt, api, repo.store(), FakeClock(now), {})


def _fresh(api: FakeApi, origin_run_id: int, expired=False):
    api.add_artifact(origin_run_id, "validated-db", {"refresh-meta.txt": "x"}, utc(2026, 11, 16), expired)


def _src_at(rid: int, validated: datetime, pin: str) -> dict:
    return _src(origin_run_id=rid, validated_at=mq.iso(validated), pin_session=pin)


@pytestmark_git
def test_a_key_without_a_source_holds_the_queue_and_writes_nothing(tmp_path):
    repo = Repo(tmp_path)
    tip = repo.tip()
    p = mq.run_plan(_ctx(repo, FakeApi(), utc(2026, 11, 17, 3, 0)), "123", "")
    assert not p.go and "2026-11-16: holding" in p.log[-1] and repo.tip() == tip


@pytestmark_git
def test_an_uncovered_key_is_skipped_only_after_its_hold_deadline_and_a_newer_source(tmp_path):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-17"] = _src_at(41, utc(2026, 11, 18, 2, 0), "2026-11-17")
    repo = Repo(tmp_path, registry=reg)
    api = FakeApi()
    _fresh(api, 41)
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 5, 59)), "w", "")      # before the 16th's deadline
    assert not p.go and "holding" in p.log[-1]
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 6, 0)), "w", "")
    assert p.go and p.key == "2026-11-17" and p.source["origin_run_id"] == 41 and p.mode == "auto"
    led = repo.ledger()
    assert led["keys"]["2026-11-16"]["state"] == "skipped"
    e = led["keys"]["2026-11-17"]
    assert (e["state"], e["tries"], e["memo_run_id"], e["run_attempt"]) == ("attempt", 1, 900, 1)
    assert e["output_artifact"] == "memo-outcome-daily-2026-11-17-900-1" and e["source"] == reg["daily"]["2026-11-17"]
    assert p.delayed is False                       # nothing newer than the 17th has closed at 06:00 on the 18th


@pytestmark_git
def test_blocked_failed_and_expired_keys_are_closed_and_the_walk_moves_on(tmp_path):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = {"state": "blocked", "reason": "coverage lost"}
    reg["daily"]["2026-11-17"] = _src_at(41, utc(2026, 11, 18, 2, 0), "2026-11-17")
    reg["daily"]["2026-11-18"] = _src_at(42, utc(2026, 11, 19, 2, 0), "2026-11-18")
    reg["daily"]["2026-11-19"] = _src_at(43, utc(2026, 11, 20, 2, 0), "2026-11-19")
    reg["daily"]["2026-11-20"] = _src_at(44, utc(2026, 11, 21, 2, 0), "2026-11-20")
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-17"] = {**mq.new_entry(), "state": "not_sent", "tries": 3}
    repo = Repo(tmp_path, ledger=led, registry=reg)
    api = FakeApi()
    _fresh(api, 42, expired=True)
    _fresh(api, 43)
    _fresh(api, 44)
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 21, 3, 0)), "w", "")
    led = repo.ledger()["keys"]
    assert led["2026-11-16"]["state"] == "blocked" and led["2026-11-16"]["note"] == "coverage lost"
    assert led["2026-11-17"]["state"] == "failed"
    assert led["2026-11-18"]["state"] == "skipped" and led["2026-11-18"]["note"] == "source expired"
    assert p.go and p.key == "2026-11-19" and p.alarm and p.more and p.delayed
    assert "2026-11-20" not in led


@pytestmark_git
def test_a_source_past_its_retention_is_expired_without_asking(tmp_path):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")
    repo = Repo(tmp_path, registry=reg)
    api = FakeApi()
    _fresh(api, 41)
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 20, 2, 0)), "w", "")
    assert not p.go and repo.ledger()["keys"]["2026-11-16"]["note"] == "source expired"


def _sending(rid=77, n=1, tries=1, state="sending") -> dict:
    return {**mq.new_entry(), "state": state, "tries": tries, "memo_run_id": rid, "run_attempt": n,
            "source": _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")}


def _memo_job(rid, n, plan="success", send_status="completed", send_conclusion="success", status="completed"):
    steps = [{"name": mq.PLAN_STEP, "status": "completed", "conclusion": plan}]
    if send_status is not None:
        steps.append({"name": mq.SEND_STEP, "status": send_status, "conclusion": send_conclusion})
    return [{"name": mq.MEMO_JOB, "run_id": rid, "run_attempt": n, "status": status, "steps": steps}]


def _reconcile_repo(tmp_path, entry):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")
    reg["daily"]["2026-11-17"] = _src_at(42, utc(2026, 11, 18, 2, 0), "2026-11-17")
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-16"] = entry
    api = FakeApi()
    _fresh(api, 41)
    _fresh(api, 42)
    return Repo(tmp_path, ledger=led, registry=reg), api


@pytestmark_git
def test_reconcile_reads_the_outcome_artifact_first(tmp_path):
    repo, api = _reconcile_repo(tmp_path, _sending())
    api.add_artifact(77, "memo-outcome-daily-2026-11-16-77-1", {"outcome.json": json.dumps({"state": "sent"})},
                     utc(2026, 11, 17, 3))
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 3, 0)), "w", "")
    led = repo.ledger()["keys"]
    assert led["2026-11-16"]["state"] == "sent" and "reconciled from" in led["2026-11-16"]["note"]
    assert p.go and p.key == "2026-11-17" and not p.alarm


@pytestmark_git
def test_a_skipped_send_step_is_not_sent_and_the_key_is_retried(tmp_path):
    repo, api = _reconcile_repo(tmp_path, _sending())
    api.jobs[(77, 1)] = _memo_job(77, 1, send_conclusion="skipped")
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 17, 4, 0)), "w", "")
    e = repo.ledger()["keys"]["2026-11-16"]
    assert p.go and p.key == "2026-11-16" and e["state"] == "attempt" and e["tries"] == 2 and e["memo_run_id"] == 900


@pytestmark_git
@pytest.mark.parametrize("conclusion", ["failure", "cancelled", None])
def test_a_send_step_that_may_have_reached_smtp_is_ambiguous_and_never_resent(tmp_path, conclusion):
    repo, api = _reconcile_repo(tmp_path, _sending())
    api.jobs[(77, 1)] = _memo_job(77, 1, send_conclusion=conclusion)
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 3, 0)), "w", "")
    assert repo.ledger()["keys"]["2026-11-16"]["state"] == "ambiguous"
    assert p.alarm and p.key == "2026-11-17"


@pytestmark_git
@pytest.mark.parametrize("case", ["running", "own", "no-plan", "jobs-unreadable", "no-run"])
def test_an_execution_that_cannot_be_established_stops_the_walk_with_nothing_written(tmp_path, case):
    entry = _sending(rid=900 if case == "own" else 77)
    if case == "no-run":
        entry["memo_run_id"] = None
    repo, api = _reconcile_repo(tmp_path, entry)
    if case == "running":
        api.jobs[(77, 1)] = _memo_job(77, 1, send_status="in_progress", send_conclusion=None, status="in_progress")
    elif case == "no-plan":
        api.jobs[(77, 1)] = _memo_job(77, 1, plan="failure")
    tip = repo.tip()
    with pytest.raises(mq.Unknown):
        mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 3, 0)), "w", "")
    assert repo.tip() == tip


@pytestmark_git
def test_the_claim_stops_when_the_ledger_changed_under_it(tmp_path):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")
    repo = Repo(tmp_path, registry=reg)
    api = FakeApi()
    _fresh(api, 41)
    owner = mq.empty_ledger("daily")
    owner["keys"]["2026-11-16"] = {**mq.new_entry(), "state": "skipped", "note": "abandoned by the owner"}
    repo.before_publish = lambda: repo.seed({mq.LEDGER["daily"]: mq.dumps(owner)}, "owner PR")
    with pytest.raises(mq.CasConflict):
        mq.run_plan(_ctx(repo, api, utc(2026, 11, 17, 3, 0)), "w", "")
    assert repo.ledger() == owner
    # the next run reads the owner's entry and moves on
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 17, 3, 5), run_id=901), "w", "")
    assert not p.go and repo.ledger() == owner


@pytestmark_git
def test_a_resend_needs_a_terminal_entry_and_a_live_source(tmp_path):
    repo, api = _reconcile_repo(tmp_path, _sending())
    ctx = _ctx(repo, api, utc(2026, 11, 17, 4, 0))
    with pytest.raises(mq.QueueError, match="only a terminal entry"):
        mq.run_plan(ctx, "", "2026-11-16")
    with pytest.raises(mq.QueueError, match="either wake or resend_key"):
        mq.run_plan(ctx, "w", "2026-11-16")
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-16"] = {**_sending(), "state": "ambiguous"}
    repo.seed({mq.LEDGER["daily"]: mq.dumps(led)})
    tip = repo.tip()
    p = mq.run_plan(ctx, "", "2026-11-16")
    assert p.go and p.mode == "resend" and p.key == "2026-11-16" and repo.tip() == tip
    with pytest.raises(mq.QueueError, match="has expired"):
        mq.run_plan(_ctx(repo, api, utc(2026, 11, 20, 3, 0)), "", "2026-11-16")
    with pytest.raises(mq.QueueError, match="not a daily key"):
        mq.run_plan(ctx, "", "2026-11-26")


@pytestmark_git
def test_weekly_keys_walk_by_monday(tmp_path):
    reg = mq.empty_registry()
    reg["weekly"]["2026-W48"] = _src_at(41, utc(2026, 11, 23, 2, 0), "2026-11-20")
    repo = Repo(tmp_path, registry=reg, kind="weekly")
    api = FakeApi()
    _fresh(api, 41)
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 18, 5, 59), kind="weekly"), "w", "")
    assert not p.go and "2026-W47: holding" in p.log[-1]
    p = mq.run_plan(_ctx(repo, api, utc(2026, 11, 23, 3, 0), kind="weekly"), "w", "")
    assert p.go and p.key == "2026-W48" and repo.ledger()["keys"]["2026-W47"]["state"] == "skipped"


# ── reserve, publish, finalize, record (sections 4-7, DR-12, DR-57, DR-65, DR-73) ──


@pytest.fixture()
def outdirs(tmp_path, monkeypatch):
    bundle, final, outcome = tmp_path / "bundle", tmp_path / "final", tmp_path / "outcome"
    monkeypatch.setattr(mq, "BUNDLE", bundle)
    monkeypatch.setattr(mq, "FINAL", final)
    monkeypatch.setattr(mq, "OUTCOME_DIR", outcome)
    return bundle, final, outcome


def write_bundle(bundle: Path, kind: str, key: str) -> None:
    bundle.mkdir(parents=True, exist_ok=True)
    (bundle / "meta.json").write_text(json.dumps({"kind": kind, "key": key}))
    for v in ("normal", "delayed"):
        (bundle / f"page-{v}.html").write_text(f"<p>{v} page {key} sent __MEMO_SENT_DATE__</p>")
        (bundle / f"email-{v}.html").write_text(f"<p>{v} email {key}</p>")
        (bundle / f"subject-{v}.txt").write_text(("[Delayed] " if v == "delayed" else "") + f"Briefing {key}\n")


def _claimed(tmp_path, outdirs, now=utc(2026, 11, 17, 3, 0), ledger=None):
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")
    repo = Repo(tmp_path / "git", ledger=ledger, registry=reg)
    api = FakeApi()
    _fresh(api, 41)
    ctx = _ctx(repo, api, now)
    p = mq.run_plan(ctx, "w", "")
    assert p.go and p.key == "2026-11-16"
    write_bundle(outdirs[0], "daily", "2026-11-16")
    return repo, ctx


def _send(final: Path, state: str) -> None:
    final.mkdir(parents=True, exist_ok=True)
    (final / "outcome.json").write_text(json.dumps({"state": state, "detail": f"smtp {state}"}))


@pytestmark_git
def test_one_on_time_memo_end_to_end(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    repo, ctx = _claimed(tmp_path, outdirs)
    assert mq.run_reserve(ctx, "2026-11-16", "auto") == "paid"
    assert repo.ledger()["keys"]["2026-11-16"]["paid_generation"]["run"] == 900
    assert mq.run_reserve(ctx, "2026-11-16", "auto") == "unavailable"     # one paid generation per key
    r = mq.run_publish(ctx, "2026-11-16", "auto")
    assert r == {"variant": "normal", "page": True}
    led = repo.ledger()
    assert led["published"] == "2026-11-16" and led["keys"]["2026-11-16"]["state"] == "sending"
    assert repo.main_text(mq.PAGE["daily"]) == "<p>normal page 2026-11-16 sent 2026-11-17</p>"
    assert mq.run_finalize(ctx, "2026-11-16") == {"variant": "normal", "republish": False}
    assert (final / "subject.txt").read_text() == "Briefing 2026-11-16\n"
    assert (final / "daily_memo.html").read_text() == (final / "page.html").read_text()
    email = (final / "email.html").read_text()
    assert email.endswith("<p>normal email 2026-11-16</p>") and mq.PAGE_URL["daily"] in email
    _send(final, "sent")
    out = mq.write_outcome("daily", "2026-11-16", 900, 1, "success", ctx.clock.now())
    assert out["state"] == "sent" and json.loads((outcome / "outcome.json").read_text())["variant"] == "normal"
    assert mq.run_record(ctx, "2026-11-16", "auto") == {"state": "sent", "terminal": True}
    assert repo.ledger()["keys"]["2026-11-16"]["state"] == "sent"


@pytestmark_git
def test_checkpoint_three_switches_to_the_delayed_version_and_republishes_the_page(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    repo, ctx = _claimed(tmp_path, outdirs)
    mq.run_reserve(ctx, "2026-11-16", "auto")
    mq.run_publish(ctx, "2026-11-16", "auto")
    ctx.clock.t = (utc(2026, 11, 17, 21, 15) - utc(2026, 11, 17, 3, 0)).total_seconds()   # the 17th has closed
    assert mq.run_finalize(ctx, "2026-11-16") == {"variant": "delayed", "republish": True}
    assert (final / "subject.txt").read_text().startswith("[Delayed] ")
    _send(final, "sent")
    mq.write_outcome("daily", "2026-11-16", 900, 1, "success", ctx.clock.now())
    mq.run_record(ctx, "2026-11-16", "auto")
    assert repo.main_text(mq.PAGE["daily"]) == "<p>delayed page 2026-11-16 sent 2026-11-17</p>"
    # a later checkpoint never reverts to the on-time version
    ctx.clock.t = 0
    assert mq.choose_variant(False) == "delayed"


@pytestmark_git
def test_a_delayed_key_gets_no_paid_commentary(tmp_path, outdirs):
    repo, ctx = _claimed(tmp_path, outdirs, now=utc(2026, 11, 17, 22, 0))
    assert mq.run_reserve(ctx, "2026-11-16", "auto") == "omitted"
    assert repo.ledger()["keys"]["2026-11-16"]["paid_generation"] is None
    assert mq.run_publish(ctx, "2026-11-16", "auto")["variant"] == "delayed"


@pytestmark_git
def test_an_older_key_never_replaces_a_newer_page(tmp_path, outdirs):
    led = mq.empty_ledger("daily")
    led["published"] = "2026-11-17"
    repo, ctx = _claimed(tmp_path, outdirs, ledger=led)
    page_before = None
    try:
        page_before = repo.main_text(mq.PAGE["daily"])
    except subprocess.CalledProcessError:
        pass
    r = mq.run_publish(ctx, "2026-11-16", "auto")
    assert r["page"] is False and repo.ledger()["published"] == "2026-11-17"
    try:
        after = repo.main_text(mq.PAGE["daily"])
    except subprocess.CalledProcessError:
        after = None
    assert after == page_before


@pytestmark_git
def test_a_third_refusal_is_failed_and_a_missing_outcome_is_ambiguous(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-16"] = {**mq.new_entry(), "state": "not_sent", "tries": 2}
    repo, ctx = _claimed(tmp_path, outdirs, ledger=led)
    assert repo.ledger()["keys"]["2026-11-16"]["tries"] == 3
    mq.run_publish(ctx, "2026-11-16", "auto")
    mq.run_finalize(ctx, "2026-11-16")
    _send(final, "not_sent")
    mq.write_outcome("daily", "2026-11-16", 900, 1, "failure", ctx.clock.now())
    assert mq.run_record(ctx, "2026-11-16", "auto") == {"state": "failed", "terminal": True}
    (final / "outcome.json").unlink()
    out = mq.write_outcome("daily", "2026-11-16", 900, 1, "failure", ctx.clock.now())
    assert out["state"] == "ambiguous" and "no outcome written" in out["detail"]


@pytestmark_git
def test_a_record_for_an_entry_this_run_no_longer_holds_stops(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    repo, ctx = _claimed(tmp_path, outdirs)
    mq.run_publish(ctx, "2026-11-16", "auto")
    owner = repo.ledger()
    owner["keys"]["2026-11-16"].update(state="skipped", note="owner")
    repo.seed({mq.LEDGER["daily"]: mq.dumps(owner)})
    _send(final, "sent")
    mq.write_outcome("daily", "2026-11-16", 900, 1, "success", ctx.clock.now())
    with pytest.raises(mq.QueueError, match="outcome artifact records it"):
        mq.run_record(ctx, "2026-11-16", "auto")
    assert repo.ledger() == owner


@pytestmark_git
def test_an_owner_resend_appends_an_override_and_leaves_the_state(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    reg = mq.empty_registry()
    reg["daily"]["2026-11-16"] = _src_at(41, utc(2026, 11, 17, 2, 0), "2026-11-16")
    led = mq.empty_ledger("daily")
    led["keys"]["2026-11-16"] = {**_sending(), "state": "ambiguous"}
    repo = Repo(tmp_path / "git", ledger=led, registry=reg)
    api = FakeApi()
    _fresh(api, 41)
    ctx = _ctx(repo, api, utc(2026, 11, 17, 4, 0), run_id=950)
    write_bundle(bundle, "daily", "2026-11-16")
    assert mq.run_plan(ctx, "", "2026-11-16").mode == "resend"
    assert mq.run_reserve(ctx, "2026-11-16", "resend") == "paid"
    mq.run_publish(ctx, "2026-11-16", "resend")
    mq.run_finalize(ctx, "2026-11-16")
    _send(final, "sent")
    mq.write_outcome("daily", "2026-11-16", 950, 1, "success", ctx.clock.now())
    assert mq.run_record(ctx, "2026-11-16", "resend")["state"] == "sent"
    e = repo.ledger()["keys"]["2026-11-16"]
    assert e["state"] == "ambiguous" and e["overrides"][-1]["state"] == "sent" and e["overrides"][-1]["run"] == 950


@pytestmark_git
def test_a_bundle_for_another_key_is_refused(tmp_path, outdirs):
    repo, ctx = _claimed(tmp_path, outdirs)
    write_bundle(outdirs[0], "daily", "2026-11-17")
    with pytest.raises(mq.QueueError, match="bundle is for"):
        mq.run_publish(ctx, "2026-11-16", "auto")


# ── the CLI's step outputs ────────────────────────────────────────────────────


def test_verify_compares_both_hashes(tmp_path):
    db, val = tmp_path / "db", tmp_path / "v.json"
    db.write_bytes(b"x")
    val.write_bytes(b"y")
    good = [hashlib.sha256(b"x").hexdigest(), hashlib.sha256(b"y").hexdigest()]
    base = ["verify", "--db", str(db), "--validation", str(val)]
    assert mq.main([*base, "--db-sha256", good[0], "--validation-sha256", good[1]], env={}) == 0
    assert mq.main([*base, "--db-sha256", good[0], "--validation-sha256", good[0]], env={}) == 1


def test_queue_writes_only_through_the_publisher():
    src = (ROOT / "scripts" / "memo_queue.py").read_text()
    for banned in ('"commit"', '"push"', "reset --soft", '"stash"', '"rebase"'):
        assert banned not in src, banned
    assert src.count('"scripts/publish_artifacts.sh"') == 1 and '"--expect"' in src
    assert "DATA_RELEASE_TOKEN" in src and "release" not in src.replace("DATA_RELEASE_TOKEN", "").replace("re-release", "")


# ── round 2 (S-3, S-4) ────────────────────────────────────────────────────────


def test_metadata_records_the_refresh_jobs_start_the_rule_discovery_uses(tmp_path, monkeypatch):
    # S-3: a job that starts Monday 23:59:50 and records Tuesday is a Monday job, with or without metadata
    db = tmp_path / "m.db"
    db.write_bytes(b"x")
    make_db(tmp_path / "rows.db", {"SPY": "2026-11-16"}, {"GLD": "2026-11-16"})
    db.write_bytes((tmp_path / "rows.db").read_bytes())
    val = tmp_path / "v.json"
    val.write_text("{}")
    api = FakeApi()
    api.add_run(610, utc(2026, 11, 16, 23, 59), utc(2026, 11, 17, 0, 30), status="in_progress", conclusion=None)
    api.jobs[(610, 1)] = [{"name": "refresh", "run_id": 610, "run_attempt": 1, "status": "in_progress",
                           "started_at": "2026-11-16T23:59:50Z", "steps": []}]
    monkeypatch.setattr(mq, "market_symbols", lambda: ["SPY"])
    monkeypatch.setattr(mq, "asset_symbols", lambda: ["GLD"])
    m = mq.run_meta(api, {"GITHUB_RUN_ID": "610", "GITHUB_RUN_ATTEMPT": "1"}, db, val, "2026-11-17T00:00:20Z",
                    tmp_path / "a" / "refresh-meta.txt", tmp_path / "b" / "validated-meta.txt")
    assert m.started_at == utc(2026, 11, 16, 23, 59, 50)
    assert mq.parse_meta((tmp_path / "b" / "validated-meta.txt").read_text()) == m
    own = meta(611, started=utc(2026, 11, 17, 0, 30), validated=utc(2026, 11, 17, 2, 0))
    rec = mq.decide_key("weekly", "2026-W47", mq.Discovery([m, own], []), FakeApiBytes(m, db.read_bytes()), own)
    assert rec["state"] == "source" and rec["origin_run_id"] == 610
    # and an attempt without metadata is judged by the same field
    u = mq.UnknownAttempt(610, 1, utc(2026, 11, 16, 23, 59, 50), utc(2026, 11, 17), utc(2026, 11, 17, 0, 0, 20))
    assert u.eligible("weekly", "2026-W47") and not u.eligible("weekly", "2026-W48")
    # a job listing that names no refresh job stops the step
    api.jobs[(610, 1)] = []
    with pytest.raises(mq.QueueError, match="cannot identify"):
        mq.run_meta(api, {"GITHUB_RUN_ID": "610", "GITHUB_RUN_ATTEMPT": "1"}, db, val, "2026-11-17T00:00:20Z",
                    tmp_path / "a" / "refresh-meta.txt", tmp_path / "b" / "validated-meta.txt")


class FakeApiBytes(FakeApi):
    """validated-db of attempt m holding the bytes m.db_sha256 names."""

    def __init__(self, m: mq.Meta, db: bytes):
        super().__init__()
        assert hashlib.sha256(db).hexdigest() == m.db_sha256
        self.add_artifact(m.run_id, "validated-db", {"refresh-meta.txt": mq.format_meta(m), "macro_radar.db": db},
                          m.validated_at)


@pytestmark_git
def test_the_sent_date_is_the_send_date_and_the_page_follows_it_across_midnight(tmp_path, outdirs):
    # S-4, S-6: published at 23:59:50, finalized and sent after midnight: the email and the page both say
    # the 18th, the day it is sent
    bundle, final, outcome = outdirs
    repo, ctx = _claimed(tmp_path, outdirs, now=utc(2026, 11, 17, 23, 59, 50))   # delayed: the 17th has closed
    mq.run_reserve(ctx, "2026-11-16", "auto")
    assert mq.run_publish(ctx, "2026-11-16", "auto")["variant"] == "delayed"
    assert repo.main_text(mq.PAGE["daily"]) == "<p>delayed page 2026-11-16 sent 2026-11-17</p>"
    ctx.clock.t = 20
    assert mq.run_finalize(ctx, "2026-11-16") == {"variant": "delayed", "republish": True}
    assert (final / "page.html").read_text() == "<p>delayed page 2026-11-16 sent 2026-11-18</p>"
    _send(final, "sent")
    mq.write_outcome("daily", "2026-11-16", 900, 1, "success", ctx.clock.now())
    mq.run_record(ctx, "2026-11-16", "auto")
    assert repo.main_text(mq.PAGE["daily"]) == "<p>delayed page 2026-11-16 sent 2026-11-18</p>"


@pytestmark_git
def test_an_unchanged_page_is_not_republished_and_an_older_key_never_is(tmp_path, outdirs):
    bundle, final, outcome = outdirs
    repo, ctx = _claimed(tmp_path, outdirs, now=utc(2026, 11, 17, 23, 0))
    mq.run_publish(ctx, "2026-11-16", "auto")
    assert mq.run_finalize(ctx, "2026-11-16")["republish"] is False
    led = mq.empty_ledger("daily")
    led["published"] = "2026-11-17"
    import shutil
    shutil.rmtree(final)                      # a new job: a fresh output/memo-final
    repo2, ctx2 = _claimed(tmp_path / "older", outdirs, ledger=led, now=utc(2026, 11, 17, 23, 59, 50))
    assert mq.run_publish(ctx2, "2026-11-16", "auto")["page"] is False
    ctx2.clock.t = 20
    assert mq.run_finalize(ctx2, "2026-11-16")["republish"] is False


@pytest.mark.parametrize("val_start,blocks", [
    (utc(2026, 11, 16, 22, 31), False),         # validated wholly after created + 31 days: ineligible, ignored
    (utc(2026, 11, 16, 22, 29, 58), True),      # bounds straddle the cutoff: still uncertain, blocks
    (utc(2026, 11, 16, 22, 0), True),           # before the cutoff: an earlier validation with lost coverage
])
def test_an_attempt_without_metadata_validated_after_the_31_day_cutoff_hides_nothing(val_start, blocks):
    # S-5: the creation cutoff applies to attempts without metadata too, by their validation bounds; each case
    # validates before run 400 (23:00), so only the cutoff decides whether it hides an earlier coverage
    api, m400, own = _scenario()
    legacy = "e" * 40
    created = utc(2026, 11, 16, 22, 30) - mq.ELIGIBLE_AFTER_CREATE      # cutoff: 2026-11-16 22:30
    api.add_run(290, created, val_start + timedelta(minutes=10), attempts=2, head_sha=legacy)
    api.attempts[(290, 1)] = {"status": "completed", "conclusion": "failure"}
    api.jobs[(290, 1)] = []                                             # the first attempt never started its job
    api.jobs[(290, 2)] = refresh_job(290, 2, val_start - timedelta(minutes=30), val_start,
                                     val_start + timedelta(minutes=1), legacy=True)
    got = mq.discover(api, FakeStore({legacy: False}), own, utc(2026, 11, 16), utc(2026, 11, 17, 2, 10))
    rec = mq.decide_key("daily", "2026-11-16", got, api, own)
    if blocks:
        assert rec["state"] == "blocked" and "run 290 attempt 2" in rec["reason"]
    else:
        assert got.unknown == [] and rec["state"] == "source" and rec["origin_run_id"] == 400
