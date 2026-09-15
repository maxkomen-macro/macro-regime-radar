/**
 * News & Calendar — locked IA: headline feed (significance filter, category
 * chips, AI enrichment via NewsCard) and the macro-events calendar. Neither
 * section may ever show an empty screen: both carry the latest-available
 * fallback with an amber notice stating the newest stored date (confusion #2;
 * ports the Streamlit fix's behavior, not its code).
 *
 * Data: /api/news (windowed) → /api/news/latest (fallback);
 * /api/calendar (upcoming) → /api/calendar/recent (fallback).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card, NewsCard, SectionHeader, StatTile, Tag } from "../../components";
import DeskRead, { type LedgerItem } from "../shared/DeskRead";
import Disclosure from "../shared/Disclosure";
import ScrollTable from "../shared/ScrollTable";
import { assessFreshness } from "../shared/freshness";
import { useCalendar, useCalendarRecent, useNews, useNewsLatest } from "../../api/queries";
import type { CalendarEvent, NewsItem } from "../../api/types";
import { fmtDate, tidyProse } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import Jargon from "../shared/Jargon";
import { Caption, StateNote, mono, useHashScroll } from "../shared/screen-ui";

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

/** M&A deal-size buckets (news pipeline's own labels) — shown only on M&A. */
const DEAL_LABELS: Record<number, string> = { 2: "<$1B", 3: "$1–10B", 4: "$10–50B", 5: "$50B+" };

const DISPLAY_CAP = 50;
const PRIORITY_N = 4;

/** Wire text arrives with HTML entities baked in ("APAC&apos;s", "&amp;");
 * decode the common named and numeric forms so no markup leaks into copy. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  quot: '"',
  lt: "<",
  gt: ">",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};
export function decodeEntities(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z]+);/gi, (m, k: string) => ENTITIES[k.toLowerCase()] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** A summary that only repeats the headline (wire boilerplate, often with
 * the source name appended) adds nothing: drop it. */
function usefulSummary(headline: string, summary: string | null): string | null {
  const s = decodeEntities(summary);
  if (!s) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const h = norm(decodeEntities(headline));
  const body = norm(s);
  if (body === h || body.startsWith(h) && body.length - h.length < 24) return null;
  return s;
}

/** Categories the pipeline assigns; the card wears them as a short word. */
const CATEGORY_WORD: Record<string, string> = {
  MACRO: "Macro / Fed",
  "M&A": "M&A",
  EARNINGS: "Earnings",
  GEOPOLITICAL: "Geopolitical",
  SECTOR: "Sector",
};

function timeLabel(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const mins = Math.floor((Date.now() - t) / 60_000);
  // One clock, not two: absolute date always, relative age while recent —
  // adjacent cards flipping between "43h ago" and "Aug 04" read as two
  // different columns (critique).
  if (mins < 60) return `${fmtDate(iso)} · ${Math.max(mins, 0)}m ago`;
  if (mins < 48 * 60) return `${fmtDate(iso)} · ${Math.floor(mins / 60)}h ago`;
  return fmtDate(iso);
}

/** Story identity for the feed dedupe and the arrival counter. One definition
 * so the two can't drift: a row the dedupe drops must not count as an arrival. */
function headlineKey(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, " ");
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        appearance: "none",
        cursor: "pointer",
        background: active ? "rgba(74,158,255,.12)" : "none",
        border: active ? "0.5px solid rgba(74,158,255,.4)" : "0.5px solid var(--line-hair)",
        borderRadius: "var(--r-xs)",
        padding: "6px 10px",
        minHeight: 32,
        ...mono,
        fontSize: "var(--fs-micro)",
        letterSpacing: "var(--ls-micro)",
        textTransform: "uppercase",
        color: active ? "var(--accent)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

function sourcesFromResearch(research: string | null): string[] {
  if (!research) return [];
  const tail = research.split("Sources:")[1];
  if (!tail) return [];
  const urls = tail.match(/https?:\/\/\S+/g) ?? [];
  return urls.slice(0, 5).map((u) => u.replace(/[),.\]]+$/, ""));
}

function researchBody(research: string | null): string | null {
  if (!research) return null;
  const body = research.split("Sources:")[0].trim();
  return body || null;
}

