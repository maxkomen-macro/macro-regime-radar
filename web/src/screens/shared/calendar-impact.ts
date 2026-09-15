/**
 * Calendar impact vocabulary and ET calendar-day helpers (redesign Phase 8,
 * checklist 08 A.6): lifted verbatim from dashboard/MacroCalendarCard.tsx so
 * the Dashboard card and the News screen paint impact from one table, plus
 * the ET day arithmetic the News hero, timeline and calendar groups share.
 * Every helper is pure; stamps are the stored UTC "YYYY-MM-DDTHH:MM:SSZ".
 */
import { fmtUtcStampEt } from "../../lib/format";

export interface Impact {
  /** Colour token for the dot. */
  color: string;
  /** The word the row carries for assistive tech and the dot's title. */
  word: string;
}

export const IMPACT: Record<string, Impact> = {
  high: { color: "var(--amber)", word: "high impact" },
  medium: { color: "var(--cyan)", word: "medium impact" },
  low: { color: "var(--text-4)", word: "low impact" },
};

/** Served values are "high" | "medium" | "low" (src/migrate.py); anything
 * else, including null, reads as the gray dot with an honest word. */
export function impactOf(importance: string | null | undefined): Impact {
  return IMPACT[(importance ?? "").toLowerCase()] ?? { color: "var(--text-4)", word: "impact not rated" };
}

/** ["Sep 11", "08:30 ET"] from a stored UTC stamp. */
export function splitStamp(ts: string): [string, string] {
  const stamp = fmtUtcStampEt(ts);
  const comma = stamp.indexOf(", ");
  return comma >= 0 ? [stamp.slice(0, comma), stamp.slice(comma + 2)] : [stamp, ""];
}

const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const ET_WEEKDAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" });

/** The ET calendar day of a stamp as "YYYY-MM-DD" (a 03:30Z stamp lands on the previous ET day). */
export function dayKeyEt(ts: string | number | Date): string {
  return ET_DAY.format(new Date(ts));
}

/** The ET weekday of a stamp, "Mon" … "Sun". */
export function weekdayEt(ts: string | number | Date): string {
  return ET_WEEKDAY.format(new Date(ts));
}

/** Whole ET calendar days from `now` to `ts` (0 today, 1 tomorrow, -1 yesterday); DST-safe because both sides are calendar days. */
export function dayDeltaEt(ts: string | number | Date, now: string | number | Date): number {
  const toUtcDay = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcDay(dayKeyEt(ts)) - toUtcDay(dayKeyEt(now))) / 86_400_000);
}
