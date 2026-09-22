"""api/main.py — local, read-only FastAPI service exposing Macro Regime Radar
outputs.

Two endpoint groups:
- Unprefixed (`/health`, `/regime/latest`, …) — original latest-snapshot
  contract for Atlas. Do not change field names without coordinating there.
- `/api/*` — React-migration endpoints (design handoff build-order step 1),
  mirroring every table the Streamlit dashboard reads.

CORS: the Vite dev-server origins by default; the CORS_ORIGINS env var
(comma-separated) replaces them for a split deploy. When web/dist exists the
built React bundle is served same-origin from this app (no CORS needed).
Run with:

    uvicorn api.main:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, TypeVar

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api import assistant_budget, bootstrap, db, security, stream
from api import worker as worker_mod
from api.db import NotStored
from api import freshness as freshness_mod
from api.chat import router as assistant_router
from api.providers import entitlements
from api.providers import market as market_layer
from api.providers.errors import ProviderError

# Make INFO-level app logs visible under bare `uvicorn` (its default logging
# config handles only its own loggers; root has no handler, so the lifespan
# startup block and stream feed transitions would vanish). basicConfig is a
# no-op when a root handler already exists.
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
# Provider tokens travel as query parameters; keep them out of every log line
# (httpx's request log included) — api/logsafe.py.
from api import logsafe  # noqa: E402

logsafe.install()
log = logging.getLogger("mrr.api")

_WEB_DIST = Path(__file__).resolve().parent.parent / "web" / "dist"

# Vite dev-server origins — the dev default when CORS_ORIGINS is unset.
_DEV_CORS_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"]
CORS_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()
] or _DEV_CORS_ORIGINS


def _anthropic_key_resolvable() -> bool:
    """Presence check only — the value never reaches a log line."""
    try:
        # Lazy import: pulls the anthropic SDK; src.analytics.chat deliberately
        # never imports src.config, so no FRED_API_KEY requirement sneaks in.
        from src.analytics.chat import get_secret

        return bool(get_secret("ANTHROPIC_API_KEY"))
    except Exception:
        return False


def _finnhub_key_present() -> bool:
    from api.providers import finnhub as fh

    return bool(fh.client().token)


def _log_startup_state() -> None:
    """One honest block at lifespan start — presence yes/no only, never values."""
    if db.DB_PATH.exists():
        mtime = datetime.fromtimestamp(db.DB_PATH.stat().st_mtime).isoformat(timespec="seconds")
        db_state = f"present (mtime {mtime})"
    else:
        db_state = "MISSING"
    log.info(
        "startup: web/dist %s",
        "found — serving the built bundle same-origin"
        if _WEB_DIST.is_dir()
        else "absent — SPA not mounted; dev flow (Vite :5173) unchanged",
    )
    log.info("startup: DB %s at %s", db_state, db.DB_PATH)
    log.info("startup: GH_DB_TOKEN %s", "yes" if os.environ.get("GH_DB_TOKEN") else "no")
    log.info("startup: EODHD_API_TOKEN %s", "yes" if stream.hub.token else "no")
    log.info("startup: ANTHROPIC_API_KEY resolvable: %s", "yes" if _anthropic_key_resolvable() else "no")
    log.info("startup: FINNHUB_API_KEY %s", "yes" if _finnhub_key_present() else "no")
    log.info("startup: OPS_ACCESS_KEY %s", "yes" if os.environ.get("OPS_ACCESS_KEY", "").strip() else "no")
    log.info("startup: public posture %s; assistant %s; daily cap $%.2f; ledger %s (%s, %s)",
             "on" if security.is_public_deploy() else "off", security.assistant_mode(),
             assistant_budget.daily_cap_usd(), assistant_budget.LEDGER_PATH,
             "writable" if assistant_budget.ledger_writable() else "NOT WRITABLE",
             "on a mounted disk" if assistant_budget.ledger_persistent() else "on the container's own disk, reset by a restart")
    if security.assistant_mode() != "off" and not assistant_budget.ledger_writable():
        log.warning("startup: this user cannot write the assistant's spend ledger at %s, so the analyst "
                    "will rest; see DEPLOY.md (the ledger disk)", assistant_budget.LEDGER_PATH)
    log.info("startup: client address from %s",
             f"the {security.client_ip_header()} header" if security.client_ip_header()
             else (f"X-Forwarded-For, {security.trusted_proxy_hops()} hop(s) from the right" if security.trusted_proxy_hops() else "the socket peer"))
    log.info("startup: effective CORS origins: %s", CORS_ORIGINS)


@asynccontextmanager
async def _lifespan(_: FastAPI):
    _log_startup_state()
    # DB bootstrap (api/bootstrap.py) — a no-op without GH_DB_TOKEN. Runs
    # before the stream hub so a fresh deploy has data before it serves.
    try:
        await asyncio.to_thread(bootstrap.refresh_db)
    except Exception as exc:  # noqa: BLE001 — no traceback: its text can carry a signed URL
        log.warning("DB bootstrap failed (%s); continuing with the on-disk DB", bootstrap.public_error(exc))
    # The background worker (api/worker.py, fix/prelaunch-1): preloads the
    # heavy libraries, builds the first generation of every derived result,
    # and rebuilds on every database change; handlers only look results up.
    # It also keeps the strip's and default watchlist's candles warm when an
    # EODHD token is configured.
    analytics = worker_mod.get_worker()
    analytics.prefetch = os.environ.get("PREFETCH_MARKET", "1") != "0"
    analytics.freeze_gc = os.environ.get("GC_FREEZE", "1") != "0"
    analytics.start(serving=True)
    refresh_task: asyncio.Task | None = None
    interval_min = bootstrap.refresh_interval_min()
    if interval_min > 0:
        refresh_task = asyncio.create_task(bootstrap.periodic_refresh(interval_min))
    # EODHD relay (api/stream.py) — a no-op when EODHD_API_TOKEN is absent:
    # feeds stay "off" and the client falls back to its DB poll.
    stream.hub.start()
    # One bounded entitlement probe per API family, off the event loop, so
    # /api/providers/status can say what the plan covers without guessing.
    probe_task: asyncio.Task | None = None
    if os.environ.get("EODHD_PROBE_ON_START", "1") != "0" and market_layer.client().token:
        probe_task = asyncio.create_task(asyncio.to_thread(entitlements.probe_all, market_layer.client()))
    yield
    if probe_task is not None and not probe_task.done():
        probe_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await probe_task
    if refresh_task is not None:
        refresh_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await refresh_task
    await asyncio.to_thread(analytics.stop)
    await stream.hub.stop()


def docs_enabled() -> bool:
    """Interactive docs and the OpenAPI schema are a development convenience.
    A public deploy serves neither (launch-1, re-audit F7): they map every
    route and its bounds for anyone, and they sit outside the rate limits."""
    return not security.is_public_deploy()


_DOCS = docs_enabled()
app = FastAPI(
    title="Macro Regime Radar API",
    version="1.5.0",
    description="Read-only access to macro regime, signals, markets, news, and model outputs.",
    lifespan=_lifespan,
    docs_url="/docs" if _DOCS else None,
    redoc_url="/redoc" if _DOCS else None,
    openapi_url="/openapi.json" if _DOCS else None,
)

# Vite dev-server origins by default; CORS_ORIGINS (comma-separated env)
# replaces them when set — this is how a split deploy adds the Vercel origin.
# The built bundle served same-origin from this app needs no CORS at all.
# POST covers the calculators (LBO, scenario stress, recession sensitivity) —
# every POST is pure computation over stored data; nothing writes. The
# effective origins are logged in the lifespan startup block.
# Publication gates (api/security.py): body caps, per-client and global rate
# limits, calculator/provider concurrency ceilings, the assistant access gate
# and security headers. Added before CORS so CORS wraps it — a 429 still
# carries the CORS headers a browser needs to read the message.
# Innermost, closest to the handlers: each HTTP request reads the one
# generation published when it arrived (fix/prelaunch-1, api/worker.py).
app.add_middleware(worker_mod.PinGeneration)
app.add_middleware(security.SecurityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(ProviderError)
async def _provider_error(_: Request, exc: ProviderError) -> JSONResponse:
    """Provider failures reach the client as a sanitized, typed message —
    kind + provider + retryable — never a URL, a token, or a traceback."""
    return JSONResponse(
        status_code=exc.http_status,
        content={"detail": exc.public, "kind": exc.kind, "provider": exc.provider, "retryable": exc.retryable},
    )


@app.exception_handler(worker_mod.Warming)
async def _warming(_: Request, exc: worker_mod.Warming) -> JSONResponse:
    """A request that arrived before the first background pass completed and
    waited WAIT_S for it (fix/prelaunch-1): 503, Retry-After, a warming body."""
    return JSONResponse(
        status_code=503,
        headers={"Retry-After": str(exc.retry_after)},
        content={"detail": exc.detail, "kind": "warming", "provider": "api", "retryable": True},
    )


@app.exception_handler(NotStored)
async def _not_stored(_: Request, exc: NotStored) -> JSONResponse:
    """A database that predates a stored input says so in plain words; the
    server never falls back to downloading it (fix/prelaunch-1)."""
    return JSONResponse(
        status_code=503,
        content={"detail": str(exc), "kind": "not_stored", "provider": "api", "retryable": False},
    )


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error: %s", type(exc).__name__)
    return JSONResponse(status_code=500, content={"detail": "Internal error. The incident is logged server-side."})

T = TypeVar("T")


def _sanitized(exc: Exception) -> str:
    """An error a visitor may read: the message only when it carries no path
    (launch-1, re-audit F6), else a fixed sentence. The server log has the
    detail."""
    text = str(exc)
    return text if ("/" not in text and "\\" not in text) else "The database is not available on this server."


def _guarded(fn: Callable[[], T]) -> T:
    """Translate a missing/unopenable DB into a 503 instead of a 500."""
    try:
        return fn()
    except db.DBUnavailable as exc:
        raise HTTPException(status_code=503, detail=_sanitized(exc)) from exc


# ── Response models ───────────────────────────────────────────────────────────

class Health(BaseModel):
    status: str
    db_present: bool


class Regime(BaseModel):
    date: str
    label: str
    confidence: float
    growth_trend: float | None
    inflation_trend: float | None
    prob_goldilocks: float | None
    prob_overheating: float | None
    prob_stagflation: float | None
    prob_recession: float | None


class Signal(BaseModel):
    signal_name: str
    value: float
    triggered: bool


class SignalsSnapshot(BaseModel):
    date: str
    signals: list[Signal]


class SeriesPoint(BaseModel):
    series_id: str
    date: str
    value: float


# ── Endpoints ─────────────────────────────────────────────────────────────────

@app.get("/health", response_model=Health)
def health() -> Health:
    return Health(status="ok", db_present=db.db_present())


@app.get("/regime/latest", response_model=Regime)
def regime_latest() -> Regime:
    row = _guarded(db.latest_regime)
    if row is None:
        raise HTTPException(status_code=404, detail="No regime data available.")
    return Regime(**row)


@app.get("/signals/latest", response_model=SignalsSnapshot)
def signals_latest() -> SignalsSnapshot:
    snap = _guarded(db.latest_signals)
    if snap is None:
        raise HTTPException(status_code=404, detail="No signal data available.")
    return SignalsSnapshot(**snap)


@app.get("/series", response_model=list[str])
def series_catalog() -> list[str]:
    return _guarded(db.list_series)


@app.get("/series/latest", response_model=list[SeriesPoint])
def series_latest_all() -> list[SeriesPoint]:
    return [SeriesPoint(**r) for r in _guarded(db.latest_series_all)]


@app.get("/series/{series_id}/latest", response_model=SeriesPoint)
def series_latest_one(series_id: str) -> SeriesPoint:
    row = _guarded(lambda: db.latest_series_one(series_id))
    if row is None:
        raise HTTPException(status_code=404, detail=f"Unknown series_id: {series_id}")
    return SeriesPoint(**row)


# ══ /api — React-migration endpoints ══════════════════════════════════════════
# One endpoint per table/view the Streamlit dashboard reads (handoff step 1).
# Queries live in api/db.py and mirror the dashboard loaders.

api = APIRouter(prefix="/api")


# ── Response models ───────────────────────────────────────────────────────────

class Alert(BaseModel):
    id: int
    date: str
    alert_type: str
    name: str
    level: str
    value: float | None
    threshold: float | None
    direction: str | None
    message: str | None
    created_at: str | None


class NewsItem(BaseModel):
    id: int
    headline: str
    summary: str | None
    url: str | None
    source: str | None
    category: str | None
    published_at: str | None
    fetched_at: str | None
    # float, not int: SQLite INTEGER affinity happily stores fractional
    # scores as REAL, and Pydantic v2 would 500 on the first such row.
    market_impact: float | None
    deal_size: float | None
    sector_relevance: float | None
    time_sensitivity: float | None
    regime_relevance: float | None
    overall_significance: float | None
    regime_interpretation: str | None
    perplexity_research: str | None
    ticker: str | None


class DailyBar(BaseModel):
    symbol: str
    date: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None
    vwap: float | None
    ret_1d: float | None
    ret_1w: float | None
    ret_1m: float | None


class IntradayPoint(BaseModel):
    symbol: str
    ts: str
    close: float | None
    volume: float | None


class SearchHit(BaseModel):
    symbol: str
    name: str
    exchange: str | None
    type: str | None
    sector: str | None
    country: str | None = None
    currency: str | None = None
    primary: bool = True


class SearchResponse(BaseModel):
    provider: str
    fallback_used: bool
    fallback_reason: str | None
    fetched_at: str
    hits: list[SearchHit]


class SymbolProfile(BaseModel):
    symbol: str
    name: str
    exchange: str | None
    currency: str | None
    quote_type: str | None
    sector: str | None
    industry: str | None
    last: float
    prev_close: float | None
    day_change_pct: float | None
    day_low: float | None
    day_high: float | None
    year_low: float | None
    year_high: float | None
    market_cap: float | None
    last_volume: float | None
    avg_volume_3m: float | None
    trailing_pe: float | None
    forward_pe: float | None
    eps_ttm: float | None
    beta: float | None
    dividend_yield: float | None
    price_to_book: float | None
    profit_margin: float | None
    revenue_growth: float | None
    fifty_two_wk_change: float | None
    fetched_at: str
    # Provenance (2026-09-06): which provider quoted, which supplied
    # fundamentals, whether the quote is delayed, and any disclosed fallback.
    market_ts: str | None = None
    quote_provider: str | None = None
    fundamentals_provider: str | None = None
    # launch-1: ok (filled from Finnhub) · not_covered (no company behind the
    # symbol) · unavailable (the source did not answer this time).
    fundamentals_status: str | None = None
    delayed: bool = True
    delay_note: str | None = None
    fallback_used: bool = False
    fallback_reason: str | None = None


class CandleBar(BaseModel):
    ts: str
    open: float | None
    high: float | None
    low: float | None
    close: float
    volume: float | None


class CandleSeries(BaseModel):
    """One provider per series, always disclosed — never a bare bar list."""

    symbol: str
    provider: str
    fallback_used: bool
    fallback_reason: str | None
    fetched_at: str
    market_ts: str | None
    delayed: bool
    interval: str
    range: str
    exchange: str | None
    timezone: str | None
    adjustment: str
    count: int
    bars: list[CandleBar]


class SplitEvent(BaseModel):
    date: str | None
    ratio: float | None
    text: str | None


class DividendEvent(BaseModel):
    date: str | None
    value: float | None
    unadjusted_value: float | None
    currency: str | None
    period: str | None
    declaration_date: str | None
    record_date: str | None
    payment_date: str | None


class CorporateActions(BaseModel):
    symbol: str
    provider: str
    fallback_used: bool
    fallback_reason: str | None
    fetched_at: str
    from_: str = Field(alias="from")
    splits: list[SplitEvent]
    dividends: list[DividendEvent]

    model_config = {"populate_by_name": True}


class OptionsExpirations(BaseModel):
    symbol: str
    underlying: str
    provider: str
    as_of: str | None
    cadence: str
    fetched_at: str
    expirations: list[str]
    truncated: bool


class OptionContract(BaseModel):
    contract: str | None
    type: str | None
    strike: float | None
    exp_date: str | None
    expiration_type: str | None
    dte: int | None
    bid: float | None
    ask: float | None
    last: float | None
    midpoint: float | None
    volume: float | None
    open_interest: float | None
    implied_vol: float | None
    delta: float | None
    gamma: float | None
    theta: float | None
    vega: float | None
    rho: float | None
    moneyness: float | None
    tradetime: str | None
    last_quote: str | None


class OptionsChain(BaseModel):
    symbol: str
    underlying: str
    provider: str
    cadence: str
    as_of: str | None
    fetched_at: str
    expiration: str
    type: str | None
    strike_from: float | None
    strike_to: float | None
    page: int
    limit: int
    count: int
    total: int | None
    has_more: bool
    contracts: list[OptionContract]


class TickBar(BaseModel):
    ts: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    trades: int


class TickBars(BaseModel):
    symbol: str
    provider: str
    fetched_at: str
    window_from: str | None
    window_to: str | None
    last_trade_ts: str | None
    trades: int
    bars: list[TickBar]


class CalendarEvent(BaseModel):
    id: int
    event_name: str
    event_datetime: str
    importance: str | None
    source: str | None
    # B5 (2026-09-19): set on large-cap earnings rows (kind 'earnings'), which
    # the calendar routes return only with ?include=earnings.
    symbol: str | None = None
    kind: str | None = None


class BacktestRow(BaseModel):
    test_name: str
    cohort: str
    horizon: str
    avg_return: float | None
    median_return: float | None
    hit_rate: float | None
    n: float | None
    computed_at: str | None


class DatedValue(BaseModel):
    date: str
    value: float


class CreditSeries(BaseModel):
    series_id: str
    label: str
    date: str
    value_pct: float
    value_bps: float
    change_1w_bps: float | None
    history: list[DatedValue]


class CreditOAS(BaseModel):
    as_of: str | None
    series: list[CreditSeries]
    freshness: dict[str, dict] | None = None  # B3: per-series state, docs/redesign-v2/FRESHNESS_CONTRACT.md


class RecessionMetrics(BaseModel):
    probability_source: str
    recession_prob: float | None
    recession_label: str
    recession_color: str
    yield_curve_spread: float | None
    yield_curve_pct_rank: float | None
    inversion_duration_months: int | None
    is_inverted: bool | None
    divergence_score: float | None
    divergence_label: str
    divergence_color: str
    recession_prob_series: list[DatedValue]
    yield_curve_series: list[DatedValue]
    usrec_series: list[DatedValue]
    n_training_samples: int
    model_features: list[str]
    feature_coefficients: dict[str, float]
    data_as_of: str
    curve_shape: dict[str, float | None]  # tenors absent from raw_series are None
    current_inputs: dict[str, float | None]
    freshness: dict[str, dict] | None = None  # B3: per-series state, docs/redesign-v2/FRESHNESS_CONTRACT.md


class SignalFull(BaseModel):
    signal_name: str
    date: str  # this signal's own as-of date (carry-forward keeps old prints)
    value: float
    triggered: bool
    threshold: float | None
    direction: str | None  # "above" | "below"
    distance_pct: float | None  # threshold proximity 0–100 (100 = at/past trigger)
    status: str | None  # Clear | Watch | Triggered (triggered flag owns Triggered)


class SignalsLatestFull(BaseModel):
    date: str  # newest as-of date across the set
    signals: list[SignalFull]
    freshness: dict[str, dict] | None = None  # B3: per-series state, docs/redesign-v2/FRESHNESS_CONTRACT.md


class PricedMetric(BaseModel):
    group: str
    metric: str
    label: str
    unit: str
    date: str
    value: float
    mom_chg: float | None


class Surprise(BaseModel):
    metric: str
    label: str
    date: str
    z_score: float
    raw_value: float | None
    interpretation: str


class Freshness(BaseModel):
    regimes_date: str | None
    signals_date: str | None
    market_daily_date: str | None
    market_intraday_ts: str | None
    news_published_at: str | None
    raw_series_date: str | None
    # Source-aware verdicts (api/freshness.py, 2026-09-06). Optional so the
    # six original fields stay a stable contract for older clients.
    generated_at: str | None = None
    overall: str | None = None
    session: dict | None = None
    sla: list[dict] | None = None
    regime: dict | None = None
    bootstrap: dict | None = None
    relay: dict | None = None
    series: list[dict] | None = None  # B3: per-series state for every source
    # launch-1: which generation of derived results answered this request, so
    # an open tab can drop caches that predate a database swap. The file's
    # name only, never its path.
    generation: dict | None = None


# ── Response models: Regime Lab (2026-08-06, night-2 build) ──────────────────
# Shapes mirror src/analytics/intelligence.py return values exactly (verified
# against live output); the API adds nothing and renames nothing.

class Takeaway(BaseModel):
    narrative: str  # may carry <strong> emphasis from the source module
    conviction: str
    conviction_color: str
    primary_signal: str
    divergences: list[str]
    updated_ago: str
    regime_probs: dict[str, float]  # stored softmax, 0–1, lowercase keys
    current_regime: str


class SectorTilt(BaseModel):
    sector: str
    strength: float


class AssetPerf(BaseModel):
    avg_return: float
    hit_rate: float


class RegimePlaybook(BaseModel):
    regime: str
    regime_color: str
    description: str
    historical_frequency: float
    avg_duration_months: float
    sector_tilts: dict[str, list[SectorTilt]]  # overweight / underweight
    asset_performance: dict[str, AssetPerf]
    typical_indicators: dict[str, str]
    key_risks: list[str]
    warning_signs: list[str]
    typical_catalysts: list[str]
    opportunities: list[str]


class RiskIndicators(BaseModel):
    momentum: float
    valuation: float
    sentiment: float


class RegimeDuration(BaseModel):
    current_regime: str
    days_in_regime: int
    months_in_regime: float
    historical_avg_months: float
    percentile_duration: float
    progress_pct: float
    status: str  # Early | Mid-Cycle | Extended | Long in Tooth
    status_color: str
    risk_indicators: RiskIndicators


class TransitionItem(BaseModel):
    to: str
    probability: float
    color: str


class TransitionOutlook(BaseModel):
    current_regime: str
    stay_probability_3m: float
    transitions_3m: list[TransitionItem]
    transitions_6m: list[TransitionItem]
    narrative_3m: str
    narrative_6m: str
    highest_risk_transition: str
    highest_risk_prob: float
    highest_risk_color: str


class Analogue(BaseModel):
    period: str
    period_end: str
    regime: str
    similarity_score: float
    similarity_color: str
    hy_spread_pct: float
    recession_prob: float
    what_happened: str
    time_to_change: str
    next_regime: str
    key_drivers: list[str]
    market_impact: dict[str, str]
    lessons_for_today: str
    resolution: str


class ScenarioDef(BaseModel):
    key: str
    name: str
    emoji: str  # source-faithful; the client's glyph rules decide rendering
    description: str
    severity: str
    color: str
    input_shocks: dict[str, float]
    historical_reference: str
    what_happened_then: str
    sector_implications: dict[str, list[str]]
    duration_estimate: str
    indicators_to_watch: list[str]


class ScenarioShocks(BaseModel):
    """Custom shock inputs, bounded to the Streamlit builder's slider ranges."""

    hy_spread_delta_bps: float = Field(0, ge=-200, le=500)
    yield_10y_delta_bps: float = Field(0, ge=-150, le=200)
    vix_delta: float = Field(0, ge=-10, le=50)
    spx_delta_pct: float = Field(0, ge=-40, le=20)


