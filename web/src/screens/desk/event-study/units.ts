/**
 * A study's target moves in the target's own unit (§12.13, Codex R-02): the
 * study serves `question.target_unit`, and every median, baseline, interval,
 * extreme, event move and chart axis is spelled from it: `pct` a fraction
 * (0.031 → "+3.1%", intervals in percentage points), `bp` basis points
 * (25 → "+25 bp", never a percent), `px` the target's own price points
 * (12.5 → "+12.5 pts"). A study served without its unit prints none of them
 * (the callers say "Awaiting refresh"): the page never guesses a unit from a
 * series key. Pure.
 */

import type { TargetUnit } from "../data/types";
import { isFiniteNumber, MINUS, signed } from "../kit/format";

export const UNITS: readonly TargetUnit[] = ["pct", "bp", "px"];

export const isUnit = (u: unknown): u is TargetUnit => typeof u === "string" && (UNITS as readonly string[]).includes(u);

/** How many chart units one served unit is: a pct fraction draws in percent, bp and px as served. */
export function scaleOf(unit: TargetUnit): number {
  return unit === "pct" ? 100 : 1;
}

/** Decimals for a value in the chart's units: whole basis points, else a tenth. */
function digitsFor(unit: TargetUnit, shown: number): number {
  return unit === "bp" && Number.isInteger(Math.round(shown * 10) / 10) ? 0 : 1;
}

/** One move: "+3.1%", "+25 bp", "+12.5 pts"; null when the unit or the value was not served. */
export function moveText(v: number | null | undefined, unit: TargetUnit | undefined, digits?: number): string | null {
  if (!isUnit(unit) || !isFiniteNumber(v)) return null;
  const shown = v * scaleOf(unit);
  const d = digits ?? digitsFor(unit, shown);
  if (unit === "pct") return `${signed(shown, d)}%`;
  return `${signed(shown, d)} ${unit === "bp" ? "bp" : "pts"}`;
}

/** An interval, already in the chart's units (`ci_*_pts`): "−1.6 to +4.1 pts", "−10 to +40 bp". */
export function rangeText(lo: number | null | undefined, hi: number | null | undefined, unit: TargetUnit | undefined): string | null {
  if (!isUnit(unit) || !isFiniteNumber(lo) || !isFiniteNumber(hi)) return null;
  const d = unit === "bp" && Number.isInteger(lo) && Number.isInteger(hi) ? 0 : 1;
  return `${signed(lo, d)} to ${signed(hi, d)} ${unit === "bp" ? "bp" : "pts"}`;
}

/** A chart tick, already in the chart's units: "+5%", "+25 bp", "+5"; zero is "0". */
export function tickText(t: number, unit: TargetUnit): string {
  if (t === 0) return "0";
  const s = `${t > 0 ? "+" : MINUS}${Math.abs(t)}`;
  return unit === "pct" ? `${s}%` : unit === "bp" ? `${s} bp` : s;
}
