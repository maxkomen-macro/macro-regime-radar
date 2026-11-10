/**
 * The Positioning card's words and numbers (§12.20, Desk P4): every figure is the server's, a value that is not a
 * finite number prints "—" (never NaN), and a missing date or range says why in the server's words.
 * Driven by the served fixture (invented filings and reports, web/src/fixtures/desk/PROVENANCE.md).
 */
import { describe, expect, it } from "vitest";
import fixture from "../../../fixtures/desk/positioning.json";
import type { CotMarket, PositioningHoldings } from "../data/types";
import {
  changeText,
  contracts,
  datesLine,
  holdersChange,
  holdingsFor,
  holdingsReadLine,
  percentileText,
  rangeLine,
  shareOfOi,
  sharePoints,
  sideWord,
} from "./positioning";

const markets = fixture.futures.markets as unknown as CotMarket[];
const holdings = fixture.holdings as unknown as PositioningHoldings;
const spx = markets.find((m) => m.key === "spx")!;
const NOT_FINITE = [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];

describe("Positioning figures", () => {
  it("contracts carry a sign and thousands commas; zero is unsigned", () => {
    expect(contracts(12340)).toBe("+12,340");
    expect(contracts(-372318)).toBe("−372,318");
    expect(contracts(0)).toBe("0");
  });

  it("a share of open interest and its change keep one decimal, and a value that rounds to zero is unsigned", () => {
    expect(shareOfOi(12.44)).toBe("+12.4%");
    expect(shareOfOi(-18.66)).toBe("−18.7%");
    expect(shareOfOi(-0.04)).toBe("0.0%");
    expect(sharePoints(1.26)).toBe("+1.3 pts");
    expect(sharePoints(-0.44)).toBe("−0.4 pts");
    expect(sharePoints(0.04)).toBe("0.0 pts");
  });

  it("a value that is not a finite number prints a dash, never NaN or Infinity", () => {
    for (const x of NOT_FINITE) {
      expect(contracts(x as number)).toBe("—");
      expect(shareOfOi(x as number)).toBe("—");
      expect(sharePoints(x as number)).toBe("—");
      expect(sideWord(x as number)).toBe("Flat");
    }
  });

  it("the side follows the net's sign only", () => {
    expect(sideWord(1)).toBe("Net long");
    expect(sideWord(-1)).toBe("Net short");
    expect(sideWord(0)).toBe("Flat");
  });
});

describe("a market's report", () => {
  it("the percentile is the server's, rounded to an ordinal; none served reads a dash", () => {
    expect(percentileText(spx)).toBe(`${Math.round(spx.range_3y!.percentile)}th`);
    expect(percentileText({ ...spx, range_3y: null })).toBe("—");
    expect(percentileText({ ...spx, range_3y: { ...spx.range_3y!, percentile: Number.NaN } })).toBe("—");
  });

  it("the dates line prints the positions date and the release date, and says when a holiday delayed it", () => {
    expect(datesLine(spx)).toBe("Positions Sep 15 · released Sep 18");
    expect(datesLine({ ...spx, release_delayed: true })).toBe("Positions Sep 15 · released Sep 18 (holiday delay)");
  });

  it("with no scheduled release date, the dates line prints the schedule's own note instead", () => {
    const note = "release date not in the CFTC's published schedule";
    expect(datesLine({ ...spx, released: null, release_note: note })).toBe(`Positions Sep 15 · ${note}`);
  });

  it("the week's change is the served change of the share; with none served it reads a dash", () => {
    expect(changeText(spx)).toBe(sharePoints(spx.change_1w!.net_pct_oi));
    expect(changeText({ ...spx, change_1w: null })).toBe("—");
  });

  it("with no three-year range, the Advanced line gives the server's reason, or says it was not served", () => {
    expect(rangeLine({ ...spx, range_3y: null, range_reason: "fewer than 104 reports stored" })).toBe(
      `${spx.label}: no three-year range: fewer than 104 reports stored.`,
    );
    expect(rangeLine({ ...spx, range_3y: null, range_reason: null })).toBe(`${spx.label}: no three-year range: not served.`);
    expect(rangeLine(spx)).toContain(`of ${spx.range_3y!.n} weekly reports`);
  });
});

describe("the basket's 13F holders", () => {
  it("rows come in the basket's order; a name without a row carries the server's reason, or a stated default", () => {
    const { rows, missing } = holdingsFor(holdings, ["AVGO", "CRWV", "NVDA", "ZZZZ"]);
    expect(rows.map((r) => r.symbol)).toEqual(["AVGO", "NVDA"]);
    expect(missing).toEqual([
      { symbol: "CRWV", reason: holdings.excluded.find((x) => x.symbol === "CRWV")!.reason },
      { symbol: "ZZZZ", reason: "not served for this basket" },
    ]);
  });

  it("the holders' change is signed, and a change the server could not compute reads a dash", () => {
    const nvda = holdings.names.find((n) => n.symbol === "NVDA")!;
    expect(holdersChange(nvda)).toBe(contracts(nvda.holders_change));
    expect(holdersChange({ ...nvda, holders_change: null })).toBe("—");
  });

  it("the read line names the quarter, the amendments applied and the files read, and never mentions a set-aside count", () => {
    const line = holdingsReadLine(holdings);
    expect(line).toContain("250 holdings reports and amendments for Jun 30, 2026 from 240 filers");
    expect(line).toContain("6 restatements applied and 4 new-holdings amendments added");
    expect(line).toContain("The change is against Mar 31, 2026.");
    for (const f of [...holdings.data_sets, ...holdings.ftd_files]) expect(line).toContain(f);
    expect(line).not.toMatch(/set aside/i);
  });

  it("with no quarter before stored, the read line gives the server's reason, or says it is not stored", () => {
    expect(holdingsReadLine({ ...holdings, previous_period: null, previous_reason: "the 2026-03-31 quarter refused a row" })).toContain(
      "No change: the 2026-03-31 quarter refused a row.",
    );
    expect(holdingsReadLine({ ...holdings, previous_period: null, previous_reason: null })).toContain(
      "No change: the quarter before is not stored.",
    );
  });
});
