/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.1.1 and
 * E.1, `screens/regimelab/QuadrantChart.test.tsx`: the hero's growth-vs-
 * inflation quadrant. An `svg[role="img"]` (viewBox 400x330) with four tinted
 * quadrant rects in the regime hues, a dashed trail through the served trend
 * inputs, faded dots with a `<title>` each and the glowing current dot; the
 * tinted quadrant follows the served label, never the sign of the trends.
 * Twelve invented points, Oct 2025 to Sep 2026.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import QuadrantChart from "./QuadrantChart";
import type { trailPoints } from "./regime-history";
import type { Regime, RegimeLabel } from "../../api/types";

type Point = ReturnType<typeof trailPoints>[number];

const LATEST = "2026-09-01";
const MONTHS = ["2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", LATEST];
/** Max |x| is 1, so the symmetric scale is 1 and the mapping is X = 200 + 166x, Y = 159 - 139y. */
const XS = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.1, 0.2, 0.3, 0.4, 0.45, 0.5];
const YS = [0.9, 0.7, 0.5, 0.3, 0.1, -0.1, -0.15, -0.2, -0.22, -0.24, -0.25, -0.25];

function points(n = 12, label: RegimeLabel = "Goldilocks"): Point[] {
  return MONTHS.slice(12 - n).map((date, i) => ({ date, label, x: XS[12 - n + i], y: YS[12 - n + i] }));
}

function regime(over: Partial<Regime> = {}): Regime {
  return {
    date: LATEST,
    label: "Goldilocks",
    confidence: 0.47,
    growth_trend: 0.5,
    inflation_trend: -0.25,
    prob_goldilocks: 0.58,
    prob_overheating: 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
    ...over,
  };
}

const svg = () => document.querySelector("svg[role='img']") as SVGSVGElement | null;
const circles = () => [...(svg()?.querySelectorAll("circle") ?? [])];
const radius = (c: Element) => Number(c.getAttribute("r"));
/** Paint of an SVG node: the fill attribute or the inline style text. */
const paint = (el: Element) => `${el.getAttribute("fill") ?? ""} ${el.getAttribute("style") ?? ""}`;
function opacity(el: Element): number {
  const attr = el.getAttribute("fill-opacity");
  if (attr != null) return Number(attr);
  const m = /fill-opacity:\s*([0-9.]+)/.exec(el.getAttribute("style") ?? "");
  return m ? Number(m[1]) : Number.NaN;
}
/** The four quadrant rects keyed by their regime token. */
function quadrants(): Record<string, Element> {
  const out: Record<string, Element> = {};
  for (const token of ["goldilocks", "overheating", "stagflation", "recession"]) {
    const rect = [...(svg()?.querySelectorAll("rect") ?? [])].find((r) => paint(r).includes(`--r-${token}`));
    if (!rect) throw new Error(`no quadrant rect painted with --r-${token}`);
    out[token] = rect;
  }
  return out;
}

