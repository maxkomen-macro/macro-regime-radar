/**
 * Iteration 1, CP4 (docs/redesign-v2/ITERATION_1.md, "Copy fixes"): any block
 * with no data for the current selection says what is missing; it never
 * renders blank. PERMANENT: never tuned to pass. Runs against the running
 * Vite dev server (playwright.config.ts baseURL); servers are never started.
 *
 * The recipe (e2e/lib/states.ts, applied before the goto, a fresh context per
 * cell):
 *   snapshot  the validated snapshot seeds the query cache (Vite serves
 *             web/public/snapshot/latest.json; the cell is skipped when the
 *             gitignored seed is absent) and every data-service request is
 *             unreachable: stopApi aborts every /api, /series and /health
 *             request (the manifest paths are then served by the seed alone),
 *             and the EODHD relay socket /api/stream/ws, itself a non-manifest
 *             /api path, is closed on every connect (a sleeping backend takes
 *             the relay down with it; with the relay alive the tape and the
 *             strip would print live quotes and the missing-data copy could not
 *             be observed).
 *   down      unseed (no static snapshot, no last-known-good copy) plus the
 *             same unreachable API and relay: the data service simply did not
 *             answer.
 *
 * Views (docs/redesign-v2/BACKEND_FIXES_REPORT.md "Snapshot mode", the
 * not-covered list): /app/recession; /app/regime-lab Overview (#takeaway),
 * Scenarios (#scenarios), History & analogues (#analogues); /app/tools LBO
 * (#lbo) and Allocation (#allocation); /app/markets; /app/dashboard. Snapshot
 * cells at 1672×941 and 390×844; down cells at 1672×941.
 *
 * Per cell, after 15 s from the goto:
 *   (a) no card is blank: every visible card (geometry.ts CARD_SURFACES: the
 *       always-cards plus bordered --r-card / --r-tile surfaces, never a
 *       control; drawers, dialogs and tooltips skipped; under 40×24 px
 *       skipped) holds visible text with a letter or digit, or a labelled
 *       graphic (svg[role=img][aria-label], canvas, img[alt]) of 24×24 px or
 *       more, outside its headings (h2 to h6, role=heading below level 1), its
 *       eyebrows, its section header row (.mrr-sec-head: title, description,
 *       meta, actions) and its tablists;
 *   (b) no "Reading stored data…" anywhere on the page;
 *   (c) each not-covered panel shows a sentence naming what is missing: one
 *       sentence (src/lib/sentences.ts splitSentences over the panel's
 *       rendered lines, plus "label: value" for each summary row, the whole
 *       text of each tile, and the title / aria-label attributes of rendered
 *       elements inside the panel) that matches /snapshot/i (snapshot cells) or /did not answer/i
 *       (down cells) AND the panel's subject:
 *         Recession  hero, summary, model inputs, sensitivity, transparency
 *                    /recession model/i; curve monitor /recession model|curve|2s10s/i
 *         Regime Lab #takeaway /cycle|duration|spell|takeaway/i, #regime-outlook
 *                    /transition|duration|spell|takeaway|outlook/i, #cycle
 *                    /cycle|duration|spell/i, #transitions /transition/i,
 *                    #scenarios /scenario/i, #analogues /analogue/i
 *         Tools      #lbo-hero /LBO|calculator/i, #lbo-summary and #lbo-outputs
 *                    /LBO|calculator|deal/i; #allocation-hero,
 *                    #allocation-summary, #allocation /allocation/i
 *         Markets    #watchlist (tape), #sector-heatmap, #single-names,
 *                    #single-name-movers /price|quote|market|close/i
 *         Dashboard  #markets-glance and the strip quotes
 *                    /price|quote|market|close/i; #key-levels (the recession
 *                    key level) and the #regime-summary "NBER recession model"
 *                    row /recession model/i (the row must be present).
 * Every cell writes test-results/snapshot-empty/<state>-<view>-<w>.json with
 * the blank cards, the loading lines and each panel's candidate sentences.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { splitSentences } from "../src/lib/sentences";
import { CARD_SURFACES, waitForScreenData, writeSweepReport } from "./lib/geometry";
import { SNAPSHOT_STORAGE_KEY, stopApi, unseed } from "./lib/states";

const SNAPSHOT_FILE = path.resolve(process.cwd(), "public", "snapshot", "latest.json");
const DESK = { width: 1672, height: 941 };
const PHONE = { width: 390, height: 844 };
const WAIT_MS = 15_000;
const NOTE_LOADING = "Reading stored data…";

type CellState = "snapshot" | "down";

interface Panel {
  name: string;
  locate: (page: Page) => Locator;
  subject: RegExp;
}

interface Cp4View {
  key: string;
  route: string;
  /** SubTabs id of the sub-tab the hash selects. */
  subtab?: string;
  panels: Panel[];
}

