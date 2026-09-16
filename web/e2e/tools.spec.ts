/**
 * Phase 9 checklist (docs/redesign-v2/checklists/09-tools.md) section E.3:
 * the P9 browser check on /app/tools, steps 1 to 13, 16 and 17, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks and real
 * keys only; the assistant panel is never opened, typed into or sent from.
 * Captures land in docs/redesign-v2/captures/redesign-09-tools/ (CAPTURE_DIR
 * overrides). Steps 14 and 15 are the existing sections, parity and regression
 * specs, run separately. Where an assertion depends on what the DB serves on
 * verify day (the live rate, the default deal's figures, the optimizer being
 * null on the local snapshot, the leading asset), the served payload is read
 * from the API first, the B rules are recomputed locally, and the outcome is
 * recorded as a test annotation. A cold /api/allocation can take up to a
 * minute on a fresh uvicorn: every allocation wait carries that budget.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-09-tools");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/tools";
const ALLOCATION_TIMEOUT = 120_000; // a cold /api/allocation downloads ~24 years of returns

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ci = (s: string) => new RegExp(`^${escapeRe(s)}$`, "i"); // Segmented and Tag labels are CSS-uppercased; names match case-insensitively

/** The default deal (web/src/screens/tools/lbo-deal.ts BASE_INPUTS), copied so the spec never imports src (import.meta.env is not defined under node). */
const BASE_INPUTS = { ebitda: 100, ebitda_growth_rate: 5, entry_multiple: 8, exit_multiple: 9, hold_period: 5, leverage_ratio: 4.5, amortization_rate: 5, mgmt_fee_pct: 1.5 };
const clampRate = (v: number) => Math.min(20, Math.max(3, v));
const SUMMARY_LABELS = ["Fed funds", "HY OAS", "All-in rate", "Financing", "Structure", "Equity check", "Credit state"];
const ALLOCATION_LABELS = ["Sample", "Risk-free", "Optimizer"];
const SCHEDULE_TH = ["Year", "EBITDA", "Implied EV", "Debt start", "Interest", "Paydown", "Debt end", "Leverage"];
const METHOD_LABELS = ["Mean-Variance", "Min Variance", "Risk Parity", "Black-Litterman", "HRP", "Min CVaR", "HERC"];
const METHOD_KEYS = ["mvo", "min_var", "risk_parity", "black_litterman", "hrp", "cvar", "herc"];
const IRR_H1 = /^\d+\.\d% IRR$/;
const MOIC_PILL = /^\d\.\d\d× MOIC$/;
const LENSES: { name: string; slug: string; note: RegExp }[] = [
  { name: "Tail risk", slug: "tail", note: /Portfolio CVaR weights the assets by an optimizer solution/ },
  { name: "Drawdowns", slug: "drawdowns", note: /Drawdown history unavailable in this payload\./ },
  { name: "Correlation", slug: "correlation", note: /Not enough months in this regime for a stable matrix\./ },
  { name: "Factors", slug: "factors", note: /Portfolio betas are regressed on the optimizer weights/ },
  { name: "Style", slug: "style", note: /Style history unavailable for this regime/ },
  { name: "Transition P&L", slug: "transitions", note: /No regime switch has repeated often enough to average/ },
  { name: "Currency", slug: "currency", note: /Currency history unavailable from the vendor this session\./ },
  { name: "Real vs nominal", slug: "real", note: /Real-vs-nominal splits unavailable|No inflation-adjusted view for this regime\./ },
];

interface LboDefaults {
  fedfunds: number;
  hy_oas_pct: number;
  lbo_all_in_rate: number;
  data_as_of: string;
}
interface LboResult {
  entry_equity: number;
  exit_equity: number | null;
  exit_debt: number | null;
  irr: number | null;
  moic: number | null;
  viable: boolean;
  schedule: { year: number }[];
}
interface Optimization {
  converged?: boolean;
  method?: string;
}
interface AllocationData {
  current_regime: string;
  regime_stats: Record<string, { mean: Record<string, number | null> }>;
  optimizations: (Record<string, Optimization | unknown> & { asset_names?: string[] }) | null;
  optimizations_skipped?: { complete_months: number; total_regime_months: number; required_cov_months: number } | null;
}

