/**
 * The Client view (DESK_FRAME3_SPEC §11): the toggle swaps a tab's body for
 * a client-safe read of one study: the served question and paragraph, three
 * numbers at a month against an ordinary month, the backdrop bars on one
 * scale, the source line; no verdict pills, no σ. Event Study reads its own
 * address; other tabs the last study this browser saw, else the gold preset.
 * The labels stay while loading, on an error, and for a study too thin to
 * read at a month (which says so in plain words, never the desk's verdict sentence).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import study from "../../../fixtures/desk/study.json";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import { bpStudy } from "../../../test/desk-variants";
import { barGeometry, setupLabel, sourceLine } from "./ClientView";
import { LAST_STUDY_KEY } from "../event-study/question";

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
  localStorage.removeItem(LAST_STUDY_KEY);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(LAST_STUDY_KEY);
  vi.restoreAllMocks();
});

const backdrop = () => screen.getByRole("region", { name: "A month later, by economic backdrop" });
const withRegimes = (by_regime: { regime: string; n: number; up_pct: number | null; median: number | null }[]) => () => ({ ...study, by_regime });

describe("Client view words and geometry", () => {
  it("says 'Setup' only for a study firing and not stale (§11)", () => {
    expect(setupLabel({ firing_now: true, last_event: "2026-09-22", stale: false })).toBe("Setup · Sep 22, 2026");
    expect(setupLabel({ firing_now: true, last_event: "2026-09-22", stale: true })).toBe("Setup last seen · Sep 22, 2026");
    expect(setupLabel({ firing_now: null, last_event: "2026-09-22" })).toBe("Setup last seen · Sep 22, 2026");
  });
  it("words the source line and the setup's date", () => {
    expect(sourceLine("2026-09-22")).toBe("Radar · FRED, Yahoo Finance · as of Sep 22, 2026 · Past patterns do not guarantee future results.");
    expect(setupLabel({ firing_now: true, last_event: "2026-09-21", stale: false })).toBe("Setup · Sep 21, 2026");
    // Without its freshness served, a firing state claims nothing about today (verifier V14-5).
    expect(setupLabel({ firing_now: true, last_event: "2026-09-21" })).toBe("Setup last seen · Sep 21, 2026");
    expect(setupLabel({ firing_now: false, last_event: "2025-04-16" })).toBe("Setup last seen · Apr 16, 2025");
    expect(setupLabel({ firing_now: false, last_event: null })).toBe("Setup");
    expect(setupLabel(undefined)).toBe("Setup");
  });
  it("draws every bar on one scale: equal moves, equal lengths, whatever their sign", () => {
    const g = barGeometry([0.03, -0.03, 0.01, null]);
    expect(g.bars[0]!.width).toBe(g.bars[1]!.width);
    expect(g.bars[2]!.width).toBe("calc((100% - 84px) * 0.1667)");
    expect(g.bars[3]).toBeNull();
    expect(g.zero).toBe("calc(8px + (100% - 84px) * 0.5000)");
    // A drop ends at zero; its value sits right of zero, never under the bar.
    expect(g.bars[1]!.left).toBe("calc((8px + (100% - 84px) * 0.5000) - (100% - 84px) * 0.5000)");
    expect(g.bars[1]!.label).toBe("calc((8px + (100% - 84px) * 0.5000) + 9px)");
    // Nothing negative: the PNG's room left of zero.
    const up = barGeometry([0.042, 0.028, 0.019, null]);
    expect(up.zero).toBe("46px");
    expect(up.bars[0]!.width).toBe("calc((100% - 122px) * 1.0000)");
    // Everything negative: zero at the right end of the drawable track, the values in the room after it.
    const down = barGeometry([-0.121, -0.05, null]);
    expect(down.zero).toBe("calc(8px + (100% - 84px) * 1.0000)");
    expect(down.bars[0]!.label).toBe("calc((8px + (100% - 84px) * 1.0000) + 9px)");
    // A null row's words: after zero while zero is left of the middle, else ending before it.
    expect(down.none).toEqual({ left: "8px", right: "calc(100% - (8px + (100% - 84px) * 1.0000) + 9px)", align: "right" });
    expect(g.none).toEqual({ left: "calc((8px + (100% - 84px) * 0.5000) + 9px)", right: "0px", align: "left" });
    expect(up.none.align).toBe("left");
  });
});

describe("Client view", () => {
  it("reads the study in plain words: the question, the three numbers, the backdrop, the source", async () => {
    renderTab("/desk/overview?view=client");
    // §12.2 (item 14): client.headline is the catalog client_label; "since" is the sample's first year (the audit's §2.3: 2001-09-19).
    // §11 (item 14): the title is the catalog's client_label, in plain words.
    expect(await screen.findByRole("heading", { level: 1, name: "Gold jumps while the S&P is weak" })).toBeInTheDocument();
    const main = screen.getByRole("main");
    await waitFor(() => expect(main).toHaveTextContent(/Episodes\s*18\s*since 2001/));
    expect(main).toHaveTextContent("Setup last seen · Apr 16, 2025");
    expect(main).toHaveTextContent(/Higher a month later\s*67%\s*vs 65% in an ordinary month/);
    expect(main.querySelector(".cv-stat-value[data-tone='green']")).toHaveTextContent("67%");
    expect(main).toHaveTextContent(/Typical move\s*\+3\.1%\s*vs \+1\.3% ordinary/);
    // §1.9: every log number carries the tooltip, the backdrop's too.
    // The served summary carries its numbers in words, so the sentence carries the tooltip too.
    expect([...main.querySelectorAll('[title="log return, ×100"]')].map((e) => e.textContent)).toEqual([expect.stringMatching(/^Looking at 18 episodes since 2001, the S&P 500 was higher a month later in 12 of 18/), "+3.1%", "+1.3%"]);
    // Every regime has fewer than ten events, so every row is served null (§12.2, MIN_REGIME_N).
    expect(within(backdrop()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Goldilockstoo few cases to say", "Overheatingtoo few cases to say", "Stagflationtoo few cases to say", "Recession Risktoo few cases to say"]);
    expect(backdrop().querySelectorAll(".cv-bar")).toHaveLength(0);
    expect(main).toHaveTextContent("Radar · FRED, Yahoo Finance · as of Sep 24, 2026 · Past patterns do not guarantee future results.");
    // No verdict pills, no σ.
    expect(main.querySelector(".dk-pill")).toBeNull();
    expect(main.textContent).not.toMatch(/Reliable|Suggestive|No edge/);
    // §11: no σ anywhere on the view, the title included (item 14 settled §12.2 on client_label).
    expect(main.textContent).not.toMatch(/σ/);
    // The desk's internals leave the sidebar; the navigation stays.
    expect(screen.getByTestId("desk-shell")).toHaveAttribute("data-client");
    expect(within(screen.getByRole("complementary", { name: "Sidebar" })).getByRole("link", { name: "Regime" })).toBeInTheDocument();
  });

  it("a basis-point study reads in bp, named by its served target (Codex R-02, R-03)", async () => {
    stubDesk({ "/api/desk/study": bpStudy });
    renderTab("/desk/overview?view=client");
    await waitFor(() => expect(backdrop()).toHaveTextContent("Typical 10Y Treasury move after the setup"));
    expect(within(backdrop()).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Goldilocks+12 bp", "Overheatingtoo few cases to say", "Stagflationtoo few cases to say", "Recession Risktoo few cases to say"]);
    expect(screen.getByRole("main")).toHaveTextContent(/Typical move\s*\+25 bp\s*vs \+5 bp ordinary/);
    expect(backdrop().textContent).not.toMatch(/%/);
    expect(screen.getByRole("main").querySelector("[title]")).toBeNull();
  });

  it("a study served without its target's unit prints no move: the stat and the bars say Awaiting refresh (Codex G2-2)", async () => {
    stubDesk({ "/api/desk/study": () => ({ ...study, question: { ...study.question, target_unit: undefined } }) });
    renderTab("/desk/overview?view=client");
    const main = screen.getByRole("main");
    await waitFor(() => expect(main).toHaveTextContent(/Higher a month later\s*67%/));
    expect(main).toHaveTextContent(/Typical move\s*Awaiting refresh/);
    expect(backdrop()).toHaveTextContent("Awaiting refresh");
    expect(within(backdrop()).queryAllByRole("listitem")).toHaveLength(0);
    expect(backdrop().textContent).not.toMatch(/[+−]\d/);
  });

  it("Export one-pager prints the page", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderTab("/desk/overview?view=client");
    fireEvent.click(await screen.findByRole("button", { name: "Export one-pager (PDF)" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("on Event Study it reads the study in the address", async () => {
    const { calls } = stubDesk();
    // A catalog study the fixtures carry no answer for (§12.3's golden cross).
    renderTab("/desk/event-study?preset=golden-cross&view=client");
    await waitFor(() => expect(calls).toContain("GET /api/desk/study?preset=golden-cross"));
    expect(calls.some((c) => c.startsWith("GET /api/desk/study?preset=gold-2sigma-spx-weak"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent(/Episodes\s*Awaiting refresh/));
  });

  it("a question the desk asks at another horizon is read at a month: the client view is h = 20 (v4 B-01)", async () => {
    const { calls } = stubDesk();
    renderTab("/desk/event-study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=5&view=client");
    await waitFor(() => expect(calls).toContain("GET /api/desk/study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20"));
    expect(calls.some((c) => c.includes("horizon=5"))).toBe(false);
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent(/Higher a month later\s*67%/));
  });

  it("with no client block and no catalog row for the study, the title is plain words, never the σ label (§11)", async () => {
    const bare: Record<string, unknown> = { ...study };
    delete bare.client;
    stubDesk({ "/api/desk/study": () => bare, "/api/desk/study/catalog": deskError(503, "warming") });
    renderTab("/desk/overview?view=client");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("What has happened after this setup"));
    expect(screen.getByRole("main").textContent).not.toMatch(/σ/);
  });

  it("elsewhere it reads the last study Event Study answered in this browser", async () => {
    localStorage.setItem(LAST_STUDY_KEY, "?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20");
    const { calls } = stubDesk();
    renderTab("/desk/regime?view=client");
    await waitFor(() => expect(calls).toContain("GET /api/desk/study?shock=gold&window=20&move=up2s&while=spx_below_50&target=spx&horizon=20"));
    expect(await screen.findByRole("heading", { level: 1, name: "Gold jumps while the S&P is weak" })).toBeInTheDocument();
  });

  it("a drop draws red from zero, a mixed set shares one scale, all-null prints the words", async () => {
    stubDesk({
      "/api/desk/study": withRegimes([
        { regime: "Goldilocks", n: 5, up_pct: 0.8, median: 0.03 },
        { regime: "Overheating", n: 6, up_pct: 0.4, median: -0.03 },
        { regime: "Stagflation", n: 5, up_pct: null, median: null },
      ]),
    });
    renderTab("/desk/overview?view=client");
    await waitFor(() => expect(backdrop().querySelectorAll(".cv-bar")).toHaveLength(2));
    const bars = [...backdrop().querySelectorAll<HTMLElement>(".cv-bar")];
    expect(bars.map((b) => b.getAttribute("data-tone"))).toEqual(["green", "red"]);
    expect(bars[0].style.width).toBe(bars[1].style.width);
    expect(backdrop()).toHaveTextContent("Overheating−3.0%");
    expect(backdrop()).toHaveTextContent("Stagflationtoo few cases to say");
  });

  it("a study too thin to read at a month, served without a client paragraph, says so in plain words, not the desk's sentence (§11)", async () => {
    const desk = "Only 6 events complete at 1 month since 2001, fewer than the ten a verdict other than Too few needs.";
    const sentence = "Only 6 episodes since 2001: too few to say what usually happens a month later.";
    const thin: Record<string, unknown> = { ...study, matched_n: 6, verdict: "insufficient", horizons: [], by_regime: [], empty_state: { horizon: 20, sentence: desk, fixes: [] } };
    delete thin.client;
    stubDesk({ "/api/desk/study": () => thin });
    renderTab("/desk/overview?view=client");
    const main = await screen.findByRole("main");
    await waitFor(() => expect(main).toHaveTextContent(/Episodes\s*6\s*since 2001/));
    // §11: with client null the title is the catalog row's client_label (never the σ label).
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Gold jumps while the S&P is weak");
    expect(screen.getByRole("heading", { level: 1 }).textContent).not.toMatch(/σ/);
    expect(main.querySelector(".cv-summary")).toHaveTextContent(sentence);
    expect(main).toHaveTextContent("Higher a month latertoo few cases to say");
    expect(main).toHaveTextContent("Typical movetoo few cases to say");
    expect(backdrop()).toHaveTextContent(sentence);
    expect(main).not.toHaveTextContent("Awaiting refresh");
    expect(main.textContent).not.toMatch(/verdict|Too few/);
  });

  it("a question the server refuses prints its message in plain words; nothing says Awaiting refresh (§4)", async () => {
    stubDesk({ "/api/desk/study": deskError(422, "unsupported", { message: "No study in the catalog asks this question." }) });
    renderTab("/desk/event-study?shock=gold&window=60&move=up2s&while=none&target=spx&horizon=20&view=client");
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent("No study in the catalog asks this question."));
    expect(screen.getByRole("main")).not.toHaveTextContent("Awaiting refresh");
  });

  it("a study that does not answer keeps the labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": deskError(503, "warming") });
    renderTab("/desk/overview?view=client");
    const main = await screen.findByRole("main");
    await waitFor(() => expect(main).toHaveTextContent(/Episodes\s*Awaiting refresh/));
    expect(main).toHaveTextContent(/Higher a month later\s*Awaiting refresh/);
    expect(backdrop()).toHaveTextContent("Awaiting refresh");
  });

  it("while the study loads, the labels and the card's title are already there", async () => {
    globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    renderTab("/desk/overview?view=client");
    const main = await screen.findByRole("main");
    await waitFor(() => expect(main).toHaveTextContent("Episodes"));
    expect(main).toHaveTextContent("Higher a month later");
    expect(main).toHaveTextContent("Typical move");
    expect(backdrop()).toBeInTheDocument();
    expect(main).not.toHaveTextContent("Awaiting refresh");
  });

  it("a tab without the toggle never takes the client view", async () => {
    renderTab("/desk/position-monitor?view=client");
    await screen.findByRole("navigation", { name: "Breadcrumb" });
    expect(screen.getByTestId("desk-shell")).not.toHaveAttribute("data-client");
    expect(screen.queryByRole("button", { name: "Export one-pager (PDF)" })).toBeNull();
  });
});

describe("a study served awaiting (§12.0, §1.0.2)", () => {
  it("the three stats keep their labels with no number and no Awaiting refresh", async () => {
    stubDesk({ "/api/desk/study": deskAwaiting("US Dollar Index (DX-Y.NYB) is not stored in this database.") });
    renderTab("/desk/overview?view=client");
    await waitFor(() => expect(screen.getByRole("main")).toHaveTextContent("US Dollar Index (DX-Y.NYB) is not stored in this database."));
    const main = screen.getByRole("main");
    for (const l of ["Episodes", "Higher a month later", "Typical move"]) expect(main).toHaveTextContent(l);
    expect(main).not.toHaveTextContent("Awaiting refresh");
  });
});
