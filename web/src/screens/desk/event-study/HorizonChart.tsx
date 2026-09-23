/**
 * The horizon chart (DESK_FRAME2_SPEC §3): the four horizons on the x-axis;
 * for each, the conditional median (mint, the subject of the study) beside
 * the baseline median (link blue, DESIGN.md's secondary series), the engine's
 * 90% interval drawn on the conditional bar, and a marker for the engine's
 * exclusion verdict under the horizon. Inline SVG in the house chart idiom
 * (axis labels Plex Mono 10px #6f7d8a, gridlines --line-2).
 *
 * The interval is the engine's interval on Δ (median − baseline median). The
 * engine resamples the event medians and subtracts the fixed baseline median
 * (src/desk/event_study.py, horizon_stats), so on the conditional bar the
 * interval sits at baseline median + each bound. That offset is plotting
 * geometry only: the printed interval is the served one, on Δ, and no derived
 * number is printed anywhere. The simple form (client view) drops the interval
 * and the value labels and names each verdict in words. A click on a horizon
 * selects it for pointer users; the horizon cells under the chart are the
 * keyboard path to the same selection.
 */

import type { EventStudyHorizon } from "../../../api/desk";
import { useChartWidth } from "./useChartWidth";
import { moveInWords, sessionsInWords } from "../words";
import { EXCLUSION_CLIENT, EXCLUSION_CLIENT_SHORT, exclusionWord, fmtInterval, fmtMove, type MoveUnit } from "./format";

const AXIS = "#6f7d8a";
const GLYPH: Record<string, string> = { established: "●", "not established": "◐", included: "○" };
const TONE: Record<string, string> = { established: "var(--mint)", "not established": "var(--amber)", included: "var(--text-3)" };

/** Round steps (1, 2, 2.5, 5 × 10^k), about four intervals, the first tick at
 * or below `lo` and the last at or above `hi`, so the axis spans the ticks. */
export function niceTicks(lo: number, hi: number): number[] {
  const span = hi - lo || 1;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  const end = Math.ceil(hi / step - 1e-9) * step;
  for (let t = Math.floor(lo / step + 1e-9) * step; t <= end + step * 1e-9; t += step) out.push(Number(t.toFixed(10)) || 0);
  return out;
}

function glyphFor(h: EventStudyHorizon): string {
  return h.exclusion ? GLYPH[h.exclusion] : "·";
}

export interface HorizonChartProps {
  horizons: EventStudyHorizon[];
  unit: MoveUnit;
  targetLabel: string;
  /** The client view's simple form: bars and verdict words, no interval, no value labels. */
  simple?: boolean;
  selected?: number | null;
  onSelect?: (h: number) => void;
}

