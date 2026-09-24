/**
 * Sectors (DESK_FRAME3_SPEC §7) against the §12.7 fixture, and §12.7's
 * "series not ingested" answer: all eleven sectors ranked with LEADING,
 * LAGGING and PATTERN; breadth with its two lines and the two rows of dots;
 * and, until the sector ETFs are ingested, both cards keep their labels and
 * say Awaiting refresh.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import sectors from "../../../fixtures/desk/sectors.json";

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/sectors" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Sectors tab", () => {
  it("leadership: all eleven, ranked, with the leader, the laggard and the pattern", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Sector leadership/ });
    const list = await within(card).findByRole("list", { name: /All eleven/ });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 4))).toEqual(["XLKT", "XLII", "XLFF", "XLCC", "XLYD", "XLEE", "XLBM", "XLRE", "XLVH", "XLPS", "XLUU"]);
    expect(card).toHaveTextContent(/Leading\s*Technology\s*\+6\.1% vs the index/);
    expect(card).toHaveTextContent(/Lagging\s*Utilities\s*−4\.8% vs the index/);
    expect(card).toHaveTextContent(/Pattern\s*Cyclical\s*growth sectors over defensives/);
    expect(card).toHaveTextContent("Read: Tech, Industrials and Financials leading");
  });
  it("breadth: the three stats, the two lines and the dots", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(card).toHaveTextContent("7 of 11"));
    expect(card).toHaveTextContent(/Above 50-day\s*7 of 11\s*sectors · was 10 a month ago/);
    expect(card).toHaveTextContent(/Above 200-day\s*9 of 11\s*sectors · trend still broad/);
    expect(card).toHaveTextContent(/Equal vs cap weight\s*−2\.4%\s*3 months · big names carrying it/);
    expect(within(card).getByRole("img", { name: /Average stock vs the index · one year: −2\.4% on Sep 22/ })).toBeInTheDocument();
    // D13: the chart's right end names the served day, not "today" (the fixture is Sep 22).
    expect(within(card).getAllByText("Sep 22").length).toBeGreaterThan(0);
    expect(within(card).getByRole("img", { name: /Small caps vs large/ })).toBeInTheDocument();
    const above50 = within(card).getByRole("list", { name: "Which sectors are above their 50-day" });
    const lit = (l: HTMLElement) => within(l).getAllByRole("listitem").filter((li) => li.getAttribute("data-state") === "on");
    expect(lit(above50)).toHaveLength(7);
    expect(lit(above50).map((li) => li.textContent)).toEqual(["Techabove", "Indabove", "Finabove", "Commabove", "Discabove", "Enrgabove", "REabove"]);
    const above200 = within(card).getByRole("list", { name: "Which sectors are above their 200-day" });
    expect(lit(above200)).toHaveLength(9);
    expect(card).toHaveTextContent("Measured from sector ETFs; stock-level breadth needs constituent data that is not ingested yet.");
  });
  it("§12.7's 'series not ingested' leaves both cards awaiting with their labels", async () => {
    stubDesk({ "/api/desk/sectors": deskError(503, "series not ingested", { missing: ["XLK", "RSP", "IWM"] }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent("Awaiting refresh"));
    expect(lead).toHaveTextContent("Leading");
    expect(lead).not.toHaveTextContent("Technology");
    const breadth = screen.getByRole("region", { name: /Breadth/ });
    expect(breadth).toHaveTextContent("Above 50-day");
    expect(breadth).not.toHaveTextContent("7 of 11");
    expect(lead).toHaveTextContent("Awaiting refresh · the sector ETFs are not ingested yet");
    expect(breadth).toHaveTextContent("Awaiting refresh · the sector ETFs are not ingested yet");
  });
  it("names each card by its title and subtitle", async () => {
    renderTab();
    expect(await screen.findByRole("region", { name: "Sector leadership 3-month return relative to the S&P · all eleven" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Breadth is the rally wide or narrow?" })).toBeInTheDocument();
  });
  it("the notes and the 200-day color are served; the page picks no words of its own", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, pattern: "defensive", words: { pattern: "defensives over growth", above_200: "trend narrowing", eqw: "average stock keeping up" }, breadth: { ...sectors.breadth, above_200: { ...sectors.breadth.above_200, broad: false }, eqw_vs_cap_3m: 0.012 } }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent(/Pattern\s*Defensive\s*defensives over growth/));
    const breadth = screen.getByRole("region", { name: /Breadth/ });
    expect(breadth).toHaveTextContent(/Above 200-day\s*9 of 11\s*sectors · trend narrowing/);
    expect(within(breadth).getByText("9 of 11")).not.toHaveAttribute("data-tone", "green");
    expect(breadth).toHaveTextContent(/Equal vs cap weight\s*\+1\.2%\s*3 months · average stock keeping up/);
    expect(within(breadth).getByText("+1.2%")).toHaveAttribute("data-tone", "up");
  });
  it("the fixture's colors: 50-day amber (narrowing), 200-day green (served broad), equal weight down", async () => {
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(within(breadth).getByText("7 of 11")).toHaveAttribute("data-tone", "amber"));
    expect(within(breadth).getByText("9 of 11")).toHaveAttribute("data-tone", "green");
    expect(within(breadth).getByText("−2.4%")).toHaveAttribute("data-tone", "down");
  });
  it("a 200 answer carrying the not-ingested error says why on both cards", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ error: "series not ingested", missing: ["XLK"] }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent("Awaiting refresh · the sector ETFs are not ingested yet"));
    expect(screen.getByRole("region", { name: /Breadth/ })).toHaveTextContent("Awaiting refresh · the sector ETFs are not ingested yet");
  });
  it("the leader and laggard are the served first and last rows; a null one says Awaiting refresh (S-4)", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, leadership: sectors.leadership.map((r) => (r.etf === "XLK" ? { ...r, rel_ret: null } : r)) }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent(/Leading\s*Awaiting refresh/));
    expect(lead).not.toHaveTextContent(/Leading\s*Industrials/);
    const items = within(within(lead).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent(/XLK\s*Technology\s*Awaiting refresh/);
  });
  it("without the leadership block, the served breadth still shows; the dots follow the map's keys (S-3)", async () => {
    const { leadership: _l, ...rest } = sectors;
    void _l;
    stubDesk({ "/api/desk/sectors": () => rest });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(breadth).toHaveTextContent(/Above 50-day\s*7 of 11/));
    const dots = within(breadth).getByRole("list", { name: "Which sectors are above their 50-day" });
    expect(within(dots).getAllByRole("listitem")[0]).toHaveTextContent("XLK");
    expect(screen.getByRole("region", { name: /Sector leadership/ })).toHaveTextContent(/Leading\s*Awaiting refresh/);
  });
  it("equal weight's window is its own three months, whatever the leadership window (S-6)", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, window_months: 6 }) });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(breadth).toHaveTextContent(/Equal vs cap weight\s*−2\.4%\s*3 months/));
    expect(screen.getByRole("region", { name: /Sector leadership/ })).toHaveTextContent("6-month return relative to the S&P");
  });
  it("a dot the map does not serve is a ring, not a gray 'below'; a null month-ago drops only its clause (S-7)", async () => {
    const { XLU: _u, ...partial } = sectors.breadth.above_50.by_etf;
    void _u;
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, above_50: { ...sectors.breadth.above_50, by_etf: partial, month_ago: null } } }) });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    const dots = await within(breadth).findByRole("list", { name: "Which sectors are above their 50-day" });
    const util = within(dots).getAllByRole("listitem")[10];
    expect(util).toHaveAttribute("data-state", "unknown");
    expect(util).toHaveTextContent("not served");
    expect(breadth).toHaveTextContent(/Above 50-day\s*7 of 11\s*sectors(?! · was)/);
  });
  it("more sectors above than a month ago is green (up); the ±5% axis steps to ±15% for a wider series", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, above_50: { ...sectors.breadth.above_50, month_ago: 5 }, eqw_vs_cap_series: sectors.breadth.eqw_vs_cap_series.map((p, i) => (i === 100 ? { ...p, rel: 0.12 } : p)) } }) });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(within(breadth).getByText("7 of 11")).toHaveAttribute("data-tone", "green"));
    expect(within(breadth).getByText("+15%")).toBeInTheDocument();
  });
  it("§7's gray note stays without the breadth read (S-11)", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, reads: { ...sectors.reads, breadth: undefined } }) });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(breadth).toHaveTextContent("Measured from sector ETFs; stock-level breadth needs constituent data that is not ingested yet."));
  });
  it("a sector without a value keeps its row and says so; absent breadth keeps its labels", async () => {
    const { breadth: _b, ...rest } = sectors;
    void _b;
    stubDesk({ "/api/desk/sectors": () => ({ ...rest, leadership: sectors.leadership.map((r) => (r.etf === "XLE" ? { ...r, rel_ret: null } : r)) }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    const list = await within(lead).findByRole("list", { name: /All eleven/ });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(11);
    expect(items[5]).toHaveTextContent(/XLE\s*Energy\s*Awaiting refresh/);
    const breadth = screen.getByRole("region", { name: /Breadth/ });
    expect(breadth).toHaveTextContent(/Above 50-day\s*Awaiting refresh/);
    expect(breadth).toHaveTextContent(/Equal vs cap weight\s*Awaiting refresh/);
    expect(breadth).not.toHaveTextContent("narrowing. The index");
  });
  it("empty series and a missing dots map keep their labels and say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, eqw_vs_cap_series: [], small_vs_large_series: [], above_200: { n: 9, of: 11 } } }) });
    renderTab();
    const breadth = await screen.findByRole("region", { name: /Breadth/ });
    await waitFor(() => expect(breadth).toHaveTextContent(/Average stock vs the index · one year\s*Awaiting refresh/));
    expect(breadth).toHaveTextContent(/Small caps vs large · Russell 2000 against the S&P · one year\s*Awaiting refresh/);
    expect(breadth).toHaveTextContent(/…and their 200-day\s*Awaiting refresh/);
  });
  it("while loading, both cards are busy and neither says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/sectors": () => new Promise(() => {}) });
    renderTab();
    const cards = await screen.findAllByRole("region");
    await waitFor(() => expect(cards.filter((c) => c.getAttribute("aria-busy") === "true")).toHaveLength(2));
    expect(document.querySelector(".sc")?.textContent).not.toContain("Awaiting refresh");
  });
});
