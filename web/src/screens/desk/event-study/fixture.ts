/**
 * The Event Study fixture (spec §5: "stub the fetch with a fixture until
 * Stream A lands"). Illustrative numbers for the preset only, shaped to the
 * EVENT_STUDY_SPEC §4 and §7 contract, and marked as a fixture everywhere:
 * inputs_hash "fixture", the badge reads Designed, every table carries the
 * word. Never shown for a query other than the preset. The asset lists
 * follow spec §3 (history_from per series; warn after 1990).
 */

import type { EventStudyAssets, EventStudyResponse } from "../../../api/desk";
import { PRESET, PRESET_SLUG } from "./studies";

export const FIXTURE_ASSETS: EventStudyAssets = {
  shock_assets: [
    { id: "spx", label: "S&P 500 (^GSPC)", shock_unit: "log_return", history_from: "1950-01-03" },
    { id: "ndx", label: "Nasdaq 100 (^NDX)", shock_unit: "log_return", history_from: "1985-10-01" },
    { id: "rut", label: "Russell 2000 (^RUT)", shock_unit: "log_return", history_from: "1987-09-10" },
    { id: "gold", label: "Gold (LBMA PM fix)", shock_unit: "log_return", history_from: "1968-04-01" },
    { id: "wti", label: "WTI (DCOILWTICO)", shock_unit: "log_return", history_from: "1986-01-02" },
    { id: "copper", label: "Copper (HG=F)", shock_unit: "log_return", history_from: "2000-08-30", warn: true },
    { id: "dgs10", label: "US 10Y (DGS10)", shock_unit: "bp", history_from: "1962-01-02" },
    { id: "dgs2", label: "US 2Y (DGS2)", shock_unit: "bp", history_from: "1976-06-01" },
    { id: "t10y2y", label: "2s10s (T10Y2Y)", shock_unit: "bp", history_from: "1976-06-01" },
    { id: "vix", label: "VIX (^VIX)", shock_unit: "log_change", history_from: "1990-01-02" },
    { id: "dxy", label: "DXY (DX-Y.NYB)", shock_unit: "log_return", history_from: "1971-01-04" },
    { id: "usdjpy", label: "USDJPY (JPY=X)", shock_unit: "log_return", history_from: "1971-01-04" },
    { id: "hy_oas", label: "HY OAS (BAMLH0A0HYM2)", shock_unit: "bp", history_from: "1996-12-31", warn: true },
    { id: "xlk", label: "XLK · Technology", shock_unit: "log_return", history_from: "1998-12-22", warn: true },
    { id: "xlf", label: "XLF · Financials", shock_unit: "log_return", history_from: "1998-12-22", warn: true },
    { id: "xle", label: "XLE · Energy", shock_unit: "log_return", history_from: "1998-12-22", warn: true },
    { id: "xlu", label: "XLU · Utilities", shock_unit: "log_return", history_from: "1998-12-22", warn: true },
  ],
  targets: [
    { id: "spx", label: "S&P 500", shock_unit: "log_return", history_from: "1950-01-03" },
    { id: "ndx", label: "Nasdaq 100", shock_unit: "log_return", history_from: "1985-10-01" },
    { id: "gold", label: "Gold", shock_unit: "log_return", history_from: "1968-04-01" },
    { id: "dgs10", label: "US 10Y (bp)", shock_unit: "bp", history_from: "1962-01-02" },
    { id: "dxy", label: "DXY", shock_unit: "log_return", history_from: "1971-01-04" },
    { id: "hy_oas", label: "HY OAS (bp)", shock_unit: "bp", history_from: "1996-12-31", warn: true },
    { id: "vix", label: "VIX (log)", shock_unit: "log_change", history_from: "1990-01-02" },
  ],
  conditions: [
    { id: "none", label: "No co-condition" },
    { id: "spx_below_50dma", label: "S&P 500 below its 50-day average" },
    { id: "spx_20d_neg", label: "S&P 500 20-day return below zero" },
    { id: "vix_above_20", label: "VIX above 20" },
    { id: "hy_20d_up_25bp", label: "HY OAS up more than 25 bp over 20 days" },
  ],
  regimes: ["all", "goldilocks", "overheating", "stagflation", "recession_risk"],
  windows: [5, 20, 60],
  thresholds: [1.5, 2.0, 2.5],
  horizons: [5, 10, 20, 60],
};

