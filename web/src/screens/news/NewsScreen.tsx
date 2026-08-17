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

import { useMemo, useState } from "react";
import { Card, NewsCard, SectionHeader, StatTile, Tag } from "../../components";
import { useCalendar, useCalendarRecent, useNews, useNewsLatest } from "../../api/queries";
import type { CalendarEvent, NewsItem } from "../../api/types";
import { fmtDate } from "../../lib/format";
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
        padding: "2px 8px",
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
  return (
    <div>
      <div
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
            style={{
              display: "grid",
              gridTemplateColumns: "130px 1fr 90px 110px",
              gap: 12,
              padding: "7px 12px",
              alignItems: "baseline",
              background: i % 2 === 1 ? "rgba(255,255,255,.012)" : "transparent",
            }}
          >
            <span style={{ ...mono, fontSize: "var(--fs-body-s)", color: past ? "var(--text-muted)" : "var(--text)" }}>
              {fmtDate(e.event_datetime)}
              {past && <span style={{ color: "var(--text-muted)" }}> · elapsed</span>}
              {isToday && (
                <span style={{ color: "var(--neg-text)", fontWeight: 700 }}> · TODAY</span>
              )}
              {soon && <span style={{ color: "var(--warn)" }}> · +{deltaDays}d</span>}
            </span>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-body-s)", color: "var(--text-2)" }}>
              {e.event_name}
            </span>
            <span style={{ textAlign: "right" }}>
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
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--text-muted)", textAlign: "right" }}>
              {e.source === "manual_csv" ? "hand-maintained" : (e.source ?? "—")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function NewsScreen() {
  const [hours, setHours] = useState<number>(168);
  const [cat, setCat] = useState<string | null>(null);
  const [minSig, setMinSig] = useState<number | undefined>(undefined);

  // Category filters server-side (mirrors the Streamlit loader), so the
  // latest-available fallback fires for ANY empty filter combination — an
  // empty category inside a busy window still gets dated headlines.
  const windowed = useNews(hours, minSig, 150, cat ?? undefined);
  const windowedEmpty = windowed.isSuccess && (windowed.data?.length ?? 0) === 0;
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
      const key = r.headline.trim().toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [usingFallback, fallback.data, windowed.data]);
  const shown = feed.slice(0, DISPLAY_CAP);

  const newestFallback = usingFallback
    ? (fallback.data ?? []).reduce<string | null>(
        (acc, r) => (r.published_at && (!acc || r.published_at > acc) ? r.published_at : acc),
        null,
      )
    : null;

  const highImpact = feed.filter((r) => (r.overall_significance ?? 0) >= 4).length;
  const windowLabel = WINDOWS.find((w) => w.hours === hours)?.label ?? `${hours}H`;

  const calendar = useCalendar(30);
  const calendarEmpty = calendar.isSuccess && (calendar.data?.length ?? 0) === 0;
  const recentEvents = useCalendarRecent(10, calendarEmpty);
  const usingCalFallback = calendarEmpty && (recentEvents.data?.length ?? 0) > 0;
  useHashScroll(shown.length);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── Headlines ─────────────────────────────────────────────────── */}
      <section id="headlines">
        <SectionHeader
          title="Headlines"
          right={`Finnhub · NewsAPI · RSS · sorted by ${usingFallback ? "recency (fallback)" : "significance"}`}
        />

        {/* Summary counters — "+" marks a capped fetch, and a zero category
            renders as an em dash so it reads "none filed", not "broken". */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12 }}>
          <StatTile
            label="Headlines"
            value={`${feed.length}${(windowed.data?.length ?? 0) >= 150 ? "+" : ""}`}
            size="sm"
          />
          <StatTile label="High impact · ≥4" value={String(highImpact)} size="sm" />
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

        {/* Filter bar */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
          {CATEGORIES.map((c) => (
            <Chip key={c.label} active={cat === c.value} onClick={() => setCat(c.value)}>
              {c.label}
            </Chip>
          ))}
          <span style={{ width: 10 }} />
          {WINDOWS.map((w) => (
            <Chip key={w.label} active={hours === w.hours} onClick={() => setHours(w.hours)}>
              {w.label}
            </Chip>
          ))}
          <span style={{ width: 10 }} />
          {SIG_FILTERS.map((s) => (
            <Chip key={s.label} active={minSig === s.min} onClick={() => setMinSig(s.min)}>
              {s.label}
            </Chip>
          ))}
        </div>
        <Caption>
          <Jargon term="significance">Significance</Jargon> is scored 1–5 blending market impact,
          deal size, sector reach, timeliness and regime fit — the readout colors at ≥4.5 red,
          ≥3.5 orange, ≥2.5 amber. The top-scored items each cycle also carry a Claude regime read
          and Perplexity-cited research. Identical cross-source headlines are shown once.
        </Caption>

        {/* Latest-available fallback notice (amber) */}
        {usingFallback && (
          <Card tone="watch" style={{ marginTop: 10 }}>
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--warn)" }}>
              No{cat ? ` ${cat}` : ""} headlines in the last {windowLabel}
              {minSig ? ` at significance ≥ ${minSig}` : ""} — latest stored coverage is{" "}
              {newestFallback ? fmtDate(newestFallback) : "—"}; showing the{" "}
              {fallback.data?.length ?? 0} most recent instead (significance filter not applied).
            </span>
          </Card>
        )}

        {/* Feed */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginTop: 12, alignItems: "start" }}>
          {shown.map((item) => (
            <NewsCard
              key={item.id}
              source={item.source ?? "—"}
              time={`${timeLabel(item.published_at)} · ${item.category ?? "—"}`}
              ticker={
                item.ticker ??
                (item.category === "M&A" && item.deal_size != null && DEAL_LABELS[item.deal_size]
                  ? DEAL_LABELS[item.deal_size]
                  : undefined)
              }
              headline={item.headline}
              summary={
                item.summary ? (
                  <span
                    style={{
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.summary}
                  </span>
                ) : undefined
              }
              significance={item.overall_significance ?? undefined}
              sigScale={5}
              interpretation={
                item.regime_interpretation?.trim()
                  ? item.regime_interpretation
                  : researchBody(item.perplexity_research)
              }
              sources={sourcesFromResearch(item.perplexity_research)}
            />
          ))}
        </div>
        {!shown.length && (
          <Card style={{ marginTop: 12 }}>
            <StateNote loading={windowed.isLoading || fallback.isLoading} error={windowed.isError}>
              Nothing on file — the news pipeline has not stored headlines yet.
            </StateNote>
          </Card>
        )}
        {feed.length > DISPLAY_CAP && (
          <Caption>
            Showing the top {DISPLAY_CAP} of {feed.length} by significance — tighten the filters to
            narrow the list.
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
            <span style={{ ...mono, fontSize: "var(--fs-meta)", color: "var(--warn)" }}>
              No upcoming events in the stored window — the calendar snapshot ends{" "}
              {recentEvents.data?.[0] ? fmtDate(recentEvents.data[0].event_datetime) : "—"}; showing
              the most recent {recentEvents.data?.length ?? 0} scheduled events instead.
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
          FOMC meetings, CPI, jobs and GDP prints from the hand-maintained schedule — high-priority
          rows are the ones that can move the regime call.
        </Caption>
      </section>

      <div style={{ ...mono, fontSize: 10, letterSpacing: ".06em", color: "var(--text-muted)" }}>
        Headlines ingest hourly from Finnhub, NewsAPI and RSS wires, dedupe, then score across five
        dimensions · the store keeps a rolling window, so the feed ages out by design · calendar is
        maintained by hand.
      </div>
    </div>
  );
}
