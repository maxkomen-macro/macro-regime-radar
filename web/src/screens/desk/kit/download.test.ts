/**
 * The kit's download: a type other than the one asked for, or no answer
 * within its time, rejects so the caller can say nothing was saved.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { saveServed } from "./download";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

describe("saveServed", () => {
  it("refuses a JSON answer to a CSV request", async () => {
    globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    await expect(saveServed("/x", "text/csv", "x.csv")).rejects.toThrow(/type application\/json/);
  });
  it("gives up after its time when nothing answers", async () => {
    vi.useFakeTimers();
    globalThis.fetch = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    const p = saveServed("/x", "text/plain", "x.sql", 15_000);
    const check = expect(p).rejects.toThrow(/aborted/);
    await vi.advanceTimersByTimeAsync(15_000);
    await check;
  });
});
