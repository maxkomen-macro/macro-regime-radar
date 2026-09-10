/**
 * Number and date formatters — desk-note conventions from the bundle readme:
 * rates to two decimals (4.30%), indices to one (18.9), bps spelled out
 * (+52 bps), z-scores to two (2.41), probabilities as whole percents (52%).
 * Values render in mono with tabular figures at the component layer.
 */

export function fmtPct(v: number, dp = 2): string {
  return `${v.toFixed(dp)}%`;
}

export function fmtSignedPct(v: number, dp = 2): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}%`;
}

export function fmtSigned(v: number, dp = 2): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(dp)}`;
}

export function fmtBps(bps: number): string {
  const r = Math.round(bps);
  return `${r > 0 ? "+" : ""}${r} bps`;
}

export function fmtWholePct(v01: number): string {
  return `${Math.round(v01 * 100)}%`;
}

export function fmtUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-06-01" → "Jun 2026" */
export function fmtMonYr(iso: string): string {
  const [y, m] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

/** "2026-08-05" → "Aug 05, 2026" */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${String(d).padStart(2, "0")}, ${y}`;
}

/** "2026-08-05 15:55:00" (ET session bars) → "Aug 05, 15:55 ET" */
export function fmtIntradayTs(ts: string): string {
  const [date, time] = ts.replace("T", " ").split(" ");
  if (!date || !time) return ts;
  const [y, m, d] = date.split("-").map(Number);
  void y;
  return `${MONTHS[(m ?? 1) - 1]} ${String(d).padStart(2, "0")}, ${time.slice(0, 5)} ET`;
}

const ET_STAMP_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A server stamp with no zone ("2026-09-05T22:29:00" or "… 22:29:00") is
 * UTC: render it as an ET wall time ("Sep 05, 18:29 ET"), never by appending
 * "ET" to the UTC digits (2026-09-05). Stamps that carry an offset are honoured. */
export function fmtUtcStampEt(ts: string): string {
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(ts);
  const d = new Date(hasZone ? ts.replace(" ", "T") : `${ts.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return ts;
  const parts = ET_STAMP_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("hour")}:${get("minute")} ET`;
}

/** Days from `iso` to now (UTC), fractional. */
export function daysSince(iso: string): number {
  const t = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso.replace(" ", "T")).getTime();
  return (Date.now() - t) / 86_400_000;
}

/** 1st / 2nd / 3rd / 11th–13th / 21st … — mirrors src/utils/format.py::ordinal. */
export function ordinal(n: number): string {
  const v = Math.round(n);
  const mod100 = Math.abs(v) % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${v}th`;
  switch (Math.abs(v) % 10) {
    case 1:
      return `${v}st`;
    case 2:
      return `${v}nd`;
    case 3:
      return `${v}rd`;
    default:
      return `${v}th`;
  }
}

/** Display filter for server- and model-composed prose (takeaway narrative,
 * news interpretations, cited research): em-dash asides become semicolons —
 * the house copy rule keeps them out of rendered text. Null-safe. */
export function tidyProse(s: string): string {
  return s.replace(/\s+—\s+/g, "; ").replace(/ {2,}/g, " ");
}
