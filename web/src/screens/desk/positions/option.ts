/**
 * An option position (Options Finder Build Plan step 7): the Finder's "Save as position" carries one contract into
 * the Position Monitor's form as the subject `{ kind: "option", contract, entry, thesis }`. The entry is what the
 * Finder priced it at (contracts, the fill per share, the total cost, the quotes' session and the stock's close);
 * the thesis is the view it was found for, its target the level to watch and its breakeven the warning line. The
 * gate (variant view, pre-mortem, "wrong if") stays the analyst's, and the position is monitored by hand: the Desk
 * serves no option price after the session it was found on. Pure.
 */

import type { OptionRow, OptionsFinderResponse } from "../data/types";
import { dayLong, dayShort, grouped, isFiniteNumber, priceText } from "../kit/format";
import { isCalendarDate } from "./sessions";

export interface OptionEntry {
  /** Contracts (100 shares each). */
  n: number;
  /** The price per share the cost is built on (the ask, or the mid). */
  fill: number;
  /** The whole premium with commissions: the maximum loss. */
  cost: number;
  /** The session the quotes describe. */
  session: string;
  underlying_close: number;
}

export interface OptionThesis {
  symbol: string;
  view: "up" | "down";
  target: number;
  by: string;
  /** At expiry; null when the Finder could not solve one. */
  breakeven: number | null;
}

export interface OptionSubject {
  kind: "option";
  contract: string;
  type: "call" | "put";
  exp: string;
  strike: number;
  entry: OptionEntry;
  thesis: OptionThesis;
}

const pos = (x: unknown): x is number => isFiniteNumber(x) && x > 0;
const filled = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;

/** Why an option subject cannot be read, or null. */
export function whyOption(v: unknown): string | null {
  const s = v as Partial<OptionSubject> | null;
  if (!s || typeof s !== "object" || s.kind !== "option") return "not an option subject";
  if (!filled(s.contract) || (s.type !== "call" && s.type !== "put") || !isCalendarDate(s.exp) || !pos(s.strike)) return "an option subject without its contract";
  const e = s.entry as Partial<OptionEntry> | undefined;
  if (!e || !Number.isInteger(e.n) || !pos(e.n) || !pos(e.fill) || !pos(e.cost) || !isCalendarDate(e.session) || !pos(e.underlying_close)) return "an option subject without its entry";
  const t = s.thesis as Partial<OptionThesis> | undefined;
  if (!t || !filled(t.symbol) || (t.view !== "up" && t.view !== "down") || !pos(t.target) || !isCalendarDate(t.by) || !(t.breakeven === null || pos(t.breakeven))) return "an option subject without its thesis";
  return null;
}

/** The subject for one served row of a Finder answer, or null when the answer lacks what it records. */
export function optionSubject(row: OptionRow, d: OptionsFinderResponse): OptionSubject | null {
  const s: OptionSubject = {
    kind: "option",
    contract: row.contract,
    type: row.type,
    exp: row.exp,
    strike: row.strike,
    entry: { n: row.n, fill: row.fill, cost: row.cost, session: d.market_as_of?.chain_session ?? "", underlying_close: d.market_as_of?.underlying_close as number },
    thesis: { symbol: d.symbol ?? "", view: d.inputs?.view as "up" | "down", target: d.inputs?.target as number, by: d.inputs?.by ?? "", breakeven: row.breakeven_expiry },
  };
  return whyOption(s) ? null : s;
}

/** The Position Monitor's address for an option subject (`?new=1&option=<json>`). */
export function optionHref(monitorPath: string, s: OptionSubject): string {
  const [base, query = ""] = monitorPath.split("?");
  const q = new URLSearchParams(query);
  q.set("new", "1");
  q.set("option", JSON.stringify(s));
  return `${base}?${q.toString()}`;
}

/** The option subject an address carries, or null (absent, or not readable: nothing is guessed). */
export function optionFromSearch(text: string | null): OptionSubject | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return whyOption(v) ? null : (v as OptionSubject);
  } catch {
    return null;
  }
}

/** The instrument a carried option fills in: "SYN Dec 18, 2026 $112.50 call". */
export function optionInstrument(s: OptionSubject): string {
  return `${s.thesis.symbol} ${dayLong(s.exp)} $${priceText(s.strike)} ${s.type}`;
}

/** One line on what the position holds and what it watches. */
export function optionLine(s: OptionSubject): string {
  const be = s.thesis.breakeven === null ? "" : `; warning line: the breakeven at expiry, $${priceText(s.thesis.breakeven)}`;
  return (
    `${s.entry.n} × ${optionInstrument(s)} at $${grouped(s.entry.fill, 2)} a share on the ${dayShort(s.entry.session)} close, $${grouped(s.entry.cost, 2)} in all (the maximum loss). ` +
    `Level to watch: ${s.thesis.symbol} ${s.thesis.view === "up" ? "at or above" : "at or below"} $${priceText(s.thesis.target)} by ${dayLong(s.thesis.by)}${be}.`
  );
}
