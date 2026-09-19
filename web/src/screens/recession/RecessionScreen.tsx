/**
 * Recession, rebuilt on TabHero + SummaryCard (redesign Phase 7,
 * docs/redesign-v2/checklists/07-recession.md B.0).
 *
 * Order of <main> children, all inside `.mrr-rec`: the hero row (TabHero
 * `#recession-hero`, whose h1 is the served 12-month probability with the
 * served `recession_label` as the pill, the three-month change as the
 * subhead, the semicircle gauge over the 24M / Full history probability line
 * as the signature visual, beside SummaryCard `#recession-summary` with the
 * consecutive-rises strip linking to `#model`) → Model inputs (`#model`) →
 * Curve monitor (`#curve`) → the bottom row (Sensitivity `#sensitivity`,
 * whose five sliders render on load, Iteration 1 X3 | Model transparency
 * `#transparency`) → the mono disclosure line.
 *
 * One data source: /api/recession/probability (src/analytics/recession.py:
 * the probability, the band word, the coefficients and the divergence are all
 * classified server-side), read once here and passed to the four panels as
 * `{ m, status }`; the Regime context row adds /api/regime/latest (the same
 * query key the shell's transitional pill uses) and SensitivityPanel owns the
 * POST /api/recession/scenario chain. Nothing is re-derived in the browser:
 * the only arithmetic is the three-month delta in points, the count of
 * consecutive rises and the series slices, all in recession-copy.ts. The
 * hero never prints the classifier's regime or its odds; the classifier
 * appears only in the "Regime context" row, beside the word "classifier".
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useRecessionProbability, useRegimeLatest } from "../../api/queries";
import type { RecessionMetrics, RecessionScenarioRequest, Regime } from "../../api/types";
import { fmtBps, fmtMonYr, fmtSigned, fmtWholePct, ordinal } from "../../lib/format";
import { DASH } from "../dashboard/hero-copy";
import { assessFreshness } from "../shared/freshness";
import { HeroChartFrame } from "../shared/HeroChart";
import { StateNote, useHashScroll } from "../shared/screen-ui";
import { DisclosureLine } from "../shared/Disclosure";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import SummaryCard, { kvLinkStyle, type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import { RECESSION_GLOW, deltaPoints, featureLabel, headlineIndex, heroCopy, labelTone, stripSummary, toneColor } from "./recession-copy";
import type { CurveWindow, RecessionPanelProps } from "./panel-props";
import ProbabilityGauge, { GAUGE_ASPECT } from "./ProbabilityGauge";
import ProbabilityHistory from "./ProbabilityHistory";
import ModelInputs from "./ModelInputs";
import CurveMonitor from "./CurveMonitor";
import SensitivityPanel from "./SensitivityPanel";
import TransparencyPanel from "./TransparencyPanel";

/* ── small shared bits ─────────────────────────────────────────────────── */

type RecessionStatus = RecessionPanelProps["status"];

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

const HERO_ACTIONS: TabHeroAction[] = [
  { label: "Stress the inputs", to: "/app/recession#sensitivity", primary: true },
  { label: "Read the model card", to: "/app/recession#transparency" },
];

const STRIP_TARGET = "/app/recession#model";
const STRIP_SUFFIX = "Opens the model inputs";

const PILL_TITLE = "The recession model's own band: Low Risk under 20%, Elevated 20 to 40%, High Risk 40% and above";
const REGIME_ROW_TITLE = "The four-way classifier's leading regime and its odds; a different model from the recession probability above";
const THRESHOLDS = "2s10s < 0 · HY > 400 bps · unemployment +0.3 pp in 3m";
const THRESHOLDS_TITLE = "Reference levels used in the desk read. Not model thresholds and not alert rules; none are served by the API.";

/** The gauge's width cap in the hero slot (Iteration 1 G3): wide enough to
 * fill 85% of the widest slot (866 px, the stacked hero at 1024 with the
 * sidebar collapsed); the drawing's height follows the 360 × 210 aspect,
 * 432 px at the cap. */
const GAUGE_MAX_W = 740;
/** The gauge's share of the slot width: clear of the 85% floor, with room
 * either side of the tick labels. */
const GAUGE_SHARE = 0.88;
const gaugeWidth = (w: number): number => Math.floor(Math.min(w * GAUGE_SHARE, GAUGE_MAX_W));
const gaugeHeight = (w: number): number => Math.round(gaugeWidth(w) * GAUGE_ASPECT);

const LOADING_HEADLINE = "Training the recession model on stored NBER history…";
const ERROR_HEADLINE = "Recession model unavailable: its endpoint trains in-process and may need a warm start.";
const LOADING_ROW = "Training the recession model; the first call takes about a second.";

