/**
 * Phase 1 checklist section F (spec 3.1) and the CC_PROMPT "P1 (shell)"
 * watchlist flows, in a real browser against the running dev server and the
 * real symbol-search API: add AMD and reload; remove, Undo, remove again,
 * reload; Alt+ArrowUp reorder persists; remove all, empty state, Restore
 * defaults; two pages in one context stay in sync through the storage event.
 * Storage is reset before every test.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { settle } from "./lib/drive";

const KEY = "mrr.watchlist.v1";
const DEFAULTS = ["SPY", "QQQ", "IWM", "EEM"];

const list = (page: Page) => page.getByRole("list", { name: "Watchlist" });
const rows = (page: Page) => list(page).getByRole("listitem");
const rowFor = (page: Page, symbol: string) => rows(page).filter({ hasText: new RegExp(`^\\s*${symbol}\\b`) });

/** The symbol of every row, top to bottom (the first word of the row text). */
async function symbols(page: Page): Promise<string[]> {
  return rows(page).evaluateAll((els) => els.map((el) => ((el as HTMLElement).innerText || el.textContent || "").trim().split(/\s+/)[0]));
}

async function storedSymbols(page: Page): Promise<string[] | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as { version: number; symbols: { symbol: string }[] };
    return parsed.version === 1 ? parsed.symbols.map((s) => s.symbol) : ["<bad version>"];
  }, KEY);
}

async function resetAndOpen(page: Page): Promise<void> {
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await page.evaluate((key) => localStorage.removeItem(key), KEY);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 900);
  await expect(rows(page)).toHaveCount(DEFAULTS.length);
  expect(await symbols(page)).toEqual(DEFAULTS);
}

async function reload(page: Page): Promise<void> {
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

/** Add one symbol through the "+" popover: type it, wait for its hit to lead the list, Enter. */
async function addViaPopover(page: Page, symbol: string): Promise<void> {
  const plus = page.getByRole("button", { name: "Add to watchlist" });
  await plus.click();
  await expect(plus).toHaveAttribute("aria-expanded", "true");
  const input = page.getByRole("combobox", { name: "Search any listed symbol" });
  await expect(input).toBeFocused();
  await input.fill(symbol);
  const first = page.getByRole("option").first();
  await expect(first).toContainText(new RegExp(`^\\s*${symbol}\\b`), { timeout: 20_000 });
  await expect(first).toContainText("+ Add");
  await page.keyboard.press("Enter");
  await expect(rowFor(page, symbol)).toHaveCount(1);
  await expect(plus).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("combobox", { name: "Search any listed symbol" })).toHaveCount(0);
}

async function removeViaButton(page: Page, symbol: string): Promise<Locator> {
  const row = rowFor(page, symbol);
  await row.hover();
  await row.getByRole("button", { name: `Remove ${symbol} from watchlist` }).click();
  await expect(rowFor(page, symbol)).toHaveCount(0);
  const toast = page.getByRole("status").filter({ hasText: `Removed ${symbol}` });
  await expect(toast).toBeVisible();
  return toast;
}

