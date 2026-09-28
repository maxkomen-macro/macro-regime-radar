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

/** §12.0 (v2 §15): an interpretive sentence the server writes for a card.
 * `label` is the boxed read's lead ("Read", "Read for the desk") or null for
 * an inline sentence; `tone: "warning"` draws the amber-bordered box (§1.4);
 * `rule` names the contract rule that produced it, and a read without one is
 * not served. No rule exists on Monday, so no read is served. */
export interface Read {
  label: string | null;
  text: string;
  tone: "normal" | "warning";
  rule: string;
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
  /** Absent when not served, null when not evaluable (§12.5): either way the row claims neither firing nor quiet. */
  firing_now?: boolean | null;
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

/** §12.9: one series, from the registry and its consumers. */
export interface PipelineSeries {
  label: string;
  id: string;
  /** The Desk registry key; null for a series the Desk does not read. */
  key: string | null;
  provider: string;
  freq: "daily" | "weekly" | "monthly";
  /** The first and last stored observation; null when nothing is stored. */
  first: string | null;
  last: string | null;
  feeds: string[];
  status: FreshState;
  note: string | null;
}

export interface PipelineGroup {
  name: string;
  /** The worst of its series. */
  status: FreshState;
  series: PipelineSeries[];
}

export interface PipelineResponse extends Envelope {
  last_refresh_utc: string | null;
  validation: "pass" | "fail" | null;
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
  /** §12.1: the S&P against its 50- and 200-day averages; `unavailable` when either average is null. */
  trend?: {
    state: TrendState;
    above_50: boolean | null;
    above_200: boolean | null;
    state_since: string | null;
    cross: { kind: "golden" | "death"; date: string } | null;
    /** The session the state is read at, dating the tile's badge. */
    date: string;
    freq?: string;
    source?: string;
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
  /** §12.1 (v4 B-06): the worst contributor's state, and each Desk series through its freshness policy. */
  data_status?: DataStatus;
}

export type TrendState = "above_both" | "below_both" | "mixed" | "unavailable";
export type FreshState = "current" | "stale" | "missing";

export interface DataContributor {
  series: string;
  observation_date: string | null;
  expected_observation_date: string | null;
  state: FreshState;
  reason: string;
}

export interface DataStatus {
  state: FreshState;
  contributors: DataContributor[];
}

// ── §12.7 /technicals ─────────────────────────────────────────────────────

/** §12.7: a chart point; the averages are nullable per point. */
export interface PricePoint {
  date: string;
  close: number | null;
  ma50: number | null;
  ma200: number | null;
}

export interface Window {
  start: string;
  end: string;
  n: number;
}

/** §12.7: every field describes the registry series `spx` (^GSPC). */
export interface TechnicalsResponse extends Envelope {
  price: number | null;
  /** The session the price and the averages are dated to. */
  date?: string;
  freq?: string;
  source?: string;
  chg_1d: number | null;
  chg_1d_dates?: { from: string; to: string };
  ret_1y: number | null;
  ret_1y_dates?: { from: string; to: string };
  ma50: number | null;
  ma200: number | null;
  ma50_window?: Window;
  ma200_window?: Window;
  /** Price against each average, as fractions (0.021 = 2.1% above). */
  vs_ma50: number | null;
  vs_ma200: number | null;
  trend?: { state: TrendState; state_since: string | null };
  /** The spx-20d-2sigma study's z on its `evaluated_on`. */
  move_20d_sigma: number | null;
  move_20d_date?: string | null;
  cross: {
    kind: "golden" | "death";
    date: string;
  } | null;
  /** The Ledger rows the Technicals signals list reads, in this order (v2 §13). */
  signals_allowlist?: string[];
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
 * and display unit (§12.2). Absent, every target move says Awaiting refresh;
 * the page never guesses a unit from the key. The target's name is its
 * `series[]` label (`targetLabel`). */
export interface ServedQuestion extends Question {
  target_unit?: TargetUnit;
  display_unit?: DisplayUnit;
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
  /** The engine's note in §12.2's words (S-07), e.g. "fewer than five independent blocks"; null with none. */
  reason?: string | null;
  verdict?: Verdict;
  /** Events at this horizon whose window is not complete yet, and the baseline's observations (§12.2). */
  n_incomplete?: number | null;
  baseline_n?: number | null;
  /** Min and max over the `n` completed outcomes, with their event and entry sessions (§12.2). */
  worst?: Extreme | null;
  best?: Extreme | null;
}

export interface Extreme {
  value: number | null;
  event_date: string;
  entry_date: string | null;
}

export interface StudyResponse extends Envelope {
  inputs_hash: string;
  served_from_cache: boolean;
  elapsed_ms: number | null;
  slug: string | null;
  /** The catalog's label and short name (§12.3). */
  label?: string;
  short?: string;
  question: ServedQuestion;
  /** The study's size: retained events in the evaluable sample, the same at every horizon (§12.2, C-03). */
  matched_n?: number | null;
  /** The horizon the verdict, headline, why, counts and empty state are for (§1.5, v4 B-01). */
  selected_horizon?: number | null;
  /** The latest input's first observation, and the evaluable sample (§12.2). */
  data_start?: string | null;
  sample_start: string | null;
  sample_end?: string | null;
  first_event?: string | null;
  /** §12.2 firing state, on `evaluated_on`; null when not evaluable. A stale study is never firing today (v3 §3). */
  firing_now: boolean | null;
  firing_day?: number | null;
  evaluated_on?: string | null;
  comparison_session?: string | null;
  /** §12.2 (S-10): the XNYS session before `comparison_session`, as §12.1. */
  prev_session?: string | null;
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
  /** Events whose K−2 month has no stored regimes row (§4 rail); they are counted here and never listed (S-06). */
  unlabeled_n?: number | null;
  /** §12.2 (S-05, S-06): `entry_date` null when the entry session is after the stored data; `regime` absent only when it could not be read. */
  last_events?: { event_date: string; entry_date: string | null; regime?: RegimeLabel; value_20: number | null }[];
  /** §12.2: a block envelope, awaiting on Monday (C-01); its shape once defined is §12.13's. */
  without_condition?: unknown;
  provenance?: { entry_rule: string; cooldown: number | null; seed?: number | null; engine_version?: string; series_start?: Record<string, string> };
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
  /** §12.3 (item 14): the Client view's title in plain words, no σ and no engine terms; null for the RSI rows. */
  client_label?: string | null;
  available: boolean;
  unavailable: Unavailable | null;
  /** The five non-horizon slots; null for a definition with no question yet (the RSI rows). */
  question: { shock: string; window: number | null; move: Move; while: string; target: string } | null;
  allowed_horizons: number[];
}

export interface StudyCatalogResponse extends Envelope {
  studies?: CatalogStudy[];
}

/** A regime label; a listed event always carries one (§12.2, §12.4, S-06). */
export type RegimeLabel = "Goldilocks" | "Overheating" | "Stagflation" | "Recession Risk";

/** §12.4 /study/events: every retained event, newest first; CSV with `Accept: text/csv`. */
export interface StudyEvent {
  event_date: string;
  /** Null when the entry session is after the stored data (S-05). */
  entry_date: string | null;
  regime?: RegimeLabel;
  exit_5?: string | null;
  value_5?: number | null;
  complete_5?: boolean;
  exit_10?: string | null;
  value_10?: number | null;
  complete_10?: boolean;
  exit_20?: string | null;
  value_20?: number | null;
  complete_20?: boolean;
  exit_60?: string | null;
  value_60?: number | null;
  complete_60?: boolean;
}

export interface StudyEventsResponse extends Envelope {
  slug: string | null;
  events?: StudyEvent[];
}

// ── §12.5 /regime ─────────────────────────────────────────────────────────

/** §12.6: the next print of one series and the move that would flip its axis. */
export interface NextPrint {
  release_date: string | null;
  reference_month: string;
  series: string;
  threshold_mom: number | null;
  operator: "<=" | ">";
  flips_to: string | null;
  first_effective_month: string;
  freq?: string;
  source?: string;
}

export interface RegimeResponse extends Envelope {
  /** The K−2 row governing today, and the newest stored row beside it (`latest_print`, shown, never used to classify). */
  current?: Partial<RegimeRow> & { latest_print?: string };
  /** The last 60 stored rows, with how they are to be read (§12.6). */
  history?: { month: string; regime: string }[];
  history_note?: string;
  history_freq?: string;
  history_source?: string;
  recession?: RecessionScore & {
    feature_months?: Record<string, string>;
    year_ago?: { score: number | null; probability_month: string } | null;
    peak?: { score: number | null; probability_month: string; window?: string } | null;
    training?: { start: string; end: string } | null;
    methodology?: string;
  };
  stats?: { regime: string; months: number | null; spx_mo: number | null; up_pct: number | null; vix_avg: number | null; stock_bond_corr: number | null }[];
  next_prints?: { cpi?: NextPrint | null; indpro?: NextPrint | null };
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
  /** §12.8 (S-24): the latest date on which every stored tenor has a value, or null when none (then each tenor is its own newest). */
  date: string | null;
  /** Each tenor's date; null for a tenor not stored. */
  dates?: Record<string, string | null>;
}

/** §12.8: a served value with its own date. */
export interface DatedValue {
  value: number | null;
  date: string;
  freq?: string;
  source?: string;
}

export interface CorrelationRow {
  asset: string;
  symbol?: string;
  quantity?: string;
  transform?: string;
  corr: number | null;
  /** The newest session both series hold a value: the window's end. */
  date?: string | null;
  window?: Window | null;
  /** Why `corr` is null, else null. */
  reason?: string | null;
}

export interface MacroResponse extends Envelope {
  curve?: { today: CurvePoint; month_ago: CurvePoint; "2s10s_bp": number | null; "2s10s_chg_bp": number | null; "10y_chg_bp": number | null; freq?: string; source?: string };
  /** §12.8 (desk/fill-etf): SPY's daily log returns against TLT's, 60 return dates, every pair complete. */
  stock_bond?: {
    today: number | null;
    today_date?: string | null;
    /** Why `today` is null ("fewer than 60 complete daily return pairs …"). */
    today_reason?: string | null;
    year_ago: number | null;
    year_ago_date?: string | null;
    /** The month of the newest change of sign; null when the served history has none. */
    flipped: string | null;
    flipped_on?: string | null;
    flipped_to?: "positive" | "negative" | null;
    series: { date: string; corr: number | null }[];
    window?: Window;
    line_window?: Window;
    stock?: { etf: string; name: string };
    bond?: { etf: string; name: string };
    transform?: string;
    date?: string;
    providers?: string[];
  };
  /** §12.8: HY and IG as dated observations; the three-year figures over `rank_window`, null with a `reason` when coverage is short. */
  credit?: {
    hy: DatedValue | null;
    ig: DatedValue | null;
    hy_pct_3y: number | null;
    hy_range_3y: [number | null, number | null] | null;
    rank_window?: { start: string; end: string; n: number; expected_n: number | null; valid_n: number | null; missing_n: number | null; first_obs: string | null; last_obs: string | null };
    reason?: string | null;
    band?: "tight" | "normal" | "wide" | null;
    band_edges: [number, number] | null;
    series: { date: string; hy: number | null }[];
    line_window?: Window;
    peak_12m: { date: string; hy: number | null } | null;
  };
  /** §12.8 (desk/fill-etf): each asset against SPY over 60 daily returns to its own `date`, declaring its symbol, quantity and transform. */
  correlations?: CorrelationRow[];
  /** `labels` is PROPOSED (§12.13): the assets' names, in `assets` order. */
  matrix?: { assets: string[]; labels?: string[]; window: number | null; values: (number | null)[][] };
  /** §12.0: the cards' served reads (none on Monday). */
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
  /** §12.13: "with each value's date", keyed by the value's field. */
  dates?: Record<string, string>;
}

// ── §12.14 /sectors (desk/fill-etf) ───────────────────────────────────────

export interface SectorRow {
  etf: string;
  name: string;
  /** A four-letter name for the bars and dots ("Tech", "Stpl"). */
  short?: string;
  /** The pattern rule's group; null for XLC and XLRE, which it leaves out. */
  group?: "cyclical" | "defensive" | null;
  /** 60-session log return less SPY's (a log fraction; §1.9 prints it ×100 as a log-return percentage). */
  rel_ret: number | null;
  /** The ETF's own 60-session log return. */
  ret?: number | null;
  /** Its first stored close. */
  first?: string | null;
  /** Why `rel_ret` is null ("no close on …: its history starts …"), else null. */
  reason?: string | null;
}

/** One average's breadth: how many of the sector ETFs close above it, of how many it can be read for (§12.14). */
export interface AboveAverage {
  n: number | null;
  of: number | null;
  compared_on: string | null;
  /** The session slots the average reads. */
  window?: Window;
  /** Each sector ETF the average can be read for: above (true) or not (false). */
  by_etf?: Record<string, boolean>;
  /** The ones it cannot be read for, with why ("no close on …: its history starts …"). */
  not_available?: { etf: string; reason: string }[];
}

export interface SectorBreadth {
  compared_on?: string;
  /** How many sector ETFs breadth is measured over (11). */
  of_total?: number;
  above_50: AboveAverage;
  above_200: AboveAverage;
  /** RSP's 60-session log return less SPY's; null with `eqw_vs_cap_reason`. */
  eqw_vs_cap_3m: number | null;
  eqw_vs_cap_reason?: string | null;
  eqw_vs_cap_series?: RelPoint[];
  eqw_vs_cap_line_window?: Window | null;
  /** IWM's 60-session log return less SPY's. */
  small_vs_large_3m?: number | null;
  small_vs_large_reason?: string | null;
  small_vs_large_series?: RelPoint[];
  small_vs_large_line_window?: Window | null;
  relative_window?: Window;
  date?: string;
  providers?: string[];
}

/** `sector-pattern-v1` (§12.14): the cyclical group's mean `rel_ret` less the defensive group's, and its word by a ±`band` rule. */
export interface SectorPattern {
  rule: string;
  band: number;
  cyclicals: string[];
  defensives: string[];
  word: "cyclical" | "defensive" | "mixed" | null;
  spread: number | null;
  reason: string | null;
}

export interface RelPoint {
  date: string;
  rel: number | null;
}

export interface SectorsResponse extends Envelope {
  window_months: number | null;
  /** The 60 XNYS sessions the returns span. */
  window?: Window;
  compared_on?: string;
  unit?: string;
  band?: number;
  benchmark?: { etf: string; name: string; ret: number | null };
  leadership?: SectorRow[];
  pattern?: SectorPattern;
  date?: string;
  freq?: string;
  source?: string;
  /** The providers of the rows read, in words ("Yahoo", "EODHD"). */
  providers?: string[];
  /** §12.14's breadth block (desk/fill-etf): of the eleven sector ETFs, never stocks. */
  breadth?: SectorBreadth;
}

// Basket & Hedge (§10) is unavailable: no page reads `/basket/:id`, `/basket/price` or `/hedge`,
// deferred stubs whose shapes, when built, are §12.13's.
