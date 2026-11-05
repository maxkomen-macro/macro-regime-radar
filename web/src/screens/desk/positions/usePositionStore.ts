/**
 * The position store as React state (DESK_FRAME3_SPEC §1.8, §9): read from
 * this browser on mount and whenever another tab writes it, and changed only
 * through `change`, which re-reads storage first so a write never loses
 * what another tab saved, keeps the unreadable entries, and reports whether
 * the browser kept it. `useLevels` asks for a monitored series only when a
 * stored position reads it.
 */

import { useCallback, useEffect, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { current, deskGet, retry, useInstruments, useMacro, useTechnicals } from "../data/api";
import type { TechnicalsResponse } from "../data/types";
import { eitherFailed, loadFailed, type QueryLike } from "../kit/ui";
import { rateSeriesOf } from "./dv01";
import { etfLevelFrom, levelsFrom, tenorsFrom, type EtfLevel, type Levels } from "./monitor";
import { POSITIONS_KEY, familyOf, isOpen, loadPositions, monitoredSeriesOf, parseSeries, writePositions, type PositionStore, type SaveResult } from "./store";

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

/**
 * Today's levels for the series the open automatic positions read; `always` asks for the S&P, the curve and
 * the stored-instrument list (the Promote form's chips), and `draft` the form's instrument: its ETF level is
 * asked only once `/instruments` lists it as stored, so typing a ticker never sends a provider lookup (P1c).
 * Only the reads an open position depends on join `reads`, the card's failed scope: the form's draft does not.
 */
export function useLevels(store: PositionStore, always = false, draft = ""): Levels & { loading: boolean; reads: QueryLike } {
  const open = store.positions.filter((p) => isOpen(p) && p.monitoring === "automatic");
  const refs = open.map((p) => parseSeries(p.trigger?.series));
  const heldEtfs = [...new Set(refs.flatMap((r) => (r?.kind === "etf" ? [r.symbol] : [])))];
  const tech = useTechnicals({ enabled: always || refs.some((r) => r?.kind === "spx") });
  // DV01 (DR-10): an open yield or spread position needs the curve whether it is monitored automatically or by hand.
  const rated = store.positions.some((p) => isOpen(p) && rateSeriesOf(p) !== null);
  const macro = useMacro({ enabled: always || rated || open.some((p) => p.trigger && familyOf(p.trigger.series) === "rate") });
  const inst = useInstruments({ enabled: always || heldEtfs.length > 0 });
  // A list that is not served (loading or failed) is null: whether a ticker is stored cannot be told.
  const stored = inst.data?.instruments ? inst.data.instruments.filter((i) => i.kind === "etf").map((i) => i.symbol) : null;
  const draftRef = parseSeries(monitoredSeriesOf(draft));
  const draftEtf = draftRef?.kind === "etf" && stored?.includes(draftRef.symbol) ? draftRef.symbol : null;
  // A held ETF is asked only while the list names it stored: a record imported for any other ticker never
  // sends a provider lookup from the monitor (/technicals?symbol= falls back to EODHD for one it does not store).
  const asked = [...new Set([...heldEtfs.filter((s) => stored?.includes(s)), ...(draftEtf ? [draftEtf] : [])])].sort();
  const etfQs = useQueries({
    queries: asked.map((symbol) => ({
      // The key useTechnicals({ symbol }) uses, so the Technicals page and the monitor share one answer.
      queryKey: ["desk-v2", "/technicals", { symbol }],
      queryFn: ({ signal }: { signal: AbortSignal }) => deskGet<TechnicalsResponse>("/technicals", { symbol }, { signal }),
      staleTime: 60_000,
      retry,
    })),
  }).map((q) => current(q));
  const etfs: Record<string, EtfLevel> = {};
  asked.forEach((symbol, i) => {
    const level = etfLevelFrom(symbol, etfQs[i].data as TechnicalsResponse | undefined);
    if (level) etfs[symbol] = level;
  });
  const held = etfQs.filter((_, i) => heldEtfs.includes(asked[i]));
  const etfReads: QueryLike[] = heldEtfs.length ? [inst, ...held] : [];
  const loading = tech.isLoading || macro.isLoading || (heldEtfs.length > 0 && (inst.isLoading || held.some((q) => q.isLoading)));
  // desk/usability §14.10, §14.12: whether the levels are still asked, and the requests as one failed scope.
  const rates = loadFailed(macro) ? ("failed" as const) : macro.isLoading ? ("loading" as const) : undefined;
  return { ...levelsFrom(tech.data, macro.data), tenors: tenorsFrom(macro.data), etfs, stored, rates, loading, reads: eitherFailed(tech, macro, ...etfReads) };
}

/** The message for a write the browser did not keep. */
export function saveWords(r: SaveResult): string | null {
  if (r === "off") return "This browser is not keeping saved data (a private window, or storage turned off), so nothing was saved.";
  if (r === "full") return "This browser's storage is full, so nothing was saved.";
  return null;
}
