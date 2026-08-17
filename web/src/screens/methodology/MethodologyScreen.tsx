/**
 * Methodology — the reference page behind the persistent header link (locked
 * IA: not a tab). Regime definitions, live signal thresholds, the closed
 * status vocabularies and meaning ramps, model notes, and data provenance.
 * Signal thresholds render from /api/signals/latest so this page can never
 * drift from the server truth it documents.
 */

import { Card, SectionHeader, Tag } from "../../components";
import { useSignalsLatest } from "../../api/queries";
import { fmtMonYr } from "../../lib/format";
import { Caption, StateNote, eyebrowStyle, mono } from "../shared/screen-ui";

const REGIME_DEFS: { name: string; color: string; def: string }[] = [
  { name: "Goldilocks", color: "#2ecc71", def: "Growth trending up while inflation stays calm — the equity-friendly quadrant." },
  { name: "Overheating", color: "#e67e22", def: "Growth and inflation both running hot — real assets lead, duration suffers." },
  { name: "Stagflation", color: "#e74c3c", def: "Inflation hot while growth stalls — the hardest tape; cash and commodities defend." },
  { name: "Recession Risk", color: "#95a5a6", def: "Growth rolling over with inflation fading — quality bonds and defensives lead." },
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

function LegendRow({ swatch, label, detail }: { swatch: string; label: string; detail: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "14px 130px 1fr", gap: 10, alignItems: "baseline" }}>
      <span style={{ width: 10, height: 10, borderRadius: "var(--r-xs)", background: swatch, display: "inline-block", alignSelf: "center" }} />
      <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-2)" }}>{label}</span>
      <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{detail}</span>
    </div>
  );
}

