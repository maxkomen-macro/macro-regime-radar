/**
 * Macro & Correlations (DESK_FRAME3_SPEC §6) against the §12.6 fixture: the
 * curve today and a month ago, the stock–bond correlation, credit against
 * three years, the six correlations with their meanings, the matrix under
 * Advanced, and Awaiting refresh with the labels kept when /macro fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import macro from "../../../fixtures/desk/macro.json";
import { bpText, corrText, coverTicks } from "./MacroPage";
import { placeLabel } from "../kit/LineChart";

type Block = Record<string, unknown>;
/** The fixture with one block's fields replaced. */
function withBlock(key: "curve" | "stock_bond" | "credit", over: Block) {
  return { ...macro, [key]: { ...(macro[key] as Block), ...over } };
}

/** The fixture with some blocks removed. */
function without(...keys: string[]) {
  const out: Record<string, unknown> = { ...macro };
  for (const k of keys) delete out[k];
  return out;
}

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/macro" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Macro words", () => {
  it("signs correlations and basis points, zero plain", () => {
    expect([corrText(0.31), corrText(-0.24), corrText(0)]).toEqual(["+0.31", "−0.24", "0.00"]);
    expect([bpText(41), bpText(-6), bpText(0), bpText(5.5), bpText(41.25)]).toEqual(["+41 bp", "−6 bp", "0 bp", "+5.5 bp", "+41.3 bp"]);
  });
  it("every tick's text is its gridline's value (M-1)", () => {
    const cases: [number, number, number][] = [[3.8, 4.64, 6], [3.1, 3.9, 3], [3.1, 4.6, 3], [2.6, 5.9, 4], [-0.24, 0.31, 5], [0.0012, 0.0019, 4]];
    for (const [lo, hi, max] of cases) {
      const t = coverTicks(lo, hi, max);
      expect(t.length).toBeLessThanOrEqual(max);
      expect(t[0].v).toBeLessThanOrEqual(lo);
      expect(t[t.length - 1].v).toBeGreaterThanOrEqual(hi);
      for (const x of t) expect(Number(x.text.replace("−", "-"))).toBeCloseTo(x.v, 10);
    }
    expect(coverTicks(3.8, 4.64, 6).map((x) => x.text)).toEqual(["3.8", "4.0", "4.2", "4.4", "4.6", "4.8"]);
    expect(coverTicks(3.1, 4.6, 3).map((x) => x.text)).toEqual(["3", "4", "5"]);
    // A flat series: a round unit either side, never six decimals (N-3).
    expect(coverTicks(3.12, 3.12, 3).map((x) => x.text)).toEqual(["2", "3", "4"]);
    expect(coverTicks(0, 0, 3).every((x) => x.text.length <= 6)).toBe(true);
  });
  it("places a label clear of the lines and of the labels already placed", () => {
    const plot = { top: 0, bottom: 200 };
    // A line through where the label would sit above the point pushes it below.
    expect(placeLabel(100, 100, "4.05", "middle", [[80, 92, 120, 92]], [], plot).dy).toBe(15);
    // Lines both above and below push it further out.
    expect(placeLabel(100, 100, "4.05", "middle", [[80, 92, 120, 92], [80, 112, 120, 112]], [], plot).dy).toBe(-20);
    // Nothing free: the first place.
    expect(placeLabel(100, 100, "4.05", "middle", [[100, 0, 100, 200]], [], plot).dy).toBe(-8);
  });
});

