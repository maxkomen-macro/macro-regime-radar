/**
 * Desk P1b (docs/desk/CORRELATION_VIEWS.md): the correlation windows (20, 60
 * and 120 daily returns) and the correlation by regime that `/macro` serves in
 * its `stock_bond`, `correlations` and `matrix` blocks. These helpers only pick
 * and word served values: a horizon's numbers are the API's, and a page never
 * computes one. The 60-return fields the blocks served before P1b stay the
 * blocks' own and are what the page reads at 60 (`by_horizon["60"]` repeats
 * them, pinned by the API's tests); the views are read only at 20 and 120.
 */

import type { ByRegime, MacroResponse, MatrixBlock, MatrixHorizon, PairHorizon, RegimeCorrStat, StockBondHorizon } from "../data/types";

export type { ByRegime, MatrixHorizon, PairHorizon, RegimeCorrStat, StockBondHorizon };
import { num } from "../kit/format";

export type StockBondWithViews = NonNullable<MacroResponse["stock_bond"]>;
export type RowWithViews = NonNullable<MacroResponse["correlations"]>[number];
export type MatrixWithViews = MatrixBlock;

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
export function regimeNote(g: RegimeCorrStat): string {
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
  // One column only when every row with a sample takes the same label from the same regime row
  // (Codex S-1): an Unlabeled end or another governing month means the rows do not agree.
  const sampled = served.filter((r) => !r.by_regime.reason);
  const ok = (b: ByRegime) => typeof b.current === "string" && typeof b.current_row === "string" && /^\d{4}-\d{2}$/.test(b.current_row);
  const first = sampled[0]?.by_regime;
  const agree = !!first && sampled.every((r) => ok(r.by_regime) && r.by_regime.current === first.current && r.by_regime.current_row === first.current_row);
  const current = agree ? (first.current as string) : null;
  const currentRow = agree ? (first.current_row as string) : null;
  return { rows: served, regimes, current, currentRow };
}
