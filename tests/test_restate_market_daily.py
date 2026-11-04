"""scripts/restate_market_daily.py: written and tested here, never run against
the published database by a session.

B6 (2026-09-18): four stored daily "closes" are mid-session prices (2026-09-01,
09-02, 09-03 and 09-10 for all 23 symbols). Owner decision 2026-11-04 (option
A): market_daily is one consistently unadjusted history, so the restatement
fetches unadjusted bars, and SPY's 1993-01-29..2024-02-26 dividend-adjusted
backfill (the provider splice) is replaced the same way. These tests pin the
behaviour on a temporary database with a stubbed fetch: dry run by default, a
basis check against neighbouring stored rows, no partial runs, never an
insert, a byte-identical snapshot before any write, and an unfinished session
refused.
"""

from __future__ import annotations

import hashlib
import json
import math
import sqlite3
from datetime import datetime, timezone

import pandas as pd
import pytest

from scripts import restate_market_daily as rs

COLS = ["symbol", "date", "open", "high", "low", "close", "volume", "vwap"]
AFTER_CLOSE = datetime(2026, 9, 19, 0, 30, tzinfo=timezone.utc)
DIV = 0.98   # a dividend-adjusted fetch scales earlier closes by this


class Official:
    """Unadjusted daily bars as the vendor serves them after the close.

    `adjusted` imitates auto_adjust=True: rows before `ex_date` are scaled by
    DIV whatever the caller asks for, the way a wrong-basis fetch looks."""

    def __init__(self, bars=None, adjusted=False, ex_date="2026-09-04"):
        self.bars = bars if bars is not None else {
            ("SPY", "2026-08-31"): 765.0,
            ("SPY", "2026-09-02"): 766.0,
            ("SPY", "2026-09-03"): 773.11,
            ("SPY", "2026-09-04"): 770.0,
            ("QQQ", "2026-08-31"): 636.0,
            ("QQQ", "2026-09-03"): 640.5,
            ("QQQ", "2026-09-04"): 641.0,
        }
        self.adjusted, self.ex_date = adjusted, ex_date
        self.calls: list[tuple] = []

    def fetch_daily(self, symbol, start, end, auto_adjust=True):
        self.calls.append((symbol, start, end, auto_adjust))
        rows = []
        for (s, d), c in sorted(self.bars.items()):
            if s == symbol and start <= d <= end:
                c = c * DIV if self.adjusted and d < self.ex_date else c
                rows.append((s, d, c, c, c, c, 10.0, None))
        return pd.DataFrame(rows, columns=COLS)


