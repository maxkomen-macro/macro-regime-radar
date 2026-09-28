/**
 * Position Monitor (DESK_FRAME3_SPEC §9, v3 §16, v4 B-10): the gate fields
 * ship empty, Save stays off and names what is left until three answers and
 * a level are in and no certainty word remains, a one-click replacement
 * clears a word, Save keeps the position in this browser (nothing is
 * posted) with automatic room only for the S&P against its 50-day and 2s10s
 * against a bp level, the monitor reads the store against today's levels, a
 * row opens to its gate text and Close…, records the store cannot read are
 * listed and kept, and a carried-in study fills the instrument and nothing
 * else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useNavigate } from "react-router-dom";
import DeskShell from "../DeskShell";
import sample from "../../../fixtures/desk/positions.json";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import study from "../../../fixtures/desk/study.json";
import { FIXTURE_META, deskFixture } from "../../../fixtures/desk";
import { awaitingEnvelope } from "../data/envelope";
import { SAVED_BASKETS_KEY } from "../basket/weights";
import { parseSize } from "./PositionMonitorPage";
import { MonitoredRow } from "../kit/MonitoredRows";
import { describes, suggestions, underlyingName } from "./levels";
import { POSITIONS_KEY, type PositionRecord } from "./store";
import { findFlags, gateState, replaceFlag } from "./wording";
import { completeTechnicals } from "../../../test/desk-variants";

const RECORDS = (sample as { positions: PositionRecord[] }).positions;

/** desk/usability §14.4: the form is behind "+ New position" (`?new=1`); these tests exercise the form. */
function renderTab(route = "/desk/position-monitor?new=1") {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const stored = (): unknown[] => JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "[]") as unknown[];
const seed = (list: unknown[]) => localStorage.setItem(POSITIONS_KEY, JSON.stringify(list));

/** The three gate answers, typed. */
function answer(variant = "The market thinks a, I think b, because c.", preMortem = "It lost money because d.") {
  fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: variant } });
  fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: preMortem } });
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.removeItem(POSITIONS_KEY);
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(POSITIONS_KEY);
  vi.restoreAllMocks();
});

