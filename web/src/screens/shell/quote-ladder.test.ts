/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) A.11 and
 * E.1, `screens/shell/quote-ladder.test.ts`: `quoteFor` is the five-step
 * price ladder lifted out of TickerLive (2026-09-05 source order) so the strip
 * and the Dashboard's Markets-at-a-glance tiles can never disagree on a price.
 *
 * Every expected object below is the QuoteCardProps the inline ladder in
 * TickerLive.tsx:64-133 at 0afd3b7 produced for the same inputs, written down
 * before the extraction so the move is provably byte-identical: stream day
 * change (15M when delayed), stream price without a day change (15M or LAST),
 * the newest intraday bar against the prior close (two-bar rule), the dated
 * CLOSE, and the dash with NO PRICE once the daily query has answered.
 */
import { describe, expect, it } from "vitest";
import { quoteFor } from "./quote-ladder";
import type { DailyBar, IntradayPoint } from "../../api/types";
import type { LiveQuote } from "../../live/quotes";

const PRIOR = "2026-09-11";
const LATEST = "2026-09-14";
const DASH = "\u2014";

const bar = (symbol: string, date: string, close: number): DailyBar => ({
  symbol,
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000,
  vwap: close,
  ret_1d: null,
  ret_1w: null,
  ret_1m: null,
});
const point = (symbol: string, ts: string, close: number | null): IntradayPoint => ({ symbol, ts, close, volume: 10 });
const quote = (s: string, p: number, dc: number | null, delayed = false): LiveQuote => ({
  s,
  p,
  dc,
  dd: dc == null ? null : Math.round(p * dc) / 100,
  t: 1_789_400_000_000,
  delayed,
  src: delayed ? "rest" : "ws",
});
const quotes = (...items: LiveQuote[]) => new Map(items.map((q) => [q.s, q]));

const SPY = { symbol: "SPY", name: "S&P 500" };
const QQQ = { symbol: "QQQ", name: "Nasdaq 100" };

/** Two stored sessions per symbol, date-ascending as the API serves them. */
const DAILY = [bar("SPY", PRIOR, 640.1), bar("SPY", LATEST, 645.2), bar("QQQ", PRIOR, 570.4), bar("QQQ", LATEST, 572.9)];
/** The newest session's 5-minute closes (two SPY points, one QQQ point). */
const SESSION = [point("SPY", `${LATEST} 15:50:00`, 644.0), point("SPY", `${LATEST} 15:55:00`, 645.2), point("QQQ", `${LATEST} 15:55:00`, 572.9)];

const TAG_15M = { text: "15M", title: "15-minute delayed quote (REST fill)", tone: "amber" };
const TAG_LAST = { text: "LAST", title: "Last tick; the feed has not sent a day change yet", tone: "muted" };
const TAG_NO_PRICE = { text: "NO PRICE", title: "No stored or live price for this symbol", tone: "muted" };
const TAG_CLOSE = { text: "CLOSE", title: "Stored close, Sep 14, 2026", tone: "amber" };

