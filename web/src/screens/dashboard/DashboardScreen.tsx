/**
 * Dashboard v1 — locked IA: regime hero (banner + read-through + odds bar),
 * KPI strip, monitored signals, 3-row What's Priced teaser (endpoint-pending
 * seam), macro charts in an in-place accordion. Every number is API data;
 * every metric carries a desk-note caption (confusion-index worklist); jargon
 * gets the dotted-underline definition affordance. No fixture data.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Card,
  IntelBanner,
  ProbabilityBar,
  ReadThrough,
  SectionHeader,
  SignalCard,
  StatTile,
} from "../../components";
import {
  useAlerts,
  useCreditOas,
  usePriced,
  useRegimeHistory,
  useRegimeLatest,
  useRecessionProbability,
  useSeriesLatest,
  useSignalsLatest,
} from "../../api/queries";
import { daysSince, fmtBps, fmtDate, fmtMonYr, fmtPct, fmtSigned, fmtWholePct, ordinal } from "../../lib/format";
import type { Regime } from "../../api/types";
import { SIGNALS_META, SIGNAL_ORDER } from "./signals-meta";
import LineChart, { type ChartSeries } from "./LineChart";
import Jargon from "../shared/Jargon";

/* ── small shared bits ─────────────────────────────────────────────────── */

// Captions are secondary copy, not meta — --text-muted keeps them AA-readable
// (5.6:1); --text-faint stays reserved for true meta (timestamps, axis).
const capStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  letterSpacing: ".04em",
  color: "var(--text-muted)",
  lineHeight: 1.5,
  marginTop: 6,
};

const errStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  color: "var(--text-muted)",
};

function Caption({ children }: { children: React.ReactNode }) {
  return <div style={capStyle}>{children}</div>;
}

/* ── regime hero ───────────────────────────────────────────────────────── */

const REGIME_NAMES: Record<string, string> = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  recession: "Recession Risk",
};

function regimeOdds(r: Regime) {
  const probs = {
    goldilocks: r.prob_goldilocks ?? 0,
    overheating: r.prob_overheating ?? 0,
    stagflation: r.prob_stagflation ?? 0,
    recession: r.prob_recession ?? 0,
  };
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  return { probs, lead: ranked[0], runner: ranked[1] };
}

// IntelBanner's contract carries High/Medium/Low (readme also lists Moderate,
// but the component .d.ts is the shippable law — logged in the report).
function convictionWord(c: number): "High" | "Medium" | "Low" {
  if (c >= 0.6) return "High";
  if (c >= 0.4) return "Medium";
  return "Low";
}

/* ── accordion ─────────────────────────────────────────────────────────── */

interface PanelDef {
  id: string;
  title: string;
  right: string;
  body: () => React.ReactNode;
}

