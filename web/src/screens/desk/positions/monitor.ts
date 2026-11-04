/**
 * What a stored position looks like on the monitor today (DESK_FRAME3_SPEC
 * §2, §9): room left from the served levels, the distance to the level, the
 * day of the horizon on XNYS. An automatic position reads its series now
 * against the threshold frozen at entry: the S&P from `/technicals`, a
 * stored ETF from `/technicals?symbol=` (its stored closes only), 2s10s from
 * `/macro`'s served spread, and any other tenor's yield or spread from
 * `/macro`'s curve (P1c). A manual one has no room and says so. Pure.
 */

import type { MacroResponse, TechnicalsResponse } from "../data/types";
import { dayShort, grouped, isFiniteNumber, num, pctPlain, priceText, signed } from "../kit/format";
import { nyDate, sessionCount } from "./sessions";
import { parseSeries, signedDistance, TENORS, type MonitoredSeries, type PositionRecord, type Tenor, type Trigger } from "./store";

/** A served level: its value and the date it was observed on. */
export interface Served {
  value: number;
  date: string;
}

/** A stored ETF's newest close with its averages, and every close the served three years hold, by date
 * (the closes the entry level is checked against, since stored closes are restated, P1c). */
export interface EtfLevel extends Served {
  ma50: number | null;
  ma200: number | null;
  closes: Readonly<Record<string, number>>;
}

/** Today's served levels for the monitored series; null (or absent) where a series is not served. */
export interface Levels {
  spx: (Served & { ma50: number | null; ma200: number | null }) | null;
  curve: Served | null;
  /** P1c: each tenor's yield (percent) with its date; absent when `/macro` was not read. */
  tenors?: Partial<Record<Tenor, Served>>;
  /** P1c: the stored ETFs asked for, by symbol; a symbol whose answer is not its stored closes is absent. */
  etfs?: Readonly<Record<string, EtfLevel>>;
  /** P1c: the `/instruments` ETFs (the stored ones); null while that list is not served (stored or not cannot be told). */
  stored?: readonly string[] | null;
}

/** The series' name on screen: "S&P 500", "QQQ", "10y yield", "5s30s". */
export function seriesLabel(series: MonitoredSeries): string {
  const r = parseSeries(series);
  if (!r) return series;
  if (r.kind === "spx") return "S&P 500";
  if (r.kind === "etf") return r.symbol;
  if (r.kind === "yield") return `${r.tenor} yield`;
  return r.name;
}

/** The levels from `/technicals` (every field describes `spx`, §12.7) and `/macro`'s curve (§12.8). */
export function levelsFrom(t: TechnicalsResponse | undefined, m: MacroResponse | undefined): Levels {
  const c = m?.curve;
  const bp = c?.["2s10s_bp"];
  // §12.8: the snapshot's shared date, or null with per-tenor dates; 2s10s is dated when its two tenors agree.
  const dates = c?.today?.dates;
  const curveDate = c?.today?.date ?? (dates && dates["2y"] && dates["2y"] === dates["10y"] ? dates["2y"] : undefined);
  return {
    spx: t && isFiniteNumber(t.price) && typeof t.date === "string" ? { value: t.price, date: t.date, ma50: isFiniteNumber(t.ma50) ? t.ma50 : null, ma200: isFiniteNumber(t.ma200) ? t.ma200 : null } : null,
    curve: isFiniteNumber(bp) && typeof curveDate === "string" ? { value: bp, date: curveDate } : null,
  };
}

/** P1c: each tenor of `/macro`'s `curve.today` with its date, the snapshot's shared one or, without it, the
 * tenor's own (§12.8, S-24); a tenor not stored, or served without a date, is left out. */
export function tenorsFrom(m: MacroResponse | undefined): Partial<Record<Tenor, Served>> {
  const today = m?.curve?.today;
  const out: Partial<Record<Tenor, Served>> = {};
  if (!today) return out;
  for (const t of TENORS) {
    const v = today[t];
    const date = today.date ?? today.dates?.[t];
    if (isFiniteNumber(v) && typeof date === "string") out[t] = { value: v, date };
  }
  return out;
}

/** P1c: a stored ETF's level from its `/technicals?symbol=` answer, only when the answer is that symbol read
 * from its stored closes (`source` "asset_prices <SYM>"); the provider's candles are not a stored instrument. */
