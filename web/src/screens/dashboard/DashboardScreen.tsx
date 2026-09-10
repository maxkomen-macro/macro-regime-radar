/**
 * Dashboard — the flagship executive screen (executive pass, 2026-09-05).
 *
 * Order of reading, top to bottom: one desk read (conclusion, why it matters,
 * what changed, what to watch, what would invalidate the call, evidence
 * freshness) → the five monitored signals → supporting evidence (key levels,
 * what's priced) → macro charts in the in-place accordion → the composed
 * read-through and methodology under disclosure. Every number is API data;
 * every metric carries a desk-note caption; jargon gets the dotted-underline
 * definition affordance. No fixture data.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Card, ProbabilityBar, SectionHeader, SignalCard, StatTile, Tag } from "../../components";
import {
  useAlerts,
  useCreditOas,
  useFreshness,
  usePriced,
  useRegimeHistory,
  useRegimeLatest,
  useRecessionProbability,
  useSeriesLatest,
  useSignalsLatest,
} from "../../api/queries";
import { daysSince, fmtBps, fmtDate, fmtMonYr, fmtPct, fmtSigned, fmtWholePct, ordinal } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import type { Regime, Signal } from "../../api/types";
import { SIGNALS_META, SIGNAL_ORDER } from "./signals-meta";
import LineChart, { type ChartSeries } from "./LineChart";
import Jargon from "../shared/Jargon";
import { Caption, mono } from "../shared/screen-ui";
import DeskRead, { type LedgerItem } from "../shared/DeskRead";
import { assessFreshness } from "../shared/freshness";
import Disclosure from "../shared/Disclosure";

/* ── small shared bits ─────────────────────────────────────────────────── */

const errStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-muted)",
};

/* ── regime hero ───────────────────────────────────────────────────────── */

const REGIME_NAMES: Record<string, string> = {
  goldilocks: "Goldilocks",
  overheating: "Overheating",
  stagflation: "Stagflation",
  recession: "Recession Risk",
};

