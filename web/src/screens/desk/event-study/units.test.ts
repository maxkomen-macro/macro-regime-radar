/** A study's target moves in the target's own unit (event-study/units.ts; Codex R-02). */
import { describe, expect, it } from "vitest";
import { isUnit, moveText, rangeText, scaleOf, tickText } from "./units";

describe("target units", () => {
  it("a pct move is a fraction spelled as a percent; its interval is in points", () => {
    expect(moveText(0.031, "pct")).toBe("+3.1%");
    expect(moveText(-0.094, "pct")).toBe("−9.4%");
    expect(rangeText(-1.6, 4.1, "pct")).toBe("−1.6 to +4.1 pts");
    expect(tickText(5, "pct")).toBe("+5%");
    expect(scaleOf("pct")).toBe(100);
  });
  it("a bp move is basis points, never a percent", () => {
    expect(moveText(25, "bp")).toBe("+25 bp");
    expect(moveText(-12.5, "bp")).toBe("−12.5 bp");
    expect(rangeText(-10, 40, "bp")).toBe("−10 to +40 bp");
    expect(tickText(-25, "bp")).toBe("−25 bp");
    expect(scaleOf("bp")).toBe(1);
    for (const f of [moveText(25, "bp"), rangeText(-10, 40, "bp"), tickText(25, "bp")]) expect(f).not.toContain("%");
  });
  it("a px move is the target's own points", () => {
    expect(moveText(12.5, "px")).toBe("+12.5 pts");
    expect(rangeText(-1.2, 3.4, "px")).toBe("−1.2 to +3.4 pts");
    expect(tickText(5, "px")).toBe("+5");
  });
  it("no unit, or no finite value, spells nothing; zero is 0", () => {
    expect(moveText(0.031, undefined)).toBeNull();
    expect(moveText(0.031, "percent" as never)).toBeNull();
    expect(moveText(null, "pct")).toBeNull();
    expect(rangeText(null, 1, "bp")).toBeNull();
    expect(isUnit("bp")).toBe(true);
    expect(isUnit("log_return")).toBe(false);
    expect(tickText(0, "bp")).toBe("0");
  });
});
