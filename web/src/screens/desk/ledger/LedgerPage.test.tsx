/**
 * Signal Ledger (DESK_FRAME3_SPEC §8) against the §12.5 fixture (the audit's
 * real rows): four counts, five filters, the twelve rows in exactly the
 * served fixed order (v3 §2), a row opening its study, and Awaiting refresh
 * on a failed /ledger.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import ledger from "../../../fixtures/desk/ledger.json";
import type { LedgerRow } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { applyFilter, countable } from "./LedgerPage";

const rows = ledger.signals as LedgerRow[];
/** The fixture with the 2s10s row firing today on the comparison session (the real snapshot fires nothing). */
const firingRows = () => rows.map((r) => (r.slug === "2s10s-2sigma-steepening" ? { ...r, firing_now: true, firing_day: 10, stale: false } : r));
/** v3 §2's fixed order of the twelve rows, by label. */
const FIXED = ["2s10s +2σ steepening", "Dollar −2σ, 20 days", "S&P golden cross", "RSI below 30", "VIX spike +2σ, 5 days", "Gold +2σ while S&P weak", "HY spreads +2σ, 20 days", "S&P 20-day move over 2σ", "S&P death cross", "RSI above 70", "Oil +2σ, 20 days", "S&P 5-day move over 2σ"];

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderTab() {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route: "/desk/signal-ledger" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Ledger order and filters", () => {
  it("the fixture serves the twelve rows in v3 §2's fixed order", () => {
    expect(rows.map((r) => r.label)).toEqual(FIXED);
  });
  it("filters by firing, verdict and group; an unavailable row never counts as firing or Reliable (§8, v4 B-02)", () => {
    expect(applyFilter(rows, "firing")).toHaveLength(0);
    expect(applyFilter(firingRows(), "firing").map((r) => r.slug)).toEqual(["2s10s-2sigma-steepening"]);
    expect(applyFilter(rows, "reliable").map((r) => r.slug)).toEqual(["golden-cross"]);
    expect(applyFilter(rows, "spx")).toHaveLength(6);
    expect(applyFilter(rows, "cross")).toHaveLength(6);
    expect(applyFilter(rows, "all")).toHaveLength(12);
    // A stale row is never called firing today (v3 §3).
    expect(applyFilter(rows.map((r) => ({ ...r, stale: true })), "firing")).toHaveLength(0);
  });
});

