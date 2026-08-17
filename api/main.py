"""api/main.py — local, read-only FastAPI service exposing Macro Regime Radar
outputs.

Two endpoint groups:
- Unprefixed (`/health`, `/regime/latest`, …) — original latest-snapshot
  contract for Atlas. Do not change field names without coordinating there.
- `/api/*` — React-migration endpoints (design handoff build-order step 1),
  mirroring every table the Streamlit dashboard reads.

CORS allows the Vite dev server origins only; the service still binds
localhost. Run with:

    uvicorn api.main:app --host 127.0.0.1 --port 8787
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Callable, TypeVar

from fastapi import APIRouter, FastAPI, HTTPException, Query, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from api import db, stream


@asynccontextmanager
async def _lifespan(_: FastAPI):
    # EODHD relay (api/stream.py) — a no-op when EODHD_API_TOKEN is absent:
    # feeds stay "off" and the client falls back to its DB poll.
    stream.hub.start()
    yield
    await stream.hub.stop()


app = FastAPI(
    title="Macro Regime Radar API",
    version="1.3.0",
    description="Read-only access to macro regime, signals, markets, news, and model outputs.",
    lifespan=_lifespan,
)

# React dev server (Vite) origins only — the built bundle will be served
# same-origin from this app, so production needs no CORS at all. POST covers
# the calculators (LBO, scenario stress, recession sensitivity) — every POST
# is pure computation over stored data; nothing writes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

T = TypeVar("T")


def _guarded(fn: Callable[[], T]) -> T:
    """Translate a missing/unopenable DB into a 503 instead of a 500."""
    try:
        return fn()
    except db.DBUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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


class CalendarEvent(BaseModel):
    id: int
    event_name: str
    event_datetime: str
    importance: str | None
    source: str | None


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
    distress_ratio: float | None
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
    year: int
    ebitda: float
    implied_ev: float
    debt_start: float
    debt_end: float
    interest: float


class LboResult(BaseModel):
    entry_ev: float
    entry_debt: float
    entry_equity: float
    exit_ev: float | None
    exit_debt: float | None
    exit_equity: float | None
    moic: float | None
    irr: float | None
    equity_gain: float | None
    schedule: list[LboYear]
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
    return SignalsLatestFull(**snap)


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
) -> list[NewsItem]:
    rows = _guarded(lambda: db.news_feed(hours, category, min_significance, limit))
    return [NewsItem(**r) for r in rows]


@api.get("/market/daily", response_model=list[DailyBar])
def api_market_daily(
    symbols: str = Query(",".join(db.WATCHLIST_SYMBOLS), description="CSV of tickers"),
    days: int = Query(120, ge=1, le=3650, description="Calendar-day lookback"),
) -> list[DailyBar]:
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(status_code=422, detail="No symbols given.")
    rows = _guarded(lambda: db.market_daily(syms, days))
    return [DailyBar(**r) for r in rows]


@api.get("/market/intraday", response_model=list[IntradayPoint])
def api_market_intraday(
    symbols: str = Query(",".join(db.INTRADAY_SYMBOLS), description="CSV of tickers"),
    since: str | None = Query(None, description="ISO UTC ts lower bound, e.g. 2026-08-04T00:00:00Z"),
) -> list[IntradayPoint]:
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(status_code=422, detail="No symbols given.")
    rows = _guarded(lambda: db.market_intraday(syms, since))
    return [IntradayPoint(**r) for r in rows]


@api.get("/calendar", response_model=list[CalendarEvent])
def api_calendar(days: int = Query(14, ge=1, le=365)) -> list[CalendarEvent]:
    rows = _guarded(lambda: db.event_calendar(days))
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
    return CreditOAS(**payload)


@api.get("/recession/probability", response_model=RecessionMetrics)
def api_recession_probability() -> RecessionMetrics:
    # Lazy import: pulls pandas + scikit-learn (requirements-api.txt), and the
    # module trains the model on first call — cached for 15 min thereafter.
    from api.recession_cache import get_cached_recession_metrics

    metrics = _guarded(get_cached_recession_metrics)
    if metrics.get("recession_prob") is None:
        raise HTTPException(status_code=404, detail="Recession model has no data.")
    return RecessionMetrics(**metrics)


@api.get("/freshness", response_model=Freshness)
def api_freshness() -> Freshness:
    return Freshness(**_guarded(db.freshness))


# ── Regime Lab endpoints (night-2) ───────────────────────────────────────────
# All computation lives in src/analytics/intelligence.py; api/analytics_cache
# only TTL-caches and JSON-converts (recession-cache precedent). Lazy imports
# keep module import light, matching /api/recession/probability.

@api.get("/regime/intelligence", response_model=Takeaway)
def api_regime_intelligence() -> Takeaway:
    """Market takeaway narrative + conviction, assembled from the same inputs
    the Streamlit Intelligence tab feeds it (cold call trains the recession
    model once; ~1 s, then cached)."""
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
    (bps), percentile ranks, HY/IG ratio, distress ratio, transition matrices,
    financing cost, and monthly series for charts."""
    from api import analytics_cache

    metrics = _guarded(analytics_cache.get_cached_credit_metrics)
    if metrics.get("hy_oas") is None:
        raise HTTPException(status_code=404, detail="No credit series data available.")
    return CreditMetrics(**metrics)


