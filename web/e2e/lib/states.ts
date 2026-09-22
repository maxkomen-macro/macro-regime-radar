/**
 * State recipes for the Phase 10 states spec (docs/redesign-v2/checklists/
 * 10-states-a11y.md, B.0), Node side. One helper per recipe, all applied to a
 * page BEFORE its goto, against the one Vite on :5173 proxying the one
 * uvicorn on :8000 (no server is ever started or stopped here):
 *
 *   stopApi        the API-unreachable recipe: every /api, /series and /health
 *                  request is aborted as "connectionrefused" (client.ts turns
 *                  it into ApiError("unreachable")); the WebSocket upgrade is
 *                  never intercepted, so the EODHD relay keeps ticking (G12)
 *   unseed         no validated snapshot: /snapshot/latest.json answers 404 and
 *                  the last-known-good copy is removed from localStorage before
 *                  main.tsx runs, so seedSnapshot returns null
 *   delayApi       every matching request is held for `ms` before continuing,
 *                  so the loading copy stays on screen long enough to capture
 *   emptyEndpoint  one endpoint answers its own empty shape (or a rewrite of the
 *                  served body), so the empty copy replaces the seeded value
 *   staleFeeds     /api/freshness, /api/regime/latest and /api/signals/latest are
 *                  rewritten to March 2026 (monthly) and Aug 20 2026 (daily);
 *                  since Iteration 1 step 6 (A3) the screen judges nothing
 *                  itself, so the recipe also serves the stale per-series
 *                  states (FRESHNESS_CONTRACT §1) the words are read from:
 *                  the regime inputs and the signals block 5 releases
 *                  behind, market_daily 20 sessions behind, live_quotes at
 *                  the close (so the market chip reads the stored close
 *                  whatever the hour), and with `credit` the ICE BofA series
 *
 * Route patterns are anchored on the pathname: a bare "/api/" substring would
 * also match Vite's own /src/api/queries.ts module and blank the page (U6).
 */
import type { Page, Route } from "@playwright/test";
import type { ConsoleRec, FailedReq } from "./drive";

export type StateName = "live" | "error" | "snapshot" | "loading" | "empty" | "stale";

/** A pathname string (exact match), a RegExp tested against pathname+search, or a URL predicate. */
export type PathPattern = string | RegExp | ((url: URL) => boolean);

/** The data-service paths the Vite dev server proxies to uvicorn (vite.config.ts). */
export const API_PATH = /^\/(api|series|health)(\/|$)/;

/** Pathname-anchored predicate for page.route: never a bare `/api/` substring. */
export const apiUrl = (url: URL): boolean => API_PATH.test(url.pathname);

/** Chromium's line for an aborted request; allowed only in error and snapshot cells (G20). */
export const ERROR_CONSOLE_ALLOW = /Failed to load resource|net::ERR_(FAILED|CONNECTION_REFUSED)/;

/** The last-known-good snapshot key (api/snapshot.ts STORAGE_KEY). */
export const SNAPSHOT_STORAGE_KEY = "mrr:snapshot:v1";

/** The stale recipe's dates (B.0): a March month and an August close on a September verify day. */
export const STALE_MONTH = "2026-03-01";
export const STALE_DAILY = "2026-08-20";
/** The recipe's served lags (A3): what the server would say for the dates above. */
export const STALE_RELEASES = 5;
export const STALE_SESSIONS = 20;
export const STALE_CREDIT_DAY = "2026-03-02";
export const STALE_CREDIT_DAYS = 140;
/** The §5 words the stale states read (fresh-state.ts freshLabel). */
export const STALE_MONTH_WORD = `Mar 2026 · ${STALE_RELEASES} releases behind`;
export const STALE_DAILY_WORD = `Aug 20 · ${STALE_SESSIONS} sessions behind`;
export const STALE_CREDIT_WORD = `Mar 02 · ${STALE_CREDIT_DAYS} days behind`;

interface SeriesLike {
  id: string;
  label?: string;
  kind?: string;
  cadence?: string;
  as_of?: string | null;
  state?: string;
  delay_min?: number | null;
  cycles_behind?: number | null;
  stale?: boolean;
  discontinued?: boolean;
  reason?: string;
}

