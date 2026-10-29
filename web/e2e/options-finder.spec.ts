/**
 * The Options Finder in a real browser (Options Finder Build Plan step 8), every request answered from the
 * synthetic fixtures (e2e/lib/desk-fixtures.ts → src/fixtures/desk/options-finder.json), so the spec needs only a dev
 * server. Unlisted: no sidebar link, a Preview badge and a noindex tag. Answered: every color is a §1.3 color, no
 * banned word renders, nothing scrolls sideways on a desktop or a phone, and the badge names the session's close,
 * never Live. An API without the route says the Finder is not deployed yet. Save as position opens the Position
 * Monitor's form with the contract carried in.
 *
 * Run against a dev server: E2E_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/options-finder.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { settle } from "./lib/drive";
import { auditPalette, bannedWordsOnPage, routeDesk } from "./lib/desk-fixtures";

const ANSWERED = "/desk/options-finder?symbol=SYN&direction=up&target=120&by=2026-12-18&budget=5000&commission=0.65";

async function open(page: Page, route: string): Promise<void> {
  await routeDesk(page);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 500);
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("options finder", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test("unlisted: reachable by its address, Preview and noindex, no sidebar link", async ({ page }) => {
    await open(page, "/desk/options-finder");
    await expect(page.getByRole("heading", { level: 1, name: "Options Finder" })).toBeVisible();
    await expect(page.getByTestId("of-preview")).toHaveText("Preview");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Options Finder" })).toHaveCount(0);
    await expect(page.getByTestId("of-page")).toHaveAttribute("data-state", "idle");
  });

  test("answered: the palette, the language, the session's close, and no sideways scroll on a desktop or a phone", async ({ page }) => {
    await open(page, ANSWERED);
    await expect(page.getByTestId("of-page")).toHaveAttribute("data-state", "answered");
    await page.getByTestId("of-all").click();
    await page.getByText("How it was priced").click();
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await expect(page.getByText("Close · Oct 23")).toBeVisible();
    expect(await page.getByTestId("of-page").innerText()).not.toMatch(/\blive\b/i);
    await expect(page.getByRole("img", { name: /^Profit or loss in dollars on Dec 18, 2026/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 300);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  test("an API without the route says the Finder is not deployed yet", async ({ page }) => {
    await routeDesk(page);
    await page.route((u) => u.pathname === "/api/desk/options/finder", (route) => route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Not Found" }) }));
    await page.goto(ANSWERED, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("of-page")).toHaveAttribute("data-state", "not-deployed");
    await expect(page.getByTestId("of-refusal")).toContainText("not deployed on the data service yet");
  });

  test("Save as position carries the contract into the Position Monitor's form", async ({ page }) => {
    await open(page, ANSWERED);
    const card = page.getByTestId("of-pick-payoff");
    await card.getByRole("link", { name: /^Save .* as a position$/ }).click();
    await expect(page).toHaveURL(/\/desk\/position-monitor\?new=1&option=/);
    await expect(page.getByRole("form", { name: "Promote to position" }).getByLabel("Instrument", { exact: true })).toHaveValue("SYN Dec 18, 2026 $112.50 call");
    await expect(page.getByText(/^Saved from the Options Finder · /)).toBeVisible();
  });
});
