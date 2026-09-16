/**
 * Hand-rolled accessibility audit for Phase 10 (docs/redesign-v2/checklists/
 * 10-states-a11y.md, B.3, B.4, B.5, B.6; no axe-core in web/package.json).
 *
 * Every `audit*` function below runs INSIDE the page through `page.evaluate`
 * and is therefore self-contained: no closure over anything at module scope,
 * every helper is defined inside the function body. They return plain JSON.
 * `tabWalk` is the one Node-side helper: it presses Tab and records the
 * active element with its computed focus ring at every stop (B.4 #1).
 */
import type { Page } from "@playwright/test";

/* ── B.3 #1: overflow ────────────────────────────────────────────────────── */

export interface OverflowOffender {
  sel: string;
  right: number;
  width: number;
}
export interface OverflowReport {
  scrollWidth: number;
  innerWidth: number;
  /** Elements past the viewport's right edge that no ancestor clips or scrolls. */
  offenders: OverflowOffender[];
}

/** `documentElement.scrollWidth` versus the viewport, and the elements past its
 * right edge outside a `[data-scrollable="true"]` well or any ancestor whose
 * computed overflow-x is auto, scroll or hidden (the verifier's rule). */
export function auditOverflow(): OverflowReport {
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
    const scope = el.parentElement?.closest("[id]")?.id;
    const text = ((el as HTMLElement).innerText || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${cls}${scope ? ` in #${scope}` : ""}${text ? ` "${text}"` : ""}`;
  };
  const clipped = (el: Element): boolean => {
    let n: Element | null = el.parentElement;
    while (n && n !== document.documentElement) {
      if (n.getAttribute("data-scrollable") === "true") return true;
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      n = n.parentElement;
    }
    return false;
  };
  const innerWidth = window.innerWidth;
  const offenders: OverflowOffender[] = [];
  const all = document.body.querySelectorAll<HTMLElement>("*");
  for (const el of Array.from(all)) {
    if (el.closest("[hidden], [aria-hidden='true'], script, style")) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.right <= innerWidth + 1) continue;
    const cs = getComputedStyle(el);
    if (cs.position === "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    if (clipped(el)) continue;
    offenders.push({ sel: describe(el), right: Math.round(r.right), width: Math.round(r.width) });
    if (offenders.length >= 20) break;
  }
  return { scrollWidth: document.documentElement.scrollWidth, innerWidth, offenders };
}

/* ── B.3 #2 and #3: headings ─────────────────────────────────────────────── */

export interface HeadingRec {
  level: number;
  text: string;
  inMain: boolean;
}
export interface HeadingViolation {
  level: number;
  prev: number;
  text: string;
  where: string;
}
export interface HeadingReport {
  h1Total: number;
  h1InMain: number;
  /** Headings inside <main>, in DOM order, hidden / aria-hidden subtrees and open dialogs skipped. */
  main: HeadingRec[];
  /** A level rising by more than one along the main order (h1→h3), or a first heading that is not h1. */
  violations: HeadingViolation[];
  /** Each open dialog audited on its own, under the page h1. */
  dialogs: { label: string; headings: HeadingRec[]; violations: HeadingViolation[] }[];
}

export function auditHeadings(): HeadingReport {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80);
  const level = (el: Element) => Number(el.tagName.slice(1));
  const skipped = (el: Element) => Boolean(el.closest("[hidden], [aria-hidden='true']"));
  const walk = (root: ParentNode, inMainFn: (el: Element) => boolean, excludeDialogs: boolean): HeadingRec[] => {
    const out: HeadingRec[] = [];
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
      if (skipped(el)) return;
      if (excludeDialogs && el.closest("[role='dialog']")) return;
      out.push({ level: level(el), text: clean((el as HTMLElement).innerText || el.textContent || ""), inMain: inMainFn(el) });
    });
    return out;
  };
  const monotone = (list: HeadingRec[], start: number, where: string): HeadingViolation[] => {
    const v: HeadingViolation[] = [];
    let prev = start;
    for (const h of list) {
      if (h.level > prev + 1) v.push({ level: h.level, prev, text: h.text, where });
      prev = h.level;
    }
    return v;
  };
  const main = document.querySelector("main");
  const all = Array.from(document.querySelectorAll("h1")).filter((el) => !skipped(el));
  const mainList = main ? walk(main, () => true, true) : [];
  const dialogs = Array.from(document.querySelectorAll("[role='dialog']")).map((d) => {
    const list = walk(d, () => false, false);
    const label = d.getAttribute("aria-label") ?? (d.getAttribute("aria-labelledby") ? document.getElementById(d.getAttribute("aria-labelledby") as string)?.textContent ?? "" : "") ?? "";
    return { label: clean(label), headings: list, violations: monotone(list, 1, `dialog:${clean(label)}`) };
  });
  return {
    h1Total: all.length,
    h1InMain: all.filter((el) => main?.contains(el)).length,
    main: mainList,
    violations: monotone(mainList, 0, "main"),
    dialogs,
  };
}

/* ── B.3 #7: landmarks and title ─────────────────────────────────────────── */

export interface LandmarkReport {
  header: number;
  primaryNav: number;
  strip: number;
  main: number;
  sidebar: number;
  contentinfo: number;
  title: string;
  skipLinkFirst: boolean;
}

/** Counts the shell landmarks; `skipLinkFirst` reads the first tabbable in DOM order. */
export function auditLandmarks(): LandmarkReport {
  const first = document.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
  return {
    header: document.querySelectorAll("header").length,
    primaryNav: document.querySelectorAll("nav[aria-label='Primary']").length,
    strip: document.querySelectorAll("[role='region'][aria-label='Market strip and data freshness']").length,
    main: document.querySelectorAll("main#main-content").length,
    sidebar: document.querySelectorAll("aside[aria-label='Sidebar']").length,
    contentinfo: document.querySelectorAll("footer, [role='contentinfo']").length,
    title: document.title,
    skipLinkFirst: Boolean(first && first.classList.contains("mrr-skip")),
  };
}

/* ── B.6 #2: accessible names ────────────────────────────────────────────── */

export interface FocusableRec {
  tag: string;
  role: string | null;
  id: string;
  className: string;
  text: string;
  tabindex: string | null;
}
export interface FocusableReport {
  total: number;
  nameless: FocusableRec[];
  positiveTabindex: FocusableRec[];
  /** Elements with an inline `outline: none` (or 0); G8 whitelists main#main-content. */
  inlineOutlineNone: FocusableRec[];
}

export function auditFocusables(): FocusableReport {
  const SELECTOR = "a[href], button, [role='button'], [role='tab'], [role='option'], input, select, textarea, [tabindex]:not([tabindex='-1'])";
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const rec = (el: Element): FocusableRec => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    id: el.id,
    className: typeof el.className === "string" ? el.className.slice(0, 60) : "",
    text: clean((el as HTMLElement).innerText || el.textContent || "").slice(0, 60),
    tabindex: el.getAttribute("tabindex"),
  });
  const visible = (el: Element) => {
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  // Text content the way a name is computed from it: aria-hidden and hidden
  // subtrees skipped (the disclosure's decorative glyph, the sr-only twin excluded).
  const textOf = (root: Element): string => {
    let out = "";
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? "";
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const e = n as HTMLElement;
      if (e.getAttribute("aria-hidden") === "true" || e.hasAttribute("hidden")) return;
      if (getComputedStyle(e).display === "none") return;
      e.childNodes.forEach(walk);
      if (/^(?:BR|P|DIV|LI|TR|H[1-6])$/.test(e.tagName)) out += " ";
    };
    walk(root);
    return clean(out);
  };
  const nameOf = (el: Element): string => {
    const byIds = el.getAttribute("aria-labelledby");
    if (byIds) {
      const t = byIds
        .split(/\s+/)
        .map((id) => {
          const target = document.getElementById(id);
          return target ? textOf(target) : "";
        })
        .join(" ");
      if (clean(t)) return clean(t);
    }
    const label = el.getAttribute("aria-label");
    if (label && clean(label)) return clean(label);
    const inner = textOf(el);
    if (inner) return inner;
    const title = el.getAttribute("title");
    if (title && clean(title)) return clean(title);
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const t = clean(lab?.textContent ?? "");
      if (t) return t;
    }
    const wrap = el.closest("label");
    if (wrap) return clean(wrap.textContent ?? "");
    return "";
  };
  const nameless: FocusableRec[] = [];
  let total = 0;
  document.querySelectorAll(SELECTOR).forEach((el) => {
    if (!visible(el)) return;
    total += 1;
    if (!nameOf(el)) nameless.push(rec(el));
  });
  const positiveTabindex: FocusableRec[] = [];
  document.querySelectorAll("[tabindex]").forEach((el) => {
    if (Number(el.getAttribute("tabindex")) > 0) positiveTabindex.push(rec(el));
  });
  const inlineOutlineNone: FocusableRec[] = [];
  document.querySelectorAll<HTMLElement>("[style*='outline']").forEach((el) => {
    const o = `${el.style.outline} ${el.style.outlineStyle} ${el.style.outlineWidth}`.trim();
    if (/\bnone\b|(^|\s)0(px)?(\s|$)/.test(o)) inlineOutlineNone.push(rec(el));
  });
  return { total, nameless, positiveTabindex, inlineOutlineNone };
}

/* ── B.6 #3: references, tablists, pressed groups ────────────────────────── */

export interface RefRec {
  attr: string;
  id: string;
  tag: string;
  role: string | null;
  /** True for aria-controls on an unselected tab whose panel is not mounted (SubTabs renders one panel). */
  inactiveTab: boolean;
  /** True for aria-controls on a closed controller (aria-expanded="false", or an
   * unselected tab): the target mounts on open (dialogs, the chart panel, the
   * search listbox, SubTabs panels), so the reference is deferred, not broken. */
  deferred: boolean;
}
export interface TablistRec {
  label: string | null;
  tabs: number;
  selected: number;
  panelResolves: boolean;
  panelRole: string | null;
  labelsByHint: string[];
}
export interface PressedGroupRec {
  label: string | null;
  options: number;
  pressed: number;
}
export interface RefReport {
  unresolved: RefRec[];
  popupsOpenWithoutDialog: number;
  tablists: TablistRec[];
  pressedGroups: PressedGroupRec[];
}

export function auditRefs(): RefReport {
  const unresolved: RefRec[] = [];
  const attrs = ["aria-controls", "aria-labelledby", "aria-describedby", "aria-activedescendant"];
  for (const attr of attrs) {
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      const ids = (el.getAttribute(attr) ?? "").split(/\s+/).filter(Boolean);
      for (const id of ids) {
        if (document.getElementById(id)) continue;
        const inactiveTab = attr === "aria-controls" && el.getAttribute("role") === "tab" && el.getAttribute("aria-selected") !== "true";
        const closed = el.getAttribute("aria-expanded") === "false" || (el.getAttribute("role") === "combobox" && el.getAttribute("aria-expanded") !== "true");
        unresolved.push({
          attr,
          id,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          inactiveTab,
          deferred: attr === "aria-controls" && (inactiveTab || closed),
        });
      }
    });
  }
  let popupsOpenWithoutDialog = 0;
  document.querySelectorAll("[aria-haspopup='dialog'][aria-expanded='true']").forEach(() => {
    if (!document.querySelector("[role='dialog']")) popupsOpenWithoutDialog += 1;
  });
  const tablists: TablistRec[] = [];
  document.querySelectorAll("[role='tablist']").forEach((list) => {
    const tabs = Array.from(list.querySelectorAll("[role='tab']"));
    const selected = tabs.filter((t) => t.getAttribute("aria-selected") === "true");
    const panelId = selected[0]?.getAttribute("aria-controls") ?? "";
    const panel = panelId ? document.getElementById(panelId) : null;
    tablists.push({
      label: list.getAttribute("aria-label"),
      tabs: tabs.length,
      selected: selected.length,
      panelResolves: Boolean(panel),
      panelRole: panel?.getAttribute("role") ?? null,
      labelsByHint: tabs.map((t) => t.getAttribute("aria-label") ?? ""),
    });
  });
  const pressedGroups: PressedGroupRec[] = [];
  document.querySelectorAll("[role='group']").forEach((g) => {
    const options = Array.from(g.querySelectorAll("[aria-pressed]"));
    if (!options.length) return;
    pressedGroups.push({ label: g.getAttribute("aria-label"), options: options.length, pressed: options.filter((o) => o.getAttribute("aria-pressed") === "true").length });
  });
  return { unresolved, popupsOpenWithoutDialog, tablists, pressedGroups };
}

/* ── B.6 #4 and #5: tables, grids, images, chart containers ──────────────── */

export interface TableRec {
  caption: boolean;
  ariaLabel: boolean;
  th: number;
  thScoped: number;
  rows: number;
}
export interface RoleTableRec {
  label: string | null;
  columnheaders: number;
  rowheaders: number;
}
export interface SvgRec {
  sel: string;
  hidden: boolean;
  role: string | null;
  label: string | null;
}
export interface CanvasRec {
  wrapped: boolean;
  wrapperLabel: string | null;
  tabIndex: number;
}
export interface MediaReport {
  tables: TableRec[];
  roleTables: RoleTableRec[];
  /** svg elements that are neither aria-hidden nor role=img with a label. */
  svgUnlabelled: SvgRec[];
  svgTotal: number;
  canvases: CanvasRec[];
  imgInMain: number;
  defects: string[];
}

export function auditMedia(): MediaReport {
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
    const parent = el.parentElement;
    const pid = parent?.closest("[id]")?.id;
    return `${el.tagName.toLowerCase()}${id}${cls}${pid ? ` in #${pid}` : ""}`;
  };
  const defects: string[] = [];
  const tables: TableRec[] = [];
  document.querySelectorAll("table").forEach((t) => {
    if (t.closest("[hidden]")) return;
    // Lightweight Charts lays its canvases out in a <table> inside the labelled role=img wrapper.
    if (t.closest("[role='img']")) return;
    const th = t.querySelectorAll("th");
    const rec = {
      caption: Boolean(t.querySelector("caption")),
      ariaLabel: Boolean(t.getAttribute("aria-label") || t.getAttribute("aria-labelledby")),
      th: th.length,
      thScoped: t.querySelectorAll("th[scope]").length,
      rows: t.querySelectorAll("tr").length,
    };
    tables.push(rec);
    if (!rec.caption && !rec.ariaLabel) defects.push(`table without caption or aria-label: ${describe(t)}`);
    if (rec.th && rec.thScoped < rec.th) defects.push(`table with ${rec.th - rec.thScoped} th lacking scope: ${describe(t)}`);
  });
  const roleTables: RoleTableRec[] = [];
  document.querySelectorAll("[role='table'], [role='grid']").forEach((t) => {
    if (t.closest("[hidden]")) return;
    const rec = {
      label: t.getAttribute("aria-label"),
      columnheaders: t.querySelectorAll("[role='columnheader']").length,
      rowheaders: t.querySelectorAll("[role='rowheader']").length,
    };
    roleTables.push(rec);
    if (!rec.label) defects.push(`role=table without aria-label: ${describe(t)}`);
    if (!rec.columnheaders) defects.push(`role=table without columnheaders: ${describe(t)}`);
  });
  const svgUnlabelled: SvgRec[] = [];
  let svgTotal = 0;
  document.querySelectorAll("svg").forEach((s) => {
    if (s.closest("[hidden]")) return;
    svgTotal += 1;
    const hidden = s.getAttribute("aria-hidden") === "true" || Boolean(s.parentElement?.closest("[aria-hidden='true']"));
    const role = s.getAttribute("role");
    const label = s.getAttribute("aria-label") ?? (s.getAttribute("aria-labelledby") ? "labelledby" : null);
    // An svg inside a named control (button, link) is presentational by context.
    const inNamedControl = Boolean(s.closest("button, a[href], [role='button'], [role='img']"));
    if (hidden || (role === "img" && label) || inNamedControl) return;
    svgUnlabelled.push({ sel: describe(s), hidden, role, label });
  });
  const canvases: CanvasRec[] = [];
  document.querySelectorAll("canvas").forEach((c) => {
    const wrapper = c.closest("[role='img']");
    canvases.push({ wrapped: Boolean(wrapper), wrapperLabel: wrapper?.getAttribute("aria-label") ?? null, tabIndex: (c as HTMLElement).tabIndex });
    if (!wrapper) defects.push(`canvas without a role=img wrapper: ${describe(c)}`);
  });
  const imgInMain = document.querySelectorAll("main img").length;
  if (imgInMain) defects.push(`${imgInMain} <img> inside main`);
  return { tables, roleTables, svgUnlabelled, svgTotal, canvases, imgInMain, defects };
}

/* ── B.6 #6 and #7: live regions and dialogs ─────────────────────────────── */

export interface LiveRegionRec {
  role: string | null;
  live: string | null;
  id: string;
  className: string;
  text: string;
  inTape: boolean;
}
export interface DialogRec {
  id: string;
  role: string;
  label: string | null;
  labelledbyResolves: boolean | null;
  modal: string | null;
  shellInert: boolean;
}
export interface LiveDialogReport {
  regions: LiveRegionRec[];
  tapeAnnouncers: number;
  dialogs: DialogRec[];
}

export function auditLiveAndDialogs(): LiveDialogReport {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 80);
  const regions: LiveRegionRec[] = [];
  document.querySelectorAll("[aria-live], [role='status'], [role='log'], [role='alert']").forEach((el) => {
    regions.push({
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
      id: el.id,
      className: typeof el.className === "string" ? el.className.slice(0, 60) : "",
      text: clean(el.textContent ?? ""),
      inTape: Boolean(el.closest("#watchlist")),
    });
  });
  const shell = document.getElementById("shell-content");
  const dialogs: DialogRec[] = [];
  document.querySelectorAll("[role='dialog']").forEach((d) => {
    const by = d.getAttribute("aria-labelledby");
    dialogs.push({
      id: d.id,
      role: "dialog",
      label: d.getAttribute("aria-label") ?? (by ? clean(document.getElementById(by)?.textContent ?? "") : null),
      labelledbyResolves: by ? Boolean(document.getElementById(by)) : null,
      modal: d.getAttribute("aria-modal"),
      shellInert: Boolean(shell?.hasAttribute("inert")),
    });
  });
  return { regions, tapeAnnouncers: regions.filter((r) => r.inTape).length, dialogs };
}

/* ── B.5: motion ─────────────────────────────────────────────────────────── */

export interface MotionReport {
  running: { name: string; target: string }[];
  animationNames: { sel: string; name: string }[];
  transitions: { sel: string; property: string; duration: string }[];
  canvasTabStops: number;
  pulseElements: number;
}

/** Running Web Animations, computed animation-name on the B.5 inventory, and
 * the computed transition on a GaugeBar fill, a link and a watchlist row. */
export function auditMotion(): MotionReport {
  const describe = (el: Element | null): string => {
    if (!el) return "?";
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };
  const running = document
    .getAnimations()
    .filter((a) => a.playState === "running")
    .map((a) => ({
      name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? a.id ?? "animation",
      target: describe((a.effect as KeyframeEffect | null)?.target as Element | null),
    }));
  const animationNames: { sel: string; name: string }[] = [];
  for (const sel of [".mrr-live-dot", ".mrr-hero-dot", "[style*='mrr-pulse']", ".mrr-caret", ".mrr-news-new", "[style*='mrr-flash']"]) {
    document.querySelectorAll(sel).forEach((el) => animationNames.push({ sel, name: getComputedStyle(el).animationName }));
  }
  const transitions: { sel: string; property: string; duration: string }[] = [];
  for (const sel of ["[style*='transition: transform'], [style*='transition:transform']", "a[href]", ".mrr-wl-row"]) {
    const el = document.querySelector(sel);
    if (el) {
      const cs = getComputedStyle(el);
      transitions.push({ sel, property: cs.transitionProperty, duration: cs.transitionDuration });
    }
  }
  let canvasTabStops = 0;
  document.querySelectorAll("canvas").forEach((c) => {
    if ((c as HTMLElement).tabIndex >= 0) canvasTabStops += 1;
  });
  const pulseElements = document.querySelectorAll(".mrr-live-dot, .mrr-hero-dot, [style*='mrr-pulse']").length;
  return { running, animationNames, transitions, canvasTabStops, pulseElements };
}

/* ── B.6 #8: contrast ────────────────────────────────────────────────────── */

export interface ContrastRow {
  group: string;
  sel: string;
  text: string;
  ratio: number;
  fg: string;
  bg: string;
  token: string;
  fontSize: number;
  bold: boolean;
  /** WCAG large text: 24px, or 18.66px bold. */
  large: boolean;
}

/**
 * Contrast of the text rows B.6 #8 spot-checks. The effective background is
 * composited by climbing the ancestors and alpha-blending each layer's
 * background colour (gradients contribute the mean of their colour stops) over
 * the page background; the ratio is the WCAG relative-luminance formula. The
 * token is read from the inline style when it names one.
 */
export function auditContrast(): ContrastRow[] {
  const PAGE_BG: [number, number, number] = [3, 10, 16]; // --bg #030a10
  const parse = (s: string): [number, number, number, number] | null => {
    const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(s);
    if (m) {
      let a = m[4] == null ? 1 : Number(m[4].replace("%", "")) / (m[4].endsWith("%") ? 100 : 1);
      if (Number.isNaN(a)) a = 1;
      return [Number(m[1]), Number(m[2]), Number(m[3]), a];
    }
    const h = /^#([0-9a-f]{3,8})$/i.exec(s.trim());
    if (h) {
      let hex = h[1];
      if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((c) => c + c).join("");
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
    return null;
  };
  const layersOf = (el: Element): [number, number, number, number][] => {
    const layers: [number, number, number, number][] = [];
    let n: Element | null = el;
    while (n) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c[3] > 0) layers.push(c);
      else if (cs.backgroundImage && cs.backgroundImage !== "none") {
        const stops = (cs.backgroundImage.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/gi) ?? []).map(parse).filter((x): x is [number, number, number, number] => Boolean(x));
        if (stops.length) {
          const mean = stops.reduce((acc, s) => [acc[0] + s[0] / stops.length, acc[1] + s[1] / stops.length, acc[2] + s[2] / stops.length, acc[3] + s[3] / stops.length], [0, 0, 0, 0]);
          layers.push([mean[0], mean[1], mean[2], mean[3]]);
        }
      }
      n = n.parentElement;
    }
    return layers;
  };
  const composite = (layers: [number, number, number, number][]): [number, number, number] => {
    let bg: [number, number, number] = PAGE_BG;
    for (let i = layers.length - 1; i >= 0; i--) {
      const [r, g, b, a] = layers[i];
      bg = [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
    }
    return bg;
  };
  const lum = ([r, g, b]: [number, number, number]) => {
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (fg: [number, number, number], bg: [number, number, number]) => {
    const l1 = lum(fg);
    const l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const describe = (el: Element): string => {
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : "";
    const pid = el.parentElement?.closest("[id]")?.id;
    return `${el.tagName.toLowerCase()}${id}${cls}${pid ? ` in #${pid}` : ""}`;
  };
  const tokenOf = (el: HTMLElement): string => {
    const inline = el.style.color;
    const m = /var\((--[\w-]+)/.exec(inline);
    if (m) return m[1];
    if (inline) return `inline:${inline}`;
    return el.className && typeof el.className === "string" ? `css:${el.className.split(" ")[0]}` : "inherited";
  };
  const visible = (el: Element) => {
    if (el.closest("[hidden], [aria-hidden='true']")) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const fmt = (c: [number, number, number]) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
  const GROUPS: [string, string, number][] = [
    ["h1", "main h1", 3],
    ["h2", "main h2", 12],
    ["summary-dt", ".mrr-summary dt", 12],
    ["summary-dd", ".mrr-summary dd", 12],
    ["eyebrow", ".mrr-hero-eyebrow, .mrr-sec-head > h2, .mrr-sec-head > h3", 6],
    ["meta", ".mrr-sec-sp > span, .mrr-hero-foot", 6],
    ["caption-text-3", "main [style*='var(--text-3)']", 8],
    ["text-4", "main [style*='var(--text-4)'], .mrr-disclosure-line", 8],
    ["slider-scale", ".mrr-slider-scale span", 3],
    ["table-group", "tr.mrr-grp td", 3],
    ["subtab-hint", "[role='tab'][aria-selected='false'] small", 4],
    ["pill", ".mrr-pill", 4],
    ["tag", "span[data-tone]:not(.mrr-pill)", 6],
    ["state-note", "main span[style*='var(--fs-caption)']", 6],
  ];
  const rows: ContrastRow[] = [];
  for (const [group, sel, max] of GROUPS) {
    let n = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (n >= max) break;
      if (!visible(el)) continue;
      const text = (el.innerText || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const cs = getComputedStyle(el);
      const fgc = parse(cs.color);
      if (!fgc) continue;
      const bg = composite(layersOf(el));
      // Text colour with alpha sits over the composited background.
      const fg: [number, number, number] = [fgc[0] * fgc[3] + bg[0] * (1 - fgc[3]), fgc[1] * fgc[3] + bg[1] * (1 - fgc[3]), fgc[2] * fgc[3] + bg[2] * (1 - fgc[3])];
      const fontSize = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      rows.push({
        group,
        sel: describe(el),
        text: text.slice(0, 50),
        ratio: Math.round(ratio(fg, bg) * 100) / 100,
        fg: fmt(fg),
        bg: fmt(bg),
        token: tokenOf(el),
        fontSize,
        bold,
        large: fontSize >= 24 || (bold && fontSize >= 18.66),
      });
      n += 1;
    }
  }
  return rows;
}

/* ── B.4 #1: the Tab walk (Node side) ────────────────────────────────────── */

export interface TabStop {
  i: number;
  tag: string;
  role: string | null;
  name: string;
  id: string;
  className: string;
  tabindex: string | null;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  boxShadow: string;
  inlineOutline: string;
  isSkipLink: boolean;
  inDialog: boolean;
  isCanvas: boolean;
}

/** Reads document.activeElement with its computed focus ring; run in the page. */
export function readActiveElement(i: number): TabStop | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body || el === document.documentElement) return null;
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const textOf = (root: Element): string => {
    let out = "";
    const walk = (n: Node) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.textContent ?? "";
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      const e = n as HTMLElement;
      if (e.getAttribute("aria-hidden") === "true" || e.hasAttribute("hidden")) return;
      if (getComputedStyle(e).display === "none") return;
      e.childNodes.forEach(walk);
      if (/^(?:BR|P|DIV|LI|TR|H[1-6])$/.test(e.tagName)) out += " ";
    };
    walk(root);
    return clean(out);
  };
  const byIds = el.getAttribute("aria-labelledby");
  let name = "";
  if (byIds) {
    name = clean(
      byIds
        .split(/\s+/)
        .map((id) => {
          const target = document.getElementById(id);
          return target ? textOf(target) : "";
        })
        .join(" "),
    );
  }
  if (!name) name = clean(el.getAttribute("aria-label") ?? "");
  if (!name) name = textOf(el);
  if (!name) name = clean(el.getAttribute("title") ?? "");
  if (!name && el.id) name = clean(document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.textContent ?? "");
  if (!name) name = clean(el.closest("label")?.textContent ?? "");
  const cs = getComputedStyle(el);
  return {
    i,
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute("role"),
    name: name.slice(0, 80),
    id: el.id,
    className: typeof el.className === "string" ? el.className.slice(0, 60) : "",
    tabindex: el.getAttribute("tabindex"),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    boxShadow: cs.boxShadow,
    inlineOutline: el.style.outline || el.style.outlineStyle || "",
    isSkipLink: el.classList.contains("mrr-skip"),
    inDialog: Boolean(el.closest("[role='dialog']")),
    isCanvas: el.tagName === "CANVAS",
  };
}

/**
 * Press Tab from a fresh load until focus returns to the skip link, leaves the
 * document, or `max` stops are recorded. Each stop carries the computed
 * outline of the focused element (keyboard focus matches :focus-visible).
 */
export async function tabWalk(page: Page, max = 400): Promise<TabStop[]> {
  const stops: TabStop[] = [];
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.querySelectorAll("[data-mrr-walk]").forEach((el) => el.removeAttribute("data-mrr-walk"));
  });
  let leftDocument = 0;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    // A stop already visited closes the cycle (the walk may have started
    // mid-page when the page moved Chromium's focus starting point on load).
    const seen = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return "body";
      if (el.hasAttribute("data-mrr-walk")) return "seen";
      el.setAttribute("data-mrr-walk", "1");
      return "new";
    });
    if (seen === "seen") break;
    if (seen === "body") {
      // Focus left the document (the end of the page): one more Tab re-enters at the top.
      leftDocument += 1;
      if (leftDocument > 1) break;
      continue;
    }
    const stop = await page.evaluate(readActiveElement, stops.length);
    if (!stop) break;
    stops.push(stop);
  }
  await page.evaluate(() => document.querySelectorAll("[data-mrr-walk]").forEach((el) => el.removeAttribute("data-mrr-walk")));
  return stops;
}

/** Outline width in px from a computed value ("2px" → 2, "medium" → 3). */
export function outlinePx(width: string): number {
  if (/^\d/.test(width)) return parseFloat(width);
  return width === "thin" ? 1 : width === "medium" ? 3 : width === "thick" ? 5 : 0;
}

/** True when a stop shows a ring: an outline of at least 1px, or a non-empty box-shadow ring. */
export function hasRing(stop: TabStop): boolean {
  if (stop.outlineStyle !== "none" && outlinePx(stop.outlineWidth) >= 1) return true;
  return stop.boxShadow !== "none" && stop.boxShadow !== "";
}
