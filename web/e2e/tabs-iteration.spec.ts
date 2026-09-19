/**
 * Iteration 1, Step 3 (tab passes): the item-specific "Done when" checks of
 * docs/redesign-v2/ITERATION_1.md (plus the owner's fold-ins E1, E2, E4) that
 * the permanent G1/G2/G3 sweeps (sweep-overlap.spec.ts, sweep-layout.spec.ts)
 * cannot express. Driven in a real browser against the running Vite dev
 * server (playwright.config.ts baseURL); servers are never started here.
 * PERMANENT: never tuned to pass. Widths 1672×941 and 1280×941 unless the
 * item names others; the sidebar is seeded expanded unless stated.
 *
 *   D1  #regime-hero holds exactly one [data-chart]: four series over 24
 *       monthly points, a [data-current-month] marker, one figcaption no
 *       taller than 1.6 line-heights; the macro-charts accordion holds no
 *       regime-odds panel with every panel opened in turn, so the regime-odds
 *       chart appears once on the page.
 *   M2  Macro tape provenance (disclosures closed): at most two prose
 *       sentences, says live or close, carries a date; a "Details" disclosure
 *       on the panel reveals more text.
 *   M3  (a) a movers row under the sector heatmap lists the top three gainers
 *       and losers among the single names (relay mocked with fixed day
 *       changes) or, with no change served, a plain sentence; clicking a mover
 *       sets ?name=SYM and opens its research panel. (b) the twelve
 *       SINGLE_NAMES tickers are visible without any toggle. (c) the symbol
 *       search sits inside the viewport at 1672 / 1440 / 1280 × 941, scrollY 0,
 *       sidebar expanded and collapsed.
 *   C3  #quality-ladder: each visible explanation block has at most two
 *       sentences (the analytical callout is not a ratio explanation and is
 *       excluded); a "Details" disclosure exists.
 *   X1  1280×941 /app/recession: the h1 and the gauge lie inside the viewport
 *       at scrollY 0 (sidebar expanded and collapsed).
 *   X3  Five sliders visible in #sensitivity on load with nothing opened; the
 *       panel names the model's reading and the scenario ("adjusted" or
 *       "scenario"); ArrowRight ×3 on the unemployment slider changes the
 *       adjusted figure (the served scenario probability) while a block
 *       carrying the model's reading keeps its text; Reset returns every
 *       percentage in the panel to its on-load value.
 *   E2  "Leading-indicator proxy" nowhere on /app/recession or
 *       /app/methodology (disclosures open); "10Y − 5Y breakeven spread" on
 *       /app/recession; the model card (#transparency) and Methodology name
 *       USSLIND and February 2020.
 *   N1  /api/calendar?…include=earnings mocked with one NVDA earnings row inside
 *       the window: the hero timeline shows an NVDA marker; with none, no
 *       sentence about missing earnings in the hero, summary or calendar.
 *   N3  1672×941: no internal vertical scroll container inside #calendar;
 *       every served upcoming (non-earnings) row and the newest recent
 *       releases are rendered without any click.
 *   N4  /api/news mocked (four wire fillers on top, then one AI item with a
 *       six-sentence interpretation, six-sentence research and two sources,
 *       then one wire item): the AI row shows its analysis after one click,
 *       at most four of the twelve AI sentences visible, both source links
 *       and the article link open in a new tab with rel=noreferrer; the wire
 *       row reads "Wire summary". The same holds for a priority card (the AI
 *       item on top) within at most one click.
 *   E4  /app/news (disclosures open) never says "top 5"; the enrichment
 *       pipeline sentence names 10 and $50.
 *   E1  /api/lbo/defaults mocked with a freshness block (FEDFUNDS close
 *       monthly 2026-08-01, BAMLH0A0HYM2 close FRED daily 2026-09-17) on
 *       /app/tools and /app/credit: the text around the all-in rate (the
 *       figure's own block, up to 280 characters, plus the heading row of its
 *       card or section) says neither "today" nor "live"; the page shows
 *       "Aug 2026" and "Sep 17". HY state "unknown" adds "As of unknown" (and
 *       drops a "Sep 17"); status "fallback" adds "Stated default".
 *   Y3  /app/methodology contents entries: pointer cursor, a visible border or
 *       background, a hover colour change, a keyboard focus outline or ring, a
 *       click that scrolls the section into view, and the h1 → h2 order
 *       unchanged.
 */
import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { SINGLE_NAMES } from "../src/screens/markets/tape";
import { openAllDisclosures } from "./lib/drive";
import { seedSidebar, waitForScreenData } from "./lib/geometry";
import { emptyEndpoint } from "./lib/states";

const H = 941;
const WIDTHS = [1672, 1280];
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

async function open(page: Page, route: string, width: number, opts: { collapsed?: boolean; height?: number } = {}): Promise<void> {
  await page.setViewportSize({ width, height: opts.height ?? H });
  await seedSidebar(page, opts.collapsed ?? false);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page, 12_000, 600);
}

/** innerText, whitespace collapsed (hidden panels and closed disclosures excluded, text-transform applied). */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}

/* ── prose helpers ─────────────────────────────────────────────────────── */

/** Abbreviations whose period never ends a sentence (case-sensitive: a
 * sentence-final "no." still counts). */
const ABBREV = /\b(?:vs|e\.g|i\.e|etc|approx|cf|U\.S|Mr|Ms|Dr|Inc|Corp)\./g;

/** A block's sentences: split after . ! ? (plus a closing bracket or quote)
 * followed by whitespace, so "3.5×", "107.6%" and "Sep 18, 2026" never split;
 * a piece without a letter is not a sentence. A label without a terminator is
 * one sentence. */
