/**
 * Phase 10 checklist (docs/redesign-v2/checklists/10-states-a11y.md) B.0 and
 * B.7 (E.3 #8): the loading, error, snapshot, empty and stale cells, driven
 * against the one Vite dev server on :5173 proxying the one uvicorn on :8000
 * (servers are never started or stopped here; the relay-down "stream
 * unavailable" line is the manual MCP cell, E.3 #9, and is never asserted).
 * Every cell opens a fresh browser context, applies its B.0 recipe from
 * e2e/lib/states.ts BEFORE the goto, asserts the copy B.7 quotes (verified
 * against the current screens; each string cites its source line), captures
 * `<route>--<width>--<state>.png` and records the console under
 * `${route}--${width}--${state}` in console.json. ERROR_CONSOLE_ALLOW applies
 * only in the error and snapshot cells; a pageerror is never allowed.
 *
 * Cells (E.3 #8): error (unseeded) and snapshot (seeded) on the eight tab
 * routes at 1672 and 390; loading (unseeded + delayApi) on the eight tabs at
 * 1672; empty on Dashboard (signals, calendar, priced), Regime Lab (history),
 * Markets (priced, surprises, daily), News (feed, calendar), Credit
 * (tight_count) and Methodology (signals) at 1672; stale on Dashboard,
 * Markets, News and Credit at 1672. The Markets error cell accepts either the
 * relay clock or "no quote" per tape row (G12).
 */
import fs from "node:fs";
import path from "node:path";
import { test, expect, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { baselineConsoleTexts, captureDir, collect, mergeJsonFile, settle, type ConsoleRec, type FailedReq } from "./lib/drive";
import { consoleVerdict, delayApi, emptyEndpoint, rewriteEndpoint, staleFeeds, stopApi, unseed, type StateName } from "./lib/states";

const OUT = captureDir();
const CONSOLE_PATH = path.join(OUT, "console.json");
const SNAPSHOT_FILE = path.resolve(process.cwd(), "public", "snapshot", "latest.json");
/** B.0 "loading": longer than the checklist's 4 s so the checks and the capture never race the delay. */
const LOADING_DELAY_MS = 5000;
const DESK = { width: 1672, height: 941 };
const PHONE = { width: 390, height: 844 };

/** shell-status.ts:43-44 SNAPSHOT_NOTE, verbatim. */
const SNAPSHOT_NOTE = "The data service is asleep or unreachable; this page runs on the validated snapshot and reconnects on its own.";
/** screen-ui.tsx StateNote words (unchanged by contract 1). */
const NOTE_ERROR = "Unavailable: the data service did not answer.";
const NOTE_LOADING = "Reading stored data…";
const NOTE_EMPTY = "Nothing on file.";
/** contracts 3 to 5 (Phase 10 C #1 to #4). */
const SIGNAL_FEED_DOWN = "Signal feed unavailable: the data service did not answer.";
const SIGNAL_PRINT_DOWN = "Signal print · unavailable";
const SIGNAL_EMPTY = "No print on file yet for this signal; the daily refresh writes signal prints at 11:17 UTC.";
const SIGNAL_PRINT_NONE = "Signal print · none on file";
const CALENDAR_EMPTY = "No events on file; the calendar is a hand-maintained schedule refreshed with the daily run.";
const NEWS_EMPTY = "Nothing on file; the news pipeline runs hourly (minute 41 UTC) and has not stored headlines yet.";
/** lbo-copy.ts:52 RATE_UNAVAILABLE_HEADLINE (FALLBACK_RATE 8.50). */
const LBO_RATE_UNAVAILABLE = "Financing rate unavailable: the data service did not answer. The calculator falls back to the stated 8.50% rate.";
const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];

interface RouteDef {
  slug: string;
  route: string;
  screen: string;
}
const TAB_ROUTES: RouteDef[] = [...TABS.map((t) => ({ slug: t.slug, route: `/app/${t.slug}`, screen: t.slug })), { slug: METHODOLOGY_SLUG, route: `/app/${METHODOLOGY_SLUG}`, screen: METHODOLOGY_SLUG }];

/** The seeded regime label from the static snapshot the dev server serves. */
function seededRegimeLabel(): string | null {
  try {
    const file = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as { entries?: Record<string, { label?: string }> };
    return file.entries?.["/api/regime/latest"]?.label ?? null;
  } catch {
    return null;
  }
}

/* ── the cell harness ───────────────────────────────────────────────────── */

interface Cell {
  ctx: BrowserContext;
  page: Page;
  sink: ReturnType<typeof collect>;
}

async function openCell(browser: Browser, viewport: { width: number; height: number }, prepare: (page: Page) => Promise<void>): Promise<Cell> {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const sink = collect(page);
  await prepare(page);
  return { ctx, page, sink };
}

