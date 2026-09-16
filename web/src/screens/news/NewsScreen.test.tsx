/**
 * Phase 8 checklist (docs/redesign-v2/checklists/08-news.md) section E.1,
 * `screens/news/NewsScreen.test.tsx`: the rebuilt News & Calendar screen
 * (composition B.0, hero B.1, summary and strip B.2, Priority headlines B.3,
 * More headlines with the filter bar B.4, the calendar column B.5 rendered
 * for real, the disclosure line B.6, the states B.7, copy C.1, ids D).
 * renderWithProviders + stubFetch with a fixture per route the page reads
 * ("/api/news/latest" before "/api/news", "/api/calendar/recent" before
 * "/api/calendar", "/api/freshness"; unmatched paths 404 so error branches
 * are real). useShellActions runs through ShellActionsContext with a vi.fn()
 * openFreshness. The clock is frozen (only `Date`) to Wednesday Sep 16 2026,
 * 13:00 ET, so the countdown, the day markers, the feed ages and the
 * "checked HH:MM ET" clock never depend on when the suite runs. Fixtures are
 * invented headlines and prints dated Sep 2026; the assertions are the copy
 * rules, never the mockup's or the baseline's figures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import NewsScreen from "./NewsScreen";
import { NO_SHELL_ACTIONS, ShellActionsContext, type ShellActions } from "../shell/shell-actions";
import type { CalendarEvent, Freshness, NewsItem, SlaRow } from "../../api/types";
import { fmtUtcStampEt } from "../../lib/format";
import { assessFreshness } from "../shared/freshness";
import { renderWithProviders, stubFetch } from "../../test/utils";

/* ── fixtures (Sep 2026) ─────────────────────────────────────────────────── */

/** Wednesday Sep 16 2026, 13:00 ET (17:00Z). */
const NOW = new Date("2026-09-16T17:00:00Z");
const ROUTE = "/app/news";
const SRC_FED = "https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm";
const SRC_BLS = "https://www.bls.gov/news.release/cpi.nr0.htm";
const NEWEST = "2026-09-16T16:40:00Z"; // 20 minutes before NOW
const INTERP = "Holds the Goldilocks read; watch inflation pressure.";

const news = (id: number, over: Partial<NewsItem> = {}): NewsItem => ({
  id,
  headline: `Stored headline ${id}`,
  summary: null,
  url: `https://example.com/story-${id}`,
  source: "NewsAPI",
  category: "MACRO",
  published_at: "2026-09-16T15:10:00Z",
  fetched_at: null,
  market_impact: 3,
  deal_size: null,
  sector_relevance: 3,
  time_sensitivity: 3,
  regime_relevance: 3,
  overall_significance: 2.0,
  regime_interpretation: null,
  perplexity_research: null,
  ticker: null,
  ...over,
});

const LEAD = news(101, {
  headline: "Fed holds rates, signals one more cut",
  source: "CNBC",
  category: "MACRO",
  published_at: NEWEST,
  overall_significance: 4.4,
  market_impact: 4,
  regime_relevance: 5,
  sector_relevance: 3,
  time_sensitivity: 4,
  regime_interpretation: INTERP,
  perplexity_research: `Futures priced one cut by December after the statement.\n\nSources:\n1. ${SRC_FED}\n2. ${SRC_BLS}`,
});
const DEAL = news(102, {
  headline: "Oracle to buy Snowflake for $48B",
  source: "MarketWatch",
  category: "M&A",
  deal_size: 4,
  overall_significance: 3.9,
  published_at: "2026-09-16T14:05:00Z",
  summary: "Oracle would pay $48 billion in cash and stock for the data-cloud company, people familiar said.",
});
const GEO = news(103, { headline: "Tanker seized in the Strait of Hormuz", source: "NYT Business", category: "GEOPOLITICAL", overall_significance: 3.6, published_at: "2026-09-16T12:00:00Z" });
const EARN = news(104, { headline: "Nvidia beats, guides above consensus", source: "Finnhub", category: "EARNINGS", ticker: "NVDA", overall_significance: 3.5, published_at: "2026-09-15T21:30:00Z" });
const REST: NewsItem[] = [
  news(105, { headline: "Treasury yields drift lower into the CPI print", overall_significance: 3.2 }),
  news(106, { headline: "Chipmakers rally on export-licence hopes", category: "SECTOR", overall_significance: 3.0, summary: "Semiconductor names led the tape after reports that licences will resume." }),
  news(107, { headline: "Kroger nears deal for regional grocer", category: "M&A", deal_size: 3, overall_significance: 2.8 }),
  news(108, { headline: "Ceasefire talks resume in Geneva", category: "GEOPOLITICAL", overall_significance: 2.6 }),
  news(109, { headline: "Adobe posts record quarter", category: "EARNINGS", ticker: "ADBE", overall_significance: 2.4 }),
  news(110, { headline: "Regional banks extend gains", category: "SECTOR", overall_significance: 2.2 }),
  news(111, { headline: "Fed's Waller sees room for one more cut", overall_significance: 2.0 }),
  news(112, { headline: "Retailers brace for a soft holiday season", category: null, overall_significance: 1.8 }),
  news(113, { headline: "Homebuilder sentiment slips again", overall_significance: 1.6 }),
  news(114, { headline: "FedEx trims outlook", category: "EARNINGS", ticker: "FDX", overall_significance: 1.4, url: null }),
];
/** A cross-source rewrite of the lead story: same headline, another outlet, lower score. Deduped away. */
const DUPLICATE = news(115, { headline: "Fed holds rates, signals one more cut", source: "Biztoc.com", overall_significance: 3.0 });
/** API order: significance DESC, then recency. 15 rows, 14 stories. */
const WINDOWED: NewsItem[] = [LEAD, DEAL, GEO, EARN, REST[0], REST[1], DUPLICATE, ...REST.slice(2)];
const LEAD_HEADLINES = [LEAD, DEAL, GEO, EARN].map((i) => i.headline);

