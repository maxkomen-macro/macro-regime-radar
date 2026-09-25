/**
 * The Event Study rail (DESK_FRAME3_SPEC §4), top to bottom: the verdict box
 * (amber-bordered for Suggestive) with the verdict's line, why, what to do and
 * `Price it →`; the answer by regime a month later (§4's fixed label: §12.2
 * serves `by_regime` and `last_events` at 20 sessions; n under 5 reads
 * `n<5`); the last five events; the range against a normal stretch at
 * the chosen confidence (80 / 90 / 95%, re-asked with `confidence`), with the
 * served note; and the footer: Advanced and Export.
 */

import { Link } from "react-router-dom";
import type { StudyResponse } from "../data/types";
import { dayLong, isFiniteNumber as fin, numberWord, pctPlain, VERDICT_LABEL } from "../kit/format";
import { Advanced, Awaiting, Signed, VerdictWord } from "../kit/ui";
import { CONFIDENCES } from "./question";
import { isUnit, moveText, rangeText } from "./units";
import type { TargetUnit } from "../data/types";

/** The rail with no scored answer: its section labels, and why there is nothing under them (§1.7). */
export function RailPlaceholder({ reason }: { reason: "awaiting" | "too-few" }) {
  const why = reason === "awaiting" ? "Awaiting refresh" : "Not scored: too few events";
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

/** §5's key: Goldilocks green, Overheating amber, Stagflation red, Recession Risk gray. */
export const REGIME_KEY: Record<string, string> = { Goldilocks: "green", Overheating: "amber", Stagflation: "red", "Recession Risk": "gray" };

/** A horizon's range against normal in the target's unit (Codex R-02): "−1.6 to +4.1 pts", "−10 to +40 bp". */
export function rangeWords(lo: number | null, hi: number | null, unit: TargetUnit | undefined): string {
  return rangeText(lo, hi, unit) ?? "Awaiting refresh";
}

export default function StudyRail({
  study,
  todayRegime,
  confidence,
  onConfidence,
  priceHref,
  advOpen,
  onAdvanced,
  advId,
  onExport,
  exporting,
  busy = false,
}: {
  study: StudyResponse;
  todayRegime: string | null;
  /** The served confidence; null presses no chip. */
  confidence: number | null;
  onConfidence: (c: number) => void;
  priceHref: string;
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
  const target = study.question.target_label;
  return (
    <>
      <div className="es-verdict" data-verdict={verdict}>
        <p className="es-verdict-label">Verdict · {verdict ? VERDICT_LABEL[verdict] : "Awaiting refresh"}</p>
        <p>
          <b>{study.verdict_line}</b> {study.why} {study.what_to_do}{" "}
          <Link className="dk-link" to={priceHref}>
            Price it →
          </Link>
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
            const few = fin(r.n) && r.n < 5;
            return (
              <tr key={r.regime}>
                <th scope="row">
                  <i className="es-key" data-tone={REGIME_KEY[r.regime] ?? "gray"} aria-hidden="true" />
                  {r.regime}
                </th>
                <td>{fin(r.n) ? r.n : "—"}</td>
                <td data-few={few || !fin(r.up_pct) || undefined}>{few ? "n<5" : fin(r.up_pct) ? pctPlain(r.up_pct) : "—"}</td>
                <td data-few={few || !moveText(r.median, unit) || undefined}>{few ? "n<5" : fin(r.median) && moveText(r.median, unit) ? <Signed value={r.median}>{moveText(r.median, unit)}</Signed> : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      ) : (
        <Awaiting />
      )}
      {today && fin(today.n) ? (
        <p className="es-note">
          Today is {today.regime}: {numberWord(today.n)} event{today.n === 1 ? "" : "s"}
          {today.n < 10 ? ", too few to read alone." : "."}
        </p>
      ) : null}

      <p className="dk-stat-label es-rail-h">{target ? `Last five events · ${target} a month later` : "Last five events · a month later"}</p>
      {lastEvents ? (
        <ul className="es-events">
          {lastEvents.map((e) => (
            <li key={e.date}>
              <span>{dayLong(e.date)}</span>
              <span className="es-events-regime">{e.regime}</span>
              {fin(e.ret_20) && moveText(e.ret_20, unit) ? <Signed value={e.ret_20}>{moveText(e.ret_20, unit)}</Signed> : <span className="es-events-none">—</span>}
            </li>
          ))}
        </ul>
      ) : (
        <Awaiting />
      )}

      <div className="es-range-head">
        <p className="dk-stat-label">
          Range <span className="dk-lc">vs</span> normal
        </p>
        <div className="es-conf" role="group" aria-label="Confidence">
          <span className="es-conf-word">confidence</span>
          {CONFIDENCES.map((c) => (
            <button key={c} type="button" aria-pressed={fin(confidence) && Math.abs(confidence - c) < 1e-9} onClick={() => onConfidence(c)}>
              {Math.round(c * 100)}%
            </button>
          ))}
        </div>
      </div>
      {horizons ? (
        <ul className="es-ranges">
          {horizons.map((h) => (
            <li key={h.h}>
              <span>{h.label}</span>
              <span className="es-range-pts">{rangeWords(h.ci_lo_pts, h.ci_hi_pts, unit)}</span>
              <VerdictWord verdict={h.verdict} />
            </li>
          ))}
        </ul>
      ) : (
        <Awaiting />
      )}
      <p className="es-note">{study.confidence_note}</p>

      <div className="es-rail-foot">
        <Advanced items={`${fin(study.n_events) ? `all ${study.n_events} events` : "all events"} · resampling detail · entry rules · provenance`} open={advOpen} onToggle={onAdvanced} controls={advId} />
        <button type="button" className="dk-link es-export" onClick={onExport} disabled={exporting || busy} data-testid="es-export">
          Export →
        </button>
      </div>
    </>
  );
}
