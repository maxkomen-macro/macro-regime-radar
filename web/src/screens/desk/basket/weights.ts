/**
 * Basket & Hedge's legs (DESK_FRAME3_SPEC §10): the weights the analyst
 * types, and the baskets they save in this browser (§1.8), each with its
 * name, method (buy-and-hold or monthly rebalance) and notional. The weights
 * are the analyst's input, so the page may tidy them (equal-weight, normalize
 * to 100%); nothing about the basket itself is computed here: the API prices
 * a saved basket (§12.14). Pure except the storage helpers, which never throw.
 */

export interface WorkLeg {
  symbol: string;
  /** The ticker's name as saved; null for a ticker added here. */
  name: string | null;
  /** As typed: percent of the basket ("22", "12.5", ""). */
  weight: string;
}

export type Method = "hold" | "monthly";

export interface SavedBasket {
  id: string;
  name: string;
  /** A leg's weight in percent: saved as the exact decimal typed ("99.9999999999999994"), so a normalized
   * basket adds to exactly 100% again when it is read back (Codex R-20); an older save's number reads too. */
  legs: { symbol: string; name: string | null; weight: number | string }[];
  saved_at: string;
  /** How the basket is held (desk/books); an older save without it is bought and held. */
  method?: Method;
  /** Dollars (desk/books); an older save without it is $1,000,000. */
  notional?: number;
}

export const SAVED_BASKETS_KEY = "mrr.desk.baskets.v1";
export const DEFAULT_METHOD: Method = "hold";
export const DEFAULT_NOTIONAL = 1_000_000;
export const METHOD_WORDS: Record<Method, string> = { hold: "Buy-and-hold", monthly: "Monthly rebalance" };
export const methodOf = (b: Pick<SavedBasket, "method"> | null | undefined): Method => (b?.method === "monthly" ? "monthly" : DEFAULT_METHOD);
export const notionalOf = (b: Pick<SavedBasket, "notional"> | null | undefined): number => (typeof b?.notional === "number" && Number.isFinite(b.notional) && b.notional > 0 ? b.notional : DEFAULT_NOTIONAL);

/** The basket this browser starts with when it has none stored (desk/books): ten AI infrastructure names at equal
 * weight, bought and held, $1,000,000. Written once, when the store is absent; a deleted preset is not written back. */
export const PRESET: SavedBasket = {
  id: "local-1",
  name: "AI Infrastructure 10",
  legs: [
    ["NVDA", "NVIDIA"],
    ["AVGO", "Broadcom"],
    ["AMD", "AMD"],
    ["TSM", "TSMC"],
    ["MU", "Micron"],
    ["ANET", "Arista Networks"],
    ["VRT", "Vertiv"],
    ["CEG", "Constellation Energy"],
    ["CRWV", "CoreWeave"],
    ["NBIS", "Nebius"],
  ].map(([symbol, name]) => ({ symbol, name, weight: "10" })),
  saved_at: "2026-09-27T00:00:00Z",
  method: "hold",
  notional: DEFAULT_NOTIONAL,
};

/** A notional as typed ("1,000,000", "$2.5m" is not one): dollars above 0 and at most $1 trillion, or null. */
export function parseNotional(s: string): number | null {
  const t = s.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v > 0 && v <= 1e12 ? v : null;
}

