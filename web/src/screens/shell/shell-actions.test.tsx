/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) A.12 and
 * E.1, `screens/shell/shell-actions.test.tsx`: the shell-actions seam. The
 * default context value is a frozen set of callable no-ops so a screen renders
 * outside the provider (tests, /kit); a consumer inside the provider receives
 * the shell's real openers (the Dashboard status strip opens the alert drawer
 * through `openAlerts`).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { NO_SHELL_ACTIONS, ShellActionsContext, useShellActions, type ShellActions } from "./shell-actions";

const KEYS: (keyof ShellActions)[] = ["openAlerts", "openFreshness", "openPalette", "openAssistant"];

/** One button per action, plus a probe that records the context value it saw. */
function Consumer({ onValue }: { onValue?: (v: ShellActions) => void }) {
  const actions = useShellActions();
  onValue?.(actions);
  return (
    <div>
      {KEYS.map((k) => (
        <button key={k} type="button" onClick={() => actions[k]()}>
          {k}
        </button>
      ))}
    </div>
  );
}

describe("shell-actions (checklist 03 A.12)", () => {
  it("default context values are callable no-ops", () => {
    expect(Object.keys(NO_SHELL_ACTIONS).sort()).toEqual([...KEYS].sort());
    expect(Object.isFrozen(NO_SHELL_ACTIONS)).toBe(true);
    for (const k of KEYS) {
      expect(typeof NO_SHELL_ACTIONS[k]).toBe("function");
      expect(NO_SHELL_ACTIONS[k]()).toBeUndefined();
    }

    // Without a provider the hook hands back the defaults and every click is harmless.
    let seen: ShellActions | undefined;
    render(<Consumer onValue={(v) => (seen = v)} />);
    expect(seen).toBe(NO_SHELL_ACTIONS);
    for (const k of KEYS) expect(() => fireEvent.click(screen.getByRole("button", { name: k }))).not.toThrow();
  });

  it("a consumer inside the provider receives the provided openAlerts", () => {
    const openAlerts = vi.fn();
    const openAssistant = vi.fn();
    let seen: ShellActions | undefined;
    render(
      <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, openAlerts, openAssistant }}>
        <Consumer onValue={(v) => (seen = v)} />
      </ShellActionsContext.Provider>,
    );
    expect(seen?.openAlerts).toBe(openAlerts);
    expect(seen?.openAssistant).toBe(openAssistant);
    // The openers the provider did not replace stay the defaults.
    expect(seen?.openFreshness).toBe(NO_SHELL_ACTIONS.openFreshness);
    expect(seen?.openPalette).toBe(NO_SHELL_ACTIONS.openPalette);

    fireEvent.click(screen.getByRole("button", { name: "openAlerts" }));
    expect(openAlerts).toHaveBeenCalledTimes(1);
    expect(openAssistant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "openFreshness" }));
    fireEvent.click(screen.getByRole("button", { name: "openPalette" }));
    expect(openAlerts).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "openAssistant" }));
    expect(openAssistant).toHaveBeenCalledTimes(1);
  });
});
