/**
 * fix/site-audit D2: the Dashboard's "Next 3 months" row read "highest-risk
 * path → Stagflation 20%" from the served `highest_risk_prob`, and the Regime
 * Lab sidebar's "Next 6 months" row read "→ Stagflation 25%" from a second
 * derivation in the browser (`transitions_6m[0]`, stay = 100 minus its exits).
 * Each horizon now has one computation, on the server
 * (`get_transition_narrative`), and one formatter here that both screens use.
 */
import { describe, expect, it } from "vitest";
import type { RegimeLabel, TransitionOutlook } from "../../api/types";
import { outlookLine } from "./transition-outlook";

const tr = (to: RegimeLabel, probability: number) => ({ to, probability, color: "#95a5a6" });

/** /api/regime/transitions on 2026-10-07 (the hand-set Overheating rows). */
const LIVE: TransitionOutlook = {
  current_regime: "Overheating",
  stay_probability_3m: 55,
  transitions_3m: [tr("Stagflation", 20), tr("Goldilocks", 15), tr("Recession Risk", 10)],
  transitions_6m: [tr("Stagflation", 25), tr("Goldilocks", 20), tr("Recession Risk", 15)],
  narrative_3m: "",
  narrative_6m: "",
  highest_risk_transition: "Stagflation",
  highest_risk_prob: 20,
  highest_risk_color: "#e74c3c",
  stay_probability_6m: 40,
  highest_risk_6m_transition: "Stagflation",
  highest_risk_6m_prob: 25,
  highest_risk_6m_color: "#e74c3c",
};

describe("outlookLine (D2: one computation per horizon)", () => {
  it("prints the 3-month row the Dashboard and the Regime Lab share", () => {
    expect(outlookLine(LIVE, "3m")).toBe("Stays Overheating 55% · highest-risk path → Stagflation 20% (hand-set priors)");
  });

  it("prints the 6-month row from the served 6-month fields", () => {
    expect(outlookLine(LIVE, "6m")).toBe("Stays Overheating 40% · highest-risk path → Stagflation 25% (hand-set priors)");
  });

  it("never re-derives a horizon in the browser: the served path and stay win over the list's order and sum", () => {
    const listOutOfStep = { ...LIVE, transitions_6m: [tr("Goldilocks", 20), tr("Stagflation", 25)] };
    expect(outlookLine(listOutOfStep, "6m")).toBe("Stays Overheating 40% · highest-risk path → Stagflation 25% (hand-set priors)");
  });

  it("an older API without the 6-month fields prints no 6-month row rather than computing one", () => {
    const { stay_probability_6m: _s, highest_risk_6m_transition: _t, highest_risk_6m_prob: _p, highest_risk_6m_color: _c, ...older } = LIVE;
    expect(outlookLine(older as TransitionOutlook, "6m")).toBeNull();
    expect(outlookLine(older as TransitionOutlook, "3m")).toBe("Stays Overheating 55% · highest-risk path → Stagflation 20% (hand-set priors)");
  });
});
