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
import { deskFixture } from "../src/fixtures/desk/index";
import { DESK_PAGES } from "../src/screens/desk/desk-sections";
import positionSample from "../src/fixtures/desk/positions.json" with { type: "json" };
import { POSITIONS_KEY } from "../src/screens/desk/positions/store";
import { GLOSSARY } from "../src/screens/desk/kit/glossary";
import basketSample from "../src/fixtures/desk/baskets.json" with { type: "json" };
import { SAVED_BASKETS_KEY } from "../src/screens/desk/basket/weights";

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

/** Item 13's words that must never reach an MD's screen (the brief's list, as patterns). */
const GUARD_STRINGS: [string, RegExp][] = [
  ["Generation g…", /Generation g/],
  ["<n> ms", /\b\d+ ms\b/],
  ["cached", /\bcached\b/i],
  ["<Month> row", /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* row\b/],
  ["not specified", /not specified/i],
];

/**
 * Whitelisted disabled controls, each with its reason (the brief keeps them): the Position Monitor's Save waits
 * for the discipline gate (item 4 keeps the gate exactly as is). §1.0 unavailable-with-reason blocks
 * ([data-unserved]) and PROTOTYPE cards ([data-prototype]) are whitelisted by scope.
 */
const GUARD_ALLOW = [".pm-save-btn"];

