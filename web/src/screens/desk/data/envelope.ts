/**
 * The §12.0 response envelope (DESK_FRAME3_SPEC §12.0): every Desk JSON
 * route answers `{status, generation_id, as_of, engine_version, data,
 * unavailable, error}`, and a few named blocks inside `data` are block
 * envelopes `{status, data, unavailable}`. This module knows the states,
 * the exact paths that carry block envelopes, and how to take them apart
 * (the client) or put them together (the fixture server and the tests).
 * Pure.
 */

export type EnvelopeStatus = "ready" | "computing" | "awaiting" | "error";
export const ENVELOPE_STATES: readonly EnvelopeStatus[] = ["ready", "computing", "awaiting", "error"];

/** Why a block or a route is not served (§1.0.2): one sentence, and when it is expected. */
export interface Unavailable {
  reason: string;
  until: string | null;
}

export interface Envelope<T = unknown> {
  status: EnvelopeStatus;
  generation_id: string | null;
  as_of: string | null;
  engine_version: string;
  data: T | null;
  unavailable: Unavailable | null;
  /** §12.0: `provider` and `retryable` ride only on `code` "schema_check"; other extra keys are not served. */
  error: { code: string; message: string; provider?: string; retryable?: boolean; [extra: string]: unknown } | null;
}

export interface BlockEnvelope<T = unknown> {
  status: "ready" | "awaiting";
  data: T | null;
  unavailable: Unavailable | null;
}

