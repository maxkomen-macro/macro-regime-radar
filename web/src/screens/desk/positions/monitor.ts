/**
 * What a stored position looks like on the monitor today (DESK_FRAME3_SPEC
 * §2, §9): room left from the served levels, the distance to the level, the
 * day of the horizon on XNYS. An automatic position reads its series now
 * (the S&P from `/technicals`, 2s10s from `/macro`) against the threshold
 * frozen at entry; a manual one has no room and says so. Pure.
 */

import type { MacroResponse, TechnicalsResponse } from "../data/types";
import { dayShort, grouped, isFiniteNumber, pctPlain, signed } from "../kit/format";
import { nyDate, sessionCount } from "./sessions";
import { signedDistance, type MonitoredSeries, type PositionRecord } from "./store";

/** A served level: its value and the date it was observed on. */
export interface Served {
  value: number;
  date: string;
}

/** Today's served levels for the two monitored series; null where the series is not served. */
export interface Levels {
  spx: (Served & { ma50: number | null; ma200: number | null }) | null;
  curve: Served | null;
}

export const SERIES_LABEL: Record<MonitoredSeries, string> = { spx: "S&P 500", curve_2s10s: "2s10s" };

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

export const servedFor = (levels: Levels, series: MonitoredSeries): Served | null => (series === "spx" ? levels.spx : levels.curve);

/** A value in its series' own unit: "6,280" for the S&P, "+38 bp" for 2s10s. */
export function levelWords(series: MonitoredSeries, v: number): string {
  return series === "spx" ? grouped(v) : `${signed(v, Number.isInteger(v) ? 0 : 1)} bp`;
}

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
  /** XNYS sessions from `entry_date` (the New York date of the save) through today, both counted, so an
   * entry on a session is day 1, a save after the close included (evaluation is at the close, §9); a save
   * on a weekend or holiday is day 0 until the next session opens. Null when the calendar does not reach. */
  day: number | null;
  record: PositionRecord;
}

export function positionName(p: Pick<PositionRecord, "direction" | "instrument">): string {
  return `${p.direction === "short" ? "Short" : "Long"} ${p.instrument.trim()}`;
}

export function viewOf(p: PositionRecord, levels: Levels, now: Date): PositionView {
  const base = { id: p.id, name: positionName(p), size_nav: p.size_nav, monitoring: p.monitoring, day: sessionCount(p.entry_date, nyDate(now)), record: p };
  const t = p.trigger;
  const served = t ? servedFor(levels, t.series) : null;
  if (p.monitoring !== "automatic" || !t || !served || !isFiniteNumber(p.original_room)) return { ...base, room_pct: null, to_level: null, now: p.monitoring === "automatic" ? served : null };
  const d = signedDistance(served.value, t);
  const toLevel = d > 0 ? (t.series === "spx" ? { value: (d / served.value) * 100, unit: "%" as const } : { value: d, unit: "bp" as const }) : null;
  return { ...base, room_pct: d / p.original_room, to_level: toLevel, now: served };
}

/** FALSIFIES AT: "2s10s below +38 bp · now +41 bp", or the typed rule for a manual row. */
export function falsifiesLine(v: PositionView): string {
  const t = v.record.trigger;
  if (v.monitoring !== "automatic" || !t) return v.record.wrong_if.label;
  const now = v.now ? ` · now ${levelWords(t.series, v.now.value)}` : " · now not served";
  return `${SERIES_LABEL[t.series]} ${t.operator} ${levelWords(t.series, t.threshold)}${now}`;
}

/** SIZE · HORIZON: "2% NAV · DV01 — · 14 of 20 trading days · opened Sep 2" (DV01 is null, §9). */
export function sizeLine(v: PositionView): string {
  const size = isFiniteNumber(v.size_nav) ? `${pctPlain(v.size_nav)} NAV` : "no size";
  const day = `${isFiniteNumber(v.day) ? v.day : "—"} of ${v.record.horizon_days} trading days`;
  const opened = dayShort(v.record.entry_date);
  return [size, "DV01 —", day, opened ? `opened ${opened}` : null].filter(Boolean).join(" · ");
}