async function finishCell(cell: Cell, def: RouteDef, width: number, state: StateName, extra: Record<string, unknown> = {}): Promise<void> {
  const { page, sink, ctx } = cell;
  await page.screenshot({ path: path.join(OUT, `${def.slug}--${width}--${state}.png`), fullPage: true }).catch(() => undefined);
  const rows: ConsoleRec[] = sink.console.slice();
  const failed: FailedReq[] = sink.failed.slice();
  const verdict = consoleVerdict(rows, failed, state, baselineConsoleTexts(def.screen));
  mergeJsonFile(CONSOLE_PATH, `${def.slug}--${width}--${state}`, { state, console: rows, failed, fresh: verdict.fresh, ...extra });
  await ctx.close();
  expect(verdict.disallowed, `${def.slug}--${width}--${state}: console lines the ${state} cell does not allow`).toEqual([]);
  expect(failed, `${def.slug}--${width}--${state}: failed API responses`).toEqual([]);
}

const strip = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });
const card = (page: Page) => strip(page).locator(".mrr-upd-lines");
/** Iteration 1 S4: no strip on Recession and Methodology; the sidebar's freshness entry opens the drawer there. */
const hasStrip = (slug: string) => slug !== "recession" && slug !== METHODOLOGY_SLUG;
/** The freshness drawer's trigger for a route: the strip card's "Freshness ›", else the sidebar entry (the MobileNav list's below 860). */
async function openFreshness(page: Page, slug: string, width: number): Promise<void> {
  if (hasStrip(slug)) {
    await strip(page).getByRole("button", { name: /^Freshness/ }).click();
    return;
  }
  if (width < 860) await page.locator("button[aria-controls='mobile-nav-list']").click();
  await page.getByTestId("sidebar-freshness").click();
}
const heroPill = (page: Page, heroId: string) => page.locator(`#${heroId} .mrr-pill`);
const stripTitle = (page: Page, summaryId: string) => page.locator(`#${summaryId} .mrr-status .mrr-status-title`);
const section = (page: Page, id: string) => page.locator(`#${id}`);
/** The Sensitivity panel card (no id of its own; `#sensitivity` is the Disclosure inside it). */
const sensitivityCard = (page: Page) => page.locator("main section").filter({ has: page.locator("h2", { hasText: /^Sensitivity$/i }) }).first();

/** Contract 6: no transitional regime pill or odds bar anywhere in the shell, at any width. */
async function expectNoRegimePill(page: Page): Promise<void> {
  await expect(page.locator(".mrr-regime, .mrr-regime-note, .mrr-mnav-regime, .mrr-top-l")).toHaveCount(0);
  const chrome = await page.evaluate(() => {
    const texts: string[] = [];
    document.querySelectorAll("header, nav[aria-label='Primary']").forEach((el) => texts.push((el as HTMLElement).innerText));
    return texts.join("\n");
  });
  expect(chrome).not.toContain("Reading regime…");
  expect(chrome).not.toContain("Regime unavailable: API error");
}

/* ── per-route checks ───────────────────────────────────────────────────── */