export function sentences(text: string): string[] {
  const t = text.replace(ABBREV, (m) => m.replace(/\./g, "")).replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(/(?<=[.!?][)"'”’\]]*)\s+/).filter((s) => /[A-Za-z]/.test(s));
}

const DATE_RE =
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;

interface Block {
  text: string;
  mono: boolean;
  tag: string;
}

/** In-page (self-contained): the visible text blocks under `root`. A text
 * node belongs to its nearest non-inline ancestor; nodes inside `exclude`,
 * inside a disclosure panel (any aria-controls target under root), inside an
 * element whose first child's text matches `eyebrowExclude`, or visually
 * hidden are skipped. `mono` is the block's own computed font family. */
function proseBlocks(args: { root: string; exclude: string; eyebrowExclude?: string; keepPanels?: boolean }): Block[] | null {
  const root = document.querySelector(args.root);
  if (!root) return null;
  const panelIds = new Set<string>();
  if (!args.keepPanels) {
    root.querySelectorAll("[aria-expanded][aria-controls]").forEach((b) => {
      const id = b.getAttribute("aria-controls");
      if (id) panelIds.add(id);
    });
  }
  const skip = new Set<Element>();
  if (args.eyebrowExclude) {
    const re = new RegExp(args.eyebrowExclude, "i");
    root.querySelectorAll("*").forEach((el) => {
      const f = el.firstElementChild;
      if (f && re.test((f.textContent ?? "").trim())) skip.add(el);
    });
  }
  const excluded = (el: Element): boolean => {
    for (let n: Element | null = el; n; n = n.parentElement) {
      if (n.id && panelIds.has(n.id)) return true;
      if (skip.has(n)) return true;
      if (n !== root && n.matches(args.exclude)) return true;
      if (n.matches(".sr-only")) return true;
      if (n === root) break;
    }
    return false;
  };
  const inline = (el: Element) => /^(inline|inline-block|inline-flex|inline-grid|contents)$/.test(getComputedStyle(el).display);
  const shown = (el: Element): boolean => {
    const vis = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (vis && !vis.call(el, { checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const groups = new Map<Element, string>();
  const order: Element[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.textContent ?? "";
    if (!raw.trim()) continue;
    const p = n.parentElement;
    if (!p || excluded(p) || !shown(p)) continue;
    let b: Element = p;
    while (b !== root && b.parentElement && inline(b)) b = b.parentElement;
    if (!groups.has(b)) {
      groups.set(b, "");
      order.push(b);
    }
    groups.set(b, (groups.get(b) ?? "") + raw);
  }
  return order.map((b) => ({
    text: (groups.get(b) ?? "").replace(/\s+/g, " ").trim(),
    mono: /mono/i.test(getComputedStyle(b).fontFamily),
    tag: b.tagName.toLowerCase(),
  }));
}

/** Click every closed disclosure inside `scope` (not popovers, not tabs); nested ones appear after a pass. */
async function openDisclosuresIn(page: Page, scope: string, passes = 4): Promise<number> {
  let opened = 0;
  const sel = `${scope} button[aria-expanded='false']:not([aria-haspopup]):not([role='combobox'])`;
  for (let pass = 0; pass < passes; pass++) {
    const n = await page.locator(sel).count();
    if (!n) break;
    let clicked = 0;
    for (let i = 0; i < n; i++) {
      const btn = page.locator(sel).first();
      if (!(await btn.count())) break;
      try {
        await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
        await btn.click({ timeout: 3000 });
        clicked++;
        opened++;
        await page.waitForTimeout(150);
      } catch {
        break;
      }
    }
    if (!clicked) break;
  }
  return opened;
}

/* ── D1 ─────────────────────────────────────────────────────────────────── */

interface D1Probe {
  error: string | null;
  charts: number;
  series: number;
  seriesVia: string;
  months: number;
  markers: number;
  figcaptions: number;
  caption: { h: number; lh: number; text: string } | null;
}

/** In-page: the hero chart's contract. Series are `[data-series]` groups when
 * the chart tags them, else filled paths/polygons grouped by computed fill
 * (defs, clip paths and the current-month marker excluded). Months are the
 * distinct x of every path endpoint (control points skipped) or polygon
 * vertex of those series, rounded to half a pixel. */
function d1Probe(): D1Probe {
  const out: D1Probe = { error: null, charts: 0, series: 0, seriesVia: "", months: 0, markers: 0, figcaptions: 0, caption: null };
  const hero = document.getElementById("regime-hero");
  if (!hero) return { ...out, error: "no #regime-hero" };
  const charts = Array.from(hero.querySelectorAll("[data-chart]"));
  out.charts = charts.length;
  out.markers = hero.querySelectorAll("[data-current-month]").length;
  const caps = Array.from(hero.querySelectorAll("figcaption"));
  out.figcaptions = caps.length;
  if (caps[0]) {
    const cs = getComputedStyle(caps[0]);
    const lh = cs.lineHeight === "normal" ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
    const r = caps[0].getBoundingClientRect();
    const h =
      r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    out.caption = { h, lh, text: (caps[0] as HTMLElement).innerText };
  }
  if (charts.length !== 1) return out;
  const chart = charts[0];

  const endpointsX = (d: string): number[] => {
    const toks = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    const xs: number[] = [];
    let i = 0;
    let cmd = "";
    let cx = 0;
    let cy = 0;
    let sx = 0;
    let sy = 0;
    const isNum = (t: string | undefined) => t != null && !/^[a-zA-Z]$/.test(t);
    const take = (n: number) => {
      const a: number[] = [];
      for (let k = 0; k < n; k++) a.push(parseFloat(toks[i++]));
      return a;
    };
    while (i < toks.length) {
      if (!isNum(toks[i])) {
        cmd = toks[i++];
        if (cmd === "Z" || cmd === "z") {
          cx = sx;
          cy = sy;
          continue;
        }
      }
      if (!cmd) break;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === "M" || C === "L" || C === "T") {
        const [x, y] = take(2);
        cx = rel ? cx + x : x;
        cy = rel ? cy + y : y;
        if (C === "M") {
          sx = cx;
          sy = cy;
          cmd = rel ? "l" : "L";
        }
      } else if (C === "H") {
        const [x] = take(1);
        cx = rel ? cx + x : x;
      } else if (C === "V") {
        const [y] = take(1);
        cy = rel ? cy + y : y;
      } else if (C === "C") {
        const a = take(6);
        cx = rel ? cx + a[4] : a[4];
        cy = rel ? cy + a[5] : a[5];
      } else if (C === "S" || C === "Q") {
        const a = take(4);
        cx = rel ? cx + a[2] : a[2];
        cy = rel ? cy + a[3] : a[3];
      } else if (C === "A") {
        const a = take(7);
        cx = rel ? cx + a[5] : a[5];
        cy = rel ? cy + a[6] : a[6];
      } else {
        i++;
        continue;
      }
      if (Number.isNaN(cx)) break;
      xs.push(cx);
    }
    return xs;
  };

  const shapesOf = (el: Element) => (el.matches("path,polygon") ? [el] : Array.from(el.querySelectorAll("path,polygon")));
  let groups: Element[][] = [];
  const tagged = Array.from(chart.querySelectorAll("[data-series]"));
  if (tagged.length) {
    const by = new Map<string, Element[]>();
    for (const el of tagged) {
      const k = el.getAttribute("data-series") ?? "";
      by.set(k, [...(by.get(k) ?? []), ...shapesOf(el)]);
    }
    groups = [...by.values()];
    out.seriesVia = "data-series";
  } else {
    const filled = Array.from(chart.querySelectorAll("path,polygon"))
      .filter((el) => !el.closest("[data-current-month], defs, clipPath, mask, marker, pattern"))
      .filter((el) => {
        const cs = getComputedStyle(el);
        if (cs.fill === "none" || cs.fill === "transparent" || /rgba\([^)]*,\s*0\)$/.test(cs.fill)) return false;
        return parseFloat(cs.fillOpacity || "1") > 0;
      });
    const by = new Map<string, Element[]>();
    for (const el of filled) {
      const k = getComputedStyle(el).fill;
      by.set(k, [...(by.get(k) ?? []), el]);
    }
    groups = [...by.values()];
    out.seriesVia = "fill";
  }
  out.series = groups.length;
  const xs = new Set<number>();
  for (const g of groups) {
    for (const el of g) {
      if (el.tagName.toLowerCase() === "polygon") {
        const nums = (el.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        for (let i = 0; i + 1 < nums.length; i += 2) if (!Number.isNaN(nums[i])) xs.add(Math.round(nums[i] * 2) / 2);
      } else {
        for (const x of endpointsX(el.getAttribute("d") ?? "")) xs.add(Math.round(x * 2) / 2);
      }
    }
  }
  out.months = xs.size;
  return out;
}

/** In-page: labels of charts under `scope` that plot the regime odds
 * (aria-label, title or figcaption naming regime odds / probabilities). */
function regimeChartLabels(scope: string): string[] {
  const root = document.querySelector(scope);
  if (!root) return [];
  const re = /regime[\s-]*(odds|probabilit)|monthly regime/i;
  const out: string[] = [];
  const charts = new Set<Element>([...Array.from(root.querySelectorAll("[data-chart]")), ...Array.from(root.querySelectorAll("svg[role='img']"))]);
  for (const c of charts) {
    const fig = c.closest("figure");
    const label = [
      c.getAttribute("aria-label") ?? "",
      c.querySelector("title")?.textContent ?? "",
      fig?.querySelector("figcaption")?.textContent ?? "",
    ].join(" | ");
    if (re.test(label)) out.push(label.trim());
  }
  return out;
}

test.describe("D1 regime hero chart", () => {
  for (const width of WIDTHS) {
    test(`D1 ${width}x${H}: one stacked-area chart of the four regime odds in the hero, 24 months, current month marked, one-line caption; none in the macro-charts accordion`, async ({ page }) => {
      await open(page, "/app/dashboard", width);
      const hero = page.locator("#regime-hero");
      await expect(hero).toBeVisible();
      await expect(hero.locator("[data-chart]").first()).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);

      const p = await page.evaluate(d1Probe);
      note(`d1-${width}`, JSON.stringify(p));
      expect(p.error).toBeNull();
      expect(p.charts, "exactly one [data-chart] inside #regime-hero").toBe(1);
      expect(p.series, `four series in the hero chart (grouped by ${p.seriesVia})`).toBe(4);
      expect(p.months, "24 monthly points (distinct x across the series paths)").toBe(24);
      expect(p.markers, "a [data-current-month] marker in the hero").toBeGreaterThanOrEqual(1);
      expect(p.figcaptions, "one figcaption in the hero").toBe(1);
      expect(p.caption, "the figcaption is measured").not.toBeNull();
      const c = p.caption as { h: number; lh: number; text: string };
      expect(c.h, `the caption "${c.text}" renders on one line (height ${c.h.toFixed(1)} vs line-height ${c.lh.toFixed(1)})`).toBeLessThanOrEqual(
        1.6 * c.lh,
      );

      // The accordion: no panel is (or opens to) the regime odds.
      const acc = page.locator("#macro-charts");
      await expect(acc).toBeVisible();
      const buttons = acc.locator("button[aria-expanded]");
      const n = await buttons.count();
      expect(n, "the macro-charts accordion still has panels").toBeGreaterThan(0);
      const titles = (await buttons.allInnerTexts()).map(clean);
      for (const t of titles) expect(t, "no accordion panel is titled regime odds").not.toMatch(/regime[\s-]*(odds|probabilit)/i);
      for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        if ((await b.getAttribute("aria-expanded")) !== "true") {
          await b.scrollIntoViewIfNeeded();
          await b.click();
        }
        await expect(b).toHaveAttribute("aria-expanded", "true");
        await page.waitForTimeout(400);
        const inAccordion = await page.evaluate(regimeChartLabels, "#macro-charts");
        expect(inAccordion, `panel "${titles[i]}" holds no regime-odds chart`).toEqual([]);
        expect(await visibleText(acc), `panel "${titles[i]}" holds no regime-odds caption`).not.toMatch(/monthly regime odds/i);
        // Once on the page: the hero's chart and nothing regime-odds outside it.
        const outside = await page.evaluate(() => {
          const re = /regime[\s-]*(odds|probabilit)|monthly regime/i;
          const hero = document.getElementById("regime-hero");
          const main = document.querySelector("main");
          if (!main) return ["no main"];
          const out: string[] = [];
          const charts = new Set<Element>([...Array.from(main.querySelectorAll("[data-chart]")), ...Array.from(main.querySelectorAll("svg[role='img']"))]);
          for (const c of charts) {
            if (hero?.contains(c)) continue;
            const label = [c.getAttribute("aria-label") ?? "", c.querySelector("title")?.textContent ?? "", c.closest("figure")?.querySelector("figcaption")?.textContent ?? ""].join(" | ");
            if (re.test(label)) out.push(label);
          }
          return out;
        });
        expect(outside, "no regime-odds chart outside #regime-hero").toEqual([]);
      }
      expect((await page.evaluate(d1Probe)).charts, "still one chart in the hero after opening every panel").toBe(1);
    });
  }
});

/* ── M2 ─────────────────────────────────────────────────────────────────── */

/** Structure that is not provenance copy: the table well, controls, headings, svg, the single-names list. */
const TAPE_NON_COPY = "table, .mrr-scroll, button, [role='button'], .mrr-seg, [role='group'], h1, h2, h3, h4, h5, h6, svg, #single-names";

test.describe("M2 macro tape provenance", () => {
  for (const width of WIDTHS) {
    test(`M2 ${width}x${H}: at most two visible provenance sentences saying live or close with a date, the rest behind Details`, async ({ page }) => {
      await open(page, "/app/markets", width);
      const tape = page.locator("#watchlist");
      await expect(tape).toBeVisible();
      await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(800);

      // Sentences: prose blocks in the UI face, the panel header excluded.
      const prose = (await page.evaluate(proseBlocks, { root: "#watchlist", exclude: `${TAPE_NON_COPY}, .mrr-sec-head` })) ?? [];
      const counted = prose.filter((b) => !b.mono);
      const total = counted.reduce((n, b) => n + sentences(b.text).length, 0);
      note(`m2-${width}-prose`, JSON.stringify(counted.map((b) => b.text)));
      expect(total, `visible provenance prose has at most two sentences:\n${counted.map((b) => ` - ${b.text}`).join("\n")}`).toBeLessThanOrEqual(2);

      // Live-or-close and a date anywhere in the visible provenance (header meta and mono status lines included).
      const all = (await page.evaluate(proseBlocks, { root: "#watchlist", exclude: TAPE_NON_COPY })) ?? [];
      const joined = all.map((b) => b.text).join(" · ");
      note(`m2-${width}-visible`, joined);
      expect(joined, "the provenance says whether the tape is live or the last close").toMatch(/\blive\b|\bclos(e|es|ed|ing)\b/i);
      expect(joined, "the provenance carries the as-of date").toMatch(DATE_RE);

      // Details disclosure on the same panel reveals more text.
      const details = tape.locator("button[aria-expanded]:not(#single-names *)").filter({ hasText: /details/i }).first();
      await expect(details, "a Details disclosure on the macro tape panel").toHaveCount(1);
      await expect(details).toHaveAttribute("aria-expanded", "false");
      const before = (await visibleText(tape)).length;
      await details.scrollIntoViewIfNeeded();
      await details.click();
      await expect(details).toHaveAttribute("aria-expanded", "true");
      await page.waitForTimeout(250);
      const controls = await details.getAttribute("aria-controls");
      if (controls) {
        const panelText = clean(await page.locator(`[id="${controls}"]`).innerText());
        expect(panelText.length, "the Details panel carries text").toBeGreaterThan(20);
      }
      expect((await visibleText(tape)).length, "opening Details reveals more text on the panel").toBeGreaterThan(before + 20);
    });
  }
});

/* ── M3 ─────────────────────────────────────────────────────────────────── */

const SINGLE_SYMBOLS = SINGLE_NAMES.map((d) => d.symbol);

/** Fixed day changes for the mocked relay: three clear gainers, three clear losers, one missing. */
const MOVES: Record<string, number | null> = {
  NVDA: 3.3,
  AAPL: 2.1,
  TSLA: 1.2,
  COIN: 0.8,
  GOOGL: 0.5,
  MU: 0.1,
  AMZN: -0.2,
  TSM: -0.9,
  MSFT: -1.4,
  META: -2.6,
  AMD: -3.1,
  AVGO: null,
};
const TOP_GAINERS = ["NVDA", "AAPL", "TSLA"];
const TOP_LOSERS = ["AMD", "META", "MSFT"];

/** Replace the EODHD relay socket with one snapshot of the twelve single names,
 * and answer every on-demand candle request with a typed not-found, so the
 * only day changes on the page are the snapshot's (the movers fall back to
 * 5-day candles for a name the stream gives no change). */
async function mockRelay(page: Page, withChange: boolean): Promise<void> {
  await page.route(
    (u) => u.pathname.startsWith("/api/market/candles/"),
    (route) => route.fulfill({ status: 404, json: { detail: "No candles in this e2e cell.", kind: "not_found", provider: "e2e", retryable: false } }),
  );
  await page.routeWebSocket(/\/api\/stream\/ws/, (ws) => {
    ws.onMessage(() => {
      /* watch / unwatch requests: nothing to relay */
    });
    const send = () => {
      const now = Date.now();
      const items = SINGLE_SYMBOLS.map((s, i) => {
        const dc = withChange ? (MOVES[s] ?? null) : null;
        const p = 100 + i * 17.5;
        return { s, p, dc, dd: dc == null ? null : Math.round(p * dc) / 100, t: now, delayed: false, src: "ws" };
      });
      try {
        ws.send(JSON.stringify({ type: "snapshot", items, feeds: { us: "open", crypto: "open", forex: "open", vix: "rest" }, stale: {}, degraded: false, degraded_reasons: [] }));
      } catch {
        /* the page closed the socket */
      }
    };
    setTimeout(send, 300);
    setTimeout(send, 1500);
  });
}

interface MoversProbe {
  found: boolean;
  via: string;
  top: number;
  heatTop: number | null;
  items: { sym: string; text: string; tag: string }[];
  text: string;
}

/** In-page: the movers row (an element whose id, aria-label or data attribute
 * names movers, else the wrapper of a heading reading "movers") and its
 * clickable single-name items. */
function moversProbe(symbols: string[]): MoversProbe {
  const out: MoversProbe = { found: false, via: "", top: 0, heatTop: null, items: [], text: "" };
  const main = document.querySelector("main");
  if (!main) return out;
  let root: Element | null = main.querySelector("[data-movers], [id*='movers' i], [aria-label*='movers' i]");
  if (root) out.via = "attribute";
  if (!root) {
    const h = Array.from(main.querySelectorAll("h2, h3, h4, [role='heading']")).find((el) => /movers/i.test(el.textContent ?? ""));
    if (h) {
      root = h.parentElement;
      out.via = "heading";
    }
  }
  const heat = document.getElementById("sector-heatmap");
  out.heatTop = heat ? heat.getBoundingClientRect().top + window.scrollY : null;
  if (!root) return out;
  out.found = true;
  out.top = root.getBoundingClientRect().top + window.scrollY;
  // The row's own copy: its header (title, description, meta) is not the sentence.
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll(".mrr-sec-head, h1, h2, h3, h4, h5, h6, [role='heading']").forEach((el) => el.remove());
  out.text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
  const clickables = Array.from(root.querySelectorAll("a, button, [role='button'], [role='link']"));
  for (const el of clickables) {
    const t = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
    const sym = symbols.find((s) => new RegExp(`(^|[^A-Z])${s}([^A-Z]|$)`).test(t));
    if (!sym) continue;
    out.items.push({ sym, text: t, tag: el.tagName.toLowerCase() });
    // A handle for the click step (the movers row's own item, never a tape row).
    el.setAttribute("data-e2e-mover", sym);
  }
  return out;
}

test.describe("M3 markets feel like stocks", () => {
  for (const width of WIDTHS) {
    test(`M3a ${width}x${H}: movers under the sector heatmap list the top three gainers and losers, and a click opens that ticker's research`, async ({ page }) => {
      await mockRelay(page, true);
      await open(page, "/app/markets", width);
      await expect.poll(async () => (await page.evaluate(moversProbe, SINGLE_SYMBOLS)).items.length, { timeout: 15_000 }).toBeGreaterThan(0);
      const m = await page.evaluate(moversProbe, SINGLE_SYMBOLS);
      note(`m3a-${width}`, JSON.stringify(m));
      expect(m.found, "a movers row (id / aria-label / data-movers, or a Movers heading) exists").toBe(true);
      expect(m.heatTop, "the sector heatmap exists").not.toBeNull();
      expect(m.top, "the movers row sits under the sector heatmap's top").toBeGreaterThanOrEqual((m.heatTop ?? Infinity) - 1);
      const syms = [...new Set(m.items.map((i) => i.sym))];
      expect(syms.length, "at most six movers").toBeLessThanOrEqual(6);
      const gainers = [...new Set(m.items.filter((i) => /\+\s?\d/.test(i.text)).map((i) => i.sym))].sort();
      const losers = [...new Set(m.items.filter((i) => /[−-]\s?\d/.test(i.text)).map((i) => i.sym))].sort();
      expect(gainers, "the top three gainers by served day change").toEqual([...TOP_GAINERS].sort());
      expect(losers, "the top three losers by served day change").toEqual([...TOP_LOSERS].sort());

      const target = page.locator("[data-e2e-mover='NVDA']").first();
      await expect(target, "NVDA is one of the movers").toHaveCount(1);
      await target.scrollIntoViewIfNeeded();
      await target.click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("name"), { timeout: 10_000, message: "clicking a mover sets ?name=NVDA" })
        .toBe("NVDA");
      const research = page.locator("#single-name-research");
      await expect.poll(async () => /(^|[^A-Z])NVDA([^A-Z]|$)/.test(await visibleText(research)), { timeout: 30_000 }).toBe(true);
    });

    test(`M3a ${width}x${H}: with no day change served, the movers row says so in a plain sentence`, async ({ page }) => {
      await mockRelay(page, false);
      await open(page, "/app/markets", width);
      await page.waitForTimeout(2500);
      const m = await page.evaluate(moversProbe, SINGLE_SYMBOLS);
      note(`m3a-empty-${width}`, JSON.stringify(m));
      expect(m.found, "the movers row still renders").toBe(true);
      expect(m.items, "no movers without a served day change").toEqual([]);
      const plain = sentences(m.text).filter((s) => s.split(/\s+/).length >= 4);
      expect(plain.length, `a plain sentence in the movers row, got "${m.text}"`).toBeGreaterThan(0);
    });

    test(`M3b ${width}x${H}: the twelve single names are visible without any toggle`, async ({ page }) => {
      await open(page, "/app/markets", width);
      const shown = await page.evaluate((syms: string[]) => {
        const main = document.querySelector("main");
        if (!main) return [];
        const seen = new Set<string>();
        for (const el of Array.from(main.querySelectorAll("*"))) {
          const t = (el.textContent ?? "").trim();
          if (!syms.includes(t) || seen.has(t)) continue;
          const vis = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
          if (vis && !vis.call(el, { checkOpacity: true, checkVisibilityCSS: true })) continue;
          const r = el.getBoundingClientRect();
          if (r.width > 1 && r.height > 1) seen.add(t);
        }
        return [...seen];
      }, SINGLE_SYMBOLS);
      const missing = SINGLE_SYMBOLS.filter((s) => !shown.includes(s));
      expect(SINGLE_SYMBOLS.length).toBeGreaterThanOrEqual(12);
      expect(missing, "SINGLE_NAMES tickers not visible on load").toEqual([]);
    });
  }

  for (const width of [1672, 1440, 1280]) {
    for (const collapsed of [false, true]) {
      test(`M3c ${width}x${H} sidebar ${collapsed ? "collapsed" : "expanded"}: the symbol search is inside the viewport on load at scrollY 0`, async ({ page }) => {
        await open(page, "/app/markets", width, { collapsed });
        const box = page.locator("main [role='combobox'][aria-label='Search any listed symbol']").first();
        await expect(box).toBeVisible();
        const m = await page.evaluate(() => {
          const el = document.querySelector("main [role='combobox'][aria-label='Search any listed symbol']");
          const r = el?.getBoundingClientRect();
          return { y: window.scrollY, vw: window.innerWidth, vh: window.innerHeight, r: r ? { l: r.left, t: r.top, rt: r.right, b: r.bottom } : null };
        });
        expect(m.y, "scrollY on load").toBe(0);
        expect(m.r).not.toBeNull();
        const r = m.r as { l: number; t: number; rt: number; b: number };
        expect(r.t, "search top inside the viewport").toBeGreaterThanOrEqual(0);
        expect(r.b, `search bottom (${Math.round(r.b)}) inside the ${m.vh}px viewport`).toBeLessThanOrEqual(m.vh);
        expect(r.l, "search left inside the viewport").toBeGreaterThanOrEqual(0);
        expect(r.rt, "search right inside the viewport").toBeLessThanOrEqual(m.vw);
      });
    }
  }
});

/* ── C3 ─────────────────────────────────────────────────────────────────── */

test.describe("C3 quality-ladder explanations", () => {
  for (const width of WIDTHS) {
    test(`C3 ${width}x${H}: every visible explanation in #quality-ladder is at most two sentences; a Details disclosure exists`, async ({ page }) => {
      await open(page, "/app/credit", width);
      const ladder = page.locator("#quality-ladder");
      await expect(ladder).toBeVisible();
      // The ladder is ready once its chart is drawn (Lightweight Charts canvas or svg).
      await expect(ladder.locator("canvas, svg").first()).toBeVisible({ timeout: 20_000 });
      const blocks =
        (await page.evaluate(proseBlocks, {
          root: "#quality-ladder",
          exclude: ".mrr-sec-head, button, [role='button'], svg, h1, h2, h3, h4, h5, h6",
          eyebrowExclude: "^analytical callout",
        })) ?? [];
      const long = blocks.map((b) => ({ text: b.text, n: sentences(b.text).length })).filter((b) => b.n > 2);
      note(`c3-${width}`, JSON.stringify(blocks.map((b) => b.text)));
      expect(long, `explanation blocks over two sentences:\n${long.map((b) => ` - (${b.n}) ${b.text}`).join("\n")}`).toEqual([]);
      await expect(ladder.locator("button[aria-expanded]").filter({ hasText: /details/i }).first(), "a Details disclosure in the quality ladder").toHaveCount(1);
    });
  }
});

/* ── X1 ─────────────────────────────────────────────────────────────────── */

test.describe("X1 recession model above the fold", () => {
  for (const collapsed of [false, true]) {
    test(`X1 1280x${H} sidebar ${collapsed ? "collapsed" : "expanded"}: the model headline and the gauge are inside the viewport at scrollY 0`, async ({ page }) => {
      await open(page, "/app/recession", 1280, { collapsed });
      const h1 = page.locator("main h1");
      await expect(h1).toHaveCount(1);
      await expect(h1).toHaveText(/\d+(\.\d)?%/, { timeout: 60_000 });
      const gauge = page.locator("#recession-hero svg[aria-label^='Recession probability gauge']");
      await expect(gauge).toHaveCount(1, { timeout: 30_000 });
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const box = (el: Element | null) => {
          const r = el?.getBoundingClientRect();
          return r ? { t: r.top, b: r.bottom, l: r.left, r: r.right } : null;
        };
        return {
          y: window.scrollY,
          vh: window.innerHeight,
          vw: window.innerWidth,
          h1: box(document.querySelector("main h1")),
          gauge: box(document.querySelector("#recession-hero svg[aria-label^='Recession probability gauge']")),
        };
      });
      expect(m.y, "scrollY on load").toBe(0);
      for (const [name, b] of [
        ["h1", m.h1],
        ["gauge", m.gauge],
      ] as const) {
        expect(b, `${name} has a box`).not.toBeNull();
        const r = b as { t: number; b: number; l: number; r: number };
        expect(r.t, `${name} top inside the viewport`).toBeGreaterThanOrEqual(0);
        expect(r.b, `${name} bottom (${Math.round(r.b)}) inside the ${m.vh}px viewport`).toBeLessThanOrEqual(m.vh);
        expect(r.l, `${name} left inside the viewport`).toBeGreaterThanOrEqual(0);
        expect(r.r, `${name} right inside the viewport`).toBeLessThanOrEqual(m.vw);
      }
    });
  }
});

