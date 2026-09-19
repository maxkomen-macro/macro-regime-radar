/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 5,
 * `tools/ToolsScreen.test.tsx`: the Tools composition (B.0): the hash to
 * sub-tab prefix rule (D), the hero row of the active tool above the SubTabs,
 * the section ids per sub-tab, the DisclosureLine closing each, and the hero
 * note following a slider change. renderWithProviders + stubFetch with the
 * LBO routes (./__fixtures__/lbo.ts) and the full allocation fixture
 * (./__fixtures__/allocation.ts); unmatched paths 404. Timers are real for the
 * 300 ms debounce; only `Date` is frozen. Figures come from the fixtures,
 * never the mockup's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import ToolsScreen, { subtabFromHash } from "./ToolsScreen";
import { NO_SHELL_ACTIONS, ShellActionsContext, type ShellActions } from "../shell/shell-actions";
import { renderWithProviders, stubFetch } from "../../test/utils";
import { BASE_REQ, NOW, lboModel, lboRoutes, posted } from "./__fixtures__/lbo";
import { FULL } from "./__fixtures__/allocation";

const ROUTE = "/app/tools";
const BASE_RES = lboModel(BASE_REQ);
const H1_LBO = `${(BASE_RES.irr as number).toFixed(1)}% IRR`;
const H1_ALLOCATION = "SPY"; // the fixture's leading Goldilocks asset
const LBO_IDS = ["lbo-hero", "lbo-summary", "lbo", "lbo-assumptions", "lbo-outputs"];
const ALLOCATION_IDS = ["allocation-hero", "allocation-summary", "allocation", "allocation-overview", "allocation-optimization", "allocation-risk"];
const LBO_DISCLOSURE =
  "An illustrative model for teaching and screening, not a transaction model. Taxes, capex and working capital are simplified into one assumption: cash for debt service is 60% of EBITDA. It pays interest first, scheduled amortization is a floor and the remainder sweeps to debt, so a higher rate lowers the IRR. The live rate is Fed funds plus the ICE BofA HY OAS (BAMLH0A0HYM2) from FRED, stored through Sep 01, 2026.";
const ALLOCATION_DISCLOSURE =
  "Monthly total returns for 10 asset classes, index-spliced before ETF inceptions · computed by the same allocation engine each session · regimes from the stored classifier history.";

/* ── routes and harness ──────────────────────────────────────────────────── */

let calls: string[] = [];
function stub() {
  calls = stubFetch({ ...lboRoutes(), "/api/allocation": () => FULL, "/api/regime/latest": () => ({ label: "Goldilocks" }) }).calls;
}
const runs = () => calls.filter((c) => c.startsWith("/api/lbo/run"));

function renderTools({ route = ROUTE, actions = {} }: { route?: string; actions?: Partial<ShellActions> } = {}) {
  return renderWithProviders(
    <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, ...actions }}>
      <main id="main-content">
        <ToolsScreen />
      </main>
    </ShellActionsContext.Provider>,
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
const main = () => document.querySelector("main") as HTMLElement;
const h1s = () => [...document.querySelectorAll("h1")];
const tab = (name: RegExp) => screen.getByRole("tab", { name });
const disclosureLines = () => [...main().querySelectorAll<HTMLElement>(".mrr-disclosure-line")];
/** True when nothing follows the element on the way up to <main>. */
function isLastInMain(el: Element): boolean {
  let n: Element | null = el;
  while (n && n !== main()) {
    if (n.nextElementSibling) return false;
    n = n.parentElement;
  }
  return n === main();
}
const sliderRow = (label: string) => {
  const row = [...document.querySelectorAll<HTMLElement>(".mrr-slider-row")].find((r) => text(r.querySelector("label")) === label);
  if (!row) throw new Error(`no slider row labelled ${label}`);
  return row;
};
const rangeOf = (label: string) => sliderRow(label).querySelector("input[type='range']") as HTMLInputElement;
const note = () => byId("lbo-hero")?.querySelector<HTMLElement>(".mrr-hero-note") ?? null;
const awaitLbo = () => screen.findByRole("heading", { level: 1, name: H1_LBO });
const awaitAllocation = () => screen.findByRole("heading", { level: 1, name: H1_ALLOCATION });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", ROUTE);
  posted.length = 0;
  stub();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("subtabFromHash (checklist 09 D, the prefix rule)", () => {
  it("maps the section ids and their prefixed anchors to their sub-tab, and everything else to lbo", () => {
    expect(subtabFromHash("")).toBe("lbo");
    expect(subtabFromHash("#lbo")).toBe("lbo");
    expect(subtabFromHash("#allocation")).toBe("allocation");
    expect(subtabFromHash("#allocation-risk")).toBe("allocation");
    expect(subtabFromHash("#allocation-optimization")).toBe("allocation");
    expect(subtabFromHash("#lbo-sensitivity")).toBe("lbo");
    expect(subtabFromHash("#lbo-assumptions")).toBe("lbo");
    expect(subtabFromHash("#allocationx")).toBe("lbo");
    expect(subtabFromHash("#unknown")).toBe("lbo");
  });
});

