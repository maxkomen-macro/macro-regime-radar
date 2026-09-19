/**
 * Geometry sweeps for the redesign-v2 global rules (docs/redesign-v2/
 * ITERATION_1.md). Permanent and reusable: each rule gets one in-page audit
 * function plus the Node-side helpers every sweep shares. Iteration 1 Step 1
 * lands G1 (no overlap); later steps append G2 (dead space) and G3
 * (symmetry) sweeps below, in their own sections, without changing G1.
 *
 * Every `audit*` function runs INSIDE the page through `page.evaluate` and is
 * therefore self-contained (the e2e/lib/a11y.ts convention): no closure over
 * anything at module scope, every helper defined inside the function body,
 * plain JSON out.
 */
import fs from "node:fs";
import path from "node:path";
import type { Page, TestInfo } from "@playwright/test";

/* ── Shared: settle a routed screen before measuring ─────────────────────── */

/** Wait for the routed screen's data: the h1 inside <main>, then no
 * [aria-busy="true"] and no role=status reading "Loading…", each bounded so a
 * slow endpoint never hangs the sweep (max ≈ `maxMs`), then a settle beat. */
export async function waitForScreenData(page: Page, maxMs = 8_000, settleMs = 500): Promise<void> {
  const start = Date.now();
  const left = () => Math.max(500, maxMs - (Date.now() - start));
  await page.locator("main h1").first().waitFor({ state: "visible", timeout: left() }).catch(() => {});
  await page
    .waitForFunction(
      () => {
        if (document.querySelector("[aria-busy='true']")) return false;
        const statuses = Array.from(document.querySelectorAll("[role='status']"));
        return !statuses.some((el) => /\bLoading\b/i.test(el.textContent ?? ""));
      },
      null,
      { timeout: left(), polling: 200 },
    )
    .catch(() => {});
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  await page.waitForTimeout(settleMs);
}

/** localStorage key of the collapsible sidebar (Iteration 1 S3). */
export const SIDEBAR_KEY = "mrr.sidebar.v1";

/** Seed the sidebar state before the app boots (every navigation in this page). */
export async function seedSidebar(page: Page, collapsed: boolean): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* storage blocked: the app falls back to its default */
      }
    },
    [SIDEBAR_KEY, JSON.stringify({ version: 1, collapsed })] as const,
  );
}

/** Write a sweep report to web/test-results/<sweep>/<name>.json and attach it
 * to the test. Always written (an empty offender list replaces a stale file). */
