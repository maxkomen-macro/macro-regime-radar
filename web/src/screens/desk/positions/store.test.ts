/**
 * The position store (§1.8, §9, v3 §16, v4 B-10): §9's rule on every
 * record, validation on load and on Import with the failures kept as
 * unreadable (never dropped), writes that keep them, explicit closes and the
 * last 90 days' counts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import sample from "../../../fixtures/desk/positions.json";
import { POSITIONS_KEY, closed90d, exportPositions, importPositions, isOpen, loadPositions, newPositionId, signedDistance, whyUnreadable, withClose, writePositions, type PositionRecord } from "./store";

const RECORDS = (sample as { positions: PositionRecord[] }).positions;
const auto = RECORDS.find((p) => p.id === "2s10s-steepener")!;
const manual = RECORDS.find((p) => p.id === "ndx-vs-spx")!;
const NOW = new Date("2026-09-22T21:00:00Z");

function memory(text: string | null = null) {
  const m = new Map<string, string>();
  if (text !== null) m.set(POSITIONS_KEY, text);
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), text: () => m.get(POSITIONS_KEY) ?? null };
}

beforeEach(() => {
  try {
    localStorage.removeItem(POSITIONS_KEY);
  } catch {
    /* no storage in this environment */
  }
});

describe("§9's rule", () => {
  it("passes every sample record: automatic with a frozen level and positive room, manual with neither", () => {
    for (const p of RECORDS) expect(whyUnreadable(p), p.id).toBeNull();
    expect(auto.monitoring).toBe("automatic");
    expect(signedDistance(auto.entry_value as number, auto.trigger!)).toBe(auto.original_room);
  });
  it("reads the signed distance the same way at entry and now: value − threshold below, threshold − value above", () => {
    expect(signedDistance(6412, { operator: "below", threshold: 6280 })).toBe(132);
    expect(signedDistance(6412, { operator: "above", threshold: 6500 })).toBe(88);
    expect(signedDistance(6200, { operator: "below", threshold: 6280 })).toBe(-80);
  });
  it("names what fails: the gate, the wording, the subject, the monitoring", () => {
    const cases: [Partial<PositionRecord> | Record<string, unknown>, RegExp][] = [
      [{ instrument: "  " }, /no instrument/],
      [{ variant: "" }, /no variant view/],
      [{ pre_mortem: " " }, /no pre-mortem/],
      [{ variant: "It will rally." }, /certainty words .*\(will\)/],
      [{ size_nav: 1.5 }, /size/],
      [{ horizon_days: 30 }, /horizon/],
      [{ wrong_if: { id: "", label: "x" } }, /“wrong if”/],
      [{ subject: { kind: "study", question: { shock: "gold" } } }, /full question/],
      [{ subject: { kind: "basket", legs: [], benchmark: null } }, /basket/],
      [{ wrong_if: { id: "signal_reverses", label: "the signal reverses" } }, /signal reverses/],
      [{ entry_date: "2026-02-30" }, /entry date/],
      [{ closes: [{ type: "sold", ts: "2026-09-10T20:00:00Z", premortem_right: null }] }, /close/],
    ];
    for (const [change, why] of cases) expect(whyUnreadable({ ...manual, ...change }), JSON.stringify(change)).toMatch(why);
  });
  it("B-10: automatic needs positive room at entry that matches its frozen level; manual carries no level", () => {
    expect(whyUnreadable({ ...auto, original_room: 0 })).toMatch(/room at entry/);
    expect(whyUnreadable({ ...auto, original_room: -3, entry_value: 35 })).toMatch(/room at entry/);
    expect(whyUnreadable({ ...auto, original_room: 12 })).toMatch(/does not match/);
    expect(whyUnreadable({ ...auto, trigger: { ...auto.trigger!, policy: "moving" } })).toMatch(/cannot be read/);
    // The S&P's 200-day is not monitored automatically, whatever the record says.
    expect(whyUnreadable({ ...auto, wrong_if: { id: "below_200d", label: "closes below its 200-day" } })).toMatch(/does not monitor/);
    // §9: automatic only when the subject's monitored quantity is the served series itself.
    expect(whyUnreadable({ ...auto, subject: { kind: "basket", legs: [{ symbol: "NVDA", weight: 100 }], benchmark: null } })).toMatch(/basket monitored automatically/);
    expect(whyUnreadable({ ...auto, instrument: "TLT" })).toMatch(/not its series/);
    expect(whyUnreadable({ ...auto, direction: "short" })).toMatch(/wrong side/);
    expect(whyUnreadable({ ...manual, original_room: 3 })).toMatch(/manual position carrying/);
    expect(whyUnreadable({ ...manual, monitoring: "sometimes" })).toMatch(/monitoring/);
  });
});

