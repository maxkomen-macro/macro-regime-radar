/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) sections B.6
 * and E.1, `screens/credit/CreditStateOdds.test.tsx`: the `#credit-state-odds`
 * panel rendered directly with served metrics and status "ready". The
 * Segmented horizon (3 months pressed on load), the HeatMatrix per horizon
 * (aria-label "… 3M" / "… 6M", the "→ {state}" columns, the current row
 * outlined with aria-current, the Tight row dashed at tight_count 0), the
 * three StatTiles reading named cells, the caption stating the other
 * horizon's stay figure, the 60-months note for empty matrices and the
 * StateNote bodies while loading or errored (B.4). Fixtures are invented
 * transition odds dated Sep 2026; nothing here is a mockup figure.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import CreditStateOdds from "./CreditStateOdds";
import type { CreditMetrics, DatedValue } from "../../api/types";
import { renderWithProviders } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

const LAST = "2026-09-01";
const DASH = "—";
const STATES = ["Normal", "Tight", "Stressed", "Crisis"] as const;

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

/** Normal → Normal 81% (3m) / 72% (6m); Normal → Stressed 15% / 23%; Stressed → Crisis 13% / 17%. Tight rows are zeros (never occurred). */
const T3: Record<string, Record<string, number>> = {
  Normal: row(0.8123, 0, 0.1544, 0.0333),
  Tight: row(0, 0, 0, 0),
  Stressed: row(0.2883, 0, 0.5833, 0.1284),
  Crisis: row(0.04, 0, 0.36, 0.6),
};
const T6: Record<string, Record<string, number>> = {
  Normal: row(0.7211, 0, 0.2277, 0.0512),
  Tight: row(0, 0, 0, 0),
  Stressed: row(0.4583, 0, 0.375, 0.1667),
  Crisis: row(0.12, 0, 0.44, 0.44),
};
/** The same odds with three Tight months on file. */
const T3_TIGHT: Record<string, Record<string, number>> = { ...T3, Tight: row(0.6667, 0.3333, 0, 0) };
const T6_TIGHT: Record<string, Record<string, number>> = { ...T6, Tight: row(1, 0, 0, 0) };

