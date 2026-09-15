/**
 * Phase 2 checklist (docs/redesign-v2/checklists/02-components.md) section F
 * item 5: the P2 browser check on /kit, driven against the running Vite dev
 * server (playwright.config.ts baseURL, 1672x941; servers are never started
 * here). Sections and variants come from src/screens/kit-manifest.ts so the
 * page, the smoke test and this spec agree; the full-page capture lands in
 * docs/redesign-v2/captures/redesign-02-components/kit.png (CAPTURE_DIR
 * overrides the directory).
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { KIT_SECTIONS } from "../src/screens/kit-manifest";
import { collect, settle } from "./lib/drive";

const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.resolve(process.cwd(), "..", "docs", "redesign-v2", "captures", "redesign-02-components");
const VARIANTS = KIT_SECTIONS.flatMap((s) => s.variants);
const AMBER = "rgb(245, 181, 46)"; // --amber #f5b52e

/** Variant wrappers this spec drives by name; a manifest rename fails here first. */
const NAMED = {
  hero: "hero-regime-mint",
  pill: "pill-md",
  subtabs: "subtabs-regime-lab-hints",
  segmented: "segmented-two-options",
  slider: "slider-baseline-changed",
  matrix: "heat-transition-current-row",
  disclosure: "disclosure-row-description-meta",
};

const variant = (page: Page, name: string) => page.locator(`[data-kit-variant="${name}"]`);

async function open(page: Page): Promise<void> {
  await page.goto("/kit", { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

test.describe("kit (checklist F.5)", () => {
  test("the manifest names only wrappers this spec drives", () => {
    for (const name of Object.values(NAMED)) expect(VARIANTS, name).toContain(name);
    expect(new Set(VARIANTS).size).toBe(VARIANTS.length);
  });

  test("every section and variant renders, visible, with one h1, no console noise, no API traffic and no horizontal overflow", async ({ page }) => {
    const sink = collect(page);
    const apiRequests: string[] = [];
    page.on("request", (r) => {
      // Real API calls are proxied under /api/…; Vite's own module loads for
      // src/api/*.ts live under /src/api/ and are not traffic to the service.
      if (/^\/api\//.test(new URL(r.url()).pathname)) apiRequests.push(r.url());
    });
    await open(page);

    expect(await page.evaluate(() => document.querySelectorAll("[data-kit]").length)).toBe(KIT_SECTIONS.length);
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll("[data-kit]"), (el) => el.getAttribute("data-kit")));
    expect(ids).toEqual(KIT_SECTIONS.map((s) => s.id));

    const rendered = await page.evaluate(() =>
      Array.from(document.querySelectorAll("[data-kit-variant]"), (el) => ({
        name: el.getAttribute("data-kit-variant") ?? "",
        height: el.getBoundingClientRect().height,
      })),
    );
    const byName = new Map(rendered.map((r) => [r.name, r.height]));
    for (const name of VARIANTS) {
      expect(byName.has(name), `variant ${name} is present`).toBe(true);
      expect(byName.get(name) ?? 0, `variant ${name} is visible`).toBeGreaterThan(0);
    }
    expect(rendered.length).toBe(VARIANTS.length);

    await expect(page.locator("h1")).toHaveCount(1);
    expect(sink.console, JSON.stringify(sink.console, null, 2)).toEqual([]);
    expect(sink.failed).toEqual([]);
    expect(apiRequests, "the kit makes no /api requests").toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Source Serif 4 is loaded and the TabHero h1 renders in it at opsz 30", async ({ page }) => {
    await open(page);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return { serif: document.fonts.check('700 58px "Source Serif 4"') };
    });
    expect(fonts.serif).toBe(true);
    const h1 = variant(page, NAMED.hero).locator("h1");
    await expect(h1).toHaveCount(1);
    const computed = await h1.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { family: cs.fontFamily, variation: cs.fontVariationSettings, weight: cs.fontWeight };
    });
    expect(computed.family).toMatch(/^"?Source Serif 4"?/);
    expect(computed.variation).toContain('"opsz" 30');
    expect(computed.weight).toBe("700");
  });

  test("the mint pill glows and the gray pill does not", async ({ page }) => {
    await open(page);
    const pills = variant(page, NAMED.pill);
    const mint = pills.locator('[data-tone="mint"]').first();
    const gray = pills.locator('[data-tone="gray"]').first();
    await expect(mint).toBeVisible();
    await expect(gray).toBeVisible();
    expect(await mint.evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe("none");
    expect(await gray.evaluate((el) => getComputedStyle(el).boxShadow)).toBe("none");
  });

  test("SubTabs ArrowRight moves aria-selected", async ({ page }) => {
    await open(page);
    const list = variant(page, NAMED.subtabs).locator("[role='tablist']");
    await expect(list).toHaveCount(1);
    const tabs = list.locator("[role='tab']");
    expect(await tabs.count()).toBeGreaterThan(1);
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "false");
    await expect(tabs.nth(1)).toBeFocused();
  });

  test("Segmented toggles aria-pressed on click", async ({ page }) => {
    await open(page);
    const buttons = variant(page, NAMED.segmented).locator("[role='group'] button");
    expect(await buttons.count()).toBeGreaterThan(1);
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "false");
    await buttons.nth(1).click();
    await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(buttons.nth(0)).toHaveAttribute("aria-pressed", "false");
  });

  test("the changed slider carries data-changed and an amber value", async ({ page }) => {
    await open(page);
    const changed = variant(page, NAMED.slider).locator('[data-changed="true"]');
    await expect(changed).toHaveCount(1);
    const valueColor = await changed.evaluate((row) => {
      const label = row.querySelector("label");
      const value = label?.nextElementSibling as HTMLElement | null;
      return value ? getComputedStyle(value).color : "";
    });
    expect(valueColor).toBe(AMBER);
    await expect(changed.locator("input[type='range']")).toHaveCount(1);
  });

  test("the transition matrix outlines every cell of the current row", async ({ page }) => {
    await open(page);
    const matrix = variant(page, NAMED.matrix).locator("[role='table']").first();
    await expect(matrix).toBeVisible();
    const outlined = await matrix.evaluate((table) =>
      Array.from(table.querySelectorAll("[role='cell']")).filter((c) => getComputedStyle(c).outlineStyle === "solid").length,
    );
    expect(outlined).toBe(4);
    await expect(matrix.locator("[role='rowheader'][aria-current='true']")).toHaveCount(1);
  });

  test("a Disclosure row opens on click and shows its panel", async ({ page }) => {
    await open(page);
    const button = variant(page, NAMED.disclosure).locator("button[aria-expanded]").first();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    const panelId = await button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    // useId ids carry colons; an attribute selector needs no escaping.
    const panel = page.locator(`[id="${panelId}"]`);
    await expect(panel).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    expect((await panel.innerText()).trim().length).toBeGreaterThan(0);
  });

  test("full-page capture of /kit", async ({ page }) => {
    await open(page);
    fs.mkdirSync(CAPTURE_DIR, { recursive: true });
    const file = path.join(CAPTURE_DIR, "kit.png");
    await page.screenshot({ path: file, fullPage: true });
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).size).toBeGreaterThan(0);
  });
});
