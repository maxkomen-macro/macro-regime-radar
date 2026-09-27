/**
 * Sectors (DESK_FRAME3_SPEC §7, §12.14) against the served fixture
 * (desk/fill-etf: the API's answer on the fixture store, PROVENANCE.md): all
 * eleven sectors ranked as served with LEADING, LAGGING and PATTERN; a row the
 * store cannot compute says why ("not available"), never a value; the breadth
 * block and the whole route, served awaiting, keep their labels and print the
 * served reason (§1.0.2).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, stubDesk } from "../../../test/desk";
import sectors from "../../../fixtures/desk/sectors.json";
import { patternWords, windowLine } from "./SectorsPage";
import type { SectorPattern, SectorsResponse } from "../data/types";

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
  stubDesk({ "/api/desk/sectors": () => sectors });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ORDER = ["XLE", "XLK", "XLV", "XLC", "XLF", "XLB", "XLP", "XLY", "XLRE", "XLI", "XLU"];
const REFRESH = "Awaiting refresh: the full refresh stores XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLRE, XLU, XLV, XLY; this database predates it.";

describe("Sectors tab", () => {
  it("the fixture is the API's answer: eleven ranked as served, the window dated, breadth its own block", () => {
    expect(sectors.leadership.map((r) => r.etf)).toEqual(ORDER);
    expect(sectors.window).toEqual({ start: "2026-06-29", end: "2026-09-23", n: 60 });
    expect(sectors.pattern.word).toBe("cyclical");
    expect(sectors.breadth).toEqual({ status: "awaiting", data: null, unavailable: { reason: "breadth is not computed yet.", until: null } });
  });
  it("leadership: all eleven, ranked, with the leader, the laggard and the pattern by its rule", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Sector leadership/ });
    const list = await within(card).findByRole("list", { name: /All eleven/ });
    expect(within(list).getAllByRole("listitem").map((li) => li.querySelector(".dk-rank-ticker")?.textContent)).toEqual(ORDER);
    expect(card).toHaveTextContent(/Leading\s*Energy\s*\+12\.0% vs the index/);
    expect(card).toHaveTextContent(/Lagging\s*Utilities\s*−17\.7% vs the index/);
    expect(card).toHaveTextContent(/Pattern\s*Cyclical\s*cyclical sectors ahead of defensives by 5\.2%/);
    // §1.9: a log fraction prints ×100 with its hover text; the window says what the bars measure.
    expect(within(list).getAllByTitle("log return, ×100")).toHaveLength(11);
    expect(card).toHaveTextContent("60 sessions to Sep 23 (from Jun 29) · log returns ×100 · SPY +3.8% over the same sessions");
    // §12.0: no read without a rule.
    expect(card).not.toHaveTextContent("Read:");
  });
  it("the badge dates the served comparison session and names the served provider (§1.6)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getAllByTestId("dk-live")[0]).toHaveTextContent("Live · Yahoo · Sep 23"));
  });
  it("a row the store cannot compute says why and ranks last; the leader and laggard are the served ends (S-4)", async () => {
    const reason = "no close on 2026-06-29: its history starts 2026-08-01";
    const rows = [...sectors.leadership.filter((r) => r.etf !== "XLE"), { ...sectors.leadership[0], rel_ret: null, ret: null, reason }];
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, leadership: rows, pattern: { ...sectors.pattern, word: null, spread: null, reason: "XLE not served, so the groups cannot be compared." } }) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent(/Leading\s*Technology/));
    expect(lead).toHaveTextContent(/Lagging\s*Utilities/);
    const items = within(within(lead).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem");
    expect(items[10]).toHaveTextContent(`XLEEnergynot available · ${reason}`);
    expect(items[10]).not.toHaveTextContent("%");
    expect(lead).toHaveTextContent(/Pattern\s*Awaiting refresh\s*XLE not served, so the groups cannot be compared\./);
  });
  it("breadth is its own block: served awaiting, its card keeps its labels and prints the reason once", async () => {
    renderTab();
    // The card is replaced by its unserved form once the answer arrives: read it after that.
    await waitFor(() => expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent("breadth is not computed yet."));
    const breadth = screen.getByRole("region", { name: /^Breadth/ });
    expect(within(breadth).getAllByText("breadth is not computed yet.")).toHaveLength(1);
    for (const l of ["Above 50-day", "Above 200-day", "Equal vs cap weight"]) expect(breadth).toHaveTextContent(new RegExp(l, "i"));
    expect(within(breadth).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(within(breadth).getByTestId("dk-advanced")).toBeDisabled();
    // The leadership card stands beside it.
    expect(screen.getByRole("region", { name: /Sector leadership/ })).toHaveTextContent("Energy");
  });
  it("names each card by its title and subtitle", async () => {
    renderTab();
    expect(await screen.findByRole("region", { name: "Sector leadership 3-month return relative to the S&P · all eleven" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Breadth is the rally wide or narrow?" })).toBeInTheDocument();
  });
  it("while loading, both cards are busy and neither says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/sectors": () => new Promise(() => {}) });
    renderTab();
    const cards = await screen.findAllByRole("region");
    await waitFor(() => expect(cards.filter((c) => c.getAttribute("aria-busy") === "true")).toHaveLength(2));
    expect(document.querySelector(".sc")?.textContent).not.toContain("Awaiting refresh");
  });
});

describe("the pattern words and the window line (§12.14)", () => {
  const p = (word: SectorPattern["word"], spread: number | null): SectorPattern => ({ ...(sectors.pattern as SectorPattern), word, spread });
  it("each word with its sub-line from the served spread; nothing without a word", () => {
    expect(patternWords(p("cyclical", 0.0516))).toEqual({ value: "Cyclical", sub: "cyclical sectors ahead of defensives by 5.2%" });
    expect(patternWords(p("defensive", -0.031))).toEqual({ value: "Defensive", sub: "defensives ahead of cyclical sectors by 3.1%" });
    expect(patternWords(p("mixed", 0.004))).toEqual({ value: "Mixed", sub: "neither group ahead by more than 1%" });
    expect(patternWords(p(null, null))).toBeNull();
    expect(patternWords(undefined)).toBeNull();
  });
  it("the window line reads the served window and SPY's own return", () => {
    expect(windowLine(sectors as unknown as SectorsResponse)).toBe("60 sessions to Sep 23 (from Jun 29) · log returns ×100 · SPY +3.8% over the same sessions");
    expect(windowLine({ ...(sectors as unknown as SectorsResponse), window: undefined })).toBe("");
  });
});

describe("a route served awaiting (§12.0, §1.0.2)", () => {
  it("before the refresh stores the ETFs: both cards keep their labels, print the reason once each, and say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/sectors": deskAwaiting(REFRESH) });
    renderTab();
    const lead = await screen.findByRole("region", { name: /^Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent(REFRESH));
    const breadth = screen.getByRole("region", { name: /^Breadth/ });
    for (const [card, labels] of [
      [lead, ["Leading", "Lagging", "Pattern"]],
      [breadth, ["Above 50-day", "Above 200-day", "Equal vs cap weight"]],
    ] as const) {
      for (const l of labels) expect(card).toHaveTextContent(new RegExp(l, "i"));
      expect(within(card).getAllByText(REFRESH)).toHaveLength(1);
    }
    // §1.7: a reason that begins "Awaiting refresh" badges as such.
    expect(screen.getAllByTestId("dk-live").map((b) => b.textContent)).toContain("Awaiting refresh");
  });
});
