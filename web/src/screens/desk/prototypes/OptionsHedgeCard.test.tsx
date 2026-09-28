/**
 * Codex R-02 on the page: a basket engine answer with a hedge ratio of 0.10 puts the ETF and basket routes
 * outside the card's pricing domain. Their rows say why in plain words; no NaN, no negative strike.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("./basket-inputs", async (importOriginal) => {
  const real = await importOriginal<typeof import("./basket-inputs")>();
  return { ...real, basketInputs: (b: Parameters<typeof real.basketInputs>[0]) => { const i = real.basketInputs(b); return i ? { ...i, top: { ...i.top, hedge_ratio: 0.1 } } : i; } };
});

import { OptionsHedgeCard } from "./OptionsHedgeCard";
import { sampleBasket } from "./basket-inputs";

describe("Hedge with options at a hedge ratio of 0.10 (Codex R-02)", () => {
  it("the ETF and basket routes print the reason in place of numbers; the names route is priced; no NaN or negative strike", () => {
    render(<OptionsHedgeCard basket={sampleBasket()} />);
    const card = screen.getByRole("region", { name: /^Hedge with options/ });
    expect(card).toHaveTextContent(/Hedge ratio\s*0\.10/);
    const tables = within(card).getAllByRole("table");
    expect(tables).toHaveLength(3);
    for (const t of [tables[0], tables[2]]) {
      const rows = within(t).getAllByRole("row").slice(1);
      for (const r of rows) {
        expect(r).toHaveTextContent("Not priced: the hedge ratio, 0.10, is outside the 0.25 to 4 this card prices.");
        expect(r.textContent).not.toMatch(/\$|%\s*\$|basket down/);
      }
    }
    expect(within(tables[1]).getAllByRole("row").slice(1)[0]).toHaveTextContent(/1M 95 put\s*1\.57%\s*\$15,700/);
    expect(card.textContent).not.toMatch(/NaN|Infinity|−\d+(\.\d+)?% of XLK/);
    expect(card).not.toHaveTextContent("so 95/85 is");
  });
});
