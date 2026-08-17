/**
 * Landing page — brand lane at "/", the terminal lives at /app. One viewport:
 * wordmark, the live regime read straight off the API (proof of life), three
 * plain-English sentences, one architecture line, a single CTA. Desk-note
 * voice: declarative, numbers in the sentence, no marketing adjectives.
 */

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ProbabilityBar, RegimeBadge } from "../components";
import { useRegimeLatest } from "../api/queries";
import { fmtMonYr, fmtWholePct } from "../lib/format";
import type { Regime } from "../api/types";

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
    `${fmtWholePct(runnerP)} ${names[runnerKey]} — ${readKind}. ` +
    `Conviction in the call is ${fmtWholePct(r.confidence)}.`;
  return { sentence, probs };
}

export default function LandingPage() {
  const regime = useRegimeLatest();

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
        padding: "24px 28px",
        boxSizing: "border-box",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          className={regime.data ? "mrr-live-dot" : undefined}
          style={{
            background: regime.data ? "var(--accent)" : "var(--text-faint)",
            width: 8,
            height: 8,
            borderRadius: "50%",
            display: "inline-block",
          }}
        />
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          Macro Regime Radar
        </span>
      </header>

      <main
        style={{
          alignSelf: "center",
          justifySelf: "center",
          width: "100%",
          maxWidth: 720,
          margin: "0 auto",
          display: "grid",
          gap: 28,
          padding: "40px 0",
        }}
      >
        {/* Live read — real API output, stated with its numbers. */}
        <section>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-micro)",
              letterSpacing: "var(--ls-wide)",
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
                <RegimeBadge label={shown.label} confidence={
                  Math.max(
                    shown.prob_goldilocks ?? 0,
                    shown.prob_overheating ?? 0,
                    shown.prob_stagflation ?? 0,
                    shown.prob_recession ?? 0,
                  )
                } />
                <div style={{ flex: "1 1 260px", minWidth: 220 }}>
                  <ProbabilityBar probs={liveRead(shown).probs} height={6} />
                </div>
              </div>
              <p
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "var(--fs-value)",
                  fontWeight: 500,
                  lineHeight: 1.45,
                  color: "var(--text)",
                  margin: "16px 0 0",
                  textWrap: "pretty",
                }}
              >
                {liveRead(shown).sentence}
              </p>
            </>
          ) : (
            <p
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--fs-body-s)",
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              {regime.isError
                ? "Terminal data offline — the live read resumes when the data service is back."
                : "Reading the latest regime —"}
            </p>
          )}
        </section>

        {/* What this is — three sentences, plain English. */}
        <section
          style={{
            fontSize: "var(--fs-body)",
            lineHeight: "var(--lh-body)",
            color: "var(--text-2)",
            maxWidth: "74ch",
          }}
        >
          <p style={{ margin: 0, textWrap: "pretty" }}>
            This terminal reads the U.S. economy from primary data: growth, inflation, jobs,
            credit and interest rates, pulled fresh every morning. A statistical model states
            which of four regimes the market is in — Goldilocks, Overheating, Stagflation, or
            Recession Risk: the weather patterns that decide which assets work — and prints its
            odds next to the call. Five signals watch the data for a break; when one trips, the
            system writes the morning note itself and says why it matters.
          </p>
        </section>

        {/* One architecture line + the CTA. */}
        <section style={{ display: "grid", gap: 20 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--fs-label)",
              letterSpacing: "var(--ls-micro)",
              color: "var(--text-muted)",
            }}
          >
            <span title="FRED — Federal Reserve Economic Data, the Fed's public data service">
              FRED
            </span>{" "}
            → classifier → signals → Claude briefings · refreshed daily
          </div>
          <div>
            <Link
              to="/app"
              style={{
                display: "inline-block",
                border: "1px solid var(--accent-line)",
                borderRadius: "var(--r-md)",
                padding: "12px 20px",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--fs-body)",
                fontWeight: 600,
                color: "var(--accent)",
                textDecoration: "none",
                transition: "background var(--dur-fast) var(--ease-out)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-dim)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              Open the terminal →
            </Link>
          </div>
        </section>
      </main>

      <footer
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 20,
          flexWrap: "wrap",
          fontFamily: "var(--font-mono)",
          fontSize: "var(--fs-meta)",
          letterSpacing: "var(--ls-micro)",
          color: "var(--text-muted)",
        }}
      >
        <span>Data: FRED · yfinance · Finnhub · NewsAPI · RSS</span>
        <span>Automated briefing from Macro Regime Radar. Not investment advice.</span>
      </footer>
    </div>
  );
}
