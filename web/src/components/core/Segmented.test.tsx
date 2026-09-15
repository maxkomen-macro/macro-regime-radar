/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/core/Segmented.test.tsx`; contract in section B.8 (an
 * `aria-pressed` group, never a radiogroup: `<div role="group" aria-label>`
 * with one `<button type="button" aria-pressed>` per option; `mono` sets the
 * mono face and `data-mono`; `data-touch="true"` on narrow viewports).
 *
 * Option shape follows B.8 (`{ id, label, disabled?, title? }`, `onChange(id)`).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { Segmented } from "./Segmented";

// The breakpoint hook memoizes matchMedia lists per module; drive it directly
// (the SubTabs.test.tsx idiom).
const bpState = { bp: "wide", isMobile: false, isTablet: false, isNarrow: false, shellCompact: false };
vi.mock("../../lib/useBreakpoint", () => ({ useBreakpoint: () => bpState }));

function mockViewport(bp: "mobile" | "tablet" | "desktop" | "wide") {
  bpState.bp = bp;
  bpState.isMobile = bp === "mobile";
  bpState.isTablet = bp === "tablet";
  bpState.isNarrow = bp === "mobile" || bp === "tablet";
  bpState.shellCompact = bp !== "wide";
}

const OPTIONS = [
  { id: "3m", label: "3 months" },
  { id: "6m", label: "6 months" },
  { id: "12m", label: "12 months" },
];

const css = (el: Element | null) => el?.getAttribute("style") ?? "";

function Harness({ onChange }: { onChange?: (id: string) => void }) {
  const [value, setValue] = useState("3m");
  return (
    <Segmented
      options={OPTIONS}
      value={value}
      onChange={(id) => {
        onChange?.(id);
        setValue(id);
      }}
      label="Horizon"
    />
  );
}

describe("Segmented (checklist 02 B.8)", () => {
  it("renders one aria-pressed button per option with the group label", () => {
    mockViewport("wide");
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Horizon" });
    expect(group).toHaveClass("mrr-seg");
    const buttons = within(group).getAllByRole("button");
    expect(buttons).toHaveLength(3);
    expect(buttons.map((b) => b.textContent)).toEqual(["3 months", "6 months", "12 months"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    for (const b of buttons) expect(b).toHaveAttribute("type", "button");
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    // Buttons stay in the Tab order natively (no roving tabindex).
    for (const b of buttons) expect(b.getAttribute("tabindex")).not.toBe("-1");
    expect(group).not.toHaveAttribute("data-touch", "true");
  });

  it("click changes the value once", () => {
    mockViewport("wide");
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    fireEvent.click(screen.getByRole("button", { name: "6 months" }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("6m");
    expect(screen.getByRole("button", { name: "6 months" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3 months" })).toHaveAttribute("aria-pressed", "false");
    // Pressed styling: white text and the strong border; unpressed stays --text-2.
    const pressed = screen.getByRole("button", { name: "6 months" });
    expect(css(pressed)).toMatch(/color:\s*(?:#fff|rgb\(255, ?255, ?255\))/);
    expect(css(pressed)).toMatch(/border(?:-color)?:[^;]*var\(--line-strong\)/);
    // Unpressed reads --text-2 through the hover seam (--seg-fg fallback) so app.css can lift it on hover.
    expect(screen.getByRole("button", { name: "3 months" }).style.color).toMatch(/^var\(--seg-fg, ?var\(--text-2\)\)$|^var\(--text-2\)$/);
  });

  it("disabled option does not fire", () => {
    mockViewport("wide");
    const spy = vi.fn();
    render(
      <Segmented
        options={[
          { id: "5d", label: "5D" },
          { id: "max", label: "MAX", disabled: true },
        ]}
        value="5d"
        onChange={spy}
        label="Range"
        mono
      />,
    );
    const max = screen.getByRole("button", { name: "MAX" });
    expect(max).toBeDisabled();
    fireEvent.click(max);
    expect(spy).not.toHaveBeenCalled();
    expect(max.style.color).toBe("var(--text-4)");
    expect(max.style.cursor).toBe("default");
  });

  it("arrow keys move focus without changing the value", () => {
    mockViewport("wide");
    const spy = vi.fn();
    render(<Harness onChange={spy} />);
    const group = screen.getByRole("group", { name: "Horizon" });
    const [first, second] = within(group).getAllByRole("button");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    // The value is untouched: no onChange and the pressed state is unchanged.
    expect(spy).not.toHaveBeenCalled();
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveAttribute("aria-pressed", "false");
    // Focus stays inside the group (B.8: the arrow-key focus move is an
    // enhancement; what the contract forbids is a value change).
    expect(group.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "ArrowLeft" });
    expect(spy).not.toHaveBeenCalled();
    expect(first).toHaveAttribute("aria-pressed", "true");
    expect(group.contains(document.activeElement)).toBe(true);
  });

  it("mono variant sets the mono font", () => {
    mockViewport("wide");
    render(
      <Segmented
        options={[
          { id: "5d", label: "5D" },
          { id: "1m", label: "1M" },
        ]}
        value="5d"
        onChange={() => {}}
        label="Range"
        mono
      />,
    );
    const group = screen.getByRole("group", { name: "Range" });
    expect(group).toHaveAttribute("data-mono", "true");
    const button = screen.getByRole("button", { name: "5D" });
    expect(css(button)).toMatch(/var\(--font-mono\)/);
    expect(button.style.textTransform).toBe("uppercase");
    expect(css(button)).toMatch(/letter-spacing:\s*\.08em/);
    expect(button.style.padding).toMatch(/^0(?:px)? 11px$/); // jsdom serializes 0 as 0px

    const { container } = render(<Segmented options={OPTIONS} value="3m" onChange={() => {}} label="Horizon" />);
    const text = within(container).getByRole("button", { name: "3 months" });
    expect(css(text)).toMatch(/var\(--font-ui\)/);
    expect(css(text)).not.toMatch(/var\(--font-mono\)/);
    expect(text.style.padding).toMatch(/^0(?:px)? 16px$/);
    expect(text.style.height).toBe("28px");
    expect(text.style.borderRadius).toBe("var(--r-badge)");
  });

  it("data-touch on narrow (mock useBreakpoint like SubTabs.test)", () => {
    mockViewport("mobile");
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Horizon" });
    expect(group).toHaveAttribute("data-touch", "true");
    const button = screen.getByRole("button", { name: "3 months" });
    expect(button.style.minHeight).toBe("40px");
    expect(button.style.padding).toMatch(/^0(?:px)? 14px$/);
    mockViewport("wide");
  });
});
