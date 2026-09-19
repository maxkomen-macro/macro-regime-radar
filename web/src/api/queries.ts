/**
 * TanStack Query hooks — one per API endpoint the shell and screens read.
 * Server state lives here exclusively; nothing about the domain belongs in
 * client state (handoff → State).
 *
 * Poll cadences mirror the Streamlit behavior: intraday 30s (the old
 * `st.fragment(run_every=30)`), freshness 60s, everything else on-load with a
 * long stale time (regimes/signals are monthly-cadence data).
 */

import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { ApiError, getJson, postJson } from "./client";
import type {
  Alert,
  AllocationData,
  Analogue,
  BacktestRow,
  CalendarEvent,
  CandleRange,
  CreditMetrics,
  CreditOAS,
  DailyBar,
  Freshness,
  IntradayPoint,
  LboRequest,
  LboResponse,
  LboDefaults,
  NewsItem,
  PricedMetric,
  Regime,
  RegimeDuration,
  SearchResponse,
  SymbolProfile,
  CandleSeries,
  CorporateActions,
  OptionsChain,
  OptionsExpirations,
  ProvidersStatus,
  StreamDebug,
  RegimePlaybook,
  RecessionMetrics,
  RecessionScenarioRequest,
  RecessionScenarioResult,
  ScenarioDef,
  ScenarioResult,
  ScenarioShocks,
  SignalsSnapshot,
  Surprise,
  Takeaway,
  TransitionOutlook,
} from "./types";

const MINUTE = 60_000;

export function useRegimeLatest() {
  return useQuery({
    queryKey: ["regime", "latest"],
    queryFn: () => getJson<Regime>("/api/regime/latest"),
    staleTime: 5 * MINUTE,
  });
}

export function useRegimeHistory(limit?: number) {
  return useQuery({
    queryKey: ["regime", "history", limit ?? "all"],
    queryFn: () => getJson<Regime[]>("/api/regime/history", { limit }),
    staleTime: 30 * MINUTE,
  });
}

export function useSignalsLatest() {
  return useQuery({
    queryKey: ["signals", "latest"],
    queryFn: () => getJson<SignalsSnapshot>("/api/signals/latest"),
    staleTime: 5 * MINUTE,
  });
}

export function useAlerts(limit = 200) {
  return useQuery({
    queryKey: ["alerts", limit],
    queryFn: () => getJson<Alert[]>("/api/alerts", { limit }),
    staleTime: 5 * MINUTE,
  });
}

/**
 * `refetchMs` opts one caller into polling (the News feed re-reads the store
 * every 60s). Omit it and the hook behaves exactly as before: fetch on load,
 * 5-minute stale time, no timer. Polling only re-reads what the hourly news
 * pipeline has already scored and stored; it does not fetch wires.
 */
export function useNews(
  hours = 168,
  minSignificance?: number,
  limit = 150,
  category?: string,
  refetchMs?: number,
) {
  return useQuery({
    queryKey: ["news", hours, minSignificance ?? "any", limit, category ?? "all"],
    queryFn: () =>
      getJson<NewsItem[]>("/api/news", {
        hours,
        min_significance: minSignificance,
        limit,
        category,
      }),
    // undefined = no poll, the same idiom useSymbolCandles uses.
    refetchInterval: refetchMs,
    staleTime: refetchMs ? 30_000 : 5 * MINUTE,
  });
}

export function useMarketDaily(symbols?: string[], days = 120) {
  return useQuery({
    queryKey: ["market", "daily", symbols?.join(",") ?? "default", days],
    queryFn: () =>
      getJson<DailyBar[]>("/api/market/daily", {
        symbols: symbols?.join(","),
        days,
      }),
    staleTime: 15 * MINUTE,
    // [] means "this caller has nothing to fetch" (e.g. a no-history chart
    // panel) — undefined still means the server-default watchlist.
    enabled: symbols == null || symbols.length > 0,
  });
}

/**
 * Intraday polling — 30s cadence, matching the Streamlit fragment.
 *
 * The EODHD live layer landed 2026-08-06 as a SEPARATE store
 * (web/src/live/quotes.ts → api/stream.py relay), not as writes into this
 * query cache — a poll refetch would clobber fresher socket ticks with staler
 * DB rows, so the two transports stay side by side and consumers prefer the
 * live quote when one is on the board (see TickerLive). This poll remains the
 * fallback and the source for stored 5-minute history.
 */
