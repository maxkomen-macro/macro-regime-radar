import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../../api/client";
import LboPanel, { LboRunState } from "./LboPanel";
import { renderWithProviders, stubFetch } from "../../test/utils";

describe("LboRunState", () => {
  it("says calculating while pending, never 'nothing on file'", () => {
    render(<LboRunState pending fetching={false} error={null} />);
    expect(screen.getByRole("status").textContent).toMatch(/Calculating/);
    expect(document.body.textContent).not.toMatch(/Nothing on file/);
  });
  it("distinguishes unavailable, rejected and unreachable", () => {
    const { rerender } = render(<LboRunState pending={false} fetching={false} error={new ApiError(503, "/api/lbo/run", "engine missing")} />);
    expect(screen.getByRole("status").textContent).toMatch(/unavailable on this server/);
    rerender(<LboRunState pending={false} fetching={false} error={new ApiError(422, "/api/lbo/run", "hold_period too long")} />);
    expect(screen.getByRole("status").textContent).toMatch(/rejected these inputs: hold_period too long/);
    rerender(<LboRunState pending={false} fetching={false} error={new ApiError(0, "/api/lbo/run", "x", "unreachable")} />);
    expect(screen.getByRole("status").textContent).toMatch(/did not answer/);
  });
});

describe("LboPanel cold load", () => {
  it("shows a calculating state between defaults arriving and the first run answering", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    stubFetch({
      "/api/lbo/defaults": () => ({ lbo_all_in_rate: 8.2, fedfunds: 4.3, hy_oas_pct: 3.9, data_as_of: "2026-08-25" }),
      "/api/lbo/run": async () => { await gate; return { result: { viable: false, error_msg: "gated", entry_ev: 800, entry_debt: 450, entry_equity: 400, exit_equity: null, irr: null, moic: null, schedule: [] }, sensitivity: { entry_multiples: [], exit_multiples: [], irr_grid: [] } }; },
    });
    renderWithProviders(<LboPanel />);
    await waitFor(() => expect(document.body.textContent).toMatch(/8\.20%/));
    expect(document.body.textContent).not.toMatch(/Nothing on file/);
    await waitFor(() => expect(document.body.textContent).toMatch(/Calculating the deal model/));
    release();
    await waitFor(() => expect(document.body.textContent).toMatch(/Deal not viable/));
  });
});

/* ── Phase 9 (checklist 09 E.1 row 6): the rebuilt body ────────────────────
 * Appended after the existing cases, which stay byte-identical. The imports
 * below serve the appended cases only (import declarations hoist, so they are
 * valid after other statements). Fixtures: ./__fixtures__/lbo.ts (the
 * deterministic /api/lbo/run stub answering from the posted body). Timers are
 * real for the 300 ms debounce; only `Date` is frozen. Figures are computed
 * from the fixture deal, never the mockup's. */
import { afterEach, beforeEach, vi } from "vitest";
import { fireEvent, within } from "@testing-library/react";
import type { LboRequest } from "../../api/types";
import { fmtMillions } from "../shared/screen-ui";
import { BASE_REQ, LIVE_RATE, NOT_VIABLE_LEGACY, NOW, lboModel, lboRoutes, lboRunFixed, posted } from "./__fixtures__/lbo";

const P9_ROUTE = "/app/tools";
const P9_BASE = lboModel(BASE_REQ);
const P9_LAST = P9_BASE.schedule[P9_BASE.schedule.length - 1];
const P9_SLIDER_LABELS = [
  "Entry EBITDA",
  "EBITDA growth",
  "Entry multiple",
  "Exit multiple",
  "Hold period",
  "Transaction fees",
  "Leverage · Debt/EBITDA",
  "Interest rate (all-in)",
  "Debt amortization",
];
const P9_SCHEDULE_TH = ["Year", "EBITDA", "Implied EV", "Debt start", "Interest", "Paydown", "Debt end", "Leverage"];

