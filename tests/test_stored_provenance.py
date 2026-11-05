"""Stored price provenance: the labels that name who wrote `market_daily` and
`market_intraday` match the stored rows.

`market_daily` holds two writers' rows, split by symbol and date: the earlier
pipeline's Polygon.io bars (each stored ETF's sessions from its Polygon start
to 2026-05-26, every session present, SPY's 2026-03-12 bar excepted) and
yfinance (every other row). The labels (api/desk.py's inventory source,
web/src/screens/shared/stored-provenance.ts, the Methodology sources list)
state each row's recorded source. The database half checks the split
itself, that no session inside a span is missing (so a gap-filling backfill
has nothing to insert there) and that no Polygon row was rewritten after the
last Polygon write (the manual upsert backfill keeps `source` while
rewriting prices); a change to any of these fails here before a label goes
false. The static half keeps the labels' facts in step.
"""

from __future__ import annotations

import ast
import re
import sqlite3
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

import pytest
import yaml

from api import calendar as nyse
from api import db
from api import desk as desk_mod

ROOT = Path(__file__).resolve().parent.parent
WEB_PROVENANCE = ROOT / "web/src/screens/shared/stored-provenance.ts"
MARKETS = ROOT / "web/src/screens/markets/MarketsScreen.tsx"
CHART_PANEL = ROOT / "web/src/screens/markets/ChartPanel.tsx"
METHODOLOGY = ROOT / "web/src/screens/methodology/MethodologyScreen.tsx"

FIRST_BY_SYMBOL = desk_mod.POLYGON_DAILY_FIRST_BY_SYMBOL
LAST = desk_mod.POLYGON_DAILY_LAST
INSIDE = list(desk_mod.YFINANCE_DAILY_INSIDE)

needs_db = pytest.mark.skipif(not db.DB_PATH.exists(), reason="macro_radar.db not present")


def _ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)


def _daily_symbols() -> set[str]:
    return set(yaml.safe_load((ROOT / "config/assets.yml").read_text())["daily"])


def _sessions(first: str, last: str) -> list[str]:
    d, end, out = date.fromisoformat(first), date.fromisoformat(last), []
    while d <= end:
        assert nyse.calendar_known(d), d
        if nyse.is_trading_day(d):
            out.append(d.isoformat())
        d += timedelta(days=1)
    return out


# ── The stored rows ─────────────────────────────────────────────────────────


@needs_db
def test_polygon_rows_are_exactly_each_etfs_span():
    with closing(_ro()) as c:
        sources = {r[0] for r in c.execute("SELECT DISTINCT source FROM market_daily")}
        spans = {s: (a, b) for s, a, b in c.execute(
            "SELECT symbol, MIN(date), MAX(date) FROM market_daily WHERE source = 'polygon' GROUP BY symbol")}
    assert sources == {"polygon", "yfinance"}, sources
    assert set(FIRST_BY_SYMBOL) == _daily_symbols()
    assert spans == {s: (first, LAST) for s, first in FIRST_BY_SYMBOL.items()}


@needs_db
def test_every_session_inside_a_span_is_stored_and_only_the_named_bars_are_yfinance():
    """The spans have no gap, so neither yfinance writer can add a row inside
    one (incremental starts after the newest date; backfill_yfinance inserts
    only missing sessions); the only non-Polygon rows inside are INSIDE."""
    found_inside = []
    with closing(_ro()) as c:
        for symbol, first in FIRST_BY_SYMBOL.items():
            stored = dict(c.execute(
                "SELECT date, source FROM market_daily WHERE symbol = ? AND date BETWEEN ? AND ?", (symbol, first, LAST)))
            assert sorted(stored) == _sessions(first, LAST), f"{symbol}: stored dates inside its Polygon span differ from the NYSE sessions"
            found_inside += [(symbol, d) for d, src in stored.items() if src != "polygon"]
            assert set(stored.values()) <= {"polygon", "yfinance"}
    assert sorted(found_inside) == sorted(INSIDE), found_inside


# The newest `fetched_at` of any Polygon row: the last Polygon write. Every
# rewrite of a stored row (fetch_market's upsert, restate_market_daily) sets
# `fetched_at`, so a later one on a Polygon row means its prices may no longer
# be Polygon's while its recorded source still says so.
LAST_POLYGON_WRITE = "2026-05-27T04:19:10.646930"


@needs_db
def test_no_polygon_row_was_rewritten_after_the_last_polygon_write():
    with closing(_ro()) as c:
        newest, missing = c.execute(
            "SELECT MAX(fetched_at), SUM(fetched_at IS NULL) FROM market_daily WHERE source = 'polygon'").fetchone()
    assert missing == 0
    assert newest == LAST_POLYGON_WRITE, (
        f"a Polygon row was written at {newest}: its prices may be another provider's under source='polygon'; "
        "recheck it before the labels call it Polygon.io")


def test_the_backfill_upsert_keeps_source_but_stamps_fetched_at(tmp_path):
    """The one writer that can rewrite a Polygon row (fetch_market.py --mode
    backfill) keeps `source` and stamps `fetched_at`: the stamp is what the
    guard above reads."""
    from src import migrate
    from src.market_data import fetch_market

    conn = sqlite3.connect(tmp_path / "m.db")
    conn.executescript(migrate.MIGRATION_SQL)
    conn.row_factory = sqlite3.Row
    conn.execute("INSERT INTO market_daily (symbol, date, open, high, low, close, volume, vwap, source, fetched_at)"
                 " VALUES ('XLK', '2026-03-02', 100, 100, 100, 100, 1, NULL, 'polygon', ?)", (LAST_POLYGON_WRITE,))
    fetch_market._upsert_daily(conn, [("XLK", "2026-03-02", 200, 200, 200, 200, 1, None, "2026-11-04T09:00:00")])
    row = conn.execute("SELECT close, source, fetched_at FROM market_daily WHERE symbol = 'XLK'").fetchone()
    conn.close()
    assert tuple(row) == (200, "polygon", "2026-11-04T09:00:00")
    assert row["fetched_at"] > LAST_POLYGON_WRITE


