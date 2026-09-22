/**
 * Response types for the FastAPI service (api/main.py). Field names mirror the
 * Pydantic models exactly — the unprefixed endpoints are a frozen contract
 * with Atlas, and /api/* mirrors the Streamlit loaders. Do not rename fields.
 */

export type RegimeLabel =
  | "Goldilocks"
  | "Overheating"
  | "Stagflation"
  | "Recession Risk";

export type AlertLevel = "info" | "watch" | "risk";

export interface Health {
  status: string;
  db_present: boolean;
}

export interface Regime {
  date: string;
  label: RegimeLabel;
  confidence: number;
  growth_trend: number | null;
  inflation_trend: number | null;
  prob_goldilocks: number | null;
  prob_overheating: number | null;
  prob_stagflation: number | null;
  prob_recession: number | null;
}

export type SignalStatus = "Clear" | "Watch" | "Triggered";

export interface Signal {
  signal_name: string;
  /** This signal's own as-of date — carry-forward keeps the last print alive. */
  date: string;
  value: number;
  triggered: boolean;
  threshold: number | null;
  direction: "above" | "below" | null;
  /** Threshold proximity 0–100 (100 = at/past trigger), server-computed. */
  distance_pct: number | null;
  /** Clear | Watch | Triggered — the stored triggered flag owns Triggered. */
  status: SignalStatus | null;
}

export interface SignalsSnapshot {
  /** Newest as-of date across the set. */
  date: string;
  signals: Signal[];
  /** B3: per-series state on /api/signals/latest only (the frozen Atlas
   * /signals/latest keeps the old shape). */
  freshness?: Record<string, SeriesState> | null;
}

export interface Alert {
  id: number;
  date: string;
  alert_type: string;
  name: string;
  level: AlertLevel;
  value: number | null;
  threshold: number | null;
  direction: string | null;
  message: string | null;
  created_at: string | null;
}

export interface NewsItem {
  id: number;
  headline: string;
  summary: string | null;
  url: string | null;
  source: string | null;
  category: string | null;
  published_at: string | null;
  fetched_at: string | null;
  market_impact: number | null;
  deal_size: number | null;
  sector_relevance: number | null;
  time_sensitivity: number | null;
  regime_relevance: number | null;
  overall_significance: number | null;
  regime_interpretation: string | null;
  perplexity_research: string | null;
  ticker: string | null;
}

export interface DailyBar {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  vwap: number | null;
  ret_1d: number | null;
  ret_1w: number | null;
  ret_1m: number | null;
}

export interface IntradayPoint {
  symbol: string;
  ts: string;
  close: number | null;
  volume: number | null;
}

export interface CalendarEvent {
  id: number;
  event_name: string;
  event_datetime: string;
  importance: string | null;
  source: string | null;
  /** B5: set on large-cap earnings rows (kind "earnings"), which the calendar
   * routes return only with ?include=earnings. */
  symbol?: string | null;
  kind?: string | null;
}

export interface BacktestRow {
  test_name: string;
  cohort: string;
  horizon: string;
  avg_return: number | null;
  median_return: number | null;
  hit_rate: number | null;
  n: number | null;
  computed_at: string | null;
}

export interface DatedValue {
  date: string;
  value: number;
}

export interface CreditSeries {
  series_id: string;
  label: string;
  date: string;
  value_pct: number;
  value_bps: number;
  change_1w_bps: number | null;
  history: DatedValue[];
}

export interface CreditOAS {
  as_of: string | null;
  series: CreditSeries[];
  /** B3: the five BAML series and DGS10 (FRESHNESS_CONTRACT §6). */
  freshness?: Record<string, SeriesState> | null;
}

