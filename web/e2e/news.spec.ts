/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.3:
 * the P8 browser check on /app/news, steps 1 to 11, 14 and 15, driven
 * against the running Vite dev server (playwright.config.ts baseURL and the
 * 1672x941 viewport; servers are never started here). Real clicks and keys
 * only; the assistant panel is never opened, typed into or sent from.
 * Captures land in docs/redesign-v2/captures/redesign-08-news/ (CAPTURE_DIR
 * overrides). Steps 12 and 13 are the existing sections, parity, news-links
 * and regression specs, run separately. Where an assertion depends on what
 * the DB serves on verify day (the focus event, the strip state, an empty
 * window on the local snapshot DB, WIRE SUMMARY on every lead card because
 * no keys ran the enrichment locally, the calendar on its stored-schedule
 * fallback), the served payload is read from the API first, the B rules are
 * recomputed locally, and the outcome is recorded as a test annotation.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { collect, settle } from "./lib/drive";

const DOCS = path.resolve(process.cwd(), "..", "docs", "redesign-v2");
const CAPTURE_DIR = process.env.CAPTURE_DIR ?? path.join(DOCS, "captures", "redesign-08-news");
const BASELINE_CONSOLE = path.join(DOCS, "baseline", "console.json");
const ROUTE = "/app/news";

const git = (a: string) => execSync(`git ${a}`, { encoding: "utf8" }).trim();
const BRANCH = git("rev-parse --abbrev-ref HEAD"); // the branch under test, never a fixed name: the spec runs on every later branch
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Summary row labels in B.2 order; Top significance is omitted while no story is on file. Iteration 1
 * (N2) adds served rows that render only when there is something to count: Next high impact (the
 * countdown event when it is not one of the first two rows), Last release, By category, Outlets and
 * AI reads. */
const SUMMARY_LABELS = ["Next event", "After that", "Next high impact", "Last release", "Coverage", "By category", "Outlets", "AI reads", "Top significance", "High impact"];
const OPTIONAL_LABELS = new Set(["Next high impact", "Last release", "By category", "Outlets", "AI reads", "Top significance"]);
const TILE_LABELS = ["HEADLINES", "HIGH IMPACT · ≥3.5", "M&A", "MACRO / FED", "GEOPOLITICAL"];
const COUNTDOWN = /(?:today|tomorrow|in \d+ days)$/;
const HERO_H1 = /(?:today|tomorrow|in \d+ days)$|^No events in the next 30 days$|^No events on file$|^Calendar unavailable/;
// Iteration 1 step 6 (A3): "Feed as of unknown" when /api/freshness serves no news verdict (no client clock any more).
const STRIP_TITLE = /^(?:Fallback coverage|Feed on time|Feed delayed|Feed stale|Feed unavailable|Feed as of unknown|Reading feed health…)$/;
/** Computed dot colours per B.5 (amber / cyan / the --text-4 rung). */
const DOT_RGB: Record<string, string> = { high: "rgb(245, 181, 46)", medium: "rgb(60, 200, 240)", low: "rgb(111, 125, 138)" };
const ELAPSED_RGB = "rgb(95, 108, 120)"; // var(--text-4): the shared impact table's quiet rung (calendar-impact.ts)

interface CalendarEvent {
  id: number;
  event_name: string;
  event_datetime: string;
  importance: string | null;
  source: string | null;
}
interface SlaRow {
  feed: string;
  verdict: string;
  reason: string;
}
interface Freshness {
  news_published_at: string | null;
  sla?: SlaRow[] | null;
}

/* ── local copies of the B.1 rules the hero is checked against ────────────── */

const ET_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
/** A stored stamp with no zone is UTC (lib/format.ts fmtUtcStampEt). */
const asUtc = (ts: string) => (/(?:Z|[+-]\d{2}:?\d{2})$/.test(ts) ? ts.replace(" ", "T") : `${ts.replace(" ", "T")}Z`);
const dayKeyEt = (ts: string | number) => ET_DAY.format(new Date(typeof ts === "string" ? asUtc(ts) : ts));
function dayDeltaEt(ts: string, now: number): number {
  const toUtcDay = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtcDay(dayKeyEt(ts)) - toUtcDay(dayKeyEt(now))) / 86_400_000);
}
const isHigh = (e: CalendarEvent) => (e.importance ?? "").toLowerCase() === "high";
const focusEvent = (rows: CalendarEvent[]) => rows.find(isHigh) ?? rows[0] ?? null;
const inside18 = (rows: CalendarEvent[], now: number) => rows.filter((e) => {
  const d = dayDeltaEt(e.event_datetime, now);
  return d >= 0 && d < 18;
});

