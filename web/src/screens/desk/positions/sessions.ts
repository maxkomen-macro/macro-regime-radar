/**
 * XNYS sessions for a position's day count (DESK_FRAME3_SPEC §9: `day`
 * counts the entry session as 1 on XNYS). The holiday table is the published
 * NYSE schedule `api/calendar.py` keeps, pinned to it by sessions.test.ts; a
 * year the table does not list gives no count, never a weekends-only guess.
 * Pure.
 */

const HOLIDAYS: Readonly<Record<number, readonly string[]>> = {
  2024: ["2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25"],
  2025: ["2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25"],
  2026: ["2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25"],
  2027: ["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"],
};

/** The table, for the parity test. */
export const XNYS_HOLIDAYS = HOLIDAYS;

const DAY_MS = 86_400_000;

/** A calendar date ("2026-09-22") as UTC midnight, or null when it is not a real date. */
function utcDay(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : d;
}

/** Whether a string is a real calendar date ("2026-02-30" is not). */
export const isCalendarDate = (s: unknown): s is string => typeof s === "string" && utcDay(s) !== null;

/** The New York calendar date of an instant: the session day a close belongs to. */
export function nyDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Whether a date is an XNYS session; null for a year the table does not list. */
export function isSession(day: string): boolean | null {
  const d = utcDay(day);
  const list = d ? HOLIDAYS[d.getUTCFullYear()] : undefined;
  if (!d || !list) return null;
  const wd = d.getUTCDay();
  return wd !== 0 && wd !== 6 && !list.includes(day);
}

/** The sessions from `from` through `to`, both counted, so the entry session is 1; 0 when no
 * session has opened since `from`; null when a year between them is not in the table. */
export function sessionCount(from: string, to: string): number | null {
  const a = utcDay(from);
  const b = utcDay(to);
  if (!a || !b) return null;
  let n = 0;
  for (let t = a.getTime(); t <= b.getTime(); t += DAY_MS) {
    const s = isSession(new Date(t).toISOString().slice(0, 10));
    if (s === null) return null;
    if (s) n += 1;
  }
  return n;
}
