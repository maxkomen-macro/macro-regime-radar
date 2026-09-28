/**
 * InstrumentSearch (desk/usability item 1): the dashboard's SymbolSearch on
 * the Desk's scope. Suggestions on the first keystroke with ticker and name,
 * US-listed equities and ETFs only (primary listings first), arrow keys and
 * Enter or a click to pick; when the search does not answer, the series this
 * store prices; in the header a pick opens Technicals for the stock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { InstrumentSearch, storedMatches } from "./InstrumentSearch";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import instruments from "../../../fixtures/desk/instruments.json";
import type { Instrument } from "../data/types";

const HITS = {
  provider: "eodhd",
  fallback_used: false,
  fallback_reason: null,
  fetched_at: "2026-09-27T12:00:00Z",
  hits: [
    { symbol: "NVL.VN", name: "No Va Land Investment Group Corp", exchange: "VN", type: "Equity", sector: null, primary: true },
    { symbol: "NWLI", name: "National Western Life", exchange: "US", type: "Equity", sector: null, primary: false },
    { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "US", type: "Equity", sector: null, primary: true },
    { symbol: "NFFFX", name: "American Funds New World", exchange: "US", type: "Fund", sector: null, primary: true },
    { symbol: "NVDL", name: "GraniteShares 2x Long NVDA Daily ETF", exchange: "US", type: "ETF", sector: null, primary: true },
  ],
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function Spy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

describe("InstrumentSearch", () => {
  beforeEach(() => {
    stubDesk({ "/api/market/search": () => HITS });
  });

  it("suggests on the first keystroke: US equities and ETFs only, ticker and name, primary listings first", async () => {
    const { calls } = stubDesk({ "/api/market/search": () => HITS });
    renderWithProviders(<InstrumentSearch ariaLabel="Search a stock" onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search a stock" }), { target: { value: "N" } });
    const list = await screen.findByRole("listbox");
    const options = await within(list).findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([expect.stringMatching(/NVDA.*NVIDIA Corporation/), expect.stringMatching(/NVDL.*GraniteShares/), expect.stringMatching(/NWLI.*National Western/)]);
    expect(within(list).queryByText(/NVL\.VN|NFFFX/)).toBeNull();
    // The Desk asks the US scope.
    expect(calls.some((c) => c.startsWith("GET /api/market/search?q=N&limit=10&scope=us"))).toBe(true);
  });

  it("Codex R-04: suggestions belong to the text searched; Enter inside the debounce never picks the previous text's", async () => {
    const hit = (symbol: string, name: string) => ({ symbol, name, exchange: "US", type: "Equity", sector: null, primary: true });
    const answers: Record<string, unknown[]> = { AAPL: [hit("AAPL", "Apple Inc")], NVDA: [hit("NVDA", "NVIDIA Corporation")] };
    stubDesk({ "/api/market/search": (u) => ({ ...HITS, hits: answers[u.searchParams.get("q") ?? ""] ?? [] }) });
    const onSelect = vi.fn();
    renderWithProviders(<InstrumentSearch ariaLabel="Search a stock" onSelect={onSelect} />);
    const box = screen.getByRole("combobox", { name: "Search a stock" });
    fireEvent.change(box, { target: { value: "AAPL" } });
    await screen.findByRole("option", { name: /AAPL/ });
    // Codex's repro: AAPL's results on screen, NVDA typed, Enter at once (inside the 250 ms debounce).
    fireEvent.change(box, { target: { value: "NVDA" } });
    expect(screen.queryByRole("option", { name: /AAPL/ })).toBeNull();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
    // NVDA's own answer: now Enter picks NVDA, never AAPL.
    await screen.findByRole("option", { name: /NVDA/ });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ symbol: "NVDA" });
  });

  it("arrow keys and Enter, or a click, pick a suggestion", async () => {
    const onSelect = vi.fn();
    renderWithProviders(<InstrumentSearch ariaLabel="Search a stock" onSelect={onSelect} />);
    const box = screen.getByRole("combobox", { name: "Search a stock" });
    fireEvent.change(box, { target: { value: "N" } });
    await within(await screen.findByRole("listbox")).findAllByRole("option");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: "NVDL" }));
    fireEvent.change(box, { target: { value: "NV" } });
    const list = await screen.findByRole("listbox");
    fireEvent.mouseDown(await within(list).findByText("NVDA"));
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ symbol: "NVDA" }));
  });

  it("falls back to the series this store prices when the search does not answer", async () => {
    stubDesk({ "/api/market/search": () => ({ status: 502, body: { detail: "EODHD is unreachable (symbol search).", kind: "unavailable" } }) });
    renderWithProviders(<InstrumentSearch ariaLabel="Search a stock" onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search a stock" }), { target: { value: "g" } });
    const list = await screen.findByRole("listbox");
    // Tickers first (^GSPC, GLD), then names with a word that starts with the text (LQD's "Investment Grade").
    await waitFor(() => expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringMatching(/\^GSPC.*S&P 500/), expect.stringMatching(/GLD.*SPDR Gold/), expect.stringMatching(/LQD.*Investment Grade/)]));
    expect(list).toHaveTextContent("Search did not answer · series this store prices");
  });

  it("keeps a controlled box's text: what is typed stays, a pick fills the ticker", async () => {
    const onText = vi.fn();
    renderWithProviders(<InstrumentSearch inputId="inst" value="TLT" onTextChange={onText} onSelect={() => {}} />);
    const box = screen.getByRole("combobox");
    expect(box).toHaveValue("TLT");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onText).not.toHaveBeenCalled();
  });

  it("matches the stored list on the ticker or the name", () => {
    const list = (instruments as { instruments: Instrument[] }).instruments;
    expect(storedMatches(list, "gsp").map((h) => h.symbol)).toEqual(["^GSPC"]);
    expect(storedMatches(list, "gold").map((h) => h.symbol)).toEqual(["GLD"]);
    expect(storedMatches(list, " ")).toEqual([]);
    expect(storedMatches(list, "iwm")[0]).toMatchObject({ symbol: "IWM", exchange: "US", type: "ETF" });
  });

  it("sits in the header of every Desk page, and a pick opens Technicals for the stock", async () => {
    for (const page of ["overview", "event-study", "position-monitor", "data-pipeline"]) {
      const { unmount } = renderWithProviders(
        <>
          <Routes>
            <Route path="/desk/:page?" element={<DeskShell />} />
          </Routes>
          <Spy />
        </>,
        { route: `/desk/${page}` },
      );
      const box = await screen.findByRole("combobox", { name: "Search a stock" });
      expect(screen.getByRole("search", { name: "Stocks" })).toContainElement(box);
      if (page === "overview") {
        fireEvent.change(box, { target: { value: "N" } });
        const list = await screen.findByRole("listbox");
        fireEvent.mouseDown(await within(list).findByText("NVDA"));
        await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/technicals?symbol=NVDA"));
      }
      unmount();
    }
  });
});
