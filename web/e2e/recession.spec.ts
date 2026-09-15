/**
 * Phase 7 checklist (docs/redesign-v2/checklists/07-recession.md) section E.3:
 * the P7 browser check on /app/recession, steps 1 to 12, 16 and 17, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks and keys
 * only (the sensitivity step focuses a range and presses ArrowRight); the
 * assistant panel is never opened, typed into or sent from. Captures land in
 * docs/redesign-v2/captures/redesign-07-recession/ (CAPTURE_DIR overrides).
 * Steps 13 to 15 are the existing sections, parity and regression specs, run
 * separately. Where an assertion depends on what the DB serves on verify day
 * (the served label, the strip state, the 24M window's peak, the curve's zero
 * crossing, the divergence score), the served payload is read from the API
 * first, the C.1 rules are recomputed locally (G16), and the outcome is
 * recorded as a test annotation.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-07-recession");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/recession";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonYr = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const fmtDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
const fmtSigned = (v: number, dp: number) => `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The served band words (recession.py) and the summary row labels in C.2 order. */
const LABELS = ["Low Risk", "Elevated", "High Risk"];
const SUMMARY_LABELS = ["12-month probability", "3 months ago", "Strongest input", "Curve 2s10s", "Model vs market", "Regime context", "Reference thresholds"];
const CARD_NAMES = ["Yield curve (2s10s)", "Unemployment rate", "HY credit spread", "Industrial production YoY", "Leading-indicator proxy"];
const TENOR_ORDER = ["1M", "3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"];
const STRIP_TITLE = /^(?:Watch · \d+ straight rises|No consecutive rises|Reading the recession model…|Recession model unavailable)$/;
const LEGEND_RANGE = /^[A-Z][a-z]{2} \d\d, \d{4} → [A-Z][a-z]{2} \d\d, \d{4}$/;
const DISPLAY_NUMBER = /^\d+\.\d%$/;

interface DatedValue {
  date: string;
  value: number;
}
interface RecessionMetrics {
  recession_prob: number | null;
  recession_label: string;
  yield_curve_spread: number | null;
  is_inverted: boolean | null;
  divergence_score: number | null;
  divergence_label: string;
  recession_prob_series: DatedValue[];
  yield_curve_series: DatedValue[];
  feature_coefficients: Record<string, number>;
  curve_shape: Record<string, number | null>;
  model_features: string[];
}
interface Regime {
  label: string;
}

/* ── local copies of the C.1 rules the strip and the windows are checked against (G16) ── */

const day = (iso: string) => iso.slice(0, 10);
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
/** Largest i with value === prob; else the largest i dated on or before today; else the last point; -1 when empty. */
function headlineIndex(series: DatedValue[], prob: number | null): number {
  if (!series.length) return -1;
  if (prob != null) for (let i = series.length - 1; i >= 0; i--) if (series[i].value === prob) return i;
  const today = todayIso();
  for (let i = series.length - 1; i >= 0; i--) if (day(series[i].date) <= today) return i;
  return series.length - 1;
}
/** Consecutive month-over-month rises ending at i, at the display's 0.1 resolution. */
function riseStreak(series: DatedValue[], i: number): number {
  let n = 0;
  for (let k = i; k > 0; k--) {
    if (Math.round(series[k].value * 10) > Math.round(series[k - 1].value * 10)) n++;
    else break;
  }
  return n;
}
/** First date kept by the n-year window: on or after `${year(last) - n}${last.slice(4)}`. */
function windowStart(series: DatedValue[], n: number | null): string {
  if (!series.length) return "";
  if (n == null) return day(series[0].date);
  const last = day(series[series.length - 1].date);
  const cutoff = `${Number(last.slice(0, 4)) - n}${last.slice(4)}`;
  return day(series.find((p) => day(p.date) >= cutoff)?.date ?? series[0].date);
}
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/* ── page helpers ─────────────────────────────────────────────────────────── */

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const hero = (page: Page) => page.locator("#recession-hero");
const heroViz = (page: Page) => hero(page).locator(".mrr-hero-viz");
const summary = (page: Page) => page.locator("#recession-summary");
const model = (page: Page) => page.locator("#model");
const curve = (page: Page) => page.locator("#curve");
const sensitivity = (page: Page) => page.locator("#sensitivity");
const sensButton = (page: Page) => sensitivity(page).locator("button[aria-expanded]").first();
const transparency = (page: Page) => page.locator("#transparency");
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
const lower = (s: string) => clean(s).toLowerCase();

