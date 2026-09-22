/**
 * Watchlist sidebar block (spec §3.1, checklist F, watchlist.html).
 *
 * Head with the "+" (AddSymbolPopover), rows as a list (symbol, last, day
 * change, 5D sparkline or an EOD / 15M tag), the empty state with
 * "Restore defaults", the "Saved in this browser" note and the Undo toast.
 * Rows are keyboard-complete: Enter opens the symbol's single-name research
 * on Markets, Delete / Backspace remove, Alt+ArrowUp / Alt+ArrowDown reorder
 * (announced through a polite live region); the pointer gets the hover
 * handle (HTML5 drag) and the × button.
 *
 * `compact` is the mobile-disclosure variant (MobileNav): the popover is
 * inline and every row control is visible, since touch has no hover.
 * The container id is `sidebar-watchlist`; `watchlist` belongs to the
 * Markets tape.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { Sparkline } from "../../../components";
import AddSymbolPopover from "./AddSymbolPopover";
import UndoToast, { type ToastState } from "./UndoToast";
import { useWatchlist } from "./useWatchlist";
import { useWatchlistQuote, type QuoteTone } from "./useWatchlistQuote";
import "./watchlist.css";

interface Props {
  compact?: boolean;
}

type PendingFocus = { kind: "row"; symbol: string } | { kind: "add" } | null;

const TONE_COLOR: Record<QuoteTone, string> = {
  pos: "var(--pos)",
  neg: "var(--neg)",
  flat: "var(--text-3)",
};

/* The two icons the mockup draws (watchlist.html state 2). */
function DragHandleIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
      <circle cx="2.5" cy="2.5" r="1.3" />
      <circle cx="7.5" cy="2.5" r="1.3" />
      <circle cx="2.5" cy="7" r="1.3" />
      <circle cx="7.5" cy="7" r="1.3" />
      <circle cx="2.5" cy="11.5" r="1.3" />
      <circle cx="7.5" cy="11.5" r="1.3" />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

interface RowProps {
  symbol: string;
  compact: boolean;
  dragging: string | null;
  over: boolean;
  register: (symbol: string, el: HTMLDivElement | null) => void;
  onOpen: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onMove: (symbol: string, dir: -1 | 1) => void;
  onDragStart: (symbol: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver: (symbol: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: (symbol: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
}

function WatchlistRow({ symbol, compact, dragging, over, register, onOpen, onRemove, onMove, onDragStart, onDragOver, onDrop, onDragEnd }: RowProps) {
  const q = useWatchlistQuote(symbol);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  // Pointer or keyboard attention reveals the handle and the × (mockup
  // state 2); compact rows keep both visible since touch has no hover.
  const attention = hover || focus;
  const active = compact || attention;

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove(symbol);
    } else if (e.altKey && e.key === "ArrowUp") {
      e.preventDefault();
      onMove(symbol, -1);
    } else if (e.altKey && e.key === "ArrowDown") {
      e.preventDefault();
      onMove(symbol, 1);
    } else if (e.key === "Enter" && e.target === e.currentTarget) {
      e.preventDefault();
      onOpen(symbol);
    }
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t.closest("button, .mrr-wl-handle")) return;
    onOpen(symbol);
  };

  const removeButton = (
    <button
      type="button"
      className="mrr-wl-x"
      aria-label={`Remove ${symbol} from watchlist`}
      onClick={(e) => {
        e.stopPropagation();
        onRemove(symbol);
      }}
    >
      <RemoveIcon />
    </button>
  );

  const priceCell =
    q.tag != null ? (
      <span className="mrr-wl-tag" title={q.tag === "EOD" ? "End-of-day close (not on the live stream)" : "Delayed quote"}>
        {q.tag}
      </span>
    ) : q.spark ? (
      <Sparkline values={q.spark} width={36} height={18} fill={false} color={TONE_COLOR[q.tone]} />
    ) : null;

  return (
    <div
      ref={(el) => register(symbol, el)}
      role="listitem"
      tabIndex={0}
      className="mrr-wl-row"
      data-symbol={symbol}
      data-tone={q.tone}
      data-active={attention ? "true" : undefined}
      data-dragging={dragging === symbol ? "true" : undefined}
      data-over={over ? "true" : undefined}
      title={q.error ? `No price data for ${symbol}` : undefined}
      draggable
      onDragStart={(e) => onDragStart(symbol, e)}
      onDragOver={(e) => onDragOver(symbol, e)}
      onDrop={(e) => onDrop(symbol, e)}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
      onKeyDown={onKeyDown}
      onClick={onClick}
    >
      {/* The spaces between cells are text nodes a grid ignores; they keep
          the row's textContent readable ("SPY 102.50 +2.5% EOD"). */}
      {active ? (
        <span className="mrr-wl-handle" aria-hidden="true">
          <DragHandleIcon />
        </span>
      ) : null}
      <b>{symbol}</b> <span className="p">{q.priceText}</span> <span className="c">{q.changeText}</span>{" "}
      {compact ? (
        <>
          <span className="s">{priceCell}</span> {removeButton}
        </>
      ) : active ? (
        removeButton
      ) : (
        <span className="s">{priceCell}</span>
      )}
    </div>
  );
}