class ScenarioRequest(BaseModel):
    scenario_key: str | None = None
    custom_shocks: ScenarioShocks | None = None


class ScenarioResult(BaseModel):
    scenario_name: str
    emoji: str
    description: str
    severity: str
    color: str
    historical_reference: str
    what_happened_then: str
    input_shocks: dict[str, float]
    current_regime_probs: dict[str, float]  # 0–100, lowercase-underscore keys
    stressed_regime_probs: dict[str, float]
    prob_changes: dict[str, float]
    most_likely_regime: str
    most_likely_prob: float
    positioning_implications: list[str]
    sector_implications: dict[str, list[str]]
    duration_estimate: str
    indicators_to_watch: list[str]


# ── Response models: Credit metrics ──────────────────────────────────────────

class CreditMetrics(BaseModel):
    """get_credit_metrics() verbatim — OAS values in bps, monthly cadence.
    `*_1w_change` fields are month-over-month (the FRED pipeline resamples to
    monthly; the source key name is historical)."""

    hy_oas: float | None
    ig_oas: float | None
    ccc_oas: float | None
    bb_oas: float | None
    b_oas: float | None
    hy_1w_change: float | None
    ig_1w_change: float | None
    ccc_1w_change: float | None
    bb_1w_change: float | None
    b_1w_change: float | None
    hy_ig_ratio: float | None
    # B2 (2026-09-18): CCC OAS against the 1,000 bps distress line; a level
    # vs a threshold that may exceed 100, never a share of issuers.
    ccc_pct_of_distress_line: float | None
    ccc_bps_vs_distress_line: float | None
    # B7 (2026-09-18): observed transitions per from-state; 0 = no history for that row.
    transition_obs_3m: dict[str, int] | None = None
    transition_obs_6m: dict[str, int] | None = None
    lbo_all_in_cost: str | None
    credit_label: str
    credit_label_color: str
    hy_pct_rank: float | None
    ig_pct_rank: float | None
    hy_series: list[DatedValue]
    ig_series: list[DatedValue]
    data_as_of: str | None
    transition_3m: dict[str, dict[str, float]]
    transition_6m: dict[str, dict[str, float]]
    tight_count: int
    hy_sparkline: list[DatedValue]
    ig_sparkline: list[DatedValue]
    ccc_sparkline: list[DatedValue]
    bb_sparkline: list[DatedValue]
    b_sparkline: list[DatedValue]
    freshness: dict[str, dict] | None = None  # B3: per-series state, docs/redesign-v2/FRESHNESS_CONTRACT.md