async function checkError(page: Page, slug: string): Promise<void> {
  switch (slug) {
    case "dashboard": {
      // DashboardScreen.tsx:428-429.
      await expect(section(page, "regime-hero")).toContainText("Regime unavailable: the data service did not answer. The read resumes when it is back.", { timeout: 20_000 });
      await expect(heroPill(page, "regime-hero")).toHaveText("Unavailable");
      // DashboardScreen.tsx:481 and the C #1 branch (contract 3).
      await expect(section(page, "signals")).toContainText("signal feed unavailable");
      const articles = section(page, "signals").locator("article");
      await expect(articles).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        await expect(articles.nth(i)).toContainText(SIGNAL_FEED_DOWN);
        await expect(articles.nth(i)).toContainText(SIGNAL_PRINT_DOWN);
        await expect(articles.nth(i).locator("[data-tone]").first()).toHaveText(/^Unavailable$/i);
      }
      await expect(section(page, "signals")).not.toContainText("No print on file");
      await expect(section(page, "macro-calendar")).toContainText(NOTE_ERROR);
      await expect(stripTitle(page, "regime-summary")).toHaveText("Alert feed unavailable"); // DashboardScreen.tsx:137
      break;
    }
    case "regime-lab": {
      await expect(section(page, "takeaway")).toContainText("Cycle position unavailable: the data service did not answer.", { timeout: 20_000 }); // RegimeLabScreen.tsx:161
      await expect(heroPill(page, "takeaway")).toHaveText("Unavailable");
      await expect(section(page, "takeaway")).toContainText("Takeaway unavailable: the data service did not answer."); // RegimeLabScreen.tsx:133
      await expect(stripTitle(page, "regime-outlook")).toHaveText("Overheating odds unavailable"); // regimelab/hero-copy.ts:117
      await expect(section(page, "cycle")).toContainText(NOTE_ERROR); // OverviewTab.tsx:125
      break;
    }
    case "markets": {
      await expect(section(page, "markets-hero")).toContainText("Stored closes unavailable: the data service did not answer. The tape keeps its live quotes.", { timeout: 20_000 }); // MarketsScreen.tsx:580
      await expect(heroPill(page, "markets-hero")).toHaveText("Unavailable");
      await expect(section(page, "whats-priced-full")).toContainText("Market-implied pricing unavailable: the data service did not answer."); // WhatsPriced.tsx:141
      await expect(section(page, "top-surprises")).toContainText("Surprise feed unavailable: the data service did not answer."); // TopSurprises.tsx:106
      // G12: with the relay alive each row shows a quote with its clock, else "no quote" (MacroTape.tsx:158) and the dash.
      const rows = section(page, "watchlist").locator("tbody tr:not(.mrr-grp)");
      expect(await rows.count()).toBeGreaterThan(0);
      for (const row of await rows.all()) {
        const text = (await row.innerText()).replace(/\s+/g, " ").trim();
        const asOf = (await row.locator("td").last().innerText()).trim();
        const clock = /(?:\d\d:\d\d(?::\d\d)? ET|15m delayed|15m|close)/.test(asOf);
        expect(clock || text.includes("no quote"), `tape row "${text.slice(0, 40)}" reads the relay clock or "no quote"`).toBe(true);
      }
      break;
    }
    case "credit": {
      await expect(section(page, "credit-hero")).toContainText("Credit metrics unavailable: the data service did not answer. The read resumes when it is back.", { timeout: 20_000 }); // CreditScreen.tsx:216
      await expect(heroPill(page, "credit-hero")).toHaveText("Unavailable");
      await expect(stripTitle(page, "credit-summary")).toHaveText("Ladder unavailable"); // credit/hero-copy.ts:165
      for (const id of ["oas", "quality-ladder", "credit-state-odds", "financing"]) await expect(section(page, id), id).toContainText(NOTE_ERROR);
      break;
    }
    case "recession": {
      await expect(section(page, "recession-hero")).toContainText("Recession model unavailable: its endpoint trains in-process and may need a warm start.", { timeout: 20_000 }); // RecessionScreen.tsx:76
      await expect(heroPill(page, "recession-hero")).toHaveText("Unavailable");
      for (const id of ["model", "curve", "transparency"]) await expect(section(page, id), id).toContainText(NOTE_ERROR);
      // SensitivityPanel.tsx:78-84: with no model the row is not rendered; the card carries the error note.
      await expect(sensitivityCard(page)).toContainText(NOTE_ERROR);
      break;
    }
    case "news": {
      await expect(section(page, "news-hero")).toContainText("Calendar unavailable: the data service did not answer.", { timeout: 20_000 }); // NewsScreen.tsx:355
      await expect(heroPill(page, "news-hero")).toHaveText("Unavailable");
      await expect(section(page, "calendar")).toContainText(NOTE_ERROR); // CalendarPanel.tsx:172
      await expect(section(page, "headlines")).toContainText(NOTE_ERROR); // NewsScreen.tsx:486 (StateNote error)
      break;
    }
    case "tools": {
      // lbo-copy.ts lboHero: with the defaults unanswered the hero is the rate-error state
      // (RATE_UNAVAILABLE_HEADLINE, lbo-copy.ts:52); "Deal model unavailable" (09 C.1, U6-015,
      // unverified in the checklist) is the run-error state and needs a served defaults payload.
      await expect(section(page, "lbo-hero")).toContainText(LBO_RATE_UNAVAILABLE, { timeout: 20_000 });
      await expect(heroPill(page, "lbo-hero")).toHaveText(/^Unavailable$/);
      // LboPanel.tsx LboRunState: the ApiError status 0 sentence in the Outputs column.
      await expect(section(page, "lbo")).toContainText("The data service did not answer; the deal model will rerun when it returns.", { timeout: 20_000 });
      await expect(stripTitle(page, "lbo-summary")).toHaveText("Rate feed unavailable"); // lbo-copy.ts:199
      break;
    }
    case METHODOLOGY_SLUG: {
      await expect(section(page, "signals")).toContainText(NOTE_ERROR, { timeout: 20_000 }); // MethodologyScreen.tsx StateNote error
      await expect(page.locator("main h1")).toHaveText("Methodology"); // contract 7
      for (const id of ["how-to-read", "regimes", "models", "data", "limits"]) await expect(section(page, id)).toHaveCount(1);
      break;
    }
    default:
      throw new Error(`no error check for ${slug}`);
  }
}

