/**
 * Single-name deep dive — profile, candles, regime context, stored coverage
 * and an optional end-of-day Options lens for any listed symbol.
 *
 * Data honesty (2026-09-06): every block names its provider. The quote is
 * the EODHD stream when this symbol is on it and ticking (the panel asks the
 * relay to watch it); otherwise the delayed EODHD REST quote, or yfinance
 * standing in — each labeled, with the market timestamp separate from the
 * fetch time. Candles come as a provenance envelope (one provider per
 * series, fallback disclosed); a new symbol never paints the previous
 * symbol's history. The regime table is computed here from monthly closes
 * joined to the stored classifier history; it never re-derives anything a
 * table already asserts.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Card, StatTile } from "../../components";
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
import { fmtDate, fmtSignedPct, fmtUtcStampEt } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Disclosure from "../shared/Disclosure";
import { Caption, mono } from "../shared/screen-ui";
import { candleCaption, describeProviderError, fallbackNote, fmtProviderStamp, providerName } from "../shared/provider-ui";

const CandleChart = lazy(() => import("./CandleChart"));

const RANGES: CandleRange[] = ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"];

const REGIME_ORDER = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
const REGIME_COLORS: Record<string, string> = {
  Goldilocks: "#2ecc71",
  Overheating: "#e67e22",
  Stagflation: "#e74c3c",
  "Recession Risk": "#95a5a6",
};

/** $5.08T / $312.4B / $87.1M — market-cap style compaction. */
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

interface Props {
  symbol: string;
  onClose: () => void;
}

