/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.1 row 4,
 * `tools/LboHeroRow.test.tsx`: the LBO hero row (TabHero #lbo-hero, B.1;
 * SummaryCard #lbo-summary with the FRED strip, B.2) fed by a real
 * `useLboDeal()` inside renderWithProviders, with stubFetch answering
 * `/api/lbo/defaults`, the deterministic `/api/lbo/run` stub and
 * `/api/credit/metrics` (./__fixtures__/lbo.ts). useShellActions runs through
 * ShellActionsContext with a vi.fn() openFreshness. The clock is frozen (only
 * `Date`) so the Sep 01 stamp reads current. Every figure is computed from the
 * fixture deal, never the mockup's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import LboHeroRow from "./LboHeroRow";
import { irrTone, useLboDeal, type LboDeal } from "./lbo-deal";
import { NO_SHELL_ACTIONS, ShellActionsContext, type ShellActions } from "../shell/shell-actions";
import { fmtMillions } from "../shared/screen-ui";
import { renderWithProviders, stubFetch } from "../../test/utils";
import { BASE_REQ, CREDIT_METRICS, LBO_DEFAULTS_B3, LBO_DEFAULTS_FALLBACK, LBO_DEFAULTS_STATED, LIVE_RATE, NOW, lboModel, lboRoutes, lboRun, lboRunFixed } from "./__fixtures__/lbo";

const ROUTE = "/app/tools";
const BASE_RES = lboModel(BASE_REQ);
const BADGE: Record<ReturnType<typeof irrTone>, string> = { mint: "Clears the 20% PE bar", amber: "Below the 20% bar · above 15%", gray: "Below 15%" };
const SUMMARY_LABELS = ["Fed funds", "HY OAS", "All-in rate", "Financing", "Structure", "Equity check", "Credit state"];

/* ── harness ─────────────────────────────────────────────────────────────── */

let latest: LboDeal | null = null;
function Harness() {
  const deal = useLboDeal();
  latest = deal;
  return <LboHeroRow deal={deal} />;
}
function renderHero({ actions = {} }: { actions?: Partial<ShellActions> } = {}) {
  return renderWithProviders(
    <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, ...actions }}>
      <main id="main-content">
        <Harness />
      </main>
    </ShellActionsContext.Provider>,
    { route: ROUTE },
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
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const hero = () => byId("lbo-hero") as HTMLElement;
const summary = () => byId("lbo-summary") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = (name = `${(BASE_RES.irr as number).toFixed(1)}% IRR`) => screen.findByRole("heading", { level: 1, name });
const strip = () => summary().querySelector<HTMLElement>(".mrr-status");
const stripTitle = (el: HTMLElement) => text(el.querySelector(".mrr-status-title") ?? el.querySelector("b"));
const stripDetail = (el: HTMLElement) => text(el.querySelector("small"));
/** The strip once it reads `title` (the loading strip renders first, so a bare presence wait would race it). */
async function awaitStrip(title: string): Promise<HTMLElement> {
  await waitFor(() => expect(stripTitle(strip() as HTMLElement)).toBe(title));
  return strip() as HTMLElement;
}
const note = () => hero().querySelector<HTMLElement>(".mrr-hero-note");
const bridge = () => hero().querySelector<SVGSVGElement>('svg[role="img"][aria-label="Equity value bridge from entry to exit"]');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", ROUTE);
  latest = null;
  stubFetch(lboRoutes());
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("LboHeroRow (checklist 09 E.1 row 4)", () => {
  it("renders exactly one h1 equal to the fixture IRR inside #lbo-hero, the MOIC pill in its band, the eyebrow, the subhead with the all-in rate, the lede, the two actions, the badge footnote and the two component as-of items (E1: no month-stamp chip); no note at rest", async () => {
    renderHero();
    const h1 = await awaitHero();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    expect(hero().contains(h1)).toBe(true);
    expect(hero().tagName).toBe("SECTION");
    expect(text(h1)).toMatch(/^\d+\.\d% IRR$/);

    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe(`${(BASE_RES.moic as number).toFixed(2)}× MOIC`);
    expect(pill).toHaveAttribute("data-tone", irrTone(BASE_RES.irr));

    expect(text(hero().querySelector(".mrr-hero-eyebrow"))).toMatch(/LBO calculator/i);
    expect(text(hero().querySelector("h2"))).toBe(`The default deal at a ${LIVE_RATE.toFixed(2)}% all-in rate: Fed funds plus the HY spread.`);
    const lede = text(hero().querySelector(".mrr-hero-lede"));
    expect(lede.startsWith("A $100M EBITDA business bought at 8.00× with 4.50× leverage, growing 5.0% a year and exiting at 9.00× after 5 years.")).toBe(true);
    expect(lede).toContain("20% IRR");

    const adjust = within(hero()).getByRole("link", { name: "Adjust assumptions" });
    expect(adjust).toHaveAttribute("href", "/app/tools#lbo-assumptions");
    expect(adjust).toHaveClass("mrr-hero-btn-primary");
    const financing = within(hero()).getByRole("link", { name: "View financing conditions" });
    expect(financing).toHaveAttribute("href", "/app/credit#financing");
    expect(financing).toHaveClass("mrr-hero-btn-ghost");

    expect(text(hero().querySelector(".mrr-hero-foot"))).toContain(BADGE[irrTone(BASE_RES.irr)]);
    // Iteration 1 E1: no "Current · Sep 2026" month-stamp chip on the rate; each
    // component's as-of word from the freshness block (a pre-B3 payload has none: unknown).
    expect(hero().querySelectorAll('.mrr-hero-chips span[title^="Financing rate"]')).toHaveLength(0);
    const asOf = [...hero().querySelectorAll<HTMLElement>("[data-role='rate-as-of']")].map((el) => text(el));
    expect(asOf).toEqual(["Fed funds · As of unknown", "HY spread · As of unknown"]);
    expect(text(hero())).not.toMatch(/today|\blive\b|current/i);
    expect(note()).toBeNull();
    expect(text(hero())).not.toContain("—");
  });

  it("#lbo-summary: Deal financing as an h2, the seven dt labels in order at rest (no Vs base case), the values from the defaults with each component's as-of and the base run, and Credit state as a link to /app/credit#financing printing the credit label", async () => {
    renderHero();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    // Iteration 1 E1: the card is no longer titled "Live financing".
    expect(within(summary()).getByRole("heading", { level: 2, name: "Deal financing" })).toBeInTheDocument();
    expect(text(ddFor("Fed funds"))).toBe("4.33% · monthly average, As of unknown");
    expect(text(ddFor("HY OAS"))).toBe("2.65% · daily, As of unknown");
    expect(text(ddFor("All-in rate"))).toBe("6.98%");
    expect(text(ddFor("Financing"))).toBe("6.98% all-in (Fed funds + HY spread)");
    expect(text(ddFor("Structure"))).toMatch(/^8(?:\.0{1,2})?× entry · 9(?:\.0{1,2})?× exit · 4\.50?× debt · 5 yr hold$/);
    expect(text(ddFor("Equity check"))).toBe(`${fmtMillions(BASE_RES.entry_equity)} in · ${fmtMillions(BASE_RES.exit_equity as number)} out`);
    const credit = ddFor("Credit state").querySelector("a") as HTMLAnchorElement;
    expect(credit).not.toBeNull();
    expect(credit).toHaveAttribute("href", "/app/credit#financing");
    await waitFor(() => expect(text(credit)).toBe(CREDIT_METRICS.credit_label));
    expect(dts()).not.toContain("Vs base case");
  });

  it("the strip is a button with aria-haspopup=dialog; a payload without a freshness block reads FRED rate · as of unknown (A3) with the stored-through detail; clicking it calls the shell's openFreshness", async () => {
    const openFreshness = vi.fn();
    const openAlerts = vi.fn();
    renderHero({ actions: { openFreshness, openAlerts } });
    await awaitHero();
    const button = await awaitStrip("FRED rate · as of unknown");
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripTitle(button)).toBe("FRED rate · as of unknown");
    // Iteration 1 step 5 (G4): one status line.
    expect(stripDetail(button)).toBe("Stored through Sep 01, 2026");
    expect(button.getAttribute("aria-label")).toMatch(/^FRED rate · as of unknown\. Stored through Sep 01, 2026\. Open the data freshness breakdown\.$/);
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(1);
    expect(openAlerts).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(2);
  });

  it("E1: a B3 payload prints each component's as-of word in the hero footnote, the summary and the strip (Fed funds the Aug 2026 print, the HY spread Sep 17)", async () => {
    stubFetch(lboRoutes({ "/api/lbo/defaults": () => LBO_DEFAULTS_B3 }));
    renderHero();
    await awaitHero();
    await waitFor(() => expect(text(ddFor("Fed funds"))).toBe("4.33% · monthly average, Aug 2026 print"));
    expect(text(ddFor("HY OAS"))).toBe("2.65% · daily, Sep 17");
    const asOf = [...hero().querySelectorAll<HTMLElement>("[data-role='rate-as-of']")].map((el) => text(el));
    expect(asOf).toEqual(["Fed funds · Aug 2026 print", "HY spread · Sep 17"]);
    const button = await awaitStrip("Rate synced from FRED");
    expect(stripDetail(button)).toBe("Fed Aug 2026 print · HY Sep 17");
    expect(text(document.body)).not.toMatch(/today|\blive\b|current/i);
  });

  it("E1: the B3 stated-default payload (is_fallback) reads Stated default in the subhead, the summary and the hero footnote, never live", async () => {
    stubFetch(lboRoutes({ "/api/lbo/defaults": () => LBO_DEFAULTS_STATED }));
    renderHero();
    await screen.findByRole("heading", { level: 1, name: /IRR$/ });
    await waitFor(() => expect(text(hero().querySelector("h2"))).toBe("The default deal at the stated 8.60% default rate."));
    expect(text(ddFor("Fed funds"))).toBe("5.33% · Stated default");
    expect(text(ddFor("HY OAS"))).toBe("3.27% · Stated default");
    expect(text(ddFor("Financing"))).toBe("8.60% all-in (stated default)");
    expect([...hero().querySelectorAll<HTMLElement>("[data-role='rate-as-of']")].map((el) => text(el))).toEqual(["Financing rate · Stated default"]);
    const button = await awaitStrip("Rate feed unavailable");
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(text(document.body)).not.toMatch(/today|\blive\b|current/i);
  });

  it("the unavailable payload renders the gray Rate feed unavailable strip with the FRED-rows detail", async () => {
    stubFetch(lboRoutes({ "/api/lbo/defaults": () => LBO_DEFAULTS_FALLBACK }));
    renderHero();
    const button = await awaitStrip("Rate feed unavailable");
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripDetail(button)).toBe("No FRED rows · fallback rate in use");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("the defaults route failing: the error headline in the h1, the gray Unavailable pill, the gray strip with the stated-rate detail", async () => {
    stubFetch({ "/api/lbo/run": lboRun, "/api/credit/metrics": () => CREDIT_METRICS });
    renderHero();
    const h1 = await screen.findByRole("heading", { level: 1, name: /Financing rate unavailable/ });
    expect(text(h1)).toBe("Financing rate unavailable: the data service did not answer. The calculator falls back to the stated 8.50% rate.");
    expect(document.querySelectorAll("h1")).toHaveLength(1);
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    const button = await awaitStrip("Rate feed unavailable");
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripDetail(button)).toBe("The stated 8.50% rate is in use");
  });

  it("the bridge svg renders on a viable base run (six bars, the entry and exit equity labels) and the placeholder on a non-viable one", async () => {
    renderHero();
    await awaitHero();
    await waitFor(() => expect(bridge()).not.toBeNull());
    const svg = bridge() as SVGSVGElement;
    expect(svg.querySelectorAll("rect")).toHaveLength(6);
    const t = text(svg);
    expect(t).toContain(String(Math.round(BASE_RES.entry_equity)));
    expect(t).toContain(String(Math.round(BASE_RES.exit_equity as number)));
    expect(hero().querySelector(".mrr-hero-placeholder")).toBeNull();
  });

  it("a non-viable base run draws no bridge: the placeholder stands in the chart slot", async () => {
    stubFetch(lboRoutes({ "/api/lbo/run": lboRunFixed(lboModel({ ...BASE_REQ, leverage_ratio: 8 })) }));
    renderHero();
    await waitFor(() => expect(hero()).not.toBeNull());
    await waitFor(() => expect(hero().querySelector(".mrr-hero-placeholder")).not.toBeNull());
    expect(bridge()).toBeNull();
    expect(document.querySelectorAll("h1")).toHaveLength(1);
  });

  it("while the defaults load the hero says Running the default deal… with no pill and the gray Reading the FRED rate… strip", async () => {
    stubFetch(lboRoutes({ "/api/lbo/defaults": () => new Promise<never>(() => {}) }));
    renderHero();
    expect(await screen.findByText("Running the default deal…")).toBeInTheDocument();
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    const button = await awaitStrip("Reading the FRED rate…");
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripDetail(button)).toBe("Opens the data freshness breakdown");
  });

  it("a modified deal adds the Vs base case row and the hero note while the h1 stays on the default deal; a manual rate flags the Financing row; Reset removes both", async () => {
    renderHero();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    const mod = lboModel({ ...BASE_REQ, entry_multiple: 9 });
    const d = (mod.irr as number) - (BASE_RES.irr as number);
    const signed = `${d >= 0 ? "+" : ""}${d.toFixed(1)}`;

    act(() => (latest as LboDeal).set({ entry_multiple: 9 }));
    await waitFor(() => expect(dts()).toContain("Vs base case"));
    expect(dts()).toEqual([...SUMMARY_LABELS.slice(0, 6), "Vs base case", "Credit state"]);
    expect(text(ddFor("Vs base case")).replace(/−/g, "-")).toBe(`${signed} pp IRR against ${(BASE_RES.irr as number).toFixed(1)}%`);
    expect(text(ddFor("Structure"))).toMatch(/^9(?:\.0{1,2})?× entry/);
    expect(text(ddFor("Equity check"))).toBe(`${fmtMillions(mod.entry_equity)} in · ${fmtMillions(mod.exit_equity as number)} out`);
    await waitFor(() => expect(text(note())).toMatch(/^Your modified deal: /));
    expect(text(note()).replace(/−/g, "-")).toBe(
      `Your modified deal: ${(mod.irr as number).toFixed(1)}% IRR · ${(mod.moic as number).toFixed(2)}× MOIC · ${signed} pp vs the default, in Outputs below.`,
    );
    expect(text(screen.getByRole("heading", { level: 1 }))).toBe(`${(BASE_RES.irr as number).toFixed(1)}% IRR`);
    expect(text(hero().querySelector("h2"))).toBe(`The default deal at a ${LIVE_RATE.toFixed(2)}% all-in rate: Fed funds plus the HY spread.`);

    act(() => (latest as LboDeal).set({ interest_rate: 7.5 }));
    await waitFor(() => expect(text(ddFor("Financing"))).toBe("7.50% all-in (manual)"));
    expect(text(ddFor("All-in rate"))).toBe("6.98%");

    act(() => (latest as LboDeal).reset());
    await waitFor(() => expect(dts()).toEqual(SUMMARY_LABELS));
    expect(text(ddFor("Financing"))).toBe("6.98% all-in (Fed funds + HY spread)");
    await waitFor(() => expect(note()).toBeNull());
  });
});
