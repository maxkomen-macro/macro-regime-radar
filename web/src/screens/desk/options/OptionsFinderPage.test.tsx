/**
 * The Options Finder page (Options Finder Build Plan step 5): unlisted (no sidebar entry, Preview, noindex) and
 * reachable by its address; the thesis in the address; the states a visitor can meet (no thesis yet, loading,
 * answered, empty with its reasons, options outside the data plan, the route not deployed, a refusal); every number
 * on the answer is a served number; and no "best", "recommended" or "buy" anywhere on the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import finder from "../../../fixtures/desk/options-finder.json";
import { DESK_PAGES, deskGroups, deskPageBySlug } from "../desk-sections";
import { OPTIONS_FINDER_LISTED } from "./flag";
import { dividendChecks, earlyExerciseWords, failureOf, money, paramsOf, sortRows } from "./OptionsFinderPage";
import { DeskApiError } from "../data/api";
import type { OptionRow } from "../data/types";

const ANSWERS = (finder as { answers: Record<string, Record<string, unknown>> }).answers;
const UP_KEY = "symbol=SYN&view=up&target=120&by=2026-12-18&budget=5000&commission=0.65";
const UP = ANSWERS[UP_KEY];
const UP_URL = "/desk/options-finder?symbol=SYN&direction=up&target=120&by=2026-12-18&budget=5000&commission=0.65";
const ROUTE = "/api/desk/options/finder";

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderTab(route = "/desk/options-finder") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const page = () => screen.getByTestId("of-page");
/** An element's text, one text node at a time (textContent runs adjacent cells together). */
const textOf = (el: Element) => {
  const out: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n.textContent ?? "");
  return out.join(" ");
};
/** The framing's own denial ("not a recommendation") is the one use of the word the page makes. */
const BANNED_WORDS = /\b(best|recommend\w*|buy\w*)\b/i;
const pageWords = () => (page().textContent ?? "").replace(/not a recommendation/g, "");
const stateOf = async (s: string) => waitFor(() => expect(page()).toHaveAttribute("data-state", s), { timeout: 4000 });

// ── every number on the answer is served ──

/** Every number the answer serves, and the numbers inside its words and dates. */
function servedNumbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (typeof v === "string") for (const m of v.matchAll(/\d+(?:\.\d+)?/g)) out.push(Number(m[0]));
  else if (Array.isArray(v)) v.forEach((x) => servedNumbers(x, out));
  else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (servedNumbers(k.match(/^\d{4}-\d{2}-\d{2}$/) ? k : "", out), servedNumbers(x, out)));
  return out;
}

/** The spellings a served number can take on the page: itself or as a percent, at 0 to 4 decimals. */
function spellings(answer: unknown): Set<string> {
  const out = new Set<string>();
  for (const x of servedNumbers(answer))
    for (const y of [Math.abs(x), Math.abs(x) * 100])
      for (let d = 0; d <= 4; d++) out.add(y.toFixed(d));
  return out;
}

/** The words' own constants: zero (the chart's zero line) and the ten volatility points of iv_minus_10 / iv_plus_10. */
const COPY_CONSTANTS = new Set(["0", "10"]);

function unservedNumbers(text: string, answer: unknown): string[] {
  const ok = spellings(answer);
  const bad: string[] = [];
  for (const m of text.matchAll(/(?<![\p{L}\d.])[+−-]?\$?(\d[\d,]*(?:\.\d+)?)%?/gu)) {
    const raw = m[1].replace(/,/g, "");
    const n = Number(raw).toFixed(raw.includes(".") ? raw.split(".")[1].length : 0);
    if (!ok.has(n) && !COPY_CONSTANTS.has(n)) bad.push(m[0]);
  }
  return bad;
}

