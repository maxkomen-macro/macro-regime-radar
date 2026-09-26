/**
 * The Event Study's Advanced panel (DESK_FRAME3_SPEC §4 item 5): it opens
 * under the grid with what the footer lists: all the events (§12.3
 * /study/events), the resampling detail and the entry rules (from the
 * study's provenance), and the provenance. Under them, the frame-2 engine's
 * own parameter panel and tables for the same question (§4: "the frame-2
 * parameter panel and tables"), read through the frame-2 adapter
 * (api/desk.ts) and printed with frame-2's tested formatters, in the v2 card
 * style. The engine's per-horizon result is stated as the engine's fact about
 * zero (verifier E-1): it is not a §1.5 verdict, which only /study serves, so
 * the panel never prints a pill that could disagree with the rail.
 */

import { ApiError } from "../../../api/client";
import { isEngineAbsent, useEventStudy, useEventStudyAssets, type EventStudyHorizon, type EventStudyResponse } from "../../../api/desk";
import { useStudyEvents } from "../data/api";
import type { Question, StudyHorizon, StudyResponse } from "../data/types";
import { dayLong, grouped, isFiniteNumber as fin, pctPlain, verdictRuleWords } from "../kit/format";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import { Awaiting, VerdictWord } from "../kit/ui";
import { factsLine, fmtInterval, fmtMove, fmtZ, historyLine, missingForwardWord } from "./format";
import { apiParams, type Ask } from "./question";
import { LOG_TIP, moveText, tipOf } from "../kit/units";

/** The engine's per-horizon fact about zero, in words (its exclusion field). */
export function engineZeroWords(e: EventStudyHorizon["exclusion"]): string {
  if (e === "established") return "clears zero on 10+ blocks, under 3% adverse";
  if (e === "not established") return "clears zero, below that bar";
  if (e === "included") return "includes zero";
  return "too few blocks to say";
}

