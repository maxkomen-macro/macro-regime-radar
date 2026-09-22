/**
 * Phase 5 checklist (docs/redesign-v2/checklists/05-markets.md) section E.1,
 * `screens/markets/MarketsScreen.test.tsx`: the rebuilt Markets screen
 * (composition B.0, hero B.1, summary and strip B.2, chart panel seam B.3,
 * the four panels B.4 to B.8, copy C.2, ids D). renderWithProviders +
 * stubFetch with a fixture per route the page reads (unmatched paths 404 so
 * error branches are real); the live-quote store is mocked through a hoisted
 * handle so each case chooses its relay state and quotes; ChartPanel and
 * SingleName are stubbed to their seams. The clock is frozen to a Saturday
 * (only `Date` is faked) so the session ladder, the as-of stamps and the feed
 * words never depend on when the suite runs. Fixtures are dated Sep 2026 and
 * never reuse the mockup's numbers: the assertions are the copy rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import MarketsScreen from "./MarketsScreen";
import { DAILY_FETCH, DB_SYMBOLS, SINGLE_NAMES } from "./tape";
import { NO_SHELL_ACTIONS, ShellActionsContext, type ShellActions } from "../shell/shell-actions";
import type { LiveQuote, StreamStatus } from "../../live/quotes";
import type { CreditOAS, CreditSeries, DailyBar, Freshness, PricedMetric, Surprise } from "../../api/types";
import { fmtSigned, fmtSignedPct } from "../../lib/format";
import { useLocation } from "react-router-dom";
import { makeClient, renderWithProviders, stubFetch } from "../../test/utils";

/* ── mocks ───────────────────────────────────────────────────────────────── */

/** The relay as the screen sees it; each case sets `status` and `quotes`. */
const live = vi.hoisted(() => ({
  status: { socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false } as {
    socket: "connecting" | "open" | "closed";
    feeds: Record<string, string>;
    stale: Record<string, boolean>;
    degraded: boolean;
    degradedReasons: string[];
    lastBatchAt: number | null;
    attempts: number;
    everOpened: boolean;
  },
  quotes: new Map<string, unknown>(),
}));

vi.mock("../../live/quotes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../live/quotes")>();
  const status = () => live.status as StreamStatus;
  const quotes = () => live.quotes as ReadonlyMap<string, LiveQuote>;
  return {
    ...actual,
    useQuotes: quotes,
    useStreamStatus: status,
    useWatch: () => {},
    watch: () => () => {},
    useStreamLive: () => actual.streamIsLive(status(), quotes()),
    useStreamWord: () => actual.streamWord(status(), quotes()),
    useLiveFeeds: () => actual.liveFeeds(status(), quotes()),
  };
});

