/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) B.9 and
 * E.1, `screens/regimelab/HistoryTab.test.tsx`: the History & analogues
 * sub-tab. Four analogue tiles (period, regime tag, "/100 match", what
 * happened, "resolved →", "lesson for today") with the count-honest caption,
 * then the full-size ribbon `#regime-history` whose header meta counts the
 * calls, the span and the switches in the last 12 months. Rendered prop-less:
 * the tab owns its hooks. The 26-month history fixture ends Sep 2026.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor, within } from "@testing-library/react";
import HistoryTab from "./HistoryTab";
import type { Analogue, Regime, RegimeLabel } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LATEST = "2026-09-01";
const LABEL: Record<string, RegimeLabel> = { G: "Goldilocks", O: "Overheating", S: "Stagflation", R: "Recession Risk" };
/** Aug 2024 to Sep 2026: eight merged segments, one switch in the last 12 rows. */
const SPELLS = "GG OO GGG SS GG OOO RRRRRR GGGGGG";

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
  return labels.map((label, i) => ({
    date: dates[i],
    label,
    confidence: 0.47,
    growth_trend: ((i % 7) - 3) / 4,
    inflation_trend: ((i % 5) - 2) / 4,
    prob_goldilocks: 0.58,
    prob_overheating: 0.07,
    prob_stagflation: 0.04,
    prob_recession: 0.31,
  }));
}
const HISTORY = history();
/** Three switches inside the last 12 rows. */
const CHOPPY = history("GGGGGGGGGGGGGG GGG OO SS GG");