def _make(path, rows):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE market_daily (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL,"
        " volume REAL, vwap REAL, source TEXT, fetched_at TEXT, UNIQUE(symbol, date))"
    )
    conn.executemany(
        "INSERT INTO market_daily (symbol, date, open, high, low, close, volume, source, fetched_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()
    conn.close()
    return path


def _bar(symbol, day, close, volume=10.0, fetched="2026-09-05T04:00:00"):
    return (symbol, day, close, close, close, close, volume, "yfinance", fetched)


@pytest.fixture()
def db(tmp_path):
    return _make(tmp_path / "md.db", [
        _bar("SPY", "2026-08-31", 765.0),
        ("SPY", "2026-09-03", 770.0, 771.0, 767.0, 768.66, 5.0, "yfinance", "2026-09-03T17:47:00"),
        _bar("SPY", "2026-09-04", 770.0),
        _bar("QQQ", "2026-08-31", 636.0),
        ("QQQ", "2026-09-03", 639.0, 640.0, 637.0, 638.0, 4.0, "yfinance", "2026-09-03T17:47:00"),
        _bar("QQQ", "2026-09-04", 641.0),
    ])


def _row(path, symbol, day):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        r = conn.execute("SELECT * FROM market_daily WHERE symbol=? AND date=?", (symbol, day)).fetchone()
        return dict(r) if r else None
    finally:
        conn.close()


def _close(path, symbol, day):
    r = _row(path, symbol, day)
    return r["close"] if r else None


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_dry_run_reports_and_writes_nothing(db):
    before = _sha(db)
    client = Official()
    rep = rs.restate(db, dates=["2026-09-03"], symbols=["SPY", "QQQ"], client=client, apply=False, now=AFTER_CLOSE)
    rows = {(r["symbol"], r["date"]): r for r in rep["rows"]}
    assert rows[("SPY", "2026-09-03")]["stored_close"] == 768.66
    assert rows[("SPY", "2026-09-03")]["official_close"] == 773.11
    assert rows[("SPY", "2026-09-03")]["changed"] and rows[("SPY", "2026-09-03")]["kind"] == "mid-session"
    assert rep["applied"] is False and rep["db_sha256"] == before and "snapshot" not in rep
    assert "not an independent or exchange-official source check" in rep["source_check"]
    assert {(a["symbol"], a["date"]) for a in rep["anchors"]} == {
        ("SPY", "2026-08-31"), ("SPY", "2026-09-04"), ("QQQ", "2026-08-31"), ("QQQ", "2026-09-04")}
    assert _sha(db) == before and not list(db.parent.glob("*.pre-restate-*"))


def test_every_fetch_asks_for_unadjusted_bars(db):
    client = Official()
    rs.restate(db, dates=["2026-09-03"], symbols=["SPY", "QQQ"], client=client, now=AFTER_CLOSE)
    assert client.calls and all(c[3] is False for c in client.calls)


def test_apply_overwrites_only_the_named_rows_that_exist(db):
    rep = rs.restate(db, dates=["2026-09-02", "2026-09-03"], symbols=["SPY"], client=Official(), apply=True,
                     now=AFTER_CLOSE)
    assert rep["applied"] is True
    got = _row(db, "SPY", "2026-09-03")
    assert (got["open"], got["high"], got["low"], got["close"], got["volume"]) == (773.11, 773.11, 773.11, 773.11, 10.0)
    assert got["fetched_at"] == "2026-09-19T00:30:00"
    assert _close(db, "QQQ", "2026-09-03") == 638.0  # not named
    assert _row(db, "SPY", "2026-09-04")["fetched_at"] == "2026-09-05T04:00:00"  # an anchor is read, never written
    assert _close(db, "SPY", "2026-09-02") is None  # never inserted: restating is not backfilling


def test_apply_keeps_a_byte_identical_snapshot_first(db, tmp_path):
    before_bytes = db.read_bytes()
    snap = tmp_path / "keep.db"
    rep = rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=Official(), apply=True, now=AFTER_CLOSE,
                     snapshot=snap)
    assert snap.read_bytes() == before_bytes
    assert rep["snapshot"] == str(snap) and rep["snapshot_sha256"] == hashlib.sha256(before_bytes).hexdigest()
    assert _close(snap, "SPY", "2026-09-03") == 768.66 and _close(db, "SPY", "2026-09-03") == 773.11


def test_the_default_snapshot_sits_beside_the_database_and_is_never_overwritten(db):
    rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=Official(), apply=True, now=AFTER_CLOSE)
    snaps = list(db.parent.glob("md.pre-restate-20260919T003000Z.db"))
    assert len(snaps) == 1 and _close(snaps[0], "SPY", "2026-09-03") == 768.66
    after = _sha(db)
    with pytest.raises(SystemExit, match="already exists"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=Official(), apply=True, now=AFTER_CLOSE)
    assert _sha(db) == after and _close(snaps[0], "SPY", "2026-09-03") == 768.66


def test_an_unfinished_session_is_refused(db):
    before = _sha(db)
    mid_session = datetime(2026, 9, 18, 15, 0, tzinfo=timezone.utc)
    with pytest.raises(SystemExit, match="not complete"):
        rs.restate(db, dates=["2026-09-18"], symbols=["SPY"], client=Official(), apply=True, now=mid_session)
    assert _sha(db) == before and not list(db.parent.glob("*.pre-restate-*"))


