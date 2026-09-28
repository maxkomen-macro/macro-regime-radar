/**
 * Data Pipeline's "Sync to Snowflake" as a PROTOTYPE (DESK_FRAME3_SPEC §11,
 * §1.0.3): one daily sync of the snapshot into the proposed schema (RAW, CUR,
 * MART, the tables of api/static/snowflake_proposed.sql), step by step:
 * connect, stage, merge, verify, with each table's row counts, from
 * proto-snowflake-sync.json. A merged table gains its inserted rows; a MART
 * table is rebuilt whole; verify holds each table's rows to the snapshot's.
 * Pure.
 */

import f from "../../../fixtures/desk/proto-snowflake-sync.json" with { type: "json" };

export type StepKey = "connect" | "stage" | "merge" | "verify";

export interface Step {
  key: StepKey;
  label: string;
  detail: string;
  seconds: number;
}

export interface TableSync {
  table: string;
  key: string;
  mode: "merge" | "rebuild";
  staged: number;
  inserted: number;
  updated: number;
  /** Staged rows the merge found already there, unchanged. */
  unchanged: number;
  rowsBefore: number;
  rowsAfter: number;
  sourceRows: number;
  matches: boolean;
}

export interface Sync {
  target: typeof f.target;
  steps: Step[];
  tables: TableSync[];
  staged: number;
  seconds: number;
  matched: number;
}

export function sync(): Sync {
  const tables = f.tables.map((t) => {
    const mode = t.mode === "rebuild" ? "rebuild" : "merge";
    const rowsAfter = mode === "rebuild" ? t.staged : t.rows_before + t.inserted;
    return {
      table: t.table,
      key: t.key,
      mode,
      staged: t.staged,
      inserted: t.inserted,
      updated: t.updated,
      unchanged: mode === "rebuild" ? 0 : t.staged - t.inserted - t.updated,
      rowsBefore: t.rows_before,
      rowsAfter,
      sourceRows: t.source_rows,
      matches: rowsAfter === t.source_rows,
    } as TableSync;
  });
  const steps = f.steps.map((s) => ({ ...s, key: s.key as StepKey }));
  return {
    target: f.target,
    steps,
    tables,
    staged: tables.reduce((a, t) => a + t.staged, 0),
    seconds: steps.reduce((a, s) => a + s.seconds, 0),
    matched: tables.filter((t) => t.matches).length,
  };
}

/** The merge's words for a table: "+31", "+58 · 5 updated", "363 unchanged", "rebuilt". */
export function mergedWords(t: TableSync): string {
  if (t.mode === "rebuild") return "rebuilt";
  const parts = [t.inserted ? `+${t.inserted.toLocaleString("en-US")}` : null, t.updated ? `${t.updated} updated` : null, !t.inserted && !t.updated ? `${t.unchanged.toLocaleString("en-US")} unchanged` : null];
  return parts.filter(Boolean).join(" · ");
}
