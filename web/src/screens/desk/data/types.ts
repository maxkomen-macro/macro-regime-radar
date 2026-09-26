/**
 * The Desk v2 API contract (docs/desk/DESK_FRAME3_SPEC.md §12), one type per
 * response. Field names and nesting are the spec's; nothing here is invented.
 * A field the screens need that §12 lacks is added to the spec first, under
 * §12.13 "PROPOSED", and marked `PROPOSED` on its line here, so session B
 * builds the same shape.
 *
 * Fractions stay fractions (0.12 is 12%); the `_pts` and `_bp` fields are
 * already in points or basis points. Dates are ISO days ("2026-09-22") or
 * months ("2026-05") at the series' own frequency.
 *
 * Honest about what can be missing (Codex R-01, R-10): every served
 * statistic is `number | null`, and every block a panel reads on its own is
 * optional, so the compiler makes each page check a value is finite before
 * it formats it and a block is present before it reads it. A null keeps its
 * label and prints "Awaiting refresh"; a table cell prints "—" (§12.13).
 * `data/api.ts` checks the top-level shape at the response boundary.
 */

import type { Unavailable } from "./envelope";

/** §1.5's three verdicts, and §12.2's "insufficient" for fewer than 10 events. */
export type Verdict = "reliable" | "suggestive" | "no_edge" | "insufficient";

/** What the client keeps of the §12.0 envelope beside a ready answer's data
 * (`data/api.ts` `readAnswer`): its dates and engine, and the reasons of the
 * blocks served awaiting, by path ("tiles.vol", "without_condition"). */
export interface Envelope {
  as_of: string;
  generation_id: string;
  engine_version?: string;
  /** Blocks the answer serves awaiting (§1.0.2), by their §12.0 path; absent blocks with no entry did not arrive. */
  _blocks?: Record<string, Unavailable>;
}

/** PROPOSED (§12.13): an interpretive sentence the server writes for a card.
 * `label` is the boxed read's lead ("Read", "Read for the desk") or null for
 * an inline sentence; `tone: "warning"` draws the amber-bordered box (§1.4). */
export interface Read {
  label: string | null;
  text: string;
  tone: "normal" | "warning";
}

/** §12 errors: `{ "error": string }` with a 4xx/5xx status. */
export interface DeskErrorBody {
  /** The served `error.code` (or a bare `{error}` body's string). */
  error: string;
  message?: string;
  missing?: string[];
  words?: string[];
}

// ── §12.4 /ledger ─────────────────────────────────────────────────────────

export interface LedgerRow {
  slug: string;
  label: string;
  group: "spx" | "cross";
  /** §12.5: false for a row whose study cannot run (not stored, or RSI); it keeps its label and prints `unavailable.reason`. */
  available?: boolean;
  unavailable?: Unavailable | null;
  /** The row's own latest evaluable session, and whether that is not the comparison session (§12.5, v3 §3). */
  evaluated_on?: string | null;
  stale?: boolean;
  last_fired: string | null;
  /** h = 20 (§12.5). */
  horizon?: number | null;
  /** Completed outcomes at h = 20 (§12.5). */
  n: number | null;
  up_pct: number | null;
  median: number | null;
  /** The unit `median` is served in, and how it displays (§1.9, §12.5); absent, the median prints "—". */
  target_unit?: TargetUnit | null;
  display_unit?: DisplayUnit | null;
  /** The study's own baseline at h = 20 (§4.1: every Ledger row carries its own; there is no universal normal month). */
  baseline_median?: number | null;
  /** 100 × (median − baseline_median) in log percentage points, or the native difference in bp (§1.9, v3 §6). */
  vs_normal?: number | null;
  /** Absent when the server sent a verdict the Desk does not know (the pill prints "—"). */
  verdict?: Verdict;
  /** Absent when not served: the row claims neither firing nor quiet. */
  firing_now?: boolean;
  firing_day?: number | null;
  /** PROPOSED (§12.13): first session of the signal's sample, for "since 1990" / "since 2000". */
  sample_start: string | null;
  /** PROPOSED (§12.13): a short name for lists ("golden cross", "RSI < 30"). */
  short?: string;
}

