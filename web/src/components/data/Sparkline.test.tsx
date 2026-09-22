/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/Sparkline.test.tsx`; contract in section B.15 (empty box
 * under two points, `gradient` area with a useId-based linearGradient,
 * `strokeWidth`, `fill={false}` renders the line only).
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

const SERIES = [3.9, 4.1, 3.8, 4.2, 4.4, 4.3, 4.0, 4.3, 4.5, 4.4, 4.3];
const linePath = (root: ParentNode) => [...root.querySelectorAll("path")].find((p) => p.getAttribute("fill") === "none") ?? null;
const areaPaths = (root: ParentNode) => [...root.querySelectorAll("path")].filter((p) => p.getAttribute("fill") !== "none");

describe("Sparkline (checklist 02 B.15)", () => {
  it("renders an empty svg with fewer than two points", () => {
    const one = render(<Sparkline values={[4.3]} width={118} height={30} />).container;
    const svg = one.querySelector("svg") as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("width", "118");
    expect(svg).toHaveAttribute("height", "30");
    expect(one.querySelectorAll("path")).toHaveLength(0);
    const none = render(<Sparkline values={[]} />).container;
    expect(none.querySelector("svg")).not.toBeNull();
    expect(none.querySelectorAll("path")).toHaveLength(0);
  });

  it("gradient renders a linearGradient with unique ids across two instances", () => {
    const { container } = render(
      <>
        <Sparkline values={SERIES} width={80} height={26} color="var(--pos)" gradient />
        <Sparkline values={SERIES} width={80} height={26} color="var(--pos)" gradient />
      </>,
    );
    const gradients = [...container.querySelectorAll("linearGradient")];
    expect(gradients).toHaveLength(2);
    const ids = gradients.map((g) => g.getAttribute("id"));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    for (const g of gradients) {
      expect(g).toHaveAttribute("x1", "0");
      expect(g).toHaveAttribute("y1", "0");
      expect(g).toHaveAttribute("x2", "0");
      expect(g).toHaveAttribute("y2", "1");
      const stops = [...g.querySelectorAll("stop")];
      expect(stops).toHaveLength(2);
      expect(stops[0]).toHaveAttribute("stop-color", "var(--pos)");
      expect(Number(stops[0].getAttribute("stop-opacity"))).toBeCloseTo(0.28, 5);
      expect(Number(stops[1].getAttribute("stop-opacity"))).toBe(0);
    }
    const svgs = [...container.querySelectorAll("svg")];
    svgs.forEach((svg, i) => {
      const area = areaPaths(svg);
      expect(area).toHaveLength(1);
      expect(area[0].getAttribute("fill")).toBe(`url(#${ids[i]})`);
      expect(svg.querySelector("defs")?.contains(gradients[i])).toBe(true);
    });
    // gradientOpacity exposes the hero areas' .22 top stop.
    const hero = render(<Sparkline values={SERIES} gradient gradientOpacity={0.22} />).container;
    expect(Number(hero.querySelector("stop")?.getAttribute("stop-opacity"))).toBeCloseTo(0.22, 5);
  });

  it("strokeWidth applies", () => {
    const thin = render(<Sparkline values={SERIES} width={118} height={30} color="var(--mint)" fill={false} strokeWidth={1.4} />).container;
    const line = linePath(thin) as SVGPathElement;
    expect(line).not.toBeNull();
    expect(Number(line.getAttribute("stroke-width"))).toBeCloseTo(1.4, 5);
    expect(line).toHaveAttribute("stroke", "var(--mint)");
    expect(line).toHaveAttribute("stroke-linejoin", "round");
    expect(line).toHaveAttribute("stroke-linecap", "round");
    const def = render(<Sparkline values={SERIES} />).container;
    expect(Number(linePath(def)?.getAttribute("stroke-width"))).toBeCloseTo(1.5, 5);
    expect(linePath(def)).toHaveAttribute("stroke", "var(--link)");
  });

  it("fill=false renders no area path", () => {
    const bare = render(<Sparkline values={SERIES} fill={false} />).container;
    expect(bare.querySelectorAll("path")).toHaveLength(1);
    expect(areaPaths(bare)).toHaveLength(0);
    expect(bare.querySelector("linearGradient")).toBeNull();
    // The flat fill default: one area path at 10 % opacity under the line.
    const flat = render(<Sparkline values={SERIES} width={280} height={40} />).container;
    const area = areaPaths(flat);
    expect(area).toHaveLength(1);
    expect(area[0]).toHaveAttribute("fill", "var(--link)");
    expect(Number(area[0].getAttribute("opacity"))).toBeCloseTo(0.1, 5);
    expect(flat.querySelectorAll("path")).toHaveLength(2);
  });
});
