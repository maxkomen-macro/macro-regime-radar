/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 3,
 * `tools/EquityBridge.test.tsx`: the inline SVG waterfall (B.1.1) rendered
 * from hand-built BridgeStep values, so the chart is proven independently of
 * `bridgeSteps`. Values carry decimals to prove the Math.round labels; the
 * figures are the fixture deal's, never the mockup's.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import EquityBridge from "./EquityBridge";
import type { BridgeStep } from "./lbo-deal";

const STEPS: BridgeStep[] = [
  { label: ["Entry", "equity"], value: 361.6, kind: "absolute" },
  { label: ["EBITDA", "growth"], value: 221.02, kind: "delta" },
  { label: ["Multiple", "change"], value: 127.63, kind: "delta" },
  { label: ["Debt", "paydown"], value: 112.5, kind: "delta" },
  { label: ["Fees", "at close"], value: -12, kind: "delta" },
  { label: ["Exit", "equity"], value: 810.75, kind: "absolute" },
];
const ZERO_MULTIPLE: BridgeStep[] = STEPS.map((s, i) => (i === 2 ? { ...s, value: 0 } : s));

const svgOf = (root: HTMLElement) => root.querySelector("svg") as SVGSVGElement;
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
/** Every token appears, each after the previous one. */
function inOrder(text: string, tokens: string[]): boolean {
  let from = 0;
  for (const t of tokens) {
    const i = text.indexOf(t, from);
    if (i === -1) return false;
    from = i + t.length;
  }
  return true;
}
/** A number token bounded by non-digits (so 12 never matches inside 112). */
const hasNumber = (text: string, n: number) => new RegExp(`(?:^|[^\\d.])${Math.abs(n)}(?:[^\\d]|$)`).test(text);

describe("EquityBridge (checklist 09 B.1.1)", () => {
  it("is an svg image named for assistive tech, 400 by 270 units, with six rect bars", () => {
    const { container } = render(<EquityBridge steps={STEPS} />);
    const svg = svgOf(container);
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Equity value bridge from entry to exit");
    expect(svg).toHaveAttribute("viewBox", "0 0 400 270");
    expect(svg.querySelectorAll("rect")).toHaveLength(6);
  });

  it("prints six rounded $M value labels and the six two-line labels in order", () => {
    const { container } = render(<EquityBridge steps={STEPS} />);
    const text = clean(svgOf(container).textContent);
    for (const v of [362, 221, 128, 113, 12, 811]) expect(hasNumber(text, v), `value label ${v}`).toBe(true);
    // Unrounded figures never print.
    expect(text).not.toContain("361.6");
    expect(text).not.toContain("810.75");
    expect(inOrder(text, ["Entry", "equity", "EBITDA", "growth", "Multiple", "change", "Debt", "paydown", "Fees", "at close", "Exit", "equity"])).toBe(true);
    expect(text).toMatch(/EQUITY VALUE BRIDGE/i);
    expect(text).not.toContain("—");
  });

  it("draws the zero stub for a 0 step and keeps six bars", () => {
    const { container } = render(<EquityBridge steps={ZERO_MULTIPLE} />);
    const svg = svgOf(container);
    const rects = [...svg.querySelectorAll("rect")];
    expect(rects).toHaveLength(6);
    const stub = rects.find((r) => r.getAttribute("height") === "2" || (r.getAttribute("fill") ?? "").includes("--text-4"));
    expect(stub, "a 2px --text-4 stub for the zero step").toBeTruthy();
    expect(hasNumber(clean(svg.textContent), 0)).toBe(true);
  });

  it("scales every bar into the box: no rect leaves the 400 by 270 viewBox", () => {
    const { container } = render(<EquityBridge steps={STEPS} />);
    for (const r of svgOf(container).querySelectorAll("rect")) {
      const x = Number(r.getAttribute("x"));
      const y = Number(r.getAttribute("y"));
      const w = Number(r.getAttribute("width"));
      const h = Number(r.getAttribute("height"));
      expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)).toBe(true);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(400.001);
      expect(y + h).toBeLessThanOrEqual(270.001);
      expect(h).toBeGreaterThanOrEqual(0);
    }
  });
});
