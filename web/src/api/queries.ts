/**
 * TanStack Query hooks — one per API endpoint the shell and screens read.
 * Server state lives here exclusively; nothing about the domain belongs in
 * client state (handoff → State).
 *
 * Poll cadences mirror the Streamlit behavior: intraday 30s (the old
 * `st.fragment(run_every=30)`), freshness 60s, everything else on-load with a
 * long stale time (regimes/signals are monthly-cadence data).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { getJson, postJson } from "./client";
import type {
  Alert,
  AllocationData,
  Analogue,
  BacktestRow,
  CalendarEvent,
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

export function useNews(hours = 168, minSignificance?: number, limit = 150, category?: string) {
  return useQuery({
    queryKey: ["news", hours, minSignificance ?? "any", limit, category ?? "all"],
    queryFn: () =>
      getJson<NewsItem[]>("/api/news", {
        hours,
        min_significance: minSignificance,
        limit,
        category,
      }),
    staleTime: 5 * MINUTE,
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
