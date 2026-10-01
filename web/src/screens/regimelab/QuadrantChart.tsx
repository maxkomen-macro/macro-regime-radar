/**
 * QuadrantChart: the Regime Lab hero's signature chart (redesign Phase 4,
 * checklist 04 B.1.1). A growth-vs-inflation plane with four tinted quadrants
 * in the regime hues, a trail through the last stored months' trend inputs,
 * and a glowing dot for the current month.
 *
 * The dot is the input, the tint is the output: the trail plots the served
 * `growth_trend` / `inflation_trend` of each month (the raw 3-row slopes of
 * the industrial-production and CPI index levels, in index points a month,
 * whose signs set the label), while the tinted quadrant follows the served
 * current label (G18). Geometry is the mockup's (line 178) at its 400×330
 * fallback: plot 34..366 × 20..298, origin at (200, 159).
 *
 * fix/freshness 5: each axis has its own symmetric scale, ± the largest
 * absolute slope on it (plus a margin), so the zero lines stay the quadrant
 * borders at the centre. One shared scale let the CPI slopes (about 0.5 to
 * 2.5) dwarf the INDPRO slopes (about 0.1 to 0.5), and the trail hugged the
 * vertical axis. The z-scores are not plotted: z is measured against the
 * average slope, so about 170 months would sit on the wrong side of a zero
 * line from their own label. The trail is solid and fades oldest → newest,
 * each dot takes its own month's regime colour, labels mark only the start,
 * each regime change and the latest month, placed so they do not collide,
 * and every dot's tooltip names its month, label and both slopes.
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
/** Each axis runs to ± this much beyond its largest absolute slope, so the outermost dot and its halo stay inside. */
const MARGIN = 1.12;

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
const TICK: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 9 };
/** #7d8b98 clears 4.5:1 on the hero card; the month labels share it. */
const AXIS_FILL = "#7d8b98";
const STAMP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11 };
const MONTH: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10 };
/** The trail's ink: neutral, so the dots carry the regime colours. */
const TRAIL_INK = "#c9d1d9";
const DOT_R = 3.2;
const CURRENT_R = 5.5;
const HALO_R = 13;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
/** "+0.35" / "−0.58": a slope in index points a month, two decimals, a true minus sign. */
export const signedSlope = (v: number) => `${v < 0 ? "−" : "+"}${Math.abs(v).toFixed(2)}`;

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

/** Each axis's own symmetric scale: ± its largest absolute slope × MARGIN (1 for an empty or all-zero axis). */
export function axisScales(points: readonly Pick<TrailPoint, "x" | "y">[]): { sx: number; sy: number } {
  const mx = Math.max(0, ...points.map((p) => Math.abs(p.x)));
  const my = Math.max(0, ...points.map((p) => Math.abs(p.y)));
  return { sx: mx > 0 ? mx * MARGIN : 1, sy: my > 0 ? my * MARGIN : 1 };
}

