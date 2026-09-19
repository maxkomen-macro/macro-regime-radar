/**
 * Dashboard — the flagship executive screen, rebuilt on TabHero + SummaryCard
 * (redesign Phase 3, docs/redesign-v2/checklists/03-dashboard.md B.0).
 *
 * Order of <main> children, all inside `.mrr-dash`: the hero row (TabHero
 * with the 24-month stacked regime-odds chart | SummaryCard with the alert
 * status strip) → Monitored signals → the slim
 * Key levels row → the bottom row (Markets at a glance with the What's priced
 * tab | US 10Y Treasury | Macro calendar) → Macro charts (collapsed accordion)
 * → How this read is composed (two disclosures) → the mono disclosure line.
 *
 * Every number is a served field; nothing is re-derived in the browser. The
 * classifier's four-way odds and the NBER-trained recession model are two
 * readings: the hero never prints the recession model, and the rows that do
 * say "a separate model" beside it (decision 4, hero-copy.ts).
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, ProbabilityBar, SectionHeader, SignalCard } from "../../components";
import {
  useAlerts,
  useCreditOas,
  useFreshness,
  useRegimeHistory,
  useRegimeLatest,
  useRecessionProbability,
  useSeriesLatest,
  useSignalsLatest,
  useTakeaway,
  useTransitions,
} from "../../api/queries";
import type { Signal } from "../../api/types";
import { daysSince, fmtBps, fmtDate, fmtMonYr, fmtPct, fmtSigned, fmtWholePct, tidyProse } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, useHashScroll } from "../shared/screen-ui";
import { assessFreshness } from "../shared/freshness";
import Disclosure, { DisclosureLine } from "../shared/Disclosure";
import TabHero from "../shared/TabHero";
import SummaryCard, { kvLinkStyle, type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import { parseStrong } from "../shared/narrative";
import { useShellActions } from "../shell/shell-actions";
import { alertSummary, type AlertSummary } from "../shell/shell-status";
import { SIGNALS_META, SIGNAL_ORDER } from "./signals-meta";
import { HERO_GLOW, convictionWord, heroCopy, regimeOdds } from "./hero-copy";
import { WHATS_PRICED_HASH, glanceTabFromHash, type GlanceTabId } from "./glance-symbols";
import MarketsGlance from "./MarketsGlance";
import KeyLevels from "./KeyLevels";
import TenYearCard from "./TenYearCard";
import MacroCalendarCard from "./MacroCalendarCard";
import MacroCharts, { MACRO_CHARTS_HASH, chartFromHash } from "./MacroCharts";
import RegimeOddsChart from "./RegimeOddsChart";

/* ── small shared bits ─────────────────────────────────────────────────── */

const errStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-muted)",
};

/** Loading and unavailable headlines ride in the UI face at the hero-sub
 * size: the serif display face is for answers only (02 B.1 states). */
const stateHeadline: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-hero-sub)",
  lineHeight: "var(--lh-hero-sub)",
  letterSpacing: 0,
  fontVariationSettings: "normal",
};

/** The missing-print sentence inside a SignalCard's value slot. */
const missingPrintStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  fontWeight: 400,
  lineHeight: 1.5,
  color: "var(--text-3)",
  whiteSpace: "normal",
};

const HERO_ACTIONS = [
  { label: "Explore the regime", to: "/app/regime-lab", primary: true },
  { label: "View model details", to: "/app/methodology#models" },
];

/** The D5 lede with the Jargon affordance on "model confidence" (the copy is
 * plain text from hero-copy.ts; the affordance is a render concern). */
function renderLede(lede: string): ReactNode {
  const marker = "model confidence";
  const at = lede.indexOf(marker);
  if (at < 0) return lede;
  return (
    <>
      {lede.slice(0, at)}
      <Jargon term="conviction">{marker}</Jargon>
      {lede.slice(at + marker.length)}
    </>
  );
}

/**
 * The narrative's closing sentence (its implication), tidied of em-dash
 * asides, with the source module's <strong> emphasis kept for parseStrong.
 * A terminator counts only before whitespace or the end, so "11.6%" never
 * splits; an emphasis span cut by the boundary is re-balanced.
 */
