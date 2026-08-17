/**
 * /kit — scratch route proving every design-system component renders.
 * Ports the five bundle specimens (core/data/intel/nav/signals *.card.html)
 * with their fixture data. FIXTURE DATA IS ALLOWED HERE AND NOWHERE ELSE —
 * real screens wire to the API.
 */

import { useEffect, useState } from "react";
import {
  AlertRow,
  Card,
  DataTable,
  GaugeBar,
  IntelBanner,
  NewsCard,
  ProbabilityBar,
  ReadThrough,
  RegimeBadge,
  SectionHeader,
  SignalCard,
  Sparkline,
  StatTile,
  StatusDot,
  TabBar,
  Tag,
  TickerStrip,
} from "../components";

const SPARK_SERIES = [3.9, 4.1, 3.8, 4.2, 4.4, 4.3, 4.0, 4.3, 4.5, 4.4, 4.3];

const TABLE_ROWS = [
  { sym: "SPY", name: "S&P 500 ETF", px: "612.40", chg: "+0.28%", up: 1 },
  { sym: "TLT", name: "20Y+ Treasury", px: "88.12", chg: "-0.64%", up: 0 },
  { sym: "GLD", name: "Gold", px: "271.05", chg: "+1.12%", up: 1 },
  { sym: "VIXY", name: "Short-term VIX", px: "41.88", chg: "-3.90%", up: 0 },
];

/** Drifting quotes so the TickerStrip's 600ms tick flash is visible (demo only). */
function useDriftingQuotes() {
  const [n, setN] = useState({ spy: 0.28, vix: 16.9, ten: 4.4 });
  useEffect(() => {
    const i = setInterval(
      () =>
        setN((p) => ({
          spy: +(p.spy + (Math.random() - 0.5) * 0.14).toFixed(2),
          vix: +(p.vix + (Math.random() - 0.5) * 0.4).toFixed(2),
          ten: +(p.ten + (Math.random() - 0.5) * 0.03).toFixed(2),
        })),
      2200,
    );
    return () => clearInterval(i);
  }, []);
  return n;
}

