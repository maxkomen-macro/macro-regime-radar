/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10): unavailable (§1.0), so the page
 * keeps the analyst's own work, kept in this browser (the baskets, their
 * typed weights, Save, Export / Import JSON, + New basket), and every priced
 * part keeps its labels and prints §1.0's reason: the stats, the residual
 * chart, the beta read and the whole hedge. Nothing is asked of the server.
 * The header's Send to Position Monitor carries the basket, which Position
 * Monitor reads as a manual subject (§9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import sample from "../../../fixtures/desk/baskets.json";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { deskFixture } from "../../../fixtures/desk";
import { SAVED_BASKETS_KEY, type SavedBasket } from "./weights";
import { BASKET_UNAVAILABLE } from "./BasketHedgePage";

const BASKETS = (sample as { baskets: SavedBasket[] }).baskets;

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderTab(route = "/desk/basket-hedge") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route },
  );
}

const seed = (list: unknown[] = BASKETS) => localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify(list));
const stored = () => JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]") as SavedBasket[];

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
const hedgeCard = () => screen.getByRole("region", { name: /^Hedge · express or protect/ });
const loaded = async () => {
  await waitFor(() => expect(within(basketCard()).getByLabelText("Weight of NVDA, percent")).toBeInTheDocument());
  return basketCard();
};

