/**
 * Hero copy for the Markets TabHero (redesign Phase 5, checklist 05 C.1).
 * Pure: no React, no hooks, unit-tested.
 *
 * The headline is the risk word read off the four stored sector ETFs' one-day
 * moves (XLF, XLE, XLI, XLK at the latest stored close): "Risk-on" when three
 * or four are up, "Risk-off" when none or one is, "Mixed" for two. The pill
 * counts them. The live tape never feeds the word (the sector ETFs are not on
 * the stream), so the word and the pill share one cadence and one stamp, and
 * the `basis` line under the freshness chips says so. Nothing here repeats the
 * tab name or prints a probability.
 */

import { fmtDate } from "../../lib/format";

/** The three TabHero pill tones: mint Risk-on, amber Risk-off, gray Mixed (G4). */
export type HeroTone = "mint" | "amber" | "gray";
export type MarketsPillTone = HeroTone;

/** Glow behind the hero's right column, by pill tone (mockup line 23 for mint). */
export const MARKETS_GLOW: Record<MarketsPillTone, string> = {
  mint: "rgba(40,209,124,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
};

export interface SectorRead {
  symbol: string;
  name: string;
  /** The newest stored bar's `ret_1d`; null when the bar is not on file. */
  ret: number | null;
}

export interface MarketsHeroCopy {
  /** "Risk-on" / "Mixed" / "Risk-off"; null while no sector close is served. */
  headline: string | null;
  /** "{up} of {n} sectors up"; null with the headline. */
  pill: string | null;
  pillTone: MarketsPillTone;
  glow: string;
  /** The honesty line under the chips; null with the headline. */
  basis: string | null;
}

export function marketsHero(sectors: SectorRead[], date: string | null): MarketsHeroCopy {
  const served = sectors.filter((s): s is SectorRead & { ret: number } => s.ret != null);
  const n = served.length;
  if (n === 0) {
    return { headline: null, pill: null, pillTone: "gray", glow: MARKETS_GLOW.gray, basis: null };
  }
  const up = served.filter((s) => s.ret > 0).length;
  const share = up / n;
  let headline: string;
  let pillTone: MarketsPillTone;
  if (share >= 0.75) {
    headline = "Risk-on";
    pillTone = "mint";
  } else if (share <= 0.25) {
    headline = "Risk-off";
    pillTone = "amber";
  } else {
    headline = "Mixed";
    pillTone = "gray";
  }
  const stamp = date ? `at the ${fmtDate(date)} close` : "at the latest stored close";
  return {
    headline,
    pill: `${up} of ${n} sectors up`,
    pillTone,
    glow: MARKETS_GLOW[pillTone],
    basis: `Headline and pill read the one-day moves of the four stored sector ETFs ${stamp}; the session sentence is the live tape.`,
  };
}
