/**
 * Phase 5 checklist (docs/redesign-v2/checklists/05-markets.md) section C.1 and
 * E.1, `screens/markets/hero-copy.test.ts`: the pure `marketsHero()` contract.
 * Rules 1 to 6 with the boundary table (4/4, 3/4, 2/4, 1/4, 0/4, 3/3, 2/3,
 * 1/2), null rets excluded from `n`, the basis sentence naming the date or
 * "the latest stored close", and no output containing the tab name or a
 * percent sign. Fixtures are invented one-day moves dated Sep 2026; the
 * assertions are the rules, never the mockup's or the baseline's figures.
 */
import { describe, expect, it } from "vitest";
import { marketsHero, type HeroTone, type MarketsHeroCopy } from "./hero-copy";
import { SECTORS } from "./tape";
import { fmtDate } from "../../lib/format";

const DATE = "2026-09-18";
const GLOW: Record<HeroTone, string> = {
  mint: "rgba(40,209,124,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
};
const BASIS_HEAD = "Headline and pill read the one-day moves of the four stored sector ETFs at the ";
const BASIS_TAIL = " close; the session sentence is the live tape.";

/** The four SECTORS (XLF, XLE, XLI, XLK) with the given one-day moves, in registry order. */
function sectors(rets: (number | null)[]) {
  return SECTORS.map((s, i) => ({ symbol: s.symbol, name: s.name, ret: rets[i] ?? null }));
}

/** `up` positive moves then `n - up` negative ones, spread over the registry (null-padded past n). */
function mix(up: number, n: number) {
  const rets: (number | null)[] = [];
  for (let i = 0; i < 4; i++) {
    if (i >= n) rets.push(null);
    else rets.push(i < up ? 0.35 + i * 0.4 : -(0.25 + i * 0.3));
  }
  return sectors(rets);
}

const strings = (c: MarketsHeroCopy): string[] => [c.headline, c.pill, c.basis, c.glow].filter((s): s is string => typeof s === "string");

describe("marketsHero (checklist 05 C.1)", () => {
  it("rule 1: no served one-day move yields null headline, null pill, gray tone, gray glow and null basis", () => {
    for (const input of [sectors([null, null, null, null]), []]) {
      const c = marketsHero(input, DATE);
      expect(c.headline).toBeNull();
      expect(c.pill).toBeNull();
      expect(c.pillTone).toBe("gray");
      expect(c.glow).toBe(GLOW.gray);
      expect(c.basis).toBeNull();
    }
    expect(marketsHero(sectors([null, null, null, null]), null).headline).toBeNull();
  });

  it.each<[up: number, n: number, headline: string, tone: HeroTone]>([
    [4, 4, "Risk-on", "mint"],
    [3, 4, "Risk-on", "mint"],
    [2, 4, "Mixed", "gray"],
    [1, 4, "Risk-off", "amber"],
    [0, 4, "Risk-off", "amber"],
    [3, 3, "Risk-on", "mint"],
    [2, 3, "Mixed", "gray"], // 0.67: under the .75 rung
    [1, 3, "Mixed", "gray"], // 0.33: over the .25 rung
    [1, 2, "Mixed", "gray"],
    [2, 2, "Risk-on", "mint"],
    [0, 2, "Risk-off", "amber"],
    [1, 1, "Risk-on", "mint"],
    [0, 1, "Risk-off", "amber"],
  ])("rules 2 to 5: %i of %i up reads %s with the %s pill", (up, n, headline, tone) => {
    const c = marketsHero(mix(up, n), DATE);
    expect(c.headline).toBe(headline);
    expect(c.pillTone).toBe(tone);
    expect(c.glow).toBe(GLOW[tone]);
    expect(c.pill).toBe(`${up} of ${n} sectors up`);
    expect(c.pill).toMatch(/^\d of \d sectors up$/);
    expect(c.basis).toBe(`${BASIS_HEAD}${fmtDate(DATE)}${BASIS_TAIL}`);
  });

  it("the rungs are inclusive: exactly .75 is Risk-on and exactly .25 is Risk-off", () => {
    expect(marketsHero(mix(3, 4), DATE).headline).toBe("Risk-on");
    expect(marketsHero(mix(1, 4), DATE).headline).toBe("Risk-off");
  });

  it("a flat move (ret === 0) is not up", () => {
    const c = marketsHero(sectors([0, 0, 0, 0]), DATE);
    expect(c.headline).toBe("Risk-off");
    expect(c.pill).toBe("0 of 4 sectors up");
    const one = marketsHero(sectors([0.01, 0, 0, 0]), DATE);
    expect(one.pill).toBe("1 of 4 sectors up");
  });

  it("null rets are excluded from n, so the pill counts served moves only", () => {
    const two = marketsHero(sectors([1.2, null, -0.3, null]), DATE);
    expect(two.pill).toBe("1 of 2 sectors up");
    expect(two.headline).toBe("Mixed");
    const one = marketsHero(sectors([null, null, null, 0.5]), DATE);
    expect(one.pill).toBe("1 of 1 sectors up");
    expect(one.headline).toBe("Risk-on");
    const three = marketsHero(sectors([-0.4, -0.9, null, -1.3]), DATE);
    expect(three.pill).toBe("0 of 3 sectors up");
    expect(three.headline).toBe("Risk-off");
  });

  it("the basis names the stored close date, or the latest stored close when no date is served", () => {
    const dated = marketsHero(mix(2, 4), "2026-09-14");
    expect(dated.basis).toBe(`${BASIS_HEAD}Sep 14, 2026${BASIS_TAIL}`);
    expect(dated.basis).toContain("at the Sep 14, 2026 close;");
    const undated = marketsHero(mix(2, 4), null);
    expect(undated.basis).toBe(`${BASIS_HEAD}latest stored close; the session sentence is the live tape.`);
    expect(undated.basis).toContain("at the latest stored close;");
    expect(undated.headline).toBe("Mixed");
    expect(undated.pill).toBe("2 of 4 sectors up");
  });

  it("rule 6: no output repeats the tab name, prints a percent sign or a probability", () => {
    const inputs = [mix(4, 4), mix(3, 4), mix(2, 4), mix(1, 4), mix(0, 4), mix(2, 3), mix(1, 2), sectors([1.2, null, -0.3, null])];
    for (const input of inputs) {
      for (const date of [DATE, null]) {
        const c = marketsHero(input, date);
        for (const s of strings(c)) {
          expect(s).not.toMatch(/Markets/);
          expect(s).not.toContain("%");
          expect(s).not.toContain("\u2014");
        }
        if (c.headline) expect(["Risk-on", "Mixed", "Risk-off"]).toContain(c.headline);
      }
    }
  });

  it("is pure: the same input gives the same output and the input is never mutated", () => {
    const input = sectors([0.42, -2.14, -0.15, 1.23]);
    const before = JSON.stringify(input);
    const a = marketsHero(input, DATE);
    const b = marketsHero(input, DATE);
    expect(a).toEqual(b);
    expect(JSON.stringify(input)).toBe(before);
    expect(Object.keys(a).sort()).toEqual(["basis", "glow", "headline", "pill", "pillTone"]);
  });
});
