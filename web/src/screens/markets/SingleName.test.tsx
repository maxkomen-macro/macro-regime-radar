import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
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
      "/api/market/profile/ZZZQ": () => ({ status: 404, body: { detail: "No listing found for 'ZZZQ' on EODHD.", kind: "unknown_symbol", provider: "api", retryable: false } }),
      "/api/market/candles/ZZZQ": () => ({ status: 404, body: { detail: "No listing", kind: "unknown_symbol", provider: "api", retryable: false } }),
    });
    renderWithProviders(<SingleName symbol="ZZZQ" onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/No listing found for ZZZQ on EODHD/));
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

/* ── redesign Phase 5 (checklist 05 B.4 / E.1): appended cases ──────────────
   The five cases above stay verbatim. These render the same fixtures with the
   news, regime-history and controlled-range branches exercised. */

const newsItem = (id: number, headline: string, ticker: string | null) => ({
  id, headline, summary: null, url: `https://example.com/news/${id}`, source: "Reuters", category: "general", published_at: "2026-09-17T13:05:00", fetched_at: null,
  market_impact: null, deal_size: null, sector_relevance: null, time_sensitivity: null, regime_relevance: null, overall_significance: 3.4, regime_interpretation: null, perplexity_research: null, ticker,
});
const TAGGED = [newsItem(101, "Amazon Web Services signs a multi-year cloud deal", "AMZN"), newsItem(102, "Amazon raises its holiday hiring target", "AMZN")];
const HEADLINE_MATCH = [newsItem(201, "Amazon expands same-day delivery to twelve more cities", null), newsItem(202, "Retail sales rose 0.4% in August", null)];

/** Sixteen monthly closes (Jun 2025 to Sep 2026) and a regime label per month: 15 joined returns, four regimes. */
const MONTHS = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const MONTHLY_CLOSES = [100, 104, 101, 106, 110, 108, 112, 115, 113, 118, 121, 119, 124, 128, 126, 131];
const monthlySeries = () => ({
  symbol: "AMZN", provider: "eodhd", fallback_used: false, fallback_reason: null, fetched_at: "x", market_ts: "2026-09-04T00:00:00Z", delayed: true,
  interval: "1mo", range: "MAX", exchange: "US", timezone: "America/New_York", adjustment: "split_dividend_adjusted", count: MONTHS.length,
  bars: MONTHS.map((m, i) => ({ ts: `${m}-01T00:00:00Z`, open: MONTHLY_CLOSES[i], high: MONTHLY_CLOSES[i] + 2, low: MONTHLY_CLOSES[i] - 2, close: MONTHLY_CLOSES[i], volume: 1_000 })),
});
const REGIME_LABELS = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
const REGIME_HISTORY = MONTHS.map((m, i) => ({
  date: `${m}-01`, label: REGIME_LABELS[i % 4], confidence: 0.47, growth_trend: 0.2, inflation_trend: -0.1, prob_goldilocks: 0.5, prob_overheating: 0.2, prob_stagflation: 0.1, prob_recession: 0.2,
}));
/** Daily bars for every range but MAX; 5-minute bars for 1D (the intraday case); monthly bars for MAX. */
const candlesByRange = (url: URL) => {
  const range = url.searchParams.get("range") ?? "6M";
  if (range === "MAX") return monthlySeries();
  const s = series(range);
  return range === "1D" ? { ...s, interval: "5m", bars: s.bars.map((b, i) => ({ ...b, ts: `2026-09-04T1${3 + i}:30:00Z` })) } : s;
};
const phase5Routes = (over: Record<string, (url: URL) => unknown> = {}) => ({
  ...common,
  "/api/market/profile/AMZN": () => profile,
  "/api/market/candles/AMZN": candlesByRange,
  ...over,
});
/** Text with `hidden` subtrees removed, whitespace collapsed. */
const visible = (el: Element | null | undefined): string => {
  if (!el) return "";
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const e = n as Element;
    if (e.hasAttribute("hidden")) return "";
    return [...e.childNodes].map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
};

