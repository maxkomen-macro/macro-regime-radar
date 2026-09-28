/**
 * Desk v2 number and date formatting (DESK_FRAME3_SPEC §1.2, §1.5). Pure.
 * Negative numbers carry a true minus (U+2212), as the mockups print them;
 * fractions arrive as fractions (0.031) and leave as percents ("+3.1%").
 * Nothing here computes a statistic: it only spells served numbers.
 *
 * A number that is not finite (null, undefined, NaN, a string) never prints
 * as a number: the formatters return "—" (Codex R-01; `Math.abs(null)` is 0,
 * so an unchecked null used to print "0.0%"). The pages check first and say
 * "Awaiting refresh" under the stat's label; "—" is the floor under that.
 */

import type { Verdict } from "../data/types";

export const MINUS = "−";

/** What a formatter prints for a value that is not a finite number. */
export const NOT_SERVED = "—";

/** A served statistic that can be printed. */
export const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** A number with a sign: "+2.7", "−0.4", "0.0" for a rounded zero. */
export function signed(x: number, digits = 1): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const s = Math.abs(x).toFixed(digits);
  if (Number(s) === 0) return s;
  return `${x < 0 ? MINUS : "+"}${s}`;
}

/** A number without a forced plus: "16.2", "−0.24". */
export function num(x: number, digits = 1): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const s = Math.abs(x).toFixed(digits);
  return Number(s) === 0 || x >= 0 ? s : `${MINUS}${s}`;
}

/** A fraction as a signed percent: 0.031 → "+3.1%". */
export function pct(frac: number, digits = 1): string {
  return isFiniteNumber(frac) ? `${signed(frac * 100, digits)}%` : NOT_SERVED;
}

/** A fraction as an unsigned percent: 0.68 → "68%". */
export function pctPlain(frac: number, digits = 0): string {
  return isFiniteNumber(frac) ? `${num(frac * 100, digits)}%` : NOT_SERVED;
}

/** Points, signed: 1.4 → "+1.4 pts". */
export function pts(x: number, digits = 1): string {
  return isFiniteNumber(x) ? `${signed(x, digits)} pts` : NOT_SERVED;
}

/** Thousands with a comma: 6412 → "6,412". */
export function grouped(x: number, digits = 0): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  const s = x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return s.startsWith("-") ? `${MINUS}${s.slice(1)}` : s;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** An ISO day or month, or null for anything else (a missing or malformed
 * stamp prints nothing rather than taking the tab down, verifier V-5). */
function parts(iso: string | null | undefined): { y: number; m: number; d: number | null } | null {
  const m = typeof iso === "string" ? /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso) : null;
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: m[3] ? Number(m[3]) : null };
}

/** "2026-09-22" → "Sep 22"; "" for no day. */
export function dayShort(iso: string | null | undefined): string {
  const p = parts(iso);
  return p && p.d ? `${MONTHS[p.m - 1]} ${p.d}` : "";
}

/** "2025-07-01" → "Jul 1, 2025"; "" for no day. */
export function dayLong(iso: string | null | undefined): string {
  const p = parts(iso);
  return p && p.d ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : "";
}

/** "2026-05" or "2026-05-14" → "May". */
export function monthShort(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? MONTHS[p.m - 1] : "";
}

/** "2026-06" → "June". */
export function monthLong(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? MONTHS_LONG[p.m - 1] : "";
}

/** "2025-07-01" → "Jul 2025". */
export function monthYear(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : "";
}

/** "2025-07-01" → "2025". */
export function year(iso: string | null | undefined): string {
  const p = parts(iso);
  return p ? String(p.y) : "";
}

