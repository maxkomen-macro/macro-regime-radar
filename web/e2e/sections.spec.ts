/**
 * Parity guarantee #2 (PARITY_MANIFEST.md): every id in sections.ts renders on
 * its tab, or on its sub-tab after hash navigation. A Cmd+K jump must land.
 */
import { test, expect } from "@playwright/test";
import { TABS } from "../src/screens/shell/sections";
import { settle } from "./lib/drive";

for (const tab of TABS) {
  test(`section ids resolve on /app/${tab.slug}`, async ({ page }) => {
    await page.goto(`/app/${tab.slug}`, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    const missing: string[] = [];
    for (const s of tab.sections) {
      let found = await page.evaluate((id) => Boolean(document.getElementById(id)), s.id);
      if (!found) {
        // Hash navigation may switch a sub-tab before the anchor exists.
        await page.goto(`/app/${tab.slug}#${s.id}`, { waitUntil: "domcontentloaded" });
        await settle(page, 900);
        found = await page.evaluate((id) => Boolean(document.getElementById(id)), s.id);
      }
      if (!found) missing.push(s.id);
    }
    expect(missing, `section ids missing on /app/${tab.slug}: ${missing.join(", ")}`).toEqual([]);
  });
}