describe("SingleName (checklist 05 B.4, appended)", () => {
  it("renders the News for AMZN disclosure collapsed, opens it and shows tagged rows with target=_blank; the headline match and the empty window read their own meta", async () => {
    stubFetch(phase5Routes({ "/api/news": (url) => (url.searchParams.get("ticker") === "AMZN" ? TAGGED : []) }));
    const tagged = renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    const button = await screen.findByRole("button", { name: /News for AMZN/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(visible(button)).toContain("Tagged headlines first, then a headline match on the company name");
    await waitFor(() => expect(visible(button)).toMatch(/2 stored · 7-day window$/));
    expect(visible(button)).not.toMatch(/· headline match$/); // the description mentions the fallback; the meta flags it only when used
    const wrapper = document.getElementById("single-name-news") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.contains(button)).toBe(true);
    // Collapsed: no headline on screen; the lens sits before the news disclosure.
    expect(screen.queryByText(TAGGED[0].headline)).toBeNull();
    const lens = document.getElementById("options-lens") as HTMLElement;
    expect(lens).not.toBeNull();
    expect(lens.compareDocumentPosition(wrapper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: /Options lens/ })).toHaveAttribute("aria-expanded", "false");
    expect(visible(screen.getByRole("button", { name: /Options lens/ }))).toContain("Chain by expiration · bid, ask, IV, Greeks");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(button.getAttribute("aria-controls") as string) as HTMLElement;
    const links = [...panel.querySelectorAll<HTMLAnchorElement>("a[target='_blank']")];
    expect(links).toHaveLength(2);
    for (const a of links) {
      expect(a.getAttribute("rel")).toMatch(/\bnoreferrer\b/);
      expect(a.getAttribute("href")).toMatch(/^https:\/\/example\.com\/news\/10[12]$/);
    }
    expect(links.map((a) => visible(a))).toEqual(TAGGED.map((n) => n.headline));
    expect(visible(panel)).toContain("Reuters · Sep 17, 2026 · sig 3.4 / 5");
    expect(visible(panel)).not.toContain("No rows are tagged");
    tagged.unmount();

    // No tagged rows: the headline match on the company name, flagged in the meta and the caption.
    stubFetch(phase5Routes({ "/api/market/profile/AMZN": () => ({ ...profile, name: "Amazon Inc" }), "/api/news": (url) => (url.searchParams.get("ticker") ? [] : HEADLINE_MATCH) }));
    const matched = renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    const button2 = await screen.findByRole("button", { name: /News for AMZN/ });
    await waitFor(() => expect(visible(button2)).toMatch(/1 stored · 7-day window · headline match$/));
    fireEvent.click(button2);
    const panel2 = document.getElementById(button2.getAttribute("aria-controls") as string) as HTMLElement;
    expect(panel2.querySelectorAll("a[target='_blank']")).toHaveLength(1);
    expect(visible(panel2)).toContain(HEADLINE_MATCH[0].headline);
    expect(visible(panel2)).not.toContain(HEADLINE_MATCH[1].headline);
    expect(visible(panel2)).toContain('No rows are tagged AMZN; these headlines mention "Amazon" by name instead.');
    matched.unmount();

    // Nothing in the window: the meta says so and the panel opens to the empty caption.
    stubFetch(phase5Routes());
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    const button3 = await screen.findByRole("button", { name: /News for AMZN/ });
    await waitFor(() => expect(visible(button3)).toMatch(/none in 7 days$/));
    fireEvent.click(button3);
    await waitFor(() => expect(document.body.textContent).toMatch(/No stored coverage mentions AMZN in the last 7 days; the feed keeps a rolling window and ages out by design\./));
    expect(document.querySelectorAll("a[target='_blank']")).toHaveLength(0);
  });

  it("labels the regime fit as average monthly and paints the regime tokens, never the old palette literal", async () => {
    stubFetch(phase5Routes({ "/api/regime/history": () => REGIME_HISTORY }));
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    const eyebrow = await screen.findByText("Average monthly return by regime");
    expect(eyebrow).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Regime fit · monthly closes × stored classifier");
    // Four tiles in the fixed order, each with its value and the up-share line.
    await waitFor(() => expect(document.body.textContent).toMatch(/% up · n=\d+/));
    const labels = REGIME_LABELS.map((label) => screen.getAllByText(label).find((el) => el.closest("[style*='rgba(']") && !el.closest("caption")) as HTMLElement);
    labels.forEach((el, i) => expect(el, REGIME_LABELS[i]).toBeDefined());
    for (let i = 1; i < labels.length; i++) expect(labels[i - 1].compareDocumentPosition(labels[i]) & Node.DOCUMENT_POSITION_FOLLOWING, `${REGIME_LABELS[i - 1]} before ${REGIME_LABELS[i]}`).toBeTruthy();
    expect(labels[0].style.color).toBe("var(--r-goldilocks)");
    expect(labels[1].style.color).toBe("var(--r-overheating)");
    expect(labels[2].style.color).toBe("var(--r-stagflation)");
    expect(labels[3].style.color).toBe("var(--r-recession)");
    expect((document.body.textContent ?? "").match(/% up · n=\d+/g)).toHaveLength(4);
    expect(document.body.textContent).toContain("Average monthly return for AMZN inside each classifier regime since 2025-07 (15 overlapping months; monthly closes via EODHD); up% is the share of positive months. Small n cells are anecdotes, not laws.");
    // The literal map is gone: no hex, and no rgb() form of it either (jsdom serialises hex colours as rgb).
    const html = document.body.innerHTML;
    expect(html).not.toMatch(/#2ecc71/i);
    expect(html).not.toMatch(/46, ?204, ?113/);
    for (const el of document.body.querySelectorAll<HTMLElement>("[style]")) expect(el.getAttribute("style") ?? "").not.toMatch(/#2ecc71/i);
    // The alpha variants are the token hexes as rgba: mint 38,220,160 on the Goldilocks tile.
    const tile = labels[0].closest("[style*='rgba(']") as HTMLElement;
    expect(tile.getAttribute("style") ?? "").toMatch(/38, ?220, ?160/);
  });

  it("controlled range: no picker inside the tile, the candles request carries the controlled range, and the 20-day legend follows the payload interval; uncontrolled keeps its own picker", async () => {
    const onRangeChange = vi.fn();
    const { calls } = stubFetch(phase5Routes());
    const controlled = renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} range="6M" onRangeChange={onRangeChange} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Chart range" })).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/market/candles/AMZN") && c.includes("range=6M"))).toBe(true);
    expect(calls.some((c) => c.startsWith("/api/market/candles/AMZN") && c.includes("range=1Y"))).toBe(false);
    expect(document.body.textContent).toMatch(/6M · daily bars · EODHD · through/);
    expect(screen.getByText(/20-day average/)).toBeInTheDocument();

    controlled.rerender(<SingleName symbol="AMZN" onClose={() => {}} range="1Y" onRangeChange={onRangeChange} />);
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/market/candles/AMZN") && c.includes("range=1Y"))).toBe(true));
    await waitFor(() => expect(document.body.textContent).toMatch(/1Y · daily bars · EODHD · through/));
    expect(screen.queryByRole("group", { name: "Chart range" })).toBeNull();
    expect(onRangeChange).not.toHaveBeenCalled();
    expect(screen.getByText(/20-day average/)).toBeInTheDocument();

    // An intraday payload hides the legend: a 20-bar mean over 5-minute bars is not a 20-day average.
    controlled.rerender(<SingleName symbol="AMZN" onClose={() => {}} range="1D" onRangeChange={onRangeChange} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/1D · 5-minute bars/));
    await waitFor(() => expect(screen.queryByText(/20-day average/)).toBeNull());
    controlled.unmount();

    // Without the props the tile keeps today's picker and its own state.
    const { calls: calls2 } = stubFetch(phase5Routes());
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    const group = screen.getByRole("group", { name: "Chart range" });
    expect(group).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "6M" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(group).getByRole("button", { name: "1Y" }));
    expect(within(group).getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls2.some((c) => c.startsWith("/api/market/candles/AMZN") && c.includes("range=1Y"))).toBe(true));
    await waitFor(() => expect(document.body.textContent).toMatch(/1Y · daily bars · EODHD · through/));
  });
});

