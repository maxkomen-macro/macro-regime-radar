/**
 * P1c (Desk upgrade, BATCH2 row 3): automatic room for any stored instrument
 * or tenor, from routes already served. A stored ETF (a `kind: "etf"` row of
 * `/instruments`) is monitored against its own 50-day from
 * `/technicals?symbol=`, accepted only as its stored closes; each Treasury
 * tenor's yield and every spread between two tenors against a bp move from
 * entry, from `/macro`'s curve, never two dates mixed. The method spec is
 * desk-upgrade/p1c-position-room/METHOD.md (project files) and the PR body.
 */
import { describe, expect, it } from "vitest";
import sample from "../../../fixtures/desk/positions.json";
import macro from "../../../fixtures/desk/macro.json";
import gld from "../../../fixtures/desk/technicals-GLD.json";
import nvda from "../../../fixtures/desk/technicals-NVDA.json";
import type { MacroResponse, TechnicalsResponse } from "../data/types";
import { completeTechnicals } from "../../../test/desk-variants";
import { isCurve, isYield, planFor, planRefusal, storedEtf, suggestions, underlyingName } from "./levels";
import { etfLevelFrom, falsifiesLine, levelsFrom, servedFor, tenorsFrom, viewOf, type Levels } from "./monitor";
import { SPREADS, monitoredSeriesOf, namedSeriesOf, parseSeries, whyUnreadable, type PositionRecord } from "./store";

const T = completeTechnicals() as unknown as TechnicalsResponse;
const M = macro as unknown as MacroResponse;
const G = gld as unknown as TechnicalsResponse;
const GLD = etfLevelFrom("GLD", G)!;
const BASE = levelsFrom(T, M);
/** The served fixtures: the S&P, the curve (2y and 10y on Sep 22), GLD stored and read. */
const LEVELS: Levels = { ...BASE, tenors: tenorsFrom(M), etfs: { GLD }, stored: ["SPY", "GLD", "TLT"] };
/** A curve with all five tenors on one date, for the spreads the fixture store does not hold. */
const FULL: Levels = { ...LEVELS, tenors: { "3m": { value: 4.02, date: "2026-09-22" }, "2y": { value: 4.71, date: "2026-09-22" }, "5y": { value: 4.8, date: "2026-09-22" }, "10y": { value: 4.96, date: "2026-09-22" }, "30y": { value: 5.13, date: "2026-09-22" } } };
const RECORDS = (sample as { positions: PositionRecord[] }).positions;
const NOW = new Date("2026-09-25T21:00:00Z");

/** A record as Save would write it for a plan (the sample's manual record supplies the gate text). */
function saved(instrument: string, direction: "long" | "short", levelId: string, levels: Levels): PositionRecord {
  const plan = planFor(levelId, instrument, levels);
  if (plan.kind !== "automatic") throw new Error(`not automatic: ${JSON.stringify(plan)}`);
  const m = RECORDS.find((p) => p.id === "ndx-vs-spx")!;
  return {
    ...m,
    id: `p-${instrument}`,
    instrument,
    direction,
    wrong_if: { id: levelId, label: levelId },
    subject: { kind: "instrument", id: namedSeriesOf(instrument) ?? instrument },
    monitoring: "automatic",
    entry_value: plan.entry_value,
    trigger: { series: plan.series, operator: plan.operator, threshold: plan.threshold, policy: "frozen", observed_on: plan.observed_on },
    original_room: plan.original_room,
  };
}

