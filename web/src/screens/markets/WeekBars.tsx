/**
 * WeekBars: the Markets hero's signature chart (redesign Phase 5, checklist
 * 05 B.1 "Visual"). Inline SVG horizontal one-week return bars, one row per
 * stored ETF with a served `ret_1w`, sorted by the caller (descending). The
 * zero rule sits at x 224; gains extend right of it, losses left; the widest
 * bar is scaled to 130px so every row fits. Values are the served figure
 * formatted, nothing is computed here beyond the pixel scale.
 */

import { fmtSignedPct } from "../../lib/format";

export interface WeekBarRow {
  symbol: string;
  name: string;
  /** The newest stored bar's `ret_1w`, as served. */
  ret: number;
}

const ZERO_X = 224;
const ROW_H = 26.6;
const BAR_H = 14.9;
const MAX_BAR = 130;
const TOP = 24;

export default function WeekBars({ rows }: { rows: WeekBarRow[] }) {
  const height = TOP + rows.length * ROW_H;
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.ret)), 0);
  const scale = maxAbs > 0 ? MAX_BAR / maxAbs : 0;
  return (
    <svg
      viewBox={`0 0 400 ${height.toFixed(1)}`}
      width="100%"
      role="img"
      aria-label="One-week return by asset"
      style={{ display: "block", maxWidth: 400, marginLeft: "auto" }}
    >
      <text
        x="0"
        y="12"
        fontSize="9.5"
        letterSpacing=".1em"
        fill="var(--text-3)"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        1-WEEK RETURN
      </text>
      <line x1={ZERO_X} x2={ZERO_X} y1="20" y2={(height - 8).toFixed(1)} stroke="rgba(255,255,255,.18)" />
      {rows.map((r, i) => {
        const baseline = 41.3 + i * ROW_H;
        const top = 29.9 + i * ROW_H;
        const width = Math.abs(r.ret) * scale;
        const gain = r.ret >= 0;
        const tone = gain ? "var(--pos)" : "var(--neg)";
        return (
          <g key={r.symbol}>
            <text x="0" y={baseline.toFixed(1)} fontSize="12" fontWeight="500" fill="var(--text)" style={{ fontFamily: "var(--font-ui)" }}>
              {r.symbol}
            </text>
            <text x="42" y={baseline.toFixed(1)} fontSize="11.5" fill="var(--text-3)" style={{ fontFamily: "var(--font-ui)" }}>
              {r.name}
            </text>
            <rect
              x={(gain ? ZERO_X : ZERO_X - width).toFixed(1)}
              y={top.toFixed(1)}
              width={width.toFixed(1)}
              height={BAR_H}
              rx="2"
              fill={tone}
              fillOpacity=".85"
            />
            <text
              x={(gain ? ZERO_X + width + 6 : ZERO_X - width - 6).toFixed(1)}
              y={baseline.toFixed(1)}
              textAnchor={gain ? "start" : "end"}
              fontSize="11"
              fill={tone}
              style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {fmtSignedPct(r.ret, 1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
