/**
 * What Save decides and what the monitor shows (§9, v3 §16, v4 B-10):
 * automatic room only for the S&P against its 50-day and 2s10s against a bp
 * level, refused when already through the level or when the series is not
 * served; manual for everything else; room, distance and day from today's
 * served levels.
 */
import { describe, expect, it } from "vitest";
import sample from "../../../fixtures/desk/positions.json";
import macro from "../../../fixtures/desk/macro.json";
import type { MacroResponse, TechnicalsResponse } from "../data/types";
import { planFor, planRefusal, seriesOf, suggestions } from "./levels";
import { falsifiesLine, levelsFrom, sizeLine, viewOf } from "./monitor";
import type { PositionRecord } from "./store";
import { completeTechnicals } from "../../../test/desk-variants";

// A session whose 50 and 200 closes are all stored (the fixture's Sep 23 reads both averages null, Codex R-24).
const T = completeTechnicals() as unknown as TechnicalsResponse;
const M = macro as unknown as MacroResponse;
const LEVELS = levelsFrom(T, M);
const RECORDS = (sample as { positions: PositionRecord[] }).positions;
const NOW = new Date("2026-09-22T21:00:00Z");

describe("the levels a position reads", () => {
  it("takes the S&P from /technicals with its date and 2s10s from /macro's curve", () => {
    // The regenerated fixtures (item 12): the audit's Q1/Q2 S&P levels, and 2s10s from DGS10 − DGS2 on 2026-09-22.
    expect(LEVELS).toEqual({ spx: { value: 7706.02978515625, date: "2026-09-23", ma50: 7624.837392578125, ma200: 7192.012006835937 }, curve: { value: 25, date: "2026-09-22" } });
    expect(levelsFrom({ ...T, date: undefined }, undefined)).toEqual({ spx: null, curve: null });
    // §12.8: tenors on different dates serve no shared date; 2s10s is dated when its two tenors agree.
    const split = (dates: Record<string, string>) => levelsFrom(undefined, { ...M, curve: { ...M.curve!, today: { ...M.curve!.today, date: null, dates } } }).curve;
    expect(split({ "2y": "2026-09-22", "10y": "2026-09-22", "30y": "2026-09-21" })).toEqual({ value: 25, date: "2026-09-22" });
    expect(split({ "2y": "2026-09-21", "10y": "2026-09-22" })).toBeNull();
  });
  it("names the monitored series by their own names only, never one that resembles them (§12.7, Codex R-08)", () => {
    expect(seriesOf("S&P 500")).toBe("spx");
    expect(seriesOf(" s&p  500 ")).toBe("spx");
    expect(seriesOf("spx")).toBe("spx");
    expect(seriesOf("^GSPC")).toBe("spx");
    expect(seriesOf("SPY")).toBeNull();
    expect(seriesOf("SPX Dec 26 call spread")).toBeNull();
    expect(seriesOf("2s10s")).toBe("curve_2s10s");
    expect(seriesOf("2s10s steepener")).toBeNull();
  });
  it("offers 2s10s its bp levels from entry, with the level they reach today", () => {
    const long = suggestions("2s10s", T, null, "long", LEVELS);
    expect(long.top.map((c) => c.label)).toEqual(["falls 10 bp from entry (below +15 bp)", "falls 25 bp from entry (below 0 bp)"]);
    const short = suggestions("2s10s", T, "gold gives back its move", "short", LEVELS);
    expect(short.top.map((c) => c.label)).toEqual(["rises 10 bp from entry (above +35 bp)", "rises 25 bp from entry (above +50 bp)", "the signal reverses (gold gives back its move)"]);
  });
});