/* ── page helpers ─────────────────────────────────────────────────────────── */

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const hero = (page: Page) => page.locator("#lbo-hero");
const summary = (page: Page) => page.locator("#lbo-summary");
const assumptions = (page: Page) => page.locator("#lbo-assumptions");
const outputs = (page: Page) => page.locator("#lbo-outputs");
const schedule = (page: Page) => page.locator("#lbo-schedule");
const sensitivity = (page: Page) => page.locator("#lbo-sensitivity");
const allocHero = (page: Page) => page.locator("#allocation-hero");
const allocSummary = (page: Page) => page.locator("#allocation-summary");
const optimization = (page: Page) => page.locator("#allocation-optimization");
const risk = (page: Page) => page.locator("#allocation-risk");
const strip = (page: Page) => summary(page).locator('button[aria-haspopup="dialog"]');
const tab = (page: Page, name: string) => page.getByRole("tab", { name: new RegExp(`^${escapeRe(name)}`, "i") });
const rangeOf = (page: Page, label: string) => page.getByRole("slider", { name: label, exact: true });
const rowOf = (page: Page, label: string) => page.locator("main .mrr-slider-row").filter({ has: rangeOf(page, label) });
const typedOf = (page: Page, label: string) => page.getByRole("spinbutton", { name: `${label} (typed)`, exact: true });
const resetButton = (page: Page) => assumptions(page).getByRole("button", { name: "Reset to defaults" });
const rateSwitch = (page: Page) => assumptions(page).getByRole("switch", { name: "Track the live financing rate" });
const seg = (page: Page, root: Locator, label: string) => root.locator(`.mrr-seg[aria-label="${label}"]`);
const segOption = (page: Page, root: Locator, group: string, name: string) => seg(page, root, group).getByRole("button", { name: ci(name) });
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
/** innerText of a locator (hidden panels excluded, CSS text-transform applied), whitespace collapsed. */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}
/** textContent of a locator (no text-transform), whitespace collapsed. */
async function contentText(loc: Locator): Promise<string> {
  return clean((await loc.textContent()) ?? "");
}
/** The StatTile value under a label inside #lbo-outputs (the label div's next sibling). */
async function tileValue(page: Page, label: string): Promise<string> {
  return page.evaluate((l) => {
    const root = document.getElementById("lbo-outputs");
    if (!root) return "";
    const labels = [...root.querySelectorAll("div")].filter((d) => (d.textContent ?? "").trim() === l && d.nextElementSibling);
    return (labels[0]?.nextElementSibling?.textContent ?? "").replace(/\s+/g, " ").trim();
  }, label);
}
/** The one outlined IRR cell: its text and its row / column header labels. */
async function outlinedCell(page: Page): Promise<{ text: string; row: string; col: string; count: number }> {
  return page.evaluate(() => {
    const grid = document.querySelector('#lbo-sensitivity [role="table"]');
    if (!grid) return { text: "", row: "", col: "", count: 0 };
    const cols = [...grid.querySelectorAll('[role="columnheader"]')].slice(1).map((c) => (c.textContent ?? "").trim());
    const rows = [...grid.querySelectorAll('[role="rowheader"]')].map((r) => (r.textContent ?? "").trim());
    const cells = [...grid.querySelectorAll<HTMLElement>('[role="cell"]')];
    const hits = cells.map((c, i) => ({ c, i })).filter(({ c }) => c.style.outlineWidth === "1.5px");
    if (hits.length !== 1) return { text: "", row: "", col: "", count: hits.length };
    const { c, i } = hits[0];
    return { text: (c.textContent ?? "").trim(), row: rows[Math.floor(i / cols.length)] ?? "", col: cols[i % cols.length] ?? "", count: 1 };
  });
}
/** The stored-through date printed in a text ("stored through Sep 01, 2026"). */
const storedThrough = (s: string) => /[Ss]tored through ([A-Z][a-z]{2} \d\d, \d{4})/.exec(s)?.[1] ?? "";

