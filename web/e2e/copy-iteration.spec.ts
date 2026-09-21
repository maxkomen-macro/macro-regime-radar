/**
 * Iteration 1, Step 5 (copy): the permanent G4 sentence-caps sweep plus the
 * copy fixes CP1 to CP3 of docs/redesign-v2/ITERATION_1.md. Driven in a real
 * browser against the running Vite dev server (playwright.config.ts
 * baseURL, proxying the API on :8000); servers are never started here.
 * PERMANENT: never tuned to pass.
 *
 * MARKER CONTRACT (built by the implementer; screen-ui.tsx useCopyMarker):
 *   data-copy="lede"     every hero lede                       ≤ 3 sentences
 *   data-copy="caption"  tile and chart captions               ≤ 2 sentences,
 *                        ≤ data-copy-max when present, never more than 3
 *   data-copy="status"   status lines                          one rendered line
 * Markers sit only on copy a reader sees with every disclosure closed (none
 * inside an open Disclosure panel), so the sweep never opens anything.
 *
 * SENTENCE-CAPS SWEEP (one test per view × width, "copy caps <view> <w>x941"):
 *   views   the eight routes, with Regime Lab reached per sub-tab by hash
 *           (Overview #takeaway, Playbook #playbook, Scenarios #scenarios,
 *           History #analogues, Evidence #backtests) and Tools per sub-tab
 *           (#lbo, #allocation): thirteen views;
 *   widths  1672 / 1440 / 1280 / 1024 / 768 / 390 at 941 tall, sidebar
 *           seeded expanded, disclosures as the page loads them (closed).
 *   Every visible [data-copy] in the document (main, the strip, the sidebar)
 *   is read: its visible text (hidden, sr-only and closed-tooltip text
 *   skipped) is split with src/lib/sentences.ts splitSentences (the N4
 *   counter: abbreviations, initials, decimals and citation runs never
 *   split). Fails on a lede over 3, a caption over its cap, a status line
 *   whose text box is taller than 1.6 × its computed line-height (the text
 *   node rects, not the element box). Status sentence counts are reported,
 *   never asserted (G4 says "1 line"). Non-vacuity: <main> holds at least one
 *   visible lede and at least one visible caption or status line. Offenders
 *   carry route, width, selector, text and count; the full read is written to
 *   test-results/copy-iteration/<view>-<w>.json.
 *
 * CP1  /app/credit at 1672 and 390, every disclosure opened and every jargon
 *      tooltip opened by focus (the first Tight also by hover): no visible
 *      text matches /\b\d+(\.\d+)? bp\b/ ("bps" passes).
 * CP2  The ⌘K / Ctrl+K palette lists "Model inputs" and no "Probability
 *      model"; choosing it lands on /app/recession with the "Model inputs"
 *      heading inside the viewport.
 * CP3  Every view at 1672: the regime labels in regime contexts (odds bar
 *      segment titles and legends, [data-regime] / [data-quadrant] values,
 *      the text of regime charts: the Dashboard hero chart, the Regime Lab
 *      quadrant, the ribbon, any svg[role=img] whose label names "regime";
 *      the regime-lab legend; the regime / odds / next-N-months summary rows;
 *      the #transitions leaf labels; the Playbook regime picker; the Evidence
 *      column headers; the Dashboard hero h1) never name the fourth regime
 *      "Recession" or "Contraction": a label matching /\brecession\b/i not
 *      followed by "Risk" (and not a recession-model / NBER / probability
 *      label), or /\bcontraction\b/i, fails. The Recession tab name and the
 *      "NBER recession model" row are outside these contexts by element.
 */
import { test, expect, type Page } from "@playwright/test";
import { splitSentences } from "../src/lib/sentences";
import { openAllDisclosures } from "./lib/drive";
import { seedSidebar, waitForScreenData, writeSweepReport } from "./lib/geometry";

const HEIGHT = 941;
const WIDTHS = [1672, 1440, 1280, 1024, 768, 390];
const PALETTE_KEY = process.platform === "darwin" ? "Meta+K" : "Control+K";
const note = (type: string, description: string) => test.info().annotations.push({ type, description });

interface View {
  key: string;
  route: string;
  /** SubTabs id of the sub-tab the hash selects (`<uid>-tab-<id>`). */
  subtab?: string;
  /** How long the hero may keep a loading headline ("…") before the sweep reads anyway. */
  readyMs?: number;
}

