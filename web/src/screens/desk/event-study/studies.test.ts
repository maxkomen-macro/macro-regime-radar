import { describe, expect, it } from "vitest";
import { PRESET, PRESET_SLUG, paramsFor, slugFor } from "./studies";

describe("study slugs", () => {
  it("names the preset with the spec's stable slug and reads it back", () => {
    expect(slugFor(PRESET)).toBe(PRESET_SLUG);
    expect(paramsFor(PRESET_SLUG)).toEqual(PRESET);
  });
  it("round-trips a custom query", () => {
    const p = { shock: "vix", w: 5, z: 2.5, sign: "-" as const, cond: "none", regime: "recession_risk", target: "dgs10" };
    const slug = slugFor(p);
    expect(slug).toBe("vix-5d-2p5s-down-none-recession_risk-dgs10");
    expect(paramsFor(slug)).toEqual(p);
  });
  it("rejects garbage", () => {
    expect(paramsFor("gold-2sigma")).toBeNull();
    expect(paramsFor("")).toBeNull();
    expect(paramsFor(null)).toBeNull();
  });
});
