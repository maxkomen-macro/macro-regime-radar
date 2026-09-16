/**
 * The full `/api/allocation` fixture for the Phase 9 suites
 * (docs/redesign-v2/checklists/09-tools.md section E.1): Goldilocks live at
 * 64% odds, three assets (SPY, TLT, GLD) with regime stats for the four
 * regimes (TLT in Overheating is the positive-return / negative-Sharpe cell
 * the overview caption must cite), correlations per regime, all seven
 * optimizer methods (Min CVaR converged: false, HERC converged: true, the
 * Mean-Variance SPY weight at 0.35 for the blue tint), a 40-row frontier,
 * drawdowns, the three CVaR blocks, one repeated regime switch, real vs nominal
 * with GLD eroded, factors per method, style rows with a return-only spread
 * row, and currency moves. `NULL_OPT` is the local snapshot's shape: the same
 * history with `optimizations: null` and the exact sample accounting.
 * Dated Aug 2002 to Aug 2026; the assertions are the copy rules, never the
 * baseline's figures.
 */
import type { AllocationData, FrameData, OptimizationResult, OptimizationSample, RegimeStats } from "../../../api/types";

export const NAMES = ["SPY", "TLT", "GLD"];
export const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
export const CUR = "Goldilocks";
/** Method keys in the panel's METHODS order with their labels and badges (AllocationPanel.tsx:35-43, kept verbatim by Phase 9). */
export const METHOD_KEYS = ["mvo", "min_var", "risk_parity", "black_litterman", "hrp", "cvar", "herc"];
export const METHOD_LABELS = ["Mean-Variance", "Min Variance", "Risk Parity", "Black-Litterman", "HRP", "Min CVaR", "HERC"];
export const METHOD_BADGES = ["return-based", "risk-only", "risk-balanced", "equilibrium + views", "hierarchical", "tail-risk", "hierarchical"];

export const frame = (index: string[], columns: string[], data: (number | null)[][]): FrameData => ({ index, columns, data });

const stats = (n_months: number, mean: Record<string, number>, std: Record<string, number>, sharpe: Record<string, number | null>): RegimeStats => ({ n_months, mean, std, sharpe });

export const REGIME_STATS: Record<string, RegimeStats> = {
  Goldilocks: stats(28, { SPY: 0.142, TLT: -0.012, GLD: 0.061 }, { SPY: 0.12, TLT: 0.09, GLD: 0.14 }, { SPY: 0.91, TLT: -0.52, GLD: 0.18 }),
  Overheating: stats(61, { SPY: -0.03, TLT: 0.021, GLD: 0.12 }, { SPY: 0.17, TLT: 0.11, GLD: 0.16 }, { SPY: -0.4, TLT: -0.15, GLD: 0.6 }),
  Stagflation: stats(74, { SPY: -0.081, TLT: 0.034, GLD: 0.157 }, { SPY: 0.19, TLT: 0.12, GLD: 0.17 }, { SPY: -0.7, TLT: 0.1, GLD: 0.8 }),
  "Recession Risk": stats(126, { SPY: 0.052, TLT: 0.088, GLD: 0.043 }, { SPY: 0.15, TLT: 0.1, GLD: 0.15 }, { SPY: 0.2, TLT: 0.9, GLD: 0.15 }),
};

const corr = (a: number, b: number, c: number): FrameData =>
  frame(NAMES, NAMES, [
    [1, a, b],
    [a, 1, c],
    [b, c, 1],
  ]);

export const REGIME_CORRELATIONS: Record<string, FrameData> = {
  Goldilocks: corr(-0.35, 0.12, 0.05),
  Overheating: corr(0.22, 0.31, 0.18),
  Stagflation: corr(0.58, 0.44, 0.27),
  "Recession Risk": corr(-0.55, -0.08, 0.15),
};

const opt = (key: string, weights: number[], expected_return: number, volatility: number, sharpe_ratio: number, converged: boolean, cvar: number, v: number): OptimizationResult => ({
  weights,
  expected_return,
  volatility,
  sharpe_ratio,
  method: key,
  converged,
  cvar_95: { cvar, var: v },
});

