/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 10,
 * `tools/FrontierChart.test.tsx`: the efficient-frontier SVG (A.13): the
 * unavailable note for a frame without columns or with fewer than two points,
 * the path and three ticks per axis on the 40-point fixture frontier, the
 * `selected` ring and bold label, and the right-rail label flip. Fixture data
 * from ./__fixtures__/allocation.ts; nothing here reads the clock.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import type { FrameData } from "../../api/types";
import FrontierChart, { type FrontierMarker } from "./FrontierChart";
import { FRONTIER, frame } from "./__fixtures__/allocation";

const MARKERS: FrontierMarker[] = [
  { label: "Mean-Variance", vol: 0.102, ret: 0.094, color: "var(--link)" },
  { label: "HRP", vol: 0.081, ret: 0.075, color: "var(--research)" },
  // At the frontier's highest volatility: the marker sits on the right rail.
  { label: "Black-Litterman", vol: 0.1575, ret: 0.088, color: "var(--warn-hot)" },
];
const NO_COLUMNS = { index: [], columns: undefined as unknown as string[], data: [] } as FrameData;
const ONE_POINT = frame(["0"], ["volatility", "return"], [[0.1, 0.05]]);

const svgOf = (root: HTMLElement) => root.querySelector("svg") as SVGSVGElement | null;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const markerGroup = (svg: SVGSVGElement, label: string) => [...svg.querySelectorAll("g")].find((g) => clean(g.textContent) === label) as SVGGElement;

describe("FrontierChart (checklist 09 E.1 row 10)", () => {
  it("prints Frontier unavailable. for a frame without columns and for fewer than two points", () => {
    const a = render(<FrontierChart frontier={NO_COLUMNS} markers={[]} />);
    expect(clean(a.container.textContent)).toBe("Frontier unavailable.");
    expect(svgOf(a.container)).toBeNull();
    a.unmount();
    const b = render(<FrontierChart frontier={ONE_POINT} markers={MARKERS} />);
    expect(clean(b.container.textContent)).toBe("Frontier unavailable.");
    expect(svgOf(b.container)).toBeNull();
  });

  it("a 40-point frame renders one path, three ticks per axis with percent labels, and the axis words under the plot", () => {
    const { container } = render(<FrontierChart frontier={FRONTIER} markers={MARKERS} />);
    const svg = svgOf(container) as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Efficient frontier: annualized volatility vs return, with optimization methods marked");
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelector("path")?.getAttribute("d")).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){39}$/);
    expect(svg.querySelectorAll("line")).toHaveLength(6);
    const tickLabels = [...svg.querySelectorAll("text")].map((t) => clean(t.textContent)).filter((t) => /^\d+%$/.test(t));
    expect(tickLabels).toHaveLength(6);
    expect(svg.querySelectorAll("circle")).toHaveLength(MARKERS.length);
    expect(clean(container.textContent)).toContain("annualized volatility →");
    expect(clean(container.textContent)).toContain("↑ annualized return (right axis)");
  });

  it("selected rings exactly one marker (r + 3, mint) inside the data-selected group and bolds its label; nothing is ringed without it", () => {
    const plain = render(<FrontierChart frontier={FRONTIER} markers={MARKERS} />);
    expect(svgOf(plain.container)?.querySelectorAll("circle.mrr-frontier-ring")).toHaveLength(0);
    expect(svgOf(plain.container)?.querySelectorAll("g[data-selected]")).toHaveLength(0);
    plain.unmount();

    const { container } = render(<FrontierChart frontier={FRONTIER} markers={MARKERS} selected="HRP" />);
    const svg = svgOf(container) as SVGSVGElement;
    const rings = svg.querySelectorAll<SVGCircleElement>("circle.mrr-frontier-ring");
    expect(rings).toHaveLength(1);
    const group = rings[0].closest("g") as SVGGElement;
    expect(group).toHaveAttribute("data-selected", "true");
    expect(clean(group.textContent)).toBe("HRP");
    expect(rings[0].getAttribute("stroke")).toBe("var(--mint)");
    const dot = group.querySelector("circle:not(.mrr-frontier-ring)") as SVGCircleElement;
    expect(Number(rings[0].getAttribute("r"))).toBeCloseTo(Number(dot.getAttribute("r")) + 3, 6);
    expect(rings[0].getAttribute("cx")).toBe(dot.getAttribute("cx"));
    expect(rings[0].getAttribute("cy")).toBe(dot.getAttribute("cy"));
    const label = group.querySelector("text") as SVGTextElement;
    expect(label.style.fontWeight).toBe("600");
    const other = markerGroup(svg, "Mean-Variance").querySelector("text") as SVGTextElement;
    expect(other.style.fontWeight).toBe("400");
    expect(markerGroup(svg, "Mean-Variance")).not.toHaveAttribute("data-selected");
  });

  it("a label near the right rail uses text-anchor=end; one in the body uses start", () => {
    const { container } = render(<FrontierChart frontier={FRONTIER} markers={MARKERS} />);
    const svg = svgOf(container) as SVGSVGElement;
    expect(markerGroup(svg, "Black-Litterman").querySelector("text")).toHaveAttribute("text-anchor", "end");
    expect(markerGroup(svg, "HRP").querySelector("text")).toHaveAttribute("text-anchor", "start");
    expect(markerGroup(svg, "Mean-Variance").querySelector("text")).toHaveAttribute("text-anchor", "start");
  });
});
