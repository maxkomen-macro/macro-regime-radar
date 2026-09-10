/**
 * SubTabs — local tab semantics for in-page views (Tools, Regime Lab):
 * role=tablist / tab / tabpanel, aria-selected, roving tabindex with ←/→
 * and Home/End, and 44px touch rows on narrow viewports (2026-09-05). The
 * primary route navigation is a <nav> of links (TabBar); these are the
 * secondary, in-page ones.
 *
 * 2026-09-06: every view must be discoverable at every width. Below the
 * wide tier the row wraps, so nothing hides behind a horizontal scroll; at
 * wide widths a row that still overflows shows a fade plus a "More ▸"
 * control, and the selected tab is always scrolled into view.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";

export interface SubTabDef {
  id: string;
  label: string;
  /** Optional trailing meta (count, state word). */
  hint?: string;
}

interface Props {
  tabs: SubTabDef[];
  active: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist. */
  label: string;
  /** Renders the active panel; the wrapper supplies role/ids. */
  children: ReactNode;
  style?: React.CSSProperties;
}

export default function SubTabs({ tabs, active, onChange, label, children, style }: Props) {
  const uid = useId();
  const { isNarrow, bp } = useBreakpoint();
  const wrap = bp !== "wide"; // <1024: wrap rather than clip
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const idx = Math.max(0, tabs.findIndex((t) => t.id === active));

  const measure = () => {
    const el = listRef.current;
    if (!el) return;
    const right = el.scrollWidth - el.clientWidth - el.scrollLeft > 2;
    const left = el.scrollLeft > 2;
    setOverflow((o) => (o.left === left && o.right === right ? o : { left, right }));
  };

  useLayoutEffect(() => {
    measure();
    const el = listRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length, wrap]);

  // The selected view is always brought into view (keyboard, deep link, resize).
  useEffect(() => {
    refs.current[idx]?.scrollIntoView?.({ inline: "nearest", block: "nearest" });
    measure();
  }, [idx]);

  const onKey = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    refs.current[next]?.focus();
  };

  const nudge = (dir: 1 | -1) => {
    listRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  };

  return (
    // minWidth 0: as a grid item this root would otherwise inherit the nowrap
    // tab row's min-content width and push the page sideways on a phone.
    <div style={{ minWidth: 0, ...style }}>
      <div style={{ position: "relative", borderBottom: "1px solid var(--line)" }}>
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          onKeyDown={onKey}
          onScroll={measure}
          style={{
            display: "flex",
            flexWrap: wrap ? "wrap" : "nowrap",
            gap: isNarrow ? "0 4px" : wrap ? "0 14px" : 20,
            overflowX: wrap ? "visible" : "auto",
            scrollbarWidth: "none",
            // Room for the fade/controls at wide widths only when needed.
            paddingRight: !wrap && overflow.right ? 56 : 0,
          }}
        >
          {tabs.map((t, i) => {
            const on = t.id === active;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.id}`}
                aria-selected={on}
                aria-controls={`${uid}-panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => onChange(t.id)}
                style={{
                  appearance: "none",
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${on ? "var(--accent)" : "transparent"}`,
                  marginBottom: -1,
                  color: on ? "var(--text)" : "var(--text-muted)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--fs-body-s)",
                  fontWeight: on ? 600 : 400,
                  padding: isNarrow ? "12px 8px" : wrap ? "8px 2px 9px" : "0 2px 9px",
                  minHeight: isNarrow ? 44 : wrap ? 36 : 28,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  display: "inline-flex",
                  alignItems: "baseline",
                  gap: 6,
                }}
              >
                {t.label}
                {t.hint && !wrap ? (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--fs-micro)",
                      color: "var(--text-muted)",
                      letterSpacing: "var(--ls-micro)",
                    }}
                  >
                    {t.hint}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        {!wrap && (overflow.right || overflow.left) ? (
          <>
            {overflow.left ? (
              <div
                aria-hidden="true"
                style={{ position: "absolute", left: 0, top: 0, bottom: 1, width: 36, pointerEvents: "none", background: "linear-gradient(to right, var(--bg-base), transparent)" }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 1,
                display: "flex",
                alignItems: "center",
                gap: 2,
                paddingLeft: 24,
                background: "linear-gradient(to right, transparent, var(--bg-base) 40%)",
              }}
            >
              {overflow.left ? (
                <button type="button" className="mrr-chip-btn" aria-label="Scroll views left" onClick={() => nudge(-1)} style={{ minHeight: 24, padding: "0 6px" }}>
                  ◂
                </button>
              ) : null}
              {overflow.right ? (
                <button type="button" className="mrr-chip-btn" aria-label="Show more views" title="More views" onClick={() => nudge(1)} style={{ minHeight: 24, padding: "0 6px" }}>
                  More ▸
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
      <div
        role="tabpanel"
        id={`${uid}-panel-${active}`}
        aria-labelledby={`${uid}-tab-${active}`}
        tabIndex={-1}
        style={{ marginTop: 14, outline: "none" }}
      >
        {children}
      </div>
    </div>
  );
}