@needs_db
def test_the_counts_the_labels_rest_on():
    with closing(_ro()) as c:
        polygon = c.execute("SELECT COUNT(*), COUNT(DISTINCT symbol) FROM market_daily WHERE source = 'polygon'").fetchone()
    assert polygon == (6018, 23)
    assert sum(1 for d in FIRST_BY_SYMBOL.values() if d == "2026-02-18") == 14


@needs_db
def test_market_intraday_is_all_yfinance():
    with closing(_ro()) as c:
        sources = {r[0] for r in c.execute("SELECT DISTINCT source FROM market_intraday")}
    assert sources == {"yfinance"}, sources


# ── The labels ──────────────────────────────────────────────────────────────


def test_inventory_label_names_both_writers_by_symbol_and_date():
    label = desk_mod.SOURCE_BY_ID["market_daily"]
    assert label == (
        "yfinance, except Polygon.io bars kept from the earlier pipeline for each stored ETF's sessions from "
        "2024-02-27 (2026-02-18 for 14 of the 23) to 2026-05-26; SPY's 2026-03-12 bar is yfinance (stored daily bars)"
    ), label
    row = desk_mod.inventory_rows([{"id": "market_daily", "kind": "market"}])[0]
    assert row["source"] == label
    # The other stored-market label is unchanged and true: every intraday row is yfinance.
    assert desk_mod.SOURCE_BY_ID["market_intraday"] == "yfinance (stored 5-min bars)"


def test_web_provenance_matches_the_api():
    text = WEB_PROVENANCE.read_text()
    consts = dict(re.findall(r'^const (EARLY|LATE) = "([0-9-]+)";', text, flags=re.M))
    block = re.search(r"POLYGON_DAILY_FIRST_BY_SYMBOL: Readonly<Record<string, string>> = \{(.*?)\};", text, flags=re.S).group(1)
    web_map = {sym: consts[ref] for sym, ref in re.findall(r"([A-Z]+): (EARLY|LATE)", block)}
    assert web_map == FIRST_BY_SYMBOL
    assert f'export const POLYGON_DAILY_LAST = "{LAST}";' in text
    inside = re.search(r"YFINANCE_DAILY_INSIDE: readonly \(readonly \[string, string\]\)\[\] = (\[.*?\]);", text).group(1)
    assert [tuple(x) for x in ast.literal_eval(inside)] == INSIDE


def test_markets_screen_no_longer_says_every_stored_candle_is_yfinance():
    markets = MARKETS.read_text()
    assert "via the yfinance pipeline" not in markets
    assert "{STORED_DAILY_SOURCE}" in markets
    assert "storedDailyProviders(symbol," in CHART_PANEL.read_text()


def test_methodology_lists_polygon_with_the_stored_dates():
    text = METHODOLOGY.read_text()
    assert ('["Polygon.io", null, "Stored daily candles for the 23-ETF universe dated Feb 27, 2024 to May 26, 2026 '
            "(from Feb 18, 2026 for 14 of them; SPY's Mar 12, 2026 bar is yfinance)") in text
    assert "all of them from May 27, 2026, plus SPY's history before Feb 27, 2024 and its Mar 12, 2026 bar" in text


# ── The weekly memo ─────────────────────────────────────────────────────────


def test_memo_describes_rows_by_their_own_source_with_counts_and_date_runs():
    import pandas as pd

    from src import memo

    rows = pd.DataFrame({
        "symbol": ["SPY", "SPY", "SPY", "TLT", "SPY", "SPY"],
        "date": pd.to_datetime(["2026-03-11", "2026-03-12", "2026-03-13", "2026-03-12", "2026-05-27", "2026-05-28"]),
        "source": ["polygon", "yfinance", "polygon", "polygon", "yfinance", "yfinance"],
    })
    assert memo.describe_market_sources(rows) == (
        "Polygon.io (3 rows, Mar 11, 2026 to Mar 13, 2026) and "
        "yfinance (3 rows: Mar 12, 2026; May 27, 2026 to May 28, 2026)")
    assert memo.describe_market_sources(rows[rows["source"] == "yfinance"].iloc[:1]) == "yfinance (1 row, Mar 12, 2026)"
    assert memo.describe_market_sources(pd.DataFrame()) == ""


@needs_db
def test_the_memo_chart_names_both_providers_of_the_rows_it_plots():
    import pandas as pd

    from src import memo

    market = memo.load_market_daily_memo()
    assert "source" in market.columns
    words = memo.market_chart_sources(market, pd.Timestamp("2026-09-01"))
    plotted = pd.concat(memo._market_chart_rows(market, pd.Timestamp("2026-09-01")).values())
    n_polygon = int((plotted["source"] == "polygon").sum())
    assert words.startswith(f"Polygon.io ({n_polygon:,} rows, Sep 02, 2025 to May 26, 2026) and yfinance ("), words


def test_the_memo_template_no_longer_says_its_market_data_is_all_yfinance():
    text = (ROOT / "templates/memo.html").read_text()
    assert "Source: yfinance market data" not in text
    assert "from yfinance (daily OHLCV)" not in text
    assert "{{ market_chart_src }}" in text and "{{ market_sources }}" in text
