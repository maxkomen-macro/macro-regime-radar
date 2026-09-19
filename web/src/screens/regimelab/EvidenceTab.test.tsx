/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.10 and
 * E.1, `screens/regimelab/EvidenceTab.test.tsx`: the Empirical evidence
 * sub-tab. The backtests DataTable with one group row per cohort (the
 * COHORT_NAMES for signal cohorts), th Horizon / Avg return / Median / Hit
 * rate / N, the ▪ flag on tiny samples and perfect hit rates, the By regime /
 * By signal Segmented, then the factor HeatMatrix (role table, four regime
 * columns, one row per factor, the dash for a missing cell, signed tints) with
 * its Tools link, and the allocation loading / unavailable sentences.
 * Rendered prop-less: the tab owns its hooks. Fixtures dated Sep 2026.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import EvidenceTab from "./EvidenceTab";
import type { AllocationData, BacktestRow, RegimeLabel } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const DASH = "—";
const REGIMES: RegimeLabel[] = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
const HORIZONS = ["1M", "3M", "6M", "12M"];
const COMPUTED_AT = "2026-09-12T02:14:00";

const bt = (test_name: string, cohort: string, horizon: string, avg_return: number | null, median_return: number | null, hit_rate: number | null, n: number | null): BacktestRow => ({
  test_name,
  cohort,
  horizon,
  avg_return,
  median_return,
  hit_rate,
  n,
  computed_at: COMPUTED_AT,
});
/** Sixteen regime rows (served out of house order on purpose) and ten signal rows.
 * Flagged: Stagflation 12M (n = 3), Recession Risk 1M (hit rate 1), Overheating 3M (hit rate 0). */
const REGIME_ROWS: BacktestRow[] = [
  bt("SPY_regime_Recession Risk", "Recession Risk", "1M", -0.018, -0.011, 1, 17),
  bt("SPY_regime_Recession Risk", "Recession Risk", "3M", -0.031, -0.02, 0.41, 17),
  bt("SPY_regime_Recession Risk", "Recession Risk", "6M", -0.012, -0.009, 0.47, 17),
  bt("SPY_regime_Recession Risk", "Recession Risk", "12M", 0.064, 0.05, 0.59, 17),
  bt("SPY_regime_Goldilocks", "Goldilocks", "1M", 0.012, 0.009, 0.64, 25),
  bt("SPY_regime_Goldilocks", "Goldilocks", "3M", 0.034, 0.028, 0.68, 25),
  bt("SPY_regime_Goldilocks", "Goldilocks", "6M", 0.071, 0.06, 0.72, 25),
  bt("SPY_regime_Goldilocks", "Goldilocks", "12M", 0.138, 0.121, 0.8, 25),
  bt("SPY_regime_Stagflation", "Stagflation", "1M", -0.009, -0.007, 0.45, 11),
  bt("SPY_regime_Stagflation", "Stagflation", "3M", -0.022, -0.015, 0.36, 11),
  bt("SPY_regime_Stagflation", "Stagflation", "6M", null, null, null, null),
  bt("SPY_regime_Stagflation", "Stagflation", "12M", 0.019, 0.014, 0.67, 3),
  bt("SPY_regime_Overheating", "Overheating", "1M", 0.008, 0.006, 0.55, 9),
  bt("SPY_regime_Overheating", "Overheating", "3M", -0.004, -0.003, 0, 9),
  bt("SPY_regime_Overheating", "Overheating", "6M", 0.021, 0.017, 0.56, 9),
  bt("SPY_regime_Overheating", "Overheating", "12M", 0.049, 0.04, 0.61, 9),
];
const SIGNAL_KEYS = ["vix_spike", "cpi_hot", "yield_curve_inversion", "cpi_cold", "unemployment_spike"];
const SIGNAL_ROWS: BacktestRow[] = SIGNAL_KEYS.flatMap((k, i) => ["1M", "3M"].map((h, j) => bt(`SPY_signal_${k}`, k, h, 0.01 * (j + 1) - 0.003 * i, 0.008 * (j + 1) - 0.003 * i, 0.5 + 0.02 * i, 12 + i)));
const BACKTESTS = [...REGIME_ROWS, ...SIGNAL_ROWS];
const COHORT_NAMES: Record<string, string> = {
  cpi_hot: "Inflation hot · CPI above 4%",
  cpi_cold: "Inflation cold · CPI below 1%",
  unemployment_spike: "Unemployment spike · +0.3pp vs 12m low",
  vix_spike: "VIX spike · above 30",
  yield_curve_inversion: "Curve inversion · 2s10s below 0",
};

