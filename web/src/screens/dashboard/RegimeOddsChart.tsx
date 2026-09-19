/**
 * RegimeOddsChart: the Dashboard hero's signature chart (Iteration 1, D1). The
 * classifier's four stored monthly probabilities over the last 24 stored
 * months, stacked bottom to top in house order (Goldilocks, Overheating,
 * Stagflation, Recession Risk), so each month's column reads as the four-way
 * split. It replaced the "Regime odds · 24 months" line chart in the Macro
 * charts accordion: the chart appears once on the page.
 *
 * Honest data: every band edge is a running sum of the served
 * `prob_*` fields of that month, drawn as stored (never renormalised, a null
 * reads as 0); nothing is re-derived. The current month (the newest stored
 * row) carries the marker (`data-current-month`) and its served label places
 * the marker dot. The four hues are named at the right edge beside their
 * bands (no boxed legend) and one caption line sits under the plot. The
 * hero's pill is the only place the dominant figure prints, so the end labels
 * carry names, not percentages.
 *
 * Drawn through HeroChartFrame at the hero column's own size, 1:1, so the
 * words keep their set size at every width. The frame's floor follows the
 * width (0.4 of it, 220 to 280 px) and the drawing may grow to 1.7 times the
 * width, 660 px at most, when a two-column hero is stretched by its row.
 */

import type { CSSProperties } from "react";
import type { Regime } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import { HeroChartFrame, clampPx } from "../shared/HeroChart";
import { REGIMES, REGIME_HUE, type RegimeName } from "../regimelab/regime-history";

export interface RegimeOddsChartProps {
  /** Ascending stored monthly rows; the last `months` are drawn. */
  rows: Regime[];
  months?: number;
}

const KEYS: Record<RegimeName, keyof Regime> = {
  Goldilocks: "prob_goldilocks",
  Overheating: "prob_overheating",
  Stagflation: "prob_stagflation",
  "Recession Risk": "prob_recession",
};

/** The caption line under the plot (its box, margin included). */
const CAP_H = 22;
const PAD_L = 38;
const PAD_T = 10;
const PAD_B = 24;
/** End-label column: swatch, gap, the longest name at 11.5px (≈6.4px a glyph). */
const SWATCH = 7;
const NAME_X = 10;
const LABEL_W = NAME_X + SWATCH + 5 + Math.ceil(Math.max(...REGIMES.map((r) => r.length)) * 6.4) + 4;
/** Minimum distance between two end-label baselines. */
const LABEL_GAP = 15;
const FALLBACK = { w: 400, h: 300 };
const minHeight = (w: number) => clampPx(w * 0.4, 220, 280) + CAP_H;
const maxHeight = (w: number) => clampPx(w * 1.7, 260, 660) + CAP_H;

const AXIS: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em" };
/** #7d8b98 clears 4.5:1 on the hero card (the quadrant's axis ink). */
const AXIS_FILL = "#7d8b98";
const STAMP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: ".04em" };
const NAME: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 500 };
/** Name ink per regime: the hue, except Stagflation, whose #e74c3c falls to
 * about 4:1 under the hero's mint glow; it takes the design system's
 * stagflation text rung (DESIGN.md colors, regime-stagflation-text), 6:1. */
const NAME_FILL: Record<string, string> = { ...REGIME_HUE, Stagflation: "#f08785" };

const round1 = (v: number) => Math.round(v * 10) / 10;
/** "2026-07-01" → 2026 × 12 + 6: whole calendar months, zone-free. */
const monthIndex = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split("-").map(Number);
  return y * 12 + ((m ?? 1) - 1);
};
const prob = (r: Regime, name: RegimeName) => {
  const v = r[KEYS[name]] as number | null | undefined;
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0;
};