/** "2026-09-22T00:23:00Z" → "00:23 UTC"; "" for a malformed stamp. */
export function utcTime(iso: string | null | undefined): string {
  const d = new Date(iso ?? "");
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC`;
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const ORDINALS = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth"];

/** 6 → "six"; beyond twelve the digits. */
export function numberWord(n: number): string {
  return WORDS[n] ?? String(n);
}

/** 3 → "third"; beyond twelfth "13th". */
export function ordinalWord(n: number): string {
  return ORDINALS[n] ?? `${n}th`;
}

/** 74 → "74th", 1 → "1st", 22 → "22nd". */
export function ordinal(n: number): string {
  const r100 = n % 100;
  const suffix = r100 >= 11 && r100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** "Jul row": the stored regime row a label comes from (§5: the K−2 row governing today). */
export function rowWords(print: string | null | undefined): string {
  return monthShort(print) ? `${monthShort(print)} row` : "";
}

/** The recession score's band in words (§5, v3 §11): "Low", "Elevated", "High risk"; "" when not served. */
export const BAND_WORD: Record<string, string> = { low: "Low", elevated: "Elevated", high_risk: "High risk" };
export const bandWord = (b: string | null | undefined): string => (b && Object.prototype.hasOwnProperty.call(BAND_WORD, b) ? BAND_WORD[b] : "");

export function capitalize(s: string | null | undefined): string {
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export const VERDICT_LABEL: Record<Verdict, string> = { reliable: "Reliable", suggestive: "Suggestive", no_edge: "No edge", insufficient: "Too few" };

/** The Ledger's verdict order (§12.4): Reliable, Suggestive, No edge (then too few to score). */
export const VERDICT_RANK: Record<Verdict, number> = { reliable: 0, suggestive: 1, no_edge: 2, insufficient: 3 };

/** "verdict rule v1 at 90%" from a served rule and its fixed level (§4, §1.5); null when either was not served. */
export function verdictRuleWords(s: { verdict_rule?: string | null; verdict_confidence?: number | null }): string | null {
  return typeof s.verdict_rule === "string" && s.verdict_rule && isFiniteNumber(s.verdict_confidence) ? `verdict rule ${s.verdict_rule} at ${Math.round(s.verdict_confidence * 100)}%` : null;
}

/** A signed value's tone: up green, down red, zero neutral (§1.3). */
export function toneOf(x: number): "up" | "down" | "flat" {
  return x > 0 ? "up" : x < 0 ? "down" : "flat";
}

/** Today's date in New York, where the S&P closes ("2026-09-24"). */
export function nyToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** A chart's right-end caption (D13): "today" only when the served day is today in New York, else the day ("Sep 22"). */
export function endDay(date: string | undefined | null, today = nyToday()): string {
  if (!date) return "latest";
  return date === today ? "today" : dayShort(date);
}

/** Codex R-01: the sectors a leadership ranking leaves out, and the words that say so. `missing` as served
 * (§12.14), else the rows served without a return; `ranked` the served count, else the rows with one. */
export function leadershipGaps(s: { leadership?: { etf: string; name: string; rel_ret: number | null; reason?: string | null }[]; ranked_n?: number; missing?: { etf: string; name: string; reason: string }[] } | undefined): {
  ranked: number;
  missing: { etf: string; name: string; reason: string }[];
  among: string;
  note: string;
} {
  const rows = Array.isArray(s?.leadership) ? s.leadership : [];
  const missing = Array.isArray(s?.missing)
    ? s.missing
    : rows.filter((r) => !isFiniteNumber(r.rel_ret)).map((r) => ({ etf: r.etf, name: r.name, reason: r.reason ?? "not served" }));
  const ranked = isFiniteNumber(s?.ranked_n) ? s.ranked_n : rows.filter((r) => isFiniteNumber(r.rel_ret)).length;
  if (!missing.length) return { ranked, missing, among: "", note: "" };
  return {
    ranked,
    missing,
    among: `among the ${ranked} sectors with data`,
    note: `Not ranked, without data over the window: ${missing.map((m) => `${m.etf} ${m.name} (${m.reason})`).join("; ")}.`,
  };
}
