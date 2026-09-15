/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.7 and
 * E.1, `screens/regimelab/PlaybookTab.test.tsx`: the Playbook sub-tab on
 * Phase 2 components. A mono Segmented "Playbook regime" with the current
 * regime pressed and suffixed " ← now", the description tile with its two
 * corrected notes and the asset DataTable, the sector tilts as MeterRows under
 * overweight / underweight labels, the four risk groups capped at three items.
 * Rendered prop-less: the tab owns its hooks. Fixtures dated Sep 2026.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import PlaybookTab from "./PlaybookTab";
import type { Regime, RegimeLabel, RegimePlaybook } from "../../api/types";
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

const REGIMES: RegimeLabel[] = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];

function playbook(regime: RegimeLabel, over: Partial<RegimePlaybook> = {}): RegimePlaybook {
  return {
    regime,
    regime_color: "#2ecc71",
    description: `${regime} description from the literature — growth steady, inflation calm.`,
    historical_frequency: 22.4,
    avg_duration_months: 18,
    sector_tilts: {
      overweight: [
        { sector: "Technology", strength: 72 },
        { sector: "Consumer discretionary", strength: 55 },
      ],
      underweight: [{ sector: "Utilities", strength: 48 }],
    },
    asset_performance: {
      "US equities": { avg_return: 8.2, hit_rate: 71 },
      "10Y Treasuries": { avg_return: -1.4, hit_rate: 44 },
      Gold: { avg_return: 3, hit_rate: 52 },
    },
    typical_indicators: { yield_curve: "Steepening", credit_spreads: "Tight", vix_regime: "Low" },
    key_risks: ["Risk one", "Risk two", "Risk three", "Risk four"],
    warning_signs: ["Warning one", "Warning two", "Warning three", "Warning four"],
    typical_catalysts: ["Catalyst one", "Catalyst two"],
    opportunities: ["Opportunity one", "Opportunity two", "Opportunity three", "Opportunity four"],
    ...over,
  };
}
const PLAYBOOKS: Record<string, RegimePlaybook> = {
  Goldilocks: playbook("Goldilocks"),
  Overheating: playbook("Overheating", {
    description: "Overheating description from the literature.",
    historical_frequency: 17.9,
    avg_duration_months: 9.5,
    sector_tilts: {
      overweight: [
        { sector: "Energy", strength: 81 },
        { sector: "Materials", strength: 64 },
      ],
      underweight: [
        { sector: "Utilities", strength: 58 },
        { sector: "Real estate", strength: 40 },
      ],
    },
    typical_indicators: { yield_curve: "Flattening", credit_spreads: "Normal", vix_regime: "Rising" },
  }),
  Stagflation: playbook("Stagflation", { description: "Stagflation description from the literature." }),
  "Recession Risk": playbook("Recession Risk", { description: "Recession Risk description from the literature." }),
};

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
function routes(over: Routes = {}): Routes {
  return { "/api/regime/latest": () => REGIME, "/api/regime/playbooks": () => PLAYBOOKS, ...over };
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
const group = () => screen.getByRole("group", { name: "Playbook regime" });
const option = (name: string) => within(group()).getByRole("button", { name });
const tileOf = (el: Element) => el.closest("[style*='var(--tile)']") as HTMLElement;
const meterRows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(".mrr-meter-row")];
const rowLabel = (row: HTMLElement) => text(row.firstElementChild);
const rowValue = (row: HTMLElement) => text(row.querySelector(".num"));

async function renderPlaybook(): Promise<HTMLElement> {
  renderWithProviders(<PlaybookTab />, { route: "/app/regime-lab#playbook" });
  await waitFor(() => expect(byId("playbook")).not.toBeNull());
  const section = byId("playbook") as HTMLElement;
  await waitFor(() => expect(text(section)).toContain("description from the literature"));
  return section;
}

