/**
 * Basket & Hedge's options slot holding the PROTOTYPE "Hedge with options" (DESK_FRAME3_SPEC §10, §1.0.3), with the
 * registry drawing the card. The 2026-11-16 release does not draw it (rule 10; ./BasketHedgePage.test.tsx holds the
 * slot's reason); these tests, moved from that file, hold the card where it would stand if it returns.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import sample from "../../../fixtures/desk/baskets.json";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { SAVED_BASKETS_KEY, type SavedBasket } from "./weights";
import { OPTIONS_UNAVAILABLE } from "./BasketHedgeStep";

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

const BASKETS = (sample as { baskets: SavedBasket[] }).baskets;

function renderTab(route = "/desk/basket-hedge") {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const seed = (list: unknown[] = BASKETS) => localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify(list));

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
  localStorage.removeItem(SAVED_BASKETS_KEY);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(SAVED_BASKETS_KEY);
  vi.restoreAllMocks();
});

const basketCard = () => screen.getByRole("region", { name: "Basket" });
const optionsCard = () => screen.getByRole("region", { name: /^Hedge with options/ });
const loaded = async () => {
  await waitFor(() => expect(within(basketCard()).queryByLabelText("Weight of NVDA, percent") ?? within(basketCard()).queryByLabelText("Cap weight of NVDA at the start")).not.toBeNull());
  return basketCard();
};

describe("Hedge with options (PROTOTYPE, §1.0.3): step 3's options slot for the saved basket, the registry drawing it", () => {
  it("the options slot holds the PROTOTYPE, its inputs row from the step's answer; its one control, Advanced, opens something; no badge (moved from the tab's pricing test)", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    await loaded();
    const hedge = await screen.findByRole("region", { name: /^Hedge it/ });
    await waitFor(() => expect(calls).toContain("GET /api/desk/basket/hedge?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=hold&notional=1000000"));
    const h = optionsCard();
    expect(h.closest('[data-slot="hedge-options"]')).not.toBeNull();
    expect(h).toHaveAttribute("data-prototype", "options-hedge");
    await waitFor(() => expect(h).toHaveTextContent(/Top hedge ETF\s*XLK/));
    expect(within(h).getAllByRole("button")).toHaveLength(1);
    expect(within(h).getByTestId("dk-advanced")).toBeEnabled();
    expect(within(h).queryByTestId("dk-live")).toBeNull();
    expect(within(hedge).queryAllByText(OPTIONS_UNAVAILABLE.reason)).toHaveLength(0);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("reads the basket engine's inputs, live, and prices three routes three ways; no badge, its footnote last", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    await loaded();
    const c = await screen.findByRole("region", { name: /^Hedge with options/ });
    expect(c).toHaveAttribute("data-prototype", "options-hedge");
    expect(c).toHaveTextContent("from your basket · live");
    // §12.16's fields, the step's own /basket/hedge answer: notional; top, XLK; its row's hedge ratio and one-year R².
    expect(c).toHaveTextContent(/Notional\s*\$1\.0M\s*AI infrastructure/);
    expect(c).toHaveTextContent(/Top hedge ETF\s*XLK\s*first of 8 by R², ahead of SMH at 0\.68/);
    expect(c).toHaveTextContent(/Hedge ratio\s*1\.38/);
    expect(c).toHaveTextContent(/R²\s*0\.69\s*252 sessions to Sep 23/);
    for (const t of ["(a) Puts on XLK, the top-ranked hedge ETF", "(b) Puts on the three largest names", "(c) An OTC basket put from a dealer"]) expect(within(c).getByRole("heading", { name: t })).toBeInTheDocument();
    expect(within(c).getAllByRole("table")).toHaveLength(3);
    expect(c).toHaveTextContent("strikes moved by it, so 95/85 is 96.4%/89.2% of XLK");
    expect(c).toHaveTextContent(/1M 95 put\s*1\.90%\s*\$19,000\s*basket down 6\.9%\s*\$50,000 · 5\.00%/);
    expect(c).toHaveTextContent("NVDA, AVGO, VRT, each sized to its weight: 52% of the basket");
    expect(c).toHaveTextContent(/1M 95\/85 put spread\s*1\.83%\s*\$18,300\s*basket down 6\.8%\s*\$50,000 · 5\.00%/);
    expect(c).toHaveTextContent("an R² of 0.69 leaves 31% of the basket's variance unhedged");
    expect(within(c).getAllByText("Trade-off:")).toHaveLength(3);
    expect(within(c).queryByTestId("dk-live")).toBeNull();
    const foot = c.querySelector("[data-prototype-foot]")!;
    expect(foot.textContent).toBe("Illustrative values · In production: EODHD option chains for the hedge ETF and the names, and a dealer's quote for the basket put, stored with each basket.");
    fireEvent.click(within(c).getByTestId("dk-advanced"));
    expect(c).toHaveTextContent("vol = XLK's at the strike × 1.38 ÷ √0.69, plus 1.5 points of dealer margin");
    expect(c).toHaveTextContent("the engine's realized basket vol over the same window: 44.1%");
    // Priced in the browser: the card asks nothing of its own; the one /basket/hedge request is the step's.
    expect(calls.filter((x) => x.startsWith("GET /api/desk/basket/hedge"))).toHaveLength(1);
    expect(calls.some((x) => x.startsWith("POST"))).toBe(false);
  });

});
