/**
 * The hero's 18-day event timeline (redesign Phase 8, checklist 08 B.1
 * "Chart"): an inline SVG on the mockup's 400x290 frame. One column per ET
 * calendar day from today, weekends shaded, a baseline with a tick and a
 * sparse day label per column, the mint NOW rail on day 0, then one stem and
 * dot per served event inside the window: height and colour by the served
 * `importance` (high amber, medium cyan, low gray), the event name beside the
 * dot, anchored away from the nearer edge. Events on one day share the x;
 * where two would land on the same height the later one is raised 14 px, and
 * the highest importance is drawn last so it sits on top.
 *
 * Three states share the axis: an empty 18 days with rows later in the
 * window names the next event; the stored-schedule fallback prints where the
 * snapshot ends; nothing on file says so. No animation.
 */

import { fmtDate } from "../../lib/format";
import { dayDeltaEt, dayKeyEt, splitStamp } from "../shared/calendar-impact";
import type { CalendarEvent } from "../../api/types";
import type { EventTimelineProps } from "./news-types";

export const DAYS = 18;
const X0 = 8;
const X1 = 392;
/** 384 / 17: the last tick lands on x 392 (news.html rounds to one decimal). */
const STEP = (X1 - X0) / (DAYS - 1);
const TOP = 30;
const BASE = 246;
const LABEL_Y = 264;
/** Labels anchor start left of centre and end right of it (B.1). */
const MID = 200;
const STACK = 14;

const WEEKEND = "rgba(255,255,255,.025)";
const AXIS = "rgba(255,255,255,.2)";
const TICK = "rgba(255,255,255,.25)";
const LABEL_0 = "#dfe6ec";
const LABEL_N = "#7d8b98";
const EVENT_TEXT = "#e9eef2";
const STATE_TEXT = "var(--text-3)";

/** Dot geometry by served importance (mockup values); anything unrated takes
 * the low height in the calendar's unrated gray. */
const DOT: Record<string, { y: number; r: number; color: string }> = {
  high: { y: 96, r: 5, color: "var(--amber)" },
  medium: { y: 150, r: 4, color: "var(--cyan)" },
  low: { y: 190, r: 4, color: "#6f7d8a" },
};
const DOT_UNRATED = { y: 190, r: 4, color: "var(--text-4)" };
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

const f1 = (n: number) => n.toFixed(1);
const x = (day: number) => X0 + day * STEP;

interface Placed {
  event: CalendarEvent;
  day: number;
  y: number;
  r: number;
  color: string;
}

/** The ET calendar day `i` days after `now`, as "YYYY-MM-DD"; the arithmetic
 * is on calendar days, so DST changes never shift a column. */
function dayKeyAfter(now: number, i: number): string {
  const [y, m, d] = dayKeyEt(now).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
}

function isWeekend(key: string): boolean {
  const [y, m, d] = key.split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return wd === 0 || wd === 6;
}

/** "Sep 9" for day 0, the bare day number otherwise. */
function dayLabel(key: string, full: boolean): string {
  const day = Number(key.slice(8, 10));
  return full ? `${fmtDate(key).slice(0, 3)} ${day}` : String(day);
}

/** Every fourth column carries its day number, except the one that would
 * crowd the end label; day 0 and the last day always print (mockup: Sep 9 ·
 * 13 · 17 · 21 · 26). */
function labelled(i: number): boolean {
  return i === 0 || i === DAYS - 1 || (i % 4 === 0 && DAYS - 1 - i >= 2);
}

/** Stems, dots and labels for the events inside the window, in draw order:
 * per day, lowest importance first; a dot that would land within 14 px of
 * one already placed on that day is raised above it. */
export function placeEvents(events: CalendarEvent[], now: number): Placed[] {
  const byDay = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    const day = dayDeltaEt(e.event_datetime, now);
    if (day < 0 || day >= DAYS) continue;
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  const out: Placed[] = [];
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = [...list].sort(
      (a, b) => (RANK[(a.importance ?? "").toLowerCase()] ?? -1) - (RANK[(b.importance ?? "").toLowerCase()] ?? -1),
    );
    const taken: number[] = [];
    for (const e of ordered) {
      const geo = DOT[(e.importance ?? "").toLowerCase()] ?? DOT_UNRATED;
      let y = geo.y;
      while (taken.some((t) => Math.abs(t - y) < STACK)) y -= STACK;
      taken.push(y);
      out.push({ event: e, day, y, r: geo.r, color: geo.color });
    }
  }
  return out;
}

