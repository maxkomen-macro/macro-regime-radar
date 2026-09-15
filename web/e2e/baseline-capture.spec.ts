/**
 * Phase 0 baseline capture (redesign-v2): every screen, sub-tab, opened
 * disclosure and shell overlay at 1672 px → docs/redesign-v2/baseline/*.png,
 * plus labels.json (visible section titles and control labels per screen and
 * state) and console.json (baseline console errors / failed API requests).
 *
 * Usage (servers already running):  npx playwright test e2e/baseline-capture.spec.ts
 * Output dir override:              BASELINE_DIR=/abs/path
 */
import { test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { extractLabels, type LabelRec } from "./lib/labels";
import { collect, listTabs, openAllDisclosures, settle, slugify } from "./lib/drive";

const OUT = process.env.BASELINE_DIR ?? path.resolve(process.cwd(), "..", "docs", "redesign-v2", "baseline");
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = [
  { name: "landing", route: "/" },
  { name: "dashboard", route: "/app/dashboard" },
  { name: "regime-lab", route: "/app/regime-lab" },
  { name: "markets", route: "/app/markets" },
  { name: "credit", route: "/app/credit" },
  { name: "recession", route: "/app/recession" },
  { name: "news", route: "/app/news" },
  { name: "tools", route: "/app/tools" },
  { name: "methodology", route: "/app/methodology" },
  { name: "kit", route: "/kit" },
];

type ScreenRecord = {
  route: string;
  states: string[];
  screenshots: string[];
  labels: LabelRec[];
  console: { type: string; text: string }[];
  failed: { url: string; status: number }[];
};

const LABELS_PATH = path.join(OUT, "labels.json");
const CONSOLE_PATH = path.join(OUT, "console.json");

function loadJson<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function gitSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: process.cwd() }).toString().trim();
  } catch {
    return "unknown";
  }
}

function saveScreen(name: string, rec: ScreenRecord) {
  const labels = loadJson<{ generated_at?: string; base_sha?: string; screens: Record<string, unknown> }>(LABELS_PATH, { screens: {} });
  labels.generated_at = new Date().toISOString();
  labels.base_sha = gitSha();
  const uniq = new Map<string, LabelRec>();
  for (const l of rec.labels) {
    const k = `${l.kind}|${l.norm}`;
    if (!uniq.has(k)) uniq.set(k, l);
  }
  labels.screens[name] = { route: rec.route, states: rec.states, screenshots: rec.screenshots, labels: [...uniq.values()] };
  fs.writeFileSync(LABELS_PATH, JSON.stringify(labels, null, 2));
  const cons = loadJson<Record<string, unknown>>(CONSOLE_PATH, {});
  cons[name] = { console: rec.console, failed: rec.failed };
  fs.writeFileSync(CONSOLE_PATH, JSON.stringify(cons, null, 2));
}

async function shot(page: Page, rec: ScreenRecord, file: string) {
  const p = path.join(OUT, file);
  await page.screenshot({ path: p, fullPage: true });
  rec.screenshots.push(file);
}

async function captureState(page: Page, rec: ScreenRecord, name: string, state: string, file: string) {
  await settle(page, 900);
  await shot(page, rec, file);
  rec.states.push(state);
  rec.labels.push(...(await extractLabels(page, state)));
}

/** Default view, then all disclosures open, then every sub-tab (recursively one level). */
async function exploreScreen(page: Page, rec: ScreenRecord, name: string, prefix: string, depth: number) {
  const opened = await openAllDisclosures(page, 6, async () => {
    rec.labels.push(...(await extractLabels(page, `${prefix}:disclosures-open`)));
  });
  if (opened > 0) await captureState(page, rec, name, `${prefix}:disclosures-open`, `${slugify(prefix)}--open.png`);

  if (depth > 1) return;
  const tabs = await listTabs(page);
  const seen = new Set<string>();
  for (const t of tabs) {
    const key = `${t.listLabel}|${t.tabLabel}`;
    if (!t.tabLabel || seen.has(key)) continue;
    seen.add(key);
    const selected = (await t.locator.getAttribute("aria-selected")) === "true";
    if (selected) continue; // the default state already covered it
    try {
      await t.locator.scrollIntoViewIfNeeded({ timeout: 3000 });
      await t.locator.click({ timeout: 4000 });
    } catch {
      continue;
    }
    const state = `${prefix}:tab:${t.tabLabel}`;
    await captureState(page, rec, name, state, `${slugify(prefix)}--tab-${slugify(t.tabLabel)}.png`);
    await exploreScreen(page, rec, name, `${prefix}--${slugify(t.tabLabel)}`, depth + 1);
  }
}

for (const s of SCREENS) {
  test(`baseline capture: ${s.name}`, async ({ page }) => {
    const rec: ScreenRecord = { route: s.route, states: [], screenshots: [], labels: [], console: [], failed: [] };
    const sink = collect(page);
    await page.goto(s.route, { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await captureState(page, rec, s.name, "default", `${s.name}.png`);
    await exploreScreen(page, rec, s.name, s.name, 1);
    rec.console = sink.console;
    rec.failed = sink.failed;
    saveScreen(s.name, rec);
  });
}

test("baseline capture: shell overlays (alert drawer, palette, assistant, chart modal)", async ({ page }) => {
  const rec: ScreenRecord = { route: "/app/dashboard", states: [], screenshots: [], labels: [], console: [], failed: [] };
  const sink = collect(page);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);

  // Alert drawer: the header alerts chip (aria-haspopup=dialog, label mentions "alert").
  const alerts = page.locator("header button[aria-haspopup='dialog']").filter({ hasText: /alert/i }).first();
  if (await alerts.count()) {
    await alerts.click();
    await captureState(page, rec, "shell", "alert-drawer", "shell--alert-drawer.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  // Command palette via ⌘K.
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForTimeout(300);
  if (await page.locator("[role='dialog']").count()) {
    await captureState(page, rec, "shell", "command-palette", "shell--command-palette.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  // Assistant panel: open only; never send a message (spends credits).
  const analyst = page.locator("header button[aria-controls='assistant-panel']").first();
  if (await analyst.count()) {
    await analyst.click();
    await captureState(page, rec, "shell", "assistant-panel", "shell--assistant-panel.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await analyst.getAttribute("aria-expanded").then((v) => v === "true")) await analyst.click();
  }
  // Chart modal: click the first macro-tape row on Markets.
  await page.goto("/app/markets", { waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  const row = page.locator("#watchlist tbody tr, #watchlist [role='row']").first();
  if (await row.count()) {
    await row.click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await page.locator("[role='dialog']").count()) {
      await captureState(page, rec, "shell", "chart-panel", "markets--chart-panel.png");
      await page.keyboard.press("Escape");
    }
  }
  rec.console = sink.console;
  rec.failed = sink.failed;
  saveScreen("shell", rec);
});