/** The stored fallback: six rows, newest two days old. */
const LATEST: NewsItem[] = [
  news(201, { headline: "ECB holds, flags December", source: "CNBC", published_at: "2026-09-14T13:00:00Z", overall_significance: 3.1 }),
  news(202, { headline: "Broadcom lifts guidance", source: "Finnhub", category: "EARNINGS", ticker: "AVGO", published_at: "2026-09-14T11:00:00Z", overall_significance: 2.9 }),
  news(203, { headline: "Copper hits a record on grid demand", source: "MarketWatch", category: "SECTOR", published_at: "2026-09-13T20:00:00Z", overall_significance: 2.7 }),
  news(204, { headline: "Japan intervenes to support the yen", source: "NYT Business", category: "GEOPOLITICAL", published_at: "2026-09-13T02:00:00Z", overall_significance: 2.5 }),
  news(205, { headline: "Unilever explores ice-cream sale", category: "M&A", deal_size: 3, published_at: "2026-09-12T16:00:00Z", overall_significance: 2.1 }),
  news(206, { headline: "Airlines cut capacity into the autumn", category: "SECTOR", published_at: "2026-09-12T09:00:00Z", overall_significance: 1.7 }),
];

/** Eight stories (four leads, four rows) for the arrival case; a ninth lands on the refetch. */
const SMALL: NewsItem[] = [LEAD, DEAL, GEO, EARN, REST[0], REST[1], REST[2], REST[3]];
const NEW_ITEM = news(301, { headline: "Treasury auction tails as bids thin", overall_significance: 1.0, published_at: "2026-09-16T16:55:00Z" });
/** A different window's payload with ids the 7D baseline never filed. */
const SMALL_24H: NewsItem[] = [401, 402, 403, 404, 405, 406].map((id, i) => news(id, { headline: `Intraday story ${id}`, overall_significance: 3.4 - i * 0.2 }));
/** Sixty stories for the 50-row cap. */
const BIG: NewsItem[] = Array.from({ length: 60 }, (_, i) => news(1001 + i, { headline: `Wire story ${1001 + i}`, overall_significance: Math.round((4.9 - i * 0.05) * 100) / 100 }));

const ev = (id: number, event_name: string, event_datetime: string, importance: string | null, source: string | null = "manual_csv"): CalendarEvent => ({ id, event_name, event_datetime, importance, source });
/** 12:30Z is 08:30 ET in September; 18:00Z is 14:00 ET. All five sit inside the 18-day timeline. */
const CALENDAR = [
  ev(1, "Retail sales (Aug)", "2026-09-17T12:30:00Z", "medium"), // Thu, tomorrow
  ev(2, "CPI (Aug)", "2026-09-18T12:30:00Z", "high"), // Fri, in 2 days: the focus event
  ev(3, "FOMC decision", "2026-09-23T18:00:00Z", "high"), // Wed, in 7 days
  ev(4, "Jobless claims", "2026-09-24T12:30:00Z", "low"),
  ev(5, "PCE (Aug)", "2026-09-30T12:30:00Z", "medium"),
];
const RECENT_CAL = [ev(11, "Jobs report (Aug)", "2026-09-04T12:30:00Z", "high"), ev(12, "ISM services (Aug)", "2026-09-03T14:00:00Z", "medium"), ev(13, "PCE (Jul)", "2026-08-28T12:30:00Z", "low")];

const sla = (verdict: SlaRow["verdict"], reason: string): SlaRow => ({ feed: "news", latest: NEWEST, expected: "2026-09-16T16:30:00Z", verdict, reason });
const freshness = (over: Partial<Freshness> = {}): Freshness => ({
  regimes_date: "2026-09-01",
  signals_date: "2026-09-01",
  market_daily_date: "2026-09-15",
  market_intraday_ts: null,
  news_published_at: NEWEST,
  raw_series_date: "2026-09-15",
  generated_at: "2026-09-16T17:00:00Z",
  overall: "current",
  sla: [sla("current", "Newest stored headline is inside 90 minutes (US business hours)."), { feed: "market_daily", latest: "2026-09-15", expected: "2026-09-15", verdict: "current", reason: "Last close stored." }],
  ...over,
});
const DELAYED_REASON = "Newest stored headline is older than 90 minutes (US business hours).";

/* ── routes ──────────────────────────────────────────────────────────────── */

type Routes = Record<string, (url: URL) => unknown>;
let calls: string[] = [];
function routes(over: Partial<Routes> = {}): Routes {
  // Key order is load-bearing: stubFetch matches by prefix and the first key wins.
  return {
    "/api/news/latest": () => LATEST,
    "/api/news": () => WINDOWED,
    "/api/calendar/recent": () => RECENT_CAL,
    "/api/calendar": () => CALENDAR,
    "/api/freshness": () => freshness(),
    ...over,
  };
}
function stub(r: Routes) {
  calls = stubFetch(r).calls;
}

/* ── harness ─────────────────────────────────────────────────────────────── */

