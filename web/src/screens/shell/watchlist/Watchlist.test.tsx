/**
 * Phase 1 checklist F.4-F.8 / F.11 cases 19-26: the sidebar Watchlist block
 * (web/src/screens/shell/watchlist/Watchlist.tsx). renderWithProviders +
 * stubFetch for /api/market/search and /api/market/candles; the live-quote
 * store is mocked empty so every row takes the 5D candle (EOD) fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import Watchlist from "./Watchlist";
import { DEFAULT_SYMBOLS, WATCHLIST_KEY } from "./storage";
import { renderWithProviders, stubFetch } from "../../../test/utils";

vi.mock("../../../live/quotes", () => ({
  LIVE_WINDOW_MS: 120_000,
  useQuotes: () => new Map(),
  useWatch: () => {},
  watch: () => () => {},
  useStreamStatus: () => ({ socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false }),
  useStreamLive: () => false,
  useStreamWord: () => "Delayed",
  useLiveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamIsLive: () => false,
  liveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamWord: () => "Delayed",
}));

const ISO = "2026-09-01T00:00:00.000Z";
const file = (symbols: string[]) => JSON.stringify({ version: 1, symbols: symbols.map((symbol) => ({ symbol, addedAt: ISO })) });
const stored = (): string[] => (JSON.parse(window.localStorage.getItem(WATCHLIST_KEY) ?? '{"symbols":[]}') as { symbols: { symbol: string }[] }).symbols.map((s) => s.symbol);

const hit = (symbol: string, name: string) => ({ symbol, name, exchange: "NASDAQ", type: "Common Stock", sector: null, country: "USA", currency: "USD", primary: true });
const HITS: Record<string, ReturnType<typeof hit>> = {
  AMD: hit("AMD", "Advanced Micro Devices"),
  SPY: hit("SPY", "SPDR S&P 500 ETF Trust"),
  NVDA: hit("NVDA", "NVIDIA Corp"),
};
const search = (url: URL) => {
  const q = (url.searchParams.get("q") ?? "").toUpperCase();
  const hits = Object.values(HITS).filter((h) => h.symbol.startsWith(q) || h.name.toUpperCase().includes(q));
  return { provider: "eodhd", fallback_used: false, fallback_reason: null, fetched_at: "2026-09-15T12:00:00Z", hits };
};

/** 5D bars over two sessions: the previous session closed at 100.00, the
 * latest at 102.50, so the EOD change is +2.5%. */
const bar = (ts: string, close: number) => ({ ts, open: close, high: close, low: close, close, volume: 1 });
const candles = (url: URL) => {
  const symbol = url.pathname.split("/").pop() ?? "";
  return {
    symbol,
    provider: "eodhd",
    fallback_used: false,
    fallback_reason: null,
    fetched_at: "2026-09-15T12:00:00Z",
    market_ts: "2026-09-14T20:00:00Z",
    delayed: true,
    interval: "5m",
    range: "5D",
    exchange: "US",
    timezone: "America/New_York",
    adjustment: "split_dividend_adjusted",
    count: 4,
    bars: [bar("2026-09-11T19:50:00Z", 99.5), bar("2026-09-11T19:55:00Z", 100), bar("2026-09-14T14:35:00Z", 101), bar("2026-09-14T19:55:00Z", 102.5)],
  };
};

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{`${loc.pathname}${loc.search}${loc.hash}`}</div>;
}

function renderWatchlist(props: { compact?: boolean } = {}) {
  return renderWithProviders(
    <Routes>
      <Route
        path="/app/:tab"
        element={
          <>
            <Watchlist {...props} />
            <Probe />
          </>
        }
      />
    </Routes>,
    { route: "/app/dashboard" },
  );
}

