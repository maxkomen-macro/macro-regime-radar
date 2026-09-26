/** XNYS sessions for a position's day count (§9: the entry session is day 1), pinned to api/calendar.py's holiday table. */
import { describe, expect, it } from "vitest";
import { XNYS_HOLIDAYS, isCalendarDate, isSession, nyDate, sessionCount } from "./sessions";

const CALENDAR = Object.values(import.meta.glob<string>("../../../../../api/calendar.py", { query: "?raw", import: "default", eager: true }))[0];

describe("the session calendar", () => {
  it("holds api/calendar.py's NYSE holidays, year for year", () => {
    expect(CALENDAR, "api/calendar.py").toBeTruthy();
    const block = /HOLIDAYS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(CALENDAR)?.[1] ?? "";
    const years: Record<number, string[]> = {};
    for (const m of block.matchAll(/(\d{4}):\s*\{([^}]*)\}/g)) {
      years[Number(m[1])] = [...m[2].matchAll(/date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/g)].map((d) => `${d[1]}-${d[2].padStart(2, "0")}-${d[3].padStart(2, "0")}`).sort();
    }
    expect(Object.keys(years).length).toBeGreaterThan(0);
    expect(Object.fromEntries(Object.entries(XNYS_HOLIDAYS).map(([y, list]) => [y, [...list].sort()]))).toEqual(years);
  });
  it("counts the entry session as 1, skips weekends and holidays, and says nothing past the table", () => {
    expect(isSession("2026-09-07")).toBe(false); // Labor Day
    expect(isSession("2026-09-05")).toBe(false); // Saturday
    expect(isSession("2026-09-08")).toBe(true);
    expect(sessionCount("2026-09-02", "2026-09-02")).toBe(1);
    // Sep 2–22: 15 weekdays, Labor Day off.
    expect(sessionCount("2026-09-02", "2026-09-22")).toBe(14);
    // Saved on a Saturday: no session has opened yet.
    expect(sessionCount("2026-09-19", "2026-09-20")).toBe(0);
    expect(sessionCount("2026-09-19", "2026-09-21")).toBe(1);
    expect(sessionCount("2027-12-30", "2028-01-03")).toBeNull();
    expect(sessionCount("2026-02-30", "2026-03-02")).toBeNull();
  });
  it("dates an instant in New York, where a close belongs", () => {
    expect(nyDate(new Date("2026-09-23T02:30:00Z"))).toBe("2026-09-22");
    expect(nyDate(new Date("2026-09-22T13:30:00Z"))).toBe("2026-09-22");
    expect(isCalendarDate("2026-09-22")).toBe(true);
    expect(isCalendarDate("2026-9-22")).toBe(false);
  });
});
