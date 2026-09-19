/**
 * Regime Lab, rebuilt on TabHero + SummaryCard (redesign Phase 4,
 * docs/redesign-v2/checklists/04-regime-lab.md B.0).
 *
 * Order of <main> children, all inside `.mrr-lab`: the hero row (TabHero
 * `#takeaway`, whose h1 is the served cycle status word, beside SummaryCard
 * `#regime-outlook` with the Overheating-odds status strip) → SubTabs
 * (Overview: `#cycle`, `#transitions`, `#regime-history-teaser`; Playbook;
 * Scenarios; History & analogues: `#analogues`, `#regime-history`; Empirical
 * evidence: `#backtests`) → the mono disclosure line.
 *
 * Everything quantitative arrives from /api/regime/* and /api/backtests; the
 * client renders and captions, and completes only the arithmetic the
 * checklist names (spell start, exit counts and the quadrant trail over the
 * stored monthly rows, the 6-month stay residual). Static reference content
 * (playbooks, analogue corpus, scenario definitions) is labeled as such.
 * Hooks are called once here and passed down; the sub-tab files call their
 * own (React Query dedupes by key).
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ProbabilityBar } from "../../components";
import SubTabs from "../shared/SubTabs";
import { REGIME_INPUT_IDS, referenceLabel } from "../shared/fresh-state";
import { useFreshReport } from "../shared/useFreshReport";
import { useRegimeDuration, useRegimeHistory, useRegimeLatest, useRecessionProbability, useTakeaway, useTransitions } from "../../api/queries";
import { fmtMonYr, fmtProb, fmtSigned, fmtWholePct, tidyProse } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, MISSING, MISSING_ROW, StateNote, missingNote, useHashScroll, useSnapshotMode, type MissingSource } from "../shared/screen-ui";
import Disclosure, { DisclosureLine } from "../shared/Disclosure";
import TabHero from "../shared/TabHero";
import SummaryCard, { kvLinkStyle, type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import { parseStrong, takeMarkedSentences } from "../shared/narrative";
import { Metric, SRC, Stamp, servedOdds } from "../shared/Stamp";
import { DASH, convictionWord } from "../dashboard/hero-copy";
import { CYCLE_GLOW, cycleHero, monthsText, stripSummary } from "./hero-copy";
import { stay6m, trailPoints, yearsOfHistory } from "./regime-history";
import QuadrantChart from "./QuadrantChart";
import OverviewTab from "./OverviewTab";
import PlaybookTab from "./PlaybookTab";
import ScenariosTab from "./ScenariosTab";
import HistoryTab from "./HistoryTab";
import EvidenceTab from "./EvidenceTab";

/* ── small shared bits ─────────────────────────────────────────────────── */

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

const HERO_ACTIONS = [
  { label: "Open the playbook", to: "/app/regime-lab#playbook", primary: true },
  { label: "Run a scenario", to: "/app/regime-lab#scenarios" },
];

const STRIP_TARGET = "/app/regime-lab#transitions";

/* ── Screen ──────────────────────────────────────────────────────────────── */

const LAB_TABS = [
  { id: "overview", label: "Overview", hint: "live model" },
  { id: "playbook", label: "Playbook", hint: "reference" },
  { id: "scenarios", label: "Scenarios", hint: "stress rule" },
  { id: "history", label: "History & analogues", hint: "stored + reference" },
  { id: "evidence", label: "Empirical evidence", hint: "backtests" },
] as const;
type LabTab = (typeof LAB_TABS)[number]["id"];

/** Section anchors (palette jumps, cross-links) map onto the local view that
 * renders them, so a deep link lands on the right panel and then scrolls. */
const SECTION_TO_TAB: Record<string, LabTab> = {
  takeaway: "overview",
  cycle: "overview",
  transitions: "overview",
  playbook: "playbook",
  scenarios: "scenarios",
  analogues: "history",
  "regime-history": "history",
  backtests: "evidence",
};
const TAB_ANCHOR: Record<LabTab, string> = {
  overview: "takeaway",
  playbook: "playbook",
  scenarios: "scenarios",
  history: "analogues",
  evidence: "backtests",
};

