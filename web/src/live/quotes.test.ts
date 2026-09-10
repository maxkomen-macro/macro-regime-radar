import { describe, expect, it } from "vitest";
import { streamIsLive, streamWord, type LiveQuote, type StreamStatus } from "./quotes";

const base: StreamStatus = { socket: "open", feeds: { us: "open", crypto: "open", forex: "open", vix: "rest" }, stale: {}, degraded: false, degradedReasons: [], lastBatchAt: Date.now(), attempts: 0, everOpened: true };
const liveQuote: LiveQuote = { s: "SPY", p: 500, dc: 0.1, dd: 0.5, t: Date.now() - 1000, delayed: false, src: "ws" };
const restQuote: LiveQuote = { s: "SPY", p: 500, dc: 0.1, dd: 0.5, t: Date.now() - 1000, delayed: true, src: "rest" };

describe("streamWord", () => {
  it("is Live only with fresh websocket ticks", () => {
    expect(streamWord(base, new Map([["SPY", liveQuote]]))).toBe("Live");
    expect(streamIsLive(base, new Map([["SPY", liveQuote]]))).toBe(true);
  });
  it("is Delayed on REST rows or an idle socket", () => {
    expect(streamWord(base, new Map([["SPY", restQuote]]))).toBe("Delayed");
    expect(streamWord({ ...base, lastBatchAt: Date.now() - 10 * 60_000 }, new Map([["SPY", liveQuote]]))).toBe("Delayed");
  });
  it("is Off when every feed is off (no token on the server)", () => {
    expect(streamWord({ ...base, feeds: { us: "off", crypto: "off", forex: "off", vix: "off" } }, new Map())).toBe("Off");
  });
  it("is Reconnecting after a drop and Backend unavailable when it never connected", () => {
    expect(streamWord({ ...base, socket: "closed", attempts: 1 }, new Map())).toBe("Reconnecting");
    expect(streamWord({ ...base, socket: "connecting", everOpened: false, attempts: 0 }, new Map())).toBe("Reconnecting");
    expect(streamWord({ ...base, socket: "closed", everOpened: false, attempts: 3 }, new Map())).toBe("Backend unavailable");
  });
});
