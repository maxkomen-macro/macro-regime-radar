/**
 * The Desk v2 client (DESK_FRAME3_SPEC §12): one fetch per endpoint under
 * /api/desk/, typed by ./types, read through React Query. The page never
 * computes a number the response does not carry; it formats them.
 *
 * The envelope (§12.0, `./envelope.ts`). Every answer is `{status,
 * generation_id, as_of, engine_version, data, unavailable, error}`:
 * - `ready`: `data` is read, its block envelopes taken apart at exactly the
 *   listed paths (an awaiting block's reason is kept under `_blocks`), and the
 *   envelope's `as_of`, `generation_id` and `engine_version` put beside it;
 * - `computing` (202, `Retry-After`): the same URL is asked again after the
 *   served wait, while the card stays quiet and busy (§1.7);
 * - `awaiting`: a DeskApiError carrying the served `unavailable`, which the
 *   page prints as the unavailable state (§1.0.2), never retried;
 * - `error` (4xx/5xx): a DeskApiError with the served `error.code` and
 *   message. A screen shows "Awaiting refresh" for an error (§1.7), so no
 *   card ever prints a number it was not served. 4xx answers are not retried.
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
import { isEnvelope, readUnavailable, routeOf, unwrapBlocks, type Unavailable } from "./envelope";
import { checkAnswer, schemaFor } from "./schema";
import type { BasketPriceResponse, BasketResponse, DeskErrorBody, HedgeResponse, LedgerResponse, MacroResponse, OverviewResponse, PipelineResponse, PositionsResponse, RegimeResponse, SectorsResponse, StudyCatalogResponse, StudyEventsResponse, StudyResponse, TechnicalsResponse } from "./types";

const BASE: string = import.meta.env.VITE_API_BASE ?? "";
const TIMEOUT_MS = 15_000;

export class DeskApiError extends Error {
  readonly status: number;
  readonly body: DeskErrorBody | null;
  /** Served when the answer is `awaiting` (§1.0.2): why it is not served, and until when. */
  readonly unavailable: Unavailable | null;
  constructor(status: number, message: string, body: DeskErrorBody | null = null, unavailable: Unavailable | null = null) {
    super(message);
    this.name = "DeskApiError";
    this.status = status;
    this.body = body;
    this.unavailable = unavailable;
  }
  /** The answer arrived but could not be read (null, not JSON, not the endpoint's shape). */
  get unreadable(): boolean {
    return this.body?.error === UNREADABLE;
  }
  /** The answer is `awaiting`: the endpoint or study is not served yet, with its reason. */
  get awaiting(): boolean {
    return this.unavailable !== null;
  }
}

export const UNREADABLE = "unreadable";

/** The served reason when an error is an awaiting answer (§1.0.2), else null. */
export function unavailableOf(err: unknown): Unavailable | null {
  return err instanceof DeskApiError ? err.unavailable : null;
}

// ── The response boundary ─────────────────────────────────────────────────

function unreadable(status: number): DeskApiError {
  return new DeskApiError(status, "The answer could not be read.", { error: UNREADABLE });
}

/** A ready answer's payload read at the boundary against its endpoint's schema
 * (`./schema.ts`): an object whose every field is of its kind, or unreadable. */
export function readBody<T>(body: unknown, path: string, status = 200): T {
  const spec = schemaFor(path);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw unreadable(status);
  if (!spec) return body as T;
  const out = checkAnswer(body, spec);
  if (!out) throw unreadable(status);
  // §12.2: `question.window` is null for a cross, and only for one; a study asking a 2σ move with no window cannot be labelled.
  const q = (out as { question?: { window?: unknown; move?: unknown } }).question;
  if (path === "/study" && q && q.window === null && q.move !== "cross_above" && q.move !== "cross_below") throw unreadable(status);
  return out as T;
}

/**
 * A whole answer read at the boundary (§12.0): the envelope first, then a
 * ready answer's payload with its block envelopes taken apart and its schema
 * checked. An awaiting answer throws its reason; an error answer its code.
 * Anything that is not an envelope is unreadable.
 */
export function readAnswer<T>(body: unknown, path: string, status = 200): T {
  if (!isEnvelope(body)) throw unreadable(status);
  if (body.status === "awaiting") {
    const u = readUnavailable(body.unavailable);
    if (!u) throw unreadable(status);
    throw new DeskApiError(status, u.reason, { error: "awaiting" }, u);
  }
  if (body.status === "error") throw errorFrom(status, body.error);
  if (body.status !== "ready") throw unreadable(status);
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw unreadable(status);
  const { data: plain, blocks } = unwrapBlocks(routeOf(path), data as Record<string, unknown>);
  const checked = readBody<Record<string, unknown>>(plain, path, status);
  return {
    ...checked,
    ...(typeof body.as_of === "string" ? { as_of: body.as_of } : {}),
    ...(typeof body.generation_id === "string" ? { generation_id: body.generation_id } : {}),
    engine_version: body.engine_version,
    _blocks: blocks,
  } as T;
}

