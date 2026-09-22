/**
 * Page-driving helpers shared by the baseline capture and the parity specs:
 * settle (network + fonts + a beat for charts), open every disclosure, and
 * enumerate sub-tab rows (role=tablist) with a visited set so nested rows are
 * explored once.
 */
import type { Locator, Page } from "@playwright/test";

export async function settle(page: Page, ms = 1200): Promise<void> {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  await page.waitForTimeout(ms);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
}

/** Disclosure rows: expandable buttons that are not header popovers (drawer,
 * palette, assistant) and not inside an open dialog. */
export const DISCLOSURE_SELECTOR =
  "main button[aria-expanded='false']:not([aria-haspopup]):not([aria-controls='assistant-panel']):not(#watchlist *):not(#single-names *):not([role='combobox'])";

/** Click every closed disclosure until none remain (nested ones appear after a pass). */
export async function openAllDisclosures(page: Page, maxPasses = 6, onOpen?: () => Promise<void>): Promise<number> {
  let opened = 0;
  for (let pass = 0; pass < maxPasses; pass++) {
    const closed = page.locator(DISCLOSURE_SELECTOR);
    const n = await closed.count();
    if (n === 0) break;
    let clickedThisPass = 0;
    for (let i = 0; i < n; i++) {
      // Re-query each time: the list shifts as rows open.
      const btn = page.locator(DISCLOSURE_SELECTOR).first();
      if ((await btn.count()) === 0) break;
      try {
        await btn.scrollIntoViewIfNeeded({ timeout: 3000 });
        await btn.click({ timeout: 3000 });
        clickedThisPass++;
        opened++;
        await page.waitForTimeout(150);
        if (onOpen) await onOpen();
      } catch {
        break;
      }
    }
    if (clickedThisPass === 0) break;
    await settle(page, 400);
  }
  return opened;
}

export interface TabRef {
  listLabel: string;
  tabLabel: string;
  locator: Locator;
}

/** Every visible tab in every visible tablist under <main>. */
export async function listTabs(page: Page): Promise<TabRef[]> {
  const refs: TabRef[] = [];
  const lists = page.locator("main [role='tablist']");
  const nLists = await lists.count();
  for (let i = 0; i < nLists; i++) {
    const list = lists.nth(i);
    if (!(await list.isVisible().catch(() => false))) continue;
    const listLabel = (await list.getAttribute("aria-label")) ?? `tablist-${i}`;
    const tabs = list.locator("[role='tab']");
    const nTabs = await tabs.count();
    for (let j = 0; j < nTabs; j++) {
      const t = tabs.nth(j);
      const tabLabel = ((await t.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      refs.push({ listLabel, tabLabel, locator: t });
    }
  }
  return refs;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface ConsoleRec {
  type: string;
  text: string;
}
export interface FailedReq {
  url: string;
  status: number;
}

/** Attach console/pageerror/failed-response collectors to a page. */
export function collect(page: Page): { console: ConsoleRec[]; failed: FailedReq[] } {
  const out = { console: [] as ConsoleRec[], failed: [] as FailedReq[] };
  page.on("console", (m) => {
    const type = m.type();
    if (type === "error" || type === "warning") out.console.push({ type, text: m.text().slice(0, 400) });
  });
  page.on("pageerror", (e) => out.console.push({ type: "pageerror", text: String(e.message).slice(0, 400) }));
  page.on("response", (r) => {
    const u = r.url();
    if (r.status() >= 400 && /\/(api|health|series|regime|signals)\b/.test(new URL(u).pathname)) out.failed.push({ url: u, status: r.status() });
  });
  return out;
}

/* ── Appended for Phase 10 (checklist 10 E.3): shared by responsive.spec.ts,
   a11y.spec.ts and states.spec.ts. Appended exports only; nothing above changed. */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/** True when the element's top edge sits inside the viewport (the shell.spec.ts:26-33 rule). */
export async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}

/** The checked-out branch as a folder name ("redesign/10-states-a11y" → "redesign-10-states-a11y"),
 * the same derivation baseline-capture.spec.ts uses for its default output folder. */
export function branchSlug(): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd: process.cwd(), encoding: "utf8" })
      .trim()
      .replace(/[^A-Za-z0-9._-]+/g, "-");
  } catch {
    return "unknown-branch";
  }
}

/** docs/redesign-v2 next to web/. */
export const DOCS_DIR = path.resolve(process.cwd(), "..", "docs", "redesign-v2");

/** Capture folder for the branch under test: CAPTURE_DIR when set, else
 * docs/redesign-v2/captures/<branch-slug>. Never the Phase 0 baseline folder. */
export function captureDir(): string {
  const dir = process.env.CAPTURE_DIR ?? path.join(DOCS_DIR, "captures", branchSlug());
  if (path.resolve(dir) === path.join(DOCS_DIR, "baseline")) {
    throw new Error(`captureDir: refusing to write into the Phase 0 reference folder ${dir}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read-merge-write one key of a JSON object file (console.json, a11y-report.json, ...). */
export function mergeJsonFile(file: string, key: string, value: unknown): void {
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    current = {};
  }
  current[key] = value;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(current, null, 2));
}

/** Phase 0 baseline console lines per screen (docs/redesign-v2/baseline/console.json),
 * the known noise a live cell is compared against. Empty when the file is absent. */
export function baselineConsoleTexts(screen: string): Set<string> {
  try {
    const baseline = JSON.parse(fs.readFileSync(path.join(DOCS_DIR, "baseline", "console.json"), "utf8")) as Record<
      string,
      { console?: { type: string; text: string }[] }
    >;
    return new Set((baseline[screen]?.console ?? []).map((c) => c.text));
  } catch {
    return new Set();
  }
}
