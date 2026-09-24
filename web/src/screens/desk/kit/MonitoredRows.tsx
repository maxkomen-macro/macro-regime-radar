/**
 * Monitored position rows (DESK_FRAME3_SPEC §2, §9): one bordered row per
 * position on the grid `minmax(0,1fr) 54px auto 64px 14px`: name (nowrap) ·
 * `N% NAV` · `P% room · X to level` · a room bar · `▸`. Room is green at 50%
 * or more and amber under 30% (§2); between the two it keeps the neutral
 * text color, since §2 names no color there. Sorted by room left, least
 * first (the footer says so): the row closest to being wrong leads.
 */

import type { ReactNode } from "react";
import type { PositionCompact, ToLevel } from "../data/types";
import { pctPlain } from "./format";
import { cx } from "./ui";

export function roomTone(room: number): "green" | "amber" | undefined {
  if (room >= 0.5) return "green";
  if (room < 0.3) return "amber";
  return undefined;
}

/** "3.4%" / "3 bp": the distance to the level in its own unit. */
export function levelText(t: ToLevel): string {
  const v = Number.isInteger(t.value) ? String(t.value) : t.value.toFixed(1);
  return t.unit === "%" ? `${v}%` : `${v} ${t.unit}`;
}

export function sortByRoom<T extends { room_pct: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.room_pct - b.room_pct);
}

export function MonitoredRow({
  row,
  open,
  onClick,
  controls,
  children,
}: {
  row: PositionCompact;
  open?: boolean;
  onClick?: () => void;
  controls?: string;
  children?: ReactNode;
}) {
  const tone = roomTone(row.room_pct);
  return (
    <li className={cx("dk-mon", open && "dk-mon-open")} data-testid="dk-mon-row" data-id={row.id}>
      <button type="button" className="dk-mon-row" onClick={onClick} aria-expanded={children !== undefined ? Boolean(open) : undefined} aria-controls={controls}>
        <span className="dk-mon-name">{row.name}</span>
        <span className="dk-mon-nav">{pctPlain(row.size_nav)} NAV</span>
        <span className="dk-mon-room" data-tone={tone}>
          {pctPlain(row.room_pct)} room <span className="dk-mon-dim">· {levelText(row.to_level)} to level</span>
        </span>
        <span className="dk-mon-bar" aria-hidden="true">
          <span data-tone={tone} style={{ width: `${Math.max(0, Math.min(1, row.room_pct)) * 100}%` }} />
        </span>
        <span className="dk-mon-caret" aria-hidden="true">
          {open ? "▼" : "▶"}
        </span>
      </button>
      {open && children ? <div id={controls}>{children}</div> : null}
    </li>
  );
}

export default function MonitoredRows({ rows, onOpen }: { rows: readonly PositionCompact[]; onOpen?: (id: string) => void }) {
  if (!rows.length) return <p className="dk-await">No positions are being monitored.</p>;
  return (
    <ul className="dk-mon-list">
      {sortByRoom(rows).map((r) => (
        <MonitoredRow key={r.id} row={r} onClick={onOpen ? () => onOpen(r.id) : undefined} />
      ))}
    </ul>
  );
}
