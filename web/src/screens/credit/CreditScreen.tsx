/**
 * Credit, rebuilt on TabHero + SummaryCard (redesign Phase 6,
 * docs/redesign-v2/checklists/06-credit.md B.0).
 *
 * Order of <main> children, all inside `.mrr-credit`: the hero row (TabHero
 * `#credit-hero`, whose h1 is the served credit_label with the HY OAS pill and
 * whose signature chart is the HY / IG OAS history on Lightweight Charts with
 * the three dashed classification rules and the NBER bands behind a 10Y / MAX
 * window control, beside SummaryCard `#credit-summary` with the quality-ladder
 * strip linking to `#quality-ladder`) → the spread monitor (`#oas`) → the
 * ladder row (`#quality-ladder` | `#credit-state-odds`) → financing
 * conditions (`#financing`) → the mono disclosure line.
 *
 * One data source: /api/credit/metrics (src/analytics/credit.py verbatim:
 * values in bps, monthly FRED cadence), read once here and passed to the four
 * panels as `{ m, status }`; FinancingConditions adds /api/lbo/defaults for
 * its stacked bar. Nothing is re-derived in the browser: every number is a
 * served field or its formatted value. The only client math is display math
 * on served points (the ten-year window cut, the plotted window's extremes
 * and the band list, oas-window.ts), never a probability. Captions follow the
 * confusion-index worklist: #6 ordinal percentiles, #8 distress vs Normal
 * paradox, #16 bps and percent stated together, #26 HY/IG ratio norm.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Segmented } from "../../components";
import { useCreditMetrics } from "../../api/queries";
import type { CreditMetrics } from "../../api/types";
import { fmtBps, fmtMonYr, ordinal } from "../../lib/format";
import { DASH } from "../dashboard/hero-copy";
import Jargon from "../shared/Jargon";
import { assessFreshness } from "../shared/freshness";
import { Caption, StateNote, capStyle, monoNoteStyle, useHashScroll } from "../shared/screen-ui";
import { DisclosureLine } from "../shared/Disclosure";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import SummaryCard, { type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import { CREDIT_GLOW, chartTercile, creditHero, ladderStrip, ratioNormWord, type CreditStatus } from "./hero-copy";
import { NBER_BANDS, bandList, bandsInWindow, intersectByDate, sliceWindow, windowExtremes } from "./oas-window";
import SpreadLinesChart, { type SpreadRule, type SpreadSeries } from "./SpreadLinesChart";
import SpreadMonitor from "./SpreadMonitor";
import QualityLadder from "./QualityLadder";
import CreditStateOdds from "./CreditStateOdds";
import FinancingConditions from "./FinancingConditions";

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

const HERO_ACTIONS: TabHeroAction[] = [
  { label: "See the quality ladder", to: "/app/credit#quality-ladder", primary: true },
  { label: "Price an LBO", to: "/app/tools#lbo" },
];

const STRIP_TARGET = "/app/credit#quality-ladder";

const n = (v: number): number => Math.round(v);

/** " · "-joined clauses, null ones dropped (the ledger pattern, 269-299). */
const join = (parts: (string | null)[]): string => parts.filter((p): p is string => p != null).join(" · ");

/* ── the hero OAS chart (B.1.1) ─────────────────────────────────────────── */

type OasWindow = "10y" | "max";

const WINDOW_OPTIONS = [
  { id: "10y", label: "10Y" },
  { id: "max", label: "MAX" },
];

/** The three dashed classification rules (credit.html:178 labels). Both
 * series share the right price scale, so the IG rule sits at 150 on the HY
 * axis too. Titles are decoration: the caption and the ladder carry the same
 * thresholds as text. */
const OAS_RULES: SpreadRule[] = [
  { series: 0, price: 700, color: "rgba(240,80,63,.7)", title: "CRISIS · HY > 700" },
  { series: 0, price: 400, color: "rgba(245,181,46,.6)", title: "STRESSED · HY > 400" },
  { series: 1, price: 150, color: "rgba(88,184,230,.55)", title: "TIGHT · IG > 150" },
];

const swatch = (color: string): CSSProperties => ({
  display: "inline-block",
  width: 14,
  height: 2,
  background: color,
  verticalAlign: 3,
  marginRight: 6,
});

