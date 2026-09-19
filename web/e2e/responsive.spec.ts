/**
 * Phase 10 checklist (docs/redesign-v2/checklists/10-states-a11y.md) B.1 to
 * B.3, D and E.3 #3 and #4: the width matrix, driven against the running Vite
 * dev server (playwright.config.ts baseURL; servers are never started here).
 * One test per width (1672, 1280, 1024, 768, 390) walks the 18 pages of B.2
 * with the route slugs given there and, per cell, asserts the B.1 layout the
 * verifier measured (strip columns 4 / 2 / 2 / 2 / 1, the hero row two
 * columns down to 1620 and the hero's inner grid two columns down to 1200
 * since Iteration 1 (1200 and 1520 before: the stacked hero beside the
 * summary left the summary 300 to 620 px of blank), the
 * dashboard glance two columns from 859.98 down) and the B.3 rules #1 to #4
 * and #7: no horizontal page scroll and no element past the viewport that no
 * ancestor clips or scrolls; exactly one h1, inside main on /app/* routes; a
 * monotone heading order; every sections.ts id for the route (with the
 * sections.spec retry at the end of the width); the landmarks; the title;
 * the skip link first. One palette jump to #curve per width (through the
 * MobileNav "Jump to a section" button at 768 and 390). The `.mrr-hero-viz`
 * width at 1280 goes into responsive-report.json (report only; under 200 px
 * is flagged there, never asserted). Captures `<route>--<width>.png` (full
 * page) and console.json keyed `${route}--${width}--live` land in
 * docs/redesign-v2/captures/<branch-slug>/ (CAPTURE_DIR overrides). Tap
 * targets are never gated. The assistant panel is never opened here.
 */
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { baselineConsoleTexts, captureDir, collect, inView, mergeJsonFile, settle, type ConsoleRec, type FailedReq } from "./lib/drive";
import { auditHeadings, auditLandmarks, auditOverflow } from "./lib/a11y";
import { consoleVerdict } from "./lib/states";

const OUT = captureDir();
const CONSOLE_PATH = path.join(OUT, "console.json");
const REPORT_PATH = path.join(OUT, "responsive-report.json");
const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";

interface PageDef {
  /** Capture slug (B.2). */
  slug: string;
  route: string;
  /** sections.ts tab slug whose ids the cell checks; absent for landing, methodology and kit. */
  tab?: string;
  /** Baseline console screen name (docs/redesign-v2/baseline/console.json). */
  screen: string;
  /** The route renders a TabHero row (B.1 hero rules apply). */
  hero: boolean;
  /** An /app/* route: shell landmarks, one h1 inside main, the title. */
  app: boolean;
}

const PAGES: PageDef[] = [
  { slug: "landing", route: "/", screen: "landing", hero: false, app: false },
  { slug: "dashboard", route: "/app/dashboard", tab: "dashboard", screen: "dashboard", hero: true, app: true },
  { slug: "regime-lab", route: "/app/regime-lab", tab: "regime-lab", screen: "regime-lab", hero: true, app: true },
  { slug: "regime-lab--playbook", route: "/app/regime-lab#playbook", tab: "regime-lab", screen: "regime-lab", hero: true, app: true },
  { slug: "regime-lab--scenarios", route: "/app/regime-lab#scenarios", tab: "regime-lab", screen: "regime-lab", hero: true, app: true },
  { slug: "regime-lab--analogues", route: "/app/regime-lab#analogues", tab: "regime-lab", screen: "regime-lab", hero: true, app: true },
  { slug: "regime-lab--backtests", route: "/app/regime-lab#backtests", tab: "regime-lab", screen: "regime-lab", hero: true, app: true },
  { slug: "markets", route: "/app/markets", tab: "markets", screen: "markets", hero: true, app: true },
  { slug: "markets--chart-panel", route: "/app/markets?chart=SPY", tab: "markets", screen: "markets", hero: true, app: true },
  { slug: "markets--nvda", route: "/app/markets?name=NVDA", tab: "markets", screen: "markets", hero: true, app: true },
  { slug: "credit", route: "/app/credit", tab: "credit", screen: "credit", hero: true, app: true },
  { slug: "recession", route: "/app/recession", tab: "recession", screen: "recession", hero: true, app: true },
  { slug: "recession--sensitivity", route: "/app/recession#sensitivity", tab: "recession", screen: "recession", hero: true, app: true },
  { slug: "news", route: "/app/news", tab: "news", screen: "news", hero: true, app: true },
  { slug: "tools", route: "/app/tools", tab: "tools", screen: "tools", hero: true, app: true },
  { slug: "tools--allocation", route: "/app/tools#allocation", tab: "tools", screen: "tools", hero: true, app: true },
  { slug: "methodology", route: `/app/${METHODOLOGY_SLUG}`, screen: "methodology", hero: false, app: true },
  { slug: "kit", route: "/kit", screen: "kit", hero: false, app: false },
];