async function served(page: Page): Promise<RecessionMetrics> {
  // The cold call trains the model in-process (about a second); the API's own cache serves the rest.
  const r = await page.request.get("/api/recession/probability", { timeout: 60_000 });
  expect(r.status(), "/api/recession/probability").toBe(200);
  return (await r.json()) as RecessionMetrics;
}
async function servedRegime(page: Page): Promise<Regime> {
  const r = await page.request.get("/api/regime/latest");
  expect(r.status(), "/api/regime/latest").toBe(200);
  return (await r.json()) as Regime;
}
async function awaitHero(page: Page): Promise<void> {
  await expect(page.locator("main h1")).toHaveText(DISPLAY_NUMBER, { timeout: 60_000 });
}
async function awaitSummary(page: Page): Promise<void> {
  await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(6);
}

/** The LineChart legend's "{first} → {last}" range line inside a root. */
const legendRange = (root: Locator) => root.locator("span").filter({ hasText: LEGEND_RANGE }).first();
/** A LineChart reference-rule label ("20% Elevated", "Inversion below 0"). */
const ruleLabel = (root: Locator, label: string) => root.locator("span").filter({ hasText: new RegExp(`^${escapeRe(label)}$`) });
/** The scenario result in the display face inside #sensitivity. */
const displayNumber = (page: Page) => sensitivity(page).locator("span").filter({ hasText: DISPLAY_NUMBER }).first();
/** A slider row by its label. */
const sliderRow = (page: Page, label: string) => page.locator(".mrr-slider-row").filter({ has: page.locator("label", { hasText: new RegExp(`^${escapeRe(label)}$`) }) }).first();
const resetButton = (page: Page) => sensitivity(page).getByRole("button", { name: /Reset to current readings/ });

