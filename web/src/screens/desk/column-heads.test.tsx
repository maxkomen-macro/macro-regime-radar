/**
 * desk/pdf-polish item 7: every column head of every Desk table carries a
 * one-sentence definition (kit/glossary.ts, by id), reached by hover, focus or
 * tap (kit/Term.tsx). Each LIVE table is rendered from the §12 fixtures and
 * each visible column head checked: one term, its sentence the glossary's, a
 * Tab stop of its own. PROTOTYPE cards' tables (§1.0.3, illustrative values)
 * are left as they are; the report lists them.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "./DeskShell";
import sample from "../../fixtures/desk/baskets.json";
import positions from "../../fixtures/desk/positions.json";
import { renderWithProviders } from "../../test/utils";
import { stubDesk } from "../../test/desk";
import { GLOSSARY } from "./kit/glossary";
import { SAVED_BASKETS_KEY } from "./basket/weights";
import { POSITIONS_KEY } from "./positions/store";

function renderAt(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
  localStorage.removeItem(SAVED_BASKETS_KEY);
  localStorage.removeItem(POSITIONS_KEY);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(SAVED_BASKETS_KEY);
  localStorage.removeItem(POSITIONS_KEY);
});

/** Each visible column head of a table: its printed words and its one term's definition and Tab stop. */
function heads(table: Element): { text: string; def: string | null; tab: string | null }[] {
  return [...table.querySelectorAll('thead th[scope="col"]')]
    .filter((th) => !th.closest(".dk-sr") && !th.classList.contains("dk-sr") && (th.textContent ?? "").trim() !== "" && !th.querySelector(":scope > .dk-sr:only-child"))
    .map((th) => {
      const terms = th.querySelectorAll(".dk-term");
      expect(terms, `${th.textContent}: one term`).toHaveLength(1);
      return { text: (th.textContent ?? "").trim(), def: terms[0].getAttribute("data-def"), tab: terms[0].getAttribute("tabindex") };
    });
}

/** A table's heads against the glossary ids expected, in order. */
function expectHeads(table: Element | null, expected: [string, string][]) {
  expect(table, expected.map(([t]) => t).join(", ")).not.toBeNull();
  const got = heads(table!);
  expect(got.map((h) => h.text)).toEqual(expected.map(([t]) => t));
  for (const [i, [text, id]] of expected.entries()) {
    expect(got[i].def, text).toBe(GLOSSARY[id].text);
    expect(got[i].tab, `${text}: a Tab stop`).toBe("0");
  }
}

