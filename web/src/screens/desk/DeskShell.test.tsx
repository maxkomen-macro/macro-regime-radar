/**
 * The Desk shell against docs/desk/DESK_FRAME_SPEC.md: the route lands on
 * Today, the sidebar carries the three groups in order with the House
 * Discipline card, the wordmark points at the dashboard, the Desk / Client
 * toggle lives in the URL and hides the query builder, every page carries a
 * status badge, and the discipline gate holds against the keyboard and the
 * URL. stubFetch answers the stored endpoints with minimal bodies and the
 * event-study engine with its real saved payloads (__fixtures__), so every
 * state the engine answers (ready, 202 computing, 429 busy, 422, awaiting the
 * first refresh, 404 absent) is driven through the page (DESK_FRAME2_SPEC §1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "./DeskShell";
import { DESK_GROUPS, HOUSE_DISCIPLINE } from "./desk-sections";
import { POSITIONS_KEY, resetPositionsForTests } from "./positions/store";
import { renderWithProviders, stubFetch } from "../../test/utils";
import engineAssets from "./event-study/__fixtures__/engine-assets.json";
import engineStudies from "./event-study/__fixtures__/engine-studies.json";

type Answer = { status: number; body: unknown };
/** The engine's answer per slug for one test; unlisted slugs answer the preset. */
let engine: Record<string, Answer> = {};

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

type Route = Parameters<typeof stubFetch>[0][string];

/** The stored endpoints' minimal bodies; `over` replaces a route by its key
 * (an existing key keeps its place, so prefix order holds). */
