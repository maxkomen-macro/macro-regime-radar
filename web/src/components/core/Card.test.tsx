/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/core/Card.test.tsx`; contract in section B.4 (Panel variants,
 * tone borders, accentBar callout, kept padding / surface / style props).
 *
 * jsdom keeps `var()` values literally on longhand `element.style.*` reads but
 * does not expand shorthands (`border: 1px solid var(--line)` leaves
 * `borderColor` empty), so border assertions read the style attribute text.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Card } from "./Card";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const root = (c: { container: HTMLElement }) => c.container.firstElementChild as HTMLElement;

describe("Card (checklist 02 B.4)", () => {
  it("default variant paints the panel tokens", () => {
    const el = root(render(<Card>body</Card>));
    expect(el.tagName).toBe("DIV");
    expect(el.style.background).toBe("var(--panel)");
    expect(el.style.borderRadius).toBe("var(--r-card)");
    expect(el.style.padding).toBe("var(--pad-panel)");
    expect(css(el)).toMatch(/border(?:-color)?:[^;]*var\(--line\)/);
    expect(css(el)).toMatch(/border(?:-width)?:\s*1px/);
    expect(el.style.color).toBe("var(--text)");
    expect(el.style.fontFamily).toBe("var(--font-ui)");
    expect(el).toHaveTextContent("body");
  });

  it("tile and card variants paint their radius and background", () => {
    const tile = root(render(<Card variant="tile">tile</Card>));
    expect(tile.style.borderRadius).toBe("var(--r-tile)");
    expect(tile.style.background).toBe("var(--tile)");
    expect(tile.style.padding).toBe("var(--pad-tile)");
    expect(css(tile)).toMatch(/border(?:-color)?:[^;]*rgba\(150, ?175, ?200, ?0?\.1\)/);

    const card = root(render(<Card variant="card">card</Card>));
    expect(card.style.borderRadius).toBe("var(--r-card)");
    expect(card.style.background).toBe("var(--card-grad)");
    expect(card.style.padding).toBe("var(--pad-panel)");
    expect(css(card)).toMatch(/border(?:-color)?:[^;]*var\(--line\)/);
  });

  it("tone changes the border colour only", () => {
    const base = root(render(<Card>base</Card>));
    const watch = root(render(<Card tone="watch">watch</Card>));
    const risk = root(render(<Card tone="risk">risk</Card>));
    const clear = root(render(<Card tone="clear">clear</Card>));
    const accent = root(render(<Card tone="accent">accent</Card>));

    expect(css(watch)).toMatch(/border(?:-color)?:[^;]*var\(--amber-a36\)/);
    expect(css(risk)).toMatch(/border(?:-color)?:[^;]*rgba\(240, ?80, ?63, ?0?\.38\)/);
    expect(css(clear)).toMatch(/border(?:-color)?:[^;]*var\(--mint-a32\)/);
    expect(css(accent)).toMatch(/border(?:-color)?:[^;]*var\(--link-a32\)/);
    for (const el of [watch, risk, clear, accent]) {
      // Everything but the border colour matches the default panel.
      expect(el.style.background).toBe(base.style.background);
      expect(el.style.borderRadius).toBe(base.style.borderRadius);
      expect(el.style.padding).toBe(base.style.padding);
      expect(css(el)).not.toMatch(/border-left:\s*3px/);
    }
  });

  it("accentBar renders the 3px rail with the callout radius", () => {
    const watch = root(render(<Card accentBar tone="watch">callout</Card>));
    expect(css(watch)).toMatch(/border-left:\s*3px solid var\(--amber\)/);
    expect(watch.style.borderRadius).toBe("0 8px 8px 0");
    expect(watch.style.padding).toBe("10px 14px");
    expect(css(watch)).toMatch(/background(?:-image)?:\s*linear-gradient\(90deg, ?rgba\(245, ?181, ?46, ?0?\.08\), ?transparent\)/);

    const plain = root(render(<Card accentBar>callout</Card>));
    expect(css(plain)).toMatch(/border-left:\s*3px solid var\(--link\)/);
    expect(css(plain)).toMatch(/linear-gradient\(90deg, ?rgba\(88, ?184, ?230, ?0?\.08\), ?transparent\)/);

    const risk = root(render(<Card accentBar tone="risk">callout</Card>));
    expect(css(risk)).toMatch(/border-left:\s*3px solid var\(--neg\)/);
    const clear = root(render(<Card accentBar tone="clear">callout</Card>));
    expect(css(clear)).toMatch(/border-left:\s*3px solid var\(--mint\)/);
  });

  it("padding and surface props still win", () => {
    const zero = root(render(<Card padding="0">table</Card>));
    expect(zero.style.padding).toMatch(/^0(?:px)?$/);

    const sixteen = root(render(<Card padding="16px">tight</Card>));
    expect(sixteen.style.padding).toBe("16px");

    const well = root(render(<Card surface="var(--void)">well</Card>));
    expect(well.style.background).toBe("var(--void)");

    // A consumer padding still beats the accentBar callout padding, and style spreads last.
    const callout = root(render(<Card accentBar padding="0" style={{ marginTop: 20 }}>callout</Card>));
    expect(callout.style.padding).toMatch(/^0(?:px)?$/);
    expect(callout.style.marginTop).toBe("20px");
  });

  it("as renders the requested element and spreads rest", () => {
    const { container } = render(
      <Card as="section" id="quality-ladder" aria-label="Quality ladder" data-kit-variant="panel-as-section" className="probe">
        body
      </Card>,
    );
    const el = container.querySelector("section#quality-ladder") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el).toHaveAttribute("aria-label", "Quality ladder");
    expect(el).toHaveAttribute("data-kit-variant", "panel-as-section");
    expect(el).toHaveClass("probe");
    expect(container.querySelector("div#quality-ladder")).toBeNull();

    const article = render(<Card as="article">a</Card>).container.firstElementChild as HTMLElement;
    expect(article.tagName).toBe("ARTICLE");
  });
});
