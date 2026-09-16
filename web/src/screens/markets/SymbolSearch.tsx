/**
 * Symbol search — the entry point to single-name research. A mono input over
 * /api/market/search (EODHD's search index first, yfinance as the disclosed
 * fallback; cached server-side), with a keyboard-navigable result list. Combobox semantics: ArrowUp/Down move, Enter picks,
 * Escape clears. No icons; the ▸ glyph marks the active row.
 *
 * `compact` (redesign Phase 1) is the watchlist popover's variant: a 36 px
 * field with an Esc hint, results in flow as grid rows with an optional
 * per-row action ("+ Add" / "✓ Listed"), and `onDismiss` for Escape on an
 * empty box. Every default is unchanged for the Markets search.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type React from "react";
import { useSymbolSearch } from "../../api/queries";
import type { SearchHit } from "../../api/types";
import { mono, useDebounced } from "../shared/screen-ui";

interface Props {
  onSelect: (hit: SearchHit) => void;
  placeholder?: string;
  /** 36 px field and popover row layout (watchlist add popover). */
  compact?: boolean;
  autoFocus?: boolean;
  /** Right-hand cell of every result row ("+ Add" / "✓ Listed"). */
  rowAction?: (hit: SearchHit) => ReactNode;
  /** Escape pressed while the box is already empty. */
  onDismiss?: () => void;
  /** Field disabled, no list (the watchlist is full). */
  disabled?: boolean;
}

const DEFAULT_PLACEHOLDER = "Search any ticker or company (e.g. NVDA, BRK.B, Nestlé)…";

/** "BRK.B" is how a desk writes a share class; the source indexes it as
 * "BRK-B". Both spellings are searched and the dashed form ranks first. */
function dashedAlias(q: string): string {
  const t = q.trim();
  return /^[A-Za-z]{1,5}\.[A-Za-z]{1,2}$/.test(t) ? t.replace(".", "-") : "";
}

/** Relevance for a research desk: listed equities and funds before option
 * chains, exact symbol matches first, then symbol prefixes, then names. */