/* ── page helpers ─────────────────────────────────────────────────────────── */

async function open(page: Page, route = ROUTE): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 900);
}

const hero = (page: Page) => page.locator("#news-hero");
const summary = (page: Page) => page.locator("#news-summary");
const headlines = (page: Page) => page.locator("#headlines");
const feed = (page: Page) => page.locator("#feed");
const calendar = (page: Page) => page.locator("#calendar");
const rows = (page: Page) => feed(page).locator(".mrr-news-row");
const articles = (page: Page) => headlines(page).locator("article");
const strip = (page: Page) => summary(page).locator('button[aria-haspopup="dialog"]');
const segGroup = (page: Page, label: string) => feed(page).locator(`.mrr-seg[aria-label="${label}"]`);
const segOption = (page: Page, group: string, name: string) => segGroup(page, group).getByRole("button", { name, exact: true });
const viewGroup = (page: Page) => calendar(page).locator('.mrr-seg[aria-label="Calendar view"]');
const viewOption = (page: Page, name: string) => viewGroup(page).getByRole("button", { name, exact: true });
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

/** True when the element's top edge sits inside the viewport. */
async function inView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}
/** innerText of a locator (hidden panels and closed accordions excluded, CSS text-transform applied), whitespace collapsed. */
async function visibleText(loc: Locator): Promise<string> {
  return clean(await loc.innerText());
}
/** textContent of a locator (no text-transform), whitespace collapsed. */
async function contentText(loc: Locator): Promise<string> {
  return clean((await loc.textContent()) ?? "");
}
const onFallback = async (page: Page) => (await visibleText(page.locator("main"))).includes("significance filter not applied");

async function servedCalendar(page: Page): Promise<CalendarEvent[]> {
  const r = await page.request.get("/api/calendar?days=30");
  expect(r.status(), "/api/calendar?days=30").toBe(200);
  return (await r.json()) as CalendarEvent[];
}
async function servedFreshness(page: Page): Promise<Freshness> {
  const r = await page.request.get("/api/freshness");
  expect(r.status(), "/api/freshness").toBe(200);
  return (await r.json()) as Freshness;
}
async function awaitHero(page: Page): Promise<void> {
  await expect(page.locator("main h1")).toHaveText(HERO_H1, { timeout: 60_000 });
}
async function awaitSummary(page: Page): Promise<void> {
  await expect.poll(() => summary(page).locator("dt").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(4);
}
/** The feed has answered: lead cards or rows are on the page, or the empty note. */
async function awaitFeed(page: Page): Promise<void> {
  await expect
    .poll(async () => (await articles(page).count()) + (await rows(page).count()) + (await headlines(page).getByText(/Nothing on file/).count()), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(strip(page)).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => contentText(strip(page).locator(".mrr-status-title")), { timeout: 30_000 }).not.toMatch(/Reading feed health/);
}
/** Significance readouts visible inside a root ("SIG 4.4 / 5" → 4.4). */
async function sigValues(root: Locator): Promise<number[]> {
  const texts = await root.locator("[data-score]").allInnerTexts();
  return texts.map((t) => Number(/(\d\.\d) \/ 5/.exec(clean(t))?.[1] ?? NaN));
}
/** Number of external new-tab links inside a locator. */
const extLinks = (root: Locator) => root.locator('a[href^="http"][target="_blank"]').count();

async function capture(page: Page, file: string, target?: Locator, fullPage = true): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const p = path.join(CAPTURE_DIR, file);
  if (target) await target.screenshot({ path: p });
  else await page.screenshot({ path: p, fullPage });
  expect(fs.existsSync(p), file).toBe(true);
  expect(fs.statSync(p).size, file).toBeGreaterThan(0);
}

