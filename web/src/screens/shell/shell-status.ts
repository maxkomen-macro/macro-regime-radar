/**
 * Shell status helpers (redesign Phase 1). Pure functions lifted out of
 * AppShell.tsx so the three surfaces that describe data freshness, the
 * freshness card in the strip, the freshness drawer and the sidebar footer,
 * compose their words from one truth. Nothing here touches React or the DOM.
 *
 * The status word is the one the 2026-09-06 shell already spoke: the API
 * answering is the primary signal, the relay socket refines it, and when the
 * API is silent while the page runs on the validated snapshot it says exactly
 * that. "Live" is never claimed for the US tape when only crypto or FX tick.
 */

import type { Freshness, Regime, RegimeFreshness } from "../../api/types";
import type { SnapshotMeta } from "../../api/snapshot";
import type { LiveFeeds, LiveQuote, StreamWord } from "../../live/quotes";
import { daysSince, fmtDate, fmtIntradayTs, fmtMonYr, fmtUtcStampEt } from "../../lib/format";
import { assessFreshness, type FreshInfo, type FreshState } from "../shared/freshness";

export type ShellStatusWord = StreamWord | "Validated snapshot";

/** House glyph per status word, so the state never rides on colour alone. */
export const STATUS_GLYPH: Record<string, string> = {
  Live: "●",
  Delayed: "▪",
  Reconnecting: "↻",
  "Backend unavailable": "×",
  Off: "▪",
  "Validated snapshot": "◆",
};

/** Colour tokens the shell uses for status. New names resolve through the
 * Phase 1 token layer; the fallbacks keep the shell readable if a token is
 * missing during the transition. */
export const STATUS_COLOR = {
  mint: "var(--mint, #26dca0)",
  amber: "var(--amber, #f5b52e)",
  neg: "var(--neg, #f0503f)",
  hot: "var(--warn-hot, #e67e22)",
  text3: "var(--text-3, var(--text-muted))",
  text4: "var(--text-4, var(--text-faint))",
} as const;

export const SNAPSHOT_NOTE =
  "The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own.";

