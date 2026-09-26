/**
 * Codex round 2's open findings, R-16 to R-20, each re-verified at the tip
 * (item 14). Codex's own repros were not in the repository, so each repro here
 * is written from the finding as recorded: R-16 dropped rows give wrong totals
 * and false empty-state claims; R-17 a missing firing status prints "Not
 * firing today"; R-18 a missing requested horizon substitutes another; R-19 a
 * missing comparison disappears without an unavailable state; R-20 tiny
 * distinct weights alias to zero.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "./DeskShell";
import ledger from "../../fixtures/desk/ledger.json";
import overview from "../../fixtures/desk/overview.json";
import pipeline from "../../fixtures/desk/pipeline.json";
import study from "../../fixtures/desk/study.json";
import { renderWithProviders } from "../../test/utils";
import { stubDesk } from "../../test/desk";
import { checkAnswer, droppedOf, schemaFor } from "./data/schema";
import { decimal, normalize, readSaved, savedLegs, toWork, totalText, writeSaved, type WorkLeg } from "./basket/weights";
import sectorsFixture from "../../fixtures/desk/sectors.json";
import AnswerCard from "./event-study/AnswerCard";
import catalogFixture from "../../fixtures/desk/study-catalog.json";

function renderTab(route: string) {
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

/** A copy of an answer without some of its keys. */
function without<T extends Record<string, unknown>>(o: T, ...keys: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}

