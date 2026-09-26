/**
 * Today (DESK_FRAME2_SPEC §5): one strip of four cards.
 *
 * - Regime: the classifier's newest monthly label, nothing else from the
 *   regimes table (its odds carry prob_recession, which the Desk never
 *   shows). The tooltip states the lag the engine reads it with (the
 *   engine's regime_lag_months).
 * - Recession probability (logistic model): /api/recession/probability,
 *   probability_source recession_model, the only recession number on the Desk.
 *   The card dates its number by the reading it is: the last point of the
 *   served recession_prob_series, which the server cuts at today and whose
 *   value is the headline. Never `data_as_of`: that is the month-end label of
 *   the newest input bucket (a partial month, e.g. "2026-09-30" on Sep 23), a
 *   day in the future the displayed number does not even read.
 * - Presets fired: each engine preset's newest event date, from its own
 *   response, against the five weekdays to its own as_of (a stale store never
 *   reads as quiet). "None fired" only once every preset has answered; a
 *   preset still loading, computing or awaiting a refresh makes the card say
 *   the read is incomplete (review R-02).
 * - Positions nearest falsification: saved on this device, the three closest.
 *
 * One badge per card. Client view prints the probability and the distances
 * in words.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRecessionProbability, useRegimeLatest } from "../../../api/queries";
import { PRESET_LABEL, useEventStudy, useEventStudyAssets, type EventStudyResponse } from "../../../api/desk";
import { fmtDate, fmtMonYr } from "../../../lib/format";
import Jargon from "../../shared/Jargon";
import { StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import { SOURCES } from "../badge-sources";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel, numStyle } from "../desk-ui";
import { useDeskView, withView, type DeskView } from "../desk-view";
import StudyBadge, { StudiesBadge, cutoffs, type NamedStudy } from "../event-study/StudyBadge";
import { PRESETS } from "../event-study/studies";
import { MonitoredRow } from "../positions/PositionMonitorPage";
import { distanceOf, useReadings } from "../positions/series";
import { usePositions } from "../positions/store";
import { pyFixed } from "../pyformat";
import { oddsInWords } from "../words";

/** The recession card's label: the one place the Desk says "model". */
export const RECESSION_LABEL = "Recession probability (logistic model)";

const RECESSION_DEF =
  "A logistic regression on the yield curve, unemployment, the high-yield spread, industrial production and the 10Y − 5Y breakeven spread, fit to the NBER recession dates: the probability of a recession within 12 months. Each monthly reading uses its inputs lagged three months, so a reading is dated by its month, not by the newest input; the badge dates the input series themselves. A separate read from the regime classifier.";

/** Pure: the month the card's number is, from the served series (its last
 * point, when that point is the headline value); null when they disagree or
 * the series is empty, so the card prints no date rather than a wrong one. */
export function recessionReadingDate(rec: { recession_prob: number | null; recession_prob_series: { date: string; value: number | null }[] | null }): string | null {
  const last = rec.recession_prob_series?.at(-1);
  return last && rec.recession_prob != null && last.value === rec.recession_prob ? last.date : null;
}

/** Five sessions: the last session and the four weekdays before it
 * (exchange holidays are not known here; the card prints the exact dates). */
export function firedWindow(lastSession: string | null | undefined): { from: string; to: string } {
  const to = lastSession ?? new Date().toISOString().slice(0, 10);
  const d = new Date(`${to}T00:00:00Z`);
  let sessions = d.getUTCDay() === 0 || d.getUTCDay() === 6 ? 0 : 1;
  while (sessions < 5) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) sessions++;
  }
  return { from: d.toISOString().slice(0, 10), to };
}

/** Where one preset stands (review R-02): answered with its newest event
 * judged against its own five weekdays, or still waiting on the engine. */
export type PresetState = "answered" | "loading" | "computing" | "awaiting refresh" | "no answer";

export interface PresetRead {
  slug: string;
  label: string;
  state: PresetState;
  /** Five weekdays to this preset's own as_of; null until it answers. */
  window: { from: string; to: string } | null;
  /** The newest event the engine serves for the preset, YYYY-MM-DD. */
  last: string | null;
  fired: boolean;
}

export interface PresetInput {
  slug: string;
  study: EventStudyResponse | null;
  /** When there is no study: why. */
  state: Exclude<PresetState, "answered">;
}

