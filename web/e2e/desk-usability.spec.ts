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
import positionSample from "../src/fixtures/desk/positions.json" with { type: "json" };
import { POSITIONS_KEY } from "../src/screens/desk/positions/store";

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

  // ── Item 3: Event Study builder ──────────────────────────────────────────

  /** Three questions outside the catalog, built in the slots (§14.3), answered from the real route's fixtures. */
  const BUILT_QUESTIONS: { slots: Record<string, string>; address: string; headline: string; events: string; label: RegExp }[] = [
    {
      slots: { Shock: "gold", Window: "60", Move: "up2s", While: "none", "What happens to": "spx", "Over the next": "20" },
      address: "shock=gold&window=60&move=up2s&while=none&target=spx&horizon=20",
      headline: "Suggestive at 1 month",
      events: "23",
      label: /slug gold-w60-z2\.0-up-none-spx/,
    },
    {
      slots: { Shock: "vix", Window: "20", Move: "up2s", While: "regime:Overheating", "What happens to": "gold", "Over the next": "20" },
      address: "shock=vix&window=20&move=up2s&while=regime%3AOverheating&target=gold&horizon=20",
      headline: "No edge at 1 month",
      events: "27",
      label: /slug vix-w20-z2\.0-up-regime=overheating-gold/,
    },
    {
      slots: { Shock: "us10y", Window: "5", Move: "down2s", While: "spx_below_50", "What happens to": "us10y", "Over the next": "20" },
      address: "shock=us10y&window=5&move=down2s&while=spx_below_50&target=us10y&horizon=20",
      headline: "Suggestive at 1 month",
      events: "54",
      label: /slug us10y-w5-z2\.0-down-spx_below_50dma-us10y/,
    },
  ];

  for (const [i, q] of BUILT_QUESTIONS.entries())
    test(`item 3: a question outside the catalog, built in the slots, is answered with the same rules (${i + 1} of 3)`, async ({ page }) => {
      await open(page, "/desk/event-study");
      await expect(page.getByLabel("Shock")).toHaveValue("gold");
      // Every option in every slot is enabled (§14.3).
      expect(await page.locator("select option[disabled]").count()).toBe(0);
      for (const [label, value] of Object.entries(q.slots)) await page.getByLabel(label, { exact: true }).selectOption(value);
      await page.getByTestId("es-run").click();
      await expect(page).toHaveURL(new RegExp(`\\?${q.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
      const answer = page.getByRole("region", { name: "The answer" });
      await expect(answer).toContainText(q.headline);
      await expect(answer.locator(".dk-stat").first()).toContainText(q.events);
      await expect(page.getByRole("complementary", { name: "Verdict and detail" })).toContainText(`Verdict · ${q.headline.split(" at ")[0]}`);
      await expect(page.getByText(q.label)).toBeVisible();
      expect(await page.locator("button:disabled:visible").count()).toBe(0);
      expect(await auditPalette(page)).toEqual([]);
      expect(await bannedWordsOnPage(page)).toEqual([]);
    });

  // ── Item 4: Position Monitor, saved positions first ──────────────────────

  test("item 4: the Position Monitor opens on the saved positions; + New position opens the form and the gate, unchanged", async ({ page }) => {
    await page.addInitScript(([key, text]) => localStorage.setItem(key, text), [POSITIONS_KEY, JSON.stringify((positionSample as { positions: unknown[] }).positions)] as const);
    await open(page, "/desk/position-monitor");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Position Monitor");
    await expect(page.getByRole("region", { name: /Monitored/ }).getByTestId("dk-mon-row")).toHaveCount(3);
    await expect(page.getByRole("form", { name: "Promote to position" })).toHaveCount(0);
    await expect(page.getByText(/Discipline gate/)).toHaveCount(0);
    expect(await auditPalette(page)).toEqual([]);
    await page.getByTestId("dk-act").click();
    await expect(page).toHaveURL(/\/desk\/position-monitor\?new=1$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Promote to position");
    await expect(page.getByText(/Discipline gate/)).toBeVisible();
    // The gate is as it was: Save stays off until the three answers are in.
    await expect(page.getByTestId("pm-save")).toBeDisabled();
    await expect(page.getByRole("region", { name: /Monitored/ }).getByTestId("dk-mon-row")).toHaveCount(3);
    await page.getByRole("button", { name: "Back to the monitor" }).click();
    await expect(page).toHaveURL(/\/desk\/position-monitor$/);
    await expect(page.getByText(/Discipline gate/)).toHaveCount(0);
  });
});