describe("the plan Save follows (B-10)", () => {
  it("monitors the S&P's 50-day automatically, its room the signed distance at entry", () => {
    const spx = planFor("below_50d", "S&P 500", LEVELS);
    expect(spx).toMatchObject({ kind: "automatic", series: "spx", operator: "below", threshold: 7624.837392578125, entry_value: 7706.02978515625, observed_on: "2026-09-23" });
    expect(spx.kind === "automatic" && spx.original_room).toBeCloseTo(7706.02978515625 - 7624.837392578125, 9);
    expect(planFor("curve_down_10", "2s10s", LEVELS)).toEqual({ kind: "automatic", series: "curve_2s10s", operator: "below", threshold: 15, entry_value: 25, observed_on: "2026-09-22", original_room: 10 });
    expect(planFor("curve_up_25", "2s10s", LEVELS)).toMatchObject({ kind: "automatic", operator: "above", threshold: 50, original_room: 25 });
  });
  it("never monitors a basket automatically, whatever its instrument reads (§9: a basket is an unserved subject)", () => {
    expect(planFor("curve_down_10", "2s10s", LEVELS, "basket")).toEqual({ kind: "manual" });
    expect(planFor("below_50d", "S&P 500", LEVELS, "basket")).toEqual({ kind: "manual" });
    expect(planFor("below_50d", "S&P 500", LEVELS, "study")).toMatchObject({ kind: "automatic" });
  });
  it("saves every other subject and rule as manual: the 200-day, a custom level, SPY, NDX vs SPX", () => {
    for (const [id, inst] of [["below_200d", "S&P 500"], [null, "S&P 500"], ["regime_changes", "S&P 500"], ["below_50d", "SPY"], ["below_50d", "NDX vs SPX"]] as const) expect(planFor(id, inst, LEVELS), `${id} ${inst}`).toEqual({ kind: "manual" });
  });
  it("refuses a level already crossed at entry, and one whose series is not served, with a sentence", () => {
    const through = planFor("above_50d", "S&P 500", LEVELS);
    expect(through).toMatchObject({ kind: "through" });
    expect(planRefusal(through)).toBe("The S&P 500 is at 7,706, already above 7,625, so there is no room to monitor. Pick another level; nothing was saved.");
    const unserved = planFor("below_50d", "S&P 500", { spx: null, curve: LEVELS.curve });
    expect(planRefusal(unserved)).toBe("The S&P 500 level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(planRefusal({ kind: "manual" })).toBeNull();
  });
});

describe("the monitor's view of a stored position (§2, §9)", () => {
  it("reads automatic room from today's level against the frozen threshold, in the series' unit", () => {
    const v = viewOf(RECORDS.find((p) => p.id === "2s10s-steepener")!, LEVELS, NOW);
    // The sample's 2s10s entry is the audit's Q11 (+40 bp on 2026-09-02); falls 25 bp → +15; now +25: 10 of 25 bp left.
    expect([v.name, v.room_pct, v.to_level, v.day]).toEqual(["Long 2s10s", 0.4, { value: 10, unit: "bp" }, 14]);
    expect(falsifiesLine(v)).toBe("2s10s below +15 bp · now +25 bp");
    expect(sizeLine(v)).toBe("2% NAV · DV01 — · 14 of 20 trading days · opened Sep 2");
    const s = viewOf({ ...RECORDS[1], instrument: "S&P 500", wrong_if: { id: "below_50d", label: "closes below its 50-day (7,625)" }, entry_value: 7811.3, original_room: 186.46, trigger: { series: "spx", operator: "below", threshold: 7624.84, policy: "frozen", observed_on: "2026-09-02" } }, LEVELS, NOW);
    expect(s.room_pct).toBeCloseTo((7706.02978515625 - 7624.84) / 186.46, 9);
    expect(s.to_level?.unit).toBe("%");
    expect(s.to_level?.value).toBeCloseTo(((7706.02978515625 - 7624.84) / 7706.02978515625) * 100, 9);
    expect(falsifiesLine(s)).toBe("S&P 500 below 7,625 · now 7,706");
  });
  it("goes to zero or below once through the level, and to null when the series is not served now", () => {
    const p = RECORDS.find((x) => x.id === "2s10s-steepener")!;
    const through = viewOf(p, { ...LEVELS, curve: { value: 10, date: "2026-09-22" } }, NOW);
    expect([through.room_pct, through.to_level]).toEqual([-0.2, null]);
    const unserved = viewOf(p, { ...LEVELS, curve: null }, NOW);
    expect([unserved.room_pct, unserved.to_level, falsifiesLine(unserved)]).toEqual([null, null, "2s10s below +15 bp · now not served"]);
  });
  it("gives a manual position no room and its typed rule", () => {
    const v = viewOf(RECORDS.find((p) => p.id === "ndx-vs-spx")!, LEVELS, NOW);
    expect([v.monitoring, v.room_pct, v.to_level]).toEqual(["manual", null, null]);
    expect(falsifiesLine(v)).toBe("NDX gives back 3.4% against SPX from entry");
    expect(sizeLine({ ...v, size_nav: null, day: null })).toBe("no size · DV01 — · — of 60 trading days · opened Aug 24");
  });
});
