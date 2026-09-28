/**
 * The Desk v2 card skeleton (DESK_FRAME3_SPEC §1.4) and its parts. Every card
 * on every tab is built from these: a title and a gray subtitle on one line,
 * a stat row (mono label, serif number, gray sub-line), the body, a boxed
 * read, and a footer with `Advanced ▸` and/or an action link. The live badge
 * (§1.6) sits top-right on a card that reads live data; a card whose data did
 * not arrive keeps its stat labels and says "Awaiting refresh" (§1.7).
 */

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { DeskApiError, unavailableOf } from "../data/api";
import type { Unavailable } from "../data/envelope";
import type { Verdict } from "../data/types";
import { VERDICT_LABEL } from "./format";
import { defineTerms } from "./Term";

export type Tone = "up" | "down" | "flat" | "amber" | "green" | "red" | "blue" | "gray" | "default";

// ── The unavailable state (§1.0.2) ─────────────────────────────────────────
// A block the API serves awaiting keeps its title, subtitle and stat labels;
// its body prints the served reason once; it shows no Advanced control
// (desk/usability §14.13); its badge reads "○ Not yet served", or "○ Awaiting
// refresh" when the reason begins "Awaiting refresh" (§1.7, S-27). A card
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

/** A scope with no unavailable block, whatever encloses it: a PROTOTYPE card (§1.0.3) is drawn finished even on
 * a page whose served blocks are awaiting. */
