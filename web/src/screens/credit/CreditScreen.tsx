/**
 * Credit — locked IA: OAS dashboard (HY/IG heroes + history), quality ladder
 * (BB/B/CCC + ratio/distress + transition matrices), financing conditions
 * (sole owner of the all-in cost card; Tools · LBO links here).
 *
 * One data source: /api/credit/metrics (src/analytics/credit.py verbatim —
 * values in bps, monthly FRED cadence). Captions follow the confusion-index
 * worklist: #6 ordinal percentiles, #8 distress vs Normal paradox, #16 bps
 * and percent stated together, #26 HY/IG ratio norm.
 */

import { Fragment } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader, Sparkline, Tag } from "../../components";
import { useCreditMetrics } from "../../api/queries";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { ordinal } from "../../lib/format";
import LineChart from "../dashboard/LineChart";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, eyebrowStyle, mono, useHashScroll } from "../shared/screen-ui";

/** NBER recession windows shaded on the OAS history — the same three the
 * Streamlit tab pins (static reference, monthly resolution). */
const NBER_BANDS = [
  { from: "2001-03-01", to: "2001-11-30" },
  { from: "2007-12-01", to: "2009-06-30" },
  { from: "2020-02-01", to: "2020-04-30" },
];

const CREDIT_STATES = ["Normal", "Tight", "Stressed", "Crisis"] as const;

const STATE_COLORS: Record<string, string> = {
  Normal: "var(--pos)",
  Tight: "var(--accent)",
  Stressed: "var(--warn-hot)",
  Crisis: "var(--neg-text)",
};

interface TierDef {
  key: "hy" | "ig" | "bb" | "b" | "ccc";
  label: string;
  name: string;
  tone: (v: number) => "clear" | "watch" | "risk" | "accent";
}

const HERO_TIERS: TierDef[] = [
  {
    key: "hy",
    label: "HY",
    name: "High yield (BB & below)",
    tone: (v) => (v < 400 ? "clear" : v <= 700 ? "watch" : "risk"),
  },
  {
    key: "ig",
    label: "IG",
    name: "Investment grade",
    tone: (v) => (v <= 150 ? "clear" : "watch"),
  },
];

const LADDER_TIERS: TierDef[] = [
  { key: "bb", label: "BB", name: "Crossover quality", tone: () => "accent" },
  { key: "b", label: "B", name: "Single-B", tone: () => "accent" },
  {
    key: "ccc",
    label: "CCC",
    name: "Weakest credits",
    tone: (v) => (v < 700 ? "watch" : "risk"),
  },
];

function chg(m: CreditMetrics, key: TierDef["key"]): number | null {
  return m[`${key}_1w_change` as keyof CreditMetrics] as number | null;
}

function oas(m: CreditMetrics, key: TierDef["key"]): number | null {
  return m[`${key}_oas` as keyof CreditMetrics] as number | null;
}

function spark(m: CreditMetrics, key: TierDef["key"]): DatedValue[] {
  return m[`${key}_sparkline` as keyof CreditMetrics] as DatedValue[];
}

/** Spread card — MoM change colors are INVERTED vs equities: widening (+) is
 * red, tightening (−) is green. StatTile's up-green arrow grammar would lie
 * here, so the card is bespoke. */
