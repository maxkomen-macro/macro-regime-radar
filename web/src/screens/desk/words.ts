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
export function moveInWords(x: number | null | undefined, unit: "%" | "bp", dp = unit === "%" ? 1 : 0): string {
  if (x == null || !Number.isFinite(x)) return "no reading";
  const steps: [number, number, number] = unit === "%" ? [0.75, 2, 5] : [5, 15, 40];
  if (Math.abs(x) < steps[0] / 2) return "roughly flat";
  const word = magnitudeWord(x, steps);
  const dir = x > 0 ? (unit === "%" ? "gain" : "rise") : unit === "%" ? "loss" : "fall";
  const value = `${Math.abs(x).toFixed(dp)}${unit === "%" ? "%" : " bp"}`;
  return `a ${word} ${dir} of about ${value}`;
}

/** "N sessions": digits, one session singular, so a column of horizons reads evenly. */
export function sessionsInWords(h: number): string {
  return h === 1 ? "one session" : `${h} sessions`;
}
