/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.4 to B.6
 * and E.1, `screens/regimelab/OverviewTab.test.tsx`: the Overview sub-tab.
 * Cycle position (the spell tile with "{n} mo", the status badge, "Started
 * {Mon YYYY}", the meter at progress_pct / 2 with the avg tick and the R17
 * caption; the late-cycle rows with ordinals and the 40 / 70 tones),
 * Transition outlook (stays row first, the "→" rows, no "vs 3 mo ago", the
 * exits tile counted over the stored labels with the open spell excluded) and
 * the regime-history ribbon teaser with its link. Rendered prop-less: the tab
 * owns its hooks (React Query dedupes the keys the screen also reads).
 * Fixtures are dated Sep 2026 with invented numbers.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor, within } from "@testing-library/react";
import OverviewTab from "./OverviewTab";
import type { Regime, RegimeDuration, RegimeLabel, TransitionOutlook } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LATEST = "2026-09-01";
const LABEL: Record<string, RegimeLabel> = { G: "Goldilocks", O: "Overheating", S: "Stagflation", R: "Recession Risk" };
/** Aug 2024 to Sep 2026: three completed Goldilocks spells (two into
 * Overheating, one into Stagflation), the open one six months old. */
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

function history(spec = SPELLS): Regime[] {
  const labels = spec.replace(/\s+/g, "").split("").map((c) => LABEL[c]);
  const dates = monthsEnding(labels.length);
  const n = labels.length;
  return labels.map((label, i) => ({
    date: dates[i],
    label,
    confidence: 0.47,
    growth_trend: ((i % 7) - 3) / 4,
    inflation_trend: ((i % 5) - 2) / 4,
    prob_goldilocks: 0.58,
    prob_overheating: i === n - 4 ? 0.1 : 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
    ...(i === n - 1 ? REGIME : {}),
  }));
}
const HISTORY = history();
const SINGLE_SPELL = history("GGGGGGGGGGGGGG");

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

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
function routes(over: Routes = {}): Routes {
  return {
    "/api/regime/latest": () => REGIME,
    "/api/regime/history": () => HISTORY,
    "/api/regime/duration": () => DURATION,
    "/api/regime/transitions": () => TRANSITIONS,
    ...over,
  };
}
const PENDING = () => new Promise(() => {});

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
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
/** Top-level `Card variant="tile"` surfaces inside a section (inline `background: var(--tile)`). */
function tiles(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[style*='var(--tile)']")].filter((el) => !el.parentElement?.closest("[style*='var(--tile)']"));
}
const tileOf = (el: Element) => el.closest("[style*='var(--tile)']") as HTMLElement;
const fillOf = (root: ParentNode) => root.querySelector<HTMLElement>("[style*='scaleX']");
const meterRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".mrr-meter-row")];
const rowLabel = (row: HTMLElement) => text(row.firstElementChild);
const rowValue = (row: HTMLElement) => text(row.querySelector(".num"));

