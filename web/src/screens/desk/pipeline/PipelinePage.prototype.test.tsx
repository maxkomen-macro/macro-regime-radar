/**
 * Data Pipeline's "Sync to Snowflake" PROTOTYPE (DESK_FRAME3_SPEC §11, §1.0.3), with the registry drawing the card.
 * The 2026-11-16 release does not draw it (rule 10; ./PipelinePage.test.tsx holds the page without it); these tests,
 * moved from that file, hold the card where it would stand if it returns.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";

vi.mock("../prototypes/registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("../prototypes/registry")>();
  const rows = real.PROTOTYPES.map((p) => ({ ...p, shown: true }));
  const prototype = (id: string) => {
    const e = rows.find((p) => p.id === id);
    if (!e) throw new Error(`no PROTOTYPE registry row for ${id}`);
    return e;
  };
  return { ...real, PROTOTYPES: rows, prototype, prototypeShown: (id: string) => prototype(id).shown, shownPrototypes: () => rows };
});

function renderTab(route = "/desk/data-pipeline") {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
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