/** Stagflation lacks Low Vol, so that cell is null. */
const FACTORS: Record<string, Record<string, number>> = {
  Goldilocks: { Value: 0.021, Momentum: 0.084, Quality: 0.031, Size: -0.012, "Low Vol": 0.004 },
  Overheating: { Value: 0.053, Momentum: -0.026, Quality: 0.009, Size: 0.017, "Low Vol": -0.031 },
  Stagflation: { Value: 0.012, Momentum: 0.041, Quality: 0.062, Size: -0.048 },
  "Recession Risk": { Value: -0.07, Momentum: 0.11, Quality: 0.045, Size: -0.09, "Low Vol": 0.052 },
};
const ALLOCATION = { regime_factors: FACTORS } as unknown as AllocationData;

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
function routes(over: Routes = {}): Routes {
  return { "/api/backtests": () => BACKTESTS, "/api/allocation": () => ALLOCATION, ...over };
}

/* ── harness ─────────────────────────────────────────────────────────────── */

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
const css = (el: Element | null | undefined) => el?.getAttribute("style") ?? "";
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const section = () => byId("backtests") as HTMLElement;
const table = () => within(section()).getByRole("table", { name: "Backtests" });
const groupRows = () => [...table().querySelectorAll<HTMLElement>("tbody tr.mrr-grp")];
const dataRows = () => [...table().querySelectorAll<HTMLElement>("tbody tr")].filter((r) => !r.classList.contains("mrr-grp"));
const cohorts = () => screen.getByRole("group", { name: "Backtest cohorts" });
const option = (name: string) => within(cohorts()).getByRole("button", { name });
const grid = () => within(section()).getByRole("table", { name: "Factor returns by regime" });
/** Parse `rgba(r,g,b,a)` from a style string; null when absent. */
function rgba(s: string): [number, number, number, number] | null {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] == null ? 1 : Number(m[4])] : null;
}

async function renderEvidence(): Promise<void> {
  renderWithProviders(<EvidenceTab />, { route: "/app/regime-lab#backtests" });
  await waitFor(() => expect(byId("backtests")).not.toBeNull());
  await waitFor(() => expect(within(section()).queryByRole("table", { name: "Backtests" })).not.toBeNull());
}

