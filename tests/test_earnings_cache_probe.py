"""The earnings cache's read-only free-plan probe (src/events/earnings_cache.py --probe).

Pinned here: the 18 seven-day windows over the 120-day horizon; the refusal to
start during weekday US trading hours or without a key; the pace (6 s between
calls) and the stop without a retry at the first failure; each check and the
four outcomes (pass, sparse, ambiguous, fail); a cross-check with nothing to
compare never passing; the key never printed; and the database left untouched.

No test touches the network (requests.get is replaced; an unexpected call
fails the test) or data/macro_radar.db (every database is a temp file). Every
row is synthetic.
"""

from __future__ import annotations

import hashlib
import sqlite3
from datetime import date, datetime, timedelta, timezone

import pytest
import requests

NOW = datetime(2026, 10, 29, 2, 0, tzinfo=timezone.utc)  # Wednesday 22:00 in New York
TODAY = date(2026, 10, 28)
TOKEN = "fh-TESTONLY-7c2d0e-DO-NOT-LOG"
TAPE = [("AAPL", 10), ("NVDA", 40)]  # (ticker, day offset) of the stored Finnhub rows


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


@pytest.fixture
def db(tmp_path):
    from src.migrate import ensure_event_calendar_schema

    path = tmp_path / "store.db"
    conn = sqlite3.connect(path)
    ensure_event_calendar_schema(conn)
    rows = [(f"{s} earnings", f"{(TODAY + timedelta(days=d)).isoformat()}T20:30:00Z", "medium", "finnhub_earnings",
             "2026-10-01T00:00:00", s, "earnings") for s, d in TAPE]
    rows += [
        ("MU earnings", "2026-09-30T20:30:00Z", "medium", "finnhub_earnings", "2026-09-01T00:00:00", "MU", "earnings"),
        ("TSLA earnings", f"{(TODAY + timedelta(days=5)).isoformat()}T20:30:00Z", "medium", "manual_csv",
         "2026-10-01T00:00:00", "TSLA", "earnings"),
        ("CPI Release", f"{(TODAY + timedelta(days=14)).isoformat()}T12:30:00Z", "high", "manual_csv",
         "2026-10-01T00:00:00", None, None),
    ]
    conn.executemany("INSERT INTO event_calendar (event_name, event_datetime, importance, source, created_at, symbol, kind) "
                     "VALUES (?, ?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    conn.close()
    return path


def master(skip_window: int | None = None, drop_tape: str | None = None, extra=()):
    """Synthetic whole-market calendar: one name a day over the horizon plus the tape names' reports."""
    out = [{"symbol": f"S{n:03d}", "date": (TODAY + timedelta(days=n)).isoformat(), "hour": "amc" if n % 2 else "",
            "quarter": 3, "year": 2026} for n in range(120) if skip_window is None or n // 7 != skip_window]
    out += [{"symbol": s, "date": (TODAY + timedelta(days=d)).isoformat(), "hour": "amc"} for s, d in TAPE if s != drop_tape]
    out += list(extra)
    return out


def _iso(row) -> bool:
    try:
        date.fromisoformat(str(row.get("date"))[:10])
    except (AttributeError, ValueError):
        return False
    return True


class Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


class Finnhub:
    """Answers each call from the master list, or with a status from `fail_at` (1-based call number)."""

    def __init__(self, rows, fail_at=None, status=429, cut_whole_by=0, raw=None):
        self.rows, self.fail_at, self.status, self.cut = rows, fail_at, status, cut_whole_by
        self.raw = raw or {}
        self.calls = []

    def __call__(self, url, params=None, timeout=None):
        assert "symbol" not in params, "the probe asks for the whole market"
        assert params["token"] == TOKEN
        self.calls.append((params["from"], params["to"]))
        n = len(self.calls)
        if self.fail_at == n:
            return Resp(self.status, {"error": "limit"})
        if n in self.raw:
            return Resp(200, self.raw[n])
        lo, hi = params["from"], params["to"]
        items = [r for r in self.rows if _iso(r) and lo <= r["date"][:10] <= hi]
        items += [r for r in self.rows if not _iso(r)]  # malformed rows ride along in every reply
        if self.cut and (date.fromisoformat(hi) - date.fromisoformat(lo)).days >= 27:
            items = items[: -self.cut]
        return Resp(200, {"earningsCalendar": items})


def run(mod, db, fake):
    sleeps = []
    report = mod.probe(TOKEN, db, now=NOW, get=fake, sleep=sleeps.append)
    return report, sleeps


def text(report):
    return "\n".join(report.lines)


# ── windows and clock ────────────────────────────────────────────────────────

def test_windows_cover_days_0_to_119_in_18_calls(mod):
    ws = mod.windows(TODAY)
    assert len(ws) == 18
    assert ws[0].start == TODAY and ws[-1].start == ws[-1].end == TODAY + timedelta(days=119)
    for a, b in zip(ws, ws[1:]):
        assert b.start == a.end + timedelta(days=1)
    assert all((w.end - w.start).days == 6 for w in ws[:-1])


@pytest.mark.parametrize("utc, inside", [
    (datetime(2026, 10, 29, 12, 59), False),  # 08:59 EDT
    (datetime(2026, 10, 29, 13, 0), True),    # 09:00 EDT
    (datetime(2026, 10, 29, 20, 59), True),   # 16:59 EDT
    (datetime(2026, 10, 29, 21, 0), False),   # 17:00 EDT
    (datetime(2026, 10, 31, 15, 0), False),   # Saturday
    (datetime(2026, 11, 2, 14, 30), True),    # Monday 09:30 EST, after the DST change
])
def test_trading_hours_are_new_york_weekdays_9_to_17(mod, utc, inside):
    assert mod.in_trading_hours(utc.replace(tzinfo=timezone.utc)) is inside


def test_main_refuses_in_trading_hours_without_a_call(mod, db, monkeypatch, capsys):
    monkeypatch.setenv("FINNHUB_API_KEY", TOKEN)
    rc = mod.main(["--probe", "--db", str(db)], now=datetime(2026, 10, 29, 15, 0, tzinfo=timezone.utc))
    out = capsys.readouterr().out
    assert rc == 2 and "trading hours" in out and TOKEN not in out


def test_main_refuses_without_a_key(mod, db, monkeypatch, capsys):
    monkeypatch.setattr(mod, "_api_key", lambda: "")
    rc = mod.main(["--probe", "--db", str(db)], now=NOW)
    assert rc == 2 and "FINNHUB_API_KEY is not set" in capsys.readouterr().out


# ── outcomes ─────────────────────────────────────────────────────────────────

def test_pass_paces_every_call_and_leaves_the_database_untouched(mod, db):
    before = hashlib.sha256(db.read_bytes()).hexdigest()
    fake = Finnhub(master())
    report, sleeps = run(mod, db, fake)
    assert report.outcome == "pass", text(report)
    assert len(fake.calls) == 19 and sleeps == [6.0] * 18
    assert fake.calls[-1] == (TODAY.isoformat(), (TODAY + timedelta(days=27)).isoformat())
    out = text(report)
    for check in ("P1 access: PASS", "P2 shape: PASS", "P3 coverage: PASS", "P4 cross-check: PASS (2 of 2",
                  "P5 truncation: PASS", "largest reply proven whole"):
        assert check in out
    assert "OUTCOME: PASS" in out
    assert hashlib.sha256(db.read_bytes()).hexdigest() == before


def test_output_carries_counts_never_a_date_or_the_key(mod, db):
    report, _ = run(mod, db, Finnhub(master()))
    out = text(report)
    assert TOKEN not in out
    assert not any(str(TODAY.year) in line for line in report.lines)
    assert "S001" not in out and "AAPL" not in out


def test_an_empty_window_is_sparse(mod, db):
    report, _ = run(mod, db, Finnhub(master(skip_window=16)))
    assert report.outcome == "sparse", text(report)
    assert "P3 coverage: FAIL" in text(report)


def test_a_missed_tape_date_is_ambiguous_and_names_the_ticker(mod, db):
    report, _ = run(mod, db, Finnhub(master(drop_tape="NVDA")))
    assert report.outcome == "ambiguous"
    assert "P4 cross-check: FAIL (1 of 2" in text(report) and "missed for NVDA" in text(report)


def test_nothing_to_compare_never_passes_the_cross_check(mod, tmp_path):
    from src.migrate import ensure_event_calendar_schema

    empty = tmp_path / "empty.db"
    conn = sqlite3.connect(empty)
    ensure_event_calendar_schema(conn)
    conn.commit()
    conn.close()
    report, _ = run(mod, empty, Finnhub(master()))
    assert report.outcome == "ambiguous"
    assert "P4 cross-check: FAIL" in text(report) and "nothing to compare" in text(report)


def test_a_cut_short_28_day_reply_fails_the_truncation_check(mod, db):
    report, _ = run(mod, db, Finnhub(master(), cut_whole_by=3))
    assert report.outcome == "ambiguous"
    assert "P5 truncation: FAIL" in text(report) and "no reply size proven whole" in text(report)


def test_a_429_stops_at_once_without_a_retry(mod, db):
    fake = Finnhub(master(), fail_at=5, status=429)
    report, sleeps = run(mod, db, fake)
    assert len(fake.calls) == 5 and len(sleeps) == 4
    assert report.outcome == "ambiguous"
    out = text(report)
    assert "stopped: HTTP 429" in out and "P5 truncation: NOT RUN" in out


def test_a_refused_first_call_fails(mod, db):
    fake = Finnhub(master(), fail_at=1, status=401)
    report, _ = run(mod, db, fake)
    assert len(fake.calls) == 1 and report.outcome == "fail"
    assert "P1 access: FAIL (HTTP 401)" in text(report)


@pytest.mark.parametrize("bad", [{"symbol": "S999"}, {"date": "2026-11-01"}, {"symbol": "S998", "date": "soon"}, "row"])
def test_a_malformed_row_fails(mod, db, bad):
    report, _ = run(mod, db, Finnhub(master(extra=[bad])))
    assert report.outcome == "fail", text(report)
    assert "P2 shape: FAIL (" in text(report)


def test_a_row_outside_its_dates_fails_the_shape_check(mod, db):
    raw = {2: {"earningsCalendar": [{"symbol": "S500", "date": (TODAY - timedelta(days=3)).isoformat()}]
               + [r for r in master() if TODAY + timedelta(days=7) <= date.fromisoformat(r["date"]) <= TODAY + timedelta(days=13)]}}
    report, _ = run(mod, db, Finnhub(master(), raw=raw))
    assert "P2 shape: FAIL (0 malformed, 1 outside their dates)" in text(report)
    assert report.outcome == "ambiguous"


def test_a_network_error_reports_its_type_only(mod, db):
    def boom(url, params=None, timeout=None):
        raise requests.ConnectionError(f"https://finnhub.io/api/v1/calendar/earnings?token={params['token']}")

    report, _ = run(mod, db, boom)
    assert report.outcome == "fail"
    assert "ConnectionError" in text(report) and TOKEN not in text(report)


def test_stored_dates_read_only_future_finnhub_rows_of_tape_names(mod, db):
    got = mod.stored_dates(db, TODAY, NOW)
    assert got == {s: {TODAY + timedelta(days=d)} for s, d in TAPE}
