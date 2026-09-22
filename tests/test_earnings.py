"""B5 (2026-09-19): large-cap earnings dates on the event calendar.

src/events/earnings.py loads Finnhub's earnings calendar for the twelve single
names the Markets tape streams, 90 days ahead, into event_calendar with
source 'finnhub_earnings', kind 'earnings' and the ticker in `symbol`.

Pinned here: the New York wall-time mapping (bmo 08:00, amc 16:30, dmh and
blank 12:00) on both sides of a DST change; idempotent re-runs; a moved date
replacing the old future row; hand-maintained rows always winning; past rows
never deleted; the additive migration that leaves an existing index alone;
the API leaving earnings out unless ?include=earnings (also on a database
from before the migration); the memos listing macro releases only; and a 401
that reports its status but never the token.

No test touches the network (requests.get is replaced; an unexpected call
fails the test) or data/macro_radar.db (every database is a temp file).
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
import requests

NY = ZoneInfo("America/New_York")
NOW = datetime(2026, 9, 19, 14, 0, tzinfo=timezone.utc)  # 10:00 in New York
TOKEN = "fh-TESTONLY-4be1c9-DO-NOT-LOG"
URL = "https://finnhub.io/api/v1/calendar/earnings"
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

# event_calendar as the published database carries it today: the migrate.py
# table (no symbol/kind columns) plus the unique index added outside it.
LEGACY_DDL = """
CREATE TABLE event_calendar (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name     TEXT    NOT NULL,
    event_datetime TEXT    NOT NULL,          -- ISO 8601: YYYY-MM-DDTHH:MM:SSZ
    importance     TEXT    NOT NULL,          -- "high" | "medium" | "low"
    source         TEXT    NOT NULL DEFAULT 'manual_csv',
    created_at     TEXT    NOT NULL
);
"""
UNIQ = """
CREATE UNIQUE INDEX idx_event_calendar_uniq
    ON event_calendar(event_name, event_datetime);
"""
LEGACY_COLS = "id, event_name, event_datetime, importance, source, created_at"

MANUAL = [
    ("Jobs Report (NFP)", "2026-09-04T12:30:00Z", "high"),  # past
    ("CPI Release", "2026-10-14T12:30:00Z", "high"),
    ("FOMC Meeting", "2026-10-28T18:00:00Z", "high"),
]


# ── fixtures and helpers ─────────────────────────────────────────────────────

@pytest.fixture
def earnings():
    from src.events import earnings as mod

    return mod


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("unexpected network call")

    monkeypatch.setattr(requests, "get", refuse)
    monkeypatch.delenv("GITHUB_ACTIONS", raising=False)


class _Resp:
    def __init__(self, status: int, body, url: str = URL):
        self.status_code = status
        self._body = body
        self.url = url
        self.ok = status < 400
        self.text = body if isinstance(body, str) else json.dumps(body)

    def json(self):
        if isinstance(self._body, str):
            raise ValueError("Expecting value: line 1 column 1 (char 0)")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            # What requests itself raises: the message carries the full URL, token included.
            raise requests.HTTPError(f"{self.status_code} Client Error: Unauthorized for url: {self.url}", response=self)


def _full_url(url: str, params: dict) -> str:
    return url + "?" + "&".join(f"{k}={v}" for k, v in params.items())


def _finnhub(monkeypatch, by_symbol: dict[str, list[dict]]) -> list[dict]:
    """Answer like Finnhub's earnings calendar, one symbol per request."""
    calls: list[dict] = []

    def fake_get(url, params=None, timeout=None, **kwargs):
        assert url == URL and timeout
        calls.append(dict(params))
        return _Resp(200, {"earningsCalendar": list(by_symbol.get(params["symbol"], []))})

    monkeypatch.setattr(requests, "get", fake_get)
    return calls


def _item(symbol: str, day: str, hour: str | None = "amc", quarter: int | None = 3, year: int | None = 2027) -> dict:
    return {
        "date": day, "epsActual": None, "epsEstimate": 1.02, "hour": hour, "quarter": quarter,
        "revenueActual": None, "revenueEstimate": 5.4e10, "symbol": symbol, "year": year,
    }


