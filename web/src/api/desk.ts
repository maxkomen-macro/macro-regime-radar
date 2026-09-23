/**
 * Desk data hooks (desk/frame, docs/desk/DESK_FRAME_SPEC.md). Two contracts:
 *
 * - `/api/desk/pipeline/inventory` (§7, this branch): the freshness report's
 *   series[] joined with each source's provider and readers. Same states as
 *   /api/freshness, so a Data Pipeline row and a status badge never disagree.
 * - `/api/desk/event-study` and `/api/desk/event-study/assets` (the engine,
 *   docs/desk/EVENT_STUDY_REPORT.md §5). The frame typed the panel from the
 *   spec before the engine landed; since desk/integration the engine's real
 *   payloads (Engine* below) are adapted to the page's types here, in one
 *   place, and a 404 (a server without the engine) still shows the labelled
 *   fixture, never silently.
 *
 * Kept apart from api/queries.ts: the hook-coverage suite scans that file
 * for the redesign's parity list, and these hooks belong to the Desk.
 */

import { useQuery } from "@tanstack/react-query";
import { ApiError, getJson } from "./client";
import type { SeriesState } from "./types";

const MINUTE = 60_000;

/* ── Pipeline inventory ──────────────────────────────────────────────────── */

export interface InventoryRow extends SeriesState {
  /** The provider in reader words: "FRED", "yfinance (stored daily bars)", "EODHD relay". */
  source: string;
  /** The provider's own id for the series (FRED ids), else null. */
  source_id: string | null;
  /** The modules that read it, in reader words. */
  feeds: string[];
}

export interface PipelineInventory {
  generated_at: string | null;
  overall: "current" | "delayed" | "stale" | "unavailable" | null;
  regimes_date: string | null;
  signals_date: string | null;
  market_daily_date: string | null;
  market_intraday_ts: string | null;
  news_published_at: string | null;
  raw_series_date: string | null;
  series: InventoryRow[];
}

export function useDeskInventory() {
  return useQuery({
    queryKey: ["desk", "pipeline", "inventory"],
    queryFn: () => getJson<PipelineInventory>("/api/desk/pipeline/inventory"),
    staleTime: 30_000,
    refetchInterval: MINUTE,
  });
}

/* ── Event study: the page's types ───────────────────────────────────────── */

export type ShockUnit = "log_return" | "bp" | "log_change";

export interface EventStudyAsset {
  id: string;
  label: string;
  shock_unit: ShockUnit;
  /** First date with history, YYYY-MM-DD. Lists warn when it is after 1990. */
  history_from: string;
  /** Short series: selectable, with the warning shown (spec §3). */
  warn?: boolean;
  /** The engine's status: stored, or awaiting the first full refresh. */
  status?: string;
}

export interface EventStudyAssets {
  shock_assets: EventStudyAsset[];
  targets: EventStudyAsset[];
  conditions: { id: string; label: string }[];
  /** "all" then the regimes as slug words (goldilocks, …, recession_risk). */
  regimes: string[];
  windows: number[];
  thresholds: number[];
  horizons: number[];
  signs?: EventStudyParams["sign"][];
  presets?: { slug: string; label: string }[];
  /** Labels of the series a study cannot read until the full refresh stores them. */
  awaiting?: string[];
}

/** A study in the page's terms. `cond` is "none", a condition key, or a key
 * with its value as the slug writes it ("vix_above=20.0", "regime=stagflation");
 * `regime` is "all" or a slug word. A cross fixes the shock fields. */
export interface EventStudyParams {
  kind: "shock" | "cross";
  cross: "golden" | "death" | null;
  shock: string;
  w: number;
  z: number;
  sign: "+" | "-" | "both";
  cond: string;
  regime: string;
  target: string;
}

export interface EventStudyHorizon {
  h: number;
  n: number;
  hit_rate: number | null;
  /** Moves in the target's display unit: percent for returns, bp for yields and spreads. */
  median: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  baseline_median: number | null;
  baseline_hit_rate: number | null;
  /** median − baseline median. */
  delta: number | null;
  /** 90% cluster-bootstrap interval on delta, [low, high]; null below five blocks. */
  ci90: [number, number] | null;
  n_blocks?: number | null;
  exclusion?: string | null;
  note?: string | null;
}

