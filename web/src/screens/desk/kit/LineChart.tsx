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
  /** Small labels at points (the yield curve's values, a peak's name). With `avoid`, the label takes the
   * nearest place above or below its point where no line and no other label crosses it. */
  pointLabels?: { i: number; v: number; text: string; color?: string; dy?: number; anchor?: "start" | "middle" | "end"; avoid?: boolean }[];
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

type Box = { x0: number; x1: number; y0: number; y1: number };

/** Whether a line segment passes through a box. */
function segmentHits(b: Box, ax: number, ay: number, bx: number, by: number): boolean {
  const lo = Math.max(b.x0, Math.min(ax, bx));
  const hi = Math.min(b.x1, Math.max(ax, bx));
  if (lo > hi) return false;
  const at = (xx: number) => (ax === bx ? ay : ay + ((by - ay) * (xx - ax)) / (bx - ax));
  const ya = at(lo);
  const yb = at(hi);
  return Math.max(ya, yb) >= b.y0 && Math.min(ya, yb) <= b.y1;
}

/** The offsets a point label tries, nearest first: above, below, then further out on each side. */
export const LABEL_OFFSETS = [-8, 15, -20, 27, -32, 39];

/**
 * Where an `avoid` label goes: the first offset whose text box (a mono
 * 10.5 px run, 6.4 px a character) stays inside the plot and meets no line
 * segment and no label already placed; the first offset when none is free.
 */
export function placeLabel(px: number, py: number, text: string, anchor: "start" | "middle" | "end", lines: [number, number, number, number][], taken: Box[], plot: { top: number; bottom: number }, offsets = LABEL_OFFSETS): { dy: number; box: Box } {
  const w = text.length * 6.4;
  const x0 = anchor === "start" ? px : anchor === "end" ? px - w : px - w / 2;
  const boxAt = (dy: number): Box => ({ x0, x1: x0 + w, y0: py + dy - 8.5, y1: py + dy + 2 });
  for (const dy of offsets) {
    const b = boxAt(dy);
    if (b.y0 < plot.top - 6 || b.y1 > plot.bottom + 2) continue;
    if (lines.some(([ax, ay, bx, by]) => segmentHits(b, ax, ay, bx, by))) continue;
    if (taken.some((t) => t.x0 < b.x1 && b.x0 < t.x1 && t.y0 < b.y1 && b.y0 < t.y1)) continue;
    return { dy, box: b };
  }
  return { dy: offsets[0], box: boxAt(offsets[0]) };
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
  // The drawn lines as segments, for labels that keep clear of them.
  const lines: [number, number, number, number][] = [];
  if (pointLabels.some((p) => p.avoid))
    for (const s of series)
      s.values.forEach((v, i) => {
        const w = s.values[i + 1];
        if (v != null && w != null && Number.isFinite(v) && Number.isFinite(w)) lines.push([x(i), y(v), x(i + 1), y(w)]);
      });
  const taken: Box[] = [];
  const placed = pointLabels.map((p) => {
    if (!p.avoid) return p.dy ?? -8;
    const { dy, box } = placeLabel(x(p.i), y(p.v), p.text, p.anchor ?? "middle", lines, taken, { top: pad.t, bottom: pad.t + ph });
    taken.push(box);
    return dy;
  });

  return (
    <div ref={ref} className="dk-chart" style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {bands.map((b, k) => {
          const y1 = y(Math.min(hi, Math.max(b.from, b.to)));
          const y2 = y(Math.max(lo, Math.min(b.from, b.to)));
          // A label wider than the plot (about 6.1 px a character at 12 px) wraps at its " · ".
          const lines = b.label && b.label.length * 6.1 > pw - 16 && b.label.includes(" · ") ? b.label.split(" · ") : b.label ? [b.label] : [];
          const top = b.labelAt === "bottom" ? y2 - 8 - (lines.length - 1) * 13 : y1 + 15;
          return (
            <g key={`b${k}`}>
              <rect x={pad.l} y={y1} width={pw} height={Math.max(0, y2 - y1)} fill={b.fill} />
              {lines.length ? (
                <text className="dk-chart-band" x={pad.l + 8} y={top} style={b.labelColor ? { fill: b.labelColor } : undefined}>
                  {lines.length === 1
                    ? lines[0]
                    : lines.map((l, i) => (
                        <tspan key={i} x={pad.l + 8} dy={i === 0 ? 0 : 13}>
                          {i < lines.length - 1 ? `${l} ·` : l}
                        </tspan>
                      ))}
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
          <text key={`p${k}`} className="dk-chart-point" x={x(p.i)} y={y(p.v) + placed[k]} textAnchor={p.anchor ?? "middle"} style={p.color ? { fill: p.color } : undefined}>
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