export interface RecessionMetrics {
  probability_source: string;
  recession_prob: number | null;
  recession_label: string;
  recession_color: string;
  yield_curve_spread: number | null;
  yield_curve_pct_rank: number | null;
  inversion_duration_months: number | null;
  is_inverted: boolean | null;
  divergence_score: number | null;
  divergence_label: string;
  divergence_color: string;
  recession_prob_series: DatedValue[];
  yield_curve_series: DatedValue[];
  usrec_series: DatedValue[];
  n_training_samples: number;
  model_features: string[];
  feature_coefficients: Record<string, number>;
  data_as_of: string;
  curve_shape: Record<string, number | null>;
  current_inputs: Record<string, number | null>;
  /** B3: per-series state for the model's inputs (FRESHNESS_CONTRACT §6). */
  freshness?: Record<string, SeriesState> | null;
}

export interface PricedMetric {
  group: string;
  metric: string;
  label: string;
  unit: string;
  /** Week-end Friday stamp from the derived-metrics pipeline. */
  date: string;
  value: number;
  mom_chg: number | null;
}

export interface Surprise {
  metric: string;
  label: string;
  /** Week-end Friday stamp from the derived-metrics pipeline. */
  date: string;
  z_score: number;
  raw_value: number | null;
  interpretation: string;
}

export interface AssistantStatus {
  resting: boolean;
  spent_usd: number | null;
  cap_usd: number;
  reserve_usd: number;
  resets_at: string;
  ledger: string;
  /** Whether the ledger is on a mounted disk (launch-1): false means a restart starts a fresh day. */
  ledger_persistent?: boolean;
  reason: string | null;
}

export interface FreshnessGeneration {
  id: number | null;
  built_at: string | null;
  source: string | null;
}

export interface Freshness {
  regimes_date: string | null;
  signals_date: string | null;
  market_daily_date: string | null;
  market_intraday_ts: string | null;
  news_published_at: string | null;
  raw_series_date: string | null;
  /** Source-aware report (api/freshness.py, 2026-09-06); optional so the six
   * stored maxima stay a stable contract. */
  generated_at?: string | null;
  overall?: "current" | "delayed" | "stale" | "unavailable" | null;
  session?: SessionState | null;
  sla?: SlaRow[] | null;
  regime?: RegimeFreshness | null;
  bootstrap?: BootstrapStatus | null;
  relay?: { feeds: Record<string, string>; feed_stale: Record<string, boolean>; degraded: boolean; degraded_reasons: string[]; token_configured: boolean } | null;
  /** Which generation of derived results answered this request (launch-1):
   * when it changes, an open tab drops every cache read from the database. */
  generation?: FreshnessGeneration | null;
  /** B3 (2026-09-18): one state object per source, rendered by
   * screens/shared/fresh-state.ts (docs/redesign-v2/FRESHNESS_CONTRACT.md §1). */
  series?: SeriesState[];
  /** Set by the snapshot builder: every state is "unknown" until the live
   * report replaces it (FRESHNESS_CONTRACT §5). */
  seeded?: boolean;
}

/* ── Per-series freshness (B3, docs/redesign-v2/FRESHNESS_CONTRACT.md) ──── */

/** Closed set; any other word from the server renders as "unknown". Not the
 * same type as screens/shared/freshness.ts `FreshState` (the older
 * cadence-assessed chip vocabulary). */
export type FreshState = "live" | "delayed" | "close" | "stale" | "fallback" | "unknown";

export interface SeriesState {
  /** "DGS10", "market_daily", "live_quotes", "lbo_all_in_rate", … */
  id: string;
  /** Plain-English name, ready for display. */
  label: string;
  kind: "fred" | "market" | "live" | "derived";
  cadence: "daily" | "monthly" | "5min" | "tick" | "60s";
  /** The true observation date or stamp: YYYY-MM-DD (daily, monthly = the
   * first of the print's month), YYYY-MM-DD HH:MM:SS New York wall time
   * (intraday bars) or an ISO UTC timestamp (relay ticks). */
  as_of: string | null;
  state: FreshState;
  /** Only for "live" (0) and "delayed" (N minutes). */
  delay_min: number | null;
  /** Publications behind the newest one due; null when not applicable. */
  cycles_behind: number | null;
  /** Exactly (state === "stale"). */
  stale: boolean;
  /** True only for a series the source no longer publishes (USSLIND). */
  discontinued: boolean;
  /** One plain sentence for a tooltip or Details, never the headline. */
  reason: string;
}

