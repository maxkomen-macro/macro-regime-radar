/**
 * Phase 7 checklist (docs/redesign-v2/checklists/07-recession.md) section E.1,
 * `screens/recession/RecessionScreen.test.tsx`: the rebuilt Recession screen
 * (composition B.0, hero B.1 with the gauge and the 24M / Full history chart
 * B.1.1 to B.1.2, summary and strip B.2, the four panels B.3 to B.6 rendered
 * for real, the disclosure line B.7, the states B.8, copy C.2, ids D).
 * renderWithProviders + stubFetch with a fixture per route the page reads
 * (`/api/recession/probability`, `/api/recession/scenario`, `/api/regime/latest`;
 * unmatched paths 404 so error branches are real). Nothing is mocked: LineChart
 * and the gauge are inline SVG, so jsdom renders them; the scenario stub
 * answers by the posted `unemployment` (at or under 4.5 → 10.4% Low Risk,
 * above → 49.0% High Risk); timers are real and the 120 ms debounce is awaited
 * with `findBy…` / `waitFor`. The clock is frozen (only `Date`) to Saturday
 * Sep 19 2026 so the freshness dot and the headline's date fallback never
 * depend on when the suite runs. Fixtures are invented monthly points dated
 * Mar 2023 to Sep 2026 and a yearly 2s10s series since 1996; the assertions
 * are the copy rules, never the mockup's or the baseline's figures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import RecessionScreen from "./RecessionScreen";
import type { DatedValue, RecessionMetrics, RecessionScenarioRequest, RecessionScenarioResult, Regime } from "../../api/types";
import { makeClient, renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Saturday Sep 19 2026: the Sep 01 monthly stamp is 18 days old, inside the 45-day "current" limit. */
const NOW = new Date("2026-09-19T15:00:00Z");
const NOW_MS = NOW.getTime();
const ROUTE = "/app/recession";
/** The app's numeric placeholder glyph (a dash, not prose copy). */
const DASH = "—";

/** Month-end ISO dates from `from` (YYYY-MM) to `to` inclusive, oldest first. */
function monthEnds(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let idx = fy * 12 + (fm - 1); idx <= ty * 12 + (tm - 1); idx++) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push(`${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`);
  }
  return out;
}
function set(series: DatedValue[], date: string, value: number): void {
  const p = series.find((q) => q.date === date);
  if (!p) throw new Error(`fixture has no point on ${date}`);
  p.value = value;
}

/** Mar 2023 to Sep 2026 month-ends (43 points): filler at 12.0 to 13.2 (nothing
 * equals the served 11.6, the 24M window stays under 20), a 45.0 spike in Jun
 * 2023 so Full history crosses both rules, and the E.1 tail. */
const PROB_DATES = monthEnds("2023-03", "2026-09");
const TAIL: [string, number][] = [
  ["2026-05-31", 10.2],
  ["2026-06-30", 10.7],
  ["2026-07-31", 11.1],
  ["2026-08-31", 11.6],
  ["2026-09-30", 10.0],
];
function probSeries(tail: [string, number][] = TAIL): DatedValue[] {
  const s = PROB_DATES.map((date, i) => ({ date, value: 12 + (i % 4) * 0.4 }));
  set(s, "2023-06-30", 45);
  for (const [date, value] of tail) set(s, date, value);
  return s;
}
const usrec = (): DatedValue[] => PROB_DATES.map((date) => ({ date, value: date >= "2023-06-30" && date <= "2023-08-31" ? 1 : 0 }));
const YC_DATES = [...Array.from({ length: 31 }, (_, i) => `${1996 + i}-03-01`), "2026-09-01"];
const YC_INVERTED = new Set(["2000-03-01", "2006-03-01", "2007-03-01", "2019-03-01", "2022-03-01", "2023-03-01"]);
const ycSeries = (): DatedValue[] =>
  YC_DATES.map((date, i) => ({ date, value: date === "2026-09-01" ? 0.33 : YC_INVERTED.has(date) ? -(0.2 + (i % 3) * 0.15) : 0.4 + (i % 5) * 0.3 }));

function recessionFixture(over: Partial<RecessionMetrics> = {}): RecessionMetrics {
  return {
    probability_source: "recession_model",
    recession_prob: 11.6,
    recession_label: "Low Risk",
    recession_color: "#2ecc71",
    yield_curve_spread: 33,
    yield_curve_pct_rank: 33,
    inversion_duration_months: 0,
    is_inverted: false,
    divergence_score: -34,
    divergence_label: "Macro ahead of markets",
    divergence_color: "#3498db",
    recession_prob_series: probSeries(),
    yield_curve_series: ycSeries(),
    usrec_series: usrec(),
    n_training_samples: 281,
    model_features: ["yield_curve", "unemployment", "hy_spread", "indpro_yoy", "lei_proxy"],
    feature_coefficients: { yield_curve: 0.65, unemployment: -2.54, hy_spread: 2.58, indpro_yoy: 0.05, lei_proxy: -0.49 },
    data_as_of: "2026-09-01",
    curve_shape: { "1M": null, "3M": null, "6M": null, "1Y": null, "2Y": 4.63, "5Y": null, "10Y": 4.96, "30Y": null },
    current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: -0.03 },
    ...over,
  };
}
const BASE = recessionFixture();
/** The last four values equal: streak 0, the headline anchored on the Sep point. */
const FLAT: Partial<RecessionMetrics> = { recession_prob_series: probSeries([["2026-06-30", 11.6], ["2026-07-31", 11.6], ["2026-08-31", 11.6], ["2026-09-30", 11.6]]) };
const INVERTED: Partial<RecessionMetrics> = { is_inverted: true, yield_curve_spread: -35, inversion_duration_months: 4 };
const DISAGREEING_LABEL: Partial<RecessionMetrics> = { recession_label: "Elevated" };
const NULL_INPUT: Partial<RecessionMetrics> = { current_inputs: { unrate: 4.1, hy_oas: 270, indpro_yoy: 1.0, lei: null } };

const REGIME: Regime = { date: "2026-07-01", label: "Goldilocks", confidence: 0.5, growth_trend: 0.24, inflation_trend: -0.58, prob_goldilocks: 0.64, prob_overheating: 0.004, prob_stagflation: 0.005, prob_recession: 0.35 };
const LOW: RecessionScenarioResult = { probability: 10.4, label: "Low Risk", color: "#2ecc71", baseline_prob: 11.6, delta_pp: -1.2 };
const HIGH: RecessionScenarioResult = { probability: 49.0, label: "High Risk", color: "#e74c3c", baseline_prob: 11.6, delta_pp: 37.4 };
/** The seeded request: liveDefaults rounded to each slider's step (33 → 35 bps; -0.03 → 0.0pp). */
const SEEDED: RecessionScenarioRequest = { yield_curve_bps: 35, unemployment: 4.1, hy_oas_bps: 270, indpro_yoy: 1, lei: 0 };

/* ── copy (C.2) ──────────────────────────────────────────────────────────── */

