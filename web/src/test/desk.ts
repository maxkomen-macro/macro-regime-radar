/**
 * Desk v2 unit-test fetch: every /api/desk/* request is answered by the
 * same resolver the browser tests and the fixture dev server use
 * (src/fixtures/desk), unless a test overrides the path. Anything else
 * answers 404. Returns the list of requested paths.
 */
import { deskFixture, resetDeskFixtureState } from "../fixtures/desk";

export type DeskOverride = (url: URL, init?: RequestInit) => { status: number; body: unknown } | unknown;

export function stubDesk(over: Record<string, DeskOverride> = {}) {
  resetDeskFixtureState();
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://localhost");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    const key = Object.keys(over).find((k) => url.pathname === k);
    if (key) {
      const out = await over[key](url, init);
      if (out && typeof out === "object" && "status" in out && "body" in out) {
        const r = out as { status: number; body: unknown };
        return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
    }
    const headers = new Headers(init?.headers);
    const reply = deskFixture(init?.method ?? "GET", `${url.pathname}${url.search}`, typeof init?.body === "string" ? init.body : undefined, headers.get("accept") ?? "");
    if (reply) return new Response(reply.body, { status: reply.status, headers: { "content-type": reply.contentType } });
    return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = fn as typeof fetch;
  return { calls };
}

/** A §12 error reply for an override. */
export const deskError = (status: number, error: string, extra: Record<string, unknown> = {}) => () => ({ status, body: { error, ...extra } });