/** The points a month label marks: the start, each regime change, and the latest month (indices, oldest first). */
export function labelledIndices(points: readonly Pick<TrailPoint, "label">[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  const out = new Set<number>([n - 1]);
  if (n >= 2) out.add(0);
  for (let i = 1; i < n; i++) if (points[i].label !== points[i - 1].label) out.add(i);
  return [...out].sort((a, b) => a - b);
}

/** "Mar 2026 · Overheating · growth +0.35, CPI +1.85 index pts a month". */
export function pointTitle(p: TrailPoint): string {
  return `${fmtMonYr(p.date)} · ${p.label} · growth ${signedSlope(p.x)}, CPI ${signedSlope(p.y)} index pts a month`;
}

type Box = { x0: number; x1: number; y0: number; y1: number };
const clear = (a: Box, b: Box) => a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0;
const inside = (a: Box, g: Plane) => a.x0 >= g.l + 1 && a.x1 <= g.r - 1 && a.y0 >= g.t + 1 && a.y1 <= g.b - 1;

interface ScaleLabel {
  x: number;
  y: number;
  anchor: "start" | "end";
  text: string;
}

/** Each axis's own scale at its ends (index points a month): what the plane prints, and (Codex R-21) the boxes the
 * month labels must clear. */
function scaleLabels(g: Plane, sx: number, sy: number): ScaleLabel[] {
  return [
    { x: g.r - 2, y: g.oy - 4, anchor: "end", text: signedSlope(sx) },
    { x: g.l + 2, y: g.oy - 4, anchor: "start", text: signedSlope(-sx) },
    { x: g.ox + 4, y: g.t + 9, anchor: "start", text: signedSlope(sy) },
    { x: g.ox + 4, y: g.b - 3, anchor: "start", text: signedSlope(-sy) },
  ];
}

/** A scale label's box: TICK's 9 px mono face, ≈ 5.6 px a glyph, padded like the month labels' boxes. */
function scaleBox(l: ScaleLabel): Box {
  const tw = l.text.length * 5.6;
  const x0 = l.anchor === "end" ? l.x - tw : l.x;
  return { x0: x0 - 1, x1: x0 + tw + 1, y0: l.y - 9, y1: l.y + 3 };
}

interface Placed {
  i: number;
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  text: string;
  current: boolean;
}

/**
 * Month labels for the start, each change and the latest month, each placed at the first of eight spots around
 * its dot whose box (estimated from the mono glyph width) stays inside the plot and clears every dot, the
 * quadrant names, the axis-scale labels (Codex R-21) and the labels already placed. Priority: the latest month, then the start, then the changes
 * newest first. A label with no free spot is left off (the dot's tooltip still names it); the latest month
 * always prints, at its first spot inside the plot.
 */
function placeLabels(points: TrailPoint[], at: (p: TrailPoint) => [number, number], g: Plane, scale: readonly ScaleLabel[] = []): Placed[] {
  const n = points.length;
  const dots: Box[] = points.map((p, i) => {
    const [x, y] = at(p);
    const r = i === n - 1 ? CURRENT_R + 2 : DOT_R + 1;
    return { x0: x - r, x1: x + r, y0: y - r, y1: y + r };
  });
  // The quadrant names sit at the outer corners (12 px UI face, ≈ 6.6 px a glyph).
  const names: Box[] = QUADRANTS.map((q) => {
    const tw = q.label.length * 6.6;
    const x = q.right ? g.r - 10 - tw : g.l + 10;
    const y = q.top ? g.t + 16 : g.b - 9;
    return { x0: x - 2, x1: x + tw + 2, y0: y - 12, y1: y + 3 };
  });
  const scaleBoxes = scale.map(scaleBox);
  const order = labelledIndices(points).sort((a, b) => (a === n - 1 ? -1 : b === n - 1 ? 1 : a === 0 ? -1 : b === 0 ? 1 : b - a));
  const placed: Placed[] = [];
  const taken: Box[] = [];
  for (const i of order) {
    const current = i === n - 1;
    const text = fmtMonYr(points[i].date);
    const [x, y] = at(points[i]);
    const glyph = current ? 6.7 : 6.1;
    const tw = text.length * glyph;
    const th = current ? 12 : 11;
    const d = current ? HALO_R : 7;
    const spots: { dx: number; dy: number; anchor: Placed["anchor"] }[] = [
      { dx: d, dy: d + th - 2, anchor: "start" },
      { dx: d, dy: -d, anchor: "start" },
      { dx: -d, dy: d + th - 2, anchor: "end" },
      { dx: -d, dy: -d, anchor: "end" },
      { dx: d + 2, dy: 4, anchor: "start" },
      { dx: -d - 2, dy: 4, anchor: "end" },
      { dx: 0, dy: -d - 3, anchor: "middle" },
      { dx: 0, dy: d + th + 1, anchor: "middle" },
    ];
    const boxOf = (s: (typeof spots)[number]): Box => {
      const lx = x + s.dx;
      const x0 = s.anchor === "start" ? lx : s.anchor === "end" ? lx - tw : lx - tw / 2;
      const ly = y + s.dy;
      return { x0: x0 - 1, x1: x0 + tw + 1, y0: ly - th + 1, y1: ly + 3 };
    };
    const others = dots.filter((_, k) => k !== i);
    const fits = (b: Box) =>
      inside(b, g) && others.every((o) => clear(b, o)) && names.every((o) => clear(b, o)) && scaleBoxes.every((o) => clear(b, o)) && taken.every((o) => clear(b, o));
    let spot = spots.find((s) => fits(boxOf(s)));
    if (!spot && current) spot = spots.find((s) => inside(boxOf(s), g)) ?? spots[0];
    if (!spot) continue;
    const box = boxOf(spot);
    taken.push(box);
    placed.push({ i, x: round1(x + spot.dx), y: round1(y + spot.dy), anchor: spot.anchor, text, current });
  }
  return placed.sort((a, b) => a.i - b.i);
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
  const n = plotted.length;
  const { sx, sy } = axisScales(plotted);
  const faded = plotted.slice(0, -1);

  const ariaLabel =
    n >= 2 && last
      ? `Growth and inflation quadrant: ${n} stored months, ${fmtMonYr(plotted[0].date)} to ${fmtMonYr(last.date)}, ending in ${last.label}; each axis on its own scale`
      : n === 1 && last
        ? `Growth and inflation quadrant: current month only, ${fmtMonYr(last.date)} in ${last.label}`
        : missing && current
          ? `Growth and inflation quadrant: trend inputs not stored for ${fmtMonYr(current.date)}${label ? `, called ${label}` : ""}`
          : "Growth and inflation quadrant: no stored trend inputs";

  const draw = (w: number, h: number) => {
    const g = plane(w, h);
    const px = (p: Pick<TrailPoint, "x">) => round1(g.ox + (g.hw * p.x) / sx);
    const py = (p: Pick<TrailPoint, "y">) => round1(g.oy - (g.hh * p.y) / sy);
    const at = (p: TrailPoint): [number, number] => [px(p), py(p)];
    const scale = scaleLabels(g, sx, sy);
    const labels = n >= 1 ? placeLabels(plotted, at, g, scale) : [];
    // Fade oldest → newest: the trail's segments and the dots both.
    const segOpacity = (k: number) => round2(0.12 + 0.5 * (n > 2 ? k / (n - 2) : 1));
    const dotOpacity = (k: number) => round2(0.35 + 0.55 * (faded.length > 1 ? k / (faded.length - 1) : 1));
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
        {/* The zero lines: the quadrant borders, where each slope changes sign. */}
        <line data-zero="x" x1={g.l} x2={g.r} y1={g.oy} y2={g.oy} stroke="rgba(255,255,255,.22)" />
        <line data-zero="y" x1={g.ox} x2={g.ox} y1={g.t} y2={g.b} stroke="rgba(255,255,255,.22)" />
        {/* Each axis's own scale, at its ends (index points a month). */}
        {n >= 1 ? (
          <g data-role="scale">
            {scale.map((l) => (
              <text key={`${l.x},${l.y}`} x={l.x} y={l.y} textAnchor={l.anchor} fill={AXIS_FILL} style={TICK}>
                {l.text}
              </text>
            ))}
          </g>
        ) : null}
        <text x={g.r} y={h - 16} textAnchor="end" fill={AXIS_FILL} style={AXIS}>
          PRODUCTION RISING →
        </text>
        <text x={g.l} y={h - 16} fill={AXIS_FILL} style={AXIS}>
          ← FALLING
        </text>
        <text transform={`translate(${g.l - 10},${round1(g.oy)}) rotate(-90)`} textAnchor="middle" fill={AXIS_FILL} style={AXIS}>
          CPI LEVEL RISING →
        </text>

        {n >= 2 ? (
          <g className="mrr-quadrant-trail">
            {plotted.slice(1).map((p, k) => (
              <line
                key={p.date}
                x1={px(plotted[k])}
                y1={py(plotted[k])}
                x2={px(p)}
                y2={py(p)}
                stroke={TRAIL_INK}
                strokeOpacity={segOpacity(k)}
                strokeWidth={1.4}
                strokeLinecap="round"
              />
            ))}
          </g>
        ) : null}
        {n >= 2
          ? faded.map((p, k) => (
              <circle
                key={p.date}
                className="mrr-quadrant-point"
                data-regime={p.label}
                cx={px(p)}
                cy={py(p)}
                r={DOT_R}
                style={{ fill: regimeHue(p.label) }}
                fillOpacity={dotOpacity(k)}
              >
                <title>{pointTitle(p)}</title>
              </circle>
            ))
          : null}
        {last ? (
          <g className="mrr-quadrant-current">
            <circle cx={px(last)} cy={py(last)} r={HALO_R} style={{ fill: regimeHue(last.label) }} fillOpacity={0.14} />
            <circle cx={px(last)} cy={py(last)} r={CURRENT_R} data-regime={last.label} style={{ fill: regimeHue(last.label) }} stroke="#031a12" strokeWidth={1.5}>
              <title>{pointTitle(last)}</title>
            </circle>
          </g>
        ) : null}
        {labels.map((l) => (
          <text
            key={l.i}
            data-label={l.current ? "latest" : l.i === 0 ? "start" : "change"}
            x={l.x}
            y={l.y}
            textAnchor={l.anchor}
            fill={l.current ? "#dff7ee" : AXIS_FILL}
            style={l.current ? STAMP : MONTH}
          >
            {l.text}
          </text>
        ))}
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
