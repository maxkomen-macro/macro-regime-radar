/**
 * The Desk v2 line chart (DESK_FRAME3_SPEC §1.2, §3, §6, §7): plain SVG, the
 * container's width, a fixed height. Lines over an x index (one point per
 * served observation), horizontal grid at the y ticks, optional tinted y
 * bands with their labels (the correlation and breadth charts), a zero line,
 * each line labeled at its right end in its own color (labels pushed apart so
 * they never overlap), a white dot on the last point of the main line, and
 * point markers. Axis text is mono. Nothing here computes a statistic: every
 * point is a served value.
 */

import { useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface LineSeries {
  key: string;
  values: readonly (number | null)[];
  color: string;
  dash?: string;
  width?: number;
  /** Printed at the line's right end. */
  label?: string;
}

export interface YBand {
  from: number;
  to: number;
  fill: string;
  label?: string;
  labelColor?: string;
  /** Where the label sits inside the band. */
  labelAt?: "top" | "bottom";
}

export interface LineChartProps {
  ariaLabel: string;
  height: number;
  n: number;
  series: LineSeries[];
  yDomain: [number, number];
  yTicks: { v: number; text: string }[];
  xTicks?: { i: number; text: string }[];
  bands?: YBand[];
  zero?: boolean;
  /** The series whose last point gets the white dot (§3, §6, §7). */
  endDot?: string;
  /** Point markers; name what they mark in `ariaLabel`, the chart's one accessible name. */
  markers?: { i: number; v: number; color: string; r?: number }[];
  /** Small labels at points (the yield curve's values, a peak's name). */
  pointLabels?: { i: number; v: number; text: string; color?: string; dy?: number; anchor?: "start" | "middle" | "end" }[];
  pad?: { l: number; r: number; t: number; b: number };
  /** Draw horizontal grid lines at the y ticks. */
  grid?: boolean;
  /** Gray x-axis captions left and right under the plot ("a year ago" · "today"). */
  xEnds?: [string, string];
}

/** The width and height of a container, measured (fallbacks before layout and in tests). */
export function useBox<T extends HTMLElement>(fallbackW = 420, fallbackH = 200): [RefObject<T>, number, number] {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<[number, number]>([fallbackW, fallbackH]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBox([Math.round(r.width), Math.round(r.height)]);
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box[0], box[1]];
}

/** The width of a container, measured (a fallback before layout and in tests). */
export function useWidth<T extends HTMLElement>(fallback = 420): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const cw = el.getBoundingClientRect().width;
      if (cw > 0) setW(Math.round(cw));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Right-end labels pushed apart vertically so none overlap (14 px apart),
 * and kept above `bottom`: a run pushed past it moves back up as a block. */
export function spreadLabels(ys: number[], gap = 14, bottom = Infinity): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) if (order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  const over = order.length ? order[order.length - 1].y - bottom : 0;
  if (over > 0) for (const o of order) o.y -= over;
  const out = new Array<number>(ys.length);
  for (const o of order) out[o.i] = o.y;
  return out;
}