export interface EventStudyRegimeRow {
  regime: string;
  n: number;
  /** Per horizon; null where the engine suppressed the read (N < 10). */
  by_horizon: Record<string, { hit_rate: number | null; median: number | null }>;
  suppressed: boolean;
}

export interface EventStudyEvent {
  date: string;
  regime: string;
  /** The shock's z at the event; null for a cross. */
  z: number | null;
  entry_date?: string;
  /** Forward move per horizon, in the target's display unit; null when the window is incomplete. */
  forward: Record<string, number | null>;
}

export interface EventStudyProvenance {
  as_of: string;
  sample_start: string;
  sample_end: string;
  n_events: number;
  /** Cooldown in sessions; null for a cross (it cannot recur before the opposite cross). */
  cooldown: number | null;
  seed: number;
  inputs_hash: string;
  n_boot?: number;
  bootstrap?: string;
}

export interface EventStudyDistribution {
  /** The horizon the bins describe. */
  h: number;
  /** Bin edges in the target's unit (length = counts + 1). */
  edges: number[];
  conditional: number[];
  baseline: number[];
}

export interface EventStudyResponse {
  slug: string;
  kind?: "shock" | "cross";
  /** The engine's own one-line name for the study. */
  label?: string;
  params: EventStudyParams;
  shock: { label: string; unit: ShockUnit };
  target: { label: string; unit: ShockUnit };
  condition: { label: string } | null;
  horizons: EventStudyHorizon[];
  regime_split: EventStudyRegimeRow[];
  recent_events: EventStudyEvent[];
  verdict: { text: string; points: string[] };
  provenance: EventStudyProvenance;
  /** The engine serves no histogram bins; the panel prints "not served" when absent. */
  distribution?: EventStudyDistribution | null;
}

/** What one request for a study can answer (EVENT_STUDY_REPORT §5, plus
 * desk/integration's awaiting state). 429 busy, 422 and 503 arrive as ApiError. */
export type EventStudyResult =
  | { state: "ready"; study: EventStudyResponse }
  | { state: "computing"; slug: string; detail: string }
  | { state: "awaiting_refresh"; slug: string; series: string | null; detail: string };

/* ── Event study: the engine's payloads (src/desk/event_study.py) ─────────── */

export interface EngineAsset {
  key: string;
  label: string;
  shock_unit: ShockUnit;
  history_from: string;
  warn: boolean;
  status: "stored" | "awaiting_refresh" | "planned" | "deferred" | "unavailable";
  [more: string]: unknown;
}

export interface EngineAssets {
  shocks: EngineAsset[];
  targets: EngineAsset[];
  conditions: { key: string; label: string; series: string | null; param: "level" | "bp" | "regime" | null }[];
  windows: number[];
  thresholds: number[];
  signs: EventStudyParams["sign"][];
  horizons: number[];
  regimes: string[];
  presets: { slug: string; kind: string }[];
  awaiting_refresh?: string[];
  [more: string]: unknown;
}

interface EngineHorizon {
  h: number;
  n: number;
  hit_rate: number | null;
  median: number | null;
  mean: number | null;
  p25: number | null;
  p75: number | null;
  baseline_median: number | null;
  baseline_hit_rate: number | null;
  delta: number | null;
  ci90: [number, number] | null;
  n_blocks: number | null;
  exclusion: string | null;
  note: string | null;
}

interface EngineQuery {
  kind: "shock" | "cross";
  shock: string;
  w: number;
  z: number;
  sign: EventStudyParams["sign"];
  cond: string | null;
  cond_value: number | string | null;
  regime: string;
  target: string;
  cross: "golden" | "death" | null;
}

