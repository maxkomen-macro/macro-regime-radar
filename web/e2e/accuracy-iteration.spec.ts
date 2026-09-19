/**
 * Iteration 1, Step 6 (accuracy): A1 to A3 of docs/redesign-v2/ITERATION_1.md,
 * against the running Vite dev server (playwright.config.ts baseURL, API on
 * :8000 which rate-limits: run this spec on its own; servers are never
 * started here). A4 lives in web/src/lib/format.test.ts.
 *
 *   A1 STAMPS      every view (the 8 routes, the Regime Lab sub-tabs
 *                  #takeaway #playbook #scenarios #analogues #backtests and
 *                  the Tools sub-tabs #lbo #allocation) at 1672 and 390: every
 *                  visible card surface (geometry.ts CARD_SURFACES) whose own
 *                  text shows a numeric value carries a visible [data-stamp],
 *                  in the card, in an ancestor card's own content, or in the
 *                  header of a section it sits in (the non-card content that
 *                  precedes it inside a section / article / region / [id]
 *                  ancestor and carries a heading). Every visible [data-stamp]
 *                  names a source word and a date-ish or freshness word.
 *   A2 CONSISTENCY every view at 1672: [data-metric] ids (regime, the four
 *                  odds, recession-prob, lbo-all-in, ust10y, vix, hy-oas)
 *                  each appear, carry one data-metric-value across the site,
 *                  and each element's text agrees with its value (percent or
 *                  bps within display rounding; odds as whole percents).
 *   A3 AS OF THE BELL with /api/freshness series[] mocked in the §1 shape
 *                  (docs/redesign-v2/FRESHNESS_CONTRACT.md; every other served
 *                  field kept, the market stamps and session made coherent):
 *                  (a) after the close, (b) in session, (c) before the open,
 *                  (d) stale stored close (the plain line on all 8 routes),
 *                  (e) unknown and unrecognised state words, (f) a seeded
 *                  snapshot, (g) the LBO stated default, (h) E3 Recession
 *                  input freshness from series[]; plus the retired browser age
 *                  vocabulary ("Current", "N months old") in freshness text.
 *
 * Freshness text is read from FRESH_SCOPE: [data-stamp], the shell status
 * lines ([data-copy="status"], the strip freshness card .mrr-upd, the sidebar
 * freshness entry) and role=status lines. Reports land in
 * web/test-results/accuracy-*.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { METHODOLOGY_SLUG, TABS } from "../src/screens/shell/sections";
import { routeSlug, waitForScreenData, writeSweepReport } from "./lib/geometry";
import { rewriteEndpoint } from "./lib/states";

/* ── Views ───────────────────────────────────────────────────────────────── */

const ROUTES = [...TABS.map((t) => `/app/${t.slug}`), `/app/${METHODOLOGY_SLUG}`];
const LAB_ANCHORS = ["takeaway", "playbook", "scenarios", "analogues", "backtests"];
const TOOL_ANCHORS = ["lbo", "allocation"];

/** Every route, with Regime Lab and Tools expanded into their sub-tab views. */
const VIEWS: string[] = ROUTES.flatMap((r) => {
  if (r === "/app/regime-lab") return LAB_ANCHORS.map((a) => `${r}#${a}`);
  if (r === "/app/tools") return TOOL_ANCHORS.map((a) => `${r}#${a}`);
  return [r];
});

const viewSlug = (v: string) => `${routeSlug(v)}${v.includes("#") ? `-${v.split("#")[1]}` : ""}`;

const METRIC_IDS = [
  "regime",
  "odds-goldilocks",
  "odds-overheating",
  "odds-stagflation",
  "odds-recession-risk",
  "recession-prob",
  "lbo-all-in",
  "ust10y",
  "vix",
  // QUESTIONS I15: the 15-minute delayed VIX poll is its own metric, always labelled as the delayed
  // quote; "vix" is the stored VIXCLS close. Each id must still read one value everywhere.
  "vix-live",
  "hy-oas",
] as const;

const STORED_CLOSE_LINE = "The newest stored close is Sep 14; the Sep 18 close is not stored yet.";

/** A loading line in <main> ("Reading stored data…", "Building ~24 years of
 * monthly return history…"): StateNote's loading copy carries no role=status,
 * so waitForScreenData alone does not wait for it. */
function noLoadingCopy(): boolean {
  const main = document.querySelector("main");
  if (!main || !main.querySelector("h1")) return false;
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const t = (walker.currentNode.nodeValue ?? "").trim();
    if (t.length < 200 && /^(Reading|Loading|Assembling|Training|Building|Computing|Fetching)\b/.test(t) && /…$|\.\.\.$/.test(t)) return false;
  }
  return true;
}

/** Load a view and wait for its data; the allocation cold call can take a minute. */
async function openView(page: Page, view: string): Promise<void> {
  await page.goto(view, { waitUntil: "domcontentloaded" });
  const slow = view.includes("#allocation") || view.includes("#backtests");
  await waitForScreenData(page, slow ? 90_000 : 20_000, 600);
  await page.waitForFunction(noLoadingCopy, null, { timeout: slow ? 90_000 : 20_000, polling: 250 }).catch(() => {});
  // Walk the page once so anything rendered on intersection is on the page.
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight - 100);
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
}

/* ── A1 · in-page stamp audit (self-contained: runs in the browser) ─────── */

interface StampOffender {
  selector: string;
  number: string;
  text: string;
  /** Any [data-stamp] text found in the card or its ancestors (for context). */
  nearby: string[];
}

interface BadStamp {
  selector: string;
  text: string;
  why: string;
}

interface StampScan {
  cards: number;
  /** Cards inside <main> (the routed screen rendered, not only the shell). */
  mainCards: number;
  numericCards: number;
  stamps: number;
  offenders: StampOffender[];
  badStamps: BadStamp[];
}

