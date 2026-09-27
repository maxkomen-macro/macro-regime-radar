/**
 * Technicals (DESK_FRAME3_SPEC §3) against the §12.7, §12.9, §12.10 and §12.4
 * fixtures: every number is a served field, the signals are the Ledger's S&P
 * group in the Ledger's order, the sector card shows the top three, the
 * middle one and the bottom three, and a card whose endpoint fails keeps its
 * labels and says "Awaiting refresh" (§1.7). The vol column is the PROTOTYPE
 * card (§1.0.3) until /technicals serves its vol block.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import ledger from "../../../fixtures/desk/ledger.json";
import technicals from "../../../fixtures/desk/technicals.json";
import type { LedgerRow } from "../data/types";
import { renderWithProviders } from "../../../test/utils";
import { deskAwaiting, deskError, stubDesk } from "../../../test/desk";
import TechnicalsPage, { aboveBelow, allowlistRows, dayInYear, dayMove, macdCrossWords, macdSide, monthTicks, quarterOf, rsiDirection, rsiZone, sevenOf, trendWord, yearsLine } from "./TechnicalsPage";
import { symbolOf } from "./symbol";
import { deskPageBySlug } from "../desk-sections";
import { servedTechnicals } from "../../../test/desk-variants";
import { DESK_ACCENTS } from "../kit/palette";

function renderTab() {
  return renderWithProviders(
    <Routes>
      <Route path="/desk/:page?" element={<DeskShell />} />
    </Routes>,
    { route: "/desk/technicals" },
  );
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  stubDesk();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("Technicals words", () => {
  it("spells distances, quarters, days and names", () => {
    expect(aboveBelow(0.021)).toBe("price is 2.1% above");
    expect(aboveBelow(-0.034)).toBe("price is 3.4% below");
    expect(quarterOf("2023-10")).toBe("Q4 2023");
    expect(quarterOf("2024-02")).toBe("Q1 2024");
    expect(dayInYear("2026-06-12", "2026-09-22")).toBe("Jun 12");
    expect(dayInYear("2025-04-08", "2026-09-22")).toBe("Apr 8, 2025");
    expect(quarterOf("2023")).toBe("");
    // §3: the zone by the two levels the RSI studies cross (strictly); the direction only from the two served numbers.
    expect([rsiZone(70), rsiZone(70.01), rsiZone(30), rsiZone(29.99), rsiZone(55)]).toEqual(["neutral", "overbought", "neutral", "oversold", "neutral"]);
    expect([rsiDirection(58, 55), rsiDirection(55, 58), rsiDirection(55, 55), rsiDirection(55, null)]).toEqual(["rising", "falling", "flat", null]);
    expect(dayMove(0.004, "2026-09-22", "2026-09-22")).toBe("+0.4% today");
    expect(dayMove(0.004, "2026-09-22", "2026-09-24")).toBe("+0.4% on Sep 22");
    // §3: `trend.state` in words.
    expect([trendWord("above_both"), trendWord("below_both"), trendWord("mixed"), trendWord("unavailable"), trendWord("sideways")]).toEqual(["Above both", "Below both", "Mixed", "Unavailable", null]);
    // §3 (desk/fill-compute): the MACD's words come from the served histogram and crossover kind only.
    expect([macdSide(0.28), macdSide(-1), macdSide(0), macdSide(null)]).toEqual(["MACD above its signal", "MACD below its signal", "MACD on its signal", null]);
    expect([macdCrossWords("above"), macdCrossWords("below"), macdCrossWords(undefined)]).toEqual(["MACD crossed above its signal", "MACD crossed below its signal", null]);
    // §3: the years line from the served counts.
    expect(yearsLine([{ n: 36 }, { n: 37 }, { n: null }])).toBe("36–37 years a month · a month counts once it is complete");
    expect(yearsLine([{ n: 5 }, { n: 5 }])).toBe("5 years a month · a month counts once it is complete");
    expect(yearsLine([{ n: null }])).toBeNull();
  });
  it("lists the Ledger's rows in `signals_allowlist` order, leaving out what the Ledger does not serve (§3)", () => {
    const l = { ...ledger, signals: ledger.signals as LedgerRow[] };
    expect(allowlistRows(l as never, technicals.signals_allowlist).map((r) => r.slug)).toEqual(["golden-cross", "death-cross", "rsi-above-70", "rsi-below-30", "spx-20d-2sigma", "spx-5d-2sigma"]);
    expect(allowlistRows(l as never, ["dollar-2sigma-20d", "golden-cross", "nope"]).map((r) => r.slug)).toEqual(["golden-cross"]);
  });
  it("keeps the top three, the middle one and the bottom three", () => {
    expect(sevenOf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])).toEqual([1, 2, 3, 6, 9, 10, 11]);
    expect(sevenOf([1, 2, 3])).toEqual([1, 2, 3]);
  });
  it("labels three months on the x axis", () => {
    expect(monthTicks(["2025-09-22", "2025-09-30", "2025-10-01", "2026-03-31", "2026-04-01", "2026-09-22"]).map((t) => t.text)).toEqual(["Oct 25", "Apr 26", "Sep 26"]);
  });
});

describe("Technicals tab", () => {
  it("prints the price and its two averages with their distances, from /technicals", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^S&P 500/ });
    await waitFor(() => expect(card).toHaveTextContent("7,706"));
    // §12.7: the day's change is null while the 2026-09-22 close is missing, so no change is printed.
    expect(card).not.toHaveTextContent(/today|on Sep 2\d/);
    // §12.7 (Codex R-24): both averages read null across the missing Sep 22 close; the labels stay, awaiting.
    expect(card).toHaveTextContent(/50-day average\s*Awaiting refresh/);
    expect(card).toHaveTextContent(/200-day average\s*Awaiting refresh/);
    expect(card).not.toHaveTextContent(/price is [\d.]+% (above|below)/);
    expect(card.textContent?.replace(/\s+/g, " ")).toContain("Jul 1, 2025 — the 50-day crossed above the 200-day. This has happened 14 times before; the S&P was higher a month later 79% of the time. Reliable.");
    const chart = within(card).getByRole("img", { name: /with its 50-day and 200-day averages, 1Y/ });
    // §12.7, Codex R-25: the missing Sep 22 close breaks the S&P's line; it never bridges the slot.
    const line = [...chart.querySelectorAll("path")].find((p) => p.getAttribute("stroke") === DESK_ACCENTS.blue)!;
    expect(line.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    fireEvent.click(within(card).getByRole("button", { name: "3Y" }));
    expect(within(card).getByRole("img", { name: /3Y/ })).toBeInTheDocument();
  });

  it("lists the Ledger's S&P signals, the two RSI rows among them, with §3's note", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(within(card).getAllByRole("listitem")).toHaveLength(6));
    const rows = within(card).getAllByRole("listitem");
    // §3: the allowlist's order; the audit's real counts (14 golden crosses since the regime labels begin).
    // §12.3: one canonical label per slug, the catalog's, on every tab (v2 §19).
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["S&P golden cross", "S&P death cross", "RSI above 70", "RSI below 30", "S&P 20-day move over 2σ", "S&P 5-day move over 2σ"]);
    expect(rows[3].textContent?.replace(/\s+/g, " ")).toBe("RSI below 3045× since 1996 · up 73% · a month later +2.8%No edge");
    expect(rows[0].textContent?.replace(/\s+/g, " ")).toBe("S&P golden cross14× since 1996 · up 79% · a month later +2.7%Reliable");
    // §12.7: 252 XNYS sessions back, Sep 22, 2025.
    expect(card).toHaveTextContent(/1-year return\s*\+15\.1%\s*since Sep 22, 2025/);
    expect(card).toHaveTextContent(/Trend\s*Unavailable\s*since Sep 22, 2026/);
    expect(card).toHaveTextContent(/Last 20 days\s*−0\.3σ\s*on Sep 23/);
    expect(card.querySelector(".te-note")?.textContent).toBe("vs normal compares each study to its own baseline over its own sample.");
    expect(card.textContent).not.toMatch(/normal month|A normal month|survives resampling/);
  });

  it("Codex R-26: an absent allowlist is Awaiting refresh; an empty one is an empty panel", async () => {
    const { signals_allowlist: _a, ...noList } = technicals;
    void _a;
    stubDesk({ "/api/desk/technicals": () => noList });
    const one = renderTab();
    let card = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(card).toHaveTextContent("Awaiting refresh"));
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
    expect(card.querySelector(".te-note")).toBeNull();
    one.unmount();
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, signals_allowlist: [] }) });
    renderTab();
    card = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(card.querySelector(".te-sig-list")).not.toBeNull());
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
    expect([...card.querySelectorAll(".dk-await")].map((e) => e.textContent)).not.toContain("Awaiting refresh");
  });

  it("reads what protection costs from /technicals' vol block once served (§12.13's deferred shape), with its source line", async () => {
    stubDesk({ "/api/desk/technicals": servedTechnicals });
    renderTab();
    const card = await screen.findByRole("region", { name: "What protection costs right now" });
    await waitFor(() => expect(card).toHaveTextContent("+6.8 pts"));
    expect(card).toHaveTextContent("Puts are 6.8 vol points more expensive than calls.");
    // §12.0 serves a read only with a named rule; the §12.13 shape carries the trend's words and no read.
    expect(card).toHaveTextContent("Rising since June.");
    expect(card).not.toHaveTextContent("Investors are paying up");
    expect(card).toHaveTextContent("Options price 15.4% annual movement; the last 20 days delivered 11.9%.");
    expect(card).toHaveTextContent("15.4 · 16.8 · 17.5");
    // No band edges in §12.13's shape: the percentile in words, no Cheap / Typical / Expensive gauge.
    expect(card).toHaveTextContent("74th percentile of two years");
    expect(card).not.toHaveTextContent("Expensive");
    expect(card).toHaveTextContent("Source: EODHD options, one pull per close · live read, not scored (history from Q4 2023)");
  });

  it("shows seven sector bars from /technicals' sectors block once served, and opens all eleven under Advanced", async () => {
    stubDesk({ "/api/desk/technicals": servedTechnicals });
    renderTab();
    const card = await screen.findByRole("region", { name: /Sector leadership/ });
    const seven = await within(card).findByRole("list", { name: /top three/ });
    // §12.14 as served on the fixture store: the top three, the middle one, the bottom three.
    expect(within(seven).getAllByRole("listitem").map((li) => li.textContent?.slice(0, 4))).toEqual(["XLEE", "XLKT", "XLVH", "XLBM", "XLRE", "XLII", "XLUU"]);
    expect(card).toHaveTextContent("Energy and Technology leading; Industrials and Utilities lagging");
    expect(card).toHaveTextContent("60 sessions to Sep 23 · log returns ×100 · Yahoo");
    expect(within(seven).getAllByTitle("log return, ×100")).toHaveLength(7);
    fireEvent.click(within(card).getByTestId("dk-advanced"));
    expect(within(within(card).getByRole("list", { name: /All eleven/ })).getAllByRole("listitem")).toHaveLength(11);
  });

  it("the Risk card reads the drawdown from the one-year high and the 21-day realized vol (§14.2)", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Risk · drawdown and volatility/ });
    // The fixture's S&P has no Sep 22 close (the audit's §2.1): the realized vol needs 22 unbroken closes, so it says why.
    await waitFor(() => expect(card).toHaveTextContent("From 1-year high−1.2%"));
    expect(card).toHaveTextContent("high 7,799 on Aug 13");
    expect(card).toHaveTextContent("Realized vol needs the last 22 closes; one is missing.");
    // The S&P's 1-year return is on its Signals card.
    expect(card).not.toHaveTextContent("1-year return");
  });

  it("Codex R-01: a sector without a return is shown with why, never hidden, and the ends are among the sectors with data", async () => {
    const reason = "no close stored for 2026-09-23";
    const block = (technicals.sectors as { data: { leadership: { etf: string; rel_ret: number | null }[] } }).data;
    const xlk = { ...block.leadership.find((r) => r.etf === "XLK")!, rel_ret: null, ret: null, reason };
    const data = { ...block, leadership: [...block.leadership.filter((r) => r.etf !== "XLK"), xlk], ranked_n: 10, missing: [{ etf: "XLK", name: "Technology", reason }] };
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, sectors: { status: "ready", data, unavailable: null } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /^Sector leadership/ });
    const list = await within(card).findByRole("list", { name: /top three, middle and bottom three, then the sectors without data/ });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    expect(items[7]).toHaveTextContent(`XLKTechnot available · ${reason}`);
    expect(card).toHaveTextContent("Energy and Health care leading; Industrials and Utilities lagging, among the 10 sectors with data");
    expect(within(card).getByRole("note")).toHaveTextContent(`Not ranked, without data over the window: XLK Technology (${reason}).`);
  });

  it("the sectors block served awaiting a refresh keeps the card's title, prints the reason once and badges Awaiting refresh (§1.7)", async () => {
    const reason = "Awaiting refresh: the full refresh stores XLB, XLC, XLE, XLF, XLI, XLK, XLP, XLRE, XLU, XLV, XLY; this database predates it.";
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, sectors: { status: "awaiting", data: null, unavailable: { reason, until: null } } }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Sector leadership/ })).toHaveTextContent(reason));
    const sect = screen.getByRole("region", { name: /^Sector leadership/ });
    expect(within(sect).getAllByText(reason)).toHaveLength(1);
    expect(within(sect).getByTestId("dk-live")).toHaveTextContent("Awaiting refresh");
    expect(within(sect).queryByRole("list")).toBeNull();
  });

  it("the RSI card reads /technicals' RSI (§12.7): now, its zone and direction from the two served numbers, each zone's last session, the gauge", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    // The fixture's store has no Sep 22 close, so the RSI is held on Sep 21 and dated by its own badge (§1.6).
    await waitFor(() => expect(within(card).getByTestId("dk-live")).toHaveTextContent("Sep 21"));
    const [now, above, below] = within(card).getAllByText(/^(Now|Last above 70|Last below 30)$/).map((l) => l.parentElement as HTMLElement);
    expect(now).toHaveTextContent("59.3");
    expect(now).toHaveTextContent("neutral, rising");
    expect(above).toHaveTextContent("Jun 2");
    expect(above).toHaveTextContent(`S&P ${"\u2212"}1.7% 20 sessions later`);
    expect(below).toHaveTextContent("Mar 30");
    expect(below).toHaveTextContent("S&P +12.5% 20 sessions later");
    expect(within(card).getByRole("img", { name: "RSI 59.3, neutral" })).toBeInTheDocument();
    expect(card).not.toHaveTextContent("not computed");
  });

  it("an RSI the store cannot define says Awaiting refresh and draws no gauge; a zone never visited says so under its label", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, rsi: null, rsi_date: null, rsi_prev: null, rsi_prev_date: null, rsi_last_above_70: null }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent("Mar 30"));
    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).queryByTestId("dk-live")).toBeNull();
    expect(within(card).getAllByText("Awaiting refresh").length).toBeGreaterThanOrEqual(2);
  });

  it("the MACD card reads /technicals' macd (§12.7): the three values, the side, the last crossover and the 6M chart", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · MACD/ });
    // The fixture's store has no Sep 22 close, so the MACD is held on Sep 21 and dated by its own badge (§1.6).
    await waitFor(() => expect(within(card).getByTestId("dk-live")).toHaveTextContent("Sep 21"));
    const [line, signal, hist, cross] = within(card).getAllByText(/^(MACD|Signal|Histogram|Last crossover)$/).map((l) => l.parentElement as HTMLElement);
    expect(line).toHaveTextContent("+4.0");
    expect(signal).toHaveTextContent("+3.7");
    expect(hist).toHaveTextContent("+0.3");
    expect(hist).toHaveTextContent("MACD above its signal");
    expect(cross).toHaveTextContent("Sep 21");
    expect(cross).toHaveTextContent("MACD crossed above its signal");
    const chart = within(card).getByRole("img", { name: /^MACD, its signal line and the histogram, 6M; last crossover on / });
    const served = technicals.macd.series.filter((p) => p.hist != null).length;
    expect(chart.querySelectorAll("rect.dk-chart-bar")).toHaveLength(served);
    // The two sessions after the gap have no MACD: no bar is drawn for them.
    expect(technicals.macd.series.slice(-2).map((p) => p.hist)).toEqual([null, null]);
  });

  it("a MACD the store cannot define says Awaiting refresh and draws no chart", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, macd: null }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · MACD/ });
    await waitFor(() => expect(within(card).getAllByText("Awaiting refresh").length).toBeGreaterThanOrEqual(4));
    expect(within(card).queryByRole("img")).toBeNull();
    expect(within(card).queryByTestId("dk-live")).toBeNull();
  });

  it("a MACD that has never crossed its signal leaves the last crossover awaiting, the rest served", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, macd: { ...technicals.macd, last_cross: null } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · MACD/ });
    await waitFor(() => expect(card).toHaveTextContent("+4.0"));
    const cross = within(card).getByText("Last crossover").parentElement as HTMLElement;
    expect(cross).toHaveTextContent("Awaiting refresh");
    expect(within(card).getByRole("img", { name: "MACD, its signal line and the histogram, 6M" })).toBeInTheDocument();
  });

  it("the seasonality card reads /technicals' seasonality (§12.7): twelve months, their average, share up and years, the window", async () => {
    renderTab();
    const card = await screen.findByRole("region", { name: /^Seasonality · S&P 500 by calendar month/ });
    await waitFor(() => expect(card).toHaveTextContent("Average monthly return and share of years up, Feb 1990 to Aug 2026."));
    const table = within(card).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]);
    const nov = rows[10];
    expect(nov).toHaveTextContent("+2.2%");
    expect(nov).toHaveTextContent("75%");
    expect(nov).toHaveTextContent("36");
    expect(within(nov).getByText("36")).toHaveAttribute("title", "1990–2025");
    expect(rows[8]).toHaveTextContent(`${"\u2212"}0.7%`);
    // One bar a month, its side by the sign; the largest average (November) is the full half-width.
    const bars = [...table.querySelectorAll<HTMLElement>(".te-season-bar")];
    expect(bars).toHaveLength(12);
    expect(bars.filter((b) => b.dataset.sign === "down")).toHaveLength(2);
    expect(bars[10].style.width).toBe("50%");
    expect(card).toHaveTextContent("36–37 years a month · a month counts once it is complete");
    expect(card).toHaveTextContent("Source: asset_prices ^GSPC, monthly");
  });

  it("a seasonality the store cannot compute keeps its labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, seasonality: null }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /^Seasonality · S&P 500 by calendar month/ });
    await waitFor(() => expect(within(card).getAllByText("Awaiting refresh")).toHaveLength(3));
    for (const l of ["Average", "Up", "Years"]) expect(card).toHaveTextContent(l);
    expect(within(card).queryByRole("table")).toBeNull();
  });

  it("Codex R-08: a visit whose 20th session has no stored close says so, not that the sessions have not passed", async () => {
    stubDesk({
      "/api/desk/technicals": () => ({
        ...technicals,
        rsi_last_above_70: { ...technicals.rsi_last_above_70, after_20d: null, after_20d_status: "missing" },
        rsi_last_below_30: { ...technicals.rsi_last_below_30, after_20d: null, after_20d_to: null, after_20d_status: "pending" },
      }),
    });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent("Jun 2"));
    const [above, below] = within(card).getAllByText(/^(Last above 70|Last below 30)$/).map((l) => l.parentElement as HTMLElement);
    expect(above).toHaveTextContent("the close 20 sessions later (Jul 1) is not stored");
    expect(above).not.toHaveTextContent("have not passed");
    expect(below).toHaveTextContent("20 sessions have not passed yet");
  });

  it("a zone's last session within 20 sessions of the data says they have not passed yet", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, rsi_last_above_70: { date: "2026-09-15", rsi: 71.2, after_20d: null, after_20d_to: null } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent("Sep 15"));
    expect(card).toHaveTextContent("20 sessions have not passed yet");
  });

  it("/technicals serves the vol block awaiting and the sectors block ready: the vol column is the PROTOTYPE (§1.0.3), the sector card reads its bars", async () => {
    renderTab();
    // The cards remount from their loading state to the answered one: query them afresh.
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(vol).not.toHaveTextContent("needs stored SPY option snapshots");
    expect(within(vol).queryByTestId("dk-live")).toBeNull();
    expect(vol).toHaveTextContent("Illustrative values · In production: daily SPY chain snapshots from the EODHD options add-on, stored and versioned.");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    const sect = screen.getByRole("region", { name: /^Sector leadership/ });
    await waitFor(() => expect(within(sect).getByRole("list", { name: /top three/ })).toBeInTheDocument());
    expect(within(sect).getByTestId("dk-advanced")).toBeEnabled();
  });

  it("the PROTOTYPE vol column prints its illustrative numbers, and its Advanced opens the assumed volatilities (§1.0.3)", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("+6.8 pts");
    expect(vol).toHaveTextContent("Puts are 6.8 vol points dearer than calls.");
    // Black-Scholes at 19.2% and 12.4% vol, 30 days: the 25-delta strikes and what each costs.
    expect(vol).toHaveTextContent(/25Δ put\s*19\.2%\s*96\.7%\s*0\.84%/);
    expect(vol).toHaveTextContent(/25Δ call\s*12\.4%\s*102\.7%\s*0\.52%/);
    expect(vol).toHaveTextContent("15.4 vs 11.9");
    expect(vol).toHaveTextContent("74th percentile of two years");
    expect(vol).toHaveTextContent("Rising since June.");
    const adv = within(vol).getByTestId("dk-advanced");
    expect(adv).toBeEnabled();
    fireEvent.click(adv);
    expect(vol).toHaveTextContent("Black-Scholes on SPY, 30 days to expiry, a 4.10% rate and a 1.20% dividend yield");
    expect(vol).toHaveTextContent("78 of 105");
  });

  it("LAST 20 DAYS is the served σ on its own date, with no word (§3, §12.7 serve none)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, move_20d_date: null }) });
    renderTab();
    const signals = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(signals).toHaveTextContent("−0.3σ"));
    expect(signals).not.toHaveTextContent(/extreme move|on Sep 23/);
  });

  it("stays quiet while the first answers are on their way; the vol column waits for /technicals before it is the PROTOTYPE", async () => {
    stubDesk({ "/api/desk/technicals": () => new Promise(() => {}) });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    expect(vol).toHaveAttribute("aria-busy", "true");
    expect(vol).not.toHaveAttribute("data-prototype");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    expect(screen.getByRole("region", { name: /^S&P 500/ })).not.toHaveTextContent("Awaiting refresh");
  });

  it("a 200 answer without the block a card reads leaves that card awaiting, not broken", async () => {
    // The sectors block not served at all (no envelope, no reason) and a Ledger without its rows.
    const { sectors: _s, ...noSectors } = technicals;
    void _s;
    stubDesk({ "/api/desk/technicals": () => noSectors, "/api/desk/ledger": () => ({ as_of: "2026-09-22", generation_id: "g" }) });
    renderTab();
    const sect = await screen.findByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(sect).toHaveTextContent("Awaiting refresh"));
    const sig = screen.getByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(sig).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: /^S&P 500/ })).toHaveTextContent("7,706");
  });

  it("a failed /technicals keeps the vol and sector cards' labels and says Awaiting refresh (Codex R-03: never the PROTOTYPE)", async () => {
    stubDesk({ "/api/desk/technicals": deskError(503, "not wired") });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /Sector leadership/ })).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: /Sector leadership/ })).not.toHaveTextContent("XLK");
    await waitFor(() => expect(screen.getByRole("region", { name: "What protection costs right now" })).toHaveTextContent("Awaiting refresh"));
    expect(screen.getByRole("region", { name: "What protection costs right now" })).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(screen.getByRole("region", { name: "What protection costs right now" })).not.toHaveTextContent("6.8");
  });

  it("the vol column is the S&P's: /technicals naming another instrument draws no PROTOTYPE (§1.0.3)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, instrument: "ndx" }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("needs stored SPY option snapshots"));
    expect(screen.getByRole("region", { name: /^What protection costs right now/ })).not.toHaveAttribute("data-prototype");
  });
});

describe("routes served awaiting (§12.0, §1.0.2)", () => {
  it("the vol block served awaiting: the PROTOTYPE stands in its place (§1.0.3), without the reason or a badge", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveAttribute("data-prototype", "protection"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).not.toHaveTextContent("needs stored SPY option snapshots");
    expect(within(vol).queryByTestId("dk-live")).toBeNull();
  });
  it("a live vol block awaiting a refresh takes the column back: the LIVE card, its reason and its badge (§1.0.3 rule 6)", async () => {
    const refresh = { status: "awaiting", data: null, unavailable: { reason: "Awaiting refresh: this could not be computed from the current data.", until: null } };
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, vol: refresh }) });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("Awaiting refresh: this could not be computed from the current data."));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).not.toHaveAttribute("data-prototype");
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Awaiting refresh");
  });
  it("technicals served awaiting: the page badge and its three cards say Not yet served, no Ledger number beside them", async () => {
    stubDesk({ "/api/desk/technicals": deskAwaiting("no generation stored yet.") });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Signals/ })).toHaveTextContent("no generation stored yet."));
    // Codex R-03: a route served awaiting keeps the vol card too, with the route's reason; never the PROTOTYPE.
    expect(screen.getByRole("region", { name: /^What protection costs right now/ })).not.toHaveAttribute("data-prototype");
    for (const name of [/^S&P 500/, /^Signals/, /^What protection costs right now/, /^Sector leadership/]) {
      const card = screen.getByRole("region", { name });
      expect(within(card).getAllByText("no generation stored yet.")).toHaveLength(1);
      expect(card.textContent).not.toMatch(/\d+×|Reliable|No edge/);
    }
    // RSI is a /technicals field (§12.7): the route's reason, once, and no number.
    const rsi = screen.getByRole("region", { name: /^Momentum · RSI/ });
    expect(within(rsi).getAllByText("no generation stored yet.")).toHaveLength(1);
    expect(rsi.textContent).not.toMatch(/\d+\.\d/);
    // So is the MACD (desk/fill-compute).
    const macd = screen.getByRole("region", { name: /^Momentum · MACD/ });
    expect(within(macd).getAllByText("no generation stored yet.")).toHaveLength(1);
    expect(macd.textContent).not.toMatch(/\d+\.\d/);
    const season = screen.getByRole("region", { name: /^Seasonality/ });
    expect(within(season).getAllByText("no generation stored yet.")).toHaveLength(1);
    expect(season.textContent).not.toMatch(/\d+\.\d|%/);
    // §14.2: so is the Risk card (desk/usability).
    expect(within(screen.getByRole("region", { name: /^Risk · drawdown/ })).getAllByText("no generation stored yet.")).toHaveLength(1);
    expect(screen.getAllByTestId("dk-live")[0]).toHaveTextContent("Not yet served");
  });
});

describe("Codex R-03: the protection PROTOTYPE stands only in a ready answer's not-yet-served vol block", () => {
  const vol = () => screen.getByRole("region", { name: /^What protection costs right now/ });
  const illustrative = /\+6\.8 pts|0\.84%|96\.7%|74th percentile|Illustrative values/;

  it("/technicals served awaiting: the vol card keeps its labels and the route's reason, Not yet served; no illustrative figure", async () => {
    stubDesk({ "/api/desk/technicals": deskAwaiting("no generation stored yet.") });
    renderTab();
    await waitFor(() => expect(vol()).toHaveTextContent("no generation stored yet."));
    expect(vol()).not.toHaveAttribute("data-prototype");
    expect(vol()).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(within(vol()).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(vol().textContent).not.toMatch(illustrative);
  });

  it("/technicals failed: the vol card keeps its labels and says Awaiting refresh; no illustrative figure", async () => {
    stubDesk({ "/api/desk/technicals": deskError(503, "not wired") });
    renderTab();
    await waitFor(() => expect(vol()).toHaveTextContent("Awaiting refresh"));
    expect(vol()).not.toHaveAttribute("data-prototype");
    expect(vol()).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(vol().textContent).not.toMatch(illustrative);
  });

  it("a ready answer without the vol block: the vol card awaits a refresh; the PROTOTYPE needs the block served awaiting", async () => {
    const { vol: _v, ...noVol } = technicals as Record<string, unknown>;
    void _v;
    stubDesk({ "/api/desk/technicals": () => noVol });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^S&P 500/ })).toHaveTextContent("7,706"));
    await waitFor(() => expect(vol()).toHaveTextContent("Awaiting refresh"));
    expect(vol()).not.toHaveAttribute("data-prototype");
    expect(vol().textContent).not.toMatch(illustrative);
  });
});

describe("Technicals for any stock (§14.2)", () => {
  function renderAt(route: string) {
    return renderWithProviders(
      <Routes>
        <Route path="/desk/:page" element={<TechnicalsPage page={deskPageBySlug("technicals")!} />} />
      </Routes>,
      { route },
    );
  }

  it("a stock shows its price, averages and crosses not scored, its momentum and risk, and its strength against the S&P", async () => {
    const { calls } = stubDesk();
    renderAt("/desk/technicals?symbol=nvda");
    const price = await screen.findByRole("region", { name: /^NVDA · NVIDIA Corporation/ });
    await waitFor(() => expect(price).toHaveTextContent("Price226"));
    expect(price).toHaveTextContent("No 50-day and 200-day cross in the history served.");
    // Two years of daily bars: 6M and 1Y only; no chip that asks what is not served.
    expect(within(price).getAllByRole("button").map((b) => b.textContent)).toEqual(["6M", "1Y"]);
    // Main's RSI, MACD and seasonality cards read the stock's own figures (the shared functions), and name it.
    const rsi = screen.getByRole("region", { name: /^Momentum · RSI/ });
    expect(rsi).toHaveTextContent("is NVDA stretched, either way?");
    expect(rsi).toHaveTextContent("Now55.9");
    expect(rsi).toHaveTextContent("NVDA −12.9% 20 sessions later");
    expect(screen.getByRole("region", { name: /^Momentum · MACD/ })).toHaveTextContent("12, 26, 9 on NVDA's closes");
    expect(screen.getByRole("region", { name: /^Seasonality · NVDA by calendar month/ })).toBeInTheDocument();
    const risk = screen.getByRole("region", { name: /^Risk · drawdown and volatility/ });
    expect(risk).toHaveTextContent("21-day realized vol44.0%");
    expect(risk).toHaveTextContent("1-year return+23.1%");
    const rs = screen.getByRole("region", { name: /^Relative strength vs the S&P 500/ });
    expect(rs).toHaveTextContent("3-month change+8.3%");
    // The S&P-only cards are not drawn; one line says where the signals are scored.
    expect(screen.queryByRole("region", { name: /^Signals/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /^What protection costs/ })).toBeNull();
    expect(screen.queryByRole("region", { name: /^Sector leadership/ })).toBeNull();
    expect(screen.getByText(/Signals are scored on the S&P 500/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "→ view" })).toHaveAttribute("href", "/desk/technicals");
    expect(screen.getByTestId("te-add-basket")).toHaveAttribute("href", "/desk/basket-hedge?add=NVDA");
    expect(calls.some((c) => c === "GET /api/desk/technicals?symbol=NVDA")).toBe(true);
  });

  it("a stored ETF's cross is shown and labelled not scored", async () => {
    stubDesk();
    renderAt("/desk/technicals?symbol=GLD&range=3y");
    const price = await screen.findByRole("region", { name: /^GLD · SPDR Gold Shares/ });
    await waitFor(() => expect(price).toHaveTextContent("Jun 30, 2026 — the 50-day crossed below the 200-day."));
    expect(price).toHaveTextContent("Not scored: the engine scores crosses of the S&P 500 only.");
    expect(within(price).getByRole("button", { name: "3Y" })).toHaveAttribute("aria-pressed", "true");
    expect(price.querySelector("[data-verdict]")).toBeNull();
  });

  it("the S&P 500's spellings open the page's default", () => {
    expect(symbolOf("symbol=^GSPC")).toBeNull();
    expect(symbolOf("symbol=spx")).toBeNull();
    expect(symbolOf("symbol=brk.b")).toBe("BRK.B");
    expect(symbolOf("symbol=not a symbol")).toBeNull();
    expect(symbolOf("")).toBeNull();
  });

  it("a symbol the provider does not know keeps the cards' labels", async () => {
    stubDesk();
    renderAt("/desk/technicals?symbol=ZZZZ");
    const risk = await screen.findByRole("region", { name: /^Risk · drawdown and volatility/ });
    await waitFor(() => expect(risk).toHaveTextContent("Awaiting refresh"));
    for (const l of ["From 1-year high", "21-day realized vol", "1-year return"]) expect(risk).toHaveTextContent(l);
    expect(screen.getByRole("region", { name: /^Momentum · RSI/ })).toHaveTextContent(/Now\s*Awaiting refresh/);
  });
});
