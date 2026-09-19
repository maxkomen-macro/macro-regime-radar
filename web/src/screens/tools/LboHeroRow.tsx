/**
 * LboHeroRow: the LBO calculator's hero row (redesign Phase 9, checklist 09
 * B.1 and B.2): `TabHero id="lbo-hero"` beside `SummaryCard id="lbo-summary"`
 * inside `.mrr-hero-row`. The hero is the default deal at the all-in rate, read
 * from the base run of the `LboDeal` the screen owns and never from the
 * modified run; the modified deal appears only in the hero note, the
 * "Vs base case" row and the Outputs panel below. The signature visual is the
 * equity value bridge on the base run's served fields. The strip is the FRED
 * sync of the defaults payload and opens the freshness drawer through the
 * shell seam; the Credit state row reads the served credit label. Iteration
 * 1 E1: the rate is Fed funds (a monthly average) plus the daily HY spread,
 * each printed with its own as-of word, never "live" or "current".
 */

import type { CSSProperties, ReactNode } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Link } from "react-router-dom";
import { useCreditMetrics } from "../../api/queries";
import { MISSING, MISSING_ROW, StateNote, fmtMillions, useSnapshotMode } from "../shared/screen-ui";
import SummaryCard, { kvLinkStyle, type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import { useShellActions } from "../shell/shell-actions";
import EquityBridge from "./EquityBridge";
import { STRIP_SUFFIX, componentAsOf, isStatedDefault, lboHero, lboStrip, signedPp } from "./lbo-copy";
import { bridgeSteps, type LboDeal } from "./lbo-deal";
import { Metric, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";

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
  { label: "Adjust assumptions", to: "/app/tools#lbo-assumptions", primary: true },
  { label: "View financing conditions", to: "/app/credit#financing" },
];

const CREDIT_TARGET = "/app/credit#financing";

export default function LboHeroRow({ deal }: { deal: LboDeal }) {
  const { defaults, clampedLive, inputs, baseInputs, modified, manualRate, run, base, res, baseRes } = deal;
  const runPending = run.isFetching || run.isPending || deal.settling === true;
  const credit = useCreditMetrics();
  const { openFreshness } = useShellActions();
  const snapshot = useSnapshotMode();
  // A1: the rate rows are Fed funds plus the HY spread; the hero's outputs
  // are the model run at that rate, dated by the derived rate's own state.
  const report = useFreshReport();
  const rateLabel = report.series("lbo_all_in_rate", defaults.data?.freshness);

  /* ── hero (B.1) ──────────────────────────────────────────────────────── */
  const stated = isStatedDefault(defaults.data);
  const copy = lboHero({
    defaults,
    clampedLive,
    statedDefault: stated,
    baseInputs,
    baseRes,
    res,
    modified,
    runPending,
    baseError: base.error,
    snapshot,
  });
  // Iteration 1 E1: no month-stamp freshness chip ("Current · Sep 2026") on
  // the rate. The footnote states each component's own as-of word from the
  // payload's freshness block instead (Fed funds is a monthly average, the
  // HY spread daily); a stated default says so. Hidden on a phone, as the
  // freshness chips are on every tab (checklist 03 B.1).
  const { isMobile } = useBreakpoint();
  const { fed: fedAsOf, hy: hyAsOf } = componentAsOf(defaults.data);
  const asOfItems: ReactNode[] =
    !isMobile && defaults.data
      ? stated
        ? [
            <span key="stated" data-role="rate-as-of">
              Financing rate · Stated default
            </span>,
          ]
        : [
            <span key="fed" data-role="rate-as-of" title={fedAsOf.reason || undefined}>
              Fed funds · {fedAsOf.word}
            </span>,
            <span key="hy" data-role="rate-as-of" title={hyAsOf.reason || undefined}>
              HY spread · {hyAsOf.word}
            </span>,
          ]
      : [];
  const steps = copy.state === "ready" ? bridgeSteps(baseRes, baseInputs) : null;
  const heroShared = {
    id: "lbo-hero",
    eyebrow: copy.eyebrow,
    live: false,
    lede: copy.lede,
    actions: HERO_ACTIONS,
    glow: copy.glow,
    minHeight: 300,
  };
  const footnote: ReactNode[] | undefined = copy.footnote
    ? [
        <span key="badge" data-role="irr-badge" style={{ color: copy.footnoteColor ?? undefined }}>
          {copy.footnote}
        </span>,
        ...asOfItems,
      ]
    : asOfItems.length
      ? asOfItems
      : undefined;
  const hero =
    copy.state === "ready" ? (
      <TabHero
        {...heroShared}
        headline={copy.headline}
        pill={copy.pill}
        pillTone={copy.pillTone}
        subhead={copy.subhead}
        footnote={footnote}
        note={copy.note}
        chart={steps ? <EquityBridge steps={steps} /> : undefined}
        placeholder
        stamp={<Stamp source={SRC.lbo} label={rateLabel} />}
      />
    ) : (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>{copy.headline}</span>}
        pill={copy.pill}
        pillTone={copy.pillTone}
        subhead={copy.subhead}
        footnote={footnote}
        note={copy.note}
        placeholder
      />
    );

  /* ── summary rows (B.2) ──────────────────────────────────────────────── */
  const d = defaults.data;
  // CP4: the first rate row names the missing rate and why; the rest say so briefly.
  const dLead = <StateNote loading={defaults.isLoading} error={defaults.isError} missing={MISSING.lboRate} />;
  const dNote = <StateNote loading={defaults.isLoading} error={defaults.isError} missing={MISSING_ROW} />;
  const creditLabel = credit.data?.credit_label;
  const rows: SummaryRow[] = [
    // E1: each component with its own as-of word; the stated default says so.
    { id: "fed-funds", label: "Fed funds", value: d ? (stated ? `${d.fedfunds.toFixed(2)}% · Stated default` : `${d.fedfunds.toFixed(2)}% · monthly average, ${fedAsOf.word}`) : dLead },
    {
      id: "hy-oas",
      label: "HY OAS",
      value: d ? (
        <>
          <Metric id="hy-oas" value={d.hy_oas_pct}>{`${d.hy_oas_pct.toFixed(2)}%`}</Metric>
          {stated ? " · Stated default" : ` · daily, ${hyAsOf.word}`}
        </>
      ) : (
        dNote
      ),
    },
    {
      id: "all-in",
      label: "All-in rate",
      value: d ? (
        <b style={{ fontWeight: 500 }}>
          <Metric id="lbo-all-in" value={d.lbo_all_in_rate}>{`${d.lbo_all_in_rate.toFixed(2)}%`}</Metric>
        </b>
      ) : (
        dNote
      ),
    },
    {
      id: "financing",
      label: "Financing",
      value: defaults.isLoading
        ? dNote
        : `${inputs.interest_rate.toFixed(2)}% all-in${manualRate ? " (manual)" : clampedLive != null && !stated ? " (Fed funds + HY spread)" : " (stated default)"}`,
    },
    {
      id: "structure",
      label: "Structure",
      value: `${inputs.entry_multiple.toFixed(2)}× entry · ${inputs.exit_multiple.toFixed(2)}× exit · ${inputs.leverage_ratio.toFixed(2)}× debt · ${inputs.hold_period} yr hold`,
    },
    ...(res?.viable
      ? [{ id: "equity-check", label: "Equity check", value: `${fmtMillions(res.entry_equity)} in · ${fmtMillions(res.exit_equity ?? 0)} out` }]
      : []),
    // The delta waits for the modified run to answer: while the debounce or the
    // request is in flight `res` is still the previous deal (keepPreviousData)
    // and the row would print a transient "+0.0 pp" (verify 2026-09-15).
    ...(modified && !runPending && baseRes?.viable && res?.viable && res.irr != null && baseRes.irr != null
      ? [
          {
            id: "vs-base",
            label: "Vs base case",
            value: `${signedPp(res.irr - baseRes.irr)} pp IRR against ${baseRes.irr.toFixed(1)}%`,
            tone: res.irr >= baseRes.irr ? "var(--pos)" : "var(--neg)",
          },
        ]
      : []),
    {
      id: "credit-state",
      label: "Credit state",
      value: (
        <Link to={CREDIT_TARGET} style={kvLinkStyle}>
          {creditLabel ?? "Credit"}
        </Link>
      ),
    },
  ];

  /* ── status strip: the FRED sync, opening the freshness drawer ───────── */
  const words = lboStrip(defaults, snapshot);
  const strip: StatusStripProps = {
    ...words,
    onClick: openFreshness,
    ariaHasPopup: "dialog",
    ariaLabel: `${words.title}. ${words.detail}. ${STRIP_SUFFIX}`,
  };

  return (
    // Busy while the default deal runs (the hero shows its placeholder then),
    // so assistive tech and the layout sweeps wait for the answer.
    <div className="mrr-hero-row" aria-busy={copy.state === "loading" ? true : undefined}>
      {hero}
      <SummaryCard id="lbo-summary" as="h2" title="Deal financing" rows={rows} status={strip} stamp={<Stamp source={SRC.fred} label={rateLabel} />} />
    </div>
  );
}
