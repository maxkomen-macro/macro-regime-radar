/**
 * The Desk v2 shell against DESK_FRAME3_SPEC §1: the sidebar is the only
 * navigation (three groups, eleven tabs, the TODAY and HOUSE DISCIPLINE
 * cards), the header carries the breadcrumb, the Desk / Client toggle in the
 * URL and the tab's one action, old slugs land on the tab that replaced them,
 * and the TODAY card reads /overview and /technicals. Every request is
 * answered from the §12 fixtures (src/fixtures/desk) unless a test overrides
 * it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "./DeskShell";
import { spxDayLabel } from "./DeskSidebar";
import { DESK_GROUPS } from "./desk-sections";
import { renderWithProviders } from "../../test/utils";
import { deskError, stubDesk } from "../../test/desk";

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderDesk(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
        <Route path="*" element={<p>elsewhere</p>} />
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
});

describe("Desk v2 shell", () => {
  it("lands /desk on Overview and names the document", async () => {
    renderDesk("/desk");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/overview"));
    expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Overview · Desk · Macro Regime Radar"));
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("the sidebar is the only navigation: three groups, eleven tabs, in the spec's order", async () => {
    renderDesk("/desk/overview");
    const side = await screen.findByRole("complementary", { name: "Sidebar" });
    const groups = within(side).getAllByRole("group");
    expect(groups.map((g) => within(g).getByText(/^(Survey|Act|Tools)$/).textContent)).toEqual(["Survey", "Act", "Tools"]);
    expect(within(groups[0]).getAllByRole("link").map((a) => a.textContent)).toEqual(["Overview", "Technicals", "Regime", "Macro & Correlations", "Sectors"]);
    expect(within(groups[1]).getAllByRole("link").map((a) => a.textContent)).toEqual(["Event Study", "Signal Ledger", "Position Monitor"]);
    expect(within(groups[2]).getAllByRole("link").map((a) => a.textContent)).toEqual(["Basket & Hedge", "Data Pipeline", "Build Notes"]);
    expect(DESK_GROUPS.flatMap((g) => g.pages)).toHaveLength(11);
    expect(within(side).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    expect(within(side).getByRole("link", { name: /Macro Regime Radar/ })).toHaveAttribute("href", "/app/dashboard");
    // No tab strip anywhere: the only "Primary" navigation is the sidebar's.
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
  });

  it("old frame-1 and frame-2 slugs land on the tab that replaced them, query kept", async () => {
    renderDesk("/desk/today?view=client");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/overview?view=client"));
  });

  it("the walkthrough's short paths still open", async () => {
    renderDesk("/desk/internals?tour=2");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/technicals?tour=2"));
  });

  it("an unknown page lands on Overview", async () => {
    renderDesk("/desk/nope");
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/overview"));
  });

  it("the header: breadcrumb, the Desk / Client toggle in the URL, and the tab's one action", async () => {
    renderDesk("/desk/overview");
    const crumb = await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(crumb.textContent?.replace(/\s+/g, "")).toBe("Radar›Desk›Overview");
    const toggle = screen.getByTestId("dk-view-toggle");
    expect(within(toggle).getByRole("button", { name: "Desk" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(toggle).getByRole("button", { name: "Client" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/overview?view=client"));
    // Every sidebar link now carries the client view.
    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("link", { name: "Regime" })).toHaveAttribute("href", "/desk/regime?view=client");
  });

  it("Walkthrough opens step 1 on its real route", async () => {
    renderDesk("/desk/overview");
    fireEvent.click(await screen.findByTestId("dk-walkthrough"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?preset=gold-2sigma-spx-weak&tour=1"));
    expect(await screen.findByTestId("desk-tour")).toHaveTextContent("Step 1 of 6");
  });

  it("each tab's header carries its own action, and Position Monitor has no toggle", async () => {
    const { unmount } = renderDesk("/desk/technicals");
    expect(await screen.findByTestId("dk-act")).toHaveTextContent("Act on this → Position Monitor");
    unmount();
    renderDesk("/desk/position-monitor");
    await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(screen.queryByTestId("dk-view-toggle")).toBeNull();
    expect(screen.queryByTestId("dk-act")).toBeNull();
  });

  it("the TODAY card reads the regime and the data word from /overview and the S&P's day from /technicals", async () => {
    renderDesk("/desk/overview");
    const today = await screen.findByTestId("dk-today");
    await waitFor(() => expect(today).toHaveTextContent("Overheating"));
    // §1.1: "Overheating · Jul row", the K−2 row governing today.
    expect(today).toHaveTextContent("regime · Jul row");
    // The fixture's session is Sep 22; "today" only when that is New York's today.
    expect(today).toHaveTextContent(/S&P (today|Sep 22)\s*\+0\.4%/);
    expect(today).toHaveTextContent(/Data\s*current/);
  });

  it("the S&P's day reads 'today' only on the served session's own day", () => {
    expect(spxDayLabel("2026-09-22", "2026-09-22")).toBe("S&P today");
    expect(spxDayLabel("2026-09-18", "2026-09-20")).toBe("S&P Sep 18");
  });

  it("HOUSE DISCIPLINE opens the gate text; Escape closes it", async () => {
    renderDesk("/desk/overview");
    const house = await screen.findByTestId("dk-house");
    expect(house).toHaveTextContent(/Gate\s*on/);
    fireEvent.click(house);
    const dialog = screen.getByRole("dialog", { name: "The discipline gate" });
    expect(within(dialog).getAllByRole("listitem").map((li) => li.textContent?.split(".")[0])).toEqual(["Variant view", "Pre-mortem", "Wrong if"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("with no /overview the TODAY card says so and prints no regime", async () => {
    stubDesk({ "/api/desk/overview": deskError(503, "generation warming") });
    renderDesk("/desk/overview");
    const today = await screen.findByTestId("dk-today");
    await waitFor(() => expect(today).toHaveTextContent("Regime awaiting refresh"));
    expect(today).not.toHaveTextContent("Overheating");
  });
});
