/**
 * The transition outlook's summary line, one per horizon (fix/site-audit D2).
 *
 * The Dashboard's "Next 3 months" row and the Regime Lab's two rows used to
 * build their own lines: the 3-month row from the served `highest_risk_*`
 * fields, the 6-month row from a second derivation in the browser (the first
 * of `transitions_6m` and a stay of 100 minus its exits), so "highest-risk
 * path" read 20% on one row and 25% on the other with nothing but the row
 * label to say they are different horizons. The server now computes both
 * horizons with one rule (`get_transition_narrative`) and every row prints
 * through this function; nothing here computes a figure.
 */
import type { TransitionOutlook } from "../../api/types";
import { fmtProb } from "../../lib/format";

export type Horizon = "3m" | "6m";

/** "Stays Overheating 55% · highest-risk path → Stagflation 20% (hand-set
 * priors)" for the horizon, from its served fields; null when the API does
 * not serve that horizon's fields (an API older than the 6-month fields). */
export function outlookLine(t: TransitionOutlook, horizon: Horizon): string | null {
  const h =
    horizon === "3m"
      ? { stay: t.stay_probability_3m, to: t.highest_risk_transition, prob: t.highest_risk_prob }
      : { stay: t.stay_probability_6m, to: t.highest_risk_6m_transition, prob: t.highest_risk_6m_prob };
  if (h.stay == null || h.to == null || h.prob == null) return null;
  return `Stays ${t.current_regime} ${fmtProb(h.stay, "percent")} · highest-risk path → ${h.to} ${fmtProb(h.prob, "percent")} (hand-set priors)`;
}
