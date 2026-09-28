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
 * fitted ratio (10% ÷ hedge ratio) and each name moves with the basket.
 * Each structure is priced only inside its domain (Codex R-02): a hedge ratio
 * from 0.25 to 4 for the routes that read it, every strike handed to
 * Black-Scholes from 50% to 100% of its underlying's spot, a positive assumed
 * volatility, an R² in (0, 1] for the basket put, and finite results;
 * outside it the structure carries a plain reason and no number. Pure.
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

/** A structure priced, or, outside its domain, the reason it is not (Codex R-02). */
export type Priced =
  | {
      structure: Structure;
      reason: null;
      /** The premium, a fraction of the basket's notional, and in dollars. */
      cost: number;
      costUsd: number;
      /** How far the basket must fall by expiry for the payoff to repay the premium (a positive fraction);
       * null when no fall does. */
      breakeven: number | null;
      /** What it pays at expiry if the basket is 10% lower, a fraction of notional and in dollars. */
      payoff: number;
      payoffUsd: number;
    }
  | { structure: Structure; reason: string };

/** The pricing domain (Codex R-02): the hedge ratios the ETF and basket routes price at, and the strikes, as
 * fractions of the underlying's spot, handed to Black-Scholes (from the low end, below the high end). */
export const DOMAIN = { ratio: { lo: 0.25, hi: 4 }, strike: { lo: 0.5, hi: 1 } } as const;

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
  /** The ETF route's inputs; `reason` when its hedge ratio is outside the domain. */
  etf: { symbol: string; q: number; vol: Record<VolKey, number>; notional: number; move: number; strikes: { long: number; short: number }; reason: string | null } | null;
  names: (BasketLeg & { q: number; vol: Record<VolKey, number>; assumed: boolean })[];
  /** The basket put's inputs; `reason` when its hedge ratio or R² is outside the domain. */
  basket: { q: number; margin: number; vol: Record<VolKey, number>; reason: string | null } | null;
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

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const pctOf = (k: number) => `${Math.round(k * 100)}%`;

/** Why a hedge ratio is outside the domain, or null when the ETF and basket routes may read it. */
export function ratioReason(beta: number): string | null {
  if (!fin(beta)) return "Not priced: no hedge ratio was served.";
  if (beta < DOMAIN.ratio.lo || beta > DOMAIN.ratio.hi) return `Not priced: the hedge ratio, ${beta.toFixed(2)}, is outside the ${DOMAIN.ratio.lo} to ${DOMAIN.ratio.hi} this card prices.`;
  return null;
}

/** Why a structure's strikes, moved onto `symbol` by `at`, are outside the domain, or null. */
function strikeReason(s: Structure, at: (k: number) => number, symbol: string | null): string | null {
  for (const k of s.short == null ? [s.long] : [s.long, s.short]) {
    const x = at(k);
    if (!fin(x) || x < DOMAIN.strike.lo || x >= DOMAIN.strike.hi)
      return symbol
        ? `Not priced: the ${pctOf(k)} strike moves to ${fin(x) ? `${(x * 100).toFixed(1)}%` : "no number"} of ${symbol}, outside the ${pctOf(DOMAIN.strike.lo)} to ${pctOf(DOMAIN.strike.hi)} of spot this card prices.`
        : `Not priced: the ${pctOf(k)} strike is outside the ${pctOf(DOMAIN.strike.lo)} to ${pctOf(DOMAIN.strike.hi)} of spot this card prices.`;
  }
  return null;
}

/** Why an underlying's assumed volatility for a structure is not usable, or null. */
function volReason(u: Underlying, s: Structure, name: string | null): string | null {
  for (const k of s.short == null ? [s.long] : [s.long, s.short]) {
    const v = u.vol[volKey(s.tenor, k)];
    if (!fin(v) || v <= 0) return `Not priced: no volatility is assumed${name ? ` for ${name}` : ""} at this strike.`;
  }
  return null;
}

/** Every number the card prints, from the engine's inputs and the assumed volatilities (`over` replaces
 * parts of proto-options.json, for the tests). */
