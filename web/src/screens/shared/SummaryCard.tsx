/**
 * SummaryCard and StatusStrip: the right column of the hero row
 * (docs/redesign-v2/UI_SPEC.md section 3, checklist 02-components B.2), built
 * from DeskRead's Ledger. Key/value rows as a real dl (sentence-case labels in
 * the UI face, values tabular), optional extra content, then a status strip:
 * mint when all is clear, amber for a watch, gray while loading or unavailable.
 * The strip is always a link or a button (never a div with a click handler) and
 * points at the alert drawer or the relevant section. Absent when the screen
 * has nothing to report: an empty strip never renders.
 *
 * Phase 2 mounts it only on /kit; the screens adopt it with TabHero in Phases
 * 3 to 9. Below 1620 the .mrr-hero-row grid (app.css) stacks it under the hero
 * (Iteration 1; 1200 before), where it sizes to its rows.
 */

import { useId, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useBreakpoint } from "../../lib/useBreakpoint";
import type { LedgerItem } from "./DeskRead";

/** A Ledger row with the label widened to a ReactNode (Jargon) and an optional
 * explicit key. `prose` is accepted and ignored: every value renders in the
 * UI face (spec section 1). */
export interface SummaryRow extends Omit<LedgerItem, "label"> {
  label: ReactNode;
  id?: string;
}

export type StatusTone = "mint" | "amber" | "gray";

export interface StatusStripProps {
  tone?: StatusTone;
  title: ReactNode;
  detail?: ReactNode;
  /** Router destination: renders a <Link>. */
  to?: string;
  /** Plain destination: renders an <a>. */
  href?: string;
  /** With neither `to` nor `href`: renders a <button type="button">. */
  onClick?: () => void;
  ariaLabel?: string;
  /** Set when the strip opens the alert drawer. */
  ariaHasPopup?: "dialog";
  id?: string;
  style?: CSSProperties;
}

export interface SummaryCardProps {
  title: ReactNode;
  /** Heading level; h3 under a hero h2, h2 when the hero carries the h1. */
  as?: "h2" | "h3";
  rows: SummaryRow[];
  status?: StatusStripProps;
  /** Extra content between the rows and the strip (a "Reference thresholds"
   * Disclosure). A nested odds bar goes through rows[].value instead. */
  children?: ReactNode;
  /** The card's source and as-of stamp (Iteration 1, A1): a `<Stamp>`
   * (./Stamp.tsx) on its own line under the title. */
  stamp?: ReactNode;
  id?: string;
  style?: CSSProperties;
}

/** Inline style for a link inside a value cell (the mockup "Goldilocks" link). */
export const kvLinkStyle: CSSProperties = {
  color: "var(--mint)",
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

const STRIP_TONES: Record<StatusTone, { background: string; borderColor: string; color: string }> = {
  mint: {
    background: "linear-gradient(90deg, rgba(18,190,130,.12), rgba(18,190,130,.05))",
    borderColor: "rgba(38,220,160,.34)",
    color: "var(--mint)",
  },
  amber: {
    background: "linear-gradient(90deg, rgba(245,181,46,.12), rgba(245,181,46,.04))",
    borderColor: "var(--amber-a36)",
    color: "var(--amber)",
  },
  // Derived (no mockup instance): the loading / unavailable strip.
  gray: {
    background: "linear-gradient(90deg, rgba(200,210,220,.08), rgba(200,210,220,.03))",
    borderColor: "rgba(200,210,220,.25)",
    color: "var(--text-2)",
  },
};

const EYEBROW: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-eyebrow)",
  letterSpacing: "var(--ls-eyebrow)",
  textTransform: "uppercase",
  color: "var(--text-eyebrow)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  margin: "0 0 12px",
};

