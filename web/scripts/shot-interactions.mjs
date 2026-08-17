// One-off evidence captures for interaction states a URL alone can't reach
// (night-2): Regime Lab with a scenario selected, Recession with the
// sensitivity panel expanded. Usage: node web/scripts/shot-interactions.mjs
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "shell",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function shot(url, out, clickText, anchorId) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1200));
  await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t));
    b?.click();
  }, clickText);
  await new Promise((r) => setTimeout(r, 1500));
  if (anchorId) {
    await page.evaluate((id) => document.getElementById(id)?.scrollIntoView(), anchorId);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: out });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
  console.log(`saved ${out}`);
  await page.close();
}

try {
  await shot(
    "http://localhost:5173/app/regime-lab",
    "docs/redesign/screenshots/web/regimelab-scenario.png",
    "Credit Crisis",
    "scenarios",
  );
  await shot(
    "http://localhost:5173/app/recession",
    "docs/redesign/screenshots/web/recession-sensitivity.png",
    "Move the model",
    "sensitivity",
  );
} finally {
  await browser.close();
}
