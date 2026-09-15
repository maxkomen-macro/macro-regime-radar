/**
 * QuadrantChart: the Regime Lab hero's signature chart (redesign Phase 4,
 * checklist 04 B.1.1). A growth-vs-inflation plane with four tinted quadrants
 * in the regime hues, a dashed 12-month trail of fading dots through the
 * stored trend inputs, and a glowing dot for the current month.
 *
 * The dot is the input, the tint is the output: the trail plots the served
 * `growth_trend` / `inflation_trend` of each month, while the tinted quadrant
 * follows the served current label, never the sign of the trends (G18).
 * Geometry is the mockup's (line 178): viewBox 400×330, plot 34..366 × 20..298,
 * origin at (200, 159). Scale is symmetric over the points so the origin stays
 * centred and a quiet month does not zoom the chart.
 */

import type { CSSProperties } from "react";
import type { Regime } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { monoNoteStyle } from "../shared/screen-ui";
import { REGIME_HUE, regimeHue, type RegimeName, type TrailPoint } from "./regime-history";

export interface QuadrantChartProps {
  /** `trailPoints(rows, 12)`: date order, oldest first. */
  points: TrailPoint[];
  /** The latest regime row: its label tints the quadrant; its trends place
   * the current dot (appended when the trail does not already end there). */
  current?: Regime | null;
}

const ORIGIN_X = 200;
const ORIGIN_Y = 159;
const HALF_W = 166;
const HALF_H = 139;

interface Quadrant {
  label: RegimeName;
  x: number;
  y: number;
  tx: number;
  ty: number;
  anchor: "start" | "end";
}

/** Top-right Overheating, top-left Stagflation, bottom-left Recession Risk,
 * bottom-right Goldilocks (names at the outer corners). */
const QUADRANTS: Quadrant[] = [
  { label: "Overheating", x: ORIGIN_X, y: 20, tx: 356, ty: 36, anchor: "end" },
  { label: "Stagflation", x: 34, y: 20, tx: 44, ty: 36, anchor: "start" },
  { label: "Recession Risk", x: 34, y: ORIGIN_Y, tx: 44, ty: 289, anchor: "start" },
  { label: "Goldilocks", x: ORIGIN_X, y: ORIGIN_Y, tx: 356, ty: 289, anchor: "end" },
];

const NAME: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 500 };
const AXIS: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 9.5, letterSpacing: ".08em" };
const AXIS_FILL = "#7d8b98";
const STAMP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10.5 };
const OLDEST: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 9.5 };

const round1 = (v: number) => Math.round(v * 10) / 10;

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
  const px = (p: TrailPoint) => round1(ORIGIN_X + (HALF_W * p.x) / s);
  const py = (p: TrailPoint) => round1(ORIGIN_Y - (HALF_H * p.y) / s);
  const faded = plotted.slice(0, -1);

  const ariaLabel =
    n >= 2 && last
      ? `Growth and inflation quadrant: ${n}-month trail ending ${fmtMonYr(last.date)} in ${last.label}`
      : n === 1 && last
        ? `Growth and inflation quadrant: current month only, ${fmtMonYr(last.date)} in ${last.label}`
        : missing && current
          ? `Growth and inflation quadrant: trend inputs not stored for ${fmtMonYr(current.date)}${label ? `, called ${label}` : ""}`
          : "Growth and inflation quadrant: no stored trend inputs";

  return (
    <div className="mrr-quadrant" style={{ minWidth: 0 }}>
      <svg
        viewBox="0 0 400 330"
        width="100%"
        role="img"
        aria-label={ariaLabel}
        style={{ display: "block", maxWidth: 400, marginLeft: "auto" }}
      >
        {QUADRANTS.map((q) => {
          const on = q.label === label;
          return (
            <g key={q.label}>
              <rect
                data-quadrant={q.label}
                data-current={on ? "true" : "false"}
                x={q.x}
                y={q.y}
                width={HALF_W}
                height={HALF_H}
                style={{ fill: REGIME_HUE[q.label], stroke: REGIME_HUE[q.label] }}
                fillOpacity={on ? 0.16 : 0.06}
                strokeOpacity={0.18}
              />
              <text x={q.tx} y={q.ty} textAnchor={q.anchor} style={{ ...NAME, fill: REGIME_HUE[q.label] }} fillOpacity={on ? 1 : 0.75}>
                {q.label}
              </text>
            </g>
          );
        })}
        <line x1={34} x2={366} y1={ORIGIN_Y} y2={ORIGIN_Y} stroke="rgba(255,255,255,.22)" />
        <line x1={ORIGIN_X} x2={ORIGIN_X} y1={20} y2={298} stroke="rgba(255,255,255,.22)" />
        <text x={366} y={314} textAnchor="end" fill={AXIS_FILL} style={AXIS}>
          GROWTH ACCELERATING →
        </text>
        <text x={34} y={314} fill={AXIS_FILL} style={AXIS}>
          ← SLOWING
        </text>
        <text transform={`translate(24,${ORIGIN_Y}) rotate(-90)`} textAnchor="middle" fill={AXIS_FILL} style={AXIS}>
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
            <text x={px(last) + 12} y={py(last) + 22} fill="#dff7ee" style={STAMP}>
              {fmtMonYr(last.date)}
            </text>
          </g>
        ) : null}
        {n >= 2 ? (
          <text x={px(plotted[0]) - 8} y={py(plotted[0]) + 16} fill="#6f7d8a" style={OLDEST}>
            {fmtMonYr(plotted[0].date)}
          </text>
        ) : null}
      </svg>
      {missing && current ? (
        <div className="mrr-quadrant-note" style={{ ...monoNoteStyle, marginTop: 6, textAlign: "right" }}>
          Trend inputs not stored for {fmtMonYr(current.date)}.
        </div>
      ) : null}
    </div>
  );
}

export default QuadrantChart;