/** The classifier's stored odds for its own label (types.ts Regime). */
const REGIME_PROB: Record<string, keyof Regime> = {
  Goldilocks: "prob_goldilocks",
  Overheating: "prob_overheating",
  Stagflation: "prob_stagflation",
  "Recession Risk": "prob_recession",
};
function labelOdds(r: Regime): number | null {
  const key = REGIME_PROB[r.label];
  const v = key ? r[key] : null;
  return typeof v === "number" ? v : null;
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function RecessionScreen() {
  const q = useRecessionProbability();
  const regime = useRegimeLatest();
  const m: RecessionMetrics | null = q.data ?? null;
  // The snapshot rule (03 B.1): no error copy while cached data is on screen.
  const status: RecessionStatus = m ? "ready" : q.isError ? "error" : "loading";

  // Sensitivity state lives here (B.0): the analyst's inputs (null = seeded
  // from the current readings). The sliders render on load (X3), so
  // /app/recession#sensitivity needs no open flag to land.
  const [inputs, setInputs] = useState<RecessionScenarioRequest | null>(null);
  const [curveRange, setCurveRange] = useState<CurveWindow>("30y");
  // One identity per settled state, so the hash lands after the data and the
  // local state settles without re-scrolling on every slider step.
  const hashReady = useMemo(() => [m, curveRange] as const, [m, curveRange]);
  useHashScroll(hashReady);

  const fresh = assessFreshness(m?.data_as_of, "monthly");
  const copy = m ? heroCopy(m) : null;
  const prob = m?.recession_prob ?? 0;

  /* ── hero (B.1) ──────────────────────────────────────────────────────── */
  const heroShared = {
    id: "recession-hero",
    eyebrow: "Recession model",
    live: m != null && fresh.state === "current",
    actions: HERO_ACTIONS,
    // No absence before an answer: the chip waits for the payload (or its
    // error) instead of printing "Unavailable" while the request is pending.
    freshness: m || q.isError ? [{ noun: "Model inputs", info: fresh }] : undefined,
  };
  let hero: ReactNode;
  if (m && copy) {
    hero = (
      <TabHero
        {...heroShared}
        headline={copy.headline}
        pill={<span title={PILL_TITLE}>{copy.pill}</span>}
        pillTone={copy.pillTone}
        glow={copy.glow}
        subhead={copy.subhead}
        lede={copy.lede}
        footnote={copy.footnote}
        note={copy.note}
        chart={
          <>
            {/* Iteration 1 G3: the gauge scales with the chart slot (to the
                slot's full width, up to GAUGE_MAX_W), so it fills the column
                instead of sitting at 360 px in a 500 to 870 px slot. */}
            <HeroChartFrame fallback={{ w: 410, h: 210 }} minHeight={gaugeHeight} maxHeight={gaugeHeight}>
              {(box) => (
                <ProbabilityGauge
                  prob={prob}
                  label={m.recession_label}
                  tone={labelTone(m.recession_label)}
                  maxWidth={Math.min(gaugeWidth(box.w), Math.floor(box.h / GAUGE_ASPECT))}
                />
              )}
            </HeroChartFrame>
            <ProbabilityHistory m={m} />
          </>
        }
      />
    );
  } else if (q.isError) {
    hero = <TabHero {...heroShared} headline={<span style={stateHeadline}>{ERROR_HEADLINE}</span>} pill="Unavailable" pillTone="gray" glow={RECESSION_GLOW.gray} placeholder />;
  } else {
    hero = <TabHero {...heroShared} headline={<span style={stateHeadline}>{LOADING_HEADLINE}</span>} glow={RECESSION_GLOW.gray} placeholder />;
  }

  /* ── summary rows (B.2, C.2 order) ───────────────────────────────────── */
  const note = status === "error" ? <StateNote error /> : <StateNote loading>{LOADING_ROW}</StateNote>;
  const val = (f: (x: RecessionMetrics) => ReactNode): ReactNode => (m ? f(m) : note);
  const series = m?.recession_prob_series ?? [];
  const i = m ? headlineIndex(series, m.recession_prob) : -1;
  const change = m && i >= 0 ? deltaPoints(series, i, 3) : null;
  const coefs = m ? Object.entries(m.feature_coefficients ?? {}).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])) : [];
  const strongest = coefs[0];
  const tone = m ? labelTone(m.recession_label) : "reference";

  const rows: SummaryRow[] = [
    {
      id: "probability",
      label: "12-month probability",
      value: val((x) => `${prob.toFixed(1)}% · ${x.recession_label}`),
      tone: toneColor(tone),
    },
    {
      id: "prior",
      label: "3 months ago",
      value: val(() =>
        change ? (
          <>
            {change.prior.value.toFixed(1)}%{" "}
            <span style={{ color: change.delta > 0 ? "var(--amber)" : "var(--text-2)" }}>{fmtSigned(change.delta, 1)} pts</span>
            {" · "}
            {fmtMonYr(change.prior.date)}
          </>
        ) : (
          "Fewer than four stored months"
        ),
      ),
    },
    {
      id: "strongest",
      label: "Strongest input",
      value: val(() => (strongest ? `${featureLabel(strongest[0])} · ${fmtSigned(strongest[1], 2)} log-odds per σ` : DASH)),
    },
    ...(!m || m.yield_curve_spread != null
      ? [
          {
            id: "curve",
            label: "Curve 2s10s",
            value: val((x) => {
              const spread = x.yield_curve_spread as number;
              const parts = [fmtBps(spread), x.is_inverted ? "inverted" : "upward"];
              if (x.yield_curve_pct_rank != null) parts.push(`${ordinal(x.yield_curve_pct_rank)} pct of 30y`);
              if (x.is_inverted && x.inversion_duration_months != null) parts.push(`${x.inversion_duration_months} months`);
              return parts.join(" · ");
            }),
            tone: m?.is_inverted ? "var(--neg)" : undefined,
          } satisfies SummaryRow,
        ]
      : []),
    {
      id: "divergence",
      label: "Model vs market",
      value: val((x) => `${x.divergence_label}${x.divergence_score != null ? ` · ${fmtSigned(x.divergence_score, 0)} on ±100` : ""}`),
      tone: m?.divergence_score != null && Math.abs(m.divergence_score) > 20 ? "var(--amber)" : undefined,
    },
    {
      id: "regime",
      label: "Regime context",
      value: regime.data ? (
        <span title={REGIME_ROW_TITLE}>
          <Link to="/app/regime-lab" style={kvLinkStyle}>
            {regime.data.label}
          </Link>{" "}
          {labelOdds(regime.data) != null ? fmtWholePct(labelOdds(regime.data) as number) : DASH} · classifier
        </span>
      ) : regime.isError ? (
        <StateNote error />
      ) : (
        <StateNote loading />
      ),
    },
    // X2: two served model facts (the model card's training count and input
    // stamp) fill the card beside the taller desk hero instead of blank.
    {
      id: "training",
      label: "Training sample",
      value: val((x) => `${x.n_training_samples} months · NBER-dated`),
    },
    {
      id: "inputs-through",
      label: "Inputs through",
      value: val((x) => fmtMonYr(x.data_as_of)),
    },
    {
      id: "thresholds",
      label: "Reference thresholds",
      value: val(() => (
        <span title={THRESHOLDS_TITLE}>
          {THRESHOLDS}
          <span style={{ color: "var(--text-3)" }}> · desk reference</span>
        </span>
      )),
    },
  ];

  /* ── status strip: consecutive rises, linking to the model inputs ────── */
  const words = stripSummary(m ?? undefined, { isLoading: status === "loading", isError: status === "error" });
  const strip: StatusStripProps = {
    ...words,
    to: STRIP_TARGET,
    ariaLabel: `${[words.title, words.detail].filter((s) => s && s !== STRIP_SUFFIX).join(". ")}. ${STRIP_SUFFIX}.`,
  };

  return (
    <div className="mrr-rec">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard id="recession-summary" as="h2" title="Model summary" rows={rows} status={strip} />
      </div>

      {/* ── Model inputs, full width ─────────────────────────────────── */}
      <ModelInputs m={m} status={status} />

      {/* ── Curve monitor, full width ────────────────────────────────── */}
      <CurveMonitor m={m} status={status} range={curveRange} onRangeChange={setCurveRange} />

      {/* ── Bottom row: sensitivity | model transparency ─────────────── */}
      <div className="mrr-rec-bottom">
        <SensitivityPanel m={m} status={status} inputs={inputs} onInputsChange={setInputs} />
        <TransparencyPanel m={m} status={status} />
      </div>

      {/* ── disclosure line ──────────────────────────────────────────── */}
      <DisclosureLine>
        A statistical estimate, not a forecast of any specific date · model trained in-process from stored FRED series each session (no saved
        artifact) · inputs are lagged three months before scoring and sensitivity rescoring uses the same fitted coefficients · the probability
        is the recession model&apos;s own, a different number from the regime classifier&apos;s Recession Risk odds in the header.
      </DisclosureLine>
    </div>
  );
}
