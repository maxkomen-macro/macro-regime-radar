/**
 * Hero copy and the summary strip for the Credit TabHero (redesign Phase 6,
 * checklist 06 C.1 rules 1 to 8 and the B.2 strip table). Pure: no hooks, no
 * state; the one React call is `createElement` for the Tight lede's Jargon
 * affordance (rule 6). Every figure is a served field of CreditMetrics or its
 * formatted value. The strip never invents a widening threshold (G5): it reads
 * the sign-and-ordering flags of credit-rules.ts plus today's tension rule.
 */

import { Fragment, createElement, type ReactNode } from "react";
import type { CreditMetrics } from "../../api/types";
import { fmtBps, fmtMonYr, ordinal } from "../../lib/format";
import Jargon from "../shared/Jargon";
import type { StatusTone } from "../shared/SummaryCard";
import type { TabHeroPillTone } from "../shared/TabHero";
import { ladderFlags } from "./credit-rules";
import type { CreditPanelProps } from "./panel-props";

export { ladderFlags };
export type { LadderFlags } from "./credit-rules";

/** The query status the screen passes to every panel. */
export type CreditStatus = CreditPanelProps["status"];

/** Glow behind the hero's right column: the amber HY line lights the card
 * for Normal, Tight and Stressed (mockup credit.html:169); red for Crisis;
 * the derived gray for the loading and unavailable heroes (G4). */
export const CREDIT_GLOW = {
  amber: "rgba(245,181,46,.05)",
  crisis: "rgba(240,80,63,.06)",
  gray: "rgba(200,210,220,.05)",
} as const;

export interface CreditHeroCopy {
  /** The served credit_label, alone (rule 1). */
  headline: string;
  /** "HY OAS {n} bps"; null when hy_oas is null. */
  pill: string | null;
  pillTone: TabHeroPillTone;
  glow: string;
  /** Never empty (rule 2). */
  subhead: string;
  /** The why sentence plus the ladder sentence; for Tight, the rule-6 sentence
   * follows with its Jargon affordance. Null when nothing can be said. */
  lede: ReactNode;
  /** The same lede as plain text. */
  ledeText: string;
  footnote: string[];
}

const n = (v: number): number => Math.round(v);

/** The C4 why sentence by HY-percentile tercile (CreditScreen.tsx:321-325,
 * verbatim); null without a rank (rule 3). */
export function whySentence(rank: number | null | undefined): string | null {
  if (rank == null) return null;
  if (rank <= 33) {
    return "Lenders are pricing almost no default stress: spreads this tight leave little cushion, so the risk is asymmetric to widening, not to further tightening.";
  }
  if (rank <= 67) {
    return "Spreads sit mid-range by history: neither stress nor complacency, so credit is not the deciding input for the regime call right now.";
  }
  return "Lenders are charging real default risk: wide spreads are the credit market's own recession vote and feed the recession model directly.";
}

/** The hero chart caption's tercile sentence (CreditScreen.tsx:409-414,
 * verbatim; C13); null without a rank. */
export function chartTercile(rank: number | null | undefined): string | null {
  if (rank == null) return null;
  if (rank <= 33) return "Today's readings sit in the tight third of history: credit markets price almost no default stress.";
  if (rank <= 67) return "Today's readings sit mid-range by history: neither stress nor complacency.";
  return "Today's readings sit in the wide third of history: lenders are charging real default risk.";
}

/** "CCC moved +34 bps in the month, BB -2 bps and B +1 bps." A null rung's
 * clause is dropped (without CCC: "BB -2 bps and B +1 bps in the month.");
 * null when all three are null (rule 4). */
export function ladderSentence(m: CreditMetrics): string | null {
  const rest: string[] = [];
  if (m.bb_1w_change != null) rest.push(`BB ${fmtBps(m.bb_1w_change)}`);
  if (m.b_1w_change != null) rest.push(`B ${fmtBps(m.b_1w_change)}`);
  const tail = rest.join(" and ");
  if (m.ccc_1w_change != null) {
    const head = `CCC moved ${fmtBps(m.ccc_1w_change)} in the month`;
    if (!rest.length) return `${head}.`;
    return rest.length === 1 ? `${head} and ${tail}.` : `${head}, ${tail}.`;
  }
  return rest.length ? `${tail} in the month.` : null;
}

/** The C16 norm word for the HY / IG ratio (CreditScreen.tsx:447-453). */
export function ratioNormWord(ratio: number): "right on" | "near" | "above" | "below" {
  if (Math.abs(ratio - 3.5) <= 0.1) return "right on";
  if (Math.abs(ratio - 3.5) <= 0.75) return "near";
  return ratio > 3.5 ? "above" : "below";
}

