/**
 * Minimal multi-series line chart — hand-rolled SVG in the Sparkline's idiom
 * (1.5px stroke, 10% area on single-series, no gridlines) plus the two things
 * a real chart needs: min/max/last labels in mono and a dashed zero line when
 * the range crosses zero. Deliberately dependency-free for the v1 draft; the
 * handoff suggests Recharts/visx for interactive charts — an owner decision,
 * logged in the overnight report.
 */

import { useId } from "react";

export interface ChartSeries {
  label: string;
  color: string;
  points: { x: string; y: number }[];
}

/** Shaded x-interval (e.g. NBER recession windows). Dates clamp to the
 * plotted domain; bands wholly outside it are skipped. */
export interface ChartBand {
  from: string;
  to: string;
}

interface Props {
  series: ChartSeries[];
  height?: number;
  yFmt?: (v: number) => string;
  caption?: string;
  bands?: ChartBand[];
  /** Dashed horizontal reference rules (e.g. the 20/40 recession bands). */
  hlines?: { y: number; label?: string }[];
  /** Print each series' last value in the legend (default true). Turn off
   * when a hero number 100px away already states "current" — two currents
   * on one screen is the app's documented failure mode. */
  showLast?: boolean;
}

const W = 720;
const PAD_X = 6;
const PAD_Y = 8;

export default function LineChart({ series, height = 170, yFmt = (v) => v.toFixed(2), caption, bands, hlines, showLast = true }: Props) {
  const uid = useId();
  const all = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => Number.isFinite(y));
  if (!all.length) {
    return (
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)" }}>
        No datapoints in the window.
      </div>
    );
  }
  const yMin = Math.min(...all);
  const yMax = Math.max(...all);
  const span = yMax - yMin || 1;
  const innerH = height - PAD_Y * 2;
  const innerW = W - PAD_X * 2;

  const toXY = (pts: { x: string; y: number }[]) =>
    pts.map((p, i) => {
      const x = PAD_X + (pts.length > 1 ? (i / (pts.length - 1)) * innerW : innerW / 2);
      const y = PAD_Y + (1 - (p.y - yMin) / span) * innerH;
      return [x, y] as const;
    });

  const zeroY =
    yMin < 0 && yMax > 0 ? PAD_Y + (1 - (0 - yMin) / span) * innerH : null;

  const first = series[0]?.points[0]?.x ?? "";
  const last = series[0]?.points[series[0].points.length - 1]?.x ?? "";

  return (
    <div>
      {/* Legend + last values */}
      <div
        style={{
          display: "flex",
          gap: 14,
          flexWrap: "wrap",
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          letterSpacing: "var(--ls-micro)",
          marginBottom: 6,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {series.map((s) => {
          const lastP = s.points[s.points.length - 1];
          return (
            <span key={s.label} style={{ color: s.color }}>
              {s.label.toUpperCase()}
              {showLast ? ` ${lastP ? yFmt(lastP.y) : "—"}` : ""}
            </span>
          );
        })}
        <span style={{ marginLeft: "auto", color: "var(--text-muted)" }}>
          {first.slice(0, 10)} → {last.slice(0, 10)}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${height}`}
        style={{ display: "block", width: "100%", height: "auto" }}
        role="img"
        aria-label={caption ?? series.map((s) => s.label).join(", ")}
      >
        {/* Bands paint behind everything: x is index-mapped on series[0]'s
            date domain, so band edges snap to the nearest plotted points. */}
        {bands?.map((b, bi) => {
          const pts = series[0]?.points ?? [];
          if (pts.length < 2) return null;
          let i0 = pts.findIndex((p) => p.x >= b.from);
          let i1 = pts.length - 1 - [...pts].reverse().findIndex((p) => p.x <= b.to);
          if (i0 === -1 || i1 < 0 || i1 >= pts.length || i1 < i0) return null;
          const x0 = PAD_X + (i0 / (pts.length - 1)) * innerW;
          const x1 = PAD_X + (i1 / (pts.length - 1)) * innerW;
          return (
            <g key={`${uid}-band-${bi}`}>
              <rect
                x={x0}
                y={PAD_Y}
                width={Math.max(x1 - x0, 2)}
                height={innerH}
                // Visible against the card surface — faint@12% was a ~2% RGB
                // delta while two captions narrate "the shaded bands" (audit).
                fill="var(--line-strong)"
                opacity="0.28"
              />
              <line
                x1={x0}
                x2={x0}
                y1={PAD_Y}
                y2={PAD_Y + innerH}
                stroke="var(--line-strong)"
                strokeWidth="0.5"
                opacity="0.6"
              />
            </g>
          );
        })}
        {zeroY != null && (
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--line-strong)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hlines?.map((h) => {
          if (h.y < yMin || h.y > yMax) return null;
          const hy = PAD_Y + (1 - (h.y - yMin) / span) * innerH;
          return (
            <g key={`${uid}-h-${h.y}`}>
              <line
                x1={PAD_X}
                x2={W - PAD_X}
                y1={hy}
                y2={hy}
                stroke="var(--line-strong)"
                strokeWidth="1"
                strokeDasharray="2 5"
                vectorEffect="non-scaling-stroke"
              />
              {h.label && (
                <text x={W - PAD_X - 2} y={hy - 3} textAnchor="end" fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)", fontSize: 8 }}>
                  {h.label}
                </text>
              )}
            </g>
          );
        })}
        {series.map((s, si) => {
          const pts = toXY(s.points);
          if (pts.length < 2) return null;
          const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
          const area = `${d} L${(W - PAD_X).toFixed(1)} ${height - PAD_Y} L${PAD_X} ${height - PAD_Y} Z`;
          return (
            <g key={`${uid}-${si}`}>
              {series.length === 1 && <path d={area} fill={s.color} opacity="0.1" />}
              <path
                d={d}
                fill="none"
                stroke={s.color}
                strokeWidth="1.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          );
        })}
      </svg>

      {/* x-axis dates (quarter marks) so crossover timing is readable */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "var(--ls-micro)",
          color: "var(--text-muted)",
          marginTop: 4,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {(() => {
          const pts = series[0]?.points ?? [];
          if (pts.length < 2) return null;
          const idx = [0, Math.round((pts.length - 1) / 3), Math.round(((pts.length - 1) * 2) / 3), pts.length - 1];
          return [...new Set(idx)].map((i) => <span key={i}>{pts[i].x.slice(0, 7)}</span>);
        })()}
      </div>
      {/* y-range in mono under the plot */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontFamily: "var(--font-mono)",
          fontSize: 9,
          letterSpacing: "var(--ls-micro)",
          color: "var(--text-muted)",
          marginTop: 2,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {(() => {
          // With multiple series, say WHOSE floor and ceiling these are —
          // an unattributed pooled min/max under a two-series chart reads as
          // one series' range (critique 2026-08-07).
          const owner = (v: number) =>
            series.length > 1
              ? `${series.find((s) => s.points.some((p) => p.y === v))?.label ?? ""} `
              : "";
          return (
            <>
              <span>
                {owner(yMin)}low {yFmt(yMin)}
              </span>
              {zeroY != null && <span>0 = dashed line</span>}
              <span>
                {owner(yMax)}high {yFmt(yMax)}
              </span>
            </>
          );
        })()}
      </div>
    </div>
  );
}
