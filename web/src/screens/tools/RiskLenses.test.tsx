/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 9,
 * `tools/RiskLenses.test.tsx`: the Risk analysis panel (B.12) driven through
 * `AllocationPanel` with the full fixture (./__fixtures__/allocation.ts): the
 * four primary lenses and the "More lenses ▸" reveal, every lens's tile, every
 * StateNote when its block is missing or null, and no em-dash in any rendered
 * caption. The clock is frozen (only `Date`). Figures are the fixture's, never
 * the baseline's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import type { AllocationData, FrameData } from "../../api/types";
import AllocationPanel from "./AllocationPanel";
import { renderWithProviders, stubFetch } from "../../test/utils";
import { FULL, NAMES, NULL_OPT, REGIMES, REGIME_CORRELATIONS, spct } from "./__fixtures__/allocation";
import { NOW } from "./__fixtures__/lbo";

const PRIMARY = ["Tail risk", "Drawdowns", "Correlation", "Factors"];
const ALL_LENSES = [...PRIMARY, "Style", "Transition P&L", "Currency", "Real vs nominal"];
const MORE = "More lenses ▸";

/** Text with `hidden` subtrees removed (Jargon tooltips, closed disclosures), whitespace collapsed. */
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
const risk = () => document.getElementById("allocation-risk") as HTMLElement;
const lensGroup = () => within(risk()).getByRole("group", { name: "Risk lens" });
const lensOptions = () => [...lensGroup().querySelectorAll("button")].map((b) => text(b));
const pressed = (group: HTMLElement) => [...group.querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => text(b));
const moreButton = () => within(risk()).queryByRole("button", { name: MORE });
const meterRows = () => risk().querySelectorAll(".mrr-meter-row");
const ths = () => [...risk().querySelectorAll("table th")].map((th) => text(th));
/** Captions and state notes: the elements styled at the caption size. */
const captions = () => [...risk().querySelectorAll<HTMLElement>("[style*='var(--fs-caption)']")];

