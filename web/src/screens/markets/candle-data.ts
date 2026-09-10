/**
 * Pure candle preparation for lightweight-charts (2026-09-06). The time
 * encoding follows the DATA's interval, never the requested range: while a
 * coarser range is still loading, the chart may hold the previous range's
 * intraday bars, and encoding those as business days collapsed a day's
 * hourly bars onto one key — the library asserts and the ErrorBoundary ate
 * the whole Markets tab (independent visual review, P0-1). Bars are also
 * de-duplicated by time and sorted ascending so a payload anomaly degrades
 * to a thinner chart instead of a crash.
 */

import type { CandleBar, CandleRange } from "../../api/types";

export const INTRADAY_RANGES: ReadonlySet<CandleRange | string> = new Set(["1D", "5D", "1M"]);
export const INTRADAY_INTERVALS: ReadonlySet<string> = new Set(["1m", "5m", "15m", "30m", "1h"]);

export type ChartTime = number | string;

export interface PreparedCandle {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface PreparedVolume {
  time: ChartTime;
  value: number;
}

/** Sub-daily bars carry clock time; daily and coarser use business days. */
export function isIntraday(interval: string | undefined, range: CandleRange | string): boolean {
  if (interval) return INTRADAY_INTERVALS.has(interval);
  return INTRADAY_RANGES.has(range);
}

export function toChartTime(ts: string, intraday: boolean): ChartTime {
  return intraday ? Date.parse(ts) / 1000 : ts.slice(0, 10);
}

function compareTime(a: ChartTime, b: ChartTime): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

function dedupeSorted<T extends { time: ChartTime }>(rows: T[]): T[] {
  const byTime = new Map<ChartTime, T>();
  for (const r of rows) byTime.set(r.time, r); // last bar for a key wins
  return [...byTime.values()].sort((x, y) => compareTime(x.time, y.time));
}

export function prepareCandles(bars: CandleBar[], intraday: boolean): PreparedCandle[] {
  return dedupeSorted(
    bars
      .filter((b) => b.open != null && b.high != null && b.low != null && Number.isFinite(b.close))
      .map((b) => ({ time: toChartTime(b.ts, intraday), open: b.open as number, high: b.high as number, low: b.low as number, close: b.close })),
  );
}

export function prepareVolumes(bars: CandleBar[], intraday: boolean): PreparedVolume[] {
  return dedupeSorted(bars.filter((b) => b.volume != null && b.volume > 0).map((b) => ({ time: toChartTime(b.ts, intraday), value: b.volume as number })));
}