function CalendarRows({ events, past }: { events: CalendarEvent[]; past?: boolean }) {
  const now = Date.now();
  const label = past ? "Recent macro events" : "Upcoming macro events";
  return (
    // Fixed-track table: it scrolls inside its own card under ~520px rather
    // than widening the page (the tape's convention, MarketsScreen.tsx:587).
    // Nothing in here is focusable, so the scroller takes a tab stop of its
    // own — otherwise a keyboard-only visitor can't reach the Source column.
    <ScrollTable stickyFirst={false} label={label}>
      <div role="table" aria-label={label} style={{ minWidth: 520 }}>
        <div
          role="row"
          style={{
            display: "grid",
            gridTemplateColumns: "130px 1fr 90px 110px",
            gap: 12,
            padding: "6px 12px",
            borderBottom: "1px solid var(--line-hair)",
          }}
        >
          {["Date", "Event", "Priority", "Source"].map((h, i) => (
            <span
              key={h}
              role="columnheader"
              style={{
                ...mono,
                fontSize: "var(--fs-micro)",
                textTransform: "uppercase",
                letterSpacing: "var(--ls-wide)",
                color: "var(--text-muted)",
                textAlign: i >= 2 ? "right" : "left",
              }}
            >
              {h}
            </span>
          ))}
        </div>
        {events.map((e, i) => {
          const dt = new Date(e.event_datetime).getTime();
          const deltaDays = Math.floor((dt - now) / 86_400_000);
          const isToday = !past && deltaDays === 0;
          const soon = !past && deltaDays > 0 && deltaDays <= 7;
          return (
            <div
              key={e.id}
              role="row"
              style={{
                display: "grid",
                gridTemplateColumns: "130px 1fr 90px 110px",
                gap: 12,
                padding: "7px 12px",
                alignItems: "baseline",
                background: i % 2 === 1 ? "rgba(255,255,255,.012)" : "transparent",
              }}
            >
              <span role="cell" style={{ ...mono, fontSize: "var(--fs-body-s)", color: past ? "var(--text-muted)" : "var(--text)" }}>
                {fmtDate(e.event_datetime)}
                {past && <span style={{ color: "var(--text-muted)" }}> · elapsed</span>}
                {isToday && (
                  <span style={{ color: "var(--neg-text)", fontWeight: 700 }}> · TODAY</span>
                )}
                {soon && <span style={{ color: "var(--warn)", whiteSpace: "nowrap" }}> · +{deltaDays}d</span>}
              </span>
              <span role="cell" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
                {e.event_name}
              </span>
              <span role="cell" style={{ textAlign: "right" }}>
                {/* Elapsed events don't wear live priority colors (critique). */}
                <Tag
                  tone={
                    past
                      ? "neutral"
                      : e.importance === "high"
                        ? "neg"
                        : e.importance === "medium"
                          ? "warn"
                          : e.importance === "low"
                            ? "pos"
                            : "neutral"
                  }
                  size="sm"
                >
                  {e.importance ?? "—"}
                </Tag>
              </span>
              <span role="cell" style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", textAlign: "right" }}>
                {e.source === "manual_csv" ? "hand-maintained" : (e.source ?? "—")}
              </span>
            </div>
          );
        })}
      </div>
    </ScrollTable>
  );
}

/** One priority development: headline (linked), why it matters, regime link,
 * asset / sector tag, source, time, significance. Stale rows say so. */
