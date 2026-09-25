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
import type { Question, StudyResponse } from "../data/types";
import { dayLong, grouped, isFiniteNumber as fin, pctPlain } from "../kit/format";
import { Awaiting, verdictLabel } from "../kit/ui";
import { factsLine, fmtInterval, fmtMove, fmtZ, historyLine, missingForwardWord } from "./format";
import { apiParams, type Ask } from "./question";
import { moveText } from "./units";

/** The engine's per-horizon fact about zero, in words (its exclusion field). */
export function engineZeroWords(e: EventStudyHorizon["exclusion"]): string {
  if (e === "established") return "clears zero on 10+ blocks, under 3% adverse";
  if (e === "not established") return "clears zero, below that bar";
  if (e === "included") return "includes zero";
  return "too few blocks to say";
}

function EngineTables({ study }: { study: EventStudyResponse }) {
  const unit = study.target.unit === "bp" ? "bp" : "%";
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
              <td>{fmtMove(h.median, unit)}</td>
              <td>{fmtMove(h.baseline_median, unit)}</td>
              <td>{fmtMove(h.delta, unit)}</td>
              <td>{fmtInterval(h.ci90, unit) ?? "fewer than five blocks"}</td>
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
                return <td key={h.h}>{v == null ? missingForwardWord(e, h.h) : fmtMove(v, unit)}</td>;
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

export default function EngineDetail({ id, study, ask, engineSlug, label }: { id: string; study: StudyResponse; ask: Ask; engineSlug: string | null; label: (k: string) => string }) {
  const events = useStudyEvents(apiParams(ask));
  const pv = study.provenance;
  const list = Array.isArray(events.data?.events) ? events.data.events : null;
  return (
    <section className="dk-card es-advanced" id={id} aria-label="Advanced">
      <div className="es-adv-grid">
        <div>
          <p className="dk-stat-label es-rail-h">{fin(study.n_events) ? `All ${study.n_events} events` : "All events"}</p>
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
                  <tr key={e.date}>
                    <th scope="row">{dayLong(e.date)}</th>
                    <td>{e.regime}</td>
                    {[e.ret_5, e.ret_10, e.ret_20, e.ret_60].map((v, i) => (
                      // Each move in the study's target unit (Codex R-02); none without it.
                      <td key={i}>{fin(v) ? (moveText(v, study.question.target_unit) ?? "Awaiting refresh") : "no observation"}</td>
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
            Cluster bootstrap, {pv && fin(pv.bootstrap) ? grouped(pv.bootstrap) : "an unstated number of"} draws, ranges at {fin(study.confidence) ? `${pctPlain(study.confidence)} confidence` : "the served confidence"}. A verdict is Reliable when 10 or more independent episodes stand behind it and fewer than 3% of resamples go the other way; Suggestive when it leans but the range crosses zero or there are fewer than 10; No edge when it is about the same as any month.
          </p>
          {Array.isArray(study.horizons) ? (
            <ul className="es-ranges">
              {study.horizons.map((h) => (
                <li key={h.h}>
                  <span>{h.label}</span>
                  <span className="es-range-pts">{!fin(h.ci_lo_pts) || !fin(h.ci_hi_pts) ? "Awaiting refresh" : h.ci_lo_pts > 0 || h.ci_hi_pts < 0 ? "clears zero" : "includes zero"}</span>
                  <span>{verdictLabel(h.verdict)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <Awaiting>the study's horizons</Awaiting>
          )}
          <p className="dk-stat-label es-rail-h">Entry rules</p>
          {pv ? (
            <p className="es-note">
              The condition is checked on the shock day; entry is the {pv.entry || "served entry rule"}; {fin(pv.cooldown) ? `a new event needs ${pv.cooldown} sessions after the last one.` : "the cooldown between events was not served."}
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
