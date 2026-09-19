/**
 * Hero copy, the summary strip, the calendar day groups and the wire-text
 * helpers for the News & Calendar screen (redesign Phase 8, checklist 08
 * B.1, B.2, B.5). Pure: no hooks, no state, no React.
 *
 * Nothing here re-derives a stored figure: every string is a served field,
 * its formatted value, or a count of served rows. The one clock is the ET
 * calendar day (`calendar-impact.ts`), so "today" / "tomorrow" / "+{n}d"
 * never flip on a UTC midnight.
 *
 * `CATEGORY_WORD`, `DEAL_LABELS`, `decodeEntities`, `usefulSummary`,
 * `timeLabel`, `headlineKey`, `sourcesFromResearch` and `researchBody` moved
 * here verbatim from NewsScreen.tsx so the screen, the calendar panel and the
 * tests read one source.
 */

import type { CalendarEvent, NewsItem, SlaRow } from "../../api/types";
import { fmtDate, tidyProse } from "../../lib/format";
import { dayDeltaEt, dayKeyEt, impactOf, splitStamp, weekdayEt } from "../shared/calendar-impact";
import type { FreshInfo } from "../shared/freshness";
import type { StatusTone } from "../shared/SummaryCard";
import type { TabHeroPillTone } from "../shared/TabHero";
import { DASH } from "../dashboard/hero-copy";

export interface HeroPill {
  text: string;
  tone: TabHeroPillTone;
  glow: string;
}
export interface FeedHealth {
  tone: StatusTone;
  title: string;
  detail: string;
}
export interface DayGroup {
  key: string;
  label: string;
  /** " · TODAY" | " · +{n}d" | " · elapsed" | "" */
  marker: string;
  markerColor: string;
  rows: CalendarEvent[];
}

/* ── wire text (moved verbatim from NewsScreen.tsx) ───────────────────── */

/** M&A deal-size buckets (news pipeline's own labels), shown only on M&A. */
export const DEAL_LABELS: Record<number, string> = { 2: "<$1B", 3: "$1–10B", 4: "$10–50B", 5: "$50B+" };

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
export function usefulSummary(headline: string, summary: string | null): string | null {
  const s = decodeEntities(summary);
  if (!s) return null;
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const h = norm(decodeEntities(headline));
  const body = norm(s);
  if (body === h || (body.startsWith(h) && body.length - h.length < 24)) return null;
  return s;
}

/** Categories the pipeline assigns; the card wears them as a short word. */
export const CATEGORY_WORD: Record<string, string> = {
  MACRO: "Macro / Fed",
  "M&A": "M&A",
  EARNINGS: "Earnings",
  GEOPOLITICAL: "Geopolitical",
  SECTOR: "Sector",
};

/** Badge tone for a category (checklist 08 B.3 row 1): MACRO reads as
 * information, GEOPOLITICAL as a watch, everything else as reference. */
export function categoryToneOf(category: string | null | undefined): "info" | "watch" | "reference" {
  if (category === "MACRO") return "info";
  if (category === "GEOPOLITICAL") return "watch";
  return "reference";
}

export function timeLabel(iso: string | null): string {
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
export function headlineKey(headline: string): string {
  return headline.trim().toLowerCase().replace(/\s+/g, " ");
}

export function sourcesFromResearch(research: string | null): string[] {
  if (!research) return [];
  const tail = research.split("Sources:")[1];
  if (!tail) return [];
  const urls = tail.match(/https?:\/\/\S+/g) ?? [];
  return urls.slice(0, 5).map((u) => u.replace(/[),.\]]+$/, ""));
}

export function researchBody(research: string | null): string | null {
  if (!research) return null;
  const body = research.split("Sources:")[0].trim();
  return body || null;
}

/* ── hero (B.1) ───────────────────────────────────────────────────────── */

/** Glow behind the hero's right column: amber for a high-impact focus event
 * (news.html:169), gray for every other pill and for the state heroes. */
export const NEWS_GLOW = {
  amber: "rgba(245,181,46,.05)",
  gray: "rgba(200,210,220,.05)",
} as const;

const HIGH = "high impact";

/** The event the h1 speaks for: the first served event whose impact word is
 * "high impact", else the first event of the window (the API already serves
 * `event_datetime >= now` ascending), else null. */
