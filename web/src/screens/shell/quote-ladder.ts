/**
 * Quote ladder (redesign Phase 3, checklist 03 A.11): the one function that
 * turns a symbol's stream quote, stored intraday bars and stored daily closes
 * into the QuoteCardProps the strip renders. Lifted verbatim from TickerLive
 * (the 2026-09-05 source order) so the Dashboard's Markets-at-a-glance tiles
 * and the strip can never disagree on a price. Five steps, first hit wins:
 *
 *   1. a stream quote with a day change: the exchange's own figure, tagged 15M
 *      when it came from the 15-min REST fill rather than a socket tick;
 *   2. a stream price without a day change: the price and its delay (15M or
 *      LAST), never a dash;
 *   3. the newest stored intraday bar against the prior daily close (a bar
 *      dated like the newest stored close compares with the close before it,
 *      so a same-day bar needs two stored bars);
 *   4. the newest stored daily close, tagged CLOSE with its date so nobody
 *      reads it as live;
 *   5. the dash placeholder, tagged NO PRICE once the daily query has answered
 *      (no absence is asserted while it is pending).
 *
 * Pure: no React, no hooks. The sparkline is the latest session's intraday
 * closes when two or more exist, else the last 20 stored closes.
 */
import type { DailyBar, IntradayPoint } from "../../api/types";
import type { LiveQuote } from "../../live/quotes";
import { fmtDate, fmtIntradayTs, fmtSignedPct } from "../../lib/format";
import type { QuoteCardProps, QuoteTag } from "./QuoteCard";

export interface QuoteDef {
  symbol: string;
  name?: string;
  /** Decimal places for the price: 2 unless the def says otherwise (the
   * glance FX tiles print EURUSD at 4 and USDJPY at 3). */
  dp?: number;
}

export interface QuoteLadderOptions {
  /** True while the daily-close query is still pending: the last step then
   * leaves the NO PRICE tag off rather than asserting an absence before an
   * answer (the strip's 2026-09-05 rule). */
  dailyLoading?: boolean;
  /** CP4: why no price exists when the stored read failed ("Live and stored
   * market prices are not in this snapshot."). The NO PRICE tag and the card
   * carry it as their title instead of the generic line. */
  unavailable?: string;
}

const DELAYED_TAG: QuoteTag = { text: "15M", title: "15-minute delayed quote (REST fill)", tone: "amber" };
const LAST_TAG: QuoteTag = { text: "LAST", title: "Last tick; the feed has not sent a day change yet", tone: "muted" };
const NO_PRICE_TAG: QuoteTag = { text: "NO PRICE", title: "No stored or live price for this symbol", tone: "muted" };

/** The latest session's intraday closes (two or more points), else nothing. */
export function intradaySeries(points: IntradayPoint[] | undefined, sym: string): number[] | undefined {
  const rows = points?.filter((p) => p.symbol === sym && p.close != null) ?? [];
  if (!rows.length) return undefined;
  const newestDate = rows[rows.length - 1].ts.slice(0, 10);
  const session = rows.filter((p) => p.ts.slice(0, 10) === newestDate).map((p) => p.close as number);
  return session.length >= 2 ? session : undefined;
}

/** The last 20 stored daily closes. */
export function dailySeries(bars: DailyBar[] | undefined, sym: string): number[] {
  return (bars ?? [])
    .filter((b) => b.symbol === sym && b.close != null)
    .slice(-20)
    .map((b) => b.close as number);
}

/** The card props for one symbol, by the five-step ladder above. */
export function quoteFor(
  def: QuoteDef,
  quotes: ReadonlyMap<string, LiveQuote>,
  intradayRows: IntradayPoint[] | undefined,
  dailyBars: DailyBar[] | undefined,
  opts: QuoteLadderOptions = {},
): QuoteCardProps {
  const sym = def.symbol;
  const dp = def.dp ?? 2;
  const live = quotes.get(sym);
  const series = intradaySeries(intradayRows, sym) ?? dailySeries(dailyBars, sym);

  if (live?.dc != null) {
    // Stream quote: the exchange's own day change, marked delayed when it
    // came from the 15-min REST fill rather than a socket tick.
    return {
      symbol: sym,
      price: live.p.toFixed(dp),
      raw: live.p,
      change: fmtSignedPct(live.dc),
      changeTone: live.dc >= 0 ? "pos" : "neg",
      tag: live.delayed ? DELAYED_TAG : undefined,
      series,
    };
  }
  if (live?.p != null) {
    // Price without a day change: state the price and its delay, never a dash.
    return {
      symbol: sym,
      price: live.p.toFixed(dp),
      raw: live.p,
      tag: live.delayed ? DELAYED_TAG : LAST_TAG,
      series,
    };
  }

  const points = intradayRows?.filter((p) => p.symbol === sym && p.close != null);
  const last = points?.length ? points[points.length - 1] : undefined;
  const bars = dailyBars?.filter((b) => b.symbol === sym && b.close != null);
  let prevClose: number | undefined;
  if (bars?.length) {
    const lastBar = bars[bars.length - 1];
    const intradayDate = last?.ts.slice(0, 10);
    prevClose =
      intradayDate === lastBar.date && bars.length > 1
        ? (bars[bars.length - 2].close ?? undefined)
        : (lastBar.close ?? undefined);
  }
  if (last?.close != null && prevClose) {
    const chg = (last.close / prevClose - 1) * 100;
    return {
      symbol: sym,
      price: last.close.toFixed(dp),
      raw: last.close,
      change: fmtSignedPct(chg),
      changeTone: chg >= 0 ? "pos" : "neg",
      series,
      title: `Stored intraday bar ${fmtIntradayTs(last.ts)} against the prior daily close`,
    };
  }
  if (bars?.length) {
    // Last resort: the newest stored close, dated so nobody reads it as live.
    const lastBar = bars[bars.length - 1];
    return {
      symbol: sym,
      price: (lastBar.close as number).toFixed(dp),
      raw: lastBar.close ?? undefined,
      tag: { text: "CLOSE", title: `Stored close, ${fmtDate(lastBar.date)}`, tone: "amber" },
      series,
    };
  }
  return {
    symbol: sym,
    price: "—",
    tag: opts.dailyLoading ? undefined : opts.unavailable ? { ...NO_PRICE_TAG, title: opts.unavailable } : NO_PRICE_TAG,
    ...(opts.unavailable && !opts.dailyLoading ? { title: opts.unavailable } : null),
  };
}
