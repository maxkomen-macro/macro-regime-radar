/**
 * What Save decides and what the monitor shows (§9, v3 §16, v4 B-10):
 * automatic room only for the S&P against its 50-day and 2s10s against a bp
 * level, refused when already through the level or when the series is not
 * served; manual for everything else; room, distance and day from today's
 * served levels.
 */
import { describe, expect, it } from "vitest";
import sample from "../../../fixtures/desk/positions.json";
import technicals from "../../../fixtures/desk/technicals.json";
import macro from "../../../fixtures/desk/macro.json";
import type { MacroResponse, TechnicalsResponse } from "../data/types";
import { planFor, planRefusal, seriesOf, suggestions } from "./levels";
import { falsifiesLine, levelsFrom, sizeLine, viewOf } from "./monitor";
import type { PositionRecord } from "./store";

const T = technicals as unknown as TechnicalsResponse;
const M = macro as unknown as MacroResponse;
const LEVELS = levelsFrom(T, M);
const RECORDS = (sample as { positions: PositionRecord[] }).positions;
const NOW = new Date("2026-09-22T21:00:00Z");

describe("the levels a position reads", () => {
  it("takes the S&P from /technicals with its date and 2s10s from /macro's curve", () => {
    expect(LEVELS).toEqual({ spx: { value: 6412, date: "2026-09-22", ma50: 6280, ma200: 5910 }, curve: { value: 41, date: "2026-09-22" } });
    expect(levelsFrom({ ...T, date: undefined }, undefined)).toEqual({ spx: null, curve: null });
    // §12.8: tenors on different dates serve no shared date; 2s10s is dated when its two tenors agree.
    const split = (dates: Record<string, string>) => levelsFrom(undefined, { ...M, curve: { ...M.curve!, today: { ...M.curve!.today, date: null, dates } } }).curve;
    expect(split({ "2y": "2026-09-22", "10y": "2026-09-22", "30y": "2026-09-21" })).toEqual({ value: 41, date: "2026-09-22" });
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
    expect(long.top.map((c) => c.label)).toEqual(["falls 10 bp from entry (below +31 bp)", "falls 25 bp from entry (below +16 bp)"]);
    const short = suggestions("2s10s", T, "gold gives back its move", "short", LEVELS);
    expect(short.top.map((c) => c.label)).toEqual(["rises 10 bp from entry (above +51 bp)", "rises 25 bp from entry (above +66 bp)", "the signal reverses (gold gives back its move)"]);
  });
});

describe("the plan Save follows (B-10)", () => {
  it("monitors the S&P's 50-day automatically, its room the signed distance at entry", () => {
    expect(planFor("below_50d", "S&P 500", LEVELS)).toEqual({ kind: "automatic", series: "spx", operator: "below", threshold: 6280, entry_value: 6412, observed_on: "2026-09-22", original_room: 132 });
    expect(planFor("curve_down_10", "2s10s", LEVELS)).toEqual({ kind: "automatic", series: "curve_2s10s", operator: "below", threshold: 31, entry_value: 41, observed_on: "2026-09-22", original_room: 10 });
    expect(planFor("curve_up_25", "2s10s", LEVELS)).toMatchObject({ kind: "automatic", operator: "above", threshold: 66, original_room: 25 });
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
    expect(planRefusal(through)).toBe("The S&P 500 is at 6,412, already above 6,280, so there is no room to monitor. Pick another level; nothing was saved.");
    const unserved = planFor("below_50d", "S&P 500", { spx: null, curve: LEVELS.curve });
    expect(planRefusal(unserved)).toBe("The S&P 500 level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(planRefusal({ kind: "manual" })).toBeNull();
  });
});

describe("the monitor's view of a stored position (§2, §9)", () => {
  it("reads automatic room from today's level against the frozen threshold, in the series' unit", () => {
    const v = viewOf(RECORDS.find((p) => p.id === "2s10s-steepener")!, LEVELS, NOW);
    expect([v.name, v.room_pct, v.to_level, v.day]).toEqual(["Long 2s10s", 0.3, { value: 3, unit: "bp" }, 14]);
    expect(falsifiesLine(v)).toBe("2s10s below +38 bp · now +41 bp");
    expect(sizeLine(v)).toBe("2% NAV · DV01 — · 14 of 20 trading days · opened Sep 2");
    const s = viewOf({ ...RECORDS[1], instrument: "S&P 500", wrong_if: { id: "below_50d", label: "closes below its 50-day (6,280)" }, entry_value: 6500, original_room: 220, trigger: { series: "spx", operator: "below", threshold: 6280, policy: "frozen", observed_on: "2026-09-02" } }, LEVELS, NOW);
    expect(s.room_pct).toBeCloseTo(0.6);
    expect(s.to_level?.unit).toBe("%");
    expect(s.to_level?.value).toBeCloseTo((132 / 6412) * 100);
    expect(falsifiesLine(s)).toBe("S&P 500 below 6,280 · now 6,412");
  });
  it("goes to zero or below once through the level, and to null when the series is not served now", () => {
    const p = RECORDS.find((x) => x.id === "2s10s-steepener")!;
    const through = viewOf(p, { ...LEVELS, curve: { value: 35, date: "2026-09-22" } }, NOW);
    expect([through.room_pct, through.to_level]).toEqual([-0.3, null]);
    const unserved = viewOf(p, { ...LEVELS, curve: null }, NOW);
    expect([unserved.room_pct, unserved.to_level, falsifiesLine(unserved)]).toEqual([null, null, "2s10s below +38 bp · now not served"]);
  });
  it("gives a manual position no room and its typed rule", () => {
    const v = viewOf(RECORDS.find((p) => p.id === "ndx-vs-spx")!, LEVELS, NOW);
    expect([v.monitoring, v.room_pct, v.to_level]).toEqual(["manual", null, null]);
    expect(falsifiesLine(v)).toBe("NDX gives back 3.4% against SPX from entry");
    expect(sizeLine({ ...v, size_nav: null, day: null })).toBe("no size · DV01 — · — of 60 trading days · opened Aug 24");
  });
});
