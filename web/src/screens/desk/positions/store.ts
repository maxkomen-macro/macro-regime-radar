/**
 * The position store (DESK_FRAME3_SPEC §1.8, §9; v3 §16, v4 B-10): positions
 * live in this browser's localStorage under a versioned key, with Export /
 * Import JSON, and nothing is posted. The record is §12.13's; §9's gate rule
 * is its validation, published so a future server applies it identically.
 * Validation runs on Save, on Import and on load: a stored or imported
 * record that fails stays in storage and is listed as unreadable, never
 * dropped. Pure except the storage calls.
 */

import type { Question } from "../data/types";
import { isQuestion } from "../event-study/question";
import { isCalendarDate } from "./sessions";
import { findFlags } from "./wording";

export const POSITIONS_KEY = "mrr.desk.positions.v1";
export const POSITION_HORIZONS: readonly number[] = [5, 10, 20, 60];

export type Operator = "below" | "above";
/** The two monitored quantities the Desk serves (B-10): the S&P against its 50-day, 2s10s against a bp level. */
export type MonitoredSeries = "spx" | "curve_2s10s";

export interface Trigger {
  series: MonitoredSeries;
  operator: Operator;
  /** Frozen at entry. */
  threshold: number;
  policy: "frozen";
  /** The date of the served value the threshold and the entry value were read on. */
  observed_on: string;
}

export type Subject =
  | { kind: "study"; question: Question }
  | { kind: "basket"; legs: { symbol: string; weight: number }[]; benchmark: string | null }
  | { kind: "instrument"; id: string };

export type CloseType = "falsified" | "expired" | "closed";

export interface CloseEvent {
  type: CloseType;
  ts: string;
  /** The analyst's explicit yes or no at close; null when not judged. */
  premortem_right: boolean | null;
}

export interface PositionRecord {
  id: string;
  instrument: string;
  direction: "long" | "short";
  /** A share of NAV (0.02 = 2%), or null when saved without a size. */
  size_nav: number | null;
  horizon_days: number;
  variant: string;
  pre_mortem: string;
  red_team: string | null;
  wrong_if: { id: string; label: string };
  subject: Subject;
  monitoring: "automatic" | "manual";
  entry_ts: string;
  entry_date: string;
  entry_value: number | null;
  trigger: Trigger | null;
  /** Signed distance at entry; positive for an automatic position, null for a manual one. */
  original_room: number | null;
  evaluation: "close";
  closes: CloseEvent[];
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const filled = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isTs = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) && !Number.isNaN(Date.parse(x));
const CLOSE_TYPES: readonly string[] = ["falsified", "expired", "closed"];

/** §9's signed distance: value − threshold for a below-level falsifier, threshold − value for an
 * above-level one; the same orientation at entry and now, so room is positive until the level is crossed. */
