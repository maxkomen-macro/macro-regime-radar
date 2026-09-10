import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import SubTabs from "./SubTabs";

// The breakpoint hook memoizes matchMedia lists per module; drive it directly.
const bpState = { bp: "wide", isMobile: false, isTablet: false, isNarrow: false };
vi.mock("../../lib/useBreakpoint", () => ({ useBreakpoint: () => bpState }));

const TABS = [
  { id: "overview", label: "Overview", hint: "live model" },
  { id: "playbook", label: "Playbook", hint: "reference" },
  { id: "scenarios", label: "Scenarios", hint: "stress rule" },
  { id: "history", label: "History & analogues", hint: "stored + reference" },
  { id: "evidence", label: "Empirical evidence", hint: "backtests" },
];

function Harness() {
  const [active, setActive] = useState("overview");
  return (
    <SubTabs tabs={TABS} active={active} onChange={setActive} label="Regime Lab views">
      <div>panel {active}</div>
    </SubTabs>
  );
}

function mockViewport(bp: "mobile" | "tablet" | "desktop" | "wide") {
  bpState.bp = bp;
  bpState.isMobile = bp === "mobile";
  bpState.isTablet = bp === "tablet";
  bpState.isNarrow = bp === "mobile" || bp === "tablet";
}

describe("SubTabs", () => {
  it("renders every view as a tab with tab semantics and moves with arrow keys", () => {
    mockViewport("wide");
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(expect.arrayContaining(["OverviewLive Model".replace("Live Model", "live model"), expect.stringContaining("Empirical evidence")]));
    expect(tabs).toHaveLength(5);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(tabs[0], { key: "End" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Empirical evidence");
    expect(screen.getByRole("tabpanel").textContent).toBe("panel evidence");
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { selected: true }).textContent).toContain("Overview");
  });

  it("wraps the row below the wide tier so the last view is never clipped", () => {
    mockViewport("desktop");
    render(<Harness />);
    const list = screen.getByRole("tablist");
    expect(list.style.flexWrap).toBe("wrap");
    expect(list.style.overflowX).toBe("visible");
    // Hints are dropped when wrapping so labels stay short.
    expect(screen.getByRole("tab", { name: /Empirical evidence/ }).textContent).toBe("Empirical evidence");
  });
});