export function hedge(inputs: BasketInputs, over: Partial<typeof o> = {}): Hedge {
  const a = { ...o, ...over };
  const r = a.rate;
  const days = a.days as Record<Tenor, number>;
  const N = inputs.notional;
  const move = a.basket_move;
  // A structure priced when every check passes and every result is finite; else its reason (Codex R-02).
  const priced = (s: Structure, reason: string | null, cost: () => number, pay: (x: number) => number): Priced => {
    if (reason) return { structure: s, reason };
    const c = cost();
    const payoff = pay(-move);
    const breakeven = fin(c) && fin(payoff) ? breakevenOf(pay, c) : null;
    if (!fin(c) || c < 0 || !fin(payoff) || !fin(c * N) || !fin(payoff * N) || (breakeven !== null && !fin(breakeven))) return { structure: s, reason: "Not priced: the price is not a finite number." };
    return { structure: s, reason: null, cost: c, costUsd: c * N, breakeven, payoff, payoffUsd: payoff * N };
  };
  const routes: Route[] = [];

  // (a) the top hedge ETF: hedge ratio × notional of it, at the basket's strikes moved by the ratio; the ETF
  // moves by the basket's move ÷ the ratio.
  const e = (a.etfs as Record<string, Underlying>)[inputs.top.symbol];
  const beta = inputs.top.hedge_ratio;
  const betaWhy = ratioReason(beta);
  const at = (k: number) => etfStrike(k, beta);
  const etf = e ? { symbol: inputs.top.symbol, q: e.q, vol: e.vol, notional: beta * N, move: move / beta, strikes: { long: at(a.put_strike), short: at(a.spread_short_strike) }, reason: betaWhy } : null;
  if (e)
    routes.push({
      key: "etf",
      letter: "a",
      covered: 1,
      rows: STRUCTURES.map((s) =>
        priced(
          s,
          betaWhy ?? strikeReason(s, at, inputs.top.symbol) ?? volReason(e, s, inputs.top.symbol),
          () => beta * premium(e, s, r, days, at),
          (x) => beta * payoffAt(s, 1 - x / beta, at),
        ),
      ),
    });

  // (b) the three largest names, each sized to its weight, each moving with the basket.
  const known = a.names as Record<string, Underlying>;
  const names = largest(inputs.legs).map((l) => {
    const u = known[l.symbol] ?? (a.name_default as Underlying);
    return { ...l, q: u.q, vol: u.vol, assumed: !(l.symbol in known) };
  });
  const W = names.reduce((acc, l) => acc + l.weight / 100, 0);
  routes.push({
    key: "names",
    letter: "b",
    covered: W,
    rows: STRUCTURES.map((s) =>
      priced(
        s,
        strikeReason(s, (k) => k, null) ?? names.map((l) => volReason(l, s, l.symbol)).find((x) => x) ?? null,
        () => names.reduce((acc, l) => acc + (l.weight / 100) * premium(l, s, r, days), 0),
        (x) => W * payoffAt(s, 1 - x),
      ),
    ),
  });

  // (c) an OTC put on the basket: the ETF's vol at the strike × the ratio ÷ √R², plus the dealer's margin; it
  // reads the ratio and R², so it takes their domain too.
  const margin = a.basket.dealer_margin_pts;
  const r2 = inputs.top.r2;
  const r2Why = !fin(r2) || r2 <= 0 || r2 > 1 ? `Not priced: an R² of ${fin(r2) ? r2.toFixed(2) : "no number"} cannot carry the ETF's volatility to the basket's.` : null;
  const basket = e
    ? { q: a.basket.q, margin, vol: Object.fromEntries((Object.keys(e.vol) as VolKey[]).map((k) => [k, (beta * e.vol[k]) / Math.sqrt(r2) + margin])) as Record<VolKey, number>, reason: betaWhy ?? r2Why }
    : null;
  if (basket)
    routes.push({
      key: "otc",
      letter: "c",
      covered: 1,
      rows: STRUCTURES.map((s) =>
        priced(
          s,
          basket.reason ?? strikeReason(s, (k) => k, null) ?? volReason(basket, s, "the basket"),
          () => premium(basket, s, r, days),
          (x) => payoffAt(s, 1 - x),
        ),
      ),
    });

  return { inputs, rate: r, days, basketMove: move, etf, names, basket, swapSpreadBp: a.swap_spread_bp, routes };
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