const LOADING_HEADLINE = "Training the recession model on stored NBER history…";
// CP4: the one sentence naming the model (screen-ui missingNote); the panels print it too.
const ERROR_HEADLINE = "Recession model unavailable: the data service did not answer.";
const LOADING_ROW = "Training the recession model; the first call takes about a second.";
const STATE_LOADING = "Reading stored data…";
const STATE_ERROR = "Unavailable: the data service did not answer.";
const SUBHEAD = "Twelve-month odds, up 1.4 points in three months.";
// Iteration 1 step 5 (G4): the visible lede is three sentences; the material
// divergence's second sentence sits behind the hero's Details (LEDE_MORE).
const LEDE =
  "The logistic model scores twelve-month odds against a ~15% historical base rate; Elevated starts at 20%, High Risk at 40%. Macro ahead of markets: credit pricing and the model disagree. This is the recession model's own probability, not the classifier's Recession Risk odds (the Regime context row).";
const LEDE_MORE = "The divergence is material and requires judgment.";
const NOTE = "Sits in the Low Risk band (under 20%); the historical base rate runs ~15% and 2008 peaked near 89%.";
const PILL_TITLE = "The recession model's own band: Low Risk under 20%, Elevated 20 to 40%, High Risk 40% and above";
// Iteration 1 step 5 (G4): three visible sentences (data-copy-max 3: the tail
// and the headline are different numbers); the lag sentence sits behind Details.
const CHART_CAPTION_24M =
  "The model's 12-month odds, monthly since Oct 2024. Shaded bands are actual NBER recessions, dashed rules the 20/40 band edges. The plotted tail (10%) is a partial-month fit; the headline 11.6% is the newest complete monthly read.";
const CHART_CAPTION_MORE = "Features enter with a 3-month lag so the line never peeks at data it wouldn't have had.";
// Iteration 1 X2 adds two served rows (Training sample, Inputs through) before the reference thresholds.
const SUMMARY_LABELS = ["12-month probability", "3 months ago", "Strongest input", "Curve 2s10s", "Model vs market", "Regime context", "Training sample", "Inputs through", "Reference thresholds"];
const THRESHOLDS = "2s10s < 0 · HY > 400 bps · unemployment +0.3 pp in 3m";
const THRESHOLDS_TITLE = "Reference levels used in the desk read. Not model thresholds and not alert rules; none are served by the API.";
const REGIME_ROW_TITLE = "The four-way classifier's leading regime and its odds; a different model from the recession probability above";
/** Iteration 1 E2: the fifth input is named for what recession.py computes. */
const BREAKEVEN = "10Y − 5Y breakeven spread";
const CARD_NAMES = ["Yield curve (2s10s)", "Unemployment rate", "HY credit spread", "Industrial production YoY", BREAKEVEN];
const CARD_VALUES = ["+33 bps", "4.1%", "270 bps", "1.0%", "-0.03pp"];
const CARD_COEF_LINES = [
  "+0.65 log-odds per σ · raises odds as it rises",
  "-2.54 log-odds per σ · lowers odds as it rises",
  "+2.58 log-odds per σ · raises odds as it rises",
  "+0.05 log-odds per σ · raises odds as it rises",
  "-0.49 log-odds per σ · lowers odds as it rises",
];
const INPUTS_THROUGH = "Inputs through Sep 2026";
const CURVE_CARD_CAPTION = "The 10Y–2Y spread holds at +33 bps (0.33%), the 33rd percentile of 30 years. An inverted curve has preceded most US recessions.";
const CURVE_CAPTION = "Below the dashed zero line the curve is inverted: short money costs more than long money, which only happens when markets expect cuts ahead. Every shaded recession was preceded by a dip below zero.";
const NOT_STORED = "Not stored: 1M · 3M · 6M · 1Y · 5Y · 30Y. The model reads the daily FRED 2Y and 10Y series only; other tenors are outside its inputs by design.";
const SHAPE_CAPTION = "Two stored tenors: 2Y at 4.63% and 10Y at 4.96%, a +33 bps upward slope.";
/** The pre-X3 disclosure title, kept as the panel's lead line. */
const SENS_LEAD = "Move the model's five inputs and watch 11.6% respond.";
/** X3: the unchanged scenario is named as a scenario, beside the model's own reading. */
const SCENARIO_EYEBROW = "Scenario at current readings · inputs unchanged";
const INCOMPLETE = "The model's current inputs are incomplete in this snapshot; nothing honest to seed the sliders with.";
const SCENARIO_CAPTION =
  "The headline scores 3-month-lagged inputs (the model never peeks); these sliders score the readings as if they were today's features, so the starting position sits near, not on, the headline. Same fitted coefficients, same scaler.";
const SLIDER_LABELS = ["Yield curve 2s10s", "Unemployment rate", "HY credit spread", "Industrial production YoY", BREAKEVEN];
const SEEDED_VALUETEXT = ["+35 bps", "4.1%", "270 bps", "1.0%", "0.0pp"];
const COEF_ORDER = ["HY credit spread", "Unemployment rate", "Yield curve (2s10s)", BREAKEVEN, "Industrial production YoY"];
const COEF_SIGNED = ["+2.58", "-2.54", "+0.65", "-0.49", "+0.05"];
const COEF_CURRENT = ["270 bps", "4.1%", "+33 bps", "-0.03pp", "1.0%"];
const COEF_NEGATIVE = new Set(["Unemployment rate", BREAKEVEN]);
const COEF_CAPTION_TAIL = "Red bars raise recession odds as they rise; mint bars lower them.";
// G4: two sentences visible; the third sits behind Details on the same tile.
const DIVERGENCE_CAPTION =
  /^Macro ahead of markets: credit-market pricing \(HY percentile\) minus the regime model's recession odds, on a [−-]100 to \+100 scale\. Beyond ±20 the divergence is material and requires judgment\.$/;
const DIVERGENCE_DETAILS = "The number stays neutral; the word carries the verdict.";
const MODEL_CARD_ROWS = ["Estimator", "Training target", "Training samples", "Features", "Look-ahead guard", "Inputs through"];
const MODEL_CARD_VALUES = [
  "Logistic regression, class-balanced",
  "NBER USREC months",
  "281 months",
  "Yield curve (2s10s) · Unemployment rate · HY credit spread · Industrial production YoY · 10Y − 5Y breakeven spread",
  "All features lagged 3 months",
  "Sep 2026",
];
const DISCLOSURE_LINE =
  "A statistical estimate, not a forecast of any specific date · model trained in-process from stored FRED series each session (no saved artifact) · inputs are lagged three months before scoring and sensitivity rescoring uses the same fitted coefficients · the probability is the recession model's own, a different number from the regime classifier's Recession Risk odds in the header.";
const IDS_IN_ORDER = ["recession-hero", "recession-summary", "model", "curve", "sensitivity", "transparency"];
const BANNED_CARD_WORDS = ["Push on odds", "Threshold proximity", "Last alert", "Trips"];

