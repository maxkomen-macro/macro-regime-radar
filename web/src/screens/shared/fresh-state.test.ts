/**
 * Iteration 1, Step 1 (shell) contract B: the per-series freshness renderer
 * (web/src/screens/shared/fresh-state.ts) implements FRESHNESS_CONTRACT §5
 * exactly. The screen never re-derives freshness; it reads the per-series
 * state object (§1) and renders the word, the muted suffix, the tone, the
 * stale flag and the reason passed through.
 *
 * Every row of §5 is covered: live, delayed, close (market, intraday, relay,
 * FRED daily with and without cycles behind, monthly, discontinued, derived),
 * stale (FRED daily days, monthly releases, market sessions, intraday
 * sessions) with singular and plural units, fallback, unknown, an unknown
 * state word, null input, the seeded snapshot label, the stored-close line
 * and seriesById.
 */
import { describe, expect, it } from "vitest";
import type { Freshness, SeriesState } from "../../api/types";
import { REGIME_INPUT_IDS, RECESSION_FEATURE_SERIES, RECESSION_INPUT_IDS, freshLabel, groupLabel, lookupFrom, marketSeries, normalizeState, referenceLabel, seededLabel, seriesById, stampLabel, storedCloseLine, storedCloseShort, weakest } from "./fresh-state";
import { freshReport, isSeededReport } from "./useFreshReport";

/** A full §1 object with the invariant `stale === (state === "stale")` kept. */
function s(p: Partial<SeriesState> & { id: string }): SeriesState {
  const out: SeriesState = {
    label: p.id,
    kind: "fred",
    cadence: "daily",
    as_of: null,
    state: "unknown",
    delay_min: null,
    cycles_behind: null,
    stale: false,
    discontinued: false,
    reason: `${p.id}: reason sentence.`,
    ...p,
  };
  if (p.stale === undefined) out.stale = out.state === "stale";
  return out;
}

const SESSION = {
  exchange: "NYSE",
  timezone: "America/New_York",
  phase: "post" as const,
  is_open: false,
  today_is_trading_day: true,
  early_close: false,
  last_completed_session: "2026-09-18",
  next_open_utc: "2026-09-21T13:30:00Z",
  calendar_known: true,
  local_time: "2026-09-18T23:10:00-04:00",
};

function freshnessWith(series: SeriesState[] | undefined): Freshness {
  return {
    regimes_date: "2026-08-01",
    signals_date: "2026-08-01",
    market_daily_date: "2026-09-14",
    market_intraday_ts: "2026-09-18 15:55:00",
    news_published_at: "2026-09-18T20:00:00",
    raw_series_date: "2026-09-01",
    generated_at: "2026-09-18T23:10:00-04:00",
    overall: "current",
    session: SESSION,
    ...(series ? { series } : {}),
  };
}

describe("normalizeState", () => {
  it("passes the six contract words through unchanged", () => {
    for (const w of ["live", "delayed", "close", "stale", "fallback", "unknown"] as const) {
      expect(normalizeState(w)).toBe(w);
    }
  });

  it("maps any other word or value to unknown, never to a healthy state", () => {
    for (const x of ["current", "fresh", "ok", "", "closed", "live ", null, undefined, 0, 42, true, {}, [], ["live"]]) {
      expect(normalizeState(x), `normalizeState(${JSON.stringify(x)})`).toBe("unknown");
    }
  });
});

describe("freshLabel · live and delayed", () => {
  it("live reads Live with the live tone", () => {
    const l = freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "live", delay_min: 0, as_of: "2026-09-18T17:42:00Z", reason: "US relay ticking." }));
    expect(l.word).toBe("Live");
    expect(l.tone).toBe("live");
    expect(l.stale).toBe(false);
    expect(l.reason).toBe("US relay ticking.");
  });

  it("delayed reads Delayed {delay_min} min with the delayed tone", () => {
    const bars = freshLabel(s({ id: "market_intraday", kind: "market", cadence: "5min", state: "delayed", delay_min: 7, as_of: "2026-09-18 11:05:00" }));
    expect(bars.word).toBe("Delayed 7 min");
    expect(bars.tone).toBe("delayed");
    expect(bars.stale).toBe(false);
    const vix = freshLabel(s({ id: "vix_delayed", kind: "live", cadence: "60s", state: "delayed", delay_min: 15, as_of: "2026-09-18T15:30:00Z" }));
    expect(vix.word).toBe("Delayed 15 min");
    expect(vix.tone).toBe("delayed");
  });
});

