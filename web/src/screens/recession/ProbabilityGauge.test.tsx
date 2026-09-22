/**
 * Phase 7 checklist (docs/redesign-v2/checklists/07-recession.md) section E.1,
 * `screens/recession/ProbabilityGauge.test.tsx`: the semicircle gauge of
 * B.1.1. `svg[role="img"]` with the spoken label, the band words LOW /
 * ELEVATED / HIGH RISK and the ticks 0 / 20 / 40 / 100 as real `<text>`
 * nodes (the P7 check "the labels read Low / Elevated / High Risk" is
 * asserted on `svg text`), the progress arc in the tone colour at full
 * opacity over the three faint band arcs, the needle `<line>` from the
 * centre (180, 180) ending left of centre for 0 and right of centre for 100,
 * and the 0..100 clamp. Geometry follows the mockup markup (recession.html:178)
 * as the checklist records it; the assertions read attributes, never pixels.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import ProbabilityGauge from "./ProbabilityGauge";

/** The seam contract's tone union (checklist 07 B.1.1): `labelTone` minus `reference`. */
type Tone = "clear" | "watch" | "alert";

const CENTRE = 180;
const TONE_COLOR: Record<Tone, string> = { clear: "var(--mint)", watch: "var(--amber)", alert: "var(--neg)" };
const BAND_COLORS = ["var(--mint)", "var(--amber)", "var(--neg)"];
const BAND_WORDS: [word: string, color: string][] = [
  ["LOW", "var(--mint)"],
  ["ELEVATED", "var(--amber)"],
  ["HIGH RISK", "var(--neg)"],
];

function gauge(prob: number, label = "Low Risk", tone: Tone = "clear"): SVGSVGElement {
  const { container } = render(<ProbabilityGauge prob={prob} label={label} tone={tone} />);
  const svg = container.querySelector("svg");
  if (!svg) throw new Error("ProbabilityGauge rendered no svg");
  return svg as SVGSVGElement;
}
const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const texts = (svg: SVGSVGElement) => [...svg.querySelectorAll("text")].map((t) => clean(t.textContent));
const num = (el: Element, name: string) => Number(el.getAttribute(name));
const near = (a: number, b: number, eps = 0.5) => Math.abs(a - b) <= eps;

/** The one straight line drawn from the gauge's centre. */
function needle(svg: SVGSVGElement): SVGLineElement {
  const lines = [...svg.querySelectorAll("line")];
  const hit = lines.find((l) => near(num(l, "x1"), CENTRE) && near(num(l, "y1"), CENTRE));
  if (!hit) throw new Error(`no needle <line> starting at the centre; lines: ${lines.map((l) => `(${l.getAttribute("x1")},${l.getAttribute("y1")})→(${l.getAttribute("x2")},${l.getAttribute("y2")})`).join(" ")}`);
  return hit as SVGLineElement;
}

/** Paint value of a stroke or fill: the attribute, else the inline style. */
function paint(el: Element, prop: "stroke" | "fill"): string {
  const attr = el.getAttribute(prop);
  if (attr) return attr.trim();
  return ((el as SVGElement).style?.[prop] ?? "").trim();
}

/** Own opacity times every ancestor's up to the svg (attributes and inline styles). */
function effectiveOpacity(el: Element, svg: SVGSVGElement): number {
  let o = 1;
  let n: Element | null = el;
  while (n && n !== svg) {
    const style = (n as SVGElement).style;
    for (const v of [n.getAttribute("opacity"), n.getAttribute("stroke-opacity"), style?.opacity, style?.strokeOpacity]) {
      if (v != null && v !== "" && Number.isFinite(Number(v))) o *= Number(v);
    }
    n = n.parentElement;
  }
  return o;
}
const strokes = (svg: SVGSVGElement, color: string) => [...svg.querySelectorAll("path")].filter((p) => paint(p, "stroke") === color);
const progressArcs = (svg: SVGSVGElement, color: string) => strokes(svg, color).filter((p) => effectiveOpacity(p, svg) === 1);
const bandArcs = (svg: SVGSVGElement, color: string) => strokes(svg, color).filter((p) => effectiveOpacity(p, svg) < 1);

