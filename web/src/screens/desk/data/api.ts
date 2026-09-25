/**
 * The Desk v2 client (DESK_FRAME3_SPEC §12): one fetch per endpoint under
 * /api/desk/, typed by ./types, read through React Query. The page never
 * computes a number the response does not carry; it formats them.
 *
 * Errors follow §12: `{ "error": string }` with a 4xx/5xx status, surfaced as
 * DeskApiError. A screen shows "Awaiting refresh" for any error (§1.7), so no
 * card ever prints a number it was not served. 4xx answers are not retried.
 *
 * The response boundary (Codex R-09, R-10). A completed answer whose body is
 * null, not JSON, or not an object is an error ("unreadable"), so every tab
 * shows its labels with "Awaiting refresh", never an endless loading state.
 * Every field of every answer is then checked against its endpoint's schema
 * (`./schema.ts`): a statistic that is not finite becomes null, a row or
 * block missing a field it cannot be read without is dropped (its panel says
 * it is missing), and an answer missing a block it cannot be read without
 * (the study's six-slot `question`, a basket's legs) is unreadable. Every
 * panel still guards its own block: the boundary never invents one.
 * Unreadable answers are not retried.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { checkAnswer, schemaFor } from "./schema";
import type { BasketPriceResponse, BasketResponse, DeskErrorBody, HedgeResponse, LedgerResponse, MacroResponse, OverviewResponse, PipelineResponse, PositionsResponse, RegimeResponse, SectorsResponse, StudyEventsResponse, StudyResponse, TechnicalsResponse, VolResponse } from "./types";

const BASE: string = import.meta.env.VITE_API_BASE ?? "";
const TIMEOUT_MS = 15_000;

export class DeskApiError extends Error {
  readonly status: number;
  readonly body: DeskErrorBody | null;
  constructor(status: number, message: string, body: DeskErrorBody | null = null) {
    super(message);
    this.name = "DeskApiError";
    this.status = status;
    this.body = body;
  }
  /** The answer arrived but could not be read (null, not JSON, not the endpoint's shape). */
  get unreadable(): boolean {
    return this.body?.error === UNREADABLE;
  }
}

export const UNREADABLE = "unreadable";

// ── The response boundary ─────────────────────────────────────────────────

function unreadable(status: number): DeskApiError {
  return new DeskApiError(status, "The answer could not be read.", { error: UNREADABLE });
}

/** An answer's body read at the boundary against its endpoint's schema
 * (`./schema.ts`): an object whose every field is of its kind, or unreadable. */
export function readBody<T>(body: unknown, path: string, status = 200): T {
  const spec = schemaFor(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw unreadable(status);
  if (!spec) return body as T;
  const out = checkAnswer(body, spec);
  if (!out) throw unreadable(status);
  return out as T;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    throw unreadable(res.status);
  }
}

export type Params = Record<string, string | number | undefined>;

export function deskUrl(path: string, params?: Params): string {
  const qs = params
    ? Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  return `${BASE}/api/desk${path}${qs ? `?${qs}` : ""}`;
}

function signal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
}

async function readError(res: Response): Promise<DeskApiError> {
  let body: DeskErrorBody | null = null;
  try {
    const parsed = (await res.json()) as unknown;
    if (parsed && typeof parsed === "object" && typeof (parsed as DeskErrorBody).error === "string") body = parsed as DeskErrorBody;
  } catch {
    /* not JSON: keep the status line */
  }
  return new DeskApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`, body);
}

export async function deskGet<T>(path: string, params?: Params): Promise<T> {
  let res: Response;
  try {
    res = await fetch(deskUrl(path, params), { headers: { Accept: "application/json" }, signal: signal() });
  } catch {
    throw new DeskApiError(0, "The data service did not answer.");
  }
  if (!res.ok) throw await readError(res);
  return readBody<T>(await readJson(res), path, res.status);
}

export async function deskPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(deskUrl(path), { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal() });
  } catch {
    throw new DeskApiError(0, "The data service did not answer.");
  }
  if (!res.ok) throw await readError(res);
  return readBody<T>(await readJson(res), path, res.status);
}

/** One retry for a failed or 5xx answer; never for a refusal (4xx) or an answer that arrived unreadable. */
const retry = (count: number, err: unknown) => count < 1 && !(err instanceof DeskApiError && (err.unreadable || (err.status >= 400 && err.status < 500)));

function useDesk<T>(path: string, params?: Params) {
  return useQuery<T, DeskApiError>({
    queryKey: ["desk-v2", path, params ?? null],
    queryFn: () => deskGet<T>(path, params),
    staleTime: 60_000,
    retry,
  });
}

export const useOverview = () => useDesk<OverviewResponse>("/overview");
export const useLedger = () => useDesk<LedgerResponse>("/ledger");
export const useTechnicals = () => useDesk<TechnicalsResponse>("/technicals");
export const useVol = () => useDesk<VolResponse>("/vol");
export const useSectors = () => useDesk<SectorsResponse>("/sectors");
export const useRegime = () => useDesk<RegimeResponse>("/regime");
export const useMacro = () => useDesk<MacroResponse>("/macro");

/** §12.2: one study; the previous answer stays on screen while the next is asked. */
export function useStudy(params: Params, opts: { enabled?: boolean } = {}) {
  return useQuery<StudyResponse, DeskApiError>({
    queryKey: ["desk-v2", "/study", params],
    queryFn: () => deskGet<StudyResponse>("/study", params),
    staleTime: 60_000,
    retry,
    placeholderData: keepPreviousData,
    enabled: opts.enabled ?? true,
  });
}

/** §12.8: the open positions and the last 90 days' closed ones. */
export const usePositions = () => useDesk<PositionsResponse>("/positions");

/** §12.11: the series inventory, grouped, from the pipeline config. */
export const usePipeline = () => useDesk<PipelineResponse>("/pipeline");

/** §12.12: one basket the server keeps (PROPOSED shape, §12.13). */
export function useBasket(id: string, opts: { enabled?: boolean } = {}) {
  return useQuery<BasketResponse, DeskApiError>({
    queryKey: ["desk-v2", "/basket", id],
    queryFn: () => deskGet<BasketResponse>(`/basket/${encodeURIComponent(id)}`),
    staleTime: 60_000,
    retry,
    enabled: opts.enabled ?? true,
  });
}

/** §12.12: a set of legs priced without saving (POST, but it writes nothing, so it is read as a query). */
export function useBasketPrice(legs: { symbol: string; weight: number }[] | null) {
  return useQuery<BasketPriceResponse, DeskApiError>({
    queryKey: ["desk-v2", "/basket/price", legs],
    queryFn: () => deskPost<BasketPriceResponse>("/basket/price", { legs }),
    staleTime: 60_000,
    retry,
    enabled: !!legs,
  });
}

/** §12.12: the hedge for a basket, a set of legs, a position or a study. */
export function useHedge(params: Params, opts: { enabled?: boolean } = {}) {
  return useQuery<HedgeResponse, DeskApiError>({
    queryKey: ["desk-v2", "/hedge", params],
    queryFn: () => deskGet<HedgeResponse>("/hedge", params),
    staleTime: 60_000,
    retry,
    enabled: opts.enabled ?? true,
  });
}

/** §12.3: the events behind a study (the Advanced panel). */
export const useStudyEvents = (params: Params) => useDesk<StudyEventsResponse>("/study/events", params);
