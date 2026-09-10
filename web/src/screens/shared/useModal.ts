/**
 * useModal — the accessibility contract every modal overlay in the shell
 * shares (alert drawer, command palette): initial focus, Tab/Shift+Tab
 * containment, Escape to close, `inert` on the page behind, and focus
 * restoration to the element that opened it (2026-09-05).
 *
 * `inert` is set imperatively on the shell content wrapper (#shell-content)
 * rather than through a React prop: React 18 does not forward the boolean
 * attribute reliably, and a reference count lets two overlays overlap
 * without the first one un-inerting the page when it closes.
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export const SHELL_CONTENT_ID = "shell-content";

let inertCount = 0;

function setInert(on: boolean) {
  const el = document.getElementById(SHELL_CONTENT_ID);
  if (!el) return;
  inertCount = Math.max(0, inertCount + (on ? 1 : -1));
  if (inertCount > 0) el.setAttribute("inert", "");
  else el.removeAttribute("inert");
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

interface Options {
  onClose: () => void;
  /** Element to focus on open; defaults to the first focusable in the panel. */
  initialFocus?: RefObject<HTMLElement>;
}

export function useModal(open: boolean, panelRef: RefObject<HTMLElement>, { onClose, initialFocus }: Options) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    setInert(true);

    // Focus after paint so the panel's children exist.
    const raf = requestAnimationFrame(() => {
      const target = initialFocus?.current ?? (panelRef.current ? focusables(panelRef.current)[0] : null);
      (target ?? panelRef.current)?.focus?.();
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = focusables(panelRef.current);
      if (!items.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = active ? panelRef.current.contains(active) : false;
      if (e.shiftKey) {
        if (!inside || active === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (!inside || active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKey, true);
      setInert(false);
      // Restore focus to the trigger once the page is interactive again.
      if (opener && document.contains(opener)) opener.focus?.();
    };
  }, [open, panelRef, onClose, initialFocus]);
}