describe("freshLabel · close", () => {
  it("market daily close reads Close · Mon DD, neutral", () => {
    const l = freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18", cycles_behind: 0, reason: "Official close of 2026-09-18, the last completed session." }));
    expect(l.word).toBe("Close · Sep 18");
    expect(l.tone).toBe("neutral");
    expect(l.stale).toBe(false);
    expect(l.reason).toBe("Official close of 2026-09-18, the last completed session.");
  });

  it("zero-pads the day (Close · Sep 04), and a date-only stamp never shifts a day in any time zone", () => {
    expect(freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-04" })).word).toBe("Close · Sep 04");
    expect(freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-01-02" })).word).toBe("Close · Jan 02");
    expect(freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-12-31" })).word).toBe("Close · Dec 31");
  });

  it("intraday close takes the date part of the New York wall-time stamp", () => {
    const l = freshLabel(s({ id: "market_intraday", kind: "market", cadence: "5min", state: "close", as_of: "2026-09-18 15:55:00", cycles_behind: 0 }));
    expect(l.word).toBe("Close · Sep 18");
    expect(l.tone).toBe("neutral");
  });

  it("relay close (ISO UTC) reads the America/New_York date", () => {
    // 01:30 UTC on Sep 19 is 21:30 EDT on Sep 18.
    expect(freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-09-19T01:30:00Z" })).word).toBe("Close · Sep 18");
    // Either side of New York midnight (EDT, UTC-4).
    expect(freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-09-19T03:59:00Z" })).word).toBe("Close · Sep 18");
    expect(freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-09-19T04:01:00Z" })).word).toBe("Close · Sep 19");
    // A mid-session UTC stamp stays on its own date.
    expect(freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-09-18T20:00:00Z" })).word).toBe("Close · Sep 18");
    // Winter (EST, UTC-5): 04:30 UTC on Jan 6 is 23:30 EST on Jan 5.
    expect(freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-01-06T04:30:00Z" })).word).toBe("Close · Jan 05");
  });

  it("FRED daily close reads Mon DD with no muted suffix at 0 or null cycles behind", () => {
    const zero = freshLabel(s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 0, reason: "10-year Treasury yield observed 2026-09-17, the newest print due." }));
    expect(zero.word).toBe("Sep 17");
    expect(zero.muted).toBeNull();
    expect(zero.tone).toBe("neutral");
    expect(zero.stale).toBe(false);
    expect(zero.reason).toBe("10-year Treasury yield observed 2026-09-17, the newest print due.");
    const nul = freshLabel(s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: null }));
    expect(nul.word).toBe("Sep 17");
    expect(nul.muted).toBeNull();
    expect(freshLabel(s({ id: "DGS2", state: "close", as_of: "2026-09-08", cycles_behind: 0 })).word).toBe("Sep 08");
  });

  it("FRED daily close 1 or 2 cycles behind appends a muted · n day(s) behind", () => {
    const one = freshLabel(s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 1 }));
    expect(one.word).toBe("Sep 17");
    expect(one.muted).toBe("· 1 day behind");
    expect(one.tone).toBe("neutral");
    expect(one.stale).toBe(false);
    const two = freshLabel(s({ id: "BAMLH0A0HYM2", state: "close", as_of: "2026-09-16", cycles_behind: 2 }));
    expect(two.word).toBe("Sep 16");
    expect(two.muted).toBe("· 2 days behind");
    expect(two.tone).toBe("neutral");
  });

  it("monthly close reads {Mon YYYY} print", () => {
    const l = freshLabel(s({ id: "CPIAUCSL", cadence: "monthly", state: "close", as_of: "2026-08-01", cycles_behind: 0 }));
    expect(l.word).toBe("Aug 2026 print");
    expect(l.tone).toBe("neutral");
    expect(l.stale).toBe(false);
    expect(freshLabel(s({ id: "UNRATE", cadence: "monthly", state: "close", as_of: "2025-12-01", cycles_behind: 0 })).word).toBe("Dec 2025 print");
    // The first of the month never slips to the previous month.
    expect(freshLabel(s({ id: "FEDFUNDS", cadence: "monthly", state: "close", as_of: "2026-01-01", cycles_behind: 0 })).word).toBe("Jan 2026 print");
  });

  it("discontinued close reads Final value · {Mon YYYY}, neutral, never stale", () => {
    const reason = "Leading index is discontinued at the source; 2020-02-01 is its final value, kept as historical data.";
    const l = freshLabel(s({ id: "USSLIND", label: "Leading index", cadence: "monthly", state: "close", as_of: "2020-02-01", cycles_behind: 0, discontinued: true, reason }));
    expect(l.word).toBe("Final value · Feb 2020");
    expect(l.tone).toBe("neutral");
    expect(l.stale).toBe(false);
    expect(l.reason).toBe(reason);
    expect(l.word).not.toMatch(/print|behind/);
  });

  it("derived close reads Mon DD like a FRED daily value", () => {
    const l = freshLabel(s({ id: "lbo_all_in_rate", kind: "derived", cadence: "daily", state: "close", as_of: "2026-08-01", cycles_behind: null }));
    expect(l.word).toBe("Aug 01");
    expect(l.muted).toBeNull();
    expect(l.tone).toBe("neutral");
  });
});

describe("freshLabel · stale", () => {
  it("FRED daily stale reads {Mon DD} · n days behind, stale tone, stale flag set", () => {
    const reason = "10-year Treasury yield observed 2026-09-04; 8 business day(s) behind the 2026-09-17 print.";
    const l = freshLabel(s({ id: "DGS10", state: "stale", as_of: "2026-09-04", cycles_behind: 8, reason }));
    expect(l.word).toBe("Sep 04 · 8 days behind");
    expect(l.tone).toBe("stale");
    expect(l.stale).toBe(true);
    expect(l.reason).toBe(reason);
    expect(freshLabel(s({ id: "DGS2", state: "stale", as_of: "2026-09-11", cycles_behind: 3 })).word).toBe("Sep 11 · 3 days behind");
    // The singular form exists for the unit even though FRED daily turns stale above 2.
    expect(freshLabel(s({ id: "DGS2", state: "stale", as_of: "2026-09-16", cycles_behind: 1 })).word).toBe("Sep 16 · 1 day behind");
  });

  it("monthly stale reads {Mon YYYY} · n release(s) behind", () => {
    const one = freshLabel(s({ id: "INDPRO", cadence: "monthly", state: "stale", as_of: "2026-07-01", cycles_behind: 1 }));
    expect(one.word).toBe("Jul 2026 · 1 release behind");
    expect(one.tone).toBe("stale");
    expect(one.stale).toBe(true);
    expect(freshLabel(s({ id: "CPIAUCSL", cadence: "monthly", state: "stale", as_of: "2026-06-01", cycles_behind: 2 })).word).toBe("Jun 2026 · 2 releases behind");
  });

  it("market_daily stale reads {Mon DD} · n session(s) behind", () => {
    const four = freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "stale", as_of: "2026-09-14", cycles_behind: 4 }));
    expect(four.word).toBe("Sep 14 · 4 sessions behind");
    expect(four.tone).toBe("stale");
    expect(four.stale).toBe(true);
    expect(freshLabel(s({ id: "market_daily", kind: "market", cadence: "daily", state: "stale", as_of: "2026-09-17", cycles_behind: 1 })).word).toBe("Sep 17 · 1 session behind");
  });

  it("market_intraday stale reads {Mon DD} · 1 session behind from the wall-time stamp", () => {
    const l = freshLabel(s({ id: "market_intraday", kind: "market", cadence: "5min", state: "stale", as_of: "2026-09-17 11:05:00", cycles_behind: 1 }));
    expect(l.word).toBe("Sep 17 · 1 session behind");
    expect(l.tone).toBe("stale");
    expect(l.stale).toBe(true);
  });
});