export default function RegimeLabScreen() {
  const regime = useRegimeLatest();
  const regimeHistory = useRegimeHistory();
  const takeaway = useTakeaway();
  const duration = useRegimeDuration();
  const snapshot = useSnapshotMode();
  const transitions = useTransitions();
  const recession = useRecessionProbability();
  const location = useLocation();
  const [active, setActive] = useState<LabTab>(() => SECTION_TO_TAB[location.hash.replace("#", "")] ?? "overview");
  useEffect(() => {
    // A bare route (initial load, or browser Back from a hash) means the Overview;
    // an unknown hash keeps the current view.
    const key = location.hash.replace("#", "");
    const t = key ? SECTION_TO_TAB[key] : "overview";
    if (t) setActive(t);
    // location.key: the hero buttons and the status strip are same-route hash
    // links, and the SubTabs replaceState leaves the router's hash behind, so
    // a second click on the same target must still select its sub-tab.
  }, [location.hash, location.key]);
  const releaseHashScroll = useHashScroll(active === "overview" ? regime.data : active);

  const r = regime.data;
  const t = takeaway.data;
  const tr = transitions.data;
  const d = duration.data;
  const rec = recession.data;
  const rows = regimeHistory.data;

  /* ── hero ────────────────────────────────────────────────────────────── */
  const report = useFreshReport();
  const regimeFresh = report.group(report.f?.regime?.inputs?.length ? report.f.regime.inputs.map((i) => i.series) : REGIME_INPUT_IDS);
  const copy = cycleHero(d, r);
  const years = yearsOfHistory(rows);
  const footnote: ReactNode[] = [];
  // A3 (Iteration 1 step 6): the month without a browser-counted age; the
  // Regime chip carries the server's state for the classifier's inputs.
  if (r) footnote.push(`Classifier month ${fmtMonYr(r.date)}`);
  if (years != null) footnote.push(`${years} year${years === 1 ? "" : "s"} of monthly regime history`);

  // G4 (Iteration 1 step 5): the served narrative is model-composed, so the
  // visible lede is its first three sentences by construction and the rest,
  // verbatim, sits behind the hero's Details.
  const narrative = t ? takeMarkedSentences(tidyProse(t.narrative), 3) : null;
  const lede: ReactNode = narrative ? (
    parseStrong(narrative.shown)
  ) : takeaway.isError ? (
    <StateNote error missing={MISSING.takeaway} />
  ) : (
    <StateNote loading>Assembling the market takeaway; the cold call trains the recession model once.</StateNote>
  );

  const heroShared = {
    id: "takeaway",
    eyebrow: "Cycle position",
    // In cycle is the server's word: every regime input reads "close" in
    // /api/freshness series[]; a stale or unknown input never pulses.
    live: r != null && !report.seeded && (regimeFresh.tone === "neutral" || regimeFresh.tone === "live"),
    lede,
    ledeMore: narrative?.rest ? parseStrong(narrative.rest) : undefined,
    actions: HERO_ACTIONS,
    footnote,
    // No absence before an answer: the Regime chip waits for the stored row
    // (or its error) instead of printing "Unavailable" while the request is pending.
    freshness: [
      ...(r?.date || regime.isError ? [{ noun: "Regime", label: regimeFresh }] : []),
      { noun: "Playbook", label: referenceLabel("The playbooks are reference content with no publication cadence.") },
    ],
    // No history yet: the gradient placeholder; with history (even empty) the
    // quadrant renders its own fallbacks.
    chart: rows ? <QuadrantChart points={trailPoints(rows)} current={r} /> : undefined,
    placeholder: true,
    // A1: the cycle read is the classifier's stored history, dated by the
    // regime month its payload serves.
    stamp: <Stamp source={SRC.classifierHistory} asOf={r ? fmtMonYr(r.date) : null} />,
  };
  const hero = copy ? (
    <TabHero {...heroShared} headline={copy.headline} pill={copy.pill} pillTone={copy.pillTone} glow={copy.glow} subhead={copy.subhead} />
  ) : duration.isError && !d ? (
    <TabHero
      {...heroShared}
      headline={<span style={stateHeadline}>{missingNote(MISSING.cycle, snapshot)}</span>}
      pill="Unavailable"
      pillTone="gray"
      glow={CYCLE_GLOW.gray}
    />
  ) : (
    <TabHero {...heroShared} headline={<span style={stateHeadline}>Reading the cycle position…</span>} />
  );

  /* ── summary rows ────────────────────────────────────────────────────── */
  const regimeNote = <StateNote loading={regime.isLoading} error={regime.isError && !r} />;
  // CP4: a failed row names its source (the first row of each) or says so briefly.
  const pending = (q: { isError: boolean }, missing: MissingSource | typeof MISSING_ROW = MISSING_ROW) =>
    q.isError ? <StateNote error missing={missing} /> : <StateNote loading />;
  const months = d ? monthsText(d.months_in_regime) : "0";
  const six = tr?.transitions_6m[0];
  const summaryRows: SummaryRow[] = [
    {
      id: "current-regime",
      label: "Current regime",
      value: r ? (
        <Link to="/app/regime-lab#playbook" style={kvLinkStyle}>
          <Metric id="regime" value={r.label}>
            {r.label}
          </Metric>
        </Link>
      ) : (
        regimeNote
      ),
    },
    {
      id: "classifier-odds",
      label: "Classifier odds",
      value: r ? (
        <div style={{ minWidth: 0, paddingTop: 5 }}>
          <ProbabilityBar
            probs={{
              goldilocks: r.prob_goldilocks ?? 0,
              overheating: r.prob_overheating ?? 0,
              stagflation: r.prob_stagflation ?? 0,
              recession: r.prob_recession ?? 0,
            }}
            metrics={servedOdds(r)}
            height={8}
          />
        </div>
      ) : (
        regimeNote
      ),
    },
    { id: "model-confidence", label: "Model confidence", value: r ? `${convictionWord(r.confidence)} (${fmtWholePct(r.confidence)})` : regimeNote },
    {
      id: "next-3m",
      label: "Next 3 months",
      value: tr
        ? `Stays ${tr.current_regime} ${fmtProb(tr.stay_probability_3m, "percent")} · highest-risk path → ${tr.highest_risk_transition} ${fmtProb(tr.highest_risk_prob, "percent")}`
        : pending(transitions, MISSING.transitions),
    },
    {
      id: "next-6m",
      label: "Next 6 months",
      value: tr
        ? `Stays ${tr.current_regime} ${fmtProb(stay6m(tr), "percent")}${six ? ` · highest-risk path → ${six.to} ${fmtProb(six.probability, "percent")}` : ""}`
        : pending(transitions),
    },
    {
      id: "spell-length",
      label: "Spell length",
      value: d ? `${months} month${months === "1" ? "" : "s"} in · ${d.status} · avg spell ${d.historical_avg_months.toFixed(1)}mo` : pending(duration, MISSING.cycle),
    },
    {
      id: "market-read",
      label: "Market read",
      value: t ? t.primary_signal : pending(takeaway, MISSING.takeaway),
      tone: t ? (t.primary_signal === "Risk-On" ? "var(--pos)" : t.primary_signal === "Risk-Off" ? "var(--neg)" : "var(--amber)") : undefined,
    },
    {
      id: "takeaway-conviction",
      label: "Takeaway conviction",
      value: t ? t.conviction : pending(takeaway),
      tone: t ? (t.conviction === "High" ? "var(--mint)" : t.conviction === "Low" ? "var(--amber)" : "var(--link)") : undefined,
    },
    {
      id: "takeaway-divergences",
      label: "Takeaway divergences",
      value: t
        ? t.divergences.length
          ? t.divergences.map(tidyProse).join(" · ")
          : "None flagged by the takeaway; the model-vs-market score above is the quantitative check"
        : pending(takeaway),
      tone: t?.divergences.length ? "var(--amber)" : undefined,
    },
    {
      id: "model-vs-market",
      label: "Model vs market",
      value: rec ? (
        `${rec.divergence_label}${rec.divergence_score != null ? ` · ${fmtSigned(rec.divergence_score, 0)} on ±100` : ""}`
      ) : recession.isError ? (
        <StateNote error missing={MISSING.recession} />
      ) : (
        <StateNote loading>Training the recession model; the first call takes about a second.</StateNote>
      ),
      tone: rec?.divergence_score != null && Math.abs(rec.divergence_score) > 20 ? "var(--amber)" : undefined,
    },
  ];

  /* ── status strip ────────────────────────────────────────────────────── */
  const stripWords = stripSummary(rows, rows ? "ready" : regimeHistory.isError ? "error" : regimeHistory.isLoading ? "loading" : "ready");
  const strip: StatusStripProps = {
    ...stripWords,
    to: STRIP_TARGET,
    ariaLabel: `${stripWords.title}. ${stripWords.detail}`,
  };

  return (
    <div className="mrr-lab">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard
          id="regime-outlook"
          as="h2"
          title="Regime odds & outlook"
          rows={summaryRows}
          status={strip}
          stamp={
            <span style={{ display: "inline-flex", flexWrap: "wrap", columnGap: 12 }}>
              <Stamp source={SRC.classifier} asOf={r ? fmtMonYr(r.date) : null} />
              <Stamp source={SRC.recession} asOf={rec ? fmtMonYr(rec.data_as_of) : null} />
            </span>
          }
        >
          {t ? (
            <Disclosure variant="quiet" title="How this takeaway is composed" right={`stamped ${t.updated_ago}`}>
              <Caption style={{ marginTop: 0 }}>
                Composed from the stored regime odds, credit metrics and the recession model; takeaway{" "}
                <Jargon term="conviction">conviction</Jargon> weighs those three together, so it can read higher than the classifier&apos;s own
                confidence ({r ? fmtWholePct(r.confidence) : DASH}), which scores only the odds gap. Takeaway stamped {t.updated_ago}.
              </Caption>
            </Disclosure>
          ) : null}
        </SummaryCard>
      </div>

      {/* ── Sub-tabs ────────────────────────────────────────────────── */}
      <SubTabs
        tabs={[...LAB_TABS]}
        active={active}
        label="Regime Lab views"
        onChange={(id) => {
          // R2: the page stays put (SubTabs keeps the strip where it was on
          // screen and focuses the new tab); the hash still names the view,
          // and the arrival hash is not scrolled to again.
          releaseHashScroll();
          setActive(id as LabTab);
          history.replaceState(null, "", `#${TAB_ANCHOR[id as LabTab]}`);
        }}
      >
        {active === "overview" ? (
          <OverviewTab duration={duration} transitions={transitions} history={regimeHistory} regime={regime} />
        ) : active === "playbook" ? (
          <PlaybookTab />
        ) : active === "scenarios" ? (
          <ScenariosTab />
        ) : active === "history" ? (
          <HistoryTab />
        ) : (
          <EvidenceTab />
        )}
      </SubTabs>

      <DisclosureLine>
        Regime odds, durations and transitions from the stored monthly classifier · playbooks, analogue corpus and scenario definitions are
        labeled reference content · backtests computed from stored SPY history.
      </DisclosureLine>
    </div>
  );
}
