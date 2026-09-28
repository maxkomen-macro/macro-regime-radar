/**
 * §1.1 and §12.0's consistency rule (Codex R-22): the page knows the one
 * generation its answers share (on <main>, data-generations; desk/usability
 * §14.13 took the "Generation gen-…" footer off the screen); answers from two
 * generations make the page badge read "mixed generations · refreshing", and
 * the page's Desk answers are asked again once.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "./DeskShell";
import overview from "../../fixtures/desk/overview.json";
import ledger from "../../fixtures/desk/ledger.json";
import pipeline from "../../fixtures/desk/pipeline.json";
import study from "../../fixtures/desk/study.json";
import { FIXTURE_META } from "../../fixtures/desk";
import { awaitingEnvelope } from "./data/envelope";
import { renderWithProviders } from "../../test/utils";
import { stubDesk } from "../../test/desk";

const gens = () => document.querySelector("main")?.getAttribute("data-generations") ?? null;

function renderTab(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the page's generations (§1.1, Codex R-22)", () => {
  it("the page knows the one generation every answer on it shares, and prints no generation id", async () => {
    renderTab("/desk/signal-ledger");
    await waitFor(() => expect(gens()).toBe("gen-fixture-2026-09-24"));
    expect(screen.queryByTestId("dk-gen-mixed")).toBeNull();
    expect(screen.queryByTestId("dk-gen")).toBeNull();
    expect(document.body).not.toHaveTextContent("gen-fixture");
  });

  it("S-32: the Client view's footer says only the snapshot's date, no generation id", async () => {
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&view=client");
    await screen.findByRole("heading", { name: "Gold jumps over a month while the S&P is weak" });
    await waitFor(() => expect(screen.getByTestId("dk-gen")).toHaveTextContent(/^Snapshot · Sep 24, 2026$/));
    expect(screen.getByTestId("dk-gen")).toHaveAttribute("data-snapshot");
    expect(document.body).not.toHaveTextContent("gen-fixture");
  });

  it("S-32: the snapshot date is the study's own as_of, the one its source line prints", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, as_of: "2026-09-23" }) });
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&view=client");
    await screen.findByRole("heading", { name: "Gold jumps over a month while the S&P is weak" });
    await waitFor(() => expect(screen.getByTestId("dk-gen")).toHaveTextContent(/^Snapshot · Sep 23, 2026$/));
  });

  it("S-32: on the Client view the mixed-generation check still runs: the answers are asked again once", async () => {
    const { calls } = stubDesk({ "/api/desk/study": () => ({ ...study, generation_id: "gen-next" }) });
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&view=client");
    await screen.findByRole("heading", { name: "Gold jumps over a month while the S&P is weak" });
    const asked = () => calls.filter((c) => c.startsWith("GET /api/desk/study?")).length;
    await waitFor(() => expect(asked()).toBe(2));
    await new Promise((r) => setTimeout(r, 200));
    expect(asked()).toBe(2);
    expect(screen.getByTestId("dk-gen")).toHaveTextContent(/^Snapshot · Sep 24, 2026$/);
  });

  it("a refusal answered in its envelope names its generation too, so a disagreement with it is seen", async () => {
    const refused = { status: "error", generation_id: "gen-error", as_of: null, engine_version: "unknown", data: null, unavailable: null, error: { code: "unsupported", message: "No study in the catalog asks that." } };
    stubDesk({ "/api/desk/ledger": () => ({ status: 422, body: refused }) });
    renderTab("/desk/signal-ledger");
    await waitFor(() => expect(gens()).toContain("gen-error"));
    expect(screen.getByTestId("dk-gen-mixed")).toBeInTheDocument();
  });

  it("on Data Pipeline the header badge is the page badge: it says mixed, and the title carries no second badge", async () => {
    stubDesk({ "/api/desk/pipeline": () => ({ ...pipeline, generation_id: "gen-next" }) });
    renderTab("/desk/data-pipeline");
    await waitFor(() => expect(screen.getAllByTestId("dk-gen-mixed")).toHaveLength(1));
    expect(screen.getByTestId("dk-gen-mixed")).toHaveClass("pl-badge");
  });

  it("an awaiting answer names its generation too", async () => {
    stubDesk({ "/api/desk/ledger": () => awaitingEnvelope({ reason: "generation warming", until: null }, { ...FIXTURE_META, generation_id: "gen-awaiting" }) });
    renderTab("/desk/signal-ledger");
    await waitFor(() => expect(gens()).toContain("gen-awaiting"));
  });

  it("answers from two generations: the badge says so, the page knows both, and asks again once", async () => {
    const { calls } = stubDesk({ "/api/desk/ledger": () => ({ ...ledger, generation_id: "gen-next" }) });
    renderTab("/desk/signal-ledger");
    await waitFor(() => expect(screen.getByTestId("dk-gen-mixed")).toHaveTextContent("mixed generations · refreshing"));
    expect(gens()).toBe("gen-fixture-2026-09-24 gen-next");
    const asked = () => calls.filter((c) => c.startsWith("GET /api/desk/ledger")).length;
    await waitFor(() => expect(asked()).toBe(2));
    // The same disagreement after the refetch is not asked about again.
    await new Promise((r) => setTimeout(r, 200));
    expect(asked()).toBe(2);
  });

  it("once the answers agree again, the badge is the page's own", async () => {
    let n = 0;
    stubDesk({ "/api/desk/overview": () => ({ ...overview, generation_id: n++ === 0 ? "gen-old" : FIXTURE_META.generation_id }) });
    renderTab("/desk/overview");
    await waitFor(() => expect(gens()).toBe("gen-fixture-2026-09-24"));
    expect(screen.queryByTestId("dk-gen-mixed")).toBeNull();
    expect(n).toBe(2);
  });
});
