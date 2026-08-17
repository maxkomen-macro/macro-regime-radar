/**
 * Header ticker wired to the live layer: SPY + QQQ take the EODHD stream's
 * own day-change figures when a quote is on the board (web/src/live/quotes.ts
 * → api/stream.py), and fall back to the 30s DB intraday poll against the
 * prior daily close when the stream is silent. US 10Y stays on the credit
 * endpoint — yields aren't on the stream. Three items — orientation, not a
 * watchlist (TickerStrip prompt); the strip's own 600ms flash fires as live
 * prices tick.
 */

import { useMemo } from "react";
import { TickerStrip } from "../../components";
import { useCreditOas, useMarketDaily, useMarketIntraday } from "../../api/queries";
import { useQuotes } from "../../live/quotes";
import { fmtBps, fmtPct, fmtSignedPct } from "../../lib/format";

interface TickerItem {
  label: string;
  value: string;
  raw?: number;
  tone?: "pos" | "neg";
  change?: string;
  changeTone?: "pos" | "neg";
}

function lastBySymbol<T extends { symbol: string }>(rows: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  rows?.forEach((r) => m.set(r.symbol, r)); // rows arrive date-ascending
  return m;
}

export default function TickerLive() {
  const quotes = useQuotes();
  const intraday = useMarketIntraday(["SPY", "QQQ"]);
  const daily = useMarketDaily(["SPY", "QQQ"], 14);
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
          change: `$${live.p.toFixed(2)}${live.delayed ? " · 15m" : ""}`,
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
          change: last.close.toFixed(2),
        });
      } else {
        out.push({ label: sym, value: "—" });
      }
    }

    const ten = credit.data?.series.find((s) => s.label === "UST10Y");
    if (ten) {
      out.push({
        label: "US 10Y",
        value: fmtPct(ten.value_pct),
        raw: ten.value_pct,
        change: ten.change_1w_bps != null ? `${fmtBps(ten.change_1w_bps)} 1w` : undefined,
        // Direction, not valence: green is "up", red is "down" — for yields too.
        changeTone: ten.change_1w_bps != null && ten.change_1w_bps >= 0 ? "pos" : "neg",
      });
    } else {
      out.push({ label: "US 10Y", value: "—" });
    }

    return out;
  }, [quotes, intraday.data, daily.data, credit.data]);

  return <TickerStrip items={items} style={{ marginTop: 14 }} />;
}

export { lastBySymbol };
