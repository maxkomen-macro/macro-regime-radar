/**
 * Per-row price source (checklist F.3): the live relay first, 5D candles
 * as the fallback.
 *
 *   live      ws tick inside LIVE_WINDOW_MS       price, change, sparkline
 *   delayed   REST / stale relay row              price, change, `15M` tag
 *   eod       no relay row: last 5D candle close  price, change vs the
 *                                                 previous session, `EOD` tag
 *   none      nothing yet (loading, unknown symbol)
 *
 * The row asks the relay to watch its symbol (reference counted in
 * quotes.ts; symbols on the fixed tape cost no dynamic slot) and only requests
 * 5D candles while no usable quote is on the board, so a list of tape
 * symbols costs no candle requests once the relay has answered. Candles that
 * were fetched before the relay answered stay cached and keep drawing the
 * sparkline next to the live price.
 */

import { useMemo } from "react";
import { useSymbolCandles } from "../../../api/queries";
import type { CandleBar } from "../../../api/types";
import { LIVE_WINDOW_MS, useQuotes, useWatch } from "../../../live/quotes";
import { fmtSignedPct } from "../../../lib/format";

export type QuoteSource = "live" | "delayed" | "eod" | "none";
export type QuoteTone = "pos" | "neg" | "flat";

export interface WatchlistQuote {
  symbol: string;
  source: QuoteSource;
  price: number | null;
  /** Day change in percent (relay `dc`, or last close vs the previous session's close). */
  changePct: number | null;
  /** `toFixed(2)`, `toFixed(4)` below 10, or "—". No currency sign. */
  priceText: string;
  /** `fmtSignedPct(change, 1)` or "—". */
  changeText: string;
  tone: QuoteTone;
  /** `EOD` for a candle close, `15M` for a delayed relay row, null when live or empty. */
  tag: "EOD" | "15M" | null;
  /** 5D closes, oldest first, downsampled to at most 48 points; null when fewer than 2. */
  spark: number[] | null;
  /** True while the candle fallback is still in flight. */
  loading: boolean;
  /** The candle fallback failed (unknown symbol, provider down) and no quote is on the board. */
  error: boolean;
}

export const SPARK_POINTS = 48;

export function fmtWatchPrice(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return Math.abs(v) < 10 ? v.toFixed(4) : v.toFixed(2);
}

export function fmtWatchChange(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return fmtSignedPct(v, 1);
}

export function toneOf(v: number | null): QuoteTone {
  if (v == null || !Number.isFinite(v) || v === 0) return "flat";
  return v > 0 ? "pos" : "neg";
}

/** Keep at most `max` points, always including the last bar. */
export function downsample(values: number[], max = SPARK_POINTS): number[] {
  if (values.length <= max) return values;
  const step = Math.ceil(values.length / max);
  const out: number[] = [];
  for (let i = 0; i < values.length; i += step) out.push(values[i]);
  if (out[out.length - 1] !== values[values.length - 1]) out.push(values[values.length - 1]);
  return out;
}

export interface CandleRead {
  last: number | null;
  /** Last close vs the previous session's last close; null with fewer than two sessions. */
  changePct: number | null;
  closes: number[];
}

/** 5-minute bars grouped into sessions by the date part of `ts`. */
export function readCandles(bars: CandleBar[] | undefined): CandleRead {
  if (!bars || bars.length === 0) return { last: null, changePct: null, closes: [] };
  const closes = bars.map((b) => b.close).filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (closes.length === 0) return { last: null, changePct: null, closes: [] };
  const last = closes[closes.length - 1];
  // Last close of each session, in bar order.
  const lastBySession = new Map<string, number>();
  for (const b of bars) {
    if (typeof b.close !== "number" || !Number.isFinite(b.close)) continue;
    lastBySession.set(b.ts.slice(0, 10), b.close);
  }
  const sessions = [...lastBySession.keys()].sort();
  let changePct: number | null = null;
  if (sessions.length >= 2) {
    const prev = lastBySession.get(sessions[sessions.length - 2]);
    if (prev != null && prev !== 0) changePct = (last / prev - 1) * 100;
  }
  return { last, changePct, closes };
}

export function useWatchlistQuote(symbol: string): WatchlistQuote {
  useWatch(symbol);
  const quotes = useQuotes();
  // "BRK.B" is how a desk writes a share class; the feed spells it "BRK-B".
  const quote = quotes.get(symbol) ?? quotes.get(symbol.replace(".", "-"));
  const onBoard = quote != null && typeof quote.p === "number" && Number.isFinite(quote.p) && quote.dc != null;
  const live = onBoard && quote.src === "ws" && quote.t != null && Date.now() - quote.t < LIVE_WINDOW_MS;

  // Candles only while no usable quote is on the board (query budget, F.3);
  // a disabled query still hands back what it fetched earlier.
  const candles = useSymbolCandles(onBoard ? null : symbol, "5D");
  const read = useMemo(() => readCandles(candles.data?.bars), [candles.data]);
  const spark = useMemo(() => (read.closes.length >= 2 ? downsample(read.closes) : null), [read.closes]);

  if (onBoard) {
    const changePct = quote.dc;
    return {
      symbol,
      source: live ? "live" : "delayed",
      price: quote.p,
      changePct,
      priceText: fmtWatchPrice(quote.p),
      changeText: fmtWatchChange(changePct),
      tone: toneOf(changePct),
      tag: live ? null : "15M",
      spark,
      loading: false,
      error: false,
    };
  }

  const hasClose = read.last != null;
  return {
    symbol,
    source: hasClose ? "eod" : "none",
    price: read.last,
    changePct: read.changePct,
    priceText: fmtWatchPrice(read.last),
    changeText: fmtWatchChange(read.changePct),
    tone: toneOf(read.changePct),
    tag: hasClose ? "EOD" : null,
    spark,
    loading: candles.isPending && !hasClose,
    error: candles.isError && !hasClose,
  };
}

export default useWatchlistQuote;
