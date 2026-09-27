/**
 * Served study variants for the Desk tests (Codex R-02, R-03): the gold
 * study with a basis-point target, so every page that prints a target move
 * can be checked in a unit that is not a percent.
 */
import deferredMacro from "../fixtures/desk/deferred-macro.json" with { type: "json" };
import macro from "../fixtures/desk/macro.json" with { type: "json" };
import sectors from "../fixtures/desk/sectors.json" with { type: "json" };
import study from "../fixtures/desk/study.json" with { type: "json" };
import technicals from "../fixtures/desk/technicals.json" with { type: "json" };
import vol from "../fixtures/desk/vol.json" with { type: "json" };
import studyEvents from "../fixtures/desk/study-events.json" with { type: "json" };

/**
 * /technicals on a session whose 50 and 200 closes are all stored. The fixture's Sep 23 reads both averages
 * null across the missing Sep 22 close (§12.7, Codex R-24), so a test of what a served average drives
 * (automatic monitoring against the 50-day, the level chips' numbers) takes these: the means of the stored
 * closes the fixture carried before R-24. Illustrative, for the tests only.
 */
export function completeTechnicals(): Record<string, unknown> {
  return {
    ...technicals,
    ma50: 7624.837392578125,
    ma200: 7192.012006835937,
    ma50_window: { start: "2026-07-14", end: "2026-09-23", n: 50 },
    ma200_window: { start: "2025-12-04", end: "2026-09-23", n: 200 },
    vs_ma50: 0.010648409716534468,
    vs_ma200: 0.07147065074860048,
    trend: { state: "above_both", state_since: "2026-09-17" },
  };
}

/** The gold study re-served with the 10-year yield as its target, every move in basis points. */
export function bpStudy(): Record<string, unknown> {
  const bpH: Record<number, { median: number; baseline_median: number; ci_lo: number; ci_hi: number }> = {
    5: { median: 8, baseline_median: 1, ci_lo: -6, ci_hi: 18 },
    10: { median: 12, baseline_median: 2, ci_lo: -8, ci_hi: 26 },
    20: { median: 25, baseline_median: 5, ci_lo: -10, ci_hi: 40 },
    60: { median: 30, baseline_median: 12, ci_lo: -25, ci_hi: 45 },
  };
  return {
    ...study,
    question: { ...study.question, target: "us10y", target_unit: "bp", display_unit: "bp" },
    // §12.2's why is a template over horizons[selected]: in bp for a bp target.
    why: "18 completed outcomes in 18 overlap blocks; the 90% interval on the excess median runs −10 to +40 bp; 14.6% of resampled medians are adverse against a 3% bar.",
    horizons: study.horizons.map((h) => ({
      ...h,
      ...bpH[h.h],
      ...(h.h === 20 ? { worst: { value: -30, event_date: "2011-08-30", entry_date: "2011-08-31" }, best: { value: 60, event_date: "2025-04-16", entry_date: "2025-04-17" } } : {}),
    })),
    // One regime at ten events (MIN_REGIME_N), so a bp median prints; the rest too few, as served.
    by_regime: study.by_regime.map((r) => (r.regime === "Goldilocks" ? { ...r, n: 10, up_pct: 0.6, median: 12 } : r.regime === "Recession Risk" ? { ...r, n: 2 } : r)),
    last_events: study.last_events.map((e, i) => ({ ...e, value_20: [30, -15, 22, 5, 18][i] ?? 10 })),
    without_condition: { ...study.without_condition, median: 9 },
    client: {
      horizon: 20,
      headline: "Gold jumps over a month while the S&P is weak",
      summary: "Looking at 18 episodes since 2001, the 10Y Treasury was higher a month later in 12 of 18, with a typical move of +25 bp against +5 bp in an ordinary month.",
    },
  };
}

/** The same study's event list, every move in basis points (a 1-month move of 8, a 3-month move of null). */
export function bpEvents(): Record<string, unknown> {
  return {
    ...studyEvents,
    events: studyEvents.events.map((e, i) => ({ ...e, value_5: i === 0 ? 8 : 3, value_10: 12, value_20: 25, value_60: i === 0 ? null : 30, complete_60: i !== 0 })),
  };
}

// ── Deferred blocks served (§12.13): Monday serves them awaiting; these render the cards built for them. ──

/** /macro with every block served: stock–bond and the correlations as the fixture serves them (desk/fill-etf, the
 * API's answer), and the matrix from its deferred shape (the mockup's values, a test input only). */
export function servedMacro(): Record<string, unknown> {
  const m = macro as { stock_bond: { data: unknown }; correlations: { data: unknown } };
  return { ...macro, stock_bond: m.stock_bond.data, correlations: m.correlations.data, matrix: deferredMacro.matrix };
}

/** /technicals with its vol block served (the /vol deferred shape); its sectors block is served in the fixture (§12.14). */
export function servedTechnicals(): Record<string, unknown> {
  const { as_of: _va, generation_id: _vg, ...v } = vol;
  void [_va, _vg];
  return { ...technicals, vol: v };
}

/** /sectors as served (§12.14). */
export function servedSectors(): Record<string, unknown> {
  return { ...sectors };
}
