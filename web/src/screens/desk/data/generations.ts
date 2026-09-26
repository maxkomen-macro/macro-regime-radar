/**
 * The page's generations (DESK_FRAME3_SPEC §1.1, §12.0; Codex R-22): the shell
 * reads the `generation_id` of every Desk answer the page is using (each
 * desk-v2 query with a live observer, a ready answer's id or an awaiting or
 * error envelope's), prints it in the page footer, and when two differ says
 * "mixed generations · refreshing" in the page badge and refetches once.
 */
import { createContext, useContext, useSyncExternalStore } from "react";
import { useQueryClient, type Query } from "@tanstack/react-query";

/** The generation a Desk query's answer was computed on, if it names one. */
export function generationOf(q: Pick<Query, "state">): string | null {
  const d = q.state.data as { generation_id?: unknown } | undefined;
  if (d && typeof d === "object" && typeof d.generation_id === "string") return d.generation_id;
  const e = q.state.error as { generationId?: unknown } | null;
  return e && typeof e === "object" && typeof e.generationId === "string" ? e.generationId : null;
}

/** The distinct generation ids of the Desk answers the page is using, sorted. */
export function usePageGenerations(): string[] {
  const cache = useQueryClient().getQueryCache();
  const read = () => {
    const ids = new Set<string>();
    for (const q of cache.findAll({ queryKey: ["desk-v2"] })) {
      if (q.getObserversCount() === 0) continue;
      const g = generationOf(q);
      if (g) ids.add(g);
    }
    return [...ids].sort().join("\n");
  };
  const key = useSyncExternalStore((cb) => cache.subscribe(cb), read, read);
  return key ? key.split("\n") : [];
}

/** The Client view's "Snapshot · <as_of>" (S-32): the study's own `as_of`, the one its source line prints; else the
 * newest among the page's other Desk answers. */
export function usePageAsOf(): string | null {
  const cache = useQueryClient().getQueryCache();
  const read = () => {
    let newest = "";
    let studied = "";
    for (const q of cache.findAll({ queryKey: ["desk-v2"] })) {
      if (q.getObserversCount() === 0) continue;
      const d = q.state.data as { as_of?: unknown } | undefined;
      if (!d || typeof d !== "object" || typeof d.as_of !== "string") continue;
      if (q.queryKey[1] === "/study" && d.as_of > studied) studied = d.as_of;
      if (d.as_of > newest) newest = d.as_of;
    }
    return studied || newest;
  };
  return useSyncExternalStore((cb) => cache.subscribe(cb), read, read) || null;
}

/** Whether the page's answers disagree on their generation (the page badge reads so). */
export const MixedGenerations = createContext(false);
export const useMixedGenerations = () => useContext(MixedGenerations);
