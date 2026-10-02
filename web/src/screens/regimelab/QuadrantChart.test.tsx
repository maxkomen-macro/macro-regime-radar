/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.1.1 and
 * E.1, `screens/regimelab/QuadrantChart.test.tsx`: the hero's growth-vs-
 * inflation quadrant. An `svg[role="img"]` (viewBox 400x330) with four tinted
 * quadrant rects in the regime hues, a solid trail fading oldest → newest
 * through the served trend inputs, dots in each month's regime colour with a
 * `<title>` each (month, label, both slopes) and the glowing current dot; the
 * tinted quadrant follows the served label, never the sign of the trends.
 * fix/freshness 5: each axis on its own symmetric scale (± its largest
 * absolute slope × 1.12), zero lines at the centre; month labels only at the
 * start, each regime change and the latest month. Twelve invented points,
 * Oct 2025 to Sep 2026.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import QuadrantChart, { axisScales, labelledIndices, layoutLabels, pointTitle } from "./QuadrantChart";
import type { trailPoints } from "./regime-history";
import type { Regime, RegimeLabel } from "../../api/types";

type Point = ReturnType<typeof trailPoints>[number];

const LATEST = "2026-09-01";
const MONTHS = ["2025-10-01", "2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01", LATEST];
/** Max |x| is 1 and max |y| is 0.9, so the per-axis scales are 1.12 and 1.008: X = 200 + 166x / 1.12, Y = 159 - 139y / 1.008. */
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
  it("renders the quadrant with 11 trail dots plus the current dot, the solid fading trail, the names, the axis words and each axis's scale", () => {
    render(<QuadrantChart points={points()} current={regime()} />);
    const el = svg();
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("viewBox", "0 0 400 330");
    expect(el).toHaveAttribute("aria-label", "Growth and inflation quadrant: 12 stored months, Oct 2025 to Sep 2026, ending in Goldilocks; each axis on its own scale");
    const all = circles();
    expect(all).toHaveLength(13);
    const faded = all.filter((c) => radius(c) === 3.2);
    expect(faded).toHaveLength(11);
    // Every dot's tooltip names its month, its label and both slopes; opacity rises toward the present.
    expect(faded[0].querySelector("title")?.textContent).toBe("Oct 2025 · Goldilocks · growth −1.00, CPI +0.90 index pts a month");
    expect(faded[10].querySelector("title")?.textContent).toBe("Aug 2026 · Goldilocks · growth +0.45, CPI −0.25 index pts a month");
    expect(opacity(faded[0])).toBeLessThan(opacity(faded[10]));
    expect(opacity(faded[0])).toBeCloseTo(0.35, 2);
    expect(opacity(faded[10])).toBeCloseTo(0.9, 2);
    const halo = all.find((c) => radius(c) === 13) as Element;
    const dot = all.find((c) => radius(c) === 5.5) as Element;
    expect(halo).toBeDefined();
    expect(dot).toBeDefined();
    expect(dot.querySelector("title")?.textContent).toBe("Sep 2026 · Goldilocks · growth +0.50, CPI −0.25 index pts a month");
    // Each axis its own scale: X = 200 + 166 * 0.5 / 1.12, Y = 159 + 139 * 0.25 / 1.008.
    expect(Number(dot.getAttribute("cx"))).toBeCloseTo(274.1, 0);
    expect(Number(dot.getAttribute("cy"))).toBeCloseTo(193.5, 0);
    expect(Number(halo.getAttribute("cx"))).toBeCloseTo(274.1, 0);
    // The oldest point (x = -1, the largest |x|) sits just inside the left edge.
    expect(Number(faded[0].getAttribute("cx"))).toBeCloseTo(51.8, 0);
    // The trail: eleven solid segments, fading oldest → newest; no dashes.
    const segs = [...(el?.querySelectorAll(".mrr-quadrant-trail line") ?? [])];
    expect(segs).toHaveLength(11);
    expect(segs.every((l) => !l.getAttribute("stroke-dasharray"))).toBe(true);
    const so = segs.map((l) => Number(l.getAttribute("stroke-opacity")));
    expect(so[0]).toBeLessThan(so[10]);
    expect(el?.querySelector("polyline")).toBeNull();
    const text = el?.textContent ?? "";
    for (const name of ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]) expect(text).toContain(name);
    expect(text).toContain("PRODUCTION RISING");
    expect(text).toContain("FALLING");
    expect(text).toContain("CPI LEVEL RISING");
    expect(text).not.toContain("ACCELERATING");
    // Each axis's scale at its ends: ±1.12 for growth, ±1.01 for CPI.
    const scale = [...(el?.querySelectorAll("[data-role='scale'] text") ?? [])].map((t) => t.textContent);
    expect(scale).toEqual(["+1.12", "−1.12", "+1.01", "−1.01"]);
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
    expect(svg()).toHaveAttribute("aria-label", "Growth and inflation quadrant: 12 stored months, Oct 2025 to Sep 2026, ending in Stagflation; each axis on its own scale");
    unmount();
    render(<QuadrantChart points={points()} current={regime()} />);
    q = quadrants();
    expect(opacity(q.goldilocks)).toBeCloseTo(0.16, 5);
    expect(opacity(q.stagflation)).toBeCloseTo(0.06, 5);
  });

  it("a single point renders the current dot only, no trail, and an aria-label that says so", () => {
    render(<QuadrantChart points={points(1)} current={regime()} />);
    const label = svg()?.getAttribute("aria-label") ?? "";
    expect(label).toMatch(/^Growth and inflation quadrant/);
    expect(label).not.toMatch(/trail/i);
    expect(label).toContain("current month only");
    expect(label).toContain("Sep 2026");
    expect(svg()?.querySelector(".mrr-quadrant-trail")).toBeNull();
    expect(circles().filter((c) => radius(c) === 3.2)).toHaveLength(0);
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
    expect(svg()?.getAttribute("aria-label") ?? "").not.toMatch(/stored months/);
  });
});

