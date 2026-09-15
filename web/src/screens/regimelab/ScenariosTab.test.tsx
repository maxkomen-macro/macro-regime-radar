/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.8 and
 * E.1, `screens/regimelab/ScenariosTab.test.tsx`: the scenario builder. The
 * first served preset is pressed on load and scores once; "Custom shocks"
 * shows the four SliderRows with `baseline={0}` (data-changed="false"); a
 * moved HY slider turns its row amber and fires exactly one debounced POST
 * whose body carries the new value, moving the stressed legend while the
 * "stored odds today" legend (the classifier's own odds) does not; the reset
 * button restores zero. The result tile keeps every element and the empty /
 * error states read their copy. The POST stub echoes the posted shocks into
 * `input_shocks` and shifts the stressed odds with the HY shock.
 * Real timers: the 150 ms debounce is awaited with findBy.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import ScenariosTab from "./ScenariosTab";
import type { Regime, ScenarioDef, ScenarioResult, ScenarioShocks } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const REGIME: Regime = {
  date: "2026-09-01",
  label: "Goldilocks",
  confidence: 0.47,
  growth_trend: 0.31,
  inflation_trend: -0.42,
  prob_goldilocks: 0.58,
  prob_overheating: 0.07,
  prob_stagflation: 0.04,
  prob_recession: 0.31,
};
const ZERO: ScenarioShocks = { hy_spread_delta_bps: 0, yield_10y_delta_bps: 0, vix_delta: 0, spx_delta_pct: 0 };

function def(key: string, name: string, severity: string, color: string, shocks: ScenarioShocks): ScenarioDef {
  return {
    key,
    name,
    emoji: "",
    description: `${name} against today's stored odds`,
    severity,
    color,
    input_shocks: shocks,
    historical_reference: key === "covid_replay" ? "March 2020" : "",
    what_happened_then: `${name}: spreads moved and the classifier answered within two months.`,
    sector_implications: { overweight: ["Energy", "Materials"], underweight: ["Technology", "Consumer discretionary"] },
    duration_estimate: "3 to 6 months",
    indicators_to_watch: ["HY OAS", "VIX"],
  };
}
const DEFS: ScenarioDef[] = [
  def("covid_replay", "COVID replay", "severe", "#e74c3c", { hy_spread_delta_bps: 300, yield_10y_delta_bps: -100, vix_delta: 40, spx_delta_pct: -25 }),
  def("rate_shock", "Rate shock", "moderate", "#e67e22", { hy_spread_delta_bps: 0, yield_10y_delta_bps: 150, vix_delta: 10, spx_delta_pct: -8 }),
  def("soft_landing", "Soft landing", "positive", "#2ecc71", { hy_spread_delta_bps: -50, yield_10y_delta_bps: -25, vix_delta: -5, spx_delta_pct: 6 }),
  def("stagflation_scare", "Stagflation scare", "severe", "#c0392b", { hy_spread_delta_bps: 150, yield_10y_delta_bps: 75, vix_delta: 15, spx_delta_pct: -12 }),
  def("credit_crisis", "Credit crisis", "extreme", "#8e44ad", { hy_spread_delta_bps: 500, yield_10y_delta_bps: -150, vix_delta: 50, spx_delta_pct: -40 }),
];

/** The stress rule of the stub: the HY shock moves odds from Goldilocks to
 * Recession Risk, one point per 10 bps, so a slider move is observable. */
function scenarioResult(d: ScenarioDef | null, shocks: ScenarioShocks): ScenarioResult {
  const shift = Math.max(-40, Math.min(40, Math.round(shocks.hy_spread_delta_bps / 10)));
  const stressed = { goldilocks: 58 - shift, overheating: 7, stagflation: 4, recession_risk: 31 + shift };
  const [most, prob] = stressed.recession_risk > stressed.goldilocks ? ["Recession Risk", stressed.recession_risk] : ["Goldilocks", stressed.goldilocks];
  return {
    scenario_name: d?.name ?? "Custom shocks",
    emoji: "",
    description: d?.description ?? "Custom shocks",
    severity: d?.severity ?? "custom",
    color: d?.color ?? "#58b8e6",
    historical_reference: d?.historical_reference ?? "",
    what_happened_then: d?.what_happened_then ?? "",
    input_shocks: shocks,
    current_regime_probs: { goldilocks: 58, overheating: 7, stagflation: 4, recession_risk: 31 },
    stressed_regime_probs: stressed,
    prob_changes: { goldilocks: -shift, overheating: 0, stagflation: 0, recession_risk: shift },
    most_likely_regime: most as string,
    most_likely_prob: prob as number,
    positioning_implications: ["Add duration — the curve bull-steepens", "Trim cyclicals", "Own quality", "Hold cash", "A fifth line never shows"],
    sector_implications: d?.sector_implications ?? { overweight: ["Staples"], underweight: ["Banks"] },
    duration_estimate: d?.duration_estimate ?? "",
    indicators_to_watch: d?.indicators_to_watch ?? [],
  };
}

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
/** "/api/regime/scenarios" precedes "/api/regime/scenario": stubFetch matches by prefix, first key wins. */
function routes(over: Routes = {}): Routes {
  return {
    "/api/regime/latest": () => REGIME,
    "/api/regime/scenarios": () => DEFS,
    "/api/regime/scenario": (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { scenario_key: string | null; custom_shocks: ScenarioShocks | null };
      const d = body.scenario_key ? (DEFS.find((x) => x.key === body.scenario_key) ?? null) : null;
      return scenarioResult(d, body.custom_shocks ?? d?.input_shocks ?? ZERO);
    },
    ...over,
  };
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
const section = () => byId("scenarios") as HTMLElement;
const group = () => screen.getByRole("group", { name: "Scenario" });
const option = (name: string | RegExp) => within(group()).getByRole("button", { name });
/** The result tile: the surface holding the "stressed odds" eyebrow. */
function resultTile(): HTMLElement {
  const label = within(section()).getByText(/^stressed odds$/i);
  return label.closest("[style*='var(--tile)']") as HTMLElement;
}
/** Legend text of the odds bar under the given eyebrow ("stored odds today" / "stressed odds"). */
function legend(eyebrow: RegExp): string {
  const label = within(section()).getByText(eyebrow);
  const block = label.parentElement as HTMLElement;
  const bar = block.querySelector(".mrr-odds") as HTMLElement;
  return text(bar.nextElementSibling);
}
const sliderRows = () => [...section().querySelectorAll<HTMLElement>(".mrr-slider-row")];
const rowOf = (slider: HTMLElement) => slider.closest(".mrr-slider-row") as HTMLElement;
const isPost = (path: string) => path === "/api/regime/scenario";

async function renderScenarios(calls: string[]): Promise<void> {
  renderWithProviders(<ScenariosTab />, { route: "/app/regime-lab#scenarios" });
  await waitFor(() => expect(byId("scenarios")).not.toBeNull());
  await waitFor(() => expect(calls.filter(isPost)).toHaveLength(1));
  await within(section()).findByText(/^stressed odds$/i);
}

let calls: string[] = [];

beforeEach(() => {
  calls = stubFetch(routes()).calls;
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("ScenariosTab (checklist 04 B.8)", () => {
  it("the first preset is pressed on load and one POST renders its result; the header, chips and glyphs are in place", async () => {
    await renderScenarios(calls);
    expect(section().tagName).toBe("SECTION");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Scenario builder$/);
    expect(text(section())).toContain("Scenario analysis · stress rule over stored odds, not a classifier rerun");
    const buttons = within(group()).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false", "false", "false"]);
    expect(buttons.map((b) => text(b).replace(/^●\s*/, ""))).toEqual(["COVID replay", "Rate shock", "Soft landing", "Stagflation scare", "Credit crisis", "Custom shocks"]);
    expect(option("COVID replay")).toHaveAttribute("aria-pressed", "true");
    expect(option("COVID replay")).toHaveAttribute("title", "COVID replay against today's stored odds");
    // The scenario colour glyph is decoration inside the label.
    expect(buttons[0].querySelector("[aria-hidden='true']")?.textContent).toContain("●");
    expect(group()).toHaveAttribute("data-mono", "true");
    expect(calls.filter(isPost)).toHaveLength(1);
    expect(section().querySelectorAll(".mrr-slider-row")).toHaveLength(0);
    expect(within(section()).queryByText(/Pick a prebuilt scenario/)).toBeNull();
  });

  it("the result tile: name, severity tag, echoes, the shock summary, both odds bars, pp chips, most likely, positioning, OW / UW, duration and the caption", async () => {
    await renderScenarios(calls);
    const tile = resultTile();
    expect(tile).not.toBeNull();
    const name = [...tile.querySelectorAll("span")].find((s) => text(s) === "COVID replay") as HTMLElement;
    expect(name).toBeDefined();
    expect(name.style.color).toMatch(/#e74c3c|rgb\(231, ?76, ?60\)/);
    const severity = [...tile.querySelectorAll("[data-tone]")].find((s) => text(s) === "severe");
    expect(severity).toBeDefined();
    expect(css(tile)).toMatch(/rgba\(240, ?80, ?63, ?0?\.38\)/); // severe: the risk border
    const t = text(tile);
    expect(t).toContain("echoes March 2020");
    expect(t).toMatch(/HY \+300bps · 10Y [−-]100bps · VIX \+40 · SPX [−-]25%/);
    expect(within(tile).getByText(/^stored odds today$/i).style.textTransform).toBe("uppercase");
    expect(legend(/^stored odds today$/i)).toBe("GL 58% · OV 7% · ST 4% · RR 31%"); // the classifier's own odds
    expect(legend(/^stressed odds$/i)).toBe("GL 28% · OV 7% · ST 4% · RR 61%");
    expect(tile.querySelectorAll(".mrr-odds")).toHaveLength(2);
    // pp chips: amber only when positive; zero is a real label.
    const chip = (label: string) => [...tile.querySelectorAll("span")].find((s) => text(s) === label) as HTMLElement;
    expect(chip("goldilocks -30pp")).toBeDefined();
    expect(chip("recession risk +30pp")).toBeDefined();
    expect(chip("overheating +0pp")).toBeDefined();
    expect(chip("recession risk +30pp").style.color).toBe("var(--amber)");
    expect(chip("goldilocks -30pp").style.color).not.toBe("var(--amber)");
    expect(t).toContain("most likely: Recession Risk at 61%");
    const most = [...tile.querySelectorAll("b")].find((b) => text(b) === "Recession Risk") as HTMLElement;
    expect(most.style.color).toBe("var(--r-recession)");
    expect(within(tile).getByText(/^positioning$/i).style.color).toBe("var(--link)");
    expect(t).toContain("· Add duration; the curve bull-steepens");
    expect(t).toContain("· Hold cash");
    expect(t).not.toContain("A fifth line never shows");
    expect(within(tile).getByText(/^sectors$/i)).toBeInTheDocument();
    expect(t).toContain("OW Energy, Materials");
    expect(t).toContain("UW Technology, Consumer discretionary");
    expect(within(tile).getByText("OW").style.color).toBe("var(--pos)");
    expect(within(tile).getByText("UW").style.color).toBe("var(--neg)");
    expect(t).toContain("typical duration: 3 to 6 months");
    expect(t).toContain("A transparent stress rule (documented in the source) shifts the stored odds by the shock mix and renormalizes; it is a sketch of direction and rough size, not the classifier rerun. COVID replay: spreads moved and the classifier answered within two months.");
  });

  it("pressing another preset scores it and the tone follows its severity", async () => {
    await renderScenarios(calls);
    fireEvent.click(option("Soft landing"));
    expect(option("Soft landing")).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(calls.filter(isPost)).toHaveLength(2));
    await waitFor(() => expect(text(resultTile())).toContain("Soft landing"));
    expect([...resultTile().querySelectorAll("[data-tone]")].some((s) => text(s) === "positive")).toBe(true);
    expect(css(resultTile())).not.toMatch(/rgba\(240, ?80, ?63/);
    expect(text(resultTile())).toMatch(/HY [−-]50bps · 10Y [−-]25bps · VIX [−-]5 · SPX \+6%/);
    expect(text(resultTile())).not.toContain("echoes");
  });

  it("Custom shocks shows four sliders with data-changed false and the result stays while the zero-shock run scores", async () => {
    await renderScenarios(calls);
    fireEvent.click(option("Custom shocks"));
    expect(option("Custom shocks")).toHaveAttribute("aria-pressed", "true");
    expect(option("COVID replay")).toHaveAttribute("aria-pressed", "false");
    const rows = sliderRows();
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r).toHaveAttribute("data-changed", "false");
    expect(within(section()).getByRole("heading", { level: 3, name: "Shock inputs" })).toBeInTheDocument();
    for (const label of ["HY spread shock", "10Y yield shock", "VIX shock", "S&P 500 shock"]) expect(screen.getByRole("slider", { name: label })).toBeInTheDocument();
    const hy = screen.getByRole("slider", { name: "HY spread shock" });
    expect(hy).toHaveAttribute("min", "-200");
    expect(hy).toHaveAttribute("max", "500");
    expect(hy).toHaveAttribute("step", "10");
    expect(screen.getByRole("spinbutton", { name: "HY spread shock (typed)" })).toHaveValue(0);
    // The baseline tick sits at zero and the scale row carries the unit.
    expect(rowOf(hy).querySelector(".mrr-slider-tick")).not.toBeNull();
    expect(text(rowOf(hy))).toContain("+500 bps");
    expect(text(rowOf(hy))).not.toContain("current reading");
    // keepPreviousData: the preset's result stays on screen until the custom run lands.
    expect(within(section()).getByText(/^stressed odds$/i)).toBeInTheDocument();
    await waitFor(() => expect(calls.filter(isPost)).toHaveLength(2));
    await waitFor(() => expect(text(resultTile())).toContain("no shocks set"));
    expect([...resultTile().querySelectorAll("[data-tone]")].some((s) => text(s) === "custom")).toBe(true);
    expect(within(section()).getByRole("button", { name: "Reset shocks to zero" })).toHaveClass("mrr-btn");
  });

  it("changing the HY range fires exactly one POST after the debounce with the new value; the row turns amber, the stressed legend moves and the stored legend does not", async () => {
    await renderScenarios(calls);
    fireEvent.click(option("Custom shocks"));
    await waitFor(() => expect(calls.filter(isPost)).toHaveLength(2));
    await waitFor(() => expect(text(resultTile())).toContain("no shocks set"));
    const stored = legend(/^stored odds today$/i);
    const stressedBefore = legend(/^stressed odds$/i);
    expect(stored).toBe("GL 58% · OV 7% · ST 4% · RR 31%");
    const hy = screen.getByRole("slider", { name: "HY spread shock" });
    fireEvent.change(hy, { target: { value: "50" } });
    expect(rowOf(hy)).toHaveAttribute("data-changed", "true");
    expect(text(rowOf(hy))).toContain("│ current reading");
    expect(css(rowOf(hy).querySelector(".mrr-slider-fill"))).toMatch(/background(?:-color)?:\s*var\(--amber\)/);
    expect(hy).toHaveAttribute("aria-valuetext", "+50 bps");
    // The other rows stay at their baseline.
    expect(rowOf(screen.getByRole("slider", { name: "VIX shock" }))).toHaveAttribute("data-changed", "false");
    await within(section()).findByText(/HY \+50bps/);
    expect(calls.filter(isPost)).toHaveLength(3);
    expect(legend(/^stressed odds$/i)).toBe("GL 53% · OV 7% · ST 4% · RR 36%");
    expect(legend(/^stressed odds$/i)).not.toBe(stressedBefore);
    expect(legend(/^stored odds today$/i)).toBe(stored);
    expect(text(resultTile())).toContain("goldilocks -5pp");
    expect(text(resultTile())).toContain("recession risk +5pp");
    // Settle: no further POST once the debounce has fired.
    await new Promise((r) => setTimeout(r, 250));
    expect(calls.filter(isPost)).toHaveLength(3);
  });

  it("Reset shocks to zero restores the baseline, clears the amber and re-scores the zero-shock run", async () => {
    await renderScenarios(calls);
    fireEvent.click(option("Custom shocks"));
    await waitFor(() => expect(calls.filter(isPost)).toHaveLength(2));
    const hy = screen.getByRole("slider", { name: "HY spread shock" });
    fireEvent.change(hy, { target: { value: "50" } });
    await within(section()).findByText(/HY \+50bps/);
    fireEvent.click(within(section()).getByRole("button", { name: "Reset shocks to zero" }));
    expect(hy).toHaveValue("0");
    expect(rowOf(hy)).toHaveAttribute("data-changed", "false");
    expect(text(rowOf(hy))).not.toContain("current reading");
    expect(css(rowOf(hy).querySelector(".mrr-slider-fill"))).toMatch(/background(?:-color)?:\s*var\(--link\)/);
    await waitFor(() => expect(text(resultTile())).toContain("no shocks set"));
    expect(legend(/^stressed odds$/i)).toBe("GL 58% · OV 7% · ST 4% · RR 31%");
  });

  it("the empty prompt renders when neither a preset nor custom shocks are on screen", async () => {
    stubFetch(routes({ "/api/regime/scenarios": () => [] }));
    renderWithProviders(<ScenariosTab />, { route: "/app/regime-lab#scenarios" });
    await waitFor(() => expect(byId("scenarios")).not.toBeNull());
    expect(
      await within(section()).findByText("Pick a prebuilt scenario or build custom shocks. The five presets replay COVID, a rate shock, a soft landing, a stagflation scare and a credit crisis against today's stored odds."),
    ).toBeInTheDocument();
    expect(within(group()).getAllByRole("button").map((b) => text(b))).toEqual(["Custom shocks"]);
    expect(within(section()).queryByText(/^stressed odds$/i)).toBeNull();
    expect(calls.filter(isPost)).toHaveLength(0);
  });

  it("a failed run renders the error StateNote and loading the reading note", async () => {
    stubFetch(routes({ "/api/regime/scenario": () => ({ status: 500, body: { detail: "down" } }) }));
    const failed = renderWithProviders(<ScenariosTab />, { route: "/app/regime-lab#scenarios" });
    await waitFor(() => expect(byId("scenarios")).not.toBeNull());
    expect(await within(section()).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(within(section()).queryByText(/^stressed odds$/i)).toBeNull();
    failed.unmount();

    stubFetch(routes({ "/api/regime/scenario": () => new Promise(() => {}) }));
    renderWithProviders(<ScenariosTab />, { route: "/app/regime-lab#scenarios" });
    await waitFor(() => expect(byId("scenarios")).not.toBeNull());
    expect(await within(section()).findByText("Reading stored data…")).toBeInTheDocument();
  });
});