export async function writeSweepReport(testInfo: TestInfo, sweep: string, name: string, data: unknown): Promise<string> {
  const dir = path.join(testInfo.project.outputDir, sweep);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.json`);
  const body = JSON.stringify(data, null, 2);
  fs.writeFileSync(file, body);
  await testInfo.attach(`${sweep}-${name}.json`, { body, contentType: "application/json" });
  return file;
}

/** "/app/regime-lab" → "regime-lab"; "/" → "landing". */
export function routeSlug(route: string): string {
  const clean = route.split(/[?#]/)[0].replace(/\/+$/, "");
  const last = clean.split("/").filter(Boolean).pop();
  return last ?? "landing";
}

/* ── G1 · No overlap ─────────────────────────────────────────────────────── */

export interface OverlapRef {
  /** Short CSS path to the owner element (at most four steps, stops at an id). */
  selector: string;
  /** First 40 characters of the item's text (text run, control name, or graphic label). */
  text: string;
  kind: "text" | "control" | "graphic";
}

export interface OverlapPair {
  a: OverlapRef;
  b: OverlapRef;
  overlapPx: { w: number; h: number };
}

export interface OverlapScan {
  /** Visible items measured (text runs, controls, graphics). */
  items: number;
  /** Offending pairs, largest overlap first, one per owner pair. */
  pairs: OverlapPair[];
  truncated: boolean;
  scrollY: number;
}

export interface OverlapOptions {
  /** Overlap must exceed this in BOTH width and height to count (G1: 1 px). */
  minPx?: number;
  maxPairs?: number;
  /** Spatial bucket size for the pair search. */
  cell?: number;
}

/**
 * G1: two visible elements that are not ancestor and descendant must not have
 * intersecting boxes by more than 1 px. Items are
 *   (a) text runs: each non-whitespace text node's Range.getClientRects()
 *       (trimmed to its non-whitespace span), owner = the parent element;
 *   (b) controls: button, a[href], input, select, textarea and the
 *       button / tab / switch / slider / checkbox / radio / option / link roles
 *       (per getClientRects fragment, so a wrapped inline link is its line
 *       boxes, not their union);
 *   (c) graphics: the outermost svg, canvas (sibling canvases stacked by one
 *       chart count once), img.
 * Skipped: anything not visible (display none, visibility not visible,
 * opacity 0 on itself or an ancestor, zero area, the sr-only 1 px clip) and
 * anything inside a dialog, alertdialog, tooltip, menu, listbox, aria-modal,
 * [popover] or the freshness drawer. Each box is clipped to the intersection
 * of its overflow hidden / auto / scroll / clip ancestors (per axis; a fixed
 * element escapes its ancestors), so content scrolled out of a scroll area
 * does not count. A pair is flagged when neither owner contains the other and
 * the intersection exceeds `minPx` in both width and height. Coordinates are
 * document coordinates; call it at scrollY 0.
 */
export function auditOverlaps(opts: OverlapOptions = {}): OverlapScan {
  const MIN = opts.minPx ?? 1;
  const MAX_PAIRS = opts.maxPairs ?? 250;
  const CELL = opts.cell ?? 96;
  const EXCLUDE =
    "[role='dialog'], [role='alertdialog'], [role='tooltip'], [role='menu'], [role='listbox'], [aria-modal='true'], [popover], #freshness-drawer";
  const CONTROLS =
    "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='slider'], [role='checkbox'], [role='radio'], [role='option'], [role='link']";
  const INF = 1e9;

  type Box = { l: number; t: number; r: number; b: number };
  type Item = { box: Box; owner: Element; kind: "text" | "control" | "graphic"; text: string };

  const sx = window.scrollX;
  const sy = window.scrollY;
  const toBox = (r: DOMRect | DOMRectReadOnly): Box => ({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
  const inter = (a: Box, b: Box): Box => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const ALL: Box = { l: -INF, t: -INF, r: INF, b: INF };
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  const styleMemo = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    let cs = styleMemo.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      styleMemo.set(el, cs);
    }
    return cs;
  };

  /* Hidden: display none, opacity 0, or the sr-only clip, on self or an ancestor. */
  const hiddenMemo = new Map<Element, boolean>();
  const hidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const memo = hiddenMemo.get(el);
    if (memo !== undefined) return memo;
    const cs = style(el);
    let h = cs.display === "none" || Number.parseFloat(cs.opacity) === 0;
    if (!h && cs.display !== "contents") {
      const r = el.getBoundingClientRect();
      const clipRect = cs.clip && cs.clip !== "auto" && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip);
      const clipPath = cs.clipPath && /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && (clipRect || clipPath || cs.overflow === "hidden")) h = true;
    }
    if (!h) h = hidden(el.parentElement);
    hiddenMemo.set(el, h);
    return h;
  };
  const invisible = (el: Element): boolean => hidden(el) || style(el).visibility !== "visible";

  /* Clip for the CONTENTS of el: its own overflow (per axis) ∩ its ancestors' (a fixed element escapes them). */
  const clips = (v: string) => v === "hidden" || v === "auto" || v === "scroll" || v === "clip";
  const clipMemo = new Map<Element, Box>();
  const contentClip = (el: Element | null): Box => {
    if (!el || el === document.documentElement || el === document.body) return ALL;
    const memo = clipMemo.get(el);
    if (memo) return memo;
    const cs = style(el);
    let box = cs.position === "fixed" ? ALL : contentClip(el.parentElement);
    if (cs.display !== "contents" && (clips(cs.overflowX) || clips(cs.overflowY))) {
      const own = toBox(el.getBoundingClientRect());
      box = inter(box, {
        l: clips(cs.overflowX) ? own.l : -INF,
        r: clips(cs.overflowX) ? own.r : INF,
        t: clips(cs.overflowY) ? own.t : -INF,
        b: clips(cs.overflowY) ? own.b : INF,
      });
    }
    clipMemo.set(el, box);
    return box;
  };
  /* Clip for el's OWN box: its ancestors' content clip (a fixed element escapes them). */
  const boxClip = (el: Element): Box => (style(el).position === "fixed" ? ALL : contentClip(el.parentElement));

  const excluded = (el: Element) => el.closest(EXCLUDE) !== null;
  const items: Item[] = [];
  const push = (rect: DOMRect | DOMRectReadOnly, clip: Box, owner: Element, kind: Item["kind"], text: string) => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const box = inter(toBox(rect), clip);
    if (box.r - box.l <= 0 || box.b - box.t <= 0) return;
    items.push({ box, owner, kind, text: clean(text).slice(0, 40) });
  };

  // (a) text runs
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const owner = node.parentElement;
    if (!owner || owner.closest("script, style, noscript, template, title")) continue;
    if (excluded(owner) || invisible(owner)) continue;
    const value = node.nodeValue ?? "";
    const start = value.search(/\S/);
    const end = value.length - (value.length - value.trimEnd().length);
    if (start < 0 || end <= start) continue;
    range.setStart(node, start);
    range.setEnd(node, end);
    const clip = contentClip(owner);
    for (const r of Array.from(range.getClientRects())) push(r, clip, owner, "text", value);
  }

  // (b) controls
  for (const el of Array.from(document.body.querySelectorAll(CONTROLS))) {
    if (excluded(el) || invisible(el)) continue;
    const name = el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
    // Per fragment: a wrapped inline link is its line boxes, not their union.
    const clip = boxClip(el);
    for (const r of Array.from(el.getClientRects())) push(r, clip, el, "control", name);
  }

  // (c) graphics: outermost svg, one canvas per stacked group, img
  for (const el of Array.from(document.body.querySelectorAll("svg, canvas, img"))) {
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    if (el.tagName.toLowerCase() === "canvas") {
      let prev = el.previousElementSibling;
      let stacked = false;
      while (prev) {
        if (prev.tagName.toLowerCase() === "canvas") stacked = true;
        prev = prev.previousElementSibling;
      }
      if (stacked) continue;
    }
    if (excluded(el) || invisible(el)) continue;
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || `<${el.tagName.toLowerCase()}>`;
    const clip = boxClip(el);
    for (const r of Array.from(el.getClientRects())) push(r, clip, el, "graphic", label);
  }

  // Pair search over a coarse grid.
  const grid = new Map<string, number[]>();
  items.forEach((it, i) => {
    const x0 = Math.floor(it.box.l / CELL);
    const x1 = Math.floor((it.box.r - 0.001) / CELL);
    const y0 = Math.floor(it.box.t / CELL);
    const y1 = Math.floor((it.box.b - 0.001) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x}:${y}`;
        const list = grid.get(k);
        if (list) list.push(i);
        else grid.set(k, [i]);
      }
  });

  const ownerIds = new Map<Element, number>();
  const ownerId = (el: Element) => {
    let id = ownerIds.get(el);
    if (id === undefined) {
      id = ownerIds.size;
      ownerIds.set(el, id);
    }
    return id;
  };
  const seen = new Set<string>();
  const best = new Map<string, { i: number; j: number; w: number; h: number }>();
  for (const list of Array.from(grid.values())) {
    for (let x = 0; x < list.length; x++)
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x];
        const j = list[y];
        const key = i < j ? `${i}|${j}` : `${j}|${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const A = items[i];
        const B = items[j];
        if (A.owner === B.owner || A.owner.contains(B.owner) || B.owner.contains(A.owner)) continue;
        const w = Math.min(A.box.r, B.box.r) - Math.max(A.box.l, B.box.l);
        const h = Math.min(A.box.b, B.box.b) - Math.max(A.box.t, B.box.t);
        if (w <= MIN || h <= MIN) continue;
        const oa = ownerId(A.owner);
        const ob = ownerId(B.owner);
        const pk = oa < ob ? `${oa}|${ob}` : `${ob}|${oa}`;
        const prev = best.get(pk);
        if (!prev || w * h > prev.w * prev.h) best.set(pk, { i, j, w, h });
      }
  }

  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== document.body && parts.length < 4) {
      let step = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${step}#${n.id}`);
        break;
      }
      const cls = Array.from(n.classList).slice(0, 2);
      if (cls.length) step += `.${cls.join(".")}`;
      const tid = n.getAttribute("data-testid");
      if (tid) step += `[data-testid="${tid}"]`;
      const slot = n.getAttribute("data-slot");
      if (slot) step += `[data-slot="${slot}"]`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const ref = (it: Item): OverlapRef => ({ selector: cssPath(it.owner), text: it.text, kind: it.kind });

  const all = Array.from(best.values()).sort((p, q) => q.w * q.h - p.w * p.h);
  return {
    items: items.length,
    pairs: all.slice(0, MAX_PAIRS).map((p) => ({
      a: ref(items[p.i]),
      b: ref(items[p.j]),
      overlapPx: { w: Math.round(p.w * 10) / 10, h: Math.round(p.h * 10) / 10 },
    })),
    truncated: all.length > MAX_PAIRS,
    scrollY: sy,
  };
}

