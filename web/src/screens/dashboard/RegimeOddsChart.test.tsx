/**
 * Iteration 2 F1: the odds chart is four lines, not stacked bands.
 *
 * The Done-when in ITERATION_2.md asks for four things this file can hold
 * honestly in jsdom: each visible series is its own traceable line; the
 * called regime reads as dominant without reading the legend; the legend is
 * inline, sorted high to low, and doubles as the crosshair readout; and
 * keyboard focus reaches the chart and announces the current month's values.
 * The width-dependent half (no two text elements overlap at any G6 width) is
 * geometry, so it belongs to the browser sweep, not here.
 *
 * `seriesPlan` and `legendOrder` are exported so the narrow-column reduction
 * can be asserted without a matchMedia shim: jsdom has none, and the hook
 * deliberately answers "wide" when it cannot measure.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { Regime } from "../../api/types";
import { RegimeOddsChart, fitKeys, keyWidth, legendOrder, seriesPlan } from "./RegimeOddsChart";

const row = (date: string, label: Regime["label"], g: number, o: number, s: number, r: number): Regime => ({
  date,
  label,
  confidence: 0.5,
  growth_trend: 0,
  inflation_trend: 0,
  prob_goldilocks: g,
  prob_overheating: o,
  prob_stagflation: s,
  prob_recession: r,
});

/** Four months ending on a Goldilocks call: GL 58, RR 31, OH 7, SF 4. */
const GOLDILOCKS: Regime[] = [
  row("2026-06-01", "Recession Risk", 0.33, 0.09, 0.06, 0.52),
  row("2026-07-01", "Goldilocks", 0.5, 0.07, 0.04, 0.39),
  row("2026-08-01", "Goldilocks", 0.55, 0.07, 0.04, 0.34),
  row("2026-09-01", "Goldilocks", 0.58, 0.07, 0.04, 0.31),
];

/** The acceptance database's call: Overheating leads, Stagflation challenges. */
const OVERHEATING: Regime[] = [
  row("2026-06-01", "Overheating", 0.07, 0.48, 0.3, 0.15),
  row("2026-07-01", "Goldilocks", 0.61, 0.004, 0.3, 0.09),
  row("2026-08-01", "Overheating", 0.11, 0.4246, 0.3698, 0.0957),
];

const chart = () => document.querySelector("figure[data-chart]") as HTMLElement;
const lines = () => [...chart().querySelectorAll(".mrr-odds-line")];
const keys = () => [...chart().querySelectorAll(".mrr-odds-legend .mrr-odds-key")];
const footKeys = () => [...chart().querySelectorAll(".mrr-odds-foot-key")];
/** Every regime the figure prints, legend first then footnote: the split
 * between them is a width decision, the union is the invariant. */
const readout = () => [...keys(), ...footKeys()].map((k) => clean(k.textContent).replace(/^·\s*/, ""));
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

