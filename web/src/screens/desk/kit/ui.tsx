/**
 * The Desk v2 card skeleton (DESK_FRAME3_SPEC §1.4) and its parts. Every card
 * on every tab is built from these: a title and a gray subtitle on one line,
 * a stat row (mono label, serif number, gray sub-line), the body, a boxed
 * read, and a footer with `Advanced ▸` and/or an action link. The live badge
 * (§1.6) sits top-right on a card that reads live data; a card whose data did
 * not arrive keeps its stat labels and says "Awaiting refresh" (§1.7).
 */

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import type { Unavailable } from "../data/envelope";
import type { Verdict } from "../data/types";
import { VERDICT_LABEL } from "./format";

export type Tone = "up" | "down" | "flat" | "amber" | "green" | "red" | "blue" | "gray" | "default";

// ── The unavailable state (§1.0.2) ─────────────────────────────────────────
// A block the API serves awaiting keeps its title, subtitle and stat labels;
// its body prints the served reason once; its Advanced control is disabled
// and says "not yet served"; its badge reads "○ Not yet served". A card
// inside an <Unserved> scope takes that state: the Card prints the reason
// once, a Stat keeps its label with no number, Awaiting says nothing more.
// Outside a Card (a section a page draws itself), Awaiting prints the reason.

interface UnservedValue {
  block: Unavailable;
  /** The reason is printed once by the enclosing Card; parts inside it stay quiet. */
  once: boolean;
}
const UnservedContext = createContext<UnservedValue | null>(null);

/** A scope whose cards and parts render the unavailable state for `block` (none when it is null). */
export function Unserved({ block, children }: { block: Unavailable | null | undefined; children: ReactNode }) {
  // Always the same element, so a block that turns unavailable (or back) never remounts what it wraps.
  const outer = useContext(UnservedContext);
  return <UnservedContext.Provider value={block ? { block, once: false } : outer}>{children}</UnservedContext.Provider>;
}

/** The unavailable block around this part, if any. */
export function useUnserved(): Unavailable | null {
  return useContext(UnservedContext)?.block ?? null;
}

/** The served reason, and "Until: …" when served (§1.0.2). */
export function UnservedLine({ block, className }: { block: Unavailable; className?: string }) {
  return (
    <p className={cx("dk-unserved", className)} role="status">
      {block.reason}
      {block.until ? <span className="dk-unserved-until"> Until: {block.until}.</span> : null}
    </p>
  );
}

/**
 * Whether a card's block is unavailable: the route's scope (the whole answer
 * served awaiting), else the block's own reason under `_blocks[path]` (a block
 * served awaiting inside a ready answer, §12.0), else null.
 */
export function useBlockUnserved(data: { _blocks?: Record<string, Unavailable> } | null | undefined, ...paths: string[]): Unavailable | null {
  const scoped = useUnserved();
  if (scoped) return scoped;
  for (const p of paths) {
    const u = data?._blocks?.[p];
    if (u) return u;
  }
  return null;
}

/**
 * A card whose block is unavailable, drawn exactly as §1.0.2 says: its title
 * and subtitle, "○ Not yet served", its stat labels with no number, the
 * served reason once, and its Advanced control disabled ("not yet served").
 * Cards a page draws itself return this in place of their body.
 */
export function UnservedCard({
  title,
  sub,
  labels = [],
  block,
  className,
  advanced = false,
  headingId,
  as: As = "section",
  cols,
}: {
  title: ReactNode;
  sub?: ReactNode;
  labels?: ReactNode[];
  /** The labels' columns (default one per label; 1 stacks them, for a narrow column). */
  cols?: number;
  block: Unavailable;
  className?: string;
  advanced?: boolean;
  headingId?: string;
  as?: "section" | "div" | "article";
}) {
  const own = useId();
  const hid = headingId ?? own;
  return (
    <As className={cx("dk-card", className)} aria-labelledby={hid} data-unserved="">
      <div className="dk-card-head">
        <h2 className="dk-card-title" id={hid}>
          {title}
          {sub ? <span className="dk-card-sub"> {sub}</span> : null}
        </h2>
        <div className="dk-card-badge">
          <NotServedBadge />
        </div>
      </div>
      <UnservedContext.Provider value={{ block, once: true }}>
        {labels.length ? (
          <StatRow cols={cols ?? labels.length}>
            {labels.map((l, i) => (
              <Stat key={i} label={l} awaiting />
            ))}
          </StatRow>
        ) : null}
        <UnservedLine block={block} />
        {advanced ? (
          <div className="dk-card-foot">
            <Advanced items="" />
          </div>
        ) : null}
      </UnservedContext.Provider>
    </As>
  );
}

/** The badge of an unavailable card (§1.6): "○ Not yet served", gray. */
export function NotServedBadge({ boxed = false }: { boxed?: boolean }) {
  return (
    <span className={cx("dk-live", "dk-live-off", boxed && "dk-live-boxed")} data-testid="dk-live">
      <span className="dk-dot dk-dot-off" aria-hidden="true" />
      Not yet served
    </span>
  );
}

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

/** A verdict's label, or "—" for one not served or not known (L-3). */
export function verdictLabel(verdict: Verdict | undefined): string {
  return (verdict && VERDICT_LABEL[verdict]) || "—";
}