describe("freshLabel · fallback, unknown and bad input", () => {
  it("fallback reads Stated default with the fallback tone and never says live", () => {
    const l = freshLabel(s({ id: "lbo_all_in_rate", kind: "derived", cadence: "daily", state: "fallback", as_of: null, reason: "Stored rates unavailable; the stated defaults are in use." }));
    expect(l.word).toBe("Stated default");
    expect(l.tone).toBe("fallback");
    expect(l.stale).toBe(false);
    expect(l.reason).toBe("Stored rates unavailable; the stated defaults are in use.");
    expect(l.word).not.toMatch(/live|tracking/i);
  });

  it("unknown reads As of unknown with the unknown tone", () => {
    const l = freshLabel(s({ id: "DGS10", state: "unknown", as_of: "2026-09-01", reason: "No watermark yet." }));
    expect(l.word).toBe("As of unknown");
    expect(l.tone).toBe("unknown");
    expect(l.stale).toBe(false);
    expect(l.reason).toBe("No watermark yet.");
  });

  it("an unrecognised state word renders as unknown, never as healthy", () => {
    for (const word of ["current", "fresh", "LIVE_NOW", ""]) {
      const l = freshLabel(s({ id: "live_quotes", kind: "live", cadence: "tick", as_of: "2026-09-18T17:00:00Z", delay_min: 0, state: word as unknown as SeriesState["state"], reason: "r" }));
      expect(l.word, word).toBe("As of unknown");
      expect(l.tone, word).toBe("unknown");
      expect(l.stale, word).toBe(false);
      expect(l.reason).toBe("r");
    }
  });

  it("null and undefined input read As of unknown with an empty reason", () => {
    for (const x of [null, undefined]) {
      const l = freshLabel(x);
      expect(l.word).toBe("As of unknown");
      expect(l.tone).toBe("unknown");
      expect(l.stale).toBe(false);
      expect(l.reason).toBe("");
      expect(l.muted).toBeNull();
    }
  });

  it("every label carries all five fields", () => {
    const l = freshLabel(s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 0 }));
    for (const k of ["word", "muted", "tone", "reason", "stale"]) expect(l).toHaveProperty(k);
  });
});