const COPY_VIEWS: View[] = [
  { key: "dashboard", route: "/app/dashboard" },
  { key: "regime-lab-overview", route: "/app/regime-lab#takeaway", subtab: "overview" },
  { key: "regime-lab-playbook", route: "/app/regime-lab#playbook", subtab: "playbook" },
  { key: "regime-lab-scenarios", route: "/app/regime-lab#scenarios", subtab: "scenarios" },
  { key: "regime-lab-history", route: "/app/regime-lab#analogues", subtab: "history" },
  { key: "regime-lab-evidence", route: "/app/regime-lab#backtests", subtab: "evidence" },
  { key: "markets", route: "/app/markets" },
  { key: "credit", route: "/app/credit" },
  { key: "recession", route: "/app/recession" },
  { key: "news", route: "/app/news" },
  { key: "tools-lbo", route: "/app/tools#lbo", subtab: "lbo" },
  // The allocation cold call downloads return histories (~30-60 s, CLAUDE.md).
  { key: "tools-allocation", route: "/app/tools#allocation", subtab: "allocation", readyMs: 90_000 },
  { key: "methodology", route: "/app/methodology" },
];

async function openView(page: Page, v: View, width: number): Promise<void> {
  await page.setViewportSize({ width, height: HEIGHT });
  await seedSidebar(page, false);
  await page.goto(v.route, { waitUntil: "domcontentloaded" });
  await waitForScreenData(page, 12_000, 600);
  if (v.subtab) {
    await expect(page.locator(`main [role='tab'][aria-selected='true'][id$='-tab-${v.subtab}']`), `${v.route}: the hash selects the ${v.subtab} sub-tab`).toHaveCount(1, {
      timeout: 15_000,
    });
  }
  // A hero still on its loading headline would sweep loading copy: give it the view's budget.
  await page
    .waitForFunction(() => !/…\s*$/.test(document.querySelector("main h1")?.textContent?.trim() ?? ""), null, { timeout: v.readyMs ?? 15_000, polling: 250 })
    .catch(() => note("hero-still-loading", `${v.route} @${width}: the h1 still ends in "…" after ${(v.readyMs ?? 15_000) / 1000} s`));
  await waitForScreenData(page, 4_000, 400);
}

/* ── in-page: the marked copy ───────────────────────────────────────────── */

interface CopyItem {
  kind: string;
  max: string | null;
  text: string;
  selector: string;
  inMain: boolean;
  /** Largest computed line-height (px) among the text's parents ("normal" = 1.2 × font-size). */
  lineHeight: number;
  /** Height of the union of the text node rects (px). */
  textHeight: number;
  /** Rendered lines: text rects clustered by vertical centre. */
  lines: number;
}

/** Self-contained (page.evaluate): every visible [data-copy] element, its visible text and its text-box metrics. */
function collectCopy(): CopyItem[] {
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const round = (n: number) => Math.round(n * 10) / 10;
  type VisEl = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  const visible = (el: Element): boolean => {
    const v = el as VisEl;
    if (typeof v.checkVisibility === "function" && !v.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const srOnlyUpTo = (el: Element | null, stop: Element): boolean => {
    for (let n = el; n && n !== stop.parentElement; n = n.parentElement) {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      const clipped = cs.overflow === "hidden" || cs.overflow === "clip" || (cs.clip && cs.clip !== "auto") || /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && clipped) return true;
    }
    return false;
  };
  const blockOf = (el: Element): Element => {
    let n: Element | null = el;
    while (n) {
      const d = getComputedStyle(n).display;
      if (!d.startsWith("inline") && d !== "contents") return n;
      n = n.parentElement;
    }
    return el;
  };
  const lh = (el: Element): number => {
    const cs = getComputedStyle(el);
    const v = Number.parseFloat(cs.lineHeight);
    return Number.isFinite(v) ? v : 1.2 * (Number.parseFloat(cs.fontSize) || 16);
  };
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== document.body && parts.length < 4) {
      let step = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${step}#${n.id}`);
        break;
      }
      const cls = Array.from(n.classList).slice(0, 2);
      if (cls.length) step += `.${cls.join(".")}`;
      const copy = n.getAttribute("data-copy");
      if (copy) step += `[data-copy="${copy}"]`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };

  const out: CopyItem[] = [];
  for (const el of Array.from(document.querySelectorAll("[data-copy]"))) {
    if (!visible(el)) continue;
    let text = "";
    let lastBlock: Element | null = null;
    let lineHeight = 0;
    const rects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const p = node.parentElement;
      if (!p || !visible(p) || srOnlyUpTo(p, el)) continue;
      if (p.closest("[role='tooltip']") && el.contains(p.closest("[role='tooltip']"))) continue;
      const data = (node as Text).data;
      const block = blockOf(p);
      if (lastBlock && block !== lastBlock) text += " ";
      lastBlock = block;
      text += data;
      if (!data.trim()) continue;
      lineHeight = Math.max(lineHeight, lh(p));
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0.5 && r.height > 0.5) rects.push(r);
    }
    text = clean(text);
    if (!text) continue;
    let top = Infinity;
    let bottom = -Infinity;
    const centres: number[] = [];
    for (const r of rects) {
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
      centres.push((r.top + r.bottom) / 2);
    }
    centres.sort((a, b) => a - b);
    let lines = 0;
    let last = -Infinity;
    for (const c of centres) {
      if (c - last > (lineHeight || 16) * 0.5) lines += 1;
      last = c;
    }
    out.push({
      kind: el.getAttribute("data-copy") ?? "",
      max: el.getAttribute("data-copy-max"),
      text,
      selector: cssPath(el),
      inMain: el.closest("main") !== null,
      lineHeight: round(lineHeight),
      textHeight: rects.length ? round(bottom - top) : 0,
      lines,
    });
  }
  return out;
}

