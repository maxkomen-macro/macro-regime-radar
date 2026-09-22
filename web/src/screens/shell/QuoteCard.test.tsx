/**
 * Iteration 1, Step 1 (shell) contract D / item S2: every ticker-strip quote
 * card renders one layout with five fixed slots in DOM order, each always
 * present and marked with data-slot: symbol, value, change, tag, spark. A
 * feed with no day change renders "—" in the change slot (plus its tag),
 * never an empty gap. Rendered alone: QuoteCard takes plain props.
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import QuoteCard, { type QuoteCardProps } from "./QuoteCard";

const SLOTS = ["symbol", "value", "change", "tag", "spark"] as const;

function slotsOf(card: Element): string[] {
  return Array.from(card.querySelectorAll<HTMLElement>("[data-slot]"))
    .map((el) => el.dataset.slot ?? "")
    .filter((name) => (SLOTS as readonly string[]).includes(name));
}

function renderCard(props: QuoteCardProps) {
  const { container } = render(<QuoteCard {...props} />);
  const card = container.firstElementChild as HTMLElement;
  expect(card).not.toBeNull();
  const slot = (name: (typeof SLOTS)[number]) => card.querySelector<HTMLElement>(`[data-slot="${name}"]`);
  return { card, slot };
}

const CASES: { name: string; props: QuoteCardProps }[] = [
  {
    name: "a live quote with a day change, a tag and a sparkline",
    props: { symbol: "SPY", price: "645.20", raw: 645.2, change: "+0.42%", changeTone: "pos", tag: { text: "15M", tone: "amber" }, series: [640, 642, 645.2] },
  },
  {
    name: "a stored close with no day change (the off-hours read)",
    props: { symbol: "QQQ", price: "572.90", raw: 572.9, tag: { text: "CLOSE", title: "Stored close", tone: "amber" }, series: [570.4, 572.9] },
  },
  {
    name: "a weekly change with the 1W tag",
    props: { symbol: "US 10Y", price: "4.12%", raw: 4.12, change: "+5 bps", changeTone: "pos", tag: { text: "1W", tone: "muted" }, series: [4.07, 4.12] },
  },
  {
    name: "no price anywhere (no change, no tag, no series)",
    props: { symbol: "US 10Y", price: "—" },
  },
];

describe("QuoteCard slots (S2)", () => {
  for (const c of CASES) {
    it(`renders the five slots in order for ${c.name}`, () => {
      const { card, slot } = renderCard(c.props);
      expect(slotsOf(card)).toEqual([...SLOTS]);
      for (const name of SLOTS) {
        expect(card.querySelectorAll(`[data-slot="${name}"]`), `exactly one ${name} slot`).toHaveLength(1);
      }
      expect(slot("symbol")?.textContent?.trim()).toBe(c.props.symbol);
      expect(slot("value")?.textContent?.trim()).toBe(c.props.price);
      // The change slot is never empty: the change itself or the marked dash.
      const change = slot("change")?.textContent?.trim() ?? "";
      expect(change).toBe(c.props.change ?? "—");
      if (c.props.tag) expect(slot("tag")?.textContent).toContain(c.props.tag.text);
    });
  }

  it('a missing day change renders "—" in the change slot, and the tag stays in its own slot', () => {
    const { slot } = renderCard({ symbol: "SPY", price: "645.20", raw: 645.2, tag: { text: "CLOSE", tone: "amber" }, series: [640, 645.2] });
    expect(slot("change")?.textContent?.trim()).toBe("—");
    expect(slot("tag")?.textContent?.trim()).toBe("CLOSE");
    expect(slot("change")?.textContent).not.toContain("CLOSE");
  });

  it("an empty-string change is treated as missing, never an empty gap", () => {
    const { slot } = renderCard({ symbol: "SPY", price: "645.20", change: "", series: [] });
    expect(slot("change")?.textContent?.trim()).toBe("—");
  });

  it("the spark slot is present with fewer than two points", () => {
    for (const series of [undefined, [], [645.2]]) {
      const { card, slot } = renderCard({ symbol: "SPY", price: "645.20", series });
      expect(slot("spark"), `series=${JSON.stringify(series)}`).not.toBeNull();
      expect(slotsOf(card)).toEqual([...SLOTS]);
    }
  });

  it("the tag slot is present (possibly empty) when no tag is given", () => {
    const { card, slot } = renderCard({ symbol: "QQQ", price: "572.90", change: "-0.10%", changeTone: "neg", series: [573, 572.9] });
    expect(slot("tag")).not.toBeNull();
    expect(slotsOf(card)).toEqual([...SLOTS]);
  });
});