/** Relay degradation in reader words; the raw reasons stay in /api/stream/debug. */
export function degradedReason(reasons: string[]): string | null {
  const text = reasons.join(" ").toLowerCase();
  if (!text) return null;
  if (text.includes("rejected the token")) return "US equity feed rejected by the provider";
  if (text.includes("not configured")) return "live feeds off";
  if (text.includes("silent")) return "US equity feed silent";
  if (text.includes("closed during") || text.includes("connecting during")) return "US equity feed reconnecting";
  if (text.includes("vix")) return "VIX poll failing";
  return "a feed is degraded";
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The one status word. `backendDown` is "freshness and regime both errored";
 * `hasFreshness` is "a freshness report is on hand" (live or snapshot-seeded).
 */
export function resolveStatusWord(args: {
  backendDown: boolean;
  snapshot: boolean;
  streamWord: StreamWord;
  hasFreshness: boolean;
}): ShellStatusWord {
  const { backendDown, snapshot, streamWord, hasFreshness } = args;
  if (backendDown) return snapshot ? "Validated snapshot" : "Backend unavailable";
  if (streamWord === "Backend unavailable" && hasFreshness) return "Delayed";
  if (streamWord === "Off") return "Delayed";
  return streamWord;
}

/** Colour for the status word: mint live, amber delayed or snapshot, muted
 * while reconnecting, red when the service is gone. */
export function statusColor(word: ShellStatusWord): string {
  if (word === "Live") return STATUS_COLOR.mint;
  if (word === "Delayed" || word === "Validated snapshot" || word === "Off") return STATUS_COLOR.amber;
  if (word === "Reconnecting") return STATUS_COLOR.text3;
  return STATUS_COLOR.neg;
}

export function statusTitle(word: ShellStatusWord, snapshotGeneratedAt?: string | null): string {
  switch (word) {
    case "Live":
      return "EODHD stream is ticking on the tape";
    case "Delayed":
    case "Off":
      return "Quotes are delayed REST rows or the last close; stored data is current";
    case "Reconnecting":
      return "The live relay dropped; the browser is retrying with backoff";
    case "Validated snapshot":
      return `The data service is not answering; every number on screen comes from the validated snapshot built ${snapshotGeneratedAt ?? ""}`;
    default:
      return "The data service is not answering";
  }
}

/** "crypto/FX", "crypto", "FX": the feeds that are actually ticking. */
export function liveFeedsWord(feeds: LiveFeeds): string {
  const names = [feeds.crypto ? "crypto" : null, feeds.forex ? "FX" : null].filter(Boolean);
  return names.length ? names.join("/") : "crypto/FX";
}

/**
 * "Live" names its feeds when the US tape is quiet: crypto and FX tick
 * through the weekend, and a reader must never take that for US equities.
 * A degraded relay says why in reader words, never a machine state.
 */
export function liveSuffix(args: {
  statusWord: ShellStatusWord;
  liveFeeds: LiveFeeds;
  degradedWord: string | null;
  /** `session.is_open` from the freshness report, null when unknown. */
  sessionOpen: boolean | null;
}): string {
  const { statusWord, liveFeeds, degradedWord, sessionOpen } = args;
  if (statusWord === "Live" && !liveFeeds.us) {
    const tail = degradedWord ? ` · ${degradedWord}` : sessionOpen === false ? " · US session closed" : "";
    return ` · ${liveFeedsWord(liveFeeds)} only${tail}`;
  }
  if ((statusWord === "Live" || statusWord === "Delayed") && degradedWord) return ` · ${degradedWord}`;
  return "";
}

/** "not yet published" / "published, not yet stored" / "no observations stored". */
export function blockerCause(cause: string): string {
  if (cause === "publication calendar") return "not yet published";
  if (/no observation|no data|never/i.test(cause)) return "no observations stored";
  return "published, not yet stored";
}

/**
 * Blockers from the server-side freshness report replace the generic
 * "one cycle late" phrasing when they exist: the reader learns which input
 * holds the regime month back and why.
 */
export function blockerNote(regime: RegimeFreshness | null | undefined): string | null {
  if (!regime?.blockers?.length) return null;
  return `Regime month ${regime.latest_month ? fmtMonYr(regime.latest_month) : "—"} waits on ${listWords(
    regime.blockers.map((b) => `${b.label} (${b.cause === "publication calendar" ? "not yet published" : "published, not yet stored"})`),
  )}.`;
}

/** Sidebar footer word under the live dot. */
export function footerWords(statusWord: ShellStatusWord, liveFeeds: LiveFeeds): string {
  switch (statusWord) {
    case "Live":
      return liveFeeds.us ? "Live market data" : `Live market data · ${liveFeedsWord(liveFeeds)} only`;
    case "Delayed":
    case "Off":
      return "Delayed market data";
    case "Reconnecting":
      return "Reconnecting to feeds";
    case "Backend unavailable":
      return "Data service unavailable";
    case "Validated snapshot":
      return "Validated snapshot";
    default:
      return statusWord;
  }
}

/** A fresh DB intraday write: under 20 minutes old (existing dot rule). */
export function intradayIsFresh(ts: string | null | undefined): boolean {
  if (!ts) return false;
  return daysSince(ts) * 24 * 60 < 20;
}

/** Epoch ms of the newest websocket tick on the board, null when none. */
export function newestTickMs(quotes: ReadonlyMap<string, LiveQuote>): number | null {
  let newest: number | null = null;
  for (const q of quotes.values()) {
    if (q.src !== "ws" || q.t == null) continue;
    if (newest == null || q.t > newest) newest = q.t;
  }
  return newest;
}

const ET_DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "2-digit", year: "numeric" });

/** ["Sep 09, 2026", "15:55 ET"] for an epoch tick, in New York time. */
export function etStampLines(ms: number): [string, string] {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return ["—", ""];
  const stamp = fmtUtcStampEt(d.toISOString()); // "Sep 09, 15:55 ET"
  const time = stamp.slice(stamp.indexOf(", ") + 2);
  return [ET_DATE.format(d), time];
}

/** "15:55 ET" for an epoch tick. */
export function etClock(ms: number): string {
  return etStampLines(ms)[1];
}

/**
 * The stamp the footer prints under the status word, two lines: the newest
 * websocket tick, else the stored intraday bar, else the stored close (dated
 * so nobody reads it as live), else a dash.
 */
