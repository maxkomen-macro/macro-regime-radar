/**
 * The Finder's symbol field (2026-11-16, owner's request): the site's symbol search sits under "Stock or ETF".
 * A visitor can type a ticker or a company name and pick a suggestion with the keyboard or the pointer; a pick fills
 * the box and nothing else (the chain is priced only by Price the chain); an exact ticker can still be typed and run;
 * a newer search's answer is never replaced by an older one's; loading, no match and a search that does not answer
 * each say so; and a match is never taken to mean the chain can be priced. The hits are invented names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { deskError, stubDesk } from "../../../test/desk";
import { SYMBOL_HINT } from "./OptionsFinderPage";

const hit = (symbol: string, name: string, type = "Equity", exchange = "US", primary = true) => ({ symbol, name, exchange, type, sector: null, primary });
const answer = (hits: unknown[]) => ({ provider: "eodhd", fallback_used: false, fallback_reason: null, fetched_at: "2026-11-16T12:00:00Z", hits });
const ANSWERS: Record<string, unknown[]> = {
  syn: [hit("SYN", "Synthetic Example Corp"), hit("SYNX", "Synthex Holdings"), hit("SYNF", "Synthetic Broad Market Fund", "ETF"), hit("SYN.XX", "Synthetic Example Corp", "Equity", "XX")],
  synthetic: [hit("SYN", "Synthetic Example Corp"), hit("SYNF", "Synthetic Broad Market Fund", "ETF")],
};
const SEARCH = "/api/market/search";
const FINDER = "/api/desk/options/finder";

function LocationSpy() {
  const l = useLocation();
  return <output data-testid="loc">{`${l.pathname}${l.search}`}</output>;
}

function renderFinder(route = "/desk/options-finder") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/desk/:page?" element={<DeskShell />} />
      </Routes>
      <LocationSpy />
    </>,
    { route },
  );
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function field() {
  const form = await screen.findByRole("form", { name: "Your view" });
  return { form, box: within(form).getByRole("combobox", { name: "Stock or ETF" }) };
}
/** The suggestion rows (the Direction select's own <option>s are not suggestions). */
const rows = (form: HTMLElement) => {
  const list = within(form).queryByRole("listbox");
  return list ? within(list).queryAllByRole("option") : [];
};
const searches = (calls: string[]) => calls.filter((c) => c.startsWith(`GET ${SEARCH}`));
const finderCalls = (calls: string[]) => calls.filter((c) => c.includes(FINDER));

