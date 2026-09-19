/**
 * Methodology — the reference page behind the persistent header link (locked
 * IA: not a tab). Regime definitions, live signal thresholds, the closed
 * status vocabularies and meaning ramps, model notes, and data provenance.
 * Signal thresholds render from /api/signals/latest so this page can never
 * drift from the server truth it documents.
 *
 * 2026-09-05 (executive pass): reads as model documentation, not a wall of
 * definitions. A "how to read this product" path opens, a contents rail
 * (sticky at desk width) names the sections, each section says whether it
 * documents statistical output or reference content, sources are cited with
 * links, every section links back to the module it explains, and the page
 * closes with what the model can and cannot claim.
 *
 * 2026-09-15 (redesign Phase 10, checklist 10 C #7): a UI-face h1
 * "Methodology" (matching document.title) opens the page above the contents
 * nav in both layouts, so the route has one h1 like every tab; every
 * SectionHeader keeps its level. The regime swatches read the --r-* tokens.
 *
 * Iteration 1 (Y2, Y3, G1, G2): each Contents entry is a card (`.mrr-meth-toc`
 * in app.css: border, hover and focus states, pointer), same links, same
 * order; "How to read this product" spans its row like every section below
 * it, the prose and the reading order side by side where the row is wide
 * enough; the section headers wrap their meta under the title instead of
 * running into it (1024 px); the Models and Ramps cards flow in two balanced
 * columns (`.mrr-meth-cols`), each card sized to its own content, where a
 * two-by-two grid stretched a short card to its row partner's height.
 */

import { Link } from "react-router-dom";
import { Card, SectionHeader, Tag } from "../../components";
import { useSignalsLatest } from "../../api/queries";
import { fmtMonYr } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import ScrollTable from "../shared/ScrollTable";
import { Caption, StateNote, eyebrowStyle, mono, useHashScroll } from "../shared/screen-ui";

const REGIME_DEFS: { name: string; color: string; def: string }[] = [
  { name: "Goldilocks", color: "var(--r-goldilocks)", def: "Growth trending up while inflation stays calm: the equity-friendly quadrant." },
  { name: "Overheating", color: "var(--r-overheating)", def: "Growth and inflation both running hot: real assets lead, duration suffers." },
  { name: "Stagflation", color: "var(--r-stagflation)", def: "Inflation hot while growth stalls: the hardest tape; cash and commodities defend." },
  { name: "Recession Risk", color: "var(--r-recession)", def: "Growth rolling over with inflation fading: quality bonds and defensives lead." },
];

const SIGNAL_NAMES: Record<string, string> = {
  yield_curve_inversion: "Curve inversion",
  unemployment_spike: "Unemployment spike",
  cpi_hot: "Inflation pressure",
  cpi_cold: "Disinflation",
  vix_spike: "VIX spike",
};

const SIGNAL_UNITS: Record<string, string> = {
  yield_curve_inversion: "%",
  unemployment_spike: "pp",
  cpi_hot: "% YoY",
  cpi_cold: "% YoY",
  vix_spike: "",
};

const CONTENTS: { id: string; label: string; kind: "read" | "data" | "model" | "reference" | "limits" }[] = [
  { id: "how-to-read", label: "How to read this product", kind: "read" },
  { id: "regimes", label: "The four regimes", kind: "model" },
  { id: "signals", label: "Monitored signals", kind: "model" },
  { id: "models", label: "Models and scenarios", kind: "model" },
  { id: "backtests", label: "Backtests and evidence", kind: "model" },
  { id: "ramps", label: "Meaning ramps and vocabularies", kind: "reference" },
  { id: "data", label: "Data and sources", kind: "data" },
  { id: "limits", label: "What the model can and cannot claim", kind: "limits" },
];

const KIND_WORD: Record<string, string> = {
  read: "Orientation",
  data: "Data",
  model: "Statistical output",
  reference: "Reference",
  limits: "Limits",
};

