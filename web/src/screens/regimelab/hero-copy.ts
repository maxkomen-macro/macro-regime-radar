/**
 * Hero and status-strip copy for the Regime Lab TabHero (redesign Phase 4,
 * checklist 04 C.1). Pure: no React, no hooks, unit-tested.
 *
 * The headline is the served cycle status word verbatim ("Early",
 * "Mid-Cycle", "Extended", "Long in Tooth"; one vocabulary across the h1, the
 * spell tile badge and the "Spell length" row), the pill is the streak length,
 * and the subhead is the R17 definition of that status with the regime as its
 * subject, so the hero never claims more than the cycle caption. Nothing here
 * prints a probability: the odds live in the summary card and the served
 * narrative.
 *
 * `stripSummary` words the summary card's status strip from the classifier's
 * own stored monthly Overheating odds (`overheatingDelta3m`), the only served
 * history: `TransitionOutlook` carries no prior snapshot (checklist 04 F2).
 */

import type { Regime, RegimeDuration } from "../../api/types";
import { fmtMonYr, fmtSigned } from "../../lib/format";
import { overheatingDelta3m } from "./regime-history";

export type CycleStatus = RegimeDuration["status"];
export type CyclePillTone = "mint" | "amber";
export type StripTone = "mint" | "amber" | "gray";

/** Glow behind the hero's right column, by pill tone (mockup line 169). */
export const CYCLE_GLOW: Record<CyclePillTone | "gray", string> = {
  mint: "rgba(38,220,160,.08)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
};

/** The R17 definitions verbatim ("{Status} means {definition}"), the one
 * source for the cycle caption and the hero subhead. */
export const STATUS_DEFINITION: Record<CycleStatus, string> = {
  Early: "the regime is young by its own history.",
  "Mid-Cycle": "the spell sits inside its normal historical span.",
  Extended: "the spell has outlived most of its historical peers.",
  "Long in Tooth": "the spell is among the longest on record; age alone argues for a change.",
};

/** The same four definitions with the regime as subject (C.1 rule 4). */
const STATUS_SUBHEAD: Record<CycleStatus, (label: string) => string> = {
  Early: (l) => `${l} is young by its own history.`,
  "Mid-Cycle": (l) => `${l} sits inside its normal historical span.`,
  Extended: (l) => `${l} has outlived most of its historical peers.`,
  "Long in Tooth": (l) => `${l} is among the longest spells on record; age alone argues for a change.`,
};

/** Early and Mid-Cycle read mint, Extended and Long in Tooth amber (G3). */
export function cyclePillTone(status: CycleStatus | string): CyclePillTone {
  return status === "Extended" || status === "Long in Tooth" ? "amber" : "mint";
}

/** Badge and meter tone for the status word: clear / clear / watch / alert. */
export function cycleStatusTone(status: CycleStatus | string): "clear" | "watch" | "alert" {
  if (status === "Extended") return "watch";
  if (status === "Long in Tooth") return "alert";
  return "clear";
}

/** One rounded string drives the number and its plural, so "1 months" can
 * never come back if toFixed and Math.round disagree at a .5 boundary. */
export function monthsText(months: number): string {
  return months.toFixed(0);
}

export interface CycleHeroCopy {
  /** The served status word, verbatim. */
  headline: string;
  /** "{n} month(s) in". */
  pill: string;
  pillTone: CyclePillTone;
  glow: string;
  /** "{Regime} is young by its own history." (one of the four definitions). */
  subhead: string;
}

/** Hero copy from the served duration; null while the duration is not on
 * screen (the loading and unavailable headlines are the consumer's). */
export function cycleHero(d: RegimeDuration | undefined, r?: Regime | undefined): CycleHeroCopy | null {
  if (!d) return null;
  const months = monthsText(d.months_in_regime);
  const label = d.current_regime ?? r?.label ?? "The regime";
  const pillTone = cyclePillTone(d.status);
  const subhead = (STATUS_SUBHEAD[d.status] ?? STATUS_SUBHEAD.Early)(label);
  return {
    headline: d.status,
    pill: `${months} month${months === "1" ? "" : "s"} in`,
    pillTone,
    glow: CYCLE_GLOW[pillTone],
    subhead,
  };
}

export type StripState = "loading" | "error" | "ready";

export interface StripSummary {
  tone: StripTone;
  title: string;
  detail: string;
}

/** "rising" is a whole-point move of at least +1 on the display's own
 * resolution, not a model threshold (G2). */
export function overheatingRising(deltaPts: number): boolean {
  return Math.round(deltaPts) >= 1;
}

/** The status strip's words (checklist 04 B.2 table). */
export function stripSummary(rows: Regime[] | undefined, state: StripState): StripSummary {
  if (state === "loading") {
    return { tone: "gray", title: "Reading the classifier history…", detail: "Opens the transition outlook" };
  }
  const d = state === "error" ? null : overheatingDelta3m(rows);
  if (!d) {
    return { tone: "gray", title: "Overheating odds unavailable", detail: "The stored classifier history did not answer" };
  }
  const n = Math.round(d.delta);
  const span = `over the last 3 classifier months · ${fmtMonYr(d.from)} → ${fmtMonYr(d.to)}`;
  if (overheatingRising(d.delta)) {
    return { tone: "amber", title: "Watch · Overheating odds rising", detail: `Up ${n} pts ${span}` };
  }
  return { tone: "mint", title: "Overheating odds not rising", detail: `${fmtSigned(n, 0)} pts ${span}` };
}