/** Dollars as the notional input shows them: "1,000,000". */
export function notionalText(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** A weight as typed: a number from 0 to 100, to any number of decimals, kept exactly as
 * typed (Codex R-14: 22.11 is not 22.1); null otherwise. */
export function parseWeight(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return v >= 0 && v <= 100 ? v : null;
}

/** A weight's decimal digits, never exponent notation (a served 1e-7 is "0.0000001", a 1e-21 is not "0"):
 * the shortest round-trip digits of the number, with the exponent written out (Codex R-20). */
export function decimal(w: number): string {
  const t = String(w);
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(t);
  if (!m) return t;
  const [, sign, lead, rest = "", expText] = m;
  const digits = lead + rest;
  const exp = Number(expText);
  if (exp < 0) return `${sign}0.${"0".repeat(-exp - 1)}${digits}`;
  return `${sign}${digits.padEnd(exp + 1, "0").slice(0, exp + 1)}${digits.length > exp + 1 ? `.${digits.slice(exp + 1)}` : ""}`;
}

const text = (w: string | number) => (typeof w === "number" ? decimal(w) : w.trim());

/** The legs' total as an exact decimal ("100", "99.97", "99.9999999999"), summed digit by
 * digit so no float noise decides it; null when a weight is not a number (Codex R-14). */
export function totalText(legs: readonly { weight: string | number }[]): string | null {
  const parts: [bigint, number][] = [];
  for (const l of legs) {
    const t = text(l.weight);
    if (parseWeight(t) == null) return null;
    const [i, f = ""] = t.split(".");
    parts.push([BigInt(i + f), f.length]);
  }
  const d = Math.max(0, ...parts.map(([, n]) => n));
  const sum = parts.reduce((a, [v, n]) => a + v * 10n ** BigInt(d - n), 0n);
  if (d === 0) return sum.toString();
  const digits = sum.toString().padStart(d + 1, "0");
  return `${digits.slice(0, -d)}.${digits.slice(-d)}`.replace(/\.?0+$/, "");
}

/** The legs' total in percent (the exact total, as a number); null when a weight is not a number. */
export function total(legs: readonly { weight: string | number }[]): number | null {
  const t = totalText(legs);
  return t == null ? null : Number(t);
}

/** Whether the legs add to exactly 100%: 99.97 does not, nor does 99.9999999999. */
export const sumsToHundred = (legs: readonly { weight: string | number }[]): boolean => totalText(legs) === "100";

/** A weight as typed, as an exact decimal: its digits and its number of decimals; 0 when it is not a number. */
function exact(t: string): { v: bigint; d: number } {
  const s = parseWeight(t) == null ? "0" : t.trim();
  const [i, f = ""] = s.split(".");
  return { v: BigInt(i + f), d: f.length };
}

/** Weights in exact decimal arithmetic that add to exactly 100 at `d` decimals: each typed weight scaled
 * in proportion, floored, and the remainder given to the largest fractions first (then the largest legs).
 * No float is involved, so two distinct weights, however small, are never both rounded to zero by
 * precision (Codex R-20). */
function toHundredExact(typed: string[], d: number): string[] {
  const xs = typed.map(exact);
  const dd = Math.max(0, ...xs.map((x) => x.d));
  const ws = xs.map((x) => x.v * 10n ** BigInt(dd - x.d));
  const sum = ws.reduce((a, b) => a + b, 0n);
  if (!ws.length || sum <= 0n) return ws.map(() => "0");
  const whole = 100n * 10n ** BigInt(d);
  const units = ws.map((w) => (w * whole) / sum);
  const rems = ws.map((w, i) => w * whole - units[i] * sum);
  let left = whole - units.reduce((a, b) => a + b, 0n);
  const order = ws.map((_, i) => i).sort((a, b) => (rems[b] > rems[a] ? 1 : rems[b] < rems[a] ? -1 : ws[b] > ws[a] ? 1 : ws[b] < ws[a] ? -1 : 0));
  for (const i of order) {
    if (left <= 0n) break;
    units[i] += 1n;
    left -= 1n;
  }
  return units.map((u) => {
    if (d === 0) return u.toString();
    const t = u.toString().padStart(d + 1, "0");
    return `${t.slice(0, -d)}.${t.slice(-d)}`.replace(/\.?0+$/, "");
  });
}

/** Weights that add to exactly 100 at `d` decimals: `raw` scaled, rounded, and the
 * rounding's remainder given to the largest legs first. */
function toHundred(raw: number[], d = 1): number[] {
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!raw.length || sum <= 0) return raw.map(() => 0);
  const whole = 100 * 10 ** d;
  const units = raw.map((w) => (w / sum) * whole);
  const floor = units.map(Math.floor);
  let left = whole - floor.reduce((a, b) => a + b, 0);
  const order = units.map((t, i) => ({ i, frac: t - Math.floor(t), w: raw[i] })).sort((a, b) => b.frac - a.frac || b.w - a.w);
  for (const o of order) {
    if (left <= 0) break;
    floor[o.i] += 1;
    left -= 1;
  }
  return floor.map((t) => Number((t / 10 ** d).toFixed(d)));
}