/* ── Regime Lab (night-2 endpoints) ────────────────────────────────────── */

export interface Takeaway {
  /** May carry <strong> emphasis from the source module — parse, never inject. */
  narrative: string;
  conviction: "High" | "Medium" | "Low";
  conviction_color: string;
  primary_signal: "Risk-On" | "Risk-Off" | "Mixed";
  divergences: string[];
  updated_ago: string;
  /** Stored softmax, 0–1, lowercase keys. */
  regime_probs: Record<string, number>;
  current_regime: RegimeLabel;
}

export interface SectorTilt {
  sector: string;
  strength: number;
}

export interface AssetPerf {
  avg_return: number;
  hit_rate: number;
}

export interface RegimePlaybook {
  regime: RegimeLabel;
  regime_color: string;
  description: string;
  historical_frequency: number;
  avg_duration_months: number;
  sector_tilts: { overweight: SectorTilt[]; underweight: SectorTilt[] };
  asset_performance: Record<string, AssetPerf>;
  typical_indicators: Record<string, string>;
  key_risks: string[];
  warning_signs: string[];
  typical_catalysts: string[];
  opportunities: string[];
}

export interface RegimeDuration {
  current_regime: RegimeLabel;
  days_in_regime: number;
  months_in_regime: number;
  historical_avg_months: number;
  percentile_duration: number;
  progress_pct: number;
  status: "Early" | "Mid-Cycle" | "Extended" | "Long in Tooth";
  status_color: string;
  risk_indicators: { momentum: number; valuation: number; sentiment: number };
}

export interface TransitionItem {
  to: RegimeLabel;
  probability: number;
  color: string;
}

export interface TransitionOutlook {
  current_regime: RegimeLabel;
  stay_probability_3m: number;
  transitions_3m: TransitionItem[];
  transitions_6m: TransitionItem[];
  narrative_3m: string;
  narrative_6m: string;
  highest_risk_transition: string;
  highest_risk_prob: number;
  highest_risk_color: string;
}

export interface Analogue {
  period: string;
  period_end: string;
  regime: string;
  similarity_score: number;
  similarity_color: string;
  hy_spread_pct: number;
  recession_prob: number;
  what_happened: string;
  time_to_change: string;
  next_regime: string;
  key_drivers: string[];
  market_impact: Record<string, string>;
  lessons_for_today: string;
  resolution: string;
}

export interface ScenarioShocks {
  hy_spread_delta_bps: number;
  yield_10y_delta_bps: number;
  vix_delta: number;
  spx_delta_pct: number;
}

export interface ScenarioDef {
  key: string;
  name: string;
  emoji: string; // source-faithful; the terminal's glyph rules skip rendering it
  description: string;
  severity: string;
  color: string;
  input_shocks: ScenarioShocks;
  historical_reference: string;
  what_happened_then: string;
  sector_implications: { overweight: string[]; underweight: string[] };
  duration_estimate: string;
  indicators_to_watch: string[];
}

export interface ScenarioResult {
  scenario_name: string;
  emoji: string;
  description: string;
  severity: string;
  color: string;
  historical_reference: string;
  what_happened_then: string;
  input_shocks: ScenarioShocks;
  /** 0–100, lowercase-underscore keys (goldilocks, …, recession_risk). */
  current_regime_probs: Record<string, number>;
  stressed_regime_probs: Record<string, number>;
  prob_changes: Record<string, number>;
  most_likely_regime: string;
  most_likely_prob: number;
  positioning_implications: string[];
  sector_implications: { overweight: string[]; underweight: string[] };
  duration_estimate: string;
  indicators_to_watch: string[];
}