describe("P1c: the names a series is known by (exact only, Codex R-08)", () => {
  it("reads a ticker as its own ETF series, never the index, and nothing that only contains one", () => {
    expect(["QQQ", " qqq ", "XLRE", "BRK.B"].map(monitoredSeriesOf)).toEqual(["etf:QQQ", "etf:QQQ", "etf:XLRE", "etf:BRK.B"]);
    expect(["QQQ/SPY", "QQQ calls", "NDX vs SPX", "", "2s10s steepener"].map(monitoredSeriesOf)).toEqual([null, null, null, null, null]);
    expect(["SPX", "^GSPC", "S&P 500"].map(monitoredSeriesOf)).toEqual(["spx", "spx", "spx"]);
    // A named series is never a ticker's: the subject id stays the ticker as typed for an ETF.
    expect([namedSeriesOf("QQQ"), namedSeriesOf("spx")]).toEqual([null, "spx"]);
  });
  it("names each tenor's yield and each spread, and not a bare tenor (it names the bond as often as the yield)", () => {
    expect(["10y yield", "UST 10y yield", "yield_10y", "DGS10", "3m yield", "dgs3mo"].map(monitoredSeriesOf)).toEqual(["yield_10y", "yield_10y", "yield_10y", "yield_10y", "yield_3m", "yield_3m"]);
    expect(["10y", "10s", "10Y", "7y yield"].map(monitoredSeriesOf)).toEqual([null, null, null, null]);
    expect(SPREADS.map((s) => s.name)).toEqual(["3m2y", "3m5y", "3m10y", "3m30y", "2s5s", "2s10s", "2s30s", "5s10s", "5s30s", "10s30s"]);
    expect(["2s10s", "5s30s", "curve_5s30s", "3m10y", "10s30s"].map(monitoredSeriesOf)).toEqual(["curve_2s10s", "curve_5s30s", "curve_5s30s", "curve_3m10y", "curve_10s30s"]);
    expect(["10y yield", "5s30s", "2s10s", "QQQ"].map(isCurve)).toEqual([true, true, true, false]);
    expect(["10y yield", "5s30s"].map(isYield)).toEqual([true, false]);
    expect(["10y yield", "3m10y", "qqq"].map(underlyingName)).toEqual(["10y yield", "3m10y", "qqq"]);
    expect([parseSeries("yield_7y"), parseSeries("curve_10s2s"), parseSeries("etf:"), parseSeries(7)]).toEqual([null, null, null, null]);
  });
});

describe("P1c: the levels a stored ETF and the curve serve", () => {
  it("takes an ETF only from its stored closes: its own symbol, source asset_prices <SYM>", () => {
    expect(GLD).toMatchObject({ value: 392.8800048828125, date: "2026-09-23", ma50: 394.4752001953125, ma200: 416.37105026245115 });
    expect(GLD.closes["2026-09-23"]).toBe(392.8800048828125);
    expect(Object.keys(GLD.closes)).toHaveLength(752);
    // The S&P's answer is not GLD's; a provider's candles (any source but the stored closes) are not a stored ETF.
    expect(etfLevelFrom("GLD", T)).toBeNull();
    expect(etfLevelFrom("NVDA", nvda as unknown as TechnicalsResponse)).toBeNull();
    expect(etfLevelFrom("GLD", { ...G, source: "eodhd candles" })).toBeNull();
    expect(etfLevelFrom("GLD", { ...G, price: null })).toBeNull();
  });
  it("dates each tenor by the snapshot, or by its own date without one; a spread needs both legs on one date", () => {
    expect(tenorsFrom(M)).toEqual({ "2y": { value: 4.71, date: "2026-09-22" }, "10y": { value: 4.96, date: "2026-09-22" } });
    expect(servedFor(LEVELS, "yield_10y")).toEqual({ value: 4.96, date: "2026-09-22" });
    // 2s10s stays the served field; the same subtraction from the tenors gives the same 25 bp.
    expect(servedFor(LEVELS, "curve_2s10s")).toEqual({ value: 25, date: "2026-09-22" });
    expect(servedFor({ ...LEVELS, curve: null }, "curve_2s10s")).toBeNull();
    // The fixture store holds no 5y or 30y: not served, never guessed.
    expect(servedFor(LEVELS, "curve_5s30s")).toBeNull();
    expect(servedFor(FULL, "curve_5s30s")).toEqual({ value: 33, date: "2026-09-22" });
    expect(servedFor(FULL, "curve_3m10y")).toEqual({ value: 94, date: "2026-09-22" });
    const split = tenorsFrom({ ...M, curve: { ...M.curve!, today: { ...M.curve!.today, "30y": 5.1, date: null, dates: { "2y": "2026-09-22", "10y": "2026-09-22", "30y": "2026-09-21" } } } });
    expect(split["30y"]).toEqual({ value: 5.1, date: "2026-09-21" });
    expect(servedFor({ ...LEVELS, tenors: split }, "curve_10s30s")).toBeNull();
    expect(servedFor({ ...LEVELS, tenors: split }, "curve_2s10s")).toEqual({ value: 25, date: "2026-09-22" });
  });
});

