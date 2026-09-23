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

/** The 90% interval on Δ as served: "−1.6% to +4.1%". */
export function fmtInterval(ci: [number, number] | null, unit: MoveUnit): string | null {
  return ci ? `${fmtMove(ci[0], unit)} to ${fmtMove(ci[1], unit)}` : null;
}

/** The engine's exclusion verdict, or its note when it gives none. */
export function exclusionWord(h: Pick<EventStudyHorizon, "exclusion" | "note">): string {
  return h.exclusion ?? h.note ?? "no verdict";
}

/** The same verdict in the client register: the engine's own category, in words. */
export const EXCLUSION_CLIENT: Record<Exclusion, string> = {
  established: "clear of the usual range",
  "not established": "difference not established",
  included: "within the usual range",
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
  return `n ${p.n_events} · blocks ${blocks} · sample ${p.sample_start}–${p.sample_end} · cooldown ${cooldown} · entry ${entry}`;
}

/** "Sample: {start} to {end}" under the sentence, from the response. */
export function sampleLine(s: EventStudyResponse): string {
  return `Sample: ${s.provenance.sample_start} to ${s.provenance.sample_end}`;
}

/** Each input's history as the engine serves it, for the sample line's tooltip. */
export function historyLine(s: EventStudyResponse): string {
  const rows = s.provenance.inputs.map((i) => `${i.label}: history from ${i.history_from}${i.last ? `, last ${i.last}` : ""}`);
  return rows.length ? `${rows.join("; ")}.` : "The engine lists no inputs for this study.";
}