function ProvenanceTag({ kind }: { kind: "statistical" | "reference" | "data" }) {
  return (
    <Tag tone={kind === "statistical" ? "accent" : kind === "data" ? "neutral" : "warn"} size="sm">
      {kind === "statistical" ? "Statistical output" : kind === "data" ? "Data source" : "Reference content"}
    </Tag>
  );
}

function LegendRow({ swatch, label, detail }: { swatch: string; label: string; detail: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px 96px minmax(0,1fr)", gap: 10, alignItems: "baseline" }}>
      <span style={{ width: 10, height: 10, borderRadius: "var(--r-xs)", background: swatch, display: "inline-block", alignSelf: "center" }} />
      <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)", lineHeight: 1.5 }}>{detail}</span>
    </div>
  );
}

/* The meta wraps under the title when the two do not fit one line (G1 at
   1024 px, where the rail leaves the sections a 536px column). */
const headWrap: React.CSSProperties = { flexWrap: "wrap", rowGap: 4 };

const prose: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-body)",
  lineHeight: "var(--lh-body)",
  color: "var(--text-2)",
  margin: 0,
  maxWidth: "var(--maxw-prose)",
  textWrap: "pretty",
};

function ModuleLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", color: "var(--link)" }}>
      {children}
    </Link>
  );
}