/** 3M cell texts per row (Math.round(p * 100)%). */
const CELLS_3M: Record<string, string[]> = {
  Normal: ["81%", "0%", "15%", "3%"],
  Stressed: ["29%", "0%", "58%", "13%"],
  Crisis: ["4%", "0%", "36%", "60%"],
};
const CELLS_6M: Record<string, string[]> = {
  Normal: ["72%", "0%", "23%", "5%"],
  Stressed: ["46%", "0%", "38%", "17%"],
  Crisis: ["12%", "0%", "44%", "44%"],
};

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
const TIGHT_3: Partial<CreditMetrics> = { tight_count: 3, transition_3m: T3_TIGHT, transition_6m: T6_TIGHT };
const STRESSED: Partial<CreditMetrics> = { credit_label: "Stressed", hy_oas: 486, hy_pct_rank: 74 };

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderPanel(m: CreditMetrics | null = metrics(), status: "ready" | "loading" | "error" = "ready") {
  return renderWithProviders(
    <main id="main-content">
      <CreditStateOdds m={m} status={status} />
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
const css = (el: Element | null) => el?.getAttribute("style") ?? "";
const section = () => document.getElementById("credit-state-odds") as HTMLElement;
const group = () => within(section()).getByRole("group", { name: "Transition horizon" });
const option = (label: "3 months" | "6 months") => within(group()).getByRole("button", { name: label });
const table = () => within(section()).getByRole("table");
const gridRow = (state: string): HTMLElement => {
  const header = within(table()).getByRole("rowheader", { name: state });
  return header.closest("[role='row']") as HTMLElement;
};
const cellTexts = (state: string) => [...gridRow(state).querySelectorAll("[role='cell']")].map((c) => text(c));
/** The StatTile value under the mono label `label` (StatTile: label div then value div). */
function tileValue(label: string): string {
  const labels = [...section().querySelectorAll("div")].filter((d) => text(d) === label);
  const labelEl = labels[labels.length - 1];
  if (!labelEl) throw new Error(`no tile labelled ${label}; text: ${text(section())}`);
  const value = labelEl.nextElementSibling;
  if (!value) throw new Error(`tile ${label} has no value element`);
  return text(value);
}
const eyebrowText = () => (text(section()).includes("6-month transition odds") ? "6-month transition odds" : text(section()).includes("3-month transition odds") ? "3-month transition odds" : "");

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("CreditStateOdds (checklist 06 B.6 / E.1)", () => {
  it("renders section#credit-state-odds with the panel header, the description and a Transition horizon group of two aria-pressed buttons, 3 months pressed on load", () => {
    renderPanel();
    expect(section().tagName).toBe("SECTION");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Credit state odds$/);
    expect(text(section())).toContain("Past monthly moves between states");
    const buttons = within(group()).getAllByRole("button");
    expect(buttons.map((b) => text(b))).toEqual(["3 months", "6 months"]);
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    for (const b of buttons) expect(b).toHaveAttribute("type", "button");
  });

  it("shows the 3M grid on load: aria-label ending 3M, the From ↓ to → corner, the → {state} columns and the eyebrow 3-month transition odds", () => {
    renderPanel();
    const grid = table();
    expect(grid).toHaveAttribute("aria-label", "Credit-state transition matrix 3M");
    expect(within(section()).getAllByRole("table")).toHaveLength(1);
    expect(eyebrowText()).toBe("3-month transition odds");
    const cols = within(grid).getAllByRole("columnheader").map((c) => text(c));
    expect(cols).toEqual(["From ↓ to →", "→ Normal", "→ Tight", "→ Stressed", "→ Crisis"]);
    expect(within(grid).getAllByRole("rowheader").map((r) => text(r).replace(/\s*●$/, ""))).toEqual([...STATES]);
    for (const state of ["Normal", "Stressed", "Crisis"]) expect(cellTexts(state), state).toEqual(CELLS_3M[state]);
  });

  it("clicking 6 months swaps to the 6M cells and the eyebrow 6-month transition odds; clicking 3 months restores the first grid", () => {
    renderPanel();
    fireEvent.click(option("6 months"));
    expect(option("6 months")).toHaveAttribute("aria-pressed", "true");
    expect(option("3 months")).toHaveAttribute("aria-pressed", "false");
    expect(table()).toHaveAttribute("aria-label", "Credit-state transition matrix 6M");
    expect(eyebrowText()).toBe("6-month transition odds");
    for (const state of ["Normal", "Stressed", "Crisis"]) expect(cellTexts(state), state).toEqual(CELLS_6M[state]);
    expect(cellTexts("Normal")).not.toEqual(CELLS_3M.Normal);
    expect(text(section())).not.toContain("3-month transition odds");

    fireEvent.click(option("3 months"));
    expect(option("3 months")).toHaveAttribute("aria-pressed", "true");
    expect(option("6 months")).toHaveAttribute("aria-pressed", "false");
    expect(table()).toHaveAttribute("aria-label", "Credit-state transition matrix 3M");
    expect(eyebrowText()).toBe("3-month transition odds");
    expect(cellTexts("Normal")).toEqual(CELLS_3M.Normal);
  });

  it("the current state's row header carries aria-current and the aria-hidden marker, and every cell of that row the outline; no other row does", () => {
    renderPanel();
    const current = within(table()).getByRole("rowheader", { name: "Normal" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(current.querySelector("[aria-hidden='true']")).not.toBeNull();
    const outlined = (state: string) => [...gridRow(state).querySelectorAll("[role='cell']")].filter((c) => /outline(?:-style)?:[^;]*solid/.test(css(c)));
    expect(outlined("Normal")).toHaveLength(4);
    for (const c of outlined("Normal")) expect(css(c)).toMatch(/rgba\(255, ?255, ?255, ?0?\.28\)/);
    for (const state of ["Tight", "Stressed", "Crisis"]) {
      expect(outlined(state), state).toHaveLength(0);
      expect(within(table()).getByRole("rowheader", { name: state })).not.toHaveAttribute("aria-current");
    }
  });

  it("the outline follows the served label, not the row position: a Stressed fixture outlines the Stressed row only", () => {
    renderPanel(metrics(STRESSED));
    const headers = within(table()).getAllByRole("rowheader", { current: true });
    expect(headers.map((h) => text(h).replace(/\s*●$/, ""))).toEqual(["Stressed"]);
    const outlined = (state: string) => [...gridRow(state).querySelectorAll("[role='cell']")].filter((c) => /outline(?:-style)?:[^;]*solid/.test(css(c)));
    expect(outlined("Stressed")).toHaveLength(4);
    expect(outlined("Normal")).toHaveLength(0);
  });

  it("tight_count 0 renders the Tight row as four dashes with no tint and the never-occurred sentence", () => {
    renderPanel();
    expect(cellTexts("Tight")).toEqual([DASH, DASH, DASH, DASH]);
    for (const c of gridRow("Tight").querySelectorAll("[role='cell']")) expect(css(c)).toMatch(/background:\s*transparent/);
    expect(text(section())).toContain("The Tight state has never occurred since 1996; its row renders empty, not zero-risk.");
    expect(text(section())).not.toContain("historical months");
    fireEvent.click(option("6 months"));
    expect(cellTexts("Tight")).toEqual([DASH, DASH, DASH, DASH]);
  });

  it("tight_count 3 renders numbers in the Tight row on both horizons and the only-3-historical-months sentence", () => {
    renderPanel(metrics(TIGHT_3));
    expect(cellTexts("Tight")).toEqual(["67%", "33%", "0%", "0%"]);
    expect(text(section())).toContain("Tight-state rows rest on only 3 historical months; treat those odds as anecdote.");
    expect(text(section())).not.toContain("never occurred");
    fireEvent.click(option("6 months"));
    expect(cellTexts("Tight")).toEqual(["100%", "0%", "0%", "0%"]);
  });

  it("five or more Tight months drop the caveat altogether", () => {
    renderPanel(metrics({ ...TIGHT_3, tight_count: 5 }));
    expect(text(section())).not.toContain("historical months");
    expect(text(section())).not.toContain("never occurred");
  });

  it("the Tight row header is the Tight jargon affordance (decision 3)", () => {
    renderPanel();
    const header = within(table()).getByRole("rowheader", { name: "Tight" });
    const term = within(header).getByRole("button", { name: "Tight" });
    expect(term).toHaveClass("jargon");
    fireEvent.focus(term);
    const tip = screen.getByRole("tooltip");
    expect(tip).toBeVisible();
    expect((tip.textContent ?? "").startsWith("IG spreads above 150 bp: financing strain")).toBe(true);
  });

  it("empty matrices render the 60-months note in place of the grid and no tiles", () => {
    renderPanel(metrics({ transition_3m: {}, transition_6m: {} }));
    expect(text(section())).toContain("Not enough monthly history for transition odds (needs 60 months).");
    expect(within(section()).queryByRole("table")).toBeNull();
    expect(text(section())).not.toMatch(/Stays Normal · 3m|To Stressed · 3m|To Stressed · 6m/);
    expect(text(section())).not.toMatch(/\d+% of the time/);
    // The horizon control still renders in the header.
    expect(group()).toBeInTheDocument();
  });

  it("the three tiles read the named cells: Stays {label} · 3m, To Stressed · 3m and To Stressed · 6m", () => {
    renderPanel();
    expect(tileValue("Stays Normal · 3m")).toBe("81%");
    expect(tileValue("To Stressed · 3m")).toBe("15%");
    expect(tileValue("To Stressed · 6m")).toBe("23%");
    // The tiles are fixed reads; the horizon toggle does not change them.
    fireEvent.click(option("6 months"));
    expect(tileValue("Stays Normal · 3m")).toBe("81%");
    expect(tileValue("To Stressed · 6m")).toBe("23%");
  });

  it("the third tile switches to Crisis when the label is Stressed", () => {
    renderPanel(metrics(STRESSED));
    expect(tileValue("Stays Stressed · 3m")).toBe("58%");
    expect(tileValue("To Crisis · 3m")).toBe("13%");
    expect(tileValue("To Crisis · 6m")).toBe("17%");
    expect(text(section())).not.toContain("To Stressed");
  });

  it("a missing cell prints the dash placeholder in its tile, never an empty value", () => {
    renderPanel(metrics({ transition_6m: { Stressed: T6.Stressed, Crisis: T6.Crisis } }));
    expect(tileValue("Stays Normal · 3m")).toBe("81%");
    expect(tileValue("To Stressed · 3m")).toBe("15%");
    expect(tileValue("To Stressed · 6m")).toBe(DASH);
  });

  it("the caption names the transition matrix jargon, today's stay figure, the outlined-row sentence and the other horizon's stay figure, swapping with the toggle", () => {
    renderPanel();
    expect(within(section()).getByRole("button", { name: "transition matrix" })).toHaveClass("jargon");
    const t = () => text(section());
    expect(t()).toContain("A transition matrix counted from monthly credit states since 1996.");
    expect(t()).toContain("From today's Normal state, spreads stayed Normal three months later 81% of the time.");
    expect(t()).toContain("The outlined row is today's state.");
    expect(t()).toContain("6-month view: Normal stays 72%.");
    expect(t()).not.toContain("3-month view:");
    fireEvent.click(option("6 months"));
    expect(t()).toContain("3-month view: Normal stays 81%.");
    expect(t()).not.toContain("6-month view:");
    expect(t()).toContain("From today's Normal state, spreads stayed Normal three months later 81% of the time.");
    expect(t()).not.toContain("— ");
  });

  it("renders the header with a loading note while status is loading and the error note when errored, never a grid", () => {
    const loading = renderPanel(null, "loading");
    expect(within(section()).getByRole("heading", { level: 2 })).toHaveTextContent(/^Credit state odds$/);
    expect(text(section())).toContain("Reading stored data…");
    expect(within(section()).queryByRole("table")).toBeNull();
    loading.unmount();

    renderPanel(null, "error");
    expect(text(section())).toContain("Unavailable: the data service did not answer.");
    expect(within(section()).queryByRole("table")).toBeNull();
    expect(text(section())).not.toContain("Stays");
  });
});
