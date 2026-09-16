/**
 * AllocationHeroRow: the Asset allocation tool's hero row (redesign Phase 9,
 * checklist 09 B.9): `TabHero id="allocation-hero"` beside `SummaryCard
 * id="allocation-summary"` inside `.mrr-hero-row`. The headline is the tab's
 * answer, the asset that led the current regime's months, with its served
 * annualized mean as the pill; the T21 to T23 desk read supplies the subhead,
 * the lede and the freshness chips. The signature visual is
 * `RegimeReturnBars`, the current regime's served means drawn as horizontal
 * bars (the Markets hero's one-week-bars idiom). The strip is the optimizer
 * state, a hash link to `#allocation-optimization`. One request: the same
 * `useAllocation` key the panel reads.
 */

import type { CSSProperties, ReactNode } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { useAllocation } from "../../api/queries";
import type { AllocationData } from "../../api/types";
import { assessFreshness } from "../shared/freshness";
import { StateNote } from "../shared/screen-ui";
import SummaryCard, { type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import {
  ALLOCATION_EYEBROW,
  ALLOCATION_GLOW,
  ERROR_HEADLINE,
  LOADING_HEADLINE,
  LOADING_LEDE,
  LOADING_SUBHEAD,
  STRIP_SUFFIX,
  allocationHero,
  allocationStrip,
  allocationSummary,
  currentStats,
  optimizerRow,
  pct,
  spct,
  startMonYr,
  type RankedAsset,
} from "./allocation-copy";

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
  { label: "See the optimization", to: "/app/tools#allocation-optimization", primary: true },
  { label: "Regime Lab backtests", to: "/app/regime-lab#backtests" },
];

const STRIP_TARGET = "#allocation-optimization";

/* ── RegimeReturnBars (B.9.1) ────────────────────────────────────────────── */

const TOP = 26;
const ZERO_X = 232;
const MAX_BAR = 96;
const MAX_ROW_H = 26;
const VALUE_FILL = "#dfe6ec";
const CAPTION_FILL = "#7d8b98";
const f1 = (v: number): string => v.toFixed(1);

/** Horizontal bars, one per asset in the caller's order (the current
 * regime's served means, descending); a bar from the centre zero rule,
 * `--pos` right for a gain and `--neg` left for a loss, the label left and
 * the served figure right. Sorting and drawing only. */
export function RegimeReturnBars({ rows, regime }: { rows: RankedAsset[]; regime: string }) {
  const n = rows.length;
  const rowH = n ? Math.min(MAX_ROW_H, (270 - TOP - 6) / n) : MAX_ROW_H;
  const barH = Math.max(6, Math.min(14, rowH - 8));
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.m)), 0);
  const scale = maxAbs > 0 ? MAX_BAR / maxAbs : 0;
  return (
    <svg
      viewBox="0 0 400 270"
      width="100%"
      role="img"
      aria-label={`Annualized return by asset in ${regime} months`}
      style={{ display: "block", maxWidth: 400, marginLeft: "auto" }}
    >
      <text data-role="caption" x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill={CAPTION_FILL} style={{ fontFamily: "var(--font-mono)" }}>
        RETURN BY ASSET · {regime.toUpperCase()} · ANNUALIZED
      </text>
      <line data-role="zero" x1={ZERO_X} x2={ZERO_X} y1={TOP - 4} y2={f1(TOP + n * rowH + 2)} stroke="rgba(255,255,255,.18)" />
      {rows.map((r, i) => {
        const cy = TOP + i * rowH + rowH / 2;
        const width = Math.abs(r.m) * scale;
        const gain = r.m >= 0;
        return (
          <g key={r.n} data-role="row">
            <text x="0" y={f1(cy + 3.5)} fontSize="10.5" fill="var(--text-3)" style={{ fontFamily: "var(--font-ui)" }}>
              {r.n}
            </text>
            <rect
              data-role="bar"
              x={f1(gain ? ZERO_X : ZERO_X - width)}
              y={f1(cy - barH / 2)}
              width={f1(width)}
              height={f1(barH)}
              rx="2"
              fill={gain ? "var(--pos)" : "var(--neg)"}
              fillOpacity=".75"
            />
            <text
              data-role="value"
              x="398"
              y={f1(cy + 3.5)}
              textAnchor="end"
              fontSize="10.5"
              fill={VALUE_FILL}
              style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
            >
              {spct(r.m)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ── the row ────────────────────────────────────────────────────────────── */

export default function AllocationHeroRow() {
  // Freshness chips are hidden on a phone (the checklist 03 B.1 convention every tab follows).
  const { isMobile } = useBreakpoint();
  const q = useAllocation();
  const a: AllocationData | null = q.data ?? null;
  const loading = q.isLoading && !a;
  const error = q.isError && !a;

  /* ── hero (B.9) ──────────────────────────────────────────────────────── */
  const heroShared = {
    id: "allocation-hero",
    eyebrow: ALLOCATION_EYEBROW,
    live: false,
    actions: HERO_ACTIONS,
    minHeight: 300,
  };
  let hero: ReactNode;
  if (a) {
    const copy = allocationHero(a);
    const summary = allocationSummary(a);
    hero = (
      <TabHero
        {...heroShared}
        headline={copy.generic ? <span style={stateHeadline}>{copy.headline}</span> : copy.headline}
        pill={copy.pill}
        pillTone={copy.pillTone}
        glow={copy.glow}
        subhead={copy.subhead}
        lede={copy.lede || undefined}
        freshness={isMobile ? undefined : [
          { noun: "Returns", info: assessFreshness(`${a.data_end}-01`, "monthly") },
          { noun: "Regime labels", info: assessFreshness(null, "reference") },
        ]}
        chart={summary.ranked.length ? <RegimeReturnBars rows={summary.ranked} regime={summary.curRegime} /> : undefined}
        placeholder
      />
    );
  } else if (error) {
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>{ERROR_HEADLINE}</span>}
        pill="Unavailable"
        pillTone="gray"
        glow={ALLOCATION_GLOW.gray}
        placeholder
      />
    );
  } else {
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>{LOADING_HEADLINE}</span>}
        subhead={LOADING_SUBHEAD}
        lede={LOADING_LEDE}
        glow={ALLOCATION_GLOW.gray}
        placeholder
      />
    );
  }

  /* ── summary rows (B.9) ──────────────────────────────────────────────── */
  const note = <StateNote loading={loading} error={error} />;
  const curStats = a ? currentStats(a) : undefined;
  const optimizer = a ? optimizerRow(a) : null;
  const rows: SummaryRow[] = [
    {
      id: "sample",
      label: "Sample",
      value: a ? `${curStats?.n_months ?? 0} ${a.current_regime} months · ${a.n_months} total since ${startMonYr(a)}` : note,
    },
    { id: "risk-free", label: "Risk-free", value: a ? `${pct(a.rf_rate, 2)} Fed Funds` : note },
    { id: "optimizer", label: "Optimizer", value: optimizer ? optimizer.value : note, tone: optimizer?.tone },
  ];

  /* ── status strip: the optimizer state, a hash link to the section ───── */
  const words = allocationStrip(a ?? undefined, loading);
  const strip: StatusStripProps = {
    ...words,
    to: STRIP_TARGET,
    ariaLabel: `${words.title}. ${words.detail}. ${STRIP_SUFFIX}`,
  };

  return (
    <div className="mrr-hero-row">
      {hero}
      <SummaryCard id="allocation-summary" as="h2" title="Allocation summary" rows={rows} status={strip} />
    </div>
  );
}
