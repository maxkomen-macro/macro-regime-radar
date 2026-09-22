/**
 * Small Desk-wide pieces: the Panel every module sits in (a Card panel with
 * the house SectionHeader and the status badge in its action slot), the
 * empty state a designed shell or an empty list prints (a sentence with
 * direction, never a blank), and the labelled figure.
 */

import type { CSSProperties, ReactNode } from "react";
import { Card, SectionHeader } from "../../components";
import { Caption } from "../shared/screen-ui";

export function Panel({
  id,
  title,
  badge,
  description,
  meta,
  actions,
  children,
  style,
  className,
}: {
  id?: string;
  title: ReactNode;
  /** The panel's status badge (spec §3: every panel). */
  badge?: ReactNode;
  description?: ReactNode;
  /** Mono meta string beside the title. */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <Card as="section" id={id} variant="panel" style={style} className={className}>
      <SectionHeader
        layout="panel"
        title={title}
        description={description}
        right={meta}
        actions={
          badge || actions ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              {actions}
              {badge}
            </span>
          ) : undefined
        }
      />
      {children}
    </Card>
  );
}

export function EmptyState({ title, children, live = true, style }: { title: ReactNode; children?: ReactNode; live?: boolean; style?: CSSProperties }) {
  return (
    <div className="mrr-desk-empty" role={live ? "status" : undefined} style={style}>
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** "Reads once live" (§6): one line under a designed shell's panels, in the
 * UI face (an explainer, never mono). */
export function ReadsNote({ children }: { children: ReactNode }) {
  return (
    <Caption as="p" style={{ marginTop: 0 }}>
      {children}
    </Caption>
  );
}

/** Numbers in the UI face at 500, tabular (DESIGN.md: big numbers are sans). */
export const numStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontVariantNumeric: "tabular-nums",
  letterSpacing: "var(--ls-numeric)",
};

/** A labelled figure: mono label above, the value in the UI face. */
export function Figure({ label, value, size = 30, sub, tone }: { label: ReactNode; value: ReactNode; size?: number; sub?: ReactNode; tone?: string }) {
  return (
    <div style={{ display: "grid", gap: 2, minWidth: 0 }}>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--text-3)" }}>{label}</div>
      <div style={{ ...numStyle, fontSize: size, lineHeight: 1.1, color: tone ?? "var(--text)" }}>{value}</div>
      {sub ? <div style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.45, color: "var(--text-3)" }}>{sub}</div> : null}
    </div>
  );
}