export const FIXTURE_STUDY: EventStudyResponse = {
  slug: PRESET_SLUG,
  params: PRESET,
  shock: { label: "Gold (LBMA PM fix)", unit: "log_return" },
  target: { label: "S&P 500", unit: "log_return" },
  condition: { label: "S&P 500 below its 50-day average" },
  horizons: [
    { h: 5, n: 41, hit_rate: 0.49, median: -0.2, mean: -0.3, p25: -1.8, p75: 1.4, baseline_median: 0.2, baseline_hit_rate: 0.58, delta: -0.4, ci90: [-1.3, 0.5] },
    { h: 10, n: 41, hit_rate: 0.51, median: 0.1, mean: -0.1, p25: -2.6, p75: 2.3, baseline_median: 0.4, baseline_hit_rate: 0.6, delta: -0.3, ci90: [-1.6, 1.0] },
    { h: 20, n: 40, hit_rate: 0.6, median: 1.1, mean: 0.6, p25: -3.1, p75: 4.0, baseline_median: 0.8, baseline_hit_rate: 0.62, delta: 0.3, ci90: [-1.5, 2.1] },
    { h: 60, n: 38, hit_rate: 0.66, median: 3.4, mean: 2.1, p25: -4.2, p75: 8.9, baseline_median: 2.3, baseline_hit_rate: 0.68, delta: 1.1, ci90: [-2.4, 4.6] },
  ],
  regime_split: [
    { regime: "Goldilocks", n: 14, suppressed: false, by_horizon: { "5": { hit_rate: 0.57, median: 0.4 }, "10": { hit_rate: 0.64, median: 0.9 }, "20": { hit_rate: 0.71, median: 1.8 }, "60": { hit_rate: 0.79, median: 4.6 } } },
    { regime: "Overheating", n: 9, suppressed: true, by_horizon: { "5": { hit_rate: null, median: null }, "10": { hit_rate: null, median: null }, "20": { hit_rate: null, median: null }, "60": { hit_rate: null, median: null } } },
    { regime: "Stagflation", n: 6, suppressed: true, by_horizon: { "5": { hit_rate: null, median: null }, "10": { hit_rate: null, median: null }, "20": { hit_rate: null, median: null }, "60": { hit_rate: null, median: null } } },
    { regime: "Recession Risk", n: 12, suppressed: false, by_horizon: { "5": { hit_rate: 0.42, median: -0.9 }, "10": { hit_rate: 0.42, median: -1.1 }, "20": { hit_rate: 0.5, median: 0.2 }, "60": { hit_rate: 0.58, median: 2.0 } } },
  ],
  recent_events: [
    { date: "2026-04-14", regime: "Goldilocks", z: 2.31, forward: { "5": 0.8, "10": 1.6, "20": 2.9, "60": null } },
    { date: "2025-11-06", regime: "Goldilocks", z: 2.07, forward: { "5": -0.4, "10": 0.7, "20": 1.2, "60": 4.1 } },
    { date: "2025-04-09", regime: "Recession Risk", z: 2.64, forward: { "5": 3.1, "10": 2.2, "20": 6.4, "60": 12.8 } },
    { date: "2024-10-18", regime: "Goldilocks", z: 2.02, forward: { "5": -1.1, "10": -0.6, "20": 0.9, "60": 3.3 } },
    { date: "2024-03-08", regime: "Overheating", z: 2.15, forward: { "5": -0.3, "10": 0.2, "20": -1.4, "60": 2.6 } },
    { date: "2023-10-13", regime: "Recession Risk", z: 2.48, forward: { "5": -2.6, "10": -1.9, "20": 1.7, "60": 9.2 } },
    { date: "2023-03-17", regime: "Recession Risk", z: 2.22, forward: { "5": 1.4, "10": 2.8, "20": 4.0, "60": 7.1 } },
    { date: "2022-11-10", regime: "Stagflation", z: 2.36, forward: { "5": 1.2, "10": 0.8, "20": -0.6, "60": 2.2 } },
    { date: "2022-03-08", regime: "Stagflation", z: 2.19, forward: { "5": 3.6, "10": 5.4, "20": 6.9, "60": -0.8 } },
    { date: "2020-03-24", regime: "Recession Risk", z: 2.71, forward: { "5": 6.9, "10": 8.4, "20": 14.2, "60": 27.5 } },
  ],
  verdict: {
    text: "After a 20-session gold move of two standard deviations or more while the S&P 500 sat below its 50-day average, the S&P's forward moves were not distinguishable from baseline at 5, 10 and 20 sessions. The 60-session median ran a modest 1.1% above baseline, with a 90% interval that includes zero. Positive reads are concentrated in Goldilocks; Overheating and Stagflation carry fewer than ten events each.",
    points: [
      "Interval excludes zero at: none of the four horizons.",
      "Strongest regime: Goldilocks (N 14). Weakest: Recession Risk (N 12).",
      "N below 10: Overheating (9), Stagflation (6); their reads are suppressed.",
      "Sample 1990-01-02 to 2026-09-12; one event per 20 sessions after each trigger (cooldown).",
    ],
  },
  provenance: { as_of: "2026-09-12", sample_start: "1990-01-02", sample_end: "2026-09-12", n_events: 41, cooldown: 20, seed: 20260921, inputs_hash: "fixture" },
  distribution: {
    h: 20,
    edges: [-14, -12, -10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10, 12, 14],
    conditional: [0, 1, 1, 2, 3, 5, 4, 7, 8, 4, 2, 1, 1, 1],
    baseline: [0.4, 0.6, 1.2, 2.4, 4.9, 9.8, 16.9, 22.6, 19.7, 11.5, 5.6, 2.5, 1.2, 0.7],
  },
};
