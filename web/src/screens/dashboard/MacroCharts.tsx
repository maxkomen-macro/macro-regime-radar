/**
 * Macro charts (redesign Phase 3, checklist 03 B.8): the in-place accordion
 * and its LineChart panels, moved from DashboardScreen. All panels are closed
 * by default (section 0.5 "collapsed section below the calendar row");
 * `#macro-charts` in the URL opens the first so a palette jump shows a chart.
 * Panel ids, titles, meta, bodies and captions are unchanged.
 *
 * Iteration 1 (D1): the "Regime odds · 24 months" panel left the accordion
 * for the hero's chart slot (RegimeOddsChart, a stacked view of the same
 * stored odds), so the chart appears once on the page; three panels remain
 * and the first is now the 2s10s curve.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { Card, SectionHeader } from "../../components";
import type { CreditOAS, RecessionMetrics } from "../../api/types";
import { fmtBpsLevel, fmtMonYr, fmtPct, fmtProb, pctToBps } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, mono } from "../shared/screen-ui";
import { CREDIT_OAS_IDS } from "../shared/fresh-state";
import { Metric, SRC, Stamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import LineChart from "./LineChart";

export const MACRO_CHARTS_HASH = "#macro-charts";
export const FIRST_CHART_ID = "chart-curve";

/** The panel a hash asks for: `#macro-charts` opens the first chart. */
export function chartFromHash(hash: string): string | null {
  return hash === MACRO_CHARTS_HASH ? FIRST_CHART_ID : null;
}

export interface MacroChartsProps {
  recession: UseQueryResult<RecessionMetrics>;
  credit: UseQueryResult<CreditOAS>;
  /** Reports the open panel so the screen can re-run its hash scroll once a chart is on the page. */
  onOpenChange?: (openId: string | null) => void;
}

/* ── accordion ─────────────────────────────────────────────────────────── */

interface PanelDef {
  id: string;
  title: string;
  right: string;
  body: () => React.ReactNode;
}

