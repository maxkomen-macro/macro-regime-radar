/**
 * Cmd+K palette, v1: tabs + sections only (locked IA). Type to filter,
 * ↑/↓ to move, Enter to jump, Esc to close.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PALETTE_ENTRIES, type PaletteEntry } from "./sections";
import { useModal } from "../shared/useModal";

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // One jump per open: Enter (or a click) navigates exactly once, then the
  // palette closes; a repeated key event during the close is ignored
  // (regression guard, 2026-09-06).
  const jumpedRef = useRef(false);
  const navigate = useNavigate();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE_ENTRIES;
    return PALETTE_ENTRIES.filter(
      (e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q),
    );
  }, [query]);

  // Focus trap, inert page, Escape, and focus return (2026-09-05).
  useModal(open, panelRef, { onClose, initialFocus: inputRef });

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    jumpedRef.current = false;
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // Keep the highlighted row in view while ↑/↓ move it.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`palette-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  const go = (e: PaletteEntry) => {
    if (jumpedRef.current) return;
    jumpedRef.current = true;
    // Close first, then navigate: the modal cleanup restores focus to the
    // trigger (a plain focus, never a click) and un-inerts the page before
    // the new screen mounts.
    onClose();
    navigate(`/app/${e.tabSlug}${e.sectionId ? `#${e.sectionId}` : ""}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      // Swallow the key so nothing behind the palette (the trigger that is
      // about to regain focus, a form) sees the same Enter.
      e.preventDefault();
      e.stopPropagation();
      if (matches[active]) go(matches[active]);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Jump to tab or section"
        aria-describedby="palette-help"
        tabIndex={-1}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to tab or section…"
          aria-label="Filter destinations"
          spellCheck={false}
          /* Focus stays in the input while ↑/↓ move the highlight, so screen
             readers only learn the active row from aria-activedescendant.
             aria-controls makes that cross-subtree reference resolvable. */
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-autocomplete="list"
          aria-controls="palette-listbox"
          aria-activedescendant={matches[active] ? `palette-opt-${active}` : undefined}
        />
        <div
          id="palette-listbox"
          style={{ maxHeight: "46vh", overflowY: "auto", padding: "6px 0" }}
          role="listbox"
        >
          {matches.length === 0 ? null : (
            matches.map((m, i) => (
              <div
                key={`${m.tabSlug}-${m.sectionId ?? "tab"}`}
                id={`palette-opt-${i}`}
                className="palette-row"
                data-active={i === active}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(m)}
              >
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--fs-body)",
                    color: i === active ? "var(--text)" : "var(--text-2)",
                  }}
                >
                  {m.label}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--fs-micro)",
                    letterSpacing: "var(--ls-micro)",
                    textTransform: "uppercase",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.kind === "section" ? `${m.hint} §` : m.hint}
                </span>
              </div>
            ))
          )}
        </div>
        {matches.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            style={{ padding: "12px 14px", fontSize: "var(--fs-body-s)", color: "var(--text-muted)" }}
          >
            No tab or section matches “{query}”.
          </div>
        ) : null}
        <div
          id="palette-help"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
            letterSpacing: "var(--ls-micro)",
            color: "var(--text-muted)",
            padding: "6px 14px 8px",
            borderTop: "0.5px solid var(--line-hair)",
          }}
        >
          ↑↓ move · Enter jump · Esc close
        </div>
      </div>
    </>
  );
}