/* ── Credit metrics ────────────────────────────────────────────────────── */

export interface CreditMetrics {
  hy_oas: number | null;
  ig_oas: number | null;
  ccc_oas: number | null;
  bb_oas: number | null;
  b_oas: number | null;
  /** Month-over-month despite the historical key name (monthly FRED series). */
  hy_1w_change: number | null;
  ig_1w_change: number | null;
  ccc_1w_change: number | null;
  bb_1w_change: number | null;
  b_1w_change: number | null;
  hy_ig_ratio: number | null;
  /** B2: CCC OAS as a percent of the 1,000 bps distress line; may exceed 100 (not a share). */
  ccc_pct_of_distress_line: number | null;
  /** B2: CCC OAS minus 1,000 bps, signed. Optional so older snapshots still type-check. */
  ccc_bps_vs_distress_line?: number | null;
  lbo_all_in_cost: string | null;
  credit_label: string;
  credit_label_color: string;
  hy_pct_rank: number | null;
  ig_pct_rank: number | null;
  hy_series: DatedValue[];
  ig_series: DatedValue[];
  data_as_of: string | null;
  transition_3m: Record<string, Record<string, number>>;
  transition_6m: Record<string, Record<string, number>>;
  /** Months counted behind each from-state row of the matrices (a row with 0
   * has no history). Optional so older snapshots still type-check. */
  transition_obs_3m?: Record<string, number> | null;
  transition_obs_6m?: Record<string, number> | null;
  tight_count: number;
  hy_sparkline: DatedValue[];
  ig_sparkline: DatedValue[];
  ccc_sparkline: DatedValue[];
  bb_sparkline: DatedValue[];
  b_sparkline: DatedValue[];
  /** B3: the five BAML series and FEDFUNDS (FRESHNESS_CONTRACT §6). */
  freshness?: Record<string, SeriesState> | null;
}

/* ── Recession sensitivity ─────────────────────────────────────────────── */

export interface RecessionScenarioRequest {
  yield_curve_bps: number;
  unemployment: number;
  hy_oas_bps: number;
  indpro_yoy: number;
  lei: number;
}

export interface RecessionScenarioResult {
  probability: number;
  label: string;
  color: string;
  baseline_prob: number | null;
  delta_pp: number | null;
}

/* ── LBO ───────────────────────────────────────────────────────────────── */

export interface LboDefaults {
  fedfunds: number;
  hy_oas_pct: number;
  lbo_all_in_rate: number;
  /** The later stored row stamp, or "unavailable"; the freshness block has
   * the true dates. */
  data_as_of: string;
  /** B3: "fallback" when the stated defaults stand in for stored rates. */
  status?: "live" | "fallback";
  is_fallback?: boolean;
  /** The stored row dates of the two components. */
  fedfunds_as_of?: string | null;
  hy_oas_as_of?: string | null;
  /** B3: FEDFUNDS, BAMLH0A0HYM2 and lbo_all_in_rate (FRESHNESS_CONTRACT §6). */
  freshness?: Record<string, SeriesState> | null;
}

export interface LboRequest {
  ebitda: number;
  ebitda_growth_rate: number;
  entry_multiple: number;
  exit_multiple: number;
  hold_period: number;
  leverage_ratio: number;
  interest_rate: number;
  amortization_rate: number;
  mgmt_fee_pct: number;
}

export interface LboYear {
  year: number;
  ebitda: number;
  implied_ev: number;
  debt_start: number;
  debt_end: number;
  interest: number;
}

export interface LboResult {
  entry_ev: number;
  entry_debt: number;
  entry_equity: number;
  exit_ev: number | null;
  exit_debt: number | null;
  exit_equity: number | null;
  moic: number | null;
  irr: number | null;
  equity_gain: number | null;
  schedule: LboYear[];
  viable: boolean;
  error_msg: string;
}