describe("every Desk column head carries its definition (desk/pdf-polish item 7)", () => {
  it("Basket & Hedge: the legs, against the Nasdaq and the S&P, liquidity, hedge with an ETF, the stress test", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify((sample as { baskets: unknown[] }).baskets));
    renderAt("/desk/basket-hedge");
    const basket = await screen.findByRole("region", { name: "Basket" });
    await waitFor(() => expect(basket.querySelector("thead.bh-legs-thead")).not.toBeNull());
    expectHeads(basket.querySelector("table.bh-table"), [
      ["Ticker", "col-ticker"],
      ["Name", "col-name"],
      ["Now", "col-now"],
      ["Since start", "col-since"],
      ["Weight", "col-weight"],
    ]);
    const compare = await screen.findByRole("region", { name: /^Against the Nasdaq and the S&P/ });
    await waitFor(() => expect(compare.querySelector("table.bh-mini")).not.toBeNull());
    expectHeads(compare.querySelector("table.bh-mini"), [
      ["Against", "col-against"],
      ["Beta 1Y", "col-beta1y"],
      ["Corr 1Y", "col-corr1y"],
      ["Beta 60D", "col-beta60d"],
      ["Corr 60D", "col-corr60d"],
    ]);
    const liquidity = screen.getByRole("region", { name: /^Liquidity/ });
    expectHeads(liquidity.querySelector("table.bh-liq-table"), [
      ["Name", "col-liq-name"],
      ["20-day avg $ volume", "col-adv"],
      ["At target", "col-at-target"],
      ["Days at 20%", "col-days20"],
    ]);
    const etfs = await screen.findByRole("region", { name: /^Hedge with an ETF/ });
    await waitFor(() => expect(etfs.querySelector("table.bh-etf-table")).not.toBeNull());
    expectHeads(etfs.querySelector("table.bh-etf-table"), [
      ["ETF", "col-etf"],
      ["R² 1Y", "col-r2-1y"],
      ["R² 60D", "col-r2-60d"],
      ["Hedge ratio", "hedgeratio"],
      ["Short", "col-short"],
      ["Vol left", "col-vol-left"],
      ["Vol cut", "col-vol-cut"],
    ]);
    // Codex R-03: the column prints the change in volatility (vol left ÷ the basket's own − 1, below zero when the
    // short lowers it), and its definition says the same sign.
    const cuts = [...etfs.querySelectorAll("table.bh-etf-table tbody tr td:last-child")].map((td) => td.textContent ?? "");
    expect(cuts.some((t) => t.startsWith("−"))).toBe(true);
    expect(GLOSSARY["col-vol-cut"].text).toContain("vol left over the basket's own volatility, minus one, so −44% means 44% less");
    const stress = screen.getByRole("region", { name: /^Stress test/ });
    const short = stress.querySelector("thead th:nth-child(4)")?.textContent ?? "";
    expect(short).toMatch(/^Short [A-Z]+$/);
    expectHeads(stress.querySelector("table.bh-stress-table"), [
      ["If", "col-if"],
      ["Basket", "col-st-basket"],
      ["Unhedged", "col-unhedged"],
      [short, "col-short-pnl"],
      ["Hedged", "col-hedged"],
    ]);
  });

  it("Event Study: by regime, and every event in Advanced", async () => {
    renderAt("/desk/event-study");
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail.querySelector("table.es-table")).not.toBeNull());
    expectHeads(rail.querySelector("table.es-table"), [
      ["Regime", "col-es-regime"],
      ["N", "col-es-n"],
      ["Up", "col-es-up"],
      ["Median", "col-es-median"],
    ]);
    fireEvent.click(within(rail).getByTestId("dk-advanced"));
    const adv = await screen.findByRole("region", { name: "Advanced" });
    await waitFor(() => expect(adv.querySelector("table.es-wide")).not.toBeNull());
    expectHeads(adv.querySelector("table.es-wide"), [
      ["Event", "col-es-event"],
      ["Regime", "col-es-regime"],
      ["1 week", "col-es-h5"],
      ["2 weeks", "col-es-h10"],
      ["1 month", "col-es-h20"],
      ["3 months", "col-es-h60"],
    ]);
  });

  it("Signal Ledger: all eight", async () => {
    renderAt("/desk/signal-ledger");
    const card = await screen.findByRole("region", { name: "Every scored signal" });
    await waitFor(() => expect(card.querySelector("table.lg-table")).not.toBeNull());
    expectHeads(card.querySelector("table.lg-table"), [
      ["Signal", "col-signal"],
      ["Last fired", "col-last-fired"],
      ["Times", "col-times"],
      ["Up a month later", "col-up-month"],
      ["Median", "col-median"],
      ["Vs normal", "col-vs-normal"],
      ["Verdict", "col-verdict"],
      ["Now", "col-now-firing"],
    ]);
  });

  it("Regime: what each regime has meant (the VIX column also says what the VIX is)", async () => {
    renderAt("/desk/regime");
    const card = await screen.findByRole("region", { name: /^What each regime has meant/ });
    await waitFor(() => expect(card.querySelector("table.rg-table")).not.toBeNull());
    const vix = [...card.querySelectorAll("thead th")].find((th) => th.textContent === "VIX avg")!;
    expect(vix.querySelector(".dk-term")?.getAttribute("data-def")).toBe(`${GLOSSARY.vix.text}\n${GLOSSARY["col-rg-vix"].text}`);
    const table = card.querySelector("table.rg-table")!;
    const got = heads(table);
    const ids = ["col-rg-regime", "col-rg-months", "col-rg-n", "col-rg-median", "col-rg-mean", "col-rg-up", "col-rg-vix", "col-rg-vix-days"];
    expect(got.map((h) => h.text)).toEqual(["Regime", "Months", "S&P n", "S&P median", "S&P mean", "Up", "VIX avg", "VIX days"]);
    got.forEach((h, i) => expect(h.def?.split("\n").at(-1), h.text).toBe(GLOSSARY[ids[i]].text));
  });

  it("Data Pipeline: a group's series table", async () => {
    renderAt("/desk/data-pipeline?group=credit");
    const inv = await screen.findByRole("region", { name: /Series inventory/ });
    await waitFor(() => expect(inv.querySelector("table.pl-table")).not.toBeNull());
    expectHeads(inv.querySelector("table.pl-table"), [
      ["Series", "col-pl-series"],
      ["ID", "col-pl-id"],
      ["From", "col-pl-from"],
      ["As of", "col-pl-asof"],
      ["Feeds", "col-pl-feeds"],
      ["Status", "col-pl-status"],
    ]);
  });

  it("Technicals: the seasonality table", async () => {
    renderAt("/desk/technicals");
    const card = await screen.findByRole("region", { name: /^Seasonality · / });
    await waitFor(() => expect(card.querySelector("table.te-season-table")).not.toBeNull());
    expectHeads(card.querySelector("table.te-season-table"), [
      ["Month", "col-month"],
      ["Average", "col-season-avg"],
      ["Up", "col-season-up"],
      ["Years", "col-season-years"],
    ]);
  });

  it("Position Monitor: each row's three figures, and the closes of the last 90 days", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify((positions as { positions: unknown[] }).positions));
    renderAt("/desk/position-monitor");
    const mon = await screen.findByRole("region", { name: "Monitored" });
    await waitFor(() => expect(within(mon).getAllByTestId("dk-mon-row").length).toBeGreaterThan(0));
    const row = within(mon).getAllByTestId("dk-mon-row")[0];
    expect(row.querySelector(".dk-mon-nav .dk-term")?.getAttribute("data-def")).toBe(GLOSSARY.nav.text);
    const closed = screen.getByRole("region", { name: "Closed in the last 90 days" });
    expect([...closed.querySelectorAll("dt .dk-term")].map((t) => [t.textContent, t.getAttribute("data-def"), t.getAttribute("tabindex")])).toEqual([
      ["Falsified on level", GLOSSARY["col-falsified"].text, "0"],
      ["Expired at horizon", GLOSSARY["col-expired"].text, "0"],
      ["Pre-mortem was right", GLOSSARY["col-premortem"].text, "0"],
    ]);
  });
});
