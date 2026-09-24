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
import { dayLong, numberWord, pct, pctPlain, signed, VERDICT_LABEL } from "../kit/format";
import { Advanced, Signed, VerdictWord } from "../kit/ui";
import { CONFIDENCES } from "./question";

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

export function rangeWords(lo: number, hi: number): string {
  return `${signed(lo)} to ${signed(hi)} pts`;
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
  confidence: number;
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
  const today = todayRegime ? study.by_regime.find((r) => r.regime === todayRegime) : undefined;
  return (
    <>
      <div className="es-verdict" data-verdict={verdict}>
        <p className="es-verdict-label">Verdict · {VERDICT_LABEL[verdict]}</p>
        <p>
          <b>{study.verdict_line}</b> {study.why} {study.what_to_do}{" "}
          <Link className="dk-link" to={priceHref}>
            Price it →
          </Link>
        </p>
      </div>

      <p className="dk-stat-label es-rail-h">By regime · a month later</p>
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
          {study.by_regime.map((r) => {
            const few = r.n < 5;
            const none = !few && (r.up_pct == null || r.median == null);
            return (
              <tr key={r.regime}>
                <th scope="row">
                  <i className="es-key" data-tone={REGIME_KEY[r.regime] ?? "gray"} aria-hidden="true" />
                  {r.regime}
                </th>
                <td>{r.n}</td>
                <td data-few={few || none || undefined}>{few ? "n<5" : none ? "—" : pctPlain(r.up_pct as number)}</td>
                <td data-few={few || none || undefined}>{few ? "n<5" : none ? "—" : <Signed value={r.median as number}>{pct(r.median as number)}</Signed>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {today ? (
        <p className="es-note">
          Today is {today.regime}: {numberWord(today.n)} event{today.n === 1 ? "" : "s"}
          {today.n < 10 ? ", too few to read alone." : "."}
        </p>
      ) : null}

      <p className="dk-stat-label es-rail-h">Last five events · {study.series?.find((s) => s.key === study.question.target)?.label ?? study.question.target} a month later</p>
      <ul className="es-events">
        {study.last_events.map((e) => (
          <li key={e.date}>
            <span>{dayLong(e.date)}</span>
            <span className="es-events-regime">{e.regime}</span>
            <Signed value={e.ret_20}>{pct(e.ret_20)}</Signed>
          </li>
        ))}
      </ul>

      <div className="es-range-head">
        <p className="dk-stat-label">
          Range <span className="dk-lc">vs</span> normal
        </p>
        <div className="es-conf" role="group" aria-label="Confidence">
          <span className="es-conf-word">confidence</span>
          {CONFIDENCES.map((c) => (
            <button key={c} type="button" aria-pressed={Math.abs(confidence - c) < 1e-9} onClick={() => onConfidence(c)}>
              {Math.round(c * 100)}%
            </button>
          ))}
        </div>
      </div>
      <ul className="es-ranges">
        {study.horizons.map((h) => (
          <li key={h.h}>
            <span>{h.label}</span>
            <span className="es-range-pts">{rangeWords(h.ci_lo_pts, h.ci_hi_pts)}</span>
            <VerdictWord verdict={h.verdict} />
          </li>
        ))}
      </ul>
      <p className="es-note">{study.confidence_note}</p>

      <div className="es-rail-foot">
        <Advanced items={`all ${study.n_events} events · resampling detail · entry rules · provenance`} open={advOpen} onToggle={onAdvanced} controls={advId} />
        <button type="button" className="dk-link es-export" onClick={onExport} disabled={exporting || busy} data-testid="es-export">
          Export →
        </button>
      </div>
    </>
  );
}
