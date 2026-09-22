/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/data/StatTile.test.tsx`; contract in section B.17 (values in
 * the UI face at 500; size ramp xs 14 / sm 20 / md 24 / lg 30 / xl 40 px;
 * label in the mono meta style with a 4 px mint live dot).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTile } from "./StatTile";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";

describe("StatTile (checklist 02 B.17)", () => {
  it("renders label, value and delta glyph by direction", () => {
    const { unmount } = render(<StatTile label="10Y Treasury" value="4.30%" delta="+0.10" direction="up" />);
    expect(screen.getByText("10Y Treasury")).toBeInTheDocument();
    const value = screen.getByText("4.30%");
    expect(css(value)).toMatch(/var\(--font-ui\)/);
    expect(css(value)).not.toMatch(/var\(--font-mono\)/);
    expect(css(value)).toMatch(/font(?:-weight)?:\s*500\b|font-weight:\s*500/);
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    const up = screen.getByText(/\+0\.10/);
    expect(up.textContent?.replace(/\s+/g, " ")).toBe("▲ +0.10");
    expect(up.style.color).toBe("var(--pos)");
    expect(css(up)).toMatch(/var\(--font-ui\)/);
    unmount();

    render(<StatTile label="VIX" value="18.92" delta="-6.33" direction="down" />);
    const down = screen.getByText(/-6\.33/);
    expect(down.textContent?.replace(/\s+/g, " ")).toBe("▼ -6.33");
    expect(down.style.color).toBe("var(--neg)");

    const flat = render(<StatTile label="Fed Funds" value="3.64%" delta="0.00" />).container;
    expect(flat.textContent).toContain("→ 0.00");
    const none = render(<StatTile label="Count" value="12" />).container;
    expect(none.textContent).toBe("Count12");
    // The label is the mono meta style.
    const label = screen.getByText("VIX");
    expect(css(label)).toMatch(/var\(--font-mono\)/);
    expect(label.style.textTransform).toBe("uppercase");
    expect(label.style.color).toBe("var(--text-3)");
  });

  it("sizes map to the ramp", () => {
    const sizes: [string | undefined, string][] = [
      ["xs", "14px"],
      ["sm", "20px"],
      ["md", "24px"],
      [undefined, "24px"],
      ["lg", "30px"],
      ["xl", "40px"],
    ];
    for (const [size, px] of sizes) {
      const { unmount } = render(<StatTile label="Label" value="9.99" {...(size ? { size: size as never } : {})} />);
      const value = screen.getByText("9.99");
      expect(value.style.fontSize, String(size)).toBe(px);
      expect(value.style.lineHeight).toBe("1.1");
      unmount();
    }
    // The retiring tokens have no consumer here.
    const { container } = render(<StatTile label="Label" value="9.99" size="lg" />);
    expect(container.innerHTML).not.toMatch(/--fs-metric|--fs-value-lg/);
  });

  it("live renders the dot", () => {
    const live = render(<StatTile label="10Y Treasury" value="4.30%" live />).container;
    const dot = live.querySelector<HTMLElement>("[style*='mrr-pulse']");
    expect(dot).not.toBeNull();
    expect(dot?.style.width).toBe("4px");
    expect(dot?.style.height).toBe("4px");
    expect(dot?.style.borderRadius).toBe("50%");
    expect(css(dot)).toMatch(/background(?:-color)?:\s*var\(--mint\)/);
    expect(screen.getByText("10Y Treasury").contains(dot)).toBe(true);
    const still = render(<StatTile label="Fed Funds" value="3.64%" />).container;
    expect(still.querySelector("[style*='mrr-pulse']")).toBeNull();
  });
});
