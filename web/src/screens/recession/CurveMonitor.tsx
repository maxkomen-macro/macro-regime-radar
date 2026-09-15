/**
 * Curve monitor, `<section id="curve">` (redesign Phase 7, checklist 07 B.4):
 * the daily 2s10s LineChart behind a 5Y / 10Y / 30Y mono Segmented (a date
 * slice of the served series, G18; the window lives in the screen so
 * useHashScroll can wait on it), NBER recessions shaded, the "Inversion
 * below 0" rule label, the X14 caption, and the "Current curve shape" tile
 * listing today's stored tenors only (F2: no year-ago tenor levels are
 * served, so no dashed second series, no steepener badge and no comparison
 * caption).
 *
 * Every number is served; the only client work is the date slice.
 */

import { Card, SectionHeader, Segmented } from "../../components";
import type { RecessionMetrics } from "../../api/types";
import LineChart from "../dashboard/LineChart";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, eyebrowStyle, mono } from "../shared/screen-ui";
import { TENOR_ORDER, lastYears, usrecBands } from "./recession-copy";
import type { CurveMonitorProps, CurveWindow } from "./panel-props";

/** The null-value glyph the captions print (U+2014), never an em-dash aside. */
const DASH = "—";

const WINDOWS: { id: CurveWindow; label: string; years: number | null; words: string }[] = [
  { id: "5y", label: "5Y", years: 5, words: "5-year" },
  { id: "10y", label: "10Y", years: 10, words: "10-year" },
  { id: "30y", label: "30Y", years: null, words: "30-year" },
];

function ChartTile({ m, range }: { m: RecessionMetrics; range: CurveWindow }): JSX.Element {
  const w = WINDOWS.find((x) => x.id === range) ?? WINDOWS[2];
  const points = lastYears(m.yield_curve_series, w.years).map((p) => ({ x: p.date, y: p.value }));
  return (
    <Card variant="tile" padding="12px 16px 8px" style={{ minWidth: 0 }}>
      <LineChart
        series={[{ label: "2s10s spread", color: "var(--link)", points }]}
        height={220}
        yFmt={(v) => `${v.toFixed(2)}%`}
        bands={usrecBands(m.usrec_series)}
        // LineChart draws the dashed zero line itself when the range crosses
        // zero; this entry adds the mockup's words as the overlay label (G7).
        hlines={[{ y: 0, label: "Inversion below 0" }]}
        caption={`10Y minus 2Y Treasury spread, ${w.words} history, NBER recessions shaded`}
      />
      {/* X14 caption (RecessionScreen.tsx:376-380 before Phase 7), verbatim. */}
      <Caption>
        Below the dashed zero line the curve is inverted: short money costs more than long
        money, which only happens when markets expect cuts ahead. Every shaded recession was
        preceded by a dip below zero.
      </Caption>
    </Card>
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
          <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 8, borderBottom: "0.5px solid var(--line-hair)", paddingBottom: 4 }}>
            <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>{t}</span>
            <span style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, color: "var(--text)" }}>{v.toFixed(2)}%</span>
          </div>
        ))}
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
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
