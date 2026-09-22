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
 *
 * Step 4 (behaviour), appended:
 *   M4  /app/markets at 1672 / 1440 / 1280 / 1024 / 768 / 390 × 941 (sidebar
 *       expanded; collapsed too at ≥ 1024): the freshness drawer opened from
 *       the strip's freshness card (the sidebar / MobileNav "Data freshness"
 *       entry when the card is absent) lies inside the viewport; no descendant
 *       (element box or text run) passes the drawer's inner right edge by
 *       > 1 px unless it sits in a horizontally scrolling element inside the
 *       drawer that is, or contains, a keyboard stop; the drawer itself does
 *       not scroll sideways; the page's scrollWidth ≤ clientWidth while open;
 *       Escape closes it and focus is back on the opener. Once more from
 *       /app/dashboard via the sidebar entry at 1672.
 *   M5  (1) typing NVDA in the Markets hero search and picking the NVDA option
 *       sets ?name=NVDA and the research panel shows NVDA with a candle chart
 *       (canvas), a range control, fundamentals (or a sentence naming what is
 *       missing), a return-by-regime block, an Options lens disclosure and a
 *       news disclosure for the ticker; (2) /app/markets?name=AAPL loads the
 *       same view; (3) ?name=ZZZZQX prints a plain sentence naming ZZZZQX,
 *       never a blank panel; (4) expirations mocked 403 {kind: "unavailable"}
 *       and /api/news?ticker=NVDA mocked empty: the options and news blocks
 *       each print a sentence naming what is missing, the candles still render.
 *   R2 / N4 / X3 by keyboard: ArrowRight on the focused Regime Lab sub-tab
 *       (scroll kept within 4 px, focus on the new tab, hash updated); Tab to
 *       the AI row's read toggle and Enter (≤ 4 sentences, both source links
 *       reachable by Tab); Tab to the first recession slider, ArrowRight ×3
 *       moves the adjusted figure, Tab to Reset and Enter restores the
 *       model's reading.
 */
import { test, expect, type Locator, type Page, type Response } from "@playwright/test";
import { auditOverlapsWithin, describeOverlaps, seedSidebar, waitForScreenData } from "./lib/geometry";
import { emptyEndpoint } from "./lib/states";

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

/* ══ Step 4 (behaviour): M4, M5, and R2 / N4 / X3 by keyboard ═══════════════ */

const noteB = (type: string, description: string) => test.info().annotations.push({ type, description });

/** Abbreviations whose period never ends a sentence (the tabs-iteration rule). */
const SENT_ABBREV = /\b(?:vs|e\.g|i\.e|etc|approx|cf|U\.S|Mr|Ms|Dr|Inc|Corp)\./g;

/** A block's sentences, split the way tabs-iteration.spec.ts splits them. */
function sentencesOf(text: string): string[] {
  const t = text.replace(SENT_ABBREV, (m) => m.replace(/\./g, "")).replace(/\s+/g, " ").trim();
  if (!t) return [];
  return t.split(/(?<=[.!?][)"'”’\]]*)\s+/).filter((s) => /[A-Za-z]/.test(s));
}

/** A sentence that says something is not there. */
const SAYS_MISSING = /\b(?:no|not|none|nothing|unavailable|missing|isn['’]t|cannot|can['’]t|without|absent|unknown)\b/i;

async function openWith(page: Page, route: string, width: number, height: number, collapsed: boolean): Promise<void> {
  await page.setViewportSize({ width, height });
  await seedSidebar(page, collapsed);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page);
}

/** "button "Freshness ›"" for a failure line. */
async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const ae = document.activeElement;
    if (!ae || ae === document.body) return "body";
    const name = (ae.getAttribute("aria-label") ?? ae.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 50);
    return `${ae.tagName.toLowerCase()}${ae.id ? `#${ae.id}` : ""}${ae.getAttribute("data-testid") ? `[data-testid=${ae.getAttribute("data-testid")}]` : ""} "${name}"`;
  });
}

/**
 * Keyboard arrival (G6 "with a keyboard"): put focus on the tab stop that
 * precedes `selector` in sequential order, press Tab once, and return whether
 * the target now holds focus. A tab stop is a visible, enabled, non-inert
 * a[href] / button / input / select / textarea / summary / [tabindex] with
 * tabIndex ≥ 0, in document order.
 */
async function tabInto(page: Page, selector: string): Promise<{ ok: boolean; before: string; focus: string }> {
  const before = await page.evaluate((sel) => {
    const target = document.querySelector(sel);
    if (!target) return "no target";
    const STOPS = "a[href], button, input, select, textarea, summary, [tabindex]";
    const stop = (el: Element): boolean => {
      const h = el as HTMLElement & { disabled?: boolean };
      if (h.disabled || h.tabIndex < 0 || h.closest("[inert]")) return false;
      if (h.getClientRects().length === 0) return false;
      const cs = getComputedStyle(h);
      return cs.visibility === "visible" && !(h instanceof HTMLInputElement && h.type === "hidden");
    };
    const all = Array.from(document.querySelectorAll(STOPS)).filter((el) => el === target || stop(el));
    const i = all.indexOf(target);
    document.querySelectorAll("[data-e2e-before]").forEach((el) => el.removeAttribute("data-e2e-before"));
    if (i <= 0) return "no tab stop before the target";
    all[i - 1].setAttribute("data-e2e-before", "1");
    const p = all[i - 1];
    return `${p.tagName.toLowerCase()} "${(p.getAttribute("aria-label") ?? p.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40)}"`;
  }, selector);
  if (before.startsWith("no ")) return { ok: false, before, focus: await describeFocus(page) };
  await page.locator("[data-e2e-before]").first().focus();
  await page.keyboard.press("Tab");
  const ok = await page.evaluate((sel) => document.activeElement === document.querySelector(sel), selector);
  return { ok, before, focus: await describeFocus(page) };
}