export function useMarketIntraday(symbols: string[] = ["SPY", "QQQ"], sinceHours = 48) {
  return useQuery({
    queryKey: ["market", "intraday", symbols.join(","), sinceHours],
    queryFn: () => {
      const since = new Date(Date.now() - sinceHours * 3_600_000)
        .toISOString()
        .replace(/\.\d{3}Z$/, "Z");
      return getJson<IntradayPoint[]>("/api/market/intraday", {
        symbols: symbols.join(","),
        since,
      });
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    // No symbols → no poll (a no-history chart panel was firing this every
    // 30s with symbols="" — critique 2026-08-06).
    enabled: symbols.length > 0,
  });
}

/** What's Priced — policy proxies, breakevens, real yields (weekly pipeline). */
export function usePriced() {
  return useQuery({
    queryKey: ["priced"],
    queryFn: () => getJson<PricedMetric[]>("/api/priced"),
    staleTime: 30 * MINUTE,
  });
}

/** Top-|z| weekly surprises with the shared desk-note interpretation. */
export function useSurprises(topN = 10) {
  return useQuery({
    queryKey: ["surprises", topN],
    queryFn: () => getJson<Surprise[]>("/api/surprises", { top_n: topN }),
    staleTime: 30 * MINUTE,
  });
}

export function useCalendar(days = 30) {
  return useQuery({
    queryKey: ["calendar", days],
    queryFn: () => getJson<CalendarEvent[]>("/api/calendar", { days }),
    staleTime: 30 * MINUTE,
  });
}

/** The same window with the large-cap earnings rows included (B5,
 * `?include=earnings`). Only the News hero timeline reads it, and only its
 * `kind === "earnings"` rows: the macro rows keep coming from `useCalendar`,
 * which the validated snapshot carries. No retry: the timeline simply draws
 * without earnings when this answers late or not at all. */
export function useCalendarEarnings(days = 30) {
  return useQuery({
    queryKey: ["calendar", "earnings", days],
    queryFn: () => getJson<CalendarEvent[]>("/api/calendar", { days, include: "earnings" }),
    staleTime: 30 * MINUTE,
    retry: false,
  });
}

export function useBacktests() {
  return useQuery({
    queryKey: ["backtests"],
    queryFn: () => getJson<BacktestRow[]>("/api/backtests"),
    staleTime: 60 * MINUTE,
  });
}

export function useCreditOas(days = 90) {
  return useQuery({
    queryKey: ["credit", "oas", days],
    queryFn: () => getJson<CreditOAS>("/api/credit/oas", { days }),
    staleTime: 15 * MINUTE,
  });
}

/** Trains in-process server-side on cold call (~1s), then 15-min TTL cache. */
export function useRecessionProbability() {
  return useQuery({
    queryKey: ["recession", "probability"],
    queryFn: () => getJson<RecessionMetrics>("/api/recession/probability"),
    staleTime: 15 * MINUTE,
    retry: 1,
  });
}

/** Latest observation of one raw FRED series (unprefixed Atlas endpoint). */
export function useSeriesLatest(seriesId: string) {
  return useQuery({
    queryKey: ["series", seriesId, "latest"],
    queryFn: () =>
      getJson<{ series_id: string; date: string; value: number }>(
        `/series/${encodeURIComponent(seriesId)}/latest`,
      ),
    staleTime: 30 * MINUTE,
  });
}

export function useFreshness() {
  return useQuery({
    queryKey: ["freshness"],
    queryFn: () => getJson<Freshness>("/api/freshness"),
    refetchInterval: MINUTE,
    staleTime: 30_000,
  });
}

/* ── Regime Lab (night-2 endpoints) ────────────────────────────────────── */

export function useTakeaway() {
  return useQuery({
    queryKey: ["regime", "intelligence"],
    queryFn: () => getJson<Takeaway>("/api/regime/intelligence"),
    staleTime: 15 * MINUTE,
    retry: 1, // cold call trains the recession model server-side (~1s)
  });
}

export function useRegimePlaybooks() {
  return useQuery({
    queryKey: ["regime", "playbooks"],
    queryFn: () => getJson<Record<string, RegimePlaybook>>("/api/regime/playbooks"),
    staleTime: Infinity, // static reference content
  });
}

export function useRegimeDuration() {
  return useQuery({
    queryKey: ["regime", "duration"],
    queryFn: () => getJson<RegimeDuration>("/api/regime/duration"),
    staleTime: 15 * MINUTE,
  });
}

export function useTransitions() {
  return useQuery({
    queryKey: ["regime", "transitions"],
    queryFn: () => getJson<TransitionOutlook>("/api/regime/transitions"),
    staleTime: 15 * MINUTE,
  });
}

export function useAnalogues() {
  return useQuery({
    queryKey: ["regime", "analogues"],
    queryFn: () => getJson<Analogue[]>("/api/regime/analogues"),
    staleTime: 15 * MINUTE,
    retry: 1,
  });
}

export function useScenarioDefs() {
  return useQuery({
    queryKey: ["regime", "scenario-defs"],
    queryFn: () => getJson<ScenarioDef[]>("/api/regime/scenarios"),
    staleTime: Infinity, // static reference content
  });
}

/** POST — pure computation server-side; keyed on inputs so the debounced
 * builder re-scores only when the (settled) shocks actually change. */
export function useScenarioRun(
  scenarioKey: string | null,
  customShocks: ScenarioShocks | null,
) {
  return useQuery({
    queryKey: ["regime", "scenario-run", scenarioKey ?? "custom", customShocks],
    queryFn: () =>
      postJson<ScenarioResult>("/api/regime/scenario", {
        scenario_key: scenarioKey,
        custom_shocks: customShocks,
      }),
    enabled: scenarioKey != null || customShocks != null,
    staleTime: 15 * MINUTE,
    // Keep the last result on screen while the next scores — a settled
    // slider step must not blank the panel (audit 2026-08-07).
    placeholderData: keepPreviousData,
  });
}

/* ── Credit ────────────────────────────────────────────────────────────── */

export function useCreditMetrics() {
  return useQuery({
    queryKey: ["credit", "metrics"],
    queryFn: () => getJson<CreditMetrics>("/api/credit/metrics"),
    staleTime: 30 * MINUTE,
  });
}

/* ── Recession sensitivity ─────────────────────────────────────────────── */

/** POST — scores user inputs against the fitted model (server-cached). */
export function useRecessionScenario(req: RecessionScenarioRequest | null) {
  return useQuery({
    queryKey: ["recession", "scenario", req],
    queryFn: () => postJson<RecessionScenarioResult>("/api/recession/scenario", req),
    enabled: req != null,
    staleTime: 15 * MINUTE,
    placeholderData: keepPreviousData,
  });
}

/* ── Tools: LBO + Allocation ───────────────────────────────────────────── */

export function useLboDefaults() {
  return useQuery({
    queryKey: ["lbo", "defaults"],
    queryFn: () => getJson<LboDefaults>("/api/lbo/defaults"),
    staleTime: 30 * MINUTE,
  });
}

/** POST — full deal model + 5×5 IRR sensitivity, keyed on (debounced) inputs. */
export function useLboRun(req: LboRequest | null) {
  return useQuery({
    queryKey: ["lbo", "run", req],
    queryFn: () => postJson<LboResponse>("/api/lbo/run", req),
    enabled: req != null,
    staleTime: 60 * MINUTE,
    placeholderData: keepPreviousData,
  });
}

/** Cold call downloads return histories server-side (~30–60s) — the screen
 * states that; afterwards the server cache answers in milliseconds. */
export function useAllocation() {
  return useQuery({
    queryKey: ["allocation"],
    queryFn: () => getJson<AllocationData>("/api/allocation"),
    staleTime: 60 * MINUTE,
    retry: 1,
  });
}

/* ── News & Calendar fallbacks ─────────────────────────────────────────── */

/** Latest-available fallback — most recent stored headlines, any age. */
export function useNewsLatest(category?: string, limit = 50, enabled = true) {
  return useQuery({
    queryKey: ["news", "latest", category ?? "all", limit],
    queryFn: () => getJson<NewsItem[]>("/api/news/latest", { category, limit }),
    staleTime: 5 * MINUTE,
    enabled,
  });
}

/** Most recent past events — the calendar's latest-available fallback. */
export function useCalendarRecent(limit = 10, enabled = true) {
  return useQuery({
    queryKey: ["calendar", "recent", limit],
    queryFn: () => getJson<CalendarEvent[]>("/api/calendar/recent", { limit }),
    staleTime: 30 * MINUTE,
    enabled,
  });
}

/* ── On-demand symbol layer (EODHD first, yfinance fallback; 2026-09-06) ── */

/** Provider errors are typed: a 404 (unknown symbol / empty range), a 422
 * (unsupported instrument) and a 403 (not in the plan) are final; everything
 * else gets one more try. */
export function providerRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && [403, 404, 422].includes(error.status)) return false;
  return failureCount < 2;
}

