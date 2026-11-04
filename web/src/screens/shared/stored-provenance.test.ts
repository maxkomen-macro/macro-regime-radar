import { describe, expect, it } from "vitest";
import {
  POLYGON_DAILY_FIRST_BY_SYMBOL,
  POLYGON_DAILY_LAST,
  STORED_DAILY_SOURCE,
  YFINANCE_DAILY_INSIDE,
  storedDailyProvider,
  storedDailyProviders,
} from "./stored-provenance";

describe("stored daily provenance (market_daily's source column, by symbol and date)", () => {
  it("dates each ETF's Polygon.io bars from its own start to the last Polygon bar, inclusive", () => {
    expect(Object.keys(POLYGON_DAILY_FIRST_BY_SYMBOL)).toHaveLength(23);
    expect(POLYGON_DAILY_LAST).toBe("2026-05-26");
    // QQQ starts 2024-02-27.
    expect(storedDailyProvider("QQQ", "2024-02-26")).toBe("yfinance");
    expect(storedDailyProvider("QQQ", "2024-02-27")).toBe("Polygon.io");
    expect(storedDailyProvider("QQQ", "2026-05-26")).toBe("Polygon.io");
    expect(storedDailyProvider("QQQ", "2026-05-27")).toBe("yfinance");
    // XLK starts 2026-02-18: a bar a backfill adds before that is yfinance, not Polygon.io.
    expect(storedDailyProvider("XLK", "2025-06-02")).toBe("yfinance");
    expect(storedDailyProvider("XLK", "2026-02-17")).toBe("yfinance");
    expect(storedDailyProvider("XLK", "2026-02-18")).toBe("Polygon.io");
    expect(storedDailyProvider("XLK", "2026-11-03T00:00:00")).toBe("yfinance");
    // A symbol outside the stored universe has no Polygon.io bars.
    expect(storedDailyProvider("NVDA", "2025-06-02")).toBe("yfinance");
  });

  it("names SPY's one yfinance bar inside its Polygon.io span, and only for SPY", () => {
    expect(YFINANCE_DAILY_INSIDE).toEqual([["SPY", "2026-03-12"]]);
    expect(storedDailyProvider("SPY", "2026-03-12")).toBe("yfinance");
    expect(storedDailyProvider("QQQ", "2026-03-12")).toBe("Polygon.io");
    expect(storedDailyProvider("SPY", "2026-03-11")).toBe("Polygon.io");
  });

  it("names one provider for a window on one side of the switch", () => {
    expect(storedDailyProviders("XLK", ["2026-09-01", "2026-09-02"])).toBe("yfinance");
    expect(storedDailyProviders("QQQ", ["2025-03-03", "2025-03-04"])).toBe("Polygon.io");
    expect(storedDailyProviders("XLK", [])).toBeNull();
  });

  it("names each provider with its own bars' first or last date when a window crosses the switch", () => {
    // The Markets chart's 1Y window for XLK: Polygon.io to the last Polygon bar, yfinance from the first yfinance bar.
    expect(storedDailyProviders("XLK", ["2026-02-18", "2026-05-26", "2026-05-27", "2026-11-03"])).toBe(
      "Polygon.io to May 26, 2026, yfinance from May 27, 2026",
    );
    // SPY's long history crosses twice; the dates are the bars', in date order whatever the input order.
    expect(storedDailyProviders("SPY", ["2026-06-01", "2024-02-23", "2024-02-26", "2024-02-27", "2026-05-22"])).toBe(
      "yfinance to Feb 26, 2024, Polygon.io Feb 27, 2024 to May 22, 2026, yfinance from Jun 01, 2026",
    );
    // SPY's 1Y window crosses providers three times.
    expect(storedDailyProviders("SPY", ["2025-11-04", "2026-03-11", "2026-03-12", "2026-03-13", "2026-05-26", "2026-05-27", "2026-11-03"])).toBe(
      "Polygon.io to Mar 11, 2026, yfinance on Mar 12, 2026, Polygon.io Mar 13, 2026 to May 26, 2026, yfinance from May 27, 2026",
    );
    expect(storedDailyProviders("QQQ", ["2025-11-04", "2026-03-12", "2026-05-26", "2026-05-27"])).toBe("Polygon.io to May 26, 2026, yfinance from May 27, 2026");
  });

  it("never says every stored bar is yfinance", () => {
    expect(STORED_DAILY_SOURCE).toBe(
      "stored daily candles and returns via the refresh pipeline: yfinance, except each stored ETF's bars from Feb 27, 2024 (Feb 18, 2026 for 14 of them) to May 26, 2026, which are Polygon.io bars kept from the earlier pipeline (SPY's Mar 12, 2026 bar is yfinance)",
    );
  });
});
