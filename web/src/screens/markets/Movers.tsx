/**
 * Single-name movers (Iteration 1, M3a): the three biggest gainers and the
 * three biggest losers among the twelve stored single names (`SINGLE_NAMES`),
 * under the sector heatmap. Each tile opens that ticker's single-name
 * research panel (the screen routes it through `?name=`, the watchlist path).
 *
 * The day change, per name, is the first of:
 *   1. the stream's own day change (`dc`) when the relay carries one, stamped
 *      with the quote's as-of (● clock for a live tick, the quote time with
 *      "15m" for a delayed row): the tape's `asOfCell`;
 *   2. the last completed session's close against the one before it, read
 *      from the 5D candles `useSymbolCandles` serves (the watchlist's own
 *      source and reader, `readCandles`), stamped `Close · <Mon DD>`. Bars of
 *      a session still trading are left out, so the figure is always a close.
 * A name with neither is listed plainly as having no day change on file.
 * Candles are requested only for names the stream gives no day change, so a
 * relay that carries `dc` costs no candle requests.
 */

import { useMemo } from "react";
import { Card, SectionHeader } from "../../components";
import { useSymbolCandlesList } from "../../api/queries";
import type { CandleBar } from "../../api/types";
import type { LiveQuote } from "../../live/quotes";
import { fmtSignedPct } from "../../lib/format";
import { monDD } from "../shared/fresh-state";
import { dayKeyEt } from "../shared/calendar-impact";
import { Caption, MISSING, StateNote, eyebrowStyle } from "../shared/screen-ui";
import { readCandles } from "../shell/watchlist/useWatchlistQuote";
import { SINGLE_NAMES, asOfCell, nyseSessionOpen, type TapeDef } from "./tape";

export interface MoverRead {
  def: TapeDef;
  /** Day change in percent, as served (stream) or read from the closes (candles). */
  change: number;
  /** "quote": the stream's own day change; "close": the candle close-to-close. */
  source: "quote" | "close";
  /** "14:28:03 ET", "Sep 18, 16:00 ET · 15m" or "Close · Sep 18". */
  stamp: string;
  /** A live tick inside the live window (the ● mark). */
  live: boolean;
}

export interface MoversRead {
  /** Candle requests still in flight for names the stream gave no change. */
  loading: boolean;
  /** Every name with a day change, biggest gain first. */
  ranked: MoverRead[];
  /** Up to three names up on the day, biggest first. */
  gainers: MoverRead[];
  /** Up to three names down on the day, biggest drop first. */
  losers: MoverRead[];
  /** Names with neither a stream change nor two stored closes. */
  missing: TapeDef[];
  /** A candle request for a missing name failed (CP4: the empty state then
   * says the prices did not load, never that none exist). */
  error?: boolean;
}

const SLOTS = 3;

/** Bars of completed sessions only: while the NYSE session is open, today's
 * (New York) bars are a session still trading and are left out. */
function completedBars(bars: CandleBar[] | undefined, sessionOpen: boolean, now: number): CandleBar[] | undefined {
  if (!bars?.length || !sessionOpen) return bars;
  const today = dayKeyEt(now);
  return bars.filter((b) => dayKeyEt(b.ts) !== today);
}

/**
 * The movers read the screen shares with its summary row. `sessionOpen` is
 * the served `/api/freshness` session flag when present; the tape's own
 * NYSE-hours check stands in without it.
 */
export function useMoversRead(quotes: ReadonlyMap<string, LiveQuote>, sessionOpen: boolean | null | undefined): MoversRead {
  const need = useMemo(() => SINGLE_NAMES.filter((d) => quotes.get(d.symbol)?.dc == null).map((d) => d.symbol), [quotes]);
  const results = useSymbolCandlesList(need, "5D");
  const open = sessionOpen ?? nyseSessionOpen();

  // Twelve names: read on every render (the quote store repaints at most
  // twice a second), so the ranking always matches the tiles.
  const now = Date.now();
  const bySymbol = new Map(need.map((s, i) => [s, results[i]]));
  const reads: MoverRead[] = [];
  const missing: TapeDef[] = [];
  let loading = false;
  let error = false;
  for (const def of SINGLE_NAMES) {
    const q = quotes.get(def.symbol);
    if (q?.dc != null) {
      const asOf = asOfCell(q);
      reads.push({ def, change: q.dc, source: "quote", stamp: asOf.text, live: asOf.live });
      continue;
    }
    const res = bySymbol.get(def.symbol);
    const bars = completedBars(res?.data?.bars, open, now);
    const read = readCandles(bars);
    const last = bars?.length ? bars[bars.length - 1] : undefined;
    if (read.changePct != null && last) {
      reads.push({ def, change: read.changePct, source: "close", stamp: `Close · ${monDD(last.ts) ?? "date unknown"}`, live: false });
    } else if (res?.isPending) {
      loading = true;
    } else {
      if (res?.isError) error = true;
      missing.push(def);
    }
  }
  const ranked = [...reads].sort((a, b) => b.change - a.change);
  return {
    loading,
    ranked,
    gainers: ranked.filter((m) => m.change > 0).slice(0, SLOTS),
    losers: [...ranked].reverse().filter((m) => m.change < 0).slice(0, SLOTS),
    missing,
    error,
  };
}

