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
import { servedRegime } from "../../../test/desk-variants";
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
    // The stored rows (the audit's store): five years of Overheating and Stagflation turns, then the July Goldilocks row and August's Overheating.
    expect(r[0]).toMatchObject({ regime: "Overheating", from: "2021-08" });
    expect(r.slice(-2)).toEqual([expect.objectContaining({ regime: "Goldilocks", from: "2026-07", to: "2026-07", months: 1 }), expect.objectContaining({ regime: "Overheating", from: "2026-08", to: "2026-08", months: 1 })]);
    expect(r).toHaveLength(25);
    expect(r.reduce((a, x) => a + x.months, 0)).toBe(regime.history.length);
  });
  it("spells the flip from the served threshold and operator, never a typed one (§5)", () => {
    expect(flipWords("cpi", regime.next_prints.cpi as never)).toBe("a print ≤ −0.39% m/m flips inflation to falling → Goldilocks, effective from the Nov 2026 label.");
    expect(flipWords("indpro", regime.next_prints.indpro as never)).toBe("a print ≤ −0.02% m/m flips growth to falling → Stagflation, effective from the Nov 2026 label.");
  });
  it("`>` flips a falling axis to rising (v3 §9.3)", () => {
    const p = { threshold_mom: 0.004, operator: ">" as const, flips_to: "Overheating", first_effective_month: "2026-11" };
    expect(flipWords("cpi", p)).toBe("a print > 0.4% m/m flips inflation to rising → Overheating, effective from the Nov 2026 label.");
    expect(flipWords("indpro", { ...p, threshold_mom: -0.001, flips_to: "Goldilocks" })).toBe("a print > −0.1% m/m flips growth to rising → Goldilocks, effective from the Nov 2026 label.");
  });
  it("prints the served precision, and nothing without a threshold; a flip not evaluable names no regime", () => {
    const p = { threshold_mom: 0.0015, operator: "<=" as const, flips_to: "Goldilocks", first_effective_month: "2026-11" };
    expect(flipWords("cpi", p)).toBe("a print ≤ 0.15% m/m flips inflation to falling → Goldilocks, effective from the Nov 2026 label.");
    expect(flipWords("cpi", { ...p, threshold_mom: null })).toBeNull();
    expect(flipWords("cpi", { ...p, flips_to: null })).toBe("a print ≤ 0.15% m/m flips inflation to falling, effective from the Nov 2026 label.");
    expect([mom(0.00003), mom(0.002), mom(0)]).toEqual(["0.003", "0.2", "0"]);
  });
  it("colors by §1.3's jobs: red is only for down numbers", () => {
    expect(flipTone("Goldilocks")).toBe("green");
    expect(flipTone("Stagflation")).toBe("amber");
    expect(flipTone("Recession Risk")).toBeUndefined();
    expect(trendTone("growth", "falling")).toBe("red");
    // §1.3: green only ever means up, Reliable, firing or current; a falling inflation trend is down.
    expect(trendTone("inflation", "falling")).toBe("red");
    expect(trendTone("inflation", null)).toBeUndefined();
    expect([stockBondTone(-0.2), stockBondTone(0.3), stockBondTone(0)]).toEqual(["green", "amber", undefined]);
  });
});

describe("Regime tab", () => {
  it("where we are: the label, the lede, three stats, the strip, the rule", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: "Where we are rule-based · two-month lag" });
    await waitFor(() => expect(card).toHaveTextContent("Goldilocks"));
    // §5: the Jul row (Goldilocks, as stored) governs a September session; the newest stored row (Aug, Overheating) sits beside it, never classifying.
    // §5's lede, "<Nth> month in a row", in its first month too (the audit's Q13: 1 month in).
    expect(card).toHaveTextContent("Growth rising and inflation falling. First month in a row.");
    // §1.3's exception (v2 D-36) and §5: the label in its regime's color.
    expect(card.querySelector(".rg-big")).toHaveAttribute("data-tone", "green");
    expect(card).toHaveTextContent(/In this regime\s*1 mo\s*since the July row/);
    expect(card.querySelector(".rg-latest")?.textContent).toBe("Latest print: Aug 2026");
    const strip = within(card).getByRole("img", { name: /Regime by month from Aug 2021 to Aug 2026/ });
    const segs = [...strip.querySelectorAll("span")];
    expect(segs).toHaveLength(25);
    expect(segs.slice(-2).map((x) => x.getAttribute("data-tone"))).toEqual(["green", "amber"]);
    expect(segs[segs.length - 1].style.width).toBe(`${(1 / 60) * 100}%`);
    // §5: the served note under the strip.
    expect(card).toHaveTextContent("labels as stored; revisions are not replayed.");
    // Each January from 2022 to 2025, then today (§5): the strip's own last year is today's.
    expect(card.querySelector(".rg-strip-years")?.textContent).toBe("2022202320242025today");
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
  it("what each regime has meant, served (§12.13's deferred shape): the table with the current row marked", async () => {
    stubDesk({ "/api/desk/regime": servedRegime });
    renderTab();
    const card = await screen.findByRole("region", { name: /What each regime has meant/ });
    await waitFor(() => expect(within(card).getAllByRole("row")).toHaveLength(5));
    const cur = within(card).getAllByRole("row").find((r) => r.getAttribute("aria-current") === "true");
    // The current row is the governing (K−2) label, Goldilocks; its months are the stored record's (27).
    expect(cur?.textContent).toContain("Goldilocks27+1.4%66%15−0.2");
    // §12.13's deferred shape carries no read (§1.4: no read is served).
    expect(card).not.toHaveTextContent("Read for the desk");
  });
  it("what would change it: the next prints, and the last five changes once served", async () => {
    stubDesk({ "/api/desk/regime": servedRegime });
    renderTab();
    const card = await screen.findByRole("region", { name: /What would change it/ });
    await waitFor(() => expect(card).toHaveTextContent("Oct 14"));
    // §5: the calendar has no INDPRO release, so its date says so.
    expect(card).toHaveTextContent(/Next INDPRO\s*—\s*release date unavailable · a print ≤ −0.02% m\/m flips growth to falling → Stagflation/);
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
    stubDesk({ "/api/desk/regime": () => ({ ...servedRegime(), current: { ...regime.current, label: "Goldilocks" } }) });
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
    expect(where).toHaveTextContent("Goldilocks");
    const rec = screen.getByRole("region", { name: /Recession score/ });
    expect(rec).toHaveTextContent("Awaiting refresh · the recession score");
    expect(rec).toHaveTextContent(/Inputs through\s*May/);
    // The flip is spelled from the served operator, so it stands without today's trends (§12.6).
    const change = screen.getByRole("region", { name: /What would change it/ });
    expect(change).toHaveTextContent(/Next CPI\s*Oct 14/);
  });

  it("a served current without its label says so", async () => {
    stubDesk({ "/api/desk/regime": () => served({ current: { ...regime.current, label: null } }) });
    renderTab();
    const where = await screen.findByRole("region", { name: /Where we are/ });
    await waitFor(() => expect(where).toHaveTextContent("Awaiting refresh · the regime label"));
    expect(where).toHaveTextContent("Growth rising and inflation falling.");
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
  it("the statistics card keeps its labels, prints its reason once and says Not yet served; the next prints stand beside the changes' reason", async () => {
    // Monday's /regime as the fixture serves it (§1.0, §12.6): stats and changes awaiting.
    stubDesk();
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