export function etfLevelFrom(symbol: string, t: TechnicalsResponse | undefined): EtfLevel | null {
  if (!t || t.symbol !== symbol || t.source !== `asset_prices ${symbol}` || !isFiniteNumber(t.price) || typeof t.date !== "string") return null;
  const closes: Record<string, number> = {};
  for (const p of t.series?.["3y"] ?? []) if (p && typeof p.date === "string" && isFiniteNumber(p.close)) closes[p.date] = p.close;
  return { value: t.price, date: t.date, ma50: isFiniteNumber(t.ma50) ? t.ma50 : null, ma200: isFiniteNumber(t.ma200) ? t.ma200 : null, closes };
}

/** The series' value now, or null where it is not served. A spread other than 2s10s (served as `2s10s_bp`) is
 * the long tenor less the short, in bp, only when both are served on the same date: never two dates mixed. */
export function servedFor(levels: Levels, series: MonitoredSeries): Served | null {
  const r = parseSeries(series);
  if (!r) return null;
  if (r.kind === "spx") return levels.spx;
  if (r.kind === "etf") return levels.etfs?.[r.symbol] ?? null;
  if (r.kind === "yield") return levels.tenors?.[r.tenor] ?? null;
  if (r.short === "2y" && r.long === "10y") return levels.curve;
  const a = levels.tenors?.[r.short];
  const b = levels.tenors?.[r.long];
  // FRED serves yields to two decimals, so a spread is whole bp; the rounding (to a millionth of a bp) only
  // removes the float noise of the subtraction, as 4.96 − 4.71 = 0.2500000000000004.
  return a && b && a.date === b.date ? { value: bpRound((b.value - a.value) * 100), date: a.date } : null;
}

/** A value in its series' own unit: "6,280" for the S&P, "512.30" for an ETF, "4.86%" for a yield, "+38 bp" for a spread. */
export function levelWords(series: MonitoredSeries, v: number): string {
  const r = parseSeries(series);
  if (r?.kind === "spx") return grouped(v);
  if (r?.kind === "etf") return priceText(v);
  if (r?.kind === "yield") return `${num(v, 2)}%`;
  return `${signed(v, Number.isInteger(v) ? 0 : 1)} bp`;
}

/** The distance left in the unit the row prints: percent of the level now for a price, bp for a rate (a yield
 * is served in percent, so its distance is ×100). */
function toLevelOf(series: MonitoredSeries, d: number, now: number): { value: number; unit: "%" | "bp" } {
  const r = parseSeries(series);
  if (r?.kind === "spx" || r?.kind === "etf") return { value: (d / now) * 100, unit: "%" };
  return { value: r?.kind === "yield" ? bpRound(d * 100) : d, unit: "bp" };
}

/** A bp figure to a millionth of a bp: the float noise of percent arithmetic, never a served digit. */
const bpRound = (x: number) => Math.round(x * 1e6) / 1e6;

export interface PositionView {
  id: string;
  /** "Long NDX vs SPX": the direction and the instrument as saved. */
  name: string;
  size_nav: number | null;
  monitoring: "automatic" | "manual";
  /** Distance now over the room at entry; ≤ 0 once through the level; null for a manual row or a series not served now. */
  room_pct: number | null;
  /** The distance left, in the series' unit (percent of the level now for the S&P, bp for 2s10s); null when not computed. */
  to_level: { value: number; unit: "%" | "bp" } | null;
  /** The series now, for FALSIFIES AT; null for a manual row or a series not served now. */
  now: Served | null;
  /** The level the room is measured to now: the frozen threshold, restated with a stored ETF's closes (P1c); null when no room is computed. */
  level_now: number | null;
  /** Why the room is not computed, or how its level was restated; null when there is nothing to say. */
  note: string | null;
  /** XNYS sessions from `entry_date` (the New York date of the save) through today, both counted, so an
   * entry on a session is day 1, a save after the close included (evaluation is at the close, §9); a save
   * on a weekend or holiday is day 0 until the next session opens. Null when the calendar does not reach. */
  day: number | null;
  record: PositionRecord;
}

export function positionName(p: Pick<PositionRecord, "direction" | "instrument">): string {
  return `${p.direction === "short" ? "Short" : "Long"} ${p.instrument.trim()}`;
}

