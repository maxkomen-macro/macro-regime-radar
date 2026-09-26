/**
 * Overview (DESK_FRAME3_SPEC §2) against the §12.1 fixture: every number on
 * the tab is a served field, formatted; the words are fixed spellings of
 * served values; with no /overview every tile keeps its label and says
 * "Awaiting refresh" (§1.7).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import overview from "../../../fixtures/desk/overview.json";
import type { OverviewResponse } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { sinceItems, trendSub, trendWords } from "./OverviewPage";
import positions from "../../../fixtures/desk/positions.json";
import { FIXTURE_META } from "../../../fixtures/desk";
import { awaitingEnvelope } from "../data/envelope";
import { POSITIONS_KEY, type PositionRecord } from "../positions/store";

const RECORDS = (positions as { positions: PositionRecord[] }).positions;

const fixture = overview as unknown as OverviewResponse;

function renderOverview() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/overview" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.removeItem(POSITIONS_KEY);
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(POSITIONS_KEY);
});

describe("Overview words", () => {
  it("spells the since-last-close items in the spec's order", () => {
    // The audit's snapshot: nothing firing, no VIX for the Sep 23 session yet (FRED posts next day), the July row both days.
    expect(sinceItems(fixture.since_last_close!).map((i) => `${i.text}${i.tag ? ` ${i.tag}` : ""}`)).toEqual(["regime unchanged", "data refreshed 05:07 UTC"]);
    const still = { slug: "2s10s-2sigma-steepening", label: "2s10s +2σ steepening", short: "2s10s steepening", firing_day: 10 };
    expect(sinceItems({ ...fixture.since_last_close!, still_firing: [still], vol_change_pts: 0.8 }).map((i) => i.text)).toEqual(["2s10s steepening still firing, day 10", "vol up 0.8 pts", "regime unchanged", "data refreshed 05:07 UTC"]);
    expect(sinceItems({ ...fixture.since_last_close!, regime_changed: true, regime_from: "Goldilocks", regime_to: "Overheating", vol_change_pts: -1.2 }).map((i) => i.text)).toContain("regime changed → Overheating");
    expect(sinceItems({ ...fixture.since_last_close!, vol_change_pts: -1.2 }).find((i) => i.key === "vol")?.text).toBe("vol down 1.2 pts");
    // §2: each new fire with (new); its served short name.
    expect(sinceItems({ ...fixture.since_last_close!, new_fires: [{ slug: "golden-cross", label: "S&P golden cross", short: "golden cross" }] })[0]).toEqual({ key: "new-golden-cross", text: "golden cross fired", tag: "(new)" });
  });

  it("names the trend from the served state, and its sub-line from state_since and the last cross (§2)", () => {
    const t = fixture.tiles!.trend!;
    expect(trendWords(t)).toBe("Above 50 & 200");
    expect(trendWords({ ...t, state: "below_both" })).toBe("Below 50 & 200");
    expect(trendWords({ ...t, state: "mixed", above_50: false, above_200: true })).toBe("Above 200, below 50");
    expect(trendWords({ ...t, state: "unavailable", above_50: null, above_200: null })).toBe("Unavailable");
    expect(trendSub(t)).toBe("since Sep 17, 2026 · last cross golden, Jul 1, 2025");
    expect(trendSub({ ...t, state_since: null, cross: null })).toBe("");
  });

});

describe("Overview tab", () => {
  it("prints the since-last-close line and the four tiles from /overview", async () => {
    renderOverview();
    const since = await screen.findByTestId("ov-since");
    await waitFor(() => expect(since).toHaveTextContent("regime unchanged"));
    // §12.1 (B-05): the two sessions compared, by their dates.
    expect(within(since).getByText("Since last close")).toHaveAttribute("title", "the Sep 23 close against Sep 22");
    expect(since).not.toHaveTextContent(/Dollar|firing/);
    expect(since.textContent).toContain("data refreshed 05:07 UTC");
    const regime = screen.getByRole("region", { name: "Regime" });
    // §2: the K−2 row governing today (a September session reads the July row, Goldilocks as stored).
    expect(regime).toHaveTextContent("Live · Jul row");
    expect(regime).toHaveTextContent("Goldilocks");
    // §1.3's exception (v2 D-36): the regime carries its color, Goldilocks green.
    expect(regime.querySelector(".ov-tile-value")).toHaveAttribute("data-tone", "green");
    expect(regime).toHaveTextContent("Growth rising, inflation falling · rule-based, two-month lag");
    const rec = screen.getByRole("region", { name: "Recession · logistic model" });
    expect(rec).toHaveTextContent("12%");
    // §2: "<band> · score for <probability_month> · inputs through <inputs_through>"; no odds in words.
    expect(rec).toHaveTextContent("Low · score for Aug 2026 · inputs through May 2026");
    expect(rec).not.toHaveTextContent("one-in-eight");
    const trend = screen.getByRole("region", { name: "S&P 500 · trend" });
    expect(trend).toHaveTextContent("Live · Sep 23");
    expect(trend).toHaveTextContent("Above 50 & 200");
    // §2: "since <state_since> · last cross <golden|death>, <date>".
    expect(trend).toHaveTextContent("since Sep 17, 2026 · last cross golden, Jul 1, 2025");
    const vol = screen.getByRole("region", { name: "Vol · VIX" });
    expect(vol).toHaveTextContent("14.2");
    // §2: the level and its day; the gap to realized and the band word are unavailable (§1.0).
    expect(vol).toHaveTextContent("VIX 14.2 · Sep 22");
    // §1.0.2: no envelope of its own, so the unserved half prints §1.0's reason.
    expect(vol).toHaveTextContent("The gap to realized and the band word: realized-volatility method not specified.");
    expect(vol).not.toHaveTextContent(/Calm|protection costs/);
  });

  it("a row whose h = 20 study has fewer than ten completed outcomes carries the dashed Too few pill (§1.5)", async () => {
    stubDesk({ "/api/desk/overview": () => ({ ...overview, active_signals: overview.active_signals.map((r, i) => (i === 1 ? { ...r, verdict: "insufficient", n: 6 } : r)) }) });
    renderOverview();
    const card = await screen.findByRole("region", { name: /Active signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(5));
    const pill = within(within(card).getAllByRole("listitem")[1]).getByText("Too few");
    expect(pill).toHaveClass("dk-pill");
    expect(pill).toHaveAttribute("data-verdict", "insufficient");
  });

  it("a bp row's median and vs normal read in bp, with no log tooltip (§1.9)", async () => {
    stubDesk({ "/api/desk/overview": () => ({ ...overview, active_signals: overview.active_signals.map((r, i) => (i === 0 ? { ...r, median: 12.5, baseline_median: 6.5, vs_normal: 6, target_unit: "bp", display_unit: "bp" } : r)) }) });
    renderOverview();
    const card = await screen.findByRole("region", { name: /Active signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(5));
    const row = within(card).getAllByRole("listitem")[0];
    expect(row.textContent?.replace(/\s+/g, " ")).toContain("20-day median +12.5 bp (+6 bp vs normal)");
    expect(row.querySelector('[title="log return, ×100"]')).toBeNull();
  });

  it("lists the active signals as served, each with its sentence and verdict", async () => {
    renderOverview();
    const card = await screen.findByRole("region", { name: /Active signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(5));
    const rows = within(card).getAllByRole("listitem");
    // §12.1: nothing firing, so the five latest last fires, newest first.
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["S&P 5-day move over 2σ", "VIX spike +2σ, 5 days", "S&P 20-day move over 2σ", "S&P golden cross", "2s10s +2σ steepening"]);
    expect(rows[0]).toHaveTextContent("last fired Aug 4, 2026");
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toContain("Fired 78× since 1996 · S&P up 63% of the time · 20-day median +1.7% (+0.4 pts vs normal)");
    expect(within(rows[0]).getByText("No edge")).toBeInTheDocument();
    expect(rows[3].textContent?.replace(/\s+/g, " ")).toContain("Fired 14× since 1996 · S&P up 79% of the time · 20-day median +2.7% (+1.4 pts vs normal)");
    expect(within(rows[3]).getByText("Reliable")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Suggestive")).toBeInTheDocument();
    expect(rows[4].textContent?.replace(/\s+/g, " ")).toContain("20-day median +1.6% (+0.3 pts vs normal)");
    expect(within(card).getByRole("link", { name: "Full Signal Ledger →" })).toHaveAttribute("href", "/desk/signal-ledger");
    // The four §1.5 definitions (B-13), word for word.
    const defs = [...card.querySelectorAll(".dk-defs > div")].map((d) => [...d.children].map((c) => c.textContent?.trim()).join(" "));
    expect(defs).toEqual([
      "Reliable — at least ten overlap blocks, with the engine's 90% interval and adverse-share requirements met; zero counts as adverse.",
      "Suggestive — 10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all Reliable criteria are met.",
      "No edge — at least ten completed outcomes at this horizon, without Reliable evidence or a consistent nonzero excess-median sign across 5, 10 and 20 sessions.",
      "Too few — fewer than ten completed outcomes at this horizon.",
    ]);
  });

  it("reads the monitored positions from this browser, least room first, manual last, in their units (§2, §9)", async () => {
    const [ndx, curve] = [RECORDS.find((p) => p.id === "ndx-vs-spx")!, RECORDS.find((p) => p.id === "2s10s-steepener")!];
    // Entries on the real levels: the S&P 81 points over its 50-day of 134 at entry (60%), 2s10s 10 bp over its level of 35 (29%).
    const spx = { ...curve, id: "spx-long", instrument: "S&P 500", size_nav: 0.03, wrong_if: { id: "below_50d", label: "closes below its 50-day (7,625)" }, subject: { kind: "instrument", id: "spx" }, entry_value: 7759.22, original_room: 134.38, trigger: { series: "spx", operator: "below", threshold: 7624.84, policy: "frozen", observed_on: "2026-09-02" } };
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([ndx, spx, { ...curve, entry_value: 50, original_room: 35 }]));
    renderOverview();
    const card = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(card).toHaveTextContent("29% room"));
    const rows = within(card).getAllByTestId("dk-mon-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "spx-long", "ndx-vs-spx"]);
    // A name cut with an ellipsis stays readable whole in its title.
    expect(rows.map((r) => r.querySelector(".dk-mon-name")?.getAttribute("title"))).toEqual(["Long 2s10s", "Long S&P 500", "Long NDX vs SPX"]);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toContain("Long 2s10s2% NAV29% room · 10 bp to level");
    expect(rows[1].textContent?.replace(/\s+/g, " ")).toContain("Long S&P 5003% NAV60% room · 1.1% to level");
    expect(rows[2].textContent?.replace(/\s+/g, " ")).toContain("Long NDX vs SPX4% NAVmanual");
    expect(within(rows[0]).getByText(/29% room/)).toHaveAttribute("data-tone", "amber");
    expect(within(rows[1]).getByText(/60% room/)).toHaveAttribute("data-tone", "green");
    expect(rows[2].querySelector(".dk-mon-bar")?.children).toHaveLength(0);
    expect(card).toHaveTextContent("Sorted by room left · same scale for every trade · size as % of NAV · click a row for the gate text");
    expect(within(card).getByRole("link", { name: "Act on this → Position Monitor" })).toHaveAttribute("href", "/desk/position-monitor");
  });

  it("the monitored rows stay live from the browser when /overview is awaiting (§1.0), and say so when there are none", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(RECORDS));
    stubDesk({ "/api/desk/overview": () => awaitingEnvelope({ reason: "generation warming", until: null }, FIXTURE_META) });
    const first = renderOverview();
    const card = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(within(card).getAllByTestId("dk-mon-row")).toHaveLength(3));
    first.unmount();
    localStorage.removeItem(POSITIONS_KEY);
    stubDesk();
    renderOverview();
    expect(await screen.findByText("No positions are monitored in this browser.")).toBeInTheDocument();
  });

  it("with no /overview every tile keeps its label and says Awaiting refresh, no number", async () => {
    stubDesk({ "/api/desk/overview": deskError(503, "generation warming") });
    renderOverview();
    const regime = await screen.findByRole("region", { name: "Regime" });
    await waitFor(() => expect(regime).toHaveTextContent("Awaiting refresh"));
    for (const name of ["Regime", "Recession · logistic model", "S&P 500 · trend", "Vol · VIX"]) {
      const tile = screen.getByRole("region", { name });
      expect(tile).toHaveTextContent("Awaiting refresh");
      expect((tile.textContent ?? "").replace(name, "")).not.toMatch(/\d/);
    }
    expect(screen.getByTestId("ov-since")).toHaveTextContent("Awaiting refresh");
    expect(screen.queryByText("Overheating")).toBeNull();
  });
});

describe("blocks served awaiting inside a ready answer (§12.1, §1.0.2)", () => {
  const off = (reason: string) => ({ status: "awaiting", data: null, unavailable: { reason, until: null } });
  it("a tile keeps its label, says Not yet served and prints its reason; the since line prints its reason; the rest stands", async () => {
    stubDesk({ "/api/desk/overview": () => ({ ...overview, tiles: { ...overview.tiles, vol: off("realized-volatility method not specified.") }, since_last_close: off("no previous generation to compare.") }) });
    renderOverview();
    await waitFor(() => expect(screen.getByRole("region", { name: "Vol · VIX" })).toHaveTextContent("realized-volatility method not specified."));
    const vol = screen.getByRole("region", { name: "Vol · VIX" });
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(vol).not.toHaveTextContent("14.2");
    expect(screen.getByTestId("ov-since")).toHaveTextContent("Since last close");
    expect(screen.getByTestId("ov-since")).toHaveTextContent("no previous generation to compare.");
    expect(screen.getByTestId("ov-since")).not.toHaveTextContent("Awaiting refresh");
    expect(screen.getByRole("region", { name: "Regime" })).toHaveTextContent("Goldilocks");
  });
});