/** A verdict pill (§1.5): Reliable green, Suggestive amber, No edge gray. */
export function VerdictPill({ verdict, className }: { verdict: Verdict | undefined; className?: string }) {
  return (
    <span className={cx("dk-pill", className)} data-verdict={verdict}>
      {verdictLabel(verdict)}
    </span>
  );
}

/** A verdict as colored words, no pill (tables where the mockup prints text). */
export function VerdictWord({ verdict }: { verdict: Verdict | undefined }) {
  return (
    <span className="dk-verdict-word" data-verdict={verdict}>
      {verdictLabel(verdict)}
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
  unavailable,
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
  /** The card's block is served awaiting (§1.0.2); inside an <Unserved> scope this is the scope's. */
  unavailable?: Unavailable | null;
}) {
  const hid = useId();
  const ctx = useContext(UnservedContext);
  const block = unavailable === undefined ? (ctx?.block ?? null) : unavailable;
  const shownBadge = block ? <NotServedBadge /> : badge;
  // One element whatever the state, so a block that turns unavailable never remounts the card's body;
  // an explicit `unavailable={null}` clears an enclosing scope for this card.
  const inner: UnservedValue | null = block ? { block, once: true } : unavailable === null ? null : ctx;
  const body = (
    <UnservedContext.Provider value={inner}>
      {children}
      {block ? <UnservedLine block={block} /> : null}
    </UnservedContext.Provider>
  );
  return (
    <As className={cx("dk-card", className)} id={id} aria-labelledby={title ? hid : undefined} data-unserved={block ? "" : undefined}>
      {title || shownBadge || headExtra ? (
        <div className="dk-card-head">
          <h2 className="dk-card-title" id={hid}>
            {title}
            {sub ? <span className="dk-card-sub"> {sub}</span> : null}
          </h2>
          {headExtra}
          {shownBadge ? <div className="dk-card-badge">{shownBadge}</div> : null}
        </div>
      ) : null}
      <div className="dk-card-body">{body}</div>
      {footer ? (
        <div className="dk-card-foot">
          <UnservedContext.Provider value={inner}>{footer}</UnservedContext.Provider>
        </div>
      ) : null}
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
  const unserved = useUnserved();
  return (
    <div className="dk-stat" data-size={size}>
      <div className="dk-stat-label">{label}</div>
      {unserved ? (
        // §1.0.2: the label stays, no number; the card prints the reason once.
        <div className="dk-stat-await" aria-hidden="true">
          —
        </div>
      ) : awaiting ? (
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
    // With `cols`, the stats fill rows of that many columns (a column-flowing grid would spill into new ones).
    <div className="dk-stats" style={cols ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gridAutoFlow: "row" } : undefined}>
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
export function Advanced({ items, open, onToggle, controls, served = true }: { items: string; open?: boolean; onToggle?: () => void; controls?: string; served?: boolean }) {
  // §1.4: enabled only when the endpoint it opens exists in §12; otherwise disabled, "not yet served".
  if (useUnserved() || !served)
    return (
      <p className="dk-adv">
        <button type="button" className="dk-link" disabled data-testid="dk-advanced">
          Advanced ▸
        </button>{" "}
        <span>not yet served</span>
      </p>
    );
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
 * not serve yet, so an expander never opens onto nothing. §1.4: a control
 * whose panel reads no §12 endpoint is disabled and says "not yet served";
 * `enabled` marks one that opens something real (a served endpoint, or
 * controls this browser holds, §1.0's local basket editing). */
export function AdvancedPanel({ adv, items, missing, children, enabled = false }: { adv: { open: boolean; toggle: () => void; id: string }; items: string; missing?: string; children?: ReactNode; enabled?: boolean }) {
  const unserved = useUnserved();
  return (
    <>
      <Advanced items={items} open={adv.open} onToggle={adv.toggle} controls={adv.id} served={enabled} />
      {adv.open && !unserved && enabled ? (
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
  const ctx = useContext(UnservedContext);
  if (ctx) return ctx.once ? null : <UnservedLine block={ctx.block} className={className} />;
  return (
    <p className={cx("dk-await", className)} role="status">
      Awaiting refresh{children ? <span className="dk-await-why"> · {children}</span> : null}
    </p>
  );
}

/** "2 rows could not be read." (Codex R-16): said wherever a served list lost rows at the boundary, so a
 * count or an empty state is never read from what is left. Nothing when none were lost. */
export function droppedWords(n: number, one = "row", many = `${one}s`): string {
  return n > 0 ? `${n} ${n === 1 ? one : many} could not be read.` : "";
}

export function DroppedNote({ n, one, many, className }: { n: number; one?: string; many?: string; className?: string }) {
  if (!(n > 0)) return null;
  return (
    <p className={cx("dk-await dk-dropped", className)} role="status">
      {droppedWords(n, one, many)}
    </p>
  );
}

/** A signed number in its direction's color: green up, red down (§1.3). */
export function Signed({ value, children, bold, title }: { value: number; children: ReactNode; bold?: boolean; title?: string }) {
  return (
    <span className={cx("dk-signed", bold && "dk-b")} data-tone={value > 0 ? "up" : value < 0 ? "down" : "flat"} title={title}>
      {children}
    </span>
  );
}
