/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) A.2 and
 * E.1, `screens/regimelab/regime-history.test.ts`: the pure helpers over the
 * stored monthly regime rows (no React, no hooks). Every expected number is
 * read off a spelled-out 26-month spell string ending Sep 2026 (one letter
 * per month), never off the mockup: three completed Goldilocks spells, one
 * switch inside the last 12 rows, the open Goldilocks spell six months long.
 */
import { describe, expect, it } from "vitest";
import { REGIMES, REGIME_HUE, exitCounts, mergeSegments, overheatingDelta3m, spellStart, stay6m, switchesInLast12, trailPoints, yearsOfHistory } from "./regime-history";
import type { Regime, RegimeLabel, TransitionOutlook } from "../../api/types";

const LATEST = "2026-09-01";
const LABEL: Record<string, RegimeLabel> = { G: "Goldilocks", O: "Overheating", S: "Stagflation", R: "Recession Risk" };
/** Aug 2024 to Sep 2026, one letter per month. Completed Goldilocks spells:
 * two exit into Overheating, one into Stagflation; the last twelve rows
 * (Oct 2025 on) carry exactly one switch, Recession Risk to Goldilocks in
 * Apr 2026, so the open spell is six months old. */
const SPELLS = "GG OO GGG SS GG OOO RRRRRR GGGGGG";

function monthsEnding(n: number, last = LATEST): string[] {
  const [y, m] = last.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  });
}

/** Rows with trends and odds on every month; the fourth-from-last row carries
 * Overheating odds of 10% against 7% everywhere else (a 3-point fall). */
function history(spec = SPELLS, over: (row: Regime, i: number, n: number) => Partial<Regime> = () => ({})): Regime[] {
  const labels = spec.replace(/\s+/g, "").split("").map((c) => LABEL[c]);
  const dates = monthsEnding(labels.length);
  const n = labels.length;
  return labels.map((label, i) => {
    const row: Regime = {
      date: dates[i],
      label,
      confidence: 0.47,
      growth_trend: ((i % 7) - 3) / 4,
      inflation_trend: ((i % 5) - 2) / 4,
      prob_goldilocks: 0.58,
      prob_overheating: i === n - 4 ? 0.1 : 0.07,
      prob_stagflation: 0.04,
      prob_recession: 0.31,
    };
    return { ...row, ...over(row, i, n) };
  });
}

const transitions = (probs: number[]): TransitionOutlook => ({
  current_regime: "Goldilocks",
  stay_probability_3m: 81,
  transitions_3m: [],
  transitions_6m: probs.map((probability, i) => ({ to: (["Recession Risk", "Overheating", "Stagflation"] as RegimeLabel[])[i], probability, color: "#95a5a6" })),
  narrative_3m: "",
  narrative_6m: "",
  highest_risk_transition: "Recession Risk",
  highest_risk_prob: 12,
  highest_risk_color: "#95a5a6",
});