def _legacy_db(path: Path, manual=MANUAL, *, index: bool = True) -> Path:
    conn = sqlite3.connect(path)
    conn.executescript(LEGACY_DDL + (UNIQ if index else ""))
    conn.executemany(
        "INSERT INTO event_calendar(event_name, event_datetime, importance, source, created_at) "
        "VALUES (?, ?, ?, 'manual_csv', '2026-09-01T00:00:00')",
        list(manual),
    )
    conn.commit()
    conn.close()
    return path


def _query(path: Path, sql: str, params: tuple = ()) -> list[dict]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    finally:
        conn.close()


def _manual_rows(path: Path) -> list[dict]:
    return _query(path, f"SELECT {LEGACY_COLS} FROM event_calendar WHERE source <> 'finnhub_earnings' ORDER BY id")


def _earnings_rows(path: Path) -> list[tuple]:
    return [
        (r["symbol"], r["event_name"], r["event_datetime"])
        for r in _query(path, "SELECT * FROM event_calendar WHERE source = 'finnhub_earnings' ORDER BY event_datetime, symbol")
    ]


def _index_sql(path: Path) -> str | None:
    rows = _query(path, "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_event_calendar_uniq'")
    return rows[0]["sql"] if rows else None


def _utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _add_row(path: Path, name: str, stamp: str, importance: str, source: str, symbol=None, kind=None) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        "INSERT INTO event_calendar(event_name, event_datetime, importance, source, created_at, symbol, kind) "
        "VALUES (?, ?, ?, ?, '2026-09-01T00:00:00', ?, ?)",
        (name, stamp, importance, source, symbol, kind),
    )
    conn.commit()
    conn.close()


def _migrate(path: Path) -> None:
    from src import migrate

    conn = sqlite3.connect(path)
    migrate.ensure_event_calendar_schema(conn)
    conn.commit()
    conn.close()


# ── the universe and the mapping ─────────────────────────────────────────────

def test_symbols_mirror_the_streamed_single_names(earnings):
    from api import stream

    assert list(earnings.EARNINGS_SYMBOLS) == list(stream.SINGLE_NAMES_US)


@pytest.mark.parametrize(
    "day, hour, expected",
    [
        ("2026-10-29", "bmo", "2026-10-29T12:00:00Z"),  # EDT, UTC-4
        ("2026-10-29", "amc", "2026-10-29T20:30:00Z"),
        ("2026-10-29", "dmh", "2026-10-29T16:00:00Z"),
        ("2026-10-29", "", "2026-10-29T16:00:00Z"),  # blank: midday
        ("2026-11-19", "amc", "2026-11-19T21:30:00Z"),  # EST after the 2026-11-01 change, UTC-5
        ("2026-11-19", "bmo", "2026-11-19T13:00:00Z"),
        ("2026-11-19", "dmh", "2026-11-19T17:00:00Z"),
        ("2026-11-19", "", "2026-11-19T17:00:00Z"),
        ("2026-11-19", None, "2026-11-19T17:00:00Z"),
        ("2026-11-19", "tbd", "2026-11-19T17:00:00Z"),  # unknown code: midday
        ("2026-11-19", " AMC ", "2026-11-19T21:30:00Z"),  # codes are trimmed and case-insensitive
        ("2027-03-12", "bmo", "2027-03-12T13:00:00Z"),  # EST, the Friday before the spring change
        ("2027-03-15", "bmo", "2027-03-15T12:00:00Z"),  # EDT, the Monday after
    ],
)
def test_session_codes_map_to_new_york_wall_time_in_utc(earnings, day, hour, expected):
    assert earnings.event_timestamp(day, hour) == expected


def test_event_name_carries_the_fiscal_period_only_when_finnhub_gives_it(earnings):
    assert earnings.event_name("NVDA", 3, 2027) == "NVDA earnings (Q3 2027)"
    assert earnings.event_name("NVDA", None, 2027) == "NVDA earnings"
    assert earnings.event_name("NVDA", 3, None) == "NVDA earnings"


# ── the migration ────────────────────────────────────────────────────────────