function rankHits(hits: SearchHit[], q: string): SearchHit[] {
  const needle = q.trim().toUpperCase();
  const alias = dashedAlias(q).toUpperCase();
  const score = (h: SearchHit) => {
    const sym = (h.symbol ?? "").toUpperCase();
    const isOption = (h.type ?? "").toLowerCase() === "option" || /^[A-Z]{1,6}\d{6}[CP]\d{8}$/.test(sym);
    let sc = isOption ? 1000 : 0;
    if (sym === needle || (alias && sym === alias)) sc -= 500;
    else if (sym.startsWith(needle) || (alias && sym.startsWith(alias))) sc -= 300;
    else if ((h.name ?? "").toUpperCase().startsWith(needle)) sc -= 200;
    else if ((h.name ?? "").toUpperCase().includes(needle)) sc -= 100;
    sc += sym.length; // shorter tickers first among equals
    return sc;
  };
  const seen = new Set<string>();
  return [...hits]
    .filter((h) => {
      const k = (h.symbol ?? "").toUpperCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => score(a) - score(b));
}

export default function SymbolSearch({
  onSelect,
  placeholder = DEFAULT_PLACEHOLDER,
  compact = false,
  autoFocus = false,
  rowAction,
  onDismiss,
  disabled = false,
}: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(text, 250);
  const q = useSymbolSearch(debounced);
  const aliasQuery = dashedAlias(debounced);
  const alt = useSymbolSearch(aliasQuery);
  // A disabled alias query still carries its previous placeholder data; only
  // read it while an alias is actually being searched (regression 2026-09-06:
  // "ZZZQ" showed the earlier "BRK.B" alias hits).
  const altHits = aliasQuery ? (alt.data?.hits ?? []) : [];
  const hits = rankHits([...altHits, ...(q.data?.hits ?? [])], debounced);
  // The provider that answered is part of the result (2026-09-06).
  const provider = q.data?.provider ?? alt.data?.provider ?? null;
  const fallback = Boolean(q.data?.fallback_used || alt.data?.fallback_used);
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  // Hover moves the highlight only when the pointer actually moves: a list
  // that opens under a resting cursor must not steal the keyboard's row.
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  // Close on outside click.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => setActive(0), [debounced]);

  const pick = (hit: SearchHit) => {
    onSelect(hit);
    setText("");
    setOpen(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onDismiss && text.trim() === "") {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (!open || !hits.length) {
      if (e.key === "Escape") setText("");
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(hits[Math.min(active, hits.length - 1)]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setText("");
    }
  };

  const showList = open && !disabled && text.trim().length > 0;

  const fieldStyle: React.CSSProperties = compact
    ? {
        width: "100%",
        boxSizing: "border-box",
        background: "var(--field)",
        border: "1px solid rgba(255,255,255,.08)",
        borderRadius: "var(--r-nav)",
        padding: "0 44px 0 12px",
        height: 36,
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--fs-kv)",
      }
    : {
        width: "100%",
        boxSizing: "border-box",
        background: "var(--void)",
        border: "0.5px solid var(--line)",
        borderRadius: "var(--r-sm)",
        padding: "10px 14px",
        minHeight: 44,
        color: "var(--text)",
        ...mono,
        fontSize: "var(--fs-body)",
      };

  const listStyle: React.CSSProperties = compact
    ? { marginTop: 8, display: "grid", gap: 2, maxHeight: 320, overflowY: "auto" }
    : {
        position: "absolute",
        zIndex: 40,
        top: "calc(100% + 4px)",
        left: 0,
        right: 0,
        background: "var(--surface)",
        border: "0.5px solid var(--line)",
        borderRadius: "var(--r-sm)",
        maxHeight: 320,
        overflowY: "auto",
      };

  const rowStyle = (activeRow: boolean): React.CSSProperties =>
    compact
      ? {
          display: "grid",
          gridTemplateColumns: "48px minmax(0,1fr) auto",
          gap: 8,
          alignItems: "center",
          padding: "8px 10px",
          borderRadius: "var(--r-badge)",
          cursor: "pointer",
          background: activeRow ? "rgba(255,255,255,.06)" : "transparent",
        }
      : {
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          padding: "9px 12px",
          minHeight: 40,
          cursor: "pointer",
          background: activeRow ? "var(--surface-raised)" : "transparent",
        };

  const field = (
    <input
      role="combobox"
      aria-expanded={showList && hits.length > 0}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={showList && hits.length ? `${listId}-opt-${Math.min(active, hits.length - 1)}` : undefined}
      aria-label="Search any listed symbol"
      placeholder={placeholder}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        setOpen(true);
      }}
      onFocus={() => setOpen(true)}
      onKeyDown={onKey}
      spellCheck={false}
      autoComplete="off"
      autoFocus={autoFocus}
      disabled={disabled}
      style={fieldStyle}
    />
  );

  return (
    <div ref={boxRef} style={{ position: "relative", maxWidth: compact ? "none" : 640 }}>
      {compact ? (
        // The Esc hint sits inside the field at its right edge (mockup
        // `.search kbd{margin-left:auto}`); the wrapper is exactly the
        // field's box, so the in-flow result list below cannot pull it down.
        <div style={{ position: "relative" }}>
          {field}
          <kbd
            aria-hidden="true"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              lineHeight: 1.2,
              color: "var(--text-3)",
              border: "1px solid var(--line-white-14)",
              borderRadius: 5,
              padding: "2px 6px",
              pointerEvents: "none",
            }}
          >
            Esc
          </kbd>
        </div>
      ) : (
        field
      )}
      {showList && (
        <div id={listId} role="listbox" style={listStyle}>
          {hits.map((h, i) => (
            <div
              key={`${h.symbol}-${i}`}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseMove={(e) => {
                const m = lastMouse.current;
                if (!m || m.x !== e.clientX || m.y !== e.clientY) {
                  lastMouse.current = { x: e.clientX, y: e.clientY };
                  setActive(i);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault(); // keep input focus until pick runs
                pick(h);
              }}
              style={rowStyle(i === active)}
            >
              {compact ? (
                <>
                  {/* The spaces are text nodes the grid ignores; they keep the
                      option's name readable ("AMD Advanced Micro Devices US · Equity + Add"). */}
                  <b style={{ fontFamily: "var(--font-ui)", fontWeight: 500, fontSize: 13, color: "var(--text)" }}>{h.symbol}</b>{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 12,
                      color: "var(--text-2)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      minWidth: 0,
                    }}
                  >
                    {h.name}{" "}
                    <span style={{ ...mono, display: "block", fontSize: 10, color: "var(--text-4)" }}>
                      {[h.exchange, h.type].filter(Boolean).join(" · ")}
                    </span>
                  </span>{" "}
                  <span style={{ ...mono, fontSize: 11, whiteSpace: "nowrap" }}>{rowAction ? rowAction(h) : null}</span>
                </>
              ) : (
                <>
                  <span aria-hidden="true" style={{ ...mono, fontSize: "var(--fs-micro)", color: i === active ? "var(--link)" : "var(--text-4)", width: 10 }}>
                    {i === active ? "▸" : ""}
                  </span>{" "}
                  <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--text)", minWidth: 72 }}>
                    {h.symbol}
                  </span>{" "}
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--fs-body-s)",
                      color: "var(--text-2)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h.name}
                  </span>{" "}
                  <span style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    {[h.exchange, h.type].filter(Boolean).join(" · ")}
                  </span>
                  {rowAction ? (
                    <>
                      {" "}
                      <span style={{ ...mono, fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>{rowAction(h)}</span>
                    </>
                  ) : null}
                </>
              )}
            </div>
          ))}
          {(q.isFetching || (aliasQuery && alt.isFetching)) && !hits.length && (
            <div style={{ padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              Searching…
            </div>
          )}
          {!q.isFetching && !(aliasQuery && alt.isFetching) && !hits.length && debounced.trim().length > 0 && (
            <div style={{ padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              {q.isError ? "Symbol search unavailable: the data service did not answer." : `No listings match "${debounced.trim()}".`}
            </div>
          )}
          {hits.length > 0 && provider ? (
            <div
              style={{ padding: "6px 12px", borderTop: "0.5px solid var(--line-hair)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)" }}
            >
              {provider === "eodhd" ? "EODHD search index" : provider === "yfinance" ? "yfinance index" : provider}
              {fallback ? " · standing in for EODHD" : ""}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
