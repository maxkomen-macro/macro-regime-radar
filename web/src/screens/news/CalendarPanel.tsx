/**
 * Macro calendar panel (redesign Phase 8, checklist 08 B.5): the News screen's
 * right column. Upcoming / Recent toggle, the impact legend, a day-grouped
 * DataTable (time, impact dot, event, source), the stored-schedule callout
 * when the 30-day window is empty, the 12-row cap with "Show all", the
 * "Recent releases" block and the hand-maintained caption. The screen owns
 * the two calendar queries and the view state; this panel only renders them.
 *
 * Impact colours come from shared/calendar-impact.ts, the table the Dashboard
 * card paints from, so the legend can never drift from the rows. Times are the
 * hand-maintained UTC stamps rendered as ET wall time (`splitStamp`).
 */

import { useMemo, useState, type ReactNode } from "react";
import { Card, DataTable, SectionHeader, Segmented } from "../../components";
import type { CalendarEvent } from "../../api/types";
import { fmtDate } from "../../lib/format";
import { useBreakpoint } from "../../lib/useBreakpoint";
import { IMPACT, impactOf, splitStamp } from "../shared/calendar-impact";
import ScrollTable from "../shared/ScrollTable";
import { Caption, StateNote, metaStyle, mono } from "../shared/screen-ui";
import { dayGroups } from "./news-copy";
import type { CalendarPanelProps, CalendarView } from "./news-types";

/** The upcoming view prints this many rows before "Show all {n} events". */
const UPCOMING_CAP = 12;

const VIEW_OPTIONS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "recent", label: "Recent" },
];

/** Legend entries in the order the vocabulary reads: high, medium, low. The
 * low swatch is the checklist's #6f7d8a (the hero timeline's low colour);
 * the rows themselves paint low from calendar-impact.ts (`--text-4`), one
 * shade darker, until the design lead settles the two grays on one value. */
const LEGEND: Array<[string, string]> = [
  ["High", IMPACT.high.color],
  ["Medium", IMPACT.medium.color],
  ["Low", "#6f7d8a"],
];

const NOTE_CELL = { ...mono, fontSize: 11.5, color: "var(--text-3)" } as const;

