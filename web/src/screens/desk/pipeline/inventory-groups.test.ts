import { describe, expect, it } from "vitest";
import type { InventoryRow } from "../../../api/desk";
import schemaMd from "../../../content/desk/schema.md?raw";
import { GROUP_ORDER, groupOf } from "./inventory-groups";
import { parseSchema } from "./schema-parse";

function row(over: Partial<InventoryRow>): InventoryRow {
  return {
    id: "DGS10",
    label: "10-year Treasury yield",
    kind: "fred",
    cadence: "daily",
    as_of: "2026-09-18",
    state: "close",
    delay_min: null,
    cycles_behind: 0,
    stale: false,
    discontinued: false,
    reason: "",
    source: "FRED",
    source_id: "DGS10",
    feeds: [],
    ...over,
  };
}

describe("inventory groups (desk/integration: the desk_series rows)", () => {
  it("keeps the frame's groups for the freshness report's rows", () => {
    expect(groupOf(row({}))).toBe("FRED · daily series");
    expect(groupOf(row({ id: "CPIAUCSL", cadence: "monthly" }))).toBe("FRED · monthly prints");
    expect(groupOf(row({ id: "asset_prices", kind: "market" }))).toBe("Stored market data");
    expect(groupOf(row({ id: "live_quotes", kind: "live", cadence: "tick" }))).toBe("Live relay");
    expect(groupOf(row({ id: "lbo_all_in_rate", kind: "derived" }))).toBe("Derived");
  });

  it("puts every desk_series row in the Desk's own group, whatever its provider", () => {
    expect(groupOf(row({ id: "desk:DGS10", source_id: "DGS10", source: "FRED (Desk daily history)" }))).toBe("Desk · daily history");
    expect(groupOf(row({ id: "desk:^NDX", kind: "market", source_id: "^NDX" }))).toBe("Desk · daily history");
  });

  it("orders the Desk's group after the pipeline's own sources, and every group has a place", () => {
    expect(GROUP_ORDER).toEqual(["FRED · daily series", "FRED · monthly prints", "Stored market data", "Live relay", "Derived", "Desk · daily history"]);
  });

  it("the store schema names the desk_series table", () => {
    const tables = parseSchema(schemaMd).tiers.flatMap((t) => t.items.map((i) => i.table));
    expect(tables).toContain("desk_series");
  });
});
