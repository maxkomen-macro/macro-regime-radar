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
 *
 * 2026-09-15 (redesign Phase 2, checklist B.7): the boxed mockup layout. The
 * tablist is a bordered, panel-coloured box; each tab is a rounded button with
 * a block label and, at wide widths, a mono uppercase hint under it (mint on
 * the selected tab). Semantics, keyboard handling, wrap and overflow logic are
 * unchanged, and hints are still dropped when the row wraps. Hover brightens
 * the unselected label through local state (the label colour is inline, so a
 * stylesheet :hover could not override it).
 *
 * 2026-09-15 (redesign Phase 10, checklist 10 A8 / G18): each tab carries an
 * accessible name of "label, hint" (or the label alone) while its visible text
 * is unchanged; the unselected hint reads at --text-3 so the 10.5px words clear
 * AA (--text-4 stays for dots, dashes and disabled options only).
 *
 * Iteration 1 (R2): selecting a view never moves the page. A click or a key
 * focuses the new tab without scrolling, and after the new panel commits the
 * strip is put back where it was on screen: the scroll position is unchanged
 * when nothing above the strip changed (Regime Lab), and follows the strip
 * when something did (Tools swaps its hero row). A panel shorter than the
 * viewport would let the browser clamp the scroll position, so the panel keeps
 * a minimum height just large enough to hold it, released on the next switch.
 * A switch the screen makes itself (a hash, the palette) is left to its hash
 * scroll.
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

const SELECTED_BG = "linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.025))";

export default function SubTabs({ tabs, active, onChange, label, children, style }: Props) {
  const uid = useId();
  const { isNarrow, bp } = useBreakpoint();
  const wrap = bp !== "wide"; // <1024: wrap rather than clip
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /** The strip's viewport top when the reader picked a view (R2). */
  const pending = useRef<number | null>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [hover, setHover] = useState<string | null>(null);
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

  // The selected view is always brought into view (keyboard, deep link, resize)
  // by scrolling the strip itself. `scrollIntoView` would also move the
  // browser's sequential-focus starting point to the tab, so the first Tab
  // on the route landed inside the panel instead of on the skip link
  // (Phase 10 a11y pass, B.4 #1).
  useEffect(() => {
    const list = listRef.current;
    const el = refs.current[idx];
    if (list && el) {
      const lb = list.getBoundingClientRect();
      const eb = el.getBoundingClientRect();
      if (eb.left < lb.left) list.scrollLeft -= lb.left - eb.left;
      else if (eb.right > lb.right) list.scrollLeft += eb.right - lb.right;
    }
    measure();
  }, [idx]);

  /** The reader picks a view: remember where the strip sits on screen, switch,
   * and focus the new tab without scrolling to it (R2). */
  const select = (next: number) => {
    const list = listRef.current;
    // The selected tab re-selected still reports (a screen may rewrite its
    // hash); only a real switch arms the restore, which runs on `active`.
    pending.current = next !== idx && list ? list.getBoundingClientRect().top : null;
    onChange(tabs[next].id);
    refs.current[next]?.focus({ preventScroll: true });
  };

  // After the new panel commits (before paint): release the last hold, then
  // put the strip back where it was on screen, holding the panel open when it
  // is too short for that scroll position.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const list = listRef.current;
    const was = pending.current;
    pending.current = null;
    if (!panel || !list) return;
    panel.style.minHeight = "";
    if (was == null) return;
    const doc = document.documentElement;
    const target = Math.round(window.scrollY + list.getBoundingClientRect().top - was);
    if (target <= 0) return;
    const short = target + window.innerHeight - doc.scrollHeight;
    if (short > 0) panel.style.minHeight = `${Math.ceil(panel.getBoundingClientRect().height + short)}px`;
    if (Math.abs(window.scrollY - target) > 0.5) window.scrollTo({ top: target, behavior: "instant" as ScrollBehavior });
  }, [active]);

  const onKey = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    select(next);
  };

  const nudge = (dir: 1 | -1) => {
    listRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  };

  return (
    // minWidth 0: as a grid item this root would otherwise inherit the nowrap
    // tab row's min-content width and push the page sideways on a phone.
    <div style={{ minWidth: 0, ...style }}>
      <div style={{ position: "relative", borderRadius: "var(--r-card)" }}>
        <div
          ref={listRef}
          role="tablist"
          aria-label={label}
          onKeyDown={onKey}
          onScroll={measure}
          className="mrr-subtabs"
          style={{
            display: "flex",
            alignItems: "stretch",
            flexWrap: wrap ? "wrap" : "nowrap",
            gap: 6,
            // Room for the fade/controls at wide widths only when needed.
            padding: !wrap && overflow.right ? "6px 56px 6px 6px" : "6px",
            borderRadius: "var(--r-card)",
            border: "1px solid var(--line)",
            background: "var(--panel)",
            overflowX: wrap ? "visible" : "auto",
            scrollbarWidth: "none",
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
                aria-label={t.hint ? `${t.label}, ${t.hint}` : t.label}
                tabIndex={on ? 0 : -1}
                onClick={() => select(i)}
                onMouseEnter={() => setHover(t.id)}
                onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}
                className="mrr-subtab"
                style={{
                  appearance: "none",
                  flex: "1 1 auto",
                  textAlign: "left",
                  padding: isNarrow ? "9px 12px 8px" : "9px 16px 8px",
                  borderRadius: "var(--r-ctl)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: on ? "var(--line-white-14)" : "transparent",
                  background: on ? SELECTED_BG : "none",
                  color: "inherit",
                  fontFamily: "var(--font-ui)",
                  minHeight: isNarrow ? 44 : wrap ? 36 : undefined,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                <b
                  style={{
                    display: "block",
                    fontFamily: "var(--font-ui)",
                    fontWeight: 500,
                    fontSize: 14,
                    lineHeight: 1.35,
                    color: on ? "#fff" : hover === t.id ? "var(--text)" : "var(--text-2)",
                  }}
                >
                  {t.label}
                </b>
                {t.hint && !wrap ? (
                  <small
                    style={{
                      display: "block",
                      fontFamily: "var(--font-mono)",
                      fontWeight: 400,
                      fontSize: 10.5,
                      lineHeight: 1.4,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: on ? "var(--mint)" : "var(--text-3)",
                      marginTop: 1,
                    }}
                  >
                    {t.hint}
                  </small>
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
                style={{
                  position: "absolute",
                  left: 1,
                  top: 1,
                  bottom: 1,
                  width: 36,
                  pointerEvents: "none",
                  borderRadius: "var(--r-card) 0 0 var(--r-card)",
                  background: "linear-gradient(to right, var(--panel), transparent)",
                }}
              />
            ) : null}
            <div
              style={{
                position: "absolute",
                right: 1,
                top: 1,
                bottom: 1,
                display: "flex",
                alignItems: "center",
                gap: 2,
                paddingLeft: 24,
                paddingRight: 6,
                borderRadius: "0 var(--r-card) var(--r-card) 0",
                background: "linear-gradient(to right, transparent, var(--panel) 40%)",
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
        ref={panelRef}
        role="tabpanel"
        id={`${uid}-panel-${active}`}
        aria-labelledby={`${uid}-tab-${active}`}
        tabIndex={-1}
        style={{ marginTop: "var(--gap-panel)", outline: "none" }}
      >
        {children}
      </div>
    </div>
  );
}
