/**
 * Header ticker wired to the live layer: SPY + QQQ take the EODHD stream's
 * own day-change figures when a quote is on the board (web/src/live/quotes.ts
 * → api/stream.py), and fall back to the 30s DB intraday poll against the
 * prior daily close when the stream is silent. US 10Y stays on the credit
 * endpoint — yields aren't on the stream. Three items — orientation, not a
 * watchlist (TickerStrip prompt); the strip's own 600ms flash fires as live
 * prices tick.
 *
 * 2026-09-05: a quote that carries a price but no day-change (the off-hours
 * REST fill) now prints the price with its delay flag instead of "—", and the
 * last resort is the newest stored daily close with its date. The tape never
 * shows a dash for a symbol the Macro Tape one tab over can price.
 */

import { useMemo } from "react";
import { TickerStrip } from "../../components";
import { useCreditOas, useMarketDaily, useMarketIntraday } from "../../api/queries";
import { useQuotes } from "../../live/quotes";
import { fmtBps, fmtPct, fmtSignedPct } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";

interface TickerItem {
  label: string;
  value: string;
  raw?: number;
  tone?: "pos" | "neg";
  change?: string;
  changeTone?: "pos" | "neg";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${d}`;
}

function lastBySymbol<T extends { symbol: string }>(rows: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  rows?.forEach((r) => m.set(r.symbol, r)); // rows arrive date-ascending
  return m;
}

export default function TickerLive() {
  const { isMobile, isNarrow } = useBreakpoint();
  const quotes = useQuotes();
  const intraday = useMarketIntraday(["SPY", "QQQ"]);
  const daily = useMarketDaily(["SPY", "QQQ"], 45);
  const credit = useCreditOas(90);

  const items = useMemo<TickerItem[]>(() => {
    const out: TickerItem[] = [];

    for (const sym of ["SPY", "QQQ"]) {
      const live = quotes.get(sym);
      if (live?.dc != null) {
        // Stream quote: the exchange's own day change, marked delayed when
        // it came from the 15-min REST fill rather than a socket tick.
        out.push({
          label: sym,
          value: fmtSignedPct(live.dc),
          raw: live.p,
          tone: live.dc >= 0 ? "pos" : "neg",
          change: isMobile
            ? live.delayed
              ? "15m"
              : undefined
            : `$${live.p.toFixed(2)}${live.delayed ? " · 15m" : ""}`,
        });
        continue;
      }
      if (live?.p != null) {
        // Price without a day change: state the price and its delay, never a dash.
        out.push({
          label: sym,
          value: `$${live.p.toFixed(2)}`,
          raw: live.p,
          change: live.delayed ? "15m" : "last",
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
          label: sym,
          value: fmtSignedPct(chg),
          raw: last.close,
          tone: chg >= 0 ? "pos" : "neg",
          change: isMobile ? undefined : last.close.toFixed(2),
        });
      } else if (bars?.length) {
        // Last resort: the newest stored close, dated so nobody reads it as live.
        const lastBar = bars[bars.length - 1];
        out.push({
          label: sym,
          value: `$${(lastBar.close as number).toFixed(2)}`,
          raw: lastBar.close ?? undefined,
          change: `${shortDate(lastBar.date)} close`,
        });
      } else {
        out.push({ label: sym, value: "—", change: daily.isLoading ? undefined : "no price" });
      }
    }

    const ten = credit.data?.series.find((s) => s.label === "UST10Y");
    if (ten) {
      out.push({
        label: "US 10Y",
        value: fmtPct(ten.value_pct),
        raw: ten.value_pct,
        change:
          !isMobile && ten.change_1w_bps != null ? `${fmtBps(ten.change_1w_bps)} 1w` : undefined,
        // Direction, not valence: green is "up", red is "down" — for yields too.
        changeTone: ten.change_1w_bps != null && ten.change_1w_bps >= 0 ? "pos" : "neg",
      });
    } else {
      out.push({ label: "US 10Y", value: "—" });
    }

    return out;
  }, [quotes, intraday.data, daily.data, daily.isLoading, credit.data, isMobile]);

  // Below 768 the three items don't fit the screen: compact tightens the gap
  // and lets the strip scroll itself rather than widening the whole page.
  return <TickerStrip items={items} compact={isNarrow} style={{ marginTop: isNarrow ? 8 : 12 }} />;
}

export { lastBySymbol };
