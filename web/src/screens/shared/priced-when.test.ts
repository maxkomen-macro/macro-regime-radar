import { describe, expect, it } from "vitest";
import { pricedMonths, pricedWhen } from "./priced-when";

describe("pricedWhen / pricedMonths (fix/freshness 4)", () => {
  it("names each metric's observation month, fed funds as a monthly average, never the run date", () => {
    expect(pricedWhen({ metric: "FEDFUNDS", observation_month: "2026-08" })).toBe("Aug 2026 average");
    expect(pricedWhen({ metric: "SOFR", observation_month: "2026-09" })).toBe("Sep 2026");
    expect(pricedWhen({ metric: "SOFR", observation_month: null })).toBeNull();
  });
  it("one line for a block: the newest month, then any metric of another month by name", () => {
    const rows = [
      { metric: "FEDFUNDS", label: "Fed Funds", observation_month: "2026-08" },
      { metric: "SOFR", label: "SOFR", observation_month: "2026-09" },
      { metric: "T10YIE", label: "10Y breakeven", observation_month: "2026-09" },
    ];
    expect(pricedMonths(rows)).toBe("Sep 2026 · Fed Funds Aug 2026 average");
    expect(pricedMonths(rows.slice(1))).toBe("Sep 2026");
    expect(pricedMonths([{ metric: "SOFR", label: "SOFR", observation_month: undefined }])).toBeNull();
  });
});
