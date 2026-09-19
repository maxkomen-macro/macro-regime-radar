/**
 * Phase 6 checklist (docs/redesign-v2/checklists/06-credit.md) section E.3:
 * the P6 browser check on /app/credit, steps 1 to 10, 14 and 15, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks, hovers
 * and keys only; the assistant panel is never opened, typed into or sent
 * from. Captures land in docs/redesign-v2/captures/redesign-06-credit/
 * (CAPTURE_DIR overrides). Steps 11 to 13 are the existing sections, parity
 * and regression specs, run separately. Where an assertion depends on what
 * the DB serves on verify day (the served label, the callout and the strip
 * tone, the Tight row, the defaults fallback), the served value is read from
 * the API first and the outcome recorded as a test annotation.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-06-credit");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/credit";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonYr = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const STATES = ["Normal", "Tight", "Stressed", "Crisis"];
/** Spread monitor card names in order (C.2) and the closed badge set. */
const CARD_NAMES = ["High yield", "Investment grade", "BB", "Single-B", "CCC"];
const BADGES = new Set(["Normal", "Stressed", "Crisis", "Tight", "Monitor", "Watch", "Distressed", "Unavailable"]);
const TIGHT_DEF = "IG spreads above 150 bp: financing strain";
const GUARD = "Rate components unavailable; the all-in figure above is the stored monthly read.";
/** The three NBER windows the hero caption names (oas-window.ts NBER_BANDS). */
const NBER = [
  { from: "2001-03-01", to: "2001-11-30", label: "2001" },
  { from: "2007-12-01", to: "2009-06-30", label: "2008–09" },
  { from: "2020-02-01", to: "2020-04-30", label: "2020" },
];

interface DatedValue {
  date: string;
  value: number;
}
interface CreditMetrics {
  credit_label: string;
  hy_oas: number | null;
  ig_oas: number | null;
  lbo_all_in_cost: string | null;
  hy_series: DatedValue[];
  ig_series: DatedValue[];
  tight_count: number;
  transition_3m: Record<string, Record<string, number>>;
}
interface LboDefaults {
  fedfunds: number;
  hy_oas_pct: number;
  lbo_all_in_rate: number;
  data_as_of: string;
}

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const hero = (page: Page) => page.locator("#credit-hero");
const summary = (page: Page) => page.locator("#credit-summary");
const oas = (page: Page) => page.locator("#oas");
const ladder = (page: Page) => page.locator("#quality-ladder");
const odds = (page: Page) => page.locator("#credit-state-odds");
const financing = (page: Page) => page.locator("#financing");
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
/** The element's top edge in viewport pixels (Infinity when absent). */
async function topOf(page: Page, id: string): Promise<number> {
  return page.evaluate((elId) => document.getElementById(elId)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY, id);
}

/** innerText of a locator (hidden tooltips excluded, CSS text-transform applied), whitespace collapsed. */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}
/** textContent of a locator (no text-transform), whitespace collapsed. */
async function contentText(loc: Locator): Promise<string> {
  return clean((await loc.textContent()) ?? "");
}

async function served(page: Page): Promise<CreditMetrics> {
  const r = await page.request.get("/api/credit/metrics");
  expect(r.status(), "/api/credit/metrics").toBe(200);
  return (await r.json()) as CreditMetrics;
}
async function awaitHero(page: Page): Promise<void> {
  await expect(page.locator("main h1")).toHaveText(/^(?:Normal|Tight|Stressed|Crisis)$/, { timeout: 30_000 });
}