vi.mock("./ChartPanel", () => ({
  default: ({ symbol, onClose }: { symbol: string; onClose: () => void }) => (
    <div id="markets-chart-panel" role="region" aria-label={`${symbol} chart panel`} tabIndex={-1} data-testid="chart-panel">
      <span>{symbol} chart</span>
      <button type="button" aria-label="Close chart" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("./SingleName", () => ({
  RANGES: ["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"],
  default: ({ symbol, range, onClose }: { symbol: string; range?: string; onClose?: () => void }) => (
    <div data-testid="single-name" data-range={range ?? ""}>
      {symbol}
      <button type="button" aria-label="Close single-name panel" onClick={onClose} />
    </div>
  ),
}));

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Saturday Sep 19 2026, 11:00 ET: the NYSE session is closed on every branch of the ladder. */
const NOW = new Date("2026-09-19T15:00:00Z");
const NOW_MS = NOW.getTime();
const DATES = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];
const DAILY_DATE = DATES[DATES.length - 1];
const WEEK_END = "2026-09-18";
/** The app's numeric placeholder glyph (a dash, not prose copy). */
const DASH = "\u2014";

/** Newest-bar returns and close per stored symbol: [ret_1d, ret_1w, ret_1m, close]. */
const RETS: Record<string, [number, number, number, number]> = {
  SPY: [0.42, 1.31, 2.05, 647.9],
  QQQ: [1.01, 1.84, 3.12, 571.4],
  IWM: [-0.35, -0.62, 0.88, 228.15],
  EEM: [0.27, 0.47, 1.4, 49.62],
  EFA: [0.12, 0.22, 0.95, 88.31],
  TLT: [-0.58, -1.05, -2.3, 87.44],
  IEF: [-0.21, -0.38, -0.7, 95.8],
  HYG: [0.05, 0.11, 0.6, 80.12],
  LQD: [-0.09, -0.19, -0.4, 109.3],
  UUP: [-0.24, -0.91, -1.1, 27.86],
  GLD: [0.83, 2.06, 4.4, 318.7],
  SLV: [1.42, 3.12, 6.8, 39.05],
  USO: [-1.35, -2.44, -5.1, 71.2],
  CPER: [0.31, 0.73, 2.2, 29.4],
  // Sectors: two up (XLF, XLK), two down; XLK at mag 1, XLE at mag 2 for the tint rule.
  XLF: [0.42, 1.12, 2.5, 52.18],
  XLE: [-2.14, -1.6, -3.1, 88.05],
  XLI: [-0.15, 0.3, 1.2, 148.62],
  XLK: [1.23, 2.4, 4.1, 262.35],
};

function barsFor(symbol: string, over: Partial<DailyBar> = {}): DailyBar[] {
  const [ret_1d, ret_1w, ret_1m, close] = RETS[symbol];
  return DATES.map((date, i) => {
    const last = i === DATES.length - 1;
    const c = last ? close : close - (DATES.length - 1 - i) * 0.5;
    const bar: DailyBar = { symbol, date, open: c, high: c + 0.4, low: c - 0.4, close: c, volume: 1_000, vwap: c, ret_1d: last ? ret_1d : null, ret_1w: last ? ret_1w : null, ret_1m: last ? ret_1m : null };
    return last ? { ...bar, ...over } : bar;
  });
}
function dailyBars(over: Record<string, Partial<DailyBar>> = {}, omit: string[] = []): DailyBar[] {
  return DAILY_FETCH.filter((s) => !omit.includes(s)).flatMap((s) => barsFor(s, over[s]));
}
const DAILY_BARS = dailyBars();
/** The four SECTORS all positive: 4 of 4. */
const DAILY_RISK_ON = dailyBars({ XLE: { ret_1d: 0.55 }, XLI: { ret_1d: 0.15 } });
/** One of four: XLK alone up. */
const DAILY_RISK_OFF = dailyBars({ XLF: { ret_1d: -0.42 } });

const series = (series_id: string, label: string, value_pct: number, change_1w_bps: number): CreditSeries => ({
  series_id,
  label,
  date: DAILY_DATE,
  value_pct,
  value_bps: Math.round(value_pct * 100),
  change_1w_bps,
  history: DATES.map((date, i) => ({ date, value: value_pct - (DATES.length - 1 - i) * 0.02 })),
});
const CREDIT: CreditOAS = { as_of: DAILY_DATE, series: [series("DGS10", "UST10Y", 4.27, 6), series("BAMLC0A0CM", "IG", 0.79, -3), series("BAMLH0A0HYM2", "HY", 2.88, 5)] };

const priced = (group: string, metric: string, label: string, value: number, mom_chg: number | null): PricedMetric => ({ group, metric, label, unit: "%", date: WEEK_END, value, mom_chg });
/** The six served metrics in three groups, served in group order. */
const PRICED: PricedMetric[] = [
  priced("Policy rate proxies", "FEDFUNDS", "Fed funds", 4.08, 0),
  priced("Policy rate proxies", "SOFR", "SOFR", 4.06, -0.02),
  priced("Inflation breakevens", "T5YIE", "5Y breakeven", 2.36, 0.04),
  priced("Inflation breakevens", "T10YIE", "10Y breakeven", 2.19, null),
  priced("Real yields (TIPS)", "DFII5", "5Y real yield", 1.57, -0.03),
  priced("Real yields (TIPS)", "DFII10", "10Y real yield", 1.91, 0.05),
];

const surprise = (metric: string, label: string, z_score: number, interpretation: string): Surprise => ({ metric, label, date: WEEK_END, z_score, raw_value: z_score * 0.4, interpretation });
/** Ten rows; the displayed one-decimal value drives the colour rule (1.46 prints +1.5σ, -2.47 prints -2.5σ). */
const SURPRISES: Surprise[] = [
  surprise("spy_ret", "SPY weekly return", 2.61, "SPY rose 2.3% on the week \u2014 the largest weekly gain since June."),
  surprise("dgs10", "10Y Treasury yield", -2.47, "The 10Y yield fell 14 bps on the week."),
  surprise("hy_oas", "HY OAS", 1.94, "HY spreads widened 21 bps on the week."),
  surprise("gld_ret", "Gold weekly return", -1.52, "Gold fell 1.8% on the week."),
  surprise("dxy", "Dollar index", 1.46, "The dollar index rose 1.1% on the week."),
  surprise("uso_ret", "Oil weekly return", -1.21, "WTI fell 3.4% on the week."),
  surprise("vix", "VIX level", 0.98, "The VIX rose 1.6 points on the week."),
  surprise("t10y2y", "2s10s spread", -0.74, "The 2s10s spread flattened 4 bps."),
  surprise("ig_oas", "IG OAS", 0.56, "IG spreads widened 2 bps on the week."),
  surprise("cper_ret", "Copper weekly return", -0.31, "Copper slipped 0.4% on the week."),
];
const EXPECTED_SIGMA = SURPRISES.map((s) => `${fmtSigned(s.z_score, 1)}σ`);
const EXPECTED_SIGMA_COLOR = SURPRISES.map((s) => {
  const shown = Math.abs(Number(s.z_score.toFixed(1)));
  return shown >= 2.5 ? "var(--neg)" : shown >= 1.5 ? "var(--amber)" : "var(--link)";
});

const FRESHNESS: Freshness = {
  regimes_date: "2026-09-01",
  signals_date: "2026-09-01",
  market_daily_date: DAILY_DATE,
  market_intraday_ts: `${DAILY_DATE}T19:55:00`,
  news_published_at: `${DAILY_DATE}T12:00:00`,
  raw_series_date: DAILY_DATE,
  generated_at: `${DAILY_DATE}T20:05:00`,
  overall: "current",
  session: { exchange: "NYSE", timezone: "America/New_York", phase: "weekend", is_open: false, today_is_trading_day: false, early_close: false, last_completed_session: DAILY_DATE, next_open_utc: "2026-09-21T13:30:00Z", calendar_known: true, local_time: "11:00" },
  sla: [],
  regime: { latest_month: "2026-09-01", expected_month: "2026-09-01", common_feature_month: "2026-09-01", inputs: [], blockers: [] },
  bootstrap: null,
  relay: null,
};

/* ── relay states and quotes ─────────────────────────────────────────────── */

const CLOSED: StreamStatus = { socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false };
const OPEN: StreamStatus = { ...CLOSED, socket: "open", feeds: { us: "open", crypto: "open", forex: "open", vix: "rest" }, lastBatchAt: NOW_MS - 1_000, everOpened: true };
const OFF: StreamStatus = { ...OPEN, feeds: { us: "off", crypto: "off", forex: "off", vix: "off" } };
const RECONNECTING: StreamStatus = { ...CLOSED, everOpened: true, attempts: 1 };
const BACKEND_DOWN: StreamStatus = { ...CLOSED, everOpened: false, attempts: 2 };
const DEGRADED: StreamStatus = { ...OPEN, degraded: true, degradedReasons: ["us feed silent during the session"] };

/** A 15-minute-delayed REST row unless overridden. */
const quote = (s: string, p: number, over: Partial<LiveQuote> = {}): LiveQuote => ({ s, p, dc: null, dd: null, t: NOW_MS - 20 * 60_000, delayed: true, src: "rest", ...over });
const wsTick = (s: string, p: number, dc: number, dd: number): LiveQuote => quote(s, p, { dc, dd, t: NOW_MS - 5_000, delayed: false, src: "ws" });
const quotesOf = (...qs: LiveQuote[]) => new Map(qs.map((q) => [q.s, q]));

/** Delayed rows with a price and no day change: the "SPY $… last" rung. */
const DELAYED_QUOTES = quotesOf(quote("SPY", 645.12), quote("QQQ", 572.3), quote("VIX", 15.72));
/** US ticks inside the live window plus the delayed VIX poll and a UUP row with a day change. */
const LIVE_QUOTES = quotesOf(wsTick("SPY", 646.31, 0.42, 2.7), wsTick("QQQ", 574.8, 1.01, 5.74), wsTick("UUP", 27.9, 0.31, 0.09), quote("VIX", 15.72, { dc: -0.63 }));

/* ── routes ──────────────────────────────────────────────────────────────── */

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
/** Every route the page reads. SingleName is stubbed, so no profile / candle / news route is needed. */
function routes(over: Routes = {}): Routes {
  return {
    "/api/market/daily": () => DAILY_BARS,
    "/api/priced": () => PRICED,
    "/api/surprises": () => SURPRISES,
    "/api/credit/oas": () => CREDIT,
    "/api/freshness": () => FRESHNESS,
    ...over,
  };
}
function without(...paths: string[]): Routes {
  const r = routes();
  for (const p of paths) delete r[p];
  return r;
}
const PENDING = () => new Promise(() => {});

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderMarkets({ route = "/app/markets", actions, client }: { route?: string; actions?: Partial<ShellActions>; client?: QueryClient } = {}) {
  const tree = (
    <main id="main-content">
      <MarketsScreen />
    </main>
  );
  return renderWithProviders(actions ? <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, ...actions }}>{tree}</ShellActionsContext.Provider> : tree, { route, client });
}

/** Text with `hidden` subtrees removed (Jargon tooltips, closed disclosures), whitespace collapsed. */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const e = n as Element;
    if (e.hasAttribute("hidden")) return "";
    return [...e.childNodes].map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
}
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const hero = () => byId("markets-hero") as HTMLElement;
const summary = () => byId("markets-summary") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = (name = "Mixed") => screen.findByRole("heading", { level: 1, name });
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
const strip = () => summary().querySelector<HTMLButtonElement>("button[aria-haspopup='dialog']");
async function awaitStrip(): Promise<HTMLButtonElement> {
  await waitFor(() => expect(strip()).not.toBeNull());
  return strip() as HTMLButtonElement;
}
const stripTitle = (b: HTMLElement) => text(b.querySelector(".mrr-status-title") ?? b.querySelector("b"));
const stripDetail = (b: HTMLElement) => text(b.querySelector("small"));
/** Top-level `Card variant="tile"` surfaces inside a section (inline `border-radius: var(--r-tile)`; the tint may replace the background). */
function tiles(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[style*='var(--r-tile)']")].filter((el) => !el.parentElement?.closest("[style*='var(--r-tile)']"));
}
/** The innermost element carrying an inline colour inside a cell, else the cell. */
function colorOf(cell: Element): string {
  const els = [...cell.querySelectorAll<HTMLElement>("[style]")].filter((e) => e.style.color);
  return (els[els.length - 1] ?? (cell as HTMLElement)).style.color;
}
const tapeRow = (symbol: string): HTMLTableRowElement => {
  const button = within(byId("watchlist") as HTMLElement).getByRole("button", { name: symbol });
  return button.closest("tr") as HTMLTableRowElement;
};
const headerIndex = (table: HTMLTableElement, label: string) => [...table.querySelectorAll("thead th")].findIndex((th) => text(th) === label);

