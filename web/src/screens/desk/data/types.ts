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
 */

/** §1.5's three verdicts, and §12.2's "insufficient" for fewer than 10 events. */
export type Verdict = "reliable" | "suggestive" | "no_edge" | "insufficient";

/** Every response carries the engine date and the generation it was read from. */
export interface Envelope {
  as_of: string;
  generation_id: string;
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
  error: string;
  missing?: string[];
  words?: string[];
}

// ── §12.4 /ledger ─────────────────────────────────────────────────────────

export interface LedgerRow {
  slug: string;
  label: string;
  group: "spx" | "cross";
  last_fired: string;
  n: number;
  up_pct: number;
  median: number;
  vs_normal_pts: number;
  verdict: Verdict;
  firing_now: boolean;
  firing_day?: number;
  /** PROPOSED (§12.13): first session of the signal's sample, for "since 1990" / "since 2000". */
  sample_start: string;
  /** PROPOSED (§12.13): a short name for lists ("golden cross", "RSI < 30"). */
  short?: string;
}

export interface LedgerResponse extends Envelope {
  normal_month: number;
  signals: LedgerRow[];
}

// ── §12.8 /positions ──────────────────────────────────────────────────────

export interface ToLevel {
  value: number;
  unit: string;
}

export interface PositionCompact {
  id: string;
  name: string;
  instrument: string;
  direction: "long" | "short";
  /** Null when not served (a position saved without a size); the row prints "—". */
  size_nav: number | null;
  room_pct: number | null;
  to_level: ToLevel | null;
  opened: string;
  horizon_days: number;
  day: number;
}

/** §12.8's expanded row: the compact row plus the gate text and the level. */
export interface PositionExpanded extends PositionCompact {
  /** PROPOSED (§12.13) shape: the level that falsifies the idea, in words and number. */
  falsifies_at: { label: string; value: number | null; unit: string | null } | null;
  /** PROPOSED (§12.13) shape: the level's series today, dated at its own frequency. */
  now: { value: number; unit: string; date: string } | null;
  dv01: number | null;
  variant: string;
  pre_mortem: string;
  red_team: string;
  study_slug: string | null;
}

/** GET /positions (PROPOSED shape, §12.13). */
export interface PositionsResponse extends Envelope {
  positions: PositionExpanded[];
  closed_90d: { falsified: number; expired: number; premortem_right: [number, number] };
}

// ── §12.1 /overview ───────────────────────────────────────────────────────

export interface SinceLastClose {
  new_fires: { slug: string; label: string }[];
  still_firing: { slug: string; label: string; day: number }[];
  vol_change_pts: number;
  skew_direction: string;
  regime_changed: boolean;
  regime_from: string | null;
  regime_to: string | null;
  refreshed_at_utc: string;
}

export interface OverviewTiles {
  regime: { label: string; print: string; growth: string; inflation: string; months_in: number };
  recession: { prob: number; band: string; inputs_through: string };
  trend: {
    above_50: boolean;
    above_200: boolean;
    since: string;
    since_signal: string;
    since_verdict: Verdict;
    /** PROPOSED (§12.13): the session the trend is read at, dating the tile's badge. */
    date: string;
  };
  vol: {
    vix: number;
    date: string;
    realized_20d: number;
    gap_pts: number;
    /** PROPOSED (§12.13): the word for the VIX level ("calm"), set by the server. */
    band: string;
  };
}

export interface OverviewResponse extends Envelope {
  since_last_close: SinceLastClose;
  tiles: OverviewTiles;
  active_signals: LedgerRow[];
  monitored: PositionCompact[];
  /** PROPOSED (§12.13): the sidebar TODAY card's data word ("current" | "stale" | "unknown"). */
  data_status: string;
}

// ── §12.10 /technicals ────────────────────────────────────────────────────

/** PROPOSED (§12.13): §12.10 leaves the series points as `[…]`. */
export interface PricePoint {
  date: string;
  close: number;
  ma50: number;
  ma200: number;
}

export interface TechnicalsResponse extends Envelope {
  price: number;
  chg_1d: number;
  ma50: number;
  ma200: number;
  /** PROPOSED (§12.13): price against each average, as fractions (0.021 = 2.1% above). */
  vs_ma50: number;
  vs_ma200: number;
  ret_1y: number;
  trend: string;
  move_20d_sigma: number;
  rsi: number;
  /** PROPOSED (§12.13): "rising" | "falling" | "flat". */
  rsi_direction: string;
  rsi_last_above_70: { date: string; spx_1m: number };
  rsi_last_below_30: { date: string; spx_1m: number };
  cross: {
    kind: "golden" | "death";
    date: string;
    /** PROPOSED (§12.13): how often this cross fired in today's regime. */
    in_regime?: { regime: string; n: number };
  };
  series: { "6m": PricePoint[]; "1y": PricePoint[]; "3y": PricePoint[] };
}

// ── §12.2 /study ──────────────────────────────────────────────────────────

export type Move = "up2s" | "down2s" | "cross_above" | "cross_below";

/** The six slots (§4, §12.2): `while` is none | spx_below_50 | spx_above_50 | regime:<name>. */
export interface Question {
  shock: string;
  window: number;
  move: Move;
  while: string;
  target: string;
  horizon: number;
}

export interface StudyHorizon {
  h: number;
  label: string;
  up_pct: number;
  up_n?: number;
  median: number;
  baseline_median: number;
  ci_lo_pts: number;
  ci_hi_pts: number;
  verdict: Verdict;
  worst?: { ret: number; date: string };
  best?: { ret: number; date: string };
}

