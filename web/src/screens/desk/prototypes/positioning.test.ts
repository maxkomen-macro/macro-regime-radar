/**
 * "Positioning" (PROTOTYPE, DESK_FRAME3_SPEC §10, §1.0.3): the crowding flag
 * follows its stated rule, and the basket's figures weight each name.
 */
import { describe, expect, it } from "vitest";
import p from "../../../fixtures/desk/proto-positioning.json";
import { sampleBasket } from "./basket-inputs";
import { crowding, positioning, RULES } from "./positioning";

const legs = sampleBasket().legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) }));

describe("positioning", () => {
  it("the flag: crowded short at 10% of float or more, else crowded long at a 25% 13F top-ten share", () => {
    expect(RULES).toEqual({ shortSi: 10, longTop10: 25 });
    expect(crowding({ si_pct_float: 10, top10_13f_pct: 0 })).toBe("short");
    expect(crowding({ si_pct_float: 9.9, top10_13f_pct: 25 })).toBe("long");
    expect(crowding({ si_pct_float: 12, top10_13f_pct: 40 })).toBe("short");
    expect(crowding({ si_pct_float: 9.9, top10_13f_pct: 24 })).toBeNull();
  });

  it("the sample basket: every name has a row; two crowded short, two crowded long", () => {
    const x = positioning(legs);
    expect(x.missing).toEqual([]);
    expect(x.rows.map((r) => [r.symbol, r.flag])).toEqual([
      ["NVDA", "long"],
      ["AVGO", "long"],
      ["VRT", null],
      ["CRWV", "short"],
      ["ANET", null],
      ["CEG", null],
      ["SMCI", "short"],
    ]);
    expect(x.flagged).toBe(4);
  });

  it("the basket's figures weight each name by its share", () => {
    const x = positioning(legs);
    const names = p.names as Record<string, { si_pct_float: number; days_to_cover: number }>;
    const si = legs.reduce((a, l) => a + (l.weight / 100) * names[l.symbol].si_pct_float, 0);
    expect(x.weightedSi).toBeCloseTo(si, 12);
    expect(x.weightedSi.toFixed(1)).toBe("5.3");
    expect(x.weightedDtc.toFixed(1)).toBe("1.8");
  });

  it("a name with no illustrative row is listed apart, and the weights are the named ones'", () => {
    const x = positioning([{ symbol: "ZZZZ", name: null, weight: 50 }, { symbol: "CRWV", name: "CoreWeave", weight: 50 }]);
    expect(x.missing.map((l) => l.symbol)).toEqual(["ZZZZ"]);
    expect(x.weightedSi).toBeCloseTo(17.8, 12);
  });
});