/* ── X3 ─────────────────────────────────────────────────────────────────── */

/** Every percentage the panel prints, in order. */
const PCTS = /[−+-]?\d+(?:\.\d+)?%/g;
const MODEL_READING = /model['’]?s?\s+(?:own\s+)?(?:reading|estimate|headline)/i;

/** In-page: texts of the nearest non-inline blocks under `root` that contain `needle`. */
function blocksWith(args: { root: string; needle: string }): string[] {
  const root = document.querySelector(args.root);
  if (!root) return [];
  const inline = (el: Element) => /^(inline|inline-block|inline-flex|inline-grid|contents)$/.test(getComputedStyle(el).display);
  const out = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (!(el.textContent ?? "").includes(args.needle)) continue;
    if (Array.from(el.children).some((c) => (c.textContent ?? "").includes(args.needle))) continue;
    let b: Element = el;
    while (b !== root && b.parentElement && inline(b)) b = b.parentElement;
    out.add(((b as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim());
  }
  return [...out];
}

test.describe("X3 sensitivity open by default", () => {
  for (const width of WIDTHS) {
    test(`X3 ${width}x${H}: five sliders on load, model reading vs adjusted scenario named, a slider move changes only the adjusted figure, Reset restores it`, async ({ page }) => {
      const scenario: { at: number; probability: number | null; body: string }[] = [];
      page.on("response", async (r: Response) => {
        const u = new URL(r.url());
        if (u.pathname !== "/api/recession/scenario" || r.request().method() !== "POST") return;
        try {
          const j = (await r.json()) as { probability?: number };
          scenario.push({ at: Date.now(), probability: typeof j.probability === "number" ? j.probability : null, body: r.request().postData() ?? "" });
        } catch {
          /* aborted */
        }
      });
      await open(page, "/app/recession", width);
      const h1 = page.locator("main h1");
      await expect(h1).toHaveText(/\d+(\.\d)?%/, { timeout: 60_000 });
      const headline = clean(await h1.innerText());
      const sens = page.locator("#sensitivity");
      await expect(sens).toHaveCount(1, { timeout: 30_000 });

      // Five sliders, visible, nothing opened.
      const sliders = sens.getByRole("slider");
      await expect(sliders, "five sliders in #sensitivity on load").toHaveCount(5, { timeout: 30_000 });
      for (let i = 0; i < 5; i++) await expect(sliders.nth(i), `slider ${i + 1} visible without opening anything`).toBeVisible();

      // The panel names both figures and carries the model's reading.
      const settled = async () => {
        let last = "";
        await expect
          .poll(
            async () => {
              const now = (await visibleText(sens)).match(PCTS)?.join(" ") ?? "";
              const same = now === last && now.length > 0;
              last = now;
              return same;
            },
            { timeout: 20_000, intervals: [600] },
          )
          .toBe(true);
        return last;
      };
      const pcts0 = await settled();
      const text0 = await visibleText(sens);
      note(`x3-${width}-load`, text0);
      expect(text0, "the panel names the model's own reading").toMatch(MODEL_READING);
      // "Adjusted" or "scenario" names the slider-scored figure (the X3 panel
      // reads "Scenario at current readings" until an input moves).
      expect(text0, "the panel names the adjusted scenario").toMatch(/adjusted|scenario/i);
      expect(text0, `the panel prints the model's reading ${headline}`).toContain(headline);
      const readingBlocks0 = await page.evaluate(blocksWith, { root: "#sensitivity", needle: headline });
      const before = scenario.length ? scenario[scenario.length - 1].probability : null;
      const p0 = before != null ? `${before.toFixed(1)}%` : headline;

      // Move the unemployment slider three steps with the keyboard.
      const named = sens.getByRole("slider", { name: /unemployment/i });
      const slider = (await named.count()) ? named.first() : sliders.nth(1);
      const value0 = await slider.inputValue();
      const count0 = scenario.length;
      await slider.focus();
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      expect(await slider.inputValue(), "ArrowRight ×3 moved the slider").not.toBe(value0);
      await expect.poll(() => scenario.length > count0 && scenario[scenario.length - 1].probability != null, { timeout: 20_000 }).toBe(true);
      await page.waitForTimeout(700);
      const p1 = `${(scenario[scenario.length - 1].probability as number).toFixed(1)}%`;
      await expect(sens, `the adjusted figure ${p1} is printed`).toContainText(p1, { timeout: 10_000 });
      expect(p1, "the move changed the adjusted figure").not.toBe(p0);
      const text1 = await visibleText(sens);
      expect(text1, "the model's reading is still printed").toContain(headline);
      const readingBlocks1 = await page.evaluate(blocksWith, { root: "#sensitivity", needle: headline });
      const stable = readingBlocks0.filter((b) => readingBlocks1.includes(b));
      expect(stable, `a block carrying the model's reading ${headline} keeps its text (before ${JSON.stringify(readingBlocks0)}, after ${JSON.stringify(readingBlocks1)})`).not.toEqual([]);

      // Reset returns the panel to its on-load figures.
      const reset = sens.getByRole("button", { name: /reset/i }).first();
      await expect(reset).toBeEnabled();
      await reset.click();
      await expect.poll(async () => (await visibleText(sens)).match(PCTS)?.join(" ") ?? "", { timeout: 20_000 }).toBe(pcts0);
      expect(await slider.inputValue(), "Reset returns the slider").toBe(value0);
    });
  }
});

/* ── E2 ─────────────────────────────────────────────────────────────────── */

const LEI_OLD = /leading[-\s]indicator proxy/i;
const BREAKEVEN = /10Y\s*[−-]\s*5Y breakeven spread/i;
const USSLIND_DATE = /Feb(?:ruary|\.)? 2020/;

test.describe("E2 leading-indicator rename", () => {
  for (const width of WIDTHS) {
    test(`E2 ${width}x${H}: /app/recession names the 10Y − 5Y breakeven spread, never the leading-indicator proxy; the model card names USSLIND and February 2020`, async ({ page }) => {
      await open(page, "/app/recession", width);
      await expect(page.locator("main h1")).toHaveText(/\d+(\.\d)?%/, { timeout: 60_000 });
      await openAllDisclosures(page);
      const main = await visibleText(page.locator("main"));
      expect(main, "no 'Leading-indicator proxy' on /app/recession").not.toMatch(LEI_OLD);
      expect(main, "'10Y − 5Y breakeven spread' on /app/recession").toMatch(BREAKEVEN);
      const card = page.locator("#transparency");
      await expect(card).toHaveCount(1);
      const cardText = await visibleText(card);
      expect(cardText, "the model card names USSLIND").toContain("USSLIND");
      expect(cardText, "the model card names February 2020").toMatch(USSLIND_DATE);
    });

    test(`E2 ${width}x${H}: /app/methodology never says leading-indicator proxy and names USSLIND and February 2020`, async ({ page }) => {
      await open(page, "/app/methodology", width);
      await openAllDisclosures(page);
      const main = await visibleText(page.locator("main"));
      expect(main, "no 'Leading-indicator proxy' on /app/methodology").not.toMatch(LEI_OLD);
      expect(main, "Methodology names USSLIND").toContain("USSLIND");
      expect(main, "Methodology names February 2020").toMatch(USSLIND_DATE);
    });
  }
});

/* ── N1 ─────────────────────────────────────────────────────────────────── */

function isoIn(days: number, hh: number, mm: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setUTCHours(hh, mm, 0, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

interface CalRow {
  id: number;
  event_name: string;
  event_datetime: string;
  importance: string | null;
  source: string | null;
  symbol?: string | null;
  kind?: string | null;
}

/** /api/calendar and /api/calendar/recent: the served rows minus any earnings
 * row; with `earnings`, a request carrying include=earnings on /api/calendar
 * also gets one NVDA row four days out (after the close). */
async function mockCalendar(page: Page, earnings: boolean): Promise<string[]> {
  const log: string[] = [];
  await page.route(
    (u) => u.pathname === "/api/calendar" || u.pathname === "/api/calendar/recent",
    async (route) => {
      const url = new URL(route.request().url());
      log.push(`${url.pathname}${url.search}`);
      let served: unknown = null;
      try {
        const r = await route.fetch();
        if (r.ok()) served = await r.json();
      } catch {
        served = null;
      }
      const rows = (Array.isArray(served) ? (served as CalRow[]) : []).filter((e) => e?.kind !== "earnings");
      if (earnings && url.pathname === "/api/calendar" && url.searchParams.getAll("include").includes("earnings")) {
        rows.push({
          id: 990_001,
          event_name: "NVDA earnings (Q3 2027)",
          event_datetime: isoIn(4, 20, 30),
          importance: "medium",
          source: "finnhub_earnings",
          symbol: "NVDA",
          kind: "earnings",
        });
        rows.sort((a, b) => a.event_datetime.localeCompare(b.event_datetime));
      }
      await route.fulfill({ status: 200, json: rows });
    },
  );
  return log;
}

/** An absence word within 60 characters of "earnings", either side, inside one sentence. */
const ABSENT = "(?:no|not|none|without|missing|absent|unavailable|pending|yet|until|once|when|coming)";
const EARNINGS_ABSENCE = new RegExp(`\\b${ABSENT}\\b.{0,60}\\bearnings\\b|\\bearnings\\b.{0,60}\\b${ABSENT}\\b`, "i");

test.describe("N1 earnings on the timeline", () => {
  for (const width of WIDTHS) {
    test(`N1 ${width}x${H}: one earnings row served with include=earnings puts an NVDA marker on the hero timeline`, async ({ page }) => {
      const log = await mockCalendar(page, true);
      await open(page, "/app/news", width);
      const timeline = page.locator("#news-hero [data-chart]").first();
      await expect(timeline).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () =>
            timeline.evaluate(
              (el) =>
                (el.textContent ?? "").includes("NVDA") ||
                el.querySelector("[data-symbol='NVDA']") != null ||
                (el.getAttribute("aria-label") ?? "").includes("NVDA"),
            ),
          { timeout: 15_000, message: `no NVDA marker on the timeline; calendar requests: ${JSON.stringify(log)}` },
        )
        .toBe(true);
    });

    test(`N1 ${width}x${H}: with no earnings served, no sentence mentions missing earnings`, async ({ page }) => {
      const log = await mockCalendar(page, false);
      await open(page, "/app/news", width);
      await expect(page.locator("#news-hero [data-chart]").first()).toBeVisible({ timeout: 20_000 });
      await openDisclosuresIn(page, "#news-hero");
      await openDisclosuresIn(page, "#news-summary");
      await openDisclosuresIn(page, "#calendar");
      // Sentences per visible text block (a summary row is its own block), opened panels included.
      const parts: string[] = [];
      for (const id of ["news-hero", "news-summary", "calendar"]) {
        const blocks = (await page.evaluate(proseBlocks, { root: `#${id}`, exclude: "script, style", keepPanels: true })) ?? [];
        parts.push(...blocks.map((b) => b.text));
      }
      parts.push(clean((await page.locator("#news-hero [data-chart]").first().textContent()) ?? ""));
      const bad = parts.flatMap((p) => sentences(p)).filter((s) => EARNINGS_ABSENCE.test(s));
      note(`n1-${width}-requests`, JSON.stringify(log));
      expect(bad, "sentences about missing earnings").toEqual([]);
    });
  }
});

/* ── N3 ─────────────────────────────────────────────────────────────────── */

test("N3 1672x941: #calendar has no internal scroll container and renders every upcoming row and the newest recent releases", async ({ page }) => {
  const upcoming: { days: number; rows: CalRow[] }[] = [];
  const recent: CalRow[][] = [];
  page.on("response", async (r: Response) => {
    const u = new URL(r.url());
    if (u.pathname !== "/api/calendar" && u.pathname !== "/api/calendar/recent") return;
    try {
      const j = (await r.json()) as unknown;
      if (!Array.isArray(j)) return;
      if (u.pathname === "/api/calendar") upcoming.push({ days: Number(u.searchParams.get("days") ?? 0), rows: j as CalRow[] });
      else recent.push(j as CalRow[]);
    } catch {
      /* aborted */
    }
  });
  await open(page, "/app/news", 1672);
  const cal = page.locator("#calendar");
  await expect(cal).toBeVisible();
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);

  const scrollers = await page.evaluate(() => {
    const root = document.getElementById("calendar");
    if (!root) return ["no #calendar"];
    const out: string[] = [];
    for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
      const cs = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(cs.overflowY)) continue;
      if (el.scrollHeight > el.clientHeight + 1) {
        const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
        out.push(`${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls} scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}`);
      }
    }
    return out;
  });
  expect(scrollers, "internal vertical scroll containers inside #calendar").toEqual([]);

  expect(upcoming.length, "the page read /api/calendar").toBeGreaterThan(0);
  const window30 = upcoming.reduce((a, b) => (b.days >= a.days ? b : a));
  const macroRows = window30.rows.filter((e) => e.kind !== "earnings");
  const text = await visibleText(cal);
  const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;
  const need = new Map<string, number>();
  for (const e of macroRows) need.set(e.event_name, (need.get(e.event_name) ?? 0) + 1);
  const short = [...need].filter(([name, n]) => occurrences(text, name) < n).map(([name, n]) => `${name} (${occurrences(text, name)} of ${n})`);
  note("n3-upcoming", `${macroRows.length} served rows in ${window30.days} days`);
  expect(short, "served upcoming rows not rendered in #calendar without a click").toEqual([]);

  expect(recent.length, "the page read /api/calendar/recent").toBeGreaterThan(0);
  const newest = recent[recent.length - 1].filter((e) => e.kind !== "earnings");
  if (newest.length) {
    const at = text.search(/recent releases/i);
    expect(at, "a Recent releases block in #calendar").toBeGreaterThanOrEqual(0);
    const tail = text.slice(at);
    const expected = newest.slice(0, Math.min(3, newest.length)).map((e) => e.event_name);
    const missing = expected.filter((name) => !tail.includes(name));
    expect(missing, "the newest recent releases rendered under Recent releases").toEqual([]);
  }
});

