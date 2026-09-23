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
import type { Freshness } from "../../../api/types";
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
  /** The observation's own date: a stored bar's date, or for a FRED series
   * the freshness report's observation date served by the same data
   * generation as the value (review R-07); null when that cannot be shown.
   * Never the month stamp /series/{id}/latest carries. */
  date: string | null;
  /** A monthly series: the date names a month. */
  monthly?: boolean;
  /** The data generation both halves of a FRED pair came from. */
  generation?: number | null;
}

/** "Sep 17, 2026", "Aug 2026" for a monthly series, or "date unknown". */
export function readingDate(r: Pick<Reading, "date" | "monthly">): string {
  if (!r.date) return "date unknown";
  return r.monthly ? fmtMonYr(r.date) : fmtDate(r.date);
}

/** The parts of /api/freshness a FRED pair reads. */
type FreshnessLite = Pick<Freshness, "series" | "generation">;

/** A FRED value and its observation date as one pair from one data generation
 * (review R-07). /series/{id}/latest carries no generation, so the value is
 * read between two freshness reads: generations only advance, so when both
 * name the same generation the value was served by it too, and that report's
 * observation date belongs to that value. Another generation published in
 * between: read the pair again, once; still split, refuse (the caller shows
 * the old pair it holds, or "unavailable"). A report without generations
 * (an older API) gives the value with no date ("date unknown"). The pair is
 * cached as one object, so a refetch that fails keeps the old value with its
 * old date, and a newer date is never attached to a cached value. */
export async function fetchFredPair(ref: SeriesRef, get: typeof getJson = getJson): Promise<Reading> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await get<FreshnessLite>("/api/freshness");
    const p = await get<{ series_id: string; date: string; value: number }>(`/series/${encodeURIComponent(ref.id)}/latest`);
    const after = await get<FreshnessLite>("/api/freshness");
    const g1 = before.generation?.id ?? null;
    const g2 = after.generation?.id ?? null;
    if (g1 == null && g2 == null) return { value: p.value, date: null, generation: null };
    if (g1 != null && g1 === g2) {
      const s = before.series?.find((x) => x.id === ref.id);
      return { value: p.value, date: s?.as_of ? s.as_of.slice(0, 10) : null, monthly: s?.cadence === "monthly", generation: g1 };
    }
  }
  throw new Error(`The ${ref.id} reading and its date came from different data generations twice; not shown.`);
}

const MINUTE = 60_000;

async function fetchReading(ref: SeriesRef): Promise<Reading> {
  if (ref.kind === "market") {
    // The stored universe's newest bar; a wide window so a stale store still answers.
    const bars = await getJson<DailyBar[]>("/api/market/daily", { symbols: ref.id, days: 45 });
    const last = [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).at(-1);
    if (!last || last.close == null) throw new Error(`No stored bars for ${ref.id}.`);
    return { value: last.close, date: last.date };
  }
  return fetchFredPair(ref);
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

export function useReading(id: string | null | undefined) {
  return useQuery<Reading, Error, Reading, ReadingKey>(readingOptions(seriesRef(id)));
}

export interface ReadingState {
  data?: Reading;
  isLoading: boolean;
  isError: boolean;
}

/** One reading per position, keyed by the position id. */
export function useReadings(positions: readonly Position[]): Record<string, ReadingState> {
  const results = useQueries({ queries: positions.map((p) => readingOptions(seriesRef(p.falsification.series))) });
  const out: Record<string, ReadingState> = {};
  positions.forEach((p, i) => {
    out[p.id] = { data: results[i]?.data, isLoading: Boolean(results[i]?.isLoading), isError: Boolean(results[i]?.isError) };
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
  const now = `${fmtValue(ref, reading.value)} now (${readingDate(reading)})`;
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