export interface LboSensitivity {
  entry_multiples: number[];
  exit_multiples: number[];
  /** Server-computed grid centers — outline by these, never re-round
   * client-side (Python rounds halves to even; JS rounds up). */
  entry_center: number;
  exit_center: number;
  /** rows = entry, cols = exit; null = not viable. */
  irr_grid: (number | null)[][];
}

export interface LboResponse {
  result: LboResult;
  sensitivity: LboSensitivity;
}

/* ── Allocation ────────────────────────────────────────────────────────── */

/** DataFrame serialized as {index, columns, data} (api/analytics_cache). */
export interface FrameData {
  index: (string | number)[];
  columns: string[];
  data: (number | null)[][];
}

export interface RegimeStats {
  mean: Record<string, number>; // annualized
  std: Record<string, number>; // annualized
  sharpe: Record<string, number | null>;
  n_months: number;
}

export interface OptimizationResult {
  weights: number[];
  expected_return: number;
  volatility: number;
  sharpe_ratio: number;
  method: string;
  converged: boolean;
  /** Portfolio tail risk at 95%, as a dict (NOT a scalar). The payload also
   * carries `worst_periods`; only the fields consumed here are declared. */
  cvar_95: { cvar: number; var: number } | null;
}

export interface CvarEntry {
  cvar: number;
  var: number;
  n_periods: number;
}

/** Exact optimizer sample accounting (2026-09-06): the numbers the
 * covariance gate actually saw for the current regime. */
export interface OptimizationSample {
  regime: string;
  total_regime_months: number;
  stats_months: number;
  complete_months: number;
  cov_months: number;
  excluded_months: number;
  excluded_range: string | null;
  complete_range: string | null;
  assets_total: number;
  assets_responsible: { asset: string; missing_months: number }[];
  required_stats_months: number;
  required_cov_months: number;
  stats_ok: boolean;
  cov_ok: boolean;
  sentence: string;
  window?: string;
}

/** What the adaptive universe had to leave out to build a rectangular sample
 * (N-B2). Served whenever the optimizer ran; `reduced` is true when the panel
 * has to state it, because weights that leave asset classes out must say so. */
export interface OptimizerUniverse {
  included: string[];
  excluded: { asset: string; missing_months: number; reason: string }[];
  assets_total: number;
  assets_used: number;
  regime_months: number;
  months_used: number;
  required_months: number;
  standard_months: number;
  lowered: boolean;
  reduced: boolean;
  ok: boolean;
  sentence: string;
}

export interface AllocationData {
  current_regime: RegimeLabel;
  confidence: number;
  dominant_prob: number | null;
  rf_rate: number;
  regime_stats: Record<string, RegimeStats>;
  regime_correlations: Record<string, FrameData>;
  optimizations: (Record<string, OptimizationResult> & {
    frontier: FrameData;
    asset_names: string[];
    universe?: OptimizerUniverse;
  }) | null;
  optimizations_skipped?: (OptimizationSample & { window: string }) | null;
  drawdowns: { by_regime: FrameData; overall: Record<string, number> };
  data_start: string;
  data_end: string;
  n_months: number;
  /** `list(ASSET_CLASSES.keys())` from src/analytics/allocation.py: the asset
   * class names, in house order. It was declared as a Record of ETF metadata,
   * which the API has never sent. */
  asset_classes: string[];
  cvar_95: { confidence: number; asset_cvar: Record<string, CvarEntry> };
  cvar_99: { confidence: number; asset_cvar: Record<string, CvarEntry> };
  regime_cvar: Record<string, { confidence: number; asset_cvar: Record<string, CvarEntry> }>;
  transition_pnl: Record<
    string,
    { count: number; avg_return: Record<string, number>; total_return?: Record<string, number> }
  >;
  /** Null whenever the source has no CPI series or the deflation step raised. */
  real_nominal: Record<
    string,
    {
      nominal: Record<string, number>;
      real: Record<string, number>;
      inflation_drag: Record<string, number>;
      n_months: number;
    }
  > | null;
  regime_factors: Record<string, Record<string, number>>;
  portfolio_factors: Record<
    string,
    { exposures: Record<string, number>; r_squared: number; alpha: number } | null
  >;
  /** The long-short spread rows ("Growth-Value Spread", "Small-Large Spread")
   * carry a return and nothing else, so the other three are optional. */
  style_performance: Record<
    string,
    Record<
      string,
      { return: number; volatility?: number; sharpe?: number; hit_rate?: number }
    >
  > | null;
  currency_impact: Record<string, Record<string, { return: number; volatility: number }>> | null;
}

