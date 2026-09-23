/**
 * Formatting for the event-study panels (DESK_FRAME2_SPEC §1: numbers come
 * only from the response, no client-side arithmetic beyond formatting). Every
 * function here takes a served value and prints it; none derives a new one.
 * Pure, no React.
 */

import type { EventStudyEvent, EventStudyHorizon, EventStudyResponse, Exclusion, ShockUnit } from "../../../api/desk";
import { isNegative, pyFixed, pySigned } from "../pyformat";

export type MoveUnit = "%" | "bp";

export function unitWord(u: ShockUnit): MoveUnit {
  return u === "bp" ? "bp" : "%";
}

/** A signed move in its unit exactly as the engine's `fmt_move` prints it
 * (`+.1f` percent, `+.0f` bp, the sign always kept, Python's rounding; review
 * R-03), with the house minus: "+1.6%", "−0.0%", "−12 bp"; a dash for none. */
export function fmtMove(x: number | null | undefined, unit: MoveUnit): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${pySigned(x, unit === "%" ? 1 : 0)}${unit === "%" ? "%" : " bp"}`;
}

/** An axis tick: a round number, unsigned at zero ("0.0%", "+5.0%"). */
export function fmtTick(x: number, unit: MoveUnit): string {
  return x === 0 ? (unit === "%" ? "0.0%" : "0") : fmtMove(x, unit).replace(" bp", "");
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

/** The engine's exclusion verdict, or its note when it gives none. */
export function exclusionWord(h: Pick<EventStudyHorizon, "exclusion" | "note">): string {
  return h.exclusion ?? h.note ?? "no verdict";
}

/** The same verdict in the client register: the engine's own categories, in
 * words. The engine judges the median against the baseline median, never a
 * range of outcomes, so the words say "differs from an ordinary stretch" and
 * "not distinguishable from an ordinary stretch" (verifier V-01). */
export const EXCLUSION_CLIENT: Record<Exclusion, string> = {
  established: "differs from an ordinary stretch",
  "not established": "difference not established",
  included: "not distinguishable from an ordinary stretch",
};

/** The short forms under a chart's horizons; the legend spells them out. */
export const EXCLUSION_CLIENT_SHORT: Record<Exclusion, string> = {
  established: "differs",
  "not established": "not established",
  included: "not distinguishable",
};

/** The events the response carries behind one cell: every carried event with a
 * complete window at `h`, narrowed to one regime when given. The engine serves
 * the last ten events, so a cell can have more events than the list holds. */
export function eventsBehind(events: EventStudyEvent[], h: number, regime?: string): EventStudyEvent[] {
  return events.filter((e) => e.forward[String(h)] != null && (regime == null || e.regime === regime));
}

/** Why a forward move is missing (review R-08, fourth round). "window open"
 * only when the event itself carries an explicit `window_open` flag for that
 * horizon; a horizon's `n_incomplete` counts every incomplete window across
 * all events, so it cannot say which one is still open. The engine does not
 * serve the per-event flag yet (deferred by decision, report §8), so today
 * every missing return reads "no observation". */
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

/** "Sample: {start} to {end}" under the sentence (§2): the start is where the
 * shock asset's and the target's histories both begin (the engine's
 * data_start, the later history_from), the end the newest session read. */
export function sampleLine(s: EventStudyResponse): string {
  return `Sample: ${s.provenance.data_start ?? s.provenance.sample_start} to ${s.provenance.sample_end}`;
}

/** Each input's history as the engine serves it, and where events become
 * evaluable, for the sample line's tooltip. */
export function historyLine(s: EventStudyResponse): string {
  const rows = s.provenance.inputs.map((i) => `${i.label}: history from ${i.history_from}${i.last ? `, last ${i.last}` : ""}`);
  const evaluable = `Events are evaluable from ${s.provenance.sample_start} to ${s.provenance.sample_end}.`;
  return rows.length ? `${rows.join("; ")}. ${evaluable}` : evaluable;
}
