/**
 * Single-name deep dive: profile, candles, regime context, stored coverage
 * and an optional end-of-day Options lens for any listed symbol.
 *
 * Data honesty (2026-09-06, EODHD only since fix/prelaunch-1): every block
 * names its provider. The quote is the EODHD stream when this symbol is on it
 * and ticking (the panel asks the relay to watch it); otherwise the delayed
 * EODHD REST quote, labeled, with the market timestamp separate from the
 * fetch time; fundamentals come from Finnhub (launch-1). Candles come as a
 * provenance envelope (one provider per series, never a stand-in); a new
 * symbol never paints the previous symbol's history. The regime table is computed here from monthly closes
 * joined to the stored classifier history; it never re-derives anything a
 * table already asserts.
 *
 * 2026-09-15 (redesign Phase 5, checklist 05 B.4): the mockup tile. Identity
 * row, eight `StatTile size="xs"` fundamentals, the candle chart with its
 * 20-day average (display math on served closes; the legend shows only on
 * daily payloads), the regime tiles on the `--r-*` tokens, then the Options
 * lens and a collapsed "News for {SYM}" disclosure. The chart range is
 * controlled by the panel header when `range` and `onRangeChange` are both
 * given; without them the tile keeps its own state and picker.
 *
 * Iteration 1 (M5): no blank block. A symbol EODHD does not list reads
 * one plain sentence in place of the tile; otherwise every block that has
 * nothing for this ticker says what is missing in one sentence (fundamentals
 * that did not load, a regime history that did not load, options not served
 * for the instrument or no listed expirations, stored news that did not
 * load) while the other blocks render.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Card, Segmented, StatTile } from "../../components";
import {
  useFreshness,
  useNews,
  useOptionsChain,
  useOptionsExpirations,
  useRegimeHistory,
  useSymbolCandles,
  useSymbolProfile,
  useTickerNews,
} from "../../api/queries";
import { ApiError } from "../../api/client";
import { LIVE_WINDOW_MS, useQuotes, useWatch } from "../../live/quotes";
import type { CandleRange, NewsItem, OptionContract } from "../../api/types";
import { fmtDate, fmtProb, fmtSignedPct, fmtUtcStampEt } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import { Caption, eyebrowStyle, metaStyle, mono, monoNoteStyle, useSnapshotMode } from "../shared/screen-ui";
import { candleCaption, describeProviderError, fallbackNote, fmtProviderStamp, providerName } from "../shared/provider-ui";

const CandleChart = lazy(() => import("./CandleChart"));

export const RANGES: CandleRange[] = ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"];
const RANGE_OPTIONS = RANGES.map((r) => ({ id: r, label: r }));

/** Window of the simple moving average drawn over daily candles; the legend
 * names it, so the two must move together. */
const AVERAGE_DAYS = 20;

const REGIME_ORDER = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
/** The regime hue tokens (tokens/colors.css) with the rgb of each token hex
 * for the tile tints, as the Phase 4 screens paint them; no old-palette hex. */
const REGIME_HUE: Record<string, { token: string; rgb: string }> = {
  Goldilocks: { token: "var(--r-goldilocks)", rgb: "38,220,160" },
  Overheating: { token: "var(--r-overheating)", rgb: "230,126,34" },
  Stagflation: { token: "var(--r-stagflation)", rgb: "231,76,60" },
  "Recession Risk": { token: "var(--r-recession)", rgb: "149,165,166" },
};