function PriorityCard({ item, stale }: { item: NewsItem; stale: boolean }) {
  const sig = item.overall_significance ?? 0;
  const sigColor = sig >= 4.5 ? "var(--neg-text)" : sig >= 3.5 ? "var(--warn-hot)" : sig >= 2.5 ? "var(--warn)" : "var(--text-muted)";
  const why = item.regime_interpretation?.trim()
    ? tidyProse(decodeEntities(item.regime_interpretation))
    : researchBody(item.perplexity_research)
      ? tidyProse(decodeEntities(researchBody(item.perplexity_research)))
      : usefulSummary(item.headline, item.summary);
  const dims: [string, number | null][] = [
    ["Market impact", item.market_impact],
    ["Regime relevance", item.regime_relevance],
    ["Sector reach", item.sector_relevance],
    ["Timeliness at ingest", item.time_sensitivity],
  ];
  return (
    <Card accentBar tone={sig >= 3.5 ? "watch" : "default"} style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", textTransform: "uppercase", color: "var(--text-muted)" }}>
        <span style={{ color: "var(--text-label)" }}>{item.source ?? "—"}</span>
        <span>{timeLabel(item.published_at)}</span>
        {stale ? <span style={{ color: "var(--warn-hot)" }}>stored · stale</span> : null}
        {item.category ? <span>{CATEGORY_WORD[item.category] ?? item.category}</span> : null}
        {item.ticker ? <span style={{ color: "var(--accent)" }}>{item.ticker}</span> : null}
        <span style={{ marginLeft: "auto", color: sigColor, fontWeight: 700 }}>Sig {sig.toFixed(1)} / 5</span>
      </div>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-value)", fontWeight: 500, lineHeight: 1.35, color: "var(--text)", textWrap: "pretty" }}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" style={{ color: "var(--text)", textDecorationColor: "var(--line-strong)" }}>
            {decodeEntities(item.headline)}
          </a>
        ) : (
          decodeEntities(item.headline)
        )}
      </div>
      {why ? (
        <p style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", lineHeight: 1.6, color: "var(--text-2)", margin: 0, textWrap: "pretty" }}>
          <span style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-micro)", color: item.regime_interpretation?.trim() ? "var(--accent)" : "var(--text-muted)", marginRight: 8 }}>
            {item.regime_interpretation?.trim() ? "◆ Why it matters" : "Wire summary"}
          </span>
          {why}
        </p>
      ) : null}
      <div style={{ display: "flex", gap: "4px 14px", flexWrap: "wrap", ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>
        {dims.map(([k, v]) => (
          <span key={k}>
            {k} <span style={{ color: v != null && v >= 4 ? "var(--warn)" : "var(--text-2)" }}>{v != null ? `${v.toFixed(0)} / 5` : "—"}</span>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: "var(--ls-micro)", color: "var(--accent)" }}>
            Read at {item.source ?? "source"} →
          </a>
        ) : (
          <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)" }}>No source link stored</span>
        )}
        {sourcesFromResearch(item.perplexity_research).length ? (
          <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "#a78bfa" }}>
            ◆ {sourcesFromResearch(item.perplexity_research).length} cited sources in the feed card
          </span>
        ) : null}
      </div>
    </Card>
  );
}

