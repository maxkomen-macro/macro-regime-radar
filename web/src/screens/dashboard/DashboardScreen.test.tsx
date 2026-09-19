/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) section E.1,
 * `screens/dashboard/DashboardScreen.test.tsx`: the rebuilt Dashboard
 * (composition B.0, copy C.2, ids D). renderWithProviders + stubFetch with a
 * fixture per route the page reads (unmatched paths 404 so error branches
 * are real); the live-quote store is mocked empty so the glance tiles read
 * stored closes. Fixtures are dated Sep 2026 and never reuse the mockup's
 * numbers: the assertions are the copy rules, not the placeholder figures.
 *
 * Alert recency (7 days) is the one clock-relative rule, so the "recent"
 * fixture is dated from today; everything else is fixed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import DashboardScreen from "./DashboardScreen";
import { NO_SHELL_ACTIONS, ShellActionsContext, type ShellActions } from "../shell/shell-actions";
import type {
  Alert,
  CalendarEvent,
  CreditOAS,
  CreditSeries,
  DailyBar,
  Freshness,
  PricedMetric,
  RecessionMetrics,
  Regime,
  Signal,
  SignalStatus,
  SignalsSnapshot,
  Takeaway,
  TransitionOutlook,
} from "../../api/types";
import { fmtDate } from "../../lib/format";
import { makeClient, renderWithProviders, stubFetch } from "../../test/utils";

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

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const MONTH = "2026-09-01";
const PRIOR_MONTH = "2026-08-01";
const DAILY_DATE = "2026-09-14";
const PRIOR_DATE = "2026-09-11";
const EN_DASH = "\u2013";

const REGIME: Regime = {
  date: MONTH,
  label: "Goldilocks",
  confidence: 0.47,
  growth_trend: 0.31,
  inflation_trend: -0.42,
  prob_goldilocks: 0.58,
  prob_overheating: 0.07,
  prob_stagflation: 0.04,
  prob_recession: 0.31,
};
/** Ascending months: a switch from Recession Risk in Jul 2026, three months in. */
const HISTORY: Regime[] = [
  { ...REGIME, date: "2026-06-01", label: "Recession Risk", prob_goldilocks: 0.33, prob_recession: 0.52, prob_overheating: 0.09, prob_stagflation: 0.06 },
  { ...REGIME, date: "2026-07-01", prob_goldilocks: 0.5, prob_recession: 0.39 },
  { ...REGIME, date: PRIOR_MONTH, prob_goldilocks: 0.55, prob_recession: 0.34 },
  REGIME,
];

const sig = (signal_name: string, value: number, threshold: number, direction: "above" | "below", distance_pct: number, status: SignalStatus, date = MONTH): Signal => ({
  signal_name,
  date,
  value,
  triggered: status === "Triggered",
  threshold,
  direction,
  distance_pct,
  status,
});
/** Five prints; the two CPI signals are carried forward from the August print. */
const SIGNALS: SignalsSnapshot = {
  date: MONTH,
  signals: [
    sig("yield_curve_inversion", 0.52, 0, "below", 26, "Clear"),
    sig("cpi_hot", 3.1, 4, "above", 78, "Watch", PRIOR_MONTH),
    sig("cpi_cold", 3.1, 1.5, "below", 48, "Clear", PRIOR_MONTH),
    sig("vix_spike", 16.42, 30, "above", 41, "Clear"),
    sig("unemployment_spike", 0.1, 0.5, "above", 20, "Clear"),
  ],
};
const SIGNALS_TRIGGERED: SignalsSnapshot = {
  date: MONTH,
  signals: SIGNALS.signals.map((s) => (s.signal_name === "vix_spike" ? sig("vix_spike", 34.1, 30, "above", 100, "Triggered") : s)),
};
const SIGNALS_MISSING: SignalsSnapshot = { date: MONTH, signals: SIGNALS.signals.filter((s) => s.signal_name !== "unemployment_spike") };

const alert = (id: number, name: string, date: string, level: Alert["level"]): Alert => ({
  id,
  date,
  alert_type: "threshold",
  name,
  level,
  value: null,
  threshold: null,
  direction: null,
  message: null,
  created_at: null,
});
/** Newest first, none inside 7 days. */
const ALERTS_CLEAR = [alert(2, "cpi_hot", "2026-08-20", "watch"), alert(1, "vix_spike", "2026-04-08", "risk")];
const RECENT_DATE = daysAgo(2);
const ALERTS_RECENT = [alert(3, "yield_curve_inversion", RECENT_DATE, "watch"), ...ALERTS_CLEAR];

const dated = (dates: string[], values: number[]) => dates.map((date, i) => ({ date, value: values[i] }));
const RECESSION: RecessionMetrics = {
  probability_source: "recession_model",
  recession_prob: 13.7,
  recession_label: "Low Risk",
  recession_color: "#2ecc71",
  yield_curve_spread: 52,
  yield_curve_pct_rank: 61,
  inversion_duration_months: 0,
  is_inverted: false,
  divergence_score: 8,
  divergence_label: "Aligned",
  divergence_color: "#2ecc71",
  recession_prob_series: dated(["2026-05-01", "2026-06-01", "2026-07-01", PRIOR_MONTH], [17.9, 16.4, 15.2, 13.7]),
  yield_curve_series: dated(["2026-05-01", "2026-06-01", "2026-07-01", PRIOR_MONTH], [0.31, 0.4, 0.47, 0.52]),
  usrec_series: [],
  n_training_samples: 420,
  model_features: ["yield_curve", "hy_oas"],
  feature_coefficients: { yield_curve: -0.8, hy_oas: 0.6 },
  data_as_of: PRIOR_MONTH,
  curve_shape: {},
  current_inputs: {},
};

