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
