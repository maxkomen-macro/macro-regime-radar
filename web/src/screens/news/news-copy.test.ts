/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.1,
 * `screens/news/news-copy.test.ts`: the pure copy helpers behind the hero
 * (B.1), the summary rows and the status strip (B.2) and the calendar day
 * groups (B.5). No React and no fetch: every helper takes its inputs, the
 * clock is a fixed epoch `now`, and the ET arithmetic goes through Intl with
 * America/New_York, so nothing depends on when or where the suite runs.
 * Fixtures are dated Sep 2026 and never reuse the mockup's figures; the
 * assertions are the C.1 strings and the B.2 strip matrix.
 */
import { describe, expect, it } from "vitest";
import type { CalendarEvent, NewsItem } from "../../api/types";
import type { FreshInfo } from "../shared/freshness";
import {
  aiReadValue,
  categoryMixValue,
  clockEt,
  countdownHeadline,
  coverageValue,
  dayGroups,
  feedHealth,
  filledDots,
  heroPill,
  heroSubhead,
  highImpactValue,
  leadSentence,
  nextFocusEvent,
  outletsValue,
  sourceCount,
  topSignificanceValue,
  whySentence,
} from "./news-copy";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Wednesday Sep 16 2026, 13:00 ET (17:00Z). */
const NOW = Date.parse("2026-09-16T17:00:00Z");

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null, source: string | null = "manual_csv"): CalendarEvent => ({
  id,
  event_name,
  event_datetime,
  importance,
  source,
});

const item = (over: Partial<NewsItem> = {}): NewsItem => ({
  id: 1,
  headline: "Fed holds rates, signals one more cut",
  summary: null,
  url: "https://example.com/fed",
  source: "CNBC",
  category: "MACRO",
  published_at: "2026-09-16T16:40:00Z",
  fetched_at: null,
  market_impact: 4,
  deal_size: null,
  sector_relevance: 3,
  time_sensitivity: 4,
  regime_relevance: 5,
  overall_significance: 4.4,
  regime_interpretation: null,
  perplexity_research: null,
  ticker: null,
  ...over,
});

const fresh = (over: Partial<FreshInfo> = {}): FreshInfo => ({
  state: "current",
  word: "Current",
  stamp: "Sep 16, 16:40 ET",
  ageDays: 0,
  age: "under 1 hour",
  cadence: "hourly",
  ...over,
});

/** 12:30Z is 08:30 ET in September (EDT); 18:00Z is 14:00 ET. */
const RETAIL = ev(1, "Retail sales (Aug)", "2026-09-17T12:30:00Z", "medium"); // Thu, tomorrow
const CPI = ev(2, "CPI (Aug)", "2026-09-18T12:30:00Z", "high"); // Fri, in 2 days
const FOMC = ev(3, "FOMC decision", "2026-09-23T18:00:00Z", "high"); // Wed, in 7 days
const CLAIMS = ev(4, "Jobless claims", "2026-09-24T12:30:00Z", "low"); // Thu, in 8 days

/* ── hero (B.1) ──────────────────────────────────────────────────────────── */

