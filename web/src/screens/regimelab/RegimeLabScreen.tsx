/**
 * Regime Lab — locked IA: takeaway + playbook, cycle position, transition
 * outlook, historical analogues, scenario builder (debounced POST), regime
 * history Gantt, backtests + factor attribution.
 *
 * Everything quantitative arrives from /api/regime/* and /api/backtests —
 * the client renders and captions, it never re-derives. Static reference
 * content (playbooks, analogue corpus, scenario definitions) is labeled as
 * such. Confusion-index items covered here: #12 small-sample hit rates,
 * #13 risk-indicator windows, #21 cohort names, #22 coin-flip line,
 * #23 regime-spell percentile.
 */

import { Fragment, useMemo, useState } from "react";
import { Card, ProbabilityBar, SectionHeader, Tag } from "../../components";
import {
  useAllocation,
  useAnalogues,
  useBacktests,
  useRegimeDuration,
  useRegimeHistory,
  useRegimeLatest,
  useRegimePlaybooks,
  useScenarioDefs,
  useScenarioRun,
  useTakeaway,
  useTransitions,
} from "../../api/queries";
import type { Regime, ScenarioShocks } from "../../api/types";
import { fmtMonYr, ordinal } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { Caption, SliderRow, StateNote, eyebrowStyle, mono, useDebounced, useHashScroll } from "../shared/screen-ui";

const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as const;
const REGIME_COLORS: Record<string, string> = {
  Goldilocks: "#2ecc71",
  Overheating: "#e67e22",
  Stagflation: "#e74c3c",
  "Recession Risk": "#95a5a6",
};

/** Render the source module's <strong> emphasis without injecting HTML. */
function parseStrong(narrative: string): React.ReactNode[] {
  return narrative.split(/<strong>(.*?)<\/strong>/g).map((seg, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: "var(--text)", fontWeight: 600 }}>
        {seg}
      </strong>
    ) : (
      <span key={i}>{seg}</span>
    ),
  );
}

/* ── Takeaway + playbook ─────────────────────────────────────────────────── */

function TakeawaySection() {
  const q = useTakeaway();
  const t = q.data;
  if (!t) {
    return (
      <Card accentBar>
        <StateNote loading={q.isLoading} error={q.isError}>
          {q.isLoading ? "Assembling the market takeaway — cold call trains the recession model once." : undefined}
        </StateNote>
      </Card>
    );
  }
  return (
    <Card accentBar>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", marginBottom: 8 }}>
        <span style={eyebrowStyle}>Market takeaway</span>
        <Tag tone={t.conviction === "High" ? "pos" : t.conviction === "Low" ? "warn" : "neutral"} size="sm">
          {t.conviction} conviction
        </Tag>
        <Tag tone={t.primary_signal === "Risk-On" ? "pos" : t.primary_signal === "Risk-Off" ? "neg" : "neutral"} size="sm">
          {t.primary_signal}
        </Tag>
        <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "auto" }}>
          regime data as of {t.updated_ago}
        </span>
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body)", color: "var(--text-2)", lineHeight: 1.6, maxWidth: "74ch" }}>
        {parseStrong(t.narrative)}
      </div>
      {t.divergences.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {t.divergences.map((d) => (
            <div key={d} style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--warn)" }}>
              ▪ <Jargon term="divergence">divergence</Jargon>: {d}
            </div>
          ))}
        </div>
      )}
      <Caption>
        Composed from the stored regime odds, credit metrics and the recession model —{" "}
        <Jargon term="conviction">conviction</Jargon> drops when the top odds are thin or the
        inputs disagree.
      </Caption>
    </Card>
  );
}

