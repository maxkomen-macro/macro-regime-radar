/**
 * Markets, rebuilt on TabHero + SummaryCard (redesign Phase 5,
 * docs/redesign-v2/checklists/05-markets.md B.0).
 *
 * Order of <main> children, all inside `.mrr-mkt`: the hero row (TabHero
 * `#markets-hero`, whose h1 is the risk word read off the four stored sector
 * ETFs' one-day moves and whose subhead is the live session sentence, beside
 * SummaryCard `#markets-summary` with the stream status strip) → the
 * ChartPanel region (`#markets-chart-panel`, only while a tape row is
 * selected) → the body grid (single-name research, sector heatmap, single-
 * name movers, top surprises | the macro tape with the single names under
 * it) → What's priced, full width → the mono disclosure line.
 *
 * Iteration 1 (M3): the symbol search rides in the hero's action row, so it
 * is on screen without scrolling at desk widths, and still drives the
 * single-name research panel; the movers row under the heatmap opens a
 * ticker's panel through `?name=` (the watchlist's path).
 *
 * Iteration 1 (M5): the address follows the research panel. A search pick
 * writes `?name=<SYM>` (a replace, other params and the hash kept), closing
 * the panel drops it, and a search with no hits followed by Enter opens the
 * typed ticker so the panel can say plainly that nothing is listed under it.
 *
 * The tape is fed by the EODHD relay (web/src/live/quotes.ts → api/stream.py):
 * crypto and FX stream around the clock, US equities during NYSE hours,
 * 15-min-delayed REST rows fill the gaps, and every row states what it is.
 * Every number on the page is a served field (the feed's own day-change
 * figures, the stored bars' ret_1d / ret_1w / ret_1m, the weekly pipeline's
 * metrics) or a formatted served value; nothing is re-derived in the browser.
 * Hooks are called once here and passed down; SingleName and ChartPanel keep
 * their own (React Query dedupes by key).
 */

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Card, SectionHeader, Segmented } from "../../components";
import { ApiError } from "../../api/client";
import { useCreditOas, useFreshness, useMarketDaily, usePriced, useSurprises, useSymbolProfile } from "../../api/queries";
import type { CandleRange, DailyBar, SearchHit } from "../../api/types";
import { LIVE_WINDOW_MS, streamWord, useQuotes, useStreamStatus, type LiveQuote, type StreamStatus } from "../../live/quotes";
import { fmtBps, fmtDate, fmtPct, fmtSignedPct, tidyProse } from "../../lib/format";
import Jargon from "../shared/Jargon";
import { monDD, stampLabel } from "../shared/fresh-state";
import { useFreshReport } from "../shared/useFreshReport";
import { Metric, SRC, Stamp } from "../shared/Stamp";
import { Caption, MISSING, StateNote, metaStyle, missingNote, useHashScroll, useSnapshotMode } from "../shared/screen-ui";
import { DisclosureLine } from "../shared/Disclosure";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import SummaryCard, { type StatusStripProps, type StatusTone, type SummaryRow } from "../shared/SummaryCard";
import type { FreshnessTag } from "../shared/DeskRead";
import { useShellActions } from "../shell/shell-actions";
import { degradedReason } from "../shell/shell-status";
import { CHART_PANEL_ID } from "./chart-panel-id";
import { DAILY_FETCH, DB_SYMBOLS, MACRO_TAPE, SECTORS, SINGLE_NAMES, feedWord, nyseSessionOpen } from "./tape";
import { MARKETS_GLOW, marketsHero, type SectorRead } from "./hero-copy";
import WeekBars, { type WeekBarRow } from "./WeekBars";
import MacroTape from "./MacroTape";
import Movers, { moversSummary, useMoversRead } from "./Movers";
import SectorHeatmap from "./SectorHeatmap";
import TopSurprises from "./TopSurprises";
import WhatsPriced from "./WhatsPriced";
import SingleName, { RANGES } from "./SingleName";
import SymbolSearch from "./SymbolSearch";

// Lazy: lightweight-charts (~60KB gzip) loads only when a row is clicked —
// it has no business in the first paint of any tab (critique 2026-08-06).
const ChartPanel = lazy(() => import("./ChartPanel"));

