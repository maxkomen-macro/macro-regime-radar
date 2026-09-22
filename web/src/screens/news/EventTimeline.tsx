/**
 * The hero's 18-day event timeline (redesign Phase 8, checklist 08 B.1
 * "Chart"): an inline SVG on the mockup's 400x290 frame. One column per ET
 * calendar day from today, weekends shaded, a baseline with a tick and a
 * sparse day label per column, the mint NOW rail on day 0, then one stem and
 * dot per served event inside the window: height and colour by the served
 * `importance` (high amber, medium cyan, low gray). Events on one day share
 * the x; where two would land on the same height the later one is raised one
 * label lane (16 px), and the highest importance is drawn last so it sits on
 * top.
 *
 * Three states share the axis: an empty 18 days with rows later in the
 * window names the next event; the stored-schedule fallback prints where the
 * snapshot ends; nothing on file says so. No animation.
 *
 * Iteration 1 (the hero chart-slot root cause, N1's geometry): drawn through
 * HeroChartFrame at the hero column's own size, 1:1, instead of a 400 px
 * drawing parked at the column's right edge. The day columns spread across
 * the width (8 px in from each edge); the stems scale with the plot height
 * (the 290 px mockup frame is the fallback and the floor, 420 px the cap);
 * every word keeps its set size.
 *
 * Iteration 1 (N1): labels never overlap. Each label is placed beside its
 * dot, away from the nearer edge first, then on the other side, then one,
 * two or three 16 px lanes up or down, and takes the first spot that meets no
 * other label, no other dot, the NOW mark, the state sentence or the plot's
 * edges (text widths are estimated from the set sizes, with slack). A label
 * with no free spot is left off; its dot, and the calendar, still carry the
 * event. Large-cap earnings rows (`kind === "earnings"`, B5) draw as violet
 * diamonds on a dashed stem below the low-impact band, one per day, labelled
 * with their symbols, and join the legend and the accessible name only when
 * the window holds any.
 */

import { fmtDate } from "../../lib/format";
import { HeroChartFrame, clampPx } from "../shared/HeroChart";
import { dayDeltaEt, dayKeyEt, splitStamp } from "../shared/calendar-impact";
import type { CalendarEvent } from "../../api/types";
import type { EventTimelineProps } from "./news-types";

export const DAYS = 18;
/** Mockup frame (the fallback): 18 ticks from x 8 to 392 (384 / 17 per
 * column, news.html rounds to one decimal), plot from y 30 to the baseline at
 * 246, day labels at 264. Wider, the ticks keep 8 px from each edge; taller,
 * the baseline and labels keep their distance from the bottom. */
const W0 = 400;
const H0 = 290;
const X0 = 8;
const TOP = 30;
const BASE0 = 246;
const LABEL_UP = H0 - 264;
const BASE_UP = H0 - BASE0;
/** One label lane: an 11.5 px label is ~12 px tall, so 16 px keeps 4 px clear. */
export const LANE = 16;
const minHeight = () => H0;
const maxHeight = (w: number) => clampPx(w * 0.85, H0, 420);

const WEEKEND = "rgba(255,255,255,.025)";
const AXIS = "rgba(255,255,255,.2)";
const TICK = "rgba(255,255,255,.25)";
const LABEL_0 = "#dfe6ec";
const LABEL_N = "#7d8b98";
const EVENT_TEXT = "#e9eef2";
const STATE_TEXT = "var(--text-3)";
/** Earnings: the app's research violet at a readable rung (NewsCard's
 * Perplexity line), a distinct shape as well as a distinct hue. */
const EARN = "#a78bfa";
const EARN_TEXT = "#d4ccfb";

/** Dot geometry by served importance (mockup values); anything unrated takes
 * the low height in the calendar's unrated gray. */
const DOT: Record<string, { y: number; r: number; color: string }> = {
  high: { y: 96, r: 5, color: "var(--amber)" },
  medium: { y: 150, r: 4, color: "var(--cyan)" },
  low: { y: 190, r: 4, color: "#6f7d8a" },
};
const DOT_UNRATED = { y: 190, r: 4, color: "var(--text-4)" };
const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };
/** Earnings diamonds sit below the low-impact band (mockup coordinates). */
const EARN_Y = 216;
const EARN_R = 4.5;