describe("fix/freshness 5: each axis on its own scale, colours, labels and tooltips", () => {
  /** The CPI slopes dwarf the INDPRO slopes, as in the store (Overheating months, Aug 2025 to Aug 2026). */
  const REAL: Point[] = [
    ["2025-08-01", "Overheating", 0.0731, 0.928],
    ["2025-09-01", "Stagflation", -0.113, 1.038],
    ["2025-11-01", "Stagflation", -0.2951, 0.886],
    ["2025-12-01", "Stagflation", -0.087, 0.893],
    ["2026-01-01", "Overheating", 0.0022, 0.7625],
    ["2026-02-01", "Overheating", 0.2056, 0.7145],
    ["2026-03-01", "Overheating", 0.3474, 1.8525],
    ["2026-04-01", "Overheating", 0.3365, 2.4735],
    ["2026-05-01", "Overheating", 0.453, 1.843],
    ["2026-06-01", "Overheating", 0.1319, 0.0805],
    ["2026-07-01", "Goldilocks", 0.2029, -0.583],
    ["2026-08-01", "Overheating", 0.1131, 0.7815],
  ].map(([date, label, x, y]) => ({ date: date as string, label: label as RegimeLabel, x: x as number, y: y as number }));
  const CURRENT = regime({ date: "2026-08-01", label: "Overheating", growth_trend: 0.1131, inflation_trend: 0.7815 });

  it("growth is not squashed: the INDPRO slopes span the width on their own scale", () => {
    expect(axisScales(REAL)).toEqual({ sx: expect.closeTo(0.453 * 1.12, 6), sy: expect.closeTo(2.4735 * 1.12, 6) });
    render(<QuadrantChart points={REAL} current={CURRENT} />);
    const xs = circles().filter((c) => radius(c) !== 13).map((c) => Number(c.getAttribute("cx")));
    // On one shared scale (2.77) the growth spread would be ~45 px of the 332 px plot; on its own it is ~200.
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(150);
  });

  it("every dot sits on the side of each zero line its own slopes give it, and wears its own month's regime colour", () => {
    render(<QuadrantChart points={REAL} current={CURRENT} />);
    const dots = circles().filter((c) => radius(c) !== 13);
    expect(dots).toHaveLength(12);
    dots.forEach((c, i) => {
      const p = REAL[i];
      expect(Number(c.getAttribute("cx")) > 200, p.date).toBe(p.x > 0);
      expect(Number(c.getAttribute("cy")) < 159, p.date).toBe(p.y > 0);
      expect(c.getAttribute("data-regime")).toBe(p.label);
      const token = { Goldilocks: "goldilocks", Overheating: "overheating", Stagflation: "stagflation", "Recession Risk": "recession" }[p.label];
      expect(paint(c)).toContain(`--r-${token}`);
    });
  });

  it("month labels mark only the start, each regime change and the latest month, inside the plot and never on top of each other", () => {
    expect(labelledIndices(REAL)).toEqual([0, 1, 4, 10, 11]);
    render(<QuadrantChart points={REAL} current={CURRENT} />);
    const labels = [...(svg()?.querySelectorAll("text[data-label]") ?? [])];
    const want = new Set(["Aug 2025", "Sep 2025", "Jan 2026", "Jul 2026", "Aug 2026"]);
    for (const t of labels) expect(want.has(t.textContent ?? ""), t.textContent ?? "").toBe(true);
    expect(labels.find((t) => t.getAttribute("data-label") === "latest")?.textContent).toBe("Aug 2026");
    // No other month is printed on the plane (the tooltips, <title>, still name every month).
    const printed = [...(svg()?.querySelectorAll("text") ?? [])].map((t) => t.textContent ?? "").join(" ");
    for (const m of ["Nov 2025", "Dec 2025", "Feb 2026", "Mar 2026", "Apr 2026", "May 2026", "Jun 2026"]) expect(printed).not.toContain(m);
    const at = labels.map((t) => `${t.getAttribute("x")},${t.getAttribute("y")}`);
    expect(new Set(at).size).toBe(at.length);
    for (const t of labels) {
      const x = Number(t.getAttribute("x"));
      const y = Number(t.getAttribute("y"));
      expect(x).toBeGreaterThanOrEqual(34);
      expect(x).toBeLessThanOrEqual(366);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(298);
    }
  });

  it("the tooltip names the month, the label and both slopes", () => {
    expect(pointTitle(REAL[6])).toBe("Mar 2026 · Overheating · growth +0.35, CPI +1.85 index pts a month");
    expect(pointTitle(REAL[10])).toBe("Jul 2026 · Goldilocks · growth +0.20, CPI −0.58 index pts a month");
  });
});