const REGIME_INPUTS = ["INDPRO", "CPIAUCSL", "UNRATE"];
const BAML = ["BAMLH0A0HYM2", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC"];

function staleState(id: string, cadence: string, kind: string, as_of: string, behind: number, unit: string): SeriesLike {
  return { id, label: id, kind, cadence, as_of, state: "stale", delay_min: null, cycles_behind: behind, stale: true, discontinued: false, reason: `${id}: ${behind} ${unit} behind (stale recipe).` };
}
const staleMonthly = (id: string) => staleState(id, "monthly", "fred", STALE_MONTH, STALE_RELEASES, "release(s)");
const staleCredit = (id: string) => staleState(id, "daily", "fred", STALE_CREDIT_DAY, STALE_CREDIT_DAYS, "business day(s)");

/** Replace (or add) states by id in a served series[] list. */
function withStates(list: SeriesLike[] | null | undefined, states: SeriesLike[]): SeriesLike[] {
  const byId = new Map(states.map((x) => [x.id, x]));
  const out = (list ?? []).map((x) => byId.get(x.id) ?? x);
  for (const x of states) if (!out.some((y) => y.id === x.id)) out.push(x);
  return out;
}

export function toMatcher(pattern: PathPattern): (url: URL) => boolean {
  if (typeof pattern === "string") return (url) => url.pathname === pattern;
  if (pattern instanceof RegExp) return (url) => pattern.test(`${url.pathname}${url.search}`);
  return pattern;
}

/** B.0 "error, API unreachable (relay alive)". */
export async function stopApi(page: Page, pattern: PathPattern = apiUrl): Promise<void> {
  await page.route(toMatcher(pattern), (route) => route.abort("connectionrefused"));
}

/** B.0 "error, unseeded": no static snapshot and no last-known-good copy. */
export async function unseed(page: Page): Promise<void> {
  await page.route("**/snapshot/latest.json", (route) => route.fulfill({ status: 404, body: "" }));
  await page.addInitScript((key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked: nothing was seeded from it either */
    }
  }, SNAPSHOT_STORAGE_KEY);
}

/** B.0 "loading": hold every matching request for `ms` before letting it through. */
export async function delayApi(page: Page, ms: number, pattern: PathPattern = apiUrl): Promise<void> {
  await page.route(toMatcher(pattern), async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    // The page may be gone by the time the delay elapses (a closed context).
    await route.continue().catch(() => undefined);
  });
}

type Rewrite<T = unknown> = (served: T | null) => unknown;