export function useSymbolSearch(q: string, limit = 10) {
  const query = q.trim();
  return useQuery({
    queryKey: ["symbol", "search", query.toLowerCase(), limit],
    queryFn: () => getJson<SearchResponse>("/api/market/search", { q: query, limit }),
    enabled: query.length >= 1,
    staleTime: 60 * MINUTE,
    // No placeholder from the previous query: a list of hits must belong to
    // the text in the box, or Enter picks a symbol the reader never typed
    // (rapid-switching regression, 2026-09-06).
  });
}

/** Delayed quote (EODHD, yfinance fallback) + fundamentals; refetched so the
 * delayed read stays as current as the source allows. */
export function useSymbolProfile(symbol: string | null) {
  return useQuery({
    queryKey: ["symbol", "profile", symbol],
    queryFn: () => getJson<SymbolProfile>(`/api/market/profile/${symbol}`),
    enabled: symbol != null,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: providerRetry,
  });
}

/** Candle envelope for any listed symbol. Previous data is kept only across
 * a RANGE change of the same symbol — a new symbol must never paint the old
 * symbol's history while its own request is in flight. */
export function useSymbolCandles(symbol: string | null, range: CandleRange) {
  return useQuery({
    ...candlesQuery(symbol, range),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[2] === symbol ? prev : undefined),
  });
}