/** A weight as the input shows it: every digit it has (a served 22.11 stays 22.11). */
const fmt = decimal;

/** Equal weights, new values at a tenth that add to exactly 100. */
export function equalWeight(legs: readonly WorkLeg[]): WorkLeg[] {
  const w = toHundred(legs.map(() => 1));
  return legs.map((l, i) => ({ ...l, weight: fmt(w[i]) }));
}

/** Whether the legs are at equal weight as Equal-weight writes them (none, or exactly its values). */
export function isEqualWeight(legs: readonly WorkLeg[]): boolean {
  return !legs.length || legsKey(legs) === legsKey(equalWeight(legs));
}

/** A name added to the basket (desk/books): while the weights are equal they stay equal, the new name
 * included; weights the analyst has typed are kept and the new name comes in at 0%. */
export function addLeg(legs: readonly WorkLeg[], symbol: string, name: string | null = null): { legs: WorkLeg[]; equal: boolean } {
  const next = [...legs, { symbol, name, weight: "0" }];
  return isEqualWeight(legs) ? { legs: equalWeight(next), equal: true } : { legs: next, equal: false };
}

/** Scaled to 100% in proportion, never coarser than the weights as typed (at least a tenth:
 * 22.11 and 77.86 become 22.12 and 77.88); a weight that is not a number counts as zero.
 * Weights that already add to exactly 100% are left as they are. When the legs add to more than
 * 100, each shrinks, so the result carries enough extra decimals that every weight typed above zero
 * stays above zero and distinct weights stay distinct (Codex R-20: two tiny weights, both 0). */
export function normalize(legs: readonly WorkLeg[]): WorkLeg[] {
  if (sumsToHundred(legs)) return legs.map((l) => ({ ...l }));
  const typed = legs.map((l) => (parseWeight(l.weight) == null ? "0" : l.weight.trim()));
  const d0 = Math.max(1, ...typed.map((t) => (t.split(".")[1] ?? "").length));
  const total = Number(totalText(typed.map((weight) => ({ weight }))) ?? "0");
  // Shrinking by 100 / total needs ceil(log10(total / 100)) more decimals, and two more keep a
  // difference of one typed unit at ten units or more after rounding.
  const extra = total > 100 ? Math.ceil(Math.log10(total / 100)) + 2 : 0;
  const w = toHundredExact(typed, d0 + extra);
  return legs.map((l, i) => ({ ...l, weight: w[i] }));
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

/** A weight's exact decimal text, trailing zeros dropped ("22.10" and 22.1 are "22.1"); a text that is
 * not a weight as it stands. */
function canonical(w: number | string): string {
  const t = text(w);
  if (parseWeight(t) == null) return t;
  return t.includes(".") ? t.replace(/\.?0+$/, "") : t.replace(/^0+(?=\d)/, "");
}

/** `NVDA:22,AVGO:16,…`: the legs in one string, each weight in its exact digits (never through a float,
 * so two weights that differ in their 17th digit are two keys; Codex R-20). */
export function legsKey(legs: readonly { symbol: string; weight: number | string }[]): string {
  return legs.map((l) => `${l.symbol}:${canonical(l.weight)}`).join(",");
}

export function toWork(legs: readonly { symbol: string; name: string | null; weight: number | string }[]): WorkLeg[] {
  return legs.map((l) => ({ symbol: l.symbol, name: l.name, weight: typeof l.weight === "number" ? fmt(l.weight) : l.weight.trim() }));
}

/** The legs as this browser saves them: each weight the exact decimal typed; one that is not a number, 0. */
export function savedLegs(legs: readonly WorkLeg[]): { symbol: string; name: string | null; weight: string }[] {
  return legs.map((l) => ({ symbol: l.symbol, name: l.name, weight: parseWeight(l.weight) == null ? "0" : canonical(l.weight) }));
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
  return (
    !!b &&
    typeof b.id === "string" &&
    typeof b.name === "string" &&
    (b.method === undefined || b.method === "hold" || b.method === "monthly") &&
    (b.notional === undefined || (typeof b.notional === "number" && Number.isFinite(b.notional) && b.notional > 0)) &&
    Array.isArray(b.legs) &&
    b.legs.every((l) => l && typeof l.symbol === "string" && ((typeof l.weight === "number" && Number.isFinite(l.weight)) || (typeof l.weight === "string" && parseWeight(l.weight) != null)))
  );
}

/** Every stored entry as stored; a store that is not a JSON list is kept whole, as one entry. */
function readRaw(storage: Pick<Storage, "getItem"> | null): unknown[] {
  let text: string | null = null;
  try {
    text = storage?.getItem(SAVED_BASKETS_KEY) ?? null;
  } catch {
    return [];
  }
  if (text === null) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [text];
  } catch {
    return [text];
  }
}