async function checkSnapshot(page: Page, slug: string, seededLabel: string | null): Promise<void> {
  switch (slug) {
    case "dashboard": {
      // The seeded regime paints; no hero error copy (DashboardScreen.tsx:421-436 rule).
      await expect(page.locator("main h1")).toHaveText(seededLabel ? new RegExp(`^${seededLabel}$`) : new RegExp(`^(?:${REGIMES.join("|")})$`));
      await expect(section(page, "regime-hero")).not.toContainText("Regime unavailable");
      // The recession model is not seeded (F1): the key-level tile says so (KeyLevels.tsx:128-130).
      await expect(section(page, "key-levels")).toContainText("Recession model unavailable: its endpoint trains in-process and may need a warm start.", { timeout: 20_000 });
      break;
    }
    case "regime-lab": {
      // history, latest and playbooks are seeded: the ribbon and the strip render; duration is not (F1).
      await expect(section(page, "regime-history-teaser").locator("svg[role='img']")).toHaveCount(1, { timeout: 20_000 });
      await expect(stripTitle(page, "regime-outlook")).toHaveText(/^(?:Watch · Overheating odds rising|Overheating odds not rising)$/);
      await expect(section(page, "regime-outlook")).toContainText(new RegExp(REGIMES.join("|")));
      await expect(section(page, "takeaway")).toContainText("Cycle position unavailable: the data service did not answer.", { timeout: 20_000 });
      break;
    }
    case "markets": {
      // priced and surprises are seeded; market/daily is not (F1).
      await expect(section(page, "whats-priced-full")).not.toContainText("Market-implied pricing unavailable");
      await expect(section(page, "top-surprises")).not.toContainText("Surprise feed unavailable");
      await expect(section(page, "markets-hero")).toContainText("Stored closes unavailable: the data service did not answer.", { timeout: 20_000 });
      break;
    }
    case "credit": {
      // credit/metrics is not seeded (F1); credit/oas is, so the strip's US 10Y card prints.
      await expect(section(page, "oas")).toContainText(NOTE_ERROR, { timeout: 20_000 });
      await expect(strip(page).locator('[data-symbol="US 10Y"] .v')).toHaveText(/^\d\.\d\d%$/);
      break;
    }
    case "recession": {
      await expect(section(page, "recession-hero")).toContainText("Recession model unavailable", { timeout: 20_000 });
      await expect(section(page, "model")).toContainText(NOTE_ERROR);
      break;
    }
    case "news": {
      // news, latest, calendar and recent are all seeded: the fullest snapshot tab.
      await expect(section(page, "news-hero")).not.toContainText("Calendar unavailable");
      await expect(section(page, "calendar")).not.toContainText(NOTE_ERROR);
      await expect(section(page, "headlines")).not.toContainText(NOTE_ERROR);
      break;
    }
    case "tools": {
      // Neither lbo/defaults nor allocation is seeded (F1): the rate-error hero under the snapshot card.
      await expect(section(page, "lbo-hero")).toContainText(LBO_RATE_UNAVAILABLE, { timeout: 20_000 });
      await expect(section(page, "lbo")).toContainText("The data service did not answer; the deal model will rerun when it returns.", { timeout: 20_000 });
      break;
    }
    case METHODOLOGY_SLUG: {
      await expect(section(page, "signals").locator("[role='row']")).toHaveCount(6, { timeout: 20_000 }); // header row + five seeded signals
      await expect(section(page, "signals")).not.toContainText(NOTE_ERROR);
      break;
    }
    default:
      throw new Error(`no snapshot check for ${slug}`);
  }
}

