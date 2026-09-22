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
 *
 * 2026-09-15 (Phase 3): the five-step price ladder lives in quote-ladder.ts
 * (`quoteFor`), shared with the Dashboard's Markets-at-a-glance tiles so the
 * strip and the tiles can never disagree on a price. Behaviour unchanged.
 */

import { useMemo } from "react";
import { useCreditOas, useMarketDaily, useMarketIntraday } from "../../api/queries";
import { useQuotes } from "../../live/quotes";
import { fmtBps, fmtDate, fmtPct } from "../../lib/format";
import { MISSING, missingNote, useSnapshotMode } from "../shared/screen-ui";
import { SRC, Stamp, metricAttrs, quoteStamp } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import FreshnessCard from "./FreshnessCard";
import QuoteCard, { type QuoteCardProps } from "./QuoteCard";
import { quoteFor, withFreshTags } from "./quote-ladder";
import type { ShellStatus } from "./shell-status";

function lastBySymbol<T extends { symbol: string }>(rows: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  rows?.forEach((r) => m.set(r.symbol, r)); // rows arrive date-ascending
  return m;
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
  const snapshot = useSnapshotMode();
  // CP4: a card with no price says why when the stored closes did not load.
  const unavailable = daily.isError && !daily.data ? missingNote(MISSING.market, snapshot) : undefined;
  // A1: every card names its source and as-of (the ladder rung's series,
  // the credit payload's own DGS10 state for the 10Y).
  const report = useFreshReport();

  const cards = useMemo<QuoteCardProps[]>(() => {
    // SPY and QQQ walk the shared ladder; the US 10Y stays on the credit
    // endpoint below because yields are not on the stream.
    const out: QuoteCardProps[] = ["SPY", "QQQ"].map((symbol) => {
      const q = quoteFor({ symbol }, quotes, intraday.data, daily.data, { dailyLoading: daily.isLoading, unavailable });
      // A3: the CLOSE tag and the stale mark read the server's words; F1:
      // dated by the card's own tick or bar, never the feed-wide as_of.
      return withFreshTags(
        { ...q, stamp: quoteStamp(q, report) },
        { daily: report.at("market_daily", q.servedAt), intraday: report.at("market_intraday", q.servedAt) },
      );
    });

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
        stamp: <Stamp source={SRC.fred} label={report.series(ten.series_id, credit.data?.freshness)} />,
        valueAttrs: metricAttrs("ust10y", ten.value_pct),
      });
    } else {
      // CP4: the dash says why when the yield did not load.
      out.push({ symbol: "US 10Y", price: "—", title: credit.isError ? "US 10Y yield unavailable: the data service did not answer." : undefined });
    }

    return out;
  }, [quotes, intraday.data, daily.data, daily.isLoading, credit.data, credit.isError, unavailable, report]);

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
