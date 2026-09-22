/**
 * Iteration 1, Step 1 (shell): S1 to S4 of docs/redesign-v2/ITERATION_1.md,
 * driven in a real browser against the running Vite dev server
 * (playwright.config.ts baseURL; servers are never started here).
 *
 *   S1  the sidebar footer never intersects a watchlist row (12 saved symbols,
 *       seeded in the mrr.watchlist.v1 shape of UI_SPEC §3.1) at 1672 / 1440 /
 *       1280 / 1024 × 941 and 700 tall; the footer sits below the list; at 700
 *       tall the list scrolls inside its own container.
 *   S2  every strip quote card has the five slots (symbol, value, change, tag,
 *       spark) in order, the change slot is never empty, card heights within 2 px.
 *   S3  collapse / reopen by button, by Ctrl/Meta+Backslash (ignored in an
 *       input), by the palette; the rail is at most 64 px; main widens with no
 *       horizontal scroll; state persists across reload; the skip link stays the
 *       first Tab stop; at 390 the MobileNav is unchanged and no rail renders.
 *   S4  the strip is absent on /app/recession and /app/methodology and present on
 *       the other six; the sidebar freshness entry (expanded footer and collapsed
 *       rail) and the MobileNav "Data freshness" button open the freshness drawer
 *       on every route.
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { SIDEBAR_KEY, waitForScreenData } from "./lib/geometry";

const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";
const WATCHLIST_KEY = "mrr.watchlist.v1";
const TWELVE = ["SPY", "QQQ", "IWM", "EEM", "DIA", "TLT", "GLD", "XLF", "XLE", "XLI", "XLK", "NVDA"];
const ROUTES = [...TABS.map((t) => `/app/${t.slug}`), `/app/${METHODOLOGY_SLUG}`];
const NO_STRIP = new Set(["/app/recession", `/app/${METHODOLOGY_SLUG}`]);
const DESK_WIDTHS = [1672, 1440, 1280, 1024];
const STRIP_NAME = "Market strip and data freshness";

/** Seed localStorage on the first document of the test only, so a reload keeps
 * whatever the app itself wrote afterwards. */
async function seedOnce(page: Page, entries: Record<string, string>): Promise<void> {
  await page.addInitScript((e: Record<string, string>) => {
    try {
      if (window.sessionStorage.getItem("__mrr_e2e_seeded") === "1") return;
      for (const [k, v] of Object.entries(e)) window.localStorage.setItem(k, v);
      window.sessionStorage.setItem("__mrr_e2e_seeded", "1");
    } catch {
      /* storage blocked */
    }
  }, entries);
}

const sidebarState = (collapsed: boolean) => JSON.stringify({ version: 1, collapsed });
const twelveSymbols = () =>
  JSON.stringify({ version: 1, symbols: TWELVE.map((symbol) => ({ symbol, addedAt: "2026-09-18T12:00:00.000Z" })) });

async function open(page: Page, route = "/app/dashboard"): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page, 8_000, 300);
}

const toggleBtn = (page: Page) => page.getByTestId("sidebar-toggle");
const rail = (page: Page) => page.getByTestId("sidebar-rail");
const strip = (page: Page) => page.getByRole("region", { name: STRIP_NAME });
const freshDrawer = (page: Page) => page.getByRole("dialog", { name: "Data freshness" });
/** Shell nav links: anything linking to an /app/ route outside <main>. */
const shellNavLinks = (page: Page) => page.locator("a[href^='/app/']:not(main a)");

async function expectExpanded(page: Page): Promise<void> {
  await expect(toggleBtn(page)).toHaveAttribute("aria-label", "Hide navigation");
  await expect(toggleBtn(page)).toHaveAttribute("aria-expanded", "true");
  await expect(toggleBtn(page)).toHaveAttribute("aria-controls", "mrr-sidebar");
  await expect(page.locator("#mrr-sidebar")).toBeVisible();
  await expect(page.locator("#mrr-sidebar").getByRole("navigation", { name: "Primary" })).toBeVisible();
  await expect(page.locator("#sidebar-watchlist")).toHaveCount(1);
  await expect(rail(page)).toHaveCount(0);
}

