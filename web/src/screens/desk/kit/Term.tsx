/**
 * Hover definitions (desk/usability item 11, DESK_FRAME3_SPEC §14.11). A label,
 * card head or column head that prints a term of art is wrapped whole in one
 * <abbr class="dk-term">, dotted underline, carrying the term's sentence from
 * kit/glossary.ts; the label keeps one text node, so it reads and matches as
 * before. One tooltip per Desk (TermTip, mounted by DeskShell) shows the
 * sentence on hover or focus, fixed to the viewport so no card clips it; the
 * same sentences sit in a hidden list the terms point at with aria-describedby.
 * The tooltip is measured and placed inside the window, its height clamped to
 * the room beside its term and the rest scrolled (Codex R-11).
 *
 * desk/pdf-polish item 7: a term is a Tab stop of its own, so the keyboard
 * reaches every definition (a term inside a control, a link, a button or a
 * focusable row, is not: the control takes the focus), and a tap shows the
 * sentence on a touch screen until a tap elsewhere, a focus change or Escape.
 * A tap on a term inside a control shows the sentence and goes no further:
 * the row around it is not opened (Codex R-10).
 * A page may also write a definition from its data (`def`: a month, a
 * target's name); while a term shows it, it joins the hidden list too.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { GLOSSARY, splitTerms } from "./glossary";

const defId = (id: string) => `dk-def-${id}`;

/** The glossary ids a text prints, in order. */
export function termsIn(text: string): string[] {
  return splitTerms(text)
    .map((s) => s.term)
    .filter((t): t is string => !!t);
}

// ── Definitions a page writes from its data (desk/pdf-polish) ─────────────
// One hidden entry per distinct sentence while at least one term shows it.
const written = new Map<string, { text: string; users: number }>();
const listeners = new Set<() => void>();
let writtenStamp = 0;
const changed = () => {
  writtenStamp += 1;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const snapshot = () => writtenStamp;

/** The hidden entry's id for a written sentence: the same sentence, the same id. */
export function writtenId(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 33) + text.charCodeAt(i)) | 0;
  return `dk-def-w${(h >>> 0).toString(36)}`;
}

function useWritten(text: string | undefined): string | undefined {
  const id = text ? writtenId(text) : undefined;
  useEffect(() => {
    if (!id || !text) return;
    const had = written.get(id);
    written.set(id, { text, users: (had?.users ?? 0) + 1 });
    changed();
    return () => {
      const w = written.get(id);
      if (!w) return;
      if (w.users > 1) w.users -= 1;
      else written.delete(id);
      changed();
    };
  }, [id, text]);
  return id;
}

/** A control already takes the focus, and its own name carries the term (a focusable scroll region is not a
 * control: a term in a table that scrolls stays a Tab stop). */
const CONTROL = "a[href], button, summary, label, select, textarea, input, [role='button'], [role='link'], [role='tab'], [role='option'], [tabindex]:not([tabindex^='-']):not([role='region']):not(.dk-term)";

export function Term({ ids = [], def, children }: { ids?: readonly string[]; def?: string; children: ReactNode }) {
  const known = ids.filter((id) => GLOSSARY[id]);
  const own = useWritten(def || undefined);
  const ref = useRef<HTMLElement>(null);
  const [inControl, setInControl] = useState(false);
  useLayoutEffect(() => {
    setInControl(!!ref.current?.parentElement?.closest(CONTROL));
  });
  if (!known.length && !def) return <>{children}</>;
  const texts = [...known.map((id) => GLOSSARY[id].text), ...(def ? [def] : [])];
  const described = [...known.map(defId), ...(own ? [own] : [])];
  return (
    <abbr ref={ref} className="dk-term" tabIndex={inControl ? undefined : 0} data-term={[...known, ...(def ? ["written"] : [])].join(" ")} data-def={texts.join("\n")} aria-describedby={described.join(" ")}>
      {children}
    </abbr>
  );
}

