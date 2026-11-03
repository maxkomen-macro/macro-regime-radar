"""src/market_data/quality.py and its wiring into scripts/validate_db.py
(Analyst Desk P0c): splits, implausible moves, repeated bars, stale runs,
spikes, jumps, NYSE gaps, off-calendar rows and market_daily/asset_prices
disagreements; every flag advisory, high severity where a bad row goes on screen."""

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


def test_an_unadjusted_split_on_an_etf_is_a_high_severity_split_flag(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c / 2 for c in closes[300:]]  # a 2:1 split the adjustment missed
    _put(conn, "XLK", DATES, closes)
    (f,) = _flags(conn, "split")
    assert (f["series"], f["date"], f["severity"]) == ("XLK", DATES[300], "high")
    assert "1/2" in f["detail"]
    assert not _flags(conn, "implausible")  # the split explains it; one flag, not two


def test_a_reverse_split_is_named_too(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c * 10 for c in closes[300:]]
    _put(conn, "HYG", DATES, closes, table="market_daily")
    (f,) = _flags(conn, "split")
    assert f["table"] == "market_daily" and f["severity"] == "high" and "10x" in f["detail"]


def test_a_halving_that_reverts_is_an_implausible_print_not_a_split(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes[300] = closes[299] / 2
    _put(conn, "XLE", DATES, closes)
    assert not _flags(conn, "split")
    flags = _flags(conn, "implausible")
    assert [f["date"] for f in flags] == [DATES[300], DATES[301]] and all(f["severity"] == "high" for f in flags)


def test_an_index_cannot_split_so_a_halving_is_implausible(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes = closes[:300] + [c / 2 for c in closes[300:]]
    _put(conn, "^GSPC", DATES, closes)
    assert not _flags(conn, "split")
    (f,) = _flags(conn, "implausible")
    assert f["severity"] == "high" and f["date"] == DATES[300]


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
    assert f["series"] == "^VIX" and f["severity"] == "high"


def test_a_repeated_bar_is_stale_and_advisory_but_a_repeated_close_on_new_volume_is_not(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    vols = [1_000_000.0 + i for i in range(len(DATES))]
    closes[200] = closes[199]
    vols[200] = vols[199]           # the whole bar repeats: stale
    closes[250] = closes[249]       # the close repeats on its own volume: ordinary
    _put(conn, "IWM", DATES, closes, volumes=vols)
    (f,) = _flags(conn, "stale")
    assert (f["date"], f["severity"]) == (DATES[200], "advisory")  # two real sessions can match (design DR-01)


def test_a_series_without_volume_is_judged_on_runs_only(tmp_path):
    conn = _db(tmp_path)
    closes = _walk(len(DATES), start=15.0, sigma=0.05)
    closes[100] = closes[101] = closes[99]
    _put(conn, "^VIX", DATES, closes, volumes=[0.0] * len(DATES))
    assert not _flags(conn, "stale")
    (f,) = _flags(conn, "stale_run")
    assert f["date"] == DATES[101] and f["severity"] == "advisory" and "3 rows" in f["detail"]


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
    assert f["severity"] == "high" and f["detail"].startswith("+38") and "bp" in f["detail"]
    assert q._severity("desk_series", "DCOILWTICO", "implausible", q._tier1_desk()) == "advisory"  # tier 2


def test_a_print_that_reverts_is_a_spike_unless_its_peers_moved_too(tmp_path):
    conn = _db(tmp_path)
    jpy = _walk(len(DATES), start=100.0, sigma=0.005, seed=11)
    jpy[300] = jpy[299] * 1.15
    _put(conn, "JPY=X", DATES, jpy, table="desk_series")
    (f,) = _flags(conn, "spike")
    assert (f["series"], f["date"], f["severity"]) == ("JPY=X", DATES[300], "advisory")
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
    assert missing in gap["detail"] and gap["severity"] == "advisory"
    (off,) = _flags(conn, "off_calendar")
    assert off["date"] == "2026-09-07" and off["severity"] == "advisory"


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
    assert all(f["severity"] == "advisory" for f in flags)


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


def test_a_split_ratio_on_the_newest_row_is_judged_by_size_alone(tmp_path):
    """Nothing after the newest row can show the level held (design DR-02): it is no split,
    but a halving is still past the ETF limit, and the detail names the ratio."""
    conn = _db(tmp_path)
    closes = _walk(len(DATES))
    closes[-1] = closes[-2] / 2
    _put(conn, "XLK", DATES, closes)
    assert not _flags(conn, "split")
    (f,) = _flags(conn, "implausible")
    assert f["date"] == DATES[-1] and f["severity"] == "high" and "unconfirmed on the newest row" in f["detail"]


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
    a = {"flags": [{"check": "gap", "table": "t", "series": "s", "interval": "1d", "date": "2026-01-02", "severity": "advisory"}]}
    b = {"flags": a["flags"] + [{"check": "split", "table": "t", "series": "s", "interval": "1d", "date": "2026-01-05", "severity": "high"}]}
    got = q.compare(b, a)
    assert got["judged"] and [f["new"] for f in got["flags"]] == [False, True]
    assert q.compare(b, None) == {"judged": False, "flags": [{**f, "new": None} for f in b["flags"]]}
    assert q.counts(got["flags"]) == {"gap": {"total": 1, "new": 0, "high": 0},
                                      "split": {"total": 1, "new": 1, "high": 1}}


def _split_run(tmp_path, name, closes, dates=DATES):
    conn = _db(tmp_path, name)
    _put(conn, "XLK", dates, closes)
    return q.run(conn)


def test_a_flag_whose_numbers_changed_is_new_and_a_dividend_restatement_is_not(tmp_path):
    base = _walk(len(DATES))
    halved = base[:300] + [c / 2 for c in base[300:]]
    prev = _split_run(tmp_path, "prev.db", halved)
    # Codex S-01: the same split date with a worse stored price is not the flag already published
    worse = _split_run(tmp_path, "worse.db", base[:300] + [c / 10 for c in base[300:]])
    ((f,),) = [[f for f in q.compare(worse, prev)["flags"] if f["check"] == "split"]]
    assert f["date"] == DATES[300] and f["new"] is True
    # an adjusted history restated for a distribution: every close before the ex-date scaled by 0.99
    ex = 350
    restated = _split_run(tmp_path, "restated.db", [c * 0.99 for c in halved[:ex]] + halved[ex:])
    assert [(f["check"], f["new"]) for f in q.compare(restated, prev)["flags"]] == [("split", False)]
    # the same move from a different earlier row (the row before it was dropped) is new
    gone = DATES[299]
    moved = _split_run(tmp_path, "moved.db", [c for d, c in zip(DATES, halved) if d != gone], [d for d in DATES if d != gone])
    assert ("split", True) in [(f["check"], f["new"]) for f in q.compare(moved, prev)["flags"]]


def test_cross_table_gaps_that_widen_are_new_however_small_the_change(tmp_path):
    # Codex S-02: a 0.40% cross-table gap growing to 1.30% (and any smaller drift) is not the published flag
    def run(step, name):
        conn = _db(tmp_path, name)
        dates, adj = DATES[:5], _walk(5)
        _put(conn, "SPY", dates, adj)
        _put(conn, "SPY", dates, [c * (math.exp(step) if i >= 2 else 1) for i, c in enumerate(adj)], table="market_daily")
        return q.run(conn)
    prev = run(0.004, "prev.db")
    assert [f["check"] for f in prev["flags"]] == ["cross_table"]
    for step, name in ((0.013, "wider.db"), (0.0041, "drift.db")):
        assert [f["new"] for f in q.compare(run(step, name), prev)["flags"]] == [True]
    assert [f["new"] for f in q.compare(run(0.004, "same.db"), prev)["flags"]] == [False]


def test_a_repeated_bar_whose_volume_changed_is_new(tmp_path):
    # Codex S-04: the repeated volume is part of what the stale check measured
    def run(volume, name):
        conn = _db(tmp_path, name)
        vols = [1_000_000.0 + i for i in range(len(DATES))]
        vols[201] = vols[200] = volume
        closes = _walk(len(DATES))
        closes[201] = closes[200]
        _put(conn, "SPY", DATES, closes, volumes=vols)
        return q.run(conn)
    prev = run(1_000_000.0, "prev.db")
    assert [f["check"] for f in prev["flags"]] == ["stale"]
    assert [f["new"] for f in q.compare(run(1.0, "cur.db"), prev)["flags"]] == [True]
    assert [f["new"] for f in q.compare(run(1_000_000.0, "same.db"), prev)["flags"]] == [False]


def test_a_restated_history_keeps_its_moves_to_float_noise(tmp_path):
    # the tolerance holds a real restatement: scaling every close before an ex-date by a
    # distribution factor moves no observation of a flag away from that date by 1e-9
    base = _walk(len(DATES))
    halved = base[:300] + [c / 2 for c in base[300:]]
    prev = _split_run(tmp_path, "p.db", halved)
    for k in (0.9999, 0.99, 0.956):
        cur = _split_run(tmp_path, f"k{k}.db", [c * k for c in halved[:350]] + halved[350:])
        (a,), (b,) = prev["flags"], cur["flags"]
        assert abs(a["observed"][1] - b["observed"][1]) < 1e-9


def test_observations_match_only_within_the_tolerance():
    assert q._same_observation(["2026-01-02", -0.693], ["2026-01-02", -0.693 + 1e-9])
    assert not q._same_observation(["2026-01-02", -0.693], ["2026-01-02", -0.6929])
    assert not q._same_observation(["2026-01-02", -0.693], ["2026-01-02", -0.71])
    assert not q._same_observation(["2026-01-02", -0.693], ["2026-01-05", -0.693])
    assert not q._same_observation(["2026-01-02", 3], ["2026-01-02", 4])
    assert not q._same_observation(["2026-01-02", 0.1], ["2026-01-02", None])
    assert not q._same_observation(["2026-01-02"], ["2026-01-02", 0.1])


# ── the validator ────────────────────────────────────────────────────────────────────────────────────────


def _history(path: Path, *, split_on: str | None = None, gap: str | None = None, factor: float = 2.0):
    """The validate_db fixture plus a year of SPY closes in asset_prices before its newest row."""
    conn = sqlite3.connect(path)
    dates = _sessions("2026-09-03", 300)
    closes = _walk(len(dates), start=480.0)
    if split_on:
        i = dates.index(split_on)
        closes = closes[:i] + [c / factor for c in closes[i:]]
    rows = [("SPY", "1d", d, c, "yfinance") for d, c in zip(dates, closes) if d != gap]
    conn.executemany("INSERT OR REPLACE INTO asset_prices VALUES (?,?,?,?,?)", rows)
    conn.execute("UPDATE asset_prices SET close = ? WHERE symbol = 'SPY' AND interval = '1d' AND date = '2026-09-04'",
                 (closes[-1] * 1.001,))
    conn.commit()
    conn.close()


def test_a_new_split_is_named_but_never_blocks(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev)
    _make(cur, rows_news=60)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass" and rep["upload"] is True, rep["failures"]
    assert not [f for f in rep["failures"] if "price quality" in f]
    (msg,) = [w for w in rep["warnings"] if w.startswith("price quality (split")]
    assert msg.startswith("price quality (split, high severity, new): asset_prices SPY 2026-08-03") and "never blocking" in msg
    assert [(f["check"], f["date"], f["new"]) for f in rep["price_quality"]["high"]] == [("split", "2026-08-03", True)]
    md = v.summary_markdown(rep)
    assert "**Price quality** (advisory, never blocking)" in md and "- high severity, new: split asset_prices SPY 2026-08-03" in md


def test_a_known_split_is_counted_not_warned(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev, split_on="2026-08-03")
    _make(cur, rows_news=60)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert not [w for w in rep["warnings"] if w.startswith("price quality (split")]
    assert rep["price_quality"]["counts"]["split"] == {"total": 1, "new": 0, "high": 1}
    assert "- high severity, known: split asset_prices SPY 2026-08-03" in v.summary_markdown(rep)


def test_a_known_split_whose_price_got_worse_warns_again(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev, split_on="2026-08-03")
    _make(cur, rows_news=60)
    _history(cur, split_on="2026-08-03", factor=10.0)
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert [w for w in rep["warnings"] if w.startswith("price quality (split, high severity, new): asset_prices SPY 2026-08-03")]
    assert rep["price_quality"]["counts"]["split"] == {"total": 1, "new": 1, "high": 1}


def test_without_a_previous_snapshot_high_severity_flags_are_one_warning(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur)
    _history(cur, split_on="2026-08-03")
    rep = v.validate(cur, None, "verify-only", now=NOW)
    assert not [f for f in rep["failures"] if "price quality" in f]
    assert any("not judged new or known because no previous snapshot" in w and "split asset_prices SPY 2026-08-03" in w
               for w in rep["warnings"])
    assert rep["price_quality"]["judged"] is False


def test_a_new_advisory_flag_warns_and_publishes(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev)
    _make(cur, rows_news=60)
    _history(cur, gap="2026-08-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(w.startswith("price quality (gap, advisory, new): asset_prices SPY 2026-08-04") for w in rep["warnings"])


def test_a_price_quality_check_that_cannot_run_is_a_warning(tmp_path, monkeypatch):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _make(cur, rows_news=60)

    def broken(conn):
        raise sqlite3.OperationalError("no such column: close")

    monkeypatch.setattr(v.quality, "run", broken)
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(w.startswith("advisory check not run: price quality") for w in rep["warnings"])
    assert any(w.startswith("advisory check not run on the previous snapshot: price quality") for w in rep["warnings"])
    assert rep["price_quality"] == {}


def test_the_quality_checks_change_no_verdict_on_the_validator_fixtures(tmp_path):
    """C1: the price-quality block adds warnings and a report section, nothing else: the verdict,
    the upload decision and the changed tables are what they are with the checks switched off."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _history(prev)
    _make(cur, rows_news=60)
    _history(cur, split_on="2026-08-03", gap="2026-07-01")
    on = v.validate(cur, prev, "full", now=NOW)
    import pytest as _pytest
    with _pytest.MonkeyPatch.context() as mp:
        mp.setattr(v, "PRICE_TABLES", ())
        off = v.validate(cur, prev, "full", now=NOW)
    for k in ("verdict", "upload", "changed", "changed_tables", "failures"):
        assert on[k] == off[k], k
    assert [w for w in on["warnings"] if not w.startswith("price quality")] == off["warnings"]


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
    assert pq["judged"] and pq["new"] == []
    assert not [w for w in rep["warnings"] if w.startswith("price quality")]