/** One line per pair for an assertion message. */
export function describeOverlaps(pairs: OverlapPair[], max = 25): string {
  const lines = pairs
    .slice(0, max)
    .map((p) => `  ${p.a.selector} "${p.a.text}"  ×  ${p.b.selector} "${p.b.text}"  (${p.overlapPx.w}×${p.overlapPx.h} px)`);
  if (pairs.length > max) lines.push(`  … and ${pairs.length - max} more`);
  return lines.join("\n");
}

/* ── G1, scoped: the overlap audit restricted to one region ──────────────── */

/**
 * `auditOverlaps` limited to the items inside `scope` (a CSS selector), with
 * G1 itself untouched: for the duration of the call a stylesheet sets
 * `visibility: hidden` on everything outside the scope (visibility never moves
 * layout) and `visible` on the scope root, so only the scope's own text runs,
 * controls and graphics reach the pair search. Used by the D2 glance check.
 */
export async function auditOverlapsWithin(page: Page, scope: string, opts: OverlapOptions = {}): Promise<OverlapScan> {
  const id = `mrr-e2e-scope-${Date.now()}`;
  await page.evaluate(
    ([styleId, sel]) => {
      const tag = document.createElement("style");
      tag.id = styleId;
      tag.textContent = `body *:not(${sel}):not(${sel} *) { visibility: hidden !important; } ${sel} { visibility: visible !important; }`;
      document.head.appendChild(tag);
    },
    [id, scope] as const,
  );
  try {
    return await page.evaluate(auditOverlaps, opts);
  } finally {
    await page.evaluate((styleId) => document.getElementById(styleId)?.remove(), id).catch(() => {});
  }
}

/* ── G2 · No dead space ──────────────────────────────────────────────────── */

/*
 * Card surfaces, shared by G2 and G3. Found by inspecting the running app
 * (every route at 1672×941, 2026-09-19). Card.jsx (panel / card / tile
 * variants) puts NO class on its root, only inline styles, so its surfaces
 * are found by the radius token in the inline style attribute; the named
 * components are listed by class as well so a token change cannot drop them.
 *
 *   [style*="var(--r-card)"]  Card panel / card variants: every section panel
 *                             (#signals, #oas, #cycle, #lbo-outputs, …), nested
 *                             wells (the Macro tape table well), the
 *                             Methodology cards; also the TabHero and
 *                             SummaryCard roots
 *   [style*="var(--r-tile)"]  Card tile variant: SignalCard <article>, the key
 *                             level and LBO output tiles, NewsCard lead cards,
 *                             the chart tiles (2s10s, quality ladder), the
 *                             Regime Lab tiles (.mrr-lab-exits, …)
 *   .mrr-hero                 TabHero root (<section>)
 *   .mrr-summary              SummaryCard root (<section>)
 *   .mrr-glance-tile          Dashboard glance tile
 *   .mrr-quote, .mrr-upd      strip quote cards and the strip freshness card
 *                             (radius from the stylesheet, not inline)
 *   [data-card]               explicit opt-in for any later surface
 *
 * A token match is a card only with a visible border on at least one side:
 * SubTabs' positioning wrapper and the hero's gradient placeholder carry the
 * token with no border and are not cards. Never a card: a tablist or a
 * control (button, a[href], input, select, textarea, role button / tab /
 * link). The in-page audits below inline this list (page.evaluate functions
 * cannot close over module scope); keep the three copies identical.
 */
export const CARD_SURFACES = {
  always: ".mrr-hero, .mrr-summary, .mrr-glance-tile, .mrr-quote, .mrr-upd, [data-card]",
  token: "[style*='var(--r-card)'], [style*='var(--r-tile)']",
  never: "[role='tablist'], button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='link']",
} as const;

export interface DeadSpaceOffender {
  /** "tail": empty run between the last content and the card's inner bottom;
   * "interior": the widest empty run between two content bands. */
  kind: "tail" | "interior";
  /** Short CSS path to the card. */
  selector: string;
  /** First 40 characters of the card's text. */
  text: string;
  /** Length of the empty run, px. */
  gapPx: number;
  /** max(48, 0.15 × card height). */
  limitPx: number;
  cardHeight: number;
  /** Document y range of the empty run. */
  from: number;
  to: number;
  /** tail: the content that ends lowest; interior: the content either side. */
  context: string;
  /** The card sits inside another card (measured on its own all the same). */
  nested: boolean;
}