/* ── M4 ─────────────────────────────────────────────────────────────────── */

const M4_H = 941;
const M4_CASES = [1672, 1440, 1280, 1024, 768, 390].flatMap((width) =>
  width >= 1024 ? [{ width, collapsed: false }, { width, collapsed: true }] : [{ width, collapsed: false }],
);
const M4_STRIP = "Market strip and data freshness";

interface DrawerOffender {
  selector: string;
  text: string;
  /** Which inner edge it passes. */
  edge: "right" | "left";
  /** Its right (or left) edge, px. */
  at: number;
  /** How far past the inner edge, px. */
  over: number;
  /** The nearest ancestor inside the drawer that clips or scrolls it, if any. */
  inside: string | null;
}

interface DrawerFit {
  error: string | null;
  box: { l: number; t: number; r: number; b: number } | null;
  vw: number;
  vh: number;
  innerLeft: number;
  innerRight: number;
  drawerScroll: { scrollWidth: number; clientWidth: number } | null;
  docScroll: { scrollWidth: number; clientWidth: number };
  offenders: DrawerOffender[];
  exempt: number;
  measured: number;
}

/**
 * In-page (self-contained): the freshness drawer against the viewport and
 * its own inner edges. Every rendered descendant element box and every
 * non-blank text run (Range client rects) is measured; one whose right edge
 * passes the drawer's inner right edge (left + clientLeft + clientWidth, so a
 * vertical scrollbar does not count as room) by more than 1 px is an
 * offender, and so is one whose left edge sits more than 1 px left of the
 * inner left edge (content scrolled off the left when the drawer itself
 * scrolls sideways, which is how the pre-fix drawer hid its title once focus
 * landed on the close button), unless an ancestor strictly inside the drawer
 * scrolls horizontally (overflow-x auto/scroll with scrollWidth > clientWidth)
 * and is, or contains, a keyboard tab stop.
 */
function measureDrawerFit(): DrawerFit {
  const de = document.documentElement;
  const docScroll = { scrollWidth: de.scrollWidth, clientWidth: de.clientWidth };
  const vw = de.clientWidth;
  const vh = window.innerHeight;
  const d = document.getElementById("freshness-drawer");
  const out: DrawerFit = { error: null, box: null, vw, vh, innerLeft: 0, innerRight: 0, drawerScroll: null, docScroll, offenders: [], exempt: 0, measured: 0 };
  if (!d) return { ...out, error: "no #freshness-drawer in the DOM" };
  const r = d.getBoundingClientRect();
  out.box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
  const innerLeft = r.left + d.clientLeft;
  const innerRight = innerLeft + d.clientWidth;
  out.innerLeft = innerLeft;
  out.innerRight = innerRight;
  out.drawerScroll = { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };

  const STOPS = "a[href], button, input, select, textarea, summary, [tabindex]";
  const isStop = (el: Element): boolean => {
    if (!el.matches(STOPS)) return false;
    const h = el as HTMLElement & { disabled?: boolean };
    return !h.disabled && h.tabIndex >= 0 && h.getClientRects().length > 0 && getComputedStyle(h).visibility === "visible";
  };
  const hasStop = (el: Element): boolean => isStop(el) || Array.from(el.querySelectorAll(STOPS)).some(isStop);
  const path = (el: Element): string => {
    const steps: string[] = [];
    let n: Element | null = el;
    while (n && steps.length < 4) {
      const cls = n.classList.length ? `.${Array.from(n.classList).slice(0, 2).join(".")}` : "";
      steps.unshift(`${n.tagName.toLowerCase()}${n.id ? `#${n.id}` : cls}`);
      if (n.id) break;
      n = n.parentElement;
    }
    return steps.join(" > ");
  };
  /** Exempt when a keyboard-reachable horizontal scroller inside the drawer holds it; else name what clips or scrolls it. */
  const verdict = (start: Element | null): { exempt: boolean; inside: string | null } => {
    let a = start;
    let inside: string | null = null;
    while (a && a !== d) {
      const cs = getComputedStyle(a);
      const scrolls = /(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1;
      if (scrolls && hasStop(a)) return { exempt: true, inside: null };
      if (scrolls) inside = inside ?? `${path(a)} (scrolls sideways, no tab stop)`;
      else if (/(hidden|clip)/.test(cs.overflowX)) inside = inside ?? `${path(a)} (clips)`;
      a = a.parentElement;
    }
    return { exempt: false, inside };
  };

  const seen = new Set<Element>();
  const flag = (owner: Element, left: number, right: number, text: string) => {
    const rightOver = right - innerRight;
    const leftOver = innerLeft - left;
    if (rightOver <= 1 && leftOver <= 1) return;
    if (seen.has(owner)) return;
    const v = verdict(owner === d ? null : owner);
    if (v.exempt) {
      out.exempt += 1;
      return;
    }
    seen.add(owner);
    const edge = rightOver > 1 ? "right" : "left";
    out.offenders.push({
      selector: path(owner),
      text: text.replace(/\s+/g, " ").trim().slice(0, 50),
      edge,
      at: Math.round(edge === "right" ? right : left),
      over: Math.round(edge === "right" ? rightOver : leftOver),
      inside: v.inside,
    });
  };

  for (const el of Array.from(d.querySelectorAll("*"))) {
    if (el.getClientRects().length === 0) continue;
    if (getComputedStyle(el).visibility !== "visible") continue;
    const er = el.getBoundingClientRect();
    if (er.width <= 1 && er.height <= 1) continue;
    out.measured += 1;
    flag(el, er.left, er.right, el.textContent ?? "");
  }
  const walker = document.createTreeWalker(d, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !(node.textContent ?? "").trim()) continue;
    if (getComputedStyle(parent).visibility !== "visible") continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    let left = Infinity;
    let right = -Infinity;
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width <= 0.5 || rect.height <= 0.5) continue;
      left = Math.min(left, rect.left);
      right = Math.max(right, rect.right);
    }
    if (right === -Infinity) continue;
    out.measured += 1;
    flag(parent, left, right, node.textContent ?? "");
  }
  out.offenders.sort((a, b) => b.over - a.over);
  return out;
}