const RECESSION_MODEL = /recession model/i;
const MARKET_SUBJECT = /price|quote|market|close/i;
const byId = (id: string) => (page: Page) => page.locator(`#${id}`);
const strip = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });
const nberRow = (page: Page) => page.locator("#regime-summary .mrr-kv-row").filter({ has: page.locator("dt", { hasText: /NBER/i }) });

const VIEWS: Cp4View[] = [
  {
    key: "recession",
    route: "/app/recession",
    panels: [
      { name: "hero", locate: byId("recession-hero"), subject: RECESSION_MODEL },
      { name: "model summary", locate: byId("recession-summary"), subject: RECESSION_MODEL },
      { name: "model inputs", locate: byId("model"), subject: RECESSION_MODEL },
      { name: "curve monitor", locate: byId("curve"), subject: /recession model|curve|2s10s/i },
      { name: "sensitivity", locate: byId("sensitivity"), subject: RECESSION_MODEL },
      { name: "model transparency", locate: byId("transparency"), subject: RECESSION_MODEL },
    ],
  },
  {
    key: "regime-lab-overview",
    route: "/app/regime-lab#takeaway",
    subtab: "overview",
    panels: [
      { name: "hero (cycle position, takeaway)", locate: byId("takeaway"), subject: /cycle|duration|spell|takeaway/i },
      { name: "regime odds & outlook", locate: byId("regime-outlook"), subject: /transition|duration|spell|takeaway|outlook/i },
      { name: "cycle position", locate: byId("cycle"), subject: /cycle|duration|spell/i },
      { name: "transition outlook", locate: byId("transitions"), subject: /transition/i },
    ],
  },
  {
    key: "regime-lab-scenarios",
    route: "/app/regime-lab#scenarios",
    subtab: "scenarios",
    panels: [{ name: "scenario builder", locate: byId("scenarios"), subject: /scenario/i }],
  },
  {
    key: "regime-lab-history",
    route: "/app/regime-lab#analogues",
    subtab: "history",
    panels: [{ name: "historical analogues", locate: byId("analogues"), subject: /analogue/i }],
  },
  {
    key: "tools-lbo",
    route: "/app/tools#lbo",
    subtab: "lbo",
    panels: [
      { name: "LBO hero", locate: byId("lbo-hero"), subject: /LBO|calculator/i },
      { name: "deal financing summary", locate: byId("lbo-summary"), subject: /LBO|calculator|deal/i },
      { name: "outputs", locate: byId("lbo-outputs"), subject: /LBO|calculator|deal/i },
    ],
  },
  {
    key: "tools-allocation",
    route: "/app/tools#allocation",
    subtab: "allocation",
    panels: [
      { name: "allocation hero", locate: byId("allocation-hero"), subject: /allocation/i },
      { name: "allocation summary", locate: byId("allocation-summary"), subject: /allocation/i },
      { name: "allocation panel", locate: byId("allocation"), subject: /allocation/i },
    ],
  },
  {
    key: "markets",
    route: "/app/markets",
    panels: [
      { name: "macro tape", locate: byId("watchlist"), subject: MARKET_SUBJECT },
      { name: "sector heatmap", locate: byId("sector-heatmap"), subject: MARKET_SUBJECT },
      { name: "single names", locate: byId("single-names"), subject: MARKET_SUBJECT },
      { name: "single-name movers", locate: byId("single-name-movers"), subject: MARKET_SUBJECT },
    ],
  },
  {
    key: "dashboard",
    route: "/app/dashboard",
    panels: [
      { name: "markets at a glance", locate: byId("markets-glance"), subject: MARKET_SUBJECT },
      { name: "strip quotes", locate: strip, subject: MARKET_SUBJECT },
      { name: "recession key level", locate: byId("key-levels"), subject: RECESSION_MODEL },
      { name: "NBER recession model row", locate: nberRow, subject: RECESSION_MODEL },
    ],
  },
];

/* ── the recipe ─────────────────────────────────────────────────────────── */

/** The EODHD relay is unreachable: every connect to /api/stream/ws is closed at once (never reaches uvicorn). */
async function stopRelay(page: Page): Promise<void> {
  await page.routeWebSocket(/\/api\/stream\/ws/, (ws) => {
    ws.close({ code: 1011, reason: "e2e: relay unreachable" });
  });
}

async function prepare(page: Page, state: CellState): Promise<void> {
  if (state === "down") await unseed(page);
  await stopApi(page);
  await stopRelay(page);
}

/* ── in-page probes (self-contained) ────────────────────────────────────── */

