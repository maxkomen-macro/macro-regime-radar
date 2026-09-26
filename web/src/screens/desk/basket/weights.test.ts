/** Basket & Hedge's weights (DESK_FRAME3_SPEC §10): typed, tidied, keyed, kept in this browser. */
import { describe, expect, it } from "vitest";
import { apiLegs, equalWeight, exportSaved, importSaved, decimal, legsKey, newBasketId, normalize, parseTicker, parseWeight, readSaved, removeSaved, sumsToHundred, toWork, total, totalText, unreadableSaved, writeSaved, SAVED_BASKETS_KEY, type SavedBasket, type WorkLeg } from "./weights";

const legs = (ws: string[]): WorkLeg[] => ws.map((w, i) => ({ symbol: `T${i}`, name: null, weight: w }));

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as Storage;
}

describe("basket weights", () => {
  it("reads a weight as typed: 0 to 100, every decimal kept", () => {
    expect(["22", "12.5", "0", "100", " 7 ", "12.55", "22.11"].map(parseWeight)).toEqual([22, 12.5, 0, 100, 7, 12.55, 22.11]);
    expect(["", "-1", "101", "abc", "1e2", "12.", ".5"].map(parseWeight)).toEqual([null, null, null, null, null, null, null]);
  });
  it("22.11/77.89 and 22.14/77.86 are two baskets: identity and working weights keep every digit (Codex R-14)", () => {
    const a = legs(["22.11", "77.89"]);
    const b = legs(["22.14", "77.86"]);
    expect(legsKey(apiLegs(a))).toBe("T0:22.11,T1:77.89");
    expect(legsKey(apiLegs(b))).toBe("T0:22.14,T1:77.86");
    expect(apiLegs(b)).toEqual([
      { symbol: "T0", weight: 22.14 },
      { symbol: "T1", weight: 77.86 },
    ]);
    expect([total(a), total(b)]).toEqual([100, 100]);
    expect([sumsToHundred(a), sumsToHundred(b), sumsToHundred(legs(["22.11", "77.86"]))]).toEqual([true, true, false]);
    expect(totalText(legs(["22.11", "77.86"]))).toBe("99.97");
    // Already at 100%: normalize leaves the weights as typed; a served 22.11 is shown as 22.11.
    expect(normalize(a).map((l) => l.weight)).toEqual(["22.11", "77.89"]);
    // Otherwise it never writes coarser than typed: hundredths stay hundredths (G3-4).
    expect(normalize(legs(["22.11", "77.86"])).map((l) => l.weight)).toEqual(["22.12", "77.88"]);
    expect(toWork([{ symbol: "T0", name: null, weight: 22.11 }]).map((l) => l.weight)).toEqual(["22.11"]);
    expect(legsKey([{ symbol: "T0", weight: 22.14 }])).not.toBe(legsKey([{ symbol: "T0", weight: 22.11 }]));
  });
  it("100% means exactly 100: no tolerance, no float noise (G3-3, G3-6)", () => {
    expect(totalText(legs(["33.3333333333", "33.3333333333", "33.3333333333"]))).toBe("99.9999999999");
    expect(sumsToHundred(legs(["33.3333333333", "33.3333333333", "33.3333333333"]))).toBe(false);
    expect(sumsToHundred(legs(["50.0000000004", "49.9999999999"]))).toBe(false);
    expect(totalText(legs(["21.99999", "16", "14", "12", "12", "12", "12"]))).toBe("99.99999");
    expect(sumsToHundred(legs(["0.1", "0.2", "99.7"]))).toBe(true);
    expect(sumsToHundred(legs(["33.33", "33.33", "33.34"]))).toBe(true);
    expect(sumsToHundred([{ weight: 22.11 }, { weight: 77.89 }])).toBe(true);
    expect(totalText(legs(["0.05", "0.05"]))).toBe("0.1");
  });
  it("writes a weight's digits, never exponent notation (G3-5)", () => {
    expect([decimal(22.11), decimal(1e-7), decimal(100), decimal(0)]).toEqual(["22.11", "0.0000001", "100", "0"]);
    expect(toWork([{ symbol: "T0", name: null, weight: 1e-7 }])[0].weight).toBe("0.0000001");
    expect(legsKey([{ symbol: "T0", weight: 1e-7 }])).toBe("T0:0.0000001");
    expect(parseWeight(decimal(1e-7))).toBe(1e-7);
  });
  it("totals exactly, or null when a weight is not a number", () => {
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
    // No basket is served (§10): a basket a server once kept comes in as this browser's own.
    const served: SavedBasket = { ...a, id: "ai-infra", name: "AI infrastructure" };
    expect(importSaved([], JSON.stringify([served])).list.map((x) => x.id)).toEqual(["local-1"]);
    expect(importSaved([], JSON.stringify([{ ...a, id: "my-basket" }])).list.map((x) => x.id)).toEqual(["local-1"]);
    expect(importSaved([a], JSON.stringify({ baskets: [b, { id: 3 }] }))).toMatchObject({ added: 1, rejected: 1 });
    expect(importSaved([a], "not json")).toEqual({ list: [a], added: 0, rejected: 1, renumbered: 0, skipped: 0 });
  });
  it("keeps what it cannot read through every write, and counts it (§1.8: never dropped)", () => {
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    const ok = { id: "local-1", name: "Grid", legs: [{ symbol: "CEG", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" };
    // A weight that is no number at all; an exact decimal string ("22") reads (Codex R-20).
    const bad = { id: "local-2", name: "Broken", legs: [{ symbol: "NVDA", weight: "twenty-two" }] };
    m.set(SAVED_BASKETS_KEY, JSON.stringify([ok, bad]));
    expect(readSaved(st).map((b) => b.id)).toEqual(["local-1"]);
    expect(unreadableSaved(st)).toEqual([bad]);
    expect(writeSaved({ ...ok, name: "Grid 2" }, st)).toBe("ok");
    expect(removeSaved("local-1", st)).toBe("ok");
    expect(JSON.parse(m.get(SAVED_BASKETS_KEY)!)).toEqual([bad]);
    // A store that is not a list is one unreadable entry, kept whole.
    m.set(SAVED_BASKETS_KEY, "{oops");
    expect(unreadableSaved(st)).toEqual(["{oops"]);
    writeSaved(ok, st);
    expect(JSON.parse(m.get(SAVED_BASKETS_KEY)!)).toEqual([ok, "{oops"]);
  });
});
