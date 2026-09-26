/**
 * The Event Study rail (DESK_FRAME3_SPEC §4), top to bottom: the verdict box
 * (amber-bordered for Suggestive) with the verdict's label, the served
 * headline and why, and `Price it →` (disabled, not yet served, while Basket & Hedge is unavailable); the answer by regime a month later (§4's fixed label: §12.2
 * serves `by_regime` and `last_events` at 20 sessions; a regime under ten
 * events prints its count and "too few cases to say"); the last five events; the range against a normal stretch at
 * the engine's 90% (the 80% and 95% chips disabled, "not yet served"); and the
 * footer: Advanced and Export.
 */

import type { StudyResponse } from "../data/types";
import { dayLong, isFiniteNumber as fin, numberWord, pctPlain, VERDICT_LABEL } from "../kit/format";
import { Advanced, Awaiting, DroppedNote, Signed, UnservedLine, useUnserved, VerdictWord } from "../kit/ui";
import { droppedOf } from "../data/schema";
import { CONFIDENCES, targetLabel } from "./question";
import { isUnit, moveText, rangeText, tipOf } from "../kit/units";
import type { TargetUnit } from "../data/types";

/** The rail with no answer: its section labels, and why there is nothing under them (§1.7). A served
 * study, Too few included, is scored (v4 B-02) and gets the whole rail. */
export function RailPlaceholder() {
  // §1.0.2: a study served awaiting keeps the rail's four labels and prints its reason once, after them.
  const unserved = useUnserved();
  const why = "Awaiting refresh";
  if (unserved)
    return (
      <>
        {["Verdict", "By regime · a month later", "Last five events", "Range vs normal"].map((l) => (
          <div key={l} className="es-rail-empty">
            <p className="dk-stat-label">{l}</p>
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
        <>
          Range <span className="dk-lc">vs</span> normal
        </>,
      ].map((l, i) => (
        <div key={i} className="es-rail-empty">
          <p className="dk-stat-label">{l}</p>
          <p className="dk-await">{why}</p>
        </div>
      ))}
    </>
  );
}

/** Fewer events than this in a regime and its cells are served null (§12.2, the engine's MIN_REGIME_N). */
export const REGIME_FLOOR = 10;

/** §5's key: Goldilocks green, Overheating amber, Stagflation red, Recession Risk gray. */
export const REGIME_KEY: Record<string, string> = { Goldilocks: "green", Overheating: "amber", Stagflation: "red", "Recession Risk": "gray" };

/** §1.0: why the 80% and 95% chips are not served (they have no envelope of their own, §1.0.2). */
export const CONFIDENCE_UNAVAILABLE = "Confidence levels other than 90%: interval projection at other quantiles is new plumbing.";

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
          {study.headline ? <b>{study.headline}</b> : null} <span title={tip}>{study.why}</span>{" "}
          {/* §4: disabled with "not yet served" while Basket & Hedge is unavailable (§10). */}
          <span className="es-price-off">
            <button type="button" className="dk-link" disabled>
              Price it →
            </button>{" "}
            <span>not yet served</span>
          </span>
        </p>
      </div>

      <p className="dk-stat-label es-rail-h">By regime · a month later</p>
      {byRegime ? (
      <table className="es-table">
        <thead>
          <tr>
            <th scope="col">Regime</th>
            <th scope="col">N</th>
            <th scope="col">Up</th>
            <th scope="col">Median</th>
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
      {fin(study.unlabeled_n) && study.unlabeled_n > 0 ? (
        <p className="es-note">
          Unlabeled: {study.unlabeled_n} event{study.unlabeled_n === 1 ? "" : "s"} before the first labelled month
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
        <p className="dk-stat-label">
          Range <span className="dk-lc">vs</span> normal
        </p>
        {/* §4: the chips render disabled, "not yet served"; the engine's 90% (`verdict_confidence`) is the level shown. */}
        <div className="es-conf" role="group" aria-label="Confidence">
          <span className="es-conf-word">confidence</span>
          {CONFIDENCES.map((c) => (
            <button key={c} type="button" disabled aria-pressed={fin(study.verdict_confidence) && Math.abs(study.verdict_confidence - c) < 1e-9}>
              {Math.round(c * 100)}%
            </button>
          ))}
          <span className="es-conf-off">not yet served</span>
        </div>
      </div>
      {/* §1.0.2: the chips have no served envelope, so the rail prints §1.0's reason for them. */}
      <p className="es-conf-why dk-unserved-inline">{CONFIDENCE_UNAVAILABLE}</p>
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