export default function MethodologyScreen() {
  const signals = useSignalsLatest();
  const { isNarrow, bp, shellCompact } = useBreakpoint();
  const twoUp = isNarrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))";
  const rail = bp === "wide";
  useHashScroll(signals.data);

  // Y3: every entry is a card link (`.mrr-meth-toc` in app.css carries the
  // surface, the hover and focus states and the pointer); a column of cards
  // on the rail, a wrapping row of them above the sections otherwise.
  const contents = (
    <nav aria-label="Methodology contents" className="mrr-meth-toc" data-rail={rail ? "true" : "false"} style={rail ? { position: "sticky", top: 16 } : undefined}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Contents</div>
      <ol>
        {CONTENTS.map((c) => (
          <li key={c.id}>
            <a href={`#${c.id}`}>
              <span className="mrr-meth-toc-label">{c.label}</span>
              {rail ? (
                <span className="mrr-meth-toc-kind" style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase" }}>
                  {KIND_WORD[c.kind]}
                </span>
              ) : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: rail ? "220px minmax(0,1fr)" : "minmax(0,1fr)",
        gap: rail ? 32 : 16,
        alignItems: "start",
      }}
    >
      {/* The route's one h1, in the UI face at the display rung the tab heroes
          use (58px; 44px below 860 like .mrr-hero), spanning both grid
          columns so it sits above the contents rail and the sections alike. */}
      <h1
        style={{
          gridColumn: "1 / -1",
          margin: "6px 0 2px",
          fontFamily: "var(--font-ui)",
          fontWeight: 500,
          fontSize: shellCompact ? 44 : "var(--fs-display)",
          lineHeight: "var(--lh-display)",
          letterSpacing: "var(--ls-display)",
          color: "var(--text)",
        }}
      >
        Methodology
      </h1>
      {contents}

      <div style={{ display: "grid", gap: 20, minWidth: 0 }}>
        {/* ── How to read ─────────────────────────────────────────────── */}
        <section id="how-to-read">
          <SectionHeader style={headWrap} title="How to read this product" right="Orientation · the reading order every screen follows" />
          {/* Y2: the card spans its row like every section card below it; the
              paragraph keeps its 74ch measure and the reading order sits beside
              it where the row is wide enough (`.mrr-meth-read`, app.css), so
              the row is filled with the card's own content (review P3-9's
              measure is kept inside the card). */}
          <Card>
            <div className="mrr-meth-read">
              <p style={prose}>
                Every screen opens with a desk read: the conclusion, why it matters, what changed, what to watch, and what
                would invalidate the call, with the freshness of the evidence stated in words. Under it sit the five
                monitored signals and the supporting evidence; methodology, formulas and provenance are one click down.
                Read top to bottom: the first line is the claim, everything below is the audit trail.
              </p>
              <ol style={{ ...prose, paddingLeft: 20, margin: 0, display: "grid", gap: 4, alignContent: "start" }}>
                <li>
                  <b style={{ color: "var(--text)" }}>Regime</b>: which of four macro quadrants the classifier calls, with its odds. Header badge, Dashboard, Regime Lab.
                </li>
                <li>
                  <b style={{ color: "var(--text)" }}>Signals</b>: five thresholds watched monthly; Clear, Watch or Triggered. Dashboard.
                </li>
                <li>
                  <b style={{ color: "var(--text)" }}>Evidence</b>: credit spreads, the recession model, the curve, the tape. Credit, Recession, Markets.
                </li>
                <li>
                  <b style={{ color: "var(--text)" }}>Scenarios and history</b>: stress rules, analogues, backtests. Regime Lab, Tools.
                </li>
              </ol>
            </div>
            <Caption>
              Freshness words are a closed set: Current (inside its publication cycle), Delayed (one cycle late), Stale
              (older), Unavailable, Reference (no cadence). Every stamp prints its date.
            </Caption>
          </Card>
        </section>

        {/* ── Regimes ─────────────────────────────────────────────────── */}
        <section id="regimes">
          <SectionHeader
            style={headWrap}
            title="The four regimes"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="statistical" />
                <span>4-way softmax over growth and inflation trends</span>
              </span>
            }
          />
          <div style={{ display: "grid", gridTemplateColumns: twoUp, gap: 12 }}>
            {REGIME_DEFS.map((r) => (
              <Card key={r.name}>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 700, color: r.color }}>{r.name}</span>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", lineHeight: 1.55, marginTop: 4 }}>
                  {r.def}
                </div>
              </Card>
            ))}
          </div>
          <Caption>
            Monthly, from z-scored growth (industrial production, FRED INDPRO) and inflation (CPI) trends through a
            temperature-0.7 softmax; the four probabilities always sum to 100%. The header badge shows the dominant
            stored probability; conviction is a separate heuristic and is always labeled. Shares under 1% print as
            &lt;1%, never as a false 0%.{" "}
            <ModuleLink to="/app/dashboard">Dashboard →</ModuleLink> <ModuleLink to="/app/regime-lab">Regime Lab →</ModuleLink>
          </Caption>
        </section>

        {/* ── Signals ─────────────────────────────────────────────────── */}
        <section id="signals" style={{ minWidth: 0 }}>
          <SectionHeader
            style={headWrap}
            title="Monitored signals"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="statistical" />
                <span>
                  {signals.data ? `live thresholds · monthly cadence · latest print ${fmtMonYr(signals.data.date)}` : "live thresholds · monthly cadence"}
                </span>
              </span>
            }
          />
          <Card style={{ padding: 0 }}>
            <ScrollTable stickyFirst={false} label="Monitored signals">
              <div role="table" aria-label="Monitored signals" style={{ minWidth: 560 }}>
                <div role="row" style={{ display: "grid", gridTemplateColumns: "1.4fr 110px 110px 1fr", gap: 12, padding: "6px 12px", borderBottom: "1px solid var(--line-hair)" }}>
                  {["Signal", "Trigger", "Latest", "Status rule"].map((h, i) => (
                    <span key={h} role="columnheader" style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-wide)", color: "var(--text-muted)", textAlign: i === 1 || i === 2 ? "right" : "left" }}>
                      {h}
                    </span>
                  ))}
                </div>
                {signals.data
                  ? signals.data.signals.map((s, i) => (
                      <div key={s.signal_name} role="row" style={{ display: "grid", gridTemplateColumns: "1.4fr 110px 110px 1fr", gap: 12, padding: "8px 12px", background: i % 2 === 1 ? "rgba(255,255,255,.012)" : "transparent", alignItems: "baseline" }}>
                        <span role="cell" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                          {SIGNAL_NAMES[s.signal_name] ?? s.signal_name.replace(/_/g, " ")}
                        </span>
                        <span role="cell" style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right" }}>
                          {s.direction == null || s.threshold == null
                            ? "—"
                            : `${s.direction === "below" ? "<" : ">"} ${s.threshold}${SIGNAL_UNITS[s.signal_name] ?? ""}`}
                        </span>
                        <span role="cell" style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                          {s.value.toFixed(2)}
                          {SIGNAL_UNITS[s.signal_name] ?? ""}
                        </span>
                        <span role="cell" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
                          {s.status ?? "—"}
                          {s.distance_pct != null ? ` · ${Math.round(s.distance_pct)}% of trigger` : ""}
                        </span>
                      </div>
                    ))
                  : null}
              </div>
            </ScrollTable>
            {signals.data ? null : (
              <div style={{ padding: 12 }}>
                <StateNote loading={signals.isLoading} error={signals.isError} />
              </div>
            )}
            {signals.data && signals.data.signals.length === 0 ? (
              <div style={{ padding: 12 }}>
                <StateNote />
              </div>
            ) : null}
          </Card>
          <Caption>
            Trigger values and status arrive live from the API (the same payload the signal cards read); display names
            and units are presentation copy. One status rule for all five: the stored trigger flag owns Triggered;
            Watch starts at 50% threshold proximity; Clear is everything below. The weekly derived series on Markets
            and the live tape carry their own levels for the same metric, by cadence, not by error.{" "}
            <ModuleLink to="/app/dashboard#signals">Signals on the Dashboard →</ModuleLink>
          </Caption>
        </section>

        {/* ── Models ──────────────────────────────────────────────────── */}
        <section id="models">
          <SectionHeader
            style={headWrap}
            title="Models and scenarios"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="statistical" />
                <span>what is computed, and from what</span>
              </span>
            }
          />
          <div className="mrr-meth-cols">
            <Card>
              <div style={eyebrowStyle}>Recession model</div>
              <p style={{ ...prose, fontSize: "var(--fs-body-s)", marginTop: 6 }}>
                A class-balanced logistic regression trained on NBER recession months. Inputs: the 2s10s curve,
                unemployment, the high-yield spread, industrial-production growth and the 10Y − 5Y breakeven spread
                (T10YIE − T5YIE), standing in for the Conference Board leading index (USSLIND), which stopped
                publishing in February 2020. Features enter with a 3-month lag so the fit never peeks. The model retrains
                in-process from stored FRED series; there is no saved artifact. Its probability is the model&apos;s own,
                distinct from the classifier&apos;s Recession Risk odds.{" "}
                <ModuleLink to="/app/recession">Recession →</ModuleLink>
              </p>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Credit states and transitions</div>
              <p style={{ ...prose, fontSize: "var(--fs-body-s)", marginTop: 6 }}>
                ICE BofA option-adjusted spread indices (FRED BAMLH0A0HYM2, BAMLC0A0CM, and the BB / B / CCC ladders)
                classified into Normal, Tight, Stressed and Crisis by fixed bps rules; percentiles since 1996; 3- and
                6-month transition matrices counted from monthly states. CCC vs the distress line is CCC OAS as a
                percent of 1,000 bps; above 100% means past the line, not a share of issuers.{" "}
                <ModuleLink to="/app/credit">Credit →</ModuleLink>
              </p>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Scenario builder</div>
              <p style={{ ...prose, fontSize: "var(--fs-body-s)", marginTop: 6 }}>
                Five presets and custom shocks (HY spread, 10Y yield, VIX, S&amp;P 500) shift the stored regime odds
                through a transparent stress rule and renormalize. It sketches direction and rough size; it is not a
                rerun of the classifier and carries no forecast claim.{" "}
                <ModuleLink to="/app/regime-lab#scenarios">Scenarios →</ModuleLink>
              </p>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Allocation and LBO engines</div>
              <p style={{ ...prose, fontSize: "var(--fs-body-s)", marginTop: 6 }}>
                Allocation: ~24 years of monthly returns for ten asset classes, index-spliced before ETF inceptions,
                cut by stored regime months; seven optimizers (long-only, 40% cap) run only when the current regime
                has 24 contiguous months of covariance history. LBO: server-side deal math. Cash for debt service is 60% of
                EBITDA; it pays interest first, scheduled amortization is a floor and the remainder sweeps to debt,
                so a higher rate lowers the IRR. IRR by bisection on NPV; the financing rate defaults to Fed Funds
                plus the HY spread.{" "}
                <ModuleLink to="/app/tools#allocation">Allocation →</ModuleLink>{" "}
                <ModuleLink to="/app/tools#lbo">LBO →</ModuleLink>
              </p>
            </Card>
          </div>
        </section>

        {/* ── Backtests ───────────────────────────────────────────────── */}
        <section id="backtests">
          <SectionHeader
            style={headWrap}
            title="Backtests and evidence"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="statistical" />
                <span>stored empirical analysis</span>
              </span>
            }
          />
          <Card>
            <p style={prose}>
              Backtests measure SPY forward returns over trading-day horizons (1M = 21 days … 12M = 252 days) after
              each regime began or each signal fired, from the stored monthly classifier history. Fragile cells (four
              or fewer samples, or a perfect 100% / 0% hit rate) are flagged in the table; a 50% hit rate is a coin
              flip. Factor returns by regime use long/short ETF proxies for Value, Momentum, Quality, Size and Low
              Volatility, labeled as proxies. Historical analogues score regime match (40), HY-spread percentile
              proximity (25), recession-odds proximity (20) and VIX proximity (15) against seven studied periods: a
              study aid, not a prediction.{" "}
              <ModuleLink to="/app/regime-lab#backtests">Backtests →</ModuleLink>{" "}
              <ModuleLink to="/app/regime-lab#analogues">Analogues →</ModuleLink>
            </p>
          </Card>
        </section>

        {/* ── Ramps ───────────────────────────────────────────────────── */}
        <section id="ramps">
          <SectionHeader
            style={headWrap}
            title="Meaning ramps and vocabularies"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="reference" />
                <span>closed sets · the app never invents synonyms</span>
              </span>
            }
          />
          <div className="mrr-meth-cols">
            <Card>
              <div style={eyebrowStyle}>Threshold-proximity gauge</div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <LegendRow swatch="var(--pos)" label="< 50%" detail="Clear: comfortable distance from the trigger" />
                <LegendRow swatch="var(--amber)" label="50–75%" detail="Watch: inside striking distance" />
                <LegendRow swatch="var(--warn-hot)" label="75–95%" detail="approaching the trigger" />
                <LegendRow swatch="var(--neg)" label="≥ 95%" detail="at or past it: Triggered comes from the stored flag" />
              </div>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Recession-probability bands</div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <LegendRow swatch="var(--pos)" label="< 20%" detail="Low Risk" />
                <LegendRow swatch="var(--warn-hot)" label="20–40%" detail="Elevated" />
                <LegendRow swatch="var(--neg)" label="≥ 40%" detail="High Risk: gauge arc, badge, and this legend share one palette" />
              </div>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Freshness states</div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                <LegendRow swatch="var(--pos)" label="Current" detail="inside one publication cycle of its cadence (monthly: 45 days; daily: 4 days; intraday: 20 minutes)" />
                <LegendRow swatch="var(--amber)" label="Delayed" detail="one cycle late, still usable with its date stated" />
                <LegendRow swatch="var(--warn-hot)" label="Stale" detail="older than that: context, not a live read" />
                <LegendRow swatch="var(--neg-text)" label="Unavailable" detail="no stamp on file" />
                <LegendRow swatch="var(--text-muted)" label="Reference" detail="static content without a cadence" />
              </div>
            </Card>
            <Card>
              <div style={eyebrowStyle}>Status vocabularies</div>
              <div style={{ display: "grid", gap: 6, marginTop: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)", lineHeight: 1.6 }}>
                <span>
                  Signals: <Tag tone="pos" size="sm">Clear</Tag> <Tag tone="warn" size="sm">Watch</Tag>{" "}
                  <Tag tone="neg" size="sm">Triggered</Tag>
                </span>
                <span>Alerts: Informational · Watch · Risk. Market read: Risk-On · Risk-Off · Mixed. Model vs market: Aligned · Diverges.</span>
                <span>Credit states: Normal · Tight · Stressed · Crisis (HY / IG bps ladders on the Credit tab).</span>
                <span>News significance 1–5: ≥ 4.5 critical · ≥ 3.5 high impact · ≥ 2.5 notable · below routine.</span>
              </div>
            </Card>
          </div>
        </section>

        {/* ── Data ────────────────────────────────────────────────────── */}
        <section id="data">
          <SectionHeader
            style={headWrap}
            title="Data and sources"
            right={
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                <ProvenanceTag kind="data" />
                <span>every feed, its cadence, its citation</span>
              </span>
            }
          />
          <Card>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "180px minmax(0,1fr)", gap: "8px 16px" }}>
              {(
                [
                  ["FRED", "https://fred.stlouisfed.org", "Macro series (INDPRO, CPI, unemployment), daily Treasury yields (DGS2, DGS10), ICE BofA OAS indices, breakevens (T5YIE, T10YIE). Refreshed mornings ET; monthly and daily cadences."],
                  ["yfinance", "https://github.com/ranaroussi/yfinance", "Daily candles for the stored ETF universe; 5-minute bars for SPY and QQQ; on-demand quotes, candles and fundamentals for any listed symbol (delayed up to 15 minutes)."],
                  ["EODHD", "https://eodhd.com", "Live tape quotes over WebSocket: crypto and FX around the clock, US equities in session, 15-minute delayed REST fills off-hours. The token stays server-side."],
                  ["Finnhub · NewsAPI · RSS", "https://finnhub.io", "Headlines ingested hourly, deduplicated and scored on five dimensions; the top items each cycle receive a Claude regime interpretation and Perplexity-cited research."],
                  ["NBER", "https://www.nber.org/research/business-cycle-dating", "Official US recession dates: the recession model's training target and the shaded bands on history charts."],
                  ["Hand-maintained calendar", null, "FOMC, CPI, jobs and GDP dates through December 2026, kept by hand in a CSV; labeled as such wherever it renders."],
                ] as const
              ).map(([name, url, detail]) => (
                <div key={name} style={{ display: "contents" }}>
                  <dt style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text)", fontWeight: 600 }}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer" style={{ color: "var(--text)" }}>
                        {name} ↗
                      </a>
                    ) : (
                      name
                    )}
                  </dt>
                  <dd style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55, maxWidth: "var(--maxw-prose)" }}>
                    {detail}
                  </dd>
                </div>
              ))}
            </dl>
            <Caption>
              Every surface states its own as-of date and falls back to latest-available data with its date instead of
              an empty screen. Regimes and signals are monthly; market bars daily; intraday 5-minute for SPY and QQQ;
              news hourly with a rolling window.
            </Caption>
          </Card>
        </section>

        {/* ── Limits ──────────────────────────────────────────────────── */}
        <section id="limits">
          <SectionHeader style={headWrap} title="What the model can and cannot claim" right="Limits · read before acting on any number" />
          <Card accentBar>
            <p style={prose}>
              <b style={{ color: "var(--text)" }}>It can claim</b> that, on the stored monthly data, the economy sits in
              one of four quadrants with stated odds; that five monitored series stand at a stated distance from fixed
              thresholds; that a logistic model trained on NBER dates assigns a stated 12-month recession probability;
              that credit spreads sit at a stated percentile of their own history; and that, historically, SPY behaved
              in a stated way after similar readings, with sample sizes shown.
            </p>
            <p style={{ ...prose, marginTop: 10 }}>
              <b style={{ color: "var(--text)" }}>It cannot claim</b> a forecast of returns, the timing of a regime
              change, or causation. Playbooks, analogues and scenario rules are reference content and stress
              sketches, not measured outcomes. Small-sample backtests are anecdotes. Monthly inputs mean the regime
              read can lag the tape by weeks, and the freshness line says exactly how many. Every number here is a
              claim with its date attached; the desk reads state conclusions, and the audit trail underneath is how a
              reader checks them.
            </p>
            <Caption>
              Automated briefing from Macro Regime Radar. Not investment advice.
            </Caption>
          </Card>
        </section>
      </div>
    </div>
  );
}
