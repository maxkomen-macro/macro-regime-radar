/**
 * Recession — locked IA: probability model (gauge on the SAME 20/40 bands the
 * badge uses — confusion #5's two-truths widget is dead), curve monitor
 * (#15/#16 captions), sensitivity sliders (collapsed by default, ~120ms
 * debounced POST against the fitted model), model transparency (#20, #24).
 *
 * Data: /api/recession/probability (metrics + series) and
 * POST /api/recession/scenario (user inputs → probability).
 */

import { useMemo, useState } from "react";
import { Card, SectionHeader, Tag } from "../../components";
import { useRecessionProbability, useRecessionScenario } from "../../api/queries";
import type { RecessionScenarioRequest } from "../../api/types";
import { fmtMonYr, ordinal } from "../../lib/format";
import LineChart, { type ChartBand } from "../dashboard/LineChart";
import Jargon from "../shared/Jargon";
import { Caption, SliderRow, StateNote, eyebrowStyle, mono, useDebounced, useHashScroll } from "../shared/screen-ui";

/** Band cutoffs — one truth with the classifier: <20 Low (green), 20–40
 * Elevated (orange), ≥40 High (red). The arc must never disagree with the
 * badge again. */
const BANDS: { to: number; color: string }[] = [
  { to: 20, color: "var(--pos)" },
  { to: 40, color: "var(--warn-hot)" },
  { to: 100, color: "var(--neg)" },
];

/** ONE color mapping for every surface that states this probability — arc,
 * headline number, adjusted readout. The server payload carries its own hex
 * (Streamlit-era palette); the app renders its tokens instead so the gauge,
 * number, and Methodology legend can never disagree (audit 2026-08-07). */
const probColor = (p: number) => (p < 20 ? "var(--pos)" : p < 40 ? "var(--warn-hot)" : "var(--neg-text)");

function arcPoint(t: number, r: number): [number, number] {
  const angle = Math.PI * (1 - t);
  return [100 + r * Math.cos(angle), 100 - r * Math.sin(angle)];
}

