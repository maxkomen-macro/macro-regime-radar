import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Jargon from "./Jargon";

describe("Jargon tooltip (WCAG 1.4.13)", () => {
  it("opens on focus, is referenced by aria-describedby, and Escape dismisses it without moving focus", () => {
    render(
      <p>
        The <Jargon term="OAS">OAS</Jargon> widened.
      </p>,
    );
    const trigger = screen.getByRole("button", { name: "OAS" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(trigger);
    const tip = screen.getByRole("tooltip");
    expect(tip).toBeVisible();
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("stays open while the pointer rests on the tooltip, and a click pins it", () => {
    render(<Jargon term="OAS">OAS</Jargon>);
    const trigger = screen.getByRole("button", { name: "OAS" });
    const wrap = trigger.parentElement as HTMLElement;
    fireEvent.mouseEnter(wrap);
    const tip = screen.getByRole("tooltip");
    fireEvent.mouseLeave(wrap);
    fireEvent.mouseEnter(tip); // hoverable: moving onto the tooltip cancels the close
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.click(trigger); // pinned
    fireEvent.mouseLeave(tip);
    expect(screen.getByRole("tooltip")).toBeVisible();
    fireEvent.click(trigger); // unpin closes
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  // Phase 6 (checklist 06 C.5 / E.1): the decision-3 glossary entry.
  it("term=\"Tight\" renders the decision-3 sentence in the tooltip on focus, and Escape dismisses it without moving focus", () => {
    render(
      <p>
        The ladder's <Jargon term="Tight">Tight</Jargon> rung.
      </p>,
    );
    const trigger = screen.getByRole("button", { name: "Tight" });
    expect(trigger).toHaveClass("jargon");
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.focus(trigger);
    const tip = screen.getByRole("tooltip");
    expect(tip).toBeVisible();
    expect((tip.textContent ?? "").startsWith("IG spreads above 150 bps: financing strain")).toBe(true);
    expect(tip.textContent).not.toContain("—");
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
    trigger.focus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Codex round 1: definitions that match the calculation", () => {
  const tipFor = (term: string): string => {
    const { unmount } = render(<Jargon term={term}>{term}</Jargon>);
    fireEvent.focus(screen.getByRole("button", { name: term }));
    const text = screen.getByRole("tooltip").textContent ?? "";
    unmount();
    return text;
  };
  it("R-15: the z-score is measured against a reading's own history, not its full history (the surprises use a rolling window)", () => {
    expect(tipFor("z-score")).toBe("How unusual a reading is versus its own history, in standard deviations. ±2 is notable, ±3 is rare.");
  });
  it("R-20: the regime's slopes run over the last three monthly readings", () => {
    const t = tipFor("regime");
    expect(t).toContain("rose over the last three monthly readings");
    expect(t).not.toContain("three months");
  });
  it("R-18: the regime matrix is hand-set priors; the counted definition stays for credit states", () => {
    expect(tipFor("regime transition matrix")).toContain("hand-set priors typed into the code, not counted from the stored history");
    expect(tipFor("transition matrix")).toContain("counted from the stored monthly history");
  });
});
