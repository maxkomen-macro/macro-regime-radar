/**
 * A study's target moves in the target's own unit (DESK_FRAME3_SPEC §1.9,
 * v3 §6, main's `fmt_move`). The study serves `question.target_unit`
 * (`log_return` | `log_change` | `bp`) and `display_unit` (`percent` | `bp`):
 * - `log_return` and `log_change` print as 100 × native with a % sign
 *   (0.031 → "+3.1%"), and every such number carries the tooltip
 *   "log return, ×100" (`LOG_TIP`); no exponentiation anywhere;
 * - `bp` prints as served (25 → "+25 bp"), never as a percent.
 * Intervals (`ci_lo`, `ci_hi`) bound Δ = event median − baseline median in
 * native units: a range prints Δ scaled (log percentage points, "pts"; or
 * bp), and a chart's whisker runs from `baseline_median + ci_lo` to
 * `baseline_median + ci_hi` in native units, then takes the same linear
 * scale. A study served without its unit prints no move at all (the callers
 * say so): the page never guesses a unit from a series key. It lives in the
 * kit because it is the one display rule every tab uses (§1.9). Pure.
 */

import type { TargetUnit } from "../data/types";
import { isFiniteNumber, MINUS, signed } from "./format";

export const UNITS: readonly TargetUnit[] = ["log_return", "log_change", "bp"];

export const isUnit = (u: unknown): u is TargetUnit => typeof u === "string" && (UNITS as readonly string[]).includes(u);

/** Whether a unit is a log change, displayed as 100 × native (§1.9). */
export const isLog = (u: TargetUnit | undefined): boolean => u === "log_return" || u === "log_change";

/** The tooltip every log-return number carries (§1.9, v3 §6). */
export const LOG_TIP = "log return, ×100";

/** The tooltip for a number in this unit: the log rule's, else none. */
export const tipOf = (u: TargetUnit | undefined): string | undefined => (isLog(u) ? LOG_TIP : undefined);

/** How many display units one native unit is: a log change draws as 100 × native, bp as served. */
export function scaleOf(unit: TargetUnit): number {
  return isLog(unit) ? 100 : 1;
}

/** Decimals for a value in display units: whole basis points, else a tenth. */
function digitsFor(unit: TargetUnit, shown: number): number {
  return unit === "bp" && Number.isInteger(Math.round(shown * 10) / 10) ? 0 : 1;
}

/** One move, native in, display out: "+3.1%", "+25 bp"; null when the unit or the value was not served. */
export function moveText(v: number | null | undefined, unit: TargetUnit | undefined, digits?: number): string | null {
  if (!isUnit(unit) || !isFiniteNumber(v)) return null;
  const shown = v * scaleOf(unit);
  const d = digits ?? digitsFor(unit, shown);
  return isLog(unit) ? `${signed(shown, d)}%` : `${signed(shown, d)} bp`;
}

/** A difference of two moves (vs normal, an interval's end), native in: "+1.8 pts" of log percentage points, "+6 bp". */
export function diffText(v: number | null | undefined, unit: TargetUnit | undefined): string | null {
  if (!isUnit(unit) || !isFiniteNumber(v)) return null;
  const shown = v * scaleOf(unit);
  return `${signed(shown, digitsFor(unit, shown))} ${isLog(unit) ? "pts" : "bp"}`;
}

/** An interval on Δ, native in: "−1.6 to +4.1 pts", "−10 to +40 bp". */
export function rangeText(lo: number | null | undefined, hi: number | null | undefined, unit: TargetUnit | undefined): string | null {
  if (!isUnit(unit) || !isFiniteNumber(lo) || !isFiniteNumber(hi)) return null;
  const k = scaleOf(unit);
  const [a, b] = [lo * k, hi * k];
  const d = unit === "bp" && Number.isInteger(Math.round(a * 10) / 10) && Number.isInteger(Math.round(b * 10) / 10) ? 0 : 1;
  return `${signed(a, d)} to ${signed(b, d)} ${isLog(unit) ? "pts" : "bp"}`;
}

/** A chart whisker in display units: baseline + ci in native units, then scaled (§1.9); null when not served. */
export function whisker(baseline: number | null | undefined, ciLo: number | null | undefined, ciHi: number | null | undefined, unit: TargetUnit): { lo: number; hi: number } | null {
  if (!isFiniteNumber(baseline) || !isFiniteNumber(ciLo) || !isFiniteNumber(ciHi)) return null;
  const k = scaleOf(unit);
  return { lo: (baseline + ciLo) * k, hi: (baseline + ciHi) * k };
}

/** A chart tick, already in display units: "+5%", "+25 bp"; zero is "0". */
export function tickText(t: number, unit: TargetUnit): string {
  if (t === 0) return "0";
  const s = `${t > 0 ? "+" : MINUS}${Math.abs(t)}`;
  return isLog(unit) ? `${s}%` : `${s} bp`;
}
