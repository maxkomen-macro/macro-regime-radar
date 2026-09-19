/**
 * Curve monitor, `<section id="curve">` (redesign Phase 7, checklist 07 B.4):
 * the daily 2s10s LineChart behind a 5Y / 10Y / 30Y mono Segmented (a date
 * slice of the served series, G18; the window lives in the screen so
 * useHashScroll can wait on it), NBER recessions shaded, the "Inversion
 * below 0" rule key under the plot (Iteration 1 G1: off the svg), the X14
 * caption, and the "Current curve shape" tile listing today's stored tenors
 * and the served 2s10s reading (F2: no year-ago tenor levels are served, so
 * no dashed second series, no steepener badge and no comparison caption).
 * The plot fills its tile's height through HeroChartFrame (G2).
 *
 * Every number is served; the only client work is the date slice.
 */

import { Card, SectionHeader, Segmented } from "../../components";
import type { RecessionMetrics } from "../../api/types";
import { ordinal } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import LineChart from "../dashboard/LineChart";
import { HeroChartFrame } from "../shared/HeroChart";
import Jargon from "../shared/Jargon";
import { Caption, MISSING, StateNote, capStyle, eyebrowStyle, mono } from "../shared/screen-ui";
import { TENOR_ORDER, lastYears, usrecBands } from "./recession-copy";
import type { CurveMonitorProps, CurveWindow } from "./panel-props";

/** The null-value glyph the captions print (U+2014), never an em-dash aside. */
const DASH = "—";

const WINDOWS: { id: CurveWindow; label: string; years: number | null; words: string }[] = [
  { id: "5y", label: "5Y", years: 5, words: "5-year" },
  { id: "10y", label: "10Y", years: 10, words: "10-year" },
  { id: "30y", label: "30Y", years: null, words: "30-year" },
];

/** Non-plot height of LineChart around its svg (the legend row above, the
 * date and range rows below), reserved when sizing the plot to its frame. A
 * narrow tile wraps the legend onto a second line. */
const chartChrome = (w: number) => (w < 420 ? 84 : 64);
/** The plot's floor (its preferred height for the tile width, 170 to 230 px)
 * and its cap, in rendered px. */
const PLOT_MIN = 170;
const plotFloor = (w: number) => Math.max(PLOT_MIN, Math.min(230, Math.round(w * 0.25)));
const PLOT_MAX = 320;

function ChartTile({ m, range }: { m: RecessionMetrics; range: CurveWindow }): JSX.Element {
  const w = WINDOWS.find((x) => x.id === range) ?? WINDOWS[2];
  const points = lastYears(m.yield_curve_series, w.years).map((p) => ({ x: p.date, y: p.value }));
  // LineChart draws a 720-unit viewBox (360 under 768) at 100% width, so its
  // rendered height is width × height / viewBox width. The frame hands the
  // chart its box and the viewBox height is solved for the plot to fill it
  // (Iteration 1 G2): beside the curve-shape tile the plot takes the row's
  // height instead of leaving blank under the shorter tile.
  const vbW = useBreakpoint().isNarrow ? 360 : 720;
  const values = points.map((p) => p.y).filter((y) => Number.isFinite(y));
  // The rule label sits in the key row outside the plot (G1): an HTML label
  // drawn over the svg overlapped it. The dashed rule itself is LineChart's.
  const crossesZero = values.length > 0 && Math.min(...values) <= 0 && Math.max(...values) >= 0;
  return (
    <Card variant="tile" padding="12px 16px 8px" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <HeroChartFrame
        fallback={{ w: 720, h: 220 + 64 }}
        minHeight={(fw) => chartChrome(fw) + plotFloor(fw)}
        maxHeight={(fw) => chartChrome(fw) + PLOT_MAX}
      >
        {(box) => {
          const plotH = Math.max(PLOT_MIN, box.h - chartChrome(box.w));
          const vbH = Math.max(60, Math.round((plotH * vbW) / Math.max(box.w, 1)));
          return (
            <div style={{ width: "100%" }}>
              <LineChart
                series={[{ label: "2s10s spread", color: "var(--link)", points }]}
                height={vbH}
                yFmt={(v) => `${v.toFixed(2)}%`}
                bands={usrecBands(m.usrec_series)}
                hlines={[{ y: 0 }]}
                caption={`10Y minus 2Y Treasury spread, ${w.words} history, NBER recessions shaded`}
              />
            </div>
          );
        }}
      </HeroChartFrame>
      {crossesZero ? (
        <div style={{ ...capStyle, maxWidth: "none", marginTop: 4, display: "flex", alignItems: "center", gap: 6 }}>
          <i aria-hidden="true" style={{ display: "inline-block", width: 16, borderTop: "1px dashed var(--line-strong)" }} />
          <span>Inversion below 0</span>
        </div>
      ) : null}
      {/* X14 caption (RecessionScreen.tsx:376-380 before Phase 7), verbatim. */}
      <Caption>
        Below the dashed zero line the curve is inverted: short money costs more than long
        money, which only happens when markets expect cuts ahead. Every shaded recession was
        preceded by a dip below zero.
      </Caption>
    </Card>
  );
}

