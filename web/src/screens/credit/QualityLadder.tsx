/**
 * Quality ladder, `<section id="quality-ladder">` (redesign Phase 6,
 * checklist 06 B.5): the BB / B / CCC chart on the six served sparkline
 * points (F2: no longer series is served for the three rungs), the HY / IG
 * ratio tile, the CCC-vs-distress-line tile, and the quality-ladder tension callout
 * (C7) that renders only while `ladderFlags(m).tension` holds. Iteration 1
 * C2 / C3: the panel spans the page (the ladder row is one column), the chart
 * fills the height of the tile stack beside it, and each visible explanation
 * is at most two sentences, the rest behind "Details".
 *
 * Every number is a served field; the only client work is display math on
 * the served points (the plotted window's first and last month).
 */

import type { CSSProperties, ReactNode } from "react";
import { Card, GaugeBar, SectionHeader } from "../../components";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { fmtBpsLevel, fmtMonYr } from "../../lib/format";
import Disclosure from "../shared/Disclosure";
import { HeroChartFrame } from "../shared/HeroChart";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, capStyle, eyebrowStyle, monoNoteStyle } from "../shared/screen-ui";
import { ladderFlags } from "./credit-rules";
import { CREDIT_OAS_IDS } from "../shared/fresh-state";
import { MetaWithStamp, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import type { CreditPanelProps } from "./panel-props";
import SpreadLinesChart from "./SpreadLinesChart";

/** The null-value glyph the ledger prints (U+2014), never an em-dash aside. */
const DASH = "—";

/** The three rungs in ladder order with the mockup swatches (credit.html:187). */
const RUNGS: { label: string; color: string; points: (m: CreditMetrics) => DatedValue[] }[] = [
  { label: "BB", color: "#58b8e6", points: (m) => m.bb_sparkline },
  { label: "B", color: "#b8c6d4", points: (m) => m.b_sparkline },
  { label: "CCC", color: "#f5b52e", points: (m) => m.ccc_sparkline },
];

/* Tile value: 24px 500 in the UI face with tabular figures (mockup .num). */
const tileValue: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 24,
  fontWeight: 500,
  letterSpacing: "-.01em",
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1.1,
  color: "var(--text)",
  marginTop: 4,
};

/** The C16 word for the ratio against the ~3.5× long-run norm (CreditScreen.tsx:447-453, kept). */
export function ratioWord(r: number): "right on" | "near" | "above" | "below" {
  if (Math.abs(r - 3.5) <= 0.1) return "right on";
  if (Math.abs(r - 3.5) <= 0.75) return "near";
  return r > 3.5 ? "above" : "below";
}

/** The plot's floor for a tile width (its preferred height) and its cap. */
const plotFloor = (w: number) => Math.max(180, Math.min(240, Math.round(w * 0.32)));
const PLOT_MAX = 420;

function ChartTile({ m }: { m: CreditMetrics }) {
  const series = RUNGS.map((r) => ({ label: r.label, color: r.color, points: r.points(m) ?? [], lineWidth: 2 as const }));
  const plotted = series.filter((s) => s.points.length > 0);
  // The plotted window: earliest first point and latest last point across the
  // rungs (ISO dates compare as strings); the count is the longest served run.
  const first = plotted.map((s) => s.points[0].date).sort()[0];
  const last = plotted.map((s) => s.points[s.points.length - 1].date).sort().reverse()[0];
  const months = plotted.reduce((n, s) => Math.max(n, s.points.length), 0);
  return (
    <Card variant="tile" padding="12px 16px 8px" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ ...capStyle, marginTop: 0, maxWidth: "none", display: "flex", flexWrap: "wrap", gap: 18, marginBottom: 6 }}>
        {RUNGS.map((r) => (
          <span key={r.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i aria-hidden="true" style={{ display: "inline-block", width: 14, height: 2, background: r.color }} />
            {r.label}
          </span>
        ))}
      </div>
      {plotted.length ? (
        <>
          {/* Iteration 1 C2: the plot takes the height the tile stack beside
              it sets (HeroChartFrame), so no blank band opens under the chart. */}
          <HeroChartFrame
            fallback={{ w: 400, h: 210 }}
            minHeight={(w) => plotFloor(w)}
            maxHeight={() => PLOT_MAX}
          >
            {(box) => (
              <div style={{ width: "100%" }}>
                <SpreadLinesChart series={series} height={box.h} ariaLabel="BB, B and CCC option-adjusted spreads, last six months" />
              </div>
            )}
          </HeroChartFrame>
          <div style={{ ...monoNoteStyle, marginTop: 6 }}>
            {months} months · monthly · {fmtMonYr(first)} to {fmtMonYr(last)}
          </div>
        </>
      ) : (
        <StateNote />
      )}
    </Card>
  );
}

