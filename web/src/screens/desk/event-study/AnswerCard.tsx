/**
 * The answer card (DESK_FRAME3_SPEC §4): the headline in serif, whether the
 * setup is firing today and how the answer was served, four stats, the
 * horizon chart (the median after the event, blue, beside a normal stretch,
 * gray, with the range the answer could fall in as a whisker on the event
 * bar) and the line on the same question without its condition. Fewer than
 * ten completed outcomes at the selected horizon: the served sentence and
 * the served fixes, no chart (§1.7).
 */

import type { StudyHorizon, StudyResponse, TargetUnit } from "../data/types";
import { dayLong, isFiniteNumber as fin, monthYear, pctPlain, year } from "../kit/format";
import { useBox } from "../kit/LineChart";
import { Awaiting, NotServedBadge, Signed, Stat, StatRow, useBlockUnserved, useUnserved, LoadingLine } from "../kit/ui";
import { WINDOWS, horizonLabel } from "./question";
import { isLog, isUnit, moveText, scaleOf, tickText, tipOf, whisker } from "../kit/units";

/** Whether a fix from the empty state changes the question (no wider window than 60, no condition to drop). */
function applies(q: StudyResponse["question"], fix: string): boolean {
  if (fix === "widen_window") return q.window != null && WINDOWS.some((w) => w > (q.window as number));
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

/** A round step for basis points: the largest 1, 2 or 5 × 10ⁿ at or under `hi`. */
function roundStep(hi: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(hi, 1e-9)));
  return [5, 2, 1].map((m) => m * mag).find((s) => s <= hi) ?? mag;
}

/** The chart's y ticks (§4: +5% / 0 / −3% for the gold study): zero, the
 * largest round step at or under the top, and a negative tick at 60% of it
 * when the data sit above it (or the round step under the bottom). A log
 * percent (§1.9) steps by 5, 1 or a half; basis points by 1, 2 or 5 × 10ⁿ
 * (+50 bp / 0 / −30 bp), the negative tick rounded to a whole step's tenth.
 * Ticks are in display units: the values come in already scaled. */
export function barTicks(lo: number, hi: number, unit: TargetUnit = "log_return"): number[] {
  const step = isLog(unit) ? (hi >= 5 ? 5 : hi >= 2 ? 1 : 0.5) : roundStep(hi);
  const pos = Math.max(step, Math.floor(hi / step) * step);
  const tenths = isLog(unit) ? 1 : 10 / step; // ticks per unit: a percent's whole points, else tenths of a step
  const neg = lo < -0.6 * pos ? -Math.ceil(-lo / step) * step : -Math.round(0.6 * pos * tenths) / tenths;
  return [neg, 0, pos];
}

/** A horizon the chart can draw: its median, baseline and range all served as finite numbers, in display units.
 * The whisker is baseline + ci in native units, then the same linear scale (§1.9). */
type Drawn = { h: StudyHorizon; med: number; base: number; lo: number; hi: number };
function drawn(h: StudyHorizon, unit: TargetUnit): Drawn | null {
  const w = whisker(h.baseline_median, h.ci_lo, h.ci_hi, unit);
  if (!fin(h.median) || !fin(h.baseline_median) || !w) return null;
  const k = scaleOf(unit);
  return { h, med: h.median * k, base: h.baseline_median * k, lo: w.lo, hi: w.hi };
}

