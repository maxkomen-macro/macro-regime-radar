/**
 * Desk data hooks (desk/frame, docs/desk/DESK_FRAME_SPEC.md). Two contracts:
 *
 * - `/api/desk/pipeline/inventory` (§7, this branch): the freshness report's
 *   series[] joined with each source's provider and readers. Same states as
 *   /api/freshness, so a Data Pipeline row and a status badge never disagree.
 * - `/api/desk/event-study` and `/api/desk/event-study/assets` (Stream A,
 *   docs/desk/EVENT_STUDY_SPEC.md §7): typed here from the spec so the panel
 *   is wired before the engine lands. Field names are provisional until
 *   EVENT_STUDY_REPORT.md fixes them; a 404 is the engine's absence, and the
 *   panel then shows its labelled fixture (never silently).
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

/* ── Event study (Stream A contract) ─────────────────────────────────────── */

export type ShockUnit = "log_return" | "bp" | "log_change";

export interface EventStudyAsset {
  id: string;
  label: string;
  shock_unit: ShockUnit;
  /** First date with history, YYYY-MM-DD. Lists warn when it is after 1990. */
  history_from: string;
  /** Short series: selectable, with the warning shown (spec §3). */
  warn?: boolean;
}

export interface EventStudyAssets {
  shock_assets: EventStudyAsset[];
  targets: EventStudyAsset[];
  conditions: { id: string; label: string }[];
  regimes: string[];
  windows: number[];
  thresholds: number[];
  horizons: number[];
}

export interface EventStudyParams {
  shock: string;
  w: number;
  z: number;
  sign: "+" | "-";
  cond: string;
  regime: string;
  target: string;
}

export interface EventStudyHorizon {
  h: number;
  n: number;
  hit_rate: number;
  median: number;
  mean: number;
  p25: number;
  p75: number;
  baseline_median: number;
  baseline_hit_rate: number;
  /** median − baseline median. */
  delta: number;
  /** 90% bootstrap interval on delta, [low, high]. */
  ci90: [number, number];
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
  z: number;
  /** Forward move per horizon, in the target's unit; null when the window is incomplete. */
  forward: Record<string, number | null>;
}

export interface EventStudyProvenance {
  as_of: string;
  sample_start: string;
  sample_end: string;
  n_events: number;
  cooldown: number;
  seed: number;
  inputs_hash: string;
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
  params: EventStudyParams;
  shock: { label: string; unit: ShockUnit };
  target: { label: string; unit: ShockUnit };
  condition: { label: string } | null;
  horizons: EventStudyHorizon[];
  regime_split: EventStudyRegimeRow[];
  recent_events: EventStudyEvent[];
  verdict: { text: string; points: string[] };
  provenance: EventStudyProvenance;
  /** Provisional: the spec lists no distribution payload; the panel prints
   * "not served" when it is absent. */
  distribution?: EventStudyDistribution | null;
}

/** True when the API answered "no such route": the engine has not landed. */
export function isEngineAbsent(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useEventStudyAssets() {
  return useQuery({
    queryKey: ["desk", "event-study", "assets"],
    queryFn: () => getJson<EventStudyAssets>("/api/desk/event-study/assets"),
    staleTime: 30 * MINUTE,
    retry: false,
  });
}

export function useEventStudy(params: EventStudyParams | null) {
  return useQuery({
    queryKey: ["desk", "event-study", params],
    queryFn: () => getJson<EventStudyResponse>("/api/desk/event-study", params ? { ...params, w: String(params.w), z: String(params.z) } : undefined),
    enabled: params != null,
    staleTime: 15 * MINUTE,
    retry: false,
  });
}
