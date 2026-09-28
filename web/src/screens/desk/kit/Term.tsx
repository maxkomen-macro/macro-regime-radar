/**
 * Hover definitions (desk/usability item 11, DESK_FRAME3_SPEC §14.11). A label,
 * card head or column head that prints a term of art is wrapped whole in one
 * <abbr class="dk-term">, dotted underline, carrying the term's sentence from
 * kit/glossary.ts; the label keeps one text node, so it reads and matches as
 * before. One tooltip per Desk (TermTip, mounted by DeskShell) shows the
 * sentence on hover or focus, fixed to the viewport so no card clips it; the
 * same sentences sit in a hidden list the terms point at with aria-describedby.
 */
import { useEffect, useState, type ReactNode } from "react";
import { GLOSSARY, splitTerms } from "./glossary";

const defId = (id: string) => `dk-def-${id}`;

/** The glossary ids a text prints, in order. */
export function termsIn(text: string): string[] {
  return splitTerms(text)
    .map((s) => s.term)
    .filter((t): t is string => !!t);
}

export function Term({ ids, children }: { ids: readonly string[]; children: ReactNode }) {
  const known = ids.filter((id) => GLOSSARY[id]);
  if (!known.length) return <>{children}</>;
  return (
    <abbr className="dk-term" data-term={known.join(" ")} data-def={known.map((id) => GLOSSARY[id].text).join("\n")} aria-describedby={known.map(defId).join(" ")}>
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
      const to = (e as PointerEvent | FocusEvent).relatedTarget as Node | null;
      if (current && !(to && current.contains(to))) hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", out);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", out);
      document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", hide, true);
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
