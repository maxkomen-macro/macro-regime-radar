"""Stored price provenance: the labels that name who wrote `market_daily` and
`market_intraday` match the stored rows.

`market_daily` holds two writers' rows, split cleanly by date: the earlier
pipeline's Polygon.io bars (every row dated 2024-02-27 to 2026-05-26) and
yfinance (every other row). The labels (api/desk.py's inventory source,
web/src/screens/shared/stored-provenance.ts, the Methodology sources list)
state that split by date. The database half checks the split itself, so a
restatement or backfill that changes it fails here before a label goes
false; the static half keeps the labels' dates in step with each other.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
import yaml

from api import db
from api import desk as desk_mod

ROOT = Path(__file__).resolve().parent.parent
WEB_PROVENANCE = ROOT / "web/src/screens/shared/stored-provenance.ts"
MARKETS = ROOT / "web/src/screens/markets/MarketsScreen.tsx"
CHART_PANEL = ROOT / "web/src/screens/markets/ChartPanel.tsx"
METHODOLOGY = ROOT / "web/src/screens/methodology/MethodologyScreen.tsx"

FIRST, LAST = desk_mod.POLYGON_DAILY_FIRST, desk_mod.POLYGON_DAILY_LAST

needs_db = pytest.mark.skipif(not db.DB_PATH.exists(), reason="macro_radar.db not present")


def _ro() -> sqlite3.Connection:
    return sqlite3.connect(f"file:{db.DB_PATH}?mode=ro", uri=True)


def _daily_symbols() -> set[str]:
    return set(yaml.safe_load((ROOT / "config/assets.yml").read_text())["daily"])


# ── The stored rows ─────────────────────────────────────────────────────────


@needs_db
def test_market_daily_splits_by_date_into_polygon_and_yfinance_rows():
    with closing(_ro()) as c:
        sources = {r[0] for r in c.execute("SELECT DISTINCT source FROM market_daily")}
        polygon_outside = c.execute(
            "SELECT COUNT(*) FROM market_daily WHERE source = 'polygon' AND (date < ? OR date > ?)", (FIRST, LAST)
        ).fetchone()[0]
        other_inside = c.execute(
            "SELECT symbol, date, source FROM market_daily WHERE source != 'polygon' AND date BETWEEN ? AND ? ORDER BY symbol, date",
            (FIRST, LAST),
        ).fetchall()
        span = c.execute("SELECT MIN(date), MAX(date), COUNT(DISTINCT symbol) FROM market_daily WHERE source = 'polygon'").fetchone()
    assert sources == {"polygon", "yfinance"}, sources
    assert polygon_outside == 0, f"{polygon_outside} Polygon.io rows fall outside {FIRST}..{LAST}: the labels are now wrong"
    # Inside the span, the only other rows are the named yfinance exceptions (SPY 2026-03-12).
    assert [(sym, d) for sym, d, _ in other_inside] == list(desk_mod.YFINANCE_DAILY_INSIDE), (
        f"non-Polygon rows inside {FIRST}..{LAST} differ from YFINANCE_DAILY_INSIDE: the labels are now wrong: {other_inside}"
    )
    assert {src for _, _, src in other_inside} <= {"yfinance"}
    # The span's ends are the labels' dates, not merely bounds on them.
    assert span[0] == FIRST and span[1] == LAST, span
    assert span[2] == 23


@needs_db
def test_polygon_rows_cover_the_stored_etf_universe_with_the_methodology_starts():
    with closing(_ro()) as c:
        starts = dict(c.execute("SELECT symbol, MIN(date) FROM market_daily WHERE source = 'polygon' GROUP BY symbol"))
    assert set(starts) == _daily_symbols()
    # Methodology: "dated Feb 27, 2024 to May 26, 2026 (from Feb 18, 2026 for 14 of them)".
    assert set(starts.values()) == {FIRST, "2026-02-18"}
    assert sum(1 for d in starts.values() if d == "2026-02-18") == 14


@needs_db
def test_market_intraday_is_all_yfinance():
    with closing(_ro()) as c:
        sources = {r[0] for r in c.execute("SELECT DISTINCT source FROM market_intraday")}
    assert sources == {"yfinance"}, sources


# ── The labels ──────────────────────────────────────────────────────────────


def test_inventory_label_names_both_writers_by_date():
    label = desk_mod.SOURCE_BY_ID["market_daily"]
    assert label == (
        "yfinance, except Polygon.io bars dated 2024-02-27 to 2026-05-26 kept from the earlier pipeline; "
        "SPY's 2026-03-12 bar in that span is yfinance (stored daily bars)"
    ), label
    row = desk_mod.inventory_rows([{"id": "market_daily", "kind": "market"}])[0]
    assert row["source"] == label
    # The other stored-market label is unchanged and true: every intraday row is yfinance.
    assert desk_mod.SOURCE_BY_ID["market_intraday"] == "yfinance (stored 5-min bars)"


def test_web_provenance_dates_match_the_api():
    text = WEB_PROVENANCE.read_text()
    assert f'export const POLYGON_DAILY_FIRST = "{FIRST}";' in text
    assert f'export const POLYGON_DAILY_LAST = "{LAST}";' in text
    inside = ", ".join(f'["{sym}", "{d}"]' for sym, d in desk_mod.YFINANCE_DAILY_INSIDE)
    assert f"export const YFINANCE_DAILY_INSIDE: readonly (readonly [string, string])[] = [{inside}];" in text


def test_markets_screen_no_longer_says_every_stored_candle_is_yfinance():
    markets = MARKETS.read_text()
    assert "via the yfinance pipeline" not in markets
    assert "{STORED_DAILY_SOURCE}" in markets
    assert "storedDailyProviders(" in CHART_PANEL.read_text()


def test_methodology_lists_polygon_with_the_stored_dates():
    text = METHODOLOGY.read_text()
    assert '["Polygon.io", null, "Stored daily candles for the 23-ETF universe dated Feb 27, 2024 to May 26, 2026 (from Feb 18, 2026 for 14 of them; SPY\'s Mar 12, 2026 bar is yfinance)' in text
    assert "all of them from May 27, 2026, plus SPY's history before Feb 27, 2024 and its Mar 12, 2026 bar" in text
