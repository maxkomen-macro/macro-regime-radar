/**
 * Options Finder step 7: an option subject in the Position Monitor. The Finder's "Save as position" carries one
 * contract with its entry and thesis; Save records it monitored by hand with the gate the analyst wrote; the row opens
 * to what it holds and watches; an option can never be monitored automatically; and the stores written before this
 * subject existed still load and import unchanged.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import sample from "../../../fixtures/desk/positions.json";
import finder from "../../../fixtures/desk/options-finder.json";
import type { OptionRow, OptionsFinderResponse } from "../data/types";
import { POSITIONS_KEY, exportPositions, importPositions, loadPositions, whyUnreadable, type PositionRecord } from "./store";
import { optionFromSearch, optionHref, optionInstrument, optionLine, optionSubject, whyOption, type OptionSubject } from "./option";

const UP = Object.values((finder as unknown as { answers: Record<string, OptionsFinderResponse> }).answers)[0];
const ROW = (UP.rows as OptionRow[])[0];
const SUBJECT = optionSubject(ROW, UP) as OptionSubject;
const RECORDS = (sample as { positions: PositionRecord[] }).positions;

const record = (over: Partial<PositionRecord> = {}): PositionRecord => ({
  id: "p-opt",
  instrument: optionInstrument(SUBJECT),
  direction: "long",
  size_nav: null,
  horizon_days: 20,
  variant: "The market thinks a, I think b, because c.",
  pre_mortem: "It lost money because d.",
  red_team: null,
  wrong_if: { id: "custom", label: "SYN below 100" },
  subject: SUBJECT,
  monitoring: "manual",
  entry_ts: "2026-10-26T10:00:00.000Z",
  entry_date: "2026-10-26",
  entry_value: null,
  trigger: null,
  original_room: null,
  evaluation: "close",
  closes: [],
  ...over,
});

const stored = (): PositionRecord[] => JSON.parse(localStorage.getItem(POSITIONS_KEY) ?? "[]") as PositionRecord[];
const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.removeItem(POSITIONS_KEY);
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(POSITIONS_KEY);
});

describe("the option subject, pure", () => {
  it("records the served row: contract, entry at the fill and cost on the quotes' session, the view's target and the breakeven", () => {
    expect(SUBJECT).toEqual({
      kind: "option",
      contract: ROW.contract,
      type: "call",
      exp: ROW.exp,
      strike: ROW.strike,
      entry: { n: ROW.n, fill: ROW.fill, cost: ROW.cost, session: "2026-10-23", underlying_close: 100 },
      thesis: { symbol: "SYN", view: "up", target: 120, by: "2026-12-18", breakeven: ROW.breakeven_expiry },
    });
    expect(optionLine(SUBJECT)).toBe(
      `${ROW.n} × SYN Dec 18, 2026 $112.50 call at $0.90 a share on the Oct 23 close, $4,985.75 in all (the maximum loss). Level to watch: SYN at or above $120.00 by Dec 18, 2026; warning line: the breakeven at expiry, $113.41.`,
    );
  });

  it("spells a half-cent fill as the Finder does, not rounded to the cent (Codex S-15)", () => {
    const half: OptionSubject = { ...SUBJECT, entry: { ...SUBJECT.entry, n: 10, fill: 0.875, cost: 875 } };
    expect(optionLine(half)).toContain("10 × SYN Dec 18, 2026 $112.50 call at $0.875 a share on the Oct 23 close, $875.00 in all");
    expect(optionLine(SUBJECT)).toContain(" at $0.90 a share ");
  });

  it("reads an address's option only when it is whole", () => {
    const href = optionHref("/desk/position-monitor?view=client", SUBJECT);
    const q = new URLSearchParams(href.split("?")[1]);
    expect(q.get("view")).toBe("client");
    expect(q.get("new")).toBe("1");
    expect(optionFromSearch(q.get("option"))).toEqual(SUBJECT);
    expect(optionFromSearch("{not json")).toBeNull();
    expect(optionFromSearch(JSON.stringify({ ...SUBJECT, entry: { ...SUBJECT.entry, n: 0 } }))).toBeNull();
    expect(whyOption({ ...SUBJECT, thesis: { ...SUBJECT.thesis, view: "sideways" } })).toBe("an option subject without its thesis");
    expect(whyOption({ ...SUBJECT, contract: "" })).toBe("an option subject without its contract");
    expect(optionSubject({ ...ROW, n: 0 }, UP)).toBeNull();
  });

  it("passes §9's rule monitored by hand, never automatically", () => {
    expect(whyUnreadable(record())).toBeNull();
    const auto = record({ monitoring: "automatic", wrong_if: { id: "below_50d", label: "x" }, entry_value: 6000, trigger: { series: "spx", operator: "below", threshold: 5900, policy: "frozen", observed_on: "2026-10-23" }, original_room: 100 });
    expect(whyUnreadable(auto)).toBe("an option monitored automatically");
    expect(whyUnreadable(record({ subject: { ...SUBJECT, entry: { ...SUBJECT.entry, cost: -1 } } }))).toBe("an option subject without its entry");
  });

  it("refuses an option held short, saved or imported: its loss is not its premium (Codex S-3)", () => {
    expect(whyUnreadable(record({ direction: "short" }))).toBe("an option held short (the Options Finder carries long contracts only)");
    const r = importPositions({ positions: [], unreadable: [] }, JSON.stringify({ kind: "mrr.desk.positions", version: 1, positions: [record({ direction: "short" })] }));
    expect(r?.added ?? 0).toBe(0);
  });

  it("old exports still import, and an option position round-trips through Export / Import", () => {
    const old = importPositions({ positions: [], unreadable: [] }, JSON.stringify({ kind: "mrr.desk.positions", version: 1, positions: RECORDS }));
    expect(old?.added).toBe(RECORDS.filter((r) => whyUnreadable(r) === null).length);
    expect(old?.unreadable).toBe(RECORDS.filter((r) => whyUnreadable(r) !== null).length);
    const withOption = { positions: [...(old?.store.positions ?? []), record()], unreadable: [] };
    const back = importPositions({ positions: [], unreadable: [] }, exportPositions(withOption));
    expect(back?.store.positions.find((p) => p.id === "p-opt")).toEqual(record());
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([record()]));
    expect(loadPositions().positions).toEqual([record()]);
  });
});

describe("Save as position, from the Finder to the monitor", () => {
  const renderAt = (route: string) =>
    renderWithProviders(
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>,
      { route },
    );

  it("the Finder's link opens the form with the contract carried, and Save records it by hand", async () => {
    renderAt("/desk/options-finder?symbol=SYN&direction=up&target=120&by=2026-12-18&budget=5000&commission=0.65");
    const card = await screen.findByTestId("of-pick-payoff", undefined, { timeout: 4000 });
    fireEvent.click(within(card).getByRole("link", { name: new RegExp(`Save ${ROW.n} × ${ROW.contract} as a position`) }));
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("SYN Dec 18, 2026 $112.50 call"));
    expect(screen.getByText(/^Saved from the Options Finder · /)).toHaveTextContent("Level to watch: SYN at or above $120.00 by Dec 18, 2026");
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "The market thinks a, I think b, because c." } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "It lost money because d." } });
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "SYN below 100" } });
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ instrument: "SYN Dec 18, 2026 $112.50 call", direction: "long", subject: SUBJECT, monitoring: "manual", trigger: null, original_room: null });
    const row = within(screen.getByRole("region", { name: /Monitored/ })).getAllByTestId("dk-mon-row")[0];
    expect(row).toHaveAttribute("data-monitoring", "manual");
  });

  const finderToForm = async () => {
    renderAt("/desk/options-finder?symbol=SYN&direction=up&target=120&by=2026-12-18&budget=5000&commission=0.65");
    const card = await screen.findByTestId("of-pick-payoff", undefined, { timeout: 4000 });
    fireEvent.click(within(card).getByRole("link", { name: new RegExp(`Save ${ROW.n} × ${ROW.contract} as a position`) }));
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("SYN Dec 18, 2026 $112.50 call"));
  };
  const fillGate = () => {
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "The market thinks a, I think b, because c." } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "It lost money because d." } });
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "SYN below 100" } });
  };

  it("an instrument changed after the handoff detaches the option, and says so (Codex S-2)", async () => {
    await finderToForm();
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "MSFT" } });
    expect(screen.getByText(/no longer names the option carried from the Options Finder/)).toBeInTheDocument();
    fillGate();
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0]).toMatchObject({ instrument: "MSFT", subject: { kind: "instrument", id: "MSFT" } });
  });

  it("a carried option is held long: Short is not offered while it is attached (Codex S-3)", async () => {
    await finderToForm();
    const short = within(screen.getByLabelText("Direction")).getByRole("option", { name: "Short" }) as HTMLOptionElement;
    expect(short.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "MSFT" } });
    expect((within(screen.getByLabelText("Direction")).getByRole("option", { name: "Short" }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("a saved option leaves the address, so a second save from the form is not the same contract (Codex S-2)", async () => {
    await finderToForm();
    fillGate();
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(1));
    expect(stored()[0].subject).toEqual(SUBJECT);
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue(""));
    expect(screen.queryByText(/^Saved from the Options Finder · /)).toBeNull();
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "SYN Dec 18, 2026 $112.50 call" } });
    fillGate();
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(stored()).toHaveLength(2));
    expect(stored()[1].subject).toMatchObject({ kind: "instrument" });
  });

  it("an option position opens to what it holds and watches", async () => {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify([record()]));
    renderAt("/desk/position-monitor?open=p-opt");
    expect(await screen.findByTestId("pm-option")).toHaveTextContent(optionLine(SUBJECT));
  });

  it("an option the address cannot read is not carried, and says so", async () => {
    renderAt(`/desk/position-monitor?new=1&option=${encodeURIComponent("{broken")}`);
    expect(await screen.findByText(/The option in the address could not be read/)).toBeInTheDocument();
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
  });
});
