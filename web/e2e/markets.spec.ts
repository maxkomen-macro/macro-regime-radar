/**
 * Phase 5 checklist (docs/redesign-v2/checklists/05-markets.md) section E.3:
 * the P5 browser check on /app/markets, steps 1 to 13, 17 and 18, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks and keys
 * only; the assistant panel is never opened, typed into or sent from.
 * Captures land in docs/redesign-v2/captures/redesign-05-markets/
 * (CAPTURE_DIR overrides). Steps 14 to 16 are the existing parity and
 * regression specs, run separately. Where an assertion depends on what the
 * relay or the provider serves on verify day (the Dollar / VIX rows, the
 * Options lens entitlement, the news window, the 5D interval), both outcomes
 * are accepted and the one observed is recorded as a test annotation.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-05-markets");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/markets";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Summary row labels in C.2 order; Dollar and VIX render only with a UUP quote or bar and a VIX quote.
 * Iteration 1 (the summary's G2 fill): Single names · 1d renders once two single names carry a day
 * change, ETFs · 1w once two stored ETFs carry a one-week return. */
// Iteration 1 step 6 (A2): the summary's VIX row is the relay's delayed poll,
// labelled "VIX · delayed" (the Dashboard's "VIX" is the stored FRED close).
const SUMMARY_LABELS = ["US 10Y", "Sectors · 1d", "Single names · 1d", "ETFs · 1w", "Dollar", "VIX · delayed", "Priced", "Top surprise"];
const OPTIONAL_LABELS = new Set(["Single names · 1d", "ETFs · 1w", "Dollar", "VIX · delayed"]);
/** The tape headers (C.2) at desk width and the phone set (B.7). */
const TAPE_HEADERS = ["Symbol · name", "Last", "Day %", "Day Δ$", "1W %", "1M %", "30 Sess", "As of"];
const TAPE_HEADERS_NARROW = ["Symbol · name", "Last", "Day %", "1M %", "As of"];
const GROUP_LABELS = ["Equities", "Rates", "Credit", "Dollar & FX", "Metals", "Energy & Industrial", "Crypto", "Volatility"];
/** 5+2+2+3+2+2+2+1 rows in tape.ts TAPE_GROUPS (the checklist's "18" is a miscount). */
const MACRO_ROWS = 19;
const SECTOR_SYMBOLS = ["XLF", "XLE", "XLI", "XLK"];
const FUNDAMENTALS = ["Market cap", "P/E · TTM", "Fwd P/E", "Beta", "Div yield", "52W range", "Avg vol · 3M", "Net margin"];
const REGIMES = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"];
/** Strip title (B.2) → the freshness card's first line (FreshnessCard.tsx). Iteration 1 step 6
 * (A3): the card prints the server's §5 word for the market series, whatever the relay's
 * connection word, so every title pairs with "Markets · <§5 word>" or the shell's
 * service-down and snapshot words. */
const MARKET_WORD = /^(?:Markets · (?:Live|Delayed \d+ min|Close · [A-Z][a-z]{2} \d{2}|[A-Z][a-z]{2} \d{2} · \d+ sessions? behind|As of unknown|Snapshot · as of \S+|reading…)|Data service unavailable|Validated snapshot)/;
const CARD_LINE: Record<string, RegExp> = {
  "Stream connected": MARKET_WORD,
  "Quotes delayed": MARKET_WORD,
  "Live feeds off": MARKET_WORD,
  "Stream reconnecting": MARKET_WORD,
  "Stream unavailable": MARKET_WORD,
};
const UNAVAILABLE_OPTIONS = "Options data is not included in the EODHD plan configured on this server";

interface DailyBar {
  symbol: string;
  date: string;
  ret_1w: number | null;
}
interface PricedMetric {
  group: string;
  metric: string;
}

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const hero = (page: Page) => page.locator("#markets-hero");
const summary = (page: Page) => page.locator("#markets-summary");
const research = (page: Page) => page.locator("#single-name-research");
const tape = (page: Page) => page.locator("#watchlist");
/** The macro tape's own table: since Iteration 1 (M3b) the single names table sits in the same panel, under it. */
const macroTable = (page: Page) => page.locator("#watchlist table").first();
const freshnessCard = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });
const heatTiles = (page: Page) => page.locator("#sector-heatmap [style*='var(--r-tile)']");
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/** True when the element's top edge sits inside the viewport. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}

/** innerText of a locator (hidden panels and closed disclosures excluded, CSS text-transform applied), whitespace collapsed. */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}
/** textContent of a locator (no text-transform), whitespace collapsed. */
async function contentText(loc: Locator): Promise<string> {
  return clean((await loc.textContent()) ?? "");
}
const lower = (xs: string[]) => xs.map((s) => clean(s).toLowerCase());