export type EngineAnswer =
  | {
      status: "ready";
      study: {
        slug: string;
        kind: "shock" | "cross";
        label: string;
        params: EngineQuery;
        shock: { key: string; label: string; unit: ShockUnit };
        condition: { key: string; label: string } | null;
        target: { key: string; label: string; unit: ShockUnit; format: "pct" | "bp" };
      };
      horizons: EngineHorizon[];
      regimes: { regime: string; n_events: number; excluded_from_totals: boolean; horizons: { h: number; hit_rate: number | null; median: number | null }[] }[];
      recent_events: { date: string; z: number | null; regime: string; entry_date: string; moves: Record<string, number | null> }[];
      verdict: { text: string; sentences: string[] };
      provenance: { as_of: string; sample_start: string; sample_end: string; n_events: number; cooldown_sessions: number | null; seed: number; n_boot: number; bootstrap: string; inputs_hash: string; [more: string]: unknown };
    }
  | { status: "computing"; slug: string; retry_after: number; detail: string }
  | { status: "awaiting_refresh"; slug: string; series: string | null; detail: string };

/* ── Event study: the adapter ─────────────────────────────────────────────── */

export const REGIME_ID: Record<string, string> = { Goldilocks: "goldilocks", Overheating: "overheating", Stagflation: "stagflation", "Recession Risk": "recession_risk" };

/** The value the builder offers for a condition that takes one: VIX above 20,
 * HY OAS up more than 25 bp over 20 sessions (the frame's fixture values). */
const COND_VALUE: Record<"level" | "bp", number> = { level: 20, bp: 25 };

const PRESET_LABEL: Record<string, string> = {
  "gold-2sigma-spx-weak": "Gold ≥ +2σ while the S&P 500 is below its 50-day average",
  "spx-golden-cross": "S&P 500 golden cross",
  "spx-death-cross": "S&P 500 death cross",
};

