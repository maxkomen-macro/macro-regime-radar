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
