/**
 * WRONG IF suggestions (DESK_FRAME3_SPEC §9): named rules for the
 * instrument, three chips and more in a list. A level carries a number only
 * for a subject the Desk serves: the S&P against `/technicals` `ma50` and
 * `ma200` (every field there describes the registry series `spx`, §12.7; an
 * instrument is the S&P only by its exact name, never SPY or an ES future or
 * an SPX option, Codex R-08), and 2s10s against `/macro` `curve.2s10s_bp`.
 * Only the S&P's 50-day and the 2s10s levels are monitored automatically
 * (v3 §16, v4 B-10), and never for a basket; every other rule is saved as
 * manual and closed by hand. Pure.
 */

import type { TechnicalsResponse } from "../data/types";
import { grouped, isFiniteNumber } from "../kit/format";
import { levelWords, SERIES_LABEL, servedFor, type Levels } from "./monitor";
import { AUTOMATIC_LEVELS, monitoredSeriesOf, signedDistance, type MonitoredSeries, type Operator, type Subject } from "./store";

export interface LevelChoice {
  id: string;
  label: string;
}

/** Whether the instrument is exactly the S&P (§12.7's `spx`, by its name), never one that only
 * resembles it: SPY trades near a tenth of the index, so the index's 6,280 is not its level. */
export const describes = (instrument: string) => monitoredSeriesOf(instrument) === "spx";

/** Whether the instrument is the 2s10s curve itself, by its name or its registry id. */
export const isCurve = (instrument: string) => monitoredSeriesOf(instrument) === "curve_2s10s";

/** The underlying's name the chips are suggested for: the series' own name when it is one. */
export function underlyingName(instrument: string): string {
  const s = monitoredSeriesOf(instrument);
  return s ? SERIES_LABEL[s] : instrument.trim() || "the instrument";
}

/** The series a typed instrument monitors automatically, or null for any other instrument. */
export const seriesOf = monitoredSeriesOf;

/** The bp moves the 2s10s chips offer, from the level at entry. */
const CURVE_STEPS = [10, 25];

function curveChoices(levels: Levels, direction: "long" | "short"): LevelChoice[] {
  const now = levels.curve?.value;
  return CURVE_STEPS.map((n) => {
    const down = direction === "long";
    const at = isFiniteNumber(now) ? ` (${down ? "below" : "above"} ${levelWords("curve_2s10s", down ? now - n : now + n)})` : "";
    return { id: `curve_${down ? "down" : "up"}_${n}`, label: `${down ? "falls" : "rises"} ${n} bp from entry${at}` };
  });
}

/**
 * The levels at which the idea is wrong: for a long, the underlying falling
 * (below its averages, a 2σ drop, 3% or 5% under entry, a lower low); for a
 * short, the same rules turned over (a rally proves a short wrong). 2s10s
 * gets bp moves from entry in place of the price rules. The signal's own
 * reversal is offered only when a study was carried in.
 */
export function suggestions(instrument: string, t: Pick<TechnicalsResponse, "ma50" | "ma200"> | undefined, signalWords: string | null, direction: "long" | "short" = "long", levels?: Levels): { top: LevelChoice[]; more: LevelChoice[] } {
  const signal: LevelChoice[] = signalWords ? [{ id: "signal_reverses", label: `the signal reverses (${signalWords})` }] : [];
  if (isCurve(instrument)) {
    const regime = { id: "regime_changes", label: "the regime label changes" };
    const hy = direction === "short" ? { id: "hy_tighten_2s", label: "HY spreads tighten 2σ" } : { id: "hy_widen_2s", label: "HY spreads widen 2σ" };
    return { top: [...curveChoices(levels ?? { spx: null, curve: null }, direction), ...signal], more: [regime, hy] };
  }
  const same = describes(instrument) && t;
  const ma50 = same && isFiniteNumber(t.ma50) ? ` (${grouped(t.ma50)})` : "";
  const ma200 = same && isFiniteNumber(t.ma200) ? ` (${grouped(t.ma200)})` : "";
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

/** How a position will be monitored, decided at Save (B-10). */
export type Plan =
  | { kind: "manual" }
  | { kind: "automatic"; series: MonitoredSeries; operator: Operator; threshold: number; entry_value: number; observed_on: string; original_room: number }
  /** The level monitors automatically but its series is not served now: nothing can be recorded at entry. */
  | { kind: "not_served"; series: MonitoredSeries }
  /** Already through the level at entry: room zero or negative, refused (B-10), never saved as manual. */
  | { kind: "through"; series: MonitoredSeries; operator: Operator; threshold: number; entry_value: number };

/** The plan for a picked level: automatic only when the instrument is the monitored series, the level is
 * its 50-day or a 2s10s bp level, and the subject is not a basket (§9: a basket is an unserved subject). */
export function planFor(levelId: string | null, instrument: string, levels: Levels, subject: Subject["kind"] = "instrument"): Plan {
  const rule = levelId ? AUTOMATIC_LEVELS[levelId] : undefined;
  if (!rule || subject === "basket" || seriesOf(instrument) !== rule.series) return { kind: "manual" };
  const served = servedFor(levels, rule.series);
  let threshold: number | null = null;
  if (served && rule.series === "spx") threshold = levels.spx?.ma50 ?? null;
  if (served && rule.series === "curve_2s10s") {
    const n = Number(levelId?.split("_").pop());
    threshold = rule.operator === "below" ? served.value - n : served.value + n;
  }
  if (!served || !isFiniteNumber(threshold)) return { kind: "not_served", series: rule.series };
  const room = signedDistance(served.value, { operator: rule.operator, threshold });
  if (!(room > 0)) return { kind: "through", series: rule.series, operator: rule.operator, threshold, entry_value: served.value };
  return { kind: "automatic", series: rule.series, operator: rule.operator, threshold, entry_value: served.value, observed_on: served.date, original_room: room };
}

/** The sentence Save answers when a plan cannot be saved (B-10: refused, never saved as manual). */
export function planRefusal(p: Plan): string | null {
  if (p.kind === "not_served") return `The ${SERIES_LABEL[p.series]} level is not served right now, so the room at entry cannot be recorded. Nothing was saved.`;
  if (p.kind === "through")
    return `The ${SERIES_LABEL[p.series]} is at ${levelWords(p.series, p.entry_value)}, already ${p.operator} ${levelWords(p.series, p.threshold)}, so there is no room to monitor. Pick another level; nothing was saved.`;
  return null;
}
