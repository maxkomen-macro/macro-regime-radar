import { describe, expect, it } from "vitest";
import { isIntraday, prepareCandles, prepareVolumes } from "./candle-data";

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
