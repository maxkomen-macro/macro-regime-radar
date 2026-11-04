/**
 * Desk P1b (docs/desk/CORRELATION_VIEWS.md): the correlation windows (20, 60
 * and 120 daily returns) and the correlation by regime that `/macro` serves in
 * its `stock_bond`, `correlations` and `matrix` blocks. These helpers only pick
 * and word served values: a horizon's numbers are the API's, and a page never
 * computes one. The 60-return fields the blocks served before P1b stay the
 * blocks' own and are what the page reads at 60 (`by_horizon["60"]` repeats
 * them, pinned by the API's tests); the views are read only at 20 and 120.
 */

import type { CorrelationRow, MacroResponse, MatrixBlock } from "../data/types";
import { num } from "../kit/format";

export type Span = { start: string; end: string; n: number };

/** One horizon of the stock–bond block (the block's own fields at that horizon). */
export interface StockBondHorizon {
  horizon: number;
  noise_band: number | null;
  today: number | null;
  today_date: string | null;
  today_reason: string | null;
  year_ago: number | null;
  year_ago_date: string | null;
  flipped: string | null;
  flipped_on: string | null;
  flipped_to: "positive" | "negative" | null;
  series: { date: string; corr: number | null }[];
  window: Span;
  line_window: Span;
}

/** One horizon of one "What moves with the S&P" row. */
export interface PairHorizon {
  horizon: number;
  noise_band: number | null;
  corr: number | null;
  window: Span | null;
  reason: string | null;
}

/** One regime of a row's correlation by regime (§4). */
export interface RegimeStat {
  regime: string;
  corr: number | null;
  n: number | null;
  first: string | null;
  last: string | null;
  reason: string | null;
  spells: number | null;
  largest_spell_share: number | null;
}

/** §4: a row's correlation with SPY pooled within each regime of the revised history. */
export interface ByRegime {
  regime_history: string;
  rule: string;
  lag_months: number | null;
  as_known: null;
  as_known_reason: string | null;
  min_n: number | null;
  current: string | null;
  /** The month of the row `current` comes from (YYYY-MM), two months before the end session's. */
  current_row?: string | null;
  sample: { start: string; end: string } | null;
  unlabeled_n: number | null;
  incomplete_n: number | null;
  regimes: RegimeStat[];
  all: Omit<RegimeStat, "regime" | "spells" | "largest_spell_share"> | null;
  reason: string | null;
}

/** One horizon of the matrix. */
export type MatrixHorizon = Pick<MatrixBlock, "values" | "no_data" | "window" | "coverage" | "lead"> & { horizon: number; noise_band: number | null };

export type StockBondWithViews = NonNullable<MacroResponse["stock_bond"]> & { horizons?: number[]; by_horizon?: Record<string, StockBondHorizon> };
export type RowWithViews = CorrelationRow & { by_horizon?: Record<string, PairHorizon> | null; by_regime?: ByRegime | null };
export type MatrixWithViews = MatrixBlock & { horizons?: number[]; by_horizon?: Record<string, MatrixHorizon> };

export const DEFAULT_HORIZON = 60;
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/**
 * The horizons every correlation block serves, in order. Only these are offered
 * (a control for a horizon a block cannot show would be a dead control); none
 * served, or only the default, means no control at all.
 */
export function servedHorizons(m: MacroResponse | undefined): number[] {
  if (!m) return [];
  const lists: number[][] = [];
  const sb = m.stock_bond as StockBondWithViews | undefined;
  if (sb && Array.isArray(sb.horizons) && sb.by_horizon) lists.push(sb.horizons.filter((w) => !!sb.by_horizon?.[String(w)]));
  const mx = m.matrix as MatrixWithViews | undefined;
  if (mx && Array.isArray(mx.horizons) && mx.by_horizon) lists.push(mx.horizons.filter((w) => !!mx.by_horizon?.[String(w)]));
  const rows = (Array.isArray(m.correlations) ? m.correlations : []) as RowWithViews[];
  const withViews = rows.filter((r) => r.by_horizon);
  if (withViews.length) {
    const keys = Object.keys(withViews[0].by_horizon ?? {}).map(Number).filter(fin);
    lists.push(keys.filter((w) => withViews.every((r) => !!r.by_horizon?.[String(w)])).sort((a, b) => a - b));
  }
  if (!lists.length) return [];
  const common = lists[0].filter((w) => fin(w) && lists.every((l) => l.includes(w)));
  return common.length > 1 && common.includes(DEFAULT_HORIZON) ? common : [];
}