export interface LedgerResponse extends Envelope {
  /** The rule every row's verdict follows (§12.5). */
  verdict_rule?: string | null;
  comparison_session?: string | null;
  prev_session?: string | null;
  /** Rows whose study completed (Too few counts as scored), and the rest of the twelve (v4 B-02). */
  scored_n?: number | null;
  unavailable_n?: number | null;
  /** Every Ledger number is at h = 20 (§12.5, v4 B-01). */
  horizon?: number | null;
  signals?: LedgerRow[];
}

// Positions (§9, §12.13) are kept in this browser: their record is in
// screens/desk/positions/store.ts; `GET /positions` is a deferred stub.

// ── §12.11 /pipeline ──────────────────────────────────────────────────────

export interface PipelineSeries {
  label: string;
  id: string;
  /** First month stored ("2023-09"). */
  from: string;
  /** Newest observation: a day for a daily series, a month for a monthly one. */
  as_of: string;
  feeds: string[];
  status: string;
  note: string | null;
}

export interface PipelineGroup {
  name: string;
  source: string;
  freq: string;
  status: string;
  /** PROPOSED (§12.13): the group's state in words ("all current", "Aug print in"). */
  status_text?: string;
  /** PROPOSED (§12.13): the group's note ("HY OAS history from 2023"). */
  note?: string | null;
  series: PipelineSeries[];
}

export interface PipelineResponse extends Envelope {
  last_refresh_utc: string | null;
  validation: string;
  groups?: PipelineGroup[];
}

// ── §12.1 /overview ───────────────────────────────────────────────────────

/** §12.1: what changed between the two XNYS sessions (B-05); only signals evaluated on `comparison_session` appear. */
export interface SinceLastClose {
  comparison_session?: string | null;
  prev_session?: string | null;
  new_fires?: { slug: string; label: string; short?: string }[];
  still_firing?: { slug: string; label: string; short?: string; firing_day: number | null }[];
  vol_change_pts: number | null;
  /** Null or absent when not served: the line says nothing about the regime. */
  regime_changed?: boolean | null;
  regime_from: string | null;
  regime_to: string | null;
  refreshed_at_utc: string | null;
}

/** A regime row as served (§12.1, §12.6): the stored row stamped K−2 for the current session month K
 * (`print`, "YYYY-MM"), its trends, and the run of equal labels ending there. */
export interface RegimeRow {
  label: string;
  print?: string;
  growth?: string;
  inflation?: string;
  months_in: number | null;
  since?: string;
  freq?: string;
  source?: string;
}

/** The recession model's score (§12.6): a fraction for `probability_month`, from inputs through
 * `inputs_through`; the band by v3 §11's edges (low < 0.20 ≤ elevated < 0.40 ≤ high_risk). */
export type RecessionBand = "low" | "elevated" | "high_risk";
export interface RecessionScore {
  score: number | null;
  probability_month?: string;
  inputs_through?: string;
  band?: RecessionBand;
  band_edges?: [number, number] | null;
  freq?: string;
  source?: string;
}

export interface OverviewTiles {
  regime?: RegimeRow;
  recession?: RecessionScore;
  trend?: {
    above_50: boolean;
    above_200: boolean;
    since: string;
    since_signal: string;
    since_verdict: Verdict;
    /** PROPOSED (§12.13): the session the trend is read at, dating the tile's badge. */
    date: string;
  };
  /** §12.1: the VIX level and its day; the gap to realized and the band word are unavailable (§1.0). */
  vol?: {
    vix: number | null;
    date: string;
    freq?: string;
    source?: string;
  };
}

export interface OverviewResponse extends Envelope {
  since_last_close?: SinceLastClose;
  tiles?: OverviewTiles;
  active_signals?: LedgerRow[];
  /** PROPOSED (§12.13): the sidebar TODAY card's data word ("current" | "stale" | "unknown"). */
  data_status: string;
}

// ── §12.10 /technicals ────────────────────────────────────────────────────

