/**
 * Hero copy, the summary strip and the shared display helpers for the
 * Recession screen (redesign Phase 7, checklist 07 C.1 rules 1 to 8 and the
 * B.2 strip table). Pure: no hooks, no state; the one React call is
 * `createElement` for the lede's Jargon affordance (rule 3).
 *
 * One number, one truth: every probability, label, coefficient and
 * divergence figure is a served field of /api/recession/probability or its
 * formatted value. The band words come from `recession_label` (classified
 * server-side, src/analytics/recession.py) and are never derived from the
 * number here; `labelTone` maps the served word to a tone and returns
 * `reference` for anything else (G20). The only arithmetic in this module is
 * the difference between two served monthly points at the display's 0.1
 * resolution, the count of consecutive rises at that resolution, and slices
 * of served series by count or by date.
 *
 * `BANDS`, `usrecBands`, `TENOR_ORDER` and `FEATURE_LABELS` moved here from
 * RecessionScreen.tsx so the gauge, the panels and the tests read one source.
 */

import { Fragment, createElement, type ReactNode } from "react";
import type { DatedValue, RecessionMetrics } from "../../api/types";
import { fmtMonYr, fmtSigned } from "../../lib/format";
import Jargon from "../shared/Jargon";
import type { StatusTone } from "../shared/SummaryCard";
import type { TabHeroPillTone } from "../shared/TabHero";
import type { ChartBand } from "../dashboard/LineChart";
import { DASH } from "../dashboard/hero-copy";

export type LabelTone = "clear" | "watch" | "alert" | "reference";

export interface RecessionHeroCopy {
  headline: string;
  pill: string;
  pillTone: TabHeroPillTone;
  glow: string;
  subhead: string;
  lede: ReactNode;
  /** Plain-text form of the lede for tests. */
  ledeText: string;
  note: string;
  footnote: string[];
}

export interface StripSummary {
  tone: StatusTone;
  title: string;
  detail: string;
}

/* ── constants moved from RecessionScreen.tsx ─────────────────────────── */

/** The 20 / 40 band edges the server classifies on (recession.py) with the
 * gauge's band colour and word (B.1.1). Never a third source of the edges. */
export const BANDS: { to: number; color: string; word: string }[] = [
  { to: 20, color: "var(--mint)", word: "LOW" },
  { to: 40, color: "var(--amber)", word: "ELEVATED" },
  { to: 100, color: "var(--neg)", word: "HIGH RISK" },
];

/** Glow behind the hero's right column (C.1 rule 6): mint for Low Risk,
 * amber for Elevated and High Risk (mockup recession.html:169), gray for the
 * loading and unavailable heroes and for any other label. */
export const RECESSION_GLOW = {
  mint: "rgba(38,220,160,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
} as const;

export const TENOR_ORDER = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"];

/** Feature key → display label, in the served `model_features` vocabulary. */
export const FEATURE_LABELS: Record<string, string> = {
  yield_curve: "Yield curve (2s10s)",
  unemployment: "Unemployment rate",
  hy_spread: "HY credit spread",
  indpro_yoy: "Industrial production YoY",
  lei_proxy: "Leading-indicator proxy",
};

/** Contiguous USREC==1 runs → shaded chart bands. */
export function usrecBands(series: DatedValue[]): ChartBand[] {
  const bands: ChartBand[] = [];
  let open: string | null = null;
  for (const p of series) {
    if (p.value >= 0.5 && open == null) open = p.date;
    if (p.value < 0.5 && open != null) {
      bands.push({ from: open, to: p.date });
      open = null;
    }
  }
  if (open != null && series.length) bands.push({ from: open, to: series[series.length - 1].date });
  return bands;
}

/* ── series helpers ───────────────────────────────────────────────────── */

const todayIsoDate = (): string => new Date().toISOString().slice(0, 10);

/** The value at the display's own 0.1 resolution. */
const tenths = (v: number): number => Math.round(v * 10);

/** The point the h1 speaks for: the largest i whose value is the served
 * `recession_prob` (the server serialises the same float twice); else the
 * largest i dated on or before `todayIso` (the server's own rule; the last
 * served point can be the partial current month); else the last point; -1
 * for an empty series. */
export function headlineIndex(series: DatedValue[], prob: number | null, todayIso?: string): number {
  if (!series.length) return -1;
  if (prob != null) {
    for (let i = series.length - 1; i >= 0; i--) if (series[i].value === prob) return i;
  }
  const today = todayIso ?? todayIsoDate();
  for (let i = series.length - 1; i >= 0; i--) if (series[i].date.slice(0, 10) <= today) return i;
  return series.length - 1;
}

