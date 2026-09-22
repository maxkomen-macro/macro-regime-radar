/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/core/Pill.test.tsx`; contract in section B.6 (the probability
 * pill: `<span class="mrr-pill" data-tone>`, mint default with `--glow-pill`,
 * amber with `--glow-pill-amber`, gray with no shadow; `md` 40 px, `sm` 28 px).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Pill } from "./Pill";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const pill = (ui: React.ReactElement) => render(ui).container.firstElementChild as HTMLElement;

describe("Pill (checklist 02 B.6)", () => {
  it("mint is the default tone and carries the glow", () => {
    const el = pill(<Pill>64% probability</Pill>);
    expect(el.tagName).toBe("SPAN");
    expect(el).toHaveAttribute("data-tone", "mint");
    expect(el).toHaveClass("mrr-pill");
    expect(el.style.boxShadow).toBe("var(--glow-pill)");
    expect(el.style.background).toBe("var(--mint-a11)");
    expect(css(el)).toMatch(/border(?:-color)?:[^;]*var\(--mint-a50\)/);
    expect(css(el)).toMatch(/color:\s*(?:#2fe6a4|rgb\(47, ?230, ?164\))/);
    expect(el.style.borderRadius).toBe("var(--r-pill)");
    expect(el.style.textTransform).toBe("uppercase");
    expect(css(el)).toMatch(/var\(--font-mono\)/);
    expect(el.style.height).toBe("40px");

    const amber = pill(<Pill tone="amber">Elevated</Pill>);
    expect(amber).toHaveAttribute("data-tone", "amber");
    expect(amber.style.boxShadow).toBe("var(--glow-pill-amber)");
    expect(amber.style.background).toBe("var(--amber-a10)");
  });

  it("gray has no shadow", () => {
    const el = pill(<Pill tone="gray">Unavailable</Pill>);
    expect(el).toHaveAttribute("data-tone", "gray");
    expect(el.style.boxShadow).toBe("none");
    expect(css(el)).toMatch(/background(?:-color)?:\s*rgba\(200, ?210, ?220, ?0?\.07\)/);
    expect(css(el)).toMatch(/border(?:-color)?:[^;]*rgba\(200, ?210, ?220, ?0?\.35\)/);
    expect(css(el)).toMatch(/color:\s*(?:#c9d2da|rgb\(201, ?210, ?218\))/);
  });

  it("sm size", () => {
    const sm = pill(
      <Pill size="sm" tone="mint">
        Goldilocks
      </Pill>,
    );
    expect(sm.style.height).toBe("28px");
    expect(sm.style.padding).toMatch(/^0(?:px)? 12px$/); // jsdom serializes 0 as 0px
    expect(css(sm)).toMatch(/font(?:-size)?:[^;]*\b11\.5px\b/);
    expect(css(sm)).toMatch(/letter-spacing:\s*\.1em/);

    const md = pill(<Pill>Goldilocks</Pill>);
    expect(md.style.height).toBe("40px");
    expect(md.style.padding).toMatch(/^0(?:px)? 18px$/);
    expect(css(md)).toMatch(/var\(--fs-pill\)/);
    expect(css(md)).toMatch(/var\(--ls-pill\)/);
  });

  it("children render", () => {
    render(
      <Pill tone="mint" id="hero-pill" data-kit-variant="pill-md">
        14 months <span className="pct">in</span>
      </Pill>,
    );
    const el = screen.getByText(/14 months/);
    expect(el).toHaveAttribute("id", "hero-pill");
    expect(el).toHaveAttribute("data-kit-variant", "pill-md");
    expect(el.querySelector(".pct")).toHaveTextContent("in");
    // Uppercase is CSS only: the accessible text keeps the author's casing.
    expect(el.textContent).toBe("14 months in");
  });
});