export default function HorizonChart({ horizons, unit, targetLabel, simple = false, selected = null, onSelect }: HorizonChartProps) {
  const [box, W] = useChartWidth<HTMLDivElement>(640);
  const isNarrow = W < 480;
  const H = simple ? 220 : 250;
  const PAD = { top: simple ? 14 : 24, right: 8, bottom: isNarrow ? 40 : 44, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const whisker = (h: EventStudyHorizon): [number, number] | null => (!simple && h.ci90 && h.baseline_median != null ? [h.baseline_median + h.ci90[0], h.baseline_median + h.ci90[1]] : null);
  const values = [0, ...horizons.flatMap((h) => [h.median, h.baseline_median, ...(whisker(h) ?? [])])].filter((v): v is number => v != null && Number.isFinite(v));
  const lo0 = Math.min(...values);
  const hi0 = Math.max(...values);
  const padV = (hi0 - lo0) * 0.12 || 1;
  const ticks = niceTicks(lo0 - padV, hi0 + padV);
  const lo = Math.min(lo0 - padV, ticks[0]);
  const hi = Math.max(hi0 + padV, ticks[ticks.length - 1]);
  const sy = (v: number) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;
  const groupW = plotW / Math.max(1, horizons.length);
  const bw = Math.min(40, groupW * 0.28);
  const gap = 6;
  const zeroY = sy(0);

  const label = `Median ${targetLabel} move after the event against the baseline median, by horizon. ${horizons
    .map((h) =>
      simple
        ? `${sessionsInWords(h.h)}: ${moveInWords(h.median, unit, undefined, true)} against ${moveInWords(h.baseline_median, unit, undefined, true)} at baseline, ${h.exclusion ? EXCLUSION_CLIENT[h.exclusion] : exclusionWord(h)}.`
        : `${h.h} sessions: ${fmtMove(h.median, unit)} against ${fmtMove(h.baseline_median, unit)}, 90% interval on the difference ${fmtInterval(h.ci90, unit) ?? "not served"}, ${exclusionWord(h)}.`,
    )
    .join(" ")}`;

  return (
    <div ref={box} className="mrr-desk-svg" data-chart="horizons">
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
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="var(--line-strong)" />
        {horizons.map((h, i) => {
          const cx = PAD.left + groupW * i + groupW / 2;
          const condX = cx - gap / 2 - bw;
          const baseX = cx + gap / 2;
          const bar = (v: number | null) => (v == null ? null : { y: Math.min(sy(v), zeroY), height: Math.max(1, Math.abs(sy(v) - zeroY)) });
          const cb = bar(h.median);
          const bb = bar(h.baseline_median);
          const wk = whisker(h);
          const tone = h.exclusion ? TONE[h.exclusion] : "var(--text-3)";
          const isSel = selected === h.h;
          // A value label sits above what it labels: the bar's top, or the
          // interval's top when one is drawn (never beside the y-axis, V-06).
          const topOf = (v: number | null, extra?: number) => Math.min(zeroY, v == null ? zeroY : sy(v), extra == null ? zeroY : sy(extra)) - 5;
          const marker = simple && h.exclusion ? EXCLUSION_CLIENT_SHORT[h.exclusion] : exclusionWord(h);
          return (
            <g
              key={h.h}
              data-h={h.h}
              data-selected={isSel ? "true" : undefined}
              onClick={onSelect ? () => onSelect(h.h) : undefined}
              style={{ cursor: onSelect ? "pointer" : undefined }}
            >
              <rect x={PAD.left + groupW * i + 2} y={PAD.top} width={groupW - 4} height={plotH} fill={isSel ? "rgba(88,184,230,.07)" : "transparent"} rx="4" />
              {cb ? <rect x={condX} y={cb.y} width={bw} height={cb.height} fill="var(--mint)" fillOpacity="0.85" data-bar="conditional" /> : null}
              {bb ? <rect x={baseX} y={bb.y} width={bw} height={bb.height} fill="var(--link)" fillOpacity="0.28" stroke="var(--link)" strokeOpacity="0.7" data-bar="baseline" /> : null}
              {wk ? (
                <g stroke="var(--text)" strokeOpacity="0.9" strokeWidth="1.5" data-interval="ci90">
                  <line x1={condX + bw / 2} x2={condX + bw / 2} y1={sy(wk[0])} y2={sy(wk[1])} />
                  <line x1={condX + bw * 0.25} x2={condX + bw * 0.75} y1={sy(wk[0])} y2={sy(wk[0])} />
                  <line x1={condX + bw * 0.25} x2={condX + bw * 0.75} y1={sy(wk[1])} y2={sy(wk[1])} />
                </g>
              ) : null}
              {!simple && !isNarrow && h.median != null ? (
                <text x={condX + bw / 2} y={topOf(h.median, wk?.[1])} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill="var(--text-2)" data-label="median">
                  {fmtMove(h.median, unit)}
                </text>
              ) : null}
              {!simple && !isNarrow && h.baseline_median != null ? (
                <text x={baseX + bw / 2} y={topOf(h.baseline_median)} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fill={AXIS} data-label="baseline">
                  {fmtMove(h.baseline_median, unit)}
                </text>
              ) : null}
              <text x={cx} y={H - PAD.bottom + 15} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10.5" fill={isSel ? "var(--text)" : "var(--text-2)"}>
                {simple && !isNarrow ? sessionsInWords(h.h) : `${h.h}d`}
              </text>
              <text x={cx} y={H - PAD.bottom + 31} textAnchor="middle" fontFamily="var(--font-ui)" fontSize="11" fill={tone} data-exclusion={h.exclusion ?? "none"}>
                {glyphFor(h)}
                {isNarrow ? "" : ` ${marker}`}
              </text>
            </g>
          );
        })}
      </svg>
      {isNarrow ? (
        // At phone width the verdict words leave the chart for a list, one
        // line per horizon, so a client still reads each verdict (V-04).
        <ul className="mrr-desk-hverdicts" aria-hidden="true">
          {horizons.map((h) => (
            <li key={h.h} data-exclusion={h.exclusion ?? "none"}>
              <span>{sessionsInWords(h.h)}</span>
              <span>
                {glyphFor(h)} {simple && h.exclusion ? EXCLUSION_CLIENT[h.exclusion] : exclusionWord(h)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="mrr-desk-legend" aria-hidden="true">
        <li>
          <i style={{ background: "var(--mint)" }} /> {simple ? "After the event, typical move" : "Median after the event"}
        </li>
        <li>
          <i style={{ background: "rgba(88,184,230,.35)", border: "1px solid var(--link)" }} /> {simple ? "Any session, typical move" : "Baseline median, every evaluable session"}
        </li>
        {!simple ? (
          <li>
            <i style={{ background: "none", borderLeft: "1.5px solid var(--text)", width: 2, borderRadius: 0 }} /> 90% interval on the difference, drawn on the event bar
          </li>
        ) : null}
        <li>
          {simple ? `● ${EXCLUSION_CLIENT.established} · ○ ${EXCLUSION_CLIENT.included} · ◐ ${EXCLUSION_CLIENT["not established"]}` : "● established · ○ included · ◐ not established"}
        </li>
      </ul>
    </div>
  );
}
