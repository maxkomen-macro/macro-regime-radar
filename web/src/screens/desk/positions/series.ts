/**
 * The series a falsification level can be tied to, and their live readings
 * (spec §5: "distance to falsification using the live series"). Two kinds:
 * the FRED series the API serves at /series/{id}/latest, and the stored
 * symbols with daily bars at /api/market/daily. One query per series, shared
 * by the form's "now" line, the monitored list and Today. The catalogue is
 * the pipeline's own list (src/config.py SERIES and the 23-symbol stored
 * universe); nothing here is a price feed of its own.
 */

import { useQueries, useQuery } from "@tanstack/react-query";
import { getJson } from "../../../api/client";
import type { DailyBar } from "../../../api/types";
import { fmtDate, fmtMonYr } from "../../../lib/format";
import { pyFixed, pyGrouped, pyRound } from "../pyformat";
import type { Position } from "./store";

export interface SeriesRef {
  id: string;
  label: string;
  kind: "fred" | "market";
  /** Printed after the value: "%", "bp", "" (an index), "$". */
  unit: string;
  dp: number;
}

const fred = (id: string, label: string, unit: string, dp: number): SeriesRef => ({ id, label, kind: "fred", unit, dp });
const market = (id: string, label: string): SeriesRef => ({ id, label, kind: "market", unit: "$", dp: 2 });

export const FRED_SERIES: SeriesRef[] = [
  fred("DGS10", "10-year Treasury yield", "%", 2),
  fred("DGS2", "2-year Treasury yield", "%", 2),
  fred("BAMLH0A0HYM2", "High-yield OAS", "%", 2),
  fred("BAMLC0A0CM", "Investment-grade OAS", "%", 2),
  fred("VIXCLS", "VIX close", "", 2),
  fred("T10YIE", "10-year breakeven inflation", "%", 2),
  fred("T5YIE", "5-year breakeven inflation", "%", 2),
  fred("UNRATE", "Unemployment rate", "%", 1),
  fred("CPIAUCSL", "CPI (index)", "", 1),
  fred("INDPRO", "Industrial production (index)", "", 1),
  fred("FEDFUNDS", "Fed funds (effective)", "%", 2),
  fred("SOFR", "SOFR", "%", 2),
  fred("DFII10", "10-year TIPS yield", "%", 2),
  fred("DFII5", "5-year TIPS yield", "%", 2),
];

export const MARKET_SERIES: SeriesRef[] = [
  market("SPY", "SPY · S&P 500"),
  market("QQQ", "QQQ · Nasdaq 100"),
  market("IWM", "IWM · Russell 2000"),
  market("TLT", "TLT · 20+ year Treasuries"),
  market("IEF", "IEF · 7-10 year Treasuries"),
  market("SHY", "SHY · 1-3 year Treasuries"),
  market("HYG", "HYG · High yield"),
  market("LQD", "LQD · Investment grade"),
  market("EMB", "EMB · EM sovereign"),
  market("GLD", "GLD · Gold"),
  market("SLV", "SLV · Silver"),
  market("USO", "USO · WTI"),
  market("UNG", "UNG · Natural gas"),
  market("CPER", "CPER · Copper"),
  market("UUP", "UUP · US dollar"),
  market("EEM", "EEM · EM equity"),
  market("EFA", "EFA · Developed ex-US"),
  market("VTV", "VTV · US value"),
  market("XLE", "XLE · Energy"),
  market("XLF", "XLF · Financials"),
  market("XLI", "XLI · Industrials"),
  market("XLK", "XLK · Technology"),
  market("VIXY", "VIXY · VIX futures"),
];

export const SERIES_CATALOGUE: SeriesRef[] = [...FRED_SERIES, ...MARKET_SERIES];

export function seriesRef(id: string | null | undefined): SeriesRef | undefined {
  return id ? SERIES_CATALOGUE.find((s) => s.id === id) : undefined;
}

export interface Reading {
  value: number;
  /** The date that came in the same response as the value, and only that
   * (review R-07, round 4): a stored bar's date, or the FRED row's month
   * stamp. Null when the response carries none; then the value is shown with
   * no date and the page's badge dates the source on its own. */
  date: string | null;
  /** The date names a month: FRED rows are stored one per month, dated the
   * 1st, holding the newest in-month value (CLAUDE.md, B6). */
  monthly?: boolean;
}

/** The date a reading's own response carried, as it reads on the page:
 * "Sep 18, 2026" for a bar, "Sep 2026" for a FRED month stamp; null when the
 * response carried none (no attribution is printed). */
export function readingDate(r: Pick<Reading, "date" | "monthly">): string | null {
  if (!r.date) return null;
  return r.monthly ? fmtMonYr(r.date) : fmtDate(r.date);
}

const MINUTE = 60_000;

/** One reading from one response. The value and whatever date that response
 * carries travel together; nothing is joined from another request. */