export interface StudyResponse extends Envelope {
  inputs_hash: string;
  served_from_cache: boolean;
  elapsed_ms: number;
  slug: string | null;
  question: Question;
  n_events: number;
  sample_start: string;
  firing_now: boolean;
  last_event: string | null;
  verdict: Verdict;
  headline: string;
  why: string;
  /** PROPOSED (§12.13): the verdict box's bold line ("Lean, don't size."). */
  verdict_line: string;
  /** PROPOSED (§12.13): the verdict box's "what to do" sentence. */
  what_to_do: string;
  horizons: StudyHorizon[];
  confidence: number;
  confidence_note: string;
  by_regime: { regime: string; n: number; up_pct: number | null; median: number | null }[];
  last_events: { date: string; regime: string; ret_20: number }[];
  without_condition: { n_events: number; up_pct: number; median: number; verdict: Verdict } | null;
  provenance: { bootstrap: number; entry: string; cooldown: number; series_start: Record<string, string> };
  warnings: string[];
  empty_state?: { sentence: string; fixes: string[] };
  /** PROPOSED (§12.13): the 12 series every slot lists, key and label. */
  series: { key: string; label: string }[];
}

/** §12.3 /study/events (PROPOSED shape, §12.13); CSV with `Accept: text/csv`. */
export interface StudyEventsResponse extends Envelope {
  slug: string | null;
  events: { date: string; regime: string; ret_5: number | null; ret_10: number | null; ret_20: number | null; ret_60: number | null }[];
}

// ── §12.5 /regime ─────────────────────────────────────────────────────────

export interface RegimeResponse extends Envelope {
  current: { label: string; print: string; growth: string; inflation: string; months_in: number; since: string };
  history: { month: string; regime: string }[];
  recession: {
    prob: number;
    inputs_through: string;
    year_ago: number;
    peak: { prob: number; month: string };
    /** PROPOSED (§12.13): the band word ("low"), as the Overview tile's `band`. */
    band: string;
    /** PROPOSED (§12.13): the probability edges between Low | Watch | Elevated. */
    band_edges: [number, number];
  };
  stats: { regime: string; months: number; spx_mo: number; up_pct: number; vix_avg: number; stock_bond_corr: number }[];
  next_prints: {
    cpi: { date: string; flip_threshold_mom: number; flips_to: string };
    indpro: { date: string; flip_threshold_mom: number; flips_to: string };
  };
  changes: { month: string; from: string; to: string; spx_1m: number }[];
  /** PROPOSED (§12.13): the cards' sentences (`stats`, `changes`, `year_ago`). */
  reads: { stats?: Read; changes?: Read; year_ago?: Read };
}

// ── §12.6 /macro ──────────────────────────────────────────────────────────

export interface CurvePoint {
  "3m": number | null;
  "2y": number | null;
  "5y": number | null;
  "10y": number | null;
  "30y": number | null;
  date: string;
}

export interface MacroResponse extends Envelope {
  curve: { today: CurvePoint; month_ago: CurvePoint; "2s10s_bp": number | null; "2s10s_chg_bp": number | null; "10y_chg_bp": number | null };
  stock_bond: {
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
  credit: {
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
  correlations: { asset: string; corr: number | null; meaning: string }[];
  /** `labels` is PROPOSED (§12.13): the assets' names, in `assets` order. */
  matrix: { assets: string[]; labels?: string[]; window: number; values: (number | null)[][] };
  /** PROPOSED (§12.13): the cards' sentences. */
  reads: { curve?: Read; front_end?: Read; stock_bond?: Read; credit?: Read; correlations?: Read };
}

// ── §12.9 /vol ────────────────────────────────────────────────────────────

export interface VolResponse extends Envelope {
  source: string;
  skew_25d_1m_pts: number;
  skew_pct_2y: number;
  skew_trend: string;
  atm_iv_1m: number;
  realized_20d: number;
  term: { "1m": number; "3m": number; "6m": number };
  history_from: string;
  /** PROPOSED (§12.13): the percentile edges between Cheap | Typical | Expensive. */
  skew_band_edges: [number, number];
  /** PROPOSED (§12.13): the card's sentences. */
  reads: { skew: Read; iv_rv: Read; term_meaning: Read; term: Read; gauge: Read };
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
  window_months: number;
  leadership: SectorRow[];
  pattern: string;
  breadth: {
    above_50: { n: number | null; of: number | null; month_ago: number | null; by_etf?: Record<string, boolean> };
    /** `broad` is PROPOSED (§12.13): the engine's call that the 200-day trend is broad (the value is green). */
    above_200: { n: number | null; of: number | null; by_etf?: Record<string, boolean>; broad?: boolean };
    eqw_vs_cap_3m: number | null;
    eqw_vs_cap_series: RelPoint[];
    /** PROPOSED (§12.13) point shape: §12.7 leaves it as `["… 252"]`. */
    small_vs_large_series: RelPoint[];
  };
  /** PROPOSED (§12.13): the cards' sentences. */
  reads: { leadership_brief: Read; leadership: Read; breadth: Read };
  /** PROPOSED (§12.13): the stat notes the engine words ("growth sectors over defensives", "trend still broad", "big names carrying it"). */
  words?: { pattern?: string; above_200?: string; eqw?: string };
}
