/**
 * Spread monitor, `<section id="oas">` (redesign Phase 6, checklist 06 B.3):
 * five SignalCards, one per ICE BofA OAS tier, then the C10 caption.
 *
 * Every figure is a served field of `CreditMetrics` (bps, monthly cadence):
 * the badge words are the classification rules for the tier (`credit.py`
 * Crisis > 700, Stressed > 400, Tight IG > 150) plus the 1,000 bps distress
 * line for CCC; the meters are the served percentile ranks (HY and IG only,
 * F1: no rank is served for BB, B or CCC, so those cards carry no meter and
 * nothing stands in for it). The MoM colour rule of the pre-Phase-6
 * SpreadCard survives inside the first mono line: widening red, tightening
 * green, the text unchanged.
 */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader, SignalCard } from "../../components";
import type { SignalTone } from "../../components/signals/SignalCard";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { fmtBps, ordinal } from "../../lib/format";
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
  /** Served percentile rank; only HY and IG have one (F1). */
  rank?: Read;
  /** Badge word and tint from the tier's own rule. */
  badge: (v: number) => { badge: ReactNode; tone: SignalTone };
  /** The second mono line: descriptor plus the rule that applies. */
  second: (m: CreditMetrics) => ReactNode;
}

const TIERS: Tier[] = [
  {
    key: "hy",
    name: "High yield",
    oas: (m) => m.hy_oas,
    chg: (m) => m.hy_1w_change,
    spark: (m) => m.hy_sparkline,
    rank: (m) => m.hy_pct_rank,
    badge: (v) => (v <= 400 ? { badge: "Normal", tone: "clear" } : v <= 700 ? { badge: "Stressed", tone: "watch" } : { badge: "Crisis", tone: "alert" }),
    second: () => "BB & below · Stressed above 400 bps, Crisis above 700 bps.",
  },
  {
    key: "ig",
    name: "Investment grade",
    oas: (m) => m.ig_oas,
    chg: (m) => m.ig_1w_change,
    spark: (m) => m.ig_sparkline,
    rank: (m) => m.ig_pct_rank,
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
    badge: () => ({ badge: "Monitor", tone: "info" }),
    second: () => "Crossover quality · no classification rule.",
  },
  {
    key: "b",
    name: "Single-B",
    oas: (m) => m.b_oas,
    chg: (m) => m.b_1w_change,
    spark: (m) => m.b_sparkline,
    badge: () => ({ badge: "Monitor", tone: "info" }),
    second: () => "Core of the high-yield index · no classification rule.",
  },
  {
    key: "ccc",
    name: "CCC",
    oas: (m) => m.ccc_oas,
    chg: (m) => m.ccc_1w_change,
    spark: (m) => m.ccc_sparkline,
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
  const rank = tier.rank ? tier.rank(m) : null;
  return (
    <SignalCard
      as="article"
      heading="h3"
      data-tier={tier.key}
      name={tier.name}
      badge={badge}
      tone={tone}
      value={`${Math.round(v)} bps`}
      sparkline={values}
      // The meter is the served rank over the full history from Dec 1996
      // (credit.py `_pct_rank`); no rank served means no meter, never a stand-in.
      showGauge={rank != null}
      fillPct={rank ?? 0}
      meterLabel="Percentile since 1996"
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
          {/* C10 caption, verbatim (U-CAP): the percent stated once beside the bps figure. */}
          <Caption>
            <Jargon term="OAS">Option-adjusted spreads</Jargon>: the extra yield corporate bonds pay
            over Treasuries.{" "}
            {m.hy_oas != null && m.hy_pct_rank != null && (
              <>
                High yield sits at {Math.round(m.hy_oas)} bps ({(m.hy_oas / 100).toFixed(2)}pp), the{" "}
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
        </>
      ) : (
        <Card variant="tile">
          <StateNote loading={status === "loading"} error={status === "error"} />
        </Card>
      )}
    </Card>
  );
}
