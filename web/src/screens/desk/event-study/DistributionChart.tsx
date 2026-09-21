/**
 * The forward-move distribution: conditional events against the baseline of
 * every session, as two histograms on one axis. Inline SVG in the house chart
 * idiom (axis labels Plex Mono 10px #6f7d8a, gridlines --line-2), the
 * conditional in mint (the subject of the study), the baseline in link blue
 * (the secondary series, DESIGN.md §2), each named in the legend in words.
 * Shares, not counts, so the two are comparable; the sentence in aria-label
 * says the same thing the picture does.
 */

import type { EventStudyDistribution } from "../../../api/desk";

const W = 640;
const H = 230;
const PAD = { top: 12, right: 12, bottom: 30, left: 38 };

function shares(xs: number[]): number[] {
  const total = xs.reduce((a, b) => a + b, 0);
  return total > 0 ? xs.map((x) => (x / total) * 100) : xs.map(() => 0);
}

export default function DistributionChart({ d, unit, nEvents }: { d: EventStudyDistribution; unit: string; nEvents: number }) {
  const cond = shares(d.conditional);
  const base = shares(d.baseline);
  const bins = Math.min(cond.length, base.length, d.edges.length - 1);
  const max = Math.max(1, ...cond.slice(0, bins), ...base.slice(0, bins));
  const x0 = d.edges[0];
  const x1 = d.edges[bins];
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const sx = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * plotW;
  const sy = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const peakCond = cond.indexOf(Math.max(...cond.slice(0, bins)));
  const label = `Distribution of ${d.h}-session forward moves in ${unit}: ${nEvents} conditional events against every session. The conditional peak sits between ${d.edges[peakCond]} and ${d.edges[peakCond + 1]} ${unit}.`;
  return (
    <div className="mrr-desk-svg">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} data-chart="distribution">
        <title>{label}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--line-2)" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="#6f7d8a">
              {Math.round(t)}%
            </text>
          </g>
        ))}
        {Array.from({ length: bins }, (_, i) => {
          const left = sx(d.edges[i]);
          const right = sx(d.edges[i + 1]);
          const w = right - left;
          return (
            <g key={i}>
              <rect x={left + 1} y={sy(base[i])} width={Math.max(0, w - 2)} height={PAD.top + plotH - sy(base[i])} fill="var(--link)" fillOpacity="0.28" stroke="var(--link)" strokeOpacity="0.7" />
              <rect x={left + w * 0.25} y={sy(cond[i])} width={Math.max(0, w * 0.5)} height={PAD.top + plotH - sy(cond[i])} fill="var(--mint)" fillOpacity="0.85" />
            </g>
          );
        })}
        <line x1={sx(0)} x2={sx(0)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--line-strong)" strokeDasharray="2 3" />
        {d.edges.slice(0, bins + 1).map((e, i) =>
          i % 2 === 0 ? (
            <text key={e} x={sx(e)} y={H - 10} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="#6f7d8a">
              {e > 0 ? `+${e}` : e}
            </text>
          ) : null,
        )}
        <text x={W - PAD.right} y={H - 10} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill="#6f7d8a">
          {unit}
        </text>
      </svg>
      <ul className="mrr-desk-legend" aria-hidden="true">
        <li>
          <i style={{ background: "var(--mint)" }} /> Conditional · {nEvents} events · share of events
        </li>
        <li>
          <i style={{ background: "rgba(88,184,230,.35)", border: "1px solid var(--link)" }} /> Baseline · every session · share of sessions
        </li>
        <li>
          <i style={{ background: "none", borderTop: "1px dashed var(--line-strong)", height: 0, width: 14, borderRadius: 0 }} /> zero
        </li>
      </ul>
    </div>
  );
}
