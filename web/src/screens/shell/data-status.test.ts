/**
 * fix/freshness 8: the sidebar's "● Data status" carries what the strip's status card showed. Its dot is the worst
 * of the card's two lines (the markets, the regime's monthly inputs): one cycle behind (markets a session behind)
 * reads amber, further behind keeps the card's warn-hot, no report or the data service down reads red, a snapshot
 * has no health dot; the line under it is the markets as-of.
 */
import { describe, expect, it } from "vitest";
import type { Freshness, SeriesState } from "../../api/types";
import { composeShellStatus, dataStatusTone, marketsAsOfWords, marketsLineTone, type ShellStatusInput } from "./shell-status";

const st = (id: string, kind: string, cadence: string, as_of: string, state: string, cycles_behind: number | null = 0): SeriesState =>
  ({ id, label: id, kind, cadence, as_of, state, delay_min: state === "delayed" ? 15 : null, cycles_behind, stale: state === "stale", discontinued: false, reason: `${id} ${state}` }) as SeriesState;

const INPUTS = [{ series: "INDPRO" }, { series: "CPIAUCSL" }];
const MACRO_OK = [st("INDPRO", "fred", "monthly", "2026-08-01", "close"), st("CPIAUCSL", "fred", "monthly", "2026-08-01", "close")];

function report(series: SeriesState[]): Freshness {
  return { series, regime: { inputs: INPUTS, blockers: [] }, session: { is_open: false } } as unknown as Freshness;
}

function status(f: Freshness | undefined, over: Partial<ShellStatusInput> = {}) {
  return composeShellStatus({
    freshness: f,
    freshnessError: false,
    freshnessLoading: false,
    regimeError: false,
    streamWord: "Delayed",
    streamLive: false,
    liveFeeds: { us: false, crypto: false, forex: false },
    degraded: false,
    degradedReasons: [],
    snapshot: null,
    ...over,
  });
}

describe("dataStatusTone and marketsAsOfWords", () => {
  it("both lines current: the markets' own tone, and the markets as-of under the word", () => {
    const s = status(report([st("market_daily", "market", "daily", "2026-09-30", "close"), ...MACRO_OK]));
    expect(dataStatusTone(s)).toBe("neutral");
    expect(marketsAsOfWords(s)).toBe("Markets · Close · Sep 30");
  });

  it("markets a session behind reads amber (the owner's rule), further behind warn-hot", () => {
    const one = status(report([st("market_daily", "market", "daily", "2026-09-29", "stale", 1), ...MACRO_OK]));
    expect(dataStatusTone(one)).toBe("behind");
    expect(marketsLineTone(one)).toBe("behind"); // the line under the word reads amber too
    const four = status(report([st("market_daily", "market", "daily", "2026-09-24", "stale", 4), ...MACRO_OK]));
    expect(dataStatusTone(four)).toBe("stale");
    expect(marketsAsOfWords(four)).toBe("Markets · Sep 24 · 4 sessions behind");
    expect(marketsLineTone(four)).toBe("stale");
  });

  it("the worse line wins: a macro print one release behind under current markets reads amber; a live feed with a current macro glows", () => {
    const macroBehind = status(report([st("market_daily", "market", "daily", "2026-09-30", "close"), st("INDPRO", "fred", "monthly", "2026-07-01", "stale", 1), MACRO_OK[1]]));
    expect(dataStatusTone(macroBehind)).toBe("behind");
    const live = status(report([st("live_quotes", "live", "tick", "2026-10-01T14:00:00Z", "live"), st("market_daily", "market", "daily", "2026-09-30", "close"), ...MACRO_OK]));
    expect(dataStatusTone(live)).toBe("live");
    const delayed = status(report([st("live_quotes", "live", "tick", "2026-10-01T14:00:00Z", "delayed"), ...MACRO_OK]));
    expect(dataStatusTone(delayed)).toBe("delayed");
    const both = status(report([st("market_daily", "market", "daily", "2026-09-24", "stale", 4), st("INDPRO", "fred", "monthly", "2026-07-01", "stale", 1), MACRO_OK[1]]));
    expect(dataStatusTone(both)).toBe("stale");
  });

  it("no report reads red when it failed, grey while it loads; the data service down reads red; a snapshot has no health dot", () => {
    expect(dataStatusTone(status(undefined, { freshnessError: true }))).toBe("error");
    expect(marketsAsOfWords(status(undefined, { freshnessError: true }))).toBe("Markets · As of unknown");
    expect(dataStatusTone(status(undefined, { freshnessLoading: true }))).toBe("unknown");
    expect(marketsAsOfWords(status(undefined, { freshnessLoading: true }))).toBe("Markets · reading…");
    const down = status(undefined, { freshnessError: true, regimeError: true });
    expect([dataStatusTone(down), marketsAsOfWords(down)]).toEqual(["error", "Data service unavailable"]);
    const seeded = status({ ...report(MACRO_OK), seeded: true, generated_at: "2026-09-10T06:06:01Z" } as Freshness);
    expect(dataStatusTone(seeded)).toBe("snapshot");
    expect(marketsAsOfWords(seeded)).toMatch(/^Snapshot · as of Sep 10/);
  });
});
