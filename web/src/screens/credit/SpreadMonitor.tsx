/**
 * Spread monitor, `<section id="oas">` (redesign Phase 6, checklist 06 B.3):
 * five SignalCards, one per ICE BofA OAS tier, then the C10 caption.
 *
 * Every figure is a served field of `CreditMetrics` (bps, monthly cadence):
 * the badge words are the classification rules for the tier (`credit.py`
 * Crisis > 700, Stressed > 400, Tight IG > 150) plus the 1,000 bps distress
 * line for CCC; the meters are the served percentile ranks for HY and IG and
 * the served distress-line share for CCC (F1: no rank is served for BB or B,
 * so their meter slot is marked "No percentile served" over an empty track;
 * Iteration 1 G3 keeps one slot layout across the five cards). The MoM colour rule of the pre-Phase-6
 * SpreadCard survives inside the first mono line: widening red, tightening
 * green, the text unchanged.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader, SignalCard } from "../../components";
import type { SignalTone } from "../../components/signals/SignalCard";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { fmtBps, ordinal } from "../../lib/format";
import Disclosure from "../shared/Disclosure";
import Jargon from "../shared/Jargon";
import { Caption, StateNote } from "../shared/screen-ui";
import type { CreditPanelProps } from "./panel-props";

/** The null-value glyph the ledger prints (U+2014), never an em-dash aside. */
const DASH = "—";

type Read = (m: CreditMetrics) => number | null;

interface Tier {
  key: "hy" | "ig" | "bb" | "b" | "ccc";
  /** The h3 (mockup card names, C.4 #5). */
  name: string;
  oas: Read;
  chg: Read;
  spark: (m: CreditMetrics) => DatedValue[];
  /** The meter slot: the served percentile rank (HY, IG), the served
   * distress-line share (CCC), or the marked "not served" slot (BB, B). */
  meter: (m: CreditMetrics) => { kind: "rank" | "distress" | "none"; pct: number; label: string };
  /** Badge word and tint from the tier's own rule. */
  badge: (v: number) => { badge: ReactNode; tone: SignalTone };
  /** The second mono line: descriptor plus the rule that applies. */
  second: (m: CreditMetrics) => ReactNode;
}

/** The marked empty meter slot: no rank is served for this tier (F1). */
const NO_RANK = { kind: "none" as const, pct: 0, label: "No percentile served" };

const rankMeter = (rank: number | null) =>
  rank != null ? { kind: "rank" as const, pct: rank, label: "Percentile since 1996" } : NO_RANK;

const TIERS: Tier[] = [
  {
    key: "hy",
    name: "High yield",
    oas: (m) => m.hy_oas,
    chg: (m) => m.hy_1w_change,
    spark: (m) => m.hy_sparkline,
    meter: (m) => rankMeter(m.hy_pct_rank),
    badge: (v) => (v <= 400 ? { badge: "Normal", tone: "clear" } : v <= 700 ? { badge: "Stressed", tone: "watch" } : { badge: "Crisis", tone: "alert" }),
    second: () => "BB & below · Stressed above 400 bps, Crisis above 700 bps.",
  },
  {
    key: "ig",
    name: "Investment grade",
    oas: (m) => m.ig_oas,
    chg: (m) => m.ig_1w_change,
    spark: (m) => m.ig_sparkline,
    meter: (m) => rankMeter(m.ig_pct_rank),
    // The Tight badge is the decision-3 affordance: a Tag wrapping a Jargon.
    badge: (v) => (v <= 150 ? { badge: "Normal", tone: "clear" } : { badge: <Jargon term="Tight">Tight</Jargon>, tone: "info" }),
    second: () => "BBB- or better · Tight above 150 bps.",
  },
  {
    key: "bb",
    name: "BB",
    oas: (m) => m.bb_oas,
    chg: (m) => m.bb_1w_change,
    spark: (m) => m.bb_sparkline,
    meter: () => NO_RANK,
    badge: () => ({ badge: "Monitor", tone: "info" }),
    second: () => "Crossover quality · no classification rule.",
  },
  {
    key: "b",
    name: "Single-B",
    oas: (m) => m.b_oas,
    chg: (m) => m.b_1w_change,
    spark: (m) => m.b_sparkline,
    meter: () => NO_RANK,
    badge: () => ({ badge: "Monitor", tone: "info" }),
    second: () => "Core of the high-yield index · no classification rule.",
  },
  {
    key: "ccc",
    name: "CCC",
    oas: (m) => m.ccc_oas,
    chg: (m) => m.ccc_1w_change,
    spark: (m) => m.ccc_sparkline,
    meter: (m) =>
      m.ccc_pct_of_distress_line != null
        ? { kind: "distress", pct: Math.min(100, Math.max(0, m.ccc_pct_of_distress_line)), label: "Vs the 1,000 bps distress line" }
        : NO_RANK,
    // The 1,000 bps distress line (Jargon "distress"), not today's silent 700 flip (G8).
    badge: (v) => (v < 1000 ? { badge: "Watch", tone: "watch" } : { badge: "Distressed", tone: "alert" }),
    second: (m) =>
      m.ccc_pct_of_distress_line != null ? (
        <>
          Weakest credits · {m.ccc_pct_of_distress_line.toFixed(0)}% of the 1,000 bps <Jargon term="distress">distress</Jargon> line.
        </>
      ) : (
        "Weakest credits."
      ),
  },
];

