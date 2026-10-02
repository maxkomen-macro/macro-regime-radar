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
import { basketLead, capLabel, capLabelOf, capWeightsWords, methodSentence } from "./trades";
import { asOfMismatch, stressShortWords, stressWindowWords, excludedWords, hedgeLead, pnlWords, stressLead, compareLead, concentrationLead, contributionLead, daysText, indexLead, listWords, liquidityLead, momentumLead, rsLead, startSentence, startWhy, trendPhrase, upDown, usd } from "./trades";

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
    // Codex R-03: a start after a gap names the session the name had no close on.
    expect(startWhy({ start_binding: ["A"], start_is_first_close: false, start_kind: "gap", start_gap_session: "2026-01-29" })).toBe("A has no close on Jan 29, 2026");
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
    expect(stressLead(h)).toBe("With the table's hedge, short $1,233,779 of SMH: if QQQ falls 10% the basket loses $223,092 unhedged and makes $222 hedged; if SPY falls 10% the basket loses $286,219 unhedged and makes $6,534 hedged.");
    expect(pnlWords(-0.4)).toBe("is flat");
    expect(pnlWords(-1234.6)).toBe("loses $1,235");
    // A young basket is ranked on 60 sessions and says so.
    const young = { ...h, etfs: h.etfs!.map((e, i) => (i === 0 ? { ...e, basis: "60d" as const, r2_1y: null } : e)) };
    expect(hedgeLead(young)).toMatch(/^SMH fits the basket best \(R² 0\.77 over 60 sessions\)/);
    expect(hedgeLead({ ...h, top: null })).toBeNull();
  });

  it("Codex R-15: the stress card says which short it holds, the table's, and holds it as it is", () => {
    const h = HEDGES[PRESET];
    // Codex's repro as served: the table recommends $1M of SMH; QQQ's window gives the basket a beta of 3 and SMH 1.
    const row = { ...h.stress![0], shock: "QQQ" as const, hedge: "SMH", hedge_ratio: 1, short_usd: 1_000_000, basket_beta: 3, basket_move: -0.3, unhedged_usd: -300_000, hedge_beta: 1, hedge_move: -0.1, hedge_usd: 100_000, hedged_usd: -200_000, hedged_move: -0.2 };
    const r15 = { ...h, stress: [row, { ...row, shock: "SPY" as const }] };
    expect(stressLead(r15)).toBe("With the table's hedge, short $1,000,000 of SMH: if QQQ falls 10% the basket loses $300,000 unhedged and loses $200,000 hedged; if SPY falls 10% the basket loses $300,000 unhedged and loses $200,000 hedged.");
    expect(stressShortWords(r15)).toBe("Hedged holds the short the table above recommends, $1,000,000 of SMH (1.00× the basket), as it is under both shocks.");
    expect(stressShortWords(h)).toBe("Hedged holds the short the table above recommends, $1,233,779 of SMH (1.23× the basket), as it is under both shocks.");
    // No recommended short: the lead gives the unhedged figures alone and the footnote names no short.
    const none = { ...h, stress: h.stress!.map((s) => ({ ...s, hedge: null, hedge_ratio: null, short_usd: null, hedge_usd: null, hedged_usd: null, hedged_move: null })) };
    expect(stressLead(none)).toBe("If QQQ falls 10% the basket loses $223,092 unhedged; if SPY falls 10% the basket loses $286,219 unhedged.");
    expect(stressShortWords(none)).toBeNull();
  });

  it("Codex R-07: closes left out for want of an adjusted close are said, by symbol", () => {
    expect(excludedWords([{ symbol: "SPLT", n: 1, reason: "no adjusted close from the provider" }])).toBe("Left out: SPLT, 1 session (no adjusted close from the provider).");
    expect(excludedWords([])).toBeNull();
    expect(excludedWords(undefined)).toBeNull();
  });

  it("Codex R-09: the stress footnote says the window it was fitted on, never one year for a 60-session fit", () => {
    const h = HEDGES[PRESET];
    expect(stressWindowWords(h)).toBe("Betas fitted on the 252 sessions from Sep 22, 2025 to Sep 23, 2026 (one year), on which the basket, SMH and the shock all trade. No convexity, no costs.");
    const w = { start: "2026-06-26", end: "2026-09-23", n: 60 };
    const young = { ...h, etfs: h.etfs!.map((e, i) => (i === 0 ? { ...e, basis: "60d" as const } : e)), stress: h.stress!.map((s) => ({ ...s, window: w })) };
    const words = stressWindowWords(young)!;
    expect(words).toContain("the 60 sessions from Jun 26, 2026 to Sep 23, 2026 (60 sessions, fewer than a year of shared returns)");
    expect(words).not.toMatch(/one year|one-year/i);
  });

  it("Codex R-08: a hedge answered at another session than the price says so", () => {
    expect(asOfMismatch("2026-09-25", "2026-09-24")).toBe("The hedge reads prices through Sep 24, 2026; the basket above reads them through Sep 25, 2026. The two were answered at different sessions.");
    expect(asOfMismatch("2026-09-25", "2026-09-25")).toBeNull();
    expect(asOfMismatch(undefined, "2026-09-25")).toBeNull();
  });
});

// ── desk/cap-weight: the preset cap-weighted, from the same closes ──────────


