/**
 * Hero copy, the summary rows and the status strip for the Asset allocation
 * tool (redesign Phase 9, checklist 09 B.9 and C.1). Pure: no hooks, no
 * React. The derivation of the current regime's leaders (`allocationSummary`)
 * moved here verbatim from AllocationPanel.tsx:165-205, and the T21 sentences
 * are split across the hero's h1, pill, subhead and lede with their words
 * kept. `optimizerStatus` reads the served `converged` flags per method
 * through today's `isFallback` rule (discrepancy 28) and never hard-codes
 * which method fell back. Nothing is re-derived: sorting and formatting only.
 */

import type { AllocationData, OptimizationResult, OptimizationSample, OptimizerUniverse, RegimeStats } from "../../api/types";
import { fmtMonYr, fmtProb } from "../../lib/format";
import type { StatusTone } from "../shared/SummaryCard";
import type { TabHeroPillTone } from "../shared/TabHero";

export const pct = (v: number, dp = 1): string => `${(v * 100).toFixed(dp)}%`;
export const spct = (v: number, dp = 1): string => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/** The seven optimizer methods in the panel's order (AllocationPanel.tsx:35-43
 * keys and labels): the table `optimizerStatus` counts over. */
export const METHOD_LABELS: { key: string; label: string }[] = [
  { key: "mvo", label: "Mean-Variance" },
  { key: "min_var", label: "Min Variance" },
  { key: "risk_parity", label: "Risk Parity" },
  { key: "black_litterman", label: "Black-Litterman" },
  { key: "hrp", label: "HRP" },
  { key: "cvar", label: "Min CVaR" },
  { key: "herc", label: "HERC" },
];

/** Only an explicit converged:false (or a "(fallback)" method name) marks a
 * fallback; the source omits the flag entirely on some success paths
 * (AllocationPanel.tsx:50-51, verbatim). */
export const isFallback = (o: { converged?: boolean; method?: string } | undefined): boolean =>
  o != null && (o.converged === false || (o.method ?? "").includes("(fallback)"));

export const ALLOCATION_EYEBROW = "Asset allocation";

export const ALLOCATION_GLOW = {
  mint: "rgba(38,220,160,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
} as const;

export const GENERIC_HEADLINE = "Regime-conditional returns";
export const LOADING_HEADLINE = "Building the return history…";
export const LOADING_SUBHEAD = "Building ~24 years of monthly return history; a first load can take up to a minute.";
export const LOADING_LEDE = "Ten asset classes, seven optimizers, and the full risk block compute fresh from the return history each session.";
export const ERROR_HEADLINE = "Allocation engine unavailable: the data service did not answer.";
export const STRIP_SUFFIX = "Jump to the optimization section.";

export interface RankedAsset {
  n: string;
  m: number;
  sr: number | null;
}
export interface AllocationSummary {
  names: string[];
  curRegime: string;
  ranked: RankedAsset[];
  best: RankedAsset | null;
  worst: RankedAsset | null;
}
export interface AllocationHeroCopy {
  eyebrow: string;
  headline: string;
  /** True when no ranked asset exists and the headline is the generic
   * sentence's subject (rendered in the UI face, not the display face). */
  generic: boolean;
  pill: string | null;
  pillTone: TabHeroPillTone;
  glow: string;
  subhead: string;
  lede: string;
}
export interface OptimizerStatus {
  solved: number;
  fallbacks: string[];
  total: number;
}
export interface AllocationStrip {
  tone: StatusTone;
  title: string;
  detail: string;
}

/** The asset order: every asset with regime history, from the regime-stats
 * keys. It used to prefer the optimizer's `asset_names`, which was the same
 * list until N-B2 gave the optimizer an adaptive universe — it can now run on
 * eight of ten, and the hero chart, the regime matrix and the risk lenses
 * never depended on it. The weights table reads `opt.asset_names` directly,
 * because that is the order the weight arrays are in. */
export function assetNames(a: AllocationData): string[] {
  return [...new Set(Object.values(a.regime_stats).flatMap((s) => Object.keys(s?.mean ?? {})))];
}

export function currentStats(a: AllocationData): RegimeStats | undefined {
  return a.regime_stats[a.current_regime];
}

/** The optimizer sample accounting the disclosure and the strip print. */
export function sampleOf(a: AllocationData): OptimizationSample | null {
  return a.optimizations_skipped ?? a.optimization_sample ?? null;
}

export function startMonYr(a: AllocationData): string {
  return fmtMonYr(`${a.data_start}-01`);
}

/** The current regime's assets ranked by served annualized mean, descending
 * (AllocationPanel.tsx:197-203): null means are dropped, nothing else moves. */
export function allocationSummary(a: AllocationData): AllocationSummary {
  const names = assetNames(a);
  const curRegime = String(a.current_regime);
  const curStats = currentStats(a);
  const ranked: RankedAsset[] = curStats
    ? names
        .map((n) => ({ n, m: curStats.mean?.[n] ?? null, sr: curStats.sharpe?.[n] ?? null }))
        .filter((x): x is RankedAsset => x.m != null)
        .sort((x, y) => y.m - x.m)
    : [];
  return { names, curRegime, ranked, best: ranked[0] ?? null, worst: ranked.length ? ranked[ranked.length - 1] : null };
}

/** The T21 why sentence (AllocationPanel.tsx:229-235), verbatim; "" without
 * current-regime stats. */
