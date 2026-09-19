/**
 * News & Calendar, rebuilt on TabHero + SummaryCard (redesign Phase 8,
 * docs/redesign-v2/checklists/08-news.md B.0).
 *
 * Order of <main> children, all inside `.mrr-news`: the hero row (TabHero
 * `#news-hero`, whose h1 is the countdown to the next high-impact calendar
 * event with its impact word as the pill, the next two events as the subhead,
 * the lead story's sentences as the lede and the 18-day event timeline as the
 * signature visual, beside SummaryCard `#news-summary` with the feed-health
 * strip opening the freshness drawer) → `.mrr-news-body` (the left stack:
 * `#headlines` Priority headlines as four lead cards, `#feed` More headlines
 * with the filter bar, the count tiles and the list rows | the right column,
 * `#calendar`, the CalendarPanel) → the mono disclosure line.
 *
 * Locked IA kept from the first build: neither section may ever show an empty
 * screen. The windowed feed falls back to the latest stored headlines and the
 * 30-day calendar to the most recent stored events, each with an amber notice
 * stating the newest stored date (confusion #2). Data: /api/news (windowed) →
 * /api/news/latest (fallback); /api/calendar (upcoming) → /api/calendar/recent
 * (fallback); /api/freshness for the feed's served SLA verdict. Nothing is
 * re-derived in the browser: every figure is a served field, its formatted
 * value, or a count of served rows.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card, NewsCard, SectionHeader, Segmented, StatTile } from "../../components";
import { useCalendar, useCalendarEarnings, useCalendarRecent, useFreshness, useNews, useNewsLatest } from "../../api/queries";
import type { NewsItem } from "../../api/types";
import { fmtDate, fmtUtcStampEt, tidyProse } from "../../lib/format";
import { takeSentences } from "../../lib/sentences";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { DASH } from "../dashboard/hero-copy";
import { DisclosureLine } from "../shared/Disclosure";
import { impactOf } from "../shared/calendar-impact";
import { assessFreshness } from "../shared/freshness";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, useHashScroll } from "../shared/screen-ui";
import SummaryCard, { type StatusStripProps, type SummaryRow } from "../shared/SummaryCard";
import TabHero, { type TabHeroAction } from "../shared/TabHero";
import { useShellActions } from "../shell/shell-actions";
import CalendarPanel from "./CalendarPanel";
import EventTimeline, { isEarnings } from "./EventTimeline";
import {
  DEAL_LABELS,
  CATEGORY_WORD,
  aiReadValue,
  categoryMixValue,
  outletsValue,
  NEWS_GLOW,
  categoryToneOf,
  clockEt,
  countdownHeadline,
  coverageValue,
  decodeEntities,
  eventLine,
  feedHealth,
  headlineKey,
  heroPill,
  heroSubhead,
  highImpactCount,
  highImpactValue,
  leadSentence,
  mergeFeedVerdict,
  nextFocusEvent,
  researchBody,
  sourcesFromResearch,
  timeLabel,
  topSignificanceValue,
  usefulSummary,
  whySentence,
} from "./news-copy";
import type { CalendarView } from "./news-types";

const WINDOWS = [
  { hours: 24, label: "24H" },
  { hours: 48, label: "48H" },
  { hours: 168, label: "7D" },
] as const;

const CATEGORIES = [
  { value: null, label: "ALL" },
  { value: "MACRO", label: "MACRO" },
  { value: "M&A", label: "M&A" },
  { value: "EARNINGS", label: "EARN" },
  { value: "GEOPOLITICAL", label: "GEO" },
  { value: "SECTOR", label: "SECTOR" },
] as const;

const SIG_FILTERS = [
  { min: undefined, label: "ANY SIG" },
  { min: 2.5, label: "≥ 2.5 notable" },
  { min: 3.5, label: "≥ 3.5 high" },
] as const;

const DISPLAY_CAP = 50;
const PRIORITY_N = 4;

/** The card badge word per category: the CATEGORIES labels keyed by value
 * (checklist 08 B.3 row 1); the long form stays on the count tiles. */
const CATEGORY_BADGE: Record<string, string> = {};
for (const c of CATEGORIES) if (c.value) CATEGORY_BADGE[c.value] = c.label;

