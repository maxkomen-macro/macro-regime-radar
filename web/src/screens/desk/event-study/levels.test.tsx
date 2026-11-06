/**
 * Desk P1d (docs/desk/INTERVALS_SPEC.md): the Event Study's "Range shown" switch. The verdicts stay at the
 * engine's 90%; 80% and 95% draw the served `ci80_*`/`ci95_*` ranges of the same resampled medians in the rail
 * and the chart's whiskers, one level for the whole answer, never another level's pair in a row. The level lives
 * in the address (`ci`), survives navigation, and is never sent to the API. An answer from before the fields is
 * drawn at 90% and says so.
 *
 * The served 80%/95% numbers below are invented for the test (test-data rule), nested around the fixture's 90%.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import DeskShell from "../DeskShell";
import study from "../../../fixtures/desk/study.json";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import type { StudyHorizon } from "../data/types";
import { effectiveLevel, levelOf, NOT_COMPUTABLE, pairAt, PREDATES, rowRange, serves, strayLevel } from "./levels";
import { SAVED_KEY, searchFor } from "./question";

function Spy() {
  const l = useLocation();
  const nav = useNavigate();
  return (
    <>
      <output data-testid="loc">{`${l.pathname}${l.search}`}</output>
      <button type="button" onClick={() => nav(-1)}>
        test-back
      </button>
    </>
  );
}

function renderTab(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <Spy />
    </>,
    { route },
  );
}

const H = study.horizons as unknown as StudyHorizon[];
/** The fixture's answer with the four fields served: 5 sessions both pairs, 10 sessions a 95% pair not computable,
 * 20 sessions both, 60 sessions no interval at all (too few blocks, all four null). */
function served(): typeof study {
  const rows = H.map((h) => {
    if (h.h === 5) return { ...h, ci80_lo: -0.01, ci80_hi: 0.02, ci95_lo: -0.025, ci95_hi: 0.035 };
    if (h.h === 10) return { ...h, ci80_lo: -0.005, ci80_hi: 0.025, ci95_lo: null, ci95_hi: null };
    if (h.h === 20) return { ...h, ci80_lo: -0.01, ci80_hi: 0.03, ci95_lo: -0.02, ci95_hi: 0.05 };
    return { ...h, ci_lo: null, ci_hi: null, adverse_share: null, reason: "fewer than five independent blocks", ci80_lo: null, ci80_hi: null, ci95_lo: null, ci95_hi: null };
  });
  return { ...study, horizons: rows } as unknown as typeof study;
}

const loc = () => screen.getByTestId("loc").textContent ?? "";
const rail = () => screen.getByRole("complementary", { name: "Verdict and detail" });
const answer = () => screen.getByRole("region", { name: "The answer" });
const rows = () => [...rail().querySelectorAll(".es-range-head ~ .es-ranges li")].map((li) => li.textContent);
const switchGroup = () => within(rail()).getByRole("group", { name: "Range shown" });
const radio = (name: string) => within(switchGroup()).getByRole("radio", { name }) as HTMLInputElement;
const whiskers = () => answer().querySelectorAll("[data-testid=es-whisker]").length;
const chart = () => answer().querySelector("svg[role=img]")!.getAttribute("aria-label") ?? "";

