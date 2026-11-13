/**
 * "Event study on this basket" (DESK_FRAME3_SPEC §10, §12.19; desk P1a): what the card asks for, and the words it
 * prints from `/basket/study`'s answer, read off the served fixture (stored ETF closes run through the route's own
 * functions, scripts/desk_basket_study_fixture.py).
 */
import { describe, expect, it } from "vitest";
import doc from "../../../fixtures/desk/basket-study.json";
import type { BasketStudyResponse } from "../data/types";
import { pctPlain } from "../kit/format";
import { horizonWords, indexLine, membershipWords, moveWords, questionLine, selectedRow, startWords, studyParams, studyReleased } from "./study";

const answers = (doc as unknown as { answers: Record<string, BasketStudyResponse> }).answers;
const hold = answers["legs=SMH:40,SOXX:30,XLK:30&method=hold"];
const monthly = answers["legs=SMH:40,SOXX:30,XLK:30&method=monthly"];

describe("what the card asks /basket/study", () => {
  it("/basket/price's basket without the notional, cap weight kept; nothing while the page would not price it", () => {
    expect(studyParams(null)).toBeNull();
    expect(studyParams({ legs: "SMH:40,SOXX:30,XLK:30", method: "hold", notional: "1000000" })).toEqual({ legs: "SMH:40,SOXX:30,XLK:30", method: "hold" });
    expect(studyParams({ legs: "NVDA,AVGO", method: "monthly", notional: "1000000", weighting: "cap" })).toEqual({ legs: "NVDA,AVGO", method: "monthly", weighting: "cap" });
  });
});

describe("the study waits for this basket's price (the busy fix, option C)", () => {
  const hold = { legs: "SMH:40,SOXX:30,XLK:30", method: "hold", notional: "1000000" };
  it("released only by a price answered for the same legs, method and weighting; the notional does not matter", () => {
    const asked = studyParams(hold);
    expect(studyReleased(asked, null)).toBe(false);
    expect(studyReleased(null, hold)).toBe(false);
    expect(studyReleased(asked, hold)).toBe(true);
    expect(studyReleased(asked, { ...hold, notional: "250000" })).toBe(true);
    // Another basket's price, the same names at other weights, another method, or cap weight never release it.
    expect(studyReleased(asked, { ...hold, legs: "NVDA:50,AVGO:50" })).toBe(false);
    expect(studyReleased(asked, { ...hold, legs: "SMH:50,SOXX:25,XLK:25" })).toBe(false);
    expect(studyReleased(asked, { ...hold, method: "monthly" })).toBe(false);
    expect(studyReleased(studyParams({ ...hold, legs: "SMH,SOXX,XLK", weighting: "cap" }), { ...hold, legs: "SMH,SOXX,XLK" })).toBe(false);
    expect(studyReleased(studyParams({ ...hold, legs: "SMH,SOXX,XLK" }), { ...hold, legs: "SMH,SOXX,XLK", weighting: "cap" })).toBe(false);
  });
});

describe("the words from the served answer", () => {
  it("the fixture is two served runs of the default question on the same names", () => {
    for (const a of [hold, monthly]) {
      expect(a.question).toMatchObject({ window: 5, move: "down2s", horizon: 20, while: "none" });
      expect(a.study).not.toBeNull();
      expect(a.not_run).toBeNull();
      expect(a.study!.regime_history).toBe("revised");
      expect(a.caveats.length).toBeGreaterThanOrEqual(2);
    }
    expect(hold.index.rule).not.toBe(monthly.index.rule);
  });

  it("the question reads the selected horizon's served share; the move and horizon in words", () => {
    const row = selectedRow(hold)!;
    expect(row.h).toBe(20);
    expect(moveWords(hold)).toBe("falls 2σ over 5 days");
    expect(horizonWords(20)).toBe("a month later");
    expect(horizonWords(60)).toBe("three months later");
    expect(questionLine("Chips", hold, pctPlain)).toBe(`After Chips falls 2σ over 5 days, it was higher a month later ${pctPlain(row.up_pct!)} of the time.`);
    // no served share: the question asks, it does not answer
    const none = { ...hold, study: { ...hold.study!, horizons: hold.study!.horizons.map((h) => ({ ...h, up_pct: null })) } };
    expect(questionLine("Chips", none, pctPlain)).toBe("After Chips falls 2σ over 5 days, how it did a month later.");
  });

  it("membership, weighting, rebalancing and start are stated the page's way", () => {
    expect(membershipWords(hold)).toBe("SMH 40%, SOXX 30%, XLK 30%, at the saved weights");
    expect(startWords(hold.index)).toBe("Jul 13, 2001, SOXX's first close");
    const line = indexLine(monthly);
    expect(line).toContain("SMH 40%, SOXX 30%, XLK 30%, at the saved weights; rebalanced to the saved weights at each month's last session.");
    expect(line).toContain("A session counts only when every name has a close.");
    expect(line).toContain("from Jul 13, 2001, SOXX's first close, through Sep 23, 2026.");
    const cap = { ...hold, basket: { ...hold.basket, weighting: "cap" as const, legs: hold.basket.legs.map((l) => ({ ...l, weight: null })) } };
    expect(membershipWords(cap)).toBe("SMH, SOXX, XLK, cap-weighted at the start from the stored share counts");
    expect(startWords({ ...hold.index, start_kind: "gap", start_binding: ["XLK"] })).toBe("Jul 13, 2001, the first session every name has a close (XLK had none the session before)");
  });
});