/* ── On-demand symbol layer (Phase-2 Markets expansion) ─────────────────── */

export interface SearchHit {
  symbol: string;
  name: string;
  exchange: string | null;
  type: string | null;
  sector: string | null;
  country?: string | null;
  currency?: string | null;
  primary?: boolean;
}

/** Search envelope (2026-09-06): the provider that answered is part of the
 * result, so the list can name it (EODHD only since fix/prelaunch-1). */
export interface SearchResponse {
  provider: Provider;
  fallback_used: boolean;
  fallback_reason: string | null;
  fetched_at: string;
  hits: SearchHit[];
}

export type Provider = "eodhd" | "yfinance" | "api" | string | "finnhub";

export interface SymbolProfile {
  symbol: string;
  name: string;
  exchange: string | null;
  currency: string | null;
  quote_type: string | null;
  sector: string | null;
  industry: string | null;
  last: number;
  prev_close: number | null;
  day_change_pct: number | null;
  day_low: number | null;
  day_high: number | null;
  year_low: number | null;
  year_high: number | null;
  market_cap: number | null;
  last_volume: number | null;
  avg_volume_3m: number | null;
  trailing_pe: number | null;
  forward_pe: number | null;
  eps_ttm: number | null;
  beta: number | null;
  dividend_yield: number | null;
  price_to_book: number | null;
  profit_margin: number | null;
  revenue_growth: number | null;
  fifty_two_wk_change: number | null;
  fetched_at: string;
  /** Provenance (2026-09-06). */
  market_ts: string | null;
  quote_provider: Provider | null;
  fundamentals_provider: Provider | null;
  /** launch-1: ok (Finnhub filled it) · not_covered (no company behind the
   * symbol: a fund, an index, a currency) · unavailable (the source did not
   * answer this time). */
  fundamentals_status?: "ok" | "not_covered" | "other_listing" | "not_configured" | "unavailable" | null;
  delayed: boolean;
  delay_note: string | null;
  fallback_used: boolean;
  fallback_reason: string | null;
}

export interface CandleBar {
  ts: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
}

/** One provider per series, always disclosed; never a bare bar list. */
export interface CandleSeries {
  symbol: string;
  provider: Provider;
  fallback_used: boolean;
  fallback_reason: string | null;
  fetched_at: string;
  market_ts: string | null;
  delayed: boolean;
  interval: string;
  range: CandleRange;
  exchange: string | null;
  timezone: string | null;
  adjustment: string;
  count: number;
  bars: CandleBar[];
}

export interface OptionsExpirations {
  symbol: string;
  underlying: string;
  provider: Provider;
  as_of: string | null;
  cadence: "end_of_day";
  fetched_at: string;
  expirations: string[];
  truncated: boolean;
}

export interface OptionContract {
  contract: string | null;
  type: "call" | "put" | string | null;
  strike: number | null;
  exp_date: string | null;
  expiration_type: string | null;
  dte: number | null;
  bid: number | null;
  ask: number | null;
  last: number | null;
  midpoint: number | null;
  volume: number | null;
  open_interest: number | null;
  implied_vol: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  moneyness: number | null;
  tradetime: string | null;
  last_quote: string | null;
}

