/**
 * The basket the Basket & Hedge prototypes "Positioning" and "Event study on
 * this basket" are drawn for (DESK_FRAME3_SPEC §10, §1.0.3): desk/books'
 * first-visit preset, AI Infrastructure 10 (../basket/weights `PRESET`), so a
 * first visit sees every name with illustrative values. A basket is the preset
 * only when its legs are exactly the preset's symbol–weight mapping: ten unique
 * symbols, each at the preset's weight, in any order. Anything else (another
 * name, another weight, a symbol twice) shows one line instead (Codex R-04:
 * ten NVDA legs at 10% passed a check of the count and each leg's weight). Its
 * name, method and notional do not decide it: the illustrative figures depend
 * only on which names are held at which weights. Pure.
 */

import { PRESET, type SavedBasket } from "../basket/weights";

export const DRAWN_FOR: SavedBasket = PRESET;

/** The one line either card prints for any other basket. */
export const OTHER_BASKET_LINE = `Illustrative values are shown for the ${PRESET.name} preset.`;

/** Whether a basket's legs are exactly the preset's symbol–weight mapping, in any order (no symbol twice). */
export function isDrawnFor(legs: readonly { symbol: string; weight: number | string }[]): boolean {
  const want = new Map(PRESET.legs.map((l) => [l.symbol, Number(l.weight)]));
  const got = new Map<string, number>();
  for (const l of legs) {
    if (got.has(l.symbol)) return false;
    got.set(l.symbol, Number(l.weight));
  }
  return got.size === want.size && [...want].every(([symbol, weight]) => got.get(symbol) === weight);
}
