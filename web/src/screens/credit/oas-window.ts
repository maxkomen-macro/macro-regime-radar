/**
 * Pure helpers for the hero OAS chart (redesign Phase 6, checklist 06 A.3 and
 * B.1.1). No React, no hooks. These are the only client computations on the
 * Credit page beyond the ledger's direct reads: the ten-year window cut, the
 * HY / IG date intersection, the list of NBER bands inside the plotted window
 * and the plotted window's extremes. Every value plotted is a served point.
 */

import type { DatedValue } from "../../api/types";

/** One plotted month: HY and IG on the same date. */
export interface OasPair {
  date: string;
  hy: number;
  ig: number;
}

export interface NberBand {
  /** ISO dates, inclusive months. */
  from: string;
  to: string;
  /** Caption label ("2001", "2008–09", "2020"). */
  label: string;
}

/** NBER recession windows shaded on the OAS history — the same three the
 * Streamlit tab pins (static reference, monthly resolution). Moved verbatim
 * from CreditScreen.tsx:27-31 with the caption's labels attached. */
export const NBER_BANDS: NberBand[] = [
  { from: "2001-03-01", to: "2001-11-30", label: "2001" },
  { from: "2007-12-01", to: "2009-06-30", label: "2008–09" },
  { from: "2020-02-01", to: "2020-04-30", label: "2020" },
];

const ym = (iso: string): string => iso.slice(0, 7);
const day = (iso: string): string => iso.slice(0, 10);

/** Pair HY and IG on their common dates only (CreditScreen.tsx:245-251,
 * moved): both series must run over the exact same date set so the crosshair
 * and the band histogram align. Order follows `hy`. */
export function intersectByDate(hy: DatedValue[], ig: DatedValue[]): OasPair[] {
  const igByDate = new Map(ig.map((p) => [p.date, p.value]));
  const out: OasPair[] = [];
  for (const p of hy) {
    const v = igByDate.get(p.date);
    if (v != null) out.push({ date: p.date, hy: p.value, ig: v });
  }
  return out;
}

/** The last `years` calendar years of `points`, measured from the LAST
 * point (or `endIso`), never from the wall clock, so a stale DB still shows
 * a full window. The boundary month is kept: a last point in Sep 2026 with
 * `years` 10 keeps everything from Sep 2016 on. Points after `endIso`'s
 * month are dropped. Expects ascending dates. */
export function sliceWindow<T extends { date: string }>(points: T[], years: number, endIso?: string): T[] {
  if (!points.length) return [];
  const end = ym(endIso ?? points[points.length - 1].date);
  const [y, mo] = end.split("-");
  const cutoff = `${String(Number(y) - years).padStart(4, "0")}-${mo}`;
  return points.filter((p) => {
    const m = ym(p.date);
    return m >= cutoff && m <= end;
  });
}

/** The bands that overlap the plotted window (inclusive on both ends). */
export function bandsInWindow(bands: NberBand[], fromIso: string, toIso: string): NberBand[] {
  const from = day(fromIso);
  const to = day(toIso);
  return bands.filter((b) => day(b.from) <= to && day(b.to) >= from);
}

/** "2020" / "2001 and 2020" / "2001, 2008–09 and 2020"; "" for none. */
export function bandList(labels: string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export interface Extreme {
  value: number;
  /** ISO date of the month the extreme was printed. */
  date: string;
}

export interface WindowExtremes {
  hyHigh: Extreme;
  igLow: Extreme;
  /** ISO dates of the first and last plotted months. */
  first: string;
  last: string;
}

/** The HY high and IG low of the plotted points only (the mono range line
 * under the hero chart), with their months. Accepts the paired points or the
 * two raw series (intersected here). Null with nothing to plot. */
export function windowExtremes(points: OasPair[]): WindowExtremes | null;
export function windowExtremes(hy: DatedValue[], ig: DatedValue[]): WindowExtremes | null;
export function windowExtremes(a: OasPair[] | DatedValue[], ig?: DatedValue[]): WindowExtremes | null {
  const pairs: OasPair[] = ig ? intersectByDate(a as DatedValue[], ig) : (a as OasPair[]);
  if (!pairs.length) return null;
  let hyHigh: Extreme = { value: pairs[0].hy, date: pairs[0].date };
  let igLow: Extreme = { value: pairs[0].ig, date: pairs[0].date };
  for (const p of pairs) {
    if (p.hy > hyHigh.value) hyHigh = { value: p.hy, date: p.date };
    if (p.ig < igLow.value) igLow = { value: p.ig, date: p.date };
  }
  return { hyHigh, igLow, first: pairs[0].date, last: pairs[pairs.length - 1].date };
}
