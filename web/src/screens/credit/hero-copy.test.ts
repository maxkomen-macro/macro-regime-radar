/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) sections C.1
 * and E.1, `screens/credit/hero-copy.test.ts`: the pure `creditHero()` and
 * `ladderStrip()` contracts. Rules 1 to 8 with the tercile boundaries (33 /
 * 34 / 67 / 68), the null guards on every clause, the Tight lede sentence,
 * the pill tone and glow per state, the footnote items and the B.2 strip
 * table (diverging, tension, past, clear, loading, error). Fixtures are
 * invented spreads dated Sep 2026; the assertions are the copy rules, never
 * the mockup's or the baseline's figures.
 */
import { describe, expect, it } from "vitest";
import { creditHero, ladderFlags, ladderStrip } from "./hero-copy";
import { ladderFlags as rulesLadderFlags } from "./credit-rules";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { fmtBps, ordinal } from "../../lib/format";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LAST = "2026-09-01";

/** `n` monthly ISO dates ending at `last`, oldest first. */
function months(n: number, last = LAST): string[] {
  const [y, m] = last.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`);
  }
  return out;
}
const series = (dates: string[], base: number, step: number): DatedValue[] => dates.map((date, i) => ({ date, value: base + i * step }));

const STATES = ["Normal", "Tight", "Stressed", "Crisis"] as const;
const row = (n: number, t: number, s: number, c: number) => ({ Normal: n, Tight: t, Stressed: s, Crisis: c });
const T3: Record<string, Record<string, number>> = {
  Normal: row(0.8123, 0, 0.1544, 0.0333),
  Tight: row(0, 0, 0, 0),
  Stressed: row(0.2917, 0, 0.5833, 0.125),
  Crisis: row(0.04, 0, 0.36, 0.6),
};
const T6: Record<string, Record<string, number>> = {
  Normal: row(0.7211, 0, 0.2277, 0.0512),
  Tight: row(0, 0, 0, 0),
  Stressed: row(0.4583, 0, 0.375, 0.1667),
  Crisis: row(0.12, 0, 0.44, 0.44),
};

/** Normal, CCC widening more than BB and B, distress past the line (the diverging + tension default). */
function metrics(over: Partial<CreditMetrics> = {}): CreditMetrics {
  const dates = months(36);
  const six = months(6);
  return {
    hy_oas: 312,
    ig_oas: 94,
    ccc_oas: 1042,
    bb_oas: 188,
    b_oas: 297,
    hy_1w_change: 6,
    ig_1w_change: 1,
    ccc_1w_change: 29,
    bb_1w_change: -3,
    b_1w_change: 2,
    hy_ig_ratio: 3.32,
    distress_ratio: 104.2,
    lbo_all_in_cost: "7.04%",
    credit_label: "Normal",
    credit_label_color: "#28d17c",
    hy_pct_rank: 12,
    ig_pct_rank: 18,
    hy_series: series(dates, 380, -2),
    ig_series: series(dates, 120, -0.75),
    data_as_of: "Sep 01, 2026",
    transition_3m: T3,
    transition_6m: T6,
    tight_count: 0,
    hy_sparkline: series(six, 300, 2.4),
    ig_sparkline: series(six, 90, 0.8),
    ccc_sparkline: series(six, 900, 28),
    bb_sparkline: series(six, 200, -2.4),
    b_sparkline: series(six, 290, 1.4),
    ...over,
  };
}

/** Normal with nothing widening and the distress ratio well under the line. */
const IN_STEP: Partial<CreditMetrics> = { ccc_oas: 580, ccc_1w_change: -4, bb_1w_change: -1, b_1w_change: -2, distress_ratio: 58 };
/** Normal, CCC up but by less than BB and B, distress at 91%: tension without divergence. */
const TENSION: Partial<CreditMetrics> = { ccc_oas: 910, ccc_1w_change: 10, bb_1w_change: 12, b_1w_change: 15, distress_ratio: 91 };
/** Past the 400 rule; no rung diverging; distress high but the label is not Normal or Tight. */
const STRESSED: Partial<CreditMetrics> = { credit_label: "Stressed", hy_oas: 486, ccc_oas: 950, ccc_1w_change: 3, bb_1w_change: 5, b_1w_change: 8, distress_ratio: 95, hy_pct_rank: 74 };
const CRISIS: Partial<CreditMetrics> = { ...STRESSED, credit_label: "Crisis", hy_oas: 812, hy_pct_rank: 96 };
const TIGHT: Partial<CreditMetrics> = { credit_label: "Tight", hy_oas: 372, ig_oas: 160, tight_count: 3, hy_pct_rank: 41, ...IN_STEP };

const TERCILE = {
  tight: "Lenders are pricing almost no default stress: spreads this tight leave little cushion, so the risk is asymmetric to widening, not to further tightening.",
  mid: "Spreads sit mid-range by history: neither stress nor complacency, so credit is not the deciding input for the regime call right now.",
  wide: "Lenders are charging real default risk: wide spreads are the credit market's own recession vote and feed the recession model directly.",
};
const LADDER_SENTENCE = "CCC moved +29 bps in the month, BB -3 bps and B +2 bps.";
const TIGHT_SENTENCE = "Tight here means IG above 150 bps with high yield still at or under 400 bps.";
const GLOW_AMBER = "rgba(245,181,46,.05)";
const GLOW_RED = "rgba(240,80,63,.06)";

const strings = (c: ReturnType<typeof creditHero>): string[] => [c.headline, c.pill, c.subhead, c.ledeText, c.glow, ...c.footnote].filter((s): s is string => typeof s === "string");

/* ── creditHero ──────────────────────────────────────────────────────────── */

describe("creditHero (checklist 06 C.1)", () => {
  it("rule 1: the headline is the served label alone and the pill is HY OAS {n} bps, rounded", () => {
    const c = creditHero(metrics());
    expect(c.headline).toBe("Normal");
    expect(c.pill).toBe("HY OAS 312 bps");
    expect(c.pill).toMatch(/^HY OAS \d+ bps$/);
    expect(creditHero(metrics({ hy_oas: 312.4 })).pill).toBe("HY OAS 312 bps");
    expect(creditHero(metrics({ hy_oas: 311.6 })).pill).toBe("HY OAS 312 bps");
    for (const label of STATES) expect(creditHero(metrics({ credit_label: label })).headline).toBe(label);
  });

  it("rule 1: no served hy_oas omits the pill", () => {
    const c = creditHero(metrics({ hy_oas: null }));
    expect(c.pill).toBeNull();
    expect(c.headline).toBe("Normal");
  });

  it("rule 2: the subhead names both spreads and the percentile since 1996, with the ordinal from format.ts", () => {
    const c = creditHero(metrics());
    expect(c.subhead).toBe("High yield at 312 bps, the 12th percentile since 1996, with investment grade at 94 bps.");
    expect(c.subhead.startsWith("High yield at")).toBe(true);
    expect(creditHero(metrics({ hy_pct_rank: 3 })).subhead).toContain(`the ${ordinal(3)} percentile since 1996`);
    expect(creditHero(metrics({ hy_pct_rank: 22 })).subhead).toContain("the 22nd percentile since 1996");
    expect(creditHero(metrics({ hy_pct_rank: 11 })).subhead).toContain("the 11th percentile since 1996");
  });

  it("rule 2: no hy_pct_rank drops the percentile clause; no ig_oas drops the investment-grade clause", () => {
    const noRank = creditHero(metrics({ hy_pct_rank: null })).subhead;
    expect(noRank).toMatch(/^High yield at 312 bps,? with investment grade at 94 bps\.$/);
    expect(noRank).not.toContain("percentile");
    const noIg = creditHero(metrics({ ig_oas: null })).subhead;
    expect(noIg).toBe("High yield at 312 bps, the 12th percentile since 1996.");
    expect(noIg).not.toContain("investment grade");
    const neither = creditHero(metrics({ hy_pct_rank: null, ig_oas: null })).subhead;
    expect(neither).toBe("High yield at 312 bps.");
  });

  it("rule 2: no hy_oas gives the stored-levels sentence, never an empty h2", () => {
    for (const over of [{ hy_oas: null }, { hy_oas: null, ig_oas: null, hy_pct_rank: null }]) {
      const c = creditHero(metrics(over));
      expect(c.subhead).toBe("Spread levels are not stored for this month.");
    }
  });

  it.each<[rank: number, key: keyof typeof TERCILE]>([
    [0, "tight"],
    [33, "tight"],
    [34, "mid"],
    [50, "mid"],
    [67, "mid"],
    [68, "wide"],
    [100, "wide"],
  ])("rule 3: hy_pct_rank %i opens the lede with the %s tercile sentence, verbatim", (rank, key) => {
    const c = creditHero(metrics({ hy_pct_rank: rank }));
    expect(c.ledeText.startsWith(TERCILE[key])).toBe(true);
    expect(c.ledeText).toBe(`${TERCILE[key]} ${LADDER_SENTENCE}`);
  });

  it("rule 3: no hy_pct_rank omits the tercile sentence, so the lede opens with the ladder sentence", () => {
    const c = creditHero(metrics({ hy_pct_rank: null }));
    expect(c.ledeText).toBe(LADDER_SENTENCE);
    for (const s of Object.values(TERCILE)) expect(c.ledeText).not.toContain(s);
  });

  it("rule 4: the ladder sentence prints the three month-over-month changes with fmtBps and adds no interpretation", () => {
    const c = creditHero(metrics());
    expect(c.ledeText).toContain(LADDER_SENTENCE);
    expect(c.ledeText).toContain(`CCC moved ${fmtBps(29)} in the month, BB ${fmtBps(-3)} and B ${fmtBps(2)}.`);
    // No interpretation after the ladder figures: the tension callout (B.5) carries it.
    const afterTercile = c.ledeText.slice(TERCILE.tight.length);
    expect(afterTercile).toBe(` ${LADDER_SENTENCE}`);
    expect(afterTercile).not.toMatch(/tension|watch|diverg/i);
    const rounded = creditHero(metrics({ ccc_1w_change: 28.6, bb_1w_change: -2.6, b_1w_change: 1.5 }));
    expect(rounded.ledeText).toContain("CCC moved +29 bps in the month, BB -3 bps and B +2 bps.");
  });

  it("rule 4: null rungs drop out of the ladder sentence and it vanishes when all three are null", () => {
    const noBb = creditHero(metrics({ bb_1w_change: null })).ledeText;
    expect(noBb).toContain("CCC moved +29 bps");
    expect(noBb).toMatch(/\bB \+2 bps/);
    expect(noBb).not.toMatch(/\bBB\b/);
    const noB = creditHero(metrics({ b_1w_change: null })).ledeText;
    expect(noB).toContain("CCC moved +29 bps");
    expect(noB).toContain("BB -3 bps");
    expect(noB).not.toMatch(/\bB [+-]\d+ bps/);
    const noCcc = creditHero(metrics({ ccc_1w_change: null })).ledeText;
    expect(noCcc).not.toContain("CCC");
    expect(noCcc).toContain("BB -3 bps");
    expect(noCcc).toMatch(/\bB \+2 bps/);
    const none = creditHero(metrics({ ccc_1w_change: null, bb_1w_change: null, b_1w_change: null }));
    expect(none.ledeText).toBe(TERCILE.tight);
    expect(none.ledeText).not.toContain("in the month");
    for (const text of [noBb, noB, noCcc, none.ledeText]) {
      expect(text).not.toContain("null");
      expect(text).not.toContain("NaN");
      expect(text.trim().endsWith(".")).toBe(true);
    }
  });

  it("rule 6: the Tight lede sentence follows the ladder sentence only when the label is Tight, and the lede then carries the Jargon node", () => {
    const tight = creditHero(metrics(TIGHT));
    expect(tight.ledeText).toContain(TIGHT_SENTENCE);
    expect(tight.ledeText).toBe(`${TERCILE.mid} CCC moved -4 bps in the month, BB -1 bps and B -2 bps. ${TIGHT_SENTENCE}`);
    expect(typeof tight.lede).not.toBe("string");
    expect(tight.lede).not.toBeNull();
    for (const label of ["Normal", "Stressed", "Crisis"]) {
      const c = creditHero(metrics({ credit_label: label }));
      expect(c.ledeText).not.toContain("Tight here means");
      expect(typeof c.lede).toBe("string");
      expect(c.lede).toBe(c.ledeText);
    }
  });

  it.each<[label: string, tone: "mint" | "amber", glow: string]>([
    ["Normal", "mint", GLOW_AMBER],
    ["Tight", "amber", GLOW_AMBER],
    ["Stressed", "amber", GLOW_AMBER],
    ["Crisis", "amber", GLOW_RED],
  ])("rule 7: %s reads the %s pill with the glow %s", (label, tone, glow) => {
    const c = creditHero(metrics({ credit_label: label }));
    expect(c.pillTone).toBe(tone);
    expect(c.glow).toBe(glow);
  });

  it("rule 5: the footnote names the monthly stamp and the classification month; a null data_as_of drops the first item", () => {
    const c = creditHero(metrics());
    expect(c.footnote).toEqual(["Monthly spreads through Sep 01, 2026", "Classification Normal for Sep 2026"]);
    const undated = creditHero(metrics({ data_as_of: null }));
    expect(undated.footnote).toEqual(["Classification Normal for Sep 2026"]);
    const stressed = creditHero(metrics(STRESSED));
    expect(stressed.footnote[1]).toBe("Classification Stressed for Sep 2026");
    // The month is the last served hy_series point, not the wall clock.
    const older = creditHero(metrics({ hy_series: series(months(36, "2026-07-01"), 380, -2) }));
    expect(older.footnote[1]).toBe("Classification Normal for Jul 2026");
  });

  it("returns the full contract: headline, pill, pillTone, glow, subhead, lede, ledeText, footnote", () => {
    const c = creditHero(metrics());
    expect(c).toEqual(
      expect.objectContaining({
        headline: "Normal",
        pill: "HY OAS 312 bps",
        pillTone: "mint",
        glow: GLOW_AMBER,
        subhead: expect.any(String),
        ledeText: expect.any(String),
        footnote: expect.any(Array),
      }),
    );
    expect(c.lede).not.toBeNull();
    expect(c.lede).not.toBeUndefined();
  });

  it("no output contains an em-dash, the word null, or repeats the tab name; it is pure and never mutates the input", () => {
    for (const over of [{}, IN_STEP, TENSION, STRESSED, CRISIS, TIGHT, { hy_oas: null, ig_oas: null, hy_pct_rank: null, ccc_1w_change: null, bb_1w_change: null, b_1w_change: null, data_as_of: null }]) {
      const input = metrics(over);
      const before = JSON.stringify(input);
      const a = creditHero(input);
      const b = creditHero(input);
      expect(JSON.stringify(input)).toBe(before);
      expect(a.ledeText).toBe(b.ledeText);
      expect(a.subhead).toBe(b.subhead);
      expect(a.footnote).toEqual(b.footnote);
      for (const s of strings(a)) {
        expect(s).not.toContain("—");
        expect(s).not.toContain("null");
        expect(s).not.toContain("undefined");
        expect(s).not.toMatch(/\bCredit tab\b/);
      }
    }
  });
});

/* ── ladderFlags ─────────────────────────────────────────────────────────── */

describe("ladderFlags (checklist 06 B.2 booleans, credit-rules.ts)", () => {
  it("hero-copy re-exports the one ladderFlags from credit-rules", () => {
    expect(ladderFlags).toBe(rulesLadderFlags);
  });

  it("diverges only when CCC widened by more than both BB and B; a null rung counts as zero", () => {
    expect(rulesLadderFlags(metrics())).toEqual({ cccUp: true, diverges: true, tension: true, past: false });
    expect(rulesLadderFlags(metrics(IN_STEP))).toEqual({ cccUp: false, diverges: false, tension: false, past: false });
    expect(rulesLadderFlags(metrics(TENSION))).toEqual({ cccUp: true, diverges: false, tension: true, past: false });
    expect(rulesLadderFlags(metrics({ bb_1w_change: null, b_1w_change: null })).diverges).toBe(true);
    expect(rulesLadderFlags(metrics({ ccc_1w_change: null })).cccUp).toBe(false);
    expect(rulesLadderFlags(metrics({ ccc_1w_change: null })).diverges).toBe(false);
    // Equal moves are not "more than".
    expect(rulesLadderFlags(metrics({ ccc_1w_change: 29, bb_1w_change: 29, b_1w_change: 2 })).diverges).toBe(false);
    expect(rulesLadderFlags(metrics({ ccc_1w_change: 0 })).cccUp).toBe(false);
  });

  it("tension needs distress at 80 or more with a Normal or Tight label; past is Stressed or Crisis", () => {
    expect(rulesLadderFlags(metrics({ ...IN_STEP, distress_ratio: 80 })).tension).toBe(true);
    expect(rulesLadderFlags(metrics({ ...IN_STEP, distress_ratio: 79.9 })).tension).toBe(false);
    expect(rulesLadderFlags(metrics({ ...TIGHT, distress_ratio: 85 })).tension).toBe(true);
    expect(rulesLadderFlags(metrics({ ...IN_STEP, distress_ratio: null })).tension).toBe(false);
    expect(rulesLadderFlags(metrics(STRESSED))).toEqual({ cccUp: true, diverges: false, tension: false, past: true });
    expect(rulesLadderFlags(metrics(CRISIS))).toEqual({ cccUp: true, diverges: false, tension: false, past: true });
    expect(rulesLadderFlags(metrics(TIGHT)).past).toBe(false);
  });
});

/* ── ladderStrip ─────────────────────────────────────────────────────────── */

describe("ladderStrip (checklist 06 B.2 strip table)", () => {
  it("diverging: amber Watch · CCC widening with the three fmtBps clauses", () => {
    const s = ladderStrip(metrics(), "ready");
    expect(s.tone).toBe("amber");
    expect(s.title).toBe("Watch · CCC widening");
    expect(s.detail).toBe("+29 bps in a month · BB -3 bps · B +2 bps");
  });

  it("diverging outranks tension and past: a Crisis fixture with CCC widening most still reads Watch · CCC widening", () => {
    const s = ladderStrip(metrics({ ...CRISIS, ccc_1w_change: 40, bb_1w_change: 5, b_1w_change: 8 }), "ready");
    expect(s.title).toBe("Watch · CCC widening");
    expect(s.tone).toBe("amber");
    expect(s.detail).toBe("+40 bps in a month · BB +5 bps · B +8 bps");
  });

  it("the diverging detail drops null clauses", () => {
    expect(ladderStrip(metrics({ bb_1w_change: null }), "ready").detail).toBe("+29 bps in a month · B +2 bps");
    expect(ladderStrip(metrics({ b_1w_change: null }), "ready").detail).toBe("+29 bps in a month · BB -3 bps");
    expect(ladderStrip(metrics({ bb_1w_change: null, b_1w_change: null }), "ready").detail).toBe("+29 bps in a month");
  });

  it("tension without divergence: amber Watch · CCC at {x}% of the distress line, the weakest-rung detail naming the label", () => {
    const s = ladderStrip(metrics(TENSION), "ready");
    expect(s.tone).toBe("amber");
    expect(s.title).toMatch(/^Watch · CCC at 91(?:\.0)?% of the distress line$/);
    expect(s.detail).toBe("The weakest rung prices stress while the index reads Normal");
    const tight = ladderStrip(metrics({ ...TIGHT, ccc_oas: 880, ccc_1w_change: 10, bb_1w_change: 12, b_1w_change: 15, distress_ratio: 88 }), "ready");
    expect(tight.title).toMatch(/^Watch · CCC at 88(?:\.0)?% of the distress line$/);
    expect(tight.detail).toBe("The weakest rung prices stress while the index reads Tight");
  });

  it("past the rules: amber {label} · HY {n} bps naming the 400 rule for Stressed and the 700 rule for Crisis", () => {
    const stressed = ladderStrip(metrics(STRESSED), "ready");
    expect(stressed.tone).toBe("amber");
    expect(stressed.title).toBe("Stressed · HY 486 bps");
    expect(stressed.detail).toBe("The index is past the 400 bps rule; the ladder tiles show the rungs");
    const crisis = ladderStrip(metrics(CRISIS), "ready");
    expect(crisis.tone).toBe("amber");
    expect(crisis.title).toBe("Crisis · HY 812 bps");
    expect(crisis.detail).toBe("The index is past the 700 bps rule; the ladder tiles show the rungs");
  });

  it("nothing flagged: mint Clear · ladder in step with the CCC move and the distress share", () => {
    const s = ladderStrip(metrics(IN_STEP), "ready");
    expect(s.tone).toBe("mint");
    expect(s.title).toBe("Clear · ladder in step");
    expect(s.detail).toMatch(/^CCC -4 bps in a month · distress 58(?:\.0)?% of the 1,000 bps line$/);
    const tight = ladderStrip(metrics(TIGHT), "ready");
    expect(tight.tone).toBe("mint");
    expect(tight.title).toBe("Clear · ladder in step");
  });

  it("the clear detail drops null clauses and never prints null", () => {
    const noCcc = ladderStrip(metrics({ ...IN_STEP, ccc_1w_change: null }), "ready");
    expect(noCcc.title).toBe("Clear · ladder in step");
    expect(noCcc.detail).toMatch(/^distress 58(?:\.0)?% of the 1,000 bps line$/);
    const noDistress = ladderStrip(metrics({ ...IN_STEP, distress_ratio: null }), "ready");
    expect(noDistress.title).toBe("Clear · ladder in step");
    expect(noDistress.detail).toBe("CCC -4 bps in a month");
    const neither = ladderStrip(metrics({ ...IN_STEP, ccc_1w_change: null, distress_ratio: null }), "ready");
    expect(neither.title).toBe("Clear · ladder in step");
    expect(neither.detail).not.toContain("null");
    expect(neither.detail).not.toMatch(/^\s*·|·\s*$/);
  });

  it("loading reads gray Reading the ladder… and error gray Ladder unavailable, with or without metrics", () => {
    expect(ladderStrip(null, "loading")).toEqual({ tone: "gray", title: "Reading the ladder…", detail: "Opens the quality ladder" });
    expect(ladderStrip(null, "error")).toEqual({ tone: "gray", title: "Ladder unavailable", detail: "The data service did not answer" });
    expect(ladderStrip(metrics(), "loading").tone).toBe("gray");
    expect(ladderStrip(metrics(), "error").title).toBe("Ladder unavailable");
  });

  it("every strip string is free of em-dashes and the word null", () => {
    for (const over of [{}, IN_STEP, TENSION, STRESSED, CRISIS, TIGHT, { bb_1w_change: null, b_1w_change: null }, { ...IN_STEP, ccc_1w_change: null, distress_ratio: null }]) {
      const s = ladderStrip(metrics(over), "ready");
      for (const text of [s.title, s.detail]) {
        expect(text).not.toContain("—");
        expect(text).not.toContain("null");
        expect(text).not.toContain("NaN");
      }
      expect(["mint", "amber"]).toContain(s.tone);
    }
  });
});