/* ── N4 ─────────────────────────────────────────────────────────────────── */

const AI_URL = "https://example.com/e2e/ai-article";
const WIRE_URL = "https://example.com/e2e/wire-article";
const SRC_1 = "https://example.org/e2e/source-one";
const SRC_2 = "https://example.net/e2e/source-two";
const AI_INTERP = [
  "Kestrel demand at the auction pushed yields lower across the curve.",
  "Heron positioning suggests investors expect slower growth ahead.",
  "Osprey flows into duration usually precede a softer macro print.",
  "Plover signals from breakevens show inflation expectations holding steady.",
  "Wren readings on credit spreads show no stress spilling over.",
  "Tern implications for the regime call lean toward Goldilocks for now.",
];
const AI_RESEARCH = [
  "Lynx analysts cited the strongest bid-to-cover ratio this year.",
  "Ocelot dealers took down a smaller share than usual.",
  "Caracal foreign demand rose for the third straight auction.",
  "Margay strategists expect the curve to steepen modestly.",
  "Serval futures positioning remains short the long end.",
  "Jaguar commentary flagged the upcoming payrolls report as the next test.",
];
const AI_SENTENCES = [...AI_INTERP, ...AI_RESEARCH];

function newsItem(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 0,
    headline: "",
    summary: null,
    url: null,
    source: "Reuters",
    category: "MACRO",
    published_at: new Date(Date.now() - 2 * 3_600_000).toISOString().replace("Z", "+00:00"),
    fetched_at: new Date(Date.now() - 2 * 3_600_000).toISOString().slice(0, 19).replace("T", " "),
    market_impact: 3,
    deal_size: 1,
    sector_relevance: 3,
    time_sensitivity: 3,
    regime_relevance: 3,
    overall_significance: 3,
    regime_interpretation: null,
    perplexity_research: null,
    ticker: null,
    ...over,
  };
}