# ── Response models: Recession sensitivity ───────────────────────────────────

class RecessionScenarioRequest(BaseModel):
    """Bounds mirror the Streamlit sensitivity sliders exactly."""

    yield_curve_bps: float = Field(..., ge=-200, le=300)
    unemployment: float = Field(..., ge=2.0, le=15.0)
    hy_oas_bps: float = Field(..., ge=100, le=2000)
    indpro_yoy: float = Field(..., ge=-20.0, le=10.0)
    lei: float = Field(..., ge=-5.0, le=5.0)


class RecessionScenarioResult(BaseModel):
    probability: float  # 0–100 from the fitted model
    label: str  # Low Risk | Elevated | High Risk (20/40 bands)
    color: str
    baseline_prob: float | None
    delta_pp: float | None  # probability − baseline, percentage points


# ── Response models: LBO ─────────────────────────────────────────────────────

class LboDefaults(BaseModel):
    fedfunds: float
    hy_oas_pct: float
    lbo_all_in_rate: float
    data_as_of: str
    status: str = "live"  # B3: "live" or "fallback" (the stated defaults, not data)
    is_fallback: bool = False
    fedfunds_as_of: str | None = None
    hy_oas_as_of: str | None = None
    freshness: dict[str, dict] | None = None  # B3: per-series state, docs/redesign-v2/FRESHNESS_CONTRACT.md


