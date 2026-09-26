/**
 * The Event Study's question (DESK_FRAME3_SPEC §4, §12.2), pure: the nine
 * presets, the six slots' fixed options, the URL that addresses a question
 * (the page's address mirrors the API's parameters: `?preset=<slug>` or the
 * six slots; §12.2 has no `confidence` parameter), the question in words, the engine study a
 * question maps onto (for the Advanced panel's frame-2 detail), and the saved
 * questions kept in this browser (§1.8) with their JSON export and import.
 */

import type { Move, Question } from "../data/types";
import { paramsFor } from "./studies";

/** §4's nine chips, in the spec's order, each its catalog label (§12.3); the served catalog's label and availability win. */
export const PRESET_CHIPS: readonly { slug: string; label: string }[] = [
  { slug: "gold-2sigma-spx-weak", label: "Gold +2σ while S&P weak" },
  { slug: "golden-cross", label: "S&P golden cross" },
  { slug: "death-cross", label: "S&P death cross" },
  { slug: "vix-spike-2sigma-5d", label: "VIX spike +2σ, 5 days" },
  { slug: "hy-2sigma-20d", label: "HY spreads +2σ, 20 days" },
  { slug: "10y-2sigma-20d", label: "10y yield +2σ, 20 days" },
  { slug: "dollar-2sigma-20d", label: "Dollar −2σ, 20 days" },
  { slug: "oil-2sigma-gold", label: "Oil +2σ → gold" },
  { slug: "spx-2sigma-10y", label: "S&P −2σ → 10y" },
];

/** §12.2: 5 | 20 | 60 sessions; a cross has none. */
export const WINDOWS: readonly number[] = [5, 20, 60];

/** A cross is the S&P's own 50/200-day averages crossing: it has no window (§4, §12.2). */
export const isCross = (m: Move) => m === "cross_above" || m === "cross_below";

export const MOVES: readonly { id: Move; label: string }[] = [
  { id: "up2s", label: "up 2σ or more" },
  { id: "down2s", label: "down 2σ or more" },
  { id: "cross_above", label: "crosses above MA" },
  { id: "cross_below", label: "crosses below MA" },
];

export const REGIMES: readonly string[] = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];

export const WHILES: readonly { id: string; label: string }[] = [
  { id: "none", label: "none" },
  { id: "spx_below_50", label: "S&P below its 50-day" },
  ...REGIMES.map((r) => ({ id: `regime:${r}`, label: `regime = ${r}` })),
];

export const HORIZONS: readonly { h: number; label: string }[] = [
  { h: 5, label: "1 week" },
  { h: 10, label: "2 weeks" },
  { h: 20, label: "1 month" },
  { h: 60, label: "3 months" },
];

/** The rail's confidence chips (§4): shown, disabled, "not yet served"; 90% is the engine's served level. */
export const CONFIDENCES: readonly number[] = [0.8, 0.9, 0.95];

/** The address of what the page asks: a preset, or the six slots (§12.2: no `confidence`). */
export type Ask = { preset: string } | { question: Question };

const MOVE_IDS = new Set(MOVES.map((m) => m.id));
const WHILE_IDS = new Set(WHILES.map((w) => w.id));

/** What an address asks that §12.2 no longer serves (window 10, the S&P above its 50-day), in words; null when nothing.
 * The page says so when it opens the default question instead (§12.0: never a silent parameter drop). */
export function withdrawnIn(search: string | URLSearchParams): string | null {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  const out = [p.get("window") === "10" ? "a 10-day window" : null, p.get("while") === "spx_above_50" ? "the S&P above its 50-day" : null].filter(Boolean);
  return out.length ? out.join(" and ") : null;
}

/** The ask a query string names; the gold preset when it names nothing usable. */
export function askFromSearch(search: string | URLSearchParams): Ask {
  const p = typeof search === "string" ? new URLSearchParams(search) : search;
  // A preset is any study slug: the nine chips, or a Ledger row's (§8: a row opens its study).
  const preset = p.get("preset");
  if (preset && /^[a-z0-9][a-z0-9-]{0,80}$/.test(preset)) return { preset };
  // A frame-2 link (?study=<engine slug>) opens the same question when the six slots can ask it.
  const fromEngine = questionFromEngine(p.get("study"));
  if (fromEngine) return { question: fromEngine };
  const horizon = Number(p.get("horizon"));
  const move = p.get("move") as Move | null;
  // A cross has no window (§12.2: omitted for a cross); any other move needs one of 5, 20, 60.
  const window = move && isCross(move) ? null : Number(p.get("window"));
  const wh = p.get("while") ?? "none";
  const shock = p.get("shock");
  const target = p.get("target");
  const q = shock && target && move ? { shock, window, move, while: wh, target, horizon } : null;
  if (q && isQuestion(q)) return { question: q };
  return { preset: PRESET_CHIPS[0].slug };
}