/* ── Node side: caps ────────────────────────────────────────────────────── */

const LEDE_CAP = 3;
const CAPTION_CAP = 2;
const CAPTION_CEILING = 3;
const STATUS_LINE_FACTOR = 1.6;

/** A caption's cap: data-copy-max when it parses, never above 3; else 2. */
function captionCap(max: string | null): number {
  const n = max == null ? Number.NaN : Number.parseInt(max, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, CAPTION_CEILING) : CAPTION_CAP;
}

interface CopyVerdict extends CopyItem {
  sentences: number;
  cap: number | null;
  /** Status only: the text box height limit (1.6 × line-height). */
  heightLimit: number | null;
  offence: string | null;
}

function judge(item: CopyItem): CopyVerdict {
  const sentences = splitSentences(item.text).length;
  if (item.kind === "status") {
    const limit = Math.round(STATUS_LINE_FACTOR * item.lineHeight * 10) / 10;
    const over = item.textHeight > limit + 0.5;
    return {
      ...item,
      sentences,
      cap: null,
      heightLimit: limit,
      offence: over ? `status wraps: text box ${item.textHeight}px > ${limit}px (1.6 × line-height ${item.lineHeight}px), ${item.lines} lines, ${sentences} sentence(s)` : null,
    };
  }
  const cap = item.kind === "lede" ? LEDE_CAP : item.kind === "caption" ? captionCap(item.max) : null;
  let offence: string | null = null;
  if (cap == null) offence = `unknown data-copy kind "${item.kind}"`;
  else if (sentences > cap) offence = `${item.kind} has ${sentences} sentences (cap ${cap}${item.max != null ? `, data-copy-max="${item.max}"` : ""})`;
  if (item.kind === "caption" && item.max != null && Number.parseInt(item.max, 10) > CAPTION_CEILING) {
    offence = `${offence ? `${offence}; ` : ""}data-copy-max="${item.max}" exceeds the ceiling of 3`;
  }
  return { ...item, sentences, cap, heightLimit: null, offence };
}

const describeOffence = (route: string, width: number, v: CopyVerdict) =>
  `${route} @${width} ${v.selector} [${v.kind}${v.max != null ? ` max=${v.max}` : ""}] ${v.offence}: "${v.text.slice(0, 220)}${v.text.length > 220 ? "…" : ""}"`;

/* ── the sweep: one test per view × width ───────────────────────────────── */