export function nextFocusEvent(events: CalendarEvent[] | undefined): CalendarEvent | null {
  if (!events?.length) return null;
  return events.find((e) => impactOf(e.importance).word === HIGH) ?? events[0];
}

/** "{event_name} today" / "{event_name} tomorrow" / "{event_name} in {n}
 * days" by ET calendar-day delta. The served name is never abbreviated (G11).
 * A delta below zero cannot come from the window endpoint; it reads "today"
 * rather than inventing a past tense. */
export function countdownHeadline(event: CalendarEvent, now: number): string {
  const n = dayDeltaEt(event.event_datetime, now);
  if (n <= 0) return `${event.event_name} today`;
  if (n === 1) return `${event.event_name} tomorrow`;
  return `${event.event_name} in ${n} days`;
}

/** The pill beside the h1: the focus event's impact word, amber only for
 * high impact. `state` names the two calendar states that carry a pill with
 * no focus event ("Stored schedule" on the recent-rows fallback,
 * "Unavailable" when the service did not answer); a null event with no state
 * is the "No events on file" hero, which wears no pill (empty text). */
export function heroPill(event: CalendarEvent | null, state?: "fallback" | "unavailable"): HeroPill {
  if (state === "fallback") return { text: "Stored schedule", tone: "gray", glow: NEWS_GLOW.gray };
  if (state === "unavailable") return { text: "Unavailable", tone: "gray", glow: NEWS_GLOW.gray };
  if (!event) return { text: "", tone: "gray", glow: NEWS_GLOW.gray };
  const word = impactOf(event.importance).word;
  if (word === HIGH) return { text: "High impact", tone: "amber", glow: NEWS_GLOW.amber };
  if (word === "medium impact") return { text: "Medium impact", tone: "gray", glow: NEWS_GLOW.gray };
  if (word === "low impact") return { text: "Low impact", tone: "gray", glow: NEWS_GLOW.gray };
  return { text: "Impact not rated", tone: "gray", glow: NEWS_GLOW.gray };
}

/** "{A.event_name} · Wed Sep 16, 08:30 ET": the served name, the ET weekday
 * and the stored UTC stamp rendered as ET wall time. */
export function eventLine(e: CalendarEvent): string {
  return `${e.event_name} · ${weekdayEt(e.event_datetime)} ${stampEt(e.event_datetime)}`;
}

/** "Sep 16, 08:30 ET" (`fmtUtcStampEt` through the shared splitter). */
function stampEt(ts: string): string {
  const [date, time] = splitStamp(ts);
  return time ? `${date}, ${time}` : date;
}

/** The h2 composed from the first two served events (B.1): "{A} on {Wed Sep
 * 16, 08:30 ET}, then {B} on {…}." / ", then {B} the same day at {HH:MM
 * ET}." / "{A} on {…}; nothing else is scheduled in the next 30 days."; ""
 * with no events. `now` is accepted for the shared helper signature; the
 * sentence is composed from the served stamps alone. */
export function heroSubhead(events: CalendarEvent[], now: number): string {
  void now;
  const [a, b] = events;
  if (!a) return "";
  const head = `${a.event_name} on ${weekdayEt(a.event_datetime)} ${stampEt(a.event_datetime)}`;
  if (!b) return `${head}; nothing else is scheduled in the next 30 days.`;
  if (dayKeyEt(a.event_datetime) === dayKeyEt(b.event_datetime)) {
    return `${head}, then ${b.event_name} the same day at ${splitStamp(b.event_datetime)[1]}.`;
  }
  return `${head}, then ${b.event_name} on ${weekdayEt(b.event_datetime)} ${stampEt(b.event_datetime)}.`;
}

/** N2 verbatim (NewsScreen.tsx:489-499): the lead story's sentence, the
 * loading line while the windowed feed is still reading, else the empty line. */
export function leadSentence(item: NewsItem | undefined, usingFallback: boolean, loading = false): string {
  if (item) {
    return `${item.category ? (CATEGORY_WORD[item.category] ?? item.category) : "One story"} leads the ${
      usingFallback ? "stored file" : "file"
    }: ${decodeEntities(item.headline)} at ${(item.overall_significance ?? 0).toFixed(1)} / 5, the ${
      usingFallback ? "stored window's" : "window's"
    } highest score.`;
  }
  return loading ? "Reading the stored headline feed…" : "No headlines on file.";
}

