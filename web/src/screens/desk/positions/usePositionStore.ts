/**
 * The position store as React state (DESK_FRAME3_SPEC §1.8, §9): read from
 * this browser on mount and whenever another tab writes it, and changed only
 * through `change`, which re-reads storage first so a write never loses
 * what another tab saved, keeps the unreadable entries, and reports whether
 * the browser kept it. `useLevels` asks for a monitored series only when a
 * stored position reads it.
 */

import { useCallback, useEffect, useState } from "react";
import { useMacro, useTechnicals } from "../data/api";
import { levelsFrom, type Levels } from "./monitor";
import { POSITIONS_KEY, isOpen, loadPositions, writePositions, type PositionStore, type SaveResult } from "./store";

export function usePositionStore(): [PositionStore, (fn: (current: PositionStore) => PositionStore) => SaveResult] {
  const [store, setStore] = useState<PositionStore>(() => loadPositions());
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === POSITIONS_KEY) setStore(loadPositions());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const change = useCallback((fn: (current: PositionStore) => PositionStore) => {
    const next = fn(loadPositions());
    const r = writePositions(next);
    if (r === "ok") setStore(next);
    return r;
  }, []);
  return [store, change];
}

/** Today's levels for the series the open automatic positions read; `always` asks for both (the Promote form's chips). */
export function useLevels(store: PositionStore, always = false): Levels & { loading: boolean } {
  const open = store.positions.filter((p) => isOpen(p) && p.monitoring === "automatic");
  const tech = useTechnicals({ enabled: always || open.some((p) => p.trigger?.series === "spx") });
  const macro = useMacro({ enabled: always || open.some((p) => p.trigger?.series === "curve_2s10s") });
  return { ...levelsFrom(tech.data, macro.data), loading: tech.isLoading || macro.isLoading };
}

/** The message for a write the browser did not keep. */
export function saveWords(r: SaveResult): string | null {
  if (r === "off") return "This browser is not keeping saved data (a private window, or storage turned off), so nothing was saved.";
  if (r === "full") return "This browser's storage is full, so nothing was saved.";
  return null;
}