export interface DeadSpaceScan {
  /** Cards measured. */
  cards: number;
  /** Worst first (gap beyond its limit). */
  offenders: DeadSpaceOffender[];
  scrollY: number;
}

export interface DeadSpaceOptions {
  /** Floor of the allowance (G2: 48 px). */
  minPx?: number;
  /** Share of the card's height allowed (G2: 0.15). */
  ratio?: number;
}

/**
 * G2: inside any card, the gap between the bottom of its last visible content
 * and its inner bottom edge (border-box bottom − border-bottom −
 * padding-bottom) must be at most max(48 px, 15% of the card's height); and no
 * empty horizontal band of that size may open between two runs of content.
 *
 * Content, per card, is every visible descendant item of the G1 kinds, with
 * the same visibility and overflow-clip rules: text runs (Range client rects),
 * controls, graphics (outermost svg, canvas, img, video), plus filled boxes
 * (any element with a painted background, which covers bars, gauges, wells
 * and nested cards). Pure decoration is ignored: the hero glow and gradient
 * placeholder (.mrr-hero-glow, .mrr-hero-placeholder), absolutely positioned
 * pointer-events:none overlays without text (fades, glows), and aria-hidden
 * gradient blocks without text covering a quarter of the card or more. Item
 * boxes are clipped to the card's box.
 *
 * Tail: innerBottom − max(item bottom). Interior: items sorted by top and
 * merged into vertical bands (a band grows while the next item starts at or
 * above its bottom); the widest gap between consecutive bands. Either run is
 * an offender when it exceeds the limit. Cards nested in cards are measured
 * separately (a nested card is a filled box to its parent). Skipped: cards
 * that are not visible (hidden panels, collapsed disclosures, closed
 * <details>), inside a dialog / alertdialog / tooltip / menu / listbox /
 * aria-modal / [popover] / the freshness drawer, under 40×24 px, or with less
 * than half their height visible through their overflow ancestors.
 * Coordinates are document coordinates; call it at scrollY 0.
 */
