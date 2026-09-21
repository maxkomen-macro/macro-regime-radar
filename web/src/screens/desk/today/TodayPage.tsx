/**
 * Today (docs/desk/DESK_FRAME_SPEC.md §5): the current regime label as the
 * page's answer, the recession probability with its provenance sentence, the
 * signals that fired in the last five sessions, and the open positions
 * nearest falsification. Every number is a served field; the recession model
 * is named as a separate model from the regime odds (decision 4). Client view
 * prints the odds in words.
 */

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Pill, Tag } from "../../../components";
import { useAlerts, useFreshness, useRecessionProbability, useRegimeLatest, useSignalsLatest } from "../../../api/queries";
import type { Alert, Regime } from "../../../api/types";
import { fmtDate, fmtMonYr, fmtProb, fmtWholePct } from "../../../lib/format";
import Jargon from "../../shared/Jargon";
import { Caption, StateNote } from "../../shared/screen-ui";
import DeskPageHead from "../DeskPageHead";
import StatusBadge from "../StatusBadge";
import { SOURCES } from "../badge-sources";
import type { DeskPage } from "../desk-sections";
import { EmptyState, Figure, Panel } from "../desk-ui";
import { useDeskView } from "../desk-view";
import { MonitoredRow } from "../positions/PositionMonitorPage";
import { distanceOf, useReadings } from "../positions/series";
import { usePositions } from "../positions/store";
import { oddsInWords } from "../words";

const PILL_TONE: Record<string, "mint" | "amber" | "gray" | "overheating" | "stagflation"> = {
  Goldilocks: "mint",
  Overheating: "overheating",
  Stagflation: "stagflation",
  "Recession Risk": "gray",
};

function dominant(r: Regime): number | null {
  const probs = [r.prob_goldilocks, r.prob_overheating, r.prob_stagflation, r.prob_recession].filter((x): x is number => typeof x === "number");
  return probs.length ? Math.max(...probs) : null;
}

/** Five sessions: the last completed session and the four weekdays before it
 * (exchange holidays are not known here; the panel prints the exact dates). */
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

const LEVEL_TONE: Record<string, "info" | "watch" | "alert"> = { info: "info", watch: "watch", risk: "alert" };