describe("RegimeOddsChart (Iteration 2, F1)", () => {
  it("draws one traceable line per regime and no stacked band", () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    expect(lines().map((l) => l.getAttribute("data-regime"))).toEqual(["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]);
    // One path element per series, each with its own full run of points: a
    // reader can follow one regime end to end.
    for (const l of lines()) {
      const d = l.getAttribute("d") ?? "";
      expect(d.startsWith("M")).toBe(true);
      expect(d.split("L")).toHaveLength(GOLDILOCKS.length);
    }
    expect(chart().querySelectorAll(".mrr-odds-band")).toHaveLength(0);
  });

  it("draws the called regime heavy and the other three muted, reading the label the payload served", () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    const heavy = lines().filter((l) => l.getAttribute("data-weight") === "heavy");
    expect(heavy.map((l) => l.getAttribute("data-regime"))).toEqual(["Goldilocks"]);
    expect(heavy[0].getAttribute("stroke-width")).toBe("2.25");
    for (const l of lines().filter((x) => x.getAttribute("data-weight") === "muted")) {
      expect(l.getAttribute("stroke-width")).toBe("1.2");
      expect(l.getAttribute("stroke-opacity")).toBe("0.45");
    }
  });

  it("follows the served call rather than a hardcoded Goldilocks", () => {
    render(<RegimeOddsChart rows={OVERHEATING} />);
    expect(lines().filter((l) => l.getAttribute("data-weight") === "heavy").map((l) => l.getAttribute("data-regime"))).toEqual(["Overheating"]);
  });

  it("puts the legend inline above the plot, sorted high to low, and nothing in the right margin", () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    // All four print, sorted high to low; which of them sit in the legend and
    // which on the footnote line is the measured split (fitKeys).
    expect(readout()).toEqual(["Goldilocks 58%", "Recession Risk 31%", "Overheating 7%", "Stagflation 4%"]);
    expect(keys().length).toBeGreaterThan(0);
    const legend = chart().querySelector(".mrr-odds-legend") as HTMLElement;
    const plot = chart().querySelector("svg") as SVGSVGElement;
    // Source order is the render order: the legend precedes the plot.
    expect(legend.compareDocumentPosition(plot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(chart().querySelectorAll(".mrr-odds-labels")).toHaveLength(0);
  });

  it("marks the current month on the called line with its value", () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    expect(chart().querySelector("[data-current-month]")).toHaveAttribute("data-current-month", "2026-09-01");
    expect(clean(chart().querySelector(".mrr-odds-marker text")?.textContent)).toBe("58%");
  });

  it("names the current month and all four values in one caption line", () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    expect(chart().querySelectorAll("figcaption")).toHaveLength(1);
    expect(clean(chart().querySelector("figcaption")?.textContent)).toBe("Regime odds · 4 months · heaviest line is the call");
  });

  it("is a tab stop whose label announces the current month's four values", async () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    const plot = screen.getByRole("img");
    expect(plot).toHaveAttribute("tabindex", "0");
    const label = plot.getAttribute("aria-label") ?? "";
    expect(label).toContain("Sep 2026 is the current month, called Goldilocks");
    expect(label).toContain("Goldilocks 58%");
    expect(label).toContain("Recession Risk 31%");
    expect(label).toContain("Overheating 7%");
    expect(label).toContain("Stagflation 4%");
    await userEvent.tab();
    expect(plot).toHaveFocus();
  });

  it("focus raises the crosshair on the current month, and the arrows walk it back", async () => {
    render(<RegimeOddsChart rows={GOLDILOCKS} />);
    const plot = screen.getByRole("img");
    expect(chart().querySelector("[data-crosshair-month]")).toBeNull();
    await userEvent.tab();
    expect(chart().querySelector("[data-crosshair-month]")).toHaveAttribute("data-crosshair-month", "2026-09-01");
    await userEvent.keyboard("{ArrowLeft}");
    expect(chart().querySelector("[data-crosshair-month]")).toHaveAttribute("data-crosshair-month", "2026-08-01");
    // The legend is the readout: the same rows now print August's values.
    expect(readout()).toEqual(["Goldilocks 55%", "Recession Risk 34%", "Overheating 7%", "Stagflation 4%"]);
    // ...under August's name, so the reader knows which month they are on.
    expect(clean(chart().querySelector(".mrr-odds-legend")?.textContent)).toContain("Aug 2026");
    // A crosshair dot per drawn series: all four values for that month.
    expect(chart().querySelectorAll("[data-crosshair-month] circle")).toHaveLength(4);
    expect(plot.getAttribute("aria-describedby")).toBeTruthy();
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    // Clamped at the first stored month, never off the end of the series.
    expect(chart().querySelector("[data-crosshair-month]")).toHaveAttribute("data-crosshair-month", "2026-06-01");
  });

  it("renders nothing with fewer than two stored months", () => {
    const { container } = render(<RegimeOddsChart rows={GOLDILOCKS.slice(-1)} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("fitKeys (F1 legend fits its measured row)", () => {
  const entries = [
    { name: "Goldilocks", value: "58%" },
    { name: "Recession Risk", value: "31%" },
    { name: "Overheating", value: "7%" },
    { name: "Stagflation", value: "4%" },
  ];

  it("takes every key when the row is wide", () => {
    expect(fitKeys(entries, 926)).toBe(4);
  });

  it("drops the last key rather than overflow the 1280px hero column", () => {
    // The measured column at 1280px, where four keys pushed "Recession Risk"
    // outside the figure before F1's fit rule.
    expect(fitKeys(entries, 418)).toBe(3);
  });

  it("never returns zero, so a very narrow column still names one series", () => {
    expect(fitKeys(entries, 40)).toBe(1);
  });

  it("the estimate grows with the name and the value", () => {
    expect(keyWidth("Recession Risk", "31%")).toBeGreaterThan(keyWidth("Goldilocks", "58%"));
    expect(keyWidth("Goldilocks", "100%")).toBeGreaterThan(keyWidth("Goldilocks", "58%"));
  });
});

describe("seriesPlan (F1 narrow-column reduction)", () => {
  it("wide: every regime is drawn and only the called one is heavy", () => {
    expect(seriesPlan(GOLDILOCKS, true)).toEqual({ drawn: ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"], heavy: ["Goldilocks"], footnote: [] });
  });

  it("below 1024: the call and its strongest challenger stay, the other two move to the footnote", () => {
    const plan = seriesPlan(GOLDILOCKS, false);
    expect(plan.drawn).toEqual(["Goldilocks", "Recession Risk"]);
    expect(plan.heavy).toEqual(["Goldilocks", "Recession Risk"]);
    // Moved, never cut (G4): the other two still print their values.
    expect(plan.footnote).toEqual(["Overheating", "Stagflation"]);
    expect([...plan.drawn, ...plan.footnote].sort()).toEqual(["Goldilocks", "Overheating", "Recession Risk", "Stagflation"]);
  });

  it("the challenger is read from the data, not assumed", () => {
    expect(seriesPlan(OVERHEATING, false).drawn).toEqual(["Overheating", "Stagflation"]);
  });

  it("legendOrder sorts by the latest month's values, high to low", () => {
    expect(legendOrder(GOLDILOCKS)).toEqual(["Goldilocks", "Recession Risk", "Overheating", "Stagflation"]);
    expect(legendOrder(OVERHEATING)).toEqual(["Overheating", "Stagflation", "Goldilocks", "Recession Risk"]);
  });
});
