/**
 * Basket & Hedge (DESK_FRAME3_SPEC §10, §12.12) against the fixtures: the
 * basket's stats, legs, residual chart and reads; the weights as the analyst
 * types them (priced by POST /basket/price, saved in this browser, reverted,
 * exported); the hedge's three modes, its three structures and the picked
 * one's numbers; a position or a study as the hedge's subject; the labels
 * alone while an answer is on its way, Awaiting refresh only when one did not
 * come; and the header's Send to Position Monitor, which Position Monitor reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import basketPrice from "../../../fixtures/desk/basket-price.json";
import basket from "../../../fixtures/desk/basket.json";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { deskFixture } from "../../../fixtures/desk";

import { SAVED_BASKETS_KEY } from "./weights";
import { maxLossWords } from "./BasketHedgePage";

/** The fixture server's answer for a URL, with some fields replaced. */
function deskFixtureBody(u: URL, over: Record<string, unknown>) {
  const r = deskFixture("GET", `${u.pathname}${u.search}`)!;
  const env = JSON.parse(r.body) as { data: Record<string, unknown> };
  return r.status === 200 ? { ...env, data: { ...env.data, ...over } } : { status: r.status, body: env };
}

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
  await waitFor(() => expect(basketCard()).toHaveTextContent("+12.7%"));
  return basketCard();
};

describe("the hedge's words (Codex R-06)", () => {
  it("max loss states its own range and what bounds it, per $100 of basket; without them it says nothing it cannot back", () => {
    expect(maxLossWords({ max_loss: -0.1398, protected_range: { ndx_from: -0.05, ndx_to: -0.1, basis: "strikes" } })).toBe("max loss $14.0 per $100 of basket, NDX −5% to −10% (its strikes)");
    expect(maxLossWords({ max_loss: -0.2284, protected_range: { ndx_from: -0.05, ndx_to: -0.2, basis: "table_floor" } })).toBe("max loss $22.8 per $100 of basket, NDX −5% to −20% (table floor)");
    expect(maxLossWords({ max_loss: 0.004, protected_range: { ndx_from: -0.05, ndx_to: -0.1, basis: "strikes" } })).toBe("no loss from NDX −5% to −10% (its strikes)");
    expect(maxLossWords({ max_loss: -0.14, protected_range: undefined })).toBe("max loss awaiting refresh");
    expect(maxLossWords({ max_loss: -0.14, protected_range: { ndx_from: -0.05, ndx_to: -0.1 } })).toBe("max loss awaiting refresh");
    expect(maxLossWords({ max_loss: null, protected_range: { ndx_from: -0.05, ndx_to: -0.1, basis: "strikes" } })).toBeNull();
  });
});

