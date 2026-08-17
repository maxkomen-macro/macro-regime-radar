/**
 * Asset Allocation — overview (regime-conditional stats), optimization
 * (7 methods + efficient frontier), and risk analysis. Risk analysis is
 * paginated (locked IA: nothing over ~2.5 viewports) — one block at a time
 * behind a chip pager.
 *
 * Data: /api/allocation — computed by src/analytics/allocation.py from ~24y
 * of monthly asset returns (downloaded server-side, cached 1h). Methods that
 * need riskfolio-lib (Min CVaR, HERC) fall back to equal weight and say so.
 */

import { Fragment, useMemo, useState } from "react";
import { Card, SectionHeader, Tag } from "../../components";
import { Link } from "react-router-dom";
import { useAllocation } from "../../api/queries";
import type { FrameData } from "../../api/types";
import { fmtMonYr } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, eyebrowStyle, mono } from "../shared/screen-ui";
import FrontierChart, { type FrontierMarker } from "./FrontierChart";

const REGIME_ORDER = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
const REGIME_COLORS: Record<string, string> = {
  Goldilocks: "#2ecc71",
  Overheating: "#e67e22",
  Stagflation: "#e74c3c",
  "Recession Risk": "#95a5a6",
};

const METHODS: { key: string; label: string; badge: string; color: string }[] = [
  { key: "mvo", label: "Mean-Variance", badge: "return-based", color: "var(--accent)" },
  { key: "min_var", label: "Min Variance", badge: "risk-only", color: "var(--pos)" },
  { key: "risk_parity", label: "Risk Parity", badge: "risk-balanced", color: "var(--warn)" },
  { key: "black_litterman", label: "Black-Litterman", badge: "equilibrium + views", color: "var(--warn-hot)" },
  { key: "hrp", label: "HRP", badge: "hierarchical", color: "var(--research)" },
  { key: "cvar", label: "Min CVaR", badge: "tail-risk", color: "var(--neg-text)" },
  { key: "herc", label: "HERC", badge: "hierarchical", color: "var(--text-muted)" },
];

const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
const spct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;

/** Only an explicit converged:false (or a "(fallback)" method name) marks a
 * fallback — the source omits the flag entirely on some success paths. */
const isFallback = (o: { converged?: boolean; method?: string } | undefined) =>
  o != null && (o.converged === false || (o.method ?? "").includes("(fallback)"));

const cellHead: React.CSSProperties = {
  ...mono,
  fontSize: 9,
  letterSpacing: "var(--ls-wide)",
  textTransform: "uppercase",
  color: "var(--text-muted)",
  textAlign: "right",
  padding: "4px 8px",
};

const rowLabel: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-body-s)",
  color: "var(--text-2)",
  padding: "4px 0",
  whiteSpace: "nowrap",
};

function retBg(v: number | null): string {
  if (v == null) return "transparent";
  if (v >= 0.1) return "rgba(46,204,113,.14)";
  if (v >= 0.05) return "rgba(46,204,113,.07)";
  if (v >= 0) return "transparent";
  if (v >= -0.05) return "rgba(218,54,51,.07)";
  return "rgba(218,54,51,.14)";
}

function corrBg(v: number | null): string {
  if (v == null) return "transparent";
  if (v >= 0.8) return "rgba(218,54,51,.30)";
  if (v >= 0.5) return "rgba(218,54,51,.18)";
  if (v >= 0.2) return "rgba(218,54,51,.08)";
  if (v >= -0.2) return "transparent";
  if (v >= -0.5) return "rgba(74,158,255,.12)";
  return "rgba(74,158,255,.22)";
}

const RISK_BLOCKS = [
  { id: "factors", label: "Factors" },
  { id: "style", label: "Style" },
  { id: "tail", label: "Tail risk" },
  { id: "transitions", label: "Transition P&L" },
  { id: "currency", label: "Currency" },
  { id: "real", label: "Real vs nominal" },
  { id: "correlation", label: "Correlation" },
  { id: "drawdowns", label: "Drawdowns" },
] as const;

function frameCell(f: FrameData, rowIdx: number, col: string): number | null {
  const ci = f.columns.indexOf(col);
  if (ci === -1) return null;
  return f.data[rowIdx]?.[ci] ?? null;
}