async function servedJson(route: Route): Promise<unknown | null> {
  try {
    const res = await route.fetch();
    if (!res.ok()) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * B.0 "empty": answer with `body`, or with `body(served)` when a function is
 * given (the served JSON is fetched first so a rewrite can keep its shape, e.g.
 * `{ date, signals: [] }`; `served` is null when the fetch failed).
 */
export async function emptyEndpoint(page: Page, pattern: PathPattern, body: unknown | Rewrite): Promise<void> {
  await page.route(toMatcher(pattern), async (route) => {
    const json = typeof body === "function" ? (body as Rewrite)(await servedJson(route)) : body;
    await route.fulfill({ status: 200, json: json as object });
  });
}

/** Rewrite one endpoint's served JSON in place; the served status and headers are kept. */
export async function rewriteEndpoint(page: Page, pattern: PathPattern, fn: Rewrite): Promise<void> {
  await page.route(toMatcher(pattern), async (route) => {
    let res;
    try {
      res = await route.fetch();
    } catch {
      await route.abort("connectionrefused");
      return;
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    await route.fulfill({ response: res, json: fn(json) as object });
  });
}

export interface StaleOptions {
  /** `sla` rows whose verdict is rewritten to "stale" (B.0: regime, signals, market_daily). */
  feeds?: string[];
  /** Also age the news feed: `news_published_at` and the `news` sla row (the News cell). */
  news?: boolean;
  /** Also cut the stored daily bars at STALE_DAILY (the Markets chip reads the served bars first). */
  market?: boolean;
  /** Also cut /api/credit/metrics' monthly series at STALE_MONTH (the Credit chip reads the series). */
  credit?: boolean;
}

interface FreshnessLike {
  overall?: string | null;
  regimes_date?: string | null;
  signals_date?: string | null;
  market_daily_date?: string | null;
  news_published_at?: string | null;
  sla?: { feed: string; verdict: string; latest?: string | null }[] | null;
  series?: SeriesLike[] | null;
}

/** B.0 "stale": the served freshness report, regime row and signal print re-dated to the stale dates. */
export async function staleFeeds(page: Page, opts: StaleOptions = {}): Promise<void> {
  const feeds = new Set(opts.feeds ?? ["regime", "signals", "market_daily"]);
  if (opts.news) feeds.add("news");
  await rewriteEndpoint(page, "/api/freshness", (served) => {
    const j = { ...((served ?? {}) as FreshnessLike) };
    j.overall = "stale";
    j.regimes_date = STALE_MONTH;
    j.signals_date = STALE_MONTH;
    j.market_daily_date = STALE_DAILY;
    if (opts.news) j.news_published_at = `${STALE_MONTH}T12:00:00`;
    j.sla = (j.sla ?? []).map((row) => (feeds.has(row.feed) ? { ...row, verdict: "stale" } : row));
    // A3: the per-series states the words are read from.
    const live = (j.series ?? []).find((x) => x.id === "live_quotes");
    j.series = withStates(j.series, [
      ...REGIME_INPUTS.map(staleMonthly),
      staleState("market_daily", "daily", "market", STALE_DAILY, STALE_SESSIONS, "session(s)"),
      ...(live ? [{ ...live, state: "close", delay_min: null, stale: false }] : []),
      ...(opts.credit ? BAML.map(staleCredit) : []),
    ]);
    return j;
  });
  await rewriteEndpoint(page, "/api/regime/latest", (served) => ({ ...((served ?? {}) as object), date: STALE_MONTH }));
  await rewriteEndpoint(page, "/api/signals/latest", (served) => {
    const j = { ...((served ?? { signals: [] }) as Record<string, unknown>), date: STALE_MONTH };
    const block = { ...((j.freshness ?? {}) as Record<string, SeriesLike>) };
    for (const id of REGIME_INPUTS) block[id] = staleMonthly(id);
    j.freshness = block;
    return j;
  });
  if (opts.market) {
    await rewriteEndpoint(page, "/api/market/daily", (served) => (Array.isArray(served) ? served.filter((b) => String((b as { date?: string }).date ?? "") <= STALE_DAILY) : []));
  }
  if (opts.credit) {
    await rewriteEndpoint(page, "/api/credit/metrics", (served) => {
      const m = { ...((served ?? {}) as Record<string, unknown>) };
      const cut = (rows: unknown) => (Array.isArray(rows) ? rows.filter((p) => String((p as { date?: string }).date ?? "") <= STALE_MONTH) : rows);
      for (const key of ["hy_series", "ig_series", "hy_sparkline", "ig_sparkline", "ccc_sparkline", "bb_sparkline", "b_sparkline"]) m[key] = cut(m[key]);
      m.data_as_of = STALE_MONTH.slice(0, 7);
      // A3: the payload's own block, which the Credit chip reads first.
      m.freshness = Object.fromEntries(BAML.map((id) => [id, staleCredit(id)]));
      return m;
    });
  }
}

/* ── the console rule per cell (E.3 #2, G20) ───────────────────────────── */

export interface ConsoleVerdict {
  /** Lines not in the Phase 0 baseline for the screen. */
  fresh: ConsoleRec[];
  /** Lines the cell's state does not allow (a non-empty list fails the cell). */
  disallowed: ConsoleRec[];
  failed: FailedReq[];
}

/**
 * Live, loading, empty and stale cells allow nothing beyond the baseline;
 * error and snapshot cells additionally allow the aborted-request line;
 * a pageerror is never allowed.
 */
export function consoleVerdict(rows: ConsoleRec[], failed: FailedReq[], state: StateName, known: Set<string>): ConsoleVerdict {
  const fresh = rows.filter((c) => !known.has(c.text));
  const lenient = state === "error" || state === "snapshot";
  const disallowed = fresh.filter((c) => c.type === "pageerror" || !(lenient && ERROR_CONSOLE_ALLOW.test(c.text)));
  return { fresh, disallowed, failed };
}
