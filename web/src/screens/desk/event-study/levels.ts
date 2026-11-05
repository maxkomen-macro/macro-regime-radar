/**
 * Desk P1d (docs/desk/INTERVALS_SPEC.md): which range the Event Study draws. The verdicts are judged at the
 * engine's 90% (`ci_lo`/`ci_hi`); §12.2 also serves the 80% and 95% ranges of the same resampled medians
 * (`ci80_*`, `ci95_*`), display only. The address carries the requested level (`ci=80|95`, absent for 90); the
 * page draws one effective level for the whole answer, never mixed per row (DR-02, DR-06).
 */

import type { StudyHorizon, TargetUnit } from "../data/types";
import { isFiniteNumber as fin } from "../kit/format";
import { rangeText } from "../kit/units";

export type Level = 80 | 90 | 95;
export const LEVELS: readonly Level[] = [80, 90, 95];
/** The engine's level: the verdicts', and the one every answer serves. */
export const ENGINE_LEVEL: Level = 90;

/** The requested level in an address: `ci=80` or `ci=95`, anything else (or none) 90. */
export function levelOf(search: URLSearchParams): Level {
  const v = search.get("ci");
  return v === "80" ? 80 : v === "95" ? 95 : 90;
}

/** An address `ci` value the page does not read (§6: read as 90 and dropped from the address). */
export function strayLevel(search: URLSearchParams): boolean {
  const v = search.get("ci");
  return v !== null && v !== "80" && v !== "95";
}

const KEYS: Record<Level, [keyof StudyHorizon, keyof StudyHorizon]> = {
  80: ["ci80_lo", "ci80_hi"],
  90: ["ci_lo", "ci_hi"],
  95: ["ci95_lo", "ci95_hi"],
};

/** Whether this answer serves `level` at all: 90 always; 80 or 95 only when every horizon carries that level's two
 * fields (null or not). An answer from before P1d carries none, and is drawn at 90 (the old-answer fallback). */
export function serves(horizons: readonly StudyHorizon[], level: Level): boolean {
  if (level === ENGINE_LEVEL) return true;
  const [lo, hi] = KEYS[level];
  return horizons.length > 0 && horizons.every((h) => lo in h && hi in h);
}

/** The level drawn for the whole answer: the requested one when the answer serves it, else the engine's 90. */
export function effectiveLevel(horizons: readonly StudyHorizon[], requested: Level): Level {
  return serves(horizons, requested) ? requested : ENGINE_LEVEL;
}

/** A horizon's range at `level`, native, or null when that pair is not two finite numbers. */
export function pairAt(h: StudyHorizon, level: Level): { lo: number; hi: number } | null {
  const [kl, kh] = KEYS[level];
  const lo = h[kl];
  const hi = h[kh];
  return fin(lo) && fin(hi) ? { lo: lo as number, hi: hi as number } : null;
}

/** Why a served 80% or 95% pair is null where the 90% one is not (DR-05). */
export const NOT_COMPUTABLE = "This range cannot be computed for this horizon.";
/** The reason an old answer's switch gives for 80% and 95% (§4). */
export const PREDATES = "This answer predates the 80% and 95% ranges; the next refresh serves them.";

/** One rail row at the effective level: its range in words (`range`), why there is none (`why`), or that it did
 * not arrive (`await`, "Awaiting refresh"). At 90 it is the rail's rule before P1d: the engine's reason when the
 * interval is served null with one. At 80 or 95 the row never borrows the 90% pair: with no 90% interval it gives
 * the engine's reason as at 90; with a 90% one but no pair at this level, NOT_COMPUTABLE. */
export function rowRange(h: StudyHorizon, level: Level, unit: TargetUnit | undefined): { kind: "range" | "why" | "await"; text: string } {
  const reason = typeof h.reason === "string" && h.reason ? h.reason : null;
  const p = pairAt(h, level);
  const text = p ? rangeText(p.lo, p.hi, unit) : null;
  if (text) return { kind: "range", text };
  if (level === ENGINE_LEVEL || !pairAt(h, ENGINE_LEVEL)) return reason ? { kind: "why", text: reason } : { kind: "await", text: "Awaiting refresh" };
  return { kind: "why", text: NOT_COMPUTABLE };
}
