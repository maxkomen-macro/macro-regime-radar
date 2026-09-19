/**
 * Per-series freshness words (Iteration 1, A3): the one renderer for the
 * `SeriesState` objects `/api/freshness` serves in `series[]` and the
 * endpoints carry in their `freshness` blocks. It implements
 * docs/redesign-v2/FRESHNESS_CONTRACT.md §5 and nothing else: the screen
 * never re-derives freshness, it prints the state the server judged.
 *
 *   live      "Live"                              mint
 *   delayed   "Delayed 7 min"                     amber
 *   close     "Close · Sep 18" (market, relay)    neutral
 *             "Sep 17" + muted "· 1 day behind" (FRED daily, derived)
 *             "Aug 2026 print" (monthly)
 *             "Final value · Feb 2020" (discontinued, never stale)
 *   stale     "Sep 04 · 8 days behind"            stale mark on the number
 *   fallback  "Stated default"                    grey badge
 *   unknown   "As of unknown"                     grey, never a healthy dot
 *
 * Dates are read by splitting the ISO string (no Date, so no time-zone
 * drift), except relay ticks, which are UTC instants and take their New York
 * calendar date. Pure: no React, no DOM.
 */

import type { FreshState, Freshness, SeriesState } from "../../api/types";

// Iteration 1 step 6: this module is the only freshness vocabulary on
// screen. The older browser age heuristic (./freshness.ts assessFreshness)
// re-derived states from stamps and no display path reads it any more.

export type FreshTone = "live" | "delayed" | "neutral" | "stale" | "fallback" | "unknown";

export interface FreshLabel {
  /** The word or stamp, e.g. "Close · Sep 18". */
  word: string;
  /** Muted tail for FRED daily closes behind the newest print, else null. */
  muted: string | null;
  tone: FreshTone;
  /** The server's plain sentence, for a tooltip or Details ("" when none). */
  reason: string;
  /** Mark the number itself (state "stale" only). */
  stale: boolean;
}

const STATES: readonly FreshState[] = ["live", "delayed", "close", "stale", "fallback", "unknown"];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** Any word outside the six (or a non-string) is "unknown", never healthy. */
export function normalizeState(x: unknown): FreshState {
  return typeof x === "string" && (STATES as readonly string[]).includes(x) ? (x as FreshState) : "unknown";
}

/* ── Date parts ──────────────────────────────────────────────────────────── */

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number;
}

const NY_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** An ISO instant (a time with Z or an offset): a relay tick in UTC. A bare
 * "YYYY-MM-DD HH:MM:SS" carries no zone and is New York wall time. */
