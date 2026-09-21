"""api/desk.py — the Desk's thin read-only endpoints (desk/frame, 2026-09-21).

docs/desk/DESK_FRAME_SPEC.md §7 allows exactly one endpoint on this branch:
``GET /api/desk/pipeline/inventory``, the series inventory the Data Pipeline
page prints. It joins the per-series freshness states ``api/freshness.py``
already judges (the same ``series[]`` that ``/api/freshness`` serves, so the
two can never disagree) with two static facts about each source: which
provider publishes it and which modules read it. No analytics, no
computation, nothing written. ``api/`` never imports ``src.config`` (it needs
``FRED_API_KEY``); the series registry in ``api/freshness.py`` mirrors it and
``tests/test_freshness_state.py`` pins the parity.

``/api/desk/positions`` (§7, "if a store exists") is not here: positions live
in the visitor's browser (§5), the app has no accounts and no store.
"""

from __future__ import annotations

from typing import Callable, TypeVar

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api import bootstrap, db, stream
from api import freshness as freshness_mod

router = APIRouter(prefix="/api/desk")

T = TypeVar("T")


def _guarded(fn: Callable[[], T]) -> T:
    """A missing or unopenable database is a 503, never a 500 (api/main.py idiom)."""
    try:
        return fn()
    except db.DBUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


# Provider per source. FRED series carry their own id as the source id; the
# stored market tables name the pipeline client that wrote them (CLAUDE.md,
# Data Source Rules); the relay names EODHD.
SOURCE_BY_ID: dict[str, str] = {
    "market_daily": "yfinance (stored daily bars)",
    "market_intraday": "yfinance (stored 5-min bars)",
    "asset_prices": "EODHD first, Yahoo disclosed fallback (stored)",
    "live_quotes": "EODHD relay",
    "vix_delayed": "EODHD REST (delayed)",
    "lbo_all_in_rate": "derived: FEDFUNDS + BAMLH0A0HYM2",
}
SOURCE_BY_KIND: dict[str, str] = {
    "fred": "FRED",
    "market": "stored market data",
    "live": "EODHD relay",
    "derived": "derived",
}

# The modules that read each series, in reader words. Regime, signal and
# recession inputs follow api/freshness.MONTHLY_INPUTS / DAILY_INPUTS and
# api/main.RECESSION_INPUTS; credit and priced series follow the tabs that
# print them (web/src/screens/shared/fresh-state.ts groups).
REGIME = "Regime classifier"
SIGNALS = "Monitored signals"
RECESSION = "Recession model"
CREDIT = "Credit"
PRICED = "What's priced"
LBO = "LBO all-in rate"
MARKETS = "Markets"
DASHBOARD = "Dashboard key levels"
ALLOCATION = "Asset allocation"
TAPE = "Live tape"
DESK_POSITIONS = "Desk · Position Monitor"

FEEDS: dict[str, list[str]] = {
    "INDPRO": [REGIME, SIGNALS, RECESSION],
    "CPIAUCSL": [REGIME, SIGNALS],
    "UNRATE": [REGIME, SIGNALS, RECESSION],
    "DGS10": [SIGNALS, RECESSION, CREDIT, DASHBOARD, DESK_POSITIONS],
    "DGS2": [SIGNALS, RECESSION, DASHBOARD],
    "VIXCLS": [SIGNALS, DASHBOARD, DESK_POSITIONS],
    "BAMLH0A0HYM2": [SIGNALS, RECESSION, CREDIT, LBO, DESK_POSITIONS],
    "BAMLC0A0CM": [CREDIT],
    "BAMLH0A1HYBB": [CREDIT],
    "BAMLH0A2HYB": [CREDIT],
    "BAMLH0A3HYC": [CREDIT],
    "T10YIE": [RECESSION, PRICED],
    "T5YIE": [RECESSION, PRICED],
    "DFII10": [PRICED],
    "DFII5": [PRICED],
    "SOFR": [PRICED],
    "FEDFUNDS": [PRICED, LBO],
    "USREC": [f"{RECESSION} (training target)"],
    "USSLIND": [f"{RECESSION} (staleness probe only; discontinued Feb 2020)"],
    "market_daily": [MARKETS, DASHBOARD, "Quote cards", DESK_POSITIONS],
    "market_intraday": [MARKETS, "Quote cards"],
    "asset_prices": [ALLOCATION],
    "live_quotes": [TAPE, "Watchlist"],
    "vix_delayed": [TAPE],
    "lbo_all_in_rate": ["Tools · LBO calculator"],
}


class InventoryRow(BaseModel):
    id: str
    label: str
    kind: str
    cadence: str
    as_of: str | None
    state: str
    delay_min: int | None
    cycles_behind: int | None
    stale: bool
    discontinued: bool
    reason: str
    source: str
    source_id: str | None
    feeds: list[str]


class PipelineInventory(BaseModel):
    generated_at: str | None
    overall: str | None
    regimes_date: str | None
    signals_date: str | None
    market_daily_date: str | None
    market_intraday_ts: str | None
    news_published_at: str | None
    raw_series_date: str | None
    series: list[InventoryRow]


def inventory_rows(series: list[dict]) -> list[dict]:
    """Pure: the freshness ``series[]`` rows with their provider and readers."""
    rows: list[dict] = []
    for s in series:
        sid = str(s.get("id", ""))
        kind = str(s.get("kind", ""))
        rows.append(
            {
                **s,
                "source": SOURCE_BY_ID.get(sid) or SOURCE_BY_KIND.get(kind, kind or "unknown"),
                "source_id": sid if kind == "fred" else None,
                "feeds": list(FEEDS.get(sid, [])),
            }
        )
    return rows


@router.get("/pipeline/inventory", response_model=PipelineInventory)
def pipeline_inventory() -> PipelineInventory:
    """Every stored source with its provider, cadence, true as-of date, the
    server's freshness state and the modules that read it. The states are the
    ones ``/api/freshness`` serves (api/freshness.assess), joined here with
    the static provider and reader facts; nothing is computed."""
    base = _guarded(db.freshness)
    series = _guarded(db.latest_series_all)
    marks = _guarded(db.watermarks)
    report = freshness_mod.assess(
        db_fresh=base, series_latest=series, relay=stream.hub.debug(), bootstrap=bootstrap.status(), watermarks=marks
    )
    return PipelineInventory(
        generated_at=report.get("generated_at"),
        overall=report.get("overall"),
        **{k: report.get(k) for k in ("regimes_date", "signals_date", "market_daily_date", "market_intraday_ts", "news_published_at", "raw_series_date")},
        series=[InventoryRow(**r) for r in inventory_rows(report.get("series") or [])],
    )