const CAP = ANSWERS["NVDA,AVGO,AMD,TSM,MU,ANET,VRT,CEG,CRWV,NBIS|hold|1000000|cap"];
const CAP_MONTHLY = ANSWERS["NVDA,AVGO,AMD,TSM,MU,ANET,VRT,CEG,CRWV,NBIS|monthly|1000000|cap"];
const CAP_HEDGE = HEDGES["NVDA,AVGO,AMD,TSM,MU,ANET,VRT,CEG,CRWV,NBIS|hold|1000000|cap"];

describe("a cap-weighted basket's words (desk/cap-weight)", () => {
  it("the label names the counts' provider and their oldest read; typed weights carry none", () => {
    expect(capLabel("Yahoo", "2026-10-01")).toBe("Cap-weighted: market value at the start, current share counts (Yahoo, as of Oct 1, 2026)");
    expect(capLabelOf(CAP)).toBe("Cap-weighted: market value at the start, current share counts (Yahoo, as of Oct 1, 2026)");
    expect(capLabelOf(ANSWERS[PRESET])).toBeNull();
  });

  it("the method in a cap-weighted basket's words: held, its weights move with each company; monthly, the same index", () => {
    expect(methodSentence("hold", "cap")).toBe("Bought at each company's market value at the start and held, so each weight moves with its company's value, as in a cap-weighted index.");
    expect(methodSentence("monthly", "cap")).toBe("Reset to cap weights at each month's first session; with one set of share counts each reset leaves the holdings as they were, so the index is the held one.");
    expect(methodSentence("hold")).toBe("Bought and held: the share counts are fixed at the start, so the weights drift with price.");
    expect(CAP_MONTHLY.total_return).toBeCloseTo(CAP.total_return as number, 12);
  });

  it("the basket's lead says cap-weighted with its largest weight at the start, or why it is priced at typed weights", () => {
    const b = { name: "AI Infrastructure 10", legs: CAP.legs!.map((l) => ({ symbol: l.symbol, weight: "10" })) };
    expect(capWeightsWords(CAP)).toBe("cap-weighted, the largest NVDA at 55% at the start");
    expect(basketLead(b, "hold", 1_000_000, CAP, "cap")).toBe(
      "AI Infrastructure 10 holds 10 names, cap-weighted, the largest NVDA at 55% at the start, bought and held, $1,000,000: up 155.8% since Mar 28, 2025, the first session every name has a price (CRWV's first close).",
    );
    expect(basketLead(b, "hold", 1_000_000, undefined, "cap")).toBe("AI Infrastructure 10 holds 10 names, cap-weighted, bought and held, $1,000,000.");
    // Cap weight unavailable: priced at the typed weights, and the lead says so.
    expect(basketLead(b, "hold", 1_000_000, ANSWERS[PRESET], "cap")).toBe(
      "AI Infrastructure 10 holds 10 names, 10% each (cap weight is unavailable), bought and held, $1,000,000: up 346.5% since Mar 28, 2025, the first session every name has a price (CRWV's first close).",
    );
  });

  it("every card reads the chosen weights: the same ten names equal-weighted and cap-weighted give two sets of answers", () => {
    const EQ = ANSWERS[PRESET];
    const EQ_HEDGE = HEDGES[PRESET];
    expect(indexLead(EQ)).toBe("Up 346.5% since Mar 28, 2025 and +98.6% over the last year; above both its 50- and 200-day averages since Sep 17.");
    expect(indexLead(CAP)).toBe("Up 155.8% since Mar 28, 2025 and +46.6% over the last year; above both its 50- and 200-day averages since Sep 17.");
    expect(compareLead(CAP, "1y")).toBe("Over the last year (since Sep 22, 2025) the basket returned +46.6%, against +23.7% for QQQ and +16.4% for SPY; over a year it has moved 1.61× QQQ, correlation 0.87.");
    expect(compareLead(EQ, "1y")).toContain("over a year it has moved 2.23× QQQ, correlation 0.78.");
    expect(contributionLead(CAP)).toBe("NVDA added 58.6 of the index's 155.8 points since Mar 28; CRWV added the least, 0.4.");
    expect(concentrationLead(CAP.concentration)).toBe("NVDA, TSM and AVGO are 77% of the basket at the last close; it holds like 3.7 equal-weight names, and its names' average pairwise correlation is 0.47.");
    expect(liquidityLead(CAP)).toBe("At $1,000,000 the slowest name to trade is TSM: 0.00022 days at 20% of its 20-day average dollar volume.");
    expect(hedgeLead(CAP_HEDGE)).toBe("SMH fits the basket best (R² 0.83 over a year): short $847,384 of it against $1,000,000 and the basket's volatility falls from 37% to 15%, 59% less.");
    expect(hedgeLead(EQ_HEDGE)).toBe("SMH fits the basket best (R² 0.74 over a year): short $1,233,779 of it against $1,000,000 and the basket's volatility falls from 57% to 29%, 49% less.");
    expect(stressLead(CAP_HEDGE)).toBe(
      "With the table's hedge, short $847,384 of SMH: if QQQ falls 10% the basket loses $160,835 unhedged and loses $7,458 hedged; if SPY falls 10% the basket loses $218,520 unhedged and loses $17,452 hedged.",
    );
    // Liquidity's dollars: a cap-weighted basket bought at the last close's market values (its weights now).
    for (const l of CAP.legs!) expect(l.dollars).toBeCloseTo((l.weight_now as number) * 1_000_000, 6);
  });
});
