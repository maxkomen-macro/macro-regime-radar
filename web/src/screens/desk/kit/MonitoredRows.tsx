/**
 * Monitored position rows (DESK_FRAME3_SPEC §2, §9): one bordered row per
 * position on the grid `minmax(0,1fr) 54px auto 64px 14px`: name (nowrap) ·
 * `N% NAV` · `P% room · X to level` · a room bar · `▸`. Room is green at 50%
 * or more and amber under 30% (§2); between the two it keeps the neutral
 * text color, since §2 names no color there. A manual position prints
 * "manual" in the room cell and an empty bar. Sorted by room left, least
 * first, a row without room last, then by id (the footer says so): the row
 * closest to being wrong leads.
 */

import type { ReactNode } from "react";
import { num, pctPlain } from "./format";
import { cx } from "./ui";

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** What a monitored row shows: the Position Monitor's view of a stored position (positions/monitor.ts). */
export interface MonitoredRowData {
  id: string;
  name: string;
  size_nav: number | null;
  monitoring: "automatic" | "manual";
  /** Distance now over the room at entry; ≤ 0 once through the level; null when not computed. */
  room_pct: number | null;
  to_level: { value: number; unit: "%" | "bp" } | null;
}

export function roomTone(room: number | null | undefined): "green" | "amber" | undefined {
  if (!fin(room)) return undefined;
  if (room >= 0.5) return "green";
  if (room < 0.3) return "amber";
  return undefined;
}

/** "3.4%" / "3 bp": the distance left to the level in its own unit; empty when not computed. */
export function levelText(t: MonitoredRowData["to_level"] | undefined): string {
  if (!t || !fin(t.value)) return "";
  const v = num(t.value, Number.isInteger(t.value) ? 0 : 1);
  return t.unit === "%" ? `${v}%` : `${v} bp`;
}

/** The room cell's words: "68% room · 3.4% to level", "−12% room · through the level", "manual" or "room —". */
export function roomWords(row: MonitoredRowData): { room: string; level: string } {
  if (row.monitoring === "manual") return { room: "manual", level: "" };
  if (!fin(row.room_pct)) return { room: "room —", level: "" };
  if (row.room_pct <= 0) return { room: `${pctPlain(row.room_pct)} room`, level: "through the level" };
  const level = levelText(row.to_level);
  return { room: `${pctPlain(row.room_pct)} room`, level: level ? `${level} to level` : "" };
}

/** Least room first; a row without room last; then by id (§2, §9). */
export function sortByRoom<T extends { room_pct: number | null; id: string }>(rows: readonly T[]): T[] {
  const key = (r: T) => (fin(r.room_pct) ? r.room_pct : Infinity);
  return [...rows].sort((a, b) => key(a) - key(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function MonitoredRow({
  row,
  open,
  onClick,
  controls,
  children,
}: {
  row: MonitoredRowData;
  open?: boolean;
  onClick?: () => void;
  controls?: string;
  children?: ReactNode;
}) {
  const tone = row.monitoring === "manual" ? undefined : roomTone(row.room_pct);
  const words = roomWords(row);
  return (
    <li className={cx("dk-mon", open && "dk-mon-open")} data-testid="dk-mon-row" data-id={row.id} data-monitoring={row.monitoring}>
      <button type="button" className="dk-mon-row" onClick={onClick} aria-expanded={children !== undefined ? Boolean(open) : undefined} aria-controls={controls}>
        <span className="dk-mon-name">{row.name}</span>
        <span className="dk-mon-nav">{fin(row.size_nav) ? pctPlain(row.size_nav) : "—"} NAV</span>
        <span className="dk-mon-room" data-tone={tone}>
          {words.room}
          {words.level ? <span className="dk-mon-dim"> · {words.level}</span> : null}
        </span>
        <span className="dk-mon-bar" aria-hidden="true">
          {row.monitoring === "automatic" && fin(row.room_pct) ? <span data-tone={tone} style={{ width: `${Math.max(0, Math.min(1, row.room_pct)) * 100}%` }} /> : null}
        </span>
        <span className="dk-mon-caret" aria-hidden="true">
          {open ? "▼" : "▶"}
        </span>
      </button>
      {open && children ? <div id={controls}>{children}</div> : null}
    </li>
  );
}

export default function MonitoredRows({ rows, unreadable = 0, onOpen }: { rows: readonly MonitoredRowData[]; unreadable?: number; onOpen?: (id: string) => void }) {
  // Codex R-16: with a kept position this browser cannot read, "none" is never claimed.
  if (!rows.length) {
    const lost = `${unreadable} kept position${unreadable === 1 ? "" : "s"} could not be read`;
    return <p className="dk-await">{unreadable ? `No readable position is monitored; ${lost}.` : "No positions are monitored in this browser."}</p>;
  }
  return (
    <ul className="dk-mon-list">
      {sortByRoom(rows).map((r) => (
        <MonitoredRow key={r.id} row={r} onClick={onOpen ? () => onOpen(r.id) : undefined} />
      ))}
    </ul>
  );
}
