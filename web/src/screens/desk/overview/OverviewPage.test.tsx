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
import { sinceItems, trendWords } from "./OverviewPage";
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
    // The dollar study is unavailable (DXY not stored, §1.0), so it cannot fire; no skew is served (§1.0).
    expect(sinceItems(fixture.since_last_close!).map((i) => `${i.text}${i.tag ? ` ${i.tag}` : ""}`)).toEqual([
      "2s10s steepening still firing, day 10",
      "vol up 0.8 pts",
      "regime unchanged",
      "data refreshed 00:23 UTC",
    ]);
    expect(sinceItems({ ...fixture.since_last_close!, regime_changed: true, regime_from: "Goldilocks", regime_to: "Overheating", vol_change_pts: -1.2 }).map((i) => i.text)).toContain("regime changed → Overheating");
    expect(sinceItems({ ...fixture.since_last_close!, vol_change_pts: -1.2 }).find((i) => i.key === "vol")?.text).toBe("vol down 1.2 pts");
    // §2: each new fire with (new); its served short name.
    expect(sinceItems({ ...fixture.since_last_close!, new_fires: [{ slug: "golden-cross", label: "S&P golden cross", short: "golden cross" }] })[0]).toEqual({ key: "new-golden-cross", text: "golden cross fired", tag: "(new)" });
  });

  it("names the trend from the two served flags", () => {
    expect(trendWords(fixture.tiles!.trend!)).toEqual({ value: "Above 50 & 200", trend: "Uptrend" });
    expect(trendWords({ ...fixture.tiles!.trend!, above_50: false, above_200: false })).toEqual({ value: "Below 50 & 200", trend: "Downtrend" });
    expect(trendWords({ ...fixture.tiles!.trend!, above_50: false }).trend).toBe("Mixed trend");
  });

});

describe("Overview tab", () => {
  it("prints the since-last-close line and the four tiles from /overview", async () => {
    renderOverview();
    const since = await screen.findByTestId("ov-since");
    await waitFor(() => expect(since).toHaveTextContent("2s10s steepening still firing, day 10"));
    // §12.1 (B-05): the two sessions compared, by their dates.
    expect(within(since).getByText("Since last close")).toHaveAttribute("title", "the Sep 22 close against Sep 21");
    expect(since).not.toHaveTextContent("Dollar");
    expect(since.textContent).toContain("data refreshed 00:23 UTC");
    const regime = screen.getByRole("region", { name: "Regime" });
    // §2: the K−2 row governing today (a September session reads the July row).
    expect(regime).toHaveTextContent("Live · Jul row");
    expect(regime).toHaveTextContent("Overheating");
    expect(regime).toHaveTextContent("Growth rising, inflation rising · rule-based, two-month lag");
    const rec = screen.getByRole("region", { name: "Recession · logistic model" });
    expect(rec).toHaveTextContent("12%");
    // §2: "<band> · score for <probability_month> · inputs through <inputs_through>"; no odds in words.
    expect(rec).toHaveTextContent("Low · score for Aug 2026 · inputs through May 2026");
    expect(rec).not.toHaveTextContent("one-in-eight");
    const trend = screen.getByRole("region", { name: "S&P 500 · trend" });
    expect(trend).toHaveTextContent("Live · Sep 22");
    expect(trend).toHaveTextContent("Above 50 & 200");
    expect(trend).toHaveTextContent("Uptrend since the Jul 2025 golden cross · that signal is reliable");
    const vol = screen.getByRole("region", { name: "Vol · VIX" });
    expect(vol).toHaveTextContent("16.2");
    // §2: the level and its day; the gap to realized and the band word are unavailable (§1.0).
    expect(vol).toHaveTextContent("VIX 16.2 · Sep 22");
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
    expect(rows[0]).toHaveTextContent("S&P golden cross");
    expect(rows[0]).toHaveTextContent("last fired Jul 1, 2025");
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toContain("Fired 31× since 1990 · S&P up 68% of the time · 20-day median +2.7% (+1.4 pts vs normal)");
    expect(within(rows[0]).getByText("Reliable")).toBeInTheDocument();
    expect(rows[2].textContent?.replace(/\s+/g, " ")).toContain("Fired 18× since 2000");
    expect(within(rows[2]).getByText("Suggestive")).toBeInTheDocument();
    expect(rows[4].textContent?.replace(/\s+/g, " ")).toContain("20-day median −0.6% (−1.9 pts vs normal)");
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
    const spx = { ...curve, id: "spx-long", instrument: "S&P 500", size_nav: 0.03, wrong_if: { id: "below_50d", label: "closes below its 50-day (6,280)" }, subject: { kind: "instrument", id: "spx" }, entry_value: 6500, original_room: 220, trigger: { series: "spx", operator: "below", threshold: 6280, policy: "frozen", observed_on: "2026-09-02" } };
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([ndx, spx, { ...curve, entry_value: 58, original_room: 20 }]));
    renderOverview();
    const card = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(card).toHaveTextContent("15% room"));
    const rows = within(card).getAllByTestId("dk-mon-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "spx-long", "ndx-vs-spx"]);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toContain("Long 2s10s2% NAV15% room · 3 bp to level");
    expect(rows[1].textContent?.replace(/\s+/g, " ")).toContain("Long S&P 5003% NAV60% room · 2.1% to level");
    expect(rows[2].textContent?.replace(/\s+/g, " ")).toContain("Long NDX vs SPX4% NAVmanual");
    expect(within(rows[0]).getByText(/15% room/)).toHaveAttribute("data-tone", "amber");
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
    expect(vol).not.toHaveTextContent("16.2");
    expect(screen.getByTestId("ov-since")).toHaveTextContent("Since last close");
    expect(screen.getByTestId("ov-since")).toHaveTextContent("no previous generation to compare.");
    expect(screen.getByTestId("ov-since")).not.toHaveTextContent("Awaiting refresh");
    expect(screen.getByRole("region", { name: "Regime" })).toHaveTextContent("Overheating");
  });
});
