/**
 * /kit: the component kit. Every Phase 2 variant from
 * docs/redesign-v2/checklists/02-components.md section D renders here with
 * fixture data, in the order of src/screens/kit-manifest.ts (19 sections,
 * 85 numbered variants), plus the untouched legacy components so route K1
 * still shows all 17.
 *
 * FIXTURE DATA IS ALLOWED HERE AND NOWHERE ELSE. Every number is a
 * placeholder dated Sep 09, 2026, like the mockups; nothing here reads the
 * API (no api/queries or live/quotes import, no requests), and no fixture
 * spells a data-hook name (the hook-coverage corpus includes this file,
 * risk G16).
 *
 * Hooks for the tests and the verifier: every section root is
 * `<section data-kit={id} aria-labelledby>` with an h2; every variant wrapper
 * is `<div data-kit-variant={name}>` with a mono label. The page title is a
 * styled paragraph and the first TabHero specimen is the route's single h1
 * (risk G17); the other heroes pass `as="h2"`, and specimen SectionHeaders
 * render as h3 so the outline stays h1 > h2 (sections) > h3 / h4.
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertRow,
  Card,
  DataTable,
  DivergingBar,
  GaugeBar,
  HeatMatrix,
  IntelBanner,
  MeterRow,
  NewsCard,
  Pill,
  ProbabilityBar,
  ReadThrough,
  RegimeBadge,
  SectionHeader,
  Segmented,
  SignalCard,
  Sparkline,
  StatTile,
  StatusDot,
  TabBar,
  Tag,
  TickerStrip,
} from "../components";
import { KIT_SECTIONS, KIT_VARIANTS } from "./kit-manifest";
import Disclosure, { DisclosureLine } from "./shared/Disclosure";
import Jargon from "./shared/Jargon";
import ScrollTable from "./shared/ScrollTable";
import SubTabs, { type SubTabDef } from "./shared/SubTabs";
import {
  SummaryCard,
  kvLinkStyle,
  type SummaryRow,
} from "./shared/SummaryCard";
import { TabHero } from "./shared/TabHero";
import type { FreshLabel } from "./shared/fresh-state";
import {
  Caption,
  SliderRow,
  StateNote,
  capStyle,
  eyebrowStyle,
  metaStyle,
  monoNoteStyle,
} from "./shared/screen-ui";

/* ── Kit chrome ─────────────────────────────────────────────────────────── */

