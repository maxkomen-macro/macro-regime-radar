/**
 * Efficient frontier — bespoke SVG in the LineChart idiom, but on a
 * risk/return plane instead of time: the 40-point frontier as a 1.5px line,
 * optimization methods as labeled dots. Axes in mono, no gridlines.
 */

import type { FrameData } from "../../api/types";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { mono } from "../shared/screen-ui";

export interface FrontierMarker {
  label: string;
  vol: number;
  ret: number;
  color: string;
}

const H = 220;
const PAD_Y = 16;

export default function FrontierChart({ frontier, markers }: { frontier: FrameData; markers: FrontierMarker[] }) {
  // Every label here lives inside the svg, so the viewBox width is the whole
  // legibility story: 720u scaled into a ~300px phone card renders 9u type at
  // ~3.7px. Halving the box (and trimming the right gutter, which is a fixed
  // number of units and so eats a bigger share of a narrow box) restores it.
  // Hook runs before the early returns below — order must stay unconditional.
  const { isNarrow } = useBreakpoint();
  const W = isNarrow ? 360 : 720;
  const PAD_L = isNarrow ? 12 : 8;
  const PAD_R = isNarrow ? 44 : 60;
  const FS = isNarrow ? 10 : 9;
  if (!frontier?.columns || !frontier?.data) {
    return <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>Frontier unavailable.</span>;
  }
  const volIdx = frontier.columns.indexOf("volatility");
  const retIdx = frontier.columns.indexOf("return");
  const pts = frontier.data
    .map((row) => ({ vol: row[volIdx], ret: row[retIdx] }))
    .filter((p): p is { vol: number; ret: number } => p.vol != null && p.ret != null);
  if (pts.length < 2) {
    return <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>Frontier unavailable.</span>;
  }
  const vols = [...pts.map((p) => p.vol), ...markers.map((m) => m.vol)];
  const rets = [...pts.map((p) => p.ret), ...markers.map((m) => m.ret)];
  const vMin = Math.min(...vols);
  const vMax = Math.max(...vols);
  const rMin = Math.min(...rets);
  const rMax = Math.max(...rets);
  const vSpan = vMax - vMin || 1;
  const rSpan = rMax - rMin || 1;
  const X = (v: number) => PAD_L + ((v - vMin) / vSpan) * (W - PAD_L - PAD_R);
  const Y = (r: number) => PAD_Y + (1 - (r - rMin) / rSpan) * (H - PAD_Y * 2);

  const d = pts
    .map((p, i) => `${i ? "L" : "M"}${X(p.vol).toFixed(1)} ${Y(p.ret).toFixed(1)}`)
    .join(" ");

  // Three readable ticks per axis — a plot nobody can read coordinates off
  // is decoration, not a chart (critique).
  const ticks = (lo: number, hi: number) => [lo, (lo + hi) / 2, hi];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Efficient frontier — annualized volatility vs return, with optimization methods marked">
        {ticks(vMin, vMax).map((v) => (
          <g key={`vt-${v}`}>
            <line x1={X(v)} x2={X(v)} y1={PAD_Y} y2={H - PAD_Y} stroke="var(--line-hair)" strokeWidth="0.5" />
            <text x={X(v)} y={H - 2} textAnchor="middle" fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)", fontSize: FS }}>
              {(v * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        {ticks(rMin, rMax).map((r) => (
          <g key={`rt-${r}`}>
            <line x1={PAD_L} x2={W - PAD_R} y1={Y(r)} y2={Y(r)} stroke="var(--line-hair)" strokeWidth="0.5" />
            <text x={W - PAD_R + 4} y={Y(r) + 3} fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)", fontSize: FS }}>
              {(r * 100).toFixed(0)}%
            </text>
          </g>
        ))}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {markers.map((m) => {
          // Labels flip to the left of the dot near the right rail so long
          // names ("Black-Litterman") never clip. The threshold is a label
          // WIDTH in user units, not a fraction of the plot, so it tracks the
          // type size rather than the viewBox.
          const nearRight = X(m.vol) > W - PAD_R - (isNarrow ? 112 : 100);
          return (
            <g key={m.label}>
              <circle cx={X(m.vol)} cy={Y(m.ret)} r={isNarrow ? 4.5 : 3.5} fill={m.color} />
              <text
                x={nearRight ? X(m.vol) - 7 : X(m.vol) + 7}
                y={Y(m.ret) + 3}
                textAnchor={nearRight ? "end" : "start"}
                fill="var(--text-muted)"
                style={{ fontFamily: "var(--font-mono)", fontSize: FS, letterSpacing: ".05em" }}
              >
                {m.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 9, letterSpacing: "var(--ls-micro)", color: "var(--text-muted)", marginTop: 2 }}>
        <span>annualized volatility →</span>
        <span>↑ annualized return (right axis)</span>
      </div>
    </div>
  );
}
