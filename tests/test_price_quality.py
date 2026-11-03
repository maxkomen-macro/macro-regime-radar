"""src/market_data/quality.py and its wiring into scripts/validate_db.py
(Analyst Desk P0c): splits, implausible moves, repeated bars, stale runs,
spikes, jumps, NYSE gaps, off-calendar rows and raw/adjusted mismatches;
blocking only on a new blocking-class flag."""

from __future__ import annotations

import math
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest

from api import calendar as cal
from scripts import validate_db as v
from src.market_data import quality as q
from tests.test_validate_db import NOW, _make

ROOT = Path(__file__).resolve().parents[1]
REAL_DB = ROOT / "data" / "macro_radar.db"


def _sessions(end: str, n: int) -> list[str]:
    """n NYSE sessions ending on `end` (inclusive), oldest first."""
    d, out = date.fromisoformat(end), []
    while len(out) < n:
        if cal.is_trading_day(d):
            out.append(d.isoformat())
        d -= timedelta(days=1)
    return out[::-1]


def _walk(n: int, *, start: float = 100.0, sigma: float = 0.01, seed: int = 7) -> list[float]:
    rng = random.Random(seed)
    out = [start]
    for _ in range(n - 1):
        out.append(out[-1] * math.exp(rng.gauss(0, sigma)))
    return out


def _db(tmp_path: Path, name: str = "q.db") -> sqlite3.Connection:
    conn = sqlite3.connect(tmp_path / name)
    conn.executescript(
        """
        CREATE TABLE asset_prices (symbol TEXT NOT NULL, interval TEXT NOT NULL, date TEXT NOT NULL, close REAL NOT NULL,
                                   provider TEXT NOT NULL, volume REAL, PRIMARY KEY (symbol, interval, date)) WITHOUT ROWID;
        CREATE TABLE market_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, date TEXT NOT NULL,
                                   open REAL, high REAL, low REAL, close REAL NOT NULL, volume REAL, source TEXT, fetched_at TEXT,
                                   UNIQUE(symbol, date));
        CREATE TABLE desk_series (series_id TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL, provider TEXT NOT NULL,
                                  PRIMARY KEY (series_id, date)) WITHOUT ROWID;
        """
    )
    return conn


def _put(conn, symbol, dates, closes, *, table="asset_prices", interval="1d", volumes=None):
    volumes = volumes or [1_000_000.0 + i for i in range(len(dates))]
    if table == "asset_prices":
        conn.executemany("INSERT INTO asset_prices VALUES (?,?,?,?,?,?)",
                         [(symbol, interval, d, c, "yfinance", vol) for d, c, vol in zip(dates, closes, volumes)])
    elif table == "market_daily":
        conn.executemany("INSERT INTO market_daily(symbol, date, open, high, low, close, volume, source, fetched_at) "
                         "VALUES (?,?,?,?,?,?,?,?,?)",
                         [(symbol, d, c, c, c, c, vol, "yfinance", "x") for d, c, vol in zip(dates, closes, volumes)])
    else:
        conn.executemany("INSERT INTO desk_series VALUES (?,?,?,?)", [(symbol, d, c, "fred") for d, c in zip(dates, closes)])
    conn.commit()


def _flags(conn, check=None, series=None):
    return [f for f in q.run(conn)["flags"] if (check is None or f["check"] == check) and (series is None or f["series"] == series)]


DATES = _sessions("2026-09-03", 400)


# ── the module, check by check ───────────────────────────────────────────────────────────────────────────


def test_a_clean_history_carries_no_flag(tmp_path):
    conn = _db(tmp_path)
    _put(conn, "SPY", DATES, _walk(len(DATES)))
    _put(conn, "^GSPC", DATES, _walk(len(DATES), seed=8))
    assert _flags(conn) == []


def test_an_unadjusted_split_on_an_etf_is_a_blocking_split_flag(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c / 2 for c in closes[300:]]  # a 2:1 split the adjustment missed
    _put(conn, "XLK", DATES, closes)
    (f,) = _flags(conn, "split")
    assert (f["series"], f["date"], f["blocking"]) == ("XLK", DATES[300], True)
    assert "1/2" in f["detail"]
    assert not _flags(conn, "implausible")  # the split explains it; one flag, not two


def test_a_reverse_split_is_named_too(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c * 10 for c in closes[300:]]
    _put(conn, "HYG", DATES, closes, table="market_daily")
    (f,) = _flags(conn, "split")
    assert f["table"] == "market_daily" and f["blocking"] and "10x" in f["detail"]