test.describe("G4 sentence caps", () => {
  for (const v of COPY_VIEWS) {
    for (const width of WIDTHS) {
      test(`copy caps ${v.key} ${width}x${HEIGHT}`, async ({ page }, testInfo) => {
        await openView(page, v, width);
        const items = await page.evaluate(collectCopy);
        const verdicts = items.map(judge);
        const offenders = verdicts.filter((x) => x.offence);
        const main = verdicts.filter((x) => x.inMain);
        const ledes = main.filter((x) => x.kind === "lede").length;
        const captions = main.filter((x) => x.kind === "caption").length;
        const statuses = main.filter((x) => x.kind === "status").length;
        const statusSentences = verdicts.filter((x) => x.kind === "status").map((x) => ({ selector: x.selector, sentences: x.sentences, lines: x.lines, text: x.text }));
        await writeSweepReport(testInfo, "copy-iteration", `${v.key}-${width}`, {
          route: v.route,
          width,
          counts: { total: verdicts.length, ledesInMain: ledes, captionsInMain: captions, statusesInMain: statuses },
          offenders,
          statusSentences,
          items: verdicts,
        });
        const multi = statusSentences.filter((s) => s.sentences > 1);
        if (multi.length) note("status-sentences", `${v.route} @${width}: ${multi.map((s) => `${s.selector} ${s.sentences} sentences "${s.text.slice(0, 80)}"`).join(" | ")}`);

        expect.soft(ledes, `${v.route} @${width}: <main> has no visible [data-copy="lede"] (an unmarked page cannot pass the caps)`).toBeGreaterThanOrEqual(1);
        expect
          .soft(captions + statuses, `${v.route} @${width}: <main> has no visible [data-copy="caption"] or [data-copy="status"] (an unmarked page cannot pass the caps)`)
          .toBeGreaterThanOrEqual(1);
        expect(offenders.map((o) => describeOffence(v.route, width, o)), `${v.route} @${width}: marked copy over its G4 cap`).toEqual([]);
      });
    }
  }
});

/* ── CP1: "bps" everywhere on Credit ─────────────────────────────────────── */

const BP_RE = /\b\d+(?:\.\d+)? bp\b/g;

function bpHits(label: string, text: string): string[] {
  const hits: string[] = [];
  for (const m of text.matchAll(BP_RE)) {
    const at = m.index ?? 0;
    hits.push(`${label}: "…${text.slice(Math.max(0, at - 50), at + m[0].length + 30).replace(/\s+/g, " ")}…"`);
  }
  return hits;
}

test.describe("CP1 bps on Credit", () => {
  for (const width of [1672, 390]) {
    test(`CP1 no "N bp" on /app/credit ${width}x${HEIGHT} (disclosures and jargon tooltips open)`, async ({ page }) => {
      await page.setViewportSize({ width, height: HEIGHT });
      await seedSidebar(page, false);
      await page.goto("/app/credit", { waitUntil: "domcontentloaded" });
      await waitForScreenData(page, 12_000, 600);
      await openAllDisclosures(page);
      const hits: string[] = [];
      hits.push(...bpHits("page text", await page.locator("body").innerText()));

      // Every jargon tooltip on the page, opened by focus.
      const jargon = page.locator("main .jargon");
      const n = await jargon.count();
      let tight = 0;
      for (let i = 0; i < n; i++) {
        const term = jargon.nth(i);
        if (!(await term.isVisible())) continue;
        const label = (await term.innerText()).trim();
        await term.focus();
        const tip = term.locator("xpath=following-sibling::*[@role='tooltip']");
        await expect(tip, `jargon "${label}" opens its tooltip on focus`).toBeVisible({ timeout: 3_000 });
        hits.push(...bpHits(`"${label}" tooltip (focus)`, await tip.innerText()));
        if (/^Tight$/i.test(label)) tight += 1;
        await page.keyboard.press("Escape");
      }
      expect(tight, "at least one Tight jargon affordance on /app/credit (the CP1 sentence lives in its tooltip)").toBeGreaterThanOrEqual(1);

      // The first Tight, opened by hover.
      await page.locator("body").focus().catch(() => undefined);
      const firstTight = jargon.filter({ hasText: /^Tight$/ }).first();
      await firstTight.scrollIntoViewIfNeeded();
      await firstTight.hover();
      const hoverTip = firstTight.locator("xpath=following-sibling::*[@role='tooltip']");
      await expect(hoverTip, "the Tight tooltip opens on hover").toBeVisible({ timeout: 3_000 });
      hits.push(...bpHits('"Tight" tooltip (hover)', await hoverTip.innerText()));

      expect(hits, `/app/credit @${width}: "N bp" where Credit says "bps"`).toEqual([]);
    });
  }
});

/* ── CP2: the palette names the heading it jumps to ──────────────────────── */

