/**
 * The basket the Basket & Hedge prototypes "Positioning" and "Event study on
 * this basket" are drawn for (DESK_FRAME3_SPEC §10, §1.0.3): desk/books'
 * first-visit preset, AI Infrastructure 10 (../basket/weights `PRESET`), so a
 * first visit sees every name with illustrative values. Another basket, other
 * names or other weights, shows one line instead. Its name, method and notional
 * do not decide it: the illustrative figures depend only on which names are
 * held at which weights. Pure.
 */

import { PRESET, type SavedBasket } from "../basket/weights";

export const DRAWN_FOR: SavedBasket = PRESET;

/** The one line either card prints for any other basket. */
export const OTHER_BASKET_LINE = `Illustrative values are shown for the ${PRESET.name} preset.`;

/** Whether a basket holds the preset's names at the preset's weights, in any order. */
export function isDrawnFor(legs: readonly { symbol: string; weight: number | string }[]): boolean {
  const want = new Map(PRESET.legs.map((l) => [l.symbol, Number(l.weight)]));
  return legs.length === want.size && legs.every((l) => want.get(l.symbol) === Number(l.weight));
}
