/**
 * Served study variants for the Desk tests (Codex R-02, R-03): the gold
 * study with a basis-point target, so every page that prints a target move
 * can be checked in a unit that is not a percent.
 */
import deferredMacro from "../fixtures/desk/deferred-macro.json" with { type: "json" };
import deferredRegime from "../fixtures/desk/deferred-regime.json" with { type: "json" };
import macro from "../fixtures/desk/macro.json" with { type: "json" };
import regime from "../fixtures/desk/regime.json" with { type: "json" };
import sectors from "../fixtures/desk/sectors.json" with { type: "json" };
import study from "../fixtures/desk/study.json" with { type: "json" };
import technicals from "../fixtures/desk/technicals.json" with { type: "json" };
import vol from "../fixtures/desk/vol.json" with { type: "json" };
import studyEvents from "../fixtures/desk/study-events.json" with { type: "json" };

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
    question: { ...study.question, target: "us10y", target_unit: "bp", display_unit: "bp", target_label: "10-year Treasury yield" },
    // §12.2's why is a template over horizons[selected]: in bp for a bp target.
    why: "18 completed outcomes in 18 overlap blocks; the 90% interval on the excess median runs −10 to +40 bp; 14.6% of resampled medians are adverse against a 3% bar.",
    horizons: study.horizons.map((h) => ({ ...h, ...bpH[h.h], ...(h.h === 20 ? { worst: { ret: -30, date: "2020-03-09" }, best: { ret: 60, date: "2025-04-16" } } : {}) })),
    // One regime at ten events (MIN_REGIME_N), so a bp median prints; the rest too few, as served.
    by_regime: study.by_regime.map((r) => (r.regime === "Goldilocks" ? { ...r, n: 10, up_pct: 0.6, median: 12 } : r.regime === "Recession Risk" ? { ...r, n: 2 } : r)),
    last_events: study.last_events.map((e, i) => ({ ...e, ret_20: [30, -15, 22, 5, 18][i] ?? 10 })),
    without_condition: { ...study.without_condition, median: 9 },
    client: {
      headline: "When gold jumps and stocks are already soft, what has the 10-year yield done next?",
      summary: "Looking at 18 episodes since 2000, the 10-year Treasury yield was higher a month later in 12 of 18, with a typical move of +25 bp against +5 bp in an ordinary month.",
    },
  };
}

/** The same study's event list, every move in basis points (a 1-month move of 8, a 3-month move of null). */
export function bpEvents(): Record<string, unknown> {
  return { ...studyEvents, events: studyEvents.events.map((e, i) => ({ ...e, ret_5: i === 0 ? 8 : 3, ret_10: 12, ret_20: 25, ret_60: i === 0 ? null : 30 })) };
}

// ── Deferred blocks served (§12.13): Monday serves them awaiting; these render the cards built for them. ──

/** /macro with its stock–bond, correlations and matrix blocks served (the deferred shapes, the mockup's values). */
export function servedMacro(): Record<string, unknown> {
  return { ...macro, stock_bond: deferredMacro.stock_bond, correlations: deferredMacro.correlations, matrix: deferredMacro.matrix };
}

/** /regime with its stats and changes blocks served. */
export function servedRegime(): Record<string, unknown> {
  return { ...regime, stats: deferredRegime.stats, changes: deferredRegime.changes };
}

/** /technicals with its vol and sectors blocks served (the /vol and /sectors deferred shapes). */
export function servedTechnicals(): Record<string, unknown> {
  const { as_of: _va, generation_id: _vg, ...v } = vol;
  const { as_of: _sa, generation_id: _sg, ...s } = sectors;
  void [_va, _vg, _sa, _sg];
  return { ...technicals, vol: v, sectors: s };
}

/** The deferred /sectors shape, as a served answer. */
export function servedSectors(): Record<string, unknown> {
  return { ...sectors };
}
