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

  /* ── desk/frame-2 (DESK_FRAME2_SPEC §1 to §5) ─────────────────────────── */

  test("event study: five numbers on screen trace to the API's JSON for the same study", async ({ page }) => {
    await open(page, "/desk/event-study?study=gold-2sigma-spx-weak");
    const res = await page.request.get("/api/desk/event-study?study=gold-2sigma-spx-weak");
    expect(res.status()).toBe(200);
    const api = await res.json();
    expect(api.status).toBe("ready");
    const p = api.provenance;
    const h20 = api.horizons.find((h: { h: number }) => h.h === 20);
    const pct = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(1)}%`;
    // Interval bounds print as the engine's fmt_move does: the sign always kept.
    const bound = (x: number) => `${x < 0 ? "−" : "+"}${Math.abs(x * 100).toFixed(1)}%`;
    const body = page.locator("main");
    // 1. The engine's verdict, verbatim.
    await expect(body).toContainText(api.verdict.text);
    // 2. The facts line: n, blocks at 20 sessions, the sample, the cooldown.
    await expect(body).toContainText(`n ${p.n_events} · blocks ${p.n_blocks_by_h["20"]} at 20d · sample ${p.data_start}–${p.sample_end} · cooldown ${p.cooldown_sessions}`);
    await expect(page.getByTestId("es-sample")).toContainText(`Sample: ${p.data_start} to ${p.sample_end}`);
    // 3. The 20-session median beside the baseline median, in the horizon cell.
    const cell = page.getByRole("button", { name: /^20d n \d+/ });
    await expect(cell).toContainText(`${pct(h20.median)} vs ${pct(h20.baseline_median)}`);
    // 4. The 90% interval on Δ as served.
    await expect(cell).toContainText(`${bound(h20.ci90[0])} to ${bound(h20.ci90[1])}`);
    // 5. The newest event's date and its 20-session move.
    const ev = api.recent_events[0];
    const row = page.getByRole("table", { name: "The last ten events with their forward moves" }).getByRole("row").nth(1);
    await expect(row).toContainText(pct(ev.moves["20"]));
    // The badge is the Live badge, stamped from provenance.
    await expect(page.getByTestId("desk-badge").first()).toContainText("Live");
    await expect(page.getByTestId("desk-badge").first()).toContainText("event-study engine");
  });

  test("event study: a horizon cell opens its events from the keyboard; Run writes ?study=", async ({ page }) => {
    await open(page, "/desk/event-study");
    const cell = page.getByRole("button", { name: /^20d n \d+/ });
    await cell.focus();
    await page.keyboard.press("Enter");
    await expect(cell).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("region", { name: "Events behind 20 sessions" })).toBeVisible();
    await page.getByLabel("Window in sessions").selectOption("5");
    await page.getByTestId("es-run").press("Enter");
    await expect(page).toHaveURL(/study=gold-w5-z2\.0-up-spx_below_50dma-spx/);
    // A free-form query computes on request: computing, then ready, never an empty chart in between.
    await expect(page.locator("[data-state='computing'], [data-chart='horizons']").first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator("[data-chart='horizons']")).toBeVisible({ timeout: 60_000 });
  });

  test("S&P Internals states the engine's established reads, and breadth and sectors stay Designed", async ({ page }) => {
    await open(page, "/desk/sp-internals");
    for (const slug of ["spx-golden-cross", "spx-death-cross"]) {
      const api = await (await page.request.get(`/api/desk/event-study?study=${slug}`)).json();
      const est = api.horizons.filter((h: { exclusion: string }) => h.exclusion === "established").map((h: { h: number }) => h.h);
      const name = slug === "spx-golden-cross" ? "Golden cross" : "Death cross";
      await expect(page.getByTestId("internals-read").filter({ hasText: name })).toContainText(est.length ? `${name}: established at ${est.join(", ")} sessions` : `${name}: established at no horizon`);
    }
    for (const id of ["breadth", "sector-rotation"]) await expect(page.locator(`#${id}`).getByTestId("desk-badge")).toHaveText("Designed");
  });

  test("390 and reduced motion: frame-2 pages fit the phone and nothing animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of ["/desk/today", "/desk/event-study", "/desk/sp-internals", "/desk/event-study?view=client", "/desk/build-notes"]) {
      await open(page, route);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, route).toBeLessThanOrEqual(1);
      const animated = await page.evaluate(() => [...document.querySelectorAll("*")].filter((el) => getComputedStyle(el).animationName !== "none").length);
      expect(animated, route).toBe(0);
    }
  });
});