function PlaybookSection({ currentRegime }: { currentRegime: string | undefined }) {
  const q = useRegimePlaybooks();
  const [selected, setSelected] = useState<string | null>(null);
  const active = selected ?? currentRegime ?? "Goldilocks";
  const pb = q.data?.[active];
  return (
    <section id="playbook">
      <SectionHeader title="Playbook" right="static reference · not live data" />
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {REGIMES.map((r) => (
          <button
            key={r}
            onClick={() => setSelected(r)}
            aria-pressed={active === r}
            style={{
              appearance: "none",
              cursor: "pointer",
              background: active === r ? "rgba(74,158,255,.10)" : "none",
              border: active === r ? `0.5px solid ${REGIME_COLORS[r]}66` : "0.5px solid var(--line-hair)",
              borderRadius: "var(--r-xs)",
              padding: "3px 10px",
              ...mono,
              fontSize: "var(--fs-micro)",
              letterSpacing: "var(--ls-micro)",
              textTransform: "uppercase",
              color: active === r ? REGIME_COLORS[r] : "var(--text-muted)",
            }}
          >
            {r}
            {r === currentRegime ? " ← now" : ""}
          </button>
        ))}
      </div>
      {pb ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr 1fr", gap: 12 }}>
          <Card>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", lineHeight: 1.6 }}>
              {pb.description}
            </div>
            <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 8 }}>
              ~{pb.historical_frequency.toFixed(0)}% of months in the literature · literature avg
              spell {pb.avg_duration_months.toFixed(1)}mo — the measured number lives in Cycle
              position below
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px", marginTop: 10 }}>
              {Object.entries(pb.asset_performance).map(([asset, p]) => (
                <div key={asset} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{asset}</span>
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", color: p.avg_return >= 0 ? "var(--pos)" : "var(--neg-text)" }}>
                    {p.avg_return >= 0 ? "+" : ""}
                    {p.avg_return.toFixed(1)}%/yr · {p.hit_rate.toFixed(0)}% hit
                  </span>
                </div>
              ))}
            </div>
            <Caption>
              Typical tape: curve {pb.typical_indicators.yield_curve?.toLowerCase()}, spreads{" "}
              {pb.typical_indicators.credit_spreads?.toLowerCase()}, VIX{" "}
              {pb.typical_indicators.vix_regime?.toLowerCase()}. Reference numbers from the regime
              literature — the backtests section below is what this app measured itself.
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Sector tilts · strength 0–100</div>
            {(["overweight", "underweight"] as const).map((side) => (
              <div key={side} style={{ marginTop: 8 }}>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", color: side === "overweight" ? "var(--pos)" : "var(--neg-text)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase" }}>
                  {side}
                </div>
                {pb.sector_tilts[side].map((t) => (
                  <div key={t.sector} style={{ display: "grid", gridTemplateColumns: "1fr 80px 34px", gap: 8, alignItems: "center", marginTop: 4 }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{t.sector}</span>
                    <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.min(t.strength, 100)}%`, background: side === "overweight" ? "var(--pos)" : "var(--neg)" }} />
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", textAlign: "right" }}>{t.strength}</span>
                  </div>
                ))}
              </div>
            ))}
            <Caption>
              Tilt strength runs 0–100 — conviction of the tilt in this playbook, not a return
              forecast.
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Risks & catalysts</div>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {(
                [
                  ["Key risks", pb.key_risks, "var(--neg-text)"],
                  ["Warning signs", pb.warning_signs, "var(--warn)"],
                  ["Typical catalysts", pb.typical_catalysts, "var(--accent)"],
                  ["Opportunities", pb.opportunities, "var(--pos)"],
                ] as const
              ).map(([label, items, color]) => (
                <div key={label}>
                  <div style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color }}>
                    {label}
                  </div>
                  {items.slice(0, 3).map((it) => (
                    <div key={it} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.5 }}>
                      · {it}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : (
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
    </section>
  );
}

/* ── Cycle position ──────────────────────────────────────────────────────── */

function CycleSection() {
  const q = useRegimeDuration();
  const d = q.data;
  return (
    <section id="cycle">
      <SectionHeader title="Cycle position" right="spell length vs 30 years of stored history" />
      {d ? (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
          <Card>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{ ...mono, fontSize: 30, fontWeight: 700 }}>{d.months_in_regime.toFixed(0)}mo</span>
              <Tag tone={d.status === "Early" ? "pos" : d.status === "Mid-Cycle" ? "accent" : d.status === "Extended" ? "warn" : "neg"} size="sm">
                {d.status}
              </Tag>
            </div>
            <div style={{ height: 5, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden", marginTop: 10 }}>
              <div style={{ height: "100%", width: `${Math.min(d.progress_pct / 2, 100)}%`, background: d.status_color }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", ...mono, fontSize: 9, color: "var(--text-muted)", marginTop: 3 }}>
              <span>0</span>
              <span>avg {d.historical_avg_months.toFixed(1)}mo</span>
              <span>2× avg</span>
            </div>
            <Caption>
              {d.current_regime} has run {d.months_in_regime.toFixed(0)} months — longer than{" "}
              {d.percentile_duration.toFixed(0)}% of past {d.current_regime} spells, which average{" "}
              {d.historical_avg_months.toFixed(1)} months. {d.status} means{" "}
              {d.status === "Early"
                ? "the regime is young by its own history."
                : d.status === "Mid-Cycle"
                  ? "the spell sits inside its normal historical span."
                  : d.status === "Extended"
                    ? "the spell has outlived most of its historical peers."
                    : "the spell is among the longest on record — age alone argues for a change."}
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Late-cycle risk indicators</div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {(
                [
                  ["Momentum", d.risk_indicators.momentum],
                  ["Valuation stretch", d.risk_indicators.valuation],
                  ["Complacency", d.risk_indicators.sentiment],
                ] as const
              ).map(([label, v]) => (
                <div key={label} style={{ display: "grid", gridTemplateColumns: "130px 1fr 46px", gap: 10, alignItems: "center" }}>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{label}</span>
                  <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${v}%`, background: v < 40 ? "var(--pos)" : v < 70 ? "var(--warn-hot)" : "var(--neg)" }} />
                  </span>
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right" }}>{ordinal(v)}</span>
                </div>
              ))}
            </div>
            <Caption>
              Percentile ranks, higher = more late-cycle risk: momentum is SPY&apos;s 20-day run vs
              its last 252 sessions; valuation stretch and complacency invert the HY-spread and VIX
              percentiles over the full stored history (tight spreads and a sleepy VIX rank high).
            </Caption>
          </Card>
        </div>
      ) : (
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
    </section>
  );
}

