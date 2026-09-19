/**
 * Phase 1 checklist row 38 (section E): the rebuilt AppShell renders the
 * sidebar, top bar and strip chrome with the landmarks, ids and accessible
 * names every other surface depends on. renderWithProviders + stubFetch with
 * minimal valid bodies; the Dashboard screen and the live-quote store are
 * mocked so the test exercises the shell, not the tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { renderWithProviders, stubFetch } from "../../test/utils";

// The Dashboard chunk is mocked; its <h1> stands in for the TabHero headline
// (Phase 3, checklist 03 A.17): the route's only h1 lives inside <main>.
vi.mock("../dashboard/DashboardScreen", () => ({
  default: () => (
    <div data-testid="dashboard-screen">
      <h1>Goldilocks</h1>
      dashboard
    </div>
  ),
}));
vi.mock("../../live/quotes", () => ({
  LIVE_WINDOW_MS: 120_000,
  useQuotes: () => new Map(),
  useWatch: () => {},
  watch: () => () => {},
  useStreamStatus: () => ({ socket: "closed", feeds: {}, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: null, attempts: 0, everOpened: false }),
  useStreamLive: () => false,
  useStreamWord: () => "Delayed",
  useLiveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamIsLive: () => false,
  liveFeeds: () => ({ us: false, crypto: false, forex: false }),
  streamWord: () => "Delayed",
}));

/** Dates relative to today so every freshness verdict reads "current". */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const MONTH = `${daysAgo(20).slice(0, 7)}-01`;
const DAILY = daysAgo(1);
const INTRADAY = `${DAILY}T19:55:00`;

const regime = { date: MONTH, label: "Goldilocks", confidence: 0.71, growth_trend: 0.4, inflation_trend: -0.2, prob_goldilocks: 0.62, prob_overheating: 0.18, prob_stagflation: 0.12, prob_recession: 0.08 };
const freshness = {
  regimes_date: MONTH,
  signals_date: MONTH,
  market_daily_date: DAILY,
  market_intraday_ts: INTRADAY,
  news_published_at: `${DAILY}T12:00:00`,
  raw_series_date: DAILY,
  generated_at: `${DAILY}T20:05:00`,
  overall: "current",
  session: { exchange: "NYSE", timezone: "America/New_York", phase: "post", is_open: false, today_is_trading_day: true, early_close: false, last_completed_session: DAILY, next_open_utc: `${daysAgo(0)}T13:30:00Z`, calendar_known: true, local_time: `${DAILY}T16:05:00-04:00` },
  sla: [
    { feed: "market_daily", latest: DAILY, expected: DAILY, verdict: "current", reason: "Stored through the last completed session." },
    { feed: "market_intraday", latest: INTRADAY, expected: INTRADAY, verdict: "current", reason: "Bars through the close." },
    { feed: "regime", latest: MONTH, expected: MONTH, verdict: "current", reason: "Regime month matches the expected month." },
  ],
  regime: { latest_month: MONTH, expected_month: MONTH, common_feature_month: MONTH, inputs: [], blockers: [] },
  bootstrap: null,
  relay: { feeds: { us: "off" }, feed_stale: {}, degraded: false, degraded_reasons: [], token_configured: false },
};
const dailyBar = (symbol: string, date: string, close: number) => ({ symbol, date, open: close, high: close, low: close, close, volume: 1, vwap: close, ret_1d: null, ret_1w: null, ret_1m: null });
const creditOas = {
  as_of: DAILY,
  series: [{ series_id: "DGS10", label: "UST10Y", date: DAILY, value_pct: 4.12, value_bps: 412, change_1w_bps: 5, history: [{ date: daysAgo(2), value: 4.07 }, { date: DAILY, value: 4.12 }] }],
};