function SpreadCard({ m, tier, big }: { m: CreditMetrics; tier: TierDef; big?: boolean }) {
  const v = oas(m, tier.key);
  const c = chg(m, tier.key);
  const sp = spark(m, tier.key).map((p) => p.value);
  if (v == null) return null;
  const chgColor = c == null ? "var(--text-muted)" : c >= 0 ? "var(--neg-text)" : "var(--pos)";
  return (
    <Card tone={tier.tone(v)}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={eyebrowStyle}>
          {tier.label}
          <span style={{ color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}>
            {" "}
            · {tier.name}
          </span>
        </span>
        {sp.length >= 2 && <Sparkline values={sp} width={64} height={16} color="var(--accent)" />}
      </div>
      <div
        style={{
          ...mono,
          fontSize: big ? 26 : "var(--fs-value)",
          fontWeight: 600,
          letterSpacing: "var(--ls-numeric)",
          marginTop: 6,
        }}
      >
        {Math.round(v)} <span style={{ fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>bps</span>
      </div>
      <div style={{ ...mono, fontSize: "var(--fs-meta)", color: chgColor, marginTop: 2 }}>
        {c == null ? "—" : `${c >= 0 ? "+" : ""}${Math.round(c)} bps vs prev month`}
      </div>
    </Card>
  );
}

/** 4×4 credit-state transition matrix (monthly history, 3M or 6M ahead). */
function TransitionMatrix({
  matrix,
  current,
  title,
  emptyStates = [],
}: {
  matrix: Record<string, Record<string, number>>;
  current: string;
  title: string;
  /** States with zero historical months — their rows render as "—", not as
   * measured 0% cells (critique: a never-occurred state is empty, not calm). */
  emptyStates?: string[];
}) {
  if (!matrix || !Object.keys(matrix).length) {
    return <StateNote>Not enough monthly history for transition odds (needs 60 months).</StateNote>;
  }
  const cell = (from: string, to: string) => {
    if (emptyStates.includes(from)) {
      return (
        <div key={to} style={{ ...mono, fontSize: "var(--fs-meta)", textAlign: "right", padding: "5px 8px", color: "var(--text-faint)" }}>
          —
        </div>
      );
    }
    const p = matrix[from]?.[to] ?? 0;
    const onDiag = from === to;
    const bg =
      p >= 0.5
        ? onDiag
          ? "rgba(63,185,80,.12)"
          : "rgba(74,158,255,.12)"
        : p >= 0.2
          ? "rgba(139,148,158,.10)"
          : "transparent";
    const color = p >= 0.2 ? "var(--text)" : "var(--text-muted)";
    return (
      <div
        key={to}
        style={{
          ...mono,
          fontSize: "var(--fs-meta)",
          textAlign: "right",
          padding: "5px 8px",
          background: bg,
          color,
          borderRadius: "var(--r-xs)",
        }}
      >
        {Math.round(p * 100)}%
      </div>
    );
  };
  return (
    <div>
      <div style={{ ...eyebrowStyle, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "64px repeat(4, 1fr)", gap: 2, alignItems: "center" }}>
        <span />
        {CREDIT_STATES.map((s) => (
          <span key={s} style={{ ...mono, fontSize: 9, letterSpacing: "var(--ls-wide)", textTransform: "uppercase", color: "var(--text-muted)", textAlign: "right", padding: "0 8px" }}>
            → {s}
          </span>
        ))}
        {CREDIT_STATES.map((from) => (
          <Fragment key={from}>
            <span
              key={`${from}-label`}
              style={{
                ...mono,
                fontSize: "var(--fs-meta)",
                color: from === current ? STATE_COLORS[from] : "var(--text-muted)",
                fontWeight: from === current ? 700 : 400,
              }}
            >
              {from}
            </span>
            {CREDIT_STATES.map((to) => cell(from, to))}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export default function CreditScreen() {
  const q = useCreditMetrics();
  const m = q.data;
  useHashScroll(m);

  if (!m) {
    return (
      <Card>
        <StateNote loading={q.isLoading} error={q.isError} />
      </Card>
    );
  }

  // LineChart maps x by index PER SERIES, so both series must run over the
  // exact same date set — intersect them (audit: filtering only IG stretched
  // a shorter IG curve across the full width, shifting it against HY).
  const igByDate = new Map(m.ig_series.map((p) => [p.date, p.value]));
  const commonDates = m.hy_series.filter((p) => igByDate.has(p.date));
  const hySeries = commonDates.map((p) => ({ x: p.date, y: p.value }));
  const igSeries = commonDates.map((p) => ({ x: p.date, y: igByDate.get(p.date) as number }));

  const stay3 =
    m.transition_3m?.[m.credit_label]?.[m.credit_label] != null
      ? Math.round(m.transition_3m[m.credit_label][m.credit_label] * 100)
      : null;
  // The client does not rank credit states or sum a "deterioration"
  // probability — that ordinality belongs to src/analytics/credit.py (audit).
  // The matrices speak for themselves; stay-probability is a direct read.

  const distressPct = m.distress_ratio;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── OAS dashboard ─────────────────────────────────────────────── */}
      <section id="oas">
        <SectionHeader
          title="Credit conditions"
          right={
            <>
              <Tag tone={m.credit_label === "Normal" ? "pos" : m.credit_label === "Tight" ? "accent" : m.credit_label === "Stressed" ? "warn" : "neg"} size="sm">
                {m.credit_label}
              </Tag>
              <span style={{ marginLeft: 8 }}>
                ICE BofA via FRED · monthly · latest {m.data_as_of ?? "—"}
              </span>
            </>
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          {HERO_TIERS.map((t) => (
            <SpreadCard key={t.key} m={m} tier={t} big />
          ))}
        </div>
        <Caption>
          <Jargon term="OAS">Option-adjusted spreads</Jargon> — the extra yield corporate bonds pay
          over Treasuries.{" "}
          {m.hy_oas != null && m.hy_pct_rank != null && (
            <>
              High yield sits at {Math.round(m.hy_oas)} bps ({(m.hy_oas / 100).toFixed(2)}pp) — the{" "}
              {ordinal(m.hy_pct_rank)} <Jargon term="percentile">percentile</Jargon> of history since
              1996, tighter than {100 - Math.round(m.hy_pct_rank)}% of it.
            </>
          )}{" "}
          {m.ig_oas != null && m.ig_pct_rank != null && (
            <>
              Investment grade holds {Math.round(m.ig_oas)} bps, its {ordinal(m.ig_pct_rank)}{" "}
              percentile.
            </>
          )}
        </Caption>

        <Card style={{ marginTop: 12 }}>
          <LineChart
            series={[
              { label: "HY OAS", color: "var(--warn-hot)", points: hySeries },
              { label: "IG OAS", color: "var(--accent)", points: igSeries },
            ]}
            height={190}
            yFmt={(v) => `${Math.round(v)} bps`}
            bands={NBER_BANDS}
            caption="High-yield and investment-grade option-adjusted spreads, monthly history"
          />
          <Caption>
            Spreads spike when lenders panic — the shaded bands mark the 2001, 2008–09 and 2020{" "}
            <Jargon term="NBER">NBER</Jargon> recessions.{" "}
            {m.hy_pct_rank != null &&
              (m.hy_pct_rank <= 33
                ? "Today's readings sit in the tight third of history — credit markets price almost no default stress."
                : m.hy_pct_rank <= 67
                  ? "Today's readings sit mid-range by history — neither stress nor complacency."
                  : "Today's readings sit in the wide third of history — lenders are charging real default risk.")}
          </Caption>
        </Card>
      </section>

      {/* ── Quality ladder ────────────────────────────────────────────── */}
      <section id="quality-ladder">
        <SectionHeader title="Quality ladder" right="BB · B · CCC detail · monthly" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
          {LADDER_TIERS.map((t) => (
            <SpreadCard key={t.key} m={m} tier={t} />
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginTop: 12 }}>
          <Card>
            <div style={eyebrowStyle}>HY / IG ratio</div>
            <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, marginTop: 6 }}>
              {m.hy_ig_ratio != null ? `${m.hy_ig_ratio.toFixed(2)}×` : "—"}
            </div>
            <Caption>
              High-yield trades at {m.hy_ig_ratio?.toFixed(2)}× the investment-grade spread —{" "}
              {m.hy_ig_ratio != null && Math.abs(m.hy_ig_ratio - 3.5) <= 0.1
                ? "right on"
                : m.hy_ig_ratio != null && Math.abs(m.hy_ig_ratio - 3.5) <= 0.75
                  ? "near"
                  : m.hy_ig_ratio != null && m.hy_ig_ratio > 3.5
                    ? "above"
                    : "below"}{" "}
              the ~3.5× long-run norm (2008 peaked at 8.2×). A rising ratio means the market is
              punishing weak credits faster than strong ones.
            </Caption>
          </Card>
          <Card tone={distressPct != null && distressPct >= 100 ? "risk" : "default"}>
            <div style={eyebrowStyle}>Distress ratio</div>
            <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, marginTop: 6 }}>
              {distressPct != null ? `${distressPct.toFixed(1)}%` : "—"}
            </div>
            {distressPct != null && (
              <>
                <div
                  style={{
                    height: 4,
                    borderRadius: "var(--r-xs)",
                    background: "var(--surface-raised)",
                    overflow: "hidden",
                    marginTop: 8,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.min(distressPct, 100)}%`,
                      background: distressPct >= 100 ? "var(--neg)" : distressPct >= 80 ? "var(--warn-hot)" : "var(--warn)",
                    }}
                  />
                </div>
                {distressPct > 100 && (
                  <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--neg-text)", marginTop: 3 }}>
                    ▲ {(distressPct - 100).toFixed(1)}pp past the line — the bar caps at 100%
                  </div>
                )}
              </>
            )}
            <Caption>
              {m.ccc_oas != null && (
                <>
                  CCC spreads sit at {Math.round(m.ccc_oas)} bps — {distressPct?.toFixed(0)}% of the
                  1,000 bps <Jargon term="distress">distress</Jargon> line. The weakest credits run
                  hot even while the broad market reads {m.credit_label} at{" "}
                  {m.hy_oas != null ? Math.round(m.hy_oas) : "—"} bps — the two statements are about
                  different rungs of the ladder, not a contradiction.
                </>
              )}
            </Caption>
          </Card>
        </div>

        <Card style={{ marginTop: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 20 }}>
            <TransitionMatrix
              matrix={m.transition_3m}
              current={m.credit_label}
              title="3-month transition odds"
              emptyStates={m.tight_count === 0 ? ["Tight"] : []}
            />
            <TransitionMatrix
              matrix={m.transition_6m}
              current={m.credit_label}
              title="6-month transition odds"
              emptyStates={m.tight_count === 0 ? ["Tight"] : []}
            />
          </div>
          <Caption>
            A <Jargon term="transition matrix">transition matrix</Jargon> counted from monthly
            credit states since 1996.{" "}
            {stay3 != null && (
              <>
                From today&apos;s {m.credit_label} state, spreads stayed {m.credit_label} three
                months later {stay3}% of the time
              </>
            )}
            .{m.tight_count < 5 && (
              <>
                {" "}
                {m.tight_count === 0
                  ? "The Tight state has never occurred since 1996 — its row renders empty, not zero-risk."
                  : `Tight-state rows rest on only ${m.tight_count} historical months — treat those odds as anecdote.`}
              </>
            )}
          </Caption>
        </Card>
      </section>

      {/* ── Financing conditions (sole owner; Tools · LBO links here) ── */}
      <section id="financing">
        <SectionHeader title="Financing conditions" right="Fed Funds + HY OAS · monthly" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
          <Card accentBar>
            <div style={eyebrowStyle}>LBO all-in cost</div>
            <div style={{ ...mono, fontSize: 26, fontWeight: 600, marginTop: 6 }}>
              {m.lbo_all_in_cost ?? "—"}
            </div>
            <Caption>
              Fed Funds plus the high-yield spread — the rough rate a leveraged buyout pays on its
              debt. Pre-GFC deals borrowed near ~7.2%; the 2022 peak touched ~11.4%.
            </Caption>
            <div style={{ marginTop: 8 }}>
              <Link
                to="/app/tools"
                style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--accent)", letterSpacing: "var(--ls-micro)" }}
              >
                → Model a deal at this rate in Tools · LBO
              </Link>
            </div>
          </Card>
          <Card>
            <div style={eyebrowStyle}>Classification ladder</div>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {(
                [
                  ["Normal", "HY ≤ 400 bps and IG ≤ 150 bps"],
                  ["Tight", "IG > 150 bps while HY holds ≤ 400"],
                  ["Stressed", "HY > 400 bps"],
                  ["Crisis", "HY > 700 bps"],
                ] as const
              ).map(([state, rule]) => (
                <div
                  key={state}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "4px 8px",
                    borderRadius: "var(--r-xs)",
                    background: state === m.credit_label ? "rgba(74,158,255,.08)" : "transparent",
                    borderLeft:
                      state === m.credit_label
                        ? `3px solid ${STATE_COLORS[state]}`
                        : "3px solid transparent",
                  }}
                >
                  <span style={{ ...mono, fontSize: "var(--fs-meta)", color: STATE_COLORS[state], fontWeight: state === m.credit_label ? 700 : 400 }}>
                    {state}
                    {state === m.credit_label ? " ← today" : ""}
                  </span>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{rule}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>

      <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--text-muted)" }}>
        ICE BofA option-adjusted spread indices via FRED, monthly observations · classification and
        transition odds computed by the same analytics module the memo reads.
      </div>
    </div>
  );
}