/** PROPOSED (§12.13): §12.10 leaves the series points as `[…]`. */
export interface PricePoint {
  date: string;
  close: number | null;
  ma50: number | null;
  ma200: number | null;
}

export interface TechnicalsResponse extends Envelope {
  /** PROPOSED (§12.13, Codex R-08): the one series every level here describes. */
  instrument?: { symbol: string; label: string };
  price: number | null;
  /** §12.7: the session the price and the averages are dated to. */
  date?: string;
  chg_1d: number | null;
  ma50: number | null;
  ma200: number | null;
  /** PROPOSED (§12.13): price against each average, as fractions (0.021 = 2.1% above). */
  vs_ma50: number | null;
  vs_ma200: number | null;
  ret_1y: number | null;
  trend: string;
  move_20d_sigma: number | null;
  /** PROPOSED (§12.13, Codex R-13): the engine's word for the last 20 days' move ("no extreme move"). */
  move_20d_word?: string;
  cross: {
    kind: "golden" | "death";
    date: string;
  } | null;
  series?: { "6m"?: PricePoint[]; "1y"?: PricePoint[]; "3y"?: PricePoint[] };
  /** §12.7: block envelopes, awaiting on Monday (the unwrapped data, once ready, is the deferred shape of §12.13). */
  vol?: VolResponse;
  sectors?: SectorsResponse;
}

// ── §12.2 /study ──────────────────────────────────────────────────────────

export type Move = "up2s" | "down2s" | "cross_above" | "cross_below";

/** The six slots (§4, §12.2): `while` is none | spx_below_50 | regime:<name>; `window` is 5 | 20 | 60, null for a cross. */
export interface Question {
  shock: string;
  window: number | null;
  move: Move;
  while: string;
  target: string;
  horizon: number;
}

/** The unit every target move is served in, native (§1.9, §12.2): a log
 * return or log change (0.031 displays as +3.1%, 100 × native, "log return,
 * ×100"), or basis points (25 is +25 bp). */
export type TargetUnit = "log_return" | "log_change" | "bp";

/** How a target move displays (§1.9): `percent` for the two log units, `bp` for bp. */
export type DisplayUnit = "percent" | "bp";

/** The question as a study serves it: the six slots, and its target's unit
 * and display unit (§12.2), and (Codex R-03) its name. Absent, every target
 * move says Awaiting refresh; the page never guesses a unit from the key. */
export interface ServedQuestion extends Question {
  target_unit?: TargetUnit;
  display_unit?: DisplayUnit;
  target_label?: string;
}

export interface StudyHorizon {
  h: number;
  label: string;
  up_pct: number | null;
  up_n?: number | null;
  /** The outcomes complete at this horizon (§12.2, C-03): the one denominator of `up_pct`, the median, the extrema and "12 of N". */
  n?: number | null;
  median: number | null;
  baseline_median: number | null;
  /** PROPOSED (§12.13): the share of ordinary stretches of this length that ended up (the Client view's "vs 62% in an ordinary month"). */
  baseline_up_pct?: number | null;
  /** The interval on Δ = median − baseline_median, native (§1.9); null under five blocks. */
  ci_lo: number | null;
  ci_hi: number | null;
  /** The resampling behind the interval (§12.2): overlap blocks, the share of resampled medians adverse, draws and method. */
  n_blocks?: number | null;
  adverse_share?: number | null;
  draws?: number | null;
  method?: "enumeration" | "monte_carlo" | null;
  /** Why a statistic here is null, in words (§12.2: "fewer than five independent blocks" for an interval under five blocks). */
  reason?: string | null;
  verdict?: Verdict;
  worst?: { ret: number | null; date: string } | null;
  best?: { ret: number | null; date: string } | null;
}