/** Exported for Basket & Hedge's PROTOTYPE event study (§1.0.3), which draws its illustrative horizons the same way. */
export function Bars({ horizons, unit }: { horizons: StudyHorizon[]; unit: TargetUnit }) {
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
  // Room below and above the ticks: 0.6 and 0.9 of a percent, the same share of the top tick in bp.
  const room = isLog(unit) ? 1 : ticks[2] / 5;
  const tip = tipOf(unit);
  const dLo = Math.min(ticks[0], lo) - 0.6 * room;
  const dHi = Math.max(ticks[2], hi) + 0.9 * room;
  const pw = width - pad.l - pad.r;
  const ph = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ((dHi - v) / (dHi - dLo)) * ph;
  const group = pw / Math.max(1, pts.length);
  const bw = Math.min(42, group * 0.2);
  return (
    <div ref={ref} className="dk-chart es-bars">
      <svg width={width} height={height} role="img" aria-label={`The median move after the event against a normal stretch, with its range, at each horizon${isLog(unit) ? " (log returns, ×100)" : ""}: ${pts.map((p) => (p.d ? `${p.h.label} ${moveText(p.d.med / k, unit)} against ${moveText(p.d.base / k, unit)}` : `${p.h.label} awaiting refresh`)).join("; ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? "dk-chart-zero" : "dk-chart-grid"} x1={pad.l} x2={pad.l + pw} y1={y(t)} y2={y(t)} />
            <text className="dk-chart-axis" x={pad.l - 10} y={y(t) + 4} textAnchor="end">
              {tip && t !== 0 ? <title>{tip}</title> : null}
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
                {tip ? <title>{tip}</title> : null}
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

/** The line on the same question without its condition (§4): the `without_condition` block, unavailable on
 * Monday (§1.0, C-01), so it prints its served reason; a block that did not arrive is Awaiting refresh. The
 * comparison's shape, once defined, is §12.13's. */
export function WithoutCondition({ study }: { study: StudyResponse }) {
  const q = study.question;
  const off = useBlockUnserved(study, "without_condition");
  if (q.while === "none") return null;
  const cond = q.while.startsWith("regime:") ? "the regime condition" : "the S&P condition";
  return (
    <p className="es-without">
      <b>Without {cond}</b>: {off ? <span className="dk-unserved-inline">{off.reason}</span> : <span className="es-without-await">Awaiting refresh</span>}
    </p>
  );
}

export default function AnswerCard({
  study,
  failed,
  refusal = null,
  busy = false,
  onFix,
  horizon,
}: {
  study: StudyResponse | undefined;
  failed: boolean;
  /** The served message of a refused request (§4: 422 `unsupported`). */
  refusal?: string | null;
  busy?: boolean;
  onFix: (fix: string) => void;
  /** The asked horizon, for the stat labels before an answer. */
  horizon?: number;
}) {
  const unserved = useUnserved();
  if (!study) {
    // Codex R-18: the asked horizon names the labels; with none asked, no horizon is named.
    const p = fin(horizon) ? horizonPhrase(horizon) : null;
    return (
      <section className="dk-card es-answer" aria-label="The answer" aria-busy={!failed && !unserved}>
        <LoadingLine busy={!failed && !unserved} />
        {unserved ? (
          <div className="es-pills">
            <NotServedBadge block={unserved} />
          </div>
        ) : null}
        <StatRow cols={4}>
          {/* A refused question is not awaiting anything: its labels stay, with no word under them. */}
          {["Events", p ? `Up ${p} later` : "Up later", p ? `Median at ${p}` : "Median", "Worst · best"].map((l) => (
            <Stat key={l} label={l} awaiting={failed && !refusal} />
          ))}
        </StatRow>
        {refusal ? (
          <p className="es-refused" role="status">
            {refusal}
          </p>
        ) : failed ? (
          <Awaiting>the study did not answer</Awaiting>
        ) : null}
      </section>
    );
  }
  // Everything here is the selected horizon's (§1.5, v4 B-01): its verdict, counts and empty state.
  // Each block guards itself (Codex R-10): no .find on a list that was not served; no other horizon stands in.
  const horizons = Array.isArray(study.horizons) ? study.horizons : [];
  // Codex R-18: the served horizon, else the question's, else the one asked; never another one (no 20 stands in).
  const sel = fin(study.selected_horizon) ? study.selected_horizon : fin(study.question?.horizon) ? study.question.horizon : fin(horizon) ? horizon : null;
  const h = sel == null ? undefined : horizons.find((x) => x.h === sel);
  const hLabel = h?.label || (sel == null ? null : horizonLabel(sel));
  if (study.empty_state || study.verdict === "insufficient" || (h && fin(h.n) && h.n < 10)) {
    const q = study.question;
    // Only the served fixes (§1.7: each only when it leads to a catalog study); none is invented.
    const served = Array.isArray(study.empty_state?.fixes) ? study.empty_state.fixes : [];
    const fixes = served.filter((f) => !q || applies(q, f));
    const since = year(study.sample_start);
    // The served sentence; without it, §12.2's template on the selected horizon's own count.
    const sentence =
      study.empty_state?.sentence ||
      (h && fin(h.n) ? `Only ${h.n} events complete at ${hLabel}${since ? ` since ${since}` : ""}, fewer than the ten a verdict other than Too few needs.` : hLabel ? `Fewer than ten events are complete at ${hLabel}; a verdict other than Too few needs ten.` : "Fewer than ten events are complete; a verdict other than Too few needs ten.");
    return (
      <section className="dk-card es-answer" aria-label="The answer">
        <p className="es-headline">{sentence}</p>
        {fixes.length ? (
          <div className="es-fixes" role="group" aria-label="Ways to get enough events">
            {fixes.map((f) => (
              <button key={f} type="button" className="es-chip" onClick={() => onFix(f)}>
                {f === "widen_window" ? "Widen the window" : f === "drop_condition" ? "Drop the condition" : f.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        ) : null}
      </section>
    );
  }
  const phrase = sel == null ? null : horizonPhrase(sel);
  const upLabel = phrase ? `Up ${phrase} later` : "Up later";
  const medianLabel = phrase ? `Median at ${phrase}` : "Median";
  const matched = study.matched_n;
  // Every target move is spelled in the study's served unit (Codex R-02); without it, none is printed.
  const unit = isUnit(study.question?.target_unit) ? study.question.target_unit : undefined;
  const median = h ? moveText(h.median, unit) : null;
  const baseline = h ? moveText(h.baseline_median, unit) : null;
  const worst = h?.worst ? moveText(h.worst.value, unit) : null;
  const best = h?.best ? moveText(h.best.value, unit) : null;
  // Every log number carries the §1.9 tooltip; bp numbers none.
  const tip = tipOf(unit);
  return (
    <section className="dk-card es-answer" aria-label="The answer" aria-busy={busy || undefined} data-busy={busy || undefined}>
      <h2 className="es-headline">{study.headline}</h2>
      <LoadingLine busy={busy} />
      <div className="es-pills">
        {/* §4: nothing when the state is not served (a stale study with no evaluable session included); stale is never "firing today"; a firing study counts its days. */}
        {study.firing_now == null || study.stale == null ? null : study.stale ? (
          <span className="es-pill">○ Stale · {dayLong(study.evaluated_on) || "—"}</span>
        ) : study.firing_now === true ? (
          <span className="es-pill" data-on>
            ● Firing today{fin(study.firing_day) ? ` · day ${study.firing_day}` : ""}
          </span>
        ) : study.firing_now === false ? (
          <span className="es-pill">○ Not firing today{study.last_event ? ` · last ${dayLong(study.last_event)}` : ""}</span>
        ) : null}
        {/* desk/usability §14.13: the engine's timing and cache words ("0.3s, cached") are not an MD's; the pill says live. */}
        <span className="es-pill" data-live>
          ● Live
        </span>
      </div>
      <StatRow cols={4}>
        {/* EVENTS is the study's size; beneath it, how many are complete at the selected horizon (C-03). */}
        {fin(matched) ? <Stat label="Events" value={String(matched)} sub={h && fin(h.n) ? `${h.n} complete at ${hLabel}` : "count awaiting refresh"} size="md" /> : <Stat label="Events" awaiting />}
        {h && fin(h.up_pct) ? (
          // The horizon's own count is the denominator (C-03); the study's size is only the EVENTS stat.
          <Stat label={upLabel} value={pctPlain(h.up_pct)} tone={h.up_pct > 0.5 ? "up" : undefined} sub={fin(h.up_n) && fin(h.n) ? `${h.up_n} of ${h.n}` : "count awaiting refresh"} size="md" />
        ) : (
          <Stat label={upLabel} awaiting />
        )}
        {h && fin(h.median) && median ? (
          <Stat
            label={medianLabel}
            value={<span title={tip}>{median}</span>}
            tone={h.median > 0 ? "up" : h.median < 0 ? "down" : undefined}
            sub={
              // A baseline not served keeps its line and says so (§1.7), never disappears.
              baseline ? (
                <>
                  vs <span title={tip}>{baseline}</span> {normalStretch(h.h)}
                </>
              ) : (
                "normal awaiting refresh"
              )
            }
            size="md"
          />
        ) : (
          <Stat label={medianLabel} awaiting />
        )}
        {h?.worst && h?.best && fin(h.worst.value) && fin(h.best.value) && worst && best ? (
          <Stat
            label="Worst · best"
            size="date"
            value={
              <>
                <Signed value={h.worst.value} title={tip}>
                  {worst}
                </Signed>{" "}
                /{" "}
                <Signed value={h.best.value} title={tip}>
                  {best}
                </Signed>
              </>
            }
            // §4: with their event dates.
            sub={`${monthYear(h.worst.event_date)} · ${monthYear(h.best.event_date)}`}
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
      <WithoutCondition study={study} />
    </section>
  );
}