/** Item 13: what a page must not show. Every problem as one line; none is an empty list. */
async function guardProblems(page: Page, where: string): Promise<string[]> {
  const bad: string[] = [];
  const text = await page.locator("body").innerText();
  for (const [name, re] of GUARD_STRINGS) if (re.test(text)) bad.push(`${where}: "${name}" on screen (${text.match(re)?.[0]})`);
  const disabled = await page.evaluate((allow) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('button, select, option, input, textarea, [aria-disabled="true"]')) {
      const off = (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
      if (!off) continue;
      if (el.closest(["[data-unserved]", "[data-prototype]", "[hidden]", ...allow].join(", "))) continue;
      const box = (el.tagName === "OPTION" ? el.closest("select") : el)?.getBoundingClientRect();
      if (!box || (box.width === 0 && box.height === 0)) continue;
      out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 48)}"`);
    }
    return out;
  }, GUARD_ALLOW);
  bad.push(...disabled.map((d) => `${where}: disabled ${d}`));
  // An Advanced expander opens onto something served, never only a sentence about what is missing.
  const toggles = page.getByRole("main").getByTestId("dk-advanced");
  for (let i = 0; i < (await toggles.count()); i++) {
    const t = toggles.nth(i);
    if ((await t.getAttribute("aria-expanded")) !== "true") await t.click();
    // The control names its panel once it has re-rendered open; the panel's served content may still be arriving.
    await expect(t).toHaveAttribute("aria-expanded", "true");
    await expect(t).toHaveAttribute("aria-controls", /\S/);
    const panel = page.locator(`[id="${await t.getAttribute("aria-controls")}"]`);
    const own = async () => {
      if (!(await panel.count())) return 0;
      const missing = (await panel.locator(".dk-adv-missing").allInnerTexts()).join("");
      return (await panel.innerText()).replace(missing, "").trim().length;
    };
    const opened = await expect
      .poll(own, { timeout: 10_000 })
      .toBeGreaterThanOrEqual(20)
      .then(() => true)
      .catch(() => false);
    if (!opened) bad.push(`${where}: Advanced ${i + 1} opens onto nothing`);
  }
  return bad;
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
      // Codex R-02: a stock's price at two decimals.
      await expect(price).toContainText("225.51");
      await expect(price.getByRole("img")).toBeVisible();
      await expect(main.getByRole("region", { name: /^Momentum · RSI/ })).toContainText("Last above 70");
      // The drawdown, the 21-day volatility and the 1-year return sit on the Risk card since the rebase.
      await expect(main.getByRole("region", { name: /^Risk · drawdown and volatility/ })).toContainText("+23.1%");
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
    // GLD: the preset basket already holds NVDA. Books' ?add= adds it at equal weight, unsaved.
    await open(page, "/desk/technicals?symbol=GLD");
    await page.getByTestId("te-add-basket").click();
    await expect(page).toHaveURL(/\/desk\/basket-hedge/);
    await expect(page.getByRole("region", { name: "Basket", exact: true })).toContainText("GLD added; the 11 names are at equal weight.");
  });

  test("item 1: Basket & Hedge's ticker field is the same search; a pick adds the ticker", async ({ page }) => {
    // No override: the upstream search answers 503 here, so the series this store prices are offered.
    await open(page, "/desk/basket-hedge");
    const basket = page.getByRole("region", { name: "Basket", exact: true });
    const box = basket.getByRole("combobox", { name: "Add a ticker" });
    await box.pressSequentially("gl");
    const list = basket.getByRole("listbox");
    await expect(list).toContainText("Search did not answer · series this store prices");
    await expect(list.getByRole("option")).toHaveCount(1);
    await list.getByRole("option").first().click();
    await expect(basket.getByLabel("Weight of GLD, percent")).toBeVisible();
    await expect(basket).toContainText("GLD added; the 11 names are at equal weight.");
    await expect(box).toHaveValue("");
    // The suggestions are not cut to the narrow field: each shows its name (the live check's lesson on the PM).
    await box.pressSequentially("gl");
    const opt = list.getByRole("option").first();
    await expect(opt).toContainText("SPDR Gold Shares");
    const cut = await opt.evaluate((el) => [...el.querySelectorAll("*")].some((c) => (c as HTMLElement).scrollWidth > (c as HTMLElement).clientWidth + 1));
    expect(cut).toBe(false);
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
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
      // Codex R-07: the builder's mode is in the address too.
      await expect(page).toHaveURL(new RegExp(`\\?${q.address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}&mode=build$`));
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

  // ── Item 5: navigation in labelled groups ────────────────────────────────

  test("item 5: Market · Research · Trade, then About this build; the current page is marked; the breadcrumb stays", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/signal-ledger");
      if (width === 390) await page.getByRole("button", { name: "Menu" }).click();
      const side = page.getByRole("complementary", { name: "Sidebar" });
      const groups = side.getByRole("group");
      await expect(groups.locator(".dk-nav-group")).toHaveText(["Market", "Research", "Trade", "About this build"]);
      await expect(groups.nth(0).getByRole("link")).toHaveText(["Overview", "Technicals", "Sectors", "Macro", "Regime"]);
      await expect(groups.nth(1).getByRole("link")).toHaveText(["Event Study", "Signal Ledger"]);
      await expect(groups.nth(2).getByRole("link")).toHaveText(["Basket & Hedge", "Position Monitor"]);
      await expect(groups.nth(3)).toContainText("Data Pipeline · Build Notes");
      const current = side.getByRole("link", { name: "Signal Ledger" });
      await expect(current).toHaveAttribute("aria-current", "page");
      // Visibly marked: the active fill, and the green bar that means "current" (§1.3).
      await expect(current).toHaveCSS("box-shadow", /rgb\(38, 220, 160\)/);
      await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Radar›Desk›Signal Ledger");
      expect(await auditPalette(page)).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  // ── Item 6: one line under each title, one obvious primary action ────────

  test("item 6: every page has one plain line under its title and one obvious primary action", async ({ page }) => {
    for (const p of DESK_PAGES) {
      await open(page, `/desk/${p.slug}`);
      const title = page.locator(".dk-title").first();
      const line = title.locator(".dk-title-sub");
      // desk/pdf-polish item 2a: the owner took Overview's line out; its title stands alone.
      if (p.slug === "overview") {
        await expect(line, p.slug).toHaveCount(0);
        const primaries = page.locator('.dk-main :is(a, button):is([data-kind="light"], [data-kind="primary"]):visible:not([data-prototype] *)');
        await expect(primaries, `${p.slug}: primary actions`).toHaveCount(1);
        continue;
      }
      await expect(line, p.slug).toBeVisible();
      const [h1Box, lineBox] = await Promise.all([title.locator("h1").boundingBox(), line.boundingBox()]);
      // Under the title, not beside it.
      expect(lineBox!.y, p.slug).toBeGreaterThan(h1Box!.y + h1Box!.height / 2);
      const n = ((await line.textContent()) ?? "").trim().split(/\s+/).length;
      // Data Pipeline's line is desk/prototypes' three sentences, kept by the owner at the rebase (2026-09-28).
      if (p.slug !== "data-pipeline") expect(n, `${p.slug}: purpose line of ${n} words`).toBeLessThanOrEqual(15);
      // One primary-styled control on the page: the header's action, or the page's own (Run, Export CSV). A PROTOTYPE
      // card's own control (Data Pipeline's "Sync to Snowflake", which plays the illustrative sync) is the card's,
      // not the page's action, so it is not counted (desk/prototypes, kept as merged).
      const primaries = page.locator('.dk-main :is(a, button):is([data-kind="light"], [data-kind="primary"]):visible:not([data-prototype] *)');
      await expect(primaries, `${p.slug}: primary actions`).toHaveCount(1);
    }
  });

  // ── Item 7: Start here ───────────────────────────────────────────────────

  test("item 7: the Overview's Start here strip walks Overview → Basket & Hedge → Technicals → Event Study", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/overview");
      const strip = page.getByRole("navigation", { name: "Start here" });
      await expect(strip.getByRole("link")).toHaveText(["1 Overview · read the market", "2 Basket & Hedge · build the exposure", "3 Technicals · check the trend", "4 Event Study · test the idea"]);
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole("navigation", { name: "Start here" }).getByRole("link", { name: /Technicals/ }).click();
    await expect(page).toHaveURL(/\/desk\/technicals$/);
  });

  // ── Item 8: the landing page's way in ────────────────────────────────────

  test("item 8: the landing page offers Analyst Desk → beside Open the terminal, to the Desk's Overview", async ({ page }) => {
    await open(page, "/");
    const terminal = page.getByRole("link", { name: "Open the terminal →" });
    const desk = page.getByRole("link", { name: "Analyst Desk →" });
    await expect(desk).toBeVisible();
    await expect(desk).toHaveAttribute("href", "/desk/overview");
    // Beside it: the same row, right after it.
    const [t, d] = await Promise.all([terminal.boundingBox(), desk.boundingBox()]);
    expect(Math.abs(t!.y - d!.y)).toBeLessThanOrEqual(4);
    expect(d!.x).toBeGreaterThan(t!.x);
    await desk.click();
    await expect(page).toHaveURL(/\/desk\/overview$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Overview");
  });

  // ── Item 9: deep links reproduce the screen cold ─────────────────────────

  test("item 9 (1 of 3): an Event Study question, its horizon and the open Advanced panel, opened cold", async ({ page }) => {
    await open(page, "/desk/event-study?shock=gold&window=60&move=up2s&while=none&target=spx&horizon=5&adv=1");
    await expect(page.getByLabel("Shock")).toHaveValue("gold");
    await expect(page.getByLabel("Window")).toHaveValue("60");
    await expect(page.getByLabel("Over the next")).toHaveValue("5");
    await expect(page.getByRole("region", { name: "The answer" })).toContainText("at 1 week");
    await expect(page.getByRole("region", { name: "Advanced" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Advanced" })).toContainText("All 23 events");
    // Closing Advanced leaves the address, and the question stays.
    await page.getByRole("complementary", { name: "Verdict and detail" }).getByTestId("dk-advanced").click();
    await expect(page).not.toHaveURL(/adv=1/);
    await expect(page).toHaveURL(/shock=gold&window=60/);
  });

  test("item 9 (2 of 3): Technicals for a symbol at a range, opened cold", async ({ page }) => {
    await open(page, "/desk/technicals?symbol=GLD&range=3y");
    const price = page.getByRole("region", { name: /^GLD · SPDR Gold Shares/ });
    await expect(price.getByRole("button", { name: "3Y" })).toHaveAttribute("aria-pressed", "true");
    await expect(price.getByRole("img", { name: /3Y/ })).toBeVisible();
    await price.getByRole("button", { name: "6M" }).click();
    await expect(page).toHaveURL(/symbol=GLD&range=6m$/);
  });

  test("item 9 (3 of 3): a Signal Ledger filter, opened cold", async ({ page }) => {
    await open(page, "/desk/signal-ledger?filter=reliable");
    await expect(page.getByRole("button", { name: /^Reliable only/ })).toHaveAttribute("aria-pressed", "true");
    const rows = page.locator(".lg-table tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("S&P golden cross");
  });

  test("item 9: the other stateful views live in the address too (Data Pipeline's search, the Position Monitor's form)", async ({ page }) => {
    await open(page, "/desk/data-pipeline?q=DGS10");
    await expect(page.getByLabel("Find a series")).toHaveValue("DGS10");
    await expect(page.getByRole("region", { name: "Rates series" }).locator("tr[data-hit]")).toContainText("DGS10");
    await open(page, "/desk/position-monitor?new=1&instrument=NVDA");
    await expect(page.getByRole("combobox", { name: "Instrument", exact: true })).toHaveValue("NVDA");
    await expect(page.getByText(/Discipline gate/)).toBeVisible();
  });

  // ── Item 10: a cold start reads as loading ───────────────────────────────

  test("item 10: while a page's answers are pending, every card says Loading live data…, then the data replaces it", async ({ page }) => {
    // Every /api/desk answer held for two seconds: a cold API.
    await page.route((u) => u.pathname.startsWith("/api/"), async (route) => {
      const url = new URL(route.request().url());
      await new Promise((r) => setTimeout(r, 2000));
      const reply = deskFixture(route.request().method(), `${url.pathname}${url.search}`, undefined, route.request().headers()["accept"] ?? "");
      if (reply) return route.fulfill({ status: reply.status, contentType: reply.contentType, body: reply.body });
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "not served here" }) });
    });
    const cards: Record<string, number> = { overview: 6, technicals: 5, macro: 4, regime: 4, sectors: 2, "signal-ledger": 1, "event-study": 2, "data-pipeline": 1 };
    for (const [slug, n] of Object.entries(cards)) {
      await page.goto(`/desk/${slug}`, { waitUntil: "domcontentloaded" });
      const loading = page.getByRole("main").getByTestId("dk-loading");
      await expect(loading.first(), slug).toHaveText("Loading live data…");
      expect(await loading.count(), `${slug}: loading lines`).toBeGreaterThanOrEqual(n);
      await expect(loading, `${slug}: loading lines once answered`).toHaveCount(0, { timeout: 20_000 });
    }
  });

  test("item 11: terms of art carry a one-sentence definition on hover", async ({ page }) => {
    const hover = async (route: string, printed: string, id: keyof typeof GLOSSARY) => {
      await open(page, route);
      // Hover once the cards have answered: a card that re-renders from loading replaces the term under the pointer.
      await expect(page.getByRole("main").getByTestId("dk-loading")).toHaveCount(0);
      const term = page.getByRole("main").locator("abbr.dk-term", { hasText: printed }).first();
      await expect(term, `${route}: ${printed}`).toHaveAttribute("data-term", new RegExp(`\\b${id}\\b`));
      await term.hover();
      await expect(page.getByTestId("dk-term-tip"), `${route}: ${printed}`).toContainText(GLOSSARY[id].text);
      await page.mouse.move(0, 0);
      await expect(page.getByTestId("dk-term-tip")).toHaveCount(0);
    };
    await hover("/desk/macro", "2s10s", "curve");
    await hover("/desk/macro", "HY spread", "oas");
    await hover("/desk/technicals", "Momentum · RSI", "rsi");
    // desk/pdf-polish 3c: the S&P's page has no Risk card; a stock's page keeps it.
    await hover("/desk/technicals?symbol=NVDA", "21-day realized vol", "realized");
    await hover("/desk/signal-ledger", "2s10s +2σ steepening", "sigma");
    await hover("/desk/regime", "VIX avg", "vix");
    await hover("/desk/overview", "Vol · VIX", "vix");
    // The terms of the cards main added (desk/fill-compute, desk/books), defined after the rebase.
    await hover("/desk/technicals", "Histogram", "macd");
    await hover("/desk/technicals?symbol=NVDA", "Seasonality", "seasonality");
    await hover("/desk/basket-hedge", "Effective names", "effn");
    await hover("/desk/basket-hedge", "days to trade", "adv");
    await hover("/desk/basket-hedge", "Hedge ratio", "hedgeratio");
    // desk/pdf-polish 7: each column head its own window's sentence (252 daily returns), not the generic beta's.
    await hover("/desk/basket-hedge", "Beta 1Y", "col-beta1y");
    await hover("/desk/basket-hedge", "Vol cut", "col-vol-cut");
    await hover("/desk/signal-ledger", "Vs normal", "col-vs-normal");
    await hover("/desk/macro", "TLT", "mx-TLT");
    // The Event Study's Move slot explains σ with the same sentence.
    await open(page, "/desk/event-study");
    await expect(page.locator(".es-tip").first()).toHaveAttribute("data-tip", GLOSSARY.sigma.text);
  });

  test("desk/pdf-polish item 7: a column head's definition shows on keyboard focus and on a tap, and goes on Escape or a tap elsewhere", async ({ page, browser, baseURL }) => {
    await open(page, "/desk/signal-ledger");
    const head = page.locator("thead abbr.dk-term", { hasText: "Times" });
    await expect(head).toHaveAttribute("tabindex", "0");
    // Tab from the column head before it lands on this one: a Tab stop of its own, its sentence shown.
    await page.locator("thead abbr.dk-term", { hasText: "Last fired" }).focus();
    await page.keyboard.press("Tab");
    await expect(head).toBeFocused();
    // Codex R-04: an outcome column's sentence, then where its outcomes count from.
    await expect(page.getByTestId("dk-term-tip").locator("p")).toHaveText([GLOSSARY["col-times"].text, GLOSSARY.entry.text, GLOSSARY["entry-rule"].text]);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("dk-term-tip")).toHaveCount(0);
    // A phone: a tap shows the sentence, the finger lifting keeps it, a tap elsewhere hides it.
    const phone = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "dark" });
    const p = await phone.newPage();
    await open(p, "/desk/signal-ledger");
    await p.locator("thead abbr.dk-term", { hasText: "Vs normal" }).tap();
    const vsNormal = [GLOSSARY["col-vs-normal"].text, GLOSSARY.entry.text, GLOSSARY["entry-rule"].text];
    await expect(p.getByTestId("dk-term-tip").locator("p")).toHaveText(vsNormal);
    await p.waitForTimeout(300);
    await expect(p.getByTestId("dk-term-tip").locator("p")).toHaveText(vsNormal);
    await p.getByRole("heading", { level: 1 }).tap();
    await expect(p.getByTestId("dk-term-tip")).toHaveCount(0);
    await phone.close();
  });

  test("Codex R-10, R-11: on a 390 px phone a tapped definition opens no row, and its tip stays inside the window, scrolling when taller", async ({ browser, baseURL }) => {
    const phone = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, colorScheme: "dark" });
    const p = await phone.newPage();
    const tip = p.getByTestId("dk-term-tip");
    // Inside the window by its 8 px margin; a tip of three or more sentences takes its full width (300 px, or the
    // window less the margins), wherever its term sits.
    const inside = async (w: number, h: number, full = true) => {
      const box = (await tip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(8);
      expect(box.x + box.width).toBeLessThanOrEqual(w - 8 + 0.5);
      expect(box.y).toBeGreaterThanOrEqual(8 - 0.5);
      expect(box.y + box.height).toBeLessThanOrEqual(h - 8 + 0.5);
      if (full) expect(box.width).toBeGreaterThanOrEqual(Math.min(300, w - 16) - 1);
    };
    // R-10: a Ledger row's title is a term; a tap on it shows the sentence and leaves the row closed.
    await open(p, "/desk/signal-ledger");
    await expect(p.getByRole("main").getByTestId("dk-loading")).toHaveCount(0);
    const row = p.locator("tbody tr[tabindex]", { has: p.locator("abbr.dk-term", { hasText: "2s10s +2σ steepening" }) });
    await row.locator("abbr.dk-term").tap();
    await expect(tip).toContainText(GLOSSARY.curve.text);
    await p.waitForTimeout(300);
    await expect(p).toHaveURL(/\/desk\/signal-ledger/);
    await inside(390, 844, false);
    // The rightmost head: its tip keeps its full width, inside the window.
    await p.locator("thead abbr.dk-term", { hasText: "Now" }).tap();
    await expect(tip).toContainText(GLOSSARY["col-now-firing"].text);
    await inside(390, 844);
    await p.getByRole("heading", { level: 1 }).tap();
    await expect(tip).toHaveCount(0);
    // A tap elsewhere in the row still opens it.
    await row.locator("td").first().tap();
    await expect(p).toHaveURL(/\/desk\/event-study/);
    // R-11: the Data Pipeline's Status head holds four sentences; in a short window they are clamped and scroll.
    await p.setViewportSize({ width: 390, height: 360 });
    await open(p, "/desk/data-pipeline?group=credit");
    await expect(p.getByRole("main").getByTestId("dk-loading")).toHaveCount(0);
    await p.locator("thead abbr.dk-term", { hasText: "Status" }).tap();
    await expect(tip.locator("p")).toHaveText(["col-pl-status", "col-pl-lag-close", "col-pl-lag-daily", "col-pl-lag-monthly"].map((id) => GLOSSARY[id].text));
    await inside(390, 360);
    const body = tip.locator(".dk-term-tip-body");
    const sized = await body.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    expect(sized.overflow).toBe("auto");
    expect(sized.scroll).toBeGreaterThan(sized.client);
    // A finger dragging inside the tip scrolls it; the tip stays.
    await body.evaluate((el) => el.scrollBy(0, 60));
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(tip).toBeVisible();
    await inside(390, 360);
    await phone.close();
  });

  test("item 12: one endpoint forced to fail: its cards say Couldn't load · Retry, the rest renders, Retry recovers", async ({ page }) => {
    // Technicals reads /technicals and the Ledger: the Ledger fails, so only the Signals card fails.
    await open(page, "/desk/technicals", { "/api/desk/ledger": { status: 500, body: { detail: "forced failure" } } });
    const main = page.getByRole("main");
    const signals = main.getByRole("region", { name: /^Signals/ });
    await expect(signals.getByTestId("dk-failed")).toHaveText("Couldn't load · Retry");
    await expect(main.getByTestId("dk-failed")).toHaveCount(1);
    await expect(main.getByRole("region", { name: /^Momentum · RSI/ })).toContainText("Last above 70");
    await expect(main.getByRole("region", { name: /S&P 500 price/ }).getByRole("img").first()).toBeVisible();
    // Nothing on the failed card awaits a refresh (the fixture's own technicals await some values, a fact of its data).
    await expect(signals).not.toContainText("Awaiting refresh");
    // The Ledger answers again: Retry fills the card.
    await page.route(
      (u) => u.pathname === "/api/desk/ledger",
      (route) => {
        const reply = deskFixture("GET", "/api/desk/ledger")!;
        return route.fulfill({ status: reply.status, contentType: reply.contentType, body: reply.body });
      },
    );
    await signals.getByRole("button", { name: "Retry" }).click();
    await expect(signals.getByRole("listitem").first()).toBeVisible();
    await expect(main.getByTestId("dk-failed")).toHaveCount(0);

    // Macro reads one endpoint: all five cards fail (the 2×2 and desk/matrix's matrix), the page's title, header and
    // sidebar stand.
    await open(page, "/desk/macro", { "/api/desk/macro": { status: 503, body: { detail: "forced failure" } } });
    await expect(main.getByTestId("dk-failed")).toHaveCount(5);
    await expect(main.getByRole("region", { name: /^Correlation matrix/ }).getByTestId("dk-failed")).toHaveText("Couldn't load · Retry");
    for (const l of ["10-year", "2s10s", "HY spread", "Today"]) await expect(main).toContainText(l);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Macro & Correlations");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();

    // The Overview's tiles and active signals fail with /overview; the monitored positions (this browser's) still render.
    await open(page, "/desk/overview", { "/api/desk/overview": { status: 500, body: { detail: "forced failure" } } });
    await expect(main.getByTestId("dk-failed")).toHaveCount(6);
    await expect(main.getByTestId("ov-since")).toContainText("Couldn't load · Retry");
    await expect(main.getByRole("region", { name: /^Monitored/ })).toBeVisible();
    expect(await auditPalette(page)).toEqual([]);
  });

  test("item 13: no Desk page shows a control that does nothing, an empty Advanced, or the banned strings (empty browser store)", async ({ page }) => {
    const routes = [
      ...DESK_PAGES.map((p) => `/desk/${p.slug}`),
      "/desk/technicals?symbol=NVDA",
      "/desk/event-study?adv=1",
      "/desk/event-study?view=client",
      "/desk/overview?tour=1",
      "/desk/overview?tour=6",
    ];
    const bad: string[] = [];
    for (const r of routes) {
      await open(page, r);
      bad.push(...(await guardProblems(page, r)));
    }
    expect(bad).toEqual([]);
  });

  test("item 13: the same guard with positions and baskets saved in this browser", async ({ page }) => {
    await page.addInitScript(
      ([pk, pv, bk, bv]) => {
        localStorage.setItem(pk, pv);
        localStorage.setItem(bk, bv);
      },
      [POSITIONS_KEY, JSON.stringify((positionSample as { positions: unknown[] }).positions), SAVED_BASKETS_KEY, JSON.stringify((basketSample as { baskets: unknown[] }).baskets)] as const,
    );
    const bad: string[] = [];
    for (const r of ["/desk/overview", "/desk/basket-hedge", "/desk/position-monitor", "/desk/position-monitor?new=1"]) {
      await open(page, r);
      bad.push(...(await guardProblems(page, r)));
    }
    // A saved position opened, and its Close… form (the merge review: its Close position was disabled until a type
    // was picked); then with a type picked.
    await open(page, "/desk/position-monitor?open=ndx-vs-spx");
    const mon = page.getByRole("region", { name: /^Monitored/ });
    await mon.getByRole("button", { name: "Close…" }).click();
    const close = mon.getByRole("group", { name: "Close as" });
    await expect(close).toContainText("Pick how it closed to close it.");
    bad.push(...(await guardProblems(page, "/desk/position-monitor Close…")));
    await close.getByRole("button", { name: "Expired at horizon" }).click();
    await expect(close.getByRole("button", { name: "Close position" })).toBeEnabled();
    bad.push(...(await guardProblems(page, "/desk/position-monitor Close… (a type picked)")));
    // A close this browser cannot keep (storage full) says so on the Monitored card (Codex merge review).
    await page.evaluate(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
    await close.getByRole("button", { name: "Close position" }).click();
    await expect(mon.getByTestId("pm-close-note")).toHaveText("This browser's storage is full, so nothing was saved.");
    bad.push(...(await guardProblems(page, "/desk/position-monitor Close… (not kept)")));
    expect(bad).toEqual([]);
    // The whitelist is the gate's Save only, and it is on the form, waiting for the gate.
    await open(page, "/desk/position-monitor?new=1");
    await expect(page.locator(".pm-save-btn")).toBeDisabled();
  });

  test("item 13: the guard sees what it guards against", async ({ page }) => {
    await open(page, "/desk/build-notes");
    await page.evaluate(() => {
      const main = document.querySelector("main")!;
      main.insertAdjacentHTML("beforeend", '<p>Generation g1 · 0 ms · cached · Jul row · not specified</p><button disabled>Dead</button>');
    });
    const bad = await guardProblems(page, "probe");
    expect(bad).toEqual(expect.arrayContaining([expect.stringContaining('"Generation g…"'), expect.stringContaining('"<n> ms"'), expect.stringContaining('"cached"'), expect.stringContaining('"<Month> row"'), expect.stringContaining('"not specified"'), 'probe: disabled button "Dead"']));
  });
});