function auditStamps(): StampScan {
  // CARD_SURFACES (e2e/lib/geometry.ts), inlined.
  const CARD_ALWAYS = ".mrr-hero, .mrr-summary, .mrr-glance-tile, .mrr-quote, .mrr-upd, [data-card]";
  const CARD_TOKEN = "[style*='var(--r-card)'], [style*='var(--r-tile)']";
  const CARD_NEVER = "[role='tablist'], button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='link']";
  const EXCLUDE =
    "[role='dialog'], [role='alertdialog'], [role='tooltip'], [role='menu'], [role='listbox'], [aria-modal='true'], [popover], #freshness-drawer";
  const SECTIONISH = "section, article, [role='region'], [data-section], [id]";
  const HEADING = "h1, h2, h3, h4, h5, h6, [role='heading'], header";
  const SOURCE =
    /\b(FRED|ICE|BofA|NYSE|Nasdaq|EODHD|yfinance|Yahoo|Treasury|BLS|BEA|Census|Fed|Federal Reserve|FOMC|CBOE|Cboe|Finnhub|NewsAPI|RSS|Reuters|Bloomberg|CNBC|MarketWatch|FT|NYT|Perplexity|Anthropic|Claude|Fama|French|Conference Board|S&P|MSCI|ISM|model|classifier|calculator|engine|optimi[sz]er|backtests?|derived|pipeline|reference|stored|relay|snapshot|calendar|consensus)\b/i;
  const DATEISH =
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+'?\d{1,4}\b|\b\d{4}-\d{2}(-\d{2})?\b|\b(Live|Delayed|Close|print|Final value|as of|Snapshot|Stated default|behind|unknown|today|yesterday|Reference)\b|\b\d{1,2}:\d{2}\b/i;
  const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
  const DATE_STRIP: RegExp[] = [
    /\b\d{4}-\d{2}(?:-\d{2})?(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g,
    new RegExp(`\\b${MONTH}\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi"),
    new RegExp(`\\b${MONTH}\\s+'?\\d{2,4}\\b`, "gi"),
    /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?(?:ET|UTC|EDT|EST|am|pm))?\b/gi,
    /\bQ[1-4]\s?'?\d{2,4}\b/g,
    /\bv\d+(?:\.\d+)+\b/gi,
    /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
    // A threshold in a legend or rule ("Clear <50%", "≥ 400 bps", "~3.5×") is a
    // stated constant, not a displayed value.
    /[<>≤≥~≈]\s?[-+−]?\$?\d[\d,]*(?:\.\d+)?\s?(?:%|bps\b|bp\b|pp\b|×|x\b)?/g,
    // …and so is a band in a legend ("50–75% Watch", "20–40% Elevated"): en dash only.
    /\b\d[\d,]*(?:\.\d+)?\s?%?\s?–\s?\d[\d,]*(?:\.\d+)?\s?(?:%|bps\b|bp\b|pp\b|×|x\b)/g,
  ];
  const NUMBER = /[-+−]?\$\s?\d[\d,]*(?:\.\d+)?[kmbKMBT]?|[-+−]?\d[\d,]*(?:\.\d+)?\s?(?:%|bps\b|bp\b|pp\b|×|x\b)|\b\d+\.\d+\b/;

  const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
  const style = (el: Element) => getComputedStyle(el);
  const px = (v: string) => Number.parseFloat(v) || 0;

  const hiddenMemo = new Map<Element, boolean>();
  const hidden = (el: Element | null): boolean => {
    if (!el || el === document.documentElement) return false;
    const memo = hiddenMemo.get(el);
    if (memo !== undefined) return memo;
    const cs = style(el);
    let h = cs.display === "none" || Number.parseFloat(cs.opacity) === 0;
    if (!h && cs.display !== "contents") {
      const r = el.getBoundingClientRect();
      const clipRect = cs.clip && cs.clip !== "auto" && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(cs.clip);
      const clipPath = cs.clipPath && /inset\(\s*50%/.test(cs.clipPath);
      if (r.width <= 1 && r.height <= 1 && (clipRect || clipPath || cs.overflow === "hidden")) h = true;
    }
    if (!h) {
      const p = el.parentElement;
      if (p && p.tagName.toLowerCase() === "details" && !(p as HTMLDetailsElement).open && el.tagName.toLowerCase() !== "summary") h = true;
    }
    if (!h) h = hidden(el.parentElement);
    hiddenMemo.set(el, h);
    return h;
  };
  const invisible = (el: Element) => hidden(el) || style(el).visibility !== "visible";

  const bordered = (el: Element) => {
    const cs = style(el);
    return (["top", "right", "bottom", "left"] as const).some((side) => {
      const s = cs.getPropertyValue(`border-${side}-style`);
      return px(cs.getPropertyValue(`border-${side}-width`)) >= 0.5 && s !== "none" && s !== "hidden";
    });
  };
  const isCard = (el: Element) => !el.matches(CARD_NEVER) && (el.matches(CARD_ALWAYS) || (el.matches(CARD_TOKEN) && bordered(el)));
  /** The nearest card at or above `el`. */
  const cardOf = (el: Element | null): Element | null => {
    let n = el;
    while (n && n !== document.body) {
      if (isCard(n)) return n;
      n = n.parentElement;
    }
    return null;
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
      const tid = n.getAttribute("data-testid");
      if (tid) step += `[data-testid="${tid}"]`;
      parts.unshift(step);
      n = n.parentElement;
    }
    return parts.join(" > ");
  };

  const stampText = (s: Element) => clean(`${s.textContent ?? ""}`);
  const validStamp = (s: Element) => {
    if (invisible(s)) return false;
    const t = stampText(s);
    return t.length > 0 && SOURCE.test(t) && DATEISH.test(t);
  };

  /* Every visible stamp on the page is well formed. */
  const allStamps = Array.from(document.querySelectorAll("[data-stamp]")).filter((s) => !invisible(s) && !s.closest(EXCLUDE));
  const badStamps: BadStamp[] = [];
  for (const s of allStamps) {
    const t = stampText(s);
    const why = !t ? "empty text" : !SOURCE.test(t) ? "no source word" : !DATEISH.test(t) ? "no date or freshness word" : null;
    if (why) badStamps.push({ selector: cssPath(s), text: t.slice(0, 100), why });
  }

  /** Stamps that belong to `card` itself (not to a card nested in it). */
  const ownStamps = (card: Element) => Array.from(card.querySelectorAll("[data-stamp]")).filter((s) => cardOf(s.parentElement) === card);

  /** The card's own visible text: nested cards and stamps excluded. */
  const ownText = (card: Element): string => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const owner = node.parentElement;
      if (!owner || !/\S/.test(node.nodeValue ?? "")) continue;
      if (owner.closest("script, style, noscript, template, title, [data-stamp]")) continue;
      if (cardOf(owner) !== card) continue;
      if (invisible(owner)) continue;
      parts.push(node.nodeValue ?? "");
    }
    return clean(parts.join(" "));
  };

  const firstNumber = (text: string): string | null => {
    let t = text;
    for (const re of DATE_STRIP) t = t.replace(re, " ");
    const m = NUMBER.exec(t);
    return m ? m[0].trim() : null;
  };

  /** A header before `card` inside one of its section-like ancestors carries a valid stamp. */
  const headerStamped = (card: Element): boolean => {
    let branch: Element = card;
    let e: Element | null = card.parentElement;
    while (e && e !== document.body && e.tagName.toLowerCase() !== "main" && e.id !== "root" && !e.querySelector("main")) {
      if (e.matches(SECTIONISH)) {
        const pre: Element[] = [];
        for (const c of Array.from(e.children)) {
          if (c === branch) break;
          if (isCard(c) || Array.from(c.querySelectorAll(`${CARD_ALWAYS}, ${CARD_TOKEN}`)).some(isCard)) continue;
          pre.push(c);
        }
        const hasHeading = pre.some((c) => c.matches(HEADING) || c.querySelector(HEADING) !== null);
        const stamped = pre.some((c) => (c.matches("[data-stamp]") && validStamp(c)) || Array.from(c.querySelectorAll("[data-stamp]")).some(validStamp));
        if (hasHeading && stamped) return true;
      }
      branch = e;
      e = e.parentElement;
    }
    return false;
  };

  const covered = (card: Element): boolean => {
    if (ownStamps(card).some(validStamp)) return true;
    let a = cardOf(card.parentElement);
    while (a) {
      if (ownStamps(a).some(validStamp)) return true;
      a = cardOf(a.parentElement);
    }
    return headerStamped(card);
  };

  const nearby = (card: Element): string[] => {
    const out = new Set<string>();
    let n: Element | null = card;
    while (n && n !== document.body && out.size < 4) {
      for (const s of Array.from(n.querySelectorAll("[data-stamp]"))) out.add(stampText(s).slice(0, 60));
      n = n.parentElement;
      if (n && n.tagName.toLowerCase() === "main") break;
    }
    return Array.from(out).slice(0, 4);
  };

  const cards = Array.from(document.body.querySelectorAll(`${CARD_ALWAYS}, ${CARD_TOKEN}`)).filter((el) => {
    if (!isCard(el) || el.closest(EXCLUDE) || invisible(el)) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 40 && r.height >= 24;
  });

  const offenders: StampOffender[] = [];
  let numericCards = 0;
  for (const card of cards) {
    const text = ownText(card);
    const num = firstNumber(text);
    if (!num) continue;
    numericCards++;
    if (covered(card)) continue;
    offenders.push({ selector: cssPath(card), number: num, text: text.slice(0, 110), nearby: nearby(card) });
  }
  return { cards: cards.length, mainCards: cards.filter((c) => c.closest("main") !== null).length, numericCards, stamps: allStamps.length, offenders, badStamps };
}

