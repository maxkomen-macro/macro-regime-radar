/**
 * The Event Study rail (DESK_FRAME3_SPEC §4), top to bottom: the verdict box
 * (amber-bordered for Suggestive) with the verdict's label, the served
 * headline and why; the answer by regime a month later (§4's fixed label: §12.2
 * serves `by_regime` and `last_events` at 20 sessions; a regime under ten
 * events prints its count and "too few cases to say"); the last five events; the range against a normal stretch at
 * the engine's 90%; and the footer: Advanced and Export. desk/usability §14.3:
 * no control does nothing, so the disabled `Price it →` and the 80% / 95%
 * confidence chips are gone; the interval's level is said in words.
 */

import type { StudyResponse } from "../data/types";
import { roundHalfUp } from "../../../lib/format";
import { REGIME_TAGGED_LINE, dayLong, isFiniteNumber as fin, numberWord, pctPlain, VERDICT_LABEL } from "../kit/format";
import { Advanced, Awaiting, DroppedNote, Signed, UnservedLine, useUnserved, VerdictWord, useLoadFailed } from "../kit/ui";
import { droppedOf } from "../data/schema";
import { targetLabel } from "./question";
import { isUnit, moveText, rangeText, tipOf } from "../kit/units";
import type { TargetUnit } from "../data/types";
import { Term, defineTerms } from "../kit/Term";

/**
 * desk/pdf-polish item 6, reworded by the owner for Codex R-09: the hover on "Edge vs a normal period" says, in
 * neutral words, what the edge is: the median's excess over the baseline (src/desk/event_study.py horizon_stats
 * `delta`; the range under it is its interval, api/desk_v2.py horizons ci_lo/ci_hi), the target read from the study
 * (the S&P for the presets that target it), in the target's unit: a log move ×100 (kit/units.ts LOG_TIP, the
 * owner's "percent"), bp for a yield or spread (api/desk_v2.py vs_normal, display_unit).
 */
export function edgeDef(target: string | null | undefined): string {
  const who = !target ? "the target" : target === "S&P 500" ? "the S&P" : `the ${target}`;
  return `The difference between ${who}'s median move after these events and its median over a typical period of the same length, in ${who}'s unit (log returns ×100 for prices, basis points for yields and spreads).`;
}

/** Codex R-04: an outcome column says where its outcomes count from (kit/glossary.ts `entry`, `entry-rule`). */
const ENTRY = ["entry", "entry-rule"] as const;

/** "Edge vs a normal period", its §1.4 lowercase "vs" inside the uppercase label, carrying its hover. */
function EdgeLabel({ target }: { target: string | null | undefined }) {
  return (
    <Term def={edgeDef(target)}>
      Edge <span className="dk-lc">vs</span> a normal period
    </Term>
  );
}

/** The rail with no answer: its section labels, and why there is nothing under them (§1.7). A served
 * study, Too few included, is scored (v4 B-02) and gets the whole rail. */
export function RailPlaceholder() {
  // §1.0.2: a study served awaiting keeps the rail's four labels and prints its reason once, after them.
  const unserved = useUnserved();
  // §14.12: after a failed request nothing is awaiting a refresh; the rail's line says Couldn't load once.
  const failed = useLoadFailed();
  const why = "Awaiting refresh";
  if (unserved)
    return (
      <>
        {["Verdict", "By regime · a month later", "Last five events", "Edge vs a normal period"].map((l) => (
          <div key={l} className="es-rail-empty">
            <p className="dk-stat-label">{l.startsWith("Edge") ? <EdgeLabel target={null} /> : defineTerms(l)}</p>
          </div>
        ))}
        <UnservedLine block={unserved} />
      </>
    );
  return (
    <>
      {[
        "Verdict",
        "By regime · a month later",
        "Last five events",
        <EdgeLabel key="edge" target={null} />,
      ].map((l, i) => (
        <div key={i} className="es-rail-empty">
          <p className="dk-stat-label">{defineTerms(l)}</p>
          {failed ? (
            <p className="dk-stat-await" aria-hidden="true">
              —
            </p>
          ) : (
            <p className="dk-await">{why}</p>
          )}
        </div>
      ))}
    </>
  );
}