describe("QuadrantChart (checklist 04 B.1.1)", () => {
  it("renders the quadrant with 12 trail circles plus the current dot, the dashed trail, the names and the axis words", () => {
    render(<QuadrantChart points={points()} current={regime()} />);
    const el = svg();
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("viewBox", "0 0 400 330");
    expect(el).toHaveAttribute("aria-label", "Growth and inflation quadrant: 12-month trail ending Sep 2026 in Goldilocks");
    const all = circles();
    expect(all).toHaveLength(13);
    const faded = all.filter((c) => radius(c) === 2.6);
    expect(faded).toHaveLength(11);
    // Every faded dot carries its month and label; opacity rises toward the present.
    expect(faded.map((c) => c.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim())).toEqual(
      MONTHS.slice(0, 11).map((d) => `${["Oct 2025", "Nov 2025", "Dec 2025", "Jan 2026", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026"][MONTHS.indexOf(d)]} · Goldilocks`),
    );
    expect(opacity(faded[0])).toBeLessThan(opacity(faded[10]));
    expect(opacity(faded[0])).toBeCloseTo(0.18, 2);
    expect(opacity(faded[10])).toBeCloseTo(0.68, 2);
    const halo = all.find((c) => radius(c) === 13) as Element;
    const dot = all.find((c) => radius(c) === 5.5) as Element;
    expect(halo).toBeDefined();
    expect(dot).toBeDefined();
    // The current dot sits at X = 200 + 166 * 0.5, Y = 159 + 139 * 0.25 on the symmetric scale.
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(283, 0);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(193.75, 0);
    expect(Number(halo.getAttribute("cx"))).toBeCloseTo(283, 0);
    // The oldest point sits at the left edge of the plot (x = -1 maps to 34).
    expect(Number(faded[0].getAttribute("cx"))).toBeCloseTo(34, 0);
    const trail = el?.querySelector("polyline") as SVGPolylineElement;
    expect(trail).not.toBeNull();
    expect((trail.getAttribute("points") ?? "").trim().split(/\s+/)).toHaveLength(12);
    expect(trail.getAttribute("stroke-dasharray") ?? trail.style.strokeDasharray).toMatch(/2[, ]3/);
    const text = el?.textContent ?? "";
    for (const name of ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]) expect(text).toContain(name);
    expect(text).toContain("GROWTH ACCELERATING");
    expect(text).toContain("SLOWING");
    expect(text).toContain("INFLATION RISING");
    expect(text).toContain("Sep 2026");
    expect(text).toContain("Oct 2025");
    expect(document.querySelector("img")).toBeNull();
  });

  it("the current label's quadrant carries the .16 tint whatever the sign of the trends", () => {
    // Trends sit in the Goldilocks quadrant (growth up, inflation down) but the served call is Stagflation.
    const { unmount } = render(<QuadrantChart points={points(12, "Stagflation")} current={regime({ label: "Stagflation" })} />);
    let q = quadrants();
    expect(opacity(q.stagflation)).toBeCloseTo(0.16, 5);
    for (const token of ["goldilocks", "overheating", "recession"]) expect(opacity(q[token]), token).toBeCloseTo(0.06, 5);
    expect(svg()).toHaveAttribute("aria-label", "Growth and inflation quadrant: 12-month trail ending Sep 2026 in Stagflation");
    unmount();
    render(<QuadrantChart points={points()} current={regime()} />);
    q = quadrants();
    expect(opacity(q.goldilocks)).toBeCloseTo(0.16, 5);
    expect(opacity(q.stagflation)).toBeCloseTo(0.06, 5);
  });

  it("a single point renders the current dot only, no trail, and an aria-label without the word trail", () => {
    render(<QuadrantChart points={points(1)} current={regime()} />);
    const label = svg()?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Growth and inflation quadrant/);
    expect(label).not.toMatch(/trail/i);
    expect(label).toContain("current month only");
    expect(label).toContain("Sep 2026");
    expect(svg()?.querySelector("polyline")).toBeNull();
    expect(circles().filter((c) => radius(c) === 2.6)).toHaveLength(0);
    expect(circles().some((c) => radius(c) === 5.5)).toBe(true);
    expect(quadrants().goldilocks).toBeDefined();
    expect(opacity(quadrants().goldilocks)).toBeCloseTo(0.16, 5);
  });

  it("a latest row without trend inputs renders the tinted quadrant, no dot and the mono note", () => {
    render(<QuadrantChart points={points(11)} current={regime({ growth_trend: null, inflation_trend: null })} />);
    expect(svg()).not.toBeNull();
    expect(circles().some((c) => radius(c) === 5.5)).toBe(false);
    expect(circles().some((c) => radius(c) === 13)).toBe(false);
    expect(opacity(quadrants().goldilocks)).toBeCloseTo(0.16, 5);
    const note = document.body.textContent ?? "";
    expect(note).toContain("Trend inputs not stored for Sep 2026.");
    expect(svg()?.getAttribute("aria-label") ?? "").not.toMatch(/12-month trail/);
  });
});
