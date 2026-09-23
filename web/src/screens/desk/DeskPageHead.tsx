/**
 * Every Desk page opens with the same head: the eyebrow "Desk · <group>",
 * the page's h1 (the UI face, or the serif display rung where the page has
 * an answer to state, as Today does), one sentence under it, and the status
 * badge on the right (§3: every panel, no exceptions). The route's only h1.
 */

import type { ReactNode } from "react";
import { deskGroupOf, type DeskPage } from "./desk-sections";

export default function DeskPageHead({
  page,
  title,
  display = false,
  description,
  badge,
  actions,
}: {
  page: DeskPage;
  /** Overrides the page label (Today prints its answer). */
  title?: ReactNode;
  /** Set the h1 in the serif display rung. */
  display?: boolean;
  description?: ReactNode;
  badge: ReactNode;
  actions?: ReactNode;
}) {
  const group = deskGroupOf(page.slug);
  return (
    <div className="mrr-desk-head">
      <div className="mrr-desk-head-l">
        <p className="mrr-desk-eyebrow">
          Desk <span aria-hidden="true">·</span> {group?.label ?? "Desk"}
        </p>
        <h1 className={display ? "mrr-display" : undefined}>{title ?? page.label}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="mrr-desk-head-r">
        {badge}
        {actions}
      </div>
    </div>
  );
}
