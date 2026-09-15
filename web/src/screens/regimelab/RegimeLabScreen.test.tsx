/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) section
 * E.1, `screens/regimelab/RegimeLabScreen.test.tsx`: the rebuilt Regime Lab
 * (composition B.0, hero B.1, summary and strip B.2, sub-tabs and hash sync
 * B.3, copy C.2, ids D). renderWithProviders + stubFetch with a fixture per
 * route the page reads, in the load-bearing key order (`/api/regime/scenarios`
 * before `/api/regime/scenario`, `/api/regime/history` before any shorter
 * key); unmatched paths 404 so error branches are real. Fixtures are dated
 * Sep 2026 and never reuse the mockup's numbers: the assertions are the copy
 * rules, not the placeholder figures.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import RegimeLabScreen from "./RegimeLabScreen";
import type {
  AllocationData,
  Analogue,
  BacktestRow,
  RecessionMetrics,
  Regime,
  RegimeDuration,
  RegimeLabel,
  RegimePlaybook,
  ScenarioDef,
  ScenarioResult,
  ScenarioShocks,
  Takeaway,
  TransitionOutlook,
} from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LATEST = "2026-09-01";
const LABEL: Record<string, RegimeLabel> = { G: "Goldilocks", O: "Overheating", S: "Stagflation", R: "Recession Risk" };
/** Aug 2024 to Sep 2026, one letter per month: three completed Goldilocks
 * spells, one switch inside the last 12 rows, Goldilocks open for six months. */
const SPELLS = "GG OO GGG SS GG OOO RRRRRR GGGGGG";

const REGIME: Regime = {
  date: LATEST,
  label: "Goldilocks",
  confidence: 0.47,
  growth_trend: 0.31,
  inflation_trend: -0.42,
  prob_goldilocks: 0.58,
  prob_overheating: 0.07,
  prob_stagflation: 0.04,
  prob_recession: 0.31,
};

