/**
 * Desk v2 unit-test fetch: every /api/desk/* request is answered by the
 * same resolver the browser tests and the fixture dev server use
 * (src/fixtures/desk), unless a test overrides the path. Anything else
 * answers 404. Returns the list of requested paths.
 */
import { FIXTURE_META, deskFixture, resetDeskFixtureState } from "../fixtures/desk";
import { awaitingEnvelope, onTheWire, routeOf } from "../screens/desk/data/envelope";

/** An override's body as the wire carries it (§12.0): a payload or `{error}` body in its envelope, an envelope as it is. */
const wire = (pathname: string, status: number, body: unknown) => (pathname.startsWith("/api/desk/") ? onTheWire(routeOf(pathname.slice("/api/desk".length)), status, body, FIXTURE_META) : body);

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
      if (out && typeof out === "object" && "status" in out && "body" in out && typeof (out as { status: unknown }).status === "number") {
        const r = out as { status: number; body: unknown };
        return new Response(JSON.stringify(wire(url.pathname, r.status, r.body)), { status: r.status, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify(wire(url.pathname, 200, out)), { status: 200, headers: { "content-type": "application/json" } });
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

/** A §12.0 awaiting answer for an override: the route is not served yet, with its reason (§1.0.2). */
export const deskAwaiting = (reason: string, until: string | null = null) => () => ({ status: 200, body: awaitingEnvelope({ reason, until }, FIXTURE_META) });
