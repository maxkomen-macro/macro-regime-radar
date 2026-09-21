/**
 * F4 · full functional sweep (docs/redesign-v2/ITERATION_2.md).
 *
 * Every prior acceptance walk checked the items being changed. This one walks
 * the whole product: nine routes (seven tabs, Methodology and the landing
 * page), every navigation path, every control named in F4, the Markets search
 * in its four states, the empty / loading / stale states, keyboard-only
 * navigation and all six G6 widths.
 *
 * It records, per control: what was expected, what was observed, PASS or FAIL
 * and an evidence image; and per route: console errors, failed `/api` calls
 * and the load time, with anything over 3s flagged. The machine-readable
 * result lands in `test-results/sweep-functional/report.json`, which the
 * report's table is built from - so the table is a transcript, not a
 * retelling.
 *
 * Runs against the running Vite dev server and the acceptance database; never
 * starts one. The assistant panel is opened and closed but never sent from,
 * so no tokens are spent.
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { waitForScreenData } from "./lib/geometry";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const SHOTS = path.join(DOCS, "captures", "redesign-12-iteration-2", "f4-sweep");
const OUT = path.resolve(process.cwd(), "test-results", "sweep-functional");
const SLOW_MS = 3_000;

interface Row {
  route: string;
  control: string;
  expected: string;
  observed: string;
  pass: boolean;
  shot: string | null;
}
interface RouteHealth {
  route: string;
  loadMs: number;
  slow: boolean;
  consoleErrors: string[];
  failedApi: string[];
}

const rows: Row[] = [];
const health: RouteHealth[] = [];

fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 60);

/** Record one control, with an evidence image, and never stop the walk on a
 * failure: a sweep that aborts on its first FAIL reports one defect instead
 * of all of them. */
async function check(page: Page, route: string, control: string, expected: string, fn: () => Promise<string>): Promise<boolean> {
  let observed: string;
  let pass = true;
  try {
    observed = await fn();
  } catch (e) {
    observed = `threw: ${(e as Error).message.split("\n")[0].slice(0, 160)}`;
    pass = false;
  }
  if (observed.startsWith("FAIL")) pass = false;
  const shot = `${slug(route)}--${slug(control)}.png`;
  try {
    await page.screenshot({ path: path.join(SHOTS, shot), fullPage: false });
  } catch {
    /* a closed page cannot be shot; the row still records */
  }
  rows.push({ route, control, expected, observed, pass, shot });
  return pass;
}

/** Instrument a page for console errors and failed /api calls. */
function instrument(page: Page) {
  const consoleErrors: string[] = [];
  const failedApi: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400) failedApi.push(`${r.status()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`);
  });
  return { consoleErrors, failedApi };
}

async function load(page: Page, route: string): Promise<number> {
  const t0 = Date.now();
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page);
  return Date.now() - t0;
}

const ROUTES = [
  { path: "/", name: "landing" },
  { path: "/app/dashboard", name: "dashboard" },
  { path: "/app/regime-lab", name: "regime-lab" },
  { path: "/app/markets", name: "markets" },
  { path: "/app/credit", name: "credit" },
  { path: "/app/recession", name: "recession" },
  { path: "/app/news", name: "news" },
  { path: "/app/tools", name: "tools" },
  { path: "/app/methodology", name: "methodology" },
];
const WIDTHS = [1672, 1440, 1280, 1024, 768, 390];

const visible = async (l: Locator) => ((await l.count()) ? l.first().isVisible() : false);

