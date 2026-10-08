/**
 * The ticker strip, wired to the live layer (redesign Phase 1, spec §2):
 * four quote cards, SPY and QQQ over US 10Y and US 30Y (fix/freshness 8: the
 * status card left the strip; the sidebar's "● Data status" carries its
 * markets as-of and opens the breakdown). SPY + QQQ take the relay's day-change figures (each
 * US tick against the previous regular-session close) when a quote is on the board (web/src/live/quotes.ts →
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
import { useQuotes, useStreamStatus } from "../../live/quotes";
import { fmtBps, fmtDate, fmtPct } from "../../lib/format";
import { MISSING, missingNote, useSnapshotMode } from "../shared/screen-ui";
import { SRC, Stamp, metricAttrs, quoteStamp, type MetricId } from "../shared/Stamp";
import { useFreshReport } from "../shared/useFreshReport";
import { rateChange } from "../shared/rate-change";
import QuoteCard, { type QuoteCardProps } from "./QuoteCard";
import { quoteFor, withFreshTags } from "./quote-ladder";
import type { CreditOAS, CreditSeries } from "../../api/types";
import type { FreshReport } from "../shared/useFreshReport";

function lastBySymbol<T extends { symbol: string }>(rows: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  rows?.forEach((r) => m.set(r.symbol, r)); // rows arrive date-ascending
  return m;
}

/** A Treasury card from a served rate (the 10Y in series[], the 30Y in its own field): the level, the true 1W
 * change in bp with both dates in its title, the daily sparkline and the FRED stamp with its days behind. */
function treasuryCard(symbol: string, words: string, s: CreditSeries, credit: CreditOAS, report: FreshReport, metric?: MetricId): QuoteCardProps {
  // fix/freshness 2: "1W" only on a true seven-day change; the date is the
  // newest observation's own, never the month stamp.
  const chg = rateChange(s);
  return {
    symbol,
    price: fmtPct(s.value_pct),
    raw: s.value_pct,
    change: chg ? fmtBps(chg.bps) : undefined,
    // Direction, not valence: green is "up", red is "down", for yields too.
    changeTone: chg ? (chg.bps >= 0 ? "pos" : "neg") : undefined,
    tag: chg ? { text: chg.tag, title: chg.title, tone: "muted" } : undefined,
    series: s.history.map((h) => h.value),
    title: `${words} · FRED ${s.series_id} · ${fmtDate(s.date)}`,
    stamp: <Stamp source={SRC.fred} label={report.series(s.series_id, credit.freshness)} />,
    valueAttrs: metric ? metricAttrs(metric, s.value_pct) : undefined,
  };
}

export default function TickerLive() {
  const quotes = useQuotes();
  const stale = useStreamStatus().stale; // D7 follow-up: a 15M tag is amber only when its feed is late
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
      const q = quoteFor({ symbol }, quotes, intraday.data, daily.data, { dailyLoading: daily.isLoading, unavailable, staleFeeds: stale });
      // A3: the CLOSE tag and the stale mark read the server's words; F1:
      // dated by the card's own tick or bar, never the feed-wide as_of.
      return withFreshTags(
        { ...q, stamp: quoteStamp(q, report) },
        { daily: report.at("market_daily", q.servedAt), intraday: report.at("market_intraday", q.servedAt) },
      );
    });

    const ten = credit.data?.series.find((s) => s.label === "UST10Y");
    if (credit.data && ten) {
      out.push(treasuryCard("US 10Y", "10-year Treasury yield", ten, credit.data, report, "ust10y"));
    } else {
      // CP4: the dash says why when the yield did not load.
      out.push({ symbol: "US 10Y", price: "—", title: credit.isError ? "US 10Y yield unavailable: the data service did not answer." : undefined });
    }

    // fix/freshness 8: the 30Y is the payload's own field. An older API omits it: the card is hidden rather than
    // dashed. Served as null (no eligible DGS30 stored), or while the payload is on its way, it dashes like the 10Y.
    const thirty = credit.data?.ust30y;
    if (credit.data && thirty) {
      out.push(treasuryCard("US 30Y", "30-year Treasury yield", thirty, credit.data, report));
    } else if (!credit.data || thirty === null) {
      out.push({
        symbol: "US 30Y",
        price: "—",
        title: credit.isError
          ? "US 30Y yield unavailable: the data service did not answer."
          : thirty === null
            ? "US 30Y yield unavailable: no eligible FRED DGS30 observation is stored yet."
            : undefined,
      });
    }

    return out;
  }, [quotes, stale, intraday.data, daily.data, daily.isLoading, credit.data, credit.isError, unavailable, report]);

  return (
    <div className="mrr-strip" role="region" aria-label="Market strip">
      {cards.map((c) => (
        <QuoteCard key={c.symbol} {...c} />
      ))}
    </div>
  );
}

export { lastBySymbol };
