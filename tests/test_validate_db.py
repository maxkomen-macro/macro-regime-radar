"""scripts/validate_db.py: integrity, table checks, regression detection,
mode-scoped SLA verdicts, the upload decision and the step summary."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts import validate_db as v

NOW = datetime(2026, 9, 5, 22, 0, tzinfo=timezone.utc)


def _make(path: Path, *, daily="2026-09-04", news="2026-09-05 19:00:00", regime="2026-07-01", rows_news=50, monthly=("2026-07-01", "2026-07-01", "2026-08-01"), watermarks=True, histories=True):
    conn = sqlite3.connect(path)
    conn.executescript(
        """
        CREATE TABLE regimes(date TEXT, label TEXT);
        CREATE TABLE signals(date TEXT, name TEXT);
        CREATE TABLE raw_series(series_id TEXT, date TEXT, value REAL);
        CREATE TABLE market_daily(symbol TEXT, date TEXT, close REAL, source TEXT);
        CREATE TABLE market_intraday(symbol TEXT, ts TEXT, close REAL);
        CREATE TABLE news_feed(id INTEGER PRIMARY KEY, published_at TEXT, headline TEXT);
        """
    )
    conn.executemany("INSERT INTO regimes VALUES (?,?)", [(f"2024-{m:02d}-01", "Goldilocks") for m in range(1, 13)] + [(regime, "Goldilocks")])
    conn.executemany("INSERT INTO signals VALUES (?,?)", [(regime, "x")] * 30)
    indpro, cpi, unrate = monthly
    conn.executemany("INSERT INTO raw_series VALUES (?,?,?)", [("INDPRO", indpro, 1.0), ("CPIAUCSL", cpi, 1.0), ("UNRATE", unrate, 4.0), ("DGS10", daily, 4.0), ("DGS2", daily, 3.5), ("VIXCLS", daily, 15.0)] * 10)
    conn.executemany("INSERT INTO market_daily VALUES (?,?,?,?)", [("SPY", daily, 500.0, "yfinance")] * 40)
    conn.executemany("INSERT INTO market_intraday VALUES (?,?,?)", [("SPY", f"{daily} 15:55:00", 500.0)] * 40)
    conn.executemany("INSERT INTO news_feed(published_at, headline) VALUES (?,?)", [(news, f"h{i}") for i in range(rows_news)])
    if histories:
        # fix/prelaunch-1: a full refresh also stores allocation's price
        # histories (src/market_data/asset_history.py), judged in full mode.
        conn.execute("CREATE TABLE asset_prices (symbol TEXT NOT NULL, interval TEXT NOT NULL, date TEXT NOT NULL,"
                     " close REAL NOT NULL, provider TEXT NOT NULL, PRIMARY KEY (symbol, interval, date))")
        conn.executemany("INSERT INTO asset_prices VALUES (?,?,?,?,?)",
                         [("SPY", "1d", daily, 500.0, "yfinance"), ("SPY", "1mo", daily[:8] + "01", 500.0, "yfinance")])
        # desk/event-study: the Desk's daily series, stored by the same full refresh.
        conn.execute("CREATE TABLE desk_series (series_id TEXT NOT NULL, date TEXT NOT NULL, value REAL NOT NULL,"
                     " provider TEXT NOT NULL, PRIMARY KEY (series_id, date))")
        # desk/integration: the five tier-1 series the full refresh stores (the
        # drawer's verdict judges each, verifier V-06).
        conn.executemany("INSERT INTO desk_series VALUES (?,?,?,?)", [(sid, daily, v, "fred") for sid, v in
                                                                       (("DGS10", 4.0), ("DGS2", 3.6), ("T10Y2Y", 0.4), ("VIXCLS", 15.0), ("BAMLH0A0HYM2", 3.0))])
    if watermarks:
        # B6: a full refresh records each FRED daily series' true last observation
        # (raw_series keeps month-stamped rows); checked within this run's window.
        conn.execute(
            "CREATE TABLE source_watermarks (source TEXT PRIMARY KEY, last_obs TEXT, last_value REAL,"
            " advanced_at TEXT, checked_at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT)"
        )
        conn.executemany(
            "INSERT INTO source_watermarks VALUES (?,?,?,?,?,?,?)",
            [(f"fred:{s}", daily, 1.0, "2026-09-05T21:00:00Z", "2026-09-05T21:00:00Z", "ok", None) for s in ("DGS10", "DGS2", "VIXCLS")],
        )
        if histories:
            conn.execute("INSERT INTO source_watermarks VALUES (?,?,?,?,?,?,?)",
                         ("asset_prices", daily, None, "2026-09-05T21:00:00Z", "2026-09-05T21:00:00Z", "ok", "yfinance 1"))
            conn.execute("INSERT INTO source_watermarks VALUES (?,?,?,?,?,?,?)",
                         ("desk_series", daily, None, "2026-09-05T21:00:00Z", "2026-09-05T21:00:00Z", "ok", "fred 2"))
    conn.commit()
    conn.close()


def test_pass_full_and_upload(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-03", news="2026-09-05 17:00:00")
    _make(cur, rows_news=60)
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass" and rep["changed"] is True and rep["upload"] is True
    assert "market_daily" in rep["changed_tables"] and "news_feed" in rep["changed_tables"]
    md = v.summary_markdown(rep)
    assert "**PASS**" in md and "| market_daily |" in md and "Upload: yes" in md


def test_unchanged_news_only_passes_but_skips_upload(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    rep = v.validate(cur, prev, "news-only", now=NOW)
    assert rep["verdict"] == "pass" and rep["changed"] is False and rep["upload"] is False
    assert any("nothing new" in w for w in rep["warnings"])


def test_regression_fails(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-04")
    _make(cur, daily="2026-09-03")
    rep = v.validate(cur, prev, "market-only", now=NOW)
    assert rep["verdict"] == "fail" and any("regressed" in f for f in rep["failures"])
    assert rep["upload"] is False


def test_row_loss_fails_for_core_tables_but_not_rolling_windows(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, rows_news=100)
    _make(cur, rows_news=50)
    rep = v.validate(cur, prev, "news-only", now=NOW)
    assert not any("rows fell" in f for f in rep["failures"])  # news ages out by design
    # A core table losing a fifth of its rows is a regression.
    conn = sqlite3.connect(cur)
    conn.execute("DELETE FROM raw_series WHERE rowid % 2 = 0")
    conn.commit()
    conn.close()
    rep = v.validate(cur, prev, "full", now=NOW)
    assert any("raw_series: rows fell" in f for f in rep["failures"])


def test_stale_fails_unless_documented(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur, news="2026-09-01 10:00:00")
    rep = v.validate(cur, None, "news-only", now=NOW)
    assert rep["verdict"] == "fail" and "outside SLA" in rep["failures"][0]
    rep = v.validate(cur, None, "news-only", allow_stale="news vendors down, owner-approved", now=NOW)
    assert rep["verdict"] == "pass" and any("allowed" in w for w in rep["warnings"])
    # market-only mode does not judge news at all
    rep = v.validate(cur, None, "market-only", now=NOW)
    assert rep["verdict"] == "pass"


def test_corrupt_and_empty_fail(tmp_path):
    bad = tmp_path / "bad.db"
    bad.write_bytes(b"not a database at all")
    rep = v.validate(bad, None, "full", now=NOW)
    assert rep["verdict"] == "fail" and "unusable" in rep["failures"][0]
    empty = tmp_path / "empty.db"
    conn = sqlite3.connect(empty)
    conn.execute("CREATE TABLE regimes(date TEXT)")
    conn.commit()
    conn.close()
    rep = v.validate(empty, None, "full", now=NOW)
    assert any("missing table" in f for f in rep["failures"]) and any("empty" in f for f in rep["failures"])


def test_cli_writes_summary_and_outputs(tmp_path, capsys):
    cur = tmp_path / "cur.db"
    _make(cur)
    summary, out, js = tmp_path / "summary.md", tmp_path / "out.txt", tmp_path / "rep.json"
    rc = v.main([str(cur), "--mode", "verify-only", "--summary", str(summary), "--github-output", str(out), "--json", str(js), "--allow-stale", "unit test clock"])
    assert rc == 0
    assert "Refresh validation" in summary.read_text()
    text = out.read_text()
    assert "verdict=pass" in text and "changed=" in text
    assert js.exists()


def test_regime_blockers_reported(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur)
    rep = v.validate(cur, None, "full", now=NOW)
    blockers = {b["series"]: b["cause"] for b in rep["regime"]["blockers"]}
    assert blockers == {"INDPRO": "publication calendar", "CPIAUCSL": "publication calendar"}


def test_future_dates_fail(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur, daily="2027-12-31")
    rep = v.validate(cur, None, "market-only", now=NOW)
    assert any("in the future" in f for f in rep["failures"]) and rep["upload"] is False


def test_forward_looking_calendar_is_not_a_future_date_fault(tmp_path):
    """event_calendar holds scheduled releases, so its max date is always ahead
    of the clock; that must not trip the future-stamp check (2026-09-10: the
    check rejected a valid Release asset over a December CPI slot)."""
    cur = tmp_path / "cur.db"
    _make(cur)
    conn = sqlite3.connect(cur)
    conn.execute("CREATE TABLE event_calendar(event_datetime TEXT, title TEXT)")
    conn.execute("INSERT INTO event_calendar VALUES ('2026-12-23T13:30:00Z', 'CPI')")
    conn.commit()
    conn.close()
    rep = v.validate(cur, None, "market-only", now=NOW)
    assert not any("in the future" in f for f in rep["failures"])
    assert rep["verdict"] == "pass"


def test_forward_looking_calendar_max_may_move_earlier(tmp_path):
    """B5 (2026-09-19): earnings dates share event_calendar, so a rescheduled
    report can pull the table's max date earlier. That is the schedule
    changing, not data loss: a warning, never a block on publishing. Every
    other table still fails on a regressed max (test_regression_fails)."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    for path, stamp in ((prev, "2027-01-15T12:00:00Z"), (cur, "2027-01-14T21:30:00Z")):
        _make(path)
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE event_calendar(event_datetime TEXT, title TEXT)")
        conn.execute("INSERT INTO event_calendar VALUES (?, 'TSM earnings (Q4 2026)')", (stamp,))
        conn.commit()
        conn.close()
    rep = v.validate(cur, prev, "market-only", now=NOW)
    assert not any("event_calendar" in f for f in rep["failures"]), rep["failures"]
    assert any("event_calendar" in w and "earlier" in w for w in rep["warnings"]), rep["warnings"]
    assert rep["verdict"] == "pass"