describe("Options Finder: the symbol field suggests listings", () => {
  it("suggests under the field as a name is typed: ticker, name and listing, US stocks and ETFs only, one bounded request", async () => {
    const { calls } = stubDesk({ [SEARCH]: (u) => answer(ANSWERS[u.searchParams.get("q") ?? ""] ?? []) });
    renderFinder();
    const { form, box } = await field();
    expect(box).toHaveAttribute("aria-autocomplete", "list");
    expect(within(form).getByText(SYMBOL_HINT)).toBeInTheDocument();
    // Typed quickly, one keystroke at a time: only the settled text is searched.
    for (const t of ["s", "sy", "syn"]) fireEvent.change(box, { target: { value: t } });
    const list = await within(form).findByRole("listbox");
    const options = await within(list).findAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/SYN.*Synthetic Example Corp.*US · Equity/),
      expect.stringMatching(/SYNX.*Synthex Holdings.*US · Equity/),
      expect.stringMatching(/SYNF.*Synthetic Broad Market Fund.*US · ETF/),
    ]);
    expect(within(list).queryByText("SYN.XX")).toBeNull();
    expect(box).toHaveAttribute("aria-expanded", "true");
    expect(searches(calls)).toEqual(["GET /api/market/search?q=syn&limit=10&scope=us"]);
    // A company's name finds it too.
    fireEvent.change(box, { target: { value: "synthetic" } });
    await waitFor(() => expect(rows(form).map((o) => o.textContent)).toEqual([expect.stringMatching(/^.*SYN .*Synthetic Example Corp/), expect.stringMatching(/SYNF/)]));
    expect(finderCalls(calls)).toEqual([]);
  });

  it("a pick by the keyboard or the pointer fills the box only: the other inputs stay, nothing is priced until Price the chain", async () => {
    const { calls } = stubDesk({ [SEARCH]: (u) => answer(ANSWERS[u.searchParams.get("q") ?? ""] ?? []) });
    renderFinder("/desk/options-finder?direction=down&target=85&by=2027-01-15&budget=2500");
    const { form, box } = await field();
    fireEvent.change(box, { target: { value: "syn" } });
    await waitFor(() => expect(rows(form).length).toBeGreaterThan(0));
    // Arrow keys and Enter: the second row.
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(rows(form)[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(box).toHaveValue("SYNX");
    expect(within(form).queryByRole("listbox")).toBeNull();
    expect(within(form).getByLabelText("Direction")).toHaveValue("down");
    expect(within(form).getByLabelText("Target price, dollars")).toHaveValue("85");
    expect(within(form).getByLabelText("By")).toHaveValue("2027-01-15");
    expect(within(form).getByLabelText("Budget, dollars")).toHaveValue("2500");
    expect(screen.getByTestId("loc")).toHaveTextContent(/^\/desk\/options-finder\?direction=down&target=85&by=2027-01-15&budget=2500$/);
    // The pointer (a tap reaches it as the same mousedown): the first row.
    fireEvent.change(box, { target: { value: "syn" } });
    const list = await within(form).findByRole("listbox");
    fireEvent.mouseDown(await within(list).findByText("Synthetic Example Corp"));
    expect(box).toHaveValue("SYN");
    expect(finderCalls(calls)).toEqual([]);
    // Price the chain runs the picked ticker with the rest of the view as entered.
    fireEvent.click(within(form).getByTestId("of-run"));
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/options-finder?symbol=SYN&direction=down&target=85&by=2027-01-15&budget=2500"));
    await waitFor(() => expect(finderCalls(calls)).toEqual(["GET /api/desk/options/finder?symbol=SYN&view=down&target=85&by=2027-01-15&budget=2500"]));
  });

  it("Escape closes the list and keeps what was typed; an exact ticker typed and run is priced as typed", async () => {
    const { calls } = stubDesk({ [SEARCH]: (u) => answer(ANSWERS[u.searchParams.get("q") ?? ""] ?? []) });
    renderFinder("/desk/options-finder?direction=up&target=120&by=2026-12-18&budget=5000");
    const { form, box } = await field();
    fireEvent.change(box, { target: { value: "syn" } });
    await waitFor(() => expect(rows(form).length).toBeGreaterThan(0));
    fireEvent.keyDown(box, { key: "Escape" });
    expect(within(form).queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("syn");
    // With the list closed, Enter submits the form as before: the typed ticker, in capitals.
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("loc")).toHaveTextContent("/desk/options-finder?symbol=SYN&direction=up&target=120&by=2026-12-18&budget=5000"));
    await waitFor(() => expect(finderCalls(calls)).toHaveLength(1));
  });

  it("a newer search's answer is never replaced by an older, slower one", async () => {
    let releaseOld: () => void = () => {};
    const oldGate = new Promise<void>((r) => (releaseOld = r));
    stubDesk({
      [SEARCH]: async (u) => {
        const q = u.searchParams.get("q") ?? "";
        if (q === "sy") await oldGate;
        return answer(q === "sy" ? [hit("SYOLD", "Old Answer Corp")] : (ANSWERS[q] ?? []));
      },
    });
    renderFinder();
    const { form, box } = await field();
    fireEvent.change(box, { target: { value: "sy" } });
    await waitFor(() => expect(within(form).getByRole("listbox")).toHaveTextContent("Searching…"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    fireEvent.change(box, { target: { value: "syn" } });
    await within(form).findByText("Synthex Holdings");
    await act(async () => {
      releaseOld();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(within(form).queryByText("Old Answer Corp")).toBeNull();
    expect(rows(form)).toHaveLength(3);
  });

  it("says when a search is under way, when nothing matches, and when the search does not answer; a ticker can still be typed", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    stubDesk({
      [SEARCH]: async (u) => {
        const q = u.searchParams.get("q") ?? "";
        if (q === "zzz") return answer([]);
        if (q === "down") return { status: 502, body: { detail: "EODHD is unreachable (symbol search).", kind: "unavailable" } };
        await gate;
        return answer(ANSWERS.syn);
      },
    });
    renderFinder();
    const { form, box } = await field();
    fireEvent.change(box, { target: { value: "syn" } });
    await waitFor(() => expect(within(form).getByRole("listbox")).toHaveTextContent("Searching…"));
    await act(async () => release());
    await within(form).findByText("Synthex Holdings");
    fireEvent.change(box, { target: { value: "zzz" } });
    await waitFor(() => expect(within(form).getByRole("listbox")).toHaveTextContent('No listings match "zzz".'));
    fireEvent.change(box, { target: { value: "down" } });
    await waitFor(() => expect(within(form).getByRole("listbox")).toHaveTextContent("Symbol search unavailable: the data service did not answer."), { timeout: 4000 });
    // No stored-series stand-in is offered in the Finder: no option rows while the search is down.
    expect(rows(form)).toEqual([]);
    expect(box).toHaveValue("down");
  });

  it("a match is a listing, not a priced chain: a picked ticker the route cannot price shows the Finder's own unavailable state", async () => {
    stubDesk({
      [SEARCH]: (u) => answer(ANSWERS[u.searchParams.get("q") ?? ""] ?? []),
      [FINDER]: deskError(422, "unsupported", { message: "No listed options were found for SYNX." }),
    });
    renderFinder("/desk/options-finder?direction=up&target=120&by=2026-12-18&budget=5000");
    const { form, box } = await field();
    fireEvent.change(box, { target: { value: "syn" } });
    const list = await within(form).findByRole("listbox");
    fireEvent.mouseDown(await within(list).findByText("Synthex Holdings"));
    fireEvent.click(within(form).getByTestId("of-run"));
    await waitFor(() => expect(screen.getByTestId("of-page")).toHaveAttribute("data-state", "refused"));
    expect(screen.getByTestId("of-page")).toHaveTextContent("No listed options were found for SYNX.");
    expect(screen.getByTestId("loc")).toHaveTextContent("symbol=SYNX");
  });
});