export function auditDeadSpace(opts: DeadSpaceOptions = {}): DeadSpaceScan {
  const MIN = opts.minPx ?? 48;
  const RATIO = opts.ratio ?? 0.15;
  const EXCLUDE =
    "[role='dialog'], [role='alertdialog'], [role='tooltip'], [role='menu'], [role='listbox'], [aria-modal='true'], [popover], #freshness-drawer";
  const CONTROLS =
    "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='switch'], [role='slider'], [role='checkbox'], [role='radio'], [role='option'], [role='link']";
  // CARD_SURFACES (module scope), inlined.
  const CARD_ALWAYS = ".mrr-hero, .mrr-summary, .mrr-glance-tile, .mrr-quote, .mrr-upd, [data-card]";
  const CARD_TOKEN = "[style*='var(--r-card)'], [style*='var(--r-tile)']";
  const CARD_NEVER = "[role='tablist'], button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='link']";
  const DECOR = ".mrr-hero-glow, .mrr-hero-placeholder";
  const INF = 1e9;

  type Box = { l: number; t: number; r: number; b: number };
  type Item = { box: Box; owner: Element; label: string; fill: boolean };

  const sx = window.scrollX;
  const sy = window.scrollY;
  const toBox = (r: DOMRect | DOMRectReadOnly): Box => ({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
  const inter = (a: Box, b: Box): Box => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const ALL: Box = { l: -INF, t: -INF, r: INF, b: INF };
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const round = (n: number) => Math.round(n * 10) / 10;
  const px = (v: string) => Number.parseFloat(v) || 0;

  const styleMemo = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    let cs = styleMemo.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      styleMemo.set(el, cs);
    }
    return cs;
  };

  /* Hidden: display none, opacity 0, the sr-only clip, or a closed <details> body (G1 rules plus details). */
  const hiddenMemo = new Map<Element, boolean>();
  const hidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const memo = hiddenMemo.get(el);
    if (memo !== undefined) return memo;
    const cs = style(el);
    let h = cs.display === "none" || Number.parseFloat(cs.opacity) === 0;
    if (!h && cs.display !== "contents") {
      const r = el.getBoundingClientRect();
      const clipRect = cs.clip && cs.clip !== "auto" && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip);
      const clipPath = cs.clipPath && /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && (clipRect || clipPath || cs.overflow === "hidden")) h = true;
    }
    if (!h) {
      const p = el.parentElement;
      if (p && p.tagName.toLowerCase() === "details" && !(p as HTMLDetailsElement).open && el.tagName.toLowerCase() !== "summary") h = true;
    }
    if (!h) h = hidden(el.parentElement);
    hiddenMemo.set(el, h);
    return h;
  };
  const invisible = (el: Element): boolean => hidden(el) || style(el).visibility !== "visible";

  const clips = (v: string) => v === "hidden" || v === "auto" || v === "scroll" || v === "clip";
  const clipMemo = new Map<Element, Box>();
  const contentClip = (el: Element | null): Box => {
    if (!el || el === document.documentElement || el === document.body) return ALL;
    const memo = clipMemo.get(el);
    if (memo) return memo;
    const cs = style(el);
    let box = cs.position === "fixed" ? ALL : contentClip(el.parentElement);
    if (cs.display !== "contents" && (clips(cs.overflowX) || clips(cs.overflowY))) {
      const own = toBox(el.getBoundingClientRect());
      box = inter(box, {
        l: clips(cs.overflowX) ? own.l : -INF,
        r: clips(cs.overflowX) ? own.r : INF,
        t: clips(cs.overflowY) ? own.t : -INF,
        b: clips(cs.overflowY) ? own.b : INF,
      });
    }
    clipMemo.set(el, box);
    return box;
  };
  const boxClip = (el: Element): Box => (style(el).position === "fixed" ? ALL : contentClip(el.parentElement));
  const excluded = (el: Element) => el.closest(EXCLUDE) !== null;

  const bordered = (el: Element) => {
    const cs = style(el);
    return (["top", "right", "bottom", "left"] as const).some((side) => {
      const s = cs.getPropertyValue(`border-${side}-style`);
      return px(cs.getPropertyValue(`border-${side}-width`)) >= 0.5 && s !== "none" && s !== "hidden";
    });
  };
  const isCard = (el: Element) => !el.matches(CARD_NEVER) && (el.matches(CARD_ALWAYS) || (el.matches(CARD_TOKEN) && bordered(el)));

  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== document.body && parts.length < 4) {
      let step = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${step}#${n.id}`);
        break;
      }
      const cls = Array.from(n.classList).slice(0, 2);
      if (cls.length) step += `.${cls.join(".")}`;
      const tid = n.getAttribute("data-testid");
      if (tid) step += `[data-testid="${tid}"]`;
      const slot = n.getAttribute("data-slot");
      if (slot) step += `[data-slot="${slot}"]`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const shortTag = (el: Element) => `<${el.tagName.toLowerCase()}${el.classList.length ? `.${Array.from(el.classList).slice(0, 2).join(".")}` : ""}>`;

  /* Cards. */
  const cards: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll(`${CARD_ALWAYS}, ${CARD_TOKEN}`))) {
    if (!isCard(el) || excluded(el) || invisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    const vis = inter(toBox(r), boxClip(el));
    if (vis.r - vis.l <= 0 || vis.b - vis.t < r.height / 2) continue;
    cards.push(el);
  }
  const cardSet = new Set(cards);
  const itemsByCard = new Map<Element, Item[]>();
  cards.forEach((c) => itemsByCard.set(c, []));

  /* Attach an item to every card ancestor of `start` (inclusive). */
  const attach = (start: Element | null, item: Item) => {
    let n: Element | null = start;
    while (n && n !== document.body) {
      if (cardSet.has(n)) itemsByCard.get(n)?.push(item);
      n = n.parentElement;
    }
  };
  const inAnyCard = (el: Element | null): boolean => {
    let n: Element | null = el;
    while (n && n !== document.body) {
      if (cardSet.has(n)) return true;
      n = n.parentElement;
    }
    return false;
  };
  const add = (rect: DOMRect | DOMRectReadOnly, clip: Box, owner: Element, label: string, fill: boolean, start: Element | null) => {
    if (rect.width <= 0 || rect.height <= 0) return;
    const box = inter(toBox(rect), clip);
    if (box.r - box.l <= 0 || box.b - box.t <= 0) return;
    attach(start, { box, owner, label: clean(label).slice(0, 40), fill });
  };

  // (a) text runs
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (/\S/.test(n.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const owner = node.parentElement;
    if (!owner || owner.closest("script, style, noscript, template, title")) continue;
    if (!inAnyCard(owner) || excluded(owner) || invisible(owner) || owner.closest(DECOR)) continue;
    const value = node.nodeValue ?? "";
    const start = value.search(/\S/);
    const end = value.length - (value.length - value.trimEnd().length);
    if (start < 0 || end <= start) continue;
    range.setStart(node, start);
    range.setEnd(node, end);
    const clip = contentClip(owner);
    for (const r of Array.from(range.getClientRects())) add(r, clip, owner, value, false, owner);
  }

  // (b) controls
  for (const el of Array.from(document.body.querySelectorAll(CONTROLS))) {
    if (!inAnyCard(el) || excluded(el) || invisible(el)) continue;
    const name = el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || el.getAttribute("placeholder") || el.tagName.toLowerCase();
    const clip = boxClip(el);
    for (const r of Array.from(el.getClientRects())) add(r, clip, el, name, false, el);
  }

  // (c) graphics
  for (const el of Array.from(document.body.querySelectorAll("svg, canvas, img, video"))) {
    if (el.tagName.toLowerCase() === "svg" && el.parentElement?.closest("svg")) continue;
    if (!inAnyCard(el) || excluded(el) || invisible(el) || el.closest(DECOR)) continue;
    const label = el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || `<${el.tagName.toLowerCase()}>`;
    const clip = boxClip(el);
    for (const r of Array.from(el.getClientRects())) add(r, clip, el, label, false, el);
  }

  // (d) filled boxes (bars, gauges, wells, nested cards); decoration skipped
  const alpha = (c: string): number => {
    if (!c || c === "transparent") return 0;
    const m = /\(([^)]*)\)/.exec(c);
    if (!m) return 1;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const a = parts.length >= 4 ? parts[parts.length - 1] : "1";
    return a.endsWith("%") ? Number.parseFloat(a) / 100 : Number.parseFloat(a);
  };
  const seen = new Set<Element>();
  for (const card of cards) {
    for (const el of Array.from(card.querySelectorAll("*"))) {
      if (seen.has(el)) continue;
      seen.add(el);
      if (el.closest("svg")) continue; // svg internals: the svg is the graphic
      const cs = style(el);
      const painted = cardSet.has(el) || alpha(cs.backgroundColor) > 0.02 || cs.backgroundImage !== "none";
      if (!painted) continue;
      if (el.closest(DECOR) || excluded(el) || invisible(el)) continue;
      const text = clean(el.textContent ?? "");
      const positioned = cs.position === "absolute" || cs.position === "fixed";
      if (!cardSet.has(el) && positioned && cs.pointerEvents === "none" && !text) continue; // overlay: fade, glow
      if (!cardSet.has(el) && !text && el.closest("[aria-hidden='true']") && cs.backgroundImage.includes("gradient")) {
        const r = el.getBoundingClientRect();
        const cr = card.getBoundingClientRect();
        if (r.width * r.height >= 0.25 * cr.width * cr.height) continue; // decorative gradient block
      }
      const clip = boxClip(el);
      for (const r of Array.from(el.getClientRects())) add(r, clip, el, text || shortTag(el), true, el.parentElement);
    }
  }

  /* Measure each card. */
  const offenders: DeadSpaceOffender[] = [];
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const cs = style(card);
    const cb = toBox(rect);
    const innerTop = cb.t + px(cs.borderTopWidth) + px(cs.paddingTop);
    const innerBottom = cb.b - px(cs.borderBottomWidth) - px(cs.paddingBottom);
    const h = rect.height;
    const limit = Math.max(MIN, RATIO * h);
    const selector = cssPath(card);
    const text = clean((card as HTMLElement).innerText ?? card.textContent ?? "").slice(0, 40);
    const nested = inAnyCard(card.parentElement);
    const boxes = (itemsByCard.get(card) ?? [])
      .map((it) => ({ ...it, box: inter(it.box, cb) }))
      .filter((it) => it.box.r - it.box.l > 0 && it.box.b - it.box.t > 0)
      .sort((p, q) => p.box.t - q.box.t || p.box.b - q.box.b);

    // Tail.
    let last: (typeof boxes)[number] | undefined;
    for (const it of boxes) if (!last || it.box.b > last.box.b) last = it;
    const contentBottom = last ? last.box.b : innerTop;
    const tail = innerBottom - contentBottom;
    if (tail > limit) {
      offenders.push({
        kind: "tail",
        selector,
        text,
        gapPx: round(tail),
        limitPx: round(limit),
        cardHeight: round(h),
        from: round(contentBottom),
        to: round(innerBottom),
        context: last ? `last: "${last.label}"` : "no visible content",
        nested,
      });
    }

    // Interior: merge into vertical bands; widest gap between consecutive bands.
    let bandBottom = -INF;
    let bandLast: (typeof boxes)[number] | undefined;
    let worst: { gap: number; from: number; to: number; above: string; below: string } | undefined;
    for (const it of boxes) {
      if (bandLast && it.box.t > bandBottom) {
        const gap = it.box.t - bandBottom;
        if (!worst || gap > worst.gap) worst = { gap, from: bandBottom, to: it.box.t, above: bandLast.label, below: it.label };
      }
      if (it.box.b >= bandBottom) {
        bandBottom = it.box.b;
        bandLast = it;
      }
    }
    if (worst && worst.gap > limit) {
      offenders.push({
        kind: "interior",
        selector,
        text,
        gapPx: round(worst.gap),
        limitPx: round(limit),
        cardHeight: round(h),
        from: round(worst.from),
        to: round(worst.to),
        context: `between "${worst.above}" and "${worst.below}"`,
        nested,
      });
    }
  }
  offenders.sort((p, q) => q.gapPx - q.limitPx - (p.gapPx - p.limitPx));
  return { cards: cards.length, offenders, scrollY: sy };
}