describe("ProbabilityGauge (checklist 07 B.1.1, E.1)", () => {
  it("renders svg[role=img] with the spoken label, the mockup viewBox and a fluid width capped at 360", () => {
    const svg = gauge(11.6, "Low Risk", "clear");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg).toHaveAttribute("aria-label", "Recession probability gauge at 11.6% · Low Risk");
    expect(svg).toHaveAttribute("viewBox", "0 0 360 210");
    expect(svg.getAttribute("width") === "100%" || svg.style.width === "100%").toBe(true);
    expect(svg.style.maxWidth).toBe("360px");
    expect(svg.querySelector("img")).toBeNull();
    expect(svg.querySelector("animate, animateTransform, animateMotion")).toBeNull();
  });

  it("speaks the label as served, whatever the number says", () => {
    expect(gauge(11.6, "Elevated", "watch")).toHaveAttribute("aria-label", "Recession probability gauge at 11.6% · Elevated");
    expect(gauge(40, "High Risk", "alert")).toHaveAttribute("aria-label", "Recession probability gauge at 40.0% · High Risk");
    expect(gauge(7.24, "Low Risk", "clear")).toHaveAttribute("aria-label", "Recession probability gauge at 7.2% · Low Risk");
  });

  it("the band words LOW, ELEVATED and HIGH RISK and the ticks 0, 20, 40 and 100 are real text nodes, with the 12-MONTH PROBABILITY caption", () => {
    const svg = gauge(11.6);
    const all = texts(svg);
    for (const t of ["LOW", "ELEVATED", "HIGH RISK", "0", "20", "40", "100", "12-MONTH PROBABILITY"]) expect(all, t).toContain(t);
    expect(all.filter((t) => t === "20")).toHaveLength(1);
    expect(all.filter((t) => t === "40")).toHaveLength(1);
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(8);
    for (const t of all) expect(t).not.toContain("—");
  });

  it("each band word is painted in its band colour", () => {
    const svg = gauge(11.6);
    for (const [word, color] of BAND_WORDS) {
      const node = [...svg.querySelectorAll("text")].find((t) => clean(t.textContent) === word);
      expect(node, word).toBeDefined();
      expect(paint(node as Element, "fill"), word).toBe(color);
    }
  });

  it("draws the three faint band arcs (mint, amber, neg) under a full-opacity progress arc in the tone colour", () => {
    for (const tone of ["clear", "watch", "alert"] as const) {
      const svg = gauge(30, "Elevated", tone);
      for (const color of BAND_COLORS) expect(bandArcs(svg, color).length, `${tone}: faint ${color} band arc`).toBeGreaterThanOrEqual(1);
      expect(progressArcs(svg, TONE_COLOR[tone]).length, `${tone}: progress arc in ${TONE_COLOR[tone]}`).toBeGreaterThanOrEqual(1);
      for (const other of BAND_COLORS.filter((c) => c !== TONE_COLOR[tone])) {
        expect(progressArcs(svg, other), `${tone}: no full-opacity ${other} arc`).toHaveLength(0);
      }
    }
  });

  it("the needle is a line from the centre: x2 left of centre at 0, right of centre at 100, straight up at 50, never below the baseline", () => {
    const zero = needle(gauge(0));
    expect(num(zero, "x2")).toBeLessThan(CENTRE);
    expect(near(num(zero, "y2"), CENTRE, 1)).toBe(true);
    const full = needle(gauge(100));
    expect(num(full, "x2")).toBeGreaterThan(CENTRE);
    expect(near(num(full, "y2"), CENTRE, 1)).toBe(true);
    const half = needle(gauge(50));
    expect(near(num(half, "x2"), CENTRE, 1)).toBe(true);
    expect(num(half, "y2")).toBeLessThan(CENTRE);
    // The needle length is the same at every probability (a radius, not a scale).
    const len = (l: SVGLineElement) => Math.hypot(num(l, "x2") - num(l, "x1"), num(l, "y2") - num(l, "y1"));
    expect(near(len(zero), len(full), 0.5)).toBe(true);
    expect(near(len(half), len(full), 0.5)).toBe(true);
    for (const p of [0, 11.6, 33, 50, 88, 100]) expect(num(needle(gauge(p)), "y2"), `y2 at ${p}`).toBeLessThanOrEqual(CENTRE + 0.5);
    // 11.6 sits inside the first fifth of the arc: left of centre and above the 20 mark's x.
    const low = needle(gauge(11.6));
    expect(num(low, "x2")).toBeLessThan(CENTRE);
    expect(paint(zero, "stroke").toLowerCase()).toMatch(/^(?:#fff|#ffffff|white)$/);
  });

  it("the needle angle grows monotonically with the probability", () => {
    const xs = [0, 20, 40, 60, 80, 100].map((p) => num(needle(gauge(p)), "x2"));
    for (let i = 1; i < xs.length; i++) expect(xs[i], `x2 at ${[0, 20, 40, 60, 80, 100][i]}`).toBeGreaterThan(xs[i - 1]);
  });

  it("a probability outside 0..100 clamps: -20 draws like 0 and 140 like 100", () => {
    const below = needle(gauge(-20));
    const zero = needle(gauge(0));
    expect(near(num(below, "x2"), num(zero, "x2"), 0.01)).toBe(true);
    expect(near(num(below, "y2"), num(zero, "y2"), 0.01)).toBe(true);
    const above = needle(gauge(140));
    const full = needle(gauge(100));
    expect(near(num(above, "x2"), num(full, "x2"), 0.01)).toBe(true);
    expect(near(num(above, "y2"), num(full, "y2"), 0.01)).toBe(true);
    expect(num(above, "x2")).toBeGreaterThan(CENTRE);
    expect(num(below, "x2")).toBeLessThan(CENTRE);
  });

  it("carries the hub at the centre", () => {
    const svg = gauge(11.6);
    const hub = [...svg.querySelectorAll("circle")].find((c) => near(num(c, "cx"), CENTRE) && near(num(c, "cy"), CENTRE));
    expect(hub).toBeDefined();
  });
});