export default function TodayPage({ page }: { page: DeskPage }) {
  const { isClient } = useDeskView();
  const regime = useRegimeLatest();
  const recession = useRecessionProbability();
  const alerts = useAlerts(200);
  const signals = useSignalsLatest();
  const freshness = useFreshness();
  const { positions } = usePositions();
  const readings = useReadings(positions);

  const r = regime.data;
  const dom = r ? dominant(r) : null;
  const window = firedWindow(freshness.data?.session?.last_completed_session);
  const fired: Alert[] = useMemo(() => (alerts.data ?? []).filter((a) => a.date >= window.from && a.date <= window.to).sort((a, b) => (a.date < b.date ? 1 : -1)), [alerts.data, window.from, window.to]);
  const triggered = (signals.data?.signals ?? []).filter((s) => s.triggered);

  const nearest = useMemo(() => {
    return positions
      .map((p) => {
        const rd = readings[p.id]?.data;
        const d = rd ? distanceOf(rd, p.falsification.level, p.falsification.direction) : null;
        return { p, score: d ? (d.falsified ? -1 : (d.pct ?? Number.POSITIVE_INFINITY)) : Number.POSITIVE_INFINITY };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5)
      .map((x) => x.p);
  }, [positions, readings]);

  const title = regime.isLoading ? "Reading the regime…" : regime.isError || !r ? "Regime unavailable" : r.label;
  const description = !r
    ? regime.isError
      ? "The regime read did not load; the data service did not answer."
      : undefined
    : isClient
      ? `The classifier reads ${r.label} for ${fmtMonYr(r.date)}, at ${oddsInWords(dom)} odds.`
      : `The classifier's ${fmtMonYr(r.date)} read. Dominant odds ${dom != null ? fmtWholePct(dom) : "—"}, model confidence ${fmtWholePct(r.confidence)}. Goldilocks ${fmtWholePct(r.prob_goldilocks ?? 0)} · Overheating ${fmtWholePct(r.prob_overheating ?? 0)} · Stagflation ${fmtWholePct(r.prob_stagflation ?? 0)} · Recession Risk ${fmtWholePct(r.prob_recession ?? 0)}.`;

  const rec = recession.data;
  const recPct = rec?.recession_prob ?? null;

  return (
    <div className="mrr-desk-page">
      <DeskPageHead
        page={page}
        display={Boolean(r)}
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            {title}
            {r && dom != null && !isClient ? (
              <Pill tone={PILL_TONE[r.label] ?? "gray"} size="sm" title={`Dominant regime odds, ${fmtMonYr(r.date)}`}>
                {fmtWholePct(dom)}
              </Pill>
            ) : null}
          </span>
        }
        description={description}
        badge={<StatusBadge source={SOURCES.regime} />}
      />

      <div className="mrr-desk-2">
        <Panel id="recession" title="Recession probability" badge={<StatusBadge source={{ ...SOURCES.recession, block: rec?.freshness ?? null }} />}>
          {rec ? (
            <>
              <Figure label={<Jargon term="recession model">Within 12 months</Jargon>} value={isClient ? oddsInWords(recPct != null ? recPct / 100 : null) : fmtProb(recPct, "percent", 1)} size={isClient ? 22 : 40} sub={rec.recession_label} />
              <Caption as="p" style={{ marginTop: 10 }}>
                {isClient
                  ? `A separate model from the regime odds above, trained on the official NBER recession dates. Inputs as of ${fmtDate(rec.data_as_of)}.`
                  : `From the NBER-trained logistic model (source: ${rec.probability_source}), a separate model from the regime odds above. Inputs as of ${fmtDate(rec.data_as_of)}; ${rec.n_training_samples} training months; features ${rec.model_features.join(", ")}.`}
              </Caption>
            </>
          ) : (
            <StateNote loading={recession.isLoading} error={recession.isError} live>
              Fitting the recession model…
            </StateNote>
          )}
        </Panel>

        <Panel id="fired" title="Signals fired" description={`Last five sessions (${fmtDate(window.from)} to ${fmtDate(window.to)}, weekdays)`} badge={<StatusBadge source={{ ...SOURCES.signals, block: signals.data?.freshness ?? null }} />} meta={alerts.data ? `${fired.length} fired` : undefined}>
          {alerts.isLoading ? (
            <StateNote loading live>
              Reading the alert feed…
            </StateNote>
          ) : alerts.isError ? (
            <StateNote error live />
          ) : fired.length ? (
            <ul className="mrr-desk-rows" aria-label="Signals fired in the last five sessions">
              {fired.map((a) => (
                <li key={a.id} className="mrr-desk-row">
                  <div style={{ minWidth: 0 }}>
                    <div className="mrr-desk-row-title">{a.name.replace(/_/g, " ")}</div>
                    <div className="mrr-desk-row-sub">{a.message ?? a.alert_type}</div>
                  </div>
                  <div style={{ textAlign: "right", display: "grid", gap: 4, justifyItems: "end" }}>
                    <Tag tone={LEVEL_TONE[a.level] ?? "reference"}>{a.level}</Tag>
                    <div className="mrr-desk-row-meta">{fmtDate(a.date)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No signal fired in the last five sessions.">
              {signals.data
                ? triggered.length
                  ? `On the ${fmtMonYr(signals.data.date)} read, ${triggered.length} of ${signals.data.signals.length} monitored signals are Triggered: ${triggered.map((s) => s.signal_name.replace(/_/g, " ")).join(", ")}.`
                  : `On the ${fmtMonYr(signals.data.date)} read, none of the ${signals.data.signals.length} monitored signals is Triggered.`
                : "The monitored signals are being read."}
            </EmptyState>
          )}
        </Panel>
      </div>

      <Panel id="positions" title="Open positions nearest falsification" description={isClient ? "The saved positions closest to the level that would prove them wrong." : "Saved on this device; distance from the live series to each falsification level."} badge={<StatusBadge source={SOURCES.positions} />} meta={positions.length ? `${positions.length} saved` : "none saved"}>
        {nearest.length ? (
          <ul className="mrr-desk-rows" aria-label="Positions nearest falsification">
            {nearest.map((p) => (
              <MonitoredRow key={p.id} p={p} reading={readings[p.id] ?? { isLoading: true, isError: false }} isClient={isClient} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No positions saved on this device.">
            Promote one through the discipline gate in <Link to="/desk/position-monitor">Position Monitor</Link>.
          </EmptyState>
        )}
      </Panel>
      {!isClient ? (
        <Caption mono>
          Regime: /api/regime/latest · recession: /api/recession/probability (probability_source recession_model) · fired: /api/alerts within the window · positions: this browser. Nothing is re-derived here.
        </Caption>
      ) : null}
    </div>
  );
}
