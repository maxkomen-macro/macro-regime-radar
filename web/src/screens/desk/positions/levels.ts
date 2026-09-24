/**
 * WRONG IF suggestions (DESK_FRAME3_SPEC §9): three chips and eight more
 * levels "computed from live levels" for the instrument. The live levels the
 * API serves are the S&P 500's (/technicals: the 50- and 200-day averages),
 * so an instrument on the S&P gets them with their numbers; any other
 * instrument gets the same rules without a number to fill (the rule still
 * names the level; the server resolves it). Pure.
 */

import type { TechnicalsResponse } from "../data/types";
import { grouped } from "../kit/format";

export interface LevelChoice {
  id: string;
  label: string;
}

/**
 * Whether an instrument's text names the S&P 500 outright (SPX, SPY, "S&P",
 * an ES future when it leads): never a pair ("NDX vs SPX", "QQQ/SPY"), whose
 * levels are the spread's, not the index's.
 */
export function onSpx(instrument: string): boolean {
  const t = instrument.trim();
  if (/\bvs\.?\b|\//i.test(t)) return false;
  return /(^|\s)(spx|spy)\b/i.test(t) || /\bs&p\b|\bs&p ?500\b|\bsp ?500\b/i.test(t) || /^es\b/i.test(t);
}

/** The underlying's name the chips are suggested for. */
export function underlyingName(instrument: string): string {
  return onSpx(instrument) ? "S&P 500" : instrument.trim() || "the instrument";
}

/**
 * The levels at which the idea is wrong: for a long, the underlying falling
 * (below its averages, a 2σ drop, 3% or 5% under entry, a lower low); for a
 * short, the same rules turned over (a rally proves a short wrong). §9 lists
 * the long's eight; the short's are their mirror. The signal's own reversal
 * is offered only when a study was carried in.
 */
export function suggestions(instrument: string, t: TechnicalsResponse | undefined, signalWords: string | null, direction: "long" | "short" = "long"): { top: LevelChoice[]; more: LevelChoice[] } {
  const spx = onSpx(instrument) && t;
  const ma50 = spx && typeof t.ma50 === "number" ? ` (${grouped(t.ma50)})` : "";
  const ma200 = spx && typeof t.ma200 === "number" ? ` (${grouped(t.ma200)})` : "";
  const signal: LevelChoice[] = signalWords ? [{ id: "signal_reverses", label: `the signal reverses (${signalWords})` }] : [];
  if (direction === "short")
    return {
      top: [{ id: "above_50d", label: `closes above its 50-day${ma50}` }, { id: "rises_2s_5d", label: "rises 2σ over 5 days" }, ...signal],
      more: [
        { id: "above_200d", label: `closes above its 200-day${ma200}` },
        { id: "entry_plus_3", label: "rises 3% from entry" },
        { id: "entry_plus_5", label: "rises 5% from entry" },
        { id: "higher_high_20", label: "makes a higher high than the last 20 days" },
        { id: "rsi_above_60", label: "RSI rises above 60" },
        { id: "vix_below_15", label: "VIX closes below 15" },
        { id: "regime_changes", label: "the regime label changes" },
        { id: "hy_tighten_2s", label: "HY spreads tighten 2σ" },
      ],
    };
  return {
    top: [{ id: "below_50d", label: `closes below its 50-day${ma50}` }, { id: "falls_2s_5d", label: "falls 2σ over 5 days" }, ...signal],
    more: [
      { id: "below_200d", label: `closes below its 200-day${ma200}` },
      { id: "entry_minus_3", label: "falls 3% from entry" },
      { id: "entry_minus_5", label: "falls 5% from entry" },
      { id: "lower_low_20", label: "makes a lower low than the last 20 days" },
      { id: "rsi_below_40", label: "RSI falls below 40" },
      { id: "vix_above_25", label: "VIX closes above 25" },
      { id: "regime_changes", label: "the regime label changes" },
      { id: "hy_widen_2s", label: "HY spreads widen 2σ" },
    ],
  };
}