/** The dates both series carry, oldest first (the chart plots the intersection). */
function commonDates(m: CreditMetrics): string[] {
  const ig = new Set(m.ig_series.map((p) => p.date));
  return m.hy_series.map((p) => p.date).filter((d) => ig.has(d));
}
/** First plotted date of the ten-year window: ten calendar years before the last point, boundary month kept. */
function tenYearStart(dates: string[]): string {
  const last = dates[dates.length - 1];
  const cutoff = `${Number(last.slice(0, 4)) - 10}${last.slice(4, 10)}`;
  return dates.find((d) => d.slice(0, 10) >= cutoff) ?? dates[0];
}
const bandsIn = (from: string, to: string) => NBER.filter((b) => b.to >= from.slice(0, 10) && b.from <= to.slice(0, 10)).map((b) => b.label);
const bandList = (labels: string[]) => (labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`);
const bandPhrase = (labels: string[]) => (labels.length === 1 ? `the shaded band marks the ${labels[0]} NBER recession` : `the shaded bands mark the ${bandList(labels)} NBER recessions`);

/** The ladder rows of the financing tile: one per Tag badge, as their parent rows. */
const ladderRows = (page: Page) => financing(page).locator("span[data-tone]").locator("xpath=..");
/** A jargon affordance by its visible term, with its tooltip. */
function jargon(root: Locator, term: RegExp): { term: Locator; tip: Locator } {
  const wrap = root.locator(".jargon-wrap").filter({ has: root.page().locator(".jargon", { hasText: term }) }).first();
  return { term: wrap.locator(".jargon"), tip: wrap.locator("[role='tooltip']") };
}
/** The hero's mono range line ("Sep 2016 → Sep 2026 · HY high … · IG low …"). */
const rangeLine = (page: Page) => hero(page).getByText(/HY high \d+ bps \([A-Z][a-z]{2} \d{4}\)/);
const chartCaption = (page: Page) => hero(page).getByText(/Spreads spike when lenders panic/);

async function capture(page: Page, file: string, target?: Locator, fullPage = true): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("credit (checklist 06 E.3)", () => {
  test.describe.configure({ mode: "serial" });

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
    for (const url of ["/api/credit/metrics", "/api/lbo/defaults", "/api/freshness"]) {
      expect((await page.request.get(url)).status(), url).toBe(200);
    }
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses on the route", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    await awaitHero(page);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
    await expect(financing(page)).toContainText(/Fed funds|Rate components unavailable/, { timeout: 30_000 });
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.credit?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero: one serif h1 equal to the served credit_label, the HY OAS pill equal to the served figure, the High yield at h2, the chart canvas and the legend words", async ({ page }) => {
    await open(page);
    const m = await served(page);
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(m.credit_label, { timeout: 30_000 });
    expect(STATES, `served label ${m.credit_label}`).toContain(m.credit_label);
    expect(await page.locator("h1").count()).toBe(1);
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Source Serif 4"?/);
    expect(await h1.locator(".jargon").count()).toBe(0);
    await expect(hero(page)).toContainText("Credit conditions", { ignoreCase: true });

    const pill = hero(page).locator(".mrr-pill");
    await expect(pill).toHaveCount(1);
    const pillText = await contentText(pill);
    expect(pillText).toMatch(/^HY OAS \d+ bps$/i);
    expect(m.hy_oas, "hy_oas served").not.toBeNull();
    expect(Number(pillText.replace(/\D+/g, ""))).toBe(Math.round(m.hy_oas as number));
    note("hero", `${m.credit_label} · ${pillText}`);

    const h2 = page.locator("main h2").first();
    expect(await visibleText(h2)).toMatch(/^High yield at \d+ bps/);
    expect(await visibleText(h2)).toContain(`High yield at ${Math.round(m.hy_oas as number)} bps`);
    await expect(hero(page).locator(".mrr-hero-lede")).toContainText(/CCC moved [+-]\d+ bps in the month/);

    const img = hero(page).locator("[role='img']");
    await expect(img).toHaveCount(1, { timeout: 30_000 });
    await expect(img.locator("canvas").first()).toBeAttached({ timeout: 30_000 });
    expect(await img.getAttribute("aria-label")).toMatch(/^High-yield and investment-grade option-adjusted spreads, monthly, [A-Z][a-z]{2} \d{4} to [A-Z][a-z]{2} \d{4}; dashed rules at HY 700, HY 400 and IG 150 bps; shaded NBER recessions$/);
    const heroText = await visibleText(hero(page));
    expect(heroText).toContain("HY OAS · bps");
    expect(heroText).toContain("IG OAS · bps");
    expect(await page.locator("main img").count()).toBe(0);
    expect(heroText).not.toContain("—");
  });

  test("4. range control: MAX opens the range line at the first served month with every band named; 10Y opens ten years before the last point with the bands in view", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const dates = commonDates(m);
    expect(dates.length, "common HY / IG dates").toBeGreaterThan(12);
    const first = fmtMonYr(dates[0]);
    const last = fmtMonYr(dates[dates.length - 1]);
    const tenStart = fmtMonYr(tenYearStart(dates));
    const group = hero(page).getByRole("group", { name: "OAS history window" });
    await expect(group).toHaveCount(1);
    const tenY = group.getByRole("button", { name: "10Y", exact: true });
    const max = group.getByRole("button", { name: "MAX", exact: true });
    await expect(tenY).toHaveAttribute("aria-pressed", "true");
    await expect(rangeLine(page)).toHaveText(new RegExp(`^${tenStart} → ${last} · HY high \\d+ bps \\([A-Z][a-z]{2} \\d{4}\\) · IG low \\d+ bps \\([A-Z][a-z]{2} \\d{4}\\)$`));
    const tenBands = bandsIn(tenYearStart(dates), dates[dates.length - 1]);
    expect(await visibleText(chartCaption(page)), "10Y caption names the bands in view").toContain(bandPhrase(tenBands));
    note("bands-10y", `${tenBands.length}: ${tenBands.join(", ")} (${tenStart} → ${last})`);

    await max.click();
    await expect(max).toHaveAttribute("aria-pressed", "true");
    await expect(tenY).toHaveAttribute("aria-pressed", "false");
    await expect(rangeLine(page)).toHaveText(new RegExp(`^${first} → ${last} · HY high`), { timeout: 15_000 });
    const allBands = bandsIn(dates[0], dates[dates.length - 1]);
    expect(await visibleText(chartCaption(page)), "MAX caption names every band").toContain(bandPhrase(allBands));
    note("bands-max", `${allBands.length}: ${allBands.join(", ")} (${first} → ${last})`);
    if (dates[0] <= "1996-12-01") {
      expect(first).toBe("Dec 1996");
      expect(allBands).toEqual(["2001", "2008–09", "2020"]);
    }
    expect(await hero(page).locator("[role='img'] canvas").count()).toBeGreaterThanOrEqual(1);
    await settle(page, 600);
    await capture(page, "credit--chart-max.png", hero(page));

    await tenY.click();
    await expect(tenY).toHaveAttribute("aria-pressed", "true");
    await expect(rangeLine(page)).toHaveText(new RegExp(`^${tenStart} → ${last} · HY high`), { timeout: 15_000 });
    expect(await visibleText(chartCaption(page)), "10Y caption names the bands in view").toContain(bandPhrase(tenBands));
    // Ten years hides no band that the full history shows unless it fell before the window.
    expect(tenBands.length).toBeLessThanOrEqual(allBands.length);
  });

  test("5. buttons: See the quality ladder scrolls #quality-ladder to the viewport top; Price an LBO lands on /app/tools#lbo with the LBO sub-tab selected", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const see = hero(page).getByRole("link", { name: /See the quality ladder/ });
    const price = hero(page).getByRole("link", { name: /Price an LBO/ });
    await expect(see).toHaveClass(/mrr-hero-btn-primary/);
    await expect(price).toHaveClass(/mrr-hero-btn-ghost/);
    await see.click();
    await expect(page).toHaveURL(/\/app\/credit#quality-ladder$/);
    await expect.poll(() => inView(page, "quality-ladder"), { timeout: 15_000 }).toBe(true);
    // The hash effect re-runs once the metrics arrive (useHashScroll(m)), so the
    // final position settles asynchronously: poll it rather than read it once.
    await expect
      .poll(() => topOf(page, "quality-ladder"), { timeout: 15_000, message: "the section lands at the top of the viewport (a sticky header may offset it)" })
      .toBeLessThanOrEqual(160);
    const top = await topOf(page, "quality-ladder");
    note("quality-ladder-top", `${Math.round(top)} px from the viewport top after the primary click`);

    await page.goBack();
    await settle(page, 600);
    await expect(page).toHaveURL(/\/app\/credit$/);
    await awaitHero(page);
    await hero(page).getByRole("link", { name: /Price an LBO/ }).click();
    await expect(page).toHaveURL(/\/app\/tools#lbo$/);
    await settle(page, 900);
    const lboTab = page.locator("main [role='tab']").filter({ hasText: /^LBO calculator/ }).first();
    await expect(lboTab).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
    await expect(page.locator("#lbo")).toHaveCount(1);
  });

  test("6. summary: the six dt labels in C.2 order, the strip is a link to #quality-ladder whose tone agrees with the callout, and clicking it scrolls the ladder into view", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const dts = summary(page).locator("dt");
    await expect.poll(() => dts.count(), { timeout: 30_000 }).toBe(6);
    await settle(page, 600);
    expect((await dts.allTextContents()).map(clean)).toEqual(["HY OAS", "IG OAS", "CCC distress", "HY / IG ratio", `Stays ${m.credit_label} · 3m`, "LBO all-in"]);
    await expect(summary(page).locator("h2")).toHaveText(/^Credit summary$/i);
    for (const dd of await summary(page).locator("dd").all()) expect(clean(await dd.innerText())).not.toBe("");
    const stays = summary(page).locator("dd").nth(4);
    if (Object.keys(m.transition_3m).length) await expect(stays).toHaveText(/^\d+% of past months$/);
    else await expect(stays).toHaveText("not enough monthly history (needs 60 months)");

    const strip = summary(page).locator('a[href="/app/credit#quality-ladder"]');
    await expect(strip).toHaveCount(1);
    await expect(strip).toHaveClass(/mrr-status/);
    const title = await contentText(strip.locator(".mrr-status-title"));
    expect(title).toMatch(/^(?:Watch · CCC widening|Watch · CCC at \d+(?:\.\d)?% of the distress line|(?:Stressed|Crisis) · HY \d+ bps|Clear · ladder in step)$/);
    expect(await strip.getAttribute("aria-label")).toMatch(new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. .+\\. Jump to the quality ladder\\.$`));
    const hasCallout = (await ladder(page).getByText(/Analytical callout · quality ladder tension/i).count()) > 0;
    const tone = (await strip.getAttribute("data-tone")) ?? "";
    note("strip", `${title} · tone ${tone} · callout ${hasCallout ? "rendered" : "absent"}`);
    if (hasCallout) {
      expect(tone).toBe("amber");
      await expect(strip).toHaveClass(/mrr-status-amber/);
    } else {
      expect(["amber", "mint"]).toContain(tone);
    }
    await expect(strip).toHaveClass(new RegExp(`mrr-status-${tone}`));

    await strip.click();
    await expect(page).toHaveURL(/\/app\/credit#quality-ladder$/);
    await expect.poll(() => inView(page, "quality-ladder"), { timeout: 15_000 }).toBe(true);
  });

  test("7. spread monitor: five article cards with the h3 names in order, badges from the closed set, one meter slot on every card (Iteration 1 G3: Percentile since 1996 on HY and IG only, the marked no-percentile slot on BB and B, the distress line on CCC), Series notes → lands on Methodology #models", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const cards = oas(page).locator("article");
    await expect(cards).toHaveCount(5, { timeout: 30_000 });
    expect((await cards.locator("h3").allTextContents()).map(clean)).toEqual(CARD_NAMES);
    await expect(oas(page).locator("h2")).toHaveText(/^Spread monitor$/i);
    for (let i = 0; i < 5; i++) {
      const card = cards.nth(i);
      const badge = clean((await card.locator("span[data-tone]").first().textContent()) ?? "");
      expect(BADGES, `${CARD_NAMES[i]} badge ${badge}`).toContain(badge);
      expect(await visibleText(card)).toMatch(/\d+ bps|—/);
      const meters = await card.locator(".mrr-meter").count();
      const text = await visibleText(card);
      expect(meters, `${CARD_NAMES[i]} meter`).toBe(1);
      if (i < 2) expect(text).toContain("Percentile since 1996");
      else if (i < 4) expect(text).toContain("No percentile served");
      else expect(text).toMatch(/Vs the 1,000 bps distress line|No percentile served/);
      if (i >= 2) expect(text).not.toContain("Percentile since 1996");
      expect(text).not.toContain("Last alert");
      note(`card-${i + 1}`, `${CARD_NAMES[i]} · ${badge}`);
    }
    expect(await oas(page).locator("article svg").count()).toBe(5);
    await oas(page).getByRole("link", { name: /Series notes/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#models$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "models"), { timeout: 15_000 }).toBe(true);
  });

  test("8. credit state odds (P6): 3 months pressed on load, a real click on 6 months swaps the matrix and the eyebrow, 3 months restores it, Tab reaches the buttons and Space toggles", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const group = odds(page).getByRole("group", { name: "Transition horizon" });
    await expect(group).toHaveCount(1);
    const three = group.getByRole("button", { name: "3 months", exact: true });
    const six = group.getByRole("button", { name: "6 months", exact: true });
    await expect(three).toHaveAttribute("aria-pressed", "true");
    await expect(six).toHaveAttribute("aria-pressed", "false");
    const table = odds(page).locator("[role='table']");
    if (!Object.keys(m.transition_3m).length) {
      await expect(odds(page)).toContainText("Not enough monthly history for transition odds (needs 60 months).");
      note("odds", "empty matrices served: the 60-months note renders, no grid to toggle");
      return;
    }
    await expect(table).toHaveCount(1, { timeout: 30_000 });
    expect(await table.getAttribute("aria-label")).toBe("Credit-state transition matrix 3M");
    await expect(odds(page).getByText("3-month transition odds")).toBeVisible();
    expect((await table.locator("[role='columnheader']").allTextContents()).map(clean)).toEqual(["From ↓ to →", "→ Normal", "→ Tight", "→ Stressed", "→ Crisis"]);
    const cells3 = (await table.locator("[role='cell']").allTextContents()).map(clean);
    expect(cells3).toHaveLength(16);
    // The served label's row header carries aria-current and every cell of it the outline.
    const current = table.locator("[role='rowheader'][aria-current='true']");
    await expect(current).toHaveCount(1);
    expect(clean((await current.textContent()) ?? "").replace(/\s*●$/, "")).toBe(m.credit_label);
    const currentRow = current.locator("xpath=..");
    for (const cell of await currentRow.locator("[role='cell']").all()) expect(await cell.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    // Iteration 1: a row with no months behind it (served transition_obs_3m, else
    // the Tight count) reads "No history" in every cell, never a measured 0%.
    const obs3 = (m as { transition_obs_3m?: Record<string, number> | null }).transition_obs_3m ?? null;
    const tightEmpty = obs3 ? obs3.Tight === 0 : m.tight_count === 0;
    const tightRow = table.locator("[role='rowheader']").filter({ hasText: /^Tight/ }).locator("xpath=..");
    const tightCells = (await tightRow.locator("[role='cell']").allTextContents()).map(clean);
    if (tightEmpty) expect(tightCells).toEqual(["No history", "No history", "No history", "No history"]);
    else for (const c of tightCells) expect(c).toMatch(/^\d+%$/);
    note("tight-row", `tight_count ${m.tight_count}, 3m months ${obs3?.Tight ?? "n/a"}: ${tightCells.join(" ")}`);
    // G4: the sentences after the first two sit behind Details.
    await odds(page).getByRole("button", { name: /Details/ }).click();

    await six.click();
    await expect(six).toHaveAttribute("aria-pressed", "true");
    await expect(three).toHaveAttribute("aria-pressed", "false");
    await expect(odds(page).getByText("6-month transition odds")).toBeVisible();
    await expect(odds(page).getByText("3-month transition odds")).toHaveCount(0);
    expect(await table.getAttribute("aria-label")).toBe("Credit-state transition matrix 6M");
    const cells6 = (await table.locator("[role='cell']").allTextContents()).map(clean);
    expect(cells6).toHaveLength(16);
    expect(cells6.some((c, i) => c !== cells3[i]), `6M cells equal the 3M cells: ${cells6.join(" ")}`).toBe(true);
    note("odds-3m-vs-6m", `${cells3.slice(0, 4).join(" ")} → ${cells6.slice(0, 4).join(" ")}`);
    await expect(odds(page)).toContainText(/3-month view: \w+ stays \d+%\./);
    await settle(page, 400);
    await capture(page, "credit--odds-6m.png", odds(page));

    await three.click();
    await expect(three).toHaveAttribute("aria-pressed", "true");
    expect(await table.getAttribute("aria-label")).toBe("Credit-state transition matrix 3M");
    expect((await table.locator("[role='cell']").allTextContents()).map(clean)).toEqual(cells3);
    await expect(odds(page)).toContainText(/6-month view: \w+ stays \d+%\./);

    // Keyboard: both buttons are in the Tab order and Space activates.
    await three.focus();
    await expect(three).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(six).toBeFocused();
    await page.keyboard.press("Space");
    await expect(six).toHaveAttribute("aria-pressed", "true");
    expect(await table.getAttribute("aria-label")).toBe("Credit-state transition matrix 6M");
    await page.keyboard.press("Shift+Tab");
    await expect(three).toBeFocused();
    await page.keyboard.press("Space");
    await expect(three).toHaveAttribute("aria-pressed", "true");
    expect(await table.getAttribute("aria-label")).toBe("Credit-state transition matrix 3M");
  });

  test("9. jargon (P6): hovering the ladder's Tight opens the decision-3 tooltip, moving away closes it, Tab focus opens it, Escape closes it without moving focus; distress and NBER keep their affordances", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const { term, tip } = jargon(financing(page), /^Tight$/);
    await expect(term).toHaveCount(1);
    await expect(term).toHaveAttribute("role", "button");
    await term.scrollIntoViewIfNeeded();
    await expect(tip).toBeHidden();
    await term.hover();
    await expect(tip).toBeVisible();
    expect(clean((await tip.textContent()) ?? "").startsWith(TIGHT_DEF)).toBe(true);
    expect(await tip.textContent()).not.toContain("—");
    await capture(page, "credit--tight-tooltip.png", undefined, false);
    await page.mouse.move(4, 4);
    await expect(tip).toBeHidden({ timeout: 5_000 });

    // Tab from the section's header link until the term holds focus (the term is the next control after the link).
    await financing(page).getByRole("link", { name: /Open LBO calculator/ }).focus();
    let focused = false;
    for (let i = 0; i < 8 && !focused; i++) {
      await page.keyboard.press("Tab");
      focused = await term.evaluate((el) => document.activeElement === el);
    }
    expect(focused, "Tab reaches the ladder's Tight term").toBe(true);
    await expect(tip).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();
    await expect(term).toBeFocused();

    const distress = jargon(ladder(page), /^distress$/);
    await expect(distress.term.first()).toHaveCount(1);
    await distress.term.scrollIntoViewIfNeeded();
    await distress.term.hover();
    await expect(distress.tip).toBeVisible();
    await expect(distress.tip).toContainText("CCC-rated spreads at 1,000 bps or wider");
    await page.mouse.move(4, 4);
    await expect(distress.tip).toBeHidden({ timeout: 5_000 });

    const nber = jargon(hero(page), /^NBER$/);
    await expect(nber.term).toHaveCount(1);
    await nber.term.scrollIntoViewIfNeeded();
    await nber.term.hover();
    await expect(nber.tip).toBeVisible();
    await expect(nber.tip).toContainText("National Bureau of Economic Research");
  });

  test("10. financing: the all-in value equals the summary LBO row's figure, the bar labels (or the fallback guard), exactly one ← today row naming the served label, Open LBO calculator → lands on /app/tools#lbo", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const defaults = (await (await page.request.get("/api/lbo/defaults")).json()) as LboDefaults;
    await expect(financing(page).locator("h2")).toHaveText(/^Financing conditions$/i);
    await expect(financing(page)).toContainText("LBO all-in cost", { ignoreCase: true });
    const summaryRow = await visibleText(summary(page).locator("dd").nth(5));
    const figure = summaryRow.match(/^(\d+\.\d+%|—)/)?.[1];
    expect(figure, `summary LBO row "${summaryRow}"`).toBeDefined();
    if (m.lbo_all_in_cost) {
      expect(figure).toBe(m.lbo_all_in_cost);
      await expect(financing(page)).toContainText(m.lbo_all_in_cost);
    }
    const finText = await visibleText(financing(page));
    if (defaults.data_as_of === "unavailable") {
      expect(finText).toContain(GUARD);
      note("lbo-defaults", "fallback payload: no bar rendered");
    } else {
      expect(finText).toContain(`Fed funds ${defaults.fedfunds.toFixed(2)}%`);
      expect(finText).toContain(`HY OAS ${defaults.hy_oas_pct.toFixed(2)}%`);
      expect(finText).toContain(`Fed funds + HY OAS = ${defaults.lbo_all_in_rate.toFixed(2)}%`);
      expect(finText).not.toContain(GUARD);
      note("lbo-defaults", `${defaults.fedfunds.toFixed(2)} + ${defaults.hy_oas_pct.toFixed(2)} = ${defaults.lbo_all_in_rate.toFixed(2)} · stored through ${defaults.data_as_of}`);
    }
    expect(finText.match(/← today/g)?.length ?? 0).toBe(1);
    const rows = ladderRows(page);
    await expect(rows).toHaveCount(4);
    // Visible text: the Tight row's Jargon tooltip definition is part of textContent.
    const rowTexts = (await Promise.all(Array.from({ length: await rows.count() }, (_, i) => visibleText(rows.nth(i))))).map(clean);
    // Check order (credit.py:113-120): Crisis, Stressed, Tight, Normal.
    // innerText carries the Tag's text-transform (uppercase): compare case-insensitively.
    const lower = rowTexts.map((t) => t.toLowerCase());
    expect(lower.map((t) => t.split(" ")[0])).toEqual(["crisis", "stressed", "tight", "normal"]);
    for (const s of STATES) expect(lower.some((t) => t.startsWith(s.toLowerCase())), `ladder row for ${s}`).toBe(true);
    const today = rowTexts.filter((t) => t.includes("← today"));
    expect(today).toHaveLength(1);
    expect(today[0].toLowerCase().startsWith(m.credit_label.toLowerCase()), `today row "${today[0]}" vs label ${m.credit_label}`).toBe(true);
    expect(finText).toContain("Checked top-down; the first rule that matches names the state.");
    await financing(page).getByRole("link", { name: /Open LBO calculator/ }).click();
    await expect(page).toHaveURL(/\/app\/tools#lbo$/);
    await settle(page, 900);
    await expect(page.locator("main [role='tab']").filter({ hasText: /^LBO calculator/ }).first()).toHaveAttribute("aria-selected", "true", { timeout: 15_000 });
  });

  test("14. at 390 px the hero stacks over the summary, the pill wraps under the h1, the matrix scrolls inside its well and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await awaitHero(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBe(6);
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      return { hero: box("#credit-hero"), summary: box("#credit-summary"), h1: box("#credit-hero h1"), pill: box("#credit-hero .mrr-pill"), ladder: box("#quality-ladder"), odds: box("#credit-state-odds") };
    });
    for (const [k, v] of Object.entries(boxes)) expect(v, k).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    expect((boxes.pill as DOMRect).top).toBeGreaterThanOrEqual((boxes.h1 as DOMRect).bottom - 1);
    // One column: the matrices sit under the ladder, not beside it.
    expect((boxes.odds as DOMRect).top).toBeGreaterThanOrEqual((boxes.ladder as DOMRect).bottom - 1);
    const m = await served(page);
    if (Object.keys(m.transition_3m).length) await expect(odds(page).locator(".mrr-scroll[data-scrollable='true']")).toHaveCount(1, { timeout: 15_000 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "credit--390.png");
  });

  test("15. captures: the full page at 1672 for the region-by-region compare with credit.png", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBe(6);
    await expect(hero(page).locator("[role='img'] canvas").first()).toBeAttached({ timeout: 30_000 });
    await expect(oas(page).locator("article")).toHaveCount(5, { timeout: 30_000 });
    await expect(financing(page)).toContainText(/Fed funds|Rate components unavailable/, { timeout: 30_000 });
    await settle(page, 1200);
    await capture(page, "credit.png");
    expect(fs.existsSync(path.join(DOCS, "credit.png")), "the approved mockup the verifier compares against").toBe(true);
  });
});
