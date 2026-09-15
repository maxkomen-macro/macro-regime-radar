/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/ProbabilityBar.test.tsx`; contract in section B.10 (flex
 * segments `<i title="{name} {text}">` in fixed regime order with 2 px gaps,
 * zero segments omitted from the bar but kept in the legend, sub-1 % prints
 * `<1%`, `gap` / `height` / `legend` / `order` props).
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProbabilityBar } from "./ProbabilityBar";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const segments = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>("i[title]")];
const barOf = (root: ParentNode) => segments(root)[0]?.parentElement as HTMLElement;

const PROBS = { goldilocks: 0.64, overheating: 0.22, stagflation: 0.05, recession: 0.09 };

describe("ProbabilityBar (checklist 02 B.10)", () => {
  it("renders segments in fixed regime order with flex shares", () => {
    const { container } = render(<ProbabilityBar probs={PROBS} />);
    const segs = segments(container);
    expect(segs.map((s) => s.getAttribute("title"))).toEqual(["Goldilocks 64%", "Overheating 22%", "Stagflation 5%", "Recession Risk 9%"]);
    expect(segs.map((s) => s.style.flexGrow)).toEqual(["64", "22", "5", "9"]);
    expect(segs.map((s) => s.style.background)).toEqual([
      "var(--r-goldilocks)",
      "var(--r-overheating)",
      "var(--r-stagflation)",
      "var(--r-recession)",
    ]);
    // Flex items, no transform animation (risk G4: gaps cannot animate on the compositor).
    for (const s of segs) {
      expect(css(s)).not.toMatch(/transform:/);
      expect(css(s)).not.toMatch(/transition:/);
    }
    const bar = barOf(container);
    expect(bar).toHaveClass("mrr-odds");
    expect(bar.style.display).toBe("flex");
    expect(bar.style.height).toBe("8px");
    expect(bar.style.gap).toBe("2px");
    expect(bar.style.borderRadius).toBe("4px");
    expect(bar.style.overflow).toBe("hidden");
    // Legend in fixed order, two-letter abbreviations, aria-hidden separators.
    const legend = screen.getByText("GL 64%").parentElement as HTMLElement;
    expect(within(legend).getByText("OV 22%")).toBeInTheDocument();
    expect(within(legend).getByText("ST 5%")).toBeInTheDocument();
    expect(within(legend).getByText("RR 9%")).toBeInTheDocument();
    expect(legend.textContent?.replace(/\s+/g, " ")).toBe("GL 64% · OV 22% · ST 5% · RR 9%");
    const separators = [...legend.querySelectorAll("[aria-hidden='true']")];
    expect(separators).toHaveLength(3);
    expect(css(legend)).toMatch(/var\(--font-mono\)/);
  });

  it("omits zero segments from the bar but keeps them in the legend", () => {
    const { container } = render(<ProbabilityBar probs={{ goldilocks: 0.52, recession: 0.48 }} />);
    const segs = segments(container);
    expect(segs.map((s) => s.getAttribute("title"))).toEqual(["Goldilocks 52%", "Recession Risk 48%"]);
    const legend = screen.getByText("GL 52%").parentElement as HTMLElement;
    const ov = within(legend).getByText("OV 0%");
    const st = within(legend).getByText("ST 0%");
    expect(ov.style.color).toBe("var(--text-4)");
    expect(st.style.color).toBe("var(--text-4)");
    expect(within(legend).getByText("RR 48%").style.color).not.toBe("var(--text-4)");
    // An all-zero bar renders the empty track instead of a transparent gap row.
    const empty = render(<ProbabilityBar probs={{}} />).container;
    expect(segments(empty)).toHaveLength(0);
    expect(empty.querySelector<HTMLElement>(".mrr-odds")?.style.background).toBe("var(--track)");
  });

  it("prints <1% for sub-1% shares and 0% for zero", () => {
    const { container } = render(<ProbabilityBar probs={{ goldilocks: 0.64, overheating: 0.22, stagflation: 0.004, recession: 0 }} />);
    expect(screen.getByText("ST <1%")).toBeInTheDocument();
    expect(screen.getByText("RR 0%")).toBeInTheDocument();
    expect(screen.queryByText("ST 0%")).toBeNull();
    const titles = segments(container).map((s) => s.getAttribute("title"));
    expect(titles).toContain("Goldilocks 64%");
    expect(titles).not.toContain("Recession Risk 0%");
    expect(titles.filter((t) => t?.startsWith("Stagflation")).every((t) => t === "Stagflation <1%")).toBe(true);
  });

  it("gap and height props apply", () => {
    const { container } = render(<ProbabilityBar probs={PROBS} gap={4} height={5} showLegend={false} />);
    const bar = barOf(container);
    expect(bar.style.gap).toBe("4px");
    expect(bar.style.height).toBe("5px");
    expect(screen.queryByText("GL 64%")).toBeNull();
    const zero = render(<ProbabilityBar probs={PROBS} gap={0} showLegend={false} />).container;
    expect(barOf(zero).style.gap).toMatch(/^0(?:px)?$/);
  });

  it('legend="letter" and order="desc"', () => {
    const { container } = render(<ProbabilityBar probs={PROBS} legend="letter" order="desc" />);
    expect(segments(container).map((s) => s.getAttribute("title"))).toEqual(["Goldilocks 64%", "Overheating 22%", "Recession Risk 9%", "Stagflation 5%"]);
    const legend = screen.getByText(/^G 64%?$/).parentElement as HTMLElement;
    const entries = [...legend.children].filter((c) => c.getAttribute("aria-hidden") !== "true").map((c) => c.textContent);
    expect(entries).toEqual([expect.stringMatching(/^G 64%?$/), expect.stringMatching(/^O 22%?$/), expect.stringMatching(/^R 9%?$/), expect.stringMatching(/^S 5%?$/)]);
    // The defaults keep the fixed order and the two-letter abbreviations.
    const fixed = render(<ProbabilityBar probs={PROBS} />).container;
    expect(segments(fixed).map((s) => s.getAttribute("title"))[2]).toBe("Stagflation 5%");
    expect(within(fixed).getByText("ST 5%")).toBeInTheDocument();
  });
});