/** A printed string with its terms defined; anything else is returned as it is. */
export function defineTerms(node: ReactNode): ReactNode {
  if (typeof node !== "string") return node;
  const ids = termsIn(node);
  return ids.length ? <Term ids={ids}>{node}</Term> : node;
}

interface Tip {
  text: string;
  /** The box of what shows it (a term, or a control holding terms), in window pixels. */
  anchor: { left: number; top: number; bottom: number };
}

/** Where the tip sits once measured: its box's left and top, the most height it may take, and which side it is on. */
export interface TipPlace {
  left: number;
  top: number;
  maxHeight: number;
  above: boolean;
}

const TIP_W = 300;
/** The tip keeps this far from every edge of the window. */
export const TIP_MARGIN = 8;
/** The gap between a term and its tip. */
const TIP_GAP = 6;
/** With less room than this on both sides of its term, the tip takes the window's whole height, over the term. */
const TIP_MIN_ROOM = 96;

const viewport = () => ({
  width: window.innerWidth || document.documentElement.clientWidth,
  height: window.innerHeight || document.documentElement.clientHeight,
});

/** The widest the tip may be in this window: 300 px, less on a phone. */
const tipWidth = (vw: number) => Math.max(0, Math.min(TIP_W, vw - 2 * TIP_MARGIN));

/**
 * Codex R-11: the tip, measured at its natural `size`, placed in the window `view`: under its term when it fits
 * there, else over it, else on the roomier side with its height clamped to that side (the rest scrolls). It never
 * passes an edge, so a phone's 390 px window shows it whole or scrolls it.
 */
export function placeTip(anchor: Tip["anchor"], size: { width: number; height: number }, view: { width: number; height: number }): TipPlace {
  const m = TIP_MARGIN;
  const left = Math.max(m, Math.min(anchor.left, view.width - size.width - m));
  const below = view.height - m - (anchor.bottom + TIP_GAP);
  const above = anchor.top - TIP_GAP - m;
  if (size.height <= below) return { left, top: anchor.bottom + TIP_GAP, maxHeight: below, above: false };
  if (size.height <= above) return { left, top: anchor.top - TIP_GAP - size.height, maxHeight: above, above: true };
  if (Math.max(below, above) < TIP_MIN_ROOM) return { left, top: m, maxHeight: Math.max(0, view.height - 2 * m), above: false };
  return below >= above ? { left, top: anchor.bottom + TIP_GAP, maxHeight: below, above: false } : { left, top: m, maxHeight: above, above: true };
}

