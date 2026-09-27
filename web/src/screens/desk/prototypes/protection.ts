/**
 * "What protection costs right now" as a PROTOTYPE (DESK_FRAME3_SPEC §3,
 * §1.0.3): every number the card prints, from vol.json (§12.13's vol shape)
 * and proto-protection.json, by the rules the card's Advanced section states.
 * The 25-delta strikes and what each option costs are Black-Scholes at the
 * stated volatilities; where the skew sits is the share of the two-year weekly
 * line at or below today's reading. Pure.
 */

import vol from "../../../fixtures/desk/vol.json" with { type: "json" };
import inputs from "../../../fixtures/desk/proto-protection.json" with { type: "json" };
import { callValue, putValue, strikeForDelta, years } from "./black-scholes";

export type Tenor = "1m" | "3m" | "6m";
export const TENORS: readonly Tenor[] = ["1m", "3m", "6m"];
export const TENOR_WORDS: Record<Tenor, string> = { "1m": "1 month", "3m": "3 months", "6m": "6 months" };

export interface Side {
  /** Implied volatility, in vol points (19.2 = 19.2%). */
  iv: number;
  /** The 25-delta strike, a fraction of spot. */
  strike: number;
  /** What the option costs, a fraction of spot. */
  cost: number;
}

export interface Protection {
  underlying: string;
  days: Record<Tenor, number>;
  rate: number;
  dividendYield: number;
  /** Put 25-delta vol minus call 25-delta vol, 1 month out (vol.json's `skew_25d_1m_pts`). */
  skew: number;
  put: Side;
  call: Side;
  implied: Record<Tenor, number>;
  realized: Record<Tenor, number>;
  sessions: Record<Tenor, number>;
  history: { date: string; pts: number }[];
  /** The share of the weekly line at or below today's reading, and its count. */
  percentile: number;
  atOrBelow: number;
  low: { date: string; pts: number };
  high: { date: string; pts: number };
  trend: string;
}

/** Everything the card prints, from its two fixtures. */
export function protection(): Protection {
  const t = years(inputs.days["1m"]);
  const base = { t, r: inputs.rate, q: inputs.dividend_yield };
  const side = (kind: "put" | "call", iv: number): Side => {
    const strike = strikeForDelta(kind, kind === "put" ? -0.25 : 0.25, { ...base, vol: iv / 100 });
    const leg = { ...base, vol: iv / 100, strike };
    return { iv, strike, cost: kind === "put" ? putValue(leg) : callValue(leg) };
  };
  const history = inputs.skew_history;
  const today = history[history.length - 1].pts;
  const atOrBelow = history.filter((p) => p.pts <= today).length;
  const byPts = [...history].sort((a, b) => a.pts - b.pts || a.date.localeCompare(b.date));
  return {
    underlying: inputs.underlying,
    days: inputs.days,
    rate: inputs.rate,
    dividendYield: inputs.dividend_yield,
    skew: vol.skew_25d_1m_pts,
    put: side("put", inputs.iv_25d_1m.put),
    call: side("call", inputs.iv_25d_1m.call),
    implied: { "1m": vol.term["1m"], "3m": vol.term["3m"], "6m": vol.term["6m"] },
    realized: { "1m": vol.realized_20d, "3m": inputs.realized["3m"], "6m": inputs.realized["6m"] },
    sessions: inputs.realized_sessions,
    history,
    percentile: atOrBelow / history.length,
    atOrBelow,
    low: byPts[0],
    high: byPts[byPts.length - 1],
    trend: vol.skew_trend,
  };
}

/** A fraction of spot as a percent with two decimals: 0.00844 → "0.84%". */
export const costText = (frac: number) => `${(frac * 100).toFixed(2)}%`;
/** A strike as a percent of spot with one decimal: 0.9674 → "96.7%". */
export const strikeText = (frac: number) => `${(frac * 100).toFixed(1)}%`;