describe("Basket & Hedge tab", () => {
  it("the basket: stats, seven legs at 100%, the residual chart and its reads", async () => {
    renderTab();
    const b = await loaded();
    expect(b).toHaveTextContent(/3-month\s*\+12\.7%\s*vs NDX \+9\.1%/);
    expect(b).toHaveTextContent(/vs NDX · residual\s*−1\.9%\s*last 60 sessions · falsifies at −4%/);
    expect(b).toHaveTextContent(/Basket vol\s*41%\s*vs NDX 24% · 1\.7× as jumpy/);
    expect(b).toHaveTextContent("7 names · rebalanced monthly");
    expect(within(b).getByLabelText("Basket")).toHaveValue("ai-infra");
    const rows = within(within(b).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent?.replace(/[%×]/g, "").trim())).toEqual(["NVDANvidia", "AVGOBroadcom", "VRTVertiv", "CRWVCoreWeave", "ANETArista", "CEGConstellation", "SMCISupermicro"]);
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22");
    expect(b).toHaveTextContent("total 100%");
    expect(b).toHaveTextContent("Is the AI-infra bet working? · basket minus 1.6 × Nasdaq, last 60 sessions");
    expect(within(b).getByRole("img")).toHaveAccessibleName(/AI-infra basket minus 1\.6 × Nasdaq, the last 60 sessions, now −1\.9%; the position comes off at −4%/);
    expect(b).toHaveTextContent("Slipped from +0.8% to −1.9% over the month: still 2.1 points above the line, but drifting toward it.");
    expect(b).toHaveTextContent("Beta to NDX: 1.6. Half of this basket's move is just Nasdaq.");
    await waitFor(() => expect(screen.getByTestId("dk-live")).toHaveTextContent("Live · prices Sep 22 · options via EODHD"));
  });

  it("the hedge: Protect by default, the served recommendation picked, its numbers and scenarios, the subject named", async () => {
    const { calls } = stubDesk();
    renderTab();
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("$62.4 per $100"));
    const h = hedgeCard();
    expect(calls).toContain("GET /api/desk/hedge?mode=protect&basket=ai-infra");
    expect(h).toHaveTextContent("priced off the SPY / QQQ surface of Sep 22");
    expect(h).toHaveTextContent("Priced for AI infrastructure basket");
    expect(within(h).getByRole("button", { name: "Protect the basket" })).toHaveAttribute("aria-pressed", "true");
    const radios = within(h).getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-label"))).toEqual(["Put spread on QQQ · 1 month · 5% / 10% down", "Collar on QQQ · 1 month · sell 5% up, buy 5% down", "Outright QQQ puts · 1 month · 5% down"]);
    expect(radios[0]).toBeChecked();
    expect(h).toHaveTextContent("costs 1.1% of basket");
    // Breakeven and max loss as §12.13 defines them, from the structure's payoffs (Codex R-06).
    expect(h).toHaveTextContent("breaks even at basket +1.1% · max loss $14.0 per $100 of basket, NDX −5% to −10% (its strikes)");
    expect(h).toHaveTextContent(/Hedge ratio\s*\$62.4 per \$100\s*QQQ notional · beta-adjusted, 1\.6 × 0\.39 delta/);
    expect(h).toHaveTextContent(/Cost of waiting\s*−0\.09% \/ wk\s*theta if nothing moves/);
    expect(h).toHaveTextContent(/Roll\s*Oct 17\s*30 days · roll at 10 DTE/);
    const scen = within(h).getByRole("table", { name: "If NDX moves · over the month" });
    expect(within(scen).getAllByRole("row").slice(1).map((r) => r.textContent)).toEqual(["−20%−32%−30%", "−10%−16%−14%", "flat0%−1.1%", "+10%+16%+14.9%"]);
    expect(h).toHaveTextContent("Why index options, not the names:");
    expect(h).toHaveTextContent("Recommendation: the put spread.");
    fireEvent.click(radios[1]);
    expect(h).toHaveTextContent("costs 0.2% of basket");
    expect(h).toHaveTextContent(/Cost of waiting\s*−0\.01% \/ wk/);
    expect(h).toHaveTextContent("beta-adjusted, 1.6 × 0.39 delta");
    expect(within(scen).getAllByRole("row")[1]).toHaveTextContent("−20%−32%−22.8%");
    expect(h).toHaveTextContent("breaks even at basket +0.2% · max loss $22.8 per $100 of basket, NDX −5% to −20% (table floor)");
  });

  it("weights as typed: an off total says why and asks nothing; normalize prices them; a ticker added and one dropped", async () => {
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    expect(b).toHaveTextContent("total 96%");
    expect(b).toHaveTextContent("The weights add to 96%: normalize to 100% to price them.");
    // The analyst's own input is not a failed answer: labels, no Awaiting refresh.
    expect(b).toHaveTextContent(/3-month\s*vs NDX · residual/);
    expect(b).not.toHaveTextContent("Awaiting refresh");
    fireEvent.click(within(b).getByRole("button", { name: "Normalize to 100%" }));
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22.9");
    expect(b).toHaveTextContent("total 100%");
    await waitFor(() => expect(calls.some((c) => c === "POST /api/desk/basket/price")).toBe(true));
    await waitFor(() => expect(b).toHaveTextContent("The pricing service has no price for these weights."));
    expect(b).toHaveTextContent(/3-month\s*Awaiting refresh/);
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
  });

  it("a ticker's name arrives with its price", async () => {
    stubDesk({
      "/api/desk/basket/price": (_u, init) => {
        const legs = (JSON.parse(String(init?.body)) as { legs: { symbol: string; weight: number }[] }).legs;
        return { ...basketPrice, legs: legs.map((l) => ({ ...l, name: l.symbol === "MSFT" ? "Microsoft" : "Other" })) };
      },
    });
    renderTab();
    const b = await loaded();
    const input = within(b).getByLabelText("Add a ticker");
    fireEvent.change(input, { target: { value: "MSFT" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of MSFT, percent"), { target: { value: "4" } });
    await waitFor(() => expect(within(within(b).getByRole("table")).getAllByRole("row").at(-1)).toHaveTextContent("MSFTMicrosoft"));
  });

  it("22.11/77.89 and 22.14/77.86 are two baskets: each is priced at its own weights (Codex R-14)", async () => {
    const two = { ...basket, legs: [{ symbol: "NVDA", name: "Nvidia", weight: 22.11 }, { symbol: "AVGO", name: "Broadcom", weight: 77.89 }] };
    const bodies: { symbol: string; weight: number }[][] = [];
    const { calls } = stubDesk({
      "/api/desk/basket/ai-infra": () => two,
      "/api/desk/basket/price": (_u, init) => {
        const legs = (JSON.parse(String(init?.body)) as { legs: { symbol: string; weight: number }[] }).legs;
        bodies.push(legs);
        // A price of its own for each set of weights: 3-month +14.2% at 22.14.
        return { ...basketPrice, ret_3m: legs[0].weight === 22.14 ? 0.142 : 0.131, legs: legs.map((l) => ({ ...l, name: null })) };
      },
    });
    renderTab();
    const b = await waitFor(() => basketCard());
    await waitFor(() => expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22.11"));
    expect(within(b).getByLabelText("Weight of AVGO, percent")).toHaveValue("77.89");
    await waitFor(() => expect(b).toHaveTextContent("+12.7%"));
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "22.14" } });
    // 22.14 + 77.89 is 100.03: not 100%, so nothing is asked.
    expect(b).toHaveTextContent("total 100.03%");
    fireEvent.change(within(b).getByLabelText("Weight of AVGO, percent"), { target: { value: "77.86" } });
    await waitFor(() => expect(b).toHaveTextContent("+14.2%"));
    expect(bodies).toEqual([
      [
        { symbol: "NVDA", weight: 22.14 },
        { symbol: "AVGO", weight: 77.86 },
      ],
    ]);
    // Saved, the hedge prices these weights, every digit in its key.
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")[0].legs.map((l: { weight: number }) => l.weight)).toEqual([22.14, 77.86]);
    await waitFor(() => expect(calls).toContain("GET /api/desk/hedge?mode=protect&legs=NVDA%3A22.14%2CAVGO%3A77.86"));
    fireEvent.click(within(b).getByTestId("dk-advanced"));
    fireEvent.click(within(b).getByRole("button", { name: "Revert to the served weights" }));
    await waitFor(() => expect(calls).toContain("GET /api/desk/hedge?mode=protect&basket=ai-infra"));
    // 22.11 + 77.86 is 99.97%: printed as it is, and never priced (G3-3, G3-6).
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "22.11" } });
    fireEvent.change(within(b).getByLabelText("Weight of AVGO, percent"), { target: { value: "77.86" } });
    expect(b).toHaveTextContent("total 99.97%");
    expect(b).toHaveTextContent("The weights add to 99.97%: normalize to 100% to price them.");
    // Back to the served weights: the served numbers, no second price asked.
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "22.11" } });
    fireEvent.change(within(b).getByLabelText("Weight of AVGO, percent"), { target: { value: "77.89" } });
    await waitFor(() => expect(b).toHaveTextContent("+12.7%"));
    expect(bodies).toHaveLength(1);
    expect(calls.filter((c) => c === "POST /api/desk/basket/price")).toHaveLength(1);
  });

  it("the badge dates the numbers on show: a reprice dated Sep 24 says Sep 24; the surface keeps its own date (Codex R-04)", async () => {
    stubDesk({
      "/api/desk/basket/price": () => ({ ...basketPrice, prices_as_of: "2026-09-24", ret_3m: 0.133 }),
      "/api/desk/hedge": (u) => deskFixtureBody(u, { surface_as_of: "2026-09-23" }),
    });
    renderTab();
    const b = await loaded();
    const badge = () => screen.getByTestId("dk-live");
    await waitFor(() => expect(badge()).toHaveTextContent("Live · prices Sep 22 · options via EODHD"));
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("priced off the SPY / QQQ surface of Sep 23"));
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    await waitFor(() => expect(b).toHaveTextContent("+13.3%"));
    expect(badge()).toHaveTextContent("Live · prices Sep 24 · options via EODHD");
    // The hedge still prices the served weights, off its own surface: its date does not move.
    expect(hedgeCard()).toHaveTextContent("priced off the SPY / QQQ surface of Sep 23");
    // Back to the served weights: the served basket's numbers and date.
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "22" } });
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "12" } });
    await waitFor(() => expect(b).toHaveTextContent("+12.7%"));
    expect(badge()).toHaveTextContent("Live · prices Sep 22 · options via EODHD");
    // Weights that cannot be priced show no numbers, so nothing is dated.
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    await waitFor(() => expect(badge()).toHaveTextContent(/^Live · options via EODHD$/));
  });

  it("a price served without its date says so in the card, never borrowing the served basket's date (Codex R-04, G4-1)", async () => {
    const { prices_as_of: _d, ...undated } = basketPrice as typeof basketPrice & { prices_as_of?: string };
    stubDesk({ "/api/desk/basket/price": () => ({ ...undated, ret_3m: 0.133 }) });
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    await waitFor(() => expect(b).toHaveTextContent("+13.3%"));
    expect(screen.getByTestId("dk-live")).toHaveTextContent(/^Live · options via EODHD$/);
    expect(b).toHaveTextContent("7 names · rebalanced monthly · prices date awaiting refresh");
  });

  it("a failed price dates nothing; a surface served without its date says so (Codex G4-5)", async () => {
    stubDesk({
      "/api/desk/basket/price": deskError(500, "down"),
      "/api/desk/hedge": (u) => deskFixtureBody(u, { surface_as_of: null }),
    });
    renderTab();
    const b = await loaded();
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("priced off the SPY / QQQ surface, its date awaiting refresh"));
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    await waitFor(() => expect(b).toHaveTextContent("The pricing service did not answer for these weights."));
    expect(screen.getByTestId("dk-live")).toHaveTextContent(/^Live · options via EODHD$/);
    expect(b).not.toHaveTextContent("prices date awaiting refresh");
  });

  it("a price answer that cannot be read, or refused, says so; nothing breaks", async () => {
    stubDesk({ "/api/desk/basket/price": () => ({}) });
    const { unmount } = renderTab();
    let b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    await waitFor(() => expect(b).toHaveTextContent("The pricing service's answer could not be read."));
    unmount();
    stubDesk({ "/api/desk/basket/price": deskError(503, "warming") });
    renderTab();
    b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    await waitFor(() => expect(b).toHaveTextContent("The pricing service did not answer for these weights."));
  });

  it("Save basket keeps the weights in this browser; the hedge prices them; Revert forgets them; the served name stays", async () => {
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("The weights add to 96%; normalize them to 100% to save.");
    expect(localStorage.getItem(SAVED_BASKETS_KEY)).toBeNull();
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    expect(b).toHaveTextContent("unsaved weights · saving re-prices the hedge on the right");
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("Saved in this browser. The hedge on the right now prices these weights.");
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")[0]).toMatchObject({ id: "ai-infra", name: "AI infrastructure", legs: expect.arrayContaining([{ symbol: "NVDA", name: "Nvidia", weight: 26 }]) });
    await waitFor(() => expect(calls).toContain("GET /api/desk/hedge?mode=protect&legs=NVDA%3A26%2CAVGO%3A16%2CVRT%3A14%2CCRWV%3A12%2CANET%3A12%2CCEG%3A12%2CSMCI%3A8"));
    await waitFor(() => expect(hedgeCard()).toHaveTextContent(/Hedge ratio\s*Awaiting refresh/));
    // The server's name, short name and rebalance rule stay; the meta says whose weights these are.
    expect(b).toHaveTextContent("7 names · rebalanced monthly · your weights, saved in this browser");
    expect(b).toHaveTextContent("Is the AI-infra bet working?");
    fireEvent.click(within(b).getByTestId("dk-advanced"));
    fireEvent.click(within(b).getByRole("button", { name: "Revert to the served weights" }));
    expect(b).toHaveTextContent("Back to the served weights.");
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("22");
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("$62.4 per $100"));
  });

  it("storage that is off or full says so, and nothing is kept", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    fireEvent.click(within(b).getByRole("button", { name: "Save basket" }));
    expect(b).toHaveTextContent("This browser's storage is full; nothing was saved.");
  });

  it("the mode lives in the address; from Event Study's price it, Express prices the study and Protect can be picked", async () => {
    const { calls } = stubDesk();
    renderTab("/desk/basket-hedge?mode=express&study=spx-golden-cross");
    await waitFor(() => expect(calls).toContain("GET /api/desk/hedge?mode=express&preset=spx-golden-cross"));
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("Awaiting refresh · the structures priced for this study"));
    fireEvent.click(within(hedgeCard()).getByRole("button", { name: "Protect the basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?mode=protect&study=spx-golden-cross"));
    expect(within(hedgeCard()).getByRole("button", { name: "Protect the basket" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("$62.4 per $100"));
    expect(calls).toContain("GET /api/desk/hedge?mode=protect&basket=ai-infra");
  });

  it("Express with the six slots, and with nothing carried in, the gold preset", async () => {
    const { calls } = stubDesk();
    const { unmount } = renderTab("/desk/basket-hedge?mode=express&shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20");
    await waitFor(() => expect(calls).toContain("GET /api/desk/hedge?mode=express&shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20"));
    unmount();
    const second = stubDesk();
    renderTab();
    fireEvent.click(await within(await waitFor(() => hedgeCard())).findByRole("button", { name: "Express the S&P lean" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?mode=express"));
    await waitFor(() => expect(second.calls).toContain("GET /api/desk/hedge?mode=express&preset=gold-2sigma-spx-weak"));
  });

  it("a position from Position Monitor is the hedge's subject until a basket is picked", async () => {
    const { calls } = stubDesk();
    renderTab("/desk/basket-hedge?position=ai-infra-hedged");
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("$62.4 per $100"));
    expect(calls).toContain("GET /api/desk/hedge?mode=protect&position=ai-infra-hedged");
    fireEvent.click(within(await loaded()).getByRole("button", { name: "+ New basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("The hedge prices the basket's saved weights once they add to 100%"));
  });

  it("while /basket is on its way, the labels alone: no Awaiting refresh anywhere", async () => {
    stubDesk({ "/api/desk/basket/ai-infra": () => new Promise(() => {}) });
    renderTab();
    const b = await waitFor(() => basketCard());
    expect(b).toHaveTextContent(/3-month\s*vs NDX · residual\s*Basket vol/);
    expect(hedgeCard()).toHaveTextContent(/Hedge ratio\s*Cost of waiting\s*Roll/);
    expect(screen.getByRole("main")).not.toHaveTextContent("Awaiting refresh");
  });

  it("a failed /basket keeps every label and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/basket/ai-infra": deskError(503, "warming") });
    renderTab();
    await waitFor(() => expect(basketCard()).toHaveTextContent(/3-month\s*Awaiting refresh/));
    expect(basketCard()).toHaveTextContent(/vs NDX · residual\s*Awaiting refresh/);
    expect(basketCard()).toHaveTextContent(/Basket vol\s*Awaiting refresh/);
    expect(basketCard()).toHaveTextContent("Awaiting refresh · the basket's legs");
    expect(hedgeCard()).toHaveTextContent(/Hedge ratio\s*Awaiting refresh/);
  });

  it("a served basket or hedge that cannot be read, or nulls, never breaks the tab", async () => {
    stubDesk({
      "/api/desk/basket/ai-infra": () => ({ as_of: "2026-09-22", id: "ai-infra" }),
      "/api/desk/hedge": () => ({ as_of: "2026-09-22", options: [{ id: "x", label: "Put spread", cost_pct: null, breakeven: null, max_loss: null, scenarios: null }] }),
    });
    renderTab("/desk/basket-hedge?position=ai-infra-hedged");
    await waitFor(() => expect(basketCard()).toHaveTextContent(/3-month\s*Awaiting refresh/));
    await waitFor(() => expect(hedgeCard()).toHaveTextContent("Put spread"));
    expect(hedgeCard()).not.toHaveTextContent("0.0%");
    expect(hedgeCard()).toHaveTextContent(/Hedge ratio\s*Awaiting refresh/);
  });

  it("+ New basket starts an empty basket kept in this browser, reuses an empty one, and can be deleted", async () => {
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Add a ticker"), { target: { value: "MSFT" } });
    fireEvent.submit(within(b).getByLabelText("Add a ticker").closest("form")!);
    // Typed weights are never dropped unseen: a new basket waits for them to be saved or put back.
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    expect(b).toHaveTextContent("This basket has unsaved weights: save them, or put them back, before starting another.");
    expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge");
    fireEvent.click(within(b).getByRole("button", { name: "Drop MSFT" }));
    fireEvent.click(within(b).getByRole("button", { name: "+ New basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge?basket=local-1"));
    expect(within(basketCard()).getByLabelText("Basket")).toHaveValue("local-1");
    expect(basketCard()).toHaveTextContent("0 names · saved in this browser");
    // The note about the last basket's ticker does not follow into this one.
    expect(basketCard()).not.toHaveTextContent("MSFT added");
    fireEvent.click(within(basketCard()).getByRole("button", { name: "+ New basket" }));
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")).toHaveLength(1);
    fireEvent.click(within(basketCard()).getByTestId("dk-advanced"));
    fireEvent.click(within(basketCard()).getByRole("button", { name: "Delete this basket" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge"));
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]")).toEqual([]);
  });

  it("on a basket of this browser's, the selector still lists the server's baskets", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([{ id: "local-1", name: "Grid", legs: [{ symbol: "CEG", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" }]));
    renderTab("/desk/basket-hedge?basket=local-1");
    const sel = await waitFor(() => within(basketCard()).getByLabelText("Basket"));
    await waitFor(() => expect([...(sel as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(["AI infrastructure", "Grid"]));
    fireEvent.change(sel, { target: { value: "ai-infra" } });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/basket-hedge"));
    await loaded();
  });

  it("a save in another window of this browser reaches the card as well as the hedge", async () => {
    const { calls } = stubDesk();
    renderTab();
    const b = await loaded();
    const legs = [22, 16, 14, 12, 12, 12, 12].map((w, i) => ({ symbol: ["NVDA", "AVGO", "VRT", "CRWV", "ANET", "CEG", "SMCI"][i], name: null, weight: i === 0 ? 26 : i === 6 ? 8 : w }));
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([{ id: "ai-infra", name: "AI infrastructure", legs, saved_at: "2026-09-22T00:00:00Z" }]));
    window.dispatchEvent(new StorageEvent("storage", { key: SAVED_BASKETS_KEY }));
    await waitFor(() => expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("26"));
    expect(b).toHaveTextContent("your weights, saved in this browser");
    await waitFor(() => expect(calls.some((c) => c.startsWith("GET /api/desk/hedge?mode=protect&legs=NVDA%3A26"))).toBe(true));
  });

  it("Import JSON gives a colliding basket a new number and replaces nothing", async () => {
    const mine = { id: "local-1", name: "Mine", legs: [{ symbol: "NVDA", name: null, weight: 50 }, { symbol: "AVGO", name: null, weight: 50 }], saved_at: "2026-09-22T00:00:00Z" };
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([mine]));
    renderTab();
    const b = await loaded();
    fireEvent.click(within(b).getByTestId("dk-advanced"));
    const theirs = { ...mine, name: "Theirs", legs: [{ symbol: "TSLA", name: null, weight: 100 }] };
    const json = JSON.stringify({ kind: "mrr.desk.baskets", version: 1, baskets: [theirs] });
    const file = new File([json], "baskets.json", { type: "application/json" });
    // jsdom's File has no text(); a browser's does.
    Object.defineProperty(file, "text", { value: () => Promise.resolve(json) });
    fireEvent.change(within(b).getByLabelText("Import saved baskets"), { target: { files: [file] } });
    await waitFor(() => expect(b).toHaveTextContent("Imported 1 basket; 1 given a new number, so no basket here was replaced."));
    expect(JSON.parse(localStorage.getItem(SAVED_BASKETS_KEY) ?? "[]").map((x: { id: string; name: string }) => `${x.id} ${x.name}`)).toEqual(["local-1 Mine", "local-2 Theirs"]);
  });

  it("served legs that are not legs never break the tab; a price's null leg is dropped", async () => {
    stubDesk({ "/api/desk/basket/ai-infra": () => ({ ...basketPrice, id: "ai-infra", name: "AI infrastructure", legs: [{ symbol: "NVDA", name: "Nvidia", weight: "12" }] }) });
    const { unmount } = renderTab();
    await waitFor(() => expect(basketCard()).toHaveTextContent("Awaiting refresh · the basket's legs"));
    unmount();
    // A null row in the price's legs is dropped at the response boundary (Codex R-10); the served numbers still show.
    stubDesk({ "/api/desk/basket/price": () => ({ ...basketPrice, legs: [null] }) });
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    await waitFor(() => expect(b).toHaveTextContent(/3-month\s*\+12\.7%/));
    expect(within(b).getByLabelText("Weight of NVDA, percent")).toHaveValue("26");
  });

  it("a price that is not JSON could not be read; an empty basket says to add a ticker", async () => {
    const { calls } = stubDesk();
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/basket/price")) {
        calls.push("POST /api/desk/basket/price");
        return new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } });
      }
      return inner(input, init);
    }) as typeof fetch;
    renderTab();
    const b = await loaded();
    fireEvent.change(within(b).getByLabelText("Weight of NVDA, percent"), { target: { value: "26" } });
    fireEvent.change(within(b).getByLabelText("Weight of SMCI, percent"), { target: { value: "8" } });
    await waitFor(() => expect(b).toHaveTextContent("The pricing service's answer could not be read."));
    for (const t of ["NVDA", "AVGO", "VRT", "CRWV", "ANET", "CEG", "SMCI"]) fireEvent.click(within(b).getByRole("button", { name: `Drop ${t}` }));
    expect(b).toHaveTextContent("Add a ticker to price the basket.");
  });

  it("a basket not saved in this browser says so", async () => {
    renderTab("/desk/basket-hedge?basket=local-9");
    await waitFor(() => expect(basketCard()).toHaveTextContent("This basket is not saved in this browser"));
  });

  it("Send to Position Monitor carries the basket; Position Monitor fills the instrument, or says the basket did not come", async () => {
    const { unmount } = renderTab();
    const send = await screen.findByTestId("dk-act");
    expect(send).toHaveTextContent("Send to Position Monitor →");
    expect(send).toHaveAttribute("href", "/desk/position-monitor?basket=ai-infra");
    unmount();
    stubDesk();
    const second = renderTab("/desk/position-monitor?basket=ai-infra");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("AI infrastructure basket vs 1.6 × NDX"));
    expect(screen.getByText(/Sent from Basket & Hedge · AI infrastructure/)).toBeInTheDocument();
    second.unmount();
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([{ id: "local-1", name: "Grid", legs: [{ symbol: "CEG", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" }]));
    const third = renderTab("/desk/position-monitor?basket=local-1");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("Grid basket"));
    third.unmount();
    stubDesk({ "/api/desk/basket/nope": deskError(404, "no basket nope") });
    renderTab("/desk/position-monitor?basket=nope");
    expect(await screen.findByText(/The basket sent from Basket & Hedge \(nope\) is awaiting refresh/)).toBeInTheDocument();
  });
});