function stub(a: AllocationData) {
  stubFetch({ "/api/allocation": () => a, "/api/regime/latest": () => ({ label: "Goldilocks" }) });
}
async function open(a: AllocationData = FULL): Promise<void> {
  stub(a);
  renderWithProviders(<AllocationPanel />, { route: "/app/tools#allocation" });
  await waitFor(() => expect(risk()).not.toBeNull());
  await waitFor(() => expect(lensGroup()).toBeInTheDocument());
}
function pick(name: string): void {
  if (!PRIMARY.includes(name) && moreButton()) fireEvent.click(moreButton() as HTMLElement);
  fireEvent.click(within(lensGroup()).getByRole("button", { name }));
  expect(pressed(lensGroup())).toEqual([name]);
}
/** A tile is on screen: a role=table, a table, meter rows, or a caption-sized note. */
const hasTile = () => risk().querySelector('[role="table"], table, .mrr-meter-row') != null || captions().length > 0;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", "/app/tools#allocation");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("RiskLenses (checklist 09 E.1 row 9)", () => {
  it("four primary options and More lenses ▸ (aria-expanded=false) at rest with Tail risk pressed; clicking reveals eight options in order and removes the button; the header and meta are verbatim", async () => {
    await open();
    expect(within(risk()).getByRole("heading", { level: 2, name: "Risk analysis" })).toBeInTheDocument();
    expect(text(risk().querySelector(".mrr-sec-sp"))).toContain("one lens at a time · four primary, four more on request");
    expect(lensOptions()).toEqual(PRIMARY);
    expect(pressed(lensGroup())).toEqual(["Tail risk"]);
    expect(lensGroup()).toHaveAttribute("data-mono", "true");
    const more = moreButton() as HTMLElement;
    expect(more).not.toBeNull();
    expect(more).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(more);
    expect(lensOptions()).toEqual(ALL_LENSES);
    expect(moreButton()).toBeNull();
    expect(pressed(lensGroup())).toEqual(["Tail risk"]);
    for (const name of ALL_LENSES) expect(within(lensGroup()).getByRole("button", { name })).toHaveAttribute("aria-pressed");
  });

  it("tail: one MeterRow per asset under CVaR / VaR headers, the portfolio CVaR list marking Min CVaR (fallback), the caption", async () => {
    await open();
    pick("Tail risk");
    expect(meterRows()).toHaveLength(NAMES.length);
    const t = text(risk());
    expect(t).toContain("Asset tail risk · monthly, 95%");
    expect(t).toContain("CVaR");
    expect(t).toContain("VaR");
    expect(t).toContain("Portfolio CVaR by method");
    expect(t).toContain("Min CVaR (fallback)");
    expect(t).toContain(spct(FULL.cvar_95.asset_cvar.SPY.cvar));
    expect(t).toContain(spct(FULL.cvar_95.asset_cvar.SPY.var));
    expect(t).toContain("Mean-Variance");
    expect(t).toContain(spct(-0.061));
    expect(t).toContain("is the average loss in the worst 5% of months");
    expect(t).toContain("Bars scale to a −20% monthly loss.");
  });

  it("drawdowns: a table with a th per regime plus Overall, one row per asset, the overall column, and the semicolon fix", async () => {
    await open();
    pick("Drawdowns");
    expect(ths()).toEqual(["Asset", ...REGIMES, "Overall"]);
    expect(risk().querySelectorAll("table tbody tr")).toHaveLength(NAMES.length);
    const t = text(risk());
    expect(t).toContain("Maximum drawdown · by regime and overall");
    expect(t).toContain(spct(-0.51));
    expect(t).toContain(spct(-0.48));
    expect(t).toContain("needs +100% to recover; the asymmetry is the whole argument for risk budgeting.");
  });

  it("correlation: a role=table named for the regime, the picker pressed on the current regime, the faint 1.00 diagonal, the colon fix", async () => {
    await open();
    pick("Correlation");
    const picker = within(risk()).getByRole("group", { name: "Correlation regime" });
    expect(pressed(picker)).toEqual(["Goldilocks"]);
    expect([...picker.querySelectorAll("button")].map((b) => text(b))).toEqual(REGIMES);
    const table = risk().querySelector('[role="table"]') as HTMLElement;
    expect(table).toHaveAttribute("aria-label", "Asset correlations in Goldilocks");
    expect([...table.querySelectorAll('[role="rowheader"]')].map((r) => text(r))).toEqual(NAMES);
    const diagonal = [...table.querySelectorAll<HTMLElement>('[role="cell"]')].filter((c) => text(c) === "1.00");
    expect(diagonal).toHaveLength(NAMES.length);
    for (const c of diagonal) expect(c.getAttribute("style") ?? "").toContain("var(--text-4)");
    expect(text(table)).toContain((-0.35).toFixed(2));
    fireEvent.click(within(picker).getByRole("button", { name: "Stagflation" }));
    expect(pressed(picker)).toEqual(["Stagflation"]);
    expect(risk().querySelector('[role="table"]')).toHaveAttribute("aria-label", "Asset correlations in Stagflation");
    expect(text(risk())).toContain("stress: diversification that exists on paper (Goldilocks) and disappears when needed is the point of checking per regime.");
    expect(text(risk())).toContain("Blue cells are the true diversifiers.");
  });

  it("factors: a row per method with the signed betas, R² and α, the fallback marker, and the Regime Lab link", async () => {
    await open();
    pick("Factors");
    const t = text(risk());
    expect(t).toContain("Portfolio factor exposures · OLS betas");
    expect(t).toContain("Mean-Variance");
    expect(t).toContain("Value -0.12");
    expect(t).toContain("Momentum +0.31");
    expect(t).toContain("R² 0.34");
    expect(t).toContain("α +1.2%/yr");
    expect(t).toContain("Min CVaR (fallback)");
    expect(t).toContain("HERC");
    expect(within(risk()).getByRole("link", { name: /Regime Lab → Backtests/ })).toHaveAttribute("href", "/app/regime-lab#backtests");
    expect(t).toContain("the Fama-French idea without their data files");
  });

  it("style: Return / Vol / Sharpe / Hit rate headers, rows sorted by Sharpe with dashes on the spread row, the picker on the current regime, the semicolon fix", async () => {
    await open();
    pick("Style");
    const picker = within(risk()).getByRole("group", { name: "Style regime" });
    expect(pressed(picker)).toEqual(["Goldilocks"]);
    expect(ths()).toEqual(["Style", "Return", "Vol", "Sharpe", "Hit rate"]);
    const rows = [...risk().querySelectorAll("table tbody tr")];
    const cells = (tr: Element) => [...tr.querySelectorAll("td")].map((td) => text(td));
    expect(rows.map((r) => cells(r)[0])).toEqual(["Momentum", "Growth", "Value", "Growth-Value Spread"]);
    expect(cells(rows[0])).toEqual(["Momentum", "+19.0%", "20.0%", "0.80", "68%"]);
    expect(cells(rows[3])).toEqual(["Growth-Value Spread", "+7.0%", "—", "—", "—"]);
    expect(text(risk())).toContain("Annualized style returns inside Goldilocks months only.");
    expect(text(risk())).toContain("finished positive; read it against the month count, not as gospel.");
  });

  it("transitions: the repeated pair option pressed with its count, no single-occurrence pair, a MeterRow per asset, the colon fix", async () => {
    await open();
    pick("Transition P&L");
    const picker = within(risk()).getByRole("group", { name: "Regime switch" });
    expect([...picker.querySelectorAll("button")].map((b) => text(b))).toEqual(["Goldilocks → Overheating · n=3"]);
    expect(pressed(picker)).toEqual(["Goldilocks → Overheating · n=3"]);
    expect(text(risk())).not.toContain("n=1");
    expect(meterRows()).toHaveLength(NAMES.length);
    const t = text(risk());
    expect(t).toContain("Forward 3M returns after");
    expect(t).toContain(spct(0.021));
    expect(t).toContain(spct(-0.014));
    expect(t).toContain("Sample counts are tiny by nature: this is a map of what happened, not a forecast.");
  });

  it("currency: a table with a th per regime and a row per pair with the σ figure", async () => {
    await open();
    pick("Currency");
    expect(ths()).toEqual(["Pair", ...REGIMES]);
    const rows = [...risk().querySelectorAll("table tbody tr")];
    expect(rows.map((r) => text(r.querySelector("td")))).toEqual(["EUR/USD", "USD/JPY"]);
    const t = text(risk());
    expect(t).toContain("Currency moves by regime · annualized");
    expect(t).toContain("+3.1% · σ8%");
    expect(t).toContain("Dollar strength is a regime variable");
  });

  it("real vs nominal: the eyebrow with the month count, ▪ eroded on GLD only, the three columns, the colon fix", async () => {
    await open();
    pick("Real vs nominal");
    expect(ths()).toEqual(["Asset", "Nominal", "Real", "Inflation drag"]);
    const t = text(risk());
    expect(t).toContain("Real vs nominal · Goldilocks months (n=28)");
    expect(t).toContain("GLD ▪ eroded");
    expect(t).not.toContain("SPY ▪ eroded");
    expect(t).not.toContain("TLT ▪ eroded");
    expect(t).toContain(spct(-0.004));
    expect(t).toContain(spct(-0.065));
    expect(t).toContain("nominal gain turns into a real loss: the quiet failure mode of inflationary regimes.");
  });

  it("every lens renders a tile with a role=table, a table, meter rows or a note, and no rendered caption contains U+2014", async () => {
    await open();
    for (const name of ALL_LENSES) {
      pick(name);
      expect(hasTile(), name).toBe(true);
      for (const c of captions()) expect(text(c), `${name}: ${text(c)}`).not.toContain("—");
    }
  });

  it("StateNotes: drawdowns without columns", async () => {
    await open({ ...FULL, drawdowns: { by_regime: { index: [], columns: undefined as unknown as string[], data: [] } as FrameData, overall: {} } });
    pick("Drawdowns");
    expect(text(risk())).toContain("Drawdown history unavailable in this payload.");
    expect(risk().querySelector("table")).toBeNull();
  });

  it("StateNotes: an absent correlation regime", async () => {
    const { Overheating: _dropped, ...rest } = REGIME_CORRELATIONS;
    void _dropped;
    await open({ ...FULL, regime_correlations: rest });
    pick("Correlation");
    const picker = within(risk()).getByRole("group", { name: "Correlation regime" });
    fireEvent.click(within(picker).getByRole("button", { name: "Overheating" }));
    expect(text(risk())).toContain("Not enough months in this regime for a stable matrix.");
    expect(risk().querySelector('[role="table"]')).toBeNull();
  });

  it("StateNotes: style_performance null", async () => {
    await open({ ...FULL, style_performance: null });
    pick("Style");
    expect(text(risk())).toContain("Style history unavailable for this regime (needs ≥6 months).");
    expect(risk().querySelector("table")).toBeNull();
  });

  it("StateNotes: an empty transition_pnl", async () => {
    await open({ ...FULL, transition_pnl: {} });
    pick("Transition P&L");
    expect(text(risk())).toContain("No regime switch has repeated often enough to average (needs n ≥ 2).");
    expect(meterRows()).toHaveLength(0);
  });

  it("StateNotes: currency_impact null", async () => {
    await open({ ...FULL, currency_impact: null });
    pick("Currency");
    expect(text(risk())).toContain("Currency history unavailable from the vendor this session.");
    expect(risk().querySelector("table")).toBeNull();
  });

  it("StateNotes: real_nominal null, and a missing current regime", async () => {
    await open({ ...FULL, real_nominal: null });
    pick("Real vs nominal");
    expect(text(risk())).toContain("Real-vs-nominal splits unavailable: the source could not compute them this session.");
    expect(text(risk())).toContain("Real vs nominal · Goldilocks months (n=—)");
  });

  it("StateNotes: real_nominal without the current regime", async () => {
    await open({ ...FULL, real_nominal: { Overheating: { nominal: { SPY: 0.01 }, real: { SPY: -0.02 }, inflation_drag: { SPY: -0.03 }, n_months: 12 } } });
    pick("Real vs nominal");
    expect(text(risk())).toContain("No inflation-adjusted view for this regime.");
  });

  it("StateNotes: portfolio factors with the optimizer null, and the tail lens's dash rule for every method", async () => {
    await open(NULL_OPT);
    pick("Factors");
    expect(text(risk())).toContain("Portfolio betas are regressed on the optimizer weights; with none for Goldilocks this session there are no portfolio rows to show.");
    pick("Tail risk");
    const t = text(risk());
    expect(t).toContain("Portfolio CVaR weights the assets by an optimizer solution; there is none for Goldilocks this session, so every method reads —.");
    for (const label of ["Mean-Variance", "Min Variance", "Risk Parity", "Black-Litterman", "HRP", "Min CVaR", "HERC"]) expect(t).toContain(label);
    expect(t).not.toContain("(fallback)");
  });
});