describe("Signal Ledger tab", () => {
  it("the four counts and the table in the served fixed order, with no groups", async () => {
    renderTab();
    // §8, v4 B-02: SIGNALS SCORED is scored_n, "<scored_n> scored · <unavailable_n> not yet served"; the rest count available rows only.
    await waitFor(() => expect(screen.getByText("Signals scored").parentElement?.textContent).toBe("Signals scored1010 scored · 2 not yet served"));
    expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/0\s*none/);
    expect(screen.getByText("Reliable", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/1\s*golden cross/);
    // §8: NO EDGE is the count alone; v2 §7's withdrawn "shown so you know it was checked" is gone.
    expect(screen.getByText("No edge", { selector: ".dk-stat-label" }).parentElement?.textContent).toBe("No edge6");
    const table = screen.getByRole("table");
    // §8: exactly the fixed order, one body, no group rows.
    expect(within(table).getAllByRole("rowgroup")).toHaveLength(2);
    expect(within(table).getAllByRole("row").slice(1).map((r) => r.querySelector("th")?.textContent)).toEqual(FIXED);
    expect(table).not.toHaveTextContent(/Quiet · sorted|Firing now/);
    // An unavailable row keeps its label and prints its reason across the value columns, with no pill (§8).
    const dollar = within(table).getAllByRole("row").find((r) => r.querySelector("th")?.textContent === "Dollar −2σ, 20 days")!;
    expect(dollar.textContent).toBe("Dollar −2σ, 20 daysUS Dollar Index (DX-Y.NYB) is not stored in this database: it is a tier 2 series, and the full refresh stores tier 1 only.");
    expect(dollar.querySelector("td")?.getAttribute("colspan")).toBe("7");
    expect(dollar.querySelector(".dk-pill")).toBeNull();
    expect(dollar).not.toHaveAttribute("tabindex");
    const rowOf = (label: string) => within(table).getAllByRole("row").find((r) => r.querySelector("th")?.textContent === label)!;
    expect(rowOf("2s10s +2σ steepening").textContent).toBe("2s10s +2σ steepeningApr 21, 20254971%+1.6%+0.3 ptsNo edge○ Quiet");
    // The golden cross last evaluated on Sep 21 (the 2026-09-22 close is missing): stale, never quiet or firing (v3 §3).
    expect(rowOf("S&P golden cross").textContent).toBe("S&P golden crossJul 1, 20251479%+2.7%+1.4 ptsReliable○ Stale · Sep 21");
    // desk/fill-compute: the two RSI rows are scored like the others (the engine on the audit's store).
    expect(rowOf("RSI below 30").textContent).toBe("RSI below 30Mar 20, 20264573%+2.8%+1.5 ptsNo edge○ Stale · Sep 21");
    expect(rowOf("RSI above 70").textContent).toBe("RSI above 70May 26, 20268963%+1.4%+0.1 ptsNo edge○ Stale · Sep 21");
    // §8's footer: no universal normal month; each row is against its own baseline.
    const note = document.querySelector(".lg-note")!;
    expect(note.textContent?.replace(/\u00a0/g, " ")).toBe("vs normal compares each study to its own baseline over its own sample. a month = 20 sessions · engine as of Sep 24");
    // The date never breaks across lines.
    expect(note.textContent).toContain("engine\u00a0as\u00a0of\u00a0Sep\u00a024");
    expect(document.body.textContent).not.toContain("normal month");
  });
  it("a filter narrows the table; a row opens its study in Event Study", async () => {
    renderTab();
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Filter" });
    fireEvent.click(within(group).getByRole("button", { name: "Reliable only" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").filter((r) => r.querySelector("th[scope=row]"))).toHaveLength(1);
    fireEvent.click(within(table).getByRole("row", { name: /S&P golden cross/ }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?preset=golden-cross"));
  });
  it("a row opens from the keyboard too (Enter)", async () => {
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /S&P golden cross/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?preset=golden-cross"));
  });
  it("a filter with no match says so; nothing firing leaves the count plain", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => ({ ...r, firing_now: false })) }) });
    renderTab();
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Filter" });
    await waitFor(() => expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/0\s*none/));
    expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement?.querySelector(".dk-stat-value")).not.toHaveAttribute("data-tone", "green");
    fireEvent.click(within(group).getByRole("button", { name: "Firing now" }));
    expect(screen.getByText("No signal matches this filter.")).toBeInTheDocument();
  });
  it("a signal's missing values print a dash, never 'null' or a zero", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r, i) => (i === 2 ? { ...r, n: null, last_fired: null, up_pct: null, median: null, vs_normal: null } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /S&P golden cross/ });
    expect(row.textContent).toBe("S&P golden cross—————Reliable○ Stale · Sep 21");
  });
  it("each row's median prints in its own served unit: bp for a yield target, log percent with its tooltip, a dash without a unit (§1.9)", async () => {
    stubDesk({
      "/api/desk/ledger": () => ({
        ...ledger,
        signals: rows.map((r, i) => (i === 0 ? { ...r, median: 12.5, target_unit: "bp", display_unit: "bp" } : i === 2 ? { ...r, target_unit: null, display_unit: null } : r)),
      }),
    });
    renderTab();
    const table = await screen.findByRole("table");
    const bp = within(table).getByRole("row", { name: /2s10s \+2σ steepening/ });
    expect(bp).toHaveTextContent("+12.5 bp");
    expect(bp.querySelector('[title="log return, ×100"]')).toBeNull();
    expect((within(table).getByRole("row", { name: /S&P golden cross/ }) as HTMLTableRowElement).cells[4].textContent).toBe("—");
    const gold = within(table).getByRole("row", { name: /Gold \+2σ while S&P weak/ }) as HTMLTableRowElement;
    expect(gold.cells[4].textContent).toBe("+3.1%");
    expect(gold.cells[4].querySelector("[title]")?.getAttribute("title")).toBe("log return, ×100");
  });
  it("a Too few row carries the dashed Too few pill; the footer prints the four §1.5 definitions word for word (B-13)", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r, i) => (i === 0 ? { ...r, verdict: "insufficient", n: 6 } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const pill = within(within(table).getByRole("row", { name: /2s10s \+2σ steepening/ })).getByText("Too few");
    expect(pill).toHaveAttribute("data-verdict", "insufficient");
    const defs = [...document.querySelectorAll(".lg-foot .dk-defs > div")].map((d) => [...d.children].map((c) => c.textContent?.trim()).join(" "));
    expect(defs).toEqual([
      "Reliable — at least ten overlap blocks, with the engine's 90% interval and adverse-share requirements met; zero counts as adverse.",
      "Suggestive — 10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all Reliable criteria are met.",
      "No edge — at least ten completed outcomes at this horizon, without Reliable evidence or a consistent nonzero excess-median sign across 5, 10 and 20 sessions.",
      "Too few — fewer than ten completed outcomes at this horizon.",
    ]);
  });
  it("vs normal is each row's own served excess over its own baseline, in its own unit (§1.9, v3 §6)", async () => {
    // Every row served: vs_normal = 100 × (median − baseline_median) for a log target.
    for (const r of rows) if (r.median != null && r.baseline_median != null && r.vs_normal != null) expect(r.vs_normal).toBeCloseTo(100 * (r.median - r.baseline_median), 6);
    // No two ways of saying normal: the rows' baselines differ (HY's short sample most of all).
    expect(new Set(rows.map((r) => r.baseline_median)).size).toBeGreaterThan(1);
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r, i) => (i === 0 ? { ...r, median: 12.5, baseline_median: 6.5, vs_normal: 6, target_unit: "bp", display_unit: "bp" } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const bp = within(table).getByRole("row", { name: /2s10s \+2σ steepening/ }) as HTMLTableRowElement;
    expect([bp.cells[4].textContent, bp.cells[5].textContent]).toEqual(["+12.5 bp", "+6 bp"]);
    const hy = within(table).getByRole("row", { name: /HY spreads/ }) as HTMLTableRowElement;
    expect(hy.cells[5].textContent).toBe("−5.2 pts");
    expect(hy.cells[5].querySelector("[title]")?.getAttribute("title")).toBe("log return, ×100");
  });
  it("NOW reads '○ Stale · <evaluated_on>' when a row's last evaluable session is not the comparison session, never Firing (§8, v3 §3)", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => (r.slug === "2s10s-2sigma-steepening" ? { ...r, stale: true, evaluated_on: "2026-09-19" } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /2s10s/ }) as HTMLTableRowElement;
    expect(row.cells[row.cells.length - 1].textContent).toBe("○ Stale · Sep 19");
    expect(row).not.toHaveAttribute("data-firing");
    expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/0\s*none/);
  });
  it("NOW reads '—' when the state is not served, even served stale with no session (§8)", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => (r.slug === "2s10s-2sigma-steepening" ? { ...r, firing_now: null, firing_day: null, evaluated_on: null, stale: true } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /2s10s/ }) as HTMLTableRowElement;
    const now = row.cells[row.cells.length - 1];
    expect(now.textContent).toBe("—");
    expect(now).not.toHaveAttribute("title");
    expect(now).not.toHaveAttribute("data-tone");
  });
  it("NOW reads '● Firing · day <n>' and its tooltip names the session each row was evaluated on (§8, §12.5)", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: firingRows() }) });
    renderTab();
    const table = await screen.findByRole("table");
    const firing = within(table).getByRole("row", { name: /2s10s/ }) as HTMLTableRowElement;
    const now = firing.cells[firing.cells.length - 1];
    expect(now.textContent).toBe("● Firing · day 10");
    expect(now).toHaveAttribute("title", "evaluated on Sep 23, 2026");
    const stale = within(table).getByRole("row", { name: /S&P golden cross/ }) as HTMLTableRowElement;
    expect(stale.cells[stale.cells.length - 1]).toHaveAttribute("title", "evaluated on Sep 21, 2026");
  });
  it("Space opens a row too; a chip shows it is pressed", async () => {
    renderTab();
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Filter" });
    const chip = within(group).getByRole("button", { name: "S&P only" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "All 12" })).toHaveAttribute("aria-pressed", "false");
    const row = within(screen.getByRole("table")).getByRole("row", { name: /S&P death cross/ });
    fireEvent.keyDown(row, { key: " " });
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?preset=death-cross"));
  });
  it("an unknown verdict prints a dash, not an empty pill; an unknown firing state is not 'Quiet' (L-3, L-9)", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r, i) => (i === 4 ? { ...r, verdict: "strong", firing_now: null } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /VIX spike/ });
    expect(row.querySelector(".dk-pill")).toBeNull();
    expect(row.textContent).toBe("VIX spike +2σ, 5 daysJun 5, 202611966%+1.5%+0.2 pts——");
  });
  it("Codex R-21: a count whose field is missing on any row says Awaiting refresh, never a number", async () => {
    const stat = (label: string) => screen.getByText(label, { selector: ".dk-stat-label" }).parentElement!;
    const without = (r: LedgerRow, k: keyof LedgerRow) => {
      const c = { ...r } as Record<string, unknown>;
      delete c[k];
      return c;
    };
    // An available row with no verdict: Reliable and No edge wait; Firing now still counts.
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => (r.slug === "golden-cross" ? without(r, "verdict") : r)) }) });
    const a = renderTab();
    await waitFor(() => expect(stat("Reliable")).toHaveTextContent(/Reliable\s*Awaiting refresh/));
    expect(stat("No edge")).toHaveTextContent(/No edge\s*Awaiting refresh/);
    expect(stat("Firing now")).toHaveTextContent(/Firing now\s*0\s*none/);
    a.unmount();
    // An available row with no firing state: Firing now waits; the verdicts still count.
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => (r.slug === "death-cross" ? without(r, "firing_now") : r)) }) });
    const b = renderTab();
    await waitFor(() => expect(stat("Firing now")).toHaveTextContent(/Firing now\s*Awaiting refresh/));
    expect(stat("Reliable")).toHaveTextContent(/Reliable\s*1/);
    b.unmount();
    // A row that does not say whether it is available, and no served scored_n: nothing is counted from the rows.
    const { scored_n: _s, unavailable_n: _u, ...rest } = ledger;
    void [_s, _u];
    stubDesk({ "/api/desk/ledger": () => ({ ...rest, signals: rows.map((r) => (r.slug === "rsi-above-70" ? without(r, "available") : r)) }) });
    renderTab();
    await waitFor(() => expect(stat("Signals scored")).toHaveTextContent(/Signals scored\s*Awaiting refresh/));
    for (const l of ["Firing now", "Reliable", "No edge"]) expect(stat(l)).toHaveTextContent(new RegExp(`${l}\\s*Awaiting refresh`));
    // An unavailable row needs neither a verdict nor a firing state: the fixture's four count as they are.
  });

  it("Codex R-30: one available row with firing_now null (stale false) leaves Firing now uncounted, Awaiting refresh", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => (r.slug === "spx-5d-2sigma" ? { ...r, available: true, firing_now: null, stale: false } : r)) }) });
    renderTab();
    const stat = (label: string) => screen.getByText(label, { selector: ".dk-stat-label" }).parentElement!;
    await waitFor(() => expect(stat("Firing now")).toHaveTextContent(/Firing now\s*Awaiting refresh/));
    expect(stat("Firing now").querySelector(".dk-stat-value")).toBeNull();
    expect(stat("Firing now")).not.toHaveTextContent(/none/);
    // The verdict counts do not read the firing state: they still count.
    expect(stat("Reliable")).toHaveTextContent(/Reliable\s*1/);
    expect(countable(rows.map((r) => (r.slug === "spx-5d-2sigma" ? { ...r, firing_now: null } : r))).firing).toBe(false);
    // An unavailable row's null state needs no boolean: the fixture as served counts.
    expect(countable(rows).firing).toBe(true);
  });

  it("counts are green only above zero", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: firingRows().map((r) => ({ ...r, verdict: r.verdict === "reliable" ? "suggestive" : r.verdict })) }) });
    renderTab();
    await waitFor(() => expect(screen.getByText("Signals scored").parentElement).toHaveTextContent("10 scored"));
    const reliable = screen.getByText("Reliable", { selector: ".dk-stat-label" }).parentElement;
    expect(reliable).toHaveTextContent(/0\s*none/);
    expect(reliable?.querySelector(".dk-stat-value")).not.toHaveAttribute("data-tone", "green");
    expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement?.querySelector(".dk-stat-value")).toHaveAttribute("data-tone", "green");
  });
  it("without an as-of, the badge and the note's date are left out (L-8)", async () => {
    const { as_of: _a, ...rest } = ledger;
    void _a;
    // §12.0: `as_of` lives on the envelope; this answer's is null.
    const { generation_id: _g, ...payload } = rest;
    void _g;
    stubDesk({ "/api/desk/ledger": () => ({ status: "ready", generation_id: "g", as_of: null, engine_version: "fixture", data: payload, unavailable: null, error: null }) });
    renderTab();
    await screen.findByRole("table");
    expect(document.querySelector(".lg-note")?.textContent?.replace(/\u00a0/g, " ")).toBe("vs normal compares each study to its own baseline over its own sample. a month = 20 sessions");
    expect(screen.queryByText(/engine as of/)).toBeNull();
  });
  it("the chips wait for the table", async () => {
    stubDesk({ "/api/desk/ledger": deskError(503, "warming") });
    renderTab();
    await waitFor(() => expect(screen.getAllByText("Awaiting refresh").length).toBeGreaterThan(0));
    expect(within(screen.getByRole("group", { name: "Filter" })).getByRole("button", { name: "Firing now" })).toBeDisabled();
  });
  it("while loading, the counts are busy and none says Awaiting refresh (D14)", async () => {
    stubDesk({ "/api/desk/ledger": () => new Promise(() => {}) });
    renderTab();
    await screen.findByText("Signals scored");
    expect(document.querySelector(".lg-stats")).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector(".lg")?.textContent).not.toContain("Awaiting refresh");
  });
  it("a failed /ledger keeps the counts' labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/ledger": deskError(503, "warming") });
    renderTab();
    await waitFor(() => expect(screen.getAllByText("Awaiting refresh").length).toBeGreaterThan(0));
    expect(screen.getByText("Signals scored")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
