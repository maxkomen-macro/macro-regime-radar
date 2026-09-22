/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `components/core/Tag.test.tsx`; contract in section B.5 (Badge: 24 px `sm`,
 * 20 px `xs`, 28 px `md`, mono 11.5 px, 7 px radius, 7 % fill, 1 px tinted
 * border; the old tone names alias to the new tints).
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Tag } from "./Tag";
import Jargon from "../../screens/shared/Jargon";

const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const chip = (ui: React.ReactElement) => render(ui).container.firstElementChild as HTMLElement;

describe("Tag (checklist 02 B.5)", () => {
  it("old tone names map to the new tints", () => {
    const pairs: [string, string][] = [
      ["pos", "clear"],
      ["warn", "watch"],
      ["neg", "alert"],
      ["accent", "info"],
      ["neutral", "reference"],
    ];
    for (const [oldName, newName] of pairs) {
      const a = chip(<Tag tone={oldName as never}>x</Tag>);
      const b = chip(<Tag tone={newName as never}>x</Tag>);
      expect(css(a), `${oldName} vs ${newName}`).toBe(css(b));
    }
    // The tints themselves (text / fill / border) per the B.5 table.
    const clear = chip(<Tag tone="clear">Clear</Tag>);
    expect(clear.style.color).toBe("var(--mint)");
    expect(clear.style.background).toBe("var(--mint-a07)");
    expect(css(clear)).toMatch(/border(?:-color)?:[^;]*var\(--mint-a32\)/);
    const watch = chip(<Tag tone="watch">Watch</Tag>);
    expect(watch.style.color).toBe("var(--amber)");
    expect(watch.style.background).toBe("var(--amber-a07)");
    expect(css(watch)).toMatch(/border(?:-color)?:[^;]*var\(--amber-a36\)/);
    const alert = chip(<Tag tone="alert">Triggered</Tag>);
    expect(alert.style.color).toBe("var(--neg)");
    expect(css(alert)).toMatch(/background(?:-color)?:\s*rgba\(240, ?80, ?63, ?0?\.08\)/);
    expect(css(alert)).toMatch(/border(?:-color)?:[^;]*rgba\(240, ?80, ?63, ?0?\.38\)/);
    const info = chip(<Tag tone="info">Info</Tag>);
    expect(info.style.color).toBe("var(--link)");
    expect(info.style.background).toBe("var(--link-a07)");
    expect(css(info)).toMatch(/border(?:-color)?:[^;]*var\(--link-a32\)/);
    // Kept tones.
    expect(chip(<Tag tone="hot">Hot</Tag>).style.color).toBe("var(--warn-hot)");
    expect(css(chip(<Tag tone="research">Research</Tag>))).toMatch(/rgba\(124, ?58, ?237, ?0?\.35\)/);
  });

  it("default tone is reference", () => {
    const plain = chip(<Tag>Sector</Tag>);
    const reference = chip(<Tag tone="reference">Sector</Tag>);
    expect(css(plain)).toBe(css(reference));
    expect(plain.style.color).toBe("var(--text-2)");
    expect(css(plain)).toMatch(/background(?:-color)?:\s*rgba\(255, ?255, ?255, ?0?\.03\)/);
    expect(css(plain)).toMatch(/border(?:-color)?:[^;]*var\(--line-white-14\)/);
    expect(plain.style.borderRadius).toBe("var(--r-badge)");
    expect(css(plain)).toMatch(/var\(--font-mono\)/);
    expect(plain.style.textTransform).toBe("uppercase");
    expect(plain.style.whiteSpace).toBe("nowrap");
  });

  it("xs, sm, md heights", () => {
    expect(chip(<Tag size="xs">Beat</Tag>).style.height).toBe("20px");
    expect(chip(<Tag size="sm">Clear</Tag>).style.height).toBe("24px");
    expect(chip(<Tag>Clear</Tag>).style.height).toBe("24px"); // sm is the default
    expect(chip(<Tag size="md">Medium conviction</Tag>).style.height).toBe("28px");
    // jsdom serializes the 0 in a padding shorthand as 0px.
    expect(chip(<Tag size="xs">Beat</Tag>).style.padding).toMatch(/^0(?:px)? 7px$/);
    expect(chip(<Tag size="sm">Clear</Tag>).style.padding).toMatch(/^0(?:px)? 11px$/);
    expect(chip(<Tag size="md">Medium</Tag>).style.padding).toMatch(/^0(?:px)? 13px$/);
  });

  it("uppercase=false drops the transform and tracking", () => {
    const sentence = chip(
      <Tag size="md" uppercase={false}>
        Medium conviction
      </Tag>,
    );
    expect(sentence.style.textTransform).toBe("none");
    expect(sentence.style.letterSpacing).toMatch(/^0(?:px|em)?$/);
    expect(sentence.textContent).toBe("Medium conviction");

    const caps = chip(<Tag size="md">Medium conviction</Tag>);
    expect(caps.style.textTransform).toBe("uppercase");
    expect(css(caps)).toMatch(/var\(--ls-badge-mono\)/);
  });

  it("children accept a ReactNode", () => {
    render(
      <Tag tone="info">
        <Jargon term="OAS">Tight</Jargon>
      </Tag>,
    );
    const trigger = screen.getByRole("button", { name: "Tight" });
    expect(trigger).toBeInTheDocument();
    expect(trigger.closest("span[style]")).not.toBeNull();
  });
});