async function capture(page: Page, file: string, target?: Locator, fullPage = true): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("recession (checklist 07 E.3)", () => {
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
    expect((await page.request.get("/api/recession/probability", { timeout: 60_000 })).status(), "/api/recession/probability").toBe(200);
    for (const url of ["/api/regime/latest", "/api/freshness"]) {
      expect((await page.request.get(url)).status(), url).toBe(200);
    }
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses on the route", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await expect(transparency(page)).toContainText(/model card/i, { timeout: 30_000 });
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.recession?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero: one serif h1 equal to the served probability, the pill equal to the served label, the Twelve-month odds h2, and no classifier label in the hero", async ({ page }) => {
    await open(page);
    const m = await served(page);
    const regime = await servedRegime(page);
    expect(m.recession_prob, "recession_prob served").not.toBeNull();
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(`${(m.recession_prob as number).toFixed(1)}%`, { timeout: 60_000 });
    expect(await page.locator("h1").count()).toBe(1);
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Source Serif 4"?/);
    await expect(hero(page)).toContainText("Recession model", { ignoreCase: true });

    const pill = hero(page).locator(".mrr-pill");
    await expect(pill).toHaveCount(1);
    // The pill is mono uppercase: compare the served word case-insensitively.
    expect(lower(await visibleText(pill))).toBe(lower(m.recession_label));
    expect(await contentText(pill)).toBe(m.recession_label);
    note("hero", `${(m.recession_prob as number).toFixed(1)}% · ${m.recession_label}`);

    const h2 = page.locator("main h2").first();
    expect(await visibleText(h2)).toMatch(/^Twelve-month odds/);
    const lede = hero(page).locator(".mrr-hero-lede");
    await expect(lede).toContainText("recession model's own probability");

    // The classifier's label never appears in the hero; the lede's fixed pointer at
    // "the classifier's Recession Risk odds" is carved out when that is the served label.
    const heroText = await visibleText(hero(page));
    const ledeText = await visibleText(lede);
    const outsideLede = heroText.replace(ledeText, "");
    expect(outsideLede, `hero text carries the classifier label ${regime.label}`).not.toContain(regime.label);
    if (regime.label !== "Recession Risk") expect(heroText).not.toContain(regime.label);
    note("classifier", `${regime.label} (only on the Regime context row)`);
    await expect(summary(page)).toContainText("classifier", { timeout: 30_000 });
    expect(await page.locator("main img").count()).toBe(0);
    expect(heroText).not.toContain("—");
  });

  test("4. labels read Low / Elevated / High Risk (P7 check 1): the gauge's band words are svg text, the pill word is one of the three, the note names the same band", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const gauge = hero(page).locator("svg[aria-label^='Recession probability gauge']");
    await expect(gauge).toHaveCount(1);
    expect(await gauge.getAttribute("aria-label")).toBe(`Recession probability gauge at ${(m.recession_prob as number).toFixed(1)}% · ${m.recession_label}`);
    const words = (await hero(page).locator("svg text").allTextContents()).map(clean);
    for (const w of ["LOW", "ELEVATED", "HIGH RISK", "0", "20", "40", "100"]) expect(words, w).toContain(w);
    const pill = await contentText(hero(page).locator(".mrr-pill"));
    expect(LABELS, `pill word ${pill}`).toContain(pill);
    expect(pill).toBe(m.recession_label);
    const noteLine = hero(page).locator(".mrr-hero-note");
    await expect(noteLine).toContainText(`Sits in the ${pill} band`);
    await expect(noteLine).toContainText("2008 peaked near 89%");
    note("band", pill);
  });

  test("5. the 24M / Full history toggle works (P7 check 2): 24M pressed over the last two years; Full history plots since the first month with the 20% and 40% rules; 24M restores the short window", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const series = m.recession_prob_series;
    expect(series.length, "recession_prob_series").toBeGreaterThan(24);
    const last = day(series[series.length - 1].date);
    const first24 = day(series[series.length - 24].date);
    const group = hero(page).getByRole("group", { name: "History window" });
    await expect(group).toHaveCount(1);
    const short = group.getByRole("button", { name: "24M", exact: true });
    const full = group.getByRole("button", { name: "Full history", exact: true });
    await expect(short).toHaveAttribute("aria-pressed", "true");
    await expect(full).toHaveAttribute("aria-pressed", "false");
    await expect(legendRange(heroViz(page))).toHaveText(`${fmtDate(first24)} → ${fmtDate(last)}`);
    expect(Number(first24.slice(0, 4)), `24M starts in ${first24}`).toBeGreaterThanOrEqual(2024);
    await expect(heroViz(page)).toContainText(`monthly since ${fmtMonYr(first24)}`);
    const peak24 = Math.max(...series.slice(-24).map((p) => p.value));
    note("window-24m", `${fmtDate(first24)} → ${fmtDate(last)} · peak ${peak24.toFixed(1)}%`);
    if (peak24 < 20) {
      await expect(ruleLabel(heroViz(page), "20% Elevated")).toHaveCount(0);
      await expect(ruleLabel(heroViz(page), "40% High Risk")).toHaveCount(0);
    }

    await full.click();
    await expect(full).toHaveAttribute("aria-pressed", "true");
    await expect(short).toHaveAttribute("aria-pressed", "false");
    await expect(legendRange(heroViz(page))).toHaveText(`${fmtDate(day(series[0].date))} → ${fmtDate(last)}`, { timeout: 15_000 });
    await expect(heroViz(page)).toContainText(`monthly since ${fmtMonYr(day(series[0].date))}`);
    await expect(ruleLabel(heroViz(page), "20% Elevated")).toBeVisible();
    await expect(ruleLabel(heroViz(page), "40% High Risk")).toBeVisible();
    note("window-full", `${fmtMonYr(day(series[0].date))} → ${fmtMonYr(last)} (${series.length} months)`);
    if (day(series[0].date).startsWith("2003-04")) expect(fmtMonYr(day(series[0].date))).toBe("Apr 2003");
    await settle(page, 600);
    await capture(page, "recession--full-history.png", hero(page));

    await short.click();
    await expect(short).toHaveAttribute("aria-pressed", "true");
    await expect(legendRange(heroViz(page))).toHaveText(`${fmtDate(first24)} → ${fmtDate(last)}`, { timeout: 15_000 });
    if (peak24 < 20) {
      await expect(ruleLabel(heroViz(page), "20% Elevated")).toHaveCount(0);
      await expect(ruleLabel(heroViz(page), "40% High Risk")).toHaveCount(0);
    }
  });

  test("6. summary: the seven dt labels in C.2 order, the strip is a link to #model whose title agrees with the recomputed streak, and clicking it scrolls #model into view", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const dts = summary(page).locator("dt");
    const expected = SUMMARY_LABELS.filter((l) => l !== "Curve 2s10s" || m.yield_curve_spread != null);
    await expect.poll(() => dts.count(), { timeout: 30_000 }).toBe(expected.length);
    await settle(page, 600);
    expect((await dts.allTextContents()).map(clean)).toEqual(expected);
    await expect(summary(page).locator("h2")).toHaveText(/^Model summary$/i);
    for (const dd of await summary(page).locator("dd").all()) expect(clean(await dd.innerText())).not.toBe("");
    await expect(summary(page)).toContainText("2s10s < 0 · HY > 400 bps · unemployment +0.3 pp in 3m");
    await expect(summary(page)).toContainText("desk reference");
    await expect(summary(page)).toContainText("classifier", { timeout: 30_000 });

    const strip = summary(page).locator('a[href="/app/recession#model"]');
    await expect(strip).toHaveCount(1);
    await expect(strip).toHaveClass(/mrr-status/);
    const title = await contentText(strip.locator(".mrr-status-title"));
    expect(title).toMatch(STRIP_TITLE);
    expect(await strip.getAttribute("aria-label")).toMatch(new RegExp(`^${escapeRe(title)}\\. .+\\. Opens the model inputs\\.$`));
    // G16: recompute the streak from the served series and accept whichever state matches.
    const series = m.recession_prob_series;
    const i = headlineIndex(series, m.recession_prob);
    const streak = i >= 0 ? riseStreak(series, i) : 0;
    const tone = (await strip.getAttribute("data-tone")) ?? "";
    const detail = await contentText(strip.locator("small"));
    note("strip", `${title} · ${detail} · tone ${tone} · recomputed streak ${streak} on ${i >= 0 ? day(series[i].date) : "no point"}`);
    if (streak >= 3) {
      expect(title).toBe(`Watch · ${streak} straight rises`);
      expect(tone).toBe("amber");
      expect(detail).toBe(`Probability up each month since ${fmtMonYr(day(series[i - streak].date))} · ${series[i - streak].value.toFixed(1)}% → ${series[i].value.toFixed(1)}%`);
    } else {
      expect(title).toBe("No consecutive rises");
      expect(tone).toBe("mint");
      if (i >= 3) expect(detail).toMatch(/^[+-]?\d+\.\d pts vs 3 months ago · [A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4}$/);
      else expect(detail).toBe("Fewer than four stored months on file");
    }
    await expect(strip).toHaveClass(new RegExp(`mrr-status-${tone}`));

    await strip.click();
    await expect(page).toHaveURL(/\/app\/recession#model$/);
    await expect.poll(() => inView(page, "model"), { timeout: 15_000 }).toBe(true);
  });

  test("7. model inputs: five article cards with h3 names, the curve badge Inverted iff is_inverted, MODEL INPUT on the rest, no svg, no Trips / Push on odds, Series notes → lands on Methodology #models", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const cards = model(page).locator("article");
    await expect(cards).toHaveCount(5, { timeout: 30_000 });
    expect((await cards.locator("h3").allTextContents()).map(clean)).toEqual(CARD_NAMES);
    await expect(model(page).locator("h2")).toHaveText(/^Model inputs$/i);
    expect(await model(page).locator("article svg").count()).toBe(0);
    for (let i = 0; i < 5; i++) {
      const card = cards.nth(i);
      const badge = clean((await card.locator("span[data-tone]").first().textContent()) ?? "");
      const expectedBadge = i === 0 ? (m.is_inverted ? "Inverted" : "Upward") : "Model input";
      // Tag text is uppercase by CSS: compare the source word case-insensitively.
      expect(lower(badge), `${CARD_NAMES[i]} badge`).toBe(lower(expectedBadge));
      const text = await visibleText(card);
      expect(text).toContain("Inputs through");
      expect(text).toMatch(/log-odds per σ · (?:raises|lowers) odds as it rises|Not stored/);
      note(`card-${i + 1}`, `${CARD_NAMES[i]} · ${badge}`);
    }
    const mainText = await visibleText(page.locator("main"));
    expect(mainText).not.toContain("Trips");
    expect(mainText).not.toContain("Push on odds");
    expect(mainText).not.toContain("Threshold proximity");
    expect(mainText).not.toContain("Last alert");
    await model(page).getByRole("link", { name: /Series notes/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#models$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "models"), { timeout: 15_000 }).toBe(true);
  });

  test("8. curve monitor: the chart with the Inversion below 0 label, 30Y pressed, 5Y / 10Y / 30Y move the legend's first date forward and back, the tile lists the stored tenors and the missing six, no year-ago text", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    const series = m.yield_curve_series;
    expect(series.length, "yield_curve_series").toBeGreaterThan(24);
    const last = day(series[series.length - 1].date);
    await expect(curve(page).locator("svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    await expect(curve(page).locator("h2")).toHaveText(/^Curve monitor$/i);
    const values = series.map((p) => p.value);
    const crossesZero = Math.min(...values) < 0 && Math.max(...values) > 0;
    note("zero-crossing", crossesZero ? "the 30-year window crosses zero: the Inversion below 0 label renders" : "the served window never crosses zero: no zero rule to label");
    if (crossesZero) await expect(ruleLabel(curve(page), "Inversion below 0")).toBeVisible();
    await expect(curve(page)).toContainText("Below the dashed zero line the curve is inverted");

    const group = curve(page).getByRole("group", { name: "Curve window" });
    await expect(group).toHaveCount(1);
    const fiveY = group.getByRole("button", { name: "5Y", exact: true });
    const tenY = group.getByRole("button", { name: "10Y", exact: true });
    const thirtyY = group.getByRole("button", { name: "30Y", exact: true });
    await expect(thirtyY).toHaveAttribute("aria-pressed", "true");
    await expect(legendRange(curve(page))).toHaveText(`${fmtDate(day(series[0].date))} → ${fmtDate(last)}`);
    const start5 = windowStart(series, 5);
    const start10 = windowStart(series, 10);
    expect(start5 >= start10 && start10 >= day(series[0].date)).toBe(true);

    await fiveY.click();
    await expect(fiveY).toHaveAttribute("aria-pressed", "true");
    await expect(legendRange(curve(page))).toHaveText(`${fmtDate(start5)} → ${fmtDate(last)}`, { timeout: 15_000 });
    expect(await curve(page).locator("svg[role='img']").getAttribute("aria-label")).toContain("5-year history");
    await settle(page, 400);
    await capture(page, "recession--curve-5y.png", curve(page));
    await tenY.click();
    await expect(tenY).toHaveAttribute("aria-pressed", "true");
    await expect(legendRange(curve(page))).toHaveText(`${fmtDate(start10)} → ${fmtDate(last)}`, { timeout: 15_000 });
    expect(await curve(page).locator("svg[role='img']").getAttribute("aria-label")).toContain("10-year history");
    await thirtyY.click();
    await expect(thirtyY).toHaveAttribute("aria-pressed", "true");
    await expect(legendRange(curve(page))).toHaveText(`${fmtDate(day(series[0].date))} → ${fmtDate(last)}`, { timeout: 15_000 });
    expect(await curve(page).locator("svg[role='img']").getAttribute("aria-label")).toContain("30-year history");
    note("curve-windows", `5Y from ${fmtMonYr(start5)} · 10Y from ${fmtMonYr(start10)} · 30Y from ${fmtMonYr(day(series[0].date))}`);

    const curveText = await visibleText(curve(page));
    expect(lower(curveText)).toContain("current curve shape");
    const stored = TENOR_ORDER.filter((t) => m.curve_shape[t] != null);
    const missing = TENOR_ORDER.filter((t) => m.curve_shape[t] == null);
    for (const t of stored) {
      expect(curveText, `tenor ${t}`).toContain(t);
      expect(curveText, `tenor ${t} level`).toContain(`${(m.curve_shape[t] as number).toFixed(2)}%`);
    }
    if (missing.length) expect(curveText).toContain(`Not stored: ${missing.join(" · ")}.`);
    note("curve-shape", `stored ${stored.join(", ") || "none"} · missing ${missing.join(", ") || "none"}`);
    expect(lower(curveText)).not.toContain("year ago");
    expect(curveText).not.toContain("Bear steepener");
  });

  test("9. sensitivity starts collapsed, expands, a slider rescores and Reset restores it (P7 check 3); #sensitivity loads open on the hash route", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await expect(sensitivity(page)).toHaveCount(1, { timeout: 30_000 });
    await expect(sensButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main input[type='range']")).toHaveCount(0);
    await sensButton(page).scrollIntoViewIfNeeded();

    const firstPost = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/recession\/scenario$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
    await sensButton(page).click();
    await expect(sensButton(page)).toHaveAttribute("aria-expanded", "true");
    const ranges = page.locator("main input[type='range']");
    await expect(ranges).toHaveCount(5);
    await expect(page.locator("main .mrr-slider-tick")).toHaveCount(5);
    await expect(page.locator("main .mrr-slider-row")).toHaveCount(5);
    for (const row of await page.locator("main .mrr-slider-row").all()) expect(await row.getAttribute("data-changed")).toBe("false");
    expect((await firstPost).status(), "POST /api/recession/scenario").toBe(200);
    await expect(displayNumber(page)).toBeVisible({ timeout: 30_000 });
    const family = await displayNumber(page).evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Source Serif 4"?/);
    const first = await visibleText(displayNumber(page));
    expect(first).toMatch(DISPLAY_NUMBER);
    const badge = await contentText(sensitivity(page).locator("span[data-tone]").first());
    expect(LABELS, `scenario badge ${badge}`).toContain(badge);
    await expect(sensitivity(page)).toContainText(/live model estimate · inputs unchanged/i);
    await expect(resetButton(page)).toBeDisabled();
    note("scenario-seeded", `${first} · ${badge}`);
    await settle(page, 400);
    await capture(page, "recession--sensitivity-open.png", sensitivity(page));

    // A real key on the Unemployment rate range: one step up.
    const row = sliderRow(page, "Unemployment rate");
    await expect(row).toHaveCount(1);
    const range = row.locator("input[type='range']");
    await range.focus();
    await expect(range).toBeFocused();
    const secondPost = page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/recession\/scenario$/.test(new URL(r.url()).pathname), { timeout: 30_000 });
    await page.keyboard.press("ArrowRight");
    await expect(row).toHaveAttribute("data-changed", "true");
    expect(await row.locator("input[type='number']").evaluate((el) => (el as HTMLElement).style.color)).toBe("var(--amber)");
    expect(await row.locator(".mrr-slider-fill").evaluate((el) => (el as HTMLElement).style.background)).toContain("var(--amber)");
    await expect(row).toContainText("│ current reading");
    await expect(sensitivity(page)).toContainText(/your adjusted probability/i);
    await expect(sensitivity(page)).toContainText(/model inputs · modified by you/i);
    expect((await secondPost).status(), "second POST /api/recession/scenario").toBe(200);
    await expect.poll(() => visibleText(displayNumber(page)), { timeout: 30_000, message: "the number changes after one step" }).not.toBe(first);
    const changed = await visibleText(displayNumber(page));
    note("scenario-changed", `${first} → ${changed} after ArrowRight on Unemployment rate`);
    await expect(resetButton(page)).toBeEnabled();
    await settle(page, 400);
    await capture(page, "recession--sensitivity-changed.png", sensitivity(page));

    await resetButton(page).click();
    for (const r of await page.locator("main .mrr-slider-row").all()) await expect(r).toHaveAttribute("data-changed", "false");
    await expect(sensitivity(page)).toContainText(/live model estimate · inputs unchanged/i);
    await expect(sensitivity(page)).not.toContainText(/your adjusted probability/i);
    await expect.poll(() => visibleText(displayNumber(page)), { timeout: 30_000 }).toBe(first);
    await expect(resetButton(page)).toBeDisabled();
    expect(await visibleText(page.locator("main"))).not.toContain("Where the change came from");

    await page.goto(`${ROUTE}#sensitivity`, { waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await awaitHero(page);
    await expect(sensButton(page)).toHaveAttribute("aria-expanded", "true", { timeout: 30_000 });
    await expect(page.locator("main input[type='range']")).toHaveCount(5);
    await expect.poll(() => inView(page, "sensitivity"), { timeout: 15_000 }).toBe(true);
  });

  test("10. the macro vs markets tile renders (P7 check 4): the served label and score, the marker at 50 + score / 2 percent, the scale words, the coefficient rows by magnitude, the six-row model card, Methodology → lands on #models", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const m = await served(page);
    await expect(transparency(page).locator("h2")).toHaveText(/^Model transparency$/i);
    const text = await visibleText(transparency(page));
    expect(lower(text)).toContain("macro vs markets");
    expect(text).toContain("on a ±100 scale");
    expect(text).toContain("±20 material");
    expect(text).toContain("Macro more worried");
    expect(text).toContain("Markets more worried");
    const caption = transparency(page).getByText(/credit-market pricing \(HY percentile\)/);
    await expect(caption).toHaveCount(1);
    expect((await visibleText(caption)).startsWith(m.divergence_label), `caption starts with ${m.divergence_label}`).toBe(true);
    if (m.divergence_score != null) {
      const score = m.divergence_score;
      expect(text).toContain(fmtSigned(score, 0));
      const marker = transparency(page).locator(`[title="${fmtSigned(score, 0)} on ±100"]`);
      await expect(marker).toHaveCount(1);
      const left = parseFloat((await marker.evaluate((el) => (el as HTMLElement).style.left)) || "NaN");
      expect(left).toBeCloseTo(clamp(50 + score / 2, 0, 100), 1);
      note("divergence", `${m.divergence_label} · ${fmtSigned(score, 0)} · marker at ${left}%`);
    } else {
      expect(await transparency(page).locator("[title$='on ±100']").count()).toBe(0);
      note("divergence", `${m.divergence_label} · no score served: dash placeholder, no marker`);
    }

    const coefs = Object.entries(m.feature_coefficients).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const signed = (await transparency(page).getByText(/^[+-]?\d+\.\d\d$/).allTextContents()).map(clean);
    expect(signed, "one signed coefficient per served feature").toHaveLength(coefs.length);
    expect(signed[0]).toBe(fmtSigned(coefs[0][1], 2));
    expect(signed).toEqual(coefs.map(([, c]) => fmtSigned(c, 2)));
    expect(text).toContain("lowers odds · raises odds");
    expect(text).toContain("Red bars raise recession odds as they rise; mint bars lower them.");
    note("coefficients", coefs.map(([k, c]) => `${k} ${fmtSigned(c, 2)}`).join(" · "));

    await expect(transparency(page).locator("dl dt")).toHaveCount(6);
    expect((await transparency(page).locator("dl dt").allTextContents()).map(clean)).toEqual(["Estimator", "Training target", "Training samples", "Features", "Look-ahead guard", "Inputs through"]);
    expect(text).not.toContain("Last refit");
    await transparency(page).getByRole("link", { name: /Methodology/ }).click();
    await expect(page).toHaveURL(/\/app\/methodology#models$/);
    await settle(page, 900);
    await expect.poll(() => inView(page, "models"), { timeout: 15_000 }).toBe(true);
  });

  test("11. hero buttons: Stress the inputs scrolls the collapsed #sensitivity row into view (G2); back; Read the model card scrolls #transparency into view", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const stress = hero(page).getByRole("link", { name: /Stress the inputs/ });
    const read = hero(page).getByRole("link", { name: /Read the model card/ });
    await expect(stress).toHaveClass(/mrr-hero-btn-primary/);
    await expect(read).toHaveClass(/mrr-hero-btn-ghost/);
    await stress.click();
    await expect(page).toHaveURL(/\/app\/recession#sensitivity$/);
    await expect.poll(() => inView(page, "sensitivity"), { timeout: 15_000 }).toBe(true);
    await expect(sensButton(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main input[type='range']")).toHaveCount(0);
    note("sensitivity-top", `${Math.round(await topOf(page, "sensitivity"))} px from the viewport top after the primary click`);

    await page.goBack();
    await settle(page, 600);
    await expect(page).toHaveURL(/\/app\/recession$/);
    await awaitHero(page);
    await hero(page).getByRole("link", { name: /Read the model card/ }).click();
    await expect(page).toHaveURL(/\/app\/recession#transparency$/);
    await expect.poll(() => inView(page, "transparency"), { timeout: 15_000 }).toBe(true);
    await expect
      .poll(() => topOf(page, "transparency"), { timeout: 15_000, message: "the section lands at the top of the viewport (a sticky header may offset it)" })
      .toBeLessThanOrEqual(160);
  });

  test("12. footer: the DisclosureLine paragraph is the last element in main and names the in-process training", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    const lastIsLine = await page.evaluate(() => {
      const main = document.querySelector("main");
      const line = main?.querySelector("p.mrr-disclosure-line");
      if (!main || !line) return false;
      const all = main.querySelectorAll("*");
      return all[all.length - 1] === line;
    });
    expect(lastIsLine).toBe(true);
    const line = page.locator("main p.mrr-disclosure-line");
    await expect(line).toHaveCount(1);
    await expect(line).toContainText("no saved artifact");
    await expect(line).toContainText("A statistical estimate, not a forecast of any specific date");
    await expect(line).toContainText("Recession Risk odds in the header.");
  });

  test("16. at 390 px the hero stacks over the summary, the gauge fills the column, the five cards go one per row, the opened sensitivity grid stacks and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await awaitHero(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    await awaitSummary(page);
    await expect(model(page).locator("article")).toHaveCount(5, { timeout: 30_000 });
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      return {
        hero: box("#recession-hero"),
        summary: box("#recession-summary"),
        viz: box("#recession-hero .mrr-hero-viz"),
        gauge: box("#recession-hero svg[aria-label^='Recession probability gauge']"),
        cards: [...document.querySelectorAll("#model article")].map((a) => a.getBoundingClientRect()),
        transparency: box("#transparency"),
        sensitivity: box("#sensitivity"),
      };
    });
    for (const k of ["hero", "summary", "viz", "gauge", "transparency", "sensitivity"] as const) expect(boxes[k], k).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    // The gauge fills its column (max-width 360 is wider than the column at 390).
    expect((boxes.gauge as DOMRect).width).toBeGreaterThanOrEqual((boxes.viz as DOMRect).width * 0.85);
    expect((boxes.gauge as DOMRect).width).toBeLessThanOrEqual(360.5);
    // One card per row: equal left edges, each below the last.
    expect(boxes.cards).toHaveLength(5);
    for (let i = 1; i < boxes.cards.length; i++) {
      expect(Math.abs(boxes.cards[i].left - boxes.cards[0].left), `card ${i + 1} left edge`).toBeLessThan(2);
      expect(boxes.cards[i].top, `card ${i + 1} below card ${i}`).toBeGreaterThanOrEqual(boxes.cards[i - 1].bottom - 1);
    }
    // The bottom row stacks: Model transparency under the Sensitivity panel.
    expect((boxes.transparency as DOMRect).top).toBeGreaterThanOrEqual((boxes.sensitivity as DOMRect).bottom - 1);

    await sensButton(page).scrollIntoViewIfNeeded();
    await sensButton(page).click();
    await expect(page.locator("main input[type='range']")).toHaveCount(5);
    await expect(sensitivity(page)).toContainText(/live model estimate · inputs unchanged/i);
    const stacked = await page.evaluate(() => {
      const reset = [...document.querySelectorAll("#sensitivity button")].find((b) => /Reset to current readings/.test(b.textContent ?? ""));
      const eyebrow = [...document.querySelectorAll("#sensitivity div")].find((d) => /live model estimate/i.test(d.textContent ?? "") && !d.querySelector("div"));
      if (!reset || !eyebrow) return null;
      return { resetBottom: reset.getBoundingClientRect().bottom, eyebrowTop: eyebrow.getBoundingClientRect().top };
    });
    expect(stacked, "the reset button and the result eyebrow").not.toBeNull();
    expect((stacked as { resetBottom: number; eyebrowTop: number }).eyebrowTop).toBeGreaterThanOrEqual((stacked as { resetBottom: number; eyebrowTop: number }).resetBottom - 1);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "recession--390.png");
  });

  test("17. captures: the full page at 1672 for the region-by-region compare with recession.png", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await expect(hero(page).locator("svg[role='img']")).toHaveCount(2, { timeout: 30_000 });
    await expect(model(page).locator("article")).toHaveCount(5, { timeout: 30_000 });
    await expect(curve(page).locator("svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    await expect(transparency(page)).toContainText(/model card/i, { timeout: 30_000 });
    await expect(sensButton(page)).toHaveAttribute("aria-expanded", "false");
    await settle(page, 1200);
    await capture(page, "recession.png");
    expect(fs.existsSync(path.join(DOCS, "recession.png")), "the approved mockup the verifier compares against").toBe(true);
  });
});