def test_a_fetch_on_another_basis_is_refused_before_anything_is_written(db):
    """The old script fetched auto_adjust=True: dividend-adjusted closes, up to
    0.59% off on the real September rows. The anchors catch it."""
    before = _sha(db)
    with pytest.raises(SystemExit, match="not on the stored basis"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY", "QQQ"], client=Official(adjusted=True), apply=True,
                   now=AFTER_CLOSE)
    assert _sha(db) == before and not list(db.parent.glob("*.pre-restate-*"))


def test_an_anchor_inside_the_tolerance_passes_and_one_outside_refuses(db):
    inside = Official()
    inside.bars[("SPY", "2026-08-31")] = 765.0 * math.exp(rs.BASIS_TOL * 0.5)
    rep = rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=inside, now=AFTER_CLOSE)
    assert max(abs(a["log_diff"]) for a in rep["anchors"]) == pytest.approx(rs.BASIS_TOL * 0.5)
    outside = Official()
    outside.bars[("SPY", "2026-08-31")] = 765.0 * math.exp(rs.BASIS_TOL * 2)
    with pytest.raises(SystemExit, match="2026-08-31"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=outside, now=AFTER_CLOSE)


def test_one_missing_bar_refuses_the_whole_run(db):
    """No partial restatement: QQQ's bar is missing, so SPY is not written either."""
    before = _sha(db)
    client = Official()
    del client.bars[("QQQ", "2026-09-03")]
    with pytest.raises(SystemExit, match="QQQ 2026-09-03"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY", "QQQ"], client=client, apply=True, now=AFTER_CLOSE)
    assert _sha(db) == before


def test_a_missing_anchor_bar_or_no_neighbour_at_all_is_refused(tmp_path, db):
    client = Official()
    del client.bars[("SPY", "2026-09-04")]
    with pytest.raises(SystemExit, match="anchor row has no fetched bar"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=client, now=AFTER_CLOSE)
    lonely = _make(tmp_path / "lonely.db", [_bar("SPY", "2026-09-03", 768.66)])
    with pytest.raises(SystemExit, match="no stored neighbour"):
        rs.restate(lonely, dates=["2026-09-03"], symbols=["SPY"], client=Official(), now=AFTER_CLOSE)


def test_a_bad_fetched_close_is_refused(db):
    for bad in (0.0, -1.0, float("nan"), float("inf")):
        client = Official()
        client.bars[("SPY", "2026-09-03")] = bad
        with pytest.raises(SystemExit, match="no usable fetched bar"):
            rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=client, apply=True, now=AFTER_CLOSE)
    assert _close(db, "SPY", "2026-09-03") == 768.66


def test_uncheckpointed_writes_are_refused(db):
    wal = db.with_name(db.name + "-wal")
    wal.write_bytes(b"x")
    with pytest.raises(SystemExit, match="uncheckpointed"):
        rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=Official(), apply=True, now=AFTER_CLOSE)
    assert _close(db, "SPY", "2026-09-03") == 768.66 and not list(db.parent.glob("*.pre-restate-*"))


def test_an_unchanged_row_is_reported_but_not_rewritten(db):
    client = Official()
    client.bars[("SPY", "2026-09-03")] = 768.66
    conn = sqlite3.connect(db)
    conn.execute("UPDATE market_daily SET open=768.66, high=768.66, low=768.66, volume=10.0"
                 " WHERE symbol='SPY' AND date='2026-09-03'")
    conn.commit()
    conn.close()
    rep = rs.restate(db, dates=["2026-09-03"], symbols=["SPY"], client=client, apply=True, now=AFTER_CLOSE)
    assert [r["changed"] for r in rep["rows"]] == [False]
    assert _row(db, "SPY", "2026-09-03")["fetched_at"] == "2026-09-03T17:47:00"