def test_a_halving_that_reverts_is_an_implausible_print_not_a_split(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes[300] = closes[299] / 2
    _put(conn, "XLE", DATES, closes)
    assert not _flags(conn, "split")
    flags = _flags(conn, "implausible")
    assert [f["date"] for f in flags] == [DATES[300], DATES[301]] and all(f["blocking"] for f in flags)


def test_an_index_cannot_split_so_a_halving_is_implausible(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c / 2 for c in closes[300:]]
    _put(conn, "^GSPC", DATES, closes)
    assert not _flags(conn, "split")
    (f,) = _flags(conn, "implausible")
    assert f["blocking"] and f["date"] == DATES[300]


def test_the_largest_moves_on_record_stay_under_the_limits(tmp_path):
    """The limits were set above every real move in the published database: the S&P's
    -12.0% (2020-03-16), XLE's -20.2% (2020-03-09), the VIX's +115.6% (2018-02-05)."""
    conn = _db(tmp_path)
    for sym, move in (("^GSPC", math.log(0.88)), ("XLE", math.log(0.798)), ("^VIX", math.log(2.156))):
        closes = _walk(len(DATES), sigma=0.01)
        closes = closes[:300] + [c * math.exp(move) for c in closes[300:]]
        _put(conn, sym, DATES, closes)
    assert not _flags(conn, "implausible") and not _flags(conn, "split")
    assert {f["series"] for f in _flags(conn, "jump")} == {"^GSPC", "XLE", "^VIX"}  # named, advisory


def test_volatility_triples_are_implausible(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES), start=15.0, sigma=0.05)
    closes = closes[:300] + [c * 3.6 for c in closes[300:]]
    _put(conn, "^VIX", DATES, closes, volumes=[0.0] * len(DATES))
    (f,) = _flags(conn, "implausible")
    assert f["series"] == "^VIX" and f["blocking"]


def test_a_repeated_bar_is_stale_and_advisory_but_a_repeated_close_on_new_volume_is_not(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    vols = [1_000_000.0 + i for i in range(len(DATES))]
    closes[200] = closes[199]
    vols[200] = vols[199]           # the whole bar repeats: stale
    closes[250] = closes[249]       # the close repeats on its own volume: ordinary
    _put(conn, "IWM", DATES, closes, volumes=vols)
    (f,) = _flags(conn, "stale")
    assert (f["date"], f["blocking"]) == (DATES[200], False)  # two real sessions can match (design DR-01)


def test_a_series_without_volume_is_judged_on_runs_only(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES), start=15.0, sigma=0.05)
    closes[100] = closes[101] = closes[99]
    _put(conn, "^VIX", DATES, closes, volumes=[0.0] * len(DATES))
    assert not _flags(conn, "stale")
    (f,) = _flags(conn, "stale_run")
    assert f["date"] == DATES[101] and not f["blocking"] and "3 rows" in f["detail"]


def test_two_equal_month_ends_are_a_stale_run(tmp_path):
    conn = _db(tmp_path)
    months = [f"{y}-{m:02d}-01" for y in range(2010, 2016) for m in range(1, 13)]
    closes = _walk(len(months), sigma=0.04)
    closes[30] = closes[29]
    _put(conn, "IWD", months, closes, interval="1mo", volumes=[None] * len(months))
    (f,) = _flags(conn, "stale_run")
    assert (f["interval"], f["date"]) == ("1mo", months[30])


def test_unchanged_yields_are_ordinary(tmp_path):
    conn = _db(tmp_path)
    _put(conn, "DGS10", DATES, [4.0] * 50 + [4.01] * (len(DATES) - 50), table="desk_series")
    assert _flags(conn) == []


def test_a_yield_moving_three_points_blocks_only_on_a_tier_one_series(tmp_path):
    conn = _db(tmp_path)
    rng = random.Random(3)
    base = [4.0 + rng.gauss(0, 0.05) for _ in DATES]
    bad = base[:300] + [x + 38.0 for x in base[300:]]  # a percent stored as basis points, say
    _put(conn, "DGS10", DATES, bad, table="desk_series")
    _put(conn, "DCOILWTICO", DATES, [70.0 * math.exp(0.02 * i / len(DATES)) for i in range(len(DATES))], table="desk_series")
    (f,) = _flags(conn, "implausible", "DGS10")
    assert f["blocking"] and f["detail"].startswith("+38") and "bp" in f["detail"]
    assert q._blocking("desk_series", "DCOILWTICO", "implausible", q._tier1_desk()) is False  # tier 2: advisory


