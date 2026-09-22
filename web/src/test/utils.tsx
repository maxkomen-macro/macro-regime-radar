import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement, ReactNode } from "react";

export function makeClient(): QueryClient {
  // retryDelay 0: hooks that retry transient provider errors do so instantly
  // in tests instead of waiting React Query's exponential default.
  return new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, gcTime: 0, staleTime: 0 } } });
}

/** Render with the providers every screen expects; retries off so error
 * states surface immediately. */
export function renderWithProviders(ui: ReactElement, { route = "/app/dashboard", client = makeClient(), ...opts }: RenderOptions & { route?: string; client?: QueryClient } = {}) {
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, ...render(ui, { wrapper: Wrapper, ...opts }) };
}

/** A fetch stub keyed by path prefix: `{"/api/market/candles": () => body}`.
 * Unmatched paths answer 404 so a screen's own error handling is exercised. */
export function stubFetch(routes: Record<string, (url: URL, init?: RequestInit) => unknown | { status: number; body: unknown }>) {
  const calls: string[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url, "http://localhost");
    calls.push(url.pathname + url.search);
    const key = Object.keys(routes).find((k) => url.pathname.startsWith(k));
    if (!key) return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
    const out = routes[key](url, init);
    const resolved = out instanceof Promise ? await out : out;
    if (resolved && typeof resolved === "object" && "status" in (resolved as object) && "body" in (resolved as object)) {
      const r = resolved as { status: number; body: unknown };
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify(resolved), { status: 200, headers: { "content-type": "application/json" } });
  };
  globalThis.fetch = fn as typeof fetch;
  return { calls };
}