/** `series[i - back]`, or null when fewer than `back + 1` points precede and include i. */
export function priorPoint(series: DatedValue[], i: number, back = 3): DatedValue | null {
  if (i < 0 || i - back < 0) return null;
  return series[i - back] ?? null;
}

/** Consecutive month-over-month rises ending at i, compared at 0.1
 * resolution so a rise the page would not print does not count. */
export function riseStreak(series: DatedValue[], i: number): number {
  let n = 0;
  for (let j = Math.min(i, series.length - 1); j > 0; j--) {
    if (tenths(series[j].value) > tenths(series[j - 1].value)) n++;
    else break;
  }
  return n;
}

/** The three-month change in points at 0.1 resolution (subhead, row 2, strip):
 * null when no prior point exists. Rounded once so the sign word and the
 * printed figure can never disagree. */
export function deltaPoints(series: DatedValue[], i: number, back = 3): { prior: DatedValue; delta: number } | null {
  const prior = priorPoint(series, i, back);
  if (!prior) return null;
  return { prior, delta: (tenths(series[i].value) - tenths(prior.value)) / 10 };
}

/** `series.slice(-n)`. */
export function lastMonths(series: DatedValue[], n: number): DatedValue[] {
  return series.slice(-n);
}

/** null → every point; else the points dated on or after the last point's
 * date shifted back n years (measured from the last served point, never the
 * wall clock). */
export function lastYears(series: DatedValue[], n: number | null): DatedValue[] {
  if (n == null || !series.length) return series;
  const last = series[series.length - 1].date;
  const cutoff = `${Number(last.slice(0, 4)) - n}${last.slice(4)}`;
  return series.filter((p) => p.date >= cutoff);
}

/* ── the served label's tone ──────────────────────────────────────────── */

/** "Low Risk" clear · "Elevated" watch · "High Risk" alert · anything else
 * reference. Never from the number. */
export function labelTone(label: string): LabelTone {
  switch (label) {
    case "Low Risk":
      return "clear";
    case "Elevated":
      return "watch";
    case "High Risk":
      return "alert";
    default:
      return "reference";
  }
}

/** clear mint · watch amber · alert amber (G1: the TabHero pill union has no
 * red; the word carries "High Risk") · else gray. */
export function pillToneFor(label: string): TabHeroPillTone {
  const tone = labelTone(label);
  if (tone === "clear") return "mint";
  if (tone === "watch" || tone === "alert") return "amber";
  return "gray";
}

/** The colour token for a tone on the surfaces that may use red (gauge arc,
 * summary row, scenario result); the TabHero pill goes through pillToneFor. */
export function toneColor(tone: LabelTone): string | undefined {
  switch (tone) {
    case "clear":
      return "var(--mint)";
    case "watch":
      return "var(--amber)";
    case "alert":
      return "var(--neg)";
    default:
      return undefined;
  }
}

/** "under 20%" · "20 to 40%" · "40% and above" · "" for any other word. */
export function bandRange(label: string): string {
  switch (labelTone(label)) {
    case "clear":
      return "under 20%";
    case "watch":
      return "20 to 40%";
    case "alert":
      return "40% and above";
    default:
      return "";
  }
}

/* ── features ─────────────────────────────────────────────────────────── */

/** FEATURE_LABELS label; an unknown key prints with underscores as spaces. */
export function featureLabel(name: string): string {
  return FEATURE_LABELS[name] ?? name.replace(/_/g, " ");
}

/** The current reading of one feature as the cards print it; the dash
 * placeholder when the served input is null. */
export function featureCurrent(name: string, m: RecessionMetrics): string {
  const c = m.current_inputs ?? {};
  switch (name) {
    case "yield_curve": {
      const s = m.yield_curve_spread;
      return s != null ? `${s >= 0 ? "+" : ""}${Math.round(s)} bps` : DASH;
    }
    case "unemployment":
      return c.unrate != null ? `${c.unrate.toFixed(1)}%` : DASH;
    case "hy_spread":
      return c.hy_oas != null ? `${Math.round(c.hy_oas)} bps` : DASH;
    case "indpro_yoy":
      return c.indpro_yoy != null ? `${c.indpro_yoy.toFixed(1)}%` : DASH;
    case "lei_proxy":
      return c.lei != null ? `${c.lei.toFixed(2)}pp` : DASH;
    default:
      return DASH;
  }
}

/* ── hero copy (C.1) ──────────────────────────────────────────────────── */