function renderShell(route = "/app/dashboard") {
  return renderWithProviders(
    <Routes>
      <Route path="/app/:tab" element={<AppShell />} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  stubFetch({
    "/api/regime/latest": () => regime,
    "/api/freshness": () => freshness,
    "/api/alerts": () => [],
    "/api/signals/latest": () => ({ date: MONTH, signals: [] }),
    "/api/market/daily": () => [dailyBar("SPY", daysAgo(2), 640.1), dailyBar("SPY", DAILY, 645.2), dailyBar("QQQ", daysAgo(2), 570.4), dailyBar("QQQ", DAILY, 572.9)],
    "/api/market/intraday": () => [],
    "/api/credit/oas": () => creditOas,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AppShell", () => {
  it("renders the sidebar, top bar and strip chrome with the shell contract intact", async () => {
    renderShell();
    await screen.findByTestId("dashboard-screen");

    // Skip link first, then the inert wrapper and the focus target.
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("shell-content")).not.toBeNull();
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main).toBe(screen.getByRole("main"));
    expect(main).toHaveAttribute("tabindex", "-1");
    expect(document.getElementById("shell-content")?.contains(main)).toBe(true);

    // Sidebar landmark with the wordmark link to the landing page.
    const aside = screen.getByRole("complementary", { name: "Sidebar" });
    const wordmark = within(aside).getByTitle("Macro Regime Radar · landing page");
    expect(wordmark.tagName).toBe("A");
    expect(wordmark).toHaveAttribute("href", "/");
    // Phase 3 (checklist 03 A.15 / A.17): the wordmark is no longer a heading;
    // its text still reads MACRO REGIME RADAR and it still links to "/". Once
    // the Dashboard chunk resolves, the document has exactly one h1 and it
    // sits inside <main> (the TabHero headline), never in the sidebar.
    expect(within(wordmark).queryByRole("heading")).toBeNull();
    expect(wordmark.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(wordmark.textContent?.replace(/\s+/g, " ").trim()).toMatch(/^MACRO ?REGIME RADAR$/);
    const h1 = await screen.findByRole("heading", { level: 1 });
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(main?.contains(h1)).toBe(true);
    expect(aside.contains(h1)).toBe(false);

    // Exactly one primary navigation: seven tab links plus Methodology.
    const navs = screen.getAllByRole("navigation", { name: "Primary" });
    expect(navs).toHaveLength(1);
    const nav = navs[0];
    expect(aside.contains(nav)).toBe(true);
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(TABS.length + 1);
    for (const tab of TABS) {
      const link = within(nav).getByRole("link", { name: tab.label });
      expect(link).toHaveAttribute("href", `/app/${tab.slug}`);
      if (tab.slug === "dashboard") expect(link).toHaveAttribute("aria-current", "page");
      else expect(link).not.toHaveAttribute("aria-current");
    }
    const methodology = within(nav).getByRole("link", { name: "Methodology" });
    expect(methodology).toHaveAttribute("href", `/app/${METHODOLOGY_SLUG}`);
    expect(methodology).not.toHaveAttribute("aria-current");
    expect(screen.queryByRole("button", { name: /menu/i })).toBeNull(); // no MobileNav at desk width
    expect(document.querySelector("[aria-controls='mobile-nav-list']")).toBeNull();

    // The watchlist block lives in the sidebar under its own id.
    const watchlist = document.getElementById("sidebar-watchlist");
    expect(watchlist).not.toBeNull();
    expect(aside.contains(watchlist)).toBe(true);
    expect(within(aside).getByRole("list", { name: "Watchlist" })).toBeInTheDocument();
    expect(within(aside).getByRole("button", { name: "Add to watchlist" })).toBeInTheDocument();

    // Top bar: palette trigger, Ask the analyst chip and the bell, all inside <header>.
    const header = screen.getByRole("banner");
    const palette = within(header).getByRole("button", { name: /Jump to/ });
    expect(palette).toHaveAccessibleName(/⌘\s?K/);
    expect(palette).toHaveAttribute("aria-haspopup", "dialog");
    expect(palette).toHaveAttribute("aria-expanded", "false");
    const ask = within(header).getByRole("button", { name: /Ask the analyst/ });
    expect(ask).toHaveAttribute("aria-controls", "assistant-panel");
    expect(ask).toHaveAttribute("aria-expanded", "false");
    const bell = await within(header).findByRole("button", { name: /alert/i });
    expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    expect(bell).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector(".avatar")).toBeNull();
    expect(header.textContent).not.toMatch(/\bJA\b/);

    // Strip: three quote cards and the freshness card trigger.
    const strip = screen.getByRole("region", { name: "Market strip and data freshness" });
    for (const symbol of ["SPY", "QQQ", "US 10Y"]) {
      expect(within(strip).getByText(new RegExp(`^${symbol}$`, "i"))).toBeInTheDocument();
    }
    await waitFor(() => expect(strip.textContent).toMatch(/4\.12%/));
    const fresh = within(strip).getByRole("button", { name: /^Freshness/ });
    expect(fresh).toHaveAttribute("aria-haspopup", "dialog");
    expect(fresh).toHaveAttribute("aria-expanded", "false");
    expect(fresh).toHaveAttribute("aria-controls", "freshness-drawer");
    await waitFor(() => expect(strip.textContent).toMatch(/Macro monthly/));

    // The tab title.
    await waitFor(() => expect(document.title).toBe("Dashboard · Macro Regime Radar"));
  });

  it("marks the active tab and the title on another route", async () => {
    renderShell("/app/credit");
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Credit" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    await waitFor(() => expect(document.title).toBe("Credit · Macro Regime Radar"));
  });

  it("the freshness card opens the per-source breakdown and Escape closes it", async () => {
    renderShell();
    await screen.findByTestId("dashboard-screen");
    const strip = screen.getByRole("region", { name: "Market strip and data freshness" });
    await waitFor(() => expect(strip.textContent).toMatch(/Macro monthly/));
    const fresh = within(strip).getByRole("button", { name: /^Freshness/ });
    expect(screen.queryByRole("dialog")).toBeNull();

    // A real click focuses the button first; jsdom's synthetic click does not,
    // so focus it explicitly (as CommandPalette.test.tsx does) or the focus
    // return has nowhere to go.
    fresh.focus();
    fireEvent.click(fresh);
    const dialog = await screen.findByRole("dialog", { name: "Data freshness" });
    expect(dialog).toHaveAttribute("id", "freshness-drawer");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(fresh).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById("shell-content")).toHaveAttribute("inert");
    expect(within(dialog).getByText("Stored daily closes")).toBeInTheDocument();
    expect(within(dialog).getByText("Intraday bars (SPY, QQQ)")).toBeInTheDocument();
    expect(within(dialog).getByText("Regime classifier")).toBeInTheDocument();
    expect(within(dialog).getByRole("status", { name: "Data freshness" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Close data freshness" })).toBeInTheDocument();
    expect(dialog.textContent).toMatch(/after hours/);

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.getElementById("shell-content")).not.toHaveAttribute("inert");
    expect(fresh).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(document.activeElement).toBe(fresh));
  });
});

