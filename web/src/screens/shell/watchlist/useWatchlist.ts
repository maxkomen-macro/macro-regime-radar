/**
 * Watchlist state (checklist F.2): the validated list, write-through
 * persistence, cross-tab sync over the `storage` event, a 6 s undo buffer and
 * the "storage unavailable" flag.
 *
 * Every mutation goes through `commit`, which updates a ref first so calls
 * made back-to-back inside one React batch (remove, then undo) compose on the
 * latest list rather than a stale closure. A `storage` event only replaces
 * state; it never writes, so two tabs cannot echo each other.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_SYMBOLS,
  UNDO_MS,
  WATCHLIST_KEY,
  addSymbol,
  defaults,
  localStorageOrNull,
  moveSymbol,
  parse,
  readWatchlist,
  removeSymbol,
  storageAvailable,
  writeWatchlist,
  type AddStatus,
  type WatchlistEntry,
} from "./storage";

export interface PendingUndo {
  entry: WatchlistEntry;
  index: number;
}

export type UndoStatus = "restored" | "full" | "none";

export interface WatchlistState {
  entries: WatchlistEntry[];
  /** Symbols in list order. */
  symbols: string[];
  /** True when the list lives in memory only (private mode, blocked storage). */
  unsaved: boolean;
  /** `entries.length >= MAX_SYMBOLS`. */
  full: boolean;
  pendingUndo: PendingUndo | null;
  add: (symbol: string) => AddStatus;
  /** True when a row was removed; false for an unknown symbol. */
  remove: (symbol: string) => boolean;
  undo: () => UndoStatus;
  /** One step up (-1) or down (+1); the new index, or null at an edge. */
  move: (symbol: string, dir: -1 | 1) => number | null;
  /** Any position (drag and drop); the new index, or null when nothing moved. */
  moveTo: (symbol: string, index: number) => number | null;
  restoreDefaults: () => void;
  dismissUndo: () => void;
}

interface Loaded {
  entries: WatchlistEntry[];
  corrupt: boolean;
}

function load(): Loaded {
  const storage = localStorageOrNull();
  if (!storage) return { entries: defaults(), corrupt: false };
  return readWatchlist(storage);
}

export function useWatchlist(): WatchlistState {
  const [initial] = useState<Loaded>(load);
  const [entries, setEntries] = useState<WatchlistEntry[]>(initial.entries);
  const [unsaved, setUnsaved] = useState<boolean>(() => !storageAvailable());
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

  const entriesRef = useRef(entries);
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const undoTimer = useRef<number | null>(null);

  const clearUndoTimer = useCallback(() => {
    if (undoTimer.current != null) {
      window.clearTimeout(undoTimer.current);
      undoTimer.current = null;
    }
  }, []);

  const persist = useCallback((next: WatchlistEntry[]) => {
    if (unsavedRef.current) return;
    const storage = localStorageOrNull();
    if (!storage || !writeWatchlist(storage, next)) {
      unsavedRef.current = true;
      setUnsaved(true);
    }
  }, []);

  /** Set state and write through (unless storage is unavailable). */
  const commit = useCallback(
    (next: WatchlistEntry[]) => {
      entriesRef.current = next;
      setEntries(next);
      persist(next);
    },
    [persist],
  );

  // Corrupt data: fall back to the defaults and rewrite storage at once
  // (once per mount; `initial` is fixed for the life of the component).
  const rewroteRef = useRef(false);
  useEffect(() => {
    if (initial.corrupt && !rewroteRef.current) {
      rewroteRef.current = true;
      persist(initial.entries);
    }
  }, [initial, persist]);

  // Cross-tab sync: replace state, never write (no echo loop). The undo
  // buffer stays local to the tab that removed.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== WATCHLIST_KEY) return;
      const next = parse(e.newValue).entries;
      entriesRef.current = next;
      setEntries(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => clearUndoTimer, [clearUndoTimer]);

  const dismissUndo = useCallback(() => {
    clearUndoTimer();
    setPendingUndo(null);
  }, [clearUndoTimer]);

  const add = useCallback(
    (symbol: string): AddStatus => {
      const r = addSymbol(entriesRef.current, symbol);
      if (r.status === "added") commit(r.entries);
      return r.status;
    },
    [commit],
  );

  const remove = useCallback(
    (symbol: string): boolean => {
      const r = removeSymbol(entriesRef.current, symbol);
      if (!r.removed) return false;
      clearUndoTimer();
      commit(r.entries);
      setPendingUndo(r.removed);
      undoTimer.current = window.setTimeout(() => {
        undoTimer.current = null;
        setPendingUndo(null);
      }, UNDO_MS);
      return true;
    },
    [clearUndoTimer, commit],
  );

  const pendingRef = useRef(pendingUndo);
  pendingRef.current = pendingUndo;

  const undo = useCallback((): UndoStatus => {
    const pending = pendingRef.current;
    if (!pending) return "none";
    const cur = entriesRef.current;
    if (cur.some((e) => e.symbol === pending.entry.symbol)) {
      dismissUndo();
      return "restored";
    }
    if (cur.length >= MAX_SYMBOLS) {
      dismissUndo();
      return "full";
    }
    const at = Math.min(pending.index, cur.length);
    const next = [...cur.slice(0, at), pending.entry, ...cur.slice(at)];
    dismissUndo();
    commit(next);
    return "restored";
  }, [commit, dismissUndo]);

  const moveTo = useCallback(
    (symbol: string, index: number): number | null => {
      const cur = entriesRef.current;
      const from = cur.findIndex((e) => e.symbol === symbol);
      if (from < 0) return null;
      const to = Math.min(Math.max(index, 0), cur.length - 1);
      if (to === from) return null;
      commit(moveSymbol(cur, from, to));
      return to;
    },
    [commit],
  );

  const move = useCallback(
    (symbol: string, dir: -1 | 1): number | null => {
      const cur = entriesRef.current;
      const from = cur.findIndex((e) => e.symbol === symbol);
      if (from < 0) return null;
      const to = from + dir;
      if (to < 0 || to >= cur.length) return null; // edge: no-op, no write
      return moveTo(symbol, to);
    },
    [moveTo],
  );

  const restoreDefaults = useCallback(() => {
    dismissUndo();
    commit(defaults());
  }, [commit, dismissUndo]);

  return {
    entries,
    symbols: entries.map((e) => e.symbol),
    unsaved,
    full: entries.length >= MAX_SYMBOLS,
    pendingUndo,
    add,
    remove,
    undo,
    move,
    moveTo,
    restoreDefaults,
    dismissUndo,
  };
}

export default useWatchlist;