/** The query string for an ask, with the Desk / Client view and the tour kept from `keep`. */
export function searchFor(ask: Ask, keep?: URLSearchParams): string {
  const p = new URLSearchParams();
  for (const k of ["view", "tour"]) {
    const v = keep?.get(k);
    if (v) p.set(k, v);
  }
  if ("preset" in ask) p.set("preset", ask.preset);
  else {
    const q = ask.question;
    p.set("shock", q.shock);
    if (q.window != null) p.set("window", String(q.window));
    p.set("move", q.move);
    p.set("while", q.while);
    p.set("target", q.target);
    p.set("horizon", String(q.horizon));
  }
  return p.toString();
}

/** The API parameters for an ask (§12.2). */
export function apiParams(ask: Ask): Record<string, string | number | undefined> {
  if ("preset" in ask) return { preset: ask.preset };
  const q = ask.question;
  return { shock: q.shock, window: q.window ?? undefined, move: q.move, while: q.while, target: q.target, horizon: q.horizon };
}

/** The same ask at h = 20 (v4 B-01: the Client view reads the month, whatever horizon the desk has
 * selected). A preset already asks h = 20, §12.2's default. */
export function atMonth(ask: Ask): Ask {
  return "question" in ask ? { ...ask, question: { ...ask.question, horizon: 20 } } : ask;
}

/** The six slots and nothing else: a served question also carries its target's unit and name
 * (§12.13), which are the answer's, never the question's (Codex R-11). */
export function slotsOf(q: Question): Question {
  return { shock: q.shock, window: q.window, move: q.move, while: q.while, target: q.target, horizon: q.horizon };
}

export function sameQuestion(a: Question | null | undefined, b: Question | null | undefined): boolean {
  return !!a && !!b && a.shock === b.shock && a.window === b.window && a.move === b.move && a.while === b.while && a.target === b.target && a.horizon === b.horizon;
}

export const moveLabel = (m: Move) => MOVES.find((x) => x.id === m)?.label ?? m;
export const whileLabel = (w: string) => WHILES.find((x) => x.id === w)?.label ?? w;
export const horizonLabel = (h: number) => HORIZONS.find((x) => x.h === h)?.label ?? `${h} sessions`;

/** The question in one line, from the series' served labels. */
export function questionWords(q: Question, label: (key: string) => string): string {
  const cond = q.while === "none" ? "" : ` while ${whileLabel(q.while)}`;
  const over = q.window == null ? "" : ` over ${q.window} days`;
  return `${label(q.shock)} ${moveLabel(q.move)}${over}${cond} → ${label(q.target)} over the next ${horizonLabel(q.horizon)}`;
}


/** The six slots for a frame-2 engine slug, when they can ask it (a month out). */
export function questionFromEngine(slug: string | null): Question | null {
  const e = paramsFor(slug);
  // The six slots ask 2σ moves over every regime; any other engine study is a different question.
  if (!e || e.z !== 2 || e.regime !== "all") return null;
  if (e.kind === "cross") return { shock: e.target, window: null, move: e.cross === "death" ? "cross_below" : "cross_above", while: "none", target: e.target, horizon: 20 };
  if (e.sign === "both" || !WINDOWS.includes(e.w)) return null;
  const regime = e.cond.startsWith("regime=") ? REGIMES.find((r) => r.toLowerCase().replace(/ /g, "_") === e.cond.slice(7)) : undefined;
  const wh = e.cond === "none" ? "none" : e.cond === "spx_below_50dma" ? "spx_below_50" : regime ? `regime:${regime}` : null;
  if (!wh) return null;
  return { shock: e.shock, window: e.w, move: e.sign === "+" ? "up2s" : "down2s", while: wh, target: e.target, horizon: 20 };
}

/** The address of an ask (preset or the six slots) as query parameters, for a link that carries it. */
export function askParams(ask: Ask): [string, string][] {
  return [...new URLSearchParams(searchFor(ask)).entries()];
}

// ── Saved questions (§1.8: localStorage per browser, Export / Import JSON) ──

export interface SavedQuestion {
  id: string;
  name: string;
  question: Question;
  saved_at: string;
}

/** The last question Event Study answered in this browser (Data Pipeline's "current study"). */
export const LAST_STUDY_KEY = "mrr.desk.last-study.v1";

/** The last study's query string, or null when none is kept (or storage is off). */
export function readLastStudy(storage: Pick<Storage, "getItem"> | null = safeStorage()): string | null {
  try {
    const v = storage?.getItem(LAST_STUDY_KEY);
    return typeof v === "string" && v ? v : null;
  } catch {
    return null;
  }
}

