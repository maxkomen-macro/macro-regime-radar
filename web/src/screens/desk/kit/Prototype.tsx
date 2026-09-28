/**
 * The PROTOTYPE state (DESK_FRAME3_SPEC §1.0.3): a card drawn finished, with
 * illustrative values, for a part of the Desk that would take many hours to
 * build for real. No badge and no banner; its last line is one small muted
 * footnote in the style of a card's as-of stamp, "Illustrative values · In
 * production: <how it would be built>". Its values come only from the
 * prototype fixtures, read under ../prototypes/; the page marks the card with
 * `data-prototype`, which is what the tests hold every prototype value inside.
 */

import { useId, type ReactNode } from "react";
import { cx, Served } from "./ui";

/** The footnote's fixed opening (§1.0.3). */
export const PROTOTYPE_LEAD = "Illustrative values · In production: ";

/** The one footnote a PROTOTYPE card ends with. */
export function PrototypeFootnote({ production }: { production: string }) {
  return (
    <p className="dk-proto-foot" data-prototype-foot="">
      {PROTOTYPE_LEAD}
      {production}
    </p>
  );
}

/**
 * A PROTOTYPE card: the §1.4 skeleton (title and subtitle, then the body, then
 * the footer with `Advanced ▸`), no badge, and the footnote as its last line.
 * It clears any unavailable scope around it, so its stats and its Advanced
 * control are drawn finished on a page whose served blocks are awaiting.
 */
export function PrototypeCard({
  id,
  title,
  sub,
  production,
  advanced,
  headExtra,
  className,
  children,
}: {
  /** The card's registry id (../prototypes/registry.ts), carried as `data-prototype`. */
  id: string;
  title: ReactNode;
  sub?: ReactNode;
  /** The footnote's one line on how the card would be built. */
  production: string;
  advanced?: ReactNode;
  headExtra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const hid = useId();
  return (
    <section className={cx("dk-card", "dk-proto", className)} aria-labelledby={hid} data-prototype={id}>
      <div className="dk-card-head">
        <h2 className="dk-card-title" id={hid}>
          {title}
          {sub ? <span className="dk-card-sub"> {sub}</span> : null}
        </h2>
        {headExtra}
      </div>
      <Served>
        <div className="dk-card-body">{children}</div>
        <div className="dk-card-foot dk-proto-card-foot">
          {advanced}
          <PrototypeFootnote production={production} />
        </div>
      </Served>
    </section>
  );
}
