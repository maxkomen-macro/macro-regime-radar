/**
 * Iteration 1, Step 2 (root causes): behaviour checks of
 * docs/redesign-v2/ITERATION_1.md driven in a real browser against the
 * running Vite dev server (playwright.config.ts baseURL; servers are never
 * started here). PERMANENT: never tuned to pass.
 *
 *   R2  Switching a sub-tab leaves window.scrollY unchanged within 4 px, keeps
 *       the tablist inside the viewport, moves focus to the newly selected tab
 *       and still rewrites the hash (Regime Lab at 1672×941 and 1280×800, with
 *       the strip scrolled to mid-viewport before every switch). Arriving by
 *       hash on a non-default sub-tab, or by a Cmd/Ctrl+K palette jump, still
 *       scrolls the section's top into the viewport. The same stability check
 *       runs on the Tools sub-tabs as a guard, measured on the strip's viewport
 *       position (the Tools hero row swaps with the sub-tab; see checkSwitches).
 *   D2  On /app/dashboard at 1672 / 1440 / 1280 / 1024 / 768 / 390 × 941, in
 *       every "Markets at a glance" view (each Asset class option clicked),
 *       the tiles share one height within 2 px and nothing overlaps inside
 *       the view's tiles (the G1 audit scoped to the visible glance panel).
 */
import { test, expect, type Page } from "@playwright/test";
import { auditOverlapsWithin, describeOverlaps, seedSidebar, waitForScreenData } from "./lib/geometry";

const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Regime Lab sub-tabs (RegimeLabScreen LAB_TABS) and the hash each writes
 * (TAB_ANCHOR, as e2e/regime-lab.spec.ts step 6 pins it). */
const LAB_TABS = [
  { label: "Overview", anchor: "takeaway" },
  { label: "Playbook", anchor: "playbook" },
  { label: "Scenarios", anchor: "scenarios" },
  { label: "History & analogues", anchor: "analogues" },
  { label: "Empirical evidence", anchor: "backtests" },
];
/** Every switch is a real change of view: start one past the default. */
const LAB_CLICK_ORDER = [...LAB_TABS.slice(1), LAB_TABS[0]];
const LAB_LIST = "Regime Lab views";

/** Tools sub-tabs (ToolsScreen SUBTABS); the hash is the tab id. */
const TOOL_TABS = [
  { label: "Asset allocation", anchor: "allocation" },
  { label: "LBO calculator", anchor: "lbo" },
];
const TOOLS_LIST = "Tools";

const VIEWPORTS = [
  { width: 1672, height: 941 },
  { width: 1280, height: 800 },
];
const GLANCE_WIDTHS = [1672, 1440, 1280, 1024, 768, 390];

async function open(page: Page, route: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await seedSidebar(page, false);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page);
}

const tabIn = (page: Page, list: string, label: string) =>
  page.getByRole("tablist", { name: list }).getByRole("tab", { name: new RegExp(`^${escapeRe(label)}`) });

/** Scroll so the named tablist's centre sits at the viewport's centre. */
async function centreTablist(page: Page, list: string): Promise<void> {
  await page.evaluate((name) => {
    const el = Array.from(document.querySelectorAll("main [role='tablist']")).find((l) => l.getAttribute("aria-label") === name);
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top + r.height / 2 - window.innerHeight / 2, behavior: "instant" as ScrollBehavior });
  }, list);
  await page.waitForTimeout(200);
}

/** Bounded settle after a switch: no aria-busy, network quiet, a beat. */
async function settleSwitch(page: Page): Promise<void> {
  await page.waitForTimeout(250);
  await page
    .waitForFunction(() => !document.querySelector("main [aria-busy='true']"), null, { timeout: 5_000, polling: 150 })
    .catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
  await page.waitForTimeout(400);
}

interface SwitchState {
  y: number;
  listTop: number;
  listBottom: number;
  vh: number;
  hash: string;
  focus: string;
  focusIsSelectedTab: boolean;
}

async function switchState(page: Page, list: string): Promise<SwitchState> {
  return page.evaluate((name) => {
    const el = Array.from(document.querySelectorAll("main [role='tablist']")).find((l) => l.getAttribute("aria-label") === name);
    const r = el?.getBoundingClientRect();
    const ae = document.activeElement;
    const focusIsSelectedTab =
      ae != null &&
      ae.getAttribute("role") === "tab" &&
      ae.getAttribute("aria-selected") === "true" &&
      ae.closest("[role='tablist']")?.getAttribute("aria-label") === name;
    const focus = ae ? `${ae.tagName.toLowerCase()}${ae.getAttribute("role") ? `[role=${ae.getAttribute("role")}]` : ""} "${(ae.getAttribute("aria-label") ?? ae.textContent ?? "").trim().slice(0, 40)}"` : "none";
    return {
      y: window.scrollY,
      listTop: r ? r.top : Number.NaN,
      listBottom: r ? r.bottom : Number.NaN,
      vh: window.innerHeight,
      hash: window.location.hash,
      focus,
      focusIsSelectedTab,
    };
  }, list);
}

