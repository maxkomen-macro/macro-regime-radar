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

/* ── Phase 9 (checklist 09 E.1 row 8): the optimization and overview panels ─
 * Appended after the existing case, which stays byte-identical. The imports
 * below serve the appended cases only (import declarations hoist). The full
 * fixture lives in ./__fixtures__/allocation.ts; the unavailable branch reuses
 * the existing `payload` above. The clock is frozen (only `Date`) so the Aug
 * 2026 return stamp reads current. Figures are the fixture's, never the
 * baseline's. */
import { afterEach, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import ToolsScreen from "./ToolsScreen";
import { NO_SHELL_ACTIONS, ShellActionsContext } from "../shell/shell-actions";
import { FULL, METHOD_LABELS, NAMES } from "./__fixtures__/allocation";
import { NOW, lboRoutes } from "./__fixtures__/lbo";

/** Text with `hidden` subtrees removed (Jargon tooltips, closed disclosures), whitespace collapsed. */
function p9Text(el: Element | null | undefined): string {
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
const p9ById = (id: string) => document.getElementById(id) as HTMLElement | null;
const p9Optimization = () => p9ById("allocation-optimization") as HTMLElement;
const p9Overview = () => p9ById("allocation-overview") as HTMLElement;
const p9MethodGroup = () => within(p9Optimization()).getByRole("group", { name: "Optimization method" });
const p9MethodOption = (name: string) => within(p9MethodGroup()).getByRole("button", { name });
const p9Pressed = () => [...p9MethodGroup().querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => p9Text(b));
/** Top-level `Card variant="tile"` surfaces inside a section. */
const p9Tiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[style*='var(--r-tile)']")].filter((el) => !el.parentElement?.closest("[style*='var(--r-tile)']"));
/** The selected-method tile: the one tile carrying a Tag. */
function p9MethodTile(): HTMLElement {
  const t = p9Tiles(p9Optimization()).find((el) => el.querySelector("span[data-tone]"));
  if (!t) throw new Error("no selected-method tile (a tile carrying a Tag) in #allocation-optimization");
  return t;
}
const p9Frontier = () => p9Optimization().querySelector<SVGSVGElement>('svg[role="img"][aria-label^="Efficient frontier"]');
const p9Weights = () => p9Optimization().querySelector<HTMLElement>('[role="table"][aria-label="Weights by method"]');
async function p9AwaitOptimization(): Promise<void> {
  await waitFor(() => expect(p9Optimization()).not.toBeNull());
  await waitFor(() => expect(within(p9Optimization()).getByRole("group", { name: "Optimization method" })).toBeInTheDocument());
}
function p9Stub(allocation: unknown) {
  stubFetch({ "/api/allocation": () => allocation, ...lboRoutes(), "/api/regime/latest": () => ({ label: "Goldilocks" }) });
}

describe("AllocationPanel optimization and overview (checklist 09 E.1 row 8)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.history.replaceState(null, "", "/app/tools");
    p9Stub(FULL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("the method group has seven aria-pressed options in METHODS order with Mean-Variance pressed at rest; the selected-method tile shows its label, badge, return and vol / SR line; HERC swaps the tile", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    const options = [...p9MethodGroup().querySelectorAll("button")];
    expect(options).toHaveLength(7);
    expect(options.map((b) => p9Text(b))).toEqual(METHOD_LABELS);
    for (const b of options) expect(b).toHaveAttribute("aria-pressed");
    expect(p9Pressed()).toEqual(["Mean-Variance"]);
    let tile = p9MethodTile();
    expect(p9Text(tile)).toContain("Mean-Variance");
    expect(p9Text(tile.querySelector("span[data-tone]"))).toBe("return-based");
    expect(tile.querySelector("span[data-tone]")).toHaveAttribute("data-tone", "reference");
    expect(p9Text(tile)).toContain("+9.4%");
    expect(p9Text(tile)).toContain("vol 10.2% · SR 0.57");
    expect(p9Text(tile)).not.toContain("equal weight");

    fireEvent.click(p9MethodOption("HERC"));
    expect(p9Pressed()).toEqual(["HERC"]);
    tile = p9MethodTile();
    expect(p9Text(tile)).toContain("HERC");
    expect(p9Text(tile.querySelector("span[data-tone]"))).toBe("hierarchical");
    expect(p9Text(tile)).toContain("+7.4%");
    expect(p9Text(tile)).toContain("vol 7.9% · SR 0.43");
    expect(p9Text(tile)).not.toContain("Mean-Variance");
    expect(within(p9Optimization()).getByRole("heading", { level: 2, name: "Optimization" })).toBeInTheDocument();
    expect(p9Text(p9Optimization().querySelector(".mrr-sec-sp"))).toContain("max 40% per asset · long-only");
  });

  it("the fallback method shows the fallback Tag, the dash SR and the equal-weight line", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    fireEvent.click(p9MethodOption("Min CVaR"));
    const tile = p9MethodTile();
    expect(p9Text(tile.querySelector("span[data-tone]"))).toBe("fallback");
    expect(tile.querySelector("span[data-tone]")).toHaveAttribute("data-tone", "watch");
    expect(p9Text(tile)).toContain("vol 8.7% · SR —");
    expect(p9Text(tile)).toContain("equal weight · Sharpe not computed");
    expect(p9Text(tile)).toContain("+8.0%");
  });

  it("the methods caption names only Min CVaR as unavailable and never HERC; the how-to-read tile is present", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    const t = p9Text(p9Optimization());
    expect(t).toContain(`Seven ways to slice the same ${NAMES.length} assets: different questions, not better/worse answers. Min CVaR is unavailable this session and shown at equal weight, tagged fallback.`);
    expect(t).not.toMatch(/HERC (?:is|are) unavailable/);
    expect(t).not.toContain("Min CVaR and HERC are unavailable");
    expect(t).toContain("How to read the methods");
    expect(t).toContain("target the worst months.");
  });

  it("the frontier svg has one path, six markers and one ring on the selected method; the ring follows the selection and is absent on the fallback; the caption omits only the fallback", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    const svg = p9Frontier() as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg.querySelectorAll("path")).toHaveLength(1);
    expect(svg.querySelectorAll("circle:not(.mrr-frontier-ring)")).toHaveLength(6);
    const ring = () => svg.querySelectorAll("circle.mrr-frontier-ring");
    expect(ring()).toHaveLength(1);
    expect(p9Text(ring()[0].closest("g"))).toBe("Mean-Variance");
    expect(ring()[0].closest("g")).toHaveAttribute("data-selected", "true");

    fireEvent.click(p9MethodOption("HERC"));
    expect(ring()).toHaveLength(1);
    expect(p9Text(ring()[0].closest("g"))).toBe("HERC");

    fireEvent.click(p9MethodOption("Min CVaR"));
    expect(ring()).toHaveLength(0);
    expect(p9Text(p9Optimization())).toContain("Equal-weight fallbacks (Min CVaR) are omitted from the plane.");
    expect(p9Text(p9Optimization())).toContain("Efficient frontier · annualized risk vs return");
  });

  it("the weights table has seven column headers incl. B-L, one row per asset and the 35% cell tinted at the concentration edge", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    const table = p9Weights() as HTMLElement;
    expect(table).not.toBeNull();
    const headers = [...table.querySelectorAll('[role="columnheader"]')].map((c) => p9Text(c)).filter(Boolean);
    expect(headers).toEqual(["Mean-Variance", "Min Variance", "Risk Parity", "B-L", "HRP", "Min CVaR", "HERC"]);
    expect([...table.querySelectorAll('[role="rowheader"]')].map((r) => p9Text(r))).toEqual(NAMES);
    const cells = [...table.querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(cells).toHaveLength(NAMES.length * 7);
    const thirtyFive = cells.filter((c) => p9Text(c) === "35");
    expect(thirtyFive).toHaveLength(1);
    expect(thirtyFive[0].getAttribute("style") ?? "").toContain("var(--link-a10)");
    const twenty = cells.find((c) => p9Text(c) === "20") as HTMLElement;
    expect(twenty.getAttribute("style") ?? "").not.toContain("var(--link-a10)");
    expect(p9Text(p9Optimization())).toContain("Cells at the 30%+ concentration edge tint blue; zeros sit faint.");
    expect(p9Text(p9Optimization())).toContain("Weights by method · %");
  });

  it("the T27 disclosure is absent with a served optimizer", async () => {
    renderWithProviders(<AllocationPanel />);
    await p9AwaitOptimization();
    expect(screen.queryByRole("button", { name: /Optimizer status: no output this session/ })).toBeNull();
    expect(p9Text(p9Optimization())).not.toContain("So no weights, no efficient frontier");
  });

  it("with the null-optimizer payload the disclosure right text is byte-identical and closed, and the meta reads unavailable", async () => {
    p9Stub(payload);
    renderWithProviders(<AllocationPanel />);
    const button = await screen.findByRole("button", { name: /Optimizer status: no output this session/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(p9Text(button)).toContain("19 of 28 Goldilocks months complete · 24 required");
    expect(p9Text(p9Optimization().querySelector(".mrr-sec-sp"))).toContain("optional enhancement · unavailable this session");
    expect(within(p9Optimization()).queryByRole("group", { name: "Optimization method" })).toBeNull();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(p9Text(p9Optimization())).toContain(payload.optimizations_skipped.sentence));
    expect(p9Text(p9Optimization())).toContain("So no weights, no efficient frontier and no portfolio-level CVaR are produced this session.");
  });

  it("on the Tools route the null-optimizer payload reads unavailable in the Allocation summary's Optimizer row and in the amber strip", async () => {
    p9Stub(payload);
    renderWithProviders(
      <ShellActionsContext.Provider value={NO_SHELL_ACTIONS}>
        <main id="main-content">
          <ToolsScreen />
        </main>
      </ShellActionsContext.Provider>,
      { route: "/app/tools#allocation" },
    );
    await screen.findByRole("heading", { level: 1, name: "SPY" });
    const summary = p9ById("allocation-summary") as HTMLElement;
    const dts = [...summary.querySelectorAll("dl dt")].map((d) => p9Text(d));
    expect(dts).toEqual(["Sample", "Risk-free", "Optimizer"]);
    const optimizerDd = [...summary.querySelectorAll("dl dt")].find((d) => p9Text(d) === "Optimizer")?.nextElementSibling as HTMLElement;
    expect(p9Text(optimizerDd)).toBe(`Unavailable: ${payload.optimizations_skipped.sentence}`);
    expect(p9Text([...summary.querySelectorAll("dl dt")].find((d) => p9Text(d) === "Sample")?.nextElementSibling)).toBe("28 Goldilocks months · 284 total since Jan 2003");
    expect(p9Text([...summary.querySelectorAll("dl dt")].find((d) => p9Text(d) === "Risk-free")?.nextElementSibling)).toBe("4.00% Fed Funds");
    const strip = summary.querySelector<HTMLElement>('a[href$="#allocation-optimization"]') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(strip).toHaveClass("mrr-status");
    expect(strip).toHaveAttribute("data-tone", "amber");
    expect(p9Text(strip.querySelector(".mrr-status-title"))).toBe("Optimizer unavailable this session");
    expect(p9Text(strip.querySelector("small"))).toBe("19 of 28 Goldilocks months complete · 24 required");
  });

  it("the overview matrix has one column header ending ←, the months in regime row with n= cells, the regime Tag, the meta and the chip line; the caption cites the positive-return / negative-Sharpe cell", async () => {
    renderWithProviders(<AllocationPanel />);
    await waitFor(() => expect(p9Overview()).not.toBeNull());
    const table = await waitFor(() => {
      const t = p9Overview().querySelector<HTMLElement>('[role="table"][aria-label="Regime-conditional performance"]');
      expect(t).not.toBeNull();
      return t as HTMLElement;
    });
    const headers = [...table.querySelectorAll('[role="columnheader"]')].map((c) => p9Text(c));
    expect(headers.filter((h) => h.endsWith(" ←"))).toEqual(["Goldilocks ←"]);
    expect(headers.filter(Boolean)).toEqual(["Goldilocks ←", "Overheating", "Stagflation", "Recession Risk"]);
    const rowheaders = [...table.querySelectorAll('[role="rowheader"]')].map((r) => p9Text(r));
    expect(rowheaders).toEqual([...NAMES, "months in regime"]);
    const cells = [...table.querySelectorAll('[role="cell"]')].map((c) => p9Text(c));
    expect(cells.slice(-4)).toEqual(["n=28", "n=61", "n=74", "n=126"]);
    expect(cells[0]).toBe("+14.2% · SR 0.91");
    expect(cells[1]).toBe("-3.0% · SR -0.40");
    const tag = p9Overview().querySelector<HTMLElement>('span[data-tone="reference"]');
    expect(tag).not.toBeNull();
    expect(p9Text(tag)).toBe("Goldilocks");
    expect(within(p9Overview()).getByRole("heading", { level: 2, name: "Regime-conditional performance" })).toBeInTheDocument();
    expect(p9Text(p9Overview().querySelector(".mrr-sec-sp"))).toContain("289 months · Aug 2002 → Aug 2026 · risk-free 3.63% (Fed Funds)");
    const t = p9Text(p9Overview());
    expect(t).toContain("64% model odds · conviction 50% (a separate heuristic, not odds); read the current column first");
    expect(t).toContain("A positive return with a negative Sharpe (TLT prints +2.1% in Overheating at SR -0.15) means the return does not cover cash plus the risk taken.");
    expect(t).toContain("Small n columns are anecdotes, not laws.");
    expect(t).toContain("Annualized return and Sharpe per regime since Aug 2002.");
    expect(t).not.toContain("—");
  });
});
