/**
 * Phase 3 checklist (docs/redesign-v2/checklists/03-dashboard.md) section E.3:
 * the P3 browser check on /app/dashboard, steps 1 to 13, 16 and 17, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks only; the
 * assistant panel is never opened, typed into or sent from. Captures land in
 * docs/redesign-v2/captures/redesign-03-dashboard/ (CAPTURE_DIR overrides).
 * Steps 14 and 15 are the existing parity and shell specs, run separately.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { TABS } from "../src/screens/shell/sections";
import { SIGNALS_META } from "../src/screens/dashboard/signals-meta";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-03-dashboard");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const BRANCH = "redesign/03-dashboard";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Summary row labels in C.2 order; row 9 reads Watch, or Triggered when a signal is triggered on verify day. */
const SUMMARY_LABELS = ["Model regime", "Model probability", "Odds", "Model confidence", "Model vs market", "Next 3 months", "Key takeaway", "What changed", ["Watch", "Triggered"], "Invalidates", "NBER recession model"];
const KEY_LABELS = ["Fed funds", "Growth trend", "Inflation trend", "10Y Treasury", "VIX", "Yield curve 2s10s", "Recession model · 12m"];
/** The B.5 table: option label, capture suffix and the tile symbols per tab. */
const GLANCE_TABS = [
  { label: "Equities", file: "equities", symbols: ["SPY", "QQQ", "IWM", "EEM"] },
  { label: "Rates & credit", file: "rates", symbols: ["TLT", "IEF", "HYG", "LQD"] },
  { label: "FX", file: "fx", symbols: ["UUP", "EURUSD", "USDJPY"] },
  { label: "Commodities", file: "commodities", symbols: ["GLD", "SLV", "USO", "CPER"] },
  { label: "Crypto", file: "crypto", symbols: ["BTC-USD", "ETH-USD"] },
  { label: /^What.s priced$/i, file: "priced", symbols: [] as string[] },
];
const ALL_GLANCE_SYMBOLS = GLANCE_TABS.flatMap((t) => t.symbols);

async function open(page: Page, route = "/app/dashboard"): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const header = (page: Page) => page.locator("header").first();
const strip = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });
const glanceGroup = (page: Page) => page.locator("#markets-glance").getByRole("group", { name: "Asset class" });
const glanceOption = (page: Page, label: string | RegExp) => glanceGroup(page).getByRole("button", { name: label });

/** True when the element's top edge sits inside the viewport. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}

/** innerText of a locator (hidden panels and closed accordions excluded), whitespace collapsed. */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}

/** Symbols visible inside the glance panel right now (word-bounded, hidden panels excluded). */
async function visibleGlanceSymbols(page: Page): Promise<string[]> {
  const t = await visibleText(page.locator("#markets-glance"));
  return ALL_GLANCE_SYMBOLS.filter((s) => new RegExp(`(^|[^A-Z0-9-])${s.replace("-", "\\-")}(?![A-Z0-9-])`).test(t));
}

