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
import { HeroChartFrame } from "../shared/HeroChart";
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
const BOTTOM = 6;
/** Row pitch cap (mockup); rows may open to ROW_OPEN in a taller hero. */
const MAX_ROW_H = 26;
const ROW_OPEN = 30;
/** Advance estimates (rounded up) for the column widths: Plex Sans 10.5px
 * names, 10.5px mono value labels (0.6em). */
const NAME_CH = 5.8;
const VALUE_CH = 6.3;
const NAME_GAP = 12;
const VALUE_GAP = 10;
const FALLBACK_H = 270;
const VALUE_FILL = "#dfe6ec";
const CAPTION_FILL = "#7d8b98";
const f1 = (v: number): string => v.toFixed(1);

/** Horizontal bars, one per asset in the caller's order (the current
 * regime's served means, descending); a bar from the zero rule, `--pos`
 * right for a gain and `--neg` left for a loss, the label left and the
 * served figure right. Sorting and drawing only.
 *
 * Iteration 1 (the hero chart-slot root cause, T3): drawn through
 * HeroChartFrame at the hero column's own size, 1:1 (400×270 before the
 * first measurement). The names and the values keep their columns; the bars
 * share the width between them on one scale, the zero rule where the widest
 * loss ends. */
export function RegimeReturnBars({ rows, regime }: { rows: RankedAsset[]; regime: string }) {
  const n = rows.length;
  const labels = rows.map((r) => spct(r.m));
  const nameEnd = Math.max(0, ...rows.map((r) => r.n.length)) * NAME_CH + NAME_GAP;
  const valueW = Math.max(0, ...labels.map((l) => l.length)) * VALUE_CH + VALUE_GAP;
  const maxPos = rows.reduce((m, r) => Math.max(m, r.m), 0);
  const maxNeg = rows.reduce((m, r) => Math.max(m, -r.m), 0);
  const floor = n ? Math.min(FALLBACK_H, TOP + n * MAX_ROW_H + BOTTOM) : FALLBACK_H;

  const draw = (w: number, h: number) => {
    // The frame keeps h between the floor and TOP + n × ROW_OPEN + BOTTOM.
    const rowH = n ? (h - TOP - BOTTOM) / n : MAX_ROW_H;
    const barH = Math.max(6, Math.min(14, rowH - 8));
    const span = Math.max(0, w - valueW - nameEnd);
    const total = maxPos + maxNeg;
    const scale = total > 0 ? span / total : 0;
    const zeroX = total > 0 ? nameEnd + maxNeg * scale : nameEnd + span / 2;
    return (
      <svg
        data-chart=""
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        role="img"
        aria-label={`Annualized return by asset in ${regime} months`}
        style={{ display: "block", maxWidth: "100%" }}
      >
        <text data-role="caption" x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill={CAPTION_FILL} style={{ fontFamily: "var(--font-mono)" }}>
          RETURN BY ASSET · {regime.toUpperCase()} · ANNUALIZED
        </text>
        <line data-role="zero" x1={f1(zeroX)} x2={f1(zeroX)} y1={TOP - 4} y2={f1(TOP + n * rowH + 2)} stroke="rgba(255,255,255,.18)" />
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
                x={f1(gain ? zeroX : zeroX - width)}
                y={f1(cy - barH / 2)}
                width={f1(width)}
                height={f1(barH)}
                rx="2"
                fill={gain ? "var(--pos)" : "var(--neg)"}
                fillOpacity=".75"
              />
              <text
                data-role="value"
                x={f1(w - 2)}
                y={f1(cy + 3.5)}
                textAnchor="end"
                fontSize="10.5"
                fill={VALUE_FILL}
                style={{ fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                {labels[i]}
              </text>
            </g>
          );
        })}
      </svg>
    );
  };

  return (
    <HeroChartFrame
      fallback={{ w: 400, h: FALLBACK_H }}
      minHeight={() => floor}
      maxHeight={() => Math.max(floor, TOP + n * ROW_OPEN + BOTTOM)}
    >
      {({ w, h }) => draw(w, h)}
    </HeroChartFrame>
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
