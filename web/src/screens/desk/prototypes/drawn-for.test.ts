/**
 * "Positioning" and "Event study on this basket" are drawn for desk/books' first-visit preset, AI Infrastructure 10
 * (DESK_FRAME3_SPEC §10, §1.0.3): both fixtures carry exactly its names, and any other basket is told so in one line.
 */
import { describe, expect, it } from "vitest";
import p from "../../../fixtures/desk/proto-positioning.json";
import st from "../../../fixtures/desk/proto-basket-study.json";
import baskets from "../../../fixtures/desk/baskets.json";
import { PRESET, type SavedBasket } from "../basket/weights";
import { DRAWN_FOR, isDrawnFor, OTHER_BASKET_LINE } from "./drawn-for";

const symbols = PRESET.legs.map((l) => l.symbol);

describe("the basket the prototypes are drawn for", () => {
  it("is the preset: ten names at 10%, and both fixtures carry exactly its names", () => {
    expect(DRAWN_FOR).toBe(PRESET);
    expect(symbols).toEqual(["NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"]);
    expect(PRESET.legs.every((l) => Number(l.weight) === 10)).toBe(true);
    expect(Object.keys(p.names)).toEqual(symbols);
    expect(p.basket).toBe(PRESET.name);
    expect(st.basket).toEqual({ id: PRESET.id, name: PRESET.name, legs: PRESET.legs });
    expect(OTHER_BASKET_LINE).toBe("Illustrative values are shown for the AI Infrastructure 10 preset.");
  });

  it("the preset's names at its weights, in any order and however the weights are written; nothing else", () => {
    const legs = PRESET.legs.map((l) => ({ symbol: l.symbol, weight: l.weight }));
    expect(isDrawnFor(legs)).toBe(true);
    expect(isDrawnFor([...legs].reverse())).toBe(true);
    expect(isDrawnFor(legs.map((l) => ({ ...l, weight: 10 })))).toBe(true);
    expect(isDrawnFor(legs.slice(1))).toBe(false);
    expect(isDrawnFor([...legs, { symbol: "ORCL", weight: 0 }])).toBe(false);
    expect(isDrawnFor(legs.map((l, i) => (i === 0 ? { ...l, weight: 11 } : i === 1 ? { ...l, weight: 9 } : l)))).toBe(false);
    expect(isDrawnFor(legs.map((l, i) => (i === 9 ? { ...l, symbol: "SMCI" } : l)))).toBe(false);
    // The fixture tests' sample basket is another basket.
    expect(isDrawnFor((baskets as { baskets: SavedBasket[] }).baskets[0].legs)).toBe(false);
  });

  it("Codex R-04: ten legs at 10% are not enough; a symbol twice is another basket", () => {
    // Codex's repro: "NVDA only", ten NVDA legs at 10%.
    expect(isDrawnFor(Array.from({ length: 10 }, () => ({ symbol: "NVDA", weight: "10" })))).toBe(false);
    // Nine of the preset's names with one of them twice, and the tenth missing.
    const legs = PRESET.legs.map((l) => ({ symbol: l.symbol, weight: l.weight }));
    expect(isDrawnFor([...legs.slice(0, 9), { symbol: "NVDA", weight: "10" }])).toBe(false);
    // The preset plus a duplicate of one of its names.
    expect(isDrawnFor([...legs, { symbol: "AMD", weight: "10" }])).toBe(false);
    // A weight that is not a number never matches.
    expect(isDrawnFor(legs.map((l, i) => (i === 0 ? { ...l, weight: "ten" } : l)))).toBe(false);
  });
});
