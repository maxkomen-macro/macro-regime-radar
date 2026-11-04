/**
 * Desk P1b (docs/desk/CORRELATION_VIEWS.md §7): the correlation window control
 * and the correlation-by-regime card, against /macro with its views served. The
 * 20- and 120-return values here are made up for the test (distinct from the
 * 60-return ones so a switch is visible); the 60-return view is the fixture's
 * own served block, as the API repeats it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { servedMacro } from "../../../test/desk-variants";
import { horizonWords, matrixAt, noiseSentence, regimeNote, regimeTable, rowAt, servedHorizons, stockBondAt } from "./views";
import type { ByRegime, MatrixWithViews, RowWithViews, StockBondWithViews } from "./views";
import type { MacroResponse } from "../data/types";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const BAND: Record<string, number> = { "20": 0.37898, "60": 0.21452, "120": 0.15093 };
const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];

function byRegime(base: number, current: string | null = "Overheating"): ByRegime {
  return {
    regime_history: "revised",
    rule: "Revised regime history: a daily return dated in month K takes the regimes row stamped K−2 months, the first month that row could govern (the event study's rule); returns without a row are Unlabeled and left out.",
    lag_months: 2,
    as_known: null,
    as_known_reason: "As known at the time is not available yet: it needs the point-in-time regime history (the approved point-in-time plan), which is not built.",
    min_n: 60,
    current,
    sample: { start: "2002-07-31", end: "2026-09-23" },
    unlabeled_n: 22,
    incomplete_n: 0,
    regimes: REGIMES.map((r, i) =>
      r === "Recession Risk"
        ? { regime: r, corr: null, n: 41, first: "2020-04-01", last: "2020-05-29", reason: "only 41 daily returns in Recession Risk; a correlation needs 60", spells: 1, largest_spell_share: 1 }
        : { regime: r, corr: base + i / 10, n: 500 + i, first: "2002-09-03", last: "2026-09-23", reason: null, spells: 10 + i, largest_spell_share: i === 0 ? 0.4 : 0.1 },
    ),
    all: { corr: base, n: 6000, first: "2002-09-03", last: "2026-09-23", reason: null },
    reason: null,
  };
}

/** /macro as served, with its P1b views: "60" repeats each block's own answer, 20 and 120 differ. */
function withViews(opts: { matrixHorizons?: number[] } = {}): Any {
  const m = JSON.parse(JSON.stringify(servedMacro())) as Any;
  const sb = m.stock_bond as Any;
  const own = (o: Any) => ({ today: o.today, today_date: o.today_date, today_reason: o.today_reason, year_ago: o.year_ago, year_ago_date: o.year_ago_date, flipped: o.flipped, flipped_on: o.flipped_on, flipped_to: o.flipped_to, series: o.series, window: o.window, line_window: o.line_window });
  sb.horizons = [20, 60, 120];
  sb.by_horizon = {
    "20": { ...own(sb), horizon: 20, noise_band: BAND["20"], today: -0.33, year_ago: -0.46, window: { ...sb.window, n: 20 }, series: sb.series.map((p: Any) => ({ ...p, corr: p.corr == null ? null : -p.corr })) },
    "60": { ...own(sb), horizon: 60, noise_band: BAND["60"] },
    "120": { ...own(sb), horizon: 120, noise_band: BAND["120"], today: 0.28, window: { ...sb.window, n: 120 } },
  };
  m.correlations = (m.correlations as Any[]).map((r, i) => ({
    ...r,
    by_horizon:
      r.corr == null
        ? null
        : {
            "20": { horizon: 20, noise_band: BAND["20"], corr: r.symbol === "TLT" ? -0.33 : r.corr, window: { ...r.window, n: 20 }, reason: null },
            "60": { horizon: 60, noise_band: BAND["60"], corr: r.corr, window: r.window, reason: r.reason },
            "120": { horizon: 120, noise_band: BAND["120"], corr: r.corr, window: { ...r.window, n: 120 }, reason: null },
          },
    by_regime: r.corr == null ? null : byRegime(-0.3 + i / 20),
  }));
  const mx = m.matrix as Any;
  const hs = opts.matrixHorizons ?? [20, 60, 120];
  mx.horizons = hs;
  const grid = (w: number) => ({ values: mx.values, no_data: mx.no_data, window: { ...mx.window, n: w }, coverage: mx.coverage.map((c: number | null) => (c == null ? null : w)), lead: mx.lead, horizon: w, noise_band: BAND[String(w)] });
  mx.by_horizon = Object.fromEntries(hs.map((w) => [String(w), w === 60 ? { values: mx.values, no_data: mx.no_data, window: mx.window, coverage: mx.coverage, lead: mx.lead, horizon: 60, noise_band: BAND["60"] } : grid(w)]));
  return m;
}

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/macro" },
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("P1b helpers", () => {
  it("offers only the horizons every correlation block serves, and nothing without views", () => {
    expect(servedHorizons(servedMacro() as unknown as MacroResponse)).toEqual([]);
    expect(servedHorizons(withViews() as MacroResponse)).toEqual([20, 60, 120]);
    expect(servedHorizons(withViews({ matrixHorizons: [20, 60] }) as MacroResponse)).toEqual([20, 60]);
    expect(servedHorizons(withViews({ matrixHorizons: [60] }) as MacroResponse)).toEqual([]);
    expect(servedHorizons(undefined)).toEqual([]);
  });

  it("picks a horizon's served fields and keeps the block as served without views", () => {
    const m = withViews();
    const sb = stockBondAt(m.stock_bond as StockBondWithViews, 20);
    expect([sb.today, sb.window?.n, sb.stock?.etf]).toEqual([-0.33, 20, "SPY"]);
    const plain = servedMacro() as Any;
    expect(stockBondAt(plain.stock_bond, 20)).toBe(plain.stock_bond);
    const tlt = (m.correlations as RowWithViews[]).find((r) => r.symbol === "TLT")!;
    expect(rowAt(tlt, 20).corr).toBe(-0.33);
    expect(rowAt(tlt, 60).corr).toBe(tlt.corr);
    expect(matrixAt(m.matrix as MatrixWithViews, 120).horizon).toBe(120);
    expect(matrixAt(m.matrix as MatrixWithViews, 120).window?.n).toBe(120);
  });

  it("words the noise floor and a regime cell's note", () => {
    expect(noiseSentence(20, 0.37898)).toBe("With 20 daily returns, a true correlation of zero reads beyond ±0.38 one time in ten if returns were independent; real returns are noisier, so treat smaller moves as noise.");
    expect(noiseSentence(20, null)).toBe("");
    expect([horizonWords(20), horizonWords(60), horizonWords(120)]).toEqual(["about a month", "about a quarter", "about six months"]);
    expect(regimeNote({ regime: "Goldilocks", corr: 0.1, n: 540, first: null, last: null, reason: null, spells: 17, largest_spell_share: 0.15 })).toBe("n 540 · 17 spells");
    expect(regimeNote({ regime: "Recession Risk", corr: 0.1, n: 377, first: null, last: null, reason: null, spells: 1, largest_spell_share: 1 })).toBe("n 377 · 1 spell · 100% in one");
  });

  it("marks the current regime only when every row agrees", () => {
    const rows = (withViews().correlations as RowWithViews[]).filter((r) => r.by_regime);
    expect(regimeTable(rows).current).toBe("Overheating");
    const split = rows.map((r, i) => (i === 0 ? { ...r, by_regime: { ...(r.by_regime as ByRegime), current: "Stagflation" } } : r));
    expect(regimeTable(split).current).toBeNull();
    expect(regimeTable(servedMacro().correlations as RowWithViews[]).rows).toEqual([]);
  });
});

