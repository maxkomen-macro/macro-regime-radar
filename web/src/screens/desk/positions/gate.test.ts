import { describe, expect, it } from "vitest";
import { BANNED_WORDS, EMPTY_DRAFT, applyRewrite, findFlags, gateStatus, parseLevel, type Draft } from "./gate";

const GOOD: Draft = {
  ...EMPTY_DRAFT,
  instrument: "TLT",
  size: "2% of NAV",
  variant_view: "The market prices three cuts; the data supports one, so duration is likely to cheapen.",
  pre_mortem: "Growth cracked faster than the prints showed and the curve bull-steepened through my level.",
  falsification_series: "DGS10",
  falsification_level: "3.80",
  falsification_direction: "below",
};

describe("language check", () => {
  it("flags every banned word once, case-insensitively, at word boundaries", () => {
    const flags = findFlags("Goodwill Will never fail; this proves it.", "variant_view");
    expect(flags.map((f) => f.word)).toEqual(["Will", "never", "proves"]);
    expect(flags[0].index).toBe(9);
    expect(flags.every((f) => f.field === "variant_view")).toBe(true);
  });
  it("offers a calibrated rewrite for each of the eight words and applies it in place", () => {
    for (const w of BANNED_WORDS) {
      const text = `It ${w} rain.`;
      const [flag] = findFlags(text, "pre_mortem");
      expect(flag, w).toBeTruthy();
      const out = applyRewrite(text, flag);
      expect(out).not.toMatch(new RegExp(`\\b${w}\\b`, "i"));
      expect(findFlags(out, "pre_mortem")).toEqual([]);
    }
  });
  it("leaves the text alone when the flag no longer matches its position", () => {
    const stale = { field: "variant_view" as const, word: "will", index: 40, suggestion: "is likely to" };
    expect(applyRewrite("short", stale)).toBe("short");
  });
});

describe("discipline gate", () => {
  it("is open on the empty draft and names every missing gate", () => {
    const g = gateStatus(EMPTY_DRAFT);
    expect(g.ok).toBe(false);
    expect([g.variant, g.premortem, g.falsification]).toEqual(["open", "open", "open"]);
    expect(g.reason).toMatch(/name the instrument/);
    expect(g.reason).toMatch(/variant view/);
    expect(g.reason).toMatch(/pre-mortem/);
    expect(g.reason).toMatch(/falsification/);
  });
  it("passes only when the three gates and the instrument are set and no word is flagged", () => {
    const g = gateStatus(GOOD);
    expect(g.ok).toBe(true);
    expect([g.variant, g.premortem, g.falsification]).toEqual(["met", "met", "met"]);
    expect(g.level).toBe(3.8);
    expect(g.reason).toBe("");
  });
  it("a flagged word holds the seal dashed and blocks the save", () => {
    const g = gateStatus({ ...GOOD, variant_view: "This trade will definitely work." });
    expect(g.ok).toBe(false);
    expect(g.variant).toBe("flagged");
    expect(g.flags.map((f) => f.word)).toEqual(["will", "definitely"]);
    expect(g.reason).toMatch(/2 flagged words/);
  });
  it("a non-numeric level, or a level without a series, keeps falsification open", () => {
    expect(gateStatus({ ...GOOD, falsification_level: "about 3.8" }).falsification).toBe("open");
    expect(gateStatus({ ...GOOD, falsification_series: "" }).falsification).toBe("open");
    expect(parseLevel("1,250.5")).toBe(1250.5);
    expect(parseLevel("")).toBeNull();
  });
});
