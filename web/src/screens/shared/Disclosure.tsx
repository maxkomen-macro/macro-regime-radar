/**
 * Disclosure — progressive-disclosure row for methodology, formulas, long
 * caveats, provenance and secondary evidence (2026-09-05). A button with
 * aria-expanded over a region; the ▸/▾ glyph is the only decoration. Closed
 * by default so the executive read stays on top and the analyst opens what
 * they want to inspect. Children mount only while open, so a lens that
 * fetches (the Options lens) never requests until asked.
 *
 * 2026-09-15 (redesign Phase 2, checklist B.14): the mockup trigger. The
 * `row` variant is the Options-lens button (8px radius, 1px --line-2 border,
 * 2% white fill, title + plain description + mono meta on the right); `quiet`
 * is the text-only trigger, with `tone="mint"` for the News regime-read line.
 * `DisclosureLine` is the mono footer paragraph every tab ends with.
 */

import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { useBreakpoint } from "../../lib/useBreakpoint";

interface Props {
  title: ReactNode;
  /** Right-aligned meta (count, date, source). */
  right?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  /** Visual weight: "row" (bordered row) or "quiet" (text-only trigger). */
  variant?: "row" | "quiet";
  id?: string;
  style?: CSSProperties;
  /** Plain-language line after the title ("Chain by expiration · bid, ask, IV, Greeks"). */
  description?: ReactNode;
  /** "mint" paints the quiet trigger in the mint read-through colour. */
  tone?: "default" | "mint";
  /** Fires after every toggle with the new open state. */
  onToggle?: (open: boolean) => void;
}

export default function Disclosure({
  title,
  right,
  defaultOpen = false,
  children,
  variant = "row",
  id,
  style,
  description,
  tone = "default",
  onToggle,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const uid = useId();
  const { isNarrow } = useBreakpoint();
  const panelId = `${uid}-panel`;
  const row = variant === "row";
  const mint = tone === "mint";

  const toggle = () => {
    const next = !open;
    setOpen(next);
    onToggle?.(next);
  };

  const rowStyle: CSSProperties = {
    appearance: "none",
    width: "100%",
    display: "flex",
    flexWrap: isNarrow ? "wrap" : "nowrap",
    alignItems: "center",
    gap: isNarrow ? "4px 10px" : 10,
    padding: "10px 12px",
    borderRadius: "var(--r-ctl)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: open ? "var(--line)" : "var(--line-2)",
    background: "rgba(255,255,255,.02)",
    textAlign: "left",
    minHeight: 40,
    cursor: "pointer",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
  };
  const quietStyle: CSSProperties = {
    appearance: "none",
    width: "100%",
    display: "flex",
    flexWrap: isNarrow ? "wrap" : "nowrap",
    alignItems: "center",
    gap: isNarrow ? "2px 8px" : 8,
    padding: "6px 0",
    border: 0,
    background: "none",
    textAlign: "left",
    minHeight: 40,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
    fontSize: mint ? 11.5 : 12.5,
    color: mint ? "var(--mint)" : open ? "var(--text)" : "var(--text-2)",
  };

  return (
    <div id={id} style={style}>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={panelId} className={row ? "mrr-disclosure-row" : "mrr-disclosure-quiet"} style={row ? rowStyle : quietStyle}>
        <span aria-hidden="true" style={{ fontFamily: "var(--font-mono)", color: row ? "var(--text-3)" : "inherit", flex: "none" }}>
          {open ? "▾" : "▸"}
        </span>
        {/* The row title may shrink and wrap (min-width 0): a long title in a
            390px column otherwise overflows the page (Phase 7 verify). */}
        <span style={row ? { fontWeight: 500, fontSize: 13.5, flex: "0 1 auto", minWidth: 0 } : undefined}>{title}</span>
        {description != null ? (
          <span
            style={{
              fontSize: 13,
              color: "var(--text-2)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: isNarrow ? "normal" : "nowrap",
              flexBasis: isNarrow ? "100%" : undefined,
            }}
          >
            {description}
          </span>
        ) : null}
        {right != null ? (
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontWeight: 400,
              fontSize: 10,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: "var(--text-3)",
              textAlign: "right",
              // Shrinkable so a long meta wraps inside a phone-width row instead
              // of pushing the page wide (Phase 10, 390 px matrix).
              flexShrink: 1,
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

/** The mono footer line that closes every tab: sources, caveats, cadence. */
export function DisclosureLine({ children, id, style }: { children: ReactNode; id?: string; style?: CSSProperties }) {
  return (
    <p
      id={id}
      className="mrr-disclosure-line"
      style={{
        marginTop: 18,
        marginBottom: 0,
        fontFamily: "var(--font-mono)",
        fontWeight: 400,
        fontSize: 11,
        lineHeight: 1.6,
        letterSpacing: ".03em",
        color: "var(--text-3)",
        maxWidth: 1100,
        ...style,
      }}
    >
      {children}
    </p>
  );
}