describe("R-16: rows the boundary drops are said; no total and no 'none' is read from what is left", () => {
  it("the boundary records how many rows each list lost, and ignores a served count of its own", () => {
    const out = checkAnswer({ ...ledger, _dropped: { signals: 99 }, signals: [{ label: "no slug" }, ...ledger.signals] }, schemaFor("/ledger")!);
    expect(droppedOf(out, "signals")).toBe(1);
    expect((out as { signals: unknown[] }).signals).toHaveLength(ledger.signals.length);
    expect(droppedOf(checkAnswer(ledger, schemaFor("/ledger")!), "signals")).toBe(0);
  });

  it("the Ledger counts nothing from partial rows: the counts wait, the chip has no number, the page says a row was lost", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: [{ label: "no slug" }, ...ledger.signals.slice(1)] }) });
    renderTab("/desk/signal-ledger");
    await waitFor(() => expect(screen.getByText("1 row could not be read.")).toBeInTheDocument());
    const stat = (label: string) => screen.getAllByText(label).map((e) => e.closest(".dk-stat")).find(Boolean);
    for (const label of ["Firing now", "Reliable", "No edge"]) expect(stat(label)).toHaveTextContent("Awaiting refresh");
    // The served header counts stand (scored_n, unavailable_n).
    expect(stat("Signals scored")).toHaveTextContent("8 scored · 4 not yet served");
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Firing now" }));
    expect(screen.getByText("No readable signal matches this filter.")).toBeInTheDocument();
  });

  it("the Overview never says nothing is firing when active-signal rows were lost, and names lost fires on the line", async () => {
    stubDesk({
      "/api/desk/overview": () => ({
        ...overview,
        since_last_close: { ...overview.since_last_close, still_firing: [{ slug: "x" }] },
        active_signals: [{ label: "no slug" }],
      }),
    });
    renderTab("/desk/overview");
    await waitFor(() => expect(screen.getByText("1 row could not be read.")).toBeInTheDocument());
    expect(screen.queryByText("Nothing is firing, and nothing has fired recently.")).toBeNull();
    expect(screen.getByTestId("ov-since")).toHaveTextContent("1 fire could not be read");
  });

  it("Data Pipeline counts a lost series and never calls a group with one empty", async () => {
    const groups = pipeline.groups.map((g, i) => (i === 1 ? { ...g, series: [{ label: "no id" }] } : g));
    stubDesk({ "/api/desk/pipeline": () => ({ ...pipeline, groups }) });
    renderTab("/desk/data-pipeline?group=credit");
    const inv = await screen.findByRole("region", { name: /Series inventory/ });
    await waitFor(() => expect(inv).toHaveTextContent("1 series could not be read."));
    expect(inv).not.toHaveTextContent("No series in this group yet.");
    // 27 served: the lost series is counted, the four readable Credit rows are not there.
    expect(inv).toHaveTextContent(/23 series · grouped/);
    expect(within(inv).getByRole("button", { name: /^Credit/ })).toHaveTextContent("1 series");
  });

  it("the rail says events were lost rather than 'No events'", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, last_events: [{ regime: "Goldilocks" }] }) });
    renderTab("/desk/event-study");
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("1 event could not be read."));
    expect(rail).not.toHaveTextContent("No events");
  });

  it("a catalog that lost a row gates no slot, says so, and the rows it read still gate their chips (§4)", async () => {
    stubDesk({ "/api/desk/study/catalog": () => catalogWithout("death-cross") });
    renderTab("/desk/event-study");
    await waitFor(() => expect(screen.getByText("1 catalog study could not be read.")).toBeInTheDocument());
    const chips = screen.getByRole("group", { name: "Common questions" });
    expect(within(chips).getByRole("button", { name: "Dollar −2σ, 20 days" })).toBeDisabled();
    expect(within(chips).getByRole("button", { name: "Oil +2σ → gold" })).toBeDisabled();
    expect(chips).toHaveTextContent("Dollar −2σ, 20 days: US Dollar Index (DX-Y.NYB) is not stored in this database");
  });

  it("the slots' hint counts no series from a partial list", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, series: [{ label: "no key" }, ...study.series] }) });
    renderTab("/desk/event-study");
    await waitFor(() => expect(screen.getByText(/every slot lists the same series; 1 series could not be read/)).toBeInTheDocument());
    expect(screen.queryByText(/every slot lists the same 12 series/)).toBeNull();
  });

  it("Data Pipeline's search never says a lost series does not exist", async () => {
    const groups = pipeline.groups.map((g) => (g.name === "Credit" ? { ...g, series: g.series.map((x) => (x.id === "BAMLH0A0HYM2" ? { label: x.label } : x)) } : g));
    stubDesk({ "/api/desk/pipeline": () => ({ ...pipeline, groups }) });
    renderTab("/desk/data-pipeline");
    const input = await screen.findByLabelText("Find a series");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "BAMLH0A0HYM2" } });
    expect(await screen.findByText("No readable series matches “BAMLH0A0HYM2”; 1 series could not be read.")).toBeInTheDocument();
  });

  it("Sectors names no leader or laggard from a partial list", async () => {
    stubDesk({ "/api/desk/sectors": () => ({ ...sectorsFixture, leadership: [{ name: "no etf" }, ...sectorsFixture.leadership.slice(1)] }) });
    renderTab("/desk/sectors");
    const lead = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(lead).toHaveTextContent("1 sector could not be read."));
    expect(lead).toHaveTextContent(/Leading\s*Awaiting refresh/);
    expect(lead).not.toHaveTextContent(/Leading\s*Industrials/);
  });
});

/** The catalog with one row made unreadable (no slug). */
function catalogWithout(slug: string) {
  return { ...catalogFixture, studies: catalogFixture.studies.map((r) => (r.slug === slug ? { label: r.label } : r)) };
}

describe("R-17: a firing status that is not served claims nothing (closed by item 9)", () => {
  it("a study without firing_now prints no firing pill, never 'Not firing today'", async () => {
    stubDesk({ "/api/desk/study": () => without({ ...study, stale: false }, "firing_now", "firing_day") });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("● Live"));
    expect(card).not.toHaveTextContent(/Not firing today|Firing today/);
  });

  it("with stale not served, a firing state is never called firing today (§12.2, v3 §3)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...without(study, "stale"), firing_now: true, firing_day: 2 }) });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("● Live"));
    expect(card).not.toHaveTextContent(/Firing today|Not firing today/);
  });

  it("a Ledger row without firing_now says —, not Quiet", async () => {
    stubDesk({ "/api/desk/ledger": () => ({ ...ledger, signals: ledger.signals.map((r) => (r.slug === "spx-5d-2sigma" ? without(r, "firing_now") : r)) }) });
    renderTab("/desk/signal-ledger");
    const row = await screen.findByRole("row", { name: /S&P 5-day move over 2σ/ });
    await waitFor(() => expect(row.querySelector(".lg-now")).toHaveTextContent("—"));
    expect(row).not.toHaveTextContent("Quiet");
  });
});

