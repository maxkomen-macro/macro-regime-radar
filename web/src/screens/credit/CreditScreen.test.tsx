/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) section E.1,
 * `screens/credit/CreditScreen.test.tsx`: the rebuilt Credit screen
 * (composition B.0, hero B.1 and its OAS chart B.1.1, summary and strip B.2,
 * the four panels B.3 to B.7 rendered for real, the disclosure line B.8, the
 * states B.10, copy C.2, ids D). renderWithProviders + stubFetch with a
 * fixture per route the page reads (`/api/credit/metrics`,
 * `/api/lbo/defaults`; unmatched paths 404 so error branches are real).
 * `SpreadLinesChart` is mocked the way ChartPanel.test.tsx mocks CandleChart
 * (jsdom has no canvas): the mock exposes the aria-label, the series labels
 * and the plotted point count. The clock is frozen (only `Date`) so the
 * freshness dot never depends on when the suite runs. Fixtures are invented
 * spreads dated Sep 2026 with a generated monthly history back to Dec 1996;
 * the assertions are the copy rules, never the mockup's or baseline figures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import CreditScreen from "./CreditScreen";
import type { SpreadLinesChartProps } from "./SpreadLinesChart";
import type { CreditMetrics, DatedValue, LboDefaults } from "../../api/types";
import { makeClient, renderWithProviders, stubFetch } from "../../test/utils";

/* ── mocks ───────────────────────────────────────────────────────────────── */

vi.mock("./SpreadLinesChart", () => ({
  default: (p: SpreadLinesChartProps) => <div role="img" aria-label={p.ariaLabel} data-series={p.series.map((s) => s.label).join(",")} data-points={p.series[0]?.points.length} />,
}));

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Saturday Sep 19 2026: the Sep 01 monthly stamp is 18 days old, inside the 45-day "current" limit. */
const NOW = new Date("2026-09-19T15:00:00Z");
const NOW_MS = NOW.getTime();
const FIRST = "1996-12-01";
const LAST = "2026-09-01";
const DASH = "—";