def test_unusable_previous_blocks_upload(tmp_path):
    cur, prev = tmp_path / "cur.db", tmp_path / "prev.db"
    _make(cur)
    prev.write_bytes(b"garbage")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert any("previous snapshot unusable" in f for f in rep["failures"])


def test_value_sanity(tmp_path):
    cur = tmp_path / "cur.db"
    _make(cur)
    conn = sqlite3.connect(cur)
    conn.execute("ALTER TABLE regimes ADD COLUMN prob_goldilocks REAL DEFAULT 0.5")
    conn.execute("ALTER TABLE regimes ADD COLUMN prob_overheating REAL DEFAULT 0.2")
    conn.execute("ALTER TABLE regimes ADD COLUMN prob_stagflation REAL DEFAULT 0.2")
    conn.execute("ALTER TABLE regimes ADD COLUMN prob_recession REAL DEFAULT 0.1")
    conn.execute("UPDATE regimes SET prob_recession = 7 WHERE rowid = 1")
    conn.execute("UPDATE market_daily SET close = -1 WHERE rowid = 1")
    conn.commit()
    conn.close()
    rep = v.validate(cur, None, "full", now=NOW)
    assert any("probabilities outside" in f for f in rep["failures"])
    assert any("non-positive close" in f for f in rep["failures"])