/** Open the drawer from the strip's freshness card, or, when the card is not
 * on screen, from the sidebar / rail / MobileNav "Data freshness" entry. */
async function openFreshnessFromStrip(page: Page): Promise<{ opener: Locator; via: string }> {
  const card = page.getByRole("region", { name: M4_STRIP }).getByRole("button", { name: /^Freshness/ });
  if ((await card.count()) > 0 && (await card.first().isVisible())) {
    const opener = card.first();
    await opener.scrollIntoViewIfNeeded();
    await opener.click();
    return { opener, via: "the strip's Freshness card" };
  }
  const side = page.locator("#mrr-sidebar [data-testid='sidebar-freshness'], [data-testid='sidebar-rail'] [data-testid='sidebar-freshness']");
  if ((await side.count()) > 0 && (await side.first().isVisible())) {
    const opener = side.first();
    await opener.click();
    return { opener, via: "the sidebar freshness entry (no strip card on screen)" };
  }
  const menu = page.locator("button[aria-controls='mobile-nav-list']");
  await expect(menu, "no strip card and no sidebar: the MobileNav menu is the way in").toBeVisible();
  await menu.click();
  const opener = page.locator("#mobile-nav-list").getByRole("button", { name: /^Data freshness/ });
  await expect(opener).toHaveCount(1);
  await opener.click();
  return { opener, via: "the MobileNav Data freshness entry (no strip card on screen)" };
}

/** The M4 checks on an open drawer, then Escape and the focus return. One line per failed condition. */
async function checkFreshnessDrawer(page: Page, opener: Locator, via: string, tag: string): Promise<string[]> {
  const drawer = page.getByRole("dialog", { name: "Data freshness" });
  await expect(drawer, `the drawer opens from ${via}`).toBeVisible();
  await expect(drawer).toHaveAttribute("id", "freshness-drawer");
  // Let the report fill it: the feeds table is its widest block.
  await page
    .waitForFunction(() => !/Reading freshness/.test(document.getElementById("freshness-drawer")?.textContent ?? ""), null, { timeout: 15_000, polling: 200 })
    .catch(() => {});
  await page.waitForTimeout(400);
  const fit = await page.evaluate(measureDrawerFit);
  noteB(`m4-${tag}`, JSON.stringify({ via, box: fit.box, vw: fit.vw, innerLeft: fit.innerLeft, innerRight: fit.innerRight, drawerScroll: fit.drawerScroll, docScroll: fit.docScroll, exempt: fit.exempt, offenders: fit.offenders.slice(0, 12) }));

  const problems: string[] = [];
  if (fit.error) problems.push(fit.error);
  else {
    const b = fit.box as { l: number; t: number; r: number; b: number };
    if (b.l < -0.5 || b.t < -0.5 || b.r > fit.vw + 0.5 || b.b > fit.vh + 0.5)
      problems.push(`drawer box ${Math.round(b.l)},${Math.round(b.t)} → ${Math.round(b.r)},${Math.round(b.b)} is not inside the ${fit.vw}×${fit.vh} viewport`);
    if (fit.measured < 5) problems.push(`the drawer measured only ${fit.measured} boxes (empty drawer?)`);
    const ds = fit.drawerScroll as { scrollWidth: number; clientWidth: number };
    if (ds.scrollWidth > ds.clientWidth + 1) problems.push(`the drawer itself scrolls sideways: scrollWidth ${ds.scrollWidth} > clientWidth ${ds.clientWidth}`);
    if (fit.offenders.length)
      problems.push(
        `${fit.offenders.length} descendant(s) pass the drawer's inner edges (${Math.round(fit.innerLeft)}..${Math.round(fit.innerRight)} px) by > 1 px outside a keyboard-reachable scroller:\n    ${fit.offenders
          .slice(0, 10)
          .map((o) => `${o.selector} "${o.text}" ${o.edge} edge ${o.at} (${o.over} px past)${o.inside ? ` inside ${o.inside}` : ""}`)
          .join("\n    ")}`,
      );
  }
  if (fit.docScroll.scrollWidth > fit.docScroll.clientWidth)
    problems.push(`the page scrolls sideways while the drawer is open: scrollWidth ${fit.docScroll.scrollWidth} > clientWidth ${fit.docScroll.clientWidth}`);

  await page.keyboard.press("Escape");
  await expect(drawer, "Escape closes the drawer").toBeHidden();
  await page.waitForTimeout(150);
  const back = (await opener.count()) > 0 && (await opener.first().evaluate((el) => el === document.activeElement));
  if (!back) problems.push(`after Escape focus is on ${await describeFocus(page)}, not on the opener (${via})`);
  return problems;
}