# ── Recession sensitivity (night-2) ──────────────────────────────────────────

@api.post("/recession/scenario", response_model=RecessionScenarioResult)
def api_recession_scenario(req: RecessionScenarioRequest) -> RecessionScenarioResult:
    """Score user-set inputs against the fitted logistic model — the exact
    Streamlit sensitivity-panel computation. Read-only; the model is the same
    TTL-cached artifact behind /api/recession/probability."""
    from api.recession_cache import peek_baseline_prob, score_recession_scenario
    from src.analytics.recession import _classify_prob

    prob = _guarded(
        lambda: score_recession_scenario(
            req.yield_curve_bps, req.unemployment, req.hy_oas_bps, req.indpro_yoy, req.lei
        )
    )
    if prob is None:
        raise HTTPException(status_code=404, detail="Recession model has no data.")
    label, color = _classify_prob(prob)
    # Peek, never retrain: a TTL lapse mid-slider-drag must not pause the UI
    # for a model fit just to refresh the delta's reference number.
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
    """Live financing-rate defaults (Fed Funds + HY OAS) from stored FRED data."""
    from src.analytics.lbo import get_lbo_defaults

    return LboDefaults(**_guarded(get_lbo_defaults))


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
    risk, factor/style/currency attribution. Cold call downloads return
    histories via yfinance (~30–60 s), then served from a 1-hour cache.

    Returns a plain dict (the only /api endpoint without a strict model —
    leaf shapes are asset×regime matrices keyed by data, mirrored as-is;
    documented deviation, night-2 report)."""
    from api import analytics_cache

    try:
        return _guarded(analytics_cache.get_cached_allocation)
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Allocation engine dependency missing: {exc.name}. "
            "Install requirements-api.txt into the API environment.",
        ) from exc
    except HTTPException:
        raise
    except Exception as exc:  # network failures reaching the data vendor
        raise HTTPException(
            status_code=502,
            detail=f"Allocation data unavailable — {type(exc).__name__} while "
            "building return histories.",
        ) from exc


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
def api_calendar_recent(limit: int = Query(10, ge=1, le=100)) -> list[CalendarEvent]:
    """Most recent past events (newest first) — the calendar's latest-available
    fallback when the upcoming window is empty."""
    rows = _guarded(lambda: db.calendar_recent(limit))
    return [CalendarEvent(**r) for r in rows]


app.include_router(api)


@app.websocket("/api/stream/ws")
async def api_stream_ws(websocket: WebSocket) -> None:
    """Live-quote fanout — snapshot on connect, then coalesced tick batches.
    The EODHD token never crosses this boundary (api/stream.py docstring)."""
    await stream.hub.register(websocket)


@app.get("/api/stream/debug")
def api_stream_debug() -> dict:
    """Relay ops counters — frames per feed, reconnects, stored ticks. No
    secrets: symbols and counts only."""
    return {
        "feeds": stream.hub.feeds,
        "clients": len(stream.hub._clients),  # noqa: SLF001 — ops introspection
        "symbols_stored": len(stream.hub.quotes),
        **stream.hub.stats,
    }
