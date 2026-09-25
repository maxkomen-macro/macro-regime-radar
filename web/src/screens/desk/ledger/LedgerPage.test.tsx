/**
 * Signal Ledger (DESK_FRAME3_SPEC §8) against the §12.4 fixture: four counts,
 * five filters, firing rows first and the quiet ones by verdict in served
 * order, a row opening its study, and Awaiting refresh on a failed /ledger.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import ledger from "../../../fixtures/desk/ledger.json";
import type { LedgerRow } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { applyFilter, byVerdict } from "./LedgerPage";

const rows = ledger.signals as LedgerRow[];

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
  it("sorts the quiet rows by verdict and keeps the served order within one", () => {
    expect(byVerdict(rows.filter((r) => !r.firing_now)).map((r) => r.slug)).toEqual([
      "golden-cross", "rsi-below-30", "vix-spike-2sigma-5d", "gold-2sigma-spx-weak", "hy-2sigma-20d", "spx-20d-2sigma", "death-cross", "rsi-above-70", "oil-2sigma-20d", "spx-5d-2sigma",
    ]);
  });
  it("filters by firing, verdict and group", () => {
    expect(applyFilter(rows, "firing")).toHaveLength(2);
    expect(applyFilter(rows, "reliable")).toHaveLength(3);
    expect(applyFilter(rows, "spx")).toHaveLength(6);
    expect(applyFilter(rows, "cross")).toHaveLength(6);
    expect(applyFilter(rows, "all")).toHaveLength(12);
  });
});

describe("Signal Ledger tab", () => {
  it("the four counts and the grouped table", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByText("Signals scored").parentElement).toHaveTextContent("12"));
    expect(screen.getByText("Firing now", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/2\s*2s10s steepening · dollar weak/);
    expect(screen.getByText("Reliable", { selector: ".dk-stat-label" }).parentElement).toHaveTextContent(/3\s*golden cross · RSI < 30 · VIX spike/);
    // §8: NO EDGE is the count alone; v2 §7's withdrawn "shown so you know it was checked" is gone.
    expect(screen.getByText("No edge", { selector: ".dk-stat-label" }).parentElement?.textContent).toBe("No edge5");
    const table = screen.getByRole("table");
    const groups = within(table).getAllByRole("rowgroup").slice(1);
    expect(groups[0]).toHaveTextContent("Firing now");
    expect(within(groups[0]).getAllByRole("row").slice(1).map((r) => r.querySelector("th")?.textContent)).toEqual(["2s10s +2σ steepening", "Dollar −2σ, 20 days"]);
    expect(groups[1]).toHaveTextContent("Quiet · sorted by verdict");
    const first = within(groups[1]).getAllByRole("row")[1];
    expect(first.textContent).toBe("S&P golden crossJul 1, 20253168%+2.7%+1.4 ptsReliable○ Quiet");
    // §8's footer: no universal normal month; each row is against its own baseline.
    const note = document.querySelector(".lg-note")!;
    expect(note.textContent?.replace(/\u00a0/g, " ")).toBe("vs normal compares each study to its own baseline over its own sample. a month = 20 sessions · engine as of Sep 22");
    // The date never breaks across lines.
    expect(note.textContent).toContain("engine\u00a0as\u00a0of\u00a0Sep\u00a022");
    expect(document.body.textContent).not.toContain("normal month");
  });
  it("a filter narrows the table; a row opens its study in Event Study", async () => {
    renderTab();
    await screen.findByRole("table");
    const group = screen.getByRole("group", { name: "Filter" });
    fireEvent.click(within(group).getByRole("button", { name: "Reliable only" }));
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row").filter((r) => r.querySelector("th[scope=row]"))).toHaveLength(3);
    fireEvent.click(within(table).getByRole("row", { name: /RSI below 30/ }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?preset=rsi-below-30"));
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
    expect(row.textContent).toBe("S&P golden cross—————Reliable○ Quiet");
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
    expect(hy.cells[5].textContent).toBe("+1.4 pts");
    expect(hy.cells[5].querySelector("[title]")?.getAttribute("title")).toBe("log return, ×100");
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
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r, i) => (i === 3 ? { ...r, verdict: "strong", firing_now: null } : r)) }) });
    renderTab();
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /RSI below 30/ });
    expect(row.querySelector(".dk-pill")).toBeNull();
    expect(row.textContent).toBe("RSI below 30Apr 8, 20252273%+3.4%+2.1 pts——");
  });
  it("counts are green only above zero; the sample year follows the earliest served start", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: rows.map((r) => ({ ...r, sample_start: "2000-01-03", verdict: r.verdict === "reliable" ? "suggestive" : r.verdict })) }) });
    renderTab();
    await waitFor(() => expect(screen.getByText("Signals scored").parentElement).toHaveTextContent("since 2000 where history allows"));
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
