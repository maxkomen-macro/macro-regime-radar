/**
 * Regime (DESK_FRAME3_SPEC §5) against the §12.5 fixture: the label and its
 * five-year strip, the recession model labeled as the one fitted thing, the
 * regime table with the current row marked, the next two prints spelled from
 * their served thresholds, the last five changes, and Awaiting refresh with
 * the labels kept when /regime fails.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import regime from "../../../fixtures/desk/regime.json";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { flipTone, flipWords, mom, runs, stockBondTone, trendTone } from "./RegimePage";

type Over = Record<string, unknown>;
/** The fixture with some blocks replaced (or removed with `undefined`). */
function served(over: Over) {
  const out: Over = { ...regime };
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/regime" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Regime words", () => {
  it("groups the monthly history into runs", () => {
    const r = runs(regime.history);
    expect(r.map((x) => x.regime)).toEqual(["Goldilocks", "Overheating", "Stagflation", "Recession Risk", "Goldilocks", "Overheating", "Stagflation", "Goldilocks", "Overheating"]);
    expect(r[r.length - 1]).toMatchObject({ from: "2026-06", to: "2026-08", months: 3 });
    expect(r.reduce((a, x) => a + x.months, 0)).toBe(regime.history.length);
  });
  it("spells the flip from the served threshold, never a typed one", () => {
    expect(flipWords("cpi", regime.next_prints.cpi, "rising")).toBe("a soft print (<0.2% m/m) flips inflation to falling → Goldilocks");
    expect(flipWords("indpro", regime.next_prints.indpro, "rising")).toBe("a negative print flips growth to falling → Stagflation");
  });
  it("a falling trend flips on a print above the threshold (G-2)", () => {
    expect(flipWords("cpi", { flip_threshold_mom: 0.004, flips_to: "Overheating" }, "falling")).toBe("a hot print (>0.4% m/m) flips inflation to rising → Overheating");
    expect(flipWords("indpro", { flip_threshold_mom: 0, flips_to: "Goldilocks" }, "falling")).toBe("a positive print flips growth to rising → Goldilocks");
    expect(flipWords("indpro", { flip_threshold_mom: -0.001, flips_to: "Goldilocks" }, "falling")).toBe("a print above −0.1% m/m flips growth to rising → Goldilocks");
    expect(flipWords("indpro", { flip_threshold_mom: -0.001, flips_to: "Stagflation" }, "rising")).toBe("a print below −0.1% m/m flips growth to falling → Stagflation");
  });
  it("prints the served precision, and nothing without a threshold or a trend", () => {
    expect(flipWords("cpi", { flip_threshold_mom: 0.0015, flips_to: "Goldilocks" }, "rising")).toBe("a soft print (<0.15% m/m) flips inflation to falling → Goldilocks");
    expect(flipWords("cpi", { flip_threshold_mom: null as unknown as number, flips_to: "Goldilocks" }, "rising")).toBeNull();
    expect(flipWords("cpi", regime.next_prints.cpi, undefined)).toBeNull();
    expect(flipWords("cpi", { flip_threshold_mom: 0.002, flips_to: null as unknown as string }, "rising")).toBeNull();
    expect([mom(0.00003), mom(0.002), mom(0)]).toEqual(["0.003", "0.2", "0"]);
  });
  it("colors by §1.3's jobs: red is only for down numbers", () => {
    expect(flipTone("Goldilocks")).toBe("green");
    expect(flipTone("Stagflation")).toBe("amber");
    expect(flipTone("Recession Risk")).toBeUndefined();
    expect(trendTone("growth", "falling")).toBe("red");
    expect(trendTone("inflation", "falling")).toBe("green");
    expect(trendTone("inflation", null)).toBeUndefined();
    expect([stockBondTone(-0.2), stockBondTone(0.3), stockBondTone(0)]).toEqual(["green", "amber", undefined]);
  });
});

