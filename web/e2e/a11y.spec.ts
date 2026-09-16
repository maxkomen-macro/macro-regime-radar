/**
 * Phase 10 checklist (docs/redesign-v2/checklists/10-states-a11y.md) B.4, B.5
 * and B.6 (E.3 #5 to #7): the keyboard pass, reduced motion, and the hand-rolled
 * semantics and contrast audit, driven against the running Vite dev server
 * (playwright.config.ts baseURL; servers are never started here). Real key
 * presses only (Tab, Shift+Tab, Arrow, Home, End, Enter, Space, Escape,
 * Alt+Arrow); the assistant panel is opened and closed with Escape and is
 * never typed into (B.4 #6, CC_PROMPT 44).
 *
 * Per /app/* route at 1672 (390 on Dashboard, Regime Lab and Markets): the
 * Tab walk into tab-order.json (B.4 #1: the skip link first, a ring on every
 * stop, a name on every stop, no positive tabindex, main#main-content the one
 * inline outline removal, G8) and the B.6 audit into a11y-report.json.
 * Gated there: nameless focusables, unresolved aria-controls / aria-labelledby
 * (an unselected SubTab's aria-controls to its unmounted panel is reported,
 * not gated: SubTabs renders one panel), and the contrast of the route h1 and
 * h2 and the SummaryCard dt / dd (4.5:1). Every other contrast row, the
 * tablist and pressed-group invariants, tables, svg and canvas labelling,
 * live regions and dialog attributes are reported. Captures and reports land
 * in docs/redesign-v2/captures/<branch-slug>/ (CAPTURE_DIR overrides).
 *
 * A future getByRole("tab", { name }) matches the new SubTabs names
 * ("Playbook, reference") only with a regex (G10).
 */
import path from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { captureDir, mergeJsonFile, settle } from "./lib/drive";
import {
  auditContrast,
  auditFocusables,
  auditHeadings,
  auditLiveAndDialogs,
  auditMedia,
  auditMotion,
  auditRefs,
  hasRing,
  readActiveElement,
  tabWalk,
} from "./lib/a11y";

const OUT = captureDir();
const REPORT_PATH = path.join(OUT, "a11y-report.json");
const TAB_ORDER_PATH = path.join(OUT, "tab-order.json");
const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";
const AA = 4.5;

const APP_ROUTES = [...TABS.map((t) => ({ slug: t.slug, route: `/app/${t.slug}` })), { slug: METHODOLOGY_SLUG, route: `/app/${METHODOLOGY_SLUG}` }];
const PHONE_ROUTES = ["dashboard", "regime-lab", "markets"];
const PHONE = { width: 390, height: 844 };
const DESK = { width: 1672, height: 941 };

async function open(page: Page, route: string, ms = 900): Promise<void> {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settle(page, ms);
}

const header = (page: Page) => page.locator("header").first();
const strip = (page: Page) => page.getByRole("region", { name: "Market strip and data freshness" });
const active = (page: Page) => page.evaluate(readActiveElement, 0);
const activeType = (page: Page) => page.evaluate(() => (document.activeElement instanceof HTMLInputElement ? document.activeElement.type : ""));
const inertShell = (page: Page) => page.locator("#shell-content").getAttribute("inert");

/** Focus an element by keyboard semantics: `.focus()` then read it back. */
async function focus(loc: Locator): Promise<void> {
  await loc.scrollIntoViewIfNeeded().catch(() => undefined);
  await loc.focus();
  await expect(loc).toBeFocused();
}

/* ── B.4 #1 + B.6: the per-route walk and audit ───────────────────────────── */

