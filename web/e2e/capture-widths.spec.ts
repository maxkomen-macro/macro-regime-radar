/**
 * Iteration 1 captures: every tab route at the six G6 widths, full page, into
 * docs/redesign-v2/captures/<branch-slug>/<CAPTURE_STEP or "widths">/<route>-<w>[-collapsed].png.
 * CAPTURE_SIDEBAR=collapsed stores mrr.sidebar.v1 collapsed before load (desk widths only).
 *
 * Usage (servers already running):  CAPTURE_STEP=step1 npx playwright test e2e/capture-widths.spec.ts
 */
import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const DOCS_DIR = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const BRANCH_SLUG = execSync("git rev-parse --abbrev-ref HEAD", { cwd: process.cwd() })
  .toString()
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, "-");
const OUT = path.join(DOCS_DIR, "captures", BRANCH_SLUG, process.env.CAPTURE_STEP ?? "widths");
const COLLAPSED = process.env.CAPTURE_SIDEBAR === "collapsed";

const ROUTES = ["dashboard", "regime-lab", "markets", "credit", "recession", "news", "tools", "methodology"];
const WIDTHS = [1672, 1440, 1280, 1024, 768, 390];

for (const route of ROUTES) {
  for (const width of WIDTHS) {
    if (COLLAPSED && width < 860) continue;
    test(`capture ${route} ${width}${COLLAPSED ? " collapsed" : ""}`, async ({ page }) => {
      fs.mkdirSync(OUT, { recursive: true });
      await page.setViewportSize({ width, height: 941 });
      if (COLLAPSED) {
        await page.addInitScript(() => {
          try {
            localStorage.setItem("mrr.sidebar.v1", JSON.stringify({ version: 1, collapsed: true }));
          } catch {
            /* storage unavailable: capture the default */
          }
        });
      }
      await page.goto(`/app/${route}`);
      await page.locator("main h1").first().waitFor({ timeout: 20_000 });
      await page
        .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(800);
      await page.screenshot({
        path: path.join(OUT, `${route}-${width}${COLLAPSED ? "-collapsed" : ""}.png`),
        fullPage: true,
      });
    });
  }
}
