/**
 * Event Study (DESK_FRAME3_SPEC §4) against the §12.2 and §12.3 fixtures:
 * the address is the question, the slots show what is asked, the answer and
 * the rail print served fields only, a slot change makes the question your
 * own and Run asks it, saved questions live in this browser with a JSON
 * export and import, fewer than 10 events is one sentence and two fixes, and
 * Advanced opens the events, the resampling detail, the rules and the provenance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import DeskShell from "../DeskShell";
import study from "../../../fixtures/desk/study.json";
import studyEvents from "../../../fixtures/desk/study-events.json";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import { bpEvents, bpStudy } from "../../../test/desk-variants";
import type { Question } from "../data/types";
import { applyFix, provenanceLine } from "./EventStudyPage";
import { barTicks, horizonPhrase } from "./AnswerCard";
import { LAST_STUDY_KEY, SAVED_KEY, WHILES, WINDOWS, apiParams, askFromSearch, atMonth, exportSaved, importSaved, loadSaved, questionFromEngine, questionWords, searchFor, unreadableSaved, withSaved, withdrawnIn, writeSaved } from "./question";

const GOLD: Question = { shock: "gold", window: 20, move: "up2s", while: "spx_below_50", target: "spx", horizon: 20 };

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderTab(route = "/desk/event-study", client?: QueryClient) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route, client },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.removeItem(SAVED_KEY);
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the question", () => {
  it("reads a preset or six slots from the address, and writes them back", () => {
    expect(askFromSearch("")).toEqual({ preset: "gold-2sigma-spx-weak" });
    // §12.2 has no `confidence` parameter: an old address's is ignored and never written back.
    expect(askFromSearch("preset=golden-cross&confidence=0.8")).toEqual({ preset: "golden-cross" });
    expect(askFromSearch("shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20")).toEqual({ question: GOLD });
    expect(askFromSearch("shock=gold&window=7&move=up2s&while=none&target=spx&horizon=20")).toEqual({ preset: "gold-2sigma-spx-weak" });
    expect(searchFor({ question: GOLD }, new URLSearchParams("view=client&x=1&confidence=0.95"))).toBe("view=client&shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20");
  });
  it("asks only what §12.2 serves: windows 5, 20, 60 (none for a cross), no S&P-above condition", () => {
    expect(WINDOWS).toEqual([5, 20, 60]);
    expect(WHILES.map((w) => w.id)).not.toContain("spx_above_50");
    expect(askFromSearch("shock=spx&move=cross_above&while=none&target=spx&horizon=20")).toEqual({ question: { shock: "spx", window: null, move: "cross_above", while: "none", target: "spx", horizon: 20 } });
    expect(searchFor({ question: { shock: "spx", window: null, move: "cross_below", while: "none", target: "spx", horizon: 20 } })).toBe("shock=spx&move=cross_below&while=none&target=spx&horizon=20");
    // A withdrawn value opens the default question instead of an unanswerable one.
    expect(askFromSearch("shock=gold&window=10&move=up2s&while=none&target=spx&horizon=20")).toEqual({ preset: "gold-2sigma-spx-weak" });
    expect(askFromSearch("shock=gold&window=20&move=up2s&while=spx_above_50&target=spx&horizon=20")).toEqual({ preset: "gold-2sigma-spx-weak" });
    expect(questionWords({ shock: "spx", window: null, move: "cross_above", while: "none", target: "spx", horizon: 20 }, (k) => k)).toBe("spx crosses above MA → spx over the next 1 month");
  });
  it("opens an old frame-2 link (?study=<engine slug>) as the same six slots", () => {
    expect(askFromSearch("study=gold-2sigma-spx-weak")).toEqual({ question: GOLD });
    // A cross has no window (§12.2).
    expect(askFromSearch("study=spx-golden-cross")).toEqual({ question: { shock: "spx", window: null, move: "cross_above", while: "none", target: "spx", horizon: 20 } });
    expect(askFromSearch("preset=rsi-below-30")).toEqual({ preset: "rsi-below-30" });
  });

  it("an engine link at another z or for one regime is not read as the 2σ, all-regime question", () => {
    expect(questionFromEngine("gold-w20-z2.0-up-spx_below_50dma-spx-goldilocks")).toBeNull();
    expect(questionFromEngine("gold-w5-z2.5-down-none-us10y")).toBeNull();
    expect(askFromSearch("study=gold-w5-z2.5-down-none-us10y")).toEqual({ preset: "gold-2sigma-spx-weak" });
  });

  it("saves, exports and imports questions without duplicates or malformed entries", () => {
    const now = new Date("2026-09-24T00:00:00Z");
    const one = withSaved([], GOLD, "Gold", now);
    expect(withSaved(one, GOLD, "again", now)).toHaveLength(1);
    const text = exportSaved(one);
    expect(importSaved([], text).added).toBe(1);
    expect(importSaved(one, text).added).toBe(0);
    expect(importSaved([], "not json")).toMatchObject({ added: 0, rejected: 1 });
    expect(importSaved([], JSON.stringify({ questions: [{ id: "x", name: "bad", saved_at: "", question: { shock: "gold" } }] }))).toMatchObject({ added: 0, rejected: 1 });
  });
  it("spells the served numbers", () => {
    expect(horizonPhrase(20)).toBe("a month");
    expect(horizonPhrase(60)).toBe("3 months");
    expect(barTicks(-0.5, 6.2)).toEqual([-3, 0, 5]);
    expect(barTicks(-0.5, 6.2, "log_change")).toEqual([-3, 0, 5]);
    // Basis points step by 1, 2 or 5 × 10ⁿ, never by a percent's 5 (Codex G2-5).
    expect(barTicks(-13, 57, "bp")).toEqual([-30, 0, 50]);
    expect(barTicks(-80, 57, "bp")).toEqual([-100, 0, 50]);
    expect(barTicks(-2, 14, "bp")).toEqual([-6, 0, 10]);
    expect(barTicks(-0.5, 2.4, "bp")).toEqual([-1.2, 0, 2]);
    expect(applyFix(GOLD, "drop_condition")?.while).toBe("none");
    expect(applyFix(GOLD, "widen_window")?.window).toBe(60);
    expect(applyFix({ ...GOLD, window: 60 }, "widen_window")).toBeNull();
    expect(applyFix({ ...GOLD, while: "none" }, "drop_condition")).toBeNull();
    // §4's line over the served provenance: the entry rule is the engine's own sentence (§12.2 provenance.entry_rule).
    expect(provenanceLine(study as never, (k) => (k === "gold" ? "Gold" : k))).toBe(
      `Engine as of Sep 24 · Monte Carlo 10,000 · entry ${study.provenance.entry_rule} · cooldown 20 · Gold history from 2000 · verdict rule v1 at 90% · slug gold-2sigma-spx-weak`,
    );
    // A cross has no cooldown (§4.1): the line says none.
    expect(provenanceLine({ ...study, provenance: { ...study.provenance, cooldown: null } } as never, (k) => k)).toContain("· cooldown none ·");
    // Without the served rule or its level, the line says nothing about them.
    expect(provenanceLine({ ...study, verdict_rule: undefined } as never, (k) => k)).not.toContain("verdict rule");
  });
});

describe("Event Study tab", () => {
  it("answers the gold preset: headline, pills, stats, chart, the line without the condition", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    // The served headline: the verdict's label at the selected horizon and its §1.5 definition (§12.2).
    await waitFor(() => expect(card).toHaveTextContent("Suggestive at 1 month: 10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all Reliable criteria are met."));
    // The S&P's 50-day condition is unevaluable since Sep 22 (the audit's §2.1), so the state is stale at Sep 21 (§4).
    expect(card).toHaveTextContent("○ Stale · Sep 21, 2026");
    expect(card).not.toHaveTextContent("Firing today");
    expect(card).toHaveTextContent("● Live");
    expect(card).not.toHaveTextContent(/cached|\d ms|\ds\b/);
    // EVENTS is the study's size, with the selected horizon's completed count beneath it (C-03).
    expect(card).toHaveTextContent(/Events\s*18\s*18 complete at 1 month/);
    expect(card).toHaveTextContent(/Up a month later\s*67%\s*12 of 18/);
    expect(card).toHaveTextContent(/Median at a month\s*\+3\.1%\s*vs \+1\.3% in a normal month/);
    // The engine's real extremes at a month (the audit's §2.3): Aug 30, 2011 and Apr 16, 2025.
    expect(card).toHaveTextContent("−4.9% / +12.0%");
    expect(card).toHaveTextContent("Aug 2011 · Apr 2025");
    expect(within(card).getByRole("img", { name: /median move after the event/ })).toBeInTheDocument();
    // §4, C-01: the line without the condition is unavailable; it keeps its lead and prints the served reason.
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Without the S&P condition: conditional-versus-unconditional comparison is not defined");
  });

  it("the rail: verdict, by regime under ten events as too few, today's regime note, last five, ranges at the served confidence", async () => {
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict · Suggestive"));
    // §4: the box is the label, the served headline and why; nothing else (no advice drawn from a verdict).
    expect([...rail.querySelectorAll(".es-verdict > p")].map((p) => p.textContent?.replace(/\s+/g, " ").trim()).join(" ")).toBe(
      "Verdict · Suggestive Suggestive at 1 month: 10+ completed outcomes; excess medians lean the same way at 5, 10 and 20 sessions, but not all Reliable criteria are met. 18 completed outcomes in 18 overlap blocks; the 90% interval on the excess median runs −1.6% to +4.1%; 14.6% of resampled medians are adverse against a 3% bar.",
    );
    // Rule v1 reads the lean at 5, 10 and 20 sessions whatever the horizon, so 3 months is Suggestive too.
    expect(rail).toHaveTextContent(/3 months\s*−4\.2 to \+6\.3 pts\s*Suggestive/);
    // §14.3: no control does nothing: Price it (Basket & Hedge prices nothing yet) is not drawn.
    expect(within(rail).queryByRole("button", { name: /Price it/ })).toBeNull();
    expect(within(rail).queryByRole("link", { name: /Price it/ })).toBeNull();
    const rows = within(rail).getAllByRole("row");
    // By regime from the events at their K−2 rows of the regime record (Codex R-05).
    // §4: a regime under ten events (MIN_REGIME_N) prints its count and "too few cases to say" across Up and Median.
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(["Goldilocks2too few cases to say", "Overheating6too few cases to say", "Stagflation9too few cases to say", "Recession Risk1too few cases to say"]));
    expect(within(rows.find((r) => r.textContent?.startsWith("Goldilocks"))!).getByText("too few cases to say")).toHaveAttribute("colspan", "2");
    expect(rail).not.toHaveTextContent("Unlabeled");
    expect(rail).toHaveTextContent("Mar 23, 2023Stagflation+4.1%");
    // Today's regime is the K−2 row, Goldilocks (the audit's §2.2).
    expect(rail).toHaveTextContent("Today is Goldilocks: two events, too few to read alone.");
    expect(rail).toHaveTextContent("Apr 16, 2025Overheating+12.0%");
    expect(rail).toHaveTextContent("−1.6 to +4.1 pts");
    // §14.3: the engine's one level, in words; no chip for another.
    expect(within(rail).getByTestId("es-conf")).toHaveTextContent("90% interval");
    expect(within(rail).queryByRole("group", { name: "Confidence" })).toBeNull();
    expect(rail).not.toHaveTextContent("All four include zero");
  });

  it("the slots show the served question; a changed slot is your own and Run writes the address", async () => {
    renderTab();
    const shock = await screen.findByLabelText("Shock");
    await waitFor(() => expect(shock).toHaveValue("gold"));
    expect(screen.getByLabelText("While")).toHaveValue("spx_below_50");
    expect(screen.getByRole("button", { name: "Gold +2σ while S&P weak" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Over the next"), { target: { value: "60" } });
    expect(screen.getByRole("button", { name: "Build your own" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("es-run"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=60"));
  });

  it("there is no confidence control and nothing asks with a confidence (§14.3, §12.2)", async () => {
    const { calls } = stubDesk();
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    expect(within(rail).queryAllByRole("button", { name: /^(80|90|95)%$/ })).toHaveLength(0);
    expect(rail).not.toHaveTextContent("not yet served");
    expect(calls.some((c) => c.includes("confidence"))).toBe(false);
  });

  it("Save keeps the question in this browser and lists it under My saved questions", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    fireEvent.click(screen.getByTestId("es-save"));
    expect(screen.getByRole("button", { name: "My saved questions · 1" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")).toHaveLength(1);
    // The words use /study series[]'s labels, the engine registry's (§12.2).
    expect(within(screen.getByRole("group", { name: "My saved questions" })).getByRole("button", { name: /Gold \(COMEX front month\) up 2σ or more over 20 days/ })).toBeInTheDocument();
  });

  it("fewer than 10 events: one sentence and two fixes, no chart", async () => {
    const sentence = "Only 6 events complete at 1 month since 2001, fewer than the ten a verdict other than Too few needs.";
    stubDesk({ "/api/desk/study": () => ({ ...study, matched_n: 6, verdict: "insufficient", horizons: [], empty_state: { horizon: 20, sentence, fixes: ["widen_window", "drop_condition"] } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent(sentence));
    expect(within(card).queryByRole("img")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Drop the condition" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("while=none"));
  });

  it("an edited slot stays until run; clicking the pressed preset puts the served question back", async () => {
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.change(screen.getByLabelText("Over the next"), { target: { value: "60" } });
    expect(screen.getByLabelText("Over the next")).toHaveValue("60");
    fireEvent.click(screen.getByRole("button", { name: "Common questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Gold +2σ while S&P weak" }));
    expect(screen.getByLabelText("Over the next")).toHaveValue("20");
    expect(screen.getByRole("button", { name: "Gold +2σ while S&P weak" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switching to a preset whose answer is cached fills the slots from it (R2-1)", async () => {
    // The app's own cache times: the preset's answer is still held when it is clicked again.
    renderTab("/desk/event-study", new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 300_000 } } }));
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: /Gold \(COMEX front month\) up 2σ or more over 20 days/ }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("shock=gold"));
    fireEvent.click(screen.getByRole("button", { name: "Common questions" }));
    fireEvent.click(screen.getByRole("button", { name: "Gold +2σ while S&P weak" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("preset=gold-2sigma-spx-weak"));
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    expect(screen.getByLabelText("Over the next")).toHaveValue("20");
    expect(screen.getByRole("button", { name: "Run" })).toBeEnabled();
  });

  it("an engine link the slots cannot ask says so over the default question", async () => {
    renderTab("/desk/event-study?study=gold-w5-z2.5-down-none-us10y");
    expect(await screen.findByText(/which the six slots cannot ask; this is the default question instead/)).toBeInTheDocument();
  });

  it("keeps the last study it answered for Data Pipeline's export, never one that failed", async () => {
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak");
    await waitFor(() => expect(localStorage.getItem(LAST_STUDY_KEY)).toBe("preset=gold-2sigma-spx-weak"));
    localStorage.removeItem(LAST_STUDY_KEY);
  });
  it("a question that fails is not kept as the last study", async () => {
    localStorage.removeItem(LAST_STUDY_KEY);
    stubDesk({ "/api/desk/study": deskError(503, "warming") });
    renderTab("/desk/event-study?preset=spx-golden-cross");
    await waitFor(() => expect(screen.getAllByText(/Awaiting refresh/).length).toBeGreaterThan(0));
    expect(localStorage.getItem(LAST_STUDY_KEY)).toBeNull();
  });
  it("without the served series list the two series slots are held and say so", async () => {
    const { series: _s, ...rest } = study;
    void _s;
    stubDesk({ "/api/desk/study": () => rest });
    renderTab();
    await waitFor(() => expect(screen.getByText(/the series list is awaiting refresh/)).toBeInTheDocument());
    expect(screen.getByLabelText("Shock")).toBeDisabled();
    expect(screen.getByLabelText("What happens to")).toBeDisabled();
  });

  it("a failed /study keeps the stat labels and says Couldn't load · Retry, once per card (§14.12)", async () => {
    let calls = 0;
    stubDesk({ "/api/desk/study": () => (++calls <= 2 ? { status: 503, body: { error: "warming" } } : study) });
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("Couldn't load · Retry"));
    expect(card).toHaveTextContent("Events");
    expect(card).toHaveTextContent("Up a month later");
    expect(card).not.toHaveTextContent("18");
    expect(card).not.toHaveTextContent("Awaiting refresh");
    const rail = screen.getByRole("complementary", { name: "Verdict and detail" });
    expect(within(rail).getAllByTestId("dk-failed")).toHaveLength(1);
    expect(rail).toHaveTextContent(/Verdict\s*—/);
    expect(rail).not.toHaveTextContent("Awaiting refresh");
    // Retry asks again; the answer replaces the line.
    fireEvent.click(within(card).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "The answer" })).toHaveTextContent("18"));
    expect(screen.queryAllByTestId("dk-failed")).toHaveLength(0);
  });

  it("Advanced opens the events, the resampling detail, the rules and the provenance; the frame-2 panel is retired (§4)", async () => {
    const { calls } = stubDesk();
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.click(within(rail).getByTestId("dk-advanced"));
    const adv = await screen.findByRole("region", { name: "Advanced" });
    await waitFor(() => expect(within(adv).getAllByRole("row").length).toBeGreaterThan(18));
    expect(adv).toHaveTextContent("Sep 19, 2001");
    expect(adv).toHaveTextContent("A new event needs 20 sessions after the last one.");
    expect(adv).toHaveTextContent(`Entry is ${study.provenance.entry_rule}.`);
    expect(adv).toHaveTextContent(/includes zero|clears zero/);
    expect(adv.textContent).not.toMatch(/established|significant|frame-2|as the engine scores it/i);
    // §4 (v2 §8): nothing asks the frame-2 engine routes any more.
    expect(calls.some((c) => /\/api\/desk\/event-study/.test(c))).toBe(false);
  });

  it("Advanced says how many events could not be read, under the study's own count (Codex R-16)", async () => {
    stubDesk({ "/api/desk/study/events": () => ({ ...studyEvents, events: [{ regime: "Goldilocks" }, ...studyEvents.events.slice(1)] }) });
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.click(within(rail).getByTestId("dk-advanced"));
    const adv = await screen.findByRole("region", { name: "Advanced" });
    await waitFor(() => expect(adv).toHaveTextContent("1 event could not be read."));
    expect(adv).toHaveTextContent("All 18 events");
    expect(within(adv).getAllByRole("row")).toHaveLength(18);
  });
});

describe("a study with a block missing (Codex R-10)", () => {
  const without = (key: string) => () => {
    const copy: Record<string, unknown> = { ...study };
    delete copy[key];
    return copy;
  };
  const rail = () => screen.getByRole("complementary", { name: "Verdict and detail" });
  const answer = () => screen.getByRole("region", { name: "The answer" });

  it("without horizons: the stats and the chart say Awaiting refresh, the rest stands", async () => {
    stubDesk({ "/api/desk/study": without("horizons") });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("Awaiting refresh · the study's horizons"));
    expect(answer()).toHaveTextContent(/Events\s*18\s*count awaiting refresh/);
    expect(answer()).toHaveTextContent(/Up a month later\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/);
    expect(rail()).toHaveTextContent(/Range vs normal\s*90% interval\s*Awaiting refresh/);
    expect(rail()).toHaveTextContent(/By regime · a month later.*Goldilocks/);
  });

  it("without provenance: the line under the grid keeps what was served, the entry rules say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": without("provenance") });
    renderTab();
    await waitFor(() => expect(screen.getByText(/^Engine as of Sep 24 · Monte Carlo 10,000 · verdict rule v1 at 90% · slug gold-2sigma-spx-weak$/)).toBeInTheDocument());
    fireEvent.click(within(rail()).getByTestId("dk-advanced"));
    await waitFor(() => expect(document.body).toHaveTextContent(/Entry rules\s*Awaiting refresh · the study's entry rules/));
    expect(answer()).toHaveTextContent(/Up a month later\s*67%/);
  });

  it("without by_regime: that block says Awaiting refresh; the answer and the other blocks stand", async () => {
    stubDesk({ "/api/desk/study": without("by_regime") });
    renderTab();
    await waitFor(() => expect(rail()).toHaveTextContent(/By regime · a month later\s*Awaiting refresh/));
    expect(rail()).not.toHaveTextContent("Today is");
    expect(rail()).toHaveTextContent(/Last five events.*Apr 16, 2025/);
    expect(answer()).toHaveTextContent(/Median at a month\s*\+3\.1%/);
  });

  it("without last_events: that block says Awaiting refresh; the rest stands", async () => {
    stubDesk({ "/api/desk/study": without("last_events") });
    renderTab();
    await waitFor(() => expect(rail()).toHaveTextContent(/Last five events · S&P 500 a month later\s*Awaiting refresh/));
    expect(rail()).toHaveTextContent(/By regime · a month later.*Goldilocks/);
    expect(answer()).toHaveTextContent(/Up a month later\s*67%/);
  });

  it("a statistic served null keeps its label and says Awaiting refresh (Codex R-01)", async () => {
    const horizons = study.horizons.map((h) => (h.h === 20 ? { ...h, up_pct: null, median: null, worst: null } : h));
    stubDesk({ "/api/desk/study": () => ({ ...study, matched_n: null, horizons }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Events\s*Awaiting refresh/));
    expect(answer()).toHaveTextContent(/Up a month later\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Worst · best\s*Awaiting refresh/);
    expect(answer()).not.toHaveTextContent("0.0%");
    expect(screen.getByRole("img", { name: /1 month awaiting refresh/ })).toBeInTheDocument();
  });

  it("a study answered null could not be loaded, and is not loading (Codex R-09, §14.12)", async () => {
    stubDesk({ "/api/desk/study": () => null });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("Couldn't load · Retry"));
    expect(answer()).toHaveTextContent(/Events\s*—/);
    expect(answer()).not.toHaveAttribute("aria-busy", "true");
  });
});

describe("the study's firing pill (§4, v3 §3)", () => {
  const pill = () => screen.getByRole("region", { name: "The answer" }).querySelector(".es-pills")!;
  it("firing today counts its day; stale is never firing today; an unknown state prints no pill", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, firing_now: true, firing_day: 3, stale: false, evaluated_on: "2026-09-23" }) });
    const a = renderTab();
    await waitFor(() => expect(pill()).toHaveTextContent("● Firing today · day 3"));
    a.unmount();
    stubDesk({ "/api/desk/study": () => ({ ...study, firing_now: true, firing_day: 3, stale: true, evaluated_on: "2026-09-19" }) });
    const b = renderTab();
    await waitFor(() => expect(pill()).toHaveTextContent("○ Stale · Sep 19, 2026"));
    expect(pill()).not.toHaveTextContent("Firing today");
    b.unmount();
    stubDesk({ "/api/desk/study": () => ({ ...study, firing_now: null }) });
    const c = renderTab();
    await waitFor(() => expect(pill()).toHaveTextContent("● Live"));
    expect(pill()).not.toHaveTextContent(/firing/i);
    c.unmount();
    // A state that cannot be evaluated is served stale with no session: still no pill, never "Stale · —" (§4).
    stubDesk({ "/api/desk/study": () => ({ ...study, firing_now: null, firing_day: null, evaluated_on: null, stale: true }) });
    renderTab();
    await waitFor(() => expect(pill()).toHaveTextContent("● Live"));
    expect(pill()).not.toHaveTextContent(/stale|firing/i);
  });
});

describe("the catalog drives the chips and the slots (§4, §12.3)", () => {
  it("each chip is its catalog label; a study not stored is not shown, and one line says why (§14.3)", async () => {
    renderTab();
    const chips = await screen.findByRole("group", { name: "Common questions" });
    await waitFor(() => expect(within(chips).getByRole("button", { name: "S&P golden cross" })).toBeInTheDocument());
    expect(within(chips).queryByRole("button", { name: "Dollar −2σ, 20 days" })).toBeNull();
    expect(within(chips).queryByRole("button", { name: "Oil +2σ → gold" })).toBeNull();
    expect(within(chips).getByRole("button", { name: "HY spreads +2σ, 20 days" })).toBeEnabled();
    expect(within(chips).getAllByRole("button").every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
    expect(chips).toHaveTextContent("Not shown: Dollar −2σ, 20 days (US Dollar Index (DX-Y.NYB) is not stored in this database");
    expect(chips).toHaveTextContent("Oil +2σ → gold (WTI crude (DCOILWTICO) is not stored in this database");
  });

  it("every slot option is enabled; shock and target list the series of their role that the store holds (§14.3)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    const all = (label: string) => [...(screen.getByLabelText(label) as HTMLSelectElement).options];
    for (const l of ["Shock", "Window", "Move", "While", "What happens to", "Over the next"]) expect(all(l).every((o) => !o.disabled), l).toBe(true);
    // The fixture store's series with a role, the sector ETFs included (shocks and conditions only).
    expect(all("Shock").map((o) => o.value)).toEqual(["spx", "gold", "us10y", "us2y", "curve_2s10s", "vix", "hy_oas", "rut", "xlb", "xle", "xlf", "xli", "xlk", "xlp", "xlu", "xlv", "xly"]);
    expect(all("What happens to").map((o) => o.value)).toEqual(["spx", "gold", "us10y", "vix", "hy_oas"]);
    expect(all("Window").map((o) => o.value)).toEqual(["5", "20", "60", "none"]);
  });

  it("a slot change that the engine cannot ask moves the other slots and says so (§14.3)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    fireEvent.change(screen.getByLabelText("Move"), { target: { value: "cross_above" } });
    expect(screen.getByLabelText("Shock")).toHaveValue("spx");
    expect(screen.getByLabelText("What happens to")).toHaveValue("spx");
    expect(screen.getByLabelText("While")).toHaveValue("none");
    expect(screen.getByLabelText("Window")).toHaveValue("none");
    expect(screen.getByText(/A cross is the S&P 500's own averages/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Window"), { target: { value: "60" } });
    expect(screen.getByLabelText("Move")).toHaveValue("up2s");
    expect(screen.getByLabelText("Window")).toHaveValue("60");
    fireEvent.click(screen.getByTestId("es-run"));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toBe("/desk/event-study?shock=spx&window=60&move=up2s&while=none&target=spx&horizon=20"));
  });

  it("a question outside the catalog is answered like any study (§14.3)", async () => {
    renderTab("/desk/event-study?shock=gold&window=60&move=up2s&while=none&target=spx&horizon=20");
    const card = () => screen.getByRole("region", { name: "The answer" });
    await waitFor(() => expect(card()).toHaveTextContent("Suggestive at 1 month"));
    expect(card()).toHaveTextContent(/Events\s*23/);
    expect(screen.getByText(/slug gold-w60-z2\.0-up-none-spx/)).toBeInTheDocument();
  });

  it("before anything is asked the window slot is blank, never 'none (a cross)'", async () => {
    stubDesk({ "/api/desk/study": () => new Promise(() => {}), "/api/desk/study/catalog": () => new Promise(() => {}) });
    renderTab("/desk/event-study?preset=hy-2sigma-20d");
    const w = (await screen.findByLabelText("Window")) as HTMLSelectElement;
    expect(w.value).toBe("");
    expect(w.selectedOptions[0]?.textContent).toBe("");
  });

  it("a preset with no answer still spells out its question from the catalog (the dollar, served awaiting)", async () => {
    stubDesk({ "/api/desk/study": deskAwaiting("US Dollar Index (DX-Y.NYB) is not stored in this database: it is a tier 2 series, and the full refresh stores tier 1 only.") });
    renderTab("/desk/event-study?preset=dollar-2sigma-20d");
    await waitFor(() => expect(screen.getByLabelText("Window")).toHaveValue("20"));
    expect(screen.getByLabelText("Move")).toHaveValue("down2s");
    expect(screen.getByLabelText("While")).toHaveValue("none");
  });

  it("an address asking what §12.2 no longer serves opens the default question and says so (§12.0: never a silent drop)", async () => {
    expect(withdrawnIn("shock=gold&window=10&move=up2s&while=spx_above_50&target=spx&horizon=20")).toBe("a 10-day window and the S&P above its 50-day");
    expect(withdrawnIn("preset=gold-2sigma-spx-weak")).toBeNull();
    renderTab("/desk/event-study?shock=gold&window=10&move=up2s&while=none&target=spx&horizon=20");
    expect(await screen.findByText("The link asked for a 10-day window, which the Event Study no longer asks; this is the default question instead.")).toBeInTheDocument();
  });

  it("saved questions are never dropped: an old cross reads with no window; a withdrawn one is kept, counted and written back (§1.8)", async () => {
    const cross = { id: "a", name: "golden", saved_at: "2026-09-01", question: { shock: "spx", window: 20, move: "cross_above", while: "none", target: "spx", horizon: 20 } };
    const ten = { id: "b", name: "ten", saved_at: "2026-09-01", question: { shock: "gold", window: 10, move: "up2s", while: "none", target: "spx", horizon: 20 } };
    localStorage.setItem(SAVED_KEY, JSON.stringify([cross, ten]));
    expect(loadSaved().map((x) => [x.id, x.question.window])).toEqual([["a", null]]);
    expect(unreadableSaved()).toEqual([ten]);
    writeSaved(loadSaved());
    expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]").map((x: { id: string }) => x.id)).toEqual(["a", "b"]);
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /My saved questions · 1/ }));
    expect(screen.getByRole("group", { name: "My saved questions" })).toHaveTextContent("1 saved question asks what the Event Study no longer asks");
    // An import reads an old export's cross the same way.
    expect(importSaved([], JSON.stringify({ questions: [cross, ten] }))).toMatchObject({ added: 1, rejected: 1 });
  });

  it("only a 422 `unsupported` is a refusal; any other failure could not be loaded (§14.12)", async () => {
    stubDesk({ "/api/desk/study": deskError(422, "validation", { message: "Unprocessable Entity" }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: "The answer" })).toHaveTextContent("Couldn't load"));
    expect(screen.getByRole("region", { name: "The answer" })).not.toHaveTextContent("Unprocessable Entity");
    expect(screen.getByRole("region", { name: "The answer" })).not.toHaveTextContent("Awaiting refresh");
  });

  it("a question the server refuses prints the served message (§4: 422 unsupported)", async () => {
    stubDesk({ "/api/desk/study": deskError(422, "unsupported", { message: "No study in the catalog asks this question." }) });
    renderTab("/desk/event-study?shock=gold&window=60&move=up2s&while=none&target=spx&horizon=20");
    await waitFor(() => expect(screen.getByRole("region", { name: "The answer" })).toHaveTextContent("No study in the catalog asks this question."));
    expect(screen.getByRole("region", { name: "The answer" })).not.toHaveTextContent("Awaiting refresh");
  });
});

describe("the study's served contract (Codex round 1, group 2)", () => {
  const rail = () => screen.getByRole("complementary", { name: "Verdict and detail" });
  const answer = () => screen.getByRole("region", { name: "The answer" });

  it("a basis-point target prints every move in bp, never a percent (R-02)", async () => {
    stubDesk({ "/api/desk/study": bpStudy });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Median at a month\s*\+25 bp\s*vs \+5 bp in a normal month/));
    expect(answer()).toHaveTextContent(/Worst · best\s*−30 bp \/ \+60 bp\s*Aug 2011 · Apr 2025/);
    const chart = screen.getByRole("img", { name: /1 month \+25 bp against \+5 bp/ });
    expect(chart).toHaveTextContent("bp");
    expect(chart.textContent).not.toMatch(/%/);
    expect(rail()).toHaveTextContent(/Goldilocks\s*10\s*60%\s*\+12 bp/);
    expect(rail()).toHaveTextContent(/Recession Risk\s*2\s*too few cases to say/);
    expect(rail()).toHaveTextContent("Last five events · 10Y Treasury a month later");
    expect(rail()).toHaveTextContent(/Apr 16, 2025\s*Overheating\s*\+30 bp/);
    expect(rail()).toHaveTextContent(/1 month\s*−10 to \+40 bp/);
    // The served why is in the study's own unit too.
    expect(rail().querySelector(".es-verdict")?.textContent).toContain("runs −10 to +40 bp");
    expect(rail().querySelector(".es-verdict")?.textContent).not.toContain("pts");
    // No target move prints as a percent (shares like 67% are not moves).
    expect(answer()).not.toHaveTextContent(/[+−]\d+(\.\d)?%/);
    // §1.9: the tooltip belongs to log numbers only.
    expect(document.querySelector('[title="log return, ×100"]')).toBeNull();
  });

  it("a log-return target prints 100 × native with the §1.9 tooltip on every such number; the whisker is baseline + ci, scaled", async () => {
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Median at a month\s*\+3\.1%\s*vs \+1\.3% in a normal month/));
    const tipped = (root: HTMLElement) => Array.from(root.querySelectorAll('[title="log return, ×100"]')).map((e) => e.textContent);
    expect(tipped(answer())).toEqual(expect.arrayContaining(["+3.1%", "+1.3%", "−4.9%", "+12.0%"]));
    expect(tipped(rail())).toEqual(expect.arrayContaining(["−1.6 to +4.1 pts", study.why]));
    const chart = screen.getByRole("img", { name: /\(log returns, ×100\): .*1 month \+3\.1% against \+1\.3%/ });
    // The chart's value labels and ticks carry the tooltip as an SVG title.
    expect(Array.from(chart.querySelectorAll("title")).map((t) => t.textContent)).toContain("log return, ×100");
    // The axis's zero is not a log number.
    const zero = Array.from(chart.querySelectorAll("text.dk-chart-axis")).find((t) => t.textContent === "0")!;
    expect(zero.querySelector("title")).toBeNull();
    // The 1-month whisker runs from 0.013 − 0.016 to 0.013 + 0.041, ×100: −0.3 to +5.4, so the top tick is +5%.
    expect(chart).toHaveTextContent("+5%");
  });

  it("a study served without its target's unit prints no move and says so (R-02)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, question: { ...study.question, target_unit: undefined } }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/));
    expect(answer()).toHaveTextContent("Awaiting refresh · the unit of the study's target");
    expect(answer()).toHaveTextContent(/Up a month later\s*67%/);
    expect(rail()).toHaveTextContent(/1 month\s*Awaiting refresh/);
  });

  it("the horizon's own count is the denominator; the study-wide count is only EVENTS (R-07, C-03)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, horizons: study.horizons.map((h) => (h.h === 20 ? { ...h, n: 17 } : h)) }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Up a month later\s*67%\s*12 of 17/));
    expect(answer()).toHaveTextContent(/Events\s*18\s*17 complete at 1 month/);
  });

  it("everything in the answer is the selected horizon's: its counts, share, median and extrema (v4 B-01)", async () => {
    const at5 = { ...study, selected_horizon: 5, question: { ...study.question, horizon: 5 }, headline: "Suggestive at 1 week: served." };
    stubDesk({ "/api/desk/study": () => ({ ...at5, horizons: at5.horizons.map((h) => (h.h === 5 ? { ...h, n: 16, up_n: 10, up_pct: 10 / 16 } : h)) }) });
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=5");
    await waitFor(() => expect(answer()).toHaveTextContent("Suggestive at 1 week: served."));
    expect(answer()).toHaveTextContent(/Events\s*18\s*16 complete at 1 week/);
    expect(answer()).toHaveTextContent(/Up a week later\s*63%\s*10 of 16/);
    expect(answer()).toHaveTextContent(/Median at a week\s*\+1\.6%\s*vs \+0\.3% in a normal week/);
    expect(answer()).toHaveTextContent(/Worst · best\s*−6\.7% \/ \+4\.5%\s*Aug 2011 · Apr 2025/);
  });

  it("no other horizon stands in when the selected one was not served", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, selected_horizon: 5, question: { ...study.question, horizon: 5 }, horizons: study.horizons.filter((h) => h.h !== 5) }) });
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=5");
    await waitFor(() => expect(answer()).toHaveTextContent(/Up a week later\s*Awaiting refresh/));
    expect(answer()).toHaveTextContent(/Events\s*18\s*count awaiting refresh/);
    expect(answer()).not.toHaveTextContent("12 of 18");
  });

  it("the selected horizon under ten completed outcomes is Too few: the served sentence and fixes, no chart; the rail still reads the study (§1.7, B-02)", async () => {
    const sentence = "Only 8 events complete at 3 months since 2001, fewer than the ten a verdict other than Too few needs.";
    stubDesk({
      "/api/desk/study": () => ({
        ...study,
        selected_horizon: 60,
        question: { ...study.question, horizon: 60 },
        verdict: "insufficient",
        horizons: study.horizons.map((h) => (h.h === 60 ? { ...h, n: 8, up_n: 5, verdict: "insufficient" } : h)),
        empty_state: { horizon: 60, sentence, fixes: ["drop_condition"] },
      }),
    });
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=60");
    await waitFor(() => expect(answer()).toHaveTextContent(sentence));
    expect(within(answer()).queryByRole("img")).toBeNull();
    expect(within(answer()).getByRole("button", { name: "Drop the condition" })).toBeInTheDocument();
    expect(rail()).toHaveTextContent(/By regime · a month later/);
    expect(rail()).not.toHaveTextContent("Not scored");
  });

  it("without a served sentence, the empty state is §12.2's template on the horizon's own count, and no fix is invented", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, selected_horizon: 60, question: { ...study.question, horizon: 60 }, horizons: study.horizons.map((h) => (h.h === 60 ? { ...h, n: 8 } : h)), empty_state: null }) });
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=60");
    await waitFor(() => expect(answer()).toHaveTextContent("Only 8 events complete at 3 months since 2001, fewer than the ten a verdict other than Too few needs."));
    expect(within(answer()).queryAllByRole("button")).toHaveLength(0);
    expect(answer()).not.toHaveTextContent("no condition to drop");
  });

  it("an interval served null under five blocks prints its served reason in words, not Awaiting refresh; an empty event list says No events", async () => {
    stubDesk({
      "/api/desk/study": () => ({
        ...study,
        last_events: [],
        horizons: study.horizons.map((h) => (h.h === 60 ? { ...h, ci_lo: null, ci_hi: null, reason: "fewer than five independent blocks" } : h)),
      }),
    });
    renderTab();
    await waitFor(() => expect(rail()).toHaveTextContent(/3 months\s*fewer than five independent blocks/));
    expect(within(rail()).getByText("fewer than five independent blocks")).toHaveClass("es-range-why");
    expect(rail()).toHaveTextContent(/Last five events · S&P 500 a month later\s*No events/);
  });

  it("the builder offers every series the store holds with a role, in the slot its role allows, and the hint counts them (desk/usability §14.3; supersedes desk/fill-etf's Codex R-03, R-04 by the owner's rebase ruling)", async () => {
    // The builder computes any question on request, so its served list wins over a catalog-only filter: a stored
    // sector ETF is a shock (and a condition), never a target, and the hint counts each slot's own choices.
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("at 1 month"));
    const values = (slot: string) => [...(screen.getByLabelText(slot) as HTMLSelectElement).options].map((o) => o.value).filter(Boolean);
    expect(values("Shock")).toContain("xlk");
    expect(values("What happens to")).not.toContain("xlk");
    expect(document.body).toHaveTextContent("17 series can be a shock, 5 a target, each one this store holds");
    // Nothing the store lacks is offered: the Dollar and WTI rows the catalog names are not stored.
    for (const slot of ["Shock", "What happens to"]) expect(values(slot), slot).not.toEqual(expect.arrayContaining(["dxy"]));
    for (const slot of ["Shock", "What happens to"]) expect(values(slot), slot).not.toEqual(expect.arrayContaining(["wti"]));
  });

  it("Codex R-23: a preset link keeps its horizon through the address, the request, the answer and the export", async () => {
    const { calls } = stubDesk();
    const urls = globalThis.URL as unknown as { createObjectURL?: unknown; revokeObjectURL?: unknown };
    const [c0, r0] = [urls.createObjectURL, urls.revokeObjectURL];
    urls.createObjectURL = () => "blob:x";
    const revoke = vi.fn();
    urls.revokeObjectURL = revoke;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&horizon=5");
      const card = await screen.findByRole("region", { name: "The answer" });
      await waitFor(() => expect(card).toHaveTextContent("Suggestive at 1 week:"));
      expect(calls).toContain("GET /api/desk/study?preset=gold-2sigma-spx-weak&horizon=5");
      fireEvent.click(await screen.findByTestId("es-export"));
      await waitFor(() => expect(calls.some((c) => c.startsWith("GET /api/desk/study/events?preset=gold-2sigma-spx-weak&horizon=5"))).toBe(true));
      await waitFor(() => expect(click).toHaveBeenCalled());
      // The object URL is released a second after the click; restore the stubs only after that,
      // or the timer fires on jsdom's URL, which has no revokeObjectURL (desk/fill-etf gate).
      await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:x"), { timeout: 3000 });
    } finally {
      click.mockRestore();
      urls.createObjectURL = c0;
      urls.revokeObjectURL = r0;
    }
  });

  it("Codex R-23: a preset link with a horizon the study does not allow prints the refusal's words", async () => {
    const one = renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&horizon=7");
    let card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("No study in the catalog asks gold-2sigma-spx-weak at a horizon of 7; its horizons are 5, 10, 20, 60 sessions."));
    one.unmount();
    // An empty horizon is sent as written, and refused, never dropped for the default.
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&horizon=");
    card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("No study in the catalog asks gold-2sigma-spx-weak with an empty horizon; its horizons are 5, 10, 20, 60 sessions."));
  });

  it("the RSI rows are catalog studies (desk/fill-compute): an RSI preset takes the four horizons, and the MOVE slot offers the two RSI crossings", async () => {
    renderTab("/desk/event-study?preset=rsi-above-70&horizon=7");
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("No study in the catalog asks rsi-above-70 at a horizon of 7; its horizons are 5, 10, 20, 60 sessions."));
    const move = (await screen.findByLabelText("Move")) as HTMLSelectElement;
    expect([...move.options].map((o) => o.textContent)).toEqual(expect.arrayContaining(["RSI crosses above 70", "RSI crosses below 30"]));
  });

  it("Codex R-23: an awaiting preset asked at a horizon shows that horizon in the slots", async () => {
    renderTab("/desk/event-study?preset=dollar-2sigma-20d&horizon=5");
    await waitFor(() => expect(screen.getByLabelText("Over the next")).toHaveValue("5"));
  });

  it("Codex R-23: the address and the query identity carry the preset's horizon; the Client view's month drops it", () => {
    const a = askFromSearch("preset=gold-2sigma-spx-weak&horizon=5");
    expect(a).toEqual({ preset: "gold-2sigma-spx-weak", horizon: "5" });
    expect(searchFor(a)).toBe("preset=gold-2sigma-spx-weak&horizon=5");
    expect(apiParams(a)).toEqual({ preset: "gold-2sigma-spx-weak", horizon: "5" });
    expect(apiParams(askFromSearch("preset=gold-2sigma-spx-weak"))).toEqual({ preset: "gold-2sigma-spx-weak" });
    expect(atMonth(a)).toEqual({ preset: "gold-2sigma-spx-weak" });
    // An engine slug is a preset too (§12.2, S-20), sent as written for the server to normalize.
    expect(askFromSearch("preset=gold-w20-z2.0-up-spx_below_50dma-spx")).toEqual({ preset: "gold-w20-z2.0-up-spx_below_50dma-spx" });
  });

  it("events whose K−2 month has no stored regimes row are counted under the table (S-06)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, unlabeled_n: 3 }) });
    renderTab();
    await waitFor(() => expect(rail()).toHaveTextContent("Unlabeled: 3 events whose K−2 month has no stored regimes row"));
  });

  it("without a horizon's own count, the share stands and the count says it is awaiting refresh (R-07)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, horizons: study.horizons.map((h) => (h.h === 20 ? { ...h, n: undefined } : h)) }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Up a month later\s*67%\s*count awaiting refresh/));
    expect(answer()).not.toHaveTextContent("12 of 18");
  });

  it("Advanced's events table prints each move in the study's unit (R-02)", async () => {
    stubDesk({ "/api/desk/study": bpStudy, "/api/desk/study/events": bpEvents });
    renderTab();
    await waitFor(() => expect(rail()).toHaveTextContent("Verdict"));
    fireEvent.click(within(rail()).getByTestId("dk-advanced"));
    const adv = await screen.findByRole("region", { name: "Advanced" });
    await waitFor(() => expect(within(adv).getAllByRole("row").length).toBeGreaterThan(18));
    const first = within(adv).getAllByRole("row").find((r) => r.textContent?.startsWith("Apr 16, 2025"))!;
    expect(first.textContent).toBe("Apr 16, 2025Overheating+8 bp+12 bp+25 bpnot complete yet");
    expect(within(adv).getByRole("table").textContent).not.toMatch(/%/);
  });

  it("Save keeps the six slots only: the served unit and name stay with the answer (G2-8)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    fireEvent.click(screen.getByTestId("es-save"));
    const [kept] = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as { question: Record<string, unknown> }[];
    expect(Object.keys(kept.question).sort()).toEqual(["horizon", "move", "shock", "target", "while", "window"]);
  });

  it("the line without the condition ranks nothing: served ready (not Monday's contract) or absent, it says Awaiting refresh (C-01)", async () => {
    const { without_condition: _w, ...absent } = study;
    void _w;
    stubDesk({ "/api/desk/study": () => absent });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("Without the S&P condition: Awaiting refresh"));
    expect(answer()).not.toHaveTextContent(/earns its place|No edge\./);
  });
});

describe("a study served awaiting (§12.0, v4 B-07)", () => {
  it("the answer and the rail keep their labels and print the served reason, never a number", async () => {
    stubDesk({ "/api/desk/study": deskAwaiting("US Dollar Index (DX-Y.NYB) is not stored in this database: it is a tier 2 series, and the full refresh stores tier 1 only.") });
    renderTab("/desk/event-study?preset=dollar-2sigma-20d");
    const answer = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(answer).toHaveTextContent("US Dollar Index (DX-Y.NYB) is not stored in this database"));
    expect(answer).toHaveTextContent(/Events/i);
    expect(answer).not.toHaveTextContent("Awaiting refresh");
    expect(answer.textContent).not.toMatch(/[+−]\d/);
    expect(within(answer).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    const rail = screen.getByRole("complementary", { name: "Verdict and detail" });
    for (const l of ["Verdict", "By regime · a month later", "Last five events"]) expect(rail).toHaveTextContent(l);
    expect(within(rail).getAllByText(/US Dollar Index \(DX-Y\.NYB\) is not stored/)).toHaveLength(1);
    expect(rail).not.toHaveTextContent("Awaiting refresh");
  });

  it("the line without the condition, served awaiting, keeps its lead and prints the reason (C-01)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: "The answer" })).toHaveTextContent("Without the S&P condition: conditional-versus-unconditional comparison is not defined"));
  });
});