describe("the gate, pure", () => {
  it("flags only the five certainty words and replaces one in place", () => {
    const t = "Gold will mean-revert; it always does. It is not certain.";
    const flags = findFlags(t, "variant");
    expect(flags.map((f) => f.word)).toEqual(["will", "always"]);
    expect(replaceFlag(t, flags[0], "is likely to")).toBe("Gold is likely to mean-revert; it always does. It is not certain.");
  });
  it("blocks whole words only, in any case, in either field; keeps a capital when replacing", () => {
    expect(findFlags("I am willing and unwilling to bet", "variant")).toHaveLength(0);
    expect(findFlags("WILL it? It Always does.", "pre_mortem").map((f) => f.word)).toEqual(["will", "always"]);
    const [f] = findFlags("Will it rally?", "variant");
    expect(replaceFlag("Will it rally?", f, "is likely to")).toBe("Is likely to it rally?");
    expect(gateState({ instrument: "x", variant: "it will, it will", pre_mortem: "b", level: "l" }).left).toBe("One thing left: fix two words above");
  });
  it("suggests the short's wrong-if levels turned over; only the served series itself gets its numbers", () => {
    const t = { instrument: { symbol: "SPX", label: "S&P 500" }, ma50: 6280, ma200: 5910 } as never;
    expect(suggestions("SPX", t, null, "short").top.map((c) => c.label)).toEqual(["closes above its 50-day (6,280)", "rises 2σ over 5 days"]);
    expect(suggestions("SPX", t, null).top.map((c) => c.id)).toEqual(["below_50d", "falls_2s_5d"]);
    // A pair, an option on the index, a future: the rules without the index's numbers (Codex R-08).
    for (const i of ["NDX vs SPX", "QQQ/SPY", "ES Dec 26", "SPX Dec 26 put spread", "Long yes-no basket"]) expect(describes(i)).toBe(false);
    expect(suggestions("SPX Dec 26 put spread", t, null, "short").top[0].label).toBe("closes above its 50-day");
  });
  it("reads the size as typed", () => {
    expect([parseSize(""), parseSize("4"), parseSize(" 4% "), parseSize("0.5")]).toEqual([null, 4, 4, 0.5]);
    expect(parseSize("four")).toBeNaN();
    expect([parseSize("0x10"), parseSize("1e2"), parseSize("500"), parseSize("-3")].every((v) => Number.isNaN(v))).toBe(true);
    expect(parseSize("100")).toBe(100);
    expect([parseSize(".5"), parseSize("4.")]).toEqual([0.5, 4]);
  });
  it("a row without room prints dashes and never crashes (P-2); a manual row says manual, its bar empty (§2)", () => {
    const row = { id: "x", name: "Long TLT", size_nav: null, monitoring: "automatic", room_pct: null, to_level: null } as const;
    const a = render(<ul><MonitoredRow row={row} /></ul>);
    expect(a.container.textContent).toBe("Long TLT— NAVroom —▶");
    a.unmount();
    const b = render(<ul><MonitoredRow row={{ ...row, size_nav: 0.04, monitoring: "manual" }} /></ul>);
    expect(b.container.textContent).toBe("Long TLT4% NAVmanual▶");
    expect(b.container.querySelector(".dk-mon-bar")?.children).toHaveLength(0);
  });
  it("a bad size joins the count of what is left (R2-2)", () => {
    expect(gateState({ instrument: "x", variant: "a", pre_mortem: "b", level: null, sizeOk: false }).left).toBe("Two things left: pick a “wrong if” level, and enter the size as a number from 0 to 100, or leave it empty");
    expect(gateState({ instrument: "x", variant: "a", pre_mortem: "b", level: "l", sizeOk: false }).left).toBe("One thing left: enter the size as a number from 0 to 100, or leave it empty");
  });
  it("names what is left, in words", () => {
    expect(gateState({ instrument: "SPX", variant: "a", pre_mortem: "b", level: null }).left).toBe("One thing left: pick a “wrong if” level");
    expect(gateState({ instrument: "SPX", variant: "gold will", pre_mortem: "b", level: null }).left).toBe("Two things left: pick a “wrong if” level, and fix one word above");
    expect(gateState({ instrument: "SPX", variant: "a", pre_mortem: "b", level: "x" }).ok).toBe(true);
  });
  it("SPY gets no index numbers: levels carry numbers only for exactly the series /technicals describes (Codex R-08)", () => {
    const t = { instrument: { symbol: "SPX", label: "S&P 500" }, ma50: 6280, ma200: 5910 } as never;
    expect(suggestions("SPY", t, null).top[0].label).toBe("closes below its 50-day");
    expect(suggestions("SPY", t, null).more[0].label).toBe("closes below its 200-day");
    expect(underlyingName("SPY")).toBe("SPY");
    expect([describes("S&P 500"), describes(" s&p  500 "), describes("spx"), describes("^GSPC"), describes("SPY"), describes("")]).toEqual([true, true, true, true, false, false]);
    expect(underlyingName("spx")).toBe("S&P 500");
    expect(underlyingName("2s10s")).toBe("2s10s");
    // Without the served averages, the rules are named without numbers.
    expect(suggestions("S&P 500", { ma50: null, ma200: null }, null).top[0].label).toBe("closes below its 50-day");
  });
  it("suggests levels from the served S&P averages for an S&P instrument only", () => {
    const t = { instrument: { symbol: "SPX", label: "S&P 500" }, ma50: 6280, ma200: 5910 } as never;
    expect(suggestions("S&P 500", t, "Gold gives back its move").top.map((c) => c.label)).toEqual(["closes below its 50-day (6,280)", "falls 2σ over 5 days", "the signal reverses (Gold gives back its move)"]);
    expect(suggestions("TLT", t, null).top[0].label).toBe("closes below its 50-day");
    expect(suggestions("S&P 500", t, null).more).toHaveLength(8);
  });
});