function describeStamps(view: string, width: number, scan: StampScan, max = 40): string {
  const lines = scan.offenders.slice(0, max).map((o) => `  ${view} @${width} · ${o.selector} · first number "${o.number}" · "${o.text}"${o.nearby.length ? ` · nearby stamps: ${o.nearby.join(" | ")}` : ""}`);
  const more = scan.offenders.length > max ? `\n  … and ${scan.offenders.length - max} more (see the report JSON)` : "";
  return `${scan.offenders.length} numeric card(s) without a [data-stamp] (${scan.numericCards} numeric of ${scan.cards} cards, ${scan.stamps} stamps on the page):\n${lines.join("\n")}${more}`;
}

test.describe("A1 · every numeric card carries a source and as-of stamp", () => {
  for (const width of [1672, 390]) {
    for (const view of VIEWS) {
      test(`A1 ${view} @${width}`, async ({ page }, testInfo) => {
        test.setTimeout(view.includes("#allocation") ? 180_000 : 120_000);
        await page.setViewportSize({ width, height: width === 390 ? 844 : 941 });
        await openView(page, view);
        const scan = await page.evaluate(auditStamps);
        await writeSweepReport(testInfo, "accuracy-a1", `${viewSlug(view)}-${width}`, { view, width, ...scan });
        expect(scan.mainCards, `${view} @${width}: the routed screen rendered card surfaces inside <main> (else the walk is vacuous)`).toBeGreaterThan(0);
        expect(scan.numericCards, `${view} @${width}: the screen rendered numeric cards (none found: the screen did not load, so the walk is vacuous)`).toBeGreaterThan(0);
        expect(
          scan.badStamps,
          `${view} @${width}: every [data-stamp] names a source and a date or freshness word:\n${scan.badStamps.map((b) => `  ${b.selector} · ${b.why} · "${b.text}"`).join("\n")}`,
        ).toEqual([]);
        expect(scan.offenders, describeStamps(view, width, scan)).toEqual([]);
      });
    }
  }
});

/* ── A2 · one value per metric across the site ──────────────────────────── */

interface MetricHit {
  view: string;
  metric: string;
  value: string;
  text: string;
  selector: string;
}

function collectMetrics(): Omit<MetricHit, "view">[] {
  const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
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
  return Array.from(document.querySelectorAll("[data-metric]"))
    .filter((el) => !el.closest("#freshness-drawer"))
    .map((el) => ({
      metric: el.getAttribute("data-metric") ?? "",
      value: clean(el.getAttribute("data-metric-value") ?? ""),
      text: clean([el.textContent ?? "", el.getAttribute("aria-label") ?? "", el.getAttribute("title") ?? ""].join(" ")),
      selector: cssPath(el),
    }));
}

/** Numbers in `text` (with their decimal count), minus signs of either glyph. */
function numbersIn(text: string): { n: number; dp: number; pct: boolean }[] {
  const out: { n: number; dp: number; pct: boolean }[] = [];
  const re = /([-+−]?)(\d[\d,]*)(?:\.(\d+))?\s?(%|bps\b|bp\b|pp\b)?/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const n = Number(`${m[1] === "−" ? "-" : m[1] === "+" ? "" : m[1]}${m[2].replace(/,/g, "")}${m[3] ? `.${m[3]}` : ""}`);
    if (Number.isFinite(n)) out.push({ n, dp: m[3]?.length ?? 0, pct: m[4] === "%" });
  }
  return out;
}

/** Does the element text show the served value, within its display rounding? */
function textAgrees(metric: string, value: string, text: string): string | null {
  if (metric === "regime") {
    return value && text.toLowerCase().includes(value.toLowerCase()) ? null : `text does not name the regime "${value}"`;
  }
  const v = Number(value);
  if (!Number.isFinite(v)) return `data-metric-value "${value}" is not a number`;
  const nums = numbersIn(text);
  if (!nums.length) return "text shows no number";
  const near = (c: number, x: { n: number; dp: number }) => Math.abs(x.n - c) <= 0.5 * 10 ** -x.dp + 1e-9;
  if (metric.startsWith("odds-")) {
    const c = v <= 1 ? v * 100 : v;
    // The house floor and ceiling marks: "<1%" for a sliver, ">99%" for near-certainty.
    if (c > 0 && c < 1 && /<\s?1%/.test(text)) return null;
    if (c > 99 && c < 100 && />\s?99%/.test(text)) return null;
    const pcts = nums.filter((x) => x.pct);
    if (!pcts.some((x) => near(c, x))) return `no percent in the text rounds from ${value} (expected ${Math.round(c)}%)`;
    if (!pcts.some((x) => near(c, x) && x.dp === 0)) return `odds must print as a whole percent (value ${value})`;
    return null;
  }
  const candidates =
    metric === "recession-prob"
      ? v <= 1
        ? [v * 100, v]
        : [v]
      : metric === "ust10y" || metric === "hy-oas"
        ? [v, v * 100, v / 100]
        : metric === "lbo-all-in"
          ? [v, v * 100]
          : [v];
  return nums.some((x) => candidates.some((c) => near(c, x))) ? null : `no number in the text matches ${value} (tried ${candidates.map((c) => +c.toFixed(4)).join(", ")})`;
}

const sameValue = (a: string, b: string) => {
  const x = Number(a);
  const y = Number(b);
  if (a !== "" && b !== "" && Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  return a === b;
};

test.describe("A2 · the same metric reads the same everywhere", () => {
  test("A2 cross-tab consistency @1672", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1672, height: 941 });
    const hits: MetricHit[] = [];
    for (const view of VIEWS) {
      await openView(page, view);
      for (const h of await page.evaluate(collectMetrics)) hits.push({ view, ...h });
    }
    await writeSweepReport(testInfo, "accuracy-a2", "metrics", hits);

    const problems: string[] = [];
    const unknownIds = [...new Set(hits.map((h) => h.metric))].filter((m) => !(METRIC_IDS as readonly string[]).includes(m));
    if (unknownIds.length) problems.push(`data-metric ids outside the contract: ${unknownIds.join(", ")}`);

    for (const id of METRIC_IDS) {
      const mine = hits.filter((h) => h.metric === id);
      if (!mine.length) {
        problems.push(`${id}: no [data-metric="${id}"] on any view`);
        continue;
      }
      const empty = mine.filter((h) => !h.value);
      for (const h of empty) problems.push(`${id}: empty data-metric-value at ${h.view} ${h.selector} ("${h.text.slice(0, 60)}")`);
      const distinct: string[] = [];
      for (const h of mine) if (h.value && !distinct.some((d) => sameValue(d, h.value))) distinct.push(h.value);
      if (distinct.length > 1) {
        problems.push(
          `${id}: ${distinct.length} different values across the site:\n${mine.map((h) => `    ${h.value} · ${h.view} · ${h.selector} · "${h.text.slice(0, 70)}"`).join("\n")}`,
        );
      }
      for (const h of mine) {
        if (!h.value) continue;
        const why = textAgrees(id, h.value, h.text);
        if (why) problems.push(`${id}: ${why} · ${h.view} · ${h.selector} · "${h.text.slice(0, 80)}"`);
      }
    }
    expect(problems, `A2 disagreements (${hits.length} [data-metric] elements on ${VIEWS.length} views):\n${problems.join("\n")}`).toEqual([]);
  });
});