export default function NewsScreen() {
  // <768 the two-up feed stacks: a NewsCard is prose, and prose in a 170px
  // column is unreadable (lib/useBreakpoint.ts). Nothing else moves.
  const { isNarrow } = useBreakpoint();
  const [hours, setHours] = useState<number>(168);
  const [cat, setCat] = useState<string | null>(null);
  const [minSig, setMinSig] = useState<number | undefined>(undefined);

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
  const highImpact = feed.filter((r) => (r.overall_significance ?? 0) >= 3.5).length;
  const windowLabel = WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}H`;

  const calendar = useCalendar(30);
  const calendarEmpty = calendar.isSuccess && (calendar.data?.length ?? 0) === 0;
  const recentEvents = useCalendarRecent(10, calendarEmpty);
  const usingCalFallback = calendarEmpty && (recentEvents.data?.length ?? 0) > 0;
  useHashScroll(shown.length);

  /* ── priority developments: top of the feed by significance ─────────── */
  const newestPublished = feed.reduce<string | null>(
    (acc, r) => (r.published_at && (!acc || r.published_at > acc) ? r.published_at : acc),
    null,
  );
  const feedFresh = assessFreshness(newestPublished, "hourly");
  const ranked = useMemo(
    () => [...feed].sort((x, y) => (y.overall_significance ?? 0) - (x.overall_significance ?? 0)),
    [feed],
  );
  const priority = ranked.slice(0, PRIORITY_N);
  const priorityIds = new Set(priority.map((r) => r.id));
  const rest = shown.filter((r) => !priorityIds.has(r.id));
  const [showAll, setShowAll] = useState(false);
  const restShown = showAll ? rest : rest.slice(0, 8);
  const topSig = priority[0]?.overall_significance ?? null;
  const upcoming = (calendar.data ?? []).slice(0, 2);

  const ledger: LedgerItem[] = [
    {
      label: "Coverage",
      value: usingFallback
        ? `Stale: no headlines in ${windowLabel}; newest stored ${newestFallback ? fmtDate(newestFallback) : "—"} (${feedFresh.age} old)`
        : `${feed.length} stories in ${windowLabel} · ${highImpact} high impact (≥3.5)`,
      prose: true,
      tone: usingFallback ? "var(--warn-hot)" : "var(--text)",
    },
    ...(topSig != null
      ? [{ label: "Top significance", value: `${topSig.toFixed(1)} / 5 · ${priority[0].category ? (CATEGORY_WORD[priority[0].category] ?? priority[0].category) : "uncategorised"}` }]
      : []),
    ...(upcoming.length
      ? [
          {
            label: "Next on calendar",
            value: upcoming.map((e) => `${e.event_name} · ${fmtDate(e.event_datetime)}`).join(" · "),
            prose: true,
          },
        ]
      : []),
  ];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DeskRead
        eyebrow="Desk read · News & Calendar"
        live={!usingFallback && feedFresh.state === "current"}
        badge={
          <Tag tone={usingFallback ? "hot" : feedFresh.state === "current" ? "pos" : "warn"} size="md" uppercase={false}>
            {usingFallback ? "Fallback coverage" : `Feed ${feedFresh.word.toLowerCase()}`}
          </Tag>
        }
        conclusion={
          priority[0]
            ? `${priority[0].category ? (CATEGORY_WORD[priority[0].category] ?? priority[0].category) : "One story"} leads the ${
                usingFallback ? "stored file" : "file"
              }: ${decodeEntities(priority[0].headline)} at ${(priority[0].overall_significance ?? 0).toFixed(1)} / 5, the ${
                usingFallback ? "stored window's" : "window's"
              } highest score.`
            : windowed.isLoading
              ? "Reading the stored headline feed…"
              : "No headlines on file."
        }
        why={
          priority[0]
            ? priority[0].regime_interpretation?.trim()
              ? tidyProse(decodeEntities(priority[0].regime_interpretation))
              : `The highest-scored story on file (significance ${(priority[0].overall_significance ?? 0).toFixed(1)} / 5)${
                  usingFallback ? "; it is stored fallback coverage, not today's tape" : ""
                }. No model interpretation was stored for it, so the score is the only editorial claim made here.`
            : undefined
        }
        ledger={ledger}
        freshness={[
          { noun: "Newest headline", info: feedFresh },
          { noun: "Calendar", info: assessFreshness(null, "reference") },
        ]}
        note="Feed rechecks every 60s; the pipeline scores and stores new headlines hourly."
      />

      {/* ── Priority headlines ─────────────────────────────────────────── */}
      <section id="headlines">
        <SectionHeader
          /* Older stored stories are not "priority developments": when the
             window is empty the section says what it is showing (2026-09-06). */
          title={usingFallback ? "Latest stored headlines" : "Priority headlines"}
          right={
            `${priority.length} of ${feed.length} · by significance` +
            (usingFallback ? " · outside the selected window" : "") +
            (newThisSession > 0 ? ` · ${newThisSession} new this session` : "")
          }
        />
        {usingFallback ? (
          <Caption style={{ marginTop: -4, marginBottom: 10 }}>
            No{cat ? ` ${CATEGORY_WORD[cat] ?? cat}` : ""} headlines in the last {windowLabel}
            {minSig ? ` at significance ≥ ${minSig}` : ""}; the {feed.length} most recent stored stories follow, significance
            filter not applied.
          </Caption>
        ) : null}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))",
            gap: 12,
            alignItems: "start",
          }}
        >
          {priority.map((item) => (
            <PriorityCard key={item.id} item={item} stale={usingFallback} />
          ))}
        </div>
        {!priority.length && (
          <Card>
            <StateNote loading={windowed.isLoading || fallback.isLoading} error={windowed.isError}>
              Nothing on file; the news pipeline has not stored headlines yet.
            </StateNote>
          </Card>
        )}
      </section>

      {/* ── The rest of the feed, filters one click down ─────────────── */}
      <section id="feed">
        <SectionHeader
          title="More headlines"
          right={
            `Finnhub · NewsAPI · RSS · sorted by ${usingFallback ? "recency (fallback)" : "significance"}` +
            (windowed.dataUpdatedAt
              ? ` · checked ${new Date(windowed.dataUpdatedAt).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" })} ET`
              : "")
          }
        />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 12, marginBottom: 10 }}>
          <StatTile
            label="Headlines"
            value={`${feed.length}${(windowed.data?.length ?? 0) >= 150 ? "+" : ""}`}
            size="sm"
          />
          <StatTile label="High impact · ≥3.5" value={String(highImpact)} size="sm" />
          {(
            [
              ["M&A", "M&A"],
              ["Macro / Fed", "MACRO"],
              ["Geopolitical", "GEOPOLITICAL"],
            ] as const
          ).map(([label, catKey]) => {
            const n = feed.filter((r) => r.category === catKey).length;
            return <StatTile key={catKey} label={label} value={n ? String(n) : "—"} size="sm" />;
          })}
        </div>
        <Disclosure
          title="Filters"
          right={`${cat ? (CATEGORY_WORD[cat] ?? cat) : "all categories"} · ${windowLabel} · ${minSig ? `≥ ${minSig}` : "any significance"}`}
          defaultOpen={false}
        >
          <Card>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-micro)", color: "var(--text-muted)", marginBottom: 6 }}>Category</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {CATEGORIES.map((c) => (
                    <Chip key={c.label} active={cat === c.value} onClick={() => setCat(c.value)}>
                      {c.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-micro)", color: "var(--text-muted)", marginBottom: 6 }}>Window</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {WINDOWS.map((w) => (
                    <Chip key={w.label} active={hours === w.hours} onClick={() => setHours(w.hours)}>
                      {w.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ ...mono, fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "var(--ls-micro)", color: "var(--text-muted)", marginBottom: 6 }}>Significance</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {SIG_FILTERS.map((sf) => (
                    <Chip key={sf.label} active={minSig === sf.min} onClick={() => setMinSig(sf.min)}>
                      {sf.label}
                    </Chip>
                  ))}
                </div>
              </div>
              <Caption style={{ marginTop: 0 }}>
                <Jargon term="significance">Significance</Jargon> is scored 1–5 blending market impact, deal size, sector
                reach, timeliness and regime fit; ≥4.5 reads red, ≥3.5 orange, ≥2.5 amber. Identical cross-source
                headlines are shown once.
              </Caption>
            </div>
          </Card>
        </Disclosure>

        <div style={{ display: "grid", gridTemplateColumns: isNarrow ? "minmax(0,1fr)" : "repeat(2,minmax(0,1fr))", gap: 12, marginTop: 12, alignItems: "start" }}>
          {restShown.map((item) => (
            // Wrapper carries the arrival flash so the card itself stays a
            // pure bundle component.
            <div key={item.id} className={justArrived.has(item.id) ? "mrr-news-new" : undefined}>
              <NewsCard
                source={item.source ?? "—"}
                time={`${timeLabel(item.published_at)}${usingFallback ? " · stored" : ""} · ${item.category ? (CATEGORY_WORD[item.category] ?? item.category) : "—"}`}
                ticker={
                  item.ticker ??
                  (item.category === "M&A" && item.deal_size != null && DEAL_LABELS[item.deal_size]
                    ? DEAL_LABELS[item.deal_size]
                    : undefined)
                }
                headline={decodeEntities(item.headline)}
                href={item.url ?? undefined}
                summary={(() => {
                  const sum = usefulSummary(item.headline, item.summary);
                  return sum ? (
                    <span
                      style={{
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {sum}
                    </span>
                  ) : undefined;
                })()}
                significance={item.overall_significance ?? undefined}
                sigScale={5}
                interpretation={
                  item.regime_interpretation?.trim()
                    ? tidyProse(decodeEntities(item.regime_interpretation))
                    : (() => {
                        const body = researchBody(item.perplexity_research);
                        return body ? tidyProse(decodeEntities(body)) : body;
                      })()
                }
                sources={sourcesFromResearch(item.perplexity_research)}
              />
            </div>
          ))}
        </div>
        {rest.length > restShown.length ? (
          <div style={{ marginTop: 10 }}>
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
      </section>

      {/* ── Macro calendar ────────────────────────────────────────────── */}
      <section id="calendar">
        <SectionHeader
          title="Macro calendar"
          right={usingCalFallback ? "stored schedule" : "next 30 days"}
        />
        {usingCalFallback && (
          <Card tone="watch" style={{ marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55 }}>
              <span style={{ color: "var(--warn)", fontWeight: 600 }}>Stored schedule. </span>
              No upcoming events in the stored window; the calendar snapshot ends{" "}
              {recentEvents.data?.[0] ? fmtDate(recentEvents.data[0].event_datetime) : "—"}; showing the most recent{" "}
              {recentEvents.data?.length ?? 0} scheduled events instead.
            </span>
          </Card>
        )}
        <Card style={{ padding: 0 }}>
          {calendar.data?.length ? (
            <CalendarRows events={calendar.data} />
          ) : recentEvents.data?.length ? (
            <CalendarRows events={recentEvents.data} past />
          ) : (
            <div style={{ padding: 12 }}>
              <StateNote loading={calendar.isLoading} error={calendar.isError}>
                No events on file.
              </StateNote>
            </div>
          )}
        </Card>
        <Caption>
          FOMC meetings, CPI, jobs and GDP prints from the hand-maintained schedule; high-priority
          rows are the ones that can move the regime call.
        </Caption>
      </section>

      <div style={{ ...mono, fontSize: "var(--fs-meta)", letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Headlines ingest hourly from Finnhub, NewsAPI and RSS wires, dedupe, then score across five
        dimensions · the store keeps a rolling window, so the feed ages out by design · calendar is
        maintained by hand.
      </div>
    </div>
  );
}