/* The three Segmented groups read the verbatim tables above; "all" and "any"
   stand for the null / undefined filter values. */
const WINDOW_OPTIONS = WINDOWS.map((w) => ({ id: String(w.hours), label: w.label }));
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ id: c.value ?? "all", label: c.label }));
const SIG_OPTIONS = SIG_FILTERS.map((s) => ({ id: s.min == null ? "any" : String(s.min), label: s.label }));

/** Loading and unavailable headlines ride in the UI face at the hero-sub
 * size: the serif display face is for answers only (02 B.1 states). */
const stateHeadline: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontWeight: 500,
  fontSize: "var(--fs-hero-sub)",
  lineHeight: "var(--lh-hero-sub)",
  letterSpacing: 0,
  fontVariationSettings: "normal",
};

const HERO_ACTIONS: TabHeroAction[] = [
  { label: "Open the calendar", to: "/app/news#calendar", primary: true },
  { label: "Filter headlines", to: "/app/news#feed" },
];

const STRIP_SUFFIX = "Open the data freshness breakdown.";

/** The ticker, else the M&A deal-size bucket in the same chip slot (U12). */
function chipOf(item: NewsItem): string | undefined {
  return (
    item.ticker ??
    (item.category === "M&A" && item.deal_size != null && DEAL_LABELS[item.deal_size] ? DEAL_LABELS[item.deal_size] : undefined)
  );
}

/** The card props both variants share: the decoded headline, the AI
 * interpretation and the Perplexity body as tidied prose, the cited sources
 * and the wire summary when it adds to the headline. */
function cardProps(item: NewsItem) {
  const body = researchBody(item.perplexity_research);
  const chip = chipOf(item);
  return {
    category: item.category ? (CATEGORY_BADGE[item.category] ?? item.category) : undefined,
    categoryTone: categoryToneOf(item.category),
    chip,
    chipTitle: chip ? (item.ticker ? "Ticker" : "M&A deal size") : undefined,
    source: item.source ?? DASH,
    headline: decodeEntities(item.headline),
    href: item.url ?? undefined,
    summary: usefulSummary(item.headline, item.summary) ?? undefined,
    significance: item.overall_significance ?? undefined,
    sigScale: 5 as const,
    interpretation: item.regime_interpretation?.trim() ? tidyProse(decodeEntities(item.regime_interpretation)) : undefined,
    research: body ? tidyProse(decodeEntities(body)) : undefined,
    sources: sourcesFromResearch(item.perplexity_research),
  };
}