export default function AllocationPanel() {
  const q = useAllocation();
  const a = q.data;
  const [riskBlock, setRiskBlock] = useState<(typeof RISK_BLOCKS)[number]["id"]>("factors");
  const [corrRegime, setCorrRegime] = useState<string | null>(null);
  const [styleRegime, setStyleRegime] = useState<string | null>(null);
  const [transPair, setTransPair] = useState<string | null>(null);

  const regimes = useMemo(
    () => (a ? REGIME_ORDER.filter((r) => a.regime_stats[r]) : []),
    [a],
  );

  if (!a) {
    return (
      <Card>
        <StateNote loading={q.isLoading} error={q.isError}>
          {q.isLoading
            ? "Building ~24 years of monthly return history — a first load can take up to a minute."
            : undefined}
        </StateNote>
        {q.isLoading && (
          <Caption>
            Ten asset classes, seven optimizers, and the full risk block compute fresh from the
            return history each session.
          </Caption>
        )}
      </Card>
    );
  }

  const names = a.optimizations.asset_names;
  const curRegime = a.current_regime;
  const effCorrRegime = corrRegime ?? curRegime;
  const effStyleRegime = styleRegime ?? curRegime;

  const transPairs = Object.entries(a.transition_pnl)
    .filter(([, v]) => v.count >= 2)
    .map(([k]) => k);
  const effTransPair = transPair ?? transPairs[0] ?? null;

  // Plain derivation, deliberately NOT a hook: any hook after the loading
  // early-return changes the hook count when data lands (crashed live —
  // "Rendered more hooks than during the previous render").
  const frontierMarkers: FrontierMarker[] = METHODS.filter(
    (m) => a.optimizations[m.key] && !isFallback(a.optimizations[m.key]),
  ).map((m) => ({
    label: m.label,
    vol: a.optimizations[m.key].volatility,
    ret: a.optimizations[m.key].expected_return,
    color: m.color,
  }));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Overview ──────────────────────────────────────────────────── */}
      <section id="allocation-overview">
        <SectionHeader
          title="Regime-conditional performance"
          right={`${a.n_months} months · ${fmtMonYr(`${a.data_start}-01`)} → ${fmtMonYr(`${a.data_end}-01`)} · risk-free ${pct(a.rf_rate, 2)} (Fed Funds)`}
        />
        <Card>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 10 }}>
            {/* Regime chip wears the regime's own 12%/25% treatment, matching
                the column header 30px below — not the accent (critique). */}
            <span
              style={{
                ...mono,
                fontSize: "var(--fs-micro)",
                letterSpacing: "var(--ls-micro)",
                textTransform: "uppercase",
                fontWeight: 700,
                color: REGIME_COLORS[curRegime] ?? "var(--text)",
                background: `color-mix(in srgb, ${REGIME_COLORS[curRegime] ?? "#8b949e"} 12%, transparent)`,
                border: `0.5px solid color-mix(in srgb, ${REGIME_COLORS[curRegime] ?? "#8b949e"} 25%, transparent)`,
                borderRadius: "var(--r-xs)",
                padding: "2px 8px",
              }}
            >
              {curRegime}
            </span>
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
              {a.dominant_prob != null ? `${Math.round(a.dominant_prob * 100)}% model odds` : ""}
              {" · "}
              <Jargon term="conviction">conviction</Jargon> {Math.round(a.confidence * 100)}% (a
              separate heuristic, not odds) — read the current column first
            </span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: `150px repeat(${regimes.length}, 1fr)`,
                gap: "2px 8px",
                minWidth: 640,
              }}
            >
              <span />
              {regimes.map((r) => (
                <span key={r} style={{ ...cellHead, color: r === curRegime ? REGIME_COLORS[r] : "var(--text-muted)" }}>
                  {r}
                  {r === curRegime ? " ←" : ""}
                </span>
              ))}
              {names.map((asset) => (
                <Fragment key={asset}>
                  <span key={`${asset}-l`} style={rowLabel}>
                    {asset}
                  </span>
                  {regimes.map((r) => {
                    const s = a.regime_stats[r];
                    const m = s?.mean?.[asset] ?? null;
                    const sr = s?.sharpe?.[asset] ?? null;
                    return (
                      <span
                        key={`${asset}-${r}`}
                        style={{
                          ...mono,
                          fontSize: "var(--fs-meta)",
                          textAlign: "right",
                          padding: "4px 8px",
                          borderRadius: "var(--r-xs)",
                          background: retBg(m),
                        }}
                      >
                        <span style={{ color: m != null && m < 0 ? "var(--neg-text)" : "var(--text)" }}>
                          {m != null ? spct(m) : "—"}
                        </span>
                        <span style={{ color: "var(--text-muted)" }}>
                          {" "}
                          · SR {sr != null ? sr.toFixed(2) : "—"}
                        </span>
                      </span>
                    );
                  })}
                </Fragment>
              ))}
              <span style={{ ...rowLabel, color: "var(--text-muted)" }}>months in regime</span>
              {regimes.map((r) => (
                <span key={`${r}-n`} style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: "var(--text-muted)" }}>
                  n={a.regime_stats[r].n_months}
                </span>
              ))}
            </div>
          </div>
          <Caption>
            Annualized return and <Jargon term="Sharpe">Sharpe</Jargon> per regime since{" "}
            {fmtMonYr(`${a.data_start}-01`)}.{" "}
            {(() => {
              // Cite a REAL positive-return / negative-Sharpe cell — the
              // combination the table exists to expose.
              for (const r of regimes) {
                const s = a.regime_stats[r];
                for (const asset of names) {
                  const m = s?.mean?.[asset];
                  const sr = s?.sharpe?.[asset];
                  if (m != null && sr != null && m > 0 && sr < 0) {
                    return (
                      <>
                        A positive return with a negative Sharpe — {asset} prints {spct(m)} in{" "}
                        {r} at SR {sr.toFixed(2)} — means the return does not cover cash plus
                        the risk taken.
                      </>
                    );
                  }
                }
              }
              return <>A negative Sharpe means the return does not cover cash plus the risk taken.</>;
            })()}{" "}
            Small n columns are anecdotes, not laws.
          </Caption>
        </Card>
      </section>

      {/* ── Optimization ──────────────────────────────────────────────── */}
      <section id="allocation-optimization">
        <SectionHeader title="Optimization" right="max 40% per asset · long-only" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          {METHODS.map((m) => {
            const o = a.optimizations[m.key];
            if (!o) return null;
            return (
              <Card key={m.key}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                  <span style={eyebrowStyle}>{m.label}</span>
                  <Tag tone={isFallback(o) ? "warn" : "neutral"} size="sm">
                    {isFallback(o) ? "fallback" : m.badge}
                  </Tag>
                </div>
                <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, marginTop: 6 }}>
                  {spct(o.expected_return)}
                </div>
                <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                  {/* Fallback paths report sharpe_ratio=0.0 unconditionally —
                      printing it beside +10.5%/8.7% vol is an arithmetic lie
                      (critique P0). */}
                  vol {pct(o.volatility)} · SR {isFallback(o) ? "—" : o.sharpe_ratio.toFixed(2)}
                </div>
                {isFallback(o) && (
                  <div style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", marginTop: 2 }}>
                    equal weight — Sharpe not computed
                  </div>
                )}
              </Card>
            );
          })}
          <Card>
            <div style={eyebrowStyle}>How to read the methods</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.6, marginTop: 6 }}>
              Return-seekers (<Jargon term="efficient frontier">Mean-Variance</Jargon>,{" "}
              <Jargon term="Black-Litterman">Black-Litterman</Jargon>) chase the regime&apos;s
              historical returns; risk shops (Min Variance,{" "}
              <Jargon term="risk parity">Risk Parity</Jargon>, <Jargon term="HRP">HRP</Jargon>)
              ignore returns and budget risk; tail methods (<Jargon term="CVaR">Min CVaR</Jargon>,{" "}
              <Jargon term="HERC">HERC</Jargon>) target the worst months.
            </div>
          </Card>
        </div>
        <Caption>
          Seven ways to slice the same {names.length} assets — different questions, not
          better/worse answers. Min CVaR and HERC are unavailable this session; both show equal
          weight, tagged fallback.
        </Caption>

        <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 12, marginTop: 12 }}>
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>
              Efficient frontier · annualized risk vs return
            </div>
            <FrontierChart frontier={a.optimizations.frontier} markers={frontierMarkers} />
            <Caption>
              The <Jargon term="efficient frontier">frontier</Jargon> is the best return available
              at each volatility under the 40% cap; the marked portfolios are where each method
              lands. Equal-weight fallbacks (Min CVaR, HERC) are omitted from the plane.
            </Caption>
          </Card>
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Weights by method · %</div>
            <div style={{ overflowX: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: `130px repeat(${METHODS.length}, 1fr)`, gap: "1px 4px", minWidth: 480 }}>
                <span />
                {METHODS.map((m) => (
                  <span key={m.key} style={{ ...cellHead, padding: "2px 4px", fontSize: 8 }}>
                    {m.key === "black_litterman" ? "B-L" : m.label}
                  </span>
                ))}
                {names.map((asset, ai) => (
                  <Fragment key={asset}>
                    <span key={`${asset}-w`} style={{ ...rowLabel, fontSize: "var(--fs-meta)" }}>
                      {asset}
                    </span>
                    {METHODS.map((m) => {
                      const w = a.optimizations[m.key]?.weights?.[ai] ?? null;
                      return (
                        <span
                          key={`${asset}-${m.key}`}
                          style={{
                            ...mono,
                            fontSize: "var(--fs-micro)",
                            textAlign: "right",
                            padding: "3px 4px",
                            color: w != null && w > 0.005 ? "var(--text)" : "var(--text-faint)",
                            background: w != null && w >= 0.3 ? "rgba(74,158,255,.10)" : "transparent",
                          }}
                        >
                          {w != null ? `${Math.round(w * 100)}` : "—"}
                        </span>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            <Caption>Cells at the 30%+ concentration edge tint blue; zeros sit faint.</Caption>
          </Card>
        </div>
      </section>

      {/* ── Risk analysis (paginated) ─────────────────────────────────── */}
      <section id="allocation-risk">
        <SectionHeader title="Risk analysis" right="eight lenses · paginated" />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {RISK_BLOCKS.map((b) => (
            <button
              key={b.id}
              onClick={() => setRiskBlock(b.id)}
              aria-pressed={riskBlock === b.id}
              style={{
                appearance: "none",
                cursor: "pointer",
                background: riskBlock === b.id ? "rgba(74,158,255,.12)" : "none",
                border: riskBlock === b.id ? "0.5px solid rgba(74,158,255,.4)" : "0.5px solid var(--line-hair)",
                borderRadius: "var(--r-xs)",
                padding: "2px 8px",
                ...mono,
                fontSize: "var(--fs-micro)",
                letterSpacing: "var(--ls-micro)",
                textTransform: "uppercase",
                color: riskBlock === b.id ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>

        {riskBlock === "factors" && (
          <Card>
            {/* The factor × regime table's single home is Regime Lab →
                Backtests (it appeared verbatim in both places — critique);
                this lens keeps the portfolio-level betas. */}
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Portfolio factor exposures · OLS betas</div>
            <div style={{ display: "grid", gap: 6 }}>
              {METHODS.filter((m) => a.portfolio_factors[m.key]).map((m) => {
                const pf = a.portfolio_factors[m.key];
                if (!pf) return null;
                const fb = isFallback(a.optimizations[m.key]);
                return (
                  <div key={m.key} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-2)", minWidth: 130 }}>
                      {m.label}
                      {fb ? <span style={{ color: "var(--text-muted)" }}> (fallback)</span> : ""}
                    </span>
                    {Object.entries(pf.exposures).map(([f, b]) => (
                      <span key={f} style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                        {f} <span style={{ color: b >= 0 ? "var(--text)" : "var(--neg-text)" }}>{b >= 0 ? "+" : ""}{b.toFixed(2)}</span>
                      </span>
                    ))}
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "auto" }}>
                      <Jargon term="R²">R²</Jargon> {pf.r_squared.toFixed(2)} ·{" "}
                      <Jargon term="alpha">α</Jargon> {spct(pf.alpha)}/yr
                    </span>
                  </div>
                );
              })}
            </div>
            <Caption>
              Factors are long/short ETF proxies (Value IWD−IWF, Momentum MTUM−SPY, Quality
              QUAL−SPY, Size IWM−SPY, Low Vol USMV−SPY) — the Fama-French idea without their data
              files, labeled as such. Betas come from OLS on monthly overlaps. The factor × regime
              return table lives on{" "}
              <Link to="/app/regime-lab#backtests" style={{ color: "var(--accent)" }}>
                Regime Lab → Backtests
              </Link>
              .
            </Caption>
          </Card>
        )}

        {riskBlock === "style" && (
          <Card>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "baseline" }}>
              <span style={eyebrowStyle}>Style performance in</span>
              {regimes.map((r) => (
                <button
                  key={r}
                  onClick={() => setStyleRegime(r)}
                  aria-pressed={effStyleRegime === r}
                  style={{
                    appearance: "none",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    padding: 0,
                    ...mono,
                    fontSize: "var(--fs-meta)",
                    color: effStyleRegime === r ? REGIME_COLORS[r] : "var(--text-muted)",
                    fontWeight: effStyleRegime === r ? 700 : 400,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            {a.style_performance?.[effStyleRegime] ? (
              <div style={{ display: "grid", gridTemplateColumns: "140px repeat(4,1fr)", gap: "2px 8px" }}>
                {["", "Return", "Vol", "Sharpe", "Hit rate"].map((h, i) => (
                  <span key={h || "corner"} style={i ? cellHead : undefined}>
                    {h}
                  </span>
                ))}
                {Object.entries(a.style_performance[effStyleRegime])
                  .sort((x, y) => (y[1].sharpe ?? 0) - (x[1].sharpe ?? 0))
                  .map(([style, s]) => (
                    <Fragment key={style}>
                      <span key={style} style={rowLabel}>
                        {style}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: s.return < 0 ? "var(--neg-text)" : "var(--text)" }}>
                        {spct(s.return)}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: "var(--text-muted)" }}>
                        {pct(s.volatility)}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px" }}>
                        {s.sharpe.toFixed(2)}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: "var(--text-muted)" }}>
                        {pct(s.hit_rate, 0)}
                      </span>
                    </Fragment>
                  ))}
              </div>
            ) : (
              <StateNote>Style history unavailable for this regime (needs ≥6 months).</StateNote>
            )}
            <Caption>
              Annualized style returns inside {effStyleRegime} months only.{" "}
              <Jargon term="hit rate">Hit rate</Jargon> is the share of those months that finished
              positive — read it against the month count, not as gospel.
            </Caption>
          </Card>
        )}

        {riskBlock === "tail" && (
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
              <div>
                <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Asset tail risk · monthly, 95%</div>
                <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 70px 70px", gap: "2px 8px", alignItems: "center" }}>
                  <span />
                  <span />
                  <span style={cellHead}>CVaR</span>
                  <span style={cellHead}>VaR</span>
                  {Object.entries(a.cvar_95?.asset_cvar ?? {}).map(([asset, c]) => (
                    <Fragment key={asset}>
                      <span key={asset} style={rowLabel}>
                        {asset}
                      </span>
                      <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.min((Math.abs(c.cvar) / 0.2) * 100, 100)}%`, background: "var(--neg)" }} />
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", color: "var(--neg-text)" }}>
                        {spct(c.cvar)}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", color: "var(--text-muted)" }}>
                        {spct(c.var)}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Portfolio CVaR by method</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {METHODS.map((m) => {
                    const o = a.optimizations[m.key];
                    if (!o || o.cvar_95 == null) return null;
                    return (
                      <div key={m.key} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                        <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                          {m.label}
                          {isFallback(o) ? " (fallback)" : ""}
                        </span>
                        <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--neg-text)" }}>{spct(o.cvar_95)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <Caption>
              <Jargon term="CVaR">CVaR</Jargon> is the average loss in the worst 5% of months —
              deeper than VaR, which is only the doorway into them. Bars scale to a −20% monthly
              loss.
            </Caption>
          </Card>
        )}

        {riskBlock === "transitions" && (
          <Card>
            <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={eyebrowStyle}>Forward 3M returns after</span>
              {transPairs.map((p) => (
                <button
                  key={p}
                  onClick={() => setTransPair(p)}
                  aria-pressed={effTransPair === p}
                  style={{
                    appearance: "none",
                    cursor: "pointer",
                    background: effTransPair === p ? "rgba(74,158,255,.12)" : "none",
                    border: "0.5px solid var(--line-hair)",
                    borderRadius: "var(--r-xs)",
                    padding: "2px 8px",
                    ...mono,
                    fontSize: "var(--fs-micro)",
                    color: effTransPair === p ? "var(--accent)" : "var(--text-muted)",
                  }}
                >
                  {p} · n={a.transition_pnl[p].count}
                </button>
              ))}
            </div>
            {effTransPair && a.transition_pnl[effTransPair] ? (
              <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px", gap: "2px 8px", alignItems: "center" }}>
                {Object.entries(a.transition_pnl[effTransPair].avg_return).map(([asset, r]) => (
                  <Fragment key={asset}>
                    <span key={asset} style={rowLabel}>
                      {asset}
                    </span>
                    <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden", position: "relative" }}>
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${Math.min((Math.abs(r) / 0.15) * 100, 100)}%`,
                          background: r >= 0 ? "var(--pos)" : "var(--neg)",
                        }}
                      />
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", color: r >= 0 ? "var(--pos)" : "var(--neg-text)" }}>
                      {spct(r)}
                    </span>
                  </Fragment>
                ))}
              </div>
            ) : (
              <StateNote>No regime switch has repeated often enough to average (needs n ≥ 2).</StateNote>
            )}
            <Caption>
              Average asset return in the three months after each historical regime switch. Sample
              counts are tiny by nature — this is a map of what happened, not a forecast.
            </Caption>
          </Card>
        )}

        {riskBlock === "currency" && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Currency moves by regime · annualized</div>
            {a.currency_impact && Object.keys(a.currency_impact).length ? (
              <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${regimes.length},1fr)`, gap: "2px 8px" }}>
                <span />
                {regimes.map((r) => (
                  <span key={r} style={cellHead}>
                    {r}
                  </span>
                ))}
                {[
                  ...new Set(Object.values(a.currency_impact).flatMap((byPair) => Object.keys(byPair))),
                ].map((pair) => (
                  <Fragment key={pair}>
                    <span key={pair} style={rowLabel}>
                      {pair}
                    </span>
                    {regimes.map((r) => {
                      const c = a.currency_impact?.[r]?.[pair];
                      return (
                        <span key={`${pair}-${r}`} style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px" }}>
                          {c ? (
                            <>
                              <span style={{ color: c.return < 0 ? "var(--neg-text)" : "var(--text)" }}>{spct(c.return)}</span>
                              <span style={{ color: "var(--text-muted)" }}> · σ{pct(c.volatility, 0)}</span>
                            </>
                          ) : (
                            "—"
                          )}
                        </span>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            ) : (
              <StateNote>Currency history unavailable from the vendor this session.</StateNote>
            )}
            <Caption>
              Dollar strength is a regime variable: EM FX and the majors swing sign across regimes,
              which is what an unhedged international sleeve actually feels.
            </Caption>
          </Card>
        )}

        {riskBlock === "real" && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>
              Real vs nominal · {curRegime} months (n={a.real_nominal[curRegime]?.n_months ?? "—"})
            </div>
            {a.real_nominal[curRegime] ? (
              <div style={{ display: "grid", gridTemplateColumns: "150px repeat(3,1fr)", gap: "2px 8px" }}>
                <span />
                {["Nominal", "Real", "Inflation drag"].map((h) => (
                  <span key={h} style={cellHead}>
                    {h}
                  </span>
                ))}
                {Object.keys(a.real_nominal[curRegime].nominal).map((asset) => {
                  const rn = a.real_nominal[curRegime];
                  const nom = rn.nominal[asset];
                  const real = rn.real[asset];
                  const eroded = nom > 0 && real < 0;
                  return (
                    <Fragment key={asset}>
                      <span style={rowLabel}>
                        {asset}
                        {eroded ? <span style={{ color: "var(--warn)" }}> ▪ eroded</span> : ""}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px" }}>{spct(nom)}</span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: real < 0 ? "var(--neg-text)" : "var(--text)" }}>
                        {spct(real)}
                      </span>
                      <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: "var(--text-muted)" }}>
                        {spct(rn.inflation_drag[asset] ?? 0)}
                      </span>
                    </Fragment>
                  );
                })}
              </div>
            ) : (
              <StateNote>No inflation-adjusted view for this regime.</StateNote>
            )}
            <Caption>
              CPI-deflated returns inside the current regime. ▪ eroded marks assets whose nominal
              gain turns into a real loss — the quiet failure mode of inflationary regimes.
            </Caption>
          </Card>
        )}

        {riskBlock === "correlation" && (
          <Card>
            <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "baseline" }}>
              <span style={eyebrowStyle}>Correlations in</span>
              {regimes.map((r) => (
                <button
                  key={r}
                  onClick={() => setCorrRegime(r)}
                  aria-pressed={effCorrRegime === r}
                  style={{
                    appearance: "none",
                    cursor: "pointer",
                    background: "none",
                    border: "none",
                    padding: 0,
                    ...mono,
                    fontSize: "var(--fs-meta)",
                    color: effCorrRegime === r ? REGIME_COLORS[r] : "var(--text-muted)",
                    fontWeight: effCorrRegime === r ? 700 : 400,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            {a.regime_correlations[effCorrRegime] ? (
              <div style={{ overflowX: "auto" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `130px repeat(${a.regime_correlations[effCorrRegime].columns.length}, 1fr)`,
                    gap: 1,
                    minWidth: 700,
                  }}
                >
                  <span />
                  {a.regime_correlations[effCorrRegime].columns.map((c) => (
                    <span key={c} style={{ ...mono, fontSize: 8, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--text-muted)", textAlign: "center", padding: "2px 1px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                      {c.replace("US ", "")}
                    </span>
                  ))}
                  {a.regime_correlations[effCorrRegime].index.map((rowName, ri) => (
                    <Fragment key={String(rowName)}>
                      <span key={String(rowName)} style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "3px 4px" }}>
                        {String(rowName)}
                      </span>
                      {a.regime_correlations[effCorrRegime].columns.map((col, ci) => {
                        const v = a.regime_correlations[effCorrRegime].data[ri]?.[ci] ?? null;
                        return (
                          <span key={`${rowName}-${col}`} style={{ ...mono, fontSize: "var(--fs-micro)", textAlign: "center", padding: "3px 1px", background: ri === ci ? "transparent" : corrBg(v), color: ri === ci ? "var(--text-faint)" : "var(--text-2)" }}>
                            {v != null ? v.toFixed(2) : "—"}
                          </span>
                        );
                      })}
                    </Fragment>
                  ))}
                </div>
              </div>
            ) : (
              <StateNote>Not enough months in this regime for a stable matrix.</StateNote>
            )}
            <Caption>
              Red cells cluster together in stress — diversification that exists on paper
              (Goldilocks) and disappears when needed is the point of checking per regime. Blue
              cells are the true diversifiers.
            </Caption>
          </Card>
        )}

        {riskBlock === "drawdowns" && !a.drawdowns?.by_regime?.columns && (
          <Card>
            <StateNote>Drawdown history unavailable in this payload.</StateNote>
          </Card>
        )}
        {riskBlock === "drawdowns" && a.drawdowns?.by_regime?.columns && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 8 }}>Maximum drawdown · by regime and overall</div>
            <div style={{ display: "grid", gridTemplateColumns: `150px repeat(${a.drawdowns.by_regime.columns.length + 1},1fr)`, gap: "2px 8px" }}>
              <span />
              {a.drawdowns.by_regime.columns.map((c) => (
                <span key={c} style={cellHead}>
                  {c}
                </span>
              ))}
              <span style={cellHead}>Overall</span>
              {a.drawdowns.by_regime.index.map((asset, ri) => (
                <Fragment key={String(asset)}>
                  <span key={String(asset)} style={rowLabel}>
                    {String(asset)}
                  </span>
                  {a.drawdowns.by_regime.columns.map((col) => {
                    const v = frameCell(a.drawdowns.by_regime, ri, col);
                    const color = v == null ? "var(--text-muted)" : v < -0.3 ? "var(--neg-text)" : v < -0.15 ? "var(--warn-hot)" : "var(--text-muted)";
                    return (
                      <span key={`${asset}-${col}`} style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color }}>
                        {v != null ? spct(v) : "—"}
                      </span>
                    );
                  })}
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", fontWeight: 600, color: (a.drawdowns.overall[String(asset)] ?? 0) < -0.3 ? "var(--neg-text)" : "var(--text)" }}>
                    {a.drawdowns.overall[String(asset)] != null ? spct(a.drawdowns.overall[String(asset)]) : "—"}
                  </span>
                </Fragment>
              ))}
            </div>
            <Caption>
              Worst peak-to-trough loss per asset, split by the regime it happened in. A −50%{" "}
              <Jargon term="drawdown">drawdown</Jargon> needs +100% to recover — the asymmetry is
              the whole argument for risk budgeting.
            </Caption>
          </Card>
        )}
      </section>

      <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Monthly total returns for 10 asset classes, index-spliced before ETF inceptions · computed
        by the same allocation engine each session · regimes from the stored classifier history.
      </div>
    </div>
  );
}