/** Writes the preset when this browser has no basket store at all (never over a store, even an empty one). */
export function seedPreset(storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): void {
  try {
    if (storage && storage.getItem(SAVED_BASKETS_KEY) === null) storage.setItem(SAVED_BASKETS_KEY, JSON.stringify([PRESET]));
  } catch {
    /* no storage, or it is full: the page says no basket is saved */
  }
}

export function readSaved(storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedBasket[] {
  return readRaw(storage).filter(isSaved);
}

/** Stored entries this page cannot read: kept in this browser through every write, counted, never dropped (§1.8). */
export function unreadableSaved(storage: Pick<Storage, "getItem"> | null = safeStorage()): unknown[] {
  return readRaw(storage).filter((x) => !isSaved(x));
}

export type SaveResult = "ok" | "off" | "full";

function writeAll(list: SavedBasket[], storage: (Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>) | null): SaveResult {
  if (!storage) return "off";
  try {
    const kept = storage.getItem ? unreadableSaved(storage as Pick<Storage, "getItem">) : [];
    storage.setItem(SAVED_BASKETS_KEY, JSON.stringify([...list, ...kept]));
    return "ok";
  } catch {
    return "full";
  }
}

/** Saves (or replaces, by id) one basket: "off" when there is no storage, "full" when it refuses the write. */
export function writeSaved(b: SavedBasket, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): SaveResult {
  return writeAll([...readSaved(storage).filter((x) => x.id !== b.id), b], storage);
}

/** Forgets one saved basket. */
export function removeSaved(id: string, storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): SaveResult {
  return writeAll(readSaved(storage).filter((x) => x.id !== id), storage);
}

/** The saved baskets as a JSON file's text (Export JSON, as Event Study exports its questions, §1.8). */
export function exportSaved(list: readonly SavedBasket[]): string {
  return JSON.stringify({ kind: "mrr.desk.baskets", version: 1, baskets: list }, null, 2);
}

const sameBasket = (x: SavedBasket, y: SavedBasket) => x.name === y.name && legsKey(x.legs) === legsKey(y.legs);

/** A JSON file's baskets merged into the list, never replacing one. A basket
 * already here (same name and legs, under any number) is skipped. One whose
 * id is taken here, or is not `local-<n>` (a basket a server once kept; none
 * is served now, §10), gets a fresh `local-<n>`: every browser numbers from
 * `local-1`, so collisions are the normal case. Unreadable entries are
 * counted, not kept. */
export function importSaved(list: readonly SavedBasket[], text: string): { list: SavedBasket[]; added: number; rejected: number; renumbered: number; skipped: number } {
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
    const keepId = !taken && b.id.startsWith("local-");
    const id = keepId ? b.id : newBasketId(out);
    if (!keepId) renumbered += 1;
    out = [...out, { ...b, id }];
    added += 1;
  }
  return { list: out, added, rejected: items.length - good.length, renumbered, skipped };
}

/** Writes a whole list (after an import). */
export function writeAllSaved(list: SavedBasket[], storage: (Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>) | null = safeStorage()): SaveResult {
  return writeAll(list, storage);
}

/** An id for a new basket, `local-<n>`, not taken by a saved one. */
export function newBasketId(saved: readonly SavedBasket[]): string {
  let n = 1;
  while (saved.some((b) => b.id === `local-${n}`)) n += 1;
  return `local-${n}`;
}