/** Iteration 1 S4: routes that render no ticker strip. */
const NO_STRIP_TABS: ReadonlySet<string> = new Set(["recession", METHODOLOGY_SLUG]);

const WIDTHS = [
  { width: 1672, height: 941 },
  { width: 1280, height: 941 },
  { width: 1024, height: 941 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
];

/* Per-cell gates use expect.soft: a defective cell (an overflow at 390, a missing
   landmark) fails the width test but never hides the cells after it. */

/** B.1 expectations per width (the verifier's measured breakpoints, QUESTIONS 116 to 118).
 * The strip is four columns at 1672 and `repeat(2, minmax(0, 1fr))` from 1619.98 down to 768;
 * below 768 it is one card per row (Iteration 1 S2: every quote card keeps the one-row slot
 * grid, so all three stay the same height). */
function expectedLayout(width: number) {
  return {
    sidebar: width >= 860,
    stripCols: width >= 1620 ? 4 : width >= 768 ? 2 : 1,
    // Iteration 1 (hero-row root cause): the summary stacks under the hero
    // below 1620, and the full-width hero keeps copy | chart down to 1200.
    heroRowCols: width >= 1620 ? 2 : 1,
    heroInnerCols: width >= 1200 ? 2 : 1,
    h1Px: width < 860 ? 44 : null,
  };
}

interface Layout {
  appCols: number;
  stripChildren: number;
  stripRows: number;
  heroRowCols: number | null;
  heroCols: number | null;
  hasViz: boolean;
  vizWidth: number | null;
  h1Px: number | null;
  glanceCols: number | null;
  levelsCols: number | null;
  glanceSegmentedRows: number | null;
  scrollWells: number;
}

/** Layout measures for the B.1 table; runs in the page. */
function measureLayout(): Layout {
  const tracks = (el: Element | null): number | null => {
    if (!el) return null;
    const v = getComputedStyle(el).gridTemplateColumns.trim();
    if (!v || v === "none") return 1;
    return v.split(/\s+/).filter(Boolean).length;
  };
  const rowsOf = (els: Element[]): number => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size;
  const strip = document.querySelector(".mrr-strip");
  const stripChildren = strip ? Array.from(strip.children) : [];
  const hero = document.querySelector(".mrr-hero");
  const viz = hero?.querySelector(".mrr-hero-viz") ?? null;
  const h1 = document.querySelector("main h1");
  const glance = document.querySelector(".mrr-dash-glance");
  const seg = document.querySelector("#markets-glance [role='group'][aria-label='Asset class']");
  return {
    appCols: tracks(document.querySelector(".mrr-app")) ?? 0,
    stripChildren: stripChildren.length,
    stripRows: rowsOf(stripChildren),
    heroRowCols: tracks(document.querySelector(".mrr-hero-row")),
    heroCols: tracks(hero),
    hasViz: Boolean(viz),
    vizWidth: viz ? Math.round(viz.getBoundingClientRect().width) : null,
    h1Px: h1 ? parseFloat(getComputedStyle(h1).fontSize) : null,
    glanceCols: tracks(glance),
    levelsCols: tracks(document.querySelector(".mrr-dash-levels")),
    glanceSegmentedRows: seg ? rowsOf(Array.from(seg.querySelectorAll("button"))) : null,
    scrollWells: document.querySelectorAll("[data-scrollable='true']").length,
  };
}

async function open(page: Page, def: PageDef): Promise<void> {
  await page.goto(def.route, { waitUntil: "domcontentloaded" });
  await settle(page, 600);
  // Data-dependent mounts the layout rules read: the allocation table (a cold
  // /api/allocation can take a minute; warmed in beforeAll) and the single-name tile.
  if (def.slug === "tools--allocation") await page.locator("#allocation-overview [role='table']").first().waitFor({ timeout: 60_000 }).catch(() => undefined);
  if (def.slug === "markets--nvda") await page.getByRole("button", { name: "Close single-name panel" }).waitFor({ timeout: 30_000 }).catch(() => undefined);
  if (def.slug === "tools" || def.slug === "tools--allocation") await settle(page, 400);
}

/** The sections.spec.ts:15-21 retry: the plain route, then the hash route. */
async function idResolves(page: Page, tab: string, id: string): Promise<boolean> {
  let found = await page.evaluate((elId) => Boolean(document.getElementById(elId)), id);
  if (!found) {
    await page.goto(`/app/${tab}#${id}`, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    found = await page.evaluate((elId) => Boolean(document.getElementById(elId)), id);
  }
  return found;
}

test.beforeAll(async ({ request }) => {
  // Warm the server-side caches the matrix reads on every width (E.3 #1: the API answering).
  for (const url of ["/api/freshness", "/api/regime/latest"]) expect((await request.get(url)).status(), url).toBe(200);
  await request.get("/api/recession/probability", { timeout: 60_000 }).catch(() => undefined);
  await request.get("/api/regime/intelligence", { timeout: 60_000 }).catch(() => undefined);
  await request.get("/api/allocation", { timeout: 120_000 }).catch(() => undefined);
});

for (const vp of WIDTHS) {
  test(`width ${vp.width}: the 18 pages of B.2, the B.1 layout, the B.3 rules, every section id and one palette jump`, async ({ page }) => {
    await page.setViewportSize(vp);
    const sink = collect(page);
    const want = expectedLayout(vp.width);
    const report: Record<string, unknown> = {};
    const resolvedIds = new Map<string, Set<string>>();
    for (const t of TABS) resolvedIds.set(t.slug, new Set());

    for (const def of PAGES) {
      const consoleStart = sink.console.length;
      const failedStart = sink.failed.length;
      await test.step(`${def.slug} @ ${vp.width}`, async () => {
        await open(page, def);

        /* B.3 #1: overflow. */
        const overflow = await page.evaluate(auditOverflow);
        expect.soft(overflow.scrollWidth, `${def.slug}: horizontal page scroll at ${vp.width}`).toBeLessThanOrEqual(overflow.innerWidth);
        expect.soft(overflow.offenders, `${def.slug}: elements past the viewport at ${vp.width}`).toEqual([]);

        /* B.3 #2 and #3: headings. */
        const headings = await page.evaluate(auditHeadings);
        expect.soft(headings.h1Total, `${def.slug}: exactly one h1`).toBe(1);
        if (def.app) {
          expect.soft(headings.h1InMain, `${def.slug}: the h1 sits inside main`).toBe(1);
          expect.soft(headings.violations, `${def.slug}: heading order in main`).toEqual([]);
        }

        /* B.3 #7: landmarks and the title; the skip link first in the tab order. */
        const landmarks = await page.evaluate(auditLandmarks);
        if (def.app) {
          expect.soft(landmarks.header, `${def.slug}: header`).toBeGreaterThanOrEqual(1);
          expect.soft(landmarks.primaryNav, `${def.slug}: one nav[aria-label=Primary]`).toBe(1);
          // Iteration 1 S4: the strip is absent on Recession and Methodology.
          expect.soft(landmarks.strip, `${def.slug}: the strip region`).toBe(NO_STRIP_TABS.has(def.tab ?? def.slug) ? 0 : 1);
          expect.soft(landmarks.main, `${def.slug}: main#main-content`).toBe(1);
          expect.soft(landmarks.sidebar, `${def.slug}: aside[aria-label=Sidebar] only above 860`).toBe(want.sidebar ? 1 : 0);
          expect.soft(landmarks.skipLinkFirst, `${def.slug}: the skip link is the first tabbable`).toBe(true);
          const label = def.slug === "methodology" ? "Methodology" : (TABS.find((t) => t.slug === def.tab)?.label ?? "");
          expect.soft(landmarks.title, `${def.slug}: document.title`).toBe(`${label} · Macro Regime Radar`);
        }
        // Where a real first Tab lands is recorded per cell (report only): the
        // a11y spec's Tab walk is the one gate for it. On routes that mount
        // SubTabs, Chromium moves its sequential-focus starting point to the
        // selected tab's scrollIntoView on mount, so the first Tab skips the
        // skip link (a Phase 10 finding); routes that focus a panel on mount
        // (chart panel, single-name tile) start from that panel.
        const idle = await page.evaluate(() => document.activeElement === document.body || document.activeElement == null);
        let firstTab: string | null = null;
        if (def.app && idle) {
          await page.keyboard.press("Tab");
          firstTab = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            return el ? `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} ${(el.innerText || el.getAttribute("aria-label") || "").slice(0, 40)}` : null;
          });
        }

        /* B.1: the layout the width decides. */
        const layout = await page.evaluate(measureLayout);
        if (def.app && !NO_STRIP_TABS.has(def.tab ?? def.slug)) {
          expect.soft(layout.stripChildren, `${def.slug}: the strip's four cards`).toBe(4);
          expect.soft(layout.stripChildren / layout.stripRows, `${def.slug}: strip columns at ${vp.width}`).toBe(want.stripCols);
        }
        if (def.hero) {
          expect.soft(layout.heroRowCols, `${def.slug}: .mrr-hero-row columns at ${vp.width}`).toBe(want.heroRowCols);
          // Iteration 1 acceptance (F4, QUESTIONS I18): from 1620 px the Dashboard hero sits beside the
          // summary card and stacks its copy over a full-width 24-month odds chart (a portrait chart
          // beside the copy read poorly), so its inner grid is one column there; every other hero keeps
          // the width rule.
          const heroInner = def.slug === "dashboard" && vp.width >= 1620 ? 1 : want.heroInnerCols;
          if (layout.hasViz) expect.soft(layout.heroCols, `${def.slug}: .mrr-hero inner columns at ${vp.width}`).toBe(heroInner);
          if (want.h1Px != null) expect.soft(layout.h1Px, `${def.slug}: --fs-display 44 below 860`).toBe(want.h1Px);
        }
        if (def.slug === "methodology" && want.h1Px != null) expect.soft(layout.h1Px, "methodology h1 at 44 below 860").toBe(want.h1Px);
        if (def.slug === "dashboard" && vp.width === 768) expect.soft(layout.glanceCols, ".mrr-dash-glance two columns at 768").toBe(2);
        if (def.slug === "dashboard" && vp.width === 390) expect.soft(layout.glanceSegmentedRows ?? 0, "the Asset class Segmented wraps at 390").toBeGreaterThan(1);
        if ((def.slug === "regime-lab--backtests" || def.slug === "tools") && vp.width === 390) expect.soft(layout.scrollWells, `${def.slug}: a scroll well at 390`).toBeGreaterThanOrEqual(1);

        /* D: the section ids this cell renders (checked per tab at the end of the width). */
        if (def.tab) {
          const tab = TABS.find((t) => t.slug === def.tab);
          for (const s of tab?.sections ?? []) {
            if (await page.evaluate((id) => Boolean(document.getElementById(id)), s.id)) resolvedIds.get(def.tab)?.add(s.id);
          }
        }

        /* The capture. */
        await page.screenshot({ path: path.join(OUT, `${def.slug}--${vp.width}.png`), fullPage: true });

        report[def.slug] = {
          layout,
          headings: { h1Total: headings.h1Total, h1InMain: headings.h1InMain, order: headings.main.map((h) => `h${h.level} ${h.text}`) },
          landmarks,
          firstTab: { idleAtLoad: idle, landsOn: firstTab, skipLink: firstTab?.includes("mrr-skip") ?? null },
          overflow: { scrollWidth: overflow.scrollWidth, innerWidth: overflow.innerWidth },
          ...(vp.width === 1280 && def.hero ? { heroViz: { width: layout.vizWidth, flagged: layout.vizWidth != null && layout.vizWidth < 200 } } : {}),
        };

        /* B.3 #5: the console, per cell, against the Phase 0 baseline. */
        const rows: ConsoleRec[] = sink.console.slice(consoleStart);
        const failed: FailedReq[] = sink.failed.slice(failedStart);
        const verdict = consoleVerdict(rows, failed, "live", baselineConsoleTexts(def.screen));
        mergeJsonFile(CONSOLE_PATH, `${def.slug}--${vp.width}--live`, { console: rows, failed, fresh: verdict.fresh });
        expect.soft(verdict.disallowed, `${def.slug}: console noise beyond the baseline at ${vp.width}`).toEqual([]);
        expect.soft(failed, `${def.slug}: failed API responses at ${vp.width}`).toEqual([]);
      });
    }

    /* D: every sections.ts id resolved somewhere in the width's cells, else the sections.spec retry. */
    await test.step(`section ids at ${vp.width}`, async () => {
      const missing: string[] = [];
      for (const tab of TABS) {
        const seen = resolvedIds.get(tab.slug) ?? new Set<string>();
        for (const s of tab.sections) {
          if (seen.has(s.id)) continue;
          if (!(await idResolves(page, tab.slug, s.id))) missing.push(`${tab.slug}#${s.id}`);
        }
      }
      expect(missing, `section ids missing at ${vp.width}`).toEqual([]);
    });

    /* D: one palette jump per width, through the MobileNav button below 860. */
    await test.step(`palette jump to #curve at ${vp.width}`, async () => {
      await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
      await settle(page, 600);
      if (want.sidebar) {
        await page.keyboard.press(PALETTE_KEY);
      } else {
        const menu = page.locator("button[aria-controls='mobile-nav-list']");
        await menu.click();
        await expect(menu).toHaveAttribute("aria-expanded", "true");
        await page.locator("#mobile-nav-list").getByRole("button", { name: /^Jump to a section/ }).click();
      }
      const dialog = page.getByRole("dialog", { name: "Jump to tab or section" });
      await expect(dialog).toBeVisible();
      const input = dialog.getByLabel("Filter destinations");
      await expect(input).toBeFocused();
      await input.fill("Curve monitor");
      await expect(dialog.getByRole("option").first()).toContainText("Curve monitor");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(/\/app\/recession#curve$/);
      await expect(dialog).toBeHidden();
      await settle(page, 900);
      await expect.poll(() => inView(page, "curve"), { timeout: 15_000 }).toBe(true);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `overflow after the jump at ${vp.width}`).toBeLessThanOrEqual(0);
    });

    mergeJsonFile(REPORT_PATH, String(vp.width), { viewport: vp, expected: want, cells: report });
  });
}
