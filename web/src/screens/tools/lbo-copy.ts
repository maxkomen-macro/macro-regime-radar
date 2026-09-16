/**
 * Hero copy and the summary strip for the LBO TabHero (redesign Phase 9,
 * checklist 09 C.1 rules 1 to 7 and the B.2 strip table). Pure: no hooks, no
 * React. One number, one truth: the headline and the pill are the served
 * `irr` / `moic` of the base run (the default deal at the live rate); the
 * note is the only place the modified deal's figures appear; the subhead is
 * the rate that run carried and never moves with the slider; the lede prints
 * `BASE_INPUTS`, never a run. The strip reads the defaults payload's stamp
 * through `assessFreshness` at the monthly cadence (the T7 chip's).
 */

import { ApiError } from "../../api/client";
import type { LboDefaults, LboRequest, LboResult } from "../../api/types";
import { fmtDate } from "../../lib/format";
import { assessFreshness } from "../shared/freshness";
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
 * live rate is on file. Never changes when the slider moves. */
export function subheadFor(clampedLive: number | null): string {
  return clampedLive != null
    ? `The default deal at today's ${clampedLive.toFixed(2)}% all-in rate.`
    : `The default deal at the stated ${FALLBACK_RATE.toFixed(2)}% fallback rate.`;
}

/** "+1.3" / "-0.4" (the LboPanel.tsx:157 form). */
export function signedPp(d: number): string {
  return `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;
}

/** The `LboRunState` sentence for a failed run (LboPanel.tsx:57-72), so the
 * hero's subhead and the Outputs panel say the same thing. */
export function runErrorSentence(error: unknown): string {
  const e = error instanceof ApiError ? error : null;
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

  // Rule 7: the loading and error sentences, in the UI face.
  if (args.defaults.isError && !args.defaults.data) {
    return { ...shared, ...quiet, state: "rate-error", headline: RATE_UNAVAILABLE_HEADLINE, pill: "Unavailable", subhead: null };
  }
  if (args.baseError && !args.baseRes) {
    return { ...shared, ...quiet, state: "run-error", headline: RUN_UNAVAILABLE_HEADLINE, subhead: runErrorSentence(args.baseError) };
  }
  if (args.defaults.isLoading || !args.baseRes) {
    return { ...shared, ...quiet, state: "loading", headline: LOADING_HEADLINE, subhead: null };
  }

  const r = args.baseRes;
  const subhead = subheadFor(args.clampedLive);
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

/** The stored-through stamp, or null for the module fallback payload
 * (`data_as_of === "unavailable"`, lbo.py:32-37) and an absent payload. */
export function stampOf(d: LboDefaults | undefined | null): string | null {
  return d?.data_as_of && d.data_as_of !== "unavailable" ? d.data_as_of : null;
}

export function lboStrip(defaults: DefaultsLike): StripWords {
  if (defaults.isError && !defaults.data) {
    return { tone: "gray", title: "Rate feed unavailable", detail: `The data service did not answer; the stated ${FALLBACK_RATE.toFixed(2)}% rate is in use` };
  }
  if (defaults.isLoading || !defaults.data) {
    return { tone: "gray", title: "Reading the FRED rate…", detail: "Opens the data freshness breakdown" };
  }
  const stamp = stampOf(defaults.data);
  if (!stamp) {
    return { tone: "gray", title: "Rate feed unavailable", detail: "FRED rows missing; the engine's fallback rate is in use" };
  }
  const info = assessFreshness(stamp, "monthly");
  const through = `Stored through ${fmtDate(stamp)}`;
  if (info.state === "current") return { tone: "mint", title: "Rate synced from FRED", detail: `${through} · refreshes with the daily pipeline` };
  if (info.state === "delayed") return { tone: "amber", title: "FRED rate delayed", detail: `${through} · ${info.age} old` };
  return { tone: "amber", title: "FRED rate stale", detail: `${through} · ${info.age} old` };
}
