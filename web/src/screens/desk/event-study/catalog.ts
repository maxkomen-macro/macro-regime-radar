/**
 * The study catalog (DESK_FRAME3_SPEC §4, §12.3): every question the Event
 * Study can ask is one of its fifteen studies at one of its allowed
 * horizons. A request must normalize to one catalog study (§12.2), so a slot
 * option is enabled only when, with the other slots as they are, it leads to
 * an available study. Pure.
 */

import type { CatalogStudy, Question } from "../data/types";

export type Slot = keyof Question;
const FIVE = ["shock", "window", "move", "while", "target"] as const;

const sameSlots = (s: NonNullable<CatalogStudy["question"]>, q: Pick<Question, (typeof FIVE)[number]>) => FIVE.every((k) => (s[k] ?? null) === (q[k] ?? null));

/** The catalog study a question normalizes to (its five slots, whatever the horizon), or null. */
export function studyFor(studies: readonly CatalogStudy[], q: Question): CatalogStudy | null {
  return studies.find((s) => s.question && sameSlots(s.question, q)) ?? null;
}

/** Whether a question is one the server answers (§12.2): an available catalog study at an allowed horizon. */
export function isAnswerable(studies: readonly CatalogStudy[], q: Question): boolean {
  const s = studyFor(studies, q);
  return !!s && s.available && s.allowed_horizons.includes(q.horizon);
}

/** Whether choosing `value` for `slot` leads to an available catalog study, the other slots as they are (§4). */
export function leadsToStudy(studies: readonly CatalogStudy[], draft: Question, slot: Slot, value: Question[Slot]): boolean {
  return isAnswerable(studies, { ...draft, [slot]: value } as Question);
}
