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
import { DeskApiError, MAX_POLLS, deskGet, deskPost, readAnswer, readBody, retry, retryAfterMs, unavailableOf, useOverview } from "./api";
import { NESTED_PATHS, awaitingEnvelope, errorEnvelope, isEnvelope, readyEnvelope, routeOf, unwrapBlocks } from "./envelope";
import { SCHEMAS, schemaFor } from "./schema";
import basketPrice from "../../../fixtures/desk/basket-price.json";
import basket from "../../../fixtures/desk/basket.json";
import hedge from "../../../fixtures/desk/hedge.json";
import ledger from "../../../fixtures/desk/ledger.json";
import macro from "../../../fixtures/desk/macro.json";
import overview from "../../../fixtures/desk/overview.json";
import pipeline from "../../../fixtures/desk/pipeline.json";
import regime from "../../../fixtures/desk/regime.json";
import sectors from "../../../fixtures/desk/sectors.json";
import studyCatalog from "../../../fixtures/desk/study-catalog.json";
import studyEvents from "../../../fixtures/desk/study-events.json";
import study from "../../../fixtures/desk/study.json";
import technicals from "../../../fixtures/desk/technicals.json";
import vol from "../../../fixtures/desk/vol.json";
import { FIXTURE_META, deskFixture } from "../../../fixtures/desk";

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

  it("the deferred shapes (§12.13) pass their schemas unchanged, as a stub and as a /technicals block", () => {
    const { as_of: _va, generation_id: _vg, ...v } = vol;
    const { as_of: _sa, generation_id: _sg, ...s } = sectors;
    void [_va, _vg, _sa, _sg];
    expect(readBody(vol, "/vol")).toEqual(vol);
    expect(readBody(sectors, "/sectors")).toEqual(sectors);
    const t = { ...technicals, vol: v, sectors: s };
    expect(readBody(t, "/technicals")).toEqual(t);
  });

  it("every fixture passes its own schema unchanged", () => {
    for (const path of Object.keys(SCHEMAS)) {
      const url = path === "/basket" ? "/api/desk/basket/ai-infra" : `/api/desk${path}${path === "/study" || path === "/study/events" ? "?preset=gold-2sigma-spx-weak" : path === "/hedge" ? "?mode=protect&basket=ai-infra" : ""}`;
      const reply = path === "/basket/price" ? deskFixture("POST", url, JSON.stringify({ legs: basket.legs.map((x) => ({ symbol: x.symbol, weight: x.weight })) })) : deskFixture("GET", url);
      if (!reply || reply.contentType !== "application/json" || reply.status !== 200) continue;
      // On the wire every fixture is an envelope (§12.0); its payload, blocks taken apart, passes its schema unchanged.
      const env = JSON.parse(reply.body) as unknown;
      expect(isEnvelope(env), path).toBe(true);
      // A deferred stub (§12.0: /vol, /sectors) answers awaiting, with no payload; its shape is checked below.
      if ((env as { status: string }).status === "awaiting") continue;
      const { data } = unwrapBlocks(routeOf(path), (env as { data: Record<string, unknown> }).data);
      expect(readBody(data, path === "/basket" ? "/basket/ai-infra" : path), path).toEqual(data);
    }
  });

  it("a study's question must be its six slots, or nothing in it can be read (G1-1)", () => {
    // §12.2: `window` is nullable (a cross has none), so a null window reads; a missing slot does not.
    for (const q of [{}, { ...study.question, while: undefined }, { ...study.question, move: "sideways" }, { ...study.question, while: 5 }, { ...study.question, shock: undefined }, "gold"]) expect(tryRead({ ...study, question: q }, "/study")).toBe("unreadable");
    expect(tryRead({ ...study, question: { ...study.question, move: "cross_above", window: null } }, "/study")).not.toBe("unreadable");
    // …and only for a cross (§12.2: "null for a cross").
    expect(tryRead({ ...study, question: { ...study.question, window: null } }, "/study")).toBe("unreadable");
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
      "/study/catalog": studyCatalog,
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
    // §12.5 serves verdict nullable: an unknown verdict reads as null (its pill says "—").
    expect(ledgerRows.signals).toEqual([{ slug: "a", label: "A", sample_start: null, n: null, verdict: null }]);
  });

  it("the contract's served words and counts are checked by kind; a wrong kind is removed (Codex round 1, group 2)", () => {
    const s = tryRead(
      {
        ...study,
        question: { ...study.question, target_unit: "percent", target_label: 42 },
        horizons: study.horizons.map((h) => ({ ...h, n: "18" })),
      },
      "/study",
    ) as { question: Record<string, unknown>; horizons: Record<string, unknown>[] };
    expect("target_unit" in s.question).toBe(false);
    expect("target_label" in s.question).toBe(false);
    expect(s.horizons.map((h) => h.n)).toEqual([null, null, null, null]);
    const t = tryRead({ ...technicals, move_20d_word: 3 }, "/technicals") as Record<string, unknown>;
    expect("move_20d_word" in t).toBe(false);
    // §1.9: the three native units and the two display units pass; frame-3's old "pct" and "px" are removed.
    for (const u of ["log_return", "log_change", "bp"]) expect((tryRead({ ...study, question: { ...study.question, target_unit: u } }, "/study") as { question: { target_unit: string } }).question.target_unit).toBe(u);
    for (const u of ["pct", "px"]) expect("target_unit" in (tryRead({ ...study, question: { ...study.question, target_unit: u } }, "/study") as { question: object }).question).toBe(false);
    for (const u of ["percent", "bp"]) expect((tryRead({ ...study, question: { ...study.question, display_unit: u } }, "/study") as { question: { display_unit: string } }).question.display_unit).toBe(u);
    expect("display_unit" in (tryRead({ ...study, question: { ...study.question, display_unit: "log_return" } }, "/study") as { question: object }).question).toBe(false);
  });

  it("a hedge structure's legs are one fact, and its range needs both ends (Codex R-06)", () => {
    const [o] = hedge.options;
    const read = (x: Record<string, unknown>) => (tryRead({ ...hedge, options: [{ ...o, ...x }] }, "/hedge") as { options: Record<string, unknown>[] }).options[0];
    expect(read({}).legs).toEqual(o.legs);
    expect("legs" in read({ legs: [o.legs[0], { right: "straddle", strike: -0.1, qty: -1 }] })).toBe(false);
    expect("legs" in read({ legs: [o.legs[0], { right: "put", strike: null, qty: -1 }] })).toBe(false);
    expect(read({ protected_range: { ndx_from: -0.05, ndx_to: null, basis: "strikes" } }).protected_range).toBeNull();
    expect(read({ protected_range: { ndx_from: -0.05, ndx_to: -0.1 } }).protected_range).toBeNull();
    expect(read({ protected_range: { ndx_from: -0.05, ndx_to: -0.1, basis: "wide" } }).protected_range).toBeNull();
    expect(read({ protected_range: { ndx_from: -0.05, ndx_to: -0.1, basis: "strikes" } }).protected_range).toEqual({ ndx_from: -0.05, ndx_to: -0.1, basis: "strikes" });
  });

  it("a price keeps its own date, and technicals names its series whole or not at all (Codex R-04, R-08)", () => {
    expect((tryRead({ ...basketPrice, prices_as_of: "2026-09-24" }, "/basket/price") as Record<string, unknown>).prices_as_of).toBe("2026-09-24");
    expect("prices_as_of" in (tryRead({ ...basketPrice, prices_as_of: 20260924 }, "/basket/price") as object)).toBe(false);
    expect((tryRead(technicals, "/technicals") as Record<string, unknown>).instrument).toEqual({ symbol: "SPX", label: "S&P 500" });
    expect("instrument" in (tryRead({ ...technicals, instrument: { symbol: "SPX" } }, "/technicals") as object)).toBe(false);
    expect("instrument" in (tryRead({ ...technicals, instrument: "S&P 500" }, "/technicals") as object)).toBe(false);
  });

  it("a statistic that is not finite is null, 1e999 included (G1-4)", () => {
    // Positions are kept in the browser (§9); a served statistic, a pair's included, is read the same way everywhere.
    const m = tryRead(JSON.parse('{"credit":{"hy":1e999,"hy_pct_3y":"0.4","hy_range_3y":[1e999,4]}}'), "/macro") as { credit: Record<string, unknown> };
    expect(m.credit).toMatchObject({ hy: null, hy_pct_3y: null, hy_range_3y: [null, 4] });
  });

  it("a basket's legs are one fact: one bad leg and the basket is unreadable (G1-6); a price's bad leg is dropped", () => {
    expect(tryRead({ ...basket, legs: [null, ...basket.legs.slice(1)] }, "/basket/ai-infra")).toBe("unreadable");
    expect(tryRead({ ...basket, legs: [{ ...basket.legs[0], weight: "22" }, ...basket.legs.slice(1)] }, "/basket/ai-infra")).toBe("unreadable");
    const price = tryRead({ legs: [null, basket.legs[0]] }, "/basket/price") as { legs: unknown[] };
    expect(price.legs).toEqual([basket.legs[0]]);
  });

  it("knows every endpoint the Desk asks, a basket by its id included", () => {
    for (const p of ["/overview", "/ledger", "/technicals", "/vol", "/sectors", "/regime", "/macro", "/study", "/study/events", "/pipeline", "/basket/price", "/hedge"]) expect(schemaFor(p), p).toBeDefined();
    // §9: no server position store, so no /positions answer to read.
    expect(schemaFor("/positions")).toBeUndefined();
    expect(schemaFor("/basket/ai-infra")).toBe(SCHEMAS["/basket"]);
  });

  it("a completed 200 that is null or not JSON rejects as unreadable, GET and POST alike", async () => {
    answer("null");
    await expect(deskGet("/overview")).rejects.toSatisfy(unreadable);
    answer("<html>not json</html>");
    await expect(deskGet("/regime")).rejects.toSatisfy(unreadable);
    answer("[]");
    await expect(deskPost("/basket/price", { legs: [] })).rejects.toSatisfy(unreadable);
    answer(JSON.stringify(readyEnvelope("/study", { ...study, horizons: "x" }, FIXTURE_META)));
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

/** Answers in order, each a [status, body, headers?]; the last one repeats. */
function answers(...list: [number, unknown, Record<string, string>?][]) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    const [status, body, headers] = list[Math.min(seen.length - 1, list.length - 1)];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...(headers ?? {}) } });
  }) as typeof fetch;
  return seen;
}