describe("Codex R-21: month labels clear the axis-scale labels", () => {
  /** An estimated box from the rendered attributes alone: a mono glyph is 0.6 em, a line one em tall. */
  const boxOf = (t: Element, fontPx: number) => {
    const x = Number(t.getAttribute("x"));
    const y = Number(t.getAttribute("y"));
    const w = (t.textContent ?? "").length * fontPx * 0.6;
    const anchor = t.getAttribute("text-anchor") ?? "start";
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    return { x0, x1: x0 + w, y0: y - fontPx, y1: y };
  };
  const overlap = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

  it("Codex's case: an earlier point at (1, 1) and the current one at (0.5, 0.2) on the 400 × 330 plane", () => {
    const points = [
      { date: "2026-07-01", label: "Overheating" as RegimeLabel, x: 1, y: 1 },
      { date: "2026-08-01", label: "Overheating" as RegimeLabel, x: 0.5, y: 0.2 },
    ];
    render(<QuadrantChart points={points} current={regime({ date: "2026-08-01", label: "Overheating", growth_trend: 0.5, inflation_trend: 0.2 })} />);
    const scale = [...(svg()?.querySelectorAll("[data-role='scale'] text") ?? [])];
    expect(scale.map((t) => t.textContent)).toEqual(["+1.12", "−1.12", "+1.12", "−1.12"]);
    const labels = [...(svg()?.querySelectorAll("text[data-label]") ?? [])];
    expect(labels.map((t) => t.textContent)).toContain("Aug 2026");
    for (const l of labels) {
      const lb = boxOf(l, l.getAttribute("data-label") === "latest" ? 11 : 10);
      for (const s of scale) expect(overlap(lb, boxOf(s, 9)), `${l.textContent} vs ${s.textContent}`).toBe(false);
    }
  });

  it("across the stored trail, no month label covers a scale label", () => {
    const pts: Point[] = [
      ["2026-01-01", "Stagflation", -0.3, 0.9],
      ["2026-02-01", "Overheating", 0.45, 0.05],
      ["2026-03-01", "Goldilocks", 0.4, -0.02],
      ["2026-04-01", "Recession Risk", -0.02, -0.6],
      ["2026-05-01", "Overheating", 0.05, 0.85],
    ].map(([date, label, x, y]) => ({ date: date as string, label: label as RegimeLabel, x: x as number, y: y as number }));
    render(<QuadrantChart points={pts} current={regime({ date: "2026-05-01", label: "Overheating", growth_trend: 0.05, inflation_trend: 0.85 })} />);
    const scale = [...(svg()?.querySelectorAll("[data-role='scale'] text") ?? [])];
    for (const l of svg()?.querySelectorAll("text[data-label]") ?? []) {
      const lb = boxOf(l, l.getAttribute("data-label") === "latest" ? 11 : 10);
      for (const s of scale) expect(overlap(lb, boxOf(s, 9)), `${l.textContent} vs ${s.textContent}`).toBe(false);
    }
  });
});