describe("Regime tab", () => {
  it("where we are: the label, the lede, three stats, the strip, the rule", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: "Where we are rule-based · two-month lag" });
    await waitFor(() => expect(card).toHaveTextContent("Overheating"));
    // §5: the Jul row governs a September session; the newest stored row sits beside it, never classifying.
    expect(card).toHaveTextContent("Growth rising and inflation rising. Second month in a row.");
    expect(card).toHaveTextContent(/In this regime\s*2 mo\s*since the June row/);
    expect(card.querySelector(".rg-latest")?.textContent).toBe("Latest print: Aug 2026");
    const strip = within(card).getByRole("img", { name: /Regime by month from Jan 2021 to Aug 2026/ });
    const segs = [...strip.querySelectorAll("span")];
    expect(segs.map((x) => x.getAttribute("data-tone"))).toEqual(["green", "amber", "red", "gray", "green", "amber", "red", "green", "amber"]);
    expect(segs[segs.length - 1].style.width).toBe(`${(3 / 68) * 100}%`);
    // Ticks 2021…2025, then today (§5): the strip's own last year is today's.
    expect(card.querySelector(".rg-strip-years")?.textContent).toBe("20212022202320242025today");
    expect(card).toHaveTextContent("How it's decided: two signs");
  });
  it("recession: the model's score, its band, the month it is for, the gauge, the three stats and what it is (§5)", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Recession score/ });
    await waitFor(() => expect(card).toHaveTextContent("12%"));
    expect(card.querySelector(".rg-rec-line")?.textContent).toBe("12%Low.");
    // A month keeps its year on the same line.
    expect(card.querySelector(".rg-rec-for")?.textContent).toBe("score for Aug\u00a02026 · inputs through May\u00a02026");
    const gauge = within(card).getByRole("img", { name: "Recession score 12%, low" });
    expect(gauge.textContent).toBe("LowElevatedHigh risk · above 40%");
    expect([...gauge.querySelectorAll(".dk-gauge-track > span[data-tone]")].map((x) => (x as HTMLElement).style.width)).toEqual(["20%", "20%", "60%"]);
    expect(card).toHaveTextContent(/Inputs through\s*May/);
    expect(card).toHaveTextContent(/A year ago\s*17%\s*Aug 2025/);
    // The engine's full-precision peak, 0.95497…, prints 95% (§12.0: full precision; one rounding rule in the kit).
    expect(card).toHaveTextContent(/Peak since 2015\s*95%\s*Jun 2020/);
    expect(card).toHaveTextContent("What it is: a fitted model — five monthly indicators against NBER recession dates, trained Apr 2003 to Sep 2026; historical scores are in-sample.");
    expect(card.textContent).not.toMatch(/one-in-|over the next year|since 1970|Peak last cycle|Watch/);
  });
  it("Elevated is §5's word; without a served training span the box says nothing about one; without a latest print, no line", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: { ...regime.current, latest_print: undefined }, recession: { ...regime.recession, band: "elevated", score: 0.27, training: null } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Recession score/ });
    await waitFor(() => expect(card.querySelector(".rg-rec-line")?.textContent).toBe("27%Elevated."));
    expect(card).toHaveTextContent("What it is: a fitted model — five monthly indicators against NBER recession dates; historical scores are in-sample.");
    expect(screen.getByRole("region", { name: /Where we are/ }).querySelector(".rg-latest")).toBeNull();
  });
  it("a year ago served null prints a dash, not Awaiting refresh; each band word is §5's", async () => {
    stubDesk({ "/api/desk/regime": () => served({ recession: { ...regime.recession, year_ago: null, band: "high_risk", score: 0.46 } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Recession score/ });
    await waitFor(() => expect(card.querySelector(".rg-rec-line")?.textContent).toBe("46%High risk."));
    expect(card).toHaveTextContent(/A year ago\s*—/);
    expect(card).not.toHaveTextContent(/A year ago\s*Awaiting refresh/);
  });
  it("what each regime has meant: the table with the current row marked, and the desk's read", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /What each regime has meant/ });
    await waitFor(() => expect(within(card).getAllByRole("row")).toHaveLength(5));
    const cur = within(card).getAllByRole("row").find((r) => r.getAttribute("aria-current") === "true");
    expect(cur?.textContent).toContain("Overheating88+0.9%59%17+0.3");
    expect(card).toHaveTextContent("Read for the desk: Overheating has been fine for equities");
  });
  it("what would change it: the next prints and the last five changes", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /What would change it/ });
    await waitFor(() => expect(card).toHaveTextContent("Oct 14"));
    expect(card).toHaveTextContent("Oct 17");
    expect(within(card).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Jun 2026Goldilocks → Overheating+2.1%",
      "Oct 2025Stagflation → Goldilocks+3.8%",
      "Mar 2025Overheating → Stagflation−4.2%",
      "Aug 2024Goldilocks → Overheating+1.1%",
      "Jan 2024Recession Risk → Goldilocks+5.3%",
    ]);
  });
  it("the bands follow band_edges, and a missing band word is left out", async () => {
    stubDesk({ "/api/desk/regime": () => served({ recession: { ...regime.recession, band: null, band_edges: [0.3, 0.6] } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Recession score/ });
    const gauge = await within(card).findByRole("img", { name: "Recession score 12%" });
    expect(gauge.textContent).toBe("LowElevatedHigh risk · above 60%");
    expect(card.querySelector(".rg-rec-line")?.textContent).toBe("12%");
  });

  it("a different current regime moves the marked row", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: { ...regime.current, label: "Goldilocks" } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /What each regime has meant/ });
    await waitFor(() => expect(within(card).getAllByRole("row").find((r) => r.getAttribute("aria-current") === "true")?.textContent).toContain("Goldilocks"));
  });

  it("while loading, every card is busy and none says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/regime": () => new Promise(() => {}) });
    renderTab();
    const cards = await screen.findAllByRole("region");
    await waitFor(() => expect(cards.filter((c) => c.getAttribute("aria-busy") === "true")).toHaveLength(4));
    expect(document.querySelector(".rg")?.textContent).not.toContain("Awaiting refresh");
  });

  it("each absent block keeps its labels and says Awaiting refresh (G-1)", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: undefined, recession: undefined, stats: undefined, next_prints: undefined, changes: undefined, history: [] }) });
    renderTab();
    const where = await screen.findByRole("region", { name: /Where we are/ });
    await waitFor(() => expect(where).toHaveTextContent(/Growth\s*Awaiting refresh/));
    expect(where).toHaveTextContent(/Inflation\s*Awaiting refresh/);
    expect(where).toHaveTextContent(/Last five years\s*Awaiting refresh/);
    const rec = screen.getByRole("region", { name: /Recession score/ });
    expect(rec).toHaveTextContent(/Inputs through\s*Awaiting refresh/);
    expect(rec).toHaveTextContent(/Peak since 2015\s*Awaiting refresh/);
    const meant = screen.getByRole("region", { name: /What each regime has meant/ });
    expect(meant).toHaveTextContent(/Stock–bond/);
    expect(meant).toHaveTextContent("Awaiting refresh");
    const change = screen.getByRole("region", { name: /What would change it/ });
    expect(change).toHaveTextContent(/Next CPI\s*Awaiting refresh/);
    expect(change).toHaveTextContent(/Next INDPRO\s*Awaiting refresh/);
    expect(change).toHaveTextContent(/S&P a month later\s*Awaiting refresh/);
  });

  it("null trends and a null probability: no broken sentence, the stats say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: { ...regime.current, growth: null, inflation: null }, recession: { ...regime.recession, score: null } }) });
    renderTab();
    const where = await screen.findByRole("region", { name: /Where we are/ });
    await waitFor(() => expect(where).toHaveTextContent(/Growth\s*Awaiting refresh/));
    expect(where).not.toHaveTextContent("Growth and inflation");
    expect(where).toHaveTextContent("Overheating");
    const rec = screen.getByRole("region", { name: /Recession score/ });
    expect(rec).toHaveTextContent("Awaiting refresh · the recession score");
    expect(rec).toHaveTextContent(/Inputs through\s*May/);
    const change = screen.getByRole("region", { name: /What would change it/ });
    expect(change).toHaveTextContent(/Next CPI\s*Awaiting refresh/);
  });

  it("a served current without its label says so", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: { ...regime.current, label: null } }) });
    renderTab();
    const where = await screen.findByRole("region", { name: /Where we are/ });
    await waitFor(() => expect(where).toHaveTextContent("Awaiting refresh · the regime label"));
    expect(where).toHaveTextContent("Growth rising and inflation rising.");
  });

  it("a failed /regime keeps the stat labels and the method boxes, prints no number", async () => {
    stubDesk({ "/api/desk/regime": deskError(503, "warming") });
    renderTab();
    const card = await screen.findByRole("region", { name: /Where we are/ });
    await waitFor(() => expect(card).toHaveTextContent("Awaiting refresh"));
    expect(card).toHaveTextContent("Growth");
    expect(card).not.toHaveTextContent("Overheating");
    expect(screen.getByRole("region", { name: /Recession score/ })).not.toHaveTextContent("12%");
    expect(screen.getByRole("region", { name: /What would change it/ })).toHaveTextContent(/Next CPI\s*Awaiting refresh/);
    expect(screen.getByRole("region", { name: /What each regime has meant/ })).toHaveTextContent(/Regime\s*Months/);
  });
});