const AI_ITEM = (sig: number) =>
  newsItem({
    id: 990_101,
    headline: "Mock AI desk item: Treasury auction draws record demand",
    summary: "Wire blurb for the AI item says demand was strong.",
    url: AI_URL,
    overall_significance: sig,
    regime_interpretation: AI_INTERP.join(" "),
    perplexity_research: `${AI_RESEARCH.join(" ")}\n\nSources:\n${SRC_1}\n${SRC_2}`,
  });
const WIRE_ITEM = (sig: number) =>
  newsItem({
    id: 990_102,
    headline: "Mock wire item: Factory orders edge higher in August",
    summary: "Factory orders rose modestly in August. Analysts had expected a flat print.",
    url: WIRE_URL,
    source: "CNBC",
    overall_significance: sig,
  });
const FILLERS = [4.9, 4.8, 4.7, 4.6].map((sig, i) =>
  newsItem({
    id: 990_200 + i,
    headline: `Mock filler ${i + 1}: central bank minutes note ${["steady", "patient", "cautious", "balanced"][i]} policy`,
    summary: `Filler ${i + 1} wire summary for the priority slot.`,
    url: `https://example.com/e2e/filler-${i + 1}`,
    overall_significance: sig,
    published_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString().replace("Z", "+00:00"),
  }),
);

