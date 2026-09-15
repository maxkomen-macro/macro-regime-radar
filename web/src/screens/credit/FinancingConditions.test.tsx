/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) sections B.7
 * and E.1, `screens/credit/FinancingConditions.test.tsx`: the `#financing`
 * panel rendered directly with served metrics; it calls `useLboDefaults()`
 * itself, so `renderWithProviders` supplies the query client and `stubFetch`
 * the `/api/lbo/defaults` route (unmatched paths 404). The stacked bar from
 * the defaults, the fallback guard (`data_as_of: "unavailable"` is the
 * module's hard-coded payload, not data), the loading note in the bar's
 * place, the classification ladder with one "← today" row and the Tight
 * jargon affordance (the P6 target), the header link to the LBO calculator
 * and the StateNote bodies (B.4). Fixtures are invented rates dated Sep 2026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import FinancingConditions from "./FinancingConditions";
import type { CreditMetrics, DatedValue, LboDefaults } from "../../api/types";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LAST = "2026-09-01";
const DASH = "—";

function months(n: number, last = LAST): string[] {
  const [y, m] = last.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const idx = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-01`);
  }
  return out;
}
const series = (dates: string[], base: number, step: number): DatedValue[] => dates.map((date, i) => ({ date, value: base + i * step }));
const row = (n: number, t: number, s: number, c: number) => ({ Normal: n, Tight: t, Stressed: s, Crisis: c });
const T3 = { Normal: row(0.8123, 0, 0.1544, 0.0333), Tight: row(0, 0, 0, 0), Stressed: row(0.2883, 0, 0.5833, 0.1284), Crisis: row(0.04, 0, 0.36, 0.6) };
const T6 = { Normal: row(0.7211, 0, 0.2277, 0.0512), Tight: row(0, 0, 0, 0), Stressed: row(0.4583, 0, 0.375, 0.1667), Crisis: row(0.12, 0, 0.44, 0.44) };

function metrics(over: Partial<CreditMetrics> = {}): CreditMetrics {
  const dates = months(36);
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
    hy_series: series(dates, 380, -2),
    ig_series: series(dates, 120, -0.75),
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
const STRESSED: Partial<CreditMetrics> = { credit_label: "Stressed", hy_oas: 486, hy_pct_rank: 74 };
const TIGHT: Partial<CreditMetrics> = { credit_label: "Tight", hy_oas: 372, ig_oas: 160, tight_count: 3, hy_pct_rank: 41 };

/** The served defaults: 4.33 + 2.65 = 6.98, deliberately not the credit-metrics all-in string (G11: never averaged away). */
const DEFAULTS: LboDefaults = { fedfunds: 4.33, hy_oas_pct: 2.65, lbo_all_in_rate: 6.98, data_as_of: "2026-09-01" };
/** lbo.py:32-37 hard-coded fallback: the guard renders no bar. */
const FALLBACK: LboDefaults = { fedfunds: 5.33, hy_oas_pct: 3.27, lbo_all_in_rate: 8.6, data_as_of: "unavailable" };
const PENDING = () => new Promise<never>(() => {});

const RULES = ["HY spread above 700 bps", "HY spread above 400 bps", "IG spread above 150 bps", "None of the above · HY 312, IG 94"];
const CAPTION_C20 = "Fed Funds plus the high-yield spread: the rough rate a leveraged buyout pays on its debt. Pre-GFC deals borrowed near ~7.2%; the 2022 peak touched ~11.4%.";
const GUARD = "Rate components unavailable; the all-in figure above is the stored monthly read.";
const TIGHT_DEF = "IG spreads above 150 bp: financing strain";

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderPanel(m: CreditMetrics | null = metrics(), status: "ready" | "loading" | "error" = "ready") {
  return renderWithProviders(
    <main id="main-content">
      <FinancingConditions m={m} status={status} />
    </main>,
    { route: "/app/credit" },
  );
}

/** Text with `hidden` subtrees removed (Jargon tooltips), whitespace collapsed. */
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
const section = () => document.getElementById("financing") as HTMLElement;
/** The `Card variant="tile"` surface (inline `border-radius: var(--r-tile)`) around the innermost element whose text equals `label`. */
function tileFor(label: string): HTMLElement {
  const matches = [...section().querySelectorAll<HTMLElement>("*")].filter((el) => text(el) === label);
  const labelEl = matches[matches.length - 1];
  if (!labelEl) throw new Error(`no element reads ${label}; section text: ${text(section())}`);
  const tile = labelEl.closest<HTMLElement>("[style*='var(--r-tile)']");
  if (!tile || tile === section()) throw new Error(`no tile surface around ${label}`);
  return tile;
}
const allIn = () => tileFor("LBO all-in cost");
const ladder = () => tileFor("Classification ladder");
/** The stacked bar: the aria-hidden flex row with two <i> segments. */
const bar = () => [...allIn().querySelectorAll<HTMLElement>("[aria-hidden='true']")].find((el) => el.querySelectorAll("i").length === 2) ?? null;
/** Ladder rows: one per Tag badge, in document order. */
const ladderRows = () => [...ladder().querySelectorAll<HTMLElement>("span[data-tone]")].map((tag) => tag.parentElement as HTMLElement);
const todayRows = () => ladderRows().filter((r) => text(r).includes("← today"));
/** The StatTile value: the element right after the mono label. */
function allInValue(): string {
  const labels = [...allIn().querySelectorAll<HTMLElement>("*")].filter((el) => text(el) === "LBO all-in cost");
  const labelEl = labels[labels.length - 1];
  const value = labelEl?.nextElementSibling;
  if (!value) throw new Error("LBO all-in cost has no value element");
  return text(value);
}

beforeEach(() => {
  window.history.replaceState(null, "", "/app/credit");
  stubFetch({ "/api/lbo/defaults": () => DEFAULTS });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("FinancingConditions (checklist 06 B.7 / E.1)", () => {
  it("renders section#financing with the panel header, description, meta and the Open LBO calculator link to /app/tools#lbo", async () => {
    renderPanel();
    expect(section().tagName).toBe("SECTION");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Financing conditions$/);
    expect(text(section())).toContain("What a leveraged borrower pays today");
    expect(text(section())).toContain("Fed Funds + HY OAS · monthly");
    const link = within(section()).getByRole("link", { name: /Open LBO calculator/ });
    expect(link).toHaveAttribute("href", "/app/tools#lbo");
    expect(link).toHaveClass("mrr-link");
    expect(text(link)).toBe("Open LBO calculator →");
    expect(within(section()).queryByRole("link", { name: /Model a deal/ })).toBeNull();
    await waitFor(() => expect(text(section())).toContain("Fed funds 4.33%"));
  });

  it("the all-in tile prints the credit-metrics string, the bar's two labels print the defaults and the mono line their sum with the stamp", async () => {
    renderPanel();
    expect(allInValue()).toBe("7.04%");
    await waitFor(() => expect(text(section())).toContain("Fed funds 4.33%"));
    expect(text(section())).toContain("HY OAS 2.65%");
    expect(text(section())).toMatch(/Fed funds \+ HY OAS = 6\.98% · stored through (?:2026-09-01|Sep 01, 2026)/);
    // The tile's number is the stored monthly read, never the defaults sum (G11).
    expect(allInValue()).not.toBe("6.98%");
    expect(bar()).not.toBeNull();
    expect(bar()?.querySelectorAll("i")).toHaveLength(2);
    expect(text(allIn())).toContain(CAPTION_C20);
    expect(text(section())).not.toContain(GUARD);
    expect(text(section())).not.toContain("vs a year ago");
  });

  it("the fallback payload (data_as_of unavailable) renders no bar and the guard sentence; the all-in figure stays", async () => {
    stubFetch({ "/api/lbo/defaults": () => FALLBACK });
    renderPanel();
    await waitFor(() => expect(text(section())).toContain(GUARD));
    expect(bar()).toBeNull();
    expect(text(section())).not.toContain("Fed funds 5.33%");
    expect(text(section())).not.toContain("8.60%");
    expect(allInValue()).toBe("7.04%");
    expect(text(allIn())).toContain(CAPTION_C20);
  });

  it("while the defaults load the bar's place reads the loading note; a failed defaults request leaves the tile without a bar", async () => {
    stubFetch({ "/api/lbo/defaults": PENDING });
    const pending = renderPanel();
    expect(allInValue()).toBe("7.04%");
    await waitFor(() => expect(text(allIn())).toContain("Reading stored data…"));
    expect(bar()).toBeNull();
    expect(text(section())).not.toContain("Fed funds 4.33%");
    pending.unmount();

    stubFetch({});
    renderPanel();
    expect(allInValue()).toBe("7.04%");
    await waitFor(() => expect(text(allIn())).not.toContain("Reading stored data…"));
    expect(bar()).toBeNull();
    expect(text(allIn())).toContain(CAPTION_C20);
  });

  it("a null all-in cost prints the dash placeholder, never an empty value", async () => {
    renderPanel(metrics({ lbo_all_in_cost: null }));
    expect(allInValue()).toBe(DASH);
    await waitFor(() => expect(text(section())).toContain("Fed funds 4.33%"));
  });

  it("the classification ladder lists Crisis, Stressed, Tight, Normal in check order with the rule texts, exactly one ← today row naming the label, and the caption", async () => {
    renderPanel();
    const rows = ladderRows();
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.querySelector("span[data-tone]")?.getAttribute("data-tone"))).toEqual(["alert", "watch", "info", "clear"]);
    rows.forEach((r, i) => {
      expect(text(r), `row ${i}`).toContain(RULES[i]);
    });
    expect(text(rows[0])).toMatch(/^Crisis/);
    expect(text(rows[1])).toMatch(/^Stressed/);
    expect(text(rows[2])).toMatch(/^Tight/);
    expect(text(rows[3])).toMatch(/^Normal/);
    expect(todayRows()).toHaveLength(1);
    expect(text(todayRows()[0])).toMatch(/^Normal/);
    expect(text(todayRows()[0])).toContain("None of the above · HY 312, IG 94");
    expect(text(ladder())).toContain("Checked top-down; the first rule that matches names the state.");
    expect((text(ladder()).match(/← today/g) ?? []).length).toBe(1);
  });

  it("the ← today row follows the served label: Stressed marks the second row, Tight the third", () => {
    const stressed = renderPanel(metrics(STRESSED));
    expect(todayRows()).toHaveLength(1);
    expect(text(todayRows()[0])).toMatch(/^Stressed/);
    expect(text(todayRows()[0])).toContain("HY spread above 400 bps");
    stressed.unmount();

    renderPanel(metrics(TIGHT));
    expect(todayRows()).toHaveLength(1);
    expect(text(todayRows()[0])).toMatch(/^Tight/);
    expect(text(todayRows()[0])).toContain("IG spread above 150 bps");
    expect(text(ladderRows()[3])).toContain("None of the above · HY 372, IG 160");
  });

  it("a null ig_oas leaves the Normal row without the IG figure and never prints null", () => {
    renderPanel(metrics({ ig_oas: null }));
    const normal = ladderRows()[3];
    expect(text(normal)).toContain("None of the above · HY 312");
    expect(text(normal)).not.toContain("IG 94");
    expect(text(normal)).not.toContain("null");
    expect(text(normal)).not.toContain("NaN");
    expect(todayRows()).toHaveLength(1);
  });

  it("the ladder's Tight is a jargon affordance: focus opens the decision-3 tooltip, Escape closes it without moving focus, hover opens it too (the P6 check)", () => {
    renderPanel();
    const term = within(ladder()).getByRole("button", { name: "Tight" });
    expect(term).toHaveClass("jargon");
    expect(within(ladder()).queryByRole("tooltip")).toBeNull();
    fireEvent.focus(term);
    const tip = within(ladder()).getByRole("tooltip");
    expect(tip).toBeVisible();
    expect((tip.textContent ?? "").startsWith(TIGHT_DEF)).toBe(true);
    expect(term.getAttribute("aria-describedby")).toBe(tip.id);
    term.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(within(ladder()).queryByRole("tooltip")).toBeNull();
    expect(document.activeElement).toBe(term);
    // Hover: the wrap opens the tooltip; leaving it closes after the grace.
    fireEvent.mouseEnter(term.parentElement as HTMLElement);
    expect(within(ladder()).getByRole("tooltip")).toBeVisible();
    expect(screen.getAllByRole("tooltip")).toHaveLength(1);
  });

  it("renders the header with a loading note while status is loading and the error note when errored, never the ladder", () => {
    const loading = renderPanel(null, "loading");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Financing conditions$/);
    expect(text(section())).toContain("Reading stored data…");
    expect(text(section())).not.toContain("← today");
    expect(text(section())).not.toContain("LBO all-in cost");
    loading.unmount();

    renderPanel(null, "error");
    expect(text(section())).toContain("Unavailable: the data service did not answer.");
    expect(text(section())).not.toContain("← today");
    expect(section().querySelectorAll("span[data-tone]")).toHaveLength(0);
  });
});
