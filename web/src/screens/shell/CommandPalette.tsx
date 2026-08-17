/**
 * Cmd+K palette, v1: tabs + sections only (locked IA). Type to filter,
 * ↑/↓ to move, Enter to jump, Esc to close.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PALETTE_ENTRIES, type PaletteEntry } from "./sections";

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PALETTE_ENTRIES;
    return PALETTE_ENTRIES.filter(
      (e) => e.label.toLowerCase().includes(q) || e.hint.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
    // Escape closes even when focus has left the input.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.(); // return focus to whatever opened the palette
    };
  }, [open, onClose]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const go = (e: PaletteEntry) => {
    navigate(`/app/${e.tabSlug}${e.sectionId ? `#${e.sectionId}` : ""}`);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && matches[active]) {
      go(matches[active]);
    }
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-modal="true" aria-label="Jump to tab or section">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to tab or section —"
          aria-label="Filter destinations"
          spellCheck={false}
        />
        <div style={{ maxHeight: "46vh", overflowY: "auto", padding: "6px 0" }} role="listbox">
          {matches.length === 0 ? (
            <div
              style={{
                padding: "12px 14px",
                fontSize: "var(--fs-body-s)",
                color: "var(--text-muted)",
              }}
            >
              No tab or section matches “{query}”.
            </div>
          ) : (
            matches.map((m, i) => (
              <div
                key={`${m.tabSlug}-${m.sectionId ?? "tab"}`}
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
      </div>
    </>
  );
}