describe("the correlation window control", () => {
  beforeEach(() => {
    stubDesk({ "/api/desk/macro": () => withViews() });
  });

  it("is absent when the blocks serve no views", async () => {
    stubDesk({ "/api/desk/macro": () => servedMacro() });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Correlation matrix/ })).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Correlation window" })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Correlation by regime/ })).toBeNull();
  });

  it("starts at 60 days and switches the three correlation cards together", async () => {
    renderTab();
    const group = await screen.findByRole("group", { name: "Correlation window" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["20 days", "60 days", "120 days"]);
    expect(within(group).getByRole("button", { name: "60 days" })).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveTextContent("±0.21 one time in ten");
    const sb = screen.getByRole("region", { name: /^Do bonds still hedge stocks\? 60-day/ });
    expect(sb).toHaveTextContent("+0.44");

    fireEvent.click(within(group).getByRole("button", { name: "20 days" }));
    expect(within(group).getByRole("button", { name: "20 days" })).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveTextContent("With 20 daily returns, a true correlation of zero reads beyond ±0.38 one time in ten");
    const sb20 = screen.getByRole("region", { name: /^Do bonds still hedge stocks\? 20-day correlation of daily returns, one year/ });
    expect(within(sb20).getByText("−0.33")).toBeInTheDocument();
    expect(sb20).toHaveTextContent("20 daily log returns to");
    const corr = screen.getByRole("region", { name: /^What moves with the S&P 20-day correlation/ });
    expect(within(corr).getByText("−0.33")).toBeInTheDocument();
    const mx = screen.getByRole("region", { name: /^Correlation matrix 20-day correlation/ });
    expect(mx).toHaveTextContent(/20 daily returns · \w{3} \d+ to .* · the same window for every pair/);
    expect(within(mx).getByRole("region", { name: "The 20-day correlation matrix, every pair" })).toBeInTheDocument();
  });

  it("checks a horizon's grid as one fact: a lead that disagrees with its cells is not drawn", async () => {
    const m = withViews();
    m.matrix.by_horizon["120"].lead = { ...m.matrix.by_horizon["120"].lead, text: "Something else." };
    stubDesk({ "/api/desk/macro": () => m });
    renderTab();
    const group = await screen.findByRole("group", { name: "Correlation window" });
    fireEvent.click(within(group).getByRole("button", { name: "120 days" }));
    const mx = screen.getByRole("region", { name: /^Correlation matrix 120-day/ });
    expect(mx).toHaveTextContent("Awaiting refresh: the matrix as served could not be read");
  });

  it("drops the served windows and by-regime items from the stock–bond Advanced list", async () => {
    renderTab();
    const sb = await screen.findByRole("region", { name: /^Do bonds still hedge stocks\?/ });
    expect(sb).not.toHaveTextContent("correlation by regime");
  });
});