export default function SingleName({ symbol, onClose }: Props) {
  const { isNarrow } = useBreakpoint();
  const [range, setRange] = useState<CandleRange>("6M");
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

  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: "nearest" });
    panelRef.current?.focus({ preventScroll: true });
  }, [symbol]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
        ? describeProviderError(profile.error, "the quote", symbol)
        : "reading the quote…";

  const isUsEquity = p ? p.exchange === "US" && !/^(FX|Crypto|Index)$/i.test(p.quote_type ?? "") : false;

  return (
    <div ref={panelRef} tabIndex={-1} style={{ outline: "none", marginTop: 12 }}>
      <Card style={{ padding: 16 }}>
        {/* ── header: identity + price ─────────────────────────────────── */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <span style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 700, color: "var(--text)" }}>
                {symbol}
              </span>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                {p?.name ?? (profile.isPending ? "Loading profile…" : "")}
              </span>
            </div>
            <div style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", marginTop: 3 }}>
              {[p?.exchange, p?.quote_type, p?.sector, p?.industry].filter(Boolean).join(" · ") || " "}
            </div>
          </div>
          <div style={{ textAlign: "right", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, justifyContent: "flex-end" }}>
              <span style={{ ...mono, fontSize: 26, fontWeight: 600, letterSpacing: "var(--ls-numeric)", color: "var(--text)" }}>
                {shownPrice != null
                  ? `$${shownPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                  : profile.isError
                    ? "—"
                    : "…"}
              </span>
              {shownChgPct != null && (
                <span style={{ ...mono, fontSize: "var(--fs-body)", fontWeight: 700, color: shownChgPct >= 0 ? "var(--pos)" : "var(--neg-text)" }}>
                  {fmtSignedPct(shownChgPct)}
                </span>
              )}
            </div>
            <div role="status" style={{ ...mono, fontSize: "var(--fs-meta)", color: liveFresh ? "var(--pos)" : "var(--text-muted)", marginTop: 2, maxWidth: 420 }}>
              {quoteLine}
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close · Esc"
            aria-label="Close single-name panel"
            className="mrr-chip-btn"
            data-touch={isNarrow ? "true" : "false"}
            style={{ color: "var(--text-muted)" }}
          >
            × close
          </button>
        </div>

        {/* ── range chips + chart ──────────────────────────────────────── */}
        <div role="group" aria-label="Chart range" style={{ display: "flex", gap: 6, margin: "14px 0 8px", flexWrap: "wrap" }}>
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              aria-pressed={range === r}
              className="mrr-chip-btn"
              data-touch={isNarrow ? "true" : "false"}
              style={{
                background: range === r ? "rgba(74,158,255,.10)" : undefined,
                borderColor: range === r ? "rgba(74,158,255,.4)" : undefined,
                color: range === r ? "var(--accent)" : "var(--text-muted)",
                minWidth: 40,
                justifyContent: "center",
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {candles.data?.bars.length ? (
          <div style={{ position: "relative" }}>
            <Suspense
              fallback={
                <div style={{ height: 320, display: "grid", placeItems: "center", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
                  Loading the chart module…
                </div>
              }
            >
              <CandleChart bars={candles.data.bars} range={candles.data.range} interval={candles.data.interval} />
            </Suspense>
            {candles.isFetching && candles.data.range !== range ? (
              <div role="status" style={{ position: "absolute", top: 8, left: 8, ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", background: "var(--surface)", padding: "2px 6px", borderRadius: "var(--r-xs)" }}>
                Requesting {range} bars…
              </div>
            ) : null}
          </div>
        ) : (
          <div
            role="status"
            style={{ height: 120, display: "grid", placeItems: "center", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: candles.isError ? "var(--warn-hot)" : "var(--text-muted)", textAlign: "center", padding: "0 12px" }}
          >
            {candles.isError
              ? describeProviderError(candles.error, "history", symbol)
              : candles.isPending
                ? `Requesting ${range} history for ${symbol} from EODHD…`
                : `No bars in the ${range} range for ${symbol}.`}
          </div>
        )}
        <Caption>
          {candles.data
            ? candleCaption(candles.data)
            : "History comes from EODHD first; yfinance stands in only when EODHD cannot answer, and the caption says so."}{" "}
          The tape above owns the live quote; this chart owns the history.
        </Caption>

        {/* ── key stats ────────────────────────────────────────────────── */}
        {p && (
          <div style={{ marginTop: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit,minmax(128px,1fr))",
                gap: 14,
              }}
            >
              <StatTile label="Market cap" value={compactUsd(p.market_cap)} size="sm" />
              <StatTile label="P/E · TTM" value={n2(p.trailing_pe, 1)} size="sm" />
              <StatTile label="Fwd P/E" value={n2(p.forward_pe, 1)} size="sm" />
              <StatTile label="Beta" value={n2(p.beta)} size="sm" />
              <StatTile label="Div yield" value={p.dividend_yield != null ? `${p.dividend_yield.toFixed(2)}%` : "—"} size="sm" />
              <StatTile
                label="52W range"
                value={p.year_low != null && p.year_high != null ? `${p.year_low.toFixed(0)}–${p.year_high.toFixed(0)}` : "—"}
                size="sm"
              />
              <StatTile label="Avg vol · 3M" value={compactNum(p.avg_volume_3m)} size="sm" />
              <StatTile label="Net margin" value={p.profit_margin != null ? `${(p.profit_margin * 100).toFixed(1)}%` : "—"} size="sm" />
            </div>
            <Caption>
              {p.fundamentals_provider
                ? `Fundamentals via ${providerName(p.fundamentals_provider)}${p.fundamentals_provider === "yfinance" ? " (EODHD fundamentals are not in the plan on this server)" : ""}, refreshed every few minutes; a dash is a field the source does not publish for this security.`
                : "Fundamentals unavailable for this instrument from either provider."}
            </Caption>
          </div>
        )}

        {/* ── options lens (US equities and ETFs; end-of-day) ─────────── */}
        {isUsEquity ? <OptionsLens symbol={symbol} /> : null}

        {/* ── regime context ───────────────────────────────────────────── */}
        <div style={{ marginTop: 14 }}>
          <div style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-wide)", color: "var(--text-label)", marginBottom: 6 }}>
            Regime fit · monthly closes × stored classifier
          </div>
          {regimeStats ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
                {REGIME_ORDER.map((label) => {
                  const cell = regimeStats.acc.get(label);
                  const color = REGIME_COLORS[label];
                  const avg = cell ? (cell.sum / cell.n) * 100 : null;
                  return (
                    <div key={label} style={{ border: `0.5px solid ${color}40`, background: `${color}1f`, borderRadius: "var(--r-xs)", padding: "8px 10px" }}>
                      <div style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color }}>
                        {label}
                      </div>
                      <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, marginTop: 2, color: avg == null ? "var(--text-muted)" : avg >= 0 ? "var(--pos)" : "var(--neg-text)" }}>
                        {avg != null ? `${avg >= 0 ? "+" : ""}${avg.toFixed(1)}%` : "—"}
                      </div>
                      <div style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", marginTop: 2 }}>
                        {cell ? `${Math.round((cell.up / cell.n) * 100)}% up · n=${cell.n}` : "no overlap"}
                      </div>
                    </div>
                  );
                })}
              </div>
              <Caption>
                Average monthly return for {symbol} inside each classifier regime since {regimeStats.firstMonth} (
                {regimeStats.joined} overlapping months; monthly closes via {providerName(monthly.data?.provider)}); up% is the
                share of positive months. Small n cells are anecdotes, not laws.
              </Caption>
            </>
          ) : (
            <Caption>
              {monthly.isPending || regimes.isLoading
                ? "Joining monthly closes with the stored regime history…"
                : monthly.isError
                  ? describeProviderError(monthly.error, "monthly history", symbol)
                  : "Fewer than 12 months overlap the stored regime history; no regime read for this name."}
            </Caption>
          )}
        </div>

        {/* ── stored coverage ──────────────────────────────────────────── */}
        <div style={{ marginTop: 14 }}>
          <div style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-wide)", color: "var(--text-label)", marginBottom: 6 }}>
            Stored coverage · 7-day window
            {coverage.matched ? " · headline match" : ""}
          </div>
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
              {tickerNews.isLoading || generalNews.isLoading
                ? "Reading the stored news window…"
                : `No stored coverage mentions ${symbol} in the last 7 days; the feed keeps a rolling window and ages out by design.`}
            </Caption>
          )}
          {coverage.matched && coverage.rows.length > 0 && (
            <Caption>
              No rows are tagged {symbol}; these headlines mention "{nameToken(p?.name) ?? symbol}" by name instead.
            </Caption>
          )}
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

export function OptionsLens({ symbol }: { symbol: string }) {
  const { isNarrow } = useBreakpoint();
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
    <div style={{ marginTop: 14 }} onClick={() => !open && setOpen(true)} onKeyDown={(e) => e.key === "Enter" && !open && setOpen(true)}>
      <Disclosure title="Options lens" right={status} id="options-lens">
        {exps.isPending ? (
          <Caption>Requesting listed expirations for {symbol} from EODHD…</Caption>
        ) : exps.isError ? (
          <div role="status" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn-hot)", lineHeight: 1.55 }}>
            {unentitled
              ? "Options data is not included in the EODHD plan configured on this server; no chain is shown rather than a fabricated one. The provider status page records the check."
              : describeProviderError(exps.error, "options data", symbol)}
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
              <div role="group" aria-label="Contract type" style={{ display: "inline-flex", gap: 4 }}>
                {(["call", "put"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="mrr-chip-btn"
                    data-touch={isNarrow ? "true" : "false"}
                    aria-pressed={side === s}
                    onClick={() => setSide(s)}
                    style={{ color: side === s ? "var(--accent)" : "var(--text-muted)", borderColor: side === s ? "rgba(74,158,255,.4)" : undefined }}
                  >
                    {s === "call" ? "Calls" : "Puts"}
                  </button>
                ))}
              </div>
              {exps.data?.truncated ? <span style={{ ...mono, fontSize: "var(--fs-micro)", color: "var(--text-muted)" }}>first 1,000 contracts scanned for expirations</span> : null}
            </div>
            {chain.isPending ? (
              <Caption>Requesting {side}s for {exp} from EODHD…</Caption>
            ) : chain.isError ? (
              <div role="status" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--warn-hot)" }}>
                {describeProviderError(chain.error, "the option chain", symbol)}
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
