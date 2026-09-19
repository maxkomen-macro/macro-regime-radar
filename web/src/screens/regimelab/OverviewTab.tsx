/**
 * Regime Lab Overview sub-tab (redesign Phase 4, checklist 04 B.4 to B.6):
 * Cycle position (spell tile with the avg tick and the late-cycle meters),
 * Transition outlook (3- and 6-month odds tiles plus the new "How past
 * {Regime} spells ended" tile) and the regime-history ribbon teaser linking to
 * the History sub-tab (decision 5).
 *
 * Every number is a served field except the arithmetic completions the
 * checklist names: the 6-month stay residual (`stay6m`), the spell start and
 * the exit counts over the stored monthly labels (`spellStart`, `exitCounts`;
 * the Gantt's own merge). The "vs 3 mo ago" deltas the mockup draws are not
 * served (`TransitionOutlook` carries no prior snapshot, F1) and are hidden.
 *
 * Iteration 1 (G2 / G3): tiles of one row carry the same amount of content.
 * The spell tile adds a strip of three served duration fields under its
 * gauge (it ran 60 to 115 px short of the late-cycle tile); the
 * highest-risk path (a 3-month figure) sits in the 3-month caption; the
 * counting method moves behind "Details" at the foot of the panel; exit rows
 * share the meter rows' pitch. The tile rows read the Regime Lab's width
 * (`.mrr-lab` container, app.css): below 1000 px the cycle tiles stack and
 * the exits tile takes its own row under the two odds tiles.
 *
 * The screen calls the hooks once and passes the query results down (B.0);
 * rendered bare (tests, /kit) the tab reads the same React Query keys itself,
 * which dedupes to the one request either way.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { Card, GaugeBar, MeterRow, SectionHeader, Tag } from "../../components";
import { useRegimeDuration, useRegimeHistory, useRegimeLatest, useTransitions } from "../../api/queries";
import type { Regime, RegimeDuration, TransitionOutlook } from "../../api/types";
import { fmtMonYr, fmtProb, ordinal, tidyProse } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, MISSING, StateNote, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import Disclosure from "../shared/Disclosure";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import { STATUS_DEFINITION, cycleStatusTone, monthsText } from "./hero-copy";
import { REGIMES, REGIME_HUE, completedSpells, exitCounts, regimeHue, spellStart, stay6m } from "./regime-history";
import RegimeRibbon from "./RegimeRibbon";

export interface OverviewTabProps {
  duration?: UseQueryResult<RegimeDuration>;
  transitions?: UseQueryResult<TransitionOutlook>;
  history?: UseQueryResult<Regime[]>;
  regime?: UseQueryResult<Regime>;
}

const TILE_PAD = "16px 18px";

const bigNumber: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: 32,
  lineHeight: 1.1,
  letterSpacing: "-.01em",
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
};

/* The spell tile's served duration fields (Iteration 1, G2): three cells
   under the gauge, sub-eyebrow labels over UI-face figures. */
const spellStats: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: "0 16px",
  margin: "14px 0 0",
  paddingTop: 12,
  borderTop: "1px solid var(--line-2)",
};
/* A label that wraps keeps its figure on the row the others sit on. */
const statCell: React.CSSProperties = { display: "flex", flexDirection: "column", minWidth: 0 };
const statLabel: React.CSSProperties = { ...eyebrowStyle, fontSize: 11, letterSpacing: ".14em", lineHeight: 1.35, margin: 0 };
const statValue: React.CSSProperties = {
  margin: "auto 0 0",
  paddingTop: 4,
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: 17,
  lineHeight: 1.2,
  fontVariantNumeric: "tabular-nums",
  color: "var(--text)",
};

/* ── Cycle position ─────────────────────────────────────────────────────── */

