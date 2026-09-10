/**
 * Minimal fetch wrapper for the FastAPI service. Same-origin in production
 * (FastAPI serves the built bundle); the Vite dev server proxies /api and
 * /health to http://127.0.0.1:8000 (vite.config.ts). Override with
 * VITE_API_BASE for a non-proxied setup.
 */

const BASE: string = import.meta.env.VITE_API_BASE ?? "";

/** A request that never answers must not leave a screen asserting absence
 * ("no alerts", "none on file") forever: every call aborts after this long and
 * surfaces as an ApiError the screens render as "unavailable" (2026-09-05). */
const TIMEOUT_MS = 15_000;

function timeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(TIMEOUT_MS) : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;
  /** Provider failure kind from the API's typed error body (2026-09-06):
   * unknown_symbol · unsupported · unauthorized · rate_limited · timeout ·
   * unavailable · malformed · empty · missing_token — or "timeout" /
   * "unreachable" for client-side failures. */
  readonly kind: string | null;
  readonly retryable: boolean;

  constructor(status: number, path: string, detail: string, kind: string | null = null, retryable = false) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
    this.kind = kind;
    this.retryable = retryable;
  }
}

export async function getJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const qs = params
    ? Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal: timeoutSignal() });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(
      0,
      path,
      timedOut ? "The data service did not answer within 15 seconds." : "The data service is unreachable.",
      timedOut ? "timeout" : "unreachable",
      true,
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    let kind: string | null = null;
    let retryable = res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504;
    try {
      const body = (await res.json()) as { detail?: unknown; kind?: string; retryable?: boolean };
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail) detail = JSON.stringify(body.detail);
      if (typeof body.kind === "string") kind = body.kind;
      if (typeof body.retryable === "boolean") retryable = body.retryable;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new ApiError(res.status, path, detail, kind, retryable);
  }
  return (await res.json()) as T;
}

/** POST for the calculators (LBO, scenario stress, recession sensitivity) —
 * every POST is pure computation over stored data; nothing writes. */
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const url = `${BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      signal: timeoutSignal(),
      body: JSON.stringify(body),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    throw new ApiError(0, path, timedOut ? "The data service did not answer within 15 seconds." : "The data service is unreachable.", timedOut ? "timeout" : "unreachable", true);
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { detail?: unknown };
      if (typeof errBody.detail === "string") detail = errBody.detail;
      else if (errBody.detail) detail = JSON.stringify(errBody.detail);
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new ApiError(res.status, path, detail);
  }
  return (await res.json()) as T;
}