/* ── Transition outlook ──────────────────────────────────────────────────── */

function TransitionsSection() {
  const q = useTransitions();
  const t = q.data;
  return (
    <section id="transitions">
      <SectionHeader title="Transition outlook" right="empirical odds from 30 years of monthly regime history" />
      {t ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Card>
            <div style={eyebrowStyle}>Next 3 months</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 46px", gap: 10, alignItems: "center", marginTop: 10 }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                stays {t.current_regime}
              </span>
              <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${t.stay_probability_3m}%`, background: REGIME_COLORS[t.current_regime] ?? "var(--accent)" }} />
              </span>
              <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, textAlign: "right" }}>
                {Math.round(t.stay_probability_3m)}%
              </span>
              {t.transitions_3m.slice(0, 3).map((tr) => (
                <Fragment key={tr.to}>
                  <span key={tr.to} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}>
                    → {tr.to}
                  </span>
                  <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${tr.probability}%`, background: tr.color }} />
                  </span>
                  <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                    {Math.round(tr.probability)}%
                  </span>
                </Fragment>
              ))}
            </div>
            <Caption>{t.narrative_3m}</Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Next 6 months</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 46px", gap: 10, alignItems: "center", marginTop: 10 }}>
              {(() => {
                // The 6M rows exclude the self-transition, so without this row
                // the column sums to ~60% and reads broken (critique). The
                // residual is arithmetic completion of the distribution, not
                // new quant logic.
                const stay6 = Math.max(
                  0,
                  Math.round(100 - t.transitions_6m.reduce((a, tr) => a + tr.probability, 0)),
                );
                return (
                  <>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                      stays {t.current_regime}
                    </span>
                    <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${stay6}%`, background: REGIME_COLORS[t.current_regime] ?? "var(--accent)" }} />
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, textAlign: "right" }}>
                      {stay6}%
                    </span>
                  </>
                );
              })()}
              {t.transitions_6m.slice(0, 4).map((tr) => (
                <Fragment key={tr.to}>
                  <span key={tr.to} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}>
                    → {tr.to}
                  </span>
                  <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: `${tr.probability}%`, background: tr.color }} />
                  </span>
                  <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                    {Math.round(tr.probability)}%
                  </span>
                </Fragment>
              ))}
            </div>
            <Caption>
              {t.narrative_6m} Highest-risk path: → {t.highest_risk_transition} at{" "}
              {Math.round(t.highest_risk_prob)}%. Odds are counted month-over-month from the stored
              classifier history — a <Jargon term="transition matrix">transition matrix</Jargon>,
              not a forecast model.
            </Caption>
          </Card>
        </div>
      ) : (
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
    </section>
  );
}

/* ── Historical analogues ────────────────────────────────────────────────── */

function AnaloguesSection() {
  const q = useAnalogues();
  return (
    <section id="analogues">
      <SectionHeader title="Historical analogues" right="closest past setups from a 7-period reference corpus" />
      {q.data?.length ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
            {q.data.map((an) => (
              <Card key={an.period}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ ...mono, fontSize: "var(--fs-body)", fontWeight: 700 }}>{an.period}</span>
                  <Tag tone="neutral" size="sm">
                    {an.regime}
                  </Tag>
                  <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 700, marginLeft: "auto" }}>
                    {an.similarity_score}/100 match
                  </span>
                </div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", lineHeight: 1.55, marginTop: 6 }}>
                  {an.what_happened}
                </div>
                <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 6 }}>
                  resolved → {an.next_regime} after {an.time_to_change}
                </div>
                <div style={{ marginTop: 8, borderTop: "0.5px solid var(--line-hair)", paddingTop: 8 }}>
                  <div style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--accent)" }}>
                    lesson for today
                  </div>
                  <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.5, marginTop: 3 }}>
                    {an.lessons_for_today}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <Caption>
            Similarity scores regime match (40), HY-spread percentile proximity (25), recession-odds
            proximity (20) and VIX proximity (15) against today&apos;s stored readings. Four closest
            of seven studied periods — a study aid, not a prediction.
          </Caption>
        </>
      ) : (
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
    </section>
  );
}

/* ── Scenario builder ────────────────────────────────────────────────────── */

const SHOCK_DEFAULTS: ScenarioShocks = {
  hy_spread_delta_bps: 0,
  yield_10y_delta_bps: 0,
  vix_delta: 0,
  spx_delta_pct: 0,
};

function ScenariosSection() {
  const defs = useScenarioDefs();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [shocks, setShocks] = useState<ScenarioShocks>(SHOCK_DEFAULTS);
  const debouncedShocks = useDebounced(shocks, 150);
  // The tab's flagship interaction must show numbers on first paint — default
  // to the first preset instead of an empty instruction card (critique).
  const effectiveKey = custom ? null : (selectedKey ?? defs.data?.[0]?.key ?? null);
  const run = useScenarioRun(effectiveKey, custom ? debouncedShocks : null);
  const r = run.data;

  const chip = (active: boolean, color: string): React.CSSProperties => ({
    appearance: "none",
    cursor: "pointer",
    background: active ? "rgba(74,158,255,.10)" : "none",
    border: active ? `0.5px solid ${color}` : "0.5px solid var(--line-hair)",
    borderRadius: "var(--r-xs)",
    padding: "3px 10px",
    ...mono,
    fontSize: "var(--fs-micro)",
    letterSpacing: "var(--ls-micro)",
    textTransform: "uppercase",
    color: active ? "var(--text)" : "var(--text-muted)",
  });

  const toBar = (p: Record<string, number>) => ({
    goldilocks: (p.goldilocks ?? 0) / 100,
    overheating: (p.overheating ?? 0) / 100,
    stagflation: (p.stagflation ?? 0) / 100,
    recession: (p.recession_risk ?? 0) / 100,
  });

  return (
    <section id="scenarios">
      <SectionHeader title="Scenario builder" right="5 presets · custom shocks · reads stored odds only" />
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {defs.data?.map((d) => (
          <button
            key={d.key}
            onClick={() => {
              setSelectedKey(d.key);
              setCustom(false);
            }}
            aria-pressed={!custom && effectiveKey === d.key}
            style={chip(!custom && effectiveKey === d.key, d.color)}
            title={d.description}
          >
            <span aria-hidden="true" style={{ color: d.color }}>
              ●{" "}
            </span>
            {d.name}
          </button>
        ))}
        <button onClick={() => setCustom(true)} aria-pressed={custom} style={chip(custom, "var(--accent)")}>
          Custom shocks
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: custom ? "1fr 1.6fr" : "1fr", gap: 12 }}>
        {custom && (
          <Card>
            <div style={{ ...eyebrowStyle, marginBottom: 10 }}>Shock inputs</div>
            <SliderRow
              label="HY spread shock"
              valueText={`${shocks.hy_spread_delta_bps >= 0 ? "+" : ""}${shocks.hy_spread_delta_bps} bps`}
              value={shocks.hy_spread_delta_bps}
              min={-200}
              max={500}
              step={10}
              onChange={(v) => setShocks((s) => ({ ...s, hy_spread_delta_bps: v }))}
            />
            <SliderRow
              label="10Y yield shock"
              valueText={`${shocks.yield_10y_delta_bps >= 0 ? "+" : ""}${shocks.yield_10y_delta_bps} bps`}
              value={shocks.yield_10y_delta_bps}
              min={-150}
              max={200}
              step={5}
              onChange={(v) => setShocks((s) => ({ ...s, yield_10y_delta_bps: v }))}
            />
            <SliderRow
              label="VIX shock"
              valueText={`${shocks.vix_delta >= 0 ? "+" : ""}${shocks.vix_delta} pts`}
              value={shocks.vix_delta}
              min={-10}
              max={50}
              step={1}
              onChange={(v) => setShocks((s) => ({ ...s, vix_delta: v }))}
            />
            <SliderRow
              label="S&P 500 shock"
              valueText={`${shocks.spx_delta_pct >= 0 ? "+" : ""}${shocks.spx_delta_pct}%`}
              value={shocks.spx_delta_pct}
              min={-40}
              max={20}
              step={1}
              onChange={(v) => setShocks((s) => ({ ...s, spx_delta_pct: v }))}
            />
          </Card>
        )}

        {r ? (
          <Card tone={r.severity === "severe" || r.severity === "extreme" ? "risk" : r.severity === "moderate" ? "watch" : "default"}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: "var(--fs-body)", fontWeight: 700, color: r.color }}>{r.scenario_name}</span>
              <Tag tone="neutral" size="sm">
                {r.severity}
              </Tag>
              {r.historical_reference && (
                <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>echoes {r.historical_reference}</span>
              )}
              <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "auto" }}>
                {Object.entries(r.input_shocks)
                  .filter(([, v]) => v !== 0)
                  .map(([k, v]) =>
                    k === "hy_spread_delta_bps"
                      ? `HY ${v >= 0 ? "+" : ""}${v}bps`
                      : k === "yield_10y_delta_bps"
                        ? `10Y ${v >= 0 ? "+" : ""}${v}bps`
                        : k === "vix_delta"
                          ? `VIX ${v >= 0 ? "+" : ""}${v}`
                          : `SPX ${v >= 0 ? "+" : ""}${v}%`,
                  )
                  .join(" · ") || "no shocks set"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", marginBottom: 4 }}>
                  stored odds today
                </div>
                <ProbabilityBar probs={toBar(r.current_regime_probs)} height={6} />
              </div>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", marginBottom: 4 }}>
                  stressed odds
                </div>
                <ProbabilityBar probs={toBar(r.stressed_regime_probs)} height={6} />
              </div>
            </div>

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              {Object.entries(r.prob_changes).map(([k, v]) => (
                <span key={k} style={{ ...mono, fontSize: "var(--fs-meta)", color: v > 0 ? "var(--warn)" : v < 0 ? "var(--text-muted)" : "var(--text-faint)" }}>
                  {k.replace("_", " ")} {v >= 0 ? "+" : ""}
                  {Math.round(v)}pp
                </span>
              ))}
              <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text)", marginLeft: "auto" }}>
                most likely: <b style={{ color: REGIME_COLORS[r.most_likely_regime] ?? "var(--text)" }}>{r.most_likely_regime}</b> at{" "}
                {Math.round(r.most_likely_prob)}%
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16, marginTop: 12, borderTop: "0.5px solid var(--line-hair)", paddingTop: 10 }}>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--accent)" }}>
                  positioning
                </div>
                {r.positioning_implications.slice(0, 4).map((p) => (
                  <div key={p} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.55 }}>
                    · {p}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-label)" }}>
                  sectors
                </div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", lineHeight: 1.55 }}>
                  <span style={{ color: "var(--pos)" }}>OW</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>{r.sector_implications.overweight.join(", ")}</span>
                </div>
                <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", lineHeight: 1.55 }}>
                  <span style={{ color: "var(--neg-text)" }}>UW</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>{r.sector_implications.underweight.join(", ")}</span>
                </div>
                {r.duration_estimate && (
                  <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 6 }}>
                    typical duration: {r.duration_estimate}
                  </div>
                )}
              </div>
            </div>
            <Caption>
              A transparent stress rule (documented in the source) shifts the stored odds by the
              shock mix and renormalizes — it is a sketch of direction and rough size, not the
              classifier rerun. {r.what_happened_then}
            </Caption>
          </Card>
        ) : (
          <Card>
            {run.isLoading ? (
              <StateNote loading />
            ) : run.isError ? (
              <StateNote error />
            ) : (
              <span style={{ ...mono, fontSize: 10, color: "var(--text-muted)" }}>
                Pick a prebuilt scenario or build custom shocks — the five presets replay COVID, a
                rate shock, a soft landing, a stagflation scare and a credit crisis against
                today&apos;s stored odds.
              </span>
            )}
          </Card>
        )}
      </div>
    </section>
  );
}

/* ── Regime history Gantt ────────────────────────────────────────────────── */

interface Segment {
  label: string;
  start: string;
  end: string; // exclusive month
  months: number;
}

function mergeSegments(rows: Regime[]): Segment[] {
  const segs: Segment[] = [];
  for (const r of rows) {
    const last = segs[segs.length - 1];
    if (last && last.label === r.label) {
      last.months += 1;
      last.end = r.date;
    } else {
      segs.push({ label: r.label, start: r.date, end: r.date, months: 1 });
    }
  }
  return segs;
}

function GanttSection() {
  const q = useRegimeHistory();
  // Keep query-data identity in the memo deps — a `?? []` literal would mint
  // a new array every render and bust the memo while loading (audit).
  const segs = useMemo(() => mergeSegments(q.data ?? []), [q.data]);
  const rows = q.data ?? [];
  // viewBox ≈ rendered width at 1440, so the 9px SVG labels render at ~9px —
  // a 720 viewBox stretched to ~1385px made chart chrome the loudest type on
  // the tab (critique).
  const W = 1385;
  const LABEL_W = 130;
  const ROW_H = 20;
  const H = ROW_H * 4 + 18;
  if (!rows.length) {
    return (
      <section id="regime-history">
        <SectionHeader title="Regime history" right="the classifier's full record" />
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      </section>
    );
  }
  const t0 = new Date(rows[0].date).getTime();
  const t1 = new Date(rows[rows.length - 1].date).getTime() + 32 * 86_400_000;
  const X = (iso: string) => LABEL_W + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - LABEL_W - 4);
  const switches12 = rows.slice(-12).reduce((acc, r, i, arr) => (i > 0 && r.label !== arr[i - 1].label ? acc + 1 : acc), 0);
  const years: string[] = [];
  for (let y = new Date(rows[0].date).getFullYear() + 2; y <= new Date(rows[rows.length - 1].date).getFullYear(); y += 5) {
    years.push(`${y}-01-01`);
  }

  return (
    <section id="regime-history">
      <SectionHeader
        title="Regime history"
        right={`${rows.length} monthly calls · ${fmtMonYr(rows[0].date)} → ${fmtMonYr(rows[rows.length - 1].date)} · ${switches12} switch${switches12 === 1 ? "" : "es"} in the last 12mo`}
      />
      <Card>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img" aria-label="Regime history Gantt — one lane per regime, colored spans mark the months the classifier called it">
          {REGIMES.map((r, ri) => (
            <g key={r}>
              <text x={0} y={ri * ROW_H + 13} fill={REGIME_COLORS[r]} style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: ".08em" }}>
                {r.toUpperCase()}
              </text>
              <line x1={LABEL_W} x2={W - 4} y1={ri * ROW_H + 9.5} y2={ri * ROW_H + 9.5} stroke="var(--line-hair)" strokeWidth="0.5" />
            </g>
          ))}
          {segs.map((s) => {
            const ri = REGIMES.indexOf(s.label as (typeof REGIMES)[number]);
            if (ri === -1) return null;
            const x0 = X(s.start);
            const x1 = Math.max(X(s.end) + (X(s.end) - x0) / Math.max(s.months, 1), x0 + 1.2);
            return (
              <rect key={`${s.label}-${s.start}`} x={x0} y={ri * ROW_H + 3} width={x1 - x0} height={13} rx={1.5} fill={REGIME_COLORS[s.label]} fillOpacity={0.28} stroke={REGIME_COLORS[s.label]} strokeOpacity={0.5} strokeWidth={0.5}>
                <title>
                  {s.label} · {fmtMonYr(s.start)} → {fmtMonYr(s.end)} ({s.months}mo)
                </title>
              </rect>
            );
          })}
          {years.map((y) => (
            <g key={y}>
              <line x1={X(y)} x2={X(y)} y1={2} y2={ROW_H * 4} stroke="var(--line-hair)" strokeWidth="0.5" />
              <text x={X(y) + 2} y={ROW_H * 4 + 12} fill="var(--text-muted)" style={{ fontFamily: "var(--font-mono)", fontSize: 8.5, letterSpacing: ".05em" }}>
                {y.slice(0, 4)}
              </text>
            </g>
          ))}
        </svg>
        <Caption>
          Every monthly call the classifier has made, one lane per regime — hover a span for its
          dates. Long unbroken bands are stable macro; rapid lane-hopping marks the turns. The last
          12 months saw {switches12} regime switch{switches12 === 1 ? "" : "es"}.
        </Caption>
      </Card>
    </section>
  );
}

/* ── Backtests + factor attribution ──────────────────────────────────────── */

const COHORT_NAMES: Record<string, string> = {
  cpi_hot: "Inflation hot · CPI above 4%",
  cpi_cold: "Inflation cold · CPI below 1%",
  unemployment_spike: "Unemployment spike · +0.3pp vs 12m low",
  vix_spike: "VIX spike · above 30",
  yield_curve_inversion: "Curve inversion · 2s10s below 0",
};

function BacktestsSection() {
  const q = useBacktests();
  const alloc = useAllocation();
  const [kind, setKind] = useState<"regime" | "signal">("regime");
  const rows = useMemo(() => {
    const filtered = (q.data ?? []).filter((r) =>
      kind === "regime"
        ? r.test_name.startsWith("SPY_regime_")
        : r.test_name.startsWith("SPY_signal_"),
    );
    // House regime order (GL→OV→ST→RR), matching the factor table below.
    const order = (c: string) => {
      const i = REGIMES.indexOf(c as (typeof REGIMES)[number]);
      return i === -1 ? 99 : i;
    };
    return [...filtered].sort(
      (a, b) => order(a.cohort) - order(b.cohort) || a.cohort.localeCompare(b.cohort),
    );
  }, [q.data, kind]);
  const computedAt = q.data?.[0]?.computed_at?.slice(0, 10) ?? null;

  const regimes = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
  const factorNames = useMemo(
    () =>
      alloc.data
        ? [...new Set(Object.values(alloc.data.regime_factors).flatMap((f) => Object.keys(f)))]
        : [],
    [alloc.data],
  );

  return (
    <section id="backtests">
      <SectionHeader
        title="Backtests & factor attribution"
        right={computedAt ? `SPY forward returns · computed ${computedAt}` : "SPY forward returns"}
      />
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {(
          [
            ["regime", "By regime"],
            ["signal", "By signal"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            style={{
              appearance: "none",
              cursor: "pointer",
              background: kind === k ? "rgba(74,158,255,.12)" : "none",
              border: kind === k ? "0.5px solid rgba(74,158,255,.4)" : "0.5px solid var(--line-hair)",
              borderRadius: "var(--r-xs)",
              padding: "2px 8px",
              ...mono,
              fontSize: "var(--fs-micro)",
              letterSpacing: "var(--ls-micro)",
              textTransform: "uppercase",
              color: kind === k ? "var(--accent)" : "var(--text-muted)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {rows.length ? (
        <Card style={{ padding: 0, overflowX: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(210px,1.6fr) 60px 90px 90px 80px 60px", gap: 12, padding: "6px 12px", borderBottom: "1px solid var(--line-hair)" }}>
            {["Cohort", "Horizon", "Avg return", "Median", "Hit rate", "N"].map((h, i) => (
              <span key={h} style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-wide)", color: "var(--text-muted)", textAlign: i > 0 ? "right" : "left" }}>
                {h}
              </span>
            ))}
          </div>
          {rows.map((r, i) => {
            // ▪ flags fragility: tiny samples AND extreme hit rates — a 100%
            // on 17 samples is exactly what a quant reader probes (critique;
            // confusion #12).
            const small =
              ((r.n ?? 0) > 0 && (r.n ?? 0) <= 4) || r.hit_rate === 1 || r.hit_rate === 0;
            return (
              <div key={`${r.cohort}-${r.horizon}`} style={{ display: "grid", gridTemplateColumns: "minmax(210px,1.6fr) 60px 90px 90px 80px 60px", gap: 12, padding: "6px 12px", background: i % 2 === 1 ? "rgba(255,255,255,.012)" : "transparent", alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                  {COHORT_NAMES[r.cohort] ?? r.cohort}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right" }}>{r.horizon}</span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: (r.avg_return ?? 0) >= 0 ? "var(--pos)" : "var(--neg-text)" }}>
                  {r.avg_return != null ? `${r.avg_return >= 0 ? "+" : ""}${(r.avg_return * 100).toFixed(1)}%` : "—"}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                  {r.median_return != null ? `${r.median_return >= 0 ? "+" : ""}${(r.median_return * 100).toFixed(1)}%` : "—"}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: small ? "var(--warn)" : "var(--text)" }}>
                  {r.hit_rate != null ? `${(r.hit_rate * 100).toFixed(0)}%${small ? " ▪" : ""}` : "—"}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                  {r.n != null ? r.n.toFixed(0) : "—"}
                </span>
              </div>
            );
          })}
        </Card>
      ) : (
        <Card>
          <StateNote loading={q.isLoading} error={q.isError} />
        </Card>
      )}
      <Caption>
        SPY forward returns after each {kind === "regime" ? "regime began" : "signal fired"},
        measured over trading-day horizons (1M=21d … 12M=252d). ▪ flags fragile cells — four or
        fewer samples, or a perfect 100%/0% <Jargon term="hit rate">hit rate</Jargon>, which is a
        small base, not a guarantee. 50% is a coin flip; read hit rates against that line, not
        zero.
      </Caption>

      <div style={{ marginTop: 12 }}>
        <div style={{ ...eyebrowStyle, marginBottom: 6 }}>Factor returns by regime · annualized</div>
        {alloc.data && factorNames.length ? (
          <Card>
            <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${regimes.length},1fr)`, gap: "2px 8px" }}>
              <span />
              {regimes.map((r) => (
                <span key={r} style={{ ...mono, fontSize: 9, letterSpacing: "var(--ls-wide)", textTransform: "uppercase", color: "var(--text-muted)", textAlign: "right", padding: "4px 8px" }}>
                  {r}
                </span>
              ))}
              {factorNames.map((f) => (
                <Fragment key={f}>
                  <span key={f} style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", padding: "4px 0" }}>
                    {f}
                  </span>
                  {regimes.map((r) => {
                    const v = alloc.data?.regime_factors[r]?.[f] ?? null;
                    return (
                      <span key={`${f}-${r}`} style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "4px 8px", color: v == null ? "var(--text-muted)" : v < 0 ? "var(--neg-text)" : "var(--pos)" }}>
                        {v != null ? `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%` : "—"}
                      </span>
                    );
                  })}
                </Fragment>
              ))}
            </div>
            <Caption>
              Long/short ETF-proxy factors (Value, Momentum, Quality, Size, Low Vol) annualized
              inside each regime&apos;s months — which styles actually paid in each weather. Full
              portfolio-level attribution lives in Tools → Allocation → Risk.
            </Caption>
          </Card>
        ) : (
          <Card>
            <StateNote loading={alloc.isLoading} error={alloc.isError}>
              {alloc.isLoading
                ? "Factor table computes on the allocation engine — up to a minute cold, then cached an hour."
                : "Factor history unavailable — the allocation engine could not reach its data vendor."}
            </StateNote>
          </Card>
        )}
      </div>
    </section>
  );
}

/* ── Screen ──────────────────────────────────────────────────────────────── */

export default function RegimeLabScreen() {
  const regime = useRegimeLatest();
  useHashScroll(regime.data);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <TakeawaySection />
      <PlaybookSection currentRegime={regime.data?.label} />
      <CycleSection />
      <TransitionsSection />
      <AnaloguesSection />
      <ScenariosSection />
      <GanttSection />
      <BacktestsSection />
      <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Regime odds, durations and transitions from the stored monthly classifier · playbooks,
        analogue corpus and scenario definitions are labeled reference content · backtests computed
        from stored SPY history.
      </div>
    </div>
  );
}
