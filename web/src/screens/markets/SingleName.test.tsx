import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import SingleName from "./SingleName";
import { renderWithProviders, stubFetch } from "../../test/utils";

vi.mock("./CandleChart", () => ({ default: ({ bars }: { bars: { close: number }[] }) => <div data-testid="chart">bars:{bars.length}</div> }));
vi.mock("../../live/quotes", () => ({
  LIVE_WINDOW_MS: 120_000,
  useQuotes: () => new Map(),
  useWatch: () => {},
}));

const profile = {
  symbol: "AMZN", name: "Amazon.com Inc", exchange: "US", currency: "USD", quote_type: "Equity", sector: "Consumer Cyclical", industry: "Internet Retail",
  last: 203.5, prev_close: 201, day_change_pct: 1.24, day_low: 198, day_high: 205, year_low: 150, year_high: 240, market_cap: 2.1e12, last_volume: 1e7,
  avg_volume_3m: 4e7, trailing_pe: 40, forward_pe: 30, eps_ttm: 5, beta: 1.1, dividend_yield: null, price_to_book: 8, profit_margin: 0.09, revenue_growth: 0.1,
  fifty_two_wk_change: 0.2, fetched_at: "2026-09-06T00:00:00Z", market_ts: "2026-09-04T20:00:00Z", quote_provider: "eodhd", fundamentals_provider: "yfinance",
  delayed: true, delay_note: "EODHD delayed quote", fallback_used: false, fallback_reason: null,
};
const series = (range: string, provider = "eodhd", fallback = false) => ({
  symbol: "AMZN", provider, fallback_used: fallback, fallback_reason: fallback ? "timeout" : null, fetched_at: "x", market_ts: "2026-09-04T00:00:00Z", delayed: true,
  interval: "1d", range, exchange: "US", timezone: "America/New_York", adjustment: "split_dividend_adjusted", count: 2,
  bars: [{ ts: "2026-09-03T00:00:00Z", open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }, { ts: "2026-09-04T00:00:00Z", open: 1, high: 2, low: 0.5, close: 1.6, volume: 1 }],
});
const common = {
  "/api/regime/history": () => [],
  "/api/news": () => [],
  "/api/freshness": () => ({ regimes_date: "2026-07-01", session: { phase: "weekend", is_open: false } }),
};

describe("SingleName", () => {
  it("labels the quote and fundamentals providers and the candle provenance", async () => {
    stubFetch({ ...common, "/api/market/profile/AMZN": () => profile, "/api/market/candles/AMZN": (url) => series(url.searchParams.get("range") ?? "6M") });
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    expect(document.body.textContent).toMatch(/EODHD · delayed · as of/);
    expect(document.body.textContent).toMatch(/session closed · last close stands/);
    expect(document.body.textContent).toMatch(/6M · daily bars · EODHD · through/);
    expect(document.body.textContent).toMatch(/Fundamentals via yfinance/);
    expect(document.body.textContent).not.toMatch(/via yfinance, split/);
  });

  it("discloses a yfinance fallback for history", async () => {
    stubFetch({ ...common, "/api/market/profile/AMZN": () => profile, "/api/market/candles/AMZN": (url) => series(url.searchParams.get("range") ?? "6M", "yfinance", true) });
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/yfinance \(yfinance standing in \(EODHD timed out\)\)/));
  });

  it("names an unknown symbol, and an options plan gap, without fabricating", async () => {
    stubFetch({
      ...common,
      "/api/market/profile/ZZZQ": () => ({ status: 404, body: { detail: "No listing found for 'ZZZQ' on EODHD or yfinance.", kind: "unknown_symbol", provider: "api", retryable: false } }),
      "/api/market/candles/ZZZQ": () => ({ status: 404, body: { detail: "No listing", kind: "unknown_symbol", provider: "api", retryable: false } }),
    });
    renderWithProviders(<SingleName symbol="ZZZQ" onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/No listing found for ZZZQ on EODHD or yfinance/));
    expect(screen.queryByTestId("chart")).toBeNull();
  });

  it("options lens opens on demand and reports an unentitled plan explicitly", async () => {
    const { calls } = stubFetch({
      ...common,
      "/api/market/profile/AMZN": () => profile,
      "/api/market/candles/AMZN": (url) => series(url.searchParams.get("range") ?? "6M"),
      "/api/market/options/AMZN/expirations": () => ({ status: 403, body: { detail: "Options data is not included in the EODHD plan on this server.", kind: "unauthorized", provider: "eodhd", retryable: false } }),
    });
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    expect(calls.some((c) => c.includes("/options/"))).toBe(false); // collapsed: nothing requested yet
    fireEvent.click(screen.getByRole("button", { name: /Options lens/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/not included in the EODHD plan configured on this server/));
    expect(calls.some((c) => c.includes("/api/market/options/AMZN/expirations"))).toBe(true);
  });

  it("renders a chain with provider Greeks and pagination when entitled", async () => {
    const contract = { contract: "AMZN261016C00230000", type: "call", strike: 230, exp_date: "2026-10-16", expiration_type: "monthly", dte: 40, bid: 5.1, ask: 5.3, last: 5.2, midpoint: 5.2, volume: 100, open_interest: 2000, implied_vol: 0.28, delta: 0.45, gamma: 0.02, theta: -0.05, vega: 0.3, rho: 0.1, moneyness: 0.98, tradetime: "2026-09-04 15:59:00", last_quote: "2026-09-04 16:00:00" };
    stubFetch({
      ...common,
      "/api/market/profile/AMZN": () => profile,
      "/api/market/candles/AMZN": (url) => series(url.searchParams.get("range") ?? "6M"),
      "/api/market/options/AMZN/expirations": () => ({ symbol: "AMZN", underlying: "AMZN", provider: "eodhd", as_of: "2026-09-04 16:00:00", cadence: "end_of_day", fetched_at: "x", expirations: ["2026-10-16", "2026-11-20"], truncated: false }),
      "/api/market/options/AMZN": (url) => ({ symbol: "AMZN", underlying: "AMZN", provider: "eodhd", cadence: "end_of_day", as_of: "2026-09-04 16:00:00", fetched_at: "x", expiration: url.searchParams.get("expiration"), type: url.searchParams.get("type"), strike_from: null, strike_to: null, page: Number(url.searchParams.get("page")), limit: 40, count: 1, total: null, has_more: url.searchParams.get("page") === "0", contracts: [contract] }),
    });
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Options lens/ }));
    await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
    expect(document.body.textContent).toMatch(/0\.280/);
    expect(document.body.textContent).toMatch(/End-of-day marks from EODHD as of Sep 04, 12:00 ET/); // 16:00 UTC stamp rendered as ET wall time
    expect(document.body.textContent).toMatch(/end-of-day · EODHD · as of Sep 04, 12:00 ET/); // header and caption share one stamp
    const next = screen.getByRole("button", { name: /Next/ });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);
    await waitFor(() => expect(document.body.textContent).toMatch(/page 2/));
    await waitFor(() => expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: /Puts/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/page 1/));
  });
});
