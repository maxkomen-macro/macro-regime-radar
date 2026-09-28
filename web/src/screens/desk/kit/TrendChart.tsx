/**
 * A level with its two trend lines (DESK_FRAME3_SPEC §3): the close in blue,
 * the 50-day average green dashed, the 200-day gray dashed, each labelled at
 * its right end, a white dot on the last close, and the crosses as points on
 * the 50-day line (green golden, red death). Technicals draws the S&P 500 with
 * it and Basket & Hedge the basket's index (desk/books), so the two read as
 * one product. With the range chips (6M / 1Y / 3Y) and the month ticks both
 * pages share. Every point is a served value.
 */

import LineChart, { extentTicks } from "./LineChart";
import { cx } from "./ui";
import { dayLong, grouped } from "./format";
import { DESK_ACCENTS } from "./palette";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Up to three x labels ("Oct 25", "Apr 26", "Sep 26"): the first new month, a middle one, the last; never the same month twice. */
export function monthTicks(dates: readonly string[]): { i: number; text: string }[] {
  if (dates.length < 2) return [];
  const label = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(2, 4)}`;
  const firstNew = dates.findIndex((d, i) => i > 0 && d.slice(0, 7) !== dates[i - 1].slice(0, 7));
  const a = firstNew > 0 ? firstNew : 0;
  const last = dates.length - 1;
  const mid = Math.round((a + last) / 2);
  const midMonth = dates.findIndex((d, i) => i >= mid && i > 0 && d.slice(0, 7) !== dates[i - 1].slice(0, 7));
  const m = midMonth > 0 ? midMonth : mid;
  const out: { i: number; text: string }[] = [];
  for (const i of [a, m, last]) if (!out.some((t) => t.text === label(dates[i]))) out.push({ i, text: label(dates[i]) });
  return out;
}

/** The range chips (§3: 6M / 1Y / 3Y), one pressed. */
export function RangeChips<R extends string>({ ranges, value, onChange, className }: { ranges: readonly R[]; value: R; onChange: (r: R) => void; className?: string }) {
  return (
    <div className={cx("dk-range", className)} role="group" aria-label="Range">
      {ranges.map((r) => (
        <button key={r} type="button" aria-pressed={value === r} onClick={() => onChange(r)}>
          {r.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export interface TrendPoint {
  date: string;
  close: number | null;
  ma50: number | null;
  ma200: number | null;
}

/** Whether a point list has a line to draw: two served closes at least. */
export const drawable = (pts: readonly TrendPoint[]): boolean => pts.filter((p) => fin(p.close)).length > 1;

/**
 * The chart. `crosses` are the served crosses to mark (a date off the range is
 * left out); `ariaLabel` names the chart and what it marks; `mainLabel` is the
 * close's end label ("S&P 500", "Basket"); `ticks` the y ticks to aim for.
 */
export default function TrendChart({
  points,
  ariaLabel,
  mainLabel,
  crosses = [],
  height = 230,
  ticks: maxTicks = 3,
  tickText,
}: {
  points: readonly TrendPoint[];
  ariaLabel: string;
  mainLabel: string;
  crosses?: readonly { kind: "golden" | "death"; date: string }[];
  height?: number;
  ticks?: number;
  /** An axis tick's words, given the ticks (Codex R-02: a stock's axis carries the decimals its step needs); whole numbers when absent. */
  tickText?: (v: number, ticks: readonly number[]) => string;
}) {
  const all = points.flatMap((p) => [p.close, p.ma50, p.ma200]).filter(fin);
  const lo = all.length ? Math.min(...all) : 0;
  const hi = all.length ? Math.max(...all) : 1;
  const ticks = extentTicks(lo, hi, maxTicks);
  const marks = crosses
    .map((c) => ({ c, i: points.findIndex((p) => p.date === c.date) }))
    .filter(({ i }) => i >= 0 && fin(points[i].ma50))
    .map(({ c, i }) => ({ i, v: points[i].ma50 as number, color: c.kind === "death" ? DESK_ACCENTS.red : DESK_ACCENTS.green, r: 5 }));
  const named = crosses.filter((c) => points.some((p) => p.date === c.date));
  return (
    <LineChart
      ariaLabel={`${ariaLabel}${named.length ? `; ${named.map((c) => `${c.kind} cross on ${dayLong(c.date)}`).join(", ")}` : ""}`}
      height={height}
      n={points.length}
      yDomain={[ticks[0], ticks[ticks.length - 1]]}
      yTicks={ticks.map((v) => ({ v, text: tickText ? tickText(v, ticks) : grouped(v) }))}
      xTicks={monthTicks(points.map((p) => p.date))}
      series={[
        { key: "ma200", values: points.map((p) => (fin(p.ma200) ? p.ma200 : null)), color: DESK_ACCENTS.gray, dash: "4 4", width: 2, label: "200-day" },
        { key: "ma50", values: points.map((p) => (fin(p.ma50) ? p.ma50 : null)), color: DESK_ACCENTS.green, dash: "4 4", width: 2, label: "50-day" },
        { key: "close", values: points.map((p) => (fin(p.close) ? p.close : null)), color: DESK_ACCENTS.blue, width: 2.5, label: mainLabel },
      ]}
      endDot="close"
      markers={marks}
      pad={{ l: 46, r: 70, t: 12, b: 26 }}
    />
  );
}
