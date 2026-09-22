/**
 * The Desk shell against docs/desk/DESK_FRAME_SPEC.md: the route lands on
 * Today, the sidebar carries the three groups in order with the House
 * Discipline card, the wordmark points at the dashboard, the Desk / Client
 * toggle lives in the URL and hides the query builder, every page carries a
 * status badge, and the discipline gate holds against the keyboard and the
 * URL. stubFetch answers the stored endpoints with minimal bodies; the
 * event-study engine answers 404 (absent), as it does until Stream A lands.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "./DeskShell";
import { DESK_GROUPS, HOUSE_DISCIPLINE } from "./desk-sections";
import { POSITIONS_KEY, resetPositionsForTests } from "./positions/store";
import { renderWithProviders, stubFetch } from "../../test/utils";

const MONTH = "2026-08-01";
const DAILY = "2026-09-18";

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function fresh() {
  return {
    regimes_date: MONTH,
    signals_date: MONTH,
    market_daily_date: DAILY,
    market_intraday_ts: `${DAILY}T19:55:00`,
    news_published_at: null,
    raw_series_date: DAILY,
    generated_at: `${DAILY}T20:05:00Z`,
    overall: "current",
    session: { last_completed_session: DAILY, is_open: false, phase: "post" },
    sla: [],
    regime: { latest_month: MONTH, expected_month: MONTH, inputs: [], blockers: [] },
    series: [
      { id: "DGS10", label: "10-year Treasury yield", kind: "fred", cadence: "daily", as_of: DAILY, state: "close", delay_min: null, cycles_behind: 0, stale: false, discontinued: false, reason: "Newest print." },
      { id: "market_daily", label: "Daily bars (stored)", kind: "market", cadence: "daily", as_of: DAILY, state: "close", delay_min: null, cycles_behind: 0, stale: false, discontinued: false, reason: "Through the last session." },
      { id: "INDPRO", label: "Industrial production", kind: "fred", cadence: "monthly", as_of: MONTH, state: "close", delay_min: null, cycles_behind: 0, stale: false, discontinued: false, reason: "Newest print due." },
    ],
  };
}

function stub() {
  return stubFetch({
    "/api/freshness": fresh,
    "/api/regime/latest": () => ({ date: MONTH, label: "Goldilocks", confidence: 0.71, growth_trend: 0.4, inflation_trend: -0.2, prob_goldilocks: 0.62, prob_overheating: 0.18, prob_stagflation: 0.12, prob_recession: 0.08 }),
    "/api/recession/probability": () => ({ probability_source: "recession_model", recession_prob: 11.6, recession_label: "Low Risk", recession_color: "g", yield_curve_spread: 0.3, yield_curve_pct_rank: 40, inversion_duration_months: 0, is_inverted: false, divergence_score: 0, divergence_label: "Aligned", divergence_color: "g", recession_prob_series: [], yield_curve_series: [], usrec_series: [], n_training_samples: 281, model_features: ["yield_curve"], feature_coefficients: {}, data_as_of: DAILY, curve_shape: {}, current_inputs: {}, freshness: null }),
    "/api/alerts": () => [],
    "/api/signals/latest": () => ({ date: MONTH, signals: [], freshness: null }),
    "/api/desk/pipeline/inventory": () => ({ generated_at: `${DAILY}T20:05:00Z`, overall: "current", regimes_date: MONTH, signals_date: MONTH, market_daily_date: DAILY, market_intraday_ts: null, news_published_at: null, raw_series_date: DAILY, series: fresh().series.map((s) => ({ ...s, source: "FRED", source_id: s.id, feeds: ["Regime classifier"] })) }),
    "/series/DGS10/latest": () => ({ series_id: "DGS10", date: DAILY, value: 4.12 }),
  });
}

function renderDesk(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route },
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetPositionsForTests();
  stub();
});
afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe("Desk shell", () => {
  it("lands /desk on Today, names the document and shows the regime as the answer", async () => {
    renderDesk("/desk");
    expect(await screen.findByTestId("loc")).toHaveTextContent("/desk/today");
    await waitFor(() => expect(document.title).toBe("Today · Desk · Macro Regime Radar"));
    const h1 = await screen.findByRole("heading", { level: 1 });
    await waitFor(() => expect(h1).toHaveTextContent("Goldilocks"));
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("the sidebar carries the three groups in order, the House Discipline card, and the wordmark points at the dashboard", async () => {
    renderDesk("/desk/today");
    const side = await screen.findByRole("complementary", { name: "Sidebar" });
    const groups = [...side.querySelectorAll(".mrr-desk-group")].map((g) => g.textContent?.trim());
    expect(groups).toEqual(DESK_GROUPS.map((g) => g.label));
    for (const g of DESK_GROUPS) for (const p of g.pages) expect(within(side).getByRole("link", { name: new RegExp(`^${p.label.replace(/[/&]/g, (c) => `\\${c}`)}`) })).toBeTruthy();
    expect(within(side).getByRole("link", { name: /^Dashboard/ })).toHaveAttribute("href", "/app/dashboard");
    expect(within(side).getByTitle(/back to the dashboard/)).toHaveAttribute("href", "/app/dashboard");
    const house = within(side).getByTestId("desk-house");
    expect(house).toHaveTextContent("House Discipline");
    expect(house).toHaveTextContent("Enforced");
    for (const rule of HOUSE_DISCIPLINE) expect(house).toHaveTextContent(rule);
    expect(within(side).getByRole("link", { name: /^Today/ })).toHaveAttribute("aria-current", "page");
    // Designed shells carry the mark; live pages do not.
    expect(within(side).getByRole("link", { name: /^Red Team/ }).querySelector(".mrr-desk-nav-mark")).toBeTruthy();
    expect(within(side).getByRole("link", { name: /^Event Study/ }).querySelector(".mrr-desk-nav-mark")).toBeNull();
  });

  it("every page carries a status badge; designed shells declare Designed", async () => {
    renderDesk("/desk/red-team");
    const badges = await screen.findAllByTestId("desk-badge");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((b) => b.getAttribute("data-state") === "designed")).toBe(true);
    expect(screen.getByText(/Reads saved positions, the regime odds/)).toBeTruthy();
  });

  it("the Desk / Client toggle lives in the URL, hides the query builder and adds Export", async () => {
    renderDesk("/desk/event-study");
    await screen.findByRole("heading", { level: 2, name: /^Query/ });
    expect(screen.queryByTestId("desk-export")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Client" }));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/event-study?view=client"));
    await waitFor(() => expect(screen.queryByRole("heading", { level: 2, name: /^Query/ })).toBeNull());
    expect(screen.getByTestId("desk-export")).toBeTruthy();
    // Every Desk link keeps the view.
    const side = screen.getByRole("complementary", { name: "Sidebar" });
    expect(within(side).getByRole("link", { name: /^Today/ })).toHaveAttribute("href", "/desk/today?view=client");
    fireEvent.click(screen.getByRole("button", { name: "Desk" }));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/event-study"));
    expect(screen.getByTestId("loc")).not.toHaveTextContent("view=client");
  });

  it("a study slug in the URL selects the preset and the fixture is labelled, not passed off as data", async () => {
    renderDesk("/desk/event-study?study=gold-2sigma-spx-weak");
    await screen.findByRole("heading", { level: 2, name: /^Verdict/ });
    expect(screen.getAllByText("Fixture").length).toBeGreaterThan(0);
    const badges = screen.getAllByTestId("desk-badge");
    expect(badges.some((b) => b.textContent === "Designed")).toBe(true);
  });
});

describe("Position Monitor gate", () => {
  const GOOD = {
    instrument: "TLT",
    variant: "Duration is likely to cheapen as the cuts priced fade.",
    premortem: "Growth cracked and the curve bull-steepened through my level.",
  };

  async function fillGood(instrument = GOOD.instrument) {
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: instrument } });
    fireEvent.change(screen.getByLabelText("Variant view"), { target: { value: GOOD.variant } });
    fireEvent.change(screen.getByLabelText("Pre-mortem"), { target: { value: GOOD.premortem } });
    fireEvent.change(screen.getByLabelText("Falsification series"), { target: { value: "DGS10" } });
    fireEvent.change(screen.getByLabelText(/^Falsification level/), { target: { value: "3.80" } });
  }

  it("Save is disabled until the three gates are met, and a keyboard submit does not save", async () => {
    renderDesk("/desk/position-monitor");
    const save = await screen.findByTestId("desk-save-position");
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "TLT" } });
    fireEvent.change(screen.getByLabelText("Variant view"), { target: { value: "This will definitely work." } });
    expect(screen.getAllByText(/Replace/)).toHaveLength(2);
    expect(save).toBeDisabled();
    // Enter in a field submits the form: the gate refuses and nothing is stored.
    fireEvent.submit(save.closest("form")!);
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
    expect(screen.getByText(/Nothing saved/)).toBeTruthy();
    expect(screen.getByText(/Save is blocked/)).toBeTruthy();
  });

  it("a rewrite clears the flag; a passing draft saves on this device and appears in the list", async () => {
    renderDesk("/desk/position-monitor");
    await fillGood();
    fireEvent.change(screen.getByLabelText("Pre-mortem"), { target: { value: "It never fails." } });
    const save = screen.getByTestId("desk-save-position");
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(screen.getByLabelText("Pre-mortem")).toHaveValue("It rarely in the sample fails.");
    expect(save).toBeEnabled();
    fireEvent.submit(save.closest("form")!);
    const rows = await screen.findAllByTestId("desk-position");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("TLT");
    expect(window.localStorage.getItem(POSITIONS_KEY)).toMatch(/"version":1/);
    await waitFor(() => expect(rows[0]).toHaveTextContent(/away/));
  });

  it("the URL cannot prefill or bypass the gate, and the client view has no form at all", async () => {
    renderDesk("/desk/position-monitor?instrument=TLT&variant_view=x&pre_mortem=y&falsification_level=3.8&save=1");
    const save = await screen.findByTestId("desk-save-position");
    expect(save).toBeDisabled();
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
  });

  it("client view lists positions in words without the form", async () => {
    renderDesk("/desk/position-monitor?view=client");
    await screen.findByRole("heading", { level: 2, name: /^Monitored positions/ });
    expect(screen.queryByTestId("desk-save-position")).toBeNull();
    expect(screen.getByText(/No positions saved on this device/)).toBeTruthy();
  });
});
