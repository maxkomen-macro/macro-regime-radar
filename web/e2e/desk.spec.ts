/**
 * Desk v2 in a real browser (DESK_FRAME3_SPEC §1, §13), every request
 * answered from the §12 fixtures (e2e/lib/desk-fixtures.ts), so the specs
 * need only a dev server (never an API) and assert the build's own rules:
 * the sidebar is the only navigation; every computed color on a tab is a
 * §1.3 color; no banned word renders; every card that reads live data
 * carries its badge; every Tab stop has a name and a ring; nothing animates
 * under reduced motion; a phone gets the sidebar from a Menu button with no
 * sideways scroll; a failed endpoint leaves labels and "Awaiting refresh".
 *
 * Run against a dev server: E2E_BASE_URL=http://127.0.0.1:5193 npx playwright test e2e/desk.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { hasRing, tabWalk } from "./lib/a11y";
import { settle } from "./lib/drive";
import { auditPalette, bannedWordsOnPage, routeDesk } from "./lib/desk-fixtures";
import { FIXTURE_META, deskFixture } from "../src/fixtures/desk/index";
import { awaitingEnvelope } from "../src/screens/desk/data/envelope";
import { DESK_GROUPS } from "../src/screens/desk/desk-sections";
import { bpStudy, completeTechnicals } from "../src/test/desk-variants";
import positionSample from "../src/fixtures/desk/positions.json" with { type: "json" };
import { POSITIONS_KEY } from "../src/screens/desk/positions/store";
import basketSample from "../src/fixtures/desk/baskets.json" with { type: "json" };
import { SAVED_BASKETS_KEY } from "../src/screens/desk/basket/weights";

/** A fixture answer's payload: the envelope's `data` (§12.0), for an override to change and serve again. */
function payloadOf(reply: { body: string }): Record<string, unknown> {
  return (JSON.parse(reply.body) as { data: Record<string, unknown> }).data;
}

/** The v2 tabs built so far; each later tab adds itself here. */
const BUILT = ["overview", "technicals", "event-study", "regime", "macro", "sectors", "signal-ledger", "position-monitor", "data-pipeline", "build-notes", "basket-hedge"];

/** The illustrative store (§9: positions live in the browser), set before the app loads on every navigation of this page. */
async function seedPositions(page: Page, list: unknown[] = (positionSample as { positions: unknown[] }).positions): Promise<void> {
  await page.addInitScript(([key, text]) => {
    try {
      localStorage.setItem(key, text);
    } catch {
      /* no storage: the tab shows an empty monitor */
    }
  }, [POSITIONS_KEY, JSON.stringify(list)] as const);
}

/** The illustrative basket (§10: baskets live in the browser), set before the app loads on every navigation of this page. */
async function seedBaskets(page: Page): Promise<void> {
  await page.addInitScript(([key, text]) => {
    try {
      localStorage.setItem(key, text);
    } catch {
      /* no storage: the tab says no basket is saved */
    }
  }, [SAVED_BASKETS_KEY, JSON.stringify((basketSample as { baskets: unknown[] }).baskets)] as const);
}

async function open(page: Page, route: string, over?: Parameters<typeof routeDesk>[1]): Promise<void> {
  await routeDesk(page, over);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, 500);
}