function analogue(period: string, regime: string, score: number, next: string): Analogue {
  return {
    period,
    period_end: "2019-03-31",
    regime,
    similarity_score: score,
    similarity_color: "#2ecc71",
    hy_spread_pct: 12,
    recession_prob: 9.5,
    what_happened: `${period}: a calm tape with spreads near their lows.`,
    time_to_change: "7 months",
    next_regime: next,
    key_drivers: ["Easy policy"],
    market_impact: { SPY: "+12%" },
    lessons_for_today: `${period}: stay long while spreads hold.`,
    resolution: `Rolled into ${next}.`,
  };
}
const ANALOGUES: Analogue[] = [
  analogue("Q1 2019", "Goldilocks", 82, "Overheating"),
  analogue("H2 2017", "Overheating", 74, "Goldilocks"),
  analogue("2004 to 2005", "Overheating", 69, "Goldilocks"),
  analogue("Mid 1990s", "Goldilocks", 61, "Overheating"),
];

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
function routes(over: Routes = {}): Routes {
  return { "/api/regime/history": () => HISTORY, "/api/regime/analogues": () => ANALOGUES, ...over };
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
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
/** Top-level `Card variant="tile"` surfaces inside a section. */
function tiles(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[style*='var(--tile)']")].filter((el) => !el.parentElement?.closest("[style*='var(--tile)']"));
}

beforeEach(() => {
  stubFetch(routes());
});

afterEach(() => {
  window.history.replaceState(null, "", window.location.pathname);
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("HistoryTab (checklist 04 B.9)", () => {
  it("four analogue tiles carry the period, the regime tag, the match score, the resolution line and the lesson", async () => {
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#analogues" });
    const section = await awaitSection("analogues");
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Historical analogues$/);
    expect(text(section)).toContain("Historical analogy · 7-period reference corpus");
    await waitFor(() => expect(tiles(section)).toHaveLength(4));
    const cards = tiles(section);
    ANALOGUES.forEach((an, i) => {
      const card = cards[i];
      const t = text(card);
      expect(t, an.period).toContain(an.period);
      const tag = [...card.querySelectorAll("[data-tone]")].find((el) => text(el) === an.regime) as HTMLElement;
      expect(tag, `${an.period} regime tag`).toBeDefined();
      expect(tag).toHaveAttribute("data-tone", "reference");
      expect(t).toContain(`${an.similarity_score}/100 match`);
      expect(t).toContain(an.what_happened);
      expect(t).toContain(`resolved → ${an.next_regime} after 7 months`);
      expect(within(card).getByText(/^lesson for today$/i).style.textTransform).toBe("uppercase");
      expect(within(card).getByText(/^lesson for today$/i).style.color).toBe("var(--link)");
      expect(t).toContain(an.lessons_for_today);
    });
    // The served similarity colour never paints anything.
    expect(section.innerHTML).not.toMatch(/#2ecc71/i);
  });

  it("the caption reads Four closest for four served analogues and the served count otherwise", async () => {
    const four = renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#analogues" });
    const section = await awaitSection("analogues");
    await waitFor(() =>
      expect(text(section)).toContain(
        "Similarity scores regime match (40), HY-spread percentile proximity (25), recession-odds proximity (20) and VIX proximity (15) against today's stored readings. Four closest of seven studied periods: a study aid, not a prediction.",
      ),
    );
    four.unmount();

    stubFetch(routes({ "/api/regime/analogues": () => ANALOGUES.slice(0, 3) }));
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#analogues" });
    const three = await awaitSection("analogues");
    await waitFor(() => expect(tiles(three)).toHaveLength(3));
    expect(text(three)).toContain("3 closest of seven studied periods: a study aid, not a prediction.");
    expect(text(three)).not.toContain("Four closest");
  });

  it("#regime-history: the header meta counts the calls, the span and the switches in the last 12 months, and the full ribbon renders with its caption", async () => {
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#regime-history" });
    const section = await awaitSection("regime-history");
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/^Regime history$/);
    await waitFor(() => expect(text(section)).toContain("26 monthly calls · Aug 2024 → Sep 2026 · 1 switch in the last 12mo"));
    const svg = section.querySelector("svg[role='img']") as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-label", "Regime history Gantt: one lane per regime, colored spans mark the months the classifier called it");
    expect(svg.querySelectorAll("rect").length).toBeGreaterThan(4);
    expect(svg.querySelectorAll("rect title")).toHaveLength(8);
    expect(text(section)).toContain("Every monthly call the classifier has made, one lane per regime; hover a span for its dates. Long unbroken bands are stable macro; rapid lane-hopping marks the turns. The last 12 months saw 1 regime switch.");
    expect(byId("regime-history-teaser")).toBeNull();
    // The order on the sub-tab: analogues first, then the full ribbon.
    expect((byId("analogues") as HTMLElement).compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the switch count pluralises: three switches in the last 12 rows", async () => {
    stubFetch(routes({ "/api/regime/history": () => CHOPPY }));
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#regime-history" });
    const section = await awaitSection("regime-history");
    await waitFor(() => expect(text(section)).toContain("23 monthly calls · Nov 2024 → Sep 2026 · 3 switches in the last 12mo"));
    expect(text(section)).toContain("The last 12 months saw 3 regime switches.");
  });

  it("loading: both sections print the reading note; the history header keeps the live-model meta", async () => {
    stubFetch(routes({ "/api/regime/history": () => new Promise(() => {}), "/api/regime/analogues": () => new Promise(() => {}) }));
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#analogues" });
    const analogues = await awaitSection("analogues");
    const ribbon = await awaitSection("regime-history");
    expect(await within(analogues).findByText("Reading stored data…")).toBeInTheDocument();
    expect(await within(ribbon).findByText("Reading stored data…")).toBeInTheDocument();
    expect(text(ribbon)).toContain("Live model output · the classifier's full record");
    expect(ribbon.querySelector("svg")).toBeNull();
  });

  it("error: each section prints the unavailable note for its own hook", async () => {
    stubFetch(routes({ "/api/regime/analogues": () => ({ status: 500, body: { detail: "down" } }) }));
    const first = renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#analogues" });
    const analogues = await awaitSection("analogues");
    expect(await within(analogues).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(text(analogues)).not.toContain("/100 match");
    await waitFor(() => expect((byId("regime-history") as HTMLElement).querySelector("svg[role='img']")).not.toBeNull());
    first.unmount();

    stubFetch(routes({ "/api/regime/history": () => ({ status: 404, body: { detail: "Not Found" } }) }));
    renderWithProviders(<HistoryTab />, { route: "/app/regime-lab#regime-history" });
    const ribbon = await awaitSection("regime-history");
    expect(await within(ribbon).findByText("Unavailable: the data service did not answer.")).toBeInTheDocument();
    expect(ribbon.querySelector("svg")).toBeNull();
    expect(text(ribbon)).not.toContain("monthly calls");
    await waitFor(() => expect(text(byId("analogues"))).toContain("82/100 match"));
  });
});