test.describe("M4 the freshness drawer fits the viewport", () => {
  for (const { width, collapsed } of M4_CASES) {
    const side = collapsed ? "collapsed" : "expanded";
    test(`M4 /app/markets ${width}x${M4_H} sidebar ${side}: drawer from the strip inside the viewport, nothing clipped, no page side-scroll, Escape returns focus to the opener`, async ({ page }) => {
      await openWith(page, "/app/markets", width, M4_H, collapsed);
      const { opener, via } = await openFreshnessFromStrip(page);
      const problems = await checkFreshnessDrawer(page, opener, via, `markets-${width}-${side}`);
      expect(problems, `freshness drawer on /app/markets at ${width}x${M4_H}, sidebar ${side}, via ${via}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }

  test(`M4 /app/dashboard 1672x${M4_H} sidebar expanded: drawer from the sidebar entry inside the viewport, nothing clipped, no page side-scroll, Escape returns focus to the opener`, async ({ page }) => {
    await openWith(page, "/app/dashboard", 1672, M4_H, false);
    const opener = page.locator("#mrr-sidebar").getByTestId("sidebar-freshness");
    await expect(opener).toBeVisible();
    await opener.click();
    const via = "the sidebar freshness entry";
    const problems = await checkFreshnessDrawer(page, opener, via, "dashboard-1672-expanded");
    expect(problems, `freshness drawer on /app/dashboard at 1672x${M4_H} via ${via}:\n  ${problems.join("\n  ")}`).toEqual([]);
  });
});

/* ── M5 ─────────────────────────────────────────────────────────────────── */

const RESEARCH = "#single-name-research";
const HERO_SEARCH = "main [role='combobox'][aria-label='Search any listed symbol']";
const symWord = (sym: string) => new RegExp(`(^|[^A-Z0-9])${escapeRe(sym)}([^A-Z0-9]|$)`);
/** The symbol inside a trigger's textContent, where spans run together with
 * no space ("News for AAPLTagged headlines…"): a boundary before it, and no
 * digit, dot or dash after it (so NVDA never matches NVDA.BA or NVDA80). */
const symInTrigger = (sym: string) => new RegExp(`(^|[^A-Z0-9])${escapeRe(sym)}(?![0-9.\\-])`);

async function panelText(loc: Locator): Promise<string> {
  return clean(await loc.innerText().catch(() => ""));
}

/** The single-name view for `sym` in the research panel: the symbol, a candle
 * chart canvas, a range control, fundamentals or a sentence naming what is
 * missing, the return-by-regime block, the Options lens disclosure and the
 * ticker's news disclosure. */
async function expectResearchView(page: Page, sym: string): Promise<void> {
  const panel = page.locator(RESEARCH);
  await expect(panel, "the research panel exists").toHaveCount(1);
  await expect.poll(async () => symWord(sym).test(await panelText(panel)), { timeout: 30_000, message: `the research panel names ${sym}` }).toBe(true);

  const canvas = panel.locator("canvas").first();
  await expect(canvas, `a candle chart renders for ${sym}`).toBeVisible({ timeout: 60_000 });
  const cb = await canvas.boundingBox();
  expect(cb?.width ?? 0, "the candle chart has a real width").toBeGreaterThan(200);
  expect(cb?.height ?? 0, "the candle chart has a real height").toBeGreaterThan(100);

  const range = panel.getByRole("group", { name: /range/i }).first();
  await expect(range, "a chart range control").toBeVisible();
  expect(await range.getByRole("button").count(), "the range control offers several ranges").toBeGreaterThanOrEqual(5);
  await expect(range.locator("[aria-pressed='true']"), "one range is selected").toHaveCount(1);

  await expect
    .poll(
      async () => {
        const t = await panelText(panel);
        return /market cap/i.test(t) || sentencesOf(t).some((s) => /fundamental/i.test(s) && SAYS_MISSING.test(s));
      },
      { timeout: 30_000, message: `fundamentals for ${sym}, or a sentence naming what is missing` },
    )
    .toBe(true);

  await expect(panel, "a return-by-regime block").toContainText(/return by regime/i);

  const toggles = panel.locator("button[aria-expanded]");
  await expect(toggles.filter({ hasText: /options lens/i }), "an Options lens disclosure").toHaveCount(1, { timeout: 30_000 });
  await expect(toggles.filter({ hasText: /news/i }).filter({ hasText: symInTrigger(sym) }).first(), `a news disclosure for ${sym}`).toBeVisible();
}

/** Open the disclosure whose trigger matches `name` inside the research panel; return its panel region. */
async function openResearchDisclosure(page: Page, name: RegExp): Promise<Locator> {
  const btn = page.locator(`${RESEARCH} button[aria-expanded]`).filter({ hasText: name }).first();
  await btn.scrollIntoViewIfNeeded();
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  const id = await btn.getAttribute("aria-controls");
  expect(id, "the disclosure names its panel (aria-controls)").toBeTruthy();
  return page.locator(`[id="${id}"]`);
}

test.describe("M5 single-name research by search, by URL, and when data is missing", () => {
  test("M5 search: typing NVDA in the Markets hero search and picking NVDA sets ?name=NVDA and opens the full research view", async ({ page }) => {
    await openWith(page, "/app/markets", 1672, 941, false);
    const box = page.locator(HERO_SEARCH).first();
    await expect(box, "the hero symbol search").toBeVisible();
    await box.click();
    await box.fill("NVDA");
    const option = page.locator("main [role='listbox'] [role='option']").filter({ hasText: /(?:^|[\s▸])NVDA\s/ }).first();
    await expect(option, "an NVDA option in the result list").toBeVisible({ timeout: 20_000 });
    await option.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("name"), { timeout: 10_000, message: "picking NVDA writes ?name=NVDA into location.search" })
      .toBe("NVDA");
    await expectResearchView(page, "NVDA");
  });

  test("M5 direct load: /app/markets?name=AAPL opens the AAPL research view", async ({ page }) => {
    await openWith(page, "/app/markets?name=AAPL", 1672, 941, false);
    expect(new URL(page.url()).searchParams.get("name"), "the address keeps ?name=AAPL").toBe("AAPL");
    await expectResearchView(page, "AAPL");
  });

  test("M5 unknown symbol: /app/markets?name=ZZZZQX prints a plain sentence naming ZZZZQX, never a blank panel", async ({ page }) => {
    await openWith(page, "/app/markets?name=ZZZZQX", 1672, 941, false);
    const panel = page.locator(RESEARCH);
    await expect(panel).toHaveCount(1);
    let text = "";
    await expect
      .poll(
        async () => {
          text = await panelText(panel);
          return sentencesOf(text).some((s) => s.includes("ZZZZQX") && SAYS_MISSING.test(s) && s.split(/\s+/).length >= 4);
        },
        { timeout: 30_000, message: "a plain sentence in the research panel that names ZZZZQX and says it was not found" },
      )
      .toBe(true);
    noteB("m5-unknown", text);
    const body = text.replace(/single-name research/i, "").trim();
    expect(body.length, `the research panel is not empty: "${text}"`).toBeGreaterThan(40);
  });

  test("M5 missing blocks: options expirations 403 and no ticker news each say what is missing while the candles still render", async ({ page }) => {
    await page.route(
      (url) => url.pathname === "/api/market/options/NVDA/expirations",
      (route) => route.fulfill({ status: 403, json: { detail: "Provider refused the request.", kind: "unavailable", provider: "eodhd", retryable: false } }),
    );
    await page.route(
      (url) => url.pathname === "/api/news" && (url.searchParams.get("ticker") ?? "").toUpperCase() === "NVDA",
      (route) => route.fulfill({ status: 200, json: [] }),
    );
    await openWith(page, "/app/markets?name=NVDA", 1672, 941, false);
    const panel = page.locator(RESEARCH);
    await expect.poll(async () => symWord("NVDA").test(await panelText(panel)), { timeout: 30_000 }).toBe(true);
    await expect(panel.locator("canvas").first(), "the candles render").toBeVisible({ timeout: 60_000 });

    const options = await openResearchDisclosure(page, /options lens/i);
    let optText = "";
    await expect
      .poll(
        async () => {
          optText = await panelText(options);
          return sentencesOf(optText).some((s) => /option|chain|expiration/i.test(s) && SAYS_MISSING.test(s));
        },
        { timeout: 20_000, message: "the Options lens prints a sentence naming the missing options data" },
      )
      .toBe(true);

    const news = await openResearchDisclosure(page, /news/i);
    let newsText = "";
    await expect
      .poll(
        async () => {
          newsText = await panelText(news);
          return sentencesOf(newsText).some((s) => (symWord("NVDA").test(s) || /news|coverage|headline|tagged|stor(?:y|ies)/i.test(s)) && SAYS_MISSING.test(s));
        },
        { timeout: 20_000, message: "the ticker news block prints a sentence naming the missing NVDA news" },
      )
      .toBe(true);
    noteB("m5-missing", JSON.stringify({ options: optText, news: newsText.slice(0, 400) }));

    await expect(panel.locator("canvas").first(), "the candles still render with both blocks open").toBeVisible();
    const cb = await panel.locator("canvas").first().boundingBox();
    expect(cb?.width ?? 0, "the candle chart keeps a real width").toBeGreaterThan(200);
  });
});

/* ── R2 by keyboard ──────────────────────────────────────────────────────── */

test.describe("R2 keyboard: ArrowRight between sub-tabs keeps the scroll position", () => {
  for (const { width, height } of VIEWPORTS) {
    test(`R2 keyboard Regime Lab at ${width}x${height}: ArrowRight from the focused selected sub-tab keeps scrollY, focuses the new tab, updates the hash`, async ({ page }) => {
      await open(page, "/app/regime-lab", width, height);
      const list = page.getByRole("tablist", { name: LAB_LIST });
      await expect(list.getByRole("tab")).toHaveCount(5);
      // The shell's freshness report can land late under load and mount the one-line stored-close
      // notice above the page (≈46 px); scroll anchoring then moves scrollY by that height with the
      // page visually still. That shift is late shell data, not the sub-tab switch, so the shell must
      // have its freshness report before the first measurement.
      await page
        .waitForFunction(() => performance.getEntriesByType("resource").some((e) => e.name.includes("/api/freshness")), undefined, { timeout: 15_000 })
        .catch(() => undefined);
      await page.waitForTimeout(400);
      const problems: string[] = [];
      // From the default view, ArrowRight five times: every view once, the last wraps to the first.
      for (let i = 0; i < LAB_TABS.length; i++) {
        const from = LAB_TABS[i];
        const to = LAB_TABS[(i + 1) % LAB_TABS.length];
        await centreTablist(page, LAB_LIST);
        const selected = list.getByRole("tab", { selected: true });
        await expect(selected, `one selected tab before leaving ${from.label}`).toHaveCount(1);
        await expect(selected).toHaveAccessibleName(new RegExp(`^${escapeRe(from.label)}`));
        await selected.focus();
        await expect(selected, `${from.label} holds focus`).toBeFocused();
        const start = await switchState(page, LAB_LIST);
        await page.keyboard.press("ArrowRight");
        const tab = tabIn(page, LAB_LIST, to.label);
        await expect(tab, `ArrowRight selects ${to.label}`).toHaveAttribute("aria-selected", "true");
        const early = await switchState(page, LAB_LIST);
        await settleSwitch(page);
        const s = await switchState(page, LAB_LIST);
        const drift = Math.max(Math.abs(early.y - start.y), Math.abs(s.y - start.y));
        if (drift > 4) problems.push(`${from.label} → ${to.label}: scrollY moved ${Math.round(drift)} px > 4 (${start.y} → ${early.y} on select → ${s.y} settled)`);
        if (!(s.listTop >= 0 && s.listBottom <= s.vh)) problems.push(`${to.label}: tablist at ${Math.round(s.listTop)}..${Math.round(s.listBottom)} px, outside the ${s.vh} px viewport`);
        if (!s.focusIsSelectedTab || !(await tab.evaluate((el) => el === document.activeElement))) problems.push(`${to.label}: focus on ${s.focus}, not the newly selected tab`);
        if (s.hash !== `#${to.anchor}`) problems.push(`${to.label}: hash ${s.hash || "(none)"}, expected #${to.anchor}`);
      }
      expect(problems, `Regime Lab keyboard switches at ${width}x${height}:\n  ${problems.join("\n  ")}`).toEqual([]);
    });
  }
});