export function whySentence(a: AllocationData): string {
  const curStats = currentStats(a);
  if (!curStats) return "";
  // A4: the classifier's odds print through fmtProb (outside 0–1: the dash).
  const odds = fmtProb(a.dominant_prob);
  const sample = curStats.n_months < 36 ? "a thin sample, so treat the column as evidence, not law" : "a workable sample";
  return `Read the ${a.current_regime} column first: it is the weather the classifier calls today at ${odds} odds. A positive return with a negative Sharpe means the asset did not cover cash plus its risk; ${curStats.n_months} months is ${sample}.`;
}

export function allocationHero(a: AllocationData): AllocationHeroCopy {
  const { names, curRegime, best, worst } = allocationSummary(a);
  const since = startMonYr(a);
  const lede = whySentence(a);
  if (!best || !worst) {
    return {
      eyebrow: ALLOCATION_EYEBROW,
      headline: GENERIC_HEADLINE,
      generic: true,
      pill: null,
      pillTone: "gray",
      glow: ALLOCATION_GLOW.gray,
      subhead: `Regime-conditional returns for ${names.length} asset classes since ${since}.`,
      lede,
    };
  }
  const tone: TabHeroPillTone = best.m >= 0 ? "mint" : "amber";
  return {
    eyebrow: ALLOCATION_EYEBROW,
    headline: best.n,
    generic: false,
    pill: `${spct(best.m)} a year`,
    pillTone: tone,
    glow: ALLOCATION_GLOW[tone],
    subhead: `Led ${curRegime} months since ${since}${best.sr != null ? ` at Sharpe ${best.sr.toFixed(2)}` : ""}; ${worst.n} lagged at ${spct(worst.m)}.`,
    lede,
  };
}

/** Solved = served and not a fallback; fallbacks = the labels of the served
 * methods that fell back, in the panel's order; total = the seven methods. */
export function optimizerStatus(a: AllocationData): OptimizerStatus {
  const total = METHOD_LABELS.length;
  const opt = a.optimizations;
  if (!opt) return { solved: 0, fallbacks: [], total };
  let solved = 0;
  const fallbacks: string[] = [];
  for (const m of METHOD_LABELS) {
    const o = (opt as Record<string, unknown>)[m.key] as OptimizationResult | undefined;
    if (!o) continue;
    if (isFallback(o)) fallbacks.push(m.label);
    else solved++;
  }
  return { solved, fallbacks, total };
}

/** The served universe, only when the optimizer had to reduce it (N-B2): the
 * adaptive pass drops the assets whose gaps block a rectangular sample, so a
 * reader looking at weights has to be told which asset classes are not in
 * them. Absent or full universe reads null and nothing changes on screen. */
export function universeOf(a: AllocationData): OptimizerUniverse | null {
  const u = a.optimizations?.universe;
  return u && u.reduced ? u : null;
}

/** The summary card's Optimizer row (AllocationPanel.tsx:209-217, with the
 * solved count now read from the served flags). */
export function optimizerRow(a: AllocationData): { value: string; tone: string } {
  const { solved, total } = optimizerStatus(a);
  if (a.optimizations) {
    const u = universeOf(a);
    return {
      value: u
        ? `${solved} of ${total} methods solved · ${u.assets_used} of ${u.assets_total} asset classes`
        : `${solved} of ${total} methods solved · long-only · 40% cap`,
      tone: "var(--pos)",
    };
  }
  const sample = sampleOf(a);
  return {
    value: sample?.sentence ? `Unavailable: ${sample.sentence}` : `Unavailable: needs 24 complete ${a.current_regime} months`,
    tone: "var(--warn-hot)",
  };
}

/** A status line's character budget: about 200 px of 12 px text, one line in
 * the narrowest strip (390 px). */
const STRIP_LINE_CHARS = 36;

/** The strip's four states (B.9), plus the gray unavailable strip for a
 * failed request. */
export function allocationStrip(a: AllocationData | undefined, loading: boolean, snapshot = false): AllocationStrip {
  if (!a) {
    // CP4: a snapshot session says the optimizer is not in it, and why.
    if (!loading && snapshot) return { tone: "gray", title: "Optimizer not in this snapshot", detail: "It runs on the server" };
    return loading
      ? { tone: "gray", title: "Reading the optimizer state…", detail: "Jumps to the optimization section" }
      : { tone: "gray", title: "Optimizer unavailable", detail: "The data service did not answer" };
  }
  // Iteration 1 step 5 (G4): title and detail are one line each at 390 px.
  // The method names and the regime's month counts are the optimization
  // section's (its status line prints the full sample sentence) and the
  // Sample row's.
  const { solved, fallbacks } = optimizerStatus(a);
  if (a.optimizations) {
    const u = universeOf(a);
    if (!fallbacks.length)
      return {
        tone: "mint",
        title: `Optimizer solved · ${solved} methods`,
        detail: u ? `${u.assets_used} of ${u.assets_total} asset classes · ${u.months_used} months` : "max 40% per asset · long-only",
      };
    const named = `${fallbacks.join(" and ")} at equal weight`;
    return {
      tone: "amber",
      title: `Optimizer solved · ${fallbacks.length} fallback${fallbacks.length === 1 ? "" : "s"}`,
      detail: named.length <= STRIP_LINE_CHARS ? named : `${fallbacks.length} methods at equal weight`,
    };
  }
  const sample = sampleOf(a);
  return {
    tone: "amber",
    title: "Optimizer skipped this session",
    detail: sample ? `${sample.complete_months} complete months · ${sample.required_cov_months} required` : "needs 24 complete months",
  };
}
