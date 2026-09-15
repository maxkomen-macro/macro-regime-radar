/**
 * Phase 1 checklist section D.3: the dev-only build stamp injected by the
 * Vite plugin in web/vite.config.ts (<meta name="mrr-build"
 * content="<branch>@<sha7>">) names the checkout the dev server was started
 * from. A mismatch means stale code: restart Vite, hard reload, check again.
 * Node imports are fine here (e2e specs sit outside tsconfig's include;
 * label-parity.spec.ts already imports node:fs).
 */
import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();

test("the dev build stamp names the current branch and commit", async ({ page }) => {
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  const stamp = await page.locator('meta[name="mrr-build"]').getAttribute("content");
  expect(stamp).toBe(`${git("rev-parse --abbrev-ref HEAD")}@${git("rev-parse --short=7 HEAD")}`);
});

test("the stamp is injected exactly once, in <head>, before React mounts", async ({ page }) => {
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  const metas = page.locator('meta[name="mrr-build"]');
  await expect(metas).toHaveCount(1);
  expect(await metas.first().evaluate((el) => el.parentElement?.tagName)).toBe("HEAD");
  const stamp = await metas.first().getAttribute("content");
  expect(stamp).toMatch(/^[\w./-]+@[0-9a-f]{7}$/);
  // Served by the dev server's index.html transform, so the raw HTML carries it too.
  const html = await (await page.request.get("/app/dashboard")).text();
  expect(html).toContain(`name="mrr-build"`);
  expect(html).toContain(`content="${stamp}"`);
});
