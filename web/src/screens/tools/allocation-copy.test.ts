/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 7,
 * `tools/allocation-copy.test.ts`: the pure Allocation copy
 * (`allocationSummary`, `allocationHero`, `optimizerStatus`, `allocationStrip`;
 * B.9 and C.1) on the full fixture (./__fixtures__/allocation.ts) and its
 * variants. No React, no clock: nothing here reads Date. Figures are the
 * fixture's, never the baseline's.
 */
import { describe, expect, it } from "vitest";
import type { AllocationData } from "../../api/types";
import { allocationHero, allocationStrip, allocationSummary, optimizerRow, optimizerStatus, universeOf } from "./allocation-copy";
import { ALL_CONVERGED, FULL, FULL_UNIVERSE, NAMES, NO_RANKED, NULL_OPT, REDUCED_UNIVERSE, SAMPLE, withMethod, withUniverse } from "./__fixtures__/allocation";

const LEDE =
  "Read the Goldilocks column first: it is the weather the classifier calls today at 64% odds. A positive return with a negative Sharpe means the asset did not cover cash plus its risk; 28 months is a thin sample, so treat the column as evidence, not law.";

/** Every Goldilocks mean negative: the leading asset still loses money. */
const ALL_NEGATIVE: AllocationData = {
  ...FULL,
  regime_stats: {
    ...FULL.regime_stats,
    Goldilocks: { n_months: 40, mean: { SPY: -0.005, TLT: -0.031, GLD: -0.012 }, std: { SPY: 0.1, TLT: 0.1, GLD: 0.1 }, sharpe: { SPY: -0.4, TLT: -0.9, GLD: -0.6 } },
  },
};

describe("allocationSummary (the ranked current column)", () => {
  it("names the assets in served order, ranks the current column by mean and picks the best and worst", () => {
    const s = allocationSummary(FULL);
    expect(s.names).toEqual(NAMES);
    expect(s.curRegime).toBe("Goldilocks");
    expect(s.ranked.map((r) => r.n)).toEqual(["SPY", "GLD", "TLT"]);
    expect(s.ranked.map((r) => r.m)).toEqual([0.142, 0.061, -0.012]);
    expect(s.ranked.map((r) => r.sr)).toEqual([0.91, 0.18, -0.52]);
    expect(s.best).toEqual({ n: "SPY", m: 0.142, sr: 0.91 });
    expect(s.worst).toEqual({ n: "TLT", m: -0.012, sr: -0.52 });
  });

  it("with no ranked asset the best and worst are null and the names still come from the served list", () => {
    const s = allocationSummary(NO_RANKED);
    expect(s.names).toEqual(NAMES);
    expect(s.ranked).toEqual([]);
    expect(s.best).toBeNull();
    expect(s.worst).toBeNull();
  });
});

describe("allocationHero (checklist 09 B.9 and C.1)", () => {
  it("h1 = the leading asset, the signed pill in mint, the subhead's led / lagged words, the lede and the eyebrow", () => {
    const h = allocationHero(FULL);
    expect(h.eyebrow).toBe("Asset allocation");
    expect(h.headline).toBe("SPY");
    expect(h.pill).toBe("+14.2% a year");
    expect(h.pill).toMatch(/^[+-]\d+\.\d% a year$/);
    expect(h.pillTone).toBe("mint");
    expect(h.subhead).toBe("Led Goldilocks months since Aug 2002 at Sharpe 0.91; TLT lagged at -1.2%.");
    expect(h.subhead).toContain("lagged at");
    expect(h.lede).toBe(LEDE);
    expect(h.glow.length).toBeGreaterThan(0);
    for (const v of [h.headline, h.pill, h.subhead, h.lede]) expect(v).not.toContain("—");
  });

  it("a negative leading return reads amber and keeps the minus sign in the pill", () => {
    const h = allocationHero(ALL_NEGATIVE);
    expect(h.headline).toBe("SPY");
    expect(h.pill).toBe("-0.5% a year");
    expect(h.pillTone).toBe("amber");
  });

  it("the subhead drops the Sharpe clause when the leader has none", () => {
    const noSharpe: AllocationData = { ...FULL, regime_stats: { ...FULL.regime_stats, Goldilocks: { ...FULL.regime_stats.Goldilocks, sharpe: { SPY: null, TLT: -0.52, GLD: 0.18 } } } };
    expect(allocationHero(noSharpe).subhead).toBe("Led Goldilocks months since Aug 2002; TLT lagged at -1.2%.");
  });

  it("with empty stats the generic T21 sentence becomes the subhead, the h1 reads Regime-conditional returns and there is no pill", () => {
    const h = allocationHero(NO_RANKED);
    expect(h.headline).toBe("Regime-conditional returns");
    expect(h.pill ?? null).toBeNull();
    expect(h.subhead).toBe("Regime-conditional returns for 3 asset classes since Aug 2002.");
  });

  it("a workable sample (36 months or more) changes the lede's closing clause", () => {
    const big: AllocationData = { ...FULL, regime_stats: { ...FULL.regime_stats, Goldilocks: { ...FULL.regime_stats.Goldilocks, n_months: 48 } } };
    expect(allocationHero(big).lede).toBe(
      "Read the Goldilocks column first: it is the weather the classifier calls today at 64% odds. A positive return with a negative Sharpe means the asset did not cover cash plus its risk; 48 months is a workable sample.",
    );
  });
});

