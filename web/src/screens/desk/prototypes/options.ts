/**
 * "Hedge with options" as a PROTOTYPE (DESK_FRAME3_SPEC §10, §1.0.3): three
 * routes to protect a basket, each priced three ways (a 1-month put, a
 * 3-month put and a 1-month 95/85 put spread) with Black-Scholes at the
 * assumed volatilities of proto-options.json, from the basket engine's live
 * inputs (./basket-inputs.ts): the notional, the top hedge ETF, its hedge
 * ratio and R².
 *   (a) puts on the top hedge ETF, hedge ratio × notional of it, each strike
 *       the basket's moved by the ratio (95% of the basket is 1 − 5% ÷ ratio
 *       of the ETF), so every route protects the same basket level;
 *   (b) puts on the three largest names, each sized to its weight;
 *   (c) an OTC put on the basket itself, at a volatility read off the ETF's
 *       (hedge ratio × the ETF's vol at the strike ÷ √R²) plus a dealer's margin.
 * Every cost, breakeven and payoff is a fraction of the basket's notional, at
 * expiry. The payoff if the basket falls 10% assumes the ETF moves by the
 * fitted ratio (10% ÷ hedge ratio) and each name moves with the basket. Pure.
 */

import o from "../../../fixtures/desk/proto-options.json" with { type: "json" };
import { putValue, years } from "./black-scholes";
import type { BasketInputs, BasketLeg } from "./basket-inputs";

export type Tenor = "1m" | "3m";
type VolKey = "1m_95" | "1m_85" | "3m_95";
interface Underlying {
  q: number;
  vol: Record<VolKey, number>;
}

export interface Structure {
  key: "put1m" | "put3m" | "spread1m";
  label: string;
  tenor: Tenor;
  /** The long strike and, for a spread, the short one, as fractions of spot. */
  long: number;
  short: number | null;
}

export const STRUCTURES: readonly Structure[] = [
  { key: "put1m", label: `1M ${Math.round(o.put_strike * 100)} put`, tenor: "1m", long: o.put_strike, short: null },
  { key: "put3m", label: `3M ${Math.round(o.put_strike * 100)} put`, tenor: "3m", long: o.put_strike, short: null },
  { key: "spread1m", label: `1M ${Math.round(o.put_strike * 100)}/${Math.round(o.spread_short_strike * 100)} put spread`, tenor: "1m", long: o.put_strike, short: o.spread_short_strike },
];

export interface Priced {
  structure: Structure;
  /** The premium, a fraction of the basket's notional, and in dollars. */
  cost: number;
  costUsd: number;
  /** How far the basket must fall by expiry for the payoff to repay the premium (a positive fraction). */
  breakeven: number;
  /** What it pays at expiry if the basket is 10% lower, a fraction of notional and in dollars. */
  payoff: number;
  payoffUsd: number;
}

export type RouteKey = "etf" | "names" | "otc";

export interface Route {
  key: RouteKey;
  /** (a), (b), (c). */
  letter: string;
  rows: Priced[];
  /** The share of the notional the route's options are written on (the names' weights for (b)). */
  covered: number;
}

export interface Hedge {
  inputs: BasketInputs;
  rate: number;
  days: Record<Tenor, number>;
  basketMove: number;
  etf: { symbol: string; q: number; vol: Record<VolKey, number>; notional: number; move: number; strikes: { long: number; short: number } } | null;
  names: (BasketLeg & { q: number; vol: Record<VolKey, number>; assumed: boolean })[];
  basket: { q: number; margin: number; vol: Record<VolKey, number> } | null;
  swapSpreadBp: number;
  routes: Route[];
}

const volKey = (tenor: Tenor, strike: number): VolKey => `${tenor}_${Math.round(strike * 100)}` as VolKey;

/** A basket strike moved onto an ETF the basket moves `beta` times: the ETF level at which the basket is at `k`. */
export const etfStrike = (k: number, beta: number) => 1 - (1 - k) / beta;

/** A structure's premium per unit of its underlying's notional; `at` moves the basket's strikes onto the
 * underlying (the ETF's), and the volatility is the one assumed for the basket strike it stands for. */
function premium(u: Underlying, s: Structure, r: number, days: Record<Tenor, number>, at: (k: number) => number = (k) => k): number {
  const leg = (k: number) => putValue({ strike: at(k), t: years(days[s.tenor]), vol: u.vol[volKey(s.tenor, k)] / 100, r, q: u.q });
  return leg(s.long) - (s.short == null ? 0 : leg(s.short));
}