/** One line per dead-space offender for an assertion message. */
export function describeDeadSpace(offenders: DeadSpaceOffender[], max = 25): string {
  const lines = offenders
    .slice(0, max)
    .map((o) => `  [${o.kind}] ${o.selector} "${o.text}"  gap ${o.gapPx} px > ${o.limitPx} px (card ${o.cardHeight} px; ${o.context})`);
  if (offenders.length > max) lines.push(`  … and ${offenders.length - max} more`);
  return lines.join("\n");
}

/* ── G3 · Symmetry, measured ─────────────────────────────────────────────── */

export interface RowCardRef {
  selector: string;
  text: string;
  height: number;
}

export interface RowOffender {
  kind: "row";
  /** The shared grid / flex container. */
  container: string;
  /** Tallest and shortest card of the row. */
  a: RowCardRef;
  b: RowCardRef;
  deltaPx: number;
  cardsInRow: number;
}

export interface ChartOffender {
  kind: "chart";
  selector: string;
  /** The chart's accessible label or first text. */
  text: string;
  /** The measuring box: a [data-chart-slot] ancestor, else the nearest card. */
  container: string;
  containerKind: "slot" | "card";
  widthPx: number;
  containerWidthPx: number;
  /** Chart width ÷ container content width × 100. */
  fillPct: number;
  /** Chart centre − container content centre, px (negative = left of centre). */
  centreOffsetPx: number;
}

export interface SymmetryScan {
  cards: number;
  rows: RowOffender[];
  charts: ChartOffender[];
  /** Charts measured (offending or not). */
  chartsMeasured: number;
  /** Charts with neither a slot nor a card around them (not measured). */
  chartsUnplaced: string[];
  scrollY: number;
}

export interface SymmetryOptions {
  /** Height spread allowed within a row (G3: 2 px). */
  rowTolPx?: number;
  /** Tops within this many px share a row (2 px). */
  topTolPx?: number;
  /** Minimum chart width as a share of the container content width (G3: 85). */
  fillMinPct?: number;
  /** Maximum centre offset (G3: 8 px). */
  centreTolPx?: number;
  /** An unmarked svg / canvas is a chart from this width (200 px). */
  chartMinPx?: number;
  /** Anything narrower is a sparkline, never a chart (160 px). */
  sparkMaxPx?: number;
}

/**
 * G3: sibling cards in the same grid row differ in height by at most 2 px; a
 * chart fills at least 85% of its container's content width with its centre
 * within 8 px of the container's content centre.
 *
 * Rows: each visible card (the G2 card list) resolves to its row item — the
 * card itself, or the outermost of up to four single-visible-child wrappers
 * around it — whose layout parent (display: contents skipped) is a grid or
 * flex container. Items of one container whose card tops align within 2 px
 * form a row; a row of two or more cards is an offender when its tallest and
 * shortest card differ by more than 2 px (one offender per row, the extreme
 * pair). Non-card siblings are not compared.
 *
 * Charts: every element marked [data-chart] (outermost), plus every outermost
 * svg and canvas that is not inside one — a canvas inside a Lightweight
 * Charts root (.tv-lightweight-charts) stands for that root, stacked canvases
 * count once — at least 200 px wide. Sparklines never count: anything under
 * 160 px wide, marked [data-sparkline] or inside one. The container is the
 * nearest ancestor that is either marked [data-chart-slot] or a card (the
 * first met walking up), measured by its content box (border and padding
 * removed). Same visibility and exclusion rules as G2.
 */