/** N3 verbatim (NewsScreen.tsx:500-508): the top story's interpretation,
 * else the sentence that says none was stored; "" with no story. */
export function whySentence(item: NewsItem | undefined, usingFallback: boolean): string {
  if (!item) return "";
  if (item.regime_interpretation?.trim()) return tidyProse(decodeEntities(item.regime_interpretation));
  return `The highest-scored story on file (significance ${(item.overall_significance ?? 0).toFixed(1)} / 5)${
    usingFallback ? "; it is stored fallback coverage, not today's tape" : ""
  }. No model interpretation was stored for it, so the score is the only editorial claim made here.`;
}

/* ── summary rows (B.2) ───────────────────────────────────────────────── */

/** Row 4: "{n} stories in {window}", or the N4 stale string verbatim
 * (NewsScreen.tsx:460) on the fallback. */
export function coverageValue(feed: NewsItem[], windowLabel: string, usingFallback: boolean, newestFallback: string | null, age: string | null): string {
  if (usingFallback) {
    return `Stale: no headlines in ${windowLabel}; newest stored ${newestFallback ? fmtDate(newestFallback) : DASH} (${age || DASH} old)`;
  }
  return `${feed.length} stories in ${windowLabel}`;
}

/** The one definition of "high" on the screen: the ≥3.5 band the filter chip
 * and the count tile share (review P3-2). */
export function highImpactCount(feed: NewsItem[]): number {
  return feed.filter((r) => (r.overall_significance ?? 0) >= 3.5).length;
}

/** Row 6: "{n} headlines scored 3.5 or higher". */
export function highImpactValue(feed: NewsItem[]): string {
  const n = highImpactCount(feed);
  return `${n} headline${n === 1 ? "" : "s"} scored 3.5 or higher`;
}

/** Iteration 1 (N2) "By category": the rendered stories counted by their
 * served category, largest first, in the card's category words ("Macro / Fed
 * 98 · M&A 20 · Geopolitical 6"); uncategorised rows count as "Other". Null
 * with no story on file. */
export function categoryMixValue(feed: NewsItem[]): string | null {
  if (!feed.length) return null;
  const counts = new Map<string, number>();
  for (const r of feed) {
    const word = r.category ? (CATEGORY_WORD[r.category] ?? r.category) : "Other";
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word, n]) => `${word} ${n}`)
    .join(" · ");
}

/** Iteration 1 (N2) "Outlets": the distinct served sources and the three
 * with the most stories ("33 outlets · CNBC 41 · MarketWatch 22 · …"); null
 * when no story carries a source. */
export function outletsValue(feed: NewsItem[]): string | null {
  const counts = new Map<string, number>();
  for (const r of feed) if (r.source) counts.set(r.source, (counts.get(r.source) ?? 0) + 1);
  if (!counts.size) return null;
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  return `${counts.size} outlet${counts.size === 1 ? "" : "s"} · ${top.map(([s, n]) => `${s} ${n}`).join(" · ")}`;
}

/** A story carries a stored AI read: Claude's interpretation, Perplexity's
 * research, or both (N4). */
export function hasAiRead(r: NewsItem): boolean {
  return Boolean(r.regime_interpretation?.trim() || r.perplexity_research?.trim());
}

/** Iteration 1 (N2) "AI reads": how many rendered stories carry a stored AI
 * read against the wire summaries; null with no story on file. */
export function aiReadValue(feed: NewsItem[]): string | null {
  if (!feed.length) return null;
  const n = feed.filter(hasAiRead).length;
  if (n === 0) return `None of the ${feed.length} carries an AI read`;
  if (n === feed.length) return `All ${n} carry an AI read`;
  return `${n} of ${feed.length} carry an AI read`;
}

/** Row 5 verbatim (NewsScreen.tsx:466); null while no story is on file, so
 * the row is omitted. `cat` is the top story's own category. */