describe("Codex R-21 (round 2): the latest month never covers a scale label, even when no spot beside it is free", () => {
  /** Estimated from the drawn attributes alone: a mono glyph is 0.6 em, a line one em tall. */
  const box = (x: number, y: number, text: string, anchor: string, fontPx: number) => {
    const w = text.length * fontPx * 0.6;
    const x0 = anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x;
    return { x0, x1: x0 + w, y0: y - fontPx, y1: y };
  };
  const overlap = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const pts = (rows: [string, number, number][]) => rows.map(([date, x, y]) => ({ date, label: "Overheating" as RegimeLabel, x, y }));

  it("Codex's case: a 300 × 250 plane ending Dec 2025 at (0.94, 0.24)", () => {
    const { labels, scale } = layoutLabels(pts([["2025-10-01", -0.34, 0.95], ["2025-11-01", 0.44, 0.33], ["2025-12-01", 0.94, 0.24]]), 300, 250);
    const scaleBoxes = scale.map((s) => box(s.x, s.y, s.text, s.anchor, 9));
    for (const l of labels) {
      const lb = box(l.x, l.y, l.text, l.anchor, l.current ? 11 : 10);
      for (const [k, sb] of scaleBoxes.entries()) expect(overlap(lb, sb), `${l.text} vs ${scale[k].text}`).toBe(false);
    }
    const latest = labels.find((l) => l.current);
    // Placed with a leader line to a free spot, or left off; never on top of the scale.
    if (latest) expect(latest.leader === undefined || latest.leader.x1 !== latest.leader.x2 || latest.leader.y1 !== latest.leader.y2).toBe(true);
  });

  it("a crowded corner: the latest month takes a leader line to a free spot further out, or is omitted", () => {
    // Points packed at the top-right corner of a small plane, the latest among them.
    const rows: [string, number, number][] = [["2025-08-01", 0.95, 0.98], ["2025-09-01", 1, 0.9], ["2025-10-01", 0.9, 1], ["2025-11-01", 0.97, 0.95], ["2025-12-01", 0.99, 0.97]];
    const { labels, scale } = layoutLabels(pts(rows), 260, 200);
    const latest = labels.find((l) => l.current);
    const scaleBoxes = scale.map((s) => box(s.x, s.y, s.text, s.anchor, 9));
    if (latest) {
      const lb = box(latest.x, latest.y, latest.text, latest.anchor, 11);
      for (const sb of scaleBoxes) expect(overlap(lb, sb)).toBe(false);
    }
    // The rendered chart draws the leader when one is placed.
    render(<QuadrantChart points={pts(rows)} current={regime({ date: "2025-12-01", label: "Overheating", growth_trend: 0.99, inflation_trend: 0.97 })} />);
    const drawn = svg()?.querySelectorAll("line[data-leader]").length ?? 0;
    expect(drawn).toBeLessThanOrEqual(1);
  });
});