describe("Macro tab", () => {
  it("the yield curve: three stats and the two curves", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(card).toHaveTextContent("4.21%"));
    expect(card).toHaveTextContent(/10-year\s*4\.21%\s*−6 bp on the month/);
    expect(card).toHaveTextContent(/2s10s\s*\+41 bp\s*steepening · \+9 bp/);
    expect(card).toHaveTextContent(/Front end\s*3m 4\.05%\s*market leans to cuts/);
    expect(within(card).getByRole("img", { name: /Treasury yields by tenor on Sep 22, against a month ago \(Aug 21\)/ })).toBeInTheDocument();
    expect(card).toHaveTextContent("Read: the front end has come down more than the long end");
  });
  it("stock–bond: today, a year ago, when it flipped, and the warning read", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Do bonds still hedge stocks/ });
    await waitFor(() => expect(card).toHaveTextContent("+0.31"));
    expect(card).toHaveTextContent("positive · bonds not hedging");
    expect(card).toHaveTextContent(/A year ago\s*−0\.24\s*was working/);
    expect(card).toHaveTextContent(/Flipped\s*Mar 2026\s*six months positive/);
    expect(card).toHaveTextContent("Read for the desk: with correlation positive");
  });
  it("credit: the spread, its three-year range, IG, the gauge and the year", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Credit/ });
    await waitFor(() => expect(card).toHaveTextContent("3.12%"));
    expect(card).toHaveTextContent(/3-year range\s*2\.6 – 5\.9%\s*today near the low/);
    expect(card).toHaveTextContent(/Investment grade\s*0\.94%\s*also tight/);
    expect(within(card).getByRole("img", { name: "High-yield spread at the 18th percentile of three years, tight" })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: /High-yield spread over the last year; peak 4\.6% on Mar 10/ })).toBeInTheDocument();
  });
  it("what moves with the S&P: six rows with their meanings; the matrix under Advanced", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    const list = await within(card).findByRole("list", { name: "Correlation with the S&P" });
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "10-year Treasury (price)+0.31moves with · no hedge",
      "Gold+0.12no relationship",
      "Dollar−0.22weak dollar helps",
      "Oil+0.18weak",
      "Nasdaq+0.92same trade",
      "High-yield credit+0.64risk-on together",
    ]);
    fireEvent.click(within(card).getByTestId("dk-advanced"));
    expect(within(card).getByRole("table")).toHaveTextContent("60-day correlation, every pair");
    expect(within(card).getAllByRole("row")).toHaveLength(13);
    // The matrix prints numbers; it sets no threshold of its own to color them.
    expect(within(card).getByRole("table").querySelectorAll("td[data-tone]")).toHaveLength(0);
  });
  it("names each card by its title and subtitle", async () => {
    renderTab();
    for (const name of ["Yield curve today against a month ago", "Do bonds still hedge stocks? 60-day correlation of daily returns, one year", "Credit high-yield spread over Treasuries", "What moves with the S&P 60-day correlation · each asset against the index"])
      expect(await screen.findByRole("region", { name })).toBeInTheDocument();
  });
  it("each absent block keeps its labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/macro": () => without("curve", "stock_bond", "credit", "correlations") });
    renderTab();
    const curve = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(curve).toHaveTextContent(/10-year\s*Awaiting refresh/));
    expect(screen.getByRole("region", { name: /Do bonds still hedge/ })).toHaveTextContent(/Today\s*Awaiting refresh/);
    expect(screen.getByRole("region", { name: /^Credit/ })).toHaveTextContent(/HY spread\s*Awaiting refresh/);
    expect(screen.getByRole("region", { name: /What moves with the S&P/ })).toHaveTextContent("Awaiting refresh · the correlations");
  });
  it("TODAY is amber when the served call says bonds are not hedging; 2s10s is colored by the month's change", async () => {
    renderTab();
    const sb = await screen.findByRole("region", { name: /Do bonds still hedge/ });
    await waitFor(() => expect(within(sb).getByText("+0.31")).toHaveAttribute("data-tone", "amber"));
    const curve = screen.getByRole("region", { name: /Yield curve/ });
    expect(within(curve).getByText("+41 bp")).toHaveAttribute("data-tone", "up");
  });
  it("a flattening month colors 2s10s down; a malformed flip month is not served", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, curve: { ...macro.curve, "2s10s_chg_bp": -4 }, stock_bond: { ...macro.stock_bond, flipped: "2026-3" } }) });
    renderTab();
    const curve = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(within(curve).getByText("+41 bp")).toHaveAttribute("data-tone", "down"));
    expect(curve).toHaveTextContent("flattening · −4 bp");
    expect(screen.getByRole("region", { name: /Do bonds still hedge/ })).toHaveTextContent(/Flipped\s*Awaiting refresh/);
  });
  it("the served stock–bond words and hedging call; a year with no flip reads None", async () => {
    stubDesk({ "/api/desk/macro": () => withBlock("stock_bond", { today: -0.2, year_ago: 0.3, hedging: true, flipped: null, words: { today: "negative · bonds hedging", year_ago: "was not hedging", flipped: "no change of sign this year" } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Do bonds still hedge/ });
    await waitFor(() => expect(card).toHaveTextContent(/Today\s*−0\.20\s*negative · bonds hedging/));
    expect(card).toHaveTextContent(/A year ago\s*\+0\.30\s*was not hedging/);
    expect(card).toHaveTextContent(/Flipped\s*None\s*no change of sign this year/);
    expect(within(card).getByText("−0.20")).not.toHaveAttribute("data-tone", "amber");
  });
  it("null values inside a block keep their labels and print nothing unserved (M-2)", async () => {
    const m = {
      ...macro,
      curve: { ...macro.curve, "10y_chg_bp": 0, "2s10s_chg_bp": 0 },
      credit: { ...macro.credit, hy_pct_3y: null, hy_range_3y: [null, 5.9], peak_12m: { date: "2026-03-10", hy: null }, series: [] },
      stock_bond: { ...macro.stock_bond, series: [] },
      correlations: macro.correlations.map((r) => (r.asset === "Gold" ? { ...r, corr: null } : r)),
    };
    stubDesk({ "/api/desk/macro": () => m });
    renderTab();
    const curve = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(curve).toHaveTextContent("unchanged on the month"));
    expect(curve).toHaveTextContent("unchanged · 0 bp");
    expect(curve).not.toHaveTextContent("−0 bp");
    const credit = screen.getByRole("region", { name: /^Credit/ });
    expect(credit).toHaveTextContent(/3-year range\s*Awaiting refresh/);
    expect(credit).toHaveTextContent("Awaiting refresh · the three-year percentile");
    expect(credit).toHaveTextContent(/Last 12 months\s*Awaiting refresh/);
    expect(credit).not.toHaveTextContent("0.0");
    expect(screen.getByRole("region", { name: /Do bonds still hedge/ })).toHaveTextContent("Awaiting refresh · the year of correlations");
    const list = within(screen.getByRole("region", { name: /What moves with the S&P/ })).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(6);
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent(/Gold\s*Awaiting refresh/);
  });
  it("with no correlation served, the list's read is not printed", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, correlations: macro.correlations.map((r) => ({ ...r, corr: null })) }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(6));
    expect(card).not.toHaveTextContent("nothing on this list");
  });
  it("an absent block prints no read of its own (M-10)", async () => {
    stubDesk({ "/api/desk/macro": () => without("curve") });
    renderTab();
    const curve = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(curve).toHaveTextContent(/2s10s\s*Awaiting refresh/));
    expect(curve).toHaveTextContent(/Front end\s*Awaiting refresh/);
    expect(curve).not.toHaveTextContent("bull steepener");
  });
  it("the matrix is a named, focusable region with the assets' names", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    await within(card).findByRole("list");
    fireEvent.click(within(card).getByTestId("dk-advanced"));
    const wrap = within(card).getByRole("region", { name: "The 60-day correlation matrix, every pair" });
    expect(wrap).toHaveAttribute("tabindex", "0");
    expect(within(wrap).getAllByRole("columnheader").map((h) => h.textContent).slice(0, 3)).toEqual(["S&P 500", "Nasdaq 100", "10-year Treasury (price)"]);
  });
  it("chart band labels and the peak label keep the colors passed to them (M-5)", async () => {
    renderTab();
    const sb = await screen.findByRole("region", { name: /Do bonds still hedge/ });
    await waitFor(() => expect(sb.querySelectorAll(".dk-chart-band")).toHaveLength(2));
    expect([...sb.querySelectorAll<SVGTextElement>(".dk-chart-band")].map((t) => t.style.fill)).toEqual(["#e8b447", "#26dca0"]);
    const credit = screen.getByRole("region", { name: /^Credit/ });
    expect(credit.querySelector<SVGTextElement>(".dk-chart-point")?.style.fill).toBe("#8b929e");
  });
  it("while loading, the cards are busy and none says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/macro": () => new Promise(() => {}) });
    renderTab();
    const cards = await screen.findAllByRole("region");
    await waitFor(() => expect(cards.filter((c) => c.getAttribute("aria-busy") === "true")).toHaveLength(4));
    expect(document.querySelector(".mc")?.textContent).not.toContain("Awaiting refresh");
  });
  it("a failed /macro keeps every stat label and prints no number", async () => {
    stubDesk({ "/api/desk/macro": deskError(503, "warming") });
    renderTab();
    const card = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(card).toHaveTextContent("Awaiting refresh"));
    expect(card).toHaveTextContent("10-year");
    expect(card).not.toHaveTextContent("4.21");
  });
});

