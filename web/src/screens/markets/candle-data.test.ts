import { describe, expect, it } from "vitest";
import { isIntraday, movingAverage, prepareCandles, prepareVolumes } from "./candle-data";

const hourly = ["2026-08-05T13:30:00Z", "2026-08-05T14:30:00Z", "2026-08-05T15:30:00Z", "2026-08-06T13:30:00Z"].map((ts, i) => ({ ts, open: 1 + i, high: 2 + i, low: 0.5 + i, close: 1.5 + i, volume: 10 + i }));

describe("candle-data", () => {
  it("encodes by the data's interval, not the requested range", () => {
    expect(isIntraday("1h", "1Y")).toBe(true);
    expect(isIntraday("1d", "1D")).toBe(false);
    expect(isIntraday(undefined, "5D")).toBe(true);
    expect(isIntraday(undefined, "MAX")).toBe(false);
  });

  it("never produces duplicate or unordered keys, even when hourly bars are encoded as days", () => {
    const daily = prepareCandles(hourly, false); // the crash case: 3 hourly bars collapse onto 2026-08-05
    expect(daily.map((c) => c.time)).toEqual(["2026-08-05", "2026-08-06"]);
    expect(daily[0].close).toBe(3.5); // last bar of the day wins
    const intra = prepareCandles([hourly[2], hourly[0], hourly[1], hourly[0]], true);
    expect(intra.map((c) => c.time)).toEqual([Date.parse(hourly[0].ts) / 1000, Date.parse(hourly[1].ts) / 1000, Date.parse(hourly[2].ts) / 1000]);
    const vols = prepareVolumes(hourly, false);
    expect(vols.map((v) => v.time)).toEqual(["2026-08-05", "2026-08-06"]);
  });

  it("drops bars without a full OHLC or a finite close", () => {
    expect(prepareCandles([{ ts: "2026-08-05T00:00:00Z", open: null, high: 2, low: 1, close: 1.5, volume: null }], false)).toEqual([]);
    expect(prepareCandles([{ ts: "2026-08-05T00:00:00Z", open: 1, high: 2, low: 1, close: Number.NaN, volume: null }], false)).toEqual([]);
  });
});

/* ── redesign Phase 5 (checklist 05 A.10 / E.1): appended case ─────────────── */

describe("movingAverage (checklist 05 A.10)", () => {
  const daily = [1, 2, 3, 4, 5].map((c, i) => ({ ts: `2026-09-0${i + 1}T00:00:00Z`, open: c, high: c + 1, low: c - 0.5, close: c, volume: 1 }));

  it("returns nothing for the first n - 1 bars, then the simple mean of the last n closes keyed by each bar's time", () => {
    const candles = prepareCandles(daily, false);
    expect(movingAverage(candles, 3)).toEqual([
      { time: "2026-09-03", value: 2 },
      { time: "2026-09-04", value: 3 },
      { time: "2026-09-05", value: 4 },
    ]);
    expect(movingAverage(candles, 5)).toEqual([{ time: "2026-09-05", value: 3 }]);
    expect(movingAverage(candles, 6)).toEqual([]);
    expect(movingAverage(candles, 1).map((p) => p.value)).toEqual([1, 2, 3, 4, 5]);
    expect(movingAverage([], 3)).toEqual([]);
    // Every point keys on an existing bar's time, in order, and the input is untouched.
    const twenty = prepareCandles(daily, false);
    const before = JSON.stringify(twenty);
    const out = movingAverage(twenty, 2);
    expect(out.map((p) => p.time)).toEqual(twenty.slice(1).map((c) => c.time));
    expect(JSON.stringify(twenty)).toBe(before);
    // Decimal closes: a real mean, not a rounded display string.
    const decimals = prepareCandles([1.15, 1.25, 1.4].map((c, i) => ({ ts: `2026-09-1${i}T00:00:00Z`, open: c, high: c, low: c, close: c, volume: 1 })), false);
    const avg = movingAverage(decimals, 3);
    expect(avg).toHaveLength(1);
    expect(avg[0].value).toBeCloseTo((1.15 + 1.25 + 1.4) / 3, 10);
  });

  it("keeps numeric intraday keys and follows the bars' own order", () => {
    const intra = prepareCandles(hourly, true);
    const out = movingAverage(intra, 2);
    expect(out.map((p) => p.time)).toEqual(intra.slice(1).map((c) => c.time));
    expect(out.map((p) => p.value)).toEqual([2, 3, 4]); // (1.5+2.5)/2, (2.5+3.5)/2, (3.5+4.5)/2
    expect(typeof out[0].time).toBe("number");
  });
});