/**
 * The R2 check for one tablist: before each switch the strip is scrolled to
 * mid-viewport; the switch is a real click on the tab; the position is
 * sampled right after the tab reads selected and again once the view
 * settles. `measure` picks what must hold within 4 px: "scrollY" (the R2
 * Done-when, for a screen whose content above the strip never changes) or
 * "strip" (the strip's top in the viewport, for Tools, whose hero row swaps
 * with the sub-tab: Chrome's scroll anchoring then moves scrollY by the hero
 * height difference while the strip stays put, which is the stability R2
 * protects). Returns one line per failed condition.
 */
async function checkSwitches(
  page: Page,
  list: string,
  order: { label: string; anchor: string }[],
  measure: "scrollY" | "strip",
  afterClick?: (label: string) => Promise<void>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const t of order) {
    await centreTablist(page, list);
    const start = await switchState(page, list);
    const tab = tabIn(page, list, t.label);
    await tab.click();
    await expect(tab, `${t.label} selected`).toHaveAttribute("aria-selected", "true");
    const early = await switchState(page, list);
    if (afterClick) await afterClick(t.label);
    await settleSwitch(page);
    const s = await switchState(page, list);
    const at = (x: SwitchState) => (measure === "scrollY" ? x.y : x.listTop);
    const drift = Math.max(Math.abs(at(early) - at(start)), Math.abs(at(s) - at(start)));
    if (drift > 4)
      problems.push(
        `${t.label}: ${measure === "scrollY" ? "scrollY" : "strip top in the viewport"} moved ${Math.round(drift)} px > 4 (scrollY ${start.y} → ${early.y} on select → ${s.y} settled; strip top ${Math.round(start.listTop)} → ${Math.round(early.listTop)} → ${Math.round(s.listTop)} px)`,
      );
    if (!(s.listTop >= 0 && s.listBottom <= s.vh)) problems.push(`${t.label}: tablist at ${Math.round(s.listTop)}..${Math.round(s.listBottom)} px, outside the ${s.vh} px viewport`);
    if (!s.focusIsSelectedTab) problems.push(`${t.label}: focus on ${s.focus}, not the newly selected tab`);
    if (s.hash !== `#${t.anchor}`) problems.push(`${t.label}: hash ${s.hash || "(none)"}, expected #${t.anchor}`);
  }
  return problems;
}