/** Fewer events than this in a regime and its cells are served null (§12.2, the engine's MIN_REGIME_N). */
export const REGIME_FLOOR = 10;

/** §5's key: Goldilocks green, Overheating amber, Stagflation red, Recession Risk gray. */
export const REGIME_KEY: Record<string, string> = { Goldilocks: "green", Overheating: "amber", Stagflation: "red", "Recession Risk": "gray" };


/** A horizon's interval on Δ, native in, in the target's display unit (§1.9): "−1.6 to +4.1 pts", "−10 to +40 bp". */
export function rangeWords(lo: number | null, hi: number | null, unit: TargetUnit | undefined): string {
  return rangeText(lo, hi, unit) ?? "Awaiting refresh";
}

export default function StudyRail({
  study,
  todayRegime,
  advOpen,
  onAdvanced,
  advId,
  onExport,
  exporting,
  busy = false,
}: {
  study: StudyResponse;
  todayRegime: string | null;
  advOpen: boolean;
  onAdvanced: () => void;
  advId: string;
  onExport: () => void;
  exporting: boolean;
  /** A new answer is on its way: nothing here acts on the old one. */
  busy?: boolean;
}) {
  const verdict = study.verdict;
  // Each block guards itself (Codex R-10): a list that was not served says so under its label.
  const byRegime = Array.isArray(study.by_regime) ? study.by_regime : null;
  const lastEvents = Array.isArray(study.last_events) ? study.last_events : null;
  const horizons = Array.isArray(study.horizons) ? study.horizons : null;
  const today = todayRegime && byRegime ? byRegime.find((r) => r.regime === todayRegime) : undefined;
  const unit = isUnit(study.question.target_unit) ? study.question.target_unit : undefined;
  // Every log number carries the §1.9 tooltip; bp numbers none.
  const tip = tipOf(unit);
  const target = targetLabel(study);
  return (
    <>
      <div className="es-verdict" data-verdict={verdict}>
        <p className="es-verdict-label">Verdict · {verdict ? VERDICT_LABEL[verdict] : "Awaiting refresh"}</p>
        {/* §4: VERDICT · <label> / the served headline / why / Price it. The served `why` carries the interval's
            numbers (§12.2), so a log study's sentence carries the §1.9 tooltip. */}
        <p>
          {study.headline ? <b>{study.headline}</b> : null} <span title={tip}>{study.why}</span>
        </p>
      </div>

      <p className="dk-stat-label es-rail-h">By regime · a month later</p>
      {byRegime ? (
      <table className="es-table">
        <thead>
          {/* desk/pdf-polish 7: every column head carries its definition. */}
          <tr>
            <th scope="col">
              <Term ids={["col-es-regime"]}>Regime</Term>
            </th>
            <th scope="col">
              <Term ids={["col-es-n", ...ENTRY]}>N</Term>
            </th>
            <th scope="col">
              <Term ids={["col-es-up", ...ENTRY]}>Up</Term>
            </th>
            <th scope="col">
              <Term ids={["col-es-median", ...ENTRY]}>Median</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {byRegime.map((r) => {
            // §4: a regime with fewer than ten events (the engine's MIN_REGIME_N) prints its count and "too few cases to say".
            const few = fin(r.n) && r.n < REGIME_FLOOR;
            return (
              <tr key={r.regime}>
                <th scope="row">
                  <i className="es-key" data-tone={REGIME_KEY[r.regime] ?? "gray"} aria-hidden="true" />
                  {r.regime}
                </th>
                <td>{fin(r.n) ? r.n : "—"}</td>
                {few ? (
                  <td colSpan={2} className="es-few" data-few>
                    too few cases to say
                  </td>
                ) : (
                  <>
                    <td data-few={!fin(r.up_pct) || undefined}>{fin(r.up_pct) ? pctPlain(r.up_pct) : "—"}</td>
                    <td data-few={!moveText(r.median, unit) || undefined}>{fin(r.median) && moveText(r.median, unit) ? <Signed value={r.median} title={tip}>{moveText(r.median, unit)}</Signed> : "—"}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      ) : (
        <Awaiting />
      )}
      <DroppedNote n={droppedOf(study, "by_regime")} one="regime row" />
      {/* fix/freshness 3a (D2): today's label is the newest stored row's; each event carries the label known then. */}
      {byRegime ? <p className="es-note" data-testid="es-tagged">{REGIME_TAGGED_LINE}</p> : null}
      {fin(study.unlabeled_n) && study.unlabeled_n > 0 ? (
        <p className="es-note">
          {/* §4 (S-06): an event whose K−2 row is not stored carries no label, wherever it falls. */}
          Unlabeled: {study.unlabeled_n} event{study.unlabeled_n === 1 ? "" : "s"} whose K−2 month has no stored regimes row
        </p>
      ) : null}
      {today && fin(today.n) ? (
        <p className="es-note">
          Today is {today.regime}: {numberWord(today.n)} event{today.n === 1 ? "" : "s"}
          {today.n < REGIME_FLOOR ? ", too few to read alone." : "."}
        </p>
      ) : null}

      <p className="dk-stat-label es-rail-h">{target ? `Last five events · ${target} a month later` : "Last five events · a month later"}</p>
      {/* "No events" only when none was served; rows the boundary could not read are said (Codex R-16). */}
      {lastEvents && !lastEvents.length && !droppedOf(study, "last_events") ? (
        <p className="es-note">No events</p>
      ) : lastEvents && lastEvents.length ? (
        <ul className="es-events">
          {lastEvents.map((e) => (
            <li key={e.event_date}>
              {/* §4: event date · regime · value_20. */}
              <span>{dayLong(e.event_date)}</span>
              <span className="es-events-regime">{e.regime ?? "—"}</span>
              {fin(e.value_20) && moveText(e.value_20, unit) ? <Signed value={e.value_20} title={tip}>{moveText(e.value_20, unit)}</Signed> : <span className="es-events-none">—</span>}
            </li>
          ))}
        </ul>
      ) : lastEvents ? null : (
        <Awaiting />
      )}
      <DroppedNote n={droppedOf(study, "last_events")} one="event" />

      <div className="es-range-head">
        {/* desk/pdf-polish 6: "Edge vs a normal period · 90% range", the level the engine's one (§14.3,
            `verdict_confidence`), said in words; there is no control for another. */}
        <p className="dk-stat-label">
          <EdgeLabel target={target} /> ·{" "}
          <span className="es-conf-word" data-testid="es-conf">
            {fin(study.verdict_confidence) ? `${roundHalfUp(study.verdict_confidence, 2)}% range` : "the engine's range"}
          </span>
        </p>
      </div>
      {horizons ? (
        <ul className="es-ranges">
          {horizons.map((h) => (
            <li key={h.h}>
              <span>{h.label}</span>
              {/* An interval served null with its reason (under five blocks, §12.2) says why in words; one that did not arrive is Awaiting refresh. */}
              {!rangeText(h.ci_lo, h.ci_hi, unit) && typeof h.reason === "string" && h.reason ? (
                <span className="es-range-why">{h.reason}</span>
              ) : (
                <span className="es-range-pts" title={rangeText(h.ci_lo, h.ci_hi, unit) ? tip : undefined}>
                  {rangeWords(h.ci_lo, h.ci_hi, unit)}
                </span>
              )}
              <VerdictWord verdict={h.verdict} />
            </li>
          ))}
        </ul>
      ) : (
        <Awaiting />
      )}
      <DroppedNote n={droppedOf(study, "horizons")} one="horizon" />

      <div className="es-rail-foot">
        <Advanced items={`${fin(study.matched_n) ? `all ${study.matched_n} events` : "all events"} · resampling detail · entry rules · provenance`} open={advOpen} onToggle={onAdvanced} controls={advId} />
        <button type="button" className="dk-link es-export" onClick={onExport} disabled={exporting || busy} data-testid="es-export">
          Export →
        </button>
      </div>
    </>
  );
}