export function StatusStrip({ tone = "mint", title, detail, to, href, onClick, ariaLabel, ariaHasPopup, id, style }: StatusStripProps) {
  const t = STRIP_TONES[tone];
  const interactive = Boolean(to || href || onClick);
  // Below 480 the strip tightens its padding, gaps and glyph (a useBreakpoint
  // padding consumer) so each status line keeps one line at 390 (G4).
  const { isMobile } = useBreakpoint();
  const glyph = isMobile ? 22 : 28;
  const base: CSSProperties = {
    marginTop: "auto",
    display: "flex",
    alignItems: "center",
    gap: isMobile ? 10 : 16,
    padding: isMobile ? "10px 12px" : "11px 18px",
    borderRadius: 10,
    background: t.background,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: t.borderColor,
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    textDecoration: "none",
    textAlign: "left",
    width: "100%",
    boxSizing: "border-box",
    cursor: interactive ? "pointer" : "default",
    ...style,
  };
  const body = (
    <>
      <svg width={glyph} height={glyph} viewBox="0 0 28 28" aria-hidden="true" fill="currentColor" style={{ flex: "none", color: t.color }}>
        <rect x="3" y="17" width="4" height="8" rx="1" />
        <rect x="10" y="12" width="4" height="13" rx="1" />
        <rect x="17" y="6" width="4" height="19" rx="1" />
      </svg>
      {/* G4 (Iteration 1 step 5): the title and the detail are each one
          status line (`data-copy="status"`), one rendered line at every width;
          anything longer belongs in the drawer or section the strip opens. */}
      <div style={{ minWidth: 0 }}>
        <b data-copy="status" style={{ display: "block", fontWeight: 500, fontSize: 14, lineHeight: 1.4 }}>
          <span className="mrr-status-title" style={{ color: t.color }}>
            {title}
          </span>
        </b>
        {detail != null ? (
          <small data-copy="status" style={{ display: "block", fontSize: 12, lineHeight: 1.45, color: "var(--text-2)" }}>
            {detail}
          </small>
        ) : null}
      </div>
      {interactive ? (
        <span className="mrr-status-chev" aria-hidden="true" style={{ marginLeft: "auto", display: "inline-flex", color: "var(--text-2)" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </span>
      ) : null}
    </>
  );
  const common = {
    id,
    className: `mrr-status mrr-status-${tone}`,
    "data-tone": tone,
    "aria-label": ariaLabel,
    "aria-haspopup": ariaHasPopup,
  };
  if (to) {
    return (
      <Link to={to} {...common} onClick={onClick} style={base}>
        {body}
      </Link>
    );
  }
  if (href) {
    return (
      <a href={href} {...common} onClick={onClick} style={base}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" {...common} onClick={onClick} style={{ ...base, appearance: "none" }}>
        {body}
      </button>
    );
  }
  return (
    <div {...common} style={base}>
      {body}
    </div>
  );
}

function rowKey(row: SummaryRow, i: number): string {
  if (row.id) return row.id;
  if (typeof row.label === "string" || typeof row.label === "number") return String(row.label);
  return `row-${i}`;
}

export function SummaryCard({ title, as = "h3", rows, status, children, stamp, id, style }: SummaryCardProps) {
  const uid = useId();
  const titleId = `${uid}-title`;
  const Heading = as;
  return (
    <section
      className="mrr-summary"
      id={id}
      aria-labelledby={titleId}
      style={{
        padding: "18px 20px 16px",
        display: "flex",
        flexDirection: "column",
        borderRadius: "var(--r-card)",
        border: "1px solid var(--line)",
        background: "var(--card-grad)",
        color: "var(--text)",
        minWidth: 0,
        ...style,
      }}
    >
      <Heading id={titleId} className="mrr-summary-title" style={stamp != null ? { ...EYEBROW, marginBottom: 4 } : EYEBROW}>
        {title}
      </Heading>
      {stamp != null ? (
        <div className="mrr-summary-stamp" style={{ margin: "0 0 8px" }}>
          {stamp}
        </div>
      ) : null}
      <dl className="mrr-kv" style={{ margin: 0 }}>
        {rows.map((r, i) => (
          <div
            key={rowKey(r, i)}
            className="mrr-kv-row"
            style={{
              display: "grid",
              gridTemplateColumns: "150px minmax(0,1fr)",
              gap: 12,
              padding: "7px 0",
              borderBottom: i < rows.length - 1 ? "1px solid var(--line-2)" : 0,
              fontFamily: "var(--font-ui)",
              fontSize: "var(--fs-kv)",
              lineHeight: 1.45,
            }}
          >
            <dt style={{ color: "var(--text-2)", margin: 0 }}>{r.label}</dt>
            <dd
              style={{
                color: r.tone ?? "var(--text)",
                margin: 0,
                fontFamily: "var(--font-ui)",
                fontVariantNumeric: "tabular-nums",
                minWidth: 0,
                textWrap: "pretty",
              }}
            >
              {r.value}
            </dd>
          </div>
        ))}
      </dl>
      {children}
      {status ? (
        // The strip anchors to the card's bottom (the auto top margin) with at
        // least 12px above it; the rows keep their natural height at the top.
        // A card stretched by its row shows the difference between the rows
        // and the strip, never as padding inside the rows (Iteration 1, G2).
        <div className="mrr-summary-foot" style={{ marginTop: "auto", paddingTop: 12 }}>
          <StatusStrip {...status} />
        </div>
      ) : null}
    </section>
  );
}

export default SummaryCard;