/* ── A3 · freshness worlds (FRESHNESS_CONTRACT §1 objects) ───────────────── */

type SKind = "fred" | "market" | "live" | "derived";
type SCadence = "daily" | "monthly" | "5min" | "tick" | "60s";

interface SeriesObj {
  id: string;
  label: string;
  kind: SKind;
  cadence: SCadence;
  as_of: string | null;
  state: string;
  delay_min: number | null;
  cycles_behind: number | null;
  stale: boolean;
  discontinued: boolean;
  reason: string;
}

const REGISTRY: Record<string, { label: string; kind: SKind; cadence: SCadence }> = {
  DGS10: { label: "10-year Treasury yield", kind: "fred", cadence: "daily" },
  DGS2: { label: "2-year Treasury yield", kind: "fred", cadence: "daily" },
  VIXCLS: { label: "VIX close (CBOE)", kind: "fred", cadence: "daily" },
  BAMLH0A0HYM2: { label: "High-yield OAS", kind: "fred", cadence: "daily" },
  BAMLC0A0CM: { label: "Investment-grade OAS", kind: "fred", cadence: "daily" },
  BAMLH0A1HYBB: { label: "BB OAS", kind: "fred", cadence: "daily" },
  BAMLH0A2HYB: { label: "Single-B OAS", kind: "fred", cadence: "daily" },
  BAMLH0A3HYC: { label: "CCC OAS", kind: "fred", cadence: "daily" },
  T10YIE: { label: "10-year breakeven inflation", kind: "fred", cadence: "daily" },
  T5YIE: { label: "5-year breakeven inflation", kind: "fred", cadence: "daily" },
  DFII10: { label: "10-year real yield", kind: "fred", cadence: "daily" },
  DFII5: { label: "5-year real yield", kind: "fred", cadence: "daily" },
  SOFR: { label: "SOFR", kind: "fred", cadence: "daily" },
  INDPRO: { label: "Industrial production", kind: "fred", cadence: "monthly" },
  CPIAUCSL: { label: "CPI (all items)", kind: "fred", cadence: "monthly" },
  UNRATE: { label: "Unemployment rate", kind: "fred", cadence: "monthly" },
  FEDFUNDS: { label: "Fed funds (effective, monthly)", kind: "fred", cadence: "monthly" },
  USREC: { label: "NBER recession indicator", kind: "fred", cadence: "monthly" },
  USSLIND: { label: "Leading index", kind: "fred", cadence: "monthly" },
  market_daily: { label: "Daily closes (stored)", kind: "market", cadence: "daily" },
  market_intraday: { label: "Intraday bars (stored)", kind: "market", cadence: "5min" },
  live_quotes: { label: "Live quotes (relay)", kind: "live", cadence: "tick" },
  vix_delayed: { label: "VIX (delayed poll)", kind: "live", cadence: "60s" },
};
const FRED_DAILY = Object.keys(REGISTRY).filter((id) => REGISTRY[id].kind === "fred" && REGISTRY[id].cadence === "daily");
const MONTHLY = ["INDPRO", "CPIAUCSL", "UNRATE", "FEDFUNDS", "USREC"];

function st(id: string, state: string, as_of: string | null, extra: Partial<SeriesObj> = {}): SeriesObj {
  const r = REGISTRY[id];
  return {
    id,
    label: r.label,
    kind: r.kind,
    cadence: r.cadence,
    as_of,
    state,
    delay_min: null,
    cycles_behind: state === "close" ? 0 : null,
    stale: state === "stale",
    discontinued: false,
    reason: `${r.label}: e2e world, state ${state}.`,
    ...extra,
  };
}

interface World {
  series: SeriesObj[];
  session: Record<string, unknown>;
  generated_at: string;
  seeded?: boolean;
}

/** Replace entries by id, keeping the rest. */
function withSeries(base: SeriesObj[], ...over: SeriesObj[]): SeriesObj[] {
  const ids = new Set(over.map((s) => s.id));
  return [...base.filter((s) => !ids.has(s.id)), ...over];
}

const USSLIND_FINAL = st("USSLIND", "close", "2020-02-01", {
  discontinued: true,
  reason: "Leading index is discontinued at the source; 2020-02-01 is its final value, kept as historical data.",
});

const SESSION_BASE = { exchange: "NYSE", timezone: "America/New_York", early_close: false, calendar_known: true };

/** (a) Friday Sep 18 2026, 23:10 ET: every feed on its newest print. */
function afterClose(): World {
  return {
    generated_at: "2026-09-19T03:10:00Z",
    session: {
      ...SESSION_BASE,
      phase: "post",
      is_open: false,
      today_is_trading_day: true,
      last_completed_session: "2026-09-18",
      next_open_utc: "2026-09-21T13:30:00Z",
      local_time: "2026-09-18 23:10 EDT",
    },
    series: [
      ...FRED_DAILY.map((id) => st(id, "close", "2026-09-17", { cycles_behind: 0 })),
      ...MONTHLY.map((id) => st(id, "close", "2026-08-01", { cycles_behind: 0 })),
      USSLIND_FINAL,
      st("market_daily", "close", "2026-09-18", { cycles_behind: 0, reason: "Official close of 2026-09-18, the last completed session." }),
      st("market_intraday", "close", "2026-09-18 15:55:00", { cycles_behind: 0 }),
      st("live_quotes", "close", "2026-09-18T20:00:00Z", { cycles_behind: null, reason: "US session is closed; the last tick stands as the closing print." }),
      st("vix_delayed", "delayed", "2026-09-18T20:14:00Z", { delay_min: 15, cycles_behind: null }),
    ],
  };
}

/** (b) Monday Sep 21 2026, 11:00 ET: the relay ticks, stored bars are 7 minutes old. */
function inSession(): World {
  const w = afterClose();
  return {
    generated_at: "2026-09-21T15:00:00Z",
    session: {
      ...SESSION_BASE,
      phase: "open",
      is_open: true,
      today_is_trading_day: true,
      last_completed_session: "2026-09-18",
      next_open_utc: "2026-09-22T13:30:00Z",
      local_time: "2026-09-21 11:00 EDT",
    },
    series: withSeries(
      w.series,
      ...FRED_DAILY.map((id) => st(id, "close", "2026-09-18", { cycles_behind: 0 })),
      st("live_quotes", "live", "2026-09-21T15:00:00Z", { delay_min: 0, cycles_behind: null }),
      st("market_intraday", "delayed", "2026-09-21 10:53:00", { delay_min: 7, cycles_behind: null }),
      st("vix_delayed", "delayed", "2026-09-21T14:45:00Z", { delay_min: 15, cycles_behind: null }),
    ),
  };
}

/** (c) Friday Sep 18 2026, 08:00 ET: the prior session's close. */
function beforeOpen(): World {
  const w = afterClose();
  return {
    generated_at: "2026-09-18T12:00:00Z",
    session: {
      ...SESSION_BASE,
      phase: "pre",
      is_open: false,
      today_is_trading_day: true,
      last_completed_session: "2026-09-17",
      next_open_utc: "2026-09-18T13:30:00Z",
      local_time: "2026-09-18 08:00 EDT",
    },
    series: withSeries(
      w.series,
      ...FRED_DAILY.map((id) => st(id, "close", "2026-09-16", { cycles_behind: 0 })),
      st("market_daily", "close", "2026-09-17", { cycles_behind: 0, reason: "Official close of 2026-09-17, the last completed session." }),
      st("market_intraday", "close", "2026-09-17 15:55:00", { cycles_behind: 0 }),
      st("live_quotes", "close", "2026-09-17T20:00:00Z", { cycles_behind: null }),
    ),
  };
}

