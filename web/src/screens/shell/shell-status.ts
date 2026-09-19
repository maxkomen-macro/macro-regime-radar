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
 *
 * Iteration 1 step 6 (A3): every freshness word the card, the drawer and
 * the footer print is a §5 word from /api/freshness `series[]` through
 * fresh-state.ts. The status word above (Live / Delayed / Reconnecting /
 * Backend unavailable / Validated snapshot) is the connection state and
 * stays; no stamp is aged in the browser any more.
 */

import type { Alert, Freshness, Regime, RegimeFreshness, SeriesState } from "../../api/types";
import type { SnapshotMeta } from "../../api/snapshot";
import type { LiveFeeds, LiveQuote, StreamWord } from "../../live/quotes";
import { daysSince, fmtDate, fmtIntradayTs, fmtMonYr, fmtUtcStampEt } from "../../lib/format";
import {
  REGIME_INPUT_IDS,
  freshLabel,
  groupLabel,
  lookupFrom,
  marketSeries,
  seededLabel,
  seriesById,
  storedCloseLine,
  storedCloseShort,
  type FreshLabel,
} from "../shared/fresh-state";

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
  text4: "var(--text-4)",
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

/**
 * Sidebar footer word under the dot. The connection states keep their words;
 * otherwise "Live market data" only when `live_quotes` reads live (§5), else
 * "Delayed market data" when it reads delayed, else "Stored market data"
 * with the §5 word as the stamp beneath it (the relay's ticking crypto and
 * FX feeds are named in the drawer, never as the US tape).
 */