# ── B6 (2026-09-18): watermarks, value fingerprints, intraday mode ──────────

def _add_watermarks(path, obs="2026-09-04", checked="2026-09-05T21:00:00Z", sources=("DGS10", "DGS2", "VIXCLS")):
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS source_watermarks (source TEXT PRIMARY KEY, last_obs TEXT, last_value REAL,"
        " advanced_at TEXT, checked_at TEXT NOT NULL, status TEXT NOT NULL, detail TEXT)"
    )
    conn.executemany(
        "INSERT OR REPLACE INTO source_watermarks VALUES (?,?,?,?,?,?,?)",
        [(f"fred:{s}", obs, 1.0, checked, checked, "ok", None) for s in sources],
    )
    conn.commit()
    conn.close()


def test_value_only_fred_update_is_a_change_that_publishes(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    for p in (prev, cur):
        _add_watermarks(p)
    conn = sqlite3.connect(cur)
    conn.execute("UPDATE raw_series SET value = 4.25 WHERE series_id='DGS10'")
    conn.commit()
    conn.close()
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass"
    assert "raw_series" in rep["changed_tables"] and rep["changed"] is True and rep["upload"] is True


def test_checked_at_alone_is_not_a_change_but_an_advance_is(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    _add_watermarks(prev, checked="2026-09-05T04:00:00Z")
    _add_watermarks(cur, checked="2026-09-05T21:00:00Z")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert "source_watermarks" not in rep["changed_tables"] and rep["upload"] is False
    _add_watermarks(prev, obs="2026-09-03")
    rep = v.validate(cur, prev, "full", now=NOW)
    assert "source_watermarks" in rep["changed_tables"] and rep["upload"] is True


def test_full_mode_fails_when_fred_watermarks_are_missing(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur, watermarks=False)
    _add_watermarks(cur, sources=("DGS10", "DGS2"))  # VIXCLS recorded no observation date
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "fail"
    assert any("fred:VIXCLS" in f and "watermark" in f for f in rep["failures"])


def test_fred_outage_checked_this_run_warns_instead_of_blocking(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    _add_watermarks(cur, obs="2026-08-25", checked="2026-09-05T21:30:00Z")  # fetched this run, source not advancing
    rep = v.validate(cur, prev, "full", now=NOW)
    assert not any("fred:DGS10" in f for f in rep["failures"]), rep["failures"]
    assert any("fred:DGS10" in w and "outage" in w for w in rep["warnings"]), rep["warnings"]


def test_fred_not_checked_is_a_failure(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    _add_watermarks(cur, obs="2026-08-25", checked="2026-08-26T04:00:00Z")  # the refresh missed its cycles
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "fail" and any("fred:DGS10" in f for f in rep["failures"])


def test_intraday_mode_is_not_blocked_by_a_stale_daily_close(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev, daily="2026-09-01")
    _make(cur, daily="2026-09-01")
    conn = sqlite3.connect(cur)
    conn.executemany("INSERT INTO market_intraday VALUES (?,?,?)", [("SPY", "2026-09-04 15:55:00", 501.0)] * 5)
    conn.commit()
    conn.close()
    rep = v.validate(cur, prev, "intraday", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any("market_daily" in w for w in rep["warnings"])
    assert rep["upload"] is True


def test_summary_shows_the_watermark_table(tmp_path):
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur)
    _add_watermarks(cur)
    md = v.summary_markdown(v.validate(cur, prev, "full", now=NOW))
    assert "Source watermarks" in md and "| fred:DGS10 | 2026-09-04 |" in md