export default function KitScreen() {
  const [tab, setTab] = useState("Markets");
  const n = useDriftingQuotes();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg-base)",
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        padding: "24px 28px 80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: ".14em",
            textTransform: "uppercase",
          }}
        >
          Component Kit
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            letterSpacing: "1px",
            color: "var(--text-faint)",
            textTransform: "uppercase",
          }}
        >
          17 components · fixture data · dev scratch route
        </span>
      </div>

      {/* ── Core ─────────────────────────────────────────────────────── */}
      <SectionHeader title="Core — Card · SectionHeader · Tag · StatusDot" right="core.card.html" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
        <Card>
          <SectionHeader title="Default" style={{ marginTop: 0 }} right="12px pad" />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Hairline border, flat surface.</div>
        </Card>
        <Card tone="watch">
          <SectionHeader title="Watch" style={{ marginTop: 0 }} />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Amber hairline at 30%.</div>
        </Card>
        <Card tone="risk" accentBar>
          <SectionHeader title="Risk + rail" style={{ marginTop: 0 }} />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>3px left accent bar.</div>
        </Card>
      </div>
      <Card surface="var(--void)" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
        <StatusDot status="live" label="Live" />
        <StatusDot status="clear" label="Clear" />
        <StatusDot status="watch" label="Watch" />
        <StatusDot status="risk" label="Triggered" pulse />
        <StatusDot status="idle" label="Stale" />
      </Card>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
        <Tag>Neutral</Tag>
        <Tag tone="accent">Info</Tag>
        <Tag tone="pos">Clear</Tag>
        <Tag tone="warn">Watch</Tag>
        <Tag tone="hot">Elevated</Tag>
        <Tag tone="neg">Risk</Tag>
        <Tag tone="research">Perplexity</Tag>
        <Tag tone="accent" size="md">
          Medium conviction
        </Tag>
      </div>
      <SectionHeader title="Subsection level" level="sub" />

      {/* ── Data ─────────────────────────────────────────────────────── */}
      <SectionHeader title="Data — StatTile · GaugeBar · Sparkline · ProbabilityBar · DataTable" right="data.card.html" />
      <Card style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16 }}>
        <StatTile label="Fed Funds" value="3.64%" delta="0.00" direction="flat" />
        <StatTile label="10Y Treasury" value="4.30%" delta="+0.10" direction="up" live />
        <StatTile label="2s10s Spread" value="+52 bps" delta="+0.01" direction="up" />
        <StatTile label="VIX" value="18.92" delta="-6.33" direction="down" />
      </Card>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Card>
          <div
            style={{
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              letterSpacing: "1.5px",
              color: "var(--text-faint)",
              marginBottom: 6,
            }}
          >
            THRESHOLD RAMP
          </div>
          <GaugeBar pct={32} />
          <GaugeBar pct={62} />
          <GaugeBar pct={88} />
          <GaugeBar pct={98} />
        </Card>
        <Card>
          <div
            style={{
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              letterSpacing: "1.5px",
              color: "var(--text-faint)",
              marginBottom: 8,
            }}
          >
            US 10Y · 11M
          </div>
          <Sparkline values={SPARK_SERIES} width={280} height={40} />
          <div style={{ marginTop: 12 }}>
            <ProbabilityBar probs={{ goldilocks: 0, overheating: 0.52, stagflation: 0.48, recession: 0 }} />
          </div>
        </Card>
      </div>
      <Card padding="0" style={{ marginTop: 12 }}>
        <DataTable
          columns={[
            { key: "sym", label: "Sym", mono: true },
            { key: "name", label: "Name" },
            { key: "px", label: "Price", align: "right", mono: true },
            {
              key: "chg",
              label: "1D Chg",
              align: "right",
              mono: true,
              render: (r: (typeof TABLE_ROWS)[number]) => (
                <span style={{ color: r.up ? "var(--pos)" : "var(--neg-text)" }}>{r.chg}</span>
              ),
            },
          ]}
          rows={TABLE_ROWS}
        />
      </Card>

      {/* ── Signals ──────────────────────────────────────────────────── */}
      <SectionHeader title="Signals — RegimeBadge · SignalCard · AlertRow" right="signals.card.html" />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <RegimeBadge label="Goldilocks" />
        <RegimeBadge label="Overheating" confidence={0.52} />
        <RegimeBadge label="Stagflation" />
        <RegimeBadge label="Recession Risk" />
        <RegimeBadge label="Overheating" size="sm" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 12 }}>
        <SignalCard name="Curve inversion risk" value="0.52%" fillPct={34} lastTriggered="Jan 2025" />
        <SignalCard name="Inflation pressure" value="3.29% YoY" fillPct={68} lastTriggered="Mar 2026" />
        <SignalCard name="VIX spike" value="18.92" fillPct={96} lastTriggered="Apr 2026" />
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        <AlertRow level="risk" name="VIX_shock" message="VIX weekly z-score=3.21 — above 3.0 risk threshold." date="2026-05-01" />
        <AlertRow level="watch" name="credit_stress" message="HYG underperformed SPY by -3.40% — credit stress watch." date="2026-04-30" />
        <AlertRow level="info" name="unemployment_spike" message="Unemployment Spike triggered (last triggered 2026-02)." date="2026-02-01" />
      </div>

      {/* ── Navigation ───────────────────────────────────────────────── */}
      <SectionHeader title="Navigation — TickerStrip · TabBar" right="nav.card.html · values drift for demo" />
      <TickerStrip
        items={[
          {
            label: "S&P 500",
            value: (n.spy > 0 ? "+" : "") + n.spy.toFixed(2) + "%",
            raw: n.spy,
            tone: n.spy > 0 ? "pos" : "neg",
          },
          { label: "VIX", value: n.vix.toFixed(1), raw: n.vix, change: "-8.36", changeTone: "pos" },
          { label: "US 10Y", value: n.ten.toFixed(2) + "%", raw: n.ten, change: "+10bps", changeTone: "neg" },
        ]}
      />
      <div style={{ marginTop: 18 }}>
        <TabBar
          tabs={["Dashboard", "Regime Lab", "Markets", "Credit", "Recession", "News & Calendar", "Tools"]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {/* ── Intelligence ─────────────────────────────────────────────── */}
      <SectionHeader title="Intelligence — IntelBanner · ReadThrough · NewsCard" right="intel.card.html" />
      <div style={{ display: "grid", gap: 12 }}>
        <IntelBanner
          conviction="Medium"
          headline="Markets are in Overheating regime (54% probability) with credit spreads at the 4th percentile — historically tight. Recession risk is elevated at 17%."
          meta={[
            { label: "Signal", value: "Risk-On", color: "var(--pos)" },
            { label: "Duration", value: "3.0mo", color: "var(--warn-hot)" },
          ]}
          action="See Regime Lab for full analysis"
          onAction={() => undefined}
        />
        <ReadThrough
          paragraphs={[
            "Current conditions are consistent with an Overheating regime (high confidence): the economy is running above trend while inflation remains elevated, a combination that historically pressures rate-sensitive assets and steepens the front end of the yield curve.",
            "The classification is primarily driven by CPI at 3.29% YoY, unemployment at 4.3%, the 10Y–2Y spread at 0.52% and VIX at 16.9. The regime reading is unchanged for 3 consecutive months.",
          ]}
          footerLabel="Playbook bias"
          footer="Inflation risk elevated. Prefer real assets (GLD, commodities) and TIPS. Shorten duration — TLT headwinds. Value over growth; energy/materials over tech."
        />
        <NewsCard
          source="FINNHUB"
          time="2h ago"
          ticker="SPY"
          significance={6.4}
          headline="Fed nominee signals tolerance for above-target inflation through 2027"
          summary="Testimony pushed back on near-term cuts and framed 3% core as acceptable while labour markets stay tight."
          interpretation="Reinforces the Overheating read: sticky inflation with intact growth. Watch 10Y 4.35% — a clean break confirms the Overheating tilt over Stagflation drift."
          sources={[
            "https://www.federalreserve.gov/econres/notes/feds-notes/relationship-between-macroeconomic-overheating-and-financial-vulnerability-narrative-20181012.html",
          ]}
        />
      </div>
    </div>
  );
}