/** Pure: each preset's newest event against its own window (its own as_of). */
export function presetReads(inputs: readonly PresetInput[]): PresetRead[] {
  return inputs.map(({ slug, study, state }) => {
    if (!study) return { slug, label: PRESET_LABEL[slug] ?? slug, state, window: null, last: null, fired: false };
    const window = firedWindow(study.provenance.as_of);
    const last = study.recent_events[0]?.date ?? null;
    return { slug, label: PRESET_LABEL[slug] ?? slug, state: "answered", window, last, fired: Boolean(last && last >= window.from && last <= window.to) };
  });
}

/** Pure: the card's headline. "None fired" only once every preset has
 * answered; while any is loading, computing, awaiting a refresh or silent, the
 * card says the read is incomplete (review R-02). */
export function presetsHeadline(reads: readonly PresetRead[]): { value: string; complete: boolean } {
  const fired = reads.filter((r) => r.fired).length;
  const answered = reads.filter((r) => r.state === "answered").length;
  const complete = reads.length > 0 && answered === reads.length;
  if (complete) return { value: fired ? `${fired} fired` : "None fired", complete };
  return { value: fired ? `${fired} fired so far` : "Incomplete", complete };
}

function presetStateOf(q: ReturnType<typeof useEventStudy>): Exclude<PresetState, "answered"> {
  if (q.data?.state === "computing") return "computing";
  if (q.data?.state === "awaiting_refresh") return "awaiting refresh";
  if (q.isError) return "no answer";
  return "loading";
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className="mrr-desk-strip-label">{children}</div>;
}

function RegimeCard({ lag, isClient }: { lag: number | null; isClient: boolean }) {
  const regime = useRegimeLatest();
  const r = regime.data;
  const lagDef =
    lag != null
      ? `The classifier's newest monthly label. Event studies on the Desk read it with a ${lag}-month lag: an event in month K takes the label stamped K−${lag}, so no study sees a label published after its event.`
      : "The classifier's newest monthly label. Event studies on the Desk read it with a lag, so no study sees a label published after its event.";
  return (
    <Panel id="regime" title="Regime" badge={<StatusBadge source={SOURCES.regime} />} className="mrr-desk-strip-card">
      {r ? (
        <>
          <Eyebrow>
            <Jargon term="regime lag" def={lagDef}>
              Classifier label, {fmtMonYr(r.date)}
            </Jargon>
          </Eyebrow>
          <div className="mrr-desk-strip-value mrr-display" data-testid="today-regime">
            {r.label}
          </div>
          <p className="mrr-desk-strip-sub">{isClient ? `The classifier reads ${r.label} for ${fmtMonYr(r.date)}.` : lag != null ? `Event studies read each session's label from ${lag} months earlier.` : "Event studies read each session's label from an earlier month."}</p>
        </>
      ) : (
        <StateNote loading={regime.isLoading} error={regime.isError} live>
          Reading the regime…
        </StateNote>
      )}
    </Panel>
  );
}

function RecessionCard({ isClient }: { isClient: boolean }) {
  const recession = useRecessionProbability();
  const rec = recession.data;
  const pct = rec?.probability_source === "recession_model" ? rec.recession_prob : null;
  const reading = rec ? recessionReadingDate(rec) : null;
  return (
    <Panel id="recession" title="Recession" badge={<StatusBadge source={{ ...SOURCES.recession, block: rec?.freshness ?? null }} />} className="mrr-desk-strip-card">
      {rec ? (
        <>
          <Eyebrow>
            <Jargon term="recession probability (logistic model)" def={RECESSION_DEF}>
              {RECESSION_LABEL}
            </Jargon>
          </Eyebrow>
          <div className="mrr-desk-strip-value" style={numStyle} data-testid="today-recession">
            {isClient ? oddsInWords(pct != null ? pct / 100 : null) : pct != null && Number.isFinite(pct) ? `${pyFixed(pct, 1)}%` : "—"}
          </div>
          <p className="mrr-desk-strip-sub" data-testid="today-recession-sub">
            {rec.recession_label}
            {reading ? ` · the ${fmtMonYr(reading)} reading` : ""}
          </p>
        </>
      ) : (
        <StateNote loading={recession.isLoading} error={recession.isError} live>
          Fitting the recession probability…
        </StateNote>
      )}
    </Panel>
  );
}