describe("news-copy: hero helpers (checklist 08 B.1)", () => {
  it("nextFocusEvent picks the first high-impact row, skipping medium and low rows before it", () => {
    expect(nextFocusEvent([RETAIL, CLAIMS, CPI, FOMC])).toBe(CPI);
    expect(nextFocusEvent([CLAIMS, RETAIL, FOMC, CPI])).toBe(FOMC);
  });

  it("nextFocusEvent falls back to the first row when no row is high impact, and is null on an empty or missing window", () => {
    expect(nextFocusEvent([RETAIL, CLAIMS])).toBe(RETAIL);
    expect(nextFocusEvent([ev(9, "Consumer sentiment (prelim)", "2026-09-25T14:00:00Z", null)])?.event_name).toBe("Consumer sentiment (prelim)");
    expect(nextFocusEvent([])).toBeNull();
    expect(nextFocusEvent(undefined)).toBeNull();
  });

  it("countdownHeadline words the ET calendar-day delta: today / tomorrow / in {n} days", () => {
    expect(countdownHeadline(ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"), NOW)).toBe("CPI (Aug) today");
    expect(countdownHeadline(RETAIL, NOW)).toBe("Retail sales (Aug) tomorrow");
    expect(countdownHeadline(CPI, NOW)).toBe("CPI (Aug) in 2 days");
    expect(countdownHeadline(FOMC, NOW)).toBe("FOMC decision in 7 days");
  });

  it("countdownHeadline counts ET days across an ET midnight: 23:30 ET tonight is today, 00:30 ET is tomorrow", () => {
    // Sep 17 03:30Z is Sep 16 23:30 EDT; Sep 17 04:30Z is Sep 17 00:30 EDT.
    expect(countdownHeadline(ev(1, "Fed speech", "2026-09-17T03:30:00Z", "low"), NOW)).toBe("Fed speech today");
    expect(countdownHeadline(ev(2, "Fed speech", "2026-09-17T04:30:00Z", "low"), NOW)).toBe("Fed speech tomorrow");
  });

  it("countdownHeadline is DST-safe across the November boundary (EDT to EST on Nov 1 2026)", () => {
    // Fri Oct 30 12:00 EDT to Tue Nov 3 08:30 EST: four ET calendar days.
    const fridayNoon = Date.parse("2026-10-30T16:00:00Z");
    expect(countdownHeadline(ev(1, "ISM services (Oct)", "2026-11-03T13:30:00Z", "medium"), fridayNoon)).toBe("ISM services (Oct) in 4 days");
    // Sat Oct 31 23:30 EDT (Nov 1 03:30Z) to Sun Nov 1 01:30 ET (05:30Z): tomorrow, not today.
    const saturdayNight = Date.parse("2026-11-01T03:30:00Z");
    expect(countdownHeadline(ev(2, "Fed speech", "2026-11-01T05:30:00Z", "low"), saturdayNight)).toBe("Fed speech tomorrow");
  });

  it("heroPill: High impact is amber with the amber glow; medium, low and unrated are gray with the gray glow", () => {
    expect(heroPill(CPI)).toEqual({ text: "High impact", tone: "amber", glow: "rgba(245,181,46,.05)" });
    expect(heroPill(RETAIL)).toEqual({ text: "Medium impact", tone: "gray", glow: "rgba(200,210,220,.05)" });
    expect(heroPill(CLAIMS)).toEqual({ text: "Low impact", tone: "gray", glow: "rgba(200,210,220,.05)" });
    expect(heroPill(ev(9, "Consumer sentiment (prelim)", "2026-09-25T14:00:00Z", null))).toEqual({ text: "Impact not rated", tone: "gray", glow: "rgba(200,210,220,.05)" });
    // Served importance is lowercase (src/migrate.py); a capitalised value still resolves.
    expect(heroPill(ev(10, "GDP (Q2, third estimate)", "2026-09-25T12:30:00Z", "High")).text).toBe("High impact");
  });

  it("heroPill with no focus event (the stored-schedule and unavailable hero states) is gray and casts the gray glow", () => {
    const pill = heroPill(null);
    expect(pill.tone).toBe("gray");
    expect(pill.glow).toBe("rgba(200,210,220,.05)");
  });

  it("heroSubhead names the first two events with their ET weekday and wall time", () => {
    expect(heroSubhead([RETAIL, CPI], NOW)).toBe("Retail sales (Aug) on Thu Sep 17, 08:30 ET, then CPI (Aug) on Fri Sep 18, 08:30 ET.");
    // Only the first two rows are named.
    expect(heroSubhead([RETAIL, CPI, FOMC, CLAIMS], NOW)).toBe("Retail sales (Aug) on Thu Sep 17, 08:30 ET, then CPI (Aug) on Fri Sep 18, 08:30 ET.");
  });

  it("heroSubhead uses the same-day form when both events fall on one ET day", () => {
    const a = ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high");
    const b = ev(2, "Retail sales (Aug)", "2026-09-16T14:00:00Z", "medium");
    expect(heroSubhead([a, b], NOW)).toBe("CPI (Aug) on Wed Sep 16, 08:30 ET, then Retail sales (Aug) the same day at 10:00 ET.");
  });

  it("heroSubhead with one event says nothing else is scheduled in the next 30 days", () => {
    expect(heroSubhead([CPI], NOW)).toBe("CPI (Aug) on Fri Sep 18, 08:30 ET; nothing else is scheduled in the next 30 days.");
  });

  it("leadSentence is the N2 sentence verbatim for the windowed branch, with the category word and the decoded headline", () => {
    expect(leadSentence(item(), false)).toBe("Macro / Fed leads the file: Fed holds rates, signals one more cut at 4.4 / 5, the window's highest score.");
    expect(leadSentence(item({ category: "M&A", headline: "Oracle to buy Snowflake for $48B", overall_significance: 3.9 }), false)).toBe(
      "M&A leads the file: Oracle to buy Snowflake for $48B at 3.9 / 5, the window's highest score.",
    );
    expect(leadSentence(item({ category: null, headline: "Fed&apos;s Powell holds &amp; waits", overall_significance: 3 }), false)).toBe(
      "One story leads the file: Fed's Powell holds & waits at 3.0 / 5, the window's highest score.",
    );
    // An unmapped category prints as served.
    expect(leadSentence(item({ category: "CRYPTO", overall_significance: 2.5 }), false)).toMatch(/^CRYPTO leads the file: /);
  });

  it("leadSentence on the fallback names the stored file and the stored window", () => {
    expect(leadSentence(item(), true)).toBe("Macro / Fed leads the stored file: Fed holds rates, signals one more cut at 4.4 / 5, the stored window's highest score.");
  });

  it("whySentence is the tidied, decoded interpretation when one is stored", () => {
    expect(whySentence(item({ regime_interpretation: "Holds the Goldilocks read — watch inflation pressure &amp; the dots." }), false)).toBe(
      "Holds the Goldilocks read; watch inflation pressure & the dots.",
    );
    // The fallback flag never changes a stored interpretation.
    expect(whySentence(item({ regime_interpretation: "Holds the Goldilocks read." }), true)).toBe("Holds the Goldilocks read.");
  });

  it("whySentence without an interpretation is the N3 score-only sentence, with the fallback clause on the stored branch", () => {
    expect(whySentence(item(), false)).toBe(
      "The highest-scored story on file (significance 4.4 / 5). No model interpretation was stored for it, so the score is the only editorial claim made here.",
    );
    expect(whySentence(item(), true)).toBe(
      "The highest-scored story on file (significance 4.4 / 5); it is stored fallback coverage, not today's tape. No model interpretation was stored for it, so the score is the only editorial claim made here.",
    );
    // Whitespace-only interpretations count as absent (today's `?.trim()` rule).
    expect(whySentence(item({ regime_interpretation: "   " }), false)).toMatch(/^The highest-scored story on file/);
    // A null score prints 0.0, never NaN.
    expect(whySentence(item({ overall_significance: null }), false)).toMatch(/^The highest-scored story on file \(significance 0\.0 \/ 5\)\./);
  });
});

/* ── summary rows and strip (B.2) ────────────────────────────────────────── */

describe("news-copy: summary and strip helpers (checklist 08 B.2)", () => {
  const FEED = [item({ id: 1, source: "CNBC" }), item({ id: 2, source: "MarketWatch", overall_significance: 3.5 }), item({ id: 3, source: "CNBC", overall_significance: 3.49 }), item({ id: 4, source: null, overall_significance: null })];

  it("coverageValue counts the stories in the window, and on the fallback prints the N4 stale string verbatim", () => {
    expect(coverageValue(FEED, "7D", false, null, null)).toBe("4 stories in 7D");
    expect(coverageValue([], "24H", false, null, null)).toBe("0 stories in 24H");
    expect(coverageValue(FEED, "24H", true, "2026-09-14T13:00:00Z", "2 days")).toBe("Stale: no headlines in 24H; newest stored Sep 14, 2026 (2 days old)");
  });

  it("highImpactValue counts scores at or above 3.5 only", () => {
    expect(highImpactValue(FEED)).toBe("2 headlines scored 3.5 or higher");
    expect(highImpactValue([])).toBe("0 headlines scored 3.5 or higher");
  });

  it("topSignificanceValue prints the score to one decimal with the category word, uncategorised when null, and nothing without a score", () => {
    expect(topSignificanceValue(3.8, "MACRO")).toBe("3.8 / 5 · Macro / Fed");
    expect(topSignificanceValue(4, "M&A")).toBe("4.0 / 5 · M&A");
    expect(topSignificanceValue(3.6, "GEOPOLITICAL")).toBe("3.6 / 5 · Geopolitical");
    expect(topSignificanceValue(2.6, null)).toBe("2.6 / 5 · uncategorised");
    expect(topSignificanceValue(2.6, "CRYPTO")).toBe("2.6 / 5 · CRYPTO");
    expect(topSignificanceValue(null, "MACRO")).toBeNull();
  });

  it("filledDots rounds half down and clamps to the five dots: 0, 2.5 → 2, 2.6 → 3, 3.4 → 3, 4.4 → 4, 5 → 5", () => {
    // `+ 0` folds a -0 from Math.ceil into +0 so the comparison is on value only.
    expect([0, 2.5, 2.6, 3.4, 4.4, 5].map((x) => filledDots(x) + 0)).toEqual([0, 2, 3, 3, 4, 5]);
    expect(filledDots(1) + 0).toBe(1);
    expect(filledDots(7) + 0).toBe(5);
    expect(filledDots(null) + 0).toBe(0);
    expect(filledDots(undefined) + 0).toBe(0);
  });

  it("clockEt is the ET wall-clock time of a UTC stamp, with or without the Z", () => {
    expect(clockEt("2026-09-14T19:41:00Z")).toBe("15:41 ET");
    expect(clockEt("2026-09-14T19:41:00")).toBe("15:41 ET");
    expect(clockEt("2026-09-14 19:41:00")).toBe("15:41 ET");
    // Midnight UTC is the previous ET evening.
    expect(clockEt("2026-09-15T00:10:00Z")).toBe("20:10 ET");
  });

  it("sourceCount counts distinct non-null sources", () => {
    expect(sourceCount(FEED)).toBe(2);
    expect(sourceCount([item({ source: null })])).toBe(0);
    expect(sourceCount([])).toBe(0);
  });

  it("feedHealth: the fallback wins whatever the feed clock says (amber, Fallback coverage, the stored date, age and count)", () => {
    const stale = fresh({ state: "stale", word: "Stale", stamp: "Sep 14, 13:00 ET", ageDays: 2, age: "2 days" });
    expect(feedHealth({ usingFallback: true, loading: false, feedInfo: stale, feed: FEED, newestFallback: "2026-09-14T13:00:00Z" })).toEqual({
      tone: "amber",
      title: "Fallback coverage",
      detail: "4 stories · newest Sep 14, 2026",
    });
    expect(feedHealth({ usingFallback: true, loading: false, feedInfo: fresh({ age: "2 days" }), feed: FEED, newestFallback: "2026-09-14T13:00:00Z" }).title).toBe("Fallback coverage");
  });

  it("feedHealth: a current feed is mint with the newest stamp and the source count", () => {
    expect(feedHealth({ usingFallback: false, loading: false, feedInfo: fresh(), feed: FEED, newestFallback: null })).toEqual({
      tone: "mint",
      title: "Feed current",
      detail: "Newest headline Sep 16, 16:40 ET",
    });
  });

  it("feedHealth: delayed and stale read amber with the age; the state word is whatever the merged feed clock says (server verdict first, client clock otherwise)", () => {
    const delayed = fresh({ state: "delayed", word: "Delayed", age: "3 hours" });
    expect(feedHealth({ usingFallback: false, loading: false, feedInfo: delayed, feed: FEED, newestFallback: null })).toEqual({
      tone: "amber",
      title: "Feed delayed",
      detail: "Newest Sep 16, 16:40 ET · 3 hours old",
    });
    const stale = fresh({ state: "stale", word: "Stale", stamp: "Sep 12, 09:05 ET", ageDays: 4, age: "4 days" });
    expect(feedHealth({ usingFallback: false, loading: false, feedInfo: stale, feed: FEED, newestFallback: null })).toEqual({
      tone: "amber",
      title: "Feed stale",
      detail: "Newest Sep 12, 09:05 ET · 4 days old",
    });
  });

  it("feedHealth: no stamp reads gray Feed unavailable", () => {
    const none = fresh({ state: "unavailable", word: "Unavailable", stamp: "", ageDays: 0, age: "" });
    expect(feedHealth({ usingFallback: false, loading: false, feedInfo: none, feed: [], newestFallback: null })).toEqual({
      tone: "gray",
      title: "Feed unavailable",
      detail: "No headline stamp on file",
    });
  });

  it("feedHealth: loading before the first payload reads gray Reading feed health…", () => {
    const none = fresh({ state: "unavailable", word: "Unavailable", stamp: "", ageDays: 0, age: "" });
    expect(feedHealth({ usingFallback: false, loading: true, feedInfo: none, feed: [], newestFallback: null })).toEqual({
      tone: "gray",
      title: "Reading feed health…",
      detail: "Opens the data freshness breakdown",
    });
  });
});

/* ── calendar day groups (B.5) ───────────────────────────────────────────── */

describe("news-copy: dayGroups (checklist 08 B.5)", () => {
  const A = ev(1, "CPI (Aug)", "2026-09-16T12:30:00Z", "high"); // today 08:30 ET
  const B = ev(2, "Fed speech", "2026-09-17T03:30:00Z", "low"); // 23:30 ET today: the 03:30Z stamp lands on the previous ET day
  const C = ev(3, "Retail sales (Aug)", "2026-09-17T12:30:00Z", "medium"); // +1d
  const D = ev(4, "FOMC decision", "2026-09-23T18:00:00Z", "high"); // +7d
  const E = ev(5, "Jobless claims", "2026-09-24T12:30:00Z", "low"); // +8d: no marker

  it("keys and labels by ET calendar day, keeping the served order inside a group", () => {
    const groups = dayGroups([A, B, C, D, E], NOW, false);
    expect(groups.map((g) => g.key)).toEqual(["2026-09-16", "2026-09-17", "2026-09-23", "2026-09-24"]);
    expect(groups.map((g) => g.label)).toEqual(["Wed Sep 16", "Thu Sep 17", "Wed Sep 23", "Thu Sep 24"]);
    expect(groups[0].rows.map((r) => r.id)).toEqual([1, 2]);
    expect(groups[1].rows.map((r) => r.id)).toEqual([3]);
    expect(groups.flatMap((g) => g.rows).map((r) => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it("markers: TODAY in the alert red, +1d and +7d in amber, nothing at +8d", () => {
    const groups = dayGroups([A, B, C, D, E], NOW, false);
    expect(groups.map((g) => g.marker)).toEqual([" · TODAY", " · +1d", " · +7d", ""]);
    expect(groups[0].markerColor).toBe("var(--neg)");
    expect(groups[1].markerColor).toBe("var(--amber)");
    expect(groups[2].markerColor).toBe("var(--amber)");
  });

  it("elapsed rows (the recent view and the stored-schedule fallback) carry the elapsed marker in the quiet rung whatever the date", () => {
    const recent = [ev(11, "Jobs report (Aug)", "2026-09-04T12:30:00Z", "high"), ev(12, "ISM services (Aug)", "2026-09-03T14:00:00Z", "medium"), ev(13, "PCE (Jul)", "2026-08-28T12:30:00Z", "low")];
    const groups = dayGroups(recent, NOW, true);
    expect(groups.map((g) => g.label)).toEqual(["Fri Sep 04", "Thu Sep 03", "Fri Aug 28"]);
    expect(groups.every((g) => g.marker === " · elapsed")).toBe(true);
    expect(groups.every((g) => g.markerColor === "var(--text-4)")).toBe(true);
    // Even today's row reads elapsed when the caller says so.
    expect(dayGroups([A], NOW, true)[0].marker).toBe(" · elapsed");
  });

  it("an empty window yields no groups", () => {
    expect(dayGroups([], NOW, false)).toEqual([]);
  });
});

/* ── Iteration 1 (N2): the desk summary's served fill ──────────────────── */

describe("news-copy: desk summary fill (Iteration 1, N2)", () => {
  const row = (id: number, over: Partial<NewsItem> = {}): NewsItem => ({
    id,
    headline: `h${id}`,
    summary: null,
    url: null,
    source: "CNBC",
    category: "MACRO",
    published_at: "2026-09-16T15:00:00Z",
    fetched_at: null,
    market_impact: null,
    deal_size: null,
    sector_relevance: null,
    time_sensitivity: null,
    regime_relevance: null,
    overall_significance: 2,
    regime_interpretation: null,
    perplexity_research: null,
    ticker: null,
    ...over,
  });
  const feed = [row(1), row(2, { category: "M&A", source: "MarketWatch" }), row(3), row(4, { category: null, source: null, regime_interpretation: "Read." }), row(5, { perplexity_research: "Body.\n\nSources:\n1. https://a.example" })];

  it("categoryMixValue counts by the card's category word, largest first, uncategorised as Other; null with nothing on file", () => {
    expect(categoryMixValue(feed)).toBe("Macro / Fed 3 · M&A 1 · Other 1");
    expect(categoryMixValue([])).toBeNull();
  });

  it("outletsValue counts distinct sources and names the three largest", () => {
    expect(outletsValue(feed)).toBe("2 outlets · CNBC 3 · MarketWatch 1");
    expect(outletsValue([row(9, { source: null })])).toBeNull();
  });

  it("aiReadValue counts stories carrying a stored interpretation or research", () => {
    expect(aiReadValue(feed)).toBe("2 of 5 carry an AI read");
    expect(aiReadValue([row(1)])).toBe("None of the 1 carries an AI read");
    expect(aiReadValue([row(4, { regime_interpretation: "x" })])).toBe("All 1 carry an AI read");
    expect(aiReadValue([])).toBeNull();
  });
});
