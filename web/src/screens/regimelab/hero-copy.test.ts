/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) C.1 and
 * E.1, `screens/regimelab/hero-copy.test.ts`: the pure hero and status-strip
 * copy contracts. `cycleHero(duration, regime)` returns `{ headline, pill,
 * pillTone, glow, subhead }` from the served cycle status; `stripSummary(rows,
 * state)` returns `{ tone, title, detail }` from the classifier's own stored
 * monthly Overheating odds (the B.2 table). Fixtures are dated Sep 2026 with
 * invented numbers; the assertions are the copy rules.
 */
import { describe, expect, it } from "vitest";
import { cycleHero, stripSummary } from "./hero-copy";
import type { Regime, RegimeDuration } from "../../api/types";

type Status = RegimeDuration["status"];
const STATUSES: Status[] = ["Early", "Mid-Cycle", "Extended", "Long in Tooth"];

function duration(over: Partial<RegimeDuration> = {}): RegimeDuration {
  return {
    current_regime: "Goldilocks",
    days_in_regime: 183,
    months_in_regime: 6,
    historical_avg_months: 14.3,
    percentile_duration: 38,
    progress_pct: 42,
    status: "Early",
    status_color: "#2ecc71",
    risk_indicators: { momentum: 58, valuation: 71, sentiment: 23 },
    ...over,
  };
}

function regime(over: Partial<Regime> = {}): Regime {
  return {
    date: "2026-09-01",
    label: "Goldilocks",
    confidence: 0.47,
    growth_trend: 0.31,
    inflation_trend: -0.42,
    prob_goldilocks: 0.58,
    prob_overheating: 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
    ...over,
  };
}

/** Four stored months, Jun to Sep 2026, with the Overheating odds given. */
const MONTHS = ["2026-06-01", "2026-07-01", "2026-08-01", "2026-09-01"];
const rows = (overheating: (number | null)[]): Regime[] => overheating.map((p, i) => regime({ date: MONTHS[i], prob_overheating: p }));

const copyOf = (over: Partial<RegimeDuration> = {}) => {
  const c = cycleHero(duration(over), regime());
  if (!c) throw new Error("cycleHero returned nothing for a served duration");
  return c;
};

describe("cycleHero (checklist 04 C.1)", () => {
  it("headline is the served status word verbatim, in the served casing", () => {
    for (const status of STATUSES) expect(copyOf({ status }).headline).toBe(status);
    expect(copyOf({ status: "Mid-Cycle" }).headline).not.toBe("Mid-cycle");
  });

  it("pill is the rounded streak with the singular for one month", () => {
    expect(copyOf({ months_in_regime: 6 }).pill).toBe("6 months in");
    expect(copyOf({ months_in_regime: 1 }).pill).toBe("1 month in");
    expect(copyOf({ months_in_regime: 0.6 }).pill).toBe("1 month in"); // one rounded string drives number and plural
    expect(copyOf({ months_in_regime: 14.4 }).pill).toBe("14 months in");
    expect(copyOf({ months_in_regime: 0 }).pill).toBe("0 months in");
    expect(copyOf().pill).toMatch(/^\d+ months? in$/);
  });

  it("tone is mint for Early and Mid-Cycle, amber for Extended and Long in Tooth, with the matching glow", () => {
    const cases: [Status, "mint" | "amber", RegExp][] = [
      ["Early", "mint", /^rgba\(38, ?220, ?160, ?0?\.08\)$/],
      ["Mid-Cycle", "mint", /^rgba\(38, ?220, ?160, ?0?\.08\)$/],
      ["Extended", "amber", /^rgba\(245, ?181, ?46, ?0?\.06\)$/],
      ["Long in Tooth", "amber", /^rgba\(245, ?181, ?46, ?0?\.06\)$/],
    ];
    for (const [status, tone, glow] of cases) {
      const c = copyOf({ status });
      expect(c.pillTone, status).toBe(tone);
      expect(c.glow, status).toMatch(glow);
    }
  });

  it("the four subheads put the regime as subject, end with a full stop and carry no digit", () => {
    const expected: Record<Status, string> = {
      Early: "Goldilocks is young by its own history.",
      "Mid-Cycle": "Goldilocks sits inside its normal historical span.",
      Extended: "Goldilocks has outlived most of its historical peers.",
      "Long in Tooth": "Goldilocks is among the longest spells on record; age alone argues for a change.",
    };
    for (const status of STATUSES) {
      const s = copyOf({ status }).subhead;
      expect(s, status).toBe(expected[status]);
      expect(s.startsWith("Goldilocks "), status).toBe(true);
      expect(s.endsWith("."), status).toBe(true);
      expect(s, status).not.toMatch(/\d/);
    }
    // The subject is the served current regime, spelled as served.
    expect(copyOf({ current_regime: "Recession Risk", status: "Extended" }).subhead).toBe("Recession Risk has outlived most of its historical peers.");
  });

  it("nothing in the hero copy prints a probability", () => {
    for (const status of STATUSES) {
      const c = copyOf({ status });
      for (const s of [c.headline, c.pill, c.subhead]) expect(s, status).not.toMatch(/%/);
    }
  });
});