/* ── small shared bits ─────────────────────────────────────────────────── */

/** Loading and unavailable headlines ride in the UI face at the hero-sub
 * size: the serif display face is for answers only (02 B.1 states). */
const stateHeadline: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-hero-sub)",
  lineHeight: "var(--lh-hero-sub)",
  letterSpacing: 0,
  fontVariationSettings: "normal",
};

/** Direction colour for a signed figure: `--pos` up, `--neg` down (direction,
 * never valence; DESIGN.md section 2). */
const dirColor = (v: number) => (v >= 0 ? "var(--pos)" : "var(--neg)");

const SYMBOL_RE = /^[A-Z0-9.^=\-]{1,15}$/;

/** The hero lets the symbol search's result list hang below its box. */
const HERO_STYLE: CSSProperties = { overflow: "visible" };

interface LiveByFeed {
  us: boolean;
  crypto: boolean;
  forex: boolean;
}

/* ── stream status strip ───────────────────────────────────────────────── */

/** A status line's character budget: about 200 px of 12 px text, one line in
 * the narrowest strip (390 px) (Iteration 1 step 5, G4). */
const STRIP_LINE_CHARS = 36;

/**
 * The summary card's strip, worded through the one function every surface
 * shares (`streamWord`) and the tape's own feed words (`feedWord`), so the
 * strip's title agrees with the freshness card's first line. It opens the
 * data freshness breakdown; the sentence is its accessible name.
 *
 * Iteration 1 step 5 (G4): the detail is one line at every width. It names
 * the US tape's word and the other feeds that are ticking live; the quiet
 * feeds are the drawer's (Live relay), the VIX delay is the VIX row's.
 */
function streamStrip(status: StreamStatus, quotes: ReadonlyMap<string, LiveQuote>, live: LiveByFeed, openFreshness: () => void): StatusStripProps {
  const word = streamWord(status, quotes);
  const liveOthers = [
    feedWord("crypto", status.feeds.crypto, live.crypto).text === "● live" ? "crypto" : null,
    feedWord("forex", status.feeds.forex, live.forex).text === "● live" ? "FX" : null,
  ].filter((x): x is string => x != null);
  const feeds = [`US ${feedWord("us", status.feeds.us, live.us).text}`, liveOthers.length ? `${liveOthers.join(", ")} ● live` : null]
    .filter(Boolean)
    .join(" · ");
  let tone: StatusTone;
  let title: string;
  let detail: string;
  switch (word) {
    case "Live":
      tone = "mint";
      title = "Stream connected";
      detail = feeds;
      break;
    case "Delayed":
      tone = "amber";
      title = "Quotes delayed";
      detail = feeds;
      break;
    case "Off":
      tone = "gray";
      title = "Live feeds off";
      detail = "stored closes and delayed quotes only";
      break;
    case "Reconnecting":
      tone = "gray";
      title = "Stream reconnecting";
      detail = "stored closes on the tape · retrying";
      break;
    default:
      tone = "gray";
      title = "Stream unavailable";
      detail = "showing stored closes";
  }
  // A degraded relay says why in the reader words the freshness card prints.
  if (status.degraded) {
    tone = "amber";
    const reason = degradedReason(status.degradedReasons) ?? "a feed is degraded";
    detail = `${reason} · ${feeds}`.length <= STRIP_LINE_CHARS ? `${reason} · ${feeds}` : reason;
  }
  return {
    tone,
    title,
    detail,
    onClick: openFreshness,
    ariaHasPopup: "dialog",
    ariaLabel: `${title}. ${detail}. Open the data freshness breakdown.`,
  };
}

/* ── screen ────────────────────────────────────────────────────────────── */

