/**
 * Disclosure — progressive-disclosure row for methodology, formulas, long
 * caveats, provenance and secondary evidence (2026-09-05). A button with
 * aria-expanded over a region; the ▸/▾ glyph is the only decoration. Closed
 * by default so the executive read stays on top and the analyst opens what
 * they want to inspect.
 */

import { useId, useState, type ReactNode } from "react";
import { mono } from "./screen-ui";
import { useBreakpoint } from "../../lib/useBreakpoint";

interface Props {
  title: ReactNode;
  /** Right-aligned meta (count, date, source). */
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Visual weight: "row" (hairline row) or "quiet" (text-only trigger). */
  variant?: "row" | "quiet";
  id?: string;
  style?: React.CSSProperties;
}

export default function Disclosure({ title, right, defaultOpen = false, children, variant = "row", id, style }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const { isNarrow } = useBreakpoint();
  const panelId = `${uid}-panel`;
  const row = variant === "row";
  return (
    <div id={id} style={style}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        style={{
          appearance: "none",
          width: "100%",
          textAlign: "left",
          background: row ? "var(--surface)" : "none",
          border: row ? "0.5px solid var(--line-hair)" : "none",
          borderRadius: "var(--r-xs)",
          padding: row ? "10px 12px" : "6px 0",
          minHeight: 40,
          cursor: "pointer",
          display: "flex",
          flexWrap: isNarrow ? "wrap" : "nowrap",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: isNarrow ? "2px 12px" : 12,
          color: open ? "var(--text)" : "var(--text-2)",
        }}
      >
        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", fontWeight: 500 }}>
          <span aria-hidden="true" style={{ color: "var(--text-muted)", marginRight: 8, ...mono }}>
            {open ? "▾" : "▸"}
          </span>
          {title}
        </span>
        {right ? (
          <span
            style={{
              ...mono,
              fontSize: "var(--fs-meta)",
              letterSpacing: "var(--ls-micro)",
              color: "var(--text-muted)",
              textAlign: "right",
              minWidth: 0,
            }}
          >
            {right}
          </span>
        ) : null}
      </button>
      <div id={panelId} hidden={!open} style={{ marginTop: row ? 6 : 4 }}>
        {open ? children : null}
      </div>
    </div>
  );
}