const series = (series_id: string, label: string, value_pct: number, change_1w_bps: number, closes: number[]): CreditSeries => ({
  series_id,
  label,
  date: DAILY_DATE,
  value_pct,
  value_bps: Math.round(value_pct * 100),
  change_1w_bps,
  history: dated(["2026-09-09", "2026-09-10", PRIOR_DATE, DAILY_DATE], closes),
});
const CREDIT: CreditOAS = {
  as_of: DAILY_DATE,
  series: [series("DGS10", "UST10Y", 4.21, 5, [4.11, 4.14, 4.17, 4.21]), series("BAMLC0A0CM", "IG", 0.83, -2, [0.86, 0.85, 0.84, 0.83]), series("BAMLH0A0HYM2", "HY", 2.94, 4, [2.89, 2.9, 2.92, 2.94])],
};
const FEDFUNDS = { series_id: "FEDFUNDS", date: PRIOR_MONTH, value: 4.33 };
const VIX = { series_id: "VIXCLS", date: DAILY_DATE, value: 16.42 };

const PRICED: PricedMetric[] = [
  { group: "Policy", metric: "SOFR", label: "SOFR", unit: "%", date: PRIOR_DATE, value: 4.31, mom_chg: -0.02 },
  { group: "Inflation", metric: "T10YIE", label: "10Y breakeven", unit: "%", date: PRIOR_DATE, value: 2.27, mom_chg: 0.05 },
  { group: "Real yields", metric: "DFII10", label: "10Y real yield", unit: "%", date: PRIOR_DATE, value: 1.84, mom_chg: 0.03 },
];

const FRESHNESS: Freshness = {
  regimes_date: MONTH,
  signals_date: MONTH,
  market_daily_date: DAILY_DATE,
  market_intraday_ts: `${DAILY_DATE}T19:55:00`,
  news_published_at: `${DAILY_DATE}T12:00:00`,
  raw_series_date: DAILY_DATE,
  generated_at: `${DAILY_DATE}T20:05:00`,
  overall: "current",
  session: null,
  sla: [],
  regime: { latest_month: MONTH, expected_month: MONTH, common_feature_month: MONTH, inputs: [], blockers: [] },
  bootstrap: null,
  relay: null,
};

/** Em-dash asides (tidied to semicolons on screen) and a <strong> span in the closing sentence. */
const NARRATIVE =
  "Goldilocks leads the four-way split at 58% odds \u2014 the NBER model reads 13.7% over twelve months. Growth is steady while inflation eases. " +
  "Conditions favour <strong>risk assets</strong>, though valuations limit upside \u2014 drawdown risk rises from current spread levels.";
const TAKEAWAY_SENTENCE = "Conditions favour risk assets, though valuations limit upside; drawdown risk rises from current spread levels.";
const TAKEAWAY: Takeaway = {
  narrative: NARRATIVE,
  conviction: "Medium",
  conviction_color: "#f5b52e",
  primary_signal: "Risk-On",
  divergences: [],
  updated_ago: "2 hours ago",
  regime_probs: { goldilocks: 0.58, overheating: 0.07, stagflation: 0.04, recession: 0.31 },
  current_regime: "Goldilocks",
};
const TRANSITIONS: TransitionOutlook = {
  current_regime: "Goldilocks",
  stay_probability_3m: 81,
  transitions_3m: [{ to: "Recession Risk", probability: 12, color: "#95a5a6" }],
  transitions_6m: [{ to: "Recession Risk", probability: 19, color: "#95a5a6" }],
  narrative_3m: "",
  narrative_6m: "",
  highest_risk_transition: "Recession Risk",
  highest_risk_prob: 12,
  highest_risk_color: "#95a5a6",
};

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null): CalendarEvent => ({ id, event_name, event_datetime, importance, source: "hand-maintained" });
const EVENTS = [ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"), ev(2, "FOMC decision", "2026-09-17T18:00:00Z", "medium"), ev(3, "Jobless claims", "2026-09-18T12:30:00Z", "low")];
const RECENT_EVENTS = [ev(11, "Jobs report (Aug)", "2026-09-04T12:30:00Z", "high")];

const bar = (symbol: string, date: string, close: number, ret_1d: number | null): DailyBar => ({ symbol, date, open: close, high: close, low: close, close, volume: 1_000, vwap: close, ret_1d, ret_1w: null, ret_1m: null });
const STORED = ["SPY", "QQQ", "IWM", "EEM", "TLT", "IEF", "HYG", "LQD", "UUP", "GLD", "SLV", "USO", "CPER"];
const DAILY_BARS: DailyBar[] = STORED.flatMap((s, i) => [bar(s, PRIOR_DATE, 100 + i * 10, null), bar(s, DAILY_DATE, 101.5 + i * 10, 1.5)]);

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
/** Every route the page reads (E.1 list). "/api/calendar/recent" precedes "/api/calendar": stubFetch matches by prefix, first key wins. */
function routes(over: Routes = {}): Routes {
  return {
    "/api/regime/latest": () => REGIME,
    "/api/regime/history": () => HISTORY,
    "/api/regime/intelligence": () => TAKEAWAY,
    "/api/regime/transitions": () => TRANSITIONS,
    "/api/signals/latest": () => SIGNALS,
    "/api/alerts": () => ALERTS_CLEAR,
    "/api/recession/probability": () => RECESSION,
    "/api/credit/oas": () => CREDIT,
    "/series/FEDFUNDS/latest": () => FEDFUNDS,
    "/series/VIXCLS/latest": () => VIX,
    "/api/priced": () => PRICED,
    "/api/freshness": () => FRESHNESS,
    "/api/calendar/recent": () => RECENT_EVENTS,
    "/api/calendar": () => EVENTS,
    "/api/market/daily": () => DAILY_BARS,
    ...over,
  };
}
function withoutRegime(): Routes {
  const r = routes();
  delete r["/api/regime/latest"];
  return r;
}

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderDashboard({ route = "/app/dashboard", actions = {}, client }: { route?: string; actions?: Partial<ShellActions>; client?: QueryClient } = {}) {
  return renderWithProviders(
    <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, ...actions }}>
      <main id="main-content">
        <DashboardScreen />
      </main>
    </ShellActionsContext.Provider>,
    { route, client },
  );
}