/* Iteration 1 (the summary's G2 fill): "ETFs · 1w" reads the week bars' served
   ret_1w extremes; "Single names · 1d" appears once the movers read has two
   names (none in the default fixtures: no single-name quote, candles 404). */
// Iteration 1 step 6 (A2): the summary's VIX is the relay's delayed poll,
// labelled as such (the Dashboard's "VIX" is the stored FRED close).
const ALL_LABELS = ["US 10Y", "Sectors · 1d", "ETFs · 1w", "Dollar", "VIX · delayed", "Priced", "Top surprise"];
/** Iteration 2 (F2): the macro tape (#watchlist, #single-names) moved out of
 * the 432px summary rail to the page's full width, directly under the hero,
 * so it now precedes the panel stack instead of sitting beside it. */
const IDS_IN_ORDER = ["markets-hero", "markets-summary", "watchlist", "single-names", "single-name-research", "sector-heatmap", "single-name-movers", "top-surprises", "whats-priced-full"];
const EMPTY_PROMPT =
  "Search a ticker or company name in the market read above, or open a mover below, for a full profile: delayed quote, candles across seven ranges, fundamentals, regime fit since 1996, and the stored news window.";
// CP4: the hero names the missing closes; "The tape keeps its live quotes." follows only while the stream is up.
const ERROR_HEADLINE = "Stored closes unavailable: the data service did not answer.";
const DISCLOSURE_LINE =
  "Live prices via EODHD WebSocket (crypto & FX stream around the clock, US equities during NYSE hours, 15-min-delayed quotes fill the gaps) · stored candles and returns via the yfinance pipeline · macro metrics via FRED.";