export interface StudyResponse extends Envelope {
  inputs_hash: string;
  served_from_cache: boolean;
  elapsed_ms: number | null;
  slug: string | null;
  question: ServedQuestion;
  /** The study's size: retained events in the evaluable sample, the same at every horizon (§12.2, C-03). */
  matched_n?: number | null;
  /** The horizon the verdict, headline, why, counts and empty state are for (§1.5, v4 B-01). */
  selected_horizon?: number | null;
  sample_start: string | null;
  /** §12.2 firing state, on `evaluated_on`; null when not evaluable. A stale study is never firing today (v3 §3). */
  firing_now: boolean | null;
  firing_day?: number | null;
  evaluated_on?: string | null;
  comparison_session?: string | null;
  stale?: boolean;
  last_event: string | null;
  /** The selected horizon's verdict (§1.5, B-01). Absent when not served or not known: the verdict box says Awaiting refresh. */
  verdict?: Verdict;
  /** The rule every verdict here follows, and its fixed level (§1.5): "v1" at 0.90. */
  verdict_rule?: string | null;
  verdict_confidence?: number | null;
  /** "<verdict label> at <horizon label>: " + the verdict's §1.5 definition (§12.2). */
  headline: string;
  why: string;
  horizons?: StudyHorizon[];
  /** At h = 20 (§12.2); `up_pct` and `median` null under ten events (MIN_REGIME_N). */
  by_regime?: { h?: number | null; regime: string; n: number | null; up_pct: number | null; median: number | null }[];
  /** Events before the first labelled month (§4 rail). */
  unlabeled_n?: number | null;
  last_events?: { date: string; regime: string; ret_20: number | null }[];
  /** §12.2: a block envelope, awaiting on Monday (C-01); its shape once defined is §12.13's. */
  without_condition?: unknown;
  provenance?: { bootstrap: number | null; entry: string; cooldown: number | null; series_start?: Record<string, string> };
  warnings?: string[];
  /** Served iff the selected horizon has fewer than ten completed outcomes (§1.7, §12.2). */
  empty_state?: { horizon?: number | null; sentence: string; fixes: string[] } | null;
  /** PROPOSED (§12.13): the 12 series every slot lists, key and label. */
  /** §12.2: every series the slots list, with the roles and moves the catalog allows it. */
  series?: { key: string; label: string; roles?: string[]; ops?: string[]; unit?: string }[];
  /** The Client view's question and paragraph, in plain words, at h = 20 (§12.2). */
  client?: { horizon?: number | null; headline: string; summary: string } | null;
}

/** §12.3 /study/catalog: the fifteen studies every slot and chip is drawn from. */
export interface CatalogStudy {
  slug: string;
  label: string;
  short: string;
  available: boolean;
  unavailable: Unavailable | null;
  /** The five non-horizon slots; null for a definition with no question yet (the RSI rows). */
  question: { shock: string; window: number | null; move: Move; while: string; target: string } | null;
  allowed_horizons: number[];
}

export interface StudyCatalogResponse extends Envelope {
  studies?: CatalogStudy[];
}

/** §12.3 /study/events (PROPOSED shape, §12.13); CSV with `Accept: text/csv`. */
export interface StudyEventsResponse extends Envelope {
  slug: string | null;
  events?: { date: string; regime: string; ret_5: number | null; ret_10: number | null; ret_20: number | null; ret_60: number | null }[];
}

// ── §12.5 /regime ─────────────────────────────────────────────────────────

export interface RegimeResponse extends Envelope {
  /** The K−2 row governing today, and the newest stored row beside it (`latest_print`, shown, never used to classify). */
  current?: Partial<RegimeRow> & { latest_print?: string };
  history?: { month: string; regime: string }[];
  recession?: RecessionScore & {
    feature_months?: Record<string, string>;
    year_ago?: { score: number | null; probability_month: string } | null;
    peak?: { score: number | null; probability_month: string; window?: string } | null;
    training?: { start: string; end: string } | null;
    methodology?: string;
  };
  stats?: { regime: string; months: number | null; spx_mo: number | null; up_pct: number | null; vix_avg: number | null; stock_bond_corr: number | null }[];
  next_prints?: {
    cpi?: { date: string; flip_threshold_mom: number | null; flips_to: string | null } | null;
    indpro?: { date: string; flip_threshold_mom: number | null; flips_to: string | null } | null;
  };
  changes?: { month: string; from: string; to: string; spx_1m: number | null }[];
  /** PROPOSED (§12.13): the cards' sentences (`stats`, `changes`). */
  reads?: { stats?: Read; changes?: Read };
}

