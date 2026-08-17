/**
 * Minimal fetch wrapper for the FastAPI service. Same-origin in production
 * (FastAPI serves the built bundle); the Vite dev server proxies /api and
 * /health to http://127.0.0.1:8000 (vite.config.ts). Override with
 * VITE_API_BASE for a non-proxied setup.
 */

const BASE: string = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  readonly status: number;
  readonly path: string;

  constructor(status: number, path: string, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.path = path;
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
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, path, "API unreachable — is uvicorn running on :8000?");
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) detail = body.detail;
    } catch {
      /* non-JSON error body — keep the status line */
    }
    throw new ApiError(res.status, path, detail);
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
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, path, "API unreachable — is uvicorn running on :8000?");
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
