/**
 * Phase 4 checklist (docs/redesign-v2/checklists/04-regime-lab.md) section E.3:
 * the P4 browser check on /app/regime-lab, steps 1 to 12, 15 and 16, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks and keys
 * only; the assistant panel is never opened, typed into or sent from.
 * Captures land in docs/redesign-v2/captures/redesign-04-regime-lab/
 * (CAPTURE_DIR overrides). Steps 13 and 14 are the existing parity and
 * regression specs, run separately.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-04-regime-lab");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/regime-lab";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Summary row labels in C.2 order. */
const SUMMARY_LABELS = ["Current regime", "Classifier odds", "Model confidence", "Next 3 months", "Next 6 months", "Spell length", "Market read", "Takeaway conviction", "Takeaway divergences", "Model vs market"];
/** Sub-tab id, its label prefix, the hash the SubTabs onChange writes, and the section ids its panel renders. */
const TABS = [
  { id: "overview", label: /^Overview/, anchor: "takeaway", sections: ["cycle", "transitions", "regime-history-teaser"] },
  { id: "playbook", label: /^Playbook/, anchor: "playbook", sections: ["playbook"] },
  { id: "scenarios", label: /^Scenarios/, anchor: "scenarios", sections: ["scenarios"] },
  { id: "history", label: /^History & analogues/, anchor: "analogues", sections: ["analogues", "regime-history"] },
  { id: "evidence", label: /^Empirical evidence/, anchor: "backtests", sections: ["backtests"] },
] as const;
/** Hash route → the sub-tab it selects (SECTION_TO_TAB). */
const HASH_TO_TAB: Record<string, (typeof TABS)[number]["id"]> = {
  playbook: "playbook",
  scenarios: "scenarios",
  analogues: "history",
  "regime-history": "history",
  backtests: "evidence",
  cycle: "overview",
  transitions: "overview",
};
/** COHORT_NAMES (EvidenceTab.tsx, kept verbatim) in cohort-key order. */
const SIGNAL_COHORTS = ["Inflation cold · CPI below 1%", "Inflation hot · CPI above 4%", "Unemployment spike · +0.3pp vs 12m low", "VIX spike · above 30", "Curve inversion · 2s10s below 0"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtMonYr = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

interface RegimeRow {
  date: string;
  label: string;
}
interface Duration {
  current_regime: string;
  months_in_regime: number;
  status: string;
}

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const tabOf = (page: Page, label: RegExp) => page.locator("main [role='tab']").filter({ hasText: label }).first();
const hero = (page: Page) => page.locator("#takeaway");
const summary = (page: Page) => page.locator("#regime-outlook");

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

const hash = (page: Page) => page.evaluate(() => window.location.hash);

/** The served narrative's first sentence: tags stripped, em-dash asides tidied to semicolons. */
function firstSentence(s: string): string {
  const text = clean(s.replace(/<\/?strong>/g, "").replace(/\s+—\s+/g, "; "));
  const m = /^(.*?[.!?])(?:\s+|$)/.exec(text);
  return m ? m[1] : text;
}

/** The G12 count: for every merged spell of `label` with a successor, the successor's label. */
function exitCounts(rows: RegimeRow[], label: string): Record<string, number> {
  const segs: string[] = [];
  for (const r of rows) if (!segs.length || segs[segs.length - 1] !== r.label) segs.push(r.label);
  const out: Record<string, number> = {};
  for (let i = 0; i < segs.length - 1; i++) if (segs[i] === label) out[segs[i + 1]] = (out[segs[i + 1]] ?? 0) + 1;
  return out;
}

/** A POST to /api/regime/scenario (never the /scenarios defs list). */
const scenarioPost = (page: Page) => page.waitForResponse((r) => r.request().method() === "POST" && /\/api\/regime\/scenario$/.test(new URL(r.url()).pathname), { timeout: 30_000 });

/** Legend text of the nth odds bar inside #scenarios (0 = stored odds today, 1 = stressed odds). */
async function oddsLegend(page: Page, n: number): Promise<string> {
  return visibleText(page.locator("#scenarios .mrr-odds").nth(n).locator("xpath=following-sibling::*[1]"));
}

async function capture(page: Page, file: string, target?: Locator): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage: true });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("regime lab (checklist 04 E.3)", () => {
  test("1. branch and stamp: the dev build stamp names redesign/04-regime-lab at the checked-out commit; one uvicorn, the API answering", async ({ page }) => {
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
    expect((await page.request.get("/api/regime/latest")).status()).toBe(200);
    expect((await page.request.get("/api/regime/duration")).status()).toBe(200);
    expect((await page.request.get("/api/regime/history")).status()).toBe(200);
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses on the route and every hash route", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    // Let the cold takeaway and recession calls finish.
    await expect(summary(page).locator("dt")).toHaveCount(10, { timeout: 30_000 });
    await settle(page, 1500);
    for (const id of Object.keys(HASH_TO_TAB)) {
      await page.goto(`${ROUTE}#${id}`, { waitUntil: "domcontentloaded" });
      await settle(page, 1200);
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline["regime-lab"]?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
  });

  test("3. hero: one serif h1 equal to the served status, the months pill, the subhead naming the regime, the narrative lede, 13 quadrant circles", async ({ page }) => {
    await open(page);
    const duration = (await (await page.request.get("/api/regime/duration")).json()) as Duration;
    const regime = (await (await page.request.get("/api/regime/latest")).json()) as { label: string };
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    await expect(h1).toHaveText(duration.status);
    expect(await page.locator("h1").count()).toBe(1);
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Source Serif 4"?/);
    await expect(hero(page)).toContainText("Cycle position", { ignoreCase: true });
    const pill = hero(page).locator(".mrr-pill");
    await expect(pill).toHaveCount(1);
    expect(await visibleText(pill)).toMatch(/^\d+ months? in$/i);
    const h2 = page.locator("main h2").first();
    await expect(h2).toContainText(regime.label);
    expect(await visibleText(h2)).toMatch(/\.$/);
    expect(await visibleText(h2)).not.toMatch(/\d/);
    const takeaway = (await (await page.request.get("/api/regime/intelligence")).json()) as { narrative: string };
    const lede = hero(page).locator(".mrr-hero-lede");
    await expect(lede).toBeVisible({ timeout: 30_000 });
    expect(await visibleText(lede)).toContain(firstSentence(takeaway.narrative));
    expect((await visibleText(lede)).startsWith(firstSentence(takeaway.narrative))).toBe(true);
    const chart = hero(page).locator("svg[role='img']");
    await expect(chart).toHaveCount(1);
    await expect(chart.locator("circle")).toHaveCount(13);
    expect(await page.locator("main img").count()).toBe(0);
  });

  test("4. buttons: Open the playbook selects Playbook with #playbook in view, Run a scenario selects Scenarios, back returns to the Overview", async ({ page }) => {
    await open(page);
    await hero(page).getByRole("link", { name: /Open the playbook/ }).click();
    await expect(page).toHaveURL(/\/app\/regime-lab#playbook$/);
    await expect(tabOf(page, /^Playbook/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => inView(page, "playbook"), { timeout: 15_000 }).toBe(true);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(page).toHaveURL(/\/app\/regime-lab$/);
    await expect(tabOf(page, /^Overview/)).toHaveAttribute("aria-selected", "true");
    await hero(page).getByRole("link", { name: /Run a scenario/ }).click();
    await expect(page).toHaveURL(/\/app\/regime-lab#scenarios$/);
    await expect(tabOf(page, /^Scenarios/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => inView(page, "scenarios"), { timeout: 15_000 }).toBe(true);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await settle(page, 900);
    await expect(tabOf(page, /^Overview/)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#cycle")).toBeVisible();
  });

  test("5. summary: the ten dt labels; Current regime links to #playbook; the strip links to #transitions with the title agreeing with its delta; the disclosure opens", async ({ page }) => {
    await open(page);
    const dts = summary(page).locator("dt");
    await expect(dts).toHaveCount(10, { timeout: 30_000 });
    expect((await dts.allInnerTexts()).map(clean)).toEqual(SUMMARY_LABELS);
    await expect(summary(page).locator("dd a[href$='#playbook']")).toHaveCount(1);

    const strip = summary(page).locator("a.mrr-status[href$='#transitions']");
    await expect(strip).toHaveCount(1, { timeout: 30_000 });
    const title = await visibleText(strip.locator("b"));
    const detail = await visibleText(strip.locator("small"));
    expect(title).toMatch(/^(?:Watch · Overheating odds rising|Overheating odds not rising)$/);
    if (/^Watch/.test(title)) {
      expect(detail).toMatch(/^Up \d+ pts? · [A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4}$/);
    } else {
      const m = /^([+−-]?)(\d+) pts? · [A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4}$/.exec(detail);
      expect(m, detail).not.toBeNull();
      const signed = (m?.[1] === "-" || m?.[1] === "−" ? -1 : 1) * Number(m?.[2]);
      expect(signed).toBeLessThanOrEqual(0);
    }
    expect(await strip.getAttribute("aria-label")).toBe(`${title}. ${detail}`);
    await strip.click();
    await expect(tabOf(page, /^Overview/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => inView(page, "transitions"), { timeout: 15_000 }).toBe(true);

    await page.evaluate(() => window.scrollTo(0, 0));
    const disclosure = summary(page).getByRole("button", { name: /How this takeaway is composed/ });
    await expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await disclosure.click();
    await expect(disclosure).toHaveAttribute("aria-expanded", "true");
    await expect(summary(page)).toContainText("Composed from the stored regime odds, credit metrics and the recession model");
    await expect(summary(page)).toContainText("Takeaway stamped");
    await capture(page, "regime-lab--disclosure-open.png");
  });

  test("6. sub-tabs by click and by URL: each tab renders its section ids and rewrites the hash; each hash route selects its tab with the id in view", async ({ page }) => {
    await open(page);
    await expect(page.locator("main [role='tab']")).toHaveCount(5);
    for (const t of TABS) {
      await tabOf(page, t.label).click();
      await expect(tabOf(page, t.label)).toHaveAttribute("aria-selected", "true");
      expect(await page.locator("main [role='tab'][aria-selected='true']").count(), t.id).toBe(1);
      await expect.poll(() => hash(page)).toBe(`#${t.anchor}`);
      for (const id of t.sections) {
        expect(await page.evaluate((elId) => Boolean(document.getElementById(elId)), id), `${id} on ${t.id}`).toBe(true);
      }
      await settle(page, 300);
    }
    for (const [id, tabId] of Object.entries(HASH_TO_TAB)) {
      await page.goto(`${ROUTE}#${id}`, { waitUntil: "domcontentloaded" });
      await settle(page, 900);
      const t = TABS.find((x) => x.id === tabId) as (typeof TABS)[number];
      await expect(tabOf(page, t.label), id).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => inView(page, id), { timeout: 15_000 }).toBe(true);
    }
  });

  test("7. Overview: the cycle tile, the three transition tiles with the exits count from the stored labels, the teaser and its link", async ({ page }) => {
    await open(page);
    const duration = (await (await page.request.get("/api/regime/duration")).json()) as Duration;
    const rows = (await (await page.request.get("/api/regime/history")).json()) as RegimeRow[];
    const cycle = page.locator("#cycle");
    await expect(cycle).toContainText(`${Math.round(duration.months_in_regime)} mo`);
    const badge = cycle.locator("[data-tone]").first();
    expect(await visibleText(badge)).toMatch(new RegExp(`^${duration.status}$`, "i"));
    await expect(cycle).toContainText(/Started [A-Z][a-z]{2} \d{4}/);
    expect(await cycle.locator("[style*='scaleX']").count()).toBeGreaterThan(0);
    await expect(cycle).toContainText(`${duration.status} means`);
    await expect(cycle).toContainText("Percentile ranks, higher = more late-cycle risk");

    const transitions = page.locator("#transitions");
    await expect(transitions.locator("h3")).toHaveCount(3, { timeout: 30_000 });
    const t = await visibleText(transitions);
    expect(t).not.toMatch(/vs 3 mo ago/i);
    expect(t).toContain("stays ");
    const label = duration.current_regime;
    const exits = exitCounts(rows, label);
    const total = Object.values(exits).reduce((a, b) => a + b, 0);
    expect(t).toContain(`How past ${label} spells ended`.toUpperCase());
    if (total === 0) {
      expect(t).toContain(`No completed ${label} spells on file yet.`);
    } else {
      for (const [to, n] of Object.entries(exits)) expect(t, `${n} into ${to}`).toMatch(new RegExp(`${n}\\s*into ${to}`));
      expect(t).toContain(`${total} completed spell${total === 1 ? "" : "s"} since ${fmtMonYr(rows[0].date)}.`);
    }

    const teaser = page.locator("#regime-history-teaser");
    await expect(teaser.locator("svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    expect(await teaser.locator("svg[role='img'] rect").count()).toBeGreaterThan(4);
    await teaser.getByRole("link", { name: /History & analogues/ }).click();
    await expect(page).toHaveURL(/\/app\/regime-lab#regime-history$/);
    await expect(tabOf(page, /^History & analogues/)).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => inView(page, "regime-history"), { timeout: 15_000 }).toBe(true);
  });

  test("8. Playbook: clicking Overheating flips aria-pressed and the tilt sector names follow the served playbook; the ← now option returns", async ({ page }) => {
    await open(page, `${ROUTE}#playbook`);
    const playbooks = (await (await page.request.get("/api/regime/playbooks")).json()) as Record<string, { sector_tilts: { overweight: { sector: string }[]; underweight: { sector: string }[] } }>;
    const group = page.locator("#playbook").getByRole("group", { name: "Playbook regime" });
    await expect(group.locator("button[aria-pressed]")).toHaveCount(4);
    const now = group.locator("button[aria-pressed]").filter({ hasText: /← now$/ });
    await expect(now).toHaveCount(1);
    await expect(now).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#playbook")).toContainText("Sector tilts", { ignoreCase: true });
    await capture(page, "regime-lab--playbook.png");

    const overheating = group.locator("button[aria-pressed]").filter({ hasText: /^Overheating/ });
    await overheating.click();
    await expect(overheating).toHaveAttribute("aria-pressed", "true");
    expect(await group.locator("button[aria-pressed='true']").count()).toBe(1);
    const expected = [...playbooks.Overheating.sector_tilts.overweight, ...playbooks.Overheating.sector_tilts.underweight].map((s) => s.sector);
    await expect.poll(async () => (await page.locator("#playbook .mrr-meter-row > span:first-child").allInnerTexts()).map(clean), { timeout: 15_000 }).toEqual(expected);
    await capture(page, "regime-lab--playbook-overheating.png");
    await now.click();
    await expect(now).toHaveAttribute("aria-pressed", "true");
    await expect(overheating).toHaveAttribute("aria-pressed", "false");
  });

  test("9. Scenarios: the first preset scores on load; Custom shocks reveals the sliders; five ArrowRights on the HY shock POST once and move the stressed odds only; reset clears", async ({ page }) => {
    await open(page, `${ROUTE}#scenarios`);
    const group = page.locator("#scenarios").getByRole("group", { name: "Scenario" });
    const chips = group.locator("button[aria-pressed]");
    expect(await chips.count()).toBeGreaterThanOrEqual(2);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#scenarios")).toContainText("stressed odds", { ignoreCase: true, timeout: 30_000 });
    expect(await page.locator("#scenarios input[type='range']").count()).toBe(0);
    await capture(page, "regime-lab--scenarios.png");

    const custom = chips.filter({ hasText: /^Custom shocks$/i });
    await Promise.all([scenarioPost(page), custom.click()]);
    await expect(custom).toHaveAttribute("aria-pressed", "true");
    const sliders = page.locator("#scenarios input[type='range']");
    await expect(sliders).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(sliders.nth(i).locator("xpath=ancestor::*[@data-changed][1]")).toHaveAttribute("data-changed", "false");
    await settle(page, 600);
    const storedBefore = await oddsLegend(page, 0);
    const stressedBefore = await oddsLegend(page, 1);

    const hy = page.getByRole("slider", { name: "HY spread shock" });
    const row = hy.locator("xpath=ancestor::*[@data-changed][1]");
    const post = scenarioPost(page);
    await hy.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
    await expect(row).toHaveAttribute("data-changed", "true");
    await post;
    await expect.poll(() => oddsLegend(page, 1), { timeout: 15_000 }).not.toBe(stressedBefore);
    expect(await oddsLegend(page, 0)).toBe(storedBefore);
    await expect(page.locator("#scenarios")).toContainText("HY +50bps");
    await capture(page, "regime-lab--scenarios-custom.png");

    await page.locator("#scenarios").getByRole("button", { name: "Reset shocks to zero" }).click();
    await expect(row).toHaveAttribute("data-changed", "false");
    await expect(hy).toHaveValue("0");
  });

  test("10. History: the served analogue tiles; the full ribbon with more than four spans; a span hover reads its dates", async ({ page }) => {
    await open(page, `${ROUTE}#analogues`);
    const served = (await (await page.request.get("/api/regime/analogues")).json()) as unknown[];
    const analogues = page.locator("#analogues");
    await expect(analogues).toContainText("/100 match", { timeout: 30_000 });
    expect((await visibleText(analogues)).match(/\/100 match/g)?.length).toBe(served.length);
    expect((await visibleText(analogues)).match(/lesson for today/gi)?.length).toBe(served.length);
    const ribbon = page.locator("#regime-history svg[role='img']");
    await expect(ribbon).toHaveCount(1, { timeout: 30_000 });
    expect(await ribbon.locator("rect").count()).toBeGreaterThan(4);
    const span = ribbon.locator("rect").filter({ has: page.locator("title") }).first();
    await span.scrollIntoViewIfNeeded();
    await span.hover();
    expect(clean((await span.locator("title").textContent()) ?? "")).toMatch(/^(?:Goldilocks|Overheating|Stagflation|Recession Risk) · [A-Z][a-z]{2} \d{4} → [A-Z][a-z]{2} \d{4} \(\d+mo\)$/);
    await capture(page, "regime-lab--history.png");
  });

  test("11. Evidence: the backtests table with group rows and the five th; By signal swaps to the signal cohorts; the factor grid or its loading sentence", async ({ page }) => {
    await open(page, `${ROUTE}#backtests`);
    const section = page.locator("#backtests");
    const table = section.locator("table");
    await expect(table).toHaveCount(1, { timeout: 30_000 });
    expect((await table.locator("th").allInnerTexts()).map((s) => clean(s).toLowerCase())).toEqual(["horizon", "avg return", "median", "hit rate", "n"]);
    expect(await table.locator("tr.mrr-grp").count()).toBeGreaterThan(0);
    await expect(section).toContainText(/1M/);
    await expect(section).toContainText(/12M/);
    await capture(page, "regime-lab--evidence.png");

    const bySignal = section.locator("button[aria-pressed]").filter({ hasText: /^By signal$/i });
    await bySignal.click();
    await expect(bySignal).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await table.locator("tr.mrr-grp").allInnerTexts()).map((s) => clean(s).toUpperCase()), { timeout: 15_000 }).toEqual(SIGNAL_COHORTS.map((s) => s.toUpperCase()));
    await capture(page, "regime-lab--evidence-signal.png");

    const grid = section.locator("[role='table'][aria-label='Factor returns by regime']");
    const gridText = await visibleText(section);
    const loading = /Factor table computes on the allocation engine/.test(gridText);
    if (!loading) {
      await expect(grid).toHaveCount(1, { timeout: 90_000 });
      expect(await grid.locator("[role='columnheader']").count()).toBe(5);
      expect(await grid.locator("[role='rowheader']").count()).toBeGreaterThan(0);
      await expect(section.getByRole("link", { name: /Tools/ })).toHaveAttribute("href", "/app/tools#allocation");
    } else {
      expect(gridText).toContain("Factor table computes on the allocation engine; up to a minute cold, then cached an hour.");
    }
  });

  test("12. footer: the DisclosureLine is the last element in main", async ({ page }) => {
    await open(page);
    await expect(summary(page).locator("dt")).toHaveCount(10, { timeout: 30_000 });
    const lastIsLine = await page.evaluate(() => {
      const main = document.querySelector("main");
      const line = main?.querySelector("p.mrr-disclosure-line");
      if (!main || !line) return false;
      const all = main.querySelectorAll("*");
      return all[all.length - 1] === line;
    });
    expect(lastIsLine).toBe(true);
    await expect(page.locator("main p.mrr-disclosure-line")).toContainText("backtests computed from stored SPY history.");
  });

  test("15. at 390 px the hero stacks over the summary, the sub-tabs wrap without hints, tiles are one column, the wells scroll and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await expect(page.locator("main h1")).toHaveCount(1);
    const boxes = await page.evaluate(() => {
      const box = (id: string) => document.getElementById(id)?.getBoundingClientRect() ?? null;
      return { hero: box("takeaway"), summary: box("regime-outlook") };
    });
    expect(boxes.hero).not.toBeNull();
    expect(boxes.summary).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    await expect(page.locator("main [role='tab']")).toHaveCount(5);
    expect(await page.locator("main [role='tab'] small").count()).toBe(0);
    const tabTops = await page.locator("main [role='tab']").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tabTops).size, `tab rows at 390 px: ${tabTops.join(", ")}`).toBeGreaterThan(1);

    await expect(page.locator("#cycle")).toContainText(/\d+ mo/, { timeout: 30_000 });
    const tileLefts = await page.locator("#cycle [style*='var(--tile)']").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(tileLefts.length).toBeGreaterThanOrEqual(2);
    expect(new Set(tileLefts).size, `cycle tiles side by side at 390 px: ${tileLefts.join(", ")}`).toBe(1);
    const teaserSvg = page.locator("#regime-history-teaser svg[role='img']");
    await expect(teaserSvg).toHaveCount(1, { timeout: 30_000 });
    expect(await teaserSvg.evaluate((el) => getComputedStyle(el.parentElement as Element).overflowX)).toBe("auto");
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "Overview overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "regime-lab--390.png");

    await open(page, `${ROUTE}#backtests`);
    await expect(page.locator("#backtests table")).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator("#backtests .mrr-scroll[data-scrollable='true']").first()).toHaveCount(1);
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "Evidence overflow at 390 px").toBeLessThanOrEqual(0);

    await open(page, `${ROUTE}#regime-history`);
    const fullSvg = page.locator("#regime-history svg[role='img']");
    await expect(fullSvg).toHaveCount(1, { timeout: 30_000 });
    expect(await fullSvg.evaluate((el) => getComputedStyle(el.parentElement as Element).overflowX)).toBe("auto");
    overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "History overflow at 390 px").toBeLessThanOrEqual(0);
  });

  test("16. captures: the full page at 1672 for the region-by-region compare with regime-lab.png", async ({ page }) => {
    await open(page);
    await expect(summary(page).locator("dt")).toHaveCount(10, { timeout: 30_000 });
    await expect(page.locator("#regime-history-teaser svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    await settle(page, 1200);
    await capture(page, "regime-lab.png");
    expect(fs.existsSync(path.join(DOCS, "regime-lab.png")), "the approved mockup the verifier compares against").toBe(true);
  });
});