describe("P1c: what Save decides for a stored ETF", () => {
  it("monitors a stored ETF's 50-day from its own close, refusing a level already crossed (B-10)", () => {
    // GLD closed 392.88 on Sep 23, under its 50-day of 394.48: a long's level is already through; a short's is not.
    const long = planFor("below_50d", "GLD", LEVELS);
    expect(long).toMatchObject({ kind: "through", series: "etf:GLD" });
    expect(planRefusal(long)).toBe("The GLD is at 392.88, already below 394.48, so there is no room to monitor. Pick another level; nothing was saved.");
    const short = planFor("above_50d", "gld", LEVELS);
    expect(short).toMatchObject({ kind: "automatic", series: "etf:GLD", operator: "above", threshold: 394.4752001953125, entry_value: 392.8800048828125, observed_on: "2026-09-23" });
    expect(short.kind === "automatic" && short.original_room).toBeCloseTo(394.4752001953125 - 392.8800048828125, 9);
  });
  it("keeps a ticker the store does not hold manual, and refuses when the stored list or the level is not served", () => {
    expect(planFor("above_50d", "NVDA", LEVELS)).toEqual({ kind: "manual" });
    const unchecked = planFor("above_50d", "GLD", { ...LEVELS, stored: null });
    expect(unchecked).toEqual({ kind: "unchecked", series: "etf:GLD" });
    expect(planRefusal(unchecked)).toBe("The list of stored instruments is not served right now, so whether GLD's 50-day can be monitored cannot be checked. Try again, or pick another level; nothing was saved.");
    const unserved = planFor("above_50d", "TLT", LEVELS);
    expect(unserved).toEqual({ kind: "not_served", series: "etf:TLT" });
    expect(planRefusal(unserved)).toBe("The TLT level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(planFor("above_50d", "GLD", { ...LEVELS, etfs: { GLD: { ...GLD, ma50: null } } })).toEqual({ kind: "not_served", series: "etf:GLD" });
    // The rules that were manual stay manual for an ETF: the 200-day, a bp move; a basket or an option never is automatic.
    expect(planFor("above_200d", "GLD", LEVELS)).toEqual({ kind: "manual" });
    expect(planFor("curve_up_10", "GLD", LEVELS)).toEqual({ kind: "manual" });
    expect(planFor("above_50d", "GLD", LEVELS, "basket")).toEqual({ kind: "manual" });
    expect(planFor("above_50d", "GLD", LEVELS, "option")).toEqual({ kind: "manual" });
  });
  it("numbers a stored ETF's chips with its own averages, never the index's, and an unstored one's with none", () => {
    const short = suggestions("GLD", T, null, "short", LEVELS);
    expect(short.top[0].label).toBe("closes above its 50-day (394.48)");
    expect(short.more[0].label).toBe("closes above its 200-day (416.37)");
    expect(suggestions("GLD", T, null, "long", { ...LEVELS, stored: null }).top[0].label).toBe("closes below its 50-day");
    expect(suggestions("NVDA", T, null, "long", LEVELS).top[0].label).toBe("closes below its 50-day");
    expect(storedEtf("gld", LEVELS)).toBe("GLD");
    expect(storedEtf("NVDA", LEVELS)).toBeNull();
  });
});

describe("P1c: what Save decides for a yield or a spread", () => {
  it("monitors a tenor's yield against a bp move, in its own unit (percent)", () => {
    const p = planFor("curve_down_10", "10y yield", LEVELS);
    expect(p).toMatchObject({ kind: "automatic", series: "yield_10y", operator: "below", entry_value: 4.96, observed_on: "2026-09-22" });
    expect(p.kind === "automatic" && p.threshold).toBeCloseTo(4.86, 12);
    expect(p.kind === "automatic" && p.original_room).toBeCloseTo(0.1, 12);
    expect(suggestions("10y yield", T, null, "long", LEVELS).top.map((c) => c.label)).toEqual(["falls 10 bp from entry (below 4.86%)", "falls 25 bp from entry (below 4.71%)"]);
    expect(suggestions("10y yield", T, null, "short", LEVELS).top.map((c) => c.label)).toEqual(["rises 10 bp from entry (above 5.06%)", "rises 25 bp from entry (above 5.21%)"]);
  });
  it("monitors any spread whose two tenors are served on one date, and refuses one that is not served", () => {
    expect(planFor("curve_up_25", "5s30s", FULL)).toEqual({ kind: "automatic", series: "curve_5s30s", operator: "above", threshold: 58, entry_value: 33, observed_on: "2026-09-22", original_room: 25 });
    const unserved = planFor("curve_up_25", "5s30s", LEVELS);
    expect(planRefusal(unserved)).toBe("The 5s30s level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(planFor("curve_down_10", "5y yield", LEVELS)).toEqual({ kind: "not_served", series: "yield_5y" });
    // A 50-day is not a rate's level.
    expect(planFor("below_50d", "10y yield", FULL)).toEqual({ kind: "manual" });
  });
});

describe("P1c: the monitor's view of the new series", () => {
  it("reads a yield's room and distance in bp, and its level in percent", () => {
    const r = saved("10y yield", "long", "curve_down_25", LEVELS);
    expect(whyUnreadable(r)).toBeNull();
    const v = viewOf(r, { ...LEVELS, tenors: { ...LEVELS.tenors, "10y": { value: 4.81, date: "2026-09-24" } } }, NOW);
    expect(v.room_pct).toBeCloseTo(0.4, 9);
    expect(v.to_level).toEqual({ value: 10, unit: "bp" });
    expect(falsifiesLine(v)).toBe("10y yield below 4.71% · now 4.81%");
    expect(viewOf(r, { ...LEVELS, tenors: {} }, NOW)).toMatchObject({ room_pct: null, to_level: null, now: null });
  });
  it("reads a spread computed from two tenors in bp", () => {
    const r = saved("5s30s", "short", "curve_up_10", FULL);
    expect(whyUnreadable(r)).toBeNull();
    const v = viewOf(r, FULL, NOW);
    expect([v.room_pct, v.to_level, falsifiesLine(v)]).toEqual([1, { value: 10, unit: "bp" }, "5s30s above +43 bp · now +33 bp"]);
  });
  it("reads a stored ETF's room from its newest stored close against the frozen 50-day", () => {
    const r = saved("GLD", "short", "above_50d", LEVELS);
    expect(whyUnreadable(r)).toBeNull();
    const now = { ...GLD, value: 393.6, date: "2026-09-24", closes: { ...GLD.closes, "2026-09-24": 393.6 } };
    const v = viewOf(r, { ...LEVELS, etfs: { GLD: now } }, NOW);
    expect(v.room_pct).toBeCloseTo((394.4752001953125 - 393.6) / (394.4752001953125 - 392.8800048828125), 9);
    expect(v.to_level?.unit).toBe("%");
    expect(v.to_level?.value).toBeCloseTo(((394.4752001953125 - 393.6) / 393.6) * 100, 9);
    expect(falsifiesLine(v)).toBe("GLD above 394.48 · now 393.60");
    expect(v.note).toBeNull();
  });
  it("restates the frozen level with the stored closes, so a split is never read as a breach", () => {
    const r = saved("GLD", "short", "above_50d", LEVELS);
    const before = viewOf(r, LEVELS, NOW);
    // A 2-for-1 split: every stored close halves, the entry day's included; the room is what it was.
    const half = Object.fromEntries(Object.entries(GLD.closes).map(([d, c]) => [d, c / 2]));
    const after = viewOf(r, { ...LEVELS, etfs: { GLD: { ...GLD, value: GLD.value / 2, closes: half } } }, NOW);
    expect(after.room_pct).toBeCloseTo(before.room_pct!, 12);
    expect(after.level_now).toBeCloseTo(394.4752001953125 / 2, 9);
    expect(falsifiesLine(after)).toBe("GLD above 197.24 · now 196.44");
    expect(after.note).toBe("The level was 394.48 at entry; the stored closes have been restated ×0.5000 since (a distribution or a split), and the level with them.");
    // A distribution restates the past closes a little: the level moves with them, so the payout is not room lost.
    const paid = { ...GLD.closes, "2026-09-23": GLD.closes["2026-09-23"] * 0.997 };
    const dist = viewOf(r, { ...LEVELS, etfs: { GLD: { ...GLD, closes: paid } } }, NOW);
    expect(dist.level_now).toBeCloseTo(394.4752001953125 * 0.997, 9);
    expect(dist.note).toMatch(/×0\.9970/);
  });
  it("computes no room it cannot check: the entry day's close missing from the served closes", () => {
    const r = saved("GLD", "short", "above_50d", LEVELS);
    const { "2026-09-23": _gone, ...rest } = GLD.closes;
    const v = viewOf(r, { ...LEVELS, etfs: { GLD: { ...GLD, closes: rest } } }, NOW);
    expect([v.room_pct, v.to_level, v.level_now]).toEqual([null, null, null]);
    expect(v.now).toMatchObject({ value: 392.8800048828125 });
    expect(v.note).toBe("Room not computed: the stored close of 2026-09-23 is not served, so the level cannot be checked against today's closes.");
    expect(viewOf(r, { ...LEVELS, etfs: {} }, NOW)).toMatchObject({ room_pct: null, now: null, note: null });
  });
});

describe("P1c: §9's rule on the new records (validation on Save, Import and load)", () => {
  it("passes an automatic ETF, yield and spread record, and refuses one whose level or instrument does not fit", () => {
    const etf = saved("GLD", "short", "above_50d", LEVELS);
    const yld = saved("10y yield", "long", "curve_down_10", LEVELS);
    const spr = saved("5s30s", "short", "curve_up_10", FULL);
    for (const r of [etf, yld, spr]) expect(whyUnreadable(r), r.instrument).toBeNull();
    expect(whyUnreadable({ ...etf, instrument: "SLV" })).toMatch(/not its series/);
    expect(whyUnreadable({ ...etf, instrument: "QQQ/SPY" })).toMatch(/not its series/);
    expect(whyUnreadable({ ...etf, wrong_if: { id: "curve_up_10", label: "x" } })).toMatch(/does not monitor/);
    expect(whyUnreadable({ ...yld, wrong_if: { id: "below_50d", label: "x" } })).toMatch(/does not monitor/);
    expect(whyUnreadable({ ...yld, trigger: { ...yld.trigger!, series: "yield_7y" as never } })).toMatch(/does not monitor/);
    expect(whyUnreadable({ ...yld, instrument: "10y" })).toMatch(/not its series/);
    expect(whyUnreadable({ ...spr, direction: "long" })).toMatch(/wrong side/);
    expect(whyUnreadable({ ...etf, original_room: 5 })).toMatch(/does not match/);
  });
});
