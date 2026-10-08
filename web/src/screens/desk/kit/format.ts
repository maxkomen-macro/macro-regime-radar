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

import { roundHalfUp } from "../../../lib/format";
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

/** The classifier's odds as a whole percent, under the app's one rule (half
 * up on the stored decimal, lib/format roundHalfUp; fix/site-audit D1): 0.425
 * → "43%", as the Dashboard, the Regime Lab and Tools print the same row. */
export function oddsPct(frac: number): string {
  return isFiniteNumber(frac) ? `${roundHalfUp(frac, 2)}%` : NOT_SERVED;
}

/** A fraction as an unsigned percent: 0.68 → "68%". */
export function pctPlain(frac: number, digits = 0): string {
  return isFiniteNumber(frac) ? `${num(frac * 100, digits)}%` : NOT_SERVED;
}

/** The options card's sentence on its 25-delta skew, illustrative or served: "Puts are 6.8 vol points richer than
 * calls.", "cheaper" below zero (desk/pdf-polish 3a and its follow-up: the same words in both states). */
export function putsVsCalls(skewPts: number): string {
  if (!isFiniteNumber(skewPts)) return NOT_SERVED;
  return `Puts are ${num(Math.abs(skewPts))} vol points ${skewPts < 0 ? "cheaper" : "richer"} than calls.`;
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

/**
 * A price at the precision its size needs (Codex R-02): an index (the S&P 500, §3) is whole and grouped;
 * a stock or ETF has two decimals, and four below 1, so 0.40 reads "0.4000", never "0".
 */
export function priceText(x: number, index = false): string {
  if (!isFiniteNumber(x)) return NOT_SERVED;
  return grouped(x, index ? 0 : Math.abs(x) < 1 ? 4 : 2);
}

/** An axis tick with the decimals its step needs (a 0.05 step prints 0.35, 0.40; a 1,000 step prints 7,000). */
export function tickText(v: number, ticks: readonly number[]): string {
  const step = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0;
  const s = step > 0 && step < 1e6 ? String(Number(step.toFixed(10))) : "0";
  const digits = s.includes(".") ? Math.min(6, s.split(".")[1].length) : 0;
  return grouped(v, digits);
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

const NY_CLOCK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

/** A stamp's New York date and 12-hour clock, or null for a malformed one. */
function nyClock(iso: string | null | undefined): { y: number; m: number; d: number; clock: string } | null {
  const at = new Date(iso ?? "");
  if (Number.isNaN(at.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of NY_CLOCK.formatToParts(at)) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), clock: `${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()}` };
}

/** "2026-10-01T17:27:07Z" → "1:27 PM ET" (desk/pdf-polish item 2b: every Desk time in New York time, EDT or EST
 * as the date falls); "" for a malformed stamp. */
export function etTime(iso: string | null | undefined): string {
  const c = nyClock(iso);
  return c ? `${c.clock} ET` : "";
}

/** "2026-09-22T00:23:00Z" → "Sep 21, 8:23 PM ET": the New York day and clock (the day can be the UTC day before). */
export function etDayTime(iso: string | null | undefined): string {
  const c = nyClock(iso);
  return c ? `${MONTHS[c.m - 1]} ${c.d}, ${c.clock} ET` : "";
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

/** "Aug 2026 data": the month of the stored regime row a label comes from (fix/freshness 3a, D2: the
 * newest stored row, said with its year as the Dashboard says it); desk/usability §14.13: said as the
 * month's data, never as a table's "row". */
export function rowWords(print: string | null | undefined): string {
  return monthYear(print) ? `${monthYear(print)} data` : "";
}

/** fix/freshness 3a (D2): the one line wherever the Desk tags events with a regime. The label shown as today's is
 * the newest stored row's (the Dashboard's); an event carries the label known when it happened (the engine's K−2). */
export const REGIME_TAGGED_LINE = "Events are tagged with the label known at the time: a month's print governs two months later.";

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

/* ── A signal's firing words (fix/site-audit S-01) ───────────────────────
 * A study's firing state is the state on `evaluated_on`, its last evaluable
 * session. After the bell the close's grace (D4) keeps the previous session
 * standing until the evening refresh stores today's close, so the state can be
 * yesterday's: "today" and "now" are said only when the evaluated session is
 * New York's today (the Technicals price card's rule, `endDay`), else the
 * session's own day ("Fired Oct 6"). */

type FiringRow = { firing_now?: boolean | null; firing_day?: number | null; stale?: boolean | null; evaluated_on?: string | null };

const onToday = (r: FiringRow, today: string) => typeof r.evaluated_on === "string" && r.evaluated_on === today;

/** The Ledger's Latest cell (fix/site-audit D-d; headed NOW before): "● Firing · day 3" / "○ Quiet" for today's session, "● Fired Oct 6 · day 3" /
 * "○ Quiet · Oct 6" for an earlier one, "○ Stale · Oct 6", "—" when the state is not served. */
export function firingCell(r: FiringRow, today = nyToday()): string {
  if (r.firing_now == null || r.stale == null) return NOT_SERVED;
  const day = dayShort(r.evaluated_on);
  if (r.stale) return `○ Stale · ${day || NOT_SERVED}`;
  const n = isFiniteNumber(r.firing_day) ? ` · day ${r.firing_day}` : "";
  const now = onToday(r, today) || !day;
  if (r.firing_now) return now ? `● Firing${n}` : `● Fired ${day}${n}`;
  return now ? "○ Quiet" : `○ Quiet · ${day}`;
}

/** The Event Study pill: "● Firing today · day 3" or "● Fired Oct 6 · day 3", "○ Not firing today" or
 * "○ Not firing on Oct 6" (with "· last <day>"), "○ Stale · Oct 6, 2026"; null when the state is not served. */
export function firingPill(r: FiringRow, today = nyToday(), lastEvent?: string | null): string | null {
  if (r.firing_now == null || r.stale == null) return null;
  if (r.stale) return `○ Stale · ${dayLong(r.evaluated_on) || NOT_SERVED}`;
  const day = dayShort(r.evaluated_on);
  const last = dayLong(lastEvent) ? ` · last ${dayLong(lastEvent)}` : "";
  if (r.firing_now) {
    const n = isFiniteNumber(r.firing_day) ? ` · day ${r.firing_day}` : "";
    return onToday(r, today) ? `● Firing today${n}` : day ? `● Fired ${day}${n}` : `● Firing${n}`;
  }
  return onToday(r, today) ? `○ Not firing today${last}` : day ? `○ Not firing on ${day}${last}` : `○ Not firing${last}`;
}

/** A count of firing signals says "Firing now" only when every current (served, not stale) signal was
 * evaluated on today's session, and there is at least one (with none, nothing was read today); otherwise
 * "Firing", each row carrying its own day. */
export function firingNowLabel(rows: readonly FiringRow[], today = nyToday()): string {
  const current = rows.filter((r) => r.firing_now != null && r.stale === false);
  return current.length > 0 && current.every((r) => onToday(r, today)) ? "Firing now" : "Firing";
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