/* ── Iteration 1, M5: no blank block ─────────────────────────────────────── */

describe("SingleName, Iteration 1 (M5)", () => {
  const down = (kind = "unavailable") => ({ status: 502, body: { detail: "upstream failed", kind, provider: "eodhd", retryable: true } });

  it("an unknown symbol reads one plain sentence in place of the tile, with the provider reason and a close button", async () => {
    stubFetch({
      ...common,
      "/api/market/profile/ZZZZQX": () => ({ status: 404, body: { detail: "No listing found for 'ZZZZQX' on EODHD.", kind: "unknown_symbol", provider: "api", retryable: false } }),
      "/api/market/candles/ZZZZQX": () => ({ status: 404, body: { detail: "No listing", kind: "unknown_symbol", provider: "api", retryable: false } }),
    });
    const onClose = vi.fn();
    renderWithProviders(<SingleName symbol="ZZZZQX" onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("No listed symbol matches ZZZZQX."));
    expect(document.body.textContent).toMatch(/No listing found for ZZZZQX on EODHD\./);
    expect(screen.queryByRole("button", { name: /Options lens/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /News for ZZZZQX/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close single-name panel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a profile that fails names the missing fundamentals while the chart, the regime caption, the options lens and the news still render", async () => {
    stubFetch(phase5Routes({ "/api/market/profile/AMZN": () => down() }));
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    await waitFor(() => expect(document.body.textContent).toMatch(/No fundamentals for AMZN: the profile did not load, and the quote line above says why\./), { timeout: 5000 });
    expect(document.body.textContent).toMatch(/The quote for AMZN is unavailable from the provider right now\./);
    expect(screen.getByRole("button", { name: /Options lens/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /News for AMZN/ })).toBeInTheDocument();
    expect(document.body.textContent).toMatch(/Average monthly return by regime/);
  });

  it("an instrument without listed options says so in one sentence instead of dropping the lens", async () => {
    stubFetch(phase5Routes({ "/api/market/profile/AMZN": () => ({ ...profile, exchange: "CC", quote_type: "Crypto" }) }));
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/No options lens for AMZN: listed option chains are served for US equities and ETFs only\./));
    expect(screen.queryByRole("button", { name: /Options lens/ })).toBeNull();
  });

  it("an options lens with no listed expirations says so instead of waiting forever", async () => {
    stubFetch(phase5Routes({ "/api/market/options/AMZN/expirations": () => ({ symbol: "AMZN", provider: "eodhd", as_of: "2026-09-18", expirations: [], truncated: false }) }));
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Options lens/ }));
    await waitFor(() => expect(document.body.textContent).toMatch(/No listed option expirations on file for AMZN/));
    expect(document.body.textContent).not.toMatch(/Requesting calls for/);
  });

  it("news and regime history that fail to load say so, never 'no coverage' or 'fewer than 12 months'", async () => {
    stubFetch(phase5Routes({ "/api/news": () => down(), "/api/regime/history": () => down() }));
    renderWithProviders(<SingleName symbol="AMZN" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByTestId("chart")).toBeInTheDocument());
    const news = await screen.findByRole("button", { name: /News for AMZN/ });
    await waitFor(() => expect(visible(news)).toMatch(/unavailable$/), { timeout: 5000 });
    fireEvent.click(news);
    expect(document.body.textContent).toMatch(/Stored news for AMZN did not load/);
    expect(document.body.textContent).not.toMatch(/No stored coverage mentions AMZN/);
    await waitFor(() => expect(document.body.textContent).toMatch(/The stored regime history did not load, so there is no regime read for AMZN\./), { timeout: 5000 });
  });

  it("an Escape another handler consumed does not close the panel; a plain Escape does", () => {
    stubFetch(phase5Routes());
    const onClose = vi.fn();
    renderWithProviders(<SingleName symbol="AMZN" onClose={onClose} />);
    const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    consumed.preventDefault();
    window.dispatchEvent(consumed);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