describe("quoteFor (checklist 03 A.11): the strip's five-step ladder", () => {
  it("step 1: a stream quote with a day change prints the exchange's own figure, 15M when it is a REST fill", () => {
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, 0.79)), SESSION, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      change: "+0.79%",
      changeTone: "pos",
      series: [644, 645.2],
    });
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, 0.79, true)), SESSION, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      change: "+0.79%",
      changeTone: "pos",
      tag: TAG_15M,
      series: [644, 645.2],
    });
    expect(quoteFor(SPY, quotes(quote("SPY", 641.37, -0.42)), SESSION, DAILY)).toMatchObject({
      price: "641.37",
      raw: 641.37,
      change: "-0.42%",
      changeTone: "neg",
    });
    // A flat day change is "pos" (the strip's `dc >= 0` rule) and carries no sign.
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, 0)), SESSION, DAILY)).toMatchObject({ change: "0.00%", changeTone: "pos" });
    // The sparkline is the newest session's closes; with a single intraday
    // point it falls back to the last stored closes.
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, 0.79)), [point("SPY", `${LATEST} 15:55:00`, 645.2)], DAILY).series).toEqual([640.1, 645.2]);
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, 0.79)), undefined, undefined).series).toEqual([]);
  });

  it("step 2: a stream price without a day change prints the price with LAST, or 15M when delayed, never a dash", () => {
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, null)), SESSION, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      tag: TAG_LAST,
      series: [644, 645.2],
    });
    expect(quoteFor(SPY, quotes(quote("SPY", 645.2, null, true)), SESSION, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      tag: TAG_15M,
      series: [644, 645.2],
    });
    const stepTwo = quoteFor(SPY, quotes(quote("SPY", 645.2, null)), SESSION, DAILY);
    expect(stepTwo.change).toBeUndefined();
    expect(stepTwo.changeTone).toBeUndefined();
  });

  it("step 3: the newest stored intraday bar against the prior daily close, with the two-bar rule", () => {
    // A bar dated like the newest stored close compares with the close before it.
    expect(quoteFor(SPY, quotes(), SESSION, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      change: "+0.80%",
      changeTone: "pos",
      series: [644, 645.2],
      title: "Stored intraday bar Sep 14, 15:55 ET against the prior daily close",
    });
    // A bar newer than the newest stored close compares with that close.
    expect(quoteFor(SPY, quotes(), SESSION, [bar("SPY", PRIOR, 640.1)])).toMatchObject({
      price: "645.20",
      change: "+0.80%",
      changeTone: "pos",
      series: [644, 645.2],
      title: "Stored intraday bar Sep 14, 15:55 ET against the prior daily close",
    });
    // A same-day bar with a single stored close has nothing older to compare
    // with: the strip printed a flat change against that close (byte-identical).
    expect(quoteFor(SPY, quotes(), SESSION, [bar("SPY", LATEST, 645.2)])).toMatchObject({ price: "645.20", change: "0.00%", changeTone: "pos" });
    // Direction follows the sign of the move.
    const down = [point("SPY", `${LATEST} 15:50:00`, 639.0), point("SPY", `${LATEST} 15:55:00`, 638.0)];
    expect(quoteFor(SPY, quotes(), down, [bar("SPY", PRIOR, 640.1)])).toMatchObject({ price: "638.00", change: "-0.33%", changeTone: "neg", series: [639, 638] });
    // Intraday bars alone (no stored close to compare with) do not price the symbol.
    expect(quoteFor(SPY, quotes(), SESSION, [])).toEqual({ symbol: "SPY", price: DASH, tag: TAG_NO_PRICE });
  });

  it("step 4: the newest stored close, tagged CLOSE with its date, with the last 20 closes as the sparkline", () => {
    expect(quoteFor(SPY, quotes(), undefined, DAILY)).toEqual({
      symbol: "SPY",
      price: "645.20",
      raw: 645.2,
      tag: TAG_CLOSE,
      series: [640.1, 645.2],
    });
    expect(quoteFor(SPY, quotes(), [], DAILY)).toEqual(quoteFor(SPY, quotes(), undefined, DAILY));
    // Intraday rows without a close are ignored, so the stored close still wins.
    expect(quoteFor(SPY, quotes(), [point("SPY", `${LATEST} 15:55:00`, null)], DAILY)).toMatchObject({ price: "645.20", tag: TAG_CLOSE });
    // Each symbol walks its own bars.
    expect(quoteFor(QQQ, quotes(), undefined, DAILY)).toEqual({
      symbol: "QQQ",
      price: "572.90",
      raw: 572.9,
      tag: TAG_CLOSE,
      series: [570.4, 572.9],
    });
    // The sparkline keeps the last 20 stored closes, oldest to newest.
    const many = Array.from({ length: 25 }, (_, i) => bar("SPY", `2026-08-${String(i + 1).padStart(2, "0")}`, 600 + i));
    const long = quoteFor(SPY, quotes(), undefined, many);
    expect(long.series).toHaveLength(20);
    expect(long.series?.[0]).toBe(605);
    expect(long.series?.[19]).toBe(624);
    expect(long).toMatchObject({ price: "624.00", raw: 624, tag: { text: "CLOSE", title: "Stored close, Aug 25, 2026", tone: "amber" } });
  });

  it("step 5: the dash placeholder, tagged NO PRICE once the daily query has answered", () => {
    expect(quoteFor(SPY, quotes(), [], [])).toEqual({ symbol: "SPY", price: DASH, tag: TAG_NO_PRICE });
    expect(quoteFor(SPY, quotes(), undefined, undefined)).toEqual({ symbol: "SPY", price: DASH, tag: TAG_NO_PRICE });
    // While the daily query is pending no absence is asserted: a bare dash.
    expect(quoteFor(SPY, quotes(), undefined, undefined, { dailyLoading: true })).toEqual({ symbol: "SPY", price: DASH });
    expect(quoteFor(SPY, quotes(), undefined, undefined, { dailyLoading: true }).tag).toBeUndefined();
    // Another symbol's quote or bars never price this one.
    expect(quoteFor(SPY, quotes(quote("QQQ", 572.9, 0.4)), [], [bar("QQQ", LATEST, 572.9)])).toEqual({ symbol: "SPY", price: DASH, tag: TAG_NO_PRICE });
  });

  it("the steps are tried in order: the first source with a price wins", () => {
    const stream = quotes(quote("SPY", 646.0, 0.9));
    expect(quoteFor(SPY, stream, SESSION, DAILY)).toMatchObject({ price: "646.00", change: "+0.90%" });
    expect(quoteFor(SPY, stream, SESSION, DAILY).tag).toBeUndefined();
    expect(quoteFor(SPY, quotes(quote("SPY", 646.0, null)), SESSION, DAILY)).toMatchObject({ price: "646.00", tag: TAG_LAST });
    expect(quoteFor(SPY, quotes(), SESSION, DAILY)).toMatchObject({ price: "645.20", change: "+0.80%", title: /Stored intraday bar/ });
    expect(quoteFor(SPY, quotes(), undefined, DAILY)).toMatchObject({ price: "645.20", tag: TAG_CLOSE });
    expect(quoteFor(SPY, quotes(), undefined, [])).toMatchObject({ price: DASH, tag: TAG_NO_PRICE });
  });

  it("prints FX at the def's decimal places (EURUSD 4 dp, USDJPY 3 dp) for the glance tiles", () => {
    expect(quoteFor({ symbol: "EURUSD", dp: 4 }, quotes(quote("EURUSD", 1.0832, 0.12)), undefined, [])).toMatchObject({ price: "1.0832", change: "+0.12%" });
    expect(quoteFor({ symbol: "USDJPY", dp: 3 }, quotes(quote("USDJPY", 147.2, -0.3)), undefined, [])).toMatchObject({ price: "147.200", change: "-0.30%" });
    // The default stays two places, as the strip always printed.
    expect(quoteFor({ symbol: "EURUSD" }, quotes(quote("EURUSD", 1.0832, 0.12)), undefined, []).price).toBe("1.08");
  });
});