test.describe("watchlist (checklist F)", () => {
  test("add AMD via the + popover, reload, still there", async ({ page }) => {
    await resetAndOpen(page);
    await addViaPopover(page, "AMD");
    expect(await symbols(page)).toEqual([...DEFAULTS, "AMD"]);
    await expect(rowFor(page, "AMD")).toBeFocused(); // the new row takes focus after an add
    expect(await storedSymbols(page)).toEqual([...DEFAULTS, "AMD"]);
    // A price arrives for the new row: live tick or the EOD close, never a bare dash.
    await expect(rowFor(page, "AMD")).toContainText(/\d+\.\d{2}/, { timeout: 20_000 });

    await reload(page);
    expect(await symbols(page)).toEqual([...DEFAULTS, "AMD"]);
    await expect(page.getByText("Saved in this browser")).toBeVisible();
  });

  test("remove AMD, Undo, remove again, reload, gone", async ({ page }) => {
    await resetAndOpen(page);
    await addViaPopover(page, "AMD");

    const toast = await removeViaButton(page, "AMD");
    await expect(toast).toHaveAttribute("aria-live", "polite");
    expect(await storedSymbols(page)).toEqual(DEFAULTS);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(rowFor(page, "AMD")).toHaveCount(1);
    expect(await symbols(page)).toEqual([...DEFAULTS, "AMD"]); // back at its original index
    await expect(rowFor(page, "AMD")).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Removed AMD" })).toHaveCount(0);
    expect(await storedSymbols(page)).toEqual([...DEFAULTS, "AMD"]);

    await removeViaButton(page, "AMD");
    expect(await storedSymbols(page)).toEqual(DEFAULTS);
    await reload(page);
    expect(await symbols(page)).toEqual(DEFAULTS);
    await expect(page.getByRole("status").filter({ hasText: "Removed AMD" })).toHaveCount(0);
  });

  test("Alt+ArrowUp reorders a focused row and the order persists after reload", async ({ page }) => {
    await resetAndOpen(page);
    const iwm = rowFor(page, "IWM");
    await iwm.focus();
    await expect(iwm).toBeFocused();
    await page.keyboard.press("Alt+ArrowUp");
    expect(await symbols(page)).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
    await expect(rowFor(page, "IWM")).toBeFocused(); // focus follows the moved row
    expect(await storedSymbols(page)).toEqual(["SPY", "IWM", "QQQ", "EEM"]);

    // Alt+ArrowDown on the last row is a no-op; Alt+ArrowDown on IWM sends it back.
    const eem = rowFor(page, "EEM");
    await eem.focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await symbols(page)).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
    await rowFor(page, "IWM").focus();
    await page.keyboard.press("Alt+ArrowDown");
    expect(await symbols(page)).toEqual(DEFAULTS);
    await page.keyboard.press("Alt+ArrowUp");
    expect(await symbols(page)).toEqual(["SPY", "IWM", "QQQ", "EEM"]);

    await reload(page);
    expect(await symbols(page)).toEqual(["SPY", "IWM", "QQQ", "EEM"]);
  });

  test("remove every symbol with Delete, see the empty state, Restore defaults", async ({ page }) => {
    await resetAndOpen(page);
    for (let left = DEFAULTS.length; left > 0; left--) {
      await rows(page).first().focus();
      await page.keyboard.press("Delete");
      await expect(rows(page)).toHaveCount(left - 1);
    }
    await expect(page.getByText("Your watchlist is empty")).toBeVisible();
    await expect(page.getByText("Add symbols to track them here on every visit.")).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Add a symbol" })).toBeVisible();
    expect(await storedSymbols(page)).toEqual([]); // the empty list is stored, not the defaults

    await reload(page);
    await expect(page.getByText("Your watchlist is empty")).toBeVisible();
    expect(await storedSymbols(page)).toEqual([]);

    await page.getByRole("button", { name: "Restore defaults" }).click();
    await expect(rows(page)).toHaveCount(DEFAULTS.length);
    expect(await symbols(page)).toEqual(DEFAULTS);
    expect(await storedSymbols(page)).toEqual(DEFAULTS);
    await expect(page.getByText("Your watchlist is empty")).toHaveCount(0);
  });

  test("two pages in the same browser context stay in sync through the storage event", async ({ page, context }) => {
    await resetAndOpen(page);
    const pageB = await context.newPage();
    await pageB.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
    await settle(pageB, 900);
    await expect(rows(pageB)).toHaveCount(DEFAULTS.length);

    // A adds; B shows it without a reload and without its own toast.
    await addViaPopover(page, "AMD");
    await expect(rowFor(pageB, "AMD")).toHaveCount(1, { timeout: 10_000 });
    expect(await symbols(pageB)).toEqual([...DEFAULTS, "AMD"]);

    // B removes; A follows. The Undo toast is local to B.
    await removeViaButton(pageB, "AMD");
    await expect(rowFor(page, "AMD")).toHaveCount(0, { timeout: 10_000 });
    expect(await symbols(page)).toEqual(DEFAULTS);
    await expect(page.getByRole("status").filter({ hasText: "Removed AMD" })).toHaveCount(0);

    // B reorders; A follows.
    await rowFor(pageB, "EEM").focus();
    await pageB.keyboard.press("Alt+ArrowUp");
    expect(await symbols(pageB)).toEqual(["SPY", "QQQ", "EEM", "IWM"]);
    await expect.poll(() => symbols(page), { timeout: 10_000 }).toEqual(["SPY", "QQQ", "EEM", "IWM"]);
    await pageB.close();
  });
});