export function signedDistance(value: number, t: Pick<Trigger, "operator" | "threshold">): number {
  return t.operator === "below" ? value - t.threshold : t.threshold - value;
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** The monitored series by their names: §12.7's `/technicals` describes the registry series `spx`
 * (^GSPC) and §12.8 serves 2s10s. Exact names only (Codex R-08): SPY, an ES future or an SPX option
 * is not the index, and "2s10s steepener" is a trade, not the curve. */
const SERIES_NAMES: Readonly<Record<MonitoredSeries, readonly string[]>> = { spx: ["s&p 500", "spx", "^gspc"], curve_2s10s: ["2s10s", "curve_2s10s"] };

/** The series a typed instrument is, or null for any other instrument. */
export function monitoredSeriesOf(instrument: string): MonitoredSeries | null {
  const typed = norm(instrument);
  return (Object.keys(SERIES_NAMES) as MonitoredSeries[]).find((k) => SERIES_NAMES[k].includes(typed)) ?? null;
}

/** The levels that monitor a series automatically, with the side of the level each falsifies on. */
export const AUTOMATIC_LEVELS: Readonly<Record<string, { series: MonitoredSeries; operator: Operator }>> = {
  below_50d: { series: "spx", operator: "below" },
  above_50d: { series: "spx", operator: "above" },
  curve_down_10: { series: "curve_2s10s", operator: "below" },
  curve_down_25: { series: "curve_2s10s", operator: "below" },
  curve_up_10: { series: "curve_2s10s", operator: "above" },
  curve_up_25: { series: "curve_2s10s", operator: "above" },
};

function whySubject(v: unknown): string | null {
  const s = v as Subject | null;
  if (!s || typeof s !== "object") return "no subject";
  if (s.kind === "study") return isQuestion(s.question) ? null : "a study subject without its full question";
  if (s.kind === "basket") {
    const legsOk = Array.isArray(s.legs) && s.legs.length > 0 && s.legs.every((l) => l && filled(l.symbol) && fin(l.weight));
    return legsOk && (s.benchmark === null || typeof s.benchmark === "string") ? null : "a basket subject without readable legs";
  }
  if (s.kind === "instrument") return filled(s.id) ? null : "an instrument subject without its id";
  return "a subject that is not a study, a basket or an instrument";
}

function whyTrigger(r: Record<string, unknown>, levelId: string): string | null {
  const t = r.trigger as Trigger | null;
  if (!t || typeof t !== "object") return "an automatic position without its level";
  const rule = AUTOMATIC_LEVELS[levelId];
  if (!rule || rule.series !== t.series || rule.operator !== t.operator) return "an automatic position on a level the Desk does not monitor";
  // §9: automatic only when the subject's monitored quantity is the served series itself; a basket is not.
  if ((r.subject as Subject).kind === "basket") return "a basket monitored automatically";
  if (monitoredSeriesOf(String(r.instrument)) !== t.series) return "an automatic level on an instrument that is not its series";
  // A long is wrong below its level, a short above it.
  if ((r.direction === "long") !== (t.operator === "below")) return "a level on the wrong side for the direction";
  if (!fin(t.threshold) || t.policy !== "frozen" || !isCalendarDate(t.observed_on)) return "an automatic position whose level cannot be read";
  if (!fin(r.entry_value)) return "an automatic position without its value at entry";
  if (!fin(r.original_room) || r.original_room <= 0) return "an automatic position without room at entry";
  const d = signedDistance(r.entry_value, t);
  if (Math.abs(d - r.original_room) > 1e-9 * Math.max(1, Math.abs(d))) return "a room at entry that does not match its level";
  return null;
}

/**
 * Why a record cannot be read, in words, or null when it passes §9's rule:
 * the gate (instrument, variant view, pre-mortem, a "wrong if" level, a size
 * from 0 to 100% of NAV or none, a horizon of 5, 10, 20 or 60 days, no
 * certainty word), the subject, and the monitoring (automatic with a frozen
 * level and a positive room at entry, or manual with no level and no room).
 */
export function whyUnreadable(v: unknown): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "not a position record";
  const r = v as Record<string, unknown>;
  if (!filled(r.id)) return "a record without an id";
  if (!filled(r.instrument)) return "no instrument";
  if (r.direction !== "long" && r.direction !== "short") return "a direction that is not long or short";
  if (!(r.size_nav === null || (fin(r.size_nav) && r.size_nav >= 0 && r.size_nav <= 1))) return "a size that is not a share of NAV from 0 to 100%";
  if (!POSITION_HORIZONS.includes(r.horizon_days as number)) return "a horizon that is not 5, 10, 20 or 60 trading days";
  if (!filled(r.variant)) return "no variant view";
  if (!filled(r.pre_mortem)) return "no pre-mortem";
  const words = [...findFlags(r.variant, "variant"), ...findFlags(r.pre_mortem, "pre_mortem")].map((f) => f.word);
  if (words.length) return `certainty words in the variant view or the pre-mortem (${[...new Set(words)].join(", ")})`;
  if (!(r.red_team === null || typeof r.red_team === "string")) return "a red team that is not text";
  const w = r.wrong_if as { id?: unknown; label?: unknown } | null;
  if (!w || typeof w !== "object" || !filled(w.id) || !filled(w.label)) return "no “wrong if” level";
  const subject = whySubject(r.subject);
  if (subject) return subject;
  if (w.id === "signal_reverses" && (r.subject as Subject).kind !== "study") return "“the signal reverses” without the study it comes from";
  if (!isTs(r.entry_ts)) return "no entry time";
  if (!isCalendarDate(r.entry_date)) return "no entry date";
  if (r.evaluation !== "close") return "an evaluation that is not at the close";
  const closes = r.closes as CloseEvent[];
  if (!Array.isArray(closes) || !closes.every((c) => c && CLOSE_TYPES.includes(c.type) && isTs(c.ts) && (c.premortem_right === null || typeof c.premortem_right === "boolean")))
    return "a close that cannot be read";
  if (r.monitoring === "manual") {
    if (r.trigger !== null || r.original_room !== null) return "a manual position carrying an automatic level";
    return r.entry_value === null || fin(r.entry_value) ? null : "an entry value that is not a number";
  }
  if (r.monitoring !== "automatic") return "a monitoring that is not automatic or manual";
  return whyTrigger(r, w.id);
}

export const isOpen = (p: PositionRecord) => p.closes.length === 0;

// ── Storage ──────────────────────────────────────────────────────────────

export interface Unreadable {
  /** The record exactly as stored or imported, kept so nothing is lost. */
  raw: unknown;
  why: string;
}

export interface PositionStore {
  positions: PositionRecord[];
  unreadable: Unreadable[];
}

