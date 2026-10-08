/**
 * fix/site-audit D7 follow-up: in the 30 minutes after the open the drawer's
 * intraday row shows the server's word, "Awaiting opening bars", in the neutral
 * tone, instead of a green "current"; every other row shows its verdict.
 */
import { describe, expect, it } from "vitest";
import type { SlaRow } from "../../api/types";
import { verdictCell } from "./FreshnessDrawer";

const sla = (r: Partial<SlaRow>): SlaRow => ({ feed: "market_intraday", latest: null, expected: null, verdict: "current", reason: "", ...r });

describe("verdictCell", () => {
  it("prints the server's word in the neutral tone when one is served", () => {
    const cell = verdictCell(sla({ word: "Awaiting opening bars" }));
    expect(cell.word).toBe("Awaiting opening bars");
    expect(cell.color).toBe("var(--text-2)");
  });
  it("prints the D4 grace's word in the neutral tone over a delayed verdict (fix/site-audit D-c)", () => {
    const cell = verdictCell(sla({ feed: "market_daily", verdict: "delayed", word: "Awaiting daily refresh" }));
    expect(cell).toMatchObject({ word: "Awaiting daily refresh", color: "var(--text-2)" });
  });
  it("prints the verdict otherwise, in its own color", () => {
    expect(verdictCell(sla({}))).toMatchObject({ word: "current", color: "var(--pos)" });
    expect(verdictCell(sla({ feed: "news", verdict: "delayed" }))).toMatchObject({ word: "delayed", color: "var(--amber)" });
    expect(verdictCell(sla({ verdict: "bogus" as never }))).toMatchObject({ word: "unavailable" });
  });
});