export default function MarketsScreen() {
  const location = useLocation();
  const quotes = useQuotes();
  const status = useStreamStatus();
  const daily = useMarketDaily(DAILY_FETCH, 60);
  const snapshot = useSnapshotMode();
  // CP4: the stored-close request failed with nothing on hand.
  const storedError = daily.isError && !daily.data;
  const priced = usePriced();
  const surprises = useSurprises(10);
  const credit = useCreditOas(90);
  const freshness = useFreshness();
  const freshReport = useFreshReport();
  const { openFreshness } = useShellActions();
  // The movers row and its summary line (Iteration 1, M3a): the stream's day
  // change, else the last completed session's close from the 5D candles.
  const movers = useMoversRead(quotes, freshness.data?.session?.is_open ?? null);

  // ?chart=SPY deep-links an open panel (evidence captures, palette jumps).
  // The router's location equals window.location under BrowserRouter and is
  // what a MemoryRouter test can drive.
  const [selected, setSelected] = useState<string | null>(() => {
    const c = new URLSearchParams(location.search).get("chart")?.toUpperCase();
    return c && [...MACRO_TAPE, ...SINGLE_NAMES].some((d) => d.symbol === c) ? c : null;
  });
  // Single-name research: any listed symbol via the on-demand provider layer.
  // ?name=NVDA deep-links an open deep dive.
  const [lookupSym, setLookupSym] = useState<string | null>(() => {
    const c = new URLSearchParams(location.search).get("name")?.toUpperCase();
    return c && SYMBOL_RE.test(c) ? c : null;
  });
  // Typed text that is not ticker-shaped and matched no listing (M5): the
  // panel names the miss instead of staying on its empty prompt.
  const [missText, setMissText] = useState<string | null>(null);
  // Re-arms the hash landing when the ADDRESS brings a symbol (a watchlist
  // row, a mover, Back); a search pick rewrites the address itself and must
  // not send the page back to whatever hash it arrived with (M5).
  const [navSeq, setNavSeq] = useState(0);
  const pickedSearch = useRef<string | null>(null);
  const lastSearch = useRef(location.search);
  // A watchlist row (sidebar) navigates to ?name=SYM while this screen may
  // already be mounted (same-tab navigation keeps the ErrorBoundary key), so
  // the param is re-read on every location change, not only at mount
  // (redesign Phase 1, checklist F.8). The initializer above covers the
  // first paint without a flash.
  const { search } = location;
  useEffect(() => {
    if (search === lastSearch.current) return;
    lastSearch.current = search;
    const c = new URLSearchParams(search).get("name")?.toUpperCase();
    if (!c || !SYMBOL_RE.test(c)) return;
    setLookupSym(c);
    setMissText(null);
    if (pickedSearch.current === search) {
      pickedSearch.current = null;
      return;
    }
    setNavSeq((n) => n + 1);
  }, [search]);

  // Write the panel's symbol into the address (M5): a replace, so Back leaves
  // the tab rather than stepping through every symbol searched; any other
  // param and the hash are kept.
  const navigate = useNavigate();
  const { pathname, hash } = location;
  const writeName = useCallback(
    (symbol: string | null) => {
      const params = new URLSearchParams(search);
      if (symbol) params.set("name", symbol);
      else params.delete("name");
      const qs = params.toString();
      const next = qs ? `?${qs}` : "";
      if (next === search) return;
      if (symbol) pickedSearch.current = next;
      navigate({ pathname, search: next, hash }, { replace: true });
    },
    [navigate, pathname, search, hash],
  );

  // The single-name chart range lives here so the picker can sit in the
  // panel header (checklist 05 B.4); it resets with the symbol.
  const [range, setRange] = useState<CandleRange>("6M");
  useEffect(() => {
    setRange("6M");
  }, [lookupSym]);

  // Hash deep links land once their target exists: #single-name-research once
  // the panel holds its symbol (Phase 1 F.8), #markets-chart-panel once the
  // region mounts. The selection only re-arms the scroll for its own hash, so
  // opening a chart never jumps the page back to a stale hash. #single-names
  // is always on the page now (Iteration 1, M3b: no view toggle hides it).
  useHashScroll(`${navSeq}|${location.hash === `#${CHART_PANEL_ID}` ? (selected ?? "") : ""}`);

  // The hero's symbol search (Iteration 1, M3c) drives the same panel as the
  // old in-panel search: the pick lands in single-name research, which then
  // scrolls into view and takes focus (it sits below the fold at every width).
  const [jump, setJump] = useState(0);
  const openLookup = useCallback(
    (symbol: string) => {
      setLookupSym(symbol);
      setMissText(null);
      setJump((n) => n + 1);
      writeName(symbol);
    },
    [writeName],
  );
  const pickSymbol = useCallback((hit: SearchHit) => openLookup(hit.symbol), [openLookup]);
  // Enter on a search with no hits (M5): a ticker-shaped text is looked up
  // directly (the profile endpoint may know a listing the search index does
  // not, and otherwise the panel says nothing is listed under it); any other
  // text is named as a miss in the panel.
  const submitText = useCallback(
    (text: string) => {
      const sym = text.toUpperCase();
      if (SYMBOL_RE.test(sym)) {
        openLookup(sym);
        return;
      }
      setLookupSym(null);
      setMissText(text);
      setJump((n) => n + 1);
      writeName(null);
    },
    [openLookup, writeName],
  );
  const closeLookup = useCallback(() => {
    setLookupSym(null);
    writeName(null);
  }, [writeName]);
  // An unknown symbol gets a plain message in the panel and no range picker.
  const lookupProfile = useSymbolProfile(lookupSym);
  const lookupUnknown = lookupProfile.error instanceof ApiError && lookupProfile.error.kind === "unknown_symbol";
  useEffect(() => {
    if (!jump) return;
    const el = document.getElementById("single-name-research");
    el?.scrollIntoView({ block: "start" });
    el?.focus({ preventScroll: true });
  }, [jump]);

  // A mover opens its ticker the way a watchlist row does: through ?name=,
  // landing on the research panel. The symbol and the jump are also set
  // directly, so a second click on a name already in the address still lands.
  const openName = useCallback(
    (symbol: string) => {
      navigate(`/app/markets?name=${encodeURIComponent(symbol)}#single-name-research`);
      setLookupSym(symbol);
      setMissText(null);
      setJump((n) => n + 1);
    },
    [navigate],
  );

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

  // The tape's ticker buttons by symbol (filled through `registerRow`), so
  // closing the chart panel returns focus to the row that opened it and Esc
  // never drops focus to body (checklist 05 B.3).
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const registerRow = useCallback((symbol: string, el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(symbol, el);
    else rowRefs.current.delete(symbol);
  }, []);
  const closeChart = useCallback(() => {
    const target = (selected ? rowRefs.current.get(selected) : undefined) ?? rowRefs.current.values().next().value ?? null;
    setSelected(null);
    target?.focus();
  }, [selected]);
  // The hero's primary: open (never toggle) the SPY panel; the panel's own
  // effect scrolls to it and focuses it on mount.
  const openSpyChart = () => {
    if (selected === "SPY") {
      const el = document.getElementById(CHART_PANEL_ID);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
    } else {
      setSelected("SPY");
    }
  };

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

  const groupCaptions: Record<string, ReactNode> = {
    "Policy rate proxies": "Where the overnight rate actually sits: the hurdle every risk asset has to clear.",
    "Inflation breakevens": (
      <>
        Nominal minus <Jargon term="TIPS">TIPS</Jargon> yields: the market&apos;s own inflation
        forecast, no survey asked.
      </>
    ),
    "Real yields (TIPS)": "The after-inflation rate: the gravity working on gold, growth stocks, and long duration.",
  };

  // The hero's one-week bars: the 14 stored ETFs with a served ret_1w, names
  // from the registry, widest gain first. Crypto, FX and VIX have no stored
  // week, so they are absent (checklist 05 F5).
  const weekRows = useMemo(() => {
    const rows: WeekBarRow[] = [];
    for (const symbol of DB_SYMBOLS) {
      const bars = barsBySymbol.get(symbol);
      const ret = bars?.length ? bars[bars.length - 1].ret_1w : null;
      if (ret == null) continue;
      rows.push({ symbol, name: MACRO_TAPE.find((d) => d.symbol === symbol)?.name ?? symbol, ret });
    }
    return rows.sort((a, b) => b.ret - a.ret);
  }, [barsBySymbol]);

  // Which feeds actually ticked over the socket inside the live window (the
  // FeedStatusLine reading, shared with the strip's detail line).
  const liveByFeed = useMemo<LiveByFeed>(() => {
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

  /* ── the desk read: what the tape says right now, composed from the feed ── */
  const spy = quotes.get("SPY");
  const qqq = quotes.get("QQQ");
  const vixQ = quotes.get("VIX");
  // A2: the tape's VIX is the relay's delayed CBOE poll, never the FRED
  // VIXCLS close the Dashboard prints as "VIX": every place it shows says so.
  const vixWord = freshReport.series("vix_delayed").word;
  const vixText = vixQ ? `VIX ${vixQ.p.toFixed(2)} (delayed quote)` : "";
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
  const pricedDate = priced.data?.length ? priced.data.map((p) => p.date).reduce((a, b) => (a > b ? a : b)) : null;

  const sectorReads: SectorRead[] = SECTORS.map(({ symbol, name }) => {
    const bars = barsBySymbol.get(symbol);
    return { symbol, name, ret: bars?.length ? bars[bars.length - 1].ret_1d : null };
  });
  const sectorRets = sectorReads.filter((x): x is SectorRead & { ret: number } => x.ret != null);
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
    ? `US session live: ${spyWord}${qqq?.dc != null ? `, QQQ ${fmtSignedPct(qqq.dc)}` : ""}${vixQ ? `, ${vixText}` : ""}.`
    : usOpen
      ? `US session open but the stream is not ticking: ${spyWord}${vixQ ? `, ${vixText}` : ""}.`
      : status.socket !== "open" && !spy
        ? `Stream unavailable, stored closes shown: ${spyWord}${qqqWord}.`
        : // With the closing "(15-minute delayed quotes)" the VIX needs no note of its own.
          `US session closed: ${spyWord}${qqqWord}${vixQ ? `, ${spy?.delayed ? `VIX ${vixQ.p.toFixed(2)}` : vixText}` : ""}${
            spy?.delayed ? " (15-minute delayed quotes)" : ""
          }.`;
  const why = usLive
    ? "Day moves are the exchange feed's own figures. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence."
    : "Off-hours the board holds the last quote with its timestamp. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence.";
  // A3 (Iteration 1 step 6): the tape reads the server's live_quotes state
  // and the candles its market_daily state (§5 words: "Live", "Delayed 15
  // min", "Close · Sep 18", "Sep 14 · 4 sessions behind"). The weekly pricing
  // block has no series in the report: its newest stamp prints as a date,
  // grey, never judged here.
  const chips: FreshnessTag[] = [
    { noun: "Tape", label: freshReport.series("live_quotes") },
    { noun: "Stored candles", label: freshReport.series("market_daily") },
    {
      noun: "Priced",
      label: freshReport.seeded
        ? freshReport.series("market_daily")
        : stampLabel(pricedDate ? `Week ending ${monDD(pricedDate)}` : null, "The weekly pricing block's newest stamp; the freshness report does not judge this feed."),
    },
  ];

  /* ── summary rows (the desk-read ledger, re-homed) ───────────────────── */
  const dailyNote = <StateNote loading={!daily.data && !daily.isError} error={storedError} missing={MISSING.closes} />;
  const rows: SummaryRow[] = [];
  rows.push({
    id: "us10y",
    label: "US 10Y",
    value: ten ? (
      <>
        <Metric id="ust10y" value={ten.value_pct}>
          {fmtPct(ten.value_pct)}
        </Metric>
        {ten.change_1w_bps != null ? (
          <>
            {" · "}
            <span style={{ color: dirColor(ten.change_1w_bps) }}>{fmtBps(ten.change_1w_bps)}</span>
            {" 1w"}
          </>
        ) : null}
      </>
    ) : credit.isError ? (
      <StateNote error />
    ) : credit.isLoading ? (
      <StateNote loading />
    ) : (
      <StateNote />
    ),
  });
  rows.push({
    id: "sectors-1d",
    label: "Sectors · 1d",
    value:
      lead && lag ? (
        <>
          <span style={{ color: dirColor(lead.ret) }}>
            {lead.name} {fmtSignedPct(lead.ret)}
          </span>
          {" leads · "}
          <span style={{ color: dirColor(lag.ret) }}>
            {lag.name} {fmtSignedPct(lag.ret)}
          </span>
          {" lags"}
        </>
      ) : (
        dailyNote
      ),
    prose: true,
  });
  // The single names' leader and laggard (the movers read) and the stored
  // ETFs' one-week extremes (the week bars' served ret_1w); omitted with
  // nothing to read, never blank (Iteration 1, the summary's G2 fill).
  const singlesPair = moversSummary(movers);
  if (singlesPair) {
    rows.push({
      id: "singles-1d",
      label: "Single names · 1d",
      value: (
        <>
          <span style={{ color: dirColor(singlesPair.lead.change) }}>
            {singlesPair.lead.def.symbol} {fmtSignedPct(singlesPair.lead.change)}
          </span>
          {" leads · "}
          <span style={{ color: dirColor(singlesPair.lag.change) }}>
            {singlesPair.lag.def.symbol} {fmtSignedPct(singlesPair.lag.change)}
          </span>
          {" lags"}
        </>
      ),
      prose: true,
    });
  }
  if (weekRows.length >= 2) {
    const top = weekRows[0];
    const bottom = weekRows[weekRows.length - 1];
    rows.push({
      id: "etfs-1w",
      label: "ETFs · 1w",
      value: (
        <>
          <span style={{ color: dirColor(top.ret) }}>
            {top.name} {fmtSignedPct(top.ret, 1)}
          </span>
          {" leads · "}
          <span style={{ color: dirColor(bottom.ret) }}>
            {bottom.name} {fmtSignedPct(bottom.ret, 1)}
          </span>
          {" lags"}
        </>
      ),
      prose: true,
    });
  }
  // Dollar and VIX come off the tape (the spec's two added rows); with
  // nothing served they are omitted, never blank.
  const uupQ = quotes.get("UUP");
  const uupBar = barsBySymbol.get("UUP")?.slice(-1)[0];
  const uupDay = uupQ?.dc ?? uupBar?.ret_1d ?? null;
  const uupWeek = uupBar?.ret_1w ?? null;
  if (uupDay != null || uupWeek != null) {
    rows.push({
      id: "dollar",
      label: "Dollar",
      value: (
        <>
          {"UUP "}
          {uupDay != null ? (
            <>
              <span style={{ color: dirColor(uupDay) }}>{fmtSignedPct(uupDay)}</span>
              {" 1d"}
            </>
          ) : null}
          {uupDay != null && uupWeek != null ? " · " : null}
          {uupWeek != null ? (
            <>
              <span style={{ color: dirColor(uupWeek) }}>{fmtSignedPct(uupWeek, 1)}</span>
              {" 1w"}
            </>
          ) : null}
        </>
      ),
    });
  }
  if (vixQ) {
    // A2: this is the relay's delayed CBOE poll, not the FRED VIXCLS close
    // the Dashboard prints under "VIX": the label and the value say delayed.
    rows.push({
      id: "vix",
      label: "VIX · delayed",
      value: (
        <>
          <Metric id="vix-live" value={vixQ.p} title={`VIX, the relay's delayed quote (${vixWord})`}>
            {vixQ.p.toFixed(2)}
          </Metric>
          {vixQ.dc != null ? (
            <>
              {" · "}
              <span style={{ color: dirColor(vixQ.dc) }}>{fmtSignedPct(vixQ.dc)}</span>
              {" 1d"}
            </>
          ) : null}
          {` · ${vixWord}`}
        </>
      ),
    });
  }
  const t10 = pricedByMetric.get("T10YIE");
  const d10 = pricedByMetric.get("DFII10");
  rows.push({
    id: "priced",
    label: "Priced",
    value:
      t10 && d10 ? (
        `10Y breakeven ${t10.value.toFixed(2)}% · 10Y real ${d10.value.toFixed(2)}%`
      ) : priced.isError ? (
        <StateNote error />
      ) : priced.isLoading ? (
        <StateNote loading />
      ) : (
        <StateNote />
      ),
  });
  rows.push({
    id: "top-surprise",
    label: "Top surprise",
    value: surprises.data?.length ? (
      tidyProse(surprises.data[0].interpretation)
    ) : surprises.isError ? (
      <StateNote error />
    ) : surprises.isLoading ? (
      <StateNote loading />
    ) : (
      <StateNote />
    ),
    prose: true,
  });

  const strip = streamStrip(status, quotes, liveByFeed, openFreshness);

  /* ── hero ────────────────────────────────────────────────────────────── */
  const copy = marketsHero(sectorReads, marketDailyDate);
  const heroActions: TabHeroAction[] = [
    { label: "Open a chart", onClick: openSpyChart, primary: true },
    { label: "See what's priced", to: "/app/markets#whats-priced-full" },
  ];
  // The symbol search in the action row (M3c): visible without scrolling at
  // 1280 px and up. The hero lets its result list overflow its box (the list
  // is absolutely placed under the field); the glow still clips at the
  // rounded corners, where it is already transparent.
  const heroSearch = (
    <div className="mrr-mkt-hero-search">
      <SymbolSearch onSelect={pickSymbol} onSubmitText={submitText} />
    </div>
  );
  let hero: ReactNode;
  if (copy.headline) {
    hero = (
      <TabHero
        id="markets-hero"
        eyebrow="Market read"
        live={usLive}
        headline={copy.headline}
        pill={
          <span title={`One-day moves of XLF, XLE, XLI, XLK at the ${marketDailyDate ? fmtDate(marketDailyDate) : "latest stored"} close`}>
            {copy.pill}
          </span>
        }
        pillTone={copy.pillTone}
        glow={copy.glow}
        subhead={conclusion}
        lede={why}
        actions={heroActions}
        actionsAfter={heroSearch}
        style={HERO_STYLE}
        freshness={chips}
        stamp={<Stamp source={SRC.closes} label={freshReport.series("market_daily")} />}
        note={copy.basis}
        chart={weekRows.length ? <WeekBars rows={weekRows} /> : undefined}
        placeholder
      />
    );
  } else if (daily.isError && !daily.data) {
    // Only when there is nothing to read: with snapshot data on screen the
    // shell's status word already says the service is asleep.
    hero = (
      <TabHero
        id="markets-hero"
        eyebrow="Market read"
        live={usLive}
        headline={
          <span style={stateHeadline}>
            {/* CP4: what is missing and why; the second sentence only while the stream is up. */}
            {missingNote(MISSING.closes, snapshot)}
            {status.socket === "open" ? " The tape keeps its live quotes." : ""}
          </span>
        }
        pill="Unavailable"
        pillTone="gray"
        glow={MARKETS_GLOW.gray}
        subhead={conclusion}
        lede={why}
        actions={heroActions}
        actionsAfter={heroSearch}
        style={HERO_STYLE}
        freshness={chips}
        stamp={<Stamp source={SRC.closes} label={freshReport.series("market_daily")} />}
        placeholder
      />
    );
  } else {
    hero = (
      <TabHero
        id="markets-hero"
        eyebrow="Market read"
        live={usLive}
        headline={<span style={stateHeadline}>{daily.data ? "No sector closes on file yet." : "Reading the tape…"}</span>}
        glow={MARKETS_GLOW.gray}
        subhead={conclusion}
        lede={why}
        actions={heroActions}
        actionsAfter={heroSearch}
        style={HERO_STYLE}
        freshness={chips}
        stamp={<Stamp source={SRC.closes} label={freshReport.series("market_daily")} />}
        placeholder
      />
    );
  }

  return (
    <div className="mrr-mkt">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard
          id="markets-summary"
          as="h2"
          title="Cross-asset summary"
          rows={rows}
          status={strip}
          stamp={
            // A1: the rows read three sources; each carries its §5 word.
            <span style={{ display: "inline-flex", flexWrap: "wrap", columnGap: 12 }}>
              <Stamp source={SRC.closes} label={freshReport.series("market_daily")} />
              <Stamp source={SRC.eodhd} label={freshReport.series("live_quotes")} />
              <Stamp source={SRC.fred} label={freshReport.series("DGS10", credit.data?.freshness)} />
            </span>
          }
        />
      </div>

      {/* ── Chart panel region (row click), full width while open ───── */}
      {selectedDef ? (
        <Suspense
          fallback={
            <Card variant="panel" style={{ minWidth: 0 }}>
              <StateNote loading>Loading the chart module…</StateNote>
            </Card>
          }
        >
          <ChartPanel
            symbol={selectedDef.symbol}
            name={selectedDef.name}
            hasHistory={DB_SYMBOLS.has(selectedDef.symbol)}
            onClose={closeChart}
          />
        </Suspense>
      ) : null}

      {/* ── Macro tape, full row width (Iteration 2, F2) ─────────────
          It read nine columns into the 432px summary rail, so the well was
          368px against 764px of table and the Day, week, month, sparkline
          and as-of columns all sat outside it - Max saw "+4" and "-0.0"
          where a day change belonged. Full width, the eight desk columns
          fit whole from 1280px up with no scroll inside the panel; the
          narrower bands drop the least important column deliberately and
          say so. This supersedes the "the well scrolls the nine columns
          inside the card" note the panel used to carry. ───────────────── */}
      <MacroTape
        quotes={quotes}
        barsBySymbol={barsBySymbol}
        singles={singlesSorted}
        selected={selected}
        onSelect={toggleSelect}
        registerRow={registerRow}
        live={usLive}
        storedThrough={marketDailyDate}
        storedError={storedError}
      />

      {/* ── Body: the panel stack, full width under the tape ─────────── */}
      <div className="mrr-mkt-body">
        <div className="mrr-mkt-stack">
          {/* Single-name research: the hero's search, a mover, a watchlist row
              or ?name= fills it. tabIndex -1: a search pick moves focus here. */}
          <Card as="section" variant="panel" id="single-name-research" tabIndex={-1} style={{ minWidth: 0 }}>
            <SectionHeader
              layout="panel"
              title="Single-name research"
              description="Daily candles with volume"
              actions={
                lookupSym && !lookupUnknown ? (
                  <Segmented
                    mono
                    label="Chart range"
                    options={RANGES.map((r) => ({ id: r, label: r }))}
                    value={range}
                    onChange={(id) => setRange(id as CandleRange)}
                  />
                ) : undefined
              }
            />
            {/* The provider meta (M6) sits under the header on its own line. */}
            <div style={{ ...metaStyle, margin: "-6px 0 12px" }}>
              any listed symbol · EODHD quotes and history · Finnhub fundamentals · delayed
            </div>
            {lookupSym ? (
              <SingleName symbol={lookupSym} range={range} onRangeChange={setRange} onClose={closeLookup} />
            ) : missText ? (
              <p role="status" style={{ margin: 0, fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text)" }}>
                No listed symbol matches &ldquo;{missText}&rdquo;. Try a ticker (NVDA, BRK.B) or a company name from the search list.
              </p>
            ) : (
              <Caption style={{ marginTop: 0 }}>
                Search a ticker or company name in the market read above, or open a mover below, for a full profile: delayed
                quote, candles across seven ranges, fundamentals, regime fit since 1996, and the stored news window.
              </Caption>
            )}
          </Card>

          <SectorHeatmap
            barsBySymbol={barsBySymbol}
            marketDailyDate={marketDailyDate}
            status={storedError ? "error" : daily.data ? "ready" : "loading"}
          />

          <Movers read={movers} onOpen={openName} />

          <TopSurprises surprises={surprises} surpriseWeek={surpriseWeek} />
        </div>
      </div>

      {/* ── What's priced (single home; the Dashboard links here) ───── */}
      <WhatsPriced priced={priced} pricedGroups={pricedGroups} groupCaptions={groupCaptions} beTermNote={beTermNote} />

      {/* ── source line ──────────────────────────────────────────────── */}
      <DisclosureLine>
        Live prices via EODHD WebSocket (crypto &amp; FX stream around the clock, US equities during NYSE hours, 15-min-delayed
        quotes fill the gaps) · stored candles and returns via the yfinance pipeline · macro metrics via FRED.
      </DisclosureLine>
    </div>
  );
}