/** In-page: tag the card or row holding the headline link `url` — the largest
 * ancestor that contains no other mocked headline link — with data-e2e-row. */
function markRow(args: { url: string; urls: string[]; tag: string }): boolean {
  const link = document.querySelector(`main a[href="${args.url}"]`);
  if (!link) return false;
  const others = args.urls.filter((u) => u !== args.url);
  let row: Element = link;
  while (row.parentElement && row.parentElement.tagName !== "MAIN") {
    const p = row.parentElement;
    if (others.some((u) => p.querySelector(`a[href="${u}"]`))) break;
    row = p;
  }
  row.setAttribute("data-e2e-row", args.tag);
  return true;
}

async function aiSentencesVisible(row: Locator): Promise<string[]> {
  const t = clean(await row.innerText()).toLowerCase();
  return AI_SENTENCES.filter((s) => t.includes(s.toLowerCase()));
}

/** At most one click on the row's analysis toggle (preferring one that names the read / analysis / sources). */
async function openAnalysis(row: Locator, force: boolean): Promise<number> {
  if (!force) return 0;
  const toggles = row.locator("button[aria-expanded='false']");
  if (!(await toggles.count())) return 0;
  const preferred = toggles.filter({ hasText: /read|analysis|\bAI\b|source|why/i });
  const pick = (await preferred.count()) ? preferred.first() : toggles.first();
  // Pin the chosen toggle: the aria-expanded='false' locator stops matching once it opens.
  await pick.evaluate((el) => el.setAttribute("data-e2e-toggle", "analysis"));
  const btn = row.locator("[data-e2e-toggle='analysis']").first();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  await row.page().waitForTimeout(250);
  return 1;
}

async function expectLink(row: Locator, href: string, what: string): Promise<void> {
  const a = row.locator(`a[href="${href}"]`).first();
  await expect(a, `${what} is present and visible`).toBeVisible();
  await expect(a, `${what} opens in a new tab`).toHaveAttribute("target", "_blank");
  await expect(a, `${what} carries rel=noreferrer`).toHaveAttribute("rel", /\bnoreferrer\b/);
}

test.describe("N4 AI analysis per article", () => {
  for (const width of WIDTHS) {
    test(`N4 ${width}x${H}: a list row with AI content shows it after one click (≤ 4 sentences, both sources, the article link); the wire row reads Wire summary`, async ({ page }) => {
      await emptyEndpoint(page, "/api/news", [...FILLERS, AI_ITEM(3.2), WIRE_ITEM(3.0)]);
      await open(page, "/app/news", width);
      const feed = page.locator("#feed");
      await expect(feed.locator(`a[href="${AI_URL}"]`).first()).toBeVisible({ timeout: 20_000 });
      const urls = [AI_URL, WIRE_URL, ...FILLERS.map((f) => String(f.url))];
      expect(await page.evaluate(markRow, { url: AI_URL, urls, tag: "ai" })).toBe(true);
      expect(await page.evaluate(markRow, { url: WIRE_URL, urls, tag: "wire" })).toBe(true);
      const ai = page.locator("[data-e2e-row='ai']");
      const wire = page.locator("[data-e2e-row='wire']");
      await expect(ai, "the AI item renders as a More-headlines row").toHaveCount(1);

      const clicks = await openAnalysis(ai, true);
      expect(clicks, "one click opens the row's analysis").toBe(1);
      const shown = await aiSentencesVisible(ai);
      note(`n4-row-${width}`, JSON.stringify(shown));
      expect(shown.length, "the AI analysis is visible after one click").toBeGreaterThan(0);
      expect(shown.length, `at most four AI sentences visible (nested Details closed): ${JSON.stringify(shown)}`).toBeLessThanOrEqual(4);
      await expectLink(ai, SRC_1, "cited source 1");
      await expectLink(ai, SRC_2, "cited source 2");
      await expectLink(ai, AI_URL, "the article link");

      await expect(wire, "the wire item renders as a row").toHaveCount(1);
      await expect(wire, "the wire row is labelled Wire summary").toContainText(/wire summary/i);
    });

    test(`N4 ${width}x${H}: a priority card with AI content shows it within one click (≤ 4 sentences, both sources, the article link); the wire card reads Wire summary`, async ({ page }) => {
      await emptyEndpoint(page, "/api/news", [AI_ITEM(4.8), WIRE_ITEM(4.6)]);
      await open(page, "/app/news", width);
      const lead = page.locator("#headlines");
      await expect(lead.locator(`a[href="${AI_URL}"]`).first()).toBeVisible({ timeout: 20_000 });
      const urls = [AI_URL, WIRE_URL];
      expect(await page.evaluate(markRow, { url: AI_URL, urls, tag: "ai" })).toBe(true);
      expect(await page.evaluate(markRow, { url: WIRE_URL, urls, tag: "wire" })).toBe(true);
      const ai = page.locator("#headlines [data-e2e-row='ai']");
      const wire = page.locator("#headlines [data-e2e-row='wire']");
      await expect(ai, "the AI item renders as a priority card").toHaveCount(1);

      const srcVisible = async () => (await ai.locator(`a[href="${SRC_1}"]`).count()) > 0 && (await ai.locator(`a[href="${SRC_1}"]`).first().isVisible());
      const needClick = (await aiSentencesVisible(ai)).length === 0 || !(await srcVisible());
      const clicks = await openAnalysis(ai, needClick);
      expect(clicks, "at most one click").toBeLessThanOrEqual(1);
      const shown = await aiSentencesVisible(ai);
      note(`n4-lead-${width}`, JSON.stringify({ clicks, shown }));
      expect(shown.length, "the AI analysis is visible within one click").toBeGreaterThan(0);
      expect(shown.length, `at most four AI sentences visible: ${JSON.stringify(shown)}`).toBeLessThanOrEqual(4);
      await expectLink(ai, SRC_1, "cited source 1");
      await expectLink(ai, SRC_2, "cited source 2");
      await expectLink(ai, AI_URL, "the article link");

      await expect(wire, "the wire item renders as a priority card").toHaveCount(1);
      await expect(wire, "the wire card is labelled Wire summary").toContainText(/wire summary/i);
    });
  }
});

