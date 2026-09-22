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
  await exploreSegmented(page, add);
  return out;
}

/**
 * Segmented controls (Phase 2, `aria-pressed` option groups) are the redesign's
 * second view-switch mechanism next to tablists: every option is pressed in
 * turn, labels harvested, and the original option restored. Groups that
 * navigate or that disappear mid-loop are skipped.
 */
async function exploreSegmented(page: Page, add: (state: string) => Promise<void>): Promise<void> {
  const groups = page.locator("main [role='group']:has(button[aria-pressed])");
  const nGroups = Math.min(await groups.count(), 12);
  for (let g = 0; g < nGroups; g++) {
    const group = groups.nth(g);
    if (!(await group.isVisible().catch(() => false))) continue;
    const label = (await group.getAttribute("aria-label")) ?? `group-${g}`;
    const options = group.locator("button[aria-pressed]");
    const n = await options.count();
    let original = 0;
    for (let i = 0; i < n; i++) if ((await options.nth(i).getAttribute("aria-pressed")) === "true") original = i;
    for (let i = 0; i < n; i++) {
      if (i === original) continue;
      const opt = options.nth(i);
      try {
        await opt.scrollIntoViewIfNeeded({ timeout: 2000 });
        await opt.click({ timeout: 3000 });
      } catch {
        continue;
      }
      await settle(page, 400);
      await add(`seg:${label}:${i}`);
      await openAllDisclosures(page, 3, () => add(`seg:${label}:${i}:disclosures-open`));
    }
    try {
      await options.nth(original).click({ timeout: 3000 });
      await settle(page, 300);
    } catch {
      /* group gone (navigation or re-render): nothing to restore */
    }
  }
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