function renderNews({ route = ROUTE, actions = {}, client }: { route?: string; actions?: Partial<ShellActions>; client?: QueryClient } = {}) {
  return renderWithProviders(
    <ShellActionsContext.Provider value={{ ...NO_SHELL_ACTIONS, ...actions }}>
      <main id="main-content">
        <NewsScreen />
      </main>
    </ShellActionsContext.Provider>,
    { route, client },
  );
}

/** Text with `hidden` subtrees removed (Jargon tooltips, closed disclosures), whitespace collapsed. */
function text(el: Element | null | undefined): string {
  if (!el) return "";
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.textContent ?? "";
    if (n.nodeType !== Node.ELEMENT_NODE) return "";
    const e = n as Element;
    if (e.hasAttribute("hidden")) return "";
    return [...e.childNodes].map(walk).join("");
  };
  return walk(el).replace(/\s+/g, " ").trim();
}
const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const main = () => document.querySelector("main") as HTMLElement;
const hero = () => byId("news-hero") as HTMLElement;
const summary = () => byId("news-summary") as HTMLElement;
const headlines = () => byId("headlines") as HTMLElement;
const feed = () => byId("feed") as HTMLElement;
const calendar = () => byId("calendar") as HTMLElement;
const dts = () => [...summary().querySelectorAll("dl dt")].map((d) => text(d));
function ddFor(label: string): HTMLElement {
  const dt = [...summary().querySelectorAll("dl dt")].find((d) => text(d) === label);
  if (!dt) throw new Error(`no summary row labelled ${label}; rows: ${dts().join(" | ")}`);
  const dd = dt.nextElementSibling;
  if (!dd || dd.tagName !== "DD") throw new Error(`row ${label} has no dd`);
  return dd as HTMLElement;
}
const awaitHero = (name = "CPI (Aug) in 2 days") => screen.findByRole("heading", { level: 1, name });
async function awaitSection(id: string): Promise<HTMLElement> {
  await waitFor(() => expect(byId(id)).not.toBeNull());
  return byId(id) as HTMLElement;
}
const strip = () => summary().querySelector<HTMLElement>("button.mrr-status, .mrr-status");
async function awaitStrip(): Promise<HTMLElement> {
  await waitFor(() => expect(strip()).not.toBeNull());
  return strip() as HTMLElement;
}
const stripTitle = (el: HTMLElement) => text(el.querySelector(".mrr-status-title") ?? el.querySelector("b"));
const stripDetail = (el: HTMLElement) => text(el.querySelector("small"));
const articles = () => [...headlines().querySelectorAll<HTMLElement>("article")];
const rows = () => [...feed().querySelectorAll<HTMLElement>("[data-score]")];
const seg = (label: string) => feed().querySelector(`.mrr-seg[aria-label="${label}"]`) as HTMLElement;
const option = (group: string, name: string) => within(seg(group)).getByRole("button", { name });
const pressed = (group: string) => [...seg(group).querySelectorAll("button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => text(b));
/** The StatTile value under a label (the label div's next sibling). */
function tileValue(label: string): string {
  const labels = [...feed().querySelectorAll<HTMLElement>("div")].filter((d) => text(d) === label && d.nextElementSibling);
  if (labels.length !== 1) throw new Error(`expected one count tile labelled ${label}, found ${labels.length}`);
  return text(labels[0].nextElementSibling);
}
const feedDescription = () => text(feed().querySelector(".mrr-sec-desc"));
const feedMeta = () => text(feed().querySelector(".mrr-sec-head"));
const IDS_IN_ORDER = ["news-hero", "news-summary", "headlines", "feed", "calendar"];
const DISCLOSURE =
  "Headlines ingest hourly from Finnhub, NewsAPI and RSS wires, dedupe, then score across five dimensions · the store keeps a rolling window, so the feed ages out by design · calendar is maintained by hand · headlines link to the original article · each pipeline run sends the top 5 by score to Claude for a regime interpretation and to Perplexity for cited research; other items show the wire summary · scores are model estimates.";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  window.history.replaceState(null, "", ROUTE);
  stub(routes());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

/* ── cases ───────────────────────────────────────────────────────────────── */

describe("NewsScreen (checklist 08 E.1)", () => {
  it("renders one h1 inside main: the countdown to the first high-impact event, with the High impact pill, the eyebrow and the live dot", async () => {
    renderNews();
    const h1 = await awaitHero();
    expect(main().contains(h1)).toBe(true);
    expect(main().querySelectorAll("h1")).toHaveLength(1);
    expect(hero().contains(h1)).toBe(true);
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("High impact");
    expect(pill).toHaveAttribute("data-tone", "amber");
    expect(text(hero().querySelector(".mrr-hero-eyebrow"))).toMatch(/Next on the calendar/);
    await waitFor(() => expect(hero().querySelector(".mrr-hero-dot")).not.toBeNull());
  });

  it("the h2 names the first two served events with their ET weekday and wall time", async () => {
    renderNews();
    await awaitHero();
    expect(text(hero().querySelector("h2"))).toBe("Retail sales (Aug) on Thu Sep 17, 08:30 ET, then CPI (Aug) on Fri Sep 18, 08:30 ET.");
  });

  it("the lede is the N2 sentence followed by the lead story's interpretation", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(text(hero().querySelector(".mrr-hero-lede"))).toContain("leads the file"));
    expect(text(hero().querySelector(".mrr-hero-lede"))).toBe(`Macro / Fed leads the file: Fed holds rates, signals one more cut at 4.4 / 5, the window's highest score. ${INTERP}`);
  });

  it("the footnote carries the coverage, events and checked-clock items, the note, and two freshness chips at desk width", async () => {
    renderNews();
    await awaitHero();
    const foot = hero().querySelector(".mrr-hero-foot") as HTMLElement;
    await waitFor(() => expect(text(foot)).toContain("14 headlines in 7D"));
    expect(text(foot)).toContain("5 events in the next 30 days");
    expect(text(foot)).toContain("Feed checked 13:00 ET");
    expect(text(foot)).toContain("Feed rechecks every 60s; the pipeline scores and stores new headlines hourly.");
    expect(foot.querySelectorAll(".mrr-hero-sep")).toHaveLength(2);
    const chips = [...foot.querySelectorAll<HTMLElement>(".mrr-hero-chips > span")];
    expect(chips).toHaveLength(2);
    expect(chips[0].getAttribute("title")).toMatch(/^Newest headline: /);
    expect(chips[1].getAttribute("title")).toMatch(/^Calendar: /);
  });

  it("Open the calendar is the primary link to #calendar and Filter headlines the ghost link to #feed", async () => {
    renderNews();
    await awaitHero();
    const open = within(hero()).getByRole("link", { name: "Open the calendar" });
    expect(open).toHaveAttribute("href", "/app/news#calendar");
    expect(open).toHaveClass("mrr-hero-btn-primary");
    const filter = within(hero()).getByRole("link", { name: "Filter headlines" });
    expect(filter).toHaveAttribute("href", "/app/news#feed");
    expect(filter).toHaveClass("mrr-hero-btn-ghost");
  });

  it("the hero chart is the event timeline with one circle per fixture event", async () => {
    renderNews();
    await awaitHero();
    const svg = hero().querySelector("svg[role='img']") as SVGSVGElement;
    expect(svg).not.toBeNull();
    expect(hero().querySelectorAll("svg[role='img']")).toHaveLength(1);
    expect(svg).toHaveAttribute("aria-label", "Macro events over the next 18 days: 5 events, 2 high impact");
    expect(svg.querySelectorAll("circle")).toHaveLength(5);
    expect(svg.querySelectorAll("circle[fill='var(--amber)']")).toHaveLength(2);
  });

  it("the summary dl has the five dt labels in order with the served values, and the page never says Consensus", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(dts()).toEqual(["Next event", "After that", "Coverage", "Top significance", "High impact"]));
    expect(within(summary()).getByRole("heading", { level: 2, name: "Desk summary" })).toBeInTheDocument();
    expect(text(ddFor("Next event"))).toBe("Retail sales (Aug) · Thu Sep 17, 08:30 ET");
    expect(text(ddFor("After that"))).toBe("CPI (Aug) · Fri Sep 18, 08:30 ET");
    expect(text(ddFor("Coverage"))).toBe("14 stories in 7D");
    expect(text(ddFor("Top significance"))).toBe("4.4 / 5 · Macro / Fed");
    expect(text(ddFor("High impact"))).toBe("4 headlines scored 3.5 or higher");
    expect(text(main())).not.toMatch(/Consensus/);
  });

  it("status strip: a current served verdict reads mint Feed current with the newest stamp and the source count, as a dialog button with the reason in its name", async () => {
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    await waitFor(() => expect(stripTitle(button)).toBe("Feed current"));
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("data-tone", "mint");
    // The stamp is the ET wall time of the stored UTC stamp (12:40 ET for 16:40Z), never UTC digits labelled ET.
    const stamp = fmtUtcStampEt(NEWEST);
    expect(stamp).toBe("Sep 16, 12:40 ET");
    expect(stripDetail(button)).toBe(`Newest headline ${stamp} · 5 sources`);
    const label = button.getAttribute("aria-label") ?? "";
    expect(label.startsWith(`Feed current. Newest headline ${stamp} · 5 sources. `)).toBe(true);
    expect(label).toContain("Newest stored headline is inside 90 minutes (US business hours).");
    expect(label.endsWith("Open the data freshness breakdown.")).toBe(true);
    expect(summary().querySelectorAll(".mrr-status")).toHaveLength(1);
  });

  it("status strip: the served verdict wins over the client clock: a delayed sla row on a 20-minute-old feed reads amber Feed delayed and stops the live dot", async () => {
    stub(routes({ "/api/freshness": () => freshness({ sla: [sla("delayed", DELAYED_REASON)] }) }));
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    await waitFor(() => expect(stripTitle(button)).toBe("Feed delayed"));
    expect(button).toHaveAttribute("data-tone", "amber");
    const info = assessFreshness(NEWEST, "hourly");
    expect(info.state).toBe("current");
    expect(stripDetail(button)).toBe(`Newest headline ${fmtUtcStampEt(NEWEST)} · ${info.age} old · 5 sources`);
    expect(button.getAttribute("aria-label")).toContain(DELAYED_REASON);
    expect(hero().querySelector(".mrr-hero-dot")).toBeNull();
    // The chip speaks the same verdict.
    expect(text(hero().querySelector(".mrr-hero-chips"))).toMatch(/Delayed/);
  });

  it("status strip: without a served sla row the client clock fills in: a 31-hour-old feed reads Feed delayed", async () => {
    const stale = "2026-09-15T10:00:00Z";
    stub(routes({ "/api/news": () => WINDOWED.map((i) => ({ ...i, published_at: stale })), "/api/freshness": () => freshness({ sla: null, news_published_at: stale }) }));
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    await waitFor(() => expect(stripTitle(button)).toBe("Feed delayed"));
    expect(button).toHaveAttribute("data-tone", "amber");
    const info = assessFreshness(stale, "hourly");
    expect(info.state).toBe("delayed");
    expect(stripDetail(button)).toBe(`Newest headline ${fmtUtcStampEt(stale)} · ${info.age} old · 5 sources`);
    // The hero chip prints the same wall-time stamp as the strip.
    expect(text(hero().querySelector(".mrr-hero-chips"))).toContain(fmtUtcStampEt(stale));
    expect(hero().querySelector(".mrr-hero-dot")).toBeNull();
  });

  it("status strip: an empty window with stored rows reads amber Fallback coverage; the title, note, coverage row, description and footers all say stored", async () => {
    stub(routes({ "/api/news": () => [] }));
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    await waitFor(() => expect(stripTitle(button)).toBe("Fallback coverage"));
    expect(button).toHaveAttribute("data-tone", "amber");
    expect(stripDetail(button)).toBe("Newest stored Sep 14, 2026 · 2 days old · 6 stored stories");
    expect(hero().querySelector(".mrr-hero-dot")).toBeNull();
    expect(within(headlines()).getByRole("heading", { level: 2, name: "Latest stored headlines" })).toBeInTheDocument();
    expect(text(headlines())).toContain("No headlines in the last 7D; the 6 most recent stored stories follow, significance filter not applied.");
    expect(text(headlines())).toContain("Most recent stored stories, significance filter not applied");
    expect(text(headlines())).toContain("4 of 6 · by significance · outside the selected window");
    expect(text(ddFor("Coverage"))).toBe("Stale: no headlines in 7D; newest stored Sep 14, 2026 (2 days old)");
    expect(ddFor("Coverage").getAttribute("style") ?? "").toMatch(/var\(--warn-hot\)/);
    expect(text(hero().querySelector(".mrr-hero-lede"))).toContain("leads the stored file");
    expect(text(hero().querySelector(".mrr-hero-lede"))).toContain("it is stored fallback coverage, not today's tape");
    expect(text(hero().querySelector(".mrr-hero-foot"))).toContain("Stale: no headlines in 7D; newest stored Sep 14, 2026 (2 days old)");
    expect(feedDescription()).toBe("6 most recent stored");
    expect(feedMeta()).toContain("sorted by recency (fallback)");
    for (const a of articles()) expect(text(a)).toContain("stored · stale");
    expect(calls.some((c) => c.startsWith("/api/news/latest?"))).toBe(true);
  });

  it("status strip: before the first payload it reads gray Reading feed health… and the lede is the reading sentence", async () => {
    stub(routes({ "/api/news": () => new Promise(() => {}) }));
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripTitle(button)).toBe("Reading feed health…");
    expect(stripDetail(button)).toBe("Opens the data freshness breakdown");
    expect(button.getAttribute("aria-label") ?? "").toMatch(/^Reading feed health…\. Opens the data freshness breakdown\. .*Open the data freshness breakdown\.$/);
    expect(text(hero().querySelector(".mrr-hero-lede"))).toBe("Reading the stored headline feed…");
    // Phase 10 (checklist 10 C #4): the empty tile names the hourly cadence.
    expect(text(headlines())).toContain("Nothing on file; the news pipeline runs hourly (minute 41 UTC) and has not stored headlines yet.");
  });

  it("status strip: an empty feed with no stamp reads gray Feed unavailable; the empty note and no Top significance row", async () => {
    stub(routes({ "/api/news/latest": () => [], "/api/news": () => [], "/api/freshness": () => freshness({ sla: null, news_published_at: null }) }));
    renderNews();
    await awaitHero();
    const button = await awaitStrip();
    await waitFor(() => expect(stripTitle(button)).toBe("Feed unavailable"));
    expect(button).toHaveAttribute("data-tone", "gray");
    expect(stripDetail(button)).toBe("No headline stamp on file");
    expect(text(hero().querySelector(".mrr-hero-lede"))).toBe("No headlines on file.");
    expect(text(headlines())).toContain("Nothing on file; the news pipeline runs hourly (minute 41 UTC) and has not stored headlines yet.");
    expect(dts()).toEqual(["Next event", "After that", "Coverage", "High impact"]);
    expect(text(ddFor("Coverage"))).toBe("0 stories in 7D");
    expect(articles()).toHaveLength(0);
  });

  it("clicking the strip calls the shell's openFreshness", async () => {
    const openFreshness = vi.fn();
    const openAlerts = vi.fn();
    renderNews({ actions: { openFreshness, openAlerts } });
    await awaitHero();
    const button = await awaitStrip();
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(1);
    expect(openAlerts).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(openFreshness).toHaveBeenCalledTimes(2);
  });

  it("#headlines: Priority headlines with four lead articles in significance order, their badges and chips, the meta and the How scoring works link", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(articles()).toHaveLength(4));
    const section = headlines();
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2, name: "Priority headlines" })).toBeInTheDocument();
    expect(text(section)).toContain("Ranked by significance, last 7D");
    expect(text(section)).toContain("4 of 14 · by significance");
    expect(text(section)).not.toContain("outside the selected window");
    expect(articles().map((a) => text(a.querySelector("h3 a")))).toEqual(LEAD_HEADLINES);
    for (const a of articles()) {
      const link = a.querySelector("h3 a") as HTMLAnchorElement;
      expect(link.getAttribute("href")).toMatch(/^https:\/\//);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link.getAttribute("rel") ?? "").toContain("noreferrer");
      expect(text(a.querySelector("[data-score]"))).toMatch(/^sig \d\.\d \/ 5$/i);
      expect(a.querySelectorAll("i")).toHaveLength(5);
    }
    const [lead, deal, geo, earn] = articles();
    expect(within(lead).getByText("MACRO")).toHaveAttribute("data-tone", "info");
    expect(text(lead)).toContain("◆ Why it matters · AI");
    expect(text(lead)).toContain(INTERP);
    expect(within(lead).getByRole("button", { name: /Regime read · 2 sources/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(lead).getByRole("button", { name: /Score breakdown/ })).toHaveAttribute("aria-expanded", "false");
    expect(within(lead).getByRole("link", { name: "Read at CNBC →" })).toHaveAttribute("href", LEAD.url as string);
    expect(within(deal).getByText("M&A")).toHaveAttribute("data-tone", "reference");
    expect(within(deal).getByText("$10–50B")).toHaveAttribute("title", "M&A deal size");
    expect(text(deal)).toContain("Wire summary");
    expect(within(geo).getByText("GEO")).toHaveAttribute("data-tone", "watch");
    expect(within(earn).getByText("EARN")).toHaveAttribute("data-tone", "reference");
    expect(within(earn).getByText("NVDA")).toHaveAttribute("title", "Ticker");
    expect(within(section).getByRole("link", { name: "How scoring works →" })).toHaveAttribute("href", "/app/methodology#ramps");
    expect(text(section)).not.toContain("stored · stale");
  });

  it("#feed: More headlines with the five count tiles, the description, the sources meta and the checked clock", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    const section = feed();
    expect(section.tagName).toBe("SECTION");
    expect(within(section).getByRole("heading", { level: 2, name: "More headlines" })).toBeInTheDocument();
    expect(feedDescription()).toBe("14 in the last 7D");
    expect(feedMeta()).toContain("Finnhub · NewsAPI · RSS · sorted by significance · checked 13:00 ET");
    expect(feedMeta()).not.toContain("new this session");
    expect(tileValue("Headlines")).toBe("14");
    expect(tileValue("High impact · ≥3.5")).toBe("4");
    expect(tileValue("M&A")).toBe("2");
    expect(tileValue("Macro / Fed")).toBe("4");
    expect(tileValue("Geopolitical")).toBe("2");
  });

  it("#feed: the filter bar is a fieldset with sr-only legends Filters / Window / Category / Significance, three mono Segmented groups with the verbatim options, 7D / ALL / ANY SIG pressed, and the scoring caption", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    const bar = feed().querySelector("fieldset.mrr-news-filters") as HTMLElement;
    expect(bar).not.toBeNull();
    const legends = [...feed().querySelectorAll("legend")];
    expect(legends.map((l) => text(l))).toEqual(["Filters", "Window", "Category", "Significance"]);
    for (const l of legends) expect(l).toHaveClass("sr-only");
    expect(feed().querySelectorAll("fieldset")).toHaveLength(4);
    for (const label of ["Window", "Category", "Significance"]) {
      expect(seg(label), label).not.toBeNull();
      expect(seg(label)).toHaveAttribute("data-mono", "true");
      expect(bar.contains(seg(label))).toBe(true);
    }
    expect([...seg("Window").querySelectorAll("button")].map((b) => text(b))).toEqual(["24H", "48H", "7D"]);
    expect([...seg("Category").querySelectorAll("button")].map((b) => text(b))).toEqual(["ALL", "MACRO", "M&A", "EARN", "GEO", "SECTOR"]);
    expect([...seg("Significance").querySelectorAll("button")].map((b) => text(b))).toEqual(["ANY SIG", "≥ 2.5 notable", "≥ 3.5 high"]);
    expect(pressed("Window")).toEqual(["7D"]);
    expect(pressed("Category")).toEqual(["ALL"]);
    expect(pressed("Significance")).toEqual(["ANY SIG"]);
    expect(text(feed())).toContain(
      "Significance is scored 1–5 blending market impact, deal size, sector reach, timeliness and regime fit; ≥4.5 reads red, ≥3.5 orange, ≥2.5 amber. Identical cross-source headlines are shown once.",
    );
    expect(feed().querySelector(".jargon")).not.toBeNull();
    expect(text(feed().querySelector(".jargon"))).toBe("Significance");
  });

  it("pressing 24H, MACRO and ≥ 3.5 high issues the matching requests, flips aria-pressed and rewords the description", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    fireEvent.click(option("Window", "24H"));
    expect(pressed("Window")).toEqual(["24H"]);
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/news?") && /[?&]hours=24(&|$)/.test(c))).toBe(true));
    await waitFor(() => expect(feedDescription()).toBe("14 in the last 24H"));
    expect(text(headlines())).toContain("last 24H");
    fireEvent.click(option("Category", "MACRO"));
    expect(pressed("Category")).toEqual(["MACRO"]);
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/news?") && /[?&]category=MACRO(&|$)/.test(c))).toBe(true));
    fireEvent.click(option("Significance", "≥ 3.5 high"));
    expect(pressed("Significance")).toEqual(["≥ 3.5 high"]);
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/news?") && /[?&]min_significance=3\.5(&|$)/.test(c))).toBe(true));
    const last = calls.filter((c) => c.startsWith("/api/news?")).pop() ?? "";
    expect(last).toMatch(/[?&]hours=24(&|$)/);
    expect(last).toMatch(/[?&]category=MACRO(&|$)/);
    expect(last).toMatch(/[?&]min_significance=3\.5(&|$)/);
    fireEvent.click(option("Window", "7D"));
    expect(pressed("Window")).toEqual(["7D"]);
    expect(option("Window", "24H")).toHaveAttribute("aria-pressed", "false");
  });

  it("a filter change re-seeds the arrival baseline: a new window's payload never counts as new and never flashes", async () => {
    stub(routes({ "/api/news": (url) => (url.searchParams.get("hours") === "24" ? SMALL_24H : WINDOWED) }));
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    fireEvent.click(option("Window", "24H"));
    await screen.findByText("Intraday story 401");
    expect(feedMeta()).not.toContain("new this session");
    expect(feed().querySelector(".mrr-news-new")).toBeNull();
    expect(tileValue("Headlines")).toBe("6");
  });

  it("a refetch payload with a new id increments the session counter and flashes that row once; the seeded set never flashes", async () => {
    let payload: NewsItem[] = SMALL;
    stub(routes({ "/api/news": () => payload }));
    const { client } = renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(feed().querySelector(".mrr-news-new")).toBeNull();
    expect(feedMeta()).not.toContain("new this session");
    payload = [...SMALL, NEW_ITEM];
    await client.invalidateQueries({ queryKey: ["news"] });
    await waitFor(() => {
      expect(feedMeta()).toContain("1 new this session");
      const flash = feed().querySelector(".mrr-news-new");
      expect(flash).not.toBeNull();
      expect(text(flash)).toContain(NEW_ITEM.headline);
    });
    expect(feed().querySelectorAll(".mrr-news-new")).toHaveLength(1);
    expect(rows()).toHaveLength(5);
    expect(tileValue("Headlines")).toBe("9");
  });

  it("a duplicate headline from a second source renders once: the other outlet never appears and the count is the story count", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    fireEvent.click(within(feed()).getByRole("button", { name: "Show 2 more headlines" }));
    await waitFor(() => expect(rows()).toHaveLength(10));
    expect(screen.getAllByRole("link", { name: "Fed holds rates, signals one more cut" })).toHaveLength(1);
    expect(text(main())).not.toContain("Biztoc.com");
    expect(tileValue("Headlines")).toBe("14");
  });

  it("eight rows then Show N more headlines reveals the rest and the button goes", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    const button = within(feed()).getByRole("button", { name: "Show 2 more headlines" });
    expect(button).toHaveClass("mrr-btn");
    fireEvent.click(button);
    await waitFor(() => expect(rows()).toHaveLength(10));
    expect(within(feed()).queryByRole("button", { name: /more headlines/ })).toBeNull();
    expect(text(feed())).not.toContain("Showing the top 50");
    // The lead stories never repeat as rows.
    for (const h of LEAD_HEADLINES) expect(within(feed()).queryByRole("link", { name: h })).toBeNull();
  });

  it("past the 50-row cap the button counts to the cap and the caption names the cap", async () => {
    stub(routes({ "/api/news": () => BIG }));
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    expect(tileValue("Headlines")).toBe("60");
    expect(feedDescription()).toBe("60 in the last 7D");
    fireEvent.click(within(feed()).getByRole("button", { name: "Show 38 more headlines" }));
    await waitFor(() => expect(rows()).toHaveLength(46));
    expect(text(feed())).toContain("Showing the top 50 of 60 by significance; tighten the filters to narrow the list.");
  });

  it("row anatomy: the clock cell, the badge, the headline link, the source span with the time, the chip, Read at, the toggle and the score", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    const section = feed();
    fireEvent.click(within(section).getByRole("button", { name: "Show 2 more headlines" }));
    await waitFor(() => expect(rows()).toHaveLength(10));
    // REST[0] is the first row: 15:10Z is 11:10 ET.
    expect(text(section)).toContain("11:10 ET");
    const yields = within(section).getByRole("link", { name: "Treasury yields drift lower into the CPI print" });
    expect(yields).toHaveAttribute("target", "_blank");
    expect(within(section).getAllByText("MACRO").some((el) => el.getAttribute("data-tone") === "info")).toBe(true);
    expect(within(section).getByText("ADBE")).toHaveAttribute("title", "Ticker");
    expect(within(section).getByText("$1–10B")).toHaveAttribute("title", "M&A deal size");
    expect(within(section).getAllByRole("link", { name: /^Read at NewsAPI →$/ })).toHaveLength(9);
    expect(within(section).getByRole("button", { name: /Wire summary/ })).toHaveAttribute("aria-expanded", "false");
    expect(text(section)).toContain("Headline only");
    expect(text(section)).toContain("No source link stored");
    expect(text(section)).toContain("Sep 16, 2026 · 1h ago");
    for (const r of rows()) expect(text(r)).toMatch(/^sig \d\.\d \/ 5$/i);
  });

  it("every external link in main opens in a new tab with rel noreferrer", async () => {
    renderNews();
    await awaitHero();
    await waitFor(() => expect(rows()).toHaveLength(8));
    fireEvent.click(within(articles()[0]).getByRole("button", { name: /Regime read · 2 sources/ }));
    const links = [...main().querySelectorAll<HTMLAnchorElement>("a[href^='http']")];
    expect(links.length).toBeGreaterThanOrEqual(16);
    for (const a of links) {
      expect(a).toHaveAttribute("target", "_blank");
      expect(a.getAttribute("rel") ?? "", a.getAttribute("href") ?? "").toContain("noreferrer");
    }
    expect(within(articles()[0]).getByRole("link", { name: SRC_FED })).toHaveAttribute("href", SRC_FED);
  });

  it("renders the section ids in document order inside main, #calendar with Upcoming pressed, and the DisclosureLine last", async () => {
    renderNews();
    await awaitHero();
    await awaitSection("calendar");
    await waitFor(() => expect(text(calendar())).toContain("Retail sales (Aug)"));
    const els = IDS_IN_ORDER.map((id) => byId(id));
    IDS_IN_ORDER.forEach((id, i) => expect(els[i], id).not.toBeNull());
    for (let i = 1; i < els.length; i++) {
      expect((els[i - 1] as HTMLElement).compareDocumentPosition(els[i] as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING, `${IDS_IN_ORDER[i - 1]} before ${IDS_IN_ORDER[i]}`).toBeTruthy();
    }
    for (const el of els) expect(main().contains(el)).toBe(true);
    const group = within(calendar()).getByRole("group", { name: "Calendar view" });
    expect(within(group).getByRole("button", { name: "Upcoming" })).toHaveAttribute("aria-pressed", "true");
    expect(within(calendar()).getByRole("heading", { level: 2, name: "Macro calendar" })).toBeInTheDocument();
    expect(calendar().querySelectorAll("tr.mrr-grp").length).toBeGreaterThanOrEqual(4);
    const line = document.querySelector("main .mrr-disclosure-line") as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.tagName).toBe("P");
    expect(text(line)).toBe(DISCLOSURE);
    const all = [...main().querySelectorAll("*")];
    expect(all[all.length - 1]).toBe(line);
    expect(document.querySelectorAll("main .mrr-disclosure-line")).toHaveLength(1);
  });

  it("useHashScroll lands #calendar when rendered with route /app/news#calendar", async () => {
    const targets: Element[] = [];
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element) {
      targets.push(this);
    });
    window.history.replaceState(null, "", "/app/news#calendar");
    renderNews({ route: "/app/news#calendar" });
    await awaitHero();
    await waitFor(() => expect(targets).toContain(byId("calendar") as HTMLElement));
  });

  it("calendar 404 without data renders the error headline with the Unavailable pill; the lede keeps its news sentences", async () => {
    stub(routes({ "/api/calendar": () => ({ status: 503, body: { detail: "down" } }) }));
    renderNews();
    expect(await screen.findByText("Calendar unavailable: the data service did not answer.")).toBeInTheDocument();
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(pill).not.toBeNull();
    expect(text(pill)).toBe("Unavailable");
    expect(pill).toHaveAttribute("data-tone", "gray");
    expect(main().querySelectorAll("h1")).toHaveLength(1);
    await waitFor(() => expect(text(hero().querySelector(".mrr-hero-lede"))).toContain("leads the file"));
    expect(screen.queryByText("Reading the calendar…")).toBeNull();
    expect(calls.some((c) => c.startsWith("/api/calendar/recent"))).toBe(false);
  });

  it("an empty 30-day window with stored recent rows reads No events in the next 30 days with the Stored schedule pill, the snapshot subhead and the elapsed Next event row", async () => {
    stub(routes({ "/api/calendar": () => [] }));
    renderNews();
    const h1 = await awaitHero("No events in the next 30 days");
    expect(hero().contains(h1)).toBe(true);
    const pill = hero().querySelector(".mrr-pill") as HTMLElement;
    expect(text(pill)).toBe("Stored schedule");
    expect(pill).toHaveAttribute("data-tone", "gray");
    await waitFor(() => expect(text(hero().querySelector("h2"))).toBe("The calendar snapshot ends Sep 04, 2026; the most recent 3 scheduled events are listed below."));
    await waitFor(() => expect(text(ddFor("Next event"))).toMatch(/^Jobs report \(Aug\) · Fri Sep 04, 08:30 ET · elapsed$/));
    expect(text(hero().querySelector(".mrr-hero-foot"))).toContain("stored schedule");
    expect(text(hero().querySelector("svg[role='img']"))).toContain("Stored schedule ends Sep 04, 2026");
    expect(text(calendar())).toContain("Stored schedule. No upcoming events in the stored window; the calendar snapshot ends Sep 04, 2026; showing the most recent 3 scheduled events instead.");
  });

  it("both calendar feeds empty read No events on file with no pill and the summary's empty rows", async () => {
    stub(routes({ "/api/calendar/recent": () => [], "/api/calendar": () => [] }));
    renderNews();
    await awaitHero("No events on file");
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    await waitFor(() => expect(text(ddFor("Next event"))).toBe("No events in the next 30 days"));
    expect(text(ddFor("After that"))).toBe("No second event in the window");
    expect(text(hero().querySelector("svg[role='img']"))).toContain("No events on file.");
    // Phase 10 (checklist 10 C #3): the panel's empty note names the cadence; the EventTimeline text above is unchanged.
    expect(within(calendar()).getByText("No events on file; the calendar is a hand-maintained schedule refreshed with the daily run.")).toBeInTheDocument();
  });

  it("while the calendar loads the hero reads Reading the calendar… with no pill and the summary rows read the loading note", async () => {
    stub(routes({ "/api/calendar": () => new Promise(() => {}) }));
    renderNews();
    expect(await screen.findByText("Reading the calendar…")).toBeInTheDocument();
    expect(hero().querySelector(".mrr-pill")).toBeNull();
    expect(hero().querySelector("svg[role='img']")).toBeNull();
    expect(hero().querySelector(".mrr-hero-placeholder")).not.toBeNull();
    expect(text(ddFor("Next event"))).toBe("Reading stored data…");
  });
});