/* ── N4 by keyboard ──────────────────────────────────────────────────────── */

/** The tabs-iteration.spec.ts N4 mock, repeated here (a spec cannot import another spec). */
const KB_AI_URL = "https://example.com/e2e/ai-article";
const KB_WIRE_URL = "https://example.com/e2e/wire-article";
const KB_SRC_1 = "https://example.org/e2e/source-one";
const KB_SRC_2 = "https://example.net/e2e/source-two";
const KB_AI_INTERP = [
  "Kestrel demand at the auction pushed yields lower across the curve.",
  "Heron positioning suggests investors expect slower growth ahead.",
  "Osprey flows into duration usually precede a softer macro print.",
  "Plover signals from breakevens show inflation expectations holding steady.",
  "Wren readings on credit spreads show no stress spilling over.",
  "Tern implications for the regime call lean toward Goldilocks for now.",
];
const KB_AI_RESEARCH = [
  "Lynx analysts cited the strongest bid-to-cover ratio this year.",
  "Ocelot dealers took down a smaller share than usual.",
  "Caracal foreign demand rose for the third straight auction.",
  "Margay strategists expect the curve to steepen modestly.",
  "Serval futures positioning remains short the long end.",
  "Jaguar commentary flagged the upcoming payrolls report as the next test.",
];
const KB_AI_SENTENCES = [...KB_AI_INTERP, ...KB_AI_RESEARCH];