/** 40 points on a concave risk/return plane, volatility 6% to 15.75%. */
export const FRONTIER: FrameData = frame(
  Array.from({ length: 40 }, (_, i) => String(i)),
  ["volatility", "return"],
  Array.from({ length: 40 }, (_, i) => {
    const vol = 0.06 + i * 0.0025;
    const d = vol - 0.06;
    return [Number(vol.toFixed(4)), Number((0.04 + 0.9 * d - 3 * d * d).toFixed(4))];
  }),
);

export const OPTIMIZATIONS = {
  mvo: opt("mvo", [0.35, 0.25, 0.4], 0.094, 0.102, 0.57, true, -0.061, -0.042),
  min_var: opt("min_var", [0.2, 0.4, 0.4], 0.071, 0.078, 0.41, true, -0.048, -0.031),
  risk_parity: opt("risk_parity", [0.3, 0.4, 0.3], 0.078, 0.085, 0.45, true, -0.052, -0.035),
  black_litterman: opt("black_litterman", [0.4, 0.3, 0.3], 0.088, 0.096, 0.51, true, -0.058, -0.04),
  hrp: opt("hrp", [0.28, 0.42, 0.3], 0.075, 0.081, 0.44, true, -0.05, -0.033),
  // The equal-weight fallback: the source reports sharpe_ratio 0.0 unconditionally on this path.
  cvar: opt("cvar", [1 / 3, 1 / 3, 1 / 3], 0.08, 0.087, 0, false, -0.055, -0.037),
  herc: opt("herc", [0.25, 0.45, 0.3], 0.074, 0.079, 0.43, true, -0.049, -0.032),
  frontier: FRONTIER,
  asset_names: NAMES,
} as unknown as NonNullable<AllocationData["optimizations"]>;

const cvarBlock = (k: number) => ({
  confidence: k,
  asset_cvar: {
    SPY: { cvar: -0.089 * (k > 0.95 ? 1.4 : 1), var: -0.062, n_periods: 289 },
    TLT: { cvar: -0.058 * (k > 0.95 ? 1.4 : 1), var: -0.041, n_periods: 289 },
    GLD: { cvar: -0.071 * (k > 0.95 ? 1.4 : 1), var: -0.05, n_periods: 289 },
  },
});

const factors = (value: number, momentum: number, r_squared: number, alpha: number) => ({
  exposures: { Value: value, Momentum: momentum, Quality: 0.08, Size: -0.05, "Low Vol": 0.19 },
  r_squared,
  alpha,
});

export const PORTFOLIO_FACTORS: AllocationData["portfolio_factors"] = {
  mvo: factors(-0.12, 0.31, 0.34, 0.012),
  min_var: factors(0.05, 0.1, 0.22, 0.004),
  risk_parity: factors(0.02, 0.14, 0.27, 0.006),
  black_litterman: factors(-0.08, 0.26, 0.31, 0.009),
  hrp: factors(0.03, 0.12, 0.25, 0.005),
  cvar: factors(0.0, 0.11, 0.2, 0.003),
  herc: factors(0.04, 0.13, 0.24, 0.005),
};

export const STYLE_GOLDILOCKS: NonNullable<AllocationData["style_performance"]>[string] = {
  Growth: { return: 0.16, volatility: 0.18, sharpe: 0.71, hit_rate: 0.64 },
  Value: { return: 0.09, volatility: 0.15, sharpe: 0.39, hit_rate: 0.57 },
  Momentum: { return: 0.19, volatility: 0.2, sharpe: 0.8, hit_rate: 0.68 },
  // The long-short spread row carries a return and nothing else.
  "Growth-Value Spread": { return: 0.07 },
};

/** The sample accounting behind the unavailable optimizer (the local snapshot's shape). */
export const SAMPLE: OptimizationSample & { window: string } = {
  regime: CUR,
  total_regime_months: 28,
  stats_months: 28,
  complete_months: 21,
  cov_months: 21,
  excluded_months: 7,
  excluded_range: "2002-08 → 2003-02",
  complete_range: "2003-03 → 2026-08",
  assets_total: 3,
  assets_responsible: [{ asset: "GLD", missing_months: 7 }],
  required_stats_months: 12,
  required_cov_months: 24,
  stats_ok: true,
  cov_ok: false,
  sentence: "21 of 28 Goldilocks months have complete returns across all three assets; 24 are required.",
  window: "2002-08 → 2026-08",
};