function isInstant(s: string): boolean {
  return /[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i.test(s);
}

/** The calendar date an `as_of` names. Relay UTC instants take their New York
 * date; everything else is read from its leading YYYY-MM-DD (a New York wall
 * stamp "YYYY-MM-DD HH:MM:SS" is already local). */
function ymd(s: string | null | undefined): Ymd | null {
  if (!s) return null;
  const t = s.trim();
  if (isInstant(t)) {
    // Trim sub-millisecond digits (Python isoformat) and use the "T"
    // separator before parsing.
    const ms = Date.parse(t.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"));
    if (Number.isNaN(ms)) return null;
    const parts = NY_PARTS.formatToParts(new Date(ms));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const y = get("year");
    const m = get("month");
    const d = get("day");
    return Number.isFinite(y) && m >= 1 && m <= 12 && d >= 1 ? { y, m, d } : null;
  }
  const match = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(t);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = match[3] ? Number(match[3]) : 1;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** "Sep 04" (zero-padded day), or null when the stamp is unreadable. */
export function monDD(s: string | null | undefined): string | null {
  const p = ymd(s);
  return p ? `${MONTHS[p.m - 1]} ${String(p.d).padStart(2, "0")}` : null;
}

/** "Aug 2026", or null when the stamp is unreadable. */
export function monYYYY(s: string | null | undefined): string | null {
  const p = ymd(s);
  return p ? `${MONTHS[p.m - 1]} ${p.y}` : null;
}

/* ── Labels ──────────────────────────────────────────────────────────────── */

const UNKNOWN_WORD = "As of unknown";

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Market data counts NYSE sessions, monthly series count releases, FRED
 * daily (and derived) values count business days (FRESHNESS_CONTRACT §4). */
function behindUnit(s: SeriesState, n: number): string {
  if (s.cadence === "monthly") return plural(n, "release", "releases");
  if (s.kind === "market" || s.kind === "live") return plural(n, "session", "sessions");
  return plural(n, "day", "days");
}

function label(word: string, tone: FreshTone, reason: string, extra: Partial<FreshLabel> = {}): FreshLabel {
  return { word, muted: null, tone, reason, stale: false, ...extra };
}

/** The §5 word, muted tail and tone for one series state. Null or undefined
 * input (a series the report does not carry) reads "As of unknown". */
export function freshLabel(s: SeriesState | null | undefined): FreshLabel {
  if (!s) return label(UNKNOWN_WORD, "unknown", "");
  const reason = typeof s.reason === "string" ? s.reason : "";
  const state = normalizeState(s.state);

  switch (state) {
    case "live":
      return label("Live", "live", reason);

    case "delayed":
      return label(s.delay_min != null ? `Delayed ${s.delay_min} min` : "Delayed", "delayed", reason);

    case "close": {
      if (s.discontinued) {
        const month = monYYYY(s.as_of);
        return month ? label(`Final value · ${month}`, "neutral", reason) : label(UNKNOWN_WORD, "unknown", reason);
      }
      if (s.cadence === "monthly") {
        const month = monYYYY(s.as_of);
        return month ? label(`${month} print`, "neutral", reason) : label(UNKNOWN_WORD, "unknown", reason);
      }
      const day = monDD(s.as_of);
      if (!day) return label(UNKNOWN_WORD, "unknown", reason);
      if (s.kind === "market" || s.kind === "live") return label(`Close · ${day}`, "neutral", reason);
      // FRED daily and derived values: the date alone, with the muted tail
      // when the newest print due is not the one stored.
      const n = s.cycles_behind;
      return label(day, "neutral", reason, { muted: n != null && n > 0 ? `· ${plural(n, "day", "days")} behind` : null });
    }

    case "stale": {
      const stamp = s.cadence === "monthly" ? monYYYY(s.as_of) : monDD(s.as_of);
      const n = s.cycles_behind;
      const behind = n != null && n > 0 ? `${behindUnit(s, n)} behind` : null;
      const word = stamp ? (behind ? `${stamp} · ${behind}` : `${stamp} · stale`) : (behind ?? "Stale");
      return label(word, "stale", reason, { stale: true });
    }

    case "fallback":
      return label("Stated default", "fallback", reason);

    default:
      return label(UNKNOWN_WORD, "unknown", reason);
  }
}

/** A seeded snapshot (`seeded: true`): every state is unknown, so the shell
 * shows the snapshot's own stamp and no health dot. */
export function seededLabel(generatedAt: string | null | undefined): FreshLabel {
  const day = monDD(generatedAt);
  return label(`Snapshot · as of ${day ?? "unknown"}`, "unknown", "");
}

/** One series from the report by id; undefined when the report, its
 * series[] or that id is absent. */
export function seriesById(f: Freshness | null | undefined, id: string): SeriesState | undefined {
  return f?.series?.find((s) => s?.id === id);
}

/** The plain-words line every tab prints when the newest stored close is
 * older than the last completed session (A3), else null. */
export function storedCloseLine(f: Freshness | null | undefined): string | null {
  const daily = seriesById(f, "market_daily");
  if (!daily || normalizeState(daily.state) !== "stale") return null;
  const stored = monDD(daily.as_of);
  const due = monDD(f?.session?.last_completed_session);
  if (!stored) return null;
  return due
    ? `The newest stored close is ${stored}; the ${due} close is not stored yet.`
    : `The newest stored close is ${stored}; newer closes are not stored yet.`;
}

/** The same fact in a phone's one line ("Stored close Sep 14; Sep 18 not
 * stored yet."), else null. The shell prints it in place of storedCloseLine
 * where the full sentence would wrap; the full one stays for screen readers. */
export function storedCloseShort(f: Freshness | null | undefined): string | null {
  const daily = seriesById(f, "market_daily");
  if (!daily || normalizeState(daily.state) !== "stale") return null;
  const stored = monDD(daily.as_of);
  const due = monDD(f?.session?.last_completed_session);
  if (!stored) return null;
  return due ? `Stored close ${stored}; ${due} not stored yet.` : `Stored close ${stored}; newer not stored yet.`;
}

/* ── Series groups (Iteration 1 step 6, A3 and E3) ───────────────────────── */

/** The regime classifier's monthly inputs, as /api/freshness `regime.inputs`
 * names them. The shell's macro chip reads these three. */
export const REGIME_INPUT_IDS: readonly string[] = ["INDPRO", "CPIAUCSL", "UNRATE"];

/** The recession model's seven FRED inputs (E3). USSLIND is not an input:
 * the fifth feature reads T10YIE − T5YIE because USSLIND stopped publishing
 * in February 2020 (recession-copy.ts BREAKEVEN_LABEL). */
export const RECESSION_INPUT_IDS: readonly string[] = ["DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE", "T5YIE", "UNRATE", "INDPRO"];

/** The series behind each served recession feature (`model_features`). */
export const RECESSION_FEATURE_SERIES: Readonly<Record<string, readonly string[]>> = {
  yield_curve: ["DGS10", "DGS2"],
  unemployment: ["UNRATE"],
  hy_spread: ["BAMLH0A0HYM2"],
  indpro_yoy: ["INDPRO"],
  lei_proxy: ["T10YIE", "T5YIE"],
};

/** The series /api/signals/latest carries in its freshness block (§6). */
export const SIGNAL_INPUT_IDS: readonly string[] = ["DGS10", "DGS2", "VIXCLS", "BAMLH0A0HYM2", "CPIAUCSL", "UNRATE", "INDPRO"];

/** The five ICE BofA OAS series (the Credit hero's source). */
export const CREDIT_OAS_IDS: readonly string[] = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC"];

/** "The weaker state", FRESHNESS_CONTRACT §3's order (stale > unknown >
 * close) extended to the six words; higher is weaker. */
const WEAK_RANK: Record<FreshState, number> = { live: 0, close: 1, delayed: 2, fallback: 3, unknown: 4, stale: 5 };

/** The weakest of several states. A missing entry counts as unknown; when a
 * missing entry is the weakest the result is null (it reads "As of unknown").
 * Ties go to the entry further behind, then to the older stamp. */
export function weakest(states: ReadonlyArray<SeriesState | null | undefined>): SeriesState | null {
  let best: SeriesState | null = null;
  let bestRank = -1;
  for (const s of states) {
    const rank = s ? WEAK_RANK[normalizeState(s.state)] : WEAK_RANK.unknown;
    if (rank < bestRank) continue;
    if (rank > bestRank) {
      best = s ?? null;
      bestRank = rank;
      continue;
    }
    // Same rank: a missing entry keeps the slot unknown; otherwise the one
    // further behind, then the older stamp.
    if (!s || !best) {
      if (!s) best = null;
      continue;
    }
    const cb = (x: SeriesState) => x.cycles_behind ?? -1;
    if (cb(s) > cb(best) || (cb(s) === cb(best) && (s.as_of ?? "") < (best.as_of ?? ""))) best = s;
  }
  return best;
}

/** One series per id: /api/freshness `series[]` is the one source; a
 * payload's own `freshness` block only fills an id `series[]` does not carry
 * (the LBO's derived `lbo_all_in_rate`, or a report that has not loaded).
 * A block that disagrees never outranks the report (the recession block, for
 * one, lists USSLIND and omits UNRATE and INDPRO). */
export type SeriesLookup = (id: string) => SeriesState | undefined;

export function lookupFrom(f: Freshness | null | undefined, block?: Record<string, SeriesState> | null): SeriesLookup {
  return (id) => seriesById(f, id) ?? block?.[id];
}

/** A group of series read as one chip: the weakest member's §5 word, with
 * every member's word in the reason (for the tooltip). */
export function groupLabel(lookup: SeriesLookup, ids: readonly string[]): FreshLabel {
  const members = ids.map((id) => ({ id, s: lookup(id) }));
  const w = weakest(members.map((m) => m.s));
  const base = freshLabel(w);
  const reason = members
    .map(({ id, s }) => {
      const l = freshLabel(s);
      return `${s?.label ?? id}: ${l.word}${l.muted ? ` ${l.muted}` : ""}`;
    })
    .join("; ");
  return { ...base, reason: members.length > 1 ? `${reason}.` : base.reason || `${reason}.` };
}

/** The series a market chip reads (§5): live or delayed quotes from
 * `live_quotes` during the session; otherwise the stored daily close. */
export function marketSeries(f: Freshness | null | undefined): SeriesState | undefined {
  const live = seriesById(f, "live_quotes");
  const st = normalizeState(live?.state);
  if (live && (st === "live" || st === "delayed")) return live;
  return seriesById(f, "market_daily");
}

/** Static reference content (a playbook, the hand-maintained calendar, the
 * regime labels): no cadence, so no freshness state and never a health dot. */
export function referenceLabel(reason = "Reference content with no publication cadence."): FreshLabel {
  return label("Reference", "neutral", reason);
}

/** A feed the freshness report does not judge (the news feed, the weekly
 * pricing block, the allocation return histories): the payload's own stamp,
 * printed as a date and nothing more, grey, never healthy. */
export function stampLabel(stamp: string | null | undefined, reason: string): FreshLabel {
  return label(stamp || UNKNOWN_WORD, "unknown", reason);
}

/** The colour token for a tone: only live is mint, only delayed amber. */
export function toneColor(tone: FreshTone): string {
  switch (tone) {
    case "live":
      return "var(--mint, var(--pos))";
    case "delayed":
      return "var(--amber)";
    case "stale":
      return "var(--warn-hot)";
    case "neutral":
      return "var(--text-2)";
    default:
      return "var(--text-3, var(--text-muted))";
  }
}

/** The house glyph per tone, so the state never rides on colour alone. */
export function toneGlyph(tone: FreshTone): string {
  switch (tone) {
    case "live":
      return "●";
    case "delayed":
      return "▪";
    case "stale":
      return "▾";
    case "neutral":
      return "◆";
    default:
      return "◇";
  }
}
