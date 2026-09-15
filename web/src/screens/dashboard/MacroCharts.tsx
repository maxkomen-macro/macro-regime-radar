/**
 * Macro charts (redesign Phase 3, checklist 03 B.8): the in-place accordion
 * and its four LineChart panels, moved from DashboardScreen. All four panels
 * are closed by default (section 0.5 "collapsed section below the calendar
 * row"); `#macro-charts` in the URL opens the first so a palette jump shows a
 * chart. Panel ids, titles, meta, bodies and captions are unchanged.
 */

import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { Card, SectionHeader } from "../../components";
import type { CreditOAS, RecessionMetrics, Regime } from "../../api/types";
import { fmtDate, fmtPct } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, mono } from "../shared/screen-ui";
import LineChart, { type ChartSeries } from "./LineChart";

export const MACRO_CHARTS_HASH = "#macro-charts";
export const FIRST_CHART_ID = "chart-regime";

/** The panel a hash asks for: `#macro-charts` opens the first chart. */
export function chartFromHash(hash: string): string | null {
  return hash === MACRO_CHARTS_HASH ? FIRST_CHART_ID : null;
}

export interface MacroChartsProps {
  /** `useRegimeHistory(36)` from the screen (sliced to 24 here). */
  history: UseQueryResult<Regime[]>;
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

export default function MacroCharts({ history, recession, credit, onOpenChange }: MacroChartsProps) {
  const location = useLocation();
  const requested = chartFromHash(location.hash);
  const hy = credit.data?.series.find((s) => s.label === "HY");
  const ig = credit.data?.series.find((s) => s.label === "IG");

  return (
    <Card as="section" id="macro-charts" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader layout="panel" title="Macro charts" right="4 series · in-place accordion" />
      <Accordion
        defaultOpenId={requested ?? undefined}
        requestedOpenId={requested}
        onOpenChange={onOpenChange}
        panels={[
          {
            id: "chart-regime",
            title: "Regime odds · 24 months",
            right: history.data ? `${Math.min(history.data.length, 24)} monthly reads` : "—",
            body: () => {
              if (history.isLoading) return <Caption>Reading the stored classifier history…</Caption>;
              if (history.isError) return <Caption>Regime history unavailable: the data service did not answer.</Caption>;
              const rows = (history.data ?? []).slice(-24);
              const mk = (key: keyof Regime, label: string, color: string): ChartSeries => ({
                label,
                color,
                points: rows.map((r) => ({ x: r.date, y: ((r[key] as number | null) ?? 0) * 100 })),
              });
              return (
                <>
                  <LineChart
                    series={[
                      mk("prob_goldilocks", "GL", "var(--regime-goldilocks)"),
                      mk("prob_overheating", "OV", "var(--regime-overheating)"),
                      mk("prob_stagflation", "ST", "var(--regime-stagflation)"),
                      mk("prob_recession", "RR", "var(--regime-recession)"),
                    ]}
                    yFmt={(v) => (v > 0 && v < 1 ? "<1%" : `${Math.round(v)}%`)}
                    caption="Monthly regime odds"
                  />
                  <Caption>
                    The classifier&apos;s monthly odds per regime. The call is whichever line is on top; crossovers are
                    regime changes.
                  </Caption>
                </>
              );
            },
          },
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
                        color: "var(--accent)",
                        points: (recession.data?.yield_curve_series ?? []).map((p) => ({ x: p.date, y: p.value })),
                      },
                    ]}
                    yFmt={(v) => fmtPct(v)}
                    caption="10Y minus 2Y Treasury spread"
                  />
                  <Caption>
                    Dips below the dashed zero line are inversions: the shape that has preceded most US recessions.
                  </Caption>
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
                    {recession.data?.recession_prob?.toFixed(1) ?? "—"}% (the evidence card above); the plotted tail can
                    differ while a month is partial.
                  </Caption>
                </>
              ),
          },
          {
            id: "chart-credit",
            title: "Credit spreads · 90 days",
            right: credit.data?.as_of ? `latest ${fmtDate(credit.data.as_of)}` : "—",
            body: () =>
              credit.isLoading ? (
                <Caption>Reading credit spreads…</Caption>
              ) : (
                <>
                  <LineChart
                    series={[
                      {
                        label: "IG",
                        color: "var(--accent)",
                        points: (ig?.history ?? []).map((p) => ({ x: p.date, y: p.value * 100 })),
                      },
                      {
                        label: "HY",
                        color: "var(--warn-hot)",
                        points: (hy?.history ?? []).map((p) => ({ x: p.date, y: p.value * 100 })),
                      },
                    ]}
                    yFmt={(v) => `${Math.round(v)} bps`}
                    caption="IG and HY option-adjusted spreads"
                  />
                  <Caption>
                    <Jargon term="OAS">Option-adjusted spreads</Jargon>: <Jargon term="high-yield">high-yield</Jargon> at{" "}
                    {hy ? `${Math.round(hy.value_bps)} bps` : "—"}, investment-grade at{" "}
                    {ig ? `${Math.round(ig.value_bps)} bps` : "—"}; spreads widen when credit stress builds. FRED BAML series,
                    monthly observations.
                  </Caption>
                </>
              ),
          },
        ]}
      />
    </Card>
  );
}