def test_a_print_that_reverts_is_a_spike_unless_its_peers_moved_too(tmp_path):
    conn = _db(tmp_path)
    jpy = _walk(len(DATES), start=100.0, sigma=0.005, seed=11)
    jpy[300] = jpy[299] * 1.15
    _put(conn, "JPY=X", DATES, jpy, table="desk_series")
    (f,) = _flags(conn, "spike")
    assert (f["series"], f["date"], f["blocking"]) == ("JPY=X", DATES[300], False)
    # the same print on SPY, when three US-listed peers moved hard that day too, is a market day
    conn2 = _db(tmp_path, "q2.db")
    for i, sym in enumerate(("SPY", "QQQ", "IWM", "XLK")):
        c = _walk(len(DATES), seed=20 + i)
        c[300] = c[299] * 0.85
        _put(conn2, sym, DATES, c)
    assert not _flags(conn2, "spike")
    assert {f["series"] for f in _flags(conn2, "jump")} >= {"SPY", "QQQ", "IWM", "XLK"}
    assert all("3 peer(s)" in f["detail"] for f in _flags(conn2, "jump") if f["date"] == DATES[300])


def test_a_missing_session_is_a_gap_and_a_holiday_row_is_off_calendar(tmp_path):
    conn = _db(tmp_path)
    dates = _sessions("2026-09-04", 400)
    missing = dates.pop(200)
    dates.append("2026-09-07")  # Labor Day 2026: NYSE closed, the session after the last stored one
    _put(conn, "^VIX", dates, _walk(len(dates), start=15.0, sigma=0.03), volumes=[0.0] * len(dates))
    (gap,) = _flags(conn, "gap")
    assert missing in gap["detail"] and not gap["blocking"]
    (off,) = _flags(conn, "off_calendar")
    assert off["date"] == "2026-09-07" and not off["blocking"]


def test_futures_and_currencies_are_not_held_to_nyse_sessions(tmp_path):
    conn = _db(tmp_path)
    dates = list(DATES)
    del dates[200]
    _put(conn, "GC=F", dates + ["2026-09-07"], _walk(len(dates) + 1, start=2000.0))
    _put(conn, "JPY=X", dates, _walk(len(dates), sigma=0.005), table="desk_series")
    assert not _flags(conn, "gap") and not _flags(conn, "off_calendar")


def _cross(tmp_path, raw_closes, adj_closes):
    conn = _db(tmp_path)
    _put(conn, "SPY", DATES, raw_closes, table="market_daily")
    _put(conn, "SPY", DATES, adj_closes)
    return conn


def test_cross_table_reads_a_distribution_as_ordinary(tmp_path):
    adj = _walk(len(DATES))
    # before an ex-date the adjusted history sits below the raw closes by the distribution (1.3% here, 4.4% for UUP's
    # annual one); on the ex-date the raw close drops by it and the ratio steps down, never up
    raw = [c * (1.013 if i < 300 else 1.0) for i, c in enumerate(adj)]
    assert not _flags(_cross(tmp_path, raw, adj), "cross_table")


def test_cross_table_names_a_one_session_mismatch_and_a_splice(tmp_path):
    adj = _walk(len(DATES))
    raw = list(adj)
    raw[150] *= 1.012                                              # a mid-session close in one table
    raw = raw[:300] + [c * 1.026 for c in raw[300:]]               # adjusted history spliced to raw closes
    flags = _flags(_cross(tmp_path, raw, adj), "cross_table")
    assert [f["date"] for f in flags] == [DATES[150], DATES[300]]
    assert "one session" in flags[0]["detail"] and "spliced" in flags[1]["detail"]
    assert not any(f["blocking"] for f in flags)


def test_unreadable_rows_are_counted_never_silently_dropped(tmp_path):
    conn = _db(tmp_path)
    _put(conn, "SPY", DATES[:100], _walk(100))
    conn.execute("INSERT INTO asset_prices VALUES ('SPY', '1d', '2026-13-01', 1.0, 'yfinance', 1.0)")
    conn.execute("INSERT INTO asset_prices VALUES ('SPY', '1d', '2030-01-01', 'n/a', 'yfinance', 1.0)")
    conn.commit()
    out = q.run(conn)
    assert out["skipped"] == {"asset_prices: malformed date": 1, "asset_prices: non-numeric close": 1}


def test_an_older_layout_without_volume_still_runs(tmp_path):
    conn = sqlite3.connect(tmp_path / "old.db")
    conn.execute("CREATE TABLE asset_prices (symbol TEXT, interval TEXT, date TEXT, close REAL, provider TEXT)")
    closes = _walk(len(DATES))
    closes[200] = closes[199]
    conn.executemany("INSERT INTO asset_prices VALUES (?,?,?,?,?)", [("SPY", "1d", d, c, "yfinance") for d, c in zip(DATES, closes)])
    conn.commit()
    out = q.run(conn)
    assert out["series"] == 1 and not [f for f in out["flags"] if f["check"] == "stale"]


