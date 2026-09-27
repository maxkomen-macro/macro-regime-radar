/**
 * Technicals (DESK_FRAME3_SPEC §3) against the §12.7, §12.9, §12.10 and §12.4
 * fixtures: every number is a served field, the signals are the Ledger's S&P
 * group in the Ledger's order, the sector card shows the top three, the
 * middle one and the bottom three, and a card whose endpoint fails keeps its
 * labels and says "Awaiting refresh" (§1.7, §12.9: vol is not wired yet).
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
import { aboveBelow, allowlistRows, dayInYear, dayMove, macdCrossWords, macdSide, monthTicks, quarterOf, rsiDirection, rsiZone, sevenOf, trendWord } from "./TechnicalsPage";
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

  it("a zone's last session within 20 sessions of the data says they have not passed yet", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, rsi_last_above_70: { date: "2026-09-15", rsi: 71.2, after_20d: null, after_20d_to: null } }) });
    renderTab();
    const card = await screen.findByRole("region", { name: /Momentum · RSI/ });
    await waitFor(() => expect(card).toHaveTextContent("Sep 15"));
    expect(card).toHaveTextContent("20 sessions have not passed yet");
  });

  it("/technicals serves the vol block awaiting (its card keeps its labels and prints its §12.7 reason once) and the sectors block ready", async () => {
    renderTab();
    // The card remounts from its loading state to the unavailable one: query it afresh.
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("needs stored SPY option snapshots and a versioned skew method."));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
    const sect = screen.getByRole("region", { name: /^Sector leadership/ });
    await waitFor(() => expect(within(sect).getByRole("list", { name: /top three/ })).toBeInTheDocument());
    expect(within(sect).getByTestId("dk-advanced")).toBeEnabled();
  });

  it("LAST 20 DAYS is the served σ on its own date, with no word (§3, §12.7 serve none)", async () => {
    stubDesk({ "/api/desk/technicals": () => ({ ...technicals, move_20d_date: null }) });
    renderTab();
    const signals = await screen.findByRole("region", { name: /^Signals/ });
    await waitFor(() => expect(signals).toHaveTextContent("−0.3σ"));
    expect(signals).not.toHaveTextContent(/extreme move|on Sep 23/);
  });

  it("stays quiet while the first answers are on their way", async () => {
    stubDesk({ "/api/desk/technicals": () => new Promise(() => {}) });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    expect(vol).toHaveAttribute("aria-busy", "true");
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

  it("a failed /technicals keeps the vol and sector cards' labels and says Awaiting refresh", async () => {
    stubDesk({ "/api/desk/technicals": deskError(503, "not wired") });
    renderTab();
    const vol = await screen.findByRole("region", { name: "What protection costs right now" });
    await waitFor(() => expect(vol).toHaveTextContent("Awaiting refresh"));
    expect(vol).toHaveTextContent("PUTS vs CALLS · 1 MONTH OUT");
    expect(vol).not.toHaveTextContent("6.8");
    const sect = screen.getByRole("region", { name: /Sector leadership/ });
    await waitFor(() => expect(sect).toHaveTextContent("Awaiting refresh"));
    expect(sect).not.toHaveTextContent("XLK");
  });
});

describe("routes served awaiting (§12.0, §1.0.2)", () => {
  it("the vol block served awaiting: the card keeps its labels, prints the reason once and says Not yet served", async () => {
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^What protection costs right now/ })).toHaveTextContent("needs stored SPY option snapshots"));
    const vol = screen.getByRole("region", { name: /^What protection costs right now/ });
    expect(within(vol).getAllByText(/needs stored SPY option snapshots/)).toHaveLength(1);
    expect(within(vol).getByTestId("dk-live")).toHaveTextContent("Not yet served");
    expect(vol).not.toHaveTextContent("Awaiting refresh");
  });
  it("technicals served awaiting: the page badge and its three cards say Not yet served, no Ledger number beside them", async () => {
    stubDesk({ "/api/desk/technicals": deskAwaiting("no generation stored yet.") });
    renderTab();
    await waitFor(() => expect(screen.getByRole("region", { name: /^Signals/ })).toHaveTextContent("no generation stored yet."));
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
    expect(screen.getAllByTestId("dk-live")[0]).toHaveTextContent("Not yet served");
  });
});
