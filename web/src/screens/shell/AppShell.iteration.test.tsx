/**
 * Iteration 1, Step 1 (shell): contracts E (S3, the collapsible sidebar) and
 * F (S4, the strip leaves the reference tabs; a sidebar freshness entry opens
 * the freshness drawer on every route), exercised on the real AppShell.
 *
 * Harness (same idioms as AppShell.test.tsx): renderWithProviders + stubFetch
 * with minimal valid bodies; all eight screen chunks and the live-quote store
 * are mocked so the tests exercise the shell, not the tabs; a matchMedia keyed
 * by query string is installed at module load (useBreakpoint caches its
 * MediaQueryLists in a module singleton on first render), every query false
 * until a test sets it, so the compact shell (<860, MobileNav) is reachable.
 *
 * Contract E storage: localStorage "mrr.sidebar.v1" = {"version":1,"collapsed":bool};
 * corrupt → expanded; storage unavailable → in memory, no crash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import AppShell from "./AppShell";
import { METHODOLOGY_SLUG, TABS } from "./sections";
import { renderWithProviders, stubFetch } from "../../test/utils";

vi.mock("../dashboard/DashboardScreen", () => ({ default: () => <h1 data-testid="screen">Dashboard screen</h1> }));
vi.mock("../markets/MarketsScreen", () => ({ default: () => <h1 data-testid="screen">Markets screen</h1> }));
vi.mock("../regimelab/RegimeLabScreen", () => ({ default: () => <h1 data-testid="screen">Regime Lab screen</h1> }));
vi.mock("../credit/CreditScreen", () => ({ default: () => <h1 data-testid="screen">Credit screen</h1> }));
vi.mock("../recession/RecessionScreen", () => ({ default: () => <h1 data-testid="screen">Recession screen</h1> }));
vi.mock("../news/NewsScreen", () => ({ default: () => <h1 data-testid="screen">News screen</h1> }));
vi.mock("../tools/ToolsScreen", () => ({ default: () => <h1 data-testid="screen">Tools screen</h1> }));
vi.mock("../methodology/MethodologyScreen", () => ({ default: () => <h1 data-testid="screen">Methodology screen</h1> }));
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

/* ── matchMedia keyed by query (see header) ─────────────────────────────── */
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

/** Below the 860 px shell seam: MobileNav replaces the sidebar. */
function compactShell() {
  MEDIA.set("(max-width: 859.98px)", true);
  MEDIA.set("(min-width: 768px) and (max-width: 1023.98px)", true);
}

/* ── fixtures (AppShell.test.tsx shapes) ───────────────────────────────── */
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
  series: [
    { id: "market_daily", label: "Daily closes (stored)", kind: "market", cadence: "daily", as_of: DAILY, state: "close", delay_min: null, cycles_behind: 0, stale: false, discontinued: false, reason: "Official close of the last completed session." },
    { id: "DGS10", label: "10-year Treasury yield", kind: "fred", cadence: "daily", as_of: daysAgo(2), state: "close", delay_min: null, cycles_behind: 0, stale: false, discontinued: false, reason: "Observed on the newest print due." },
  ],
};
const dailyBar = (symbol: string, date: string, close: number) => ({ symbol, date, open: close, high: close, low: close, close, volume: 1, vwap: close, ret_1d: null, ret_1w: null, ret_1m: null });
const creditOas = {
  as_of: DAILY,
  series: [{ series_id: "DGS10", label: "UST10Y", date: DAILY, value_pct: 4.12, value_bps: 412, change_1w_bps: 5, history: [{ date: daysAgo(2), value: 4.07 }, { date: DAILY, value: 4.12 }] }],
};

const KEY = "mrr.sidebar.v1";
const ROUTES = [...TABS.map((t) => t.slug), METHODOLOGY_SLUG];
const NO_STRIP = new Set(["recession", METHODOLOGY_SLUG]);

function renderShell(route = "/app/dashboard") {
  return renderWithProviders(
    <Routes>
      <Route path="/app/:tab" element={<AppShell />} />
    </Routes>,
    { route },
  );
}