function kbNewsItem(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 0,
    headline: "",
    summary: null,
    url: null,
    source: "Reuters",
    category: "MACRO",
    published_at: new Date(Date.now() - 2 * 3_600_000).toISOString().replace("Z", "+00:00"),
    fetched_at: new Date(Date.now() - 2 * 3_600_000).toISOString().slice(0, 19).replace("T", " "),
    market_impact: 3,
    deal_size: 1,
    sector_relevance: 3,
    time_sensitivity: 3,
    regime_relevance: 3,
    overall_significance: 3,
    regime_interpretation: null,
    perplexity_research: null,
    ticker: null,
    ...over,
  };
}

const KB_AI_ITEM = (sig: number) =>
  kbNewsItem({
    id: 990_101,
    headline: "Mock AI desk item: Treasury auction draws record demand",
    summary: "Wire blurb for the AI item says demand was strong.",
    url: KB_AI_URL,
    overall_significance: sig,
    regime_interpretation: KB_AI_INTERP.join(" "),
    perplexity_research: `${KB_AI_RESEARCH.join(" ")}\n\nSources:\n${KB_SRC_1}\n${KB_SRC_2}`,
  });
const KB_WIRE_ITEM = (sig: number) =>
  kbNewsItem({
    id: 990_102,
    headline: "Mock wire item: Factory orders edge higher in August",
    summary: "Factory orders rose modestly in August. Analysts had expected a flat print.",
    url: KB_WIRE_URL,
    source: "CNBC",
    overall_significance: sig,
  });