def test_an_accepted_flag_never_blocks(tmp_path, monkeypatch):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c / 2 for c in closes[300:]]
    _put(conn, "XLK", DATES, closes)
    (f,) = _flags(conn, "split")
    k = ("split", "asset_prices", "XLK", "1d", DATES[300])
    monkeypatch.setitem(q.ACCEPTED, k, (f["move"], "checked against the issuer's notice"))
    (f,) = _flags(conn, "split")
    assert f["blocking"] is False and f["accepted"] == "checked against the issuer's notice"
    # the acceptance is bound to the move that was checked: another move on that date still blocks
    monkeypatch.setitem(q.ACCEPTED, k, (f["move"] + 0.5, "checked against the issuer's notice"))
    (f,) = _flags(conn, "split")
    assert f["blocking"] is True and "accepted" not in f


def test_a_split_ratio_on_the_newest_row_is_judged_by_size_alone(tmp_path):
    """Nothing after the newest row can show the level held (design DR-02): it is no split,
    but a halving is still past the ETF limit, and the detail names the ratio."""
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes[-1] = closes[-2] / 2
    _put(conn, "XLK", DATES, closes)
    assert not _flags(conn, "split")
    (f,) = _flags(conn, "implausible")
    assert f["date"] == DATES[-1] and f["blocking"] and "unconfirmed on the newest row" in f["detail"]


def test_a_different_move_on_a_known_date_is_a_new_flag(tmp_path):
    """Design DR-03: the previous snapshot's split at a date does not cover a different split there."""
    prev, cur = _db(tmp_path, "p.db"), _db(tmp_path, "c.db")
    closes = _walk(len(DATES))
    _put(prev, "XLK", DATES, closes[:300] + [c / 2 for c in closes[300:]])
    _put(cur, "XLK", DATES, closes[:300] + [c / 3 for c in closes[300:]])
    got = q.compare(q.run(cur), q.run(prev))
    (f,) = [f for f in got["flags"] if f["check"] == "split"]
    assert f["new"] is True and f["blocking"]
    same = q.compare(q.run(prev), q.run(prev))
    assert [f["new"] for f in same["flags"] if f["check"] == "split"] == [False]


def test_extreme_finite_closes_never_abort_the_check(tmp_path):
    """Design DR-05: a ratio of two finite closes can underflow or overflow; logs are differenced."""
    conn = _db(tmp_path)
    _put(conn, "XLK", DATES[:4], [1e308, 1e-308, 1e308, 5.0])
    _put(conn, "SPY", DATES[:3], [1e-308, 1e308, 1e308], table="market_daily")
    _put(conn, "SPY", DATES[:3], [1e308, 1e-308, 1.0])
    _put(conn, "DGS10", DATES[:3], [1.7e308, -1.7e308, 4.0], table="desk_series")
    out = q.run(conn)
    assert {f["check"] for f in out["flags"]} >= {"implausible"}


def test_rows_centuries_apart_are_scanned_only_over_the_calendar_years(tmp_path):
    conn = _db(tmp_path)
    _put(conn, "SPY", ["0001-01-02", "1962-01-02", "9999-12-30"], [1.0, 1.0, 1.0])
    out = q.run(conn)  # returns at once; the gap check sees only 1962-2027
    gaps = [f for f in out["flags"] if f["check"] == "gap"]
    assert len(gaps) == 1 and gaps[0]["date"] == "9999-12-30"


def test_compare_marks_new_and_known_and_says_when_it_could_not(tmp_path):
    a = {"flags": [{"check": "gap", "table": "t", "series": "s", "interval": "1d", "date": "2026-01-02", "blocking": False}]}
    b = {"flags": a["flags"] + [{"check": "split", "table": "t", "series": "s", "interval": "1d", "date": "2026-01-05", "blocking": True}]}
    got = q.compare(b, a)
    assert got["judged"] and [f["new"] for f in got["flags"]] == [False, True]
    assert q.compare(b, None) == {"judged": False, "flags": [{**f, "new": None} for f in b["flags"]]}
    assert q.counts(got["flags"]) == {"gap": {"total": 1, "new": 0, "blocking_class": 0},
                                      "split": {"total": 1, "new": 1, "blocking_class": 1}}


# ── the validator ────────────────────────────────────────────────────────────────────────────────────────