describe("Position Monitor tab", () => {
  it("ships the gate fields empty with Save off, and has no Client toggle", async () => {
    renderTab();
    expect(await screen.findByRole("heading", { level: 1, name: "Promote to position" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
    expect(screen.getByLabelText(/Pre-mortem/)).toHaveValue("");
    expect(screen.getByLabelText(/Red team/)).toHaveValue("");
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.queryByTestId("dk-view-toggle")).toBeNull();
  });

  it("fills, fixes a certainty word in one click, and keeps the position in this browser: automatic against the S&P's 50-day, nothing posted", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-22T21:00:00Z") });
    try {
      // A session whose 50 closes are all stored: the fixture's Sep 23 reads the average null (Codex R-24).
      const { calls } = stubDesk({ "/api/desk/technicals": () => completeTechnicals() });
      renderTab();
      fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "SPX" } });
      answer("The market thinks gold will keep falling, I think it bounces, because the study says so.", "It lost money because the regime read was stale.");
      fireEvent.change(screen.getByLabelText(/Red team/), { target: { value: "The bounce is priced." } });
      const wording = screen.getByRole("group", { name: "Wording" });
      expect(wording).toHaveTextContent("1 to fix, one click");
      expect(screen.getByRole("status")).toHaveTextContent("Two things left: pick a “wrong if” level, and fix one word above");
      fireEvent.click(within(wording).getByRole("button", { name: "Use “is likely to”" }));
      expect(screen.getByLabelText(/Variant view/)).toHaveValue("The market thinks gold is likely to keep falling, I think it bounces, because the study says so.");
      await waitFor(() => expect(screen.getByRole("button", { name: /closes below its 50-day \(7,625\)/ })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day/ }));
      expect(screen.getByRole("status")).toHaveTextContent("The gate is complete. Save keeps the position in this browser.");
      fireEvent.click(screen.getByTestId("pm-save"));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved in this browser. The position is on the monitor, its room read from the served level."));
      expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
      const [p] = stored() as PositionRecord[];
      expect(p).toMatchObject({
        instrument: "SPX",
        direction: "long",
        size_nav: null,
        horizon_days: 20,
        red_team: "The bounce is priced.",
        wrong_if: { id: "below_50d", label: "closes below its 50-day (7,625)" },
        subject: { kind: "instrument", id: "spx" },
        monitoring: "automatic",
        entry_date: "2026-09-22",
        entry_value: 7706.02978515625,
        trigger: { series: "spx", operator: "below", threshold: 7624.837392578125, policy: "frozen", observed_on: "2026-09-23" },
        evaluation: "close",
        closes: [],
      });
      const mon = screen.getByRole("region", { name: /Monitored/ });
      expect(within(mon).getAllByTestId("dk-mon-row")).toHaveLength(1);
      expect(p.original_room).toBeCloseTo(7706.02978515625 - 7624.837392578125, 9);
      expect(mon).toHaveTextContent("100% room · 1.1% to level");
      expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("B-10: a level already crossed at entry is refused with a sentence, never saved as manual", async () => {
    // A session whose 50 closes are all stored: the fixture's Sep 23 reads the average null (Codex R-24).
    stubDesk({ "/api/desk/technicals": () => completeTechnicals() });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "short" } });
    answer();
    await waitFor(() => expect(screen.getByRole("button", { name: "closes above its 50-day (7,625)" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "closes above its 50-day (7,625)" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    expect(screen.getByRole("status")).toHaveTextContent("The S&P 500 is at 7,706, already above 7,625, so there is no room to monitor. Pick another level; nothing was saved.");
    // A refusal is a caution, never green (P-3); the form keeps every word.
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "amber");
    expect(screen.getByLabelText(/Variant view/)).not.toHaveValue("");
    expect(stored()).toEqual([]);
  });

  it("2s10s is monitored automatically against a bp level from entry; any other instrument or rule is manual", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "2s10s" } });
    answer();
    await waitFor(() => expect(screen.getByRole("button", { name: "falls 10 bp from entry (below +15 bp)" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "falls 10 bp from entry (below +15 bp)" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ subject: { kind: "instrument", id: "curve_2s10s" }, monitoring: "automatic", entry_value: 25, trigger: { series: "curve_2s10s", operator: "below", threshold: 15 }, original_room: 10 });
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "TLT" } });
    answer();
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    fireEvent.change(screen.getByLabelText("Size · % NAV"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved in this browser. The position is on the monitor, monitored by hand."));
    expect(stored()[1]).toMatchObject({ instrument: "TLT", size_nav: 0.03, wrong_if: { id: "custom", label: "TLT below 88" }, monitoring: "manual", entry_value: null, trigger: null, original_room: null });
    const rows = within(screen.getByRole("region", { name: /Monitored/ })).getAllByTestId("dk-mon-row");
    expect(rows.map((r) => r.getAttribute("data-monitoring"))).toEqual(["automatic", "manual"]);
    expect(rows[1]).toHaveTextContent("manual");
  });

  it("a browser that keeps nothing says so, and nothing is shown as saved", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "TLT" } });
    answer();
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    fireEvent.click(screen.getByTestId("pm-save"));
    expect(screen.getByRole("status")).toHaveTextContent("This browser's storage is full, so nothing was saved.");
    expect(screen.getByText("No open positions in this browser.")).toBeInTheDocument();
  });

  it("SPY gets the rules without the index's numbers; the index itself gets them (Codex R-08)", async () => {
    // A session whose 50 closes are all stored: the fixture's Sep 23 reads the average null (Codex R-24).
    stubDesk({ "/api/desk/technicals": () => completeTechnicals() });
    renderTab();
    // The index first, so the served numbers are known to have arrived before SPY is judged (G4-5).
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "closes below its 50-day (7,625)" })).toBeInTheDocument());
    expect(screen.getByText(/suggested for S&P 500/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "SPY" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "closes below its 50-day" })).toBeInTheDocument());
    expect(screen.getByText(/suggested for SPY/)).toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(/7,625|7,192/);
  });

  it("the S&P is known by its name, not by a served field: /technicals without `instrument` still numbers and monitors its 50-day (§12.7)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...completeTechnicals(), instrument: undefined }) });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    answer();
    fireEvent.click(await screen.findByRole("button", { name: "closes below its 50-day (7,625)" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ subject: { kind: "instrument", id: "spx" }, monitoring: "automatic", trigger: { series: "spx", threshold: 7624.837392578125 } });
  });

  it("with /technicals awaiting, the S&P's 50-day is refused as not served, never saved as manual (§9, B-10)", async () => {
    stubDesk({ "/api/desk/technicals": () => awaitingEnvelope({ reason: "generation warming", until: null }, FIXTURE_META) });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    answer();
    fireEvent.click(screen.getByRole("button", { name: "closes below its 50-day" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    expect(screen.getByRole("status")).toHaveTextContent("The S&P 500 level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(stored()).toEqual([]);
  });

  it("on the fixture's Sep 23, the 50-day reads null across the missing Sep 22 close: no number on the chip, and Save refuses it as not served (Codex R-24)", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    answer();
    await waitFor(() => expect(screen.getByRole("button", { name: "closes below its 50-day" })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /closes below its 50-day \(/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "closes below its 50-day" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    expect(screen.getByRole("status")).toHaveTextContent("The S&P 500 level is not served right now, so the room at entry cannot be recorded. Nothing was saved.");
    expect(stored()).toEqual([]);
  });

  it("Codex R-23: a study carried with its horizon asks that horizon", async () => {
    const { calls } = stubDesk();
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak&horizon=5");
    await waitFor(() => expect(calls).toContain("GET /api/desk/study?preset=gold-2sigma-spx-weak&horizon=5"));
    expect(calls.filter((c) => c.startsWith("GET /api/desk/study?") && !c.includes("horizon=5"))).toEqual([]);
  });

  it("a basket sent from Basket & Hedge is monitored by hand, whatever its instrument reads (§9)", async () => {
    localStorage.setItem(SAVED_BASKETS_KEY, JSON.stringify([{ id: "local-1", name: "Grid", legs: [{ symbol: "CEG", name: null, weight: 100 }], saved_at: "2026-09-22T00:00:00Z" }]));
    try {
      renderTab("/desk/position-monitor?basket=local-1");
      await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("Grid basket"));
      fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "2s10s" } });
      answer();
      fireEvent.click(await screen.findByRole("button", { name: /falls 10 bp from entry/ }));
      fireEvent.click(screen.getByTestId("pm-save"));
      await waitFor(() => expect(stored()).toHaveLength(1));
      expect(stored()[0]).toMatchObject({ subject: { kind: "basket", legs: [{ symbol: "CEG", weight: 100 }], benchmark: null }, monitoring: "manual", trigger: null, original_room: null });
    } finally {
      localStorage.removeItem(SAVED_BASKETS_KEY);
    }
  });

  it("the monitor: sorted by room, manual rows last by id, a row opens to its gate text, and ?open= opens one", async () => {
    seed(RECORDS);
    renderTab("/desk/position-monitor?open=2s10s-steepener");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("40% room · 10 bp to level"));
    expect(within(mon).getAllByTestId("dk-mon-row").map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "ai-infra-hedged", "ndx-vs-spx"]);
    expect(mon).toHaveTextContent("2s10s below +15 bp · now +25 bp");
    expect(mon).toHaveTextContent(/2% NAV · DV01 — · \d+ of 20 trading days · opened Sep 2/);
    expect(mon).toHaveTextContent("TODO(Max): the variant view for 2s10s steepener");
    expect(within(mon).getByRole("link", { name: "Open the study behind it →" })).toHaveAttribute("href", "/desk/event-study?shock=curve_2s10s&window=20&move=up2s&while=none&target=spx&horizon=20");
    expect(within(mon).queryByRole("link", { name: /Price a hedge/ })).toBeNull();
    expect(mon).toHaveTextContent("12% deployed, 3 positions");
    fireEvent.click(within(within(mon).getAllByTestId("dk-mon-row")[2]).getAllByRole("button")[0]);
    await waitFor(() => expect(mon).toHaveTextContent("TODO(Max): the variant view for Long NDX vs SPX"));
    expect(mon).toHaveTextContent("NDX gives back 3.4% against SPX from entry");
    expect(mon).toHaveTextContent("Monitored by hand: close it when the level is reached.");
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toHaveTextContent(/Falsified on level\s*2\s*Expired at horizon\s*1\s*Pre-mortem was right\s*1 of 2/);
  });

  it("Close… stores an explicit close and the pre-mortem judged; the row leaves the monitor for the strip", async () => {
    seed(RECORDS);
    renderTab("/desk/position-monitor?open=ndx-vs-spx");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    fireEvent.click(await within(mon).findByRole("button", { name: "Close…" }));
    const close = within(mon).getByRole("group", { name: "Close as" });
    // §14.13 (the merge review): no disabled Close position; it shows once a close type is picked.
    expect(within(close).queryByRole("button", { name: "Close position" })).toBeNull();
    expect(close).toHaveTextContent("Pick how it closed to close it.");
    expect(close.querySelectorAll("button:disabled")).toHaveLength(0);
    fireEvent.click(within(close).getByRole("button", { name: "Expired at horizon" }));
    expect(close).not.toHaveTextContent("Pick how it closed to close it.");
    fireEvent.click(within(close).getByRole("button", { name: "Yes" }));
    fireEvent.click(within(close).getByRole("button", { name: "Close position" }));
    await waitFor(() => expect(within(mon).getAllByTestId("dk-mon-row").map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "ai-infra-hedged"]));
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toHaveTextContent(/Expired at horizon\s*2\s*Pre-mortem was right\s*2 of 3/);
    const ndx = (stored() as PositionRecord[]).find((p) => p.id === "ndx-vs-spx")!;
    expect(ndx.closes).toEqual([{ type: "expired", ts: expect.any(String), premortem_right: true }]);
  });

  it("a record the store cannot read is listed with its reason and kept through a save (§9: never dropped)", async () => {
    const bad = { ...RECORDS[0], id: "odd-one", variant: "It will work." };
    seed([bad, RECORDS[0]]);
    renderTab();
    const card = await screen.findByTestId("pm-unreadable");
    expect(card).toHaveTextContent("Unreadable · 1 kept, not monitored");
    expect(card).toHaveTextContent("odd-one · NDX vs SPX: certainty words in the variant view or the pre-mortem (will)");
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "TLT" } });
    answer();
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(3));
    expect(stored()).toContainEqual(bad);
  });

  it("Import JSON merges a file, keeps what it cannot read, and says what it did", async () => {
    renderTab();
    const text = JSON.stringify({ kind: "mrr.desk.positions", version: 1, positions: [...RECORDS.slice(0, 2), { id: "broken" }] });
    const file = new File([text], "positions.json", { type: "application/json" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(text) });
    fireEvent.change(await screen.findByLabelText("Import positions"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByRole("region", { name: "Positions kept in this browser" })).toHaveTextContent("Imported 2 positions; 1 unreadable, kept below."));
    expect(within(screen.getByRole("region", { name: /Monitored/ })).getAllByTestId("dk-mon-row")).toHaveLength(2);
    expect(screen.getByTestId("pm-unreadable")).toHaveTextContent("broken: no instrument");
  });

  it("the fixture server keeps no positions: GET is a deferred stub, POST is 405 (§12.0, §12.13)", () => {
    expect(JSON.parse(deskFixture("GET", "/api/desk/positions")!.body)).toMatchObject({ status: "awaiting", unavailable: { reason: "Positions are kept in this browser; there is no server position store." } });
    expect(deskFixture("POST", "/api/desk/positions", "{}")!.status).toBe(405);
  });

  it("the carried study's target, named by its series[] entry, fills the instrument and the subtitle (§12.2)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, series: study.series.map((x) => (x.key === "spx" ? { ...x, label: "S&P 500 index" } : x)) }) });
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500 index"));
    expect(screen.getByText(/Carried in from Event Study · .*→ S&P 500 index over the next/)).toBeInTheDocument();
  });

  it("a target series[] does not list goes unnamed, in the subtitle and the instrument alike (Codex G2-9)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, series: study.series.filter((x) => x.key !== "spx") }) });
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByText(/Carried in from Event Study · .*→ the study's target over the next/)).toBeInTheDocument());
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
  });

  it("while the next carried study loads, the previous one is not carried: nothing binds to it (Codex G2-10)", async () => {
    stubDesk({ "/api/desk/study": (u) => (u.searchParams.get("preset") === "gold-2sigma-spx-weak" ? study : new Promise(() => {})) });
    const Go = () => {
      const nav = useNavigate();
      return (
        <button type="button" onClick={() => nav("/desk/position-monitor?from=golden-cross")}>
          next study
        </button>
      );
    };
    renderWithProviders(
      <>
        <Routes>
          <Route path="/desk/:page?" element={<DeskShell />} />
        </Routes>
        <Go />
      </>,
      { route: "/desk/position-monitor?from=gold-2sigma-spx-weak" },
    );
    await waitFor(() => expect(screen.getByText(/Carried in from Event Study/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /the signal reverses/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "next study" }));
    await waitFor(() => expect(screen.queryByText(/Carried in from Event Study · Gold/)).toBeNull());
    expect(screen.queryByRole("button", { name: /the signal reverses/ })).toBeNull();
  });

  it("a carried study is the subject, its six slots; its reversal is offered and the size is kept as a fraction (§9)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, slug: null }) });
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    fireEvent.change(screen.getByLabelText("Size · % NAV"), { target: { value: "4%" } });
    answer();
    fireEvent.click(await screen.findByRole("button", { name: /the signal reverses/ }));
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    const [p] = stored() as PositionRecord[];
    expect(p).toMatchObject({ instrument: "S&P 500", size_nav: 0.04, wrong_if: { id: "signal_reverses" }, monitoring: "manual", subject: { kind: "study", question: { shock: "gold", window: 20, move: "up2s", while: "spx_below_50", target: "spx", horizon: 20 } } });
    expect(Object.keys((p.subject as { question: object }).question).sort()).toEqual(["horizon", "move", "shock", "target", "while", "window"]);
  });

  it("a carried study's S&P 50-day level is monitored automatically, the study kept as its subject", async () => {
    // A session whose 50 closes are all stored: the fixture's Sep 23 reads the average null (Codex R-24).
    stubDesk({ "/api/desk/technicals": () => completeTechnicals() });
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    answer();
    fireEvent.click(await screen.findByRole("button", { name: "closes below its 50-day (7,625)" }));
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ subject: { kind: "study" }, monitoring: "automatic", trigger: { series: "spx", threshold: 7624.837392578125 } });
  });

  it("with no study carried in, the reversal is not offered", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "S&P 500" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /closes below its 50-day/ })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /the signal reverses/ })).toBeNull();
  });

  it("a picked level follows the instrument's label, and lapses when the direction turns it over (R2-1)", async () => {
    // A session whose 50 closes are all stored: the fixture's Sep 23 reads the average null (Codex R-24).
    stubDesk({ "/api/desk/technicals": () => completeTechnicals() });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "SPX" } });
    answer();
    await waitFor(() => expect(screen.getByRole("button", { name: /closes below its 50-day \(7,625\)/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day \(7,625\)/ }));
    expect(screen.getByTestId("pm-save")).toBeEnabled();
    // Direction: the long's level is not a short's, so nothing is picked any more.
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "short" } });
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("pick a “wrong if” level");
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "long" } });
    // Switching back brings nothing back: the dropped level stays dropped.
    expect(screen.getByRole("button", { name: /closes below its 50-day \(7,625\)/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day \(7,625\)/ }));
    // Instrument: the same rule without the S&P's number is still offered, and its label follows it.
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "TLT" } });
    const chip = screen.getByRole("button", { name: "closes below its 50-day" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ instrument: "TLT", wrong_if: { id: "below_50d", label: "closes below its 50-day" }, monitoring: "manual" });
  });

  it("a size that is not a number keeps Save off and says so", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "TLT" } });
    fireEvent.change(screen.getByLabelText("Size · % NAV"), { target: { value: "four" } });
    answer();
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("enter the size as a number");
  });

  it("no carried study asks no /study; an unanswerable one says it is awaiting refresh", async () => {
    const { calls } = stubDesk();
    const first = renderTab();
    await screen.findByLabelText("Instrument");
    expect(calls.some((c) => c.includes("/api/desk/study"))).toBe(false);
    expect(calls.some((c) => c.includes("/api/desk/positions"))).toBe(false);
    first.unmount();
    stubDesk();
    renderTab("/desk/position-monitor?from=no-such-study");
    await waitFor(() => expect(screen.getByText(/The study carried in from Event Study \(no-such-study\) is awaiting refresh/)).toBeInTheDocument());
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
  });

  it("an empty store says so; a null size leaves the deployed share out", async () => {
    const first = renderTab();
    expect(await screen.findByText("No open positions in this browser.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toHaveTextContent(/Pre-mortem was right\s*0 of 0/);
    first.unmount();
    seed(RECORDS.map((p, i) => (i === 0 ? { ...p, size_nav: null } : p)));
    renderTab();
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("3 positions · click a row"));
    expect(mon).not.toHaveTextContent("deployed");
  });

  it("a study carried in as the six slots fills the same fields", async () => {
    renderTab("/desk/position-monitor?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
  });

  it("a study carried in fills the instrument and the horizon, nothing in the gate", async () => {
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    expect(screen.getByLabelText("Horizon")).toHaveValue("20");
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
    // The shock is named by the served series label, the registry's (§12.2).
    expect(screen.getByText(/Carried in from Event Study · Gold \(COMEX front month\) up 2σ or more over 20 days while S&P below its 50-day → S&P 500 over the next 1 month/)).toBeInTheDocument();
  });
});