/* Decision 3: the state name explained on screen, with the affordance; the
   h1 stays plain (G3). */
const TIGHT_LEAD = "Tight here means ";
const TIGHT_TERM = "IG above 150 bps";
const TIGHT_TAIL = " with high yield still at or under 400 bps.";

export function creditHero(m: CreditMetrics): CreditHeroCopy {
  const label = m.credit_label;
  const asOfIso = m.hy_series.length ? m.hy_series[m.hy_series.length - 1].date : null;

  // Rule 1: the pill is the only place besides the subhead that prints HY.
  const pill = m.hy_oas != null ? `HY OAS ${n(m.hy_oas)} bps` : null;

  // Rule 2: never an empty h2.
  let subhead: string;
  if (m.hy_oas == null) {
    subhead = "Spread levels are not stored for this month.";
  } else {
    subhead = `High yield at ${n(m.hy_oas)} bps`;
    if (m.hy_pct_rank != null) subhead += `, the ${ordinal(m.hy_pct_rank)} percentile since 1996`;
    if (m.ig_oas != null) subhead += `, with investment grade at ${n(m.ig_oas)} bps`;
    subhead += ".";
  }

  // Rules 3, 4 and 6.
  const parts = [whySentence(m.hy_pct_rank), ladderSentence(m)].filter((s): s is string => s != null);
  const tight = label === "Tight";
  const ledeText = tight ? [...parts, `${TIGHT_LEAD}${TIGHT_TERM}${TIGHT_TAIL}`].join(" ") : parts.join(" ");
  let lede: ReactNode = null;
  if (tight) {
    lede = createElement(
      Fragment,
      null,
      parts.length ? `${parts.join(" ")} ` : "",
      TIGHT_LEAD,
      createElement(Jargon, { term: "Tight" }, TIGHT_TERM),
      TIGHT_TAIL,
    );
  } else if (ledeText) {
    lede = ledeText;
  }

  // Rule 5.
  const footnote: string[] = [];
  if (m.data_as_of) footnote.push(`Monthly spreads through ${m.data_as_of}`);
  footnote.push(asOfIso ? `Classification ${label} for ${fmtMonYr(asOfIso)}` : `Classification ${label}`);

  // Rule 7.
  const pillTone: TabHeroPillTone = label === "Normal" ? "mint" : "amber";
  const glow = label === "Crisis" ? CREDIT_GLOW.crisis : CREDIT_GLOW.amber;

  return { headline: label, pill, pillTone, glow, subhead, lede, ledeText, footnote };
}

export interface LadderStripWords {
  tone: StatusTone;
  title: string;
  /** Always a string; "" when every clause is null (the screen omits it). */
  detail: string;
}

/** The summary card's strip: the quality-ladder read from served fields only
 * (B.2 table; rule 8). `diverges` outranks `tension`, which outranks `past`;
 * loading and error come from the query status, never from the payload. */
export function ladderStrip(m: CreditMetrics | null, status: CreditStatus = "ready"): LadderStripWords {
  if (!m || status !== "ready") {
    return status === "error"
      ? { tone: "gray", title: "Ladder unavailable", detail: "The data service did not answer" }
      : { tone: "gray", title: "Reading the ladder…", detail: "Opens the quality ladder" };
  }
  const label = m.credit_label;
  const { diverges, tension, past } = ladderFlags(m);
  const ccc = m.ccc_1w_change;
  const bb = m.bb_1w_change;
  const b = m.b_1w_change;
  const distress = m.ccc_pct_of_distress_line != null ? m.ccc_pct_of_distress_line.toFixed(0) : null;
  const clauses = (xs: (string | null)[]): string => xs.filter((x): x is string => x != null).join(" · ");

  if (diverges) {
    return {
      tone: "amber",
      title: "Watch · CCC widening",
      detail: clauses([ccc != null ? `${fmtBps(ccc)} in a month` : null, bb != null ? `BB ${fmtBps(bb)}` : null, b != null ? `B ${fmtBps(b)}` : null]),
    };
  }
  if (tension) {
    return {
      tone: "amber",
      title: `Watch · CCC at ${distress ?? "—"}% of the distress line`,
      detail: `The weakest rung prices stress while the index reads ${label}`,
    };
  }
  if (past) {
    return {
      tone: "amber",
      title: m.hy_oas != null ? `${label} · HY ${n(m.hy_oas)} bps` : label,
      detail: `The index is past the ${label === "Crisis" ? 700 : 400} bps rule; the ladder tiles show the rungs`,
    };
  }
  const detail = clauses([ccc != null ? `CCC ${fmtBps(ccc)} in a month` : null, distress != null ? `distress ${distress}% of the 1,000 bps line` : null]);
  return { tone: "mint", title: "Clear · ladder in step", detail };
}