describe("stripSummary (checklist 04 B.2 table)", () => {
  it("loading reads gray and points at the transition outlook", () => {
    expect(stripSummary(undefined, "loading")).toEqual({ tone: "gray", title: "Reading the classifier history…", detail: "Opens the transition outlook" });
  });

  it("error reads gray with the unavailable copy", () => {
    expect(stripSummary(undefined, "error")).toEqual({ tone: "gray", title: "Overheating odds unavailable", detail: "The data service did not answer" });
    expect(stripSummary(rows([0.07, 0.07, 0.07, 0.12]), "error").tone).toBe("gray");
  });

  it("rising (+1 point or more, rounded) reads amber with the Up copy and both months", () => {
    const seven = stripSummary(rows([0.05, 0.06, 0.07, 0.12]), "ready");
    expect(seven).toEqual({ tone: "amber", title: "Watch · Overheating odds rising", detail: "Up 7 pts · Jun 2026 → Sep 2026" });
    const one = stripSummary(rows([0.07, 0.07, 0.07, 0.08]), "ready");
    expect(one.tone).toBe("amber");
    expect(one.title).toBe("Watch · Overheating odds rising");
    expect(one.detail).toMatch(/^Up 1 pts? · Jun 2026 → Sep 2026$/);
    // 0.6 of a point rounds to 1 and counts as rising; 0.4 does not.
    expect(stripSummary(rows([0.07, 0.07, 0.07, 0.076]), "ready").tone).toBe("amber");
    expect(stripSummary(rows([0.07, 0.07, 0.07, 0.074]), "ready").tone).toBe("mint");
  });

  it("not rising (zero or negative) reads mint with the signed delta and both months; too little history reads gray", () => {
    const flat = stripSummary(rows([0.07, 0.07, 0.07, 0.07]), "ready");
    expect(flat.tone).toBe("mint");
    expect(flat.title).toBe("Overheating odds not rising");
    expect(flat.detail).toMatch(/^\+?0 pts · Jun 2026 → Sep 2026$/);
    const down = stripSummary(rows([0.1, 0.09, 0.08, 0.07]), "ready");
    expect(down.tone).toBe("mint");
    expect(down.title).toBe("Overheating odds not rising");
    expect(down.detail).toMatch(/^[−-]3 pts · Jun 2026 → Sep 2026$/);
    // The title word always agrees with the sign of the printed delta.
    expect(down.detail).not.toMatch(/^Up/);
    // Fewer than four rows, a null probability, or no rows at all: unavailable.
    const unavailable = { tone: "gray", title: "Overheating odds unavailable", detail: "The data service did not answer" };
    expect(stripSummary(rows([0.07, 0.07, 0.07]), "ready")).toEqual(unavailable);
    expect(stripSummary(rows([null, 0.07, 0.07, 0.07]), "ready")).toEqual(unavailable);
    expect(stripSummary(rows([0.07, 0.07, 0.07, null]), "ready")).toEqual(unavailable);
    expect(stripSummary(undefined, "ready")).toEqual(unavailable);
  });
});