/* ── E4 ─────────────────────────────────────────────────────────────────── */

test.describe("E4 enrichment copy", () => {
  for (const width of WIDTHS) {
    test(`E4 ${width}x${H}: /app/news never says "top 5"; the enrichment pipeline sentence names 10 and $50`, async ({ page }) => {
      await open(page, "/app/news", width);
      await openAllDisclosures(page);
      const main = await visibleText(page.locator("main"));
      expect(main.match(/.{0,80}\btop 5\b.{0,80}/i)?.[0] ?? null, 'no "top 5" on /app/news').toBeNull();
      const blocks = await page.evaluate(() => {
        const main = document.querySelector("main");
        if (!main) return [];
        const out: string[] = [];
        for (const el of Array.from(main.querySelectorAll("p, div, li, span, small"))) {
          const t = ((el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
          if (t.length > 900 || !/Claude|Perplexity/i.test(t) || !/pipeline|hourly|each run|per run/i.test(t)) continue;
          out.push(t);
        }
        return out;
      });
      expect(blocks.length, "a pipeline sentence naming Claude or Perplexity").toBeGreaterThan(0);
      const both = blocks.filter((t) => /\b10\b/.test(t) && /\$50\b/.test(t));
      expect(both, `the pipeline sentence names 10 and $50; candidates:\n${blocks.map((b) => ` - ${b}`).join("\n")}`).not.toEqual([]);
    });
  }
});

/* ── E1 ─────────────────────────────────────────────────────────────────── */

type LboVariant = "close" | "unknown" | "fallback";

interface LboServed {
  fedfunds: number;
  hy_oas_pct: number;
  lbo_all_in_rate: number;
}

function fresh(id: string, label: string, kind: string, cadence: string, asOf: string | null, state: string, cycles: number | null, reason: string) {
  return { id, label, kind, cadence, as_of: asOf, state, delay_min: null, cycles_behind: cycles, stale: state === "stale", discontinued: false, reason };
}

function lboPayload(variant: LboVariant, served: LboServed | null): Record<string, unknown> {
  const base: LboServed = served ?? { fedfunds: 3.63, hy_oas_pct: 2.65, lbo_all_in_rate: 6.28 };
  const FEDFUNDS_CLOSE = fresh("FEDFUNDS", "Fed funds (effective, monthly)", "fred", "monthly", "2026-08-01", "close", 0, "Fed funds for Aug 2026 is the newest print due.");
  const HY_CLOSE = fresh("BAMLH0A0HYM2", "High-yield OAS", "fred", "daily", "2026-09-17", "close", 0, "High-yield OAS observed 2026-09-17, the newest print due.");
  const HY_UNKNOWN = fresh("BAMLH0A0HYM2", "High-yield OAS", "fred", "daily", null, "unknown", null, "High-yield OAS: the true observation date is not recorded yet.");
  if (variant === "fallback") {
    return {
      fedfunds: 5.33,
      hy_oas_pct: 3.27,
      lbo_all_in_rate: 8.6,
      data_as_of: "unavailable",
      status: "fallback",
      is_fallback: true,
      fedfunds_as_of: null,
      hy_oas_as_of: null,
      freshness: {
        FEDFUNDS: fresh("FEDFUNDS", "Fed funds (effective, monthly)", "fred", "monthly", null, "unknown", null, "No stored Fed funds rows could be read."),
        BAMLH0A0HYM2: HY_UNKNOWN,
        lbo_all_in_rate: fresh("lbo_all_in_rate", "LBO all-in rate", "derived", "daily", null, "fallback", null, "Stated defaults stand in for the stored rates."),
      },
    };
  }
  return {
    ...base,
    data_as_of: "2026-09-01",
    status: "live",
    is_fallback: false,
    fedfunds_as_of: "2026-08-01",
    hy_oas_as_of: "2026-09-01",
    freshness: {
      FEDFUNDS: FEDFUNDS_CLOSE,
      BAMLH0A0HYM2: variant === "unknown" ? HY_UNKNOWN : HY_CLOSE,
      lbo_all_in_rate: fresh(
        "lbo_all_in_rate",
        "LBO all-in rate",
        "derived",
        "daily",
        "2026-08-01",
        variant === "unknown" ? "unknown" : "close",
        null,
        "Fed funds (monthly average) plus the high-yield spread; judged by its weaker component.",
      ),
    },
  };
}

interface RateContext {
  fig: string;
  unit: string;
  header: string;
}

/** In-page: for every visible innermost element in <main> printing one of
 * `figs`, its own block (climbing while the parent's text stays within 280
 * characters) and the heading row of the nearest card or section above it. */
function rateContexts(figs: string[]): RateContext[] {
  const main = document.querySelector("main");
  if (!main) return [];
  const out: RateContext[] = [];
  const txt = (el: Element) => ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  for (const el of Array.from(main.querySelectorAll("*"))) {
    const t = el.textContent ?? "";
    const fig = figs.find((f) => t.includes(f));
    if (!fig) continue;
    if (Array.from(el.children).some((c) => (c.textContent ?? "").includes(fig))) continue;
    const vis = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
    if (vis && !vis.call(el, { checkOpacity: true, checkVisibilityCSS: true })) continue;
    let unit: Element = el;
    while (unit.parentElement && unit.parentElement !== main && txt(unit.parentElement).length <= 280) unit = unit.parentElement;
    let header = "";
    for (let a: Element | null = unit.parentElement; a && a !== main.parentElement; a = a.parentElement) {
      const h = Array.from(a.querySelectorAll("h1, h2, h3, h4")).find(
        (x) => !unit.contains(x) && !x.contains(el) && (x.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
      );
      if (h) {
        const wrap = h.parentElement && txt(h.parentElement).length <= 200 ? h.parentElement : h;
        header = txt(wrap);
        break;
      }
    }
    out.push({ fig, unit: txt(unit), header });
  }
  return out;
}

const NOT_LIVE = /\btoday|\blive\b/i;
const count = (hay: string, re: RegExp) => (hay.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)) ?? []).length;

test.describe("E1 all-in rate copy follows the freshness block", () => {
  for (const route of ["/app/tools", "/app/credit"]) {
    for (const width of WIDTHS) {
      test(`E1 ${route} ${width}x${H}: no "today" or "live" around the all-in rate, Aug 2026 and Sep 17 shown; unknown HY shows As of unknown; fallback shows Stated default`, async ({ page }) => {
        const state: { variant: LboVariant; served: LboServed | null; creditCost: string | null } = { variant: "close", served: null, creditCost: null };
        await emptyEndpoint(page, "/api/lbo/defaults", (served: unknown) => {
          const s = served as Partial<LboServed> | null;
          if (s && typeof s.lbo_all_in_rate === "number" && typeof s.fedfunds === "number" && typeof s.hy_oas_pct === "number") {
            state.served = { fedfunds: s.fedfunds, hy_oas_pct: s.hy_oas_pct, lbo_all_in_rate: s.lbo_all_in_rate };
          }
          return lboPayload(state.variant, state.served);
        });
        page.on("response", async (r: Response) => {
          if (new URL(r.url()).pathname !== "/api/credit/metrics") return;
          try {
            const j = (await r.json()) as { lbo_all_in_cost?: unknown };
            if (typeof j.lbo_all_in_cost === "string" && /\d/.test(j.lbo_all_in_cost)) state.creditCost = j.lbo_all_in_cost.trim();
          } catch {
            /* aborted */
          }
        });

        const load = async (variant: LboVariant) => {
          state.variant = variant;
          await open(page, route, width);
          const rate = variant === "fallback" ? 8.6 : (state.served?.lbo_all_in_rate ?? 6.28);
          const fig = `${rate.toFixed(2)}%`;
          // Credit's big number is /api/credit/metrics' own all-in string; the
          // mocked defaults feed only its components, so either figure counts.
          const shownFigs = () => [fig, ...(state.creditCost && route === "/app/credit" ? [state.creditCost] : [])];
          const rendered = async () => shownFigs().some((f) => f.length > 0 && lastMain.includes(f));
          let lastMain = "";
          const waitRendered = (ms: number) =>
            expect
              .poll(
                async () => {
                  lastMain = await visibleText(page.locator("main"));
                  return rendered();
                },
                { timeout: ms, message: `the ${variant} all-in rate (${shownFigs().join(" or ")}) renders` },
              )
              .toBe(true);
          try {
            await waitRendered(20_000);
          } catch (err) {
            // One reload when the shared API answered nothing (rate bucket or a
            // busy worker): the service-down copy is not what this cell measures.
            if (!/data service did not answer/i.test(lastMain)) throw err;
            note(`e1-${route}-${width}-${variant}-retry`, "the data service did not answer; reloaded once");
            await page.waitForTimeout(3000);
            await page.reload({ waitUntil: "domcontentloaded" });
            await waitForScreenData(page, 12_000, 600);
            await waitRendered(30_000);
          }
          await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
          await page.waitForTimeout(600);
          const figs = shownFigs();
          const contexts = await page.evaluate(rateContexts, figs);
          const text = await visibleText(page.locator("main"));
          return { fig, contexts, text };
        };

        // Close: stored prints with their true dates.
        const close = await load("close");
        note(`e1-${route}-${width}-close`, JSON.stringify(close.contexts));
        expect(close.contexts.length, `the all-in rate ${close.fig} is found on the page`).toBeGreaterThan(0);
        const liveWords = close.contexts.filter((c) => NOT_LIVE.test(c.unit) || NOT_LIVE.test(c.header));
        expect(liveWords, `"today" / "live" around the all-in rate:\n${liveWords.map((c) => ` - [${c.header}] ${c.unit}`).join("\n")}`).toEqual([]);
        expect(close.text, "the Fed funds print month (Aug 2026)").toContain("Aug 2026");
        expect(close.text, "the HY spread observation date (Sep 17)").toMatch(/\bSep 17\b/);

        // Unknown HY observation: "As of unknown", and no Sep 17 for it.
        const unknown = await load("unknown");
        note(`e1-${route}-${width}-unknown`, JSON.stringify(unknown.contexts));
        expect(count(unknown.text, /As of unknown/i), "BAMLH0A0HYM2 unknown adds an 'As of unknown'").toBeGreaterThan(count(close.text, /As of unknown/i));
        expect(count(unknown.text, /\bSep 17\b/), "the unknown HY series no longer shows Sep 17").toBeLessThan(count(close.text, /\bSep 17\b/));

        // Fallback: the stated defaults, never live.
        const fallback = await load("fallback");
        note(`e1-${route}-${width}-fallback`, JSON.stringify(fallback.contexts));
        expect(count(fallback.text, /Stated default/i), "status fallback adds 'Stated default'").toBeGreaterThan(count(close.text, /Stated default/i));
        const liveFallback = fallback.contexts.filter((c) => NOT_LIVE.test(c.unit) || NOT_LIVE.test(c.header));
        expect(liveFallback, `"today" / "live" around the fallback rate:\n${liveFallback.map((c) => ` - [${c.header}] ${c.unit}`).join("\n")}`).toEqual([]);
      });
    }
  }
});

/* ── Y3 ─────────────────────────────────────────────────────────────────── */

/** The route's h1 → h2 order at the start of Step 3 (titles only; the h2s carry a right-hand meta). */
const METHODOLOGY_HEADINGS: [string, string][] = [
  ["H1", "Methodology"],
  ["H2", "How to read this product"],
  ["H2", "The four regimes"],
  ["H2", "Monitored signals"],
  ["H2", "Models and scenarios"],
  ["H2", "Backtests and evidence"],
  ["H2", "Meaning ramps and vocabularies"],
  ["H2", "Data and sources"],
  ["H2", "What the model can and cannot claim"],
];

interface EntryStyle {
  cursor: string;
  bg: string;
  borders: { w: number; s: string; c: string }[];
  outlineStyle: string;
  outlineWidth: number;
  shadow: string;
}

function entryStyles(i: number): { a: EntryStyle; li: EntryStyle | null } | null {
  const a = document.querySelectorAll("nav[aria-label='Methodology contents'] a")[i] as HTMLElement | undefined;
  if (!a) return null;
  const pick = (el: Element): EntryStyle => {
    const cs = getComputedStyle(el);
    return {
      cursor: cs.cursor,
      bg: cs.backgroundColor,
      borders: (["Top", "Right", "Bottom", "Left"] as const).map((s) => ({
        w: parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`)),
        s: cs.getPropertyValue(`border-${s.toLowerCase()}-style`),
        c: cs.getPropertyValue(`border-${s.toLowerCase()}-color`),
      })),
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth),
      shadow: cs.boxShadow,
    };
  };
  const li = a.closest("li");
  return { a: pick(a), li: li ? pick(li) : null };
}

/** Alpha of a computed colour (rgb/rgba, slash syntax, transparent). */
function alpha(color: string): number {
  if (!color || color === "transparent") return 0;
  const slash = color.match(/\/\s*([\d.]+%?)\s*\)$/);
  if (slash) return slash[1].endsWith("%") ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
  const rgba = color.match(/^rgba\(\s*[^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/);
  if (rgba) return parseFloat(rgba[1]);
  return 1;
}
const hasSurface = (s: EntryStyle) => alpha(s.bg) > 0 || s.borders.some((b) => b.w > 0 && b.s !== "none" && b.s !== "hidden" && alpha(b.c) > 0);
const surfaceKey = (s: EntryStyle) => `${s.bg}|${s.borders.map((b) => `${b.w}/${b.s}/${b.c}`).join(",")}`;
const ringKey = (s: EntryStyle) => `${s.outlineStyle}/${s.outlineWidth}|${s.shadow}`;

test.describe("Y3 methodology contents look clickable", () => {
  for (const width of WIDTHS) {
    test(`Y3 ${width}x${H}: contents entries are cards with pointer, hover and focus states; a click scrolls its section into view; h1 → h2 order unchanged`, async ({ page }) => {
      await open(page, "/app/methodology", width);
      const entries = page.locator("nav[aria-label='Methodology contents'] a");
      await expect(entries.first()).toBeVisible();
      const n = await entries.count();
      expect(n, "the contents list its eight sections").toBeGreaterThanOrEqual(8);

      // Heading order.
      const headings = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main h1, main h2")).map((h) => [h.tagName, (h.textContent ?? "").replace(/\s+/g, " ").trim()] as [string, string]),
      );
      expect(headings.length, `h1/h2 count unchanged: ${JSON.stringify(headings)}`).toBe(METHODOLOGY_HEADINGS.length);
      METHODOLOGY_HEADINGS.forEach(([tag, title], i) => {
        expect(headings[i]?.[0], `heading ${i + 1} level`).toBe(tag);
        expect(headings[i]?.[1] ?? "", `heading ${i + 1} title`).toMatch(new RegExp(`^${escapeRe(title)}`));
      });

      // Rest state: pointer cursor and a visible surface on every entry.
      await page.mouse.move(1, 1);
      await page.waitForTimeout(300);
      const rest: { a: EntryStyle; li: EntryStyle | null }[] = [];
      for (let i = 0; i < n; i++) {
        const s = await page.evaluate(entryStyles, i);
        expect(s, `entry ${i + 1} measured`).not.toBeNull();
        rest.push(s as { a: EntryStyle; li: EntryStyle | null });
        const label = clean(await entries.nth(i).innerText());
        expect((s as { a: EntryStyle }).a.cursor, `entry "${label}" has a pointer cursor`).toBe("pointer");
        const surf = hasSurface((s as { a: EntryStyle }).a) || ((s as { li: EntryStyle | null }).li != null && hasSurface((s as { li: EntryStyle }).li));
        expect(surf, `entry "${label}" has a visible border or background`).toBe(true);
      }

      // Hover changes the border or background colour.
      const k = Math.min(2, n - 1);
      await entries.nth(k).hover();
      await page.waitForTimeout(450);
      const hovered = (await page.evaluate(entryStyles, k)) as { a: EntryStyle; li: EntryStyle | null };
      const hoverChanged =
        surfaceKey(hovered.a) !== surfaceKey(rest[k].a) || (hovered.li != null && rest[k].li != null && surfaceKey(hovered.li) !== surfaceKey(rest[k].li as EntryStyle));
      expect(hoverChanged, "hover changes the entry's border or background colour").toBe(true);
      await page.mouse.move(1, 1);
      await page.waitForTimeout(300);

      // Keyboard focus shows an outline or a ring.
      await entries.nth(0).focus();
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250);
      const focusedIndex = await page.evaluate(() =>
        Array.from(document.querySelectorAll("nav[aria-label='Methodology contents'] a")).indexOf(document.activeElement as HTMLAnchorElement),
      );
      expect(focusedIndex, "Tab moves to the next contents entry").toBe(1);
      const focused = (await page.evaluate(entryStyles, 1)) as { a: EntryStyle; li: EntryStyle | null };
      const outline = (s: EntryStyle) => s.outlineStyle !== "none" && s.outlineWidth > 0;
      const ring = (now: EntryStyle, before: EntryStyle) => now.shadow !== "none" && ringKey(now) !== ringKey(before);
      const shows =
        outline(focused.a) ||
        ring(focused.a, rest[1].a) ||
        (focused.li != null && rest[1].li != null && (outline(focused.li) || ring(focused.li, rest[1].li as EntryStyle)));
      expect(shows, `keyboard focus shows an outline or ring (${JSON.stringify(focused.a)})`).toBe(true);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      // A click scrolls its section into view.
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior }));
      await page.waitForTimeout(200);
      const dataTop = async () => page.evaluate(() => document.getElementById("data")?.getBoundingClientRect().top ?? -1);
      expect(await dataTop(), "#data starts below the fold").toBeGreaterThan(H);
      await entries.filter({ hasText: "Data and sources" }).first().click();
      await expect
        .poll(async () => {
          const t = await dataTop();
          return t >= -1 && t < H;
        }, { timeout: 10_000 })
        .toBe(true);
    });
  }
});
