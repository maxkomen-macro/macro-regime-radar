/**
 * The Desk's response boundary (data/api.ts, data/schema.ts; Codex R-09,
 * R-10): a completed answer whose body is null, not JSON or not an object is
 * an error, never a body a page would wait on; every field of every answer is
 * checked against its endpoint's schema (a statistic that is not finite
 * becomes null, a row or block missing what it cannot be read without is
 * dropped, an answer missing what it cannot be read without is unreadable);
 * unreadable answers are not retried, a 5xx is retried once.
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { makeClient } from "../../../test/utils";
import { DeskApiError, deskGet, deskPost, readBody, useOverview } from "./api";
import { SCHEMAS, schemaFor } from "./schema";
import basketPrice from "../../../fixtures/desk/basket-price.json";
import basket from "../../../fixtures/desk/basket.json";
import hedge from "../../../fixtures/desk/hedge.json";
import ledger from "../../../fixtures/desk/ledger.json";
import macro from "../../../fixtures/desk/macro.json";
import overview from "../../../fixtures/desk/overview.json";
import pipeline from "../../../fixtures/desk/pipeline.json";
import positions from "../../../fixtures/desk/positions.json";
import regime from "../../../fixtures/desk/regime.json";
import sectors from "../../../fixtures/desk/sectors.json";
import studyEvents from "../../../fixtures/desk/study-events.json";
import study from "../../../fixtures/desk/study.json";
import technicals from "../../../fixtures/desk/technicals.json";
import vol from "../../../fixtures/desk/vol.json";
import { deskFixture } from "../../../fixtures/desk";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function answer(body: string, status = 200) {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => calls;
}

const unreadable = (e: unknown) => e instanceof DeskApiError && e.unreadable;
const tryRead = (body: unknown, path: string) => {
  try {
    return readBody<Record<string, unknown>>(body, path);
  } catch (e) {
    if (unreadable(e)) return "unreadable" as const;
    throw e;
  }
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

describe("the response boundary", () => {
  it("a body that is null, a list, a number or a string is unreadable", () => {
    for (const body of [null, [], [1, 2], 3, "text", undefined]) expect(tryRead(body, "/study")).toBe("unreadable");
  });

  it("every fixture passes its own schema unchanged", () => {
    for (const path of Object.keys(SCHEMAS)) {
      const url = path === "/basket" ? "/api/desk/basket/ai-infra" : `/api/desk${path}${path === "/study" || path === "/study/events" ? "?preset=gold-2sigma-spx-weak" : path === "/hedge" ? "?mode=protect&basket=ai-infra" : ""}`;
      const reply = path === "/basket/price" ? deskFixture("POST", url, JSON.stringify({ legs: basket.legs.map((x) => ({ symbol: x.symbol, weight: x.weight })) })) : deskFixture("GET", url);
      if (!reply || reply.contentType !== "application/json" || reply.status !== 200) continue;
      const body = JSON.parse(reply.body) as unknown;
      expect(readBody(body, path === "/basket" ? "/basket/ai-infra" : path), path).toEqual(body);
    }
  });

  it("a study's question must be its six slots, or nothing in it can be read (G1-1)", () => {
    for (const q of [{}, { ...study.question, while: undefined }, { ...study.question, move: "sideways" }, { ...study.question, while: 5 }, { ...study.question, window: null }, "gold"]) expect(tryRead({ ...study, question: q }, "/study")).toBe("unreadable");
    expect(tryRead({ ...study }, "/study")).not.toBe("unreadable");
  });

  it("each top-level block of each endpoint, deleted or of the wrong kind, never takes the answer down unless it is required", () => {
    const fixtures: Record<string, Record<string, unknown>> = {
      "/overview": overview,
      "/ledger": ledger,
      "/technicals": technicals,
      "/vol": vol,
      "/sectors": sectors,
      "/regime": regime,
      "/macro": macro,
      "/study": study,
      "/study/events": studyEvents,
      "/positions": positions,
      "/pipeline": pipeline,
      "/basket/ai-infra": basket,
      "/basket/price": basketPrice,
      "/hedge": hedge,
    };
    expect(Object.keys(fixtures).length).toBe(Object.keys(SCHEMAS).length);
    const required: Record<string, string[]> = { "/study": ["question"], "/basket/ai-infra": ["id", "name", "legs"] };
    for (const [path, fx] of Object.entries(fixtures))
      for (const key of Object.keys(fx))
        for (const bad of [undefined, null, "x", 3, [], {}, [null], [3]]) {
          const body = clone(fx);
          if (bad === undefined) delete body[key];
          else body[key] = bad;
          const out = tryRead(body, path);
          if (required[path]?.includes(key)) continue;
          expect(out, `${path} ${key} = ${JSON.stringify(bad)}`).not.toBe("unreadable");
        }
  });

  it("drops rows missing what they cannot be read without, and fields of the wrong kind (G1-5, G1-8)", () => {
    const r = tryRead({ ...regime, history: [{ regime: "Goldilocks" }, { month: "2026-08", regime: "Overheating" }] }, "/regime") as Record<string, unknown>;
    expect(r.history).toEqual([{ month: "2026-08", regime: "Overheating" }]);
    const p = tryRead({ ...pipeline, groups: [{}, ...pipeline.groups] }, "/pipeline") as { groups: unknown[] };
    expect(p.groups).toHaveLength(pipeline.groups.length);
    const t = tryRead({ ...technicals, series: { "1y": [{ close: 1 }, { date: "2026-09-22", close: 6412, ma50: "x", ma200: null }] }, cross: {} }, "/technicals") as Record<string, unknown>;
    expect(t.series).toEqual({ "1y": [{ date: "2026-09-22", close: 6412, ma50: null, ma200: null }] });
    expect(t.cross).toBeNull();
    const m = tryRead({ ...macro, matrix: { ...macro.matrix, assets: "x" } }, "/macro") as Record<string, unknown>;
    expect("matrix" in m).toBe(false);
    const s = tryRead({ ...study, empty_state: { sentence: "Too few.", fixes: "widen_window" } }, "/study") as { empty_state: Record<string, unknown> };
    expect(s.empty_state).toEqual({ sentence: "Too few." });
    const o = tryRead({ ...overview, data_status: { a: 1 }, tiles: { ...overview.tiles, regime: { label: { x: 1 } }, trend: { ...overview.tiles.trend, above_50: undefined } } }, "/overview") as { tiles: Record<string, unknown> };
    expect("data_status" in o).toBe(false);
    expect("regime" in o.tiles).toBe(false);
    expect("trend" in o.tiles).toBe(false);
    const ledgerRows = tryRead({ signals: [{}, { slug: "a", label: "A", sample_start: 1990, n: "12", verdict: "great" }] }, "/ledger") as { signals: Record<string, unknown>[] };
    expect(ledgerRows.signals).toEqual([{ slug: "a", label: "A", sample_start: null, n: null }]);
  });

  it("the contract's served words and counts are checked by kind; a wrong kind is removed (Codex round 1, group 2)", () => {
    const s = tryRead(
      {
        ...study,
        question: { ...study.question, target_unit: "percent", target_label: 42 },
        horizons: study.horizons.map((h) => ({ ...h, n_complete: "18" })),
        without_condition: { ...study.without_condition, comparison: "better", comparison_note: 7 },
      },
      "/study",
    ) as { question: Record<string, unknown>; horizons: Record<string, unknown>[]; without_condition: Record<string, unknown> };
    expect("target_unit" in s.question).toBe(false);
    expect("target_label" in s.question).toBe(false);
    expect(s.horizons.map((h) => h.n_complete)).toEqual([null, null, null, null]);
    expect("comparison" in s.without_condition).toBe(false);
    expect("comparison_note" in s.without_condition).toBe(false);
    const t = tryRead({ ...technicals, rsi_word: "extreme", move_20d_word: 3 }, "/technicals") as Record<string, unknown>;
    expect("rsi_word" in t).toBe(false);
    expect("move_20d_word" in t).toBe(false);
    for (const u of ["pct", "bp", "px"]) expect((tryRead({ ...study, question: { ...study.question, target_unit: u } }, "/study") as { question: { target_unit: string } }).question.target_unit).toBe(u);
  });

  it("a statistic that is not finite is null, 1e999 included (G1-4)", () => {
    const pos = tryRead(JSON.parse('{"closed_90d":{"falsified":1e999,"expired":"4","premortem_right":[1e999,4]}}'), "/positions") as { closed_90d: Record<string, unknown> };
    expect(pos.closed_90d).toEqual({ falsified: null, expired: null, premortem_right: [null, 4] });
  });

  it("a basket's legs are one fact: one bad leg and the basket is unreadable (G1-6); a price's bad leg is dropped", () => {
    expect(tryRead({ ...basket, legs: [null, ...basket.legs.slice(1)] }, "/basket/ai-infra")).toBe("unreadable");
    expect(tryRead({ ...basket, legs: [{ ...basket.legs[0], weight: "22" }, ...basket.legs.slice(1)] }, "/basket/ai-infra")).toBe("unreadable");
    const price = tryRead({ legs: [null, basket.legs[0]] }, "/basket/price") as { legs: unknown[] };
    expect(price.legs).toEqual([basket.legs[0]]);
  });

  it("knows every endpoint the Desk asks, a basket by its id included", () => {
    for (const p of ["/overview", "/ledger", "/technicals", "/vol", "/sectors", "/regime", "/macro", "/study", "/study/events", "/positions", "/pipeline", "/basket/price", "/hedge"]) expect(schemaFor(p), p).toBeDefined();
    expect(schemaFor("/basket/ai-infra")).toBe(SCHEMAS["/basket"]);
  });

  it("a completed 200 that is null or not JSON rejects as unreadable, GET and POST alike", async () => {
    answer("null");
    await expect(deskGet("/overview")).rejects.toSatisfy(unreadable);
    answer("<html>not json</html>");
    await expect(deskGet("/regime")).rejects.toSatisfy(unreadable);
    answer("[]");
    await expect(deskPost("/basket/price", { legs: [] })).rejects.toSatisfy(unreadable);
    answer(JSON.stringify({ ...study, horizons: "x" }));
    const s = (await deskGet("/study")) as Record<string, unknown>;
    expect("horizons" in s).toBe(false);
  });

  it("a refusal keeps its status and body; it is not unreadable", async () => {
    answer(JSON.stringify({ error: "warming" }), 503);
    const e = await deskGet("/overview").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeskApiError);
    expect((e as DeskApiError).status).toBe(503);
    expect((e as DeskApiError).unreadable).toBe(false);
  });
});

describe("the retry rule (G1-10)", () => {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;
  it("a 5xx is asked twice, a refusal and an unreadable answer once", async () => {
    for (const [body, status, times] of [
      [JSON.stringify({ error: "warming" }), 503, 2],
      [JSON.stringify({ error: "no" }), 404, 1],
      ["null", 200, 1],
      ["<html>", 200, 1],
    ] as const) {
      const calls = answer(body, status);
      const { result, unmount } = renderHook(() => useOverview(), { wrapper });
      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(calls(), `${status} ${body}`).toBe(times);
      unmount();
    }
  });
});