interface BlankCard {
  selector: string;
  text: string;
}

function auditBlankCards(s: { always: string; token: string; never: string }): { cards: number; blank: BlankCard[] } {
  const EXCLUDE = "[role='dialog'], [role='alertdialog'], [role='tooltip'], [aria-modal='true'], [popover], #freshness-drawer";
  const HEAD =
    "h2, h3, h4, h5, h6, [role='heading']:not([aria-level='1']), .mrr-sec-head, .mrr-summary-title, .mrr-hero-eyebrow, [class*='eyebrow'], [role='tablist'], [role='radiogroup']";
  const GRAPHIC = "svg[role='img'][aria-label], canvas, img[alt]:not([alt=''])";
  const clean = (t: string) => t.replace(/\s+/g, " ").trim();
  const px = (v: string) => Number.parseFloat(v) || 0;
  type VisEl = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  const visible = (el: Element): boolean => {
    const v = el as VisEl;
    if (typeof v.checkVisibility === "function" && !v.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const srOnly = (el: Element | null, stop: Element): boolean => {
    for (let n = el; n && n !== stop; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const clipped = cs.overflow === "hidden" || cs.overflow === "clip" || (cs.clip && cs.clip !== "auto") || /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && clipped) return true;
    }
    return false;
  };
  const bordered = (el: Element) => {
    const cs = getComputedStyle(el);
    return (["top", "right", "bottom", "left"] as const).some((side) => {
      const st = cs.getPropertyValue(`border-${side}-style`);
      return px(cs.getPropertyValue(`border-${side}-width`)) >= 0.5 && st !== "none" && st !== "hidden";
    });
  };
  const isCard = (el: Element) => !el.matches(s.never) && (el.matches(s.always) || (el.matches(s.token) && bordered(el)));
  const inHead = (node: Element, card: Element) => {
    const h = node.closest(HEAD);
    return h !== null && h !== card && card.contains(h);
  };
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
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };

  let cards = 0;
  const blank: BlankCard[] = [];
  for (const el of Array.from(document.body.querySelectorAll(`${s.always}, ${s.token}`))) {
    if (!isCard(el) || el.closest(EXCLUDE) || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    cards += 1;
    let body = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (!p || !visible(p) || inHead(p, el) || srOnly(p, el)) continue;
      body += ` ${(node as Text).data}`;
    }
    if (/[A-Za-z0-9]/.test(body)) continue;
    const graphic = Array.from(el.querySelectorAll(GRAPHIC)).some((g) => {
      if (inHead(g, el) || !visible(g)) return false;
      const gr = g.getBoundingClientRect();
      return gr.width >= 24 && gr.height >= 24;
    });
    if (graphic) continue;
    blank.push({ selector: cssPath(el), text: clean((el as HTMLElement).innerText).slice(0, 140) });
  }
  return { cards, blank };
}

