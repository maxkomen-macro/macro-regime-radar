/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) C.1 and
 * E.1, `screens/dashboard/hero-copy.test.ts`: decision 4, the hero copy that
 * never presents the classifier's four-way odds and the NBER recession model
 * as one distribution. `heroCopy(regime)` is pure (no React, no hooks) and
 * returns `{ headline, pill, pillTone, glow, subhead, lede, ledeClause,
 * footnote }`.
 *
 * Fixture odds are invented for the cases (never the mockup's 64 / 35); the
 * lead-word thresholds are the ones DashboardScreen.tsx:236-240 already used
 * (under 10 pp a coin flip, under 25 pp contested, else clear).
 */
import { describe, expect, it } from "vitest";
import { heroCopy } from "./hero-copy";
import type { Regime, RegimeLabel } from "../../api/types";
import { assessFreshness } from "../shared/freshness";

const MONTH = "2026-09-01";
const DASH = "\u2014";

function regime(over: Partial<Regime> = {}): Regime {
  return {
    date: MONTH,
    label: "Goldilocks",
    confidence: 0.47,
    growth_trend: 0.31,
    inflation_trend: -0.42,
    prob_goldilocks: 0.58,
    prob_overheating: 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
    ...over,
  };
}

/** Odds in classifier order: goldilocks, overheating, stagflation, recession. */
const odds = (g: number, o: number, s: number, r: number): Partial<Regime> => ({
  prob_goldilocks: g,
  prob_overheating: o,
  prob_stagflation: s,
  prob_recession: r,
});

const CLAUSE = "Recession Risk here is the classifier's fourth quadrant; the NBER recession model is a separate reading, shown in the summary.";
const SUBHEAD_SHAPE = /^A (?:coin flip with|contested lead over|clear lead over) (?:Goldilocks|Overheating|Stagflation|Recession Risk) at \d+% of the same four-way odds\.$/;

/** Every hero string except the disambiguation clause (rule 4 names the model, without a number). */
function heroStrings(copy: ReturnType<typeof heroCopy>): string[] {
  return [copy.headline, copy.pill, copy.subhead, copy.lede, ...copy.footnote];
}

describe("heroCopy (checklist 03 C.1, decision 4)", () => {
  it("headline is the regime label and the pill is the dominant whole percent; nothing else prints it", () => {
    const copy = heroCopy(regime());
    expect(copy.headline).toBe("Goldilocks");
    expect(copy.pill).toBe("58% probability");
    // Rule 1: the dominant figure appears in the pill only.
    for (const s of [copy.subhead, copy.lede, copy.ledeClause ?? "", ...copy.footnote]) expect(s).not.toContain("58%");
    // Whole percents: 0.577 rounds to 58, as fmtWholePct does.
    expect(heroCopy(regime({ prob_goldilocks: 0.577 })).pill).toBe("58% probability");
    // The label is spelled out as served, never abbreviated.
    const rr = heroCopy(regime({ label: "Recession Risk", ...odds(0.3, 0.12, 0.09, 0.49) }));
    expect(rr.headline).toBe("Recession Risk");
    expect(rr.pill).toBe("49% probability");
  });

  it("lead word: coin flip under 10 pp, contested under 25 pp, clear otherwise (boundaries 9 / 10 / 24 / 25)", () => {
    expect(heroCopy(regime(odds(0.52, 0.03, 0.02, 0.43))).subhead).toBe("A coin flip with Recession Risk at 43% of the same four-way odds.");
    expect(heroCopy(regime(odds(0.53, 0.02, 0.02, 0.43))).subhead).toBe("A contested lead over Recession Risk at 43% of the same four-way odds.");
    expect(heroCopy(regime(odds(0.6, 0.02, 0.02, 0.36))).subhead).toBe("A contested lead over Recession Risk at 36% of the same four-way odds.");
    expect(heroCopy(regime(odds(0.61, 0.02, 0.01, 0.36))).subhead).toBe("A clear lead over Recession Risk at 36% of the same four-way odds.");
  });

  it("subhead names the runner-up by its regime label and ends with the four-way tag", () => {
    const cases: [Partial<Regime>, string][] = [
      [odds(0.6, 0.29, 0.06, 0.05), "A clear lead over Overheating at 29% of the same four-way odds."],
      [odds(0.55, 0.05, 0.33, 0.07), "A contested lead over Stagflation at 33% of the same four-way odds."],
      [{ label: "Recession Risk", ...odds(0.3, 0.12, 0.09, 0.49) }, "A contested lead over Goldilocks at 30% of the same four-way odds."],
      [{ label: "Stagflation", ...odds(0.04, 0.4, 0.46, 0.1) }, "A coin flip with Overheating at 40% of the same four-way odds."],
    ];
    for (const [over, expected] of cases) {
      const copy = heroCopy(regime(over));
      expect(copy.subhead).toBe(expected);
      expect(copy.subhead).toMatch(SUBHEAD_SHAPE);
      expect(copy.subhead.endsWith("of the same four-way odds.")).toBe(true);
    }
    // Rule 2: never the lowercase key, never a bare number.
    const copy = heroCopy(regime());
    expect(copy.subhead).not.toMatch(/\brecession at\b/);
    expect(copy.subhead).not.toMatch(/\bgoldilocks\b/);
    expect(copy.subhead).toMatch(/ at \d+% of the same four-way odds\.$/);
  });

  it("runner-up Recession Risk appends the disambiguation clause; another runner does not", () => {
    const withRecession = heroCopy(regime());
    expect(withRecession.ledeClause).toBe(CLAUSE);
    expect(withRecession.ledeClause).not.toMatch(/\d/); // no number, so the two can never be read as one split
    expect(withRecession.ledeClause).not.toMatch(/%/);
    const withOverheating = heroCopy(regime(odds(0.6, 0.29, 0.06, 0.05)));
    expect(withOverheating.ledeClause).toBeFalsy();
    expect(withOverheating.lede).not.toContain("fourth quadrant");
    // A Recession Risk lead has another regime as its runner: no clause either.
    const rrLead = heroCopy(regime({ label: "Recession Risk", ...odds(0.3, 0.12, 0.09, 0.49) }));
    expect(rrLead.ledeClause).toBeFalsy();
  });

  it("no hero string carries the NBER model, its probability or the words recession model (rule 3)", () => {
    for (const r of [regime(), regime(odds(0.6, 0.29, 0.06, 0.05)), regime({ label: "Recession Risk", ...odds(0.3, 0.12, 0.09, 0.49) })]) {
      const copy = heroCopy(r);
      for (const s of heroStrings(copy)) {
        expect(s).not.toMatch(/NBER/);
        expect(s).not.toMatch(/recession model/i);
        expect(s).not.toMatch(/over 12m/);
      }
    }
    // Without a Recession Risk runner the clause is absent, so the whole hero is NBER-free.
    const plain = heroCopy(regime(odds(0.6, 0.29, 0.06, 0.05)));
    expect(`${plain.ledeClause ?? ""}`).not.toMatch(/NBER/);
  });

  it("lede is the D5 paragraph verbatim, with the dash placeholder when a trend is null", () => {
    expect(heroCopy(regime()).lede).toBe(
      "Goldilocks means growth trending up while inflation stays calm: the equity-friendly quadrant. The call rests on a growth trend of +0.31 and an inflation trend of -0.42; model confidence of 47% is a separate reading of how firmly the classifier holds the call.",
    );
    expect(heroCopy(regime({ label: "Overheating", ...odds(0.2, 0.55, 0.15, 0.1) })).lede).toMatch(
      /^Overheating means growth and inflation both running hot: real assets lead, duration suffers\. The call rests on/,
    );
    const noGrowth = heroCopy(regime({ growth_trend: null }));
    expect(noGrowth.lede).toContain(`a growth trend of ${DASH} and an inflation trend of -0.42;`);
    const noTrends = heroCopy(regime({ growth_trend: null, inflation_trend: null }));
    expect(noTrends.lede).toContain(`a growth trend of ${DASH} and an inflation trend of ${DASH};`);
    expect(noTrends.lede).not.toMatch(/null|undefined|NaN/);
  });

  it("footnote carries the regime month with the monthly age words and the model-confidence word", () => {
    const copy = heroCopy(regime());
    const age = assessFreshness(MONTH, "monthly").age;
    expect(age).toMatch(/^(?:\d+ days?|\d+ weeks|\d+ months|\d+ hours|under 1 hour)$/);
    expect(copy.footnote).toEqual([`Macro regime for Sep 2026 (${age} old)`, "Model confidence: Medium (47%)"]);
    expect(heroCopy(regime({ date: "2026-07-01" })).footnote[0]).toBe(`Macro regime for Jul 2026 (${assessFreshness("2026-07-01", "monthly").age} old)`);
    // convictionWord thresholds: High at 0.6, Medium at 0.4, Low below.
    expect(heroCopy(regime({ confidence: 0.61 })).footnote[1]).toBe("Model confidence: High (61%)");
    expect(heroCopy(regime({ confidence: 0.4 })).footnote[1]).toBe("Model confidence: Medium (40%)");
    expect(heroCopy(regime({ confidence: 0.39 })).footnote[1]).toBe("Model confidence: Low (39%)");
  });

  it("pill tone and glow follow the regime: mint, amber, amber, gray", () => {
    const cases: [RegimeLabel, Partial<Regime>, "mint" | "amber" | "gray", RegExp][] = [
      ["Goldilocks", odds(0.58, 0.07, 0.04, 0.31), "mint", /^rgba\(38, ?220, ?160, ?0?\.07\)$/],
      ["Overheating", odds(0.2, 0.55, 0.15, 0.1), "amber", /^rgba\(245, ?181, ?46, ?0?\.06\)$/],
      ["Stagflation", odds(0.04, 0.4, 0.46, 0.1), "amber", /^rgba\(245, ?181, ?46, ?0?\.06\)$/],
      ["Recession Risk", odds(0.3, 0.12, 0.09, 0.49), "gray", /^rgba\(200, ?210, ?220, ?0?\.05\)$/],
    ];
    for (const [label, o, tone, glow] of cases) {
      const copy = heroCopy(regime({ label, ...o }));
      expect(copy.pillTone, label).toBe(tone);
      expect(copy.glow, label).toMatch(glow);
      expect(copy.headline).toBe(label);
    }
  });
});