beforeEach(() => {
  stubFetch(routes());
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("EvidenceTab (checklist 04 B.10)", () => {
  it("renders the header, the cohort Segmented and the backtests table with one group row per regime cohort in house order", async () => {
    await renderEvidence();
    expect(section().tagName).toBe("SECTION");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Backtests & factor attribution$/);
    // Iteration 1 step 6 (A1): the computed date is the section's stamp.
    expect(text(section())).toContain("Stored empirical analysis · SPY forward returns");
    expect(section().querySelector("[data-stamp]")?.textContent).toBe("Backtests · computed Sep 12, 2026");
    expect(within(cohorts()).getAllByRole("button").map((b) => text(b))).toEqual(["By regime", "By signal"]);
    expect(option("By regime")).toHaveAttribute("aria-pressed", "true");
    expect(option("By signal")).toHaveAttribute("aria-pressed", "false");
    expect(groupRows().map((r) => text(r))).toEqual(REGIMES);
    expect(dataRows()).toHaveLength(16);
    // Horizon cells read 1M / 3M / 6M / 12M in order under each group.
    const horizons = dataRows().map((r) => text(r.querySelector("td")));
    expect(horizons).toEqual([...HORIZONS, ...HORIZONS, ...HORIZONS, ...HORIZONS]);
    // The Cohort column has no successor: the group rows carry the names.
    expect(within(table()).queryByRole("columnheader", { name: /cohort/i })).toBeNull();
    expect(section().querySelector(".mrr-scroll")).not.toBeNull();
  });

  it("columns Horizon / Avg return / Median / Hit rate / N as th; the cells print signed returns, the median muted and the N", async () => {
    await renderEvidence();
    expect(within(table()).getAllByRole("columnheader").map((h) => text(h))).toEqual(["Horizon", "Avg return", "Median", "Hit rate", "N"]);
    for (const h of within(table()).getAllByRole("columnheader")) expect(h).toHaveAttribute("scope", "col");
    const goldilocks1m = dataRows()[0];
    expect(text(goldilocks1m)).toBe("1M+1.2%+0.9%64%25");
    expect(within(goldilocks1m).getByText("+1.2%").style.color).toBe("var(--pos)");
    expect(within(goldilocks1m).getByText("+0.9%").style.color).toBe("var(--text-3)");
    const overheating1m = dataRows()[4];
    expect(text(overheating1m)).toBe("1M+0.8%+0.6%55%9");
    const recession1m = dataRows()[12];
    expect(within(recession1m).getByText("-1.8%").style.color).toBe("var(--neg)");
    // A row with nothing served prints the dash placeholder in every numeric cell.
    const stagflation6m = dataRows()[10];
    expect(text(stagflation6m)).toBe(`6M${DASH}${DASH}${DASH}${DASH}`);
  });

  it("the ▪ flag marks n of 4 or fewer and a 100% or 0% hit rate, in amber, and the caption explains it", async () => {
    await renderEvidence();
    const flagged = dataRows().filter((r) => text(r).includes("▪"));
    expect(flagged.map((r) => text(r))).toEqual(["3M-0.4%-0.3%0% ▪9", "12M+1.9%+1.4%67% ▪3", "1M-1.8%-1.1%100% ▪17"]);
    for (const r of flagged) {
      const cell = [...r.querySelectorAll("span")].find((s) => /▪/.test(text(s))) as HTMLElement;
      expect(cell.style.color).toBe("var(--amber)");
    }
    const clean = dataRows()[0];
    expect(within(clean).getByText("64%").style.color).toBe("var(--text)");
    expect(text(section())).toContain("SPY forward returns after each regime began, measured over trading-day horizons (1M=21d … 12M=252d). ▪ flags fragile cells: four or fewer samples, or a perfect 100%/0% hit rate, which is a small base, not a guarantee. 50% is a coin flip; read hit rates against that line, not zero.");
    expect(within(section()).getByRole("button", { name: "hit rate" })).toHaveClass("jargon");
  });

  it("By signal swaps the group rows to the five COHORT_NAMES in key order and the caption to signal fired", async () => {
    await renderEvidence();
    fireEvent.click(option("By signal"));
    expect(option("By signal")).toHaveAttribute("aria-pressed", "true");
    expect(option("By regime")).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(groupRows()).toHaveLength(5));
    expect(groupRows().map((r) => text(r))).toEqual([COHORT_NAMES.cpi_cold, COHORT_NAMES.cpi_hot, COHORT_NAMES.unemployment_spike, COHORT_NAMES.vix_spike, COHORT_NAMES.yield_curve_inversion]);
    expect(dataRows()).toHaveLength(10);
    expect(text(section())).toContain("SPY forward returns after each signal fired");
    expect(text(section())).not.toContain("Goldilocks1M");
    fireEvent.click(option("By regime"));
    await waitFor(() => expect(groupRows().map((r) => text(r))).toEqual(REGIMES));
  });

  it("the factor grid is a role table with the corner and four regime columns, one row per factor, the dash for a missing cell and signed tints", async () => {
    await renderEvidence();
    await waitFor(() => expect(within(section()).queryByRole("table", { name: "Factor returns by regime" })).not.toBeNull());
    expect(within(section()).getByRole("heading", { level: 3, name: "Factor returns by regime · annualized" })).toBeInTheDocument();
    const g = grid();
    expect(within(g).getAllByRole("columnheader").map((h) => text(h))).toEqual(["Factor", ...REGIMES]);
    expect(within(g).getAllByRole("rowheader").map((h) => text(h))).toEqual(["Value", "Momentum", "Quality", "Size", "Low Vol"]);
    const rows = within(g).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(5);
    const cell = (row: number, col: number) => within(rows[row]).getAllByRole("cell")[col];
    expect(within(g).getAllByRole("cell")).toHaveLength(20);
    // Goldilocks / Momentum: +8.4%, mint tint; Goldilocks / Size: -1.2%, red tint.
    expect(text(cell(1, 0))).toBe("+8.4%");
    expect(rgba(css(cell(1, 0)))?.slice(0, 3)).toEqual([38, 220, 160]);
    expect(text(cell(3, 0))).toBe("-1.2%");
    expect(rgba(css(cell(3, 0)))?.slice(0, 3)).toEqual([240, 80, 63]);
    // A stronger return tints deeper, capped at 30 %/yr.
    const deep = rgba(css(cell(1, 3))) as number[]; // Recession Risk / Momentum +11.0%
    const light = rgba(css(cell(1, 0))) as number[];
    expect(deep[3]).toBeGreaterThan(light[3]);
    expect(deep[3]).toBeLessThanOrEqual(0.4);
    // Stagflation / Low Vol is not served: the dash, no tint.
    expect(text(cell(4, 2))).toBe(DASH);
    expect(rgba(css(cell(4, 2)))).toBeNull();
    expect(text(cell(4, 2))).not.toBe("n/a");
    // Text colour by sign, never a served hex.
    expect(g.innerHTML).not.toMatch(/#2ecc71|#e74c3c/i);
    expect(text(section())).not.toContain("Factor table computes");
  });

  it("the caption's Tools link points at /app/tools#allocation", async () => {
    await renderEvidence();
    await waitFor(() => expect(within(section()).queryByRole("table", { name: "Factor returns by regime" })).not.toBeNull());
    const link = within(section()).getByRole("link", { name: /Tools/ });
    expect(link).toHaveAttribute("href", "/app/tools#allocation");
    expect(text(link)).toBe("Tools → Allocation → Risk");
    expect(text(section())).toContain("Long/short ETF-proxy factors (Value, Momentum, Quality, Size, Low Vol) annualized inside each regime's months: which styles actually paid in each weather. Full portfolio-level attribution lives in Tools → Allocation → Risk.");
  });

  it("the allocation loading and unavailable sentences replace the grid; the backtests table renders regardless", async () => {
    stubFetch(routes({ "/api/allocation": () => new Promise(() => {}) }));
    const pending = renderWithProviders(<EvidenceTab />, { route: "/app/regime-lab#backtests" });
    await waitFor(() => expect(byId("backtests")).not.toBeNull());
    expect(await within(section()).findByText("Factor table computes on the allocation engine; up to a minute cold, then cached an hour.")).toBeInTheDocument();
    expect(within(section()).queryByRole("table", { name: "Factor returns by regime" })).toBeNull();
    await waitFor(() => expect(within(section()).queryByRole("table", { name: "Backtests" })).not.toBeNull());
    pending.unmount();

    stubFetch(routes({ "/api/allocation": () => ({ status: 502, body: { detail: "vendor down" } }) }));
    renderWithProviders(<EvidenceTab />, { route: "/app/regime-lab#backtests" });
    await waitFor(() => expect(byId("backtests")).not.toBeNull());
    expect(await within(section()).findByText("Factor history unavailable: the allocation engine could not reach its data vendor.")).toBeInTheDocument();
    expect(within(section()).queryByRole("table", { name: "Factor returns by regime" })).toBeNull();
    expect(within(section()).getByRole("heading", { level: 3, name: "Factor returns by regime · annualized" })).toBeInTheDocument();
  });

  it("backtests loading and error render the StateNote in place of the table, with the meta without a date", async () => {
    stubFetch(routes({ "/api/backtests": () => new Promise(() => {}) }));
    const pending = renderWithProviders(<EvidenceTab />, { route: "/app/regime-lab#backtests" });
    await waitFor(() => expect(byId("backtests")).not.toBeNull());
    expect(await within(section()).findByText("Reading stored data…")).toBeInTheDocument();
    expect(text(section())).toContain("Stored empirical analysis · SPY forward returns");
    expect(text(section())).not.toContain("computed");
    expect(within(section()).queryByRole("table", { name: "Backtests" })).toBeNull();
    pending.unmount();

    stubFetch(routes({ "/api/backtests": () => ({ status: 500, body: { detail: "down" } }) }));
    renderWithProviders(<EvidenceTab />, { route: "/app/regime-lab#backtests" });
    await waitFor(() => expect(byId("backtests")).not.toBeNull());
    expect(await within(section()).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(within(section()).queryByRole("table", { name: "Backtests" })).toBeNull();
  });
});
