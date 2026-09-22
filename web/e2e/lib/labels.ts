/**
 * Visible label extraction for the label-parity guarantee (PARITY_MANIFEST.md
 * "Automated guarantees" #3). Collects headings, tab names, control labels,
 * table headers, nav links and uppercase eyebrows, each tagged with the nearest
 * ancestor id (the section scope) so ignore/rename rules can be scoped.
 */
import type { Page } from "@playwright/test";

export interface LabelRec {
  text: string;
  norm: string;
  kind: string;
  scope: string | null;
  state: string;
}

/** Lowercase, collapse whitespace, digits → "#", so data-bearing labels compare stably.
 * Leading decorative glyphs (disclosure carets, status dots, marks) are dropped: they are
 * decoration, and a restyle may change the glyph or the space after it without changing
 * the label (Phase 2 Disclosure restyle, 2026-09-15). */
export function normalizeLabel(s: string): string {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[▸▾▪●◆✓×›◂▹•·]+\s*/u, "")
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)*/g, "#");
}

export async function extractLabels(page: Page, state: string): Promise<LabelRec[]> {
  const raw = await page.evaluate(() => {
    const out: { text: string; kind: string; scope: string | null }[] = [];
    const seen = new Set<string>();
    const clean = (s: string) => s.replace(/\s+/g, " ").trim();
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return false;
      if (el.closest("[hidden], [aria-hidden='true']")) return false;
      return true;
    };
    const scopeOf = (el: Element): string | null => {
      let n: Element | null = el;
      while (n) {
        if (n.id && !n.id.includes(":") && !/^r\w*-|panel$|-tab-/.test(n.id)) return n.id;
        n = n.parentElement;
      }
      return null;
    };
    const push = (el: Element, kind: string, text?: string) => {
      const t = clean(text ?? ((el as HTMLElement).innerText || el.textContent || ""));
      if (!t || t.length > 160) return;
      const key = `${kind}|${t}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ text: t, kind, scope: scopeOf(el) });
    };
    document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => visible(el) && push(el, el.tagName.toLowerCase()));
    document.querySelectorAll("[role='tab']").forEach((el) => visible(el) && push(el, "tab"));
    document.querySelectorAll("button, [role='button']").forEach((el) => {
      if (!visible(el)) return;
      const txt = clean((el as HTMLElement).innerText || "");
      // Jargon terms are definition affordances (span.jargon), not control labels.
      const kind = el.classList.contains("jargon") ? "jargon" : "button";
      push(el, kind, txt || el.getAttribute("aria-label") || "");
    });
    document.querySelectorAll("nav a, a[href]").forEach((el) => {
      if (!visible(el)) return;
      const txt = clean((el as HTMLElement).innerText || "");
      if (txt) push(el, "link", txt);
    });
    document.querySelectorAll("label, legend, summary, th, dt").forEach((el) => visible(el) && push(el, el.tagName.toLowerCase()));
    document
      .querySelectorAll("input[aria-label], select[aria-label], textarea[aria-label], [role='slider'][aria-label], [role='switch'][aria-label]")
      .forEach((el) => push(el, "control", el.getAttribute("aria-label") || ""));
    // Uppercase eyebrows / micro labels (inline-styled; no shared class today).
    document.body.querySelectorAll("span, div, p, small, dd, td").forEach((el) => {
      if (!visible(el)) return;
      if (getComputedStyle(el).textTransform !== "uppercase") return;
      if (el.querySelector("h1,h2,h3,h4,button,[role='tab'],table")) return;
      const t = clean((el as HTMLElement).innerText || "");
      if (!t || t.length > 60) return;
      push(el, "eyebrow", t);
    });
    return out;
  });
  return raw.map((r) => ({ ...r, norm: normalizeLabel(r.text), state }));
}