beforeEach(() => {
  stubFetch(routes());
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("PlaybookTab (checklist 04 B.7)", () => {
  it("the current regime is pressed on load with the ← now suffix; the header carries the title and the reference meta", async () => {
    const section = await renderPlaybook();
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Playbook$/);
    expect(text(section)).toContain("Static reference · regime literature, not live data");
    const buttons = within(group()).getAllByRole("button");
    expect(buttons.map((b) => text(b))).toEqual(["Goldilocks ← now", "Overheating", "Stagflation", "Recession Risk"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    expect(group()).toHaveAttribute("data-mono", "true");
    expect(text(section)).toContain("Goldilocks description from the literature; growth steady, inflation calm.");
    expect(text(section)).not.toContain("—");
  });

  it("pressing another option swaps the description, the notes and the tilt rows", async () => {
    const section = await renderPlaybook();
    fireEvent.click(option("Overheating"));
    expect(option("Overheating")).toHaveAttribute("aria-pressed", "true");
    expect(option("Goldilocks ← now")).toHaveAttribute("aria-pressed", "false");
    expect(within(group()).getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") === "true")).toHaveLength(1);
    expect(text(section)).toContain("Overheating description from the literature.");
    expect(text(section)).not.toContain("Goldilocks description");
    expect(text(section)).toContain("~18% of months in the literature · literature avg spell 9.5mo");
    const tilts = tileOf(within(section).getByRole("heading", { level: 3, name: "Sector tilts · strength 0–100" }));
    await waitFor(() => expect(meterRows(tilts).map(rowLabel)).toEqual(["Energy", "Materials", "Utilities", "Real estate"]));
    expect(meterRows(tilts).map(rowValue)).toEqual(["81", "64", "58", "40"]);
    // The " ← now" suffix stays on the classifier's call, not on the pressed option.
    expect(text(option("Goldilocks ← now"))).toBe("Goldilocks ← now");
    fireEvent.click(option("Goldilocks ← now"));
    expect(option("Goldilocks ← now")).toHaveAttribute("aria-pressed", "true");
    expect(text(section)).toContain("Goldilocks description from the literature");
  });

  it("sector tilts: overweight then underweight group labels over MeterRows with the strength as value and the R27 caption", async () => {
    const section = await renderPlaybook();
    const heading = within(section).getByRole("heading", { level: 3, name: "Sector tilts · strength 0–100" });
    const tilts = tileOf(heading);
    const over = within(tilts).getByText(/^overweight$/i);
    const under = within(tilts).getByText(/^underweight$/i);
    expect(over.style.textTransform).toBe("uppercase");
    expect(over.style.color).toBe("var(--pos)");
    expect(under.style.color).toBe("var(--neg)");
    expect(over.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = meterRows(tilts);
    expect(rows.map(rowLabel)).toEqual(["Technology", "Consumer discretionary", "Utilities"]);
    expect(rows.map(rowValue)).toEqual(["72", "55", "48"]);
    expect(rows[0].querySelector<HTMLElement>("[style*='scaleX']")?.style.transform).toBe("scaleX(0.72)");
    expect(css(rows[0].querySelector("[style*='scaleX']"))).toMatch(/background(?:-color)?:\s*var\(--pos\)/);
    expect(css(rows[2].querySelector("[style*='scaleX']"))).toMatch(/background(?:-color)?:\s*var\(--neg\)/);
    expect(over.compareDocumentPosition(rows[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rows[1].compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text(tilts)).toContain("Tilt strength runs 0–100: conviction of the tilt in this playbook, not a return forecast.");
  });

  it("the asset table renders th Asset / Avg return / Hit rate and one row per asset with the signed return and the hit rate", async () => {
    const section = await renderPlaybook();
    const table = within(section).getByRole("table", { name: "Asset performance in this regime" });
    expect(within(table).getAllByRole("columnheader").map((h) => text(h))).toEqual(["Asset", "Avg return", "Hit rate"]);
    const rows = [...(table.querySelector("tbody")?.querySelectorAll("tr") ?? [])];
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => text(r))).toEqual(["US equities+8.2%/yr71% hit", "10Y Treasuries-1.4%/yr44% hit", "Gold+3.0%/yr52% hit"]);
    expect(within(rows[0]).getByText("+8.2%/yr").style.color).toBe("var(--pos)");
    expect(within(rows[1]).getByText("-1.4%/yr").style.color).toBe("var(--neg)");
    expect(within(table).getByText("+8.2%/yr").closest("td")?.getAttribute("style")).toMatch(/var\(--font-mono\)/);
  });

  it("the four risk groups render their labels and at most three items each", async () => {
    const section = await renderPlaybook();
    const risks = tileOf(within(section).getByRole("heading", { level: 3, name: "Risks & catalysts" }));
    const labels = ["Key risks", "Warning signs", "Typical catalysts", "Opportunities"].map((l) => within(risks).getByText(l));
    for (const l of labels) expect(l.style.textTransform).toBe("uppercase");
    expect(labels[0].style.color).toBe("var(--neg)");
    expect(labels[1].style.color).toBe("var(--amber)");
    expect(labels[2].style.color).toBe("var(--link)");
    expect(labels[3].style.color).toBe("var(--pos)");
    const t = text(risks);
    for (const item of ["Risk one", "Risk two", "Risk three", "Warning three", "Catalyst one", "Catalyst two", "Opportunity three"]) expect(t).toContain(`· ${item}`);
    for (const item of ["Risk four", "Warning four", "Opportunity four"]) expect(t).not.toContain(item);
    expect(t).not.toMatch(/accent/);
  });

  it("the two corrected notes point at the Overview and the Empirical evidence view", async () => {
    const section = await renderPlaybook();
    const t = text(section);
    expect(t).toContain("~22% of months in the literature · literature avg spell 18.0mo; the measured number lives in Cycle position on the Overview");
    expect(t).toContain("Typical tape: curve steepening, spreads tight, VIX low. Reference numbers from the regime literature; the Empirical evidence view is what this app measured itself.");
    expect(t).not.toMatch(/Cycle position below/);
    expect(t).not.toMatch(/backtests section below/);
  });

  it("loading and error render the StateNote in one tile; the selector still renders", async () => {
    stubFetch(routes({ "/api/regime/playbooks": () => new Promise(() => {}) }));
    const pending = renderWithProviders(<PlaybookTab />, { route: "/app/regime-lab#playbook" });
    await waitFor(() => expect(byId("playbook")).not.toBeNull());
    expect(await within(byId("playbook") as HTMLElement).findByText("Reading stored data…")).toBeInTheDocument();
    expect(within(group()).getAllByRole("button")).toHaveLength(4);
    pending.unmount();

    stubFetch(routes({ "/api/regime/playbooks": () => ({ status: 500, body: { detail: "down" } }) }));
    renderWithProviders(<PlaybookTab />, { route: "/app/regime-lab#playbook" });
    await waitFor(() => expect(byId("playbook")).not.toBeNull());
    expect(await within(byId("playbook") as HTMLElement).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(text(byId("playbook"))).not.toContain("description from the literature");
  });

  it("without a served regime the selector defaults to Goldilocks with no ← now suffix", async () => {
    stubFetch(routes({ "/api/regime/latest": () => ({ status: 404, body: { detail: "Not Found" } }) }));
    await renderPlaybook();
    expect(within(group()).getAllByRole("button").map((b) => text(b))).toEqual(REGIMES);
    expect(option("Goldilocks")).toHaveAttribute("aria-pressed", "true");
  });
});
