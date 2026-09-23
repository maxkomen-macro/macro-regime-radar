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
 *   response, against the last five sessions the engine has read (the
 *   window ends at the studies' as_of, so a stale store never reads as quiet).
 * - Positions nearest falsification: saved on this device, the three closest.
 *
 * One badge per card. Client view prints the probability and the distances
 * in words.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useRecessionProbability, useRegimeLatest } from "../../../api/queries";
import { PRESET_LABEL, useEventStudy, useEventStudyAssets, type EventStudyResponse } from "../../../api/desk";
import { fmtDate, fmtMonYr, fmtProb } from "../../../lib/format";
import Jargon from "../../shared/Jargon";
import { StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import { SOURCES } from "../badge-sources";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Panel, numStyle } from "../desk-ui";
import { useDeskView, withView, type DeskView } from "../desk-view";
import StudyBadge from "../event-study/StudyBadge";
import { PRESETS } from "../event-study/studies";
import { MonitoredRow } from "../positions/PositionMonitorPage";
import { distanceOf, useReadings } from "../positions/series";
import { usePositions } from "../positions/store";
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

export interface PresetRead {
  slug: string;
  label: string;
  /** The newest event the engine serves for the preset, YYYY-MM-DD. */
  last: string | null;
  fired: boolean;
}

/** Pure: each preset's newest event against the window. */
export function presetReads(studies: { slug: string; study: EventStudyResponse | null }[], window: { from: string; to: string } | null): PresetRead[] {
  return studies.map(({ slug, study }) => {
    const last = study?.recent_events[0]?.date ?? null;
    return { slug, label: PRESET_LABEL[slug] ?? slug, last, fired: Boolean(window && last && last >= window.from && last <= window.to) };
  });
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
            {isClient ? oddsInWords(pct != null ? pct / 100 : null) : fmtProb(pct, "percent", 1)}
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
  const studies = qs.map((q, i) => ({ slug: slugs[i], study: q.data?.state === "ready" ? q.data.study : null }));
  const first = studies.find((s) => s.study)?.study ?? null;
  const window = first ? firedWindow(first.provenance.as_of) : null;
  const reads = presetReads(studies, window);
  const fired = reads.filter((r) => r.fired);
  const loading = qs.some((q) => q.isLoading);
  return (
    <Panel id="fired" title="Presets fired" badge={<StudyBadge study={first} />} className="mrr-desk-strip-card">
      <Eyebrow>{window ? `Five weekdays to the last session read, ${fmtDate(window.from)} to ${fmtDate(window.to)}` : "Five weekdays to the last session read"}</Eyebrow>
      <div className="mrr-desk-strip-value" style={numStyle} data-testid="today-fired">
        {!window ? (loading ? "…" : "—") : fired.length ? `${fired.length} fired` : "None fired"}
      </div>
      <ul className="mrr-desk-strip-list" aria-label="Presets and their newest event">
        {reads.map((r) => (
          <li key={r.slug} data-fired={r.fired ? "true" : undefined}>
            <Link to={withView(`/desk/event-study?study=${r.slug}`, view)}>{r.label}</Link>
            <span>{r.last ? `${r.fired ? "fired" : "last"} ${fmtDate(r.last)}` : isClient ? "no reading" : "not answered"}</span>
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