async function servedDefaults(page: Page): Promise<LboDefaults> {
  const r = await page.request.get("/api/lbo/defaults");
  expect(r.status(), "/api/lbo/defaults").toBe(200);
  return (await r.json()) as LboDefaults;
}
async function servedRun(page: Page, req: Record<string, number>): Promise<LboResult> {
  const r = await page.request.post("/api/lbo/run", { data: req });
  expect(r.status(), "POST /api/lbo/run").toBe(200);
  return ((await r.json()) as { result: LboResult }).result;
}
async function servedAllocation(page: Page): Promise<AllocationData> {
  const r = await page.request.get("/api/allocation", { timeout: ALLOCATION_TIMEOUT });
  expect(r.status(), "/api/allocation").toBe(200);
  return (await r.json()) as AllocationData;
}
/** The default deal at the served live rate, clamped to the model range (B.1). */
async function defaultDeal(page: Page): Promise<{ defaults: LboDefaults; result: LboResult }> {
  const defaults = await servedDefaults(page);
  const result = await servedRun(page, { ...BASE_INPUTS, interest_rate: clampRate(defaults.lbo_all_in_rate) });
  return { defaults, result };
}
async function awaitLbo(page: Page): Promise<void> {
  await expect(page.locator("main h1")).toHaveText(IRR_H1, { timeout: 60_000 });
  await expect(schedule(page)).toHaveCount(1, { timeout: 60_000 });
  await expect(sensitivity(page)).toHaveCount(1, { timeout: 60_000 });
}
async function awaitAllocation(page: Page): Promise<void> {
  await expect(allocHero(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#allocation-overview [role='table']")).toHaveCount(1, { timeout: ALLOCATION_TIMEOUT });
  await expect(page.locator("main h1")).not.toHaveText(/Building the return history|IRR$/, { timeout: ALLOCATION_TIMEOUT });
  await expect.poll(() => allocSummary(page).locator("dt").count(), { timeout: 30_000 }).toBe(3);
}
/** A POST /api/lbo/run whose body satisfies `match` (the debounce may coalesce several key presses into one). */
const awaitRun = (page: Page, match: (body: Record<string, number>) => boolean) =>
  page.waitForResponse(
    (r) => {
      if (r.request().method() !== "POST" || !/\/api\/lbo\/run$/.test(new URL(r.url()).pathname)) return false;
      try {
        return match(JSON.parse(r.request().postData() ?? "{}") as Record<string, number>);
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
async function pressArrowRight(page: Page, label: string, times: number): Promise<void> {
  const range = rangeOf(page, label);
  await range.scrollIntoViewIfNeeded();
  await range.focus();
  await expect(range).toBeFocused();
  for (let i = 0; i < times; i++) await page.keyboard.press("ArrowRight");
}

async function capture(page: Page, file: string, target?: Locator, fullPage = true): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("tools (checklist 09 E.3)", () => {
  test("1. branch and stamp: the dev build stamp names the checked-out branch and commit; one uvicorn, one Vite, the API answering", async ({ page }) => {
    await open(page);
    const stamp = await page.locator('meta[name="mrr-build"]').getAttribute("content");
    expect(stamp).toBe(`${git("rev-parse --abbrev-ref HEAD")}@${git("rev-parse --short=7 HEAD")}`);
    expect(stamp?.startsWith(`${BRANCH}@`), `stamp ${stamp} is not on ${BRANCH}: restart Vite after the branch cut`).toBe(true);
    // A second local uvicorn is the known "422 Symbols limit reached" problem (CC_PROMPT); tolerate a remote host (0).
    // Count the server processes only: lines whose command starts with a Python
    // binary. The desktop app's launcher wrapper and any shell that merely
    // mentions the command line carry the same text.
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
    for (const url of ["/api/lbo/defaults", "/api/credit/metrics"]) expect((await page.request.get(url)).status(), url).toBe(200);
    const { defaults, result } = await defaultDeal(page);
    note("defaults", `live ${defaults.lbo_all_in_rate.toFixed(2)}% = Fed Funds ${defaults.fedfunds.toFixed(2)}% + HY ${defaults.hy_oas_pct.toFixed(2)}%, stored through ${defaults.data_as_of}`);
    note("default-deal", result.viable ? `${result.irr?.toFixed(1)}% IRR · ${result.moic?.toFixed(2)}× MOIC` : "not viable on verify day");
    const allocation = await servedAllocation(page);
    note("allocation", `${allocation.current_regime}; optimizer ${allocation.optimizations ? "served" : "null"}`);
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses on the route, its hash routes and the Allocation sub-tab", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    await awaitLbo(page);
    for (const hash of ["#lbo", "#lbo-assumptions", "#lbo-sensitivity"]) {
      await open(page, `${ROUTE}${hash}`);
      await awaitLbo(page);
    }
    for (const hash of ["#allocation", "#allocation-risk", "#allocation-optimization"]) {
      await open(page, `${ROUTE}${hash}`);
      await awaitAllocation(page);
    }
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.tools?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero (LBO): one serif h1 equal to the served default deal's IRR, the MOIC pill, the h2 naming the served live rate, the lede, and the six-bar bridge with the entry and exit equity labels", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    expect(await hero(page).locator("h1").count()).toBe(1);
    const { defaults, result } = await defaultDeal(page);
    expect(result.viable, "the default deal is viable at the served rate").toBe(true);
    const h1Text = await contentText(h1);
    expect(h1Text).toMatch(IRR_H1);
    expect(h1Text).toBe(`${(result.irr as number).toFixed(1)}% IRR`);
    note("h1", h1Text);
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.replace(/^["']/, "")).toMatch(/^Source Serif 4/);
    const pill = hero(page).locator(".mrr-pill");
    await expect(pill).toHaveCount(1);
    const pillText = await contentText(pill);
    expect(pillText).toMatch(MOIC_PILL);
    expect(pillText).toBe(`${(result.moic as number).toFixed(2)}× MOIC`);
    const irr = result.irr as number;
    await expect(pill).toHaveAttribute("data-tone", irr >= 20 ? "mint" : irr >= 15 ? "amber" : "gray");
    await expect(hero(page).locator(".mrr-hero-eyebrow")).toContainText(/LBO calculator/i);
    const h2 = await contentText(hero(page).locator("h2"));
    expect(h2).toBe(`The default deal at today's ${clampRate(defaults.lbo_all_in_rate).toFixed(2)}% all-in rate.`);
    expect(await contentText(page.locator("main h2").first())).toContain(clampRate(defaults.lbo_all_in_rate).toFixed(2));
    const lede = await contentText(hero(page).locator(".mrr-hero-lede"));
    expect(lede.startsWith("A $100M EBITDA business bought at 8.00× with 4.50× leverage, growing 5.0% a year and exiting at 9.00× after 5 years.")).toBe(true);
    expect(lede).toContain("20% IRR");
    expect(lede).not.toContain("50 bp");
    const foot = await contentText(hero(page).locator(".mrr-hero-foot"));
    expect(foot).toContain(irr >= 20 ? "Clears the 20% PE bar" : irr >= 15 ? "Below the 20% bar · above 15%" : "Below 15%");
    await expect(hero(page).locator('.mrr-hero-chips span[title^="Financing rate"]')).toHaveCount(1);
    await expect(hero(page).locator(".mrr-hero-note")).toHaveCount(0);
    const svg = hero(page).locator('svg[role="img"]');
    await expect(svg).toHaveCount(1);
    await expect(svg).toHaveAttribute("aria-label", "Equity value bridge from entry to exit");
    await expect(svg.locator("rect")).toHaveCount(6);
    const labels = (await svg.locator("text").allTextContents()).map(clean);
    expect(labels, "entry equity label").toContain(String(Math.round(result.entry_equity)));
    expect(labels, "exit equity label").toContain(String(Math.round(result.exit_equity as number)));
    expect(await contentText(hero(page))).not.toContain("—");
  });

  test("4. hero buttons: Adjust assumptions scrolls #lbo-assumptions to the top; View financing conditions lands on /app/credit#financing; back", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    const adjust = hero(page).getByRole("link", { name: "Adjust assumptions" });
    await expect(adjust).toHaveAttribute("href", "/app/tools#lbo-assumptions");
    await adjust.click();
    await expect(page).toHaveURL(/\/app\/tools#lbo-assumptions$/);
    await expect.poll(() => inView(page, "lbo-assumptions"), { timeout: 15_000 }).toBe(true);
    // useHashScroll re-runs once the deal run settles, so the final position lands
    // asynchronously on a cold context: poll it rather than read it once.
    await expect
      .poll(() => page.evaluate(() => document.getElementById("lbo-assumptions")?.getBoundingClientRect().top ?? Number.NaN), { timeout: 15_000, message: "the assumptions panel sits at the top of the viewport" })
      .toBeLessThan(160);
    await page.evaluate(() => window.scrollTo(0, 0));
    const financing = hero(page).getByRole("link", { name: "View financing conditions" });
    await expect(financing).toHaveAttribute("href", "/app/credit#financing");
    await financing.click();
    await expect(page).toHaveURL(/\/app\/credit#financing$/);
    await expect.poll(() => inView(page, "financing"), { timeout: 30_000 }).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/tools/);
    await awaitLbo(page);
  });

  test("5. summary: the seven dt labels at rest with no Vs base case, the FRED strip opens the freshness drawer, Esc closes it and returns focus, the strip's stamp equals the tile caption's, Credit state lands on /app/credit#financing", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(SUMMARY_LABELS.length);
    const labels = (await summary(page).locator("dt").allTextContents()).map(clean);
    expect(labels).toEqual(SUMMARY_LABELS);
    await expect(summary(page).locator("h2")).toHaveText(/^Live financing$/i);
    for (const dd of await summary(page).locator("dd").all()) expect(clean(await dd.innerText())).not.toBe("");
    const defaults = await servedDefaults(page);
    const dd = async (label: string) => contentText(summary(page).locator("dl dt", { hasText: ci(label) }).locator("xpath=following-sibling::dd[1]"));
    expect(await dd("Fed funds")).toBe(`${defaults.fedfunds.toFixed(2)}%`);
    expect(await dd("HY OAS")).toBe(`${defaults.hy_oas_pct.toFixed(2)}%`);
    expect(await dd("All-in rate")).toBe(`${defaults.lbo_all_in_rate.toFixed(2)}%`);
    expect(await dd("Financing")).toMatch(/all-in \((?:live: Fed Funds \+ HY spread|stated default)\)$/);
    expect(await dd("Equity check")).toMatch(/^\$[\d,]+M in · \$[\d,]+M out$/);
    note("summary-rows", labels.join(" · "));

    await expect(strip(page)).toHaveCount(1);
    await expect(strip(page)).toHaveClass(/mrr-status/);
    const title = await contentText(strip(page).locator(".mrr-status-title"));
    expect(title).toMatch(/^(?:Rate synced from FRED|FRED rate delayed|FRED rate stale|Rate feed unavailable|Reading the FRED rate…)$/);
    const detail = await contentText(strip(page).locator("small"));
    const tone = (await strip(page).getAttribute("data-tone")) ?? "";
    expect(await strip(page).getAttribute("aria-label")).toMatch(new RegExp(`^${escapeRe(title)}\\. .*Open the data freshness breakdown\\.$`));
    note("strip", `${title} · ${detail} · tone ${tone}`);
    if (title === "Rate synced from FRED") expect(tone).toBe("mint");
    else if (/^FRED rate (?:delayed|stale)$/.test(title)) expect(tone).toBe("amber");
    else expect(tone).toBe("gray");
    if (defaults.data_as_of !== "unavailable") {
      const stripDate = storedThrough(detail);
      const captionDate = storedThrough(await contentText(assumptions(page)));
      expect(stripDate, "the strip prints the stored-through date").not.toBe("");
      expect(stripDate).toBe(captionDate);
      note("stored-through", stripDate);
    } else {
      note("stored-through", "the engine's fallback payload is on file (data_as_of unavailable): no date to compare");
    }

    await strip(page).click();
    const drawer = page.getByRole("dialog", { name: "Data freshness" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("aria-labelledby", "freshness-drawer-title");
    await capture(page, "tools--freshness-drawer.png", page.locator("body"));
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(strip(page)).toBeFocused();

    const credit = summary(page).locator("dl dt", { hasText: ci("Credit state") }).locator("xpath=following-sibling::dd[1]").locator("a");
    await expect(credit).toHaveAttribute("href", "/app/credit#financing");
    note("credit-state", await contentText(credit));
    await credit.click();
    await expect(page).toHaveURL(/\/app\/credit#financing$/);
    await expect.poll(() => inView(page, "financing"), { timeout: 30_000 }).toBe(true);
  });

  test("6. sub-tabs by click and by URL: Asset allocation swaps the hero and the hash, LBO calculator swaps back, and every hash route selects its tab and lands its id", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    await expect(tab(page, "LBO calculator")).toHaveAttribute("aria-selected", "true");
    await tab(page, "Asset allocation").click();
    await expect(tab(page, "Asset allocation")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#allocation")).toHaveCount(1);
    expect(await page.evaluate(() => location.hash)).toBe("#allocation");
    await awaitAllocation(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    expect(await contentText(page.locator("main h1"))).not.toMatch(/ IRR$/);
    await expect(hero(page)).toHaveCount(0);
    await tab(page, "LBO calculator").click();
    await expect(tab(page, "LBO calculator")).toHaveAttribute("aria-selected", "true");
    expect(await page.evaluate(() => location.hash)).toBe("#lbo");
    await awaitLbo(page);
    await expect(allocHero(page)).toHaveCount(0);

    const routes: [string, string, string][] = [
      ["#allocation", "Asset allocation", "allocation"],
      ["#allocation-risk", "Asset allocation", "allocation-risk"],
      ["#allocation-optimization", "Asset allocation", "allocation-optimization"],
      ["#lbo", "LBO calculator", "lbo"],
      ["#lbo-assumptions", "LBO calculator", "lbo-assumptions"],
      ["#lbo-sensitivity", "LBO calculator", "lbo-sensitivity"],
    ];
    for (const [hash, tabName, id] of routes) {
      await open(page, `${ROUTE}${hash}`);
      await expect(tab(page, tabName), hash).toHaveAttribute("aria-selected", "true");
      if (tabName === "Asset allocation") await awaitAllocation(page);
      else await awaitLbo(page);
      await expect.poll(() => inView(page, id), { timeout: 30_000, message: `${hash} lands ${id}` }).toBe(true);
    }
  });

  test("7. slider → rerun → modified deal → Reset (the P9 check): four ArrowRight steps on Entry multiple rerun the deal, flag the row, flip Outputs to Modified with the base-case meta, add Vs base case and the hero note, re-centre the grid; Reset restores everything", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    const h1Before = await contentText(page.locator("main h1"));
    const irrBefore = await tileValue(page, "IRR");
    expect(irrBefore).toMatch(/^\d+\.\d%$/);
    expect(irrBefore).toBe(h1Before.replace(/ IRR$/, ""));
    await expect(outputs(page).locator(".mrr-sec-desc")).toHaveText("Default deal at the live rate");
    await expect(outputs(page).locator(".mrr-sec-head span[data-tone]")).toHaveText(/^Default$/i);
    await expect(resetButton(page)).toBeDisabled();
    const centreBefore = await outlinedCell(page);
    expect(centreBefore.count).toBe(1);
    expect(centreBefore.text).toBe(irrBefore);
    for (const row of await page.locator("main .mrr-slider-row").all()) expect(await row.getAttribute("data-changed")).toBe("false");

    const target = BASE_INPUTS.entry_multiple + 1; // 4 × 0.25
    const run = awaitRun(page, (b) => b.entry_multiple === target);
    await pressArrowRight(page, "Entry multiple", 4);
    const row = rowOf(page, "Entry multiple");
    await expect(row).toHaveAttribute("data-changed", "true");
    expect(await row.locator("input[type='number']").evaluate((el) => (el as HTMLElement).style.color)).toBe("var(--amber)");
    expect(await row.locator(".mrr-slider-fill").evaluate((el) => (el as HTMLElement).style.background)).toContain("var(--amber)");
    await expect(row).toContainText("│ current reading");
    await expect(outputs(page).locator(".mrr-sec-desc")).toHaveText("Modified deal");
    await expect(outputs(page).locator(".mrr-sec-head span[data-tone]")).toHaveText(/^Modified$/i);
    expect((await run).status(), "POST /api/lbo/run").toBe(200);
    await expect.poll(() => tileValue(page, "IRR"), { timeout: 30_000, message: "the IRR tile moves" }).not.toBe(irrBefore);
    const irrAfter = await tileValue(page, "IRR");
    await expect(outputs(page).locator(".mrr-sec-head")).toContainText(/base case: IRR \d+\.\d% · MOIC \d\.\d\d×/);
    await expect(summary(page).locator("dt", { hasText: ci("Vs base case") })).toHaveCount(1);
    await expect(hero(page).locator(".mrr-hero-note")).toContainText(/^Your modified deal/);
    expect(await contentText(page.locator("main h1"))).toBe(h1Before);
    await expect.poll(async () => (await outlinedCell(page)).text, { timeout: 30_000 }).toBe(irrAfter);
    const centreAfter = await outlinedCell(page);
    expect(centreAfter.count).toBe(1);
    expect(centreAfter.row).toBe(`${target.toFixed(1)}×`);
    note("modified", `${irrBefore} → ${irrAfter} after four ArrowRight steps on Entry multiple (${target.toFixed(2)}×)`);
    await settle(page, 400);
    await capture(page, "tools--modified.png");

    await resetButton(page).click();
    for (const r of await page.locator("main .mrr-slider-row").all()) await expect(r).toHaveAttribute("data-changed", "false");
    await expect(outputs(page).locator(".mrr-sec-desc")).toHaveText("Default deal at the live rate");
    await expect(outputs(page).locator(".mrr-sec-head span[data-tone]")).toHaveText(/^Default$/i);
    await expect.poll(() => tileValue(page, "IRR"), { timeout: 30_000 }).toBe(irrBefore);
    await expect(hero(page).locator(".mrr-hero-note")).toHaveCount(0);
    await expect(summary(page).locator("dt", { hasText: ci("Vs base case") })).toHaveCount(0);
    await expect(resetButton(page)).toBeDisabled();
    expect(await visibleText(page.locator("main"))).not.toContain("│ current reading");
  });

  test("8. rate switch: ArrowRight on Interest rate (all-in) unchecks the switch and reads manual rate; clicking the switch tracks the live rate again; the IRR tile never moves (fact 1)", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    const irrBefore = await tileValue(page, "IRR");
    await expect(rateSwitch(page)).toHaveAttribute("aria-checked", "true");
    const row = rowOf(page, "Interest rate (all-in)");
    await expect(row).toContainText("tracking the live all-in cost");
    const rateBefore = await rangeOf(page, "Interest rate (all-in)").inputValue();
    const run = awaitRun(page, (b) => b.interest_rate !== Number(rateBefore));
    await pressArrowRight(page, "Interest rate (all-in)", 1);
    await expect(row).toHaveAttribute("data-changed", "true");
    await expect(rateSwitch(page)).toHaveAttribute("aria-checked", "false");
    await expect(row).toContainText("manual rate");
    expect((await run).status()).toBe(200);
    await settle(page, 400);
    expect(await tileValue(page, "IRR"), "the served model's IRR does not move with the rate (checklist fact 1)").toBe(irrBefore);
    // "Back to live" restores the base deal's inputs, whose run is already in
    // the query cache (the base run stays enabled and shares the key at rest,
    // checklist 09 B.0), so no second POST is expected here.
    await rateSwitch(page).click();
    await expect(rateSwitch(page)).toHaveAttribute("aria-checked", "true");
    await expect(row).toContainText("tracking the live all-in cost");
    await expect(row).toHaveAttribute("data-changed", "false");
    expect(await rangeOf(page, "Interest rate (all-in)").inputValue()).toBe(rateBefore);
    await settle(page, 600);
    expect(await tileValue(page, "IRR")).toBe(irrBefore);
    note("rate", `IRR ${irrBefore} unchanged through a rate move and back (expected: interest never enters the equity cash flows)`);
  });

  test("9. warnings (U14): leverage 8 on an 8.00× entry raises meets or exceeds; the entry lowered under the debt turns Outputs to Deal not viable with the server's dash cleaned; Reset clears both", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    await expect(assumptions(page).locator('[role="status"]')).toHaveCount(0);
    const leverageRun = awaitRun(page, (b) => b.leverage_ratio === 8);
    const leverage = typedOf(page, "Leverage · Debt/EBITDA");
    await leverage.scrollIntoViewIfNeeded();
    await leverage.fill("8");
    await leverage.press("Enter");
    const status = assumptions(page).locator('[role="status"]');
    await expect(status).toHaveCount(1);
    await expect(status).toContainText("meets or exceeds");
    await expect(status).toContainText("debt covers the whole purchase price and the equity check goes to zero or below.");
    expect((await leverageRun).status()).toBe(200);
    // The engine counts fees as a use of funds (lbo.py: entry_equity = entry_ev + fees - entry_debt), so leverage equal to
    // the entry multiple still leaves a positive check of the fee dollars. Recompute the engine's gate on the served
    // deal; when it is still viable, lower the entry multiple under the debt to reach the not-viable branch.
    const equityAt = (entry: number) => BASE_INPUTS.ebitda * (entry * (1 + BASE_INPUTS.mgmt_fee_pct / 100) - 8);
    if (equityAt(BASE_INPUTS.entry_multiple) > 0) {
      note("viability", `leverage 8.00× on an 8.00× entry leaves $${equityAt(BASE_INPUTS.entry_multiple).toFixed(0)}M of fee-funded equity, viable in the engine; entry lowered to 7.50× for the not-viable branch`);
      const entryRun = awaitRun(page, (b) => b.leverage_ratio === 8 && b.entry_multiple === 7.5);
      const entry = typedOf(page, "Entry multiple");
      await entry.fill("7.5");
      await entry.press("Enter");
      expect((await entryRun).status()).toBe(200);
      await expect(status).toContainText("meets or exceeds");
    }
    await expect(outputs(page)).toContainText("Deal not viable:", { timeout: 30_000 });
    const outText = await contentText(outputs(page));
    expect(outText).toContain("Deal not viable: Leverage too high; debt exceeds entry EV plus fees");
    expect(outText).not.toContain("—");
    await expect(hero(page).locator(".mrr-hero-note")).toContainText("Your modified deal is not viable at these assumptions; see Outputs.");
    await settle(page, 400);
    await capture(page, "tools--warning.png");

    await resetButton(page).click();
    await expect(status).toHaveCount(0);
    await expect(outputs(page)).not.toContainText("Deal not viable", { timeout: 30_000 });
    await expect(hero(page).locator(".mrr-hero-note")).toHaveCount(0);
    for (const r of await page.locator("main .mrr-slider-row").all()) await expect(r).toHaveAttribute("data-changed", "false");
  });

  test("10. schedule and grid: eight th, Close plus hold_period rows ending 5 · exit, five column headers and one outlined cell under Entry ↓ with the legend, no Rate × leverage and no IRR vs financing rate, the market-check caption last in the results column, the DisclosureLine last in main", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    await expect(schedule(page).locator("h2")).toHaveText(/^Annual debt schedule$/i);
    await expect(schedule(page).locator(".mrr-sec-desc")).toHaveText("$ millions");
    expect((await schedule(page).locator("th").allTextContents()).map(clean)).toEqual(SCHEDULE_TH);
    const rows = schedule(page).locator("tbody tr");
    await expect(rows).toHaveCount(1 + BASE_INPUTS.hold_period);
    expect(clean(await rows.first().locator("td").first().innerText())).toBe("Close");
    expect(clean(await rows.last().locator("td").first().innerText())).toBe(`${BASE_INPUTS.hold_period} · exit`);

    await expect(sensitivity(page).locator("h2")).toHaveText(/^IRR sensitivity$/i);
    await expect(sensitivity(page).locator(".mrr-sec-sp")).toContainText(/entry × exit multiple/i);
    const grid = sensitivity(page).locator('[role="table"]');
    await expect(grid).toHaveCount(1);
    const cols = (await grid.locator('[role="columnheader"]').allTextContents()).map(clean);
    expect(cols[0]).toBe("Entry ↓");
    expect(cols.length - 1, "five exit multiples (fewer only at the range edges)").toBe(5);
    expect(await grid.locator('[role="rowheader"]').count()).toBe(5);
    const outlined = await outlinedCell(page);
    expect(outlined.count).toBe(1);
    expect(outlined.text).toBe(await tileValue(page, "IRR"));
    const legend = await visibleText(sensitivity(page).locator(".mrr-heat-legend"));
    for (const s of ["20% or more", "Below 15%", "Exit multiple →"]) expect(legend).toContain(s);
    await expect(page.getByRole("button", { name: /Rate × leverage/i })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /IRR vs financing rate/i })).toHaveCount(0);
    expect(await visibleText(page.locator("main"))).not.toMatch(/IRR vs financing rate/i);
    const lastInColumn = await page.evaluate(() => {
      const col = document.getElementById("lbo-outputs")?.parentElement;
      return (col?.lastElementChild?.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    expect(lastInColumn.startsWith("One check on the market: this deal borrows at ")).toBe(true);
    const lastInMain = await page.evaluate(() => {
      const main = document.querySelector("main");
      let n: Element | null = main?.querySelector(".mrr-disclosure-line") ?? null;
      if (!n) return "missing";
      while (n && n !== main) {
        if (n.nextElementSibling) return "not last";
        n = n.parentElement;
      }
      return "last";
    });
    expect(lastInMain).toBe("last");
    await expect(page.locator("main .mrr-disclosure-line")).toContainText("An illustrative model for teaching and screening, not a transaction model.");
  });

  test("11. Allocation hero and summary: one h1 naming an asset, the signed pill, one bar per asset, the three dt labels, the strip as a link into #allocation-optimization", async ({ page }) => {
    await open(page, `${ROUTE}#allocation`);
    await awaitAllocation(page);
    const a = await servedAllocation(page);
    const means = a.regime_stats[a.current_regime]?.mean ?? {};
    const ranked = Object.entries(means)
      .filter((e): e is [string, number] => e[1] != null)
      .sort((x, y) => y[1] - x[1]);
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    const h1Text = await contentText(h1);
    note("h1", h1Text);
    const pill = allocHero(page).locator(".mrr-pill");
    if (ranked.length) {
      expect(h1Text).toBe(ranked[0][0]);
      await expect(pill).toHaveCount(1);
      const pillText = await contentText(pill);
      expect(pillText).toMatch(/^[+-]\d+\.\d% a year$/);
      expect(pillText).toBe(`${ranked[0][1] >= 0 ? "+" : ""}${(ranked[0][1] * 100).toFixed(1)}% a year`);
      await expect(allocHero(page).locator("h2")).toContainText("lagged at");
      const svg = allocHero(page).locator('svg[role="img"]');
      await expect(svg).toHaveCount(1);
      await expect(svg).toHaveAttribute("aria-label", `Annualized return by asset in ${a.current_regime} months`);
      await expect(svg.locator("rect")).toHaveCount(ranked.length);
    } else {
      expect(h1Text).toBe("Regime-conditional returns");
      note("hero", "no ranked asset in the current regime on verify day: the generic sentence is on screen");
    }
    await expect(allocHero(page).locator(".mrr-hero-eyebrow")).toContainText(/Asset allocation/i);
    await expect(allocHero(page).getByRole("link", { name: "See the optimization" })).toHaveAttribute("href", "/app/tools#allocation-optimization");
    await expect(allocHero(page).getByRole("link", { name: "Regime Lab backtests" })).toHaveAttribute("href", "/app/regime-lab#backtests");
    expect((await allocSummary(page).locator("dt").allTextContents()).map(clean)).toEqual(ALLOCATION_LABELS);
    await expect(allocSummary(page).locator("h2")).toHaveText(/^Allocation summary$/i);
    const strip = allocSummary(page).locator('a[href$="#allocation-optimization"]');
    await expect(strip).toHaveCount(1);
    await expect(strip).toHaveClass(/mrr-status/);
    const title = await contentText(strip.locator(".mrr-status-title"));
    const detail = await contentText(strip.locator("small"));
    const tone = (await strip.getAttribute("data-tone")) ?? "";
    note("strip", `${title} · ${detail} · tone ${tone}`);
    if (a.optimizations == null) {
      expect(tone).toBe("amber");
      expect(title).toBe("Optimizer unavailable this session");
      expect(detail).toMatch(/months complete · \d+ required$|^needs 24 complete /);
      if (a.optimizations_skipped) expect(detail).toBe(`${a.optimizations_skipped.complete_months} of ${a.optimizations_skipped.total_regime_months} ${a.current_regime} months complete · ${a.optimizations_skipped.required_cov_months} required`);
    } else {
      expect(["mint", "amber"]).toContain(tone);
      expect(title).toMatch(/^Optimizer solved(?: · 7 methods| with \d+ fallbacks?)$/);
    }
    await strip.click();
    await expect.poll(() => inView(page, "allocation-optimization"), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await settle(page, 600);
    await capture(page, "tools--allocation.png");
  });

  test("12. Optimization (the P9 every-method-and-frontier check): the T27 disclosure when the optimizer is null on the served DB; otherwise every method by real click, the ringed frontier marker and the seven-column weights table", async ({ page }) => {
    await open(page, `${ROUTE}#allocation-optimization`);
    await awaitAllocation(page);
    const a = await servedAllocation(page);
    await expect(optimization(page).locator("h2")).toHaveText(/^Optimization$/i);
    if (a.optimizations == null) {
      await expect(optimization(page).locator(".mrr-sec-sp")).toContainText(/optional enhancement · unavailable this session/i);
      const disclosure = optimization(page).getByRole("button", { name: /Optimizer status: no output this session/ });
      await expect(disclosure).toHaveCount(1);
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      await expect(optimization(page).locator('.mrr-seg[aria-label="Optimization method"]')).toHaveCount(0);
      await disclosure.click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await expect(optimization(page)).toContainText("So no weights, no efficient frontier and no portfolio-level CVaR are produced this session.");
      if (a.optimizations_skipped) {
        await expect(disclosure).toContainText(`${a.optimizations_skipped.complete_months} of ${a.optimizations_skipped.total_regime_months} ${a.current_regime} months complete · ${a.optimizations_skipped.required_cov_months} required`);
      }
      note("optimizer", "optimizer unavailable on the local DB; methods and frontier proven by vitest E.1 (AllocationPanel.test.tsx, FrontierChart.test.tsx)");
      await settle(page, 400);
      await capture(page, "tools--allocation-optimizer-open.png", optimization(page));
      return;
    }
    await expect(optimization(page).locator(".mrr-sec-sp")).toContainText(/max 40% per asset · long-only/i);
    const group = seg(page, optimization(page), "Optimization method");
    const options = group.locator("button[aria-pressed]");
    const served = METHOD_KEYS.filter((k) => a.optimizations && a.optimizations[k]);
    await expect(options).toHaveCount(served.length);
    note("methods", `${served.length} served methods: ${served.join(", ")}`);
    const fallbacks = METHOD_KEYS.filter((k, i) => {
      const o = a.optimizations?.[k] as Optimization | undefined;
      return o != null && (o.converged === false || (o.method ?? "").includes("(fallback)")) && METHOD_LABELS[i];
    }).map((k) => METHOD_LABELS[METHOD_KEYS.indexOf(k)]);
    const svg = optimization(page).locator('svg[role="img"][aria-label^="Efficient frontier"]');
    await expect(svg).toHaveCount(1);
    await expect(svg.locator("path")).toHaveCount(1);
    for (const name of await options.allInnerTexts()) {
      const option = group.getByRole("button", { name: ci(clean(name)) });
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      const tile = optimization(page).locator("[style*='var(--r-tile)']").filter({ has: page.locator("span[data-tone]") }).first();
      expect((await visibleText(tile)).toLowerCase()).toContain(clean(name).toLowerCase());
      const isFallback = fallbacks.some((f) => f.toLowerCase() === clean(name).toLowerCase());
      const ring = svg.locator("g[data-selected='true']");
      if (isFallback) await expect(ring).toHaveCount(0);
      else {
        await expect(ring).toHaveCount(1);
        expect((await contentText(ring)).toLowerCase()).toBe(clean(name).toLowerCase());
      }
    }
    const weights = optimization(page).locator('[role="table"][aria-label="Weights by method"]');
    await expect(weights).toHaveCount(1);
    const headers = (await weights.locator('[role="columnheader"]').allInnerTexts()).map(clean).filter(Boolean);
    expect(headers).toHaveLength(7);
    expect(headers.map((h) => h.toLowerCase())).toContain("b-l");
    const caption = await contentText(optimization(page));
    for (const label of METHOD_LABELS) {
      const named = new RegExp(`${escapeRe(label)}[^.]*unavailable this session`).test(caption) || new RegExp(`and ${escapeRe(label)} (?:is|are) unavailable`).test(caption);
      if (fallbacks.includes(label)) expect(named, `${label} is a served fallback and the caption names it`).toBe(true);
      else expect(caption, `${label} converged and the caption never names it as unavailable`).not.toMatch(new RegExp(`${escapeRe(label)} (?:is|are) unavailable`));
    }
    note("fallbacks", fallbacks.length ? fallbacks.join(", ") : "none: All seven converged this session");
    await settle(page, 400);
    await capture(page, "tools--allocation-methods.png", optimization(page));
  });

  test("13. Risk lenses (the P9 check): the four primary lenses, More lenses ▸, then the four more; every lens renders its tile or its note; the Style and Correlation pickers default to the current regime", async ({ page }) => {
    await open(page, `${ROUTE}#allocation-risk`);
    await awaitAllocation(page);
    const a = await servedAllocation(page);
    await expect(risk(page).locator("h2")).toHaveText(/^Risk analysis$/i);
    const group = seg(page, risk(page), "Risk lens");
    await expect(group.locator("button")).toHaveCount(4);
    const more = risk(page).getByRole("button", { name: /^More lenses/ });
    await expect(more).toHaveCount(1);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    for (const lens of LENSES) {
      if (lens.name === "Style") {
        await more.click();
        await expect(more).toHaveCount(0);
        await expect(group.locator("button")).toHaveCount(8);
      }
      const option = segOption(page, risk(page), "Risk lens", lens.name);
      await option.click();
      await expect(option).toHaveAttribute("aria-pressed", "true");
      await settle(page, 300);
      const tiles = await risk(page).locator('[role="table"], table, .mrr-meter-row').count();
      const text = await visibleText(risk(page));
      const noted = lens.note.test(text);
      expect(tiles > 0 || noted, `${lens.name}: a table, rows or its note`).toBe(true);
      note(`lens-${lens.slug}`, tiles > 0 ? `${tiles} table / row element(s)` : "state note on screen");
      if (lens.name === "Style" || lens.name === "Correlation") {
        const picker = seg(page, risk(page), lens.name === "Style" ? "Style regime" : "Correlation regime");
        const pressed = (await picker.locator("button[aria-pressed='true']").allInnerTexts()).map(clean);
        expect(pressed.map((p) => p.toLowerCase())).toEqual([a.current_regime.toLowerCase()]);
      }
      // No em-dash asides; the standalone "—" null placeholder (the tail lens's
      // per-method reads with no optimizer output) is the house convention.
      expect(text.replace(/(^|\s)—(?=\s|$|\.)/g, "$1")).not.toContain("— ");
      await capture(page, `tools--allocation-lens-${lens.slug}.png`, risk(page));
    }
  });

  test("16. at 390 px the hero stacks over the summary, the sub-tabs wrap without hints, the LBO body and the output tiles are one column, every table and grid scrolls inside its well, and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await awaitLbo(page);
    await settle(page, 600);
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      return {
        hero: box("#lbo-hero"),
        summary: box("#lbo-summary"),
        assumptions: box("#lbo-assumptions"),
        outputs: box("#lbo-outputs"),
        schedule: box("#lbo-schedule"),
        sensitivity: box("#lbo-sensitivity"),
        tiles: [...document.querySelectorAll(".mrr-tools-outputs > *")].map((t) => t.getBoundingClientRect()),
        hints: document.querySelectorAll(".mrr-subtabs small").length,
        scrollWells: document.querySelectorAll("#lbo [data-scrollable='true']").length,
        chips: document.querySelectorAll("#lbo-hero .mrr-hero-chips span").length,
      };
    });
    for (const k of ["hero", "summary", "assumptions", "outputs", "schedule", "sensitivity"] as const) expect(boxes[k], k).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    expect((boxes.outputs as DOMRect).top, "the results stack under the assumptions").toBeGreaterThanOrEqual((boxes.assumptions as DOMRect).bottom - 1);
    expect((boxes.sensitivity as DOMRect).top, "the grid stacks under the schedule").toBeGreaterThanOrEqual((boxes.schedule as DOMRect).bottom - 1);
    expect(boxes.tiles.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < boxes.tiles.length; i++) expect(boxes.tiles[i].top, `output tile ${i + 1} below tile ${i}`).toBeGreaterThanOrEqual(boxes.tiles[i - 1].bottom - 1);
    expect(boxes.hints, "sub-tab hints drop when the row wraps").toBe(0);
    expect(boxes.scrollWells, "the schedule and the grid scroll inside their wells").toBeGreaterThanOrEqual(2);
    expect(boxes.chips, "no freshness chips on a phone").toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "tools--390.png");
  });

  test("17. captures: the full page at 1672 for the region-by-region compare with tools.png", async ({ page }) => {
    await open(page);
    await awaitLbo(page);
    await expect(hero(page).locator('svg[role="img"]')).toHaveCount(1, { timeout: 30_000 });
    await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBe(SUMMARY_LABELS.length);
    await expect(resetButton(page)).toBeDisabled();
    await settle(page, 1200);
    await capture(page, "tools.png");
    expect(fs.existsSync(path.join(DOCS, "tools.png")), "the approved mockup the verifier compares against").toBe(true);
    note("captures", fs.readdirSync(CAPTURE_DIR).sort().join(", "));
  });
});