describe("seededLabel", () => {
  it("reads Snapshot · as of … with the unknown tone and no health", () => {
    const l = seededLabel("2026-09-18T23:10:00-04:00");
    expect(l.word.startsWith("Snapshot · as of ")).toBe(true);
    expect(l.word.length).toBeGreaterThan("Snapshot · as of ".length);
    expect(l.tone).toBe("unknown");
    expect(l.stale).toBe(false);
  });
});

describe("storedCloseLine", () => {
  it("states the stored close and the missing one when market_daily is stale", () => {
    const f = freshnessWith([
      s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 0 }),
      s({ id: "market_daily", kind: "market", cadence: "daily", state: "stale", as_of: "2026-09-14", cycles_behind: 4 }),
    ]);
    expect(storedCloseLine(f)).toBe("The newest stored close is Sep 14; the Sep 18 close is not stored yet.");
  });

  it("zero-pads both dates", () => {
    const f = freshnessWith([s({ id: "market_daily", kind: "market", cadence: "daily", state: "stale", as_of: "2026-09-03", cycles_behind: 1 })]);
    f.session = { ...SESSION, last_completed_session: "2026-09-04" };
    expect(storedCloseLine(f)).toBe("The newest stored close is Sep 03; the Sep 04 close is not stored yet.");
  });

  it("is null when market_daily is close, absent, or there is no report", () => {
    expect(storedCloseLine(freshnessWith([s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18", cycles_behind: 0 })]))).toBeNull();
    expect(storedCloseLine(freshnessWith([s({ id: "DGS10", state: "stale", as_of: "2026-09-04", cycles_behind: 8 })]))).toBeNull();
    expect(storedCloseLine(freshnessWith(undefined))).toBeNull();
    expect(storedCloseLine(freshnessWith([]))).toBeNull();
    expect(storedCloseLine(undefined)).toBeNull();
  });

  it("is null for a stale market_intraday (only the stored daily close drives the line)", () => {
    const f = freshnessWith([
      s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18", cycles_behind: 0 }),
      s({ id: "market_intraday", kind: "market", cadence: "5min", state: "stale", as_of: "2026-09-17 11:05:00", cycles_behind: 1 }),
    ]);
    expect(storedCloseLine(f)).toBeNull();
  });
});

describe("seriesById", () => {
  const dgs10 = s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 0 });
  const md = s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18", cycles_behind: 0 });

  it("returns the series with that id", () => {
    const f = freshnessWith([dgs10, md]);
    expect(seriesById(f, "DGS10")).toEqual(dgs10);
    expect(seriesById(f, "market_daily")).toEqual(md);
  });

  it("returns undefined for a missing id, a report without series, or no report", () => {
    expect(seriesById(freshnessWith([dgs10]), "DGS2")).toBeUndefined();
    expect(seriesById(freshnessWith(undefined), "DGS10")).toBeUndefined();
    expect(seriesById(undefined, "DGS10")).toBeUndefined();
  });
});