// ── §12.6 /macro ──────────────────────────────────────────────────────────

export interface CurvePoint {
  "3m": number | null;
  "2y": number | null;
  "5y": number | null;
  "10y": number | null;
  "30y": number | null;
  /** §12.8: the date the tenors share, or null when they differ (then `dates` dates each). */
  date: string | null;
  dates?: Record<string, string>;
}

export interface MacroResponse extends Envelope {
  curve?: { today: CurvePoint; month_ago: CurvePoint; "2s10s_bp": number | null; "2s10s_chg_bp": number | null; "10y_chg_bp": number | null };
  stock_bond?: {
    today: number | null;
    year_ago: number | null;
    /** The month the sign last changed; null when it has not changed within the served year (§12.13). */
    flipped: string | null;
    /** PROPOSED (§12.13): the engine's call, whether bonds hedge stocks today (TODAY is amber when they do not). */
    hedging: boolean | null;
    /** PROPOSED (§12.13): the three stat notes. */
    words: { today?: string; year_ago?: string; flipped?: string };
    series: { date: string; corr: number | null }[];
  };
  credit?: {
    hy: number | null;
    hy_pct_3y: number | null;
    hy_range_3y: [number | null, number | null] | null;
    ig: number | null;
    series: { date: string; hy: number | null }[];
    peak_12m: { date: string; hy: number | null } | null;
    /** PROPOSED (§12.13): the 3-year percentile edges between Tight | Normal | Wide. */
    band_edges: [number, number] | null;
    /** PROPOSED (§12.13): the stat words ("tight", "also tight", "today near the low"). */
    words: { hy?: string; ig?: string; range?: string };
  };
  correlations?: { asset: string; corr: number | null; meaning: string }[];
  /** `labels` is PROPOSED (§12.13): the assets' names, in `assets` order. */
  matrix?: { assets: string[]; labels?: string[]; window: number | null; values: (number | null)[][] };
  /** PROPOSED (§12.13): the cards' sentences. */
  reads?: { curve?: Read; front_end?: Read; stock_bond?: Read; credit?: Read; correlations?: Read };
}

// ── §12.9 /vol ────────────────────────────────────────────────────────────

export interface VolResponse extends Envelope {
  source: string;
  skew_25d_1m_pts: number | null;
  skew_pct_2y: number | null;
  skew_trend: string;
  atm_iv_1m: number | null;
  realized_20d: number | null;
  term: { "1m": number | null; "3m": number | null; "6m": number | null } | null;
  history_from: string;
  /** PROPOSED (§12.13): the percentile edges between Cheap | Typical | Expensive. */
  skew_band_edges: [number, number] | null;
  /** PROPOSED (§12.13): the card's sentences. */
  reads?: { skew?: Read; iv_rv?: Read; term_meaning?: Read; term?: Read; gauge?: Read };
}

// ── §12.7 /sectors ────────────────────────────────────────────────────────

export interface SectorRow {
  etf: string;
  name: string;
  /** PROPOSED (§12.13): a four-letter name for the bars and dots ("Tech", "Stpl"). */
  short?: string;
  rel_ret: number | null;
}

export interface RelPoint {
  date: string;
  rel: number | null;
}

export interface SectorsResponse extends Envelope {
  window_months: number | null;
  leadership?: SectorRow[];
  pattern: string;
  breadth?: {
    above_50: { n: number | null; of: number | null; month_ago: number | null; by_etf?: Record<string, boolean> };
    /** `broad` is PROPOSED (§12.13): the engine's call that the 200-day trend is broad (the value is green). */
    above_200: { n: number | null; of: number | null; by_etf?: Record<string, boolean>; broad?: boolean };
    eqw_vs_cap_3m: number | null;
    eqw_vs_cap_series?: RelPoint[];
    /** PROPOSED (§12.13) point shape: §12.7 leaves it as `["… 252"]`. */
    small_vs_large_series?: RelPoint[];
  };
  /** PROPOSED (§12.13): the cards' sentences. */
  reads?: { leadership_brief?: Read; leadership?: Read; breadth?: Read };
  /** PROPOSED (§12.13): the stat notes the engine words ("growth sectors over defensives", "trend still broad", "big names carrying it"). */
  words?: { pattern?: string; above_200?: string; eqw?: string };
}