const EVENT_PX = 11.5;
const EARN_PX = 10.5;
const LABEL_GAP = 9;

const f1 = (n: number) => n.toFixed(1);

export const isEarnings = (e: CalendarEvent) => (e.kind ?? "").toLowerCase() === "earnings";

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

/** Stems, dots and labels for the macro events inside the window, in draw
 * order: per day, lowest importance first; a dot that would land within one
 * lane of one already placed on that day is raised above it. Earnings rows
 * are left to `earningsDays`. */
export function placeEvents(events: CalendarEvent[], now: number): Placed[] {
  const byDay = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    if (isEarnings(e)) continue;
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
      while (taken.some((t) => Math.abs(t - y) < LANE)) y -= LANE;
      taken.push(y);
      out.push({ event: e, day, y, r: geo.r, color: geo.color });
    }
  }
  return out;
}

export interface EarningsDay {
  day: number;
  events: CalendarEvent[];
  /** The symbols reporting that day, served order, each once. */
  symbols: string[];
}

/** Large-cap earnings rows inside the window, one entry per ET day. */
export function earningsDays(events: CalendarEvent[], now: number): EarningsDay[] {
  const byDay = new Map<number, CalendarEvent[]>();
  for (const e of events) {
    if (!isEarnings(e)) continue;
    const day = dayDeltaEt(e.event_datetime, now);
    if (day < 0 || day >= DAYS) continue;
    const list = byDay.get(day) ?? [];
    list.push(e);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, list]) => ({
      day,
      events: list,
      symbols: [...new Set(list.map((e) => (e.symbol ?? e.event_name.split(" ")[0] ?? "").toUpperCase()).filter(Boolean))],
    }));
}

/* ── label layout ────────────────────────────────────────────────────────── */

interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Advance estimate for a label at its set size, rounded up: Plex Sans 500
 * by character class, mono at 0.6 em. Slack beats a clipped collision. */
