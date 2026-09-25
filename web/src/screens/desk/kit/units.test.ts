/** A study's target moves in the target's own unit (kit/units.ts; DESK_FRAME3_SPEC §1.9). */
import { describe, expect, it } from "vitest";
import { diffText, isLog, isUnit, LOG_TIP, moveText, rangeText, scaleOf, tickText, tipOf, whisker } from "./units";

describe("units (§1.9)", () => {
  it("prints a log return as 100 × native with a % sign, never exponentiated", () => {
    expect(moveText(0.031, "log_return")).toBe("+3.1%");
    expect(moveText(-0.094, "log_return")).toBe("−9.4%");
    // exp(0.5) − 1 would be +64.9%; the linear display is +50.0%.
    expect(moveText(0.5, "log_return")).toBe("+50.0%");
    expect(moveText(0.012, "log_change")).toBe("+1.2%");
    expect(tickText(5, "log_return")).toBe("+5%");
    expect(scaleOf("log_return")).toBe(100);
    expect(scaleOf("log_change")).toBe(100);
  });
  it("prints an interval on Δ, native in, in log percentage points", () => {
    expect(rangeText(-0.016, 0.041, "log_return")).toBe("−1.6 to +4.1 pts");
  });
  it("prints a difference of two moves as log percentage points or bp (vs normal, §1.9)", () => {
    expect(diffText(0.031 - 0.013, "log_return")).toBe("+1.8 pts");
    expect(diffText(6, "bp")).toBe("+6 bp");
    expect(diffText(-2.5, "bp")).toBe("−2.5 bp");
    expect(diffText(0.01, undefined)).toBeNull();
  });
  it("prints basis points unchanged, never as a percent", () => {
    expect(moveText(25, "bp")).toBe("+25 bp");
    expect(moveText(-12.5, "bp")).toBe("−12.5 bp");
    expect(rangeText(-10, 40, "bp")).toBe("−10 to +40 bp");
    expect(tickText(-25, "bp")).toBe("−25 bp");
    expect(scaleOf("bp")).toBe(1);
    for (const f of [moveText(25, "bp"), rangeText(-10, 40, "bp"), tickText(25, "bp")]) expect(f).not.toContain("%");
  });
  it("draws the whisker from baseline + ci in native units, then scales it", () => {
    // Gold study at 20 sessions: baseline 0.013, Δ interval −0.016 to +0.041 → −0.3 to +5.4 on the chart.
    const w = whisker(0.013, -0.016, 0.041, "log_return")!;
    expect(w.lo).toBeCloseTo(-0.3, 10);
    expect(w.hi).toBeCloseTo(5.4, 10);
    expect(whisker(5, -10, 40, "bp")).toEqual({ lo: -5, hi: 45 });
    expect(whisker(0.013, null, 0.041, "log_return")).toBeNull();
    expect(whisker(null, -0.016, 0.041, "log_return")).toBeNull();
  });
  it("gives every log number the tooltip and bp none", () => {
    expect(LOG_TIP).toBe("log return, ×100");
    expect(tipOf("log_return")).toBe(LOG_TIP);
    expect(tipOf("log_change")).toBe(LOG_TIP);
    expect(tipOf("bp")).toBeUndefined();
    expect(tipOf(undefined)).toBeUndefined();
    expect(isLog("bp")).toBe(false);
  });
  it("prints nothing for a unit it does not know, and never guesses one", () => {
    expect(moveText(0.031, undefined)).toBeNull();
    for (const old of ["pct", "px", "percent"]) {
      expect(isUnit(old)).toBe(false);
      expect(moveText(0.031, old as never)).toBeNull();
    }
    expect(moveText(null, "log_return")).toBeNull();
    expect(rangeText(null, 1, "bp")).toBeNull();
  });
  it("prints zero as a bare 0 on the axis", () => {
    expect(tickText(0, "bp")).toBe("0");
  });
});