describe("Options Finder: unlisted", () => {
  it("ships unlisted: in no sidebar group, yet its address resolves (unlisted is not private)", () => {
    expect(OPTIONS_FINDER_LISTED).toBe(false);
    expect(DESK_PAGES.map((p) => p.slug)).not.toContain("options-finder");
    expect(deskPageBySlug("options-finder")?.label).toBe("Options Finder");
  });

  it("once listed, it sits under Trade between Basket & Hedge and Position Monitor, its line fifteen words or fewer, and nothing else moves", () => {
    const listed = deskGroups(true);
    const unlisted = deskGroups(false);
    expect(listed.find((g) => g.id === "trade")?.pages.map((p) => p.slug)).toEqual(["basket-hedge", "options-finder", "position-monitor"]);
    expect(unlisted.find((g) => g.id === "trade")?.pages.map((p) => p.slug)).toEqual(["basket-hedge", "position-monitor"]);
    const others = (gs: typeof listed) => gs.flatMap((g) => g.pages).filter((p) => p.slug !== "options-finder");
    expect(others(listed)).toEqual(others(unlisted));
    const p = listed.flatMap((g) => g.pages).find((x) => x.slug === "options-finder");
    expect(p?.blurb.trim().split(/\s+/).length).toBeLessThanOrEqual(15);
    expect(p?.toggle).toBe(false);
  });

  it("opens by its address with a Preview badge and a noindex tag, and the sidebar has no link to it", async () => {
    renderTab();
    await screen.findByRole("heading", { level: 1, name: "Options Finder" });
    expect(screen.getByTestId("of-preview")).toHaveTextContent("Preview");
    expect(document.head.querySelector('meta[name="robots"][data-options-finder]')).toHaveAttribute("content", "noindex, nofollow");
    expect(screen.queryByRole("link", { name: /Options Finder/ })).toBeNull();
    expect(page()).toHaveAttribute("data-state", "idle");
    expect(screen.getByTestId("of-status")).toHaveTextContent("Name a stock or ETF");
    expect(screen.getByTestId("of-footer")).toHaveTextContent("Scenario calculator over end-of-day quotes, not a recommendation.");
    expect(within(screen.getByTestId("of-footer")).getByRole("link", { name: /Options risk disclosure \(OCC\)/ })).toHaveAttribute("href", expect.stringContaining("theocc.com"));
  });

  it("asks for nothing until the thesis is complete", async () => {
    const { calls } = stubDesk();
    renderTab("/desk/options-finder?symbol=SYN&direction=up&target=120");
    await screen.findByRole("heading", { level: 1, name: "Options Finder" });
    expect(page()).toHaveAttribute("data-state", "idle");
    expect(calls.filter((c) => c.includes("/options/finder"))).toEqual([]);
  });
});

