/**
 * Symbol search — the entry point to single-name research. A mono input over
 * /api/market/search (EODHD's search index, cached server-side; no stand-in
 * since fix/prelaunch-1), with a keyboard-navigable result list. Combobox semantics: ArrowUp/Down move, Enter picks,
 * Escape clears. No icons; the ▸ glyph marks the active row.
 *
 * `compact` (redesign Phase 1) is the watchlist popover's variant: a 36 px
 * field with an Esc hint, results in flow as grid rows with an optional
 * per-row action ("+ Add" / "✓ Listed"), and `onDismiss` for Escape on an
 * empty box. Every default is unchanged for the Markets search.
 *
 * desk/usability: the Desk's InstrumentSearch (screens/desk/kit) reuses
 * this component with `scope="us"` (US-listed equities and ETFs only,
 * primary listings first, also filtered here so an API that predates the
 * scope cannot leak another listing), a `fallback` list shown when the
 * search does not answer (the series the store prices itself), a controlled
 * `value` (the Position Monitor's instrument field keeps what is typed or
 * picked), `dense` for a header-sized field and `className` for the Desk's
 * colors. Every default is unchanged for the Markets search and the
 * watchlist.
 *
 * Iteration 1 (M5): `onSubmitText` receives the typed text when Enter is
 * pressed on a settled search with no hits (the Markets research panel then
 * names the miss instead of doing nothing). While the search is still in
 * flight Enter picks nothing, as before. Escape that clears the box is
 * consumed (preventDefault), so a page-level Escape handler, such as the
 * single-name panel's close, does not also fire.
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
  /** Enter on a settled search with no hits: the trimmed text (M5). */
  onSubmitText?: (text: string) => void;
  /** "us": US-listed equities and ETFs only, primary listings first (the Desk). */
  scope?: "all" | "us";
  /** Hits to offer when the search did not answer, for the text in the box (the Desk's stored series). */
  fallback?: (text: string) => SearchHit[];
  /** The fallback list's footer line. */
  fallbackNote?: string;
  /** Controlled text: the box shows `value`, every edit goes to `onTextChange`, and a pick keeps the text. */
  value?: string;
  onTextChange?: (text: string) => void;
  /** The field's id, for a visible <label htmlFor> (its name then comes from the label). */
  inputId?: string;
  /** The field's name when no label names it. */
  ariaLabel?: string;
  /** A 34 px field (a page header). */
  dense?: boolean;
  /** The wrapper's class (the Desk sets its colors through it). */
  className?: string;
  /** The wrapper's maximum width (default 640 px; the watchlist's compact box none). */
  maxWidth?: number | "none";
}

/** A hit the Desk can price from US daily history: a US listing, an equity or an ETF. */
export function usPriceable(h: SearchHit): boolean {
  return h.exchange === "US" && (h.type === "Equity" || h.type === "ETF");
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
  onSubmitText,
  scope = "all",
  fallback,
  fallbackNote = "The search did not answer · series this store prices",
  value,
  onTextChange,
  inputId,
  ariaLabel,
  dense = false,
  className,
  maxWidth,
}: Props) {
  const [inner, setInner] = useState("");
  const controlled = value !== undefined;
  const text = controlled ? value : inner;
  const setText = (t: string) => {
    if (!controlled) setInner(t);
    onTextChange?.(t);
  };
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(text, 250);
  const q = useSymbolSearch(debounced, 10, scope);
  const aliasQuery = dashedAlias(debounced);
  const alt = useSymbolSearch(aliasQuery, 10, scope);
  // A disabled alias query still carries its previous placeholder data; only
  // read it while an alias is actually being searched (regression 2026-09-06:
  // "ZZZQ" showed the earlier "BRK.B" alias hits).
  const altHits = aliasQuery ? (alt.data?.hits ?? []) : [];
  const ranked = rankHits([...altHits, ...(q.data?.hits ?? [])], debounced);
  // The Desk's scope: US equities and ETFs only, primary listings first (the rank kept within each).
  const searched = scope === "us" ? [...ranked.filter((h) => usPriceable(h) && h.primary !== false), ...ranked.filter((h) => usPriceable(h) && h.primary === false)] : ranked;
  // The search did not answer: the caller's own list, for the same text.
  const fallbackHits = q.isError && fallback && debounced.trim() ? fallback(debounced.trim()) : [];
  const usingFallback = !searched.length && fallbackHits.length > 0;
  // Codex R-04: a suggestion belongs to the exact text that was searched. While the box holds other text
  // (the debounce still pending), none is shown, and neither Enter nor a click can pick one.
  const fresh = debounced === text;
  const hits = !fresh ? [] : usingFallback ? fallbackHits : searched;
  const pending = !fresh || q.isFetching || !!(aliasQuery && alt.isFetching);
  // The provider that answered is part of the result (2026-09-06).
  const provider = q.data?.provider ?? alt.data?.provider ?? null;
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
    // A controlled box keeps its text: the caller decides what it shows after a pick.
    if (!controlled) setText("");
    setOpen(false);
  };

  // The box's text has been searched and every query has answered.
  const settled = debounced === text && !q.isFetching && !(aliasQuery && alt.isFetching);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && onDismiss && text.trim() === "") {
      e.preventDefault();
      onDismiss();
      return;
    }
    if (!open || !hits.length) {
      if (e.key === "Escape") {
        if (text !== "" && !controlled) {
          e.preventDefault();
          setText("");
        }
        setOpen(false);
      } else if (e.key === "Enter" && onSubmitText && !hits.length && text.trim() !== "" && settled) {
        e.preventDefault();
        onSubmitText(text.trim());
        setText("");
        setOpen(false);
      }
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
      e.preventDefault();
      setOpen(false);
      // A controlled box keeps what was typed: Escape only closes the list.
      if (!controlled) setText("");
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
        padding: dense ? "6px 12px" : "10px 14px",
        minHeight: dense ? 34 : 44,
        color: "var(--text)",
        ...mono,
        fontSize: dense ? "var(--fs-body-s)" : "var(--fs-body)",
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
      id={inputId}
      aria-label={ariaLabel ?? (inputId ? undefined : "Search any listed symbol")}
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
    <div ref={boxRef} className={className} style={{ position: "relative", maxWidth: maxWidth ?? (compact ? "none" : 640) }}>
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
          {pending && !hits.length && (
            <div style={{ padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              Searching…
            </div>
          )}
          {!pending && !hits.length && debounced.trim().length > 0 && (
            <div style={{ padding: "8px 12px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-muted)" }}>
              {q.isError ? "Symbol search unavailable: the data service did not answer." : `No listings match "${debounced.trim()}".`}
            </div>
          )}
          {fresh && usingFallback ? (
            <div
              style={{ padding: "6px 12px", borderTop: "0.5px solid var(--line-hair)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)" }}
            >
              {fallbackNote}
            </div>
          ) : hits.length > 0 && provider ? (
            <div
              style={{ padding: "6px 12px", borderTop: "0.5px solid var(--line-hair)", fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)" }}
            >
              {provider === "eodhd" ? "EODHD search index" : provider}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