/** Spread label centres at least `gap` apart inside [lo, hi], keeping order. */
export function spreadLabels(want: number[], gap: number, lo: number, hi: number): number[] {
  const out = want.map((y) => Math.min(hi, Math.max(lo, y)));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  if (out.length && out[out.length - 1] > hi) {
    out[out.length - 1] = hi;
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out.map(round1);
}

export function RegimeOddsChart({ rows: all, months = 24 }: RegimeOddsChartProps) {
  const rows = all.slice(-months);
  const n = rows.length;
  const last = rows[n - 1];
  const first = rows[0];
  if (n < 2 || !last || !first) return null;

  const ariaLabel = `Classifier regime odds by month, stacked to the four-way split, ${fmtMonYr(first.date)} to ${fmtMonYr(last.date)}; ${fmtMonYr(
    last.date,
  )} is the current month, called ${last.label}.`;

  const draw = (w: number, h: number) => {
    const x0 = PAD_L;
    const x1 = Math.max(x0 + 40, w - LABEL_W);
    const y0 = PAD_T;
    const y1 = h - PAD_B;
    // Calendar months, not row indices: a month missing from the store
    // shows as a wider step, never as a squeezed-out gap.
    const m0 = monthIndex(first.date);
    const span = Math.max(1, monthIndex(last.date) - m0);
    const X = (i: number) => round1(x0 + ((monthIndex(rows[i].date) - m0) / span) * (x1 - x0));
    const Y = (v: number) => round1(y1 - v * (y1 - y0));

    // Running sums per month, bottom to top in house order.
    const edges = rows.map((r) => {
      const out = [0];
      for (const name of REGIMES) out.push(out[out.length - 1] + prob(r, name));
      return out;
    });
    const bands = REGIMES.map((name, k) => {
      const top = rows.map((_, i) => `${X(i)},${Y(edges[i][k + 1])}`);
      const bottom = rows.map((_, i) => `${X(i)},${Y(edges[i][k])}`).reverse();
      return { name, area: `M${top.join("L")}L${bottom.join("L")}Z`, line: `M${top.join("L")}` };
    });

    // End labels beside the current month, top band first.
    const lastEdges = edges[n - 1];
    const order = REGIMES.map((name, k) => ({ name, want: (Y(lastEdges[k]) + Y(lastEdges[k + 1])) / 2 })).reverse();
    const placed = spreadLabels(
      order.map((o) => o.want),
      LABEL_GAP,
      y0 + 6,
      y1 - 4,
    );
    const lead = REGIMES.indexOf(last.label as RegimeName);
    const dotY = lead >= 0 ? (Y(lastEdges[lead]) + Y(lastEdges[lead + 1])) / 2 : null;
    const showFirst = x1 - x0 >= 150;

    return (
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={ariaLabel} style={{ display: "block", maxWidth: "100%" }}>
        {[1, 0.5, 0].map((v) => (
          <g key={v}>
            <line x1={x0} x2={x1} y1={Y(v)} y2={Y(v)} stroke="rgba(150,175,200,.12)" />
            <text x={x0 - 6} y={Y(v) + 3.5} textAnchor="end" fill={AXIS_FILL} style={AXIS}>
              {v * 100}%
            </text>
          </g>
        ))}
        {bands.map((b) => (
          <g key={b.name} className="mrr-odds-band" data-regime={b.name}>
            <path d={b.area} style={{ fill: REGIME_HUE[b.name] }} fillOpacity={0.62} />
            <path d={b.line} fill="none" style={{ stroke: REGIME_HUE[b.name] }} strokeWidth={1.25} strokeLinejoin="round" />
          </g>
        ))}
        {showFirst ? (
          <text x={x0} y={h - 8} fill={AXIS_FILL} style={AXIS}>
            {fmtMonYr(first.date)}
          </text>
        ) : null}
        <g className="mrr-odds-current" data-current-month={last.date.slice(0, 10)}>
          <line x1={x1} x2={x1} y1={y0 - 2} y2={y1 + 4} stroke="#fff" strokeOpacity={0.6} strokeDasharray="3 3" />
          {dotY != null ? (
            <circle cx={x1} cy={round1(dotY)} r={4.5} style={{ fill: REGIME_HUE[last.label] }} stroke="#031a12" strokeWidth={1.5} />
          ) : null}
          <text x={x1} y={h - 8} textAnchor="end" fill="#dff7ee" style={STAMP}>
            {fmtMonYr(last.date)}
          </text>
        </g>
        <g className="mrr-odds-labels">
          {order.map((o, i) => {
            const y = placed[i];
            const moved = Math.abs(y - o.want) > 2;
            return (
              <g key={o.name}>
                {moved ? (
                  <line x1={x1 + 2} x2={x1 + NAME_X - 1} y1={round1(o.want)} y2={y} style={{ stroke: REGIME_HUE[o.name] }} strokeOpacity={0.7} />
                ) : null}
                <rect x={x1 + NAME_X} y={round1(y - SWATCH / 2)} width={SWATCH} height={SWATCH} rx={1.5} style={{ fill: REGIME_HUE[o.name] }} />
                <text x={x1 + NAME_X + SWATCH + 5} y={round1(y + 4)} style={{ ...NAME, fill: NAME_FILL[o.name] }}>
                  {o.name}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    );
  };

  return (
    <HeroChartFrame fallback={FALLBACK} minHeight={minHeight} maxHeight={maxHeight}>
      {({ w, h }) => (
        <figure data-chart="" className="mrr-odds-chart" style={{ width: w, maxWidth: "100%", minWidth: 0, margin: 0 }}>
          {draw(w, h - CAP_H)}
          <figcaption
            className="mrr-odds-cap"
            data-copy="caption"
            style={{
              marginTop: 6,
              height: CAP_H - 6,
              lineHeight: `${CAP_H - 6}px`,
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              color: "var(--text-3)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            <span
              className="mrr-odds-cap-k"
              style={{ fontWeight: 500, fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-eyebrow)" }}
            >
              Regime odds · {n} months
            </span>{" "}
            · widest band is the call
          </figcaption>
        </figure>
      )}
    </HeroChartFrame>
  );
}

export default RegimeOddsChart;
