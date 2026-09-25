/**
 * Technicals (DESK_FRAME3_SPEC §3) against the §12.7, §12.9, §12.10 and §12.4
 * fixtures: every number is a served field, the signals are the Ledger's S&P
 * group in the Ledger's order, the sector card shows the top three, the
 * middle one and the bottom three, and a card whose endpoint fails keeps its
 * labels and says "Awaiting refresh" (§1.7, §12.9: vol is not wired yet).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import ledger from "../../../fixtures/desk/ledger.json";
import technicals from "../../../fixtures/desk/technicals.json";
import type { LedgerRow } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import { aboveBelow, dayInYear, dayMove, ledgerOrder, monthTicks, quarterOf, RSI_UNAVAILABLE, sevenOf, spxName, trendSub } from "./TechnicalsPage";
import { servedTechnicals } from "../../../test/desk-variants";

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

describe("Technicals words", () => {
  it("spells distances, quarters, days and names", () => {
    expect(aboveBelow(0.021)).toBe("price is 2.1% above");
    expect(aboveBelow(-0.034)).toBe("price is 3.4% below");
    expect(quarterOf("2023-10")).toBe("Q4 2023");
    expect(quarterOf("2024-02")).toBe("Q1 2024");
    expect(dayInYear("2026-06-12", "2026-09-22")).toBe("Jun 12");
    expect(dayInYear("2025-04-08", "2026-09-22")).toBe("Apr 8, 2025");
    expect(spxName("S&P golden cross")).toBe("Golden cross");
    expect(spxName("RSI below 30")).toBe("RSI below 30");
    expect(quarterOf("2023")).toBe("");
    expect(dayMove(0.004, "2026-09-22", "2026-09-22")).toBe("+0.4% today");
    expect(dayMove(0.004, "2026-09-22", "2026-09-24")).toBe("+0.4% on Sep 22");
    expect(trendSub({ vs_ma50: 0.021, vs_ma200: 0.085 })).toBe("above both averages");
    expect(trendSub({ vs_ma50: Number.NaN, vs_ma200: 0.085 })).toBeNull();
  });
  it("orders the Ledger's rows firing first, then by verdict, served order within a verdict", () => {
    const order = ledgerOrder((ledger.signals as LedgerRow[]).filter((r) => r.group === "spx" && r.available !== false)).map((r) => r.slug);
    expect(order).toEqual(["golden-cross", "spx-20d-2sigma", "death-cross", "spx-5d-2sigma"]);
  });
  it("keeps the top three, the middle one and the bottom three", () => {
    expect(sevenOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([1, 2, 3, 6, 9, 10, 11]);
    expect(sevenOf([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("labels three months on the x axis", () => {
    expect(monthTicks(["2025-09-22", "2025-09-30", "2025-10-01", "2026-03-31", "2026-04-01", "2026-09-22"]).map((t) => t.text)).toEqual(["Oct 25", "Apr 26", "Sep 26"]);
  });
});

describe("Technicals tab", () => {
  it("prints the price and its two averages with their distances, from /technicals", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^S&P 500/ });
    await waitFor(() => expect(card).toHaveTextContent("6,412"));
    expect(card).toHaveTextContent(/\+0\.4% (today|on Sep 22)/);
    expect(card).toHaveTextContent("6,280");
    expect(card).toHaveTextContent("price is 2.1% above");
    expect(card).toHaveTextContent("5,910");
    expect(card).toHaveTextContent("price is 8.5% above");
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Jul 1, 2025 — the 50-day crossed above the 200-day. This has happened 31 times before; the S&P was higher a month later 68% of the time. Reliable.");
    expect(within(card).getByRole("img", { name: /with its 50-day and 200-day averages, 1Y/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "3Y" }));
    expect(within(card).getByRole("img", { name: /3Y/ })).toBeInTheDocument();
  });

  it("lists the Ledger's S&P signals, the RSI rows omitted while unavailable, with §3's note", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(4));
    expect(card.textContent).not.toMatch(/RSI/);
    const rows = within(card).getAllByRole("listitem");
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("Golden cross31× since 1990 · up 68% · a month later +2.7%Reliable");
    expect(card).toHaveTextContent("+14.2%");
    expect(card).toHaveTextContent("above both averages");
    expect(card).toHaveTextContent("+0.6σ");
    expect(card).toHaveTextContent("no extreme move");
    expect(card.querySelector(".te-note")?.textContent).toBe("vs normal compares each study to its own baseline over its own sample.");
    expect(card.textContent).not.toMatch(/normal month|A normal month|survives resampling/);
  });

  it("reads what protection costs from /technicals' vol block once served (§12.13's deferred shape), with its source line", async () => {
    stubDesk({ "/api/desk/technicals": servedTechnicals });
    renderTab();
    const card = await screen.findByRole("region", { name: "What protection costs right now" });
    await waitFor(() => expect(card).toHaveTextContent("+6.8 pts"));
    expect(card).toHaveTextContent("Puts are 6.8 vol points more expensive than calls.");
    expect(card).toHaveTextContent("Rising since June. Investors are paying up for downside cover.");
    expect(card).toHaveTextContent("Options price 15.4% annual movement; the last 20 days delivered 11.9%.");
    expect(card).toHaveTextContent("15.4 · 16.8 · 17.5");
    expect(card).toHaveTextContent("74th pct");
    expect(card).toHaveTextContent("Source: EODHD options, one pull per close · live read, not scored (history from Q4 2023)");
  });

  it("shows seven sector bars from /technicals' sectors block once served, and opens all eleven under Advanced", async () => {
    stubDesk({ "/api/desk/technicals": servedTechnicals });
    renderTab();
    const card = await screen.findByRole("region", { name: /Sector leadership/ });
    const seven = await within(card).findByRole("list", { name: /top three/ });
    expect(within(seven).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 4))).toEqual(["XLKT", "XLII", "XLFF", "XLEE", "XLVH", "XLPS", "XLUU"]);
    fireEvent.click(within(card).getByTestId("dk-advanced"));
    expect(within(within(card).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem")).toHaveLength(11);
  });

  it("the RSI card is unavailable (§1.0): its labels, §1.0's reason once, Not yet served, Advanced disabled, no number or gauge", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent(RSI_UNAVAILABLE.reason));
    expect(within(card).getAllByText(RSI_UNAVAILABLE.reason)).toHaveLength(1);
    for (const l of ["Now", "Last above 70", "Last below 30"]) expect(card).toHaveTextContent(l);
    expect(within(card).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(within(card).getByTestId("dk-advanced")).toBeDisabled();
    expect(within(card).queryByRole("img")).toBeNull();
    expect(card.textContent).not.toMatch(/\d+×|\bneutral\b/);
  });

  it("Monday's /technicals serves the vol and sectors blocks awaiting: each card keeps its labels and prints its §12.7 reason once", async () => {
    renderTab();
    // The card remounts from its loading state to the unavailable one: query it afresh.
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("needs stored SPY option snapshots and a versioned skew method."));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    const sect = screen.getByRole("region", { name: /^Sector leadership/ });
    expect(within(sect).getAllByText("sector ETFs, RSP and IWM not ingested.")).toHaveLength(1);
    expect(within(sect).getByTestId("dk-advanced")).toBeDisabled();
    for (const card of [vol, sect]) expect(card).not.toHaveTextContent("Awaiting refresh");
  });

  it("the words that judge a level are the served ones; unserved, the number stays and the word goes (Codex R-13)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, move_20d_word: "an extreme move" }) });
    const first = renderTab();
    const signals = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(signals).toHaveTextContent("an extreme move"));
    first.unmount();

    const { move_20d_word: _m, ...bare } = technicals;
    void _m;
    stubDesk({ "/api/desk/technicals": () => bare });
    renderTab();
    const s2 = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(s2).toHaveTextContent("+0.6σ"));
    expect(s2).not.toHaveTextContent(/extreme move/);
  });

  it("stays quiet while the first answers are on their way", async () => {
    stubDesk({ "/api/desk/technicals": () => new Promise(() => {}) });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    expect(vol).toHaveAttribute("aria-busy", "true");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    expect(screen.getByRole("region", { name: /^S&P 500/ })).not.toHaveTextContent("Awaiting refresh");
  });

  it("a 200 answer without the block a card reads leaves that card awaiting, not broken", async () => {
    // The sectors block not served at all (no envelope, no reason) and a Ledger without its rows.
    const { sectors: _s, ...noSectors } = technicals;
    void _s;
    stubDesk({ "/api/desk/technicals": () => noSectors, "/api/desk/ledger": () => ({ as_of: "2026-09-22", generation_id: "g" }) });
    renderTab();
    const sect = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(sect).toHaveTextContent("Awaiting refresh"));
    const sig = screen.getByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(sig).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: /^S&P 500/ })).toHaveTextContent("6,412");
  });

  it("a failed /technicals keeps the vol and sector cards' labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/technicals": deskError(503, "not wired") });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    await waitFor(() => expect(vol).toHaveTextContent("Awaiting refresh"));
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(vol).not.toHaveTextContent("6.8");
    const sect = screen.getByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(sect).toHaveTextContent("Awaiting refresh"));
    expect(sect).not.toHaveTextContent("XLK");
  });
});

describe("routes served awaiting (§12.0, §1.0.2)", () => {
  it("the vol block served awaiting: the card keeps its labels, prints the reason once and says Not yet served", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("needs stored SPY option snapshots"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(within(vol).getAllByText(/needs stored SPY option snapshots/)).toHaveLength(1);
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
  });
  it("technicals served awaiting: the page badge and its three cards say Not yet served, no Ledger number beside them", async () => {
    stubDesk({ "/api/desk/technicals": deskAwaiting("no generation stored yet.") });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Signals/ })).toHaveTextContent("no generation stored yet."));
    for (const name of [/^S&P 500/, /^Signals/, /^What protection costs right now/, /^Sector leadership/]) {
      const card = screen.getByRole("region", { name });
      expect(within(card).getAllByText("no generation stored yet.")).toHaveLength(1);
      expect(card.textContent).not.toMatch(/\d+×|Reliable|No edge/);
    }
    // RSI is unavailable for its own reason (§1.0), whatever /technicals answers.
    expect(screen.getByRole("region", { name: /^Momentum · RSI/ })).toHaveTextContent(RSI_UNAVAILABLE.reason);
    expect(screen.getAllByTestId("dk-live")[0]).toHaveTextContent("Not yet served");
  });
});