const toggle = () => screen.getByTestId("sidebar-toggle");
const stripRegion = () => screen.queryByRole("region", { name: "Market strip and data freshness" });
/** Shell nav links (anything linking to an /app/ route outside <main>). */
const shellNavLinks = () => Array.from(document.querySelectorAll("a[href^='/app/']")).filter((a) => !a.closest("main"));
const stored = () => {
  const raw = window.localStorage.getItem(KEY);
  return raw == null ? null : (JSON.parse(raw) as unknown);
};
const pressShortcut = (target: Element | Document = document.body, mod: "ctrl" | "meta" = "ctrl") =>
  fireEvent.keyDown(target, { key: "\\", code: "Backslash", ctrlKey: mod === "ctrl", metaKey: mod === "meta" });

async function expectExpanded() {
  await waitFor(() => expect(toggle()).toHaveAttribute("aria-label", "Hide navigation"));
  expect(toggle()).toHaveAttribute("aria-expanded", "true");
  expect(toggle()).toHaveAttribute("aria-controls", "mrr-sidebar");
  const sidebar = document.getElementById("mrr-sidebar");
  expect(sidebar).not.toBeNull();
  expect(sidebar?.contains(toggle())).toBe(true);
  expect(within(sidebar as HTMLElement).getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(document.getElementById("sidebar-watchlist")).not.toBeNull();
  expect(screen.queryByTestId("sidebar-rail")).toBeNull();
}

async function expectCollapsed() {
  const rail = await screen.findByTestId("sidebar-rail");
  await waitFor(() => expect(toggle()).toHaveAttribute("aria-label", "Show navigation"));
  expect(toggle()).toHaveAttribute("aria-expanded", "false");
  expect(rail.contains(toggle())).toBe(true);
  expect(within(rail).getByTestId("sidebar-freshness")).toBeInTheDocument();
  // The full sidebar is not rendered: no nav links, no watchlist.
  expect(shellNavLinks()).toHaveLength(0);
  expect(document.getElementById("sidebar-watchlist")).toBeNull();
  expect(screen.queryByRole("list", { name: "Watchlist" })).toBeNull();
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
  MEDIA.clear();
  vi.restoreAllMocks();
  document.querySelectorAll("[data-e2e-probe]").forEach((n) => n.remove());
});

/* ── S3 · collapsible sidebar ──────────────────────────────────────────── */