async function checkLoading(page: Page, slug: string): Promise<void> {
  switch (slug) {
    case "dashboard":
      await expect(section(page, "regime-hero")).toContainText("Reading the latest regime…"); // DashboardScreen.tsx:435
      await expect(section(page, "signals").locator("article").first()).toContainText("Reading the signal print…"); // :520
      await expect(section(page, "regime-summary")).toContainText("Training the recession model; the first call takes about a second."); // :249
      break;
    case "regime-lab":
      await expect(section(page, "takeaway")).toContainText("Reading the cycle position…"); // RegimeLabScreen.tsx:167
      await expect(section(page, "takeaway")).toContainText("Assembling the market takeaway; the cold call trains the recession model once."); // :135
      await expect(stripTitle(page, "regime-outlook")).toHaveText("Reading the classifier history…"); // regimelab/hero-copy.ts:113
      await expect(section(page, "cycle")).toContainText(NOTE_LOADING); // OverviewTab.tsx:125
      break;
    case "markets":
      await expect(section(page, "markets-hero")).toContainText("Reading the tape…"); // MarketsScreen.tsx:599
      await expect(section(page, "whats-priced-full")).toContainText("Reading market-implied pricing…"); // WhatsPriced.tsx:143
      await expect(section(page, "top-surprises")).toContainText("Ranking the week's moves…"); // TopSurprises.tsx:108
      break;
    case "credit":
      await expect(section(page, "credit-hero")).toContainText("Reading credit spreads…"); // CreditScreen.tsx:224
      await expect(stripTitle(page, "credit-summary")).toHaveText("Reading the ladder…"); // credit/hero-copy.ts:166
      await expect(section(page, "oas")).toContainText(NOTE_LOADING);
      break;
    case "recession":
      await expect(section(page, "recession-hero")).toContainText("Training the recession model on stored NBER history…"); // RecessionScreen.tsx:75
      await expect(section(page, "recession-summary")).toContainText("Training the recession model; the first call takes about a second."); // :77
      await expect(section(page, "model")).toContainText(NOTE_LOADING);
      break;
    case "news":
      await expect(section(page, "news-hero")).toContainText("Reading the calendar…"); // NewsScreen.tsx:363
      await expect(section(page, "news-hero")).toContainText("Reading the stored headline feed…"); // news-copy.ts:223
      await expect(stripTitle(page, "news-summary")).toHaveText("Reading feed health…"); // news-copy.ts:306
      await expect(section(page, "calendar")).toContainText(NOTE_LOADING); // CalendarPanel.tsx:170
      break;
    case "tools":
      await expect(section(page, "lbo-hero")).toContainText("Running the default deal…"); // lbo-copy.ts:54 LOADING_HEADLINE
      await expect(section(page, "lbo")).toContainText(/Reading stored data…|Calculating the deal model…/); // LboPanel.tsx:141 / :69
      break;
    case METHODOLOGY_SLUG:
      await expect(section(page, "signals")).toContainText(NOTE_LOADING); // MethodologyScreen.tsx StateNote loading
      break;
    default:
      throw new Error(`no loading check for ${slug}`);
  }
}

/* ── error and snapshot: eight routes at 1672 and 390 ────────────────────── */

for (const vp of [DESK, PHONE]) {
  test(`error cells (unseeded, API unreachable) on the eight tab routes at ${vp.width}`, async ({ browser }) => {
    for (const def of TAB_ROUTES) {
      await test.step(`${def.slug}--${vp.width}--error`, async () => {
        const cell = await openCell(browser, vp, async (page) => {
          await unseed(page);
          await stopApi(page);
        });
        const { page } = cell;
        await page.goto(def.route, { waitUntil: "domcontentloaded" });
        await page.locator("main").waitFor();
        // Shell (B.7 row 1): the card, the footer, the bell; no pill anywhere (contract 6).
        // Iteration 1 S4: Recession and Methodology carry no strip; the footer states it there.
        if (hasStrip(def.slug)) {
          await expect(card(page)).toContainText("Data service unavailable", { timeout: 20_000 }); // FreshnessCard.tsx:72
          await expect(card(page)).toContainText("Freshness unavailable · retrying"); // FreshnessCard.tsx:84
        } else {
          await expect(strip(page)).toHaveCount(0);
        }
        if (vp.width >= 860) await expect(page.locator(".mrr-side-foot")).toContainText("Data service unavailable", { timeout: 20_000 }); // shell-status.ts:163
        await expect(page.locator("header .mrr-bell")).toHaveAttribute("data-state", "error", { timeout: 20_000 });
        await expectNoRegimePill(page);
        await checkError(page, def.slug);
        await settle(page, 300);
        await finishCell(cell, def, vp.width, "error");
      });
    }
  });

  test(`snapshot cells (seeded, API unreachable) on the eight tab routes at ${vp.width}`, async ({ browser }) => {
    test.skip(!fs.existsSync(SNAPSHOT_FILE), `no ${SNAPSHOT_FILE}: run scripts/build_snapshot.py first (the seed is gitignored)`);
    const seededLabel = seededRegimeLabel();
    for (const def of TAB_ROUTES) {
      await test.step(`${def.slug}--${vp.width}--snapshot`, async () => {
        const cell = await openCell(browser, vp, async (page) => {
          await stopApi(page);
        });
        const { page } = cell;
        await page.goto(def.route, { waitUntil: "domcontentloaded" });
        await page.locator("main").waitFor();
        // The word arrives once both shell queries have failed (G11): a 20 s poll.
        if (hasStrip(def.slug)) await expect(card(page)).toContainText("Validated snapshot", { timeout: 20_000 }); // FreshnessCard.tsx:68
        else await expect(strip(page)).toHaveCount(0); // Iteration 1 S4
        if (vp.width >= 860) await expect(page.locator(".mrr-side-foot")).toContainText("Validated snapshot", { timeout: 20_000 }); // shell-status.ts:165
        await expectNoRegimePill(page);
        // The drawer's first block carries SNAPSHOT_NOTE (FreshnessDrawer.tsx:111-113).
        await openFreshness(page, def.slug, vp.width);
        const drawer = page.locator("#freshness-drawer");
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText(SNAPSHOT_NOTE);
        await expect(drawer).toContainText("Validated snapshot");
        await page.keyboard.press("Escape");
        await expect(drawer).toBeHidden();
        // Below 860 the MobileNav list stays open behind the drawer (its focus return); close it.
        if (!hasStrip(def.slug) && vp.width < 860) await page.keyboard.press("Escape");
        await checkSnapshot(page, def.slug, seededLabel);
        await settle(page, 300);
        await finishCell(cell, def, vp.width, "snapshot", { seededLabel });
      });
    }
  });
}

