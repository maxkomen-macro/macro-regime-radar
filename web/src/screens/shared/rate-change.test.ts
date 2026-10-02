/**
 * fix/freshness 2: each change label maps to its lookback. "1W" only for a
 * true seven-calendar-day change; a month-stamped series says "vs <Mon>
 * month-end"; a payload without a basis prints no change at all.
 */
import { describe, expect, it } from "vitest";
import type { CreditSeries } from "../../api/types";
import { rateChange } from "./rate-change";

const base: CreditSeries = { series_id: "DGS10", label: "UST10Y", date: "2026-09-28", value_pct: 5.24, value_bps: 524, change_1w_bps: null, history: [] };

describe("rateChange", () => {
  it("a true week (desk_series, prior observation 7 days back) reads 1W and names both dates", () => {
    const c = rateChange({ ...base, change_bps: 28, change_basis: "1w", change_from: "2026-09-21", change_1w_bps: 28 });
    expect(c).toEqual({
      bps: 28,
      basis: "1w",
      tag: "1W",
      phrase: "on the week",
      title: "Change over one week: Sep 28, 2026 against Sep 21, 2026",
    });
  });

  it("a month-stamped series reads vs <Mon> month-end, never 1W", () => {
    const c = rateChange({ ...base, series_id: "BAMLC0A0CM", label: "IG", date: "2026-09-29", change_bps: 4, change_basis: "month_end", change_from: "2026-08" });
    expect(c?.tag).toBe("vs Aug month-end");
    expect(c?.phrase).toBe("since the Aug month-end");
    expect(c?.title).toBe("Change since the August 2026 month-end value; this series is stored one row per month");
    expect(c?.tag).not.toMatch(/1W/i);
  });

  it("no basis (an older payload whose change_1w_bps was the month-stamped difference) prints nothing", () => {
    expect(rateChange({ ...base, change_1w_bps: 49 })).toBeNull();
    expect(rateChange({ ...base, change_bps: 49, change_basis: null, change_from: null })).toBeNull();
    expect(rateChange(undefined)).toBeNull();
  });
});