export async function fetchReading(ref: SeriesRef, get: typeof getJson = getJson): Promise<Reading> {
  if (ref.kind === "market") {
    // The stored universe's newest bar; a wide window so a stale store still answers.
    const bars = await get<DailyBar[]>("/api/market/daily", { symbols: ref.id, days: 45 });
    const last = [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1);
    if (!last || last.close == null) throw new Error(`No stored bars for ${ref.id}.`);
    return { value: last.close, date: last.date ?? null };
  }
  const p = await get<{ series_id: string; date?: string | null; value: number }>(`/series/${encodeURIComponent(ref.id)}/latest`);
  return { value: p.value, date: p.date ?? null, monthly: p.date != null };
}

type ReadingKey = readonly ["desk", "reading", string, string];

function readingOptions(ref: SeriesRef | undefined) {
  return {
    queryKey: ["desk", "reading", ref?.kind ?? "none", ref?.id ?? ""] as ReadingKey,
    queryFn: (): Promise<Reading> => (ref ? fetchReading(ref) : Promise.reject(new Error("No series chosen."))),
    enabled: ref != null,
    staleTime: 5 * MINUTE,
    retry: 1,
  };
}

/** A failed fetch with no reading held reads "awaiting refresh"; a failed
 * refetch keeps the reading it holds, with that reading's own date. */
export function useReading(id: string | null | undefined) {
  const q = useQuery<Reading, Error, Reading, ReadingKey>(readingOptions(seriesRef(id)));
  return { ...q, awaitingRefresh: q.isError && q.data == null };
}

export interface ReadingState {
  data?: Reading;
  isLoading: boolean;
  isError: boolean;
  /** The fetch failed and no reading is held: show "awaiting refresh". */
  awaitingRefresh?: boolean;
}

/** One reading per position, keyed by the position id. */
export function useReadings(positions: readonly Position[]): Record<string, ReadingState> {
  const results = useQueries({ queries: positions.map((p) => readingOptions(seriesRef(p.falsification.series))) });
  const out: Record<string, ReadingState> = {};
  positions.forEach((p, i) => {
    const r = results[i];
    out[p.id] = { data: r?.data, isLoading: Boolean(r?.isLoading), isError: Boolean(r?.isError), awaitingRefresh: Boolean(r?.isError) && r?.data == null };
  });
  return out;
}

/* ── Distance to falsification (pure) ────────────────────────────────────── */

export function fmtValue(ref: SeriesRef | undefined, v: number): string {
  const dp = ref?.dp ?? 2;
  const s = pyGrouped(v, dp);
  if (!ref) return s;
  if (ref.unit === "$") return `$${s}`;
  return ref.unit ? `${s}${ref.unit}` : s;
}

export interface Distance {
  falsified: boolean;
  /** Signed: level − value, in the series unit. */
  gap: number;
  /** |gap| as a share of the current value; null when the value is zero. */
  pct: number | null;
}

/** Below: the thesis is wrong once the series is at or under the level; above: at or over. */
export function distanceOf(reading: Reading, level: number, direction: "above" | "below"): Distance {
  const gap = level - reading.value;
  const falsified = direction === "below" ? reading.value <= level : reading.value >= level;
  const pct = reading.value !== 0 ? Math.abs(gap) / Math.abs(reading.value) : null;
  return { falsified, gap, pct };
}

/** "4.12% now (Sep 18) · falsified below 3.80% · 0.32% away (7.8% of current)". */
export function distanceSentence(ref: SeriesRef | undefined, reading: Reading, f: { level: number; direction: "above" | "below" }): { now: string; rule: string; distance: string; falsified: boolean } {
  const d = distanceOf(reading, f.level, f.direction);
  const when = readingDate(reading);
  const now = `${fmtValue(ref, reading.value)} now${when ? ` (${when})` : ""}`;
  const rule = `falsified ${f.direction} ${fmtValue(ref, f.level)}`;
  const pct = d.pct != null ? ` (${pyFixed(d.pct * 100, 1)}% of current)` : "";
  const distance = d.falsified ? `Falsified: ${fmtValue(ref, reading.value)} is ${f.direction === "below" ? "at or under" : "at or over"} ${fmtValue(ref, f.level)}` : `${fmtValue(ref, Math.abs(d.gap))} away${pct}`;
  return { now, rule, distance, falsified: d.falsified };
}

/** The same fact in words (client view): "about 8% from its falsification level". */
export function distanceInWords(reading: Reading, f: { level: number; direction: "above" | "below" }): string {
  const d = distanceOf(reading, f.level, f.direction);
  if (d.falsified) return "at or past its falsification level";
  if (d.pct == null) return "distance unknown";
  const pct = d.pct * 100;
  if (pct < 1) return "under one percent from its falsification level";
  return `about ${pyRound(pct)}% from its falsification level`;
}
