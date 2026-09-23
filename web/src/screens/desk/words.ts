/**
 * Numbers as words for the client view (docs/desk/DESK_FRAME_SPEC.md §4):
 * "about six times in ten" in place of a 0.61 hit rate. Calibrated: the
 * words never say always, never, certain or guaranteed (the same list the
 * Position Monitor's language check flags), and every rounding is stated as
 * "about". Pure, no React.
 */

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"] as const;

/** A share in [0, 1] as "about N times in ten"; the tails read "fewer than
 * one time in twenty" and "more than nineteen times in twenty". */
export function timesInTen(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "no reading";
  const x = Math.min(1, Math.max(0, p));
  if (x < 0.05) return "fewer than one time in twenty";
  if (x > 0.95) return "more than nineteen times in twenty";
  const n = Math.round(x * 10);
  if (n === 5) return "about half the time";
  return `about ${ONES[n]} times in ten`;
}

/** A probability as "about N in ten" odds, for a regime or recession read. */
export function oddsInWords(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "no reading";
  const x = Math.min(1, Math.max(0, p));
  if (x < 0.05) return "under one in twenty";
  if (x > 0.95) return "over nineteen in twenty";
  const n = Math.round(x * 10);
  if (n === 5) return "about even";
  return `about ${ONES[n]} in ten`;
}

/** A size in words: "small", "modest", "sizeable", "large" from |x| against
 * the thresholds (unit-specific, passed in) so the vocabulary stays closed. */
export function magnitudeWord(x: number, steps: [small: number, modest: number, sizeable: number]): string {
  const a = Math.abs(x);
  if (a < steps[0]) return "small";
  if (a < steps[1]) return "modest";
  if (a < steps[2]) return "sizeable";
  return "large";
}

/** A signed move as a sentence fragment: "a modest gain of about 1.4%",
 * "a small loss of about 12 bp", "roughly flat". `unit` is printed as is. */
export function moveInWords(x: number | null | undefined, unit: "%" | "bp", dp = unit === "%" ? 1 : 0, plain = false): string {
  if (x == null || !Number.isFinite(x)) return "no reading";
  const steps: [number, number, number] = unit === "%" ? [0.75, 2, 5] : [5, 15, 40];
  if (Math.abs(x) < steps[0] / 2) return "roughly flat";
  const word = magnitudeWord(x, steps);
  const dir = x > 0 ? (unit === "%" ? "gain" : "rise") : unit === "%" ? "loss" : "fall";
  const value = `${Math.abs(x).toFixed(dp)}${unit === "%" ? "%" : " bp"}`;
  // `plain` drops the size word: where the engine grades an effect itself
  // (its verdict's "modest"), the client words must not grade it again.
  return plain ? `a ${dir} of about ${value}` : `a ${word} ${dir} of about ${value}`;
}

/** "N sessions": digits, one session singular, so a column of horizons reads evenly. */
export function sessionsInWords(h: number): string {
  return h === 1 ? "one session" : `${h} sessions`;
}

/** "5, 10 and 20": a list of horizons in reader order. */
export function listWords(items: readonly (string | number)[]): string {
  const xs = items.map(String);
  if (xs.length <= 1) return xs.join("");
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

interface ClientHorizon {
  h: number;
  median: number | null;
  baseline_median: number | null;
  delta: number | null;
  exclusion: "established" | "not established" | "included" | null;
}

interface ClientStudy {
  target: { label: string };
  horizons: ClientHorizon[];
  regime_split: { regime: string; excluded_from_totals: boolean; by_horizon: Record<string, { median: number | null }> }[];
  provenance: { sample_start: string; sample_end: string; data_start?: string | null };
}

/**
 * The engine's verdict in the client register (DESK_FRAME2_SPEC §5): its
 * claims are the engine's per-horizon exclusion verdicts, never more; the
 * numbers print as words (moveInWords), and the working detail (n, blocks,
 * intervals, the bootstrap) stays out. A horizon the engine established
 * reads its direction from the served Δ's sign; an included one reads "not
 * distinguishable from an ordinary stretch", the engine's own phrase. Pure.
 */
export function clientVerdict(s: ClientStudy, unit: "%" | "bp"): string[] {
  const out: string[] = [];
  const by = (e: ClientHorizon["exclusion"]) => s.horizons.filter((h) => h.exclusion === e);
  for (const h of by("established")) {
    const dir = h.delta != null && h.delta < 0 ? "lower" : "higher";
    out.push(`Over ${sessionsInWords(h.h)}, the ${s.target.label} ran ${dir} than usual after these events: ${moveInWords(h.median, unit, undefined, true)}, against ${moveInWords(h.baseline_median, unit, undefined, true)} over an ordinary ${h.h}-session stretch.`);
  }
  const included = by("included");
  if (included.length)
    out.push(`Over ${listWords(included.map((h) => h.h))} sessions, ${out.length ? "its" : `the ${s.target.label}'s`} moves after these events were not distinguishable from an ordinary stretch of the same length.`);
  const notEst = by("not established");
  if (notEst.length) out.push(`Over ${listWords(notEst.map((h) => h.h))} sessions, a difference shows in the sample but is not established.`);
  const none = by(null);
  if (none.length) out.push(`Over ${listWords(none.map((h) => h.h))} sessions, there are too few separate episodes to judge.`);
  const labelled = s.regime_split.filter((r) => !r.excluded_from_totals);
  const readable = labelled.filter((r) => r.by_horizon["20"]?.median != null).map((r) => r.regime);
  out.push(
    readable.length === 0
      ? "No single regime has enough episodes to read on its own."
      : readable.length === 1
        ? `Only ${readable[0]} has enough episodes to read on its own, so the regimes cannot be ranked.`
        : `${listWords(readable)} have enough episodes to read on their own.`,
  );
  out.push(`The record runs from ${(s.provenance.data_start ?? s.provenance.sample_start).slice(0, 4)} to ${s.provenance.sample_end.slice(0, 4)}.`);
  return out;
}
