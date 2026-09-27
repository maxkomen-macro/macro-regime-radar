/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10): the analyst's own work is kept in
 * this browser (the baskets, their typed weights, Save, Export / Import JSON,
 * + New basket), and a saved basket at exactly 100% is priced by
 * /basket/price (§12.15): step 2, how the basket trades, from the fixture's
 * real answer. The hedge's option structures stay unavailable (§1.0.2). The
 * header's Send to Position Monitor carries the basket, which Position
 * Monitor reads as a manual subject (§9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import sample from "../../../fixtures/desk/baskets.json";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { deskFixture } from "../../../fixtures/desk";
import basketPrice from "../../../fixtures/desk/basket-price.json";
import basketHedge from "../../../fixtures/desk/basket-hedge.json";
import { SAVED_BASKETS_KEY, type SavedBasket } from "./weights";
import { OPTIONS_UNAVAILABLE } from "./BasketHedgeStep";

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
const optionsCard = () => screen.getByRole("region", { name: /^Hedge with options/ });
const loaded = async () => {
  await waitFor(() => expect(within(basketCard()).getByLabelText("Weight of NVDA, percent")).toBeInTheDocument());
  return basketCard();
};

describe("Basket & Hedge tab", () => {
  it("prices the saved basket: step 2 from /basket/price, step 3 from /basket/hedge, its badge; the options slot unavailable (§10, §12.15, §12.16, §1.0.2)", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    await loaded();
    const step = await screen.findByRole("region", { name: /^How the basket trades/ });
    const index = await within(step).findByRole("region", { name: /^Basket index/ });
    await waitFor(() => expect(index).toHaveTextContent("Up 113.8% since Mar 28, 2025 and +8.6% over the last year; above both its 50- and 200-day averages since Sep 21."));
    expect(index).toHaveTextContent(/Index\s*213\.8/);
    expect(index).toHaveTextContent("Base 100 on Mar 28, 2025, the first session every name has a price (CRWV's first close).");
    expect(within(index).getByRole("img", { name: /^The basket index with its 50-day and 200-day averages, 1Y/ })).toBeInTheDocument();
    // The fixture's closes are Yahoo's, and the badge says whose (the API's are EODHD's).
    expect(screen.getByRole("main").querySelector('[data-testid="dk-live"]')).toHaveTextContent("Live · Yahoo · Sep 23");
    expect(within(step).getByRole("region", { name: /^Momentum and risk/ })).toHaveTextContent(/RSI \(14\)\s*51/);
    expect(within(step).getByRole("region", { name: /^Against the Nasdaq and the S&P/ })).toHaveTextContent("over a year it has moved 1.71× QQQ, correlation 0.77");
    expect(within(step).getByRole("region", { name: /^Contribution to return/ })).toHaveTextContent("VRT added 33.0 of the index's 113.8 points since Mar 28; SMCI added the least, 2.5.");
    expect(within(step).getByRole("region", { name: /^Concentration/ })).toHaveTextContent(/Effective names\s*6\.1/);
    expect(within(step).getByRole("region", { name: /^Liquidity/ })).toHaveTextContent("the slowest name to trade is CEG");
    // The range chips move every chart of step 2.
    fireEvent.click(within(index).getByRole("button", { name: "6M" }));
    expect(within(step).getByRole("region", { name: /^Against the Nasdaq and the S&P/ })).toHaveTextContent("Since Mar 24, 2026 the basket is +14.4%");
    expect(calls).toContain("GET /api/desk/basket/price?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=hold&notional=1000000");
    // §10: no Desk / Client toggle.
    expect(screen.queryByTestId("dk-view-toggle")).toBeNull();
    // Step 3 (§12.16): the ETFs ranked by one-year R², the top pick marked, the stress test.
    const hedge = await screen.findByRole("region", { name: /^Hedge it/ });
    const etfs = within(hedge).getByRole("region", { name: /^Hedge with an ETF/ });
    await waitFor(() => expect(etfs).toHaveTextContent("XLK fits the basket best (R² 0.69 over a year): short $1,384,473 of it against $1,000,000 and the basket's volatility falls from 44% to 25%, 44% less."));
    const rows = within(etfs).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector(".bh-etf-sym")?.textContent)).toEqual(["XLK", "SMH", "SOXX", "QQQ", "SPY", "IWM", "IGV", "XLU"]);
    expect(rows[0]).toHaveAttribute("aria-current", "true");
    expect(rows[0]).toHaveTextContent("top pick");
    const stress = within(hedge).getByRole("region", { name: /^Stress test/ });
    expect(stress).toHaveTextContent("With the table's hedge, short $1,384,473 of XLK: if QQQ falls 10% the basket loses $170,542 unhedged and makes $5,810 hedged; if SPY falls 10% the basket loses $238,851 unhedged and makes $1,924 hedged.");
    // Codex R-15: the card names the short it holds, the table's top row's.
    expect(stress).toHaveTextContent("Hedged holds the short the table above recommends, $1,384,473 of XLK (1.38× the basket), as it is under both shocks.");
    expect(calls).toContain("GET /api/desk/basket/hedge?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=hold&notional=1000000");
    // The options slot is plain (Codex R-14): its title, badge and why it is not served; no control that cannot act.
    const h = optionsCard();
    expect(h).toHaveTextContent("Hedge with options priced off the SPY / QQQ surface");
    expect(h.querySelector('[data-slot="hedge-options"]')).not.toBeNull();
    expect(within(h).getAllByText(OPTIONS_UNAVAILABLE.reason)).toHaveLength(1);
    expect(within(h).queryAllByRole("button")).toHaveLength(0);
    expect(within(h).queryByTestId("dk-advanced")).toBeNull();
    expect(within(h).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("is three numbered steps, top to bottom; the basket card leads with its sentence and shows each name's weight now and return (§10)", async () => {
    seed();
    renderTab();
    const b = await loaded();
    const steps = screen.getAllByRole("heading", { level: 2 }).filter((h) => h.classList.contains("bh-step-title"));
    expect(steps.map((h) => h.textContent)).toEqual([
      "1Build the basket name it, add names, weight them; Save computes everything below",
      "2How the basket trades technicals against the Nasdaq and the S&P, contribution, concentration, liquidity",
      "3Hedge it the closest ETF and what it does in a 10% fall, then options",
    ]);
    await waitFor(() => expect(b).toHaveTextContent("AI infrastructure holds 7 names, the largest NVDA at 22%, bought and held, $1,000,000: up 113.8% since Mar 28, 2025, the first session every name has a price (CRWV's first close)."));
    const nvda = within(b).getByLabelText("Weight of NVDA, percent").closest("tr")!;
    expect(nvda).toHaveTextContent(/NVDA\s*Nvidia\s*21\.2%\s*\+106\.1%/);
    // Every card of steps 2 and 3 leads with its answer in one sentence.
    for (const card of document.querySelectorAll(".bh-trades .dk-card, .bh-etfs, .bh-stress")) expect(card.querySelector(".bh-lead"), card.querySelector("h3")?.textContent ?? "").not.toBeNull();
  });

  it("Codex R-04: a leg without 20 sessions of dollar volume leaves the basket's days to trade unserved, and says why", async () => {
    seed();
    const legsKey = "NVDA:22,AVGO:16,VRT:14,CRWV:12,ANET:12,CEG:12,SMCI:12|hold|1000000";
    const answer = JSON.parse(JSON.stringify((basketPrice as { answers: Record<string, Record<string, unknown>> }).answers[legsKey]));
    const smci = (answer.legs as { symbol: string; adv_usd: number | null; days_to_trade: number | null; adv_missing: number }[]).find((l) => l.symbol === "SMCI")!;
    Object.assign(smci, { adv_usd: null, days_to_trade: null, adv_missing: 2 });
    answer.liquidity = { ...answer.liquidity, basket_days: null, binding: null, missing: ["SMCI"], reason: "SMCI has no dollar volume on every one of the 20 sessions from 2026-08-26 to 2026-09-23; the basket's figure needs every name's" };
    stubDesk({ "/api/desk/basket/price": () => answer });
    renderTab();
    await loaded();
    const liq = await screen.findByRole("region", { name: /^Liquidity/ });
    await waitFor(() => expect(liq).toHaveTextContent("The basket's days to trade are not served: SMCI has no dollar volume on every one of the 20 sessions"));
    expect(liq).not.toHaveTextContent("the slowest name to trade is");
    expect(within(liq).getByRole("rowheader", { name: "SMCI" }).closest("tr")).toHaveTextContent(/SMCI\s*—/);
  });

  it("Codex R-08: each step shows its own answer's date, and a hedge from another session is disclosed", async () => {
    seed();
    const legsKey = "NVDA:22,AVGO:16,VRT:14,CRWV:12,ANET:12,CEG:12,SMCI:12|hold|1000000";
    const hedgeAnswer = { ...(basketHedge as { answers: Record<string, Record<string, unknown>> }).answers[legsKey], prices_as_of: "2026-09-22" };
    stubDesk({ "/api/desk/basket/hedge": () => hedgeAnswer });
    renderTab();
    await loaded();
    const step2 = await screen.findByRole("region", { name: /^How the basket trades/ });
    const step3 = screen.getByRole("region", { name: /^Hedge it/ });
    await waitFor(() => expect(step3).toHaveTextContent("The hedge reads prices through Sep 22, 2026; the basket above reads them through Sep 23, 2026."));
    expect(within(step2).getAllByTestId("dk-live")[0]).toHaveTextContent("Live · Yahoo · prices Sep 23");
    expect(within(step3).getAllByTestId("dk-live")[0]).toHaveTextContent("Live · Yahoo · prices Sep 22");
    // R-09: the stress footnote names its window.
    expect(within(step3).getByRole("region", { name: /^Stress test/ })).toHaveTextContent("Betas fitted on the 252 sessions from Sep 22, 2025 to Sep 23, 2026 (one year)");
  });

  it("Codex R-10: Save refuses a leg at 0%, which the API would refuse", async () => {
    seed();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "0" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "34" } });
    expect(b).toHaveTextContent("total 100%");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("SMCI's weight is 0%: every name needs a weight above 0% to save.");
    expect(stored()[0].legs.find((l) => l.symbol === "SMCI")?.weight).toBe(12);
  });

  it("Codex R-12: a ticker check answered after another basket was opened adds nothing to it", async () => {
    // Codex's repro: start adding QQQ to basket A, hold the check, open basket B (SPY), then let the check answer.
    seed([...BASKETS, { id: "local-2", name: "Broad", legs: [{ symbol: "SPY", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" }]);
    let answer: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => (answer = resolve));
    stubDesk({ "/api/market/candles/QQQ": () => held });
    renderTab();
    const b = await loaded();
    const input = within(b).getByLabelText("Add a ticker");
    fireEvent.change(input, { target: { value: "QQQ" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(b).toHaveTextContent("Checking QQQ…"));
    fireEvent.change(within(b).getByLabelText("Basket"), { target: { value: "local-2" } });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-2"));
    answer({ status: 200, body: { bars: [{ ts: "2026-09-23T00:00:00Z" }] } });
    await waitFor(() => expect(within(basketCard()).getByLabelText("Weight of SPY, percent")).toHaveValue("100"));
    await new Promise((r) => setTimeout(r, 50));
    expect(within(basketCard()).queryByLabelText("Weight of QQQ, percent")).toBeNull();
    expect(basketCard()).not.toHaveTextContent("unsaved changes");
  });

  it("asks nothing for a basket whose weights are not at 100%, and says what prices it", async () => {
    seed([{ ...BASKETS[0], legs: BASKETS[0].legs.map((l, i) => (i === 0 ? { ...l, weight: 20 } : l)) }]);
    const { calls } = stubDesk();
    renderTab();
    await loaded();
    const step = await screen.findByRole("region", { name: /^How the basket trades/ });
    expect(step).toHaveTextContent("Save the basket with its weights at exactly 100% to price it.");
    expect(calls.filter((c) => c.includes("/basket/price"))).toEqual([]);
  });

  it("a refused price says the server's words and offers another try", async () => {
    seed();
    stubDesk({ "/api/desk/basket/price": deskError(422, "unknown_symbol", { message: "SMCI: No listing found for 'SMCI' on EODHD." }) });
    renderTab();
    await loaded();
    const step = await screen.findByRole("region", { name: /^How the basket trades/ });
    await waitFor(() => expect(step).toHaveTextContent("This basket could not be priced: SMCI: No listing found for 'SMCI' on EODHD."));
    expect(within(step).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(step).getByRole("region", { name: /^Basket index/ })).toHaveTextContent("Awaiting refresh");
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
    const { calls } = stubDesk({ "/api/market/candles/MSFT": () => ({ status: 200, body: { symbol: "MSFT", interval: "1d", bars: [{ ts: "2026-09-23T00:00:00Z", close: 1 }] } }) });
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
    // Checked against the price endpoint; the weights were equal, so they stay equal with MSFT in.
    await waitFor(() => expect(within(b).getByLabelText("Weight of MSFT, percent")).toHaveValue("12.5"));
    expect(calls).toContain("GET /api/market/candles/MSFT?range=2Y");
    expect(b).toHaveTextContent("MSFT added; the 8 names are at equal weight. Save to price it.");
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("12.5");
    // Codex R-10: a name added to typed weights re-spreads them to equal too; it never comes in at 0%.
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "20" } });
    fireEvent.change(input, { target: { value: "AAPL" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(within(b).getByLabelText("Weight of AAPL, percent")).toHaveValue("11.1"));
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("11.2");
    expect(b).toHaveTextContent("AAPL added; the 9 names are at equal weight.");
    fireEvent.click(within(b).getByRole("button", { name: "Drop AAPL" }));
    fireEvent.change(input, { target: { value: "NVDA" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(b).toHaveTextContent("NVDA is already in the basket."));
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
    expect(b).toHaveTextContent("unsaved changes");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser; priced below.");
    // Saved as the exact decimals typed (Codex R-20), with the method and the notional (desk/books).
    expect(stored()[0]).toMatchObject({ id: "local-1", name: "AI infrastructure", method: "hold", notional: 1_000_000, legs: expect.arrayContaining([{ symbol: "NVDA", name: "Nvidia", weight: "26" }, { symbol: "SMCI", name: "Supermicro", weight: "8" }]) });
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

  it("a browser with no basket store starts with the AI Infrastructure 10 preset, priced (desk/books)", async () => {
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    expect(within(b).getByLabelText("Basket")).toHaveDisplayValue("AI Infrastructure 10");
    expect(b).toHaveTextContent("10 names · saved in this browser");
    for (const s of ["NVDA", "AVGO", "AMD", "TSM", "MU", "ANET", "VRT", "CEG", "CRWV", "NBIS"]) expect(within(b).getByLabelText(`Weight of ${s}, percent`)).toHaveValue("10");
    expect(within(b).getByLabelText("Notional, dollars")).toHaveValue("1,000,000");
    expect(within(b).getByLabelText("Method")).toHaveDisplayValue("Buy-and-hold");
    const step = await screen.findByRole("region", { name: /^How the basket trades/ });
    await waitFor(() => expect(within(step).getByRole("region", { name: /^Basket index/ })).toHaveTextContent("since Mar 28, 2025"));
    expect(calls).toContain("GET /api/desk/basket/price?legs=NVDA%3A10%2CAVGO%3A10%2CAMD%3A10%2CTSM%3A10%2CMU%3A10%2CANET%3A10%2CVRT%3A10%2CCEG%3A10%2CCRWV%3A10%2CNBIS%3A10&method=hold&notional=1000000");
    expect(stored()).toHaveLength(1);
  });

  it("with no basket saved, says so and starts one with + New basket, named", async () => {
    seed([]);
    renderTab();
    const b = basketCard();
    expect(b).toHaveTextContent("No basket is saved in this browser yet: start one with + New basket, or import a file.");
    // No basket, no chart title, and no total to hold against 100 (no amber dash).
    expect(b).not.toHaveTextContent("bet working");
    expect(b.querySelector(".bh-total b")).not.toHaveAttribute("data-off");
    expect(within(b).queryByLabelText("Basket")).toBeNull();
    expect(within(b).getByLabelText("Add a ticker")).toBeDisabled();
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    fireEvent.click(within(b).getByRole("button", { name: "Create" }));
    expect(b).toHaveTextContent("Name the basket first.");
    fireEvent.change(within(b).getByLabelText("Name of the new basket"), { target: { value: "  Grid names " } });
    fireEvent.click(within(b).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(basketCard()).toHaveTextContent("0 names · saved in this browser");
    expect(stored()).toEqual([expect.objectContaining({ id: "local-1", name: "Grid names", legs: [], method: "hold", notional: 1_000_000 })]);
  });

  it("+ New basket waits for unsaved changes; a basket is named, renamed, and deleted after a second click", async () => {
    seed();
    stubDesk({ "/api/market/candles/MSFT": () => ({ status: 200, body: { bars: [{ ts: "2026-09-23T00:00:00Z" }] } }) });
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Add a ticker"), { target: { value: "MSFT" } });
    fireEvent.submit(within(b).getByLabelText("Add a ticker").closest("form")!);
    await waitFor(() => expect(within(b).getByLabelText("Weight of MSFT, percent")).toBeInTheDocument());
    // Typed weights are never dropped unseen: a new basket waits for them to be saved or put back.
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    expect(b).toHaveTextContent("This basket has unsaved changes: save them, or put them back, before starting another.");
    // Adding MSFT re-spread every weight (Codex R-10), so dropping it does not put them back: save them instead.
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser; priced below.");
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    fireEvent.change(within(b).getByLabelText("Name of the new basket"), { target: { value: "AI infrastructure" } });
    fireEvent.click(within(b).getByRole("button", { name: "Create" }));
    expect(b).toHaveTextContent("A basket named “AI infrastructure” is already saved here.");
    fireEvent.change(within(b).getByLabelText("Name of the new basket"), { target: { value: "Power" } });
    fireEvent.click(within(b).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-2"));
    expect(basketCard()).toHaveTextContent("0 names · saved in this browser");
    // The note about the last basket's ticker does not follow into this one.
    expect(basketCard()).not.toHaveTextContent("MSFT added");
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Rename" }));
    fireEvent.change(within(basketCard()).getByLabelText("Basket name"), { target: { value: "Power and cooling" } });
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Save name" }));
    await waitFor(() => expect(within(basketCard()).getByLabelText("Basket")).toHaveDisplayValue("Power and cooling"));
    expect(stored().map((x) => `${x.id} ${x.name}`)).toEqual(["local-1 AI infrastructure", "local-2 Power and cooling"]);
    // Deleting asks once more, and can be kept.
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Delete this basket" }));
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Keep it" }));
    expect(stored()).toHaveLength(2);
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Delete this basket" }));
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Delete “Power and cooling” from this browser" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(stored().map((x) => x.id)).toEqual(["local-1"]);
  });

  it("the notional and the method are saved with the basket and priced with it", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Notional, dollars"), { target: { value: "abc" } });
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("The notional is not a dollar amount above $0; fix it to save.");
    fireEvent.change(within(b).getByLabelText("Notional, dollars"), { target: { value: "$2,500,000" } });
    fireEvent.change(within(b).getByLabelText("Method"), { target: { value: "monthly" } });
    expect(b).toHaveTextContent("back to the target weights at each month's last session");
    expect(b).toHaveTextContent("unsaved changes");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(stored()[0]).toMatchObject({ method: "monthly", notional: 2_500_000 });
    await waitFor(() => expect(calls).toContain("GET /api/desk/basket/price?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=monthly&notional=2500000"));
  });

  it("?add=XYZ (from Technicals) adds the ticker to the open basket, checked; the address forgets it", async () => {
    const { calls } = stubDesk({ "/api/market/candles/ORCL": () => ({ status: 200, body: { bars: [{ ts: "2026-09-23T00:00:00Z" }] } }) });
    renderTab("/desk/basket-hedge?add=orcl");
    const b = await loaded();
    await waitFor(() => expect(within(b).getByLabelText("Weight of ORCL, percent")).toBeInTheDocument());
    // The preset's weights were equal, so all eleven are.
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("9.1");
    expect(b).toHaveTextContent("ORCL added; the 11 names are at equal weight. Save to price it.");
    expect(b).toHaveTextContent("unsaved changes");
    expect(calls).toContain("GET /api/market/candles/ORCL?range=2Y");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
  });

  it("a ticker the price endpoint does not list is not added, in its words", async () => {
    seed();
    stubDesk({ "/api/market/candles/ZZZZ": () => ({ status: 404, body: { detail: "No listing found for 'ZZZZ' on EODHD.", kind: "unknown_symbol", provider: "api", retryable: false } }) });
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Add a ticker"), { target: { value: "zzzz" } });
    fireEvent.submit(within(b).getByLabelText("Add a ticker").closest("form")!);
    await waitFor(() => expect(b).toHaveTextContent("ZZZZ was not added: No listing found for 'ZZZZ' on EODHD."));
    expect(within(b).queryByLabelText("Weight of ZZZZ, percent")).toBeNull();
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

  it("the fixture server prices the baskets it carries, no other; the hedge and a stored basket are stubs; the price's POST is 405 (§12.0, §12.13, §12.15)", () => {
    expect(JSON.parse(deskFixture("GET", "/api/desk/basket/local-1")!.body)).toMatchObject({ status: "awaiting", unavailable: { reason: "Baskets are kept in this browser; there is no server basket store." } });
    expect(JSON.parse(deskFixture("GET", "/api/desk/hedge?mode=protect")!.body)).toMatchObject({ status: "awaiting", unavailable: { reason: "option structures for a basket not yet defined in the engine." } });
    expect(JSON.parse(deskFixture("GET", "/api/desk/basket/hedge?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=hold&notional=1000000")!.body)).toMatchObject({ status: "ready", data: { top: "XLK" } });
    const ready = JSON.parse(deskFixture("GET", "/api/desk/basket/price?legs=NVDA%3A22%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A12&method=hold&notional=1000000")!.body);
    expect(ready).toMatchObject({ status: "ready", data: { start: "2025-03-28", start_binding: ["CRWV"], provider: "Yahoo" } });
    const other = deskFixture("GET", "/api/desk/basket/price?legs=NVDA%3A100")!;
    expect(other.status).toBe(404);
    expect(JSON.parse(other.body)).toMatchObject({ status: "error", error: { code: "no fixture for this basket" } });
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
    expect(b).toHaveTextContent("This basket has unsaved changes: save them, or put them back, before opening another.");
    expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1");
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("26");
  });

  it("a saved basket that cannot be read is counted and kept through a save (§1.8)", async () => {
    const bad = { id: "local-9", name: "Broken", legs: [{ symbol: "NVDA", weight: "twenty-two" }] };
    seed([...BASKETS, bad]);
    renderTab();
    const b = await loaded();
    expect(b).toHaveTextContent("1 saved basket could not be read; kept in this browser, and in an export, not shown.");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser; priced below.");
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")).toContainEqual(bad);
  });
});

describe("Hedge with options (PROTOTYPE, §1.0.3): the hedge's step 3 for the basket open here", () => {
  it("reads the basket engine's inputs, live, and prices three routes three ways; no badge, its footnote last", async () => {
    seed();
    const { calls } = stubDesk();
    renderTab();
    await loaded();
    const c = await screen.findByRole("region", { name: /^Hedge with options/ });
    expect(c).toHaveAttribute("data-prototype", "options-hedge");
    expect(c).toHaveTextContent("from your basket · live");
    // §12.15's fields (desk/books /basket/hedge): notional; top, XLK; its row's hedge ratio and one-year R².
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
    // Priced in the browser from the prototype's fixtures: nothing asked of the server.
    expect(calls.filter((x) => /\/api\/desk\/(basket|hedge)/.test(x))).toEqual([]);
  });

  it("a basket the engine has no answer for: the inputs await a refresh and nothing is priced", async () => {
    seed([{ ...BASKETS[0], legs: BASKETS[0].legs.map((l) => (l.symbol === "SMCI" ? { ...l, weight: 8 } : l.symbol === "NVDA" ? { ...l, weight: 26 } : l)) }]);
    renderTab();
    await loaded();
    const c = await screen.findByRole("region", { name: /^Hedge with options/ });
    expect(c).toHaveTextContent(/Notional\s*Awaiting refresh/);
    expect(c).toHaveTextContent("Nothing is priced until the basket's inputs arrive.");
    expect(within(c).queryAllByRole("table")).toHaveLength(0);
    expect(within(c).getByTestId("dk-advanced")).toBeDisabled();
    expect(c.querySelector("[data-prototype-foot]")).not.toBeNull();
  });

  it("with no basket open, no step 3", async () => {
    renderTab();
    await waitFor(() => expect(basketCard()).toHaveTextContent("No basket is saved in this browser yet"));
    expect(screen.queryByRole("region", { name: /^Hedge with options/ })).toBeNull();
  });
});
