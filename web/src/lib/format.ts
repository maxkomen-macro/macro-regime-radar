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

/* ── Units (Iteration 1, A4) ────────────────────────────────────────────────
 * The one place a percent becomes basis points and back. The API serves
 * spreads both ways (`value_pct` 2.65 and `value_bps` 265 on /api/credit/oas;
 * bps only on /api/credit/metrics; the recession model's 2s10s in bps), and a
 * screen converts only through these two, never with a bare `* 100` or `/ 100`
 * at the call site. */

/** Percent points to basis points: 2.65 (%) → 265 (bps). */
export function pctToBps(pct: number): number {
  return pct * 100;
}

/** Basis points to percent points: 265 (bps) → 2.65 (%). */
export function bpsToPct(bps: number): number {
  return bps / 100;
}

/** A change in basis points, signed: "+21 bps", "-2 bps", "0 bps". */
export function fmtBps(bps: number): string {
  const r = Math.round(bps);
  return `${r > 0 ? "+" : ""}${r} bps`;
}

/** A level in basis points, unsigned: "265 bps" (a spread, not a change). */
export function fmtBpsLevel(bps: number): string {
  return `${Math.round(bps)} bps`;
}

/* ── Probabilities and shares (Iteration 1, A4) ─────────────────────────────
 * Anything labelled a probability or a share prints through `fmtProb`, which
 * never shows a figure above 100% or below 0%: a served value outside its
 * scale is a data fault, so it renders the dash and warns in the console,
 * never a clamped number that looks real. Not for figures that may pass 100
 * by construction (CCC as a percent of the distress line, a spell as a
 * percent of the average spell): those are ratios, not shares. */

/** The scale a probability arrives on: 0–1 ("unit", the classifier's odds,
 * confidence, credit transition odds) or 0–100 ("percent", the recession
 * model, transition outlook odds, scenario odds). */
export type ProbScale = "unit" | "percent";

/** "64%" from 0.6423 ("unit") or "11.6%" from 11.63 ("percent", dp 1). Out
 * of range or not a finite number: "—" plus a console warning. */
export function fmtProb(v: number | null | undefined, scale: ProbScale = "unit", dp = 0): string {
  if (v == null) return "—";
  const max = scale === "unit" ? 1 : 100;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) {
    console.warn(`fmtProb: ${String(v)} is outside the 0–${max} ${scale} scale of a probability or share; rendering the dash.`);
    return "—";
  }
  const pct = scale === "unit" ? v * 100 : v;
  return dp === 0 ? `${Math.round(pct)}%` : `${pct.toFixed(dp)}%`;
}

/** A 0–1 probability or share as a whole percent ("64%"); `fmtProb` with its
 * bounds, so an out-of-range value renders "—". */
export function fmtWholePct(v01: number): string {
  return fmtProb(v01, "unit", 0);
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
