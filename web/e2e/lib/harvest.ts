/**
 * Harvest every visible label a screen can show: default view, all
 * disclosures open, every sub-tab (one level of nesting) with its disclosures.
 * Shared by the label-parity spec; the capture spec keeps its own loop so it
 * can screenshot each state.
 */
import type { Page } from "@playwright/test";
import { extractLabels, type LabelRec } from "./labels";
import { listTabs, openAllDisclosures, settle } from "./drive";

export async function harvestLabels(page: Page): Promise<LabelRec[]> {
  const out: LabelRec[] = [];
  const add = async (state: string) => {
    out.push(...(await extractLabels(page, state)));
  };
  await settle(page, 700);
  await add("default");
  await openAllDisclosures(page, 6, () => add("disclosures-open"));
  const tabs = await listTabs(page);
  const seen = new Set<string>();
  for (const t of tabs) {
    const key = `${t.listLabel}|${t.tabLabel}`;
    if (!t.tabLabel || seen.has(key)) continue;
    seen.add(key);
    if ((await t.locator.getAttribute("aria-selected")) === "true") continue;
    try {
      await t.locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      await t.locator.click({ timeout: 4000 });
    } catch {
      continue;
    }
    await settle(page, 600);
    await add(`tab:${t.tabLabel}`);
    await openAllDisclosures(page, 6, () => add(`tab:${t.tabLabel}:disclosures-open`));
    // One nested level (e.g. a sub-tab that reveals its own tablist).
    const inner = await listTabs(page);
    for (const u of inner) {
      const k2 = `${u.listLabel}|${u.tabLabel}`;
      if (!u.tabLabel || seen.has(k2)) continue;
      seen.add(k2);
      if ((await u.locator.getAttribute("aria-selected")) === "true") continue;
      try {
        await u.locator.click({ timeout: 4000 });
      } catch {
        continue;
      }
      await settle(page, 500);
      await add(`tab:${t.tabLabel}>${u.tabLabel}`);
      await openAllDisclosures(page, 6, () => add(`tab:${t.tabLabel}>${u.tabLabel}:disclosures-open`));
    }
  }
  return out;
}

/** Shell overlays: alert drawer, command palette, assistant panel (never sends). */
export async function harvestShellOverlays(page: Page): Promise<LabelRec[]> {
  const out: LabelRec[] = [];
  const alerts = page.locator("header button[aria-haspopup='dialog']").filter({ hasText: /alert/i }).first();
  if (await alerts.count()) {
    await alerts.click();
    await settle(page, 500);
    out.push(...(await extractLabels(page, "alert-drawer")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForTimeout(300);
  if (await page.locator("[role='dialog']").count()) {
    out.push(...(await extractLabels(page, "command-palette")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  const analyst = page.locator("header button[aria-controls='assistant-panel']").first();
  if (await analyst.count()) {
    await analyst.click();
    await settle(page, 500);
    out.push(...(await extractLabels(page, "assistant-panel")));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    if ((await analyst.getAttribute("aria-expanded")) === "true") await analyst.click();
  }
  return out;
}