async function expectCollapsed(page: Page): Promise<void> {
  await expect(rail(page)).toBeVisible();
  await expect(toggleBtn(page)).toHaveAttribute("aria-label", "Show navigation");
  await expect(toggleBtn(page)).toHaveAttribute("aria-expanded", "false");
  await expect(rail(page).getByTestId("sidebar-toggle")).toHaveCount(1);
  await expect(rail(page).getByTestId("sidebar-freshness")).toBeVisible();
  const box = await rail(page).boundingBox();
  expect(box, "the rail has a box").not.toBeNull();
  expect(box?.width ?? Infinity, "rail width").toBeLessThanOrEqual(64);
  // The full sidebar is not rendered: no nav links, no watchlist.
  await expect(shellNavLinks(page)).toHaveCount(0);
  await expect(page.locator("#sidebar-watchlist")).toHaveCount(0);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function mainColumnWidth(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(".mrr-main") ?? document.getElementById("main-content");
    return el ? el.getBoundingClientRect().width : 0;
  });
}

/* ── S1 ─────────────────────────────────────────────────────────────────── */

interface FooterMeasure {
  error: string | null;
  rows: number;
  footBox: { top: number; bottom: number; height: number } | null;
  listBottom: number | null;
  overlaps: { row: string; with: string; w: number; h: number }[];
  scroller: { selector: string; scrollHeight: number; clientHeight: number } | null;
}

/** In-page (self-contained): the footer and the "Saved in this browser" note
 * against every watchlist row, each row clipped by its overflow ancestors so a
 * row scrolled out of the list's own area does not count. */
function measureSidebarFooter(): FooterMeasure {
  const out: FooterMeasure = { error: null, rows: 0, footBox: null, listBottom: null, overlaps: [], scroller: null };
  const aside = document.querySelector("aside[aria-label='Sidebar']") ?? document.getElementById("mrr-sidebar");
  if (!aside) return { ...out, error: "no sidebar" };
  const foot = aside.querySelector(".mrr-side-foot") ?? aside.querySelector("footer");
  if (!foot) return { ...out, error: "no footer (.mrr-side-foot) in the sidebar" };
  const list = aside.querySelector("[role='list'][aria-label='Watchlist']");
  if (!list) return { ...out, error: "no Watchlist list in the sidebar" };
  const rows = Array.from(aside.querySelectorAll("#sidebar-watchlist [role='listitem']"));
  out.rows = rows.length;

  type Box = { l: number; t: number; r: number; b: number };
  const clips = (v: string) => v === "hidden" || v === "auto" || v === "scroll" || v === "clip";
  const visibleBox = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    const box: Box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    let n = el.parentElement;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      const cx = clips(cs.overflowX);
      const cy = clips(cs.overflowY);
      if (cx || cy) {
        const p = n.getBoundingClientRect();
        if (cx) {
          box.l = Math.max(box.l, p.left);
          box.r = Math.min(box.r, p.right);
        }
        if (cy) {
          box.t = Math.max(box.t, p.top);
          box.b = Math.min(box.b, p.bottom);
        }
      }
      n = n.parentElement;
    }
    return box;
  };
  const label = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

  const footBox = visibleBox(foot);
  out.footBox = { top: footBox.t, bottom: footBox.b, height: footBox.b - footBox.t };
  const guards: { name: string; box: Box }[] = [{ name: `.mrr-side-foot "${label(foot)}"`, box: footBox }];
  const note = Array.from(aside.querySelectorAll("p, div, span, small")).find(
    (el) => el.children.length === 0 && /^(Saved in this browser|Won't be saved in this browser\.?)$/.test((el.textContent ?? "").trim()),
  );
  if (note) guards.push({ name: `note "${label(note)}"`, box: visibleBox(note) });

  for (const row of rows) {
    const rb = visibleBox(row);
    if (rb.r - rb.l <= 0 || rb.b - rb.t <= 0) continue; // scrolled out of view
    for (const g of guards) {
      const w = Math.min(rb.r, g.box.r) - Math.max(rb.l, g.box.l);
      const h = Math.min(rb.b, g.box.b) - Math.max(rb.t, g.box.t);
      if (w > 0.5 && h > 0.5) out.overlaps.push({ row: label(row), with: g.name, w: Math.round(w), h: Math.round(h) });
    }
  }
  const lb = visibleBox(list);
  out.listBottom = lb.b > lb.t ? lb.b : lb.t;

  // The watchlist's own scroll area: the list or an ancestor below the sidebar itself.
  let n: Element | null = list;
  while (n && n !== aside) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") {
      const cls = n.classList.length ? `.${Array.from(n.classList).join(".")}` : "";
      out.scroller = { selector: `${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : ""}${cls}`, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight };
      break;
    }
    n = n.parentElement;
  }
  return out;
}

