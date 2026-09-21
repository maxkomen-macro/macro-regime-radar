/**
 * Desk frame (docs/desk/DESK_FRAME_SPEC.md §8), driven in a real browser
 * against the running Vite dev server on :5173 with the API on :8000 (never
 * started here). Keyboard: every control on the Position Monitor is a Tab
 * stop with a ring and a name; the discipline gate holds against Enter and
 * against URL parameters; the Desk / Client toggle works from the keyboard
 * and lives in the URL; reduced motion leaves nothing animating; at 390 the
 * mobile nav carries the Desk; the main dashboard keeps one h1 and gains the
 * entry link at desk width and the MobileNav row on a phone; every Desk page
 * carries a status badge.
 */
import { test, expect, type Page } from "@playwright/test";
import { hasRing, tabWalk } from "./lib/a11y";
import { settle } from "./lib/drive";
import { DESK_GROUPS } from "../src/screens/desk/desk-sections";

const KEY = "mrr.desk.positions.v1";

async function open(page: Page, route: string): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

test.describe("desk frame", () => {
  /** Open a route with no saved positions: the key is cleared after the first
   * load and the page reloaded, so a later reload in the test keeps its data. */
  async function openClean(page: Page, route: string): Promise<void> {
    await open(page, route);
    await page.evaluate((k) => localStorage.removeItem(k), KEY);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page, 900);
  }

  test("Position Monitor: every stop has a ring and a name; the disabled Save is not a stop", async ({ page }) => {
    await openClean(page, "/desk/position-monitor");
    const stops = await tabWalk(page);
    expect(stops.length).toBeGreaterThan(20);
    expect(stops[0].name).toMatch(/skip to content/i);
    const nameless = stops.filter((s) => !s.name.trim());
    expect(nameless.map((s) => `${s.tag}#${s.id}.${s.className}`), "nameless stops").toEqual([]);
    const ringless = stops.filter((s) => !hasRing(s));
    expect(ringless.map((s) => `${s.tag}#${s.id}.${s.className}`), "stops without a focus ring").toEqual([]);
    expect(stops.some((s) => /save position/i.test(s.name))).toBe(false);
    // The Desk / Client toggle, the wordmark, the three groups' pages and the form's fields are all stops.
    for (const g of DESK_GROUPS) for (const p of g.pages) expect(stops.some((s) => s.name.startsWith(p.label)), p.label).toBe(true);
    expect(stops.some((s) => s.name === "Client")).toBe(true);
    expect(stops.some((s) => /Variant view/.test(s.name))).toBe(true);
  });

  test("the gate holds against Enter in a field and against URL parameters", async ({ page }) => {
    await openClean(page, "/desk/position-monitor?instrument=TLT&variant_view=x&pre_mortem=y&falsification_series=DGS10&falsification_level=3.8&save=1");
    await expect(page.getByRole("textbox", { name: "Instrument" })).toHaveValue("");
    await expect(page.getByTestId("desk-save-position")).toBeDisabled();
    await page.getByRole("textbox", { name: "Instrument" }).fill("TLT");
    await page.getByRole("textbox", { name: "Variant view" }).fill("This will definitely work.");
    await expect(page.getByRole("button", { name: "Replace" })).toHaveCount(2);
    // Enter in a field: the browser's implicit submission is suppressed while
    // the form's only submit button is disabled, and the gate row says why.
    await page.getByRole("textbox", { name: "Instrument" }).press("Enter");
    await settle(page, 300);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await expect(page.getByTestId("desk-save-position")).toBeDisabled();
    await expect(page.getByText(/Save is blocked/)).toBeVisible();
    await expect(page.getByTestId("desk-position")).toHaveCount(0);
    // Every other gate met but one word still flagged: still no save.
    await page.getByRole("textbox", { name: "Pre-mortem" }).fill("Growth cracked through my level.");
    await page.getByLabel("Falsification series").selectOption("DGS10");
    await page.getByLabel(/^Falsification level/).fill("3.80");
    await expect(page.getByTestId("desk-save-position")).toBeDisabled();
    await page.getByLabel(/^Falsification level/).press("Enter");
    await settle(page, 300);
    expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
    await expect(page.getByTestId("desk-position")).toHaveCount(0);
  });

  test("a passing draft saves from the keyboard, appears with its live distance, and survives a reload", async ({ page }) => {
    await openClean(page, "/desk/position-monitor");
    await page.getByRole("textbox", { name: "Instrument" }).fill("TLT");
    await page.getByRole("textbox", { name: "Variant view" }).fill("The market prices three cuts; the data supports one.");
    await page.getByRole("textbox", { name: "Pre-mortem" }).fill("Growth cracked and the curve steepened through my level.");
    await page.getByLabel("Falsification series").selectOption("DGS10");
    await page.getByLabel(/^Falsification level/).fill("3.80");
    await expect(page.getByTestId("desk-save-position")).toBeEnabled();
    await page.getByLabel(/^Falsification level/).press("Enter");
    const row = page.getByTestId("desk-position").first();
    await expect(row).toContainText("TLT");
    await expect(row).toContainText(/away|Falsified|Reading the series|unavailable/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(page.getByTestId("desk-position")).toHaveCount(1);
  });

  test("Desk / Client toggle is keyboard-operable, lives in the URL and hides the query builder", async ({ page }) => {
    await open(page, "/desk/event-study");
    await expect(page.getByRole("heading", { level: 2, name: /^Query/ })).toBeVisible();
    await page.getByRole("button", { name: "Client" }).focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/view=client/);
    await expect(page.getByRole("heading", { level: 2, name: /^Query/ })).toHaveCount(0);
    await expect(page.getByTestId("desk-export")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: /^Today/ })).toHaveAttribute("href", "/desk/today?view=client");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });

  test("reduced motion: nothing on the Desk animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/desk/today");
    const animated = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").map((el) => el.className));
    expect(animated).toEqual([]);
  });

  test("390: the mobile nav carries every Desk page and the sidebar is gone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/desk/today");
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: /Menu/ }).click();
    for (const g of DESK_GROUPS) for (const p of g.pages) await expect(nav.getByRole("link", { name: new RegExp(`^${p.label.replace(/[/&]/g, (c) => `\\${c}`)}`) })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Dashboard/ })).toHaveAttribute("href", "/app/dashboard");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("main dashboard: one h1, the entry link at desk width, the MobileNav row at 390", async ({ page }) => {
    await open(page, "/app/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    const entry = page.locator("header").first().getByRole("link", { name: /Analyst Workspace/ });
    await expect(entry).toBeVisible();
    await expect(entry).toHaveAttribute("href", "/desk");
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 400);
    await expect(entry).toBeHidden();
    const nav = page.getByRole("navigation", { name: "Primary" });
    await nav.getByRole("button", { name: /Menu/ }).click();
    await expect(nav.getByRole("link", { name: /Analyst Workspace/ })).toBeVisible();
  });

  test("every Desk page carries a status badge and names the document", async ({ page }) => {
    for (const g of DESK_GROUPS) {
      for (const p of g.pages) {
        if (p.href) continue;
        await open(page, `/desk/${p.slug}`);
        await expect(page.getByTestId("desk-badge").first()).toBeVisible();
        await expect(page).toHaveTitle(`${p.label} · Desk · Macro Regime Radar`);
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, p.slug).toBeLessThanOrEqual(1);
      }
    }
  });
});
