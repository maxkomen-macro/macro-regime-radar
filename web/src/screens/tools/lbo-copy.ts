/**
 * Hero copy and the summary strip for the LBO TabHero (redesign Phase 9,
 * checklist 09 C.1 rules 1 to 7 and the B.2 strip table). Pure: no hooks, no
 * React. One number, one truth: the headline and the pill are the served
 * `irr` / `moic` of the base run (the default deal at the all-in rate); the
 * note is the only place the modified deal's figures appear; the subhead is
 * the rate that run carried and never moves with the slider; the lede prints
 * `BASE_INPUTS`, never a run. The strip reads the rate's served state and
 * each component's as-of from the payload's freshness block (Iteration 1
 * E1); an older payload without the block reads "as of unknown" with its
 * stored stamp (Iteration 1 step 6: no browser-judged age).
 */

import { ApiError } from "../../api/client";
import type { LboDefaults, LboRequest, LboResult, SeriesState } from "../../api/types";
import { fmtDate } from "../../lib/format";
import { freshLabel, normalizeState, type FreshLabel } from "../shared/fresh-state";
import { MISSING, missingNote } from "../shared/screen-ui";
import type { StatusTone } from "../shared/SummaryCard";
import type { TabHeroPillTone } from "../shared/TabHero";
import { FALLBACK_RATE, irrTone, type IrrTone } from "./lbo-deal";

/** The defaults query as the copy reads it: a structural subset of the
 * TanStack result, so a test can pass a plain object. */
export interface DefaultsLike {
  isLoading: boolean;
  isError: boolean;
  data?: LboDefaults | undefined;
}

export const LBO_EYEBROW = "LBO calculator";

/** Glow behind the hero's right column (03 C.1 rule 7): mint for a mint
 * pill, amber for an amber pill, the derived gray for the gray band and the
 * loading and unavailable heroes. */
export const LBO_GLOW: Record<IrrTone, string> = {
  mint: "rgba(38,220,160,.07)",
  amber: "rgba(245,181,46,.06)",
  gray: "rgba(200,210,220,.05)",
};

/** The IRR ramp colour (LboPanel.tsx:38-43, ported to the Phase 1 tokens):
 * --pos at 20 and above, --amber at 15 to 20, --warn-hot below. The pill has
 * no orange tone, so the footnote sentence carries the orange word (rule 2). */
export const IRR_RAMP: Record<IrrTone, string> = {
  mint: "var(--pos)",
  amber: "var(--amber)",
  gray: "var(--warn-hot)",
};

/** The T5 sentences (LboPanel.tsx:181), verbatim; the lede's second half. */
export const CALCULATOR_SENTENCE =
  "Every assumption can be typed exactly or dragged; the schedule and the entry × exit sensitivity grid rerun on each change. The classic private-equity hurdle is 20% IRR; green cells in the grid clear it.";

export const RATE_UNAVAILABLE_HEADLINE = `Financing rate unavailable: the data service did not answer. The calculator falls back to the stated ${FALLBACK_RATE.toFixed(2)}% rate.`;
export const RUN_UNAVAILABLE_HEADLINE = "Deal model unavailable";
export const LOADING_HEADLINE = "Running the default deal…";
export const NOT_VIABLE_HEADLINE = "The default deal is not viable at this rate";

export const STRIP_SUFFIX = "Open the data freshness breakdown.";

export type LboHeroState = "ready" | "not-viable" | "loading" | "rate-error" | "run-error";

export interface LboHeroCopy {
  eyebrow: string;
  /** The display-face answer when `state` is "ready"; a UI-face sentence otherwise. */
  headline: string;
  pill: string | null;
  pillTone: TabHeroPillTone;
  glow: string;
  subhead: string | null;
  lede: string;
  /** The T3 badge sentence for the default deal, in `footnoteColor`. */
  footnote: string | null;
  footnoteColor: string | null;
  /** The modified deal, only while something is modified (rule 6). */
  note: string | null;
  state: LboHeroState;
}

