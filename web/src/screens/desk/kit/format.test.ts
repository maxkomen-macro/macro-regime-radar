/** Desk v2 formatting (kit/format.ts, kit/MonitoredRows.tsx): true minus signs, fractions as percents, served dates at their own frequency. */
import { describe, expect, it } from "vitest";
import { dayLong, dayShort, grouped, monthLong, monthShort, monthYear, num, oneIn, ordinal, ordinalWord, pct, pctPlain, pts, signed, utcTime, year } from "./format";
import { levelText, roomTone, sortByRoom } from "./MonitoredRows";

describe("numbers", () => {
  it("signs with a true minus and never signs a rounded zero", () => {
    expect(signed(2.7)).toBe("+2.7");
    expect(signed(-0.4)).toBe("−0.4");
    expect(signed(-0.04)).toBe("0.0");
    expect(num(-0.24, 2)).toBe("−0.24");
    expect(num(16.2)).toBe("16.2");
  });
  it("spells fractions as percents and points", () => {
    expect(pct(0.031)).toBe("+3.1%");
    expect(pct(-0.006)).toBe("−0.6%");
    expect(pctPlain(0.68)).toBe("68%");
    expect(pctPlain(0.0312, 2)).toBe("3.12%");
    expect(pts(1.4)).toBe("+1.4 pts");
    expect(pts(-1.9)).toBe("−1.9 pts");
    expect(grouped(6412)).toBe("6,412");
  });
  it("turns a probability into one-in-N and numbers into ordinals", () => {
    expect(oneIn(0.12)).toBe("one-in-eight");
    expect(oneIn(0.5)).toBe("one-in-two");
    expect(ordinal(74)).toBe("74th");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(13)).toBe("13th");
    expect(ordinalWord(3)).toBe("third");
  });
});

describe("dates", () => {
  it("prints days, months and years from ISO stamps without a timezone shift", () => {
    expect(dayShort("2026-09-22")).toBe("Sep 22");
    expect(dayLong("2025-07-01")).toBe("Jul 1, 2025");
    expect(monthShort("2026-05")).toBe("May");
    expect(monthLong("2026-06")).toBe("June");
    expect(monthYear("2025-07-01")).toBe("Jul 2025");
    expect(year("2000-01-03")).toBe("2000");
    expect(utcTime("2026-09-22T00:23:00Z")).toBe("00:23 UTC");
  });
});

describe("monitored rows", () => {
  it("colors room green at 50% or more, amber under 30%, neutral between", () => {
    expect(roomTone(0.68)).toBe("green");
    expect(roomTone(0.5)).toBe("green");
    expect(roomTone(0.22)).toBe("amber");
    expect(roomTone(0.4)).toBeUndefined();
  });
  it("prints the distance to the level in its unit and sorts least room first", () => {
    expect(levelText({ value: 3.4, unit: "%" })).toBe("3.4%");
    expect(levelText({ value: 3, unit: "bp" })).toBe("3 bp");
    expect(sortByRoom([{ room_pct: 0.68 }, { room_pct: 0.22 }, { room_pct: 0.52 }]).map((r) => r.room_pct)).toEqual([0.22, 0.52, 0.68]);
  });
});

import { extentTicks, niceTicks, spreadLabels } from "./LineChart";

describe("chart ticks", () => {
  it("encloses the price range in at most three round ticks (§3: 5,000 / 6,000 / 7,000)", () => {
    expect(extentTicks(5480, 6420, 3)).toEqual([5000, 6000, 7000]);
    expect(extentTicks(4100, 6420, 4)).toEqual([4000, 5000, 6000, 7000]);
    expect(extentTicks(3.8, 4.62, 4)).toEqual([3.5, 4, 4.5, 5]);
  });
  it("keeps right-end labels 14 px apart", () => {
    expect(spreadLabels([100, 105, 200])).toEqual([100, 114, 200]);
    expect(niceTicks(0, 10, 4)).toEqual([0, 2.5, 5, 7.5, 10]);
  });
});