describe("a route served awaiting (§12.0, §1.0.2)", () => {
  it("every card keeps its title and labels and prints the served reason once, with its badge", async () => {
    stubDesk({ "/api/desk/macro": deskAwaiting("no generation stored yet.", "the first full refresh") });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Yield curve/ })).toHaveTextContent("no generation stored yet. Until: the first full refresh."));
    const curve = screen.getByRole("region", { name: /^Yield curve/ });
    for (const name of [/^Yield curve/, /^Do bonds still hedge stocks/, /^Credit/, /^What moves with the S&P/]) {
      const card = screen.getByRole("region", { name });
      expect(within(card).getAllByText(/no generation stored yet\./)).toHaveLength(1);
      expect(card).not.toHaveTextContent("Awaiting refresh");
    }
    expect(curve).toHaveTextContent(/10-year/i);
    expect(screen.getAllByTestId("dk-live").every((b) => b.textContent === "Not yet served")).toBe(true);
  });
});

describe("blocks served awaiting inside a ready answer (§12.8, §1.0.2)", () => {
  const off = (reason: string) => ({ status: "awaiting", data: null, unavailable: { reason, until: null } });
  it("stock–bond and the correlations say Not yet served with the reason once; the matrix's Advanced says not yet served; the curve and credit stand", async () => {
    const why = "Treasury and credit price-return series not ingested.";
    stubDesk({ "/api/desk/macro": () => ({ ...macro, stock_bond: off(why), correlations: off(why), matrix: off(why) }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Do bonds still hedge stocks/ })).toHaveTextContent(why));
    for (const name of [/^Do bonds still hedge stocks/, /^What moves with the S&P/]) {
      const card = screen.getByRole("region", { name });
      expect(within(card).getAllByText(why)).toHaveLength(1);
      expect(within(card).getByTestId("dk-live")).toHaveTextContent("Not yet served");
      expect(within(card).getByTestId("dk-advanced")).toBeDisabled();
    }
    expect(screen.getByRole("region", { name: /^Yield curve/ })).toHaveTextContent("4.21%");
    expect(screen.getByRole("region", { name: /^Credit/ })).toHaveTextContent("3.12%");
  });
  it("the matrix alone served awaiting disables its Advanced with not yet served; the six rows stand", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, matrix: off("not ingested.") }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What moves with the S&P/ })).toHaveTextContent("+0.92"));
    const card = screen.getByRole("region", { name: /^What moves with the S&P/ });
    expect(within(card).getByTestId("dk-advanced")).toBeDisabled();
    expect(card).toHaveTextContent("Advanced ▸ not yet served");
  });
});