/** "{±n} bps MoM" with the figure red when widening, green when tightening;
 * a null change prints the dash in the figure's slot (B.10). */
function momLine(c: number | null): ReactNode {
  const color = c == null || c === 0 ? undefined : c > 0 ? "var(--neg)" : "var(--pos)";
  return (
    <>
      <span style={color ? { color } : undefined}>{c == null ? DASH : fmtBps(c)}</span> MoM
    </>
  );
}

function TierCard({ m, tier }: { m: CreditMetrics; tier: Tier }) {
  const v = tier.oas(m);
  const values = tier.spark(m).map((p) => p.value);
  const lines = [momLine(tier.chg(m)), tier.second(m)];
  if (v == null) {
    // The 02 B.3 unavailable state: dash value, reference tint, no meter (B.10).
    return (
      <SignalCard as="article" heading="h3" data-tier={tier.key} name={tier.name} value={DASH} badge="Unavailable" tone="reference" showGauge={false} lastTriggered={null} sparkline={values} lines={lines} />
    );
  }
  const { badge, tone } = tier.badge(v);
  const meter = tier.meter(m);
  return (
    <SignalCard
      as="article"
      heading="h3"
      data-tier={tier.key}
      data-meter={meter.kind}
      name={tier.name}
      badge={badge}
      tone={tone}
      value={`${Math.round(v)} bps`}
      sparkline={values}
      // One slot layout for the five cards (Iteration 1 G3): every card carries
      // the meter slot. HY and IG fill it with the served rank over the full
      // history from Dec 1996 (credit.py `_pct_rank`); CCC with the served
      // share of the 1,000 bps distress line, capped at a full bar (the
      // Quality ladder tile's meter); BB and B are marked "No percentile
      // served" over an empty track, never a stand-in number (F1).
      showGauge
      fillPct={meter.pct}
      meterLabel={meter.label}
      lastTriggered={null}
      lines={lines}
    />
  );
}

export default function SpreadMonitor({ m, status }: CreditPanelProps): JSX.Element {
  const ready = status === "ready" && m != null;
  const latest = m?.data_as_of ?? (status === "loading" ? "loading" : "unavailable");
  return (
    <Card as="section" variant="panel" id="oas" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Spread monitor"
        description="Option-adjusted spreads by rating"
        right={`5 series · latest ${latest}`}
        actions={
          <Link className="mrr-link" to="/app/methodology#models">
            Series notes →
          </Link>
        }
      />
      {ready && m ? (
        <>
          <div className="mrr-credit-monitor">
            {TIERS.map((t) => (
              <TierCard key={t.key} m={m} tier={t} />
            ))}
          </div>
          {/* C10 caption, verbatim (U-CAP): the percent stated once beside the bps figure.
              G4 (Iteration 1 step 5): two visible sentences; the investment-grade
              sentence (also the IG OAS summary row) sits behind Details. */}
          <Caption>
            <Jargon term="OAS">Option-adjusted spreads</Jargon>: the extra yield corporate bonds pay
            over Treasuries.{" "}
            {m.hy_oas != null && m.hy_pct_rank != null && (
              <>
                High yield sits at {Math.round(m.hy_oas)} bps ({(m.hy_oas / 100).toFixed(2)}pp), the{" "}
                {ordinal(m.hy_pct_rank)} <Jargon term="percentile">percentile</Jargon> of history since
                1996, tighter than {100 - Math.round(m.hy_pct_rank)}% of it.
              </>
            )}
          </Caption>
          {m.ig_oas != null && m.ig_pct_rank != null ? (
            <Disclosure variant="quiet" title="Details" style={{ marginTop: 2 }}>
              <Caption style={{ marginTop: 0 }}>
                Investment grade holds {Math.round(m.ig_oas)} bps, its {ordinal(m.ig_pct_rank)} percentile.
              </Caption>
            </Disclosure>
          ) : null}
        </>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