/** $5.08T / $312.4B / $87.1M: market-cap style compaction. */
function compactUsd(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function compactNum(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return Math.round(v).toLocaleString("en-US");
}

/** First useful token of a company name, for the headline-match fallback. */
function nameToken(name: string | undefined): string | null {
  if (!name) return null;
  const first = name.split(/[\s,]+/)[0]?.replace(/[.,]/g, "");
  return first && first.length >= 3 ? first : null;
}

const n2 = (v: number | null | undefined, dp = 2): string => (v == null ? "—" : v.toFixed(dp));

const uiText: React.CSSProperties = { fontFamily: "var(--font-ui)" };

/** A provider error that means "nothing is listed under this symbol". */
export function isUnknownSymbol(err: unknown): boolean {
  return err instanceof ApiError && err.kind === "unknown_symbol";
}

interface Props {
  symbol: string;
  onClose: () => void;
  /** Controlled range (redesign Phase 5, checklist 05 B.4): when both props are
   * given the panel header owns the picker and this tile renders none. */
  range?: CandleRange;
  onRangeChange?: (range: CandleRange) => void;
}

/** What the fundamentals row's caption says, by what the API knows (launch-1,
 * loop 1): a source named when it answered, a plain reason when nothing
 * applies, and a temporary one when the source did not answer this time. */
export function fundamentalsCaption(p: { fundamentals_provider: string | null; fundamentals_status?: string | null }): string {
  if (p.fundamentals_provider) {
    return `Fundamentals via ${providerName(p.fundamentals_provider as never)}, refreshed twice a day; a dash is a field it does not publish for this security.`;
  }
  if (p.fundamentals_status === "unavailable") {
    return "Fundamentals are temporarily unavailable: the source did not answer just now. The price and chart are unaffected, and they come back on their own.";
  }
  if (p.fundamentals_status === "other_listing") {
    return "Fundamentals are not available for this listing: the source reports this company on another listing or in another currency, so its figures would not match this price.";
  }
  if (p.fundamentals_status === "not_configured") {
    return "Fundamentals are not set up on this server, so this panel shows the price and chart only.";
  }
  return "Fundamentals are not available for this instrument: the data covers US-listed companies, so funds, indices, currencies and crypto show price and history only.";
}

export default function SingleName({ symbol, onClose, range: rangeProp, onRangeChange }: Props) {
  const { isNarrow } = useBreakpoint();
  const snapshot = useSnapshotMode();
  const [ownRange, setOwnRange] = useState<CandleRange>("6M");
  // Controlled only when both props arrive; otherwise the tile keeps today's
  // state and picker, so the existing tests render unchanged.
  const controlled = rangeProp != null && onRangeChange != null;
  const range: CandleRange = controlled ? rangeProp : ownRange;
  const setRange = (r: CandleRange) => {
    if (!controlled) setOwnRange(r);
    onRangeChange?.(r);
  };
  const profile = useSymbolProfile(symbol);
  const candles = useSymbolCandles(symbol, range);
  const monthly = useSymbolCandles(symbol, "MAX");
  const regimes = useRegimeHistory(400);
  const tickerNews = useTickerNews(symbol);
  const generalNews = useNews(168, undefined, 150);
  const freshness = useFreshness();
  const quotes = useQuotes();
  const panelRef = useRef<HTMLDivElement>(null);

  // Ask the relay to stream this symbol while the panel is open (bounded
  // server-side; fixed-universe symbols cost nothing).
  useWatch(symbol);

  const p = profile.data;

  // Live-vs-delayed: the stream owns the quote only while actually ticking.
  const live = quotes.get(symbol) ?? quotes.get(symbol.replace(".", "-"));
  const liveFresh = live?.t != null && Date.now() - live.t < LIVE_WINDOW_MS && !live.delayed;
  const shownPrice = liveFresh && live ? live.p : p?.last;
  const shownChgPct = liveFresh && live ? live.dc : p?.day_change_pct;
  const session = freshness.data?.session ?? null;
  // The average is a 20-DAY average only over daily bars; the legend and the
  // line hide together on intraday, weekly and monthly payloads.
  const dailyBars = candles.data?.interval === "1d";

  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest" });
    panelRef.current?.focus({ preventScroll: true });
  }, [symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An Escape something else consumed (an overlay closing, the search box
      // clearing) is not a request to close this panel.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Regime context: monthly returns from MAX candles joined to classifier months.
  const regimeStats = useMemo(() => {
    const bars = monthly.data?.bars;
    const hist = regimes.data;
    if (!bars?.length || !hist?.length) return null;
    const labelByMonth = new Map<string, string>();
    hist.forEach((r) => labelByMonth.set(r.date.slice(0, 7), r.label));
    const acc = new Map<string, { sum: number; up: number; n: number }>();
    let joined = 0;
    let firstMonth: string | null = null;
    for (let i = 1; i < bars.length; i += 1) {
      const prev = bars[i - 1].close;
      const cur = bars[i].close;
      if (!prev || !cur) continue;
      const month = bars[i].ts.slice(0, 7);
      const label = labelByMonth.get(month);
      if (!label) continue;
      const ret = cur / prev - 1;
      const cell = acc.get(label) ?? { sum: 0, up: 0, n: 0 };
      cell.sum += ret;
      cell.up += ret > 0 ? 1 : 0;
      cell.n += 1;
      acc.set(label, cell);
      joined += 1;
      if (!firstMonth) firstMonth = month;
    }
    if (joined < 12) return null;
    return { acc, joined, firstMonth };
  }, [monthly.data, regimes.data]);

  // Coverage: tagged rows first, then an honest headline match on the name.
  const coverage = useMemo<{ rows: NewsItem[]; matched: boolean }>(() => {
    const dedupe = (rows: NewsItem[]): NewsItem[] => {
      const seen = new Set<string>();
      return rows.filter((n) => {
        const key = (n.headline ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const tagged = dedupe(tickerNews.data ?? []);
    if (tagged.length) return { rows: tagged.slice(0, 6), matched: false };
    const token = nameToken(p?.name);
    if (!token || !generalNews.data) return { rows: [], matched: false };
    const needle = token.toLowerCase();
    const rows = dedupe(
      generalNews.data.filter(
        (n) =>
          n.headline?.toLowerCase().includes(needle) ||
          n.summary?.toLowerCase().includes(needle),
      ),
    ).slice(0, 6);
    return { rows, matched: true };
  }, [tickerNews.data, generalNews.data, p?.name]);

  // The news hooks fetch on mount, so the disclosure's meta counts the rows
  // before anyone opens it and no request waits on a click.
  const newsLoading = tickerNews.isLoading || generalNews.isLoading;
  // The tagged read failed and the name match has nothing to stand in with:
  // say the news did not load, never "no coverage" (M5).
  const newsFailed = !coverage.rows.length && !newsLoading && tickerNews.isError;
  const coverageMeta = coverage.rows.length
    ? `${coverage.rows.length} stored · 7-day window${coverage.matched ? " · headline match" : ""}`
    : newsLoading
      ? "reading…"
      : newsFailed
        ? "unavailable"
        : "none in 7 days";

  // ── quote provenance line ────────────────────────────────────────────
  const quoteLine = liveFresh
    ? `live · EODHD stream · ${live?.t ? fmtUtcStampEt(new Date(live.t).toISOString()) : ""}`
    : p
      ? [
          `${providerName(p.quote_provider)} · delayed`,
          p.market_ts ? `as of ${fmtUtcStampEt(p.market_ts)}` : `fetched ${fmtUtcStampEt(p.fetched_at)}`,
          session && !session.is_open ? `session ${session.phase === "open" ? "open" : "closed"} · last close stands` : null,
          p.fallback_used ? fallbackNote(p.fallback_reason) : null,
        ]
          .filter(Boolean)
          .join(" · ")
      : profile.isError
        ? describeProviderError(profile.error, "the quote", symbol, snapshot)
        : "reading the quote…";

  const identityLine = p
    ? [p.name, p.exchange, p.quote_type, p.sector, p.industry].filter(Boolean).join(" · ")
    : profile.isPending
      ? "Loading profile…"
      : "";

  const isUsEquity = p ? p.exchange === "US" && !/^(FX|Crypto|Index)$/i.test(p.quote_type ?? "") : false;

  // Nothing is listed under this symbol at either provider: one plain
  // sentence instead of a tile of empty blocks (M5).
  if (!p && isUnknownSymbol(profile.error)) {
    return (
      <div ref={panelRef} tabIndex={-1}>
        <Card variant="tile" style={{ padding: "16px 18px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
            <span style={{ ...uiText, fontWeight: 500, fontSize: 20, color: "var(--text)" }}>{symbol}</span>
            <p role="status" style={{ ...uiText, margin: 0, flex: "1 1 240px", minWidth: 0, fontSize: "var(--fs-body-s)", color: "var(--text)" }}>
              No listed symbol matches {symbol}.
            </p>
            <button
              type="button"
              onClick={onClose}
              title="Close · Esc"
              aria-label="Close single-name panel"
              className="mrr-btn"
              data-touch={isNarrow ? "true" : "false"}
              style={{ marginLeft: "auto" }}
            >
              × close
            </button>
          </div>
          <Caption>
            {describeProviderError(profile.error, "the quote", symbol, snapshot)} Search by company name, or check the spelling of a share
            class (BRK.B).
          </Caption>
        </Card>
      </div>
    );
  }

  return (
    // Focus lands here when a symbol opens (the search's Enter or a watchlist
    // click). The base :focus-visible ring stays; nothing removes the outline.
    <div ref={panelRef} tabIndex={-1}>
      <Card variant="tile" style={{ padding: "16px 18px 10px" }}>
        {/* ── identity row: symbol, name and meta, price, legend, provenance, close ── */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
          <span style={{ ...uiText, fontWeight: 500, fontSize: 20, color: "var(--text)" }}>{symbol}</span>
          <span style={{ ...uiText, fontSize: 13, color: "var(--text-2)", minWidth: 0 }}>{identityLine}</span>
          <span style={{ ...uiText, fontWeight: 500, fontSize: 24, fontVariantNumeric: "tabular-nums", color: "var(--text)", marginLeft: 4 }}>
            {shownPrice != null
              ? `$${shownPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : profile.isError
                ? "—"
                : "…"}
          </span>
          {shownChgPct != null && (
            <span style={{ ...uiText, fontSize: 15, fontVariantNumeric: "tabular-nums", color: shownChgPct >= 0 ? "var(--pos)" : "var(--neg)" }}>
              {fmtSignedPct(shownChgPct)}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, flexWrap: "wrap", minWidth: 0 }}>
            {dailyBars ? (
              <span style={{ ...uiText, fontSize: "var(--fs-caption)", color: "var(--text-3)", whiteSpace: "nowrap" }}>
                <i aria-hidden="true" style={{ display: "inline-block", width: 14, height: 2, background: "var(--link)", verticalAlign: 3, marginRight: 6 }} />
                {AVERAGE_DAYS}-day average
              </span>
            ) : null}
            {/* A1: with a quote on hand this line is the tile's stamp: the
                provider and the quote's own as-of, as the provider layer
                serves them. */}
            <div
              role="status"
              data-stamp={liveFresh || p ? "" : undefined}
              style={{ ...monoNoteStyle, color: liveFresh ? "var(--pos)" : monoNoteStyle.color, maxWidth: 420 }}
            >
              {quoteLine}
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close · Esc"
              aria-label="Close single-name panel"
              className="mrr-btn"
              data-touch={isNarrow ? "true" : "false"}
            >
              × close
            </button>
          </div>
        </div>

        {/* ── fundamentals row ──────────────────────────────────────────── */}
        {p && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 14, margin: "12px 0 10px" }}>
              <StatTile label="Market cap" value={compactUsd(p.market_cap)} size="xs" />
              <StatTile label="P/E · TTM" value={n2(p.trailing_pe, 1)} size="xs" />
              <StatTile label="Fwd P/E" value={n2(p.forward_pe, 1)} size="xs" />
              <StatTile label="Beta" value={n2(p.beta)} size="xs" />
              <StatTile label="Div yield" value={p.dividend_yield != null ? `${p.dividend_yield.toFixed(2)}%` : "—"} size="xs" />
              <StatTile
                label="52W range"
                value={p.year_low != null && p.year_high != null ? `${p.year_low.toFixed(0)}–${p.year_high.toFixed(0)}` : "—"}
                size="xs"
              />
              <StatTile label="Avg vol · 3M" value={compactNum(p.avg_volume_3m)} size="xs" />
              <StatTile label="Net margin" value={p.profit_margin != null ? `${(p.profit_margin * 100).toFixed(1)}%` : "—"} size="xs" />
              <StatTile label="EPS · TTM" value={n2(p.eps_ttm)} size="xs" />
              <StatTile label="P/B" value={n2(p.price_to_book, 1)} size="xs" />
              <StatTile label="Revenue growth" value={p.revenue_growth != null ? `${(p.revenue_growth * 100).toFixed(1)}%` : "—"} size="xs" />
              <StatTile label="52W change" value={p.fifty_two_wk_change != null ? `${p.fifty_two_wk_change.toFixed(1)}%` : "—"} size="xs" />
            </div>
            <Caption mono>
              {fundamentalsCaption(p)}
            </Caption>
          </>
        )}
        {!p && profile.isError ? (
          <div role="status" style={{ ...uiText, margin: "12px 0 4px", fontSize: "var(--fs-caption)", color: "var(--warn-hot)", lineHeight: 1.55 }}>
            No fundamentals for {symbol}: the profile did not load, and the quote line above says why.
          </div>
        ) : null}

        {/* ── range picker (only while the tile owns the range) + chart ─── */}
        {!controlled ? (
          <div style={{ margin: "12px 0 8px" }}>
            <Segmented mono label="Chart range" options={RANGE_OPTIONS} value={range} onChange={(id) => setRange(id as CandleRange)} />
          </div>
        ) : null}
        {candles.data?.bars.length ? (
          <div style={{ position: "relative", marginTop: controlled ? 12 : 0 }}>
            <Suspense
              fallback={
                <div style={{ height: 320, display: "grid", placeItems: "center", ...uiText, fontSize: "var(--fs-caption)", color: "var(--text-3)" }}>
                  Loading the chart module…
                </div>
              }
            >
              <CandleChart bars={candles.data.bars} range={candles.data.range} interval={candles.data.interval} average={AVERAGE_DAYS} />
            </Suspense>
            {candles.isFetching && candles.data.range !== range ? (
              <div role="status" style={{ position: "absolute", top: 8, left: 8, ...metaStyle, background: "var(--tile)", padding: "2px 6px", borderRadius: "var(--r-badge)" }}>
                Requesting {range} bars…
              </div>
            ) : null}
          </div>
        ) : (
          <div
            role="status"
            style={{ height: 120, marginTop: controlled ? 12 : 0, display: "grid", placeItems: "center", ...uiText, fontSize: "var(--fs-caption)", color: candles.isError ? "var(--warn-hot)" : "var(--text-3)", textAlign: "center", padding: "0 12px" }}
          >
            {candles.isError
              ? describeProviderError(candles.error, "history", symbol, snapshot)
              : candles.isPending
                ? `Requesting ${range} history for ${symbol} from EODHD…`
                : `No bars in the ${range} range for ${symbol}.`}
          </div>
        )}
        <Caption mono>
          {candles.data
            ? candleCaption(candles.data)
            : "History comes from EODHD. When EODHD cannot answer, the chart says so rather than quietly filling in from somewhere else."}{" "}
          The tape above owns the live quote; this chart owns the history.
        </Caption>

        {/* ── regime fit ───────────────────────────────────────────────── */}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span style={{ ...eyebrowStyle, whiteSpace: "nowrap" }}>Average monthly return by regime</span>
          {regimeStats ? (
            <div style={{ display: "flex", gap: 8, flex: 1, flexWrap: "wrap", minWidth: 0 }}>
              {REGIME_ORDER.map((label) => {
                const cell = regimeStats.acc.get(label);
                const hue = REGIME_HUE[label];
                const avg = cell ? (cell.sum / cell.n) * 100 : null;
                return (
                  <div
                    key={label}
                    style={{
                      flex: "1 1 120px",
                      minWidth: 0,
                      padding: "8px 12px",
                      borderRadius: 8,
                      border: `1px solid rgba(${hue.rgb},.33)`,
                      background: `rgba(${hue.rgb},.08)`,
                    }}
                  >
                    <div style={{ ...uiText, fontSize: 11.5, color: hue.token }}>{label}</div>
                    <div style={{ ...uiText, fontWeight: 500, fontSize: 15, fontVariantNumeric: "tabular-nums", marginTop: 1, color: avg == null ? "var(--text-3)" : avg >= 0 ? "var(--pos)" : "var(--neg)" }}>
                      {avg != null ? `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%` : "—"}
                    </div>
                    <div style={{ ...monoNoteStyle, fontSize: 11, lineHeight: 1.4, marginTop: 2 }}>
                      {cell ? `${fmtProb(cell.up / cell.n)} up · n=${cell.n}` : "no overlap"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {regimeStats ? (
          <Caption>
            Average monthly return for {symbol} inside each classifier regime since {regimeStats.firstMonth} (
            {regimeStats.joined} overlapping months; monthly closes via {providerName(monthly.data?.provider)}); up% is the
            share of positive months. Small n cells are anecdotes, not laws.
          </Caption>
        ) : (
          <Caption>
            {monthly.isPending || regimes.isLoading
              ? "Joining monthly closes with the stored regime history…"
              : monthly.isError
                ? describeProviderError(monthly.error, "monthly history", symbol, snapshot)
                : regimes.isError
                  ? `The stored regime history did not load, so there is no regime read for ${symbol}.`
                  : "Fewer than 12 months overlap the stored regime history; no regime read for this name."}
          </Caption>
        )}

        {/* ── options lens (US equities and ETFs; end-of-day) ─────────── */}
        {isUsEquity || (!p && profile.isError) ? (
          <OptionsLens symbol={symbol} />
        ) : p ? (
          <div style={{ marginTop: 12 }}>
            <Caption>
              No options lens for {symbol}: listed option chains are served for US equities and ETFs only.
            </Caption>
          </div>
        ) : null}

        {/* ── stored coverage, collapsed ───────────────────────────────── */}
        <div style={{ marginTop: 10 }}>
          <Disclosure
            title={`News for ${symbol}`}
            description="Tagged headlines first, then a headline match on the company name"
            right={coverageMeta}
            id="single-name-news"
          >
            {coverage.rows.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {coverage.rows.map((n) => (
                  <div key={n.id} style={{ borderBottom: "0.5px solid var(--line-hair)", paddingBottom: 8 }}>
                    <a href={n.url ?? undefined} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text)", fontWeight: 500 }}>
                      {n.headline}
                    </a>
                    <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                      {[n.source, n.published_at ? fmtDate(n.published_at) : null].filter(Boolean).join(" · ")}
                      {n.overall_significance != null ? ` · sig ${n.overall_significance.toFixed(1)} / 5` : ""}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Caption>
                {newsLoading
                  ? "Reading the stored news window…"
                  : newsFailed
                    ? `Stored news for ${symbol} did not load; the data service did not answer, so nothing here means no coverage.`
                    : `No stored coverage mentions ${symbol} in the last 7 days; the feed keeps a rolling window and ages out by design.`}
              </Caption>
            )}
            {coverage.matched && coverage.rows.length > 0 && (
              <Caption>
                No rows are tagged {symbol}; these headlines mention "{nameToken(p?.name) ?? symbol}" by name instead.
              </Caption>
            )}
          </Disclosure>
        </div>
      </Card>
    </div>
  );
}

/* ── Options lens ───────────────────────────────────────────────────────── */

const PAGE = 40;
const COLS: { key: keyof OptionContract; label: string; dp?: number; width?: number }[] = [
  { key: "strike", label: "Strike", dp: 2, width: 78 },
  { key: "bid", label: "Bid", dp: 2 },
  { key: "ask", label: "Ask", dp: 2 },
  { key: "last", label: "Last", dp: 2 },
  { key: "volume", label: "Vol", dp: 0 },
  { key: "open_interest", label: "OI", dp: 0 },
  { key: "implied_vol", label: "IV", dp: 3 },
  { key: "delta", label: "Δ", dp: 3 },
  { key: "gamma", label: "Γ", dp: 4 },
  { key: "theta", label: "Θ", dp: 3 },
  { key: "vega", label: "V", dp: 3 },
  { key: "moneyness", label: "Moneyness", dp: 3 },
  { key: "dte", label: "DTE", dp: 0 },
];

const SIDE_OPTIONS = [
  { id: "call", label: "Calls" },
  { id: "put", label: "Puts" },
];

export function OptionsLens({ symbol }: { symbol: string }) {
  const { isNarrow } = useBreakpoint();
  const snapshot = useSnapshotMode();
  const [open, setOpen] = useState(false);
  const [exp, setExp] = useState<string | null>(null);
  const [side, setSide] = useState<"call" | "put">("call");
  const [page, setPage] = useState(0);
  const exps = useOptionsExpirations(symbol, open);
  const list = exps.data?.expirations ?? [];
  useEffect(() => {
    if (list.length && (!exp || !list.includes(exp))) setExp(list[0]);
  }, [list, exp]);
  useEffect(() => setPage(0), [exp, side, symbol]);
  const chain = useOptionsChain(symbol, { expiration: exp, type: side, page, limit: PAGE }, open && !!exp);

  const unentitled = exps.error instanceof ApiError && exps.error.kind === "unauthorized";
  // One stamp for the whole lens: the chain's own when loaded, else the
  // expirations scan's (review P2-6).
  const asOf = fmtProviderStamp(chain.data?.as_of ?? exps.data?.as_of);
  const status = exps.data
    ? `end-of-day · ${providerName(exps.data.provider)} · as of ${asOf}`
    : unentitled
      ? "unavailable on this server"
      : open && exps.isPending
        ? "checking entitlement…"
        : "end-of-day · EODHD · opens on demand";

  return (
    <div style={{ marginTop: 12 }}>
      {/* Nothing is requested until the first expand (the entitlement probe
          included); the flag never resets, so a re-collapse keeps the chain. */}
      <Disclosure
        title="Options lens"
        description="Chain by expiration · bid, ask, IV, Greeks"
        right={status}
        id="options-lens"
        onToggle={(next) => next && setOpen(true)}
      >
        {exps.isPending ? (
          <Caption>Requesting listed expirations for {symbol} from EODHD…</Caption>
        ) : exps.data && list.length === 0 ? (
          <Caption>No listed option expirations on file for {symbol}; the chain is empty rather than filled in.</Caption>
        ) : exps.isError ? (
          <div role="status" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn-hot)", lineHeight: 1.55 }}>
            {unentitled
              ? "Options data is not included in the EODHD plan configured on this server; no chain is shown rather than a fabricated one. The provider status page records the check."
              : describeProviderError(exps.error, "options data", symbol, snapshot)}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
              <label style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                Expiration
                <select
                  value={exp ?? ""}
                  onChange={(e) => setExp(e.target.value)}
                  aria-label="Expiration"
                  className="mrr-select"
                  style={{ minHeight: isNarrow ? 44 : 28, background: "var(--void)", color: "var(--text)", border: "0.5px solid var(--line)", borderRadius: "var(--r-xs)", ...mono, fontSize: "var(--fs-meta)", padding: "2px 6px" }}
                >
                  {list.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
              <Segmented label="Contract type" options={SIDE_OPTIONS} value={side} onChange={(id) => setSide(id as "call" | "put")} />
              {exps.data?.truncated ? <span style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>first 1,000 contracts scanned for expirations</span> : null}
            </div>
            {chain.isPending ? (
              <Caption>Requesting {side}s for {exp} from EODHD…</Caption>
            ) : chain.isError ? (
              <div role="status" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn-hot)" }}>
                {describeProviderError(chain.error, "the option chain", symbol, snapshot)}
              </div>
            ) : chain.data && chain.data.contracts.length === 0 ? (
              <Caption>No {side} contracts on file for {symbol} expiring {exp}.</Caption>
            ) : chain.data ? (
              <>
                <div
                  style={{ overflowX: "auto", overflowY: "auto", maxHeight: 360, border: "0.5px solid var(--line-hair)", borderRadius: "var(--r-xs)", WebkitOverflowScrolling: "touch" }}
                  tabIndex={0}
                  role="region"
                  aria-label={`Options chain, scrollable: ${symbol} ${side} contracts expiring ${exp}`}
                >
                  <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 760, ...mono, fontSize: "var(--fs-meta)" }}>
                    <caption className="sr-only">
                      {symbol} {side} contracts expiring {exp}, end-of-day marks from {providerName(chain.data.provider)}
                    </caption>
                    <thead>
                      <tr>
                        {COLS.map((c) => (
                          <th key={c.key} scope="col" style={{ position: "sticky", top: 0, background: "var(--surface)", textAlign: "right", padding: "6px 8px", borderBottom: "0.5px solid var(--line)", color: "var(--text-muted)", fontWeight: 500, whiteSpace: "nowrap", minWidth: c.width }}>
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {chain.data.contracts.map((c, i) => (
                        <tr key={c.contract ?? i} style={{ background: i % 2 ? "rgba(255,255,255,.015)" : undefined }}>
                          {COLS.map((col) => {
                            const v = c[col.key];
                            return (
                              <td key={col.key} style={{ textAlign: "right", padding: "4px 8px", borderBottom: "0.5px solid var(--line-hair)", color: col.key === "strike" ? "var(--text)" : "var(--text-2)", whiteSpace: "nowrap" }}>
                                {typeof v === "number" ? v.toFixed(col.dp ?? 2) : v == null ? "—" : String(v)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
                  <span style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>
                    {isNarrow ? "Swipe sideways for more columns · " : ""}
                    page {page + 1} · {chain.data.count} contracts{chain.data.total != null ? ` of ${chain.data.total}` : ""}
                  </span>
                  <span style={{ display: "inline-flex", gap: 6 }}>
                    <button type="button" className="mrr-chip-btn" data-touch={isNarrow ? "true" : "false"} disabled={page === 0} onClick={() => setPage((n) => Math.max(0, n - 1))}>
                      ◂ Prev
                    </button>
                    <button type="button" className="mrr-chip-btn" data-touch={isNarrow ? "true" : "false"} disabled={!chain.data.has_more} onClick={() => setPage((n) => n + 1)}>
                      Next ▸
                    </button>
                  </span>
                </div>
                <Caption>
                  End-of-day marks from {providerName(chain.data.provider)} as of {asOf}; Greeks and implied
                  volatility are the provider&apos;s own, nothing is computed here, and nothing here is a trading recommendation.
                </Caption>
              </>
            ) : null}
          </>
        )}
      </Disclosure>
    </div>
  );
}