def test_migration_adds_nullable_symbol_and_kind_and_leaves_an_existing_index_alone(tmp_path):
    from src import migrate

    path = _legacy_db(tmp_path / "published.db")
    index_before, rows_before = _index_sql(path), _manual_rows(path)
    conn = sqlite3.connect(path)
    migrate.ensure_event_calendar_schema(conn)
    migrate.ensure_event_calendar_schema(conn)  # idempotent
    conn.commit()
    conn.close()
    cols = {r["name"]: r for r in _query(path, "PRAGMA table_info(event_calendar)")}
    for col in ("symbol", "kind"):
        assert cols[col]["type"] == "TEXT" and cols[col]["notnull"] == 0 and cols[col]["dflt_value"] is None
    assert _index_sql(path) == index_before
    assert _manual_rows(path) == rows_before
    assert {(r["symbol"], r["kind"]) for r in _query(path, "SELECT symbol, kind FROM event_calendar")} == {(None, None)}


def test_migration_creates_the_unique_index_but_never_deletes_duplicates(tmp_path, monkeypatch):
    from src import migrate

    # A database built by migrate.py alone: the index arrives with the migration.
    fresh = tmp_path / "fresh.db"
    sqlite3.connect(fresh).close()
    monkeypatch.setattr(migrate, "DB_PATH", fresh)
    migrate.run_migration()
    assert _index_sql(fresh) is not None
    assert {"symbol", "kind"} <= {r["name"] for r in _query(fresh, "PRAGMA table_info(event_calendar)")}
    info = _query(fresh, "PRAGMA index_info(idx_event_calendar_uniq)")
    assert [r["name"] for r in info] == ["event_name", "event_datetime"]
    assert _query(fresh, "PRAGMA index_list(event_calendar)")[0]["unique"] == 1
    # Duplicate pairs already stored: no index, and no row removed to make one.
    dup = _legacy_db(tmp_path / "dup.db", MANUAL + [MANUAL[1]], index=False)
    _migrate(dup)
    assert _index_sql(dup) is None
    assert len(_manual_rows(dup)) == len(MANUAL) + 1


# ── the load and the merge rules ─────────────────────────────────────────────