test.describe("news (checklist 08 E.3)", () => {
  test("1. branch and stamp: the dev build stamp names the checked-out branch and commit; one uvicorn, one Vite, the API answering", async ({ page }) => {
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
    // One Vite dev server on :5173 (strictPort refuses a second anyway); tolerate a remote baseURL (0 listeners).
    const vitePids = new Set(
      execSync("lsof -nP -iTCP:5173 -sTCP:LISTEN -Fp 2>/dev/null || true", { encoding: "utf8" })
        .split("\n")
        .filter((l) => /^p\d+$/.test(l)),
    );
    expect(vitePids.size, `expected at most one process listening on :5173, saw ${[...vitePids].join(", ")}`).toBeLessThanOrEqual(1);
    for (const url of ["/api/news?hours=168&limit=150", "/api/news/latest?limit=50", "/api/calendar?days=30", "/api/calendar/recent?limit=10", "/api/freshness"]) {
      expect((await page.request.get(url)).status(), url).toBe(200);
    }
  });

  test("2. health: no console noise beyond the Phase 0 baseline and no failed /api responses, the 60 s poll included", async ({ page }) => {
    const sink = collect(page);
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await awaitFeed(page);
    await settle(page, 1500);
    const baseline = JSON.parse(fs.readFileSync(BASELINE_CONSOLE, "utf8")) as Record<string, { console: { type: string; text: string }[]; failed: { url: string; status: number }[] }>;
    const known = new Set((baseline.news?.console ?? []).map((c) => c.text));
    const fresh = sink.console.filter((c) => !known.has(c.text));
    expect(fresh, JSON.stringify(fresh, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
    // The feed polls every 60 s: wait one cycle and re-check the same sink.
    await page.waitForTimeout(65_000);
    const later = sink.console.filter((c) => !known.has(c.text));
    expect(later, JSON.stringify(later, null, 2)).toEqual([]);
    expect(sink.failed, JSON.stringify(sink.failed, null, 2)).toEqual([]);
    const counter = /(\d+) new this session/.exec(await contentText(feed(page).locator(".mrr-sec-head")));
    note("poll", counter ? `${counter[1]} new this session landed on the poll` : "no new row landed on the 60 s poll");
  });

  test("3. hero: one serif h1 counting down to the first high-impact served event, the amber High impact pill, the h2 naming the first served event, the lede's lead sentence", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const h1 = page.locator("main h1");
    await expect(h1).toHaveCount(1);
    expect(await hero(page).locator("h1").count()).toBe(1);
    const served = await servedCalendar(page);
    const now = Date.now();
    const focus = focusEvent(served);
    const h1Text = await contentText(h1);
    note("h1", h1Text);
    if (focus) {
      expect(h1Text).toMatch(COUNTDOWN);
      expect(h1Text.startsWith(focus.event_name), `h1 "${h1Text}" names ${focus.event_name}`).toBe(true);
      const delta = dayDeltaEt(focus.event_datetime, now);
      expect(h1Text.endsWith(delta === 0 ? " today" : delta === 1 ? " tomorrow" : ` in ${delta} days`)).toBe(true);
      const pill = hero(page).locator(".mrr-pill");
      await expect(pill).toHaveCount(1);
      const pillText = await contentText(pill);
      if (isHigh(focus)) {
        expect(pillText).toBe("High impact");
        await expect(pill).toHaveAttribute("data-tone", "amber");
      } else {
        expect(["Medium impact", "Low impact", "Impact not rated"]).toContain(pillText);
        await expect(pill).toHaveAttribute("data-tone", "gray");
        note("pill", `no high-impact row in the 30-day window; pill reads ${pillText}`);
      }
      const h2 = await contentText(hero(page).locator("h2"));
      expect(h2.startsWith(`${served[0].event_name} on `), `h2 "${h2}" opens with the first served event`).toBe(true);
    } else {
      expect(["No events in the next 30 days", "No events on file"]).toContain(h1Text);
      note("calendar", `empty 30-day window on verify day (G10): h1 reads "${h1Text}"`);
    }
    const family = await h1.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family.replace(/^["']/, "")).toMatch(/^Source Serif 4/);
    await expect(hero(page).locator(".mrr-hero-eyebrow")).toContainText(/Next on the calendar/i);
    await awaitFeed(page);
    const lede = await contentText(hero(page).locator(".mrr-hero-lede"));
    if (/leads the/.test(lede)) {
      expect(lede).toMatch(/leads the (?:stored )?file: .+ at \d\.\d \/ 5, the (?:stored )?window's highest score\./);
      expect(lede).toMatch(/No model interpretation was stored|leads the .*\. .+/);
    } else {
      expect(lede).toBe("No headlines on file.");
      note("lede", "empty feed on verify day: the lede reads No headlines on file.");
    }
  });

  test("4. hero buttons: Open the calendar puts #calendar in view; Filter headlines puts #feed in view", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitFeed(page);
    const openCal = hero(page).getByRole("link", { name: "Open the calendar" });
    await expect(openCal).toHaveAttribute("href", "/app/news#calendar");
    await openCal.click();
    await expect(page).toHaveURL(/\/app\/news#calendar$/);
    await expect.poll(() => inView(page, "calendar"), { timeout: 15_000 }).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    const filter = hero(page).getByRole("link", { name: "Filter headlines" });
    await expect(filter).toHaveAttribute("href", "/app/news#feed");
    await filter.click();
    await expect(page).toHaveURL(/\/app\/news#feed$/);
    await expect.poll(() => inView(page, "feed"), { timeout: 15_000 }).toBe(true);
  });

  test("5. timeline: the hero image with one circle per served event inside 18 ET days and an amber circle per high-impact one", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    const svg = hero(page).locator("svg[role='img']");
    await expect(svg).toHaveCount(1);
    // Iteration 1 (N1): the name counts large-cap earnings only when the window holds any.
    await expect(svg).toHaveAttribute("aria-label", /^Macro events over the next 18 days: \d+ events, \d+ high impact(?:, \d+ large-cap earnings)?$/);
    const served = await servedCalendar(page);
    const shown = inside18(served, Date.now());
    await expect(svg.locator("circle")).toHaveCount(shown.length);
    await expect(svg.locator('circle[fill="var(--amber)"]')).toHaveCount(shown.filter(isHigh).length);
    note("timeline", `${shown.length} of ${served.length} served events inside 18 ET days, ${shown.filter(isHigh).length} high impact`);
    if (shown.length === 0) {
      const t = await contentText(svg);
      expect(t).toMatch(/No events in the next 18 days · next: |Stored schedule ends |No events on file\./);
      note("timeline-state", t);
    }
  });

  test("6. summary: the dt labels in B.2 order, no Consensus anywhere, the strip opens the freshness drawer whose News feed verdict agrees with the strip, Esc closes it and returns focus", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await awaitFeed(page);
    await settle(page, 600);
    const dts = summary(page).locator("dt");
    const labels = (await dts.allTextContents()).map(clean);
    const expected = SUMMARY_LABELS.filter((l) => !OPTIONAL_LABELS.has(l) || labels.includes(l));
    expect(labels).toEqual(expected);
    note("summary-rows", labels.join(" · "));
    if (!labels.includes("Top significance")) note("top-significance", "absent: no story on file on verify day");
    await expect(summary(page).locator("h2")).toHaveText(/^Desk summary$/i);
    for (const dd of await summary(page).locator("dd").all()) expect(clean(await dd.innerText())).not.toBe("");
    expect(await contentText(page.locator("main"))).not.toMatch(/Consensus/);

    await expect(strip(page)).toHaveCount(1);
    await expect(strip(page)).toHaveClass(/mrr-status/);
    const title = await contentText(strip(page).locator(".mrr-status-title"));
    expect(title).toMatch(STRIP_TITLE);
    const detail = await contentText(strip(page).locator("small"));
    const tone = (await strip(page).getAttribute("data-tone")) ?? "";
    expect(await strip(page).getAttribute("aria-label")).toMatch(new RegExp(`^${escapeRe(title)}\\. .*Open the data freshness breakdown\\.$`));
    note("strip", `${title} · ${detail} · tone ${tone}`);
    if (title === "Feed on time") expect(tone).toBe("mint");
    else if (/^Feed (?:delayed|stale)$|^Fallback coverage$/.test(title)) expect(tone).toBe("amber");
    else expect(tone).toBe("gray");

    await strip(page).click();
    const drawer = page.getByRole("dialog", { name: "Data freshness" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("id", "freshness-drawer");
    const fresh = await servedFreshness(page);
    const slaNews = fresh.sla?.find((r) => r.feed === "news");
    if (slaNews && title.startsWith("Feed ")) {
      const row = drawer.locator("table tr").filter({ hasText: "News feed" }).first();
      await expect(row).toHaveCount(1);
      const verdict = (await contentText(row.locator("td").nth(1))).toLowerCase();
      expect(verdict, `drawer News feed verdict "${verdict}" vs strip "${title}"`).toContain(title.replace(/^Feed /, "").toLowerCase());
      note("drawer", `News feed ${verdict} ⇔ ${title}`);
    } else {
      note("drawer", slaNews ? `strip on ${title}: no drawer word to compare` : "no sla row served (snapshot mode or an older payload): the client clock filled the strip");
    }
    await capture(page, "news--freshness-drawer.png", page.locator("body"));
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(strip(page)).toBeFocused();
  });

  test("7. priority headlines: four lead articles with safe h3 links, SIG x / 5 with five dots, the AI or wire label, Regime read opening N links, Score breakdown, Read at, How scoring works landing on Methodology #ramps", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitFeed(page);
    const n = await articles(page).count();
    if (n === 0) {
      await expect(headlines(page)).toContainText("Nothing on file; the news pipeline has not stored headlines yet.");
      note("headlines", "empty feed on verify day: the empty note is on screen");
      return;
    }
    expect(n).toBe(4);
    const title = await contentText(headlines(page).locator("h2").first());
    expect(["Priority headlines", "Latest stored headlines"]).toContain(title);
    note("headlines-title", title);
    let wire = 0;
    let ai = 0;
    for (let i = 0; i < n; i++) {
      const a = articles(page).nth(i);
      const link = a.locator("h3 a");
      await expect(link).toHaveCount(1);
      expect(await link.getAttribute("href")).toMatch(/^http/);
      await expect(link).toHaveAttribute("target", "_blank");
      expect((await link.getAttribute("rel")) ?? "").toContain("noreferrer");
      const text = await visibleText(a);
      expect(text).toMatch(/SIG \d\.\d \/ 5/);
      await expect(a.locator("i")).toHaveCount(5);
      const labelled = /WHY IT MATTERS · AI/.test(text) ? "ai" : /WIRE SUMMARY/.test(text) ? "wire" : null;
      expect(labelled, `article ${i + 1} carries an AI or wire label`).not.toBeNull();
      if (labelled === "ai") ai++;
      else wire++;
      const readAt = a.getByRole("link", { name: /^Read at .+ →$/ });
      await expect(readAt).toHaveCount(1);
      expect(await readAt.getAttribute("href")).toBe(await link.getAttribute("href"));
      const regime = a.getByRole("button", { name: /Regime read/ });
      if ((await regime.count()) === 1) {
        const name = clean((await regime.textContent()) ?? "");
        const expectedN = Number(/· (\d+) sources/.exec(name)?.[1] ?? 0);
        const before = await extLinks(a);
        await regime.click();
        await expect(regime).toHaveAttribute("aria-expanded", "true");
        await expect.poll(() => extLinks(a)).toBe(before + expectedN);
        if (expectedN > 0) await expect(a).toContainText(/PERPLEXITY SOURCES/);
        if (i === 0) await capture(page, "news--regime-read-open.png", a);
        note(`regime-read-${i + 1}`, `${name}: ${expectedN} source links`);
      }
    }
    note("labels", `${ai} lead cards read WHY IT MATTERS · AI, ${wire} read WIRE SUMMARY${wire === n ? " (local DB: no enrichment ran, accepted as a pass)" : ""}`);
    const breakdown = articles(page).first().getByRole("button", { name: /Score breakdown/ });
    await expect(breakdown).toHaveCount(1);
    await expect(breakdown).toHaveAttribute("aria-expanded", "false");
    await breakdown.click();
    await expect(breakdown).toHaveAttribute("aria-expanded", "true");
    const first = await contentText(articles(page).first());
    const dims = first.match(/(?:Market impact|Regime relevance|Sector reach|Timeliness at ingest) (?:\d \/ 5|[^A-Za-z\d\s])/g) ?? [];
    expect(dims, `four score readouts in "${first}"`).toHaveLength(4);
    note("score-breakdown", dims.join(" · "));
    await capture(page, "news--score-breakdown-open.png", articles(page).first());
    const how = headlines(page).getByRole("link", { name: "How scoring works →" });
    await expect(how).toHaveAttribute("href", "/app/methodology#ramps");
    await how.click();
    await expect(page).toHaveURL(/\/app\/methodology#ramps$/);
    await expect.poll(() => inView(page, "ramps"), { timeout: 15_000 }).toBe(true);
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/news$/);
  });

  test("8. filters change the list: 24H, MACRO and ≥ 3.5 high each fire their request, flip aria-pressed and narrow the rows; then 7D / ALL / ANY SIG restore", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitFeed(page);
    const firstBefore = (await rows(page).count()) ? await contentText(rows(page).first().locator('a[href^="http"]').first()) : "(no rows)";
    await expect(segOption(page, "Window", "7D")).toHaveAttribute("aria-pressed", "true");

    const hours = page.waitForResponse((r) => r.url().includes("/api/news?") && /[?&]hours=24(&|$)/.test(r.url()), { timeout: 30_000 });
    await segOption(page, "Window", "24H").click();
    await expect(segOption(page, "Window", "24H")).toHaveAttribute("aria-pressed", "true");
    await expect(segOption(page, "Window", "7D")).toHaveAttribute("aria-pressed", "false");
    expect((await hours).status()).toBe(200);
    await settle(page, 600);
    const desc24 = await contentText(feed(page).locator(".mrr-sec-desc"));
    if (await onFallback(page)) {
      expect(desc24).toMatch(/most recent stored$/);
      note("24H", "empty 24H window on verify day: the fallback note is on screen");
    } else {
      expect(desc24).toMatch(/in the last 24H$/);
    }
    const firstAfter = (await rows(page).count()) ? await contentText(rows(page).first().locator('a[href^="http"]').first()) : "(no rows)";
    note("first-row", `7D: ${firstBefore} → 24H: ${firstAfter}`);

    const category = page.waitForResponse((r) => r.url().includes("/api/news") && /[?&]category=MACRO(&|$)/.test(r.url()), { timeout: 30_000 });
    await segOption(page, "Category", "MACRO").click();
    await expect(segOption(page, "Category", "MACRO")).toHaveAttribute("aria-pressed", "true");
    await expect(segOption(page, "Category", "ALL")).toHaveAttribute("aria-pressed", "false");
    expect((await category).status()).toBe(200);
    await settle(page, 600);
    if (await onFallback(page)) {
      note("MACRO", "no MACRO rows in the 24H window: the fallback note is on screen");
    } else {
      const badges = await rows(page).allInnerTexts();
      for (const t of badges) expect(clean(t), "every row badge reads MACRO").toMatch(/\bMACRO\b/);
      note("MACRO", `${badges.length} rows, every one badged MACRO`);
    }
    await capture(page, "news--filters-24h-macro.png", feed(page));

    const sig = page.waitForResponse((r) => r.url().includes("/api/news") && /[?&]min_significance=3\.5(&|$)/.test(r.url()), { timeout: 30_000 });
    await segOption(page, "Significance", "≥ 3.5 high").click();
    await expect(segOption(page, "Significance", "≥ 3.5 high")).toHaveAttribute("aria-pressed", "true");
    await expect(segOption(page, "Significance", "ANY SIG")).toHaveAttribute("aria-pressed", "false");
    expect((await sig).status()).toBe(200);
    await settle(page, 600);
    if (await onFallback(page)) {
      note("≥ 3.5", "no rows at or above 3.5 in the filtered window: the fallback note is on screen (filter not applied to stored rows)");
    } else {
      const values = (await sigValues(page.locator("main"))).filter((v) => !Number.isNaN(v));
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) expect(v).toBeGreaterThanOrEqual(3.5);
      note("≥ 3.5", `${values.length} readouts, min ${Math.min(...values).toFixed(1)}`);
    }

    await segOption(page, "Window", "7D").click();
    await segOption(page, "Category", "ALL").click();
    await segOption(page, "Significance", "ANY SIG").click();
    await expect(segOption(page, "Window", "7D")).toHaveAttribute("aria-pressed", "true");
    await expect(segOption(page, "Category", "ALL")).toHaveAttribute("aria-pressed", "true");
    await expect(segOption(page, "Significance", "ANY SIG")).toHaveAttribute("aria-pressed", "true");
    await settle(page, 600);
    await expect(feed(page).locator(".mrr-sec-desc")).toContainText(/in the last 7D$|most recent stored$/);
  });

  test("9. rows: a row's Regime read opens to its links (or Wire summary to the summary), Show N more headlines reveals rows, the five count tiles, the fallback state reported", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitFeed(page);
    const tiles = await visibleText(feed(page));
    for (const label of TILE_LABELS) expect(tiles, label).toContain(label);
    const rowCount = await rows(page).count();
    note("rows", `${rowCount} rows on load`);
    if (rowCount > 0) {
      // Anchor the first row that carries a toggle, then read the toggle through
      // a state-independent selector: a locator keyed on aria-expanded='false'
      // would re-resolve to the next collapsed button once this one opens.
      const row = rows(page).filter({ has: page.locator("button[aria-expanded]") }).first();
      const toggle = row.locator("button[aria-expanded]").first();
      if ((await row.count()) === 1) {
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        const name = clean((await toggle.textContent()) ?? "");
        const before = await extLinks(row);
        const textBefore = await visibleText(row);
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        if (/Regime read/.test(name)) {
          const expectedN = Number(/· (\d+) sources/.exec(name)?.[1] ?? 0);
          await expect.poll(() => extLinks(row)).toBe(before + expectedN);
          await expect(row).toContainText(/WHY IT MATTERS · AI/);
        } else {
          expect(name).toMatch(/Wire summary/);
          await expect.poll(() => visibleText(row)).not.toBe(textBefore);
        }
        note("row-toggle", name);
      } else {
        note("row-toggle", "every row on verify day is Headline only");
      }
      const more = feed(page).getByRole("button", { name: /^Show \d+ more headlines$/ });
      if ((await more.count()) === 1) {
        const label = clean((await more.textContent()) ?? "");
        const n = Number(/Show (\d+) more/.exec(label)?.[1]);
        const visibleBefore = await rows(page).count();
        await more.click();
        await expect.poll(() => rows(page).count()).toBe(visibleBefore + n);
        await expect(more).toHaveCount(0);
        note("show-more", `${label}: ${visibleBefore} → ${visibleBefore + n} rows`);
      } else {
        note("show-more", "eight or fewer list rows on verify day: no button");
      }
    }
    if (await onFallback(page)) {
      await expect(headlines(page).locator("h2").first()).toHaveText(/^Latest stored headlines$/i);
      await expect(headlines(page)).toContainText(/significance filter not applied/);
      note("fallback", "the 7D window is empty on verify day: Latest stored headlines and the amber note are on screen");
      await capture(page, "news--fallback.png");
    } else {
      note("fallback", "not reachable today: the 7D window has rows");
    }
  });

  test("10. calendar: Upcoming pressed on load, day-group rows, the dot colour rule, hand-maintained sources, Recent flips every group to elapsed on the quiet rung, Upcoming restores, the legend, every upcoming row rendered", async ({ page }) => {
    const recentResponses: string[] = [];
    page.on("response", (r) => {
      if (r.url().includes("/api/calendar/recent")) recentResponses.push(r.url());
    });
    await open(page);
    await awaitHero(page);
    await expect(viewOption(page, "Upcoming")).toHaveAttribute("aria-pressed", "true");
    await expect(viewOption(page, "Recent")).toHaveAttribute("aria-pressed", "false");
    await expect(calendar(page).locator("h2").first()).toHaveText(/^Macro calendar$/i);
    const legend = await visibleText(calendar(page).locator(".mrr-cal-legend"));
    for (const word of ["IMPACT", "HIGH", "MEDIUM", "LOW", "ET"]) expect(legend, word).toContain(word);
    const served = await servedCalendar(page);
    const groups = calendar(page).locator("tr.mrr-grp");
    const dataRows = calendar(page).locator("tbody tr:not(.mrr-grp)");
    const fallback = served.length === 0;
    if (fallback) {
      note("calendar", "empty 30-day window on the local snapshot DB (G10): the stored-schedule fallback is a pass");
      await expect(calendar(page)).toContainText(/Stored schedule\. No upcoming events in the stored window/);
    }
    const groupCount = await groups.count();
    const rowCount = await dataRows.count();
    note("calendar-rows", `${rowCount} rows under ${groupCount} day groups (${served.length} served upcoming)`);
    if (rowCount > 0) {
      expect(groupCount).toBeGreaterThan(0);
      // Every data row sits under a group row.
      const firstIsGroup = await calendar(page).locator("tbody tr").first().evaluate((tr) => tr.classList.contains("mrr-grp"));
      expect(firstIsGroup).toBe(true);
      const dots = await calendar(page).locator("[data-importance]").evaluateAll((els) => els.map((el) => ({ importance: el.getAttribute("data-importance") ?? "", color: getComputedStyle(el).backgroundColor })));
      expect(dots.length).toBe(rowCount);
      for (const d of dots) expect(d.color, `dot ${d.importance}`).toBe(fallback ? ELAPSED_RGB : (DOT_RGB[d.importance] ?? DOT_RGB.low));
      const sources = (await calendar(page).locator("tbody tr:not(.mrr-grp) td:last-child").allTextContents()).map(clean);
      if (served.some((e) => e.source === "manual_csv") || fallback) expect(sources).toContain("hand-maintained");
      note("sources", [...new Set(sources)].join(" · "));
      if (!fallback) {
        // Iteration 1 (N3): the whole 30-day window renders; the 12-row cap and Show all are gone.
        expect(await dataRows.count()).toBe(served.length);
        await expect(calendar(page).getByRole("button", { name: /^Show all \d+ events$/ })).toHaveCount(0);
        note("show-all", `${served.length} upcoming rows, all rendered, no cap button`);
      }
    }

    await viewOption(page, "Recent").click();
    await expect(viewOption(page, "Recent")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => recentResponses.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await settle(page, 600);
    const recentRows = await dataRows.count();
    note("recent", `${recentRows} recent rows (${recentResponses.length} /api/calendar/recent responses)`);
    if (recentRows > 0) {
      for (const g of await groups.allTextContents()) expect(clean(g)).toMatch(/· elapsed$/i);
      const colors = await calendar(page).locator("[data-importance]").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
      expect(colors.length).toBe(recentRows);
      for (const c of colors) expect(c).toBe(ELAPSED_RGB);
      await expect(calendar(page).locator(".mrr-sec-head")).toContainText(/last 10 on file/i);
    } else {
      await expect(calendar(page)).toContainText("No events on file.");
    }
    await capture(page, "news--calendar-recent.png", calendar(page));

    await viewOption(page, "Upcoming").click();
    await expect(viewOption(page, "Upcoming")).toHaveAttribute("aria-pressed", "true");
    await settle(page, 600);
    await expect(calendar(page).locator(".mrr-sec-head")).toContainText(/next 30 days/i);
    if (!fallback && rowCount > 0) {
      const restored = (await groups.allTextContents()).map(clean);
      expect(restored.some((g) => !/elapsed/i.test(g))).toBe(true);
    }
  });

  test("11. section ids: headlines, calendar, feed, news-hero and news-summary all resolve on the route", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    for (const id of ["headlines", "calendar", "feed", "news-hero", "news-summary"]) {
      expect(await page.evaluate((elId) => Boolean(document.getElementById(elId)), id), id).toBe(true);
    }
    // No heading in the page repeats the h1 role.
    await expect(page.locator("main h1")).toHaveCount(1);
  });

  test("14. at 390 px the hero stacks over the summary, the body is one column, lead cards go one per row, rows stack, the filter bar wraps and nothing scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await awaitFeed(page);
    const boxes = await page.evaluate(() => {
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
      const row = document.querySelector("#feed .mrr-news-row");
      return {
        hero: box("#news-hero"),
        summary: box("#news-summary"),
        headlines: box("#headlines"),
        feed: box("#feed"),
        calendar: box("#calendar"),
        articles: [...document.querySelectorAll("#headlines article")].map((a) => a.getBoundingClientRect()),
        segs: [...document.querySelectorAll("#feed .mrr-seg")].map((s) => s.getBoundingClientRect()),
        rowLink: row?.querySelector("a[href^='http']")?.getBoundingClientRect() ?? null,
        rowScore: row?.querySelector("[data-score]")?.getBoundingClientRect() ?? null,
        chips: document.querySelectorAll("#news-hero .mrr-hero-chips span").length,
      };
    });
    for (const k of ["hero", "summary", "headlines", "feed", "calendar"] as const) expect(boxes[k], k).not.toBeNull();
    expect((boxes.summary as DOMRect).top).toBeGreaterThanOrEqual((boxes.hero as DOMRect).bottom - 1);
    expect(Math.abs((boxes.summary as DOMRect).left - (boxes.hero as DOMRect).left)).toBeLessThan(2);
    expect((boxes.feed as DOMRect).top).toBeGreaterThanOrEqual((boxes.headlines as DOMRect).bottom - 1);
    expect((boxes.calendar as DOMRect).top).toBeGreaterThanOrEqual((boxes.feed as DOMRect).bottom - 1);
    for (let i = 1; i < boxes.articles.length; i++) {
      expect(Math.abs(boxes.articles[i].left - boxes.articles[0].left), `lead card ${i + 1} left edge`).toBeLessThan(2);
      expect(boxes.articles[i].top, `lead card ${i + 1} below card ${i}`).toBeGreaterThanOrEqual(boxes.articles[i - 1].bottom - 1);
    }
    expect(boxes.segs).toHaveLength(3);
    expect(boxes.segs[2].top, "the filter bar wraps").toBeGreaterThan(boxes.segs[0].top + 1);
    if (boxes.rowLink && boxes.rowScore) expect(boxes.rowScore.top, "the row's score sits under its headline").toBeGreaterThanOrEqual(boxes.rowLink.bottom - 1);
    else note("rows", "no list rows on verify day: the row stack is not measurable");
    expect(boxes.chips, "no freshness chips on a phone").toBe(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, "overflow at 390 px").toBeLessThanOrEqual(0);
    await capture(page, "news--390.png");
  });

  test("15. captures: the full page at 1672 for the region-by-region compare with news.png", async ({ page }) => {
    await open(page);
    await awaitHero(page);
    await awaitSummary(page);
    await awaitFeed(page);
    await expect(hero(page).locator("svg[role='img']")).toHaveCount(1, { timeout: 30_000 });
    await expect(calendar(page).locator("h2").first()).toHaveText(/^Macro calendar$/i);
    await expect(viewOption(page, "Upcoming")).toHaveAttribute("aria-pressed", "true");
    await settle(page, 1200);
    await capture(page, "news.png");
    expect(fs.existsSync(path.join(DOCS, "news.png")), "the approved mockup the verifier compares against").toBe(true);
    note("fallback-capture", (await onFallback(page)) ? "news--fallback.png captured in step 9" : "news--fallback.png not reachable today: the 7D window has rows");
  });
});
