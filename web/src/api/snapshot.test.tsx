import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { applySnapshot, resetSnapshotForTests, snapshotMeta } from "./snapshot";

const file = {
  generated_at: "2026-09-05T23:00:00Z",
  db_mtime: "2026-09-05T22:50:00Z",
  entries: {
    "/api/regime/latest": { date: "2026-07-01", label: "Goldilocks" },
    "/api/freshness": { regimes_date: "2026-07-01" },
    "/not/in/manifest": { x: 1 },
  },
};

describe("applySnapshot", () => {
  it("seeds only manifest keys and never overwrites live data", () => {
    resetSnapshotForTests();
    const client = new QueryClient();
    client.setQueryData(["freshness"], { regimes_date: "2026-08-01", live: true });
    const meta = applySnapshot(client, file, "static");
    expect(meta?.entries).toBe(1);
    expect(client.getQueryData(["regime", "latest"])).toEqual({ date: "2026-07-01", label: "Goldilocks" });
    expect(client.getQueryData(["freshness"])).toEqual({ regimes_date: "2026-08-01", live: true });
    expect(client.getQueryData(["not"])).toBeUndefined();
    expect(snapshotMeta()?.generated_at).toBe("2026-09-05T23:00:00Z");
  });
  it("rejects a malformed file", () => {
    resetSnapshotForTests();
    const client = new QueryClient();
    expect(applySnapshot(client, { generated_at: "", entries: {} } as never, "static")).toBeNull();
    expect(snapshotMeta()).toBeNull();
  });
});
