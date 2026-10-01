/**
 * Codex R-31's repro on the Recession route (desk/hardening, verifier V-62).
 *
 * Kept outside web/, so the branch's web change stays two files:
 * tests/test_web_fresh_report.py copies web/ to a scratch directory, drops this
 * file into src/screens/recession/, and runs it there with vitest.
 *
 * The query cache holds a freshness report dating the model's daily inputs
 * Sep 24 and its monthly ones Aug 2026. The next /api/freshness fetch fails,
 * and the cache keeps the report. /api/recession/probability answers with an
 * awaiting block, because the Desk store's schema check could not run. The
 * hero's "Inputs through" chip (fix/freshness 3b; "Model inputs" before) and the summary's "Inputs through" row must read
 * "—" in the caution tone with the server's reason, never the cached dates.
 * Without the block, the same cache reads Sep 24: that is the repro's premise.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import RecessionScreen from "./RecessionScreen";
import type { DatedValue, Freshness, RecessionMetrics, Regime, SeriesState } from "../../api/types";
import { makeClient, renderWithProviders, stubFetch } from "../../test/utils";

const NOW = new Date("2026-09-25T15:00:00Z");
const REASON =
  "The freshness of these numbers could not be judged this time: could not read whether desk_series carries provenance (OperationalError: database schema is locked: main) after 4 tries";

const st = (id: string, cadence: "daily" | "monthly", as_of: string): SeriesState => ({
  id, label: id, kind: "fred", cadence, as_of, state: "close", delay_min: null, cycles_behind: 0, stale: false,
  discontinued: false, reason: `${id} was the latest print.`,
});
const CACHED: Freshness = {
  regimes_date: "2026-08-01", signals_date: "2026-09-01", market_daily_date: "2026-09-24", market_intraday_ts: null,
  news_published_at: null, raw_series_date: "2026-09-01", generated_at: "2026-09-24T22:00:00Z",
  series: [
    st("DGS10", "daily", "2026-09-24"), st("DGS2", "daily", "2026-09-24"), st("BAMLH0A0HYM2", "daily", "2026-09-24"),
    st("T10YIE", "daily", "2026-09-24"), st("T5YIE", "daily", "2026-09-24"),
    st("UNRATE", "monthly", "2026-08-01"), st("INDPRO", "monthly", "2026-08-01"),
  ],
};

const months = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => new Date(Date.UTC(2024, 10 + i, 0)).toISOString().slice(0, 10));
const series = (n: number, f: (i: number) => number): DatedValue[] => months(n).map((date, i) => ({ date, value: f(i) }));

function metrics(over: Partial<RecessionMetrics> = {}): RecessionMetrics {
  return {
    probability_source: "recession_model", recession_prob: 11.6, recession_label: "Low Risk", recession_color: "#2ecc71",
    yield_curve_spread: 33, yield_curve_pct_rank: 33, inversion_duration_months: 0, is_inverted: false,
    divergence_score: -34, divergence_label: "Macro ahead of markets", divergence_color: "#3498db",
    recession_prob_series: series(23, (i) => 10 + (i % 4) * 0.5), yield_curve_series: series(23, (i) => 0.2 + (i % 3) * 0.1),
    usrec_series: series(23, () => 0), n_training_samples: 281,
    model_features: ["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"],
    feature_coefficients: { yield_curve: 0.65, unemployment: -2.54, hy_spread: 2.58, indpro_yoy: 0.05, lei_proxy: -0.49 },
    data_as_of: "2026-09-01",
    curve_shape: { "1M": null, "3M": null, "6M": null, "1Y": null, "2Y": 4.63, "5Y": null, "10Y": 4.96, "30Y": null },
    current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: -0.03 },
    ...over,
  };
}
const REGIME: Regime = { date: "2026-07-01", label: "Goldilocks", confidence: 0.5, growth_trend: 0.24, inflation_trend: -0.58,
  prob_goldilocks: 0.64, prob_overheating: 0.004, prob_stagflation: 0.005, prob_recession: 0.35 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", "/app/recession");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

async function mount(block: RecessionMetrics["freshness"]): Promise<{ container: HTMLElement; client: QueryClient }> {
  const client = makeClient();
  client.setQueryData(["freshness"], CACHED, { updatedAt: NOW.getTime() - 60 * 60_000 });
  stubFetch({
    "/api/freshness": () => ({ status: 503, body: { detail: "could not read the store's schema", kind: "schema_check", retryable: true } }),
    "/api/recession/probability": () => metrics({ freshness: block }),
    "/api/recession/scenario": () => ({ probability: 10.4, label: "Low Risk", color: "#2ecc71", baseline_prob: 11.6, delta_pp: -1.2 }),
    "/api/regime/latest": () => REGIME,
  });
  const { container } = renderWithProviders(<main id="main-content"><RecessionScreen /></main>, { route: "/app/recession", client });
  await waitFor(() => expect(client.getQueryState(["freshness"])?.status).toBe("error"));
  await waitFor(() => expect(container.querySelector("[title^='Inputs through:']")).not.toBeNull());
  expect(client.getQueryData(["freshness"])).toBe(CACHED); // the cache kept the report
  return { container, client };
}

function inputsThrough(container: HTMLElement): string {
  const dt = [...container.querySelectorAll("dl dt")].find((d) => d.textContent?.trim() === "Inputs through");
  return dt?.nextElementSibling?.textContent ?? "";
}

it("R-31 on /app/recession: an awaiting block labels the numbers — with the reason, never the cached dates", async () => {
  const { container } = await mount({ status: "awaiting", reason: REASON } as unknown as RecessionMetrics["freshness"]);
  const chip = container.querySelector("[title^='Inputs through:']") as HTMLElement;
  expect(chip.getAttribute("data-tone")).toBe("delayed");
  expect(chip.querySelector(".mrr-fresh-word")?.textContent).toBe("—");
  expect(chip.getAttribute("title")).toContain(REASON);
  expect(chip.textContent).toContain(REASON);
  for (const stale of ["Sep 24", "Aug 2026 print"]) {
    expect(chip.textContent).not.toContain(stale);
    expect(chip.getAttribute("title")).not.toContain(stale);
    expect(inputsThrough(container)).not.toContain(stale);
  }
  expect(inputsThrough(container)).toContain("—");
});

it("the premise: without the block, the same cache dates the numbers Sep 24", async () => {
  const { container } = await mount(undefined);
  const chip = container.querySelector("[title^='Inputs through:']") as HTMLElement;
  expect(chip.getAttribute("title")).toContain("Aug 2026 print");
  expect(inputsThrough(container)).toBe("Daily Sep 24 · monthly Aug 2026 print");
});
