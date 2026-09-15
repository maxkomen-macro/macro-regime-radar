/**
 * Macro calendar card (redesign Phase 3, checklist 03 B.7): the next three
 * scheduled prints with the impact dot rule (amber = high, cyan = medium,
 * gray = low or unrated) and the stored-schedule fallback the News tab uses
 * when the 30-day window is empty. Times are the hand-maintained UTC stamps
 * rendered as ET wall time (`fmtUtcStampEt`), never "ET" appended to UTC
 * digits. The impact word rides in the row's accessible text, so the state
 * never depends on colour alone.
 *
 * The card owns its two hooks: `useCalendar(30)` and, only once that window
 * has answered empty, `useCalendarRecent(3)`.
 */

import { Link } from "react-router-dom";
import { Card, SectionHeader } from "../../components";
import { useCalendar, useCalendarRecent } from "../../api/queries";
import type { CalendarEvent } from "../../api/types";
import { impactOf, splitStamp } from "../shared/calendar-impact";
import { Caption, StateNote, mono } from "../shared/screen-ui";

// Impact vocabulary and the stamp splitter live in shared/calendar-impact.ts
// since Phase 8 (the News screen paints from the same table); re-exported so
// this card's callers and tests keep their imports.
export { impactOf, splitStamp } from "../shared/calendar-impact";
export type { Impact } from "../shared/calendar-impact";

function EventRow({ event, elapsed = false }: { event: CalendarEvent; elapsed?: boolean }) {
  const [date, time] = splitStamp(event.event_datetime);
  const impact = impactOf(event.importance);
  return (
    <li
      className="mrr-cal-row"
      style={{
        display: "grid",
        gridTemplateColumns: "52px 62px 10px minmax(0,1fr)",
        alignItems: "center",
        columnGap: 10,
        padding: "7px 0",
        borderBottom: "1px solid var(--line-2)",
        listStyle: "none",
        minWidth: 0,
      }}
    >
      <span style={{ ...mono, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text)" }}>
        {date}
        {elapsed ? (
          <span style={{ color: "var(--text-4)", textTransform: "none", letterSpacing: 0 }}> · elapsed</span>
        ) : null}
      </span>
      <span style={{ ...mono, fontSize: 11.5, color: "var(--text-3)", whiteSpace: "nowrap" }}>{time}</span>
      <span
        aria-hidden="true"
        className="mrr-cal-dot"
        data-importance={event.importance ?? "none"}
        title={impact.word}
        style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: impact.color }}
      />
      <span style={{ fontFamily: "var(--font-ui)", fontSize: 13.5, color: "var(--text)", minWidth: 0 }}>
        {event.event_name} <span className="sr-only">{impact.word}</span>
      </span>
    </li>
  );
}

function Rows({ events, elapsed = false }: { events: CalendarEvent[]; elapsed?: boolean }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {events.map((e) => (
        <EventRow key={e.id} event={e} elapsed={elapsed} />
      ))}
    </ul>
  );
}

export default function MacroCalendarCard() {
  const calendar = useCalendar(30);
  const recent = useCalendarRecent(3, calendar.isSuccess && calendar.data.length === 0);
  const upcoming = calendar.data?.slice(0, 3) ?? [];
  const windowEmpty = calendar.isSuccess && upcoming.length === 0;
  const fallback = windowEmpty ? (recent.data?.slice(0, 3) ?? []) : [];

  let body: React.ReactNode;
  if (upcoming.length) {
    body = <Rows events={upcoming} />;
  } else if (fallback.length) {
    body = (
      <>
        <Rows events={fallback} elapsed />
        <Caption style={{ marginTop: 8 }}>Stored schedule: no events in the next 30 days; showing the most recent scheduled events.</Caption>
      </>
    );
  } else if (calendar.isLoading || (windowEmpty && recent.isLoading)) {
    body = <StateNote loading />;
  } else if (calendar.isError) {
    body = <StateNote error />;
  } else {
    body = <StateNote>No events on file.</StateNote>;
  }

  return (
    <Card as="section" id="macro-calendar" variant="panel" style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
      <SectionHeader
        layout="panel"
        title="Macro calendar"
        actions={
          <Link className="mrr-link" to="/app/news#calendar">
            View calendar →
          </Link>
        }
      />
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>{body}</div>
      <Caption mono style={{ marginTop: 10 }}>
        Hand-maintained schedule · FOMC, CPI, jobs and GDP prints
      </Caption>
    </Card>
  );
}