export const FULL: AllocationData = {
  current_regime: "Goldilocks",
  confidence: 0.5,
  dominant_prob: 0.64,
  rf_rate: 0.0363,
  regime_stats: REGIME_STATS,
  regime_correlations: REGIME_CORRELATIONS,
  optimizations: OPTIMIZATIONS,
  optimizations_skipped: null,
  optimization_sample: null,
  drawdowns: {
    by_regime: frame(NAMES, REGIMES, [
      [-0.12, -0.34, -0.48, -0.22],
      [-0.06, -0.18, -0.11, -0.09],
      [-0.08, -0.14, -0.2, -0.31],
    ]),
    overall: { SPY: -0.51, TLT: -0.42, GLD: -0.29 },
  },
  data_start: "2002-08",
  data_end: "2026-08",
  n_months: 289,
  asset_classes: { SPY: { etf: "SPY" }, TLT: { etf: "TLT" }, GLD: { etf: "GLD" } },
  cvar_95: cvarBlock(0.95),
  cvar_99: cvarBlock(0.99),
  regime_cvar: Object.fromEntries(REGIMES.map((r) => [r, cvarBlock(0.95)])),
  transition_pnl: {
    "Goldilocks → Overheating": { count: 3, avg_return: { SPY: 0.021, TLT: -0.014, GLD: 0.033 } },
    // A single occurrence never averages (needs n >= 2): filtered out of the pair options.
    "Overheating → Stagflation": { count: 1, avg_return: { SPY: -0.04, TLT: 0.01, GLD: 0.05 } },
  },
  real_nominal: {
    Goldilocks: {
      nominal: { SPY: 0.142, TLT: -0.012, GLD: 0.061 },
      real: { SPY: 0.11, TLT: -0.043, GLD: -0.004 },
      inflation_drag: { SPY: -0.032, TLT: -0.031, GLD: -0.065 },
      n_months: 28,
    },
  },
  regime_factors: { Goldilocks: { Value: 0.01, Momentum: 0.03, Quality: 0.02, Size: -0.01, "Low Vol": 0.0 } },
  portfolio_factors: PORTFOLIO_FACTORS,
  style_performance: { Goldilocks: STYLE_GOLDILOCKS },
  currency_impact: Object.fromEntries(
    REGIMES.map((r, i) => [
      r,
      {
        "EUR/USD": { return: 0.031 - i * 0.02, volatility: 0.08 },
        "USD/JPY": { return: -0.012 + i * 0.015, volatility: 0.09 },
      },
    ]),
  ),
};

/** The unavailable-optimizer branch: the same history with no optimizer output and the exact sample accounting. */
export const NULL_OPT: AllocationData = { ...FULL, optimizations: null, optimizations_skipped: SAMPLE, optimization_sample: SAMPLE };

/** A copy of FULL with one optimizer method patched (`converged`, `method`, weights). */
export function withMethod(key: string, patch: Partial<OptimizationResult>): AllocationData {
  const base = FULL.optimizations as NonNullable<AllocationData["optimizations"]>;
  const next = { ...base, [key]: { ...(base[key] as OptimizationResult), ...patch } } as unknown as NonNullable<AllocationData["optimizations"]>;
  return { ...FULL, optimizations: next };
}

/** Every method converged: the mint strip. */
export const ALL_CONVERGED: AllocationData = withMethod("cvar", { converged: true, sharpe_ratio: 0.46 });

/** The ranked column emptied: the generic hero sentence. */
export const NO_RANKED: AllocationData = {
  ...FULL,
  regime_stats: { ...REGIME_STATS, Goldilocks: stats(0, {}, {}, {}) },
};

export const spct = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`;
export const pct = (v: number, dp = 1) => `${(v * 100).toFixed(dp)}%`;
