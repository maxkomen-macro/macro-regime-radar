/**
 * The Options Finder once listed (Options Finder Build Plan §4, the later one-line PR): the flag is on for this file
 * only. The sidebar lists it under Trade, the page drops Preview and noindex, the Options lens and an S&P 500 Event
 * Study link to it, and the command palette goes there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";

vi.mock("./flag", () => ({ OPTIONS_FINDER_LISTED: true, OPTIONS_FINDER_SLUG: "options-finder" }));

import DeskShell from "../DeskShell";
import { DESK_GROUPS } from "../desk-sections";
import CommandPalette from "../../shell/CommandPalette";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import study from "../../../fixtures/desk/study.json";
import technicals from "../../../fixtures/desk/technicals.json";
import type { StudyResponse } from "../data/types";
import { StudyFinderLink } from "./entry";
import { LensFinderLink } from "./lens-link";

function Loc() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Options Finder, listed", () => {
  it("sits in the sidebar under Trade, between Basket & Hedge and Position Monitor, without Preview or noindex", async () => {
    expect(DESK_GROUPS.find((g) => g.id === "trade")?.pages.map((p) => p.slug)).toEqual(["basket-hedge", "options-finder", "position-monitor"]);
    renderWithProviders(
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>,
      { route: "/desk/options-finder" },
    );
    await screen.findByRole("heading", { level: 1, name: "Options Finder" });
    expect(screen.getByRole("link", { name: /Options Finder/ })).toHaveAttribute("href", "/desk/options-finder");
    expect(screen.queryByTestId("of-preview")).toBeNull();
    expect(document.head.querySelector('meta[name="robots"][data-options-finder]')).toBeNull();
  });

  it("the Options lens links to the Finder with the ticker filled in", () => {
    render(
      <MemoryRouter>
        <LensFinderLink symbol="aapl" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Find a contract for a view →" })).toHaveAttribute("href", "/desk/options-finder?symbol=AAPL");
  });

  it("an S&P 500 study links to SPY at its close moved by the median, once SPY's close is served", async () => {
    const { calls } = stubDesk({ "/api/desk/technicals": (u) => ({ ...technicals, symbol: u.searchParams.get("symbol"), price: 660.12, date: "2026-09-23" }) });
    renderWithProviders(<StudyFinderLink study={study as unknown as StudyResponse} />, { route: "/desk/event-study" });
    const p = await screen.findByTestId("study-finder-link");
    const s = study as unknown as StudyResponse;
    const median = (s.horizons ?? []).find((x) => x.h === s.selected_horizon)?.median as number;
    const target = (660.12 * Math.exp(median)).toFixed(2);
    expect(p).toHaveTextContent(`SPY at $${target}: its Sep 23, 2026 close $660.12 moved by the study's median`);
    const href = screen.getByRole("link", { name: "Express this view with options →" }).getAttribute("href") ?? "";
    expect(href.startsWith("/desk/options-finder?symbol=SPY&direction=up&target=")).toBe(median > 0);
    expect(calls.some((c) => c.startsWith("GET /api/desk/technicals?symbol=SPY"))).toBe(true);
  });

  it("the command palette goes to the Finder", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <div id="shell-content">
          <CommandPalette open={open} onClose={() => setOpen(false)} />
          <Loc />
        </div>
      );
    }
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]}>
        <Routes>
          <Route path="*" element={<Harness />} />
        </Routes>
      </MemoryRouter>,
    );
    const input = await screen.findByLabelText("Filter destinations");
    fireEvent.change(input, { target: { value: "options finder" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/options-finder"));
  });
});
