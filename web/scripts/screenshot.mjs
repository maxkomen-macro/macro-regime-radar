/**
 * Full-page screenshot via the system Chrome (puppeteer-core, headless).
 * Usage: node scripts/screenshot.mjs <url> <outfile.png> [widthxheight]
 * Default viewport 1440x900 (desktop). Waits for network idle + fonts.
 */

import puppeteer from "puppeteer-core";

const [url, out, size = "1440x900"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node scripts/screenshot.mjs <url> <outfile.png> [WxH]");
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
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 700)); // let pulses/gauge fills settle
  await page.screenshot({ path: out, fullPage: true });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
