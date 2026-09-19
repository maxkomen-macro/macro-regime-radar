/**
 * G2 dead-space and G3 symmetry sweeps (docs/redesign-v2/ITERATION_1.md,
 * global rules G2 and G3, held everywhere per G6). PERMANENT: never tuned to
 * pass. Written in Iteration 1 Step 2; expected to fail on many cells until
 * the items that fix them land (D1, R1, M1, C1, C2, X2, N2, N3, T1-T3, Y2, …).
 *
 * Matrix, two tests per cell (titles "dead-space <route> <w>x941 <sidebar>"
 * and "symmetry <route> <w>x941 <sidebar>"):
 *   - 8 routes × widths 1672 / 1440 / 1280 / 1024 / 768 / 390 at 941 tall,
 *     sidebar expanded;
 *   - 8 routes × widths 1672 / 1440 / 1280 / 1024 at 941 tall, sidebar
 *     collapsed (mrr.sidebar.v1 seeded before load).
 * Below 860 px the MobileNav replaces the sidebar; "expanded" is just the
 * stored state there.
 *
 * One page load serves both tests of a cell: the first test to run loads the
 * route (screen data settled, as the G1 sweep does), runs `auditDeadSpace`
 * and `auditSymmetry` (e2e/lib/geometry.ts) at scrollY 0 and keeps the scans
 * in memory and in test-results/sweep-layout/.cache/ (Playwright restarts the
 * worker after a failing test, which drops the memory); the second reads them
 * back when they are under two minutes old, and measures on its own otherwise
 * (a --grep of one kind). Each test writes its offenders to
 * web/test-results/sweep-layout/<kind>-<route>-<w>-<sidebar>.json (also
 * attached). Runs against the running Vite dev server; never starts one.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  auditDeadSpace,
  auditSymmetry,
  describeDeadSpace,
  describeSymmetry,
  routeSlug,
  seedSidebar,
  waitForScreenData,
  writeSweepReport,
  type DeadSpaceScan,
  type SymmetryScan,
} from "./lib/geometry";

const ROUTES = [
  "/app/dashboard",
  "/app/regime-lab",
  "/app/markets",
  "/app/credit",
  "/app/recession",
  "/app/news",
  "/app/tools",
  "/app/methodology",
];
const WIDTHS = [1672, 1440, 1280, 1024, 768, 390];
const DESK_WIDTHS = [1672, 1440, 1280, 1024];
const HEIGHT = 941;
const CACHE_MAX_AGE_MS = 120_000;

interface Cell {
  route: string;
  width: number;
  sidebar: "expanded" | "collapsed";
}

const CELLS: Cell[] = [
  ...ROUTES.flatMap((route) => WIDTHS.map((width): Cell => ({ route, width, sidebar: "expanded" }))),
  ...ROUTES.flatMap((route) => DESK_WIDTHS.map((width): Cell => ({ route, width, sidebar: "collapsed" }))),
];

interface CellScans {
  measuredAt: number;
  deadSpace: DeadSpaceScan;
  symmetry: SymmetryScan;
}

const cellKey = (c: Cell) => `${routeSlug(c.route)}-${c.width}-${c.sidebar}`;
const memory = new Map<string, CellScans>();
const cacheFile = (testInfo: TestInfo, c: Cell) => path.join(testInfo.project.outputDir, "sweep-layout", ".cache", `${cellKey(c)}.json`);

async function measure(page: Page, c: Cell): Promise<CellScans> {
  await page.setViewportSize({ width: c.width, height: HEIGHT });
  await seedSidebar(page, c.sidebar === "collapsed");
  await page.goto(c.route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page);
  // A hero chart slot that is still empty under load reads as dead space; wait (bounded) until every
  // slot on the page holds a drawn chart with a real width before measuring.
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("[data-chart-slot]")].every((slot) =>
          [...slot.querySelectorAll("[data-chart], svg, canvas")].some((el) => el.getBoundingClientRect().width > 120),
        ),
      undefined,
      { timeout: 10_000 },
    )
    .catch(() => undefined);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(100);
  const deadSpace = await page.evaluate(auditDeadSpace, { minPx: 48, ratio: 0.15 });
  const symmetry = await page.evaluate(auditSymmetry, {});
  return { measuredAt: Date.now(), deadSpace, symmetry };
}

/** This cell's scans: from memory, else a fresh cache file, else a new page load. */
async function scansFor(page: Page, c: Cell, testInfo: TestInfo): Promise<CellScans> {
  const fresh = (s: CellScans | undefined) => s != null && Date.now() - s.measuredAt < CACHE_MAX_AGE_MS;
  const held = memory.get(cellKey(c));
  if (fresh(held)) return held as CellScans;
  const file = cacheFile(testInfo, c);
  try {
    const cached = JSON.parse(fs.readFileSync(file, "utf8")) as CellScans;
    if (fresh(cached)) {
      memory.set(cellKey(c), cached);
      return cached;
    }
  } catch {
    /* no cache: measure */
  }
  const scans = await measure(page, c);
  memory.set(cellKey(c), scans);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(scans));
  return scans;
}

test.describe("G2 dead-space and G3 symmetry sweep", () => {
  for (const cell of CELLS) {
    const { route, width, sidebar } = cell;
    const slug = routeSlug(route);

    test(`dead-space ${route} ${width}x${HEIGHT} ${sidebar}`, async ({ page }, testInfo) => {
      const { deadSpace } = await scansFor(page, cell, testInfo);
      const offenders = deadSpace.offenders.map((o) => ({ route, width, height: HEIGHT, sidebar, ...o }));
      await writeSweepReport(testInfo, "sweep-layout", `dead-space-${slug}-${width}-${sidebar}`, {
        route,
        width,
        height: HEIGHT,
        sidebar,
        cards: deadSpace.cards,
        offenders,
      });
      expect(deadSpace.cards, "the sweep found no card surfaces: the screen did not render").toBeGreaterThan(2);
      expect(
        offenders,
        `${offenders.length} dead-space offender(s) on ${route} at ${width}x${HEIGHT} (${sidebar}):\n${describeDeadSpace(deadSpace.offenders)}`,
      ).toHaveLength(0);
    });

    test(`symmetry ${route} ${width}x${HEIGHT} ${sidebar}`, async ({ page }, testInfo) => {
      const { symmetry } = await scansFor(page, cell, testInfo);
      const offenders = [
        ...symmetry.rows.map((o) => ({ route, width, height: HEIGHT, sidebar, ...o })),
        ...symmetry.charts.map((o) => ({ route, width, height: HEIGHT, sidebar, ...o })),
      ];
      await writeSweepReport(testInfo, "sweep-layout", `symmetry-${slug}-${width}-${sidebar}`, {
        route,
        width,
        height: HEIGHT,
        sidebar,
        cards: symmetry.cards,
        chartsMeasured: symmetry.chartsMeasured,
        chartsUnplaced: symmetry.chartsUnplaced,
        offenders,
      });
      expect(symmetry.cards, "the sweep found no card surfaces: the screen did not render").toBeGreaterThan(2);
      expect(
        offenders,
        `${symmetry.rows.length} row and ${symmetry.charts.length} chart offender(s) on ${route} at ${width}x${HEIGHT} (${sidebar}):\n${describeSymmetry(symmetry)}`,
      ).toHaveLength(0);
    });
  }
});