/* ── loading: unseeded + delayApi on the eight tabs at 1672 ──────────────── */

test("loading cells (unseeded, API delayed) on the eight tab routes at 1672", async ({ browser }) => {
  for (const def of TAB_ROUTES) {
    await test.step(`${def.slug}--1672--loading`, async () => {
      const cell = await openCell(browser, DESK, async (page) => {
        await unseed(page);
        await delayApi(page, LOADING_DELAY_MS);
      });
      const { page } = cell;
      const t0 = Date.now();
      await page.goto(def.route, { waitUntil: "domcontentloaded" });
      // Before hydration #root is empty (F5): wait for main, then read inside the delay window.
      await page.locator("main").waitFor();
      const mounted = Date.now() - t0;
      if (hasStrip(def.slug)) await expect(card(page)).toContainText("Reading freshness…"); // FreshnessCard.tsx:87
      else await expect(strip(page)).toHaveCount(0); // Iteration 1 S4: no strip on Recession and Methodology
      await expect(page.locator("header .mrr-bell")).toHaveAttribute("aria-label", "Reading the alert feed. Open the alert feed."); // shell-status.ts:479
      await checkLoading(page, def.slug);
      // A beat for fonts so the capture shows the settled loading paint, still inside the delay.
      await page.waitForTimeout(800);
      const capturedAt = Date.now() - t0;
      expect(capturedAt, `${def.slug}: the loading checks finished inside the ${LOADING_DELAY_MS} ms delay`).toBeLessThan(LOADING_DELAY_MS + mounted);
      await finishCell(cell, def, 1672, "loading", { mountedMs: mounted, capturedMs: capturedAt, delayMs: LOADING_DELAY_MS });
    });
  }
});

/* ── empty: each endpoint's own empty shape at 1672 ──────────────────────── */

interface EmptyCell {
  key: string;
  def: RouteDef;
  route?: string;
  prepare: (page: Page) => Promise<void>;
  check: (page: Page) => Promise<void>;
}

