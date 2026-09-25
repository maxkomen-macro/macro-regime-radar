/**
 * Event Study (DESK_FRAME3_SPEC §4) against the §12.2 and §12.3 fixtures:
 * the address is the question, the slots show what is asked, the answer and
 * the rail print served fields only, a slot change makes the question your
 * own and Run asks it, saved questions live in this browser with a JSON
 * export and import, fewer than 10 events is one sentence and two fixes, and
 * Advanced opens the events, the rules and the engine's own panel.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { QueryClient } from "@tanstack/react-query";
import DeskShell from "../DeskShell";
import study from "../../../fixtures/desk/study.json";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import { bpEvents, bpStudy } from "../../../test/desk-variants";
import type { Question } from "../data/types";
import { applyFix, provenanceLine } from "./EventStudyPage";
import { barTicks, horizonPhrase, servedWords } from "./AnswerCard";
import { LAST_STUDY_KEY, SAVED_KEY, askFromSearch, engineSlugFor, exportSaved, importSaved, questionFromEngine, searchFor, withSaved } from "./question";

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
    expect(askFromSearch("")).toEqual({ preset: "gold-2sigma-spx-weak", confidence: undefined });
    expect(askFromSearch("preset=golden-cross&confidence=0.8")).toEqual({ preset: "golden-cross", confidence: 0.8 });
    expect(askFromSearch("shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20")).toEqual({ question: GOLD, confidence: undefined });
    expect(askFromSearch("shock=gold&window=7&move=up2s&while=none&target=spx&horizon=20")).toEqual({ preset: "gold-2sigma-spx-weak", confidence: undefined });
    expect(searchFor({ question: GOLD, confidence: 0.95 }, new URLSearchParams("view=client&x=1"))).toBe("view=client&shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20&confidence=0.95");
  });
  it("opens an old frame-2 link (?study=<engine slug>) as the same six slots", () => {
    expect(askFromSearch("study=gold-2sigma-spx-weak")).toEqual({ question: GOLD, confidence: undefined });
    expect(askFromSearch("study=spx-golden-cross")).toEqual({ question: { shock: "spx", window: 20, move: "cross_above", while: "none", target: "spx", horizon: 20 }, confidence: undefined });
    expect(askFromSearch("preset=rsi-below-30")).toEqual({ preset: "rsi-below-30", confidence: undefined });
  });

  it("an engine link at another z or for one regime is not read as the 2σ, all-regime question", () => {
    expect(questionFromEngine("gold-w20-z2.0-up-spx_below_50dma-spx-goldilocks")).toBeNull();
    expect(questionFromEngine("gold-w5-z2.5-down-none-us10y")).toBeNull();
    expect(askFromSearch("study=gold-w5-z2.5-down-none-us10y")).toEqual({ preset: "gold-2sigma-spx-weak", confidence: undefined });
  });

  it("maps a question onto the engine's own study when the engine can ask it", () => {
    expect(engineSlugFor(GOLD)).toBe("gold-2sigma-spx-weak");
    expect(engineSlugFor({ ...GOLD, shock: "spx", move: "cross_above", while: "none" })).toBe("spx-golden-cross");
    expect(engineSlugFor({ ...GOLD, window: 10 })).toBeNull();
    expect(engineSlugFor({ ...GOLD, while: "spx_above_50" })).toBeNull();
    expect(engineSlugFor({ ...GOLD, while: "regime:Recession Risk" })).toBe("gold-w20-z2.0-up-regime=recession_risk-spx");
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
    expect(servedWords({ elapsed_ms: 300, served_from_cache: true })).toBe("0.3s, cached");
    expect(barTicks(-0.5, 6.2)).toEqual([-3, 0, 5]);
    // Basis points and price points step by 1, 2 or 5 × 10ⁿ, never by a percent's 5 (Codex G2-5).
    expect(barTicks(-13, 57, "bp")).toEqual([-30, 0, 50]);
    expect(barTicks(-80, 57, "bp")).toEqual([-100, 0, 50]);
    expect(barTicks(-2, 14, "px")).toEqual([-6, 0, 10]);
    expect(barTicks(-0.5, 2.4, "bp")).toEqual([-1.2, 0, 2]);
    expect(applyFix(GOLD, "drop_condition")?.while).toBe("none");
    expect(applyFix(GOLD, "widen_window")?.window).toBe(60);
    expect(applyFix({ ...GOLD, window: 60 }, "widen_window")).toBeNull();
    expect(applyFix({ ...GOLD, while: "none" }, "drop_condition")).toBeNull();
    expect(provenanceLine(study as never, (k) => (k === "gold" ? "Gold" : k))).toBe("Engine as of Sep 22 · cluster bootstrap 10,000 · entry next session · cooldown 20 · Gold history from 2000 · slug gold-2sigma-spx-weak");
  });
});

describe("Event Study tab", () => {
  it("answers the gold preset: headline, pills, stats, chart, the line without the condition", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("Leans positive a month out, but not something to size on."));
    expect(card).toHaveTextContent("○ Not firing today · last Apr 16, 2025");
    expect(card).toHaveTextContent("● Live · 0.3s, cached");
    expect(card).toHaveTextContent(/Events\s*18\s*since 2000/);
    expect(card).toHaveTextContent(/Up a month later\s*67%\s*12 of 18/);
    expect(card).toHaveTextContent(/Median at a month\s*\+3\.1%\s*vs \+1\.3% in a normal month/);
    expect(card).toHaveTextContent("−9.4% / +12.0%");
    expect(card).toHaveTextContent("Mar 2020 · Apr 2025");
    expect(within(card).getByRole("img", { name: /median move after the event/ })).toBeInTheDocument();
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Without the S&P condition — Gold +2σ on its own — it’s 41 events, up 58%, median +1.6%: No edge. The condition earns its place.");
  });

  it("the rail: verdict, by regime with n<5, today's regime note, last five, ranges at the served confidence", async () => {
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict · Suggestive"));
    expect(rail).toHaveTextContent("Lean, don't size.");
    expect(within(rail).getByRole("link", { name: "Price it →" })).toHaveAttribute("href", "/desk/basket-hedge?mode=express&study=gold-2sigma-spx-weak");
    const rows = within(rail).getAllByRole("row");
    // By regime from the events at their K−2 rows of the regime record (Codex R-05).
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining(["Goldilocks560%+2.8%", "Overheating4n<5n<5", "Stagflation2n<5n<5", "Recession Risk786%+3.5%"]));
    expect(rail).toHaveTextContent("Oct 27, 2023Recession Risk+8.1%");
    expect(rail).toHaveTextContent("Today is Overheating: four events, too few to read alone.");
    expect(rail).toHaveTextContent("Apr 16, 2025Overheating+12.0%");
    expect(rail).toHaveTextContent("−1.6 to +4.1 pts");
    expect(within(within(rail).getByRole("group", { name: "Confidence" })).getByRole("button", { name: "90%" })).toHaveAttribute("aria-pressed", "true");
    expect(rail).toHaveTextContent("All four include zero at 90%. At 80% the 1-month range clears zero; at 95% none do.");
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

  it("a confidence chip re-asks with confidence", async () => {
    const { calls } = stubDesk();
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.click(within(rail).getByRole("button", { name: "80%" }));
    await waitFor(() => expect(calls.some((c) => c.includes("/api/desk/study?preset=gold-2sigma-spx-weak&confidence=0.8"))).toBe(true));
  });

  it("Save keeps the question in this browser and lists it under My saved questions", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    fireEvent.click(screen.getByTestId("es-save"));
    expect(screen.getByRole("button", { name: "My saved questions · 1" })).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]")).toHaveLength(1);
    expect(within(screen.getByRole("group", { name: "My saved questions" })).getByRole("button", { name: /Gold up 2σ or more over 20 days/ })).toBeInTheDocument();
  });

  it("fewer than 10 events: one sentence and two fixes, no chart", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, n_events: 6, verdict: "insufficient", horizons: [], empty_state: { sentence: "Only 6 events since 2000 — too few to score.", fixes: ["widen_window", "drop_condition"] } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("Only 6 events since 2000 — too few to score."));
    expect(within(card).queryByRole("img")).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Drop the condition" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("while=none"));
  });

  it("edits survive a confidence change; clicking the pressed preset puts the served question back", async () => {
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.change(screen.getByLabelText("Over the next"), { target: { value: "60" } });
    fireEvent.click(within(rail).getByRole("button", { name: "80%" }));
    await waitFor(() => expect(screen.getByTestId("loc").textContent).toContain("confidence=0.8"));
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
    fireEvent.click(await screen.findByRole("button", { name: /Gold up 2σ or more over 20 days/ }));
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

  it("a failed /study keeps the stat labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": () => ({ status: 503, body: { error: "warming" } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: "The answer" });
    await waitFor(() => expect(card).toHaveTextContent("Awaiting refresh"));
    expect(card).toHaveTextContent("Events");
    expect(card).toHaveTextContent("Up a month later");
    expect(card).not.toHaveTextContent("18");
    const rail = screen.getByRole("complementary", { name: "Verdict and detail" });
    expect(rail).toHaveTextContent(/Verdict\s*Awaiting refresh/);
    expect(rail).toHaveTextContent(/Range vs normal\s*Awaiting refresh/);
  });

  it("Advanced opens the events, the rules and the engine's own panel for the same question", async () => {
    renderTab();
    const rail = await screen.findByRole("complementary", { name: "Verdict and detail" });
    await waitFor(() => expect(rail).toHaveTextContent("Verdict"));
    fireEvent.click(within(rail).getByTestId("dk-advanced"));
    const adv = await screen.findByRole("region", { name: "Advanced" });
    await waitFor(() => expect(within(adv).getAllByRole("row").length).toBeGreaterThan(18));
    expect(adv).toHaveTextContent("Mar 9, 2020");
    expect(adv).toHaveTextContent("entry is the next session");
    await waitFor(() => expect(adv).toHaveTextContent("By horizon, as the engine scores it"));
    expect(adv.textContent).not.toMatch(/established|significant/i);
    // The engine's rows state its fact about zero, never a §1.5 pill (E-1).
    expect(within(adv).queryByText("Suggestive", { selector: ".es-zero" })).toBeNull();
    expect(adv).toHaveTextContent(/includes zero|clears zero/);
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
    expect(answer()).toHaveTextContent(/Events\s*18\s*since 2000/);
    expect(answer()).toHaveTextContent(/Up a month later\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/);
    expect(rail()).toHaveTextContent(/80%90%95%\s*Awaiting refresh/);
    expect(rail()).toHaveTextContent(/By regime · a month later.*Goldilocks/);
  });

  it("without provenance: the line under the grid keeps what was served, the entry rules say Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": without("provenance") });
    renderTab();
    await waitFor(() => expect(screen.getByText(/^Engine as of Sep 22 · slug gold-2sigma-spx-weak$/)).toBeInTheDocument());
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
    stubDesk({ "/api/desk/study": () => ({ ...study, n_events: null, horizons }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Events\s*Awaiting refresh/));
    expect(answer()).toHaveTextContent(/Up a month later\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/);
    expect(answer()).toHaveTextContent(/Worst · best\s*Awaiting refresh/);
    expect(answer()).not.toHaveTextContent("0.0%");
    expect(screen.getByRole("img", { name: /1 month awaiting refresh/ })).toBeInTheDocument();
  });

  it("a study answered null is Awaiting refresh, not loading (Codex R-09)", async () => {
    stubDesk({ "/api/desk/study": () => null });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("Awaiting refresh · the study did not answer"));
    expect(answer()).toHaveTextContent(/Events\s*Awaiting refresh/);
    expect(answer()).not.toHaveAttribute("aria-busy", "true");
  });
});

describe("the study's served contract (Codex round 1, group 2)", () => {
  const rail = () => screen.getByRole("complementary", { name: "Verdict and detail" });
  const answer = () => screen.getByRole("region", { name: "The answer" });

  it("a basis-point target prints every move in bp, never a percent (R-02)", async () => {
    stubDesk({ "/api/desk/study": bpStudy });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Median at a month\s*\+25 bp\s*vs \+5 bp in a normal month/));
    expect(answer()).toHaveTextContent(/Worst · best\s*−30 bp \/ \+60 bp/);
    const chart = screen.getByRole("img", { name: /1 month \+25 bp against \+5 bp/ });
    expect(chart).toHaveTextContent("bp");
    expect(chart.textContent).not.toMatch(/%/);
    expect(rail()).toHaveTextContent(/Goldilocks\s*5\s*60%\s*\+12 bp/);
    expect(rail()).toHaveTextContent(/Recession Risk\s*7\s*86%\s*\+20 bp/);
    expect(rail()).toHaveTextContent("Last five events · 10-year Treasury yield a month later");
    expect(rail()).toHaveTextContent(/Apr 16, 2025\s*Overheating\s*\+30 bp/);
    expect(rail()).toHaveTextContent(/1 month\s*−10 to \+40 bp/);
    expect(answer()).toHaveTextContent("median +9 bp");
  });

  it("a study served without its target's unit prints no move and says so (R-02)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, question: { ...study.question, target_unit: undefined } }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Median at a month\s*Awaiting refresh/));
    expect(answer()).toHaveTextContent("Awaiting refresh · the unit of the study's target");
    expect(answer()).toHaveTextContent(/Up a month later\s*67%/);
    expect(rail()).toHaveTextContent(/1 month\s*Awaiting refresh/);
  });

  it("the horizon's own count is the denominator; the study-wide count is only EVENTS (R-07)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, horizons: study.horizons.map((h) => (h.h === 20 ? { ...h, n_complete: 17 } : h)) }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent(/Up a month later\s*67%\s*12 of 17/));
    expect(answer()).toHaveTextContent(/Events\s*18/);
  });

  it("without a horizon's own count, the share stands and the count says it is awaiting refresh (R-07)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, horizons: study.horizons.map((h) => (h.h === 20 ? { ...h, n_complete: undefined } : h)) }) });
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
    expect(first.textContent).toBe("Apr 16, 2025Overheating+8 bp+12 bp+25 bpno observation");
    expect(within(adv).getByRole("table").textContent).not.toMatch(/%/);
  });

  it("Save keeps the six slots only: the served unit and name stay with the answer (G2-8)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByLabelText("Shock")).toHaveValue("gold"));
    fireEvent.click(screen.getByTestId("es-save"));
    const [kept] = JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as { question: Record<string, unknown> }[];
    expect(Object.keys(kept.question).sort()).toEqual(["horizon", "move", "shock", "target", "while", "window"]);
  });

  it("the line without the condition prints the served note, whatever the verdicts rank (R-12)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, without_condition: { ...study.without_condition, comparison: "no_improvement", comparison_note: "The condition does not improve the read." } }) });
    const { unmount } = renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("No edge. The condition does not improve the read."));
    expect(answer()).not.toHaveTextContent("earns its place");
    unmount();
    stubDesk({ "/api/desk/study": () => ({ ...study, without_condition: { ...study.without_condition, comparison_note: undefined } }) });
    renderTab();
    await waitFor(() => expect(answer()).toHaveTextContent("Whether the condition helps is awaiting refresh."));
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
    stubDesk({ "/api/desk/study": () => ({ ...study, without_condition: { status: "awaiting", data: null, unavailable: { reason: "conditional-versus-unconditional comparison is not defined", until: null } } }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: "The answer" })).toHaveTextContent("Without the S&P condition: conditional-versus-unconditional comparison is not defined"));
  });
});