export interface LboHeroArgs {
  defaults: DefaultsLike;
  clampedLive: number | null;
  /** The served rate is lbo.py's stated default (`is_fallback`), not stored
   * rates: the subhead says so and never calls it the all-in rate. */
  statedDefault?: boolean;
  /** The default deal at the live rate (the base run's request). */
  baseInputs: LboRequest;
  /** The base run's result: the hero's one source of figures. */
  baseRes: LboResult | undefined;
  /** The deal run's result: read by the note only. */
  res: LboResult | undefined;
  modified: boolean;
  /** The deal run is in flight or the debounce still holds a change. */
  runPending: boolean;
  /** The base run's error, when it has no result. */
  baseError?: unknown;
  /** A validated snapshot seeded the session (CP4): the calculator, which
   * runs on the server, is not in it. */
  snapshot?: boolean;
}

/** "A $100M EBITDA business bought at 8.00× with 4.50× leverage, growing 5.0%
 * a year and exiting at 9.00× after 5 years." from the default deal (rule 4):
 * no figure from a run. */
export function dealSentence(d: Omit<LboRequest, "interest_rate">): string {
  const ebitda = `$${Math.round(d.ebitda).toLocaleString("en-US")}M`;
  const years = `${d.hold_period} year${d.hold_period === 1 ? "" : "s"}`;
  return `A ${ebitda} EBITDA business bought at ${d.entry_multiple.toFixed(2)}× with ${d.leverage_ratio.toFixed(2)}× leverage, growing ${d.ebitda_growth_rate.toFixed(1)}% a year and exiting at ${d.exit_multiple.toFixed(2)}× after ${years}.`;
}

/** The T3 badge (LboPanel.tsx:168), verbatim, by the IRR bands. */
export function badgeSentence(irr: number): string {
  if (irr >= 20) return "Clears the 20% PE bar";
  if (irr >= 15) return "Below the 20% bar · above 15%";
  return "Below 15%";
}

/** Rule 3: the rate the default deal ran at; the fallback sentence when no
 * rate is on file. Never changes when the slider moves. Iteration 1 E1: the
 * all-in rate is Fed funds (a monthly average) plus the daily HY spread, so
 * the sentence names its parts and never calls it "today's" or "live"; the
 * engine's stated default reads as a stated default. */
export function subheadFor(clampedLive: number | null, statedDefault = false): string {
  if (clampedLive == null) return `The default deal at the stated ${FALLBACK_RATE.toFixed(2)}% fallback rate.`;
  return statedDefault
    ? `The default deal at the stated ${clampedLive.toFixed(2)}% default rate.`
    : `The default deal at a ${clampedLive.toFixed(2)}% all-in rate: Fed funds plus the HY spread.`;
}

