/**
 * Markets at a glance (redesign Phase 3, checklist 03 B.5): a Segmented row
 * of asset-class tabs over a four-tile grid, plus the What's priced teaser as
 * the sixth tab. Tiles are priced through the strip's own ladder
 * (`quoteFor`, shell/quote-ladder.ts) so the strip and the tiles can never
 * disagree on a price; the only client-side work here is formatting.
 *
 * All six panels stay mounted (`hidden` on the inactive ones) so
 * `#whats-priced` resolves at all times; `#whats-priced` in the URL selects
 * that tab on mount and on every hash change. Selecting a tab is local state.
 *
 * The panel owns its data hooks (one `useMarketDaily` request for the 13
 * stored symbols, `usePriced`, the live-quote store); the query keys are
 * shared with every other consumer, so each endpoint is still requested once.
 *
 * Iteration 1 (D2): a tile is the strip's fixed-slot quote tile (QuoteSlots,
 * shell/QuoteCard.tsx) on the stacked glance grid in app.css: symbol and name,
 * price, the day change beside its tag, then the sparkline on its own row
 * across the tile, so it can never run under the price. All five slots render
 * on every tile of every view: no day change prints the marked dash, a
 * live-only symbol prints its note in the spark slot.
 */

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { UseQueryResult } from "@tanstack/react-query";
import { Card, SectionHeader, Segmented, StatTile } from "../../components";
import { useMarketDaily, usePriced } from "../../api/queries";
import type { DailyBar, PricedMetric } from "../../api/types";
import { useQuotes, type LiveQuote } from "../../live/quotes";
import { fmtDate, fmtSigned, fmtSignedPct } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { quoteFor } from "../shell/quote-ladder";
import { QuoteSlots, SPARK_H, SPARK_W, type QuoteCardProps } from "../shell/QuoteCard";
import Jargon from "../shared/Jargon";
import { Caption, metaStyle } from "../shared/screen-ui";
import { GLANCE_DAILY_SYMBOLS, GLANCE_TABS, glanceTabFromHash, type GlanceSymbol, type GlanceTabId } from "./glance-symbols";

export interface MarketsGlanceProps {
  /** Reports the selected tab so the screen can re-run its hash scroll once
   * the `#whats-priced` panel is visible. */
  onTabChange?: (tab: GlanceTabId) => void;
}

/** Newest stored bar with a close for one symbol (rows arrive date-ascending). */
function newestBar(bars: DailyBar[] | undefined, symbol: string): DailyBar | undefined {
  let out: DailyBar | undefined;
  bars?.forEach((b) => {
    if (b.symbol === symbol && b.close != null) out = b;
  });
  return out;
}

/** Decimal places the tile prints: FX pairs 4 (EURUSD) / 3 (USDJPY),
 * everything else 2 (MarketsScreen's convention). */
export function tileDp(def: GlanceSymbol): number {
  if (def.kind !== "fx") return 2;
  return def.symbol === "EURUSD" ? 4 : 3;
}

/**
 * One tile's read: the strip's ladder (`quoteFor`) with the one addition the
 * tiles make: a stored close without a stream day-change takes the newest
 * bar's server-computed `ret_1d` as its 1D change. Live-only symbols never
 * see the stored bars (no CLOSE rung, no sparkline); the NO PRICE tag waits
 * for the daily query like the strip's does, so no absence is asserted early.
 */
export function tileRead(
  def: GlanceSymbol,
  quotes: ReadonlyMap<string, LiveQuote>,
  bars: DailyBar[] | undefined,
  dailyLoading = false,
): QuoteCardProps {
  const q = quoteFor({ symbol: def.symbol, name: def.name, dp: tileDp(def) }, quotes, undefined, def.stored ? bars : undefined, { dailyLoading });
  let change = q.change;
  let changeTone = q.changeTone;
  if (change == null && q.tag?.text === "CLOSE") {
    const bar = newestBar(bars, def.symbol);
    if (bar?.ret_1d != null) {
      change = fmtSignedPct(bar.ret_1d);
      changeTone = bar.ret_1d >= 0 ? "pos" : "neg";
    }
  }
  return { ...q, change, changeTone, series: def.stored ? q.series : undefined };
}

/** The spark slot's words for a symbol the relay serves but the DB never stored. */
const LIVE_ONLY = "live only · no stored history";