export default function Watchlist({ compact = false }: Props) {
  const wl = useWatchlist();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<ToastState | null>(null);
  const [removals, setRemovals] = useState(0);
  const [announce, setAnnounce] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef<PendingFocus>(null);
  const toastKey = useRef(0);
  const popoverId = useId();

  const register = useCallback((symbol: string, el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(symbol, el);
    else rowRefs.current.delete(symbol);
  }, []);

  // Focus requests are fulfilled after the commit that renders their target.
  useEffect(() => {
    const p = pendingFocus.current;
    if (!p) return;
    pendingFocus.current = null;
    if (p.kind === "add") addRef.current?.focus();
    else rowRefs.current.get(p.symbol)?.focus();
  });

  const openPopover = useCallback(() => setOpen(true), []);
  const closePopover = useCallback(() => {
    setOpen(false);
    pendingFocus.current = { kind: "add" };
  }, []);

  const onAdded = useCallback((symbol: string) => {
    setOpen(false);
    pendingFocus.current = { kind: "row", symbol };
  }, []);

  const go = useCallback(
    (symbol: string) => {
      navigate(`/app/markets?name=${encodeURIComponent(symbol)}#single-name-research`);
    },
    [navigate],
  );

  const handleRemove = useCallback(
    (symbol: string) => {
      const list = wl.symbols;
      const idx = list.indexOf(symbol);
      if (idx < 0) return;
      const next = list[idx + 1] ?? (idx > 0 ? list[idx - 1] : null) ?? null;
      if (!wl.remove(symbol)) return;
      setNotice(null);
      setRemovals((n) => n + 1);
      pendingFocus.current = next ? { kind: "row", symbol: next } : { kind: "add" };
    },
    [wl],
  );

  const handleUndo = useCallback(() => {
    const symbol = wl.pendingUndo?.entry.symbol ?? null;
    const status = wl.undo();
    if (status === "restored" && symbol) pendingFocus.current = { kind: "row", symbol };
    else if (status === "full") setNotice({ key: ++toastKey.current, message: "List is full" });
  }, [wl]);

  const dismissToast = useCallback(() => {
    setNotice(null);
    wl.dismissUndo();
  }, [wl]);

  const handleMove = useCallback(
    (symbol: string, dir: -1 | 1) => {
      const to = wl.move(symbol, dir);
      if (to == null) return;
      pendingFocus.current = { kind: "row", symbol };
      setAnnounce(`${symbol} moved to position ${to + 1}`);
    },
    [wl],
  );

  // HTML5 drag reorder (pointer). The keyboard path is Alt+Arrow above.
  const onDragStart = useCallback((symbol: string, e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", symbol);
    e.dataTransfer.effectAllowed = "move";
    setDragging(symbol);
  }, []);
  const onDragOver = useCallback(
    (symbol: string, e: React.DragEvent<HTMLDivElement>) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      if (over !== symbol) setOver(symbol);
    },
    [dragging, over],
  );
  const onDrop = useCallback(
    (symbol: string, e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const from = dragging ?? e.dataTransfer.getData("text/plain");
      setDragging(null);
      setOver(null);
      if (!from || from === symbol) return;
      const to = wl.symbols.indexOf(symbol);
      if (to < 0) return;
      const moved = wl.moveTo(from, to);
      if (moved != null) {
        pendingFocus.current = { kind: "row", symbol: from };
        setAnnounce(`${from} moved to position ${moved + 1}`);
      }
    },
    [dragging, wl],
  );
  const onDragEnd = useCallback(() => {
    setDragging(null);
    setOver(null);
  }, []);

  const undoToast: ToastState | null = wl.pendingUndo
    ? { key: removals, message: `Removed ${wl.pendingUndo.entry.symbol}`, onUndo: handleUndo }
    : null;
  const toast = notice ?? undoToast;
  const empty = wl.entries.length === 0;

  return (
    <div id="sidebar-watchlist" ref={rootRef} className="mrr-wl" data-compact={compact ? "true" : undefined} data-toast={toast ? "true" : undefined}>
      <div className="mrr-wl-head">
        <span>
          <span aria-hidden="true">· </span>Watchlist
        </span>
        <button
          ref={addRef}
          type="button"
          aria-label="Add to watchlist"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popoverId : undefined}
          aria-disabled={wl.full ? "true" : undefined}
          onClick={() => (open ? closePopover() : openPopover())}
        >
          +
        </button>
      </div>

      {open ? (
        <AddSymbolPopover
          id={popoverId}
          symbols={wl.symbols}
          full={wl.full}
          onAdd={wl.add}
          onAdded={onAdded}
          onClose={closePopover}
          anchorRef={rootRef}
          ignoreRef={addRef}
          inline={compact}
        />
      ) : null}

      {empty ? (
        <div className="mrr-wl-empty">
          <p className="mrr-wl-empty-title">Your watchlist is empty</p>
          <p className="mrr-wl-empty-cap">Add symbols to track them here on every visit.</p>
          <button type="button" className="mrr-wl-ghost" onClick={openPopover}>
            + Add a symbol
          </button>
          <button type="button" className="mrr-wl-link" onClick={wl.restoreDefaults}>
            Restore defaults
          </button>
        </div>
      ) : (
        <div role="list" aria-label="Watchlist" className="mrr-wl-rows">
          {wl.symbols.map((symbol) => (
            <WatchlistRow
              key={symbol}
              symbol={symbol}
              compact={compact}
              dragging={dragging}
              over={over === symbol && dragging !== symbol}
              register={register}
              onOpen={go}
              onRemove={handleRemove}
              onMove={handleMove}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}

      <div className="mrr-wl-sr" aria-live="polite">
        {announce}
      </div>

      <p className="mrr-wl-note" data-unsaved={wl.unsaved ? "true" : undefined}>
        {wl.unsaved ? "Won't be saved in this browser." : "Saved in this browser"}
      </p>

      <UndoToast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