describe("Options Finder: the thesis in the address", () => {
  it("maps the address to the request: direction is the route's view, empty values are left out", () => {
    expect(paramsOf(new URLSearchParams("symbol=SYN&direction=down&target=85&by=2027-01-15&budget=2500&scan_months=3&fill=&view=client"))).toEqual({
      symbol: "SYN",
      view: "down",
      target: "85",
      by: "2027-01-15",
      budget: "2500",
      scan_months: "3",
    });
    expect(paramsOf(new URLSearchParams("symbol=SYN&direction=up&target=120&by=2026-12-18"))).toBeNull();
  });

  it("writes the form into the address and asks the route with it", async () => {
    const { calls } = stubDesk();
    renderTab();
    const form = await screen.findByRole("form", { name: "Your view" });
    fireEvent.change(within(form).getByLabelText("Stock or ETF"), { target: { value: "syn" } });
    fireEvent.change(within(form).getByLabelText("Direction"), { target: { value: "down" } });
    fireEvent.change(within(form).getByLabelText("Target price, dollars"), { target: { value: "85" } });
    fireEvent.change(within(form).getByLabelText("By"), { target: { value: "2027-01-15" } });
    fireEvent.change(within(form).getByLabelText("Budget, dollars"), { target: { value: "2500" } });
    fireEvent.click(within(form).getByRole("button", { name: /Screens and costs/ }));
    fireEvent.change(within(form).getByLabelText("Months of expiries"), { target: { value: "3" } });
    fireEvent.click(within(form).getByTestId("of-run"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/options-finder?symbol=SYN&direction=down&target=85&by=2027-01-15&budget=2500&scan_months=3"));
    await stateOf("answered");
    expect(calls).toContain("GET /api/desk/options/finder?symbol=SYN&view=down&target=85&by=2027-01-15&budget=2500&scan_months=3");
    expect(screen.getByTestId("of-summary")).toHaveTextContent(/of \d+ puts were priced/);
  });
});

describe("Options Finder: the answer", () => {
  it("answers from the served chain: the summary, the three lens cards, the chart, the events, the table and the sources", async () => {
    renderTab(UP_URL);
    await stateOf("answered");
    const u = UP.universe as { seen: number; passed: number };
    expect(screen.getByTestId("of-summary")).toHaveTextContent(`${u.passed} of ${u.seen} calls were priced. Priced from the Oct 23 close (SYN $100.00), costed at the ask, plus $0.65 a contract in commission.`);
    expect(screen.getByTestId("of-thesis")).toHaveTextContent("Your view: SYN rises to $120.00 by Dec 18, 2026 (+20.0% from the close), with $5,000.00 to spend.");
    expect(screen.getByTestId("of-dropped")).toHaveTextContent("42 were too wide");
    const picks = UP.picks as Record<string, string>;
    for (const lens of ["payoff", "forgiving", "time"]) expect(screen.getByTestId(`of-pick-${lens}`)).toHaveAttribute("data-contract", picks[lens]);
    const payoff = (UP.rows as OptionRow[]).find((r) => r.contract === picks.payoff) as OptionRow;
    const card = screen.getByTestId("of-pick-payoff");
    expect(card).toHaveTextContent(`${payoff.n} × Dec 18 $112.50 call`);
    expect(card).toHaveTextContent(`Cost (max loss)${money(payoff.cost)}`);
    expect(card).toHaveTextContent(`At $120.00 on Dec 18${money(payoff.pnl.target, true)}`);
    expect(card).toHaveTextContent("market-implied, not a forecast");
    expect(screen.getByRole("img", { name: /^Profit or loss in dollars on Dec 18, 2026 against SYN's price that day/ })).toBeInTheDocument();
    expect(screen.getByTestId("of-events")).toHaveTextContent("SYN earnings (Q3 2026), after the close · before your date · Finnhub earnings calendar");
    const table = screen.getByTestId("of-table");
    expect(within(table).getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByTestId("of-all"));
    expect(within(table).getAllByRole("row")).toHaveLength((UP.rows as unknown[]).length + 1);
    expect(screen.getByTestId("of-footer")).toHaveTextContent("Sources: EODHD options (end of day, 2026-10-23 close)");
    // The quotes are a session's close: the badge names it, and the page never calls them live.
    expect(screen.getByText("Close · Oct 23")).toBeInTheDocument();
    expect(page().textContent ?? "").not.toMatch(/\blive\b/i);
  });

  it("counts the priced contracts as priced and names the rest that passed the screens unpriced (Codex S-6)", async () => {
    renderTab(UP_URL);
    await stateOf("answered");
    const u = UP.universe as { passed: number; ranked_out: number; ranked_out_words: string };
    expect(u.ranked_out).toBeGreaterThan(0);
    expect(screen.getByTestId("of-summary")).not.toHaveTextContent("passed the screens.");
    expect(screen.getByText(u.ranked_out_words)).toBeInTheDocument();
    expect(screen.getByText(`Every priced contract (${u.passed})`)).toBeInTheDocument();
    expect(screen.queryByText(/Every contract that passed/)).toBeNull();
  });

  it("never reads unknown earnings as none: the flag on every modelled row, and the empty events line says unknown (design A-3)", async () => {
    expect(UP.earnings_status).toBe("unknown");
    renderTab(UP_URL);
    await stateOf("answered");
    const unknown = /Earnings dates are unknown for this name, so a report before your date is not ruled out/;
    const modelled = (UP.rows as OptionRow[]).filter((r) => r.modelled);
    expect(modelled.length).toBeGreaterThan(0);
    expect(modelled.every((r) => r.flags.some((f) => unknown.test(f)))).toBe(true);
    fireEvent.click(screen.getByTestId("of-all"));
    expect(screen.getAllByTitle(unknown)).toHaveLength(modelled.length);  // each modelled row's flag in the table
    expect(screen.getByText(/Earnings dates past the stored ones are unknown/)).toBeInTheDocument();
  });

  it.each([
    ["unknown", "No events are listed before the last expiry, but earnings dates are unknown, so a report is not ruled out."],
    ["known", "No events are listed before the last expiry."],
  ])("with no events and earnings %s, the events card says so (design A-3)", async (status, words) => {
    stubDesk({ [ROUTE]: () => ({ ...UP, events: [], earnings_moves: [], earnings_status: status }) });
    renderTab(UP_URL);
    await stateOf("answered");
    expect(screen.getByTestId("of-no-events")).toHaveTextContent(words);
  });

  it("says why a delta is not served, in the cell, for every reason the route gives (design D-1)", async () => {
    const notes = [
      "a dividend falls within 5 days, where the lattice delta is not validated",
      "within 5 pricer tolerances of the exercise value, where the delta is not validated",
      "the pricer did not reach its delta tolerance",
      "the delta needs the lattice, and a dividend outside the contract's life",
      null,
    ];
    const rows = (UP.rows as OptionRow[]).map((r, i) => (i < notes.length ? { ...r, delta: null, delta_note: notes[i] } : r));
    stubDesk({ [ROUTE]: () => ({ ...UP, rows }) });
    renderTab(UP_URL);
    await stateOf("answered");
    fireEvent.click(screen.getByTestId("of-all"));
    const table = screen.getByTestId("of-table");
    notes.forEach((note, i) => {
      const tr = table.querySelector(`tr[data-contract="${rows[i].contract}"]`) as HTMLElement;
      const cell = within(tr).queryByTestId("of-delta-note");
      if (note === null) {
        expect(cell).toBeNull();
      } else {
        expect(cell).toHaveAttribute("title", note);
        expect(cell).toHaveTextContent(note);
      }
    });
  });

  it("shows the served early-exercise flag on the cards and in the table (Codex S-5)", async () => {
    renderTab(UP_URL);
    await stateOf("answered");
    const rows = UP.rows as OptionRow[];
    const byC = new Map(rows.map((r) => [r.contract, r]));
    const picks = UP.picks as Record<string, string>;
    const yes = byC.get(picks.forgiving) as OptionRow;
    expect(yes.early_exercise.flag).toBe("yes");
    expect(screen.getByTestId("of-early-forgiving")).toHaveTextContent(earlyExerciseWords(yes.early_exercise) as string);
    expect(earlyExerciseWords(yes.early_exercise)).toMatch(/^Early exercise adds \$0\.\d+ a share over the European value; the American value is used\.$/);
    const within_ = byC.get(picks.payoff) as OptionRow;
    expect(within_.early_exercise.flag).toBe("within the pricer's tolerance of a cent");
    expect(screen.getByTestId("of-early-payoff")).toHaveTextContent("whether that is above a cent is within the pricer's tolerance");
    expect(earlyExerciseWords({ premium: 0.001, flag: "no" })).toBeNull();
    fireEvent.click(screen.getByTestId("of-all"));
    const yesRows = rows.filter((r) => r.early_exercise.flag === "yes");
    expect(screen.getAllByTestId("of-early-row")).toHaveLength(yesRows.length);
    expect(screen.getByTestId("of-table").querySelector(`tr[data-contract="${yes.contract}"]`)).toHaveTextContent("early exercise $");
  });

  it("shows the dividend cross-check where the schedule and the market's forward differ by more than a cent (Codex S-4)", async () => {
    renderTab(UP_URL);
    await stateOf("answered");
    const carry = UP.carry as { exp: string; difference: number | null }[];
    const off = carry.filter((c) => c.difference !== null && Math.abs(c.difference) > 0.01);
    expect(off.length).toBeGreaterThan(0);
    const notes = screen.getAllByTestId("of-dividend-check");
    expect(notes).toHaveLength(off.length);
    expect(notes[0]).toHaveTextContent(/^Dividends before Dec 18, 2026: the market's forward \(put-call parity\) implies \$0\.\d+ a share in present value, the dividend schedule from EODHD \$0\.\d+, including projected dividends, \$0\.\d+ less\. The market's forward is what was priced\.$/);
    const one = { ...UP, carry: [{ ...carry[0], difference: 0.01 }] } as unknown as Parameters<typeof dividendChecks>[0];
    expect(dividendChecks(one)).toEqual([]);
  });

  it("labels a value on the date that is not intrinsic as modelled, with its volatility held and the ten-point sensitivity", async () => {
    renderTab(UP_URL);
    await stateOf("answered");
    const rows = UP.rows as OptionRow[];
    const modelled = rows.find((r) => r.modelled && r.iv_minus_10) as OptionRow;
    expect(modelled).toBeTruthy();
    fireEvent.click(screen.getByTestId("of-all"));
    const row = screen.getByTestId("of-table").querySelector(`tr[data-contract="${modelled.contract}"]`) as HTMLElement;
    expect(row).toHaveTextContent(`${money(modelled.pnl.target, true)}*`);
    const timeCard = screen.getByTestId("of-pick-time");
    const timeRow = rows.find((r) => r.contract === (UP.picks as Record<string, string>).time) as OptionRow;
    if (timeRow.modelled) expect(within(timeCard).getByTestId("of-modelled-time")).toHaveTextContent("With volatility 10 points lower");
  });

  it("prints only served numbers (the answer, its words and dates; zero and the ten volatility points are the copy's)", async () => {
    for (const [key, answer] of Object.entries(ANSWERS)) {
      const q = new URLSearchParams(key);
      q.set("direction", q.get("view") as string);
      q.delete("view");
      const { unmount } = renderTab(`/desk/options-finder?${q.toString()}`);
      await stateOf("answered");
      const all = screen.queryByTestId("of-all");
      if (all) fireEvent.click(all);
      fireEvent.click(within(screen.getByTestId("of-method")).getByText("How it was priced"));
      const text = [screen.getByTestId("of-answer"), screen.getByTestId("of-footer"), screen.getByTestId("dk-live")].map(textOf).join(" ");
      expect(unservedNumbers(text, answer), key).toEqual([]);
      unmount();
    }
  });

  it("the check catches a number the answer does not serve", () => {
    expect(unservedNumbers("Cost $4,985.75 · IV 28.1% · 12,345.67", UP)).toEqual(["12,345.67"]);
  });

  it("has no best, recommended or buy wording, answered or not", async () => {
    const { unmount } = renderTab();
    await screen.findByRole("heading", { level: 1, name: "Options Finder" });
    expect(pageWords()).not.toMatch(BANNED_WORDS);
    unmount();
    renderTab(UP_URL);
    await stateOf("answered");
    fireEvent.click(screen.getByTestId("of-all"));
    expect(pageWords()).not.toMatch(BANNED_WORDS);
  });

  it("sorts the served rows by a column, stable on the served order, unserved values last", () => {
    const rows = UP.rows as OptionRow[];
    const half = sortRows(rows, "half", "desc");
    expect(half).toHaveLength(rows.length);
    for (let k = 1; k < half.length; k++) expect((half[k - 1].pnl.half as number) >= (half[k].pnl.half as number)).toBe(true);
    const withNull = [{ ...rows[0], oi: null }, rows[1]] as OptionRow[];
    expect(sortRows(withNull, "oi", "asc")[1].oi).toBeNull();
    expect(sortRows(rows, "served", "desc").map((r) => r.contract)).toEqual(rows.map((r) => r.contract));
  });
});

describe("Options Finder: the states", () => {
  it("loading: says the scan is being priced", async () => {
    stubDesk({ [ROUTE]: () => new Promise(() => {}) });
    renderTab(UP_URL);
    await stateOf("loading");
    expect(screen.getByTestId("of-status")).toHaveTextContent("Screening and pricing the contracts in the window");
  });

  it("empty: says why nothing passed, with every screen's count", async () => {
    const empty = {
      ...UP,
      rows: [],
      picks: { payoff: null, forgiving: null, time: null },
      curve: { ...(UP.curve as object), pnl: {} },
      universe: { ...(UP.universe as object), passed: 0, dropped: { ...((UP.universe as { dropped: object }).dropped), wide_spread: 120, over_budget: 41 } },
      empty: "None of the 210 calls passed the screens: 120 were too wide, 41 cost more than the budget, 7 were outside the scan window.",
    };
    stubDesk({ [ROUTE]: () => empty });
    renderTab(UP_URL);
    await stateOf("empty");
    expect(screen.getByTestId("of-empty")).toHaveTextContent("None of the 210 calls passed the screens: 120 were too wide, 41 cost more than the budget");
    expect(screen.getByTestId("of-dropped")).toHaveTextContent("Why 168 were dropped");
    expect(screen.queryByTestId("of-table")).toBeNull();
    expect(screen.queryByTestId("of-pick-payoff")).toBeNull();
  });

  it("not entitled: options outside the data plan say so (403)", async () => {
    stubDesk({ [ROUTE]: deskError(403, "unauthorized", { message: "Options are not in the EODHD plan on this server." }) });
    renderTab(UP_URL);
    await stateOf("not-entitled");
    expect(screen.getByTestId("of-refusal")).toHaveTextContent("Options quotes are not in the data plan on this server");
  });

  it("not deployed: an API without the route (a bare 404) says the Finder is not deployed yet", async () => {
    stubDesk();
    const fixtures = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://localhost");
      if (url.pathname === ROUTE) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
      return fixtures(input, init);
    }) as typeof fetch;
    renderTab(UP_URL);
    await stateOf("not-deployed");
    expect(screen.getByTestId("of-refusal")).toHaveTextContent("The Options Finder is not deployed on the data service yet.");
  });

  it("refused: a thesis the route cannot run shows the route's own words", async () => {
    stubDesk({ [ROUTE]: deskError(422, "unsupported", { message: "The target is above the close, so it is not a fall." }) });
    renderTab(UP_URL);
    await stateOf("refused");
    expect(screen.getByTestId("of-refusal")).toHaveTextContent("The target is above the close, so it is not a fall.");
  });

  it("names each failure", () => {
    expect(failureOf(new DeskApiError(404, "Not Found", null)).state).toBe("not-deployed");
    expect(failureOf(new DeskApiError(404, "SYN has no listed options.", { error: "empty" })).state).toBe("refused");
    expect(failureOf(new DeskApiError(403, "no", { error: "unauthorized" })).state).toBe("not-entitled");
    expect(failureOf(new DeskApiError(503, "Another options scan is being priced; retry in a moment.", { error: "busy" })).state).toBe("failed");
    expect(failureOf(new DeskApiError(0, "The data service did not answer.")).state).toBe("failed");
    expect(failureOf(new DeskApiError(200, "Awaiting refresh", { error: "awaiting" }, { reason: "Awaiting refresh", until: null })).state).toBe("awaiting");
  });
});
