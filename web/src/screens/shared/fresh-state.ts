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