/* ── Iteration 1 step 6: groups, the market chip, the phone line, the seeded report ── */


describe("weakest and groupLabel", () => {
  const close = s({ id: "DGS10", state: "close", as_of: "2026-09-17", cycles_behind: 0 });
  const closeOlder = s({ id: "DGS2", state: "close", as_of: "2026-09-16", cycles_behind: 1 });
  const unknown = s({ id: "T10YIE", state: "unknown" });
  const stale = s({ id: "INDPRO", cadence: "monthly", state: "stale", as_of: "2026-07-01", cycles_behind: 1 });

  it("orders stale over unknown over close (FRESHNESS_CONTRACT §3), a missing entry counting as unknown", () => {
    expect(weakest([close, stale, unknown])).toBe(stale);
    expect(weakest([close, unknown])).toBe(unknown);
    expect(weakest([close, undefined])).toBeNull();
    expect(weakest([stale, undefined])).toBe(stale);
    expect(weakest([])).toBeNull();
  });

  it("breaks a tie by cycles behind, then by the older stamp", () => {
    expect(weakest([close, closeOlder])).toBe(closeOlder);
    const a = s({ id: "A", state: "close", as_of: "2026-09-15", cycles_behind: 0 });
    expect(weakest([close, a])).toBe(a);
  });

  it("an unrecognised state word ranks as unknown, never healthy", () => {
    const odd = s({ id: "X", state: "fresh" as unknown as SeriesState["state"], as_of: "2026-09-17" });
    expect(weakest([close, odd])).toBe(odd);
    expect(groupLabel((id) => (id === "X" ? odd : close), ["DGS10", "X"]).word).toBe("As of unknown");
  });

  it("groupLabel prints the weakest word and lists every member's word in the reason", () => {
    const f = freshnessWith([close, closeOlder, stale]);
    const l = groupLabel(lookupFrom(f), ["DGS10", "DGS2", "INDPRO"]);
    expect(l.word).toBe("Jul 2026 · 1 release behind");
    expect(l.stale).toBe(true);
    expect(l.tone).toBe("stale");
    expect(l.reason).toBe("DGS10: Sep 17; DGS2: Sep 16 · 1 day behind; INDPRO: Jul 2026 · 1 release behind.");
    // A missing id reads As of unknown and is named in the reason.
    const m = groupLabel(lookupFrom(f), ["DGS10", "T5YIE"]);
    expect(m.word).toBe("As of unknown");
    expect(m.reason).toContain("T5YIE: As of unknown");
  });

  it("series[] is the one source: a disagreeing payload block never outranks it and only fills an id the report lacks", () => {
    const f = freshnessWith([close]);
    const blockStale = s({ id: "DGS10", state: "stale", as_of: "2026-09-04", cycles_behind: 8 });
    expect(groupLabel(lookupFrom(f, { DGS10: blockStale }), ["DGS10"]).word).toBe("Sep 17");
    expect(groupLabel(lookupFrom(f, null), ["DGS10"]).word).toBe("Sep 17");
    const rate = s({ id: "lbo_all_in_rate", kind: "derived", state: "fallback" });
    expect(groupLabel(lookupFrom(f, { lbo_all_in_rate: rate }), ["lbo_all_in_rate"]).word).toBe("Stated default");
    expect(groupLabel(lookupFrom(undefined, { DGS10: blockStale }), ["DGS10"]).word).toBe("Sep 04 · 8 days behind");
    expect(freshReport(f, false, null).series("DGS10", { DGS10: blockStale }).word).toBe("Sep 17");
  });
});

describe("the input id lists (A3, E3)", () => {
  it("the regime reads its three monthly inputs; the recession model its seven, never USSLIND", () => {
    expect(REGIME_INPUT_IDS).toEqual(["INDPRO", "CPIAUCSL", "UNRATE"]);
    expect([...RECESSION_INPUT_IDS].sort()).toEqual(["BAMLH0A0HYM2", "DGS10", "DGS2", "INDPRO", "T10YIE", "T5YIE", "UNRATE"]);
    expect(RECESSION_INPUT_IDS).not.toContain("USSLIND");
    expect(RECESSION_FEATURE_SERIES.lei_proxy).toEqual(["T10YIE", "T5YIE"]);
    expect(RECESSION_FEATURE_SERIES.yield_curve).toEqual(["DGS10", "DGS2"]);
    const all = Object.values(RECESSION_FEATURE_SERIES).flat();
    expect([...new Set(all)].sort()).toEqual([...RECESSION_INPUT_IDS].sort());
  });
});