/** "NVDA +2.31% leads · TSLA -1.84% lags" for the summary row, or null
 * without a gainer and a loser. */
export function moversSummary(read: MoversRead): { lead: MoverRead; lag: MoverRead } | null {
  const lead = read.ranked[0];
  const lag = read.ranked[read.ranked.length - 1];
  if (!lead || !lag || lead === lag) return null;
  return { lead, lag };
}

const dirColor = (v: number) => (v >= 0 ? "var(--pos)" : "var(--neg-text)");

function MoverTile({ m, onOpen }: { m: MoverRead; onOpen: (symbol: string) => void }) {
  return (
    <button
      type="button"
      className="mrr-mover"
      onClick={() => onOpen(m.def.symbol)}
      title={`Open ${m.def.symbol} in single-name research`}
      data-symbol={m.def.symbol}
      data-source={m.source}
    >
      <span className="mrr-mover-head">
        <b>{m.def.symbol}</b> <span className="mrr-mover-name">{m.def.name}</span>
      </span>
      <span className="mrr-mover-chg" style={{ color: dirColor(m.change) }}>
        {fmtSignedPct(m.change)}
      </span>
      <span className="mrr-mover-stamp" style={m.live ? { color: "var(--pos)" } : undefined}>
        {m.live ? "● " : ""}
        {m.stamp}
      </span>
    </button>
  );
}

/** The marked slot a missing mover leaves (G3: never a gap). */
function EmptySlot({ word }: { word: string }) {
  return (
    <div className="mrr-mover" data-empty="true">
      <span className="mrr-mover-head">
        <b>—</b>
      </span>
      <span className="mrr-mover-stamp">{word}</span>
    </div>
  );
}

function Group({ label, items, emptyWord, onOpen }: { label: string; items: MoverRead[]; emptyWord: string; onOpen: (symbol: string) => void }) {
  return (
    <div className="mrr-movers-group" role="group" aria-label={label}>
      <div style={{ ...eyebrowStyle, marginBottom: 8 }}>{label}</div>
      <div className="mrr-movers-tiles">
        {Array.from({ length: SLOTS }, (_, i) =>
          items[i] ? <MoverTile key={items[i].def.symbol} m={items[i]} onOpen={onOpen} /> : <EmptySlot key={`empty-${i}`} word={emptyWord} />,
        )}
      </div>
    </div>
  );
}

export default function Movers({ read, onOpen }: { read: MoversRead; onOpen: (symbol: string) => void }) {
  const hasAny = read.ranked.length > 0;
  let body;
  if (hasAny) {
    body = (
      <div className="mrr-movers">
        <Group label="Top gainers" items={read.gainers} emptyWord="No other name up" onOpen={onOpen} />
        <Group label="Top losers" items={read.losers} emptyWord="No other name down" onOpen={onOpen} />
      </div>
    );
  } else if (read.loading) {
    body = <StateNote loading>Reading the single names' day moves…</StateNote>;
  } else if (read.error) {
    // CP4: neither the stream nor the candles answered.
    body = <StateNote error missing={MISSING.market} />;
  } else {
    body = (
      <StateNote>
        No day change on file for the twelve single names: the stream sent none and the 5-day candles did not load.
      </StateNote>
    );
  }
  return (
    <Card as="section" variant="panel" id="single-name-movers" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Single-name movers"
        description="Day moves of the twelve stored names; each opens its research panel"
        right="stream change, else last close"
      />
      {body}
      {hasAny && read.missing.length ? (
        <Caption>
          No day change on file for {read.missing.map((d) => d.symbol).join(", ")}: the stream sent none and the 5-day candles
          did not give two closes.
        </Caption>
      ) : null}
    </Card>
  );
}