# ── the SPY splice ────────────────────────────────────────────────────────────
# Stored like the published copy: a dividend-adjusted Yahoo block up to
# 2024-02-26, then Polygon's traded closes. Numbers are the real closes
# (Yahoo unadjusted 2024-02-22..26, Polygon 2024-02-27..29); the stored block
# is the 2026-03-13 adjusted backfill, 1/1.0247211 of the traded close.
RAW = {"2024-02-22": 507.50, "2024-02-23": 507.85, "2024-02-26": 505.99,
       "2024-02-27": 506.93, "2024-02-28": 506.26, "2024-02-29": 508.08}
K = 1.0247211


@pytest.fixture()
def splice_db(tmp_path):
    rows = []
    for d, c in RAW.items():
        stored = c / K if d <= "2024-02-26" else c
        rows.append(_bar("SPY", d, stored, fetched="2026-03-13T12:00:00"))
    rows.append(_bar("QQQ", "2024-02-23", 437.0))
    return _make(tmp_path / "splice.db", rows)


def _splice_client():
    return Official(bars={("SPY", d): c for d, c in RAW.items()})


def test_the_splice_replaces_the_adjusted_block_and_fixes_the_boundary_return(splice_db):
    before = math.log(_close(splice_db, "SPY", "2024-02-27") / _close(splice_db, "SPY", "2024-02-26"))
    assert before == pytest.approx(math.log(506.93 / 505.99) + math.log(K))  # the false +2.6% day
    rep = rs.restate(splice_db, dates=[], symbols=["SPY", "QQQ"], client=_splice_client(), ranges=[rs.SPY_SPLICE],
                     apply=True, now=AFTER_CLOSE)
    assert sorted(r["date"] for r in rep["rows"]) == ["2024-02-22", "2024-02-23", "2024-02-26"]
    assert {r["kind"] for r in rep["rows"]} == {"splice"}
    assert {a["date"] for a in rep["anchors"]} == {"2024-02-27", "2024-02-28", "2024-02-29"}
    after = math.log(_close(splice_db, "SPY", "2024-02-27") / _close(splice_db, "SPY", "2024-02-26"))
    assert after == pytest.approx(math.log(506.93 / 505.99))  # +0.19%
    for d, c in RAW.items():
        assert _close(splice_db, "SPY", d) == pytest.approx(c)
    assert _row(splice_db, "SPY", "2024-02-27")["fetched_at"] == "2026-03-13T12:00:00"  # Polygon rows untouched
    assert _close(splice_db, "QQQ", "2024-02-23") == 437.0  # another symbol's rows inside the dates: untouched


def test_each_row_says_why_it_is_restated_when_both_modes_run(tmp_path):
    rows = [_bar("SPY", d, c / K if d <= "2024-02-26" else c) for d, c in RAW.items()]
    rows += [_bar("SPY", "2026-08-31", 765.0), _bar("SPY", "2026-09-03", 768.66), _bar("SPY", "2026-09-04", 770.0)]
    both = _make(tmp_path / "both.db", rows)
    client = _splice_client()
    client.bars.update({("SPY", "2026-08-31"): 765.0, ("SPY", "2026-09-03"): 773.11, ("SPY", "2026-09-04"): 770.0})
    rep = rs.restate(both, dates=["2026-09-03"], symbols=["SPY"], client=client, ranges=[rs.SPY_SPLICE],
                     now=AFTER_CLOSE)
    assert {(r["date"], r["kind"]) for r in rep["rows"]} == {
        ("2024-02-22", "splice"), ("2024-02-23", "splice"), ("2024-02-26", "splice"), ("2026-09-03", "mid-session")}


