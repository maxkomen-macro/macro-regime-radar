/**
 * Position Monitor (DESK_FRAME3_SPEC §9, §12.8): the gate fields ship empty,
 * Save stays off and names what is left until three answers and a level are
 * in and no certainty word remains, a one-click replacement clears a word,
 * Save posts to /positions (which applies the same rules), the saved position
 * appears on the monitor, a row opens to its gate text (and `?open=` opens
 * one), and a carried-in study fills the instrument and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import positions from "../../../fixtures/desk/positions.json";
import type { PositionExpanded } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { falsifiesLine, parseSize, refusalWords, sizeLine } from "./PositionMonitorPage";
import { DeskApiError } from "../data/api";
import { MonitoredRow, levelText, sortByRoom } from "../kit/MonitoredRows";
import { render } from "@testing-library/react";
import { onSpx, suggestions } from "./levels";
import { findFlags, gateState, replaceFlag } from "./wording";

function renderTab(route = "/desk/position-monitor") {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
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
  it("suggests the short's wrong-if levels turned over; a pair is not the S&P", () => {
    const t = { ma50: 6280, ma200: 5910 } as never;
    expect(suggestions("SPX Dec 26 put spread", t, null, "short").top.map((c) => c.label)).toEqual(["closes above its 50-day (6,280)", "rises 2σ over 5 days"]);
    expect(suggestions("SPX", t, null).top.map((c) => c.id)).toEqual(["below_50d", "falls_2s_5d"]);
    expect(onSpx("NDX vs SPX")).toBe(false);
    expect(onSpx("QQQ/SPY")).toBe(false);
    expect(onSpx("ES Dec 26")).toBe(true);
    expect(onSpx("Long yes-no basket")).toBe(false);
  });
  it("reads the size as typed, and words each refusal", () => {
    expect([parseSize(""), parseSize("4"), parseSize(" 4% "), parseSize("0.5")]).toEqual([null, 4, 4, 0.5]);
    expect(parseSize("four")).toBeNaN();
    expect(refusalWords(new DeskApiError(422, "x", { error: "gate", missing: ["level", "pre_mortem"] } as never))).toBe("The server says the gate is incomplete: a “wrong if” level, the pre-mortem. Nothing was saved.");
    expect(refusalWords(new DeskApiError(422, "x", { error: "gate" } as never))).toBe("The server says the gate is incomplete. Nothing was saved.");
    expect(refusalWords(new DeskApiError(422, "x", { error: "wording", words: ["will"] } as never))).toBe("The server refused certainty words: will. Nothing was saved.");
    expect(refusalWords(new TypeError("Failed to fetch"))).toBe("The data service did not answer; nothing was saved.");
    // deskPost wraps a failed fetch as status 0 (R2-3).
    expect(refusalWords(new DeskApiError(0, "network"))).toBe("The data service did not answer; nothing was saved.");
    expect([parseSize("0x10"), parseSize("1e2"), parseSize("500"), parseSize("-3")].every((v) => Number.isNaN(v))).toBe(true);
    expect(parseSize("100")).toBe(100);
    expect([parseSize(".5"), parseSize("4.")]).toEqual([0.5, 4]);
  });
  it("a row with unserved values prints dashes and never crashes (P-2)", () => {
    const row = { id: "x", name: "Long TLT", instrument: "TLT", direction: "long", size_nav: null, room_pct: null, to_level: null, opened: "2026-09-22", horizon_days: 20, day: 1 } as never;
    const { container } = render(<ul><MonitoredRow row={row} /></ul>);
    expect(container.textContent).toBe("Long TLT— NAVroom —▶");
    expect(levelText({ value: -2, unit: "bp" })).toBe("−2 bp");
    expect(sortByRoom([{ room_pct: null }, { room_pct: 0.4 }]).map((r) => r.room_pct)).toEqual([0.4, null]);
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
  it("suggests levels from the served S&P averages for an S&P instrument only", () => {
    expect(onSpx("SPX Dec 26 call spread")).toBe(true);
    expect(onSpx("TLT")).toBe(false);
    const t = { ma50: 6280, ma200: 5910 } as never;
    expect(suggestions("S&P 500", t, "Gold gives back its move").top.map((c) => c.label)).toEqual(["closes below its 50-day (6,280)", "falls 2σ over 5 days", "the signal reverses (Gold gives back its move)"]);
    expect(suggestions("TLT", t, null).top[0].label).toBe("closes below its 50-day");
    expect(suggestions("S&P 500", t, null).more).toHaveLength(8);
  });
  it("spells the expanded row's lines from served fields", () => {
    const p = positions.positions.find((x) => x.id === "2s10s-steepener") as PositionExpanded;
    expect(falsifiesLine(p)).toBe("2s10s below +38 bp · now +41 bp");
    expect(sizeLine(p)).toBe("2% NAV · DV01 $1.4k · 14 of 20 trading days · opened Sep 2");
  });
});

describe("Position Monitor tab", () => {
  it("ships the gate fields empty with Save off, and has no Client toggle", async () => {
    renderTab();
    expect(await screen.findByRole("heading", { level: 1, name: "Promote to position" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
    expect(screen.getByLabelText(/Pre-mortem/)).toHaveValue("");
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.queryByTestId("dk-view-toggle")).toBeNull();
  });

  it("fills, fixes a certainty word in one click, saves to the server and shows the position", async () => {
    const { calls } = stubDesk();
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "SPX Dec 26 call spread" } });
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "The market thinks gold will keep falling, I think it bounces, because the study says so." } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "It lost money because the regime read was stale." } });
    const wording = screen.getByRole("group", { name: "Wording" });
    expect(wording).toHaveTextContent("1 to fix, one click");
    expect(screen.getByRole("status")).toHaveTextContent("Two things left: pick a “wrong if” level, and fix one word above");
    fireEvent.click(within(wording).getByRole("button", { name: "Use “is likely to”" }));
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("The market thinks gold is likely to keep falling, I think it bounces, because the study says so.");
    await waitFor(() => expect(screen.getByRole("button", { name: /closes below its 50-day \(6,280\)/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day/ }));
    const save = screen.getByTestId("pm-save");
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(calls.some((c) => c.startsWith("POST /api/desk/positions"))).toBe(true);
    await waitFor(() => expect(screen.getAllByTestId("dk-mon-row")).toHaveLength(4));
    expect(screen.getByLabelText(/Variant view/)).toHaveValue("");
  });

  it("the server's refusal is shown, not hidden", async () => {
    stubDesk({ "/api/desk/positions": (_u, init) => (init?.method === "POST" ? { status: 422, body: { error: "gate", missing: ["level"] } } : positions) });
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "TLT" } });
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("The server says the gate is incomplete: a “wrong if” level. Nothing was saved."));
    // A refusal is a caution, never green (P-3).
    expect(screen.getByRole("status")).toHaveAttribute("data-tone", "amber");
  });

  it("the monitor: sorted by room, a row opens to its gate text, and ?open= opens one", async () => {
    renderTab("/desk/position-monitor?open=2s10s-steepener");
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(within(mon).getAllByTestId("dk-mon-row")).toHaveLength(3));
    expect(within(mon).getAllByTestId("dk-mon-row").map((r) => r.getAttribute("data-id"))).toEqual(["2s10s-steepener", "ai-infra-hedged", "ndx-vs-spx"]);
    expect(mon).toHaveTextContent("2s10s below +38 bp · now +41 bp");
    expect(mon).toHaveTextContent("TODO(Max): the variant view for 2s10s steepener");
    expect(within(mon).getByRole("link", { name: "Open the study behind it →" })).toHaveAttribute("href", "/desk/event-study?preset=2s10s-2sigma-steepening");
    expect(mon).toHaveTextContent("12% deployed, 3 positions");
    fireEvent.click(within(within(mon).getAllByTestId("dk-mon-row")[2]).getByRole("button"));
    await waitFor(() => expect(mon).toHaveTextContent("TODO(Max): the variant view for Long NDX vs SPX"));
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toHaveTextContent(/Pre-mortem was right\s*2 of 4/);
  });

  it("the POST carries the size as a fraction, the level, the direction and the carried study", async () => {
    const posts: unknown[] = [];
    stubDesk({ "/api/desk/positions": (_u, init) => (init?.method === "POST" ? (posts.push(JSON.parse(String(init.body))), { status: 201, body: {} }) : positions) });
    renderTab("/desk/position-monitor?from=gold-2sigma-spx-weak");
    await waitFor(() => expect(screen.getByLabelText("Instrument")).toHaveValue("S&P 500"));
    fireEvent.change(screen.getByLabelText("Size · % NAV"), { target: { value: "4%" } });
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "SPX above 6,600" } });
    // Picking a chip clears the typed level (P-13).
    await waitFor(() => expect(screen.getByRole("button", { name: /closes above its 50-day/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /closes above its 50-day/ }));
    expect(screen.getByLabelText("Or type your own level")).toHaveValue("");
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ instrument: "S&P 500", direction: "short", size_nav: 0.04, horizon_days: 20, wrong_if: { id: "above_50d" }, study_slug: "gold-2sigma-spx-weak" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(screen.getByRole("status")).not.toHaveAttribute("data-tone", "green");
  });
  it("a picked level follows the instrument's label, and lapses when the direction turns it over (R2-1)", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "SPX Dec 26 call spread" } });
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "b" } });
    await waitFor(() => expect(screen.getByRole("button", { name: /closes below its 50-day \(6,280\)/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day \(6,280\)/ }));
    expect(screen.getByTestId("pm-save")).toBeEnabled();
    // Direction: the long's level is not a short's, so nothing is picked any more.
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "short" } });
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("pick a “wrong if” level");
    // Instrument: the same rule without the S&P's number is still offered, and its label follows it.
    fireEvent.change(screen.getByLabelText("Direction"), { target: { value: "long" } });
    // Switching back brings nothing back: the dropped level stays dropped.
    expect(screen.getByRole("button", { name: /closes below its 50-day \(6,280\)/ })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /closes below its 50-day \(6,280\)/ }));
    fireEvent.change(screen.getByLabelText("Instrument"), { target: { value: "TLT" } });
    const chip = screen.getByRole("button", { name: "closes below its 50-day" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    const posts: unknown[] = [];
    stubDesk({ "/api/desk/positions": (_u, init) => (init?.method === "POST" ? (posts.push(JSON.parse(String(init.body))), { status: 201, body: {} }) : positions) });
    fireEvent.click(screen.getByTestId("pm-save"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ instrument: "TLT", wrong_if: { id: "below_50d", label: "closes below its 50-day" } });
  });
  it("a size that is not a number keeps Save off and says so", async () => {
    renderTab();
    fireEvent.change(await screen.findByLabelText("Instrument"), { target: { value: "TLT" } });
    fireEvent.change(screen.getByLabelText("Size · % NAV"), { target: { value: "four" } });
    fireEvent.change(screen.getByLabelText(/Variant view/), { target: { value: "a" } });
    fireEvent.change(screen.getByLabelText(/Pre-mortem/), { target: { value: "b" } });
    fireEvent.change(screen.getByLabelText("Or type your own level"), { target: { value: "TLT below 88" } });
    expect(screen.getByTestId("pm-save")).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("enter the size as a number");
  });
  it("no carried study asks no /study; an unanswerable one says it is awaiting refresh", async () => {
    const { calls } = stubDesk();
    const first = renderTab();
    await screen.findByLabelText("Instrument");
    expect(calls.some((c) => c.includes("/api/desk/study"))).toBe(false);
    first.unmount();
    stubDesk();
    renderTab("/desk/position-monitor?from=no-such-study");
    await waitFor(() => expect(screen.getByText(/The study carried in from Event Study \(no-such-study\) is awaiting refresh/)).toBeInTheDocument());
    expect(screen.getByLabelText("Instrument")).toHaveValue("");
  });
  it("an empty list says so; a null size leaves the deployed share out", async () => {
    stubDesk({ "/api/desk/positions": () => ({ ...positions, positions: [] }) });
    const first = renderTab();
    expect(await screen.findByText("No open positions.")).toBeInTheDocument();
    first.unmount();
    stubDesk({ "/api/desk/positions": () => ({ ...positions, positions: positions.positions.map((p, i) => (i === 0 ? { ...p, size_nav: null } : p)) }) });
    renderTab();
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("3 positions · click a row"));
    expect(mon).not.toHaveTextContent("deployed");
  });
  it("a failed /positions keeps both cards' labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/positions": () => ({ status: 503, body: { error: "warming" } }) });
    renderTab();
    const mon = await screen.findByRole("region", { name: /Monitored/ });
    await waitFor(() => expect(mon).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: "Closed in the last 90 days" })).toHaveTextContent(/Closed · last 90d\s*Awaiting refresh/);
  });
  it("a position's missing values are left out, never printed as null", () => {
    const p = { ...(positions.positions[0] as PositionExpanded), dv01: null, day: null, falsifies_at: null } as unknown as PositionExpanded;
    expect(sizeLine(p)).not.toMatch(/null|NaN|undefined/);
    expect(falsifiesLine(p)).toBe("—");
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
    expect(screen.getByText(/Carried in from Event Study · Gold up 2σ or more over 20 days while S&P below its 50-day → S&P 500 over the next 1 month/)).toBeInTheDocument();
  });
});
