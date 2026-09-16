/**
 * Landing page — brand lane at "/", the terminal lives at /app. The live
 * regime read straight off the API (proof of life), three plain-English
 * sentences, one architecture line, a single CTA. Desk-note voice:
 * declarative, numbers in the sentence, no marketing adjectives.
 *
 * 2026-09-05 (executive pass): at desk width the page is a two-column
 * composition. The right column is one product-proof artifact built from the
 * same stored data the terminal renders: the classifier's 24-month odds and
 * the five monitored signals with their status words. Nothing is fixture
 * data; nothing is a screenshot. On a phone the proof panel stacks under the
 * CTA and the first viewport stays the read, the sentence, and the button.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ProbabilityBar, RegimeBadge } from "../components";
import { useRegimeHistory, useRegimeLatest, useSignalsLatest } from "../api/queries";
import { fmtMonYr, fmtWholePct } from "../lib/format";
import { useBreakpoint } from "../lib/useBreakpoint";
import type { Regime } from "../api/types";
import LineChart, { type ChartSeries } from "./dashboard/LineChart";
import { SIGNALS_META, SIGNAL_ORDER } from "./dashboard/signals-meta";
import { mono } from "./shared/screen-ui";

/** Last good regime payload — "dated beats empty" for the one-visit visitor. */
const CACHE_KEY = "mrr:last-regime";

function readCachedRegime(): Regime | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Regime) : null;
  } catch {
    return null;
  }
}

function liveRead(r: Regime): { sentence: string; probs: Record<string, number> } {
  const probs = {
    goldilocks: r.prob_goldilocks ?? 0,
    overheating: r.prob_overheating ?? 0,
    stagflation: r.prob_stagflation ?? 0,
    recession: r.prob_recession ?? 0,
  };
  const names: Record<string, string> = {
    goldilocks: "Goldilocks",
    overheating: "Overheating",
    stagflation: "Stagflation",
    recession: "Recession Risk",
  };
  const ranked = Object.entries(probs).sort((a, b) => b[1] - a[1]);
  const [leadKey, leadP] = ranked[0];
  const [runnerKey, runnerP] = ranked[1];
  const gapPp = (leadP - runnerP) * 100;
  const readKind = gapPp < 10 ? "a coin-flip read" : gapPp < 25 ? "a contested read" : "a clear read";
  const sentence =
    `The model puts ${fmtWholePct(leadP)} odds on ${names[leadKey]} against ` +
    `${fmtWholePct(runnerP)} ${names[runnerKey]}: ${readKind}. ` +
    `Model confidence in the call is ${fmtWholePct(r.confidence)}.`;
  return { sentence, probs };
}

const STATUS_COLOR: Record<string, string> = {
  Clear: "var(--pos)",
  Watch: "var(--amber)",
  Triggered: "var(--neg-text)",
};

