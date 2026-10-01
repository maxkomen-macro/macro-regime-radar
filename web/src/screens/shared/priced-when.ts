/**
 * When a What's priced metric was observed (fix/freshness 4). The served
 * `date` is the run that wrote the level (every full refresh; it was captioned
 * "weekly pipeline"), so the screens print each metric's own observation month
 * instead: "Sep 2026", and "Aug 2026 average" for fed funds, a monthly average.
 */

import type { PricedMetric } from "../../api/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08" → "Aug 2026"; null when not a month. */
function monthWords(ym: string | null | undefined): string | null {
  const [y, m] = (ym ?? "").split("-").map(Number);
  return y && m >= 1 && m <= 12 ? `${MONTHS[m - 1]} ${y}` : null;
}

/** The observation month of one metric, in words ("Aug 2026 average" for fed funds). */
export function pricedWhen(p: Pick<PricedMetric, "metric" | "observation_month">): string | null {
  const m = monthWords(p.observation_month);
  if (!m) return null;
  return p.metric === "FEDFUNDS" ? `${m} average` : m;
}

/** A block of metrics in one line: the newest month, then any metric observed in another month by name
 * ("Sep 2026 · Fed funds Aug 2026 average"). Null when no metric carries its month. */
export function pricedMonths(rows: readonly Pick<PricedMetric, "metric" | "label" | "observation_month">[]): string | null {
  const dated = rows.filter((r) => monthWords(r.observation_month));
  if (!dated.length) return null;
  const newest = dated.map((r) => r.observation_month as string).reduce((a, b) => (a > b ? a : b));
  const others = dated.filter((r) => r.observation_month !== newest).map((r) => `${r.label} ${pricedWhen(r)}`);
  return [monthWords(newest), ...others].join(" · ");
}