/** The stock–bond block at horizon w: the served horizon's fields over the block's own; at 60, or without views, the block as served. */
export function stockBondAt(sb: StockBondWithViews, w: number): StockBondWithViews {
  const h = w === DEFAULT_HORIZON ? undefined : sb.by_horizon?.[String(w)];
  return h ? { ...sb, ...h } : sb;
}

/** One "What moves with the S&P" row at horizon w; the row as served without its views. */
export function rowAt(r: RowWithViews, w: number): RowWithViews {
  const h = w === DEFAULT_HORIZON ? undefined : r.by_horizon?.[String(w)];
  return h ? { ...r, corr: h.corr, window: h.window, reason: h.reason } : r;
}

/** The matrix at horizon w (its grid, no-data list, window, coverage and lead), the block as served without it. */
export function matrixAt(mx: MatrixWithViews, w: number): MatrixWithViews {
  const h = w === DEFAULT_HORIZON ? undefined : mx.by_horizon?.[String(w)];
  return h ? { ...mx, values: h.values, no_data: h.no_data, window: h.window, coverage: h.coverage, lead: h.lead, horizon: h.horizon } : mx;
}

/** The served noise reference of horizon w (§3, an approximation under independent normal returns), or null. */
export function noiseBandOf(m: MacroResponse | undefined, w: number): number | null {
  const sb = m?.stock_bond as StockBondWithViews | undefined;
  const mx = m?.matrix as MatrixWithViews | undefined;
  const v = sb?.by_horizon?.[String(w)]?.noise_band ?? mx?.by_horizon?.[String(w)]?.noise_band;
  return fin(v) ? v : null;
}

/** §3, in words: "With 20 daily returns, a true correlation of zero reads beyond about ±0.38 one time in ten …". */
export function noiseSentence(w: number, band: number | null): string {
  if (!fin(band)) return "";
  return `With ${w} daily returns, a true correlation of zero reads beyond about ±${num(band, 2)} one time in ten if returns were independent and normal; real returns can be more or less noisy than that.`;
}

/** "about a month" / "about a quarter" / "about six months" of sessions. */
export function horizonWords(w: number): string {
  return w === 20 ? "about a month" : w === 60 ? "about a quarter" : w === 120 ? "about six months" : `${w} sessions`;
}

/** A regime cell's note: "n 540 · 17 spells" (largest spell share when it holds a third or more). */
export function regimeNote(g: RegimeStat): string {
  const parts: string[] = [];
  if (fin(g.n)) parts.push(`n ${g.n.toLocaleString("en-US")}`);
  if (fin(g.spells) && g.spells > 0) parts.push(`${g.spells} ${g.spells === 1 ? "spell" : "spells"}`);
  if (fin(g.largest_spell_share) && g.largest_spell_share >= 1 / 3) parts.push(`${Math.round(g.largest_spell_share * 100)}% in one`);
  return parts.join(" · ");
}

/** "Revised regime history" for the served history, never assumed. */
export function historyLabel(h: string | null | undefined): string {
  return h === "revised" ? "Revised regime history" : h ? `Regime history: ${h}` : "";
}

/** The rows that carry a correlation by regime, and the regimes they name (in the served order). */
export function regimeTable(rows: readonly RowWithViews[]): { rows: (RowWithViews & { by_regime: ByRegime })[]; regimes: string[]; current: string | null; currentRow: string | null } {
  const served = rows.filter((r): r is RowWithViews & { by_regime: ByRegime } => !!r.by_regime && Array.isArray(r.by_regime.regimes));
  const regimes = served.find((r) => r.by_regime.regimes.length)?.by_regime.regimes.map((g) => g.regime) ?? [];
  const currents = new Set(served.map((r) => r.by_regime.current).filter((c): c is string => typeof c === "string"));
  // One current regime only when every row agrees (they end on their own sessions, normally the same month).
  const current = currents.size === 1 ? [...currents][0] : null;
  const rowsOf = new Set(served.map((r) => r.by_regime.current_row).filter((c): c is string => typeof c === "string" && /^\d{4}-\d{2}$/.test(c)));
  const currentRow = current && rowsOf.size === 1 ? [...rowsOf][0] : null;
  return { rows: served, regimes, current, currentRow };
}
