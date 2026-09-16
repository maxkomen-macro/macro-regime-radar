/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section E,
 * `screens/shared/SubTabs.test.tsx` (append only): the two original cases
 * below stay verbatim (they pin the tab text, arrow keys, the wrap tier and
 * the dropped hints); the "boxed tabs" describe at the end covers the B.7
 * restyle (block uppercase mono hint, mint when selected, bordered tablist).
 */
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

// Appended for Phase 2 (checklist 02 B.7 / section E): the boxed-tab restyle.
// jsdom keeps `var()` values literally on longhand `element.style.*` reads;
// the border shorthand is read from the style attribute text.
const css = (el: Element | null) => el?.getAttribute("style") ?? "";

describe("SubTabs boxed tabs (checklist 02 B.7)", () => {
  it("renders the hint as a block small in uppercase mono and colours the selected hint mint", () => {
    mockViewport("wide");
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    // Load-bearing: textContent is still label + hint with no separator.
    expect(tabs[0].textContent).toBe("Overviewlive model");
    const selectedHint = tabs[0].querySelector("small") as HTMLElement;
    const otherHint = tabs[1].querySelector("small") as HTMLElement;
    expect(selectedHint).not.toBeNull();
    expect(selectedHint.textContent).toBe("live model");
    expect(selectedHint.style.display).toBe("block");
    expect(selectedHint.style.textTransform).toBe("uppercase");
    expect(css(selectedHint)).toMatch(/var\(--font-mono\)/);
    expect(selectedHint.style.color).toBe("var(--mint)");
    // Unselected hint words lifted to --text-3 (Phase 10, G18).
    expect(otherHint.style.color).toBe("var(--text-3)");
    // The label is a block <b> in the UI face (set on the <b> or inherited from
    // the tab button); selected reads white, unselected --text-2 (a var()
    // fallback chain for the hover rule is fine).
    const selectedLabel = tabs[0].querySelector("b") as HTMLElement;
    expect(selectedLabel.textContent).toBe("Overview");
    expect(selectedLabel.style.display).toBe("block");
    expect(selectedLabel.style.fontFamily || tabs[0].style.fontFamily).toMatch(/var\(--font-ui\)/);
    expect(css(selectedLabel)).toMatch(/font(?:-size)?:[^;]*\b14px\b/);
    expect(css(selectedLabel)).toMatch(/color:\s*(?:#fff|rgb\(255, ?255, ?255\))/);
    expect((tabs[1].querySelector("b") as HTMLElement).style.color).toMatch(/var\(--text-2\)/);
    // Selecting another tab moves the mint hint with the selection.
    fireEvent.click(tabs[1]);
    expect((screen.getAllByRole("tab")[1].querySelector("small") as HTMLElement).style.color).toBe("var(--mint)");
    expect((screen.getAllByRole("tab")[0].querySelector("small") as HTMLElement).style.color).toBe("var(--text-3)");
  });

  it("wraps the tablist in a bordered box", () => {
    mockViewport("wide");
    render(<Harness />);
    const list = screen.getByRole("tablist");
    expect(list.style.borderRadius).toBe("var(--r-card)");
    expect(css(list)).toMatch(/border(?:-color)?:[^;]*var\(--line\)/);
    expect(css(list)).toMatch(/border(?:-width)?:\s*1px/);
    expect(list.style.background).toBe("var(--panel)");
    expect(list.style.padding).toBe("6px");
    expect(list.style.gap).toBe("6px");
    // Tabs are boxed too: rounded control corners, no underline, no negative margin.
    const [selected, other] = screen.getAllByRole("tab");
    expect(selected.style.borderRadius).toBe("var(--r-ctl)");
    expect(css(selected)).toMatch(/border(?:-color)?:[^;]*var\(--line-white-14\)/);
    expect(css(selected)).toMatch(/linear-gradient\(180deg, ?rgba\(255, ?255, ?255, ?0?\.07\), ?rgba\(255, ?255, ?255, ?0?\.025\)\)/);
    expect(css(selected)).not.toMatch(/border-bottom:\s*2px/);
    expect(selected.style.marginBottom).not.toBe("-1px");
    expect(css(other)).toMatch(/border(?:-color)?:[^;]*transparent/);
    expect(css(other)).not.toMatch(/linear-gradient/);
    // The wrap tier keeps the inline flexWrap / overflowX the first two cases read.
    mockViewport("desktop");
    const wrapped = render(<Harness />).container;
    const wrappedList = wrapped.querySelector("[role='tablist']") as HTMLElement;
    expect(wrappedList.style.flexWrap).toBe("wrap");
    expect(wrappedList.style.borderRadius).toBe("var(--r-card)");
    mockViewport("wide");
  });
});

// Appended for Phase 10 (checklist 10 A8 / E.1): the accessible name carries the
// hint ("Playbook, reference"); the visible textContent is unchanged (E.2).
describe("SubTabs accessible names (checklist 10 A8)", () => {
  it("each tab is named label, hint while its textContent stays label + hint with no separator", () => {
    mockViewport("wide");
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual([
      "Overview, live model",
      "Playbook, reference",
      "Scenarios, stress rule",
      "History & analogues, stored + reference",
      "Empirical evidence, backtests",
    ]);
    // Load-bearing (E.2): textContent is still label + hint, no separator, existing case.
    expect(tabs[0].textContent).toBe("Overviewlive model");
    expect(tabs[1].textContent).toBe("Playbookreference");
    // The role query now matches the full name (G10: a regex form for the label alone).
    expect(screen.getByRole("tab", { name: "Playbook, reference" })).toBe(tabs[1]);
    expect(screen.getByRole("tab", { name: /^Playbook\b/ })).toBe(tabs[1]);
  });

  it("a tab without a hint is named by its label alone; the wrap tier drops the hint from the text, not from the name", () => {
    mockViewport("desktop");
    render(
      <SubTabs tabs={[{ id: "a", label: "Only label" }, { id: "b", label: "With hint", hint: "meta" }]} active="a" onChange={() => {}} label="Views">
        <div>panel</div>
      </SubTabs>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-label")).toBe("Only label");
    expect(tabs[0].textContent).toBe("Only label");
    expect(tabs[1].getAttribute("aria-label")).toBe("With hint, meta");
    expect(tabs[1].textContent).toBe("With hint");
    mockViewport("wide");
  });
});
