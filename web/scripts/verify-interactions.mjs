/**
 * Phase-2 interaction verifier: exercises the app's key flows headlessly and
 * writes a JSON verdict per step + screenshots. Evidence tool — no opinions.
 * Usage: node web/scripts/verify-interactions.mjs <outdir>
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const outdir = process.argv[2] ?? "interaction-evidence";
fs.mkdirSync(outdir, { recursive: true });
const results = [];
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "shell",
  args: ["--hide-scrollbars", "--force-device-scale-factor=1"],
});

async function step(name, fn) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 300)));
  page.on("pageerror", (e) => errs.push("PAGE: " + String(e).slice(0, 300)));
  page.on("response", (r) => r.status() >= 400 && errs.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`));
  try {
    const detail = await fn(page);
    await page.screenshot({ path: path.join(outdir, `${name}.png`) });
    results.push({ name, ok: errs.length === 0, detail, errs });
    console.log(`${name}: ${errs.length === 0 ? "OK" : "ERRORS"} — ${detail}${errs.length ? " | " + errs[0] : ""}`);
  } catch (e) {
    try { await page.screenshot({ path: path.join(outdir, `${name}-FAIL.png`) }); } catch {}
    results.push({ name, ok: false, detail: String(e).slice(0, 300), errs });
    console.log(`${name}: FAIL — ${String(e).slice(0, 200)}`);
  }
  await page.close();
}

const goto = async (page, url) => {
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1000));
};
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));
const clickButton = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t));
    if (!b) throw new Error(`no button containing "${t}"`);
    b.click();
  }, text);
const setSlider = (page, idx, val) =>
  page.evaluate((i, v) => {
    const els = [...document.querySelectorAll('input[type="range"]')];
    if (!els[i]) throw new Error(`no range input #${i} (found ${els.length})`);
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    set.call(els[i], v);
    els[i].dispatchEvent(new Event("input", { bubbles: true }));
    els[i].dispatchEvent(new Event("change", { bubbles: true }));
    return els[i].getAttribute("aria-label") || els[i].closest("label")?.textContent?.slice(0, 40) || `range#${i}`;
  }, idx, val);

// 1. Chart deep-link, daily candles
await step("chart-deeplink-daily", async (p) => {
  await goto(p, "http://localhost:5173/app/markets?chart=SPY");
  await settle(2500);
  const n = await p.evaluate(() => document.querySelectorAll("canvas").length);
  if (n === 0) throw new Error("no chart canvas rendered");
  return `SPY daily panel open, ${n} canvas element(s)`;
});

// 2. Chart deep-link, intraday
await step("chart-deeplink-intraday", async (p) => {
  await goto(p, "http://localhost:5173/app/markets?chart=SPY&mode=intraday");
  await settle(2500);
  const n = await p.evaluate(() => document.querySelectorAll("canvas").length);
  if (n === 0) throw new Error("no chart canvas rendered");
  const txt = await p.evaluate(() => document.body.innerText);
  return `intraday mode canvas=${n}; page mentions intraday: ${/intraday|5.?min/i.test(txt)}`;
});

// 3. Cmd+K palette → navigate
await step("cmdk-palette", async (p) => {
  await goto(p, "http://localhost:5173/app/dashboard");
  await p.keyboard.down("Control"); await p.keyboard.press("k"); await p.keyboard.up("Control");
  await settle(600);
  const open = await p.evaluate(() => !!document.querySelector('input[placeholder]'));
  if (!open) throw new Error("palette did not open on ctrl+k");
  await p.keyboard.type("credit"); await settle(400);
  await p.keyboard.press("Enter"); await settle(1200);
  const url = p.url();
  if (!url.includes("credit")) throw new Error(`palette enter landed on ${url}`);
  return `palette opened, typed credit, navigated to ${url}`;
});

// 4. Alert drawer
await step("alert-drawer", async (p) => {
  await goto(p, "http://localhost:5173/app/dashboard");
  await p.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /alert/i.test(x.getAttribute("aria-label") ?? "") || /ALERTS|all clear/.test(x.textContent));
    if (!b) throw new Error("no alerts trigger");
    b.click();
  });
  await settle(800);
  const txt = await p.evaluate(() => document.body.innerText);
  if (!/alert/i.test(txt)) throw new Error("drawer content not visible");
  return "drawer opened";
});

// 5. News filters
await step("news-filters", async (p) => {
  await goto(p, "http://localhost:5173/app/news");
  const before = await p.evaluate(() => document.body.innerText.length);
  await clickButton(p, "24H"); await settle(1500);
  await clickButton(p, "MACRO"); await settle(1500);
  const after = await p.evaluate(() => document.body.innerText.length);
  return `filters clicked (24H, MACRO); text ${before}→${after}`;
});

// 6. Regime Lab scenario preset
await step("regimelab-scenario", async (p) => {
  await goto(p, "http://localhost:5173/app/regime-lab");
  await clickButton(p, "Credit Crisis"); await settle(2500);
  const txt = await p.evaluate(() => document.body.innerText);
  if (!/stressed|Stressed/.test(txt)) throw new Error("no stressed odds after preset click");
  return "Credit Crisis preset scored, stressed odds rendered";
});

// 7. Recession sensitivity slider
await step("recession-sensitivity", async (p) => {
  await goto(p, "http://localhost:5173/app/recession");
  await clickButton(p, "Move the model"); await settle(1200);
  const label = await setSlider(p, 0, "1200"); await settle(2500);
  const txt = await p.evaluate(() => document.body.innerText);
  const m = txt.match(/adjusted[^%]*?([\d.]+)%/i);
  return `expanded, moved slider (${label}); adjusted reading: ${m ? m[1] + "%" : "n/a — check screenshot"}`;
});

// 8. LBO sliders + grid
await step("lbo-sliders", async (p) => {
  await goto(p, "http://localhost:5173/app/tools#lbo");
  await settle(2000);
  const before = await p.evaluate(() => (document.body.innerText.match(/([\d.]+)%\s*IRR|IRR[^\d]*([\d.]+)%/i) || [])[0] ?? "");
  const label = await setSlider(p, 0, "9"); await settle(2500);
  const after = await p.evaluate(() => (document.body.innerText.match(/([\d.]+)%\s*IRR|IRR[^\d]*([\d.]+)%/i) || [])[0] ?? "");
  const grid = await p.evaluate(() => document.body.innerText.includes("n/a") || /sensitivity/i.test(document.body.innerText));
  return `slider (${label}) moved: IRR "${before}" → "${after}"; sensitivity grid present: ${grid}`;
});

fs.writeFileSync(path.join(outdir, "report.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} interaction steps OK${bad.length ? " — FAILURES: " + bad.map((b) => b.name).join(", ") : ""}`);
await browser.close();