class LboRequest(BaseModel):
    """Bounds mirror the Streamlit calculator's sliders."""

    ebitda: float = Field(100.0, ge=10.0, le=2000.0)
    ebitda_growth_rate: float = Field(5.0, ge=-10.0, le=30.0)
    entry_multiple: float = Field(8.0, ge=3.0, le=20.0)
    exit_multiple: float = Field(9.0, ge=3.0, le=20.0)
    hold_period: int = Field(5, ge=1, le=10)
    leverage_ratio: float = Field(4.5, ge=0.5, le=8.0)
    interest_rate: float = Field(..., ge=3.0, le=20.0)
    amortization_rate: float = Field(5.0, ge=0.0, le=20.0)
    mgmt_fee_pct: float = Field(1.5, ge=0.0, le=5.0)


class LboYear(BaseModel):
    """One schedule year. B1 (2026-09-18): cash for debt service pays the
    interest due first, the scheduled amortization is a floor and the rest
    sweeps against the debt; debt_end = debt_start - principal_paid +
    interest_shortfall, and cash_available = interest_paid + principal_paid +
    cash_retained."""

    year: int
    ebitda: float
    implied_ev: float
    debt_start: float
    debt_end: float
    interest: float
    cash_available: float
    interest_paid: float
    interest_shortfall: float
    scheduled_amortization: float
    amortization_shortfall: float
    sweep: float
    principal_paid: float
    cash_retained: float
    cash_balance: float


class LboResult(BaseModel):
    entry_ev: float
    entry_debt: float
    entry_equity: float
    exit_ev: float | None
    exit_debt: float | None
    exit_cash: float | None
    exit_equity: float | None
    moic: float | None
    irr: float | None
    equity_gain: float | None
    schedule: list[LboYear]
    notes: list[str]
    cash_for_debt_service_pct: float
    viable: bool
    error_msg: str


class LboSensitivity(BaseModel):
    """5×5 IRR grid centered on the requested multiples (rounded to 0.5),
    rows = entry multiple, cols = exit multiple; None = deal not viable.
    Edge rows/cols outside the 3.0–20.0× slider range are dropped, so the
    grid can shrink. Centers are returned so the client outlines the same
    cell the server centered on (Python and JS round halves differently)."""

    entry_multiples: list[float]
    exit_multiples: list[float]
    entry_center: float
    exit_center: float
    irr_grid: list[list[float | None]]


class LboResponse(BaseModel):
    result: LboResult
    sensitivity: LboSensitivity


# ── Endpoints ─────────────────────────────────────────────────────────────────

@api.get("/regime/latest", response_model=Regime)
def api_regime_latest() -> Regime:
    return regime_latest()


@api.get("/regime/history", response_model=list[Regime])
def api_regime_history(
    start: str | None = Query(None, description="Inclusive YYYY-MM-DD lower bound"),
    end: str | None = Query(None, description="Inclusive YYYY-MM-DD upper bound"),
    limit: int | None = Query(None, ge=1, description="Keep only the most recent N rows"),
) -> list[Regime]:
    rows = _guarded(lambda: db.regime_history(start, end, limit))
    return [Regime(**r) for r in rows]


