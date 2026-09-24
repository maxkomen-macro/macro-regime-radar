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
  size_nav: number;
  room_pct: number;
  to_level: ToLevel;
  opened: string;
  horizon_days: number;
  day: number;
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
  ret_1y: number;
  trend: string;
  move_20d_sigma: number;
  rsi: number;
  rsi_last_above_70: { date: string; spx_1m: number };
  rsi_last_below_30: { date: string; spx_1m: number };
  cross: { kind: "golden" | "death"; date: string };
  series: { "6m": PricePoint[]; "1y": PricePoint[]; "3y": PricePoint[] };
}