/** True when the element's top edge sits inside the viewport. */
async function topInView(page: Page, id: string): Promise<boolean> {
  return page.evaluate((elId) => {
    const el = document.getElementById(elId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.top >= -1 && r.top < window.innerHeight;
  }, id);
}

/** Cmd/Ctrl+K, filter, pick the one option carrying `label`. */
async function paletteJump(page: Page, query: string, label: string): Promise<void> {
  await page.keyboard.press(PALETTE_KEY);
  const dialog = page.getByRole("dialog", { name: "Jump to tab or section" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Filter destinations").fill(query);
  const opt = dialog.getByRole("option").filter({ hasText: label });
  await expect(opt).toHaveCount(1);
  await opt.click();
  await expect(dialog).toBeHidden();
}

test.describe("R2 sub-tab switches keep the scroll position", () => {
  for (const { width, height } of VIEWPORTS) {
    test(`R2 Regime Lab sub-tabs at ${width}x${height}: scroll kept, strip in view, focus on the tab, hash updated`, async ({ page }) => {
      await open(page, "/app/regime-lab", width, height);
      await expect(page.getByRole("tablist", { name: LAB_LIST }).getByRole("tab")).toHaveCount(5);
      const problems = await checkSwitches(page, LAB_LIST, LAB_CLICK_ORDER, "scrollY");
      expect(problems, `Regime Lab sub-tab switches at ${width}x${height}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });

    test(`R2 Regime Lab hash arrival at ${width}x${height}: a hash on a non-default sub-tab still lands the section`, async ({ page }) => {
      // History & analogues holds #regime-history, below #analogues.
      await open(page, "/app/regime-lab#regime-history", width, height);
      await expect(tabIn(page, LAB_LIST, "History & analogues")).toHaveAttribute("aria-selected", "true");
      await expect
        .poll(() => topInView(page, "regime-history"), { timeout: 15_000, message: "#regime-history top in view after a hash load" })
        .toBe(true);
    });

    test(`R2 Regime Lab palette arrival at ${width}x${height}: a Cmd/Ctrl+K jump still lands the section`, async ({ page }) => {
      // On the route (from the Overview) …
      await open(page, "/app/regime-lab", width, height);
      await paletteJump(page, "Backtests", "Backtests & factor attribution");
      await expect(page).toHaveURL(/\/app\/regime-lab#backtests$/);
      await expect(tabIn(page, LAB_LIST, "Empirical evidence")).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => topInView(page, "backtests"), { timeout: 15_000, message: "#backtests top in view after a palette jump on the route" }).toBe(true);

      // … and from another route.
      await open(page, "/app/dashboard", width, height);
      await paletteJump(page, "Historical analogues", "Historical analogues");
      await expect(page).toHaveURL(/\/app\/regime-lab#analogues$/);
      await expect(tabIn(page, LAB_LIST, "History & analogues")).toHaveAttribute("aria-selected", "true");
      await expect.poll(() => topInView(page, "analogues"), { timeout: 15_000, message: "#analogues top in view after a palette jump from the Dashboard" }).toBe(true);
    });

    test(`R2 guard: Tools sub-tabs at ${width}x${height}: scroll kept, strip in view, focus on the tab, hash updated`, async ({ page }) => {
      // Warm the allocation cache (a cold call downloads return histories for 30-60 s).
      await page.request.get("/api/allocation", { timeout: 150_000 }).catch(() => {});
      await open(page, "/app/tools", width, height);
      await expect(page.locator("#lbo-schedule")).toHaveCount(1, { timeout: 60_000 });
      const problems = await checkSwitches(page, TOOLS_LIST, TOOL_TABS, "strip", async (label) => {
        if (label === "Asset allocation") await expect(page.locator("#allocation")).toHaveCount(1, { timeout: 30_000 });
        else await expect(page.locator("#lbo-schedule")).toHaveCount(1, { timeout: 60_000 });
      });
      expect(problems, `Tools sub-tab switches at ${width}x${height}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }
});

interface GlanceView {
  tab: string | null;
  tiles: { symbol: string; height: number; width: number }[];
}

test.describe("D2 Markets at a glance: one tile layout in every view", () => {
  for (const width of GLANCE_WIDTHS) {
    test(`D2 glance tiles at ${width}x941: equal heights and no overlap in every view`, async ({ page }) => {
      await open(page, "/app/dashboard", width, 941);
      const group = page.locator("#markets-glance").getByRole("group", { name: "Asset class" });
      const options = group.getByRole("button");
      const n = await options.count();
      expect(n, "Asset class options").toBeGreaterThanOrEqual(6);

      const problems: string[] = [];
      let tileViews = 0;
      for (let i = 0; i < n; i++) {
        const opt = options.nth(i);
        const label = clean(await opt.innerText());
        await opt.click();
        await expect(opt).toHaveAttribute("aria-pressed", "true");
        await page.waitForTimeout(250);
        const view = await page.evaluate((): GlanceView => {
          const panel = Array.from(document.querySelectorAll("#markets-glance [data-glance-tab]")).find((p) => !p.closest("[hidden]"));
          if (!panel) return { tab: null, tiles: [] };
          // A tile is the outermost element carrying data-symbol.
          const all = Array.from(panel.querySelectorAll("[data-symbol]"));
          const outer = all.filter((el) => !all.some((o) => o !== el && o.contains(el)));
          return {
            tab: panel.getAttribute("data-glance-tab"),
            tiles: outer.map((el) => {
              const r = el.getBoundingClientRect();
              return { symbol: el.getAttribute("data-symbol") ?? "?", height: Math.round(r.height * 10) / 10, width: Math.round(r.width * 10) / 10 };
            }),
          };
        });
        if (!view.tab || view.tiles.length === 0) continue; // the What's priced teaser renders no tiles
        tileViews++;
        const hs = view.tiles.map((t) => t.height);
        const spread = Math.max(...hs) - Math.min(...hs);
        if (spread > 2) problems.push(`${label}: tile heights ${view.tiles.map((t) => `${t.symbol} ${t.height}`).join(", ")} (spread ${Math.round(spread * 10) / 10} px > 2)`);
        const scan = await auditOverlapsWithin(page, `#markets-glance [data-glance-tab="${view.tab}"]`, { minPx: 1 });
        if (scan.items === 0) problems.push(`${label}: the scoped overlap audit measured nothing`);
        if (scan.pairs.length) problems.push(`${label}: ${scan.pairs.length} overlapping pair(s)\n${describeOverlaps(scan.pairs, 10)}`);
      }
      expect(tileViews, "glance views that rendered tiles").toBeGreaterThanOrEqual(5);
      expect(problems, `glance tiles at ${width}x941:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }
});
