/**
 * Route verifier: loads a URL, records console errors/warnings, page errors,
 * failed network requests, takes a full-page screenshot, dumps a JSON report.
 * Usage: node verify-route.mjs <url> <outdir> <slug> [width] [height]
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const [url, outdir, slug, w = "1440", h = "900"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const report = { url, slug, width: +w, consoleErrors: [], consoleWarnings: [],
                 pageErrors: [], failedRequests: [], textSample: "" };

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "shell",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    const t = m.type();
    if (t === "error") report.consoleErrors.push(m.text().slice(0, 500));
    else if (t === "warning") report.consoleWarnings.push(m.text().slice(0, 300));
  });
  page.on("pageerror", (e) => report.pageErrors.push(String(e).slice(0, 500)));
  page.on("requestfailed", (r) => {
    const f = r.failure()?.errorText ?? "";
    if (f !== "net::ERR_ABORTED") report.failedRequests.push(`${r.method()} ${r.url()} → ${f}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400) report.failedRequests.push(`${r.request().method()} ${r.url()} → HTTP ${r.status()}`);
  });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1200));
  report.textSample = await page.evaluate(() => document.body.innerText.slice(0, 3000));
  await page.screenshot({ path: path.join(outdir, `${slug}-${w}.png`), fullPage: true });
} catch (e) {
  report.pageErrors.push("HARNESS: " + String(e).slice(0, 300));
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(outdir, `${slug}-${w}.json`), JSON.stringify(report, null, 2));
const bad = report.consoleErrors.length + report.pageErrors.length + report.failedRequests.length;
console.log(`${slug}@${w}: ${bad === 0 ? "CLEAN" : `${report.consoleErrors.length} console-err, ${report.pageErrors.length} page-err, ${report.failedRequests.length} failed-req`}`);
