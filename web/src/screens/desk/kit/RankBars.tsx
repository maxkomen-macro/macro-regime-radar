/**
 * Ranked horizontal bars (DESK_FRAME3_SPEC §3 sector leadership, §7 all
 * eleven): one row per item, ticker · name · bar · value. As the PNGs draw
 * them, every bar starts at the left and its length ranks the served values
 * (the printed number carries the value itself); color is §3's rule: green
 * more than 1% ahead, gray within 1%, red more than 1% behind.
 */

import { pct } from "./format";

export interface RankRow {
  key: string;
  ticker: string;
  name: string;
  value: number;
}

/** §3/§7: > +1% green, within ±1% gray, < −1% red. */
export function relTone(v: number): "green" | "gray" | "red" {
  if (v > 0.01) return "green";
  if (v < -0.01) return "red";
  return "gray";
}

/** A bar's length in percent of the track: the lowest value 22%, the highest 78% (the PNGs' span). */
export function rankLength(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  return 22 + ((v - lo) / (hi - lo)) * 56;
}

export default function RankBars({ rows, lo, hi, label }: { rows: RankRow[]; lo?: number; hi?: number; label: string }) {
  const min = lo ?? Math.min(...rows.map((r) => r.value));
  const max = hi ?? Math.max(...rows.map((r) => r.value));
  return (
    <ul className="dk-rank" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="dk-rank-ticker">{r.ticker}</span>
          <span className="dk-rank-name">{r.name}</span>
          <span className="dk-rank-track" aria-hidden="true">
            <span data-tone={relTone(r.value)} style={{ width: `${rankLength(r.value, min, max)}%` }} />
          </span>
          <span className="dk-rank-value" data-tone={relTone(r.value) === "gray" ? undefined : relTone(r.value)}>
            {pct(r.value)}
          </span>
        </li>
      ))}
    </ul>
  );
}
