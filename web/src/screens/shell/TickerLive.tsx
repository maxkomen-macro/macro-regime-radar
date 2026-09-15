/**
 * The ticker strip, wired to the live layer (redesign Phase 1, spec §2):
 * three quote cards (SPY, QQQ, US 10Y) and the freshness card that opens the
 * per-source breakdown. SPY + QQQ take the EODHD stream's own day-change
 * figures when a quote is on the board (web/src/live/quotes.ts →
 * api/stream.py), and fall back to the 30s DB intraday poll against the prior
 * daily close when the stream is silent. US 10Y stays on the credit endpoint;
 * yields are not on the stream.
 *
 * 2026-09-05: a quote that carries a price but no day-change (the off-hours
 * REST fill) prints the price with its delay tag instead of "—", and the last
 * resort is the newest stored daily close, tagged CLOSE with its date. The
 * strip never shows a dash for a symbol the Macro Tape one tab over can price.
 * The source order is unchanged by the redesign; only the card changed.
 */

import { useMemo } from "react";
import { useCreditOas, useMarketDaily, useMarketIntraday } from "../../api/queries";
import type { DailyBar, IntradayPoint } from "../../api/types";
import { useQuotes } from "../../live/quotes";
import { fmtBps, fmtDate, fmtIntradayTs, fmtPct, fmtSignedPct } from "../../lib/format";
import FreshnessCard from "./FreshnessCard";
import QuoteCard, { type QuoteCardProps } from "./QuoteCard";
import type { ShellStatus } from "./shell-status";

function lastBySymbol<T extends { symbol: string }>(rows: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  rows?.forEach((r) => m.set(r.symbol, r)); // rows arrive date-ascending
  return m;
}

/** The latest session's intraday closes (two or more points), else nothing. */
function intradaySeries(points: IntradayPoint[] | undefined, sym: string): number[] | undefined {
  const rows = points?.filter((p) => p.symbol === sym && p.close != null) ?? [];
  if (!rows.length) return undefined;
  const newestDate = rows[rows.length - 1].ts.slice(0, 10);
  const session = rows.filter((p) => p.ts.slice(0, 10) === newestDate).map((p) => p.close as number);
  return session.length >= 2 ? session : undefined;
}

/** The last 20 stored daily closes. */
function dailySeries(bars: DailyBar[] | undefined, sym: string): number[] {
  return (bars ?? [])
    .filter((b) => b.symbol === sym && b.close != null)
    .slice(-20)
    .map((b) => b.close as number);
}

interface Props {
  status: ShellStatus;
  freshnessOpen: boolean;
  onOpenFreshness: () => void;
}

export default function TickerLive({ status, freshnessOpen, onOpenFreshness }: Props) {
  const quotes = useQuotes();
  const intraday = useMarketIntraday(["SPY", "QQQ"]);
  const daily = useMarketDaily(["SPY", "QQQ"], 45);
  const credit = useCreditOas(90);

  const cards = useMemo<QuoteCardProps[]>(() => {
    const out: QuoteCardProps[] = [];

    for (const sym of ["SPY", "QQQ"]) {
      const live = quotes.get(sym);
      const series = intradaySeries(intraday.data, sym) ?? dailySeries(daily.data, sym);
      if (live?.dc != null) {
        // Stream quote: the exchange's own day change, marked delayed when
        // it came from the 15-min REST fill rather than a socket tick.
        out.push({
          symbol: sym,
          price: live.p.toFixed(2),
          raw: live.p,
          change: fmtSignedPct(live.dc),
          changeTone: live.dc >= 0 ? "pos" : "neg",
          tag: live.delayed ? { text: "15M", title: "15-minute delayed quote (REST fill)", tone: "amber" } : undefined,
          series,
        });
        continue;
      }
      if (live?.p != null) {
        // Price without a day change: state the price and its delay, never a dash.
        out.push({
          symbol: sym,
          price: live.p.toFixed(2),
          raw: live.p,
          tag: live.delayed
            ? { text: "15M", title: "15-minute delayed quote (REST fill)", tone: "amber" }
            : { text: "LAST", title: "Last tick; the feed has not sent a day change yet", tone: "muted" },
          series,
        });
        continue;
      }
      const points = intraday.data?.filter((p) => p.symbol === sym && p.close != null);
      const last = points?.length ? points[points.length - 1] : undefined;
      const bars = daily.data?.filter((b) => b.symbol === sym && b.close != null);
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
        out.push({
          symbol: sym,
          price: last.close.toFixed(2),
          raw: last.close,
          change: fmtSignedPct(chg),
          changeTone: chg >= 0 ? "pos" : "neg",
          series,
          title: `Stored intraday bar ${fmtIntradayTs(last.ts)} against the prior daily close`,
        });
      } else if (bars?.length) {
        // Last resort: the newest stored close, dated so nobody reads it as live.
        const lastBar = bars[bars.length - 1];
        out.push({
          symbol: sym,
          price: (lastBar.close as number).toFixed(2),
          raw: lastBar.close ?? undefined,
          tag: { text: "CLOSE", title: `Stored close, ${fmtDate(lastBar.date)}`, tone: "amber" },
          series,
        });
      } else {
        out.push({
          symbol: sym,
          price: "—",
          tag: daily.isLoading ? undefined : { text: "NO PRICE", title: "No stored or live price for this symbol", tone: "muted" },
        });
      }
    }

    const ten = credit.data?.series.find((s) => s.label === "UST10Y");
    if (ten) {
      out.push({
        symbol: "US 10Y",
        price: fmtPct(ten.value_pct),
        raw: ten.value_pct,
        change: ten.change_1w_bps != null ? fmtBps(ten.change_1w_bps) : undefined,
        // Direction, not valence: green is "up", red is "down", for yields too.
        changeTone: ten.change_1w_bps != null ? (ten.change_1w_bps >= 0 ? "pos" : "neg") : undefined,
        tag: ten.change_1w_bps != null ? { text: "1W", title: "Change over one week", tone: "muted" } : undefined,
        series: ten.history.map((h) => h.value),
        title: `10-year Treasury yield · FRED ${ten.series_id} · ${fmtDate(ten.date)}`,
      });
    } else {
      out.push({ symbol: "US 10Y", price: "—" });
    }

    return out;
  }, [quotes, intraday.data, daily.data, daily.isLoading, credit.data]);

  return (
    <div className="mrr-strip" role="region" aria-label="Market strip and data freshness">
      {cards.map((c) => (
        <QuoteCard key={c.symbol} {...c} />
      ))}
      <FreshnessCard status={status} open={freshnessOpen} onOpen={onOpenFreshness} />
    </div>
  );
}

export { lastBySymbol };
