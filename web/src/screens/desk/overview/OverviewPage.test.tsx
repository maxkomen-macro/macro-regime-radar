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
import { gapWords, sinceItems, trendWords } from "./OverviewPage";

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
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Overview words", () => {
  it("spells the since-last-close items in the spec's order", () => {
    expect(sinceItems(fixture.since_last_close!).map((i) => `${i.text}${i.tag ? ` ${i.tag}` : ""}`)).toEqual([
      "Dollar −2σ fired (new)",
      "2s10s still firing, day 10",
      "vol up 0.8 pts, skew steeper",
      "regime unchanged",
      "data refreshed 00:23 UTC",
    ]);
    expect(sinceItems({ ...fixture.since_last_close!, regime_changed: true, regime_from: "Goldilocks", regime_to: "Overheating", vol_change_pts: -1.2 }).map((i) => i.text)).toContain("regime changed → Overheating");
    expect(sinceItems({ ...fixture.since_last_close!, vol_change_pts: -1.2 }).find((i) => i.key === "vol")?.text).toBe("vol down 1.2 pts, skew steeper");
  });

  it("names the trend from the two served flags", () => {
    expect(trendWords(fixture.tiles!.trend!)).toEqual({ value: "Above 50 & 200", trend: "Uptrend" });
    expect(trendWords({ ...fixture.tiles!.trend!, above_50: false, above_200: false })).toEqual({ value: "Below 50 & 200", trend: "Downtrend" });
    expect(trendWords({ ...fixture.tiles!.trend!, above_50: false }).trend).toBe("Mixed trend");
  });

  it("rounds the implied-over-realized gap to whole points and keeps its sign", () => {
    expect(gapWords(4.3)).toBe("protection costs about 4 pts more than recent moves justify");
    expect(gapWords(-2.6)).toBe("protection costs about 3 pts less than recent moves justify");
    expect(gapWords(0.2)).toBe("protection costs about what recent moves justify");
  });
});

describe("Overview tab", () => {
  it("prints the since-last-close line and the four tiles from /overview", async () => {
    renderOverview();
    const since = await screen.findByTestId("ov-since");
    await waitFor(() => expect(since).toHaveTextContent("Dollar −2σ fired (new)"));
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
    expect(vol).toHaveTextContent("Calm · protection costs about 4 pts more than recent moves justify");
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

  it("sorts the monitored positions by room left, least first, with size and distance in their units", async () => {
    renderOverview();
    const card = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(within(card).getAllByTestId("dk-mon-row")).toHaveLength(3));
    const rows = within(card).getAllByTestId("dk-mon-row");
    expect(rows.map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "ai-infra-hedged", "ndx-vs-spx"]);
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toContain("2% NAV22% room · 3 bp to level");
    expect(rows[2].textContent?.replace(/\s+/g, " ")).toContain("4% NAV68% room · 3.4% to level");
    expect(within(rows[0]).getByText(/22% room/)).toHaveAttribute("data-tone", "amber");
    expect(within(rows[2]).getByText(/68% room/)).toHaveAttribute("data-tone", "green");
    expect(card).toHaveTextContent("Sorted by room left · same scale for every trade · size as % of NAV · click a row for the gate text");
    expect(within(card).getByRole("link", { name: "Act on this → Position Monitor" })).toHaveAttribute("href", "/desk/position-monitor");
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