export function CycleSection({ duration, history }: { duration: UseQueryResult<RegimeDuration>; history: UseQueryResult<Regime[]> }) {
  const d = duration.data;
  const lastRow = history.data?.[history.data.length - 1];
  const start = spellStart(history.data);
  const months = d ? monthsText(d.months_in_regime) : "0";
  const statusTone = d ? cycleStatusTone(d.status) : "clear";
  return (
    <Card as="section" id="cycle" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Cycle position"
        description="Spell length vs 30 years of stored history"
        right={<MetaWithStamp meta="Live model output" stamp={<Stamp source={SRC.classifierHistory} asOf={lastRow ? fmtMonYr(lastRow.date) : null} />} />}
      />
      {d ? (
        <div className="mrr-lab-tiles-2">
          <Card variant="tile" padding={TILE_PAD}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <span className="num" style={bigNumber}>
                {months} mo
              </span>
              <Tag size="sm" tone={statusTone}>
                {d.status}
              </Tag>
              {start?.since ? (
                <span className="mrr-lab-started" style={{ ...monoNoteStyle, marginLeft: "auto" }}>
                  Started {fmtMonYr(start.since)}
                </span>
              ) : null}
            </div>
            <GaugeBar
              height={8}
              gradient
              tone={statusTone}
              pct={Math.min(d.progress_pct / 2, 100)}
              tick={50}
              scale={{ left: "0", mid: `avg ${d.historical_avg_months.toFixed(1)} mo`, right: "2× avg" }}
              ariaLabel={`Spell length ${months} months against twice the historical average`}
              style={{ marginTop: 18 }}
            />
            <dl className="mrr-lab-spell-stats" style={spellStats}>
              <div style={statCell}>
                <dt style={statLabel}>Days in regime</dt>
                <dd style={statValue}>{d.days_in_regime}</dd>
              </div>
              <div style={statCell}>
                <dt style={statLabel}>Of the average spell</dt>
                <dd style={statValue}>{Math.round(d.progress_pct)}%</dd>
              </div>
              <div style={statCell}>
                <dt style={statLabel}>Past spells outlasted</dt>
                <dd style={statValue}>{fmtProb(d.percentile_duration, "percent")}</dd>
              </div>
            </dl>
            <Caption style={{ marginTop: 12 }}>
              {d.current_regime} has run {months} month{months === "1" ? "" : "s"}, longer than {d.percentile_duration.toFixed(0)}% of past{" "}
              {d.current_regime} spells, which average {d.historical_avg_months.toFixed(1)} months. {d.status} means{" "}
              {STATUS_DEFINITION[d.status] ?? STATUS_DEFINITION.Early}
            </Caption>
          </Card>
          <Card variant="tile" padding={TILE_PAD}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
              <SectionHeader level="sub" as="h3" title="Late-cycle risk indicators" style={{ margin: 0 }} />
              <span style={{ ...monoNoteStyle, marginLeft: "auto" }}>Percentile vs history</span>
            </div>
            {(
              [
                ["Momentum", d.risk_indicators.momentum],
                ["Valuation stretch", d.risk_indicators.valuation],
                ["Complacency", d.risk_indicators.sentiment],
              ] as const
            ).map(([label, v]) => (
              <MeterRow
                key={label}
                label={label}
                pct={v}
                value={ordinal(v)}
                valueSize="sm"
                labelWidth={130}
                height={34}
                tone={v < 40 ? "pos" : v < 70 ? "watch" : "alert"}
              />
            ))}
            <Caption style={{ marginTop: 6 }}>
              Percentile ranks, higher = more late-cycle risk: momentum is SPY&apos;s 20-day run vs its last 252 sessions; valuation stretch
              and complacency invert the HY-spread and VIX percentiles over the full stored history (tight spreads and a sleepy VIX rank
              high).
            </Caption>
          </Card>
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={duration.isLoading} error={duration.isError} missing={MISSING.cycle} />
        </Card>
      )}
    </Card>
  );
}

/* ── Transition outlook ─────────────────────────────────────────────────── */

function OddsRows({ current, stay, rows, labelWidth = 112 }: { current: string; stay: number; rows: TransitionOutlook["transitions_3m"]; labelWidth?: number }) {
  return (
    <>
      <MeterRow
        label={`stays ${current}`}
        pct={stay}
        value={fmtProb(stay, "percent")}
        swatch={regimeHue(current)}
        color={regimeHue(current)}
        labelWidth={labelWidth}
      />
      {rows.map((tr) => (
        // The served `tr.color` is an old-palette hex; the hue token carries the regime.
        <MeterRow
          key={tr.to}
          label={`→ ${tr.to}`}
          pct={tr.probability}
          value={fmtProb(tr.probability, "percent")}
          swatch={regimeHue(tr.to)}
          color={regimeHue(tr.to)}
          labelWidth={labelWidth}
        />
      ))}
    </>
  );
}

