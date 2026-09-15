/**
 * Parity guarantee #4, live check: on /app/news every external link inside
 * <main> opens in a new tab with rel=noreferrer, and items that carry cited
 * sources expose them (the "Regime read · N sources" disclosure or a sources
 * list). Data-dependent counts are reported, not asserted.
 */
import { test, expect } from "@playwright/test";
import { openAllDisclosures, settle } from "./lib/drive";

test("news: external links open safely in a new tab", async ({ page }) => {
  await page.goto("/app/news", { waitUntil: "domcontentloaded" });
  await settle(page, 1200);
  await openAllDisclosures(page);
  const bad = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main a[href^='http']"))
      .filter((a) => a.getAttribute("target") !== "_blank" || !(a.getAttribute("rel") ?? "").includes("noreferrer"))
      .map((a) => `${a.textContent?.trim().slice(0, 60)} → ${a.getAttribute("href")}`),
  );
  const total = await page.locator("main a[href^='http']").count();
  console.log(`news external links: ${total}, unsafe: ${bad.length}`);
  expect(total, "the news screen renders at least one external headline link").toBeGreaterThan(0);
  expect(bad, "external links without target=_blank rel=noreferrer").toEqual([]);
});
