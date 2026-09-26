/**
 * Saved positions (spec §5): the app has no accounts, so positions live in
 * this browser under `mrr.desk.positions.v1`, shaped
 * `{ version: 1, positions: [...] }`, seeded with nothing. Corrupt or missing
 * data reads as an empty list; a storage that throws keeps the list in
 * memory for the session. The `storage` event keeps two open tabs in sync.
 * `addPosition` runs the discipline gate itself (gate.ts): a draft the gate
 * refuses is never written, whatever called it.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { localStorageOrNull } from "../../shell/watchlist/storage";
import { gateStatus, type Draft } from "./gate";
import { seriesRef } from "./series";

export const POSITIONS_KEY = "mrr.desk.positions.v1";

export interface Falsification {
  series: string;
  level: number;
  direction: "above" | "below";
}

export interface Position {
  id: string;
  instrument: string;
  direction: "long" | "short";
  size: string;
  horizon: string;
  variant_view: string;
  pre_mortem: string;
  falsification: Falsification;
  created_at: string;
}

interface PositionsFile {
  version: 1;
  positions: Position[];
}

function isPosition(x: unknown): x is Position {
  if (!x || typeof x !== "object") return false;
  const p = x as Record<string, unknown>;
  const f = p.falsification as Record<string, unknown> | undefined;
  return (
    typeof p.id === "string" &&
    typeof p.instrument === "string" &&
    (p.direction === "long" || p.direction === "short") &&
    typeof p.size === "string" &&
    typeof p.horizon === "string" &&
    typeof p.variant_view === "string" &&
    typeof p.pre_mortem === "string" &&
    typeof p.created_at === "string" &&
    !!f &&
    typeof f.series === "string" &&
    typeof f.level === "number" &&
    Number.isFinite(f.level) &&
    (f.direction === "above" || f.direction === "below")
  );
}

/** Why a stored position may not be shown (review R-05): the discipline gate
 * run on it as if it were a draft (a variant view and a pre-mortem written, no
 * flagged word, a numeric level tied to a series), and a series the catalogue
 * knows. Null when it passes. Storage is the visitor's to edit; the list shows
 * only what the gate would have saved. */
export function positionProblem(p: Position): string | null {
  const draft: Draft = {
    instrument: p.instrument,
    direction: p.direction,
    size: p.size,
    horizon: p.horizon,
    variant_view: p.variant_view,
    pre_mortem: p.pre_mortem,
    falsification_series: p.falsification.series,
    falsification_level: String(p.falsification.level),
    falsification_direction: p.falsification.direction,
  };
  const gate = gateStatus(draft);
  if (!gate.ok) return gate.reason;
  if (!seriesRef(p.falsification.series)) return `the falsification series "${p.falsification.series}" is not one the Desk reads.`;
  return null;
}

/** Missing, malformed, wrong version: an empty list, never a throw. A
 * well-formed entry the gate or the series check refuses is dropped, with a
 * console note naming it and why. */
export function parsePositions(raw: string | null): Position[] {
  if (raw == null) return [];
  try {
    const doc: unknown = JSON.parse(raw);
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) return [];
    const file = doc as Partial<PositionsFile>;
    if (file.version !== 1 || !Array.isArray(file.positions)) return [];
    return file.positions.filter(isPosition).filter((p) => {
      const problem = positionProblem(p);
      if (problem) console.warn(`Desk: a saved position (${p.instrument || p.id}) was not loaded: ${problem}`);
      return problem == null;
    });
  } catch {
    return [];
  }
}

export function serializePositions(positions: Position[]): string {
  const file: PositionsFile = { version: 1, positions };
  return JSON.stringify(file);
}

/* ── The store ───────────────────────────────────────────────────────────── */

let memory: Position[] = [];
let memoryRaw: string | null | undefined;
/** True after a write storage refused: the in-memory list is then the truth
 * for this session and a stale storage value must not overwrite it. */
let unsynced = false;
const listeners = new Set<() => void>();

function read(): Position[] {
  const storage = localStorageOrNull();
  if (!storage || unsynced) return memory;
  let raw: string | null;
  try {
    raw = storage.getItem(POSITIONS_KEY);
  } catch {
    return memory;
  }
  if (raw !== memoryRaw) {
    memoryRaw = raw;
    memory = parsePositions(raw);
  }
  return memory;
}

/** Storage first, then the in-memory copy, then the subscribers: a listener
 * that reads synchronously (useSyncExternalStore does) must find the new
 * value in storage, or it would re-parse the old one and lose the write.
 * False when storage refused the write (the list still changes in memory). */
function write(positions: Position[]): boolean {
  const raw = serializePositions(positions);
  let persisted = false;
  const storage = localStorageOrNull();
  if (storage) {
    try {
      storage.setItem(POSITIONS_KEY, raw);
      persisted = true;
    } catch {
      persisted = false;
    }
  }
  unsynced = !persisted;
  memory = positions;
  memoryRaw = raw;
  listeners.forEach((l) => l());
  return persisted;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === POSITIONS_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type AddResult = { ok: true; position: Position; persisted: boolean } | { ok: false; reason: string };

/** The one way in. Re-runs the gate; a refused draft is not written. */
export function addPosition(draft: Draft, now: Date = new Date()): AddResult {
  const gate = gateStatus(draft);
  if (!gate.ok || gate.level == null) return { ok: false, reason: gate.reason || "Save is blocked by the discipline gate." };
  const position: Position = {
    id: newId(),
    instrument: draft.instrument.trim(),
    direction: draft.direction,
    size: draft.size.trim(),
    horizon: draft.horizon.trim(),
    variant_view: draft.variant_view.trim(),
    pre_mortem: draft.pre_mortem.trim(),
    falsification: { series: draft.falsification_series.trim(), level: gate.level, direction: draft.falsification_direction },
    created_at: now.toISOString(),
  };
  const persisted = write([...read(), position]);
  return { ok: true, position, persisted };
}

export function removePosition(id: string): boolean {
  return write(read().filter((p) => p.id !== id));
}

/** Test seam: forget the in-memory copy so the next read hits storage. */
export function resetPositionsForTests(): void {
  memory = [];
  memoryRaw = undefined;
  unsynced = false;
}

export function usePositions(): { positions: Position[]; add: (draft: Draft) => AddResult; remove: (id: string) => boolean; storageAvailable: boolean } {
  const positions = useSyncExternalStore(subscribe, read, () => memory);
  const add = useCallback((draft: Draft) => addPosition(draft), []);
  const remove = useCallback((id: string) => removePosition(id), []);
  const storageAvailable = localStorageOrNull() != null;
  return useMemo(() => ({ positions, add, remove, storageAvailable }), [positions, add, remove, storageAvailable]);
}