describe("marketSeries (§5: live_quotes in session, the stored close otherwise)", () => {
  const daily = s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18", cycles_behind: 0 });
  it("takes live_quotes when it reads live or delayed", () => {
    const live = s({ id: "live_quotes", kind: "live", cadence: "tick", state: "live", delay_min: 0, as_of: "2026-09-18T17:00:00Z" });
    expect(marketSeries(freshnessWith([daily, live]))).toBe(live);
    const delayed = s({ id: "live_quotes", kind: "live", cadence: "tick", state: "delayed", delay_min: 15, as_of: "2026-09-18T17:00:00Z" });
    expect(freshLabel(marketSeries(freshnessWith([daily, delayed]))).word).toBe("Delayed 15 min");
  });
  it("after the bell (live_quotes close or unknown) reads the stored daily close", () => {
    const after = s({ id: "live_quotes", kind: "live", cadence: "tick", state: "close", as_of: "2026-09-19T01:30:00Z" });
    expect(freshLabel(marketSeries(freshnessWith([daily, after]))).word).toBe("Close · Sep 18");
    expect(marketSeries(freshnessWith([daily]))).toBe(daily);
    expect(freshLabel(marketSeries(freshnessWith(undefined))).word).toBe("As of unknown");
  });
});

describe("storedCloseShort, referenceLabel, stampLabel", () => {
  it("the phone line carries both dates, and is null exactly when the full line is", () => {
    const f = freshnessWith([s({ id: "market_daily", kind: "market", cadence: "daily", state: "stale", as_of: "2026-09-14", cycles_behind: 4 })]);
    expect(storedCloseShort(f)).toBe("Stored close Sep 14; Sep 18 not stored yet.");
    expect(storedCloseShort(freshnessWith([s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18" })]))).toBeNull();
    expect(storedCloseShort(undefined)).toBeNull();
  });
  it("reference content is neutral with no stale mark; a stamp-only feed is grey and never healthy", () => {
    expect(referenceLabel()).toMatchObject({ word: "Reference", tone: "neutral", stale: false });
    expect(stampLabel("Week ending Sep 11", "r")).toMatchObject({ word: "Week ending Sep 11", tone: "unknown", stale: false, reason: "r" });
    expect(stampLabel(null, "r").word).toBe("As of unknown");
  });
});

describe("the seeded report (§5: Snapshot · as of, no health)", () => {
  const f = freshnessWith([s({ id: "market_daily", kind: "market", cadence: "daily", state: "close", as_of: "2026-09-18" })]);
  it("is seeded when the report says so, or when it is the snapshot's own cached copy", () => {
    expect(isSeededReport({ ...f, seeded: true }, 0, null)).toBe(true);
    const snap = { generated_at: "2026-09-10T06:06:01Z", db_mtime: null, source: "static", entries: 12 };
    expect(isSeededReport(f, Date.parse(snap.generated_at), snap)).toBe(true);
    expect(isSeededReport(f, Date.parse(snap.generated_at) + 60_000, snap)).toBe(false);
    expect(isSeededReport(f, 123, null)).toBe(false);
    expect(isSeededReport(undefined, 0, snap)).toBe(false);
  });
  it("a seeded report reads Snapshot · as of on every series and group; a live one reads the §5 words", () => {
    const seeded = freshReport({ ...f, generated_at: "2026-09-10T06:06:01Z" }, true, null);
    expect(seeded.series("market_daily").word).toBe("Snapshot · as of Sep 10");
    expect(seeded.group(["DGS10", "DGS2"]).word).toBe("Snapshot · as of Sep 10");
    expect(seeded.series("market_daily").tone).toBe("unknown");
    const live = freshReport(f, false, null);
    expect(live.series("market_daily").word).toBe("Close · Sep 18");
    expect(live.series("DGS10").word).toBe("As of unknown");
  });
});