function Accordion({
  panels,
  defaultOpenId,
  requestedOpenId,
  onOpenChange,
}: {
  panels: PanelDef[];
  defaultOpenId?: string;
  /** Opens this panel whenever it changes (the hash-driven open). */
  requestedOpenId?: string | null;
  onOpenChange?: (openId: string | null) => void;
}) {
  // No panel opens by default (section 0.5 collapsed section); a hash jump
  // requests one so the palette still lands on a chart.
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  useEffect(() => {
    if (requestedOpenId) setOpenId(requestedOpenId);
  }, [requestedOpenId]);
  useEffect(() => {
    onOpenChange?.(openId);
  }, [openId, onOpenChange]);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {panels.map((p) => {
        const open = openId === p.id;
        return (
          <div key={p.id}>
            <button
              onClick={() => setOpenId(open ? null : p.id)}
              aria-expanded={open}
              aria-controls={`${p.id}-panel`}
              style={{
                appearance: "none",
                width: "100%",
                textAlign: "left",
                background: "var(--surface)",
                border: "0.5px solid var(--line-hair)",
                borderRadius: "var(--r-xs)",
                padding: "10px 12px",
                minHeight: 40,
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body-s)",
                  fontWeight: 500,
                  color: open ? "var(--text)" : "var(--text-2)",
                }}
              >
                <span aria-hidden="true" style={{ ...mono, color: "var(--text-muted)", marginRight: 8 }}>
                  {open ? "▾" : "▸"}
                </span>
                {p.title}
              </span>
              <span
                style={{
                  ...mono,
                  fontSize: "var(--fs-meta)",
                  letterSpacing: "var(--ls-micro)",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {p.right}
              </span>
            </button>
            <div id={`${p.id}-panel`} hidden={!open}>
              {open && <Card style={{ marginTop: 6, borderRadius: "var(--r-xs)" }}>{p.body()}</Card>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── section ───────────────────────────────────────────────────────────── */

export default function MacroCharts({ recession, credit, onOpenChange }: MacroChartsProps) {
  const location = useLocation();
  const requested = chartFromHash(location.hash);
  const hy = credit.data?.series.find((s) => s.label === "HY");
  const ig = credit.data?.series.find((s) => s.label === "IG");
  // A1: each chart names its source and as-of under its caption.
  const report = useFreshReport();

  return (
    <Card as="section" id="macro-charts" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Macro charts" right="3 series · in-place accordion" />
      <Accordion
        defaultOpenId={requested ?? undefined}
        requestedOpenId={requested}
        onOpenChange={onOpenChange}
        panels={[
          {
            id: "chart-curve",
            title: "Yield curve 2s10s · model history",
            right:
              recession.data?.yield_curve_series.length != null
                ? `${recession.data.yield_curve_series.length} monthly points`
                : "—",
            body: () =>
              recession.isLoading ? (
                <Caption>Training the recession model; the first call takes about a second…</Caption>
              ) : (
                <>
                  <LineChart
                    series={[
                      {
                        label: "2s10s",
                        color: "var(--link)",
                        points: (recession.data?.yield_curve_series ?? []).map((p) => ({ x: p.date, y: p.value })),
                      },
                    ]}
                    yFmt={(v) => fmtPct(v)}
                    caption="10Y minus 2Y Treasury spread"
                  />
                  <Caption>
                    Dips below the dashed zero line are inversions: the shape that has preceded most US recessions.
                  </Caption>
                  <Stamp block source={SRC.fred} label={report.group(["DGS10", "DGS2"], recession.data?.freshness)} />
                </>
              ),
          },
          {
            id: "chart-recession",
            title: "Recession model probability · history",
            right:
              recession.data?.recession_prob_series.length != null
                ? `${recession.data.recession_prob_series.length} monthly points`
                : "—",
            body: () =>
              recession.isLoading ? (
                <Caption>Training the recession model; the first call takes about a second…</Caption>
              ) : (
                <>
                  <LineChart
                    series={[
                      {
                        label: "P(recession, 12m)",
                        color: "var(--warn-hot)",
                        points: (recession.data?.recession_prob_series ?? []).map((p) => ({ x: p.date, y: p.value })),
                      },
                    ]}
                    yFmt={(v) => `${v.toFixed(0)}%`}
                    caption="Recession model probability history"
                  />
                  <Caption>
                    Monthly stored series. Elevated starts at 20%, High at 40%. The model&apos;s current call is{" "}
                    <Metric id="recession-prob" value={recession.data?.recession_prob}>
                      {fmtProb(recession.data?.recession_prob, "percent", 1)}
                    </Metric>{" "}
                    (the evidence card above); the plotted tail can differ while a month is partial.
                  </Caption>
                  <Stamp block source={SRC.recession} asOf={recession.data ? fmtMonYr(recession.data.data_as_of) : null} />
                </>
              ),
          },
          {
            id: "chart-credit",
            title: "Credit spreads · 90 days",
            // The stored rows are month-stamped (FRED daily, B6): the panel's
            // as-of is the stamp under the chart, never "latest <row date>".
            right: credit.data ? "ICE BofA via FRED" : "—",
            body: () =>
              credit.isLoading ? (
                <Caption>Reading credit spreads…</Caption>
              ) : (
                <>
                  <LineChart
                    series={[
                      {
                        label: "IG",
                        color: "var(--link)",
                        points: (ig?.history ?? []).map((p) => ({ x: p.date, y: pctToBps(p.value) })),
                      },
                      {
                        label: "HY",
                        color: "var(--warn-hot)",
                        points: (hy?.history ?? []).map((p) => ({ x: p.date, y: pctToBps(p.value) })),
                      },
                    ]}
                    yFmt={(v) => fmtBpsLevel(v)}
                    caption="IG and HY option-adjusted spreads"
                  />
                  <Caption>
                    <Jargon term="OAS">Option-adjusted spreads</Jargon>: <Jargon term="high-yield">high-yield</Jargon> at{" "}
                    {hy ? (
                      <Metric id="hy-oas" value={hy.value_pct}>
                        {fmtBpsLevel(hy.value_bps)}
                      </Metric>
                    ) : (
                      "—"
                    )}
                    , investment-grade at {ig ? fmtBpsLevel(ig.value_bps) : "—"}; spreads widen when credit stress builds. FRED BAML series,
                    monthly observations.
                  </Caption>
                  <Stamp block source={SRC.baml} label={report.group(CREDIT_OAS_IDS, credit.data?.freshness)} />
                </>
              ),
          },
        ]}
      />
    </Card>
  );
}
