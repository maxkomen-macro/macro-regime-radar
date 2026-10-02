/**
 * desk/usability §14.6: every Desk page says what it is for in one plain line under its title, fifteen words at
 * most, and declares the one action its header shows (Event Study's obvious action is Run, Data Pipeline's the
 * CSV export, both in the page).
 */
import { describe, expect, it } from "vitest";
import { DESK_PAGES } from "./desk-sections";

const words = (s: string) => s.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

describe("the Desk's pages (§14.6)", () => {
  // The owner kept desk/prototypes' wording for Data Pipeline's line at the rebase (2026-09-28): three short
  // sentences on where each number comes from, one line on the page.
  const OWNER_WORDING = new Set(["data-pipeline"]);

  it("each has a one-line purpose of fifteen words or fewer", () => {
    for (const p of DESK_PAGES) {
      expect(p.blurb.trim(), p.slug).not.toBe("");
      if (!OWNER_WORDING.has(p.slug)) expect(words(p.blurb), `${p.slug}: ${p.blurb}`).toBeLessThanOrEqual(15);
      expect(p.blurb, p.slug).not.toMatch(/\n/);
    }
  });

  it("each declares its one header action, but for the two whose action is in the page", () => {
    const inPage = new Set(["data-pipeline"]);
    for (const p of DESK_PAGES) if (!inPage.has(p.slug)) expect(p.action, p.slug).toBeTruthy();
  });

  it("Codex R-17: Data Pipeline names the VIX tile's source as the relay's delayed quote", () => {
    const blurb = DESK_PAGES.find((p) => p.slug === "data-pipeline")?.blurb ?? "";
    expect(blurb).toContain("Every live number comes from stored data except the VIX tile, which shows the relay's delayed quote");
    // desk/pdf-polish item 2e: the tile no longer prints a band word, so the line names only the gap.
    expect(blurb).toContain("the VIX tile's gap against that quote");
  });
});
