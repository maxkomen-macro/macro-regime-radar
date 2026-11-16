/**
 * Technicals' vol column as the PROTOTYPE (DESK_FRAME3_SPEC §1.0.3), with the registry drawing the card. The
 * 2026-11-16 release does not draw it (rule 10; ./TechnicalsPage.test.tsx holds the page as served); these tests,
 * moved from that file, hold the card where it would stand if it returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";

vi.mock("../prototypes/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../prototypes/registry")>();
  const rows = real.PROTOTYPES.map((p) => ({ ...p, shown: true }));
  const prototype = (id: string) => {
    const e = rows.find((p) => p.id === id);
    if (!e) throw new Error(`no PROTOTYPE registry row for ${id}`);
    return e;
  };
  return { ...real, PROTOTYPES: rows, prototype, prototypeShown: (id: string) => prototype(id).shown, shownPrototypes: () => rows };
});

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/technicals" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the vol column as the PROTOTYPE, with the registry drawing it (§1.0.3)", () => {
  it("/technicals serves the vol block awaiting and the sectors block ready: the vol column is the PROTOTYPE (§1.0.3), the sector card reads its bars", async () => {
    renderTab();
    // The cards remount from their loading state to the answered one: query them afresh.
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(vol).not.toHaveTextContent("needs stored SPY option snapshots");
    expect(within(vol).queryByTestId("dk-live")).toBeNull();
    expect(vol).toHaveTextContent("Illustrative values · In production: daily SPY chain snapshots from the EODHD options add-on, stored and versioned.");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    const sect = screen.getByRole("region", { name: /^Sector leadership/ });
    await waitFor(() => expect(within(sect).getByRole("list", { name: /top three/ })).toBeInTheDocument());
    expect(within(sect).getByTestId("dk-advanced")).toBeEnabled();
  });

  it("the PROTOTYPE vol column prints its illustrative numbers, and its Advanced opens the assumed volatilities (§1.0.3)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("+6.8 pts");
    // desk/pdf-polish 3a: "richer", never "dearer".
    expect(vol).toHaveTextContent("Puts are 6.8 vol points richer than calls.");
    expect(vol).not.toHaveTextContent("dearer");
    // Black-Scholes at 19.2% and 12.4% vol, 30 days: the 25-delta strikes and what each costs.
    expect(vol).toHaveTextContent(/25Δ put\s*19\.2%\s*96\.7%\s*0\.84%/);
    expect(vol).toHaveTextContent(/25Δ call\s*12\.4%\s*102\.7%\s*0\.52%/);
    expect(vol).toHaveTextContent("15.4 vs 11.9");
    expect(vol).toHaveTextContent("74th percentile of two years");
    expect(vol).toHaveTextContent("Rising since June.");
    const adv = within(vol).getByTestId("dk-advanced");
    expect(adv).toBeEnabled();
    fireEvent.click(adv);
    expect(vol).toHaveTextContent("Black-Scholes on SPY, 30 days to expiry, a 4.10% rate and a 1.20% dividend yield");
    expect(vol).toHaveTextContent("78 of 105");
  });

  it("the vol block served awaiting: the PROTOTYPE stands in its place (§1.0.3), without the reason or a badge", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).not.toHaveTextContent("needs stored SPY option snapshots");
    expect(within(vol).queryByTestId("dk-live")).toBeNull();
  });
});
