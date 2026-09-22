import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";
import CommandPalette from "./CommandPalette";

function Probe() {
  const loc = useLocation();
  return <div data-testid="loc">{loc.pathname}{loc.hash}</div>;
}

function Harness({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="shell-content">
      <button type="button" onClick={() => { onNavigate("trigger-click"); setOpen(true); }} data-testid="trigger">
        ⌘K
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
      <Probe />
    </div>
  );
}

describe("CommandPalette", () => {
  it("Enter navigates exactly once, closes the palette, and restores focus without re-triggering", async () => {
    const spy = vi.fn();
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/app/:tab" element={<Harness onNavigate={spy} />} />
        </Routes>
      </MemoryRouter>,
    );
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    expect(spy).toHaveBeenCalledTimes(1); // the opening click
    const input = await screen.findByLabelText("Filter destinations");
    fireEvent.change(input, { target: { value: "credit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" }); // a repeated key must not navigate twice
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/app/credit"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(spy).toHaveBeenCalledTimes(1); // focus restore never clicked the trigger
  });

  it("Escape closes, arrows move, filter narrows", async () => {
    render(
      <MemoryRouter initialEntries={["/app/dashboard"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/app/:tab" element={<Harness onNavigate={() => {}} />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByTestId("trigger"));
    const input = await screen.findByLabelText("Filter destinations");
    fireEvent.change(input, { target: { value: "news" } });
    const options = screen.getAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((o) => /news|calendar|headline|event/i.test(o.textContent ?? ""))).toBe(true);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]?.getAttribute("aria-selected")).toBe(options.length > 1 ? "true" : null);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