/** (d) Saturday Sep 19 2026: the newest stored close is Sep 14, four sessions behind Sep 18. */
function staleClose(): World {
  const w = afterClose();
  return {
    generated_at: "2026-09-19T12:11:00Z",
    session: {
      ...SESSION_BASE,
      phase: "weekend",
      is_open: false,
      today_is_trading_day: false,
      last_completed_session: "2026-09-18",
      next_open_utc: "2026-09-21T13:30:00Z",
      local_time: "2026-09-19 08:11 EDT",
    },
    series: withSeries(
      w.series,
      st("market_daily", "stale", "2026-09-14", { cycles_behind: 4, reason: "Stored closes end 2026-09-14; 4 session(s) behind 2026-09-18." }),
      st("market_intraday", "stale", "2026-09-14 15:55:00", { cycles_behind: 1 }),
    ),
  };
}

/** (e) An unrecognised state word and plain unknowns. */
function unknownWorld(): World {
  const w = afterClose();
  return {
    ...w,
    series: withSeries(
      w.series,
      st("market_daily", "banana", "2026-09-18", { cycles_behind: 0 }),
      st("market_intraday", "unknown", null, { cycles_behind: null }),
      st("live_quotes", "unknown", null, { cycles_behind: null, reason: "The relay is still connecting." }),
      st("vix_delayed", "unknown", null, { cycles_behind: null }),
      ...FRED_DAILY.map((id) => st(id, "unknown", null, { cycles_behind: null })),
    ),
  };
}

/** (f) A seeded snapshot: every state unknown, no verdict fields. */
function seededWorld(): World {
  const w = afterClose();
  return {
    ...w,
    seeded: true,
    generated_at: "2026-09-18T23:10:00Z",
    series: Object.keys(REGISTRY).map((id) => st(id, "unknown", null, { cycles_behind: null, reason: "Seeded snapshot: the as-of is not established." })),
  };
}

/** (h) E3: the seven recession inputs with distinct words. */
function recessionWorld(): World {
  const w = staleClose();
  return {
    ...w,
    series: withSeries(
      w.series,
      st("DGS10", "close", "2026-09-17", { cycles_behind: 0 }),
      st("DGS2", "close", "2026-09-17", { cycles_behind: 0 }),
      st("BAMLH0A0HYM2", "close", "2026-09-16", { cycles_behind: 1 }),
      st("T10YIE", "close", "2026-09-18", { cycles_behind: 0 }),
      st("T5YIE", "close", "2026-09-18", { cycles_behind: 0 }),
      st("UNRATE", "close", "2026-08-01", { cycles_behind: 0 }),
      st("INDPRO", "stale", "2026-07-01", { cycles_behind: 1, reason: "Industrial production for Aug 2026 is published but not stored yet." }),
      USSLIND_FINAL,
    ),
  };
}

const VERDICT: Record<string, string> = { close: "current", live: "current", delayed: "delayed", stale: "stale" };

/** The endpoints that carry a per-series `freshness` block (FRESHNESS_CONTRACT §6). */
const BLOCK_ENDPOINTS = ["/api/signals/latest", "/api/credit/metrics", "/api/credit/oas", "/api/recession/probability", "/api/lbo/defaults"];

/** Serve `world` from /api/freshness: series[] replaced, the session and the
 * market stamps made to agree with it, every other served field kept. With
 * `blocks` (the default) every endpoint `freshness` block entry the world
 * names is rewritten to the same object, so the world is coherent whichever
 * source a screen reads; `blocks: false` leaves the served blocks alone (the
 * source-precedence test). A block never gains an id it did not serve. */
async function mockFreshness(page: Page, world: World, opts: { blocks?: boolean } = {}): Promise<void> {
  if (opts.blocks !== false) {
    const byId = new Map(world.series.map((x) => [x.id, x]));
    for (const ep of BLOCK_ENDPOINTS) {
      await rewriteEndpoint(page, ep, (served) => {
        if (!served || typeof served !== "object" || Array.isArray(served)) return served;
        const d = served as Record<string, unknown>;
        const block = d.freshness as Record<string, unknown> | null | undefined;
        if (!block || typeof block !== "object") return d;
        const next: Record<string, unknown> = {};
        for (const [id, v] of Object.entries(block)) next[id] = byId.get(id) ?? v;
        return { ...d, freshness: next };
      });
    }
  }
  await rewriteEndpoint(page, "/api/freshness", (served) => {
    const j: Record<string, unknown> = { ...((served ?? {}) as Record<string, unknown>) };
    j.series = world.series;
    j.session = { ...((j.session as Record<string, unknown>) ?? {}), ...world.session };
    j.generated_at = world.generated_at;
    const md = world.series.find((s) => s.id === "market_daily");
    if (md?.as_of) j.market_daily_date = md.as_of.slice(0, 10);
    const mi = world.series.find((s) => s.id === "market_intraday");
    if (mi?.as_of) j.market_intraday_ts = mi.as_of;
    const byFeed = new Map(world.series.map((s) => [REGISTRY[s.id]?.kind === "fred" ? `fred:${s.id}` : s.id, s]));
    if (Array.isArray(j.sla)) {
      j.sla = (j.sla as { feed: string; verdict: string; latest?: string | null }[]).map((row) => {
        const s = byFeed.get(row.feed);
        return s ? { ...row, verdict: VERDICT[s.state] ?? "unavailable", latest: s.as_of } : row;
      });
    }
    if (world.seeded) {
      j.seeded = true;
      delete j.overall;
      delete j.sla;
    }
    return j;
  });
}

/* ── A3 · in-page freshness reader (self-contained) ─────────────────────── */

interface DotRec {
  color: string;
  healthy: boolean;
  cls: string;
}

interface FreshScan {
  /** Visible FRESH_SCOPE elements: selector and text. */
  scopes: { selector: string; text: string; inMain: boolean }[];
  /** Visible role=status / <output> texts (aria-hidden parts dropped). */
  statusLines: string[];
  /** Visible elements with the pulsing live-dot class. */
  liveDots: number;
  /** Per requested phrase: each smallest element holding it and the dots in its container. */
  near: Record<string, { selector: string; container: string; dots: DotRec[] }[]>;
  /** Visible text of <main> sections by id (for scoped checks). */
  sections: Record<string, string>;
  bodyText: string;
}