async function walkAndAudit(page: Page, slug: string, width: number): Promise<void> {
  const key = `${slug}--${width}`;
  const stops = await tabWalk(page, 400);
  mergeJsonFile(TAB_ORDER_PATH, key, stops);

  // Back to the top for the audit: a walk leaves the page scrolled and a jargon tooltip open.
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.scrollTo(0, 0);
  });

  const focusables = await page.evaluate(auditFocusables);
  const refs = await page.evaluate(auditRefs);
  const headings = await page.evaluate(auditHeadings);
  const media = await page.evaluate(auditMedia);
  const live = await page.evaluate(auditLiveAndDialogs);
  const contrast = await page.evaluate(auditContrast);

  const inlineOutlineOthers = focusables.inlineOutlineNone.filter((f) => !(f.tag === "main" && f.id === "main-content"));
  // Deferred aria-controls (a closed controller whose target mounts on open) are reported, not gated.
  const unresolvedGated = refs.unresolved.filter((r) => !r.deferred);
  const unresolvedDeferred = refs.unresolved.filter((r) => r.deferred);
  const gatedContrast = contrast.filter((r) => ["h1", "h2", "summary-dt", "summary-dd"].includes(r.group));
  const lowGated = gatedContrast.filter((r) => r.ratio < AA);
  const lowReported = contrast.filter((r) => !["h1", "h2", "summary-dt", "summary-dd"].includes(r.group) && r.ratio < AA);

  mergeJsonFile(REPORT_PATH, key, {
    stops: stops.length,
    focusables: { total: focusables.total, nameless: focusables.nameless, positiveTabindex: focusables.positiveTabindex, inlineOutlineNone: focusables.inlineOutlineNone },
    refs: { unresolved: unresolvedGated, deferred: unresolvedDeferred, popupsOpenWithoutDialog: refs.popupsOpenWithoutDialog, tablists: refs.tablists, pressedGroups: refs.pressedGroups },
    headings: { h1Total: headings.h1Total, h1InMain: headings.h1InMain, violations: headings.violations, order: headings.main.map((h) => `h${h.level} ${h.text}`) },
    media: { defects: media.defects, tables: media.tables.length, roleTables: media.roleTables, svgTotal: media.svgTotal, svgUnlabelled: media.svgUnlabelled, canvases: media.canvases, imgInMain: media.imgInMain },
    liveRegions: live.regions,
    tapeAnnouncers: live.tapeAnnouncers,
    dialogs: live.dialogs,
    contrast: { rows: contrast, under45: lowReported, gatedUnder45: lowGated },
  });

  // Gates, after both reports are on disk (B.4 #1, then B.6 #2, #3, #8 on the named rows).
  expect(stops.length, `${key}: at least one Tab stop`).toBeGreaterThan(0);
  const noRing = stops.filter((s) => !hasRing(s));
  expect(noRing.map((s) => `${s.i} ${s.tag}${s.id ? `#${s.id}` : ""} ${s.name} (${s.outlineStyle} ${s.outlineWidth} ${s.boxShadow})`), `${key}: focus ring on every stop`).toEqual([]);
  const namelessStops = stops.filter((s) => !s.name);
  expect(namelessStops.map((s) => `${s.i} ${s.tag}${s.id ? `#${s.id}` : ""} .${s.className}`), `${key}: an accessible name on every stop`).toEqual([]);
  expect(stops.filter((s) => s.isCanvas), `${key}: no canvas is a Tab stop (G2)`).toEqual([]);
  expect(stops.some((s) => s.isSkipLink), `${key}: the skip link is in the Tab cycle`).toBe(true);
  expect(focusables.nameless.map((f) => `${f.tag}${f.id ? `#${f.id}` : ""} .${f.className} "${f.text}"`), `${key}: nameless focusables`).toEqual([]);
  expect(focusables.positiveTabindex, `${key}: no tabindex above 0`).toEqual([]);
  expect(inlineOutlineOthers.filter((f) => f.tabindex !== "-1" && !(f.role === "tabpanel")), `${key}: inline outline none only on main#main-content (G8) and programmatic targets`).toEqual([]);
  expect(unresolvedGated.map((r) => `${r.tag}[${r.attr}="${r.id}"]`), `${key}: every aria-labelledby / aria-describedby and every open controller's aria-controls resolves`).toEqual([]);
  expect(headings.h1Total, `${key}: one h1`).toBe(1);
  expect(headings.violations, `${key}: heading order`).toEqual([]);
  expect(lowGated.map((r) => `${r.group} ${r.sel} "${r.text}" ${r.ratio}:1 (${r.token})`), `${key}: h1, h2 and SummaryCard dt/dd clear ${AA}:1`).toEqual([]);
  // Last: where a fresh load's first Tab lands. On routes that mount SubTabs
  // the selected tab's scrollIntoView on mount moves Chromium's sequential
  // focus starting point, so the first Tab skips the skip link (Phase 10 finding).
  expect(stops[0].name, `${key}: the first stop is the skip link`).toBe("Skip to content");
  test.info().annotations.push({ type: key, description: `${stops.length} stops · ${contrast.length} contrast rows, ${lowReported.length} under ${AA}:1 reported · ${unresolvedDeferred.length} deferred aria-controls reported (closed controllers whose target mounts on open)` });
}

for (const r of APP_ROUTES) {
  test(`tab walk and semantics at 1672: /app/${r.slug}`, async ({ page }) => {
    await page.setViewportSize(DESK);
    await open(page, r.route);
    await walkAndAudit(page, r.slug, 1672);
  });
}

/* ── B.4 #8, #11 and the phone walk at 390 ───────────────────────────────── */

for (const slug of PHONE_ROUTES) {
  test(`tab walk, semantics and the MobileNav keyboard path at 390: /app/${slug}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await open(page, `/app/${slug}`);
    await walkAndAudit(page, slug, 390);

    // B.4 #8: a fresh load, Tab to the Menu button, Enter, the list in order, the watchlist keyboard path, Escape.
    await open(page, `/app/${slug}`);
    let stop = null as Awaited<ReturnType<typeof active>>;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      stop = await active(page);
      if (stop?.tag === "button" && /^Menu/.test(stop.name)) break;
    }
    expect(stop?.name, "Tab reaches the Menu button").toMatch(/^Menu · current screen /);
    const menu = page.locator("button[aria-controls='mobile-nav-list']");
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const list = page.locator("#mobile-nav-list");
    await expect(list).toBeVisible();
    const names: string[] = [];
    for (let i = 0; i < TABS.length + 3; i++) {
      await page.keyboard.press("Tab");
      names.push((await active(page))?.name ?? "");
    }
    const expected = [...TABS.map((t) => new RegExp(`^${t.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)), /^Methodology\b/, /^Jump to a section\b/, /^Watchlist/];
    expected.forEach((re, i) => expect(names[i], `MobileNav stop ${i + 1}`).toMatch(re));
    // The Watchlist disclosure opens on Enter; the rows answer Alt+ArrowDown and Delete.
    await page.keyboard.press("Enter");
    const toggle = list.getByRole("button", { name: /^Watchlist/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const rows = page.getByRole("list", { name: "Watchlist" }).getByRole("listitem");
    await expect(rows).toHaveCount(4);
    await page.keyboard.press("Tab"); // the "+" add button
    expect((await active(page))?.name).toBe("Add to watchlist");
    await page.keyboard.press("Tab"); // the first row
    const first = await active(page);
    expect(first?.role, "the first watchlist row is focused").toBe("listitem");
    expect(first?.name).toMatch(/^SPY\b/);
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator(".mrr-wl-sr")).toHaveText("SPY moved to position 2");
    await expect(rows.nth(1)).toHaveAttribute("data-symbol", "SPY");
    await expect(rows.nth(1)).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(rows).toHaveCount(3);
    await expect(page.locator(".mrr-wl-row[data-symbol='SPY']")).toHaveCount(0);
    expect((await active(page))?.name, "focus moves to the next row after Delete").toMatch(/^IWM\b/);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    if (slug === "dashboard") {
      // The assistant docks full width on a phone (B.1 390): open, measure, Escape; never type.
      const chip = header(page).getByRole("button", { name: /Ask the analyst/ });
      await focus(chip);
      await page.keyboard.press("Enter");
      const panel = page.locator("#assistant-panel");
      await expect(panel).toBeVisible();
      // app.css (max-width: 767.98px): the panel docks left 8 / right 8 / bottom 12, so it
      // spans the viewport with an 8 px gutter each side.
      const box = await panel.boundingBox();
      expect(box?.x ?? -1, "the assistant panel's left gutter at 390").toBeGreaterThanOrEqual(0);
      expect(box?.x ?? -1).toBeLessThanOrEqual(8.5);
      expect((box?.x ?? 0) + (box?.width ?? 0), "the assistant panel reaches the right gutter at 390").toBeGreaterThanOrEqual(PHONE.width - 8.5);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(PHONE.width);
      expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(chip).toBeFocused();
    }

    if (slug === "regime-lab") {
      // B.4 #11: an overflowing well is a named region, a Tab stop with the ring; ArrowRight scrolls it.
      await open(page, "/app/regime-lab#backtests");
      await expect(page.locator("#backtests table")).toHaveCount(1, { timeout: 30_000 });
      const well = page.locator("#backtests .mrr-scroll[data-scrollable='true']").first();
      await expect(well).toHaveCount(1);
      await expect(well).toHaveAttribute("tabindex", "0");
      await expect(well).toHaveAttribute("role", "region");
      expect(await well.getAttribute("aria-label")).toBeTruthy();
      await focus(well);
      const ring = await well.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth };
      });
      expect(ring.style).not.toBe("none");
      expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2);
      await page.keyboard.press("ArrowRight");
      await expect.poll(() => well.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    }
  });
}

