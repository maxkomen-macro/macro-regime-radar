/**
 * Alert copy — turns a stored alert_feed row into the sentence an investment
 * committee would accept (2026-09-05). The pipeline writes machine strings
 * ("Cpi Hot triggered … Value=4.27, severity=0.27, duration=0mo, level=INFO")
 * and snake_case names; nothing machine-facing reaches the drawer. Every
 * number in the output is the row's own value, the server threshold, or the
 * latest stored signal print; nothing is invented.
 */

import type { Alert, Signal } from "../../api/types";
import { fmtDate, fmtMonYr, fmtPct } from "../../lib/format";
import { SIGNALS_META } from "../dashboard/signals-meta";

/** The metric noun each signal watches, for the sentence subject. */
const SUBJECT: Record<string, string> = {
  cpi_hot: "CPI inflation",
  cpi_cold: "CPI inflation",
  yield_curve_inversion: "The 10Y–2Y Treasury spread",
  vix_spike: "The VIX",
  unemployment_spike: "The 3-month change in unemployment",
};

/** Why the trip matters, in the regime engine's own terms (reference copy). */
const WHY: Record<string, string> = {
  cpi_hot:
    "Hot inflation pushes the classifier toward Overheating or Stagflation and argues against duration and long-dated growth exposure.",
  cpi_cold:
    "Inflation under 1% is the disinflation tell: it raises the odds of Recession Risk and favours quality bonds over cyclicals.",
  yield_curve_inversion:
    "An inverted curve has preceded most US recessions; it lifts the recession model and the Recession Risk odds.",
  vix_spike:
    "A VIX close above 30 marks stress pricing: risk assets tend to de-rate and credit spreads follow.",
  unemployment_spike:
    "A fast rise in unemployment is the Sahm-style recession tell; it moves the recession model more than any other input.",
};

const LEVEL_WORD: Record<string, string> = {
  info: "Informational",
  watch: "Watch",
  risk: "Risk",
};

export interface AlertCopy {
  /** e.g. "Inflation pressure" */
  title: string;
  /** e.g. "May 2026" */
  when: string;
  /** Closed-set severity word. */
  severity: string;
  /** The trigger sentence with the row's numbers. */
  trigger: string;
  /** Whether the same signal is still triggered in the latest stored print. */
  active: boolean | null;
  /** Current-status sentence with the latest print, when known. */
  status: string;
  /** Reference sentence on why it matters. */
  why: string;
}

/** The VIX move alerts (src/analytics/alerts.py): a z-score of the VIX's rise
 *  from stored daily closes, dated by its session (one-day) or by the last
 *  session its week read (weekly). */
const VIX_MOVES: Record<string, { title: string; change: string; span: (d: string) => string; why: string }> = {
  VIX_daily_jump: {
    title: "VIX one-day jump",
    change: "one-day change",
    span: (d) => `on ${fmtDate(d)}`,
    why: "A one-day VIX jump this far outside its usual range is the first read of stress pricing; it often precedes wider credit spreads.",
  },
  // dated by the session the week's level came from (VIX_weekly_chg_obs), so "the week to" holds for a
  // week still under way and for a completed one
  VIX_shock: {
    title: "VIX weekly shock",
    change: "change from the previous week's last close",
    span: (d) => `in the week to ${fmtDate(d)}`,
    why: "A VIX move this far outside its usual weekly range marks stress pricing: risk assets tend to de-rate and credit spreads follow.",
  },
};

function describeVixMove(a: Alert, move: (typeof VIX_MOVES)[string]): AlertCopy {
  const z = a.value != null ? `${a.value.toFixed(1)}σ` : "outside its usual range";
  const line = a.threshold != null ? `, above the ${a.threshold.toFixed(0)}σ ${a.level === "risk" ? "risk" : "watch"} line` : "";
  return {
    title: move.title,
    when: fmtDate(a.date),
    severity: LEVEL_WORD[a.level] ?? "Informational",
    trigger: `The VIX's ${move.change} was ${z} ${move.span(a.date)}${line}.`,
    active: null,
    status: "Measured from stored daily VIX closes and recomputed with every daily refresh.",
    why: move.why,
  };
}

/** The observed close a SPY_drawdown message names ("… to the Tue 2026-11-03 close …"), only when
 *  it is the row's own date: the pipeline dates the row by that close (SPY_weekly_ret_obs). A row
 *  whose observation dates were not on file, a legacy "5d" row and a row with no message are all
 *  dated by their W-FRI bucket label instead, so none of them names an observed close. */