describe("storage", () => {
  it("keeps what it cannot read through load and write (§9: never dropped)", () => {
    const bad = { ...manual, id: "bad", variant: "It always works." };
    const dup = { ...auto };
    const store = memory(JSON.stringify([manual, bad, auto, dup, 7]));
    const s = loadPositions(store);
    expect(s.positions.map((p) => p.id)).toEqual(["ndx-vs-spx", "2s10s-steepener"]);
    expect(s.unreadable.map((u) => u.why)).toEqual(["certainty words in the variant view or the pre-mortem (always)", "a second record with the same id", "not a position record"]);
    expect(writePositions(s, store)).toBe("ok");
    expect(JSON.parse(store.text()!)).toEqual([manual, auto, bad, dup, 7]);
  });
  it("keeps storage that is not a JSON list whole, as one unreadable entry, and writes it back unchanged in content", () => {
    const store = memory("{not json");
    const s = loadPositions(store);
    expect(s.positions).toEqual([]);
    expect(s.unreadable).toEqual([{ raw: "{not json", why: "text that is not a position record" }]);
    writePositions({ ...s, positions: [manual] }, store);
    expect(JSON.parse(store.text()!)).toEqual([manual, "{not json"]);
  });
  it("says when the browser keeps nothing", () => {
    expect(writePositions({ positions: [], unreadable: [] }, null)).toBe("off");
    expect(writePositions({ positions: [], unreadable: [] }, { setItem: () => { throw new Error("quota"); } })).toBe("full");
  });
  it("gives a new position an id no stored record holds", () => {
    const s = { positions: [{ ...manual, id: `p${NOW.getTime().toString(36)}` }], unreadable: [] };
    expect(newPositionId(s, NOW)).toBe(`p${NOW.getTime().toString(36)}-2`);
  });
});

describe("Export / Import JSON (§1.8)", () => {
  it("exports everything, unreadable entries included, and imports without replacing or copying anything", () => {
    const s = { positions: [manual], unreadable: [{ raw: { id: "odd" }, why: "no instrument" }] };
    const text = exportPositions(s);
    expect(JSON.parse(text)).toMatchObject({ kind: "mrr.desk.positions", version: 1, positions: [manual, { id: "odd" }] });
    const changed = { ...manual, size_nav: 0.05 };
    const r = importPositions(s, JSON.stringify({ positions: [manual, auto, changed, { id: "odd" }, { id: "new-odd" }] }))!;
    // An id is a position: the same one, or a changed copy of it, is skipped and the one here kept; the unreadable kept once.
    expect([r.added, r.skipped, r.unreadable]).toEqual([1, 3, 1]);
    expect(r.store.positions).toEqual([manual, auto]);
    expect(r.store.unreadable.map((u) => (u.raw as { id: string }).id)).toEqual(["odd", "new-odd"]);
    expect(importPositions(s, "[not json")).toBeNull();
    expect(importPositions(s, '{"questions": []}')).toBeNull();
  });
  it("a changed copy of a closed position never counts its close twice", () => {
    const closed = RECORDS.find((p) => p.closes.length)!;
    const s = { positions: [closed], unreadable: [] };
    const r = importPositions(s, JSON.stringify([{ ...closed, size_nav: 0.09 }]))!;
    expect(closed90d(r.store, NOW)).toEqual(closed90d(s, NOW));
  });
});

describe("closes (§9)", () => {
  it("closes only by an explicit event, once, and counts the last 90 days' closes", () => {
    const s = { positions: RECORDS, unreadable: [] };
    // The sample: two falsified, one expired; the pre-mortem judged twice, right once.
    expect(closed90d(s, NOW)).toEqual({ falsified: 2, expired: 1, premortem_right: [1, 2] });
    const closed = withClose(s, "ndx-vs-spx", "closed", true, NOW);
    expect(isOpen(closed.positions.find((p) => p.id === "ndx-vs-spx")!)).toBe(false);
    expect(closed90d(closed, NOW)).toEqual({ falsified: 2, expired: 1, premortem_right: [2, 3] });
    // A second close of the same position records nothing.
    expect(withClose(closed, "ndx-vs-spx", "falsified", null, NOW).positions.find((p) => p.id === "ndx-vs-spx")!.closes).toHaveLength(1);
    // Closes older than 90 days leave the strip.
    expect(closed90d(s, new Date("2027-01-01T00:00:00Z"))).toEqual({ falsified: 0, expired: 0, premortem_right: [0, 0] });
  });
});