function RatioTile({ m }: { m: CreditMetrics }) {
  const r = m.hy_ig_ratio;
  return (
    <Card variant="tile" padding="12px 16px">
      <div style={eyebrowStyle}>HY / IG ratio</div>
      <div className="num" style={tileValue}>
        {r != null ? `${r.toFixed(2)}×` : DASH}
      </div>
      {r != null ? (
        <Caption>
          High-yield trades at {r.toFixed(2)}× the investment-grade spread, {ratioWord(r)} the ~3.5× long-run norm (2008 peaked at
          8.2×). A rising ratio means the market is punishing weak credits faster than strong ones.
        </Caption>
      ) : null}
    </Card>
  );
}

function DistressTile({ m }: { m: CreditMetrics }) {
  const distressPct = m.ccc_pct_of_distress_line;
  return (
    <Card variant="tile" padding="12px 16px" tone={distressPct != null && distressPct >= 100 ? "risk" : "default"}>
      <div style={eyebrowStyle}>CCC vs distress line</div>
      <div className="num" style={tileValue}>
        {distressPct != null ? `${distressPct.toFixed(1)}%` : DASH}
      </div>
      {distressPct != null && (
        <>
          <GaugeBar
            pct={Math.min(distressPct, 100)}
            height={4}
            color={distressPct >= 100 ? "var(--neg)" : distressPct >= 80 ? "var(--warn-hot)" : "var(--amber)"}
            gutter={false}
            style={{ marginTop: 8 }}
          />
          {distressPct > 100 && (
            <div style={{ ...monoNoteStyle, color: "var(--neg)", marginTop: 3 }}>
              ▲ {(distressPct - 100).toFixed(1)}pp past the line; the bar caps at 100%
            </div>
          )}
        </>
      )}
      <Caption>
        {m.ccc_oas != null && (
          <>
            CCC spreads sit at {fmtBpsLevel(m.ccc_oas)}, {distressPct?.toFixed(0)}% of the
            1,000 bps <Jargon term="distress">distress</Jargon> line. The weakest credits run
            hot even while the broad market reads {m.credit_label} at{" "}
            {m.hy_oas != null ? fmtBpsLevel(m.hy_oas) : `${DASH} bps`}; the two statements are about
            different rungs of the ladder, not a contradiction.
          </>
        )}
      </Caption>
    </Card>
  );
}

/** The C7 callout (CreditScreen.tsx:334-355 before Phase 6). Iteration 1
 * C3 / G4: the first two sentences stay visible; the rest, verbatim, sits
 * behind "Details" on the same card. */
function TensionCallout({ m }: { m: CreditMetrics }): ReactNode {
  const distressPct = m.ccc_pct_of_distress_line;
  if (!ladderFlags(m).tension || m.ccc_oas == null || distressPct == null) return null;
  const prose: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", lineHeight: "var(--lh-body)", color: "var(--text)", margin: "8px 0 0", textWrap: "pretty" };
  const small: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", lineHeight: 1.6, color: "var(--text-2)", margin: "6px 0 0", textWrap: "pretty" };
  return (
    <Card accentBar tone="watch" style={{ marginTop: 12 }}>
      <div style={{ ...eyebrowStyle, color: "var(--amber)" }}>Analytical callout · quality ladder tension</div>
      <p className="mrr-prose" style={prose}>
        The index says {m.credit_label}; the weakest rung says stress. CCC spreads sit at {fmtBpsLevel(m.ccc_oas)},{" "}
        {distressPct.toFixed(0)}% of the 1,000 bps <Jargon term="distress">distress</Jargon> line, while the broad
        high-yield index holds {m.hy_oas != null ? fmtBpsLevel(m.hy_oas) : `${DASH} bps`}.
      </p>
      <Disclosure variant="quiet" title="Details" style={{ marginTop: 4 }}>
        <p className="mrr-prose" style={{ ...small, marginTop: 0 }}>
          Both are true: the two readings describe different rungs of the ladder.
        </p>
        <p className="mrr-prose" style={small}>
          What it means: the market is charging default risk only for the marginal borrower. Watch single-B
          {m.b_oas != null ? ` (${fmtBpsLevel(m.b_oas)} today)` : ""}: stress migrating from CCC into B is how a{" "}
          {m.credit_label} state turns Stressed (HY above 400 bps).
        </p>
      </Disclosure>
    </Card>
  );
}

export default function QualityLadder({ m, status }: CreditPanelProps): JSX.Element {
  const ready = status === "ready" && m != null;
  const report = useFreshReport();
  return (
    <Card as="section" variant="panel" id="quality-ladder" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Quality ladder"
        description="BB, B and CCC spreads"
        right={<MetaWithStamp meta="BB · B · CCC detail · monthly" stamp={<Stamp source={SRC.baml} label={report.group(CREDIT_OAS_IDS, m?.freshness)} />} />}
      />
      {ready && m ? (
        <>
          <div className="mrr-credit-ladder-body">
            <ChartTile m={m} />
            {/* The mockup .stack: the two tiles under each other, beside the
                chart (a 340px column since Iteration 1: at 190px the two
                captions ran 631px tall and left 351px blank under the chart). */}
            <div style={{ display: "grid", gap: "var(--gap-tile)", alignContent: "start", minWidth: 0 }}>
              <RatioTile m={m} />
              <DistressTile m={m} />
            </div>
          </div>
          <TensionCallout m={m} />
        </>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