function PresetsCard({ slugs, isClient, view }: { slugs: string[]; isClient: boolean; view: DeskView }) {
  const q0 = useEventStudy(slugs[0] ?? null);
  const q1 = useEventStudy(slugs[1] ?? null);
  const q2 = useEventStudy(slugs[2] ?? null);
  const qs = [q0, q1, q2].slice(0, slugs.length);
  const inputs: PresetInput[] = qs.map((q, i) => ({ slug: slugs[i], study: q.data?.state === "ready" ? q.data.study : null, state: presetStateOf(q) }));
  const reads = presetReads(inputs);
  const head = presetsHeadline(reads);
  // The studies that answered: the badge takes the earliest of their as_of dates (review R-12).
  const named: NamedStudy[] = inputs.filter((x) => x.study).map((x) => ({ name: PRESET_LABEL[x.slug] ?? x.slug, study: x.study! }));
  const cut = cutoffs(named);
  const windows = [...new Set(reads.filter((r) => r.window).map((r) => `${r.window!.from}|${r.window!.to}`))];
  const one = windows.length === 1 ? windows[0].split("|") : null;
  const answered = reads.filter((r) => r.state === "answered").length;
  const eyebrow = !head.complete
    ? `${answered} of ${reads.length} presets answered; the read is incomplete until all have`
    : one
      ? `Five weekdays to the last session read, ${fmtDate(one[0])} to ${fmtDate(one[1])}`
      : "Five weekdays to each preset's own last session read";
  return (
    <Panel id="fired" title="Presets fired" badge={named.length ? <StudiesBadge items={named} /> : <StudyBadge study={null} />} className="mrr-desk-strip-card">
      <Eyebrow>{eyebrow}</Eyebrow>
      <div className="mrr-desk-strip-value" style={numStyle} data-testid="today-fired" data-complete={head.complete ? "true" : "false"}>
        {head.value}
      </div>
      {cut.differ ? (
        <p className="mrr-desk-strip-sub" data-testid="today-cutoffs">
          {`Cutoffs differ: ${named.map((n) => `${n.name} ${fmtDate(n.study.provenance.as_of)}`).join("; ")}.`}
        </p>
      ) : null}
      <ul className="mrr-desk-strip-list" aria-label="Presets and their newest event">
        {reads.map((r) => (
          <li key={r.slug} data-fired={r.fired ? "true" : undefined} data-state={r.state} title={r.window ? `Window ${r.window.from} to ${r.window.to}` : undefined}>
            <Link to={withView(`/desk/event-study?study=${r.slug}`, view)}>{r.label}</Link>
            <span>{r.state !== "answered" ? r.state : r.last ? `${r.fired ? "fired" : "last"} ${fmtDate(r.last)}` : isClient ? "no reading" : "no event served"}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PositionsCard({ isClient, pathTo }: { isClient: boolean; pathTo: (slug: string) => string }) {
  const { positions } = usePositions();
  const readings = useReadings(positions);
  const nearest = useMemo(
    () =>
      positions
        .map((p) => {
          const rd = readings[p.id]?.data;
          const d = rd ? distanceOf(rd, p.falsification.level, p.falsification.direction) : null;
          return { p, score: d ? (d.falsified ? -1 : (d.pct ?? Number.POSITIVE_INFINITY)) : Number.POSITIVE_INFINITY };
        })
        .sort((a, b) => a.score - b.score)
        .slice(0, 3)
        .map((x) => x.p),
    [positions, readings],
  );
  return (
    <Panel id="positions" title="Nearest falsification" badge={<StatusBadge source={SOURCES.positions} />} className="mrr-desk-strip-card">
      <Eyebrow>{positions.length ? `${positions.length} saved on this device` : "Saved on this device"}</Eyebrow>
      {nearest.length ? (
        <ul className="mrr-desk-rows" aria-label="Positions nearest falsification">
          {nearest.map((p) => (
            <MonitoredRow key={p.id} p={p} reading={readings[p.id] ?? { isLoading: true, isError: false }} isClient={isClient} compact />
          ))}
        </ul>
      ) : (
        <EmptyState title="No positions saved on this device.">
          Promote one through the discipline gate in <Link to={pathTo("position-monitor")}>Position Monitor</Link>.
        </EmptyState>
      )}
    </Panel>
  );
}

export default function TodayPage({ page }: { page: DeskPage }) {
  const { isClient, pathTo, view } = useDeskView();
  const assets = useEventStudyAssets();
  const slugs = (assets.data?.presets ?? Object.keys(PRESETS).map((slug) => ({ slug }))).map((p) => p.slug).slice(0, 3);
  return (
    <div className="mrr-desk-page">
      <DeskPageHead page={page} description={page.blurb} badge={<StatusBadge source={SOURCES.regime} />} />
      <div className="mrr-desk-strip" data-testid="today-strip">
        <RegimeCard lag={assets.data?.regime_lag_months ?? null} isClient={isClient} />
        <RecessionCard isClient={isClient} />
        <PresetsCard slugs={slugs} isClient={isClient} view={view} />
        <PositionsCard isClient={isClient} pathTo={pathTo} />
      </div>
    </div>
  );
}