/** Python's repr for the builder's numbers (studies.ts carries the same rule). */
function num(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

function asset(a: EngineAsset): EventStudyAsset {
  return { id: a.key, label: a.label, shock_unit: a.shock_unit, history_from: a.history_from, warn: a.warn, status: a.status };
}

export function toPageAssets(a: EngineAssets): EventStudyAssets {
  // Selectable: stored, or stored by the full refresh this database predates (a
  // study on it answers "awaiting the first full refresh"). Planned, deferred and
  // unavailable series stay out of the builder.
  const selectable = (x: EngineAsset) => x.status === "stored" || x.status === "awaiting_refresh";
  const labelOf = new Map([...a.shocks, ...a.targets].map((x) => [x.key, x.label]));
  return {
    shock_assets: a.shocks.filter(selectable).map(asset),
    targets: a.targets.filter(selectable).map(asset),
    conditions: [
      { id: "none", label: "No co-condition" },
      ...a.conditions
        .filter((c) => c.param !== "regime") // the regime filter covers it
        .map((c) =>
          c.param == null
            ? { id: c.key, label: c.label }
            : { id: `${c.key}=${num(COND_VALUE[c.param as "level" | "bp"])}`, label: c.label.replace("{value:g}", String(COND_VALUE[c.param as "level" | "bp"])) },
        ),
    ],
    regimes: ["all", ...a.regimes.map((r) => REGIME_ID[r] ?? r)],
    windows: a.windows,
    thresholds: a.thresholds,
    horizons: a.horizons,
    signs: a.signs,
    presets: a.presets.map((p) => ({ slug: p.slug, label: PRESET_LABEL[p.slug] ?? p.slug })),
    awaiting: (a.awaiting_refresh ?? []).map((k) => labelOf.get(k) ?? k),
  };
}

function toPageParams(q: EngineQuery): EventStudyParams {
  const regime = q.regime === "all" ? "all" : REGIME_ID[q.regime] ?? q.regime;
  if (q.kind === "cross") return { kind: "cross", cross: q.cross, shock: "spx", w: 20, z: 2, sign: "+", cond: "none", regime, target: q.target };
  const cond =
    q.cond == null ? "none" : q.cond_value == null ? q.cond : `${q.cond}=${q.cond === "regime" ? REGIME_ID[String(q.cond_value)] ?? q.cond_value : num(Number(q.cond_value))}`;
  return { kind: "shock", cross: null, shock: q.shock, w: q.w, z: q.z, sign: q.sign, cond, regime, target: q.target };
}

export function toStudyResult(a: EngineAnswer): EventStudyResult {
  if (a.status === "computing") return { state: "computing", slug: a.slug, detail: a.detail };
  if (a.status === "awaiting_refresh") return { state: "awaiting_refresh", slug: a.slug, series: a.series, detail: a.detail };
  // The engine serves a return or a VIX change as a fraction and a yield or spread in bp.
  const k = a.study.target.format === "bp" ? 1 : 100;
  const m = (x: number | null | undefined): number | null => (x == null ? null : x * k);
  const study: EventStudyResponse = {
    slug: a.study.slug,
    kind: a.study.kind,
    label: a.study.label,
    params: toPageParams(a.study.params),
    shock: { label: a.study.shock.label, unit: a.study.shock.unit },
    target: { label: a.study.target.label, unit: a.study.target.unit },
    condition: a.study.condition ? { label: a.study.condition.label } : null,
    horizons: a.horizons.map((h) => ({
      h: h.h,
      n: h.n,
      hit_rate: h.hit_rate,
      median: m(h.median),
      mean: m(h.mean),
      p25: m(h.p25),
      p75: m(h.p75),
      baseline_median: m(h.baseline_median),
      baseline_hit_rate: h.baseline_hit_rate,
      delta: m(h.delta),
      ci90: h.ci90 ? [h.ci90[0] * k, h.ci90[1] * k] : null,
      n_blocks: h.n_blocks,
      exclusion: h.exclusion,
      note: h.note,
    })),
    regime_split: a.regimes.map((r) => ({
      regime: r.excluded_from_totals ? `${r.regime} (outside the totals)` : r.regime,
      n: r.n_events,
      suppressed: r.horizons.every((x) => x.median == null),
      by_horizon: Object.fromEntries(r.horizons.map((x) => [String(x.h), { hit_rate: x.hit_rate, median: m(x.median) }])),
    })),
    recent_events: a.recent_events.map((e) => ({
      date: e.date,
      regime: e.regime,
      z: e.z,
      entry_date: e.entry_date,
      forward: Object.fromEntries(Object.entries(e.moves).map(([h, v]) => [h, m(v)])),
    })),
    verdict: { text: a.verdict.text, points: a.verdict.sentences },
    provenance: {
      as_of: a.provenance.as_of,
      sample_start: a.provenance.sample_start,
      sample_end: a.provenance.sample_end,
      n_events: a.provenance.n_events,
      cooldown: a.provenance.cooldown_sessions,
      seed: a.provenance.seed,
      inputs_hash: a.provenance.inputs_hash,
      n_boot: a.provenance.n_boot,
      bootstrap: a.provenance.bootstrap,
    },
    distribution: null,
  };
  return { state: "ready", study };
}

/* ── Event study: the hooks ───────────────────────────────────────────────── */

/** True when the API answered "no such route": a server without the engine. */
export function isEngineAbsent(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

/** Retry what the API marks retryable (503 warming right after a deploy, a
 * client-side timeout, 429 busy) up to three times, three seconds apart;
 * never a 404 (no engine), a 422 or a not_stored (verifier V-03). */
export function deskRetry(failures: number, err: unknown): boolean {
  return err instanceof ApiError && err.retryable && failures < 3;
}

export function useEventStudyAssets() {
  return useQuery({
    queryKey: ["desk", "event-study", "assets"],
    queryFn: async () => toPageAssets(await getJson<EngineAssets>("/api/desk/event-study/assets")),
    staleTime: 30 * MINUTE,
    retry: deskRetry,
    retryDelay: 3_000,
  });
}

/** One study by its engine slug. A 202 `computing` is polled every 3 s (the
 * engine's Retry-After) until it is ready; a retryable error (429 busy, 503
 * warming, a timeout) is retried a few times; 422 and 503 not_stored surface
 * as errors with the engine's reason. */
export function useEventStudy(slug: string | null) {
  return useQuery({
    queryKey: ["desk", "event-study", slug],
    queryFn: async () => toStudyResult(await getJson<EngineAnswer>("/api/desk/event-study", slug ? { study: slug } : undefined)),
    enabled: slug != null,
    staleTime: 15 * MINUTE,
    refetchInterval: (q) => (q.state.data?.state === "computing" ? 3_000 : false),
    retry: deskRetry,
    retryDelay: 3_000,
  });
}