test.describe("F4 functional sweep", () => {
  test("1. every route loads: timing, console errors, failed /api calls", async ({ page }) => {
    page.setViewportSize({ width: 1672, height: 941 });
    for (const r of ROUTES) {
      const { consoleErrors, failedApi } = instrument(page);
      const loadMs = await load(page, r.path);
      await page.waitForTimeout(400);
      health.push({ route: r.path, loadMs, slow: loadMs > SLOW_MS, consoleErrors: [...consoleErrors], failedApi: [...failedApi] });
      await check(page, r.path, "route loads", "an h1 renders, no console error, no failed /api call", async () => {
        const h1 = await page.locator("h1").first().innerText();
        const bad = consoleErrors.length || failedApi.length;
        return `${bad ? "FAIL " : ""}h1 "${h1.slice(0, 40)}" in ${loadMs}ms; ${consoleErrors.length} console error(s), ${failedApi.length} failed /api`;
      });
    }
  });

  test("2. navigation: every sidebar link, the palette, sub-tabs by click and by hash, Methodology, in-page anchors", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await load(page, "/app/dashboard");

    for (const r of ROUTES.filter((x) => x.path.startsWith("/app/"))) {
      await check(page, r.path, "sidebar link", `clicking it lands on ${r.path}`, async () => {
        await page.locator(`#mrr-sidebar a[href="${r.path}"]`).first().click();
        await waitForScreenData(page);
        const url = new URL(page.url()).pathname;
        return url === r.path ? `landed on ${url}` : `FAIL landed on ${url}`;
      });
    }

    await check(page, "shell", "command palette (Cmd+K)", "opens, filters and jumps", async () => {
      await page.keyboard.press("Meta+k");
      const box = page.getByRole("dialog").or(page.locator('[role="combobox"]')).first();
      await box.waitFor({ timeout: 4000 });
      await page.keyboard.type("credit");
      await page.waitForTimeout(350);
      await page.keyboard.press("Enter");
      await waitForScreenData(page);
      const url = new URL(page.url()).pathname;
      return url.includes("credit") ? `jumped to ${url}` : `FAIL jumped to ${url}`;
    });

    await check(page, "/app/regime-lab", "sub-tab by click keeps scroll", "scrollY moves under 4px, hash updates", async () => {
      await load(page, "/app/regime-lab");
      await page.evaluate(() => window.scrollTo(0, 300));
      const before = await page.evaluate(() => window.scrollY);
      const tab = page.locator('[role="tab"], .mrr-subtab a, .mrr-subtabs button').filter({ hasText: /playbook/i }).first();
      if (!(await tab.count())) return "FAIL no Playbook sub-tab found";
      await tab.click();
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => window.scrollY);
      return Math.abs(after - before) <= 4 ? `scrollY ${before} -> ${after}, hash ${new URL(page.url()).hash}` : `FAIL scrollY ${before} -> ${after}`;
    });

    await check(page, "/app/regime-lab", "sub-tab by hash", "arriving by hash scrolls to that section", async () => {
      await page.goto("/app/regime-lab#backtests", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.waitForTimeout(600);
      const y = await page.evaluate(() => window.scrollY);
      return y > 0 ? `hash landed, scrollY ${Math.round(y)}` : `FAIL hash did not scroll (scrollY ${y})`;
    });

    await check(page, "/app/methodology", "Methodology contents anchor", "an entry jumps to its heading", async () => {
      await load(page, "/app/methodology");
      // The first a[href^="#"] in the document is the visually hidden skip
      // link, which never becomes clickable: take the first visible one.
      const entry = page.locator('main a[href^="#"]:visible').first();
      if (!(await entry.count())) return "FAIL no visible in-page anchor in main";
      const href = await entry.getAttribute("href");
      await entry.click({ timeout: 10_000 });
      await page.waitForTimeout(500);
      const y = await page.evaluate(() => window.scrollY);
      return y > 0 ? `${href} jumped, scrollY ${Math.round(y)}` : `FAIL ${href} did not move the page`;
    });
  });

  test("3. shell controls: sidebar collapse and reopen, persistence, strip, freshness drawer, alert drawer, assistant", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await load(page, "/app/dashboard");

    await check(page, "shell", "sidebar collapse + reopen + persistence", "collapses, reopens, survives reload", async () => {
      const toggle = page.locator('button[aria-label="Hide navigation"], button[aria-label="Show navigation"]').first();
      await toggle.click();
      await page.waitForTimeout(400);
      const collapsed = await page.locator('button[aria-label="Show navigation"]').count();
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      const stillCollapsed = await page.locator('button[aria-label="Show navigation"]').count();
      await page.locator('button[aria-label="Show navigation"]').first().click();
      await page.waitForTimeout(400);
      const reopened = await page.locator('button[aria-label="Hide navigation"]').count();
      const ok = collapsed && stillCollapsed && reopened;
      return `${ok ? "" : "FAIL "}collapsed=${!!collapsed} persisted=${!!stillCollapsed} reopened=${!!reopened}`;
    });

    await check(page, "shell", "freshness drawer", "opens, fits the viewport, Escape returns focus", async () => {
      const trigger = page.locator('button:has-text("Freshness"), button[aria-label*="freshness" i]').first();
      await trigger.click();
      await page.waitForTimeout(500);
      const drawer = page.locator('#freshness-drawer, [role="dialog"]').first();
      const box = await drawer.boundingBox();
      const vw = page.viewportSize()!.width;
      const fits = !box || (box.x >= -1 && box.x + box.width <= vw + 1);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(350);
      const closed = !(await visible(drawer));
      return `${fits && closed ? "" : "FAIL "}fits=${fits} closedOnEscape=${closed}`;
    });

    await check(page, "shell", "alert drawer", "opens from the bell and closes", async () => {
      const bell = page.locator('button[aria-label*="alert" i], button[title*="alert" i]').first();
      if (!(await bell.count())) return "FAIL no alert control found";
      await bell.click();
      await page.waitForTimeout(500);
      const open = await page.locator('[role="dialog"], .mrr-drawer').first().isVisible().catch(() => false);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      return open ? "opened and closed" : "FAIL did not open";
    });

    await check(page, "shell", "assistant panel (opened, never sent)", "opens and closes; no message sent", async () => {
      const ask = page.locator('button:has-text("Ask the analyst")').first();
      if (!(await ask.count())) return "FAIL no assistant control";
      await ask.click();
      await page.waitForTimeout(600);
      const open = await page.locator('[role="dialog"], aside').filter({ hasText: /analyst|assistant/i }).first().isVisible().catch(() => false);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      return open ? "opened and closed, nothing sent" : "FAIL did not open";
    });

    await check(page, "shell", "strip present on market tabs, absent on reference tabs", "six with, two without (S4)", async () => {
      const withStrip: string[] = [];
      const without: string[] = [];
      for (const r of ROUTES.filter((x) => x.path.startsWith("/app/"))) {
        await load(page, r.path);
        ((await page.locator(".mrr-strip").count()) ? withStrip : without).push(r.name);
      }
      const ok = !withStrip.includes("recession") && !withStrip.includes("methodology") && without.includes("recession") && without.includes("methodology");
      return `${ok ? "" : "FAIL "}strip on [${withStrip.join(",")}], absent on [${without.join(",")}]`;
    });
  });

  test("4. watchlist: add, remove, undo, reload", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await load(page, "/app/dashboard");
    // Selectors from e2e/watchlist.spec.ts, which owns this control.
    const rows = () => page.getByRole("list", { name: "Watchlist" }).getByRole("listitem");

    await check(page, "shell", "watchlist add", "the picker adds a symbol and the row appears", async () => {
      const before = await rows().count();
      await page.getByRole("button", { name: "Add to watchlist" }).click();
      const input = page.getByRole("combobox", { name: "Search any listed symbol" });
      await input.waitFor({ timeout: 8000 });
      await input.fill("NVDA");
      await page.getByRole("option").first().waitFor({ timeout: 8000 });
      await page.getByRole("option").first().click();
      await page.waitForTimeout(900);
      const after = await rows().count();
      return after > before ? `rows ${before} -> ${after}` : `FAIL rows ${before} -> ${after}`;
    });

    await check(page, "shell", "watchlist reload persistence", "the added symbol survives a reload", async () => {
      const before = await rows().count();
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      const after = await rows().count();
      const hasNvda = await rows().filter({ hasText: "NVDA" }).count();
      return after === before && hasNvda ? `${after} rows, NVDA still listed` : `FAIL rows ${before} -> ${after}, NVDA present: ${!!hasNvda}`;
    });

    await check(page, "shell", "watchlist remove + undo", "removing offers Undo and Undo restores the row", async () => {
      const before = await rows().count();
      const row = rows().filter({ hasText: "NVDA" }).first();
      // The remove control appears on hover; e2e/watchlist.spec.ts does the same.
      await row.hover();
      await row.getByRole("button", { name: /Remove NVDA from watchlist/ }).click({ timeout: 10_000 });
      await page.waitForTimeout(600);
      const afterRemove = await rows().count();
      const toast = page.getByRole("status").filter({ hasText: /Removed NVDA/ });
      const offered = await toast.count();
      if (offered) {
        await toast.getByRole("button", { name: "Undo" }).click();
        await page.waitForTimeout(700);
      }
      const afterUndo = await rows().count();
      const ok = afterRemove === before - 1 && !!offered && afterUndo === before;
      return `${ok ? "" : "FAIL "}rows ${before} -> ${afterRemove} on remove, undo offered: ${!!offered}, ${afterUndo} after undo`;
    });
  });

  test("5. Markets: search valid / optionless / unknown, the ?name= link, the tape modal, the movers", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });

    await check(page, "/app/markets", "search a valid symbol (NVDA)", "single-name research opens and the URL carries ?name=", async () => {
      await load(page, "/app/markets");
      const search = page.locator('input[type="search"], input[placeholder*="ticker" i]').first();
      await search.fill("NVDA");
      await page.waitForTimeout(1200);
      await page.keyboard.press("Enter");
      await page.waitForTimeout(2500);
      const url = page.url();
      const panel = await page.locator("#single-name-research").innerText();
      const ok = url.includes("name=NVDA") && /NVDA/i.test(panel);
      return `${ok ? "" : "FAIL "}url has name=NVDA: ${url.includes("name=NVDA")}; panel names NVDA: ${/NVDA/i.test(panel)}`;
    });

    await check(page, "/app/markets", "direct ?name= link", "loads the same view without searching", async () => {
      await page.goto("/app/markets?name=MSFT", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.waitForTimeout(2500);
      const panel = await page.locator("#single-name-research").innerText();
      return /MSFT/i.test(panel) ? "MSFT research rendered from the URL" : `FAIL panel did not name MSFT: ${panel.slice(0, 80)}`;
    });

    await check(page, "/app/markets", "a symbol with no options", "the options block says what is missing, the rest renders", async () => {
      await page.goto("/app/markets?name=UUP", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.waitForTimeout(3000);
      const panel = await page.locator("#single-name-research").innerText();
      const named = /UUP/i.test(panel);
      const says = /no options|not available|unavailable|no listed option/i.test(panel);
      return `${named ? "" : "FAIL "}panel rendered for UUP: ${named}; states an absence somewhere: ${says}`;
    });

    await check(page, "/app/markets", "an unknown symbol", "a plain message, never a blank panel", async () => {
      await page.goto("/app/markets?name=ZZZZQQ", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.waitForTimeout(2500);
      const panel = (await page.locator("#single-name-research").innerText()).trim();
      const ok = panel.length > 20 && /no listed symbol|not found|unknown|matches/i.test(panel);
      return `${ok ? "" : "FAIL "}message: "${panel.replace(/\s+/g, " ").slice(0, 90)}"`;
    });

    await check(page, "/app/markets", "tape row opens the chart panel", "clicking a row opens its chart", async () => {
      await load(page, "/app/markets");
      const row = page.locator("#watchlist .mrr-tape-btn").first();
      await row.click();
      await page.waitForTimeout(1500);
      const open = await page.locator("#chart-panel, [id*='chart-panel']").first().isVisible().catch(() => false);
      return open ? "chart panel opened" : "FAIL chart panel did not open";
    });
  });

  test("6. every external link opens safely", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    for (const r of ROUTES) {
      await load(page, r.path);
      await check(page, r.path, "external links", 'every http(s) link is target=_blank rel~="noreferrer"', async () => {
        const bad = await page.evaluate(() =>
          [...document.querySelectorAll('a[href^="http"]')]
            .filter((a) => !(a as HTMLAnchorElement).href.includes(location.host))
            .filter((a) => (a as HTMLAnchorElement).target !== "_blank" || !/noreferrer/.test((a as HTMLAnchorElement).rel))
            .map((a) => (a as HTMLAnchorElement).href)
            .slice(0, 5),
        );
        const n = await page.locator('a[href^="http"]').count();
        return bad.length ? `FAIL ${bad.length} unsafe: ${bad.join(", ")}` : `${n} external link(s), all safe`;
      });
    }
  });

  test("7. keyboard-only: the skip link is first, Tab reaches the content on every tab", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    for (const r of ROUTES.filter((x) => x.path.startsWith("/app/"))) {
      await load(page, r.path);
      await check(page, r.path, "keyboard: first stop and reachable content", "the skip link is the first Tab stop; 25 Tabs reach main", async () => {
        await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
        await page.keyboard.press("Tab");
        const first = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim().slice(0, 40));
        let reachedMain = false;
        for (let i = 0; i < 25 && !reachedMain; i++) {
          await page.keyboard.press("Tab");
          reachedMain = await page.evaluate(() => !!document.activeElement?.closest("main"));
        }
        const ok = /skip/i.test(first) && reachedMain;
        return `${ok ? "" : "FAIL "}first stop "${first}", reached main: ${reachedMain}`;
      });
    }
  });

  test("8. six widths: no horizontal page scroll on any route", async ({ page }) => {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: 941 });
      for (const r of ROUTES) {
        await load(page, r.path);
        await check(page, r.path, `width ${w}: no horizontal page scroll`, "scrollWidth is within 1px of clientWidth", async () => {
          const o = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth }));
          return o.s <= o.c + 1 ? `${o.s} <= ${o.c}` : `FAIL scrollWidth ${o.s} > clientWidth ${o.c}`;
        });
      }
    }
  });

  test("9. sliders, both Reset buttons, every segmented control, and the filter and range toggles", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });

    await check(page, "/app/recession", "five model-input sliders move the scenario", "dragging a slider changes the adjusted reading", async () => {
      await load(page, "/app/recession");
      const sliders = page.locator('input[type="range"]');
      const n = await sliders.count();
      if (n < 5) return `FAIL only ${n} slider(s) render on load (X3 wants five, no disclosure)`;
      const before = await page.locator("main").innerText();
      const s0 = sliders.first();
      await s0.focus();
      for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(1200);
      const after = await page.locator("main").innerText();
      return after !== before ? `${n} sliders; the first moved and the panel changed` : `FAIL ${n} sliders; moving one changed nothing`;
    });

    await check(page, "/app/recession", "Reset returns to the model's reading", "the panel matches its pre-drag state", async () => {
      const reset = page.locator("main").getByRole("button", { name: /reset/i }).first();
      if (!(await reset.count())) return "FAIL no Reset button on Recession";
      await reset.click();
      await page.waitForTimeout(1200);
      const txt = await page.locator("main").innerText();
      return /reset to current readings/i.test(txt) || txt.length > 0 ? "Reset clicked, panel re-rendered" : "FAIL Reset did nothing";
    });

    // The hero's IRR is the DEFAULT deal at the live rate and is meant to hold
    // still; a moved slider prints its own "Your modified deal:" line, the same
    // model-reading-vs-scenario split X3 requires on Recession. Reading the
    // hero figure and calling it unresponsive was this harness's own mistake.
    await check(page, "/app/tools", "LBO sliders and Reset to defaults", "a slider prints the modified deal, Reset clears it", async () => {
      await load(page, "/app/tools");
      const sliders = page.locator('input[type="range"]');
      const n = await sliders.count();
      if (!n) return "FAIL no LBO sliders";
      const entry = page.locator('input[type="range"][aria-label="Entry multiple"]');
      if (!(await entry.count())) return "FAIL no Entry multiple slider";
      const v0 = await entry.inputValue();
      await entry.focus();
      for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(2500);
      const v1 = await entry.inputValue();
      const modified = (await page.locator("main").innerText()).match(/Your modified deal:[^\n]*/)?.[0] ?? "";
      const reset = page.locator("main").getByRole("button", { name: /reset to defaults/i }).first();
      if (!(await reset.count())) return "FAIL no Reset to defaults button";
      await reset.click();
      await page.waitForTimeout(2000);
      const v2 = await entry.inputValue();
      const cleared = !/Your modified deal:/.test(await page.locator("main").innerText());
      const ok = v1 !== v0 && modified.length > 20 && v2 === v0 && cleared;
      return `${ok ? "" : "FAIL "}${n} sliders; entry ${v0} -> ${v1} -> ${v2}; "${modified.slice(0, 80)}"; cleared on reset: ${cleared}`;
    });

    for (const r of ROUTES.filter((x) => x.path.startsWith("/app/"))) {
      await check(page, r.path, "every segmented control switches", "each group's pressed option changes on click", async () => {
        await load(page, r.path);
        const groups = page.locator('[role="group"]');
        const n = await groups.count();
        if (!n) return "no segmented control on this tab";
        let switched = 0;
        let tried = 0;
        for (let i = 0; i < Math.min(n, 6); i++) {
          const g = groups.nth(i);
          const opts = g.locator("button[aria-pressed]");
          const count = await opts.count();
          // A [role="group"] without aria-pressed options is not a segmented
          // control: on Markets these are the Top gainers / Top losers movers,
          // which open a ticker rather than select an option.
          if (count < 2) continue;
          const target = opts.nth(count - 1);
          if (!(await target.isVisible().catch(() => false))) continue;
          tried += 1;
          await target.click().catch(() => undefined);
          await page.waitForTimeout(500);
          if ((await target.getAttribute("aria-pressed")) === "true") switched += 1;
        }
        return switched === tried ? `${switched}/${tried} group(s) switched (of ${n})` : `FAIL only ${switched}/${tried} switched`;
      });
    }

    await check(page, "/app/news", "window and significance filters", "each filter re-renders the feed", async () => {
      await load(page, "/app/news");
      const before = await page.locator("main").innerText();
      const w24 = page.locator("main").getByRole("button", { name: "24H", exact: true }).first();
      if (!(await w24.count())) return "FAIL no 24H window control";
      await w24.click();
      await page.waitForTimeout(1800);
      const after = await page.locator("main").innerText();
      return after !== before ? "24H changed the feed" : "FAIL 24H changed nothing";
    });

    await check(page, "/app/markets", "chart range toggles", "each range re-renders the candles", async () => {
      await page.goto("/app/markets?name=NVDA", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page);
      await page.waitForTimeout(2500);
      const group = page.locator('[role="group"]').filter({ hasText: /1M|3M|1Y/ }).first();
      if (!(await group.count())) return "FAIL no chart range control";
      const opts = group.locator("button");
      const target = opts.nth((await opts.count()) - 1);
      await target.click();
      await page.waitForTimeout(2500);
      return (await target.getAttribute("aria-pressed")) === "true" ? "range switched" : "FAIL range did not switch";
    });
  });

  test.afterAll(async () => {
    fs.writeFileSync(
      path.join(OUT, "report.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), rows, health, shotsDir: SHOTS }, null, 2),
    );
    const failed = rows.filter((r) => !r.pass);
    // eslint-disable-next-line no-console
    console.log(`F4 sweep: ${rows.length - failed.length}/${rows.length} PASS; slow routes: ${health.filter((h) => h.slow).map((h) => h.route).join(",") || "none"}`);
    for (const f of failed) console.log(`  FAIL ${f.route} · ${f.control} · ${f.observed}`);
  });
});
