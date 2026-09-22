/**
 * RegimeRibbon: the classifier's full monthly record as four regime lanes
 * (redesign Phase 4, checklist 04 B.6 and B.9). One inline SVG in two sizes:
 * `teaser` is the Overview strip (mockup line 219: Plex Sans lane names, faint
 * tracks, a "now" line at the right edge) and `full` is the History sub-tab's
 * Gantt (mono uppercase lane names in the regime hue, year gridlines), the
 * same merge (`mergeSegments`) and the same `<title>` tooltip on every span.
 *
 * Every label is SVG-native, so below 768 the SVG keeps its intrinsic pixel
 * size inside an `overflow-x: auto` well with the "scroll → 30 years" caption
 * (the R43 rule); at 768 and up the fluid `width: 100%` applies.
 *
 * Iteration 1 (G3 at 390): the well is the chart's box (`data-chart`): below
 * 768 the drawing scrolls inside a well that spans its tile, so the chart a
 * reader sees fills and centres in its container at every width.
 */

import { useMemo, type CSSProperties } from "react";
import type { Regime } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Caption } from "../shared/screen-ui";
import { REGIMES, REGIME_HUE, mergeSegments, regimeOrder } from "./regime-history";

export type RibbonVariant = "teaser" | "full";

export interface RegimeRibbonProps {
  /** Ascending monthly rows from `/api/regime/history`. */
  rows: Regime[];
  variant?: RibbonVariant;
  ariaLabel: string;
  style?: CSSProperties;
}

interface Geometry {
  w: number;
  h: number;
  labelW: number;
  /** Lane pitch. */
  rowH: number;
  /** Span top offset inside its lane and span height. */
  spanY: number;
  spanH: number;
  spanRx: number;
  /** Baseline of the lane name. */
  labelY: number;
  /** Baseline of the year ticks. */
  yearY: number;
}

const GEOMETRY: Record<RibbonVariant, Geometry> = {
  // viewBox 0 0 1360 74: lanes 15px apart, 12px spans, ticks at y 72.
  teaser: { w: 1360, h: 74, labelW: 96, rowH: 15, spanY: 4, spanH: 12, spanRx: 2, labelY: 14, yearY: 72 },
  // viewBox 0 0 1385 98: today's Gantt (ROW_H 20, LABEL_W 130, 13px spans).
  full: { w: 1385, h: 98, labelW: 130, rowH: 20, spanY: 3, spanH: 13, spanRx: 1.5, labelY: 13, yearY: 92 },
};

const LANE_NAME_TEASER: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11 };
const LANE_NAME_FULL: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".06em" };
const YEAR_TICK: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em" };

export function RegimeRibbon({ rows, variant = "teaser", ariaLabel, style }: RegimeRibbonProps) {
  // Hook stays above every early return: order must be unconditional.
  const { isNarrow } = useBreakpoint();
  const segs = useMemo(() => mergeSegments(rows), [rows]);
  const g = GEOMETRY[variant];
  const teaser = variant === "teaser";
  if (!rows.length) return null;

  const t0 = new Date(rows[0].date).getTime();
  const t1 = new Date(rows[rows.length - 1].date).getTime() + 32 * 86_400_000;
  // The Gantt's mapping (RegimeLabScreen.tsx:820): the track runs from the
  // label column to 4px short of the right edge.
  const X = (iso: string) => g.labelW + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (g.w - g.labelW - 4);
  // Years come from the ISO string: `new Date("2010-01-01").getFullYear()` is
  // 2009 in any zone west of UTC (midnight UTC parses to the previous evening).
  const firstYear = Number(rows[0].date.slice(0, 4));
  const lastYear = Number(rows[rows.length - 1].date.slice(0, 4));
  const years: string[] = [];
  for (let y = firstYear + 2; y <= lastYear; y += 5) {
    years.push(`${y}-01-01`);
  }
  const laneTop = (ri: number) => ri * g.rowH + g.spanY;

  return (
    <div style={style}>
      <div className="mrr-ribbon-well" data-chart="" style={isNarrow ? { overflowX: "auto" } : undefined}>
        <svg
          viewBox={`0 0 ${g.w} ${g.h}`}
          style={isNarrow ? { display: "block", width: g.w, height: g.h } : { display: "block", width: "100%", height: "auto" }}
          role="img"
          aria-label={ariaLabel}
          data-variant={variant}
        >
          {REGIMES.map((r, ri) => (
            <g key={r}>
              {teaser ? (
                <text x={0} y={ri * g.rowH + g.labelY} fill="#8f9daa" style={LANE_NAME_TEASER}>
                  {r}
                </text>
              ) : (
                <text x={0} y={ri * g.rowH + g.labelY} style={{ ...LANE_NAME_FULL, fill: REGIME_HUE[r] }}>
                  {r.toUpperCase()}
                </text>
              )}
              {teaser ? (
                <rect className="mrr-ribbon-track" x={g.labelW} y={laneTop(ri)} width={g.w - g.labelW} height={g.spanH} rx={g.spanRx} fill="rgba(150,175,200,.04)" />
              ) : (
                <line x1={g.labelW} x2={g.w - 4} y1={laneTop(ri) + g.spanH / 2} y2={laneTop(ri) + g.spanH / 2} stroke="var(--line-hair)" strokeWidth="0.5" />
              )}
            </g>
          ))}
          {segs.map((s, i) => {
            const ri = regimeOrder(s.label);
            if (ri > 3) return null;
            const x0 = X(s.start);
            // A span covers its end month too: one month's width is added so a
            // single-month spell is still visible.
            const x1 = Math.max(X(s.end) + (X(s.end) - x0) / Math.max(s.months, 1), x0 + 1.2);
            const open = i === segs.length - 1;
            return (
              <rect
                key={`${s.label}-${s.start}`}
                className="mrr-ribbon-span"
                data-label={s.label}
                x={x0}
                y={laneTop(ri)}
                width={x1 - x0}
                height={g.spanH}
                rx={g.spanRx}
                style={{ fill: REGIME_HUE[s.label] }}
                fillOpacity={open ? 0.95 : 0.62}
              >
                <title>
                  {s.label} · {fmtMonYr(s.start)} → {fmtMonYr(s.end)} ({s.months}mo)
                </title>
              </rect>
            );
          })}
          {years.map((y) => (
            <g key={y}>
              {teaser ? null : <line x1={X(y)} x2={X(y)} y1={2} y2={g.rowH * 4} stroke="var(--line-hair)" strokeWidth="0.5" />}
              <text className="mrr-ribbon-year" x={X(y) + 2} y={g.yearY} fill="#6f7d8a" style={YEAR_TICK}>
                {y.slice(0, 4)}
              </text>
            </g>
          ))}
          {teaser ? <line x1={g.w - 1} x2={g.w - 1} y1={0} y2={g.rowH * 4 + 4} stroke="#fff" strokeOpacity={0.5} /> : null}
        </svg>
      </div>
      {isNarrow ? <Caption>scroll → 30 years</Caption> : null}
    </div>
  );
}

export default RegimeRibbon;
