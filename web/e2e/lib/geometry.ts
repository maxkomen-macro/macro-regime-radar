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
