/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) sections B.1.1
 * and E.1, `screens/credit/oas-window.test.ts`: the pure helpers behind the
 * hero OAS chart. `sliceWindow` cuts ten years before the LAST served point
 * (boundary month kept, wall clock ignored), `intersectByDate` pairs the two
 * series on their common dates only, `NBER_BANDS` are the three windows moved
 * verbatim from CreditScreen.tsx, `bandsInWindow` names the bands in view,
 * `bandList` joins their labels and `windowExtremes` reads the HY high and
 * IG low of the plotted points. Fixtures are a generated monthly history
 * ending Sep 2026 with the extremes planted on known months; nothing here is
 * a mockup figure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NBER_BANDS, bandList, bandsInWindow, intersectByDate, sliceWindow, windowExtremes } from "./oas-window";
import type { DatedValue } from "../../api/types";

/* ── fixtures ────────────────────────────────────────────────────────────── */

const FIRST = "1996-12-01";
const LAST = "2026-09-01";

/** Every month from `from` to `to` inclusive as ISO first-of-month dates. */
function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let idx = fy * 12 + (fm - 1); idx <= ty * 12 + (tm - 1); idx++) {
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`);
  }
  return out;
}
const ALL = monthsBetween(FIRST, LAST); // 358 monthly points
const WINDOW_10Y = monthsBetween("2016-09-01", LAST); // 121 points, boundary month kept

/** HY: a gentle drift with the all-time high planted in Nov 2008 and the in-window high in Mar 2020. */
const HY_HIGH_ALL = { date: "2008-11-01", value: 1985 };
const HY_HIGH_10Y = { date: "2020-03-01", value: 1080 };
/** IG: the all-time low in Jun 1997 (outside the ten-year window) and the in-window low in Jun 2021. */
const IG_LOW_ALL = { date: "1997-06-01", value: 55 };
const IG_LOW_10Y = { date: "2021-06-01", value: 83 };

const HY: DatedValue[] = ALL.map((date, i) => ({ date, value: 400 + (i % 7) * 3 }));
const IG: DatedValue[] = ALL.map((date, i) => ({ date, value: 130 + (i % 5) * 2 }));
for (const p of HY) {
  if (p.date === HY_HIGH_ALL.date) p.value = HY_HIGH_ALL.value;
  if (p.date === HY_HIGH_10Y.date) p.value = HY_HIGH_10Y.value;
}
for (const p of IG) {
  if (p.date === IG_LOW_ALL.date) p.value = IG_LOW_ALL.value;
  if (p.date === IG_LOW_10Y.date) p.value = IG_LOW_10Y.value;
}

afterEach(() => {
  vi.useRealTimers();
});

/* ── intersectByDate ─────────────────────────────────────────────────────── */

describe("intersectByDate (CreditScreen.tsx:245-251, moved)", () => {
  it("returns paired points on the common dates only, in the HY order, each carrying both values", () => {
    const hy: DatedValue[] = [
      { date: "2026-05-01", value: 310 },
      { date: "2026-06-01", value: 305 },
      { date: "2026-07-01", value: 302 },
      { date: "2026-08-01", value: 308 },
      { date: "2026-09-01", value: 312 },
    ];
    const ig: DatedValue[] = [
      { date: "2026-04-01", value: 99 }, // IG only
      { date: "2026-06-01", value: 96 },
      { date: "2026-07-01", value: 95 },
      { date: "2026-09-01", value: 94 },
    ];
    const out = intersectByDate(hy, ig);
    expect(out).toEqual([
      { date: "2026-06-01", hy: 305, ig: 96 },
      { date: "2026-07-01", hy: 302, ig: 95 },
      { date: "2026-09-01", hy: 312, ig: 94 },
    ]);
    expect(out.map((p) => p.date)).not.toContain("2026-04-01"); // IG-only month dropped
    expect(out.map((p) => p.date)).not.toContain("2026-05-01"); // HY-only month dropped
    expect(out.map((p) => p.date)).not.toContain("2026-08-01");
  });

  it("two full series on the same dates pair every point; disjoint or empty series pair nothing", () => {
    const all = intersectByDate(HY, IG);
    expect(all).toHaveLength(ALL.length);
    expect(all[0]).toEqual({ date: FIRST, hy: HY[0].value, ig: IG[0].value });
    expect(all[all.length - 1].date).toBe(LAST);
    expect(intersectByDate(HY, [])).toEqual([]);
    expect(intersectByDate([], IG)).toEqual([]);
    expect(intersectByDate(HY.slice(0, 12), IG.slice(24, 36))).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const hy = HY.slice(0, 6).map((p) => ({ ...p }));
    const ig = IG.slice(0, 6).map((p) => ({ ...p }));
    const before = JSON.stringify([hy, ig]);
    intersectByDate(hy, ig);
    expect(JSON.stringify([hy, ig])).toBe(before);
  });
});

/* ── sliceWindow ─────────────────────────────────────────────────────────── */

describe("sliceWindow (B.1.1: ten years before the last served point)", () => {
  it("keeps exactly the points within ten years of the last point, the boundary month included", () => {
    const out = sliceWindow(HY, 10);
    expect(out.map((p) => p.date)).toEqual(WINDOW_10Y);
    expect(out).toHaveLength(121);
    expect(out[0].date).toBe("2016-09-01");
    expect(out[out.length - 1].date).toBe(LAST);
    expect(out.map((p) => p.date)).not.toContain("2016-08-01");
  });

  it("measures the cut from the last served point, never from the wall clock", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-04-15T12:00:00Z")); // a stale DB read years later
    const later = sliceWindow(HY, 10);
    expect(later.map((p) => p.date)).toEqual(WINDOW_10Y);
    vi.setSystemTime(new Date("2019-01-15T12:00:00Z")); // or a clock behind the data
    expect(sliceWindow(HY, 10).map((p) => p.date)).toEqual(WINDOW_10Y);
    vi.useRealTimers();
    // A history ending earlier slides the whole window back with it.
    const stale = HY.filter((p) => p.date <= "2024-03-01");
    const out = sliceWindow(stale, 10);
    expect(out[0].date).toBe("2014-03-01");
    expect(out[out.length - 1].date).toBe("2024-03-01");
    expect(out).toHaveLength(121);
  });

  it("an explicit endIso equal to the last point gives the same window; other spans and short histories work", () => {
    expect(sliceWindow(HY, 10, LAST).map((p) => p.date)).toEqual(WINDOW_10Y);
    const two = sliceWindow(HY, 2);
    expect(two[0].date).toBe("2024-09-01");
    expect(two).toHaveLength(25);
    // A 36-month history is shorter than ten years: everything stays.
    const short = HY.slice(-36);
    expect(sliceWindow(short, 10)).toEqual(short);
    expect(sliceWindow([], 10)).toEqual([]);
  });

  it("is generic over the point shape and keeps the objects intact", () => {
    const paired = intersectByDate(HY, IG);
    const out = sliceWindow(paired, 10);
    expect(out).toHaveLength(121);
    expect(out[0]).toEqual({ date: "2016-09-01", hy: expect.any(Number), ig: expect.any(Number) });
    expect(out[out.length - 1]).toBe(paired[paired.length - 1]);
    // Longer ISO stamps slice by their date part.
    const stamped = HY.slice(-130).map((p) => ({ date: `${p.date}T00:00:00`, value: p.value }));
    const cut = sliceWindow(stamped, 10);
    expect(cut).toHaveLength(121);
    expect(cut[0].date.startsWith("2016-09-01")).toBe(true);
  });
});

/* ── NBER bands ──────────────────────────────────────────────────────────── */

describe("NBER_BANDS and bandsInWindow (CreditScreen.tsx:27-31, moved; U8)", () => {
  it("carries the three windows verbatim with their caption labels", () => {
    expect(NBER_BANDS).toEqual([
      { from: "2001-03-01", to: "2001-11-30", label: "2001" },
      { from: "2007-12-01", to: "2009-06-30", label: "2008–09" },
      { from: "2020-02-01", to: "2020-04-30", label: "2020" },
    ]);
    for (const b of NBER_BANDS) expect(b.label).not.toContain("—");
  });

  it("returns only the 2020 band for a 2016 to 2026 window and all three for the full history", () => {
    expect(bandsInWindow(NBER_BANDS, "2016-09-01", LAST).map((b) => b.label)).toEqual(["2020"]);
    expect(bandsInWindow(NBER_BANDS, FIRST, LAST).map((b) => b.label)).toEqual(["2001", "2008–09", "2020"]);
    expect(bandsInWindow(NBER_BANDS, "2021-01-01", LAST)).toEqual([]);
    expect(bandsInWindow([], FIRST, LAST)).toEqual([]);
  });

  it("a band that overlaps the window edge is in view, in NBER order", () => {
    // The window opens inside the 2007-09 recession: that band and 2020 are visible.
    expect(bandsInWindow(NBER_BANDS, "2009-01-01", LAST).map((b) => b.label)).toEqual(["2008–09", "2020"]);
    // A window that closes inside the 2001 recession shows only 2001.
    expect(bandsInWindow(NBER_BANDS, FIRST, "2001-06-01").map((b) => b.label)).toEqual(["2001"]);
  });
});

/* ── bandList ────────────────────────────────────────────────────────────── */

describe("bandList (the caption's band list)", () => {
  it("renders one label plain, two with and, three with the comma and the and", () => {
    expect(bandList(["2020"])).toBe("2020");
    expect(bandList(["2008–09", "2020"])).toBe("2008–09 and 2020");
    expect(bandList(["2001", "2008–09", "2020"])).toBe("2001, 2008–09 and 2020");
    expect(bandList(NBER_BANDS.map((b) => b.label))).toBe("2001, 2008–09 and 2020");
    expect(bandList(bandsInWindow(NBER_BANDS, "2016-09-01", LAST).map((b) => b.label))).toBe("2020");
  });

  it("never prints an em-dash or an Oxford comma before the and", () => {
    const three = bandList(["2001", "2008–09", "2020"]);
    expect(three).not.toContain("—");
    expect(three).not.toContain(", and");
  });
});

/* ── windowExtremes ──────────────────────────────────────────────────────── */

describe("windowExtremes (the mono range line under the hero chart)", () => {
  it("names the HY high and the IG low of the plotted points with their months, plus the first and last dates", () => {
    const all = windowExtremes(intersectByDate(HY, IG));
    expect(all).not.toBeNull();
    expect(all?.first).toBe(FIRST);
    expect(all?.last).toBe(LAST);
    expect(all?.hyHigh).toEqual(HY_HIGH_ALL);
    expect(all?.igLow).toEqual(IG_LOW_ALL);
  });

  it("reads the plotted window only: the ten-year slice has its own high and low", () => {
    const ten = windowExtremes(sliceWindow(intersectByDate(HY, IG), 10));
    expect(ten?.first).toBe("2016-09-01");
    expect(ten?.last).toBe(LAST);
    expect(ten?.hyHigh).toEqual(HY_HIGH_10Y);
    expect(ten?.igLow).toEqual(IG_LOW_10Y);
    expect(ten?.hyHigh.value).not.toBe(HY_HIGH_ALL.value);
    expect(ten?.igLow.value).not.toBe(IG_LOW_ALL.value);
  });

  it("returns null for no points and handles a single point", () => {
    expect(windowExtremes([])).toBeNull();
    const one = windowExtremes([{ date: LAST, hy: 312, ig: 94 }]);
    expect(one).toEqual({ hyHigh: { value: 312, date: LAST }, igLow: { value: 94, date: LAST }, first: LAST, last: LAST });
  });
});
