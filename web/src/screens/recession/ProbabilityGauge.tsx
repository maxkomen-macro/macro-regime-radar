/**
 * The recession probability gauge: the hero's signature visual (redesign
 * Phase 7, checklist 07 B.1.1), an inline semicircle SVG on the mockup's
 * geometry (recession.html:178). Three band arcs on the server's own 20 / 40
 * edges (`BANDS`), the progress arc in the served label's tone, a needle, a
 * hub, the tick labels, the band words as real <text> nodes (so "LOW /
 * ELEVATED / HIGH RISK" can be asserted on `svg text`) and the mono caption.
 * Static: nothing animates, so there is nothing to silence under reduced
 * motion. The number itself is the h1 beside it; the gauge never prints it.
 */

import { fmtProb } from "../../lib/format";
import { BANDS, toneColor, type LabelTone } from "./recession-copy";

export interface ProbabilityGaugeProps {
  prob: number;
  label: string;
  tone: LabelTone;
  /** The widest the drawing may render, px (default 360, the mockup size).
   * The hero passes the width its chart frame measured (Iteration 1 G3). */
  maxWidth?: number;
}

/** The drawing's aspect: viewBox 360 × 210. */
export const GAUGE_ASPECT = 210 / 360;

const CX = 180;
const CY = 180;
const R_BAND = 140;
const R_NEEDLE = 110;
const R_TICK = 162;
const R_WORD = 105;
/** Visual breathing room after each band edge (mockup: the next arc starts
 * 0.4 points past the edge); decoration, not a fourth edge. */
const BAND_GAP = 0.4;
const TICKS = [0, 20, 40, 100];

/** Angle mapping (RecessionScreen.tsx arcPoint, generalised to a centre and
 * radius): p in 0..100 → π(1 − p/100); x = cx + r cos, y = cy − r sin. */
export function arcPoint(p: number, r: number, cx = CX, cy = CY): [number, number] {
  const angle = Math.PI * (1 - p / 100);
  return [cx + r * Math.cos(angle), cy - r * Math.sin(angle)];
}

export function arcPath(p0: number, p1: number, r: number, cx = CX, cy = CY): string {
  const [x0, y0] = arcPoint(p0, r, cx, cy);
  const [x1, y1] = arcPoint(p1, r, cx, cy);
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
}

const f1 = (v: number) => Number(v.toFixed(1));

export default function ProbabilityGauge({ prob, label, tone, maxWidth = 360 }: ProbabilityGaugeProps): JSX.Element {
  const p = Math.max(0, Math.min(100, Number.isFinite(prob) ? prob : 0));
  const [nx, ny] = arcPoint(p, R_NEEDLE);
  const color = toneColor(tone) ?? "var(--text-3)";
  let start = 0;

  return (
    <svg
      viewBox="0 0 360 210"
      width="100%"
      role="img"
      aria-label={`Recession probability gauge at ${fmtProb(prob, "percent", 1)} · ${label}`}
      className="mrr-rec-gauge"
      style={{ display: "block", maxWidth, margin: "0 auto" }}
    >
      {BANDS.map((b, bi) => {
        const from = bi === 0 ? 0 : start + BAND_GAP;
        const d = arcPath(from, b.to, R_BAND);
        start = b.to;
        return <path key={b.to} data-role="band" d={d} fill="none" stroke={b.color} strokeWidth="18" strokeOpacity={bi === BANDS.length - 1 ? 0.22 : 0.28} />;
      })}
      {p > 0 ? <path data-role="progress" d={arcPath(0, p, R_BAND)} fill="none" stroke={color} strokeWidth="18" strokeOpacity="1" /> : null}
      <line data-role="needle" x1={CX} y1={CY} x2={f1(nx)} y2={f1(ny)} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={CX} cy={CY} r="6" fill="#fff" />
      {TICKS.map((t) => {
        const [x, y] = arcPoint(t, R_TICK);
        return (
          <text key={t} data-role="tick" x={f1(x)} y={f1(y + 4)} textAnchor="middle" fontSize="10" fill="#6f7d8a" style={{ fontFamily: "var(--font-mono)" }}>
            {t}
          </text>
        );
      })}
      {BANDS.map((b, bi) => {
        const lo = bi === 0 ? 0 : BANDS[bi - 1].to;
        const [x, y] = arcPoint((lo + b.to) / 2, R_WORD);
        return (
          <text
            key={b.word}
            data-role="band-word"
            x={f1(x)}
            y={f1(y + 4)}
            textAnchor="middle"
            fontSize="9"
            letterSpacing=".1em"
            fill={b.color}
            fillOpacity=".8"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {b.word}
          </text>
        );
      })}
      <text data-role="caption" x={CX} y="204" textAnchor="middle" fontSize="10" letterSpacing=".1em" fill="var(--text-3)" style={{ fontFamily: "var(--font-mono)" }}>
        12-MONTH PROBABILITY
      </text>
    </svg>
  );
}