describe("opened from Technicals (§14.2)", () => {
  it("`?instrument=` fills the empty instrument field and says where it came from; the gate is unchanged", async () => {
    stubDesk();
    renderTab("/desk/position-monitor?new=1&instrument=NVDA");
    const field = await screen.findByRole("combobox", { name: "Instrument" });
    await waitFor(() => expect(field).toHaveValue("NVDA"));
    expect(screen.getByText(/Opened from Technicals · NVDA/)).toBeInTheDocument();
    expect(screen.getByTestId("pm-save")).toBeDisabled();
  });
});

describe("saved positions first (§14.4)", () => {
  it("opens on the monitored rows, the closes and the store; the form and the gate wait behind + New position", async () => {
    seed(RECORDS);
    stubDesk();
    renderTab("/desk/position-monitor");
    expect(await screen.findByRole("heading", { level: 1, name: "Position Monitor" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("region", { name: /Monitored/ })).toHaveTextContent("2s10s"));
    expect(screen.queryByRole("form", { name: "Promote to position" })).toBeNull();
    expect(screen.queryByText(/Discipline gate/)).toBeNull();
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toBeInTheDocument();
  });

  it("an empty monitor points at + New position, and shows no Export for nothing kept", async () => {
    stubDesk();
    renderTab("/desk/position-monitor");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    expect(within(mon).getByRole("link", { name: "+ New position" })).toHaveAttribute("href", "/desk/position-monitor?new=1");
    expect(screen.queryByRole("button", { name: "Export JSON" })).toBeNull();
  });

  it("the form opens with ?new=1, and Back to the monitor closes it, carried parameters included", async () => {
    stubDesk();
    renderTab("/desk/position-monitor?new=1&instrument=NVDA");
    expect(await screen.findByRole("form", { name: "Promote to position" })).toBeInTheDocument();
    expect(screen.getByText(/Discipline gate/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to the monitor" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Promote to position" })).toBeNull());
  });
});