/**
 * The level a stored ETF position is checked against now (P1c). Stored ETF closes are split- and
 * dividend-adjusted and restated through history on every refresh, so the frozen level is restated with
 * them: f = the close on `observed_on` as served now ÷ `entry_value` (the same close at entry). Null, with
 * the reason, when that close is not among the served closes: no room is shown that cannot be checked.
 */
export function restatement(t: Trigger, entryValue: number, etf: EtfLevel): { factor: number } | { why: string } {
  const close = etf.closes[t.observed_on];
  if (!isFiniteNumber(close)) return { why: `the stored close of ${t.observed_on} is not served, so the level cannot be checked against today's closes` };
  // A price is positive: a record (an import) whose entry value is not, or a factor that does not come out a
  // finite positive number, is not restated into a room (design review DR-03).
  const factor = close / entryValue;
  if (!(entryValue > 0) || !(close > 0) || !Number.isFinite(factor) || !(factor > 0)) return { why: "the value at entry and the stored close of that day do not give a usable restatement" };
  return { factor };
}

export function viewOf(p: PositionRecord, levels: Levels, now: Date): PositionView {
  const base = { id: p.id, name: positionName(p), size_nav: p.size_nav, monitoring: p.monitoring, day: sessionCount(p.entry_date, nyDate(now)), record: p, level_now: null, note: null };
  const t = p.trigger;
  const served = t ? servedFor(levels, t.series) : null;
  if (p.monitoring !== "automatic" || !t || !served || !isFiniteNumber(p.original_room)) return { ...base, room_pct: null, to_level: null, now: p.monitoring === "automatic" ? served : null };
  let threshold = t.threshold;
  let room = p.original_room;
  let note: string | null = null;
  const ref = parseSeries(t.series);
  if (ref?.kind === "etf") {
    const r = isFiniteNumber(p.entry_value) ? restatement(t, p.entry_value, levels.etfs![ref.symbol]) : { why: "the record has no value at entry" };
    if ("why" in r) return { ...base, room_pct: null, to_level: null, now: served, note: `Room not computed: ${r.why}.` };
    threshold = t.threshold * r.factor;
    room = p.original_room * r.factor;
    if (!Number.isFinite(threshold) || !Number.isFinite(room) || !(room > 0)) return { ...base, room_pct: null, to_level: null, now: served, note: "Room not computed: the restated level is not a usable number." };
    if (Math.abs(r.factor - 1) > 1e-6) note = `The level was ${levelWords(t.series, t.threshold)} at entry; the stored closes have been restated ×${num(r.factor, 4)} since (a distribution or a split), and the level with them.`;
  }
  const d = signedDistance(served.value, { operator: t.operator, threshold });
  const toLevel = d > 0 ? toLevelOf(t.series, d, served.value) : null;
  return { ...base, room_pct: d / room, to_level: toLevel, now: served, level_now: threshold, note };
}

/** FALSIFIES AT: "2s10s below +38 bp · now +41 bp", or the typed rule for a manual row. */
export function falsifiesLine(v: PositionView): string {
  const t = v.record.trigger;
  if (v.monitoring !== "automatic" || !t) return v.record.wrong_if.label;
  // P1c (design review DR-04): a series P1c added says the date of the value it calls now; the S&P and 2s10s
  // lines keep §9's words.
  const dated = t.series !== "spx" && t.series !== "curve_2s10s" && v.now ? ` on ${dayShort(v.now.date) || v.now.date}` : "";
  const now = v.now ? ` · now ${levelWords(t.series, v.now.value)}${dated}` : " · now not served";
  return `${seriesLabel(t.series)} ${t.operator} ${levelWords(t.series, v.level_now ?? t.threshold)}${now}`;
}

/** SIZE · HORIZON: "2% NAV · DV01 — · 14 of 20 trading days · opened Sep 2" (DV01 is null, §9). */
export function sizeLine(v: PositionView): string {
  const size = isFiniteNumber(v.size_nav) ? `${pctPlain(v.size_nav)} NAV` : "no size";
  const day = `${isFiniteNumber(v.day) ? v.day : "—"} of ${v.record.horizon_days} trading days`;
  const opened = dayShort(v.record.entry_date);
  return [size, "DV01 —", day, opened ? `opened ${opened}` : null].filter(Boolean).join(" · ");
}