describe("ToolsScreen (checklist 09 E.1 row 5)", () => {
  it("/app/tools renders the LBO hero row above the tablist, #lbo, one h1 ending IRR, the LBO tab selected, the LBO ids and the LBO disclosure line last in main", async () => {
    renderTools();
    const h1 = await awaitLbo();
    expect(h1s()).toHaveLength(1);
    expect(text(h1)).toMatch(/ IRR$/);
    expect(byId("lbo-hero")?.contains(h1)).toBe(true);
    expect(tab(/LBO calculator/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/Asset allocation/)).toHaveAttribute("aria-selected", "false");
    for (const id of LBO_IDS) expect(byId(id), id).not.toBeNull();
    for (const id of ALLOCATION_IDS) expect(byId(id), id).toBeNull();
    // The hero row sits above the tablist, outside the tabpanel.
    const tablist = screen.getByRole("tablist", { name: "Tools" });
    expect(byId("lbo-hero")!.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("tabpanel").contains(byId("lbo-hero"))).toBe(false);
    expect(screen.getByRole("tabpanel").contains(byId("lbo"))).toBe(true);
    await waitFor(() => expect(byId("lbo-schedule")).not.toBeNull());
    expect(byId("lbo-sensitivity")).not.toBeNull();
    const lines = disclosureLines();
    expect(lines).toHaveLength(1);
    expect(lines[0].tagName).toBe("P");
    expect(text(lines[0])).toBe(LBO_DISCLOSURE);
    expect(isLastInMain(lines[0])).toBe(true);
  });

  it("/app/tools#allocation-risk selects Asset allocation by the prefix rule, renders #allocation-risk and the allocation ids, and posts no LBO run while the LBO tool is inactive", async () => {
    renderTools({ route: `${ROUTE}#allocation-risk` });
    await awaitAllocation();
    expect(tab(/Asset allocation/)).toHaveAttribute("aria-selected", "true");
    expect(tab(/LBO calculator/)).toHaveAttribute("aria-selected", "false");
    for (const id of ALLOCATION_IDS) expect(byId(id), id).not.toBeNull();
    for (const id of LBO_IDS) expect(byId(id), id).toBeNull();
    expect(h1s()).toHaveLength(1);
    expect(text(h1s()[0])).not.toMatch(/ IRR$/);
    await new Promise((r) => setTimeout(r, 400));
    expect(runs()).toHaveLength(0);
    expect(posted).toHaveLength(0);
    const lines = disclosureLines();
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe(ALLOCATION_DISCLOSURE);
    expect(isLastInMain(lines[0])).toBe(true);
  });

  it("/app/tools#allocation opens Asset allocation; /app/tools#lbo-sensitivity and /app/tools#lbo keep LBO", async () => {
    const first = renderTools({ route: `${ROUTE}#allocation` });
    await awaitAllocation();
    expect(tab(/Asset allocation/)).toHaveAttribute("aria-selected", "true");
    first.unmount();

    stub();
    const second = renderTools({ route: `${ROUTE}#lbo-sensitivity` });
    await awaitLbo();
    expect(tab(/LBO calculator/)).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(byId("lbo-sensitivity")).not.toBeNull());
    second.unmount();

    stub();
    renderTools({ route: `${ROUTE}#lbo` });
    await awaitLbo();
    expect(tab(/LBO calculator/)).toHaveAttribute("aria-selected", "true");
    expect(byId("lbo")).not.toBeNull();
  });

  it("clicking the Asset allocation tab swaps the hero (h1 = the fixture's leading asset), rewrites location.hash to #allocation, keeps exactly one h1 and ends with the T40 disclosure line; clicking LBO calculator swaps back", async () => {
    renderTools();
    await awaitLbo();
    fireEvent.click(tab(/Asset allocation/));
    await awaitAllocation();
    expect(window.location.hash).toBe("#allocation");
    expect(h1s()).toHaveLength(1);
    expect(byId("allocation-hero")?.contains(h1s()[0])).toBe(true);
    expect(byId("lbo-hero")).toBeNull();
    for (const id of ALLOCATION_IDS) expect(byId(id), id).not.toBeNull();
    expect(tab(/Asset allocation/)).toHaveAttribute("aria-selected", "true");
    const pill = byId("allocation-hero")!.querySelector(".mrr-pill") as HTMLElement;
    expect(text(pill)).toMatch(/^[+-]\d+\.\d% a year$/);
    expect(within(byId("allocation-summary") as HTMLElement).getByRole("heading", { level: 2, name: "Allocation summary" })).toBeInTheDocument();
    expect([...byId("allocation-summary")!.querySelectorAll("dl dt")].map((d) => text(d))).toEqual(["Sample", "Risk-free", "Optimizer"]);
    const lines = disclosureLines();
    expect(lines).toHaveLength(1);
    expect(text(lines[0])).toBe(ALLOCATION_DISCLOSURE);
    expect(isLastInMain(lines[0])).toBe(true);

    fireEvent.click(tab(/LBO calculator/));
    await awaitLbo();
    expect(window.location.hash).toBe("#lbo");
    expect(h1s()).toHaveLength(1);
    expect(byId("allocation-hero")).toBeNull();
    for (const id of LBO_IDS) expect(byId(id), id).not.toBeNull();
    expect(text(disclosureLines()[0])).toBe(LBO_DISCLOSURE);
  });

  it("the hero note Your modified deal appears after a slider change and disappears after Reset to defaults", async () => {
    renderTools();
    await awaitLbo();
    await waitFor(() => expect(byId("lbo-schedule")).not.toBeNull());
    expect(note()).toBeNull();
    fireEvent.change(rangeOf("Entry multiple"), { target: { value: "9" } });
    await waitFor(() => expect(text(note())).toMatch(/^Your modified deal/));
    const mod = lboModel({ ...BASE_REQ, entry_multiple: 9 });
    await waitFor(() => expect(text(note())).toContain(`${(mod.irr as number).toFixed(1)}% IRR`));
    expect(text(h1s()[0])).toBe(H1_LBO);
    fireEvent.click(within(byId("lbo-assumptions") as HTMLElement).getByRole("button", { name: "Reset to defaults" }));
    await waitFor(() => expect(note()).toBeNull());
    expect(text(h1s()[0])).toBe(H1_LBO);
  });
});
