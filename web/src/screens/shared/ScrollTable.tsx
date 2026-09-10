/**
 * ScrollTable — the responsive table pattern (2026-09-05). Wide tables scroll
 * inside their own well instead of widening the page, and when they actually
 * overflow the well prints a "Swipe for more →" affordance so a phone reader
 * is never left with a table that merely looks cut off. `stickyFirst` pins
 * the first column (ticker / cohort names) while the numbers scroll.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { mono } from "./screen-ui";

interface Props {
  children: ReactNode;
  /** Pin the first column while the rest scrolls (default true). */
  stickyFirst?: boolean;
  /** Accessible name for the scroll region. */
  label?: string;
  style?: React.CSSProperties;
}

export default function ScrollTable({ children, stickyFirst = true, label, style }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const o = el.scrollWidth > el.clientWidth + 1;
      setOverflows(o);
      setAtEnd(!o || el.scrollLeft + el.clientWidth >= el.scrollWidth - 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [children]);

  return (
    <div style={style}>
      <div
        ref={ref}
        className={`mrr-scroll${stickyFirst ? " mrr-scroll-sticky" : ""}`}
        // A scrollable region must be keyboard reachable to be operable.
        tabIndex={overflows ? 0 : -1}
        role={overflows ? "region" : undefined}
        aria-label={overflows ? (label ?? "Scrollable table") : undefined}
        data-scrollable={overflows ? "true" : "false"}
      >
        {children}
      </div>
      {overflows ? (
        <div
          aria-hidden="true"
          style={{
            ...mono,
            fontSize: "var(--fs-meta)",
            color: "var(--text-muted)",
            textAlign: "right",
            marginTop: 4,
          }}
        >
          {atEnd ? "← Swipe back" : "Swipe for more →"}
        </div>
      ) : null}
    </div>
  );
}
