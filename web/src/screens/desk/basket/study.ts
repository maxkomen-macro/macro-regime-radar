/**
 * Basket & Hedge's "Event study on this basket" (DESK_FRAME3_SPEC §10, §12.19; desk P1a): what the card asks
 * `/basket/study` for, and the words it prints from the answer. Every number is the served answer's: the
 * engine's run on the basket's own index (docs/desk/BASKET_STUDY_SPEC.md). Pure.
 */

import type { BasketParams } from "./weights";
import type { BasketStudyResponse, StudyHorizon } from "../data/types";
import { dayLong } from "../kit/format";

/** What `/basket/study` is asked: /basket/price's basket without the notional (the index's returns do not depend on
 * it), at the route's default question; null while the page would not price the basket. */
export type BasketStudyParams = { legs: string; method: string; weighting?: "cap" };

export function studyParams(p: BasketParams | null): BasketStudyParams | null {
  if (!p) return null;
  return { legs: p.legs, method: p.method, ...(p.weighting === "cap" ? { weighting: "cap" as const } : {}) };
}

const MOVE_WORD: Record<BasketStudyResponse["question"]["move"], string> = { down2s: "falls", up2s: "rises" };
const HORIZON_WORDS: Record<number, string> = { 5: "a week later", 10: "two weeks later", 20: "a month later", 60: "three months later" };

/** "falls 2σ over 5 days", the card's subtitle and the question's middle. */
export function moveWords(a: Pick<BasketStudyResponse, "question">): string {
  return `${MOVE_WORD[a.question.move] ?? "moves"} 2σ over ${a.question.window ?? "—"} days`;
}

/** "a month later", the selected horizon in words. */
export function horizonWords(h: number | null | undefined): string {
  return (h != null && HORIZON_WORDS[h]) || `${h ?? "—"} sessions later`;
}

/** The selected horizon's row of the served study. */
export function selectedRow(a: BasketStudyResponse): StudyHorizon | undefined {
  const h = a.study?.selected_horizon ?? a.question.horizon;
  return a.study?.horizons.find((r) => r.h === h);
}

/** The basket's names and how they are weighted, as the page defines the basket (Max, 2026-11-04: membership and
 * weighting stated the same way everywhere). */
export function membershipWords(a: BasketStudyResponse): string {
  const names = a.basket.legs.map((l) => (a.basket.weighting === "cap" || l.weight == null ? l.symbol : `${l.symbol} ${+l.weight.toFixed(2)}%`));
  const how = a.basket.weighting === "cap" ? "cap-weighted at the start from the stored share counts" : "at the saved weights";
  return `${names.join(", ")}, ${how}`;
}

/** Why the index starts where it does (§12.15's start rule, which the study keeps). */
export function startWords(ix: BasketStudyResponse["index"]): string {
  const who = ix.start_binding.join(", ");
  if (ix.start_kind === "first_close") return `${dayLong(ix.start)}, ${who}'s first close`;
  if (ix.start_kind === "gap") return `${dayLong(ix.start)}, the first session every name has a close (${who} had none the session before)`;
  return `${dayLong(ix.start)}, the first session in the history`;
}

/** The index line: membership, weighting, rebalancing, provider and span, in the page's terms. */
export function indexLine(a: BasketStudyResponse): string {
  const ix = a.index;
  return (
    `The index: ${membershipWords(a)}; ${ix.rule}. A session counts only when every name has a close. ` +
    `${ix.provider} daily closes from ${startWords(ix)}, through ${dayLong(ix.end)}.`
  );
}

/** The question in the Event Study's voice, from the selected horizon's served share. */
export function questionLine(name: string, a: BasketStudyResponse, pct: (x: number) => string): string {
  const row = selectedRow(a);
  const up = row?.up_pct;
  const tail = typeof up === "number" && Number.isFinite(up) ? `it was higher ${horizonWords(row?.h)} ${pct(up)} of the time.` : `how it did ${horizonWords(a.question.horizon)}.`;
  return `After ${name} ${moveWords(a)}, ${tail}`;
}
