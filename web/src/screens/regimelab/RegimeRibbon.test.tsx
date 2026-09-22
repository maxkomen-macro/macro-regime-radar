/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.6, B.9
 * and E.1, `screens/regimelab/RegimeRibbon.test.tsx`: the regime history
 * ribbon SVG in its two sizes. The teaser draws four lane tracks plus one span
 * per merged segment (each with a `<title>` tooltip); the full variant is the
 * Gantt with uppercase lane names; year ticks run every five years from the
 * first row's year + 2; below 768 the SVG keeps its intrinsic width inside an
 * `overflow-x: auto` well. The 26-month fixture ends Sep 2026.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import RegimeRibbon from "./RegimeRibbon";
import type { Regime, RegimeLabel } from "../../api/types";

// The breakpoint hook memoizes matchMedia lists per module; drive it directly
// (the SubTabs.test.tsx idiom).
const bpState = { bp: "wide", isMobile: false, isTablet: false, isNarrow: false, shellCompact: false };
vi.mock("../../lib/useBreakpoint", () => ({ useBreakpoint: () => bpState }));

function mockViewport(bp: "mobile" | "tablet" | "desktop" | "wide") {
  bpState.bp = bp;
  bpState.isMobile = bp === "mobile";
  bpState.isTablet = bp === "tablet";
  bpState.isNarrow = bp === "mobile" || bp === "tablet";
  bpState.shellCompact = bp !== "wide";
}

const LATEST = "2026-09-01";
const LABEL: Record<string, RegimeLabel> = { G: "Goldilocks", O: "Overheating", S: "Stagflation", R: "Recession Risk" };
/** Aug 2024 to Sep 2026: eight merged segments, the last one open. */
const SPELLS = "GG OO GGG SS GG OOO RRRRRR GGGGGG";
const SEGMENTS = 8;

function monthsEnding(n: number, last = LATEST): string[] {
  const [y, m] = last.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  });
}

function history(spec = SPELLS): Regime[] {
  const labels = spec.replace(/\s+/g, "").split("").map((c) => LABEL[c]);
  const dates = monthsEnding(labels.length);
  return labels.map((label, i) => ({
    date: dates[i],
    label,
    confidence: 0.47,
    growth_trend: ((i % 7) - 3) / 4,
    inflation_trend: ((i % 5) - 2) / 4,
    prob_goldilocks: 0.58,
    prob_overheating: 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
  }));
}

/** Jan 2010 to Sep 2026 (201 rows), the regime rotating every seven months. */
function longHistory(): Regime[] {
  const dates = monthsEnding(201);
  const order: RegimeLabel[] = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
  return dates.map((date, i) => ({ ...history("G")[0], date, label: order[Math.floor(i / 7) % 4] }));
}

const svg = () => document.querySelector("svg[role='img']") as SVGSVGElement | null;
const rects = () => [...(svg()?.querySelectorAll("rect") ?? [])];
const titles = () => rects().map((r) => r.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() ?? null);
const yearTicks = () => [...(svg()?.querySelectorAll("text") ?? [])].map((t) => t.textContent?.trim() ?? "").filter((t) => /^\d{4}$/.test(t));

describe("RegimeRibbon (checklist 04 B.6 and B.9)", () => {
  it("teaser renders four lane tracks plus one rect per merged segment, each span with a title", () => {
    mockViewport("wide");
    render(<RegimeRibbon rows={history()} variant="teaser" ariaLabel="Regime history ribbon, Aug 2024 to Sep 2026" />);
    const el = svg();
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-label", "Regime history ribbon, Aug 2024 to Sep 2026");
    expect(el).toHaveAttribute("viewBox", "0 0 1360 74");
    expect(rects()).toHaveLength(4 + SEGMENTS);
    const spans = titles().filter((t): t is string => t != null);
    expect(spans).toHaveLength(SEGMENTS);
    for (const t of spans) expect(t).toMatch(/^(?:Goldilocks|Overheating|Stagflation|Recession Risk) · [A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4} \(\d+mo\)$/);
    expect(spans[0]).toBe("Goldilocks · Aug 2024 → Sep 2024 (2mo)");
    expect(spans[SEGMENTS - 1]).toBe("Goldilocks · Apr 2026 → Sep 2026 (6mo)");
    // The four tracks carry no title.
    expect(titles().filter((t) => t == null)).toHaveLength(4);
    // Lane names in the mockup order.
    const text = el?.textContent ?? "";
    for (const name of ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]) expect(text).toContain(name);
    expect(text.indexOf("Goldilocks")).toBeLessThan(text.indexOf("Overheating"));
    expect(text.indexOf("Overheating")).toBeLessThan(text.indexOf("Stagflation"));
    expect(text.indexOf("Stagflation")).toBeLessThan(text.indexOf("Recession Risk"));
    // Colours are the hue tokens, never a served hex.
    for (const r of rects()) expect(`${r.getAttribute("fill") ?? ""} ${r.getAttribute("style") ?? ""}`).not.toMatch(/#(?:2ecc71|e67e22|e74c3c|95a5a6)/i);
  });

  it("full variant renders the four uppercase lane names, the R43 aria-label and more than four spans", () => {
    mockViewport("wide");
    render(<RegimeRibbon rows={history()} variant="full" ariaLabel="Regime history Gantt: one lane per regime, colored spans mark the months the classifier called it" />);
    const el = svg();
    expect(el).toHaveAttribute("viewBox", "0 0 1385 98");
    expect(el).toHaveAttribute("aria-label", "Regime history Gantt: one lane per regime, colored spans mark the months the classifier called it");
    const text = el?.textContent ?? "";
    for (const name of ["GOLDILOCKS", "OVERHEATING", "STAGFLATION", "RECESSION RISK"]) expect(text).toContain(name);
    expect(rects().length).toBeGreaterThan(4);
    expect(titles().filter((t) => t != null)).toHaveLength(SEGMENTS);
  });

  it("year ticks run every five years from the first row's year plus two", () => {
    mockViewport("wide");
    const { unmount } = render(<RegimeRibbon rows={longHistory()} variant="full" ariaLabel="Gantt" />);
    expect(yearTicks()).toEqual(["2012", "2017", "2022"]);
    unmount();
    render(<RegimeRibbon rows={history()} variant="teaser" ariaLabel="Ribbon" />);
    expect(yearTicks()).toEqual(["2026"]);
  });

  it("below 768 the SVG keeps its intrinsic width inside an overflow-x auto well; at desk width it is fluid", () => {
    mockViewport("mobile");
    const { unmount } = render(<RegimeRibbon rows={history()} variant="teaser" ariaLabel="Ribbon" />);
    const narrow = svg() as SVGSVGElement;
    expect(narrow.parentElement?.style.overflowX).toBe("auto");
    expect(narrow.style.width).toBe("1360px");
    expect(document.body.textContent).toContain("scroll → 30 years");
    unmount();
    mockViewport("wide");
    render(<RegimeRibbon rows={history()} variant="teaser" ariaLabel="Ribbon" />);
    const wide = svg() as SVGSVGElement;
    expect(wide.parentElement?.style.overflowX).not.toBe("auto");
    expect(wide.style.width || wide.getAttribute("width")).toBe("100%");
    expect(document.body.textContent).not.toContain("scroll → 30 years");
  });
});