export function Served({ children }: { children: ReactNode }) {
  return <UnservedContext.Provider value={null}>{children}</UnservedContext.Provider>;
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
 * and subtitle, its badge (§1.7), its stat labels with no number, the
 * served reason once, and no Advanced control (desk/usability §14.13).
 * Cards a page draws itself return this in place of their body.
 */
export function UnservedCard({
  title,
  sub,
  labels = [],
  block,
  className,
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
  /** Retired (desk/usability §14.13): an unserved card shows no Advanced control. Kept so callers need not change. */
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
          {defineTerms(title)}
          {sub ? <span className="dk-card-sub"> {defineTerms(sub)}</span> : null}
        </h2>
        <div className="dk-card-badge">
          <NotServedBadge block={block} />
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
      </UnservedContext.Provider>
    </As>
  );
}

/** §1.7 (S-27): a block served awaiting whose reason begins "Awaiting refresh" is live but could not
 * be computed from the current data; every other awaiting block is not yet served. */
export function isAwaitingRefresh(block: Unavailable | null | undefined): boolean {
  return !!block && typeof block.reason === "string" && block.reason.startsWith("Awaiting refresh");
}

/** The badge of a block served awaiting (§1.6, §1.7), gray: "○ Awaiting refresh" when its reason begins
 * "Awaiting refresh", else "○ Not yet served" (a card unavailable by §1.0 with no served block included). */
export function NotServedBadge({ block, boxed = false }: { block?: Unavailable | null; boxed?: boolean }) {
  const refresh = isAwaitingRefresh(block);
  return (
    <span className={cx("dk-live", "dk-live-off", boxed && "dk-live-boxed")} data-testid="dk-live" data-refresh={refresh || undefined}>
      <span className="dk-dot dk-dot-off" aria-hidden="true" />
      {refresh ? "Awaiting refresh" : "Not yet served"}
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
  const shownBadge = block ? <NotServedBadge block={block} /> : badge;
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
            {defineTerms(title)}
            {sub ? <span className="dk-card-sub"> {defineTerms(sub)}</span> : null}
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
  why,
}: {
  label: ReactNode;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  size?: "xl" | "lg" | "md" | "sm" | "date";
  /** No value served: the label stays, no number (§1.7). */
  awaiting?: boolean;
  /** The served reason an awaiting value is not computed, printed under "Awaiting refresh" (desk/fill-etf). */
  why?: ReactNode;
}) {
  const unserved = useUnserved();
  const failed = useContext(FailedContext) !== null && awaiting;
  return (
    <div className="dk-stat" data-size={size}>
      <div className="dk-stat-label">{defineTerms(label)}</div>
      {unserved || failed ? (
        // §1.0.2: the label stays, no number; the card prints the reason once.
        <div className="dk-stat-await" aria-hidden="true">
          —
        </div>
      ) : awaiting ? (
        <>
          <div className="dk-stat-await">Awaiting refresh</div>
          {why ? <div className="dk-stat-sub">{why}</div> : null}
        </>
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
  // §1.4 as amended by desk/usability §14.13: shown only when what it opens is served; a control that
  // would open nothing is not shown (it was a disabled "Advanced ▸ not yet served").
  const unserved = useUnserved();
  if (unserved || !served) return null;
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
 * not serve yet. `enabled` marks one that opens something real (a served
 * endpoint, or controls this browser holds, §1.0's local basket editing);
 * without it nothing is shown (desk/usability §14.13: no control that does
 * nothing, and no expander that opens onto nothing). */
export function AdvancedPanel({ adv, items, missing, children, enabled = false }: { adv: { open: boolean; toggle: () => void; id: string }; items: string; missing?: string; children?: ReactNode; enabled?: boolean }) {
  const unserved = useUnserved();
  return (
    <>
      <Advanced items={items} open={adv.open} onToggle={adv.toggle} controls={adv.id} served={enabled && children != null && children !== false} />
      {adv.open && !unserved && enabled && children != null && children !== false ? (
        <div className="dk-adv-panel" id={adv.id}>
          {children}
          {missing ? <p className="dk-adv-missing">{missing}</p> : null}
        </div>
      ) : null}
    </>
  );
}

// ── A request that failed (desk/usability §14.12) ─────────────────────────
// A card whose own request did not come back usable (no answer, a 5xx, an
// unreadable answer, a refusal) says "Couldn't load · Retry" once, where it
// would say "Loading live data…"; its labels stay with no number, and cards
// fed by other requests render as usual. An answer served awaiting (§1.0.2)
// is not a failure: the <Unserved> scope prints its reason instead.

interface FailedValue {
  /** Ask again; null for a refusal (4xx), which asking again would not change. */
  retry: (() => void) | null;
  fetching: boolean;
  /** The served words of a refusal. */
  reason: string | null;
}
const FailedContext = createContext<FailedValue | null>(null);

interface QueryLike {
  isError: boolean;
  error: unknown;
  isFetching?: boolean;
  refetch?: () => unknown;
}

/** The request failed, and not because its answer is served awaiting. */
export function loadFailed(q: Pick<QueryLike, "isError" | "error">): boolean {
  return q.isError && !unavailableOf(q.error);
}

/** The Desk's own refusals, whose served sentence says why (§12.0, the provider layer's typed errors). */
const SAID_REFUSALS = new Set(["unsupported", "unknown_symbol", "empty"]);

/** The cards inside read `q`: when it failed, each says so once, with Retry. */
export function FailedScope({ q, children }: { q: QueryLike; children: ReactNode }) {
  const err = q.error instanceof DeskApiError ? q.error : null;
  // A 4xx is an answer asking again would not change (a 408 or 429 would): no Retry. Only the Desk's own
  // refusals print their words; a framework's ("Unprocessable Entity") is not an MD's.
  const refused = !!err && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429;
  const said = refused && typeof err.body?.error === "string" && SAID_REFUSALS.has(err.body.error);
  const value: FailedValue | null = loadFailed(q)
    ? { retry: refused || !q.refetch ? null : () => void q.refetch?.(), fetching: !!q.isFetching, reason: said ? err.message : null }
    : null;
  return <FailedContext.Provider value={value}>{children}</FailedContext.Provider>;
}

export function useLoadFailed(): boolean {
  return useContext(FailedContext) !== null;
}

/** One scope for a card that reads several requests: failed when any failed; Retry asks each failed one again. */
export function eitherFailed(...qs: QueryLike[]): QueryLike {
  const bad = qs.filter(loadFailed);
  return { isError: bad.length > 0, error: bad[0]?.error ?? null, isFetching: bad.some((q) => q.isFetching), refetch: () => bad.forEach((q) => q.refetch?.()) };
}

/** The failed line of the enclosing scope ("Couldn't load · Retry"); nothing outside one. `inline` sits in a line of text. */
export function FailedLine({ inline = false, className }: { inline?: boolean; className?: string }) {
  const f = useContext(FailedContext);
  if (!f) return null;
  if (f.fetching) return <LoadingText inline={inline} className={className} />;
  const Tag = inline ? "span" : "p";
  return (
    <Tag className={cx("dk-failed", className)} role="status" data-testid="dk-failed">
      {f.reason ? `Couldn't load: ${f.reason}` : "Couldn't load"}
      {f.retry ? (
        <>
          {" · "}
          <button type="button" className="dk-link" onClick={f.retry}>
            Retry
          </button>
        </>
      ) : null}
    </Tag>
  );
}

function LoadingText({ inline = false, className }: { inline?: boolean; className?: string }) {
  const Tag = inline ? "span" : "p";
  return (
    <Tag className={cx("dk-loading", className)} role="status" aria-live="polite" data-testid="dk-loading">
      Loading live data…
    </Tag>
  );
}

/** desk/usability §14.10: while a card's request is pending it says so, one line under its title, so a cold
 * start reads as loading, never as a blank card; §14.12: when it failed, the same line says "Couldn't load ·
 * Retry". Nothing when the answer is in, or is served awaiting. */
export function LoadingLine({ busy }: { busy?: boolean | null }) {
  const failed = useContext(FailedContext);
  if (failed) return <FailedLine />;
  if (!busy) return null;
  return <LoadingText />;
}

/** A card body with nothing served (§1.7): gray words, no number. */
export function Awaiting({ children, className }: { children?: ReactNode; className?: string }) {
  const ctx = useContext(UnservedContext);
  const failed = useContext(FailedContext);
  if (ctx) return ctx.once ? null : <UnservedLine block={ctx.block} className={className} />;
  // §14.12: nothing is awaiting a refresh when the request failed; the card's line says so once.
  if (failed) return null;
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
