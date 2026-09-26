/**
 * Desk v2 compare shots (DESK_FRAME3_SPEC §13): screenshot one Desk tab at
 * 1440 wide with Playwright's Chromium, at the approved PNG's height and 2x
 * density (the PNGs are 2880 px wide), then place it beside the PNG.
 *
 * Needs a dev server answering /api/desk/* from the fixtures:
 *   DESK_FIXTURES=1 npx vite --port 5193
 * Usage:
 *   node scripts/desk-compare.mjs <route> <png-name> [--base URL] [--out DIR] [--click SEL] [--wait MS] [--store FILE]
 *   e.g. node scripts/desk-compare.mjs /desk/overview 01-overview --store src/fixtures/desk/positions.json
 * --store seeds this browser's position store (§9: positions live in the
 * browser) from an Export JSON file before the page loads.
 * Writes <out>/<png-name>.build.png (the build, 2880 px wide) and
 * <out>/<png-name>.png (design left, build right, both at 1440 CSS px).
 * <out> defaults to docs/desk/screens/compare.
 */

import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const args = process.argv.slice(2);
const pos = [];
const opt = { base: "http://127.0.0.1:5193", out: join(repo, "docs/desk/screens/compare"), click: [], wait: 900, store: null };
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") opt.base = args[++i];
  else if (args[i] === "--out") opt.out = resolve(args[++i]);
  else if (args[i] === "--click") opt.click.push(args[++i]);
  else if (args[i] === "--wait") opt.wait = Number(args[++i]);
  else if (args[i] === "--store") opt.store = resolve(args[++i]);
  else pos.push(args[i]);
}
const [route, name] = pos;
if (!route || !name) {
  console.error("usage: node scripts/desk-compare.mjs <route> <png-name> [--base URL] [--out DIR] [--click SEL] [--wait MS]");
  process.exit(1);
}
const design = join(repo, "docs/desk/screens", `${name}.png`);
if (!existsSync(design)) {
  console.error(`no approved PNG at ${design}`);
  process.exit(1);
}

/** PNG width and height from the IHDR chunk. */
function pngSize(file) {
  const b = readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const { w, h } = pngSize(design);
const cssW = Math.round(w / 2);
const cssH = Math.round(h / 2);
mkdirSync(opt.out, { recursive: true });
const buildFile = join(opt.out, `${name}.build.png`);
const pairFile = join(opt.out, `${name}.png`);

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: cssW, height: cssH }, deviceScaleFactor: 2, colorScheme: "dark", reducedMotion: "reduce" });
  if (opt.store) {
    // The position store's key (positions/store.ts POSITIONS_KEY) and the file's records, as Import would keep them.
    const doc = JSON.parse(readFileSync(opt.store, "utf8"));
    const list = Array.isArray(doc) ? doc : doc.positions;
    await page.addInitScript(([key, text]) => localStorage.setItem(key, text), ["mrr.desk.positions.v1", JSON.stringify(list)]);
  }
  await page.goto(`${opt.base}${route}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  for (const sel of opt.click) {
    await page.click(sel);
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(opt.wait);
  await page.screenshot({ path: buildFile, fullPage: true });
  const built = pngSize(buildFile);

  const pair = await browser.newPage({ viewport: { width: cssW * 2 + 48, height: 200 }, deviceScaleFactor: 1 });
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString("base64")}`;
  await pair.setContent(`<!doctype html><html><body style="margin:0;background:#000;font:14px -apple-system,sans-serif;color:#ccc">
    <div style="display:flex;gap:16px;padding:16px;align-items:flex-start">
      <figure style="margin:0;width:${cssW}px"><figcaption style="padding:0 0 8px">Approved design · ${name}.png</figcaption><img style="width:${cssW}px;display:block" src="${img(design)}"></figure>
      <figure style="margin:0;width:${cssW}px"><figcaption style="padding:0 0 8px">Build · ${route} · 1440 wide, fixtures</figcaption><img style="width:${cssW}px;display:block" src="${img(buildFile)}"></figure>
    </div></body></html>`);
  await pair.waitForTimeout(200);
  await pair.screenshot({ path: pairFile, fullPage: true });
  console.log(`design ${w}x${h} · build ${built.w}x${built.h}`);
  console.log(`wrote ${buildFile}`);
  console.log(`wrote ${pairFile}`);
} finally {
  await browser.close();
}
