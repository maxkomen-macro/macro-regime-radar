/**
 * Markets v1 — locked IA: watchlist (Macro Tape + Single Names, two visibly
 * separate sections), sector heatmap, the full What's Priced table (single
 * home; Dashboard keeps a 3-row teaser), and the full 10-row Top Surprises.
 *
 * The tape is fed by the EODHD relay (web/src/live/quotes.ts → api/stream.py):
 * crypto and FX stream around the clock, US equities during NYSE hours,
 * 15-min-delayed REST rows fill the gaps, and every row states what it is.
 * Rows paint at most twice a second (store-side coalescing), flash 600ms on
 * change, and Single Names re-sort by day move as ticks land. Clicking any
 * row opens a Lightweight Charts panel over the stored candle history.
 *
 * The grid is bespoke screen code following DataTable's specimen laws (9px
 * uppercase headers, 8×12 cells, zebra 1.2% white, mono numerics) — row-level
 * click/flash/re-sort don't fit the DataTable contract.
 */

import { Fragment, Suspense, lazy, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useLocation } from "react-router-dom";
import { Card, SectionHeader, Sparkline, StatTile } from "../../components";
import { useCreditOas, useFreshness, useMarketDaily, usePriced, useSurprises } from "../../api/queries";
import DeskRead, { type LedgerItem } from "../shared/DeskRead";
import ScrollTable from "../shared/ScrollTable";
import { assessFreshness, type FreshInfo } from "../shared/freshness";
import {
  LIVE_WINDOW_MS,
  streamIsLive,
  useQuotes,
  useStreamStatus,
  type FeedState,
  type LiveQuote,
} from "../../live/quotes";
import { fmtDate, fmtPct, fmtSigned, fmtSignedPct, tidyProse } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import type { DailyBar } from "../../api/types";
import { CHART_PANEL_ID } from "./chart-panel-id";
import Jargon from "../shared/Jargon";
import { useHashScroll } from "../shared/screen-ui";
import SingleName from "./SingleName";
import SymbolSearch from "./SymbolSearch";

// Lazy: lightweight-charts (~60KB gzip) loads only when a row is clicked —
// it has no business in the first paint of any tab (critique 2026-08-06).
const ChartPanel = lazy(() => import("./ChartPanel"));

/* ── symbol registry ───────────────────────────────────────────────────── */

type Kind = "usd" | "fx" | "index";
type Feed = "us" | "crypto" | "forex" | "vix";

interface TapeDef {
  symbol: string;
  name: string;
  kind: Kind;
  feed: Feed;
}

/** The tape reads top-down as a macro dashboard: risk assets first, then the
 * rates/credit/dollar complex, then real assets, crypto, and the fear gauge.
 * Eyebrow rows make that ordering visible (ruled 2026-08-06). */
