/**
 * The prototypes' Black-Scholes (DESK_FRAME3_SPEC §1.0.3): textbook values,
 * put-call parity, and the 25-delta strike solve.
 */
import { describe, expect, it } from "vitest";
import { callDelta, callValue, normCdf, putDelta, putValue, strikeForDelta, years } from "./black-scholes";

describe("Black-Scholes", () => {
  it("the normal distribution function", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1.96)).toBeCloseTo(0.9750021, 6);
    expect(normCdf(-1)).toBeCloseTo(0.1586553, 6);
  });

  it("the textbook value: spot 100, strike 100, a year, 5%, 20% vol → call 10.4506, put 5.5735", () => {
    const l = { strike: 1, t: 1, vol: 0.2, r: 0.05, q: 0 };
    expect(callValue(l) * 100).toBeCloseTo(10.4506, 3);
    expect(putValue(l) * 100).toBeCloseTo(5.5735, 3);
  });

  it("put-call parity with a dividend yield", () => {
    for (const strike of [0.85, 0.95, 1, 1.05]) {
      const l = { strike, t: years(91), vol: 0.31, r: 0.041, q: 0.012 };
      expect(callValue(l) - putValue(l)).toBeCloseTo(Math.exp(-l.q * l.t) - strike * Math.exp(-l.r * l.t), 9);
    }
  });

  it("solves the 25-delta strikes: a put below spot, a call above", () => {
    const base = { t: years(30), r: 0.041, q: 0.012 };
    const kp = strikeForDelta("put", -0.25, { ...base, vol: 0.192 });
    const kc = strikeForDelta("call", 0.25, { ...base, vol: 0.124 });
    expect(putDelta({ ...base, vol: 0.192, strike: kp })).toBeCloseTo(-0.25, 9);
    expect(callDelta({ ...base, vol: 0.124, strike: kc })).toBeCloseTo(0.25, 9);
    expect(kp).toBeCloseTo(0.9674, 3);
    expect(kc).toBeCloseTo(1.0273, 3);
  });
});