export function marketStampLines(args: {
  tickMs: number | null;
  intradayTs: string | null | undefined;
  dailyDate: string | null | undefined;
}): [string, string] {
  const { tickMs, intradayTs, dailyDate } = args;
  if (tickMs != null) return etStampLines(tickMs);
  if (intradayTs) {
    const stamp = fmtIntradayTs(intradayTs); // "Sep 05, 15:55 ET"
    const comma = stamp.indexOf(", ");
    return [fmtDate(intradayTs), comma >= 0 ? stamp.slice(comma + 2) : ""];
  }
  if (dailyDate) return [fmtDate(dailyDate), "close"];
  return ["—", ""];
}

/** One-line market stamp for the freshness card: the stored intraday bar,
 * else the stored close. */
export function marketStamp(f: Freshness | undefined): string {
  if (f?.market_intraday_ts) return fmtIntradayTs(f.market_intraday_ts);
  if (f?.market_daily_date) return `${fmtDate(f.market_daily_date)} close`;
  return "—";
}

/** Dot colour for a freshness state on the card: current mint, delayed amber,
 * stale hot, unavailable red. */
export function freshDotColor(state: FreshState): string {
  switch (state) {
    case "current":
      return STATUS_COLOR.mint;
    case "delayed":
      return STATUS_COLOR.amber;
    case "stale":
      return STATUS_COLOR.hot;
    case "unavailable":
      return STATUS_COLOR.neg;
    default:
      return STATUS_COLOR.text3;
  }
}

/* ── Freshness drawer vocabulary ─────────────────────────────────────────── */

const FEED_LABELS: Record<string, string> = {
  market_daily: "Stored daily closes",
  market_intraday: "Intraday bars (SPY, QQQ)",
  news: "News feed",
  regime: "Regime classifier",
  signals: "Monitored signals",
  live_quotes: "Live quotes (EODHD)",
  vix_delayed: "VIX (delayed poll)",
};

/** Reader label for an `sla` feed key; FRED series carry their input label. */
export function feedLabel(feed: string, regime?: RegimeFreshness | null): string {
  if (FEED_LABELS[feed]) return FEED_LABELS[feed];
  if (feed.startsWith("fred:")) {
    const id = feed.slice(5);
    const input = regime?.inputs?.find((i) => i.series === id);
    return input ? `FRED ${id} · ${input.label}` : `FRED ${id}`;
  }
  return feed;
}

function isMonthlyFeed(feed: string, regime?: RegimeFreshness | null): boolean {
  if (feed === "regime" || feed === "signals") return true;
  if (feed.startsWith("fred:")) {
    const id = feed.slice(5);
    return Boolean(regime?.inputs?.some((i) => i.series === id));
  }
  return false;
}

/** Format an `sla` stamp by the cadence its feed carries: months for the
 * monthly feeds, dates for daily ones, ET wall time for the pipeline's
 * intraday stamp, UTC-to-ET for everything else. */
export function fmtFeedStamp(feed: string, value: string | null | undefined, regime?: RegimeFreshness | null): string {
  if (!value) return "—";
  if (isMonthlyFeed(feed, regime)) return fmtMonYr(value);
  if (feed === "market_intraday") return value.length > 10 ? fmtIntradayTs(value) : fmtDate(value);
  if (value.length === 7) return fmtMonYr(value);
  if (value.length <= 10) return fmtDate(value);
  return fmtUtcStampEt(value);
}

export function sessionPhaseWord(phase: string): string {
  switch (phase) {
    case "pre":
      return "pre-market";
    case "open":
      return "open";
    case "post":
      return "after hours";
    case "weekend":
      return "weekend";
    case "holiday":
      return "holiday";
    default:
      return phase;
  }
}

/** Relay feed states in reader words. */
export function feedStateWord(state: string): string {
  switch (state) {
    case "open":
      return "open";
    case "connecting":
      return "connecting";
    case "closed":
      return "closed";
    case "auth_failed":
      return "rejected by the provider";
    case "rest":
      return "delayed poll";
    case "off":
      return "off";
    default:
      return state;
  }
}