test("CP2 the palette lists Model inputs (not Probability model) and lands on the Recession Model inputs heading", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: HEIGHT });
  await seedSidebar(page, false);
  await page.goto("/app/dashboard", { waitUntil: "domcontentloaded" });
  await waitForScreenData(page, 12_000, 400);
  await page.keyboard.press(PALETTE_KEY);
  const dialog = page.getByRole("dialog", { name: "Jump to tab or section" });
  await expect(dialog).toBeVisible();
  const options = dialog.getByRole("option");
  // The unfiltered list: every destination is rendered (the listbox scrolls, it does not virtualise).
  const labels = (await options.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(labels.filter((t) => /^Probability model\b/i.test(t)), 'no palette entry reads "Probability model"').toEqual([]);
  const entry = options.filter({ hasText: /^Model inputs/ });
  await expect(entry, 'one palette entry reads "Model inputs"').toHaveCount(1);
  await expect(entry).toContainText(/Recession/);

  await entry.click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/app\/recession(#[\w-]+)?$/);
  const heading = page.locator("main").getByRole("heading", { name: /^Model inputs$/i });
  await expect(heading).toHaveCount(1, { timeout: 15_000 });
  await expect
    .poll(
      () =>
        heading.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= -1 && r.bottom <= window.innerHeight + 1;
        }),
      { timeout: 15_000, message: 'the "Model inputs" heading is inside the viewport after the jump' },
    )
    .toBe(true);
});

/* ── CP3: the fourth regime is "Recession Risk" in every regime context ─── */

interface RegimeLabel {
  context: string;
  selector: string;
  text: string;
}

