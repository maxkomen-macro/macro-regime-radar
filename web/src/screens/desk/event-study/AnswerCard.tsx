/**
 * The answer card (DESK_FRAME3_SPEC §4): the headline in serif, whether the
 * setup is firing today and how the answer was served, four stats, the
 * horizon chart (the median after the event, blue, beside a normal stretch,
 * gray, with the range the answer could fall in as a whisker on the event
 * bar) and the line on the same question without its condition. Fewer than
 * ten events: one sentence and two fixes, no chart (§1.7).
 */

import type { StudyHorizon, StudyResponse, TargetUnit } from "../data/types";
import { dayLong, isFiniteNumber as fin, monthYear, pctPlain, year } from "../kit/format";
import { useBox } from "../kit/LineChart";
import { Awaiting, NotServedBadge, Signed, Stat, StatRow, useBlockUnserved, useUnserved, VerdictWord } from "../kit/ui";
import { WINDOWS, horizonLabel } from "./question";
import { isUnit, moveText, scaleOf, tickText } from "./units";

/** Whether a fix from the empty state changes the question (no wider window than 60, no condition to drop). */
function applies(q: StudyResponse["question"], fix: string): boolean {
  if (fix === "widen_window") return WINDOWS.some((w) => w > q.window);
  if (fix === "drop_condition") return q.while !== "none";
  return true;
}

const BLUE = "#58b8e6";
const GRAY = "#8b929e";

/** "a month", "a week", "2 weeks", "3 months": the horizon inside a stat label. */
export function horizonPhrase(h: number): string {
  const l = horizonLabel(h);
  return l.startsWith("1 ") ? `a ${l.slice(2)}` : l;
}

/** "in a normal month", "over a normal two weeks": the baseline's stretch in words. */
export function normalStretch(h: number): string {
  return ({ 5: "in a normal week", 10: "over a normal two weeks", 20: "in a normal month", 60: "over a normal three months" } as Record<number, string>)[h] ?? "over a normal stretch of the same length";
}

/** A round step for basis points or price points: the largest 1, 2 or 5 × 10ⁿ at or under `hi`. */
function roundStep(hi: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(hi, 1e-9)));
  return [5, 2, 1].map((m) => m * mag).find((s) => s <= hi) ?? mag;
}

/** The chart's y ticks (§4: +5% / 0 / −3% for the gold study): zero, the
 * largest round step at or under the top, and a negative tick at 60% of it
 * when the data sit above it (or the round step under the bottom). A percent
 * steps by 5, 1 or a half; basis points and price points by 1, 2 or 5 × 10ⁿ
 * (+50 bp / 0 / −30 bp), the negative tick rounded to a whole step's tenth. */
export function barTicks(lo: number, hi: number, unit: TargetUnit = "pct"): number[] {
  const step = unit === "pct" ? (hi >= 5 ? 5 : hi >= 2 ? 1 : 0.5) : roundStep(hi);
  const pos = Math.max(step, Math.floor(hi / step) * step);
  const tenths = unit === "pct" ? 1 : 10 / step; // ticks per unit: a percent's whole points, else tenths of a step
  const neg = lo < -0.6 * pos ? -Math.ceil(-lo / step) * step : -Math.round(0.6 * pos * tenths) / tenths;
  return [neg, 0, pos];
}

/** A horizon the chart can draw: its median, baseline and range all served as finite numbers, in the chart's units. */
type Drawn = { h: StudyHorizon; med: number; base: number; lo: number; hi: number };
function drawn(h: StudyHorizon, unit: TargetUnit): Drawn | null {
  if (!fin(h.median) || !fin(h.baseline_median) || !fin(h.ci_lo_pts) || !fin(h.ci_hi_pts)) return null;
  const k = scaleOf(unit);
  const base = h.baseline_median * k;
  return { h, med: h.median * k, base, lo: base + h.ci_lo_pts, hi: base + h.ci_hi_pts };
}

