/**
 * Watchlist storage (spec §3.1, checklist F.1). Pure functions, no React.
 *
 * The list is the one per-visitor preference kept in the browser: a
 * localStorage document shaped `{ version: 1, symbols: [{ symbol, addedAt }] }`
 * under `mrr.watchlist.v1`. Everything read from storage is validated here
 * (uppercase, symbol pattern, dedupe, cap) so the UI never sees a bad row.
 * Corrupt data falls back to the defaults and the hook rewrites storage; an
 * empty valid list stays empty (the visitor removed everything on purpose).
 */

export const WATCHLIST_KEY = "mrr.watchlist.v1";
const PROBE_KEY = "mrr.watchlist.probe";

/** Identical to the `?name=` guard in MarketsScreen.tsx. */
export const SYMBOL_RE = /^[A-Z0-9.^=-]{1,15}$/;
export const MAX_SYMBOLS = 12;
export const DEFAULT_SYMBOLS: readonly string[] = ["SPY", "QQQ", "IWM", "EEM"];
/** How long the Undo toast (and the undo buffer) lives after a removal. */
export const UNDO_MS = 6000;

export interface WatchlistEntry {
  symbol: string;
  /** ISO date-time of the add. */
  addedAt: string;
}

export interface WatchlistFile {
  version: 1;
  symbols: WatchlistEntry[];
}

export type AddStatus = "added" | "duplicate" | "full" | "invalid";

export type Clock = Date | string | number;

function isoNow(now?: Clock): string {
  if (now == null) return new Date().toISOString();
  if (typeof now === "string") return now;
  return new Date(now).toISOString();
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

function validDate(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && !Number.isNaN(Date.parse(v));
}

/** Uppercase, drop rows failing the pattern (or without a string symbol),
 * dedupe keeping the first occurrence, cap at MAX_SYMBOLS. A missing or
 * unparseable `addedAt` is coerced to `now`; it is not a corruption. */
export function sanitize(entries: unknown, now?: Clock): WatchlistEntry[] {
  if (!Array.isArray(entries)) return [];
  const stamp = isoNow(now);
  const seen = new Set<string>();
  const out: WatchlistEntry[] = [];
  for (const item of entries) {
    if (out.length >= MAX_SYMBOLS) break;
    if (item == null || typeof item !== "object") continue;
    const raw = (item as { symbol?: unknown }).symbol;
    if (typeof raw !== "string") continue;
    const symbol = normalizeSymbol(raw);
    if (!SYMBOL_RE.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    const addedAt = (item as { addedAt?: unknown }).addedAt;
    out.push({ symbol, addedAt: validDate(addedAt) ? addedAt : stamp });
  }
  return out;
}

/** The four default rows, stamped `now`. */
export function defaults(now?: Clock): WatchlistEntry[] {
  const stamp = isoNow(now);
  return DEFAULT_SYMBOLS.map((symbol) => ({ symbol, addedAt: stamp }));
}

/**
 * `null` (first visit) → defaults, not corrupt. Malformed JSON, a non-object,
 * an unknown version or a non-array `symbols` → defaults, corrupt. An empty
 * valid array is a valid empty list.
 */
export function parse(raw: string | null, now?: Clock): { entries: WatchlistEntry[]; corrupt: boolean } {
  if (raw == null) return { entries: defaults(now), corrupt: false };
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { entries: defaults(now), corrupt: true };
  }
  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return { entries: defaults(now), corrupt: true };
  const file = doc as { version?: unknown; symbols?: unknown };
  if (file.version !== 1 || !Array.isArray(file.symbols)) return { entries: defaults(now), corrupt: true };
  return { entries: sanitize(file.symbols, now), corrupt: false };
}

export function serialize(entries: WatchlistEntry[]): string {
  const file: WatchlistFile = { version: 1, symbols: entries.map(({ symbol, addedAt }) => ({ symbol, addedAt })) };
  return JSON.stringify(file);
}

/** Read and validate. A storage that throws on read (blocked storage) reads
 * as a first visit. */
export function readWatchlist(storage: Pick<Storage, "getItem">, now?: Clock): { entries: WatchlistEntry[]; corrupt: boolean } {
  let raw: string | null = null;
  try {
    raw = storage.getItem(WATCHLIST_KEY);
  } catch {
    raw = null;
  }
  return parse(raw, now);
}

/** Write `serialize(entries)`; false when the write is refused (quota,
 * private mode, SecurityError). Never throws. */
export function writeWatchlist(storage: Pick<Storage, "setItem">, entries: WatchlistEntry[]): boolean {
  try {
    storage.setItem(WATCHLIST_KEY, serialize(entries));
    return true;
  } catch {
    return false;
  }
}

/** `window.localStorage`, or null when the accessor itself throws. */
export function localStorageOrNull(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    const s = window.localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/** Probe with a set + remove: false in private mode, when storage is blocked,
 * or when the accessor throws a SecurityError. */
export function storageAvailable(storage: Pick<Storage, "setItem" | "removeItem"> | null = localStorageOrNull()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PROBE_KEY, "1");
    storage.removeItem(PROBE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function addSymbol(entries: WatchlistEntry[], symbol: string, now?: Clock): { entries: WatchlistEntry[]; status: AddStatus } {
  const sym = normalizeSymbol(symbol);
  if (!SYMBOL_RE.test(sym)) return { entries, status: "invalid" };
  if (entries.some((e) => e.symbol === sym)) return { entries, status: "duplicate" };
  if (entries.length >= MAX_SYMBOLS) return { entries, status: "full" };
  return { entries: [...entries, { symbol: sym, addedAt: isoNow(now) }], status: "added" };
}

/** The list without `symbol`, plus the removed entry and its index for undo. */
export function removeSymbol(entries: WatchlistEntry[], symbol: string): { entries: WatchlistEntry[]; removed: { entry: WatchlistEntry; index: number } | null } {
  const sym = normalizeSymbol(symbol);
  const index = entries.findIndex((e) => e.symbol === sym);
  if (index < 0) return { entries, removed: null };
  return { entries: entries.filter((_, i) => i !== index), removed: { entry: entries[index], index } };
}

/** Move the row at `from` to `to`; both clamp to the list bounds. */
export function moveSymbol(entries: WatchlistEntry[], from: number, to: number): WatchlistEntry[] {
  const last = entries.length - 1;
  if (last < 0) return [];
  const f = Math.min(Math.max(from, 0), last);
  const t = Math.min(Math.max(to, 0), last);
  const out = [...entries];
  if (f === t) return out;
  const [row] = out.splice(f, 1);
  out.splice(t, 0, row);
  return out;
}