describe("blocks served awaiting inside a ready answer (§12.6, §1.0.2)", () => {
  const off = (reason: string) => ({ status: "awaiting", data: null, unavailable: { reason, until: null } });
  it("the statistics card keeps its labels, prints its reason once and says Not yet served; the next prints stand beside the changes' reason", async () => {
    stubDesk({ "/api/desk/regime": () => ({ ...regime, stats: off("regime statistics not yet defined in the engine."), changes: off("regime statistics not yet defined in the engine.") }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What each regime has meant/ })).toHaveTextContent("regime statistics not yet defined in the engine."));
    const meant = screen.getByRole("region", { name: /^What each regime has meant/ });
    for (const l of ["Regime", "Months", "Up", "VIX avg"]) expect(meant).toHaveTextContent(new RegExp(l, "i"));
    expect(within(meant).getAllByText("regime statistics not yet defined in the engine.")).toHaveLength(1);
    expect(within(meant).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(within(meant).getByTestId("dk-advanced")).toBeDisabled();
    expect(meant).not.toHaveTextContent("Awaiting refresh");
    const change = screen.getByRole("region", { name: /^What would change it/ });
    expect(change).toHaveTextContent("Oct 14");
    expect(within(change).getAllByText("regime statistics not yet defined in the engine.")).toHaveLength(1);
    expect(change).not.toHaveTextContent("Awaiting refresh");
  });
});