/** Text with `hidden` subtrees removed (Jargon tooltips, inactive tab panels, closed accordion panels), whitespace collapsed. */
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
const hero = () => byId("regime-hero") as HTMLElement;
const summary = () => byId("regime-summary") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = () => screen.findByRole("heading", { level: 1, name: "Goldilocks" });
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
const strip = async () => within(summary()).findByRole("button", { name: /Open the alert feed\.$/ });

const LABELS_WATCH = ["Model regime", "Model probability", "Odds", "Model confidence", "Model vs market", "Next 3 months", "Key takeaway", "What changed", "Watch", "Invalidates", "NBER recession model"];
const LABELS_TRIGGERED = LABELS_WATCH.map((l) => (l === "Watch" ? "Triggered" : l));
const KEY_LABELS = ["Fed funds", "Growth trend", "Inflation trend", "10Y Treasury", "VIX", "Yield curve 2s10s", "Recession model · 12m"];
const IDS_IN_ORDER = ["regime-hero", "regime-summary", "signals", "key-levels", "markets-glance", "whats-priced", "us10y", "macro-calendar", "macro-charts", "read-through"];

beforeEach(() => {
  window.localStorage.clear();
  stubFetch(routes());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("DashboardScreen (checklist 03 E.1)", () => {
  it("renders one h1 equal to the regime label with the probability pill, the subhead, the lede, the buttons and the footnote", async () => {
    renderDashboard();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(hero().tagName).toBe("SECTION");
    expect(hero().contains(h1)).toBe(true);
    expect(within(hero()).getByText("Current regime")).toBeInTheDocument();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("58% probability");
    expect(pill).toHaveAttribute("data-tone", "mint");
    expect(h1.parentElement?.contains(pill)).toBe(true); // beside the headline
    expect(within(hero()).getByRole("heading", { level: 2 })).toHaveTextContent("A clear lead over Recession Risk at 31% of the same four-way odds.");
    const heroText = text(hero());
    expect(heroText).toContain("Goldilocks means growth trending up while inflation stays calm: the equity-friendly quadrant.");
    expect(heroText).toContain("The call rests on a growth trend of +0.31 and an inflation trend of -0.42; model confidence of 47% is a separate reading of how firmly the classifier holds the call.");
    expect(heroText).toContain("Recession Risk here is the classifier's fourth quadrant; the NBER recession model is a separate reading, shown in the summary.");
    expect(within(hero()).getByRole("button", { name: "model confidence" })).toHaveClass("jargon");
    expect(within(hero()).getByRole("link", { name: /Explore the regime/ })).toHaveAttribute("href", "/app/regime-lab");
    expect(within(hero()).getByRole("link", { name: /View model details/ })).toHaveAttribute("href", "/app/methodology#models");
    // Iteration 1 step 6 (A3): the month without a browser-counted age; the Macro chip carries the served state.
    expect(heroText).toContain("Macro regime for Sep 2026");
    expect(heroText).not.toMatch(/Macro regime for Sep 2026 \(/);
    expect(heroText).toContain("Model confidence: Medium (47%)");
    // The pill is the only place the dominant figure prints inside the hero.
    expect(heroText.split("58%")).toHaveLength(2);
    // Decision 8: never an image. Iteration 1 D1: the chart slot holds the
    // stacked regime-odds chart (one figure, four bands, the current month
    // marked, one caption), not the gradient placeholder.
    expect(document.querySelector("img")).toBeNull();
    const chart = hero().querySelector("figure[data-chart]") as HTMLElement;
    expect(chart).not.toBeNull();
    expect(chart.querySelector("svg[role='img']")).not.toBeNull();
    expect(chart.querySelectorAll(".mrr-odds-band")).toHaveLength(4);
    expect(chart.querySelector("[data-current-month]")).toHaveAttribute("data-current-month", MONTH);
    expect(chart.querySelectorAll("figcaption")).toHaveLength(1);
    expect(text(chart.querySelector("figcaption"))).toBe("Regime odds · 4 months · widest band is the call");
    expect(hero().querySelector("[style*='135deg']")).toBeNull();
    expect(document.querySelectorAll("figure[data-chart]")).toHaveLength(1);
    expect(screen.queryByText("Reading the latest regime…")).toBeNull();
  });

  it("the hero section text never contains the recession model's probability", async () => {
    renderDashboard();
    await awaitHero();
    await waitFor(() => expect(text(summary())).toContain("13.7% over 12m"));
    const heroText = text(hero());
    expect(heroText).not.toContain("13.7");
    expect(heroText).not.toMatch(/over 12m/);
    expect(heroText).not.toMatch(/Low Risk/);
    expect(heroText).not.toMatch(/\d+(?:\.\d+)?%[^.]*NBER/);
  });

  it("the summary dl has the eleven dt labels in order and the NBER row says a separate model", async () => {
    renderDashboard();
    await awaitHero();
    expect(within(summary()).getByRole("heading", { level: 2 })).toHaveTextContent("Model & market summary");
    await waitFor(() => expect(dts()).toEqual(LABELS_WATCH));
    expect(text(ddFor("Model probability"))).toBe("58%");
    expect(text(ddFor("Model confidence"))).toBe("Medium (47%)");
    expect(text(ddFor("Odds"))).toContain("GL 58%");
    expect(ddFor("Odds").querySelector(".mrr-odds")).not.toBeNull();
    await waitFor(() => expect(text(ddFor("Model vs market"))).toBe("Aligned · +8 on ±100"));
    await waitFor(() => expect(text(ddFor("Next 3 months"))).toBe("Stays Goldilocks 81% · highest-risk path \u2192 Recession Risk 12%"));
    await waitFor(() => expect(text(ddFor("What changed"))).toBe("Switched from Recession Risk in Jul 2026 · 3 months in"));
    expect(text(ddFor("Watch"))).toBe("Inflation pressure (78% of trigger)");
    expect(text(ddFor("Invalidates"))).toBe("CPI > 4.00% YoY · 2s10s < 0.00% · VIX > 30");
    expect(text(ddFor("NBER recession model"))).toBe("13.7% over 12m · Low Risk (a separate model from the 31% Recession Risk regime odds)");
    expect(text(ddFor("NBER recession model"))).toContain("a separate model");
    // The D22 caption lives in the quiet disclosure under the rows.
    const about = within(summary()).getByRole("button", { name: /About model vs market/ });
    expect(about).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(about);
    expect(about).toHaveAttribute("aria-expanded", "true");
    expect(text(summary())).toContain("Divergence check: whether the recession model and market risk pricing tell one story. Score +8 on a");
    expect(text(summary())).toContain("beyond ±20 the divergence is material and requires judgment.");
  });

  it("Triggered replaces Watch as the row label when a signal is triggered", async () => {
    stubFetch(routes({ "/api/signals/latest": () => SIGNALS_TRIGGERED }));
    renderDashboard();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(LABELS_TRIGGERED));
    expect(dts()).not.toContain("Watch");
    expect(text(ddFor("Triggered"))).toBe("Inflation pressure (78% of trigger)");
  });

  it("Model regime is a link to /app/regime-lab", async () => {
    renderDashboard();
    await awaitHero();
    await waitFor(() => expect(dts()).toContain("Model regime"));
    const link = within(ddFor("Model regime")).getByRole("link", { name: "Goldilocks" });
    expect(link).toHaveAttribute("href", "/app/regime-lab");
  });

  it("Key takeaway shows the narrative's closing sentence, tidied, with strong rendered as an element and never injected", async () => {
    renderDashboard();
    await awaitHero();
    await waitFor(() => expect(text(ddFor("Key takeaway"))).toBe(TAKEAWAY_SENTENCE));
    const dd = ddFor("Key takeaway");
    expect(dd.querySelector("strong")).not.toBeNull();
    expect(text(dd.querySelector("strong"))).toBe("risk assets");
    expect(dd.innerHTML).not.toContain("&lt;strong&gt;");
    expect(text(dd)).not.toContain("<strong>");
    expect(text(dd)).not.toContain("\u2014"); // the aside became a semicolon
    // Never the odds-plus-NBER opening sentence.
    expect(text(dd)).not.toContain("13.7");
    expect(text(dd)).not.toContain("58%");
    expect(text(dd)).not.toContain("NBER");
  });

  it("status strip: clear (alerts on file, none in 7 days) is a dialog button that speaks the bell's sentence", async () => {
    renderDashboard();
    await awaitHero();
    const button = await strip();
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveClass("mrr-status");
    expect(button).toHaveAttribute("data-tone", "mint");
    expect(button).toHaveAttribute("aria-label", "No threshold breaches in the last 7 days. Last alert Aug 20, 2026. Open the alert feed.");
    expect(text(button)).toContain("No alerts · 7 days");
    expect(text(button)).toContain("Last alert Aug 20, 2026");
    expect(summary().contains(button)).toBe(true);
  });

  it("status strip: recent breaches read amber with the latest signal and date", async () => {
    stubFetch(routes({ "/api/alerts": () => ALERTS_RECENT }));
    renderDashboard();
    await awaitHero();
    const button = await strip();
    expect(button).toHaveAttribute("data-tone", "amber");
    expect(button).toHaveAttribute("aria-label", "1 threshold breach in the last 7 days. Open the alert feed.");
    expect(text(button)).toContain("1 alert · 7 days");
    // Iteration 1 step 5 (G4): one status line; the drawer's first row is the latest.
    expect(text(button)).toContain(`Curve inversion risk · ${fmtDate(RECENT_DATE)}`);
  });

  it("status strip: loading reads gray and asserts nothing about alerts", async () => {
    stubFetch(routes({ "/api/alerts": () => new Promise(() => {}) }));
    renderDashboard();
    await awaitHero();
    const button = await strip();
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(button).toHaveAttribute("aria-label", "Reading the alert feed. Open the alert feed.");
    expect(text(button)).toMatch(/Reading the alert feed/);
    expect(text(button)).toContain("Opens the alert feed");
    expect(text(button)).not.toMatch(/No alerts/);
  });

  it("status strip: error reads gray with the unavailable copy", async () => {
    stubFetch(routes({ "/api/alerts": () => ({ status: 500, body: { detail: "down" } }) }));
    renderDashboard();
    await awaitHero();
    const button = await strip();
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(button).toHaveAttribute("aria-label", "Alert feed unavailable. Open the alert feed.");
    expect(text(button)).toContain("Alert feed unavailable");
    expect(text(button)).toContain("The data service did not answer");
    expect(text(button)).not.toMatch(/No alerts/);
  });

  it("status strip: an empty feed reads No alerts on file", async () => {
    stubFetch(routes({ "/api/alerts": () => [] }));
    renderDashboard();
    await awaitHero();
    const button = await strip();
    expect(button).toHaveAttribute("data-tone", "mint");
    expect(button).toHaveAttribute("aria-label", "No alerts on file. Open the alert feed.");
    expect(text(button)).toContain("No alerts on file");
    // Iteration 1 step 5 (G4): one status line; the drawer says where the feed starts.
    expect(text(button)).toContain("Opens the alert feed");
  });

  it("clicking the strip calls the shell's openAlerts", async () => {
    const openAlerts = vi.fn();
    const openFreshness = vi.fn();
    renderDashboard({ actions: { openAlerts, openFreshness } });
    await awaitHero();
    const button = await strip();
    fireEvent.click(button);
    expect(openAlerts).toHaveBeenCalledTimes(1);
    expect(openFreshness).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(openAlerts).toHaveBeenCalledTimes(2);
  });

  it("five signal articles carry the badge, Trips when and Signal print lines, the pending suffix only on carried-forward rows, and no svg", async () => {
    renderDashboard();
    const section = await awaitSection("signals");
    await waitFor(() => expect(section.querySelectorAll("article")).toHaveLength(5));
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Monitored signals$/i);
    expect(text(section)).toContain("Bars show distance to trigger · Clear <50% · Watch ≥50% · Triggered = threshold crossed.");
    expect(text(section)).toContain("5 signals · latest Sep 01, 2026");
    expect(within(section).getByRole("link", { name: /View all signals/ })).toHaveAttribute("href", "/app/methodology#signals");

    const expected: [string, string, string, string, string, boolean, string][] = [
      ["Curve inversion risk", "Clear", "0.52%", `Trips when the 10Y${EN_DASH}2Y spread closes below 0.00%.`, "Signal print Sep 2026", false, "Last alert: none on file"],
      ["Inflation pressure", "Watch", "3.10% YoY", "Trips when CPI runs above 4.00% YoY.", "Signal print Aug 2026", true, "Last alert: Aug 20, 2026"],
      ["Disinflation signal", "Clear", "3.10% YoY", "Trips when CPI falls below 1.50% YoY.", "Signal print Aug 2026", true, "Last alert: none on file"],
      ["VIX spike", "Clear", "16.42", "Trips when the VIX closes above 30.00.", "Signal print Sep 2026", false, "Last alert: Apr 08, 2026"],
      ["Unemployment spike", "Clear", "0.10 pp / 3m", "Trips when unemployment rises 0.50 pp or more over 3 months.", "Signal print Sep 2026", false, "Last alert: none on file"],
    ];
    const articles = [...section.querySelectorAll("article")];
    expected.forEach(([name, badge, value, trigger, print, carried, lastAlert], i) => {
      const a = articles[i];
      expect(text(within(a).getByRole("heading", { level: 3 })), name).toBe(name);
      const tag = a.querySelector("[data-tone]");
      expect(text(tag), `${name} badge`).toBe(badge);
      const t = text(a);
      expect(t, `${name} value`).toContain(value);
      expect(t, `${name} trigger`).toContain(trigger);
      expect(t, `${name} print`).toContain(print);
      expect(t.includes("· next monthly print pending"), `${name} pending suffix`).toBe(carried);
      expect(t, `${name} last alert`).toContain(lastAlert);
      expect(t, `${name} meter label`).toContain("Threshold proximity");
      // The lines read in order: Last alert, Trips when, Signal print.
      expect(t.indexOf("Last alert:")).toBeLessThan(t.indexOf("Trips when"));
      expect(t.indexOf("Trips when")).toBeLessThan(t.indexOf("Signal print"));
      expect(a.querySelector("svg"), `${name} sparkline (F1: none served)`).toBeNull();
    });
    expect(section.querySelectorAll("article svg")).toHaveLength(0);
  });

  it("a signal missing from the payload renders the missing-print card", async () => {
    stubFetch(routes({ "/api/signals/latest": () => SIGNALS_MISSING }));
    renderDashboard();
    const section = await awaitSection("signals");
    await waitFor(() => expect(text(section)).toContain("4 signals · latest Sep 01, 2026"));
    const articles = [...section.querySelectorAll("article")];
    expect(articles).toHaveLength(5);
    const card = articles.find((a) => text(a.querySelector("h3")) === "Unemployment spike") as HTMLElement;
    expect(card).toBeDefined();
    const t = text(card);
    expect(t).toContain("No print on file yet for this signal; the daily refresh writes signal prints at 11:17 UTC.");
    expect(text(card.querySelector("[data-tone]"))).toBe("Unavailable");
    expect(t).toContain("Trips when the 3-month rise in unemployment reaches its stored trigger.");
    expect(t).toContain("Signal print · none on file");
    expect(t).not.toContain("Threshold proximity");
    expect(t).not.toContain("Last alert:");
    expect(t).not.toContain("Reading the signal print");
    expect(card.querySelector("svg")).toBeNull();
  });

  it("seven key-level labels; the 10Y value equals the credit fixture on the tile, the US 10Y card and the strip's series", async () => {
    renderDashboard();
    const kl = await awaitSection("key-levels");
    expect(within(kl).getByRole("heading", { level: 2 })).toHaveTextContent(/^Key levels$/i);
    await waitFor(() => {
      for (const label of KEY_LABELS) expect(within(kl).getAllByText(label).length, label).toBeGreaterThan(0);
    });
    // Iteration 1 step 6 (A1): the header drops the month-stamped row date;
    // each tile carries its own source and as-of stamp.
    await waitFor(() => expect(text(kl)).toContain("FRED"));
    expect(kl.querySelectorAll("[data-stamp]").length).toBe(7);
    await waitFor(() => expect(text(kl)).toContain("4.21%"));
    const t = text(kl);
    expect(t).toContain("+5 bps 1w");
    expect(t).toContain("Benchmark long rate · daily close.");
    expect(t).toContain("4.33%");
    expect(t).toContain("Overnight policy rate · monthly average · Aug 2026.");
    expect(t).toContain("16.42");
    // Iteration 1 step 6 (A1): the month-stamped row date left the caption;
    // the tile's stamp carries VIXCLS's own as-of word.
    expect(t).toContain("VIX · Cboe volatility index · daily close.");
    expect(t).toContain("+0.31");
    expect(t).toContain("-0.42");
    expect(t).toContain("3-month slope of the industrial-production z-score; feeds the regime call.");
    expect(t).toContain("3-month slope of the CPI z-score; feeds the regime call.");
    await waitFor(() => expect(text(kl)).toContain("+52 bps"));
    expect(text(kl)).toContain(`The 10Y${EN_DASH}2Y spread holds at +52 bps (0.52%), the 61st percentile of the model's monthly history. Below 0 is an inversion, the classic pre-recession shape.`);
    expect(text(kl)).toContain("13.7%");
    expect(text(kl)).toContain("13.7% sits in the Low Risk band (Elevated starts at 20%, High at 40%). The model trains on NBER dates; inputs through Aug 2026.");
    expect(kl.querySelectorAll("article, .mrr-hero")).toHaveLength(0);

    // The US 10Y card prints the same value, its weekly change and the sparkline.
    const ten = await awaitSection("us10y");
    expect(within(ten).getByRole("heading", { level: 2 })).toHaveTextContent(/^US 10Y Treasury$/i);
    expect(text(ten)).toContain("US 10 Year Yield");
    expect(text(ten)).toContain("4.21%");
    expect(text(ten)).toContain("+5 bps");
    // Iteration 1 step 6 (A1): the provenance line ends in the card's stamp,
    // DGS10's own as-of word (the fixture's report carries no series: unknown),
    // never the month-stamped row date.
    expect(text(ten)).toContain("10-year Treasury yield · daily close · FRED DGS10 · As of unknown");
    expect(ten.querySelector("[data-stamp]")?.textContent).toBe("FRED DGS10 · As of unknown");
    expect(ten.querySelector("svg path")).not.toBeNull();
    expect(within(ten).getByRole("link", { name: /View rates/ })).toHaveAttribute("href", "/app/credit#financing");
    // And the summary NBER row prints the same recession figure as the tile.
    await waitFor(() => expect(text(ddFor("NBER recession model"))).toMatch(/^13\.7% over 12m/));
  });

  it("macro charts: three accordion buttons closed on load (the regime odds moved to the hero, D1); clicking the first opens its chart", async () => {
    renderDashboard();
    const mc = await awaitSection("macro-charts");
    expect(within(mc).getByRole("heading", { level: 2 })).toHaveTextContent(/^Macro charts$/i);
    expect(text(mc)).toContain("3 series · in-place accordion");
    await waitFor(() => expect(mc.querySelectorAll("button[aria-expanded]")).toHaveLength(3));
    const buttons = [...mc.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
    expect(buttons.map((b) => b.getAttribute("aria-expanded"))).toEqual(["false", "false", "false"]);
    expect(buttons.map((b) => b.getAttribute("aria-controls"))).toEqual(["chart-curve-panel", "chart-recession-panel", "chart-credit-panel"]);
    // The decorative glyph (aria-hidden) leads each button; the title follows.
    expect(buttons.map((b) => text(b))).toEqual([
      expect.stringMatching(/^\u25b8\s*Yield curve 2s10s · model history/),
      expect.stringMatching(/^\u25b8\s*Recession model probability · history/),
      expect.stringMatching(/^\u25b8\s*Credit spreads · 90 days/),
    ]);
    expect(byId("chart-regime-panel")).toBeNull();
    expect(mc.querySelector("svg[role='img']")).toBeNull();
    for (const id of ["chart-curve-panel", "chart-recession-panel", "chart-credit-panel"]) expect(byId(id)).toHaveAttribute("hidden");
    fireEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute("aria-expanded", "true");
    const panel = byId("chart-curve-panel") as HTMLElement;
    expect(panel).not.toHaveAttribute("hidden");
    expect(panel.querySelector("svg[role='img']")).not.toBeNull();
    expect(text(panel)).toContain("Dips below the dashed zero line are inversions: the shape that has preceded most US recessions.");
    // One panel open at a time (the in-place accordion).
    fireEvent.click(buttons[2]);
    expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
    expect(buttons[2]).toHaveAttribute("aria-expanded", "true");
    expect(text(byId("chart-credit-panel"))).toContain("high-yield at 294 bps, investment-grade at 83 bps; spreads widen when credit stress builds. FRED BAML series, monthly observations.");
  });

  it("read-through disclosures are closed on load; opening shows the two paragraphs and the Methodology link", async () => {
    renderDashboard();
    await awaitHero();
    const rt = await awaitSection("read-through");
    expect(within(rt).getByRole("heading", { level: 2 })).toHaveTextContent(/^How this read is composed$/i);
    expect(text(rt)).toContain("stored data · no model call");
    const current = within(rt).getByRole("button", { name: /Current read-through/ });
    const method = within(rt).getByRole("button", { name: /Method and provenance/ });
    // Byte-identical button labels (the baseline label harvester collapses
    // whitespace and drops the leading glyph): title then the mono meta, no description.
    expect(text(current)).toMatch(/^\u25b8\s*Current read-through\s*composed from stored data$/);
    expect(text(method)).toMatch(/^\u25b8\s*Method and provenance\s*reference$/);
    expect(current).toHaveAttribute("aria-expanded", "false");
    expect(method).toHaveAttribute("aria-expanded", "false");
    expect(text(rt)).not.toContain("The drivers on file");
    expect(screen.queryByRole("link", { name: /Full methodology/ })).toBeNull();

    // Wait for every input of the read-through before opening it.
    await waitFor(() => expect(text(ddFor("NBER recession model"))).toMatch(/^13\.7%/));
    await waitFor(() => expect(text(byId("key-levels"))).toContain("16.42"));
    fireEvent.click(current);
    expect(current).toHaveAttribute("aria-expanded", "true");
    const panel = byId(current.getAttribute("aria-controls") as string) as HTMLElement;
    const paragraphs = [...panel.querySelectorAll("p")].map((p) => text(p));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toBe(
      `The drivers on file: the 10Y${EN_DASH}2Y spread holds at +52 bps (0.52%), the VIX sits at 16.42 (subdued), and high-yield spreads run 294 bps (+4 bps on the week). Growth trend reads +0.31 and inflation trend -0.42; both are 3-month slopes of z-scored macro data.`,
    );
    expect(paragraphs[1]).toBe(
      "What would change the read: a CPI print above 4.00% YoY trips Inflation pressure, a 2s10s close below 0.00% trips Curve inversion risk, and a VIX close above 30.00 trips the vol signal. None of the 5 monitored signals is triggered; 1 sits in Watch.",
    );

    fireEvent.click(method);
    expect(method).toHaveAttribute("aria-expanded", "true");
    const link = within(rt).getByRole("link", { name: /Full methodology/ });
    expect(link).toHaveAttribute("href", "/app/methodology");
    expect(text(byId(method.getAttribute("aria-controls") as string))).toContain("The regime is a 4-way softmax classifier over z-scored growth (industrial production) and inflation (CPI) trends");
    expect(text(byId(method.getAttribute("aria-controls") as string))).toContain("Nothing on this screen is re-derived in the browser.");
  });

  it("the DisclosureLine is present and is the last element in main", async () => {
    renderDashboard();
    await awaitHero();
    await awaitSection("read-through");
    const line = document.querySelector("main .mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.tagName).toBe("P");
    expect(text(line)).toBe(
      "Regime odds, signals and the recession model read from the stored monthly classifier and its NBER-trained logistic model · market tiles from stored daily closes and the EODHD relay (15-minute delayed off-hours) · calendar hand-maintained · nothing on this screen is re-derived in the browser.",
    );
    const all = [...(document.querySelector("main") as HTMLElement).querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(document.querySelectorAll("main .mrr-disclosure-line")).toHaveLength(1);
  });

  it("renders the B.0 section ids in document order, with whats-priced inside markets-glance", async () => {
    renderDashboard();
    await awaitHero();
    await awaitSection("read-through");
    const els = IDS_IN_ORDER.map((id) => byId(id));
    IDS_IN_ORDER.forEach((id, i) => expect(els[i], id).not.toBeNull());
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${IDS_IN_ORDER[i - 1]} before ${IDS_IN_ORDER[i]}`).toBeTruthy();
    }
    const main = document.querySelector("main") as HTMLElement;
    for (const el of els) expect(main.contains(el)).toBe(true);
    expect((byId("markets-glance") as HTMLElement).contains(byId("whats-priced"))).toBe(true);
    // The cards carry their data.
    expect(within(byId("markets-glance") as HTMLElement).getByRole("group", { name: "Asset class" })).toBeInTheDocument();
    await waitFor(() => expect(text(byId("macro-calendar"))).toContain("CPI (Aug)"));
    expect(within(byId("macro-calendar") as HTMLElement).getByRole("link", { name: /View calendar/ })).toHaveAttribute("href", "/app/news#calendar");
    expect(byId("chart-curve-panel")).not.toBeNull();
  });

  it("regime 404 without data renders the error headline and the Unavailable pill", async () => {
    stubFetch(withoutRegime());
    renderDashboard();
    expect(await screen.findByText("Regime unavailable: the data service did not answer. The read resumes when it is back.")).toBeInTheDocument();
    const pill = document.querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(screen.queryByText("Reading the latest regime…")).toBeNull();
    expect(screen.queryByRole("heading", { level: 1, name: "Goldilocks" })).toBeNull();
  });

  it("regime 404 with seeded cache data renders no error copy", async () => {
    stubFetch(withoutRegime());
    const client = makeClient();
    // Seeded like the validated snapshot (api/snapshot.ts): stamped at its
    // build time, older than the hook's 5-minute staleTime, so the mount
    // refetches, the refetch 404s, and the seeded read must stay on screen.
    client.setQueryData(["regime", "latest"], REGIME, { updatedAt: Date.now() - 30 * 60_000 });
    renderDashboard({ client });
    await awaitHero();
    await waitFor(() => expect(client.getQueryState(["regime", "latest"])?.status).toBe("error"));
    expect(client.getQueryData(["regime", "latest"])).toEqual(REGIME);
    expect(screen.queryByText(/Regime unavailable/)).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Goldilocks");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("58% probability");
  });

  it("route #whats-priced selects the What's priced tab", async () => {
    renderDashboard({ route: "/app/dashboard#whats-priced" });
    await awaitHero();
    const group = await screen.findByRole("group", { name: "Asset class" });
    expect(within(group).getByRole("button", { name: /^What.s priced$/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Equities" })).toHaveAttribute("aria-pressed", "false");
    expect(byId("whats-priced")).not.toHaveAttribute("hidden");
    await waitFor(() => expect(text(byId("whats-priced"))).toContain("SOFR"));
    expect(within(byId("whats-priced") as HTMLElement).getByRole("link", { name: "\u2192 See all in Markets" })).toHaveAttribute("href", "/app/markets#whats-priced-full");
  });

  it("route #macro-charts opens the first chart panel", async () => {
    renderDashboard({ route: "/app/dashboard#macro-charts" });
    const mc = await awaitSection("macro-charts");
    await waitFor(() => expect(mc.querySelectorAll("button[aria-expanded]")).toHaveLength(3));
    const [first, ...rest] = [...mc.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")];
    await waitFor(() => expect(first).toHaveAttribute("aria-expanded", "true"));
    for (const b of rest) expect(b).toHaveAttribute("aria-expanded", "false");
    expect(byId("chart-curve-panel")).not.toHaveAttribute("hidden");
    await waitFor(() => expect(byId("chart-curve-panel")?.querySelector("svg[role='img']")).not.toBeNull());
  });
});

// Appended for Phase 10 (checklist 10 C #1 and #2 / E.1, U6-014): the signal
// cards without a row when the feed is down versus when it answers empty.
describe("DashboardScreen signal cards without a row (checklist 10 C #1 and #2)", () => {
  it("a signals 404 with nothing on hand prints the feed-down copy on all five cards and never No print on file", async () => {
    stubFetch(routes({ "/api/signals/latest": () => ({ status: 404, body: { detail: "Not Found" } }) }));
    renderDashboard();
    const section = await awaitSection("signals");
    await waitFor(() => expect(text(section)).toContain("signal feed unavailable"));
    const articles = [...section.querySelectorAll("article")];
    expect(articles).toHaveLength(5);
    for (const a of articles) {
      const t = text(a);
      expect(t).toContain("Signal feed unavailable: the data service did not answer.");
      expect(t).toContain("Signal print · unavailable");
      expect(text(a.querySelector("[data-tone]"))).toBe("Unavailable");
      expect(t).not.toContain("Reading the signal print");
      expect(t).not.toContain("Threshold proximity");
      expect(a.querySelector("svg")).toBeNull();
    }
    expect(text(section)).not.toContain("No print on file");
    expect(text(section)).not.toContain("Signal print · none on file");
  });

  it("an empty signals payload prints the cadence copy on all five cards with the none-on-file line", async () => {
    stubFetch(routes({ "/api/signals/latest": () => ({ date: MONTH, signals: [] }) }));
    renderDashboard();
    const section = await awaitSection("signals");
    await waitFor(() => expect(text(section)).toContain("0 signals · latest Sep 01, 2026"));
    const articles = [...section.querySelectorAll("article")];
    expect(articles).toHaveLength(5);
    for (const a of articles) {
      const t = text(a);
      expect(t).toContain("No print on file yet for this signal; the daily refresh writes signal prints at 11:17 UTC.");
      expect(t).toContain("Signal print · none on file");
      expect(text(a.querySelector("[data-tone]"))).toBe("Unavailable");
      expect(t).not.toContain("Signal feed unavailable");
      expect(t).not.toContain("Signal print · unavailable");
    }
    expect(text(section)).not.toContain("signal feed unavailable");
  });
});
