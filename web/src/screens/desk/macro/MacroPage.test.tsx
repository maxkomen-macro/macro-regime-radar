/**
 * Macro & Correlations (DESK_FRAME3_SPEC §6) against the §12.6 fixture: the
 * curve today and a month ago, the stock–bond correlation, credit against
 * three years, the served correlations with their symbols, the matrix under
 * Advanced, and Awaiting refresh with the labels kept when /macro fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import { servedMacro } from "../../../test/desk-variants";
import { bpText, corrText, coverTicks } from "./MacroPage";
import { placeLabel } from "../kit/LineChart";
import { DESK_ACCENTS } from "../kit/palette";
import macroFixture from "../../../fixtures/desk/macro.json";

type Block = Record<string, unknown>;
/** The card tests render /macro with its three deferred blocks served (§12.13); Monday serves them awaiting (tested below). */
const macro = servedMacro() as Record<string, Block> & { correlations: Block[] };
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
  stubDesk({ "/api/desk/macro": () => macro });
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
    await waitFor(() => expect(card).toHaveTextContent("4.96%"));
    // The audit's real curve (§2.5): 2y 4.71, 10y 4.96 on Sep 22; a month ago 4.24 and 4.74 (Q4).
    expect(card).toHaveTextContent(/10-year\s*4\.96%\s*\+22 bp on the month/);
    expect(card).toHaveTextContent(/2s10s\s*\+25 bp\s*flattening · −25 bp/);
    // §6: the front end says Awaiting refresh until DGS3MO is registered; the chart names the tenors not served.
    expect(card).toHaveTextContent(/Front end\s*Awaiting refresh/);
    expect([...card.querySelectorAll("text.dk-chart-axis")].map((e) => e.textContent)).toEqual(expect.arrayContaining(["3m", "2y", "5y", "10y", "30y"]));
    expect(card).toHaveTextContent("3m, 5y and 30y not served");
    // Both dates' served points are marked (2y and 10y each), and each date's line joins them (§6).
    expect(card.querySelectorAll('circle[fill="#8b929e"]')).toHaveLength(2);
    expect(card.querySelectorAll('circle[fill="#58b8e6"]')).toHaveLength(2);
    for (const color of ["#8b929e", "#58b8e6"]) expect(card.querySelector(`path[stroke="${color}"]`)?.getAttribute("d")).toMatch(/^M[\d.]+,[\d.]+L[\d.]+,[\d.]+$/);
    expect(card).not.toHaveTextContent("market leans to cuts");
    expect(within(card).getByRole("img", { name: /Treasury yields by tenor on Sep 22, against a month ago \(Aug 21\)/ })).toBeInTheDocument();
    // §1.4: no read is served on Monday, so the box is omitted.
    expect(card).not.toHaveTextContent("Read:");
  });
  it("stock–bond, served (§12.8, desk/fill-etf): today, a year ago, when it flipped, each dated; no read is served", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Do bonds still hedge stocks/ });
    await waitFor(() => expect(card).toHaveTextContent("+0.44"));
    // The API's answer on the fixture store: SPY against TLT, 60 daily log returns to Sep 23. No words, no hedging call.
    expect(card).toHaveTextContent(/Today\s*\+0\.44\s*SPY vs TLT · Sep 23\s*A year ago\s*\+0\.04\s*Sep 23, 2025\s*Flipped\s*Jan 2026\s*to positive on Jan 7, 2026/);
    expect(card).toHaveTextContent("60 daily log returns to Sep 23 · SPY vs TLT, adjusted closes · Yahoo");
    expect(card).not.toHaveTextContent(/hedging|was working|Read for the desk/);
  });
  it("a stock–bond window with a missing close says why, with no number (no forward fill)", async () => {
    const reason = "fewer than 60 complete daily return pairs in the window to 2026-09-23";
    stubDesk({ "/api/desk/macro": () => withBlock("stock_bond", { today: null, today_reason: reason }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /Do bonds still hedge/ })).toHaveTextContent(new RegExp(`Today\\s*Awaiting refresh\\s*${reason}`)));
  });
  it("credit: the spread, its three-year range, IG, the gauge and the year", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Credit/ });
    await waitFor(() => expect(card).toHaveTextContent("2.73%"));
    // §6: each spread dated; the band word is the served one; the range over its served window (the audit's §2.5, Q5).
    expect(card).toHaveTextContent(/HY spread\s*2\.73%\s*tight · Sep 23/);
    expect(card).toHaveTextContent(/3-year range\s*2\.6 – 4\.6%\s*since Sep 23, 2023/);
    expect(card).toHaveTextContent(/Investment grade\s*0\.77%\s*Sep 23/);
    // §12.8's rank over every finite observation in the window, 787 (S-12; PROVENANCE.md).
    expect(within(card).getByRole("img", { name: "High-yield spread at the 16th percentile of three years, tight" })).toBeInTheDocument();
    expect(within(card).getByRole("img", { name: /High-yield spread over the last year; peak 3\.5% on Mar 30/ })).toBeInTheDocument();
  });
  it("what moves with the S&P: nine rows as served, each with the symbol it declares, dated; the matrix under Advanced", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    const list = await within(card).findByRole("list", { name: "Correlation with the S&P" });
    // §12.8 (desk/fill-etf), the API's answer on the fixture store: each asset declares its symbol, quantity and
    // transform; no meaning words are served.
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "20+ year Treasuries+0.44TLT",
      "7–10 year Treasuries+0.50IEF",
      "High-yield bonds+0.71HYG",
      "Investment-grade bonds+0.54LQD",
      "Gold+0.36GLD",
      "Dollar−0.28UUP",
      "Small caps+0.80IWM",
      "Nasdaq 100+0.89QQQ",
      "VIX−0.75^VIX",
    ]);
    expect(within(list).getByText("IEF")).toHaveAttribute("title", "adjusted close, daily log return");
    expect(within(list).getByText("^VIX")).toHaveAttribute("title", "index level (^VIX), daily log change");
    // The rows' own dates: since desk/fill-compute the VIX is the CBOE close (^VIX), dated like the ETFs.
    expect(card).toHaveTextContent("60 daily returns to Sep 23 · each against SPY");
    expect(card).not.toHaveTextContent("VIXCLS");
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
  it("TODAY takes no color of its own (§12.13 serves no hedging call); 2s10s is colored by the month's change", async () => {
    renderTab();
    const sb = await screen.findByRole("region", { name: /Do bonds still hedge/ });
    await waitFor(() => expect(within(sb).getByText("+0.44")).toHaveAttribute("data-tone", "default"));
    const curve = screen.getByRole("region", { name: /Yield curve/ });
    // A month of flattening colors 2s10s down.
    expect(within(curve).getByText("+25 bp")).toHaveAttribute("data-tone", "down");
  });
  it("a flattening month colors 2s10s down; a malformed flip month is not served", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, curve: { ...macro.curve, "2s10s_chg_bp": -4 }, stock_bond: { ...macro.stock_bond, flipped: "2026-3" } }) });
    renderTab();
    const curve = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(within(curve).getByText("+25 bp")).toHaveAttribute("data-tone", "down"));
    expect(curve).toHaveTextContent("flattening · −4 bp");
    expect(screen.getByRole("region", { name: /Do bonds still hedge/ })).toHaveTextContent(/Flipped\s*Awaiting refresh/);
  });
  it("a year with no flip reads None; the numbers stand without words", async () => {
    stubDesk({ "/api/desk/macro": () => withBlock("stock_bond", { today: -0.2, year_ago: 0.3, flipped: null }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Do bonds still hedge/ });
    await waitFor(() => expect(card).toHaveTextContent(/Today\s*−0\.20/));
    expect(card).toHaveTextContent(/A year ago\s*\+0\.30/);
    expect(card).toHaveTextContent(/Flipped\s*None/);
    expect(within(card).getByText("−0.20")).not.toHaveAttribute("data-tone", "amber");
  });
  it("null values inside a block keep their labels and print nothing unserved (M-2)", async () => {
    const m = {
      ...macro,
      curve: { ...macro.curve, "10y_chg_bp": 0, "2s10s_chg_bp": 0 },
      credit: { ...macro.credit, hy_pct_3y: null, hy_range_3y: [null, 5.9], peak_12m: { date: "2026-03-10", hy: null }, series: [] },
      stock_bond: { ...macro.stock_bond, series: [] },
      correlations: macro.correlations.map((r) => (r.asset === "Gold" ? { ...r, corr: null, reason: null } : r)),
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
    expect(within(list).getAllByRole("listitem")).toHaveLength(9);
    expect(within(list).getAllByRole("listitem")[4]).toHaveTextContent(/Gold\s*Awaiting refresh/);
  });
  it("with no correlation served, the list's read is not printed", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, correlations: macro.correlations.map((r) => ({ ...r, corr: null })) }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(9));
    expect(card).not.toHaveTextContent("nothing on this list");
  });
  it("a row served null with its reason says not available and why; one awaiting the refresh says so (§12.8)", async () => {
    const gap = "fewer than 60 complete daily return pairs in the window to 2026-09-23";
    const refresh = "Awaiting refresh: the full refresh stores QQQ; this database predates it.";
    stubDesk({
      "/api/desk/macro": () => ({
        ...macro,
        correlations: macro.correlations.map((r) => (r.symbol === "GLD" ? { ...r, corr: null, reason: gap } : r.symbol === "QQQ" ? { ...r, corr: null, date: null, window: null, reason: refresh } : r)),
      }),
    });
    renderTab();
    const card = await screen.findByRole("region", { name: /What moves with the S&P/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")[4]).toHaveTextContent(`Goldnot available · ${gap}`));
    expect(within(card).getAllByRole("listitem")[7]).toHaveTextContent(/Nasdaq 100\s*Awaiting refresh/);
    expect(within(card).getAllByRole("listitem")[7].querySelector("[title]")).toHaveAttribute("title", refresh);
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

describe("each snapshot checked on its own date (§6, §12.8: S-29, S-30)", () => {
  const paths = (chart: HTMLElement, color: string) => [...chart.querySelectorAll("path")].filter((p) => p.getAttribute("stroke") === color);
  const dots = (chart: HTMLElement, color: string) => [...chart.querySelectorAll("circle")].filter((c) => c.getAttribute("fill") === color);
  const labels = (chart: HTMLElement) => [...chart.querySelectorAll("text")].map((t) => t.textContent);
  const apart = { date: null, dates: { ...macroFixture.curve.month_ago.dates, "2y": "2026-08-21", "10y": "2026-08-20" } };
  const serve = (curve: Record<string, unknown>) => stubDesk({ "/api/desk/macro": () => ({ ...macroFixture, curve: { ...macroFixture.curve, ...curve } }) });
  const chartOf = async () => {
    const card = await screen.findByRole("region", { name: /Yield curve/ });
    await waitFor(() => expect(within(card).getByRole("img", { name: /Treasury yields by tenor/ })).toBeInTheDocument());
    return { card, chart: within(card).getByRole("img", { name: /Treasury yields by tenor/ }) };
  };

  it("(3) both dates common: two curves, and the month ago's dates listed", async () => {
    renderTab();
    const { card, chart } = await chartOf();
    expect([paths(chart, DESK_ACCENTS.blue), paths(chart, DESK_ACCENTS.gray)].map((x) => x.length)).toEqual([1, 1]);
    expect(card).toHaveTextContent("A month ago: 2y Aug 21 · 10y Aug 21");
    expect(card).not.toHaveTextContent("Today:");
  });

  it("(2) today common, the month ago dated apart: today one curve, the month ago labelled points with no line, its dates listed", async () => {
    serve({ month_ago: { ...macroFixture.curve.month_ago, ...apart }, "2s10s_chg_bp": null, "10y_chg_bp": null });
    renderTab();
    const { card, chart } = await chartOf();
    await waitFor(() => expect(card).toHaveTextContent("A month ago: 2y Aug 21 · 10y Aug 20"));
    expect(chart.getAttribute("aria-label")).toContain("against a month ago, each tenor on its own date");
    expect([paths(chart, DESK_ACCENTS.blue), paths(chart, DESK_ACCENTS.gray)].map((x) => x.length)).toEqual([1, 0]);
    expect(dots(chart, DESK_ACCENTS.gray)).toHaveLength(2);
    // Each point labelled with its tenor and date; the last also names the snapshot.
    expect(labels(chart)).toEqual(expect.arrayContaining(["2y Aug 21", "a month ago · 10y Aug 20", "4.71", "4.96"]));
    // S-29: a difference whose month-ago date is null is null: no "on the month", no steepening word.
    expect(card).not.toHaveTextContent(/on the month|steepening|flattening/);
  });

  it("(1) both dates null, each tenor on its own date: both snapshots labelled points with no line, both sets of dates listed", async () => {
    serve({
      today: { ...macroFixture.curve.today, date: null, dates: { ...macroFixture.curve.today.dates, "2y": "2026-09-22", "10y": "2026-09-21" } },
      month_ago: { ...macroFixture.curve.month_ago, ...apart },
      "2s10s_bp": null,
      "2s10s_chg_bp": null,
      "10y_chg_bp": null,
    });
    renderTab();
    const { card, chart } = await chartOf();
    await waitFor(() => expect(card).toHaveTextContent("Today: 2y Sep 22 · 10y Sep 21"));
    expect(card).toHaveTextContent("A month ago: 2y Aug 21 · 10y Aug 20");
    expect(chart.getAttribute("aria-label")).toContain("today each tenor on its own date");
    expect([paths(chart, DESK_ACCENTS.blue), paths(chart, DESK_ACCENTS.gray)].map((x) => x.length)).toEqual([0, 0]);
    expect([dots(chart, DESK_ACCENTS.blue), dots(chart, DESK_ACCENTS.gray)].map((x) => x.length)).toEqual([2, 2]);
    expect(labels(chart)).toEqual(expect.arrayContaining(["2y Sep 22", "today · 10y Sep 21", "2y Aug 21", "a month ago · 10y Aug 20"]));
    // Today's values print on the stats, not on unjoined points.
    expect(labels(chart)).not.toContain("4.71");
    expect(card).toHaveTextContent(/2s10s\s*Awaiting refresh/);
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
  it("as the fixture serves /macro: the correlations stand, the matrix's Advanced says not yet served; the curve, stock–bond and credit stand", async () => {
    // /macro as the fixture serves it (desk/fill-etf item 5): stock–bond and the correlations served, the matrix awaiting.
    stubDesk();
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What moves with the S&P/ })).toHaveTextContent("+0.89"));
    const card = screen.getByRole("region", { name: /^What moves with the S&P/ });
    expect(within(card).getByTestId("dk-advanced")).toBeDisabled();
    expect(card).toHaveTextContent("Advanced ▸ not yet served");
    expect(screen.getByRole("region", { name: /^Do bonds still hedge stocks/ })).toHaveTextContent("+0.44");
    expect(screen.getByRole("region", { name: /^Yield curve/ })).toHaveTextContent("4.96%");
    expect(screen.getByRole("region", { name: /^Credit/ })).toHaveTextContent("2.73%");
  });
  it("stock–bond served awaiting a refresh prints its reason and badges Awaiting refresh (§1.7)", async () => {
    const why = "Awaiting refresh: the full refresh stores TLT; this database predates it.";
    stubDesk({ "/api/desk/macro": () => ({ ...macro, stock_bond: off(why) }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Do bonds still hedge stocks/ })).toHaveTextContent(why));
    const card = screen.getByRole("region", { name: /^Do bonds still hedge stocks/ });
    expect(within(card).getByTestId("dk-live")).toHaveTextContent("Awaiting refresh");
    for (const l of ["Today", "A year ago", "Flipped"]) expect(card).toHaveTextContent(l);
  });
  it("the matrix alone served awaiting disables its Advanced with not yet served; the six rows stand", async () => {
    stubDesk({ "/api/desk/macro": () => ({ ...macro, matrix: off("not ingested.") }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What moves with the S&P/ })).toHaveTextContent("+0.89"));
    const card = screen.getByRole("region", { name: /^What moves with the S&P/ });
    expect(within(card).getByTestId("dk-advanced")).toBeDisabled();
    expect(card).toHaveTextContent("Advanced ▸ not yet served");
  });
});