@api.get("/signals/latest", response_model=SignalsLatestFull)
def api_signals_latest() -> SignalsLatestFull:
    """Latest print per signal (carry-forward) with server-computed threshold,
    direction, distance-to-trigger, and status — unlike the unprefixed
    /signals/latest, which keeps the frozen max-common-date Atlas contract."""
    snap = _guarded(db.latest_signals_full)
    if snap is None:
        raise HTTPException(status_code=404, detail="No signal data available.")
    return SignalsLatestFull(**snap, freshness=_freshness_block(SIGNAL_INPUTS))


@api.get("/priced", response_model=list[PricedMetric])
def api_priced() -> list[PricedMetric]:
    """What's Priced — policy proxies, breakevens, real yields (grouped)."""
    rows = _guarded(db.priced_metrics)
    return [PricedMetric(**r) for r in rows]


@api.get("/surprises", response_model=list[Surprise])
def api_surprises(top_n: int = Query(10, ge=1, le=15)) -> list[Surprise]:
    """Top-|z| weekly surprises with the shared desk-note interpretation."""
    rows = _guarded(lambda: db.top_surprises(top_n))
    return [Surprise(**r) for r in rows]


@api.get("/alerts", response_model=list[Alert])
def api_alerts(
    level: str | None = Query(None, description="info | watch | risk"),
    alert_type: str | None = Query(None, description="macro_signal | market"),
    limit: int = Query(50, ge=1, le=500),
) -> list[Alert]:
    rows = _guarded(lambda: db.alert_feed(level, alert_type, limit))
    return [Alert(**r) for r in rows]


@api.get("/news", response_model=list[NewsItem])
def api_news(
    hours: int = Query(24, ge=1, le=720, description="Lookback window on published_at"),
    category: str | None = Query(None, description="DB category value, e.g. GEOPOLITICAL"),
    min_significance: float | None = Query(None, ge=0, le=10),
    limit: int = Query(150, ge=1, le=500),
    ticker: str | None = Query(None, max_length=15, description="Filter to one tagged ticker"),
) -> list[NewsItem]:
    rows = _guarded(lambda: db.news_feed(hours, category, min_significance, limit, ticker))
    return [NewsItem(**r) for r in rows]


MAX_SYMBOLS = 50  # launch-1, re-audit F8: a bounded CSV, well above any screen


def _symbol_list(symbols: str) -> list[str]:
    """The CSV a stored-market route accepts: non-empty and bounded. Values
    are still bound as parameters; the cap keeps one request from building a
    query with thousands of placeholders."""
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(status_code=422, detail="No symbols given.")
    if len(syms) > MAX_SYMBOLS:
        raise HTTPException(status_code=422, detail=f"Too many symbols: {len(syms)} given, at most {MAX_SYMBOLS} per request.")
    return syms


@api.get("/market/daily", response_model=list[DailyBar])
def api_market_daily(
    symbols: str = Query(",".join(db.WATCHLIST_SYMBOLS), description="CSV of tickers"),
    days: int = Query(120, ge=1, le=3650, description="Calendar-day lookback"),
) -> list[DailyBar]:
    syms = _symbol_list(symbols)
    rows = _guarded(lambda: db.market_daily(syms, days))
    return [DailyBar(**r) for r in rows]


@api.get("/market/intraday", response_model=list[IntradayPoint])
def api_market_intraday(
    symbols: str = Query(",".join(db.INTRADAY_SYMBOLS), description="CSV of tickers"),
    since: str | None = Query(None, description="ISO UTC ts lower bound, e.g. 2026-08-04T00:00:00Z"),
) -> list[IntradayPoint]:
    syms = _symbol_list(symbols)
    rows = _guarded(lambda: db.market_intraday(syms, since))
    return [IntradayPoint(**r) for r in rows]


# ── On-demand symbol layer (Phase-2 Markets expansion, api/lookup.py) ────────
# Reaches past the stored 23-ETF universe to any listed symbol through EODHD
# (never Yahoo on the request path, fix/prelaunch-1). Delayed data, honestly
# stamped; cached per key so bursts cost one upstream call. These routes are
# additive — nothing existing changed shape.


_QUERY_BAD = set("/\\?#%") | {chr(i) for i in range(32)} | {chr(127)}


def _search_query_arg(q: str) -> str:
    """Free-text search must stay one URL path segment on the provider side:
    no separators, no percent sequences, no control characters (review P1-1)."""
    text = q.strip()
    if not text or len(text) > 40 or any(ch in _QUERY_BAD for ch in text):
        raise HTTPException(status_code=422, detail="Search text may not contain path separators, '%', '#', '?' or control characters.")
    return text


