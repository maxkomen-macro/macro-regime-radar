/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/shared/Disclosure.test.tsx`; contract in section B.14 (a button
 * with aria-expanded / aria-controls over a hidden panel whose children mount
 * only while open; new `description`, `tone`, `onToggle` props; the `quiet`
 * variant has no border; `DisclosureLine` is the mono tab footer).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import Disclosure, { DisclosureLine } from "./Disclosure";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";

function Probe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div>secret content</div>;
}

describe("Disclosure (checklist 02 B.14)", () => {
  it("closed by default, opens on click, sets aria-expanded and aria-controls", () => {
    render(
      <Disclosure title="Options lens" right="delayed · EODHD" id="options-lens">
        <div>Greeks and the IV surface</div>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: /Options lens/ });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    const panelId = button.getAttribute("aria-controls") as string;
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    expect(document.getElementById("options-lens")?.contains(button)).toBe(true);
    // The glyph is decorative and flips with the state.
    const glyph = button.querySelector("[aria-hidden='true']") as HTMLElement;
    expect(glyph.textContent).toBe("▸");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(panel).not.toHaveAttribute("hidden");
    expect(within(panel).getByText("Greeks and the IV surface")).toBeVisible();
    expect(glyph.textContent).toBe("▾");
    expect(css(button)).toMatch(/border(?:-color)?:[^;]*var\(--line\)/); // open row border
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(panel).toHaveAttribute("hidden");
    // defaultOpen starts expanded.
    const open = render(
      <Disclosure title="Regime read" defaultOpen>
        <div>already open</div>
      </Disclosure>,
    ).container;
    expect(within(open).getByRole("button", { name: /Regime read/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(open).getByText("already open")).toBeVisible();
  });

  it("children mount only while open", () => {
    const onMount = vi.fn();
    render(
      <Disclosure title="Options lens">
        <Probe onMount={onMount} />
      </Disclosure>,
    );
    expect(onMount).not.toHaveBeenCalled();
    expect(screen.queryByText("secret content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Options lens/ }));
    expect(onMount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("secret content")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Options lens/ }));
    expect(screen.queryByText("secret content")).toBeNull();
  });

  it("description and right render inside the button", () => {
    render(
      <Disclosure title="Options lens" description="Greeks, implied volatility and the expiry ladder" right="delayed · EODHD">
        <div>body</div>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: /Options lens/ });
    const description = screen.getByText("Greeks, implied volatility and the expiry ladder");
    const right = screen.getByText("delayed · EODHD");
    expect(button.contains(description)).toBe(true);
    expect(button.contains(right)).toBe(true);
    expect(button).toHaveAccessibleName(/Options lens.*Greeks, implied volatility and the expiry ladder.*delayed · EODHD/);
    expect(description.style.color).toBe("var(--text-2)");
    expect(description.style.textOverflow).toBe("ellipsis");
    expect(right.style.marginLeft).toBe("auto");
    expect(right.style.textTransform).toBe("uppercase");
    expect(css(right)).toMatch(/var\(--font-mono\)/);
    // Title before description before right.
    const title = screen.getByText("Options lens");
    expect(title.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("quiet variant has no border", () => {
    const { unmount } = render(
      <Disclosure title="Regime read · 3 sources" variant="quiet" tone="mint">
        <ul>
          <li>source</li>
        </ul>
      </Disclosure>,
    );
    const quiet = screen.getByRole("button", { name: /Regime read/ });
    expect(css(quiet)).not.toMatch(/border(?:-width)?:\s*1px/);
    expect(css(quiet)).toMatch(/border:\s*(?:0|none|0px)\b/);
    expect(quiet.style.background).toMatch(/^(?:none|transparent)?$/);
    expect(quiet.style.padding).toMatch(/^6px 0(?:px)?$/); // jsdom serializes 0 as 0px
    expect(quiet.style.minHeight).toBe("40px");
    expect(quiet.style.color).toBe("var(--mint)");
    unmount();

    render(
      <Disclosure title="Options lens">
        <div>body</div>
      </Disclosure>,
    );
    const row = screen.getByRole("button", { name: /Options lens/ });
    expect(css(row)).toMatch(/border(?:-width)?:\s*1px/);
    expect(css(row)).toMatch(/border(?:-color)?:[^;]*var\(--line-2\)/);
    expect(row.style.borderRadius).toBe("var(--r-ctl)");
    expect(row.style.padding).toBe("10px 12px");
    expect(row.style.minHeight).toBe("40px");
    expect(row.style.width).toBe("100%");
  });

  it("DisclosureLine renders a paragraph in the mono footer style", () => {
    render(<DisclosureLine id="credit-footer">Model output is not investment advice. Spreads from FRED BAML series; stored daily.</DisclosureLine>);
    const line = screen.getByText(/Model output is not investment advice/);
    expect(line.tagName).toBe("P");
    expect(line).toHaveClass("mrr-disclosure-line");
    expect(line).toHaveAttribute("id", "credit-footer");
    expect(css(line)).toMatch(/var\(--font-mono\)/);
    expect(line.style.color).toBe("var(--text-4)");
    expect(line.style.marginTop).toBe("18px");
    expect(line.style.maxWidth).toBe("1100px");
    expect(css(line)).toMatch(/letter-spacing:\s*\.03em/);
    const styled = render(<DisclosureLine style={{ marginTop: 0 }}>x</DisclosureLine>).container.firstElementChild as HTMLElement;
    expect(styled.style.marginTop).toMatch(/^0(?:px)?$/);
  });

  it("onToggle fires with the new state", () => {
    const onToggle = vi.fn();
    render(
      <Disclosure title="Options lens" onToggle={onToggle}>
        <div>body</div>
      </Disclosure>,
    );
    const button = screen.getByRole("button", { name: /Options lens/ });
    fireEvent.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(true);
    fireEvent.click(button);
    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