export function writeLastStudy(search: string, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(LAST_STUDY_KEY, search);
  } catch {
    // A private window or blocked storage: the export falls back to the default study.
  }
}

export const SAVED_KEY = "mrr.desk.saved-questions.v1";

/** A question the slots can ask: six known values (extra fields are the caller's to refuse). */
export function isQuestion(v: unknown): v is Question {
  const q = v as Question;
  if (!q || typeof q.shock !== "string" || typeof q.target !== "string" || !MOVE_IDS.has(q.move)) return false;
  // A cross has no window; every other move has one of 5, 20, 60 (§12.2).
  const windowOk = isCross(q.move) ? q.window === null : typeof q.window === "number" && WINDOWS.includes(q.window);
  return windowOk && HORIZONS.some((h) => h.h === q.horizon) && WHILE_IDS.has(q.while);
}

function isSaved(v: unknown): v is SavedQuestion {
  const s = v as SavedQuestion;
  return !!s && typeof s.id === "string" && typeof s.name === "string" && typeof s.saved_at === "string" && isQuestion(s.question);
}

/** A saved question as this page reads it: a cross saved by the old slots (window 20) has no window (§12.2). */
function normalized(v: unknown): unknown {
  const s = v as SavedQuestion;
  if (!s || typeof s !== "object" || !s.question || typeof s.question !== "object") return v;
  return isCross(s.question.move) && s.question.window != null ? { ...s, question: { ...s.question, window: null } } : v;
}

function readRaw(storage: Pick<Storage, "getItem"> | null): unknown[] {
  const raw = storage?.getItem(SAVED_KEY);
  const parsed = raw ? (JSON.parse(raw) as unknown) : [];
  return Array.isArray(parsed) ? parsed : [];
}

export function loadSaved(storage: Pick<Storage, "getItem"> | null = safeStorage()): SavedQuestion[] {
  try {
    return readRaw(storage).map(normalized).filter(isSaved);
  } catch {
    return [];
  }
}

/** Saved questions this page can no longer ask (a 10-day window, the S&P above its 50-day): kept in storage, counted, never dropped (§1.8). */
export function unreadableSaved(storage: Pick<Storage, "getItem"> | null = safeStorage()): unknown[] {
  try {
    return readRaw(storage).map(normalized).filter((x) => !isSaved(x));
  } catch {
    return [];
  }
}

/** The list written back with every entry this page cannot read kept as it was (§1.8: never dropped). */
export function writeSaved(list: SavedQuestion[], storage: (Pick<Storage, "setItem"> & Partial<Pick<Storage, "getItem">>) | null = safeStorage()): void {
  try {
    const kept = storage && "getItem" in storage && storage.getItem ? unreadableSaved(storage as Pick<Storage, "getItem">) : [];
    storage?.setItem(SAVED_KEY, JSON.stringify([...list, ...kept]));
  } catch {
    /* storage full or blocked: the list lives for this page only */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** A new list with the question saved under a name (a question saved twice keeps one copy). */
export function withSaved(list: SavedQuestion[], q: Question, name: string, now = new Date()): SavedQuestion[] {
  if (list.some((s) => sameQuestion(s.question, q))) return list;
  return [...list, { id: `q${now.getTime().toString(36)}${list.length}`, name, question: q, saved_at: now.toISOString() }];
}

export function exportSaved(list: SavedQuestion[]): string {
  return JSON.stringify({ kind: "desk-saved-questions", version: 1, questions: list }, null, 2);
}

/** Questions from an exported file, merged into `list`; malformed entries are counted, not kept. */
export function importSaved(list: SavedQuestion[], text: string): { list: SavedQuestion[]; added: number; rejected: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { list, added: 0, rejected: 1 };
  }
  const items = Array.isArray(parsed) ? parsed : (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(items)) return { list, added: 0, rejected: 1 };
  let out = list;
  let added = 0;
  let rejected = 0;
  for (const raw of items) {
    const it = normalized(raw);
    if (!isSaved(it)) {
      rejected += 1;
      continue;
    }
    if (out.some((s) => s.id === it.id || sameQuestion(s.question, it.question))) continue;
    out = [...out, it];
    added += 1;
  }
  return { list: out, added, rejected };
}

/** The study's target, named by its `series[]` entry (§12.2 serves no separate target name); null when
 * the target is not listed, and the page then leaves it unnamed rather than guessing from the key. */
export function targetLabel(s: { question?: { target?: string }; series?: { key: string; label: string }[] } | null | undefined): string | null {
  const key = s?.question?.target;
  const hit = key && Array.isArray(s?.series) ? s.series.find((x) => x.key === key) : undefined;
  return typeof hit?.label === "string" && hit.label ? hit.label : null;
}