describe("the Monitored card's levels come from the API (desk/usability §14.10, §14.12)", () => {
  const macro = () => JSON.parse(deskFixture("GET", "/api/desk/macro")!.body) as unknown;

  it("says Loading live data… while the 2s10s level is asked; the answer replaces it", async () => {
    seed(RECORDS);
    let answer: (v: unknown) => void = () => {};
    const held = new Promise((resolve) => (answer = resolve));
    stubDesk({ "/api/desk/macro": () => held });
    renderTab("/desk/position-monitor");
    const card = await screen.findByRole("region", { name: "Monitored" });
    await waitFor(() => expect(within(card).getByTestId("dk-loading")).toHaveTextContent("Loading live data…"));
    answer(macro());
    await waitFor(() => expect(within(card).queryByTestId("dk-loading")).toBeNull());
    expect(within(card).queryByTestId("dk-failed")).toBeNull();
  });

  it("says Couldn't load · Retry when the level's request failed, and Retry asks again", async () => {
    seed(RECORDS);
    let fail = true;
    const { calls } = stubDesk({ "/api/desk/macro": () => (fail ? { status: 503, body: { detail: "forced failure" } } : macro()) });
    renderTab("/desk/position-monitor");
    const card = await screen.findByRole("region", { name: "Monitored" });
    await waitFor(() => expect(within(card).getByTestId("dk-failed")).toHaveTextContent("Couldn't load · Retry"), { timeout: 4000 });
    fail = false;
    const before = calls.filter((c) => c.startsWith("GET /api/desk/macro")).length;
    fireEvent.click(within(card).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(card).queryByTestId("dk-failed")).toBeNull());
    expect(calls.filter((c) => c.startsWith("GET /api/desk/macro")).length).toBeGreaterThan(before);
  });

  it("with no automatic position the card asks nothing of its own and says nothing about loading", async () => {
    seed(RECORDS.filter((p) => p.monitoring === "manual"));
    stubDesk({ "/api/desk/macro": () => new Promise(() => {}) });
    renderTab("/desk/position-monitor");
    const card = await screen.findByRole("region", { name: "Monitored" });
    await new Promise((r) => setTimeout(r, 50));
    expect(within(card).queryByTestId("dk-loading")).toBeNull();
  });
});
