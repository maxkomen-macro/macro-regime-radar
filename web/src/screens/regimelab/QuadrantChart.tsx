/**
 * QuadrantChart: the Regime Lab hero's signature chart (redesign Phase 4,
 * checklist 04 B.1.1). A growth-vs-inflation plane with four tinted quadrants
 * in the regime hues, a dashed 12-month trail of fading dots through the
 * stored trend inputs, and a glowing dot for the current month.
 *
 * The dot is the input, the tint is the output: the trail plots the served
 * `growth_trend` / `inflation_trend` of each month, while the tinted quadrant
 * follows the served current label, never the sign of the trends (G18).
 * Geometry is the mockup's (line 178) at its 400×330 fallback: plot 34..366 ×
 * 20..298, origin at (200, 159). Scale is symmetric over the points so the
 * origin stays centred and a quiet month does not zoom the chart.
 *
 * Iteration 1 (R1): drawn through HeroChartFrame at the hero column's own
 * size, 1:1, so it fills the column at every width (the plot keeps the
 * mockup's margins and grows between them) and its words keep their set size;
 * the height follows the width (0.825 of it, 250 to 400 px) and may grow to
 * 1.3× the width, 520 px at most, when the hero row is taller.
 */

import type { CSSProperties } from "react";
import type { Regime } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { HeroChartFrame, clampPx } from "../shared/HeroChart";
import { monoNoteStyle } from "../shared/screen-ui";
import { REGIME_HUE, regimeHue, type RegimeName, type TrailPoint } from "./regime-history";

export interface QuadrantChartProps {
  /** `trailPoints(rows, 12)`: date order, oldest first. */
  points: TrailPoint[];
  /** The latest regime row: its label tints the quadrant; its trends place
   * the current dot (appended when the trail does not already end there). */
  current?: Regime | null;
}

/** Plot margins: the rotated axis word on the left, the axis words below. */
const PAD_L = 34;
const PAD_R = 34;
const PAD_T = 20;
const PAD_B = 32;
/** The mockup frame: the unit tests pin this geometry. */
const FALLBACK = { w: 400, h: 330 };
const minHeight = (w: number) => clampPx(w * 0.825, 250, 400);
const maxHeight = (w: number) => clampPx(w * 1.3, 250, 520);
/** The "Trend inputs not stored" line under the plane. */
const NOTE_H = 24;

/** Top-right Overheating, top-left Stagflation, bottom-left Recession Risk,
 * bottom-right Goldilocks (names at the outer corners). */
const QUADRANTS: { label: RegimeName; right: boolean; top: boolean }[] = [
  { label: "Overheating", right: true, top: true },
  { label: "Stagflation", right: false, top: true },
  { label: "Recession Risk", right: false, top: false },
  { label: "Goldilocks", right: true, top: false },
];

const NAME: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 500 };
const AXIS: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".08em" };
/** #7d8b98 clears 4.5:1 on the hero card; the oldest-month stamp shares it. */
const AXIS_FILL = "#7d8b98";
const STAMP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11 };
const OLDEST: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10 };

const round1 = (v: number) => Math.round(v * 10) / 10;

interface Plane {
  l: number;
  r: number;
  t: number;
  b: number;
  ox: number;
  oy: number;
  hw: number;
  hh: number;
}

function plane(w: number, h: number): Plane {
  const l = PAD_L;
  const r = w - PAD_R;
  const t = PAD_T;
  const b = h - PAD_B;
  return { l, r, t, b, ox: (l + r) / 2, oy: (t + b) / 2, hw: Math.max(0, (r - l) / 2), hh: Math.max(0, (b - t) / 2) };
}

