/**
 * launch-1, item 10: an open tab never mixes data generations.
 *
 * The server rebuilds every derived result when a refresh publishes a new
 * database and switches screens to it at once. The browser used to keep
 * pre-swap values until each query's own stale time expired — thirty minutes
 * for credit metrics and the LBO defaults — so a tab left open could show the
 * old HY OAS beside the new regime. `/api/freshness` now names the generation
 * that answered, and the client drops everything read from the database when
 * that number changes.
 */
import { describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useCreditMetrics, useFreshness, useSymbolProfile } from "./queries";
import { stubFetch } from "../test/utils";

const freshness = (id: number) => ({
  regimes_date: "2026-08-01", signals_date: "2026-08-01", market_daily_date: "2026-09-18",
  market_intraday_ts: null, news_published_at: null, raw_series_date: "2026-09-18",
  generated_at: "2026-09-21T18:00:00Z", overall: "current",
  generation: { id, built_at: `2026-09-21T18:0${id}:00Z`, source: "macro_radar.db" },
});

function harness() {
  let generation = 1;
  let creditCalls = 0;
  let profileCalls = 0;
  stubFetch({
    "/api/freshness": () => freshness(generation),
    "/api/credit/metrics": () => {
      creditCalls += 1;
      return { hy_oas: 2.65 + creditCalls / 100, ig_oas: 0.81, as_of: "2026-09-18" };
    },
    "/api/market/profile/AAPL": () => {
      profileCalls += 1;
      return { symbol: "AAPL", last: 338.98, quote_provider: "eodhd", fundamentals_provider: "finnhub" };
    },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30 * 60_000 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    wrapper,
    publish: (id: number) => {
      generation = id;
    },
    counts: () => ({ credit: creditCalls, profile: profileCalls }),
  };
}

describe("generation coherence", () => {
  it("drops database-derived caches when the served generation changes", async () => {
    const h = harness();
    const { result } = renderHook(
      () => ({ fresh: useFreshness(), credit: useCreditMetrics() }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.credit.data).toBeDefined());
    await waitFor(() => expect(result.current.fresh.data?.generation?.id).toBe(1));
    expect(h.counts().credit).toBe(1);

    // A refresh publishes: the next freshness poll carries a new generation.
    h.publish(2);
    await h.client.invalidateQueries({ queryKey: ["freshness"] });
    await waitFor(() => expect(result.current.fresh.data?.generation?.id).toBe(2));

    // Credit is thirty minutes from stale, and must still be refetched.
    await waitFor(() => expect(h.counts().credit).toBe(2));
  });

  it("leaves the generation alone when it has not changed", async () => {
    const h = harness();
    const { result } = renderHook(
      () => ({ fresh: useFreshness(), credit: useCreditMetrics() }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.credit.data).toBeDefined());
    const before = h.counts().credit;
    await h.client.invalidateQueries({ queryKey: ["freshness"] });
    await waitFor(() => expect(result.current.fresh.isFetching).toBe(false));
    expect(h.counts().credit).toBe(before);
  });

  it("does not spend a provider call on a swap: only stored data is refetched", async () => {
    const h = harness();
    const { result } = renderHook(
      () => ({ fresh: useFreshness(), credit: useCreditMetrics(), profile: useSymbolProfile("AAPL") }),
      { wrapper: h.wrapper },
    );
    await waitFor(() => expect(result.current.profile.data).toBeDefined());
    const before = h.counts();
    h.publish(3);
    await h.client.invalidateQueries({ queryKey: ["freshness"] });
    await waitFor(() => expect(h.counts().credit).toBe(before.credit + 1));
    expect(h.counts().profile).toBe(before.profile);
  });
});
