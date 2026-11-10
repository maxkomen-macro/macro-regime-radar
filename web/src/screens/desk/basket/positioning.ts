/**
 * The words and numbers Basket & Hedge's Positioning card prints from `/positioning` (§12.20, Desk P4;
 * docs/desk/POSITIONING_SPEC.md). Pure: every figure is the server's, and a value that is not a finite number
 * prints "—", never NaN. Net positions are contracts (long minus short of the market's speculative category);
 * their share of open interest is a percent, and a week's change of that share is in points. No threshold turns a
 * figure into a word: the card states where the share sits among the market's own reports of three years.
 */

import type { CotMarket, PositioningHoldings } from "../data/types";
import { dayLong, dayShort, grouped, ordinal } from "../kit/format";

const MINUS = "−";
const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Contracts with a sign: "+12,340", "−372,318", "0". */
export function contracts(x: number | null | undefined): string {
  if (!fin(x)) return "—";
  if (x === 0) return "0";
  return x > 0 ? `+${grouped(x)}` : grouped(x);
}

/** A share of open interest, in percent, with a sign: "+12.4%", "−18.7%". */
export function shareOfOi(x: number | null | undefined): string {
  if (!fin(x)) return "—";
  const s = Math.abs(x).toFixed(1);
  if (Number(s) === 0) return "0.0%";
  return `${x < 0 ? MINUS : "+"}${s}%`;
}

/** A change of that share, in points: "+1.3 pts", "−0.4 pts". */
export function sharePoints(x: number | null | undefined): string {
  if (!fin(x)) return "—";
  const s = Math.abs(x).toFixed(1);
  if (Number(s) === 0) return "0.0 pts";
  return `${x < 0 ? MINUS : "+"}${s} pts`;
}

/** "Net long" / "Net short" / "Flat", from the net in contracts. */
export function sideWord(net: number | null | undefined): string {
  if (!fin(net) || net === 0) return "Flat";
  return net > 0 ? "Net long" : "Net short";
}

/** The percentile among the three years' reports, as an ordinal: "32nd". The server's 100 × at-or-below / n. */
export function percentileText(m: CotMarket): string {
  const p = m.range_3y?.percentile;
  return fin(p) ? ordinal(Math.round(p)) : "—";
}

/** The report's dates in one line: "Positions Nov 3 · released Nov 6", or the schedule's silence in its words. */
export function datesLine(m: CotMarket): string {
  const rel = m.released ? `released ${dayShort(m.released)}${m.release_delayed ? " (holiday delay)" : ""}` : m.release_note;
  return `Positions ${dayShort(m.as_of)} · ${rel}`;
}

/** The week's change, or why it is not shown. */
export function changeText(m: CotMarket): string {
  return m.change_1w ? sharePoints(m.change_1w.net_pct_oi) : "—";
}

/** The Advanced line on a market's three-year range, or why there is none. */
export function rangeLine(m: CotMarket): string {
  const r = m.range_3y;
  if (!r) return `${m.label}: no three-year range: ${m.range_reason ?? "not served"}.`;
  return (
    `${m.label}: ${shareOfOi(m.net_pct_oi)} of open interest is at the ${percentileText(m)} percentile of ${r.n} weekly reports ` +
    `from ${dayLong(r.from)} to ${dayLong(r.to)} (lowest ${shareOfOi(r.min_pct_oi)} on ${dayLong(r.min_on)}, highest ` +
    `${shareOfOi(r.max_pct_oi)} on ${dayLong(r.max_on)}).`
  );
}

/** The Advanced line on what a market's figures read: the report, how much history, what was set aside. */
export function historyLine(m: CotMarket): string {
  const aside = m.excluded.length ? ` ${m.excluded.length} set aside: ${m.excluded.map((x) => `${dayLong(x.as_of) || x.as_of} (${x.reason})`).join("; ")}.` : "";
  return (
    `${m.label}: CFTC ${m.report_title}, contract ${m.contract_code} (${m.market_name}); ${m.reports} weekly reports from ` +
    `${dayLong(m.history_from)}; first stored ${dayLong(m.first_stored_at.slice(0, 10))}.${aside}`
  );
}

/** The basket's names the 13F block serves, in basket order, and the names it does not, each with the server's why.
 * A row is found by the spelling the leg asked by (`requested`: a leg typed BRK-B is served as BRK.B, verifier F-1). */
export function holdingsFor(h: PositioningHoldings, symbols: readonly string[]) {
  const by = new Map(h.names.map((n) => [n.requested ?? n.symbol, n]));
  const why = new Map(h.excluded.map((x) => [x.requested ?? x.symbol, x.reason]));
  const rows = symbols.flatMap((s) => (by.has(s) ? [by.get(s)!] : []));
  const missing = symbols.filter((s) => !by.has(s)).map((s) => ({ symbol: s, reason: why.get(s) ?? "not served for this basket" }));
  return { rows, missing };
}

/** The holders' change from the quarter before: "+92", or "—" with the reason in its title. */
export function holdersChange(n: PositioningHoldings["names"][number]): string {
  return contracts(n.holders_change);
}

/** The Advanced line on what the 13F block read. */
export function holdingsReadLine(h: PositioningHoldings): string {
  const amend = `${grouped(h.restatements)} restatements applied and ${grouped(h.new_holdings)} new-holdings amendments added`;
  const prev = h.previous_period ? ` The change is against ${dayLong(h.previous_period)}.` : ` No change: ${h.previous_reason ?? "the quarter before is not stored"}.`;
  return (
    `${grouped(h.filings)} holdings reports and amendments for ${dayLong(h.period)} from ${grouped(h.filers)} filers, ` +
    `filed through ${dayLong(h.newest_filing ?? h.filings_through)}: ${amend}.${prev} Data sets: ${h.data_sets.join(", ")}. ` +
    `Tickers paired from the SEC's fails-to-deliver files ${h.ftd_files.join(", ")}.`
  );
}
