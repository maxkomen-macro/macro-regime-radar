/**
 * WeekBars: the Markets hero's signature chart (redesign Phase 5, checklist
 * 05 B.1 "Visual"). Inline SVG horizontal one-week return bars, one row per
 * stored ETF with a served `ret_1w`, sorted by the caller (descending). Gains
 * extend right of the zero rule, losses left; one scale for both sides.
 * Values are the served figure formatted, nothing is computed here beyond
 * the pixel scale.
 *
 * Iteration 1 (M1): drawn through HeroChartFrame at the hero column's own
 * size, 1:1, so the chart fills and centres in its column at every width and
 * every label keeps its set size (12 / 11.5 / 11 px). The symbol and name
 * columns come first; the bars take the rest of the width, with room kept on
 * each side for the widest value label so a label never meets a name or the
 * edge. The zero rule sits where the widest loss ends, so the span is shared
 * by the largest gain and the largest loss on one scale. Rows keep the
 * mockup's 26.6 px pitch and may open to 32 px when the hero row is taller.
 * The 400 px fallback is the pre-measurement drawing (and jsdom's).
 */

import { fmtSignedPct } from "../../lib/format";
import { HeroChartFrame } from "../shared/HeroChart";

export interface WeekBarRow {
  symbol: string;
  name: string;
  /** The newest stored bar's `ret_1w`, as served. */
  ret: number;
}

/** Caption band above the first row. */
const TOP = 24;
const BOTTOM = 6;
/** Mockup row pitch; the rows may open to ROW_MAX in a taller hero. */
const ROW_H = 26.6;
const ROW_MAX = 32;
const BAR_MAX_H = 17;
const NAME_X = 42;
/** Advance estimates (rounded up) for the column widths: Plex Sans 11.5px
 * names, 11px mono value labels (0.6em). */
const NAME_CH = 6.2;
const VALUE_CH = 6.6;
/** Bar end to its value label; name column to the bars area. */
const GAP = 6;
const NAME_GAP = 12;
const FALLBACK_W = 400;

const heightFor = (n: number, row: number) => Math.round(TOP + n * row + BOTTOM);

export default function WeekBars({ rows }: { rows: WeekBarRow[] }) {
  const n = rows.length;
  const labels = rows.map((r) => fmtSignedPct(r.ret, 1));
  const maxPos = rows.reduce((m, r) => Math.max(m, r.ret), 0);
  const maxNeg = rows.reduce((m, r) => Math.max(m, -r.ret), 0);
  const nameEnd = NAME_X + Math.max(0, ...rows.map((r) => r.name.length)) * NAME_CH;
  const widest = (keep: (ret: number) => boolean) => Math.max(0, ...rows.map((r, i) => (keep(r.ret) ? labels[i].length : 0)));
  const negPad = maxNeg > 0 ? GAP + widest((v) => v < 0) * VALUE_CH : 0;
  const posPad = GAP + widest((v) => v >= 0) * VALUE_CH;

  const draw = (w: number, h: number) => {
    const rowH = n ? (h - TOP - BOTTOM) / n : ROW_H;
    const barH = Math.min(BAR_MAX_H, rowH * 0.56);
    const left = nameEnd + NAME_GAP + negPad;
    const span = Math.max(0, w - posPad - left);
    const total = maxPos + maxNeg;
    const scale = total > 0 ? span / total : 0;
    const zeroX = total > 0 ? left + maxNeg * scale : left + span / 2;
    return (
      <svg
        data-chart=""
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label="One-week return by asset"
        style={{ display: "block", maxWidth: "100%" }}
      >
        <text x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill="var(--text-3)" style={{ fontFamily: "var(--font-mono)" }}>
          1-WEEK RETURN
        </text>
        <line x1={zeroX.toFixed(1)} x2={zeroX.toFixed(1)} y1="20" y2={h - 8} stroke="rgba(255,255,255,.18)" />
        {rows.map((r, i) => {
          const mid = TOP + i * rowH + rowH / 2;
          const baseline = mid + 4;
          const width = Math.abs(r.ret) * scale;
          const gain = r.ret >= 0;
          const tone = gain ? "var(--pos)" : "var(--neg)";
          return (
            <g key={r.symbol}>
              <text x="0" y={baseline.toFixed(1)} fontSize="12" fontWeight="500" fill="var(--text)" style={{ fontFamily: "var(--font-ui)" }}>
                {r.symbol}
              </text>
              <text x={NAME_X} y={baseline.toFixed(1)} fontSize="11.5" fill="var(--text-3)" style={{ fontFamily: "var(--font-ui)" }}>
                {r.name}
              </text>
              <rect
                x={(gain ? zeroX : zeroX - width).toFixed(1)}
                y={(mid - barH / 2).toFixed(1)}
                width={width.toFixed(1)}
                height={barH.toFixed(1)}
                rx="2"
                fill={tone}
                fillOpacity=".85"
              />
              <text
                x={(gain ? zeroX + width + GAP : zeroX - width - GAP).toFixed(1)}
                y={baseline.toFixed(1)}
                textAnchor={gain ? "start" : "end"}
                fontSize="11"
                fill={tone}
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <HeroChartFrame fallback={{ w: FALLBACK_W, h: heightFor(n, ROW_H) }} minHeight={() => heightFor(n, ROW_H)} maxHeight={() => heightFor(n, ROW_MAX)}>
      {({ w, h }) => draw(w, h)}
    </HeroChartFrame>
  );
}