/** The classifier's own definition of each quadrant (Methodology copy). */
const REGIME_MEANING: Record<string, string> = {
  Goldilocks: "growth trending up while inflation stays calm: the equity-friendly quadrant",
  Overheating: "growth and inflation both running hot: real assets lead, duration suffers",
  Stagflation: "inflation hot while growth stalls: the hardest tape, cash and commodities defend",
  "Recession Risk": "growth rolling over with inflation fading: quality bonds and defensives lead",
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

/* ── screen ────────────────────────────────────────────────────────────── */

export default function DashboardScreen() {
  const location = useLocation();
  const { isMobile, isNarrow, bp } = useBreakpoint();
  const regime = useRegimeLatest();
  const history = useRegimeHistory(36);
  const signals = useSignalsLatest();
  const alerts = useAlerts(200);
  const recession = useRecessionProbability();
  const credit = useCreditOas(90);
  const fedFunds = useSeriesLatest("FEDFUNDS");
  const vix = useSeriesLatest("VIXCLS");
  const priced = usePriced();
  const freshness = useFreshness();

  // Palette/hash deep links: scroll the section into view once it exists.
  useEffect(() => {
    if (!location.hash) return;
    const el = document.getElementById(location.hash.slice(1));
    if (el) el.scrollIntoView({ block: "start" });
  }, [location.hash, regime.data]);

  // Streak and the switch that started it, from the stored monthly history.
  const streak = useMemo(() => {
    const rows = history.data;
    if (!rows?.length) return null;
    const lead = rows[rows.length - 1].label;
    let n = 0;
    for (let i = rows.length - 1; i >= 0 && rows[i].label === lead; i--) n++;
    const first = rows[rows.length - n];
    const prev = rows[rows.length - n - 1];
    return { n, since: first?.date, prev: prev?.label ?? null };
  }, [history.data]);

  // Desk-read pulse gate (owner ruling 2026-08-06): the dot pulses only when
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

  const reporting: Signal[] = signals.data?.signals ?? [];
  const bySignal = new Map(reporting.map((s) => [s.signal_name, s]));
  const triggered = reporting.filter((s) => s.triggered);
  const watching = reporting.filter((s) => s.status === "Watch");

  /* ── desk read ───────────────────────────────────────────────────────── */
  let deskRead: React.ReactNode = null;
  let readThrough: string[] = [];
  if (regime.data) {
    const r = regime.data;
    const { probs, lead, runner } = regimeOdds(r);
    const gapPp = Math.round((lead[1] - runner[1]) * 100);
    const readKind =
      gapPp < 10
        ? `a coin flip with ${REGIME_NAMES[runner[0]]} at ${fmtWholePct(runner[1])}`
        : gapPp < 25
          ? `a contested lead over ${REGIME_NAMES[runner[0]]} at ${fmtWholePct(runner[1])}`
          : `a clear lead over ${REGIME_NAMES[runner[0]]} at ${fmtWholePct(runner[1])}`;
    const conviction = convictionWord(r.confidence);
    const convictionTone = conviction === "High" ? "pos" : conviction === "Medium" ? "accent" : "warn";

    const thr = (name: string, dp = 2) => {
      const t = bySignal.get(name)?.threshold;
      return t != null ? t.toFixed(dp) : "its threshold";
    };
    const vixV = vix.data?.value;

    // The composed read-through survives, one click down.
    readThrough = [
      `The drivers on file: the 10Y–2Y spread holds at ${
        recession.data?.yield_curve_spread != null
          ? `${fmtBps(recession.data.yield_curve_spread)} (${fmtPct(recession.data.yield_curve_spread / 100)})`
          : "—"
      }, the VIX sits at ${vixV != null ? vixV.toFixed(2) : "—"}${
        vixV != null ? (vixV < 15 ? " (calm)" : vixV < 25 ? " (subdued)" : " (stressed)") : ""
      }, and high-yield spreads run ${hy ? `${Math.round(hy.value_bps)} bps` : "—"}${
        hy?.change_1w_bps != null ? ` (${fmtBps(hy.change_1w_bps)} on the week)` : ""
      }. Growth trend reads ${r.growth_trend != null ? fmtSigned(r.growth_trend) : "—"} and inflation trend ${
        r.inflation_trend != null ? fmtSigned(r.inflation_trend) : "—"
      }; both are 3-month slopes of z-scored macro data.`,
      `What would change the read: a CPI print above ${thr("cpi_hot")}% YoY trips Inflation pressure, a 2s10s close below ${thr("yield_curve_inversion")}% trips Curve inversion risk, and a VIX close above ${thr("vix_spike")} trips the vol signal. ` +
        (triggered.length > 0
          ? `${triggered.length} of the ${reporting.length} monitored signals ${triggered.length === 1 ? "is" : "are"} currently triggered.`
          : `None of the ${reporting.length} monitored signals is triggered${
              watching.length > 0 ? `; ${watching.length} sit${watching.length === 1 ? "s" : ""} in Watch` : ""
            }.`),
    ];

    const changed =
      streak == null
        ? "—"
        : streak.prev && streak.since
          ? `Switched from ${streak.prev} in ${fmtMonYr(streak.since)} · ${streak.n} month${streak.n === 1 ? "" : "s"} in`
          : `${streak.n} month${streak.n === 1 ? "" : "s"} unchanged`;

    const watchText = watching.length
      ? watching
          .map((s) => `${SIGNALS_META[s.signal_name]?.display ?? s.signal_name} (${Math.round(s.distance_pct ?? 0)}% of trigger)`)
          .join(" · ")
      : triggered.length
        ? `${triggered.length} triggered`
        : "All five signals clear";

    const invalidates = `CPI > ${thr("cpi_hot")}% YoY · 2s10s < ${thr("yield_curve_inversion")}% · VIX > ${thr("vix_spike", 0)}`;

    const ledger: LedgerItem[] = [
      {
        label: "Odds",
        value: (
          <div style={{ minWidth: 0, paddingTop: 2 }}>
            <ProbabilityBar probs={probs} height={6} />
          </div>
        ),
      },
      { label: "What changed", value: changed, prose: true },
      {
        label: triggered.length ? "Triggered" : "Watch",
        value: watchText,
        prose: true,
        tone: triggered.length ? "var(--neg-text)" : watching.length ? "var(--warn)" : "var(--pos)",
      },
      { label: "Invalidates", value: invalidates },
      ...(recession.data?.recession_prob != null
        ? [
            {
              label: "NBER recession model",
              value: `${recession.data.recession_prob.toFixed(1)}% over 12m · ${recession.data.recession_label} (a separate model from the ${fmtWholePct(probs.recession)} Recession Risk regime odds)`,
              prose: true,
              tone:
                recession.data.recession_label === "High Risk"
                  ? "var(--neg-text)"
                  : recession.data.recession_label === "Elevated"
                    ? "var(--warn-hot)"
                    : "var(--pos)",
            },
          ]
        : []),
    ];

    const f = freshness.data;
    deskRead = (
      <DeskRead
        id="regime-hero"
        eyebrow="Desk read · Dashboard"
        live={bannerLive}
        badge={
          <Tag tone={convictionTone} size="md" uppercase={false}>
            Model confidence · {conviction} · {fmtWholePct(r.confidence)}
          </Tag>
        }
        conclusion={`${r.label} at ${fmtWholePct(lead[1])} model odds, ${readKind}.`}
        why={
          <>
            {r.label} means {REGIME_MEANING[r.label] ?? "the classifier's leading quadrant"}. The call rests on a growth trend
            of {r.growth_trend != null ? fmtSigned(r.growth_trend) : "—"} and an inflation trend of{" "}
            {r.inflation_trend != null ? fmtSigned(r.inflation_trend) : "—"};{" "}
            <Jargon term="conviction">model confidence</Jargon> of {fmtWholePct(r.confidence)} is a separate reading of how firmly
            the classifier holds the call.
          </>
        }
        ledger={ledger}
        // On a phone the header's freshness words sit one screen above; the
        // desk read does not repeat them (review P3-13).
        freshness={
          isMobile
            ? undefined
            : [
                { noun: "Macro", info: assessFreshness(r.date, "monthly") },
                { noun: "Signals", info: assessFreshness(signals.data?.date ?? f?.signals_date, "monthly") },
                { noun: "Market", info: assessFreshness(f?.market_daily_date, "daily") },
              ]
        }
      />
    );
  }

  /* signals grid — five tracks only at wide width; three on a small laptop or
     tablet landscape (768–1023), self-fitting pairs between 480 and 767, one
     per row on a phone. The cards never clip their names. */
  const signalCols =
    bp === "wide"
      ? "repeat(5,minmax(0,1fr))"
      : bp === "desktop"
        ? "repeat(3,minmax(0,1fr))"
        : isMobile
          ? "minmax(0,1fr)"
          : "repeat(auto-fit,minmax(200px,1fr))";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Desk read ───────────────────────────────────────────────── */}
      {regime.isLoading && (
        <Card style={{ opacity: 0.6 }}>
          <span style={errStyle}>Reading the latest regime…</span>
        </Card>
      )}
      {/* Only when there is nothing to read: with snapshot data on screen the
          shell's status word already says the service is asleep (review P1-2). */}
      {regime.isError && !regime.data && (
        <Card tone="risk">
          <span style={errStyle}>
            Regime unavailable: the data service did not answer. The read resumes when it is back.
          </span>
        </Card>
      )}
      {deskRead}

      {/* ── Monitored signals ───────────────────────────────────────── */}
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
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-caption)",
            color: "var(--text-muted)",
            margin: "-4px 0 10px",
          }}
        >
          Bars show distance to trigger · Clear &lt;50% · Watch ≥50% · Triggered = threshold crossed.
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: signalCols,
            gap: "18px 12px",
          }}
        >
          {SIGNAL_ORDER.map((name) => {
            const meta = SIGNALS_META[name];
            const row = bySignal.get(name);
            if (row) {
              // Carried-forward prints state their true month (monthly signals
              // between releases) instead of dropping out — the latest-available-
              // with-its-date rule, now server-enforced.
              const carried = row.date !== signals.data?.date;
              return (
                <div key={name}>
                  <SignalCard
                    name={meta.display}
                    value={meta.format(row.value)}
                    fillPct={row.distance_pct ?? 0}
                    status={row.status ?? undefined}
                    lastTriggered={lastAlertBySignal.get(name) ? fmtDate(lastAlertBySignal.get(name) as string) : "none on file"}
                  />
                  <Caption style={{ paddingLeft: 12, marginTop: 4 }}>
                    {meta.trigger(row.threshold)}
                    <div style={{ marginTop: 2 }}>
                      Signal print {fmtMonYr(row.date)}
                      {carried ? " · next monthly print pending" : ""}
                    </div>
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
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--fs-caption)",
                      color: "var(--text-muted)",
                      lineHeight: 1.6,
                    }}
                  >
                    {signals.isLoading ? "Reading the signal print…" : "No print on file yet; nothing is stored for this signal."}
                  </div>
                </Card>
                <Caption style={{ paddingLeft: 12, marginTop: 4 }}>
                  {meta.trigger(null)}
                  <div style={{ marginTop: 2 }}>Signal print · none on file</div>
                </Caption>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Supporting evidence: key levels ─────────────────────────── */}
      <section id="key-levels">
        <SectionHeader
          title="Supporting evidence · key levels"
          right={credit.data?.as_of ? `FRED · latest ${fmtDate(credit.data.as_of)}` : "FRED"}
        />
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: 12 }}>
          <Card
            accentBar
            tone={
              recession.data?.recession_label.includes("High")
                ? "risk"
                : recession.data?.recession_label.includes("Elevated")
                  ? "watch"
                  : "clear"
            }
          >
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
                  {recession.data.recession_prob.toFixed(1)}% sits in the {recession.data.recession_label} band (Elevated
                  starts at 20%, High at 40%). The <Jargon term="recession model">model</Jargon> trains on{" "}
                  <Jargon term="NBER">NBER</Jargon> dates; inputs through {fmtMonYr(recession.data.data_as_of)}.
                </>
              ) : recession.isError ? (
                "Recession model unavailable: its endpoint trains in-process and may need a warm start."
              ) : (
                "Training the recession model; the first call takes about a second."
              )}
            </Caption>
          </Card>

          <Card accentBar tone={recession.data?.is_inverted ? "risk" : "clear"}>
            <StatTile
              label="Yield curve 2s10s"
              value={recession.data?.yield_curve_spread != null ? fmtBps(recession.data.yield_curve_spread) : "—"}
              size="sm"
            />
            <Caption>
              {recession.data?.yield_curve_spread != null ? (
                <>
                  The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at {fmtBps(recession.data.yield_curve_spread)} (
                  {fmtPct(recession.data.yield_curve_spread / 100)})
                  {recession.data.yield_curve_pct_rank != null
                    ? `, the ${ordinal(recession.data.yield_curve_pct_rank)} percentile of the model's monthly history`
                    : ""}
                  . Below 0 is an inversion, the classic pre-recession shape.
                </>
              ) : (
                "Curve data arrives with the recession model response."
              )}
            </Caption>
          </Card>

          <Card accentBar tone="default">
            <StatTile label="Model vs market" value={recession.data?.divergence_label ?? "—"} size="sm" />
            <Caption>
              <Jargon term="divergence">Divergence check</Jargon>: whether the recession model and market risk pricing tell
              one story
              {recession.data?.divergence_score != null
                ? `. Score ${fmtSigned(recession.data.divergence_score, 0)} on a −100 to +100 scale; beyond ±20 the divergence is material and requires judgment.`
                : "."}
            </Caption>
          </Card>
        </div>

        <Card
          style={{
            display: "grid",
            gridTemplateColumns: isNarrow ? "repeat(auto-fit,minmax(130px,1fr))" : "repeat(5,minmax(0,1fr))",
            gap: 16,
            marginTop: 12,
          }}
        >
          <div>
            <StatTile label="Fed Funds" value={fedFunds.data ? fmtPct(fedFunds.data.value) : "—"} />
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
              direction={regime.data?.growth_trend != null && regime.data.growth_trend >= 0 ? "up" : "down"}
            />
            <Caption>
              3-month slope of the industrial-production <Jargon term="z-score">z-score</Jargon>; feeds the regime call.
            </Caption>
          </div>
          <div>
            <StatTile
              label="Inflation trend"
              value={regime.data?.inflation_trend != null ? fmtSigned(regime.data.inflation_trend) : "—"}
              direction={regime.data?.inflation_trend != null && regime.data.inflation_trend >= 0 ? "up" : "down"}
            />
            <Caption>
              3-month slope of the CPI <Jargon term="z-score">z-score</Jargon>; feeds the regime call.
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
                    ? "Market-implied pricing unavailable: the data service did not answer."
                    : priced.isLoading
                      ? "Reading market-implied pricing…"
                      : "No priced metrics on file; the weekly pipeline has not written them yet."}
                </div>
              );
            }
            return (
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))",
                    gap: 16,
                  }}
                >
                  {rows.map((p) => (
                    <div key={p.metric}>
                      <StatTile
                        label={p.label}
                        value={`${p.value.toFixed(2)}${p.unit}`}
                        delta={
                          p.mom_chg != null
                            ? /* change of a percent-level series is pp, not % */
                              `${fmtSigned(p.mom_chg)}${p.unit === "%" ? "pp" : p.unit} MoM`
                            : undefined
                        }
                        direction={p.mom_chg != null ? (p.mom_chg >= 0 ? "up" : "down") : undefined}
                        size="sm"
                      />
                      <Caption>
                        {p.group.toLowerCase()} · weekly pipeline · {fmtDate(p.date)}
                      </Caption>
                    </div>
                  ))}
                </div>
                <Caption>
                  The market&apos;s own pricing: <Jargon term="breakeven">breakevens</Jargon> for expected inflation,{" "}
                  <Jargon term="TIPS">TIPS</Jargon> for real yields. All six metrics with the policy rate sit in Markets.
                </Caption>
              </div>
            );
          })()}
          <div style={{ marginTop: 10 }}>
            <Link to="/app/markets#whats-priced-full" style={{ fontSize: "var(--fs-body-s)", color: "var(--accent)" }}>
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
      </section>

      {/* ── Composed read-through and method, one click down ─────────── */}
      {readThrough.length ? (
        <section id="read-through">
          <SectionHeader title="How this read is composed" right="stored data · no model call" />
          <Disclosure title="Current read-through" right="composed from stored data">
            <Card accentBar tone="accent">
              {readThrough.map((p, i) => (
                <p
                  key={i}
                  className="mrr-prose"
                  style={{
                    fontSize: "var(--fs-body)",
                    color: "var(--text-2)",
                    lineHeight: "var(--lh-body)",
                    margin: i ? "10px 0 0" : 0,
                    textWrap: "pretty",
                  }}
                >
                  {p}
                </p>
              ))}
            </Card>
          </Disclosure>
          <Disclosure title="Method and provenance" right="reference" style={{ marginTop: 6 }}>
            <Card>
              <p className="mrr-prose" style={{ ...errStyle, fontSize: "var(--fs-body-s)", lineHeight: 1.6, margin: 0 }}>
                The regime is a 4-way softmax classifier over z-scored growth (industrial production) and inflation (CPI)
                trends, run monthly on FRED data; the four odds always sum to 100% and the header badge shows the dominant
                stored probability. The five monitored signals compare the latest print against fixed thresholds and are
                scored server-side; the recession model is a logistic regression trained on NBER dates. Nothing on this
                screen is re-derived in the browser.{" "}
                <Link to="/app/methodology" style={{ color: "var(--accent)" }}>
                  Full methodology →
                </Link>
              </p>
            </Card>
          </Disclosure>
        </section>
      ) : null}
    </div>
  );
}
