/**
 * fix/site-audit D6: one vocabulary for the recession model's vintage. On Oct 7
 * the Recession page's stamp read "Recession model · Oct 2026" (`data_as_of`,
 * the newest raw input row, which the score does not read), its body "Scored
 * for Sep 2026" and the Desk "based on Jun 2026 data", all for one score.
 */
import { describe, expect, it } from "vitest";
import { recessionVintage } from "./recession-vintage";

/** /api/recession/probability on 2026-10-07. */
const LIVE = { probability_month: "2026-09", inputs_through: "2026-06", data_as_of: "2026-10-31" };

describe("recessionVintage (D6: the scored month plus the input month)", () => {
  it("names the scored month and the input month, never data_as_of", () => {
    expect(recessionVintage(LIVE)).toBe("Scored for Sep 2026 · inputs from Jun 2026");
    expect(recessionVintage(LIVE)).not.toContain("Oct");
  });

  it("reads inside a sentence and keeps a month with its year on one line when asked", () => {
    expect(recessionVintage(LIVE, { lower: true })).toBe("scored for Sep 2026 · inputs from Jun 2026");
    expect(recessionVintage(LIVE, { lower: true, nbsp: true })).toBe("scored for Sep 2026 · inputs from Jun 2026");
  });

  it("accepts a dated month and prints only what is served", () => {
    expect(recessionVintage({ probability_month: "2026-09-30" })).toBe("Scored for Sep 2026");
    expect(recessionVintage({ inputs_through: "2026-06" })).toBe("Inputs from Jun 2026");
    expect(recessionVintage({})).toBeNull();
    expect(recessionVintage(null)).toBeNull();
    expect(recessionVintage({ probability_month: "soon", inputs_through: null })).toBeNull();
  });
});
