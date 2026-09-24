/**
 * The Desk v2 client (DESK_FRAME3_SPEC §12): one fetch per endpoint under
 * /api/desk/, typed by ./types, read through React Query. The page never
 * computes a number the response does not carry; it formats them.
 *
 * Errors follow §12: `{ "error": string }` with a 4xx/5xx status, surfaced as
 * DeskApiError. A screen shows "Awaiting refresh" for any error (§1.7), so no
 * card ever prints a number it was not served. 4xx answers are not retried.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DeskErrorBody, LedgerResponse, MacroResponse, OverviewResponse, RegimeResponse, SectorsResponse, StudyEventsResponse, StudyResponse, TechnicalsResponse, VolResponse } from "./types";

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
  return (await res.json()) as T;
}

export async function deskPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(deskUrl(path), { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal() });
  } catch {
    throw new DeskApiError(0, "The data service did not answer.");
  }
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

const retry = (count: number, err: unknown) => count < 1 && !(err instanceof DeskApiError && err.status >= 400 && err.status < 500);

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
export function useStudy(params: Params) {
  return useQuery<StudyResponse, DeskApiError>({
    queryKey: ["desk-v2", "/study", params],
    queryFn: () => deskGet<StudyResponse>("/study", params),
    staleTime: 60_000,
    retry,
    placeholderData: keepPreviousData,
  });
}

/** §12.3: the events behind a study (the Advanced panel). */
export const useStudyEvents = (params: Params) => useDesk<StudyEventsResponse>("/study/events", params);
