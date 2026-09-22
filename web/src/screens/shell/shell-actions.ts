/**
 * Shell actions seam (redesign Phase 3, checklist 03 A.12): screens open the
 * overlays the shell owns (alert drawer, freshness drawer, palette, assistant)
 * without prop drilling. The default value is a set of no-ops so a screen
 * renders outside the provider (tests, /kit) without throwing.
 */
import { createContext, useContext } from "react";

export interface ShellActions {
  openAlerts: () => void;
  openFreshness: () => void;
  openPalette: () => void;
  openAssistant: () => void;
}

const noop = () => {};

export const NO_SHELL_ACTIONS: ShellActions = Object.freeze({
  openAlerts: noop,
  openFreshness: noop,
  openPalette: noop,
  openAssistant: noop,
});

export const ShellActionsContext = createContext<ShellActions>(NO_SHELL_ACTIONS);

/** The shell's overlay openers; no-ops when no provider is mounted. */
export function useShellActions(): ShellActions {
  return useContext(ShellActionsContext);
}