/* ── B.4 #2: tabs ─────────────────────────────────────────────────────────── */

test("sub-tabs: Tab lands on the selected tab only, arrows / Home / End move selection and focus and rewrite the hash, the panel is a tabpanel (Regime Lab, Tools)", async ({ page }) => {
  await open(page, "/app/regime-lab");
  const tabs = page.locator("main [role='tablist'][aria-label='Regime Lab views'] [role='tab']");
  await expect(tabs).toHaveCount(5);
  expect(await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("tabindex")))).toEqual(["0", "-1", "-1", "-1", "-1"]);
  await focus(tabs.nth(0));
  await page.keyboard.press("Tab");
  expect((await active(page))?.role, "Tab leaves the tablist (roving tabindex)").not.toBe("tab");
  await page.keyboard.press("Shift+Tab");
  await expect(tabs.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(1)).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#playbook");
  await page.keyboard.press("End");
  await expect(tabs.nth(4)).toHaveAttribute("aria-selected", "true");
  await expect(tabs.nth(4)).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#backtests");
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(0), "ArrowRight wraps to the first tab").toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.nth(4), "ArrowLeft wraps to the last tab").toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#takeaway");
  expect(await page.locator("main [role='tab'][aria-selected='true']").count()).toBe(1);
  // The panel that follows the list is a tabpanel labelled by the selected tab.
  const panel = page.locator("main [role='tabpanel']");
  await expect(panel).toHaveCount(1);
  expect(await panel.getAttribute("aria-labelledby")).toBe(await tabs.nth(0).getAttribute("id"));
  expect(await page.evaluate(() => {
    const list = document.querySelector("main [role='tablist']");
    const tabpanel = document.querySelector("main [role='tabpanel']");
    return Boolean(list && tabpanel && list.compareDocumentPosition(tabpanel) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  // The accessible name carries the hint (A8): "Playbook, reference".
  expect(await tabs.nth(1).getAttribute("aria-label")).toBe("Playbook, reference");

  await open(page, "/app/tools");
  const tools = page.locator("main [role='tablist'][aria-label='Tools'] [role='tab']");
  await expect(tools).toHaveCount(2);
  await focus(tools.nth(0));
  await page.keyboard.press("ArrowRight");
  await expect(tools.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(tools.nth(1)).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#allocation");
  await expect(page.locator("#allocation")).toHaveCount(1);
  await page.keyboard.press("ArrowLeft");
  await expect(tools.nth(0)).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#lbo");
});

/* ── B.4 #3: Segmented ────────────────────────────────────────────────────── */

test("Segmented: every option is a Tab stop, arrows move focus only, Enter and Space press, exactly one pressed (Dashboard Asset class)", async ({ page }) => {
  await open(page, "/app/dashboard");
  const group = page.locator("#markets-glance").getByRole("group", { name: "Asset class" });
  const options = group.getByRole("button");
  await expect(options).toHaveCount(6);
  expect(await options.evaluateAll((els) => els.map((el) => (el as HTMLButtonElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled))).toEqual([true, true, true, true, true, true]);
  await focus(options.nth(0));
  await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(1)).toBeFocused();
  await expect(options.nth(0), "arrows move focus only").toHaveAttribute("aria-pressed", "true");
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Space");
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
  expect(await group.locator("button[aria-pressed='true']").count()).toBe(1);
  await page.keyboard.press("ArrowRight");
  await expect(options.nth(2)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(options.nth(2)).toHaveAttribute("aria-pressed", "true");
  expect(await group.locator("button[aria-pressed='true']").count()).toBe(1);
  await page.keyboard.press("End");
  await expect(options.nth(5)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(options.nth(5), "ArrowLeft wraps").toBeFocused();
  expect(await group.locator("button[aria-pressed='true']").count()).toBe(1);
});

/* ── B.4 #4: sliders ─────────────────────────────────────────────────────── */

/** Every range reached by Tab, in DOM order: ArrowRight steps it and flips its
 * row; the paired .mrr-number field sits one stop BEFORE the range (SliderRow
 * renders the label row with the typed field above the track, screen-ui.tsx),
 * so Shift+Tab lands on it; it commits on Enter and reverts on Escape. */
async function driveSliders(page: Page, expected: number): Promise<string[]> {
  const ranges = page.locator("main input[type='range']");
  await expect(ranges).toHaveCount(expected);
  // Start on the first range's typed field so the walk reaches every range by Tab.
  await focus(ranges.first());
  await page.keyboard.press("Shift+Tab");
  const order: string[] = [];
  const findings: string[] = [];
  for (let guard = 0; guard < expected * 5 && order.length < expected; guard++) {
    await page.keyboard.press("Tab");
    if ((await activeType(page)) !== "range") continue;
    const rec = await active(page);
    const name = rec?.name ?? "";
    order.push(name);
    const idx = order.length - 1;
    expect(name, `range ${order.length} has a name`).toBeTruthy();
    const valuetext = await page.evaluate(() => document.activeElement?.getAttribute("aria-valuetext") ?? "");
    expect(valuetext, `range ${order.length} carries aria-valuetext`).toBeTruthy();
    const before = await page.evaluate(() => Number((document.activeElement as HTMLInputElement).value));
    const step = await page.evaluate(() => Number((document.activeElement as HTMLInputElement).step || 1));
    const max = await page.evaluate(() => Number((document.activeElement as HTMLInputElement).max));
    await page.keyboard.press("ArrowRight");
    const after = await page.evaluate(() => Number((document.activeElement as HTMLInputElement).value));
    if (before < max) expect(after, `ArrowRight steps range ${order.length}`).toBeCloseTo(before + step, 6);
    const row = ranges.nth(idx).locator("xpath=ancestor::*[contains(@class,'mrr-slider-row')][1]");
    await expect(row).toHaveAttribute("data-changed", "true");
    // The paired typed field: one stop back.
    await page.keyboard.press("Shift+Tab");
    const typed = await active(page);
    expect(typed?.className, `the typed field pairs with range ${order.length}`).toContain("mrr-number");
    expect(typed?.name, "the typed field's name").toBe(`${name} (typed)`);
    if (idx === 0) {
      // Commit on Enter, revert on Escape (screen-ui.tsx NumberField).
      const field = page.getByRole("spinbutton", { name: `${name} (typed)` });
      const min = await field.evaluate((el) => Number((el as HTMLInputElement).min));
      await field.fill(String(min));
      await page.keyboard.press("Enter");
      await expect.poll(() => ranges.nth(idx).inputValue()).toBe(String(min));
      await focus(field);
      const committed = await field.inputValue();
      expect(Number(committed)).toBe(min);
      await field.fill(String(min + 1));
      await page.keyboard.press("Escape");
      // Escape must revert the draft without committing (screen-ui.tsx:219-222).
      // Recorded and asserted at the end so the rest of the walk still runs.
      await page.waitForTimeout(400);
      const afterEscape = await field.inputValue();
      const rangeAfterEscape = await ranges.nth(idx).inputValue();
      if (afterEscape !== committed || rangeAfterEscape !== String(min)) {
        findings.push(`${name}: Escape left the typed field at ${afterEscape} and the range at ${rangeAfterEscape} (expected ${committed}); the synchronous blur after Escape commits the stale draft (NumberField onBlur → commit)`);
        // Put the row back where the commit left it so the reset check below is meaningful.
        await field.fill(committed);
        await page.keyboard.press("Enter");
        await expect.poll(() => ranges.nth(idx).inputValue()).toBe(String(min));
      }
      await focus(ranges.nth(idx));
    } else {
      await page.keyboard.press("Tab");
      expect(await activeType(page), "Tab returns to the range").toBe("range");
    }
  }
  expect(order.length, `every range is reached by Tab (${order.join(" · ")})`).toBe(expected);
  return findings;
}

async function resetByKeyboard(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  await focus(button);
  await page.keyboard.press("Enter");
  for (const row of await page.locator("main .mrr-slider-row").all()) await expect(row).toHaveAttribute("data-changed", "false");
}

test("sliders by real keys: Regime Lab Scenarios (4 + reset)", async ({ page }) => {
  await open(page, "/app/regime-lab#scenarios");
  const custom = page.locator("#scenarios").getByRole("group", { name: "Scenario" }).getByRole("button", { name: /^Custom shocks$/i });
  await focus(custom);
  await page.keyboard.press("Enter");
  await expect(custom).toHaveAttribute("aria-pressed", "true");
  const findings = await driveSliders(page, 4);
  await resetByKeyboard(page, page.locator("#scenarios").getByRole("button", { name: "Reset shocks to zero" }));
  expect(findings, "the typed field reverts on Escape (B.4 #4)").toEqual([]);
});

test("sliders by real keys: Recession Sensitivity (5 + reset, after opening the row)", async ({ page }) => {
  await open(page, "/app/recession");
  await expect(page.locator("main h1")).toHaveText(/^\d+\.\d%$/, { timeout: 60_000 });
  const button = page.locator("#sensitivity button[aria-expanded]").first();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await focus(button);
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  const findings = await driveSliders(page, 5);
  await resetByKeyboard(page, page.locator("#sensitivity").getByRole("button", { name: /Reset to current readings/ }));
  expect(findings, "the typed field reverts on Escape (B.4 #4)").toEqual([]);
});

test("sliders by real keys: Tools LBO (9 + reset)", async ({ page }) => {
  await open(page, "/app/tools");
  await expect(page.locator("main h1")).toHaveText(/ IRR$/, { timeout: 60_000 });
  await expect(page.locator("#lbo-sensitivity")).toHaveCount(1, { timeout: 60_000 });
  const findings = await driveSliders(page, 9);
  await resetByKeyboard(page, page.locator("#lbo-assumptions").getByRole("button", { name: "Reset to defaults" }));
  expect(findings, "the typed field reverts on Escape (B.4 #4)").toEqual([]);
});

/* ── B.4 #5: drawers and palette ─────────────────────────────────────────── */

async function expectContained(page: Page, dialog: Locator, presses: number): Promise<void> {
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Tab ${i + 1} stays inside the dialog`).toBe(true);
  }
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `Shift+Tab ${i + 1} stays inside the dialog`).toBe(true);
  }
}

test("drawers and palette: focus on open, Tab contained, Escape closes and returns focus, #shell-content inert while open", async ({ page }) => {
  await open(page, "/app/dashboard");
  const bell = header(page).getByRole("button", { name: /alert/i });
  await focus(bell);
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: "Alert feed" });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute("aria-modal", "true");
  await expect(drawer.getByRole("button", { name: "Close alert feed" })).toBeFocused();
  expect(await inertShell(page)).not.toBeNull();
  await expectContained(page, drawer, 6);
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  expect(await inertShell(page)).toBeNull();
  await expect(bell).toBeFocused();

  const trigger = strip(page).getByRole("button", { name: /^Freshness/ });
  await focus(trigger);
  await page.keyboard.press("Enter");
  const fresh = page.locator("#freshness-drawer");
  await expect(fresh).toBeVisible();
  await expect(fresh).toHaveAttribute("aria-modal", "true");
  await expect(fresh.getByRole("button", { name: "Close data freshness" })).toBeFocused();
  expect(await inertShell(page)).not.toBeNull();
  await expectContained(page, fresh, 6);
  await page.keyboard.press("Escape");
  await expect(fresh).toBeHidden();
  expect(await inertShell(page)).toBeNull();
  await expect(trigger).toBeFocused();

  await page.keyboard.press(PALETTE_KEY);
  const dialog = page.getByRole("dialog", { name: "Jump to tab or section" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  const input = dialog.getByLabel("Filter destinations");
  await expect(input).toBeFocused();
  expect(await inertShell(page)).not.toBeNull();
  await expect(input).toHaveAttribute("aria-activedescendant", "palette-opt-0");
  await page.keyboard.press("ArrowDown");
  await expect(input).toHaveAttribute("aria-activedescendant", "palette-opt-1");
  await page.keyboard.press("ArrowUp");
  await expect(input).toHaveAttribute("aria-activedescendant", "palette-opt-0");
  await input.fill("Curve monitor");
  await expect(dialog.getByRole("option").first()).toContainText("Curve monitor");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app\/recession#curve$/);
  await expect(dialog).toBeHidden();
  expect(await inertShell(page)).toBeNull();
  // The top-bar trigger: Escape returns focus to it.
  const paletteButton = header(page).getByRole("button", { name: /Jump to/ });
  await focus(paletteButton);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(paletteButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(paletteButton).toHaveAttribute("aria-expanded", "false");
  await expect(paletteButton).toBeFocused();
});

/* ── B.4 #6: the assistant (opened and closed only) ──────────────────────── */

test("assistant: the chip opens a non-modal dialog with focus in the input, the page stays interactive, Escape closes and returns focus; nothing is typed or sent", async ({ page }) => {
  await open(page, "/app/dashboard");
  const chip = header(page).getByRole("button", { name: /Ask the analyst/ });
  await focus(chip);
  await page.keyboard.press("Enter");
  const panel = page.locator("#assistant-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("role", "dialog");
  await expect(panel).toHaveAttribute("aria-label", "AI analyst");
  expect(await panel.getAttribute("aria-modal")).toBeNull();
  expect(await inertShell(page), "the page behind the assistant is not inert").toBeNull();
  await expect(panel.getByLabel("Ask the analyst")).toBeFocused();
  const log = panel.getByRole("log");
  await expect(log).toHaveAttribute("aria-live", "polite");
  // Never type, never press Enter while focus is inside #assistant-panel.
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await expect(chip).toBeFocused();
});

/* ── B.4 #7: disclosures ─────────────────────────────────────────────────── */

test("disclosures: Enter and Space toggle aria-expanded, aria-controls resolves, children mount only while open, Tab lands inside", async ({ page }) => {
  await open(page, "/app/dashboard");
  const section = page.locator("#read-through");
  await expect(section).toBeVisible();
  const button = section.getByRole("button", { name: /Method and provenance/ });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  const panelId = await button.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toHaveCount(1);
  expect(await panel.evaluate((el) => el.childElementCount), "children unmounted while closed").toBe(0);
  await focus(button);
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toBeVisible();
  expect(await panel.evaluate((el) => el.childElementCount)).toBeGreaterThan(0);
  await page.keyboard.press("Tab");
  const inside = await active(page);
  expect(inside?.name, "Tab after opening lands on the first control inside").toMatch(/Full methodology/);
  expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  await expect(button).toBeFocused();
  await page.keyboard.press("Space");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
  expect(await panel.evaluate((el) => el.childElementCount), "children unmount on close").toBe(0);
});

/* ── B.4 #9: jargon ──────────────────────────────────────────────────────── */

test("jargon: focus opens the definition, Enter pins it, Escape dismisses without moving focus", async ({ page }) => {
  await open(page, "/app/dashboard");
  const term = page.locator("main span.jargon[role='button']").first();
  await expect(term).toHaveCount(1);
  await expect(term).toHaveAttribute("tabindex", "0");
  const tip = term.locator("xpath=following-sibling::*[@role='tooltip'][1]");
  await expect(tip).toHaveCount(1);
  await expect(tip).toBeHidden();
  await focus(term);
  await expect(tip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(term).toHaveAttribute("aria-expanded", "true");
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
  await expect(term, "Escape leaves focus on the term").toBeFocused();
  await page.keyboard.press("Space");
  await expect(tip).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tip).toBeHidden();
});

/* ── B.4 #10: chart panel and single-name panel ──────────────────────────── */

test("chart panel and single-name panel: Enter on a tape row opens the panel with focus inside, Escape closes it and returns focus; the single-name tile takes focus and closes on Escape", async ({ page }) => {
  await open(page, "/app/markets");
  const button = page.locator("#watchlist button.mrr-tape-btn").filter({ hasText: /^SPY$/ });
  await expect(button).toHaveCount(1);
  await focus(button);
  await page.keyboard.press("Enter");
  const panel = page.locator("#markets-chart-panel[aria-label='SPY chart panel']");
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => page.evaluate(() => document.getElementById("markets-chart-panel")?.contains(document.activeElement) ?? false), { timeout: 10_000 }).toBe(true);
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#markets-chart-panel")).toHaveCount(0);
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();

  await open(page, "/app/markets?name=NVDA");
  const close = page.locator("#single-name-research").getByRole("button", { name: "Close single-name panel" });
  await expect(close).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest("#single-name-research") != null), { timeout: 10_000 }).toBe(true);
  await page.keyboard.press("Escape");
  await expect(close).toHaveCount(0);
});

/* ── B.5: reduced motion ─────────────────────────────────────────────────── */

const MOTION_ROUTES = ["dashboard", "regime-lab", "markets", "news"];

test("reduced motion: with the emulation every listed animation and transition is silenced on four routes at 1672 and 390; without it a live hero pulses", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const vp of [DESK, PHONE]) {
    await page.setViewportSize(vp);
    for (const slug of MOTION_ROUTES) {
      await open(page, `/app/${slug}`, 800);
      const m = await page.evaluate(auditMotion);
      expect(m.running, `${slug} @ ${vp.width}: no running animation under reduced motion`).toEqual([]);
      expect(m.animationNames.filter((a) => a.name !== "none"), `${slug} @ ${vp.width}: animation-name none on the inventory`).toEqual([]);
      for (const t of m.transitions) {
        expect(t.property === "none" || /^(0s)(, 0s)*$/.test(t.duration), `${slug} @ ${vp.width}: ${t.sel} transition (${t.property} ${t.duration})`).toBe(true);
      }
      expect(m.canvasTabStops, `${slug} @ ${vp.width}: no canvas Tab stop`).toBe(0);
      await page.locator(".mrr-hero").first().screenshot({ path: path.join(OUT, `${slug}--${vp.width}--reduced-motion-hero.png`) }).catch(() => undefined);
      await page.locator(".mrr-strip").first().screenshot({ path: path.join(OUT, `${slug}--${vp.width}--reduced-motion-strip.png`) }).catch(() => undefined);
    }
  }
  // The proof the switch did the silencing: the same page without emulation pulses when a dot is live.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize(DESK);
  let proven = false;
  for (const slug of MOTION_ROUTES) {
    await open(page, `/app/${slug}`, 800);
    const m = await page.evaluate(auditMotion);
    if (m.pulseElements > 0) {
      expect(m.running.some((a) => a.name === "mrr-pulse"), `${slug}: a live dot runs mrr-pulse without the emulation`).toBe(true);
      proven = true;
      break;
    }
  }
  test.info().annotations.push({ type: "reduced-motion-proof", description: proven ? "a live dot pulsed without the emulation" : "no live dot on any of the four routes on verify day: the un-emulated pulse could not be observed (hero and sidebar dots idle)" });
});