const byTab = (slug: string): RouteDef => TAB_ROUTES.find((t) => t.slug === slug) as RouteDef;
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_CELLS: EmptyCell[] = [
  {
    key: "dashboard-signals",
    def: byTab("dashboard"),
    prepare: (page) => emptyEndpoint(page, "/api/signals/latest", (served: unknown) => ({ date: (served as { date?: string } | null)?.date ?? today(), signals: [] })),
    check: async (page) => {
      const articles = section(page, "signals").locator("article");
      await expect(articles).toHaveCount(5);
      for (let i = 0; i < 5; i++) {
        await expect(articles.nth(i)).toContainText(SIGNAL_EMPTY, { timeout: 20_000 }); // contract 3 (C #2)
        await expect(articles.nth(i)).toContainText(SIGNAL_PRINT_NONE);
        await expect(articles.nth(i).locator("[data-tone]").first()).toHaveText(/^Unavailable$/i);
      }
      await expect(section(page, "signals")).not.toContainText(SIGNAL_FEED_DOWN);
    },
  },
  {
    key: "dashboard-calendar",
    def: byTab("dashboard"),
    prepare: async (page) => {
      await emptyEndpoint(page, "/api/calendar", []);
      await emptyEndpoint(page, "/api/calendar/recent", []);
    },
    check: async (page) => {
      await expect(section(page, "macro-calendar")).toContainText(CALENDAR_EMPTY, { timeout: 20_000 }); // contract 4 (MacroCalendarCard.tsx:97)
      await expect(section(page, "macro-calendar")).toContainText("Hand-maintained schedule");
    },
  },
  {
    key: "dashboard-priced",
    def: byTab("dashboard"),
    route: "/app/dashboard#whats-priced",
    prepare: (page) => emptyEndpoint(page, "/api/priced", []),
    check: async (page) => {
      await expect(section(page, "whats-priced")).toContainText("No priced metrics on file; the weekly pipeline has not written them yet.", { timeout: 20_000 }); // MarketsGlance.tsx:169
    },
  },
  {
    key: "regime-lab-history",
    def: byTab("regime-lab"),
    prepare: (page) => emptyEndpoint(page, "/api/regime/history", []),
    check: async (page) => {
      await expect(section(page, "regime-history-teaser")).toContainText(NOTE_EMPTY, { timeout: 20_000 }); // OverviewTab.tsx:264
      await expect(section(page, "transitions")).toContainText(/No completed (?:Goldilocks|Overheating|Stagflation|Recession Risk) spells on file yet\./, { timeout: 20_000 }); // OverviewTab.tsx:225
      await expect(stripTitle(page, "regime-outlook")).toHaveText("Overheating odds unavailable"); // regimelab/hero-copy.ts:117 (fewer than 4 rows)
    },
  },
  {
    key: "markets-priced",
    def: byTab("markets"),
    prepare: (page) => emptyEndpoint(page, "/api/priced", []),
    check: async (page) => {
      await expect(section(page, "whats-priced-full")).toContainText("No priced metrics on file; the weekly pipeline has not written them yet.", { timeout: 20_000 }); // WhatsPriced.tsx:144
    },
  },
  {
    key: "markets-surprises",
    def: byTab("markets"),
    prepare: (page) => emptyEndpoint(page, "/api/surprises", []),
    check: async (page) => {
      await expect(section(page, "top-surprises")).toContainText("No surprise data on file for this week.", { timeout: 20_000 }); // TopSurprises.tsx:109
    },
  },
  {
    key: "markets-daily",
    def: byTab("markets"),
    prepare: (page) => emptyEndpoint(page, "/api/market/daily", []),
    check: async (page) => {
      await expect(section(page, "markets-hero")).toContainText("No sector closes on file yet.", { timeout: 20_000 }); // MarketsScreen.tsx:599
      const tiles = section(page, "sector-heatmap").locator("[style*='var(--r-tile)']");
      await expect(tiles).toHaveCount(4);
      for (let i = 0; i < 4; i++) await expect(tiles.nth(i)).toContainText("\u2014");
    },
  },
  {
    key: "news-feed",
    def: byTab("news"),
    prepare: async (page) => {
      await emptyEndpoint(page, "/api/news", []);
      await emptyEndpoint(page, "/api/news/latest", []);
    },
    check: async (page) => {
      await expect(section(page, "headlines")).toContainText(NEWS_EMPTY, { timeout: 20_000 }); // contract 5 (NewsScreen.tsx:487)
      await expect(section(page, "headlines").locator("h2").first()).toHaveText("Priority headlines"); // "Latest stored headlines" is impossible with nothing stored
    },
  },
  {
    key: "news-calendar",
    def: byTab("news"),
    prepare: async (page) => {
      await emptyEndpoint(page, "/api/calendar", []);
      await emptyEndpoint(page, "/api/calendar/recent", []);
    },
    check: async (page) => {
      await expect(section(page, "calendar")).toContainText(CALENDAR_EMPTY, { timeout: 20_000 }); // contract 4 (CalendarPanel.tsx:174)
      await expect(page.locator("main h1")).toHaveText("No events on file"); // NewsScreen.tsx:382, unchanged
      await expect(section(page, "news-hero").locator("svg[role='img']")).toContainText("No events on file."); // EventTimeline.tsx:132, unchanged
    },
  },
  {
    key: "credit-tight",
    def: byTab("credit"),
    prepare: (page) => rewriteEndpoint(page, "/api/credit/metrics", (served) => ({ ...((served ?? {}) as object), tight_count: 0 })),
    check: async (page) => {
      await expect(section(page, "credit-state-odds")).toContainText("The Tight state has never occurred since 1996; its row renders empty, not zero-risk.", { timeout: 20_000 }); // CreditStateOdds.tsx:118
    },
  },
  {
    key: "methodology-signals",
    def: byTab(METHODOLOGY_SLUG),
    prepare: (page) => emptyEndpoint(page, "/api/signals/latest", (served: unknown) => ({ date: (served as { date?: string } | null)?.date ?? today(), signals: [] })),
    check: async (page) => {
      // MethodologyScreen.tsx renders the header row and no rows for an empty
      // payload; no empty note exists in the code (checklist B.7 "[unverified copy]").
      await expect(section(page, "signals").locator("[role='columnheader']")).toHaveCount(4);
      await expect.poll(() => section(page, "signals").locator("[role='row']").count(), { timeout: 20_000 }).toBe(1);
      await expect(section(page, "signals")).not.toContainText(NOTE_ERROR);
      test.info().annotations.push({ type: "methodology-signals-empty", description: "an empty signals payload renders the header row alone; the table prints no empty note (no copy exists for it)" });
    },
  },
];

