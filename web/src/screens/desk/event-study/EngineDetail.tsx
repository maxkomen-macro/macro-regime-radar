/**
 * The Event Study's Advanced panel (DESK_FRAME3_SPEC §4 item 5): it opens
 * under the grid with what the footer lists: all the events (§12.4
 * /study/events), each horizon's resampling detail, the entry rules and the
 * provenance, all from the identical study, so main and Advanced always show
 * the same calculation. The frame-2 engine panel is retired (§4, v2 §8).
 */

import { droppedOf } from "../data/schema";
import { useStudyEvents } from "../data/api";
import type { StudyHorizon, StudyResponse } from "../data/types";
import { dayLong, grouped, isFiniteNumber as fin, pctPlain, verdictRuleWords } from "../kit/format";
import VerdictDefinitions from "../kit/VerdictDefinitions";
import { Awaiting, DroppedNote, VerdictWord, FailedScope, LoadingLine } from "../kit/ui";
import { apiParams, type Ask } from "./question";
import { moveText, tipOf } from "../kit/units";
import { Term } from "../kit/Term";

/** A horizon's resampling, in words: "Monte Carlo · 10,000 draws · 18 blocks · 14.6% adverse"; a horizon with no interval says why. */
export function resamplingWords(h: Pick<StudyHorizon, "method" | "draws" | "n_blocks" | "adverse_share" | "reason">): string {
  const method = h.method === "enumeration" ? "enumeration" : h.method === "monte_carlo" ? "Monte Carlo" : null;
  if (!method) return typeof h.reason === "string" ? h.reason : "no interval";
  return [method, fin(h.draws) ? `${grouped(h.draws)} draws` : null, fin(h.n_blocks) ? `${h.n_blocks} blocks` : null, fin(h.adverse_share) ? `${pctPlain(h.adverse_share, 1)} adverse` : null].filter(Boolean).join(" · ");
}

export default function EngineDetail({ id, study, ask }: { id: string; study: StudyResponse; ask: Ask }) {
  const events = useStudyEvents(apiParams(ask));
  const pv = study.provenance;
  const list = Array.isArray(events.data?.events) ? events.data.events : null;
  return (
    <section className="dk-card es-advanced" id={id} aria-label="Advanced">
      <div className="es-adv-grid">
        <div>
          <p className="dk-stat-label es-rail-h">{fin(study.matched_n) ? `All ${study.matched_n} events` : "All events"}</p>
          <FailedScope q={events}>
          <LoadingLine busy={!list && !events.isError && !events.data} />
          {list ? (
            <table className="es-table es-wide">
              <thead>
                {/* desk/pdf-polish 7: every column head carries its definition. */}
                <tr>
                  {(
                    [
                      ["col-es-event", "Event"],
                      ["col-es-regime", "Regime"],
                      ["col-es-h5", "1 week"],
                      ["col-es-h10", "2 weeks"],
                      ["col-es-h20", "1 month"],
                      ["col-es-h60", "3 months"],
                    ] as const
                  ).map(([id, label]) => (
                    <th key={id} scope="col">
                      {/* Codex R-04: the four moves count from each event's entry, and say how entry is set. */}
                      <Term ids={id.startsWith("col-es-h") ? [id, "entry", "entry-rule"] : [id]}>{label}</Term>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.event_date}>
                    <th scope="row">{dayLong(e.event_date)}</th>
                    <td>{e.regime ?? "—"}</td>
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
          </FailedScope>
          {/* Codex R-16: "All N events" is the study's count; rows the boundary could not read are said. */}
          <DroppedNote n={droppedOf(events.data, "events")} one="event" />
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
    </section>
  );
}