/** Bytes to "10.4 MB". */
export function dbSizeMb(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/* ── Regime pill ─────────────────────────────────────────────────────────── */

export interface RegimeProbs {
  goldilocks: number;
  overheating: number;
  stagflation: number;
  recession: number;
}

/** The four stored probabilities and the dominant one. The pill shows the
 * model's stored dominant probability (one number, one truth), never the
 * separate `confidence` heuristic. */
export function regimeProbs(regime: Regime | undefined): { probs: RegimeProbs | undefined; dominantProb: number | undefined } {
  if (!regime) return { probs: undefined, dominantProb: undefined };
  const probs = {
    goldilocks: regime.prob_goldilocks ?? 0,
    overheating: regime.prob_overheating ?? 0,
    stagflation: regime.prob_stagflation ?? 0,
    recession: regime.prob_recession ?? 0,
  };
  return { probs, dominantProb: Math.max(...Object.values(probs)) };
}

/* ── Composition ─────────────────────────────────────────────────────────── */

export interface ShellStatusInput {
  freshness: Freshness | undefined;
  freshnessError: boolean;
  freshnessLoading: boolean;
  regimeError: boolean;
  streamWord: StreamWord;
  streamLive: boolean;
  liveFeeds: LiveFeeds;
  degraded: boolean;
  degradedReasons: string[];
  snapshot: SnapshotMeta | null;
}

export interface ShellStatus {
  f: Freshness | undefined;
  freshnessError: boolean;
  freshnessLoading: boolean;
  backendDown: boolean;
  statusWord: ShellStatusWord;
  statusColor: string;
  statusTitle: string;
  degradedWord: string | null;
  liveSuffix: string;
  /** " · Sep 05, 2026" after the word when running on the snapshot. */
  snapshotDate: string;
  snapshotNote: string | null;
  snapshotGeneratedAt: string | null;
  macroFresh: FreshInfo;
  signalsFresh: FreshInfo;
  marketFresh: FreshInfo;
  intradayFreshInfo: FreshInfo;
  /** Signals ride the same monthly stamp as the regime; print them only when they differ. */
  signalsDiffer: boolean;
  blockerNote: string | null;
  intradayFresh: boolean;
  /** The dot pulses only when data is genuinely live. */
  dotLive: boolean;
  streamLive: boolean;
  liveFeeds: LiveFeeds;
}

/** Everything the card, the drawer and the footer print, from one place. */
export function composeShellStatus(input: ShellStatusInput): ShellStatus {
  const { freshness: f, freshnessError, freshnessLoading, regimeError, streamWord, streamLive, liveFeeds, degraded, degradedReasons, snapshot } = input;
  const backendDown = freshnessError && regimeError;
  const statusWord = resolveStatusWord({ backendDown, snapshot: Boolean(snapshot), streamWord, hasFreshness: Boolean(f) });
  const degradedWord = degraded ? degradedReason(degradedReasons) : null;
  const suffix = liveSuffix({ statusWord, liveFeeds, degradedWord, sessionOpen: f?.session ? f.session.is_open : null });
  const macroFresh = assessFreshness(f?.regimes_date, "monthly");
  const signalsFresh = assessFreshness(f?.signals_date, "monthly");
  const marketFresh = assessFreshness(f?.market_daily_date, "daily");
  const intradayFreshInfo = assessFreshness(f?.market_intraday_ts, "intraday");
  const signalsDiffer = Boolean(f?.signals_date && f?.regimes_date && f.signals_date.slice(0, 7) !== f.regimes_date.slice(0, 7));
  const intradayFresh = intradayIsFresh(f?.market_intraday_ts);
  const snapshotGeneratedAt = snapshot?.generated_at ?? null;
  return {
    f,
    freshnessError,
    freshnessLoading,
    backendDown,
    statusWord,
    statusColor: statusColor(statusWord),
    statusTitle: statusTitle(statusWord, snapshotGeneratedAt),
    degradedWord,
    liveSuffix: suffix,
    snapshotDate: statusWord === "Validated snapshot" && snapshotGeneratedAt ? ` · ${fmtDate(snapshotGeneratedAt)}` : "",
    snapshotNote: statusWord === "Validated snapshot" ? SNAPSHOT_NOTE : null,
    snapshotGeneratedAt,
    macroFresh,
    signalsFresh,
    marketFresh,
    intradayFreshInfo,
    signalsDiffer,
    blockerNote: blockerNote(f?.regime),
    intradayFresh,
    dotLive: streamLive || intradayFresh,
    streamLive,
    liveFeeds,
  };
}