function GlanceTile({ def, read }: { def: GlanceSymbol; read: QuoteCardProps }) {
  return (
    <Card variant="tile" className="mrr-glance-tile mrr-qslots" data-symbol={def.symbol} title={read.title} style={{ minWidth: 0 }}>
      <QuoteSlots
        symbol={def.symbol}
        name={def.name}
        price={read.price}
        change={read.change}
        changeTone={read.changeTone}
        tag={read.tag}
        series={def.stored ? read.series : undefined}
        sparkFill
        sparkGradient
        sparkWidth={SPARK_W}
        sparkHeight={SPARK_H}
        sparkNote={def.stored ? undefined : LIVE_ONLY}
      />
    </Card>
  );
}

/** The What's priced teaser (D28, D29): SOFR stands in for policy because
 * Fed funds already sits in the key-levels row. */
function PricedPanel({ priced }: { priced: UseQueryResult<PricedMetric[]> }) {
  const { isMobile } = useBreakpoint();
  const rows = ["SOFR", "T10YIE", "DFII10"]
    .map((m) => priced.data?.find((p) => p.metric === m))
    .filter((p): p is PricedMetric => p != null);
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* Uppercase mono so the label harvester keeps the baseline eyebrow. */}
      <span style={metaStyle}>3-row teaser · full table in Markets</span>
      {rows.length ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: 16 }}>
            {rows.map((p) => (
              <div key={p.metric}>
                <StatTile
                  label={p.label}
                  value={`${p.value.toFixed(2)}${p.unit}`}
                  delta={
                    p.mom_chg != null
                      ? /* change of a percent-level series is pp, not % */
                        `${fmtSigned(p.mom_chg)}${p.unit === "%" ? "pp" : p.unit} MoM`
                      : undefined
                  }
                  direction={p.mom_chg != null ? (p.mom_chg >= 0 ? "up" : "down") : undefined}
                  size="sm"
                />
                <Caption>
                  {p.group.toLowerCase()} · weekly pipeline · {fmtDate(p.date)}
                </Caption>
              </div>
            ))}
          </div>
          <Caption>
            The market&apos;s own pricing: <Jargon term="breakeven">breakevens</Jargon> for expected inflation,{" "}
            <Jargon term="TIPS">TIPS</Jargon> for real yields. All six metrics with the policy rate sit in Markets.
          </Caption>
        </>
      ) : (
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-muted)", lineHeight: 1.6 }}>
          {priced.isError
            ? "Market-implied pricing unavailable: the data service did not answer."
            : priced.isLoading
              ? "Reading market-implied pricing…"
              : "No priced metrics on file; the weekly pipeline has not written them yet."}
        </div>
      )}
      <div>
        <Link to="/app/markets#whats-priced-full" style={{ fontSize: "var(--fs-body-s)", color: "var(--link)" }}>
          → See all in Markets
        </Link>
      </div>
    </div>
  );
}

export default function MarketsGlance({ onTabChange }: MarketsGlanceProps = {}) {
  const location = useLocation();
  const quotes = useQuotes();
  const daily = useMarketDaily(GLANCE_DAILY_SYMBOLS, 45);
  const priced = usePriced();
  const [tab, setTab] = useState<GlanceTabId>(() => glanceTabFromHash(location.hash) ?? "equities");

  // The hash selects the What's priced tab on mount and on every change; a
  // click on another tab is local state and leaves the URL alone.
  useEffect(() => {
    const fromHash = glanceTabFromHash(location.hash);
    if (fromHash) setTab(fromHash);
  }, [location.hash]);

  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);

  return (
    <Card as="section" id="markets-glance" variant="panel" style={{ minWidth: 0 }}>
      <SectionHeader
        layout="panel"
        title="Markets at a glance"
        description={
          <Segmented
            label="Asset class"
            value={tab}
            onChange={(id) => setTab(id as GlanceTabId)}
            options={GLANCE_TABS.map((t) => ({ id: t.id, label: t.label }))}
          />
        }
        actions={
          <Link className="mrr-link" to="/app/markets">
            View markets →
          </Link>
        }
      />
      {/* Every panel stays mounted; the wrapper carries `hidden` (no display
          rule of its own, so the attribute wins) and the grid class sits inside. */}
      {GLANCE_TABS.filter((t) => t.id !== "priced").map((t) => (
        <div key={t.id} id={`glance-${t.id}`} data-glance-tab={t.id} hidden={tab !== t.id}>
          <div className="mrr-dash-glance">
            {t.symbols.map((def) => (
              <GlanceTile key={def.symbol} def={def} read={tileRead(def, quotes, daily.data, daily.isLoading)} />
            ))}
          </div>
        </div>
      ))}
      <div id="whats-priced" data-glance-tab="priced" hidden={tab !== "priced"}>
        <PricedPanel priced={priced} />
      </div>
    </Card>
  );
}
