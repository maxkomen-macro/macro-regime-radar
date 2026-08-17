// One-off: screenshot /app/dashboard with the regime-odds accordion open.
import puppeteer from "puppeteer-core";

const out = process.argv[2];
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "shell",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto("http://localhost:5173/app/dashboard", { waitUntil: "networkidle0", timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button[aria-expanded]")][0];
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: out, fullPage: true });
  console.log(`saved ${out}`);
} finally {
  await browser.close();
}
