/**
 * LboHeroRow: the LBO calculator's hero row (redesign Phase 9, checklist 09
 * B.1 and B.2): `TabHero id="lbo-hero"` beside `SummaryCard id="lbo-summary"`
 * inside `.mrr-hero-row`. The hero is the default deal at the live rate, read
 * from the base run of the `LboDeal` the screen owns and never from the
 * modified run; the modified deal appears only in the hero note, the
 * "Vs base case" row and the Outputs panel below. The signature visual is the
 * equity value bridge on the base run's served fields. The strip is the FRED
 * sync of the defaults payload and opens the freshness drawer through the
 * shell seam; the Credit state row reads the served credit label.
 */

import type { CSSProperties, ReactNode } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { Link } from "react-router-dom";
import { useCreditMetrics } from "../../api/queries";
import { assessFreshness } from "../shared/freshness";
import { StateNote, fmtMillions } from "../shared/screen-ui";
import SummaryCard, { kvLinkStyle, type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import { useShellActions } from "../shell/shell-actions";
import EquityBridge from "./EquityBridge";
import { STRIP_SUFFIX, lboHero, lboStrip, signedPp, stampOf } from "./lbo-copy";
import { bridgeSteps, type LboDeal } from "./lbo-deal";

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

  /* ── hero (B.1) ──────────────────────────────────────────────────────── */
  const copy = lboHero({
    defaults,
    clampedLive,
    baseInputs,
    baseRes,
    res,
    modified,
    runPending,
    baseError: base.error,
  });
  const stamp = stampOf(defaults.data);
  // No absence before an answer: the chip waits for the payload (or its error).
  // Freshness chips are hidden on a phone (the checklist 03 B.1 convention every tab follows).
  const { isMobile } = useBreakpoint();
  const freshness = !isMobile && (defaults.data || defaults.isError) ? [{ noun: "Financing rate", info: assessFreshness(stamp, "monthly") }] : undefined;
  const steps = copy.state === "ready" ? bridgeSteps(baseRes, baseInputs) : null;
  const heroShared = {
    id: "lbo-hero",
    eyebrow: copy.eyebrow,
    live: false,
    lede: copy.lede,
    actions: HERO_ACTIONS,
    freshness,
    glow: copy.glow,
    minHeight: 300,
  };
  const footnote: ReactNode[] | undefined = copy.footnote
    ? [
        <span key="badge" data-role="irr-badge" style={{ color: copy.footnoteColor ?? undefined }}>
          {copy.footnote}
        </span>,
      ]
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
      />
    ) : (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>{copy.headline}</span>}
        pill={copy.pill}
        pillTone={copy.pillTone}
        subhead={copy.subhead}
        note={copy.note}
        placeholder
      />
    );

  /* ── summary rows (B.2) ──────────────────────────────────────────────── */
  const d = defaults.data;
  const dNote = <StateNote loading={defaults.isLoading} error={defaults.isError} />;
  const creditLabel = credit.data?.credit_label;
  const rows: SummaryRow[] = [
    { id: "fed-funds", label: "Fed funds", value: d ? `${d.fedfunds.toFixed(2)}%` : dNote },
    { id: "hy-oas", label: "HY OAS", value: d ? `${d.hy_oas_pct.toFixed(2)}%` : dNote },
    { id: "all-in", label: "All-in rate", value: d ? <b style={{ fontWeight: 500 }}>{d.lbo_all_in_rate.toFixed(2)}%</b> : dNote },
    {
      id: "financing",
      label: "Financing",
      value: defaults.isLoading
        ? dNote
        : `${inputs.interest_rate.toFixed(2)}% all-in${manualRate ? " (manual)" : clampedLive != null ? " (live: Fed Funds + HY spread)" : " (stated default)"}`,
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
  const words = lboStrip(defaults);
  const strip: StatusStripProps = {
    ...words,
    onClick: openFreshness,
    ariaHasPopup: "dialog",
    ariaLabel: `${words.title}. ${words.detail}. ${STRIP_SUFFIX}`,
  };

  return (
    <div className="mrr-hero-row">
      {hero}
      <SummaryCard id="lbo-summary" as="h2" title="Live financing" rows={rows} status={strip} />
    </div>
  );
}
