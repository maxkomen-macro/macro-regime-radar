/**
 * Phase 1 checklist section E acceptance column and the CC_PROMPT "P1 (shell)"
 * interaction list, driven in a real browser against the running Vite dev
 * server (playwright.config.ts baseURL; servers are never started here):
 * build stamp, seven tabs plus Methodology, skip link, palette jump, alert
 * drawer, assistant panel (never sends a message), freshness breakdown, the
 * 390 px mobile nav, and the self-hosted display font (section C.5).
 */
import { test, expect, type Page } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { settle } from "./lib/drive";

const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";

async function open(page: Page, route = "/app/dashboard"): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const primaryNav = (page: Page) => page.getByRole("navigation", { name: "Primary" });
/** The top bar is a <header>; e2e/lib/harvest.ts keys its overlay probes on the same element. */
const header = (page: Page) => page.locator("header").first();
const strip = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });

/** True when the element's top edge sits inside the viewport. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}

test.describe("shell (checklist E)", () => {
  test("the dev build stamp is present and well-formed", async ({ page }) => {
    await open(page);
    const stamp = await page.locator('meta[name="mrr-build"]').getAttribute("content");
    expect(stamp).toMatch(/^[\w./-]+@[0-9a-f]{7}$/);
  });

  test("the skip link is the first tab stop and lands on #main-content", async ({ page }) => {
    await open(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    expect(await page.locator("#shell-content").count()).toBe(1);
  });

  test("all seven tabs navigate from the sidebar and Methodology opens its route", async ({ page }) => {
    await open(page);
    const aside = page.locator("aside[aria-label='Sidebar']");
    await expect(aside).toBeVisible();
    await expect(primaryNav(page)).toHaveCount(1);
    await expect(aside.getByTitle("Macro Regime Radar · landing page")).toHaveAttribute("href", "/");

    for (const tab of TABS) {
      const link = primaryNav(page).getByRole("link", { name: tab.label, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/app/${tab.slug}$`));
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(primaryNav(page).locator("a[aria-current='page']")).toHaveCount(1);
      await expect.poll(() => page.title()).toBe(`${tab.label} · Macro Regime Radar`);
      await settle(page, 300);
    }

    const methodology = primaryNav(page).getByRole("link", { name: "Methodology", exact: true });
    await methodology.click();
    await expect(page).toHaveURL(new RegExp(`/app/${METHODOLOGY_SLUG}$`));
    await expect(methodology).toHaveAttribute("aria-current", "page");
    await expect.poll(() => page.title()).toBe("Methodology · Macro Regime Radar");
    await expect(page.locator("main")).toContainText(/Methodology/i);
  });

  test("Cmd/Ctrl+K opens the palette and a section jump lands on its anchor", async ({ page }) => {
    await open(page);
    await page.keyboard.press(PALETTE_KEY);
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
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#curve");
    await expect.poll(() => inView(page, "curve"), { timeout: 15_000 }).toBe(true);

    // The top-bar trigger opens it too; Escape closes and returns focus to the trigger.
    const trigger = header(page).getByRole("button", { name: /Jump to/ });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("the bell opens the alert drawer and Escape closes it", async ({ page }) => {
    await open(page);
    const bell = header(page).getByRole("button", { name: /alert/i });
    await expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await bell.click();
    const drawer = page.getByRole("dialog", { name: "Alert feed" });
    await expect(drawer).toBeVisible();
    await expect(bell).toHaveAttribute("aria-expanded", "true");
    await expect(drawer.getByRole("button", { name: "Close alert feed" })).toBeFocused();
    expect(await page.locator("#shell-content").getAttribute("inert")).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(await page.locator("#shell-content").getAttribute("inert")).toBeNull();
    await expect(bell).toHaveAttribute("aria-expanded", "false");
    await expect(bell).toBeFocused();
  });

  test("Ask the analyst opens the assistant panel and Escape closes it without sending", async ({ page }) => {
    await open(page);
    const chip = header(page).getByRole("button", { name: /Ask the analyst/ });
    await expect(chip).toHaveAttribute("aria-controls", "assistant-panel");
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await chip.click();
    const panel = page.locator("#assistant-panel");
    await expect(panel).toBeVisible();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(panel.getByLabel("Ask the analyst")).toBeFocused();
    // Never type or send here: the panel is only opened and closed.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(chip).toBeFocused();

    // The close button is the pointer equivalent.
    await chip.click();
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Close AI analyst" }).click();
    await expect(panel).toBeHidden();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  test("the freshness card opens the per-source breakdown and Escape closes it", async ({ page }) => {
    await open(page);
    const card = strip(page);
    await expect(card).toBeVisible();
    for (const symbol of ["SPY", "QQQ", "US 10Y"]) {
      await expect(card.getByText(symbol, { exact: true }).first()).toBeVisible();
    }
    await expect(card).toContainText(/Macro monthly/);
    const trigger = card.getByRole("button", { name: /^Freshness/ });
    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAttribute("aria-controls", "freshness-drawer");
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Data freshness" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("id", "freshness-drawer");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toContainText(/Stored daily closes|market_daily/);
    await expect(drawer).toContainText(/Regime classifier|regime/);
    await expect(drawer).toContainText(/NYSE/);
    await expect(drawer.getByRole("status", { name: "Data freshness" })).toBeVisible();
    expect(await page.locator("#shell-content").getAttribute("inert")).not.toBeNull();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(await page.locator("#shell-content").getAttribute("inert")).toBeNull();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger).toBeFocused();
  });

  test("no horizontal overflow on any route at 1672 px", async ({ page }) => {
    for (const route of ["/", ...TABS.map((t) => `/app/${t.slug}`), `/app/${METHODOLOGY_SLUG}`]) {
      await open(page, route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `horizontal overflow on ${route}`).toBeLessThanOrEqual(0);
    }
  });

  test("at 390 px the sidebar is replaced by the Menu disclosure", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.locator("aside[aria-label='Sidebar']")).toHaveCount(0);
    await expect(primaryNav(page)).toHaveCount(1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    const menu = page.locator("button[aria-controls='mobile-nav-list']");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const list = page.locator("#mobile-nav-list");
    await expect(list).toBeVisible();
    for (const tab of TABS) {
      const link = list.getByRole("link", { name: tab.label, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", `/app/${tab.slug}`);
    }
    // The mobile row appends a "Reference" tag to the label, so its accessible name is "Methodology Reference".
    await expect(list.getByRole("link", { name: /^Methodology\b/ })).toHaveAttribute("href", `/app/${METHODOLOGY_SLUG}`);
    await expect(list.getByRole("link", { name: "Dashboard", exact: true })).toHaveAttribute("aria-current", "page");

    // The watchlist exists at phone width too, as a collapsed disclosure at the end of the list.
    const watchlistToggle = list.getByRole("button", { name: /^Watchlist/ });
    await expect(watchlistToggle).toHaveAttribute("aria-expanded", "false");
    await watchlistToggle.click();
    await expect(page.getByRole("list", { name: "Watchlist" })).toBeVisible();

    // Escape closes the list; a tap on a tab navigates and closes it.
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await list.getByRole("link", { name: "Credit", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/credit$/);
    await expect(list).toBeHidden();
    await expect.poll(() => page.title()).toBe("Credit · Macro Regime Radar");
  });
});

test.describe("fonts (checklist C.5)", () => {
  test("Source Serif 4 is self-hosted and Space Grotesk is retired", async ({ page }) => {
    await open(page);
    const serif = await page.request.get("/fonts/source-serif-4-var-latin.woff2");
    expect(serif.status()).toBe(200);
    expect(serif.headers()["content-type"]).toContain("font/woff2");
    expect((await serif.body()).length).toBe(122_168);

    const loaded = await page.evaluate(async () => {
      const faces = await document.fonts.load('700 58px "Source Serif 4"');
      return { count: faces.length, check: document.fonts.check('700 58px "Source Serif 4"') };
    });
    expect(loaded.count).toBe(1);
    expect(loaded.check).toBe(true);

    // The retired file must not be served as a font. A static host answers 404;
    // the Vite dev server answers its SPA fallback (200, text/html) for any
    // unknown path, which is equally "not a font".
    const grotesk = await page.request.get("/fonts/space-grotesk-var-latin.woff2");
    const groteskType = grotesk.headers()["content-type"] ?? "";
    expect(grotesk.status() === 404 || !groteskType.includes("font"), `Space Grotesk still served: ${grotesk.status()} ${groteskType}`).toBe(true);
    const groteskRules = await page.evaluate(() =>
      Array.from(document.styleSheets).reduce((n, sheet) => {
        try {
          return n + Array.from(sheet.cssRules).filter((r) => /Space Grotesk/i.test(r.cssText)).length;
        } catch {
          return n;
        }
      }, 0),
    );
    expect(groteskRules).toBe(0);

    const wordmarkFont = await page.locator(".mrr-logo span").first().evaluate((el) => getComputedStyle(el).fontFamily);
    expect(wordmarkFont).toMatch(/^"?IBM Plex Sans"?/);
  });
});
