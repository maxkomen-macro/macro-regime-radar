/**
 * Data Pipeline (DESK_FRAME3_SPEC §11, §12.11) against the fixture: the
 * top-bar badge, the lineage, the inventory grouped as served (a group
 * opens by click or by `?group=`, its table scrolls inside it), a search that
 * opens a series' group, the bridge's two downloads, and Awaiting refresh with
 * the labels kept when /pipeline fails.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import pipeline from "../../../fixtures/desk/pipeline.json";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import type { PipelineGroup } from "../data/types";
import { refreshWords } from "./badge";
import { findSeries, LINEAGE, SCHEMA_PREVIEW } from "./PipelinePage";
import { LAST_STUDY_KEY, readLastStudy, writeLastStudy } from "../event-study/question";

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderTab(route = "/desk/data-pipeline") {
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

const groups = pipeline.groups as unknown as PipelineGroup[];
const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("Pipeline words", () => {
  it("dates the refresh in UTC", () => {
    expect(refreshWords("2026-09-22T00:23:00Z")).toBe("Sep 22, 00:23 UTC");
    expect(refreshWords(null)).toBe("");
  });
  it("finds a series by name, id or note, and opens its group", () => {
    // desk/fill-compute: the Desk's VIX is ^VIX, stored beside ^GSPC (asset_prices).
    expect(findSeries(groups, "VIX")).toEqual({ group: "Equities & vol", id: "^VIX" });
    expect(findSeries(groups, "dgs10")).toEqual({ group: "Rates", id: "DGS10" });
    expect(findSeries(groups, "gold")).toEqual({ group: "FX & commodities", id: "GC=F" });
    // a series no live tab reads says so in its note (desk-v2: feeds)
    expect(findSeries(groups, "no desk tab reads")).toEqual({ group: "Equities & vol", id: "^NDX" });
    expect(findSeries(groups, "WTI")).toEqual({ group: "FX & commodities", id: "DCOILWTICO" });
    expect(findSeries(groups, "nothing like this")).toBeNull();
  });
  it("has the six lineage steps of §11 and the board's schema lines", () => {
    expect(LINEAGE.map((s) => s.step)).toEqual(["Sources", "Fetch", "Validate", "Transform", "Store", "Serve"]);
    expect(LINEAGE[0].lines).toEqual(["FRED API", "Yahoo Finance", "EODHD (live tape)"]);
    expect(SCHEMA_PREVIEW.split("\n")[0]).toBe("-- RAW: exact copy of source, never edited");
    expect(SCHEMA_PREVIEW).toContain("-- Every MART row carries run_at + inputs_hash → reproducible.");
  });
  it("keeps the last study, and survives storage that is off or throws", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    writeLastStudy("shock=gold&window=20", store);
    expect(mem.get(LAST_STUDY_KEY)).toBe("shock=gold&window=20");
    expect(readLastStudy(store)).toBe("shock=gold&window=20");
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readLastStudy(broken)).toBeNull();
    expect(() => writeLastStudy("x", broken)).not.toThrow();
    expect(readLastStudy(null)).toBeNull();
  });
});

describe("Data Pipeline tab", () => {
  it("the badge, the title, the groups as served, all closed", async () => {
    renderTab();
    // The audit's §1: the last full run checked the store at 15:52 UTC on Sep 24; no validation.json was published
    // with that store, so the verdict is null and reads "unknown" (§12.9, S-01; Codex R-24).
    expect(await screen.findByTestId("pl-badge")).toHaveTextContent("Last full refresh Sep 24, 15:52 UTC · validation unknown");
    expect(await screen.findByRole("heading", { level: 1, name: "Where every number comes from" })).toBeInTheDocument();
    const inv = screen.getByRole("region", { name: /Series inventory/ });
    await waitFor(() => expect(inv).toHaveTextContent("46 series · grouped · generated from the registry"));
    const heads = within(inv).getAllByRole("button", { expanded: false });
    // §12.9: each group's status is the worst of its series; a series not stored is missing.
    expect(heads.map((b) => b.textContent)).toEqual([
      "▸Rates8 series ● missing",
      "▸Credit2 series ● current",
      "▸Equities & vol4 series ● missing",
      "▸FX & commodities4 series ● missing",
      "▸Macro (monthly)4 series ● current",
      // desk/fill-etf: the ETFs the full refresh stores in asset_prices
      "▸Sector ETFs11 series ● current",
      "▸Equity ETFs7 series ● current",
      "▸Bond, gold & dollar ETFs6 series ● current",
    ]);
    expect(within(inv).getAllByText("● current")[0]).toHaveAttribute("data-tone", "green");
    expect(within(inv).getAllByText("● missing")[0]).toHaveAttribute("data-tone", "amber");
  });
  it("a group opens by click and by ?group=, its rows in a scrolling region", async () => {
    renderTab("/desk/data-pipeline?group=credit");
    const rows = await screen.findByRole("region", { name: "Credit series" });
    expect(rows).toHaveAttribute("tabindex", "0");
    // §11: provider and frequency beside the series; a daily series dated to the day, a monthly one to the month.
    // The served row (desk-v2: feeds): the registry's provider declaration, the tabs whose values read it, its note.
    expect(within(rows).getAllByRole("row")[1].textContent).toBe(
      "US HY OAS · FRED (Desk daily history), dailyBAMLH0A0HYM2Sep 25, 2023Sep 23, 2026Overview, Event Study, Regime, Macro, Ledgercurrent · ICE BofA index OAS, published the next morning. FRED serves a rolling three years only (since April 2026); the store keeps every observation it has been served, from 2023-09-25.",
    );
    // IG is daily at FRED, stored one row a month: first its first month stamp, last its watermark (S-03).
    expect(within(rows).getAllByRole("row")[2].textContent).toContain("Dec 1, 1996Sep 23, 2026");
    expect(screen.getByText("showing 2 of 2 · the list scrolls inside the group; the page does not grow")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Rates/ }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("group=rates"));
    expect(screen.getByRole("region", { name: "Rates series" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Credit series" })).toBeNull();
  });
  it("search jumps to a series and opens its group; a miss says so", async () => {
    renderTab();
    const input = await screen.findByLabelText("Find a series");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "VIX" } });
    const rows = await screen.findByRole("region", { name: "Equities & vol series" });
    expect(rows.querySelector("tr[data-hit]")?.textContent).toContain("^VIX");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(within(screen.getByRole("region", { name: /Series inventory/ })).getByRole("status")).toHaveTextContent("No series matches “zzz”.");
  });
  it("the bridge downloads the current study's events and the DDL", async () => {
    const { calls } = stubDesk();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    // jsdom has no object URLs.
    Object.defineProperty(URL, "createObjectURL", { value: vi.fn(() => "blob:fixture"), configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: vi.fn(), configurable: true });
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Export current study → CSV" }));
    const bridge = screen.getByRole("region", { name: /Proposed export schema \(not the current SQLite layout\)/ });
    // §11's exact title.
    expect(within(bridge).getByRole("heading", { level: 2 })).toHaveTextContent(/^Proposed export schema \(not the current SQLite layout\)$/);
    await waitFor(() => expect(within(bridge).getByRole("status")).toHaveTextContent("Saved gold-2sigma-spx-weak-events.csv."));
    expect(calls.some((c) => c.includes("/api/desk/study/events?preset=gold-2sigma-spx-weak"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Generate Snowflake DDL" }));
    await waitFor(() => expect(within(bridge).getByRole("status")).toHaveTextContent("Saved macro-regime-radar-desk.sql."));
    expect(click).toHaveBeenCalledTimes(2);
  });
  it("a validation that did not pass is amber, and shows even without a refresh time", async () => {
    const { last_refresh_utc: _t, ...rest } = pipeline;
    void _t;
    stubDesk({ "/api/desk/pipeline": () => ({ ...rest, validation: "fail" }) });
    renderTab();
    const badge = await screen.findByTestId("pl-badge");
    expect(badge).toHaveTextContent("Last full refresh unknown · validation failed");
    expect(badge).toHaveAttribute("data-tone", "amber");
  });
  it("a group without words shows its served status; an empty group says so; no groups says Awaiting", async () => {
    const groups = pipeline.groups.map((g, i) => (i === 0 ? { ...g, status: "stale" } : i === 1 ? { ...g, series: [] } : g));
    stubDesk({ "/api/desk/pipeline": () => ({ ...pipeline, groups }) });
    const first = renderTab("/desk/data-pipeline?group=credit");
    expect(await screen.findByRole("button", { name: /^Rates\s*8 series\s*● stale/ })).toBeInTheDocument();
    expect(await screen.findByText("No series in this group yet.")).toBeInTheDocument();
    first.unmount();
    stubDesk({ "/api/desk/pipeline": () => ({ ...pipeline, groups: [] }) });
    renderTab();
    const inv = await screen.findByRole("region", { name: /Series inventory/ });
    await waitFor(() => expect(inv).toHaveTextContent("Awaiting refresh · the registry's inventory"));
    expect(inv).not.toHaveTextContent("0 series");
  });
  it("a download that fails or answers the wrong type saves nothing and says so", async () => {
    stubDesk({ "/api/desk/study/events": () => ({ events: [] }), "/api/desk/pipeline/ddl": deskError(503, "warming") });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Export current study → CSV" }));
    const bridge = screen.getByRole("region", { name: /Proposed export schema \(not the current SQLite layout\)/ });
    await waitFor(() => expect(within(bridge).getByRole("status")).toHaveTextContent("The study's events did not answer; nothing was saved."));
    fireEvent.click(screen.getByRole("button", { name: "Generate Snowflake DDL" }));
    await waitFor(() => expect(within(bridge).getByRole("status")).toHaveTextContent("The DDL did not answer; nothing was saved."));
    expect(click).not.toHaveBeenCalled();
  });
  it("while loading the inventory is busy and says nothing yet", async () => {
    stubDesk({ "/api/desk/pipeline": () => new Promise(() => {}) });
    renderTab();
    const inv = await screen.findByRole("region", { name: /Series inventory/ });
    expect(inv).toHaveAttribute("aria-busy", "true");
    expect(inv).not.toHaveTextContent("Awaiting refresh");
  });
  it("a failed /pipeline keeps the cards and says Awaiting refresh; no badge", async () => {
    stubDesk({ "/api/desk/pipeline": deskError(503, "warming") });
    renderTab();
    const inv = await screen.findByRole("region", { name: /Series inventory/ });
    await waitFor(() => expect(inv).toHaveTextContent("Awaiting refresh · the registry's inventory"));
    expect(screen.queryByTestId("pl-badge")).toBeNull();
    expect(screen.getByRole("region", { name: "Lineage" })).toHaveTextContent("1 · Sources");
  });
});

describe("Sync to Snowflake (PROTOTYPE, §1.0.3)", () => {
  it("connect → stage → merge → verify, each table's row counts, the last run verified; its footnote last; the DDL and CSV untouched", async () => {
    stubDesk();
    renderTab();
    const c = await screen.findByRole("region", { name: /^Sync to Snowflake/ });
    expect(c).toHaveAttribute("data-prototype", "snowflake-sync");
    expect(within(c).getAllByRole("listitem").map((li) => li.querySelector(".dk-stat-label")?.textContent?.replace(/\s+/g, " ").trim())).toEqual(["✓ 1 · Connect", "✓ 2 · Stage", "✓ 3 · Merge", "✓ 4 · Verify"]);
    const rows = within(within(c).getByRole("table")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(6);
    expect(rows[2]).toHaveTextContent(/CUR\.SERIES_DAILY\s*series_key, dt\s*63\s*\+58 · 5 updated\s*198,832\s*198,832\s*match/);
    expect(rows[5]).toHaveTextContent(/MART\.INDEX_LEVELS\s*basket_id, dt\s*2,951\s*rebuilt\s*2,951\s*2,951\s*match/);
    expect(c).toHaveTextContent("Verified: 6 of 6 tables match the snapshot · 3,504 rows staged · 7.9 s on MRR_LOAD_XS");
    expect(within(c).queryByTestId("dk-live")).toBeNull();
    expect(c.querySelector("[data-prototype-foot]")!.textContent).toBe("Illustrative values · In production: a job after each validated refresh: stage the changed rows, MERGE on each key, check counts and hashes.");
    // The real bridge keeps its two buttons.
    expect(screen.getByRole("button", { name: "Export current study → CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Snowflake DDL" })).toBeInTheDocument();
  });

  it("Sync to Snowflake replays the four steps, then verifies again", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubDesk();
      renderTab();
      const c = await screen.findByRole("region", { name: /^Sync to Snowflake/ });
      fireEvent.click(within(c).getByRole("button", { name: "Sync to Snowflake" }));
      expect(within(c).getByRole("button", { name: "Syncing…" })).toBeDisabled();
      expect(c).toHaveTextContent("Syncing: connect…");
      expect(within(c).getAllByText("…").length).toBeGreaterThan(0);
      await act(async () => {
        vi.advanceTimersByTime(2600);
      });
      await waitFor(() => expect(c).toHaveTextContent("Verified: 6 of 6 tables match the snapshot"));
      expect(within(c).getByRole("button", { name: "Sync to Snowflake" })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
