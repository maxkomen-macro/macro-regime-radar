/**
 * Basket & Hedge's legs (DESK_FRAME3_SPEC §10): the weights the analyst
 * types, and the baskets they save in this browser. The weights are the
 * analyst's input, so the page may tidy them (equal-weight, normalize to
 * 100%); every number about the basket itself (returns, residual, vol, beta)
 * is the API's, priced from these legs (§12.12). Pure except the storage
 * helpers, which never throw.
 */

export interface WorkLeg {
  symbol: string;
  /** The API's name for the ticker; null until a price answer carries it. */
  name: string | null;
  /** As typed: percent of the basket ("22", "12.5", ""). */
  weight: string;
}

export interface SavedBasket {
  id: string;
  name: string;
  legs: { symbol: string; name: string | null; weight: number }[];
  saved_at: string;
}

export const DEFAULT_BASKET = "ai-infra";
export const SAVED_BASKETS_KEY = "mrr.desk.baskets.v1";

/** A weight as typed: a number from 0 to 100, at most one decimal; null otherwise. */
export function parseWeight(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d)?$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 100 ? v : null;
}

/** The legs' total in percent, to one decimal; null when a weight is not a number. */
export function total(legs: readonly WorkLeg[]): number | null {
  let sum = 0;
  for (const l of legs) {
    const w = parseWeight(l.weight);
    if (w == null) return null;
    sum += w;
  }
  return Math.round(sum * 10) / 10;
}

/** Weights that add to exactly 100.0 at one decimal: `raw` scaled, rounded, and the
 * rounding's remainder given to the largest legs first. */
function toHundred(raw: number[]): number[] {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!raw.length || sum <= 0) return raw.map(() => 0);
  const tenths = raw.map((w) => (w / sum) * 1000);
  const floor = tenths.map(Math.floor);
  let left = 1000 - floor.reduce((a, b) => a + b, 0);
  const order = tenths.map((t, i) => ({ i, frac: t - Math.floor(t), w: raw[i] })).sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (const o of order) {
    if (left <= 0) break;
    floor[o.i] += 1;
    left -= 1;
  }
  return floor.map((t) => t / 10);
}

const fmt = (w: number) => (Number.isInteger(w) ? String(w) : w.toFixed(1));

export function equalWeight(legs: readonly WorkLeg[]): WorkLeg[] {
  const w = toHundred(legs.map(() => 1));
  return legs.map((l, i) => ({ ...l, weight: fmt(w[i]) }));
}

/** Scaled to 100% in proportion; a weight that is not a number counts as zero. */
export function normalize(legs: readonly WorkLeg[]): WorkLeg[] {
  const w = toHundred(legs.map((l) => parseWeight(l.weight) ?? 0));
  return legs.map((l, i) => ({ ...l, weight: fmt(w[i]) }));
}

/** A ticker as typed, upper-cased; null when it cannot be a US listing's symbol. */
export function parseTicker(s: string): string | null {
  const t = s.trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(t) ? t : null;
}

/** The legs as the API reads them: `[{symbol, weight}]` with numeric weights. */
export function apiLegs(legs: readonly WorkLeg[]): { symbol: string; weight: number }[] {
  return legs.map((l) => ({ symbol: l.symbol, weight: parseWeight(l.weight) ?? 0 }));
}

/** `NVDA:22,AVGO:16,…`: the legs in one string (a query key, the hedge's `legs` parameter). */
export function legsKey(legs: readonly { symbol: string; weight: number | string }[]): string {
  return legs.map((l) => `${l.symbol}:${typeof l.weight === "number" ? fmt(l.weight) : (parseWeight(l.weight) ?? l.weight)}`).join(",");
}

export function toWork(legs: readonly { symbol: string; name: string | null; weight: number }[]): WorkLeg[] {
  return legs.map((l) => ({ symbol: l.symbol, name: l.name, weight: fmt(l.weight) }));
}