export function TransitionsSection({
  transitions,
  history,
  regime,
}: {
  transitions: UseQueryResult<TransitionOutlook>;
  history: UseQueryResult<Regime[]>;
  regime?: UseQueryResult<Regime>;
}) {
  const t = transitions.data;
  const rows = history.data;
  const label = t?.current_regime ?? regime?.data?.label ?? rows?.[rows.length - 1]?.label ?? null;
  const exits = rows && label ? exitCounts(rows, label) : [];
  const completed = completedSpells(exits);
  return (
    <Card as="section" id="transitions" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Transition outlook"
        description="30 years of monthly regime history"
        right={<MetaWithStamp meta="Stored empirical analysis" stamp={<Stamp source={SRC.classifierHistory} asOf={rows?.length ? fmtMonYr(rows[rows.length - 1].date) : null} />} />}
      />
      <div className="mrr-lab-tiles-3">
        {t ? (
          <>
            <Card variant="tile" padding="14px 18px 12px">
              <SectionHeader level="sub" as="h3" title="Next 3 months" style={{ marginTop: 0, marginBottom: 6 }} />
              <OddsRows current={t.current_regime} stay={t.stay_probability_3m} rows={t.transitions_3m.slice(0, 3)} />
              {/* The highest-risk path is the 3-month figure (the summary's
                  "Next 3 months" row prints it with the 3-month stay). */}
              <Caption style={{ marginTop: 8 }}>
                {tidyProse(t.narrative_3m)} Highest-risk path: → {t.highest_risk_transition} at {fmtProb(t.highest_risk_prob, "percent")}.
              </Caption>
            </Card>
            <Card variant="tile" padding="14px 18px 12px">
              <SectionHeader level="sub" as="h3" title="Next 6 months" style={{ marginTop: 0, marginBottom: 6 }} />
              <OddsRows current={t.current_regime} stay={stay6m(t)} rows={t.transitions_6m.slice(0, 4)} />
              <Caption style={{ marginTop: 8 }}>{tidyProse(t.narrative_6m)}</Caption>
            </Card>
          </>
        ) : (
          // The pending tile takes its own row, so it never stretches to the
          // exits tile's height as a blank band (G2).
          <Card variant="tile" style={{ gridColumn: "1 / -1" }}>
            <StateNote loading={transitions.isLoading} error={transitions.isError} missing={MISSING.transitions} />
          </Card>
        )}
        <Card variant="tile" padding="14px 18px" className="mrr-lab-exits">
          <SectionHeader level="sub" as="h3" title={`How past ${label ?? "regime"} spells ended`} style={{ marginTop: 0, marginBottom: 10 }} />
          {rows && label ? (
            exits.length ? (
              <>
                <div style={{ display: "grid", gap: 0 }}>
                  {exits.map((e) => (
                    <div key={e.to} className="mrr-lab-exit" style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 40 }}>
                      <span className="num" style={{ ...bigNumber, fontSize: 24, lineHeight: 1.35, width: 34, flex: "none" }}>
                        {e.count}
                      </span>
                      <span className="desc" style={{ fontFamily: "var(--font-ui)", fontSize: 13, color: "var(--text-2)" }}>
                        into{" "}
                        <b style={{ color: regimeHue(e.to), fontWeight: 500 }}>{e.to}</b>
                      </span>
                    </div>
                  ))}
                </div>
                <Caption style={{ marginTop: 10 }}>
                  {completed} completed spell{completed === 1 ? "" : "s"} since {fmtMonYr(rows[0].date)}. Small sample; read as base rates, not a
                  forecast.
                </Caption>
              </>
            ) : (
              <Caption style={{ marginTop: 0 }}>No completed {label} spells on file yet.</Caption>
            )
          ) : (
            <StateNote loading={history.isLoading} error={history.isError} />
          )}
        </Card>
      </div>
      {t ? (
        <Disclosure variant="quiet" title="Details" style={{ marginTop: 6 }}>
          <Caption style={{ marginTop: 0 }}>
            Odds are counted month-over-month from the stored classifier history: a <Jargon term="transition matrix">transition matrix</Jargon>,
            not a forecast model.
          </Caption>
        </Disclosure>
      ) : null}
    </Card>
  );
}

/* ── Regime history ribbon teaser ───────────────────────────────────────── */

const ARROW = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

function Legend() {
  return (
    <div className="mrr-lab-legend" style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
      {REGIMES.map((r) => (
        <span key={r} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: "var(--font-ui)", fontSize: 12, color: "var(--text-2)" }}>
          <i aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: REGIME_HUE[r], flex: "none" }} />
          {r}
        </span>
      ))}
    </div>
  );
}

export function RegimeHistoryTeaser({ history }: { history: UseQueryResult<Regime[]> }) {
  const rows = history.data;
  const last = rows?.[rows.length - 1];
  let body: ReactNode;
  if (rows?.length && last) {
    body = <RegimeRibbon rows={rows} variant="teaser" ariaLabel={`Regime history ribbon, ${fmtMonYr(rows[0].date)} to ${fmtMonYr(last.date)}`} />;
  } else {
    body = <StateNote loading={history.isLoading} error={history.isError} />;
  }
  return (
    <Card as="section" id="regime-history-teaser" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Regime history"
        description="The classifier's full monthly record"
        actions={
          <>
            <Legend />
            <Link className="mrr-link" to="/app/regime-lab#regime-history">
              History &amp; analogues
              {ARROW}
            </Link>
          </>
        }
      />
      <Card variant="tile" padding="16px 18px 10px">
        {body}
      </Card>
    </Card>
  );
}

/* ── Sub-tab ─────────────────────────────────────────────────────────────── */

export default function OverviewTab(props: OverviewTabProps) {
  // Unconditional hook calls; the screen's results win when passed (B.0), and
  // React Query dedupes the keys so the bare render costs no second request.
  const ownDuration = useRegimeDuration();
  const ownTransitions = useTransitions();
  const ownHistory = useRegimeHistory();
  const ownRegime = useRegimeLatest();
  const duration = props.duration ?? ownDuration;
  const transitions = props.transitions ?? ownTransitions;
  const history = props.history ?? ownHistory;
  const regime = props.regime ?? ownRegime;
  return (
    <div className="mrr-lab-overview" style={{ display: "grid", gap: "var(--gap-panel)", minWidth: 0 }}>
      <CycleSection duration={duration} history={history} />
      <TransitionsSection transitions={transitions} history={history} regime={regime} />
      <RegimeHistoryTeaser history={history} />
    </div>
  );
}
