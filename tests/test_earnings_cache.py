"""The earnings cache's refresh step (src/events/earnings_cache.py run_cache; design EC section 1).

Pinned here, against a fake Finnhub at the HTTP layer with synthetic rows and an injected clock: the plan of
calls (18 forward windows, then the 7-day lookback), the pace and the 60 s gap, the slow pace after a 429, the
splits of a reply of 1,000 rows or more and their checks (R1, R3), a capped day, every run outcome (R5), the
cross-check, the call caps (40 a run, 80 a UTC day, no call on another UTC date), the trading-hours skip and the
stop when trading hours begin, the 10-hour spacing, the absolute limit on each call and on the run, the
GitHub Actions gate (scheduled first attempts of the two full crons only), the reservation written before any
call, the vault's key handling, and the public line: counts only, never a symbol, a date, a key or a URL.

No test touches the network or data/macro_radar.db; every row is synthetic (tickers like ZQA0, never real).
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

from src.events import earnings_store as store

NOW = datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc)  # Wednesday 22:00 in New York
TODAY = date(2026, 10, 28)  # its New York date
TOKEN = "fh-TESTONLY-7c2d0e-DO-NOT-LOG"
SECRET = "vault-TESTONLY-91ab-DO-NOT-LOG"
TAPE = [("AAPL", 10), ("NVDA", 40)]  # the stored finnhub_earnings rows the cross-check reads


@pytest.fixture
def mod():
    from src.events import earnings_cache

    return earnings_cache


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("unexpected network call")

    monkeypatch.setattr(requests, "get", refuse)
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.delenv("EARNINGS_CACHE_KEY", raising=False)


@pytest.fixture
def db(tmp_path):
    from src.migrate import ensure_event_calendar_schema

    path = tmp_path / "store.db"
    conn = sqlite3.connect(path)
    ensure_event_calendar_schema(conn)
    conn.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)",
                     [(f"{s} earnings", f"{(TODAY + timedelta(days=d)).isoformat()}T20:30:00Z", "medium",
                       "finnhub_earnings", "2026-10-01T00:00:00", s, "earnings") for s, d in TAPE])
    conn.commit()
    conn.close()
    return path


def sym(n: int) -> str:
    return f"ZQ{chr(65 + n // 260 % 26)}{chr(65 + n // 10 % 26)}{n % 10}"


def market(extra_per_day: dict[int, int] | None = None, drop=(), extra=()):
    """One synthetic name a day from day -7 to day 119 (labelled, actual figures on past days), the tape names'
    reports, `extra_per_day` more names on given days."""
    out = []
    for n in range(-7, 120):
        d = (TODAY + timedelta(days=n)).isoformat()
        row = {"symbol": sym(n + 7), "date": d, "hour": "amc", "year": 2026, "quarter": 3}
        if n < 0:
            row["epsActual"] = 1.25
        out.append(row)
        for i in range((extra_per_day or {}).get(n, 0)):
            out.append({"symbol": sym(1000 + n * 3000 + i), "date": d, "hour": "", "year": 2026, "quarter": 3})
    out += [{"symbol": s, "date": (TODAY + timedelta(days=d)).isoformat(), "hour": "amc", "year": 2027, "quarter": 1}
            for s, d in TAPE]
    out = [r for r in out if (r["symbol"], r["date"]) not in set(drop)]
    return out + list(extra)


class Resp:
    def __init__(self, status, payload=None, chunks=None, clock=None, step=0.0):
        self.status_code = status
        self._body = json.dumps(payload if payload is not None else {}).encode()
        self._chunks = chunks
        self._clock, self._step = clock, step
        self.closed = False

    def iter_content(self, n):
        parts = self._chunks if self._chunks is not None else [self._body[i:i + n] for i in range(0, len(self._body), n)]
        for p in parts:
            if self._clock is not None:
                self._clock.advance(self._step)
            yield p

    def close(self):
        self.closed = True


class Clock:
    def __init__(self, t: datetime):
        self.t = t

    def __call__(self):
        return self.t

    def advance(self, s: float):
        self.t += timedelta(seconds=s)


class Finnhub:
    """Answers each call from the master list. `fail_at`: {call number: status}; `cap`: rows per reply at most;
    `raw`: {call number: Resp}; `omit`: {call number: symbols left out of that reply}."""

    def __init__(self, rows, clock, fail_at=None, cap=None, raw=None, omit=None, alter=None):
        self.rows, self.clock = rows, clock
        self.fail_at, self.cap, self.raw, self.omit = fail_at or {}, cap, raw or {}, omit or {}
        self.alter = alter or {}  # {call number: function of that reply's rows}
        self.calls = []

    def __call__(self, url, params=None, timeout=None, stream=False):
        assert "symbol" not in params, "the step asks for the whole market"
        assert params["token"] == TOKEN and stream is True
        assert isinstance(timeout, tuple) and 0 < timeout[0] <= 15.0
        self.calls.append((params["from"], params["to"], self.clock()))
        n = len(self.calls)
        if n in self.fail_at:
            return Resp(self.fail_at[n], {"error": "limit"})
        if n in self.raw:
            return self.raw[n]
        items = [r for r in self.rows if not _iso(r) or params["from"] <= r["date"] <= params["to"]]  # bad rows ride along
        items = [r for r in items if r["symbol"] not in self.omit.get(n, ())]
        if n in self.alter:
            items = self.alter[n]([dict(r) for r in items])
        if self.cap is not None:
            items = items[: self.cap]
        return Resp(200, {"earningsCalendar": items})


def _iso(row) -> bool:
    try:
        date.fromisoformat(str(row.get("date"))[:10])
    except (AttributeError, ValueError):
        return False
    return True


def run(mod, db, fake=None, *, clock=None, now=NOW, env=None, cache_key=SECRET, **kw):
    clock = clock or Clock(now)
    fake = fake if fake is not None else Finnhub(market(), clock)
    if isinstance(fake, Finnhub):
        fake.clock = clock
    sleeps = []

    def sleep(s):
        sleeps.append(s)
        clock.advance(s)

    res = mod.run_cache(db, now=clock(), get=fake, sleep=sleep, clock=clock, api_key=TOKEN, cache_key=cache_key,
                        env=env if env is not None else {}, **kw)
    return res, fake, sleeps, clock


def vault_of(db, secret=SECRET):
    conn = sqlite3.connect(db)
    try:
        return store.open_vault(conn, secret)
    finally:
        conn.close()


def table_rows(db, table):
    conn = sqlite3.connect(db)
    try:
        return conn.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall()
    finally:
        conn.close()


# ── a passing run ────────────────────────────────────────────────────────────

def test_a_passing_run_asks_18_windows_then_the_lookback_and_writes_only_the_vault(mod, db):
    before = table_rows(db, "event_calendar")
    res, fake, sleeps, _ = run(mod, db)
    assert res.status == "passing", res.line
    assert len(fake.calls) == 19
    assert fake.calls[0][:2] == (TODAY.isoformat(), (TODAY + timedelta(days=6)).isoformat())
    assert fake.calls[17][:2] == ((TODAY + timedelta(days=119)).isoformat(),) * 2
    assert fake.calls[18][:2] == ((TODAY - timedelta(days=7)).isoformat(), (TODAY - timedelta(days=1)).isoformat())
    assert sleeps == [60.0] + [6.0] * 18
    assert table_rows(db, "event_calendar") == before
    v = vault_of(db)
    assert v.status == "ok"
    assert len(v.vault["days"]) == 127 and all(len(e) == 1 for e in v.vault["days"].values())
    assert [r["status"] for r in v.vault["runs"]] == ["passing"]
    assert v.vault["runs"][0]["calls_by_utc_date"] == {NOW.date().isoformat(): 19}


def test_the_public_line_and_the_database_file_carry_no_symbol_date_or_key(mod, db):
    res, _, _, _ = run(mod, db)
    assert "passing" in res.line and "calls 19" in res.line and "cross-check 2 of 2" in res.line
    for secret in (TOKEN, SECRET, "ZQ", "AAPL", "2026-", "finnhub.io"):
        assert secret not in res.line
    raw = db.read_bytes()
    assert b"ZQA" not in raw and SECRET.encode() not in raw and TOKEN.encode() not in raw


def test_reported_figures_from_a_passing_run_are_kept_with_their_label(mod, db):
    run(mod, db)
    occ = vault_of(db).vault["occ"]
    past = occ[f"{sym(0)}|{(TODAY - timedelta(days=7)).isoformat()}"]
    assert past["labels"] == [[2026, 3]] and past["reported"] == [[2026, 3]]
    future = occ[f"{sym(17)}|{(TODAY + timedelta(days=10)).isoformat()}"]
    assert future["reported"] == []


# ── splits (R1, R3) ──────────────────────────────────────────────────────────

def test_a_reply_of_1000_rows_is_asked_again_as_halves_down_to_single_days(mod, db):
    rows = market({2: 999, 4: 400})  # days 0-6: 7 + 999 + 400 rows
    res, fake, _, _ = run(mod, db, Finnhub(rows, None))
    spans = [(c[0], c[1]) for c in fake.calls[:8]]
    d = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
    # days 0-6 hold 1,406 rows; 0-2 hold 1,002; 1-2 hold 1,001; day 2 alone 1,000 (one day is never split)
    assert spans == [(d(0), d(6)), (d(0), d(2)), (d(0), d(0)), (d(1), d(2)), (d(1), d(1)), (d(2), d(2)),
                     (d(3), d(6)), (d(7), d(13))]
    assert res.status == "passing", res.line
    assert "windows split 3" in res.line and "split checks passed 3" in res.line and "split checks failed 0" in res.line


def test_halves_that_differ_from_their_whole_make_the_run_inconsistent_and_keep_the_parent_row(mod, db):
    rows = market({3: 1200})
    stray = sym(1000 + 3 * 3000 + 5)
    res, fake, _, _ = run(mod, db, Finnhub(rows, None, omit={2: {stray}, 3: {stray}}))
    assert res.status == "inconsistent", res.line
    assert "split checks failed 1" in res.line or "split checks failed 2" in res.line
    occ = vault_of(db).vault["occ"]
    assert f"{stray}|{(TODAY + timedelta(days=3)).isoformat()}" in occ  # R5: additions always count (DR-02)
    entry = vault_of(db).vault["days"][(TODAY + timedelta(days=3)).isoformat()][0]
    assert entry["status"] == "inconsistent"


@pytest.mark.parametrize("change", ["hour", "label", "reported", "duplicate"])
def test_halves_that_list_the_same_names_with_other_fields_fail_the_split_check(mod, db, change):
    """S-3: the check compares whole rows (symbol, date, release time, fiscal label, reported figures, and how
    many times each appears), not only the (symbol, date) pairs."""
    rows = market({3: 1200})
    stray = sym(1000 + 3 * 3000 + 5)

    def alter(items):
        for r in items:
            if r["symbol"] == stray:
                if change == "hour":
                    r["hour"] = "bmo"
                elif change == "label":
                    r["quarter"] = 4
                elif change == "reported":
                    r["epsActual"] = 0.5
        return items + ([dict(next(r for r in items if r["symbol"] == stray))] if change == "duplicate" else [])

    res, fake, _, _ = run(mod, db, Finnhub(rows, None, alter={3: alter}))
    assert res.status == "inconsistent", res.line
    assert "split checks failed 0" not in res.line
    same, _, _, _ = run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    assert "split checks failed 0" in same.line


def test_a_single_day_at_1500_rows_is_capped_and_the_run_is_partial(mod, db):
    rows = market({5: 1600})
    res, _, _, _ = run(mod, db, Finnhub(rows, None, cap=1500))
    assert res.status == "partial" and "capped days 1" in res.line
    entry = vault_of(db).vault["days"][(TODAY + timedelta(days=5)).isoformat()][0]
    assert entry["complete"] is False


# ── stops (R5) ───────────────────────────────────────────────────────────────

def test_a_429_stops_at_once_and_the_next_run_paces_at_5_a_minute(mod, db):
    res, fake, sleeps, clock = run(mod, db, Finnhub(market(), None, fail_at={5: 429}))
    assert len(fake.calls) == 5 and res.status == "partial" and "stopped: HTTP 429" in res.line
    assert vault_of(db).vault["runs"][-1]["saw_429"] is True
    later = Clock(NOW + timedelta(hours=20))
    _, _, sleeps2, _ = run(mod, db, clock=later)
    assert sleeps2[1:3] == [12.0, 12.0]


def _reconciled_market():
    """market() plus one name with a reported Q3 on day -3, Q4 on day 4 and Q1 2027 on day 60."""
    d = lambda n: (TODAY + timedelta(days=n)).isoformat()  # noqa: E731
    return market(extra=[{"symbol": "ZQZZ9", "date": d(-3), "hour": "amc", "year": 2026, "quarter": 3, "epsActual": 1.0},
                         {"symbol": "ZQZZ9", "date": d(4), "hour": "amc", "year": 2026, "quarter": 4},
                         {"symbol": "ZQZZ9", "date": d(60), "hour": "amc", "year": 2027, "quarter": 1}])


@pytest.mark.parametrize("fail_at", [1, 2])
def test_a_failed_request_withdraws_what_older_reads_established_for_its_window(mod, db, fail_at):
    """S-1 (R5): two passing runs reconcile ZQZZ9; a newer run whose request for a window got no answer leaves
    that window's days unconfirmed (and the windows it answered, as a non-passing run, too), while the windows
    it never asked keep the older reads."""
    rows = _reconciled_market()
    run(mod, db, Finnhub(rows, None))
    run(mod, db, Finnhub(rows, None), clock=Clock(NOW + timedelta(hours=20)))
    later = NOW + timedelta(hours=44)  # Thursday 18:00 in New York
    session = TODAY + timedelta(days=2)
    v = vault_of(db).vault
    before = store.coverage(v, store.index(v)["ZQZZ9"], session, later)
    assert before.state == "reconciled" and before.through == TODAY + timedelta(days=60)
    res, fake, _, _ = run(mod, db, Finnhub(rows, None, fail_at={fail_at: 429}), clock=Clock(later))
    # the second case answered one window with no tape date to cross-check, so it is inconsistent, not partial
    assert len(fake.calls) == fail_at and res.status == ("failed" if fail_at == 1 else "inconsistent"), res.line
    v = vault_of(db).vault
    after = store.coverage(v, store.index(v)["ZQZZ9"], session, later)
    assert after.state == "unconfirmed" and store.contested(v, session)
    asked_through = session + timedelta(days=7 * fail_at - 1)  # the asked windows end here
    assert not any(store.day_stable(v, session + timedelta(days=n), later) for n in range(7 * fail_at))
    assert store.day_stable(v, asked_through + timedelta(days=1), later)  # never asked: the older reads stand


def test_a_network_error_reports_its_type_only(mod, db):
    def boom(url, params=None, timeout=None, stream=False):
        raise requests.ConnectionError(f"https://finnhub.io/api/v1/calendar/earnings?token={params['token']}")

    res, _, _, _ = run(mod, db, boom)
    assert res.status == "failed" and "ConnectionError" in res.line and TOKEN not in res.line


def test_a_run_that_reaches_40_calls_stops_as_partial(mod, db):
    rows = market({n: 1000 for n in range(0, 120, 2)})
    res, fake, _, _ = run(mod, db, Finnhub(rows, None))
    assert len(fake.calls) == 40 and res.status == "partial" and "stopped: call cap" in res.line


def test_the_daily_cap_counts_every_run_charged_to_the_utc_date(mod, db):
    run(mod, db)
    conn = sqlite3.connect(db)
    opened = store.open_vault(conn, SECRET)
    opened.vault["runs"][0]["calls_by_utc_date"] = {NOW.date().isoformat(): 75}
    opened.vault["runs"][0]["status"] = "partial"  # no spacing skip
    store.write_vault(conn, opened.vault, SECRET, NOW)
    conn.close()
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=1)))
    assert len(fake.calls) == 5 and "stopped: daily call cap" in res.line


def test_no_call_is_sent_on_another_utc_date(mod, db):
    start = datetime(2026, 10, 29, 23, 58, 30, tzinfo=timezone.utc)  # 19:58 in New York
    res, fake, _, _ = run(mod, db, clock=Clock(start))  # calls at 23:59:30, :36, :42, :48, :54; the next is 00:00:00
    assert len(fake.calls) == 5 and fake.calls[-1][2].date() == start.date() and "stopped: UTC date changed" in res.line


def test_a_run_never_starts_a_call_past_8_minutes(mod, db):
    clock = Clock(NOW)

    fake = Finnhub(market({2: 999, 9: 999}), clock)

    def lagging(url, params=None, timeout=None, stream=False):
        clock.advance(14)  # each answer takes 14 s, under the 15 s call limit: 23 calls need about 9 minutes
        return fake(url, params, timeout, stream)

    res, _, _, _ = run(mod, db, lagging, clock=clock)
    assert res.status == "partial" and "stopped: time limit" in res.line
    assert clock() <= NOW + timedelta(minutes=9)


def test_a_reply_that_drips_past_its_limit_is_abandoned(mod, db):
    clock = Clock(NOW)
    drip = Resp(200, chunks=[b"{"] * 100, clock=clock, step=1.0)
    res, _, _, _ = run(mod, db, Finnhub(market(), clock, raw={1: drip}), clock=clock)
    assert res.status == "failed" and "stopped: time limit" in res.line and drip.closed


def test_a_reply_over_4_mb_is_abandoned(mod, db):
    big = Resp(200, chunks=[b" " * (1024 * 1024)] * 5)
    res, _, _, _ = run(mod, db, Finnhub(market(), None, raw={1: big}))
    assert "stopped: reply too large" in res.line


# ── outcomes and the cross-check ─────────────────────────────────────────────

def test_a_missed_tape_date_makes_the_run_inconsistent(mod, db):
    drop = [("NVDA", (TODAY + timedelta(days=40)).isoformat())]
    res, _, _, _ = run(mod, db, Finnhub(market(drop=drop), None))
    assert res.status == "inconsistent" and "cross-check 1 of 2" in res.line


def test_nothing_to_compare_never_passes(mod, tmp_path):
    from src.migrate import ensure_event_calendar_schema

    path = tmp_path / "empty.db"
    conn = sqlite3.connect(path)
    ensure_event_calendar_schema(conn)
    conn.commit()
    conn.close()
    res, _, _, _ = run(mod, path)
    assert res.status == "inconsistent" and "cross-check 0 of 0" in res.line


def test_a_malformed_row_makes_the_run_inconsistent(mod, db):
    res, _, _, _ = run(mod, db, Finnhub(market(extra=[{"symbol": "ZQZZ9", "date": "soon"}]), None))
    assert res.status == "inconsistent"


def test_a_reported_figure_from_a_non_passing_run_is_never_an_anchor(mod, db):
    drop = [("NVDA", (TODAY + timedelta(days=40)).isoformat())]
    run(mod, db, Finnhub(market(drop=drop), None))
    past = vault_of(db).vault["occ"][f"{sym(0)}|{(TODAY - timedelta(days=7)).isoformat()}"]
    assert past["reported"] == []


# ── guards ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("utc", [datetime(2026, 10, 29, 13, 0), datetime(2026, 10, 29, 20, 59)])
def test_trading_hours_skip_without_a_call(mod, db, utc):
    res, fake, _, _ = run(mod, db, clock=Clock(utc.replace(tzinfo=timezone.utc)))
    assert res.status == "skipped" and "US trading hours" in res.line and not fake.calls


def test_a_run_whose_first_call_would_fall_in_trading_hours_stops(mod, db):
    start = datetime(2026, 10, 29, 12, 59, 30, tzinfo=timezone.utc)  # 08:59:30 in New York; +60 s gap
    res, fake, _, _ = run(mod, db, clock=Clock(start))
    assert not fake.calls and res.status == "failed" and "stopped: US trading hours" in res.line


def test_a_passing_run_less_than_10_hours_ago_skips(mod, db):
    run(mod, db)
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=9)))
    assert res.status == "skipped" and "10 hours" in res.line and not fake.calls


def test_missing_keys_skip_without_writing(mod, db):
    res = mod.run_cache(db, now=NOW, get=Finnhub(market(), Clock(NOW)), sleep=lambda s: None, api_key="",
                        cache_key=SECRET, env={})
    assert res.line.endswith("no Finnhub key") and not res.wrote
    res = mod.run_cache(db, now=NOW, get=Finnhub(market(), Clock(NOW)), sleep=lambda s: None, api_key=TOKEN,
                        cache_key="", env={})
    assert res.line.endswith("no cache key") and not res.wrote
    assert vault_of(db).status == "absent"


def test_a_rotated_key_starts_a_fresh_vault_and_a_corrupt_blob_is_never_overwritten(mod, db):
    run(mod, db)
    res, _, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=20)), cache_key="another-TESTONLY-key")
    assert "new vault: rotated" in res.line
    conn = sqlite3.connect(db)
    conn.execute(f"UPDATE {store.TABLE} SET blob = X'00'")
    conn.commit()
    conn.close()
    before = table_rows(db, store.TABLE)
    res, fake, _, _ = run(mod, db, clock=Clock(NOW + timedelta(hours=40)), cache_key="another-TESTONLY-key")
    assert "the vault does not open" in res.line and not fake.calls and table_rows(db, store.TABLE) == before


def test_the_reservation_is_written_before_the_first_call(mod, db):
    seen = {}

    class Peek(Finnhub):
        def __call__(self, url, params=None, timeout=None, stream=False):
            if not self.calls:
                seen["runs"] = vault_of(db).vault["runs"]
            return super().__call__(url, params, timeout, stream)

    run(mod, db, Peek(market(), None))
    assert seen["runs"][-1]["reason"] == "interrupted" and seen["runs"][-1]["calls_by_utc_date"] == {NOW.date().isoformat(): 40}


# ── the GitHub Actions gate (design EC 1.1a) ─────────────────────────────────

def _env(tmp_path, event="schedule", cron="23 0 * * 2-6", attempt="1"):
    p = tmp_path / "event.json"
    p.write_text(json.dumps({"schedule": cron}))
    return {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": event, "GITHUB_RUN_ATTEMPT": attempt, "GITHUB_EVENT_PATH": str(p)}


@pytest.mark.parametrize("kw, reason", [
    ({"event": "workflow_dispatch"}, "not a scheduled full refresh"),
    ({"attempt": "2"}, "not a scheduled full refresh"),
    ({"cron": "41 * * * *"}, "not a scheduled full refresh"),
    ({"cron": "17 11 * * *"}, "started too late"),  # 02:00 UTC is 14 h 43 min after the 11:17 slot
])
def test_in_actions_only_a_timely_scheduled_first_attempt_calls(mod, db, tmp_path, kw, reason):
    res, fake, _, _ = run(mod, db, env=_env(tmp_path, **kw))
    assert res.status == "skipped" and reason in res.line and not fake.calls


def test_in_actions_the_0023_slot_calls(mod, db, tmp_path):
    res, fake, _, _ = run(mod, db, env=_env(tmp_path))  # Thursday 02:00 UTC, 1 h 37 min after Thursday's 00:23
    assert res.status == "passing" and len(fake.calls) == 19


def test_the_full_crons_match_the_workflow_modes():
    import importlib.util
    from pathlib import Path

    from src.events import earnings_cache

    spec = importlib.util.spec_from_file_location("wm", Path(__file__).resolve().parent.parent / "scripts/workflow_mode.py")
    wm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wm)
    assert set(earnings_cache.FULL_CRONS) == {c for c, m in wm.SCHEDULE_MODES.items() if m == "full"}


def test_the_step_never_raises_and_exits_0(mod, db, monkeypatch, capsys):
    monkeypatch.setattr(mod, "run_cache", lambda *a, **k: (_ for _ in ()).throw(RuntimeError(f"token={TOKEN}")))
    assert mod.main(["--db", str(db)], now=NOW) == 0
    out = capsys.readouterr().out
    assert "failed: RuntimeError" in out and TOKEN not in out


def test_the_vault_digest_changes_with_a_charged_call_even_when_nothing_was_answered(mod, db):
    """S-2: a run whose first request got a 429 adds no observation, but its call charge and slow-down must be
    published, so the digest changes."""
    run(mod, db)
    first = table_rows(db, store.TABLE)[0]
    res, _, _, _ = run(mod, db, Finnhub(market(), None, fail_at={1: 429}), clock=Clock(NOW + timedelta(hours=20)))
    assert res.status == "failed"
    assert table_rows(db, store.TABLE)[0][3] != first[3]


def test_the_vault_digest_changes_with_observations_not_with_a_skip(mod, db):
    run(mod, db)
    first = table_rows(db, store.TABLE)[0]
    run(mod, db, clock=Clock(NOW + timedelta(hours=3)))  # skipped: spacing
    second = table_rows(db, store.TABLE)[0]
    assert first[3] == second[3] and first[4] != second[4]  # same content digest, a new nonce
    run(mod, db, clock=Clock(NOW + timedelta(hours=20)))
    third = table_rows(db, store.TABLE)[0]
    assert third[3] != second[3]
    assert hashlib.sha256(third[5]).hexdigest() != hashlib.sha256(second[5]).hexdigest()