/** A structure's payoff per unit of its underlying's notional at a level (1 = spot), at expiry. */
function payoffAt(s: Structure, level: number, at: (k: number) => number = (k) => k): number {
  const p = Math.max(at(s.long) - level, 0);
  return s.short == null ? p : Math.min(p, at(s.long) - at(s.short));
}

/** The basket fall x (0..1) at which `pay(x)` repays `cost`, by bisection; null when no fall repays it. */
function breakevenOf(pay: (x: number) => number, cost: number): number | null {
  if (pay(1) < cost) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pay(mid) >= cost) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The three largest names by weight; a tie keeps the basket's order. */
export function largest(legs: readonly BasketLeg[], n = 3): BasketLeg[] {
  return legs
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.weight - a.l.weight || a.i - b.i)
    .slice(0, n)
    .map((x) => x.l);
}

/** Every number the card prints, from the engine's inputs and the assumed volatilities. */
export function hedge(inputs: BasketInputs): Hedge {
  const r = o.rate;
  const days = o.days as Record<Tenor, number>;
  const N = inputs.notional;
  const move = o.basket_move;
  const priced = (cost: number, pay: (x: number) => number, s: Structure): Priced => {
    const payoff = pay(-move);
    return { structure: s, cost, costUsd: cost * N, breakeven: breakevenOf(pay, cost) ?? NaN, payoff, payoffUsd: payoff * N };
  };
  const routes: Route[] = [];

  // (a) the top hedge ETF: hedge ratio × notional of it, at the basket's strikes moved by the ratio; the ETF
  // moves by the basket's move ÷ the ratio.
  const e = (o.etfs as Record<string, Underlying>)[inputs.top.symbol];
  const beta = inputs.top.hedge_ratio;
  const at = (k: number) => etfStrike(k, beta);
  const etf = e ? { symbol: inputs.top.symbol, q: e.q, vol: e.vol, notional: beta * N, move: move / beta, strikes: { long: at(o.put_strike), short: at(o.spread_short_strike) } } : null;
  if (e)
    routes.push({
      key: "etf",
      letter: "a",
      covered: 1,
      rows: STRUCTURES.map((s) => priced(beta * premium(e, s, r, days, at), (x) => beta * payoffAt(s, 1 - x / beta, at), s)),
    });

  // (b) the three largest names, each sized to its weight, each moving with the basket.
  const known = o.names as Record<string, Underlying>;
  const names = largest(inputs.legs).map((l) => {
    const u = known[l.symbol] ?? (o.name_default as Underlying);
    return { ...l, q: u.q, vol: u.vol, assumed: !(l.symbol in known) };
  });
  const W = names.reduce((a, l) => a + l.weight / 100, 0);
  routes.push({
    key: "names",
    letter: "b",
    covered: W,
    rows: STRUCTURES.map((s) =>
      priced(
        names.reduce((a, l) => a + (l.weight / 100) * premium(l, s, r, days), 0),
        (x) => W * payoffAt(s, 1 - x),
        s,
      ),
    ),
  });

  // (c) an OTC put on the basket: the ETF's vol at the strike × the ratio ÷ √R², plus the dealer's margin.
  const margin = o.basket.dealer_margin_pts;
  const basket = e
    ? { q: o.basket.q, margin, vol: Object.fromEntries((Object.keys(e.vol) as VolKey[]).map((k) => [k, (beta * e.vol[k]) / Math.sqrt(inputs.top.r2) + margin])) as Record<VolKey, number> }
    : null;
  if (basket)
    routes.push({
      key: "otc",
      letter: "c",
      covered: 1,
      rows: STRUCTURES.map((s) => priced(premium(basket, s, r, days), (x) => payoffAt(s, 1 - x), s)),
    });

  return { inputs, rate: r, days, basketMove: move, etf, names, basket, swapSpreadBp: o.swap_spread_bp, routes };
}

/** Dollars to the nearest hundred, grouped: 209944 → "$209,900". */
export function usd(x: number): string {
  const v = Math.round(x / 100) * 100;
  return `$${v.toLocaleString("en-US")}`;
}

/** A notional in millions: 10000000 → "$10.0M". */
export function usdM(x: number): string {
  return `$${(x / 1e6).toFixed(1)}M`;
}

/** A fraction of notional with two decimals: 0.02099 → "2.10%". */
export const pct2 = (x: number) => `${(x * 100).toFixed(2)}%`;
/** A fraction with one decimal: 0.083 → "8.3%". */
export const pct1 = (x: number) => `${(x * 100).toFixed(1)}%`;