describe("S3 collapsible sidebar (desk width)", () => {
  it("renders expanded by default with the Hide navigation toggle wired to #mrr-sidebar", async () => {
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();
  });

  it("the toggle collapses to the rail, writes storage, and moves focus to the new toggle; the rail toggle reopens", async () => {
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();

    toggle().focus();
    fireEvent.click(toggle());
    await expectCollapsed();
    await waitFor(() => expect(stored()).toEqual({ version: 1, collapsed: true }));
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
    // The routed screen still renders; the skip link and main target survive.
    expect(screen.getByTestId("screen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main-content");
    expect(document.getElementById("main-content")).not.toBeNull();

    toggle().focus();
    fireEvent.click(toggle());
    await expectExpanded();
    await waitFor(() => expect(stored()).toEqual({ version: 1, collapsed: false }));
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
  });

  it("restores the collapsed state from storage on mount (persistence round trip)", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, collapsed: true }));
    const first = renderShell();
    await screen.findByTestId("screen");
    await expectCollapsed();
    first.unmount();

    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, collapsed: false }));
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();
  });

  it("corrupt or wrongly shaped storage falls back to expanded", async () => {
    for (const raw of ["{not json", "", "null", "[]", "true", JSON.stringify({ version: 1, collapsed: "yes" })]) {
      window.localStorage.setItem(KEY, raw);
      const r = renderShell();
      await screen.findByTestId("screen");
      await expectExpanded();
      r.unmount();
    }
  });

  it("storage unavailable: no crash, the toggle still works in memory", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "QuotaExceededError");
    });
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();
    fireEvent.click(toggle());
    await expectCollapsed();
    fireEvent.click(toggle());
    await expectExpanded();
  });

  it("Ctrl+Backslash and Meta+Backslash toggle, and focus lands on the new toggle", async () => {
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();

    pressShortcut(document.body, "ctrl");
    await expectCollapsed();
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
    await waitFor(() => expect(stored()).toEqual({ version: 1, collapsed: true }));

    pressShortcut(document.body, "meta");
    await expectExpanded();
    await waitFor(() => expect(document.activeElement).toBe(toggle()));
    await waitFor(() => expect(stored()).toEqual({ version: 1, collapsed: false }));
  });

  it("the shortcut is ignored while focus is in an input or a textarea", async () => {
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();
    for (const tag of ["input", "textarea"] as const) {
      const field = document.createElement(tag);
      field.setAttribute("data-e2e-probe", "");
      document.body.appendChild(field);
      field.focus();
      expect(document.activeElement).toBe(field);
      pressShortcut(field, "ctrl");
      pressShortcut(field, "meta");
      // Give any state update a chance to land before asserting nothing changed.
      await new Promise((r) => setTimeout(r, 30));
      await expectExpanded();
      expect(stored()).not.toEqual({ version: 1, collapsed: true });
    }
  });

  it("the palette lists Hide navigation with the \\ shortcut hint; choosing it collapses and closes the palette; then it offers Show navigation", async () => {
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    let dialog = await screen.findByRole("dialog", { name: "Jump to tab or section" });
    const hide = within(dialog)
      .getAllByRole("option")
      .find((o) => (o.textContent ?? "").includes("Hide navigation"));
    expect(hide, "a palette option with the text Hide navigation").toBeDefined();
    expect(hide?.textContent).toContain("\\");
    expect(within(dialog).queryAllByRole("option").some((o) => (o.textContent ?? "").includes("Show navigation"))).toBe(false);
    fireEvent.click(hide as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jump to tab or section" })).toBeNull());
    await expectCollapsed();

    // Reopen, filter to the action, choose it with Enter.
    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    dialog = await screen.findByRole("dialog", { name: "Jump to tab or section" });
    const input = within(dialog).getByLabelText("Filter destinations");
    fireEvent.change(input, { target: { value: "navigation" } });
    const options = within(dialog).getAllByRole("option");
    const show = options.find((o) => (o.textContent ?? "").includes("Show navigation"));
    expect(show, "a palette option with the text Show navigation").toBeDefined();
    expect(show?.textContent).toContain("\\");
    expect(options.some((o) => (o.textContent ?? "").includes("Hide navigation"))).toBe(false);
    // Move the highlight onto the action, then Enter.
    const index = options.indexOf(show as HTMLElement);
    for (let i = 0; i < index; i++) fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Jump to tab or section" })).toBeNull());
    await expectExpanded();
  });

  it("the skip link stays the first focusable element in both states", async () => {
    const firstFocusable = () =>
      document.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    renderShell();
    await screen.findByTestId("screen");
    await expectExpanded();
    expect(firstFocusable()).toBe(screen.getByRole("link", { name: "Skip to content" }));
    fireEvent.click(toggle());
    await expectCollapsed();
    expect(firstFocusable()).toBe(screen.getByRole("link", { name: "Skip to content" }));
  });
});

describe("S3 below 860 px: MobileNav unchanged, no rail, no toggle", () => {
  it("renders no toggle and no rail even with collapsed storage, and the shortcut does nothing", async () => {
    compactShell();
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, collapsed: true }));
    renderShell();
    await screen.findByTestId("screen");
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("button", { name: /^Menu · current screen Dashboard$/ })).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-toggle")).toBeNull();
    expect(screen.queryByTestId("sidebar-rail")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Sidebar" })).toBeNull();

    pressShortcut(document.body, "ctrl");
    pressShortcut(document.body, "meta");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("sidebar-toggle")).toBeNull();
    expect(screen.queryByTestId("sidebar-rail")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();

    // The open menu still lists the seven tabs, Methodology, the palette jump and the watchlist.
    const menu = within(nav).getByRole("button", { name: /^Menu/ });
    fireEvent.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById("mobile-nav-list") as HTMLElement;
    for (const t of TABS) expect(within(list).getByRole("link", { name: t.label })).toHaveAttribute("href", `/app/${t.slug}`);
    expect(within(list).getByRole("link", { name: /^Methodology/ })).toHaveAttribute("href", `/app/${METHODOLOGY_SLUG}`);
    expect(within(list).getByRole("button", { name: /Jump to a section/ })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /^Watchlist/ })).toBeInTheDocument();
  });
});

