/** Basket & Hedge's weights (DESK_FRAME3_SPEC §10): typed, tidied, keyed, kept in this browser. */
import { describe, expect, it } from "vitest";
import { apiLegs, equalWeight, exportSaved, importSaved, legsKey, newBasketId, normalize, parseTicker, parseWeight, readSaved, removeSaved, total, writeSaved, SAVED_BASKETS_KEY, type SavedBasket, type WorkLeg } from "./weights";

const legs = (ws: string[]): WorkLeg[] => ws.map((w, i) => ({ symbol: `T${i}`, name: null, weight: w }));

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("basket weights", () => {
  it("reads a weight as typed: 0 to 100, one decimal at most", () => {
    expect(["22", "12.5", "0", "100", " 7 "].map(parseWeight)).toEqual([22, 12.5, 0, 100, 7]);
    expect(["", "-1", "101", "12.55", "abc", "1e2"].map(parseWeight)).toEqual([null, null, null, null, null, null]);
  });
  it("totals to one decimal, or null when a weight is not a number", () => {
    expect(total(legs(["22", "16", "14", "12", "12", "12", "12"]))).toBe(100);
    expect(total(legs(["33.3", "33.3", "33.3"]))).toBe(99.9);
    expect(total(legs(["50", "x"]))).toBeNull();
    expect(total([])).toBe(0);
  });
  it("equal-weights and normalizes to exactly 100.0", () => {
    const eq = equalWeight(legs(["1", "1", "1", "1", "1", "1", "1"]));
    expect(eq.map((l) => l.weight)).toEqual(["14.3", "14.3", "14.3", "14.3", "14.3", "14.3", "14.2"]);
    expect(total(eq)).toBe(100);
    const n = normalize(legs(["22", "16", "14", "12", "12", "12", "8"]));
    expect(total(n)).toBe(100);
    expect(n.map((l) => l.weight)).toEqual(["22.9", "16.7", "14.6", "12.5", "12.5", "12.5", "8.3"]);
    expect(normalize(legs(["0", "x"])).map((l) => l.weight)).toEqual(["0", "0"]);
  });
  it("reads a ticker, and keys the legs the way the API reads them", () => {
    expect(["nvda", " BRK.B ", "a1", "", "1ABC", "TOO-LONG-TICKER"].map(parseTicker)).toEqual(["NVDA", "BRK.B", "A1", null, null, null]);
    const l = [
      { symbol: "NVDA", name: "Nvidia", weight: "22" },
      { symbol: "AVGO", name: "Broadcom", weight: "16.5" },
    ];
    expect(apiLegs(l)).toEqual([
      { symbol: "NVDA", weight: 22 },
      { symbol: "AVGO", weight: 16.5 },
    ]);
    expect(legsKey(apiLegs(l))).toBe("NVDA:22,AVGO:16.5");
  });
  it("keeps saved baskets in this browser, by id, and survives bad storage", () => {
    const s = memory();
    const b: SavedBasket = { id: "local-1", name: "New basket 1", legs: [{ symbol: "NVDA", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" };
    expect(writeSaved(b, s)).toBe("ok");
    expect(writeSaved({ ...b, name: "Renamed" }, s)).toBe("ok");
    expect(readSaved(s)).toEqual([{ ...b, name: "Renamed" }]);
    expect(newBasketId(readSaved(s))).toBe("local-2");
    expect(removeSaved("local-1", s)).toBe("ok");
    expect(readSaved(s)).toEqual([]);
    s.setItem(SAVED_BASKETS_KEY, "not json");
    expect(readSaved(s)).toEqual([]);
    s.setItem(SAVED_BASKETS_KEY, JSON.stringify([{ id: 1 }, b]));
    expect(readSaved(s)).toEqual([b]);
    expect(readSaved(null)).toEqual([]);
    expect(writeSaved(b, null)).toBe("off");
    const full = { getItem: () => "[]", setItem: () => { throw new Error("quota"); } };
    expect(writeSaved(b, full)).toBe("full");
  });
  it("exports and imports saved baskets as JSON, by id, counting what it cannot read", () => {
    const a: SavedBasket = { id: "local-1", name: "Grid", legs: [{ symbol: "CEG", name: "Constellation", weight: 100 }], saved_at: "2026-09-22T00:00:00Z" };
    const b: SavedBasket = { ...a, id: "local-2", name: "Chips" };
    const text = exportSaved([a, b]);
    expect(JSON.parse(text)).toMatchObject({ kind: "mrr.desk.baskets", version: 1 });
    // The same basket (by name and legs) is already here: skipped, never doubled.
    expect(importSaved([a], text)).toEqual({ list: [a, b], added: 1, rejected: 0, renumbered: 0, skipped: 1 });
    const mine: SavedBasket = { ...a, name: "Mine", legs: [{ symbol: "NVDA", name: null, weight: 100 }] };
    const r = importSaved([mine], text);
    expect(r.list.map((x) => [x.id, x.name])).toEqual([["local-1", "Mine"], ["local-2", "Grid"], ["local-3", "Chips"]]);
    expect(r.renumbered).toBe(2);
    // Importing the same file again adds nothing.
    expect(importSaved(r.list, text)).toMatchObject({ added: 0, skipped: 2 });
    // A served basket's id comes in as this browser's weights for it, unless this browser keeps other weights for it.
    const served: SavedBasket = { ...a, id: "ai-infra", name: "AI infrastructure" };
    expect(importSaved([], JSON.stringify([served])).list.map((x) => x.id)).toEqual(["ai-infra"]);
    const ours: SavedBasket = { ...served, legs: [{ symbol: "NVDA", name: null, weight: 100 }] };
    expect(importSaved([ours], JSON.stringify([served])).list.map((x) => x.id)).toEqual(["ai-infra", "local-1"]);
    expect(importSaved([], JSON.stringify([{ ...a, id: "my-basket" }])).list.map((x) => x.id)).toEqual(["local-1"]);
    expect(importSaved([a], JSON.stringify({ baskets: [b, { id: 3 }] }))).toMatchObject({ added: 1, rejected: 1 });
    expect(importSaved([a], "not json")).toEqual({ list: [a], added: 0, rejected: 1, renumbered: 0, skipped: 0 });
  });
});
