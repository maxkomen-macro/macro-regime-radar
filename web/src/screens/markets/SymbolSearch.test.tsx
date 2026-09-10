import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import SymbolSearch from "./SymbolSearch";
import { renderWithProviders, stubFetch } from "../../test/utils";

const hit = (symbol: string, name: string) => ({ symbol, name, exchange: "US", type: "Equity", sector: null, country: "USA", currency: "USD", primary: true });
const envelope = (hits: unknown[], provider = "eodhd", fallback = false) => ({ provider, fallback_used: fallback, fallback_reason: fallback ? "unavailable" : null, fetched_at: "x", hits });

describe("SymbolSearch", () => {
  it("shows EODHD hits with the provider note, then no stale alias hits for a new query", async () => {
    stubFetch({
      "/api/market/search": (url) => {
        const q = url.searchParams.get("q") ?? "";
        if (q === "BRK-B" || q === "BRK.B") return envelope([hit("BRK.B", "Berkshire Hathaway Inc")]);
        return envelope([]);
      },
    });
    renderWithProviders(<SymbolSearch onSelect={() => {}} />);
    const input = screen.getByRole("combobox", { name: "Search any listed symbol" });
    fireEvent.change(input, { target: { value: "BRK.B" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("BRK.B"));
    expect(document.body.textContent).toMatch(/EODHD search index/);
    fireEvent.change(input, { target: { value: "ZZZQ" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/No listings match "ZZZQ"/), { timeout: 3000 });
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("labels a yfinance fallback", async () => {
    stubFetch({ "/api/market/search": () => envelope([hit("NVDA", "NVIDIA")], "yfinance", true) });
    renderWithProviders(<SymbolSearch onSelect={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search any listed symbol" }), { target: { value: "nvidia" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/yfinance index · standing in for EODHD/));
  });

  it("never offers the previous query's hits while a new query is in flight (rapid switching)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch({
      "/api/market/search": async (url) => {
        const q = url.searchParams.get("q") ?? "";
        if (q === "AMZN") return envelope([hit("AMZN", "Amazon.com Inc")]);
        await gate;
        return envelope([hit("AAPL", "Apple Inc")]);
      },
    });
    const picked: string[] = [];
    renderWithProviders(<SymbolSearch onSelect={(h) => picked.push(h.symbol)} />);
    const input = screen.getByRole("combobox", { name: "Search any listed symbol" });
    fireEvent.change(input, { target: { value: "AMZN" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("AMZN"));
    fireEvent.change(input, { target: { value: "AAPL" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/Searching…/), { timeout: 2000 });
    expect(screen.queryByRole("option")).toBeNull(); // no stale AMZN row to pick
    fireEvent.keyDown(input, { key: "Enter" });
    expect(picked).toEqual([]);
    release();
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("AAPL"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(picked).toEqual(["AAPL"]);
  });
});
