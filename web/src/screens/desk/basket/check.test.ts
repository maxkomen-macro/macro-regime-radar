/**
 * The ticker check (./check.ts): asked of the price endpoint the basket is priced from,
 * `/api/market/candles/{SYM}?range=2Y`, answering listed, not listed (in the endpoint's words)
 * or not checked.
 */
import { describe, expect, it } from "vitest";
import { checkTicker } from "./check";

const answer = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;

describe("the ticker check", () => {
  it("asks the two-year daily prices and reads the last bar's day", async () => {
    let asked = "";
    const f = (async (url: string) => {
      asked = url;
      return new Response(JSON.stringify({ bars: [{ ts: "2026-09-22T00:00:00Z" }, { ts: "2026-09-23T00:00:00Z" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await checkTicker("BRK.B", f)).toEqual({ state: "listed", last: "2026-09-23" });
    expect(asked).toBe("/api/market/candles/BRK.B?range=2Y");
  });

  it("a symbol the endpoint does not list is not listed, in its words", async () => {
    expect(await checkTicker("ZZZZ", answer(404, { detail: "No listing found for 'ZZZZ' on EODHD.", kind: "unknown_symbol" }))).toEqual({ state: "unlisted", words: "No listing found for 'ZZZZ' on EODHD." });
    expect(await checkTicker("ZZZZ", answer(404, { detail: "EODHD holds no 2Y bars for ZZZZ.", kind: "empty" }))).toEqual({ state: "unlisted", words: "EODHD holds no 2Y bars for ZZZZ." });
    expect(await checkTicker("A~B", answer(422, { detail: [{ msg: "bad" }] }))).toEqual({ state: "unlisted", words: "A~B is not a listed US ticker" });
    expect(await checkTicker("X", answer(200, { bars: [] }))).toEqual({ state: "unlisted", words: "no daily prices for X" });
  });

  it("an endpoint that did not answer leaves the ticker not checked, with why", async () => {
    expect(await checkTicker("NVDA", answer(503, { detail: "EODHD is not configured on this server.", kind: "missing_token" }))).toEqual({ state: "unchecked", words: "EODHD is not configured on this server." });
    expect(await checkTicker("NVDA", answer(502, "not json"))).toEqual({ state: "unchecked", words: "the price service answered 502" });
    const down = (async () => {
      throw new TypeError("network");
    }) as unknown as typeof fetch;
    expect(await checkTicker("NVDA", down)).toEqual({ state: "unchecked", words: "the price service did not answer" });
  });
});
