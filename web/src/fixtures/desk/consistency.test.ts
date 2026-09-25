/**
 * The fixtures agree with each other (Codex round 1, group 3). R-05: every
 * study event carries the regime row stamped two months before its own month
 * in the fixtures' monthly record, whose last rows are /regime's history; the
 * study's by-regime rows and last five events are those events, recomputed.
 * R-06: every number in the hedge is its structure's payoff per $100 of
 * basket, as §12.13 defines breakeven and max loss.
 */
import { describe, expect, it } from "vitest";
import hedge from "./hedge.json";
import record from "./regime-record.json";
import regime from "./regime.json";
import studyEvents from "./study-events.json";
import study from "./study.json";

const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
/** §12.2: a regime with fewer than ten events (the engine's MIN_REGIME_N) serves its count and null cells. */
const FLOOR = 10;

function monthBefore(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const k = y * 12 + (m - 1) - n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

describe("the study's events and the regime fixture (Codex R-05)", () => {
  const months = record.months;
  const byMonth = new Map(months.map((r) => [r.month, r.regime]));

  it("the record's months by regime are /regime's stats (What each regime has meant · since 1996)", () => {
    expect(months[0].month.startsWith("1996")).toBe(true);
    for (const row of regime.stats) expect([row.regime, row.months]).toEqual([row.regime, months.filter((m) => m.regime === row.regime).length]);
  });

  it("the record is one row a month, and its last rows are /regime's history exactly", () => {
    for (let i = 1; i < months.length; i++) expect(months[i].month).toBe(monthBefore(months[i - 1].month, -1));
    expect(months.slice(-regime.history.length)).toEqual(regime.history);
    expect(record.lag_months).toBe(2);
    expect(months.every((r) => REGIMES.includes(r.regime))).toBe(true);
  });

  it("every event's regime is the row stamped K−2, K its own month", () => {
    expect(studyEvents.events.length).toBe(study.matched_n);
    for (const e of studyEvents.events) expect([e.date, e.regime]).toEqual([e.date, byMonth.get(monthBefore(e.date.slice(0, 7), record.lag_months))]);
    const dates = studyEvents.events.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it("by regime is recomputed from those events: n, the share up and the median a month later", () => {
    const want = REGIMES.map((r) => {
      // §12.2: `by_regime[].n` counts the regime's events complete at h = 20.
      const rets = studyEvents.events.filter((e) => e.regime === r && typeof e.ret_20 === "number").map((e) => e.ret_20 as number);
      if (rets.length < FLOOR) return { h: 20, regime: r, n: rets.length, up_pct: null, median: null };
      return { h: 20, regime: r, n: rets.length, up_pct: Math.round((rets.filter((x) => x > 0).length / rets.length) * 100) / 100, median: Math.round(median(rets) * 1000) / 1000 };
    });
    expect(study.by_regime).toEqual(want);
    expect(study.by_regime.reduce((a, r) => a + r.n, 0) + study.unlabeled_n).toBe(study.matched_n);
  });

  it("each horizon's counts, share up, median and extrema are its own completed outcomes (C-03)", () => {
    for (const h of study.horizons) {
      const done = studyEvents.events.filter((e) => typeof e[`ret_${h.h}` as "ret_20"] === "number").map((e) => ({ v: e[`ret_${h.h}` as "ret_20"] as number, date: e.date }));
      const vals = done.map((d) => d.v);
      expect([h.h, h.n, h.up_n]).toEqual([h.h, done.length, vals.filter((v) => v > 0).length]);
      expect(h.up_pct).toBe(Math.round((h.up_n / h.n) * 100) / 100);
      expect(h.median).toBe(Math.round(median(vals) * 1000) / 1000);
      const lo = done.reduce((a, b) => (b.v < a.v ? b : a));
      const hi = done.reduce((a, b) => (b.v > a.v ? b : a));
      expect([h.worst, h.best]).toEqual([{ ret: lo.v, date: lo.date }, { ret: hi.v, date: hi.date }]);
    }
    expect(study.horizons.find((h) => h.h === study.selected_horizon)).toBeDefined();
  });

  it("the last five events are the list's first five, with their regimes", () => {
    expect(study.last_events).toEqual(studyEvents.events.slice(0, 5).map((e) => ({ date: e.date, regime: e.regime, ret_20: e.ret_20 })));
  });
});

type Leg = { right: string; strike: number; qty: number };
type Option = (typeof hedge.options)[number];

/** The structure's payoff per $1 of notional at an NDX move `x`: strikes are NDX moves from today. */
const payoff = (legs: Leg[], x: number) => legs.reduce((a, l) => a + l.qty * (l.right === "put" ? Math.max(l.strike - x, 0) : Math.max(x - l.strike, 0)), 0);
/** Basket + hedge payoff − cost, per $100 of basket, at an NDX move `x`. */
const hedged = (o: Option, x: number) => hedge.beta * x + ((o.hedge_per_100 as number) / 100) * payoff(o.legs, x) - (o.cost_pct as number);

describe("the hedge's numbers are its structures' payoffs (Codex R-06)", () => {
  it("the ratio line: $ of notional per $100 of basket is beta × delta × 100", () => {
    for (const o of hedge.options) expect(o.hedge_per_100).toBeCloseTo(hedge.beta * (o.delta as number) * 100, 9);
  });

  it("the table: each scenario's basket is beta × NDX, and its hedged book the payoff less the cost", () => {
    for (const o of hedge.options)
      for (const s of o.scenarios) {
        expect(s.basket).toBeCloseTo(hedge.beta * s.ndx, 9);
        expect(s.hedged).toBeCloseTo(hedged(o, s.ndx), 9);
      }
  });

  it("breakeven: the basket move at which basket + hedge − cost is zero", () => {
    for (const o of hedge.options) {
      const x = (o.breakeven as number) / hedge.beta;
      expect(hedged(o, x)).toBeCloseTo(0, 9);
      // The book is below zero just under it and above just over it: the one crossing.
      expect(hedged(o, x - 1e-4)).toBeLessThan(0);
      expect(hedged(o, x + 1e-4)).toBeGreaterThan(0);
    }
  });

  it("max loss: the worst of basket + hedge − cost over the structure's own range, per $100 of basket", () => {
    for (const o of hedge.options) {
      const longPut = Math.max(...o.legs.filter((l) => l.right === "put" && l.qty > 0).map((l) => l.strike));
      const shortPuts = o.legs.filter((l) => l.right === "put" && l.qty < 0).map((l) => l.strike);
      const floor = shortPuts.length ? Math.max(...shortPuts) : Math.min(...o.scenarios.map((s) => s.ndx));
      expect(o.protected_range).toEqual({ ndx_from: longPut, ndx_to: floor, basis: shortPuts.length ? "strikes" : "table_floor" });
      let worst = Infinity;
      for (let i = 0; i <= 10_000; i++) worst = Math.min(worst, hedged(o, longPut + ((floor - longPut) * i) / 10_000));
      expect(o.max_loss).toBeCloseTo(worst, 9);
    }
  });

  it("the prose quotes the payoffs: the notes, the recommendation and the single-name figure", () => {
    const by = (id: string) => hedge.options.find((o) => o.id === id)!;
    const pct1 = (v: number) => (Math.round(v * 1000) / 10).toFixed(1);
    const spread = by("put_spread");
    const collar = by("collar");
    const outright = by("outright_puts");
    const most = ((spread.hedge_per_100 as number) / 100) * 0.05;
    expect(spread.scenario_note).toContain(`at most ${pct1(most)}% of the basket (5 points × $${spread.hedge_per_100} of notional)`);
    for (const o of [collar, outright]) expect(o.scenario_note).toContain(`${Math.round(o.hedge_per_100 as number) / 100}% of the basket for each point`);
    expect(collar.scenario_note).toContain(`at NDX −20% the book loses ${pct1(-hedged(collar, -0.2))}% instead of ${pct1(-hedge.beta * -0.2).replace(/\.0$/, "")}%`);
    expect(collar.scenario_note).toContain(`at +10% it makes ${pct1(hedged(collar, 0.1))}% instead of ${pct1(hedge.beta * 0.1).replace(/\.0$/, "")}%`);
    // The outright puts beat the spread below the NDX move where the two books meet: about −12%.
    let x = -0.1;
    while (hedged(outright, x) <= hedged(spread, x)) x -= 1e-5;
    expect(Math.round(x * 100)).toBe(-12);
    expect(outright.scenario_note).toContain("past about −12%");
    expect(hedge.reads.recommendation.text).toContain(`For ${pct1(spread.cost_pct as number)}% of the basket it pays up to ${pct1(most)}%`);
    expect(hedge.reads.why_index.text).toContain(`about ${pct1(1.7 * (outright.cost_pct as number))}% (1.7 × ${pct1(outright.cost_pct as number)}%)`);
  });
});
