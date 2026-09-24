/**
 * Formatting for the event-study panels (DESK_FRAME2_SPEC §1: numbers come
 * only from the response, no client-side arithmetic beyond formatting). Every
 * function here takes a served value and prints it; none derives a new one.
 * Pure, no React.
 */

import type { EventStudyEvent, EventStudyResponse } from "../../../api/desk";
import { isNegative, pyFixed, pySigned } from "../pyformat";

export type MoveUnit = "%" | "bp";

/** A signed move in its unit exactly as the engine's `fmt_move` prints it
 * (`+.1f` percent, `+.0f` bp, the sign always kept, Python's rounding; review
 * R-03), with the house minus: "+1.6%", "−0.0%", "−12 bp"; a dash for none. */
export function fmtMove(x: number | null | undefined, unit: MoveUnit): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${pySigned(x, unit === "%" ? 1 : 0)}${unit === "%" ? "%" : " bp"}`;
}

/** A share as a whole percent, Python's rounding: 0.555… → "56%". */
export function fmtShare(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : `${pyFixed(x * 100, 0)}%`;
}

/** One interval bound exactly as the engine prints it: the same `fmt_move`
 * rule as a move, so a bound just below zero reads "−0.0%" (verifier V-02)
 * and the cell agrees with the engine's own sentence on the screen (N-1). */
export function fmtBound(x: number, unit: MoveUnit): string {
  return fmtMove(x, unit);
}

/** The 90% interval on Δ as served: "−1.6% to +4.1%". */
export function fmtInterval(ci: [number, number] | null, unit: MoveUnit): string | null {
  return ci ? `${fmtBound(ci[0], unit)} to ${fmtBound(ci[1], unit)}` : null;
}

/** A z-score to two places, Python's rounding, with a true minus sign. */
export function fmtZ(z: number | null | undefined): string {
  return z == null || !Number.isFinite(z) ? "—" : `${isNegative(z) ? "−" : ""}${pyFixed(z, 2)}`;
}


/** Why a forward move is missing (review R-08, fourth round). "window open"
 * only when the event itself carries an explicit `window_open` flag for that
 * horizon; a horizon's `n_incomplete` counts every incomplete window across
 * all events, so it cannot say which one is still open. The flag's rule is
 * judged against the target's own last observation, and an elapsed window
 * with a missing endpoint is a data gap (R-13, EVENT_STUDY_SPEC §7). The
 * engine does not serve the flag yet (deferred by decision, report §8), so
 * today every missing return reads "no observation". */
export function missingForwardWord(e: Pick<EventStudyEvent, "window_open">, h: number): "window open" | "no observation" {
  return e.window_open?.[String(h)] === true ? "window open" : "no observation";
}

/** The facts line under the verdict (spec §3):
 * `n {n} · blocks {blocks} · sample {start}–{end} · cooldown {w} · entry {rule}`.
 * Blocks are the engine's count at 20 sessions, the horizon its verdict cites. */
export function factsLine(s: EventStudyResponse): string {
  const p = s.provenance;
  const blocksH = p.n_blocks_by_h["20"] != null ? "20" : Object.keys(p.n_blocks_by_h)[0];
  const blocks = blocksH != null ? `${p.n_blocks_by_h[blocksH]} at ${blocksH}d` : "—";
  const cooldown = p.cooldown == null ? "none" : `${p.cooldown}`;
  const entry = p.entry_same_session == null ? "—" : p.entry_same_session ? "same session" : "next session";
  return `n ${p.n_events} · blocks ${blocks} · sample ${p.data_start ?? p.sample_start}–${p.sample_end} · cooldown ${cooldown} · entry ${entry}`;
}


/** Each input's history as the engine serves it, and where events become
 * evaluable, for the sample line's tooltip. */
export function historyLine(s: EventStudyResponse): string {
  const rows = s.provenance.inputs.map((i) => `${i.label}: history from ${i.history_from}${i.last ? `, last ${i.last}` : ""}`);
  const evaluable = `Events are evaluable from ${s.provenance.sample_start} to ${s.provenance.sample_end}.`;
  return rows.length ? `${rows.join("; ")}. ${evaluable}` : evaluable;
}