/** Self-contained (page.evaluate): the visible regime labels, by element. */
function collectRegimeLabels(): RegimeLabel[] {
  const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  type VisEl = Element & { checkVisibility?: (o?: Record<string, boolean>) => boolean };
  const visible = (el: Element): boolean => {
    const v = el as VisEl;
    if (typeof v.checkVisibility === "function" && !v.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const cssPath = (el: Element): string => {
    const parts: string[] = [];
    let n: Element | null = el;
    while (n && n !== document.body && parts.length < 4) {
      let step = n.tagName.toLowerCase();
      if (n.id) {
        parts.unshift(`${step}#${n.id}`);
        break;
      }
      const cls = Array.from(n.classList).slice(0, 2);
      if (cls.length) step += `.${cls.join(".")}`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };
  const where = (el: Element) => {
    const sec = el.closest("[id]:not(svg [id])");
    return sec ? `#${sec.id}` : "document";
  };
  const out: RegimeLabel[] = [];
  const seen = new Set<string>();
  const push = (context: string, el: Element, text: string | null | undefined) => {
    const t = clean(text);
    if (!t) return;
    const key = `${context}|${cssPath(el)}|${t}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ context: `${context} @${where(el)}`, selector: cssPath(el), text: t });
  };

  // Odds bars (ProbabilityBar): segment titles and the legend under the bar.
  document.querySelectorAll(".mrr-odds").forEach((bar) => {
    if (!visible(bar)) return;
    bar.querySelectorAll("[title]").forEach((seg) => push("odds bar segment", seg, seg.getAttribute("title")));
    const legend = bar.nextElementSibling;
    if (legend && visible(legend)) {
      legend.querySelectorAll("span").forEach((s) => {
        if (!s.children.length && visible(s)) push("odds legend", s, s.textContent);
      });
    }
  });
  // Regime data attributes.
  document.querySelectorAll("[data-regime], [data-quadrant]").forEach((el) => {
    if (!visible(el)) return;
    push("regime data attribute", el, el.getAttribute("data-regime") ?? el.getAttribute("data-quadrant"));
  });
  // Regime charts: every svg text and legend entry.
  const charts = new Set<Element>();
  document.querySelectorAll("#regime-hero [data-chart], .mrr-odds-chart, .mrr-quadrant, .mrr-ribbon-well").forEach((c) => charts.add(c));
  document.querySelectorAll("[data-chart]").forEach((c) => {
    if (c.querySelector("[data-regime], [data-quadrant]")) charts.add(c);
  });
  document.querySelectorAll("svg[role='img']").forEach((s) => {
    if (/regime/i.test(s.getAttribute("aria-label") ?? "")) charts.add(s);
  });
  charts.forEach((c) => {
    if (!visible(c)) return;
    c.querySelectorAll("text").forEach((t) => push("regime chart label", t, t.textContent));
    // Iteration 2 (F1): the odds chart names its series in an HTML legend
    // above the plot and a footnote line under it, not in SVG text. They are
    // the chart's labels wherever they live, so CP3 reads them here.
    c.querySelectorAll(".mrr-odds-key, .mrr-odds-foot-key").forEach((k) => {
      const name = k.getAttribute("data-regime");
      if (name && visible(k)) push("regime chart label", k, name);
    });
    c.querySelectorAll("[class*='legend'] span, [class*='legend'] li").forEach((s) => {
      if (!s.children.length && visible(s)) push("regime chart legend", s, s.textContent);
    });
  });
  // Regime Lab legends.
  document.querySelectorAll(".mrr-lab-legend > span").forEach((s) => {
    if (visible(s)) push("regime legend", s, s.textContent);
  });
  // Summary rows that carry a regime (not the NBER / recession-model rows).
  document.querySelectorAll(".mrr-kv-row").forEach((row) => {
    const dt = clean(row.querySelector("dt")?.textContent);
    if (!/regime|odds|next \d+ months?|classifier/i.test(dt) || /nber|recession model/i.test(dt)) return;
    const dd = row.querySelector("dd");
    if (dd && visible(dd)) push(`summary row "${dt}"`, dd, (dd as HTMLElement).innerText);
  });
  // Transition outlook: its short leaf labels ("stays X", "→ X", "4 into X").
  document.querySelectorAll("#transitions *").forEach((el) => {
    if (el.children.length || !visible(el)) return;
    const t = clean(el.textContent);
    if (t && t.length <= 48) push("transition label", el, t);
  });
  // Playbook regime picker, Evidence column headers, the Dashboard regime headline.
  document
    .querySelectorAll("#playbook [role='tab'], #playbook [role='radio'], #playbook [role='option'], #playbook option")
    .forEach((el) => {
      if (visible(el) || el.tagName.toLowerCase() === "option") push("playbook regime picker", el, (el as HTMLElement).innerText || el.textContent);
    });
  document.querySelectorAll("#backtests [role='columnheader'], #backtests th").forEach((el) => {
    if (visible(el)) push("evidence column header", el, (el as HTMLElement).innerText);
  });
  document.querySelectorAll("#regime-hero h1").forEach((el) => {
    if (visible(el)) push("regime headline", el, (el as HTMLElement).innerText);
  });
  return out;
}

/** Not a regime label: the recession model's own figures. */
const NOT_REGIME = /recession (?:model|probability|prob\b)|nber/i;

function badRegimeLabel(text: string): boolean {
  if (/\bcontraction\b/i.test(text)) return true;
  return /\brecession\b(?!\s+risk)/i.test(text) && !NOT_REGIME.test(text);
}

test.describe("CP3 Recession Risk", () => {
  for (const v of COPY_VIEWS) {
    test(`CP3 regime labels read Recession Risk on ${v.key} 1672x${HEIGHT}`, async ({ page }, testInfo) => {
      await openView(page, v, 1672);
      const labels = await page.evaluate(collectRegimeLabels);
      const bad = labels.filter((l) => badRegimeLabel(l.text));
      await writeSweepReport(testInfo, "copy-iteration", `cp3-${v.key}`, { route: v.route, labels, bad });
      note("cp3-contexts", `${v.route}: ${labels.length} regime labels read (${[...new Set(labels.map((l) => l.context.split(" @")[0]))].join(", ") || "none"})`);

      if (v.key === "dashboard") {
        const chart = labels.filter((l) => l.context.startsWith("regime chart label") && l.context.includes("#regime-hero"));
        expect.soft(chart.length, "the Dashboard hero chart's labels were read").toBeGreaterThanOrEqual(4);
        expect.soft(chart.some((l) => /^Recession Risk$/i.test(l.text)), 'the Dashboard hero chart labels the fourth band "Recession Risk"').toBe(true);
      }
      if (v.key === "regime-lab-overview") {
        const quadrant = labels.filter((l) => l.context.startsWith("regime chart label") && (l.selector.includes("mrr-quadrant") || l.context.includes("#takeaway")));
        expect.soft(labels.some((l) => l.context.startsWith("regime data attribute") && l.text === "Recession Risk"), 'the quadrant carries data-quadrant="Recession Risk"').toBe(true);
        expect.soft(quadrant.some((l) => /^Recession Risk$/i.test(l.text)), 'the quadrant labels its fourth corner "Recession Risk"').toBe(true);
        expect.soft(labels.some((l) => l.context.startsWith("odds bar segment") && l.context.includes("#regime-outlook")), "the Regime Lab odds strip (#regime-outlook) was read").toBe(true);
      }
      expect(bad.map((l) => `${v.route} ${l.context} ${l.selector}: "${l.text}"`), `${v.route}: a regime label names the fourth regime other than "Recession Risk"`).toEqual([]);
    });
  }
});
