/**
 * Desk v2 in a real browser (DESK_FRAME3_SPEC §1, §13), every request
 * answered from the §12 fixtures (e2e/lib/desk-fixtures.ts), so the specs
 * need only a dev server (never an API) and assert the build's own rules:
 * the sidebar is the only navigation; every computed color on a tab is a
 * §1.3 color; no banned word renders; every card that reads live data
 * carries its badge; every Tab stop has a name and a ring; nothing animates
 * under reduced motion; a phone gets the sidebar from a Menu button with no
 * sideways scroll; a failed endpoint leaves labels and "Awaiting refresh".
 *
 * Run against a dev server: E2E_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/desk.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { hasRing, tabWalk } from "./lib/a11y";
import { settle } from "./lib/drive";
import { auditPalette, bannedWordsOnPage, routeDesk } from "./lib/desk-fixtures";
import { DESK_GROUPS } from "../src/screens/desk/desk-sections";

/** The v2 tabs built so far; each later tab adds itself here. */
const BUILT = ["overview", "technicals", "event-study", "regime", "macro", "sectors", "signal-ledger", "position-monitor"];

async function open(page: Page, route: string, over?: Parameters<typeof routeDesk>[1]): Promise<void> {
  await routeDesk(page, over);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 500);
}

test.describe("desk v2", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test("the sidebar is the only navigation: three groups, eleven tabs, no tab strip", async ({ page }) => {
    await open(page, "/desk/overview");
    const side = page.getByRole("complementary", { name: "Sidebar" });
    await expect(side).toBeVisible();
    for (const g of DESK_GROUPS) for (const p of g.pages) await expect(side.getByRole("link", { name: p.label, exact: true })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Overview · Desk · Macro Regime Radar");
  });

  for (const slug of BUILT) {
    test(`${slug}: every color is a §1.3 color, and no banned word renders`, async ({ page }) => {
      await open(page, `/desk/${slug}`);
      expect(await auditPalette(page)).toEqual([]);
      expect(await bannedWordsOnPage(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }

  test("overview: the four tiles carry their Live badges and read the fixture", async ({ page }) => {
    await open(page, "/desk/overview");
    await expect(page.getByRole("region", { name: "Regime" })).toContainText("Live · Aug print");
    await expect(page.getByRole("region", { name: "Regime" })).toContainText("Overheating");
    await expect(page.getByRole("region", { name: "Recession · logistic model" })).toContainText("12%");
    await expect(page.getByRole("region", { name: "S&P 500 · trend" })).toContainText("Live · Sep 22");
    await expect(page.getByRole("region", { name: "Vol · VIX" })).toContainText("16.2");
    await expect(page.getByTestId("dk-live")).toHaveCount(4);
    await expect(page.getByTestId("ov-since")).toContainText("2s10s still firing, day 10");
    // Tones render (verifier V-1): Overheating amber, room amber under 30% and green at 50% or more.
    await expect(page.getByRole("region", { name: "Regime" }).locator(".ov-tile-value")).toHaveCSS("color", "rgb(232, 180, 71)");
    const rows = page.getByTestId("dk-mon-row");
    await expect(rows.nth(0).locator(".dk-mon-room")).toHaveCSS("color", "rgb(232, 180, 71)");
    await expect(rows.nth(2).locator(".dk-mon-room")).toHaveCSS("color", "rgb(38, 220, 160)");
    await expect(rows.nth(0).locator(".dk-mon-dim")).toHaveCSS("color", "rgb(139, 146, 158)");
  });

  test("the walkthrough strip is in the v2 palette", async ({ page }) => {
    await open(page, "/desk/overview?tour=2");
    await expect(page.getByTestId("desk-tour")).toBeVisible();
    expect(await auditPalette(page)).toEqual([]);
  });

  test("overview: a failed /overview keeps every label and says Awaiting refresh", async ({ page }) => {
    await open(page, "/desk/overview", { "/api/desk/overview": { status: 503, body: { error: "generation warming" } } });
    for (const name of ["Regime", "Recession · logistic model", "S&P 500 · trend", "Vol · VIX"]) await expect(page.getByRole("region", { name })).toContainText("Awaiting refresh");
    await expect(page.getByText("Overheating")).toHaveCount(0);
    await expect(page.getByTestId("dk-live")).toHaveCount(0);
  });

  test("technicals: the page badge, the range chips redraw the chart, the 5,000 / 6,000 / 7,000 axis", async ({ page }) => {
    await open(page, "/desk/technicals");
    await expect(page.getByTestId("dk-live").first()).toContainText("Live · Yahoo/FRED · as of Sep 22, 2026");
    const price = page.getByRole("region", { name: /S&P 500 price/ });
    await expect(price.getByRole("img", { name: /1Y/ })).toBeVisible();
    await expect(price.locator(".dk-chart-axis")).toContainText(["5,000", "6,000", "7,000", "Oct 25", "Apr 26", "Sep 26"]);
    await price.getByRole("button", { name: "3Y" }).click();
    await expect(price.getByRole("img", { name: /3Y/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Signals/ }).getByRole("listitem")).toHaveCount(6);
    await expect(page.getByRole("region", { name: /Momentum · RSI/ }).getByRole("img", { name: "RSI 58, neutral" })).toBeVisible();
    // §1.4: Advanced is a blue link (verifier T-1: a reset once turned it gray).
    await expect(page.getByTestId("dk-advanced").first()).toHaveCSS("color", "rgb(88, 184, 230)");
    // A light action button keeps its dark text on hover (verifier R2-1).
    const act = page.getByTestId("dk-act");
    await act.hover();
    await expect(act).toHaveCSS("color", "rgb(12, 14, 17)");
    // The back link is gray at rest and light on hover (R2-2).
    const back = page.getByRole("link", { name: /Macro Regime Radar/ });
    await expect(back).toHaveCSS("color", "rgb(139, 146, 158)");
    await back.hover();
    await expect(back).toHaveCSS("color", "rgb(232, 230, 225)");
  });

  test("technicals: an unwired /vol (§12.9) keeps its labels and says Awaiting refresh", async ({ page }) => {
    await open(page, "/desk/technicals", { "/api/desk/vol": { status: 503, body: { error: "vol not wired" } } });
    const vol = page.getByRole("region", { name: "What protection costs right now" });
    await expect(vol).toContainText("Awaiting refresh");
    await expect(vol).toContainText("PUTS vs CALLS · 1 MONTH OUT");
    await expect(vol).not.toContainText("6.8");
  });

  test("event study: Advanced opens the events and the engine's panel, all in the palette, no banned word", async ({ page }) => {
    await open(page, "/desk/event-study");
    await expect(page.getByRole("region", { name: "The answer" })).toContainText("Leans positive a month out");
    await page.getByRole("complementary", { name: "Verdict and detail" }).getByTestId("dk-advanced").click();
    const adv = page.getByRole("region", { name: "Advanced" });
    await expect(adv).toContainText("All 18 events");
    await expect(adv).toContainText("By horizon, as the engine scores it");
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
  });

  test("event study: Export downloads the events as CSV; a confidence chip re-asks", async ({ page }) => {
    const calls = await routeDesk(page);
    await page.goto("/desk/event-study", { waitUntil: "domcontentloaded" });
    await settle(page, 500);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("es-export").click()]);
    expect(download.suggestedFilename()).toBe("gold-2sigma-spx-weak-events.csv");
    const csv = await (await download.createReadStream())?.toArray();
    const text = Buffer.concat((csv ?? []) as Buffer[]).toString("utf8");
    expect(text.split("\n")[0]).toBe("date,regime,ret_5,ret_10,ret_20,ret_60");
    expect(text.trim().split("\n")).toHaveLength(19);
    await page.getByRole("group", { name: "Confidence" }).getByRole("button", { name: "80%" }).click();
    await expect(page).toHaveURL(/confidence=0\.8/);
    await expect.poll(() => calls.some((c) => c.includes("/api/desk/study?preset=gold-2sigma-spx-weak&confidence=0.8"))).toBe(true);
    // "Act on this" carries the question to the Position Monitor.
    await expect(page.getByTestId("dk-act")).toHaveAttribute("href", "/desk/position-monitor?from=gold-2sigma-spx-weak");
  });

  test("macro: the two rows are equal and sized to their cards; the gauge's caption gives way to a band name and follows a resize", async ({ page }) => {
    await open(page, "/desk/macro");
    const heights = await page.locator("section.dk-card.mc-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights).toHaveLength(4);
    expect(new Set(heights).size).toBe(1);
    // Taller viewport, same cards: they never stretch to the window.
    await page.setViewportSize({ width: 1440, height: 1500 });
    await settle(page, 200);
    expect(await page.locator("section.dk-card.mc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(heights[0]);
    const tight = page.locator(".mc-card .dk-gauge-names > span > span", { hasText: "Tight" });
    await expect(tight).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(page, 300);
    await expect(tight).toBeHidden();
    const [needle, cap] = await Promise.all([page.locator(".mc-card .dk-gauge-needle").boundingBox(), page.locator(".mc-card .dk-gauge-caption").boundingBox()]);
    expect(Math.abs(cap!.x + cap!.width / 2 - (needle!.x + needle!.width / 2))).toBeLessThanOrEqual(Math.max(2, cap!.width / 2));
    await page.setViewportSize({ width: 1440, height: 960 });
    await settle(page, 300);
    await expect(tight).toBeVisible();
  });

  test("sectors: no sideways scroll at 390 or 1100, and the cards never stretch to a tall window", async ({ page }) => {
    await open(page, "/desk/sectors");
    const h = await page.locator("section.sc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 1600 });
    await settle(page, 200);
    expect(await page.locator("section.sc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(h);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test("ledger: no name is cut at 1101, 1200 or 390; the table scrolls in its own region; the card never stretches", async ({ page }) => {
    await open(page, "/desk/signal-ledger");
    const h = await page.locator("section.lg-card").evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 1600 });
    await settle(page, 200);
    expect(await page.locator("section.lg-card").evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(h);
    for (const width of [1101, 1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 250);
      const cut = await page.locator(".lg-table th[scope=row]").evaluateAll((ths) => ths.filter((th) => th.scrollWidth > th.clientWidth).length);
      expect(cut).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    // Reached from the keyboard, the scroll region shows its ring.
    const region = page.getByRole("region", { name: "The signals table" });
    await region.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await region.evaluate((e) => document.activeElement === e && getComputedStyle(e).outlineStyle !== "none" && parseFloat(getComputedStyle(e).outlineWidth) >= 1)).toBe(true);
  });

  test("position monitor: the flagged and expanded states stay in the palette; no sideways scroll; no stretch in a tall window", async ({ page }) => {
    await open(page, "/desk/position-monitor?from=gold-2sigma-spx-weak&open=2s10s-steepener");
    await page.getByLabel(/Variant view/).fill("The market thinks gold will keep falling.");
    await expect(page.getByRole("group", { name: "Wording" })).toContainText("1 to fix, one click");
    await page.getByRole("button", { name: /closes below its 50-day/ }).click();
    expect(await auditPalette(page)).toEqual([]);
    const gate = page.locator("section.pm-gate");
    const h = await gate.evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 2400 });
    await settle(page, 200);
    expect(await gate.evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBeLessThanOrEqual(h);
    for (const width of [1300, 1200, 1101, 1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // The wrong-if column holds together: no pill's text outgrows it, the typed level stays usable (R2-4).
      const cramped = await page.evaluate(() => {
        const chips = [...document.querySelectorAll<HTMLElement>(".pm-chip")].filter((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1).length;
        const own = document.querySelector<HTMLElement>(".pm-own")?.getBoundingClientRect().width ?? 0;
        return { chips, own: Math.round(own) };
      });
      expect(cramped.chips).toBe(0);
      expect(cramped.own).toBeGreaterThan(120);
    }
  });

  test("keyboard: every stop has a name and a ring; the toggle and the action are stops", async ({ page }) => {
    await open(page, "/desk/overview");
    const stops = await tabWalk(page);
    expect(stops.length).toBeGreaterThan(15);
    expect(stops[0].name).toMatch(/skip to content/i);
    expect(stops.filter((s) => !s.name.trim()).map((s) => `${s.tag}.${s.className}`)).toEqual([]);
    expect(stops.filter((s) => !hasRing(s)).map((s) => `${s.tag}.${s.className}`)).toEqual([]);
    for (const name of ["Desk", "Client", "Walkthrough", "Overview", "Build Notes"]) expect(stops.some((s) => s.name.trim() === name), name).toBe(true);
  });

  test("the Client toggle works from the keyboard and lives in the URL", async ({ page }) => {
    await open(page, "/desk/overview");
    await page.getByRole("button", { name: "Client" }).focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/view=client/);
    await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Regime", exact: true })).toHaveAttribute("href", "/desk/regime?view=client");
  });

  test("reduced motion: nothing on the Desk animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/desk/overview");
    const animated = await page.evaluate(() => [...document.querySelectorAll(".dk *")].filter((el) => getComputedStyle(el).animationName !== "none").map((el) => el.className));
    expect(animated).toEqual([]);
  });

  test("390: the sidebar opens from Menu, the page never scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/desk/overview");
    const side = page.getByRole("complementary", { name: "Sidebar" });
    await expect(side).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(side).toBeVisible();
    await side.getByRole("link", { name: "Regime", exact: true }).click();
    await expect(page).toHaveURL(/\/desk\/regime$/);
    await expect(side).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("House Discipline opens the gate text", async ({ page }) => {
    await open(page, "/desk/overview");
    await page.getByTestId("dk-house").click();
    await expect(page.getByRole("dialog", { name: "The discipline gate" })).toContainText("Variant view");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