const KB_FILLERS = [4.9, 4.8, 4.7, 4.6].map((sig, i) =>
  kbNewsItem({
    id: 990_200 + i,
    headline: `Mock filler ${i + 1}: central bank minutes note ${["steady", "patient", "cautious", "balanced"][i]} policy`,
    summary: `Filler ${i + 1} wire summary for the priority slot.`,
    url: `https://example.com/e2e/filler-${i + 1}`,
    overall_significance: sig,
    published_at: new Date(Date.now() - (i + 1) * 3_600_000).toISOString().replace("Z", "+00:00"),
  }),
);

/** In-page: tag the card or row holding the headline link `url` (the largest
 * ancestor that holds no other mocked headline link) with data-e2e-row. */
function kbMarkRow(args: { url: string; urls: string[]; tag: string }): boolean {
  const link = document.querySelector(`main a[href="${args.url}"]`);
  if (!link) return false;
  const others = args.urls.filter((u) => u !== args.url);
  let row: Element = link;
  while (row.parentElement && row.parentElement.tagName !== "MAIN") {
    const p = row.parentElement;
    if (others.some((u) => p.querySelector(`a[href="${u}"]`))) break;
    row = p;
  }
  row.setAttribute("data-e2e-row", args.tag);
  return true;
}

test.describe("N4 keyboard: the AI read opens by Enter and its sources are Tab stops", () => {
  for (const width of [1672, 1280]) {
    test(`N4 keyboard ${width}x941: Tab reaches the AI row's read toggle, Enter opens ≤ 4 sentences, Tab reaches both source links`, async ({ page }) => {
      await emptyEndpoint(page, "/api/news", [...KB_FILLERS, KB_AI_ITEM(3.2), KB_WIRE_ITEM(3.0)]);
      await open(page, "/app/news", width, 941);
      await expect(page.locator(`#feed a[href="${KB_AI_URL}"]`).first(), "the AI item renders in the feed").toBeVisible({ timeout: 20_000 });
      const urls = [KB_AI_URL, KB_WIRE_URL, ...KB_FILLERS.map((f) => String(f.url))];
      expect(await page.evaluate(kbMarkRow, { url: KB_AI_URL, urls, tag: "ai-kb" })).toBe(true);
      const ai = page.locator("[data-e2e-row='ai-kb']");
      await expect(ai).toHaveCount(1);

      // The row's read toggle (the tabs-iteration preference: one naming the read / analysis / sources).
      const toggles = ai.locator("button[aria-expanded='false']");
      expect(await toggles.count(), "the AI row has a collapsed toggle").toBeGreaterThan(0);
      const preferred = toggles.filter({ hasText: /read|analysis|\bAI\b|source|why/i });
      const pick = (await preferred.count()) ? preferred.first() : toggles.first();
      await pick.evaluate((el) => el.setAttribute("data-e2e-toggle", "read-kb"));
      const toggle = ai.locator("[data-e2e-toggle='read-kb']");
      await toggle.scrollIntoViewIfNeeded();

      const arrival = await tabInto(page, "[data-e2e-toggle='read-kb']");
      expect(arrival.ok, `Tab from ${arrival.before} lands on the read toggle (focus on ${arrival.focus})`).toBe(true);
      await page.keyboard.press("Enter");
      await expect(toggle, "Enter opens the analysis").toHaveAttribute("aria-expanded", "true");
      await page.waitForTimeout(250);

      const rowText = clean(await ai.innerText()).toLowerCase();
      const shown = KB_AI_SENTENCES.filter((s) => rowText.includes(s.toLowerCase()));
      noteB(`n4-kb-${width}`, JSON.stringify(shown));
      expect(shown.length, "the AI analysis is visible after Enter").toBeGreaterThan(0);
      expect(shown.length, `at most four AI sentences visible: ${JSON.stringify(shown)}`).toBeLessThanOrEqual(4);

      const reached: string[] = [];
      for (let i = 0; i < 20 && !(reached.includes(KB_SRC_1) && reached.includes(KB_SRC_2)); i++) {
        await page.keyboard.press("Tab");
        const href = await page.evaluate(() => {
          const ae = document.activeElement;
          return ae && ae.closest("[data-e2e-row='ai-kb']") ? ae.getAttribute("href") ?? `(${ae.tagName.toLowerCase()})` : `(outside the row: ${ae?.tagName.toLowerCase() ?? "none"})`;
        });
        reached.push(href);
      }
      expect(reached, "source link 1 is a Tab stop after the toggle").toContain(KB_SRC_1);
      expect(reached, "source link 2 is a Tab stop after the toggle").toContain(KB_SRC_2);
    });
  }
});