test.describe("desk v2", () => {
  test.use({ viewport: { width: 1440, height: 960 } });

  test("the sidebar is the only navigation: three groups, eleven tabs, no tab strip", async ({ page }) => {
    await open(page, "/desk/overview");
    const side = page.getByRole("complementary", { name: "Sidebar" });
    await expect(side).toBeVisible();
    for (const g of DESK_GROUPS) for (const p of g.pages) await expect(side.getByRole("link", { name: p.label, exact: true })).toBeVisible();
    await expect(page.getByRole("tablist")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page).toHaveTitle("Overview · Desk · Macro Regime Radar");
  });

  for (const slug of BUILT) {
    test(`${slug}: every color is a §1.3 color, and no banned word renders`, async ({ page }) => {
      await open(page, `/desk/${slug}`);
      expect(await auditPalette(page)).toEqual([]);
      expect(await bannedWordsOnPage(page)).toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      // §1.5: there is no universal normal month (the tabs that read Ledger rows).
      if (["overview", "technicals", "signal-ledger"].includes(slug)) {
        const text = (await page.locator("main").textContent()) ?? "";
        expect(text).not.toMatch(/normal month|\+1\.3%/);
      }
    });
  }

  // Codex R-09: a completed 200 whose body is null is Awaiting refresh on every tab, never a loading state.
  const NULL_ANSWERS: { slug: string; path: string; labels: string[] }[] = [
    { slug: "overview", path: "/api/desk/overview", labels: ["Regime", "Recession · logistic model", "S&P 500 · trend", "Vol · VIX", "Active signals", "Monitored"] },
    { slug: "technicals", path: "/api/desk/technicals", labels: ["Price", "50-day average", "200-day average", "Trend", "Last 20 days", "Now"] },
    { slug: "event-study", path: "/api/desk/study", labels: ["Events", "Up a month later", "Median at a month", "Worst · best"] },
    { slug: "regime", path: "/api/desk/regime", labels: ["Growth", "Inflation", "In this regime", "Recession score", "Next CPI", "Next INDPRO"] },
    { slug: "macro", path: "/api/desk/macro", labels: ["10-year", "2s10s", "Front end", "HY spread", "Investment grade", "Today"] },
    { slug: "sectors", path: "/api/desk/sectors", labels: ["Leading", "Lagging", "Pattern", "Above 50-day", "Above 200-day"] },
    { slug: "signal-ledger", path: "/api/desk/ledger", labels: ["Signals scored", "Firing now", "Reliable", "No edge"] },
    { slug: "data-pipeline", path: "/api/desk/pipeline", labels: ["Series inventory"] },
  ];
  for (const t of NULL_ANSWERS)
    test(`${t.slug}: a 200 answered null keeps its labels and says Awaiting refresh`, async ({ page }) => {
      await open(page, `/desk/${t.slug}`, { [t.path]: { status: 200, body: null } });
      const main = page.getByRole("main");
      await expect(main.getByText(/Awaiting refresh/).first()).toBeVisible();
      for (const l of t.labels) await expect(main, l).toContainText(l);
      await settle(page, 700);
      // Nothing waits on an answer that has come: no part of the tab stays busy.
      expect(await main.locator('[aria-busy="true"]').count()).toBe(0);
      expect(await auditPalette(page)).toEqual([]);
    });

  test("a route served awaiting keeps its labels, prints the served reason and says Not yet served (§12.0, §1.0.2)", async ({ page }) => {
    const awaiting = awaitingEnvelope({ reason: "sector ETFs, RSP and IWM not ingested.", until: null }, FIXTURE_META);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/sectors", { "/api/desk/sectors": { status: 200, body: awaiting } });
      const main = page.getByRole("main");
      await expect(main.getByText("sector ETFs, RSP and IWM not ingested.")).toHaveCount(2);
      for (const l of ["Leading", "Lagging", "Pattern", "Above 50-day", "Above 200-day"]) await expect(main).toContainText(l);
      await expect(main).not.toContainText("Awaiting refresh");
      await expect(page.getByTestId("dk-live").first()).toHaveText("Not yet served");
      await expect(main.getByTestId("dk-advanced").first()).toBeDisabled();
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test("blocks served awaiting inside a ready answer: each card says why, the rest stands (§12.0 nested blocks)", async ({ page }) => {
    const off = (reason: string) => ({ status: "awaiting", data: null, unavailable: { reason, until: null } });
    const regime = payloadOf(deskFixture("GET", "/api/desk/regime")!);
    const macro = payloadOf(deskFixture("GET", "/api/desk/macro")!);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/regime", { "/api/desk/regime": { status: 200, body: { ...regime, stats: off("no stored S&P history in this database."), changes: off("no stored S&P history in this database.") } } });
      const meant = page.getByRole("region", { name: /^What each regime has meant/ });
      await expect(meant).toContainText("no stored S&P history in this database.");
      await expect(meant.getByTestId("dk-live")).toHaveText("Not yet served");
      await expect(page.getByRole("region", { name: /^Where we are/ })).toContainText("Overheating");
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await open(page, "/desk/macro", { "/api/desk/macro": { status: 200, body: { ...macro, stock_bond: off("Awaiting refresh: the full refresh stores TLT; this database predates it."), correlations: off("the correlations are not computed yet."), matrix: off("the correlations are not computed yet.") } } });
      await expect(page.getByRole("region", { name: /^Do bonds still hedge stocks/ })).toContainText("the full refresh stores TLT");
      await expect(page.getByRole("region", { name: /^Credit/ })).toContainText("%");
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test("a study whose question is not six slots is unreadable: Event Study and Position Monitor say so, never crash (Codex G1-1)", async ({ page }) => {
    const study = payloadOf(deskFixture("GET", "/api/desk/study?preset=gold-2sigma-spx-weak")!);
    for (const question of [{}, { ...(study.question as object), while: 5 }]) {
      await open(page, "/desk/event-study", { "/api/desk/study": { status: 200, body: { ...study, question } } });
      await expect(page.getByRole("region", { name: "The answer" })).toContainText("Awaiting refresh");
      await expect(page.getByText(/rendering error/)).toHaveCount(0);
      await open(page, "/desk/position-monitor?from=gold-2sigma-spx-weak", { "/api/desk/study": { status: 200, body: { ...study, question } } });
      await expect(page.getByText(/is awaiting refresh; the gate is the same for every position/)).toBeVisible();
      await expect(page.getByText(/rendering error/)).toHaveCount(0);
    }
  });

  test("a basis-point study reads in bp on Event Study and the Client view, never a percent (Codex R-02)", async ({ page }) => {
    await open(page, "/desk/event-study?preset=gold-2sigma-spx-weak", { "/api/desk/study": { status: 200, body: bpStudy() } });
    const answer = page.getByRole("region", { name: "The answer" });
    await expect(answer).toContainText("+25 bp");
    await expect(answer).toContainText("+5 bp");
    await expect(answer).not.toContainText(/[+−]\d+(\.\d)?%/);
    await expect(page.getByRole("main")).toContainText("10Y Treasury a month later");
    expect(await auditPalette(page)).toEqual([]);
    await open(page, "/desk/event-study?preset=gold-2sigma-spx-weak&view=client", { "/api/desk/study": { status: 200, body: bpStudy() } });
    const backdrop = page.getByRole("region", { name: "A month later, by economic backdrop" });
    await expect(backdrop).toContainText("Typical 10Y Treasury move after the setup");
    await expect(backdrop).toContainText("+12 bp");
    await expect(page.locator('[title="log return, ×100"]')).toHaveCount(0);
  });

  test("counts: EVENTS is the study's size over the selected horizon's count; a regime under ten events reads too few and fits the rail (C-03, §4)", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/event-study?preset=gold-2sigma-spx-weak");
      const answer = page.getByRole("region", { name: "The answer" });
      await expect(answer).toContainText("18 complete at 1 month");
      const rail = page.getByRole("complementary", { name: "Verdict and detail" });
      await expect(rail.getByText("too few cases to say")).toHaveCount(4);
      const cut = await rail.locator("td.es-few").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().height > 40).length);
      expect(cut, `too-few cells whole on one line at ${width}`).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      expect(await auditPalette(page)).toEqual([]);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("a log-return study prints 100 × native, and every such number carries the tooltip \"log return, ×100\" (§1.9)", async ({ page }) => {
    await open(page, "/desk/event-study?preset=gold-2sigma-spx-weak");
    const answer = page.getByRole("region", { name: "The answer" });
    await expect(answer).toContainText("+3.1%");
    await expect(answer.locator('[title="log return, ×100"]', { hasText: "+3.1%" })).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Verdict and detail" }).locator('.es-range-pts[title="log return, ×100"]', { hasText: "−1.6 to +4.1 pts" })).toHaveCount(1);
    await open(page, "/desk/signal-ledger");
    await expect(page.getByRole("table").locator('[title="log return, ×100"]').first()).toBeVisible();
  });

  test("overview: the four tiles carry their Live badges and read the fixture", async ({ page }) => {
    // The monitored rows are this browser's (§2, §9): one amber, one green, one manual.
    const [ndx, curve] = ["ndx-vs-spx", "2s10s-steepener"].map((id) => (positionSample as { positions: { id: string }[] }).positions.find((p) => p.id === id)!);
    const spx = { ...curve, id: "spx-long", instrument: "S&P 500", wrong_if: { id: "below_50d", label: "closes below its 50-day (6,280)" }, subject: { kind: "instrument", id: "spx" }, entry_value: 6500, original_room: 220, trigger: { series: "spx", operator: "below", threshold: 6280, policy: "frozen", observed_on: "2026-09-02" } };
    // On the audit's levels (2s10s now 25 bp, falsified at 15): entered at 55, 10 of 40 bp of room is left, 25%.
    await seedPositions(page, [ndx, spx, { ...curve, entry_value: 55, original_room: 40 }]);
    await open(page, "/desk/overview");
    // §2: the K−2 row governing today (a September session reads the July row).
    await expect(page.getByRole("region", { name: "Regime" })).toContainText("Live · Jul row");
    // The audit's values (§2.2, §2.1, Q7): the July row is Goldilocks; the S&P dated Sep 23; the VIX Sep 22.
    await expect(page.getByRole("region", { name: "Regime" })).toContainText("Goldilocks");
    await expect(page.getByRole("region", { name: "Recession · logistic model" })).toContainText("12%");
    await expect(page.getByRole("region", { name: "S&P 500 · trend" })).toContainText("Live · Sep 23");
    await expect(page.getByRole("region", { name: "Vol · VIX" })).toContainText("14.2");
    await expect(page.getByTestId("dk-live")).toHaveCount(4);
    // Nothing is firing in the audit's snapshot, so the line names no signal.
    await expect(page.getByTestId("ov-since")).toContainText("regime unchanged");
    await expect(page.getByTestId("ov-since")).not.toContainText("firing");
    // Tones render (verifier V-1): Goldilocks green, room amber under 30% and green at 50% or more.
    await expect(page.getByRole("region", { name: "Regime" }).locator(".ov-tile-value")).toHaveCSS("color", "rgb(38, 220, 160)");
    const rows = page.getByTestId("dk-mon-row");
    await expect(rows.nth(0).locator(".dk-mon-room")).toHaveCSS("color", "rgb(232, 180, 71)");
    await expect(rows.nth(1).locator(".dk-mon-room")).toHaveCSS("color", "rgb(38, 220, 160)");
    await expect(rows.nth(0).locator(".dk-mon-dim")).toHaveCSS("color", "rgb(139, 146, 158)");
    await expect(rows.nth(2).locator(".dk-mon-room")).toHaveText("manual");
  });

  test("the walkthrough strip is in the v2 palette", async ({ page }) => {
    await open(page, "/desk/overview?tour=2");
    await expect(page.getByTestId("desk-tour")).toBeVisible();
    expect(await auditPalette(page)).toEqual([]);
  });

  test("overview: a failed /overview keeps every label and says Awaiting refresh", async ({ page }) => {
    await open(page, "/desk/overview", { "/api/desk/overview": { status: 503, body: { error: "generation warming" } } });
    for (const name of ["Regime", "Recession · logistic model", "S&P 500 · trend", "Vol · VIX"]) await expect(page.getByRole("region", { name })).toContainText("Awaiting refresh");
    await expect(page.getByText("Goldilocks")).toHaveCount(0);
    await expect(page.getByTestId("dk-live")).toHaveCount(0);
  });

  test("technicals: the page badge, the range chips redraw the chart, the 6,000 / 7,000 / 8,000 axis", async ({ page }) => {
    await open(page, "/desk/technicals");
    // §3: the badge dates /technicals' own session.
    await expect(page.getByTestId("dk-live").first()).toContainText("Live · Sep 23");
    const price = page.getByRole("region", { name: /S&P 500 price/ });
    await expect(price.getByRole("img", { name: /1Y/ })).toBeVisible();
    await expect(price.locator(".dk-chart-axis")).toContainText(["6,000", "7,000", "8,000", "Oct 25", "Apr 26", "Sep 26"]);
    await price.getByRole("button", { name: "3Y" }).click();
    await expect(price.getByRole("img", { name: /3Y/ })).toBeVisible();
    // §3: the S&P rows the Ledger scores, the two RSI rows among them (desk/fill-compute).
    await expect(page.getByRole("region", { name: /^Signals/ }).getByRole("listitem")).toHaveCount(6);
    // A light action button keeps its dark text on hover (verifier R2-1).
    const act = page.getByTestId("dk-act");
    await act.hover();
    await expect(act).toHaveCSS("color", "rgb(12, 14, 17)");
    // The back link is gray at rest and light on hover (R2-2).
    const back = page.getByRole("link", { name: /Macro Regime Radar/ });
    await expect(back).toHaveCSS("color", "rgb(139, 146, 158)");
    await back.hover();
    await expect(back).toHaveCSS("color", "rgb(232, 230, 225)");
  });

  test("technicals: the vol block keeps its labels, prints its reason and says Not yet served; the sector bars and the RSI card are served (§1.0, §12.7, §12.14)", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/technicals");
      // desk/fill-etf: the sector leadership is served, seven bars from the API's answer on the fixture store.
      const sect = page.getByRole("region", { name: /^Sector leadership/ });
      await expect(sect.getByRole("list", { name: /top three/ }).getByRole("listitem")).toHaveCount(7);
      await expect(sect).toContainText("60 sessions to Sep 23 · log returns ×100 · Yahoo");
      await expect(sect.getByTestId("dk-advanced")).toBeEnabled();
      const cards: [RegExp, string, string][] = [
        [/^What protection costs right now/, "needs stored SPY option snapshots and a versioned skew method.", "PUTS vs CALLS · 1 MONTH OUT"],
      ];
      for (const [name, reason, label] of cards) {
        const card = page.getByRole("region", { name });
        await expect(card).toContainText(reason);
        await expect(card).toContainText(label);
        await expect(card.getByTestId("dk-live")).toContainText("Not yet served");
        await expect(card.getByTestId("dk-advanced")).toBeDisabled();
        await expect(card.getByRole("img")).toHaveCount(0);
      }
      // §12.7: RSI(14), its zone and direction, each zone's last session and the gauge, dated by its own session.
      const rsi = page.getByRole("region", { name: /^Momentum · RSI/ });
      await expect(rsi.getByTestId("dk-live")).toContainText("Sep 21");
      await expect(rsi).toContainText("neutral, rising");
      await expect(rsi).toContainText("Jun 2");
      await expect(rsi.getByRole("img", { name: "RSI 59.3, neutral" })).toBeVisible();
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("event study: the catalog drives the chips and the slots; a question outside it is refused with the served message (§4, §12.2, §12.3)", async ({ page }) => {
    await open(page, "/desk/event-study");
    const chips = page.getByRole("group", { name: "Common questions" });
    await expect(chips.getByRole("button", { name: "S&P golden cross" })).toBeEnabled();
    await expect(chips.getByRole("button", { name: "Dollar −2σ, 20 days" })).toBeDisabled();
    await expect(page.getByLabel("Shock")).toHaveValue("gold");
    await expect.poll(() => page.getByLabel("Window").locator("option:not([disabled])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value))).toEqual(["20"]);
    await open(page, "/desk/event-study?shock=gold&window=60&move=up2s&while=none&target=spx&horizon=20");
    // §12.0: the refusal names what is not supported.
    await expect(page.getByRole("region", { name: "The answer" })).toContainText("No study in the catalog asks shock gold, window 60, move up2s, while none, target spx, horizon 20.");
    expect(await auditPalette(page)).toEqual([]);
  });

  test("event study: Advanced opens the events and the resampling detail, all in the palette, no banned word; no frame-2 panel (§4)", async ({ page }) => {
    await open(page, "/desk/event-study");
    await expect(page.getByRole("region", { name: "The answer" })).toContainText("Suggestive at 1 month: 10+ completed outcomes");
    // §4: "Headline (serif 17px)".
    await expect(page.locator(".es-headline").first()).toHaveCSS("font-size", "17px");
    const toggle = page.getByRole("complementary", { name: "Verdict and detail" }).getByTestId("dk-advanced");
    // §1.4: an Advanced control that opens a served endpoint is a blue link (verifier T-1: a reset once turned it gray).
    await expect(toggle).toHaveCSS("color", "rgb(88, 184, 230)");
    await toggle.click();
    const adv = page.getByRole("region", { name: "Advanced" });
    await expect(adv).toContainText("All 18 events");
    await expect(adv).toContainText("Resampling detail");
    await expect(adv).not.toContainText("as the engine scores it");
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
  });

  test("event study: Export downloads the events as CSV; the confidence chips are disabled and ask nothing (§4, §12.2)", async ({ page }) => {
    const calls = await routeDesk(page);
    await page.goto("/desk/event-study", { waitUntil: "domcontentloaded" });
    await settle(page, 500);
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("es-export").click()]);
    expect(download.suggestedFilename()).toBe("gold-2sigma-spx-weak-events.csv");
    const csv = await (await download.createReadStream())?.toArray();
    const text = Buffer.concat((csv ?? []) as Buffer[]).toString("utf8");
    // §12.4's columns: the event, its entry, its regime, then exit, value and completeness per horizon.
    expect(text.split("\n")[0]).toBe("event_date,entry_date,regime,exit_5,value_5,complete_5,exit_10,value_10,complete_10,exit_20,value_20,complete_20,exit_60,value_60,complete_60");
    expect(text.trim().split("\n")).toHaveLength(19);
    const chips = page.getByRole("group", { name: "Confidence" });
    await expect(chips.getByRole("button", { name: "80%" })).toBeDisabled();
    await expect(chips.getByRole("button", { name: "90%" })).toHaveAttribute("aria-pressed", "true");
    await expect(chips).toContainText("not yet served");
    await expect(page.getByRole("complementary", { name: "Verdict and detail" })).toContainText("Confidence levels other than 90%: interval projection at other quantiles is new plumbing.");
    expect(calls.some((c) => c.includes("confidence"))).toBe(false);
    await expect(page).not.toHaveURL(/confidence/);
    // "Act on this" carries the question to the Position Monitor.
    await expect(page.getByTestId("dk-act")).toHaveAttribute("href", "/desk/position-monitor?from=gold-2sigma-spx-weak");
  });

  test("macro: the two rows are equal and sized to their cards; the gauge's caption gives way to a band name and follows a resize", async ({ page }) => {
    await open(page, "/desk/macro");
    const heights = await page.locator("section.dk-card.mc-card").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    expect(heights).toHaveLength(4);
    expect(new Set(heights).size).toBe(1);
    // Taller viewport, same cards: they never stretch to the window.
    await page.setViewportSize({ width: 1440, height: 1500 });
    await settle(page, 200);
    expect(await page.locator("section.dk-card.mc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(heights[0]);
    const tight = page.locator(".mc-card .dk-gauge-names > span > span", { hasText: "Tight" });
    await expect(tight).toBeVisible();
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(page, 300);
    await expect(tight).toBeHidden();
    const [needle, cap] = await Promise.all([page.locator(".mc-card .dk-gauge-needle").boundingBox(), page.locator(".mc-card .dk-gauge-caption").boundingBox()]);
    expect(Math.abs(cap!.x + cap!.width / 2 - (needle!.x + needle!.width / 2))).toBeLessThanOrEqual(Math.max(2, cap!.width / 2));
    await page.setViewportSize({ width: 1440, height: 960 });
    await settle(page, 300);
    await expect(tight).toBeVisible();
  });

  test("sectors: no sideways scroll at 390 or 1100, and the cards never stretch to a tall window", async ({ page }) => {
    await open(page, "/desk/sectors");
    const h = await page.locator("section.sc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 1600 });
    await settle(page, 200);
    expect(await page.locator("section.sc-card").first().evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(h);
    for (const width of [1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
  });

  test("regime: the July row governs a September session, the latest print sits beside it, the recession score says what month it is for (§5)", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/regime");
      await expect(page.locator("body")).toContainText("Live · Jul row");
      const where = page.getByRole("region", { name: /Where we are/ });
      await expect(where.locator(".rg-latest")).toHaveText("Latest print: Aug 2026");
      const rec = page.getByRole("region", { name: /Recession score/ });
      await expect(rec.locator(".rg-rec-for")).toHaveText("score for Aug\u00a02026 · inputs through May\u00a02026");
      await expect(rec).toContainText("High risk · above 40%");
      if (width === 1440) await expect(page.getByTestId("dk-today")).toContainText("regime · Jul row");
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("verdicts: a Too few row's pill is dashed gray; both footers carry the four definitions and fit at 1440 and 390 (§1.5, B-13)", async ({ page }) => {
    const ledger = payloadOf(deskFixture("GET", "/api/desk/ledger")!) as { signals: Record<string, unknown>[] };
    // The fixture's HY row is Too few on its own (n 2, the audit's §2.4); one more makes two.
    const signals = ledger.signals.map((r) => (r.slug === "death-cross" ? { ...r, verdict: "insufficient", n: 6 } : r));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/signal-ledger", { "/api/desk/ledger": { status: 200, body: { ...ledger, signals } } });
      const pill = page.locator(".lg-table .dk-pill[data-verdict=insufficient]");
      await expect(pill).toHaveText(["Too few", "Too few"]);
      expect(await pill.evaluateAll((els) => els.map((e) => getComputedStyle(e).borderTopStyle))).toEqual(["dashed", "dashed"]);
      await expect(page.locator(".lg-foot .dk-defs > div")).toHaveCount(4);
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // One column on a phone however the page was reached (the rule lives with the kit, not the Overview).
      if (width === 390) expect(await page.locator(".lg-foot .dk-defs").evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(" ").length)).toBe(1);
      // Technicals' list: the Too few pill keeps the kit's gray and size, and never covers the sentence.
      await open(page, "/desk/technicals", { "/api/desk/ledger": { status: 200, body: { ...ledger, signals: ledger.signals.map((r) => (r.slug === "death-cross" ? { ...r, verdict: "insufficient", n: 6 } : r)) } } });
      const tp = page.locator(".te-sig-list .dk-pill[data-verdict=insufficient]");
      await expect(tp).toHaveText("Too few");
      expect(await tp.evaluate((e) => [getComputedStyle(e).borderTopStyle, getComputedStyle(e).fontSize])).toEqual(["dashed", "11.5px"]);
      const overlap = await page.locator(".te-sig-list li").evaluateAll((lis) =>
        lis.filter((li) => {
          const p = li.querySelector(".dk-pill")?.getBoundingClientRect();
          const t = li.querySelector(".te-sig-text")?.getBoundingClientRect();
          return !!p && !!t && p.top < t.bottom && t.top < p.bottom && p.left < t.right && t.left < p.right;
        }).length,
      );
      expect(overlap, `pill over the sentence at ${width}`).toBe(0);
      await open(page, "/desk/overview");
      await expect(page.locator(".ov-active-foot .dk-defs > div")).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("ledger: the header counts scored and unavailable rows; an unavailable row prints its reason across the value columns, no pill (§8, v4 B-02)", async ({ page }) => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/signal-ledger");
      await expect(page.locator(".lg-stats")).toContainText("10 scored · 2 not yet served");
      // NOW's words are whole, never cut (§8).
      const cutNow = await page.locator(".lg-table td.lg-now").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      expect(cutNow, `NOW cells whole at ${width}`).toBe(0);
      const oil = page.locator(".lg-table tr[data-unavailable]", { hasText: "Oil" });
      await expect(oil).toContainText("WTI crude (DCOILWTICO) is not stored in this database");
      await expect(oil.locator(".dk-pill")).toHaveCount(0);
      await expect(page.locator(".lg-table tr[data-unavailable]")).toHaveCount(2);
      expect(await auditPalette(page)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
  });

  test("ledger: no name is cut at 1101, 1200 or 390; the table scrolls in its own region; the card never stretches", async ({ page }) => {
    await open(page, "/desk/signal-ledger");
    const h = await page.locator("section.lg-card").evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 1600 });
    await settle(page, 200);
    expect(await page.locator("section.lg-card").evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBe(h);
    for (const width of [1101, 1200, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 250);
      const cut = await page.locator(".lg-table th[scope=row]").evaluateAll((ths) => ths.filter((th) => th.scrollWidth > th.clientWidth).length);
      expect(cut).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    // Reached from the keyboard, the scroll region shows its ring.
    const region = page.getByRole("region", { name: "The signals table" });
    await region.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await region.evaluate((e) => document.activeElement === e && getComputedStyle(e).outlineStyle !== "none" && parseFloat(getComputedStyle(e).outlineWidth) >= 1)).toBe(true);
  });

  test("position monitor: the flagged and expanded states stay in the palette; no sideways scroll; no stretch in a tall window", async ({ page }) => {
    await seedPositions(page);
    await open(page, "/desk/position-monitor?from=gold-2sigma-spx-weak&open=2s10s-steepener");
    // The 2s10s sample on real levels (the audit's Q11): entered at 40 bp, falsified at 15, now 25.
    await expect(page.getByRole("region", { name: /Monitored/ })).toContainText("2s10s below +15 bp · now +25 bp");
    await page.getByLabel(/Variant view/).fill("The market thinks gold will keep falling.");
    await expect(page.getByRole("group", { name: "Wording" })).toContainText("1 to fix, one click");
    await page.getByRole("button", { name: /closes below its 50-day/ }).click();
    expect(await auditPalette(page)).toEqual([]);
    const gate = page.locator("section.pm-gate");
    const h = await gate.evaluate((e) => Math.round(e.getBoundingClientRect().height));
    await page.setViewportSize({ width: 1440, height: 2400 });
    await settle(page, 200);
    expect(await gate.evaluate((e) => Math.round(e.getBoundingClientRect().height))).toBeLessThanOrEqual(h);
    for (const width of [1300, 1200, 1101, 1100, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await settle(page, 250);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      // The wrong-if column holds together: no pill's text outgrows it, the typed level stays usable (R2-4).
      const cramped = await page.evaluate(() => {
        const chips = [...document.querySelectorAll<HTMLElement>(".pm-chip")].filter((c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1).length;
        const own = document.querySelector<HTMLElement>(".pm-own")?.getBoundingClientRect().width ?? 0;
        // A monitored name cut with an ellipsis carries its whole text as a title.
        const untitled = [...document.querySelectorAll<HTMLElement>(".dk-mon-name")].filter((n) => n.scrollWidth > n.clientWidth + 1 && n.title !== n.textContent).length;
        return { chips, own: Math.round(own), untitled };
      });
      expect(cramped.chips).toBe(0);
      expect(cramped.untitled).toBe(0);
      expect(cramped.own).toBeGreaterThan(120);
    }
  });

  test("position monitor: a save stays in this browser, survives a reload, and asks the server nothing (§9, v3 §16)", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/desk/positions")) asked.push(`${r.method()} ${r.url()}`);
    });
    await open(page, "/desk/position-monitor");
    await page.getByLabel("Instrument", { exact: true }).fill("TLT");
    await page.getByLabel(/Variant view/).fill("The market thinks rates stay high, I think they fall, because growth is slowing.");
    await page.getByLabel(/Pre-mortem/).fill("It lost money because inflation surprised up.");
    await page.getByLabel("Or type your own level").fill("TLT closes below 84");
    await page.getByTestId("pm-save").click();
    await expect(page.getByRole("status")).toContainText("Saved in this browser.");
    const mon = page.getByRole("region", { name: /Monitored/ });
    await expect(mon.getByTestId("dk-mon-row")).toHaveCount(1);
    await expect(mon.locator(".dk-mon-room")).toHaveText("manual");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("region", { name: /Monitored/ }).getByTestId("dk-mon-row")).toHaveCount(1);
    expect(asked).toEqual([]);
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
  });

  test("data pipeline: the badge, a search that opens its group, the group's own scroll; no sideways scroll at 390", async ({ page }) => {
    await open(page, "/desk/data-pipeline");
    // §12.9 (S-01, Codex R-24): no validation.json was published with the fixtures' store, so "unknown".
    await expect(page.getByTestId("pl-badge")).toContainText("validation unknown");
    await page.getByLabel("Find a series").fill("DGS10");
    const rates = page.getByRole("region", { name: "Rates series" });
    await expect(rates).toBeVisible();
    await expect(rates.locator("tr[data-hit]")).toContainText("DGS10");
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
    // At every width the served text stays in view: each open table fits its region, no group
    // line is cut, and the breadcrumb is whole (R2-1 to R2-3).
    for (const width of [1440, 1280, 1101, 900, 760, 601]) {
      await page.setViewportSize({ width, height: 900 });
      for (const name of ["Rates", "Equities & vol", "FX & commodities"]) {
        const head = page.getByRole("button", { name: new RegExp(`^${name.replace(/[&]/g, "\\$&")}`) });
        if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
        await settle(page, 120);
        const fits = await page.locator(".pl-rows").evaluate((e) => e.scrollWidth <= e.clientWidth + 1);
        expect(fits, `${name} at ${width}`).toBe(true);
      }
      const cut = await page.locator(".pl-group-meta").evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
      expect(cut, `group lines at ${width}`).toBe(0);
      expect(await page.locator(".dk-crumb").evaluate((e) => e.scrollWidth <= e.clientWidth + 1), `breadcrumb at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 1440, height: 960 });
    // A six-series group scrolls inside itself; the page does not grow.
    await page.getByRole("button", { name: /^Equities & vol/ }).click();
    const eq = page.getByRole("region", { name: "Equities & vol series" });
    expect(await eq.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
    await page.setViewportSize({ width: 390, height: 900 });
    await settle(page, 250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    // On a phone the group's line wraps under its name and the badge moves under the title.
    await expect(page.locator(".pl-group-meta").first()).toBeVisible();
    await expect(page.getByTestId("pl-badge-inline")).toBeVisible();
    expect(await page.locator(".dk-crumb").evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  });

  test("Build Notes: the contents mark follows the scroll, a jump and an arrival by #section", async ({ page }) => {
    // Its own notes, served in place of the file's module (the file is Max's and may change):
    // long sections, a short and a tiny one, and a last one too low to reach the top.
    const para = (n: number) => Array.from({ length: n }, () => "The desk reads the store and prints what it finds, dated.").join(" ");
    const notes = `# Synthetic notes\n\n${para(3)}\n\n## Long A\n\n${para(24)}\n\n## Short\n\n${para(1)}\n\n## Tiny\n\nOne line.\n\n## Long B\n\n${para(24)}\n\n${para(24)}\n\n## Long C\n\n${para(24)}\n\n## Last\n\n${para(4)}\n`;
    await page.route(/BUILD_NOTES\.md\?import&raw/, (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: `export default ${JSON.stringify(notes)};` }));
    const marked = page.locator('.bn-toc a[aria-current="location"]');
    const toc = page.getByRole("navigation", { name: "Contents" });
    // The file's sections, then the page's own §1.0.1 section, last.
    const titles = ["Long A", "Short", "Tiny", "Long B", "Long C", "Last", "Live / Designed, not yet served"];
    await open(page, "/desk/build-notes");
    await expect(page.getByRole("heading", { level: 2, name: "Synthetic notes" })).toBeVisible();
    await expect(toc.getByRole("link")).toHaveText(titles);
    await expect(marked).toHaveText("Long A");
    // Scrolling down marks every section in turn, the last at the foot.
    const seen = await page.evaluate(async () => {
      const out: string[] = [];
      const max = document.documentElement.scrollHeight - window.innerHeight;
      for (let y = 0; y <= max + 20; y += 20) {
        window.scrollTo(0, y);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const t = document.querySelector('.bn-toc a[aria-current="location"]')?.textContent ?? "";
        if (out[out.length - 1] !== t) out.push(t);
      }
      return out;
    });
    expect(seen).toEqual(titles);
    // A click keeps its mark, even for a section too low to reach the top or too short to hold the line.
    for (const t of ["Tiny", "Long B", "Live / Designed, not yet served", "Short"]) {
      await toc.getByRole("link", { name: t, exact: true }).click();
      await settle(page, 300);
      await expect(marked).toHaveText(t);
    }
    // Arriving fresh on #section, the lazy page scrolls there itself; a malformed escape is no section.
    await page.goto("about:blank");
    await page.goto("/desk/build-notes#bn-tiny", { waitUntil: "domcontentloaded" });
    await settle(page, 500);
    await expect(marked).toHaveText("Tiny");
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    // A same-page #section: the browser scrolls, the page follows.
    await page.evaluate(() => {
      window.location.hash = "#bn-short";
    });
    await expect(marked).toHaveText("Short");
    await page.mouse.wheel(0, -20000);
    await expect(marked).toHaveText("Long A");
    await page.goto("about:blank");
    await page.goto("/desk/build-notes#%E0%A4%A", { waitUntil: "domcontentloaded" });
    await settle(page, 500);
    await expect(page.getByRole("heading", { level: 2, name: "Synthetic notes" })).toBeVisible();
    await expect(marked).toHaveText("Long A");
  });

  test("SPY gets no index numbers; the S&P 500 does (Codex R-08)", async ({ page }) => {
    // A session whose 50 closes are all stored; the fixture's Sep 23 reads the average null (Codex R-24).
    await open(page, "/desk/position-monitor", { "/api/desk/technicals": { status: 200, body: completeTechnicals() } });
    await page.getByLabel("Instrument", { exact: true }).fill("S&P 500");
    await expect(page.getByRole("button", { name: "closes below its 50-day (7,625)" })).toBeVisible();
    await page.getByLabel("Instrument", { exact: true }).fill("SPY");
    await expect(page.getByRole("button", { name: "closes below its 50-day", exact: true })).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText("7,625");
  });

  test("basket & hedge: unavailable, the basket's weights kept in the browser, the hand-off; every width", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/desk\/(basket|hedge)/.test(r.url())) asked.push(`${r.method()} ${r.url()}`);
    });
    await seedBaskets(page);
    await open(page, "/desk/basket-hedge");
    const basket = page.getByRole("region", { name: "Basket" });
    const hedge = page.getByRole("region", { name: /^Hedge · express or protect/ });
    // §10: the badge, the labels kept, the reason printed; no chart, no structure.
    await expect(page.getByRole("main").getByTestId("dk-live").first()).toHaveText("Not yet served");
    await expect(basket).toContainText("Basket pricing and option structures are not yet defined in the engine.");
    await expect(basket).toContainText("Is the AI infrastructure bet working?");
    await expect(basket.getByRole("img")).toHaveCount(0);
    await expect(hedge.getByRole("group", { name: "Hedge mode" }).getByRole("button")).toHaveCount(3);
    for (const b of await hedge.getByRole("group", { name: "Hedge mode" }).getByRole("button").all()) await expect(b).toBeDisabled();
    await expect(hedge.getByRole("radio")).toHaveCount(0);
    await expect(hedge).toContainText("Basket pricing and option structures are not yet defined in the engine.");
    expect(await auditPalette(page)).toEqual([]);
    expect(await bannedWordsOnPage(page)).toEqual([]);
    // Weights as typed, saved in this browser.
    await basket.getByLabel("Weight of SMCI, percent").fill("8");
    await expect(basket).toContainText("total 96%");
    await basket.getByRole("button", { name: "Normalize to 100%" }).click();
    await expect(basket).toContainText("total 100%");
    await basket.getByRole("button", { name: "Save basket" }).click();
    await expect(basket).toContainText("Saved in this browser.");
    // The hand-off: Position Monitor reads the basket, a manual subject (§9).
    await page.getByTestId("dk-act").click();
    await expect(page).toHaveURL(/\/desk\/position-monitor\?basket=local-1$/);
    await expect(page.getByRole("textbox", { name: "Instrument" })).toHaveValue("AI infrastructure basket");
    // A phone gets both cards, one under the other, and never scrolls sideways.
    for (const width of [1440, 1200, 1101, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "/desk/basket-hedge");
      await expect(page.getByRole("region", { name: "Basket" }).getByLabel("Weight of NVDA, percent")).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(1);
      // Nothing in the basket's header is cut: the title, and the selector at its basket's width.
      const head = await page.evaluate(() => {
        const title = document.querySelector<HTMLElement>(".bh-card .dk-card-title")!;
        const sel = document.querySelector<HTMLSelectElement>(".bh-select select")!;
        const cs = getComputedStyle(sel);
        const ctx = document.createElement("canvas").getContext("2d")!;
        ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text = ctx.measureText(sel.selectedOptions[0]?.textContent ?? "").width;
        return { titleCut: title.scrollWidth > title.clientWidth + 1, room: sel.clientWidth - text };
      });
      expect(head.titleCut, `title at ${width}`).toBe(false);
      expect(head.room, `selector at ${width}`).toBeGreaterThan(16);
      expect(await auditPalette(page)).toEqual([]);
    }
    // Nothing on the tab animates under reduced motion.
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/desk/basket-hedge");
    expect(await page.evaluate(() => [...document.querySelectorAll(".dk *")].filter((el) => getComputedStyle(el).animationName !== "none").length)).toBe(0);
    // Nothing is priced, so nothing is asked of the server.
    expect(asked).toEqual([]);
  });

  test("keyboard: every stop has a name and a ring; the toggle and the action are stops", async ({ page }) => {
    await open(page, "/desk/overview");
    const stops = await tabWalk(page);
    expect(stops.length).toBeGreaterThan(15);
    expect(stops[0].name).toMatch(/skip to content/i);
    expect(stops.filter((s) => !s.name.trim()).map((s) => `${s.tag}.${s.className}`)).toEqual([]);
    expect(stops.filter((s) => !hasRing(s)).map((s) => `${s.tag}.${s.className}`)).toEqual([]);
    for (const name of ["Desk", "Client", "Walkthrough", "Overview", "Build Notes"]) expect(stops.some((s) => s.name.trim() === name), name).toBe(true);
  });

  test("the Client toggle works from the keyboard and lives in the URL", async ({ page }) => {
    await open(page, "/desk/overview");
    await page.getByRole("button", { name: "Client" }).focus();
    await page.keyboard.press("Space");
    await expect(page).toHaveURL(/view=client/);
    await expect(page.getByRole("complementary", { name: "Sidebar" }).getByRole("link", { name: "Regime", exact: true })).toHaveAttribute("href", "/desk/regime?view=client");
  });

  test("the client view: the study in plain words, §1.3 colors, no banned word, no verdict pill; back to Desk", async ({ page }) => {
    for (const route of ["/desk/overview?view=client", "/desk/event-study?preset=gold-2sigma-spx-weak&view=client"]) {
      await open(page, route);
      // §12.2 (item 14): the client headline is the catalog client_label.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gold jumps over a month while the S&P is weak");
      await expect(page.getByRole("region", { name: "A month later, by economic backdrop" }).getByRole("listitem")).toHaveCount(4);
      await expect(page.getByRole("main")).toContainText("Radar · FRED, Yahoo Finance · as of Sep 24, 2026 · Past patterns do not guarantee future results.");
      await expect(page.locator("main .dk-pill")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Export one-pager (PDF)" })).toBeVisible();
      expect(await auditPalette(page)).toEqual([]);
      expect(await bannedWordsOnPage(page)).toEqual([]);
    }
    await page.getByRole("button", { name: "Desk", exact: true }).click();
    await expect(page).not.toHaveURL(/view=client/);
    await expect(page.getByRole("button", { name: "Export one-pager (PDF)" })).toHaveCount(0);
  });

  test("the client view prints as one page, full width, the bars kept; another tab prints as before", async ({ page }) => {
    const pages = (pdf: Buffer) => (pdf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
    // Two regimes with ten events or more (MIN_REGIME_N), so the backdrop draws bars to print.
    const study = payloadOf(deskFixture("GET", "/api/desk/study?preset=gold-2sigma-spx-weak")!);
    const by_regime = [
      { h: 20, regime: "Goldilocks", n: 10, up_pct: 0.6, median: 0.028 },
      { h: 20, regime: "Overheating", n: 4, up_pct: null, median: null },
      { h: 20, regime: "Stagflation", n: 2, up_pct: null, median: null },
      { h: 20, regime: "Recession Risk", n: 12, up_pct: 0.83, median: 0.035 },
    ];
    await open(page, "/desk/overview?view=client", { "/api/desk/study": { status: 200, body: { ...study, by_regime } } });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Gold jumps over a month while the S&P is weak");
    // S-32: the Client view's footer is its snapshot date, on screen only.
    await expect(page.getByTestId("dk-gen")).toHaveText("Snapshot · Sep 24, 2026");
    await page.emulateMedia({ media: "print" });
    await expect(page.getByTestId("dk-gen")).toBeHidden();
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Export one-pager (PDF)" })).toBeHidden();
    expect(await page.locator("main").evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(600);
    expect(await page.locator(".cv-bar").first().evaluate((e) => getComputedStyle(e).printColorAdjust)).toBe("exact");
    expect(pages(await page.pdf({ format: "Letter" }))).toBe(1);
    expect(pages(await page.pdf({ format: "A4" }))).toBe(1);
    expect(pages(await page.pdf({ format: "Letter", landscape: true }))).toBe(1);
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "Desk", exact: true }).click();
    await expect(page).not.toHaveURL(/view=client/);
    await page.emulateMedia({ media: "print" });
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeVisible();
    await page.emulateMedia({ media: "screen" });
  });

  test("the client view's bars keep one scale and stay in the card at every width", async ({ page }) => {
    const study = payloadOf(deskFixture("GET", "/api/desk/study?preset=gold-2sigma-spx-weak")!);
    for (const by_regime of [
      // Served cells only at ten events or more (MIN_REGIME_N, §12.2).
      [{ regime: "Goldilocks", n: 10, up_pct: 0.4, median: -0.121 }, { regime: "Overheating", n: 12, up_pct: 0.3, median: -0.05 }, { regime: "Recession Risk", n: 2, up_pct: null, median: null }],
      [{ regime: "Goldilocks", n: 10, up_pct: 0.4, median: -0.1 }, { regime: "Overheating", n: 12, up_pct: 0.6, median: 0.01 }, { regime: "Stagflation", n: 2, up_pct: null, median: null }, { regime: "Recession Risk", n: 10, up_pct: 0.5, median: 0.005 }],
      [{ regime: "Goldilocks", n: 10, up_pct: 0.8, median: 0.03 }, { regime: "Stagflation", n: 10, up_pct: 0.4, median: -0.03 }, { regime: "Recession Risk", n: 2, up_pct: null, median: null }],
    ]) {
      await open(page, "/desk/overview?view=client", { "/api/desk/study": { status: 200, body: { ...study, by_regime } } });
      for (const width of [1440, 1101, 760, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await settle(page, 150);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow at ${width}`).toBeLessThanOrEqual(1);
        const card = await page.locator(".cv-card").evaluate((e) => e.getBoundingClientRect().right);
        const vals = await page.locator(".cv-val").evaluateAll((els) => els.map((e) => ({ r: e.getBoundingClientRect().right, over: e.scrollWidth > e.clientWidth + 1 })));
        for (const v of vals) {
          expect(v.r, `value inside the card at ${width}`).toBeLessThanOrEqual(card);
          expect(v.over, `words not cut at ${width}`).toBe(false);
        }
        const widths = await page.locator(".cv-bar").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
        if (by_regime.length === 3 && by_regime[0].median === 0.03) expect(Math.abs(widths[0] - widths[1]), `±3% at ${width}`).toBeLessThanOrEqual(1);
      }
      await page.setViewportSize({ width: 1440, height: 960 });
    }
  });

  test("reduced motion: nothing on the Desk animates", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "/desk/overview");
    const animated = await page.evaluate(() => [...document.querySelectorAll(".dk *")].filter((el) => getComputedStyle(el).animationName !== "none").map((el) => el.className));
    expect(animated).toEqual([]);
  });

  test("390: the sidebar opens from Menu, the page never scrolls sideways", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/desk/overview");
    const side = page.getByRole("complementary", { name: "Sidebar" });
    await expect(side).toBeHidden();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(side).toBeVisible();
    await side.getByRole("link", { name: "Regime", exact: true }).click();
    await expect(page).toHaveURL(/\/desk\/regime$/);
    await expect(side).toBeHidden();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("House Discipline opens the gate text", async ({ page }) => {
    await open(page, "/desk/overview");
    await page.getByTestId("dk-house").click();
    await expect(page.getByRole("dialog", { name: "The discipline gate" })).toContainText("Variant view");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
