/**
 * fix/freshness 7: the one VIX reading the Dashboard card and the Desk tile both show. The tape's quote and its
 * stamp win; without one, the stored close labeled by its true observation date (the month only when no true
 * date is known); the band and the gap are computed against the value shown.
 */
import { describe, expect, it } from "vitest";
import { asOfCell } from "../markets/tape";
import { VIX_BAND_EDGES, storedVixFromFred, vixBand, vixShown } from "./vix-shown";

const QUOTE = { s: "VIX", p: 26.4, dc: 3.1, dd: 0.8, t: Date.UTC(2026, 9, 1, 14, 15), delayed: true, src: "rest" as const };

describe("vixShown", () => {
  it("the tape's quote: its number, its exact stamp, the band and the gap against it", () => {
    const v = vixShown({ vix: 16.04, date: "2026-09-29", gap: { date: "2026-09-29", realized_21d: 10.8 } }, QUOTE)!;
    expect([v.source, v.text, v.stamp, v.date, v.band]).toEqual(["quote", "26.40", asOfCell(QUOTE).text, "2026-10-01", "stressed"]);
    expect(v.stamp).toBe("Oct 01, 10:15 ET · 15m");
    expect(v.gapPts).toBeCloseTo(26.4 - 10.8, 10);
  });
  it("no quote: the stored close by its true date, the band from the close", () => {
    const v = vixShown({ vix: 16.04, date: "2026-09-29" }, undefined)!;
    expect([v.source, v.text, v.stamp, v.band, v.gapPts]).toEqual(["close", "16.04", "Close · Sep 29", "subdued", null]);
    expect(vixShown({ vix: 16.04, date: "2026-09-01", monthOnly: true }, undefined)?.stamp).toBe("Close · Sep 2026");
    expect(vixShown(null, undefined)).toBeNull();
    expect(vixShown({ vix: null, date: "2026-09-29" }, { ...QUOTE, p: Number.NaN })).toBeNull();
  });
  it("the band edges are the served ones when given, else 15 / 25", () => {
    expect(VIX_BAND_EDGES).toEqual([15, 25]);
    expect([vixBand(14.99), vixBand(15), vixBand(24.99), vixBand(25)]).toEqual(["calm", "subdued", "subdued", "stressed"]);
    expect(vixShown({ vix: 18, date: "2026-09-29", band_edges: [20, 30] }, undefined)?.band).toBe("calm");
  });
});

describe("storedVixFromFred: the Dashboard's FRED close, never dated by its month stamp", () => {
  const ROW = { date: "2026-09-01", value: 16.04 };
  it("takes the freshness report's true date when it falls in the row's month", () => {
    expect(storedVixFromFred(ROW, "2026-09-29")).toEqual({ vix: 16.04, date: "2026-09-29" });
  });
  it("without a true date in that month, says only the month", () => {
    expect(storedVixFromFred(ROW, null)).toEqual({ vix: 16.04, date: "2026-09-01", monthOnly: true });
    expect(storedVixFromFred(ROW, "2026-08-31")).toEqual({ vix: 16.04, date: "2026-09-01", monthOnly: true });
  });
  it("a row already dated to its day keeps that day; nothing served, nothing shown", () => {
    expect(storedVixFromFred({ date: "2026-09-14", value: 16.42 }, null)).toEqual({ vix: 16.42, date: "2026-09-14" });
    expect(storedVixFromFred(undefined, "2026-09-29")).toBeNull();
  });
});
