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
import { patternDef, patternWords, windowLine } from "./SectorsPage";
import { GLOSSARY } from "../kit/glossary";
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
    expect(sectors.breadth.status).toBe("ready");
    expect(sectors.breadth.data.of_total).toBe(11);
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
    // desk/pdf-polish 4: the word carries its groups and how the 5.2% under it is computed, from the served rule.
    const word = within(card).getByText("Cyclical");
    expect(word).toHaveClass("dk-term");
    expect(word).toHaveAttribute("tabindex", "0");
    expect(word.getAttribute("data-def")).toBe(patternDef(sectors.pattern as SectorPattern, sectors as unknown as SectorsResponse));
    // item 7: the six stat labels carry their definitions.
    for (const [label, id] of [["Leading", "col-leading"], ["Lagging", "col-lagging"], ["Pattern", "col-pattern"]] as const) expect(within(card).getByText(label).getAttribute("data-def")).toBe(GLOSSARY[id].text);
    const breadth = screen.getByRole("region", { name: /^Breadth/ });
    await waitFor(() => expect(within(breadth).getByText("Above 50-day")).toHaveClass("dk-term"));
    expect(within(breadth).getByText("Above 200-day").getAttribute("data-def")).toBe(GLOSSARY["col-above-200"].text);
    expect(breadth.querySelector('[data-term="col-eqw"]')?.textContent).toBe("Equal vs cap weight");
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
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { status: "awaiting", data: null, unavailable: { reason: "breadth is not computed yet.", until: null } } }) });
    renderTab();
    // The card is replaced by its unserved form once the answer arrives: read it after that.
    await waitFor(() => expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent("breadth is not computed yet."));
    const breadth = screen.getByRole("region", { name: /^Breadth/ });
    expect(within(breadth).getAllByText("breadth is not computed yet.")).toHaveLength(1);
    for (const l of ["Above 50-day", "Above 200-day", "Equal vs cap weight"]) expect(breadth).toHaveTextContent(new RegExp(l, "i"));
    expect(within(breadth).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    // desk/usability §14.13: an Advanced that would open nothing is not shown.
    expect(within(breadth).queryByTestId("dk-advanced")).toBeNull();
    // The leadership card stands beside it.
    expect(screen.getByRole("region", { name: /Sector leadership/ })).toHaveTextContent("Energy");
  });
  it("breadth: every count says of how many sectors, dated; RSP against SPY; the dots; the two lines; the note", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent("4 of 11 sectors"));
    const card = screen.getByRole("region", { name: /^Breadth/ });
    expect(card).toHaveTextContent(/Above 50-day\s*4 of 11 sectors\s*on Sep 23/);
    expect(card).toHaveTextContent(/Above 200-day\s*5 of 11 sectors\s*on Sep 23/);
    expect(card).toHaveTextContent(/Equal vs cap weight\s*−4\.2%\s*RSP vs SPY · 60 sessions/);
    expect(within(card).getByText("−4.2%")).toHaveAttribute("title", "log return, ×100");
    expect(within(card).getByText("4 of 11 sectors")).toHaveAttribute("data-tone", "default");
    const lit = (name: string) =>
      within(within(card).getByRole("list", { name }))
        .getAllByRole("listitem")
        .filter((li) => li.getAttribute("data-state") === "on")
        .map((li) => li.textContent);
    expect(lit("Which of the 11 sectors are above their 50-day")).toEqual(["Enrgabove", "Techabove", "Hlthabove", "Commabove"]);
    expect(lit("Which of the 11 sectors are above their 200-day")).toEqual(["Enrgabove", "Techabove", "Hlthabove", "Finabove", "Matabove"]);
    expect(within(card).getByRole("img", { name: /Equal weight vs cap weight · RSP against SPY, 60-session difference · one year: −4\.2% on Sep 23/ })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: /Small caps vs large · IWM against SPY, 60-session difference · one year: −9\.4% on Sep 23/ })).toBeInTheDocument();
    expect(card).toHaveTextContent("Counted over the 11 sector ETFs, not stocks. Constituent-level breadth, the stocks inside the index, needs constituent data that is not ingested yet.");
    expect(card).toHaveTextContent("on Sep 23 · averages over 50 and 200 sessions · log returns ×100 · Yahoo");
    expect(card).not.toHaveTextContent("Read:");
  });
  it("a sector a count cannot be read for is named, counted in neither n nor of, and drawn as a ring (never below)", async () => {
    const b = sectors.breadth.data;
    const { XLC: _c, ...by } = b.above_200.by_etf;
    void _c;
    const above_200 = { ...b.above_200, n: 5, of: 10, by_etf: by, not_available: [{ etf: "XLC", reason: "no close on 2025-11-05: its history starts 2026-01-02" }] };
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, data: { ...b, above_200 } } }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent(/Above 200-day\s*5 of 10 sectors\s*on Sep 23 · XLC not available/));
    const dots = within(screen.getByRole("region", { name: /^Breadth/ })).getByRole("list", { name: "Which of the 11 sectors are above their 200-day" });
    const comm = within(dots).getAllByRole("listitem")[3];
    expect(comm).toHaveAttribute("data-state", "unknown");
    expect(comm).toHaveTextContent("not available");
  });
  it("equal weight not served says why; the rest of breadth stands", async () => {
    const reason = "Awaiting refresh: the full refresh stores RSP; this database predates it.";
    const b = { ...sectors.breadth.data, eqw_vs_cap_3m: null, eqw_vs_cap_reason: reason, eqw_vs_cap_series: [], eqw_vs_cap_line_window: null };
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, data: b } }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent(/Equal vs cap weight\s*Awaiting refresh\s*Awaiting refresh: the full refresh stores RSP/));
    expect(screen.getByRole("region", { name: /^Breadth/ })).toHaveTextContent("4 of 11 sectors");
  });
  it("the ±5% axis steps to ±15% for a wider series", async () => {
    const b = sectors.breadth.data;
    stubDesk({ "/api/desk/sectors": () => ({ ...sectors, breadth: { ...sectors.breadth, data: { ...b, eqw_vs_cap_series: b.eqw_vs_cap_series.map((p, i) => (i === 100 ? { ...p, rel: 0.12 } : p)) } } }) });
    renderTab();
    // On the fixture the equal-weight line (8.4% at most) reads ±10% and the small-caps line (10.2%) ±15%; 12% steps the first to ±15% too.
    await waitFor(() => expect(within(screen.getByRole("region", { name: /^Breadth/ })).getAllByText("+15%")).toHaveLength(2));
  });
  it("names each card by its title and subtitle", async () => {
    renderTab();
    expect(await screen.findByRole("region", { name: "Sector leadership 3-month return relative to the S&P · all eleven" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Breadth is the rally wide or narrow? · of 11 sectors" })).toBeInTheDocument();
  });
  it("while loading, both cards are busy and neither says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/sectors": () => new Promise(() => {}) });
    renderTab();
    const cards = await screen.findAllByRole("region");
    await waitFor(() => expect(cards.filter((c) => c.getAttribute("aria-busy") === "true")).toHaveLength(2));
    expect(document.querySelector(".sc")?.textContent).not.toContain("Awaiting refresh");
  });
});