/** The only paths that carry block envelopes (§12.0, v4 B-08, C-01); every other object is plain payload. */
export const NESTED_PATHS: Readonly<Record<string, readonly string[]>> = {
  "/overview": ["since_last_close", "tiles.regime", "tiles.recession", "tiles.trend", "tiles.vol", "data_status"],
  "/regime": ["current", "recession", "next_prints", "stats", "changes"],
  "/macro": ["curve", "credit", "stock_bond", "correlations", "matrix"],
  "/technicals": ["vol", "sectors"],
  "/study": ["without_condition"],
  "/sectors": ["breadth"],
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** A served `unavailable`: a reason in words, and `until` or null; anything else is not one. */
export function readUnavailable(v: unknown): Unavailable | null {
  if (!isRecord(v) || typeof v.reason !== "string" || !v.reason.trim()) return null;
  return { reason: v.reason, until: typeof v.until === "string" && v.until.trim() ? v.until : null };
}

/** Whether a value is a top-level envelope (a known status and a `data` key). */
export function isEnvelope(v: unknown): v is Envelope {
  return isRecord(v) && typeof v.status === "string" && (ENVELOPE_STATES as readonly string[]).includes(v.status) && "data" in v;
}

/** Whether a value is a block envelope (ready or awaiting, with a `data` key). */
export function isBlockEnvelope(v: unknown): v is BlockEnvelope {
  return isRecord(v) && (v.status === "ready" || v.status === "awaiting") && "data" in v;
}

function parentOf(root: Record<string, unknown>, path: string): { parent: Record<string, unknown>; key: string } | null {
  const parts = path.split(".");
  let at: unknown = root;
  for (const p of parts.slice(0, -1)) {
    if (!isRecord(at)) return null;
    at = at[p];
  }
  return isRecord(at) ? { parent: at, key: parts[parts.length - 1] } : null;
}

/**
 * The client's side: a ready answer's `data` with its block envelopes taken
 * apart. A ready block becomes its own data; an awaiting block is removed,
 * and its reason recorded under its path in the returned `blocks`; a value at
 * a listed path that is not a block envelope, or a ready block without data,
 * is removed with no reason (the page says "Awaiting refresh"). Values at any
 * other path are left as they are, even when they look like envelopes.
 */
export function unwrapBlocks(route: string, data: Record<string, unknown>): { data: Record<string, unknown>; blocks: Record<string, Unavailable> } {
  const out = structuredCloneSafe(data);
  const blocks: Record<string, Unavailable> = {};
  for (const path of NESTED_PATHS[route] ?? []) {
    const at = parentOf(out, path);
    if (!at || !(at.key in at.parent)) continue;
    const v = at.parent[at.key];
    if (isBlockEnvelope(v) && v.status === "ready" && v.data !== null && v.data !== undefined) {
      at.parent[at.key] = v.data;
      continue;
    }
    delete at.parent[at.key];
    // An awaiting block prints its served reason (§1.0.2); one served without a reason did not arrive (Awaiting refresh).
    const u = isBlockEnvelope(v) && v.status === "awaiting" ? readUnavailable(v.unavailable) : null;
    if (u) blocks[path] = u;
  }
  return { data: out, blocks };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── The serving side (the fixture server and the tests) ───────────────────

export interface EnvelopeMeta {
  generation_id: string | null;
  as_of: string | null;
  engine_version: string;
}

/** A payload's block paths wrapped as block envelopes: a value already a block envelope is kept; any other is served ready. */
export function wrapBlocks(route: string, data: Record<string, unknown>): Record<string, unknown> {
  const out = structuredCloneSafe(data);
  for (const path of NESTED_PATHS[route] ?? []) {
    const at = parentOf(out, path);
    if (!at || !(at.key in at.parent)) continue;
    const v = at.parent[at.key];
    if (isBlockEnvelope(v)) continue;
    at.parent[at.key] = { status: "ready", data: v, unavailable: null };
  }
  return out;
}

/** A ready envelope around a payload (its blocks wrapped). A payload's own `as_of` and `generation_id` move to the envelope. */
export function readyEnvelope(route: string, payload: unknown, meta: EnvelopeMeta): Envelope {
  if (!isRecord(payload)) return { status: "ready", ...meta, data: payload as null, unavailable: null, error: null };
  const { as_of, generation_id, ...rest } = payload;
  return {
    status: "ready",
    generation_id: typeof generation_id === "string" ? generation_id : meta.generation_id,
    as_of: typeof as_of === "string" ? as_of : meta.as_of,
    engine_version: meta.engine_version,
    data: wrapBlocks(route, rest),
    unavailable: null,
    error: null,
  };
}

/** An awaiting envelope: no data, the reason (§1.0.2). */
export function awaitingEnvelope(unavailable: Unavailable, meta: EnvelopeMeta): Envelope {
  return { status: "awaiting", ...meta, data: null, unavailable, error: null };
}

/** An error envelope: `error.code` and `error.message`, plus any fields the refusal carries. */
export function errorEnvelope(code: string, message: string, meta: EnvelopeMeta, extra: Record<string, unknown> = {}): Envelope {
  return { status: "error", ...meta, data: null, unavailable: null, error: { code, message, ...extra } };
}

/** The routes that answer the envelope (§12.0): the live ones (the nine of §12.1–§12.9, /sectors of §12.14
 * since desk/fill-etf, then Basket & Hedge's two, desk/books, then
 * /instruments of §12.17, desk/usability) and the deferred stubs. The existing endpoints under
 * /api/desk (the frame-2 engine's `/event-study`, `/pipeline/inventory`) keep their own contracts. */
export const ENVELOPED_ROUTES: readonly string[] = [
  "/overview", "/study", "/study/catalog", "/study/events", "/ledger", "/regime", "/technicals", "/macro", "/pipeline",
  "/sectors", "/basket/price", "/basket/hedge",
  "/instruments",
  "/vol", "/positions", "/basket", "/hedge",
];

/** Basket & Hedge's live routes (§12.15, §12.16): never read as a basket's id. */
const BASKET_ROUTES = ["/basket/price", "/basket/hedge"];

/** The route an /api/desk URL path answers for (`/basket/ai-infra` reads as `/basket`). */
export function routeOf(path: string): string {
  return path.startsWith("/basket/") && !BASKET_ROUTES.includes(path) ? "/basket" : path;
}

/** A fixture or test reply as the wire carries it: a JSON body on an enveloped route
 * becomes its envelope (a 2xx payload ready, a 4xx/5xx `{error, …}` an error envelope);
 * a body that already is an envelope, and every other route, is left as it is. */
export function onTheWire(route: string, status: number, body: unknown, meta: EnvelopeMeta): unknown {
  if (!ENVELOPED_ROUTES.includes(route) || isEnvelope(body)) return body;
  if (status >= 400) {
    const b = isRecord(body) ? body : {};
    const { error, ...extra } = b;
    const code = typeof error === "string" ? error : String(status);
    return errorEnvelope(code, code, meta, extra);
  }
  return readyEnvelope(route, body, meta);
}
