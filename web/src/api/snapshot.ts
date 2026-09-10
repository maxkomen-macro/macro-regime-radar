/**
 * Validated-snapshot mode (2026-09-06). A static JSON file — built by
 * scripts/build_snapshot.py from a validated database and shipped with the
 * frontend as /snapshot/latest.json (or VITE_SNAPSHOT_URL) — seeds the
 * query cache before the first render. Every stored screen then paints
 * immediately, and keeps painting when the FastAPI host is asleep: a failed
 * refetch leaves the seeded data in place and the shell says "Validated
 * snapshot". Nothing here blocks the app: a missing or slow file is skipped
 * after SNAPSHOT_TIMEOUT_MS.
 *
 * The manifest (snapshot-manifest.json) is the single list of endpoints the
 * snapshot carries, shared with the Python builder.
 */

import { useSyncExternalStore } from "react";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import manifest from "./snapshot-manifest.json";

export interface SnapshotMeta {
  generated_at: string;
  db_mtime: string | null;
  source: string;
  entries: number;
}

interface SnapshotFile {
  generated_at: string;
  db_mtime?: string | null;
  source?: string;
  entries: Record<string, unknown>;
}

const SNAPSHOT_TIMEOUT_MS = 2_500;
const STORAGE_KEY = "mrr:snapshot:v1";

let meta: SnapshotMeta | null = null;
const listeners = new Set<() => void>();

function setMeta(m: SnapshotMeta | null) {
  meta = m;
  listeners.forEach((l) => l());
}

export function snapshotUrl(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env.VITE_SNAPSHOT_URL || "/snapshot/latest.json";
}

function timeoutSignal(ms: number): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

/** Seed the cache from `file`; returns the meta or null when nothing usable. */
export function applySnapshot(client: QueryClient, file: SnapshotFile, source: string): SnapshotMeta | null {
  if (!file || typeof file !== "object" || !file.entries || !file.generated_at) return null;
  let n = 0;
  for (const entry of manifest as { key: QueryKey; path: string }[]) {
    const body = file.entries[entry.path];
    if (body === undefined) continue;
    // Only fill an empty slot: live data that already arrived always wins.
    if (client.getQueryData(entry.key) === undefined) {
      client.setQueryData(entry.key, body, { updatedAt: Date.parse(file.generated_at) || Date.now() });
      n += 1;
    }
  }
  if (!n) return null;
  const m = { generated_at: file.generated_at, db_mtime: file.db_mtime ?? null, source, entries: n };
  setMeta(m);
  return m;
}

/** Fetch the snapshot with a hard time budget; never throws. Also keeps a
 * last-known-good copy in localStorage so a cold page load on a sleeping
 * backend still has something validated to show. */
export async function seedSnapshot(client: QueryClient): Promise<SnapshotMeta | null> {
  let file: SnapshotFile | null = null;
  let source = "static";
  try {
    const res = await fetch(snapshotUrl(), { headers: { Accept: "application/json" }, signal: timeoutSignal(SNAPSHOT_TIMEOUT_MS) });
    if (res.ok) file = (await res.json()) as SnapshotFile;
  } catch {
    file = null;
  }
  if (!file) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        file = JSON.parse(raw) as SnapshotFile;
        source = "last-known-good";
      }
    } catch {
      file = null;
    }
  } else {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
    } catch {
      /* quota or private mode — the static file still served this load */
    }
  }
  return file ? applySnapshot(client, file, source) : null;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Meta of the snapshot that seeded this session, or null. */
export function useSnapshotMeta(): SnapshotMeta | null {
  return useSyncExternalStore(subscribe, () => meta, () => meta);
}

export function snapshotMeta(): SnapshotMeta | null {
  return meta;
}

export function resetSnapshotForTests(): void {
  meta = null;
}