function Bars({ horizons, unit }: { horizons: StudyHorizon[]; unit: TargetUnit }) {
  const [ref, width, boxH] = useBox<HTMLDivElement>(640, 360);
  const height = Math.max(260, boxH);
  const pad = { l: 56, r: 12, t: 28, b: 40 };
  // Every horizon keeps its place and label; one whose numbers were not served draws no bar and says so.
  const pts = horizons.map((h) => ({ h, d: drawn(h, unit) }));
  const k = scaleOf(unit);
  const vals = pts.flatMap((p) => (p.d ? [p.d.med, p.d.base, p.d.lo, p.d.hi] : []));
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const ticks = barTicks(lo, hi, unit);
  // Room below and above the ticks: 0.6 and 0.9 of a percent, the same share of the top tick in bp or points.
  const room = unit === "pct" ? 1 : ticks[2] / 5;
  const dLo = Math.min(ticks[0], lo) - 0.6 * room;
  const dHi = Math.max(ticks[2], hi) + 0.9 * room;
  const pw = width - pad.l - pad.r;
  const ph = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ((dHi - v) / (dHi - dLo)) * ph;
  const group = pw / Math.max(1, pts.length);
  const bw = Math.min(42, group * 0.2);
  return (
    <div ref={ref} className="dk-chart es-bars">
      <svg width={width} height={height} role="img" aria-label={`The median move after the event against a normal stretch, with its range, at each horizon: ${pts.map((p) => (p.d ? `${p.h.label} ${moveText(p.d.med / k, unit)} against ${moveText(p.d.base / k, unit)}` : `${p.h.label} awaiting refresh`)).join("; ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "dk-chart-zero" : "dk-chart-grid"} x1={pad.l} x2={pad.l + pw} y1={y(t)} y2={y(t)} />
            <text className="dk-chart-axis" x={pad.l - 10} y={y(t) + 4} textAnchor="end">
              {tickText(t, unit)}
            </text>
          </g>
        ))}
        {pts.map(({ h, d: p }, i) => {
          const cx = pad.l + group * (i + 0.5);
          const ex = cx - bw - 2;
          const bx = cx + 2;
          const top = (v: number) => Math.min(y(v), y(0));
          const hgt = (v: number) => Math.abs(y(v) - y(0));
          const wx = ex + bw / 2;
          if (!p)
            return (
              <g key={h.h}>
                <text className="es-bar-value" x={cx} y={y(0) - 9} textAnchor="middle">
                  Awaiting refresh
                </text>
                <text className="es-bar-label" x={cx} y={height - 12} textAnchor="middle">
                  {h.label}
                </text>
              </g>
            );
          return (
            <g key={h.h}>
              <rect x={ex} y={top(p.med)} width={bw} height={Math.max(1, hgt(p.med))} fill={BLUE} />
              <rect x={bx} y={top(p.base)} width={bw} height={Math.max(1, hgt(p.base))} fill={GRAY} fillOpacity={0.35} />
              <line x1={wx} x2={wx} y1={y(p.hi)} y2={y(p.lo)} stroke={BLUE} strokeWidth={2} />
              <line x1={wx - 8} x2={wx + 8} y1={y(p.hi)} y2={y(p.hi)} stroke={BLUE} strokeWidth={2} />
              <line x1={wx - 8} x2={wx + 8} y1={y(p.lo)} y2={y(p.lo)} stroke={BLUE} strokeWidth={2} />
              <text className="es-bar-value" x={wx} y={y(p.hi) - 9} textAnchor="middle">
                {moveText(p.med / k, unit)}
              </text>
              <text className="es-bar-label" x={cx} y={height - 12} textAnchor="middle">
                {p.h.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** "0.3s, cached" from the served timing (milliseconds under a tenth of a second). */
export function servedWords(s: Pick<StudyResponse, "elapsed_ms" | "served_from_cache">): string {
  const ms = s.elapsed_ms;
  const t = !fin(ms) ? null : ms < 100 ? `${Math.max(0, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)}s`;
  return [t, s.served_from_cache ? "cached" : null].filter(Boolean).join(", ");
}

/** The line on the same question without its condition (§4, `without_condition`). */
export function WithoutCondition({ study, label }: { study: StudyResponse; label: (k: string) => string }) {
  const w = study.without_condition;
  const q = study.question;
  // The block is its own envelope (§12.2, C-01): served awaiting, the line keeps its lead and prints the reason.
  const off = useBlockUnserved(study, "without_condition");
  if (q.while === "none") return null;
  const cond = q.while.startsWith("regime:") ? "the regime condition" : "the S&P condition";
  if (off)
    return (
      <p className="es-without">
        <b>Without {cond}</b>: <span className="dk-unserved-inline">{off.reason}</span>
      </p>
    );
  if (!w) return null;
  const move = q.move === "up2s" ? "+2σ" : q.move === "down2s" ? "−2σ" : q.move === "cross_above" ? "crossing above its average" : "crossing below its average";
  const median = moveText(w.median, q.target_unit);
  // Whether the condition helps is the engine's call, served as its sentence (Codex R-12); the page ranks nothing.
  const note = typeof w.comparison_note === "string" && w.comparison_note ? w.comparison_note : null;
  return (
    <p className="es-without">
      <b>Without {cond}</b> — {label(q.shock)} {move} on its own — it&rsquo;s {[fin(w.n_events) ? `${w.n_events} events` : null, fin(w.up_pct) ? `up ${pctPlain(w.up_pct)}` : null, median ? `median ${median}` : null].filter(Boolean).join(", ") || "awaiting refresh"}: <VerdictWord verdict={w.verdict} />.{" "}
      {note ?? <span className="es-without-await">Whether the condition helps is awaiting refresh.</span>}
    </p>
  );
}

export default function AnswerCard({
  study,
  failed,
  busy = false,
  label,
  onFix,
  horizon,
}: {
  study: StudyResponse | undefined;
  failed: boolean;
  busy?: boolean;
  label: (k: string) => string;
  onFix: (fix: string) => void;
  /** The asked horizon, for the stat labels before an answer. */
  horizon?: number;
}) {
  const unserved = useUnserved();
  if (!study) {
    const p = horizonPhrase(horizon ?? 20);
    return (
      <section className="dk-card es-answer" aria-label="The answer" aria-busy={!failed && !unserved}>
        {unserved ? (
          <div className="es-pills">
            <NotServedBadge />
          </div>
        ) : null}
        <StatRow cols={4}>
          {["Events", `Up ${p} later`, `Median at ${p}`, "Worst · best"].map((l) => (
            <Stat key={l} label={l} awaiting={failed} />
          ))}
        </StatRow>
        {failed ? <Awaiting>the study did not answer</Awaiting> : null}
      </section>
    );
  }
  const n = study.n_events;
  if (study.verdict === "insufficient" || (fin(n) && n < 10)) {
    const q = study.question;
    const served = Array.isArray(study.empty_state?.fixes) ? study.empty_state.fixes : ["widen_window", "drop_condition"];
    const fixes = served.filter((f) => !q || applies(q, f));
    return (
      <section className="dk-card es-answer" aria-label="The answer">
        <p className="es-headline">{study.empty_state?.sentence ?? (fin(n) ? `Only ${n} events${year(study.sample_start) ? ` since ${year(study.sample_start)}` : ""} — too few to score.` : "Too few events to score.")}</p>
        {fixes.length ? (
          <div className="es-fixes" role="group" aria-label="Ways to get enough events">
            {fixes.map((f) => (
              <button key={f} type="button" className="es-chip" onClick={() => onFix(f)}>
                {f === "widen_window" ? "Widen the window" : f === "drop_condition" ? "Drop the condition" : f.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        ) : (
          <p className="es-note">The window is already the widest the slots ask and there is no condition to drop.</p>
        )}
      </section>
    );
  }
  // Each block guards itself (Codex R-10): no .find on a list that was not served.
  const horizons = Array.isArray(study.horizons) ? study.horizons : [];
  const h = horizons.find((x) => x.h === study.question?.horizon) ?? horizons[0];
  const phrase = horizonPhrase(h?.h ?? 20);
  // Every target move is spelled in the study's served unit (Codex R-02); without it, none is printed.
  const unit = isUnit(study.question?.target_unit) ? study.question.target_unit : undefined;
  const median = h ? moveText(h.median, unit) : null;
  const baseline = h ? moveText(h.baseline_median, unit) : null;
  const worst = h?.worst ? moveText(h.worst.ret, unit) : null;
  const best = h?.best ? moveText(h.best.ret, unit) : null;
  return (
    <section className="dk-card es-answer" aria-label="The answer" aria-busy={busy || undefined} data-busy={busy || undefined}>
      <h2 className="es-headline">{study.headline}</h2>
      <div className="es-pills">
        <span className="es-pill" data-on={study.firing_now || undefined}>
          {study.firing_now ? "● Firing today" : "○ Not firing today"}
          {study.last_event ? ` · last ${dayLong(study.last_event)}` : ""}
        </span>
        <span className="es-pill" data-live>
          {["● Live", servedWords(study)].filter(Boolean).join(" · ")}
        </span>
      </div>
      <StatRow cols={4}>
        {fin(n) ? <Stat label="Events" value={String(n)} sub={year(study.sample_start) ? `since ${year(study.sample_start)}` : undefined} size="md" /> : <Stat label="Events" awaiting />}
        {h && fin(h.up_pct) ? (
          // The horizon's own count is the denominator (Codex R-07); the study-wide count is only the EVENTS stat.
          <Stat label={`Up ${phrase} later`} value={pctPlain(h.up_pct)} tone={h.up_pct > 0.5 ? "up" : undefined} sub={fin(h.up_n) ? (fin(h.n_complete) ? `${h.up_n} of ${h.n_complete}` : "count awaiting refresh") : undefined} size="md" />
        ) : (
          <Stat label={`Up ${phrase} later`} awaiting />
        )}
        {h && fin(h.median) && median ? (
          <Stat label={`Median at ${phrase}`} value={median} tone={h.median > 0 ? "up" : h.median < 0 ? "down" : undefined} sub={baseline ? `vs ${baseline} ${normalStretch(h.h)}` : undefined} size="md" />
        ) : (
          <Stat label={`Median at ${phrase}`} awaiting />
        )}
        {h?.worst && h?.best && fin(h.worst.ret) && fin(h.best.ret) && worst && best ? (
          <Stat
            label="Worst · best"
            size="date"
            value={
              <>
                <Signed value={h.worst.ret}>{worst}</Signed> / <Signed value={h.best.ret}>{best}</Signed>
              </>
            }
            sub={`${monthYear(h.worst.date)} · ${monthYear(h.best.date)}`}
          />
        ) : (
          <Stat label="Worst · best" awaiting />
        )}
      </StatRow>
      {!horizons.length ? <Awaiting>the study's horizons</Awaiting> : unit ? <Bars horizons={horizons} unit={unit} /> : <Awaiting>the unit of the study's target</Awaiting>}
      <p className="es-legend" aria-hidden="true">
        <span>
          <i style={{ background: BLUE }} /> after the event
        </span>
        <span>
          <i style={{ background: "rgba(139, 146, 158, 0.35)" }} /> a normal stretch
        </span>
        <span>
          <b style={{ color: BLUE }}>┬</b> range the answer could fall in
        </span>
      </p>
      <WithoutCondition study={study} label={label} />
    </section>
  );
}