def test_load_stores_one_row_per_report_in_the_calendar_shape(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    manual_before = _manual_rows(path)
    calls = _finnhub(monkeypatch, {
        "NVDA": [_item("NVDA", "2026-11-19", "amc", 3, 2027)],
        "AAPL": [_item("AAPL", "2026-10-29", "amc", 4, 2026)],
        "TSM": [_item("TSM", "2026-10-15", "bmo", 3, 2026)],
        "COIN": [_item("COIN", "2026-11-05", "", None, None)],
        "MSFT": [_item("MSFT", "2027-01-27", "amc", 2, 2027)],  # beyond the 90-day horizon
        "AMD": [_item("XYZ", "2026-11-04", "amc", 3, 2026)],  # a stray ticker in AMD's answer
    })
    res = earnings.run(path, api_key=TOKEN, now=NOW)

    assert [c["symbol"] for c in calls] == list(earnings.EARNINGS_SYMBOLS)
    assert {(c["from"], c["to"], c["token"]) for c in calls} == {("2026-09-19", "2026-12-18", TOKEN)}
    assert _earnings_rows(path) == [
        ("TSM", "TSM earnings (Q3 2026)", "2026-10-15T12:00:00Z"),
        ("AAPL", "AAPL earnings (Q4 2026)", "2026-10-29T20:30:00Z"),
        ("COIN", "COIN earnings", "2026-11-05T17:00:00Z"),
        ("NVDA", "NVDA earnings (Q3 2027)", "2026-11-19T21:30:00Z"),
    ]
    for r in _query(path, "SELECT * FROM event_calendar WHERE source = 'finnhub_earnings'"):
        assert r["importance"] == "medium" and r["kind"] == "earnings" and r["created_at"]
        assert STAMP.match(r["event_datetime"])
    assert _manual_rows(path) == manual_before
    assert {(r["symbol"], r["kind"]) for r in _query(path, "SELECT symbol, kind FROM event_calendar WHERE source = 'manual_csv'")} == {(None, None)}
    assert res["new"] == 4 and res["summary"].startswith("[earnings]") and "\n" not in res["summary"]


def test_rerun_is_idempotent(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    _finnhub(monkeypatch, {
        "NVDA": [_item("NVDA", "2026-11-19", "amc", 3, 2027)],
        "COIN": [_item("COIN", "2026-11-05", "", None, None)],
    })
    earnings.run(path, api_key=TOKEN, now=NOW)
    first = _query(path, "SELECT * FROM event_calendar ORDER BY id")
    for _ in range(2):
        res = earnings.run(path, api_key=TOKEN, now=NOW + timedelta(hours=12))
    assert _query(path, "SELECT * FROM event_calendar ORDER BY id") == first
    assert res["new"] == 0 and res["moved"] == 0 and res["unchanged"] == 2


def test_a_moved_date_replaces_the_old_future_row(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    _finnhub(monkeypatch, {
        "NVDA": [_item("NVDA", "2026-11-19", "amc", 3, 2027)],
        "AAPL": [_item("AAPL", "2026-10-29", "amc", 4, 2026)],
    })
    earnings.run(path, api_key=TOKEN, now=NOW)
    ids = {r["symbol"]: r["id"] for r in _query(path, "SELECT id, symbol FROM event_calendar WHERE symbol IS NOT NULL")}
    # Finnhub moves NVDA a day later, before the open, and AAPL a day later.
    _finnhub(monkeypatch, {
        "NVDA": [_item("NVDA", "2026-11-20", "bmo", 3, 2027)],
        "AAPL": [_item("AAPL", "2026-10-30", "amc", 4, 2026)],
    })
    res = earnings.run(path, api_key=TOKEN, now=NOW + timedelta(days=1))
    assert _earnings_rows(path) == [
        ("AAPL", "AAPL earnings (Q4 2026)", "2026-10-30T20:30:00Z"),
        ("NVDA", "NVDA earnings (Q3 2027)", "2026-11-20T13:00:00Z"),
    ]
    # Replaced in place, not duplicated.
    assert {r["symbol"]: r["id"] for r in _query(path, "SELECT id, symbol FROM event_calendar WHERE symbol IS NOT NULL")} == ids
    assert res["moved"] == 2 and res["new"] == 0


def test_a_hand_maintained_row_wins_on_the_same_new_york_date(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db", MANUAL + [
        ("NVDA earnings", "2026-11-20T01:00:00Z", "high"),  # 20:00 on 11-19 in New York
        ("Micron (mu) Q1 FY27 Earnings call", "2026-12-17T21:05:00Z", "high"),  # case-insensitive
        ("AMD earnings", "2026-11-03T21:00:00Z", "high"),  # a different New York date
        ("Amdocs earnings", "2026-11-04T21:00:00Z", "low"),  # "Amd" inside a word is not the ticker
    ])
    _migrate(path)
    _add_row(path, "Apple results call", "2026-10-29T21:00:00Z", "high", "manual_csv", symbol="AAPL")  # the symbol column
    manual_before = _manual_rows(path)
    _finnhub(monkeypatch, {
        "NVDA": [_item("NVDA", "2026-11-19", "amc", 3, 2027)],
        "MU": [_item("MU", "2026-12-17", "amc", 1, 2027)],
        "AMD": [_item("AMD", "2026-11-04", "amc", 3, 2026)],
        "AAPL": [_item("AAPL", "2026-10-29", "amc", 4, 2026)],
    })
    res = earnings.run(path, api_key=TOKEN, now=NOW)
    assert _earnings_rows(path) == [("AMD", "AMD earnings (Q3 2026)", "2026-11-04T21:30:00Z")]
    assert _manual_rows(path) == manual_before
    assert res["withheld"] == 3


def test_a_hand_maintained_row_added_later_removes_the_finnhub_row(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    _finnhub(monkeypatch, {"NVDA": [_item("NVDA", "2026-11-19", "amc", 3, 2027)]})
    earnings.run(path, api_key=TOKEN, now=NOW)
    assert [r[0] for r in _earnings_rows(path)] == ["NVDA"]
    # The owner adds the report to calendar.csv and the reload stores it; that
    # day Finnhub's answer for NVDA comes back empty. The manual row still wins.
    _add_row(path, "NVDA Q3 earnings", "2026-11-19T21:20:00Z", "high", "manual_csv")
    manual_before = _manual_rows(path)
    _finnhub(monkeypatch, {})
    res = earnings.run(path, api_key=TOKEN, now=NOW)
    assert _earnings_rows(path) == []
    assert _manual_rows(path) == manual_before
    assert res["removed"] == 1


def test_past_rows_are_never_deleted_or_duplicated(tmp_path, monkeypatch, earnings):
    path = _legacy_db(tmp_path / "cal.db", MANUAL + [("NVDA earnings", "2026-08-27T21:00:00Z", "high")])
    _migrate(path)
    _add_row(path, "NVDA earnings (Q2 2027)", "2026-08-27T20:30:00Z", "medium", "finnhub_earnings", "NVDA", "earnings")
    before = _query(path, "SELECT * FROM event_calendar ORDER BY id")
    # Finnhub no longer lists that report, and (a data slip) shows the same
    # fiscal period again on a future date: neither removes nor duplicates it.
    _finnhub(monkeypatch, {"NVDA": [_item("NVDA", "2026-09-24", "amc", 2, 2027)]})
    earnings.run(path, api_key=TOKEN, now=NOW)
    assert _query(path, "SELECT * FROM event_calendar ORDER BY id") == before


# ── failure modes: never fail the refresh, never print the token ─────────────

def test_missing_key_is_a_one_line_skip_that_leaves_the_database_alone(tmp_path, monkeypatch, capsys, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    before = path.read_bytes()
    monkeypatch.delenv("FINNHUB_API_KEY", raising=False)
    monkeypatch.setattr(earnings, "ENV_FILE", tmp_path / "absent.env")
    assert earnings.main(["--db", str(path)]) == 0
    out = capsys.readouterr().out.strip().splitlines()
    assert len(out) == 1 and "FINNHUB_API_KEY" in out[0]
    assert path.read_bytes() == before


def test_http_401_reports_the_status_but_never_the_token(tmp_path, monkeypatch, capsys, caplog, earnings):
    path = _legacy_db(tmp_path / "cal.db")
    monkeypatch.setenv("FINNHUB_API_KEY", TOKEN)
    calls: list[str] = []

    def fake_get(url, params=None, timeout=None, **kwargs):
        calls.append(params["symbol"])
        return _Resp(401, {"error": f"Invalid API key {params['token']}"}, url=_full_url(url, params))

    monkeypatch.setattr(requests, "get", fake_get)
    caplog.set_level(logging.DEBUG)
    before = path.read_bytes()
    assert earnings.main(["--db", str(path)]) == 0
    out = capsys.readouterr()
    assert TOKEN not in out.out + out.err + caplog.text
    lines = out.out.strip().splitlines()
    assert len(lines) == 1 and "401" in lines[0]
    assert calls == ["AAPL"]  # a rejected key is not sent again for the other eleven
    assert path.read_bytes() == before  # nothing fetched, nothing touched


def test_network_and_payload_errors_are_reported_by_type_only(tmp_path, monkeypatch, capsys, earnings):
    path = _legacy_db(tmp_path / "cal.db")

    def fake_get(url, params=None, timeout=None, **kwargs):
        sym = params["symbol"]
        if sym == "NVDA":
            raise requests.ConnectionError(
                f"HTTPSConnectionPool(host='finnhub.io', port=443): Max retries exceeded with url: {_full_url(url, params)}"
            )
        if sym == "TSM":
            return _Resp(200, f"<html>upstream error for {params['token']}</html>")
        items = [_item("AMD", "2026-11-04", "amc", 3, 2026)] if sym == "AMD" else []
        return _Resp(200, {"earningsCalendar": items})

    monkeypatch.setattr(requests, "get", fake_get)
    res = earnings.run(path, api_key=TOKEN, now=NOW)
    out = capsys.readouterr()
    assert TOKEN not in out.out + out.err + res["summary"]
    assert "NVDA ConnectionError" in res["summary"] and "TSM" in res["summary"]
    assert _earnings_rows(path) == [("AMD", "AMD earnings (Q3 2026)", "2026-11-04T21:30:00Z")]


# ── readers: the API opt-in and the memos ────────────────────────────────────

@pytest.fixture
def api_client(monkeypatch):
    from fastapi.testclient import TestClient

    from api import db as api_db
    from api.main import app

    def use(path: Path) -> TestClient:
        monkeypatch.setattr(api_db, "DB_PATH", path)
        api_db.reset_connections_for_tests()
        return TestClient(app)

    yield use
    api_db.reset_connections_for_tests()


def test_api_calendar_leaves_earnings_out_unless_asked(tmp_path, monkeypatch, earnings, api_client):
    now = datetime.now(timezone.utc)
    soon = (now.astimezone(NY).date() + timedelta(days=3)).isoformat()
    path = _legacy_db(tmp_path / "api.db", [
        ("CPI Release", _utc(now + timedelta(days=2)), "high"),
        ("FOMC Meeting", _utc(now - timedelta(days=2)), "high"),
    ])
    _finnhub(monkeypatch, {"NVDA": [_item("NVDA", soon, "amc", 3, 2027)]})
    earnings.run(path, api_key=TOKEN)  # the real clock: the API compares against 'now'
    _add_row(path, "AAPL earnings (Q3 2026)", _utc(now - timedelta(days=1)), "medium", "finnhub_earnings", "AAPL", "earnings")
    client = api_client(path)

    rows = client.get("/api/calendar", params={"days": 30}).json()
    assert [(r["event_name"], r["symbol"], r["kind"]) for r in rows] == [("CPI Release", None, None)]
    rows = client.get("/api/calendar", params={"days": 30, "include": "earnings"}).json()
    assert [r["event_name"] for r in rows] == ["CPI Release", "NVDA earnings (Q3 2027)"]
    e = rows[1]
    assert (e["symbol"], e["kind"], e["source"], e["importance"]) == ("NVDA", "earnings", "finnhub_earnings", "medium")
    assert e["event_datetime"] == earnings.event_timestamp(soon, "amc")

    rows = client.get("/api/calendar/recent", params={"limit": 10}).json()
    assert [r["event_name"] for r in rows] == ["FOMC Meeting"]
    rows = client.get("/api/calendar/recent", params={"limit": 10, "include": "earnings"}).json()
    assert [(r["event_name"], r["symbol"], r["kind"]) for r in rows] == [
        ("AAPL earnings (Q3 2026)", "AAPL", "earnings"),
        ("FOMC Meeting", None, None),
    ]
    assert client.get("/api/calendar", params={"include": "everything"}).status_code == 422
    assert client.get("/api/calendar/recent", params={"include": "everything"}).status_code == 422


def test_api_calendar_reads_a_database_from_before_the_migration(tmp_path, api_client):
    now = datetime.now(timezone.utc)
    path = _legacy_db(tmp_path / "old.db", [
        ("CPI Release", _utc(now + timedelta(days=2)), "high"),
        ("FOMC Meeting", _utc(now - timedelta(days=2)), "high"),
    ])
    client = api_client(path)
    for extra in ({}, {"include": "earnings"}):
        rows = client.get("/api/calendar", params={"days": 30, **extra}).json()
        assert [(r["event_name"], r["symbol"], r["kind"]) for r in rows] == [("CPI Release", None, None)]
        rows = client.get("/api/calendar/recent", params={"limit": 5, **extra}).json()
        assert [(r["event_name"], r["symbol"], r["kind"]) for r in rows] == [("FOMC Meeting", None, None)]


def test_memos_list_macro_releases_only(tmp_path, monkeypatch, earnings):
    from src import daily_memo, memo

    now = datetime.now(timezone.utc)
    tomorrow = (now.astimezone(NY).date() + timedelta(days=1)).isoformat()
    path = _legacy_db(tmp_path / "memo.db", [("CPI Release", _utc(now + timedelta(hours=20)), "high")])
    _finnhub(monkeypatch, {"NVDA": [_item("NVDA", tomorrow, "amc", 3, 2027)]})
    earnings.run(path, api_key=TOKEN)
    assert [r[0] for r in _earnings_rows(path)] == ["NVDA"]
    monkeypatch.setattr(daily_memo, "DB_PATH", path)
    monkeypatch.setattr(memo, "DB_PATH", path)
    assert [e["name"] for e in daily_memo.load_calendar(days=3)] == ["CPI Release"]
    assert list(memo.load_event_calendar_memo()["event_name"]) == ["CPI Release"]
