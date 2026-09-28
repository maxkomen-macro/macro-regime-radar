/**
 * "Hedge with options" reads step 3's served /basket/hedge answer (§12.16): its inputs row is that answer's
 * notional and top pick. Codex R-02 on the page: an answer with a hedge ratio of 0.10 puts the ETF and basket
 * routes outside the card's pricing domain; their rows say why in plain words, no NaN, no negative strike.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import hedgeAnswers from "../../../fixtures/desk/basket-hedge.json";
import type { BasketHedgeResponse } from "../data/types";
import { legsKey } from "../basket/weights";
import { OptionsHedgeCard } from "./OptionsHedgeCard";
import baskets from "../../../fixtures/desk/baskets.json";
import type { SavedBasket } from "../basket/weights";

/** The fixture tests' sample basket (baskets.json's first), which the fixture server hedges. */
const sample = (baskets as { baskets: SavedBasket[] }).baskets[0];
const served = (hedgeAnswers as unknown as { answers: Record<string, BasketHedgeResponse> }).answers[`${legsKey(sample.legs)}|hold|1000000`];
const card = () => screen.getByRole("region", { name: /^Hedge with options/ });

describe("Hedge with options: the inputs row is the served answer's", () => {
  it("the answer's notional, top pick, its hedge ratio and R² on its window", () => {
    render(<OptionsHedgeCard basket={sample} answer={served} />);
    expect(card()).toHaveTextContent(/Notional\s*\$1\.0M\s*AI infrastructure/);
    expect(card()).toHaveTextContent(/Top hedge ETF\s*XLK\s*first of 8 by R², ahead of SMH at 0\.68/);
    expect(card()).toHaveTextContent(/Hedge ratio\s*1\.38/);
    expect(card()).toHaveTextContent(/R²\s*0\.69\s*252 sessions to Sep 23/);
  });

  it("while the answer is on its way the inputs await and nothing is priced", () => {
    render(<OptionsHedgeCard basket={sample} answer={undefined} />);
    expect(card()).toHaveTextContent(/Notional\s*Awaiting refresh/);
    expect(card()).toHaveTextContent("Nothing is priced until the basket's inputs arrive.");
    expect(within(card()).queryAllByRole("table")).toHaveLength(0);
    expect(within(card()).getByTestId("dk-advanced")).toBeDisabled();
    expect(card().querySelector("[data-prototype-foot]")).not.toBeNull();
  });

  it("an answer with no top pick prices nothing and says so", () => {
    render(<OptionsHedgeCard basket={sample} answer={{ ...served, top: null }} />);
    expect(card()).toHaveTextContent("The ETF hedge names no top pick for this basket, so nothing is priced.");
    expect(within(card()).queryAllByRole("table")).toHaveLength(0);
  });
});

describe("Hedge with options at a hedge ratio of 0.10 (Codex R-02)", () => {
  it("the ETF and basket routes print the reason in place of numbers; the names route is priced; no NaN or negative strike", () => {
    const low = { ...served, etfs: served.etfs!.map((e) => (e.symbol === served.top ? { ...e, hedge_ratio: 0.1 } : e)) };
    render(<OptionsHedgeCard basket={sample} answer={low} />);
    const c = card();
    expect(c).toHaveTextContent(/Hedge ratio\s*0\.10/);
    const tables = within(c).getAllByRole("table");
    expect(tables).toHaveLength(3);
    for (const t of [tables[0], tables[2]]) {
      const rows = within(t).getAllByRole("row").slice(1);
      for (const r of rows) {
        expect(r).toHaveTextContent("Not priced: the hedge ratio, 0.10, is outside the 0.25 to 4 this card prices.");
        expect(r.textContent).not.toMatch(/\$|%\s*\$|basket down/);
      }
    }
    expect(within(tables[1]).getAllByRole("row").slice(1)[0]).toHaveTextContent(/1M 95 put\s*1\.57%\s*\$15,700/);
    expect(c.textContent).not.toMatch(/NaN|Infinity|−\d+(\.\d+)?% of XLK/);
    expect(c).not.toHaveTextContent("so 95/85 is");
  });
});
