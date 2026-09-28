/**
 * The basket engine's inputs to "Hedge with options" (DESK_FRAME3_SPEC §10,
 * §1.0.3 rule 5), for the saved basket on the page, read from the fields of
 * step 3's served `GET /api/desk/basket/hedge` answer (§12.16), the same
 * answer the ETF hedge and the stress test print:
 *   - NOTIONAL: `notional`;
 *   - TOP HEDGE ETF: `top`, the first of `etfs[]` ranked by R²;
 *   - HEDGE RATIO: that row's `hedge_ratio`;
 *   - R²: that row's R² on its `basis` window (`r2_1y`, or `r2_60d` for a
 *     young basket), with the window; its `basket_vol` for Advanced.
 * They are labelled "from your basket · live" on the card; only the card's
 * outputs are illustrative. Pure.
 */

import type { BasketHedgeResponse, HedgeEtf as ServedEtf } from "../data/types";
import type { SavedBasket } from "../basket/weights";

export interface BasketLeg {
  symbol: string;
  name: string | null;
  /** Percent of the basket (22 = 22%). */
  weight: number;
}

/** §12.16's answer, the fields read here. */
export type HedgeAnswer = Pick<BasketHedgeResponse, "notional" | "top" | "etfs">;

export interface HedgeEtf {
  symbol: string;
  /** The ETF's name ("Technology Select Sector"). */
  name: string;
  rank: number;
  /** Dollars of the ETF per dollar of the basket. */
  hedge_ratio: number;
  r2: number;
}

export interface BasketInputs {
  basketId: string;
  name: string;
  /** The basket's notional, in dollars. */
  notional: number;
  /** The top-ranked hedge ETF, and the next one it was ranked against (null when it stands alone). */
  top: HedgeEtf;
  next: HedgeEtf | null;
  /** How many ETFs were ranked, and the window the ratio and R² are fitted on. */
  ranked: number;
  /** The engine's realized basket volatility on that window (a fraction), or null. */
  basketVol: number | null;
  window: { start: string; end: string; n: number };
  legs: BasketLeg[];
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

function etfOf(r: Pick<ServedEtf, "symbol" | "label" | "rank" | "basis" | "r2_1y" | "r2_60d" | "hedge_ratio">): HedgeEtf | null {
  const r2 = r.basis === "60d" ? r.r2_60d : r.r2_1y;
  if (!fin(r.hedge_ratio) || !fin(r2)) return null;
  return { symbol: r.symbol, name: r.label, rank: r.rank, hedge_ratio: r.hedge_ratio, r2 };
}

/** The card's inputs from the served §12.16 answer and the saved basket it answers for; null when it serves no top pick. */
export function inputsFrom(answer: HedgeAnswer | null | undefined, saved: SavedBasket): BasketInputs | null {
  if (!answer || !fin(answer.notional) || !answer.top || !Array.isArray(answer.etfs)) return null;
  const row = answer.etfs.find((e) => e.symbol === answer.top);
  const top = row ? etfOf(row) : null;
  const w = row ? (row.basis === "60d" ? row.window_60d : row.window_1y) : null;
  if (!row || !top || !w || !w.start || !w.end || !fin(w.n)) return null;
  const others = answer.etfs.filter((e) => e !== row).sort((a, b) => a.rank - b.rank).map(etfOf).filter((e): e is HedgeEtf => !!e);
  return {
    basketId: saved.id,
    name: saved.name,
    notional: answer.notional,
    top,
    next: others[0] ?? null,
    ranked: answer.etfs.length,
    basketVol: fin(row.basket_vol) ? row.basket_vol : null,
    window: { start: w.start, end: w.end, n: w.n },
    legs: saved.legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) })),
  };
}
