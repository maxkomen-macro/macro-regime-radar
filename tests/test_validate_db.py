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
        CREATE TABLE regimes(date TEXT, label TEXT, prob_goldilocks REAL DEFAULT 0.4, prob_overheating REAL DEFAULT 0.3,
                             prob_stagflation REAL DEFAULT 0.2, prob_recession REAL DEFAULT 0.1);
        CREATE TABLE signals(date TEXT, name TEXT);
        CREATE TABLE raw_series(series_id TEXT, date TEXT, value REAL);
        CREATE TABLE market_daily(symbol TEXT, date TEXT, close REAL, source TEXT);
        CREATE TABLE market_intraday(symbol TEXT, ts TEXT, close REAL);
        CREATE TABLE news_feed(id INTEGER PRIMARY KEY, published_at TEXT, headline TEXT);
        """
    )
    conn.executemany("INSERT INTO regimes(date, label) VALUES (?,?)", [(f"2024-{m:02d}-01", "Goldilocks") for m in range(1, 13)] + [(regime, "Goldilocks")])
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
    conn = sqlite3.connect(cur)  # the fixture's regimes carry the four probabilities (verifier V-33)
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


# ── desk/hardening (2026-09-23): tier-2 Desk series warn, never block ────────

TIER1_DESK = ("DGS10", "DGS2", "T10Y2Y", "VIXCLS", "BAMLH0A0HYM2")


def _desk_rows(path, series: dict[str, tuple[str, str, int]], watermarks: dict[str, tuple[str, str]] = {}):
    """Replace desk_series with `series` (id → (provider, last date, row count),
    consecutive weekdays back from the last) and add per-series watermarks
    (id → (status, detail))."""
    from datetime import date as _date, timedelta as _td

    conn = sqlite3.connect(path)
    conn.execute("DELETE FROM desk_series")
    for sid, (provider, last, n) in series.items():
        d, days = _date.fromisoformat(last), []
        while len(days) < n:
            if d.weekday() < 5:
                days.append(d.isoformat())
            d -= _td(days=1)
        conn.executemany("INSERT INTO desk_series VALUES (?,?,?,?)", [(sid, day, 100.0, provider) for day in days])
    for sid, (status, detail) in watermarks.items():
        conn.execute("INSERT OR REPLACE INTO source_watermarks VALUES (?,?,?,?,?,?,?)",
                     (f"desk:{sid}", series.get(sid, (None, None, 0))[1], None, "2026-09-05T21:00:00Z", "2026-09-05T21:00:00Z", status, detail))
    conn.commit()
    conn.close()


def test_a_missing_short_or_behind_tier2_desk_series_warns_and_never_blocks_the_publish(tmp_path):
    """The goal's rule: in scripts/validate_db.py tier-2 Desk series are
    warnings only. Every way a tier-2 series can go wrong in one snapshot: one
    missing with a failed fetch (USD/JPY), one served short and newer-dated
    earlier (Nasdaq 100), one that lost most of its rows (dollar index), one
    weeks behind (WTI). The table's newest date moves earlier because of them,
    which failed the run before this branch; now it publishes, and each
    problem is named in the warnings."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur, rows_news=60)
    # FRED posts next day: tier 1 ends Thu 09-03, the market series the session
    # before NOW (Sat 2026-09-05), Fri 09-04, and hold the table's newest date.
    tier1 = {sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK}
    _desk_rows(prev, {**tier1, "DCOILWTICO": ("fred", "2026-09-03", 30), "^NDX": ("yfinance", "2026-09-04", 30),
                      "DX-Y.NYB": ("yfinance", "2026-09-04", 30), "JPY=X": ("yfinance", "2026-09-04", 30)})
    _desk_rows(cur, {**tier1, "DCOILWTICO": ("fred", "2026-08-14", 30), "^NDX": ("yfinance", "2026-09-03", 30),
                     "DX-Y.NYB": ("yfinance", "2026-09-03", 10)},
               watermarks={"^NDX": ("short", "yfinance; served from 2001-01-02; stored from 2001-01-02; 30 rows; declared 1985-10-01"),
                           "DCOILWTICO": ("short", "fred; served from 2001-01-02; stored from 2001-01-02; 30 rows; declared 1986-01-02"),
                           "JPY=X": ("error", "unavailable")})
    before = v.inspect(prev)["tables"]["desk_series"]
    after = v.inspect(cur)["tables"]["desk_series"]
    assert after["max"] < before["max"], "the table's newest date moved earlier: a failure before tier 2 was judged apart"

    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert rep["upload"] is True and rep["failures"] == []
    desk = next(r for r in rep["sla_all"] if r["feed"] == "desk_series")
    assert desk["verdict"] == "current", desk
    assert "Tier 2, reported and not judged" in desk["reason"] and "WTI crude" in desk["reason"]
    joined = "\n".join(rep["warnings"])
    for needle in ("desk:JPY=X error: unavailable", "desk:^NDX short", "desk:DX-Y.NYB: rows fell 30 → 10",
                   "desk:DX-Y.NYB: newest date moved earlier", "desk:^NDX: newest date moved earlier",
                   "desk:DCOILWTICO short", "desk:DCOILWTICO stale"):  # short and behind: both said (verifier V-11)
        assert needle in joined, (needle, rep["warnings"])
    desk_warnings = [w for w in rep["warnings"] if w.startswith("desk:")]
    assert desk_warnings and all("tier 2, reported, never blocking" in w for w in desk_warnings), desk_warnings

    # A tier-2 series never stored at all (the database before the first tier-2
    # refresh) is the same: named, not judged.
    only1 = tmp_path / "only1.db"
    _make(only1, rows_news=60)
    _desk_rows(only1, tier1)
    rep = v.validate(only1, prev, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    for sid in ("DCOILWTICO", "^NDX", "DX-Y.NYB", "JPY=X"):
        assert any(w.startswith(f"desk:{sid}") and "tier 2" in w for w in rep["warnings"]), (sid, rep["warnings"])


def test_the_same_faults_on_a_tier1_desk_series_still_fail(tmp_path):
    """Tier 1 keeps its teeth: its newest date moving earlier, or a fifth of
    its rows lost, blocks the publish as before."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur, rows_news=60)
    _desk_rows(prev, {sid: ("fred", "2026-09-04", 30) for sid in TIER1_DESK})
    _desk_rows(cur, {sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK})
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "fail" and any(f.startswith("desk_series: max date regressed 2026-09-04 → 2026-09-03") for f in rep["failures"]), rep["failures"]
    _desk_rows(cur, {**{sid: ("fred", "2026-09-04", 30) for sid in TIER1_DESK}, "DGS10": ("fred", "2026-09-04", 2), "DGS2": ("fred", "2026-09-04", 2)})
    rep = v.validate(cur, prev, "full", now=NOW)
    assert rep["verdict"] == "fail" and any(f.startswith("desk_series: rows fell 150 → 94") for f in rep["failures"]), rep["failures"]


# ── desk/hardening, review round 2: R-02 (per-series tier 1) and R-03 (future dates) ──

def test_each_tier1_desk_series_fails_on_its_own_before_any_aggregate(tmp_path):
    """Review R-02: a tier-1 series missing, losing more than 1% of its rows,
    or moving its newest date earlier fails by itself, reported before any
    table-wide check, including where the aggregate would not notice."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur, rows_news=60)
    tier1 = {sid: ("fred", "2026-09-03", 200) for sid in TIER1_DESK}
    _desk_rows(prev, tier1)

    def check(series):
        _desk_rows(cur, series)
        return v.validate(cur, prev, "full", now=NOW)

    # missing: 1000 → 800 rows is not "more than a fifth" for the aggregate
    rep = check({k: x for k, x in tier1.items() if k != "DGS2"})
    assert rep["verdict"] == "fail" and "desk:DGS2 (tier 1): not stored; the full refresh stores it" in rep["failures"], rep["failures"]
    assert "desk:DGS2 (tier 1): 200 rows before, none now" in rep["failures"]
    assert not any(f.startswith("desk_series: rows fell") for f in rep["failures"])
    # row loss: 1.5% of one series fails, 0.5% does not
    rep = check({**tier1, "DGS10": ("fred", "2026-09-03", 197)})
    assert rep["verdict"] == "fail" and "desk:DGS10 (tier 1): rows fell 200 → 197 (more than 1%)" in rep["failures"], rep["failures"]
    rep = check({**tier1, "DGS10": ("fred", "2026-09-03", 199)})
    assert rep["verdict"] == "pass", rep["failures"]
    # one series' newest date earlier while the others advance: the table's newest date does not move back
    rep = check({**{k: ("fred", "2026-09-04", 201) for k in TIER1_DESK}, "DGS2": ("fred", "2026-09-02", 199)})
    assert rep["verdict"] == "fail" and "desk:DGS2 (tier 1): max date regressed 2026-09-03 → 2026-09-02" in rep["failures"], rep["failures"]
    assert not any(f.startswith("desk_series: max date regressed") for f in rep["failures"])
    # when the aggregate fails too, every per-series failure comes first
    rep = check({k: ("fred", "2026-09-02", 200) for k in TIER1_DESK})
    per_series = [i for i, f in enumerate(rep["failures"]) if f.startswith("desk:")]
    aggregate = rep["failures"].index("desk_series: max date regressed 2026-09-03 → 2026-09-02")
    assert len(per_series) == len(TIER1_DESK) and max(per_series) < aggregate, rep["failures"]
    # and without a previous snapshot, a tier-1 series the table lacks still fails in full mode
    _desk_rows(cur, {k: x for k, x in tier1.items() if k != "VIXCLS"})
    rep = v.validate(cur, None, "full", now=NOW)
    assert rep["verdict"] == "fail" and "desk:VIXCLS (tier 1): not stored; the full refresh stores it" in rep["failures"]


def test_a_future_dated_desk_row_fails_for_tier1_and_warns_for_tier2(tmp_path):
    """Review R-03: the future-date check runs per Desk series. A tier-1 series
    dated ahead of the clock fails; a tier-2 one is reported (the store excludes
    such rows and records it) and never blocks the publish."""
    cur = tmp_path / "cur.db"
    _make(cur)

    def with_row(sid, day, wm=None):
        _desk_rows(cur, {**{k: ("fred", "2026-09-03", 30) for k in TIER1_DESK}, "DCOILWTICO": ("fred", "2026-09-03", 30)}, watermarks=wm or {})
        c = sqlite3.connect(cur)
        if sid:
            c.execute("INSERT INTO desk_series VALUES (?, ?, 1.0, 'fred')", (sid, day))
        c.commit()
        c.close()
        return v.validate(cur, None, "full", now=NOW)

    rep = with_row("DGS10", "2026-12-31")
    assert rep["verdict"] == "fail" and "desk:DGS10 (tier 1): max date 2026-12-31 is in the future" in rep["failures"], rep["failures"]
    assert not any(f.startswith("desk_series: max date") for f in rep["failures"]), "judged per series, not table-wide"
    rep = with_row("DCOILWTICO", "2026-12-31")
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(w.startswith("desk:DCOILWTICO: max date 2026-12-31 is in the future") and "tier 2, reported, never blocking" in w
               for w in rep["warnings"]), rep["warnings"]
    # the store's own record of an exclusion is a warning too
    rep = with_row(None, None, wm={"DCOILWTICO": ("excluded", "fred; 1 row dated after 2026-09-05 excluded (tier 2)")})
    assert rep["verdict"] == "pass" and any(w.startswith("desk:DCOILWTICO excluded:") for w in rep["warnings"]), rep["warnings"]
    # another table's future date still fails as before
    c = sqlite3.connect(cur)
    c.execute("INSERT INTO market_daily VALUES ('SPY', '2026-12-31', 500.0, 'yfinance')")
    c.commit()
    c.close()
    assert "market_daily: max date 2026-12-31 is in the future" in v.validate(cur, None, "full", now=NOW)["failures"]


def test_the_non_numeric_and_malformed_date_warnings_agree_in_number(tmp_path):
    """Verifier V-25: "2 non-numeric values; the Desk excludes them on read"."""
    cur = tmp_path / "cur.db"
    _make(cur)
    _desk_rows(cur, {**{k: ("fred", "2026-09-03", 30) for k in TIER1_DESK}, "DCOILWTICO": ("fred", "2026-09-03", 30)})
    c = sqlite3.connect(cur)
    c.execute("UPDATE desk_series SET value = 'n/a' WHERE series_id = 'DCOILWTICO' AND date IN ('2026-09-02', '2026-09-01')")
    c.execute("INSERT INTO desk_series VALUES ('DCOILWTICO', '2010-02-30', 1.0, 'fred')")
    c.commit()
    c.close()
    rep = v.validate(cur, None, "full", now=NOW)
    assert rep["verdict"] == "pass", rep["failures"]
    assert any(w.startswith("desk:DCOILWTICO: 2 non-numeric values; the Desk excludes them on read") for w in rep["warnings"]), rep["warnings"]
    assert any(w.startswith("desk:DCOILWTICO: 1 malformed date; the Desk sets it aside on read") for w in rep["warnings"]), rep["warnings"]


# ── desk/hardening, Codex round 4: R-09 (checks that must run), R-11 (the cutoff) ──

MODES = ["full", "news-only", "market-only", "intraday", "verify-only"]


def _denying(monkeypatch, function: str):
    """validate_db's connections with one SQL function denied by the authorizer."""
    real = v._open

    def deny(action, arg1, arg2, dbname, source):
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() == function:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    def opener(path):
        conn = real(path)
        conn.set_authorizer(deny)
        return conn

    monkeypatch.setattr(v, "_open", opener)


def _four_dgs10_faults(path):
    _desk_rows(path, {sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK})
    c = sqlite3.connect(path)
    c.execute("UPDATE desk_series SET value = 'n/a' WHERE series_id = 'DGS10' AND date = '2026-09-02'")
    c.executemany("INSERT INTO desk_series VALUES ('DGS10', ?, 4.0, 'fred')", [("1999-99-99",), ("1000-01-01",), ("2026-12-31",)])
    c.commit()
    c.close()


def test_the_corruption_checks_run_whatever_else_fails_and_one_that_cannot_run_fails(tmp_path, monkeypatch):
    """Codex R-09: the V-14/V-22/V-26 checks sat in one try block with a
    freshness query using MIN(); with MIN denied, the block was skipped whole
    and four DGS10 faults passed as zero. Each mandatory check now runs on its
    own, and one that cannot run is reported "not executed" and fails, in
    every mode, never read as zero faults."""
    cur = tmp_path / "cur.db"
    _make(cur)
    _four_dgs10_faults(cur)
    _denying(monkeypatch, "min")
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, (mode, rep["failures"])
        for fault in ("desk:DGS10 (tier 1): 1 non-numeric value", "desk:DGS10 (tier 1): 2 malformed dates",
                      "desk:DGS10 (tier 1): max date 2026-12-31 is in the future"):
            assert fault in rep["failures"], (mode, fault, rep["failures"])
        assert rep["corruption"]["desk_series_non_numeric"] == {"DGS10": 1}
        assert rep["corruption"]["desk_series_malformed_dates"] == {"DGS10": 2}
        # every corruption check ran; the one check that uses MIN(), asset_prices' newest daily close, is
        # "not executed" since Codex R-27's audit (it used to fall back to no date)
        assert [n for n in rep["corruption"]["not_executed"] if not n.startswith("asset_prices newest daily closes")] == []
    assert "Corruption checks" in v.summary_markdown(rep)
    # a check that cannot run at all is a failure, never zero faults
    _denying(monkeypatch, "typeof")
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, mode
        missing = [f for f in rep["failures"] if f.startswith("check not executed:")]
        assert any("desk_series non-numeric values" in f for f in missing) and any("desk_series malformed dates" in f for f in missing), (mode, rep["failures"])


def test_a_desk_row_dated_after_the_new_york_date_fails_every_mode(tmp_path):
    """Codex R-11: Desk observation dates were compared with a one-day
    allowance (tomorrow in UTC), so at 2026-09-05 22:00 UTC (18:00 in New
    York, still the 5th) a DGS10 row dated 2026-09-06 passed. They are compared
    with the run's New York as-of, the date every other Desk check uses."""
    cur = tmp_path / "cur.db"
    _make(cur)
    _desk_rows(cur, {sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK})
    c = sqlite3.connect(cur)
    c.execute("INSERT INTO desk_series VALUES ('DGS10', '2026-09-06', 4.0, 'fred')")
    c.commit()
    c.close()
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and "desk:DGS10 (tier 1): max date 2026-09-06 is in the future" in rep["failures"], (mode, rep["failures"])
    # the New York date itself is not in the future
    c = sqlite3.connect(cur)
    c.execute("UPDATE desk_series SET date = '2026-09-05' WHERE series_id = 'DGS10' AND date = '2026-09-06'")
    c.commit()
    c.close()
    assert not any("in the future" in f for f in v.validate(cur, None, "news-only", now=NOW)["failures"])


# ── desk/hardening, verifier round 8: V-32 (the previous snapshot) and V-33 ──

def _denying_on(monkeypatch, path, *, function: str | None = None, pragma: str | None = None):
    """validate_db's connections to `path` alone with one SQL function, or one
    pragma, denied by the authorizer; every other file opens as usual."""
    real = v._open

    def deny(action, arg1, arg2, dbname, source):
        if function and action == sqlite3.SQLITE_FUNCTION and (arg2 or "").lower() == function:
            return sqlite3.SQLITE_DENY
        if pragma and action == sqlite3.SQLITE_PRAGMA and (arg1 or "").lower() == pragma:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    def opener(p):
        conn = real(p)
        if Path(p) == Path(path):
            conn.set_authorizer(deny)
        return conn

    monkeypatch.setattr(v, "_open", opener)


def test_a_previous_snapshot_check_that_cannot_run_fails_every_mode_and_is_named(tmp_path, monkeypatch):
    """Verifier V-32: only the current snapshot's mandatory checks were judged.
    With the previous snapshot's per-series Desk query unable to run, its
    rows were simply absent, so the tier-1 row-loss and date-regression
    comparisons compared nothing and DGS10 losing two thirds of its rows
    passed. That check is now "not executed" on the previous snapshot and
    fails in every mode, named in the failures, the report and the summary;
    so does its integrity check."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    for path in (prev, cur):
        _make(path)
    _desk_rows(prev, {sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK})
    _desk_rows(cur, {**{sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK}, "DGS10": ("fred", "2026-09-03", 10)})
    # the comparison, when it runs, catches the loss
    assert "desk:DGS10 (tier 1): rows fell 30 → 10 (more than 1%)" in v.validate(cur, prev, "news-only", now=NOW)["failures"]
    _denying_on(monkeypatch, prev, function="max")
    for mode in MODES:
        rep = v.validate(cur, prev, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, (mode, rep["failures"])
        named = [f for f in rep["failures"] if f.startswith("check not executed on the previous snapshot: desk_series per-series rows and dates")]
        assert named, (mode, rep["failures"])
        assert ("desk_series (tier 1): the row-loss and date-regression comparisons did not run, "
                "because the previous snapshot's per-series check was not executed") in rep["failures"], (mode, rep["failures"])
        assert any(n.startswith("desk_series per-series rows and dates") for n in rep["corruption"]["previous_not_executed"]), rep["corruption"]
        assert rep["corruption"]["not_executed"] == [], "the current snapshot's checks all ran"
    assert "NOT EXECUTED on the previous snapshot: desk_series per-series rows and dates" in v.summary_markdown(rep)
    # the previous snapshot's integrity check, denied, is not executed and fails too
    _denying_on(monkeypatch, prev, pragma="integrity_check")
    for mode in MODES:
        rep = v.validate(cur, prev, mode, now=NOW)
        assert rep["verdict"] == "fail", mode
        assert any(f.startswith("check not executed on the previous snapshot: integrity_check") for f in rep["failures"]), (mode, rep["failures"])


def _sanity_faults(path):
    """One fault for each value sanity check: a probability of 7, a close of
    −1 in market_daily and a close of 0 in asset_prices."""
    c = sqlite3.connect(path)
    c.execute("UPDATE regimes SET prob_recession = 7 WHERE rowid = 1")
    c.execute("UPDATE market_daily SET close = -1 WHERE rowid = 1")
    c.execute("UPDATE asset_prices SET close = 0 WHERE interval = '1d'")
    c.commit()
    c.close()


SANITY_FAULTS = {
    "regimes probabilities within [0, 1]": "regimes: 1 row(s) with probabilities outside [0, 1]",
    "market_daily non-positive closes": "market_daily: 1 row(s) with a non-positive close",
    "asset_prices non-positive closes": "asset_prices: 1 row(s) with a non-positive close",
}


@pytest.mark.parametrize("broken", list(SANITY_FAULTS))
def test_each_value_sanity_check_runs_on_its_own_and_one_that_cannot_run_fails(tmp_path, broken):
    """Verifier V-33: the probability and non-positive-close checks sat in one
    try block, so an error in any one (the regimes table without its
    probability columns, say) skipped all three with a warning and let the
    other two faults through. Each now runs on its own: with one unable to
    run, the other two still find their faults, and the one that could not
    run is "not executed" and fails, in every mode."""
    cur = tmp_path / "cur.db"
    _make(cur)
    _sanity_faults(cur)
    c = sqlite3.connect(cur)
    if broken.startswith("regimes"):
        c.execute("ALTER TABLE regimes DROP COLUMN prob_recession")
    elif broken.startswith("market_daily"):
        c.execute("ALTER TABLE market_daily RENAME COLUMN close TO last")
    else:
        c.execute("ALTER TABLE asset_prices RENAME COLUMN close TO last")
    c.commit()
    c.close()
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, mode
        for name, fault in SANITY_FAULTS.items():
            if name == broken:
                assert fault not in rep["failures"]
                assert any(f.startswith(f"check not executed: {name} (OperationalError") for f in rep["failures"]), (mode, rep["failures"])
                assert any(n.startswith(name) for n in rep["corruption"]["not_executed"])
            else:
                assert fault in rep["failures"], (mode, name, rep["failures"])
        assert not any("value sanity checks skipped" in w for w in rep["warnings"])


# ── desk/hardening, Codex round 5: R-14 (provenance) and R-17 (backtest recency) ──

def test_a_row_no_committed_refresh_wrote_fails_tier1_and_warns_tier2(tmp_path):
    """Codex R-14: eligibility comes from provenance (api/provenance.py), not from
    the `advanced_at` watermark (V-34). In a migrated store, a row inserted after
    the migration carries no run: validate_db fails it in a tier-1 series and
    warns in a tier-2 one, in every mode, and freshness reads only the rows a
    committed run wrote. The rows stored before the migration were back-filled
    with the committed pre-provenance run, so they stay readable."""
    from datetime import datetime, timezone

    from api import provenance

    cur = tmp_path / "cur.db"
    _make(cur)
    _desk_rows(cur, {**{sid: ("fred", "2026-09-03", 30) for sid in TIER1_DESK}, "JPY=X": ("eodhd", "2026-09-03", 30)})
    c = sqlite3.connect(cur)
    assert provenance.migrate(c, datetime(2026, 9, 4, 12, 0, tzinfo=timezone.utc)) == 6 * 30  # Friday 09-04, before the hand rows
    c.executemany("INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, '2026-09-04', 1.0, 'hand')", [("DGS10",), ("JPY=X",)])
    c.commit()
    c.close()
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and "desk:DGS10 (tier 1): 1 row no committed refresh wrote (no provenance)" in rep["failures"], (mode, rep["failures"])
        assert any(w.startswith("desk:JPY=X: 1 row no committed refresh wrote (no provenance); the Desk sets it aside on read")
                   and "tier 2, reported, never blocking" in w for w in rep["warnings"]), (mode, rep["warnings"])
        assert not any(x.startswith("desk:JPY=X") for x in rep["failures"])
        assert rep["corruption"]["desk_provenance"] is True and rep["corruption"]["desk_series_no_provenance"] == {"DGS10": 1, "JPY=X": 1}
        latest = rep["current"]["fresh"]["desk_series_latest"]
        assert latest["DGS10"] == "2026-09-03" and latest["JPY=X"] == "2026-09-03" and latest["DGS2"] == "2026-09-03", latest
    assert "no provenance {\"DGS10\": 1, \"JPY=X\": 1}" in v.summary_markdown(rep)
    # a store not yet migrated reads as the migration would leave it: nothing judged, every row readable
    old = tmp_path / "old.db"
    _make(old)
    _desk_rows(old, {sid: ("fred", "2026-09-04", 30) for sid in TIER1_DESK})
    rep = v.validate(old, None, "news-only", now=NOW)
    assert rep["corruption"]["desk_provenance"] is False and rep["corruption"]["desk_series_no_provenance"] == {}
    assert rep["current"]["fresh"]["desk_series_latest"]["DGS10"] == "2026-09-04"


def _backtests(path, stamp: str | None, *, column: str = "computed_at"):
    c = sqlite3.connect(path)
    c.execute(f"CREATE TABLE backtest_results (id INTEGER PRIMARY KEY, test_name TEXT, cohort TEXT, horizon TEXT, metric TEXT, value REAL, {column} TEXT)")
    c.execute("INSERT INTO backtest_results VALUES (1, 'SPY_regime_Goldilocks', 'Goldilocks', '1M', 'avg_return', 2.5, ?)", (stamp,))
    c.commit()
    c.close()


def test_a_backtest_rollback_fails_every_mode(tmp_path):
    """Codex R-17: DATE_COLUMNS named a `date` column backtest_results does not
    have, and SQLite read MAX("date") as the string 'date' on both snapshots, so
    older backtests replacing newer ones passed. With computed_at compared, the
    previous snapshot's 2026-09-04 and the current one's 2020-01-01 (equal row
    counts, one news row added) fail every mode. The column must exist, on both
    snapshots: a table without it is a check not executed, and fails."""
    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    _make(cur, rows_news=51)
    _backtests(prev, "2026-09-04T12:00:00")
    _backtests(cur, "2020-01-01T12:00:00")
    for mode in MODES:
        rep = v.validate(cur, prev, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, (mode, rep["failures"])
        assert "backtest_results: max date regressed 2026-09-04T12:00:00 → 2020-01-01T12:00:00" in rep["failures"], (mode, rep["failures"])
    # the column is checked on both snapshots
    gone = tmp_path / "gone.db"
    _make(gone)
    _backtests(gone, "2026-09-04T12:00:00", column="stamped")
    for mode in MODES:
        rep = v.validate(cur, gone, mode, now=NOW)
        assert rep["verdict"] == "fail", mode
        assert any(f.startswith("check not executed on the previous snapshot: backtest_results newest computed_at "
                                "(the table has no computed_at column)") for f in rep["failures"]), (mode, rep["failures"])
        rep = v.validate(gone, None, mode, now=NOW)
        assert any(f.startswith("check not executed: backtest_results newest computed_at") for f in rep["failures"]), (mode, rep["failures"])


# ── desk/hardening, Codex round 6: R-20, a refresh that only restores provenance ──

def test_a_refresh_that_restores_a_series_provenance_is_published(tmp_path, monkeypatch):
    """Codex R-20, Codex's repro: a healthy tier-1 store, refreshed; DGS10's run_id
    cleared in the baseline; the refresh run again with identical provider
    histories. DGS10 became readable again, yet full validation passed with
    upload=False: the Desk fingerprint left provenance out, and full mode's
    publication list left out desk_series_runs. The fingerprint now covers the
    provenance that decides what the Desk reads, full mode publishes the runs
    table, and changed_tables names the series whose readable rows changed."""
    from datetime import timedelta

    from src.market_data import desk_history

    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    c = sqlite3.connect(prev)
    histories: dict[str, list] = {}
    for sid, d, value in c.execute("SELECT series_id, date, value FROM desk_series"):
        histories.setdefault(sid, []).append((d, value))
    c.close()
    monkeypatch.setattr(desk_history, "fred_daily", lambda sid, start: histories[sid])
    desk_history.refresh(prev, now=NOW, tier=1)
    c = sqlite3.connect(prev)
    c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = 'DGS10'")
    c.commit()
    d = sqlite3.connect(cur)
    c.backup(d)
    d.close()
    c.close()
    later = NOW + timedelta(minutes=1)
    out = desk_history.refresh(cur, now=later, tier=1)
    assert "DGS10" in out["stored"]
    rep = v.validate(cur, prev, "full", now=later)
    assert "DGS10" not in rep["previous"]["fresh"]["desk_series_latest"] and rep["current"]["fresh"]["desk_series_latest"]["DGS10"] == "2026-09-04"
    assert rep["verdict"] == "pass" and rep["upload"] is True, (rep["failures"], rep["changed_tables"])
    assert {"desk_series", "desk_series_runs", "desk:DGS10"} <= set(rep["changed_tables"]), rep["changed_tables"]
    assert [t for t in rep["changed_tables"] if t.startswith("desk:")] == ["desk:DGS10"], "only the series whose readable rows changed"
    # an identical second snapshot changes nothing: nothing to publish
    same = v.validate(cur, cur, "full", now=later)
    assert same["changed_tables"] == [] and same["upload"] is False


# ── desk/hardening, verifier round 13: V-39 and V-40, what counts as a Desk change ──

def _refreshed_pair(tmp_path, monkeypatch, *, strip_dgs10: bool = False):
    """The R-20 fixture: a healthy tier-1 store refreshed at NOW with its own
    histories (prev), optionally with DGS10's run_id cleared, and a copy (cur)."""
    from src.market_data import desk_history

    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    c = sqlite3.connect(prev)
    histories: dict[str, list] = {}
    for sid, d, value in c.execute("SELECT series_id, date, value FROM desk_series"):
        histories.setdefault(sid, []).append((d, value))
    c.close()
    monkeypatch.setattr(desk_history, "fred_daily", lambda sid, start: histories[sid])
    desk_history.refresh(prev, now=NOW, tier=1)
    c = sqlite3.connect(prev)
    if strip_dgs10:
        c.execute("UPDATE desk_series SET run_id = NULL WHERE series_id = 'DGS10'")
        c.commit()
    d = sqlite3.connect(cur)
    c.backup(d)
    d.close()
    c.close()
    return prev, cur, desk_history


def _desk_changes(rep) -> list[str]:
    return [t for t in rep["changed_tables"] if t.startswith("desk")]


def test_a_next_day_refresh_of_identical_data_changes_nothing(tmp_path):
    """Verifier V-39 (a): each series' fingerprint took its run's New York date,
    and every refresh re-stamps every row, so a next-day refresh of identical
    data named every Desk series changed and published. A series now changes
    only when what the Desk reads does: a row's value, date or readability. The
    refresh date alone is not a change, so full mode's "nothing new to publish"
    guard holds."""
    from datetime import timedelta

    with pytest.MonkeyPatch.context() as mp:
        prev, cur, desk_history = _refreshed_pair(tmp_path, mp)
        next_day = NOW + timedelta(days=1)  # the next New York day
        out = desk_history.refresh(cur, now=next_day, tier=1)
    assert set(out["stored"]) == set(TIER1_DESK)
    c = sqlite3.connect(cur)
    assert {r[0] for r in c.execute("SELECT r.as_of FROM desk_series d JOIN desk_series_runs r ON r.run_id = d.run_id")} == {"2026-09-06"}
    c.close()
    rep = v.validate(cur, prev, "full", now=next_day)
    assert _desk_changes(rep) == [], rep["changed_tables"]
    assert rep["changed"] is False and rep["upload"] is False
    assert any("nothing new to publish" in w for w in rep["warnings"]), rep["warnings"]


def test_a_full_run_that_commits_nothing_changes_nothing(tmp_path):
    """Verifier V-40 (b): every refresh records a started run, and full mode had
    started publishing the runs table, so a run whose every fetch failed counted
    as changed and uploaded. A run that commits nothing changes nothing the Desk
    reads: no change, no upload."""
    from datetime import timedelta

    with pytest.MonkeyPatch.context() as mp:
        prev, cur, desk_history = _refreshed_pair(tmp_path, mp)

        def fred_down(sid, start):
            raise RuntimeError("FRED down (test)")

        mp.setattr(desk_history, "fred_daily", fred_down)
        later = NOW + timedelta(minutes=1)
        out = desk_history.refresh(cur, now=later, tier=1)
    assert out["stored"] == [] and set(out["failed"]) == set(TIER1_DESK)
    c = sqlite3.connect(cur)
    assert c.execute("SELECT COUNT(*) FROM desk_series_runs WHERE status = 'started'").fetchone()[0] == 1, "the run was recorded"
    c.close()
    rep = v.validate(cur, prev, "full", now=later)
    assert _desk_changes(rep) == [], rep["changed_tables"]
    assert rep["changed"] is False and rep["upload"] is False


def test_a_next_day_provenance_repair_names_the_runs_table_and_dgs10_only(tmp_path):
    """Codex R-20's repro on the next day, as a scheduled refresh would run it
    (c): DGS10's run_id cleared in the baseline, the refresh run the next New
    York day with identical histories. DGS10 is readable again, so the run
    publishes, naming desk_series, the runs table and DGS10 only; every other
    series was re-stamped under a new run and date and reads the same."""
    from datetime import timedelta

    with pytest.MonkeyPatch.context() as mp:
        prev, cur, desk_history = _refreshed_pair(tmp_path, mp, strip_dgs10=True)
        next_day = NOW + timedelta(days=1)
        desk_history.refresh(cur, now=next_day, tier=1)
    c = sqlite3.connect(cur)  # the scheduled run's news, so the verdict judges the Desk alone
    c.execute("INSERT INTO news_feed (published_at, headline) VALUES ('2026-09-06 21:00:00', 'next day')")
    c.commit()
    c.close()
    rep = v.validate(cur, prev, "full", now=next_day)
    assert "DGS10" not in rep["previous"]["fresh"]["desk_series_latest"] and rep["current"]["fresh"]["desk_series_latest"]["DGS10"] == "2026-09-04"
    assert _desk_changes(rep) == ["desk_series", "desk:DGS10", "desk_series_runs"], rep["changed_tables"]
    assert rep["verdict"] == "pass" and rep["upload"] is True, (rep["failures"], rep["changed_tables"])


# ── desk/hardening, Codex round 7: R-23 (fingerprints are mandatory), R-26 (the legacy cutoff) ──

DESK_FP_SELECT = "SELECT d.series_id, d.date, d.value, COALESCE"


def _locked_fingerprint(monkeypatch, paths: set):
    """validate_db's connections to `paths` raise "database is locked" on the Desk
    fingerprint SELECT alone, as Codex injected it."""
    real = v._open

    class Faulty:
        def __init__(self, inner):
            self.c = inner

        def execute(self, sql, *args, **kwargs):
            if sql.startswith(DESK_FP_SELECT):
                raise sqlite3.OperationalError("database is locked")
            return self.c.execute(sql, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.c, name)

    monkeypatch.setattr(v, "_open", lambda p: Faulty(real(p)) if Path(p) in paths else real(p))


def test_a_fingerprint_that_cannot_run_fails_validation_on_either_snapshot(tmp_path):
    """Codex R-23, Codex's repro: DGS10's provenance cleared in the previous
    snapshot, the refresh run again with identical histories, and "database is
    locked" injected into the Desk fingerprint SELECT on the current snapshot,
    the previous one, or both. The failed query read as "unchanged": the
    verdict passed with upload=False and nothing in not_executed, so the
    recovery was never published. Every fingerprint is now a mandatory check on
    both snapshots: each case fails, upload=False, the fingerprint named. With
    no fault the recovery still uploads."""
    from datetime import timedelta

    with pytest.MonkeyPatch.context() as mp:
        prev, cur, desk_history = _refreshed_pair(tmp_path, mp, strip_dgs10=True)
        later = NOW + timedelta(minutes=1)
        desk_history.refresh(cur, now=later, tier=1)
    clean = v.validate(cur, prev, "full", now=later)
    assert clean["verdict"] == "pass" and clean["upload"] is True, (clean["failures"], clean["changed_tables"])
    for where in ({cur}, {prev}, {cur, prev}):
        with pytest.MonkeyPatch.context() as mp:
            _locked_fingerprint(mp, where)
            rep = v.validate(cur, prev, "full", now=later)
        assert rep["verdict"] == "fail" and rep["upload"] is False, (where, rep["failures"])
        corr = rep["corruption"]
        named = ([n for n in corr["not_executed"] if n.startswith("desk_series fingerprint (OperationalError: database is locked)")],
                 [n for n in corr["previous_not_executed"] if n.startswith("desk_series fingerprint (OperationalError: database is locked)")])
        assert bool(named[0]) == (cur in where) and bool(named[1]) == (prev in where), (where, corr)
        assert any("desk_series fingerprint" in f and "not executed" in f for f in rep["failures"]), rep["failures"]


def test_a_legacy_future_row_names_no_series_when_a_copy_is_migrated(tmp_path):
    """Codex R-26 (V-43), Codex's repro: a legacy ('DGS10', '2099-01-01', 4.0)
    row, the database copied and the copy migrated. The legacy fingerprint read
    every row as readable while the migration sets that row after its run's
    New York date, so validation named desk_series, desk:DGS10 and the runs
    table for identical observations. A legacy store is now read with the
    migration's cutoff: nothing is named, and the tier-1 future-date check
    still fails the row."""
    from api import provenance

    prev, cur = tmp_path / "prev.db", tmp_path / "cur.db"
    _make(prev)
    a = sqlite3.connect(prev)
    a.execute("INSERT INTO desk_series (series_id, date, value, provider) VALUES ('DGS10', '2099-01-01', 4.0, 'fred')")
    a.commit()
    b = sqlite3.connect(cur)
    a.backup(b)
    provenance.migrate(b, NOW)
    b.commit()
    a.close()
    b.close()
    rep = v.validate(cur, prev, "full", now=NOW)
    assert [t for t in rep["changed_tables"] if t.startswith("desk")] == [], rep["changed_tables"]
    assert "desk:DGS10 (tier 1): max date 2099-01-01 is in the future" in rep["failures"]
    a, b = (sqlite3.connect(f"file:{x}?mode=ro", uri=True) for x in (prev, cur))
    assert v._desk_fingerprints(a, "2026-09-05") == v._desk_fingerprints(b, "2026-09-05"), "the legacy store reads as its migrated copy"
    a.close()
    b.close()


# ── desk/hardening, Codex round 8: R-27 (the schema check), R-30 (one cutoff across midnight) ──

def test_a_provenance_schema_check_that_cannot_run_fails_validation(tmp_path, monkeypatch):
    """Codex R-27: validate_db read whether the store carries provenance outside any
    guard. It is now a mandatory check read fail-closed: one that keeps failing is
    "not executed" and fails every mode, and nothing that depends on it runs."""
    from api import provenance

    cur = tmp_path / "cur.db"
    _make(cur)
    c = sqlite3.connect(cur)
    provenance.migrate(c, NOW)
    c.commit()
    c.close()
    monkeypatch.setattr(provenance, "SCHEMA_RETRY_WAITS_S", (0.0, 0.0, 0.0))
    real = v._open

    class Locked:
        def __init__(self, inner):
            self.c = inner

        def execute(self, sql, *args, **kwargs):
            if sql.startswith("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?") and args and args[0] == (provenance.RUNS,):
                raise sqlite3.OperationalError("database schema is locked: main")
            return self.c.execute(sql, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self.c, name)

    monkeypatch.setattr(v, "_open", lambda p: Locked(real(p)))
    for mode in MODES:
        rep = v.validate(cur, None, mode, now=NOW)
        assert rep["verdict"] == "fail" and rep["upload"] is False, mode
        assert any(n.startswith("desk_series provenance schema (SchemaCheckFailed: could not read whether desk_series carries provenance")
                   for n in rep["corruption"]["not_executed"]), rep["corruption"]["not_executed"]


def test_a_legacy_row_dated_tomorrow_is_judged_alike_on_both_sides_of_midnight(tmp_path):
    """Codex R-30 (V-46), Codex's repro: a legacy row dated 2026-09-26 in DGS10 and
    in WTI, the copy migrated at 23:50 ET on 09-25, validated at 23:55 and at 00:05
    ET. The legacy side's cutoff was the validation's New York date, the migrated
    side's the migration's, so after midnight each series was named changed, and
    WTI (tier 2, warnings only) uploaded. One explicit cutoff, the run's New York
    date at validation start, now judges both sides: no series is named at either
    time, and WTI does not upload."""
    from datetime import datetime, timedelta, timezone

    from api import provenance

    base = datetime(2026, 9, 26, 3, 50, tzinfo=timezone.utc)  # 23:50 ET, 2026-09-25
    for sid in ("DGS10", "DCOILWTICO"):
        prev, cur = tmp_path / f"prev-{sid}.db", tmp_path / f"cur-{sid}.db"
        _make(prev)
        a = sqlite3.connect(prev)
        a.execute("INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, '2026-09-26', 4.0, 'fred')", (sid,))
        a.commit()
        b = sqlite3.connect(cur)
        a.backup(b)
        provenance.migrate(b, base)
        b.commit()
        b.close()
        a.close()
        for minutes in (5, 15):  # 23:55 ET, then 00:05 ET
            rep = v.validate(cur, prev, "full", now=base + timedelta(minutes=minutes), allow_stale="frozen replay")
            assert [t for t in rep["changed_tables"] if t.startswith("desk")] == [], (sid, minutes, rep["changed_tables"])
            if sid == "DCOILWTICO":
                assert rep["upload"] is False, (minutes, rep["failures"], rep["changed_tables"])


# ── desk/hardening, verifier round 16: V-49, a back-filled row's value is always compared ──

def test_a_changed_value_on_a_back_filled_row_names_its_series_between_migrated_snapshots(tmp_path):
    """Verifier V-49: comparing two migrated snapshots must not miss a real change
    to a row the migration back-filled and dated after the migration. A row's
    date and value are hashed whatever its readability flag, and a back-filled
    row's flag is judged by R-30's explicit cutoff, so a value that changes on
    such a row names its series. A re-stamp that changes only that row's run,
    its date and value alike, is not a change by that rule."""
    from datetime import datetime, timezone

    from api import provenance

    migrated_at = datetime(2026, 9, 26, 3, 50, tzinfo=timezone.utc)  # 23:50 ET, 2026-09-25
    validated_at = datetime(2026, 9, 26, 15, 10, tzinfo=timezone.utc)
    for sid in ("DGS10", "DCOILWTICO"):
        for case in ("value", "restamp"):
            prev, cur = tmp_path / f"prev-{sid}-{case}.db", tmp_path / f"cur-{sid}-{case}.db"
            _make(prev)
            a = sqlite3.connect(prev)
            a.execute("INSERT INTO desk_series (series_id, date, value, provider) VALUES (?, '2026-09-26', 4.0, 'fred')", (sid,))
            a.commit()
            provenance.migrate(a, migrated_at)  # the 09-26 row is back-filled, dated after the migration's 09-25
            a.commit()
            b = sqlite3.connect(cur)
            a.backup(b)
            a.close()
            if case == "value":
                b.execute("UPDATE desk_series SET value = 5.0 WHERE series_id = ? AND date = '2026-09-26'", (sid,))
            else:
                rid, _ = provenance.start_run(b, validated_at)
                b.execute("UPDATE desk_series SET run_id = ?, ingested_at = '2026-09-26T15:00:00Z' WHERE series_id = ? AND date = '2026-09-26'",
                          (rid, sid))
                provenance.mark_committed(b, rid, validated_at)
            b.commit()
            b.close()
            rep = v.validate(cur, prev, "full", now=validated_at, allow_stale="replay")
            named = [t for t in rep["changed_tables"] if t.startswith("desk")]
            if case == "value":
                assert "desk_series" in named and f"desk:{sid}" in named, (sid, named)
            else:
                assert named == [], (sid, named, "a re-stamp alone is not a change under R-30's cutoff")


# ── desk/hardening, verifier round 17: the V-49 gap, readability is part of the fingerprint ──

def _restamped(tmp_path, name: str, sid: str, date: str, prev_run: str, cur_run: str, full: bool = False):
    """Two migrated snapshots of one row, same date and value: written by `prev_run`
    in the previous one and re-stamped under `cur_run` in the current one. A run is
    "committed" or "uncommitted" (started, never committed), dated 09-25 or 09-26
    by its start. Returns the Desk tables validation names at 09-26 15:10Z (with
    `full`, the whole report)."""
    from datetime import datetime, timezone

    from api import provenance

    starts = {"25": datetime(2026, 9, 25, 14, 0, tzinfo=timezone.utc), "26": datetime(2026, 9, 26, 14, 0, tzinfo=timezone.utc)}

    def run(conn, spec: str) -> str:
        kind, day = spec.split("@")
        rid, _ = provenance.start_run(conn, starts[day])
        if kind == "committed":
            provenance.mark_committed(conn, rid, starts[day])
        return rid

    prev, cur = tmp_path / f"prev-{name}.db", tmp_path / f"cur-{name}.db"
    _make(prev)
    a = sqlite3.connect(prev)
    provenance.migrate(a, datetime(2026, 9, 24, 14, 0, tzinfo=timezone.utc))
    rid = run(a, prev_run)
    a.execute("INSERT INTO desk_series (series_id, date, value, provider, run_id, ingested_at) VALUES (?, ?, 4.0, 'fred', ?, "
              "'2026-09-25T14:00:00Z')", (sid, date, rid))
    a.commit()
    b = sqlite3.connect(cur)
    a.backup(b)
    a.close()
    rid = run(b, cur_run)
    b.execute("UPDATE desk_series SET run_id = ?, ingested_at = '2026-09-26T14:00:00Z' WHERE series_id = ? AND date = ?", (rid, sid, date))
    b.commit()
    b.close()
    rep = v.validate(cur, prev, "full", now=datetime(2026, 9, 26, 15, 10, tzinfo=timezone.utc), allow_stale="replay")
    if full:
        return rep
    return [t for t in rep["changed_tables"] if t.startswith("desk")]


def test_a_restamp_is_a_change_exactly_when_it_changes_the_rows_readability(tmp_path):
    """The V-49 gap: readability is part of the fingerprint, judged the same way on
    both snapshots, with R-30's one explicit cutoff. (a) The same value re-stamped
    from an uncommitted run to a committed one, or the reverse, changes whether the
    Desk reads the row: named. (b) Re-stamped from one committed run to another, both
    dated on or after the row, it reads as before: not named. A re-stamp across the
    run's own date is V-56's test, below."""
    sid = "DCOILWTICO"  # tier 2: an uncommitted row warns, so both directions validate
    named = {"desk_series", f"desk:{sid}", "desk_series_runs"}  # the runs table is judged with desk_series
    assert set(_restamped(tmp_path, "a-up", sid, "2026-09-24", "uncommitted@25", "committed@26")) == named
    assert set(_restamped(tmp_path, "a-down", sid, "2026-09-24", "committed@25", "uncommitted@26")) == named
    assert _restamped(tmp_path, "b", sid, "2026-09-24", "committed@25", "committed@26") == []
    assert _restamped(tmp_path, "b-tier1", "DGS10", "2026-09-24", "committed@25", "committed@26") == []


# ── desk/hardening, verifier round 18: V-56, the flag is the reader's, whatever the tier ──

def test_a_restamp_across_its_runs_date_names_its_series_whatever_its_tier(tmp_path):
    """Verifier V-56: the Desk's reader sets aside a row dated after the New York
    date of the run that wrote it, so a row dated 09-26 moved from a committed run
    of 09-25 to one of 09-26 becomes readable, and back again the other way. Both
    name the series, tier 1 or tier 2. Tier decides only whether the current
    snapshot's row dated after its run fails validation (tier 1) or warns (tier 2).
    On the staged code the tier-2 re-stamp named nothing."""
    for sid, tier in (("DCOILWTICO", 2), ("DGS10", 1)):
        named = {"desk_series", f"desk:{sid}", "desk_series_runs"}
        up = _restamped(tmp_path, f"v56-up-{sid}", sid, "2026-09-26", "committed@25", "committed@26", full=True)
        assert {t for t in up["changed_tables"] if t.startswith("desk")} == named, (sid, up["changed_tables"])
        assert not any("dated after the New York date" in m for m in up["failures"] + up["warnings"]), (sid, up["failures"], up["warnings"])
        down = _restamped(tmp_path, f"v56-down-{sid}", sid, "2026-09-26", "committed@26", "committed@25", full=True)
        assert {t for t in down["changed_tables"] if t.startswith("desk")} == named, (sid, down["changed_tables"])
        after = [m for m in down["failures" if tier == 1 else "warnings"] if f"desk:{sid}" in m and "dated after the New York date" in m]
        assert after, (sid, down["failures"], down["warnings"])
        assert not any(f"desk:{sid}" in m and "dated after the New York date" in m for m in down["warnings" if tier == 1 else "failures"])