def _history(path: Path, *, split_on: str | None = None, gap: str | None = None):
    """The validate_db fixture plus a year of SPY closes in asset_prices before its newest row."""
    conn = sqlite3.connect(path)
    dates = _sessions("2026-09-03", 300)
    closes = _walk(len(dates), start=480.0)
    if split_on:
        i = dates.index(split_on)
        closes = closes[:i] + [c / 2 for c in closes[i:]]
    rows = [("SPY", "1d", d, c, "yfinance") for d, c in zip(dates, closes) if d != gap]
    conn.executemany("INSERT OR REPLACE INTO asset_prices VALUES (?,?,?,?,?)", rows)
    conn.execute("UPDATE asset_prices SET close = ? WHERE symbol = 'SPY' AND interval = '1d' AND date = '2026-09-04'",
                 (closes[-1] * 1.001,))
    conn.commit()
    conn.close()


def test_a_new_split_fails_validation(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _history(prev)
    _make(cur)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "fail" and rep["upload"] is False
    (msg,) = [f for f in rep["failures"] if f.startswith("price quality")]
    assert "split in asset_prices SPY 2026-08-03" in msg and "New in this snapshot" in msg
    assert [f["date"] for f in rep["price_quality"]["failed"]] == ["2026-08-03"]
    md = v.summary_markdown(rep)
    assert "**Price quality**" in md and "FAILED, new split: asset_prices SPY 2026-08-03" in md


def test_a_split_the_published_database_already_carries_is_reported_not_blocking(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev, split_on="2026-08-03")
    _make(cur, rows_news=60)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert not [f for f in rep["failures"] if f.startswith("price quality")], rep["failures"]
    assert rep["verdict"] == "pass"
    assert [f["date"] for f in rep["price_quality"]["known_blocking_class"]] == ["2026-08-03"]
    assert "known, already published (never blocking): split asset_prices SPY 2026-08-03" in v.summary_markdown(rep)


def test_without_a_previous_snapshot_nothing_blocks_and_the_report_says_why(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, None, "verify-only", now=NOW)
    assert not [f for f in rep["failures"] if f.startswith("price quality")]
    assert any("not judged, because no previous snapshot" in w and "split asset_prices SPY 2026-08-03" in w for w in rep["warnings"])
    assert rep["price_quality"]["judged"] is False


def test_a_new_advisory_flag_warns_and_publishes(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev)
    _make(cur, rows_news=60)
    _history(cur, gap="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(w.startswith("price quality (gap, advisory): asset_prices SPY 2026-08-04") for w in rep["warnings"])


def test_a_price_quality_check_that_cannot_run_fails(tmp_path, monkeypatch):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)

    def broken(conn):
        raise sqlite3.OperationalError("no such column: close")

    monkeypatch.setattr(v.quality, "run", broken)
    rep = v.validate(cur, prev, "full", now=NOW)
    assert any(f.startswith("check not executed: price quality") for f in rep["failures"])
    assert any(f.startswith("check not executed on the previous snapshot: price quality") for f in rep["failures"])


def test_validate_db_keeps_its_lean_imports():
    """The validator runs on the lean requirement sets; the module it imports is stdlib + api/ only."""
    import ast

    tree = ast.parse((ROOT / "src/market_data/quality.py").read_text())
    mods = {(n.module or "").split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)}
    mods |= {a.name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    import sys

    assert {m for m in mods if m not in sys.stdlib_module_names} <= {"api"}, mods


# ── the published database ───────────────────────────────────────────────────────────────────────────────


@pytest.mark.skipif(not REAL_DB.exists(), reason="data/macro_radar.db not downloaded (see CLAUDE.md)")
def test_the_published_database_holds_no_split_or_implausible_move():
    """On the published copy no stored price carries a split signature or a move past its class limit
    (2026-11-03: 81 series, 360,317 rows). A failure here is a data defect to look at, not a flaky test."""
    conn = sqlite3.connect(f"file:{REAL_DB}?mode=ro", uri=True)
    try:
        out = q.run(conn)
    finally:
        conn.close()
    assert out["series"] > 50 and out["skipped"] == {}
    bad = [f for f in out["flags"] if f["check"] in ("split", "implausible")]
    assert bad == [], bad[:5]


@pytest.mark.skipif(not REAL_DB.exists(), reason="data/macro_radar.db not downloaded (see CLAUDE.md)")
def test_the_published_database_judged_against_itself_has_nothing_new():
    rep = v.validate(REAL_DB, REAL_DB, "verify-only")
    pq = rep["price_quality"]
    assert pq["judged"] and pq["failed"] == [] and pq["new"] == []
    assert not [f for f in rep["failures"] if f.startswith("price quality")]
