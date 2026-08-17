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

export interface Freshness {
  regimes_date: string | null;
  signals_date: string | null;
  market_daily_date: string | null;
  market_intraday_ts: string | null;
  news_published_at: string | null;
  raw_series_date: string | null;
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
  distress_ratio: number | null;
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
  tight_count: number;
  hy_sparkline: DatedValue[];
  ig_sparkline: DatedValue[];
  ccc_sparkline: DatedValue[];
  bb_sparkline: DatedValue[];
  b_sparkline: DatedValue[];
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
  data_as_of: string;
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
  cvar_95: number | null;
}

export interface CvarEntry {
  cvar: number;
  var: number;
  n_periods: number;
}

export interface AllocationData {
  current_regime: RegimeLabel;
  confidence: number;
  dominant_prob: number | null;
  rf_rate: number;
  regime_stats: Record<string, RegimeStats>;
  regime_correlations: Record<string, FrameData>;
  optimizations: Record<string, OptimizationResult> & {
    frontier: FrameData;
    asset_names: string[];
  };
  drawdowns: { by_regime: FrameData; overall: Record<string, number> };
  data_start: string;
  data_end: string;
  n_months: number;
  asset_classes: Record<string, { etf: string; index?: string | null; etf_start?: string }>;
  cvar_95: { confidence: number; asset_cvar: Record<string, CvarEntry> };
  cvar_99: { confidence: number; asset_cvar: Record<string, CvarEntry> };
  regime_cvar: Record<string, { confidence: number; asset_cvar: Record<string, CvarEntry> }>;
  transition_pnl: Record<
    string,
    { count: number; avg_return: Record<string, number>; total_return?: Record<string, number> }
  >;
  real_nominal: Record<
    string,
    {
      nominal: Record<string, number>;
      real: Record<string, number>;
      inflation_drag: Record<string, number>;
      n_months: number;
    }
  >;
  regime_factors: Record<string, Record<string, number>>;
  portfolio_factors: Record<
    string,
    { exposures: Record<string, number>; r_squared: number; alpha: number } | null
  >;
  style_performance: Record<
    string,
    Record<string, { return: number; volatility: number; sharpe: number; hit_rate: number }>
  > | null;
  currency_impact: Record<string, Record<string, { return: number; volatility: number }>> | null;
}