/** Text with `hidden` subtrees removed (Jargon tooltips), whitespace collapsed. */
function p9Text(el: Element | null | undefined): string {
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
const p9ById = (id: string) => document.getElementById(id) as HTMLElement | null;
const p9Assumptions = () => p9ById("lbo-assumptions") as HTMLElement;
const p9Outputs = () => p9ById("lbo-outputs") as HTMLElement;
const p9Ranges = () => [...document.querySelectorAll<HTMLInputElement>("input[type='range']")];
const p9SliderRows = () => [...document.querySelectorAll<HTMLElement>(".mrr-slider-row")];
function p9SliderRow(label: string): HTMLElement {
  const row = p9SliderRows().find((r) => p9Text(r.querySelector("label")) === label);
  if (!row) throw new Error(`no slider row labelled ${label}; rows: ${p9SliderRows().map((r) => p9Text(r.querySelector("label"))).join(" | ")}`);
  return row;
}
const p9RangeOf = (label: string) => p9SliderRow(label).querySelector("input[type='range']") as HTMLInputElement;
const p9Reset = () => within(p9Assumptions()).getByRole("button", { name: "Reset to defaults" });
const p9Switch = () => within(p9Assumptions()).getByRole("switch", { name: "Track the live financing rate" });
const p9Status = () => p9Assumptions().querySelector<HTMLElement>('[role="status"]');
const p9Description = () => p9Text(p9Outputs().querySelector(".mrr-sec-desc"));
/** The header's mono meta (`right`); the Tag beside it carries data-tone and is excluded. */
const p9Meta = () => p9Text(p9Outputs().querySelector(".mrr-sec-head .mrr-sec-sp > span:not([data-tone])"));
const p9Badge = () => p9Outputs().querySelector<HTMLElement>(".mrr-sec-head span[data-tone]") as HTMLElement;
/** The StatTile value under a label (the label div's next sibling), inside #lbo-outputs. */
function p9Tile(label: string): string {
  const labels = [...p9Outputs().querySelectorAll<HTMLElement>("div")].filter((d) => p9Text(d) === label && d.nextElementSibling);
  if (labels.length !== 1) throw new Error(`expected one output tile labelled ${label}, found ${labels.length}`);
  return p9Text(labels[0].nextElementSibling);
}
const p9IrrText = (irr: number | null) => `${(irr as number).toFixed(1)}%`;
const p9Results = () => p9Outputs().parentElement as HTMLElement;
const p9Runs = (calls: string[]) => calls.filter((c) => c.startsWith("/api/lbo/run"));
async function p9AwaitOutputs(): Promise<void> {
  await waitFor(() => expect(p9Ranges()).toHaveLength(9));
  await waitFor(() => expect(p9Tile("IRR")).toBe(p9IrrText(P9_BASE.irr)));
}

describe("LboPanel body (checklist 09 E.1 row 6)", () => {
  let calls: string[] = [];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    window.history.replaceState(null, "", P9_ROUTE);
    posted.length = 0;
    calls = stubFetch(lboRoutes()).calls;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("#lbo-assumptions: the Assumptions header with Reset to defaults disabled, the live tile with its switch checked, the caption link into Credit, three group eyebrows, nine ranges each with a tick, data-changed=false, the labels in order and the typed fields", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    expect(within(p9Assumptions()).getByRole("heading", { level: 2, name: "Assumptions" })).toBeInTheDocument();
    expect(p9Reset()).toBeDisabled();
    expect(p9Reset()).toHaveAttribute("title", "Assumptions already match the defaults");
    const tileText = p9Text(p9Assumptions());
    expect(tileText).toContain("Live financing rate");
    expect(tileText).toContain(`${LIVE_RATE.toFixed(2)}%`);
    expect(tileText).toContain("Fed funds 4.33%");
    expect(tileText).toContain("+ HY OAS 2.65%");
    expect(p9Switch()).toHaveAttribute("aria-checked", "true");
    expect(p9Switch()).toBeEnabled();
    expect(tileText).toContain("Fed Funds 4.33% + HY spread 2.65pp, stored through Sep 01, 2026 ·");
    expect(within(p9Assumptions()).getByRole("link", { name: "full financing picture lives in Credit" })).toHaveAttribute("href", "/app/credit#financing");
    for (const group of ["Business", "Entry & exit", "Financing"]) expect(tileText, group).toContain(group);
    expect(p9Ranges()).toHaveLength(9);
    expect(p9Assumptions().querySelectorAll(".mrr-slider-tick")).toHaveLength(9);
    expect(p9SliderRows()).toHaveLength(9);
    for (const row of p9SliderRows()) expect(row).toHaveAttribute("data-changed", "false");
    expect(p9SliderRows().map((r) => p9Text(r.querySelector("label")))).toEqual(P9_SLIDER_LABELS);
    for (const label of P9_SLIDER_LABELS) expect(document.querySelector(`input[aria-label="${label} (typed)"]`), `${label} typed field`).not.toBeNull();
    expect(p9RangeOf("Entry multiple")).toHaveAttribute("aria-label", "Entry multiple");
    expect(p9RangeOf("Leverage · Debt/EBITDA")).toHaveAttribute("aria-label", "Leverage · Debt/EBITDA");
    expect(tileText).toContain("tracking the live all-in cost");
    expect(p9Status()).toBeNull();
    expect(p9Text(p9Assumptions())).not.toContain("│ current reading");
  });

  it("changing the Entry multiple range to 9 posts exactly once after the debounce with entry_multiple 9, flags the row, flips Outputs to Modified with the base-case meta and re-centres the grid; Reset to defaults restores Default without a third POST", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    expect(p9Runs(calls)).toHaveLength(1);
    expect(p9Description()).toBe("Default deal at the live rate");
    expect(p9Text(p9Badge())).toBe("Default");
    expect(p9Badge()).toHaveAttribute("data-tone", "clear");
    expect(p9Meta()).toBe("");

    fireEvent.change(p9RangeOf("Entry multiple"), { target: { value: "9" } });
    const row = p9SliderRow("Entry multiple");
    expect(row).toHaveAttribute("data-changed", "true");
    expect(p9Text(row)).toContain("│ current reading");
    expect(row.querySelector<HTMLInputElement>("input[type='number']")?.style.color).toBe("var(--amber)");
    for (const label of P9_SLIDER_LABELS.filter((l) => l !== "Entry multiple")) expect(p9SliderRow(label), label).toHaveAttribute("data-changed", "false");
    expect(p9Reset()).toBeEnabled();
    expect(p9Reset()).toHaveAttribute("title", "Return every assumption to the default deal at the live rate");
    expect(p9Description()).toBe("Modified deal");
    expect(p9Text(p9Badge())).toBe("Modified");
    expect(p9Badge()).toHaveAttribute("data-tone", "watch");

    await waitFor(() => expect(p9Runs(calls)).toHaveLength(2));
    expect(posted[1]).toEqual({ ...BASE_REQ, entry_multiple: 9 } satisfies LboRequest);
    const mod = lboModel({ ...BASE_REQ, entry_multiple: 9 });
    await waitFor(() => expect(p9Tile("IRR")).toBe(p9IrrText(mod.irr)));
    const d = (mod.irr as number) - (P9_BASE.irr as number);
    expect(p9Meta().replace(/−/g, "-")).toBe(
      `base case: IRR ${p9IrrText(P9_BASE.irr)} · MOIC ${(P9_BASE.moic as number).toFixed(2)}× · Δ IRR ${d >= 0 ? "+" : ""}${d.toFixed(1)} pp`,
    );
    const grid = p9ById("lbo-sensitivity")!.querySelector('[role="table"]') as HTMLElement;
    const outlined = [...grid.querySelectorAll<HTMLElement>('[role="cell"]')].filter((c) => (c.getAttribute("style") ?? "").includes("outline: 1.5px solid"));
    expect(outlined).toHaveLength(1);
    expect(p9Text(outlined[0])).toBe(p9IrrText(mod.irr));
    expect([...grid.querySelectorAll('[role="rowheader"]')].map((r) => p9Text(r))).toEqual(["8.0×", "8.5×", "9.0×", "9.5×", "10.0×"]);

    fireEvent.click(p9Reset());
    for (const r of p9SliderRows()) expect(r).toHaveAttribute("data-changed", "false");
    expect(p9Text(p9Assumptions())).not.toContain("│ current reading");
    expect(p9Description()).toBe("Default deal at the live rate");
    expect(p9Text(p9Badge())).toBe("Default");
    expect(p9Badge()).toHaveAttribute("data-tone", "clear");
    await waitFor(() => expect(p9Tile("IRR")).toBe(p9IrrText(P9_BASE.irr)));
    expect(p9Meta()).toBe("");
    expect(p9Reset()).toBeDisabled();
    await new Promise((r) => setTimeout(r, 400));
    expect(p9Runs(calls)).toHaveLength(2);
  });

  it("the live-rate switch: checked at rest, unchecked after the rate range moves with the manual-rate note and its back-to-live button, and clicking the switch returns the slider to the live rate and the tracking note", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    expect(p9Switch()).toHaveAttribute("aria-checked", "true");
    fireEvent.change(p9RangeOf("Interest rate (all-in)"), { target: { value: "7.5" } });
    const row = p9SliderRow("Interest rate (all-in)");
    expect(row).toHaveAttribute("data-changed", "true");
    expect(p9Switch()).toHaveAttribute("aria-checked", "false");
    expect(p9Text(row)).toContain("manual rate ·");
    expect(within(row).getByRole("button", { name: /back to live 6\.98%/ })).toBeInTheDocument();
    expect(p9Text(row)).not.toContain("tracking the live all-in cost");
    fireEvent.click(p9Switch());
    expect(p9Switch()).toHaveAttribute("aria-checked", "true");
    expect(p9RangeOf("Interest rate (all-in)").value).toBe(String(LIVE_RATE));
    expect(row).toHaveAttribute("data-changed", "false");
    expect(p9Text(row)).toContain("tracking the live all-in cost");
    expect(p9Text(row)).not.toContain("manual rate");
  });

  it("the market-check caption (U17) is the last child of the results column, names today's live all-in cost at rest and drops the clause after a manual rate", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    await waitFor(() => expect(p9ById("lbo-schedule")).not.toBeNull());
    const last = () => p9Results().lastElementChild as HTMLElement;
    expect(p9Text(last())).toBe(
      `One check on the market: this deal borrows at ${LIVE_RATE.toFixed(2)}%, today's live all-in cost. Pre-GFC deals financed near ~7%; if the rate slider has to fall below reality to make the returns work, the market is telling you the price is wrong.`,
    );
    fireEvent.change(p9RangeOf("Interest rate (all-in)"), { target: { value: "7.5" } });
    await waitFor(() => expect(posted.some((b) => b.interest_rate === 7.5)).toBe(true));
    await waitFor(() => expect(p9Text(last())).toContain("borrows at 7.50%."));
    expect(p9Text(last())).not.toContain("today's live all-in cost");
    expect(p9Text(last())).toContain("Pre-GFC deals financed near ~7%");
  });

  it("the warnings block: absent at the defaults; leverage 8 on entry 8 renders meets or exceeds in the assumptions status and turns Outputs into Deal not viable with the server's dash cleaned; Reset clears both", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    expect(p9Status()).toBeNull();
    fireEvent.change(p9RangeOf("Leverage · Debt/EBITDA"), { target: { value: "8" } });
    expect(p9Status()).not.toBeNull();
    expect(p9Status()).toHaveAttribute("aria-live", "polite");
    expect(p9Text(p9Status())).toContain("meets or exceeds");
    expect(p9Text(p9Status())).toContain("debt covers the whole purchase price and the equity check goes to zero or below.");
    await waitFor(() => expect(p9Text(p9Outputs())).toContain("Deal not viable:"));
    const out = p9Text(p9Outputs());
    expect(out).toContain("Deal not viable: Leverage too high; debt exceeds entry EV plus fees");
    expect(out).not.toContain("—");
    expect(out).toContain("Ease leverage or the entry multiple until the equity check turns positive.");
    expect(p9Description()).toBe("Modified deal");
    expect(p9ById("lbo-schedule")).toBeNull();
    fireEvent.click(p9Reset());
    expect(p9Status()).toBeNull();
    await waitFor(() => expect(p9Tile("IRR")).toBe(p9IrrText(P9_BASE.irr)));
    expect(p9Text(p9Outputs())).not.toContain("Deal not viable");
  });

  it("#lbo-schedule: Annual debt schedule with the $ millions description, eight th in order, a Close row plus hold_period rows, the last year reading 5 · exit, and the paydown and leverage arithmetic on served rows", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    await waitFor(() => expect(p9ById("lbo-schedule")).not.toBeNull());
    const schedule = p9ById("lbo-schedule") as HTMLElement;
    expect(within(schedule).getByRole("heading", { level: 2, name: "Annual debt schedule" })).toBeInTheDocument();
    expect(p9Text(schedule.querySelector(".mrr-sec-desc"))).toBe("$ millions");
    expect([...schedule.querySelectorAll("th")].map((th) => p9Text(th))).toEqual(P9_SCHEDULE_TH);
    const rows = [...schedule.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(1 + BASE_REQ.hold_period);
    const cells = (tr: Element) => [...tr.querySelectorAll("td")].map((td) => p9Text(td));
    const close = cells(rows[0]);
    expect(close[0]).toBe("Close");
    expect(close[1]).toBe(BASE_REQ.ebitda.toFixed(1));
    expect(close[6]).toBe(P9_BASE.entry_debt.toFixed(1));
    expect(close[7]).toBe(`${BASE_REQ.leverage_ratio.toFixed(1)}×`);
    const last = cells(rows[rows.length - 1]);
    expect(last[0]).toBe(`${BASE_REQ.hold_period} · exit`);
    expect(last[1]).toBe(P9_LAST.ebitda.toFixed(1));
    expect(last[2]).toBe(P9_LAST.implied_ev.toFixed(1));
    expect(last[3]).toBe(P9_LAST.debt_start.toFixed(1));
    expect(last[4]).toBe(P9_LAST.interest.toFixed(1));
    expect(last[5]).toBe((P9_LAST.debt_start - P9_LAST.debt_end).toFixed(1));
    expect(last[6]).toBe(P9_LAST.debt_end.toFixed(1));
    expect(last[7]).toBe(`${(P9_LAST.debt_end / P9_LAST.ebitda).toFixed(1)}×`);
    expect(cells(rows[1])[0]).toBe("1");
    expect(p9Text(schedule)).toContain(`amortization retires ${BASE_REQ.amortization_rate.toFixed(0)}% of the original debt each year`);
  });

  it("#lbo-sensitivity: the IRR grid with the corner Entry ↓, five column and row headers, exactly one outlined cell equal to the IRR tile, an n/a cell, the three legend strings and the meta; no Rate × leverage button and no IRR vs financing rate heading", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    await waitFor(() => expect(p9ById("lbo-sensitivity")).not.toBeNull());
    const section = p9ById("lbo-sensitivity") as HTMLElement;
    expect(within(section).getByRole("heading", { level: 2, name: "IRR sensitivity" })).toBeInTheDocument();
    expect(p9Text(section.querySelector(".mrr-sec-sp"))).toContain("entry × exit multiple");
    const grid = section.querySelector('[role="table"]') as HTMLElement;
    expect(grid).toHaveAttribute("aria-label", "IRR sensitivity: entry vs exit multiple");
    const cols = [...grid.querySelectorAll('[role="columnheader"]')].map((c) => p9Text(c));
    expect(cols[0]).toBe("Entry ↓");
    expect(cols.slice(1)).toEqual(["8.0×", "8.5×", "9.0×", "9.5×", "10.0×"]);
    expect([...grid.querySelectorAll('[role="rowheader"]')].map((r) => p9Text(r))).toEqual(["7.0×", "7.5×", "8.0×", "8.5×", "9.0×"]);
    const cells = [...grid.querySelectorAll<HTMLElement>('[role="cell"]')];
    expect(cells).toHaveLength(25);
    const outlined = cells.filter((c) => (c.getAttribute("style") ?? "").includes("outline: 1.5px solid"));
    expect(outlined).toHaveLength(1);
    expect(p9Text(outlined[0])).toBe(p9Tile("IRR"));
    expect(cells.filter((c) => p9Text(c) === "n/a")).toHaveLength(1);
    const legend = p9Text(section.querySelector(".mrr-heat-legend"));
    for (const s of ["20% or more", "Below 15%", "Exit multiple →"]) expect(legend).toContain(s);
    expect(p9Text(section)).toContain("The outlined cell is the current scenario.");
    expect(screen.queryByRole("button", { name: /Rate × leverage/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /IRR vs financing rate/i })).toBeNull();
    expect(p9Text(document.body)).not.toMatch(/IRR vs financing rate/i);
  });

  it("the four output tiles: IRR in the ramp colour, MOIC, the signed equity gain, and Debt at exit printing fmtMillions(exit_debt) with the ratio caption; the T13 caption covers sources and uses", async () => {
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await p9AwaitOutputs();
    expect(p9Tile("IRR")).toBe(p9IrrText(P9_BASE.irr));
    expect(p9Tile("MOIC")).toBe(`${(P9_BASE.moic as number).toFixed(2)}×`);
    expect(p9Tile("Equity gain")).toBe(`+${fmtMillions(P9_BASE.equity_gain as number)}`);
    expect(p9Tile("Debt at exit")).toBe(fmtMillions(P9_BASE.exit_debt as number));
    const out = p9Text(p9Outputs());
    expect(out).toContain(`Annualized, ${BASE_REQ.hold_period} years`);
    expect(out).toContain("Exit equity ÷ entry equity");
    expect(out).toContain(`On ${fmtMillions(P9_BASE.entry_equity)} invested`);
    expect(out).toContain(`${((P9_BASE.exit_debt as number) / P9_LAST.ebitda).toFixed(1)}× EBITDA, from ${BASE_REQ.leverage_ratio.toFixed(1)}×`);
    expect(out).toContain("Sources cover uses");
    expect(out).toContain(`${fmtMillions(P9_BASE.entry_equity)} of equity in`);
    const irrSpan = [...p9Outputs().querySelectorAll<HTMLElement>("span")].find((s) => p9Text(s) === p9IrrText(P9_BASE.irr) && s.style.color !== "");
    expect(irrSpan?.style.color).toBe("var(--amber)");
    expect(out).not.toContain("—");
  });

  it("the legacy not-viable shape (schedule empty, no exit_debt on the wire) still renders Deal not viable", async () => {
    stubFetch(lboRoutes({ "/api/lbo/run": lboRunFixed(NOT_VIABLE_LEGACY) }));
    renderWithProviders(<LboPanel />, { route: P9_ROUTE });
    await waitFor(() => expect(p9Text(p9Outputs())).toContain("Deal not viable: gated"));
    expect(p9ById("lbo-schedule")).toBeNull();
    expect(p9Text(p9Outputs())).not.toContain("Nothing on file");
  });
});