export interface OptionsChain {
  symbol: string;
  underlying: string;
  provider: Provider;
  cadence: "end_of_day";
  as_of: string | null;
  fetched_at: string;
  expiration: string;
  type: string | null;
  strike_from: number | null;
  strike_to: number | null;
  page: number;
  limit: number;
  count: number;
  total: number | null;
  has_more: boolean;
  contracts: OptionContract[];
}

export interface CorporateActions {
  symbol: string;
  provider: Provider;
  fallback_used: boolean;
  fallback_reason: string | null;
  fetched_at: string;
  from: string;
  splits: { date: string | null; ratio: number | null; text: string | null }[];
  dividends: {
    date: string | null;
    value: number | null;
    unadjusted_value: number | null;
    currency: string | null;
    period: string | null;
    declaration_date: string | null;
    record_date: string | null;
    payment_date: string | null;
  }[];
}

/** Typed provider failure body (api/main.py ProviderError handler). */
export interface ProviderErrorBody {
  detail: string;
  kind:
    | "missing_token"
    | "unauthorized"
    | "unknown_symbol"
    | "unsupported"
    | "rate_limited"
    | "timeout"
    | "unavailable"
    | "malformed"
    | "empty"
    | string;
  provider: Provider;
  retryable: boolean;
}

export interface Entitlement {
  family: string;
  available: boolean | null;
  status: number | null;
  reason: string;
  coverage: Record<string, unknown>;
  checked_at: string | null;
  source: "probe" | "live";
}

export interface StreamDebug {
  generated_at: string;
  token_configured: boolean;
  feeds: Record<string, string>;
  feed_stale: Record<string, boolean>;
  degraded: boolean;
  degraded_reasons: string[];
  clients: number;
  symbols_stored: number;
  reconnect_backoff_s: Record<string, number>;
  subscriptions: { fixed: Record<string, number>; dynamic: number; dynamic_max: number; dynamic_symbols: string[]; active_total: number };
  session: SessionState;
  feed_frames: Record<string, number>;
  feed_connects: Record<string, number>;
  feed_last_error: Record<string, string | null>;
  feed_last_frame_at: Record<string, string | null>;
  feed_last_change_at: Record<string, string | null>;
  ticks_stored: number;
  flushes_sent: number;
}

export interface ProvidersStatus {
  generated_at: string;
  eodhd_configured: boolean;
  primary: Record<string, { primary: string; fallback: string }>;
  entitlements: Record<string, Entitlement>;
  cache: Record<string, number>;
  relay: StreamDebug;
  security: { assistant_mode: "open" | "key" | "off"; counters: Record<string, number> };
}

export interface SessionState {
  exchange: string;
  timezone: string;
  phase: "pre" | "open" | "post" | "weekend" | "holiday";
  is_open: boolean;
  today_is_trading_day: boolean;
  early_close: boolean;
  last_completed_session: string;
  next_open_utc: string | null;
  calendar_known: boolean;
  local_time: string;
}

export interface SlaRow {
  feed: string;
  latest: string | null;
  expected: string | null;
  verdict: "current" | "delayed" | "stale" | "unavailable";
  reason: string;
}

export interface RegimeFreshness {
  latest_month: string | null;
  expected_month: string;
  common_feature_month: string | null;
  inputs: { series: string; label: string; latest_month: string | null; expected_month: string; verdict: string }[];
  blockers: { series: string; label: string; latest_month: string | null; expected_month: string; cause: string }[];
}

export interface BootstrapStatus {
  token_configured: boolean;
  last_attempt_at: string | null;
  last_result: string | null;
  last_error: string | null;
  last_downloaded_at: string | null;
  asset_updated_at: string | null;
  asset_size: number | null;
  refresh_interval_min: number;
  max_age_min: number | null;
  db_mtime: string | null;
  db_size: number | null;
}

export type CandleRange = "1D" | "5D" | "1M" | "6M" | "1Y" | "5Y" | "MAX";
