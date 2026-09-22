import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { OnDemandHistory } from "./ChartPanel";
import { renderWithProviders, stubFetch } from "../../test/utils";

vi.mock("./CandleChart", () => ({ default: ({ bars, range, interval }: { bars: unknown[]; range: string; interval?: string }) => <div data-testid="chart" data-range={range} data-interval={interval}>bars:{bars.length}</div> }));

const series = (symbol: string, range: string) => ({
  symbol, provider: "eodhd", fallback_used: false, fallback_reason: null, fetched_at: "x", market_ts: "2026-09-04T00:00:00Z", delayed: true,
  interval: range === "1D" ? "5m" : "1d", range, exchange: "US", timezone: "America/New_York", adjustment: "split_dividend_adjusted", count: 1,
  bars: [{ ts: "2026-09-04T00:00:00Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }],
});

describe("OnDemandHistory", () => {
  it("requests 6M by default, labels provider and as-of, and switches ranges", async () => {
    const { calls } = stubFetch({ "/api/market/candles/AMZN": (url) => series("AMZN", url.searchParams.get("range") ?? "6M") });
    renderWithProviders(<OnDemandHistory symbol="AMZN" />);
    expect(document.body.textContent).toMatch(/Requesting 6M history for AMZN from EODHD/);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    expect(calls[0]).toContain("range=6M");
    expect(document.body.textContent).toMatch(/6M · daily bars · EODHD · through/);
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(document.body.textContent).toMatch(/1D · 5-minute bars/));
    expect(screen.getByRole("button", { name: "1D" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("names the failure kind: rate limit, timeout, unsupported, empty", async () => {
    const cases: [string, string, number, RegExp][] = [
      ["RL", "rate_limited", 429, /rate limiting/],
      ["TO", "timeout", 504, /did not answer in time/],
      ["FX", "unsupported", 422, /not a supported instrument/],
      ["EM", "empty", 404, /No history on file for EM in this range/],
    ];
    for (const [sym, kind, status, re] of cases) {
      stubFetch({ [`/api/market/candles/${sym}`]: () => ({ status, body: { detail: "x", kind, provider: "eodhd", retryable: false } }) });
      const { unmount } = renderWithProviders(<OnDemandHistory symbol={sym} />);
      await waitFor(() => expect(document.body.textContent).toMatch(re));
      unmount();
    }
  });

  it("keeps the placeholder bars' own range/interval while a coarser range loads (review P0-1)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch({
      "/api/market/candles/AMZN": async (url) => {
        const range = url.searchParams.get("range") ?? "6M";
        if (range === "1Y") await gate;
        return series("AMZN", range);
      },
    });
    renderWithProviders(<OnDemandHistory symbol="AMZN" />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "1D" }));
    await waitFor(() => expect(screen.getByTestId("chart").getAttribute("data-interval")).toBe("5m"));
    fireEvent.click(screen.getByRole("button", { name: "1Y" }));
    // In flight: the chart still shows 1D bars and must still encode them as intraday.
    expect(screen.getByTestId("chart").getAttribute("data-range")).toBe("1D");
    expect(screen.getByTestId("chart").getAttribute("data-interval")).toBe("5m");
    expect(document.body.textContent).toMatch(/Requesting 1Y bars…/);
    release();
    await waitFor(() => expect(screen.getByTestId("chart").getAttribute("data-range")).toBe("1Y"));
  });
});