/** The panel's candidate text units: rendered lines, "label: value" per summary row, each tile whole, title / aria-label attributes. */
function panelUnits(root: Element): string[] {
  const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
  const units: string[] = [];
  units.push(...((root as HTMLElement).innerText ?? "").split("\n").map(clean).filter(Boolean));
  const within = (sel: string) => [...(root.matches(sel) ? [root] : []), ...Array.from(root.querySelectorAll(sel))];
  for (const row of within(".mrr-kv-row")) {
    const dt = clean((row.querySelector("dt") as HTMLElement | null)?.innerText);
    const dd = clean((row.querySelector("dd") as HTMLElement | null)?.innerText);
    if (dt || dd) units.push(`${dt}: ${dd}`);
  }
  for (const tile of within(".mrr-glance-tile, .mrr-quote, [style*='var(--r-tile)']")) {
    const t = clean((tile as HTMLElement).innerText);
    if (t) units.push(t);
  }
  type VisEl = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  for (const el of within("[title], [aria-label]")) {
    // Only attributes on rendered elements (a hidden glance tab's titles say nothing on screen).
    if (typeof (el as VisEl).checkVisibility === "function" && !(el as VisEl).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    for (const attr of ["title", "aria-label"]) {
      const v = clean(el.getAttribute(attr));
      if (v) units.push(v);
    }
  }
  return units;
}

/* ── the cell ───────────────────────────────────────────────────────────── */

interface PanelResult {
  panel: string;
  found: number;
  ok: boolean;
  match: string | null;
  sentences: string[];
}

async function checkPanel(page: Page, p: Panel, need: RegExp): Promise<PanelResult> {
  const loc = p.locate(page);
  const found = await loc.count();
  if (found !== 1) return { panel: p.name, found, ok: false, match: null, sentences: [] };
  const units = await loc.evaluate(panelUnits);
  const sentences = [...new Set(units.flatMap((u) => splitSentences(u)))];
  const match = sentences.find((s) => need.test(s) && p.subject.test(s)) ?? null;
  return { panel: p.name, found, ok: match !== null, match, sentences };
}

async function runCell(page: Page, v: Cp4View, state: CellState, width: number): Promise<void> {
  const t0 = Date.now();
  await page.goto(v.route, { waitUntil: "domcontentloaded" });
  await page.locator("main").waitFor();

  // The recipe held: the snapshot was fetched and kept (seeded), or nothing was (down).
  const stored = () => page.evaluate((key) => {
    try {
      return localStorage.getItem(key) !== null;
    } catch {
      return false;
    }
  }, SNAPSHOT_STORAGE_KEY);
  if (state === "snapshot") await expect.poll(stored, { timeout: 8_000, message: "the validated snapshot seeded this page" }).toBe(true);
  else expect(await stored(), "no snapshot seeded this page (unseeded recipe)").toBe(false);

  if (v.subtab) {
    await expect(page.locator(`main [role='tab'][aria-selected='true'][id$='-tab-${v.subtab}']`), `${v.route}: the hash selects the ${v.subtab} sub-tab`).toHaveCount(1, {
      timeout: 15_000,
    });
  }
  const left = WAIT_MS - (Date.now() - t0);
  if (left > 0) await page.waitForTimeout(left);
  await waitForScreenData(page, 3_000, 300);

  const cell = `${state} ${v.route} @${width}`;
  const need = state === "snapshot" ? /snapshot/i : /did not answer/i;

  // (a) no blank card.
  const blank = await page.evaluate(auditBlankCards, { ...CARD_SURFACES });
  // (b) no loading copy left after 15 s.
  const bodyText = await page.locator("body").innerText();
  const loadingLeft = bodyText.includes(NOTE_LOADING);
  const otherLoading = [...new Set(bodyText.split("\n").map((l) => l.trim()).filter((l) => /^(?:Reading|Training|Running|Calculating|Assembling|Ranking)\b.*…/.test(l)))];
  // (c) each not-covered panel names what is missing.
  const panels: PanelResult[] = [];
  for (const p of v.panels) panels.push(await checkPanel(page, p, need));

  await writeSweepReport(test.info(), "snapshot-empty", `${state}-${v.key}-${width}`, {
    route: v.route,
    state,
    width,
    cards: blank.cards,
    blankCards: blank.blank,
    loadingLeft,
    otherLoading,
    panels,
  });
  if (otherLoading.length) test.info().annotations.push({ type: "loading-copy", description: `${cell}: ${otherLoading.join(" | ")}` });

  expect.soft(blank.blank.map((b) => `${b.selector}: "${b.text}"`), `${cell}: (a) cards with nothing beyond their heading or eyebrow`).toEqual([]);
  expect.soft(loadingLeft, `${cell}: (b) "${NOTE_LOADING}" still on the page ${WAIT_MS / 1000} s after the goto`).toBe(false);
  for (const r of panels) {
    const want = `${need} and ${v.panels.find((p) => p.name === r.panel)?.subject}`;
    const why =
      r.found !== 1
        ? `panel not found (${r.found} matches)`
        : `no sentence matches ${want}; sentences: ${r.sentences
            .slice(0, 12)
            .map((s) => `"${s.slice(0, 120)}"`)
            .join(" · ")}`;
    expect.soft(r.ok, `${cell}: (c) ${r.panel}: ${why}`).toBe(true);
  }
}

/* ── the matrix ─────────────────────────────────────────────────────────── */

test.describe("CP4 snapshot mode: seeded, API and relay unreachable", () => {
  test.skip(!fs.existsSync(SNAPSHOT_FILE), `no ${SNAPSHOT_FILE}: run scripts/build_snapshot.py first (the seed is gitignored)`);
  for (const vp of [DESK, PHONE]) {
    for (const v of VIEWS) {
      test(`CP4 snapshot ${v.key} ${vp.width}x${vp.height}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: vp });
        const page = await ctx.newPage();
        try {
          await prepare(page, "snapshot");
          await runCell(page, v, "snapshot", vp.width);
        } finally {
          await ctx.close();
        }
      });
    }
  }
});

test.describe("CP4 API down: unseeded, API and relay unreachable", () => {
  for (const v of VIEWS) {
    test(`CP4 down ${v.key} ${DESK.width}x${DESK.height}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: DESK });
      const page = await ctx.newPage();
      try {
        await prepare(page, "down");
        await runCell(page, v, "down", DESK.width);
      } finally {
        await ctx.close();
      }
    });
  }
});