/** The proof artifact: regime odds over 24 months + the five signals. */
function ProofPanel({ compact }: { compact: boolean }) {
  const history = useRegimeHistory(24);
  const signals = useSignalsLatest();
  const rows = history.data ?? [];
  const mk = (key: keyof Regime, label: string, color: string): ChartSeries => ({
    label,
    color,
    points: rows.map((r) => ({ x: r.date, y: ((r[key] as number | null) ?? 0) * 100 })),
  });
  const bySignal = new Map((signals.data?.signals ?? []).map((s) => [s.signal_name, s]));
  return (
    <aside
      aria-label="Live model output"
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--line-hair)",
        borderRadius: "var(--r-md)",
        padding: compact ? 14 : 18,
        display: "grid",
        gap: 14,
        minWidth: 0,
      }}
    >
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: "var(--fs-label)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-label)" }}>
            Regime odds · 24 months
          </span>
          <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
            {rows.length ? `${fmtMonYr(rows[0].date)} → ${fmtMonYr(rows[rows.length - 1].date)}` : history.isLoading ? "loading…" : "unavailable"}
          </span>
        </div>
        <div style={{ marginTop: 8 }}>
          {rows.length ? (
            <LineChart
              height={compact ? 120 : 150}
              series={[
                mk("prob_goldilocks", "GL", "var(--regime-goldilocks)"),
                mk("prob_overheating", "OV", "var(--regime-overheating)"),
                mk("prob_stagflation", "ST", "var(--regime-stagflation)"),
                mk("prob_recession", "RR", "var(--regime-recession)"),
              ]}
              yFmt={(v) => `${Math.round(v)}%`}
              caption="Monthly regime odds, 24 months"
              showLast={false}
            />
          ) : (
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              {history.isError ? "History unavailable: the data service did not answer." : "Reading the stored classifier history…"}
            </div>
          )}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ ...mono, fontSize: "var(--fs-label)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-label)" }}>
            Monitored signals
          </span>
          <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
            {signals.data ? `signal print ${fmtMonYr(signals.data.date)}` : signals.isLoading ? "loading…" : "unavailable"}
          </span>
        </div>
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid" }}>
          {SIGNAL_ORDER.map((name) => {
            const meta = SIGNALS_META[name];
            const s = bySignal.get(name);
            const status = s?.status ?? (s ? (s.triggered ? "Triggered" : "Clear") : null);
            return (
              <li
                key={name}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto auto",
                  gap: 12,
                  alignItems: "baseline",
                  padding: "6px 0",
                  borderTop: "0.5px solid var(--line-hair)",
                }}
              >
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {meta.display}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text)" }}>
                  {s ? meta.format(s.value) : "—"}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: status ? STATUS_COLOR[status] : "var(--text-muted)", minWidth: 62, textAlign: "right" }}>
                  {status ? `● ${status}` : signals.isLoading ? "…" : "n/a"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

export default function LandingPage() {
  const regime = useRegimeLatest();
  // This page renders outside AppShell, so it owns its own gutter — same
  // ladder as the shell's (AppShell.tsx) so "/" and "/app" line up when the
  // visitor crosses the CTA.
  const { isMobile, isNarrow, bp } = useBreakpoint();
  const gutter = isMobile ? 12 : isNarrow ? 16 : 28;
  const twoCol = bp === "wide";

  useEffect(() => {
    if (regime.data) {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(regime.data));
      } catch {
        /* storage full/blocked — the live path still renders */
      }
    }
  }, [regime.data]);

  // Live read, else the last stored read (with its date), else honest absence.
  const shown = regime.data ?? (regime.isError ? readCachedRegime() : null);
  const isStale = !regime.data && shown != null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        padding: `${isMobile ? 16 : 24}px ${gutter}px`,
        boxSizing: "border-box",
      }}
    >
      <header className="mrr-frame" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span
            className={regime.data ? "mrr-live-dot" : undefined}
            style={{
              background: regime.data ? "var(--mint)" : "var(--text-4)",
              width: 8,
              height: 8,
              borderRadius: "50%",
              display: "inline-block",
            }}
          />
          {/* The wordmark is this page's only <h1>. */}
          <h1
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: isMobile ? 15 : 18,
              fontWeight: 500,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              margin: 0,
            }}
          >
            Macro Regime Radar
          </h1>
        </span>
        <Link
          to="/app"
          style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", minHeight: 28, display: "inline-flex", alignItems: "center" }}
        >
          Terminal →
        </Link>
      </header>

      <main
        className="mrr-frame"
        style={{
          alignSelf: "center",
          display: "grid",
          gridTemplateColumns: twoCol ? "minmax(0, 1.05fr) minmax(360px, 0.95fr)" : "minmax(0,1fr)",
          gap: twoCol ? 48 : 28,
          alignItems: "center",
          padding: `${isMobile ? 24 : 40}px 0`,
        }}
      >
        <div style={{ display: "grid", gap: 24, minWidth: 0, maxWidth: 720 }}>
          {/* Live read — real API output, stated with its numbers. */}
          <section>
            <div
              style={{
                ...mono,
                fontSize: "var(--fs-label)",
                letterSpacing: "var(--ls-label)",
                textTransform: "uppercase",
                color: "var(--text-label)",
                marginBottom: 10,
              }}
            >
              {isStale ? "Last stored read" : "Current regime"} ·{" "}
              {shown ? `macro data as of ${fmtMonYr(shown.date)}` : "live from the model"}
              {isStale ? " · live feed unavailable" : ""}
            </div>
            {shown ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                  <RegimeBadge
                    label={shown.label}
                    confidence={Math.max(
                      shown.prob_goldilocks ?? 0,
                      shown.prob_overheating ?? 0,
                      shown.prob_stagflation ?? 0,
                      shown.prob_recession ?? 0,
                    )}
                  />
                  <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                    <ProbabilityBar probs={liveRead(shown).probs} height={6} />
                  </div>
                </div>
                <p
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: isMobile ? "var(--fs-value)" : "var(--fs-lead)",
                    fontWeight: 500,
                    lineHeight: 1.4,
                    color: "var(--text)",
                    margin: "16px 0 0",
                    maxWidth: "34ch",
                    textWrap: "pretty",
                  }}
                >
                  {liveRead(shown).sentence}
                </p>
              </>
            ) : (
              <p
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body-s)",
                  color: "var(--text-muted)",
                  margin: 0,
                }}
              >
                {regime.isError
                  ? "Terminal data offline: the live read resumes when the data service is back."
                  : "Reading the latest regime…"}
              </p>
            )}
          </section>

          {/* What this is — plain English, for whom, why credible. */}
          <section
            style={{
              fontSize: "var(--fs-body)",
              lineHeight: "var(--lh-body)",
              color: "var(--text-2)",
              maxWidth: "var(--maxw-prose)",
              display: "grid",
              gap: 10,
            }}
          >
            <p style={{ margin: 0, textWrap: "pretty" }}>
              This terminal reads the U.S. economy from primary data: growth, inflation, jobs, credit and interest
              rates, refreshed each morning the pipeline runs and dated on every screen. A statistical model states
              which of four regimes the market is in
              (Goldilocks, Overheating, Stagflation, or Recession Risk: the weather patterns that decide which assets
              work) and prints its odds next to the call.
            </p>
            <p style={{ margin: 0, textWrap: "pretty" }}>
              Built for a portfolio manager&apos;s morning: five signals watch the data for a break, a recession model
              and the credit tape supply the evidence, scenario and backtest tools let an analyst stress the call, and
              every number carries its date. Unlike a market dashboard, it starts from the conclusion and shows the
              audit trail underneath.
            </p>
          </section>

          {/* One architecture line + the CTA. */}
          <section style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                ...mono,
                fontSize: "var(--fs-meta)",
                letterSpacing: "var(--ls-micro)",
                color: "var(--text-muted)",
              }}
            >
              <span title="FRED: Federal Reserve Economic Data, the Fed's public data service">FRED</span> → classifier
              → signals → Claude briefings · daily pipeline
              {shown ? ` · macro data as of ${fmtMonYr(shown.date)}` : ""}
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <Link
                to="/app"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 44,
                  border: "1px solid var(--link-a32)",
                  borderRadius: "var(--r-md)",
                  padding: "10px 20px",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body)",
                  fontWeight: 600,
                  color: "var(--link)",
                  textDecoration: "none",
                  transition: "background var(--dur-fast) var(--ease-out)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--link-a10)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Open the terminal →
              </Link>
              <Link
                to="/app/methodology"
                style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", minHeight: 44, display: "inline-flex", alignItems: "center" }}
              >
                How it works
              </Link>
            </div>
          </section>
        </div>

        <ProofPanel compact={isNarrow} />
      </main>

      <footer
        className="mrr-frame"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          ...mono,
          fontSize: "var(--fs-meta)",
          letterSpacing: "var(--ls-micro)",
          color: "var(--text-muted)",
        }}
      >
        <span>Data: FRED · EODHD (yfinance as disclosed fallback) · Finnhub · NewsAPI · RSS</span>
        <span>Automated briefing from Macro Regime Radar. Not investment advice.</span>
      </footer>
    </div>
  );
}
