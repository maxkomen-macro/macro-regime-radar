/**
 * Basket & Hedge's lead sentences (./trades.ts): each states its card's
 * answer with served numbers. Checked against the fixture's real answer for
 * the sample basket (Yahoo closes through 2026-09-23, priced by the API's own
 * functions; scripts/desk_basket_fixture.py).
 */
import { describe, expect, it } from "vitest";
import basketPrice from "../../../fixtures/desk/basket-price.json";
import basketHedge from "../../../fixtures/desk/basket-hedge.json";
import type { BasketHedgeResponse, BasketPriceResponse } from "../data/types";
import { hedgeLead, pnlWords, stressLead, compareLead, concentrationLead, contributionLead, daysText, indexLead, listWords, liquidityLead, momentumLead, rsLead, startSentence, startWhy, trendPhrase, upDown, usd } from "./trades";

const ANSWERS = (basketPrice as unknown as { answers: Record<string, BasketPriceResponse> }).answers;
const SAMPLE = ANSWERS["NVDA:22,AVGO:16,VRT:14,CRWV:12,ANET:12,CEG:12,SMCI:12|hold|1000000"];
const HEDGES = (basketHedge as unknown as { answers: Record<string, BasketHedgeResponse> }).answers;
const PRESET = "NVDA:10,AVGO:10,AMD:10,TSM:10,MU:10,ANET:10,VRT:10,CEG:10,CRWV:10,NBIS:10|hold|1000000";

describe("Basket & Hedge's lead sentences", () => {
  it("the fixture answers the sample basket", () => {
    expect(SAMPLE?.start).toBe("2025-03-28");
  });

  it("each card's sentence states its answer with the served numbers", () => {
    expect(indexLead(SAMPLE)).toBe("Up 113.8% since Mar 28, 2025 and +8.6% over the last year; above both its 50- and 200-day averages since Sep 21.");
    expect(momentumLead(SAMPLE.index)).toBe("RSI(14) is 51, the index is 14.6% below its Jun 2, 2026 peak and the last 21 sessions moved at 40% a year.");
    expect(compareLead(SAMPLE, "1y")).toBe("Over the last year (since Sep 22, 2025) the basket returned +8.6%, against +23.7% for QQQ and +16.4% for SPY; over a year it has moved 1.71× QQQ, correlation 0.77.");
    expect(compareLead(SAMPLE, "6m")).toBe("Since Mar 24, 2026 the basket is +14.4%, against +27.2% for QQQ and +18.1% for SPY; over a year it has moved 1.71× QQQ, correlation 0.77.");
    expect(rsLead(SAMPLE.compare!["6m"]!.points, SAMPLE.compare!["6m"]!.base_date)).toBe("Basket ÷ benchmark, 100 on Mar 24: against QQQ at 90, below its 50-day average; against SPY at 97, below its 50-day average.");
    expect(contributionLead(SAMPLE)).toBe("VRT added 33.0 of the index's 113.8 points since Mar 28; SMCI added the least, 2.5.");
    expect(concentrationLead(SAMPLE.concentration)).toBe("VRT, NVDA and AVGO are 59% of the basket at the last close; it holds like 6.1 equal-weight names, and its names' average pairwise correlation is 0.43.");
    expect(liquidityLead(SAMPLE)).toBe("At $1,000,000 the slowest name to trade is CEG: 0.00076 days at 20% of its 20-day average dollar volume.");
  });

  it("the start says whose first close it is, or that every history starts there", () => {
    expect(startSentence(SAMPLE)).toBe("Base 100 on Mar 28, 2025, the first session every name has a price (CRWV's first close).");
    expect(startWhy({ start_binding: ["CRWV", "NBIS"], start_is_first_close: true })).toBe("the first closes of CRWV and NBIS");
    expect(startWhy({ start_binding: ["NVDA", "AVGO"], start_is_first_close: false })).toBe("the start of the daily history the API reads");
  });

  it("a sentence whose numbers are not served is not written", () => {
    expect(indexLead({ ...SAMPLE, total_return: null })).toBeNull();
    expect(momentumLead(undefined)).toBeNull();
    expect(momentumLead({ ...SAMPLE.index!, rsi: null, realized_vol_21d: null, drawdown: undefined })).toBeNull();
    expect(liquidityLead({ ...SAMPLE, liquidity: { participation: 0.2, adv_sessions: 20, basket_days: null, binding: null } })).toBeNull();
    // With no one-year return the comparison falls back to the range's own rebased values.
    const young = { ...SAMPLE, index: { ...SAMPLE.index!, ret_1y: null } };
    expect(compareLead(young, "1y")).toMatch(/^Since Sep 24, 2025 the basket is /);
    expect(concentrationLead(undefined)).toBeNull();
  });

  it("formats days, dollars, lists, moves and trends", () => {
    expect(daysText(0.0007570954522448842)).toBe("0.00076 days");
    expect(daysText(0.5)).toBe("0.50 days");
    expect(daysText(1)).toBe("1.0 day");
    expect(daysText(12.4)).toBe("12 days");
    expect(usd(1_000_000)).toBe("$1,000,000");
    expect(usd(792_500_000, true)).toBe("$792.5M");
    expect(usd(29_200_000_000, true)).toBe("$29.2B");
    expect(usd(-46_071, true)).toBe("−$46.1K");
    expect(listWords(["A"])).toBe("A");
    expect(listWords(["A", "B", "C"])).toBe("A, B and C");
    expect(upDown(-0.123)).toBe("Down 12.3%");
    expect(upDown(0.00001)).toBe("Flat");
    expect(trendPhrase({ state: "mixed", state_since: "2026-09-01" })).toBe("between its 50- and 200-day averages since Sep 1");
    expect(trendPhrase({ state: "unavailable", state_since: null })).toBe("its 200-day average needs 200 sessions of the index");
  });

  it("the hedge's sentences: the top pick with its fit, short and volatility; the stress, unhedged and hedged", () => {
    const h = HEDGES[PRESET];
    expect(hedgeLead(h)).toBe("SMH fits the basket best (R² 0.74 over a year): short $1,233,779 of it against $1,000,000 and the basket's volatility falls from 57% to 29%, 49% less.");
    expect(stressLead(h)).toBe("If QQQ falls 10% the basket loses $223,092 unhedged and makes $222 hedged with SMH; if SPY falls 10% the basket loses $286,219 unhedged and makes $6,534 hedged with SMH.");
    expect(pnlWords(-0.4)).toBe("is flat");
    expect(pnlWords(-1234.6)).toBe("loses $1,235");
    // A young basket is ranked on 60 sessions and says so.
    const young = { ...h, etfs: h.etfs!.map((e, i) => (i === 0 ? { ...e, basis: "60d" as const, r2_1y: null } : e)) };
    expect(hedgeLead(young)).toMatch(/^SMH fits the basket best \(R² 0\.77 over 60 sessions\)/);
    expect(hedgeLead({ ...h, top: null })).toBeNull();
  });
});
