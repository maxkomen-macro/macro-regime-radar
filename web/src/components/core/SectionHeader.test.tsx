/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/core/SectionHeader.test.tsx`; contract in section B.4 and risk
 * G1: the inline layout keeps `right` inside the heading so the baseline label
 * harvest (docs/redesign-v2/baseline/labels.json) still reads the concatenated
 * heading text, and the heading keeps `text-transform: uppercase` because the
 * harvester keys on it.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SectionHeader } from "./SectionHeader";
import Jargon from "../../screens/shared/Jargon";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";

describe("SectionHeader (checklist 02 B.4)", () => {
  it("inline layout keeps the right slot inside the heading element", () => {
    render(<SectionHeader title="Quality ladder" right={<span>BB · B · CCC detail · monthly</span>} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.tagName).toBe("H2");
    expect(within(heading).getByText("Quality ladder")).toBeInTheDocument();
    expect(within(heading).getByText("BB · B · CCC detail · monthly")).toBeInTheDocument();
    expect(heading.textContent).toBe("Quality ladderBB · B · CCC detail · monthly");
    expect(heading.style.display).toBe("flex");
    expect(heading.style.justifyContent).toBe("space-between");
    // No hairline rule under the eyebrow any more.
    expect(css(heading)).not.toMatch(/border-bottom:\s*1px/);
  });

  it("panel layout renders description and actions as siblings of the heading", () => {
    render(
      <SectionHeader
        layout="panel"
        title="Monitored signals"
        description="Five stored signals against their thresholds."
        right="Signal print Sep 2026"
        actions={<button type="button">Methodology</button>}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toBe("Monitored signals");
    const description = screen.getByText("Five stored signals against their thresholds.");
    const meta = screen.getByText("Signal print Sep 2026");
    const action = screen.getByRole("button", { name: "Methodology" });
    for (const el of [description, meta, action]) {
      expect(heading.contains(el)).toBe(false);
    }
    const wrapper = heading.parentElement as HTMLElement;
    expect(wrapper.contains(description)).toBe(true);
    expect(wrapper.contains(meta)).toBe(true);
    expect(wrapper.contains(action)).toBe(true);
    expect(wrapper).toHaveClass("mrr-sec-head");
    // The description sits after the heading, the meta and actions after it.
    expect(heading.compareDocumentPosition(description) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(description.style.fontSize).toBe("13px");
    expect(description.style.color).toBe("var(--text-2)");
  });

  it('level="sub" renders h3 by default and h4 with as', () => {
    const { unmount } = render(<SectionHeader level="sub" title="Coefficients" />);
    const h3 = screen.getByRole("heading", { level: 3, name: "Coefficients" });
    expect(h3.tagName).toBe("H3");
    expect(h3.style.textTransform).toBe("uppercase");
    expect(h3.style.color).toBe("var(--text-3)");
    expect(css(h3)).toMatch(/var\(--font-ui\)/);
    expect(css(h3)).toMatch(/var\(--ls-eyebrow-sm\)/);
    unmount();

    render(<SectionHeader level="sub" as="h4" title="Inside a tile" />);
    const h4 = screen.getByRole("heading", { level: 4, name: "Inside a tile" });
    expect(h4.tagName).toBe("H4");
    expect(screen.queryByRole("heading", { level: 3 })).toBeNull();
  });

  it("title accepts a ReactNode (Jargon)", () => {
    render(
      <SectionHeader
        title={
          <>
            Credit <Jargon term="OAS">OAS</Jargon> monitor
          </>
        }
      />,
    );
    const heading = screen.getByRole("heading", { level: 2 });
    const trigger = within(heading).getByRole("button", { name: "OAS" });
    expect(trigger).toBeInTheDocument();
    // Jargon keeps its (hidden) definition in the DOM, so textContent is not exact.
    expect(heading).toHaveTextContent(/^Credit OAS/);
    expect(heading).toHaveTextContent(/monitor$/);
  });

  it("right renders in mono meta style", () => {
    render(<SectionHeader title="Monitored signals" right="Signal print Sep 2026" />);
    const meta = screen.getByText("Signal print Sep 2026");
    expect(css(meta)).toMatch(/var\(--font-mono\)/);
    expect(css(meta)).toMatch(/var\(--ls-badge-mono\)/);
    expect(meta.style.color).toBe("var(--text-3)");
    expect(meta.style.textTransform).toBe("uppercase");
    expect(meta.style.textAlign).toBe("right");
  });

  it("the heading keeps text-transform uppercase (label-harvest contract)", () => {
    render(<SectionHeader title="Quality ladder" right="BB · B · CCC detail · monthly" />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.style.textTransform).toBe("uppercase");
    // Uppercase is CSS only: the DOM text keeps the author's casing.
    expect(heading.textContent).toBe("Quality ladderBB · B · CCC detail · monthly");
    expect(css(heading)).toMatch(/var\(--fs-eyebrow\)/);
    expect(css(heading)).toMatch(/var\(--ls-eyebrow\)/);
    expect(heading.style.color).toBe("var(--text-eyebrow)");
    expect(css(heading)).toMatch(/var\(--font-ui\)/);
  });
});