const OFF_HOURS_LEDE = "Off-hours the board holds the last quote with its timestamp. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence.";
const LIVE_LEDE = "Day moves are the exchange feed's own figures. Stored candles feed the 1W / 1M columns and sparklines; the weekly pricing block and the surprise ranking update on their own cadence.";
const BASIS = "Headline and pill read the one-day moves of the four stored sector ETFs at the Sep 18, 2026 close; the session sentence is the live tape.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", "/app/markets");
  live.status = CLOSED;
  live.quotes = new Map();
  stubFetch(routes());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("MarketsScreen (checklist 05 E.1)", () => {
  it("renders one h1 equal to the fixture's risk word inside the hero with the sectors pill, the eyebrow, the chips, the basis note and no image", async () => {
    renderMarkets();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect((document.querySelector("main") as HTMLElement).contains(h1)).toBe(true);
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveClass("mrr-hero");
    expect(hero().contains(h1)).toBe(true);
    expect(text(h1)).toBe("Mixed");
    expect(within(hero()).getByText("Market read")).toBeInTheDocument();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("2 of 4 sectors up");
    expect(text(pill)).toMatch(/^\d of \d sectors up$/);
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(h1.parentElement?.contains(pill)).toBe(true); // beside the headline
    expect(text(hero())).toContain(BASIS);
    for (const noun of ["Tape", "Stored candles", "Priced"]) expect(hero().querySelector(`[title^='${noun}:']`), `${noun} chip`).not.toBeNull();
    expect(hero().querySelectorAll("[title^='Tape:'], [title^='Stored candles:'], [title^='Priced:']")).toHaveLength(3);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByText("Reading the tape…")).toBeNull();
    // The hero never prints a percent sign in its headline or pill.
    expect(text(h1)).not.toContain("%");
    expect(text(pill)).not.toContain("%");
  });

  it("the pill's first number equals the count of green sector tiles; all up reads Risk-on mint and one up reads Risk-off amber", async () => {
    renderMarkets();
    await awaitHero();
    const heat = await awaitSection("sector-heatmap");
    await waitFor(() => expect(tiles(heat)).toHaveLength(4));
    // The one-day value prints two decimals; the 1W note prints one, so it never matches.
    const green = tiles(heat).filter((t) => /\+\d+\.\d\d%/.test(text(t)));
    expect(green).toHaveLength(2);
    expect(text(hero().querySelector(".mrr-pill"))).toBe(`${green.length} of 4 sectors up`);
  });

  it("four of four sectors up reads Risk-on with the mint pill and the mint glow", async () => {
    stubFetch(routes({ "/api/market/daily": () => DAILY_RISK_ON }));
    renderMarkets();
    await awaitHero("Risk-on");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("4 of 4 sectors up");
    expect(hero().querySelector(".mrr-pill")).toHaveAttribute("data-tone", "mint");
    expect(hero().querySelector(".mrr-hero-glow")?.getAttribute("style") ?? "").toMatch(/rgba\(40, ?209, ?124, ?0?\.07\)/);
  });

  it("one of four sectors up reads Risk-off with the amber pill and the amber glow", async () => {
    stubFetch(routes({ "/api/market/daily": () => DAILY_RISK_OFF }));
    renderMarkets();
    await awaitHero("Risk-off");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("1 of 4 sectors up");
    expect(hero().querySelector(".mrr-pill")).toHaveAttribute("data-tone", "amber");
    expect(hero().querySelector(".mrr-hero-glow")?.getAttribute("style") ?? "").toMatch(/rgba\(245, ?181, ?46, ?0?\.06\)/);
  });

  it("the h2 is the session sentence: stored closes with an empty relay, the delayed 'last' rung on an open socket, and the live sentence with US ticks", async () => {
    // Empty relay, socket closed: the stored-close rung.
    const first = renderMarkets();
    await awaitHero();
    const h2 = () => within(hero()).getByRole("heading", { level: 2 });
    await waitFor(() => expect(text(h2())).toBe("Stream unavailable, stored closes shown: SPY $647.90 (Sep 18, 2026 close), QQQ $571.40."));
    expect(text(h2())).toMatch(/^(?:US session|Stream unavailable)/);
    expect(text(hero())).toContain(OFF_HOURS_LEDE);
    expect(hero().querySelector(".mrr-hero-dot")).toBeNull();
    first.unmount();

    // Delayed REST rows with a price and no day change: "SPY $… last".
    live.status = OPEN;
    live.quotes = DELAYED_QUOTES;
    const second = renderMarkets();
    await awaitHero();
    await waitFor(() => expect(text(h2())).toBe("US session closed: SPY $645.12 last, QQQ $572.30, VIX 15.72 (15-minute delayed quotes)."));
    expect(text(hero())).toContain(OFF_HOURS_LEDE);
    expect(hero().querySelector(".mrr-hero-dot")).toBeNull();
    second.unmount();

    // US ticks inside the live window: the live sentence, the live lede and the pulsing dot.
    live.quotes = LIVE_QUOTES;
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(text(h2())).toBe("US session live: SPY +0.42%, QQQ +1.01%, VIX 15.72 (delayed quote)."));
    expect(text(hero())).toContain(LIVE_LEDE);
    expect(hero().querySelector(".mrr-hero-dot")).not.toBeNull();
    // The SPY figure in the sentence equals the tape's SPY Day % cell.
    const table = (byId("watchlist") as HTMLElement).querySelector("table") as HTMLTableElement;
    const dcIndex = headerIndex(table, "Day %");
    expect(dcIndex).toBeGreaterThan(0);
    expect(text(tapeRow("SPY").querySelectorAll("td")[dcIndex])).toBe("+0.42%");
  });

  it("the hero svg is the one-week return chart with one rect per stored ETF sorted by ret_1w, and the SPY label equals the tape's SPY 1W cell", async () => {
    renderMarkets();
    await awaitHero();
    const svg = await waitFor(() => {
      const el = hero().querySelector("svg[role='img']");
      expect(el).not.toBeNull();
      return el as SVGSVGElement;
    });
    expect(svg).toHaveAttribute("aria-label", "One-week return by asset");
    expect(svg.querySelectorAll("rect")).toHaveLength(14);
    expect(hero().querySelectorAll("svg[role='img']")).toHaveLength(1);
    const stored = [...DB_SYMBOLS];
    const symbolsInOrder = [...svg.querySelectorAll("text")]
      .map((t) => (t.textContent ?? "").trim())
      .map((t) => stored.find((s) => t === s || t.startsWith(`${s} `)))
      .filter((s): s is string => Boolean(s));
    const expected = [...stored].sort((a, b) => RETS[b][1] - RETS[a][1]);
    expect(symbolsInOrder).toEqual(expected);
    // The caption and the value labels live in the chart slot (inside or beside the svg).
    const viz = text(hero().querySelector(".mrr-hero-viz"));
    expect(viz).toContain("1-WEEK RETURN");
    expect(viz).toContain(fmtSignedPct(RETS.SPY[1], 1)); // "+1.3%"
    for (const s of ["BTC-USD", "ETH-USD", "EURUSD", "USDJPY", "VIX"]) expect(viz).not.toContain(s);
    const table = (byId("watchlist") as HTMLElement).querySelector("table") as HTMLTableElement;
    const w1 = headerIndex(table, "1W %");
    expect(w1).toBeGreaterThan(0);
    expect(text(tapeRow("SPY").querySelectorAll("td")[w1])).toBe("+1.3%");
  });

  it("a symbol without a served ret_1w drops out of the week bars", async () => {
    stubFetch(routes({ "/api/market/daily": () => dailyBars({ EFA: { ret_1w: null } }) }));
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(hero().querySelectorAll("svg[role='img'] rect")).toHaveLength(13));
    const labels = [...hero().querySelectorAll("svg[role='img'] text")].map((t) => (t.textContent ?? "").trim());
    expect(labels.some((t) => t === "EFA" || t.startsWith("EFA "))).toBe(false);
  });

  it("Open a chart is a button that mounts the SPY chart panel; See what's priced is a link to #whats-priced-full", async () => {
    renderMarkets();
    await awaitHero();
    const open = within(hero()).getByRole("button", { name: /Open a chart/ });
    const priced = within(hero()).getByRole("link", { name: /See what's priced/ });
    expect(open).toHaveClass("mrr-hero-btn-primary");
    expect(priced).toHaveClass("mrr-hero-btn-ghost");
    expect(priced).toHaveAttribute("href", "/app/markets#whats-priced-full");
    expect(open.compareDocumentPosition(priced) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(byId("markets-chart-panel")).toBeNull();
    fireEvent.click(open);
    const panel = await screen.findByRole("region", { name: "SPY chart panel" });
    expect(panel.id).toBe("markets-chart-panel");
    // The panel sits between the hero row and the body grid.
    expect(summary().compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(byId("single-name-research") as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(byId("watchlist") as HTMLElement).getByRole("button", { name: "SPY" })).toHaveAttribute("aria-expanded", "true");
  });

  it("closing the panel from the tape returns focus to the row button that opened it", async () => {
    renderMarkets();
    await awaitHero();
    await awaitSection("watchlist");
    const spy = within(byId("watchlist") as HTMLElement).getByRole("button", { name: "SPY" });
    expect(spy).toHaveAttribute("aria-controls", "markets-chart-panel");
    expect(spy).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(spy);
    const panel = await screen.findByRole("region", { name: "SPY chart panel" });
    expect(spy).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(panel).getByRole("button", { name: "Close chart" }));
    await waitFor(() => expect(byId("markets-chart-panel")).toBeNull());
    expect(spy).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(document.activeElement).toBe(spy));
  });

  it("route ?chart=SPY mounts the chart panel with its aria-label", async () => {
    window.history.replaceState(null, "", "/app/markets?chart=SPY");
    renderMarkets({ route: "/app/markets?chart=SPY" });
    await awaitHero();
    const panel = await screen.findByRole("region", { name: "SPY chart panel" });
    expect(panel.id).toBe("markets-chart-panel");
    await waitFor(() => expect(within(byId("watchlist") as HTMLElement).getByRole("button", { name: "SPY" })).toHaveAttribute("aria-expanded", "true"));
  });

  it("the summary dl has the dt labels in order with the US 10Y value from the credit fixture; Dollar rides the stored UUP bar and VIX is omitted without a quote", async () => {
    renderMarkets();
    await awaitHero();
    expect(within(summary()).getByRole("heading", { level: 2 })).toHaveTextContent("Cross-asset summary");
    expect(summary()).toHaveClass("mrr-summary");
    await waitFor(() => expect(dts()).toEqual(["US 10Y", "Sectors · 1d", "ETFs · 1w", "Dollar", "Priced", "Top surprise"]));
    expect(text(ddFor("US 10Y"))).toBe("4.27% · +6 bps 1w");
    const bps = [...ddFor("US 10Y").querySelectorAll<HTMLElement>("span")].find((s) => text(s).startsWith("+6 bps"));
    expect(bps, "the bps span").toBeDefined();
    expect(bps?.style.color).toBe("var(--pos)");
    expect(text(ddFor("Sectors · 1d"))).toBe("Technology +1.23% leads · Energy -2.14% lags");
    // Leader in --pos, laggard in --neg: found by their figures so the span may or may not wrap the name.
    const lead = [...ddFor("Sectors · 1d").querySelectorAll<HTMLElement>("span")].find((s) => text(s).includes("+1.23%"));
    const lag = [...ddFor("Sectors · 1d").querySelectorAll<HTMLElement>("span")].find((s) => text(s).includes("-2.14%"));
    expect(lead, "the leader span").toBeDefined();
    expect(lag, "the laggard span").toBeDefined();
    expect(lead?.style.color).toBe("var(--pos)");
    expect(lag?.style.color).toBe("var(--neg)");
    expect(text(ddFor("Dollar"))).toBe("UUP -0.24% 1d · -0.9% 1w");
    // The stored ETFs' one-week leader and laggard, the served ret_1w as the week bars print it.
    expect(text(ddFor("ETFs · 1w"))).toBe("Silver +3.1% leads · Oil (WTI) -2.4% lags");
    expect(dts()).not.toContain("Single names · 1d");
    expect(text(ddFor("Priced"))).toBe("10Y breakeven 2.19% · 10Y real 1.91%");
    expect(text(ddFor("Top surprise"))).toBe("SPY rose 2.3% on the week; the largest weekly gain since June.");
    expect(text(ddFor("Top surprise"))).not.toContain("\u2014");
    expect(dts()).not.toContain("VIX · delayed");
    // Never an empty dd.
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
  });

  it("with UUP and VIX quotes the Dollar and VIX rows render from the feed's own figures, in the C.2 order", async () => {
    live.status = OPEN;
    live.quotes = LIVE_QUOTES;
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(ALL_LABELS));
    expect(text(ddFor("Dollar"))).toBe("UUP +0.31% 1d · -0.9% 1w");
    // The as-of word is vix_delayed's §5 word (absent from this fixture's
    // report: "As of unknown"); the row label carries "delayed".
    expect(text(ddFor("VIX · delayed"))).toBe("15.72 · -0.63% 1d · As of unknown");
    expect(ddFor("VIX · delayed").querySelector("[data-metric]")).toHaveAttribute("data-metric", "vix-live");
  });

  it("a VIX quote without a day change omits that half; without a UUP quote and a UUP bar the Dollar row is omitted", async () => {
    live.status = OPEN;
    live.quotes = quotesOf(quote("VIX", 16.04));
    stubFetch(routes({ "/api/market/daily": () => dailyBars({}, ["UUP"]) }));
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(["US 10Y", "Sectors · 1d", "ETFs · 1w", "VIX · delayed", "Priced", "Top surprise"]));
    expect(text(ddFor("VIX · delayed"))).toBe("16.04 · As of unknown");
  });

  it("summary rows read the loading note while their hooks are pending and the error note when they fail", async () => {
    stubFetch(routes({ "/api/credit/oas": PENDING, "/api/surprises": () => ({ status: 500, body: { detail: "down" } }) }));
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(dts()).toContain("Top surprise"));
    expect(text(ddFor("US 10Y"))).toBe("Reading stored data…");
    await waitFor(() => expect(text(ddFor("Top surprise"))).toBe("Unavailable: the data service did not answer."));
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
  });

  it.each<[word: string, title: string, status: StreamStatus, quotes: Map<string, LiveQuote>, tone: string, detail: RegExp]>([
    // Iteration 1 step 5 (G4): one status line; quiet feeds are the drawer's, the VIX delay the VIX row's.
    ["Live", "Stream connected", OPEN, LIVE_QUOTES, "mint", /^US (?:● )?live$/],
    ["Delayed", "Quotes delayed", OPEN, DELAYED_QUOTES, "amber", /^US session closed$/],
    ["Off", "Live feeds off", OFF, new Map(), "gray", /^stored closes and delayed quotes only$/],
    ["Reconnecting", "Stream reconnecting", RECONNECTING, new Map(), "gray", /^stored closes on the tape · retrying$/],
    ["Backend unavailable", "Stream unavailable", BACKEND_DOWN, new Map(), "gray", /^showing stored closes$/],
  ])("status strip: streamWord %s titles the strip %s", async (_word, title, status, quotes, tone, detail) => {
    live.status = status;
    live.quotes = quotes;
    renderMarkets();
    await awaitHero();
    const button = await awaitStrip();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveClass("mrr-status");
    expect(button).toHaveAttribute("data-tone", tone);
    expect(stripTitle(button)).toBe(title);
    expect(stripDetail(button)).toMatch(detail);
    expect(button.getAttribute("aria-label")).toBe(`${title}. ${stripDetail(button)}. Open the data freshness breakdown.`);
    expect(summary().querySelectorAll(".mrr-status")).toHaveLength(1);
  });

  it("status strip: a degraded relay overrides the tone to amber and leads the detail with the reader word", async () => {
    live.status = DEGRADED;
    live.quotes = LIVE_QUOTES;
    renderMarkets();
    await awaitHero();
    const button = await awaitStrip();
    expect(stripTitle(button)).toBe("Stream connected");
    expect(button).toHaveAttribute("data-tone", "amber");
    expect(stripDetail(button)).toMatch(/^US equity feed silent · US (?:● )?live$/);
  });

  it("clicking the strip calls the shell's openFreshness: a no-op without a provider, the spy with one", async () => {
    const first = renderMarkets();
    await awaitHero();
    fireEvent.click(await awaitStrip());
    first.unmount();

    const openFreshness = vi.fn();
    const openAlerts = vi.fn();
    renderMarkets({ actions: { openFreshness, openAlerts } });
    await awaitHero();
    const button = await awaitStrip();
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(1);
    expect(openAlerts).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(2);
  });

  it("the three left panels and the tape render their headings, descriptions and meta", async () => {
    renderMarkets();
    await awaitHero();
    const single = await awaitSection("single-name-research");
    expect(single.tagName).toBe("SECTION");
    expect(within(single).getByRole("heading", { level: 2 })).toHaveTextContent(/^Single-name research$/);
    expect(text(single)).toContain("Daily candles with volume");
    expect(text(single)).toContain("any listed symbol · EODHD quotes and history · Finnhub fundamentals · delayed");
    // Iteration 1 M3c: the one symbol search rides in the hero's action row.
    expect(within(single).queryByRole("combobox", { name: "Search any listed symbol" })).toBeNull();
    expect(within(hero()).getByRole("combobox", { name: "Search any listed symbol" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox", { name: "Search any listed symbol" })).toHaveLength(1);

    const heat = await awaitSection("sector-heatmap");
    expect(heat.tagName).toBe("SECTION");
    expect(within(heat).getByRole("heading", { level: 2 })).toHaveTextContent(/^Sector heatmap$/);
    expect(text(heat)).toContain("One-day moves from stored closes");
    // Iteration 1 step 6 (A1): the header's as-of is the stored-close stamp
    // (market_daily's §5 word), not the newest row date.
    await waitFor(() => expect(text(heat)).toContain("daily closes"));
    expect(heat.querySelector("[data-stamp]")?.textContent).toMatch(/^Stored closes · /);

    const surprises = await awaitSection("top-surprises");
    expect(surprises.tagName).toBe("SECTION");
    expect(within(surprises).getByRole("heading", { level: 2 })).toHaveTextContent(/^Top surprises this week$/);
    expect(text(surprises)).toContain("Weekly moves ranked by z-score");
    // Iteration 1 step 6 (A1): the week is the section's stamp.
    await waitFor(() => expect(text(surprises)).toContain("weekly derived series"));
    expect(surprises.querySelector("[data-stamp]")?.textContent).toBe("Derived pipeline · week ending Sep 18, 2026");

    const tape = await awaitSection("watchlist");
    expect(tape.tagName).toBe("SECTION");
    expect(within(tape).getByRole("heading", { level: 2 })).toHaveTextContent(/^Macro tape$/);
    // Iteration 1 M3b: no view toggle; the single names sit under the macro tape.
    expect(within(tape).queryByRole("group", { name: "Tape view" })).toBeNull();
    expect(tape.contains(byId("single-names"))).toBe(true);
    expect(tape.querySelector("table.mrr-tape")).not.toBeNull();
    expect(tape.querySelectorAll("tr.mrr-grp")).toHaveLength(8);
    expect(text(tape)).toContain("stream unavailable · showing stored closes");

    const priced = await awaitSection("whats-priced-full");
    expect(priced.tagName).toBe("SECTION");
    expect(within(priced).getByRole("heading", { level: 2 })).toHaveTextContent(/^What's priced$/);
    expect(text(priced)).toContain("Market-implied path for policy, inflation and real rates");
    // Iteration 1 step 6 (A1): the latest date is the section's stamp.
    await waitFor(() => expect(text(priced)).toContain("FRED via weekly pipeline"));
    expect(priced.querySelector("[data-stamp]")?.textContent).toBe("Weekly pipeline · latest Sep 18, 2026");
  });

  it("#single-name-research shows the empty prompt and no range picker until a symbol is chosen", async () => {
    renderMarkets();
    await awaitHero();
    const single = await awaitSection("single-name-research");
    expect(text(single)).toContain(EMPTY_PROMPT);
    expect(screen.queryByTestId("single-name")).toBeNull();
    expect(within(single).queryByRole("group", { name: "Chart range" })).toBeNull();
  });

  it("route ?name=NVDA mounts SingleName with NVDA, the empty prompt gone, and the panel header owns the Chart range picker at 6M", async () => {
    window.history.replaceState(null, "", "/app/markets?name=NVDA");
    renderMarkets({ route: "/app/markets?name=NVDA" });
    await awaitHero();
    const single = await awaitSection("single-name-research");
    const stub = await within(single).findByTestId("single-name");
    expect(stub).toHaveTextContent("NVDA");
    expect(text(single)).not.toContain(EMPTY_PROMPT);
    const group = within(single).getByRole("group", { name: "Chart range" });
    expect(within(group).getAllByRole("button").map((b) => text(b))).toEqual(["1D", "5D", "1M", "6M", "1Y", "5Y", "MAX"]);
    expect(within(group).getByRole("button", { name: "6M" })).toHaveAttribute("aria-pressed", "true");
    expect(stub).toHaveAttribute("data-range", "6M");
    fireEvent.click(within(group).getByRole("button", { name: "1Y" }));
    expect(within(group).getByRole("button", { name: "1Y" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveAttribute("data-range", "1Y"));
  });

  it("#sector-heatmap: four tiles labelled symbol · name with signed values, the 1W note, the tint rule on the new hues and the caption", async () => {
    renderMarkets();
    await awaitHero();
    const heat = await awaitSection("sector-heatmap");
    await waitFor(() => expect(tiles(heat)).toHaveLength(4));
    const [xlf, xle, xli, xlk] = tiles(heat);
    expect(text(xlf)).toContain("XLF · Financials");
    expect(text(xle)).toContain("XLE · Energy");
    expect(text(xli)).toContain("XLI · Industrials");
    expect(text(xlk)).toContain("XLK · Technology");
    expect(text(xlf)).toContain("+0.42%");
    expect(text(xle)).toContain("-2.14%");
    expect(text(xli)).toContain("-0.15%");
    expect(text(xlk)).toContain("+1.23%");
    expect(text(xlf)).toContain("1W +1.1%");
    expect(text(xle)).toContain("1W -1.6%");
    // Tint: XLK at mag 1 (mint gradient), XLE at mag 2 (red gradient), the two under 1% plain.
    expect(xlk.getAttribute("style") ?? "").toMatch(/linear-gradient/);
    expect(xlk.getAttribute("style") ?? "").toMatch(/40, ?209, ?124/);
    expect(xle.getAttribute("style") ?? "").toMatch(/linear-gradient/);
    expect(xle.getAttribute("style") ?? "").toMatch(/240, ?80, ?63/);
    expect(xlf.getAttribute("style") ?? "").not.toMatch(/linear-gradient/);
    expect(xli.getAttribute("style") ?? "").not.toMatch(/linear-gradient/);
    expect(heat.innerHTML).not.toMatch(/63, ?185, ?80|218, ?54, ?51/);
    expect(text(heat)).toContain("One-day sector moves from stored closes; tint steps at ±1% and ±2%. Sector ETFs are not on the live stream; this block moves once a day.");
  });

  it("#top-surprises renders a DataTable with ten rows, the rank, label and tidied interpretation, a σ cell per row coloured by the displayed value, and the Calendar link", async () => {
    renderMarkets();
    await awaitHero();
    const section = await awaitSection("top-surprises");
    const table = await waitFor(() => {
      const t = section.querySelector("table");
      expect(t).not.toBeNull();
      return t as HTMLTableElement;
    });
    expect([...table.querySelectorAll("thead th")].map((th) => text(th))).toEqual(["#", "Release", "Surprise", "σ"]);
    const rows = [...table.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(10);
    rows.forEach((row, i) => {
      const cells = [...row.querySelectorAll("td")];
      expect(text(cells[0]), `rank ${i + 1}`).toBe(String(i + 1));
      expect(text(cells[1]), `label ${i + 1}`).toContain(SURPRISES[i].label);
      const sigma = cells.find((c) => /[+-]\d\.\dσ$/.test(text(c))) as HTMLTableCellElement;
      expect(sigma, `σ cell ${i + 1}`).toBeDefined();
      expect(text(sigma)).toBe(EXPECTED_SIGMA[i]);
      expect(colorOf(sigma), `σ colour ${i + 1} (${EXPECTED_SIGMA[i]})`).toBe(EXPECTED_SIGMA_COLOR[i]);
    });
    expect(text(rows[0])).toContain("SPY rose 2.3% on the week; the largest weekly gain since June.");
    expect(text(section)).not.toContain("week \u2014 the");
    expect(within(section).getByRole("link", { name: /Calendar/ })).toHaveAttribute("href", "/app/news#calendar");
    expect(within(section).getByRole("button", { name: "z-score" })).toHaveClass("jargon");
    expect(text(section)).toContain("Bars scale to 3σ; ±1.5σ turns amber, ±2.5σ red.");
    expect(text(section)).toContain("macro rows read this pipeline, not the monthly signal prints on the dashboard");
  });

  it("#top-surprises prints the state copy in place of the table while loading, on error and when empty", async () => {
    stubFetch(routes({ "/api/surprises": PENDING }));
    const pending = renderMarkets();
    const section = await awaitSection("top-surprises");
    await waitFor(() => expect(text(section)).toContain("Ranking the week's moves…"));
    expect(section.querySelector("table")).toBeNull();
    pending.unmount();

    stubFetch(routes({ "/api/surprises": () => ({ status: 500, body: { detail: "down" } }) }));
    const failed = renderMarkets();
    const s2 = await awaitSection("top-surprises");
    await waitFor(() => expect(text(s2)).toContain("Surprise feed unavailable: the data service did not answer."));
    expect(s2.querySelector("table")).toBeNull();
    failed.unmount();

    stubFetch(routes({ "/api/surprises": () => [] }));
    renderMarkets();
    const s3 = await awaitSection("top-surprises");
    await waitFor(() => expect(text(s3)).toContain("No surprise data on file for this week."));
    expect(s3.querySelector("table")).toBeNull();
  });

  it("#whats-priced-full: three tiles with row headers, Level and MoM only, the deltas in pp, the term note and the Methodology link", async () => {
    renderMarkets();
    await awaitHero();
    const section = await awaitSection("whats-priced-full");
    await waitFor(() => expect(section.querySelectorAll("th[scope='row']")).toHaveLength(6));
    const tileEls = tiles(section);
    expect(tileEls).toHaveLength(3);
    // The tile titles are sub-eyebrow headings under the panel h2 (checklist B.8 writes h4; h3 keeps the outline unbroken, both accepted).
    expect([...section.querySelectorAll("h3, h4")].map((h) => text(h))).toEqual(["Policy rate proxies", "Inflation breakevens", "Real yields (TIPS)"]);
    expect([...section.querySelectorAll("th[scope='row']")].map((th) => text(th))).toEqual(["Fed funds", "SOFR", "5Y breakeven", "10Y breakeven", "5Y real yield", "10Y real yield"]);
    const colHeaders = [...section.querySelectorAll("th[scope='col']")].map((th) => text(th));
    expect(new Set(colHeaders)).toEqual(new Set(["Metric", "Level", "MoM"]));
    for (const th of section.querySelectorAll("th")) expect(text(th)).not.toMatch(/^1W\b|1Y range/i);
    const t = text(section);
    for (const level of ["4.08%", "4.06%", "2.36%", "2.19%", "1.57%", "1.91%"]) expect(t).toContain(level);
    expect(t).toMatch(/▲\s*\+0\.04pp/); // T5YIE up
    expect(t).toMatch(/▼\s*-0\.02pp/); // SOFR down
    expect(t).toMatch(/→\s*0\.00pp/); // FEDFUNDS flat
    // The 10Y breakeven row has no MoM: the dash, never "nullpp".
    const be10 = [...section.querySelectorAll("tbody tr")].find((r) => text(r).startsWith("10Y breakeven")) as HTMLElement;
    expect(text(be10)).toContain(DASH);
    expect(t).not.toContain("null");
    expect(t).toContain("5Y breakeven sits 0.17pp above 10Y: near-term inflation concern, longer term anchored.");
    expect(t).toContain("· composed from stored data");
    expect(t).toContain("From the weekly derived-metrics pipeline, so levels can differ from the monthly signal prints on the dashboard.");
    expect(t).toContain("Where the overnight rate actually sits: the hurdle every risk asset has to clear.");
    expect(within(section).getByRole("button", { name: "TIPS" })).toHaveClass("jargon");
    expect(within(section).getByRole("link", { name: /Methodology/ })).toHaveAttribute("href", "/app/methodology#data");
  });

  it("#whats-priced-full prints its state copy while loading, on error and when empty", async () => {
    stubFetch(routes({ "/api/priced": PENDING }));
    const pending = renderMarkets();
    const s1 = await awaitSection("whats-priced-full");
    await waitFor(() => expect(text(s1)).toContain("Reading market-implied pricing…"));
    expect(s1.querySelector("th[scope='row']")).toBeNull();
    pending.unmount();

    stubFetch(routes({ "/api/priced": () => ({ status: 500, body: { detail: "down" } }) }));
    const failed = renderMarkets();
    const s2 = await awaitSection("whats-priced-full");
    await waitFor(() => expect(text(s2)).toContain("Market-implied pricing unavailable: the data service did not answer."));
    failed.unmount();

    stubFetch(routes({ "/api/priced": () => [] }));
    renderMarkets();
    const s3 = await awaitSection("whats-priced-full");
    await waitFor(() => expect(text(s3)).toContain("No priced metrics on file; the weekly pipeline has not written them yet."));
    expect(text(s3)).toContain("FRED via weekly pipeline");
  });

  it("the tape sorts single names by day move with unquoted rows last, and the sort meta reads the live word only with US ticks", async () => {
    live.status = OPEN;
    live.quotes = quotesOf(quote("NVDA", 184.2, { dc: 2.1 }), quote("AAPL", 231.5, { dc: -0.5 }), quote("SPY", 645.12));
    window.history.replaceState(null, "", "/app/markets#single-names");
    renderMarkets({ route: "/app/markets#single-names" });
    await awaitHero();
    const singles = await awaitSection("single-names");
    const order = [...singles.querySelectorAll("tbody tr:not(.mrr-grp)")].map((r) => text(r.querySelector("button")));
    const rest = SINGLE_NAMES.map((d) => d.symbol).filter((s) => s !== "NVDA" && s !== "AAPL");
    expect(order).toEqual(["NVDA", "AAPL", ...rest]);
    expect(text(singles)).toContain("sorted by day move · re-sorts as data updates");
  });

  it("#single-names renders inside #watchlist on the plain route and on the #single-names route, with the macro groups beside it", async () => {
    const plain = renderMarkets();
    await awaitHero();
    const first = await awaitSection("single-names");
    expect((byId("watchlist") as HTMLElement).contains(first)).toBe(true);
    expect(first.querySelectorAll("tbody tr:not(.mrr-grp)")).toHaveLength(12);
    plain.unmount();

    window.history.replaceState(null, "", "/app/markets#single-names");
    renderMarkets({ route: "/app/markets#single-names" });
    await awaitHero();
    const singles = await awaitSection("single-names");
    expect((byId("watchlist") as HTMLElement).contains(singles)).toBe(true);
    expect(singles.querySelectorAll("tbody tr:not(.mrr-grp)")).toHaveLength(12);
    expect((byId("watchlist") as HTMLElement).querySelectorAll("tr.mrr-grp")).toHaveLength(8);
  });

  it("renders the section ids in document order inside main, the ids the palette expects, and the DisclosureLine last", async () => {
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(dts()).toContain("Top surprise"));
    await waitFor(() => expect((byId("whats-priced-full") as HTMLElement).querySelectorAll("th[scope='row']")).toHaveLength(6));
    const els = IDS_IN_ORDER.map((id) => byId(id));
    IDS_IN_ORDER.forEach((id, i) => expect(els[i], id).not.toBeNull());
    const main = document.querySelector("main") as HTMLElement;
    for (const el of els) expect(main.contains(el)).toBe(true);
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${IDS_IN_ORDER[i - 1]} before ${IDS_IN_ORDER[i]}`).toBeTruthy();
    }
    for (const id of ["single-name-research", "watchlist", "sector-heatmap", "single-name-movers", "whats-priced-full", "top-surprises"]) expect((byId(id) as HTMLElement).tagName, id).toBe("SECTION");
    const line = main.querySelector("p.mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(text(line)).toBe(DISCLOSURE_LINE);
    const all = [...main.querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(main.querySelectorAll(".mrr-disclosure-line")).toHaveLength(1);
    expect(text(main)).not.toContain("\u2014 the");
  });

  it("daily pending renders the reading headline and no pill; the session sentence still renders", async () => {
    stubFetch(routes({ "/api/market/daily": PENDING }));
    renderMarkets();
    expect(await screen.findByText("Reading the tape…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reading the tape…");
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    expect(text(hero())).not.toContain(ERROR_HEADLINE); // the freshness chips may print the word Unavailable; the error copy may not
    expect(text(within(hero()).getByRole("heading", { level: 2 }))).toMatch(/^(?:US session|Stream unavailable)/);
  });

  it("daily 404 without data renders the error headline with the Unavailable pill while the summary still renders", async () => {
    stubFetch(without("/api/market/daily"));
    renderMarkets();
    // The heatmap and the Sectors row print the same sentence (CP4), so the headline is read in the hero.
    await waitFor(() => expect(hero()).not.toBeNull());
    expect(await within(hero()).findByText(ERROR_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Stored closes unavailable");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const pill = hero().querySelector(".mrr-pill");
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(screen.queryByText("Reading the tape…")).toBeNull();
    expect(text(within(hero()).getByRole("heading", { level: 2 }))).toBe("Stream unavailable, stored closes shown: SPY unquoted.");
    await waitFor(() => expect(text(ddFor("US 10Y"))).toBe("4.27% · +6 bps 1w"));
    expect(hero().querySelector("svg[role='img']")).toBeNull();
  });

  it("daily 404 with seeded cache data renders no error copy", async () => {
    stubFetch(without("/api/market/daily"));
    const client = makeClient();
    const key = ["market", "daily", DAILY_FETCH.join(","), 60];
    // Seeded like the validated snapshot: older than the hook's 15-minute
    // staleTime, so the mount refetches, the refetch 404s, and the seeded
    // closes must stay on screen.
    client.setQueryData(key, DAILY_BARS, { updatedAt: NOW_MS - 30 * 60_000 });
    renderMarkets({ client });
    await awaitHero();
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
    expect(client.getQueryData(key)).toEqual(DAILY_BARS);
    expect(screen.queryByText(ERROR_HEADLINE)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Mixed");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("2 of 4 sectors up");
    expect(hero().querySelectorAll("svg[role='img'] rect")).toHaveLength(14);
  });
});

/* ── Iteration 1 (M3): movers, the always-on single names, the hero search ── */

/** Two NYSE sessions of 5-minute bars (13:30Z to 20:00Z), closing at `prev` then `last`. */
function fiveDay(prev: number, last: number) {
  const session = (day: string, close: number) => [
    { ts: `${day}T13:30:00Z`, open: close, high: close, low: close, close: close - 1, volume: 10 },
    { ts: `${day}T20:00:00Z`, open: close, high: close, low: close, close, volume: null },
  ];
  return {
    symbol: "X",
    provider: "eodhd",
    fallback_used: false,
    fallback_reason: null,
    fetched_at: "2026-09-19T15:00:00Z",
    market_ts: "2026-09-18T20:00:00Z",
    delayed: true,
    interval: "5m",
    range: "5D",
    exchange: "US",
    timezone: "America/New_York",
    adjustment: "split_dividend_adjusted",
    count: 4,
    bars: [...session("2026-09-17", prev), ...session("2026-09-18", last)],
  };
}
const searchEnvelope = (hits: { symbol: string; name: string }[]) => ({
  provider: "eodhd",
  fallback_used: false,
  fallback_reason: null,
  fetched_at: "x",
  hits: hits.map((h) => ({ ...h, exchange: "US", type: "Common Stock", sector: null })),
});
const movers = () => byId("single-name-movers") as HTMLElement;
const moverGroup = (label: string) => within(movers()).getByRole("group", { name: label });
const tileSymbols = (group: HTMLElement) => [...group.querySelectorAll<HTMLElement>("button.mrr-mover")].map((b) => b.getAttribute("data-symbol"));

describe("MarketsScreen, Iteration 1 (M3)", () => {
  it("movers: the stream's own day change ranks first with its quote stamp; a name without one reads its last two closes from the 5D candles, stamped Close · Sep 18; names with neither are named plainly", async () => {
    live.status = OPEN;
    live.quotes = quotesOf(quote("NVDA", 184.2, { dc: 2.1 }), quote("TSLA", 402.1, { dc: -1.84 }), quote("AAPL", 231.5, { dc: -0.5 }));
    stubFetch(
      routes({
        "/api/market/candles/MU": () => fiveDay(100, 103),
        "/api/market/candles/AMD": () => fiveDay(200, 198),
      }),
    );
    renderMarkets();
    await awaitHero();
    const gainers = await waitFor(() => {
      const g = moverGroup("Top gainers");
      expect(tileSymbols(g)).toEqual(["MU", "NVDA"]);
      return g;
    });
    expect(tileSymbols(moverGroup("Top losers"))).toEqual(["TSLA", "AMD", "AAPL"]);
    // MU from the candles: 103 against 100, the last completed close stamped.
    const mu = within(gainers).getByRole("button", { name: /MU/ });
    expect(mu).toHaveAttribute("data-source", "close");
    expect(text(mu)).toContain("+3.00%");
    expect(text(mu)).toContain("Close · Sep 18");
    // NVDA from the stream, stamped with the quote's own as-of.
    const nvda = within(gainers).getByRole("button", { name: /NVDA/ });
    expect(nvda).toHaveAttribute("data-source", "quote");
    expect(text(nvda)).toContain("+2.10%");
    expect(text(nvda)).toMatch(/Sep 19, 10:40 ET · 15m/);
    // One gainer slot has no name to fill: a marked slot, never a gap.
    expect(gainers.querySelectorAll("[data-empty='true']")).toHaveLength(1);
    expect(text(gainers)).toContain("No other name up");
    // The seven names with neither a stream change nor two closes are listed.
    await waitFor(() => expect(text(movers())).toContain("No day change on file for MSFT, GOOGL, AMZN, META, AVGO, TSM, COIN"));
    // The summary row reads the same leader and laggard.
    await waitFor(() => expect(text(ddFor("Single names · 1d"))).toBe("MU +3.00% leads · TSLA -1.84% lags"));
    expect(dts().slice(0, 4)).toEqual(["US 10Y", "Sectors · 1d", "Single names · 1d", "ETFs · 1w"]);
  });

  it("movers: while a session trades, today's bars are left out, so the figure is still the last completed close", async () => {
    live.status = OPEN;
    stubFetch(
      routes({
        "/api/freshness": () => ({ ...FRESHNESS, session: { ...FRESHNESS.session, phase: "open", is_open: true } }),
        "/api/market/candles/MU": () => {
          const series = fiveDay(100, 103);
          // A partial Saturday session (today in the fixture clock) at 90.
          return { ...series, bars: [...series.bars, { ts: "2026-09-19T14:00:00Z", open: 90, high: 90, low: 90, close: 90, volume: 5 }] };
        },
      }),
    );
    renderMarkets();
    await awaitHero();
    await waitFor(() => expect(within(movers()).getByRole("button", { name: /MU/ })).toBeInTheDocument());
    const mu = within(movers()).getByRole("button", { name: /MU/ });
    expect(text(mu)).toContain("+3.00%");
    expect(text(mu)).toContain("Close · Sep 18");
  });

  it("movers: with no stream change and no candles the row says so plainly", async () => {
    renderMarkets();
    await awaitHero();
    // CP4: the candles failed too, so the row says the prices did not load.
    await waitFor(() => expect(text(movers())).toContain("Market prices unavailable: the data service did not answer."));
    expect(movers().querySelectorAll("button.mrr-mover")).toHaveLength(0);
  });

  it("a mover opens that ticker's single-name research panel through ?name=, and the panel takes focus", async () => {
    live.status = OPEN;
    live.quotes = quotesOf(quote("NVDA", 184.2, { dc: 2.1 }), quote("TSLA", 402.1, { dc: -1.84 }));
    const scrolled: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    renderMarkets();
    await awaitHero();
    const tsla = await within(movers()).findByRole("button", { name: /TSLA/ });
    fireEvent.click(tsla);
    const single = await awaitSection("single-name-research");
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveTextContent("TSLA"));
    await waitFor(() => expect(scrolled).toContain(single));
    expect(document.activeElement).toBe(single);
    expect(within(single).getByRole("group", { name: "Chart range" })).toBeInTheDocument();
  });

  it("the hero's action row carries the one symbol search, and a pick fills single-name research and moves focus there", async () => {
    stubFetch(routes({ "/api/market/search": () => searchEnvelope([{ symbol: "AMD", name: "Advanced Micro Devices" }]) }));
    renderMarkets();
    await awaitHero();
    const actions = hero().querySelector(".mrr-hero-actions") as HTMLElement;
    const box = within(actions).getByRole("combobox", { name: "Search any listed symbol" });
    fireEvent.change(box, { target: { value: "AMD" } });
    const option = await screen.findByRole("option", undefined, { timeout: 3000 });
    fireEvent.mouseDown(option);
    const single = await awaitSection("single-name-research");
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveTextContent("AMD"));
    expect(document.activeElement).toBe(single);
    expect(single).toHaveAttribute("tabindex", "-1");
  });
});

/* ── Iteration 1, M5: the address follows the research panel ────────────── */

/** The router's search + hash, printed so a case can read the address. */
function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{`${loc.search}${loc.hash}`}</output>;
}
function renderWithProbe(route: string) {
  return renderWithProviders(
    <>
      <main id="main-content">
        <MarketsScreen />
      </main>
      <LocationProbe />
    </>,
    { route },
  );
}
const address = () => screen.getByTestId("location").textContent ?? "";

describe("MarketsScreen, Iteration 1 (M5)", () => {
  it("a search pick writes ?name=<SYM> keeping the hash, a second pick rewrites it, and closing the panel drops it", async () => {
    stubFetch(
      routes({
        "/api/market/search": (url) =>
          (url.searchParams.get("q") ?? "").toUpperCase() === "AMD"
            ? searchEnvelope([{ symbol: "AMD", name: "Advanced Micro Devices" }])
            : searchEnvelope([{ symbol: "NVDA", name: "NVIDIA Corp" }]),
      }),
    );
    renderWithProbe("/app/markets#single-names");
    await awaitHero();
    const box = within(hero()).getByRole("combobox", { name: "Search any listed symbol" });
    fireEvent.change(box, { target: { value: "AMD" } });
    fireEvent.mouseDown(await screen.findByRole("option", undefined, { timeout: 3000 }));
    const single = await awaitSection("single-name-research");
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveTextContent("AMD"));
    await waitFor(() => expect(address()).toBe("?name=AMD#single-names"));
    fireEvent.change(box, { target: { value: "NVDA" } });
    await waitFor(() => expect(screen.getByRole("option")).toHaveTextContent("NVDA"), { timeout: 3000 });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveTextContent("NVDA"));
    await waitFor(() => expect(address()).toBe("?name=NVDA#single-names"));
    fireEvent.click(within(single).getByRole("button", { name: "Close single-name panel" }));
    await waitFor(() => expect(address()).toBe("#single-names"));
    expect(within(single).queryByTestId("single-name")).toBeNull();
  });

  it("Enter on a search with no hits opens a ticker-shaped text as ?name=, and names any other text as a miss", async () => {
    stubFetch(routes({ "/api/market/search": () => searchEnvelope([]) }));
    renderWithProbe("/app/markets");
    await awaitHero();
    const box = within(hero()).getByRole("combobox", { name: "Search any listed symbol" });
    fireEvent.change(box, { target: { value: "zzzzqx" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/No listings match "zzzzqx"/), { timeout: 3000 });
    fireEvent.keyDown(box, { key: "Enter" });
    const single = await awaitSection("single-name-research");
    await waitFor(() => expect(within(single).getByTestId("single-name")).toHaveTextContent("ZZZZQX"));
    await waitFor(() => expect(address()).toBe("?name=ZZZZQX"));
    fireEvent.change(box, { target: { value: "no such company" } });
    await waitFor(() => expect(document.body.textContent).toMatch(/No listings match "no such company"/), { timeout: 3000 });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(text(single)).toContain("No listed symbol matches \u201cno such company\u201d."));
    expect(within(single).queryByTestId("single-name")).toBeNull();
    await waitFor(() => expect(address()).toBe(""));
  });
});