function EngineTables({ study }: { study: EventStudyResponse }) {
  const unit = study.target.unit === "bp" ? "bp" : "%";
  // The engine's percent is 100 × a log change (§1.9): every such cell carries the tooltip.
  const tip = unit === "%" ? LOG_TIP : undefined;
  return (
    <div className="es-engine">
      <p className="es-prov">{study.label}</p>
      <p className="es-prov">{factsLine(study)}</p>
      <p className="es-note">{historyLine(study)}</p>
      <table className="es-table es-wide">
        <caption className="dk-stat-label">By horizon, as the engine scores it</caption>
        <thead>
          <tr>
            <th scope="col">Sessions</th>
            <th scope="col">N</th>
            <th scope="col">Blocks</th>
            <th scope="col">Median</th>
            <th scope="col">Normal</th>
            <th scope="col">Difference</th>
            <th scope="col">90% range</th>
            <th scope="col">Zero</th>
          </tr>
        </thead>
        <tbody>
          {study.horizons.map((h) => (
            <tr key={h.h}>
              <th scope="row">{h.h}</th>
              <td>{h.n}</td>
              <td>{h.n_blocks ?? "—"}</td>
              <td title={fin(h.median) ? tip : undefined}>{fmtMove(h.median, unit)}</td>
              <td title={fin(h.baseline_median) ? tip : undefined}>{fmtMove(h.baseline_median, unit)}</td>
              <td title={fin(h.delta) ? tip : undefined}>{fmtMove(h.delta, unit)}</td>
              <td title={h.ci90 ? tip : undefined}>{fmtInterval(h.ci90, unit) ?? "fewer than five blocks"}</td>
              <td className="es-zero">{engineZeroWords(h.exclusion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="es-table es-wide">
        <caption className="dk-stat-label">Recent events the engine serves (newest first, up to ten)</caption>
        <thead>
          <tr>
            <th scope="col">Event</th>
            <th scope="col">Regime</th>
            <th scope="col">z</th>
            {study.horizons.map((h) => (
              <th key={h.h} scope="col">
                {h.h} sessions
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {study.recent_events.map((e) => (
            <tr key={e.date}>
              <th scope="row">{dayLong(e.date)}</th>
              <td>{e.regime}</td>
              <td>{fmtZ(e.z)}</td>
              {study.horizons.map((h) => {
                const v = e.forward[String(h.h)];
                return <td key={h.h} title={fin(v) ? tip : undefined}>{v == null ? missingForwardWord(e, h.h) : fmtMove(v, unit)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Whether the engine takes this question's shock and target, by its own asset list. */
export function engineTakes(q: Question, assets: { shock_assets: { id: string }[]; targets: { id: string }[] } | undefined, label: (k: string) => string = (k) => k): string | null {
  if (!assets) return null;
  const shockOk = q.move.startsWith("cross") || assets.shock_assets.some((a) => a.id === q.shock);
  const targetOk = assets.targets.some((a) => a.id === q.target);
  if (!shockOk) return `The engine does not take ${label(q.shock)} as a shock yet`;
  if (!targetOk) return `The engine does not take ${label(q.target)} as a target yet`;
  return null;
}

function FrameTwo({ slug, question, label }: { slug: string | null; question: Question; label: (k: string) => string }) {
  const assets = useEventStudyAssets();
  const refused = engineTakes(question, assets.data, label);
  const q = useEventStudy(slug && !refused ? slug : null);
  if (!slug) return <p className="es-note">The engine asks windows of 5, 20 and 60 sessions, conditions on the S&amp;P below its 50-day or on the regime, and crosses of the target&rsquo;s own averages; this question has none of those shapes, so there is no frame-2 panel for it.</p>;
  if (refused) return <p className="es-note">{refused}, so there is no frame-2 panel for this question.</p>;
  if (q.data?.state === "ready") return <EngineTables study={q.data.study} />;
  if (q.data?.state === "computing") return <p className="es-note">The engine is computing this study; the panel asks again in a few seconds.</p>;
  if (q.data?.state === "awaiting_refresh") return <p className="es-note">{q.data.detail}</p>;
  if (q.isError) {
    if (isEngineAbsent(q.error)) return <Awaiting>this server does not run the engine</Awaiting>;
    const e = q.error instanceof ApiError ? q.error : null;
    if (e && (e.status === 422 || e.kind === "not_stored")) return <p className="es-note">The engine&rsquo;s reason: {e.message}</p>;
    return <Awaiting>the engine did not answer</Awaiting>;
  }
  return <p className="es-note" aria-busy="true" />;
}

/** A horizon's resampling, in words: "Monte Carlo · 10,000 draws · 18 blocks · 14.6% adverse"; a horizon with no interval says why. */
export function resamplingWords(h: Pick<StudyHorizon, "method" | "draws" | "n_blocks" | "adverse_share" | "reason">): string {
  const method = h.method === "enumeration" ? "enumeration" : h.method === "monte_carlo" ? "Monte Carlo" : null;
  if (!method) return typeof h.reason === "string" ? h.reason : "no interval";
  return [method, fin(h.draws) ? `${grouped(h.draws)} draws` : null, fin(h.n_blocks) ? `${h.n_blocks} blocks` : null, fin(h.adverse_share) ? `${pctPlain(h.adverse_share, 1)} adverse` : null].filter(Boolean).join(" · ");
}

export default function EngineDetail({ id, study, ask, engineSlug, label }: { id: string; study: StudyResponse; ask: Ask; engineSlug: string | null; label: (k: string) => string }) {
  const events = useStudyEvents(apiParams(ask));
  const pv = study.provenance;
  const list = Array.isArray(events.data?.events) ? events.data.events : null;
  return (
    <section className="dk-card es-advanced" id={id} aria-label="Advanced">
      <div className="es-adv-grid">
        <div>
          <p className="dk-stat-label es-rail-h">{fin(study.matched_n) ? `All ${study.matched_n} events` : "All events"}</p>
          {list ? (
            <table className="es-table es-wide">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Regime</th>
                  <th scope="col">1 week</th>
                  <th scope="col">2 weeks</th>
                  <th scope="col">1 month</th>
                  <th scope="col">3 months</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.event_date}>
                    <th scope="row">{dayLong(e.event_date)}</th>
                    <td>{e.regime}</td>
                    {([e.value_5, e.value_10, e.value_20, e.value_60] as (number | null | undefined)[]).map((v, i) => (
                      // Each move in the study's target unit (Codex R-02); an incomplete window says so (§12.4 `complete_<h>`).
                      <td key={i} title={fin(v) && moveText(v, study.question.target_unit) ? tipOf(study.question.target_unit) : undefined}>
                        {fin(v) ? (moveText(v, study.question.target_unit) ?? "Awaiting refresh") : "not complete yet"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : events.isError || events.data ? (
            <Awaiting>the event list did not answer</Awaiting>
          ) : null}
        </div>
        <div>
          <p className="dk-stat-label es-rail-h">Resampling detail</p>
          <p className="es-note">
            Cluster bootstrap over overlap blocks, ranges at {fin(study.verdict_confidence) ? `the engine's ${pctPlain(study.verdict_confidence)}` : "the engine's served level"}; each horizon's method and draws below.
            {verdictRuleWords(study) ? ` Each horizon's verdict follows ${verdictRuleWords(study)}:` : " Each horizon's verdict follows the definitions below."}
          </p>
          <VerdictDefinitions />
          {Array.isArray(study.horizons) ? (
            <ul className="es-ranges es-resampling">
              {study.horizons.map((h) => (
                <li key={h.h}>
                  <span>{h.label}</span>
                  {/* §4: each horizon's method, draws, blocks and adverse share. */}
                  <span className="es-range-how">{resamplingWords(h)}</span>
                  {!fin(h.ci_lo) || !fin(h.ci_hi) ? (
                    <span className="es-range-why">{typeof h.reason === "string" && h.reason ? h.reason : "Awaiting refresh"}</span>
                  ) : (
                    <span className="es-range-pts">{h.ci_lo > 0 || h.ci_hi < 0 ? "clears zero" : "includes zero"}</span>
                  )}
                  <VerdictWord verdict={h.verdict} />
                </li>
              ))}
            </ul>
          ) : (
            <Awaiting>the study's horizons</Awaiting>
          )}
          <p className="dk-stat-label es-rail-h">Entry rules</p>
          {pv ? (
            <p className="es-note">
              Entry is {pv.entry_rule || "the served entry rule"}. {fin(pv.cooldown) ? `A new event needs ${pv.cooldown} sessions after the last one.` : "A cross has no cooldown."}
            </p>
          ) : (
            <Awaiting>the study's entry rules</Awaiting>
          )}
          <p className="dk-stat-label es-rail-h">Provenance</p>
          <p className="es-prov">
            as of {study.as_of} · generation {study.generation_id} · inputs {study.inputs_hash}
            {Object.entries(pv?.series_start ?? {}).map(([k, v]) => ` · ${k} from ${v}`)}
          </p>
        </div>
      </div>
      <p className="dk-stat-label es-rail-h">The engine&rsquo;s own panel (frame-2)</p>
      <p className="es-note">The engine&rsquo;s saved study for the same question, as the frame-2 page printed it; its sample and dates are the engine&rsquo;s own and can differ from the answer above until both read the same generation.</p>
      <FrameTwo slug={engineSlug} question={study.question} label={label} />
    </section>
  );
}
