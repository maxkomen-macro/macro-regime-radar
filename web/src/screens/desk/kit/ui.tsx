/**
 * The Desk v2 card skeleton (DESK_FRAME3_SPEC §1.4) and its parts. Every card
 * on every tab is built from these: a title and a gray subtitle on one line,
 * a stat row (mono label, serif number, gray sub-line), the body, a boxed
 * read, and a footer with `Advanced ▸` and/or an action link. The live badge
 * (§1.6) sits top-right on a card that reads live data; a card whose data did
 * not arrive keeps its stat labels and says "Awaiting refresh" (§1.7).
 */

import { useId, useState, type ReactNode } from "react";
import type { Verdict } from "../data/types";
import { VERDICT_LABEL } from "./format";

export type Tone = "up" | "down" | "flat" | "amber" | "green" | "red" | "blue" | "gray" | "default";

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** `● Live · <source> · <date>` (§1.6): green dot, mono. Parts that are absent are left out. */
export function LiveBadge({ parts, boxed = false, className }: { parts?: (string | null | undefined)[]; boxed?: boolean; className?: string }) {
  const text = ["Live", ...(parts ?? [])].filter(Boolean).join(" · ");
  return (
    <span className={cx("dk-live", boxed && "dk-live-boxed", className)} data-testid="dk-live">
      <span className="dk-dot" aria-hidden="true" />
      {text}
    </span>
  );
}

/** A verdict pill (§1.5): Reliable green, Suggestive amber, No edge gray. */
export function VerdictPill({ verdict, className }: { verdict: Verdict; className?: string }) {
  return (
    <span className={cx("dk-pill", className)} data-verdict={verdict}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** A verdict as colored words, no pill (tables where the mockup prints text). */
export function VerdictWord({ verdict }: { verdict: Verdict }) {
  return (
    <span className="dk-verdict-word" data-verdict={verdict}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

export function Card({
  title,
  sub,
  badge,
  children,
  footer,
  className,
  id,
  as: As = "section",
  headExtra,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  id?: string;
  as?: "section" | "div" | "article";
  headExtra?: ReactNode;
}) {
  const hid = useId();
  return (
    <As className={cx("dk-card", className)} id={id} aria-labelledby={title ? hid : undefined}>
      {title || badge || headExtra ? (
        <div className="dk-card-head">
          <h2 className="dk-card-title" id={hid}>
            {title}
            {sub ? <span className="dk-card-sub"> {sub}</span> : null}
          </h2>
          {headExtra}
          {badge ? <div className="dk-card-badge">{badge}</div> : null}
        </div>
      ) : null}
      <div className="dk-card-body">{children}</div>
      {footer ? <div className="dk-card-foot">{footer}</div> : null}
    </As>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "default",
  size,
  awaiting,
}: {
  label: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  size?: "xl" | "lg" | "md" | "sm" | "date";
  /** No value served: the label stays, no number (§1.7). */
  awaiting?: boolean;
}) {
  return (
    <div className="dk-stat" data-size={size}>
      <div className="dk-stat-label">{label}</div>
      {awaiting ? (
        <div className="dk-stat-await">Awaiting refresh</div>
      ) : (
        <>
          <div className="dk-stat-value" data-tone={tone}>
            {value}
          </div>
          {sub ? <div className="dk-stat-sub">{sub}</div> : null}
        </>
      )}
    </div>
  );
}

export function StatRow({ children, cols }: { children: ReactNode; cols?: number }) {
  return (
    <div className="dk-stats" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}>
      {children}
    </div>
  );
}

/** The boxed read (§1.4 item 4): `Read:` or `Read for the desk:`; amber border when a warning. */
export function ReadBox({ label = "Read", warn = false, children, className }: { label?: string | null; warn?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={cx("dk-read", className)} data-warn={warn || undefined}>
      {label ? <b>{label}:</b> : null} {children}
    </div>
  );
}

/** `Advanced ▸` (blue link) plus the gray list of what expands (§1.4 item 5). */
export function Advanced({ items, open, onToggle, controls }: { items: string; open?: boolean; onToggle?: () => void; controls?: string }) {
  return (
    <p className="dk-adv">
      <button type="button" className="dk-link" aria-expanded={onToggle ? Boolean(open) : undefined} aria-controls={open ? controls : undefined} onClick={onToggle} data-testid="dk-advanced">
        Advanced {open ? "▾" : "▸"}
      </button>{" "}
      <span>{items}</span>
    </p>
  );
}

/** A card footer's Advanced link that opens a panel under the card's body. */
export function useAdvanced(): { open: boolean; toggle: () => void; id: string } {
  const [open, setOpen] = useState(false);
  const id = useId();
  return { open, toggle: () => setOpen((o) => !o), id };
}

/** `Advanced ▸` with the panel it opens under the card's body: what is
 * served goes in `children`; `missing` says in one sentence what the API does
 * not serve yet, so an expander never opens onto nothing. */
export function AdvancedPanel({ adv, items, missing, children }: { adv: { open: boolean; toggle: () => void; id: string }; items: string; missing?: string; children?: ReactNode }) {
  return (
    <>
      <Advanced items={items} open={adv.open} onToggle={adv.toggle} controls={adv.id} />
      {adv.open ? (
        <div className="dk-adv-panel" id={adv.id}>
          {children}
          {missing ? <p className="dk-adv-missing">{missing}</p> : null}
        </div>
      ) : null}
    </>
  );
}

/** A card body with nothing served (§1.7): gray words, no number. */
export function Awaiting({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <p className={cx("dk-await", className)} role="status">
      Awaiting refresh{children ? <span className="dk-await-why"> · {children}</span> : null}
    </p>
  );
}

/** A signed number in its direction's color: green up, red down (§1.3). */
export function Signed({ value, children, bold }: { value: number; children: ReactNode; bold?: boolean }) {
  return (
    <span className={cx("dk-signed", bold && "dk-b")} data-tone={value > 0 ? "up" : value < 0 ? "down" : "flat"}>
      {children}
    </span>
  );
}