function HeroOasChart({ m, win, onWindow }: { m: CreditMetrics; win: OasWindow; onWindow: (w: OasWindow) => void }) {
  // Both series run over the exact same date set (245-251, moved); the 10Y
  // cut is measured from the last served point, never the wall clock.
  const pairs = useMemo(() => intersectByDate(m.hy_series, m.ig_series), [m.hy_series, m.ig_series]);
  const plotted = useMemo(() => (win === "10y" ? sliceWindow(pairs, 10) : pairs), [pairs, win]);
  const series = useMemo<SpreadSeries[]>(
    () => [
      { label: "HY OAS", color: "#f5b52e", lineWidth: 2, points: plotted.map((p) => ({ date: p.date, value: p.hy })) },
      { label: "IG OAS", color: "#58b8e6", lineWidth: 1, points: plotted.map((p) => ({ date: p.date, value: p.ig })) },
    ],
    [plotted],
  );
  const ext = useMemo(() => windowExtremes(plotted), [plotted]);
  const bands = useMemo(() => (ext ? bandsInWindow(NBER_BANDS, ext.first, ext.last) : []), [ext]);
  const tercile = chartTercile(m.hy_pct_rank);
  const range = ext ? `${fmtMonYr(ext.first)} to ${fmtMonYr(ext.last)}` : "no stored months";
  const ariaLabel = `High-yield and investment-grade option-adjusted spreads, monthly, ${range}; dashed rules at HY 700, HY 400 and IG 150 bps; shaded NBER recessions`;

  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      <div
        style={{
          ...capStyle,
          marginTop: 0,
          marginBottom: 8,
          maxWidth: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <span style={{ display: "inline-flex", gap: 18, flexWrap: "wrap" }}>
          <span>
            <i aria-hidden="true" style={swatch("var(--amber)")} />
            HY OAS · bps
          </span>
          <span>
            <i aria-hidden="true" style={swatch("var(--link)")} />
            IG OAS · bps
          </span>
        </span>
        <Segmented mono label="OAS history window" options={WINDOW_OPTIONS} value={win} onChange={(id) => onWindow(id as OasWindow)} />
      </div>
      {plotted.length ? (
        <SpreadLinesChart series={series} rules={OAS_RULES} bands={bands} height={250} ariaLabel={ariaLabel} />
      ) : (
        <StateNote>No stored spread history to plot.</StateNote>
      )}
      <Caption>
        Spreads spike when lenders panic;{" "}
        {bands.length ? (
          <>
            the shaded {bands.length === 1 ? "band marks" : "bands mark"} the {bandList(bands.map((b) => b.label))}{" "}
            <Jargon term="NBER">NBER</Jargon> {bands.length === 1 ? "recession" : "recessions"}.
          </>
        ) : (
          <>
            no <Jargon term="NBER">NBER</Jargon> recession falls inside this window.
          </>
        )}
        {tercile ? ` ${tercile}` : null}
      </Caption>
      {ext ? (
        <div style={{ ...monoNoteStyle, marginTop: 6 }}>
          {fmtMonYr(ext.first)} → {fmtMonYr(ext.last)} · HY high {n(ext.hyHigh.value)} bps ({fmtMonYr(ext.hyHigh.date)}) · IG low{" "}
          {n(ext.igLow.value)} bps ({fmtMonYr(ext.igLow.date)})
        </div>
      ) : null}
    </div>
  );
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function CreditScreen() {
  const q = useCreditMetrics();
  const m: CreditMetrics | null = q.data ?? null;
  // The snapshot rule (03 B.1): no error copy while cached data is on screen.
  const status: CreditStatus = m ? "ready" : q.isError ? "error" : "loading";
  const [win, setWin] = useState<OasWindow>("10y");
  useHashScroll(m);

  const asOfIso = m?.hy_series.length ? m.hy_series[m.hy_series.length - 1].date : null;
  const fresh = assessFreshness(asOfIso, "monthly");
  const copy = m ? creditHero(m) : null;

  /* ── hero ────────────────────────────────────────────────────────────── */
  const heroShared = {
    id: "credit-hero",
    eyebrow: "Credit conditions",
    live: m != null && fresh.state === "current",
    actions: HERO_ACTIONS,
    // No absence before an answer: the chip waits for the payload (or its
    // error) instead of printing "Unavailable" while the request is pending.
    freshness: m || q.isError ? [{ noun: "ICE BofA via FRED", info: fresh }] : undefined,
  };
  let hero: ReactNode;
  if (m && copy) {
    hero = (
      <TabHero
        {...heroShared}
        headline={copy.headline}
        pill={copy.pill ? <span title={`ICE BofA US High Yield OAS, ${m.data_as_of ?? "latest stored month"}`}>{copy.pill}</span> : undefined}
        pillTone={copy.pillTone}
        glow={copy.glow}
        subhead={copy.subhead}
        lede={copy.lede}
        footnote={copy.footnote}
        chart={<HeroOasChart m={m} win={win} onWindow={setWin} />}
        placeholder
      />
    );
  } else if (q.isError) {
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>Credit metrics unavailable: the data service did not answer. The read resumes when it is back.</span>}
        pill="Unavailable"
        pillTone="gray"
        glow={CREDIT_GLOW.gray}
        placeholder
      />
    );
  } else {
    hero = <TabHero {...heroShared} headline={<span style={stateHeadline}>Reading credit spreads…</span>} glow={CREDIT_GLOW.gray} placeholder />;
  }

  /* ── summary rows (the desk-read ledger, re-homed; B.2) ──────────────── */
  const note = <StateNote loading={status === "loading"} error={status === "error"} />;
  const val = (f: (x: CreditMetrics) => ReactNode): ReactNode => (m ? f(m) : note);
  const stay3 = m?.transition_3m?.[m.credit_label]?.[m.credit_label];
  const rows: SummaryRow[] = [
    {
      id: "hy",
      label: "HY OAS",
      value: val((x) =>
        x.hy_oas != null
          ? join([`${n(x.hy_oas)} bps`, x.hy_1w_change != null ? `${fmtBps(x.hy_1w_change)} MoM` : null, x.hy_pct_rank != null ? `${ordinal(x.hy_pct_rank)} percentile since 1996` : null])
          : DASH,
      ),
    },
    {
      id: "ig",
      label: "IG OAS",
      value: val((x) =>
        x.ig_oas != null
          ? join([`${n(x.ig_oas)} bps`, x.ig_1w_change != null ? `${fmtBps(x.ig_1w_change)} MoM` : null, x.ig_pct_rank != null ? `${ordinal(x.ig_pct_rank)} percentile since 1996` : null])
          : DASH,
      ),
    },
    {
      id: "ccc",
      label: "CCC distress",
      value: val((x) =>
        x.ccc_oas != null
          ? join([`${n(x.ccc_oas)} bps`, x.ccc_1w_change != null ? `${fmtBps(x.ccc_1w_change)} MoM` : null, x.distress_ratio != null ? `${x.distress_ratio.toFixed(0)}% of the 1,000 bps line` : null])
          : DASH,
      ),
      tone: m?.distress_ratio != null ? (m.distress_ratio >= 100 ? "var(--neg)" : m.distress_ratio >= 80 ? "var(--warn-hot)" : undefined) : undefined,
    },
    {
      id: "ratio",
      label: "HY / IG ratio",
      value: val((x) => (x.hy_ig_ratio != null ? `${x.hy_ig_ratio.toFixed(2)}× · ${ratioNormWord(x.hy_ig_ratio)} the ~3.5× long-run norm` : DASH)),
    },
    {
      id: "stay3",
      label: m ? `Stays ${m.credit_label} · 3m` : "Stay odds · 3m",
      value: val((x) =>
        stay3 != null ? `${Math.round(stay3 * 100)}% of past months` : Object.keys(x.transition_3m ?? {}).length ? DASH : "not enough monthly history (needs 60 months)",
      ),
    },
    {
      id: "lbo",
      label: "LBO all-in",
      value: val((x) => (x.lbo_all_in_cost ? `${x.lbo_all_in_cost} · Fed Funds + HY spread` : DASH)),
    },
  ];

  /* ── status strip: the quality-ladder read, linking to the ladder ─────── */
  const words = ladderStrip(m, status);
  const strip: StatusStripProps = {
    ...words,
    detail: words.detail || undefined,
    to: STRIP_TARGET,
    ariaLabel: `${words.title}. ${words.detail ? `${words.detail}. ` : ""}Jump to the quality ladder.`,
  };

  return (
    <div className="mrr-credit">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard id="credit-summary" as="h2" title="Credit summary" rows={rows} status={strip} />
      </div>

      {/* ── Spread monitor, full width ───────────────────────────────── */}
      <SpreadMonitor m={m} status={status} />

      {/* ── Ladder row: quality ladder | credit state odds ───────────── */}
      <div className="mrr-credit-ladder-row">
        <QualityLadder m={m} status={status} />
        <CreditStateOdds m={m} status={status} />
      </div>

      {/* ── Financing conditions (sole owner of the all-in tile) ─────── */}
      <FinancingConditions m={m} status={status} />

      {/* ── source line ──────────────────────────────────────────────── */}
      <DisclosureLine>
        ICE BofA option-adjusted spread indices via FRED, monthly observations · classification checks rules top-down (Crisis, then
        Stressed, then Tight, else Normal) · transition odds are empirical frequencies from stored monthly states · classification and
        transition odds computed by the same analytics module the memo reads.
      </DisclosureLine>
    </div>
  );
}
