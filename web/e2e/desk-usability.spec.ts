/**
 * Desk usability (desk/usability, docs/desk/USABILITY_REPORT.md): the items
 * that make the Desk walkable cold, in a real browser, every request
 * answered from the §12 fixtures (e2e/lib/desk-fixtures.ts) unless a test
 * overrides it. Anything outside /api/desk answers 503 there, so the stock
 * search's upstream is overridden where a test needs it answered.
 *
 * Run against a dev server: E2E_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/desk-usability.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { settle } from "./lib/drive";
import { auditPalette, bannedWordsOnPage, routeDesk, type Override } from "./lib/desk-fixtures";
import { DESK_PAGES } from "../src/screens/desk/desk-sections";

/** What /api/market/search answers on the Desk's scope in these tests: a mixed upstream list, as EODHD sends it. */
export const SEARCH_N: Override = {
  status: 200,
  body: {
    provider: "eodhd",
    fallback_used: false,
    fallback_reason: null,
    fetched_at: "2026-09-27T12:00:00Z",
    hits: [
      { symbol: "NVDA", name: "NVIDIA Corporation", exchange: "US", type: "Equity", sector: null, primary: true },
      { symbol: "NVL.VN", name: "No Va Land Investment Group Corp", exchange: "VN", type: "Equity", sector: null, primary: true },
      { symbol: "NVDL", name: "GraniteShares 2x Long NVDA Daily ETF", exchange: "US", type: "ETF", sector: null, primary: true },
      { symbol: "N.LSE", name: "N Brown Group", exchange: "LSE", type: "Equity", sector: null, primary: true },
      { symbol: "NFFFX", name: "American Funds New World", exchange: "US", type: "Fund", sector: null, primary: true },
    ],
  },
};

async function open(page: Page, route: string, over?: Record<string, Override>): Promise<string[]> {
  const calls = await routeDesk(page, over);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 500);
  return calls;
}

test.describe("desk usability", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  // ── Item 1: the stock search ─────────────────────────────────────────────

  test("item 1: every Desk page carries the stock search in its header", async ({ page }) => {
    for (const p of DESK_PAGES) {
      await open(page, `/desk/${p.slug}`);
      const search = page.getByRole("search", { name: "Stocks" });
      await expect(search, p.slug).toBeVisible();
      await expect(search.getByRole("combobox", { name: "Search a stock" })).toBeEditable();
    }
  });

  test("item 1: suggestions on the first keystroke, US equities and ETFs only; arrows and Enter open Technicals for the stock", async ({ page }) => {
    const calls = await open(page, "/desk/overview", { "/api/market/search": SEARCH_N });
    const box = page.getByRole("combobox", { name: "Search a stock" });
    await box.pressSequentially("N");
    const list = page.getByRole("listbox");
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(list.getByRole("option").nth(0)).toContainText("NVDA");
    await expect(list.getByRole("option").nth(0)).toContainText("NVIDIA Corporation");
    await expect(list).not.toContainText(/NVL|N Brown|American Funds/);
    expect(calls.some((c) => /\/api\/market\/search\?q=N&limit=10&scope=us/.test(c))).toBe(true);
    expect(await auditPalette(page)).toEqual([]);
    await box.press("ArrowDown");
    await box.press("ArrowUp");
    await box.press("Enter");
    await expect(page).toHaveURL(/\/desk\/technicals\?symbol=NVDA$/);
  });

  test("item 1: a click picks too; when the search does not answer, the series this store prices are offered", async ({ page }) => {
    // No override: the upstream search answers 503 here.
    await open(page, "/desk/regime");
    const box = page.getByRole("combobox", { name: "Search a stock" });
    await box.pressSequentially("gl");
    const list = page.getByRole("listbox");
    await expect(list).toContainText("Search did not answer · series this store prices");
    await expect(list.getByRole("option")).toHaveCount(1);
    await expect(list.getByRole("option").first()).toContainText("GLD");
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
    await list.getByRole("option").first().click();
    await expect(page).toHaveURL(/\/desk\/technicals\?symbol=GLD$/);
  });

  test("item 1: the Position Monitor's instrument field is the same search; typed text stays, a pick fills the ticker", async ({ page }) => {
    await open(page, "/desk/position-monitor?new=1", { "/api/market/search": SEARCH_N });
    const field = page.getByRole("combobox", { name: "Instrument", exact: true });
    await field.fill("N");
    await expect(page.getByRole("listbox").getByRole("option").first()).toContainText("NVDA");
    await page.getByRole("listbox").getByRole("option").first().click();
    await expect(field).toHaveValue("NVDA");
    await field.fill("TLT basis trade");
    await field.press("Escape");
    await expect(field).toHaveValue("TLT basis trade");
  });

  // ── Item 2: Technicals for any stock ─────────────────────────────────────

  test("item 2: a stock's Technicals: price and averages, crosses not scored, RSI, drawdown, vol, 1-year return, strength vs the S&P", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/technicals?symbol=NVDA");
      const main = page.getByRole("main");
      const price = main.getByRole("region", { name: /^NVDA · NVIDIA Corporation/ });
      await expect(price).toContainText("226");
      await expect(price.getByRole("img")).toBeVisible();
      await expect(main.getByRole("region", { name: /^Momentum · RSI/ })).toContainText("RSI (14)");
      await expect(main.getByRole("region", { name: /^Momentum · RSI/ })).toContainText("+23.1%");
      await expect(main.getByRole("region", { name: /^Relative strength vs the S&P 500/ }).getByRole("img")).toBeVisible();
      // The S&P-only cards are the S&P's; one line points there.
      await expect(main.getByRole("region", { name: /^Signals/ })).toHaveCount(0);
      await expect(main.getByRole("region", { name: /^Sector leadership/ })).toHaveCount(0);
      await expect(main.getByRole("region", { name: /^What protection costs/ })).toHaveCount(0);
      await expect(main).toContainText("Signals are scored on the S&P 500 → view");
      expect(await auditPalette(page)).toEqual([]);
      expect(await bannedWordsOnPage(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("item 2: a stored ETF's cross is labelled not scored; the S&P link goes back to the scored page", async ({ page }) => {
    await open(page, "/desk/technicals?symbol=GLD");
    const price = page.getByRole("region", { name: /^GLD · SPDR Gold Shares/ });
    await expect(price).toContainText("the 50-day crossed below the 200-day. Not scored");
    await page.getByRole("link", { name: "→ view" }).click();
    await expect(page).toHaveURL(/\/desk\/technicals$/);
    await expect(page.getByRole("region", { name: /^Signals/ })).toBeVisible();
  });

  test("item 2: Open as position fills the instrument; Add to basket puts it in the open basket", async ({ page }) => {
    await open(page, "/desk/technicals?symbol=NVDA");
    await page.getByTestId("dk-act").click();
    await expect(page).toHaveURL(/\/desk\/position-monitor\?new=1&instrument=NVDA$/);
    await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toHaveValue("NVDA");
    await open(page, "/desk/technicals?symbol=NVDA");
    await page.getByTestId("te-add-basket").click();
    await expect(page).toHaveURL(/\/desk\/basket-hedge/);
    await expect(page.getByRole("region", { name: "Basket" })).toContainText("NVDA added from Technicals at 0%");
  });
});