test("empty cells at 1672: each endpoint's own empty shape replaces the seeded value", async ({ browser }) => {
  for (const c of EMPTY_CELLS) {
    await test.step(`${c.key}--1672--empty`, async () => {
      const cell = await openCell(browser, DESK, c.prepare);
      const { page } = cell;
      await page.goto(c.route ?? c.def.route, { waitUntil: "domcontentloaded" });
      await page.locator("main").waitFor();
      await c.check(page);
      await settle(page, 300);
      await finishCell(cell, { ...c.def, slug: c.key }, 1672, "empty");
    });
  }
});

/* ── stale: four routes at 1672 ──────────────────────────────────────────── */

interface StaleCell {
  def: RouteDef;
  prepare: (page: Page) => Promise<void>;
  check: (page: Page) => Promise<void>;
}

/** A hero freshness chip by its noun (DeskRead.tsx FreshnessChip: title "{noun}: {word} · {stamp}"). */
const chip = (page: Page, heroId: string, noun: string): Locator => page.locator(`#${heroId} .mrr-hero-chips span[title^="${noun}:"]`);

const STALE_CELLS: StaleCell[] = [
  {
    def: byTab("dashboard"),
    prepare: (page) => staleFeeds(page),
    check: async (page) => {
      // The Macro chip reads the re-dated regime row; the summary values are kept, not blanked (G17).
      await expect(chip(page, "regime-hero", "Macro")).toHaveAttribute("title", "Macro: Stale · Mar 2026", { timeout: 20_000 });
      await expect(chip(page, "regime-hero", "Signals")).toHaveAttribute("title", "Signals: Stale · Mar 2026");
      await expect(chip(page, "regime-hero", "Market")).toHaveAttribute("title", "Market: Stale · Aug 20, 2026");
      await expect(page.locator("main h1")).toHaveText(new RegExp(`^(?:${REGIMES.join("|")})$`));
      await expect(section(page, "regime-summary").locator("dt")).toHaveCount(11, { timeout: 30_000 });
      await expect(section(page, "regime-summary")).not.toContainText(NOTE_ERROR);
      await expect(card(page)).toContainText("Macro monthly · latest Mar 2026"); // FreshnessCard.tsx:81
    },
  },
  {
    def: byTab("markets"),
    prepare: (page) => staleFeeds(page, { market: true }),
    check: async (page) => {
      // MarketsScreen.tsx:363: the Stored candles chip reads the newest served bar, cut at Aug 20 2026.
      await expect(chip(page, "markets-hero", "Stored candles")).toHaveAttribute("title", "Stored candles: Stale · Aug 20, 2026", { timeout: 20_000 });
      await expect(section(page, "markets-hero")).not.toContainText("Stored closes unavailable");
    },
  },
  {
    def: byTab("news"),
    prepare: (page) => staleFeeds(page, { news: true }),
    check: async (page) => {
      // news-copy.ts mergeFeedVerdict: the served sla verdict wins (G13); on a
      // window empty on the local DB the strip reads Fallback coverage instead.
      await expect(stripTitle(page, "news-summary")).toHaveText(/^(?:Feed stale|Fallback coverage)$/, { timeout: 20_000 });
      await expect(chip(page, "news-hero", "Newest headline")).toHaveAttribute("title", /^Newest headline: Stale/);
    },
  },
  {
    def: byTab("credit"),
    prepare: (page) => staleFeeds(page, { credit: true }),
    check: async (page) => {
      // CreditScreen.tsx:182-183: the chip reads the last hy_series date, cut at Mar 2026 (06 B.2).
      await expect(chip(page, "credit-hero", "ICE BofA via FRED")).toHaveAttribute("title", "ICE BofA via FRED: Stale · Mar 2026", { timeout: 20_000 });
      await expect(page.locator("main h1")).toHaveText(/^(?:Normal|Tight|Stressed|Crisis)$/);
      await expect(section(page, "credit-summary")).not.toContainText(NOTE_ERROR);
    },
  },
];

test("stale cells at 1672: re-dated feeds read Stale on the chips, the card and the strip; values are kept", async ({ browser }) => {
  for (const c of STALE_CELLS) {
    await test.step(`${c.def.slug}--1672--stale`, async () => {
      const cell = await openCell(browser, DESK, c.prepare);
      const { page } = cell;
      await page.goto(c.def.route, { waitUntil: "domcontentloaded" });
      await page.locator("main").waitFor();
      await c.check(page);
      // The freshness card's macro line and the drawer rows follow the served verdicts (B.7 row 1).
      await expect(card(page)).toContainText("Macro monthly · latest Mar 2026");
      await strip(page).getByRole("button", { name: /^Freshness/ }).click();
      const drawer = page.locator("#freshness-drawer");
      await expect(drawer).toBeVisible();
      await expect(drawer.locator("table")).toContainText("stale");
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await settle(page, 300);
      await finishCell(cell, c.def, 1672, "stale");
    });
  }
});
