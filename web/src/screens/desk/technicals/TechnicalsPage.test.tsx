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
import { deskError, stubDesk } from "../../../test/desk";
import { aboveBelow, dayInYear, dayMove, ledgerOrder, monthTicks, quarterOf, rsiWord, sevenOf, spxName, trendSub } from "./TechnicalsPage";
import type { TechnicalsResponse } from "../data/types";

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
  it("takes the RSI's word as served, never from the Ledger's rows (Codex R-13)", () => {
    const t = technicals as unknown as TechnicalsResponse;
    expect(rsiWord(t)).toBe("neutral");
    expect(rsiWord({ ...t, rsi_word: "overbought" })).toBe("overbought");
    expect(rsiWord({ ...t, rsi_word: undefined })).toBeNull();
    expect(rsiWord(undefined)).toBeNull();
  });
  it("orders the Ledger's rows firing first, then by verdict, served order within a verdict", () => {
    const order = ledgerOrder((ledger.signals as LedgerRow[]).filter((r) => r.group === "spx")).map((r) => r.slug);
    expect(order).toEqual(["golden-cross", "rsi-below-30", "spx-20d-2sigma", "death-cross", "rsi-above-70", "spx-5d-2sigma"]);
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
    const card = await screen.findByRole("region", { name: /S&P 500/ });
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

  it("lists the Ledger's S&P signals with the in-regime note", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(6));
    const rows = within(card).getAllByRole("listitem");
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("Golden cross31× since 1990 · up 68% · a month later +2.7%Reliable");
    expect(card).toHaveTextContent("+14.2%");
    expect(card).toHaveTextContent("above both averages");
    expect(card).toHaveTextContent("+0.6σ");
    expect(card).toHaveTextContent("no extreme move");
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("In this regime (Overheating): golden cross has fired only 9 times — too few to trust. A normal month is +1.3%");
  });

  it("reads what protection costs from /vol, with its source line", async () => {
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

  it("shows seven sector bars and opens all eleven under Advanced", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Sector leadership/ });
    const seven = await within(card).findByRole("list", { name: /top three/ });
    expect(within(seven).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 4))).toEqual(["XLKT", "XLII", "XLFF", "XLEE", "XLVH", "XLPS", "XLUU"]);
    fireEvent.click(within(card).getByTestId("dk-advanced"));
    expect(within(within(card).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem")).toHaveLength(11);
  });

  it("the RSI card: now, the last extremes, the gauge and the two matched notes", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent("neutral, rising"));
    expect(card).toHaveTextContent("Jun 12");
    expect(card).toHaveTextContent("S&P +1.1% a month later");
    expect(card).toHaveTextContent("Apr 8, 2025");
    expect(card).toHaveTextContent("S&P +9.4% a month later");
    expect(within(card).getByRole("img", { name: "RSI 58, neutral" })).toBeInTheDocument();
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Above 70: fired 64× since 1990; the S&P was up 59% of the time a month later. No edge.");
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Below 30: fired 22× since 1990; the S&P was up 73% of the time a month later. Reliable.");
  });

  it("the words that judge a level are the served ones; unserved, the number stays and the word goes (Codex R-13)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, move_20d_word: "an extreme move", rsi_word: "overbought" }) });
    const first = renderTab();
    const signals = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(signals).toHaveTextContent("an extreme move"));
    const rsi = screen.getByRole("region", { name: /Momentum · RSI/ });
    expect(rsi).toHaveTextContent("overbought, rising");
    expect(within(rsi).getByRole("img", { name: "RSI 58, overbought" })).toBeInTheDocument();
    first.unmount();

    const { move_20d_word: _m, rsi_word: _r, ...bare } = technicals;
    stubDesk({ "/api/desk/technicals": () => bare });
    renderTab();
    const s2 = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(s2).toHaveTextContent("+0.6σ"));
    expect(s2).not.toHaveTextContent(/extreme move/);
    const r2 = screen.getByRole("region", { name: /Momentum · RSI/ });
    expect(r2.textContent).toContain("Now58risingLast above 70");
    expect(within(r2).getByRole("img", { name: "RSI 58" })).toBeInTheDocument();
  });

  it("stays quiet while the first answers are on their way", async () => {
    stubDesk({ "/api/desk/vol": () => new Promise(() => {}), "/api/desk/technicals": () => new Promise(() => {}) });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    expect(vol).toHaveAttribute("aria-busy", "true");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    expect(screen.getByRole("region", { name: /S&P 500/ })).not.toHaveTextContent("Awaiting refresh");
  });

  it("a 200 answer without the block a card reads leaves that card awaiting, not broken", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ error: "series not ingested", missing: ["XLK"] }), "/api/desk/ledger": () => ({ as_of: "2026-09-22", generation_id: "g" }) });
    renderTab();
    const sect = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(sect).toHaveTextContent("Awaiting refresh"));
    const sig = screen.getByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(sig).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: /S&P 500/ })).toHaveTextContent("6,412");
  });

  it("an unwired /vol and an uningested /sectors keep their labels and say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/vol": deskError(503, "not wired"), "/api/desk/sectors": deskError(503, "series not ingested", { missing: ["XLK"] }) });
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