async function capture(page: Page, file: string, target?: Locator): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage: true });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("dashboard (checklist 03 E.3)", () => {
  test("1. branch and stamp: the dev build stamp names redesign/03-dashboard at the checked-out commit; one uvicorn, the API answering", async ({ page }) => {
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
    expect((await page.request.get("/api/freshness")).status()).toBe(200);
    expect((await page.request.get("/api/regime/latest")).status()).toBe(200);
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    // Let the cold recession call and the glance tiles finish.
    await expect(page.locator("#regime-summary dt")).toHaveCount(11, { timeout: 30_000 });
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.dashboard?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero: one serif h1 equal to the served label, the probability pill, the four-way subhead, no NBER figure in the hero, a separate model in the summary", async ({ page }) => {
    await open(page);
    const regime = (await (await page.request.get("/api/regime/latest")).json()) as { label: string };
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(regime.label);
    expect(await page.locator("h1").count()).toBe(1);
    const computed = await h1.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { family: cs.fontFamily, variation: cs.fontVariationSettings };
    });
    expect(computed.family).toMatch(/^"?Source Serif 4"?/);
    expect(computed.variation).toContain('"opsz" 30');
    const pill = page.locator("#regime-hero .mrr-pill");
    await expect(pill).toHaveCount(1);
    expect(await visibleText(pill)).toMatch(/^\d+% probability$/i);
    await expect(page.locator("main h2").first()).toContainText("of the same four-way odds");
    await expect(page.locator("#regime-hero")).toContainText("Current regime", { ignoreCase: true });

    const rec = (await (await page.request.get("/api/recession/probability")).json()) as { recession_prob: number | null };
    const heroText = await visibleText(page.locator("#regime-hero"));
    if (rec.recession_prob != null) expect(heroText).not.toContain(rec.recession_prob.toFixed(1));
    expect(heroText).not.toMatch(/over 12m/);
    await expect(page.locator("#regime-summary")).toContainText("a separate model", { timeout: 30_000 });
    expect(await page.locator("main img").count()).toBe(0);
  });

  test("4. buttons: Explore the regime lands on Regime Lab; View model details lands on Methodology #models in view", async ({ page }) => {
    await open(page);
    const hero = page.locator("#regime-hero");
    await hero.getByRole("link", { name: /Explore the regime/ }).click();
    await expect(page).toHaveURL(/\/app\/regime-lab$/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await hero.getByRole("link", { name: /View model details/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#models$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "models"), { timeout: 15_000 }).toBe(true);
  });

  test("5. summary: the eleven dt labels; the status strip is a dialog button that opens the alert feed, Esc returns focus, and it speaks the bell's sentence", async ({ page }) => {
    await open(page);
    const dts = page.locator("#regime-summary dt");
    await expect(dts).toHaveCount(11, { timeout: 30_000 });
    const labels = (await dts.allInnerTexts()).map(clean);
    SUMMARY_LABELS.forEach((expected, i) => {
      if (Array.isArray(expected)) expect(expected, `row ${i + 1}`).toContain(labels[i]);
      else expect(labels[i], `row ${i + 1}`).toBe(expected);
    });

    const strip = page.locator('#regime-summary button[aria-haspopup="dialog"]');
    await expect(strip).toHaveCount(1);
    const bell = header(page).getByRole("button", { name: /alert/i });
    await expect(bell).toHaveAttribute("aria-haspopup", "dialog");
    await expect.poll(async () => strip.getAttribute("aria-label"), { timeout: 15_000 }).toMatch(/Open the alert feed\.$/);
    expect(await strip.getAttribute("aria-label")).toBe(await bell.getAttribute("aria-label"));

    await strip.click();
    const drawer = page.getByRole("dialog", { name: "Alert feed" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-labelledby", "alert-drawer-title");
    expect(await page.locator("#shell-content").getAttribute("inert")).not.toBeNull();
    await capture(page, "dashboard--alert-drawer.png", page.locator("body"));
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    expect(await page.locator("#shell-content").getAttribute("inert")).toBeNull();
    await expect(strip).toBeFocused();
  });

  test("6. signals: five articles, badges equal the served status, Trips when and Signal print lines, no svg, View all signals lands on Methodology #signals", async ({ page }) => {
    await open(page);
    const articles = page.locator("#signals article");
    await expect(articles).toHaveCount(5);
    const served = (await (await page.request.get("/api/signals/latest")).json()) as { signals: { signal_name: string; status: string | null }[] };
    const statusByDisplay = new Map(served.signals.map((s) => [SIGNALS_META[s.signal_name]?.display ?? s.signal_name, s.status]));
    for (let i = 0; i < 5; i++) {
      const a = articles.nth(i);
      const name = clean(await a.locator("h3").first().innerText());
      const t = await visibleText(a);
      const status = statusByDisplay.get(name);
      if (status) expect(t, name).toMatch(new RegExp(`\\b${status}\\b`, "i"));
      else expect(t, name).toMatch(/\bUnavailable\b/i);
      expect(t, name).toMatch(/\b(?:Clear|Watch|Triggered|Unavailable)\b/i);
      expect(t, name).toContain("Trips when");
      expect(t, name).toContain("Signal print");
      expect(t, name).toMatch(/Last alert:|none on file/);
    }
    expect(await page.locator("#signals article svg").count()).toBe(0);
    await page.locator("#signals").getByRole("link", { name: /View all signals/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#signals$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "signals"), { timeout: 15_000 }).toBe(true);
  });

  test("7. key levels: the seven labels; the 10Y value equals the strip's US 10Y", async ({ page }) => {
    await open(page);
    const kl = page.locator("#key-levels");
    await expect(kl).toBeVisible();
    for (const label of KEY_LABELS) await expect(kl, label).toContainText(label, { ignoreCase: true });
    const stripValue = clean(await strip(page).locator('[data-symbol="US 10Y"] .v').innerText());
    expect(stripValue).toMatch(/^\d\.\d\d%$/);
    await expect(kl).toContainText(stripValue);
    await expect(page.locator("#us10y")).toContainText(stripValue);
  });

  test("8. Markets at a glance: six options flip aria-pressed by real clicks, tile symbols per tab, the What's priced panel, the hash and the Markets link", async ({ page }) => {
    await open(page);
    const buttons = glanceGroup(page).getByRole("button");
    await expect(buttons).toHaveCount(6);
    await expect(glanceOption(page, "Equities")).toHaveAttribute("aria-pressed", "true");
    for (const tab of GLANCE_TABS) {
      const option = glanceOption(page, tab.label);
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      expect(await glanceGroup(page).locator('button[aria-pressed="true"]').count(), String(tab.label)).toBe(1);
      await settle(page, 300);
      expect(await visibleGlanceSymbols(page), String(tab.label)).toEqual(tab.symbols);
      await capture(page, `dashboard--glance-${tab.file}.png`, page.locator("#markets-glance"));
    }
    // The What's priced tab: three tiles or the empty copy, and the link into Markets.
    const priced = page.locator("#whats-priced");
    await expect(priced).toBeVisible();
    const pricedText = await visibleText(priced);
    const hasTiles = /SOFR/i.test(pricedText) && /10Y breakeven/i.test(pricedText) && /10Y real yield/i.test(pricedText);
    const isEmpty = /No priced metrics on file|Market-implied pricing unavailable/.test(pricedText);
    expect(hasTiles || isEmpty, pricedText).toBe(true);
    await expect(priced).toContainText("3-row teaser · full table in Markets", { ignoreCase: true });
    await expect(priced.getByRole("link", { name: /See all in Markets/ })).toHaveAttribute("href", "/app/markets#whats-priced-full");

    await page.goto("/app/dashboard#whats-priced", { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(glanceOption(page, /^What.s priced$/i)).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => inView(page, "whats-priced"), { timeout: 15_000 }).toBe(true);
    await page.locator("#markets-glance").getByRole("link", { name: /View markets/ }).click();
    await expect(page).toHaveURL(/\/app\/markets$/);
  });

  test("9. US 10Y card: value, weekly delta in bps, sparkline, View rates lands on Credit #financing", async ({ page }) => {
    await open(page);
    const card = page.locator("#us10y");
    await expect(card).toBeVisible();
    const t = await visibleText(card);
    expect(t).toMatch(/(?:^|\s)\d\.\d\d%(?:\s|$)/);
    expect(t).toMatch(/[+-]\d+ bps/);
    expect(t).toMatch(/US 10 Year Yield/i);
    expect(await card.locator("svg path").count()).toBeGreaterThan(0);
    await card.getByRole("link", { name: /View rates/ }).click();
    await expect(page).toHaveURL(/\/app\/credit#financing$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "financing"), { timeout: 15_000 }).toBe(true);
  });

  test("10. calendar: importance dots carry data-importance and the token colour, or the fallback / empty copy; View calendar lands on News #calendar", async ({ page }) => {
    await open(page);
    const card = page.locator("#macro-calendar");
    await expect(card).toBeVisible();
    const dots = card.locator("[data-importance]");
    const n = await dots.count();
    if (n > 0) {
      const tokens = await page.evaluate(() => {
        const probe = document.createElement("i");
        document.body.appendChild(probe);
        const read = (v: string) => {
          probe.style.backgroundColor = v;
          return getComputedStyle(probe).backgroundColor;
        };
        const out = { amber: read("var(--amber)"), cyan: read("var(--cyan)"), gray: read("var(--text-4)") };
        probe.remove();
        return out;
      });
      expect(tokens.amber).toBe("rgb(245, 181, 46)");
      expect(tokens.cyan).toBe("rgb(60, 200, 240)");
      for (let i = 0; i < n; i++) {
        const dot = dots.nth(i);
        const importance = await dot.getAttribute("data-importance");
        const color = await dot.evaluate((el) => getComputedStyle(el).backgroundColor);
        const expected = importance === "high" ? tokens.amber : importance === "medium" ? tokens.cyan : tokens.gray;
        expect(color, `dot ${i} (${importance})`).toBe(expected);
        expect(await dot.getAttribute("title"), `dot ${i} title`).toMatch(/impact/);
      }
    } else {
      await expect(card).toContainText(/Stored schedule|No events on file\./);
    }
    await expect(card).toContainText("Hand-maintained schedule");
    await card.getByRole("link", { name: /View calendar/ }).click();
    await expect(page).toHaveURL(/\/app\/news#calendar$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "calendar"), { timeout: 15_000 }).toBe(true);
  });

  test("11. macro charts: all four closed on load, the first click shows a chart, the hash opens the first panel", async ({ page }) => {
    await open(page);
    const buttons = page.locator("#macro-charts button[aria-expanded]");
    await expect(buttons).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(buttons.nth(i)).toHaveAttribute("aria-expanded", "false");
    expect(await page.locator("#macro-charts svg[role='img']").count()).toBe(0);
    await buttons.first().click();
    await expect(buttons.first()).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#macro-charts svg[role='img']").first()).toBeVisible();
    await capture(page, "dashboard--charts-open.png");

    await page.goto("/app/dashboard#macro-charts", { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(page.locator("#macro-charts button[aria-expanded]").first()).toHaveAttribute("aria-expanded", "true", { timeout: 15_000 });
    await expect(page.locator("#macro-charts svg[role='img']").first()).toBeVisible();
    await expect.poll(() => inView(page, "macro-charts"), { timeout: 15_000 }).toBe(true);
  });

  test("12. read-through: two closed disclosures open by click, Full methodology links, the DisclosureLine is the last element in main", async ({ page }) => {
    await open(page);
    const section = page.locator("#read-through");
    await expect(section).toBeVisible();
    const closed = section.locator('button[aria-expanded="false"]');
    await expect(closed).toHaveCount(2);
    await expect(section.getByRole("button", { name: /Current read-through/ })).toBeVisible();
    await expect(section.getByRole("button", { name: /Method and provenance/ })).toBeVisible();
    await section.getByRole("button", { name: /Current read-through/ }).click();
    await section.getByRole("button", { name: /Method and provenance/ }).click();
    await expect(section.locator('button[aria-expanded="true"]')).toHaveCount(2);
    await expect(section).toContainText("The drivers on file:");
    await expect(section).toContainText("What would change the read:");
    await expect(section.getByRole("link", { name: /Full methodology/ })).toHaveAttribute("href", "/app/methodology");
    await capture(page, "dashboard--read-through-open.png");

    const lastIsLine = await page.evaluate(() => {
      const main = document.querySelector("main");
      const line = main?.querySelector("p.mrr-disclosure-line");
      if (!main || !line) return false;
      const all = main.querySelectorAll("*");
      return all[all.length - 1] === line;
    });
    expect(lastIsLine).toBe(true);
    await expect(page.locator("main p.mrr-disclosure-line")).toContainText("nothing on this screen is re-derived in the browser.");
  });

  test("13. section ids: the sections.ts ids plus read-through resolve on the route", async ({ page }) => {
    await open(page);
    const dashboard = TABS.find((t) => t.slug === "dashboard");
    expect(dashboard).toBeDefined();
    const ids = [...(dashboard?.sections.map((s) => s.id) ?? []), "read-through", "regime-summary", "markets-glance", "us10y", "macro-calendar"];
    const missing: string[] = [];
    for (const id of ids) {
      const found = await page.evaluate((elId) => Boolean(document.getElementById(elId)), id);
      if (!found) missing.push(id);
    }
    expect(missing, `ids missing on /app/dashboard: ${missing.join(", ")}`).toEqual([]);
  });

  test("16. at 390 px the hero stacks over the summary, the Segmented wraps and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    const boxes = await page.evaluate(() => {
      const box = (id: string) => document.getElementById(id)?.getBoundingClientRect() ?? null;
      return { hero: box("regime-hero"), summary: box("regime-summary") };
    });
    expect(boxes.hero).not.toBeNull();
    expect(boxes.summary).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);

    const tops = await glanceGroup(page).getByRole("button").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(tops).toHaveLength(6);
    expect(new Set(tops).size, `Segmented rows at 390 px: ${tops.join(", ")}`).toBeGreaterThan(1);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await capture(page, "dashboard--390.png");
  });

  test("17. captures: the full page at 1672 for the region-by-region compare with dashboard.png", async ({ page }) => {
    await open(page);
    await expect(page.locator("#regime-summary dt")).toHaveCount(11, { timeout: 30_000 });
    await settle(page, 1200);
    await capture(page, "dashboard.png");
    expect(fs.existsSync(path.join(DOCS, "dashboard.png")), "the approved mockup the verifier compares against").toBe(true);
  });
});
