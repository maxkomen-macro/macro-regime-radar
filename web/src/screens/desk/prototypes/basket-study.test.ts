/**
 * "Event study on this basket" (PROTOTYPE, DESK_FRAME3_SPEC §10, §1.0.3):
 * illustrative, but its counts agree with each other and its verdict is §1.5's
 * rule v1 on its own numbers.
 */
import { describe, expect, it } from "vitest";
import s from "../../../fixtures/desk/proto-basket-study.json";
import baskets from "../../../fixtures/desk/baskets.json";
import { basketStudy, isSampleBasket, sampleBasket, verdictV1 } from "./basket-study";

const st = basketStudy();

describe("the basket's event study", () => {
  it("counts agree: each horizon's n within the events, fewer complete the longer the horizon, up = up_n / n", () => {
    let prev = Infinity;
    for (const h of st.horizons) {
      expect(h.n).toBeLessThanOrEqual(st.matchedN);
      expect(h.n).toBeLessThanOrEqual(prev);
      prev = h.n;
      expect(h.up_pct).toBeCloseTo(h.up_n / h.n, 12);
      expect(h.n_blocks).toBeLessThanOrEqual(h.n);
      // The interval bounds the excess (median − baseline), which it contains.
      expect(h.ci_lo!).toBeLessThanOrEqual(h.median! - h.baseline_median!);
      expect(h.ci_hi!).toBeGreaterThanOrEqual(h.median! - h.baseline_median!);
    }
    expect(st.horizons.map((h) => h.label)).toEqual(["1 week", "2 weeks", "1 month", "3 months"]);
    expect(st.month.h).toBe(20);
    expect(st.month.worst!.value!).toBeLessThan(0);
    expect(st.month.best!.value!).toBeGreaterThan(0);
    expect(st.lastEvent <= st.sampleEnd).toBe(true);
    expect(st.sampleStart > st.indexFrom).toBe(true);
  });

  it("the verdict is rule v1 at a month: ten or more, no exclusion (the interval spans zero), the excess leans up at 5, 10 and 20", () => {
    expect(st.verdict).toBe("suggestive");
    expect(st.month.ci_lo!).toBeLessThan(0);
    expect(st.month.ci_hi!).toBeGreaterThan(0);
  });

  it("rule v1 itself: too few, reliable, suggestive, no edge", () => {
    const row = (h: number, over: Partial<(typeof s.horizons)[number]> = {}) => ({ h, n: 30, median: 0.02, baseline_median: 0.01, ci_lo: -0.01, ci_hi: 0.02, blocks: 20, adverse_share: 0.2, ...over });
    const three = (over: Partial<(typeof s.horizons)[number]> = {}) => [row(5), row(10), row(20, over)];
    expect(verdictV1(three({ n: 9 }), 20)).toBe("insufficient");
    expect(verdictV1(three({ ci_lo: 0.001, adverse_share: 0.01 }), 20)).toBe("reliable");
    expect(verdictV1(three({ ci_lo: 0.001, adverse_share: 0.03 }), 20)).toBe("suggestive");
    expect(verdictV1(three({ ci_lo: 0.001, adverse_share: 0.01, blocks: 9 }), 20)).toBe("suggestive");
    expect(verdictV1([row(5), row(10, { median: 0.01 }), row(20)], 20)).toBe("no_edge");
    expect(verdictV1([row(5)], 20)).toBe("insufficient");
  });

  it("drawn for the sample basket alone: the one the fixture tests save (baskets.json's first)", () => {
    const saved = (baskets as { baskets: { id: string; name: string; legs: unknown[] }[] }).baskets[0];
    expect(sampleBasket()).toMatchObject({ id: saved.id, name: saved.name, legs: saved.legs });
    const legs = sampleBasket().legs.map((l) => ({ symbol: l.symbol, name: l.name ?? null, weight: Number(l.weight) }));
    expect(isSampleBasket(legs)).toBe(true);
    expect(isSampleBasket(legs.slice(1))).toBe(false);
    expect(isSampleBasket(legs.map((l, i) => (i === 0 ? { ...l, weight: 21 } : l)))).toBe(false);
  });
});