function scanFreshness(args: { phrases: string[]; sectionIds: string[] }): FreshScan {
  const FRESH_SCOPE = "[data-stamp], [data-copy='status'], .mrr-upd, .mrr-side-fresh, [data-testid='sidebar-freshness'], [role='status'], output";
  const CONTAINER = "[data-stamp], [data-copy='status'], .mrr-upd, .mrr-side-fresh, [data-testid='sidebar-freshness'], .mrr-quote, [role='status'], li, tr, button";
  const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
  const vis = (el: Element) => {
    const anyEl = el as Element & { checkVisibility?: (o?: object) => boolean };
    if (typeof anyEl.checkVisibility === "function") return anyEl.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
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
  /** Text without aria-hidden parts (icons, glyphs). */
  const spoken = (el: Element): string => {
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode as Text;
      if (n.parentElement?.closest("[aria-hidden='true']")) continue;
      parts.push(n.nodeValue ?? "");
    }
    return clean(parts.join(""));
  };

  // Healthy colours: the mint and pos tokens, resolved to rgb.
  const probe = document.createElement("span");
  document.body.appendChild(probe);
  const rgbOf = (css: string): number[] | null => {
    probe.style.color = "";
    probe.style.color = css;
    const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(probe).color);
    return m ? m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number) : null;
  };
  const healthyRgb = ["var(--mint, #26dca0)", "var(--pos, #28d17c)", "#26dca0", "#28d17c"].map(rgbOf).filter((x): x is number[] => x !== null);
  probe.remove();
  const parse = (c: string): { rgb: number[]; a: number } | null => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
  };
  const isHealthy = (c: string) => {
    const p = parse(c);
    return !!p && p.a > 0.2 && healthyRgb.some((h) => h.every((v, i) => Math.abs(v - p.rgb[i]) <= 4));
  };

  const dotsIn = (root: Element): DotRec[] => {
    const out: DotRec[] = [];
    const els = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const el of els) {
      if (!vis(el)) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const small = r.width >= 3 && r.width <= 14 && r.height >= 3 && r.height <= 14 && Math.abs(r.width - r.height) <= 2;
      const bgPainted = (parse(cs.backgroundColor)?.a ?? 0) > 0.2;
      const round = Number.parseFloat(cs.borderTopLeftRadius) >= r.width / 2 - 1 || cs.borderTopLeftRadius.includes("%");
      if (/\bdot\b|-dot\b/.test(cls) || (small && bgPainted && round && !el.textContent?.trim())) {
        const color = bgPainted ? cs.backgroundColor : cs.color;
        out.push({ color, healthy: /mrr-live-dot/.test(cls) || isHealthy(cs.backgroundColor), cls });
      }
      for (const pseudo of ["::before", "::after"]) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content === "none" || ps.content === "normal") continue;
        const w = Number.parseFloat(ps.width);
        const bg = parse(ps.backgroundColor)?.a ?? 0;
        if (w >= 3 && w <= 14 && bg > 0.2) out.push({ color: ps.backgroundColor, healthy: isHealthy(ps.backgroundColor), cls: `${cls}${pseudo}` });
      }
      // Glyph dots (●, •) coloured healthy.
      for (const n of Array.from(el.childNodes)) {
        if (n.nodeType === 3 && /^[\s●•◉⬤]+$/.test(n.nodeValue ?? "") && /[●•◉⬤]/.test(n.nodeValue ?? "")) {
          out.push({ color: cs.color, healthy: isHealthy(cs.color), cls: `${cls} (glyph)` });
        }
      }
    }
    return out;
  };

  const scopes = Array.from(document.querySelectorAll(FRESH_SCOPE))
    .filter((el) => vis(el) && !el.closest("#freshness-drawer"))
    .map((el) => ({ selector: cssPath(el), text: clean(el.textContent ?? ""), inMain: !!el.closest("main") }));

  const statusLines = Array.from(document.querySelectorAll("[role='status'], output"))
    .filter((el) => vis(el) && !el.closest("#freshness-drawer"))
    .map(spoken)
    .filter(Boolean);

  const liveDots = Array.from(document.querySelectorAll(".mrr-live-dot")).filter(vis).length;

  const near: FreshScan["near"] = {};
  for (const phrase of args.phrases) {
    const hits: FreshScan["near"][string] = [];
    const all = Array.from(document.querySelectorAll("body *")).filter((el) => !el.closest("#freshness-drawer, script, style") && clean(el.textContent ?? "").includes(phrase) && vis(el));
    const smallest = all.filter((el) => !Array.from(el.children).some((c) => clean(c.textContent ?? "").includes(phrase)));
    for (const el of smallest) {
      const container = el.closest(CONTAINER) ?? el.parentElement ?? el;
      hits.push({ selector: cssPath(el), container: cssPath(container), dots: dotsIn(container) });
    }
    near[phrase] = hits;
  }

  const sections: Record<string, string> = {};
  for (const id of args.sectionIds) {
    const el = document.getElementById(id);
    if (el) sections[id] = clean((el as HTMLElement).innerText ?? el.textContent ?? "");
  }
  return { scopes, statusLines, liveDots, near, sections, bodyText: clean(document.body.innerText ?? "") };
}

async function freshAt(page: Page, route: string, phrases: string[] = [], sectionIds: string[] = []): Promise<FreshScan> {
  await openView(page, route);
  return page.evaluate(scanFreshness, { phrases, sectionIds });
}

const scopeText = (s: FreshScan) => s.scopes.map((x) => `    ${x.selector}: "${x.text.slice(0, 90)}"`).join("\n");
const hasScope = (s: FreshScan, re: RegExp | string) => s.scopes.some((x) => (typeof re === "string" ? x.text.includes(re) : re.test(x.text)));

/** Nearest [data-stamp] texts for each element of one metric (smallest ancestor holding a stamp). */
async function metricStamps(page: Page, metric: string): Promise<{ text: string; stamps: string[] }[]> {
  return page.evaluate((m) => {
    const clean = (s: string) => s.replace(/[\s ]+/g, " ").trim();
    return Array.from(document.querySelectorAll(`[data-metric='${m}']`)).map((el) => {
      let n: Element | null = el;
      let stamps: string[] = [];
      while (n && n !== document.body) {
        const found = Array.from(n.querySelectorAll("[data-stamp]")).map((s) => clean(s.textContent ?? ""));
        if (n.matches("[data-stamp]")) found.unshift(clean(n.textContent ?? ""));
        if (found.length) {
          stamps = found;
          break;
        }
        n = n.parentElement;
      }
      return { text: clean(el.textContent ?? "").slice(0, 80), stamps };
    });
  }, metric);
}

/** Open the freshness drawer from the shell entry point, read it, close it. */
async function drawerText(page: Page): Promise<string> {
  const entry = page.locator("[data-testid='sidebar-freshness'], .mrr-fresh-link").filter({ visible: true }).first();
  if ((await entry.count()) === 0) return "(no freshness entry point)";
  await entry.click();
  const drawer = page.locator("#freshness-drawer");
  await drawer.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  const text = (await drawer.innerText().catch(() => "(drawer did not open)")).replace(/\s+/g, " ");
  await page.keyboard.press("Escape");
  return text;
}

const OLD_AGE = /\b\d+\s+(hours?|days?|weeks?|months?)\s+old\b/i;