/** "+1.3" / "-0.4" (the LboPanel.tsx:157 form). */
export function signedPp(d: number): string {
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

/** The `LboRunState` sentence for a failed run (LboPanel.tsx:57-72), so the
 * hero's subhead and the Outputs panel say the same thing. In a snapshot
 * session a run that never reached the service says the calculator is not in
 * the snapshot (CP4). */
export function runErrorSentence(error: unknown, snapshot = false): string {
  const e = error instanceof ApiError ? error : null;
  if (snapshot && (e == null || e.status === 0)) return missingNote(MISSING.lbo, true);
  if (e?.status === 503) return "The deal model is unavailable on this server (calculator engine not installed).";
  if (e?.status === 422) return `The service rejected these inputs: ${e.message}`;
  if (e?.status === 0) return "The data service did not answer; the deal model will rerun when it returns.";
  return "Unavailable: the data service did not answer.";
}

/** Rule 6: the note exists only while `modified`, in three forms. */
export function modifiedNote(args: Pick<LboHeroArgs, "modified" | "runPending" | "res" | "baseRes">): string | null {
  if (!args.modified) return null;
  const { res, baseRes } = args;
  if (args.runPending || !res) return "Rerunning your modified deal…";
  if (!res.viable) return "Your modified deal is not viable at these assumptions; see Outputs.";
  if (res.irr == null || res.moic == null) return null;
  const vsDefault = baseRes?.viable && baseRes.irr != null ? ` · ${signedPp(res.irr - baseRes.irr)} pp vs the default` : "";
  return `Your modified deal: ${res.irr.toFixed(1)}% IRR · ${res.moic.toFixed(2)}× MOIC${vsDefault}, in Outputs below.`;
}

export function lboHero(args: LboHeroArgs): LboHeroCopy {
  const shared = { eyebrow: LBO_EYEBROW, lede: `${dealSentence(args.baseInputs)} ${CALCULATOR_SENTENCE}` };
  const quiet = { pill: null, pillTone: "gray" as const, glow: LBO_GLOW.gray, footnote: null, footnoteColor: null, note: null };

  // Rule 7: the loading and error sentences, in the UI face. CP4: with the
  // rate and the default deal both unanswered (or on a snapshot, where the
  // calculator cannot run) the hero names the calculator as missing.
  const rateDown = args.defaults.isError && !args.defaults.data;
  if (rateDown && !args.baseRes && (args.baseError || args.snapshot)) {
    return { ...shared, ...quiet, state: "run-error", headline: missingNote(MISSING.lbo, args.snapshot === true), pill: "Unavailable", subhead: null };
  }
  if (rateDown) {
    return { ...shared, ...quiet, state: "rate-error", headline: RATE_UNAVAILABLE_HEADLINE, pill: "Unavailable", subhead: null };
  }
  if (args.baseError && !args.baseRes) {
    return { ...shared, ...quiet, state: "run-error", headline: RUN_UNAVAILABLE_HEADLINE, subhead: runErrorSentence(args.baseError, args.snapshot === true) };
  }
  if (args.defaults.isLoading || !args.baseRes) {
    return { ...shared, ...quiet, state: "loading", headline: LOADING_HEADLINE, subhead: null };
  }

  const r = args.baseRes;
  const subhead = subheadFor(args.clampedLive, args.statedDefault === true);
  const note = modifiedNote(args);
  if (!r.viable || r.irr == null || r.moic == null) {
    return { ...shared, ...quiet, state: "not-viable", headline: NOT_VIABLE_HEADLINE, pill: "Not viable", subhead, note };
  }

  // Rules 1, 2 and 5: the default deal's served IRR and MOIC, the band's
  // tone and glow, the badge sentence in the ramp colour.
  const tone = irrTone(r.irr);
  return {
    ...shared,
    state: "ready",
    headline: `${r.irr.toFixed(1)}% IRR`,
    pill: `${r.moic.toFixed(2)}× MOIC`,
    pillTone: tone,
    glow: LBO_GLOW[tone],
    subhead,
    footnote: badgeSentence(r.irr),
    footnoteColor: IRR_RAMP[tone],
    note,
  };
}

/* ── the FRED strip (B.2) ─────────────────────────────────────────────── */

export interface StripWords {
  tone: StatusTone;
  title: string;
  detail: string;
}

/** True when `/api/lbo/defaults` served lbo.py's stated defaults (5.33 /
 * 3.27 / 8.60, lbo.py:32-37) instead of stored rates. B3 serves `is_fallback`
 * and `status`; the old `data_as_of === "unavailable"` word is read only for
 * a payload that carries neither (Iteration 1 E1). */
export function isStatedDefault(d: LboDefaults | undefined | null): boolean {
  if (!d) return false;
  if (typeof d.is_fallback === "boolean") return d.is_fallback;
  if (d.status != null) return d.status === "fallback";
  return d.data_as_of === "unavailable";
}

/** The stored-through stamp, or null for the stated-default payload and an
 * absent payload. */
export function stampOf(d: LboDefaults | undefined | null): string | null {
  return d?.data_as_of && !isStatedDefault(d) && d.data_as_of !== "unavailable" ? d.data_as_of : null;
}

/** Each component's as-of word from the payload's freshness block (A3 words,
 * FRESHNESS_CONTRACT §5): Fed funds is a monthly average ("Aug 2026 print"),
 * the HY spread a daily series ("Sep 17", or "As of unknown" while its
 * watermark is missing). Never the row month stamps (`*_as_of`). */
export function componentAsOf(d: LboDefaults | undefined | null): { fed: FreshLabel; hy: FreshLabel } {
  return { fed: freshLabel(d?.freshness?.FEDFUNDS), hy: freshLabel(d?.freshness?.BAMLH0A0HYM2) };
}

/** A status line's character budget: about 200 px of 12 px text, one line in
 * the narrowest strip (390 px). */
const STRIP_LINE_CHARS = 36;

/** State rank for "the weaker component" (higher is weaker). */
const STATE_RANK: Record<string, number> = { live: 0, close: 0, delayed: 1, stale: 2, fallback: 3 };

/** The B3 detail: both components' as-of words when they fit one line
 * ("Fed Aug 2026 print · HY Sep 17"), else the weaker component's alone
 * (the summary rows print both). */
export function componentDetail(d: LboDefaults): string {
  const { fed, hy } = componentAsOf(d);
  const both = `Fed ${fed.word} · HY ${hy.word}`;
  if (both.length <= STRIP_LINE_CHARS) return both;
  const rank = (s: SeriesState | null | undefined) => STATE_RANK[normalizeState(s?.state)] ?? 4;
  const fedWeaker = rank(d.freshness?.FEDFUNDS) >= rank(d.freshness?.BAMLH0A0HYM2);
  return fedWeaker ? `Fed funds ${fed.word}` : `HY spread ${hy.word}`;
}

export function lboStrip(defaults: DefaultsLike, snapshot = false): StripWords {
  // Iteration 1 step 5 (G4): every detail is one line at 390 px. The
  // components' words are the summary rows' (Fed funds, HY OAS) and the
  // fallback rate is the Financing row's.
  if (defaults.isError && !defaults.data && snapshot) {
    // CP4: the rate is read on the server, so a snapshot session has none.
    return { tone: "gray", title: "Rate feed not in this snapshot", detail: "The rate is read on the server" };
  }
  if (defaults.isError && !defaults.data) {
    return { tone: "gray", title: "Rate feed unavailable", detail: `The stated ${FALLBACK_RATE.toFixed(2)}% rate is in use` };
  }
  if (defaults.isLoading || !defaults.data) {
    return { tone: "gray", title: "Reading the FRED rate…", detail: "Opens the data freshness breakdown" };
  }
  const stamp = stampOf(defaults.data);
  if (!stamp) {
    return { tone: "gray", title: "Rate feed unavailable", detail: "No FRED rows · fallback rate in use" };
  }
  // B3 payloads: the rate's own state (judged by its weaker component) and
  // each component's as-of word; a state the UI does not know reads unknown
  // and never a healthy tone.
  const block = defaults.data.freshness;
  if (block) {
    const detail = componentDetail(defaults.data);
    switch (normalizeState(block.lbo_all_in_rate?.state)) {
      case "live":
      case "close":
        return { tone: "mint", title: "Rate synced from FRED", detail };
      case "delayed":
        return { tone: "amber", title: "FRED rate delayed", detail };
      case "stale":
        return { tone: "amber", title: "FRED rate stale", detail };
      case "fallback":
        return { tone: "gray", title: "Rate feed unavailable", detail: "No FRED rows · fallback rate in use" };
      default:
        return { tone: "gray", title: "FRED rate · as of unknown", detail };
    }
  }
  // A pre-B3 payload carries no per-series state: its stored stamp prints as
  // a date and the rate reads "as of unknown" (Iteration 1 step 6, A3: the
  // browser never judges an age, and unknown is never a healthy tone).
  return { tone: "gray", title: "FRED rate · as of unknown", detail: `Stored through ${fmtDate(stamp)}` };
}
