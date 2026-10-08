/** Desk v2 formatting (kit/format.ts, kit/MonitoredRows.tsx): true minus signs, fractions as percents, served dates at their own frequency. */
import { describe, expect, it } from "vitest";
import { dayLong, dayShort, etDayTime, etTime, grouped, monthLong, monthShort, monthYear, num, oddsPct, ordinal, ordinalWord, pct, pctPlain, pts, putsVsCalls, signed, year, priceText, tickText } from "./format";
import { levelText, roomTone, roomWords, sortByRoom } from "./MonitoredRows";

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
  it("never prints a number for a value that is not a finite number (Codex R-01)", () => {
    const bad = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, "12"] as unknown as number[];
    for (const x of bad) {
      expect(signed(x)).toBe("—");
      expect(num(x)).toBe("—");
      expect(pct(x)).toBe("—");
      expect(pctPlain(x)).toBe("—");
      expect(pts(x)).toBe("—");
      expect(grouped(x)).toBe("—");
    }
    expect(pct(0)).toBe("0.0%");
  });
  it("turns numbers into ordinals", () => {
    expect(ordinal(74)).toBe("74th");
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(22)).toBe("22nd");
    expect(ordinal(13)).toBe("13th");
    expect(ordinalWord(3)).toBe("third");
  });
});

describe("prices (Codex R-02)", () => {
  it("prints a stock at two decimals and four below 1, an index whole; 0.40 never reads 0", () => {
    expect(priceText(0.4)).toBe("0.4000");
    expect(priceText(0.0123)).toBe("0.0123");
    expect(priceText(225.50999)).toBe("225.51");
    expect(priceText(1234.5)).toBe("1,234.50");
    expect(priceText(7706.03, true)).toBe("7,706");
    expect(priceText(Number.NaN)).toBe("—");
  });
  it("prints an axis tick with the decimals its step needs", () => {
    expect([0.35, 0.4, 0.45].map((v, _i, a) => tickText(v, a))).toEqual(["0.35", "0.40", "0.45"]);
    expect([100, 102.5, 105].map((v, _i, a) => tickText(v, a))).toEqual(["100.0", "102.5", "105.0"]);
    expect([6000, 7000, 8000].map((v, _i, a) => tickText(v, a))).toEqual(["6,000", "7,000", "8,000"]);
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
  });

  it("prints every time of day in New York time, 12-hour, with its New York day (desk/pdf-polish item 2b)", () => {
    // EDT (UTC−4): the full refresh's 17:27 UTC run is 1:27 PM; its 00:23 UTC run is the evening before.
    expect(etTime("2026-10-01T17:27:07Z")).toBe("1:27 PM ET");
    expect(etTime("2026-09-24T15:52:43Z")).toBe("11:52 AM ET");
    expect(etDayTime("2026-09-22T00:23:00Z")).toBe("Sep 21, 8:23 PM ET");
    // EST (UTC−5) after the November change; midnight and noon read 12.
    expect(etTime("2026-11-10T11:17:00Z")).toBe("6:17 AM ET");
    expect(etTime("2026-12-01T05:00:00Z")).toBe("12:00 AM ET");
    expect(etDayTime("2026-12-01T17:00:00Z")).toBe("Dec 1, 12:00 PM ET");
    expect(etTime("not a stamp")).toBe("");
    expect(etDayTime(null)).toBe("");
  });
});

describe("the options card's skew sentence (desk/pdf-polish 3a and its follow-up)", () => {
  it("says richer, cheaper below zero, in the same words served or illustrative", () => {
    expect(putsVsCalls(6.8)).toBe("Puts are 6.8 vol points richer than calls.");
    expect(putsVsCalls(-2.14)).toBe("Puts are 2.1 vol points cheaper than calls.");
    expect(putsVsCalls(0)).toBe("Puts are 0.0 vol points richer than calls.");
    expect(putsVsCalls(Number.NaN)).toBe("—");
  });
});

describe("monitored rows", () => {
  it("colors room green at 50% or more, amber under 30%, neutral between", () => {
    expect(roomTone(0.68)).toBe("green");
    expect(roomTone(0.5)).toBe("green");
    expect(roomTone(0.22)).toBe("amber");
    expect(roomTone(0.4)).toBeUndefined();
  });
  it("prints the distance to the level in its unit and sorts least room first, a row without room last, then by id", () => {
    expect(levelText({ value: 3.4, unit: "%" })).toBe("3.4%");
    expect(levelText({ value: 3, unit: "bp" })).toBe("3 bp");
    const rows = [
      { id: "c", room_pct: 0.68 },
      { id: "m2", room_pct: null },
      { id: "a", room_pct: 0.22 },
      { id: "m1", room_pct: null },
      { id: "b", room_pct: 0.22 },
    ];
    expect(sortByRoom(rows).map((r) => r.id)).toEqual(["a", "b", "c", "m1", "m2"]);
  });
  it("words the room cell: room and distance, through the level, manual, or not computed (§2, §9)", () => {
    const row = { id: "x", name: "Long S&P 500", size_nav: 0.02, monitoring: "automatic" as const, room_pct: 0.3, to_level: { value: 2.06, unit: "%" as const } };
    expect(roomWords(row)).toEqual({ room: "30% room", level: "2.1% to level" });
    expect(roomWords({ ...row, room_pct: -0.12, to_level: null })).toEqual({ room: "−12% room", level: "through the level" });
    expect(roomWords({ ...row, room_pct: null, to_level: null })).toEqual({ room: "room —", level: "" });
    expect(roomWords({ ...row, monitoring: "manual", room_pct: null, to_level: null })).toEqual({ room: "manual", level: "" });
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

describe("endDay (D13)", () => {
  it("says today only for New York's today, else the day, and 'latest' without a date", async () => {
    const { endDay } = await import("./format");
    expect(endDay("2026-09-24", "2026-09-24")).toBe("today");
    expect(endDay("2026-09-22", "2026-09-24")).toBe("Sep 22");
    expect(endDay(undefined, "2026-09-24")).toBe("latest");
  });
});

describe("classifier odds (fix/site-audit D1)", () => {
  it("prints odds as whole percents half up on the stored decimal, the app's rule", () => {
    expect(oddsPct(0.425)).toBe("43%");
    expect(oddsPct(0.285)).toBe("29%");
    expect(oddsPct(Number.NaN)).toBe("—");
  });
});