export default function NewsScreen() {
  const { isMobile, isNarrow } = useBreakpoint();
  const [hours, setHours] = useState<number>(168);
  const [cat, setCat] = useState<string | null>(null);
  const [minSig, setMinSig] = useState<number | undefined>(undefined);
  const [view, setView] = useState<CalendarView>("upcoming");
  const [showAll, setShowAll] = useState(false);

  // Category filters server-side (mirrors the Streamlit loader), so the
  // latest-available fallback fires for ANY empty filter combination — an
  // empty category inside a busy window still gets dated headlines.
  //
  // 60s poll: the feed re-reads the store so a headline stored while this tab
  // is open lands without a manual refresh. The ingest itself runs hourly, so
  // most checks return the same rows; the header states both cadences.
  const windowed = useNews(hours, minSig, 150, cat ?? undefined, 60_000);
  // Empty window OR a window that could not load at all (the API asleep,
  // nothing seeded for this filter) both fall back to the latest stored
  // headlines — dated beats empty, and dated beats blank (2026-09-06).
  const windowedEmpty = (windowed.isSuccess && (windowed.data?.length ?? 0) === 0) || (windowed.isError && !windowed.data);
  const fallback = useNewsLatest(cat ?? undefined, 50, windowedEmpty);

  const usingFallback = windowedEmpty && (fallback.data?.length ?? 0) > 0;
  const feed: NewsItem[] = useMemo(() => {
    const raw = usingFallback ? (fallback.data ?? []) : (windowed.data ?? []);
    // Cross-source rewrites arrive as distinct rows with identical headlines —
    // under a header that says DEDUPED, show each story once (keep the
    // highest-significance copy; the pipeline-level dedupe keys on URL and is
    // the real fix, logged).
    const seen = new Set<string>();
    return raw.filter((r) => {
      const key = headlineKey(r.headline);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [usingFallback, fallback.data, windowed.data]);
  const shown = feed.slice(0, DISPLAY_CAP);

  // New-arrival tracking. The seen-set is seeded from the first resolved
  // payload, so nothing flashes on open; after that, a row id we have not
  // filed before is new to this session and its card flashes once.
  const seenIds = useRef<Set<number> | null>(null);
  const seenHeadlines = useRef<Set<string> | null>(null);
  const [justArrived, setJustArrived] = useState<ReadonlySet<number>>(() => new Set<number>());
  const [newThisSession, setNewThisSession] = useState<number>(0);

  // A filter change re-seeds the baseline so only rows that arrive while
  // watching count as new. Declared before the arrival effect on purpose: when
  // the new filter's payload is already cached, both effects run in the same
  // commit and the reset has to land first. The session counter stands — what
  // already arrived stayed arrived.
  useEffect(() => {
    seenIds.current = null;
    seenHeadlines.current = null;
    setJustArrived(new Set<number>());
  }, [hours, minSig, cat]);

  useEffect(() => {
    const rows = windowed.data;
    if (!rows) return;
    // Both refs are seeded and cleared in lockstep; checking the pair keeps
    // that contract explicit and the types non-null below.
    if (seenIds.current === null || seenHeadlines.current === null) {
      seenIds.current = new Set(rows.map((r) => r.id));
      seenHeadlines.current = new Set(rows.map((r) => headlineKey(r.headline)));
      return;
    }
    const seen = seenIds.current;
    const seenText = seenHeadlines.current;
    const fresh = rows.filter((r) => !seen.has(r.id));
    if (!fresh.length) return;
    // The counter counts stories, not rows, matching the feed dedupe above: a
    // fresh row that repeats a headline already on the board never renders a
    // card, so it is filed silently instead of counted and flashed.
    const arrived: number[] = [];
    fresh.forEach((r) => {
      seen.add(r.id);
      const key = headlineKey(r.headline);
      if (!seenText.has(key)) arrived.push(r.id);
      seenText.add(key);
    });
    if (!arrived.length) return;
    setJustArrived(new Set(arrived));
    setNewThisSession((n) => n + arrived.length);
    // The flash is a one-shot state change: hold the marker a touch longer
    // than the 1.5s animation, then drop it.
    const timer = window.setTimeout(() => setJustArrived(new Set<number>()), 1600);
    return () => window.clearTimeout(timer);
  }, [windowed.data]);

  const newestFallback = usingFallback
    ? (fallback.data ?? []).reduce<string | null>(
        (acc, r) => (r.published_at && (!acc || r.published_at > acc) ? r.published_at : acc),
        null,
      )
    : null;

  // One definition of "high" on the screen: the ≥3.5 band the filter chip uses (review P3-2).
  const highImpact = highImpactCount(feed);
  const windowLabel = WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}H`;

  const calendar = useCalendar(30);
  const calendarEmpty = calendar.isSuccess && (calendar.data?.length ?? 0) === 0;
  // Read once the window has answered (the hero's fallback, the toggle's
  // Recent view and the calendar panel's "Recent releases" block all use it).
  const recent = useCalendarRecent(10, calendarEmpty || view === "recent" || calendar.isSuccess);
  const usingCalFallback = calendarEmpty && (recent.data?.length ?? 0) > 0;
  // Large-cap earnings for the hero timeline only (Iteration 1, N1): the
  // `kind === "earnings"` rows of the same 30-day window, drawn beside the
  // macro rows `useCalendar` serves (and the snapshot carries). Until the
  // pipeline stores any, the timeline is simply the macro one.
  const earnings = useCalendarEarnings(30);
  const earningsRows = useMemo(() => (earnings.data ?? []).filter(isEarnings), [earnings.data]);
  const freshness = useFreshness();
  const { openFreshness } = useShellActions();
  // One identity per settled state, so a palette jump or the hero's hash
  // actions land after the rows mount and the calendar view settles.
  const hashReady = useMemo(() => [shown.length, view] as const, [shown.length, view]);
  useHashScroll(hashReady);

  /* ── priority developments: top of the feed by significance ─────────── */
  const newestPublished = feed.reduce<string | null>(
    (acc, r) => (r.published_at && (!acc || r.published_at > acc) ? r.published_at : acc),
    null,
  );
  const feedClock = assessFreshness(newestPublished, "hourly");
  // The stored stamp is UTC: it renders as ET wall time, never "ET" appended
  // to the UTC digits (format.ts, 2026-09-05), so the chip, the strip and the
  // row clocks read one clock.
  const feedFresh = newestPublished ? { ...feedClock, stamp: fmtUtcStampEt(newestPublished) } : feedClock;
  // The served SLA verdict wins when /api/freshness carries the news row, so
  // the strip agrees with the drawer's "News feed" line (G13); the client
  // clock covers snapshot mode and older payloads.
  const slaNews = freshness.data?.sla?.find((r) => r.feed === "news");
  const feedInfo = mergeFeedVerdict(feedFresh, slaNews);
  const ranked = useMemo(
    () => [...feed].sort((x, y) => (y.overall_significance ?? 0) - (x.overall_significance ?? 0)),
    [feed],
  );
  const priority = ranked.slice(0, PRIORITY_N);
  const priorityIds = new Set(priority.map((r) => r.id));
  const rest = shown.filter((r) => !priorityIds.has(r.id));
  const restShown = showAll ? rest : rest.slice(0, 8);
  const topSig = priority[0]?.overall_significance ?? null;

  const now = Date.now();
  const events = calendar.data ?? [];
  const timelineEvents = useMemo(() => {
    if (!earningsRows.length) return events;
    const ids = new Set(events.map((e) => e.id));
    return [...events, ...earningsRows.filter((e) => !ids.has(e.id))];
  }, [events, earningsRows]);
  const recentRows = recent.data ?? [];
  const focus = nextFocusEvent(calendar.data);
  const calError = calendar.isError && !calendar.data;
  // The empty window's stand-in rows are part of the read: the hero keeps
  // reading until they answer too.
  const calLoading = (calendar.isLoading && !calendar.data) || (calendarEmpty && recent.isLoading && !recent.data);

  const feedLoading = (windowed.isLoading && !windowed.data) || (windowedEmpty && fallback.isLoading && !fallback.data);
  const feedError = windowed.isError && !windowed.data && fallback.isError;
  const feedState = feed.length ? "ready" : feedError ? "error" : feedLoading ? "loading" : "empty";
  const capped = (windowed.data?.length ?? 0) >= 150;
  const checked = windowed.dataUpdatedAt
    ? new Date(windowed.dataUpdatedAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })
    : "";

  /* ── hero (B.1) ──────────────────────────────────────────────────────── */
  const lead = leadSentence(priority[0], usingFallback, feedLoading);
  // G4: the lede stays at three sentences or fewer by construction, counted
  // on the whole paragraph (a headline quoted in the lead sentence can carry
  // a sentence of its own); the rest, verbatim, sits behind the hero's
  // Details, and the stored interpretation also reads in full on the lead
  // card's AI read.
  const why = whySentence(priority[0], usingFallback);
  const ledeParts = takeSentences(why ? `${lead} ${why}` : lead, 3);
  const footnote: ReactNode[] = [
    usingFallback ? coverageValue(feed, windowLabel, usingFallback, newestFallback, feedFresh.age) : `${feed.length} headlines in ${windowLabel}`,
    ...(calendar.data ? [usingCalFallback ? "stored schedule" : `${events.length} events in the next 30 days`] : []),
    ...(checked ? [`Feed checked ${checked} ET`] : []),
  ];
  const heroShared = {
    id: "news-hero",
    eyebrow: "Next on the calendar",
    live: !usingFallback && feedInfo.state === "current",
    lede: ledeParts.shown,
    ledeMore: ledeParts.rest || undefined,
    actions: HERO_ACTIONS,
    footnote,
    // On a phone the header's freshness words sit one screen above; the hero
    // does not repeat them (03 B.1).
    freshness: isMobile
      ? undefined
      : [
          { noun: "Newest headline", info: feedInfo },
          { noun: "Calendar", info: assessFreshness(null, "reference") },
        ],
    note: "Feed rechecks every 60s; the pipeline scores and stores new headlines hourly.",
  };
  let hero: ReactNode;
  if (focus) {
    const pill = heroPill(focus);
    hero = (
      <TabHero
        {...heroShared}
        headline={countdownHeadline(focus, now)}
        pill={pill.text}
        pillTone={pill.tone}
        glow={pill.glow}
        subhead={heroSubhead(events, now)}
        chart={<EventTimeline events={timelineEvents} now={now} />}
      />
    );
  } else if (calError) {
    const pill = heroPill(null, "unavailable");
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>Calendar unavailable: the data service did not answer.</span>}
        pill={pill.text}
        pillTone={pill.tone}
        glow={pill.glow}
        placeholder
      />
    );
  } else if (calLoading) {
    hero = <TabHero {...heroShared} headline={<span style={stateHeadline}>Reading the calendar…</span>} glow={NEWS_GLOW.gray} placeholder />;
  } else if (usingCalFallback) {
    const pill = heroPill(null, "fallback");
    const end = recentRows[0].event_datetime;
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>No events in the next 30 days</span>}
        pill={pill.text}
        pillTone={pill.tone}
        glow={pill.glow}
        subhead={`The calendar snapshot ends ${fmtDate(end)}; the most recent ${recentRows.length} scheduled events are listed below.`}
        chart={<EventTimeline events={earningsRows} now={now} fallbackEnd={end} />}
      />
    );
  } else {
    hero = (
      <TabHero
        {...heroShared}
        headline={<span style={stateHeadline}>No events on file</span>}
        glow={NEWS_GLOW.gray}
        chart={<EventTimeline events={earningsRows} now={now} />}
      />
    );
  }

  /* ── summary rows (B.2) ──────────────────────────────────────────────── */
  const calNote = calError ? <StateNote error /> : <StateNote loading />;
  const feedNote = feedState === "error" ? <StateNote error /> : <StateNote loading />;
  const calPending = calLoading || calError;
  const nextEvent: ReactNode = events[0] ? (
    eventLine(events[0])
  ) : usingCalFallback ? (
    <>
      {eventLine(recentRows[0])}
      <span style={{ color: "var(--text-3)" }}> · elapsed</span>
    </>
  ) : calPending ? (
    calNote
  ) : (
    "No events in the next 30 days"
  );
  const afterThat: ReactNode = events[1] ? eventLine(events[1]) : calPending ? calNote : "No second event in the window";
  const topValue = topSignificanceValue(topSig, priority[0]?.category ?? null);
  // Iteration 1 (N2): the desk summary fills its height with served rows
  // only. The hero's countdown event with its date when it is not already one
  // of the first two rows; the newest past release; the stories counted by
  // category, by outlet and by whether they carry a stored AI read. Each is omitted when
  // there is nothing to count, never blank.
  const focusIsHigh = focus != null && impactOf(focus.importance).word === "high impact";
  const nextHigh = focusIsHigh && focus !== events[0] && focus !== events[1] ? eventLine(focus) : null;
  const lastRelease = !usingCalFallback && recentRows[0] ? eventLine(recentRows[0]) : null;
  const feedReady = feedState === "ready";
  const categoryMix = feedReady ? categoryMixValue(feed) : null;
  const aiReads = feedReady ? aiReadValue(feed) : null;
  const outlets = feedReady ? outletsValue(feed) : null;

  const rows: SummaryRow[] = [
    { id: "next-event", label: "Next event", value: nextEvent },
    { id: "after-that", label: "After that", value: afterThat },
    ...(nextHigh ? [{ id: "next-high", label: "Next high impact", value: nextHigh }] : []),
    ...(lastRelease ? [{ id: "last-release", label: "Last release", value: lastRelease }] : []),
    // Row 3, Consensus / prior, is never rendered: nothing serves consensus (F1).
    {
      id: "coverage",
      label: "Coverage",
      value: feedState === "loading" || feedState === "error" ? feedNote : coverageValue(feed, windowLabel, usingFallback, newestFallback, feedFresh.age),
      tone: usingFallback ? "var(--warn-hot)" : undefined,
    },
    ...(categoryMix ? [{ id: "by-category", label: "By category", value: categoryMix }] : []),
    ...(outlets ? [{ id: "outlets", label: "Outlets", value: outlets }] : []),
    ...(aiReads ? [{ id: "ai-reads", label: "AI reads", value: aiReads }] : []),
    ...(topValue != null ? [{ id: "top-significance", label: "Top significance", value: topValue }] : []),
    { id: "high-impact", label: "High impact", value: feedState === "loading" || feedState === "error" ? feedNote : highImpactValue(feed) },
  ];

  /* ── status strip: feed health, opening the freshness drawer ─────────── */
  const health = feedHealth({ usingFallback, loading: windowed.isLoading && !windowed.data, feedInfo, feed, newestFallback });
  const strip: StatusStripProps = {
    ...health,
    onClick: openFreshness,
    ariaHasPopup: "dialog",
    ariaLabel: [`${health.title}.`, `${health.detail}.`, slaNews?.reason, STRIP_SUFFIX].filter(Boolean).join(" "),
  };

  return (
    <div className="mrr-news">
      {/* ── Hero row ────────────────────────────────────────────────── */}
      <div className="mrr-hero-row">
        {hero}
        <SummaryCard id="news-summary" as="h2" title="Desk summary" rows={rows} status={strip} />
      </div>

      <div className="mrr-news-body">
        <div className="mrr-news-stack">
          {/* ── Priority headlines ───────────────────────────────────── */}
          <Card as="section" id="headlines" variant="panel" style={{ minWidth: 0 }}>
            <SectionHeader
              layout="panel"
              as="h2"
              /* Older stored stories are not "priority developments": when the
                 window is empty the section says what it is showing (2026-09-06). */
              title={usingFallback ? "Latest stored headlines" : "Priority headlines"}
              description={usingFallback ? "Most recent stored stories, significance filter not applied" : `Ranked by significance, last ${windowLabel}`}
              right={`${priority.length} of ${feed.length} · by significance${usingFallback ? " · outside the selected window" : ""}`}
              actions={
                <Link className="mrr-link" to="/app/methodology#ramps">
                  How scoring works →
                </Link>
              }
            />
            {usingFallback ? (
              <Card accentBar tone="watch" style={{ marginBottom: 12 }}>
                <Caption style={{ marginTop: 0, color: "var(--text-2)" }}>
                  No{cat ? ` ${CATEGORY_WORD[cat] ?? cat}` : ""} headlines in the last {windowLabel}
                  {minSig ? ` at significance ≥ ${minSig}` : ""}; the {feed.length} most recent stored stories follow, significance
                  filter not applied.
                </Caption>
              </Card>
            ) : null}
            {priority.length ? (
              <div className="mrr-news-lead">
                {priority.map((item) => (
                  <NewsCard
                    key={item.id}
                    variant="lead"
                    {...cardProps(item)}
                    time={timeLabel(item.published_at)}
                    dims={[
                      ["Market impact", item.market_impact],
                      ["Regime relevance", item.regime_relevance],
                      ["Sector reach", item.sector_relevance],
                      ["Timeliness at ingest", item.time_sensitivity],
                    ]}
                    stale={usingFallback}
                  />
                ))}
              </div>
            ) : (
              <Card variant="tile">
                <StateNote loading={feedState === "loading"} error={feedState === "error"}>
                  Nothing on file; the news pipeline runs hourly (minute 41 UTC) and has not stored headlines yet.
                </StateNote>
              </Card>
            )}
          </Card>

          {/* ── More headlines: the filter bar, the count tiles, the rows ── */}
          <Card as="section" id="feed" variant="panel" style={{ minWidth: 0 }}>
            <SectionHeader
              layout="panel"
              as="h2"
              title="More headlines"
              description={usingFallback ? `${feed.length} most recent stored` : `${feed.length}${capped ? "+" : ""} in the last ${windowLabel}`}
              right={
                `Finnhub · NewsAPI · RSS · sorted by ${usingFallback ? "recency (fallback)" : "significance"}` +
                (checked ? ` · checked ${checked} ET` : "") +
                (newThisSession > 0 ? ` · ${newThisSession} new this session` : "")
              }
            />
            <fieldset className="mrr-news-filters">
              <legend className="sr-only">Filters</legend>
              <fieldset>
                <legend className="sr-only">Window</legend>
                <Segmented mono label="Window" options={WINDOW_OPTIONS} value={String(hours)} onChange={(id) => setHours(Number(id))} />
              </fieldset>
              <span aria-hidden="true" className="mrr-news-divider" />
              <fieldset>
                <legend className="sr-only">Category</legend>
                <Segmented mono label="Category" options={CATEGORY_OPTIONS} value={cat ?? "all"} onChange={(id) => setCat(id === "all" ? null : id)} />
              </fieldset>
              <span aria-hidden="true" className="mrr-news-divider" />
              <fieldset>
                <legend className="sr-only">Significance</legend>
                <Segmented
                  mono
                  label="Significance"
                  options={SIG_OPTIONS}
                  value={minSig == null ? "any" : String(minSig)}
                  onChange={(id) => setMinSig(id === "any" ? undefined : Number(id))}
                />
              </fieldset>
            </fieldset>
            <Caption style={{ marginTop: 0, marginBottom: 12 }}>
              <Jargon term="significance">Significance</Jargon> is scored 1–5 blending market impact, deal size, sector reach,
              timeliness and regime fit; ≥4.5 reads red, ≥3.5 orange, ≥2.5 amber. Identical cross-source headlines are shown once.
            </Caption>
            <div className="mrr-news-tiles">
              <Card variant="tile" padding="10px 14px">
                <StatTile label="Headlines" value={feedState === "loading" ? DASH : `${feed.length}${capped ? "+" : ""}`} size="sm" />
              </Card>
              <Card variant="tile" padding="10px 14px">
                <StatTile label="High impact · ≥3.5" value={feedState === "loading" ? DASH : String(highImpact)} size="sm" />
              </Card>
              {(
                [
                  ["M&A", "M&A"],
                  ["Macro / Fed", "MACRO"],
                  ["Geopolitical", "GEOPOLITICAL"],
                ] as const
              ).map(([label, catKey]) => {
                const n = feed.filter((r) => r.category === catKey).length;
                return (
                  <Card key={catKey} variant="tile" padding="10px 14px">
                    <StatTile label={label} value={n ? String(n) : DASH} size="sm" />
                  </Card>
                );
              })}
            </div>
            <div className="mrr-news-rows">
              {restShown.map((item) => (
                // Wrapper carries the arrival flash so the card itself stays a
                // pure bundle component.
                <div key={item.id} className={justArrived.has(item.id) ? "mrr-news-new" : undefined}>
                  <NewsCard
                    variant="row"
                    {...cardProps(item)}
                    clock={clockEt(item.published_at)}
                    time={`${timeLabel(item.published_at)}${usingFallback ? " · stored" : ""}`}
                  />
                </div>
              ))}
            </div>
            {!restShown.length ? (
              <Caption style={{ marginTop: 8 }}>
                {feedState === "ready" ? (
                  "Every stored headline in this window is under Priority headlines."
                ) : (
                  <StateNote loading={feedState === "loading"} error={feedState === "error"} />
                )}
              </Caption>
            ) : null}
            {rest.length > restShown.length ? (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
                <button type="button" className="mrr-btn" data-touch={isNarrow ? "true" : "false"} onClick={() => setShowAll(true)}>
                  Show {Math.min(rest.length, DISPLAY_CAP) - restShown.length} more headlines
                </button>
              </div>
            ) : null}
            {feed.length > DISPLAY_CAP && showAll && (
              <Caption>
                Showing the top {DISPLAY_CAP} of {feed.length} by significance; tighten the filters to narrow the list.
              </Caption>
            )}
          </Card>
        </div>

        {/* ── Macro calendar, the right column ─────────────────────────── */}
        <CalendarPanel calendar={calendar} recent={recent} usingCalFallback={usingCalFallback} view={view} onViewChange={setView} now={now} />
      </div>

      <DisclosureLine>
        Headlines ingest hourly from Finnhub, NewsAPI and RSS wires, dedupe, then score across five dimensions · the store keeps a
        rolling window, so the feed ages out by design · calendar is maintained by hand · headlines link to the original article ·
        each hourly run sends up to 10 newly stored headlines scoring 2.5 or more to Claude for a regime interpretation and to
        Perplexity for cited research, under a $50 monthly spend cap; other headlines, and every headline once the cap is
        reached, show the wire summary · scores are model estimates.
      </DisclosureLine>
    </div>
  );
}
