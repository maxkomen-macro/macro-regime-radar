/**
 * "Sync to Snowflake" (PROTOTYPE, DESK_FRAME3_SPEC §11, §1.0.3): the tables are
 * the proposed schema's, and every row count agrees with the others.
 */
import { describe, expect, it } from "vitest";
import { PIPELINE_DDL } from "../../../fixtures/desk/pipeline-ddl";
import { mergedWords, sync } from "./snowflake-sync";

const S = sync();

describe("the Snowflake sync", () => {
  it("syncs exactly the proposed schema's six tables, in its order", () => {
    const ddl = [...PIPELINE_DDL.matchAll(/CREATE TABLE IF NOT EXISTS ([A-Z]+\.[A-Z_]+)/g)].map((m) => m[1]);
    expect(S.tables.map((t) => t.table)).toEqual(ddl);
  });

  it("each table's counts agree: staged = inserted + updated + unchanged; merged rows add to the rows before; a MART table is rebuilt whole", () => {
    for (const t of S.tables) {
      expect(t.inserted + t.updated + t.unchanged, t.table).toBe(t.staged);
      expect(t.unchanged, t.table).toBeGreaterThanOrEqual(0);
      if (t.mode === "merge") expect(t.rowsAfter).toBe(t.rowsBefore + t.inserted);
      else expect(t.rowsAfter).toBe(t.staged);
      // Only the MART layer is rebuilt; RAW is never updated in place.
      expect(t.mode === "rebuild").toBe(t.table.startsWith("MART."));
      if (t.table.startsWith("RAW.")) expect(t.updated).toBe(0);
    }
  });

  it("verify: every table matches the snapshot's rows, and the totals add up", () => {
    expect(S.matched).toBe(S.tables.length);
    expect(S.staged).toBe(S.tables.reduce((a, t) => a + t.staged, 0));
    expect(S.staged).toBe(3504);
    expect(S.seconds).toBeCloseTo(7.9, 9);
    expect(S.steps.map((s) => s.key)).toEqual(["connect", "stage", "merge", "verify"]);
  });

  it("the merge's words", () => {
    expect(S.tables.map(mergedWords)).toEqual(["+31", "+44", "+58 · 5 updated", "363 unchanged", "rebuilt", "rebuilt"]);
  });
});
