/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/signals/RegimeBadge.test.tsx`; contract in section B.6
 * (RegimeBadge renders through `Pill`: Goldilocks mint, Overheating and
 * Stagflation their regime tints, Recession Risk gray; a trailing `.pct`
 * span for `confidence`; `size="sm"` kept; `tone` override wins).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegimeBadge } from "./RegimeBadge";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const badge = (ui: React.ReactElement) => render(ui).container.firstElementChild as HTMLElement;

describe("RegimeBadge (checklist 02 B.6)", () => {
  it("maps the four regimes to their tones", () => {
    const mapping: [string, string][] = [
      ["Goldilocks", "mint"],
      ["Overheating", "overheating"],
      ["Stagflation", "stagflation"],
      ["Recession Risk", "gray"],
    ];
    for (const [label, tone] of mapping) {
      const el = badge(<RegimeBadge label={label as never} />);
      expect(el, label).toHaveAttribute("data-tone", tone);
      expect(el).toHaveClass("mrr-pill");
      expect(el.textContent).toBe(label);
    }
    const goldilocks = badge(<RegimeBadge />); // default label
    expect(goldilocks).toHaveAttribute("data-tone", "mint");
    expect(goldilocks.style.boxShadow).toBe("var(--glow-pill)");
    const overheating = badge(<RegimeBadge label="Overheating" />);
    expect(overheating.style.color).toBe("var(--r-overheating)");
    expect(css(overheating)).toMatch(/background(?:-color)?:\s*rgba\(230, ?126, ?34, ?0?\.11\)/);
    const stagflation = badge(<RegimeBadge label="Stagflation" />);
    expect(stagflation.style.color).toBe("var(--r-stagflation)");
    expect(css(stagflation)).toMatch(/rgba\(231, ?76, ?60/);
    const recession = badge(<RegimeBadge label="Recession Risk" />);
    expect(recession.style.boxShadow).toBe("none");
    // The retired tokens are gone from the rendered styles.
    for (const el of [goldilocks, overheating, stagflation, recession]) {
      expect(css(el)).not.toMatch(/--badge-|--ls-badge\b|--r-md/);
    }
  });

  it("renders the confidence percentage", () => {
    const el = badge(<RegimeBadge label="Goldilocks" confidence={0.64} />);
    const pct = el.querySelector(".pct") as HTMLElement;
    expect(pct).not.toBeNull();
    expect(pct.textContent).toBe("64%");
    expect(el.textContent).toBe("Goldilocks64%");
    expect(pct.style.opacity).toBe("0.85");
    expect(pct.style.color).toBe("inherit");
    expect(badge(<RegimeBadge label="Overheating" confidence={0.523} />).querySelector(".pct")?.textContent).toBe("52%");
    expect(badge(<RegimeBadge label="Stagflation" confidence={0} />).querySelector(".pct")?.textContent).toBe("0%");
    expect(badge(<RegimeBadge label="Stagflation" />).querySelector(".pct")).toBeNull();
  });

  it('size="sm" keeps working', () => {
    render(<RegimeBadge label="Goldilocks" size="sm" confidence={0.64} />);
    const el = screen.getByText(/Goldilocks/);
    expect(el.style.height).toBe("28px");
    expect(el.style.padding).toMatch(/^0(?:px)? 12px$/); // jsdom serializes 0 as 0px
    expect(el).toHaveAttribute("data-tone", "mint");
    expect(el.querySelector(".pct")?.textContent).toBe("64%");
    const md = badge(<RegimeBadge label="Goldilocks" />);
    expect(md.style.height).toBe("40px");
    expect(md.style.padding).toMatch(/^0(?:px)? 18px$/);
  });

  it("tone override wins", () => {
    const gray = badge(<RegimeBadge label="Goldilocks" tone="gray" confidence={0.64} />);
    expect(gray).toHaveAttribute("data-tone", "gray");
    expect(gray.style.boxShadow).toBe("none");
    expect(css(gray)).not.toMatch(/var\(--mint-a11\)/);
    const amber = badge(<RegimeBadge label="Recession Risk" tone="amber" />);
    expect(amber).toHaveAttribute("data-tone", "amber");
    expect(amber.style.boxShadow).toBe("var(--glow-pill-amber)");
    // Explicit "regime" restores the mapping.
    expect(badge(<RegimeBadge label="Goldilocks" tone="regime" />)).toHaveAttribute("data-tone", "mint");
    // Rest still spreads onto the root.
    const tagged = badge(<RegimeBadge label="Goldilocks" data-kit-variant="regime-badge-md" title="Current regime" />);
    expect(tagged).toHaveAttribute("data-kit-variant", "regime-badge-md");
    expect(tagged).toHaveAttribute("title", "Current regime");
  });
});