describe("regime-history helpers (checklist 04 A.2)", () => {
  it("REGIMES is the house order and REGIME_HUE carries the four tokens, never a hex", () => {
    expect([...REGIMES]).toEqual(["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]);
    expect(REGIME_HUE).toEqual({
      Goldilocks: "var(--r-goldilocks)",
      Overheating: "var(--r-overheating)",
      Stagflation: "var(--r-stagflation)",
      "Recession Risk": "var(--r-recession)",
    });
    for (const v of Object.values(REGIME_HUE)) expect(v).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("mergeSegments collapses consecutive months into spans exactly as the Gantt did", () => {
    expect(mergeSegments(history())).toEqual([
      { label: "Goldilocks", start: "2024-08-01", end: "2024-09-01", months: 2 },
      { label: "Overheating", start: "2024-10-01", end: "2024-11-01", months: 2 },
      { label: "Goldilocks", start: "2024-12-01", end: "2025-02-01", months: 3 },
      { label: "Stagflation", start: "2025-03-01", end: "2025-04-01", months: 2 },
      { label: "Goldilocks", start: "2025-05-01", end: "2025-06-01", months: 2 },
      { label: "Overheating", start: "2025-07-01", end: "2025-09-01", months: 3 },
      { label: "Recession Risk", start: "2025-10-01", end: "2026-03-01", months: 6 },
      { label: "Goldilocks", start: "2026-04-01", end: "2026-09-01", months: 6 },
    ]);
    expect(mergeSegments([])).toEqual([]);
    // A single month is a one-month span whose end is its own date.
    expect(mergeSegments(history("O"))).toEqual([{ label: "Overheating", start: LATEST, end: LATEST, months: 1 }]);
  });

  it("spellStart returns the streak length, its first month and the previous label", () => {
    expect(spellStart(history())).toEqual({ n: 6, since: "2026-04-01", prev: "Recession Risk" });
    // A record that starts inside the streak has no previous label.
    const all = history("GGGGGGGGGGGGGG");
    expect(spellStart(all)).toEqual({ n: 14, since: all[0].date, prev: null });
    expect(spellStart(history("SR"))).toEqual({ n: 1, since: LATEST, prev: "Stagflation" });
    expect(spellStart([])).toBeNull();
  });

  it("exitCounts excludes the open spell, counts successors and sorts by count then house order", () => {
    const rows = history();
    expect(exitCounts(rows, "Goldilocks")).toEqual([
      { to: "Overheating", count: 2 },
      { to: "Stagflation", count: 1 },
    ]);
    // Ties fall back to the house order (Goldilocks before Recession Risk).
    expect(exitCounts(rows, "Overheating")).toEqual([
      { to: "Goldilocks", count: 1 },
      { to: "Recession Risk", count: 1 },
    ]);
    expect(exitCounts(rows, "Stagflation")).toEqual([{ to: "Goldilocks", count: 1 }]);
    expect(exitCounts(rows, "Recession Risk")).toEqual([{ to: "Goldilocks", count: 1 }]);
    // Zero-count regimes are not listed, and the open final spell never counts.
    expect(exitCounts(rows, "Goldilocks").map((e) => e.to)).not.toContain("Recession Risk");
    expect(exitCounts(history("GGGG"), "Goldilocks")).toEqual([]);
    expect(exitCounts(history("OOO GG"), "Goldilocks")).toEqual([]);
    expect(exitCounts(history("OOO GG"), "Overheating")).toEqual([{ to: "Goldilocks", count: 1 }]);
    expect(exitCounts([], "Goldilocks")).toEqual([]);
  });

  it("switchesInLast12 counts label changes inside the last 12 rows only", () => {
    expect(switchesInLast12(history())).toBe(1);
    // Fewer than 12 rows: every consecutive pair counts.
    expect(switchesInLast12(history("GORS"))).toBe(3);
    expect(switchesInLast12(history("GGGGGGGGGGGGGG"))).toBe(0);
    // Switches before the window (and the pair that straddles its start) are not counted.
    expect(switchesInLast12(history("GO SSSSSSSSSSSS"))).toBe(0);
    expect(switchesInLast12(history("GO SSSSSSSSSSS R"))).toBe(1);
    expect(switchesInLast12([])).toBe(0);
  });

  it("trailPoints maps the stored trends to x / y in date order and drops rows with a null trend", () => {
    const rows = history();
    const points = trailPoints(rows);
    expect(points).toHaveLength(12);
    expect(points[0].date).toBe("2025-10-01");
    expect(points[11]).toEqual({ date: LATEST, label: "Goldilocks", x: rows[25].growth_trend, y: rows[25].inflation_trend });
    for (let i = 1; i < points.length; i++) expect(points[i - 1].date < points[i].date, `date order at ${i}`).toBe(true);
    for (const p of points) {
      const row = rows.find((r) => r.date === p.date) as Regime;
      expect(p).toEqual({ date: row.date, label: row.label, x: row.growth_trend, y: row.inflation_trend });
    }
    // A row with a null trend is dropped rather than plotted at zero.
    const gap = trailPoints(history(SPELLS, (_, i, n) => (i === n - 2 ? { growth_trend: null } : {})));
    expect(gap.every((p) => p.date !== "2026-08-01")).toBe(true);
    expect(gap.length).toBeLessThanOrEqual(12);
    expect(gap[gap.length - 1].date).toBe(LATEST);
    const noInflation = trailPoints(history(SPELLS, (_, i, n) => (i === n - 1 ? { inflation_trend: null } : {})));
    expect(noInflation[noInflation.length - 1].date).toBe("2026-08-01");
    // The window length is a parameter.
    expect(trailPoints(rows, 3).map((p) => p.date)).toEqual(["2026-07-01", "2026-08-01", LATEST]);
    expect(trailPoints([])).toEqual([]);
  });

  it("overheatingDelta3m reads the fourth-from-last row in points with both stamps; null with fewer than 4 rows or a null probability", () => {
    const out = overheatingDelta3m(history());
    expect(out).not.toBeNull();
    expect(out?.delta).toBeCloseTo(-3, 6);
    expect(Object.values(out ?? {})).toEqual(expect.arrayContaining(["2026-06-01", LATEST]));
    const up = overheatingDelta3m(history(SPELLS, (_, i, n) => (i === n - 4 ? { prob_overheating: 0.05 } : {})));
    expect(up?.delta).toBeCloseTo(2, 6);
    // Exactly four rows is enough: the base is the first of them.
    const four = overheatingDelta3m(history("GGGG", (_, i) => (i === 0 ? { prob_overheating: 0.2 } : { prob_overheating: 0.07 })));
    expect(four?.delta).toBeCloseTo(-13, 6);
    expect(overheatingDelta3m(history("GGG"))).toBeNull();
    expect(overheatingDelta3m(history(SPELLS, (_, i, n) => (i === n - 1 ? { prob_overheating: null } : {})))).toBeNull();
    expect(overheatingDelta3m(history(SPELLS, (_, i, n) => (i === n - 4 ? { prob_overheating: null } : {})))).toBeNull();
    expect(overheatingDelta3m([])).toBeNull();
    expect(overheatingDelta3m(undefined)).toBeNull();
  });

  it("stay6m is the rounded residual of the served 6-month rows, unfloored (A4: the display dashes a negative)", () => {
    expect(stay6m(transitions([19, 9, 4]))).toBe(68);
    expect(stay6m(transitions([19.4, 9, 4]))).toBe(68); // 67.6 rounds up
    expect(stay6m(transitions([19.6, 9, 4]))).toBe(67);
    // Iteration 1 step 6 (A4): no floor; fmtProb renders a negative residual as "—".
    expect(stay6m(transitions([60, 30, 14]))).toBe(-4);
    expect(stay6m(transitions([]))).toBe(100);
  });

  it("yearsOfHistory is the whole years between the first and last rows", () => {
    expect(yearsOfHistory(history())).toBe(2);
    const span = (from: string, to: string): Regime[] => [{ ...history("G")[0], date: from }, { ...history("G")[0], date: to }];
    expect(yearsOfHistory(span("1996-05-01", "2026-07-01"))).toBe(30);
    expect(yearsOfHistory(span("2024-08-01", "2026-07-01"))).toBe(1); // eleven months short of two
    expect(yearsOfHistory(span("2024-09-01", "2026-09-01"))).toBe(2);
    expect(yearsOfHistory(history("G"))).toBe(0);
  });
});