function ShapeRow({ k, v }: { k: string; v: string }): JSX.Element {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "0.5px solid var(--line-hair)", paddingBottom: 4 }}>
      <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>{k}</span>
      <span style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, color: "var(--text)" }}>{v}</span>
    </div>
  );
}

function ShapeTile({ m }: { m: RecessionMetrics }): JSX.Element {
  const spreadBps = m.yield_curve_spread;
  const stored = TENOR_ORDER.flatMap((t) => {
    const v = m.curve_shape[t];
    return v != null ? [[t, v] as const] : [];
  });
  const missing = TENOR_ORDER.filter((t) => m.curve_shape[t] == null);
  const twoY = m.curve_shape["2Y"];
  const tenY = m.curve_shape["10Y"];
  return (
    <Card variant="tile" padding="14px 16px 10px" style={{ minWidth: 0 }}>
      <div style={eyebrowStyle}>Current curve shape</div>
      <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
        {stored.map(([t, v]) => (
          <ShapeRow key={t} k={t} v={`${v.toFixed(2)}%`} />
        ))}
        {/* The served 2s10s reading beside the tenors (Iteration 1 G2): the
            spread, its 30-year percentile and the inversion state, the
            fields the summary's Curve row prints. */}
        {spreadBps != null ? <ShapeRow k="2s10s" v={`${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps`} /> : null}
        {m.yield_curve_pct_rank != null ? <ShapeRow k="Percentile · 30y" v={ordinal(m.yield_curve_pct_rank)} /> : null}
        {m.is_inverted != null ? (
          <ShapeRow k="Inverted" v={m.is_inverted ? (m.inversion_duration_months != null ? `${m.inversion_duration_months} months` : "Yes") : "No"} />
        ) : null}
        {/* The honesty note (RecessionScreen.tsx:393-398 before Phase 7), verbatim. */}
        {missing.length ? (
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-3)", lineHeight: 1.5, marginTop: 4 }}>
            Not stored: {missing.join(" · ")}. The model reads the daily FRED 2Y and 10Y series only; other tenors are outside its inputs by design.
          </div>
        ) : null}
      </div>
      {/* X15 caption (RecessionScreen.tsx:400-413 before Phase 7), verbatim. */}
      <Caption>
        {stored.length === 2 && twoY != null && tenY != null ? (
          <>
            Two stored <Jargon term="tenor">tenors</Jargon>: 2Y at {twoY.toFixed(2)}% and 10Y at {tenY.toFixed(2)}%, a{" "}
            {spreadBps != null ? `${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps` : DASH}{" "}
            {spreadBps != null && spreadBps >= 0 ? "upward" : "inverted"} slope.
          </>
        ) : (
          <>
            {stored.length} stored <Jargon term="tenor">tenors</Jargon> with daily FRED coverage.
          </>
        )}
      </Caption>
    </Card>
  );
}

export default function CurveMonitor({ m, status, range, onRangeChange }: CurveMonitorProps): JSX.Element {
  const ready = status === "ready" && m != null;
  return (
    <Card as="section" variant="panel" id="curve" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Curve monitor"
        description="2s10s daily, 30 years stored, recessions shaded"
        right="FRED · daily"
        actions={
          <Segmented
            mono
            label="Curve window"
            options={WINDOWS.map(({ id, label }) => ({ id, label }))}
            value={range}
            onChange={(id) => onRangeChange(id as CurveWindow)}
          />
        }
      />
      {ready && m ? (
        <div className="mrr-rec-curve">
          <ChartTile m={m} range={range} />
          <ShapeTile m={m} />
        </div>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} missing={MISSING.recession} />
        </Card>
      )}
    </Card>
  );
}
