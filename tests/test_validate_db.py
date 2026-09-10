"""scripts/validate_db.py: integrity, table checks, regression detection,
mode-scoped SLA verdicts, the upload decision and the step summary."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import pytest

from scripts import validate_db as v

NOW = datetime(2026, 9, 5, 22, 0, tzinfo=timezone.utc)


def _make(path: Path, *, daily="2026-09-04", news="2026-09-05 19:00:00", regime="2026-07-01", rows_news=50, monthly=("2026-07-01", "2026-07-01", "2026-08-01")):
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