export function auditSymmetry(opts: SymmetryOptions = {}): SymmetryScan {
  const ROW_TOL = opts.rowTolPx ?? 2;
  const TOP_TOL = opts.topTolPx ?? 2;
  const FILL_MIN = opts.fillMinPct ?? 85;
  const CENTRE_TOL = opts.centreTolPx ?? 8;
  const CHART_MIN = opts.chartMinPx ?? 200;
  const SPARK_MAX = opts.sparkMaxPx ?? 160;
  const EXCLUDE =
    "[role='dialog'], [role='alertdialog'], [role='tooltip'], [role='menu'], [role='listbox'], [aria-modal='true'], [popover], #freshness-drawer";
  // CARD_SURFACES (module scope), inlined.
  const CARD_ALWAYS = ".mrr-hero, .mrr-summary, .mrr-glance-tile, .mrr-quote, .mrr-upd, [data-card]";
  const CARD_TOKEN = "[style*='var(--r-card)'], [style*='var(--r-tile)']";
  const CARD_NEVER = "[role='tablist'], button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='link']";
  const INF = 1e9;

  type Box = { l: number; t: number; r: number; b: number };
  const sx = window.scrollX;
  const sy = window.scrollY;
  const toBox = (r: DOMRect | DOMRectReadOnly): Box => ({ l: r.left + sx, t: r.top + sy, r: r.right + sx, b: r.bottom + sy });
  const inter = (a: Box, b: Box): Box => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
  const ALL: Box = { l: -INF, t: -INF, r: INF, b: INF };
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const round = (n: number) => Math.round(n * 10) / 10;
  const px = (v: string) => Number.parseFloat(v) || 0;

  const styleMemo = new Map<Element, CSSStyleDeclaration>();
  const style = (el: Element): CSSStyleDeclaration => {
    let cs = styleMemo.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      styleMemo.set(el, cs);
    }
    return cs;
  };
  const hiddenMemo = new Map<Element, boolean>();
  const hidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const memo = hiddenMemo.get(el);
    if (memo !== undefined) return memo;
    const cs = style(el);
    let h = cs.display === "none" || Number.parseFloat(cs.opacity) === 0;
    if (!h && cs.display !== "contents") {
      const r = el.getBoundingClientRect();
      const clipRect = cs.clip && cs.clip !== "auto" && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip);
      const clipPath = cs.clipPath && /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && (clipRect || clipPath || cs.overflow === "hidden")) h = true;
    }
    if (!h) {
      const p = el.parentElement;
      if (p && p.tagName.toLowerCase() === "details" && !(p as HTMLDetailsElement).open && el.tagName.toLowerCase() !== "summary") h = true;
    }
    if (!h) h = hidden(el.parentElement);
    hiddenMemo.set(el, h);
    return h;
  };
  const invisible = (el: Element): boolean => hidden(el) || style(el).visibility !== "visible";
  const clips = (v: string) => v === "hidden" || v === "auto" || v === "scroll" || v === "clip";
  const clipMemo = new Map<Element, Box>();
  const contentClip = (el: Element | null): Box => {
    if (!el || el === document.documentElement || el === document.body) return ALL;
    const memo = clipMemo.get(el);
    if (memo) return memo;
    const cs = style(el);
    let box = cs.position === "fixed" ? ALL : contentClip(el.parentElement);
    if (cs.display !== "contents" && (clips(cs.overflowX) || clips(cs.overflowY))) {
      const own = toBox(el.getBoundingClientRect());
      box = inter(box, {
        l: clips(cs.overflowX) ? own.l : -INF,
        r: clips(cs.overflowX) ? own.r : INF,
        t: clips(cs.overflowY) ? own.t : -INF,
        b: clips(cs.overflowY) ? own.b : INF,
      });
    }
    clipMemo.set(el, box);
    return box;
  };
  const boxClip = (el: Element): Box => (style(el).position === "fixed" ? ALL : contentClip(el.parentElement));
  const excluded = (el: Element) => el.closest(EXCLUDE) !== null;
  const bordered = (el: Element) => {
    const cs = style(el);
    return (["top", "right", "bottom", "left"] as const).some((side) => {
      const s = cs.getPropertyValue(`border-${side}-style`);
      return px(cs.getPropertyValue(`border-${side}-width`)) >= 0.5 && s !== "none" && s !== "hidden";
    });
  };
  const isCard = (el: Element) => !el.matches(CARD_NEVER) && (el.matches(CARD_ALWAYS) || (el.matches(CARD_TOKEN) && bordered(el)));
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== document.body && parts.length < 4) {
      let step = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${step}#${n.id}`);
        break;
      }
      const cls = Array.from(n.classList).slice(0, 2);
      if (cls.length) step += `.${cls.join(".")}`;
      const tid = n.getAttribute("data-testid");
      if (tid) step += `[data-testid="${tid}"]`;
      const slot = n.getAttribute("data-slot");
      if (slot) step += `[data-slot="${slot}"]`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const snippet = (el: Element) => clean((el as HTMLElement).innerText ?? el.textContent ?? "").slice(0, 40);
  const shown = (el: Element) => {
    if (invisible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  /* Cards (the G2 list). */
  const cards: Element[] = [];
  for (const el of Array.from(document.body.querySelectorAll(`${CARD_ALWAYS}, ${CARD_TOKEN}`))) {
    if (!isCard(el) || excluded(el) || invisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    const vis = inter(toBox(r), boxClip(el));
    if (vis.r - vis.l <= 0 || vis.b - vis.t < r.height / 2) continue;
    cards.push(el);
  }
  const cardSet = new Set(cards);

  /* Rows. */
  const layoutParent = (el: Element): Element | null => {
    let p = el.parentElement;
    while (p && p !== document.body && style(p).display === "contents") p = p.parentElement;
    return p;
  };
  const isLayout = (d: string) => d.includes("grid") || d.includes("flex");
  const rowItemOf = (card: Element): { item: Element; container: Element } | null => {
    let item: Element = card;
    for (let i = 0; i <= 4; i++) {
      const p = layoutParent(item);
      if (!p || p === document.body || p === document.documentElement) return null;
      if (isLayout(style(p).display)) return { item, container: p };
      const kids = Array.from(p.children).filter(shown);
      if (kids.length !== 1 || i === 4) return null;
      item = p;
    }
    return null;
  };
  const byContainer = new Map<Element, { card: Element; top: number; height: number }[]>();
  for (const card of cards) {
    const hit = rowItemOf(card);
    if (!hit) continue;
    const r = card.getBoundingClientRect();
    const list = byContainer.get(hit.container) ?? [];
    list.push({ card, top: r.top + sy, height: r.height });
    byContainer.set(hit.container, list);
  }
  const rows: RowOffender[] = [];
  for (const [container, list] of Array.from(byContainer.entries())) {
    if (list.length < 2) continue;
    list.sort((p, q) => p.top - q.top);
    let group: typeof list = [];
    const flush = () => {
      if (group.length >= 2) {
        let tall = group[0];
        let short = group[0];
        for (const g of group) {
          if (g.height > tall.height) tall = g;
          if (g.height < short.height) short = g;
        }
        const delta = tall.height - short.height;
        if (delta > ROW_TOL) {
          rows.push({
            kind: "row",
            container: cssPath(container),
            a: { selector: cssPath(tall.card), text: snippet(tall.card), height: round(tall.height) },
            b: { selector: cssPath(short.card), text: snippet(short.card), height: round(short.height) },
            deltaPx: round(delta),
            cardsInRow: group.length,
          });
        }
      }
      group = [];
    };
    for (const it of list) {
      if (group.length && Math.abs(it.top - group[0].top) > TOP_TOL) flush();
      group.push(it);
    }
    flush();
  }
  rows.sort((p, q) => q.deltaPx - p.deltaPx);

  /* Charts. */
  const candidates = new Set<Element>();
  for (const el of Array.from(document.body.querySelectorAll("[data-chart]"))) {
    if (el.parentElement?.closest("[data-chart]")) continue;
    candidates.add(el);
  }
  for (const el of Array.from(document.body.querySelectorAll("svg, canvas"))) {
    if (el.closest("[data-chart], [data-sparkline]")) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "svg") {
      if (el.parentElement?.closest("svg")) continue;
      candidates.add(el);
      continue;
    }
    const lwc = el.closest(".tv-lightweight-charts");
    if (lwc) {
      candidates.add(lwc);
      continue;
    }
    let prev = el.previousElementSibling;
    let stacked = false;
    while (prev) {
      if (prev.tagName.toLowerCase() === "canvas") stacked = true;
      prev = prev.previousElementSibling;
    }
    if (!stacked) candidates.add(el);
  }
  const charts: ChartOffender[] = [];
  const unplaced: string[] = [];
  let measured = 0;
  for (const el of Array.from(candidates)) {
    if (excluded(el) || invisible(el)) continue;
    if (el.closest("[data-sparkline]")) continue;
    const r = el.getBoundingClientRect();
    if (r.width < SPARK_MAX || r.height <= 0) continue;
    if (!el.hasAttribute("data-chart") && r.width < CHART_MIN) continue;
    let container: Element | null = null;
    let containerKind: "slot" | "card" = "card";
    for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
      if (n.hasAttribute("data-chart-slot")) {
        container = n;
        containerKind = "slot";
        break;
      }
      if (cardSet.has(n)) {
        container = n;
        containerKind = "card";
        break;
      }
    }
    if (!container) {
      unplaced.push(cssPath(el));
      continue;
    }
    measured++;
    const cr = container.getBoundingClientRect();
    const cs = style(container);
    const left = cr.left + px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const right = cr.right - px(cs.borderRightWidth) - px(cs.paddingRight);
    const cw = Math.max(1, right - left);
    const fill = (r.width / cw) * 100;
    const offset = r.left + r.width / 2 - (left + cw / 2);
    if (fill < FILL_MIN || Math.abs(offset) > CENTRE_TOL) {
      // A Lightweight Charts root carries no label: take the nearest labelled
      // ancestor inside the container (the chart's role=img wrapper).
      const labelled = el.closest("[aria-label]");
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        (labelled && container.contains(labelled) && labelled !== container ? labelled.getAttribute("aria-label") : "") ||
        snippet(el) ||
        `<${el.tagName.toLowerCase()}>`;
      charts.push({
        kind: "chart",
        selector: cssPath(el),
        text: clean(label).slice(0, 40),
        container: cssPath(container),
        containerKind,
        widthPx: round(r.width),
        containerWidthPx: round(cw),
        fillPct: round(fill),
        centreOffsetPx: round(offset),
      });
    }
  }
  return { cards: cards.length, rows, charts, chartsMeasured: measured, chartsUnplaced: unplaced, scrollY: sy };
}

/** One line per row or chart offender for an assertion message. */
export function describeSymmetry(scan: Pick<SymmetryScan, "rows" | "charts">, max = 25): string {
  const lines = [
    ...scan.rows.map(
      (o) => `  [row] ${o.container}: ${o.a.selector} "${o.a.text}" ${o.a.height} px  vs  ${o.b.selector} "${o.b.text}" ${o.b.height} px  (Δ ${o.deltaPx} px, ${o.cardsInRow} cards)`,
    ),
    ...scan.charts.map(
      (o) =>
        `  [chart] ${o.selector} "${o.text}" in ${o.containerKind} ${o.container}: fill ${o.fillPct}% (${o.widthPx}/${o.containerWidthPx} px), centre ${o.centreOffsetPx > 0 ? "+" : ""}${o.centreOffsetPx} px`,
    ),
  ];
  const out = lines.slice(0, max);
  if (lines.length > max) out.push(`  … and ${lines.length - max} more`);
  return out.join("\n");
}