/* ── S4 · strip by route, sidebar freshness entry ──────────────────────── */

describe("S4 strip presence by route", () => {
  for (const slug of ROUTES) {
    const present = !NO_STRIP.has(slug);
    it(`/app/${slug}: the ticker strip is ${present ? "present" : "absent from the DOM"}`, async () => {
      renderShell(`/app/${slug}`);
      await screen.findByTestId("screen");
      if (present) {
        const strip = await screen.findByRole("region", { name: "Market strip and data freshness" });
        expect(within(strip).getByRole("button", { name: /^Freshness/ })).toBeInTheDocument();
      } else {
        // Let the shell's freshness query resolve (the sidebar footer states it) before asserting absence.
        await waitFor(() => expect(screen.getByRole("complementary", { name: "Sidebar" }).textContent).toMatch(/market data/i));
        await new Promise((r) => setTimeout(r, 30));
        expect(stripRegion()).toBeNull();
        expect(document.querySelector(".mrr-strip, .mrr-quote, .mrr-upd")).toBeNull();
        expect(screen.queryByRole("button", { name: /^Freshness/ })).toBeNull();
      }
    });
  }
});

describe("S4 sidebar freshness entry opens the freshness drawer", () => {
  for (const slug of ROUTES) {
    it(`/app/${slug}: expanded sidebar footer entry opens the drawer; Escape closes it`, async () => {
      renderShell(`/app/${slug}`);
      await screen.findByTestId("screen");
      const sidebar = document.getElementById("mrr-sidebar") as HTMLElement;
      expect(sidebar).not.toBeNull();
      const entry = within(sidebar).getByTestId("sidebar-freshness");
      expect(entry.tagName).toBe("BUTTON");
      expect(entry).toHaveAccessibleName(/^Data freshness/);
      // The existing footer text stays: the status words and the version.
      expect(sidebar.textContent).toMatch(/v\d+\.\d+\.\d+/);
      expect(sidebar.textContent).toMatch(/market data/i);
      expect(screen.queryByRole("dialog", { name: "Data freshness" })).toBeNull();

      entry.focus();
      fireEvent.click(entry);
      const dialog = await screen.findByRole("dialog", { name: "Data freshness" });
      expect(dialog).toHaveAttribute("id", "freshness-drawer");
      expect(within(dialog).getByText("Stored daily closes")).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data freshness" })).toBeNull());
    });
  }

  it("the collapsed rail carries the same entry on every route", async () => {
    window.localStorage.setItem(KEY, JSON.stringify({ version: 1, collapsed: true }));
    for (const slug of ROUTES) {
      const r = renderShell(`/app/${slug}`);
      await screen.findByTestId("screen");
      const rail = await screen.findByTestId("sidebar-rail");
      const entry = within(rail).getByTestId("sidebar-freshness");
      expect(entry).toHaveAccessibleName(/^Data freshness/);
      fireEvent.click(entry);
      const dialog = await screen.findByRole("dialog", { name: "Data freshness" });
      expect(dialog).toHaveAttribute("id", "freshness-drawer");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data freshness" })).toBeNull());
      r.unmount();
    }
  });

  it("below 860 px the open MobileNav menu has a Data freshness button that opens the drawer", async () => {
    compactShell();
    for (const slug of ["dashboard", "recession", METHODOLOGY_SLUG]) {
      const r = renderShell(`/app/${slug}`);
      await screen.findByTestId("screen");
      const nav = screen.getByRole("navigation", { name: "Primary" });
      fireEvent.click(within(nav).getByRole("button", { name: /^Menu/ }));
      const list = document.getElementById("mobile-nav-list") as HTMLElement;
      const entry = within(list).getByRole("button", { name: /^Data freshness/ });
      fireEvent.click(entry);
      const dialog = await screen.findByRole("dialog", { name: "Data freshness" });
      expect(dialog).toHaveAttribute("id", "freshness-drawer");
      fireEvent.keyDown(document, { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data freshness" })).toBeNull());
      r.unmount();
    }
  });
});
