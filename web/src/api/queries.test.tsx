import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useSymbolCandles } from "./queries";
import type { CandleRange } from "./types";
import { stubFetch } from "../test/utils";

const series = (symbol: string, range: string) => ({
  symbol, provider: "eodhd", fallback_used: false, fallback_reason: null, fetched_at: "x", market_ts: null, delayed: true,
  interval: "1d", range, exchange: "US", timezone: "America/New_York", adjustment: "split_dividend_adjusted", count: 1,
  bars: [{ ts: `2026-09-04T00:00:00Z`, open: 1, high: 2, low: 0.5, close: symbol === "AMZN" ? 100 : 200, volume: 1 }],
});

describe("useSymbolCandles", () => {
  it("never shows the previous symbol's bars while the new symbol loads, but keeps bars across a range change", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch({
      "/api/market/candles/AMZN": (url) => series("AMZN", url.searchParams.get("range") ?? "6M"),
      "/api/market/candles/AAPL": async (url) => { await gate; return series("AAPL", url.searchParams.get("range") ?? "6M"); },
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result, rerender } = renderHook(({ s, r }: { s: string; r: CandleRange }) => useSymbolCandles(s, r), { wrapper, initialProps: { s: "AMZN", r: "6M" as CandleRange } });
    await waitFor(() => expect(result.current.data?.bars[0].close).toBe(100));
    // Range change of the same symbol: previous bars stay as placeholder.
    rerender({ s: "AMZN", r: "1Y" });
    expect(result.current.data?.bars[0].close).toBe(100);
    await waitFor(() => expect(result.current.data?.range).toBe("1Y"));
    // Symbol change: no placeholder from AMZN while AAPL is in flight.
    rerender({ s: "AAPL", r: "1Y" });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
    release();
    await waitFor(() => expect(result.current.data?.bars[0].close).toBe(200));
    expect(result.current.data?.symbol).toBe("AAPL");
  });
});
