/**
 * "+" popover (checklist F.4, watchlist.html state 3): SymbolSearch in
 * compact mode over the same /api/market/search the Markets tab uses.
 * ↑/↓ select, ↵ adds, Esc on an empty box closes, outside click closes,
 * Tab past the last control closes and hands focus back to "+".
 *
 * Desktop: rendered through a body portal at the block's own coordinates
 * (left + 8, top + 48, the mockup's offsets). An absolutely positioned box
 * inside the sidebar would be clipped by the aside's overflow and painted
 * under any positioned element in the main column (a sticky aside is its own
 * stacking context), so the portal is what keeps the mockup's geometry.
 * Compact (mobile disclosure): inline below the head at full width.
 *
 * At 12 of 12 the search is replaced by one sentence; the footer keeps the
 * slot count.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type React from "react";
import { createPortal } from "react-dom";
import SymbolSearch from "../../markets/SymbolSearch";
import type { SearchHit } from "../../../api/types";
import { MAX_SYMBOLS, normalizeSymbol, type AddStatus } from "./storage";

export const FULL_SENTENCE = `Your watchlist is full (${MAX_SYMBOLS} of ${MAX_SYMBOLS}). Remove a symbol to add another.`;

interface Props {
  id: string;
  symbols: string[];
  full: boolean;
  onAdd: (symbol: string) => AddStatus;
  /** A symbol was added: the caller closes the popover and focuses the row. */
  onAdded: (symbol: string) => void;
  /** Esc, outside click, Tab out: the caller closes and refocuses "+". */
  onClose: () => void;
  /** The watchlist block; the floating box sits at its top-left. */
  anchorRef: RefObject<HTMLElement>;
  /** The "+" button; clicks on it are the caller's toggle, not "outside". */
  ignoreRef: RefObject<HTMLElement>;
  inline: boolean;
}

const POPOVER_W = 268;
const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AddSymbolPopover({ id, symbols, full, onAdd, onAdded, onClose, anchorRef, ignoreRef, inline }: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 48, left: 8 });
  const [note, setNote] = useState<string | null>(null);
  const sentenceId = useId();

  const listed = useCallback((symbol: string) => symbols.includes(normalizeSymbol(symbol)), [symbols]);

  // Floating geometry: the mockup's absolute offsets, measured from the block.
  const place = useCallback(() => {
    if (inline) return;
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = window.innerWidth || 0;
    const vh = window.innerHeight || 0;
    let left = rect.left + 8;
    let top = rect.top + 48;
    if (vw > 0) left = Math.max(8, Math.min(left, vw - POPOVER_W - 8));
    const h = popRef.current?.offsetHeight ?? 0;
    if (vh > 0 && h > 0) top = Math.max(8, Math.min(top, vh - h - 8));
    setPos((p) => (p.top === top && p.left === left ? p : { top, left }));
  }, [anchorRef, inline]);

  useLayoutEffect(() => {
    place();
  });

  useEffect(() => {
    if (inline) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [inline, place]);

  // Outside click, and focus leaving for anywhere but the "+" button.
  useEffect(() => {
    const inside = (t: EventTarget | null) => {
      const node = t instanceof Node ? t : null;
      if (!node) return false;
      return Boolean(popRef.current?.contains(node) || ignoreRef.current?.contains(node));
    };
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target)) onClose();
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [ignoreRef, onClose]);

  // The full-state box has no field: focus the dialog so Esc works and the
  // sentence is read.
  useEffect(() => {
    if (full) popRef.current?.focus();
  }, [full]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.key === "Escape") {
      // The combobox owns Escape while it has text (it clears the box first).
      if (target.getAttribute("role") === "combobox") return;
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Tab" && popRef.current) {
      const items = Array.from(popRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = items[0];
      const last = items[items.length - 1];
      if (!items.length || (!e.shiftKey && target === last) || (e.shiftKey && target === first)) {
        e.preventDefault();
        onClose();
      }
    }
  };

  const select = (hit: SearchHit) => {
    const sym = normalizeSymbol(hit.symbol);
    const status = onAdd(sym);
    if (status === "added") {
      setNote(null);
      onAdded(sym);
    } else if (status === "invalid") {
      setNote(`${hit.symbol} is not a symbol this watchlist can store.`);
    } else if (status === "full") {
      setNote(FULL_SENTENCE);
    } else {
      setNote(null); // duplicate: nothing to do, no toast
    }
  };

  const body = (
    <div
      ref={popRef}
      id={id}
      role="dialog"
      aria-label="Add to watchlist"
      aria-describedby={full ? sentenceId : undefined}
      tabIndex={-1}
      className="mrr-popover"
      data-floating={inline ? undefined : "true"}
      data-inline={inline ? "true" : undefined}
      style={inline ? undefined : { top: pos.top, left: pos.left }}
      onKeyDown={onKeyDown}
    >
      {full ? (
        <p id={sentenceId} className="mrr-popover-full">
          {FULL_SENTENCE}
        </p>
      ) : (
        <>
          <SymbolSearch
            compact
            autoFocus
            placeholder="Search any listed symbol…"
            rowAction={(hit) =>
              listed(hit.symbol) ? <span style={{ color: "var(--text-3)" }}>✓ Listed</span> : <span style={{ color: "var(--mint)" }}>+ Add</span>
            }
            onSelect={select}
            onDismiss={onClose}
          />
          {note ? (
            <p className="mrr-popover-full" role="alert">
              {note}
            </p>
          ) : null}
        </>
      )}
      <div className="mrr-popover-foot">
        <span>
          {symbols.length} of {MAX_SYMBOLS} slots used
        </span>
        {full ? null : <span aria-hidden="true">↑↓ select · ↵ add</span>}
      </div>
    </div>
  );

  if (inline || typeof document === "undefined") return body;
  return createPortal(body, document.body);
}