export function labelWidth(text: string, px: number, mono: boolean): number {
  if (mono) return Math.ceil(text.length * px * 0.62) + 2;
  let em = 0;
  for (const ch of text) {
    if (ch === " ") em += 0.27;
    else if (/[ilIj.,:;'’|!()[\]]/.test(ch)) em += 0.3;
    else if (/[mwMW]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.68;
    else if (/[0-9]/.test(ch)) em += 0.6;
    else em += 0.56;
  }
  return Math.ceil(em * px) + 2;
}

const intersects = (a: Box, b: Box, pad = 2) => a.l < b.r + pad && b.l < a.r + pad && a.t < b.b + pad && b.t < a.b + pad;

export interface LabelItem {
  key: string;
  /** Anchor: the dot or diamond centre, drawing pixels. */
  x: number;
  y: number;
  r: number;
  text: string;
  px: number;
  mono: boolean;
  /** "right" = anchored start right of the dot; "left" = anchored end. */
  prefer: "left" | "right";
}

export interface LabelSpot {
  x: number;
  /** Text baseline. */
  y: number;
  anchor: "start" | "end";
  box: Box;
}

const DY = [0, -LANE, LANE, -2 * LANE, 2 * LANE, -3 * LANE, 3 * LANE];

/**
 * Greedy placement in the given order (the caller passes the most important
 * first): each label takes the first candidate spot inside `bounds` that
 * meets no placed label, no other item's mark and no blocker. Null when none
 * is free.
 */
export function layoutLabels(items: LabelItem[], bounds: Box, blockers: Box[] = []): Map<string, LabelSpot | null> {
  const out = new Map<string, LabelSpot | null>();
  const placed: Box[] = [];
  const marks = items.map((it) => ({ key: it.key, box: { l: it.x - it.r - 1, t: it.y - it.r - 1, r: it.x + it.r + 1, b: it.y + it.r + 1 } }));
  for (const it of items) {
    const width = labelWidth(it.text, it.px, it.mono);
    const ascent = it.px * 0.8;
    const descent = it.px * 0.26;
    const sides: ("left" | "right")[] = it.prefer === "right" ? ["right", "left"] : ["left", "right"];
    let spot: LabelSpot | null = null;
    search: for (const dy of DY) {
      for (const side of sides) {
        const base = it.y + it.px * 0.35 + dy;
        const x = side === "right" ? it.x + LABEL_GAP : it.x - LABEL_GAP;
        const box: Box = side === "right" ? { l: x, t: base - ascent, r: x + width, b: base + descent } : { l: x - width, t: base - ascent, r: x, b: base + descent };
        if (box.l < bounds.l || box.r > bounds.r || box.t < bounds.t || box.b > bounds.b) continue;
        if (placed.some((p) => intersects(p, box))) continue;
        if (blockers.some((p) => intersects(p, box))) continue;
        if (marks.some((m) => m.key !== it.key && intersects(m.box, box, 1))) continue;
        spot = { x, y: base, anchor: side === "right" ? "start" : "end", box };
        break search;
      }
    }
    if (spot) placed.push(spot.box);
    out.set(it.key, spot);
  }
  return out;
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function EventTimeline(props: EventTimelineProps): JSX.Element {
  return (
    <HeroChartFrame fallback={{ w: W0, h: H0 }} minHeight={minHeight} maxHeight={maxHeight}>
      {({ w, h }) => <Timeline {...props} w={w} h={h} />}
    </HeroChartFrame>
  );
}

const IMPORTANCE_ORDER = (e: CalendarEvent) => -(RANK[(e.importance ?? "").toLowerCase()] ?? -1);

function Timeline({ events, now, fallbackEnd, w, h }: EventTimelineProps & { w: number; h: number }): JSX.Element {
  const X1 = w - X0;
  const STEP = (X1 - X0) / (DAYS - 1);
  /** Labels anchor start left of centre and end right of it (B.1). */
  const MID = w / 2;
  const BASE = h - BASE_UP;
  const LABEL_Y = h - LABEL_UP;
  const x = (day: number) => X0 + day * STEP;
  /** placeEvents works on the mockup's plot (30 to 246); the drawing maps it
   * onto this plot, so a taller hero lengthens the stems in proportion. */
  const sy = (y: number) => TOP + ((y - TOP) * (BASE - TOP)) / (BASE0 - TOP);
  const placed = placeEvents(events, now);
  const earnings = earningsDays(events, now);
  const earnCount = earnings.reduce((n, d) => n + d.events.length, 0);
  const high = placed.filter((p) => (p.event.importance ?? "").toLowerCase() === "high").length;
  const days = Array.from({ length: DAYS }, (_, i) => ({ i, key: dayKeyAfter(now, i) }));

  // The state sentence when no macro event is drawn: the next event past the
  // 18 days, the end of the stored schedule, or nothing on file.
  let state: string | null = null;
  if (!placed.length) {
    const next = events.find((e) => !isEarnings(e) && dayDeltaEt(e.event_datetime, now) >= DAYS);
    if (next) {
      const [d, t] = splitStamp(next.event_datetime);
      state = `No events in the next ${DAYS} days · next: ${next.event_name} ${t ? `${d}, ${t}` : d}`;
    } else if (fallbackEnd) state = `Stored schedule ends ${fmtDate(fallbackEnd)}`;
    else state = "No events on file.";
  }
  const stateY = sy(140);

  // Labels: macro events by importance then day, then the earnings days.
  const items: LabelItem[] = [
    ...[...placed]
      .sort((a, b) => IMPORTANCE_ORDER(a.event) - IMPORTANCE_ORDER(b.event) || a.day - b.day)
      .map((p) => ({
        key: `e${p.event.id}`,
        x: x(p.day),
        y: sy(p.y),
        r: p.r,
        text: p.event.event_name,
        px: EVENT_PX,
        mono: false,
        prefer: (x(p.day) > MID ? "left" : "right") as "left" | "right",
      })),
    ...earnings.map((d) => ({
      key: `d${d.day}`,
      x: x(d.day),
      y: sy(EARN_Y),
      r: EARN_R,
      text: d.symbols.join(" · "),
      px: EARN_PX,
      mono: true,
      prefer: (x(d.day) > MID ? "left" : "right") as "left" | "right",
    })),
  ];
  const blockers: Box[] = [{ l: 14, t: TOP, r: 44, b: 44 }]; // the NOW mark
  if (state) {
    const half = labelWidth(state, 12.5, false) / 2;
    blockers.push({ l: MID - half, t: stateY - 11, r: MID + half, b: stateY + 4 });
  }
  const spots = layoutLabels(items, { l: 0, t: TOP - 12, r: w, b: BASE - 3 }, blockers);

  const title = `NEXT ${DAYS} DAYS · STEM HEIGHT = IMPACT`;
  const legendInline = w >= 330;
  const aria = `Macro events over the next ${DAYS} days: ${placed.length} events, ${high} high impact${
    earnCount ? `, ${earnCount} large-cap earnings` : ""
  }`;

  return (
    <svg
      className="mrr-news-timeline"
      data-chart=""
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label={aria}
      style={{ display: "block", maxWidth: "100%", overflow: "visible" }}
    >
      <text x="0" y="12" fontSize="9.5" letterSpacing=".1em" fill={LABEL_N} style={{ fontFamily: "var(--font-mono)" }}>
        {title}
      </text>
      {earnCount ? (
        <text
          data-legend="earnings"
          x={legendInline ? w : 0}
          y={legendInline ? 12 : 24}
          textAnchor={legendInline ? "end" : "start"}
          fontSize="9.5"
          letterSpacing=".1em"
          fill={EARN}
          style={{ fontFamily: "var(--font-mono)" }}
        >
          ◆ EARNINGS
        </text>
      ) : null}

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

      {/* earnings: a dashed stem and a diamond per day, under the macro marks */}
      {earnings.map((d) => {
        const cx = x(d.day);
        const cy = sy(EARN_Y);
        return (
          <g key={`earn-${d.day}`} data-earnings={d.symbols.join(",")}>
            <title>{d.events.map((e) => `${e.event_name} · ${splitStamp(e.event_datetime).join(", ")}`).join("\n")}</title>
            <line x1={f1(cx)} x2={f1(cx)} y1={f1(cy)} y2={BASE} stroke={EARN} strokeOpacity=".5" strokeDasharray="2 2" />
            <path d={`M${f1(cx)} ${f1(cy - EARN_R)} L${f1(cx + EARN_R)} ${f1(cy)} L${f1(cx)} ${f1(cy + EARN_R)} L${f1(cx - EARN_R)} ${f1(cy)} Z`} fill={EARN} />
          </g>
        );
      })}

      {/* one stem and dot per macro event inside the window */}
      {placed.map((p) => {
        const cx = x(p.day);
        return (
          <g key={p.event.id} data-event={p.event.id} data-importance={p.event.importance ?? "none"}>
            <title>{`${p.event.event_name} · ${splitStamp(p.event.event_datetime).join(", ")}`}</title>
            <line x1={f1(cx)} x2={f1(cx)} y1={f1(sy(p.y))} y2={BASE} stroke={p.color} strokeOpacity=".55" />
            <circle cx={f1(cx)} cy={f1(sy(p.y))} r={p.r} fill={p.color} />
          </g>
        );
      })}

      {/* labels last, so no stem is drawn over a word; a label with no free
          spot is left off (the dot and the calendar still carry it) */}
      {placed.map((p) => {
        const spot = spots.get(`e${p.event.id}`);
        if (!spot) return null;
        return (
          <text
            key={`t-${p.event.id}`}
            data-label-for={p.event.id}
            x={f1(spot.x)}
            y={f1(spot.y)}
            textAnchor={spot.anchor}
            fontSize={EVENT_PX}
            fontWeight="500"
            fill={EVENT_TEXT}
            style={{ fontFamily: "var(--font-ui)" }}
          >
            {p.event.event_name}
          </text>
        );
      })}
      {earnings.map((d) => {
        const spot = spots.get(`d${d.day}`);
        if (!spot) return null;
        return (
          <text
            key={`te-${d.day}`}
            data-label-for={`earnings-${d.day}`}
            x={f1(spot.x)}
            y={f1(spot.y)}
            textAnchor={spot.anchor}
            fontSize={EARN_PX}
            fontWeight="500"
            fill={EARN_TEXT}
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {d.symbols.join(" · ")}
          </text>
        );
      })}

      {state ? (
        <text data-state="true" x={MID} y={f1(stateY)} textAnchor="middle" fontSize="12.5" fill={STATE_TEXT} style={{ fontFamily: "var(--font-ui)" }}>
          {state}
        </text>
      ) : null}
    </svg>
  );
}