/** A served error (`error: {code, message, …}`) as a DeskApiError; its extra fields (a refusal's `missing`, `words`) stay on the body. */
function errorFrom(status: number, err: unknown): DeskApiError {
  if (!err || typeof err !== "object") return new DeskApiError(status, `${status}`);
  const { code, message, ...extra } = err as Record<string, unknown>;
  const c = typeof code === "string" ? code : String(status);
  return new DeskApiError(status, typeof message === "string" && message ? message : c, { error: c, ...(typeof message === "string" ? { message } : {}), ...extra } as DeskErrorBody);
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

/** The request's abort: the caller's (a query that is no longer wanted) and the timeout, whichever comes first. */
function signal(outer?: AbortSignal): AbortSignal | undefined {
  const timeout = typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
  if (!outer) return timeout;
  if (!timeout) return outer;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([outer, timeout]);
  // Without AbortSignal.any: one controller that follows whichever fires first.
  const ctl = new AbortController();
  for (const s of [outer, timeout]) {
    if (s.aborted) ctl.abort(s.reason);
    else s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

/** A refusal or failure (4xx/5xx): the served error envelope, or a bare `{error}` body, or the status line. */
async function readError(res: Response): Promise<DeskApiError> {
  let parsed: unknown = null;
  try {
    parsed = (await res.json()) as unknown;
  } catch {
    /* not JSON: keep the status line */
  }
  if (isEnvelope(parsed) && parsed.status === "error" && parsed.error) return errorFrom(res.status, parsed.error);
  if (isEnvelope(parsed) && parsed.status === "awaiting") {
    const u = readUnavailable(parsed.unavailable);
    if (u) return new DeskApiError(res.status, u.reason, { error: "awaiting" }, u);
  }
  if (parsed && typeof parsed === "object" && typeof (parsed as DeskErrorBody).error === "string") {
    const body = parsed as DeskErrorBody;
    return new DeskApiError(res.status, body.error, body);
  }
  return new DeskApiError(res.status, `${res.status} ${res.statusText}`, null);
}

/** How long a `computing` answer asks us to wait (`Retry-After`, seconds), within reason; 2 s when absent or unreadable. */
export function retryAfterMs(res: Pick<Response, "headers">): number {
  const h = res.headers.get("Retry-After");
  if (h === null || h.trim() === "") return 2000;
  const s = Number(h);
  return Number.isFinite(s) && s >= 0 ? Math.min(s, 30) * 1000 : 2000;
}

function sleep(ms: number, outer?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (outer?.aborted) return reject(outer.reason);
    const onAbort = () => (clearTimeout(t), reject(outer?.reason));
    const t = setTimeout(() => (outer?.removeEventListener("abort", onAbort), resolve()), ms);
    outer?.addEventListener("abort", onAbort, { once: true });
  });
}

/** How many times a `computing` answer is asked again before the page says it did not come. */
export const MAX_POLLS = 60;

export async function deskGet<T>(path: string, params?: Params, opts: { signal?: AbortSignal } = {}): Promise<T> {
  for (let polls = 0; ; polls++) {
    let res: Response;
    try {
      res = await fetch(deskUrl(path, params), { headers: { Accept: "application/json" }, signal: signal(opts.signal) });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      throw new DeskApiError(0, "The data service did not answer.");
    }
    if (!res.ok) throw await readError(res);
    if (res.status === 202) {
      // §12.0: still computing; ask the same URL again after the served wait.
      if (polls >= MAX_POLLS) throw new DeskApiError(202, "The answer is still being computed.", { error: "computing" });
      await sleep(retryAfterMs(res), opts.signal);
      continue;
    }
    return readAnswer<T>(await readJson(res), path, res.status);
  }
}

export async function deskPost<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(deskUrl(path), { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body), signal: signal() });
  } catch {
    throw new DeskApiError(0, "The data service did not answer.");
  }
  if (!res.ok) throw await readError(res);
  return readAnswer<T>(await readJson(res), path, res.status);
}

/** One retry for an answer that did not come (no answer, or a 5xx); never for a refusal, an error the
 * server served with a 2xx, an answer that arrived unreadable, one not served yet, or a poll that ran out. */
export const retry = (count: number, err: unknown) => count < 1 && (!(err instanceof DeskApiError) || ((err.status === 0 || err.status >= 500) && !err.unreadable && !err.awaiting));

function useDesk<T>(path: string, params?: Params) {
  return useQuery<T, DeskApiError>({
    queryKey: ["desk-v2", path, params ?? null],
    queryFn: ({ signal: s }) => deskGet<T>(path, params, { signal: s }),
    staleTime: 60_000,
    retry,
  });
}

export const useOverview = () => useDesk<OverviewResponse>("/overview");
export const useLedger = () => useDesk<LedgerResponse>("/ledger");
export const useTechnicals = () => useDesk<TechnicalsResponse>("/technicals");
export const useSectors = () => useDesk<SectorsResponse>("/sectors");
export const useRegime = () => useDesk<RegimeResponse>("/regime");
export const useMacro = () => useDesk<MacroResponse>("/macro");

/** §12.2: one study; the previous answer stays on screen while the next is asked. */
export function useStudy(params: Params, opts: { enabled?: boolean } = {}) {
  return useQuery<StudyResponse, DeskApiError>({
    queryKey: ["desk-v2", "/study", params],
    queryFn: ({ signal: s }) => deskGet<StudyResponse>("/study", params, { signal: s }),
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
    queryFn: ({ signal: s }) => deskGet<BasketResponse>(`/basket/${encodeURIComponent(id)}`, undefined, { signal: s }),
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
    queryFn: ({ signal: s }) => deskGet<HedgeResponse>("/hedge", params, { signal: s }),
    staleTime: 60_000,
    retry,
    enabled: opts.enabled ?? true,
  });
}

/** §12.3: the fifteen catalog studies the slots and chips are drawn from. */
export const useStudyCatalog = () => useDesk<StudyCatalogResponse>("/study/catalog");

/** §12.3: the events behind a study (the Advanced panel). */
export const useStudyEvents = (params: Params) => useDesk<StudyEventsResponse>("/study/events", params);