const realFetch = globalThis.fetch;
let calls: string[] = [];
beforeEach(() => {
  localStorage.removeItem(SAVED_KEY);
  // The gold preset answers as the fixture (before the fields); the golden cross answers with them served.
  calls = stubDesk({ "/api/desk/study": (url) => (url.searchParams.get("preset") === "golden-cross" ? served() : study) }).calls;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("the level rules (levels.ts)", () => {
  it("reads ci=80 or ci=95 from the address, anything else as 90, and flags a value to drop", () => {
    expect(levelOf(new URLSearchParams(""))).toBe(90);
    expect(levelOf(new URLSearchParams("ci=80"))).toBe(80);
    expect(levelOf(new URLSearchParams("ci=95"))).toBe(95);
    expect(levelOf(new URLSearchParams("ci=99"))).toBe(90);
    expect(levelOf(new URLSearchParams("ci=90"))).toBe(90);
    expect(strayLevel(new URLSearchParams("ci=99"))).toBe(true);
    expect(strayLevel(new URLSearchParams("ci=90"))).toBe(true);
    expect(strayLevel(new URLSearchParams("ci=95"))).toBe(false);
    expect(strayLevel(new URLSearchParams(""))).toBe(false);
  });

  it("an answer serves 80 or 95 only when every horizon carries the level's fields; else the whole answer is 90", () => {
    const s = served().horizons as unknown as StudyHorizon[];
    expect(serves(H, 90) && !serves(H, 80) && !serves(H, 95)).toBe(true);
    expect(serves(s, 80) && serves(s, 95)).toBe(true);
    expect(effectiveLevel(H, 95)).toBe(90);
    expect(effectiveLevel(s, 95)).toBe(95);
    expect(effectiveLevel([], 80)).toBe(90);
    // a horizon missing the fields makes the level unserved for the whole answer, never mixed per row
    const partial = s.map((h, i) => (i === 1 ? H[1] : h));
    expect(effectiveLevel(partial, 95)).toBe(90);
  });

  it("a row at 90 reads as before P1d; at 80 or 95 it never borrows the 90% pair", () => {
    const s = served().horizons as unknown as StudyHorizon[];
    for (const h of H) expect(rowRange(h, 90, "log_return")).toEqual({ kind: "range", text: expect.stringMatching(/ pts$/) });
    expect(rowRange(s[0], 95, "log_return")).toEqual({ kind: "range", text: "−2.5 to +3.5 pts" });
    expect(rowRange(s[1], 95, "log_return")).toEqual({ kind: "why", text: NOT_COMPUTABLE });
    expect(rowRange(s[1], 80, "log_return")).toEqual({ kind: "range", text: "−0.5 to +2.5 pts" });
    expect(rowRange(s[3], 95, "log_return")).toEqual({ kind: "why", text: "fewer than five independent blocks" });
    expect(rowRange(s[3], 90, "log_return")).toEqual({ kind: "why", text: "fewer than five independent blocks" });
    expect(rowRange({ ...s[3], reason: null }, 95, "log_return")).toEqual({ kind: "await", text: "Awaiting refresh" });
    expect(pairAt(s[1], 95)).toBeNull();
    expect(pairAt({ ...s[0], ci95_hi: Number.NaN }, 95)).toBeNull();
  });

  it("searchFor keeps ci with the view and tour, so a saved question, a slot change or a preset keeps the level", () => {
    const keep = new URLSearchParams("ci=95&view=client&mode=build&adv=1");
    expect(searchFor({ preset: "golden-cross" }, keep)).toBe("view=client&ci=95&preset=golden-cross");
    expect(searchFor({ question: { shock: "gold", window: 20, move: "up2s", while: "none", target: "spx", horizon: 20 } }, keep)).toBe(
      "view=client&ci=95&shock=gold&window=20&move=up2s&while=none&target=spx&horizon=20",
    );
    // the ask's identity carries no level
    expect(searchFor({ preset: "golden-cross" })).toBe("preset=golden-cross");
  });
});

describe("the Range shown switch", () => {
  it("is a labelled group of three native radios; 90 is checked by default and the rail reads as before", async () => {
    renderTab("/desk/event-study?preset=golden-cross");
    await waitFor(() => expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("90% range"));
    const radios = within(switchGroup()).getAllByRole("radio");
    expect(radios.map((r) => (r as HTMLInputElement).value)).toEqual(["80", "90", "95"]);
    expect(radios.every((r) => r.getAttribute("name") === "es-ci" && r.tagName === "INPUT")).toBe(true);
    expect(radio("90%").checked && !radio("80%").checked && !radio("95%").checked).toBe(true);
    expect(rail().querySelector(".es-range-head .dk-stat-label")!.textContent).toBe("Edge vs a normal period · 90% range");
    expect(rows()).toEqual(["1 week−1.8 to +3.0 ptsSuggestive", "2 weeks−0.9 to +3.2 ptsSuggestive", "1 month−1.6 to +4.1 ptsSuggestive", "3 monthsfewer than five independent blocksSuggestive"]);
    expect(within(rail()).queryByTestId("es-level-note")).toBeNull();
    expect(whiskers()).toBe(3);
    expect(chart()).toContain("with its 90% range");
  });

  it("95 changes the ranges and the whiskers, not the verdicts, the headline or why; the address carries it", async () => {
    renderTab("/desk/event-study?preset=golden-cross");
    await waitFor(() => expect(radio("95%")).toBeTruthy());
    const verdictBox = rail().querySelector(".es-verdict")?.textContent;
    expect(verdictBox).toMatch(/^Verdict · Suggestive/);
    const headline = answer().querySelector(".es-headline")!.textContent;
    const words = [...rail().querySelectorAll(".es-ranges li")].map((li) => li.lastElementChild?.textContent);
    fireEvent.click(radio("95%"));
    await waitFor(() => expect(loc()).toContain("ci=95"));
    expect(radio("95%").checked).toBe(true);
    expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("95% range");
    expect(rows()).toEqual([
      "1 week−2.5 to +3.5 ptsSuggestive",
      `2 weeks${NOT_COMPUTABLE}Suggestive`,
      "1 month−2.0 to +5.0 ptsSuggestive",
      "3 monthsfewer than five independent blocksSuggestive",
    ]);
    expect(within(rail()).getByTestId("es-level-note")).toHaveTextContent(
      "Verdicts are judged at the engine's 90% range; this view shows the 95% range of the same resampled medians.",
    );
    // whiskers only where the 95% pair exists (5 and 20 sessions); 10 sessions keeps its bars without one
    expect(whiskers()).toBe(2);
    expect(chart()).toContain("with its 95% range");
    expect(chart()).toContain("2 weeks");
    expect(chart()).toMatch(/2 weeks [^;]*, no 95% range/);
    expect(rail().querySelector(".es-verdict")?.textContent).toBe(verdictBox);
    expect(answer().querySelector(".es-headline")!.textContent).toBe(headline);
    expect([...rail().querySelectorAll(".es-ranges li")].map((li) => li.lastElementChild?.textContent)).toEqual(words);
    fireEvent.click(radio("80%"));
    await waitFor(() => expect(loc()).toContain("ci=80"));
    expect(rows()[1]).toBe("2 weeks−0.5 to +2.5 ptsSuggestive");
    expect(whiskers()).toBe(3);
    fireEvent.click(radio("90%"));
    await waitFor(() => expect(loc()).not.toContain("ci="));
    expect(whiskers()).toBe(3);
    // display state only: no request ever carries the level
    expect(calls.some((c) => /[?&]ci=/.test(c))).toBe(false);
  });

  it("?ci=95 on an answer from before the fields draws the engine's 90% for the whole answer and says so", async () => {
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&ci=95");
    await waitFor(() => expect(within(rail()).getByTestId("es-level-note")).toHaveTextContent(`The 95% range is not served for this answer yet; showing the engine's 90%. ${PREDATES}`));
    expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("90% range");
    expect(rows()[2]).toBe("1 month−1.6 to +4.1 ptsSuggestive");
    // the requested level stays checked and reachable, described by the line; the address keeps it
    expect(radio("95%").checked).toBe(true);
    expect(radio("95%")).not.toBeDisabled();
    expect(radio("95%").getAttribute("aria-describedby")).toBe(within(rail()).getByTestId("es-level-note").id);
    expect(radio("90%").getAttribute("aria-describedby")).toBeNull();
    expect(loc()).toContain("ci=95");
    expect(whiskers()).toBe(4);
    expect(chart()).toContain("with its 90% range");
  });

  it("at 90 an older answer marks 80 and 95 unavailable with the reason, and prints no line", async () => {
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak");
    await waitFor(() => expect(radio("80%")).toBeTruthy());
    const id = radio("80%").getAttribute("aria-describedby")!;
    expect(id).toBeTruthy();
    expect(document.getElementById(id)).toHaveTextContent(PREDATES);
    expect(document.getElementById(id)).toHaveClass("dk-sr");
    expect(radio("80%").closest("label")).toHaveAttribute("data-off");
    expect(radio("90%").closest("label")).not.toHaveAttribute("data-off");
    expect(within(rail()).queryByTestId("es-level-note")).toBeNull();
  });

  it("older to newer and back under ?ci=95: a preset chip keeps the level, back returns to the 90% fallback", async () => {
    renderTab("/desk/event-study?preset=gold-2sigma-spx-weak&ci=95");
    await waitFor(() => expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("90% range"));
    fireEvent.click(screen.getByRole("button", { name: "S&P golden cross" }));
    await waitFor(() => expect(loc()).toContain("preset=golden-cross"));
    expect(loc()).toContain("ci=95");
    await waitFor(() => expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("95% range"));
    expect(rows()[0]).toBe("1 week−2.5 to +3.5 ptsSuggestive");
    fireEvent.click(screen.getByRole("button", { name: "test-back" }));
    await waitFor(() => expect(loc()).toContain("preset=gold-2sigma-spx-weak"));
    expect(loc()).toContain("ci=95");
    await waitFor(() => expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("90% range"));
    expect(within(rail()).getByTestId("es-level-note")).toHaveTextContent("The 95% range is not served for this answer yet");
    expect(calls.some((c) => /[?&]ci=/.test(c))).toBe(false);
  });

  it("a ci value the page does not read is dropped from the address and drawn at 90", async () => {
    renderTab("/desk/event-study?preset=golden-cross&ci=99");
    await waitFor(() => expect(loc()).not.toContain("ci="));
    await waitFor(() => expect(radio("90%").checked).toBe(true));
    expect(within(rail()).getByTestId("es-conf")).toHaveTextContent("90% range");
  });
});
