/**
 * The distribution view behind the horizon chart's "Distribution" toggle
 * (DESK_FRAME2_SPEC §3). The engine serves no histogram bins, so the frame's
 * histogram cannot be drawn from the response; what it does serve per horizon
 * is each side's quartiles: p25, median and p75 for the events and
 * baseline_p25, baseline_median and baseline_p75 for every evaluable session.
 * Drawn as paired boxes (the middle half of the moves, the median as a tick),
 * events in mint and the baseline in link blue, on the horizon chart's axis
 * idiom. Every drawn value is a served field.
 */

import type { EventStudyHorizon } from "../../../api/desk";
import { useChartWidth } from "./useChartWidth";
import { fmtMove, type MoveUnit } from "./format";
import { niceTicks } from "./HorizonChart";

const AXIS = "#6f7d8a";

export default function QuartileChart({ horizons, unit, targetLabel }: { horizons: EventStudyHorizon[]; unit: MoveUnit; targetLabel: string }) {
  const [wrap, W] = useChartWidth<HTMLDivElement>(640);
  const H = 240;
  const PAD = { top: 12, right: 8, bottom: 30, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const values = [0, ...horizons.flatMap((h) => [h.p25, h.p75, h.baseline_p25, h.baseline_p75, h.median, h.baseline_median])].filter((v): v is number => v != null && Number.isFinite(v));
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const padV = (hi0 - lo0) * 0.08 || 1;
  const ticks = niceTicks(lo0 - padV, hi0 + padV);
  const lo = Math.min(lo0 - padV, ticks[0]);
  const hi = Math.max(hi0 + padV, ticks[ticks.length - 1]);
  const sy = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const groupW = plotW / Math.max(1, horizons.length);
  const bw = Math.min(38, groupW * 0.28);

  const label = `The middle half of ${targetLabel} forward moves (25th to 75th percentile) with the median, after the event against every session. ${horizons
    .map((h) => `${h.h} sessions: events ${fmtMove(h.p25, unit)} to ${fmtMove(h.p75, unit)}, baseline ${fmtMove(h.baseline_p25, unit)} to ${fmtMove(h.baseline_p75, unit)}.`)
    .join(" ")}`;

  const box = (x: number, p25: number | null, med: number | null, p75: number | null, fill: string, stroke: string, key: string) =>
    p25 == null || p75 == null ? null : (
      <g key={key} data-box={key}>
        <rect x={x} y={sy(p75)} width={bw} height={Math.max(1, sy(p25) - sy(p75))} fill={fill} stroke={stroke} strokeOpacity="0.8" rx="2" />
        {med != null ? <line x1={x} x2={x + bw} y1={sy(med)} y2={sy(med)} stroke="var(--text)" strokeWidth="1.5" /> : null}
      </g>
    );

  return (
    <div ref={wrap} className="mrr-desk-svg" data-chart="quartiles">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke="var(--line-2)" />
            <text x={PAD.left - 6} y={sy(t) + 3} textAnchor="end" fontFamily="var(--font-mono)" fontSize="10" fill={AXIS}>
              {fmtMove(t, unit).replace(" bp", "")}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={sy(0)} y2={sy(0)} stroke="var(--line-strong)" strokeDasharray="2 3" />
        {horizons.map((h, i) => {
          const cx = PAD.left + groupW * i + groupW / 2;
          return (
            <g key={h.h}>
              {box(cx - 3 - bw, h.p25, h.median, h.p75, "rgba(38,220,160,.55)", "var(--mint)", `events-${h.h}`)}
              {box(cx + 3, h.baseline_p25, h.baseline_median, h.baseline_p75, "rgba(88,184,230,.22)", "var(--link)", `baseline-${h.h}`)}
              <text x={cx} y={H - 10} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10.5" fill="var(--text-2)">
                {h.h}d
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mrr-desk-legend" aria-hidden="true">
        <li>
          <i style={{ background: "rgba(38,220,160,.55)", border: "1px solid var(--mint)" }} /> After the event: 25th to 75th percentile, median as the line
        </li>
        <li>
          <i style={{ background: "rgba(88,184,230,.22)", border: "1px solid var(--link)" }} /> Every evaluable session, the same quartiles
        </li>
      </ul>
    </div>
  );
}