test.describe("A3 · as of the bell (series[] mocked)", () => {
  test("A3a after the close: Close · Sep 18, FRED Sep 17, Aug 2026 print, USSLIND final value only", async ({ page }) => {
    test.setTimeout(300_000);
    await mockFreshness(page, afterClose());
    const problems: string[] = [];

    for (const route of ["/app/markets", "/app/dashboard"]) {
      const s = await freshAt(page, route);
      if (!hasScope(s, "Close · Sep 18")) problems.push(`${route}: no market freshness reads "Close · Sep 18"; freshness text:\n${scopeText(s)}`);
      if (hasScope(s, "Close · Sep 14")) problems.push(`${route}: a freshness line re-derives "Close · Sep 14" from the stored bars instead of reading series[]`);
      if (s.statusLines.some((l) => l.startsWith("The newest stored close is"))) problems.push(`${route}: the stored-close line shows while market_daily is "close"`);
      if (route === "/app/dashboard" && !hasScope(s, "Aug 2026 print")) problems.push(`${route}: no monthly stamp reads "Aug 2026 print" (CPIAUCSL close); freshness text:\n${scopeText(s)}`);
    }

    // DGS10 close as_of Sep 17, cycles 0: the 10Y's stamp reads "Sep 17" with nothing behind.
    const tenY: string[] = [];
    let tenYOk = false;
    for (const route of ["/app/dashboard", "/app/credit", "/app/recession"]) {
      await openView(page, route);
      for (const m of await metricStamps(page, "ust10y")) {
        tenY.push(`${route} "${m.text}" → [${m.stamps.join(" | ")}]`);
        if (m.stamps.some((t) => /\bSep 17\b/.test(t) && !/\bbehind\b/.test(t))) tenYOk = true;
        if (m.stamps.some((t) => /\bbehind\b/.test(t) && /\bSep 17\b/.test(t))) problems.push(`${route}: the 10Y stamp says "behind" at cycles_behind 0: ${m.stamps.join(" | ")}`);
      }
    }
    if (!tenYOk) problems.push(`no [data-metric="ust10y"] stamp reads "Sep 17" (DGS10 close, cycles 0); found:\n    ${tenY.join("\n    ") || "(no ust10y elements on dashboard, credit, recession)"}`);

    // USSLIND: never a model input; where a freshness line names it, it reads "Final value · Feb 2020".
    for (const route of ["/app/recession", "/app/methodology"]) {
      const s = await freshAt(page, route, [], ["model", "sensitivity"]);
      for (const id of ["model", "sensitivity"]) {
        const t = s.sections[id] ?? "";
        if (/USSLIND|Feb 2020/.test(t)) problems.push(`${route}: #${id} shows USSLIND (or its Feb 2020 stamp) as a model input`);
      }
      for (const x of s.scopes) {
        if (/USSLIND|Leading index(?! proxy)/i.test(x.text) && !x.text.includes("Final value · Feb 2020")) problems.push(`${route}: ${x.selector} names USSLIND without "Final value · Feb 2020": "${x.text.slice(0, 90)}"`);
        if (/Feb 2020/.test(x.text) && /behind|stale/i.test(x.text)) problems.push(`${route}: USSLIND is marked stale: "${x.text.slice(0, 90)}"`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3a′ FRED daily close two business days behind: Sep 17 · 2 days behind", async ({ page }) => {
    test.setTimeout(240_000);
    const w = afterClose();
    w.series = withSeries(w.series, st("DGS10", "close", "2026-09-17", { cycles_behind: 2 }));
    await mockFreshness(page, w);
    const found: string[] = [];
    let ok = false;
    for (const route of ["/app/dashboard", "/app/credit", "/app/recession"]) {
      await openView(page, route);
      for (const m of await metricStamps(page, "ust10y")) {
        found.push(`${route} "${m.text}" → [${m.stamps.join(" | ")}]`);
        if (m.stamps.some((t) => /\bSep 17\b/.test(t) && /2 days behind/.test(t))) ok = true;
      }
    }
    expect(ok, `no [data-metric="ust10y"] stamp reads "Sep 17 · 2 days behind"; found:\n    ${found.join("\n    ") || "(no ust10y elements)"}`).toBe(true);
  });

  test("A3 source: series[] is the one source, an endpoint block that disagrees does not win (10Y)", async ({ page }) => {
    test.setTimeout(240_000);
    // Only /api/freshness changes; /api/signals/latest and /api/credit/oas keep
    // their served DGS10 block (state "unknown" on a DB without watermarks).
    await mockFreshness(page, afterClose(), { blocks: false });
    const found: string[] = [];
    let ok = false;
    for (const route of ["/app/dashboard", "/app/credit", "/app/recession"]) {
      await openView(page, route);
      for (const m of await metricStamps(page, "ust10y")) {
        found.push(`${route} "${m.text}" → [${m.stamps.join(" | ")}]`);
        if (m.stamps.some((t) => /\bSep 17\b/.test(t))) ok = true;
      }
    }
    expect(ok, `series[] says DGS10 close Sep 17 but no [data-metric="ust10y"] stamp reads "Sep 17" (an endpoint block outranked series[]); found:\n    ${found.join("\n    ") || "(no ust10y elements)"}`).toBe(true);
  });

  test("A3b during the session: Live and Delayed 7 min", async ({ page }) => {
    test.setTimeout(240_000);
    await mockFreshness(page, inSession());
    const problems: string[] = [];
    for (const route of ["/app/markets", "/app/dashboard"]) {
      const s = await freshAt(page, route);
      if (!hasScope(s, /\bLive\b/)) problems.push(`${route}: no freshness line reads "Live" (live_quotes live); freshness text:\n${scopeText(s)}`);
      if (route === "/app/markets" && !hasScope(s, "Delayed 7 min")) {
        // The intraday bars' word may live in the per-source drawer rather than on a card.
        const drawer = await drawerText(page);
        if (!drawer.includes("Delayed 7 min")) problems.push(`${route}: neither a freshness line nor the freshness drawer reads "Delayed 7 min" (market_intraday delayed 7); freshness text:\n${scopeText(s)}\n    drawer: "${drawer.slice(0, 400)}"`);
      }
      if (s.statusLines.some((l) => l.startsWith("The newest stored close is"))) problems.push(`${route}: the stored-close line shows in session with the Sep 18 close stored`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3c before the open: the prior session's Close · Sep 17", async ({ page }) => {
    test.setTimeout(240_000);
    await mockFreshness(page, beforeOpen());
    const problems: string[] = [];
    for (const route of ["/app/markets", "/app/dashboard"]) {
      const s = await freshAt(page, route);
      if (!hasScope(s, "Close · Sep 17")) problems.push(`${route}: no market freshness reads "Close · Sep 17"; freshness text:\n${scopeText(s)}`);
      if (hasScope(s, "Close · Sep 18")) problems.push(`${route}: a freshness line claims the Sep 18 close before it exists`);
      if (s.statusLines.some((l) => l.startsWith("The newest stored close is"))) problems.push(`${route}: the stored-close line shows before the open`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3d stale stored close: one plain status line on all 8 routes, and Sep 14 · 4 sessions behind", async ({ page }) => {
    test.setTimeout(480_000);
    await mockFreshness(page, staleClose());
    const problems: string[] = [];
    for (const route of ROUTES) {
      const s = await freshAt(page, route);
      const exact = s.statusLines.filter((l) => l === STORED_CLOSE_LINE).length;
      if (exact !== 1) {
        const similar = s.statusLines.filter((l) => /stored close/i.test(l));
        problems.push(`${route}: ${exact} role=status line(s) reading exactly "${STORED_CLOSE_LINE}" (want 1)${similar.length ? `; similar: ${similar.map((l) => `"${l}"`).join(", ")}` : ""}`);
      }
      if ((route === "/app/markets" || route === "/app/dashboard") && !hasScope(s, "Sep 14 · 4 sessions behind")) {
        problems.push(`${route}: market freshness does not read "Sep 14 · 4 sessions behind"; freshness text:\n${scopeText(s)}`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3e unknown and unrecognised state words: As of unknown, never a healthy dot", async ({ page }) => {
    test.setTimeout(240_000);
    await mockFreshness(page, unknownWorld());
    const problems: string[] = [];
    for (const route of ["/app/markets", "/app/dashboard"]) {
      const s = await freshAt(page, route, ["As of unknown"]);
      if (!hasScope(s, "As of unknown")) problems.push(`${route}: no freshness line reads "As of unknown" (market_daily state "banana", live_quotes "unknown"); freshness text:\n${scopeText(s)}`);
      if (hasScope(s, "Close · Sep 18")) problems.push(`${route}: the unrecognised state word "banana" rendered as a close`);
      if (s.liveDots) problems.push(`${route}: ${s.liveDots} pulsing live dot(s) while every live feed is unknown`);
      for (const h of s.near["As of unknown"] ?? []) {
        const bad = h.dots.filter((d) => d.healthy);
        if (bad.length) problems.push(`${route}: healthy dot beside "As of unknown" at ${h.selector} (container ${h.container}): ${bad.map((d) => `${d.cls} ${d.color}`).join(", ")}`);
      }
      if (s.statusLines.some((l) => l.startsWith("The newest stored close is"))) problems.push(`${route}: the stored-close line shows for an unknown state`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3f seeded snapshot: Snapshot · as of, and no health dot", async ({ page }) => {
    test.setTimeout(240_000);
    await mockFreshness(page, seededWorld());
    const problems: string[] = [];
    for (const route of ["/app/dashboard", "/app/markets"]) {
      const s = await freshAt(page, route, ["Snapshot · as of"]);
      if (!/Snapshot · as of (?!unknown)\S/.test(s.bodyText)) problems.push(`${route}: no "Snapshot · as of <date>" on the page; freshness text:\n${scopeText(s)}`);
      if (s.liveDots) problems.push(`${route}: ${s.liveDots} pulsing live dot(s) on a seeded snapshot`);
      for (const h of s.near["Snapshot · as of"] ?? []) {
        if (h.dots.length) problems.push(`${route}: a health dot beside "Snapshot · as of" at ${h.selector} (container ${h.container}): ${h.dots.map((d) => `${d.cls} ${d.color}`).join(", ")}`);
      }
      // No shell freshness surface glows healthy on a snapshot.
      const healthy = await page.evaluate(() => {
        const probe = document.createElement("span");
        document.body.appendChild(probe);
        const rgb = (css: string) => {
          probe.style.color = css;
          return getComputedStyle(probe).color;
        };
        const mint = [rgb("var(--mint, #26dca0)"), rgb("var(--pos, #28d17c)")];
        probe.remove();
        const out: string[] = [];
        for (const root of Array.from(document.querySelectorAll(".mrr-upd, .mrr-side-fresh, [data-testid='sidebar-freshness'], [data-copy='status']"))) {
          for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.width <= 14 && r.height <= 14 && mint.includes(cs.backgroundColor)) out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className)}`);
          }
        }
        return out;
      });
      if (healthy.length) problems.push(`${route}: mint or green dot(s) in the shell freshness on a seeded snapshot: ${healthy.join(", ")}`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3g LBO stated default: Stated default on Tools and Credit, never live", async ({ page }) => {
    test.setTimeout(240_000);
    await rewriteEndpoint(page, "/api/lbo/defaults", (served) => {
      const d = { ...((served ?? {}) as Record<string, unknown>) };
      const fresh = { ...((d.freshness as Record<string, unknown>) ?? {}) };
      fresh.lbo_all_in_rate = {
        id: "lbo_all_in_rate",
        label: "LBO all-in rate",
        kind: "derived",
        cadence: "daily",
        as_of: null,
        state: "fallback",
        delay_min: null,
        cycles_behind: null,
        stale: false,
        discontinued: false,
        reason: "The stated default rate (Fed funds 5.33% + HY spread 3.27%); the stored rates are unavailable.",
      };
      return {
        ...d,
        fedfunds: 5.33,
        hy_oas_pct: 3.27,
        lbo_all_in_rate: 8.6,
        data_as_of: "unavailable",
        status: "fallback",
        is_fallback: true,
        fedfunds_as_of: null,
        hy_oas_as_of: null,
        freshness: fresh,
      };
    });
    const problems: string[] = [];
    for (const route of ["/app/tools#lbo", "/app/credit"]) {
      await openView(page, route);
      const mainText = await page.locator("main").innerText();
      if (!mainText.includes("Stated default")) problems.push(`${route}: "Stated default" is not shown for the fallback LBO all-in rate`);
      const marks = await metricStamps(page, "lbo-all-in");
      if (route.startsWith("/app/tools") && !marks.length) problems.push(`${route}: no [data-metric="lbo-all-in"] element`);
      for (const m of marks) {
        if (m.stamps.some((t) => /\blive\b|tracking/i.test(t))) problems.push(`${route}: the fallback all-in rate's stamp says live or tracking: ${m.stamps.join(" | ")}`);
      }
      const unmarked = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of Array.from(document.querySelectorAll("[data-metric='lbo-all-in']"))) {
          let n: Element | null = el;
          let ok = false;
          for (let i = 0; n && i < 8; i++, n = n.parentElement) {
            if ((n.textContent ?? "").includes("Stated default")) {
              ok = true;
              break;
            }
          }
          if (!ok) out.push((el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60));
        }
        return out;
      });
      for (const t of unmarked) problems.push(`${route}: an LBO all-in figure ("${t}") has no "Stated default" badge within its card`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  test("A3h E3: Recession inputs read series[] (UNRATE, INDPRO, T10YIE, DGS10, DGS2, HY), never USSLIND", async ({ page }) => {
    test.setTimeout(240_000);
    await mockFreshness(page, recessionWorld());
    const s = await freshAt(page, "/app/recession", [], ["model", "sensitivity"]);
    const inputs = `${s.sections.model ?? ""} ${s.sections.sensitivity ?? ""}`;
    const problems: string[] = [];
    if (!s.sections.model) problems.push("/app/recession: no section#model (Model inputs) on the page");
    const want: [string, RegExp][] = [
      ["UNRATE close · monthly", /Aug 2026 print/],
      ["INDPRO stale · 1 release", /Jul 2026 · 1 release behind/],
      ["T10YIE / T5YIE close", /\bSep 18\b/],
      ["DGS10 / DGS2 close", /\bSep 17\b/],
      ["BAMLH0A0HYM2 close · 1 day behind", /\bSep 16\b[^A-Za-z]*1 day behind/],
    ];
    for (const [what, re] of want) if (!re.test(inputs)) problems.push(`#model: missing ${re} (${what})`);
    if (/USSLIND|Feb 2020/.test(inputs)) problems.push("#model / #sensitivity: USSLIND (or its Feb 2020 final value) appears as a model input");
    if (/As of unknown/.test(s.sections.model ?? "")) problems.push("#model: an input still reads \"As of unknown\" although series[] carries its state (the endpoint block was read instead of series[])");
    expect(problems, `${problems.join("\n")}\n  #model text: "${(s.sections.model ?? "").slice(0, 600)}"`).toEqual([]);
  });

  test("A3 vocabulary: no retired age words in freshness text on any route", async ({ page }) => {
    test.setTimeout(480_000);
    await mockFreshness(page, afterClose());
    const problems: string[] = [];
    for (const route of ROUTES) {
      const s = await freshAt(page, route);
      for (const x of s.scopes) {
        if (/\bcurrent\b/i.test(x.text)) problems.push(`${route}: ${x.selector} uses the retired word "current": "${x.text.slice(0, 90)}"`);
        if (OLD_AGE.test(x.text)) problems.push(`${route}: ${x.selector} uses a browser age ("${OLD_AGE.exec(x.text)?.[0]}"): "${x.text.slice(0, 90)}"`);
      }
      const age = OLD_AGE.exec(s.bodyText);
      if (age) {
        const at = s.bodyText.indexOf(age[0]);
        problems.push(`${route}: browser age on screen "${s.bodyText.slice(Math.max(0, at - 50), at + age[0].length + 10)}"`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});