export function topSignificanceValue(topSig: number | null, cat: string | null): string | null {
  if (topSig == null) return null;
  return `${topSig.toFixed(1)} / 5 · ${cat ? (CATEGORY_WORD[cat] ?? cat) : "uncategorised"}`;
}

/** Filled dots out of five for a 1 to 5 score: round-half-down, so 2.5 fills
 * two and 2.6 three (the mockup's lead cards). */
export function filledDots(x: number | null | undefined): number {
  if (x == null || Number.isNaN(x)) return 0;
  return Math.min(5, Math.max(0, Math.ceil(x - 0.5)));
}

/** The ET clock of a stored stamp, "15:41 ET" (the time part of
 * `fmtUtcStampEt`; zone-less stamps are UTC); "" when the stamp is unusable. */
export function clockEt(ts: string | null | undefined): string {
  if (!ts) return "";
  return splitStamp(ts)[1];
}

/** Distinct non-null `source` values in the rendered feed (F3: a count of
 * served rows, not a served figure). */
export function sourceCount(feed: NewsItem[]): number {
  return new Set(feed.map((i) => i.source).filter(Boolean)).size;
}

/** One feed clock for the strip, the chip and the live dot (G13): the served
 * SLA verdict wins when `/api/freshness` carries the `news` row; the client
 * `hourly` assessment covers snapshot mode and older payloads. */
export function mergeFeedVerdict(feedFresh: FreshInfo, sla: SlaRow | null | undefined): FreshInfo {
  if (!sla) return feedFresh;
  const state = sla.verdict;
  return { ...feedFresh, state, word: state.charAt(0).toUpperCase() + state.slice(1) };
}

/** The status strip words (B.2 table): fallback first, then the reading
 * state, then the feed clock. Iteration 1 step 5 (G4): the detail is one line
 * at 390 px; the outlet count is the Outlets row's and the fallback's age the
 * Coverage row's. */
export function feedHealth(args: { usingFallback: boolean; loading: boolean; feedInfo: FreshInfo; feed: NewsItem[]; newestFallback: string | null }): FeedHealth {
  const { usingFallback, loading, feedInfo, feed, newestFallback } = args;
  if (usingFallback) {
    return {
      tone: "amber",
      title: "Fallback coverage",
      detail: `${feed.length} stor${feed.length === 1 ? "y" : "ies"} · newest ${newestFallback ? fmtDate(newestFallback) : DASH}`,
    };
  }
  if (loading) return { tone: "gray", title: "Reading feed health…", detail: "Opens the data freshness breakdown" };
  switch (feedInfo.state) {
    case "current":
      return { tone: "mint", title: "Feed current", detail: `Newest headline ${feedInfo.stamp}` };
    case "delayed":
      return { tone: "amber", title: "Feed delayed", detail: `Newest ${feedInfo.stamp} · ${feedInfo.age} old` };
    case "stale":
      return { tone: "amber", title: "Feed stale", detail: `Newest ${feedInfo.stamp} · ${feedInfo.age} old` };
    default:
      return { tone: "gray", title: "Feed unavailable", detail: "No headline stamp on file" };
  }
}

/* ── calendar day groups (B.5) ────────────────────────────────────────── */

/** One group per ET calendar day, in served order; the label is "{Wed} {Sep
 * 16}" and the marker is " · TODAY" (red, day 0), " · +{n}d" (amber, one to
 * seven days out) or " · elapsed" (gray, the recent view and fallback rows). */
export function dayGroups(events: CalendarEvent[], now: number, elapsed: boolean): DayGroup[] {
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const e of events) {
    const key = dayKeyEt(e.event_datetime);
    let g = byKey.get(key);
    if (!g) {
      let marker = "";
      let markerColor = "";
      if (elapsed) {
        marker = " · elapsed";
        markerColor = "var(--text-4)";
      } else {
        const n = dayDeltaEt(e.event_datetime, now);
        if (n === 0) {
          marker = " · TODAY";
          markerColor = "var(--neg)";
        } else if (n >= 1 && n <= 7) {
          marker = ` · +${n}d`;
          markerColor = "var(--amber)";
        }
      }
      g = { key, label: `${weekdayEt(e.event_datetime)} ${splitStamp(e.event_datetime)[0]}`, marker, markerColor, rows: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.rows.push(e);
  }
  return groups;
}