export default function MethodologyScreen() {
  const signals = useSignalsLatest();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section>
        <SectionHeader title="The four regimes" right="a 4-way softmax classifier over growth and inflation trends" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          {REGIME_DEFS.map((r) => (
            <Card key={r.name}>
              <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 700, color: r.color }}>{r.name}</span>
              <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-muted)", lineHeight: 1.55, marginTop: 4 }}>
                {r.def}
              </div>
            </Card>
          ))}
        </div>
        <Caption>
          Monthly, from z-scored growth (INDPRO) and inflation (CPI) trends through a temperature-0.7
          softmax — the four probabilities in the header always sum to ~100%. The header badge shows
          the dominant stored probability; conviction is a separate heuristic and is always labeled.
        </Caption>
      </section>

      <section>
        <SectionHeader
          title="Monitored signals"
          right={
            signals.data ? `live thresholds · latest print ${fmtMonYr(signals.data.date)}` : "live thresholds"
          }
        />
        <Card style={{ padding: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 110px 110px 1fr", gap: 12, padding: "6px 12px", borderBottom: "1px solid var(--line-hair)" }}>
            {["Signal", "Trigger", "Latest", "Status rule"].map((h, i) => (
              <span key={h} style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-wide)", color: "var(--text-muted)", textAlign: i === 1 || i === 2 ? "right" : "left" }}>
                {h}
              </span>
            ))}
          </div>
          {signals.data ? (
            signals.data.signals.map((s, i) => (
              <div key={s.signal_name} style={{ display: "grid", gridTemplateColumns: "1.4fr 110px 110px 1fr", gap: 12, padding: "7px 12px", background: i % 2 === 1 ? "rgba(255,255,255,.012)" : "transparent", alignItems: "baseline" }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                  {SIGNAL_NAMES[s.signal_name] ?? s.signal_name.replace(/_/g, " ")}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right" }}>
                  {s.direction == null || s.threshold == null
                    ? "—"
                    : `${s.direction === "below" ? "<" : ">"} ${s.threshold}${SIGNAL_UNITS[s.signal_name] ?? ""}`}
                </span>
                <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: "var(--text-muted)" }}>
                  {s.value.toFixed(2)}
                  {SIGNAL_UNITS[s.signal_name] ?? ""}
                </span>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
                  {s.status ?? "—"}
                  {s.distance_pct != null ? ` · ${Math.round(s.distance_pct)}% of trigger` : ""}
                </span>
              </div>
            ))
          ) : (
            <div style={{ padding: 12 }}>
              <StateNote loading={signals.isLoading} error={signals.isError} />
            </div>
          )}
        </Card>
        <Caption>
          Trigger values and status arrive live from the API (the same payload the signal cards
          read); display names and units on this page are presentation copy. One status rule for
          all five: the stored trigger flag owns Triggered; Watch starts at 50% threshold
          proximity; Clear is everything below.
        </Caption>
      </section>

      <section>
        <SectionHeader title="Meaning ramps & vocabularies" right="closed sets — the app never invents synonyms" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <Card>
            <div style={eyebrowStyle}>Threshold-proximity gauge</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <LegendRow swatch="var(--pos)" label="< 50%" detail="Clear — comfortable distance from the trigger" />
              <LegendRow swatch="var(--warn)" label="50–75%" detail="Watch — inside striking distance" />
              <LegendRow swatch="var(--warn-hot)" label="75–95%" detail="approaching the trigger" />
              <LegendRow swatch="var(--neg)" label="≥ 95%" detail="at or past it — Triggered comes from the stored flag" />
            </div>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Recession-probability bands</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <LegendRow swatch="var(--pos)" label="< 20%" detail="Low Risk" />
              <LegendRow swatch="var(--warn-hot)" label="20–40%" detail="Elevated" />
              <LegendRow swatch="var(--neg)" label="≥ 40%" detail="High Risk — gauge arc, badge, and this legend share one palette" />
            </div>
          </Card>
          <Card>
            <div style={eyebrowStyle}>News significance · 1–5</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              <LegendRow swatch="var(--neg)" label="≥ 4.5" detail="critical" />
              <LegendRow swatch="var(--warn-hot)" label="≥ 3.5" detail="high impact" />
              <LegendRow swatch="var(--warn)" label="≥ 2.5" detail="notable" />
              <LegendRow swatch="var(--text-muted)" label="< 2.5" detail="routine — blend of market, deal size, sector, timing, regime weights" />
            </div>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Status vocabularies</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8, fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.6 }}>
              <span>
                Signals: <Tag tone="pos" size="sm">Clear</Tag> <Tag tone="warn" size="sm">Watch</Tag>{" "}
                <Tag tone="neg" size="sm">Triggered</Tag>
              </span>
              <span>
                Alerts: info · watch · risk — Markets read: Risk-On · Risk-Off · Mixed — model vs
                market: Aligned · Diverges
              </span>
              <span>Credit states: Normal · Tight · Stressed · Crisis (HY/IG bps ladders on the Credit tab)</span>
            </div>
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader title="Models & measurements" right="what is computed, what is reference" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <Card>
            <div style={eyebrowStyle}>Computed live from stored data</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.7, marginTop: 6 }}>
              Regime probabilities and history · signal states · recession model (logistic
              regression on NBER dates, features lagged 3 months) · credit metrics, percentiles and
              transition matrices · weekly surprise z-scores · backtested forward returns ·
              allocation optimizations and risk analytics (24y of monthly returns) · LBO deal math.
            </div>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Labeled reference content</div>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.7, marginTop: 6 }}>
              Regime playbooks (sector tilts, typical indicators) · the 7-period analogue corpus ·
              scenario definitions and the stress rule · NBER recession windows. Reference blocks
              say so in their captions — nothing pretends to be measured that isn&apos;t.
            </div>
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader title="Data provenance" right="every feed, its cadence" />
        <Card>
          <div style={{ display: "grid", gap: 6, fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)", lineHeight: 1.6 }}>
            <span>FRED — macro series, yields, BAML OAS · refreshed mornings ET, monthly/daily cadences</span>
            <span>yfinance — daily candles for the stored ETF universe · intraday 5-minute bars for SPY/QQQ</span>
            <span>EODHD WebSocket — live tape quotes (crypto & FX around the clock; US equities in session; 15-min delayed REST fills)</span>
            <span>Finnhub · NewsAPI · RSS wires — headlines, hourly, deduped and scored; top items get a Claude regime read and Perplexity-cited research</span>
            <span>Hand-maintained CSV — the macro-events calendar</span>
          </div>
          <Caption>
            Every surface states its own as-of date and falls back to latest-available data with its
            date instead of an empty screen. Automated briefing from Macro Regime Radar. Not
            investment advice.
          </Caption>
        </Card>
      </section>
    </div>
  );
}
