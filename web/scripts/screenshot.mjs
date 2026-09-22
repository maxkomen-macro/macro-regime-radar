/**
 * Full-page screenshot via the system Chrome (puppeteer-core, headless).
 * Usage: node scripts/screenshot.mjs <url> <outfile.png> [widthxheight] [flags]
 * Default viewport 1440x900 (desktop). Waits for network idle + fonts.
 *
 * Flags (desk/frame, 2026-09-21; all optional, the two-argument form is unchanged):
 *   --print                 emulate the print media type (the client one-pager)
 *   --css "<rules>"         inject a style tag before capture ("before" renders)
 *   --local key=<json>      seed one localStorage key before the page loads
 *   --click "<selector>"    click one element after load, then wait 600 ms
 *   --reduced-motion        emulate prefers-reduced-motion: reduce
 */

import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const positional = [];
const flags = { print: false, css: null, local: [], click: null, reducedMotion: false };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--print") flags.print = true;
  else if (a === "--reduced-motion") flags.reducedMotion = true;
  else if (a === "--css") flags.css = args[++i];
  else if (a === "--click") flags.click = args[++i];
  else if (a === "--local") flags.local.push(args[++i]);
  else positional.push(a);
}
const [url, out, size = "1440x900"] = positional;
if (!url || !out) {
  console.error("usage: node scripts/screenshot.mjs <url> <outfile.png> [WxH] [--print] [--css rules] [--local key=json] [--click selector] [--reduced-motion]");
  process.exit(1);
}
const [width, height] = size.split("x").map(Number);

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "shell",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  if (flags.local.length) {
    const seeds = flags.local.map((kv) => {
      const at = kv.indexOf("=");
      return [kv.slice(0, at), kv.slice(at + 1)];
    });
    await page.evaluateOnNewDocument((entries) => {
      for (const [k, v] of entries) {
        try {
          localStorage.setItem(k, v);
        } catch {
          /* storage unavailable */
        }
      }
    }, seeds);
  }
  if (flags.reducedMotion) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  if (flags.css) await page.addStyleTag({ content: flags.css });
  if (flags.click) {
    await page.click(flags.click);
    await new Promise((r) => setTimeout(r, 600));
  }
  if (flags.print) await page.emulateMediaType("print");
  await new Promise((r) => setTimeout(r, 700)); // let pulses/gauge fills settle
  await page.screenshot({ path: out, fullPage: true });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