function arcPath(t0: number, t1: number, r: number): string {
  const [x0, y0] = arcPoint(t0, r);
  const [x1, y1] = arcPoint(t1, r);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function Gauge({ prob, label, color }: { prob: number; label: string; color: string }) {
  const t = Math.max(0, Math.min(100, prob)) / 100;
  const [nx, ny] = arcPoint(t, 65);
  let start = 0;
  return (
    <div>
      <svg viewBox="0 0 200 110" role="img" aria-label={`Recession probability ${prob.toFixed(1)}% — ${label}`} style={{ display: "block", width: "100%", maxWidth: 260 }}>
        {BANDS.map((b) => {
          const p = arcPath(start / 100, b.to / 100, 80);
          start = b.to;
          return <path key={b.to} d={p} fill="none" stroke={b.color} strokeWidth="10" opacity="0.35" strokeLinecap="butt" />;
        })}
        {/* band boundary ticks at 20 and 40 */}
        {[20, 40].map((v) => {
          const [tx0, ty0] = arcPoint(v / 100, 72);
          const [tx1, ty1] = arcPoint(v / 100, 88);
          return <line key={v} x1={tx0} y1={ty0} x2={tx1} y2={ty1} stroke="var(--line-strong)" strokeWidth="1" />;
        })}
        <line x1="100" y1="100" x2={nx} y2={ny} stroke="var(--text)" strokeWidth="2" />
        <circle cx="100" cy="100" r="3.5" fill="var(--text)" />
      </svg>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
        <span style={{ ...mono, fontSize: 26, fontWeight: 600, color }}>{prob.toFixed(1)}%</span>
        <Tag tone={prob < 20 ? "pos" : prob < 40 ? "warn" : "neg"} size="sm">
          {label}
        </Tag>
      </div>
    </div>
  );
}

/** Contiguous USREC==1 runs → shaded chart bands. */
function usrecBands(series: { date: string; value: number }[]): ChartBand[] {
  const bands: ChartBand[] = [];
  let open: string | null = null;
  for (const p of series) {
    if (p.value >= 0.5 && open == null) open = p.date;
    if (p.value < 0.5 && open != null) {
      bands.push({ from: open, to: p.date });
      open = null;
    }
  }
  if (open != null && series.length) bands.push({ from: open, to: series[series.length - 1].date });
  return bands;
}

const TENOR_ORDER = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"];

export default function RecessionScreen() {
  const q = useRecessionProbability();
  const m = q.data;

  // Sensitivity state — seeded from live inputs once data arrives.
  const [inputs, setInputs] = useState<RecessionScenarioRequest | null>(null);
  const [open, setOpen] = useState(false); // collapsed by default (locked IA)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const liveDefaults = useMemo<RecessionScenarioRequest | null>(() => {
    if (!m) return null;
    const c = m.current_inputs;
    if (
      m.yield_curve_spread == null ||
      c.unrate == null ||
      c.hy_oas == null ||
      c.indpro_yoy == null ||
      c.lei == null
    )
      return null;
    return {
      yield_curve_bps: clamp(Math.round(m.yield_curve_spread / 5) * 5, -200, 300),
      unemployment: clamp(Math.round(c.unrate * 10) / 10, 2, 15),
      hy_oas_bps: clamp(Math.round(c.hy_oas / 10) * 10, 100, 2000),
      indpro_yoy: clamp(Math.round(c.indpro_yoy * 2) / 2, -20, 10),
      lei: clamp(Math.round(c.lei * 10) / 10, -5, 5),
    };
  }, [m]);
  const effective = inputs ?? liveDefaults;
  const debounced = useDebounced(effective, 120);
  const scenario = useRecessionScenario(open ? debounced : null);
  useHashScroll(m);

  if (!m) {
    return (
      <Card>
        <StateNote loading={q.isLoading} error={q.isError}>
          {q.isLoading ? "Training the recession model on stored NBER history —" : undefined}
        </StateNote>
      </Card>
    );
  }

  const prob = m.recession_prob ?? 0;
  const probBands = usrecBands(m.usrec_series);
  const spreadBps = m.yield_curve_spread;
  const tenors = TENOR_ORDER.filter((t) => m.curve_shape[t] != null);
  const coefs = Object.entries(m.feature_coefficients).sort(
    (a, b) => Math.abs(b[1]) - Math.abs(a[1]),
  );
  const FEATURE_LABELS: Record<string, { label: string; current: string }> = {
    yield_curve: {
      label: "Yield curve (2s10s)",
      current: spreadBps != null ? `${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps` : "—",
    },
    unemployment: {
      label: "Unemployment rate",
      current: m.current_inputs.unrate != null ? `${m.current_inputs.unrate.toFixed(1)}%` : "—",
    },
    hy_spread: {
      label: "HY credit spread",
      current: m.current_inputs.hy_oas != null ? `${Math.round(m.current_inputs.hy_oas)} bps` : "—",
    },
    indpro_yoy: {
      label: "Industrial production YoY",
      current:
        m.current_inputs.indpro_yoy != null ? `${m.current_inputs.indpro_yoy.toFixed(1)}%` : "—",
    },
    lei_proxy: {
      label: "Leading-indicator proxy",
      current: m.current_inputs.lei != null ? `${m.current_inputs.lei.toFixed(2)}pp` : "—",
    },
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Probability model ─────────────────────────────────────────── */}
      <section id="model">
        <SectionHeader
          title="Probability model"
          right={`logistic regression · NBER-trained · monthly inputs through ${fmtMonYr(m.data_as_of)}`}
        />
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12 }}>
          <Card>
            <div style={eyebrowStyle}>12-month recession probability</div>
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginTop: 8 }}>
              <Gauge prob={prob} label={m.recession_label} color={probColor(prob)} />
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {(
                  [
                    ["< 20%", "Low Risk", "var(--pos)"],
                    ["20–40%", "Elevated", "var(--warn-hot)"],
                    ["≥ 40%", "High Risk", "var(--neg)"],
                  ] as const
                ).map(([range, label, color]) => (
                  <div key={label} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "var(--r-xs)", background: color, alignSelf: "center" }} />
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", minWidth: 52 }}>{range}</span>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: label === m.recession_label ? "var(--text)" : "var(--text-muted)", fontWeight: label === m.recession_label ? 600 : 400 }}>
                      {label}
                      {label === m.recession_label ? " ← now" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <Caption>
              {prob.toFixed(1)}% sits in the {m.recession_label} band. Historical base rate runs
              ~15%; 2008 peaked near 89%.
            </Caption>
          </Card>
          <Card tone={m.is_inverted ? "watch" : "default"}>
            <div style={eyebrowStyle}>Yield curve · 2s10s</div>
            <div
              style={{
                ...mono,
                fontSize: 26,
                fontWeight: 600,
                marginTop: 8,
                color: spreadBps != null && spreadBps < 0 ? "var(--neg-text)" : "var(--text)",
              }}
            >
              {spreadBps != null ? (
                <>
                  {spreadBps >= 0 ? "+" : ""}
                  {Math.round(spreadBps)}{" "}
                  <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>bps</span>
                </>
              ) : (
                "—"
              )}
            </div>
            <Caption>
              The <Jargon term="2s10s">10Y–2Y spread</Jargon> holds at{" "}
              {spreadBps != null ? `${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps (${(spreadBps / 100).toFixed(2)}%)` : "—"}
              {m.is_inverted && m.inversion_duration_months
                ? ` — inverted for ${m.inversion_duration_months} months.`
                : m.yield_curve_pct_rank != null
                  ? ` — the ${ordinal(m.yield_curve_pct_rank)} percentile of 30 years.`
                  : "."}{" "}
              An inverted curve has preceded most US recessions.
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Macro vs markets</div>
            <div style={{ ...mono, fontSize: 26, fontWeight: 600, marginTop: 8 }}>
              {m.divergence_score != null ? `${m.divergence_score >= 0 ? "+" : ""}${Math.round(m.divergence_score)}` : "—"}
            </div>
            <Caption>
              <Jargon term="divergence">{m.divergence_label}</Jargon> — credit-market pricing (HY
              percentile) minus the regime model&apos;s recession odds, on a −100 to +100 scale.
              Beyond ±20, one of the two is likely wrong. The number stays neutral; the word
              carries the verdict.
            </Caption>
          </Card>
        </div>

        <Card style={{ marginTop: 12 }}>
          <LineChart
            series={[
              {
                label: "Recession probability",
                color: "var(--warn-hot)",
                points: m.recession_prob_series.map((p) => ({ x: p.date, y: p.value })),
              },
            ]}
            height={180}
            yFmt={(v) => `${v.toFixed(0)}%`}
            bands={probBands}
            hlines={[
              { y: 20, label: "20% Elevated" },
              { y: 40, label: "40% High" },
            ]}
            // The gauge above is the ONE current number — printing the series
            // tail beside it put two "currents" on one screen (critique P0).
            showLast={false}
            caption="Model recession probability history with NBER recessions shaded"
          />
          <Caption>
            The model&apos;s 12-month odds, monthly since{" "}
            {m.recession_prob_series[0] ? fmtMonYr(m.recession_prob_series[0].date) : "—"} — shaded
            bands are actual <Jargon term="NBER">NBER</Jargon> recessions, dashed rules the 20/40
            band edges. The plotted tail (
            {m.recession_prob_series.length
              ? `${m.recession_prob_series[m.recession_prob_series.length - 1].value.toFixed(0)}%`
              : "—"}
            ) is a partial-month fit; the gauge&apos;s {prob.toFixed(1)}% is the newest complete
            monthly read. Features enter with a 3-month lag so the line never peeks at data it
            wouldn&apos;t have had.
          </Caption>
        </Card>
      </section>

      {/* ── Curve monitor ─────────────────────────────────────────────── */}
      <section id="curve">
        <SectionHeader title="Curve monitor" right="2s10s daily · 30 years · FRED" />
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
          <Card>
            <LineChart
              series={[
                {
                  label: "2s10s spread",
                  color: "var(--accent)",
                  points: m.yield_curve_series.map((p) => ({ x: p.date, y: p.value })),
                },
              ]}
              height={170}
              yFmt={(v) => `${v.toFixed(2)}%`}
              bands={probBands}
              caption="10Y minus 2Y Treasury spread, 30-year history, NBER recessions shaded"
            />
            <Caption>
              Below the dashed zero line the curve is inverted — short money costs more than long
              money, which only happens when markets expect cuts ahead. Every shaded recession was
              preceded by a dip below zero.
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Current curve shape</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {TENOR_ORDER.map((t) => (
                <div key={t} style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{t}</span>
                  <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: m.curve_shape[t] != null ? 600 : 400, color: m.curve_shape[t] != null ? "var(--text)" : "var(--text-faint)" }}>
                    {m.curve_shape[t] != null ? `${(m.curve_shape[t] as number).toFixed(2)}%` : "—"}
                  </span>
                </div>
              ))}
            </div>
            <Caption>
              The store holds {tenors.length} <Jargon term="tenor">tenors</Jargon>
              {tenors.length === 2 && m.curve_shape["2Y"] != null && m.curve_shape["10Y"] != null ? (
                <>
                  : 2Y at {(m.curve_shape["2Y"] as number).toFixed(2)}% and 10Y at{" "}
                  {(m.curve_shape["10Y"] as number).toFixed(2)}% — a{" "}
                  {spreadBps != null ? `${spreadBps >= 0 ? "+" : ""}${Math.round(spreadBps)} bps` : "—"}{" "}
                  {spreadBps != null && spreadBps >= 0 ? "upward" : "inverted"} slope. Not a broken
                  chart — daily FRED coverage stops at these two points.
                </>
              ) : (
                " with daily FRED coverage."
              )}
            </Caption>
          </Card>
        </div>
      </section>

      {/* ── Sensitivity (collapsed by default) ────────────────────────── */}
      <section id="sensitivity">
        <SectionHeader title="Sensitivity" right="five inputs · the fitted model rescored live" />
        <Card>
          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            style={{
              appearance: "none",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              width: "100%",
              textAlign: "left",
              color: "var(--text)",
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-body-s)",
            }}
          >
            <span aria-hidden="true" style={{ color: "var(--text-faint)" }}>
              {open ? "▾" : "▸"}
            </span>
            <span>
              Move the model&apos;s five inputs and watch {prob.toFixed(1)}% respond
              {!open && effective && (
                <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                  {" "}
                  — 2s10s {effective.yield_curve_bps >= 0 ? "+" : ""}
                  {effective.yield_curve_bps} bps · U-3 {effective.unemployment.toFixed(1)}% · HY{" "}
                  {effective.hy_oas_bps} bps · IP {effective.indpro_yoy.toFixed(1)}% · LEI{" "}
                  {effective.lei.toFixed(1)}pp
                </span>
              )}
            </span>
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginLeft: "auto" }}>
              {open ? "collapse" : "expand"}
            </span>
          </button>
          {open && !effective && (
            <div style={{ marginTop: 12 }}>
              <StateNote>
                The model&apos;s current inputs are incomplete in this snapshot — nothing honest to
                seed the sliders with.
              </StateNote>
            </div>
          )}
          {open && effective && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 24px", marginTop: 14 }}>
              <div>
                <SliderRow
                  label="Yield curve 2s10s"
                  valueText={`${effective.yield_curve_bps >= 0 ? "+" : ""}${effective.yield_curve_bps} bps`}
                  value={effective.yield_curve_bps}
                  min={-200}
                  max={300}
                  step={5}
                  onChange={(v) => setInputs({ ...effective, yield_curve_bps: v })}
                />
                <SliderRow
                  label="Unemployment rate"
                  valueText={`${effective.unemployment.toFixed(1)}%`}
                  value={effective.unemployment}
                  min={2}
                  max={15}
                  step={0.1}
                  onChange={(v) => setInputs({ ...effective, unemployment: v })}
                />
                <SliderRow
                  label="HY credit spread"
                  valueText={`${effective.hy_oas_bps} bps`}
                  value={effective.hy_oas_bps}
                  min={100}
                  max={2000}
                  step={10}
                  onChange={(v) => setInputs({ ...effective, hy_oas_bps: v })}
                />
                <SliderRow
                  label="Industrial production YoY"
                  valueText={`${effective.indpro_yoy.toFixed(1)}%`}
                  value={effective.indpro_yoy}
                  min={-20}
                  max={10}
                  step={0.5}
                  onChange={(v) => setInputs({ ...effective, indpro_yoy: v })}
                />
                <SliderRow
                  label={<Jargon term="LEI">Leading-indicator proxy</Jargon>}
                  valueText={`${effective.lei.toFixed(1)}pp`}
                  value={effective.lei}
                  min={-5}
                  max={5}
                  step={0.1}
                  onChange={(v) => setInputs({ ...effective, lei: v })}
                />
                <button
                  onClick={() => setInputs(null)}
                  style={{
                    appearance: "none",
                    background: "none",
                    border: "0.5px solid var(--line)",
                    borderRadius: "var(--r-xs)",
                    cursor: "pointer",
                    padding: "3px 10px",
                    ...mono,
                    fontSize: "var(--fs-meta)",
                    color: "var(--text-muted)",
                  }}
                >
                  ↻ reset to current readings
                </button>
              </div>
              <div>
                <div style={eyebrowStyle}>Adjusted probability</div>
                {scenario.data ? (
                  <>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 8 }}>
                      <span style={{ ...mono, fontSize: 34, fontWeight: 700, color: probColor(scenario.data.probability) }}>
                        {scenario.data.probability.toFixed(1)}%
                      </span>
                      <Tag
                        tone={scenario.data.probability < 20 ? "pos" : scenario.data.probability < 40 ? "warn" : "neg"}
                        size="sm"
                      >
                        {scenario.data.label}
                      </Tag>
                    </div>
                    {scenario.data.delta_pp != null && (
                      <div style={{ ...mono, fontSize: "var(--fs-body-s)", color: "var(--text-muted)", marginTop: 6 }}>
                        {scenario.data.delta_pp >= 0 ? "+" : ""}
                        {scenario.data.delta_pp.toFixed(1)}pp vs the model&apos;s headline{" "}
                        {scenario.data.baseline_prob?.toFixed(1)}%
                      </div>
                    )}
                    <Caption>
                      The headline scores 3-month-lagged inputs (the model never peeks); these
                      sliders score the readings as if they were today&apos;s features — so the
                      starting position sits near, not on, the headline. Same fitted coefficients,
                      same scaler.
                    </Caption>
                  </>
                ) : (
                  <div style={{ marginTop: 8 }}>
                    <StateNote loading={scenario.isLoading} error={scenario.isError} />
                  </div>
                )}
              </div>
            </div>
          )}
        </Card>
      </section>

      {/* ── Model transparency ────────────────────────────────────────── */}
      <section id="transparency">
        <SectionHeader title="Model transparency" right="coefficients · training metadata" />
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12 }}>
          <Card>
            <div style={eyebrowStyle}>Feature coefficients · log-odds per σ</div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              {coefs.map(([name, coef]) => {
                const f = FEATURE_LABELS[name] ?? { label: name, current: "—" };
                const width = Math.min((Math.abs(coef) / 3) * 100, 100);
                const riskFactor = coef > 0;
                return (
                  <div key={name} style={{ display: "grid", gridTemplateColumns: "170px 1fr 70px 90px", gap: 10, alignItems: "center" }}>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                      {f.label}
                    </span>
                    <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                      <span
                        style={{
                          display: "block",
                          height: "100%",
                          width: `${width}%`,
                          background: riskFactor ? "var(--warn-hot)" : "var(--accent)",
                        }}
                      />
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, textAlign: "right", color: riskFactor ? "var(--warn-hot)" : "var(--accent)" }}>
                      {coef >= 0 ? "+" : ""}
                      {coef.toFixed(2)}
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", textAlign: "right" }}>
                      {f.current}
                    </span>
                  </div>
                );
              })}
            </div>
            <Caption>
              {coefs.length > 0 && (
                <>
                  A one-σ rise in {FEATURE_LABELS[coefs[0][0]]?.label ?? coefs[0][0]}{" "}
                  {coefs[0][1] >= 0 ? "adds" : "subtracts"} {Math.abs(coefs[0][1]).toFixed(2)}{" "}
                  {coefs[0][1] >= 0 ? "to" : "from"} the{" "}
                  <Jargon term="log-odds">log-odds</Jargon> of recession — the model&apos;s
                  strongest input. Orange bars raise recession odds as they rise; blue bars lower
                  them. Unemployment enters negative because it co-moves with the credit and curve
                  terms — the fit assigns it the offsetting sign, so read the five together, not
                  one at a time.
                </>
              )}
            </Caption>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Model card</div>
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {(
                [
                  ["Estimator", "Logistic regression, class-balanced"],
                  ["Training target", "NBER USREC months"],
                  ["Training samples", `${m.n_training_samples} months`],
                  [
                    "Features",
                    m.model_features
                      .map((f) => FEATURE_LABELS[f]?.label ?? f.replace(/_/g, " "))
                      .join(" · "),
                  ],
                  ["Look-ahead guard", "All features lagged 3 months"],
                  ["Inputs through", fmtMonYr(m.data_as_of)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>{k}</span>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-2)", textAlign: "right" }}>{v}</span>
                </div>
              ))}
            </div>
            <Caption>
              The <Jargon term="LEI">leading-indicator proxy</Jargon> is the 10Y-minus-5Y inflation
              breakeven — the original USSLIND series froze in Feb 2020 and survives only as
              training history.
            </Caption>
          </Card>
        </div>
      </section>

      <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Model trained in-process from stored FRED series each session (no saved artifact) ·
        probability is the recession model&apos;s own — a different number from the regime
        classifier&apos;s Recession Risk odds in the header.
      </div>
    </div>
  );
}
