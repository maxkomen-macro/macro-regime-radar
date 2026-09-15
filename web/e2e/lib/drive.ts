/**
 * Page-driving helpers shared by the baseline capture and the parity specs:
 * settle (network + fonts + a beat for charts), open every disclosure, and
 * enumerate sub-tab rows (role=tablist) with a visited set so nested rows are
 * explored once.
 */
import type { Locator, Page } from "@playwright/test";

export async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Disclosure rows: expandable buttons that are not header popovers (drawer,
 * palette, assistant) and not inside an open dialog. */
export const DISCLOSURE_SELECTOR =
  "main button[aria-expanded='false']:not([aria-haspopup]):not([aria-controls='assistant-panel']):not(#watchlist *):not(#single-names *):not([role='combobox'])";

/** Click every closed disclosure until none remain (nested ones appear after a pass). */
export async function openAllDisclosures(page: Page, maxPasses = 6, onOpen?: () => Promise<void>): Promise<number> {
  let opened = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const closed = page.locator(DISCLOSURE_SELECTOR);
    const n = await closed.count();
    if (n === 0) break;
    let clickedThisPass = 0;
    for (let i = 0; i < n; i++) {
      // Re-query each time: the list shifts as rows open.
      const btn = page.locator(DISCLOSURE_SELECTOR).first();
      if ((await btn.count()) === 0) break;
      try {
        await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
        await btn.click({ timeout: 3000 });
        clickedThisPass++;
        opened++;
        await page.waitForTimeout(150);
        if (onOpen) await onOpen();
      } catch {
        break;
      }
    }
    if (clickedThisPass === 0) break;
    await settle(page, 400);
  }
  return opened;
}

export interface TabRef {
  listLabel: string;
  tabLabel: string;
  locator: Locator;
}

/** Every visible tab in every visible tablist under <main>. */
export async function listTabs(page: Page): Promise<TabRef[]> {
  const refs: TabRef[] = [];
  const lists = page.locator("main [role='tablist']");
  const nLists = await lists.count();
  for (let i = 0; i < nLists; i++) {
    const list = lists.nth(i);
    if (!(await list.isVisible().catch(() => false))) continue;
    const listLabel = (await list.getAttribute("aria-label")) ?? `tablist-${i}`;
    const tabs = list.locator("[role='tab']");
    const nTabs = await tabs.count();
    for (let j = 0; j < nTabs; j++) {
      const t = tabs.nth(j);
      const tabLabel = ((await t.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      refs.push({ listLabel, tabLabel, locator: t });
    }
  }
  return refs;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface ConsoleRec {
  type: string;
  text: string;
}
export interface FailedReq {
  url: string;
  status: number;
}

/** Attach console/pageerror/failed-response collectors to a page. */
export function collect(page: Page): { console: ConsoleRec[]; failed: FailedReq[] } {
  const out = { console: [] as ConsoleRec[], failed: [] as FailedReq[] };
  page.on("console", (m) => {
    const type = m.type();
    if (type === "error" || type === "warning") out.console.push({ type, text: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => out.console.push({ type: "pageerror", text: String(e.message).slice(0, 400) }));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && /\/(api|health|series|regime|signals)\b/.test(new URL(u).pathname)) out.failed.push({ url: u, status: r.status() });
  });
  return out;
}