describe("Basket & Hedge tab", () => {
  it("is unavailable: the badge, the stats' labels with no number, the reason once per card, and nothing asked of the server (§10, §1.0.2)", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    expect(screen.getByRole("main").querySelector('[data-testid="dk-live"]')).toHaveTextContent("Not yet served");
    // §10: no Desk / Client toggle.
    expect(screen.queryByTestId("dk-view-toggle")).toBeNull();
    expect(b).toHaveTextContent(/3-month\s*—\s*vs NDX · residual\s*—\s*Basket vol\s*—/);
    expect(within(b).getAllByText(BASKET_UNAVAILABLE.reason)).toHaveLength(1);
    expect(b).toHaveTextContent("Is the AI infrastructure bet working?");
    // §1.0.2: the body prints one sentence, the reason.
    expect(b.querySelector("svg")).toBeNull();
    expect(within(b).getByTestId("dk-advanced")).toBeDisabled();
    const h = hedgeCard();
    expect(h).toHaveTextContent("Hedge · express or protect priced off the SPY / QQQ surface");
    const modes = within(within(h).getByRole("group", { name: "Hedge mode" })).getAllByRole("button");
    expect(modes.map((m) => m.textContent)).toEqual(["Protect the basket", "Express the S&P lean", "Neutralize NDX beta"]);
    for (const m of modes) expect(m).toBeDisabled();
    expect(h).toHaveTextContent(/Hedge ratio\s*—\s*Cost of waiting\s*—\s*Roll\s*—/);
    expect(within(h).getAllByText(BASKET_UNAVAILABLE.reason)).toHaveLength(1);
    expect(within(h).queryByRole("radiogroup")).toBeNull();
    expect(within(h).queryByRole("table")).toBeNull();
    expect(within(h).getByTestId("dk-advanced")).toBeDisabled();
    expect(h).toHaveTextContent("not yet served");
    expect(screen.getByRole("main")).not.toHaveTextContent("Awaiting refresh");
    expect(calls.filter((c) => /\/api\/desk\/(basket|hedge)/.test(c))).toEqual([]);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("opens this browser's first basket and writes it in the address; its legs and weights as saved", async () => {
    seed();
    renderTab();
    const b = await loaded();
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(within(b).getByLabelText("Basket")).toHaveValue("local-1");
    expect(b).toHaveTextContent("7 names · saved in this browser");
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22");
    expect(b).toHaveTextContent("Nvidia");
    expect(b).toHaveTextContent("total 100%");
  });

  it("weights as typed: an off total says so; normalize and equal-weight tidy them; a ticker added and one dropped", async () => {
    seed();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    expect(b).toHaveTextContent("total 96%");
    fireEvent.click(within(b).getByRole("button", { name: "Normalize to 100%" }));
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22.9");
    expect(b).toHaveTextContent("total 100%");
    fireEvent.click(within(b).getByRole("button", { name: "Equal-weight" }));
    expect(within(b).getByLabelText("Weight of SMCI, percent")).toHaveValue("14.2");
    const input = within(b).getByLabelText("Add a ticker");
    fireEvent.change(input, { target: { value: "msft" } });
    fireEvent.submit(input.closest("form")!);
    expect(within(b).getByLabelText("Weight of MSFT, percent")).toHaveValue("0");
    expect(b).toHaveTextContent("MSFT added at 0%: type its weight.");
    fireEvent.change(input, { target: { value: "NVDA" } });
    fireEvent.submit(input.closest("form")!);
    expect(b).toHaveTextContent("NVDA is already in the basket.");
    fireEvent.click(within(b).getByRole("button", { name: "Drop NVDA" }));
    expect(within(b).queryByLabelText("Weight of NVDA, percent")).toBeNull();
    expect(b).toHaveTextContent("7 names");
    expect(b).toHaveTextContent("any US-listed name");
    expect(b).not.toHaveTextContent("price history");
  });

  it("Save basket keeps the weights in this browser, only at exactly 100%", async () => {
    seed();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("The weights add to 96%; normalize them to 100% to save.");
    expect(stored()[0].legs.find((l) => l.symbol === "SMCI")?.weight).toBe(12);
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    expect(b).toHaveTextContent("unsaved weights");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser.");
    expect(stored()[0]).toMatchObject({ id: "local-1", name: "AI infrastructure", legs: expect.arrayContaining([{ symbol: "NVDA", name: "Nvidia", weight: 26 }, { symbol: "SMCI", name: "Supermicro", weight: 8 }]) });
    expect(b).toHaveTextContent("kept in this browser only");
  });

  it("storage that is full says so, and nothing is kept", async () => {
    seed();
    renderTab();
    const b = await loaded();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("This browser's storage is full; nothing was saved.");
  });

  it("with no basket saved, says so and starts one with + New basket", async () => {
    renderTab();
    const b = basketCard();
    expect(b).toHaveTextContent("No basket is saved in this browser yet: start one with + New basket, or import a file.");
    // No basket, no chart title, and no total to hold against 100 (no amber dash).
    expect(b).not.toHaveTextContent("bet working");
    expect(b.querySelector(".bh-total b")).not.toHaveAttribute("data-off");
    expect(within(b).queryByLabelText("Basket")).toBeNull();
    expect(within(b).getByLabelText("Add a ticker")).toBeDisabled();
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(basketCard()).toHaveTextContent("0 names · saved in this browser");
    expect(stored()).toEqual([expect.objectContaining({ id: "local-1", name: "New basket 1", legs: [] })]);
  });

  it("+ New basket waits for typed weights, reuses an empty one, and a deleted basket gives way to the next", async () => {
    seed();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Add a ticker"), { target: { value: "MSFT" } });
    fireEvent.submit(within(b).getByLabelText("Add a ticker").closest("form")!);
    // Typed weights are never dropped unseen: a new basket waits for them to be saved or put back.
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    expect(b).toHaveTextContent("This basket has unsaved weights: save them, or put them back, before starting another.");
    fireEvent.click(within(b).getByRole("button", { name: "Drop MSFT" }));
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-2"));
    expect(basketCard()).toHaveTextContent("0 names · saved in this browser");
    // The note about the last basket's ticker does not follow into this one.
    expect(basketCard()).not.toHaveTextContent("MSFT added");
    fireEvent.click(within(basketCard()).getByRole("button", { name: "+ New basket" }));
    expect(stored()).toHaveLength(2);
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Delete this basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(stored().map((x) => x.id)).toEqual(["local-1"]);
  });

  it("a save in another window of this browser reaches the card", async () => {
    seed();
    renderTab();
    const b = await loaded();
    seed([{ ...BASKETS[0], legs: BASKETS[0].legs.map((l) => (l.symbol === "NVDA" ? { ...l, weight: 26 } : l.symbol === "SMCI" ? { ...l, weight: 8 } : l)) }]);
    window.dispatchEvent(new StorageEvent("storage", { key: SAVED_BASKETS_KEY }));
    await waitFor(() => expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("26"));
  });

  it("Import JSON gives a colliding basket a new number and replaces nothing", async () => {
    const mine = { id: "local-1", name: "Mine", legs: [{ symbol: "NVDA", name: null, weight: 50 }, { symbol: "AVGO", name: null, weight: 50 }], saved_at: "2026-09-22T00:00:00Z" };
    seed([mine]);
    renderTab();
    await waitFor(() => expect(within(basketCard()).getByLabelText("Weight of AVGO, percent")).toBeInTheDocument());
    const b = basketCard();
    const theirs = { ...mine, name: "Theirs", legs: [{ symbol: "TSLA", name: null, weight: 100 }] };
    const json = JSON.stringify({ kind: "mrr.desk.baskets", version: 1, baskets: [theirs, { id: "ai-infra", name: "Old served", legs: [{ symbol: "QQQ", name: null, weight: 100 }] }] });
    const file = new File([json], "baskets.json", { type: "application/json" });
    // jsdom's File has no text(); a browser's does.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(json) });
    fireEvent.change(within(b).getByLabelText("Import saved baskets"), { target: { files: [file] } });
    // No basket is served (§10): an old served id comes in as this browser's own.
    await waitFor(() => expect(b).toHaveTextContent("Imported 2 baskets; 2 given a new number, so no basket here was replaced."));
    expect(stored().map((x) => `${x.id} ${x.name}`)).toEqual(["local-1 Mine", "local-2 Theirs", "local-3 Old served"]);
  });

  it("a basket not saved in this browser says so", async () => {
    seed();
    renderTab("/desk/basket-hedge?basket=local-9");
    await waitFor(() => expect(basketCard()).toHaveTextContent("This basket is not saved in this browser; pick another above or start a new one."));
    expect(within(basketCard()).getByLabelText("Basket")).toHaveValue("");
  });

  it("the fixture server prices nothing: basket and hedge are deferred stubs and the price's POST is 405 (§12.0, §12.13)", () => {
    for (const path of ["/api/desk/basket/local-1", "/api/desk/basket/price", "/api/desk/hedge?mode=protect"]) expect(JSON.parse(deskFixture("GET", path)!.body), path).toMatchObject({ status: "awaiting", unavailable: { reason: "basket pricing and option structures not yet defined in the engine." } });
    expect(deskFixture("POST", "/api/desk/basket/price", "{}")!.status).toBe(405);
  });

  it("Send to Position Monitor carries the basket; Position Monitor fills the instrument, or says the basket is not here", async () => {
    seed();
    const { unmount } = renderTab();
    await loaded();
    const send = await screen.findByTestId("dk-act");
    expect(send).toHaveTextContent("Send to Position Monitor →");
    await waitFor(() => expect(send).toHaveAttribute("href", "/desk/position-monitor?basket=local-1"));
    unmount();
    const second = renderTab("/desk/position-monitor?basket=local-1");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("AI infrastructure basket"));
    expect(screen.getByText(/Sent from Basket & Hedge · AI infrastructure/)).toBeInTheDocument();
    second.unmount();
    renderTab("/desk/position-monitor?basket=ai-infra");
    expect(await screen.findByText(/The basket sent from Basket & Hedge \(ai-infra\) is not saved in this browser/)).toBeInTheDocument();
  });
  it("switching baskets never drops typed weights unseen", async () => {
    seed([...BASKETS, { id: "local-2", name: "Grid", legs: [{ symbol: "CEG", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" }]);
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    fireEvent.change(within(b).getByLabelText("Basket"), { target: { value: "local-2" } });
    expect(b).toHaveTextContent("This basket has unsaved weights: save them, or put them back, before opening another.");
    expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1");
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("26");
  });

  it("a saved basket that cannot be read is counted and kept through a save (§1.8)", async () => {
    const bad = { id: "local-9", name: "Broken", legs: [{ symbol: "NVDA", weight: "22" }] };
    seed([...BASKETS, bad]);
    renderTab();
    const b = await loaded();
    expect(b).toHaveTextContent("1 saved basket could not be read; kept in this browser, and in an export, not shown.");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser.");
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")).toContainEqual(bad);
  });
});