test.describe("S1 sidebar footer clear of the watchlist (12 symbols)", () => {
  for (const width of DESK_WIDTHS) {
    for (const height of [941, 700]) {
      test(`S1 ${width}x${height}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await seedOnce(page, { [WATCHLIST_KEY]: twelveSymbols(), [SIDEBAR_KEY]: sidebarState(false) });
        await open(page);
        await expect(page.locator("#sidebar-watchlist [role='listitem']")).toHaveCount(12);
        await page.waitForTimeout(300);

        const m = await page.evaluate(measureSidebarFooter);
        expect(m.error).toBeNull();
        expect(m.rows).toBe(12);
        expect(m.footBox?.height ?? 0, "the footer is visible").toBeGreaterThan(10);
        expect(m.overlaps, `footer intersects watchlist rows at ${width}x${height}: ${JSON.stringify(m.overlaps)}`).toEqual([]);
        expect(m.footBox?.top ?? -Infinity, "the footer sits below the watchlist list").toBeGreaterThanOrEqual((m.listBottom ?? Infinity) - 1);
        if (height === 700) {
          expect(m.scroller, "the watchlist scrolls inside its own area (an overflow-y auto/scroll container below the sidebar)").not.toBeNull();
          expect(m.scroller?.scrollHeight ?? 0, `the watchlist area ${m.scroller?.selector} overflows with 12 symbols`).toBeGreaterThan(m.scroller?.clientHeight ?? Infinity);
        }
      });
    }
  }
});

/* ── S2 ─────────────────────────────────────────────────────────────────── */

test.describe("S2 strip cards share one five-slot layout", () => {
  for (const width of [1672, 1440, 1280, 1024, 768, 390]) {
    test(`S2 ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 860 ? 844 : 941 });
      await open(page);
      await expect(strip(page)).toBeVisible();
      await page.waitForTimeout(500);
      const cards = await page.evaluate((name) => {
        const region = document.querySelector(`[role='region'][aria-label='${name}']`);
        if (!region) return null;
        const names = ["symbol", "value", "change", "tag", "spark"];
        return Array.from(region.querySelectorAll("[data-slot='symbol']")).map((sym) => {
          let card: Element | null = sym.parentElement;
          while (card && card !== region && !card.querySelector("[data-slot='spark']")) card = card.parentElement;
          if (!card || card === region) return { symbol: (sym.textContent ?? "").trim(), slots: [] as string[], change: null as string | null, height: 0 };
          const slots = Array.from(card.querySelectorAll("[data-slot]"))
            .map((e) => e.getAttribute("data-slot") ?? "")
            .filter((n) => names.includes(n));
          const change = (card.querySelector("[data-slot='change']")?.textContent ?? "").trim();
          return { symbol: (sym.textContent ?? "").trim(), slots, change, height: card.getBoundingClientRect().height };
        });
      }, STRIP_NAME);
      expect(cards, "strip region").not.toBeNull();
      const list = cards ?? [];
      expect(list.map((c) => c.symbol.toUpperCase()), "strip cards with a data-slot=symbol").toEqual(expect.arrayContaining(["SPY", "QQQ", "US 10Y"]));
      for (const c of list) {
        expect(c.slots, `${c.symbol} slots`).toEqual(["symbol", "value", "change", "tag", "spark"]);
        expect(c.change, `${c.symbol} change slot is never empty`).not.toBe("");
      }
      const heights = list.map((c) => c.height);
      expect(Math.max(...heights) - Math.min(...heights), `strip card heights ${JSON.stringify(heights)}`).toBeLessThanOrEqual(2);
    });
  }
});