/* ── routes ──────────────────────────────────────────────────────────────── */

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
/** Every scenario body the screen posts, in order. */
const posted: RecessionScenarioRequest[] = [];
function scenario(_url: URL, init?: RequestInit): RecessionScenarioResult {
  const body = JSON.parse(String(init?.body)) as RecessionScenarioRequest;
  posted.push(body);
  return body.unemployment <= 4.5 ? LOW : HIGH;
}
function routes(over: Routes = {}, m: () => RecessionMetrics = recessionFixture): Routes {
  return { "/api/recession/probability": () => m(), "/api/recession/scenario": scenario, "/api/regime/latest": () => REGIME, ...over };
}
function without(...paths: string[]): Routes {
  const r = routes();
  for (const p of paths) delete r[p];
  return r;
}
const withMetrics = (over: Partial<RecessionMetrics>) => routes({}, () => recessionFixture(over));
const PENDING = () => new Promise<never>(() => {});

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderRecession({ route = ROUTE, client }: { route?: string; client?: QueryClient } = {}) {
  return renderWithProviders(
    <main id="main-content">
      <RecessionScreen />
    </main>,
    { route, client },
  );
}

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
const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const main = () => document.querySelector("main") as HTMLElement;
const hero = () => byId("recession-hero") as HTMLElement;
const summary = () => byId("recession-summary") as HTMLElement;
const model = () => byId("model") as HTMLElement;
const curve = () => byId("curve") as HTMLElement;
const sensitivity = () => byId("sensitivity") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
/** The row value's title: on the dd itself or on an element inside it. */
const titleOf = (dd: HTMLElement) => dd.getAttribute("title") ?? dd.querySelector("[title]")?.getAttribute("title") ?? "";
const awaitHero = (name = "11.6%") => screen.findByRole("heading", { level: 1, name });
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
const strip = () => summary().querySelector<HTMLElement>("a.mrr-status");
async function awaitStrip(): Promise<HTMLElement> {
  await waitFor(() => expect(strip()).not.toBeNull());
  return strip() as HTMLElement;
}
const stripTitle = (a: HTMLElement) => text(a.querySelector(".mrr-status-title") ?? a.querySelector("b"));
const stripDetail = (a: HTMLElement) => text(a.querySelector("small"));
const cards = () => [...model().querySelectorAll<HTMLElement>("article")];
const cardNamed = (name: string) => {
  const c = cards().find((a) => text(a.querySelector("h3")) === name);
  if (!c) throw new Error(`no #model article named ${name}; names: ${cards().map((a) => text(a.querySelector("h3"))).join(" | ")}`);
  return c;
};
const badgeOf = (card: HTMLElement) => card.querySelector<HTMLElement>("span[data-tone]") as HTMLElement;
/** Top-level `Card variant="tile"` surfaces inside a section. */
const tiles = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("[style*='var(--r-tile)']")].filter((el) => !el.parentElement?.closest("[style*='var(--r-tile)']"));
const tileWith = (root: HTMLElement, label: string) => {
  const t = tiles(root).find((el) => text(el).includes(label));
  if (!t) throw new Error(`no tile in #${root.id} containing ${label}`);
  return t;
};
const heroViz = () => hero().querySelector(".mrr-hero-viz") as HTMLElement;
const historyGroup = () => within(hero()).getByRole("group", { name: "History window" });
const curveGroup = () => within(curve()).getByRole("group", { name: "Curve window" });
const gaugeSvg = () => hero().querySelector("svg[aria-label^='Recession probability gauge']") as SVGSVGElement | null;
/** The LineChart legend's "{first} → {last}" range line inside a root. */
function legendRange(root: HTMLElement): string {
  const span = [...root.querySelectorAll<HTMLElement>("span")].find((s) => /^[A-Z][a-z]{2} \d\d, \d{4} → [A-Z][a-z]{2} \d\d, \d{4}$/.test(text(s)));
  return span ? text(span) : "";
}
/** X3: #sensitivity carries no disclosure button; the sliders render on load. */
const sensButton = () => sensitivity().querySelector("button[aria-expanded]") as HTMLButtonElement | null;
const ranges = () => [...document.querySelectorAll<HTMLInputElement>("input[type='range']")];
const sliderRows = () => [...document.querySelectorAll<HTMLElement>(".mrr-slider-row")];
function sliderRow(label: string): HTMLElement {
  const row = sliderRows().find((r) => text(r.querySelector("label")) === label);
  if (!row) throw new Error(`no slider row labelled ${label}; rows: ${sliderRows().map((r) => text(r.querySelector("label"))).join(" | ")}`);
  return row;
}
const rangeOf = (label: string) => sliderRow(label).querySelector("input[type='range']") as HTMLInputElement;
const resetButton = () => within(sensitivity()).getByRole("button", { name: /Reset to current readings/ });
/** The scenario result in the display face. */
const displaySpan = () => [...sensitivity().querySelectorAll<HTMLElement>("span")].find((el) => css(el).includes("var(--font-display)") && /^\d+\.\d%$/.test(text(el))) ?? null;
const scenarioBadge = () => sensitivity().querySelector<HTMLElement>("[data-figure='scenario'] span[data-tone]");
const modelFigure = () => sensitivity().querySelector<HTMLElement>("[data-figure='model']");
/** The DivergingBar fills (the tick has no radius) and the grid row each belongs to. */
const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>("i")].filter((i) => i.style.borderRadius !== "");
function rowOfBar(bar: HTMLElement): HTMLElement {
  let n = bar.parentElement;
  while (n && !(COEF_ORDER.some((l) => text(n).includes(l)) && /[+-]\d\.\d\d/.test(text(n)))) n = n.parentElement;
  if (!n) throw new Error("no coefficient row around the bar");
  return n;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", ROUTE);
  posted.length = 0;
  stubFetch(routes());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("RecessionScreen (checklist 07 E.1)", () => {
  it("renders one h1 equal to the served probability inside the hero with the served label as the pill, the eyebrow, the live dot, the footnote items, the chip and the note", async () => {
    renderRecession();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(main().contains(h1)).toBe(true);
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveClass("mrr-hero");
    expect(hero().contains(h1)).toBe(true);
    expect(text(h1)).toBe("11.6%");
    expect(text(h1)).toMatch(/^\d+\.\d%$/);
    expect(within(hero()).getByText("Recession model")).toBeInTheDocument();
    expect(hero().querySelector(".mrr-hero-dot")).not.toBeNull(); // Sep 01 stamp is current on Sep 19
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Low Risk");
    expect(pill).toHaveAttribute("data-tone", "mint");
    expect(h1.parentElement?.contains(pill)).toBe(true); // beside the headline
    expect(pill.getAttribute("title") ?? pill.querySelector("[title]")?.getAttribute("title")).toBe(PILL_TITLE);
    expect(css(hero().querySelector(".mrr-hero-glow"))).toMatch(/rgba\(38, ?220, ?160, ?0?\.07\)/);
    expect(text(hero())).toContain("Logistic model on 5 FRED inputs, lagged 3 months");
    expect(text(hero())).toContain("Scored for Aug 2026");
    expect(hero().querySelector("[title='Model inputs: Current · Sep 2026']")).not.toBeNull();
    expect(text(hero().querySelector(".mrr-hero-note"))).toBe(NOTE);
    expect(screen.queryByText(LOADING_HEADLINE)).toBeNull();
    expect(text(hero())).not.toContain(ERROR_HEADLINE);
    expect(document.querySelector("img")).toBeNull();
    expect(text(hero())).not.toContain("—");
  });

  it("a served label that disagrees with the number prints as served in the pill, the summary row and the note (no client re-derivation)", async () => {
    stubFetch(withMetrics(DISAGREEING_LABEL));
    renderRecession();
    await awaitHero();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(text(pill)).toBe("Elevated");
    expect(pill).toHaveAttribute("data-tone", "amber");
    expect(css(hero().querySelector(".mrr-hero-glow"))).toMatch(/rgba\(245, ?181, ?46, ?0?\.06\)/);
    expect(text(hero().querySelector(".mrr-hero-note"))).toContain("Sits in the Elevated band (20 to 40%)");
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("12-month probability"))).toBe("11.6% · Elevated");
    expect(ddFor("12-month probability").style.color).toBe("var(--amber)");
    expect(gaugeSvg()).toHaveAttribute("aria-label", "Recession probability gauge at 11.6% · Elevated");
    expect(text(hero())).not.toContain("Low Risk");
  });

  it("the h2 starts with Twelve-month odds and equals the three-month delta; the lede is X4 with the three edits and the recession model jargon; the hero never names the classifier", async () => {
    renderRecession();
    await awaitHero();
    const h2 = within(hero()).getByRole("heading", { level: 2 });
    expect(text(h2)).toBe(SUBHEAD);
    expect(text(h2).startsWith("Twelve-month odds")).toBe(true);
    const lede = hero().querySelector(".mrr-hero-lede") as HTMLElement;
    expect(text(lede)).toBe(LEDE);
    expect(text(lede)).toContain("recession model's own probability");
    expect(lede).toHaveAttribute("data-copy", "lede");
    expect(text(hero())).not.toContain(LEDE_MORE);
    fireEvent.click(within(hero().querySelector(".mrr-hero-copy") as HTMLElement).getByRole("button", { name: /Details/ }));
    expect(text(hero())).toContain(LEDE_MORE);
    expect(within(lede).getByRole("button", { name: "logistic model" })).toHaveClass("jargon");
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(hero())).not.toContain("Goldilocks");
    expect(text(hero())).not.toContain("64%");
    // The classifier lives in the summary's Regime context row only.
    expect(text(summary())).toContain("Goldilocks 64% · classifier");
    expect((text(main()).match(/classifier/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it("Stress the inputs is the primary link to #sensitivity and Read the model card the ghost link to #transparency, both same-route hash links", async () => {
    renderRecession();
    await awaitHero();
    const stress = within(hero()).getByRole("link", { name: /Stress the inputs/ });
    const read = within(hero()).getByRole("link", { name: /Read the model card/ });
    expect(stress).toHaveAttribute("href", "/app/recession#sensitivity");
    expect(read).toHaveAttribute("href", "/app/recession#transparency");
    expect(stress).toHaveClass("mrr-hero-btn-primary");
    expect(read).toHaveClass("mrr-hero-btn-ghost");
    expect(stress.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the hero chart slot holds the gauge and the 24M history line with its History window control, the 24M legend range, the caption and no band-edge labels", async () => {
    renderRecession();
    await awaitHero();
    const viz = heroViz();
    expect(viz).not.toBeNull();
    expect(viz.querySelectorAll("svg[role='img']")).toHaveLength(2);
    const gauge = gaugeSvg();
    expect(gauge).not.toBeNull();
    expect(viz.contains(gauge)).toBe(true);
    expect(gauge).toHaveAttribute("aria-label", "Recession probability gauge at 11.6% · Low Risk");
    const words = [...(gauge as SVGSVGElement).querySelectorAll("text")].map((t) => text(t));
    for (const w of ["LOW", "ELEVATED", "HIGH RISK", "0", "20", "40", "100"]) expect(words, w).toContain(w);
    const group = historyGroup();
    expect(viz.contains(group)).toBe(true);
    expect(within(group).getAllByRole("button").map((b) => text(b))).toEqual(["24M", "Full history"]);
    expect(within(group).getByRole("button", { name: "24M" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Full history" })).toHaveAttribute("aria-pressed", "false");
    expect(legendRange(viz)).toBe("Oct 31, 2024 → Sep 30, 2026");
    expect(text(viz)).toContain(CHART_CAPTION_24M);
    expect(text(viz)).toContain("the headline 11.6%");
    expect(text(viz)).not.toContain(CHART_CAPTION_MORE);
    fireEvent.click(within(viz).getByRole("button", { name: /Details/ }));
    expect(text(viz)).toContain(CHART_CAPTION_MORE);
    expect(within(viz).getByRole("button", { name: "NBER" })).toHaveClass("jargon");
    expect(text(viz)).not.toContain("20% Elevated");
    expect(text(viz)).not.toContain("40% High Risk");
    expect(text(viz)).not.toContain("40% High");
  });

  it("Full history flips aria-pressed, plots since the series' first month with the 20% Elevated and 40% High Risk labels on screen; 24M restores the short window", async () => {
    renderRecession();
    await awaitHero();
    fireEvent.click(within(historyGroup()).getByRole("button", { name: "Full history" }));
    expect(within(historyGroup()).getByRole("button", { name: "Full history" })).toHaveAttribute("aria-pressed", "true");
    expect(within(historyGroup()).getByRole("button", { name: "24M" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(legendRange(heroViz())).toBe("Mar 31, 2023 → Sep 30, 2026"));
    expect(text(heroViz())).toContain("20% Elevated");
    expect(text(heroViz())).toContain("40% High Risk");
    expect(text(heroViz())).toContain("monthly since Mar 2023");
    expect(text(heroViz())).toContain("the headline 11.6%");
    fireEvent.click(within(historyGroup()).getByRole("button", { name: "24M" }));
    expect(within(historyGroup()).getByRole("button", { name: "24M" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(legendRange(heroViz())).toBe("Oct 31, 2024 → Sep 30, 2026"));
    expect(text(heroViz())).not.toContain("20% Elevated");
    expect(text(heroViz())).not.toContain("40% High Risk");
    expect(text(heroViz())).toContain("monthly since Oct 2024");
  });

  it("the summary dl has the seven dt labels in C.2 order with the served values, the amber rise span, the classifier link and the reference-thresholds row", async () => {
    renderRecession();
    await awaitHero();
    expect(within(summary()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Model summary$/);
    expect(summary()).toHaveClass("mrr-summary");
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("12-month probability"))).toBe("11.6% · Low Risk");
    expect(ddFor("12-month probability").style.color).toBe("var(--mint)");
    expect(text(ddFor("3 months ago"))).toBe("10.2% +1.4 pts · May 2026");
    const rise = [...ddFor("3 months ago").querySelectorAll<HTMLElement>("span")].find((el) => text(el).startsWith("+1.4 pts"));
    expect(rise, "the signed delta span").toBeDefined();
    expect(rise?.style.color).toBe("var(--amber)");
    expect(text(ddFor("Strongest input"))).toBe("HY credit spread · +2.58 log-odds per σ");
    expect(text(ddFor("Curve 2s10s"))).toBe("+33 bps · upward · 33rd pct of 30y");
    expect(ddFor("Curve 2s10s").style.color).not.toBe("var(--neg)");
    expect(text(ddFor("Model vs market"))).toBe("Macro ahead of markets · -34 on ±100");
    expect(ddFor("Model vs market").style.color).toBe("var(--amber)");
    await waitFor(() => expect(text(ddFor("Regime context"))).toBe("Goldilocks 64% · classifier"));
    const link = within(ddFor("Regime context")).getByRole("link", { name: "Goldilocks" });
    expect(link).toHaveAttribute("href", "/app/regime-lab");
    expect(text(ddFor("Regime context")).endsWith("classifier")).toBe(true);
    expect(titleOf(ddFor("Regime context"))).toBe(REGIME_ROW_TITLE);
    expect(text(ddFor("Training sample"))).toBe("281 months · NBER-dated");
    expect(text(ddFor("Inputs through"))).toBe("Sep 2026");
    expect(text(ddFor("Reference thresholds"))).toBe(`${THRESHOLDS} · desk reference`);
    expect(titleOf(ddFor("Reference thresholds"))).toBe(THRESHOLDS_TITLE);
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
    expect(text(summary())).not.toContain(LOADING_ROW);
    expect(text(summary())).not.toContain("Invalidates");
  });

  it("an inverted curve reads -35 bps · inverted with the months appended in the --neg tone, the Inverted badge and the inverted captions", async () => {
    stubFetch(withMetrics(INVERTED));
    renderRecession();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("Curve 2s10s"))).toBe("-35 bps · inverted · 33rd pct of 30y · 4 months");
    expect(ddFor("Curve 2s10s").style.color).toBe("var(--neg)");
    await awaitSection("model");
    const card = cardNamed("Yield curve (2s10s)");
    expect(text(badgeOf(card))).toBe("Inverted");
    expect(badgeOf(card)).toHaveAttribute("data-tone", "watch");
    expect(text(card)).toContain("-35 bps");
    // G2: the X10 caption sits under the five cards, not inside the curve card.
    expect(text(model())).toContain("holds at -35 bps (-0.35%); inverted for 4 months. An inverted curve has preceded most US recessions.");
    const shape = await awaitSection("curve");
    expect(text(shape)).toContain("a -35 bps inverted slope.");
    await waitFor(() => expect(rangeOf("Yield curve 2s10s")).toHaveAttribute("aria-valuetext", "-35 bps"));
  });

  it("a null yield_curve_spread omits the Curve 2s10s row (today's guard)", async () => {
    stubFetch(withMetrics({ yield_curve_spread: null, yield_curve_pct_rank: null }));
    renderRecession();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS.filter((l) => l !== "Curve 2s10s")));
    expect(text(summary())).not.toContain("null");
  });

  it("status strip: three straight rises read an amber Link to #model with the Watch title, the base month and both values, and the spoken label", async () => {
    renderRecession();
    await awaitHero();
    const link = await awaitStrip();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/app/recession#model");
    expect(link).toHaveClass("mrr-status");
    expect(link).toHaveClass("mrr-status-amber");
    expect(link).toHaveAttribute("data-tone", "amber");
    expect(stripTitle(link)).toBe("Watch · 3 straight rises");
    // Iteration 1 step 5 (G4): one status line.
    expect(stripDetail(link)).toBe("Since May 2026 · 10.2% → 11.6%");
    expect(link.getAttribute("aria-label")).toBe("Watch · 3 straight rises. Since May 2026 · 10.2% → 11.6%. Opens the model inputs.");
    expect(summary().querySelectorAll(".mrr-status")).toHaveLength(1);
  });

  it("status strip: the flat fixture reads mint No consecutive rises with the signed delta and the two months; the subhead reads unchanged", async () => {
    stubFetch(withMetrics(FLAT));
    renderRecession();
    await awaitHero();
    const link = await awaitStrip();
    expect(link).toHaveClass("mrr-status-mint");
    expect(link).not.toHaveClass("mrr-status-amber");
    expect(link).toHaveAttribute("href", "/app/recession#model");
    expect(stripTitle(link)).toBe("No consecutive rises");
    expect(stripDetail(link)).toBe("0.0 pts · Jun 2026 → Sep 2026");
    expect(text(within(hero()).getByRole("heading", { level: 2 }))).toBe("Twelve-month odds, unchanged over three months.");
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("3 months ago"))).toBe("11.6% 0.0 pts · Jun 2026");
    const flat = [...ddFor("3 months ago").querySelectorAll<HTMLElement>("span")].find((el) => text(el).startsWith("0.0 pts"));
    expect(flat?.style.color).toBe("var(--text-2)");
    expect(text(hero())).toContain("Scored for Sep 2026");
  });

  it("#model: the Model inputs header, five article SignalCards with h3 names in model_features order, the Upward + Model input badges, the values, no svg and the two mono lines each", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("model");
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Model inputs$/);
    expect(text(section)).toContain("The five series the model scores each month");
    expect(text(section)).toContain("5 inputs · latest Sep 2026");
    expect(within(section).getByRole("link", { name: /Series notes/ })).toHaveAttribute("href", "/app/methodology#models");
    await waitFor(() => expect(cards()).toHaveLength(5));
    expect(cards().map((a) => text(a.querySelector("h3")))).toEqual(CARD_NAMES);
    expect(cards().map((a) => text(badgeOf(a)))).toEqual(["Upward", "Model input", "Model input", "Model input", "Model input"]);
    expect(cards().map((a) => badgeOf(a).getAttribute("data-tone"))).toEqual(["reference", "reference", "reference", "reference", "reference"]);
    cards().forEach((c, i) => {
      expect(text(c), CARD_NAMES[i]).toContain(CARD_VALUES[i]);
      expect(text(c), CARD_NAMES[i]).toContain(INPUTS_THROUGH);
      expect(text(c), CARD_NAMES[i]).toContain(CARD_COEF_LINES[i]);
      expect(c.querySelectorAll("svg"), CARD_NAMES[i]).toHaveLength(0);
      expect(c.querySelector(".mrr-meter"), CARD_NAMES[i]).toBeNull();
      expect(c.querySelectorAll("p"), `${CARD_NAMES[i]} mono lines`).toHaveLength(2);
    });
    expect(section.querySelectorAll("article svg")).toHaveLength(0);
    // Iteration 1 G2: the X10 caption moved from the curve card to under the
    // row, so the five cards carry the same slots and height.
    expect(text(section)).toContain(CURVE_CARD_CAPTION);
    expect(within(section).getByRole("button", { name: "10Y–2Y spread" })).toHaveClass("jargon");
    for (const name of CARD_NAMES) expect(text(cardNamed(name)), name).not.toContain("An inverted curve");
    for (const w of BANNED_CARD_WORDS) expect(text(main()), w).not.toContain(w);
    // The card coefficient equals the transparency row's coefficient.
    const t = await awaitSection("transparency");
    expect(text(t)).toContain("+2.58");
    expect(text(cardNamed("HY credit spread"))).toContain("+2.58");
  });

  it("a null lei input renders the LEI card with Not stored and the Unavailable badge in the reference tint; the other four are intact", async () => {
    stubFetch(withMetrics(NULL_INPUT));
    renderRecession();
    await awaitHero();
    await awaitSection("model");
    await waitFor(() => expect(cards()).toHaveLength(5));
    const lei = cardNamed(BREAKEVEN);
    expect(text(lei)).toContain("Not stored");
    expect(text(badgeOf(lei))).toBe("Unavailable");
    expect(badgeOf(lei)).toHaveAttribute("data-tone", "reference");
    expect(text(lei)).toContain(INPUTS_THROUGH);
    expect(text(lei)).not.toContain("null");
    expect(text(cardNamed("Unemployment rate"))).toContain("4.1%");
    expect(text(badgeOf(cardNamed("Unemployment rate")))).toBe("Model input");
  });

  it("#curve: the header with the Curve window control at 30Y, the 2s10s chart with the Inversion below 0 label and the X14 caption, the Current curve shape tile with 2Y and 10Y, the Not stored note and no year-ago comparison", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("curve");
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Curve monitor$/);
    expect(text(section)).toContain("2s10s daily, 30 years stored, recessions shaded");
    expect(text(section)).toContain("FRED · daily");
    const group = curveGroup();
    expect(within(group).getAllByRole("button").map((b) => text(b))).toEqual(["5Y", "10Y", "30Y"]);
    expect(within(group).getByRole("button", { name: "30Y" })).toHaveAttribute("aria-pressed", "true");
    const svg = section.querySelector("svg[role='img']");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-label", "10Y minus 2Y Treasury spread, 30-year history, NBER recessions shaded");
    expect(text(section)).toContain("Inversion below 0");
    expect(legendRange(section)).toBe("Mar 01, 1996 → Sep 01, 2026");
    expect(text(section)).toContain(CURVE_CAPTION);
    const tile = tileWith(section, "Current curve shape");
    expect(text(tile)).toContain("2Y");
    expect(text(tile)).toContain("4.63%");
    expect(text(tile)).toContain("10Y");
    expect(text(tile)).toContain("4.96%");
    expect(text(tile)).toContain(NOT_STORED);
    expect(text(tile)).toContain(SHAPE_CAPTION);
    expect(within(tile).getByRole("button", { name: "tenors" })).toHaveClass("jargon");
    expect(text(section).toLowerCase()).not.toContain("year ago");
    expect(text(section)).not.toContain("Bear steepener");
  });

  it("5Y and 10Y slice the served curve by date and shorten the legend's range; 30Y restores the series start", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("curve");
    fireEvent.click(within(curveGroup()).getByRole("button", { name: "5Y" }));
    expect(within(curveGroup()).getByRole("button", { name: "5Y" })).toHaveAttribute("aria-pressed", "true");
    expect(within(curveGroup()).getByRole("button", { name: "30Y" })).toHaveAttribute("aria-pressed", "false");
    await waitFor(() => expect(legendRange(section)).toBe("Mar 01, 2022 → Sep 01, 2026"));
    expect(section.querySelector("svg[role='img']")).toHaveAttribute("aria-label", "10Y minus 2Y Treasury spread, 5-year history, NBER recessions shaded");
    fireEvent.click(within(curveGroup()).getByRole("button", { name: "10Y" }));
    await waitFor(() => expect(legendRange(section)).toBe("Mar 01, 2017 → Sep 01, 2026"));
    expect(section.querySelector("svg[role='img']")).toHaveAttribute("aria-label", "10Y minus 2Y Treasury spread, 10-year history, NBER recessions shaded");
    fireEvent.click(within(curveGroup()).getByRole("button", { name: "30Y" }));
    await waitFor(() => expect(legendRange(section)).toBe("Mar 01, 1996 → Sep 01, 2026"));
    expect(within(curveGroup()).getByRole("button", { name: "30Y" })).toHaveAttribute("aria-pressed", "true");
  });

  it("#sensitivity is the Sensitivity panel itself, open on load (X3): the header, the lead line, no disclosure button, five sliders and one scenario POST", async () => {
    const { calls } = stubFetch(routes());
    renderRecession();
    await awaitHero();
    const panel = await awaitSection("sensitivity");
    expect(panel.tagName).toBe("SECTION");
    expect(within(panel).getByRole("heading", { level: 2 })).toHaveTextContent(/^Sensitivity$/);
    expect(text(panel)).toContain("Move an input and the fitted model rescores live");
    expect(text(panel)).toContain("five inputs · the fitted model rescored live");
    expect(text(panel)).toContain(SENS_LEAD);
    expect(sensButton()).toBeNull();
    expect(panel.querySelector(".mrr-disclosure-row")).toBeNull();
    await waitFor(() => expect(ranges()).toHaveLength(5));
    await waitFor(() => expect(calls.filter((c) => c.startsWith("/api/recession/scenario"))).toHaveLength(1));
    expect(text(main())).not.toContain("Where the change came from");
  });

  it("on load the panel mounts five baseline-ticked sliders at the seeded readings, the seeded eyebrows, the disabled reset, the model's own reading and, after the POST, the 10.4% scenario in the display face with the Low Risk badge and the delta line", async () => {
    renderRecession();
    await awaitHero();
    await awaitSection("sensitivity");
    await waitFor(() => expect(ranges()).toHaveLength(5));
    expect(ranges().map((r) => r.getAttribute("aria-valuetext"))).toEqual(SEEDED_VALUETEXT);
    expect(sliderRows().map((r) => text(r.querySelector("label")))).toEqual(SLIDER_LABELS);
    expect(document.querySelectorAll(".mrr-slider-tick")).toHaveLength(5);
    expect(sliderRows()).toHaveLength(5);
    for (const row of sliderRows()) expect(row).toHaveAttribute("data-changed", "false");
    for (const label of SLIDER_LABELS) expect(document.querySelector(`input[aria-label="${label} (typed)"]`), `${label} typed field`).not.toBeNull();
    expect(rangeOf(BREAKEVEN)).toHaveAttribute("aria-label", BREAKEVEN);
    // The scale row's mid span is empty on an unchanged row, so its ends concatenate in textContent.
    expect(text(sliderRow("Yield curve 2s10s").querySelector(".mrr-slider-scale"))).toMatch(/^-200 bps.*300 bps$/);
    expect(text(sliderRow("Unemployment rate").querySelector(".mrr-slider-scale"))).toMatch(/^2%.*15%$/);
    expect(text(sensitivity())).not.toContain("│ current reading");
    expect(within(sensitivity()).getByText("Model inputs · seeded from current readings")).toBeInTheDocument();
    expect(within(sensitivity()).getByText(SCENARIO_EYEBROW)).toBeInTheDocument();
    // X3: the model's own reading is always stated beside the scenario.
    expect(text(modelFigure())).toContain("Model's own reading · headline");
    expect(text(modelFigure())).toContain("11.6%");
    expect(text(modelFigure()?.querySelector("span[data-tone]"))).toBe("Low Risk");
    expect(resetButton()).toBeDisabled();
    expect(text(resetButton())).toBe("↻ Reset to current readings");
    await waitFor(() => expect(displaySpan()).not.toBeNull());
    expect(text(displaySpan())).toBe("10.4%");
    expect(css(displaySpan())).toContain("var(--font-display)");
    expect(text(scenarioBadge())).toBe("Low Risk");
    expect(scenarioBadge()).toHaveAttribute("data-tone", "clear");
    expect(text(sensitivity())).toContain("-1.2pp vs the model's headline 11.6%");
    expect(text(sensitivity())).toContain(SCENARIO_CAPTION);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual(SEEDED);
    expect(text(main())).not.toContain("Where the change came from");
  });

  it("moving the Unemployment rate slider to 4.8 flags the row, flips the eyebrows, posts the new input and renders 49.0% High Risk while the model's reading stays 11.6%; Reset restores the seeded state", async () => {
    renderRecession();
    await awaitHero();
    await awaitSection("sensitivity");
    await waitFor(() => expect(text(displaySpan())).toBe("10.4%"));
    fireEvent.change(rangeOf("Unemployment rate"), { target: { value: "4.8" } });
    const row = sliderRow("Unemployment rate");
    expect(row).toHaveAttribute("data-changed", "true");
    expect(text(row)).toContain("│ current reading");
    expect(rangeOf("Unemployment rate")).toHaveAttribute("aria-valuetext", "4.8%");
    for (const label of SLIDER_LABELS.filter((l) => l !== "Unemployment rate")) expect(sliderRow(label), label).toHaveAttribute("data-changed", "false");
    expect(within(sensitivity()).getByText("Model inputs · modified by you")).toBeInTheDocument();
    expect(within(sensitivity()).getByText("Your adjusted probability")).toBeInTheDocument();
    expect(within(sensitivity()).queryByText(SCENARIO_EYEBROW)).toBeNull();
    expect(resetButton()).toBeEnabled();
    await waitFor(() => expect(posted.some((b) => b.unemployment === 4.8)).toBe(true));
    const changed = posted.find((b) => b.unemployment === 4.8) as RecessionScenarioRequest;
    expect(changed).toEqual({ ...SEEDED, unemployment: 4.8 });
    await waitFor(() => expect(text(displaySpan())).toBe("49.0%"));
    expect(text(scenarioBadge())).toBe("High Risk");
    expect(scenarioBadge()).toHaveAttribute("data-tone", "alert");
    expect(text(sensitivity())).toContain("+37.4pp vs the model's headline 11.6%");
    expect(text(sensitivity())).not.toContain("-1.2pp");
    expect(text(modelFigure())).toContain("11.6%");

    fireEvent.click(resetButton());
    for (const r of sliderRows()) expect(r).toHaveAttribute("data-changed", "false");
    expect(rangeOf("Unemployment rate")).toHaveAttribute("aria-valuetext", "4.1%");
    expect(text(sensitivity())).not.toContain("│ current reading");
    expect(within(sensitivity()).getByText("Model inputs · seeded from current readings")).toBeInTheDocument();
    expect(within(sensitivity()).getByText(SCENARIO_EYEBROW)).toBeInTheDocument();
    await waitFor(() => expect(text(displaySpan())).toBe("10.4%"));
    expect(text(scenarioBadge())).toBe("Low Risk");
    expect(resetButton()).toBeDisabled();
    expect(posted.every((b) => b.unemployment === 4.1 || b.unemployment === 4.8)).toBe(true);
  });

  it("a null lei input shows the incomplete-inputs note with no slider and no POST", async () => {
    const { calls } = stubFetch(withMetrics(NULL_INPUT));
    renderRecession();
    await awaitHero();
    await awaitSection("sensitivity");
    await waitFor(() => expect(text(sensitivity())).toContain(INCOMPLETE));
    expect(ranges()).toHaveLength(0);
    expect(displaySpan()).toBeNull();
    await new Promise((r) => setTimeout(r, 250));
    expect(calls.filter((c) => c.startsWith("/api/recession/scenario"))).toHaveLength(0);
    expect(posted).toHaveLength(0);
  });

  it("route /app/recession#sensitivity shows the sliders and lands the hash on #sensitivity", async () => {
    const targets: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      targets.push(this);
    });
    window.history.replaceState(null, "", `${ROUTE}#sensitivity`);
    renderRecession({ route: `${ROUTE}#sensitivity` });
    await awaitHero();
    await awaitSection("sensitivity");
    await waitFor(() => expect(ranges()).toHaveLength(5));
    await waitFor(() => expect(targets).toContain(byId("sensitivity") as HTMLElement));
    await waitFor(() => expect(text(displaySpan())).toBe("10.4%"));
  });

  it("route /app/recession#transparency lands the hash on #transparency", async () => {
    const targets: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      targets.push(this);
    });
    window.history.replaceState(null, "", `${ROUTE}#transparency`);
    renderRecession({ route: `${ROUTE}#transparency` });
    await awaitHero();
    await waitFor(() => expect(targets).toContain(byId("transparency") as HTMLElement));
    expect(sensButton()).toBeNull();
  });

  it("#transparency: the header, five coefficient rows sorted by magnitude with diverging bars on the right side of the sign, the legend and the caption", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("transparency");
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Model transparency$/);
    expect(text(section)).toContain("Coefficients and training details");
    expect(text(section)).toContain("coefficients · training metadata");
    expect(within(section).getByRole("link", { name: /Methodology/ })).toHaveAttribute("href", "/app/methodology#models");
    const tile = tileWith(section, "Feature coefficients · log-odds per σ");
    expect(text(tile)).toContain("lowers odds · raises odds");
    const fills = bars(tile);
    expect(fills).toHaveLength(5);
    const rows = fills.map(rowOfBar);
    rows.forEach((row, i) => {
      expect(text(row), `row ${i}`).toContain(COEF_ORDER[i]);
      expect(text(row), `row ${i}`).toContain(COEF_SIGNED[i]);
      expect(text(row), `row ${i}`).toContain(COEF_CURRENT[i]);
      const bar = fills[i];
      if (COEF_NEGATIVE.has(COEF_ORDER[i])) {
        expect(bar.style.right, `${COEF_ORDER[i]} bar`).toBe("50%");
        expect(bar.style.left, `${COEF_ORDER[i]} bar`).toBe("");
      } else {
        expect(bar.style.left, `${COEF_ORDER[i]} bar`).toBe("50%");
        expect(bar.style.right, `${COEF_ORDER[i]} bar`).toBe("");
      }
    });
    expect(text(rows[0]).startsWith("HY credit spread")).toBe(true);
    expect(fills[0].style.width).toBe("50%"); // the strongest bar fills its half
    expect(parseFloat(fills[1].style.width)).toBeLessThan(50);
    expect(parseFloat(fills[1].style.width)).toBeGreaterThan(45);
    expect(text(tile)).toContain("A one-σ rise in HY credit spread adds 2.58 to the");
    expect(text(tile)).toContain(COEF_CAPTION_TAIL);
    // G4: the third sentence sits behind Details on the same tile.
    expect(text(tile)).not.toContain("Unemployment enters negative");
    fireEvent.click(within(tile).getByRole("button", { name: /Details/ }));
    expect(text(tile)).toContain("Unemployment enters negative because it co-moves with the credit and curve terms");
    expect(text(tile)).not.toContain("Orange bars");
    expect(within(tile).getByRole("button", { name: "log-odds" })).toHaveClass("jargon");
  });

  it("#transparency: the Macro vs markets tile prints -34 on a ±100 scale with the marker at 33%, the scale words in order and the X11 caption behind the divergence jargon", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("transparency");
    const tile = tileWith(section, "Macro vs markets");
    expect(text(tile)).toContain("-34");
    expect(text(tile)).toContain("on a ±100 scale");
    const marker = tile.querySelector<HTMLElement>("[title='-34 on ±100']");
    expect(marker).not.toBeNull();
    expect(marker?.style.left).toBe("33%");
    const t = text(tile);
    const macro = t.indexOf("Macro more worried");
    const material = t.indexOf("±20 material");
    const markets = t.indexOf("Markets more worried");
    expect(macro).toBeGreaterThanOrEqual(0);
    expect(material).toBeGreaterThan(macro);
    expect(markets).toBeGreaterThan(material);
    const caption = [...tile.querySelectorAll<HTMLElement>("div, p")].find((el) => text(el).includes("credit-market pricing (HY percentile)") && !el.querySelector("div, p"));
    expect(caption, "the X11 caption").toBeDefined();
    expect(text(caption)).toMatch(DIVERGENCE_CAPTION);
    expect(text(tile)).not.toContain(DIVERGENCE_DETAILS);
    fireEvent.click(within(tile).getByRole("button", { name: /Details/ }));
    expect(text(tile)).toContain(DIVERGENCE_DETAILS);
    expect(within(tile).getByRole("button", { name: "Macro ahead of markets" })).toHaveClass("jargon");
    // The summary row and the tile agree.
    await waitFor(() => expect(text(ddFor("Model vs market"))).toBe("Macro ahead of markets · -34 on ±100"));
  });

  it("#transparency: a positive score sits right of centre and the dash placeholder replaces a null score without a marker", async () => {
    const first = renderRecession();
    await awaitHero();
    let section = await awaitSection("transparency");
    expect(tileWith(section, "Macro vs markets").querySelector("[title='-34 on ±100']")).not.toBeNull();
    first.unmount();

    stubFetch(withMetrics({ divergence_score: 40, divergence_label: "Markets ahead of macro" }));
    const second = renderRecession();
    await awaitHero();
    section = await awaitSection("transparency");
    let tile = tileWith(section, "Macro vs markets");
    expect(text(tile)).toContain("+40");
    expect(tile.querySelector<HTMLElement>("[title='+40 on ±100']")?.style.left).toBe("70%");
    expect(text(tile)).toContain("Markets ahead of macro: credit-market pricing");
    second.unmount();

    stubFetch(withMetrics({ divergence_score: null, divergence_label: "Aligned" }));
    renderRecession();
    await awaitHero();
    section = await awaitSection("transparency");
    tile = tileWith(section, "Macro vs markets");
    expect(text(tile)).toContain(DASH);
    expect(tile.querySelector("[title$='on ±100']")).toBeNull();
    expect(text(tile)).not.toContain("null");
  });

  it("#transparency: the model card dl carries the six rows in order with the served values and no Last refit", async () => {
    renderRecession();
    await awaitHero();
    const section = await awaitSection("transparency");
    const tile = tileWith(section, "Model card");
    const dl = tile.querySelector("dl") as HTMLElement;
    expect(dl).not.toBeNull();
    expect([...dl.querySelectorAll("dt")].map((d) => text(d))).toEqual(MODEL_CARD_ROWS);
    expect([...dl.querySelectorAll("dd")].map((d) => text(d))).toEqual(MODEL_CARD_VALUES);
    expect(text(section)).not.toContain("Last refit");
    // E2: the caption names the input for what it is and the series it stands in for.
    expect(within(tile).getByRole("button", { name: BREAKEVEN })).toHaveClass("jargon");
    expect(text(tile)).toContain(
      "The fifth input is the 10Y − 5Y breakeven spread (T10YIE − T5YIE), standing in for the Conference Board leading index (USSLIND), which stopped publishing in February 2020.",
    );
  });

  it("renders the section ids in document order inside main, the four sections as section elements, and the DisclosureLine last with the B.7 sentence", async () => {
    renderRecession();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    await awaitSection("transparency");
    const els = IDS_IN_ORDER.map((id) => byId(id));
    IDS_IN_ORDER.forEach((id, i) => expect(els[i], id).not.toBeNull());
    for (const el of els) expect(main().contains(el)).toBe(true);
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${IDS_IN_ORDER[i - 1]} before ${IDS_IN_ORDER[i]}`).toBeTruthy();
    }
    for (const id of ["model", "curve", "transparency"]) expect((byId(id) as HTMLElement).tagName, id).toBe("SECTION");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const line = main().querySelector("p.mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(text(line)).toBe(DISCLOSURE_LINE);
    expect(text(line)).toContain("no saved artifact");
    const all = [...main().querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(main().querySelectorAll(".mrr-disclosure-line")).toHaveLength(1);
    expect(text(main())).not.toContain("— ");
    expect(text(main())).not.toContain("Desk read");
    expect(text(main())).not.toContain("Probability model");
  });

  it("metrics pending renders the training headline with no pill, the gray Reading the recession model… strip, the training note in the rows and the loading notes in the panels", async () => {
    stubFetch(routes({ "/api/recession/probability": PENDING }));
    renderRecession();
    expect(await screen.findByText(LOADING_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(LOADING_HEADLINE);
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    expect(text(hero())).not.toContain(ERROR_HEADLINE);
    const link = await awaitStrip();
    expect(link).toHaveAttribute("data-tone", "gray");
    expect(link).toHaveAttribute("href", "/app/recession#model");
    expect(stripTitle(link)).toBe("Reading the recession model…");
    expect(stripDetail(link)).toBe("Opens the model inputs");
    expect(text(summary())).toContain(LOADING_ROW);
    for (const id of ["model", "curve", "transparency"]) {
      const section = await awaitSection(id);
      expect(within(section).getByRole("heading", { level: 2 }), id).toBeInTheDocument();
      expect(text(section), id).toContain(STATE_LOADING);
    }
    expect(model().querySelectorAll("article")).toHaveLength(0);
    expect(ranges()).toHaveLength(0);
  });

  it("metrics 404 without data renders the error headline with the gray Unavailable pill, the gray Recession model unavailable strip and the error notes", async () => {
    stubFetch(without("/api/recession/probability"));
    renderRecession();
    // The panels print the same sentence (CP4), so the headline is read in the hero.
    await waitFor(() => expect(hero()).not.toBeNull());
    expect(await within(hero()).findByText(ERROR_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Recession model unavailable");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const pill = hero().querySelector(".mrr-pill");
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(screen.queryByText(LOADING_HEADLINE)).toBeNull();
    const link = await awaitStrip();
    expect(link).toHaveAttribute("data-tone", "gray");
    expect(stripTitle(link)).toBe("Recession model unavailable");
    expect(stripDetail(link)).toBe("The data service did not answer");
    expect(text(summary())).toContain(STATE_ERROR);
    for (const id of ["model", "curve", "transparency"]) {
      const section = await awaitSection(id);
      expect(text(section), id).toContain(ERROR_HEADLINE);
    }
    expect(gaugeSvg()).toBeNull();
    expect(posted).toHaveLength(0);
  });

  it("metrics 404 with seeded cache data renders no error copy (the snapshot rule)", async () => {
    stubFetch(without("/api/recession/probability"));
    const client = makeClient();
    const key = ["recession", "probability"];
    // Seeded like the validated snapshot: older than the hook's 15-minute
    // staleTime, so the mount refetches, the refetch 404s, and the seeded
    // metrics must stay on screen.
    client.setQueryData(key, BASE, { updatedAt: NOW_MS - 60 * 60_000 });
    renderRecession({ client });
    await awaitHero();
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
    expect(client.getQueryData(key)).toEqual(BASE);
    expect(screen.queryByText(ERROR_HEADLINE)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("11.6%");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("Low Risk");
    expect(gaugeSvg()).not.toBeNull();
    expect(text(summary())).not.toContain("Unavailable");
  });

  it("a 404 on /api/regime/latest renders the error note in the Regime context row only", async () => {
    stubFetch(without("/api/regime/latest"));
    renderRecession();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    await waitFor(() => expect(text(ddFor("Regime context"))).toBe(STATE_ERROR));
    expect(text(ddFor("12-month probability"))).toBe("11.6% · Low Risk");
    expect(text(ddFor("3 months ago"))).toBe("10.2% +1.4 pts · May 2026");
    expect(text(ddFor("Model vs market"))).toBe("Macro ahead of markets · -34 on ±100");
    expect(text(ddFor("Reference thresholds"))).toContain(THRESHOLDS);
    expect(text(summary()).match(new RegExp(STATE_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
    expect(text(hero())).not.toContain(ERROR_HEADLINE);
    const link = await awaitStrip();
    expect(stripTitle(link)).toBe("Watch · 3 straight rises");
  });

  it("the Regime context row reads the loading note while the classifier is pending", async () => {
    stubFetch(routes({ "/api/regime/latest": PENDING }));
    renderRecession();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("Regime context"))).toBe(STATE_LOADING);
    expect(text(ddFor("12-month probability"))).toBe("11.6% · Low Risk");
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
  });
});
