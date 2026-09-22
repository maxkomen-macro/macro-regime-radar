import type { CalendarEvent } from "../../api/types";
import type { useCalendar, useCalendarRecent } from "../../api/queries";

export type CalendarView = "upcoming" | "recent";

/** The calendar panel reads the two calendar queries the screen owns (checklist 08 B.5). */
export interface CalendarPanelProps {
  calendar: ReturnType<typeof useCalendar>;
  recent: ReturnType<typeof useCalendarRecent>;
  /** The upcoming window is empty and stored recent rows stand in. */
  usingCalFallback: boolean;
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  /** Epoch ms of "now" (the screen's clock), injected so tests are deterministic. */
  now: number;
}

/** The hero's 18-day event timeline (checklist 08 B.1). */
export interface EventTimelineProps {
  events: CalendarEvent[];
  now: number;
  /** ISO stamp of the stored schedule's last event when the 30-day window is empty. */
  fallbackEnd?: string;
}