describe("Codex R-01: a sector without a return", () => {
  const reason = "no close on 2026-06-29: its history starts 2026-08-01";
  const xlc = { ...sectors.leadership.find((r) => r.etf === "XLC")!, rel_ret: null, ret: null, reason };
  const partial = { ...sectors, leadership: [...sectors.leadership.filter((r) => r.etf !== "XLC"), xlc], ranked_n: 10, missing: [{ etf: "XLC", name: "Communications", reason }] };
  it("the ranking says it is among the sectors with data and names the one without, with its reason", async () => {
    stubDesk({ "/api/desk/sectors": () => partial });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Sector leadership/ })).toHaveTextContent("10 of 11 with data"));
    const lead = screen.getByRole("region", { name: /^Sector leadership/ });
    expect(lead).toHaveTextContent(/Leading\s*Energy\s*\+12\.0% vs the index · among the 10 sectors with data/);
    expect(lead).toHaveTextContent(/Lagging\s*Utilities\s*−17\.7% vs the index · among the 10 sectors with data/);
    expect(within(lead).getByRole("note")).toHaveTextContent(`Not ranked, without data over the window: XLC Communications (${reason}).`);
    const items = within(within(lead).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem");
    expect(items[10]).toHaveTextContent(`XLCCommunicationsnot available · ${reason}`);
  });
  it("an answer without ranked_n and missing still qualifies the ranking, from the rows served without a return", async () => {
    const { ranked_n: _n, missing: _m, ...older } = partial;
    void [_n, _m];
    stubDesk({ "/api/desk/sectors": () => older });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Sector leadership/ })).toHaveTextContent("among the 10 sectors with data"));
    expect(within(screen.getByRole("region", { name: /^Sector leadership/ })).getByRole("note")).toHaveTextContent("XLC Communications");
  });
  it("with every sector served nothing is qualified and no note is drawn", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Sector leadership/ })).toHaveTextContent("Energy"));
    const lead = screen.getByRole("region", { name: /^Sector leadership/ });
    expect(lead).not.toHaveTextContent("with data");
    expect(within(lead).queryByRole("note")).toBeNull();
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
  it("desk/pdf-polish 4: each word's hover names the groups, the sectors in neither, and how the gap is computed", () => {
    const s = sectors as unknown as SectorsResponse;
    const lines = (word: SectorPattern["word"], spread: number) => patternDef(p(word, spread), s)?.split("\n");
    const groups = [
      "Cyclical sectors: Materials (XLB), Energy (XLE), Financials (XLF), Industrials (XLI), Technology (XLK), Discretionary (XLY).",
      "Defensive sectors: Staples (XLP), Utilities (XLU), Health care (XLV); Communications (XLC) and Real estate (XLRE) are in neither group.",
    ];
    // The owner's example: 4.5% (the live store's spread on Sep 30, 0.0455).
    expect(lines("cyclical", 0.0455)).toEqual([...groups, "Cyclical means the cyclicals lead by more than 1%: the 4.5% is their average 60-session log return in excess of SPY's, minus the defensives' average, ×100."]);
    expect(lines("defensive", -0.031)).toEqual([...groups, "Defensive means the defensives lead by more than 1%: the 3.1% is their average 60-session log return in excess of SPY's, minus the cyclicals' average, ×100."]);
    expect(lines("mixed", -0.004)).toEqual([...groups, "Mixed means neither group leads by more than 1%: the cyclicals' average 60-session log return in excess of SPY's, minus the defensives' average, ×100, is −0.4%."]);
    // The gap printed under the word is the same number the hover names.
    expect(patternWords(p("cyclical", 0.0455))?.sub).toBe("cyclical sectors ahead of defensives by 4.5%");
    expect(patternDef(p(null, null), s)).toBeNull();
    expect(patternDef({ ...p("cyclical", 0.05), defensives: [] }, s)).toBeNull();
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