/** One candle query's key, fetch and cadence: shared by `useSymbolCandles`
 * and `useSymbolCandlesList`, so a panel, a watchlist row and the Markets
 * movers row asking for the same symbol and range share one cache entry. */
function candlesQuery(symbol: string | null, range: CandleRange) {
  return {
    queryKey: ["symbol", "candles", symbol, range] as const,
    queryFn: () => getJson<CandleSeries>(`/api/market/candles/${symbol}`, { range }),
    enabled: symbol != null,
    refetchInterval: range === "1D" ? 60_000 : undefined,
    staleTime: range === "1D" ? 30_000 : 15 * MINUTE,
    retry: providerRetry,
  };
}

/** The candles of several symbols at one range (Iteration 1, M3: the Markets
 * movers row reads the 5D candles of the stored single names that have no
 * day change on the stream). The results line up with `symbols`; pass each
 * symbol once (duplicate keys in one useQueries call are an error). */
export function useSymbolCandlesList(symbols: ReadonlyArray<string>, range: CandleRange) {
  return useQueries({ queries: symbols.map((symbol) => candlesQuery(symbol, range)) });
}

export function useCorporateActions(symbol: string | null, enabled = true) {
  return useQuery({
    queryKey: ["symbol", "actions", symbol],
    queryFn: () => getJson<CorporateActions>(`/api/market/actions/${symbol}`),
    enabled: symbol != null && enabled,
    staleTime: 6 * 60 * MINUTE,
    retry: providerRetry,
  });
}

/** End-of-day listed expirations (EODHD marketplace). Only fetched once the
 * Options lens is opened; a 403 means the plan lacks the family. */
export function useOptionsExpirations(symbol: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["symbol", "options", "expirations", symbol],
    queryFn: () => getJson<OptionsExpirations>(`/api/market/options/${symbol}/expirations`),
    enabled: symbol != null && enabled,
    staleTime: 60 * MINUTE,
    retry: providerRetry,
  });
}

export interface OptionsChainParams {
  expiration: string | null;
  type: "call" | "put" | null;
  page: number;
  limit: number;
}

export function useOptionsChain(symbol: string | null, params: OptionsChainParams, enabled: boolean) {
  const { expiration, type, page, limit } = params;
  return useQuery({
    queryKey: ["symbol", "options", "chain", symbol, expiration, type, page, limit],
    queryFn: () =>
      getJson<OptionsChain>(`/api/market/options/${symbol}`, {
        expiration: expiration ?? undefined,
        type: type ?? undefined,
        page,
        limit,
      }),
    enabled: symbol != null && expiration != null && enabled,
    staleTime: 15 * MINUTE,
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[3] === symbol && prevQuery?.queryKey[4] === expiration ? prev : undefined),
    retry: providerRetry,
  });
}

/** Provider matrix + entitlement probe + relay health (diagnostics). */
export function useProvidersStatus(enabled = true) {
  return useQuery({
    queryKey: ["providers", "status"],
    queryFn: () => getJson<ProvidersStatus>("/api/providers/status"),
    enabled,
    staleTime: 5 * MINUTE,
    refetchInterval: enabled ? 5 * MINUTE : undefined,
  });
}

export function useStreamDebug(enabled = true) {
  return useQuery({
    queryKey: ["stream", "debug"],
    queryFn: () => getJson<StreamDebug>("/api/stream/debug"),
    enabled,
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : undefined,
  });
}

/** Stored headlines tagged to one ticker (7-day retention window). */
export function useTickerNews(ticker: string | null, hours = 168, limit = 12) {
  return useQuery({
    queryKey: ["news", "ticker", ticker, hours, limit],
    queryFn: () => getJson<NewsItem[]>("/api/news", { hours, limit, ticker: ticker ?? undefined }),
    enabled: ticker != null,
    staleTime: 5 * MINUTE,
  });
}