export function QuadrantChart({ points, current }: QuadrantChartProps) {
  const usable = current != null && current.growth_trend != null && current.inflation_trend != null;
  // The trail ends on the current month: appended when history lags the
  // latest regime row, or when history is empty but the row carries trends.
  const trail: TrailPoint[] =
    usable && (points.length === 0 || points[points.length - 1].date !== current.date)
      ? [...points, { date: current.date, label: current.label, x: current.growth_trend as number, y: current.inflation_trend as number }]
      : points;
  // A latest row without trend inputs plots nothing: the tint still follows
  // its label and a note says why the dot is missing.
  const missing = current != null && !usable;
  const plotted = missing ? [] : trail;
  const last = plotted[plotted.length - 1];
  const label = current?.label ?? last?.label ?? null;
  const hue = regimeHue(label);
  const n = plotted.length;
  const s = Math.max(1, ...plotted.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))));
  const faded = plotted.slice(0, -1);

  const ariaLabel =
    n >= 2 && last
      ? `Growth and inflation quadrant: ${n}-month trail ending ${fmtMonYr(last.date)} in ${last.label}`
      : n === 1 && last
        ? `Growth and inflation quadrant: current month only, ${fmtMonYr(last.date)} in ${last.label}`
        : missing && current
          ? `Growth and inflation quadrant: trend inputs not stored for ${fmtMonYr(current.date)}${label ? `, called ${label}` : ""}`
          : "Growth and inflation quadrant: no stored trend inputs";

  const draw = (w: number, h: number) => {
    const g = plane(w, h);
    const px = (p: TrailPoint) => round1(g.ox + (g.hw * p.x) / s);
    const py = (p: TrailPoint) => round1(g.oy - (g.hh * p.y) / s);
    // The current month's stamp sits below-right of the dot, flipped to the
    // left or above it where it would leave the plot.
    const stampLeft = last ? px(last) > g.r - 70 : false;
    const stampUp = last ? py(last) + 22 > g.b - 2 : false;
    return (
      <svg
        data-chart=""
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block", maxWidth: "100%" }}
      >
        {QUADRANTS.map((q) => {
          const on = q.label === label;
          return (
            <g key={q.label}>
              <rect
                data-quadrant={q.label}
                data-current={on ? "true" : "false"}
                x={q.right ? g.ox : g.l}
                y={q.top ? g.t : g.oy}
                width={g.hw}
                height={g.hh}
                style={{ fill: REGIME_HUE[q.label], stroke: REGIME_HUE[q.label] }}
                fillOpacity={on ? 0.16 : 0.06}
                strokeOpacity={0.18}
              />
              <text
                x={q.right ? g.r - 10 : g.l + 10}
                y={q.top ? g.t + 16 : g.b - 9}
                textAnchor={q.right ? "end" : "start"}
                style={{ ...NAME, fill: REGIME_HUE[q.label] }}
                fillOpacity={on ? 1 : 0.75}
              >
                {q.label}
              </text>
            </g>
          );
        })}
        <line x1={g.l} x2={g.r} y1={g.oy} y2={g.oy} stroke="rgba(255,255,255,.22)" />
        <line x1={g.ox} x2={g.ox} y1={g.t} y2={g.b} stroke="rgba(255,255,255,.22)" />
        <text x={g.r} y={h - 16} textAnchor="end" fill={AXIS_FILL} style={AXIS}>
          GROWTH ACCELERATING →
        </text>
        <text x={g.l} y={h - 16} fill={AXIS_FILL} style={AXIS}>
          ← SLOWING
        </text>
        <text transform={`translate(${g.l - 10},${round1(g.oy)}) rotate(-90)`} textAnchor="middle" fill={AXIS_FILL} style={AXIS}>
          INFLATION RISING →
        </text>

        {n >= 2 ? (
          <polyline
            className="mrr-quadrant-trail"
            points={plotted.map((p) => `${px(p)},${py(p)}`).join(" ")}
            fill="none"
            style={{ stroke: hue }}
            strokeOpacity={0.45}
            strokeWidth={1.2}
            strokeDasharray="2 3"
          />
        ) : null}
        {n >= 2
          ? faded.map((p, i) => (
              <circle
                key={p.date}
                className="mrr-quadrant-point"
                cx={px(p)}
                cy={py(p)}
                r={2.6}
                style={{ fill: hue }}
                fillOpacity={Math.round((0.18 + 0.5 * (faded.length > 1 ? i / (faded.length - 1) : 0)) * 100) / 100}
              >
                <title>
                  {fmtMonYr(p.date)} · {p.label}
                </title>
              </circle>
            ))
          : null}
        {last ? (
          <g className="mrr-quadrant-current">
            <circle cx={px(last)} cy={py(last)} r={13} style={{ fill: hue }} fillOpacity={0.14} />
            <circle cx={px(last)} cy={py(last)} r={5.5} style={{ fill: hue }} stroke="#031a12" strokeWidth={1.5}>
              <title>
                {fmtMonYr(last.date)} · {last.label}
              </title>
            </circle>
            <text
              x={stampLeft ? px(last) - 12 : px(last) + 12}
              y={stampUp ? py(last) - 16 : py(last) + 22}
              textAnchor={stampLeft ? "end" : "start"}
              fill="#dff7ee"
              style={STAMP}
            >
              {fmtMonYr(last.date)}
            </text>
          </g>
        ) : null}
        {n >= 2 ? (
          <text x={px(plotted[0]) - 8} y={py(plotted[0]) + 16} fill={AXIS_FILL} style={OLDEST}>
            {fmtMonYr(plotted[0].date)}
          </text>
        ) : null}
      </svg>
    );
  };

  return (
    <HeroChartFrame
      fallback={FALLBACK}
      minHeight={(w) => minHeight(w) + (missing ? NOTE_H : 0)}
      maxHeight={(w) => maxHeight(w) + (missing ? NOTE_H : 0)}
    >
      {({ w, h }) => (
        <div className="mrr-quadrant" style={{ width: w, maxWidth: "100%", minWidth: 0 }}>
          {draw(w, missing ? h - NOTE_H : h)}
          {missing && current ? (
            <div className="mrr-quadrant-note" style={{ ...monoNoteStyle, marginTop: 6, textAlign: "right" }}>
              Trend inputs not stored for {fmtMonYr(current.date)}.
            </div>
          ) : null}
        </div>
      )}
    </HeroChartFrame>
  );
}

export default QuadrantChart;