export function footerWords(statusWord: ShellStatusWord, liveFeeds: LiveFeeds, market?: FreshLabel | null): string {
  switch (statusWord) {
    case "Reconnecting":
      return "Reconnecting to feeds";
    case "Backend unavailable":
      return "Data service unavailable";
    case "Validated snapshot":
      return "Validated snapshot";
    default:
      break;
  }
  if (market?.tone === "live") return liveFeeds.us ? "Live market data" : `Live market data · ${liveFeedsWord(liveFeeds)} only`;
  if (market?.tone === "delayed") return "Delayed market data";
  return "Stored market data";
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

/** Dot colour for a §5 tone (the strip card's two lines): only live is
 * mint, only delayed amber; unknown is grey, never a health colour. */
export function toneDotColor(label: FreshLabel): string {
  switch (label.tone) {
    case "live":
      return STATUS_COLOR.mint;
    case "delayed":
      return STATUS_COLOR.amber;
    case "stale":
      return STATUS_COLOR.hot;
    case "neutral":
      return STATUS_COLOR.text3;
    default:
      return STATUS_COLOR.text4;
  }
}

/** "Sep 14 · 4 sessions behind", "Sep 17 · 1 day behind": the word and its
 * muted tail as one string, for titles and one-line slots. */
export function labelText(l: FreshLabel): string {
  return l.muted ? `${l.word} ${l.muted}` : l.word;
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

/** The series[] id an `sla` feed key describes, or null (regime, signals
 * and news have no per-series state). */
export function feedSeriesId(feed: string): string | null {
  if (feed.startsWith("fred:")) return feed.slice(5);
  if (feed === "market_daily" || feed === "market_intraday" || feed === "live_quotes" || feed === "vix_delayed") return feed;
  return null;
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
  /** The report on hand is the seeded snapshot (useFreshReport.ts). */
  seeded?: boolean;
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
  /** The report is a seeded snapshot: every word reads "Snapshot · as of". */
  seeded: boolean;
  /** "Snapshot · as of Sep 10" when seeded, else null. */
  seededLabel: FreshLabel | null;
  /** The market chip (§5): live_quotes during the session, else the stored close. */
  marketLabel: FreshLabel;
  dailyLabel: FreshLabel;
  intradayLabel: FreshLabel;
  liveLabel: FreshLabel;
  /** The regime's monthly inputs, the weakest one's word. */
  macroLabel: FreshLabel;
  /** Per-series states in served order (the drawer's table). */
  series: SeriesState[];
  /** The A3 plain line when the stored close is behind the bell, else null. */
  storedCloseLine: string | null;
  storedCloseShort: string | null;
  blockerNote: string | null;
  /** The footer dot glows only when live_quotes reads live. */
  dotLive: boolean;
  streamLive: boolean;
  liveFeeds: LiveFeeds;
}

/** Everything the card, the drawer and the footer print, from one place. */
export function composeShellStatus(input: ShellStatusInput): ShellStatus {
  const { freshness: f, freshnessError, freshnessLoading, regimeError, streamWord, streamLive, liveFeeds, degraded, degradedReasons, snapshot } = input;
  const seeded = Boolean(input.seeded || f?.seeded);
  const backendDown = freshnessError && regimeError;
  const statusWord = resolveStatusWord({ backendDown, snapshot: Boolean(snapshot), streamWord, hasFreshness: Boolean(f) });
  const degradedWord = degraded ? degradedReason(degradedReasons) : null;
  const suffix = liveSuffix({ statusWord, liveFeeds, degradedWord, sessionOpen: f?.session ? f.session.is_open : null });
  const snapshotGeneratedAt = snapshot?.generated_at ?? null;
  const snap = seeded ? seededLabel(f?.generated_at ?? snapshotGeneratedAt) : null;
  const pick = (l: FreshLabel): FreshLabel => snap ?? l;
  const inputs = f?.regime?.inputs?.length ? f.regime.inputs.map((i) => i.series) : REGIME_INPUT_IDS;
  const marketLabel = pick(freshLabel(marketSeries(f)));
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
    seeded,
    seededLabel: snap,
    marketLabel,
    dailyLabel: pick(freshLabel(seriesById(f, "market_daily"))),
    intradayLabel: pick(freshLabel(seriesById(f, "market_intraday"))),
    liveLabel: pick(freshLabel(seriesById(f, "live_quotes"))),
    macroLabel: snap ?? (f ? groupLabel(lookupFrom(f), inputs) : freshLabel(null)),
    series: f?.series ?? [],
    // A seeded report's states are all unknown: no line until the live one.
    storedCloseLine: seeded ? null : storedCloseLine(f),
    storedCloseShort: seeded ? null : storedCloseShort(f),
    blockerNote: blockerNote(f?.regime),
    dotLive: !seeded && marketLabel.tone === "live",
    streamLive,
    liveFeeds,
  };
}

/* ── Alert feed ──────────────────────────────────────────────────────────── */

export type AlertState = "loading" | "error" | "recent" | "clear" | "none";

/** What `useAlerts()` returns, structurally; a query result is assignable. */
export interface AlertFeed {
  data: Alert[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

export interface AlertSummary {
  /** loading / error while the feed is pending or failed; recent when a
   * breach is under 7 days old; clear when only older alerts exist; none
   * when the feed is empty. */
  state: AlertState;
  /** Alerts dated within the last 7 days, in served order (newest first). */
  recent: Alert[];
  /** The newest alert on file, whatever its age. */
  last: Alert | undefined;
  /** The bell's whole sentence, also the Dashboard strip's accessible name. */
  sentence: string;
}

/** Days an alert counts as recent for the bell badge and the status strip. */
export const ALERT_RECENT_DAYS = 7;

/**
 * One reading of the alert feed for the bell (TopBar) and the Dashboard's
 * status strip, so the two never speak different sentences. It never asserts
 * "no alerts" before the feed has answered (the 2026-09-05 rule).
 */
export function alertSummary(alerts: AlertFeed): AlertSummary {
  const rows = alerts.data ?? [];
  const recent = rows.filter((a) => daysSince(a.date) <= ALERT_RECENT_DAYS);
  const last = rows[0];
  if (alerts.isError) return { state: "error", recent, last, sentence: "Alert feed unavailable. Open the alert feed." };
  if (alerts.isLoading) return { state: "loading", recent, last, sentence: "Reading the alert feed. Open the alert feed." };
  if (recent.length) {
    return {
      state: "recent",
      recent,
      last,
      sentence: `${recent.length} threshold breach${recent.length === 1 ? "" : "es"} in the last 7 days. Open the alert feed.`,
    };
  }
  if (last) {
    return {
      state: "clear",
      recent,
      last,
      sentence: `No threshold breaches in the last 7 days. Last alert ${fmtDate(last.date)}. Open the alert feed.`,
    };
  }
  return { state: "none", recent, last, sentence: "No alerts on file. Open the alert feed." };
}
