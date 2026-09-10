/**
 * Symbol search — the entry point to single-name research. A mono input over
 * /api/market/search (EODHD's search index first, yfinance as the disclosed
 * fallback; cached server-side), with a keyboard-navigable result list. Combobox semantics: ArrowUp/Down move, Enter picks,
 * Escape clears. No icons; the ▸ glyph marks the active row.
 */

import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { useSymbolSearch } from "../../api/queries";
import type { SearchHit } from "../../api/types";
import { mono, useDebounced } from "../shared/screen-ui";

interface Props {
  onSelect: (hit: SearchHit) => void;
}

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

export default function SymbolSearch({ onSelect }: Props) {
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

  return (
    <div ref={boxRef} style={{ position: "relative", maxWidth: 640 }}>
      <input
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && hits.length ? `${listId}-opt-${Math.min(active, hits.length - 1)}` : undefined}
        aria-label="Search any listed symbol"
        placeholder="Search any ticker or company (e.g. NVDA, BRK.B, Nestlé)…"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        spellCheck={false}
        autoComplete="off"
        style={{
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
        }}
      />
      {open && text.trim().length > 0 && (
        <div
          id={listId}
          role="listbox"
          style={{
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
          }}
        >
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
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "9px 12px",
                minHeight: 40,
                cursor: "pointer",
                background: i === active ? "var(--surface-raised)" : "transparent",
              }}
            >
              <span aria-hidden="true" style={{ ...mono, fontSize: "var(--fs-micro)", color: i === active ? "var(--accent)" : "var(--text-faint)", width: 10 }}>
                {i === active ? "▸" : ""}
              </span>
              <span style={{ ...mono, fontSize: "var(--fs-body-s)", fontWeight: 600, color: "var(--text)", minWidth: 72 }}>
                {h.symbol}
              </span>
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
              </span>
              <span style={{ ...mono, fontSize: "var(--fs-micro)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {[h.exchange, h.type].filter(Boolean).join(" · ")}
              </span>
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