const list = () => screen.getByRole("list", { name: "Watchlist" });
const rows = () => within(list()).getAllByRole("listitem");
const rowFor = (symbol: string) => {
  const row = rows().find((r) => within(r).queryByText(symbol) != null);
  if (!row) throw new Error(`no watchlist row for ${symbol}`);
  return row;
};
/** Row symbols in order: the <b> cell (checklist E "Exact CSS": `.mrr-wl-row b`), else the first word of the row text. */
const symbols = () => rows().map((r) => (r.querySelector("b")?.textContent ?? r.textContent ?? "").trim().split(/\s+/)[0]);

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({ "/api/market/search": search, "/api/market/candles": candles });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Watchlist", () => {
  it("Delete on a focused row removes it and shows the Undo toast; Backspace too", async () => {
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByText("Saved in this browser")).toBeInTheDocument();

    const iwm = rowFor("IWM");
    expect(iwm).toHaveAttribute("tabindex", "0");
    iwm.focus();
    fireEvent.keyDown(iwm, { key: "Delete" });
    await waitFor(() => expect(symbols()).toEqual(["SPY", "QQQ", "EEM"]));
    const removedIwm = screen.getByText("Removed IWM");
    const toast = removedIwm.closest("[role='status']");
    expect(toast).not.toBeNull();
    expect(toast).toHaveAttribute("aria-live", "polite");
    expect(within(toast as HTMLElement).getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(document.activeElement).toBe(rowFor("EEM")); // focus moves to the next row
    expect(stored()).toEqual(["SPY", "QQQ", "EEM"]);

    const eem = rowFor("EEM");
    fireEvent.keyDown(eem, { key: "Backspace" });
    await waitFor(() => expect(symbols()).toEqual(["SPY", "QQQ"]));
    expect(screen.getByText("Removed EEM")).toBeInTheDocument();
    expect(document.activeElement).toBe(rowFor("QQQ")); // no next row: the previous one
    expect(stored()).toEqual(["SPY", "QQQ"]);

    // Undo puts the last removal back where it was.
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(symbols()).toEqual(["SPY", "QQQ", "EEM"]));
    expect(screen.queryByText("Removed EEM")).toBeNull();
    expect(stored()).toEqual(["SPY", "QQQ", "EEM"]);
  });

  it("Alt+ArrowUp moves the focused row up and persists the order; Alt+ArrowDown at the last row is a no-op", async () => {
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));

    const iwm = rowFor("IWM");
    iwm.focus();
    fireEvent.keyDown(iwm, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(symbols()).toEqual(["SPY", "IWM", "QQQ", "EEM"]));
    expect(document.activeElement).toBe(rowFor("IWM")); // focus follows the moved row
    expect(stored()).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
    expect(screen.getByText("IWM moved to position 2")).toBeInTheDocument();

    const eem = rowFor("EEM");
    eem.focus();
    fireEvent.keyDown(eem, { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(symbols()).toEqual(["SPY", "IWM", "QQQ", "EEM"]));
    expect(stored()).toEqual(["SPY", "IWM", "QQQ", "EEM"]);

    // Without Alt the arrows are not a reorder.
    const spy = rowFor("SPY");
    spy.focus();
    fireEvent.keyDown(spy, { key: "ArrowDown" });
    expect(symbols()).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
  });

  it('"+" opens the popover; an already-listed hit shows "✓ Listed"; Enter on a new hit adds it and closes the popover', async () => {
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));

    const plus = screen.getByRole("button", { name: "Add to watchlist" });
    expect(plus).toHaveAttribute("aria-haspopup", "dialog");
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(plus);
    expect(plus).toHaveAttribute("aria-expanded", "true");
    const input = await screen.findByRole("combobox", { name: "Search any listed symbol" });
    expect(input).toHaveAttribute("placeholder", "Search any listed symbol…");
    expect(screen.getByText("4 of 12 slots used")).toBeInTheDocument();

    // Already listed: the row renders with the check and Enter is a no-op.
    fireEvent.change(input, { target: { value: "SPY" } });
    const listed = await screen.findByRole("option");
    expect(listed).toHaveTextContent("SPY");
    expect(listed).toHaveTextContent("✓ Listed");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(rows()).toHaveLength(4);
    expect(screen.queryByRole("status")).toBeNull(); // no toast for a duplicate

    // A new symbol: "+ Add" on the row, Enter adds it, the popover closes and the new row takes focus.
    fireEvent.change(input, { target: { value: "AMD" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("AMD"));
    expect(screen.getByRole("option")).toHaveTextContent("+ Add");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(symbols()).toEqual([...DEFAULT_SYMBOLS, "AMD"]));
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(plus).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(rowFor("AMD"));
    expect(stored()).toEqual([...DEFAULT_SYMBOLS, "AMD"]);
  });

  it("at 12 symbols the popover says the list is full", async () => {
    window.localStorage.setItem(WATCHLIST_KEY, file(["SPY", "QQQ", "IWM", "EEM", "AMD", "NVDA", "MSFT", "AAPL", "TSM", "GLD", "TLT", "XLE"]));
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(12));

    const plus = screen.getByRole("button", { name: "Add to watchlist" });
    expect(plus).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(plus);
    expect(await screen.findByText("Your watchlist is full (12 of 12). Remove a symbol to add another.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("12 of 12 slots used")).toBeInTheDocument();
  });

  it('the empty state offers "+ Add a symbol" and "Restore defaults", and Restore writes SPY, QQQ, IWM, EEM', async () => {
    window.localStorage.setItem(WATCHLIST_KEY, file([]));
    renderWatchlist();
    expect(await screen.findByText("Your watchlist is empty")).toBeInTheDocument();
    expect(screen.getByText("Add symbols to track them here on every visit.")).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    // The ghost button opens the same add popover.
    fireEvent.click(screen.getByRole("button", { name: "+ Add a symbol" }));
    expect(await screen.findByRole("combobox", { name: "Search any listed symbol" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restore defaults" }));
    await waitFor(() => expect(symbols()).toEqual(DEFAULT_SYMBOLS));
    expect(screen.queryByText("Your watchlist is empty")).toBeNull();
    expect(stored()).toEqual(DEFAULT_SYMBOLS);
  });

  it("a row without a live quote shows the last 5D close with the EOD tag and no sparkline", async () => {
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));
    const spy = rowFor("SPY");
    await waitFor(() => expect(within(spy).getByText("EOD")).toBeInTheDocument());
    expect(within(spy).getByText("102.50")).toBeInTheDocument();
    expect(spy.textContent).toMatch(/\+2\.50?%/);
    expect(spy.querySelector("svg[width='36']")).toBeNull(); // the EOD tag takes the sparkline cell
  });

  it("a row click navigates to /app/markets?name=SYM#single-name-research (MemoryRouter probe, as in CommandPalette.test.tsx)", async () => {
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByTestId("loc").textContent).toBe("/app/dashboard");

    fireEvent.click(rowFor("SPY"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/app/markets?name=SPY#single-name-research"));

    // Enter on a focused row is the keyboard equivalent.
    const qqq = rowFor("QQQ");
    qqq.focus();
    fireEvent.keyDown(qqq, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/app/markets?name=QQQ#single-name-research"));
  });

  it('"Won\'t be saved in this browser." renders when storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    renderWatchlist();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(screen.getByText("Won't be saved in this browser.")).toBeInTheDocument();
    expect(screen.queryByText("Saved in this browser")).toBeNull();

    // The list still works in memory.
    const iwm = rowFor("IWM");
    iwm.focus();
    fireEvent.keyDown(iwm, { key: "Delete" });
    await waitFor(() => expect(symbols()).toEqual(["SPY", "QQQ", "EEM"]));
    expect(window.localStorage.getItem(WATCHLIST_KEY)).toBeNull();
  });
});
