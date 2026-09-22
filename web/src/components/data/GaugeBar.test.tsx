/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/GaugeBar.test.tsx`; contract in section B.9 (Meter: 5 px
 * track on `--track`, fill scaled via transform, tone tokens, the kept ramp,
 * optional tick and scale row; `MeterRow` and `DivergingBar` exports).
 *
 * The fill is found by its `scaleX` transform (the owner ruling animates via
 * transform, never width), so the assertions do not depend on class names.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { DivergingBar, GaugeBar, MeterRow } from "./GaugeBar";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const fillOf = (root: ParentNode) => root.querySelector<HTMLElement>("[style*='scaleX']");
const trackOf = (root: ParentNode) => fillOf(root)?.parentElement ?? null;

describe("GaugeBar (checklist 02 B.9)", () => {
  it("clamps pct and scales the fill", () => {
    const half = render(<GaugeBar pct={50} />).container;
    expect(fillOf(half)?.style.transform).toBe("scaleX(0.5)");
    expect(fillOf(half)?.style.transformOrigin).toBe("left");
    const over = render(<GaugeBar pct={150} />).container;
    expect(fillOf(over)?.style.transform).toBe("scaleX(1)");
    const under = render(<GaugeBar pct={-10} />).container;
    expect(fillOf(under)?.style.transform).toBe("scaleX(0)");
    const nan = render(<GaugeBar pct={Number.NaN} tick={40} />).container;
    expect(fillOf(nan)?.style.transform).toBe("scaleX(0)");
    expect(nan.querySelector("i")).toBeNull(); // NaN renders 0 and no tick
  });

  it("default height is 5", () => {
    const { container } = render(<GaugeBar pct={30} />);
    const track = trackOf(container) as HTMLElement;
    expect(track.style.height).toBe("5px");
    expect(track.style.background).toBe("var(--track)");
    expect(track.style.borderRadius).toBe("3px");
    expect(track.style.overflow).toBe("hidden");
    const tall = render(<GaugeBar pct={30} height={8} />).container;
    expect((trackOf(tall) as HTMLElement).style.height).toBe("8px");
  });

  it("tone picks the token and color still overrides", () => {
    const tones: [string, string][] = [
      ["clear", "var(--mint)"],
      ["watch", "var(--amber)"],
      ["alert", "var(--neg)"],
      ["info", "var(--link)"],
      ["neutral", "var(--text-3)"],
      ["pos", "var(--pos)"],
      ["neg", "var(--neg)"],
    ];
    for (const [tone, token] of tones) {
      const { container } = render(<GaugeBar pct={40} tone={tone as never} />);
      const fill = fillOf(container) as HTMLElement;
      expect(css(fill), tone).toMatch(new RegExp(`background(?:-color)?:\\s*${token.replace(/[()]/g, "\\$&").replace(/-/g, "\\-")}`));
    }
    const overridden = render(<GaugeBar pct={40} tone="watch" color="var(--r-overheating)" />).container;
    expect(css(fillOf(overridden))).toMatch(/background(?:-color)?:\s*var\(--r-overheating\)/);
    expect(css(fillOf(overridden))).not.toMatch(/var\(--amber\)/);
    // gradient: the tone colour fades in from 40 % alpha.
    const gradient = render(<GaugeBar pct={26.7} tone="clear" gradient />).container;
    expect(css(fillOf(gradient))).toMatch(/linear-gradient\(90deg, ?rgba\(38, ?220, ?160, ?0?\.4\), ?(?:var\(--mint\)|#26dca0|rgb\(38, ?220, ?160\))\)/);
  });

  it("ramp applies only without tone or color", () => {
    const steps: [number, string][] = [
      [32, "var(--gauge-0)"],
      [62, "var(--gauge-50)"],
      [88, "var(--gauge-75)"],
      [98, "var(--gauge-95)"],
    ];
    for (const [pct, token] of steps) {
      const { container } = render(<GaugeBar pct={pct} />);
      expect(css(fillOf(container)), String(pct)).toContain(token);
    }
    expect(css(fillOf(render(<GaugeBar pct={98} tone="clear" />).container))).not.toMatch(/--gauge-/);
    expect(css(fillOf(render(<GaugeBar pct={98} color="var(--link)" />).container))).not.toMatch(/--gauge-/);
  });

  it("tick renders at the given percent", () => {
    const { container } = render(<GaugeBar pct={26.7} tick={50} height={8} />);
    const tick = container.querySelector("i") as HTMLElement | null;
    expect(tick).not.toBeNull();
    expect(tick?.style.left).toBe("50%");
    expect(tick?.style.position).toBe("absolute");
    expect(tick?.style.width).toBe("1px");
    expect(tick?.style.top).toBe("-4px");
    expect(tick?.style.height).toBe("19px"); // height + 11
    expect(css(tick)).toMatch(/background(?:-color)?:\s*rgba\(255, ?255, ?255, ?0?\.45\)/);
    expect(render(<GaugeBar pct={26.7} />).container.querySelector("i")).toBeNull();
    const five = render(<GaugeBar pct={10} tick={25} />).container.querySelector("i") as HTMLElement;
    expect(five.style.height).toBe("16px");
  });

  it("scale row renders three entries", () => {
    render(<GaugeBar pct={26.7} tick={50} height={8} scale={{ left: "0", mid: "avg 26.3 mo", right: "2\u00d7 avg" }} />);
    const mid = screen.getByText("avg 26.3 mo");
    const row = mid.parentElement as HTMLElement;
    expect(row.children).toHaveLength(3);
    expect([...row.children].map((c) => c.textContent)).toEqual(["0", "avg 26.3 mo", "2\u00d7 avg"]);
    expect(row.style.display).toBe("flex");
    expect(row.style.justifyContent).toBe("space-between");
    expect(css(row)).toMatch(/var\(--font-mono\)/);
    expect(mid.style.color).toBe("var(--text-2)");

    // tickLabel is the middle entry when scale is absent.
    const labelled = render(<GaugeBar pct={40} tick={50} tickLabel="avg" />);
    const tickMid = within(labelled.container).getByText("avg");
    expect((tickMid.parentElement as HTMLElement).children).toHaveLength(3);
    expect(tickMid.style.color).toBe("var(--text-2)");
  });

  it("MeterRow renders label, value and optional delta", () => {
    const { container, unmount } = render(
      <MeterRow label="Goldilocks" pct={64} tone="clear" value="64%" delta="+3 vs 3-mo ago" deltaTone="watch" swatch="var(--r-goldilocks)" />,
    );
    const row = container.firstElementChild as HTMLElement;
    expect(row).toHaveClass("mrr-meter-row");
    expect(row.style.display).toBe("grid");
    expect(row.style.gridTemplateColumns).toMatch(/^112px minmax\(0, ?1fr\) 44px 58px$/);
    expect(row.style.height).toBe("30px");
    expect(within(row).getByText("Goldilocks")).toBeInTheDocument();
    expect(within(row).getByText("64%")).toBeInTheDocument();
    const delta = within(row).getByText("+3 vs 3-mo ago");
    expect(delta.style.color).toBe("var(--amber)");
    expect(css(delta)).toMatch(/var\(--font-mono\)/);
    expect(fillOf(row)?.style.transform).toBe("scaleX(0.64)");
    const swatch = row.querySelector<HTMLElement>("[style*='--r-goldilocks']");
    expect(swatch).not.toBeNull();
    expect(swatch?.style.width).toBe("8px");
    unmount();

    const plain = render(<MeterRow label="Overheating" pct={22} tone="watch" value="22%" />);
    const plainRow = plain.container.firstElementChild as HTMLElement;
    expect(within(plainRow).queryByText(/vs 3-mo/)).toBeNull();
    expect(plainRow.style.gridTemplateColumns).toMatch(/^112px minmax\(0, ?1fr\) 44px$/);
    expect(plainRow.style.gap).toBe("12px");
    const sized = render(<MeterRow label="Late cycle" pct={80} tone="watch" value="80%" labelWidth={140} valueWidth={52} height={34} />);
    const sizedRow = sized.container.firstElementChild as HTMLElement;
    expect(sizedRow.style.gridTemplateColumns).toMatch(/^140px minmax\(0, ?1fr\) 52px$/);
    expect(sizedRow.style.height).toBe("34px");
  });

  it("DivergingBar anchors left of centre for negative values", () => {
    const negative = render(<DivergingBar value={-0.5} max={1} />).container.firstElementChild as HTMLElement;
    expect(negative.style.position).toBe("relative");
    expect(negative.style.height).toBe("10px");
    const bars = [...negative.querySelectorAll<HTMLElement>("i")];
    expect(bars).toHaveLength(2);
    const centre = bars.find((b) => b.style.width === "1px") as HTMLElement;
    const bar = bars.find((b) => b.style.height === "8px") as HTMLElement;
    expect(centre.style.left).toBe("50%");
    expect(bar.style.right).toBe("50%");
    expect(bar.style.left).toBe("");
    expect(bar.style.width).toBe("25%"); // |value| / max * 50%
    expect(css(bar)).toMatch(/background(?:-color)?:\s*var\(--mint\)/); // negativeColor default

    const positive = render(<DivergingBar value={0.8} max={1} />).container.firstElementChild as HTMLElement;
    const posBar = [...positive.querySelectorAll<HTMLElement>("i")].find((b) => b.style.height === "8px") as HTMLElement;
    expect(posBar.style.left).toBe("50%");
    expect(posBar.style.right).toBe("");
    expect(posBar.style.width).toBe("40%");
    expect(css(posBar)).toMatch(/background(?:-color)?:\s*var\(--neg\)/); // positiveColor default

    const custom = render(<DivergingBar value={1.2} max={2} positiveColor="var(--pos)" negativeColor="var(--neg)" width={120} />).container
      .firstElementChild as HTMLElement;
    expect(custom.style.width).toBe("120px");
    const customBar = [...custom.querySelectorAll<HTMLElement>("i")].find((b) => b.style.height === "8px") as HTMLElement;
    expect(customBar.style.width).toBe("30%");
    expect(css(customBar)).toMatch(/background(?:-color)?:\s*var\(--pos\)/);
  });
});