/** The tape row whose ticker button reads `symbol`, and that button. */
function tapeRow(page: Page, symbol: string): { row: Locator; button: Locator } {
  const button = tape(page).locator("button.mrr-tape-btn").filter({ hasText: new RegExp(`^${symbol}$`) });
  return { row: button.locator("xpath=ancestor::tr[1]"), button };
}
/** Index of a header label among the tape's th, by textContent. */
async function tapeHeaderIndex(page: Page, label: string): Promise<number> {
  const ths = await macroTable(page).locator("thead th").allTextContents();
  return ths.map(clean).indexOf(label);
}
/** The one-day value line of a sector tile: "+0.42%" / "-1.20%" / the dash. */
function tileValue(innerText: string): string | null {
  for (const line of innerText.split("\n").map((l) => l.trim())) {
    if (/^[+-]\d+\.\d\d%$/.test(line) || line === "\u2014") return line;
  }
  return null;
}
/** Wait for the single-name tile: its close button exists once the profile panel mounts. */
async function awaitTile(page: Page, symbol: string): Promise<void> {
  await expect(research(page).getByRole("button", { name: "Close single-name panel" })).toHaveCount(1, { timeout: 30_000 });
  await expect(research(page).getByText(symbol, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
}

async function capture(page: Page, file: string, target?: Locator): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage: true });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("markets (checklist 05 E.3)", () => {
  test("1. branch and stamp: the dev build stamp names the checked-out branch and commit; one uvicorn, one Vite, the API answering", async ({ page }) => {
    await open(page);
    const stamp = await page.locator('meta[name="mrr-build"]').getAttribute("content");
    expect(stamp).toBe(`${git("rev-parse --abbrev-ref HEAD")}@${git("rev-parse --short=7 HEAD")}`);
    expect(stamp?.startsWith(`${BRANCH}@`), `stamp ${stamp} is not on ${BRANCH}: restart Vite after the branch cut`).toBe(true);
    // A second local uvicorn is the known "422 Symbols limit reached" problem (CC_PROMPT); tolerate a remote host (0).
    // Count the server processes only: lines whose command starts with a Python
    // binary. The desktop app's launcher wrapper (".../disclaimer -- .venv/bin/uvicorn …")
    // and any shell that merely mentions the command line carry the same text.
    const uvicorns = execSync("pgrep -fl 'uvicorn api.main:app' || true", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter((l) => /^\d+ \S*python\S* \S*uvicorn api\.main:app/.test(l));
    expect(uvicorns.length, `expected at most one uvicorn:\n${uvicorns.join("\n")}`).toBeLessThanOrEqual(1);
    // One Vite dev server on :5173 (strictPort refuses a second anyway); tolerate a remote baseURL (0 listeners).
    const vitePids = new Set(
      execSync("lsof -nP -iTCP:5173 -sTCP:LISTEN -Fp 2>/dev/null || true", { encoding: "utf8" })
        .split("\n")
        .filter((l) => /^p\d+$/.test(l)),
    );
    expect(vitePids.size, `expected at most one process listening on :5173, saw ${[...vitePids].join(", ")}`).toBeLessThanOrEqual(1);
    for (const url of ["/api/market/daily?symbols=SPY,QQQ&days=5", "/api/priced", "/api/surprises?top_n=10", "/api/credit/oas?days=90", "/api/freshness"]) {
      expect((await page.request.get(url)).status(), url).toBe(200);
    }
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses on the route", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    // Let the summary rows and the surprise ranking finish.
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await expect(page.locator("#top-surprises")).toBeVisible({ timeout: 30_000 });
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.markets?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero: one serif h1 in {Risk-on, Mixed, Risk-off}, the sectors pill counting the green tiles, the session sentence h2, the week bars and the SPY label equal to the tape's 1W cell", async ({ page }) => {
    await open(page);
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(/^(?:Risk-on|Mixed|Risk-off)$/, { timeout: 30_000 });
    expect(await page.locator("h1").count()).toBe(1);
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Source Serif 4"?/);
    await expect(hero(page)).toContainText("Market read", { ignoreCase: true });

    const pill = hero(page).locator(".mrr-pill");
    await expect(pill).toHaveCount(1);
    const pillText = await contentText(pill);
    expect(pillText).toMatch(/^\d of \d sectors up$/);
    await expect(heatTiles(page)).toHaveCount(4);
    const tileTexts = await heatTiles(page).allInnerTexts();
    const green = tileTexts.map(tileValue).filter((v) => v != null && v.startsWith("+")).length;
    expect(Number(pillText.split(" ")[0]), `pill ${pillText} vs green tiles ${tileTexts.map(tileValue).join(", ")}`).toBe(green);

    const h2 = hero(page).locator("h2").first();
    expect(await visibleText(h2)).toMatch(/^(?:US session|Stream unavailable)/);
    await expect(hero(page)).toContainText("Headline and pill read the one-day moves of the four stored sector ETFs");

    const chart = hero(page).locator("svg[role='img']");
    await expect(chart).toHaveCount(1, { timeout: 30_000 });
    await expect(chart).toHaveAttribute("aria-label", "One-week return by asset");
    expect(await chart.locator("rect").count()).toBeGreaterThanOrEqual(10);
    expect(await page.locator("main img").count()).toBe(0);

    // The SPY bar label equals the tape's SPY 1W cell: the symbol text, then its name, then the value.
    const texts = (await chart.locator("text").allTextContents()).map(clean);
    const spyAt = texts.findIndex((t) => t === "SPY" || t.startsWith("SPY "));
    expect(spyAt, `SPY row in the week bars: ${texts.join(" | ")}`).toBeGreaterThanOrEqual(0);
    const spyLabel = texts.slice(spyAt + 1).find((t) => /^[+-]\d+\.\d%$/.test(t));
    expect(spyLabel, "SPY bar value").toBeDefined();
    const w1 = await tapeHeaderIndex(page, "1W %");
    expect(w1).toBeGreaterThan(0);
    const spyCell = await contentText(tapeRow(page, "SPY").row.locator("td").nth(w1));
    expect(spyCell).toBe(spyLabel);
  });

  test("4. buttons: Open a chart mounts the focused SPY chart panel and Esc unmounts it; See what's priced brings #whats-priced-full into view", async ({ page }) => {
    await open(page);
    await expect(page.locator("main h1")).toHaveText(/^(?:Risk-on|Mixed|Risk-off)$/, { timeout: 30_000 });
    await hero(page).getByRole("button", { name: /Open a chart/ }).click();
    const panel = page.locator("#markets-chart-panel[aria-label='SPY chart panel']");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => page.evaluate(() => document.getElementById("markets-chart-panel")?.contains(document.activeElement) ?? false), { timeout: 10_000 }).toBe(true);
    await expect(tapeRow(page, "SPY").button).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#markets-chart-panel")).toHaveCount(0);
    await expect(tapeRow(page, "SPY").button).toHaveAttribute("aria-expanded", "false");

    await hero(page).getByRole("link", { name: /See what's priced/ }).click();
    await expect(page).toHaveURL(/\/app\/markets#whats-priced-full$/);
    await expect.poll(() => inView(page, "whats-priced-full"), { timeout: 15_000 }).toBe(true);
  });

  test("5. summary: the dt labels in C.2 order (Dollar and VIX recorded), the dialog strip opens the freshness drawer, Esc returns focus, and its title agrees with the freshness card", async ({ page }) => {
    await open(page);
    const dts = summary(page).locator("dt");
    await expect.poll(() => dts.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await settle(page, 600);
    const labels = (await dts.allTextContents()).map(clean);
    const expected = SUMMARY_LABELS.filter((l) => !OPTIONAL_LABELS.has(l) || labels.includes(l));
    expect(labels).toEqual(expected);
    note("summary-rows", labels.join(" · "));
    note("dollar-row", labels.includes("Dollar") ? "rendered" : "absent (no UUP quote and no stored UUP bar)");
    note("vix-row", labels.includes("VIX · delayed") ? "rendered" : "absent (no VIX quote)");
    if (labels.includes("VIX · delayed")) await expect(summary(page)).toContainText("delayed");
    for (const dd of await summary(page).locator("dd").all()) expect(clean(await dd.innerText())).not.toBe("");

    const strip = summary(page).locator('button[aria-haspopup="dialog"]');
    await expect(strip).toHaveCount(1);
    const title = await contentText(strip.locator(".mrr-status-title"));
    expect(Object.keys(CARD_LINE), `strip title ${title}`).toContain(title);
    expect(await strip.getAttribute("aria-label")).toMatch(/\. Open the data freshness breakdown\.$/);
    expect(await strip.getAttribute("aria-label")).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. `));
    const cardLine = await visibleText(freshnessCard(page).locator(".mrr-upd-lines small").first());
    expect(cardLine, `card "${cardLine}" vs strip "${title}"`).toMatch(CARD_LINE[title]);
    note("strip-title", `${title} ⇔ ${cardLine}`);

    await strip.click();
    const drawer = page.getByRole("dialog", { name: "Data freshness" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("id", "freshness-drawer");
    await expect(drawer).toHaveAttribute("aria-labelledby", "freshness-drawer-title");
    expect(await page.locator("#shell-content").getAttribute("inert")).not.toBeNull();
    await capture(page, "markets--freshness-drawer.png", page.locator("body"));
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(await page.locator("#shell-content").getAttribute("inert")).toBeNull();
    await expect(strip).toBeFocused();
  });

  test("6. single-name search: NVDA by real click shows the tile, eight fundamentals, four regime tiles under the monthly label, a provider status line and the news disclosure, without a reload", async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      (window as unknown as { __mrrE2E?: number }).__mrrE2E = 1;
    });
    // Iteration 1 (M3c): the one symbol search rides in the hero's action row and drives the same panel.
    const box = hero(page).locator('[role="combobox"][aria-label="Search any listed symbol"]');
    await expect(box).toBeVisible();
    await box.click();
    await box.pressSequentially("NVDA", { delay: 40 });
    const option = page.locator("[role='listbox'] [role='option']").filter({ hasText: /\bNVDA\b/ }).first();
    await expect(option).toBeVisible({ timeout: 20_000 });
    await option.click();
    await awaitTile(page, "NVDA");
    // Iteration 1 (M5): the pick writes ?name=NVDA (a replace, no reload: the marker below survives).
    expect(page.url()).toMatch(/\/app\/markets\?name=NVDA$/);
    expect(await page.evaluate(() => (window as unknown as { __mrrE2E?: number }).__mrrE2E)).toBe(1);

    const panel = research(page);
    for (const label of FUNDAMENTALS) await expect(panel, label).toContainText(label, { ignoreCase: true, timeout: 30_000 });
    await expect(panel).toContainText("Average monthly return by regime", { ignoreCase: true, timeout: 45_000 });
    for (const r of REGIMES) await expect(panel, r).toContainText(r, { ignoreCase: true, timeout: 45_000 });
    await expect(panel).toContainText(/% up · n=\d+|no overlap/, { timeout: 45_000 });
    await expect(panel.locator("[role='status']").filter({ hasText: /EODHD|yfinance/ }).first()).toBeVisible({ timeout: 30_000 });
    await expect(panel).toContainText(/Fundamentals via (?:EODHD|yfinance)|Fundamentals unavailable/, { timeout: 30_000 });
    expect(await panel.locator("[role='group'][aria-label='Chart range']").count()).toBeLessThanOrEqual(1);
    await capture(page, "markets--nvda.png");

    const news = panel.getByRole("button", { name: /News for NVDA/ });
    await expect(news).toHaveAttribute("aria-expanded", "false");
    await expect(panel.getByRole("button", { name: /Options lens/ })).toHaveAttribute("aria-expanded", "false");
    await expect.poll(() => contentText(news), { timeout: 30_000 }).toMatch(/\d+ stored · 7-day window|none in 7 days/);
    await news.click();
    await expect(news).toHaveAttribute("aria-expanded", "true");
    const rows = page.locator("#single-name-news a[target='_blank'][rel~='noreferrer']");
    await expect
      .poll(async () => ((await rows.count()) > 0 ? "rows" : /No stored coverage mentions NVDA/.test(await visibleText(panel)) ? "empty" : "pending"), { timeout: 30_000 })
      .not.toBe("pending");
    const outcome = (await rows.count()) > 0 ? `${await rows.count()} stored rows` : "no stored coverage in the window";
    note("news-for-nvda", outcome);
    expect(page.url()).toMatch(/\/app\/markets\?name=NVDA$/);
    await capture(page, "markets--nvda-news.png");
  });

  test("7. options lens: opens to a chain with a Strike column and the expiration select, or the explicit unavailable sentence (recorded)", async ({ page }) => {
    await open(page, `${ROUTE}?name=NVDA`);
    await awaitTile(page, "NVDA");
    const panel = research(page);
    const lensButton = panel.getByRole("button", { name: /Options lens/ });
    await expect(lensButton).toHaveAttribute("aria-expanded", "false");
    await lensButton.click();
    await expect(lensButton).toHaveAttribute("aria-expanded", "true");
    const lens = page.locator("#options-lens");
    const table = lens.locator("table");
    await expect
      .poll(async () => ((await table.count()) > 0 ? "table" : (await visibleText(lens)).includes(UNAVAILABLE_OPTIONS) ? "unavailable" : "pending"), { timeout: 45_000 })
      .not.toBe("pending");
    const outcome = (await table.count()) > 0 ? "table" : "unavailable";
    note("options-lens", outcome === "table" ? "chain served" : "not in the EODHD plan on this server");
    if (outcome === "table") {
      expect(lower(await table.locator("th").allTextContents())).toContain("strike");
      await expect(lens.locator("select[aria-label='Expiration']")).toHaveCount(1);
      await lens.getByRole("button", { name: "Puts" }).click();
      await expect(lens).toContainText("page 1", { timeout: 30_000 });
    } else {
      await expect(lens).toContainText(UNAVAILABLE_OPTIONS);
    }
    await capture(page, "markets--nvda-options.png");
  });

  test("8. ranges: 1Y requests range=1Y, presses the option and captions 1Y; 5D captions 5D and hides the 20-day legend on an intraday payload", async ({ page }) => {
    await open(page, `${ROUTE}?name=NVDA`);
    await awaitTile(page, "NVDA");
    const panel = research(page);
    await expect(panel.getByText(/^6M · /)).toBeVisible({ timeout: 30_000 });
    const group = page.locator("[role='group'][aria-label='Chart range']");
    await expect(group).toHaveCount(1);
    const oneY = group.getByRole("button", { name: "1Y", exact: true });
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => {
          const u = new URL(r.url());
          return /\/api\/market\/candles\/NVDA$/.test(u.pathname) && u.searchParams.get("range") === "1Y";
        },
        { timeout: 30_000 },
      ),
      oneY.click(),
    ]);
    note("candles-1y", `status ${response.status()}`);
    await expect(oneY).toHaveAttribute("aria-pressed", "true");
    expect(await group.locator("button[aria-pressed='true']").count()).toBe(1);
    await expect(panel.getByText(/^1Y · /)).toBeVisible({ timeout: 30_000 });
    const oneYCaption = await visibleText(panel.getByText(/^1Y · /));
    if (/daily bars/.test(oneYCaption)) await expect(panel.getByText(/20-day average/)).toBeVisible();
    await capture(page, "markets--nvda-1y.png");

    const fiveD = group.getByRole("button", { name: "5D", exact: true });
    await fiveD.click();
    await expect(fiveD).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByText(/^5D · /)).toBeVisible({ timeout: 30_000 });
    const caption = await visibleText(panel.getByText(/^5D · /));
    const intraday = /(?:minute|hourly) bars/.test(caption);
    note("candles-5d", intraday ? `intraday payload: ${caption.split(" · ").slice(0, 2).join(" · ")}` : `daily payload: ${caption.split(" · ").slice(0, 2).join(" · ")}`);
    if (intraday) await expect(panel.getByText(/20-day average/)).toHaveCount(0);
    else await expect(panel.getByText(/20-day average/)).toBeVisible();
  });

  test("9. tape: the C.2 headers, eight groups, a QQQ row click opens the focused panel and Esc returns focus, the single names under the tape, the hash route, the scrolling well with the pinned symbol column", async ({ page }) => {
    await open(page);
    await test.step("headers, groups and the well", async () => {
      await expect(macroTable(page).locator("thead th")).toHaveCount(TAPE_HEADERS.length);
      expect(lower(await macroTable(page).locator("thead th").allTextContents())).toEqual(lower(TAPE_HEADERS));
      await expect(tape(page).locator("tr.mrr-grp")).toHaveCount(8);
      expect((await tape(page).locator("tr.mrr-grp").allTextContents()).map(clean)).toEqual(GROUP_LABELS);
      await expect(macroTable(page).locator("tbody tr:not(.mrr-grp)")).toHaveCount(MACRO_ROWS);
      // Every row's last cell is an as-of stamp or the dash.
      for (const row of await macroTable(page).locator("tbody tr:not(.mrr-grp)").all()) {
        const last = clean(await row.locator("td").last().innerText());
        expect(last).toMatch(/(?:\d\d:\d\d(?::\d\d)? ET|close|15m delayed|^\u2014$)/);
      }
      await expect(tape(page).locator(".mrr-scroll[data-scrollable='true']").first()).toBeVisible();
      await expect(macroTable(page).locator("xpath=ancestor::*[contains(@class,'mrr-scroll')][1]")).toHaveAttribute("data-scrollable", "true");
      const first = tapeRow(page, "QQQ").row.locator("td").first();
      expect(await first.evaluate((el) => getComputedStyle(el).position)).toBe("sticky");
    });

    await test.step("row click, focus and Esc", async () => {
      const { row, button } = tapeRow(page, "QQQ");
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await row.locator("td").nth(1).click();
      const panel = page.locator("#markets-chart-panel[aria-label='QQQ chart panel']");
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""), { timeout: 10_000 }).toBe("markets-chart-panel");
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await settle(page, 600);
      await capture(page, "markets--chart-panel.png");
      await page.keyboard.press("Escape");
      await expect(page.locator("#markets-chart-panel")).toHaveCount(0);
      await expect(button).toHaveAttribute("aria-expanded", "false");
      await expect(button).toBeFocused();
    });

    // Iteration 1 (M3b): the single names render under the macro tape, no view toggle hides either list.
    await test.step("Single names under the tape, no toggle", async () => {
      await expect(tape(page).getByRole("group", { name: "Tape view" })).toHaveCount(0);
      await expect(page.locator("#single-names")).toHaveCount(1);
      await expect(page.locator("#single-names tbody tr:not(.mrr-grp)")).toHaveCount(12);
      await expect(tape(page).locator("tr.mrr-grp")).toHaveCount(8);
      expect(await contentText(page.locator("#single-names"))).toMatch(/sorted by day move · re-sorts (?:live|as data updates)/);
      await page.locator("#single-names").scrollIntoViewIfNeeded();
      await capture(page, "markets--single-names.png");
    });

    await test.step("the #single-names hash route", async () => {
      await page.goto(`${ROUTE}#single-names`, { waitUntil: "domcontentloaded" });
      await settle(page, 900);
      await expect(page.locator("#single-names")).toHaveCount(1);
      await expect.poll(() => inView(page, "single-names"), { timeout: 15_000 }).toBe(true);
    });
  });

  test("10. heatmap: four tiles with signed two-decimal values or the dash, and the 1W note wherever ret_1w is served", async ({ page }) => {
    await open(page);
    await expect(heatTiles(page)).toHaveCount(4);
    const bars = (await (await page.request.get("/api/market/daily?symbols=XLF,XLE,XLI,XLK&days=60")).json()) as DailyBar[];
    const texts = await heatTiles(page).allInnerTexts();
    SECTOR_SYMBOLS.forEach((symbol, i) => {
      const t = texts[i];
      expect(t, symbol).toMatch(new RegExp(`^${symbol}\\b`));
      expect(tileValue(t), `${symbol} value in "${clean(t)}"`).not.toBeNull();
      const newest = bars.filter((b) => b.symbol === symbol).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      if (newest?.ret_1w != null) expect(t, `${symbol} 1W note`).toMatch(/1W [+-]\d+\.\d%/);
    });
    await expect(page.locator("#sector-heatmap")).toContainText("tint steps at ±1% and ±2%");
  });

  test("11. surprises: as many rows as the API serves (ten), a σ cell per row, Calendar → lands on News #calendar", async ({ page }) => {
    await open(page);
    const served = (await (await page.request.get("/api/surprises?top_n=10")).json()) as unknown[];
    const rows = page.locator("#top-surprises tbody tr");
    if (served.length) {
      await expect(rows).toHaveCount(served.length, { timeout: 30_000 });
      expect(served.length).toBe(10);
      for (const row of await rows.all()) expect(clean(await row.innerText())).toMatch(/[+-]\d\.\d\u03c3/);
    } else {
      await expect(page.locator("#top-surprises")).toContainText(/No surprise data on file|Surprise feed unavailable/);
    }
    await page.locator("#top-surprises").getByRole("link", { name: /Calendar/ }).click();
    await expect(page).toHaveURL(/\/app\/news#calendar$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "calendar"), { timeout: 15_000 }).toBe(true);
  });

  test("12. priced: three tiles, six row headers, Level and MoM only, two-decimal levels, Methodology → lands on #data", async ({ page }) => {
    await open(page);
    const served = (await (await page.request.get("/api/priced")).json()) as PricedMetric[];
    const section = page.locator("#whats-priced-full");
    await expect(section.locator("th[scope='row']")).toHaveCount(served.length, { timeout: 30_000 });
    expect(served.length).toBe(6);
    await expect(section.locator("[style*='var(--r-tile)']")).toHaveCount(new Set(served.map((p) => p.group)).size);
    expect(new Set(served.map((p) => p.group)).size).toBe(3);
    const colHeaders = lower(await section.locator("th[scope='col']").allTextContents());
    for (const h of colHeaders) expect(["metric", "level", "mom"], `column header ${h}`).toContain(h);
    expect(colHeaders).toContain("level");
    expect(colHeaders).toContain("mom");
    for (const h of lower(await section.locator("th").allTextContents())) expect(h).not.toMatch(/^1w\b|1y range/);
    expect(lower(await section.locator("th[scope='row']").allTextContents())).toEqual(expect.arrayContaining(["fed funds", "sofr"]));
    for (const level of await section.locator("tbody td:nth-child(2)").allInnerTexts()) expect(clean(level)).toMatch(/^-?\d+\.\d\d%$/);
    await section.getByRole("link", { name: /Methodology/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#data$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "data"), { timeout: 15_000 }).toBe(true);
  });

  test("13. footer: the DisclosureLine is the last element in main", async ({ page }) => {
    await open(page);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    const lastIsLine = await page.evaluate(() => {
      const main = document.querySelector("main");
      const line = main?.querySelector("p.mrr-disclosure-line");
      if (!main || !line) return false;
      const all = main.querySelectorAll("*");
      return all[all.length - 1] === line;
    });
    expect(lastIsLine).toBe(true);
    await expect(page.locator("main p.mrr-disclosure-line")).toContainText("macro metrics via FRED.");
  });

  test("17. at 390 px the hero stacks over the summary, the body grid is one column, the phone column set shows five headers and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    const boxes = await page.evaluate(() => {
      const box = (id: string) => document.getElementById(id)?.getBoundingClientRect() ?? null;
      return { hero: box("markets-hero"), summary: box("markets-summary"), research: box("single-name-research"), surprises: box("top-surprises"), tape: box("watchlist") };
    });
    for (const [k, v] of Object.entries(boxes)) expect(v, k).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    // One column: the tape follows the stack instead of sitting beside it.
    expect(Math.abs((boxes.tape as DOMRect).left - (boxes.research as DOMRect).left)).toBeLessThan(2);
    expect((boxes.tape as DOMRect).top).toBeGreaterThanOrEqual((boxes.surprises as DOMRect).bottom - 1);
    await expect(macroTable(page).locator("thead th")).toHaveCount(TAPE_HEADERS_NARROW.length);
    expect(lower(await macroTable(page).locator("thead th").allTextContents())).toEqual(lower(TAPE_HEADERS_NARROW));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "markets--390.png");
  });

  test("18. captures: the full page at 1672 for the region-by-region compare with markets.png", async ({ page }) => {
    await open(page);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
    await expect(hero(page).locator("svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#whats-priced-full th[scope='row']").first()).toBeVisible({ timeout: 30_000 });
    await settle(page, 1200);
    await capture(page, "markets.png");
    expect(fs.existsSync(path.join(DOCS, "markets.png")), "the approved mockup the verifier compares against").toBe(true);
  });
});