const ARROW = (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

const noop = () => undefined;

/** Section root: the manifest id, an h2 (SectionHeader) the section is labelled by. */
function KitSection({ id, children }: { id: string; children: ReactNode }) {
  const section = KIT_SECTIONS.find((s) => s.id === id);
  const n = section?.variants.length ?? 0;
  const headingId = `kit-${id}-title`;
  return (
    <section
      id={`kit-${id}`}
      data-kit={id}
      aria-labelledby={headingId}
      style={{
        marginTop: 44,
        paddingTop: 22,
        borderTop: "1px solid var(--line-2)",
        minWidth: 0,
      }}
    >
      <SectionHeader
        id={headingId}
        title={section?.title ?? id}
        right={n ? `${n} variant${n === 1 ? "" : "s"}` : "unchanged"}
        style={{ marginTop: 0 }}
      />
      {children}
    </section>
  );
}

/** Variant wrapper: the manifest name with its number as a mono label. */
function Variant({
  name,
  note,
  children,
  style,
}: {
  name: string;
  note?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const n = KIT_VARIANTS.indexOf(name) + 1;
  return (
    <div data-kit-variant={name} style={{ minWidth: 0, ...style }}>
      <div
        style={{
          ...metaStyle,
          textTransform: "none",
          color: "var(--text-4)",
          marginBottom: 8,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span>
          {String(n).padStart(2, "0")} · {name}
        </span>
        {note != null ? (
          <span style={{ letterSpacing: ".02em" }}>{note}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Grid({
  cols,
  min = 280,
  gap = 12,
  children,
  style,
}: {
  cols?: number;
  min?: number;
  gap?: number;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: cols
          ? `repeat(${cols}, minmax(0,1fr))`
          : `repeat(auto-fill, minmax(min(${min}px, 100%), 1fr))`,
        gap,
        alignItems: "start",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Tiny mono label above a specimen inside a variant. */
function Sub({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        ...metaStyle,
        fontSize: 10,
        color: "var(--text-4)",
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  );
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

const SPARK_SERIES = [3.9, 4.1, 3.8, 4.2, 4.4, 4.3, 4.0, 4.3, 4.5, 4.4, 4.3];
const CURVE_24 = [
  0.62, 0.58, 0.55, 0.51, 0.47, 0.44, 0.4, 0.38, 0.35, 0.33, 0.36, 0.34, 0.31,
  0.29, 0.33, 0.36, 0.38, 0.35, 0.37, 0.39, 0.42, 0.4, 0.43, 0.41,
];
const CPI_24 = [
  2.9, 3.0, 3.1, 3.1, 3.2, 3.3, 3.2, 3.4, 3.5, 3.4, 3.6, 3.5, 3.7, 3.6, 3.5,
  3.6, 3.5, 3.4, 3.5, 3.6, 3.5, 3.6, 3.5, 3.54,
];
const VIX_24 = [
  14.2, 13.8, 15.1, 16.0, 15.4, 17.2, 18.9, 17.5, 16.8, 19.4, 21.0, 20.2, 19.1,
  22.6, 24.8, 23.1, 26.4, 25.2, 28.9, 30.4, 29.1, 31.8, 33.0, 32.15,
];
const HY_24 = [
  3.4, 3.3, 3.35, 3.2, 3.1, 3.15, 3.0, 2.95, 3.05, 2.9, 2.85, 2.9, 2.8, 2.75,
  2.85, 2.8, 2.9, 2.95, 2.85, 2.8, 2.9, 2.95, 2.85, 2.91,
];
const SPX_8 = [598.2, 601.4, 604.9, 603.1, 607.8, 610.2, 609.4, 612.4];
const TLT_8 = [90.4, 90.1, 89.6, 89.9, 89.2, 88.7, 88.9, 88.12];

// Fixture labels in FRESHNESS_CONTRACT §5 words (Iteration 1 step 6, A3).
const FRESH_MACRO: FreshLabel = { word: "Jul 2026 print", muted: null, tone: "neutral", reason: "Fixture: the July print is the newest due.", stale: false };
const FRESH_MARKET: FreshLabel = { word: "Close · Sep 08", muted: null, tone: "neutral", reason: "Fixture: official close of the last completed session.", stale: false };
const FRESH_MACRO_DELAYED: FreshLabel = { word: "Jul 2026 · 1 release behind", muted: null, tone: "stale", reason: "Fixture: the August print is due.", stale: true };

const ODDS = {
  goldilocks: 0.64,
  overheating: 0.22,
  stagflation: 0.05,
  recession: 0.09,
};
const ODDS_SUB1 = {
  goldilocks: 0.64,
  overheating: 0.22,
  stagflation: 0.004,
  recession: 0.136,
};
const ODDS_TWO = { goldilocks: 0.52, recession: 0.48 };

const REGIME_LAB_TABS: SubTabDef[] = [
  { id: "overview", label: "Overview", hint: "Live model" },
  { id: "playbooks", label: "Playbooks", hint: "Reference" },
  { id: "scenarios", label: "Scenario builder", hint: "Stress rule" },
  { id: "analogues", label: "Analogues", hint: "Stored + reference" },
  { id: "backtests", label: "Backtests", hint: "Backtests" },
];
const TOOLS_TABS: SubTabDef[] = [
  { id: "lbo", label: "LBO calculator", hint: "Deal model" },
  { id: "allocation", label: "Allocation", hint: "Optimizer" },
];
const PLAIN_TABS: SubTabDef[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "regime-lab", label: "Regime Lab" },
  { id: "markets", label: "Markets" },
  { id: "credit", label: "Credit" },
  { id: "recession", label: "Recession" },
];

const HORIZON = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
];
const WINDOW = [
  { id: "upcoming", label: "Upcoming" },
  { id: "recent", label: "Recent" },
  { id: "all", label: "All" },
];
const RANGES = [
  { id: "5d", label: "5D" },
  { id: "1m", label: "1M" },
  { id: "6m", label: "6M" },
  { id: "1y", label: "1Y" },
  { id: "5y", label: "5Y" },
  {
    id: "max",
    label: "MAX",
    disabled: true,
    title: "Full history needs the daily backfill",
  },
];
const NEWS_WINDOW = [
  { id: "24h", label: "24H" },
  { id: "48h", label: "48H" },
  { id: "7d", label: "7D" },
];
const NEWS_CATEGORY = [
  { id: "all", label: "All" },
  { id: "macro", label: "Macro" },
  { id: "ma", label: "M&A" },
  { id: "earn", label: "Earn" },
  { id: "geo", label: "Geo" },
  { id: "sector", label: "Sector" },
];
const NEWS_SIG = [
  { id: "any", label: "Any sig" },
  { id: "notable", label: "≥ 2.5 notable" },
  { id: "high", label: "≥ 3.5 high" },
];

const METER_TONES = [
  ["clear", 41, "Curve inversion", "41%"],
  ["watch", 68, "Inflation pressure", "68%"],
  ["alert", 96, "VIX spike", "96%"],
  ["info", 55, "Credit stress", "55%"],
  ["neutral", 30, "Unemployment", "30%"],
  ["pos", 72, "Risk sentiment", "72%"],
] as const;

const COEFFICIENTS = [
  ["2s10s spread", -0.92],
  ["HY OAS", 0.74],
  ["LEI proxy", -0.55],
  ["Unemployment", 0.38],
  ["10Y breakeven", -0.21],
] as const;

const DEBT_COLUMNS = [
  { key: "period", label: "Period" },
  { key: "ebitda", label: "EBITDA", align: "right" as const, mono: true },
  { key: "interest", label: "Interest", align: "right" as const, mono: true },
  { key: "paydown", label: "Paydown", align: "right" as const, mono: true },
  { key: "debt", label: "Ending debt", align: "right" as const, mono: true },
  { key: "leverage", label: "Leverage", align: "right" as const, mono: true },
];
const DEBT_ROWS = [
  {
    id: "close",
    period: "Close",
    ebitda: "$100M",
    interest: "$0M",
    paydown: "$0M",
    debt: "$500M",
    leverage: "5.0×",
  },
  {
    id: "y1",
    period: "Year 1",
    ebitda: "$106M",
    interest: "$38M",
    paydown: "$22M",
    debt: "$478M",
    leverage: "4.5×",
  },
  {
    id: "y2",
    period: "Year 2",
    ebitda: "$112M",
    interest: "$36M",
    paydown: "$28M",
    debt: "$450M",
    leverage: "4.0×",
  },
  {
    id: "y3",
    period: "Year 3",
    ebitda: "$119M",
    interest: "$34M",
    paydown: "$34M",
    debt: "$416M",
    leverage: "3.5×",
  },
  {
    id: "y4",
    period: "Year 4",
    ebitda: "$126M",
    interest: "$31M",
    paydown: "$41M",
    debt: "$375M",
    leverage: "3.0×",
  },
  {
    id: "y5",
    period: "Year 5",
    ebitda: "$134M",
    interest: "$28M",
    paydown: "$48M",
    debt: "$327M",
    leverage: "2.4×",
  },
];

interface TapeRow {
  id: string;
  sym: string;
  name: string;
  last: string;
  d1: number;
  w1: number;
  spark: number[];
}
const TAPE_EQUITIES: TapeRow[] = [
  {
    id: "spy",
    sym: "SPY",
    name: "S&P 500",
    last: "612.40",
    d1: 0.28,
    w1: 1.12,
    spark: SPX_8,
  },
  {
    id: "qqq",
    sym: "QQQ",
    name: "Nasdaq 100",
    last: "548.10",
    d1: 0.41,
    w1: 1.85,
    spark: [531.2, 534.8, 539.1, 537.6, 542.3, 545.9, 544.2, 548.1],
  },
  {
    id: "iwm",
    sym: "IWM",
    name: "Russell 2000",
    last: "228.35",
    d1: -0.62,
    w1: 0.4,
    spark: [227.4, 228.9, 230.1, 229.2, 231.4, 230.6, 229.8, 228.35],
  },
  {
    id: "eem",
    sym: "EEM",
    name: "EM equities",
    last: "46.12",
    d1: 0.15,
    w1: -0.88,
    spark: [46.5, 46.7, 46.4, 46.2, 46.0, 45.9, 46.05, 46.12],
  },
  {
    id: "efa",
    sym: "EFA",
    name: "DM ex-US",
    last: "84.90",
    d1: -0.05,
    w1: 0.62,
    spark: [84.4, 84.6, 84.9, 85.2, 85.0, 85.1, 84.95, 84.9],
  },
];
const TAPE_RATES: TapeRow[] = [
  {
    id: "tlt",
    sym: "TLT",
    name: "20Y+ Treasury",
    last: "88.12",
    d1: -0.64,
    w1: -1.3,
    spark: TLT_8,
  },
  {
    id: "ief",
    sym: "IEF",
    name: "7-10Y Treasury",
    last: "95.40",
    d1: -0.21,
    w1: -0.45,
    spark: [95.8, 95.9, 95.7, 95.6, 95.5, 95.6, 95.6, 95.4],
  },
];
const TAPE_CREDIT: TapeRow[] = [
  {
    id: "hyg",
    sym: "HYG",
    name: "High yield",
    last: "79.85",
    d1: 0.1,
    w1: 0.35,
    spark: [79.5, 79.6, 79.7, 79.65, 79.8, 79.75, 79.77, 79.85],
  },
  {
    id: "lqd",
    sym: "LQD",
    name: "Investment grade",
    last: "109.20",
    d1: -0.08,
    w1: -0.22,
    spark: [109.4, 109.5, 109.35, 109.3, 109.25, 109.3, 109.29, 109.2],
  },
];
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const SignedCell = ({ v }: { v: number }) => (
  <span style={{ color: v >= 0 ? "var(--pos)" : "var(--neg)" }}>
    {signed(v)}
  </span>
);
const TAPE_COLUMNS = [
  { key: "sym", label: "Symbol", mono: true, sub: (r: TapeRow) => r.name },
  { key: "last", label: "Last", align: "right" as const, mono: true },
  {
    key: "d1",
    label: "1D",
    align: "right" as const,
    mono: true,
    render: (r: TapeRow) => <SignedCell v={r.d1} />,
  },
  {
    key: "w1",
    label: "1W",
    align: "right" as const,
    mono: true,
    render: (r: TapeRow) => <SignedCell v={r.w1} />,
  },
  {
    key: "spark",
    label: "1W trend",
    align: "right" as const,
    width: "64px",
    render: (r: TapeRow) => (
      <Sparkline
        values={r.spark}
        width={48}
        height={16}
        color={r.w1 >= 0 ? "var(--pos)" : "var(--neg)"}
        fill={false}
        strokeWidth={1.3}
        style={{ display: "inline-block", verticalAlign: "middle" }}
      />
    ),
  },
];

const KEY_LEVEL_COLUMNS = [
  { key: "label", label: "Level" },
  { key: "value", label: "Value", align: "right" as const, mono: true },
];
const KEY_LEVEL_ROWS = [
  { id: "ff", label: "Fed funds", value: "3.64%" },
  { id: "10y", label: "US 10Y", value: "4.30%" },
  { id: "2s10s", label: "2s10s", value: "+41 bps" },
  { id: "vix", label: "VIX", value: "18.92" },
];

const CREDIT_STATES = ["Normal", "Tight", "Stressed", "Crisis"];
const TRANSITION_3M = [
  [0.88, 0.07, 0.05, 0],
  [0.31, 0.58, 0.11, 0],
  [0.14, 0.06, 0.72, 0.08],
  [0, 0, 0.39, 0.61],
];
const TRANSITION_6M = [
  [0.79, 0.12, 0.08, 0.01],
  [0.41, 0.42, 0.15, 0.02],
  [0.22, 0.1, 0.58, 0.1],
  [0.03, 0.02, 0.47, 0.48],
];
const transitionCells = (m: number[][]) =>
  m.map((row) =>
    row.map((p) => ({ value: p, text: `${Math.round(p * 100)}%` })),
  );
const stateCols = CREDIT_STATES.map((s) => ({ key: s, label: s }));

const MULTIPLES = ["9.0×", "9.5×", "10.0×", "10.5×", "11.0×"];
const IRR_GRID: (number | null)[][] = [
  [21.6, 23.3, 25.3, 27.0, 28.7],
  [18.4, 20.1, 21.9, 23.6, 25.2],
  [15.5, 17.2, 18.9, 20.5, 22.1],
  [12.9, 14.9, 16.2, 17.8, 19.4],
  [10.0, 12.3, 13.4, 15.1, 16.8],
];
const irrCells = (grid: (number | null)[][]) =>
  grid.map((row) =>
    row.map((v) => ({
      value: v,
      text: v == null ? "n/a" : `${v.toFixed(1)}%`,
    })),
  );
const multipleAxis = (labels: string[]) =>
  labels.map((m) => ({ key: m, label: m }));

const IRR_LEGEND = (
  <>
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <i
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          marginRight: 6,
          background: "rgba(38,220,160,.35)",
        }}
      />
      20% or more
    </span>
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <i
        aria-hidden="true"
        style={{
          display: "inline-block",
          width: 10,
          height: 10,
          borderRadius: 2,
          marginRight: 6,
          background: "rgba(240,80,63,.25)",
        }}
      />
      Below 15%
    </span>
    <span style={{ marginLeft: "auto" }}>Exit multiple →</span>
  </>
);

/* ── Inline SVG chart fixtures (the hero's right column) ────────────────── */

/** Growth against inflation: twelve monthly reads drifting into Goldilocks. */
function QuadrantChart() {
  const trail =
    "250,110 262,118 270,130 281,141 289,150 296,162 303,171 309,183 314,195 318,204 322,212 326,218";
  const label: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: ".08em",
    textTransform: "uppercase",
  };
  return (
    <svg
      viewBox="0 0 400 330"
      width="100%"
      role="img"
      aria-label="Growth against inflation, the last twelve monthly regime reads"
      style={{ display: "block", maxWidth: 400, margin: "0 auto" }}
    >
      <rect
        x="40"
        y="20"
        width="340"
        height="270"
        rx="8"
        fill="rgba(255,255,255,.02)"
        stroke="var(--line)"
      />
      <rect
        x="211"
        y="20"
        width="169"
        height="135"
        fill="rgba(230,126,34,.07)"
      />
      <rect x="40" y="20" width="170" height="135" fill="rgba(231,76,60,.07)" />
      <rect
        x="40"
        y="156"
        width="170"
        height="134"
        fill="rgba(149,165,166,.06)"
      />
      <rect
        x="211"
        y="156"
        width="169"
        height="134"
        fill="rgba(38,220,160,.08)"
      />
      <line x1="210" y1="20" x2="210" y2="290" stroke="var(--line)" />
      <line x1="40" y1="155" x2="380" y2="155" stroke="var(--line)" />
      <text x="50" y="36" fill="var(--r-stagflation)" style={label}>
        Stagflation
      </text>
      <text
        x="370"
        y="36"
        fill="var(--r-overheating)"
        textAnchor="end"
        style={label}
      >
        Overheating
      </text>
      <text x="50" y="282" fill="var(--r-recession)" style={label}>
        Recession risk
      </text>
      <text x="370" y="282" fill="var(--mint)" textAnchor="end" style={label}>
        Goldilocks
      </text>
      <polyline
        points={trail}
        fill="none"
        stroke="var(--text-3)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeDasharray="3 3"
      />
      <circle cx="250" cy="110" r="3" fill="var(--text-3)" />
      <circle cx="326" cy="218" r="9" fill="rgba(38,220,160,.18)" />
      <circle cx="326" cy="218" r="5" fill="var(--mint)" />
      <text
        x="210"
        y="316"
        fill="var(--text-4)"
        textAnchor="middle"
        style={label}
      >
        Growth →
      </text>
      <text
        x="22"
        y="155"
        fill="var(--text-4)"
        textAnchor="middle"
        transform="rotate(-90 22 155)"
        style={label}
      >
        Inflation →
      </text>
    </svg>
  );
}

/** Recession odds as a half gauge: 35% against the 30% elevated threshold. */
function OddsGauge() {
  const label: CSSProperties = {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: ".08em",
    textTransform: "uppercase",
  };
  return (
    <svg
      viewBox="0 0 360 210"
      width="100%"
      role="img"
      aria-label="Recession odds within 12 months, 35 percent against a 30 percent threshold"
      style={{ display: "block", maxWidth: 360, margin: "0 auto" }}
    >
      <path
        d="M30 180 A150 150 0 0 1 330 180"
        fill="none"
        stroke="var(--track)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <path
        d="M30 180 A150 150 0 0 1 111.9 46.4"
        fill="none"
        stroke="var(--amber)"
        strokeWidth="14"
        strokeLinecap="round"
      />
      <line
        x1="86"
        y1="50.6"
        x2="97.7"
        y2="66.7"
        stroke="rgba(255,255,255,.55)"
        strokeWidth="2"
      />
      <text
        x="180"
        y="150"
        fill="#fff"
        textAnchor="middle"
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: 36,
          fontWeight: 500,
          letterSpacing: "-.01em",
        }}
      >
        35%
      </text>
      <text
        x="180"
        y="174"
        fill="var(--text-3)"
        textAnchor="middle"
        style={label}
      >
        within 12 months
      </text>
      <text
        x="30"
        y="204"
        fill="var(--text-4)"
        textAnchor="middle"
        style={label}
      >
        0%
      </text>
      <text
        x="330"
        y="204"
        fill="var(--text-4)"
        textAnchor="middle"
        style={label}
      >
        100%
      </text>
      <text
        x="66"
        y="40"
        fill="var(--text-4)"
        textAnchor="middle"
        style={label}
      >
        30% elevated
      </text>
    </svg>
  );
}

/* ── Stateful specimens ─────────────────────────────────────────────────── */

function SegDemo({
  label,
  options,
  initial,
  mono = false,
}: {
  label: string;
  options: { id: string; label: string; disabled?: boolean; title?: string }[];
  initial: string;
  mono?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Segmented
      label={label}
      options={options}
      value={value}
      onChange={setValue}
      mono={mono}
    />
  );
}

function SubTabsDemo({ tabs, label }: { tabs: SubTabDef[]; label: string }) {
  const [active, setActive] = useState(tabs[0].id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <SubTabs tabs={tabs} active={active} onChange={setActive} label={label}>
      <Caption>
        Panel for {current.label}: the selected view renders here.
      </Caption>
    </SubTabs>
  );
}

interface SliderDemoProps {
  label: ReactNode;
  name?: string;
  initial: number;
  min: number;
  max: number;
  step: number;
  text: (v: number) => string;
  format?: (v: number) => string;
  baseline?: number;
  scale?: { left?: ReactNode; right?: ReactNode; mid?: ReactNode };
  input?: { unit?: string; dp?: number };
  note?: ReactNode;
  disabled?: boolean;
}

function SliderDemo({
  label,
  name,
  initial,
  min,
  max,
  step,
  text,
  format,
  baseline,
  scale,
  input,
  note,
  disabled,
}: SliderDemoProps) {
  const [value, setValue] = useState(initial);
  return (
    <SliderRow
      label={label}
      name={name}
      valueText={text(value)}
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={setValue}
      format={format}
      baseline={baseline}
      scale={scale}
      input={input}
      note={note}
      disabled={disabled}
    />
  );
}

/** The credit transition matrix with the 3-month / 6-month fixtures behind a Segmented. */
function TransitionMatrixDemo() {
  const [horizon, setHorizon] = useState("3m");
  const matrix = horizon === "6m" ? TRANSITION_6M : TRANSITION_3M;
  const months = horizon === "6m" ? 6 : 3;
  return (
    <Card>
      <SectionHeader
        layout="panel"
        as="h3"
        title="Credit state odds"
        description="Where the credit state goes from here, from the stored monthly history"
        actions={
          <Segmented
            label="Horizon"
            options={HORIZON}
            value={horizon}
            onChange={setHorizon}
          />
        }
      />
      <HeatMatrix
        preset="transition"
        ariaLabel={`Credit state transition odds, ${months} months`}
        corner="From ↓ to →"
        rows={CREDIT_STATES.map((s) => ({
          key: s,
          label: s,
          current: s === "Normal",
        }))}
        cols={stateCols}
        cells={transitionCells(matrix)}
      />
      <Caption>
        The outlined row is today's state (Normal). Mint cells are the odds of
        staying, amber cells the odds of a move; {months}-month horizon.
      </Caption>
    </Card>
  );
}

/** Drifting quotes so the TickerStrip's 600ms tick flash is visible (demo only). */
function useDriftingQuotes() {
  const [n, setN] = useState({ spy: 0.28, vix: 16.9, ten: 4.4 });
  useEffect(() => {
    const i = setInterval(
      () =>
        setN((p) => ({
          spy: +(p.spy + (Math.random() - 0.5) * 0.14).toFixed(2),
          vix: +(p.vix + (Math.random() - 0.5) * 0.4).toFixed(2),
          ten: +(p.ten + (Math.random() - 0.5) * 0.03).toFixed(2),
        })),
      2200,
    );
    return () => clearInterval(i);
  }, []);
  return n;
}

/* ── Summary card fixtures ──────────────────────────────────────────────── */

const SUMMARY_ROWS: SummaryRow[] = [
  {
    id: "regime",
    label: "Model regime",
    value: (
      <Link to="/app/regime-lab" style={kvLinkStyle}>
        Goldilocks
      </Link>
    ),
  },
  {
    id: "odds",
    label: "Odds",
    value: <ProbabilityBar probs={ODDS} height={6} />,
  },
  { id: "probability", label: "Model probability", value: "64%" },
  { id: "confidence", label: "Model confidence", value: "Medium (50%)" },
  {
    id: "vs-market",
    label: "Model vs market",
    value: "Macro ahead by ~34 on ±100",
    tone: "var(--amber)",
  },
  {
    id: "next",
    label: "Next 3 months",
    value: "Stay 88% · Overheating 7% · Stagflation 5%",
  },
  {
    id: "takeaway",
    label: "Key takeaway",
    value:
      "Growth near trend with inflation cooling; the read has held for three months.",
    prose: true,
  },
];

const CREDIT_ROWS: SummaryRow[] = [
  { id: "state", label: "Credit state", value: "Normal" },
  {
    id: "ccc",
    label: "CCC OAS",
    value: "8.42% (+41 bps / 1M)",
    tone: "var(--amber)",
  },
  { id: "hy", label: "HY OAS", value: "2.91%" },
  { id: "ig", label: "IG OAS", value: "0.81%" },
  { id: "distress", label: "CCC vs distress line", value: "107.6%" },
  {
    id: "read",
    label: "Key takeaway",
    value:
      "Tight at the top of the ladder while CCC drifts wider: a quality-ladder tension worth a watch.",
    prose: true,
  },
];

const LOADING_ROWS: SummaryRow[] = [
  { id: "regime", label: "Model regime", value: <StateNote loading /> },
  {
    id: "probability",
    label: "Model probability",
    value: <StateNote loading />,
  },
  { id: "confidence", label: "Model confidence", value: <StateNote loading /> },
  { id: "vs-market", label: "Model vs market", value: <StateNote loading /> },
];

const RECESSION_ROWS: SummaryRow[] = [
  { id: "prob", label: "Probability", value: "35%", tone: "var(--amber)" },
  { id: "change", label: "1-month change", value: "+7 pts" },
  { id: "threshold", label: "Threshold", value: "30% elevated" },
  { id: "crossing", label: "Last crossing", value: "Mar 2026" },
  { id: "inputs", label: "Inputs", value: "5 · latest Aug 2026" },
];

/* ── The page ───────────────────────────────────────────────────────────── */

export default function KitScreen() {
  const [tab, setTab] = useState("Markets");
  const n = useDriftingQuotes();

  return (
    <div
      className="mrr-kit"
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        padding: "24px 28px 80px",
      }}
    >
      <div style={{ maxWidth: 1400, margin: "0 auto", minWidth: 0 }}>
        <header>
          <p
            className="mrr-display"
            style={{ fontSize: 40, lineHeight: 1.05, margin: 0, color: "#fff" }}
          >
            Component Kit
          </p>
          <p style={{ ...metaStyle, margin: "10px 0 0" }}>
            {KIT_SECTIONS.length} sections · {KIT_VARIANTS.length} variants ·
            fixture data dated Sep 09, 2026 · dev scratch route
          </p>
          <nav aria-label="Kit sections" style={{ marginTop: 14 }}>
            <ul
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {KIT_SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#kit-${s.id}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      height: 24,
                      padding: "0 10px",
                      borderRadius: "var(--r-badge)",
                      border: "1px solid var(--line-white-14)",
                      color: "var(--text-2)",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      letterSpacing: ".04em",
                      textDecoration: "none",
                    }}
                  >
                    {s.id}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        {/* 1 TabHero */}
        <KitSection id="tabhero">
          <div style={{ display: "grid", gap: 16 }}>
            <Variant name="hero-regime-mint" note="the route's only h1">
              <TabHero
                eyebrow="Current regime"
                live
                headline="Goldilocks"
                pill="64% probability"
                subhead="A clear lead over Overheating at 25%."
                lede="Growth is holding near trend while inflation keeps cooling, the mix that has historically favoured duration and quality equities. The lead widened for a third month as core inflation printed below 3% and the curve stayed positive."
                actions={[
                  { label: "Explore the regime", to: "/app/regime-lab" },
                  { label: "View model details", to: "/app/methodology" },
                ]}
                footnote={[
                  "Macro regime for Jul 2026",
                  "Model confidence: Medium (50%)",
                  "Read Sep 09, 2026",
                ]}
                freshness={[
                  { noun: "Macro", label: FRESH_MACRO },
                  { noun: "Market", label: FRESH_MARKET },
                ]}
                note="Market data runs through Sep 08, 2026; the regime read is inside its monthly cycle."
                chart={<QuadrantChart />}
              />
            </Variant>
            <Variant name="hero-recession-amber">
              <TabHero
                as="h2"
                eyebrow="Recession odds"
                headline="35%"
                pill="Elevated"
                pillTone="amber"
                subhead="Odds within 12 months, up from 28% in June."
                lede="The curve is flat, high-yield spreads are 40 bps wider than in June and the leading-indicator proxy has rolled over. Odds this high have preceded four of the last six downturns within a year."
                actions={[{ label: "Open the model", to: "/app/recession" }]}
                footnote={["Model inputs through Aug 2026", "Threshold 30%"]}
                freshness={[{ noun: "Macro", label: FRESH_MACRO_DELAYED }]}
                glow="rgba(245,181,46,.06)"
                chart={<OddsGauge />}
              />
            </Variant>
            <Variant name="hero-loading-gray">
              <TabHero
                as="h2"
                eyebrow="Current regime"
                headline={
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontWeight: 500,
                      fontSize: 23,
                      letterSpacing: 0,
                    }}
                  >
                    Reading the latest regime…
                  </span>
                }
                lede="The summary card and the signal tiles fill in once the stored regime row is read."
                glow="rgba(200,210,220,.05)"
                placeholder
              />
            </Variant>
            <Variant name="hero-photo-slot">
              <TabHero
                as="h2"
                eyebrow="Desk read · Dashboard"
                headline="Risk-on, with a tight credit cushion."
                pill="Goldilocks 64%"
                subhead="Spreads sit near 20-year lows while the regime read holds."
                lede="One sentence on why it matters; the licensed image lands in the slot on the right (decision 8)."
                footnote={["Read Sep 09, 2026", "Photo slot"]}
                placeholder
                minHeight={300}
              />
            </Variant>
          </div>
        </KitSection>

        {/* 2 SummaryCard and StatusStrip */}
        <KitSection id="summary">
          <Grid
            min={340}
            gap={16}
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(340px, 432px))",
            }}
          >
            <Variant name="summary-mint-strip">
              <SummaryCard
                title="Model & market summary"
                rows={SUMMARY_ROWS}
                status={{
                  tone: "mint",
                  title: "No alerts · 7 days",
                  detail: "Last alert May 01, 2026",
                  onClick: noop,
                  ariaHasPopup: "dialog",
                  ariaLabel: "Open the alert drawer",
                }}
              />
            </Variant>
            <Variant name="summary-amber-strip">
              <SummaryCard
                title="Credit summary"
                rows={CREDIT_ROWS}
                status={{
                  tone: "amber",
                  title: "Watch · CCC widening",
                  detail: "+41 bps in a month while BB and B held flat",
                  to: "/app/credit#quality-ladder",
                }}
              />
            </Variant>
            <Variant name="summary-gray-loading">
              <SummaryCard
                title="Model & market summary"
                rows={LOADING_ROWS}
                status={{
                  tone: "gray",
                  title: "Reading alert feed…",
                  detail: "Stored alerts, 7-day window",
                }}
              />
            </Variant>
            <Variant name="summary-no-strip-disclosure">
              <SummaryCard title="Model summary" rows={RECESSION_ROWS}>
                <div style={{ marginTop: 10 }}>
                  <Disclosure
                    variant="quiet"
                    title="Reference thresholds"
                    right="4 levels"
                  >
                    <ul
                      style={{ ...monoNoteStyle, margin: 0, paddingLeft: 18 }}
                    >
                      <li>Below 15%: benign</li>
                      <li>15% to 30%: watch</li>
                      <li>30% to 50%: elevated</li>
                      <li>Above 50%: recession likely</li>
                    </ul>
                  </Disclosure>
                </div>
              </SummaryCard>
            </Variant>
          </Grid>
        </KitSection>

        {/* 3 SignalCard */}
        <KitSection id="signalcard">
          <Grid min={300}>
            <Variant name="signal-clear-sparkline">
              <SignalCard
                name="Curve inversion risk"
                value="0.41%"
                fillPct={41}
                status="Clear"
                lastTriggered="none on file"
                sparkline={CURVE_24}
                lines={[
                  "Trips when the 10Y–2Y spread closes below 0.00%.",
                  "Signal print Sep 2026",
                ]}
              />
            </Variant>
            <Variant name="signal-watch-three-lines">
              <SignalCard
                name="Inflation pressure"
                value="3.54% YoY"
                fillPct={68}
                status="Watch"
                lastTriggered="Mar 2026"
                sparkline={CPI_24}
                lines={[
                  "Trips when core CPI runs above 4.00% YoY.",
                  "Signal print Jul 2026 · next monthly print pending",
                ]}
              />
            </Variant>
            <Variant name="signal-triggered">
              <SignalCard
                name="VIX spike"
                value="32.15"
                fillPct={96}
                status="Triggered"
                lastTriggered="Sep 2026"
                sparkline={VIX_24}
                lines={[
                  "Trips when the VIX weekly z-score closes above 3.0.",
                  "Signal print Sep 09, 2026",
                ]}
              />
            </Variant>
            <Variant name="signal-credit-tier-normal">
              <SignalCard
                name="High yield"
                value="2.91%"
                fillPct={7}
                badge="Normal"
                tone="clear"
                meterLabel="20-year percentile"
                lastTriggered={null}
                sparkline={HY_24}
                lines={[
                  "1M change: +6 bps",
                  "Series BAMLH0A0HYM2 · Sep 08, 2026",
                ]}
              />
            </Variant>
            <Variant name="signal-unavailable">
              <SignalCard
                name="Unemployment spike"
                value="Unavailable"
                badge="Unavailable"
                tone="reference"
                showGauge={false}
                lastTriggered={null}
                lines={["No print on file for Aug 2026."]}
              />
            </Variant>
            <Variant name="signal-loading-caption">
              <SignalCard
                name="Inflation pressure"
                value={<StateNote loading />}
                showGauge={false}
                lastTriggered={null}
                caption="Reading the latest print from the stored series."
              />
            </Variant>
            <Variant name="signal-heading-h4">
              <Card>
                <SectionHeader
                  level="sub"
                  title="Model inputs"
                  style={{ marginTop: 0 }}
                />
                <SignalCard
                  heading="h4"
                  name="Yield curve 2s10s"
                  value="+0.41%"
                  fillPct={22}
                  status="Clear"
                  lastTriggered="none on file"
                  lines={["Signal print Sep 2026"]}
                />
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 4 Panel and SectionHeader */}
        <KitSection id="panel">
          <div style={{ display: "grid", gap: 12 }}>
            <Grid min={420}>
              <Variant name="panel-inline-header">
                <Card>
                  <SectionHeader
                    as="h3"
                    title="Monitored signals"
                    right="5 signals · latest Sep 09, 2026"
                    style={{ marginTop: 0 }}
                  />
                  <p
                    style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}
                  >
                    Inline layout: the meta stays inside the heading (label
                    parity, risk G1).
                  </p>
                </Card>
              </Variant>
              <Variant name="panel-layout-description-link">
                <Card>
                  <SectionHeader
                    layout="panel"
                    as="h3"
                    title="Spread monitor"
                    description="Option-adjusted spreads by rating"
                    right="5 series · latest Sep 08, 2026"
                    actions={
                      <Link className="mrr-link" to="/app/methodology">
                        Series notes {ARROW}
                      </Link>
                    }
                  />
                  <p
                    style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}
                  >
                    Panel layout: eyebrow, description, meta and a link action
                    as siblings.
                  </p>
                </Card>
              </Variant>
              <Variant name="panel-layout-segmented-action">
                <Card>
                  <SectionHeader
                    layout="panel"
                    as="h3"
                    title="Credit state odds"
                    description="Transition odds from the stored monthly history"
                    actions={
                      <SegDemo label="Horizon" options={HORIZON} initial="3m" />
                    }
                  />
                  <p
                    style={{ margin: 0, fontSize: 13, color: "var(--text-2)" }}
                  >
                    A Segmented control in the actions slot, outside the heading
                    text.
                  </p>
                </Card>
              </Variant>
              <Variant name="tile-sub-header-h4">
                <Card>
                  <SectionHeader
                    as="h3"
                    title="Transition odds"
                    right="3-month horizon"
                    style={{ marginTop: 0 }}
                  />
                  <Card variant="tile">
                    <SectionHeader
                      level="sub"
                      as="h4"
                      title="From Goldilocks"
                      style={{ marginTop: 0 }}
                    />
                    <MeterRow
                      swatch="var(--r-goldilocks)"
                      label="Stay"
                      pct={88}
                      color="var(--r-goldilocks)"
                      value="88%"
                    />
                    <MeterRow
                      swatch="var(--r-overheating)"
                      label="Overheating"
                      pct={7}
                      color="var(--r-overheating)"
                      value="7%"
                    />
                  </Card>
                </Card>
              </Variant>
              <Variant name="card-gradient">
                <Card variant="card">
                  <div style={eyebrowStyle}>Model probability</div>
                  <div
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 30,
                      fontWeight: 500,
                      letterSpacing: "-.01em",
                      fontVariantNumeric: "tabular-nums",
                      marginTop: 8,
                    }}
                  >
                    64%
                  </div>
                  <Caption>
                    The gradient surface the hero and summary cards share.
                  </Caption>
                </Card>
              </Variant>
            </Grid>
            <Variant name="panel-tones">
              <Grid min={200}>
                <Card tone="watch">
                  <Tag tone="watch">Watch</Tag>
                  <Caption>tone="watch"</Caption>
                </Card>
                <Card tone="risk">
                  <Tag tone="alert">Triggered</Tag>
                  <Caption>tone="risk"</Caption>
                </Card>
                <Card tone="clear">
                  <Tag tone="clear">Clear</Tag>
                  <Caption>tone="clear"</Caption>
                </Card>
                <Card tone="accent">
                  <Tag tone="info">Info</Tag>
                  <Caption>tone="accent"</Caption>
                </Card>
              </Grid>
            </Variant>
            <Variant name="panel-accent-callouts">
              <Grid min={360}>
                <Card accentBar tone="watch">
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>
                    Quality ladder tension
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-2)",
                      marginTop: 4,
                    }}
                  >
                    CCC spreads widened 41 bps in a month while BB and B held
                    flat; the weakest credits are being repriced first.
                  </div>
                </Card>
                <Card accentBar>
                  <div style={{ fontWeight: 500, fontSize: 13.5 }}>
                    Model note
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-2)",
                      marginTop: 4,
                    }}
                  >
                    The regime read is a monthly classifier; the market overlay
                    is daily. Read them as two clocks.
                  </div>
                </Card>
              </Grid>
            </Variant>
            <Grid min={420}>
              <Variant name="panel-padding-zero-table">
                <Card padding="0">
                  <div style={{ padding: "6px 18px 8px" }}>
                    <ScrollTable label="Annual debt schedule specimen">
                      <DataTable
                        columns={DEBT_COLUMNS}
                        rows={DEBT_ROWS}
                        zebra={false}
                        caption="Annual debt schedule inside a padding-0 panel"
                      />
                    </ScrollTable>
                  </div>
                </Card>
              </Variant>
              <Variant name="panel-surface-void-well">
                <Card
                  surface="var(--void)"
                  padding="12px 14px"
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: "var(--text-2)",
                  }}
                >
                  <div style={{ color: "var(--text-3)" }}>
                    SELECT date, prob_recession FROM regimes ORDER BY date DESC
                    LIMIT 3
                  </div>
                  <div>2026-08-01 · 0.35</div>
                  <div>2026-07-01 · 0.28</div>
                  <div>2026-06-01 · 0.27</div>
                </Card>
              </Variant>
              <Variant name="panel-as-section">
                <Card
                  as="section"
                  id="kit-panel-section-specimen"
                  aria-labelledby="kit-panel-section-specimen-title"
                >
                  <SectionHeader
                    as="h3"
                    id="kit-panel-section-specimen-title"
                    title="Quality ladder"
                    right="BB · B · CCC detail · monthly"
                    style={{ marginTop: 0 }}
                  />
                  <p
                    style={{ margin: 0, fontSize: 13, color: "var(--text-2) " }}
                  >
                    Rendered as a real section with an id the palette can jump
                    to.
                  </p>
                </Card>
              </Variant>
            </Grid>
          </div>
        </KitSection>

        {/* 5 Badge */}
        <KitSection id="badge">
          <div style={{ display: "grid", gap: 16 }}>
            <Variant name="badge-tones-sm">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Tag tone="clear">Clear</Tag>
                <Tag tone="watch">Watch</Tag>
                <Tag tone="alert">Triggered</Tag>
                <Tag tone="info">Macro</Tag>
                <Tag tone="reference">Reference</Tag>
                <Tag tone="hot">Elevated</Tag>
                <Tag tone="research">Perplexity</Tag>
              </div>
            </Variant>
            <Variant name="badge-tones-xs">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Tag tone="clear" size="xs">
                  Beat
                </Tag>
                <Tag tone="watch" size="xs">
                  Geo
                </Tag>
                <Tag tone="alert" size="xs">
                  Miss
                </Tag>
                <Tag tone="info" size="xs">
                  Macro
                </Tag>
                <Tag tone="reference" size="xs">
                  SPY
                </Tag>
                <Tag tone="hot" size="xs">
                  Stale
                </Tag>
                <Tag tone="research" size="xs">
                  Cited
                </Tag>
              </div>
            </Variant>
            <Variant name="badge-md-sentence-case">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Tag tone="info" size="md" uppercase={false}>
                  Medium conviction
                </Tag>
                <Tag tone="reference" size="md" uppercase={false}>
                  Default deal
                </Tag>
                <Tag tone="watch" size="md" uppercase={false}>
                  Modified deal
                </Tag>
              </div>
            </Variant>
            <Variant name="badge-alias-names" note="old name = new name">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 18,
                  alignItems: "center",
                }}
              >
                {(
                  [
                    ["pos", "clear"],
                    ["warn", "watch"],
                    ["neg", "alert"],
                    ["accent", "info"],
                    ["neutral", "reference"],
                  ] as const
                ).map(([old, next]) => (
                  <span
                    key={old}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Tag tone={old}>{old}</Tag>
                    <span style={{ ...metaStyle, color: "var(--text-4)" }}>
                      =
                    </span>
                    <Tag tone={next}>{next}</Tag>
                  </span>
                ))}
              </div>
            </Variant>
            <Variant
              name="badge-jargon-child"
              note="Tight has no glossary entry until Phase 6; OAS proves the tooltip embeds"
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <Tag tone="info">
                  <Jargon term="Tight">Tight</Jargon>
                </Tag>
                <Tag tone="info">
                  <Jargon term="OAS">OAS</Jargon>
                </Tag>
              </div>
            </Variant>
          </div>
        </KitSection>

        {/* 6 Pill and RegimeBadge */}
        <KitSection id="pill">
          <div style={{ display: "grid", gap: 16 }}>
            <Variant name="pill-md">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <Pill>64% probability</Pill>
                <Pill tone="amber">Elevated</Pill>
                <Pill tone="gray">Unavailable</Pill>
              </div>
            </Variant>
            <Variant name="pill-sm">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <Pill size="sm">64% probability</Pill>
                <Pill size="sm" tone="amber">
                  Elevated
                </Pill>
                <Pill size="sm" tone="gray">
                  Unavailable
                </Pill>
              </div>
            </Variant>
            <Variant name="regime-badge-md">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <RegimeBadge label="Goldilocks" confidence={0.64} />
                <RegimeBadge label="Overheating" confidence={0.52} />
                <RegimeBadge label="Stagflation" />
                <RegimeBadge label="Recession Risk" />
              </div>
            </Variant>
            <Variant name="regime-badge-sm">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <RegimeBadge label="Goldilocks" size="sm" confidence={0.64} />
                <RegimeBadge label="Overheating" size="sm" confidence={0.52} />
                <RegimeBadge label="Stagflation" size="sm" confidence={0.31} />
                <RegimeBadge
                  label="Recession Risk"
                  size="sm"
                  confidence={0.17}
                />
              </div>
            </Variant>
            <Variant name="regime-badge-tone-override">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <RegimeBadge label="Reading regime" tone="gray" />
                <RegimeBadge
                  label="Goldilocks"
                  tone="amber"
                  confidence={0.41}
                />
                <RegimeBadge label="Unknown label" />
              </div>
            </Variant>
          </div>
        </KitSection>

        {/* 7 SubTabs */}
        <KitSection id="subtabs">
          <div style={{ display: "grid", gap: 16 }}>
            <Variant name="subtabs-regime-lab-hints">
              <SubTabsDemo tabs={REGIME_LAB_TABS} label="Regime Lab views" />
            </Variant>
            <Variant name="subtabs-tools-two">
              <div style={{ maxWidth: 480 }}>
                <SubTabsDemo tabs={TOOLS_TABS} label="Tools" />
              </div>
            </Variant>
            <Variant name="subtabs-no-hints">
              <SubTabsDemo tabs={PLAIN_TABS} label="Views without hints" />
            </Variant>
          </div>
        </KitSection>

        {/* 8 Segmented */}
        <KitSection id="segmented">
          <div style={{ display: "grid", gap: 16 }}>
            <Grid min={260}>
              <Variant name="segmented-two-options">
                <SegDemo label="Horizon" options={HORIZON} initial="3m" />
              </Variant>
              <Variant name="segmented-three-options">
                <SegDemo
                  label="Calendar window"
                  options={WINDOW}
                  initial="upcoming"
                />
              </Variant>
              <Variant name="segmented-mono-ranges">
                <SegDemo label="Range" options={RANGES} initial="1m" mono />
              </Variant>
            </Grid>
            <Variant name="segmented-news-filter-row">
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <SegDemo
                  label="Window"
                  options={NEWS_WINDOW}
                  initial="24h"
                  mono
                />
                <span
                  aria-hidden="true"
                  style={{ width: 1, height: 20, background: "var(--line)" }}
                />
                <SegDemo
                  label="Category"
                  options={NEWS_CATEGORY}
                  initial="all"
                  mono
                />
                <span
                  aria-hidden="true"
                  style={{ width: 1, height: 20, background: "var(--line)" }}
                />
                <SegDemo
                  label="Significance"
                  options={NEWS_SIG}
                  initial="any"
                  mono
                />
              </div>
            </Variant>
            <Variant
              name="segmented-touch"
              note="data-touch appears below 768px (the group reads the viewport tier itself); resize to see the 40px buttons"
            >
              <SegDemo
                label="Markets at a glance"
                options={[
                  { id: "eq", label: "Equities" },
                  { id: "rates", label: "Rates" },
                  { id: "fx", label: "FX" },
                  { id: "cmdty", label: "Commodities" },
                ]}
                initial="eq"
              />
            </Variant>
          </div>
        </KitSection>

        {/* 9 Meter, MeterRow and DivergingBar */}
        <KitSection id="meter">
          <Grid min={320} gap={16}>
            <Variant name="meter-tones">
              <Card>
                <div style={{ display: "grid", gap: 10 }}>
                  {METER_TONES.map(([tone, pct, label, value]) => (
                    <div
                      key={tone}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "112px minmax(0,1fr) 44px",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                        {label}
                      </span>
                      <GaugeBar pct={pct} tone={tone} gutter={false} />
                      <span
                        style={{
                          ...metaStyle,
                          textAlign: "right",
                          textTransform: "none",
                        }}
                      >
                        {value} · {tone}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </Variant>
            <Variant name="meter-legacy-ramp">
              <Card>
                <Sub>No tone, no colour: the four-step ramp</Sub>
                <GaugeBar pct={32} />
                <GaugeBar pct={62} />
                <GaugeBar pct={88} />
                <GaugeBar pct={98} />
              </Card>
            </Variant>
            <Variant name="meter-gradient-tick-scale">
              <Card>
                <Sub>Cycle progress · 7 months in</Sub>
                <GaugeBar
                  pct={26.7}
                  tone="clear"
                  gradient
                  tick={50}
                  height={8}
                  scale={{ left: "0", mid: "avg 26.3 mo", right: "2× avg" }}
                />
              </Card>
            </Variant>
            <Variant name="meter-caption-percentile">
              <Card>
                <GaugeBar pct={7} tone="clear" caption="20-year percentile" />
                <Caption>
                  High yield OAS at 2.91% sits at the 7th percentile of its
                  20-year history.
                </Caption>
              </Card>
            </Variant>
            <Variant name="meter-rows">
              <Card>
                <Sub>Transition tile · from Goldilocks</Sub>
                <MeterRow
                  swatch="var(--r-goldilocks)"
                  label="Goldilocks"
                  pct={60}
                  color="var(--r-goldilocks)"
                  value="60%"
                  delta="−4 pts"
                />
                <MeterRow
                  swatch="var(--r-overheating)"
                  label="Overheating"
                  pct={25}
                  color="var(--r-overheating)"
                  value="25%"
                  delta="+6 pts"
                  deltaTone="watch"
                />
                <MeterRow
                  swatch="var(--r-stagflation)"
                  label="Stagflation"
                  pct={9}
                  color="var(--r-stagflation)"
                  value="9%"
                  delta="+1 pt"
                />
                <MeterRow
                  swatch="var(--r-recession)"
                  label="Recession Risk"
                  pct={6}
                  color="var(--r-recession)"
                  value="6%"
                  delta="−3 pts"
                />
                <div style={{ height: 12 }} aria-hidden="true" />
                <Sub>Late-cycle rows</Sub>
                <MeterRow
                  label="Curve slope"
                  pct={42}
                  tone="watch"
                  value="42%"
                  valueSize="sm"
                  height={34}
                />
                <MeterRow
                  label="Credit spreads"
                  pct={18}
                  tone="clear"
                  value="18%"
                  valueSize="sm"
                  height={34}
                />
                <MeterRow
                  label="Unemployment gap"
                  pct={61}
                  tone="alert"
                  value="61%"
                  valueSize="sm"
                  height={34}
                />
              </Card>
            </Variant>
            <Variant name="diverging-bars">
              <Card>
                <Sub>Coefficients · log-odds per 1 sd</Sub>
                <div style={{ display: "grid", gap: 8 }}>
                  {COEFFICIENTS.map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "112px minmax(0,1fr) 52px",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                        {label}
                      </span>
                      <DivergingBar value={value} max={1} />
                      <span
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: 13,
                          fontWeight: 500,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ height: 12 }} aria-hidden="true" />
                <Sub>Surprises · 120px, positive green</Sub>
                <div style={{ display: "grid", gap: 8 }}>
                  {(
                    [
                      ["CPI", 0.31],
                      ["Payrolls", -0.42],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "112px 120px 52px",
                        gap: 12,
                        alignItems: "center",
                      }}
                    >
                      <span style={{ fontSize: 13, color: "var(--text-2)" }}>
                        {label}
                      </span>
                      <DivergingBar
                        value={value}
                        max={1}
                        width={120}
                        positiveColor="var(--pos)"
                        negativeColor="var(--neg)"
                      />
                      <span
                        style={{
                          fontFamily: "var(--font-ui)",
                          fontSize: 13,
                          fontWeight: 500,
                          textAlign: "right",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {value > 0 ? `+${value.toFixed(2)}` : value.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 10 ProbabilityBar */}
        <KitSection id="odds">
          <Grid min={260}>
            <Variant name="odds-four-regime">
              <ProbabilityBar probs={ODDS} />
            </Variant>
            <Variant name="odds-sub-one-percent">
              <ProbabilityBar probs={ODDS_SUB1} />
            </Variant>
            <Variant name="odds-two-regime">
              <ProbabilityBar probs={ODDS_TWO} />
            </Variant>
            <Variant name="odds-height-5-no-legend">
              <ProbabilityBar probs={ODDS} height={5} showLegend={false} />
            </Variant>
            <Variant name="odds-letter-desc">
              <ProbabilityBar probs={ODDS} legend="letter" order="desc" />
            </Variant>
          </Grid>
        </KitSection>

        {/* 11 DataTable */}
        <KitSection id="table">
          <Grid min={440} gap={16}>
            <Variant name="table-debt-schedule">
              <Card>
                <ScrollTable label="Annual debt schedule specimen">
                  <DataTable
                    columns={DEBT_COLUMNS}
                    rows={DEBT_ROWS}
                    zebra={false}
                    caption="Annual debt schedule"
                  />
                </ScrollTable>
              </Card>
            </Variant>
            <Variant name="table-compact-grouped-tape">
              <Card>
                <ScrollTable label="Macro tape specimen">
                  <DataTable
                    compact
                    zebra={false}
                    caption="Macro tape"
                    columns={TAPE_COLUMNS}
                    groups={[
                      { key: "equities", label: "Equities", rows: TAPE_EQUITIES },
                      { key: "rates", label: "Rates", rows: TAPE_RATES },
                      { key: "credit", label: "Credit", rows: TAPE_CREDIT },
                    ]}
                  />
                </ScrollTable>
              </Card>
            </Variant>
            <Variant name="table-empty-rows">
              <Card>
                <ScrollTable label="Empty macro tape specimen">
                  <DataTable
                    columns={TAPE_COLUMNS}
                    rows={[]}
                    caption="Macro tape, empty"
                  />
                </ScrollTable>
                <div style={{ marginTop: 10 }}>
                  <StateNote />
                </div>
              </Card>
            </Variant>
            <Variant name="table-hide-header-caption">
              <Card>
                <ScrollTable label="Key levels specimen">
                  <DataTable
                    columns={KEY_LEVEL_COLUMNS}
                    rows={KEY_LEVEL_ROWS}
                    zebra={false}
                    hideHeader
                    caption="Key levels"
                  />
                </ScrollTable>
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 12 SliderRow */}
        <KitSection id="slider">
          <Grid min={320} gap={16}>
            <Variant name="slider-default">
              <Card>
                <SliderDemo
                  label="Unemployment rate"
                  initial={4.8}
                  min={3}
                  max={7}
                  step={0.1}
                  text={(v) => `${v.toFixed(1)}%`}
                />
              </Card>
            </Variant>
            <Variant name="slider-baseline-unchanged">
              <Card>
                <SliderDemo
                  label="Yield curve 2s10s"
                  initial={0.41}
                  min={-2}
                  max={3}
                  step={0.05}
                  baseline={0.41}
                  text={(v) => `${v.toFixed(2)}%`}
                  format={(v) => `${v.toFixed(2)}%`}
                />
              </Card>
            </Variant>
            <Variant name="slider-baseline-changed">
              <Card>
                <SliderDemo
                  label="Unemployment rate"
                  initial={4.8}
                  min={3}
                  max={7}
                  step={0.1}
                  baseline={4.3}
                  text={(v) => `${v.toFixed(1)}%`}
                  format={(v) => `${v.toFixed(1)}%`}
                />
              </Card>
            </Variant>
            <Variant name="slider-scale-format">
              <Card>
                <SliderDemo
                  label="Hold period"
                  initial={5}
                  min={3}
                  max={7}
                  step={1}
                  text={(v) => `${v} years`}
                  format={(v) => `${v} yr`}
                  scale={{ left: "3 yr", right: "7 yr", mid: "typical 5 yr" }}
                />
              </Card>
            </Variant>
            <Variant name="slider-input-note">
              <Card>
                <SliderDemo
                  label="Entry EBITDA"
                  initial={120}
                  min={10}
                  max={500}
                  step={10}
                  text={(v) => `$${v}M`}
                  input={{ unit: "$M", dp: 0 }}
                  note="Live default from the stored deal, Sep 09, 2026."
                />
              </Card>
            </Variant>
            <Variant name="slider-disabled">
              <Card>
                <SliderDemo
                  label="Rate shock"
                  initial={0}
                  min={-200}
                  max={200}
                  step={25}
                  text={(v) => `${v >= 0 ? "+" : ""}${v} bp`}
                  disabled
                  note="Locked while the scenario runs."
                />
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 13 HeatMatrix */}
        <KitSection id="heatmatrix">
          <Grid min={440} gap={16}>
            <Variant name="heat-transition-current-row">
              <TransitionMatrixDemo />
            </Variant>
            <Variant name="heat-irr-current-cell-legend">
              <Card>
                <SectionHeader
                  layout="panel"
                  as="h3"
                  title="IRR sensitivity"
                  description="Entry multiple down, exit multiple across"
                  right="Base case 10.0× / 10.0×"
                />
                <HeatMatrix
                  preset="irr"
                  ariaLabel="IRR by entry and exit multiple"
                  corner="Entry ↓"
                  rows={multipleAxis(MULTIPLES)}
                  cols={multipleAxis(MULTIPLES)}
                  cells={irrCells(IRR_GRID)}
                  currentCell={[2, 2]}
                  legend={IRR_LEGEND}
                />
              </Card>
            </Variant>
            <Variant name="heat-transition-dash-row">
              <Card>
                <SectionHeader
                  layout="panel"
                  as="h3"
                  title="Credit state odds"
                  description="Tight has no stored months, so its row prints dashes"
                />
                <HeatMatrix
                  preset="transition"
                  ariaLabel="Credit state transition odds with an empty Tight row"
                  corner="From ↓ to →"
                  rows={CREDIT_STATES.map((s) => ({
                    key: s,
                    label: s,
                    current: s === "Normal",
                    empty: s === "Tight",
                  }))}
                  cols={stateCols}
                  cells={transitionCells(TRANSITION_3M).map((row, i) =>
                    i === 1 ? null : row,
                  )}
                />
              </Card>
            </Variant>
            <Variant name="heat-irr-null-cell">
              <Card>
                <SectionHeader
                  layout="panel"
                  as="h3"
                  title="IRR sensitivity"
                  description="A cell the model could not solve prints n/a"
                />
                <HeatMatrix
                  preset="irr"
                  ariaLabel="IRR by entry and exit multiple with one unsolved cell"
                  corner="Entry ↓"
                  rows={multipleAxis(MULTIPLES.slice(0, 3))}
                  cols={multipleAxis(MULTIPLES.slice(0, 3))}
                  cells={irrCells([
                    [21.6, 23.3, 25.3],
                    [18.4, 20.1, null],
                    [15.5, 17.2, 18.9],
                  ])}
                  currentCell={[1, 1]}
                />
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 14 Disclosure and DisclosureLine */}
        <KitSection id="disclosure">
          <Grid min={420} gap={16}>
            <Variant name="disclosure-row-description-meta">
              <Disclosure
                title="Options lens"
                description="Chain by expiration · bid, ask, IV, Greeks"
                right="EODHD · 15M"
              >
                <Caption>
                  Chain fixture: 12 expirations, nearest Sep 19, 2026; 184
                  strikes on file.
                </Caption>
              </Disclosure>
            </Variant>
            <Variant name="disclosure-row-open">
              <Disclosure
                title="Methodology note"
                right="Reference"
                defaultOpen
              >
                <Caption>
                  The recession model is a logistic regression on curve, credit
                  and leading-indicator inputs, trained on NBER dates; the
                  probability shown is the model's own, not the regime
                  classifier's.
                </Caption>
              </Disclosure>
            </Variant>
            <Variant name="disclosure-quiet-mint">
              <Disclosure
                variant="quiet"
                tone="mint"
                title="Regime read · 3 sources"
              >
                <ul style={{ ...monoNoteStyle, margin: 0, paddingLeft: 18 }}>
                  <li>
                    <a
                      href="https://www.federalreserve.gov/monetarypolicy.htm"
                      style={{ color: "var(--link)" }}
                    >
                      Federal Reserve, monetary policy statement
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://www.bls.gov/cpi/"
                      style={{ color: "var(--link)" }}
                    >
                      BLS, consumer price index release
                    </a>
                  </li>
                  <li>
                    <a
                      href="https://fred.stlouisfed.org/series/T10YIE"
                      style={{ color: "var(--link)" }}
                    >
                      FRED, 10-year breakeven inflation rate
                    </a>
                  </li>
                </ul>
              </Disclosure>
            </Variant>
            <Variant name="disclosure-line-footer">
              <DisclosureLine>
                Sources: FRED (DGS2, DGS10, BAMLC0A0CM, BAMLH0A0HYM2), yfinance
                daily bars, Finnhub and NewsAPI headlines. The regime read
                updates monthly, the market overlay daily at the close. Nothing
                on this page is investment advice.
              </DisclosureLine>
            </Variant>
          </Grid>
        </KitSection>

        {/* 15 Sparkline */}
        <KitSection id="sparkline">
          <Grid min={220}>
            <Variant name="sparkline-flat-fill">
              <Sparkline values={SPARK_SERIES} width={280} height={40} />
            </Variant>
            <Variant name="sparkline-gradient">
              <Sparkline
                values={SPX_8}
                width={80}
                height={26}
                color="var(--pos)"
                gradient
              />
            </Variant>
            <Variant name="sparkline-no-fill-118x30">
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <Sparkline
                  values={CURVE_24}
                  width={118}
                  height={30}
                  color="var(--mint)"
                  fill={false}
                  strokeWidth={1.4}
                />
                <Sparkline
                  values={CPI_24}
                  width={118}
                  height={30}
                  color="var(--amber)"
                  fill={false}
                  strokeWidth={1.4}
                />
              </div>
            </Variant>
            <Variant name="sparkline-tape-sizes">
              <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
                <Sparkline
                  values={TLT_8}
                  width={48}
                  height={16}
                  color="var(--neg)"
                  fill={false}
                  strokeWidth={1.3}
                />
                <Sparkline
                  values={TLT_8}
                  width={36}
                  height={18}
                  color="var(--neg)"
                  fill={false}
                  strokeWidth={1.3}
                />
              </div>
            </Variant>
            <Variant
              name="sparkline-one-point-empty"
              note="one point renders the empty 118x30 box"
            >
              <span
                style={{
                  display: "inline-block",
                  border: "1px dashed var(--line-white-14)",
                  lineHeight: 0,
                }}
              >
                <Sparkline values={[4.3]} width={118} height={30} />
              </span>
            </Variant>
          </Grid>
        </KitSection>

        {/* 16 Caption, StateNote and meta styles */}
        <KitSection id="caption">
          <Grid min={300} gap={16}>
            <Variant name="caption-prose">
              <Caption>
                Spreads are option-adjusted, monthly averages of daily closes;
                the percentile counts the last 20 years of prints.
              </Caption>
              <Caption as="p">
                As a paragraph: the same caption rendered with as="p" for prose
                flow.
              </Caption>
            </Variant>
            <Variant name="caption-mono-lines">
              <Caption mono style={{ marginTop: 0 }}>
                Last alert: none on file
              </Caption>
              <Caption mono style={{ marginTop: 3 }}>
                Trips when the 10Y–2Y spread closes below 0.00%.
              </Caption>
              <Caption mono style={{ marginTop: 3 }}>
                Signal print Sep 2026
              </Caption>
            </Variant>
            <Variant name="state-note-states">
              <div style={{ display: "grid", gap: 8 }}>
                <div>
                  <Sub>loading</Sub>
                  <StateNote loading />
                </div>
                <div>
                  <Sub>empty</Sub>
                  <StateNote />
                </div>
                <div>
                  <Sub>error</Sub>
                  <StateNote error />
                </div>
              </div>
            </Variant>
            <Variant name="meta-and-eyebrow-styles">
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  <Sub>metaStyle</Sub>
                  <span style={metaStyle}>5 inputs · latest Aug 2026</span>
                </div>
                <div>
                  <Sub>eyebrowStyle</Sub>
                  <span style={eyebrowStyle}>Model inputs</span>
                </div>
                <div>
                  <Sub>monoNoteStyle · capStyle</Sub>
                  <span style={monoNoteStyle}>Signal print Sep 2026</span>
                  <div style={{ ...capStyle, marginTop: 4 }}>
                    The desk-note caption style, spread directly.
                  </div>
                </div>
              </div>
            </Variant>
          </Grid>
        </KitSection>

        {/* 17 StatTile */}
        <KitSection id="stattile">
          <Grid min={300} gap={16}>
            <Variant name="stat-tile-sizes">
              <Card
                style={{
                  display: "flex",
                  gap: 24,
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                }}
              >
                <StatTile label="xs · P/E" value="24.1×" size="xs" />
                <StatTile label="sm · Headlines" value="128" size="sm" />
                <StatTile label="md · US 10Y" value="4.30%" />
                <StatTile label="lg · IRR" value="18.9%" size="lg" />
                <StatTile label="xl · All-in" value="$612M" size="xl" />
              </Card>
            </Variant>
            <Variant name="stat-tile-deltas">
              <Card
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0,1fr))",
                  gap: 16,
                }}
              >
                <StatTile
                  label="US 10Y"
                  value="4.30%"
                  delta="+10 bps"
                  direction="up"
                />
                <StatTile
                  label="VIX"
                  value="18.92"
                  delta="−6.33"
                  direction="down"
                />
                <StatTile
                  label="Fed funds"
                  value="3.64%"
                  delta="0.00"
                  direction="flat"
                />
              </Card>
            </Variant>
            <Variant name="stat-tile-live">
              <Card>
                <StatTile
                  label="S&P 500"
                  value="612.40"
                  delta="+0.28%"
                  direction="up"
                  live
                />
              </Card>
            </Variant>
          </Grid>
        </KitSection>

        {/* 18 Buttons */}
        <KitSection id="buttons">
          <Variant name="buttons-ghost-accent-primary-disabled">
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <button type="button" className="mrr-btn">
                Reset
              </button>
              <button type="button" className="mrr-btn mrr-btn-accent">
                Show more
              </button>
              <button type="button" className="mrr-btn mrr-btn-primary">
                Explore the regime {ARROW}
              </button>
              <button type="button" className="mrr-btn" disabled>
                Reset
              </button>
              <button
                type="button"
                className="mrr-btn mrr-btn-primary"
                disabled
              >
                Explore the regime
              </button>
              <button type="button" className="mrr-btn" data-touch="true">
                Touch floor
              </button>
            </div>
          </Variant>
        </KitSection>

        {/* 19 Legacy: unchanged components with their bundle fixtures */}
        <KitSection id="legacy">
          <SectionHeader level="sub" title="StatusDot" />
          <Card
            surface="var(--void)"
            style={{
              display: "flex",
              gap: 20,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            <StatusDot status="live" label="Live" />
            <StatusDot status="clear" label="Clear" />
            <StatusDot status="watch" label="Watch" />
            <StatusDot status="risk" label="Triggered" pulse />
            <StatusDot status="idle" label="Stale" />
          </Card>

          <SectionHeader level="sub" title="AlertRow" />
          <div style={{ display: "grid", gap: 6 }}>
            <AlertRow
              level="risk"
              name="VIX_shock"
              message="VIX weekly z-score=3.21, above the 3.0 risk threshold."
              date="2026-05-01"
            />
            <AlertRow
              level="watch"
              name="credit_stress"
              message="HYG underperformed SPY by -3.40%: credit stress watch."
              date="2026-04-30"
            />
            <AlertRow
              level="info"
              name="unemployment_spike"
              message="Unemployment Spike triggered (last triggered 2026-02)."
              date="2026-02-01"
            />
          </div>

          <SectionHeader
            level="sub"
            title="TickerStrip"
            right="values drift for demo"
          />
          <TickerStrip
            items={[
              {
                label: "S&P 500",
                value: (n.spy > 0 ? "+" : "") + n.spy.toFixed(2) + "%",
                raw: n.spy,
                tone: n.spy > 0 ? "pos" : "neg",
              },
              {
                label: "VIX",
                value: n.vix.toFixed(1),
                raw: n.vix,
                change: "-8.36",
                changeTone: "pos",
              },
              {
                label: "US 10Y",
                value: n.ten.toFixed(2) + "%",
                raw: n.ten,
                change: "+10bps",
                changeTone: "neg",
              },
            ]}
          />

          <SectionHeader level="sub" title="TabBar" />
          <TabBar
            tabs={[
              "Dashboard",
              "Regime Lab",
              "Markets",
              "Credit",
              "Recession",
              "News & Calendar",
              "Tools",
            ]}
            active={tab}
            onChange={setTab}
          />

          <SectionHeader
            level="sub"
            title="IntelBanner · ReadThrough · NewsCard"
          />
          <div style={{ display: "grid", gap: 12 }}>
            <IntelBanner
              conviction="Medium"
              headline="Markets are in Overheating regime (54% probability) with credit spreads at the 4th percentile, historically tight. Recession risk is elevated at 17%."
              meta={[
                { label: "Signal", value: "Risk-On", color: "var(--pos)" },
                { label: "Duration", value: "3.0mo", color: "var(--warn-hot)" },
              ]}
              action="See Regime Lab for full analysis"
              onAction={noop}
            />
            <ReadThrough
              paragraphs={[
                "Current conditions are consistent with an Overheating regime (high confidence): the economy is running above trend while inflation remains elevated, a combination that historically pressures rate-sensitive assets and steepens the front end of the yield curve.",
                "The classification is primarily driven by CPI at 3.29% YoY, unemployment at 4.3%, the 10Y–2Y spread at 0.52% and VIX at 16.9. The regime reading is unchanged for 3 consecutive months.",
              ]}
              footerLabel="Playbook bias"
              footer="Inflation risk elevated. Prefer real assets (GLD, commodities) and TIPS. Shorten duration; TLT faces headwinds. Value over growth; energy and materials over tech."
            />
            <NewsCard
              source="FINNHUB"
              time="2h ago"
              ticker="SPY"
              significance={6.4}
              headline="Fed nominee signals tolerance for above-target inflation through 2027"
              summary="Testimony pushed back on near-term cuts and framed 3% core as acceptable while labour markets stay tight."
              interpretation="Reinforces the Overheating read: sticky inflation with intact growth. Watch 10Y 4.35%; a clean break confirms the Overheating tilt over Stagflation drift."
              sources={[
                "https://www.federalreserve.gov/econres/notes/feds-notes/relationship-between-macroeconomic-overheating-and-financial-vulnerability-narrative-20181012.html",
              ]}
            />
          </div>
        </KitSection>
      </div>
    </div>
  );
}