// ── §12.12 /basket/:id, POST /basket/price, /hedge (PROPOSED shapes, §12.13) ──

export interface BasketLeg {
  symbol: string;
  /** The listing's name; null when the API has none for the ticker. */
  name: string | null;
  /** Percent of the basket (22 is 22%). */
  weight: number;
}

/** What a price of a set of legs carries: the stats row, the residual chart and its reads. */
export interface BasketPriced {
  /** The session whose closes priced these numbers (§12.13, Codex R-04): the basket's date badge
   * reads it from whichever answer, GET /basket or POST /basket/price, supplied the numbers shown. */
  prices_as_of?: string;
  benchmark: { symbol: string; label: string };
  ret_3m: number | null;
  bench_ret_3m: number | null;
  /** Basket minus beta × benchmark over `residual_window` sessions. */
  residual: number | null;
  residual_window: number | null;
  /** The residual at which the position comes off. */
  falsifies_at: number | null;
  /** The residual 20 sessions ago. */
  month_ago: number | null;
  vol: number | null;
  bench_vol: number | null;
  vol_ratio: number | null;
  beta: number | null;
  series?: { date: string; value: number | null }[];
  reads?: { chart?: Read | null; beta?: Read | null };
}

export interface BasketResponse extends Envelope, BasketPriced {
  id: string;
  name: string;
  /** The basket in two or three words ("AI-infra"), for the chart's question. */
  short?: string;
  /** What Position Monitor's instrument field reads ("AI infrastructure basket vs 1.6 × NDX"). */
  instrument?: string;
  rebalance?: string;
  /** The baskets the server keeps, for the selector. */
  baskets: { id: string; name: string }[];
  legs: BasketLeg[];
}

export interface BasketPriceResponse extends Envelope, BasketPriced {
  /** The posted legs, with the names the API resolved. */
  legs: BasketLeg[];
}

export type HedgeMode = "protect" | "express" | "neutralize";

export interface HedgeScenario {
  /** The benchmark's move over the month. */
  ndx: number | null;
  basket: number | null;
  hedged: number | null;
}

export interface HedgeOption {
  id: string;
  label: string;
  underlying: string;
  cost_pct: number | null;
  /** The basket move at which basket + hedge payoff − cost = 0, per $100 of basket (§12.13, Codex R-06). */
  breakeven: number | null;
  /** The worst basket + hedge payoff − cost over `protected_range`, per $100 of basket (a fraction, negative for a loss). */
  max_loss: number | null;
  /** The NDX moves `max_loss` is the worst over: the bought put's strike down to the sold put's
   * (`basis: "strikes"`), else to the scenario table's lowest move (`"table_floor"`). */
  protected_range?: { ndx_from: number; ndx_to: number; basis?: "strikes" | "table_floor" } | null;
  note: string;
  /** Dollars of the underlying's notional per $100 of basket: beta × delta × 100. */
  hedge_per_100: number | null;
  delta: number | null;
  /** The structure, per $1 of notional: strikes as NDX moves from today, +1 bought, −1 sold. */
  legs?: { right: "put" | "call"; strike: number; qty: number }[];
  theta_pct_week: number | null;
  roll: { date: string; days: number | null; at_dte: number | null } | null;
  scenarios?: HedgeScenario[];
  scenario_note: string;
}

export interface HedgeResponse extends Envelope {
  mode: HedgeMode;
  subject: { kind: "basket" | "legs" | "position" | "study"; id: string | null; label: string };
  /** The option surface the prices come off ("SPY / QQQ"). */
  surface: string;
  surface_as_of: string;
  provider: string;
  beta: number | null;
  options?: HedgeOption[];
  recommended: string | null;
  reads?: { why_index?: Read | null; recommendation?: Read | null };
}
