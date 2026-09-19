/**
 * G1 overlap sweep (docs/redesign-v2/ITERATION_1.md, global rule G1, held
 * everywhere per G6). PERMANENT: every later step must keep it green; it is
 * never tuned to pass. It is expected to fail on several cells until the
 * items that fix them land (S1 at 700 px tall, D2 glance tiles, …).
 *
 * Matrix, one test per cell (titles "overlap <route> <w>x<h> <sidebar>"):
 *   - 8 routes × widths 1672 / 1440 / 1280 / 1024 / 768 / 390 at 941 tall, sidebar expanded;
 *   - 8 routes × widths 1672 / 1440 / 1280 / 1024 at 941 tall, sidebar collapsed
 *     (mrr.sidebar.v1 seeded before load);
 *   - 8 routes × every width at 700 tall, sidebar expanded.
 * Below 860 px the MobileNav replaces the sidebar; "expanded" is just the
 * stored state there.
 *
 * Each cell waits for the screen's data (main h1, no aria-busy, no
 * "Loading" status; max ≈ 8 s, then a 500 ms settle), scrolls to the top, runs
 * `auditOverlaps` (e2e/lib/geometry.ts) and writes the offenders to
 * web/test-results/sweep-overlap/<route>-<w>x<h>-<sidebar>.json (also attached
 * to the test). Runs against the running Vite dev server; never starts one.
 */
import { test, expect } from "@playwright/test";
import { auditOverlaps, describeOverlaps, routeSlug, seedSidebar, waitForScreenData, writeSweepReport } from "./lib/geometry";

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

interface Cell {
  route: string;
  width: number;
  height: number;
  sidebar: "expanded" | "collapsed";
}

const CELLS: Cell[] = [
  ...ROUTES.flatMap((route) => WIDTHS.map((width): Cell => ({ route, width, height: 941, sidebar: "expanded" }))),
  ...ROUTES.flatMap((route) => DESK_WIDTHS.map((width): Cell => ({ route, width, height: 941, sidebar: "collapsed" }))),
  ...ROUTES.flatMap((route) => WIDTHS.map((width): Cell => ({ route, width, height: 700, sidebar: "expanded" }))),
];

test.describe("G1 overlap sweep", () => {
  for (const cell of CELLS) {
    const { route, width, height, sidebar } = cell;
    test(`overlap ${route} ${width}x${height} ${sidebar}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await seedSidebar(page, sidebar === "collapsed");
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);

      const scan = await page.evaluate(auditOverlaps, { minPx: 1 });
      const offenders = scan.pairs.map((p) => ({ route, width, height, sidebar, ...p }));
      await writeSweepReport(testInfo, "sweep-overlap", `${routeSlug(route)}-${width}x${height}-${sidebar}`, {
        route,
        width,
        height,
        sidebar,
        items: scan.items,
        truncated: scan.truncated,
        offenders,
      });

      expect(scan.items, "the sweep measured nothing: the screen did not render").toBeGreaterThan(20);
      expect(
        offenders,
        `${offenders.length}${scan.truncated ? "+" : ""} overlapping pair(s) on ${route} at ${width}x${height} (${sidebar}):\n${describeOverlaps(scan.pairs)}`,
      ).toHaveLength(0);
    });
  }
});
