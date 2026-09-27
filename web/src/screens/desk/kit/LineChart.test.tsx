/**
 * The chart kit's label rules: a band label wider than the plot wraps at its
 * " · " (the Sectors charts at phone width), a short one stays on one line,
 * and a passed label color is a style the class fill cannot override.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import LineChart from "./LineChart";

function chart(label: string) {
  // jsdom measures nothing, so the chart takes its 420 px fallback width.
  return render(
    <LineChart
      ariaLabel="test"
      height={100}
      n={3}
      series={[{ key: "a", values: [0, 1, 0], color: "#58b8e6" }]}
      yDomain={[-1, 1]}
      yTicks={[]}
      bands={[{ from: 0, to: 1, fill: "none", label, labelColor: "#26dca0" }]}
      pad={{ l: 40, r: 54, t: 6, b: 6 }}
    />,
  );
}

describe("LineChart band labels", () => {
  it("wraps a label wider than the plot at its middle dot", () => {
    const { container } = chart("large caps leading · crowded into the biggest names and then some more words");
    const spans = [...container.querySelectorAll(".dk-chart-band tspan")].map((t) => t.textContent);
    expect(spans).toEqual(["large caps leading ·", "crowded into the biggest names and then some more words"]);
  });
  it("keeps a short label on one line, in the color passed to it", () => {
    const { container } = chart("small caps leading · broad");
    const t = container.querySelector<SVGTextElement>(".dk-chart-band");
    expect(t?.querySelectorAll("tspan")).toHaveLength(0);
    expect(t?.textContent).toBe("small caps leading · broad");
    expect(t?.style.fill).toBe("#26dca0");
  });
});

describe("LineChart bars", () => {
  it("draws one bar from zero per served value, colored by its side, none for a null", () => {
    const { container } = render(
      <LineChart ariaLabel="bars" height={100} n={4} series={[]} yDomain={[-2, 2]} yTicks={[]} pad={{ l: 0, r: 0, t: 0, b: 0 }} bars={{ values: [1, -2, null, 0.5], up: "#26dca0", down: "#e5534b" }} />,
    );
    const rects = [...container.querySelectorAll<SVGRectElement>("rect.dk-chart-bar")];
    expect(rects.map((r) => r.getAttribute("fill"))).toEqual(["#26dca0", "#e5534b", "#26dca0"]);
    // y(0) is the plot's middle (50 of 100): a bar above zero ends there, one below starts there.
    expect(Number(rects[0].getAttribute("y")) + Number(rects[0].getAttribute("height"))).toBeCloseTo(50);
    expect(Number(rects[1].getAttribute("y"))).toBeCloseTo(50);
    expect(Number(rects[1].getAttribute("height"))).toBeCloseTo(50);
  });
});
