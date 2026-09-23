import { describe, expect, it } from "vitest";
import type { EventStudyParams } from "../../../api/desk";
import slugs from "./__fixtures__/slugs.json";
import { PRESET, PRESET_SLUG, PRESETS, numSlug, paramsFor, slugFor } from "./studies";

/** The engine's query (as the fixture writes it) in the page's terms. */
type EngineQuery = (typeof slugs.cases)[number]["query"];
const REGIME_ID: Record<string, string> = { Goldilocks: "goldilocks", Overheating: "overheating", Stagflation: "stagflation", "Recession Risk": "recession_risk" };

function pageParams(q: EngineQuery): EventStudyParams {
  const regime = q.regime === "all" ? "all" : REGIME_ID[q.regime];
  if (q.kind === "cross") return { kind: "cross", cross: q.cross as "golden" | "death", shock: "spx", w: 20, z: 2, sign: "+", cond: "none", regime, target: q.target };
  const cond = q.cond == null ? "none" : q.cond_value == null ? q.cond : `${q.cond}=${q.cond === "regime" ? REGIME_ID[String(q.cond_value)] : numSlug(Number(q.cond_value))}`;
  return { kind: "shock", cross: null, shock: q.shock, w: q.w, z: q.z, sign: q.sign as EventStudyParams["sign"], cond, regime, target: q.target };
}

describe("study slugs are the engine's (desk/integration)", () => {
  it("writes every fixture study's slug exactly as the engine does", () => {
    expect(slugs.cases.length).toBeGreaterThanOrEqual(10);
    for (const c of slugs.cases) expect(slugFor(pageParams(c.query)), c.slug).toBe(c.slug);
  });

  it("reads every fixture slug back into the same study", () => {
    for (const c of slugs.cases) {
      expect(paramsFor(c.slug), c.slug).toEqual(pageParams(c.query));
      expect(slugFor(paramsFor(c.slug)!), c.slug).toBe(c.slug);
    }
  });

  it("names the three presets by their stable slugs", () => {
    expect(slugFor(PRESET)).toBe(PRESET_SLUG);
    expect(Object.keys(PRESETS)).toEqual(["gold-2sigma-spx-weak", "spx-golden-cross", "spx-death-cross"]);
    for (const [slug, p] of Object.entries(PRESETS)) expect(slugFor(p)).toBe(slug);
  });

  it("writes numbers as Python's repr writes the builder's values", () => {
    expect([1.5, 2, 2.5, 20, 25, 1_000_000].map(numSlug)).toEqual(["1.5", "2.0", "2.5", "20.0", "25.0", "1000000.0"]);
  });

  it("rejects what the engine rejects as an address", () => {
    expect(paramsFor("gold-2sigma")).toBeNull();
    expect(paramsFor("gold-20d-2p0s-up-none-all-spx")).toBeNull(); // the frame's provisional grammar
    expect(paramsFor("")).toBeNull();
    expect(paramsFor(null)).toBeNull();
  });
});