describe("the correlation-by-regime card", () => {
  beforeEach(() => {
    stubDesk({ "/api/desk/macro": () => withViews() });
  });

  it("is labelled as revised regime history and names what is not available", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Correlation by regime/ });
    expect(card).toHaveTextContent("Revised regime history");
    expect(card).toHaveTextContent("stamped K−2 months");
    expect(card).toHaveTextContent("As known at the time is not available yet");
    expect(card).toHaveTextContent("No interval is served");
    expect(card).toHaveTextContent("a regime with fewer than 60 is not served");
  });

  it("prints each served value with its n and spells, marks the current regime, and leaves a short regime blank with its reason", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Correlation by regime/ });
    const table = within(card).getByRole("table");
    const heads = within(table).getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads).toEqual(["Asset", "Goldilocks", "Overheating · now", "Stagflation", "Recession Risk", "All labelled", "Sample"]);
    const tltRow = within(table).getAllByRole("row").find((r) => within(r).queryByText("TLT"))!;
    const cells = within(tltRow).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("−0.30");
    expect(cells[0]).toHaveTextContent("n 500 · 10 spells · 40% in one");
    expect(cells[1]).toHaveTextContent("−0.20");
    expect(cells[1]).toHaveAttribute("data-current");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[3]).toHaveAttribute("title", expect.stringContaining("only 41 daily returns in Recession Risk; a correlation needs 60"));
    expect(cells[4]).toHaveTextContent("n 6,000");
    expect(cells[5]).toHaveTextContent("2002 to Sep 23");
  });

  it("prints a row's reason across the row when its regime history is not stored", async () => {
    const m = withViews();
    for (const r of m.correlations as Any[]) if (r.by_regime) r.by_regime = { ...r.by_regime, reason: "no regime history is stored in this database", regimes: [], all: null, current: null };
    (m.correlations as Any[])[1].by_regime = byRegime(0.1);
    stubDesk({ "/api/desk/macro": () => m });
    renderTab();
    const card = await screen.findByRole("region", { name: /^Correlation by regime/ });
    expect(card).toHaveTextContent("not available · no regime history is stored in this database");
  });
});