describe("optimizerStatus (discrepancy 28: converged flags, never hard-coded names)", () => {
  it("counts the converged methods and lists the fallbacks by label: Min CVaR only on the fixture", () => {
    expect(optimizerStatus(FULL)).toEqual({ solved: 6, fallbacks: ["Min CVaR"], total: 7 });
  });

  it("a method whose name carries (fallback) counts as a fallback too", () => {
    expect(optimizerStatus(withMethod("hrp", { method: "hrp (fallback)" }))).toEqual({ solved: 5, fallbacks: ["HRP", "Min CVaR"], total: 7 });
  });

  it("every method converged: seven solved, no fallbacks", () => {
    expect(optimizerStatus(ALL_CONVERGED)).toEqual({ solved: 7, fallbacks: [], total: 7 });
  });

  it("a missing converged flag is a success path, not a fallback", () => {
    const noFlag = withMethod("herc", { converged: undefined as unknown as boolean });
    expect(optimizerStatus(noFlag).fallbacks).toEqual(["Min CVaR"]);
    expect(optimizerStatus(noFlag).solved).toBe(6);
  });

  it("no optimizer output: nothing solved, nothing listed, the total still seven", () => {
    expect(optimizerStatus(NULL_OPT)).toMatchObject({ solved: 0, fallbacks: [], total: 7 });
  });
});

describe("allocationStrip (the four B.9 states)", () => {
  it("loading: gray, Reading the optimizer state…", () => {
    expect(allocationStrip(undefined, true)).toMatchObject({ tone: "gray", title: "Reading the optimizer state…" });
  });

  it("solved with a fallback: amber, the count and the names at equal weight", () => {
    // Iteration 1 step 5 (G4): title and detail one line each.
    expect(allocationStrip(FULL, false)).toMatchObject({ tone: "amber", title: "Optimizer solved · 1 fallback", detail: "Min CVaR at equal weight" });
    expect(allocationStrip(withMethod("hrp", { converged: false }), false)).toMatchObject({
      tone: "amber",
      title: "Optimizer solved · 2 fallbacks",
      detail: "HRP and Min CVaR at equal weight",
    });
  });

  it("every method solved: mint, Optimizer solved · 7 methods, the cap detail", () => {
    expect(allocationStrip(ALL_CONVERGED, false)).toMatchObject({ tone: "mint", title: "Optimizer solved · 7 methods", detail: "max 40% per asset · long-only" });
  });

  it("no optimizer output: amber, Optimizer skipped this session, the T27 sample detail or the 24-months fallback", () => {
    expect(allocationStrip(NULL_OPT, false)).toMatchObject({
      tone: "amber",
      title: "Optimizer skipped this session",
      detail: `${SAMPLE.complete_months} complete months · ${SAMPLE.required_cov_months} required`,
    });
    expect(allocationStrip(NULL_OPT, false).detail).toBe("21 complete months · 24 required");
    const noSample: AllocationData = { ...NULL_OPT, optimizations_skipped: null, optimization_sample: null };
    expect(allocationStrip(noSample, false)).toMatchObject({ tone: "amber", title: "Optimizer skipped this session", detail: "needs 24 complete months" });
  });

  it("no rendered strip string carries an em-dash", () => {
    for (const s of [allocationStrip(undefined, true), allocationStrip(FULL, false), allocationStrip(ALL_CONVERGED, false), allocationStrip(NULL_OPT, false)]) {
      expect(`${s.title} ${s.detail}`).not.toContain("—");
    }
  });
});

// ── N-B2: the reduced universe reaches the summary row and the strip ────────
describe("adaptive universe (N-B2)", () => {
  it("the Optimizer row and the mint strip name the reduced universe", () => {
    const a = withUniverse(REDUCED_UNIVERSE);
    expect(universeOf(a)).not.toBeNull();
    expect(optimizerRow(a).value).toContain("8 of 10 asset classes");
    // the mint strip is the every-method-converged one; FULL carries a fallback
    const strip = allocationStrip(withUniverse(REDUCED_UNIVERSE, ALL_CONVERGED), false);
    expect(strip.tone).toBe("mint");
    expect(strip.detail).toBe("8 of 10 asset classes · 27 months");
    expect(strip.detail.length).toBeLessThanOrEqual(36);
  });

  it("a full universe reads null and the old strings stand", () => {
    const a = withUniverse(FULL_UNIVERSE);
    expect(universeOf(a)).toBeNull();
    expect(optimizerRow(a).value).toContain("long-only · 40% cap");
    expect(allocationStrip(withUniverse(FULL_UNIVERSE, ALL_CONVERGED), false).detail).toBe("max 40% per asset · long-only");
  });
});