describe("R-18: a horizon that is not served is never replaced by another", () => {
  it("with no selected horizon served, the question's horizon is read; the month's row never stands in", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...without(study, "selected_horizon"), question: { ...study.question, horizon: 60 } }) });
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=60");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent(/Up 3 months later\s*61%\s*11 of 18/));
    expect(card).not.toHaveTextContent(/a month later|at a month|12 of 18/);
  });

  it("before an answer the asked horizon names the labels: a question's own, a preset's §12.2 default; the card alone names none", async () => {
    stubDesk({ "/api/desk/study": () => new Promise(() => {}) });
    const a = renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=60");
    expect(await screen.findByRole("region", { name: "The answer" })).toHaveTextContent(/Up 3 months later/);
    a.unmount();
    const b = renderTab("/desk/event-study?preset=gold-2sigma-spx-weak");
    expect(await screen.findByRole("region", { name: "The answer" })).toHaveTextContent(/Up a month later/);
    b.unmount();
    renderWithProviders(<AnswerCard study={undefined} failed={false} onFix={() => {}} />);
    const card = screen.getByRole("region", { name: "The answer" });
    expect(card).toHaveTextContent(/Up later/);
    expect(card).not.toHaveTextContent(/a month/);
  });

});

describe("R-19: a comparison that did not arrive keeps its line and says so (closed by item 1)", () => {
  it("without the without_condition block the line stands with Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": () => without(study, "without_condition") });
    renderTab("/desk/event-study");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card.textContent?.replace(/\s+/g, " ")).toContain("Without the S&P condition: Awaiting refresh"));
  });
});

describe("R-20: tiny distinct weights never alias to zero", () => {
  it("prints a weight at any size in full decimals", () => {
    expect(decimal(1e-21)).toBe("0.000000000000000000001");
    expect(decimal(2.5e-21)).toBe("0.0000000000000000000025");
    expect(decimal(1e-7)).toBe("0.0000001");
    expect(decimal(22.11)).toBe("22.11");
    expect(decimal(1e21)).toBe("1000000000000000000000");
  });

  it("a normalized basket saved in this browser reads back adding to exactly 100% (verifier V14-4)", () => {
    const leg = (weight: string): WorkLeg => ({ symbol: "X", name: null, weight });
    const legs = normalize([leg("0.0000000000000001"), leg("0.0000000000000002"), leg("50")]);
    expect(totalText(legs)).toBe("100");
    const m = new Map<string, string>();
    const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(writeSaved({ id: "local-1", name: "Tiny", legs: savedLegs(legs), saved_at: "2026-09-26T00:00:00Z" }, st)).toBe("ok");
    const back = toWork(readSaved(st)[0].legs);
    expect(totalText(back)).toBe("100");
    expect(back.map((l) => l.weight)).toEqual(legs.map((l) => l.weight));
    // An older save's numbers still read.
    m.set("mrr.desk.baskets.v1", JSON.stringify([{ id: "local-2", name: "Old", legs: [{ symbol: "A", name: null, weight: 60 }, { symbol: "B", name: null, weight: 40 }], saved_at: "x" }]));
    expect(totalText(toWork(readSaved(st)[0].legs))).toBe("100");
  });

  it("Normalize keeps two tiny distinct weights above zero and apart, past twelve decimals and past a total over 100", () => {
    const leg = (weight: string): WorkLeg => ({ symbol: "X", name: null, weight });
    const a = normalize([leg("0.0000000000001"), leg("0.0000000000002"), leg("50")]);
    const [x, y] = a.map((l) => Number(l.weight));
    expect(x).toBeGreaterThan(0);
    expect(y).toBeGreaterThan(x);
    const b = normalize([leg("0.001"), leg("0.002"), leg("100"), leg("100"), leg("100")]);
    const [p, q] = b.map((l) => Number(l.weight));
    expect(p).toBeGreaterThan(0);
    expect(q).toBeGreaterThan(p);
    // Both still add to exactly 100, digit by digit.
    expect(totalText(a)).toBe("100");
    expect(totalText(b)).toBe("100");
  });
});
