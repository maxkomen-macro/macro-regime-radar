/**
 * Codex R-31, round 10: the awaiting block across the whole rendered Recession
 * and Credit screens (desk/hardening).
 *
 * Kept outside web/; tests/test_web_fresh_report.py copies web/ to a scratch
 * directory, drops this file into src/screens/, and runs it there with vitest.
 *
 * Codex's repro: the query cache holds a freshness report dating the daily
 * inputs Sep 24 and the monthly ones Aug 2026; the next /api/freshness fetch
 * fails (503), and the cache keeps the report; every payload the screens read
 * answers with its numbers and freshness: {status: "awaiting", reason}. No
 * label anywhere on either screen, in its text or its titles, may carry the
 * cached report's dates; the reason is shown. Without the blocks the same
 * cache prints those dates, so the assertion has something to catch.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import RecessionScreen from "./recession/RecessionScreen";
import CreditScreen from "./credit/CreditScreen";
import type { SpreadLinesChartProps } from "./credit/SpreadLinesChart";
import type { CreditMetrics, DatedValue, Freshness, LboDefaults, RecessionMetrics, Regime, SeriesState } from "../api/types";
import { makeClient, renderWithProviders, stubFetch } from "../test/utils";

vi.mock("./credit/SpreadLinesChart", () => ({
  default: (p: SpreadLinesChartProps) => <div role="img" aria-label={p.ariaLabel} />,
}));

const NOW = new Date("2026-09-25T15:00:00Z");
const REASON = "The freshness of these numbers could not be judged this time: could not read whether desk_series carries provenance";
const AWAITING = { status: "awaiting", reason: REASON } as unknown as Record<string, SeriesState>;
const CACHED_DATES = ["Sep 24", "Aug 2026 print"];

const st = (id: string, cadence: "daily" | "monthly", as_of: string): SeriesState => ({
  id, label: id, kind: "fred", cadence, as_of, state: "close", delay_min: null, cycles_behind: 0, stale: false,
  discontinued: false, reason: `${id} was the latest print.`,
});
const DAILY = ["DGS10", "DGS2", "BAMLH0A0HYM2", "T10YIE", "T5YIE", "BAMLC0A0CM", "BAMLH0A1HYBB", "BAMLH0A2HYB", "BAMLH0A3HYC"];
const CACHED: Freshness = {
  regimes_date: "2026-08-01", signals_date: "2026-09-01", market_daily_date: "2026-09-24", market_intraday_ts: null,
  news_published_at: null, raw_series_date: "2026-09-01", generated_at: "2026-09-24T22:00:00Z",
  series: [...DAILY.map((id) => st(id, "daily", "2026-09-24")), st("UNRATE", "monthly", "2026-08-01"),
           st("INDPRO", "monthly", "2026-08-01"), st("FEDFUNDS", "monthly", "2026-08-01")],
};

const monthsTo = (n: number, lastYm = "2026-09"): string[] => {
  const [y, m] = lastYm.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const idx = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`;
  });
};
const series = (dates: string[], f: (i: number) => number): DatedValue[] => dates.map((date, i) => ({ date, value: f(i) }));

function recession(freshness: Record<string, SeriesState> | undefined): RecessionMetrics {
  const d = monthsTo(23);
  return {
    probability_source: "recession_model", recession_prob: 11.6, recession_label: "Low Risk", recession_color: "#2ecc71",
    yield_curve_spread: 33, yield_curve_pct_rank: 33, inversion_duration_months: 0, is_inverted: false,
    divergence_score: -34, divergence_label: "Macro ahead of markets", divergence_color: "#3498db",
    recession_prob_series: series(d, (i) => 10 + (i % 4) * 0.5), yield_curve_series: series(d, (i) => 0.2 + (i % 3) * 0.1),
    usrec_series: series(d, () => 0), n_training_samples: 281,
    model_features: ["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"],
    feature_coefficients: { yield_curve: 0.65, unemployment: -2.54, hy_spread: 2.58, indpro_yoy: 0.05, lei_proxy: -0.49 },
    data_as_of: "2026-09-01",
    curve_shape: { "1M": null, "3M": null, "6M": null, "1Y": null, "2Y": 4.63, "5Y": null, "10Y": 4.96, "30Y": null },
    current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: -0.03 },
    freshness,
  };
}
const row = (n: number, t: number, s: number, c: number) => ({ Normal: n, Tight: t, Stressed: s, Crisis: c });
const T3 = { Normal: row(0.81, 0, 0.15, 0.04), Tight: row(0, 0, 0, 0), Stressed: row(0.29, 0, 0.58, 0.13), Crisis: row(0.04, 0, 0.36, 0.6) };
function credit(freshness: Record<string, SeriesState> | undefined): CreditMetrics {
  const all = monthsTo(120);
  const six = monthsTo(6);
  return {
    hy_oas: 312, ig_oas: 94, ccc_oas: 1042, bb_oas: 188, b_oas: 297, hy_1w_change: 6, ig_1w_change: 1, ccc_1w_change: 29,
    bb_1w_change: -3, b_1w_change: 2, hy_ig_ratio: 3.32, ccc_pct_of_distress_line: 104.2, lbo_all_in_cost: "7.04%",
    credit_label: "Normal", credit_label_color: "#28d17c", hy_pct_rank: 12, ig_pct_rank: 18,
    hy_series: series(all, (i) => 400 + (i % 7) * 3), ig_series: series(all, (i) => 130 + (i % 5) * 2), data_as_of: "Sep 01, 2026",
    transition_3m: T3, transition_6m: T3, tight_count: 0,
    hy_sparkline: series(six, (i) => 300 + i), ig_sparkline: series(six, (i) => 90 + i), ccc_sparkline: series(six, (i) => 900 + i),
    bb_sparkline: series(six, (i) => 200 - i), b_sparkline: series(six, (i) => 290 + i),
    freshness,
  } as CreditMetrics;
}
const lbo = (freshness: Record<string, SeriesState> | undefined): LboDefaults =>
  ({ fedfunds: 4.33, hy_oas_pct: 2.65, lbo_all_in_rate: 6.98, data_as_of: "2026-09-01", status: "live", is_fallback: false, freshness } as LboDefaults);
const REGIME: Regime = { date: "2026-07-01", label: "Goldilocks", confidence: 0.5, growth_trend: 0.24, inflation_trend: -0.58,
  prob_goldilocks: 0.64, prob_overheating: 0.004, prob_stagflation: 0.005, prob_recession: 0.35 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/** Every word a reader can see or hover: the text and every title attribute. */
