/**
 * Credit ladder flags (redesign Phase 6, checklist 06 B.2 / C.1 rule 8): pure
 * reads of served fields, shared by the hero strip and the quality-ladder
 * callout so one rule lives in one place. Never a magnitude threshold: the
 * only served thresholds are the classification rules and the 1,000 bps
 * distress line.
 */
import type { CreditMetrics } from "../../api/types";

export interface LadderFlags {
  /** CCC widened month over month. */
  cccUp: boolean;
  /** CCC widened more than both BB and B (sign and ordering only). */
  diverges: boolean;
  /** Today's tension rule (CreditScreen.tsx:267 before Phase 6): distress at 80% or more while the index reads Normal or Tight. */
  tension: boolean;
  /** The index is past the 400 bps rule (Stressed or Crisis). */
  past: boolean;
}

export function ladderFlags(m: CreditMetrics): LadderFlags {
  const label = m.credit_label;
  const ccc = m.ccc_1w_change;
  const cccUp = ccc != null && ccc > 0;
  const diverges = cccUp && (m.bb_1w_change ?? 0) < (ccc as number) && (m.b_1w_change ?? 0) < (ccc as number);
  const tension = m.distress_ratio != null && m.distress_ratio >= 80 && (label === "Normal" || label === "Tight");
  const past = label === "Stressed" || label === "Crisis";
  return { cccUp, diverges, tension, past };
}