function Accordion({ panels, defaultOpenId }: { panels: PanelDef[]; defaultOpenId?: string }) {
  // First panel opens by default: the flagship tab should show at least one
  // time-series without a click (still an in-place accordion per the IA).
  const [openId, setOpenId] = useState<string | null>(defaultOpenId ?? null);
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {panels.map((p) => {
        const open = openId === p.id;
        return (
          <div key={p.id}>
            <button
              onClick={() => setOpenId(open ? null : p.id)}
              aria-expanded={open}
              style={{
                appearance: "none",
                width: "100%",
                textAlign: "left",
                background: "var(--surface)",
                border: "0.5px solid var(--line-hair)",
                borderRadius: "var(--r-xs)",
                padding: "10px 12px",
                cursor: "pointer",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-label)",
                  color: open ? "var(--text)" : "var(--text-2)",
                }}
              >
                <span aria-hidden="true" style={{ color: "var(--text-faint)", marginRight: 8 }}>
                  {open ? "▾" : "▸"}
                </span>
                {p.title}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--fs-micro)",
                  letterSpacing: "var(--ls-micro)",
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                }}
              >
                {p.right}
              </span>
            </button>
            {open && (
              <Card style={{ marginTop: 6, borderRadius: "var(--r-xs)" }}>{p.body()}</Card>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function DashboardScreen() {
  const location = useLocation();
  const regime = useRegimeLatest();
  const history = useRegimeHistory(36);
  const signals = useSignalsLatest();
  const alerts = useAlerts(200);
  const recession = useRecessionProbability();
  const credit = useCreditOas(90);
  const fedFunds = useSeriesLatest("FEDFUNDS");
  const vix = useSeriesLatest("VIXCLS");
  const priced = usePriced();

  // Palette/hash deep links: scroll the section into view once it exists.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [location.hash, regime.data]);

  const streak = useMemo(() => {
    const rows = history.data;
    if (!rows?.length) return null;
    const lead = rows[rows.length - 1].label;
    let n = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].label === lead; i--) n++;
    return n;
  }, [history.data]);

  // IntelBanner pulse gate (owner ruling 2026-08-06): the dot pulses only when
  // this regime read is new to this browser since its last visit, or when the
  // macro month is inside one monthly print cycle (≤35 days). Otherwise static.
  const bannerStamp = regime.data ? `${regime.data.date}|${regime.data.label}` : null;
  const [stampSeenAtLoad] = useState<string | null>(() => {
    try {
      return localStorage.getItem("mrr-intel-seen");
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (!bannerStamp) return;
    try {
      localStorage.setItem("mrr-intel-seen", bannerStamp);
    } catch {
      /* storage unavailable (private mode) — the age gate still works */
    }
  }, [bannerStamp]);
  const bannerLive =
    bannerStamp != null &&
    (stampSeenAtLoad !== bannerStamp || (regime.data != null && daysSince(regime.data.date) <= 35));

  const hy = credit.data?.series.find((s) => s.label === "HY");
  const ig = credit.data?.series.find((s) => s.label === "IG");

  const lastAlertBySignal = useMemo(() => {
    const m = new Map<string, string>();
    alerts.data?.forEach((a) => {
      if (!m.has(a.name)) m.set(a.name, a.date); // feed arrives newest-first
    });
    return m;
  }, [alerts.data]);

  /* hero content */
  let banner: React.ReactNode = null;
  let readThrough: React.ReactNode = null;
  let oddsCard: React.ReactNode = null;
  if (regime.data) {
    const r = regime.data;
    const { probs, lead, runner } = regimeOdds(r);
    const gapPp = Math.round((lead[1] - runner[1]) * 100);
    const readKind =
      gapPp < 10 ? `a coin-flip read against ${REGIME_NAMES[runner[0]]} at ${fmtWholePct(runner[1])}` :
      gapPp < 25 ? `a contested read over ${REGIME_NAMES[runner[0]]} at ${fmtWholePct(runner[1])}` :
      `a clear read — ${REGIME_NAMES[runner[0]]} follows at ${fmtWholePct(runner[1])}`;
    const conviction = convictionWord(r.confidence);

    banner = (
      <IntelBanner
        live={bannerLive}
        conviction={conviction}
        headline={`Markets are in ${r.label} regime at ${fmtWholePct(lead[1])} model odds — ${readKind}, held with ${fmtWholePct(r.confidence)} conviction.`}
        meta={[
          ...(recession.data?.recession_prob != null
            ? [
                {
                  label: "Recession model",
                  value: `${recession.data.recession_prob.toFixed(1)}% · ${recession.data.recession_label}`,
                  color:
                    recession.data.recession_label === "High"
                      ? "var(--neg-text)"
                      : recession.data.recession_label === "Elevated"
                        ? "var(--warn-hot)"
                        : "var(--pos)",
                },
              ]
            : []),
          ...(streak
            ? [{ label: "Duration", value: `${streak}mo`, color: "var(--text)" }]
            : []),
          { label: "Macro data", value: fmtMonYr(r.date), color: "var(--text)" },
        ]}
      />
    );

    oddsCard = (
      <Card>
        <ProbabilityBar probs={probs} height={8} />
        <Caption>
          The model splits its <Jargon term="model odds">odds</Jargon> across the four regimes.{" "}
          {r.label} has led for {streak ?? "—"} month{streak === 1 ? "" : "s"}; the gap to{" "}
          {REGIME_NAMES[runner[0]]} is {gapPp} point{gapPp === 1 ? "" : "s"}
          {gapPp < 10 ? " — inside coin-flip range" : ""}.{" "}
          <Jargon term="conviction">Conviction</Jargon> is a separate number: {fmtWholePct(r.confidence)}.
        </Caption>
      </Card>
    );

    const vixV = vix.data?.value;
    // NB: the API's yield_curve_spread scalar is already in bps (43.0), while
    // its yield_curve_series is in percent (0.43) — inconsistency logged.
    const p1 =
      `The drivers on file: the 10Y–2Y spread holds at ${
        recession.data?.yield_curve_spread != null
          ? `${fmtBps(recession.data.yield_curve_spread)} (${fmtPct(recession.data.yield_curve_spread / 100)})`
          : "—"
      }, the VIX sits at ${vixV != null ? vixV.toFixed(2) : "—"}${
        vixV != null ? (vixV < 15 ? " — calm" : vixV < 25 ? " — subdued" : " — stressed") : ""
      }, and high-yield spreads run ${hy ? `${Math.round(hy.value_bps)} bps` : "—"}${
        hy?.change_1w_bps != null ? ` (${fmtBps(hy.change_1w_bps)} on the week)` : ""
      }. Growth trend reads ${r.growth_trend != null ? fmtSigned(r.growth_trend) : "—"} and inflation trend ${
        r.inflation_trend != null ? fmtSigned(r.inflation_trend) : "—"
      } — both 3-month slopes of z-scored macro data.`;
    const reporting = signals.data?.signals ?? [];
    const bySignal = new Map(reporting.map((s) => [s.signal_name, s]));
    const thr = (name: string, dp = 2) => {
      const t = bySignal.get(name)?.threshold;
      return t != null ? t.toFixed(dp) : "its threshold";
    };
    const triggeredN = reporting.filter((s) => s.triggered).length;
    const watchN = reporting.filter((s) => s.status === "Watch").length;
    const p2 =
      `What would change the read: a CPI print above ${thr("cpi_hot")}% YoY trips Inflation pressure, a 2s10s close below ${thr("yield_curve_inversion")}% trips Curve inversion risk, and a VIX close above ${thr("vix_spike")} trips the vol signal. ` +
      (triggeredN > 0
        ? `${triggeredN} of the ${reporting.length} monitored signals ${triggeredN === 1 ? "is" : "are"} currently triggered.`
        : `None of the ${reporting.length} monitored signals is triggered${
            watchN > 0 ? ` — ${watchN} sit${watchN === 1 ? "s" : ""} in Watch` : ""
          }.`);

    readThrough = (
      <ReadThrough
        label="Current read-through · composed from stored data"
        paragraphs={[p1, p2]}
      />
    );
  }

  /* signals grid */
  const reportingByName = new Map(signals.data?.signals.map((s) => [s.signal_name, s]) ?? []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ── Regime hero ─────────────────────────────────────────────── */}
      <section id="regime-hero" style={{ display: "grid", gap: 12 }}>
        {regime.isLoading && (
          <Card style={{ opacity: 0.4 }}>
            <span style={errStyle}>Reading the latest regime —</span>
          </Card>
        )}
        {regime.isError && (
          <Card>
            <span style={errStyle}>
              Regime unavailable — the data service did not answer. The read resumes when it is
              back.
            </span>
          </Card>
        )}
        {banner}
        {oddsCard}
        {readThrough}
      </section>

      {/* ── Monitored signals (before KPIs, per the locked IA) ──────── */}
      <section id="signals">
        <SectionHeader
          title="Monitored signals"
          right={
            signals.data
              ? `${signals.data.signals.length} monitored · latest ${fmtDate(signals.data.date)}`
              : signals.isError
                ? "signal feed unavailable"
                : "loading"
          }
        />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-muted)",
            margin: "-4px 0 10px",
            letterSpacing: ".04em",
          }}
        >
          Bars show distance to trigger · Clear &lt;50% · Watch ≥50% · Triggered = threshold
          crossed.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
          {SIGNAL_ORDER.map((name) => {
            const meta = SIGNALS_META[name];
            const row = reportingByName.get(name);
            if (row) {
              // Carried-forward prints state their true month (monthly signals
              // between releases) instead of dropping out — DESIGN.md's
              // latest-available-with-its-date rule, now server-enforced.
              const carried = row.date !== signals.data?.date;
              return (
                <div key={name}>
                  <SignalCard
                    name={meta.display}
                    value={meta.format(row.value)}
                    fillPct={row.distance_pct ?? 0}
                    status={row.status ?? undefined}
                    lastTriggered={lastAlertBySignal.get(name) ?? "none on file"}
                  />
                  <Caption>
                    {meta.trigger(row.threshold)}
                    {carried ? ` As of ${fmtMonYr(row.date)} · ${meta.cadence} pending.` : ""}
                  </Caption>
                </div>
              );
            }
            return (
              <div key={name}>
                <Card style={{ minHeight: 118 }}>
                  <div
                    style={{
                      fontSize: "var(--fs-body-s)",
                      fontWeight: 500,
                      color: "var(--text)",
                      marginBottom: 6,
                    }}
                  >
                    {meta.display}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-meta)",
                      color: "var(--text-muted)",
                      lineHeight: 1.6,
                    }}
                  >
                    No print on file yet — this signal has no stored history.
                  </div>
                </Card>
                <Caption>{meta.trigger(null)}</Caption>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── KPI strip ───────────────────────────────────────────────── */}
      <section id="key-levels">
        <SectionHeader
          title="Key levels"
          right={credit.data?.as_of ? `FRED · latest ${fmtDate(credit.data.as_of)}` : "FRED"}
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          <Card accentBar tone={recession.data?.recession_label.includes("High") ? "risk" : recession.data?.recession_label.includes("Elevated") ? "watch" : "clear"}>
            <StatTile
              label="Recession model · 12m"
              value={
                recession.data?.recession_prob != null
                  ? `${recession.data.recession_prob.toFixed(1)}%`
                  : recession.isError
                    ? "—"
                    : "…"
              }
              size="sm"
            />
            <Caption>
              {recession.data?.recession_prob != null ? (
                <>
                  {recession.data.recession_prob.toFixed(1)}% sits in the{" "}
                  {recession.data.recession_label} band — Elevated starts at 20%, High at 40%. The{" "}
                  <Jargon term="recession model">model</Jargon> trains on{" "}
                  <Jargon term="NBER">NBER</Jargon> dates; inputs through{" "}
                  {fmtMonYr(recession.data.data_as_of)}.
                </>
              ) : recession.isError ? (
                "Recession model unavailable — its endpoint trains in-process and may need a warm start."
              ) : (
                "Training the recession model — first call takes about a second."
              )}
            </Caption>
          </Card>

          <Card accentBar tone={recession.data?.is_inverted ? "risk" : "clear"}>
            <StatTile
              label="Yield curve 2s10s"
              value={
                recession.data?.yield_curve_spread != null
                  ? fmtBps(recession.data.yield_curve_spread)
                  : "—"
              }
              size="sm"
            />
            <Caption>
              {recession.data?.yield_curve_spread != null ? (
                <>
                  The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at{" "}
                  {fmtBps(recession.data.yield_curve_spread)} (
                  {fmtPct(recession.data.yield_curve_spread / 100)})
                  {recession.data.yield_curve_pct_rank != null
                    ? ` — the ${ordinal(recession.data.yield_curve_pct_rank)} percentile of the model's monthly history`
                    : ""}
                  . Below 0 is an inversion, the classic pre-recession shape.
                </>
              ) : (
                "Curve data arrives with the recession model response."
              )}
            </Caption>
          </Card>

          <Card accentBar tone="default">
            <StatTile
              label="Model vs market"
              value={recession.data?.divergence_label ?? "—"}
              size="sm"
            />
            <Caption>
              <Jargon term="divergence">Divergence check</Jargon>: whether the recession model and
              market risk pricing tell one story.
            </Caption>
          </Card>
        </div>

        <Card style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 16, marginTop: 12 }}>
          <div>
            <StatTile
              label="Fed Funds"
              value={fedFunds.data ? fmtPct(fedFunds.data.value) : "—"}
            />
            <Caption>
              Overnight policy rate · monthly average
              {fedFunds.data ? ` · ${fmtMonYr(fedFunds.data.date)}` : ""}.
            </Caption>
          </div>
          <div>
            <StatTile
              label="10Y Treasury"
              value={(() => {
                const t = credit.data?.series.find((s) => s.label === "UST10Y");
                return t ? fmtPct(t.value_pct) : "—";
              })()}
              delta={(() => {
                const t = credit.data?.series.find((s) => s.label === "UST10Y");
                return t?.change_1w_bps != null ? `${fmtBps(t.change_1w_bps)} 1w` : undefined;
              })()}
              direction={(() => {
                const t = credit.data?.series.find((s) => s.label === "UST10Y");
                return t?.change_1w_bps != null && t.change_1w_bps >= 0 ? "up" : "down";
              })()}
            />
            <Caption>Benchmark long rate · daily close.</Caption>
          </div>
          <div>
            <StatTile label="VIX" value={vix.data ? vix.data.value.toFixed(2) : "—"} />
            <Caption>
              <Jargon term="VIX">VIX</Jargon> · daily close
              {vix.data ? ` · ${fmtDate(vix.data.date)}` : ""}.
            </Caption>
          </div>
          <div>
            <StatTile
              label="Growth trend"
              value={regime.data?.growth_trend != null ? fmtSigned(regime.data.growth_trend) : "—"}
              direction={
                regime.data?.growth_trend != null && regime.data.growth_trend >= 0 ? "up" : "down"
              }
            />
            <Caption>
              3-month slope of the industrial-production <Jargon term="z-score">z-score</Jargon> —
              feeds the regime call.
            </Caption>
          </div>
          <div>
            <StatTile
              label="Inflation trend"
              value={
                regime.data?.inflation_trend != null ? fmtSigned(regime.data.inflation_trend) : "—"
              }
              direction={
                regime.data?.inflation_trend != null && regime.data.inflation_trend >= 0
                  ? "up"
                  : "down"
              }
            />
            <Caption>
              3-month slope of the CPI <Jargon term="z-score">z-score</Jargon> — feeds the regime
              call.
            </Caption>
          </div>
        </Card>
      </section>

      {/* ── What's Priced teaser (single home is Markets — locked IA) ── */}
      <section id="whats-priced">
        <SectionHeader title="What's priced" right="3-row teaser · full table in Markets" />
        <Card>
          {(() => {
            // One row per group; SOFR stands in for policy because Fed Funds
            // already sits on the KPI strip above (no number twice on one tab).
            const rows = ["SOFR", "T10YIE", "DFII10"]
              .map((m) => priced.data?.find((p) => p.metric === m))
              .filter((p): p is NonNullable<typeof p> => p != null);
            if (!rows.length) {
              return (
                <div style={{ fontSize: "var(--fs-body-s)", color: "var(--text-muted)", lineHeight: 1.6 }}>
                  {priced.isError
                    ? "Market-implied pricing unavailable — the data service did not answer."
                    : priced.isLoading
                      ? "Reading market-implied pricing —"
                      : "No priced metrics on file — the weekly pipeline has not written them yet."}
                </div>
              );
            }
            return (
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((p) => (
                  <div
                    key={p.metric}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      gap: 12,
                      borderBottom: "0.5px solid var(--line-hair)",
                      paddingBottom: 8,
                    }}
                  >
                    <span style={{ fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                      {p.label}
                      <span style={{ color: "var(--text-muted)" }}> · {p.group.toLowerCase()}</span>
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontVariantNumeric: "tabular-nums",
                        fontSize: "var(--fs-body)",
                        fontWeight: 700,
                        color: "var(--text)",
                      }}
                    >
                      {p.value.toFixed(2)}
                      {p.unit}
                      {p.mom_chg != null && (
                        <span
                          style={{
                            marginLeft: 8,
                            fontWeight: 400,
                            fontSize: "var(--fs-body-s)",
                            color: p.mom_chg >= 0 ? "var(--pos)" : "var(--neg-text)",
                          }}
                        >
                          {fmtSigned(p.mom_chg)}
                          {/* change of a percent-level series is pp, not % */}
                          {p.unit === "%" ? "pp" : p.unit} MoM
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                <Caption>
                  The market&apos;s own pricing — <Jargon term="breakeven">breakevens</Jargon> for
                  expected inflation, <Jargon term="TIPS">TIPS</Jargon> for real yields. All six
                  metrics with the policy rate sit in Markets.
                </Caption>
              </div>
            );
          })()}
          <div style={{ marginTop: 10 }}>
            <Link
              to="/app/markets#whats-priced-full"
              style={{ fontSize: "var(--fs-body-s)", color: "var(--accent)" }}
            >
              → See all in Markets
            </Link>
          </div>
        </Card>
      </section>

      {/* ── Macro charts accordion ──────────────────────────────────── */}
      <section id="macro-charts">
        <SectionHeader title="Macro charts" right="4 series · in-place accordion" />
        <Accordion
          defaultOpenId="chart-regime"
          panels={[
            {
              id: "chart-regime",
              title: "Regime odds · 24 months",
              right: history.data ? `${Math.min(history.data.length, 24)} monthly reads` : "—",
              body: () => {
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
                      yFmt={(v) => `${Math.round(v)}%`}
                      caption="Monthly regime odds"
                    />
                    <Caption>
                      The classifier&apos;s monthly odds per regime — the call is whichever line is
                      on top; crossovers are regime changes.
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
              body: () => (
                <>
                  <LineChart
                    series={[
                      {
                        label: "2s10s",
                        color: "var(--accent)",
                        points: (recession.data?.yield_curve_series ?? []).map((p) => ({
                          x: p.date,
                          y: p.value,
                        })),
                      },
                    ]}
                    yFmt={(v) => fmtPct(v)}
                    caption="10Y minus 2Y Treasury spread"
                  />
                  <Caption>
                    Dips below the dashed zero line are inversions — the shape that has preceded
                    most US recessions.
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
              body: () => (
                <>
                  <LineChart
                    series={[
                      {
                        label: "P(recession, 12m)",
                        color: "var(--warn-hot)",
                        points: (recession.data?.recession_prob_series ?? []).map((p) => ({
                          x: p.date,
                          y: p.value,
                        })),
                      },
                    ]}
                    yFmt={(v) => `${v.toFixed(0)}%`}
                    caption="Recession model probability history"
                  />
                  <Caption>
                    Monthly stored series — Elevated starts at 20%, High at 40%. The model&apos;s
                    current call is {recession.data?.recession_prob?.toFixed(1) ?? "—"}% (the KPI
                    card above); the plotted tail can differ while a month is partial.
                  </Caption>
                </>
              ),
            },
            {
              id: "chart-credit",
              title: "Credit spreads · 90 days",
              right: credit.data?.as_of ? `latest ${fmtDate(credit.data.as_of)}` : "—",
              body: () => (
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
                    <Jargon term="OAS">Option-adjusted spreads</Jargon>:{" "}
                    <Jargon term="high-yield">high-yield</Jargon> at{" "}
                    {hy ? `${Math.round(hy.value_bps)} bps` : "—"}, investment-grade at{" "}
                    {ig ? `${Math.round(ig.value_bps)} bps` : "—"} — spreads widen when credit
                    stress builds. FRED BAML series, monthly observations.
                  </Caption>
                </>
              ),
            },
          ]}
        />
      </section>
    </div>
  );
}
