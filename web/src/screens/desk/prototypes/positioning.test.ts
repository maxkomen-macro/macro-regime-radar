/**
 * "Positioning" (PROTOTYPE, DESK_FRAME3_SPEC §10, §1.0.3): the crowding flag
 * follows its stated rule, and the basket's figures weight each name.
 */
import { describe, expect, it } from "vitest";
import p from "../../../fixtures/desk/proto-positioning.json";
import { PRESET } from "../basket/weights";
import { crowding, positioning, RULES } from "./positioning";
import { coverageWords } from "./PositioningCard";

const legs = PRESET.legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) }));

describe("positioning", () => {
  it("the flag: crowded short at 10% of float or more, else crowded long at a 25% 13F top-ten share", () => {
    expect(RULES).toEqual({ shortSi: 10, longTop10: 25 });
    expect(crowding({ si_pct_float: 10, top10_13f_pct: 0 })).toBe("short");
    expect(crowding({ si_pct_float: 9.9, top10_13f_pct: 25 })).toBe("long");
    expect(crowding({ si_pct_float: 12, top10_13f_pct: 40 })).toBe("short");
    expect(crowding({ si_pct_float: 9.9, top10_13f_pct: 24 })).toBeNull();
  });

  it("the AI Infrastructure 10 preset: every name has a row; two crowded short, two crowded long", () => {
    const x = positioning(legs);
    expect(x.missing).toEqual([]);
    expect(x.rows.map((r) => [r.symbol, r.flag])).toEqual([
      ["NVDA", "long"],
      ["AVGO", "long"],
      ["AMD", null],
      ["TSM", null],
      ["MU", null],
      ["ANET", null],
      ["VRT", null],
      ["CEG", null],
      ["CRWV", "short"],
      ["NBIS", "short"],
    ]);
    expect(x.flagged).toBe(4);
  });

  it("the basket's figures weight each name by its share", () => {
    const x = positioning(legs);
    const names = p.names as Record<string, { si_pct_float: number; days_to_cover: number }>;
    const si = legs.reduce((a, l) => a + (l.weight / 100) * names[l.symbol].si_pct_float, 0);
    expect(x.weightedSi).toBeCloseTo(si, 12);
    expect(x.weightedSi!.toFixed(1)).toBe("4.8");
    expect(x.weightedDtc!.toFixed(1)).toBe("1.7");
    expect(x.coveredWeight).toBe(100);
  });

  it("a name with no illustrative row is listed apart, and the weights are the named ones'", () => {
    const x = positioning([{ symbol: "ZZZZ", name: null, weight: 50 }, { symbol: "CRWV", name: "CoreWeave", weight: 50 }]);
    expect(x.missing.map((l) => l.symbol)).toEqual(["ZZZZ"]);
    expect(x.weightedSi).toBeCloseTo(18.3, 12);
  });
});

describe("Codex R-01: coverage is disclosed, a name without data is never counted as not crowded, no NaN", () => {
  const leg = (symbol: string, weight: number) => ({ symbol, name: null, weight });

  it("CRWV 50% / MSFT 50%: the figures cover 50% of the basket, 1 of 2 names; MSFT is not in the crowded count", () => {
    const x = positioning([leg("CRWV", 50), leg("MSFT", 50)]);
    expect(x.coveredWeight).toBe(50);
    expect(x.totalWeight).toBe(100);
    expect(x.rows.map((r) => r.symbol)).toEqual(["CRWV"]);
    expect(x.missing.map((l) => l.symbol)).toEqual(["MSFT"]);
    expect(x.weightedSi).toBeCloseTo(18.3, 12);
    expect(x.flagged).toBe(1);
  });

  it("MSFT 100%: no name has data, so there is no aggregate and nothing is counted", () => {
    const x = positioning([leg("MSFT", 100)]);
    expect(x.rows).toEqual([]);
    expect(x.coveredWeight).toBe(0);
    expect(x.weightedSi).toBeNull();
    expect(x.weightedDtc).toBeNull();
    expect(x.flagged).toBe(0);
  });

  it("CRWV 0% / MSFT 100%: the name with data carries no weight, so the weighted figures are withheld, not NaN", () => {
    const x = positioning([leg("CRWV", 0), leg("MSFT", 100)]);
    expect(x.coveredWeight).toBe(0);
    expect(x.weightedSi).toBeNull();
    expect(x.weightedDtc).toBeNull();
    // CRWV's own flag stands: crowding is per name, not weighted.
    expect(x.flagged).toBe(1);
  });
});

describe("Codex R-01: the coverage words the card prints under each weighted figure", () => {
  const leg = (symbol: string, weight: number) => ({ symbol, name: null, weight });
  it("all names, part of the basket, no name with data, no weight with data", () => {
    expect(coverageWords(positioning(legs))).toBe("weighted over all 10 names");
    expect(coverageWords(positioning([leg("CRWV", 50), leg("MSFT", 50)]))).toBe("weighted over 50% of the basket (1 of 2 names)");
    expect(coverageWords(positioning([leg("MSFT", 100)]))).toBe("no name with data");
    expect(coverageWords(positioning([leg("CRWV", 0), leg("MSFT", 100)]))).toBe("the names with data carry 0% of the basket");
  });
});
