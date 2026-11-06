/**
 * WRONG IF suggestions (DESK_FRAME3_SPEC §9): named rules for the
 * instrument, three chips and more in a list. A level carries a number only
 * for a subject the Desk serves: the S&P against `/technicals` `ma50` and
 * `ma200` (every field there describes the registry series `spx`, §12.7; an
 * instrument is the S&P only by its exact name, never SPY or an ES future or
 * an SPX option, Codex R-08); a stored ETF against its own stored averages
 * (`/technicals?symbol=`, P1c); 2s10s against `/macro` `curve.2s10s_bp`, and
 * any other tenor's yield or spread against `/macro`'s curve (P1c). Only the
 * 50-day (S&P, stored ETF) and the bp moves from entry (yield, spread) are
 * monitored automatically (v3 §16, v4 B-10), and never for a basket; every
 * other rule is saved as manual and closed by hand. Pure.
 */

import type { TechnicalsResponse } from "../data/types";
import { grouped, isFiniteNumber, priceText } from "../kit/format";
import { levelWords, seriesLabel, servedFor, type Levels } from "./monitor";
import { AUTOMATIC_LEVELS, familyOf, monitoredSeriesOf, namedSeriesOf, parseSeries, signedDistance, type MonitoredSeries, type Operator, type Subject } from "./store";

export interface LevelChoice {
  id: string;
  label: string;
}

/** Whether the instrument is exactly the S&P (§12.7's `spx`, by its name), never one that only
 * resembles it: SPY trades near a tenth of the index, so the index's 6,280 is not its level. */
export const describes = (instrument: string) => monitoredSeriesOf(instrument) === "spx";

/** Whether the instrument is a rate the curve serves: a tenor's yield or a spread between two tenors (2s10s among them). */
export const isCurve = (instrument: string) => {
  const s = namedSeriesOf(instrument);
  return !!s && familyOf(s) === "rate";
};

/** The underlying's name the chips are suggested for: the series' own name when it is a named one. */
export function underlyingName(instrument: string): string {
  const s = namedSeriesOf(instrument);
  return s ? seriesLabel(s) : instrument.trim() || "the instrument";
}

/** The series a typed instrument would be monitored on (a stored ETF is checked at Save), or null. */
export const seriesOf = monitoredSeriesOf;

/** The ETF a typed ticker names, when `/instruments` lists it as stored; null otherwise (or while the list is not served). */
export function storedEtf(instrument: string, levels: Levels | undefined): string | null {
  const r = parseSeries(monitoredSeriesOf(instrument));
  return r?.kind === "etf" && levels?.stored?.includes(r.symbol) ? r.symbol : null;
}

/** Whether a long in this instrument is long a yield (P1c: the yield itself, so it gains as the yield rises). */
export const isYield = (instrument: string) => parseSeries(namedSeriesOf(instrument))?.kind === "yield";

/** The bp moves the rate chips offer, from the level at entry. */
const CURVE_STEPS = [10, 25];

/** A bp move in the series' own unit: a yield is served in percent, a spread in bp. */
const step = (series: MonitoredSeries, bp: number) => (parseSeries(series)?.kind === "yield" ? bp / 100 : bp);

function curveChoices(series: MonitoredSeries, levels: Levels, direction: "long" | "short"): LevelChoice[] {
  const now = servedFor(levels, series)?.value;
  return CURVE_STEPS.map((n) => {
    const down = direction === "long";
    const at = isFiniteNumber(now) ? ` (${down ? "below" : "above"} ${levelWords(series, down ? now - step(series, n) : now + step(series, n))})` : "";
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
  const named = namedSeriesOf(instrument);
  if (named && isCurve(instrument)) {
    const regime = { id: "regime_changes", label: "the regime label changes" };
    const hy = direction === "short" ? { id: "hy_tighten_2s", label: "HY spreads tighten 2σ" } : { id: "hy_widen_2s", label: "HY spreads widen 2σ" };
    return { top: [...curveChoices(named, levels ?? { spx: null, curve: null }, direction), ...signal], more: [regime, hy] };
  }
  const same = describes(instrument) && t;
  // P1c: a stored ETF's own averages, read from its stored closes; never the index's.
  const etf = storedEtf(instrument, levels);
  const own = etf ? levels?.etfs?.[etf] : undefined;
  const avg = (x: number | null | undefined, index: boolean) => (isFiniteNumber(x) ? ` (${index ? grouped(x) : priceText(x)})` : "");
  const ma50 = same ? avg(t.ma50, true) : avg(own?.ma50, false);
  const ma200 = same ? avg(t.ma200, true) : avg(own?.ma200, false);
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
  /** P1c: a ticker with a 50-day level while `/instruments` is not served, so whether it is a stored ETF cannot be told. */
  | { kind: "unchecked"; series: MonitoredSeries }
  /** Already through the level at entry: room zero or negative, refused (B-10), never saved as manual. */
  | { kind: "through"; series: MonitoredSeries; operator: Operator; threshold: number; entry_value: number };

/** The plan for a picked level: automatic only when the instrument is a monitored series of the level's family
 * (a 50-day for the S&P or a stored ETF, a bp move for a yield or a spread), and the subject is not a basket
 * or an option (§9: a basket is an unserved subject). A ticker `/instruments` does not list is manual. */
export function planFor(levelId: string | null, instrument: string, levels: Levels, subject: Subject["kind"] = "instrument"): Plan {
  const rule = levelId ? AUTOMATIC_LEVELS[levelId] : undefined;
  const series = monitoredSeriesOf(instrument);
  if (!rule || subject === "basket" || subject === "option" || !series || familyOf(series) !== rule.family) return { kind: "manual" };
  const ref = parseSeries(series);
  if (ref?.kind === "etf") {
    if (!Array.isArray(levels.stored)) return { kind: "unchecked", series };
    if (!levels.stored.includes(ref.symbol)) return { kind: "manual" };
  }
  const served = servedFor(levels, series);
  let threshold: number | null = null;
  if (served && ref?.kind === "spx") threshold = levels.spx?.ma50 ?? null;
  if (served && ref?.kind === "etf") threshold = levels.etfs?.[ref.symbol]?.ma50 ?? null;
  if (served && rule.family === "rate") {
    const n = step(series, Number(levelId?.split("_").pop()));
    threshold = rule.operator === "below" ? served.value - n : served.value + n;
  }
  if (!served || !isFiniteNumber(threshold)) return { kind: "not_served", series };
  const room = signedDistance(served.value, { operator: rule.operator, threshold });
  if (!(room > 0)) return { kind: "through", series, operator: rule.operator, threshold, entry_value: served.value };
  return { kind: "automatic", series, operator: rule.operator, threshold, entry_value: served.value, observed_on: served.date, original_room: room };
}

/** The sentence Save answers when a plan cannot be saved (B-10: refused, never saved as manual). */
export function planRefusal(p: Plan): string | null {
  if (p.kind === "not_served") return `The ${seriesLabel(p.series)} level is not served right now, so the room at entry cannot be recorded. Nothing was saved.`;
  if (p.kind === "unchecked")
    return `The list of stored instruments is not served right now, so whether ${seriesLabel(p.series)}'s 50-day can be monitored cannot be checked. Try again, or pick another level; nothing was saved.`;
  if (p.kind === "through")
    return `The ${seriesLabel(p.series)} is at ${levelWords(p.series, p.entry_value)}, already ${p.operator} ${levelWords(p.series, p.threshold)}, so there is no room to monitor. Pick another level; nothing was saved.`;
  return null;
}
