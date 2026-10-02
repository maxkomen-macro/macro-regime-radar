/**
 * The Technicals Signals card's key (desk/pdf-polish item 3b): one plain
 * sentence for each word the card prints, collapsed under "Signal key ▸".
 * Every number and rule is the code's (docs/desk/PDF_POLISH_REPORT.md cites
 * each file and line): the crosses are the engine's strict 50/200-day crosses
 * (src/desk/event_study.py cross_positions), the RSI is Wilder's index, its
 * averages smoothed with a 14-session period (Codex R-02: not a 14-session
 * window), with its 70 and 30 zones (src/analytics/technicals.py), a 2σ move is
 * the engine's z of a 20- or 5-session return against its own last 252
 * sessions (event_study.py move, zscore, trigger_mask), the badges are rule
 * v1's verdicts at 20 sessions (api/desk_v2.py verdict_v1, event_study.py
 * judge_exclusion), and vs normal is the served excess median (api/desk_v2.py
 * vs_normal). Every row on the card targets the S&P (api/desk_catalog.py
 * TECHNICALS_ALLOWLIST), so the sentences name it.
 */

import type { Verdict } from "../data/types";

export interface SignalKeyEntry {
  term: string;
  /** The badge this entry defines, drawn as the card draws it. */
  verdict?: Verdict;
  text: string;
}

export const SIGNAL_KEY: readonly SignalKeyEntry[] = [
  { term: "Golden cross", text: "The S&P's 50-day average moves above its 200-day average, from below." },
  { term: "Death cross", text: "The S&P's 50-day average moves below its 200-day average, from above." },
  { term: "RSI", text: "The relative strength index weighs the S&P's Wilder-smoothed average gains against its average losses with a 14-session period, from 0 to 100; above 70 reads as stretched up, below 30 as stretched down." },
  { term: "20-day and 5-day move over 2σ", text: "The S&P's return over the last 20 (or 5) sessions is at least two standard deviations above its average return over spans that long in the last 252 sessions." },
  { term: "Reliable", verdict: "reliable", text: "At least ten independent episodes, and the S&P's edge over a normal month stays on one side of zero across the whole 90% range, with under 3% of resampled histories showing none or the opposite." },
  { term: "Suggestive", verdict: "suggestive", text: "At least ten outcomes, and the edge over a normal period points the same way at one week, two weeks and a month, without passing the Reliable test." },
  { term: "No edge", verdict: "no_edge", text: "At least ten outcomes, but the edge over a normal period neither passes the Reliable test nor points the same way at one week, two weeks and a month." },
  { term: "Too few", verdict: "insufficient", text: "Fewer than ten outcomes a month later, too few to score." },
  { term: "vs normal", text: "The median move a month after the signal less the median one-month move from every evaluable session of the study's sample, in percentage points." },
];

/** The gray list beside "Signal key ▸", as Advanced lists what it opens. */
export const SIGNAL_KEY_ITEMS = "crosses · RSI · 2σ moves · the four badges · vs normal";
