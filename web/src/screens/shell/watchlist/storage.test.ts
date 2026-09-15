/**
 * Phase 1 checklist F.1 / F.11 cases 1-12: the pure watchlist storage module
 * (web/src/screens/shell/watchlist/storage.ts). No React, no DOM beyond the
 * jsdom localStorage used by case 12. Written before the implementation; the
 * case names are the checklist's.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SYMBOLS,
  MAX_SYMBOLS,
  SYMBOL_RE,
  UNDO_MS,
  WATCHLIST_KEY,
  addSymbol,
  defaults,
  moveSymbol,
  normalizeSymbol,
  parse,
  readWatchlist,
  removeSymbol,
  sanitize,
  serialize,
  storageAvailable,
  writeWatchlist,
  type WatchlistEntry,
} from "./storage";

const NOW = "2026-09-15T12:00:00.000Z";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const entry = (symbol: string, addedAt = "2026-09-01T00:00:00.000Z"): WatchlistEntry => ({ symbol, addedAt });
const file = (symbols: unknown, version: unknown = 1) => JSON.stringify({ version, symbols });
const syms = (entries: WatchlistEntry[]) => entries.map((e) => e.symbol);

/** In-memory Storage double so the pure helpers never touch window. */
function fakeStorage(seed: Record<string, string> = {}, opts: { throwOnSet?: boolean } = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.throwOnSet) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    data,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("watchlist storage", () => {
  it("parses a valid v1 file and keeps order", () => {
    const raw = file([entry("QQQ", "2026-08-01T00:00:00.000Z"), entry("SPY", "2026-08-02T00:00:00.000Z"), entry("EEM", "2026-08-03T00:00:00.000Z")]);
    const out = parse(raw);
    expect(out.corrupt).toBe(false);
    expect(syms(out.entries)).toEqual(["QQQ", "SPY", "EEM"]);
    expect(out.entries[1]).toEqual({ symbol: "SPY", addedAt: "2026-08-02T00:00:00.000Z" });
  });

  it("uppercases symbols and drops entries failing the pattern", () => {
    expect(SYMBOL_RE.test("BRK.B")).toBe(true);
    expect(SYMBOL_RE.test("^VIX")).toBe(true);
    expect(SYMBOL_RE.test("BTC-USD")).toBe(true);
    expect(SYMBOL_RE.test("EURUSD=X")).toBe(true);
    expect(SYMBOL_RE.test("spy")).toBe(false); // the pattern is applied after uppercasing
    expect(SYMBOL_RE.test("")).toBe(false);
    expect(SYMBOL_RE.test("A".repeat(16))).toBe(false);
    expect(SYMBOL_RE.test("BAD SYMBOL")).toBe(false);
    expect(normalizeSymbol("  amd ")).toBe("AMD");

    const raw = file([
      { symbol: "spy", addedAt: "2026-08-01T00:00:00.000Z" },
      { symbol: "bad symbol!", addedAt: "2026-08-01T00:00:00.000Z" },
      { symbol: 42, addedAt: "2026-08-01T00:00:00.000Z" },
      { symbol: "brk.b" }, // missing addedAt is coerced, not a corruption
      { symbol: "TOOLONGSYMBOL12345", addedAt: "2026-08-01T00:00:00.000Z" },
      { addedAt: "2026-08-01T00:00:00.000Z" },
    ]);
    const out = parse(raw);
    expect(out.corrupt).toBe(false);
    expect(syms(out.entries)).toEqual(["SPY", "BRK.B"]);
    expect(out.entries[1].addedAt).toMatch(ISO);

    // sanitize is the same rule applied to an already-parsed list.
    const cleaned = sanitize([{ symbol: "qqq", addedAt: "2026-08-01T00:00:00.000Z" }, { symbol: "no!", addedAt: "2026-08-01T00:00:00.000Z" }]);
    expect(syms(cleaned)).toEqual(["QQQ"]);
  });

  it("dedupes repeated symbols keeping the first occurrence", () => {
    const out = parse(file([entry("SPY", "2026-01-01T00:00:00.000Z"), entry("qqq"), entry("spy", "2026-02-02T00:00:00.000Z"), entry("QQQ")]));
    expect(out.corrupt).toBe(false);
    expect(syms(out.entries)).toEqual(["SPY", "QQQ"]);
    expect(out.entries[0].addedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(syms(sanitize([entry("EEM"), entry("eem"), entry("IWM")]))).toEqual(["EEM", "IWM"]);
  });

  it("caps the list at 12", () => {
    expect(MAX_SYMBOLS).toBe(12);
    const fifteen = Array.from({ length: 15 }, (_, i) => entry(`S${i + 1}`));
    const out = parse(file(fifteen));
    expect(out.corrupt).toBe(false);
    expect(out.entries).toHaveLength(12);
    expect(syms(out.entries)).toEqual(fifteen.slice(0, 12).map((e) => e.symbol));
    expect(sanitize(fifteen)).toHaveLength(12);
  });

  it("treats null storage as the defaults without flagging corruption", () => {
    expect(DEFAULT_SYMBOLS).toEqual(["SPY", "QQQ", "IWM", "EEM"]);
    const out = parse(null);
    expect(out.corrupt).toBe(false);
    expect(syms(out.entries)).toEqual(DEFAULT_SYMBOLS);
    out.entries.forEach((e) => expect(e.addedAt).toMatch(ISO));
    // defaults(now) stamps every default entry with the supplied ISO time.
    const d = defaults(NOW);
    expect(syms(d)).toEqual(DEFAULT_SYMBOLS);
    d.forEach((e) => expect(e.addedAt).toBe(NOW));
  });

  it("falls back to the defaults on malformed JSON and flags corrupt", () => {
    const out = parse("{not json");
    expect(out.corrupt).toBe(true);
    expect(syms(out.entries)).toEqual(DEFAULT_SYMBOLS);
  });

  it("falls back to the defaults on an unknown version or a non-array symbols field and flags corrupt", () => {
    const v2 = parse(file([entry("SPY")], 2));
    expect(v2.corrupt).toBe(true);
    expect(syms(v2.entries)).toEqual(DEFAULT_SYMBOLS);

    const notArray = parse(file("SPY"));
    expect(notArray.corrupt).toBe(true);
    expect(syms(notArray.entries)).toEqual(DEFAULT_SYMBOLS);

    const notObject = parse("42");
    expect(notObject.corrupt).toBe(true);
    expect(syms(notObject.entries)).toEqual(DEFAULT_SYMBOLS);
  });

  it("keeps an empty valid list empty", () => {
    const out = parse(file([]));
    expect(out.corrupt).toBe(false);
    expect(out.entries).toEqual([]);
  });

  it("serialize then parse round-trips", () => {
    expect(WATCHLIST_KEY).toBe("mrr.watchlist.v1");
    expect(UNDO_MS).toBe(6000);
    const entries = [entry("SPY", "2026-08-01T00:00:00.000Z"), entry("BRK.B", "2026-08-02T00:00:00.000Z"), entry("^VIX", "2026-08-03T00:00:00.000Z")];
    const raw = serialize(entries);
    expect(JSON.parse(raw)).toEqual({ version: 1, symbols: entries });
    expect(parse(raw)).toEqual({ entries, corrupt: false });

    // readWatchlist / writeWatchlist go through the storage they are given.
    const storage = fakeStorage();
    expect(writeWatchlist(storage, entries)).toBe(true);
    expect(storage.getItem(WATCHLIST_KEY)).toBe(raw);
    expect(readWatchlist(storage)).toEqual({ entries, corrupt: false });
    const first = readWatchlist(fakeStorage()); // nothing stored yet: the defaults, not a corruption
    expect(first.corrupt).toBe(false);
    expect(syms(first.entries)).toEqual(DEFAULT_SYMBOLS);
  });

  it("addSymbol reports duplicate, full and invalid", () => {
    const base = defaults(NOW);

    const dup = addSymbol(base, "spy", NOW);
    expect(dup.status).toBe("duplicate");
    expect(syms(dup.entries)).toEqual(DEFAULT_SYMBOLS);

    const bad = addSymbol(base, "bad symbol", NOW);
    expect(bad.status).toBe("invalid");
    expect(syms(bad.entries)).toEqual(DEFAULT_SYMBOLS);
    expect(addSymbol(base, "", NOW).status).toBe("invalid");

    const full12 = Array.from({ length: 12 }, (_, i) => entry(`S${i + 1}`));
    const full = addSymbol(full12, "AMD", NOW);
    expect(full.status).toBe("full");
    expect(full.entries).toHaveLength(12);

    const added = addSymbol(base, " amd ", NOW);
    expect(added.status).toBe("added");
    expect(syms(added.entries)).toEqual([...DEFAULT_SYMBOLS, "AMD"]);
    expect(added.entries[4]).toEqual({ symbol: "AMD", addedAt: NOW });
    expect(syms(base)).toEqual(DEFAULT_SYMBOLS); // pure: the input is untouched

    // removeSymbol hands back the removed entry with its index so undo can re-insert it.
    const removed = removeSymbol(base, "IWM");
    expect(syms(removed.entries)).toEqual(["SPY", "QQQ", "EEM"]);
    expect(removed.removed).toEqual({ entry: { symbol: "IWM", addedAt: NOW }, index: 2 });
    const missing = removeSymbol(base, "ZZZ");
    expect(syms(missing.entries)).toEqual(DEFAULT_SYMBOLS);
    expect(missing.removed).toBeNull();
  });

  it("moveSymbol reorders and clamps at both edges", () => {
    const base = defaults(NOW);
    expect(syms(moveSymbol(base, 2, 0))).toEqual(["IWM", "SPY", "QQQ", "EEM"]);
    expect(syms(moveSymbol(base, 0, 3))).toEqual(["QQQ", "IWM", "EEM", "SPY"]);
    expect(syms(moveSymbol(base, 1, 2))).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
    // Past either edge the target is clamped: the first row cannot move up,
    // the last row cannot move down, and a far target lands on the edge.
    expect(syms(moveSymbol(base, 0, -1))).toEqual(DEFAULT_SYMBOLS);
    expect(syms(moveSymbol(base, 3, 4))).toEqual(DEFAULT_SYMBOLS);
    expect(syms(moveSymbol(base, 1, 99))).toEqual(["SPY", "IWM", "EEM", "QQQ"]);
    expect(syms(base)).toEqual(DEFAULT_SYMBOLS); // pure: the input is untouched
  });

  it("storageAvailable is false when setItem throws", () => {
    expect(storageAvailable(fakeStorage())).toBe(true);
    expect(storageAvailable(fakeStorage({}, { throwOnSet: true }))).toBe(false);

    // Without an argument the probe runs against window.localStorage.
    expect(storageAvailable()).toBe(true);
    expect(window.localStorage.getItem("mrr.watchlist.probe")).toBeNull(); // the probe cleans up after itself
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    expect(storageAvailable()).toBe(false);

    // writeWatchlist swallows the quota error and reports it.
    expect(writeWatchlist(fakeStorage({}, { throwOnSet: true }), defaults(NOW))).toBe(false);
  });
});