const TAPE_GROUPS: { label: string; defs: TapeDef[] }[] = [
  {
    label: "Equities",
    defs: [
      { symbol: "SPY", name: "S&P 500", kind: "usd", feed: "us" },
      { symbol: "QQQ", name: "Nasdaq 100", kind: "usd", feed: "us" },
      { symbol: "IWM", name: "Russell 2000", kind: "usd", feed: "us" },
      { symbol: "EEM", name: "EM equities", kind: "usd", feed: "us" },
      { symbol: "EFA", name: "Intl developed", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Rates",
    defs: [
      { symbol: "TLT", name: "20Y+ Treasuries", kind: "usd", feed: "us" },
      { symbol: "IEF", name: "7–10Y Treasuries", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Credit",
    defs: [
      { symbol: "HYG", name: "High-yield credit", kind: "usd", feed: "us" },
      { symbol: "LQD", name: "IG credit", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Dollar & FX",
    defs: [
      { symbol: "UUP", name: "US dollar", kind: "usd", feed: "us" },
      { symbol: "EURUSD", name: "Euro / dollar · rate", kind: "fx", feed: "forex" },
      { symbol: "USDJPY", name: "Dollar / yen · rate", kind: "fx", feed: "forex" },
    ],
  },
  {
    label: "Metals",
    defs: [
      { symbol: "GLD", name: "Gold", kind: "usd", feed: "us" },
      { symbol: "SLV", name: "Silver", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Energy & Industrial",
    defs: [
      { symbol: "USO", name: "Oil (WTI)", kind: "usd", feed: "us" },
      { symbol: "CPER", name: "Copper", kind: "usd", feed: "us" },
    ],
  },
  {
    label: "Crypto",
    defs: [
      { symbol: "BTC-USD", name: "Bitcoin", kind: "usd", feed: "crypto" },
      { symbol: "ETH-USD", name: "Ether", kind: "usd", feed: "crypto" },
    ],
  },
  {
    label: "Volatility",
    defs: [{ symbol: "VIX", name: "VIX · index", kind: "index", feed: "vix" }],
  },
];

const MACRO_TAPE: TapeDef[] = TAPE_GROUPS.flatMap((g) => g.defs);

const SINGLE_NAMES: TapeDef[] = [
  { symbol: "AAPL", name: "Apple", kind: "usd", feed: "us" },
  { symbol: "MSFT", name: "Microsoft", kind: "usd", feed: "us" },
  { symbol: "NVDA", name: "Nvidia", kind: "usd", feed: "us" },
  { symbol: "GOOGL", name: "Alphabet", kind: "usd", feed: "us" },
  { symbol: "AMZN", name: "Amazon", kind: "usd", feed: "us" },
  { symbol: "META", name: "Meta Platforms", kind: "usd", feed: "us" },
  { symbol: "TSLA", name: "Tesla", kind: "usd", feed: "us" },
  { symbol: "AVGO", name: "Broadcom", kind: "usd", feed: "us" },
  { symbol: "TSM", name: "TSMC", kind: "usd", feed: "us" },
  { symbol: "MU", name: "Micron", kind: "usd", feed: "us" },
  { symbol: "AMD", name: "AMD", kind: "usd", feed: "us" },
  { symbol: "COIN", name: "Coinbase", kind: "usd", feed: "us" },
];

/** Symbols the DB stores daily candles for (chart panel + 1W/1M/spark). */
const DB_SYMBOLS = new Set([
  "SPY", "QQQ", "IWM", "TLT", "IEF", "HYG", "LQD",
  "UUP", "GLD", "SLV", "USO", "CPER", "EEM", "EFA",
]);
const SECTORS: { symbol: string; name: string }[] = [
  { symbol: "XLF", name: "Financials" },
  { symbol: "XLE", name: "Energy" },
  { symbol: "XLI", name: "Industrials" },
  { symbol: "XLK", name: "Technology" },
];
const DAILY_FETCH = [...DB_SYMBOLS, ...SECTORS.map((s) => s.symbol)];

/* ── formatting ────────────────────────────────────────────────────────── */

function fmtPrice(def: TapeDef, p: number): string {
  if (def.kind === "fx") return def.symbol === "EURUSD" ? p.toFixed(4) : p.toFixed(3);
  const n =
    p >= 1_000
      ? p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.toFixed(2);
  return def.kind === "usd" ? `$${n}` : n;
}

function fmtDayDollar(def: TapeDef, dd: number): string {
  if (def.kind === "fx") return fmtSigned(dd, def.symbol === "EURUSD" ? 4 : 3);
  return fmtSigned(dd, 2);
}

const ET_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const fmtEtClock = (ms: number) => `${ET_CLOCK.format(new Date(ms))} ET`;

const ET_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
/** "Aug 05, 16:00 ET" — every stale row states WHEN, not a constant string. */
function fmtEtStamp(ms: number): string {
  const parts = ET_STAMP.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ET`;
}

/** Freshness is derived, never asserted (critique 2026-08-06): live rows show
 * a ticking ● clock; everything else prints the actual quote timestamp, with
 * the 15-minute REST delay stated where it applies. A constant string renders
 * only when the feed gave us no timestamp at all. */
function asOfCell(q: LiveQuote | undefined): { text: string; live: boolean } {
  if (!q) return { text: "—", live: false };
  const fresh = q.t != null && Date.now() - q.t < LIVE_WINDOW_MS;
  if (q.src === "ws" && q.t != null) {
    return fresh
      ? { text: fmtEtClock(q.t), live: true }
      : { text: fmtEtStamp(q.t), live: false };
  }
  if (q.t != null) {
    return { text: `${fmtEtStamp(q.t)}${q.delayed ? " · 15m" : ""}`, live: false };
  }
  return { text: q.delayed ? "15m delayed" : "—", live: false };
}

/* ── shared cell styles ────────────────────────────────────────────────── */

const mono: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontVariantNumeric: "tabular-nums",
};
const headerCell: React.CSSProperties = {
  ...mono,
  fontSize: "var(--fs-micro)",
  textTransform: "uppercase",
  letterSpacing: "var(--ls-wide)",
  color: "var(--text-muted)",
  textAlign: "right",
};
// Captions are prose: UI face at --fs-caption (the 2026-08-26 readability
// pass) — mono inside a caption is opt-in per number via <span style={mono}>.
const capStyle: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--fs-caption)",
  color: "var(--text-muted)",
  lineHeight: 1.55,
  marginTop: 6,
  maxWidth: "var(--maxw-prose)",
};

// A missing figure is information ("no quote"), so the dash reads at muted,
// never the decorative faint rung (executive pass, 2026-09-05).
const toneColor = (v: number | null | undefined) =>
  v == null ? "var(--text-muted)" : v >= 0 ? "var(--pos)" : "var(--neg-text)";

/* ── tape row ──────────────────────────────────────────────────────────── */

// Last track is the AS OF stamp: "Aug 26, 16:29 ET · 15m" is 22 mono chars at
// the 11px meta size (~145px), so 118px clipped it. The tape scrolls
// horizontally inside its card below ~1000px, so the extra width is free.
const TAPE_GRID = "76px minmax(140px,1.4fr) 110px 84px 90px 70px 70px 88px 150px";
const SINGLES_GRID = "76px minmax(140px,1.4fr) 110px 84px 90px 150px";
// Below 768 the tape prioritises columns instead of shrinking type: ticker,
// last, day %, 1M % and the as-of stamp; name, Δ$, 1W and the sparkline wait
// for a wider screen (the ticker column stays pinned while the rest swipes).
const TAPE_GRID_NARROW = "64px 96px 76px 70px 130px";
const SINGLES_GRID_NARROW = "64px 96px 76px 130px";

interface RowProps {
  def: TapeDef;
  quote: LiveQuote | undefined;
  bars: DailyBar[] | undefined;
  wide: boolean; // macro tape carries 1W/1M/spark columns
  narrow?: boolean; // phone column set
  zebra: boolean;
  selected: boolean;
  onSelect: (symbol: string) => void;
}

// memo: the store preserves quote object identity for untick'd symbols, so at
// the 2Hz paint cap only rows whose price actually moved re-render — the other
// ~29 bail on shallow props (critique 2026-08-06).
const TapeRow = memo(function TapeRow({ def, quote, bars, wide, narrow = false, zebra, selected, onSelect }: RowProps) {
  // 600ms directional wash on price change — previous value held in a ref
  // (TickerStrip's documented tick-flash pattern).
  const prevRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const p = quote?.p ?? null;
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = p;
    if (p != null && prev != null && p !== prev) {
      setFlash(p > prev ? "up" : "down");
      const t = window.setTimeout(() => setFlash(null), 600);
      return () => window.clearTimeout(t);
    }
  }, [p]);

  const last = bars?.length ? bars[bars.length - 1] : undefined;
  // Dated beats empty (review 2026-09-05): with no stream quote the row prints
  // the newest stored close and its date instead of "no quote".
  const storedClose = !quote && last?.close != null ? last : undefined;
  const spark = useMemo(
    () => (bars ?? []).slice(-30).map((b) => b.close).filter((c): c is number => c != null),
    [bars],
  );
  const asOf = asOfCell(quote);
  const num = (v: number | null | undefined, f: (x: number) => string) =>
    v == null ? "—" : f(v);

  return (
    <button
      onClick={() => onSelect(def.symbol)}
      aria-expanded={selected}
      aria-controls={CHART_PANEL_ID}
      title={`Open ${def.symbol} chart`}
      style={{
        appearance: "none",
        display: "grid",
        gridTemplateColumns: narrow ? (wide ? TAPE_GRID_NARROW : SINGLES_GRID_NARROW) : wide ? TAPE_GRID : SINGLES_GRID,
        gap: 12,
        alignItems: "baseline",
        width: "100%",
        minHeight: narrow ? 44 : 36,
        textAlign: "left",
        padding: "8px 12px",
        cursor: "pointer",
        border: "none",
        borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
        background: zebra ? "rgba(255,255,255,.012)" : "transparent",
        animation: flash ? `mrr-flash-${flash} var(--tick-flash) var(--ease-out)` : "none",
        color: "var(--text)",
      }}
    >
      <span className="mrr-tape-ticker" title={def.name} style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 700, textAlign: "left" }}>
        {def.symbol}
      </span>
      {!narrow && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--fs-body-s)",
            color: "var(--text-muted)",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            textAlign: "left",
          }}
        >
          {def.name}
        </span>
      )}
      <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, textAlign: "right" }}>
        {quote ? (
          fmtPrice(def, quote.p)
        ) : storedClose ? (
          <span style={{ color: "var(--text-2)" }}>{fmtPrice(def, storedClose.close as number)}</span>
        ) : (
          <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>no quote</span>
        )}
      </span>
      <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: toneColor(quote ? quote.dc : storedClose?.ret_1d) }}>
        {quote ? num(quote.dc, (v) => fmtSignedPct(v)) : num(storedClose?.ret_1d, (v) => fmtSignedPct(v))}
      </span>
      {!narrow && (
        <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: toneColor(quote?.dd) }}>
          {quote?.dd != null ? fmtDayDollar(def, quote.dd) : "—"}
        </span>
      )}
      {wide && (
        <>
          {!narrow && (
            <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: toneColor(last?.ret_1w) }}>
              {num(last?.ret_1w, (v) => fmtSignedPct(v, 1))}
            </span>
          )}
          <span style={{ ...mono, fontSize: "var(--fs-body-s)", textAlign: "right", color: toneColor(last?.ret_1m) }}>
            {num(last?.ret_1m, (v) => fmtSignedPct(v, 1))}
          </span>
          {!narrow && (
            <span style={{ justifySelf: "end", alignSelf: "center" }}>
              {spark.length >= 2 ? (
                <Sparkline values={spark} width={84} height={20} color="var(--accent)" />
              ) : (
                <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>—</span>
              )}
            </span>
          )}
        </>
      )}
      <span
        style={{
          ...mono,
          fontSize: "var(--fs-meta)",
          textAlign: "right",
          color: asOf.live ? "var(--pos)" : "var(--text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {asOf.live ? "● " : ""}
        {quote ? asOf.text : storedClose ? `${fmtDate(storedClose.date)} close` : asOf.text}
      </span>
    </button>
  );
});

function TapeHeader({ wide, narrow = false }: { wide: boolean; narrow?: boolean }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: narrow ? (wide ? TAPE_GRID_NARROW : SINGLES_GRID_NARROW) : wide ? TAPE_GRID : SINGLES_GRID,
        gap: 12,
        padding: "6px 12px 6px 15px",
        borderBottom: "1px solid var(--line-hair)",
      }}
    >
      <span className="mrr-tape-ticker" style={{ ...headerCell, textAlign: "left" }}>Ticker</span>
      {!narrow && <span style={{ ...headerCell, textAlign: "left" }}>Name</span>}
      <span style={headerCell}>Last</span>
      <span style={headerCell}>Day %</span>
      {!narrow && <span style={headerCell}>Day Δ$</span>}
      {wide && (
        <>
          {!narrow && <span style={headerCell}>1W %</span>}
          <span style={headerCell}>1M %</span>
          {!narrow && <span style={headerCell}>30 Sess</span>}
        </>
      )}
      <span style={headerCell}>As of</span>
    </div>
  );
}

/* ── feed status line ──────────────────────────────────────────────────── */

/** True during NYSE regular hours (Mon–Fri 09:30–16:00 ET, holidays not
 * modeled) — used only to pick honest wording, never to claim data. */
function nyseSessionOpen(): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  if (["Sat", "Sun"].includes(get("weekday"))) return false;
  const mins = parseInt(get("hour"), 10) * 60 + parseInt(get("minute"), 10);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

function feedWord(
  feed: "us" | "crypto" | "forex" | "vix",
  state: FeedState | undefined,
  hasLiveTicks: boolean,
): { text: string; color: string } {
  if (state === "open" && hasLiveTicks) return { text: "● live", color: "var(--pos)" };
  if (state === "open") {
    // Connected but tickless — say it in trader words, not engineer words
    // (critique: "idle" scans as broken to a skimmer).
    const text =
      feed === "us"
        ? nyseSessionOpen()
          ? "awaiting trades"
          : "session closed"
        : "quiet";
    return { text, color: "var(--text-muted)" };
  }
  if (state === "rest") return { text: "15m delayed", color: "var(--text-muted)" };
  if (state === "auth_failed") return { text: "feed rejected by the provider", color: "var(--neg-text)" };
  if (state === "connecting") return { text: "connecting", color: "var(--text-muted)" };
  if (state === "closed") return { text: "reconnecting", color: "var(--text-muted)" };
  if (state === "off" || state == null) return { text: "off", color: "var(--text-muted)" };
  // Never a raw machine state on screen: anything new reads as unavailable.
  return { text: "unavailable", color: "var(--text-muted)" };
}

function FeedStatusLine() {
  const status = useStreamStatus();
  const quotes = useQuotes();
  const liveByFeed = useMemo(() => {
    const now = Date.now();
    const live = { us: false, crypto: false, forex: false };
    for (const def of [...MACRO_TAPE, ...SINGLE_NAMES]) {
      const q = quotes.get(def.symbol);
      if (q?.src === "ws" && q.t != null && now - q.t < LIVE_WINDOW_MS && def.feed !== "vix") {
        live[def.feed as "us" | "crypto" | "forex"] = true;
      }
    }
    return live;
  }, [quotes]);

  const seg = (label: string, s: { text: string; color: string }) => (
    <span key={label}>
      <span style={{ color: "var(--text-muted)" }}>{label} </span>
      <span style={{ color: s.color }}>{s.text}</span>
    </span>
  );
  // The honesty widget must not outlive its transport: with the relay socket
  // down, per-feed states are stale claims — say the stream is down instead
  // (critique P1: a dead API rendered "CONNECTED" forever).
  if (status.socket !== "open") {
    // One honest phrase whether the socket is mid-retry or down: the rows
    // print stored closes with their dates either way.
    return (
      <span style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", color: "var(--warn-hot)" }}>
        stream unavailable · showing stored closes
      </span>
    );
  }
  return (
    <span style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", display: "inline-flex", gap: 14 }}>
      {seg("US", feedWord("us", status.feeds.us, liveByFeed.us))}
      {seg("CRYPTO", feedWord("crypto", status.feeds.crypto, liveByFeed.crypto))}
      {seg("FX", feedWord("forex", status.feeds.forex, liveByFeed.forex))}
      {seg("VIX", feedWord("vix", status.feeds.vix, false))}
    </span>
  );
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function MarketsScreen() {
  // The one width-conditional mechanism on this screen (lib/useBreakpoint.ts):
  // below 768 the multi-column blocks collapse, at and above it nothing moves.
  // The two tape grids are NOT width-conditional — fixed tracks scrolling
  // inside their own card is the honest answer for a 9-column price table.
  const { isMobile, isNarrow } = useBreakpoint();
  const quotes = useQuotes();
  const status = useStreamStatus();
  const daily = useMarketDaily(DAILY_FETCH, 60);
  const priced = usePriced();
  const surprises = useSurprises(10);
  const credit = useCreditOas(90);
  const freshness = useFreshness();
  // ?chart=SPY deep-links an open panel (evidence captures, palette jumps).
  const [selected, setSelected] = useState<string | null>(() => {
    const c = new URLSearchParams(window.location.search).get("chart")?.toUpperCase();
    return c && [...MACRO_TAPE, ...SINGLE_NAMES].some((d) => d.symbol === c) ? c : null;
  });
  // Single-name research: any listed symbol via the on-demand yfinance layer.
  // ?name=NVDA deep-links an open deep dive.
  const [lookupSym, setLookupSym] = useState<string | null>(() => {
    const c = new URLSearchParams(window.location.search).get("name")?.toUpperCase();
    return c && /^[A-Z0-9.^=\-]{1,15}$/.test(c) ? c : null;
  });
  // A watchlist row (sidebar) navigates to ?name=SYM while this screen may
  // already be mounted (same-tab navigation keeps the ErrorBoundary key), so
  // the param is re-read on every location change, not only at mount
  // (redesign Phase 1, checklist F.8). The initializer above covers the
  // first paint without a flash.
  const { search } = useLocation();
  useEffect(() => {
    const c = new URLSearchParams(search).get("name")?.toUpperCase();
    if (c && /^[A-Z0-9.^=\-]{1,15}$/.test(c)) setLookupSym(c);
  }, [search]);
  // #single-name-research (and the palette's section jumps) land once the
  // panel exists.
  useHashScroll(lookupSym);

  const barsBySymbol = useMemo(() => {
    const m = new Map<string, DailyBar[]>();
    daily.data?.forEach((b) => {
      const arr = m.get(b.symbol);
      if (arr) arr.push(b);
      else m.set(b.symbol, [b]);
    });
    return m;
  }, [daily.data]);

  // Single names re-sort by the day's % move as ticks land (spec). Unquoted
  // rows sink to the bottom in registry order (explicit null handling — the
  // old -Infinity arithmetic leaned on NaN comparator semantics).
  const singlesSorted = useMemo(() => {
    return [...SINGLE_NAMES].sort((a, b) => {
      const da = quotes.get(a.symbol)?.dc ?? null;
      const db = quotes.get(b.symbol)?.dc ?? null;
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    });
  }, [quotes]);

  const toggleSelect = useCallback(
    (s: string) => setSelected((cur) => (cur === s ? null : s)),
    [],
  );

  const selectedDef = useMemo(
    () => [...MACRO_TAPE, ...SINGLE_NAMES].find((d) => d.symbol === selected) ?? null,
    [selected],
  );

  const live = streamIsLive(status, quotes);
  const marketDailyDate = useMemo(() => {
    let max: string | null = null;
    barsBySymbol.forEach((bars) => {
      const d = bars[bars.length - 1]?.date;
      if (d && (!max || d > max)) max = d;
    });
    return max;
  }, [barsBySymbol]);

  const pricedByMetric = useMemo(
    () => new Map((priced.data ?? []).map((p) => [p.metric, p])),
    [priced.data],
  );
  const pricedGroups = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof priced.data>>();
    (priced.data ?? []).forEach((p) => {
      const g = groups.get(p.group);
      if (g) g.push(p);
      else groups.set(p.group, [p]);
    });
    return [...groups.entries()];
  }, [priced.data]);

  const beTermNote = useMemo(() => {
    const t5 = pricedByMetric.get("T5YIE")?.value;
    const t10 = pricedByMetric.get("T10YIE")?.value;
    if (t5 == null || t10 == null) return null;
    const spread = t10 - t5;
    if (spread > 0.1)
      return `10Y breakeven sits ${spread.toFixed(2)}pp above 5Y: the market prices inflation as persistent, not passing.`;
    if (spread < -0.1)
      return `5Y breakeven sits ${(-spread).toFixed(2)}pp above 10Y: near-term inflation concern, longer term anchored.`;
    return `5Y and 10Y breakevens sit in line (${t5.toFixed(2)}% / ${t10.toFixed(2)}%): no meaningful term premium on inflation.`;
  }, [pricedByMetric]);

  const surpriseWeek = useMemo(() => {
    const dates = (surprises.data ?? []).map((s) => s.date);
    return dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  }, [surprises.data]);

  const groupCaptions: Record<string, React.ReactNode> = {
    "Policy rate proxies": "Where the overnight rate actually sits: the hurdle every risk asset has to clear.",
    "Inflation breakevens": (
      <>
        Nominal minus <Jargon term="TIPS">TIPS</Jargon> yields: the market&apos;s own inflation
        forecast, no survey asked.
      </>
    ),
    "Real yields (TIPS)": "The after-inflation rate: the gravity working on gold, growth stocks, and long duration.",
  };

  /* ── desk read: what the tape says right now, composed from the feed ── */
  const deskRead = (() => {
    const spy = quotes.get("SPY");
    const qqq = quotes.get("QQQ");
    const vixQ = quotes.get("VIX");
    const ten = credit.data?.series.find((x) => x.label === "UST10Y");
    const usOpen = nyseSessionOpen();
    // "Live" means a US symbol actually ticked over the socket inside the live
    // window; a connected-but-silent feed is not live (crypto ticking at night
    // must not make the US session read live).
    const now = Date.now();
    const usLive =
      status.socket === "open" &&
      MACRO_TAPE.some((d) => {
        if (d.feed !== "us") return false;
        const q = quotes.get(d.symbol);
        return q?.src === "ws" && q.t != null && now - q.t < LIVE_WINDOW_MS;
      });
    void live;
    const newestTick = [...quotes.values()].reduce<number | null>((m, q) => (q.t != null && (m == null || q.t > m) ? q.t : m), null);
    const tapeInfo: FreshInfo = newestTick
      ? assessFreshness(new Date(newestTick).toISOString(), "intraday")
      : assessFreshness(null, "intraday");
    const storedInfo = assessFreshness(marketDailyDate ?? freshness.data?.market_daily_date, "daily");
    const pricedDate = priced.data?.length ? priced.data.map((p) => p.date).reduce((a, b) => (a > b ? a : b)) : null;

    const sectorRets = SECTORS.map(({ symbol, name }) => {
      const bars = barsBySymbol.get(symbol);
      return { name, ret: bars?.length ? bars[bars.length - 1].ret_1d : null };
    }).filter((x) => x.ret != null) as { name: string; ret: number }[];
    const lead = sectorRets.length ? sectorRets.reduce((a, b) => (b.ret > a.ret ? b : a)) : null;
    const lag = sectorRets.length ? sectorRets.reduce((a, b) => (b.ret < a.ret ? b : a)) : null;

    const spyBar = barsBySymbol.get("SPY")?.slice(-1)[0];
    const qqqBar = barsBySymbol.get("QQQ")?.slice(-1)[0];
    const spyWord =
      spy?.dc != null
        ? `SPY ${fmtSignedPct(spy.dc)}`
        : spy?.p != null
          ? `SPY $${spy.p.toFixed(2)} last`
          : spyBar?.close != null
            ? `SPY $${spyBar.close.toFixed(2)} (${fmtDate(spyBar.date)} close)`
            : "SPY unquoted";
    const qqqWord =
      qqq?.dc != null
        ? `, QQQ ${fmtSignedPct(qqq.dc)}`
        : qqq?.p != null
          ? `, QQQ $${qqq.p.toFixed(2)}`
          : qqqBar?.close != null
            ? `, QQQ $${qqqBar.close.toFixed(2)}`
            : "";
    const conclusion = usLive
      ? `US session live: ${spyWord}${qqq?.dc != null ? `, QQQ ${fmtSignedPct(qqq.dc)}` : ""}${vixQ ? `, VIX ${vixQ.p.toFixed(2)}` : ""}.`
      : usOpen
        ? `US session open but the stream is not ticking: ${spyWord}${vixQ ? `, VIX ${vixQ.p.toFixed(2)}` : ""}.`
        : status.socket !== "open" && !spy
          ? `Stream unavailable, stored closes shown: ${spyWord}${qqqWord}.`
          : `US session closed: ${spyWord}${qqqWord}${vixQ ? `, VIX ${vixQ.p.toFixed(2)}` : ""}${
              spy?.delayed ? " (15-minute delayed quotes)" : ""
            }.`;

    const ledger: LedgerItem[] = [
      ...(ten
        ? [{ label: "US 10Y", value: `${fmtPct(ten.value_pct)}${ten.change_1w_bps != null ? ` · ${ten.change_1w_bps >= 0 ? "+" : ""}${Math.round(ten.change_1w_bps)} bps 1w` : ""}` }]
        : []),
      ...(lead && lag
        ? [
            {
              label: "Sectors · 1d",
              value: `${lead.name} ${fmtSignedPct(lead.ret)} leads · ${lag.name} ${fmtSignedPct(lag.ret)} lags`,
              prose: true,
            },
          ]
        : []),
      ...(pricedByMetric.get("T10YIE") && pricedByMetric.get("DFII10")
        ? [
            {
              label: "Priced",
              value: `10Y breakeven ${pricedByMetric.get("T10YIE")!.value.toFixed(2)}% · 10Y real ${pricedByMetric.get("DFII10")!.value.toFixed(2)}%`,
            },
          ]
        : []),
      ...(surprises.data?.length
        ? [
            {
              label: "Top surprise",
              value: tidyProse(surprises.data[0].interpretation),
              prose: true,
            },
          ]
        : []),
    ];

    return (
      <DeskRead
        eyebrow="Desk read · Markets"
        live={usLive}
        conclusion={conclusion}
        why={
          usLive
            ? "Day moves are the exchange feed's own figures. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence."
            : "Off-hours the board holds the last quote with its timestamp. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence."
        }
        ledger={ledger}
        freshness={[
          { noun: "Tape", info: tapeInfo },
          { noun: "Stored candles", info: storedInfo },
          { noun: "Priced", info: assessFreshness(pricedDate, "weekly") },
        ]}
      />
    );
  })();

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {deskRead}

      {/* ── Single-name research: search any listed symbol ───────────── */}
      <section id="single-name-research">
        <SectionHeader
          title="Single-name research"
          right="any listed symbol · EODHD first, yfinance only as a disclosed fallback · delayed quotes"
        />
        <SymbolSearch onSelect={(hit) => setLookupSym(hit.symbol)} />
        {lookupSym && <SingleName symbol={lookupSym} onClose={() => setLookupSym(null)} />}
        {!lookupSym && (
          <div style={{ ...capStyle, marginTop: 8 }}>
            Type a ticker or company name for a full profile: delayed quote, candles across seven
            ranges, fundamentals, regime fit since 1996, and the stored news window.
          </div>
        )}
      </section>

      {/* ── Watchlist: Macro Tape + Single Names ─────────────────────── */}
      <section id="watchlist">
        <SectionHeader title="Macro tape" right={<FeedStatusLine />} />
        {selectedDef && (
          <Suspense
            fallback={
              <Card style={{ marginBottom: 12 }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
                  Loading the chart module…
                </span>
              </Card>
            }
          >
            <ChartPanel
              symbol={selectedDef.symbol}
              name={selectedDef.name}
              hasHistory={DB_SYMBOLS.has(selectedDef.symbol)}
              onClose={() => setSelected(null)}
            />
          </Suspense>
        )}
        {/* The well scrolls the fixed-track grid under ~1000px instead of
            silently clipping the freshness column (critique P1); the ticker
            column pins and a swipe affordance appears when it overflows. */}
        <Card style={{ padding: 0 }}>
          <ScrollTable label="Macro tape">
          <TapeHeader wide narrow={isNarrow} />
          {TAPE_GROUPS.map((group, gi) => (
            <Fragment key={group.label}>
              {/* 9px uppercase mono eyebrow — one table, groups made visible
                  (ruled 2026-08-06); zebra restarts per group. */}
              <div
                role="presentation"
                style={{
                  ...mono,
                  fontSize: "var(--fs-micro)",
                  textTransform: "uppercase",
                  letterSpacing: "var(--ls-wide)",
                  color: "var(--text-label)",
                  padding: gi === 0 ? "7px 12px 3px 15px" : "9px 12px 3px 15px",
                  borderTop: gi === 0 ? "none" : "0.5px solid var(--line-hair)",
                }}
              >
                {group.label}
              </div>
              {group.defs.map((def, i) => (
                <TapeRow
                  key={def.symbol}
                  def={def}
                  quote={quotes.get(def.symbol)}
                  bars={barsBySymbol.get(def.symbol)}
                  wide
                  narrow={isNarrow}
                  zebra={i % 2 === 1}
                  selected={selected === def.symbol}
                  onSelect={toggleSelect}
                />
              ))}
            </Fragment>
          ))}
          </ScrollTable>
        </Card>
        <div style={capStyle}>
          Day moves come straight from the exchange feed&apos;s own day-change figures; never
          recomputed here. 1W / 1M and sparklines come from the stored daily candles
          {marketDailyDate ? ` through ${fmtDate(marketDailyDate)}` : ""}; crypto, FX, VIX and
          single names have no stored history yet, so those columns print a dash. A dash under
          Day % means the feed sent a price without a day change (off-hours REST fill); the as-of
          stamp says when.
          {isNarrow ? " Name, Δ$, 1W and the sparkline return above 768px." : ""}
          {/* Cadence + cross-surface reconciliation: the VIX row is a quote off
              this feed, while the Dashboard's VIX spike card reads the monthly
              signals snapshot — two honest levels, two cadences. */}
          <div style={{ marginTop: 2 }}>
            Every row states its own as-of stamp: ● marks a live tick, the rest print the quote time
            with the 15-minute delay noted where it applies, and a dated close means the stream had no
            quote. The dashboard&apos;s VIX spike signal reads the monthly signal print, so it carries a
            different level than the VIX row here.
          </div>
        </div>

        <div id="single-names" style={{ marginTop: 16 }}>
          <SectionHeader
            title="Single names"
            right={`sorted by day move · re-sorts ${live ? "live" : "as data updates"}`}
          />
          <Card style={{ padding: 0 }}>
            <ScrollTable label="Single names">
            <TapeHeader wide={false} narrow={isNarrow} />
            {singlesSorted.map((def, i) => (
              <TapeRow
                key={def.symbol}
                def={def}
                quote={quotes.get(def.symbol)}
                bars={undefined}
                wide={false}
                narrow={isNarrow}
                zebra={i % 2 === 1}
                selected={selected === def.symbol}
                onSelect={toggleSelect}
              />
            ))}
            </ScrollTable>
          </Card>
          <div style={capStyle}>
            Twelve large-cap tech, semis, and crypto-adjacent names as market thermometers;
            biggest day move on top. Off-hours the board holds at the last close until the next
            session opens.
          </div>
        </div>
      </section>

      {/* ── Sector heatmap ───────────────────────────────────────────── */}
      <section id="sector-heatmap">
        <SectionHeader
          title="Sector heatmap"
          right={marketDailyDate ? `daily closes · ${fmtDate(marketDailyDate)}` : "daily closes"}
        />
        {/* Four homogeneous tiles: auto-fit reflows them (2-up at 375) with no
            width conditional at all — auto-fit collapses the empty tracks, so
            at any width that fits four they stay exactly repeat(4,1fr). */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 12 }}>
          {SECTORS.map(({ symbol, name }) => {
            const bars = barsBySymbol.get(symbol);
            const ret = bars?.length ? bars[bars.length - 1].ret_1d : null;
            const mag = ret == null ? 0 : Math.abs(ret) >= 2 ? 2 : Math.abs(ret) >= 1 ? 1 : 0;
            const base = ret == null ? null : ret >= 0 ? "63,185,80" : "218,54,51";
            const bg = base && mag ? `rgba(${base},${mag === 2 ? ".24" : ".12"})` : "var(--surface)";
            const line = base && mag ? `rgba(${base},${mag === 2 ? ".4" : ".25"})` : "var(--line-hair)";
            return (
              <div
                key={symbol}
                style={{
                  background: bg,
                  border: `0.5px solid ${line}`,
                  borderRadius: "var(--r-md)",
                  padding: "var(--pad-card)",
                }}
              >
                <div style={{ ...mono, fontSize: "var(--fs-label)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-label)" }}>
                  {symbol}
                  <span style={{ color: "var(--text-muted)", textTransform: "none", letterSpacing: 0 }}> · {name}</span>
                </div>
                <div style={{ ...mono, fontSize: "var(--fs-value)", fontWeight: 600, letterSpacing: "var(--ls-numeric)", color: toneColor(ret), marginTop: 4 }}>
                  {ret == null ? "—" : fmtSignedPct(ret)}
                </div>
              </div>
            );
          })}
        </div>
        <div style={capStyle}>
          One-day sector moves from stored closes; tint steps at ±1% and ±2%. Sector ETFs are
          not on the live stream; this block moves once a day.
        </div>
      </section>

      {/* ── What's Priced (single home — Dashboard links here) ───────── */}
      <section id="whats-priced-full">
        <SectionHeader
          title="What's priced"
          right={
            priced.data?.length
              ? `FRED via weekly pipeline · latest ${fmtDate(
                  priced.data.map((p) => p.date).reduce((a, b) => (a > b ? a : b)),
                )}`
              : "FRED via weekly pipeline"
          }
        />
        {pricedGroups.length ? (
          <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "repeat(3,minmax(0,1fr))", gap: 12 }}>
            {pricedGroups.map(([group, metrics]) => (
              <Card key={group}>
                <div style={{ ...mono, fontSize: "var(--fs-label)", textTransform: "uppercase", letterSpacing: "var(--ls-label)", color: "var(--text-label)", marginBottom: 10 }}>
                  {group}
                </div>
                {/* Groups already stack at <768, so the pairs keep two columns
                    there; only phone portrait is too narrow for two tiles. */}
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                  {metrics.map((p) => (
                    <StatTile
                      key={p.metric}
                      label={p.label}
                      value={`${p.value.toFixed(2)}${p.unit}`}
                      // The change of a percent-level series is pp, not % —
                      // the term-structure note below already says pp.
                      delta={
                        p.mom_chg != null
                          ? `${fmtSigned(p.mom_chg)}${p.unit === "%" ? "pp" : p.unit} MoM`
                          : undefined
                      }
                      direction={
                        p.mom_chg != null && p.mom_chg !== 0
                          ? p.mom_chg > 0
                            ? "up"
                            : "down"
                          : "flat"
                      }
                      size="sm"
                    />
                  ))}
                </div>
                <div style={capStyle}>{groupCaptions[group] ?? null}</div>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              {priced.isError
                ? "Market-implied pricing unavailable: the data service did not answer."
                : priced.isLoading
                  ? "Reading market-implied pricing…"
                  : "No priced metrics on file; the weekly pipeline has not written them yet."}
            </span>
          </Card>
        )}
        {beTermNote && (
          <div style={{ ...capStyle, marginTop: 8 }}>
            {beTermNote} <span style={{ color: "var(--text-muted)" }}>· composed from stored data</span>
          </div>
        )}
      </section>

      {/* ── Top Surprises (full 10-row home) ─────────────────────────── */}
      <section id="top-surprises">
        <SectionHeader
          title="Top surprises this week"
          right={
            surpriseWeek
              ? `weekly derived series · week ending ${fmtDate(surpriseWeek)}`
              : "weekly derived series"
          }
        />
        <Card>
          {surprises.data?.length ? (
            // A ranked list, not a table: the rows carry no column headers, so
            // list semantics (not role="table") are the honest mapping and give
            // AT users the "1 of 10" count the rank column shows visually.
            <div style={{ display: "grid", gap: 10 }} role="list">
              {surprises.data.map((s, i) => {
                const az = Math.abs(s.z_score);
                // Color keys off the DISPLAYED one-decimal value — a row
                // labeled "+1.5σ" must be amber even if the raw z is 1.4501
                // (critique: label rounded up past the color threshold).
                const azShown = Math.abs(Number(s.z_score.toFixed(1)));
                const color = azShown >= 2.5 ? "var(--neg-text)" : azShown >= 1.5 ? "var(--warn)" : "var(--accent)";
                const barColor = azShown >= 2.5 ? "var(--neg)" : azShown >= 1.5 ? "var(--warn)" : "var(--accent)";
                const pct = Math.min((az / 3) * 100, 100);
                return (
                  // Row shape is kept at every width — the σ bar's fixed track
                  // gives up width to the interpretation instead of forcing a
                  // stack, which would orphan the number from its sentence.
                  <div
                    key={s.metric}
                    role="listitem"
                    style={{
                      display: "grid",
                      gridTemplateColumns: isNarrow
                        ? "18px minmax(0,1fr) minmax(48px,80px) 44px"
                        : "18px minmax(0,1fr) 120px 52px",
                      gap: 12,
                      alignItems: "center",
                    }}
                  >
                    <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>{i + 1}</span>
                    <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)", lineHeight: 1.5 }}>
                      {tidyProse(s.interpretation)}
                    </span>
                    <span style={{ height: 4, borderRadius: "var(--r-xs)", background: "var(--surface-raised)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${pct}%`, background: barColor, borderRadius: "var(--r-xs)" }} />
                    </span>
                    <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 700, color, textAlign: "right" }}>
                      {fmtSigned(s.z_score, 1)}σ
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              {surprises.isError
                ? "Surprise feed unavailable: the data service did not answer."
                : surprises.isLoading
                  ? "Ranking the week's moves…"
                  : "No surprise data on file for this week."}
            </span>
          )}
          <div style={capStyle}>
            Weekly moves ranked by <Jargon term="z-score">z-score</Jargon>: how far outside its
            own recent range each market traveled. Bars scale to 3σ; ±1.5σ turns amber, ±2.5σ red.
            {/* Provenance: these rows are the weekly derived-metrics pipeline,
                not the monthly signals snapshot the Dashboard cards read — a
                macro metric legitimately carries two levels across the app. */}
            <div style={{ marginTop: 2 }}>
              weekly derived series
              {surpriseWeek ? ` · week ending ${fmtDate(surpriseWeek)}` : ""} · macro rows read this
              pipeline, not the monthly signal prints on the dashboard; the same metric carries a
              different level on each surface.
            </div>
          </div>
        </Card>
      </section>

      {/* ── source line ──────────────────────────────────────────────── */}
      <div style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Live prices via EODHD WebSocket (crypto &amp; FX stream around the clock, US equities
        during NYSE hours, 15-min-delayed quotes fill the gaps) · stored candles and returns via
        the yfinance pipeline · macro metrics via FRED.
      </div>
    </div>
  );
}