/* ── S3 ─────────────────────────────────────────────────────────────────── */

test.describe("S3 collapsible sidebar", () => {
  for (const width of DESK_WIDTHS) {
    test(`S3 button collapses to the rail and reopens at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 941 });
      await open(page);
      await expectExpanded(page);
      expect(await horizontalOverflow(page), "no horizontal scroll, expanded").toBeLessThanOrEqual(0);
      const expandedMain = await mainColumnWidth(page);

      await toggleBtn(page).click();
      await expectCollapsed(page);
      await expect(toggleBtn(page)).toBeFocused();
      expect(await horizontalOverflow(page), "no horizontal scroll, collapsed").toBeLessThanOrEqual(0);
      const collapsedMain = await mainColumnWidth(page);
      expect(collapsedMain, `main column ${expandedMain} → ${collapsedMain}`).toBeGreaterThan(expandedMain + 100);
      await expect(page.locator("main h1").first()).toBeVisible();

      await toggleBtn(page).click();
      await expectExpanded(page);
      await expect(toggleBtn(page)).toBeFocused();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test("S3 Ctrl+Backslash and Meta+Backslash toggle; ignored in an input", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 941 });
    await open(page);
    await expectExpanded(page);

    await page.keyboard.press("Control+Backslash");
    await expectCollapsed(page);
    await expect(toggleBtn(page)).toBeFocused();
    await page.keyboard.press("Meta+Backslash");
    await expectExpanded(page);
    await expect(toggleBtn(page)).toBeFocused();

    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "e2e-probe-input";
      input.setAttribute("aria-label", "probe");
      document.body.appendChild(input);
      input.focus();
    });
    await expect(page.locator("#e2e-probe-input")).toBeFocused();
    await page.keyboard.press("Control+Backslash");
    await page.keyboard.press("Meta+Backslash");
    await page.waitForTimeout(300);
    await expectExpanded(page);
    await page.evaluate(() => document.getElementById("e2e-probe-input")?.remove());
  });

  test("S3 the palette lists the action with its \\ hint, toggles and closes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 941 });
    await open(page);
    await expectExpanded(page);

    await page.keyboard.press(PALETTE_KEY);
    const dialog = page.getByRole("dialog", { name: "Jump to tab or section" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Filter destinations").fill("navigation");
    const hide = dialog.getByRole("option").filter({ hasText: "Hide navigation" });
    await expect(hide).toHaveCount(1);
    await expect(hide).toContainText("\\");
    await hide.click();
    await expect(dialog).toBeHidden();
    await expectCollapsed(page);

    await page.keyboard.press(PALETTE_KEY);
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Filter destinations").fill("navigation");
    const show = dialog.getByRole("option").filter({ hasText: "Show navigation" });
    await expect(show).toHaveCount(1);
    await expect(show).toContainText("\\");
    await expect(dialog.getByRole("option").filter({ hasText: "Hide navigation" })).toHaveCount(0);
    await show.click();
    await expect(dialog).toBeHidden();
    await expectExpanded(page);
  });

  test("S3 the state persists across reload in mrr.sidebar.v1", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 941 });
    await open(page);
    await expectExpanded(page);
    await toggleBtn(page).click();
    await expectCollapsed(page);
    expect(await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? "null"), SIDEBAR_KEY)).toEqual({ version: 1, collapsed: true });

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForScreenData(page, 8_000, 300);
    await expectCollapsed(page);

    await toggleBtn(page).click();
    await expectExpanded(page);
    expect(await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? "null"), SIDEBAR_KEY)).toEqual({ version: 1, collapsed: false });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForScreenData(page, 8_000, 300);
    await expectExpanded(page);
  });

  test("S3 the skip link is the first Tab stop in both states", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 941 });
    await open(page);
    await expectExpanded(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();

    await toggleBtn(page).click();
    await expectCollapsed(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForScreenData(page, 8_000, 300);
    await expectCollapsed(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("S3 at 390 the MobileNav is unchanged: no rail, no toggle, the shortcut does nothing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedOnce(page, { [SIDEBAR_KEY]: sidebarState(true) });
    await open(page);
    await expect(page.locator("aside[aria-label='Sidebar']")).toHaveCount(0);
    await expect(toggleBtn(page)).toHaveCount(0);
    await expect(rail(page)).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const menu = page.locator("button[aria-controls='mobile-nav-list']");
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Control+Backslash");
    await page.waitForTimeout(300);
    await expect(rail(page)).toHaveCount(0);
    await expect(toggleBtn(page)).toHaveCount(0);

    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const list = page.locator("#mobile-nav-list");
    await expect(list).toBeVisible();
    for (const tab of TABS) await expect(list.getByRole("link", { name: tab.label, exact: true })).toHaveAttribute("href", `/app/${tab.slug}`);
    await expect(list.getByRole("link", { name: /^Methodology\b/ })).toHaveAttribute("href", `/app/${METHODOLOGY_SLUG}`);
    await expect(list.getByRole("button", { name: /Jump to a section/ })).toBeVisible();
    await expect(list.getByRole("button", { name: /^Watchlist/ })).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await menu.click();
    await list.getByRole("link", { name: "Credit", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/credit$/);
    await expect(list).toBeHidden();
  });
});

/* ── S4 ─────────────────────────────────────────────────────────────────── */

async function expectStripByRoute(page: Page, route: string): Promise<void> {
  if (NO_STRIP.has(route)) {
    await expect(strip(page), `${route}: no strip`).toHaveCount(0);
    await expect(page.locator(".mrr-strip, .mrr-quote, .mrr-upd")).toHaveCount(0);
  } else {
    await expect(strip(page), `${route}: strip present`).toHaveCount(1);
  }
}

async function openAndCloseDrawer(page: Page, entry: Locator): Promise<void> {
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAccessibleName(/^Data freshness/);
  await entry.click();
  const drawer = freshDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("id", "freshness-drawer");
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
}

test.describe("S4 strip by route and the sidebar freshness entry", () => {
  for (const route of ROUTES) {
    test(`S4 ${route} expanded`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 941 });
      await seedOnce(page, { [SIDEBAR_KEY]: sidebarState(false) });
      await open(page, route);
      await expectStripByRoute(page, route);

      const sidebar = page.locator("#mrr-sidebar");
      await expect(sidebar).toBeVisible();
      // The existing footer text stays.
      await expect(sidebar).toContainText(/market data|Reconnecting to feeds|Data service unavailable|Validated snapshot/);
      await expect(sidebar).toContainText(/v\d+\.\d+\.\d+/);
      await expect(sidebar).toContainText(/Saved in this browser|Won't be saved in this browser/);
      const entry = sidebar.getByTestId("sidebar-freshness");
      await expect(entry).toHaveCount(1);
      expect(await entry.evaluate((el) => el.tagName)).toBe("BUTTON");
      // In the footer: below the watchlist list.
      const [entryBox, listBox] = await Promise.all([entry.boundingBox(), sidebar.getByRole("list", { name: "Watchlist" }).boundingBox()]);
      expect(entryBox && listBox ? entryBox.y : -1, "the freshness entry sits below the watchlist").toBeGreaterThanOrEqual(listBox ? listBox.y + 1 : Infinity);
      await openAndCloseDrawer(page, entry);
    });

    test(`S4 ${route} collapsed`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 941 });
      await seedOnce(page, { [SIDEBAR_KEY]: sidebarState(true) });
      await open(page, route);
      await expectStripByRoute(page, route);
      await expect(rail(page)).toBeVisible();
      await openAndCloseDrawer(page, rail(page).getByTestId("sidebar-freshness"));
    });

    test(`S4 ${route} 390 menu`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await open(page, route);
      await expectStripByRoute(page, route);
      const menu = page.locator("button[aria-controls='mobile-nav-list']");
      await menu.click();
      const entry = page.locator("#mobile-nav-list").getByRole("button", { name: /^Data freshness/ });
      await expect(entry).toHaveCount(1);
      await entry.click();
      const drawer = freshDrawer(page);
      await expect(drawer).toBeVisible();
      await expect(drawer).toHaveAttribute("id", "freshness-drawer");
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
    });
  }
});
