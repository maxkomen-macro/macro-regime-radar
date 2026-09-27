/**
 * "What protection costs right now" (PROTOTYPE, DESK_FRAME3_SPEC §1.0.3):
 * illustrative, but its numbers agree with each other and with vol.json.
 */
import { describe, expect, it } from "vitest";
import vol from "../../../fixtures/desk/vol.json";
import { callDelta, putDelta, years } from "./black-scholes";
import { protection } from "./protection";

describe("the protection card's numbers", () => {
  const p = protection();

  it("the skew is the 25-delta put's vol less the call's, and vol.json's", () => {
    expect(p.put.iv - p.call.iv).toBeCloseTo(vol.skew_25d_1m_pts, 9);
    expect(p.skew).toBe(vol.skew_25d_1m_pts);
  });

  it("each strike is its side's 25-delta strike at its own vol, and the put costs more than the call", () => {
    const base = { t: years(p.days["1m"]), r: p.rate, q: p.dividendYield };
    expect(putDelta({ ...base, vol: p.put.iv / 100, strike: p.put.strike })).toBeCloseTo(-0.25, 6);
    expect(callDelta({ ...base, vol: p.call.iv / 100, strike: p.call.strike })).toBeCloseTo(0.25, 6);
    expect(p.put.strike).toBeLessThan(1);
    expect(p.call.strike).toBeGreaterThan(1);
    expect(p.put.cost).toBeGreaterThan(p.call.cost);
  });

  it("implied is vol.json's term, realized at a month is its realized_20d, and options price more than happened at every tenor", () => {
    expect(p.implied).toEqual(vol.term);
    expect(p.realized["1m"]).toBe(vol.realized_20d);
    expect(p.implied["1m"]).toBe(vol.atm_iv_1m);
    for (const t of ["1m", "3m", "6m"] as const) expect(p.implied[t]).toBeGreaterThan(p.realized[t]);
  });

  it("today's skew is the line's last reading, at vol.json's two-year percentile", () => {
    expect(p.history[p.history.length - 1].pts).toBe(vol.skew_25d_1m_pts);
    expect(Math.round(p.percentile * 100)).toBe(Math.round(vol.skew_pct_2y * 100));
    expect(p.history[p.history.length - 1].date).toBe(vol.dates.skew_25d_1m_pts);
    // Two years of weekly readings, seven days apart.
    const d = p.history.map((x) => Date.parse(x.date));
    expect(d.every((t, i) => i === 0 || t - d[i - 1] === 7 * 86400000)).toBe(true);
    expect((d[d.length - 1] - d[0]) / 86400000).toBe(728);
  });

  it("the trend's words agree with the line: the low since June is below today", () => {
    expect(vol.skew_trend).toBe("rising since June");
    const june = p.history.filter((x) => x.date >= "2026-06-01" && x.date < "2026-07-01").map((x) => x.pts);
    expect(Math.min(...june)).toBeLessThan(vol.skew_25d_1m_pts);
    const since = p.history.filter((x) => x.date >= "2026-06-17");
    expect(since[since.length - 1].pts - since[0].pts).toBeGreaterThan(1.5);
  });
});