export function closingSentence(narrative: string): string {
  const clean = tidyProse(narrative).replace(/\s+/g, " ").trim();
  const ends: number[] = [];
  const re = /[.!?]+(?:<\/strong>)?(?=\s|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) ends.push(m.index + m[0].length);
  let out: string;
  const tail = ends.length ? clean.slice(ends[ends.length - 1]).trim() : "";
  if (tail) out = tail;
  else if (!ends.length) out = clean;
  else out = clean.slice(ends.length > 1 ? ends[ends.length - 2] : 0).trim();
  const opens = (out.match(/<strong>/g) ?? []).length;
  const closes = (out.match(/<\/strong>/g) ?? []).length;
  if (closes > opens) out = `<strong>${out}`;
  if (opens > closes) out = `${out}</strong>`;
  return out;
}

/* ── alert status strip ────────────────────────────────────────────────── */

/** The strip's words from the bell's reading (`alertSummary`, shell-status.ts),
 * so the two never speak different sentences; the sentence is the strip's
 * accessible name. */
function alertStrip(s: AlertSummary, openAlerts: () => void): StatusStripProps {
  const base = { onClick: openAlerts, ariaHasPopup: "dialog" as const, ariaLabel: s.sentence };
  switch (s.state) {
    case "loading":
      return { ...base, tone: "gray", title: "Reading the alert feed…", detail: "Opens the alert feed" };
    case "error":
      return { ...base, tone: "gray", title: "Alert feed unavailable", detail: "The data service did not answer" };
    case "recent": {
      const a = s.recent[0];
      return {
        ...base,
        tone: "amber",
        title: `${s.recent.length} alert${s.recent.length === 1 ? "" : "s"} · 7 days`,
        detail: `Latest: ${SIGNALS_META[a.name]?.display ?? a.name} · ${fmtDate(a.date)}`,
      };
    }
    case "clear":
      return { ...base, tone: "mint", title: "No alerts · 7 days", detail: s.last ? `Last alert ${fmtDate(s.last.date)}` : undefined };
    default:
      return { ...base, tone: "mint", title: "No alerts on file", detail: "The feed starts with the first threshold breach" };
  }
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function DashboardScreen() {
  const location = useLocation();
  const { isMobile } = useBreakpoint();
  const regime = useRegimeLatest();
  const history = useRegimeHistory(36);
  const signals = useSignalsLatest();
  const alerts = useAlerts(200);
  const recession = useRecessionProbability();
  const credit = useCreditOas(90);
  const fedFunds = useSeriesLatest("FEDFUNDS");
  const vix = useSeriesLatest("VIXCLS");
  const freshness = useFreshness();
  const takeaway = useTakeaway();
  const transitions = useTransitions();
  // The glance panel (useMarketDaily, usePriced, useQuotes) and the calendar
  // card (useCalendar, useCalendarRecent) own their hooks; shared query keys
  // keep every endpoint at one request.
  const { openAlerts } = useShellActions();

  // Hash-driven state, mirrored from the panels that own it: the deep-link
  // scroll re-runs once the hash's target is actually visible (D38).
  const [glanceTab, setGlanceTab] = useState<GlanceTabId>(() => glanceTabFromHash(location.hash) ?? "equities");
  const [chartOpenId, setChartOpenId] = useState<string | null>(() => chartFromHash(location.hash));
  const hashTargetReady =
    location.hash === WHATS_PRICED_HASH ? glanceTab === "priced" : location.hash === MACRO_CHARTS_HASH ? chartOpenId != null : true;
  useHashScroll(`${regime.data ? "regime" : "pending"}:${hashTargetReady ? "ready" : "waiting"}`);

  // Streak and the switch that started it, from the stored monthly history.
  const streak = useMemo(() => {
    const rows = history.data;
    if (!rows?.length) return null;
    const lead = rows[rows.length - 1].label;
    let n = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].label === lead; i--) n++;
    const first = rows[rows.length - n];
    const prev = rows[rows.length - n - 1];
    return { n, since: first?.date, prev: prev?.label ?? null };
  }, [history.data]);

  // Desk-read pulse gate (owner ruling 2026-08-06): the dot pulses only when
  // this regime read is new to this browser since its last visit, or when the
  // macro month is inside one monthly print cycle (≤35 days). Otherwise static.
  const bannerStamp = regime.data ? `${regime.data.date}|${regime.data.label}` : null;
  const [stampSeenAtLoad] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mrr-intel-seen");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!bannerStamp) return;
    try {
      localStorage.setItem("mrr-intel-seen", bannerStamp);
    } catch {
      /* storage unavailable (private mode) — the age gate still works */
    }
  }, [bannerStamp]);
  const bannerLive =
    bannerStamp != null &&
    (stampSeenAtLoad !== bannerStamp || (regime.data != null && daysSince(regime.data.date) <= 35));

  const hy = credit.data?.series.find((s) => s.label === "HY");

  const lastAlertBySignal = useMemo(() => {
    const m = new Map<string, string>();
    alerts.data?.forEach((a) => {
      if (!m.has(a.name)) m.set(a.name, a.date); // feed arrives newest-first
    });
    return m;
  }, [alerts.data]);

  const reporting: Signal[] = signals.data?.signals ?? [];
  const bySignal = new Map(reporting.map((s) => [s.signal_name, s]));
  const triggered = reporting.filter((s) => s.triggered);
  const watching = reporting.filter((s) => s.status === "Watch");

  /* ── hero + summary ──────────────────────────────────────────────────── */
  const regimeNote = <StateNote loading={regime.isLoading} error={regime.isError && !regime.data} />;
  let hero: ReactNode;
  let readThrough: string[] = [];
  const rows: SummaryRow[] = [];

  // Rows fed by their own endpoints (5 to 7) read the same whether or not the
  // regime payload is on the page yet.
  const rec = recession.data;
  const divergenceRow: SummaryRow = {
    id: "model-vs-market",
    label: "Model vs market",
    value: rec
      ? `${rec.divergence_label}${rec.divergence_score != null ? ` · ${fmtSigned(rec.divergence_score, 0)} on ±100` : ""}`
      : recession.isError
        ? <StateNote error />
        : <StateNote loading>Training the recession model; the first call takes about a second.</StateNote>,
    tone: rec?.divergence_score != null && Math.abs(rec.divergence_score) > 20 ? "var(--amber)" : undefined,
  };
  const tr = transitions.data;
  const transitionRow: SummaryRow = {
    id: "next-3m",
    label: "Next 3 months",
    value: tr
      ? `Stays ${tr.current_regime} ${Math.round(tr.stay_probability_3m)}% · highest-risk path → ${tr.highest_risk_transition} ${Math.round(tr.highest_risk_prob)}%`
      : transitions.isError
        ? <StateNote error />
        : <StateNote loading />,
  };
  const takeawayRow: SummaryRow = {
    id: "takeaway",
    label: "Key takeaway",
    value: takeaway.data
      ? parseStrong(closingSentence(takeaway.data.narrative))
      : takeaway.isError
        ? <StateNote>Takeaway unavailable: the data service did not answer.</StateNote>
        : <StateNote loading>Assembling the market takeaway; the cold call trains the recession model once.</StateNote>,
  };

  if (regime.data) {
    const r = regime.data;
    const { probs, lead } = regimeOdds(r);
    const copy = heroCopy(r);
    const conviction = convictionWord(r.confidence);

    const thr = (name: string, dp = 2) => {
      const t = bySignal.get(name)?.threshold;
      return t != null ? t.toFixed(dp) : "its threshold";
    };
    const vixV = vix.data?.value;

    // The composed read-through survives, one click down.
    readThrough = [
      `The drivers on file: the 10Y–2Y spread holds at ${
        recession.data?.yield_curve_spread != null
          ? `${fmtBps(recession.data.yield_curve_spread)} (${fmtPct(recession.data.yield_curve_spread / 100)})`
          : "—"
      }, the VIX sits at ${vixV != null ? vixV.toFixed(2) : "—"}${
        vixV != null ? (vixV < 15 ? " (calm)" : vixV < 25 ? " (subdued)" : " (stressed)") : ""
      }, and high-yield spreads run ${hy ? `${Math.round(hy.value_bps)} bps` : "—"}${
        hy?.change_1w_bps != null ? ` (${fmtBps(hy.change_1w_bps)} on the week)` : ""
      }. Growth trend reads ${r.growth_trend != null ? fmtSigned(r.growth_trend) : "—"} and inflation trend ${
        r.inflation_trend != null ? fmtSigned(r.inflation_trend) : "—"
      }; both are 3-month slopes of z-scored macro data.`,
      `What would change the read: a CPI print above ${thr("cpi_hot")}% YoY trips Inflation pressure, a 2s10s close below ${thr("yield_curve_inversion")}% trips Curve inversion risk, and a VIX close above ${thr("vix_spike")} trips the vol signal. ` +
        (triggered.length > 0
          ? `${triggered.length} of the ${reporting.length} monitored signals ${triggered.length === 1 ? "is" : "are"} currently triggered.`
          : `None of the ${reporting.length} monitored signals is triggered${
              watching.length > 0 ? `; ${watching.length} sit${watching.length === 1 ? "s" : ""} in Watch` : ""
            }.`),
    ];

    const changed =
      streak == null
        ? "—"
        : streak.prev && streak.since
          ? `Switched from ${streak.prev} in ${fmtMonYr(streak.since)} · ${streak.n} month${streak.n === 1 ? "" : "s"} in`
          : `${streak.n} month${streak.n === 1 ? "" : "s"} unchanged`;

    const watchText = watching.length
      ? watching
          .map((s) => `${SIGNALS_META[s.signal_name]?.display ?? s.signal_name} (${Math.round(s.distance_pct ?? 0)}% of trigger)`)
          .join(" · ")
      : triggered.length
        ? `${triggered.length} triggered`
        : "All five signals clear";

    const invalidates = `CPI > ${thr("cpi_hot")}% YoY · 2s10s < ${thr("yield_curve_inversion")}% · VIX > ${thr("vix_spike", 0)}`;

    rows.push(
      {
        id: "model-regime",
        label: "Model regime",
        value: (
          <Link to="/app/regime-lab" style={kvLinkStyle}>
            {r.label}
          </Link>
        ),
      },
      {
        id: "model-probability",
        label: "Model probability",
        value: <span title="Dominant stored probability of the four-way classifier">{fmtWholePct(lead[1])}</span>,
      },
      {
        id: "odds",
        label: "Odds",
        value: (
          <div style={{ minWidth: 0, paddingTop: 2 }}>
            <ProbabilityBar probs={probs} height={6} />
          </div>
        ),
      },
      { id: "model-confidence", label: "Model confidence", value: `${conviction} (${fmtWholePct(r.confidence)})` },
      divergenceRow,
      transitionRow,
      takeawayRow,
      { id: "what-changed", label: "What changed", value: changed, prose: true },
      {
        id: "watch",
        label: triggered.length ? "Triggered" : "Watch",
        value: watchText,
        prose: true,
        tone: triggered.length ? "var(--neg-text)" : watching.length ? "var(--amber)" : "var(--pos)",
      },
      { id: "invalidates", label: "Invalidates", value: invalidates },
      ...(recession.data?.recession_prob != null
        ? [
            {
              id: "nber",
              label: "NBER recession model",
              value: `${recession.data.recession_prob.toFixed(1)}% over 12m · ${recession.data.recession_label} (a separate model from the ${fmtWholePct(probs.recession)} Recession Risk regime odds)`,
              prose: true,
              tone:
                recession.data.recession_label === "High Risk"
                  ? "var(--neg-text)"
                  : recession.data.recession_label === "Elevated"
                    ? "var(--warn-hot)"
                    : "var(--pos)",
            },
          ]
        : recession.isLoading
          ? [{ id: "nber", label: "NBER recession model", value: <StateNote loading /> }]
          : []),
    );

    const f = freshness.data;
    // D1: the hero's right column is the 24-month stacked odds chart (moved
    // out of the Macro charts accordion); the gradient block holds the slot
    // until the stored history arrives.
    const oddsChart = history.data && history.data.length >= 2 ? <RegimeOddsChart rows={history.data} /> : undefined;
    hero = (
      <TabHero
        id="regime-hero"
        eyebrow="Current regime"
        live={bannerLive}
        headline={copy.headline}
        pill={<span title={`Classifier odds: ${copy.headline} ${fmtWholePct(lead[1])} of the four-regime split`}>{copy.pill}</span>}
        pillTone={copy.pillTone}
        glow={copy.glow}
        subhead={copy.subhead}
        lede={renderLede(copy.ledeClause ? `${copy.lede} ${copy.ledeClause}` : copy.lede)}
        actions={HERO_ACTIONS}
        footnote={copy.footnote}
        // On a phone the header's freshness words sit one screen above; the
        // hero does not repeat them (review P3-13).
        freshness={
          isMobile
            ? undefined
            : [
                { noun: "Macro", info: assessFreshness(r.date, "monthly") },
                { noun: "Signals", info: assessFreshness(signals.data?.date ?? f?.signals_date, "monthly") },
                { noun: "Market", info: assessFreshness(f?.market_daily_date, "daily") },
              ]
        }
        chart={oddsChart}
        placeholder
      />
    );
  } else {
    rows.push(
      { id: "model-regime", label: "Model regime", value: regimeNote },
      { id: "model-probability", label: "Model probability", value: regimeNote },
      { id: "odds", label: "Odds", value: regimeNote },
      { id: "model-confidence", label: "Model confidence", value: regimeNote },
      divergenceRow,
      transitionRow,
      takeawayRow,
      { id: "what-changed", label: "What changed", value: regimeNote },
      { id: "watch", label: "Watch", value: regimeNote },
      { id: "invalidates", label: "Invalidates", value: regimeNote },
      { id: "nber", label: "NBER recession model", value: regimeNote },
    );
    // Only when there is nothing to read: with snapshot data on screen the
    // shell's status word already says the service is asleep (review P1-2).
    hero =
      regime.isError && !regime.data ? (
        <TabHero
          id="regime-hero"
          eyebrow="Current regime"
          headline={<span style={stateHeadline}>Regime unavailable: the data service did not answer. The read resumes when it is back.</span>}
          pill="Unavailable"
          pillTone="gray"
          glow={HERO_GLOW.gray}
          placeholder
        />
      ) : (
        <TabHero id="regime-hero" eyebrow="Current regime" headline={<span style={stateHeadline}>Reading the latest regime…</span>} placeholder />
      );
  }

  const strip = alertStrip(alertSummary(alerts), openAlerts);

  return (
    <div className="mrr-dash">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard id="regime-summary" as="h2" title="Model & market summary" rows={rows} status={strip}>
          <Disclosure variant="quiet" title="About model vs market">
            <Caption style={{ marginTop: 0 }}>
              <Jargon term="divergence">Divergence check</Jargon>: whether the recession model and market risk pricing tell one
              story
              {recession.data?.divergence_score != null
                ? `. Score ${fmtSigned(recession.data.divergence_score, 0)} on a −100 to +100 scale; beyond ±20 the divergence is material and requires judgment.`
                : "."}
            </Caption>
          </Disclosure>
        </SummaryCard>
      </div>

      {/* ── Monitored signals ───────────────────────────────────────── */}
      <Card as="section" id="signals" variant="panel" style={{ minWidth: 0 }}>
        <SectionHeader
          layout="panel"
          title="Monitored signals"
          description="Bars show distance to trigger · Clear <50% · Watch ≥50% · Triggered = threshold crossed."
          right={
            signals.data
              ? `${signals.data.signals.length} signals · latest ${fmtDate(signals.data.date)}`
              : signals.isError
                ? "signal feed unavailable"
                : "loading"
          }
          actions={
            <Link className="mrr-link" to="/app/methodology#signals">
              View all signals →
            </Link>
          }
        />
        {/* Columns from `.mrr-dash-signals` (app.css, Iteration 1): five
            across when the dashboard is wide enough for ~250px cards, else
            three over two, else one per row, read from the dashboard's own
            width (a container query) so the collapsed sidebar counts. Cards
            of one row wrap their mono lines alike, so no tail opens (G2). */}
        <div className="mrr-dash-signals">
          {SIGNAL_ORDER.map((name) => {
            const meta = SIGNALS_META[name];
            const row = bySignal.get(name);
            if (row) {
              // Carried-forward prints state their true month (monthly signals
              // between releases) instead of dropping out — the latest-available-
              // with-its-date rule, now server-enforced.
              const carried = row.date !== signals.data?.date;
              const printLine = `Signal print ${fmtMonYr(row.date)}${carried ? " · next monthly print pending" : ""}`;
              return (
                <SignalCard
                  key={name}
                  heading="h3"
                  name={meta.display}
                  value={meta.format(row.value)}
                  fillPct={row.distance_pct ?? 0}
                  status={row.status ?? undefined}
                  lastTriggered={lastAlertBySignal.get(name) ? fmtDate(lastAlertBySignal.get(name) as string) : "none on file"}
                  lines={[meta.trigger(row.threshold), printLine]}
                />
              );
            }
            // Three states without a row (Phase 10, C #1 and #2): the feed still
            // reading; the feed down with nothing on hand (U6-014); or a served
            // response that carries no print for this signal, which names the
            // cadence in words (no next-run time is served, F2).
            const feedDown = signals.isError && !signals.data;
            return (
              <SignalCard
                key={name}
                heading="h3"
                name={meta.display}
                value={
                  signals.isLoading ? (
                    <StateNote loading>Reading the signal print…</StateNote>
                  ) : feedDown ? (
                    <span style={missingPrintStyle}>Signal feed unavailable: the data service did not answer.</span>
                  ) : (
                    <span style={missingPrintStyle}>No print on file yet for this signal; the daily refresh writes signal prints at 11:17 UTC.</span>
                  )
                }
                showGauge={false}
                lastTriggered={null}
                badge="Unavailable"
                tone="reference"
                lines={[meta.trigger(null), feedDown ? "Signal print · unavailable" : "Signal print · none on file"]}
              />
            );
          })}
        </div>
      </Card>

      {/* ── Key levels (slim row) ───────────────────────────────────── */}
      <KeyLevels regime={regime} recession={recession} credit={credit} fedFunds={fedFunds} vix={vix} />

      {/* ── Bottom row: glance | 10Y | calendar ─────────────────────── */}
      <div className="mrr-dash-bottom">
        <MarketsGlance onTabChange={setGlanceTab} />
        <TenYearCard credit={credit} />
        <MacroCalendarCard />
      </div>

      {/* ── Macro charts, collapsed ─────────────────────────────────── */}
      <MacroCharts recession={recession} credit={credit} onOpenChange={setChartOpenId} />

      {/* ── Composed read-through and method, one click down ─────────── */}
      {readThrough.length ? (
        <Card as="section" id="read-through" variant="panel" style={{ minWidth: 0 }}>
          <SectionHeader layout="panel" title="How this read is composed" right="stored data · no model call" />
          <Disclosure title="Current read-through" right="composed from stored data">
            <Card accentBar tone="accent">
              {readThrough.map((p, i) => (
                <p
                  key={i}
                  className="mrr-prose"
                  style={{
                    fontSize: "var(--fs-body)",
                    color: "var(--text-2)",
                    lineHeight: "var(--lh-body)",
                    margin: i ? "10px 0 0" : 0,
                    textWrap: "pretty",
                  }}
                >
                  {p}
                </p>
              ))}
            </Card>
          </Disclosure>
          <Disclosure title="Method and provenance" right="reference" style={{ marginTop: 6 }}>
            <Card>
              <p className="mrr-prose" style={{ ...errStyle, fontSize: "var(--fs-body-s)", lineHeight: 1.6, margin: 0 }}>
                The regime is a 4-way softmax classifier over z-scored growth (industrial production) and inflation (CPI)
                trends, run monthly on FRED data; the four odds always sum to 100% and the header badge shows the dominant
                stored probability. The five monitored signals compare the latest print against fixed thresholds and are
                scored server-side; the recession model is a logistic regression trained on NBER dates. Nothing on this
                screen is re-derived in the browser.{" "}
                <Link to="/app/methodology" style={{ color: "var(--link)" }}>
                  Full methodology →
                </Link>
              </p>
            </Card>
          </Disclosure>
        </Card>
      ) : null}

      <DisclosureLine>
        Regime odds, signals and the recession model read from the stored monthly classifier and its NBER-trained logistic
        model · market tiles from stored daily closes and the EODHD relay (15-minute delayed off-hours) · calendar
        hand-maintained · nothing on this screen is re-derived in the browser.
      </DisclosureLine>
    </div>
  );
}