def test_the_splice_refuses_an_adjusted_fetch(splice_db):
    """Fetching the block dividend-adjusted again would rewrite the same mixed basis."""
    before = _sha(splice_db)
    client = _splice_client()
    client.adjusted, client.ex_date = True, "2024-03-15"  # every fetched row is scaled, anchors included
    with pytest.raises(SystemExit, match="not on the stored basis"):
        rs.restate(splice_db, dates=[], symbols=[], client=client, ranges=[rs.SPY_SPLICE], apply=True, now=AFTER_CLOSE)
    assert _sha(splice_db) == before


def test_the_splice_with_nothing_stored_in_range_is_refused(tmp_path):
    empty = _make(tmp_path / "e.db", [_bar("SPY", "2024-02-27", 506.93)])
    with pytest.raises(SystemExit, match="no stored rows"):
        rs.restate(empty, dates=[], symbols=[], client=_splice_client(), ranges=[rs.SPY_SPLICE], now=AFTER_CLOSE)


def test_the_splice_constant_names_the_published_block():
    assert rs.SPY_SPLICE == ("SPY", "1993-01-29", "2024-02-26")


# ── CLI ───────────────────────────────────────────────────────────────────────

def test_the_cli_defaults_to_a_dry_run_of_the_four_dates():
    args = rs.parse_args(["--dates", "2026-09-01,2026-09-02", "--db", "x.db"])
    assert args.apply is False and args.dates == ["2026-09-01", "2026-09-02"] and args.spy_splice is False
    assert rs.parse_args([]).dates == rs.BAD_CLOSE_DATES
    assert rs.BAD_CLOSE_DATES == ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-10"]
    a = rs.parse_args(["--no-dates", "--spy-splice", "--symbols", "spy, qqq"])
    assert a.dates == [] and a.spy_splice is True and a.symbols == ["SPY", "QQQ"]


def test_the_cli_writes_the_report_and_returns_2_on_a_refusal(monkeypatch, db, tmp_path, capsys):
    import src.market_data.yfinance_client as yc

    monkeypatch.setattr(yc, "YFinanceClient", lambda: Official())
    out = tmp_path / "rep.json"
    assert rs.main(["--db", str(db), "--dates", "2026-09-03", "--symbols", "SPY", "--report", str(out)]) == 0
    rep = json.loads(out.read_text())
    assert rep["rows"][0]["official_close"] == 773.11 and rep["applied"] is False
    assert "dry run, nothing written" in capsys.readouterr().out
    assert _close(db, "SPY", "2026-09-03") == 768.66
    monkeypatch.setattr(yc, "YFinanceClient", lambda: Official(adjusted=True))
    assert rs.main(["--db", str(db), "--dates", "2026-09-03", "--symbols", "SPY", "--apply"]) == 2
    assert "refusing, nothing written" in capsys.readouterr().err
    assert _close(db, "SPY", "2026-09-03") == 768.66


# ── the pipeline's own fetches stay on the same basis ─────────────────────────

def test_the_daily_client_fetches_unadjusted_bars_by_default(monkeypatch):
    import src.market_data.yfinance_client as yc

    seen = {}

    class Ticker:
        def __init__(self, symbol):
            pass

        def history(self, **kw):
            seen.update(kw)
            return pd.DataFrame()

    monkeypatch.setattr(yc.yf, "Ticker", Ticker)
    yc.YFinanceClient().fetch_daily("SPY", "2026-09-01", "2026-09-04")
    assert seen["auto_adjust"] is False


def test_the_history_backfill_fetches_unadjusted_bars(monkeypatch):
    import src.market_data.backfill_yfinance as bf

    seen = {}

    class Ticker:
        def __init__(self, symbol):
            pass

        def history(self, **kw):
            seen.update(kw)
            return pd.DataFrame()

    monkeypatch.setattr(bf.yf, "Ticker", Ticker)
    assert bf.fetch_and_insert("SPY", "1993-01-29", conn=None) == 0
    assert seen["auto_adjust"] is False