function monthsEnding(n: number, last = LATEST): string[] {
  const [y, m] = last.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + (m - 1) - (n - 1 - i);
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}-01`;
  });
}

/** The last row is the served latest regime; the fourth-from-last carries
 * Overheating odds of 10% against 7% at the end (a 3-point fall: not rising). */
function history(spec = SPELLS, over: (row: Regime, i: number, n: number) => Partial<Regime> = () => ({})): Regime[] {
  const labels = spec.replace(/\s+/g, "").split("").map((c) => LABEL[c]);
  const dates = monthsEnding(labels.length);
  const n = labels.length;
  return labels.map((label, i) => {
    const row: Regime = {
      date: dates[i],
      label,
      confidence: 0.47,
      growth_trend: ((i % 7) - 3) / 4,
      inflation_trend: ((i % 5) - 2) / 4,
      prob_goldilocks: 0.58,
      prob_overheating: i === n - 4 ? 0.1 : 0.07,
      prob_stagflation: 0.04,
      prob_recession: 0.31,
    };
    return { ...row, ...(i === n - 1 ? REGIME : {}), ...over(row, i, n) };
  });
}
const HISTORY = history();
/** Overheating odds 5% three rows back against 7% now: up 2 points, rising. */
const HISTORY_RISING = history(SPELLS, (_, i, n) => (i === n - 4 ? { prob_overheating: 0.05 } : {}));

/** Em-dash asides (tidied to semicolons on screen) and a <strong> span. */
const NARRATIVE =
  "Goldilocks leads the four-way split at 58% odds — the 12-month recession model reads 13.7%. Growth is steady while inflation eases. " +
  "Conditions favour <strong>risk assets</strong>, though valuations limit upside — drawdown risk rises from current spread levels.";
const LEDE_TEXT =
  "Goldilocks leads the four-way split at 58% odds; the 12-month recession model reads 13.7%. Growth is steady while inflation eases. " +
  "Conditions favour risk assets, though valuations limit upside; drawdown risk rises from current spread levels.";
const FIRST_SENTENCE = "Goldilocks leads the four-way split at 58% odds; the 12-month recession model reads 13.7%.";
const TAKEAWAY: Takeaway = {
  narrative: NARRATIVE,
  conviction: "Medium",
  conviction_color: "#f5b52e",
  primary_signal: "Risk-On",
  divergences: [],
  updated_ago: "2 hours ago",
  regime_probs: { goldilocks: 0.58, overheating: 0.07, stagflation: 0.04, recession: 0.31 },
  current_regime: "Goldilocks",
};
const TAKEAWAY_DIVERGENT: Takeaway = {
  ...TAKEAWAY,
  divergences: ["Credit spreads price more stress than the classifier — watch HY", "Breakevens are drifting up"],
};

const DURATION: RegimeDuration = {
  current_regime: "Goldilocks",
  days_in_regime: 183,
  months_in_regime: 6,
  historical_avg_months: 14.3,
  percentile_duration: 38,
  progress_pct: 42,
  status: "Early",
  status_color: "#2ecc71",
  risk_indicators: { momentum: 58, valuation: 71, sentiment: 23 },
};

const tr = (to: RegimeLabel, probability: number) => ({ to, probability, color: "#95a5a6" });
/** 6-month rows arrive sorted descending; their residual is 100 - 32 = 68. */
const TRANSITIONS: TransitionOutlook = {
  current_regime: "Goldilocks",
  stay_probability_3m: 81,
  transitions_3m: [tr("Recession Risk", 12), tr("Overheating", 5), tr("Stagflation", 2)],
  transitions_6m: [tr("Recession Risk", 19), tr("Overheating", 9), tr("Stagflation", 4)],
  narrative_3m: "Goldilocks has held for three months in 81% of past cases.",
  narrative_6m: "Over six months the hold rate falls as spells age.",
  highest_risk_transition: "Recession Risk",
  highest_risk_prob: 12,
  highest_risk_color: "#95a5a6",
};

const dated = (dates: string[], values: number[]) => dates.map((date, i) => ({ date, value: values[i] }));
const RECESSION: RecessionMetrics = {
  probability_source: "recession_model",
  recession_prob: 13.7,
  recession_label: "Low Risk",
  recession_color: "#2ecc71",
  yield_curve_spread: 52,
  yield_curve_pct_rank: 61,
  inversion_duration_months: 0,
  is_inverted: false,
  divergence_score: 8,
  divergence_label: "Aligned",
  divergence_color: "#2ecc71",
  recession_prob_series: dated(["2026-06-01", "2026-07-01", "2026-08-01"], [16.4, 15.2, 13.7]),
  yield_curve_series: dated(["2026-06-01", "2026-07-01", "2026-08-01"], [0.4, 0.47, 0.52]),
  usrec_series: [],
  n_training_samples: 420,
  model_features: ["yield_curve", "hy_oas"],
  feature_coefficients: { yield_curve: -0.8, hy_oas: 0.6 },
  data_as_of: "2026-08-01",
  curve_shape: {},
  current_inputs: {},
};
const RECESSION_DIVERGENT: RecessionMetrics = { ...RECESSION, divergence_score: -27, divergence_label: "Diverging" };

const playbook = (regime: RegimeLabel): RegimePlaybook => ({
  regime,
  regime_color: "#2ecc71",
  description: `${regime} description from the literature.`,
  historical_frequency: 22.4,
  avg_duration_months: 18,
  sector_tilts: { overweight: [{ sector: "Technology", strength: 72 }], underweight: [{ sector: "Utilities", strength: 48 }] },
  asset_performance: { "US equities": { avg_return: 8.2, hit_rate: 71 } },
  typical_indicators: { yield_curve: "Steepening", credit_spreads: "Tight", vix_regime: "Low" },
  key_risks: ["Risk one"],
  warning_signs: ["Warning one"],
  typical_catalysts: ["Catalyst one"],
  opportunities: ["Opportunity one"],
});
const PLAYBOOKS = Object.fromEntries((["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as RegimeLabel[]).map((r) => [r, playbook(r)]));

const ZERO: ScenarioShocks = { hy_spread_delta_bps: 0, yield_10y_delta_bps: 0, vix_delta: 0, spx_delta_pct: 0 };
const SCENARIO_DEF: ScenarioDef = {
  key: "covid_replay",
  name: "COVID replay",
  emoji: "",
  description: "March 2020 replayed against today's odds",
  severity: "severe",
  color: "#e74c3c",
  input_shocks: { hy_spread_delta_bps: 300, yield_10y_delta_bps: -100, vix_delta: 40, spx_delta_pct: -25 },
  historical_reference: "March 2020",
  what_happened_then: "Spreads gapped wider and the classifier flipped within two months.",
  sector_implications: { overweight: ["Energy"], underweight: ["Technology"] },
  duration_estimate: "3 to 6 months",
  indicators_to_watch: ["HY OAS"],
};
function scenarioResult(shocks: ScenarioShocks): ScenarioResult {
  const shift = Math.max(-40, Math.min(40, Math.round(shocks.hy_spread_delta_bps / 10)));
  return {
    scenario_name: SCENARIO_DEF.name,
    emoji: "",
    description: SCENARIO_DEF.description,
    severity: SCENARIO_DEF.severity,
    color: SCENARIO_DEF.color,
    historical_reference: SCENARIO_DEF.historical_reference,
    what_happened_then: SCENARIO_DEF.what_happened_then,
    input_shocks: shocks,
    current_regime_probs: { goldilocks: 58, overheating: 7, stagflation: 4, recession_risk: 31 },
    stressed_regime_probs: { goldilocks: 58 - shift, overheating: 7, stagflation: 4, recession_risk: 31 + shift },
    prob_changes: { goldilocks: -shift, overheating: 0, stagflation: 0, recession_risk: shift },
    most_likely_regime: shift > 13 ? "Recession Risk" : "Goldilocks",
    most_likely_prob: shift > 13 ? 31 + shift : 58 - shift,
    positioning_implications: ["Add duration"],
    sector_implications: SCENARIO_DEF.sector_implications,
    duration_estimate: SCENARIO_DEF.duration_estimate,
    indicators_to_watch: SCENARIO_DEF.indicators_to_watch,
  };
}

const ANALOGUES: Analogue[] = ["Q1 2019", "H2 2017", "2004 to 2005", "Mid 1990s"].map((period, i) => ({
  period,
  period_end: "2019-03-31",
  regime: i % 2 ? "Overheating" : "Goldilocks",
  similarity_score: 82 - i * 7,
  similarity_color: "#2ecc71",
  hy_spread_pct: 12,
  recession_prob: 9.5,
  what_happened: `${period}: a calm tape.`,
  time_to_change: "7 months",
  next_regime: "Overheating",
  key_drivers: [],
  market_impact: {},
  lessons_for_today: "Stay long while spreads hold.",
  resolution: "Rolled into Overheating.",
}));

const BACKTESTS: BacktestRow[] = (["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as RegimeLabel[]).flatMap((cohort, i) =>
  ["1M", "3M", "6M", "12M"].map((horizon, j) => ({
    test_name: `SPY_regime_${cohort}`,
    cohort,
    horizon,
    avg_return: (j + 1) * 0.01 - i * 0.004,
    median_return: (j + 1) * 0.008 - i * 0.004,
    hit_rate: 0.6,
    n: 20,
    computed_at: "2026-09-12T02:14:00",
  })),
);
const ALLOCATION = { regime_factors: { Goldilocks: { Value: 0.021, Momentum: 0.084 } } } as unknown as AllocationData;

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
/** Every route the page reads, in the load-bearing key order (E.1). */
function routes(over: Routes = {}): Routes {
  return {
    "/api/regime/latest": () => REGIME,
    "/api/regime/history": () => HISTORY,
    "/api/regime/intelligence": () => TAKEAWAY,
    "/api/regime/duration": () => DURATION,
    "/api/regime/transitions": () => TRANSITIONS,
    "/api/recession/probability": () => RECESSION,
    "/api/regime/playbooks": () => PLAYBOOKS,
    "/api/regime/scenarios": () => [SCENARIO_DEF],
    "/api/regime/scenario": (_url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { scenario_key: string | null; custom_shocks: ScenarioShocks | null };
      return scenarioResult(body.custom_shocks ?? (body.scenario_key ? SCENARIO_DEF.input_shocks : ZERO));
    },
    "/api/regime/analogues": () => ANALOGUES,
    "/api/backtests": () => BACKTESTS,
    "/api/allocation": () => ALLOCATION,
    ...over,
  };
}
function without(...paths: string[]): Routes {
  const r = routes();
  for (const p of paths) delete r[p];
  return r;
}

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderLab(route = "/app/regime-lab") {
  return renderWithProviders(
    <main id="main-content">
      <RegimeLabScreen />
    </main>,
    { route },
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
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const hero = () => byId("takeaway") as HTMLElement;
const summary = () => byId("regime-outlook") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = () => screen.findByRole("heading", { level: 1, name: "Early" });
const strip = () => summary().querySelector("a.mrr-status") as HTMLElement | null;
async function awaitStrip(): Promise<HTMLElement> {
  await waitFor(() => expect(strip()).not.toBeNull());
  return strip() as HTMLElement;
}
const tab = (label: string) => screen.getByRole("tab", { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

const LABELS = ["Current regime", "Classifier odds", "Model confidence", "Next 3 months", "Next 6 months", "Spell length", "Market read", "Takeaway conviction", "Takeaway divergences", "Model vs market"];
const OVERVIEW_IDS = ["takeaway", "regime-outlook", "cycle", "transitions", "regime-history-teaser"];
const DISCLOSURE_LINE =
  "Regime odds, durations and transitions from the stored monthly classifier · playbooks, analogue corpus and scenario definitions are labeled reference content · backtests computed from stored SPY history.";

beforeEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
  stubFetch(routes());
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("RegimeLabScreen (checklist 04 E.1)", () => {
  it("renders exactly one h1 equal to the served status inside the hero section, with the pill, the subhead, the footnote, the chips and the quadrant", async () => {
    renderLab();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveClass("mrr-hero");
    expect(hero()).toHaveAttribute("aria-labelledby", h1.id);
    expect(hero().contains(h1)).toBe(true);
    expect(within(hero()).getByText("Cycle position")).toBeInTheDocument();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("6 months in");
    expect(text(pill)).toMatch(/^\d+ months? in$/);
    expect(pill).toHaveAttribute("data-tone", "mint");
    expect(h1.parentElement?.contains(pill)).toBe(true); // beside the headline
    const h2 = within(hero()).getByRole("heading", { level: 2 });
    expect(text(h2)).toBe("Goldilocks is young by its own history.");
    expect(text(h2)).not.toMatch(/\d/);
    await waitFor(() => expect(text(hero())).toContain("2 years of monthly regime history"));
    expect(text(hero())).toMatch(/Classifier month Sep 2026 \([^)]+ old\)/);
    expect(hero().querySelectorAll("[title^='Regime:']")).toHaveLength(1);
    expect(hero().querySelectorAll("[title^='Playbook:']")).toHaveLength(1);
    const viz = hero().querySelector(".mrr-hero-viz") as HTMLElement;
    expect(viz).not.toBeNull();
    await waitFor(() => expect(viz.querySelector("svg[role='img']")).not.toBeNull());
    expect(viz.querySelectorAll("svg[role='img'] circle")).toHaveLength(13); // 12 trail + the current dot
    expect(hero().querySelector("[style*='135deg']")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByText("Reading the cycle position…")).toBeNull();
  });

  it("the lede is the whole served narrative, tidied, with strong rendered as an element and never injected", async () => {
    renderLab();
    await awaitHero();
    const lede = await waitFor(() => {
      const p = hero().querySelector(".mrr-hero-lede") as HTMLElement | null;
      expect(p).not.toBeNull();
      expect(text(p)).toBe(LEDE_TEXT);
      return p as HTMLElement;
    });
    expect(lede.tagName).toBe("P");
    expect(text(lede).startsWith(FIRST_SENTENCE)).toBe(true);
    expect(lede.querySelector("strong")).not.toBeNull();
    expect(text(lede.querySelector("strong"))).toBe("risk assets");
    expect(lede.innerHTML).not.toContain("&lt;strong&gt;");
    expect(text(lede)).not.toContain("<strong>");
    expect(text(lede)).not.toContain("—");
  });

  it("Open the playbook and Run a scenario are links to the hash routes, the primary first", async () => {
    renderLab();
    await awaitHero();
    const open = within(hero()).getByRole("link", { name: /Open the playbook/ });
    const run = within(hero()).getByRole("link", { name: /Run a scenario/ });
    expect(open).toHaveAttribute("href", "/app/regime-lab#playbook");
    expect(run).toHaveAttribute("href", "/app/regime-lab#scenarios");
    expect(open.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(open).toHaveClass("mrr-hero-btn-primary");
    expect(run).toHaveClass("mrr-hero-btn-ghost");
  });

  it("the summary dl has the ten dt labels in order with the served values", async () => {
    renderLab();
    await awaitHero();
    expect(within(summary()).getByRole("heading", { level: 2 })).toHaveTextContent("Regime odds & outlook");
    expect(summary()).toHaveClass("mrr-summary");
    await waitFor(() => expect(dts()).toEqual(LABELS));
    expect(text(ddFor("Model confidence"))).toBe("Medium (47%)");
    expect(text(ddFor("Classifier odds"))).toContain("GL 58%");
    expect(ddFor("Classifier odds").querySelector(".mrr-odds")).not.toBeNull();
    await waitFor(() => expect(text(ddFor("Spell length"))).toBe("6 months in · Early · avg spell 14.3mo"));
    await waitFor(() => expect(text(ddFor("Market read"))).toBe("Risk-On"));
    expect(ddFor("Market read").style.color).toBe("var(--pos)");
    expect(text(ddFor("Takeaway conviction"))).toBe("Medium");
    expect(ddFor("Takeaway conviction").style.color).toBe("var(--link)");
    expect(text(ddFor("Takeaway divergences"))).toBe("None flagged by the takeaway; the model-vs-market score above is the quantitative check");
    expect(ddFor("Takeaway divergences").style.color).not.toBe("var(--amber)");
    await waitFor(() => expect(text(ddFor("Model vs market"))).toBe("Aligned · +8 on ±100"));
    expect(ddFor("Model vs market").style.color).not.toBe("var(--amber)");
    // The hero never prints the classifier odds; the summary does.
    expect(text(hero())).not.toContain("GL 58%");
  });

  it("Current regime is a link to the Playbook hash", async () => {
    renderLab();
    await awaitHero();
    await waitFor(() => expect(dts()).toContain("Current regime"));
    const link = within(ddFor("Current regime")).getByRole("link", { name: "Goldilocks" });
    expect(link).toHaveAttribute("href", "/app/regime-lab#playbook");
  });

  it("Next 3 months prints the R9 form and Next 6 months uses the residual stay with the top 6-month path", async () => {
    renderLab();
    await awaitHero();
    await waitFor(() => expect(text(ddFor("Next 3 months"))).toBe("Stays Goldilocks 81% · highest-risk path → Recession Risk 12%"));
    expect(text(ddFor("Next 6 months"))).toBe("Stays Goldilocks 68% · highest-risk path → Recession Risk 19%");
  });

  it("divergences join with a middle dot in amber, and a material model-vs-market score reads amber", async () => {
    stubFetch(routes({ "/api/regime/intelligence": () => TAKEAWAY_DIVERGENT, "/api/recession/probability": () => RECESSION_DIVERGENT }));
    renderLab();
    await awaitHero();
    await waitFor(() => expect(text(ddFor("Takeaway divergences"))).toBe("Credit spreads price more stress than the classifier; watch HY · Breakevens are drifting up"));
    expect(ddFor("Takeaway divergences").style.color).toBe("var(--amber)");
    await waitFor(() => expect(text(ddFor("Model vs market"))).toBe("Diverging · -27 on ±100"));
    expect(ddFor("Model vs market").style.color).toBe("var(--amber)");
  });

  it("the How this takeaway is composed disclosure is closed, opens to the R12 sentence and its meta reads the stamp", async () => {
    renderLab();
    await awaitHero();
    const button = await within(summary()).findByRole("button", { name: /How this takeaway is composed/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("mrr-disclosure-quiet");
    expect(text(button)).toMatch(/stamped 2 hours ago$/);
    expect(text(summary())).not.toContain("Composed from the stored regime odds");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = byId(button.getAttribute("aria-controls") as string) as HTMLElement;
    expect(text(panel)).toBe(
      "Composed from the stored regime odds, credit metrics and the recession model; takeaway conviction weighs those three together, so it can read higher than the classifier's own confidence (47%), which scores only the odds gap. Takeaway stamped 2 hours ago.",
    );
    expect(within(panel).getByRole("button", { name: "conviction" })).toHaveClass("jargon");
    // The disclosure sits after the rows and before the strip.
    const dl = summary().querySelector("dl") as HTMLElement;
    expect(dl.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(await awaitStrip()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("status strip: not rising reads mint, links to #transitions and speaks the title and detail", async () => {
    renderLab();
    await awaitHero();
    const link = await awaitStrip();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/app/regime-lab#transitions");
    expect(link).toHaveAttribute("data-tone", "mint");
    expect(text(link.querySelector("b"))).toBe("Overheating odds not rising");
    expect(text(link.querySelector("small"))).toMatch(/^[−-]3 pts over the last 3 classifier months · Jun 2026 → Sep 2026$/);
    expect(link.getAttribute("aria-label")).toBe(`${text(link.querySelector("b"))}. ${text(link.querySelector("small"))}`);
    expect(summary().querySelectorAll(".mrr-status")).toHaveLength(1);
  });

  it("status strip: Overheating odds up 1 point or more read amber with the Watch title", async () => {
    stubFetch(routes({ "/api/regime/history": () => HISTORY_RISING }));
    renderLab();
    await awaitHero();
    const link = await awaitStrip();
    await waitFor(() => expect(link).toHaveAttribute("data-tone", "amber"));
    expect(text(link.querySelector("b"))).toBe("Watch · Overheating odds rising");
    expect(text(link.querySelector("small"))).toBe("Up 2 pts over the last 3 classifier months · Jun 2026 → Sep 2026");
    expect(link).toHaveAttribute("href", "/app/regime-lab#transitions");
  });

  it("status strip: gray while the classifier history loads", async () => {
    stubFetch(routes({ "/api/regime/history": () => new Promise(() => {}) }));
    renderLab();
    await awaitHero();
    const link = await awaitStrip();
    expect(link).toHaveAttribute("data-tone", "gray");
    expect(text(link.querySelector("b"))).toBe("Reading the classifier history…");
    expect(text(link.querySelector("small"))).toBe("Opens the transition outlook");
    expect(text(link)).not.toMatch(/rising/);
    // No history: the hero footnote omits the years and the chart slot shows the placeholder.
    expect(text(hero())).not.toMatch(/years of monthly regime history/);
    expect(hero().querySelector("[style*='135deg']")).not.toBeNull();
  });

  it("five tabs with the Overview panel by default", async () => {
    renderLab();
    await awaitHero();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(5);
    expect(screen.getByRole("tablist")).toHaveAttribute("aria-label", "Regime Lab views");
    // The tab text is label + hint with no separator (the asserted baseline labels).
    expect(tabs.map((t) => t.textContent)).toEqual(["Overviewlive model", "Playbookreference", "Scenariosstress rule", "History & analoguesstored + reference", "Empirical evidencebacktests"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    for (const id of ["cycle", "transitions", "regime-history-teaser"]) expect(panel.contains(byId(id)), id).toBe(true);
    expect(byId("playbook")).toBeNull();
    expect(byId("scenarios")).toBeNull();
    expect(byId("backtests")).toBeNull();
  });

  it("route #scenarios selects the Scenarios tab and renders #scenarios", async () => {
    renderLab("/app/regime-lab#scenarios");
    await awaitHero();
    expect(tab("Scenarios")).toHaveAttribute("aria-selected", "true");
    expect(tab("Overview")).toHaveAttribute("aria-selected", "false");
    expect(byId("scenarios")).not.toBeNull();
    expect(screen.getByRole("tabpanel").contains(byId("scenarios"))).toBe(true);
    expect(byId("cycle")).toBeNull();
    // The hero and summary render above the sub-tabs on every view.
    expect(byId("takeaway")).not.toBeNull();
    expect(byId("regime-outlook")).not.toBeNull();
  });

  it("clicking Playbook rewrites location.hash to #playbook and renders the Playbook panel", async () => {
    renderLab();
    await awaitHero();
    fireEvent.click(tab("Playbook"));
    expect(tab("Playbook")).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#playbook");
    expect(byId("playbook")).not.toBeNull();
    expect(byId("cycle")).toBeNull();
    await waitFor(() => expect(text(byId("playbook"))).toContain("Goldilocks description from the literature."));
    fireEvent.click(tab("History & analogues"));
    expect(window.location.hash).toBe("#analogues");
    expect(byId("analogues")).not.toBeNull();
    expect(byId("regime-history")).not.toBeNull();
    fireEvent.click(tab("Empirical evidence"));
    expect(window.location.hash).toBe("#backtests");
    expect(byId("backtests")).not.toBeNull();
    fireEvent.click(tab("Overview"));
    expect(window.location.hash).toBe("#takeaway");
    expect(byId("cycle")).not.toBeNull();
  });

  it("renders the Overview ids in document order inside main, and the DisclosureLine last", async () => {
    renderLab();
    await awaitHero();
    const els = OVERVIEW_IDS.map((id) => byId(id));
    OVERVIEW_IDS.forEach((id, i) => expect(els[i], id).not.toBeNull());
    const main = document.querySelector("main") as HTMLElement;
    for (const el of els) expect(main.contains(el)).toBe(true);
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${OVERVIEW_IDS[i - 1]} before ${OVERVIEW_IDS[i]}`).toBeTruthy();
    }
    // Section wrappers carry their ids before their data lands.
    expect((byId("cycle") as HTMLElement).tagName).toBe("SECTION");
    expect((byId("transitions") as HTMLElement).tagName).toBe("SECTION");
    const line = main.querySelector("p.mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(text(line)).toBe(DISCLOSURE_LINE);
    const all = [...main.querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(main.querySelectorAll(".mrr-disclosure-line")).toHaveLength(1);
  });

  it("duration 404 renders the error headline with the Unavailable pill while the lede and summary still render", async () => {
    stubFetch(without("/api/regime/duration"));
    renderLab();
    expect(await screen.findByText("Cycle position unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Cycle position unavailable");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const pill = hero().querySelector(".mrr-pill");
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(text(hero())).not.toMatch(/\d+ months? in/);
    expect(screen.queryByText("Reading the cycle position…")).toBeNull();
    await waitFor(() => expect(text(hero())).toContain(FIRST_SENTENCE));
    await waitFor(() => expect(text(ddFor("Spell length"))).toBe("Unavailable: the data service did not answer."));
    await waitFor(() => expect(text(ddFor("Market read"))).toBe("Risk-On"));
  });

  it("duration loading renders the reading headline and no pill", async () => {
    stubFetch(routes({ "/api/regime/duration": () => new Promise(() => {}) }));
    renderLab();
    expect(await screen.findByText("Reading the cycle position…")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Reading the cycle position…");
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    expect(text(hero())).not.toMatch(/unavailable/i);
  });

  it("takeaway 404 renders the lede error sentence while the hero and the other summary rows still render", async () => {
    stubFetch(without("/api/regime/intelligence"));
    renderLab();
    await awaitHero();
    expect(await within(hero()).findByText("Takeaway unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Early");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("6 months in");
    await waitFor(() => expect(dts()).toEqual(LABELS));
    for (const label of ["Market read", "Takeaway conviction", "Takeaway divergences"]) {
      await waitFor(() => expect(text(ddFor(label)), label).toBe("Unavailable: the data service did not answer."));
    }
    expect(within(summary()).queryByRole("button", { name: /How this takeaway is composed/ })).toBeNull();
    await waitFor(() => expect(text(ddFor("Next 3 months"))).toMatch(/^Stays Goldilocks 81%/));
  });
});