/** The Desk's one definition tooltip, plus the hidden sentences the terms describe themselves by. */
export function TermTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  // Codex R-11: null while the tip is measured (hidden, unclamped, and at the left margin, so its width is its sentences'
  // own up to the cap, never the strip left of a term near the right edge), then where it goes.
  const [place, setPlace] = useState<(TipPlace & { bodyMax: number }) | null>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tipRef.current;
    const body = el?.firstElementChild;
    if (!tip || !el || !body || place) return;
    const box = el.getBoundingClientRect();
    // The tip's padding and border: what its clamped height keeps besides the sentences.
    const chrome = box.height - body.getBoundingClientRect().height;
    const at = placeTip(tip.anchor, { width: box.width, height: box.height }, viewport());
    setPlace({ ...at, bodyMax: Math.max(0, at.maxHeight - chrome) });
  }, [tip, place]);
  // The written sentences' hidden entries follow the terms that show them.
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    let current: Element | null = null;
    // The sentences on show: a term's own, or those a focused control holds.
    let shown = "";
    // Codex R-10: the term a touch or pen pointer last went down on, so the click that follows shows its sentence only.
    let tapped: Element | null = null;
    const show = (el: Element, own?: string) => {
      const text = own ?? el.getAttribute("data-def");
      if (!text) return;
      current = el;
      shown = text;
      const r = el.getBoundingClientRect();
      // Measured, then placed (Codex R-11).
      setPlace(null);
      setTip({ text, anchor: { left: r.left, top: r.top, bottom: r.bottom } });
    };
    const hide = () => {
      current = null;
      setTip(null);
      setPlace(null);
    };
    /** Inside the tip: the pointer on its way in or scrolling it keeps it (Codex R-11). */
    const inTip = (n: EventTarget | null) => n instanceof Node && !!tipRef.current?.contains(n);
    const over = (e: Event) => {
      const target = e.target as Element | null;
      const el = target?.closest?.(".dk-term");
      if (el) {
        if (el !== current) show(el);
        return;
      }
      // desk/pdf-polish 7: a control that holds terms (a monitored row, a Ledger row) shows their sentences when it
      // takes the focus, as a pointer shows them over the terms themselves.
      if (e.type !== "focusin" || !target || target === current || typeof target.matches !== "function" || !target.matches(CONTROL)) return;
      // The control that holds the term just shown (a tapped one) keeps that term's sentence (Codex R-10).
      if (current && target.contains(current)) return;
      const held = [...new Set([...target.querySelectorAll(".dk-term")].flatMap((t) => (t.getAttribute("data-def") ?? "").split("\n")).filter(Boolean))];
      if (held.length) show(target, held.join("\n"));
    };
    const out = (e: Event) => {
      // A finger lifting off the screen fires pointerout: a tapped term keeps its sentence until a tap elsewhere,
      // a focus change or Escape (desk/pdf-polish item 7).
      if ((e as PointerEvent).pointerType === "touch") return;
      const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
      if (inTip(to)) return;
      if (current && !(to && current.contains(to))) hide();
    };
    // A tap (or a click) on a term shows its sentence; anywhere else, it hides the one showing.
    const down = (e: Event) => {
      if (inTip(e.target)) return;
      const el = (e.target as Element | null)?.closest?.(".dk-term") ?? null;
      const type = (e as PointerEvent).pointerType;
      tapped = el && (type === "touch" || type === "pen") ? el : null;
      if (el) {
        if (el !== current) show(el);
      } else if (current) hide();
    };
    // Codex R-10: the click a tap on a term inside a control (a Ledger row, a monitored position, a label) makes is
    // stopped before the control sees it, so the tap shows the sentence and opens nothing. A mouse, which shows the
    // sentence on hover, still clicks through; so do the keyboard and a tap anywhere else in the row.
    const click = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(".dk-term");
      if (!el || el !== tapped) return;
      tapped = null;
      if (!el.parentElement?.closest(CONTROL)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // A scroll moves the tip with its term, and hides it once the term leaves the window (a scroll that lands just
    // after the pointer reached a term would otherwise wipe the tip while the pointer is still on it). Codex R-14: so
    // does a change of the window's size (a resized window, a turned phone): the tip is measured and placed again.
    const follow = (e: Event) => {
      if (!current || inTip(e.target)) return;
      const r = current.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (!current.isConnected || r.bottom < 0 || r.top > vh) return hide();
      show(current, shown);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down);
    document.addEventListener("click", click, true);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("click", click, true);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, []);
  return (
    <>
      <div hidden>
        {Object.entries(GLOSSARY).map(([id, t]) => (
          <span key={id} id={defId(id)}>
            {t.text}
          </span>
        ))}
        {[...written].map(([id, w]) => (
          <span key={id} id={id}>
            {w.text}
          </span>
        ))}
      </div>
      {tip ? (
        <div
          ref={tipRef}
          role="tooltip"
          className="dk-term-tip"
          data-testid="dk-term-tip"
          data-above={place?.above || undefined}
          style={place ? { left: place.left, top: place.top, maxWidth: tipWidth(viewport().width) } : { left: TIP_MARGIN, top: 0, maxWidth: tipWidth(viewport().width), visibility: "hidden" }}
        >
          <div className="dk-term-tip-body" style={place ? { maxHeight: place.bodyMax } : undefined}>
            {tip.text.split("\n").map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