function spyObservedClose(a: Alert): string | null {
  const m = /\bto the (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{4}-\d{2}-\d{2}) close\b/.exec(a.message ?? "");
  return m && m[1] === a.date.slice(0, 10) ? m[1] : null;
}

/** SPY_drawdown (src/analytics/alerts.py): SPY_weekly_ret, the change from the previous W-FRI
 *  week's last stored close to the newest stored close of its week, a week still under way
 *  included, so never a "5-day" return. When the stored message names the close the row read,
 *  the row is dated by it and "the week to" holds for a partial week and a complete one; without
 *  it the date is only the week's label and is never printed as a close. The value and threshold
 *  are fractions (-0.035 is -3.50%). */
function describeSpyDrawdown(a: Alert): AlertCopy {
  const level = a.level === "risk" ? "risk" : "watch";
  const line = a.threshold != null ? `, below the ${fmtPct(a.threshold * 100, 0)} ${level} line` : "";
  const observed = spyObservedClose(a);
  const span = observed ? `in the week to ${fmtDate(observed)}` : `for the week labelled ${fmtDate(a.date)}`;
  const status = observed
    ? "Measured from stored daily SPY closes and recomputed with every daily refresh; a week still under way counts only its sessions so far."
    : "The close this return was measured to is not on file, so the date is the week's label, not an observed close, and the week may be incomplete.";
  return {
    title: "SPY weekly drop",
    when: observed ? fmtDate(observed) : `Week labelled ${fmtDate(a.date)}`,
    severity: LEVEL_WORD[a.level] ?? "Informational",
    trigger:
      a.value != null
        ? `SPY's change from the previous week's last close was ${fmtPct(a.value * 100)} ${span}${line}.`
        : `SPY fell past its weekly line ${span}.`,
    active: null,
    status,
    why: "A fall this large from the previous week's close marks broad selling in US equities.",
  };
}

function humanName(name: string): string {
  return SIGNALS_META[name]?.display ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function describeAlert(a: Alert, latest?: Signal): AlertCopy {
  const move = VIX_MOVES[a.name];
  if (move) return describeVixMove(a, move);
  if (a.name === "SPY_drawdown") return describeSpyDrawdown(a);
  const meta = SIGNALS_META[a.name];
  const fmt = meta?.format ?? ((v: number) => v.toFixed(2));
  const subject = SUBJECT[a.name] ?? humanName(a.name);
  const threshold = a.threshold ?? latest?.threshold ?? null;
  const direction = (a.direction ?? latest?.direction ?? "above") === "below" ? "below" : "above";
  const when = fmtMonYr(a.date);

  let trigger: string;
  if (a.value != null && threshold != null) {
    const margin = Math.abs(a.value - threshold);
    const unit = meta?.format(1).replace(/^[\d.,-]+\s?/, "").trim() ?? "";
    trigger = `${subject} printed ${fmt(a.value)} in ${when}, ${direction} the ${fmt(threshold)} trigger by ${margin.toFixed(2)}${
      unit && !unit.startsWith("pp") ? (unit.startsWith("%") ? " pp" : ` ${unit}`) : " pp"
    }.`;
  } else if (a.value != null) {
    trigger = `${subject} printed ${fmt(a.value)} in ${when}, ${direction} its trigger.`;
  } else {
    trigger = `${subject} crossed its trigger in ${when}.`;
  }

  let active: boolean | null = null;
  let status: string;
  if (latest) {
    active = latest.triggered;
    status = active
      ? `Still active: the latest print (${fmtMonYr(latest.date)}) reads ${fmt(latest.value)}.`
      : `No longer active: the latest print (${fmtMonYr(latest.date)}) reads ${fmt(latest.value)}${
          threshold != null ? `, ${direction === "above" ? "under" : "over"} the ${fmt(threshold)} trigger` : ""
        }.`;
  } else {
    status = "Current status unknown: no live print for this signal is on file.";
  }

  return {
    title: humanName(a.name),
    when,
    severity: LEVEL_WORD[a.level] ?? "Informational",
    trigger,
    active,
    status,
    why: WHY[a.name] ?? "This condition feeds the regime classifier and the monitored-signal ladder.",
  };
}