export type SaveResult = "ok" | "off" | "full";

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Records read in order: the first of an id is kept, a second of the same id is unreadable. */
export function sortOut(list: readonly unknown[]): PositionStore {
  const positions: PositionRecord[] = [];
  const unreadable: Unreadable[] = [];
  for (const raw of list) {
    const why = typeof raw === "string" ? "text that is not a position record" : whyUnreadable(raw);
    if (why) unreadable.push({ raw, why });
    else if (positions.some((p) => p.id === (raw as PositionRecord).id)) unreadable.push({ raw, why: "a second record with the same id" });
    else positions.push(raw as PositionRecord);
  }
  return { positions, unreadable };
}

/** The store as this browser keeps it; storage that is not a JSON list is kept whole, as one unreadable entry. */
export function loadPositions(storage: Pick<Storage, "getItem"> | null = safeStorage()): PositionStore {
  let text: string | null = null;
  try {
    text = storage?.getItem(POSITIONS_KEY) ?? null;
  } catch {
    return { positions: [], unreadable: [] };
  }
  if (text === null) return { positions: [], unreadable: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return sortOut([text]);
  }
  return sortOut(Array.isArray(parsed) ? parsed : [text]);
}

/** Writes the whole store, unreadable entries kept as they came. */
export function writePositions(store: PositionStore, storage: Pick<Storage, "setItem"> | null = safeStorage()): SaveResult {
  if (!storage) return "off";
  try {
    storage.setItem(POSITIONS_KEY, JSON.stringify([...store.positions, ...store.unreadable.map((u) => u.raw)]));
    return "ok";
  } catch {
    return "full";
  }
}

/** An id for a new position, not taken in the store. */
export function newPositionId(store: PositionStore, now: Date): string {
  const base = `p${now.getTime().toString(36)}`;
  const taken = (id: string) => store.positions.some((p) => p.id === id) || store.unreadable.some((u) => (u.raw as { id?: unknown } | null)?.id === id);
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}-${n}`;
  return id;
}

/** The store with a position closed by an explicit event (§9: nothing closes on its own). */
export function withClose(store: PositionStore, id: string, type: CloseType, premortemRight: boolean | null, now: Date): PositionStore {
  return {
    ...store,
    positions: store.positions.map((p) => (p.id === id && isOpen(p) ? { ...p, closes: [...p.closes, { type, ts: now.toISOString(), premortem_right: premortemRight }] } : p)),
  };
}

/** §9's CLOSED · LAST 90D: the stored close events of the last 90 days. */
export function closed90d(store: PositionStore, now: Date): { falsified: number; expired: number; premortem_right: [number, number] } {
  const since = now.getTime() - 90 * 86_400_000;
  const events = store.positions.flatMap((p) => p.closes).filter((c) => {
    const t = Date.parse(c.ts);
    return t >= since && t <= now.getTime();
  });
  const judged = events.filter((c) => c.premortem_right !== null);
  return {
    falsified: events.filter((c) => c.type === "falsified").length,
    expired: events.filter((c) => c.type === "expired").length,
    premortem_right: [judged.filter((c) => c.premortem_right).length, judged.length],
  };
}

// ── Export / Import JSON (§1.8) ──────────────────────────────────────────

/** The whole store as a file's text, unreadable entries included, so an export loses nothing. */
export function exportPositions(store: PositionStore): string {
  return JSON.stringify({ kind: "mrr.desk.positions", version: 1, positions: [...store.positions, ...store.unreadable.map((u) => u.raw)] }, null, 2);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A file's positions merged into the store, never replacing one: an id is a
 * position (its time of entry), so a record whose id is already here is that
 * position and is skipped, the one here kept, closes and all (a copy would
 * count its closes twice). One that fails §9's rule joins the unreadable
 * list (§9: validation on Import, never dropped). A file that is not a
 * position list changes nothing.
 */
export function importPositions(store: PositionStore, text: string): { store: PositionStore; added: number; unreadable: number; skipped: number } | null {
  let items: unknown;
  try {
    const doc = JSON.parse(text) as unknown;
    items = Array.isArray(doc) ? doc : (doc as { positions?: unknown } | null)?.positions;
  } catch {
    return null;
  }
  if (!Array.isArray(items)) return null;
  let out: PositionStore = { positions: [...store.positions], unreadable: [...store.unreadable] };
  let added = 0;
  let unreadable = 0;
  let skipped = 0;
  for (const raw of items) {
    const why = whyUnreadable(raw);
    if (why) {
      if (out.unreadable.some((u) => same(u.raw, raw))) skipped += 1;
      else {
        out = { ...out, unreadable: [...out.unreadable, { raw, why }] };
        unreadable += 1;
      }
      continue;
    }
    const p = raw as PositionRecord;
    if (out.positions.some((q) => q.id === p.id)) {
      skipped += 1;
      continue;
    }
    out = { ...out, positions: [...out.positions, p] };
    added += 1;
  }
  return { store: out, added, unreadable, skipped };
}