def _symbol_arg(symbol: str) -> str:
    """Path symbols are validated here (length + charset) before any provider
    sees them; canonical spelling happens in api/providers/symbols.py."""
    sym = symbol.strip()
    if not (1 <= len(sym) <= 24) or any(ch not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.^=-" for ch in sym):
        raise HTTPException(status_code=422, detail=f"'{symbol}' is not a listable symbol.")
    return sym


@api.get("/market/search", response_model=SearchResponse)
def api_market_search(
    q: str = Query(..., min_length=1, max_length=40, description="Free-text symbol/name query"),
    limit: int = Query(10, ge=1, le=25),
) -> SearchResponse:
    from api import lookup

    return SearchResponse(**lookup.search(_search_query_arg(q), limit))


@api.get("/market/profile/{symbol}", response_model=SymbolProfile)
def api_market_profile(symbol: str) -> SymbolProfile:
    from api import lookup

    return SymbolProfile(**lookup.profile(_symbol_arg(symbol)))


@api.get("/market/candles/{symbol}", response_model=CandleSeries)
def api_market_candles(
    symbol: str,
    range_key: str = Query("6M", alias="range", pattern="^(1D|5D|1M|6M|1Y|5Y|MAX)$"),
) -> CandleSeries:
    """Candle envelope from EODHD, provenance stamped; an EODHD failure is a
    typed error, never a Yahoo fallback (api/providers/market.py)."""
    from api import lookup

    return CandleSeries(**lookup.candles(_symbol_arg(symbol), range_key))


@api.get("/market/actions/{symbol}", response_model=CorporateActions)
def api_market_actions(symbol: str, years: int = Query(5, ge=1, le=20)) -> CorporateActions:
    return CorporateActions(**market_layer.corporate_actions(_symbol_arg(symbol), years))


@api.get("/market/options/{symbol}/expirations", response_model=OptionsExpirations)
def api_market_options_expirations(symbol: str) -> OptionsExpirations:
    """End-of-day listed expirations (EODHD marketplace). Entitlement-gated:
    an unentitled plan answers 403 with kind=unauthorized, never a fabricated chain."""
    return OptionsExpirations(**market_layer.options_expirations(_symbol_arg(symbol)))


@api.get("/market/options/{symbol}", response_model=OptionsChain)
def api_market_options(
    symbol: str,
    expiration: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"),
    type_: str | None = Query(None, alias="type", pattern="^(call|put)$"),
    strike_from: float | None = Query(None, ge=0),
    strike_to: float | None = Query(None, ge=0),
    page: int = Query(0, ge=0, le=500),
    limit: int = Query(60, ge=1, le=200),
) -> OptionsChain:
    """One expiration's contracts, server-side paginated and filtered. Values
    are EODHD's end-of-day marks and provider Greeks — nothing is computed here."""
    if strike_from is not None and strike_to is not None and strike_from > strike_to:
        raise HTTPException(status_code=422, detail="strike_from must not exceed strike_to.")
    if page * limit > 10_000:
        raise HTTPException(status_code=422, detail="page × limit may not exceed 10,000 (the provider's offset ceiling).")
    return OptionsChain(
        **market_layer.options_chain(
            _symbol_arg(symbol), expiration=expiration, type_=type_, strike_from=strike_from, strike_to=strike_to, page=page, limit=limit
        )
    )


@api.get("/market/ticks/{symbol}", response_model=TickBars)
def api_market_ticks(
    symbol: str,
    minutes: int = Query(15, ge=1, le=30),
    limit: int = Query(2000, ge=1, le=5000),
) -> TickBars:
    """Bounded recent-trade window aggregated to one-minute bars server-side.
    Request window in seconds, provider timestamps in milliseconds, nothing
    persisted. Entitlement-gated (403 kind=unauthorized on this plan today)."""
    return TickBars(**market_layer.recent_trades(_symbol_arg(symbol), minutes=minutes, limit=limit))


def _ops_gate(request: Request) -> None:
    """Diagnostics stay open in development; on a deploy they are closed.

    `OPS_ACCESS_KEY` set requires `X-Ops-Key` (review P3-10), compared in
    constant time. A deploy that sets `CORS_ORIGINS` but no key fails closed
    (launch-1): the relay's symbols, the plan's entitlements and the gate
    counters are not for the internet, and an unset key is a mistake rather
    than a decision to publish them."""
    expected = os.environ.get("OPS_ACCESS_KEY", "").strip()
    if not expected:
        if security.is_public_deploy():
            raise HTTPException(
                status_code=503,
                detail="Diagnostics are closed on this deployment: no ops key is configured. Set OPS_ACCESS_KEY to open them.",
            )
        return
    if not security.keys_match(request.headers.get("x-ops-key", ""), expected):
        raise HTTPException(status_code=401, detail="Diagnostics require an ops key on this deployment.")


@api.get("/ops/whoami")
def api_ops_whoami(request: Request) -> dict:
    """What the rate limits see this request as (launch-1): after a deploy the
    owner checks that client_id is their own public address, not a proxy's.
    Behind the ops key like every diagnostic; it only echoes the caller's own
    request."""
    _ops_gate(request)
    scope = request.scope
    lines = [v.decode("latin-1") for k, v in scope.get("headers", []) if k == b"x-forwarded-for"]
    entries = [x.strip() for x in ",".join(lines).split(",") if x.strip()]
    name = security.client_ip_header()
    return {
        "client_id": security.client_id_from(scope, security.trusted_proxy_hops()),
        "peer": (scope.get("client") or ("unknown",))[0],
        "forwarded_for_entries": len(entries),
        "forwarded_for": entries,
        "trusted_proxy_hops": security.trusted_proxy_hops(),
        "client_ip_header": name or None,
        "client_ip_header_present": bool(name) and any(k == name.encode("latin-1", "ignore") for k, _ in scope.get("headers", [])),
    }


@api.get("/providers/status")
def api_providers_status(request: Request) -> dict:
    """Which provider is primary per dataset, the cached entitlement probe
    results, relay health and gate counters — capability and status only,
    never a token."""
    _ops_gate(request)
    return {
        **market_layer.status(),
        "relay": stream.hub.debug(),
        "security": {"assistant_mode": security.assistant_mode(), "counters": _security_counters()},
    }


def _security_counters() -> dict:
    for m in getattr(app, "user_middleware", []):
        if m.cls is security.SecurityMiddleware:
            break
    # The instantiated middleware lives in the ASGI stack; walk to it.
    layer = getattr(app, "middleware_stack", None)
    while layer is not None:
        if isinstance(layer, security.SecurityMiddleware):
            return dict(layer.stats)
        layer = getattr(layer, "app", None)
    return {}


_CALENDAR_INCLUDE = "Opt-in event kinds: 'earnings' adds large-cap earnings dates, which are left out by default"


@api.get("/calendar", response_model=list[CalendarEvent])
def api_calendar(
    days: int = Query(14, ge=1, le=365),
    include: str | None = Query(None, pattern="^earnings$", description=_CALENDAR_INCLUDE),
) -> list[CalendarEvent]:
    rows = _guarded(lambda: db.event_calendar(days, include_earnings=include == "earnings"))
    return [CalendarEvent(**r) for r in rows]


@api.get("/backtests", response_model=list[BacktestRow])
def api_backtests() -> list[BacktestRow]:
    rows = _guarded(db.backtests)
    return [BacktestRow(**r) for r in rows]


@api.get("/credit/oas", response_model=CreditOAS)
def api_credit_oas(
    days: int = Query(90, ge=7, le=3650, description="History window for sparklines"),
) -> CreditOAS:
    payload = _guarded(lambda: db.credit_oas(days))
    if not payload["series"]:
        raise HTTPException(status_code=404, detail="No credit series data available.")
    return CreditOAS(**payload, freshness=_freshness_block(CREDIT_INPUTS + ["DGS10"]))


@api.get("/recession/probability", response_model=RecessionMetrics)
def api_recession_probability() -> RecessionMetrics:
    # The worker fits the model once per generation (api/worker.py); this only
    # looks the generation's result up.
    from api.recession_cache import get_cached_recession_metrics

    metrics = _guarded(get_cached_recession_metrics)
    if metrics.get("recession_prob") is None:
        raise HTTPException(status_code=404, detail="Recession model has no data.")
    return RecessionMetrics(**metrics, freshness=_freshness_block(RECESSION_INPUTS))


@api.get("/freshness", response_model=Freshness)
def api_freshness() -> Freshness:
    """Stored maxima plus source-aware SLA verdicts: the market calendar, the
    FRED publication rules, the regime's blocking inputs, snapshot provenance
    and relay health (api/freshness.py)."""
    base = _guarded(db.freshness)
    series = _guarded(db.latest_series_all)
    marks = _guarded(db.watermarks)
    report = freshness_mod.assess(db_fresh=base, series_latest=series, relay=stream.hub.debug(), bootstrap=bootstrap.status(), watermarks=marks)
    gen = worker_mod.get_worker().generation()
    report["generation"] = {
        "id": gen.id if gen else None,
        "built_at": gen.built_at if gen else None,
        "source": gen.source.name if gen else None,
    }
    return Freshness(**report)


# ── Regime Lab endpoints (night-2) ───────────────────────────────────────────
# All computation lives in src/analytics/intelligence.py; the worker runs it
# once per generation (api/analytics_cache.ITEMS) and these handlers only look
# the results up. Lazy imports keep module import light.

@api.get("/regime/intelligence", response_model=Takeaway)
def api_regime_intelligence() -> Takeaway:
    """Market takeaway narrative + conviction, assembled from the same inputs
    the Streamlit Intelligence tab feeds it; built by the worker once per
    generation."""
    from api import analytics_cache

    return Takeaway(**_guarded(analytics_cache.get_cached_takeaway))


@api.get("/regime/playbooks", response_model=dict[str, RegimePlaybook])
def api_regime_playbooks() -> dict[str, RegimePlaybook]:
    """All four static regime playbooks (reference content, not live data)."""
    from api import analytics_cache

    return {k: RegimePlaybook(**v) for k, v in analytics_cache.get_playbooks().items()}


@api.get("/regime/duration", response_model=RegimeDuration)
def api_regime_duration() -> RegimeDuration:
    from api import analytics_cache

    return RegimeDuration(**_guarded(analytics_cache.get_cached_duration))


@api.get("/regime/transitions", response_model=TransitionOutlook)
def api_regime_transitions() -> TransitionOutlook:
    from api import analytics_cache

    return TransitionOutlook(**_guarded(analytics_cache.get_cached_transitions))


@api.get("/regime/analogues", response_model=list[Analogue])
def api_regime_analogues() -> list[Analogue]:
    from api import analytics_cache

    return [Analogue(**a) for a in _guarded(analytics_cache.get_cached_analogues)]


@api.get("/regime/scenarios", response_model=list[ScenarioDef])
def api_regime_scenarios() -> list[ScenarioDef]:
    """The five prebuilt scenario definitions (static reference content)."""
    from api import analytics_cache

    return [ScenarioDef(**s) for s in analytics_cache.get_scenario_defs()]


@api.post("/regime/scenario", response_model=ScenarioResult)
def api_regime_run_scenario(req: ScenarioRequest) -> ScenarioResult:
    """Stress the stored regime probabilities — a prebuilt scenario_key OR
    custom shocks (bounded to the builder's slider ranges). Pure computation;
    nothing is written."""
    from api import analytics_cache

    if req.scenario_key is None and req.custom_shocks is None:
        raise HTTPException(status_code=422, detail="scenario_key or custom_shocks required.")
    try:
        out = _guarded(
            lambda: analytics_cache.run_scenario_cached_inputs(
                req.scenario_key,
                req.custom_shocks.model_dump() if req.custom_shocks else None,
            )
        )
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Unknown scenario: {exc}") from exc
    return ScenarioResult(**out)


# ── Credit endpoints (night-2) ───────────────────────────────────────────────

@api.get("/credit/metrics", response_model=CreditMetrics)
def api_credit_metrics() -> CreditMetrics:
    """Full credit dashboard payload from src/analytics/credit.py — OAS levels
    (bps), percentile ranks, HY/IG ratio, CCC vs the 1,000 bps distress line, transition matrices,
    financing cost, and monthly series for charts."""
    from api import analytics_cache

    metrics = _guarded(analytics_cache.get_cached_credit_metrics)
    if metrics.get("hy_oas") is None:
        raise HTTPException(status_code=404, detail="No credit series data available.")
    return CreditMetrics(**metrics, freshness=_freshness_block(CREDIT_INPUTS + ["FEDFUNDS"]))


# ── Recession sensitivity (night-2) ──────────────────────────────────────────

@api.post("/recession/scenario", response_model=RecessionScenarioResult)
def api_recession_scenario(req: RecessionScenarioRequest) -> RecessionScenarioResult:
    """Score user-set inputs against the fitted logistic model — the exact
    Streamlit sensitivity-panel computation. Read-only; the model is the one
    this request's generation fitted, the same one behind
    /api/recession/probability."""
    from api.recession_cache import peek_baseline_prob, score_recession_scenario

    prob = _guarded(
        lambda: score_recession_scenario(
            req.yield_curve_bps, req.unemployment, req.hy_oas_bps, req.indpro_yoy, req.lei
        )
    )
    if prob is None:
        raise HTTPException(status_code=404, detail="Recession model has no data.")
    from src.analytics.recession import _classify_prob  # loaded by the worker's preload
    label, color = _classify_prob(prob)
    # Peek, never retrain: the baseline comes from the same generation as the
    # model (the request is pinned to one), so the delta never straddles two.
    baseline = peek_baseline_prob()
    return RecessionScenarioResult(
        probability=round(prob, 1),
        label=label,
        color=color,
        baseline_prob=baseline,
        delta_pp=round(prob - baseline, 1) if baseline is not None else None,
    )


# ── LBO endpoints (night-2) ──────────────────────────────────────────────────

@api.get("/lbo/defaults", response_model=LboDefaults)
def api_lbo_defaults() -> LboDefaults:
    """Live financing-rate defaults (Fed Funds + HY OAS) from stored FRED data,
    computed by the worker for the published generation."""
    from api import analytics_cache

    defaults = _guarded(analytics_cache.get_lbo_defaults)
    block = _freshness_block(["FEDFUNDS", "BAMLH0A0HYM2"])
    block["lbo_all_in_rate"] = _all_in_state(defaults, block)
    return LboDefaults(**defaults, freshness=block)


# ── Per-series freshness blocks (B3, 2026-09-18) ────────────────────────────
# Each payload that shows stored numbers carries freshness[series_id] = the same
# per-series state /api/freshness reports, computed per request (cached payload
# values keep their own dates; the state is judged against now).
SIGNAL_INPUTS = ["DGS10", "DGS2", "VIXCLS", "BAMLH0A0HYM2", "CPIAUCSL", "UNRATE", "INDPRO"]
CREDIT_INPUTS = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC"]
# BH1: the model reads UNRATE and INDPRO; USSLIND is only probed for staleness
# (discontinued Feb 2020), so the fifth feature is the T10YIE-T5YIE breakeven.
RECESSION_INPUTS = ["DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE", "T5YIE", "UNRATE", "INDPRO"]


def _series_states() -> dict[str, dict]:
    base = _guarded(db.freshness)
    series = _guarded(db.latest_series_all)
    marks = _guarded(db.watermarks)
    rep = freshness_mod.assess(db_fresh=base, series_latest=series, relay=stream.hub.debug(), bootstrap=None, watermarks=marks)
    return {s["id"]: s for s in rep["series"]}


def _freshness_block(ids: list[str]) -> dict[str, dict]:
    states = _series_states()
    return {i: states[i] for i in ids if i in states}


def _all_in_state(defaults: dict, block: dict[str, dict]) -> dict:
    """The LBO all-in rate is Fed funds plus the HY spread: fallback when the
    stated defaults are in use, else the weaker of its two components."""
    if defaults.get("is_fallback"):
        return freshness_mod._state("lbo_all_in_rate", "LBO all-in rate", "derived", "daily", None, "fallback",
                                    reason="The stated default rate (Fed funds 5.33% + HY spread 3.27%); the stored rates are unavailable.")
    parts = [block.get("FEDFUNDS"), block.get("BAMLH0A0HYM2")]
    states = [x["state"] for x in parts if x]
    state = "stale" if "stale" in states else ("unknown" if len(states) < 2 or "unknown" in states else "close")
    as_of = min((x["as_of"] for x in parts if x and x.get("as_of")), default=None)
    return freshness_mod._state("lbo_all_in_rate", "LBO all-in rate", "derived", "daily", as_of, state,
                                reason="Fed funds (monthly average) plus the high-yield spread; judged by its weaker component.")


def _round_to_half(x: float) -> float:
    return round(x * 2) / 2


@api.post("/lbo/run", response_model=LboResponse)
def api_lbo_run(req: LboRequest) -> LboResponse:
    """Run the LBO model plus the 5×5 entry-vs-exit IRR sensitivity grid.
    Every cell is a full run_lbo_model call with the other inputs held fixed
    (src/analytics/lbo.py owns all deal math). Pure computation, no DB."""
    from src.analytics.lbo import run_lbo_model

    kwargs = req.model_dump()
    result = run_lbo_model(**kwargs)

    entry_center = _round_to_half(req.entry_multiple)
    exit_center = _round_to_half(req.exit_multiple)
    entry_range = [
        entry_center + d for d in (-1.0, -0.5, 0.0, 0.5, 1.0) if 3.0 <= entry_center + d <= 20.0
    ]
    exit_range = [
        exit_center + d for d in (-1.0, -0.5, 0.0, 0.5, 1.0) if 3.0 <= exit_center + d <= 20.0
    ]
    grid: list[list[float | None]] = []
    for em in entry_range:
        row: list[float | None] = []
        for xm in exit_range:
            cell = run_lbo_model(**{**kwargs, "entry_multiple": em, "exit_multiple": xm})
            row.append(cell["irr"] if cell["viable"] else None)
        grid.append(row)

    return LboResponse(
        result=LboResult(**result),
        sensitivity=LboSensitivity(
            entry_multiples=entry_range,
            exit_multiples=exit_range,
            entry_center=entry_center,
            exit_center=exit_center,
            irr_grid=grid,
        ),
    )


# ── Allocation (night-2) ─────────────────────────────────────────────────────

@api.get("/allocation")
def api_allocation() -> dict:
    """Full allocation payload from src/analytics/allocation.get_allocation_data:
    regime-conditional stats, 7 optimization methods, efficient frontier, tail
    risk, factor/style/currency attribution. Computed by the background worker
    from the price histories the full refresh stores (fix/prelaunch-1): this
    server never downloads them, and on a database that predates them answers
    503 not_stored in plain words. `histories` says as of when and from which
    providers; `freshness.asset_prices` carries the contract's state.

    Returns a plain dict (the only /api endpoint without a strict model —
    leaf shapes are asset×regime matrices keyed by data, mirrored as-is;
    documented deviation, night-2 report)."""
    from api import analytics_cache

    try:
        payload = _guarded(analytics_cache.get_cached_allocation)
    except ModuleNotFoundError as exc:
        # The module's name is for the server log, not for a visitor
        # (launch-1, item 2 re-audit, F6).
        log.error("allocation engine dependency missing: %s (install requirements-api.lock)", exc.name)
        raise HTTPException(
            status_code=503,
            detail="Allocation is not available on this server right now. Every other screen works as usual.",
        ) from exc
    except (HTTPException, NotStored, worker_mod.Warming):
        raise
    except Exception as exc:  # a numerical failure over the stored histories
        log.warning("allocation failed: %s", type(exc).__name__)
        raise HTTPException(
            status_code=502,
            detail="Allocation could not be computed from the stored histories this time.",
        ) from exc
    return {**payload, "freshness": _freshness_block(["asset_prices"])}


# ── News & Calendar fallbacks (night-2) ──────────────────────────────────────

@api.get("/news/latest", response_model=list[NewsItem])
def api_news_latest(
    category: str | None = Query(None, description="DB category value, e.g. GEOPOLITICAL"),
    limit: int = Query(50, ge=1, le=200),
) -> list[NewsItem]:
    """Latest-available fallback: most recent stored headlines regardless of
    recency window — a stalled pipeline shows dated headlines, never zeros."""
    rows = _guarded(lambda: db.news_latest(category, limit))
    return [NewsItem(**r) for r in rows]


@api.get("/calendar/recent", response_model=list[CalendarEvent])
def api_calendar_recent(
    limit: int = Query(10, ge=1, le=100),
    include: str | None = Query(None, pattern="^earnings$", description=_CALENDAR_INCLUDE),
) -> list[CalendarEvent]:
    """Most recent past events (newest first) — the calendar's latest-available
    fallback when the upcoming window is empty."""
    rows = _guarded(lambda: db.calendar_recent(limit, include_earnings=include == "earnings"))
    return [CalendarEvent(**r) for r in rows]


app.include_router(api)
app.include_router(assistant_router)
from api.desk import router as desk_router  # noqa: E402  (desk/event-study: /api/desk/event-study[/assets])

app.include_router(desk_router)


@app.websocket("/api/stream/ws")
async def api_stream_ws(websocket: WebSocket) -> None:
    """Live-quote fanout — snapshot on connect, then coalesced tick batches.
    The EODHD token never crosses this boundary (api/stream.py docstring)."""
    await stream.hub.register(websocket)


@app.get("/api/stream/debug")
def api_stream_debug(request: Request) -> dict:
    """Relay ops view — feed states, stale flags, degraded verdict, reconnect
    backoff, last frame per feed, sanitized last error, subscription counts.
    No secrets: symbols and counts only. Gated by OPS_ACCESS_KEY when set."""
    _ops_gate(request)
    return stream.hub.debug()


@app.get("/health/live")
def health_live() -> dict:
    """Process liveness only — answers as long as the event loop runs."""
    from datetime import timezone as _tz

    return {"status": "ok", "time": datetime.now(_tz.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


@app.get("/health/ready")
def health_ready() -> JSONResponse:
    """Readiness: the snapshot opens read-only and holds regime rows. 503 with
    a reason otherwise, so a host's health check keeps traffic off a booting
    or torn instance without ever exposing a path or token."""
    try:
        row = db.latest_regime()
    except db.DBUnavailable as exc:
        return JSONResponse(status_code=503, content={"status": "not_ready", "reason": "database unavailable", "detail": _sanitized(exc)})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(status_code=503, content={"status": "not_ready", "reason": type(exc).__name__})
    if not row:
        return JSONResponse(status_code=503, content={"status": "not_ready", "reason": "no regime rows"})
    analytics = worker_mod.get_worker()
    analytics.ensure_started()
    if not analytics.ready():
        # fix/prelaunch-1: ready only once the first background pass has built
        # every derived result, so a host never routes traffic to a server
        # that would answer "warming".
        return JSONResponse(status_code=503, content={"status": "warming", "reason": "the first background pass has not completed", "worker": analytics.status()})
    boot = bootstrap.status()
    return JSONResponse(
        content={
            "status": "ready",
            "regime_date": row.get("date"),
            "db_mtime": boot.get("db_mtime"),
            "snapshot_downloaded_at": boot.get("last_downloaded_at"),
            "relay_degraded": stream.hub.degraded()[0],
            "worker": analytics.status(),
        }
    )


# ── Static bundle (Phase 8: one process serves everything) ───────────────────
# When web/dist exists (docker image, or a local `npm run build`), mount the
# built React app. Every API route above is registered first, so /api/*, the
# unprefixed Atlas routes, and /api/stream/ws keep priority — the catch-all
# only ever sees paths nothing else matched. Absent dist (dev): skip the
# mounts entirely; the Vite dev server on :5173 proxies /api as before.

# First path segments owned by the API — an unmatched path under any of these
# is a JSON 404 (exactly the pre-mount behavior), never the SPA shell.
_NON_SPA_FIRST_SEGMENTS = {"api", "health", "regime", "signals", "series"}
def _csp() -> str:
    """Content-Security-Policy for the served shell. Inline styles are part
    of the React bundle's styling model; scripts are bundle-only. Extra
    connect targets (a split API/WS host) come from CSP_CONNECT_SRC."""
    extra = " ".join(o.strip() for o in os.environ.get("CSP_CONNECT_SRC", "").split(",") if o.strip())
    return (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; font-src 'self' data:; "
        f"connect-src 'self' {extra}; ".replace("  ", " ")
        + "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
    )


# Read at request time, so a test can point it at a scratch bundle.
WEB_DIST = _WEB_DIST

if _WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_WEB_DIST / "assets"), name="assets")
    app.mount("/fonts", StaticFiles(directory=_WEB_DIST / "fonts"), name="fonts")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str) -> FileResponse:
        """SPA fallback: a file the bundle ships at its root (the favicons, the
        validated snapshot) is served as itself; client-side routes (/, /app/*,
        /kit) get index.html; unknown API-ish paths stay JSON 404s exactly as
        before the mount (launch-1 verify loop 1: the snapshot and favicons
        used to come back as index.html)."""
        if full_path.split("/", 1)[0] in _NON_SPA_FIRST_SEGMENTS:
            raise HTTPException(status_code=404, detail="Not Found")
        base = Path(WEB_DIST).resolve()
        if full_path and full_path != "index.html":
            try:
                candidate = (base / full_path).resolve()
                is_file = base in candidate.parents and candidate.is_file()
            except (ValueError, OSError):  # a null byte or an impossible path: not a file
                is_file = False
            if is_file:
                cache = "public, max-age=300" if full_path.startswith("snapshot/") else "public, max-age=86400"
                return FileResponse(candidate, headers={"Cache-Control": cache})
        return FileResponse(base / "index.html", headers={"Content-Security-Policy": _csp(), "Cache-Control": "no-cache"})

else:
    log.info("web/dist absent — SPA not mounted; dev flow (Vite :5173) unchanged")