function everything(container: HTMLElement): string {
  return [container.textContent ?? "", ...[...container.querySelectorAll("[title]")].map((e) => e.getAttribute("title") ?? "")].join("\n");
}

async function mount(screen: "recession" | "credit", block: Record<string, SeriesState> | undefined): Promise<HTMLElement> {
  const client: QueryClient = makeClient();
  client.setQueryData(["freshness"], CACHED, { updatedAt: NOW.getTime() - 60 * 60_000 });
  stubFetch({
    "/api/freshness": () => ({ status: 503, body: { detail: "could not read the store's schema", kind: "schema_check", retryable: true } }),
    "/api/recession/probability": () => recession(block),
    "/api/recession/scenario": () => ({ probability: 10.4, label: "Low Risk", color: "#2ecc71", baseline_prob: 11.6, delta_pp: -1.2 }),
    "/api/regime/latest": () => REGIME,
    "/api/credit/metrics": () => credit(block),
    "/api/lbo/defaults": () => lbo(block),
  });
  const route = `/app/${screen}`;
  window.history.replaceState(null, "", route);
  const ui = screen === "recession" ? <RecessionScreen /> : <CreditScreen />;
  const { container } = renderWithProviders(<main id="main-content">{ui}</main>, { route, client });
  await waitFor(() => expect(client.getQueryState(["freshness"])?.status).toBe("error"));
  const anchor = screen === "recession" ? "#model" : "#financing";
  await waitFor(() => expect(container.querySelector(anchor)?.textContent ?? "").toContain(screen === "recession" ? "4.1%" : "6.98"));
  await waitFor(() => expect(everything(container)).toContain(block ? REASON : CACHED_DATES[0]));
  return container;
}

for (const screen of ["recession", "credit"] as const) {
  it(`R-31 on /app/${screen}: no label on the whole screen carries the cached report's dates; the reason is shown`, async () => {
    const all = everything(await mount(screen, AWAITING));
    for (const cached of CACHED_DATES) expect(all, `found "${cached}"`).not.toContain(cached);
    expect(all).toContain(REASON);
    expect(all).toContain("—");
  });

  it(`the premise on /app/${screen}: without the blocks, the same cache prints the cached dates`, async () => {
    const all = everything(await mount(screen, undefined));
    expect(CACHED_DATES.some((d) => all.includes(d))).toBe(true);
  });
}
