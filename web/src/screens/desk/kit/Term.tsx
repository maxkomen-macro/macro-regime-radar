/**
 * Hover definitions (desk/usability item 11, DESK_FRAME3_SPEC §14.11). A label,
 * card head or column head that prints a term of art is wrapped whole in one
 * <abbr class="dk-term">, dotted underline, carrying the term's sentence from
 * kit/glossary.ts; the label keeps one text node, so it reads and matches as
 * before. One tooltip per Desk (TermTip, mounted by DeskShell) shows the
 * sentence on hover or focus, fixed to the viewport so no card clips it; the
 * same sentences sit in a hidden list the terms point at with aria-describedby.
 *
 * desk/pdf-polish item 7: a term is a Tab stop of its own, so the keyboard
 * reaches every definition (a term inside a control, a link, a button or a
 * focusable row, is not: the control takes the focus), and a tap shows the
 * sentence on a touch screen until a tap elsewhere, a focus change or Escape.
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
  left: number;
  top: number;
  above: boolean;
}

const TIP_W = 300;

/** The Desk's one definition tooltip, plus the hidden sentences the terms describe themselves by. */
export function TermTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  // The written sentences' hidden entries follow the terms that show them.
  useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    let current: Element | null = null;
    const show = (el: Element) => {
      const text = el.getAttribute("data-def");
      if (!text) return;
      current = el;
      const r = el.getBoundingClientRect();
      const vw = window.innerWidth || document.documentElement.clientWidth;
      const vh = window.innerHeight || document.documentElement.clientHeight;
      const left = Math.max(8, Math.min(r.left, vw - Math.min(TIP_W, vw - 16) - 8));
      const above = r.bottom + 120 > vh && r.top > 120;
      setTip({ text, left, top: above ? r.top - 6 : r.bottom + 6, above });
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    const over = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(".dk-term");
      if (el && el !== current) show(el);
    };
    const out = (e: Event) => {
      // A finger lifting off the screen fires pointerout: a tapped term keeps its sentence until a tap elsewhere,
      // a focus change or Escape (desk/pdf-polish item 7).
      if ((e as PointerEvent).pointerType === "touch") return;
      const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
      if (current && !(to && current.contains(to))) hide();
    };
    // A tap (or a click) on a term shows its sentence; anywhere else, it hides the one showing.
    const down = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.(".dk-term");
      if (el) {
        if (el !== current) show(el);
      } else if (current) hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    // A scroll moves the tip with its term, and hides it once the term leaves the window (a scroll that lands just
    // after the pointer reached a term would otherwise wipe the tip while the pointer is still on it).
    const scroll = () => {
      if (!current) return;
      const r = current.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (!current.isConnected || r.bottom < 0 || r.top > vh) return hide();
      show(current);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", down);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
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
        <div role="tooltip" className="dk-term-tip" data-testid="dk-term-tip" data-above={tip.above || undefined} style={{ left: tip.left, top: tip.top, maxWidth: TIP_W }}>
          {tip.text.split("\n").map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}
