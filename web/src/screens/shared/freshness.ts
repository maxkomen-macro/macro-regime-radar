/**
 * Freshness model — one vocabulary for "how old is this evidence" across the
 * app (2026-09-05). Every stamp the API returns is assessed against the
 * cadence it is supposed to have, and the result is a closed set of states:
 *
 *   current      inside one publication cycle of its cadence
 *   delayed      one cycle late, still usable with the date stated
 *   stale        older than that: context, not a live read
 *   unavailable  no stamp at all
 *   reference    static content that has no cadence (playbooks, methodology)
 *
 * States are words first (never colour alone) and every chip prints the date,
 * so "Stale · Aug 25, 2026 · 11 days" is the whole story in one glance.
 */

import { daysSince, fmtDate, fmtIntradayTs, fmtMonYr } from "../../lib/format";

export type FreshState = "current" | "delayed" | "stale" | "unavailable" | "reference";

export type Cadence = "monthly" | "weekly" | "daily" | "intraday" | "hourly" | "reference";

export interface FreshInfo {
  state: FreshState;
  /** Closed-set word: Current / Delayed / Stale / Unavailable / Reference. */
  word: string;
  /** Formatted stamp, e.g. "Jul 2026", "Aug 25, 2026", "Aug 25, 15:55 ET". */
  stamp: string;
  /** Whole days old (0 for reference / unavailable). */
  ageDays: number;
  /** Short human age: "11 days", "3 weeks", "2 months", "under 1 hour". */
  age: string;
  cadence: Cadence;
}

const DAY_LIMITS: Record<Exclude<Cadence, "reference">, [current: number, delayed: number]> = {
  monthly: [45, 75],
  weekly: [10, 21],
  daily: [4, 10],
  intraday: [1 / 72, 1], // 20 minutes, then a session
  hourly: [0.25, 2],
};

export function ageWords(days: number): string {
  if (days < 1 / 24) return "under 1 hour";
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} hours`;
  const d = Math.round(days);
  if (d < 14) return `${d} day${d === 1 ? "" : "s"}`;
  if (d < 60) return `${Math.round(d / 7)} weeks`;
  return `${Math.round(d / 30)} months`;
}

function stampFor(iso: string, cadence: Cadence): string {
  if (cadence === "monthly") return fmtMonYr(iso);
  if (cadence === "intraday" || cadence === "hourly") {
    if (iso.length > 10) return fmtIntradayTs(iso);
  }
  return fmtDate(iso);
}

/** Assess one timestamp against the cadence it should carry. */
export function assessFreshness(iso: string | null | undefined, cadence: Cadence): FreshInfo {
  if (cadence === "reference") {
    return { state: "reference", word: "Reference", stamp: "", ageDays: 0, age: "", cadence };
  }
  if (!iso) {
    return { state: "unavailable", word: "Unavailable", stamp: "", ageDays: 0, age: "", cadence };
  }
  const days = Math.max(0, daysSince(iso));
  const [cur, del] = DAY_LIMITS[cadence];
  const state: FreshState = days <= cur ? "current" : days <= del ? "delayed" : "stale";
  return {
    state,
    word: state === "current" ? "Current" : state === "delayed" ? "Delayed" : "Stale",
    stamp: stampFor(iso, cadence),
    ageDays: Math.floor(days),
    age: ageWords(days),
    cadence,
  };
}

/** Colour token for a state: functional text stays at AA-readable rungs. */
export function freshColor(state: FreshState): string {
  switch (state) {
    case "current":
      return "var(--pos)";
    case "delayed":
      return "var(--warn)";
    case "stale":
      return "var(--warn-hot)";
    case "unavailable":
      return "var(--neg-text)";
    default:
      return "var(--text-muted)";
  }
}

/** Glyph from the house vocabulary, so the state never rides on colour alone. */
export function freshGlyph(state: FreshState): string {
  switch (state) {
    case "current":
      return "●";
    case "delayed":
      return "▪";
    case "stale":
      return "▾";
    case "unavailable":
      return "×";
    default:
      return "◆";
  }
}

/** "Current · Jul 2026" / "Stale · Aug 25, 2026 · 11 days old". */
export function freshLine(info: FreshInfo, noun?: string): string {
  const head = noun ? `${noun} ` : "";
  if (info.state === "reference") return `${head}reference material, no publication cadence`.trim();
  if (info.state === "unavailable") return `${head}unavailable: no stamp on file`.trim();
  const age = info.state === "current" ? "" : ` · ${info.age} old`;
  return `${head}${info.word.toLowerCase()} · ${info.stamp}${age}`.trim();
}

/**
 * The decision-impact sentence for the shell: reconciles the monthly macro
 * read with the daily market overlay so a reader is told, in words, which
 * layer is fresh and which is context.
 */
export function impactSentence(macro: FreshInfo, market: FreshInfo, tapeLive: boolean): string {
  if (macro.state === "unavailable") return "Macro read unavailable: the regime stamp did not load.";
  const macroClause =
    macro.state === "current"
      ? `The macro regime read (${macro.stamp}) is inside its monthly cycle`
      : macro.state === "delayed"
        ? `The macro regime read (${macro.stamp}) is one monthly cycle late`
        : `The macro regime read (${macro.stamp}) is ${macro.age} old`;
  if (tapeLive) return `${macroClause}; the tape is ticking live.`;
  if (market.state === "unavailable") return `${macroClause}; no stored market overlay is on file.`;
  if (market.state === "current") return `${macroClause}; market data runs through ${market.stamp}.`;
  return `${macroClause}, but the stored market overlay is ${market.age} old (through ${market.stamp}): treat prices here as context, not the tape.`;
}