export default function EventTimeline({ events, now, fallbackEnd }: EventTimelineProps): JSX.Element {
  const placed = placeEvents(events, now);
  const high = placed.filter((p) => (p.event.importance ?? "").toLowerCase() === "high").length;
  const days = Array.from({ length: DAYS }, (_, i) => ({ i, key: dayKeyAfter(now, i) }));

  // The state sentence when nothing is drawn: the next event past the 18
  // days, the end of the stored schedule, or nothing on file.
  let state: string | null = null;
  if (!placed.length) {
    const next = events.find((e) => dayDeltaEt(e.event_datetime, now) >= DAYS);
    if (next) {
      const [d, t] = splitStamp(next.event_datetime);
      state = `No events in the next ${DAYS} days · next: ${next.event_name} ${t ? `${d}, ${t}` : d}`;
    } else if (fallbackEnd) state = `Stored schedule ends ${fmtDate(fallbackEnd)}`;
    else state = "No events on file.";
  }

  return (
    <svg
      className="mrr-news-timeline"
      viewBox="0 0 400 290"
      width="100%"
      role="img"
      aria-label={`Macro events over the next ${DAYS} days: ${placed.length} events, ${high} high impact`}
      style={{ display: "block", maxWidth: 400, marginLeft: "auto", overflow: "visible" }}
    >
      <text x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill={LABEL_N} style={{ fontFamily: "var(--font-mono)" }}>
        NEXT {DAYS} DAYS · STEM HEIGHT = IMPACT
      </text>

      {/* axis: weekend columns, baseline, one tick per day with sparse labels */}
      {days.filter((d) => isWeekend(d.key)).map((d) => (
        <rect key={`we-${d.i}`} data-weekend={d.key} x={f1(x(d.i) - STEP / 2)} y={TOP} width={f1(STEP)} height={BASE - TOP} fill={WEEKEND} />
      ))}
      <line x1={X0} x2={X1} y1={BASE} y2={BASE} stroke={AXIS} />
      {days.map((d) => (
        <line key={`tick-${d.i}`} data-tick={d.key} x1={f1(x(d.i))} x2={f1(x(d.i))} y1={BASE} y2={BASE + 4} stroke={TICK} />
      ))}
      {days.filter((d) => labelled(d.i)).map((d) => (
        <text
          key={`lab-${d.i}`}
          data-day-label={d.key}
          x={f1(x(d.i))}
          y={LABEL_Y}
          textAnchor={d.i === 0 ? "start" : d.i === DAYS - 1 ? "end" : "middle"}
          fontSize="10"
          fill={d.i === 0 ? LABEL_0 : LABEL_N}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {dayLabel(d.key, d.i === 0)}
        </text>
      ))}

      {/* NOW rail on day 0 */}
      <rect data-now-rail="true" x="6" y={TOP} width="3" height={BASE - TOP} rx="1.5" fill="var(--mint)" />
      <text x="16" y="40" fontSize="10" fill="var(--mint)" style={{ fontFamily: "var(--font-mono)" }}>
        NOW
      </text>

      {/* one stem, dot and label per event inside the window */}
      {placed.map((p) => {
        const cx = x(p.day);
        const right = cx > MID;
        return (
          <g key={p.event.id} data-event={p.event.id} data-importance={p.event.importance ?? "none"}>
            <line x1={f1(cx)} x2={f1(cx)} y1={f1(p.y)} y2={BASE} stroke={p.color} strokeOpacity=".55" />
            <circle cx={f1(cx)} cy={f1(p.y)} r={p.r} fill={p.color} />
            <text
              x={f1(right ? cx - 9 : cx + 9)}
              y={f1(p.y + 4)}
              textAnchor={right ? "end" : "start"}
              fontSize="11.5"
              fontWeight="500"
              fill={EVENT_TEXT}
              style={{ fontFamily: "var(--font-ui)" }}
            >
              {p.event.event_name}
            </text>
          </g>
        );
      })}

      {state ? (
        <text data-state="true" x={MID} y="140" textAnchor="middle" fontSize="12.5" fill={STATE_TEXT} style={{ fontFamily: "var(--font-ui)" }}>
          {state}
        </text>
      ) : null}
    </svg>
  );
}
