/**
 * The freshness report as the screens read it (Iteration 1 step 6, A3): the
 * /api/freshness payload, whether it is a seeded snapshot, and two label
 * readers that route every chip through fresh-state.ts. One hook for the
 * shell and every tab, so a seeded report reads "Snapshot · as of …" on
 * every surface at once and a live report replaces it everywhere at once.
 *
 * Seeded means either the report says so (`seeded: true`, written by the
 * snapshot builder) or the report on hand is the one the snapshot put in the
 * query cache (its update stamp is the snapshot's own `generated_at`; a live
 * fetch stamps the time it answered). Nothing here judges an age.
 */

import { useMemo } from "react";
import { useFreshness } from "../../api/queries";
import { useSnapshotMeta, type SnapshotMeta } from "../../api/snapshot";
import type { Freshness, SeriesState } from "../../api/types";
import { freshLabel, groupLabel, lookupFrom, seededLabel, seriesById, type FreshLabel } from "./fresh-state";

export interface FreshReport {
  f: Freshness | undefined;
  /** The report is a seeded snapshot: every state reads "Snapshot · as of". */
  seeded: boolean;
  /** The snapshot's stamp when seeded, else the report's own. */
  generatedAt: string | null;
  isLoading: boolean;
  isError: boolean;
  /** One series' §5 label: series[] first; a payload block only fills an id
   * the report does not carry. */
  series: (id: string, block?: Record<string, SeriesState> | null) => FreshLabel;
  /** A group's weakest member, with every member's word in the reason. */
  group: (ids: readonly string[], block?: Record<string, SeriesState> | null) => FreshLabel;
}

/** Pure: whether a report on hand is the seeded one. */
export function isSeededReport(f: Freshness | null | undefined, dataUpdatedAt: number, snapshot: SnapshotMeta | null): boolean {
  if (!f) return false;
  if (f.seeded === true) return true;
  if (!snapshot) return false;
  const stamp = Date.parse(snapshot.generated_at);
  return Number.isFinite(stamp) && dataUpdatedAt === stamp;
}

/** Pure: the report readers for a known report state (tests, the shell). */
export function freshReport(f: Freshness | undefined, seeded: boolean, snapshot: SnapshotMeta | null, extra: { isLoading?: boolean; isError?: boolean } = {}): FreshReport {
  const generatedAt = seeded ? (f?.generated_at ?? snapshot?.generated_at ?? null) : (f?.generated_at ?? null);
  return {
    f,
    seeded,
    generatedAt,
    isLoading: Boolean(extra.isLoading),
    isError: Boolean(extra.isError),
    series: (id, block) => (seeded ? seededLabel(generatedAt) : freshLabel(seriesById(f, id) ?? block?.[id])),
    group: (ids, block) => (seeded ? seededLabel(generatedAt) : groupLabel(lookupFrom(f, block), ids)),
  };
}

export function useFreshReport(): FreshReport {
  const q = useFreshness();
  const snapshot = useSnapshotMeta();
  const seeded = isSeededReport(q.data, q.dataUpdatedAt, snapshot);
  return useMemo(
    () => freshReport(q.data, seeded, snapshot, { isLoading: q.isLoading, isError: q.isError }),
    [q.data, seeded, snapshot, q.isLoading, q.isError],
  );
}