const LEDE_HEAD = "The ";
const LEDE_TERM = "logistic model";
const LEDE_MID = " scores twelve-month odds against a ~15% historical base rate; Elevated starts at 20%, High Risk at 40%. ";
const LEDE_TAIL = " This is the recession model's own probability, not the classifier's Recession Risk odds (the Regime context row).";

/** The divergence clause (X4, verbatim): the served label, then whether the
 * two readings agree, by the server's ±20 materiality band. */
function divergenceClause(m: RecessionMetrics): string {
  const material = m.divergence_score != null && Math.abs(m.divergence_score) > 20;
  return `${m.divergence_label}: credit pricing and the model ${material ? "disagree. The divergence is material and requires judgment" : "tell one story"}.`;
}

export function heroCopy(m: RecessionMetrics): RecessionHeroCopy {
  const prob = m.recession_prob ?? 0;
  const label = m.recession_label;
  const series = m.recession_prob_series ?? [];
  const i = headlineIndex(series, m.recession_prob);
  const tone = labelTone(label);

  // Rule 1: the headline is the served probability, the pill the served word.
  const headline = `${prob.toFixed(1)}%`;

  // Rule 2: the three-month change at 0.1 resolution, or the NBER sentence.
  const change = i >= 0 ? deltaPoints(series, i, 3) : null;
  let subhead: string;
  if (!change) subhead = "Twelve-month odds from the NBER-trained model.";
  else if (change.delta > 0) subhead = `Twelve-month odds, up ${change.delta.toFixed(1)} points in three months.`;
  else if (change.delta < 0) subhead = `Twelve-month odds, down ${Math.abs(change.delta).toFixed(1)} points in three months.`;
  else subhead = "Twelve-month odds, unchanged over three months.";

  // Rule 3: X4 with its three edits; the Jargon affordance on "logistic model".
  const divergence = divergenceClause(m);
  const ledeText = `${LEDE_HEAD}${LEDE_TERM}${LEDE_MID}${divergence}${LEDE_TAIL}`;
  const lede = createElement(
    Fragment,
    null,
    LEDE_HEAD,
    createElement(Jargon, { term: "recession model" }, LEDE_TERM),
    LEDE_MID,
    divergence,
    LEDE_TAIL,
  );

  // Rule 4: the band and its range, without the number (the h1 carries it).
  const range = bandRange(label);
  const note = `Sits in the ${label} band${range ? ` (${range})` : ""}; the historical base rate runs ~15% and 2008 peaked near 89%.`;

  // Rule 5.
  const footnote = [`Logistic model on ${m.model_features.length} FRED inputs, lagged 3 months`];
  if (i >= 0) footnote.push(`Scored for ${fmtMonYr(series[i].date)}`);

  // Rule 6.
  const pillTone = pillToneFor(label);
  const glow = tone === "clear" ? RECESSION_GLOW.mint : tone === "watch" || tone === "alert" ? RECESSION_GLOW.amber : RECESSION_GLOW.gray;

  return { headline, pill: label, pillTone, glow, subhead, lede, ledeText, note, footnote };
}

/* ── the summary strip (B.2 table, rule 8) ────────────────────────────── */

/** Amber at this many consecutive rises at 0.1 resolution (G3: the mockup's
 * "three straight rises"; two would over-alarm on monthly noise). */
export const RISE_STREAK_WATCH = 3;

export function stripSummary(m: RecessionMetrics | undefined, q: { isLoading: boolean; isError: boolean }): StripSummary {
  if (!m) {
    return q.isError
      ? { tone: "gray", title: "Recession model unavailable", detail: "The data service did not answer" }
      : { tone: "gray", title: "Reading the recession model…", detail: "Opens the model inputs" };
  }
  const series = m.recession_prob_series ?? [];
  const i = headlineIndex(series, m.recession_prob);
  if (i < 0) return { tone: "gray", title: "Recession model unavailable", detail: "The data service did not answer" };
  const streak = riseStreak(series, i);
  if (streak >= RISE_STREAK_WATCH) {
    const base = series[i - streak];
    return {
      tone: "amber",
      title: `Watch · ${streak} straight rises`,
      detail: `Probability up each month since ${fmtMonYr(base.date)} · ${base.value.toFixed(1)}% → ${series[i].value.toFixed(1)}%`,
    };
  }
  const change = deltaPoints(series, i, 3);
  if (!change) return { tone: "mint", title: "No consecutive rises", detail: "Fewer than four stored months on file" };
  return {
    tone: "mint",
    title: "No consecutive rises",
    detail: `${fmtSigned(change.delta, 1)} pts vs 3 months ago · ${fmtMonYr(change.prior.date)} → ${fmtMonYr(series[i].date)}`,
  };
}