// ── Appended for Phase 10 (checklist 10 B.8 / E.1, QUESTIONS 4): the transitional
// regime pill and odds bar leave the shell; useRegimeLatest still feeds the shell's
// status word and the assistant context. Two harnesses, installed at module load
// (before the first render, since useBreakpoint caches its MediaQueryLists in a
// module singleton and reads `matches` on every measure):
//   1. a matchMedia keyed by query string, so the compact shell (<860, MobileNav)
//      renders in jsdom; every query answers false until a test sets it;
//   2. AssistantPanel wrapped (vi.hoisted + vi.mock with importOriginal) so the
//      tabContext prop the shell passes is observable while the real panel renders.
// Nothing above this line changed.
import { createElement } from "react";

const MEDIA = new Map<string, boolean>();
window.matchMedia = ((query: string) =>
  ({
    get matches() {
      return MEDIA.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

const assistantSeen = vi.hoisted(() => ({ contexts: [] as unknown[] }));
vi.mock("./AssistantPanel", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./AssistantPanel")>();
  const Original = mod.default;
  const Wrapped = (props: Parameters<typeof Original>[0]) => {
    assistantSeen.contexts.push(props.tabContext);
    return createElement(Original, props);
  };
  return { ...mod, default: Wrapped };
});

const lastContext = () => assistantSeen.contexts[assistantSeen.contexts.length - 1] as { key_metrics?: Record<string, unknown>; tab?: string } | undefined;

/** The compact shell: desktop tier (768 to 1023) with the shell seam matched. */
function compactShell() {
  MEDIA.set("(max-width: 859.98px)", true);
  MEDIA.set("(min-width: 768px) and (max-width: 1023.98px)", true);
}

describe("AppShell without the transitional regime pill (checklist 10 B.8)", () => {
  afterEach(() => {
    MEDIA.clear();
    assistantSeen.contexts.length = 0;
  });

  it("renders no .mrr-regime, .mrr-regime-note, .mrr-top-l or .mrr-mnav-regime and no regime loading words in the top bar at desk width", async () => {
    renderShell();
    await screen.findByTestId("dashboard-screen");
    const header = screen.getByRole("banner");
    await waitFor(() => expect(header.textContent).not.toContain("Reading regime…"));
    expect(document.querySelector(".mrr-regime, .mrr-regime-note, .mrr-top-l, .mrr-mnav-regime")).toBeNull();
    expect(header.textContent).not.toContain("Regime unavailable: API error");
    expect(header.textContent).not.toMatch(/Goldilocks/);
    // The chrome the pill sat in still carries the palette trigger, the chip and the bell.
    expect(within(header).getByRole("button", { name: /Jump to/ })).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: /Ask the analyst/ })).toBeInTheDocument();
    expect(await within(header).findByRole("button", { name: /alert/i })).toBeInTheDocument();
  });

  it("renders no pill in the MobileNav row at compact width either", async () => {
    compactShell();
    renderShell();
    await screen.findByTestId("dashboard-screen");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();
    expect(within(nav).getByRole("button", { name: /^Menu · current screen Dashboard$/ })).toBeInTheDocument();
    expect(document.querySelector(".mrr-mnav-regime")).toBeNull();
    expect(document.querySelector(".mrr-regime, .mrr-regime-note, .mrr-top-l")).toBeNull();
    await waitFor(() => expect(nav.textContent).not.toContain("Reading regime…"));
    expect(nav.textContent).not.toContain("Regime unavailable: API error");
    expect(screen.getByRole("banner").textContent).not.toContain("Reading regime…");
  });

  it("the assistant context still reads the regime row from useRegimeLatest (key_metrics.regime)", async () => {
    renderShell();
    await screen.findByTestId("dashboard-screen");
    await waitFor(() => expect(lastContext()?.key_metrics?.regime).toBe("Goldilocks"));
    expect(lastContext()?.tab).toBe("dashboard");
    expect(lastContext()?.key_metrics).toMatchObject({ regime: "Goldilocks", dominant_probability: 0.62, confidence: 0.71, regime_date: MONTH });
  });

  it("the status word still needs the regime query: both shell queries failing reads Data service unavailable, the regime alone answering keeps Delayed", async () => {
    stubFetch({
      "/api/regime/latest": () => ({ status: 404, body: { detail: "down" } }),
      "/api/freshness": () => ({ status: 404, body: { detail: "down" } }),
      "/api/alerts": () => [],
      "/api/signals/latest": () => ({ date: MONTH, signals: [] }),
      "/api/market/daily": () => [],
      "/api/market/intraday": () => [],
      "/api/credit/oas": () => creditOas,
    });
    const first = renderShell();
    await screen.findByTestId("dashboard-screen");
    const strip = screen.getByRole("region", { name: "Market strip and data freshness" });
    await waitFor(() => expect(strip.textContent).toContain("Data service unavailable"));
    expect(screen.getByRole("complementary", { name: "Sidebar" }).textContent).toContain("Data service unavailable");
    first.unmount();

    stubFetch({
      "/api/regime/latest": () => regime,
      "/api/freshness": () => ({ status: 404, body: { detail: "down" } }),
      "/api/alerts": () => [],
      "/api/signals/latest": () => ({ date: MONTH, signals: [] }),
      "/api/market/daily": () => [],
      "/api/market/intraday": () => [],
      "/api/credit/oas": () => creditOas,
    });
    renderShell();
    await screen.findByTestId("dashboard-screen");
    const strip2 = screen.getByRole("region", { name: "Market strip and data freshness" });
    await waitFor(() => expect(strip2.textContent).toContain("Freshness unavailable · retrying"));
    // Iteration 1 step 6 (A3): with no freshness report the market line says its as-of is unknown
    // (never a healthy word), and the footer names market data without a judgement.
    expect(strip2.textContent).toContain("Markets · As of unknown");
    expect(strip2.textContent).not.toContain("Data service unavailable");
    expect(screen.getByRole("complementary", { name: "Sidebar" }).textContent).toContain("Stored market data");
    expect(screen.getByRole("complementary", { name: "Sidebar" }).textContent).toContain("As of unknown");
    await waitFor(() => expect(lastContext()?.key_metrics?.regime).toBe("Goldilocks"));
  });
});