function columnsFor(elapsed: boolean, narrow: boolean) {
  return [
    {
      key: "time",
      label: "Time",
      width: "62px",
      mono: true,
      render: (e: CalendarEvent) => <span style={{ ...NOTE_CELL, whiteSpace: "nowrap" }}>{splitStamp(e.event_datetime)[1]}</span>,
    },
    {
      key: "impact",
      label: <span className="sr-only">Impact</span>,
      width: "14px",
      render: (e: CalendarEvent) => {
        const impact = impactOf(e.importance);
        // Elapsed rows never wear live priority colours; the word says so.
        return (
          <>
            <span
              aria-hidden="true"
              className="mrr-cal-dot"
              data-importance={e.importance ?? "none"}
              title={impact.word}
              style={{ width: 8, height: 8, borderRadius: "50%", background: elapsed ? "var(--text-4)" : impact.color, display: "inline-block" }}
            />
            <span className="sr-only">{elapsed ? `${impact.word}, elapsed` : impact.word}</span>
          </>
        );
      },
    },
    {
      key: "event",
      label: "Event",
      // The flexible column: every other column sits at its content width.
      width: "100%",
      // The one cell allowed to wrap: a long served name ("GDP Third Estimate
      // Q2 2026") takes a second line instead of pushing the 432px column into
      // a horizontal scroller (every other cell keeps the table's nowrap).
      render: (e: CalendarEvent) => (
        <span style={{ display: "block", fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--text)", whiteSpace: "normal", minWidth: 0 }}>
          {e.event_name}
        </span>
      ),
    },
    {
      key: "source",
      label: "Source",
      align: "right" as const,
      width: "96px",
      mono: true,
      // Below 768 the source may break at its hyphen so the event name keeps
      // the column width a phone can give it.
      render: (e: CalendarEvent) => (
        <span style={{ ...NOTE_CELL, whiteSpace: narrow ? "normal" : "nowrap", display: narrow ? "block" : undefined }}>
          {e.source === "manual_csv" ? "hand-maintained" : (e.source ?? "—")}
        </span>
      ),
    },
  ];
}

export default function CalendarPanel({ calendar, recent, usingCalFallback, view, onViewChange, now }: CalendarPanelProps): JSX.Element {
  const { isNarrow } = useBreakpoint();
  const [showAll, setShowAll] = useState(false);

  const upcomingRows = calendar.data ?? [];
  const recentRows = recent.data ?? [];
  const calendarEmpty = calendar.isSuccess && upcomingRows.length === 0;

  // Which served rows the table shows, and whether they are elapsed (the
  // recent view, or the stored-schedule fallback standing in for an empty window).
  let rows: CalendarEvent[] = [];
  let elapsed = false;
  if (view === "recent") {
    rows = recentRows;
    elapsed = true;
  } else if (upcomingRows.length) {
    rows = upcomingRows;
  } else if (usingCalFallback) {
    rows = recentRows;
    elapsed = true;
  }

  const capped = view === "upcoming" && !elapsed && !showAll && rows.length > UPCOMING_CAP;
  const visible = capped ? rows.slice(0, UPCOMING_CAP) : rows;
  const label = elapsed ? "Recent macro events" : "Upcoming macro events";

  const columns = useMemo(() => columnsFor(elapsed, isNarrow), [elapsed, isNarrow]);
  const groups = useMemo(
    () =>
      dayGroups(visible, now, elapsed).map((g) => ({
        key: g.key,
        label: (
          <>
            <span style={{ color: "var(--text-2)" }}>{g.label}</span>
            {g.marker ? (
              <span style={{ color: g.markerColor, fontWeight: /TODAY/.test(g.marker) ? 700 : 400, whiteSpace: "nowrap" }}>{g.marker}</span>
            ) : null}
          </>
        ),
        rows: g.rows,
      })),
    [visible, now, elapsed],
  );

  const loading = view === "recent" ? recent.isLoading : calendar.isLoading || (calendarEmpty && recent.isLoading);
  const error = view === "recent" ? recent.isError && !recent.data : calendar.isError && !calendar.data;

  let body: ReactNode;
  if (rows.length) {
    body = (
      <>
        <ScrollTable stickyFirst={false} label={label}>
          <DataTable compact zebra={false} caption={label} columns={columns} groups={groups} />
        </ScrollTable>
        {capped ? (
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <button type="button" className="mrr-btn" data-touch={isNarrow ? "true" : "false"} onClick={() => setShowAll(true)}>
              Show all {rows.length} events
            </button>
          </div>
        ) : null}
      </>
    );
  } else if (loading) {
    body = <StateNote loading />;
  } else if (error) {
    body = <StateNote error />;
  } else {
    body = <StateNote>No events on file.</StateNote>;
  }

  const right =
    view === "recent" ? (
      "last 10 on file"
    ) : usingCalFallback ? (
      <>
        <span>next 30 days</span> · <span>stored schedule</span>
      </>
    ) : (
      "next 30 days"
    );

  const showRecentBlock = view === "upcoming" && !usingCalFallback && recentRows.length > 0;

  return (
    <Card as="section" variant="panel" id="calendar" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <SectionHeader
        layout="panel"
        as="h2"
        title="Macro calendar"
        right={right}
        actions={<Segmented label="Calendar view" value={view} onChange={(id) => onViewChange(id as CalendarView)} options={VIEW_OPTIONS} />}
      />
      {/* Literal spaces between the flex items: the legend reads "Impact High
          Medium Low ET" as text, not one run-together word. */}
      <div className="mrr-cal-legend">
        <span style={metaStyle}>Impact</span>{" "}
        {LEGEND.map(([word, color]) => (
          <span key={word} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <i aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
            <span style={metaStyle}>{word}</span>{" "}
          </span>
        ))}
        <span style={{ ...metaStyle, marginLeft: "auto" }}>ET</span>
      </div>
      {usingCalFallback && view === "upcoming" ? (
        <Card accentBar tone="watch" style={{ marginBottom: 10 }}>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-caption)", color: "var(--text-2)", lineHeight: 1.55 }}>
            <span style={{ color: "var(--amber)", fontWeight: 600 }}>Stored schedule. </span>
            No upcoming events in the stored window; the calendar snapshot ends{" "}
            {recent.data?.[0] ? fmtDate(recent.data[0].event_datetime) : "—"}; showing the most recent{" "}
            {recent.data?.length ?? 0} scheduled events instead.
          </span>
        </Card>
      ) : null}
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        {body}
        {showRecentBlock ? (
          /* One block: the h3, its meta and the rows share a parent (the
             heading's parent is the block), laid out as a two-column grid
             with the list spanning both columns. */
          <div style={{ marginTop: 22, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", columnGap: 12 }}>
            <SectionHeader level="sub" as="h3" title="Recent releases" style={{ margin: 0 }} />
            <span style={{ ...metaStyle, fontSize: 10, textAlign: "right" }}>most recent 3</span>
            <ul style={{ gridColumn: "1 / -1", margin: "6px 0 0", padding: 0, listStyle: "none" }}>
              {recentRows.slice(0, 3).map((e) => (
                <li
                  key={e.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "52px minmax(0,1fr)",
                    gap: 8,
                    alignItems: "center",
                    minHeight: 36,
                    borderBottom: "1px solid var(--line-2)",
                  }}
                >
                  <span style={{ ...NOTE_CELL, whiteSpace: "nowrap" }}>{splitStamp(e.event_datetime)[0]}</span>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--text)", minWidth: 0 }}>{e.event_name}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <Caption style={{ marginTop: 10 }}>
        FOMC meetings, CPI, jobs and GDP prints from the hand-maintained schedule; high-priority rows are the ones that can move
        the regime call.
      </Caption>
    </Card>
  );
}