// ── Saved baskets: this browser only (like Event Study's saved questions, §1.8) ──

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isSaved(v: unknown): v is SavedBasket {
  const b = v as SavedBasket;
  return !!b && typeof b.id === "string" && typeof b.name === "string" && Array.isArray(b.legs) && b.legs.every((l) => l && typeof l.symbol === "string" && typeof l.weight === "number" && Number.isFinite(l.weight));
}

export function readSaved(storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedBasket[] {
  try {
    const parsed = JSON.parse(storage?.getItem(SAVED_BASKETS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSaved) : [];
  } catch {
    return [];
  }
}

export type SaveResult = "ok" | "off" | "full";

function writeAll(list: SavedBasket[], storage: Pick<Storage, "setItem"> | null): SaveResult {
  if (!storage) return "off";
  try {
    storage.setItem(SAVED_BASKETS_KEY, JSON.stringify(list));
    return "ok";
  } catch {
    return "full";
  }
}

/** Saves (or replaces, by id) one basket: "off" when there is no storage, "full" when it refuses the write. */
export function writeSaved(b: SavedBasket, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): SaveResult {
  return writeAll([...readSaved(storage).filter((x) => x.id !== b.id), b], storage);
}

/** Forgets one saved basket (a basket of this browser's, or this browser's weights for a served one). */
export function removeSaved(id: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): SaveResult {
  return writeAll(readSaved(storage).filter((x) => x.id !== id), storage);
}

/** The saved baskets as a JSON file's text (Export JSON, as Event Study exports its questions, §1.8). */
export function exportSaved(list: readonly SavedBasket[]): string {
  return JSON.stringify({ kind: "mrr.desk.baskets", version: 1, baskets: list }, null, 2);
}

const sameBasket = (x: SavedBasket, y: SavedBasket) => x.name === y.name && legsKey(x.legs) === legsKey(y.legs);

/** A JSON file's baskets merged into the list, never replacing one. A basket
 * already here (same name and legs, under any number) is skipped. A served
 * basket's id (`served`) comes in as this browser's weights for it unless
 * this browser already keeps different ones. Anything else whose id is
 * taken here, and any id that is neither `local-<n>` nor served, gets a
 * fresh `local-<n>`: every browser numbers from `local-1`, so collisions are
 * the normal case. Unreadable entries are counted, not kept. */
export function importSaved(
  list: readonly SavedBasket[],
  text: string,
  served: readonly string[] = [DEFAULT_BASKET],
): { list: SavedBasket[]; added: number; rejected: number; renumbered: number; skipped: number } {
  let items: unknown;
  try {
    const doc = JSON.parse(text) as { baskets?: unknown } | unknown[];
    items = Array.isArray(doc) ? doc : (doc as { baskets?: unknown })?.baskets;
  } catch {
    return { list: [...list], added: 0, rejected: 1, renumbered: 0, skipped: 0 };
  }
  if (!Array.isArray(items)) return { list: [...list], added: 0, rejected: 1, renumbered: 0, skipped: 0 };
  const good = items.filter(isSaved);
  let out = [...list];
  let added = 0;
  let renumbered = 0;
  let skipped = 0;
  for (const b of good) {
    if (out.some((x) => sameBasket(x, b))) {
      skipped += 1;
      continue;
    }
    const taken = out.some((x) => x.id === b.id);
    const keepId = !taken && (served.includes(b.id) || b.id.startsWith("local-"));
    const id = keepId ? b.id : newBasketId(out);
    if (!keepId) renumbered += 1;
    out = [...out, { ...b, id }];
    added += 1;
  }
  return { list: out, added, rejected: items.length - good.length, renumbered, skipped };
}

/** Writes a whole list (after an import). */
export function writeAllSaved(list: SavedBasket[], storage: Pick<Storage, "setItem"> | null = safeStorage()): SaveResult {
  return writeAll(list, storage);
}

/** An id for a new basket, `local-<n>`, not taken by a saved one. */
export function newBasketId(saved: readonly SavedBasket[]): string {
  let n = 1;
  while (saved.some((b) => b.id === `local-${n}`)) n += 1;
  return `local-${n}`;
}