const wrap = () => ({ children }: { children: ReactNode }) => <QueryClientProvider client={makeClient()}>{children}</QueryClientProvider>;

describe("the envelope (§12.0)", () => {
  const ready = (route: string, payload: unknown) => readyEnvelope(route, payload, FIXTURE_META);
  const awaiting = { reason: "sector ETFs, RSP and IWM not ingested.", until: null };

  it("a ready answer is its data, dated by the envelope, with every block envelope taken apart", async () => {
    answers([200, { ...ready("/overview", overview), as_of: "2026-09-24", generation_id: "gen-7", engine_version: "e1" }]);
    const o = (await deskGet("/overview")) as Record<string, unknown> & { tiles: Record<string, unknown> };
    expect([o.as_of, o.generation_id, o.engine_version]).toEqual(["2026-09-24", "gen-7", "e1"]);
    expect(o.tiles.vol).toEqual(overview.tiles.vol);
    expect(o._blocks).toEqual({});
  });

  it("an awaiting block is removed and its reason kept under its path; its neighbours stand", () => {
    const env = ready("/technicals", { ...technicals, vol: { status: "awaiting", data: null, unavailable: awaiting }, sectors: { status: "ready", data: { a: 1 }, unavailable: null } });
    const t = readAnswer<Record<string, unknown>>(env, "/technicals");
    expect("vol" in t).toBe(false);
    expect(t.sectors).toEqual({ a: 1 });
    expect(t._blocks).toEqual({ vol: awaiting });
    expect(t.price).toBe(technicals.price);
  });

  it("block envelopes are read at exactly the listed paths: the same shape elsewhere is ordinary payload", () => {
    expect(NESTED_PATHS["/study"]).toEqual(["without_condition"]);
    const look = { status: "ready", data: { x: 1 }, unavailable: null };
    const env = ready("/study", { ...study, provenance: { ...study.provenance, extra: look } });
    const s = readAnswer<{ provenance: Record<string, unknown> }>(env, "/study");
    expect(s.provenance.extra).toEqual(look);
  });

  it("a value at a listed path that is not a block envelope is removed, with no reason (Awaiting refresh)", () => {
    const env = { status: "ready", ...FIXTURE_META, data: { ...overview, tiles: { ...overview.tiles, vol: overview.tiles.vol } }, unavailable: null, error: null };
    const o = readAnswer<{ tiles: Record<string, unknown>; _blocks: Record<string, unknown> }>(env, "/overview");
    // The unwrapped payload here is plain at every listed path: none is a block envelope, so every one goes.
    expect(Object.keys(o.tiles)).toEqual([]);
    expect(o._blocks).toEqual({});
  });

  it("an awaiting answer throws its served reason, is not retried, and the page reads it with unavailableOf", async () => {
    const seen = answers([200, awaitingEnvelope(awaiting, FIXTURE_META)]);
    const e = await deskGet("/sectors").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(DeskApiError);
    expect((e as DeskApiError).awaiting).toBe(true);
    expect(unavailableOf(e)).toEqual(awaiting);
    expect((e as DeskApiError).message).toBe(awaiting.reason);
    const { result } = renderHook(() => useOverview(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(seen.length).toBe(2); // one for deskGet, one for the hook: no retry
  });

  it("an error answer carries the served code, message and the refusal's fields", async () => {
    answers([422, errorEnvelope("unsupported", "a window of 10 sessions is not in the catalog", FIXTURE_META, { missing: ["window"] })]);
    const e = (await deskGet("/study").catch((x: unknown) => x)) as DeskApiError;
    expect([e.status, e.body?.error, e.message, e.body?.missing]).toEqual([422, "unsupported", "a window of 10 sessions is not in the catalog", ["window"]]);
    expect(e.unreadable).toBe(false);
    expect(e.awaiting).toBe(false);
  });

  it("computing (202) is asked again after the served Retry-After, until the answer is ready", async () => {
    const seen = answers([202, { status: "computing", ...FIXTURE_META, data: null, unavailable: null, error: null }, { "Retry-After": "0" }], [202, { status: "computing", ...FIXTURE_META, data: null, unavailable: null, error: null }, { "Retry-After": "0" }], [200, ready("/study", study)]);
    const s = (await deskGet("/study", { preset: "gold-2sigma-spx-weak" })) as { slug: string };
    expect(s.slug).toBe(study.slug);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(1); // the same URL each time
  });

  it("computing past the poll limit is an answer that did not come; an abort stops the polling", async () => {
    const seen = answers([202, { status: "computing", ...FIXTURE_META, data: null, unavailable: null, error: null }, { "Retry-After": "0" }]);
    const e = (await deskGet("/study").catch((x: unknown) => x)) as DeskApiError;
    expect(e.status).toBe(202);
    expect(seen).toHaveLength(MAX_POLLS + 1);
    answers([202, { status: "computing", ...FIXTURE_META, data: null, unavailable: null, error: null }, { "Retry-After": "5" }]);
    const ctl = new AbortController();
    const p = deskGet("/study", undefined, { signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toBeTruthy();
  });

  it("Retry-After: absent or empty waits 2 s, not zero; a number its seconds up to 30 (I1-7)", () => {
    const h = (v: string | null) => retryAfterMs({ headers: new Headers(v === null ? {} : { "Retry-After": v }) });
    expect([h(null), h(""), h("  "), h("x"), h("-1"), h("0"), h("3"), h("600")]).toEqual([2000, 2000, 2000, 2000, 2000, 0, 3000, 30000]);
  });

  it("an awaiting block served without a reason did not arrive: removed, with no reason recorded (I1-9)", () => {
    const env = ready("/technicals", { ...technicals, vol: { status: "awaiting", data: null, unavailable: null } });
    const t = readAnswer<Record<string, unknown>>(env, "/technicals");
    expect("vol" in t).toBe(false);
    // Only the sectors block, served awaiting with its reason, is recorded.
    expect(t._blocks).toEqual({ sectors: { reason: "sector ETFs, RSP and IWM not ingested.", until: null } });
  });

  it("an error served with a 2xx is not retried; a 5xx once; no answer once (I1-10)", () => {
    expect(retry(0, new DeskApiError(200, "x", { error: "unsupported" }))).toBe(false);
    expect(retry(0, new DeskApiError(503, "x", { error: "warming" }))).toBe(true);
    expect(retry(1, new DeskApiError(503, "x", { error: "warming" }))).toBe(false);
    expect(retry(0, new DeskApiError(0, "x"))).toBe(true);
    expect(retry(0, new DeskApiError(202, "x", { error: "computing" }))).toBe(false);
  });

  it("a body that is not an envelope is unreadable; an envelope whose data is not an object too", () => {
    expect(() => readAnswer(overview, "/overview")).toThrow(DeskApiError);
    expect(() => readAnswer({ status: "ready", ...FIXTURE_META, data: [1], unavailable: null, error: null }, "/overview")).toThrow("could not be read");
    expect(() => readAnswer({ status: "awaiting", ...FIXTURE_META, data: null, unavailable: { reason: "" }, error: null }, "/overview")).toThrow("could not be read");
    expect(routeOf("/basket/ai-infra")).toBe("/basket");
  });
});