beforeEach(() => {
  stubFetch(routes());
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("OverviewTab (checklist 04 B.4 to B.6)", () => {
  it("cycle tile: {n} mo, the status badge, Started {Mon YYYY}, the meter at progress_pct / 2 with the tick and scale words, the R17 caption", async () => {
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const cycle = await awaitSection("cycle");
    expect(cycle.tagName).toBe("SECTION");
    expect(within(cycle).getByRole("heading", { level: 2 })).toHaveTextContent(/^Cycle position$/);
    expect(text(cycle)).toContain("Spell length vs 30 years of stored history");
    expect(text(cycle)).toContain("Live model output");
    await waitFor(() => expect(text(cycle)).toContain("6 mo"));
    const [spell] = tiles(cycle);
    expect(spell).toBeDefined();
    expect(text(spell.querySelector(".num"))).toBe("6 mo");
    const badge = within(spell).getByText("Early").closest("[data-tone]") as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge).toHaveAttribute("data-tone", "clear");
    await waitFor(() => expect(text(spell)).toContain("Started Apr 2026"));
    const fill = fillOf(spell) as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.transform).toBe("scaleX(0.21)"); // 42 / 2
    expect(css(fill)).toMatch(/linear-gradient\(90deg, ?rgba\(38, ?220, ?160, ?0?\.4\)/);
    const tick = spell.querySelector("i[aria-hidden='true']") as HTMLElement;
    expect(tick).not.toBeNull();
    expect(tick.style.left).toBe("50%");
    expect(within(spell).getByText("0")).toBeInTheDocument();
    expect(within(spell).getByText("avg 14.3 mo")).toBeInTheDocument();
    expect(within(spell).getByText("2× avg")).toBeInTheDocument();
    expect(text(spell)).toContain("Goldilocks has run 6 months, longer than 38% of past Goldilocks spells, which average 14.3 months. Early means the regime is young by its own history.");
    expect(text(spell)).not.toContain("14mo");
  });

  it("late-cycle tile: three ordinal rows toned by the 40 / 70 bands, the meta and the R18 caption, no delta column", async () => {
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const cycle = await awaitSection("cycle");
    await waitFor(() => expect(text(cycle)).toContain("6 mo"));
    const heading = within(cycle).getByRole("heading", { level: 3, name: "Late-cycle risk indicators" });
    const late = tileOf(heading);
    expect(late).not.toBeNull();
    expect(text(late)).toContain("Percentile vs history");
    const rows = meterRows(late);
    expect(rows).toHaveLength(3);
    expect(rows.map(rowLabel)).toEqual(["Momentum", "Valuation stretch", "Complacency"]);
    expect(rows.map(rowValue)).toEqual(["58th", "71st", "23rd"]);
    expect(css(fillOf(rows[0]))).toMatch(/background(?:-color)?:\s*var\(--amber\)/); // 40 to 70: watch
    expect(css(fillOf(rows[1]))).toMatch(/background(?:-color)?:\s*var\(--neg\)/); // 70 and up: alert
    expect(css(fillOf(rows[2]))).toMatch(/background(?:-color)?:\s*var\(--pos\)/); // under 40
    expect(fillOf(rows[0])?.style.transform).toBe("scaleX(0.58)");
    for (const r of rows) expect(r.style.gridTemplateColumns.split(" ")).toHaveLength(3); // no delta track
    expect(text(late)).toContain("Percentile ranks, higher = more late-cycle risk: momentum is SPY's 20-day run vs its last 252 sessions; valuation stretch and complacency invert the HY-spread and VIX percentiles over the full stored history (tight spreads and a sleepy VIX rank high).");
    expect(text(cycle)).not.toMatch(/warn-hot/);
  });

  it("transitions: the stays row first with the regime swatch, three arrow rows, the 6-month residual, both captions, no vs 3 mo ago", async () => {
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const section = await awaitSection("transitions");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Transition outlook$/);
    expect(text(section)).toContain("30 years of monthly regime history");
    expect(text(section)).toContain("Stored empirical analysis");
    await waitFor(() => expect(text(section)).toContain("stays Goldilocks"));
    const three = tileOf(within(section).getByRole("heading", { level: 3, name: "Next 3 months" }));
    const six = tileOf(within(section).getByRole("heading", { level: 3, name: "Next 6 months" }));
    const rows3 = meterRows(three);
    expect(rows3.map(rowLabel)).toEqual(["stays Goldilocks", "→ Recession Risk", "→ Overheating", "→ Stagflation"]);
    expect(rows3.map(rowValue)).toEqual(["81%", "12%", "5%", "2%"]);
    expect(fillOf(rows3[0])?.style.transform).toBe("scaleX(0.81)");
    expect(rows3[0].querySelector("i[style*='--r-goldilocks']")).not.toBeNull();
    expect(rows3[1].querySelector("i[style*='--r-recession']")).not.toBeNull();
    expect(css(fillOf(rows3[0]))).toMatch(/var\(--r-goldilocks\)/);
    expect(css(fillOf(rows3[1]))).toMatch(/var\(--r-recession\)/);
    expect(text(three)).toContain("Goldilocks has held for three months in 81% of past cases.");
    const rows6 = meterRows(six);
    expect(rows6.map(rowLabel)).toEqual(["stays Goldilocks", "→ Recession Risk", "→ Overheating", "→ Stagflation"]);
    expect(rows6.map(rowValue)).toEqual(["68%", "19%", "9%", "4%"]); // 100 - (19 + 9 + 4)
    expect(text(six)).toContain("Over six months the hold rate falls as spells age. Highest-risk path: → Recession Risk at 12%. Odds are counted month-over-month from the stored classifier history: a transition matrix, not a forecast model.");
    expect(within(six).getByRole("button", { name: "transition matrix" })).toHaveClass("jargon");
    expect(text(section)).not.toMatch(/vs 3 mo ago/i);
    expect(section.querySelectorAll(".mrr-meter-row [style*='58px']")).toHaveLength(0);
    // Served colours never paint the rows.
    expect(section.innerHTML).not.toMatch(/#95a5a6/i);
  });

  it("exits tile: counts per successor from the stored labels with the open spell excluded, sorted, plus the base-rate caption", async () => {
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const section = await awaitSection("transitions");
    const heading = await within(section).findByRole("heading", { level: 3, name: "How past Goldilocks spells ended" });
    const exits = tileOf(heading);
    await waitFor(() => expect(text(exits)).toContain("completed spells"));
    const t = text(exits);
    expect(t).toMatch(/2\s*into Overheating/);
    expect(t).toMatch(/1\s*into Stagflation/);
    expect(t).not.toMatch(/into Recession Risk/);
    expect(t).not.toMatch(/into Goldilocks/);
    expect(t.indexOf("into Overheating")).toBeLessThan(t.indexOf("into Stagflation"));
    expect(t).toContain("3 completed spells since Aug 2024. Small sample; read as base rates, not a forecast.");
    const overheating = [...exits.querySelectorAll("b")].find((b) => text(b) === "Overheating") as HTMLElement;
    expect(overheating).toBeDefined();
    expect(overheating.style.color).toBe("var(--r-overheating)");
    expect(tiles(section)).toHaveLength(3);
  });

  it("a record with a single open spell reads No completed spells on file yet", async () => {
    stubFetch(routes({ "/api/regime/history": () => SINGLE_SPELL }));
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const section = await awaitSection("transitions");
    expect(await within(section).findByText("No completed Goldilocks spells on file yet.")).toBeInTheDocument();
    expect(text(section)).not.toMatch(/\d+\s*into /);
  });

  it("teaser: the ribbon SVG with four tracks plus one span per segment, the legend and the link to #regime-history", async () => {
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const teaser = await awaitSection("regime-history-teaser");
    expect(teaser.tagName).toBe("SECTION");
    expect(within(teaser).getByRole("heading", { level: 2 })).toHaveTextContent(/^Regime history$/);
    expect(text(teaser)).toContain("The classifier's full monthly record");
    const link = within(teaser).getByRole("link", { name: /History & analogues/ });
    expect(link).toHaveAttribute("href", "/app/regime-lab#regime-history");
    expect(link).toHaveClass("mrr-link");
    const svg = await waitFor(() => {
      const el = teaser.querySelector("svg[role='img']");
      expect(el).not.toBeNull();
      return el as SVGSVGElement;
    });
    expect(svg).toHaveAttribute("aria-label", "Regime history ribbon, Aug 2024 to Sep 2026");
    expect(svg.querySelectorAll("rect")).toHaveLength(4 + 8);
    expect(svg.querySelectorAll("rect title")).toHaveLength(8);
    // Legend: the four names with a swatch each, in house order.
    const header = teaser.querySelector(".mrr-sec-head") as HTMLElement;
    const legend = text(header);
    for (const name of ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"]) expect(legend).toContain(name);
    expect(legend.indexOf("Goldilocks")).toBeLessThan(legend.indexOf("Recession Risk"));
    expect(header.querySelectorAll("i[style*='--r-']").length).toBeGreaterThanOrEqual(4);
    expect(byId("regime-history")).toBeNull(); // the full ribbon lives on the History sub-tab
  });

  it("loading: each tile prints the reading note while its hook is pending", async () => {
    stubFetch(routes({ "/api/regime/duration": PENDING, "/api/regime/transitions": PENDING, "/api/regime/history": PENDING }));
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const cycle = await awaitSection("cycle");
    const transitions = await awaitSection("transitions");
    const teaser = await awaitSection("regime-history-teaser");
    await waitFor(() => expect(within(cycle).getAllByText("Reading stored data…").length).toBeGreaterThan(0));
    expect(within(transitions).getAllByText("Reading stored data…").length).toBeGreaterThanOrEqual(2); // the odds tiles and the exits tile follow their own hooks
    expect(within(teaser).getByText("Reading stored data…")).toBeInTheDocument();
    expect(text(cycle)).not.toMatch(/\b\d+ mo\b/);
    expect(text(transitions)).not.toContain("stays");
  });

  it("error per hook: duration 404 fails the cycle tiles, transitions 404 fails the odds tiles while the exits tile still counts, history 404 fails the exits tile and the teaser", async () => {
    stubFetch(routes({ "/api/regime/duration": () => ({ status: 404, body: { detail: "Not Found" } }) }));
    const first = renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const cycle = await awaitSection("cycle");
    expect(await within(cycle).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(text(cycle)).not.toContain("6 mo");
    expect(text(cycle)).not.toContain("Late-cycle");
    expect(tiles(cycle)).toHaveLength(1);
    await waitFor(() => expect(text(byId("transitions"))).toMatch(/2\s*into Overheating/));
    first.unmount();

    stubFetch(routes({ "/api/regime/transitions": () => ({ status: 500, body: { detail: "down" } }) }));
    const second = renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const transitions = await awaitSection("transitions");
    expect(await within(transitions).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(text(transitions)).not.toContain("stays");
    await waitFor(() => expect(text(transitions)).toMatch(/2\s*into Overheating/));
    expect(within(transitions).getByRole("heading", { level: 3, name: "How past Goldilocks spells ended" })).toBeInTheDocument();
    second.unmount();

    stubFetch(routes({ "/api/regime/history": () => ({ status: 404, body: { detail: "Not Found" } }) }));
    renderWithProviders(<OverviewTab />, { route: "/app/regime-lab" });
    const t2 = await awaitSection("transitions");
    const teaser = await awaitSection("regime-history-teaser");
    expect(await within(teaser).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(teaser.querySelector('svg[role="img"]')).toBeNull();
    const exits = tileOf(await within(t2).findByRole("heading", { level: 3, name: "How past Goldilocks spells ended" }));
    await waitFor(() => expect(text(exits)).toContain("Unavailable: the data service did not answer."));
    expect(text(exits)).not.toMatch(/into /);
    await waitFor(() => expect(text(t2)).toContain("stays Goldilocks")); // the odds tiles still render
    await waitFor(() => expect(text(byId("cycle"))).toContain("6 mo"));
    expect(text(byId("cycle"))).not.toContain("Started");
  });
});
