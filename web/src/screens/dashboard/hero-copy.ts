/**
 * Hero copy for the Dashboard TabHero (redesign Phase 3, checklist 03 C.1,
 * decision 4). Pure: no React, no hooks, unit-tested.
 *
 * The rule the whole module exists for: the classifier's four-way odds and the
 * NBER-trained recession model are two readings and never read as one
 * distribution. The headline is the regime label, the pill is the dominant
 * stored probability, the subhead ties the runner-up's number to the same
 * four-way split, and nothing in the hero prints the recession model's
 * probability, the words "recession model" or "NBER". The one exception is
 * the disambiguation clause (rule 4): when the runner-up is Recession Risk it
 * names the separate model, without a number, and points at the summary row
 * that carries it. The number itself lives only on rows whose label says
 * "NBER recession model" (summary, key levels).
 *
 * `REGIME_NAMES`, `REGIME_MEANING`, `regimeOdds` and `convictionWord` are the
 * DashboardScreen helpers (kept verbatim; the screen imports them from here so
 * the copy and the screen can never disagree on a name or a threshold).
 */

import type { Regime } from "../../api/types";
import { fmtMonYr, fmtSigned, fmtWholePct } from "../../lib/format";

/** The dash placeholder for a value that is not on file. */
export const DASH = "—";

export const REGIME_NAMES: Record<string, string> = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  recession: "Recession Risk",
};

/** The classifier's own definition of each quadrant (Methodology copy). */
export const REGIME_MEANING: Record<string, string> = {
  Goldilocks: "growth trending up while inflation stays calm: the equity-friendly quadrant",
  Overheating: "growth and inflation both running hot: real assets lead, duration suffers",
  Stagflation: "inflation hot while growth stalls: the hardest tape, cash and commodities defend",
  "Recession Risk": "growth rolling over with inflation fading: quality bonds and defensives lead",
};

export function regimeOdds(r: Regime) {
  const probs = {
    goldilocks: r.prob_goldilocks ?? 0,
    overheating: r.prob_overheating ?? 0,
    stagflation: r.prob_stagflation ?? 0,
    recession: r.prob_recession ?? 0,
  };
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return { probs, lead: ranked[0], runner: ranked[1] };
}

export function convictionWord(c: number): "High" | "Medium" | "Low" {
  if (c >= 0.6) return "High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

export type HeroPillTone = "mint" | "amber" | "gray";

/** Glow behind the hero's right column, by pill tone (C.1 rule 7). */
export const HERO_GLOW: Record<HeroPillTone, string> = {
  mint: "rgba(38,220,160,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
};

/** Goldilocks mint; Overheating and Stagflation amber; Recession Risk gray
 * (TabHero offers only these three tones; G7). */
export function heroPillTone(label: string): HeroPillTone {
  if (label === "Goldilocks") return "mint";
  if (label === "Overheating" || label === "Stagflation") return "amber";
  return "gray";
}

/** The lead word by the gap between the top two odds, in percentage points. */
export function leadWord(gapPp: number): "A coin flip with" | "A contested lead over" | "A clear lead over" {
  if (gapPp < 10) return "A coin flip with";
  if (gapPp < 25) return "A contested lead over";
  return "A clear lead over";
}

/** Appended to the lede when the runner-up is Recession Risk (C.1 rule 4,
 * verbatim): no number, so the two readings can never be taken for one split. */
export const RECESSION_RUNNER_CLAUSE =
  "Recession Risk here is the classifier's fourth quadrant; the NBER recession model is a separate reading, shown in the summary.";

export interface HeroCopy {
  /** The regime label, and nothing else. */
  headline: string;
  /** "{pct}% probability": the dominant stored probability. */
  pill: string;
  pillTone: HeroPillTone;
  glow: string;
  /** "{lead word} {runner} at {pct}% of the same four-way odds." */
  subhead: string;
  /** The D5 paragraph verbatim. Plain text: the screen wraps "model
   * confidence" in the Jargon affordance and appends `ledeClause` after it. */
  lede: string;
  /** The rule-4 clause when the runner-up is Recession Risk, else null. */
  ledeClause: string | null;
  /** ["Macro regime for {Mon YYYY}", "Model confidence: {word} ({pct}%)"]. The
   * month's freshness is the hero's Macro chip (A3: a §5 word from the
   * server, never an age counted here). */
  footnote: [string, string];
}

export function heroCopy(r: Regime): HeroCopy {
  const { lead, runner } = regimeOdds(r);
  const gapPp = Math.round((lead[1] - runner[1]) * 100);
  const runnerName = REGIME_NAMES[runner[0]] ?? runner[0];
  const subhead = `${leadWord(gapPp)} ${runnerName} at ${fmtWholePct(runner[1])} of the same four-way odds.`;

  const g = r.growth_trend != null ? fmtSigned(r.growth_trend) : DASH;
  const i = r.inflation_trend != null ? fmtSigned(r.inflation_trend) : DASH;
  const ledeBase =
    `${r.label} means ${REGIME_MEANING[r.label] ?? "the classifier's leading quadrant"}. ` +
    `The call rests on a growth trend of ${g} and an inflation trend of ${i}; ` +
    `model confidence of ${fmtWholePct(r.confidence)} is a separate reading of how firmly the classifier holds the call.`;
  const ledeClause = runner[0] === "recession" ? RECESSION_RUNNER_CLAUSE : null;

  const pillTone = heroPillTone(r.label);
  return {
    headline: r.label,
    pill: `${fmtWholePct(lead[1])} probability`,
    pillTone,
    glow: HERO_GLOW[pillTone],
    subhead,
    lede: ledeBase,
    ledeClause,
    footnote: [
      `Macro regime for ${fmtMonYr(r.date)}`,
      `Model confidence: ${convictionWord(r.confidence)} (${fmtWholePct(r.confidence)})`,
    ],
  };
}
