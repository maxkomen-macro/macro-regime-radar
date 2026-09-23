/**
 * Formatting for the event-study panels (DESK_FRAME2_SPEC §1: numbers come
 * only from the response, no client-side arithmetic beyond formatting). Every
 * function here takes a served value and prints it; none derives a new one.
 * Pure, no React.
 */

import type { EventStudyEvent, EventStudyHorizon, EventStudyResponse, Exclusion, ShockUnit } from "../../../api/desk";
import { fmtWholePct } from "../../../lib/format";

export type MoveUnit = "%" | "bp";

export function unitWord(u: ShockUnit): MoveUnit {
  return u === "bp" ? "bp" : "%";
}

/** A signed move in its unit: "+1.6%", "−12 bp"; a dash for no reading. */
export function fmtMove(x: number | null | undefined, unit: MoveUnit): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const dp = unit === "%" ? 1 : 0;
  const body = Math.abs(x).toFixed(dp);
  const sign = Number(body) === 0 ? "" : x > 0 ? "+" : "−";
  return `${sign}${body}${unit === "%" ? "%" : " bp"}`;
}

export function fmtShare(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? "—" : fmtWholePct(x);
}

/** One interval bound at display precision, rounded outward (the low bound
 * down, the high bound up) as the engine rounds its own bounds, so the printed
 * interval always contains the served one and a bound just below zero never
 * prints as 0.0 (verifier V-02). Rounding is the only thing done to it. */
export function fmtBound(x: number, unit: MoveUnit, side: "low" | "high"): string {
  const k = unit === "%" ? 10 : 1;
  const r = side === "low" ? Math.floor(x * k + 1e-9) / k : Math.ceil(x * k - 1e-9) / k;
  if (r === 0) return side === "low" && x < 0 ? (unit === "%" ? "−0.0%" : "−0 bp") : fmtMove(0, unit);
  return fmtMove(r, unit);
}

/** The 90% interval on Δ as served, bounds rounded outward: "−1.7% to +4.1%". */
export function fmtInterval(ci: [number, number] | null, unit: MoveUnit): string | null {
  return ci ? `${fmtBound(ci[0], unit, "low")} to ${fmtBound(ci[1], unit, "high")}` : null;
}

/** A z-score with a true minus sign. */
export function fmtZ(z: number | null | undefined): string {
  return z == null || !Number.isFinite(z) ? "—" : `${z < 0 ? "−" : ""}${Math.abs(z).toFixed(2)}`;
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