/** Every month from `from` to `to` inclusive as ISO first-of-month dates. */
function monthsBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  for (let idx = fy * 12 + (fm - 1); idx <= ty * 12 + (tm - 1); idx++) out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`);
  return out;
}
function months(n: number, last = LAST): string[] {
  const all = monthsBetween("1990-01-01", last);
  return all.slice(all.length - n);
}
const series = (dates: string[], base: number, step: number): DatedValue[] => dates.map((date, i) => ({ date, value: base + i * step }));

/** The full served history (Dec 1996 to Sep 2026, 358 points) with the extremes planted on known months:
 * HY high 1985 in Nov 2008 (all time) and 1080 in Mar 2020 (inside the ten-year window);
 * IG low 55 in Jun 1997 (all time) and 83 in Jun 2021 (inside the window). The last points equal the served levels. */
const ALL_DATES = monthsBetween(FIRST, LAST);
const HY_ALL: DatedValue[] = ALL_DATES.map((date, i) => ({ date, value: 400 + (i % 7) * 3 }));
const IG_ALL: DatedValue[] = ALL_DATES.map((date, i) => ({ date, value: 130 + (i % 5) * 2 }));
const plant = (s: DatedValue[], date: string, value: number) => {
  const p = s.find((q) => q.date === date);
  if (p) p.value = value;
};
plant(HY_ALL, "2008-11-01", 1985);
plant(HY_ALL, "2020-03-01", 1080);
plant(HY_ALL, LAST, 312);
plant(IG_ALL, "1997-06-01", 55);
plant(IG_ALL, "2021-06-01", 83);
plant(IG_ALL, LAST, 94);

const row = (n: number, t: number, s: number, c: number) => ({ Normal: n, Tight: t, Stressed: s, Crisis: c });
const T3: Record<string, Record<string, number>> = { Normal: row(0.8123, 0, 0.1544, 0.0333), Tight: row(0, 0, 0, 0), Stressed: row(0.2883, 0, 0.5833, 0.1284), Crisis: row(0.04, 0, 0.36, 0.6) };
const T6: Record<string, Record<string, number>> = { Normal: row(0.7211, 0, 0.2277, 0.0512), Tight: row(0, 0, 0, 0), Stressed: row(0.4583, 0, 0.375, 0.1667), Crisis: row(0.12, 0, 0.44, 0.44) };
const T3_TIGHT = { ...T3, Tight: row(0.6667, 0.3333, 0, 0) };
const T6_TIGHT = { ...T6, Tight: row(1, 0, 0, 0) };

/** Normal, CCC widening more than BB and B, distress past the line: the diverging + tension default. */
function metrics(over: Partial<CreditMetrics> = {}): CreditMetrics {
  const six = months(6);
  return {
    hy_oas: 312,
    ig_oas: 94,
    ccc_oas: 1042,
    bb_oas: 188,
    b_oas: 297,
    hy_1w_change: 6,
    ig_1w_change: 1,
    ccc_1w_change: 29,
    bb_1w_change: -3,
    b_1w_change: 2,
    hy_ig_ratio: 3.32,
    distress_ratio: 104.2,
    lbo_all_in_cost: "7.04%",
    credit_label: "Normal",
    credit_label_color: "#28d17c",
    hy_pct_rank: 12,
    ig_pct_rank: 18,
    hy_series: HY_ALL,
    ig_series: IG_ALL,
    data_as_of: "Sep 01, 2026",
    transition_3m: T3,
    transition_6m: T6,
    tight_count: 0,
    hy_sparkline: series(six, 300, 2.4),
    ig_sparkline: series(six, 90, 0.8),
    ccc_sparkline: series(six, 900, 28),
    bb_sparkline: series(six, 200, -2.4),
    b_sparkline: series(six, 290, 1.4),
    ...over,
  };
}
const METRICS = metrics();
/** Normal with nothing widening and distress well under the line: mint strip, no callout, no overflow note, CCC "Watch". */
const IN_STEP: Partial<CreditMetrics> = { ccc_oas: 580, ccc_1w_change: -4, bb_1w_change: -1, b_1w_change: -2, distress_ratio: 58 };
const STRESSED: Partial<CreditMetrics> = { credit_label: "Stressed", hy_oas: 486, ccc_oas: 950, ccc_1w_change: 3, bb_1w_change: 5, b_1w_change: 8, distress_ratio: 95, hy_pct_rank: 74 };
const CRISIS: Partial<CreditMetrics> = { ...STRESSED, credit_label: "Crisis", hy_oas: 812, hy_pct_rank: 96 };
/** Tight: IG past 150 with HY at or under 400; three Tight months on file; in step otherwise. */
const TIGHT: Partial<CreditMetrics> = { credit_label: "Tight", hy_oas: 372, ig_oas: 160, tight_count: 3, transition_3m: T3_TIGHT, transition_6m: T6_TIGHT, hy_pct_rank: 41, ...IN_STEP };
/** A 36-month history: shorter than ten years, everything plots. */
const SHORT: Partial<CreditMetrics> = { hy_series: HY_ALL.slice(-36), ig_series: IG_ALL.slice(-36) };

const DEFAULTS: LboDefaults = { fedfunds: 4.33, hy_oas_pct: 2.65, lbo_all_in_rate: 6.98, data_as_of: "2026-09-01" };

const ERROR_HEADLINE = "Credit metrics unavailable: the data service did not answer. The read resumes when it is back.";
const LOADING_HEADLINE = "Reading credit spreads…";
const SUBHEAD = "High yield at 312 bps, the 12th percentile since 1996, with investment grade at 94 bps.";
const TERCILE_TIGHT = "Lenders are pricing almost no default stress: spreads this tight leave little cushion, so the risk is asymmetric to widening, not to further tightening.";
const LADDER_SENTENCE = "CCC moved +29 bps in the month, BB -3 bps and B +2 bps.";
const CHART_TERCILE_TIGHT = "Today's readings sit in the tight third of history: credit markets price almost no default stress.";
const CAPTION_C10 = "Option-adjusted spreads: the extra yield corporate bonds pay over Treasuries. High yield sits at 312 bps (3.12pp), the 12th percentile of history since 1996, tighter than 88% of it. Investment grade holds 94 bps, its 18th percentile.";
const CAPTION_C16 = "High-yield trades at 3.32× the investment-grade spread, near the ~3.5× long-run norm (2008 peaked at 8.2×). A rising ratio means the market is punishing weak credits faster than strong ones.";
const CAPTION_C17 = "CCC spreads sit at 1042 bps, 104% of the 1,000 bps distress line. The weakest credits run hot even while the broad market reads Normal at 312 bps; the two statements are about different rungs of the ladder, not a contradiction.";
const CALLOUT_P1 = "The index says Normal; the weakest rung says stress. CCC spreads sit at 1042 bps, 104% of the 1,000 bps distress line, while the broad high-yield index holds 312 bps. Both are true: the two readings describe different rungs of the ladder.";
const CALLOUT_P2 = "What it means: the market is charging default risk only for the marginal borrower. Watch single-B (297 bps today): stress migrating from CCC into B is how a Normal state turns Stressed (HY above 400 bps).";
const DISCLOSURE_LINE =
  "ICE BofA option-adjusted spread indices via FRED, monthly observations · classification checks rules top-down (Crisis, then Stressed, then Tight, else Normal) · transition odds are empirical frequencies from stored monthly states · classification and transition odds computed by the same analytics module the memo reads.";
const SUMMARY_LABELS = ["HY OAS", "IG OAS", "CCC distress", "HY / IG ratio", "Stays Normal · 3m", "LBO all-in"];
const IDS_IN_ORDER = ["credit-hero", "credit-summary", "oas", "quality-ladder", "credit-state-odds", "financing"];
const CARD_NAMES = ["High yield", "Investment grade", "BB", "Single-B", "CCC"];
const LINE2 = ["BB & below · Stressed above 400 bps, Crisis above 700 bps.", "BBB- or better · Tight above 150 bps.", "Crossover quality · no classification rule.", "Core of the high-yield index · no classification rule.", "Weakest credits · 104% of the 1,000 bps distress line."];

/* ── routes ──────────────────────────────────────────────────────────────── */

type Routes = Record<string, (url: URL, init?: RequestInit) => unknown>;
function routes(over: Routes = {}): Routes {
  return { "/api/credit/metrics": () => METRICS, "/api/lbo/defaults": () => DEFAULTS, ...over };
}
function without(...paths: string[]): Routes {
  const r = routes();
  for (const p of paths) delete r[p];
  return r;
}
const withMetrics = (over: Partial<CreditMetrics>) => routes({ "/api/credit/metrics": () => metrics(over) });
const PENDING = () => new Promise<never>(() => {});

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderCredit({ route = "/app/credit", client }: { route?: string; client?: QueryClient } = {}) {
  return renderWithProviders(
    <main id="main-content">
      <CreditScreen />
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
const hero = () => byId("credit-hero") as HTMLElement;
const summary = () => byId("credit-summary") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = (name = "Normal") => screen.findByRole("heading", { level: 1, name });
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
const cards = () => [...(byId("oas") as HTMLElement).querySelectorAll<HTMLElement>("article")];
const cardNamed = (name: string) => {
  const c = cards().find((a) => text(a.querySelector("h3")) === name);
  if (!c) throw new Error(`no #oas article named ${name}; names: ${cards().map((a) => text(a.querySelector("h3"))).join(" | ")}`);
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
const rangeGroup = () => within(hero()).getByRole("group", { name: "OAS history window" });
const heroImg = () => hero().querySelector("[role='img']") as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", "/app/credit");
  stubFetch(routes());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("CreditScreen (checklist 06 E.1)", () => {
  it("renders one h1 equal to the fixture label inside the hero with the HY OAS pill, the eyebrow, the live dot, the footnote items and the FRED chip", async () => {
    renderCredit();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect((document.querySelector("main") as HTMLElement).contains(h1)).toBe(true);
    expect(hero().tagName).toBe("SECTION");
    expect(hero()).toHaveClass("mrr-hero");
    expect(hero().contains(h1)).toBe(true);
    expect(text(h1)).toBe("Normal");
    expect(h1.querySelector(".jargon")).toBeNull(); // the h1 stays plain (G3)
    expect(within(hero()).getByText("Credit conditions")).toBeInTheDocument();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("HY OAS 312 bps");
    expect(text(pill)).toMatch(/^HY OAS \d+ bps$/);
    expect(pill).toHaveAttribute("data-tone", "mint");
    expect(h1.parentElement?.contains(pill)).toBe(true); // beside the headline
    expect(hero().querySelector("[title^='ICE BofA US High Yield OAS']")).not.toBeNull();
    expect(hero().querySelector(".mrr-hero-dot")).not.toBeNull(); // Sep 01 stamp is current on Sep 19
    expect(css(hero().querySelector(".mrr-hero-glow"))).toMatch(/rgba\(245, ?181, ?46, ?0?\.05\)/);
    expect(text(hero())).toContain("Monthly spreads through Sep 01, 2026");
    expect(text(hero())).toContain("Classification Normal for Sep 2026");
    expect(hero().querySelector("[title^='ICE BofA via FRED']")).not.toBeNull();
    expect(screen.queryByText(LOADING_HEADLINE)).toBeNull();
    expect(text(hero())).not.toContain(ERROR_HEADLINE);
    expect(document.querySelector("img")).toBeNull();
  });

  it.each<[label: string, over: Partial<CreditMetrics>, tone: string, glow: RegExp]>([
    ["Tight", TIGHT, "amber", /rgba\(245, ?181, ?46, ?0?\.05\)/],
    ["Stressed", STRESSED, "amber", /rgba\(245, ?181, ?46, ?0?\.05\)/],
    ["Crisis", CRISIS, "amber", /rgba\(240, ?80, ?63, ?0?\.06\)/],
  ])("%s reads the %s pill and its glow, the h1 carrying the word", async (label, over, tone, glow) => {
    stubFetch(withMetrics(over));
    renderCredit();
    await awaitHero(label);
    expect(hero().querySelector(".mrr-pill")).toHaveAttribute("data-tone", tone);
    expect(text(hero().querySelector(".mrr-pill"))).toBe(`HY OAS ${Math.round(over.hy_oas as number)} bps`);
    expect(css(hero().querySelector(".mrr-hero-glow"))).toMatch(glow);
  });

  it("the h2 starts with High yield at and carries the fixture bps; the lede is the tercile sentence then the ladder sentence", async () => {
    renderCredit();
    await awaitHero();
    const h2 = within(hero()).getByRole("heading", { level: 2 });
    expect(text(h2)).toBe(SUBHEAD);
    expect(text(h2).startsWith("High yield at")).toBe(true);
    expect(text(h2)).toContain("312 bps");
    const lede = hero().querySelector(".mrr-hero-lede") as HTMLElement;
    expect(text(lede)).toBe(`${TERCILE_TIGHT} ${LADDER_SENTENCE}`);
    expect(text(lede)).not.toContain("Tight here means");
    expect(text(hero())).not.toContain("—");
  });

  it("a Tight label adds the Tight lede sentence with the IG above 150 bps jargon affordance", async () => {
    stubFetch(withMetrics(TIGHT));
    renderCredit();
    await awaitHero("Tight");
    const lede = hero().querySelector(".mrr-hero-lede") as HTMLElement;
    expect(text(lede)).toContain("Tight here means IG above 150 bps with high yield still at or under 400 bps.");
    expect(within(lede).getByRole("button", { name: "IG above 150 bps" })).toHaveClass("jargon");
    expect(text(within(hero()).getByRole("heading", { level: 2 }))).toBe("High yield at 372 bps, the 41st percentile since 1996, with investment grade at 160 bps.");
  });

  it("See the quality ladder is the primary link to #quality-ladder and Price an LBO the ghost link to /app/tools#lbo", async () => {
    renderCredit();
    await awaitHero();
    const see = within(hero()).getByRole("link", { name: /See the quality ladder/ });
    const price = within(hero()).getByRole("link", { name: /Price an LBO/ });
    expect(see).toHaveAttribute("href", "/app/credit#quality-ladder");
    expect(price).toHaveAttribute("href", "/app/tools#lbo");
    expect(see).toHaveClass("mrr-hero-btn-primary");
    expect(price).toHaveClass("mrr-hero-btn-ghost");
    expect(see.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the hero chart slot holds the legend words, the 10Y / MAX control at 10Y, the mocked chart over the ten-year window, the caption and the mono range line", async () => {
    renderCredit();
    await awaitHero();
    const viz = heroViz();
    expect(viz).not.toBeNull();
    expect(text(viz)).toContain("HY OAS · bps");
    expect(text(viz)).toContain("IG OAS · bps");
    const group = rangeGroup();
    expect(within(group).getAllByRole("button").map((b) => text(b))).toEqual(["10Y", "MAX"]);
    expect(within(group).getByRole("button", { name: "10Y" })).toHaveAttribute("aria-pressed", "true");
    const img = heroImg();
    expect(img).not.toBeNull();
    expect(hero().querySelectorAll("[role='img']")).toHaveLength(1);
    expect(img.getAttribute("data-series")).toMatch(/^HY(?: OAS)?,IG(?: OAS)?$/);
    expect(img.getAttribute("data-points")).toBe("121"); // Sep 2016 to Sep 2026, boundary month kept
    expect(img.getAttribute("aria-label")).toBe("High-yield and investment-grade option-adjusted spreads, monthly, Sep 2016 to Sep 2026; dashed rules at HY 700, HY 400 and IG 150 bps; shaded NBER recessions");
    expect(text(viz)).toContain("Spreads spike when lenders panic; the shaded band marks the 2020 NBER recession.");
    expect(text(viz)).toContain(CHART_TERCILE_TIGHT);
    expect(within(viz).getByRole("button", { name: "NBER" })).toHaveClass("jargon");
    expect(text(viz)).toContain("Sep 2016 → Sep 2026 · HY high 1080 bps (Mar 2020) · IG low 83 bps (Jun 2021)");
    expect(text(viz)).not.toContain("2001");
  });

  it("MAX plots the whole history since Dec 1996 with all three bands named and the all-time extremes; 10Y restores the window", async () => {
    renderCredit();
    await awaitHero();
    fireEvent.click(within(rangeGroup()).getByRole("button", { name: "MAX" }));
    expect(within(rangeGroup()).getByRole("button", { name: "MAX" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(heroImg().getAttribute("data-points")).toBe(String(ALL_DATES.length)));
    expect(heroImg().getAttribute("aria-label")).toContain("monthly, Dec 1996 to Sep 2026;");
    expect(text(heroViz())).toContain("the shaded bands mark the 2001, 2008–09 and 2020 NBER recessions.");
    expect(text(heroViz())).toContain("Dec 1996 → Sep 2026 · HY high 1985 bps (Nov 2008) · IG low 55 bps (Jun 1997)");
    fireEvent.click(within(rangeGroup()).getByRole("button", { name: "10Y" }));
    await waitFor(() => expect(heroImg().getAttribute("data-points")).toBe("121"));
    expect(text(heroViz())).toContain("the shaded band marks the 2020 NBER recession.");
  });

  it("a 36-month history plots everything under 10Y and names its own months", async () => {
    stubFetch(withMetrics(SHORT));
    renderCredit();
    await awaitHero();
    await waitFor(() => expect(heroImg().getAttribute("data-points")).toBe("36"));
    expect(heroImg().getAttribute("aria-label")).toContain("monthly, Oct 2023 to Sep 2026;");
    expect(text(heroViz())).toContain("Oct 2023 → Sep 2026");
  });

  it("the summary dl has the six dt labels in order with the served values; Stays Normal · 3m holds the 3m diagonal percent", async () => {
    renderCredit();
    await awaitHero();
    expect(within(summary()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Credit summary$/);
    expect(summary()).toHaveClass("mrr-summary");
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("HY OAS"))).toBe("312 bps · +6 bps MoM · 12th percentile since 1996");
    expect(text(ddFor("IG OAS"))).toBe("94 bps · +1 bps MoM · 18th percentile since 1996");
    expect(text(ddFor("CCC distress"))).toBe("1042 bps · +29 bps MoM · 104% of the 1,000 bps line");
    expect(ddFor("CCC distress").style.color).toBe("var(--neg)");
    expect(text(ddFor("HY / IG ratio"))).toBe("3.32× · near the ~3.5× long-run norm");
    expect(text(ddFor("Stays Normal · 3m"))).toBe("81% of past months");
    expect(text(ddFor("LBO all-in"))).toBe("7.04% · Fed Funds + HY spread");
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
    expect(text(summary())).not.toContain("pct");
  });

  it("the CCC distress row tone steps at 80 and 100, the ratio words follow the C16 rule, and a null field prints the dash", async () => {
    stubFetch(withMetrics({ ...IN_STEP, hy_ig_ratio: 3.46, ig_oas: null }));
    renderCredit();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("CCC distress"))).toBe("580 bps · -4 bps MoM · 58% of the 1,000 bps line");
    expect(ddFor("CCC distress").style.color).not.toBe("var(--neg)");
    expect(ddFor("CCC distress").style.color).not.toBe("var(--warn-hot)");
    expect(text(ddFor("HY / IG ratio"))).toBe("3.46× · right on the ~3.5× long-run norm");
    expect(text(ddFor("IG OAS"))).toContain(DASH);
    expect(text(ddFor("IG OAS"))).not.toContain("null");
    for (const dd of summary().querySelectorAll("dl dd")) expect(text(dd)).not.toBe("");
  });

  it("with empty matrices the Stays row reads the 60-months sentence", async () => {
    stubFetch(withMetrics({ transition_3m: {}, transition_6m: {} }));
    renderCredit();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("Stays Normal · 3m"))).toBe("not enough monthly history (needs 60 months)");
  });

  it("status strip: a diverging fixture is an amber Link to #quality-ladder with the Watch · CCC widening title, the clauses and the spoken label", async () => {
    renderCredit();
    await awaitHero();
    const link = await awaitStrip();
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/app/credit#quality-ladder");
    expect(link).toHaveClass("mrr-status");
    expect(link).toHaveClass("mrr-status-amber");
    expect(link).toHaveAttribute("data-tone", "amber");
    expect(stripTitle(link)).toBe("Watch · CCC widening");
    expect(stripDetail(link)).toBe("+29 bps in a month · BB -3 bps · B +2 bps");
    expect(link.getAttribute("aria-label")).toBe("Watch · CCC widening. +29 bps in a month · BB -3 bps · B +2 bps. Jump to the quality ladder.");
    expect(summary().querySelectorAll(".mrr-status")).toHaveLength(1);
  });

  it("status strip: an in-step fixture reads mint Clear · ladder in step; the callout is absent", async () => {
    stubFetch(withMetrics(IN_STEP));
    renderCredit();
    await awaitHero();
    const link = await awaitStrip();
    expect(link).toHaveClass("mrr-status-mint");
    expect(link).not.toHaveClass("mrr-status-amber");
    expect(link).toHaveAttribute("href", "/app/credit#quality-ladder");
    expect(stripTitle(link)).toBe("Clear · ladder in step");
    expect(stripDetail(link)).toMatch(/^CCC -4 bps in a month · distress 58(?:\.0)?% of the 1,000 bps line$/);
    const ladder = await awaitSection("quality-ladder");
    expect(text(ladder)).not.toContain("Analytical callout");
  });

  it("#oas: the Spread monitor header, five article SignalCards with h3 names in order, the badges, the bps values, one sparkline each and no Last alert line", async () => {
    renderCredit();
    await awaitHero();
    const oas = await awaitSection("oas");
    expect(oas.tagName).toBe("SECTION");
    expect(within(oas).getByRole("heading", { level: 2 })).toHaveTextContent(/^Spread monitor$/);
    expect(text(oas)).toContain("Option-adjusted spreads by rating");
    expect(text(oas)).toContain("5 series · latest Sep 01, 2026");
    expect(within(oas).getByRole("link", { name: /Series notes/ })).toHaveAttribute("href", "/app/methodology#models");
    expect(cards()).toHaveLength(5);
    expect(cards().map((a) => text(a.querySelector("h3")))).toEqual(CARD_NAMES);
    expect(cards().map((a) => text(badgeOf(a)))).toEqual(["Normal", "Normal", "Monitor", "Monitor", "Distressed"]);
    expect(cards().map((a) => badgeOf(a).getAttribute("data-tone"))).toEqual(["clear", "clear", "info", "info", "alert"]);
    for (const [name, value] of [["High yield", "312 bps"], ["Investment grade", "94 bps"], ["BB", "188 bps"], ["Single-B", "297 bps"], ["CCC", "1042 bps"]] as const) expect(text(cardNamed(name)), name).toContain(value);
    expect(oas.querySelectorAll("article svg")).toHaveLength(5);
    for (const a of cards()) expect(a.querySelectorAll("svg"), text(a.querySelector("h3"))).toHaveLength(1);
    expect(text(oas)).not.toContain("Last alert");
    expect(text(oas)).not.toContain("Trips when");
  });

  it("#oas: HY and IG carry a meter and Percentile since 1996; BB, Single-B and CCC carry neither; the mono lines and the MoM colour rule", async () => {
    renderCredit();
    await awaitHero();
    await awaitSection("oas");
    for (const name of ["High yield", "Investment grade"]) {
      const c = cardNamed(name);
      expect(c.querySelector(".mrr-meter"), name).not.toBeNull();
      expect(text(c)).toContain("Percentile since 1996");
      expect(text(c)).not.toContain("Threshold proximity");
    }
    for (const name of ["BB", "Single-B", "CCC"]) {
      const c = cardNamed(name);
      expect(c.querySelector(".mrr-meter"), name).toBeNull();
      expect(text(c)).not.toContain("Percentile");
    }
    const moms = ["+6 bps MoM", "+1 bps MoM", "-3 bps MoM", "+2 bps MoM", "+29 bps MoM"];
    cards().forEach((c, i) => {
      expect(text(c), CARD_NAMES[i]).toContain(moms[i]);
      expect(text(c), CARD_NAMES[i]).toContain(LINE2[i]);
    });
    const spanColor = (card: HTMLElement, figure: string) => [...card.querySelectorAll<HTMLElement>("span")].find((s) => text(s).startsWith(figure))?.style.color;
    expect(spanColor(cardNamed("High yield"), "+6 bps")).toBe("var(--neg)");
    expect(spanColor(cardNamed("BB"), "-3 bps")).toBe("var(--pos)");
    expect(spanColor(cardNamed("CCC"), "+29 bps")).toBe("var(--neg)");
    expect(within(cardNamed("CCC")).getByRole("button", { name: "distress" })).toHaveClass("jargon");
  });

  it("#oas: the C10 caption under the grid with the OAS and percentile jargon", async () => {
    renderCredit();
    await awaitHero();
    const oas = await awaitSection("oas");
    expect(text(oas)).toContain(CAPTION_C10);
    expect(within(oas).getByRole("button", { name: "Option-adjusted spreads" })).toHaveClass("jargon");
    expect(within(oas).getByRole("button", { name: "percentile" })).toHaveClass("jargon");
  });

  it("the IG badge reads Tight inside a jargon affordance when ig_oas is 160, and CCC reads Watch under 1,000 bps", async () => {
    stubFetch(withMetrics(TIGHT));
    renderCredit();
    await awaitHero("Tight");
    await awaitSection("oas");
    const ig = cardNamed("Investment grade");
    expect(text(badgeOf(ig))).toBe("Tight");
    expect(badgeOf(ig)).toHaveAttribute("data-tone", "info");
    expect(within(badgeOf(ig)).getByRole("button", { name: "Tight" })).toHaveClass("jargon");
    expect(text(badgeOf(cardNamed("CCC")))).toBe("Watch");
    expect(badgeOf(cardNamed("CCC"))).toHaveAttribute("data-tone", "watch");
    expect(text(badgeOf(cardNamed("High yield")))).toBe("Normal");
  });

  it("the HY badge reads Stressed between 400 and 700 and Crisis above 700; the strip then names the rule the index is past", async () => {
    stubFetch(withMetrics(STRESSED));
    const stressed = renderCredit();
    await awaitHero("Stressed");
    await awaitSection("oas");
    expect(text(badgeOf(cardNamed("High yield")))).toBe("Stressed");
    expect(badgeOf(cardNamed("High yield"))).toHaveAttribute("data-tone", "watch");
    let link = await awaitStrip();
    expect(link).toHaveClass("mrr-status-amber");
    expect(stripTitle(link)).toBe("Stressed · HY 486 bps");
    expect(stripDetail(link)).toBe("The index is past the 400 bps rule; the ladder tiles show the rungs");
    expect(text(ddFor("Stays Stressed · 3m"))).toBe("58% of past months");
    stressed.unmount();

    stubFetch(withMetrics(CRISIS));
    renderCredit();
    await awaitHero("Crisis");
    await awaitSection("oas");
    expect(text(badgeOf(cardNamed("High yield")))).toBe("Crisis");
    expect(badgeOf(cardNamed("High yield"))).toHaveAttribute("data-tone", "alert");
    link = await awaitStrip();
    expect(stripTitle(link)).toBe("Crisis · HY 812 bps");
    expect(stripDetail(link)).toBe("The index is past the 700 bps rule; the ladder tiles show the rungs");
  });

  it("a null ig_oas renders the IG card with the dash value, the Unavailable badge, the reference tone and no meter", async () => {
    stubFetch(withMetrics({ ig_oas: null }));
    renderCredit();
    await awaitHero();
    await awaitSection("oas");
    const ig = cardNamed("Investment grade");
    expect(text(badgeOf(ig))).toBe("Unavailable");
    expect(badgeOf(ig)).toHaveAttribute("data-tone", "reference");
    expect(ig.querySelector(".mrr-meter")).toBeNull();
    expect(text(ig)).toContain(DASH);
    expect(text(ig)).not.toContain("null");
    expect(cards()).toHaveLength(5);
  });

  it("#quality-ladder: the header, the six-point BB / B / CCC chart with its mono line, the ratio tile with the C16 caption and the distress tile with the overflow note and the C17 caption", async () => {
    renderCredit();
    await awaitHero();
    const ladder = await awaitSection("quality-ladder");
    expect(ladder.tagName).toBe("SECTION");
    expect(within(ladder).getByRole("heading", { level: 2 })).toHaveTextContent(/^Quality ladder$/);
    expect(text(ladder)).toContain("BB, B and CCC spreads");
    expect(text(ladder)).toContain("BB · B · CCC detail · monthly");
    const img = ladder.querySelector("[role='img']") as HTMLElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute("data-series")).toBe("BB,B,CCC");
    expect(img.getAttribute("data-points")).toBe("6");
    expect(img.getAttribute("aria-label")).toBe("BB, B and CCC option-adjusted spreads, last six months");
    expect(text(ladder)).toContain("6 months · monthly · Apr 2026 to Sep 2026");
    const ratio = tileWith(ladder, "HY / IG ratio");
    expect(text(ratio)).toContain("3.32×");
    expect(text(ratio)).toMatch(/\d+\.\d\d×/);
    expect(text(ratio)).toContain(CAPTION_C16);
    const distress = tileWith(ladder, "Distress ratio");
    expect(text(distress)).toContain("104.2%");
    expect(text(distress)).toContain("▲ 4.2pp past the line; the bar caps at 100%");
    expect(text(distress)).toContain(CAPTION_C17);
    expect(distress.querySelector(".mrr-meter")).not.toBeNull();
    expect(within(distress).getByRole("button", { name: "distress" })).toHaveClass("jargon");
    // The ratio and distress figures agree with the summary rows.
    expect(text(ddFor("HY / IG ratio")).startsWith("3.32×")).toBe(true);
    expect(text(ddFor("CCC distress"))).toContain("104%");
  });

  it("#quality-ladder: the tension callout renders with its eyebrow and both paragraphs under the diverging fixture and not under the in-step one; the overflow note only above 100", async () => {
    const first = renderCredit();
    await awaitHero();
    const ladder = await awaitSection("quality-ladder");
    expect(text(ladder)).toContain("Analytical callout · quality ladder tension");
    expect(text(ladder)).toContain(CALLOUT_P1);
    expect(text(ladder)).toContain(CALLOUT_P2);
    expect(ladder.querySelectorAll(".mrr-prose")).toHaveLength(2);
    // The callout lives inside the ladder section, not above #oas.
    expect((byId("oas") as HTMLElement).compareDocumentPosition(ladder.querySelector(".mrr-prose") as Element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    first.unmount();

    stubFetch(withMetrics(IN_STEP));
    renderCredit();
    await awaitHero();
    const clear = await awaitSection("quality-ladder");
    expect(text(clear)).not.toContain("Analytical callout");
    expect(clear.querySelectorAll(".mrr-prose")).toHaveLength(0);
    expect(text(clear)).not.toContain("past the line");
    expect(text(tileWith(clear, "Distress ratio"))).toContain("58.0%");
  });

  it("#credit-state-odds renders inside the screen with the horizon control and the 3M grid", async () => {
    renderCredit();
    await awaitHero();
    const odds = await awaitSection("credit-state-odds");
    expect(odds.tagName).toBe("SECTION");
    expect(within(odds).getByRole("heading", { level: 2 })).toHaveTextContent(/^Credit state odds$/);
    expect(within(odds).getByRole("group", { name: "Transition horizon" })).toBeInTheDocument();
    expect(within(odds).getByRole("table")).toHaveAttribute("aria-label", "Credit-state transition matrix 3M");
    expect(within(odds).getByRole("rowheader", { name: "Normal" })).toHaveAttribute("aria-current", "true");
  });

  it("#financing: the all-in value equals the summary LBO row's figure, the bar labels come from the defaults route, exactly one ladder row reads ← today and names the label", async () => {
    renderCredit();
    await awaitHero();
    const fin = await awaitSection("financing");
    expect(fin.tagName).toBe("SECTION");
    expect(within(fin).getByRole("heading", { level: 2 })).toHaveTextContent(/^Financing conditions$/);
    await waitFor(() => expect(text(fin)).toContain("Fed funds 4.33%"));
    expect(text(fin)).toContain("HY OAS 2.65%");
    expect(text(fin)).toContain("7.04%");
    expect(text(ddFor("LBO all-in")).startsWith("7.04%")).toBe(true);
    expect((text(fin).match(/← today/g) ?? []).length).toBe(1);
    const today = [...fin.querySelectorAll<HTMLElement>("span[data-tone]")].map((t) => t.parentElement as HTMLElement).find((r) => text(r).includes("← today")) as HTMLElement;
    expect(today).toBeDefined();
    expect(text(today)).toMatch(/^Normal/);
    expect(within(fin).getByRole("link", { name: /Open LBO calculator/ })).toHaveAttribute("href", "/app/tools#lbo");
    expect(within(fin).getByRole("button", { name: "Tight" })).toHaveClass("jargon");
  });

  it("renders the section ids in document order inside main and the DisclosureLine last with the B.8 sentence", async () => {
    renderCredit();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    await waitFor(() => expect(text(byId("financing"))).toContain("Fed funds 4.33%"));
    const els = IDS_IN_ORDER.map((id) => byId(id));
    IDS_IN_ORDER.forEach((id, i) => expect(els[i], id).not.toBeNull());
    const main = document.querySelector("main") as HTMLElement;
    for (const el of els) expect(main.contains(el)).toBe(true);
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${IDS_IN_ORDER[i - 1]} before ${IDS_IN_ORDER[i]}`).toBeTruthy();
    }
    for (const id of ["oas", "quality-ladder", "credit-state-odds", "financing"]) expect((byId(id) as HTMLElement).tagName, id).toBe("SECTION");
    const line = main.querySelector("p.mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(text(line)).toBe(DISCLOSURE_LINE);
    const all = [...main.querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(main.querySelectorAll(".mrr-disclosure-line")).toHaveLength(1);
    expect(text(main)).not.toContain("— ");
    expect(text(main)).not.toContain("Desk read");
  });

  it("metrics pending renders the reading headline with no pill, the gray Reading the ladder… strip and the loading notes in the rows and panels", async () => {
    stubFetch(routes({ "/api/credit/metrics": PENDING }));
    renderCredit();
    expect(await screen.findByText(LOADING_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(LOADING_HEADLINE);
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    expect(text(hero())).not.toContain(ERROR_HEADLINE);
    const link = await awaitStrip();
    expect(link).toHaveAttribute("data-tone", "gray");
    expect(link).toHaveAttribute("href", "/app/credit#quality-ladder");
    expect(stripTitle(link)).toBe("Reading the ladder…");
    expect(stripDetail(link)).toBe("Opens the quality ladder");
    expect(text(summary())).toContain("Reading stored data…");
    for (const id of ["oas", "quality-ladder", "credit-state-odds", "financing"]) {
      const s = await awaitSection(id);
      expect(within(s).getByRole("heading", { level: 2 }), id).toBeInTheDocument();
      expect(text(s), id).toContain("Reading stored data…");
    }
    expect(byId("oas")?.querySelectorAll("article")).toHaveLength(0);
  });

  it("metrics 404 without data renders the error headline with the Unavailable pill, the gray Ladder unavailable strip and the error notes", async () => {
    stubFetch(without("/api/credit/metrics"));
    renderCredit();
    expect(await screen.findByText(ERROR_HEADLINE)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Credit metrics unavailable");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const pill = hero().querySelector(".mrr-pill");
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(screen.queryByText(LOADING_HEADLINE)).toBeNull();
    const link = await awaitStrip();
    expect(link).toHaveAttribute("data-tone", "gray");
    expect(stripTitle(link)).toBe("Ladder unavailable");
    expect(stripDetail(link)).toBe("The data service did not answer");
    expect(text(summary())).toContain("Unavailable: the data service did not answer.");
    for (const id of ["oas", "quality-ladder", "credit-state-odds", "financing"]) {
      const s = await awaitSection(id);
      expect(text(s), id).toContain("Unavailable: the data service did not answer.");
    }
    expect(hero().querySelector("[role='img']")).toBeNull();
  });

  it("metrics 404 with seeded cache data renders no error copy", async () => {
    stubFetch(without("/api/credit/metrics"));
    const client = makeClient();
    const key = ["credit", "metrics"];
    // Seeded like the validated snapshot: older than the hook's 30-minute
    // staleTime, so the mount refetches, the refetch 404s, and the seeded
    // metrics must stay on screen.
    client.setQueryData(key, METRICS, { updatedAt: NOW_MS - 60 * 60_000 });
    renderCredit({ client });
    await awaitHero();
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
    expect(client.getQueryData(key)).toEqual(METRICS);
    expect(screen.queryByText(ERROR_HEADLINE)).toBeNull();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Normal");
    expect(text(hero().querySelector(".mrr-pill"))).toBe("HY OAS 312 bps");
    expect(hero().querySelector("[role='img']")).not.toBeNull();
    expect(text(summary())).not.toContain("Unavailable");
  });

  it("useHashScroll lands #financing when rendered with route /app/credit#financing", async () => {
    const targets: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      targets.push(this);
    });
    window.history.replaceState(null, "", "/app/credit#financing");
    renderCredit({ route: "/app/credit#financing" });
    await awaitHero();
    await waitFor(() => expect(targets).toContain(byId("financing") as HTMLElement));
  });
});
