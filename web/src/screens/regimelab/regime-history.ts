/**
 * Regime Lab history helpers (redesign Phase 4, checklist 04 A.2). Pure: no
 * React, no hooks, unit-tested. Every function reads the stored monthly
 * classifier rows that `/api/regime/history` serves and completes arithmetic
 * the current screen already performed (the Gantt's segment merge, the
 * Dashboard's streak memo, the 6-month stay residual); nothing here re-derives
 * a probability.
 *
 * `REGIME_HUE` carries the four `--r-*` tokens so the screen never paints a
 * served colour field (`status_color`, `TransitionItem.color`, …), which are
 * old-palette hexes (checklist 04 F5).
 */

import type { Regime, TransitionOutlook } from "../../api/types";

/** House order: classifier order, the same the Gantt lanes and the odds bar use. */
export const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as const;
export type RegimeName = (typeof REGIMES)[number];

/** The regime hue tokens (spec section 0; tokens/colors.css). */
export const REGIME_HUE: Record<string, string> = {
  Goldilocks: "var(--r-goldilocks)",
  Overheating: "var(--r-overheating)",
  Stagflation: "var(--r-stagflation)",
  "Recession Risk": "var(--r-recession)",
};

/** Hue for a served label; the neutral text tone for anything unexpected. */
export function regimeHue(label: string | null | undefined): string {
  return (label && REGIME_HUE[label]) || "var(--text-3)";
}

/** Index in house order; unknown labels sort last. */
export function regimeOrder(label: string): number {
  const i = REGIMES.indexOf(label as RegimeName);
  return i === -1 ? 99 : i;
}

export interface Segment {
  label: string;
  start: string;
  end: string; // exclusive month
  months: number;
}

/** Consecutive rows with the same label collapse into one span (the Gantt's
 * merge, moved verbatim from RegimeLabScreen.tsx:779-791). */
export function mergeSegments(rows: Regime[]): Segment[] {
  const segs: Segment[] = [];
  for (const r of rows) {
    const last = segs[segs.length - 1];
    if (last && last.label === r.label) {
      last.months += 1;
      last.end = r.date;
    } else {
      segs.push({ label: r.label, start: r.date, end: r.date, months: 1 });
    }
  }
  return segs;
}

export interface SpellStart {
  /** Months the current label has run without a break. */
  n: number;
  /** First month of the streak. */
  since: string | undefined;
  /** The label before the streak, or null when the record starts inside it. */
  prev: string | null;
}

/** The streak the latest label has run and the switch that started it (the
 * Dashboard's streak memo, DashboardScreen.tsx:178-187). */
export function spellStart(rows: Regime[] | undefined): SpellStart | null {
  if (!rows?.length) return null;
  const lead = rows[rows.length - 1].label;
  let n = 0;
  for (let i = rows.length - 1; i >= 0 && rows[i].label === lead; i--) n++;
  const first = rows[rows.length - n];
  const prev = rows[rows.length - n - 1];
  return { n, since: first?.date, prev: prev?.label ?? null };
}

export interface ExitCount {
  to: string;
  count: number;
}

/**
 * How past spells of `label` ended: for every merged segment carrying `label`
 * that has a successor, the successor's label is counted. The open final
 * segment has no successor and is excluded. Sorted by count descending, ties
 * in house order; zero-count regimes are not listed.
 */
export function exitCounts(rows: Regime[] | undefined, label: string): ExitCount[] {
  const segs = mergeSegments(rows ?? []);
  const counts = new Map<string, number>();
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i].label !== label) continue;
    const to = segs[i + 1].label;
    counts.set(to, (counts.get(to) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([to, count]) => ({ to, count }))
    .sort((a, b) => b.count - a.count || regimeOrder(a.to) - regimeOrder(b.to));
}

/** Total completed spells behind an `exitCounts` result. */
export function completedSpells(exits: ExitCount[]): number {
  return exits.reduce((a, e) => a + e.count, 0);
}

/** Label changes inside the last 12 stored rows (RegimeLabScreen.tsx:821). */
export function switchesInLast12(rows: Regime[] | undefined): number {
  return (rows ?? []).slice(-12).reduce((acc, r, i, arr) => (i > 0 && r.label !== arr[i - 1].label ? acc + 1 : acc), 0);
}

export interface TrailPoint {
  date: string;
  label: string;
  /** growth_trend: right = accelerating. */
  x: number;
  /** inflation_trend: up = rising. */
  y: number;
}

/**
 * The quadrant trail: the last `n` stored rows (a window of months), keeping
 * those that carry both trends, in date order. A row with a null trend is
 * dropped rather than plotted at zero.
 */
export function trailPoints(rows: Regime[] | undefined, n = 12): TrailPoint[] {
  return (rows ?? [])
    .slice(-n)
    .filter((r) => r.growth_trend != null && r.inflation_trend != null)
    .map((r) => ({ date: r.date, label: r.label, x: r.growth_trend as number, y: r.inflation_trend as number }));
}

export interface OverheatingDelta {
  /** Percentage points: (latest − three rows back) × 100. */
  delta: number;
  /** ISO month of the base row (three stored rows back). */
  from: string;
  /** ISO month of the latest row. */
  to: string;
}

/**
 * Change in the classifier's stored Overheating odds over the last three
 * stored months, by row count (a gap in the stored series is not bridged; the
 * two stamps are returned so the detail can print them). Null with fewer than
 * four rows or a null probability at either end.
 */
export function overheatingDelta3m(rows: Regime[] | undefined): OverheatingDelta | null {
  if (!rows || rows.length < 4) return null;
  const latest = rows[rows.length - 1];
  const base = rows[rows.length - 4];
  if (latest.prob_overheating == null || base.prob_overheating == null) return null;
  return { delta: (latest.prob_overheating - base.prob_overheating) * 100, from: base.date, to: latest.date };
}

/** The 6-month "stays" residual: the served rows exclude the self-transition,
 * so 100 minus their sum completes the distribution (rounded, floored at 0;
 * RegimeLabScreen.tsx:415-418). One helper feeds the tile and the summary row. */
export function stay6m(t: TransitionOutlook): number {
  return Math.max(0, Math.round(100 - t.transitions_6m.reduce((a, tr) => a + tr.probability, 0)));
}

function yearMonth(iso: string): [number, number] {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return [y, m ?? 1];
}

/** Whole years between the first and last stored rows (May 1996 to Jul 2026
 * is 30); null without rows. */
export function yearsOfHistory(rows: Regime[] | undefined): number | null {
  if (!rows?.length) return null;
  const [y0, m0] = yearMonth(rows[0].date);
  const [y1, m1] = yearMonth(rows[rows.length - 1].date);
  const months = (y1 - y0) * 12 + (m1 - m0);
  return Math.max(0, Math.floor(months / 12));
}
