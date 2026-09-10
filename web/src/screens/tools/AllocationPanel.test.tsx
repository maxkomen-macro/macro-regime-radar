import { describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import AllocationPanel from "./AllocationPanel";
import { renderWithProviders, stubFetch } from "../../test/utils";

const frame = (cols: string[], rows: number[][]) => ({ columns: cols, index: cols, data: rows });
const stats = { n_months: 28, mean: { SPY: 0.1, TLT: 0.02 }, std: { SPY: 0.15, TLT: 0.1 }, sharpe: { SPY: 0.5, TLT: 0.1 } };
const payload = {
  current_regime: "Goldilocks", confidence: 0.7, dominant_prob: 0.7, rf_rate: 0.04,
  regime_stats: { Goldilocks: stats },
  regime_correlations: { Goldilocks: frame(["SPY", "TLT"], [[1, 0.1], [0.1, 1]]) },
  optimizations: null,
  optimizations_skipped: {
    regime: "Goldilocks", stats_months: 28, cov_months: 19, required_stats_months: 12, required_cov_months: 24, window: "2003-01 → 2026-08",
    total_regime_months: 28, complete_months: 19, excluded_months: 9, excluded_range: "2003-01 → 2004-06", complete_range: "2004-07 → 2026-08",
    assets_total: 7, assets_responsible: [{ asset: "BTC", missing_months: 9 }], stats_ok: true, cov_ok: false,
    sentence: "19 of 28 Goldilocks months have complete returns across all seven assets; 24 are required.",
  },
  optimization_sample: null,
  drawdowns: { by_regime: frame(["SPY"], [[0]]), overall: { SPY: -0.3 } },
  data_start: "2003-01", data_end: "2026-08", n_months: 284,
  asset_classes: { SPY: { etf: "SPY" }, TLT: { etf: "TLT" } },
  cvar_95: { confidence: 0.95, asset_cvar: {} }, cvar_99: { confidence: 0.99, asset_cvar: {} }, regime_cvar: {},
  transition_pnl: {}, real_nominal: null, style_returns: null, factor_attribution: null, currency: null,
};

describe("AllocationPanel sample explanation", () => {
  it("states exact complete vs required months and the responsible asset", async () => {
    stubFetch({ "/api/allocation": () => payload, "/api/regime/latest": () => ({ label: "Goldilocks" }) });
    renderWithProviders(<AllocationPanel />);
    await waitFor(() => expect(document.body.textContent).toMatch(/19 of 28 Goldilocks months have complete returns across all seven assets; 24 are required\./));
    expect(document.body.textContent).toMatch(/19 of 28 Goldilocks months complete · 24 required/);
    expect(document.body.textContent).not.toMatch(/fewer than 24 of them are complete/);
  });
});