function stub(over: Record<string, Route> = {}) {
  return stubFetch({
    "/api/desk/event-study/assets": () => engineAssets,
    "/api/desk/event-study": (url) => {
      const slug = url.searchParams.get("study") ?? "";
      if (engine[slug]) return engine[slug];
      if (slug === "spx-golden-cross" || slug === "spx-death-cross") return engineStudies.cross;
      return engineStudies.preset;
    },
    "/api/freshness": fresh,
    "/api/regime/latest": () => ({ date: MONTH, label: "Goldilocks", confidence: 0.71, growth_trend: 0.4, inflation_trend: -0.2, prob_goldilocks: 0.62, prob_overheating: 0.18, prob_stagflation: 0.12, prob_recession: 0.08 }),
    "/api/recession/probability": () => ({ probability_source: "recession_model", recession_prob: 11.6, recession_label: "Low Risk", recession_color: "g", yield_curve_spread: 0.3, yield_curve_pct_rank: 40, inversion_duration_months: 0, is_inverted: false, divergence_score: 0, divergence_label: "Aligned", divergence_color: "g", recession_prob_series: [], yield_curve_series: [], usrec_series: [], n_training_samples: 281, model_features: ["yield_curve"], feature_coefficients: {}, data_as_of: DAILY, curve_shape: {}, current_inputs: {}, freshness: null }),
    "/api/alerts": () => [],
    "/api/signals/latest": () => ({ date: MONTH, signals: [], freshness: null }),
    "/api/desk/pipeline/inventory": () => ({ generated_at: `${DAILY}T20:05:00Z`, overall: "current", regimes_date: MONTH, signals_date: MONTH, market_daily_date: DAILY, market_intraday_ts: null, news_published_at: null, raw_series_date: DAILY, series: fresh().series.map((s) => ({ ...s, source: "FRED", source_id: s.id, feeds: ["Regime classifier"] })) }),
    "/series/DGS10/latest": () => ({ series_id: "DGS10", date: DAILY, value: 4.12 }),
    ...over,
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
  engine = {};
  window.localStorage.clear();
  resetPositionsForTests();
  stub();
});
afterEach(() => {
  globalThis.fetch = undefined as unknown as typeof fetch;
});

describe("Desk shell", () => {
  it("lands /desk on Today, names the document and shows the strip", async () => {
    renderDesk("/desk");
    expect(await screen.findByTestId("loc")).toHaveTextContent("/desk/today");
    await waitFor(() => expect(document.title).toBe("Today · Desk · Macro Regime Radar"));
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Today");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("today-regime")).toHaveTextContent("Goldilocks"));
    // The recession figure is the logistic model's, labelled as such; the regime odds are not printed.
    await waitFor(() => expect(screen.getByTestId("today-recession")).toHaveTextContent("11.6%"));
    expect(screen.getByText("Recession probability (logistic model)")).toBeTruthy();
    expect(screen.getByTestId("today-strip")).not.toHaveTextContent("8%");
    // Presets: each preset's newest served event, against the last five sessions the engine read.
    await waitFor(() => expect(screen.getByTestId("today-fired")).toHaveTextContent(/fired/));
    const newest = (engineStudies.preset as { recent_events: { date: string }[] }).recent_events[0].date;
    expect(screen.getByLabelText("Presets and their newest event")).toHaveTextContent(new RegExp(newest.slice(0, 4)));
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

  it("a study slug reads the engine: its verdict, its facts line and the Live badge from provenance, no fixture", async () => {
    renderDesk("/desk/event-study?study=gold-2sigma-spx-weak");
    await screen.findByRole("heading", { level: 2, name: /^Verdict/ });
    const raw = engineStudies.preset as { verdict: { text: string }; provenance: { n_events: number; data_start: string; as_of: string } };
    expect(screen.getByText(raw.verdict.text)).toBeTruthy();
    expect(document.body).toHaveTextContent(`n ${raw.provenance.n_events} · blocks`);
    expect(screen.getByTestId("es-sample")).toHaveTextContent(`Sample: ${raw.provenance.data_start} to`);
    expect(screen.queryByText("Fixture")).toBeNull();
    const badges = screen.getAllByTestId("desk-badge");
    expect(badges.every((b) => b.getAttribute("data-state") === "live")).toBe(true);
    expect(badges[0]).toHaveTextContent(/Live.*event-study engine.*as of/);
    // The sentence query and the presets as chips.
    const sentence = screen.getByTestId("es-sentence");
    const controls = [...sentence.querySelectorAll("select, [role=group]")].map((el) => el.getAttribute("aria-label"));
    expect(controls).toEqual(["Shock asset", "Threshold", "Direction", "Window in sessions", "Co-condition", "Target", "Regime filter"]);
    for (const word of ["When", "moves", "over", "sessions", "while", "what did", "do next", "in"]) expect(sentence.textContent).toContain(word);
    expect(screen.getByRole("button", { name: /S&P golden cross/ })).toHaveAttribute("aria-pressed", "false");
    // The by-regime table: one horizon at a time, 20 by default, n<10 where suppressed, the Unlabeled flag.
    expect(within(screen.getByRole("group", { name: "Horizon" })).getByRole("button", { name: "20d" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("n<10").length).toBeGreaterThan(0);
    expect(screen.getByText("outside the totals")).toBeTruthy();
  });

  it("a horizon cell expands to the events behind it and says how many the response carries", async () => {
    renderDesk("/desk/event-study");
    const cell = await screen.findByRole("button", { name: /^20d n \d+/ });
    fireEvent.click(cell);
    expect(cell).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Events behind 20 sessions" });
    expect(region).toHaveTextContent(/The response carries the last 10 of \d+ events|All \d+ of this cell's events are listed/);
    expect(within(region).getAllByRole("row").length).toBeGreaterThan(1);
  });

  it("Run writes the sentence's slug into ?study=", async () => {
    renderDesk("/desk/event-study");
    await screen.findByTestId("es-sentence");
    fireEvent.change(screen.getByLabelText("Window in sessions"), { target: { value: "5" } });
    fireEvent.click(screen.getByTestId("es-run"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("study=gold-w5-z2.0-up-spx_below_50dma-spx"));
  });

  it("202 computing is a quiet status line, 429 a plain busy line, 422 the engine's reason under the query", async () => {
    engine = {
      "gold-w5-z2.0-up-none-spx": { status: 202, body: engineStudies.computing },
      "gold-w60-z2.0-up-none-spx": { status: 429, body: { status: "busy", detail: "4 studies are computing; retry in 3 seconds." } },
      "gold-w5-z1.5-up-none-spx": { status: 422, body: { detail: "cond_value must be a finite number" } },
    };
    const { unmount } = renderDesk("/desk/event-study?study=gold-w5-z2.0-up-none-spx");
    expect(await screen.findByText(/Computing this study/)).toBeTruthy();
    expect(document.querySelector("[data-chart]")).toBeNull();
    unmount();
    const b = renderDesk("/desk/event-study?study=gold-w60-z2.0-up-none-spx");
    expect(await screen.findByText(/The engine is busy with other studies; try again/)).toBeTruthy();
    b.unmount();
    renderDesk("/desk/event-study?study=gold-w5-z1.5-up-none-spx");
    expect(await screen.findByTestId("es-refusal")).toHaveTextContent("The engine could not run this query: cond_value must be a finite number");
  });

  it("awaiting the first refresh is a sentence, never an empty chart; a server without the engine says so", async () => {
    engine = { "vix-w5-z2.0-up-none-spx": { status: 200, body: engineStudies.awaiting_refresh } };
    const a = renderDesk("/desk/event-study?study=vix-w5-z2.0-up-none-spx");
    expect(await screen.findByText("Awaiting the first full refresh.")).toBeTruthy();
    expect(document.querySelector("[data-chart]")).toBeNull();
    a.unmount();
    engine = { "gold-2sigma-spx-weak": { status: 404, body: { detail: "Not Found" } } };
    renderDesk("/desk/event-study");
    expect(await screen.findByText("This server does not run the event-study engine.")).toBeTruthy();
    expect(document.querySelector("[data-chart]")).toBeNull();
    // With no study on screen no badge says Live (V-08).
    for (const badge of screen.getAllByTestId("desk-badge").filter((b) => b.textContent?.includes("event-study engine"))) {
      expect(badge).toHaveAttribute("data-state", "pending");
      expect(badge).not.toHaveTextContent("Live");
    }
    expect(screen.getAllByText("not on this server").length).toBeGreaterThan(0);
  });

  it("client view: the verdict in words, the simple chart and a source line; no query, no facts line", async () => {
    renderDesk("/desk/event-study?study=spx-golden-cross&view=client");
    const verdict = await screen.findByText(/ran higher than usual after these events/);
    expect(verdict.closest("[data-register]")).toHaveAttribute("data-register", "client");
    expect(document.body).not.toHaveTextContent(/n = \d+|blocks|Monte Carlo/);
    expect(screen.queryByTestId("es-sentence")).toBeNull();
    expect(screen.getByTestId("es-source")).toHaveTextContent(/^Source: Macro Regime Radar event-study engine/);
    expect(document.querySelector("[data-interval]")).toBeNull();
  });

  it("S&P Internals states which cross reads the engine establishes, in its words, and keeps breadth and sectors Designed", async () => {
    renderDesk("/desk/sp-internals");
    const reads = await screen.findAllByTestId("internals-read");
    await waitFor(() => expect(reads[0]).toHaveTextContent(/Golden cross: established at 20 sessions/));
    const raw = engineStudies.cross as { verdict: { sentences: string[] } };
    expect(reads[0]).toHaveTextContent(raw.verdict.sentences[0]);
    for (const id of ["breadth", "sector-rotation"]) {
      const panel = document.getElementById(id)!;
      expect(within(panel).getByTestId("desk-badge")).toHaveAttribute("data-state", "designed");
      expect(panel.textContent).not.toMatch(/\d+(\.\d+)?%/);
    }
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

describe("Walkthrough (DESK_FRAME2_SPEC §6)", () => {
  it("the header control opens step 1 on its real route; Next and Back move; nothing autoplays", async () => {
    renderDesk("/desk/today");
    fireEvent.click(await screen.findByTestId("desk-walkthrough"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/event-study?study=gold-2sigma-spx-weak&tour=1"));
    const strip = await screen.findByTestId("desk-tour");
    expect(strip).toHaveTextContent("Step 1 of 6");
    expect(strip).toHaveTextContent("The setup you described, on live data since 2000.");
    expect(within(strip).getByRole("button", { name: "Back" })).toBeDisabled();
    fireEvent.click(within(strip).getByRole("button", { name: "Next" }));
    // The spec's short path resolves to the page with the step kept.
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/sp-internals?tour=2"));
    expect(screen.getByTestId("desk-tour")).toHaveTextContent("The 50/200 cross, scored the same way.");
    fireEvent.click(within(screen.getByTestId("desk-tour")).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("tour=1"));
  });

  it("arrows move steps, not when a control owns them; Escape closes and leaves the page where it is", async () => {
    renderDesk("/desk/pipeline?tour=4");
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/data-pipeline?tour=4"));
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/event-study?study=gold-2sigma-spx-weak&view=client&tour=5"));
    // An arrow in a segmented toggle stays with the toggle.
    const toggle = within(screen.getByRole("group", { name: "View" })).getByRole("button", { name: "Client" });
    fireEvent.keyDown(toggle, { key: "ArrowLeft" });
    expect(screen.getByTestId("loc")).toHaveTextContent("tour=5");
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/event-study?study=gold-2sigma-spx-weak&view=client"));
    expect(screen.getByTestId("loc")).not.toHaveTextContent("tour");
    expect(screen.queryByTestId("desk-tour")).toBeNull();
  });

  it("step 3 promotes the signal: the instrument from the engine, Save still disabled", async () => {
    renderDesk("/desk/monitor?from=gold-2sigma-spx-weak&tour=3");
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/position-monitor?from=gold-2sigma-spx-weak&tour=3"));
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    expect(await screen.findByTestId("desk-signal")).toHaveTextContent(/From the signal:/);
    expect(screen.getByTestId("desk-save-position")).toBeDisabled();
    expect(screen.getByText(/Save is blocked/)).toHaveTextContent(/set a numeric falsification level|tie the falsification level to a series/);
    expect(screen.getByLabelText("Variant view")).toHaveValue("");
    expect(screen.getByLabelText(/^Falsification level/)).toHaveValue("");
  });

  it("no other URL text reaches the form, and a slug the engine cannot read fills nothing", async () => {
    const a = renderDesk("/desk/position-monitor?from=not-a-study&instrument=TLT");
    expect(await screen.findByText(/not a study the engine can read; nothing was filled in/)).toBeTruthy();
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
    a.unmount();
    renderDesk("/desk/position-monitor?from=gold-2sigma-spx-weak&instrument=TLT&falsification_level=3.8");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    expect(screen.getByLabelText(/^Falsification level/)).toHaveValue("");
    expect(window.localStorage.getItem(POSITIONS_KEY)).toBeNull();
  });
});

/* ── Today never prints a date later than today (frame-2 follow-up) ─────── */

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Every date a text prints, as the first day it can mean: "Sep 30, 2026" and
 * "2026-09-30" the day; "Sep 17" the day in `year`; "Aug 2026" the month's
 * first day (a month is not later than today while today is in it). */
export function datesIn(text: string, year: number): { raw: string; day: string }[] {
  const out: { raw: string; day: string }[] = [];
  const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const re = new RegExp(String.raw`\b(${MON.join("|")}) (\d{1,2}), (\d{4})\b|\b(${MON.join("|")}) (\d{4})\b|\b(${MON.join("|")}) (\d{1,2})\b|\b(\d{4})-(\d{2})-(\d{2})\b`, "g");
  for (const m of text.matchAll(re)) {
    if (m[1]) out.push({ raw: m[0], day: iso(Number(m[3]), MON.indexOf(m[1]) + 1, Number(m[2])) });
    else if (m[4]) out.push({ raw: m[0], day: iso(Number(m[5]), MON.indexOf(m[4]) + 1, 1) });
    else if (m[6]) out.push({ raw: m[0], day: iso(year, MON.indexOf(m[6]) + 1, Number(m[7])) });
    else out.push({ raw: m[0], day: iso(Number(m[8]), Number(m[9]), Number(m[10])) });
  }
  return out;
}

describe("Today strip dates", () => {
  const TODAY = "2026-09-23";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${TODAY}T15:00:00Z`));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the date reader sees every form the strip prints", () => {
    expect(datesIn("inputs as of Sep 30, 2026 · as of Sep 17 · Aug 2026 · 2026-10-01", 2026).map((d) => d.day)).toEqual(["2026-09-30", "2026-09-17", "2026-08-01", "2026-10-01"]);
  });

  it("never prints a date later than today, even when the recession payload's input stamp is a future month-end", async () => {
    // The payload as served on 2026-09-23: data_as_of is the month-end label of
    // September's partial bucket; the headline is the series' last point (Aug 31).
    stub({
      "/api/recession/probability": () => ({
        probability_source: "recession_model",
        recession_prob: 11.644,
        recession_label: "Low Risk",
        recession_color: "g",
        yield_curve_spread: 0.52,
        yield_curve_pct_rank: 42,
        inversion_duration_months: 0,
        is_inverted: false,
        divergence_score: 2.4,
        divergence_label: "Aligned",
        divergence_color: "g",
        recession_prob_series: [
          { date: "2026-07-31", value: 14.463 },
          { date: "2026-08-31", value: 11.644 },
        ],
        yield_curve_series: [],
        usrec_series: [],
        n_training_samples: 281,
        model_features: ["yield_curve"],
        feature_coefficients: {},
        data_as_of: "2026-09-30",
        curve_shape: {},
        current_inputs: {},
        freshness: null,
      }),
    });
    window.localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify({ version: 1, positions: [{ id: "p1", instrument: "TLT", direction: "long", size: "", horizon: "3 months", variant_view: "v", pre_mortem: "p", falsification: { series: "DGS10", level: 3.8, direction: "above" }, created_at: `${TODAY}T14:00:00Z` }] }),
    );
    renderDesk("/desk/today");
    await waitFor(() => expect(screen.getByTestId("today-recession")).toHaveTextContent("11.6%"));
    await waitFor(() => expect(screen.getByTestId("today-fired")).toHaveTextContent(/fired/));
    await waitFor(() => expect(screen.getByTestId("today-regime")).toHaveTextContent("Goldilocks"));
    await waitFor(() => expect(screen.getAllByTestId("desk-position").length).toBe(1));
    // The card dates its number by the reading it is, as a month, never by the input stamp.
    expect(screen.getByTestId("today-recession-sub")).toHaveTextContent("Low Risk · the Aug 2026 reading");
    const strip = screen.getByTestId("today-strip");
    expect(strip).not.toHaveTextContent(/Sep 30/);
    const dates = datesIn(strip.textContent ?? "", 2026);
    expect(dates.length).toBeGreaterThan(3);
    const later = dates.filter((d) => d.day > TODAY);
    expect(later, `dates after ${TODAY}: ${later.map((d) => d.raw).join(", ")}`).toEqual([]);
  });

  it("prints no reading date rather than a wrong one when the series and the headline disagree", async () => {
    const { recessionReadingDate } = await import("./today/TodayPage");
    expect(recessionReadingDate({ recession_prob: 11.6, recession_prob_series: [{ date: "2026-08-31", value: 11.6 }] })).toBe("2026-08-31");
    expect(recessionReadingDate({ recession_prob: 11.6, recession_prob_series: [{ date: "2026-09-30", value: 9.1 }] })).toBeNull();
    expect(recessionReadingDate({ recession_prob: 11.6, recession_prob_series: [] })).toBeNull();
  });
});

describe("review round (R-01, R-02, R-06)", () => {
  it("R-01: an open cell closes when the study on screen changes under a mounted card", async () => {
    const { toStudyResult } = await import("../../api/desk");
    const { HorizonCard, RegimeCard } = await import("./event-study/results");
    type Study = Extract<ReturnType<typeof toStudyResult>, { state: "ready" }>["study"];
    const ready = (a: unknown): Study => {
      const r = toStudyResult(a as never);
      if (r.state !== "ready") throw new Error("not ready");
      return r.study;
    };
    const gold = ready(engineStudies.preset);
    const cross = ready(engineStudies.cross);
    const ui = (s: Study) => (
      <>
        <HorizonCard study={s} isClient={false} />
        <RegimeCard study={s} />
      </>
    );
    const r = renderWithProviders(ui(gold), { route: "/desk/event-study" });
    fireEvent.click(screen.getByRole("button", { name: /^20d n \d+/ }));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(gold.regime_split[1].regime) }));
    expect(screen.getAllByRole("region", { name: /Events behind/ })).toHaveLength(2);
    // The same card instances, a different study: nothing stays open.
    r.rerender(ui(cross));
    expect(screen.queryByRole("region", { name: /Events behind/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^20d n \d+/ })).toHaveAttribute("aria-expanded", "false");
    // Back to the first study: the old selection does not return with stale counts.
    r.rerender(ui(gold));
    expect(screen.queryByRole("region", { name: /Events behind/ })).toBeNull();
  });

  it("R-02: while any preset is computing the card says the read is incomplete, never 'None fired'", async () => {
    engine = { "spx-death-cross": { status: 202, body: { ...engineStudies.computing, slug: "spx-death-cross" } } };
    renderDesk("/desk/today");
    const list = await screen.findByLabelText("Presets and their newest event");
    await waitFor(() => expect(list).toHaveTextContent("computing"));
    await waitFor(() => expect(screen.getByTestId("today-strip")).toHaveTextContent(/2 of 3 presets answered/));
    expect(screen.getByTestId("today-fired")).toHaveTextContent("Incomplete");
    expect(screen.getByTestId("today-fired")).not.toHaveTextContent("None fired");
    expect(screen.getByTestId("today-fired")).toHaveAttribute("data-complete", "false");
  });

  it("R-02: each preset is judged against its own as_of", async () => {
    const preset = structuredClone(engineStudies.preset) as { provenance: { as_of: string }; recent_events: { date: string }[] };
    preset.provenance.as_of = "2025-04-18";
    preset.recent_events[0].date = "2025-04-16";
    engine = { "gold-2sigma-spx-weak": { status: 200, body: preset } };
    renderDesk("/desk/today");
    await waitFor(() => expect(screen.getByTestId("today-fired")).toHaveTextContent("1 fired"));
    expect(screen.getByTestId("today-fired")).toHaveAttribute("data-complete", "true");
    expect(screen.getByLabelText("Presets and their newest event")).toHaveTextContent("fired Apr 16, 2025");
    expect(screen.getByTestId("today-strip")).toHaveTextContent("Five weekdays to each preset's own last session read");
  });
});

describe("Today strip dates at the evening boundary (R-06)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a position saved at 21:30 in New York reads that day, and nothing is dated after it", async () => {
    // 2026-09-23T01:30Z is Sep 22, 21:30 ET: the UTC day is already Sep 23.
    const NOW = "2026-09-23T01:30:00Z";
    const TODAY_NY = "2026-09-22";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    window.localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify({ version: 1, positions: [{ id: "p1", instrument: "TLT", direction: "long", size: "", horizon: "3 months", variant_view: "Duration is likely to cheapen.", pre_mortem: "The curve steepened.", falsification: { series: "DGS10", level: 3.8, direction: "above" }, created_at: NOW }] }),
    );
    renderDesk("/desk/position-monitor");
    const row = await screen.findByTestId("desk-position");
    expect(row).toHaveTextContent("saved Sep 22, 2026");
    expect(row).not.toHaveTextContent("Sep 23");
    const later = datesIn(document.querySelector("main")?.textContent ?? "", 2026).filter((d) => d.day > TODAY_NY);
    expect(later.map((d) => d.raw)).toEqual([]);
  });
});

describe("R-07 repro: a cached FRED value keeps its own date through a failed refetch", () => {
  it("a new generation's date is never attached to the old value when the value endpoint answers 503", async () => {
    let gen = 1;
    let asOf = "2026-09-17";
    let valueDown = false;
    stub({
      "/api/freshness": () => ({ ...fresh(), generation: { id: gen, built_at: null, source: "macro_radar.db" }, series: fresh().series.map((x) => (x.id === "DGS10" ? { ...x, as_of: asOf } : x)) }),
      "/series/DGS10/latest": () => (valueDown ? { status: 503, body: { detail: "The server is warming up", kind: "warming", retryable: true } } : { series_id: "DGS10", date: "2026-09-01", value: 4.12 }),
    });
    window.localStorage.setItem(
      POSITIONS_KEY,
      JSON.stringify({ version: 1, positions: [{ id: "p1", instrument: "TLT", direction: "long", size: "", horizon: "3 months", variant_view: "Duration is likely to cheapen.", pre_mortem: "The curve steepened.", falsification: { series: "DGS10", level: 3.8, direction: "below" }, created_at: "2026-09-20T14:00:00Z" }] }),
    );
    const { client } = renderDesk("/desk/position-monitor");
    const row = await screen.findByTestId("desk-position");
    await waitFor(() => expect(row).toHaveTextContent("4.12% now (Sep 17, 2026)"));
    // Generation 2 lands with a newer observation date; the value endpoint answers 503.
    gen = 2;
    asOf = "2026-09-18";
    valueDown = true;
    await client.refetchQueries();
    // The report moved on; the cached value kept its own date.
    const report = client.getQueriesData<{ generation?: { id: number } }>({ predicate: (q) => JSON.stringify(q.queryKey).includes("freshness") });
    expect(report.some(([, d]) => d?.generation?.id === 2)).toBe(true);
    expect(screen.getByTestId("desk-position")).toHaveTextContent("4.12% now (Sep 17, 2026)");
    expect(screen.getByTestId("desk-position")).not.toHaveTextContent("Sep 18");
  });
});

describe("R-12: Presets fired dates itself by the earliest cutoff", () => {
  it("the badge shows the earliest as_of, its tooltip each study's own, and the body says cutoffs differ", async () => {
    const death = structuredClone(engineStudies.cross) as { study: { slug: string }; provenance: { as_of: string } };
    death.study.slug = "spx-death-cross";
    death.provenance.as_of = "2026-09-11";
    engine = { "spx-death-cross": { status: 200, body: death } };
    renderDesk("/desk/today");
    await waitFor(() => expect(screen.getByTestId("today-fired")).toHaveAttribute("data-complete", "true"));
    const card = document.getElementById("fired")!;
    const badge = within(card).getByTestId("desk-badge");
    expect(badge).toHaveTextContent("as of Sep 11, 2026");
    expect(badge.getAttribute("title")).toMatch(/S&P death cross as of 2026-09-11/);
    expect(badge.getAttribute("title")).toMatch(/S&P golden cross as of \d{4}-\d{2}-\d{2}/);
    expect(within(card).getByTestId("today-cutoffs")).toHaveTextContent(/^Cutoffs differ: .*S&P death cross Sep 11, 2026/);
  });

  it("with one cutoff the body says nothing about cutoffs", async () => {
    renderDesk("/desk/today");
    await waitFor(() => expect(screen.getByTestId("today-fired")).toHaveAttribute("data-complete", "true"));
    expect(screen.queryByTestId("today-cutoffs")).toBeNull();
  });
});

