/**
 * Black-Scholes on a dividend-paying underlying, for the PROTOTYPE cards
 * (DESK_FRAME3_SPEC §1.0.3): every option value they print is priced here at
 * an assumed volatility the card states in its Advanced section. Spot is 1,
 * so a strike is a fraction of spot and a value a fraction of notional.
 * Rates and dividend yields are continuously compounded; time is in years.
 * Pure.
 */

/** The standard normal distribution function: erf by Abramowitz and Stegun 7.1.26 (error under 1.5e-7). */
export function normCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface Leg {
  /** Strike as a fraction of spot (0.95 = 95% of spot). */
  strike: number;
  /** Years to expiry. */
  t: number;
  /** Volatility, a fraction (0.192 = 19.2%). */
  vol: number;
  /** Short rate, continuously compounded. */
  r: number;
  /** Dividend yield, continuously compounded. */
  q: number;
}

function d1d2({ strike, t, vol, r, q }: Leg): [number, number] {
  const d1 = (Math.log(1 / strike) + (r - q + 0.5 * vol * vol) * t) / (vol * Math.sqrt(t));
  return [d1, d1 - vol * Math.sqrt(t)];
}

/** A European put's value, as a fraction of spot. */
export function putValue(l: Leg): number {
  const [d1, d2] = d1d2(l);
  return l.strike * Math.exp(-l.r * l.t) * normCdf(-d2) - Math.exp(-l.q * l.t) * normCdf(-d1);
}

/** A European call's value, as a fraction of spot. */
export function callValue(l: Leg): number {
  const [d1, d2] = d1d2(l);
  return Math.exp(-l.q * l.t) * normCdf(d1) - l.strike * Math.exp(-l.r * l.t) * normCdf(d2);
}

/** A put's delta (negative) and a call's (positive). */
export function putDelta(l: Leg): number {
  return -Math.exp(-l.q * l.t) * normCdf(-d1d2(l)[0]);
}
export function callDelta(l: Leg): number {
  return Math.exp(-l.q * l.t) * normCdf(d1d2(l)[0]);
}

/** The strike whose delta is `delta` at the leg's volatility (|delta| < e^−qt), by bisection: a put's is below
 * spot, a call's above. */
export function strikeForDelta(kind: "put" | "call", delta: number, l: Omit<Leg, "strike">): number {
  let lo = kind === "put" ? 0.2 : 1;
  let hi = kind === "put" ? 1 : 5;
  const f = (k: number) => (kind === "put" ? putDelta({ ...l, strike: k }) : callDelta({ ...l, strike: k })) - delta;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(lo) * f(mid) <= 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Calendar days to years (the day count every prototype states: actual/365). */
export const years = (days: number) => days / 365;