export default function LineChart(props: LineChartProps) {
  const { ariaLabel, height, n, series, yDomain, yTicks, xTicks = [], bands = [], zero = false, endDot, markers = [], pointLabels = [], grid = true, xEnds } = props;
  const pad = props.pad ?? { l: 44, r: 64, t: 10, b: 26 };
  const [ref, width] = useWidth<HTMLDivElement>();
  const [lo, hi] = yDomain;
  const pw = Math.max(10, width - pad.l - pad.r);
  const ph = Math.max(10, height - pad.t - pad.b);
  const x = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * pw);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * ph;
  const path = (vals: readonly (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  const lastOf = (vals: readonly (number | null)[]) => {
    for (let i = vals.length - 1; i >= 0; i--) if (vals[i] != null && Number.isFinite(vals[i] as number)) return { i, v: vals[i] as number };
    return null;
  };
  const ends = series.map((s) => lastOf(s.values));
  const labelYs = spreadLabels(
    ends.map((e) => (e ? y(e.v) : 0)),
    14,
    pad.t + ph,
  );
  const dot = endDot ? series.findIndex((s) => s.key === endDot) : -1;

  return (
    <div ref={ref} className="dk-chart" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {bands.map((b, k) => {
          const y1 = y(Math.min(hi, Math.max(b.from, b.to)));
          const y2 = y(Math.max(lo, Math.min(b.from, b.to)));
          return (
            <g key={`b${k}`}>
              <rect x={pad.l} y={y1} width={pw} height={Math.max(0, y2 - y1)} fill={b.fill} />
              {b.label ? (
                <text className="dk-chart-band" x={pad.l + 8} y={b.labelAt === "bottom" ? y2 - 8 : y1 + 15} fill={b.labelColor}>
                  {b.label}
                </text>
              ) : null}
            </g>
          );
        })}
        {grid
          ? yTicks.map((t) => <line key={`g${t.v}`} className="dk-chart-grid" x1={pad.l} x2={pad.l + pw} y1={y(t.v)} y2={y(t.v)} />)
          : null}
        {zero && lo < 0 && hi > 0 ? <line className="dk-chart-zero" x1={pad.l} x2={pad.l + pw} y1={y(0)} y2={y(0)} /> : null}
        {yTicks.map((t) => (
          <text key={`y${t.v}`} className="dk-chart-axis" x={pad.l - 8} y={y(t.v) + 4} textAnchor="end">
            {t.text}
          </text>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t.i}`} className="dk-chart-axis" x={x(t.i)} y={height - 6} textAnchor={t.i === 0 ? "start" : t.i >= n - 1 ? "end" : "middle"}>
            {t.text}
          </text>
        ))}
        {xEnds ? (
          <>
            <text className="dk-chart-axis" x={pad.l} y={height - 6} textAnchor="start">
              {xEnds[0]}
            </text>
            <text className="dk-chart-axis" x={pad.l + pw} y={height - 6} textAnchor="end">
              {xEnds[1]}
            </text>
          </>
        ) : null}
        {series.map((s) => (
          <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s, k) =>
          s.label && ends[k] ? (
            <text key={`l${s.key}`} className="dk-chart-end" x={x(ends[k]!.i) + 7} y={labelYs[k] + 4} fill={s.color}>
              {s.label}
            </text>
          ) : null,
        )}
        {pointLabels.map((p, k) => (
          <text key={`p${k}`} className="dk-chart-point" x={x(p.i)} y={y(p.v) + (p.dy ?? -8)} textAnchor={p.anchor ?? "middle"} fill={p.color}>
            {p.text}
          </text>
        ))}
        {markers.map((m, k) => (
          <circle key={`m${k}`} cx={x(m.i)} cy={y(m.v)} r={m.r ?? 4} fill={m.color} />
        ))}
        {dot >= 0 && ends[dot] ? <circle cx={x(ends[dot]!.i)} cy={y(ends[dot]!.v)} r={4.5} fill="#ffffff" /> : null}
      </svg>
    </div>
  );
}

/** Round ticks that enclose [lo, hi] with at most `max` values (the price
 * chart's 5,000 / 6,000 / 7,000, §3): the smallest 1/2/2.5/5 × 10^k step
 * whose floor-to-ceiling run has no more than `max` ticks. The chart's
 * domain is the first to the last tick. */
export function extentTicks(lo: number, hi: number, max = 3): number[] {
  const span = Math.max(hi - lo, Math.abs(hi) * 1e-6, 1e-9);
  const p0 = 10 ** Math.floor(Math.log10(span / max));
  for (const p of [p0, p0 * 10, p0 * 100]) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * p;
      const a = Math.floor(lo / step) * step;
      const b = Math.ceil(hi / step) * step;
      const n = Math.round((b - a) / step) + 1;
      if (n <= max) return Array.from({ length: n }, (_, i) => Number((a + i * step).toFixed(10)));
    }
  }
  return [lo, hi];
}

/** Nice round y ticks covering [lo, hi]: 3–5 values on a 1/2/2.5/5 × 10^k step. */
export function niceTicks(lo: number, hi: number, target = 4): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => span / s <= target + 0.5) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}
