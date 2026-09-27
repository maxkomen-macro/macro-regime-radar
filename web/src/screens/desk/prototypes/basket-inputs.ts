/**
 * The basket engine's inputs to "Hedge with options" (DESK_FRAME3_SPEC §10,
 * §1.0.3 rule 5), for the basket open on the page, read from the fields of
 * desk/books' `GET /api/desk/basket/hedge` answer (its §12.15):
 *   - NOTIONAL: `notional`;
 *   - TOP HEDGE ETF: `top`, the first of `etfs[]` ranked by R²;
 *   - HEDGE RATIO: that row's `hedge_ratio`;
 *   - R²: that row's R² on its `basis` window (`r2_1y`, or `r2_60d` for a
 *     young basket), with the window.
 * They are labelled "from your basket · live" on the card; only the card's
 * outputs are illustrative.
 *
 * REBASE SEAM: until desk/books is on main, the answer is read from
 * proto-books-basket.json, desk/books' own fixture answer for the sample
 * basket (its legs at its weights, held, $1,000,000). It answers for that
 * basket alone, whatever id an import gave it. At the rebase the card reads
 * the served answer through `inputsFrom` (step 3's `useBasketHedge`), and the
 * stand-in and `basketInputs` go.
 */

import books from "../../../fixtures/desk/proto-books-basket.json" with { type: "json" };
import type { SavedBasket } from "../basket/weights";

export interface BasketLeg {
  symbol: string;
  name: string | null;
  /** Percent of the basket (22 = 22%). */
  weight: number;
}

type Window = { start: string | null; end: string | null; n: number | null };

/** §12.15's `etfs[]` row, the fields read here. */
export interface HedgeEtfRow {
  symbol: string;
  label: string;
  rank: number;
  basis: "1y" | "60d" | null;
  r2_1y: number | null;
  r2_60d: number | null;
  hedge_ratio: number | null;
  /** The basket's realized volatility on the basis window (annualized fraction). */
  basket_vol?: number | null;
  window_1y?: Window;
  window_60d?: Window;
}

/** §12.15's answer, the fields read here. */
export interface HedgeAnswer {
  notional: number | null;
  top: string | null;
  etfs?: HedgeEtfRow[];
}

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

function etfOf(r: HedgeEtfRow): HedgeEtf | null {
  const r2 = r.basis === "60d" ? r.r2_60d : r.r2_1y;
  if (!fin(r.hedge_ratio) || !fin(r2)) return null;
  return { symbol: r.symbol, name: r.label, rank: r.rank, hedge_ratio: r.hedge_ratio, r2 };
}

/** The card's inputs from a served §12.15 answer and the basket it answers for; null when it serves no top pick. */
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

/** The stand-in answers for its one basket, as saved: the same symbols at the same weights. */
function sameLegs(saved: readonly { symbol: string; weight: number | string }[]): boolean {
  const legs = books.legs;
  return saved.length === legs.length && saved.every((l, i) => l.symbol === legs[i].symbol && Number(l.weight) === legs[i].weight);
}

/** The engine's inputs for a saved basket (the stand-in's, until the rebase), or null when it has no answer for it. */
export function basketInputs(saved: SavedBasket | null | undefined): BasketInputs | null {
  if (!saved || !sameLegs(saved.legs)) return null;
  return inputsFrom(books as HedgeAnswer, saved);
}

/** The sample basket the stand-in answers for, as this browser saves it (baskets.json's). */
export function sampleBasket(): SavedBasket {
  const names: Record<string, string> = { NVDA: "Nvidia", AVGO: "Broadcom", VRT: "Vertiv", CRWV: "CoreWeave", ANET: "Arista", CEG: "Constellation", SMCI: "Supermicro" };
  return { id: "local-1", name: "AI infrastructure", legs: books.legs.map((l) => ({ symbol: l.symbol, name: names[l.symbol] ?? null, weight: l.weight })), saved_at: "2026-09-22T20:00:00Z" };
}