/* ── X3 by keyboard ──────────────────────────────────────────────────────── */

const KB_PCTS = /[−+-]?\d+(?:\.\d+)?%/g;

test.describe("X3 keyboard: sliders and Reset by keyboard", () => {
  for (const width of [1672, 1280]) {
    test(`X3 keyboard ${width}x941: Tab to the first slider, ArrowRight ×3 changes the adjusted figure; Tab to Reset, Enter returns the model's reading`, async ({ page }) => {
      const scenario: { probability: number | null }[] = [];
      page.on("response", async (r: Response) => {
        const u = new URL(r.url());
        if (u.pathname !== "/api/recession/scenario" || r.request().method() !== "POST") return;
        try {
          const j = (await r.json()) as { probability?: number };
          scenario.push({ probability: typeof j.probability === "number" ? j.probability : null });
        } catch {
          /* aborted */
        }
      });
      await open(page, "/app/recession", width, 941);
      const h1 = page.locator("main h1");
      await expect(h1).toHaveText(/\d+(\.\d)?%/, { timeout: 60_000 });
      const headline = (clean(await h1.innerText()).match(/\d+(?:\.\d)?%/) ?? [""])[0];
      const sens = page.locator("#sensitivity");
      const sliders = sens.getByRole("slider");
      await expect(sliders, "five sliders in #sensitivity").toHaveCount(5, { timeout: 30_000 });

      // The panel settles on its on-load figures (the scenario posts on load).
      let pcts0 = "";
      await expect
        .poll(
          async () => {
            const now = clean(await sens.innerText()).match(KB_PCTS)?.join(" ") ?? "";
            const same = now === pcts0 && now.length > 0;
            pcts0 = now;
            return same;
          },
          { timeout: 20_000, intervals: [600] },
        )
        .toBe(true);
      await expect.poll(() => scenario.length > 0, { timeout: 20_000, message: "the scenario is scored on load" }).toBe(true);
      const p0 = scenario[scenario.length - 1].probability;

      const first = sliders.first();
      await first.evaluate((el) => el.setAttribute("data-e2e-slider", "first"));
      const arrival = await tabInto(page, "#sensitivity [data-e2e-slider='first']");
      expect(arrival.ok, `Tab from ${arrival.before} lands on the first slider (focus on ${arrival.focus})`).toBe(true);
      const value0 = await first.inputValue();
      const count0 = scenario.length;
      for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
      expect(await first.inputValue(), "ArrowRight ×3 moves the first slider").not.toBe(value0);
      await expect.poll(() => scenario.length > count0 && scenario[scenario.length - 1].probability != null, { timeout: 20_000 }).toBe(true);
      await page.waitForTimeout(700);
      const p1 = `${(scenario[scenario.length - 1].probability as number).toFixed(1)}%`;
      await expect(sens, `the adjusted figure ${p1} is printed`).toContainText(p1, { timeout: 10_000 });
      expect(p1, "the adjusted figure changed").not.toBe(p0 != null ? `${p0.toFixed(1)}%` : "");
      if (headline) await expect(sens, `the model's reading ${headline} is still stated`).toContainText(headline);

      // Tab forward to Reset and press Enter.
      const reset = sens.getByRole("button", { name: /reset/i }).first();
      await expect(reset).toBeEnabled();
      let reached = false;
      const path: string[] = [];
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press("Tab");
        if (await reset.evaluate((el) => el === document.activeElement)) {
          reached = true;
          break;
        }
        path.push(await describeFocus(page));
      }
      expect(reached, `Tab from the first slider reaches Reset (passed ${path.join(" → ")})`).toBe(true);
      await page.keyboard.press("Enter");
      await expect.poll(async () => clean(await sens.innerText()).match(KB_PCTS)?.join(" ") ?? "", { timeout: 20_000, message: "Reset returns every figure to the model's reading" }).toBe(pcts0);
      expect(await first.inputValue(), "Reset returns the first slider").toBe(value0);
      if (headline) await expect(sens, `the model's reading ${headline} is stated after Reset`).toContainText(headline);
    });
  }
});
