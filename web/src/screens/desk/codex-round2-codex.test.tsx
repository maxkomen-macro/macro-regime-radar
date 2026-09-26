/**
 * Codex round 2's own repros (desk/frame-3 at 7bb2a3e), R-16 to R-20, as its
 * report states them (item 15). R-16's positions half was a fixture the API
 * served; item 10 moved positions to this browser's store, so the same repro
 * runs through a seeded store and through Import JSON. Its active-signals half
 * runs against /overview. Each test is Codex's repro with its expectation
 * turned into an assertion of the fixed behaviour; the tests marked "extends"
 * carry R-16 to the other position surfaces (the verifier's round, item 15).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "./DeskShell";
import overview from "../../fixtures/desk/overview.json";
import positionSample from "../../fixtures/desk/positions.json";
import study from "../../fixtures/desk/study.json";
import { renderWithProviders } from "../../test/utils";
import { stubDesk } from "../../test/desk";
import { POSITIONS_KEY } from "./positions/store";
import { decimal, legsKey } from "./basket/weights";

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
  localStorage.removeItem(POSITIONS_KEY);
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(POSITIONS_KEY);
});

/** The positions fixture with positions[0].instrument = null (Codex's repro). */
const brokenPositions = () => (positionSample as { positions: Record<string, unknown>[] }).positions.map((p, i) => (i === 0 ? { ...p, instrument: null } : p));

function withoutKey(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...o };
  delete copy[key];
  return copy;
}

describe("Codex R-16: an incomplete collection claims no complete total and no empty state", () => {
  it("positions[0].instrument = null in a seeded store: no '8% deployed, 2 positions' as if the collection were whole", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(brokenPositions()));
    renderTab("/desk/position-monitor");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("Long 2s10s"));
    expect(mon).not.toHaveTextContent(/% deployed/);
    expect(mon).not.toHaveTextContent(/\b2 positions\b/);
    expect(mon).toHaveTextContent("2 readable positions · click a row");
    expect(within(mon).getByRole("status")).toHaveTextContent("1 kept position could not be read.");
  });

  it("the same collection through Import JSON: the same", async () => {
    renderTab("/desk/position-monitor");
    const text = JSON.stringify({ ...positionSample, positions: brokenPositions() });
    const file = new File([text], "positions.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    fireEvent.change(await screen.findByLabelText("Import positions"), { target: { files: [file] } });
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("Long 2s10s"));
    expect(mon).not.toHaveTextContent(/% deployed/);
    expect(mon).toHaveTextContent("2 readable positions · click a row");
    expect(within(mon).getByRole("status")).toHaveTextContent("1 kept position could not be read.");
  });

  it("extends: with no readable open position, Position Monitor says a kept one could not be read, never 'No open positions'", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([brokenPositions()[0]]));
    renderTab("/desk/position-monitor");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("No readable open position; 1 kept position could not be read."));
    expect(mon).not.toHaveTextContent("No open positions in this browser.");
  });

  it("extends: a closed record that cannot be read leaves the 90-day strip without counts", async () => {
    const all = (positionSample as { positions: Record<string, unknown>[] }).positions;
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(all.map((p) => (p.id === "gold-dip" ? { ...p, instrument: null } : p))));
    renderTab("/desk/position-monitor");
    const strip = await screen.findByRole("region", { name: "Closed in the last 90 days" });
    await waitFor(() => expect(within(strip).getByRole("status")).toHaveTextContent("1 kept position could not be read."));
    expect(strip).not.toHaveTextContent(/\d of \d/);
    expect([...strip.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["—", "—", "—"]);
  });

  it("extends: the Overview's monitored rows: no 'none' while a kept position cannot be read, and the loss said beside the rows", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([brokenPositions()[0]]));
    const one = renderTab("/desk/overview");
    expect(await screen.findByText("No readable position is monitored; 1 kept position could not be read.")).toBeInTheDocument();
    expect(screen.queryByText("No positions are monitored in this browser.")).toBeNull();
    one.unmount();
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(brokenPositions()));
    renderTab("/desk/overview");
    expect(await screen.findByText("1 kept position could not be read.")).toBeInTheDocument();
  });

  it("every active signal's label null on /overview: the Overview does not say nothing is firing", async () => {
    stubDesk({ "/api/desk/overview": () => ({ ...overview, active_signals: overview.active_signals.map((r) => ({ ...r, label: null })) }) });
    renderTab("/desk/overview");
    await waitFor(() => expect(screen.getByText(`${overview.active_signals.length} rows could not be read.`)).toBeInTheDocument());
    expect(screen.queryByText(/Nothing is firing/)).toBeNull();
  });
});

describe("Codex R-17: an absent firing status is no negative observation", () => {
  it("firing_now deleted from the study: no 'Not firing today'", async () => {
    // stale: false, so the pill reaches the firing branch Codex hit (the fixture is stale since item 12).
    stubDesk({ "/api/desk/study": () => withoutKey({ ...study, stale: false }, "firing_now") });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("● Live"));
    expect(card).not.toHaveTextContent("Not firing today");
  });
});

describe("Codex R-18: a missing requested horizon is not replaced by the first available one", () => {
  it("question.horizon 20 kept, the h = 20 row removed: the month's labels stay, with no five-session statistics", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, horizons: study.horizons.filter((h) => h.h !== 20) }) });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent(/Up a month later\s*Awaiting refresh/));
    // The stats are the requested horizon's or nothing; the chart below still draws each horizon it has.
    const five = study.horizons.find((h) => h.h === 5)!;
    const stats = [...card.querySelectorAll(".dk-stat")].map((e) => e.textContent ?? "").join(" | ");
    expect(stats).not.toContain(`${five.up_n} of ${five.n}`);
    expect(stats).not.toContain("+1.6%");
    expect(card).toHaveTextContent(/Median at a month\s*Awaiting refresh/);
  });
});

describe("Codex R-19: a missing comparison keeps its label and an unavailable state", () => {
  it("without_condition deleted from the conditional study: the line stays, Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": () => withoutKey(study, "without_condition") });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card.textContent?.replace(/\s+/g, " ")).toContain("Without the S&P condition: Awaiting refresh"));
  });
});

describe("Codex R-20: tiny distinct weights keep their value and identity", () => {
  it("decimal(1e-21) and decimal(2e-21) are neither 0 nor equal; numeric legs with them get distinct keys", () => {
    expect(decimal(1e-21)).not.toBe("0");
    expect(decimal(2e-21)).not.toBe("0");
    expect(decimal(1e-21)).not.toBe(decimal(2e-21));
    expect(legsKey([{ symbol: "A", weight: 1e-21 }])).not.toBe(legsKey([{ symbol: "A", weight: 2e-21 }]));
  });
});
