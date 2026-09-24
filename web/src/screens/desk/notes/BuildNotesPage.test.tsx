/**
 * Build Notes (DESK_FRAME3_SPEC §11): the page renders docs/desk/BUILD_NOTES.md
 * (its title, lead and `##` sections, the contents list from those sections),
 * adds only §11's byline and the source line, and holds any sentence that uses
 * a word the Desk never prints. A build without the file says so.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import DeskShell from "../DeskShell";
import { renderWithProviders } from "../../../test/utils";
import { stubDesk } from "../../../test/desk";
import { deskPageBySlug } from "../desk-sections";
import { BuildNotesView, NOTES_MD } from "./BuildNotesPage";
import { HELD_HEADING, HELD_MARK, holdBanned, readNotes, sentences } from "./notes";

function renderTab(route = "/desk/build-notes") {
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
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const TWO = "*(two sentences held: they use a word the Desk does not print)*";

describe("Build Notes reading", () => {
  it("splits a file into its title, lead and sections", () => {
    const n = readNotes("# Notes\n\nA lead.\n\n## What this is\nOne.\n\nTwo.\n\n## What I'd build next\nThree.\n");
    expect(n.title).toBe("Notes");
    expect(n.lead).toBe("A lead.");
    expect(n.sections.map((s) => [s.id, s.title, s.body])).toEqual([
      ["bn-what-this-is", "What this is", "One.\n\nTwo."],
      ["bn-what-id-build-next", "What I'd build next", "Three."],
    ]);
    expect(n.held).toBe(0);
  });
  it("holds only the sentences that use a word the Desk never prints; a run of them is one marker", () => {
    expect(holdBanned("It leans. It is not established. It is fine.\n\nNothing significant here.")).toEqual({ text: `It leans. ${HELD_MARK} It is fine.\n\n${HELD_MARK}`, held: 2 });
    expect(holdBanned("A. Not established. Not significant either. B.")).toEqual({ text: `A. ${TWO} B.`, held: 2 });
    expect(holdBanned("It is ESTABLISHED. Fine.").text).toBe(`${HELD_MARK} Fine.`);
  });
  it("holds a word inside emphasis, and leaves other words and decimals alone", () => {
    expect(holdBanned("It is _established_. Fine.").text).toBe(`${HELD_MARK} Fine.`);
    expect(holdBanned("It is __significant__. Fine.").text).toBe(`${HELD_MARK} Fine.`);
    for (const ok of ["An insignificant gap.", "The establishment view.", "It moved significantly.", "Up 1.8 points. Fine."]) expect(holdBanned(ok)).toEqual({ text: ok, held: 0 });
  });
  it("ends a sentence after closing quotes and emphasis, never after an abbreviation", () => {
    expect(holdBanned('He called it "established." Then it moved.').text).toBe(`${HELD_MARK} Then it moved.`);
    expect(holdBanned("**Not established.** Next one.").text).toBe(`${HELD_MARK} Next one.`);
    expect(sentences("Rates, e.g. the 10-year, fell. Next.")).toEqual(["Rates, e.g. the 10-year, fell.", "Next."]);
    expect(sentences("The U.S. curve is flat. Next.")).toEqual(["The U.S. curve is flat.", "Next."]);
    expect(holdBanned("Data from the U.S. is established. Next.").text).toBe(`${HELD_MARK} Next.`);
    // An abbreviation that ends a sentence does not swallow the next one (R2-6).
    expect(sentences("It closed at 4 p.m. The regime changed later.")).toEqual(["It closed at 4 p.m.", "The regime changed later."]);
    expect(holdBanned("It closed at 4 p.m. The regime was established later.").text).toBe(`It closed at 4 p.m. ${HELD_MARK}`);
    expect(holdBanned("John F. Kennedy is established. Next.").text).toBe(`${HELD_MARK} Next.`);
  });
  it("drops emphasis a hold would cut in two, so no asterisk prints (R2-7)", () => {
    expect(holdBanned("*Leans. Not established. Fine.* After.").text).toBe(`Leans. ${HELD_MARK} Fine. After.`);
    expect(holdBanned("**Bold start. Established end.** After.").text).toBe(`Bold start. ${HELD_MARK} After.`);
    expect(holdBanned("Keep *this* and snake_case. Fine.").text).toBe("Keep *this* and snake_case. Fine.");
  });
  it("holds a wrapped paragraph's whole sentence, a list item inside its marker, a heading in place", () => {
    expect(holdBanned("It leans positive, but\nthe read is not established. Fine.").text).toBe(`${HELD_MARK} Fine.`);
    expect(holdBanned("- One.\n- Not significant. Two.\n- Three.").text).toBe(`- One.\n- ${HELD_MARK} Two.\n- Three.`);
    expect(holdBanned("1. Not established.\n2. Fine.").text).toBe(`1. ${HELD_MARK}\n2. Fine.`);
    // A wrapped item is joined into its item, held or not, so the renderer keeps one list (R2-5).
    expect(holdBanned("1. First item runs on\n   to a second line.\n2. Second item\nwraps without indent.").text).toBe("1. First item runs on to a second line.\n2. Second item wraps without indent.");
    expect(holdBanned("- The read leans but the case is not\n  established. Fine.").text).toBe(`- ${HELD_MARK} Fine.`);
    expect(holdBanned("### Why it is established\nBody.")).toEqual({ text: `### ${HELD_HEADING}\nBody.`, held: 1 });
    expect(holdBanned("```\nok\nestablished\n```").text).toBe("```\nok\n(one line held: it uses a word the Desk does not print)\n```");
  });
  it("a held heading keeps its section, a held title stays a title, repeated titles get their own ids", () => {
    const n = readNotes("# Nothing established\n\nLead.\n\n## Why nothing is significant\nBody A.\n\n## Next\nB.\n\n## Next\nC.\n");
    expect(n.title).toBe(HELD_HEADING);
    expect(n.lead).toBe("Lead.");
    expect(n.sections.map((s) => [s.title, s.body])).toEqual([
      [HELD_HEADING, "Body A."],
      ["Next", "B."],
      ["Next", "C."],
    ]);
    expect(n.sections.map((s) => s.id)).toEqual(["bn-heading-held-it-uses-a-word-the-desk-does-not-print", "bn-next", "bn-next-2"]);
    expect(n.held).toBe(2);
  });
  it("a `##` inside a code fence is code, not a section (R2-9)", () => {
    const n = readNotes("# T\n\n## One\n```\n## not a section\n```\n## Two\nx");
    expect(n.sections.map((s) => s.title)).toEqual(["One", "Two"]);
    expect(n.sections[0].body).toBe("```\n## not a section\n```");
  });
  it("an empty file is no title, no lead, no sections", () => {
    expect(readNotes("")).toEqual({ title: null, lead: "", sections: [], held: 0 });
    expect(readNotes("Just a paragraph.\n\n## One\nx").title).toBeNull();
  });
});

/** The file's blocks as a reader sees them, parsed without ./notes.ts:
 * paragraphs joined, list items one by one, heading text, emphasis marks gone. */
function fileBlocks(md: string): string[] {
  const plain = (t: string) =>
    t
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\*\*|`/g, "")
      .replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s.,;:!?)]|$)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  return md
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .flatMap((b) => {
      const lines = b.split("\n").filter((l) => l.trim());
      if (!lines.length) return [];
      if (/^#{1,4}\s/.test(lines[0])) return [plain(lines[0].replace(/^#{1,4}\s+/, "")), ...(lines.length > 1 ? [plain(lines.slice(1).join(" "))] : [])];
      // A list: each marker line starts an item, and the lines after it continue it.
      if (/^\s*(?:[-*•]|\d+[.)])\s+/.test(lines[0]))
        return lines
          .reduce<string[]>((items, l) => (/^\s*(?:[-*•]|\d+[.)])\s+/.test(l) ? [...items, l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")] : [...items.slice(0, -1), `${items[items.length - 1]} ${l}`]), [])
          .map(plain);
      return [plain(lines.join(" "))];
    });
}

describe("Build Notes tab", () => {
  it("reads the repo's file, whose holds are the ones the report records", () => {
    expect(NOTES_MD.length).toBeGreaterThan(500);
    const n = readNotes(NOTES_MD);
    expect(n.sections.length).toBeGreaterThan(2);
    // FRAME3_REPORT.md §10 quotes the two held sentences: when the file's holds change, so does that section.
    expect(n.held, "BUILD_NOTES.md's held sentences changed: update FRAME3_REPORT.md §10 and this count").toBe(2);
  });

  it("renders the file: contents from its sections, the byline, the source line, every block in order", async () => {
    renderTab();
    const article = await screen.findByRole("article");
    const n = readNotes(NOTES_MD);
    expect(within(article).getByRole("heading", { level: 2 })).toHaveTextContent(n.title ?? "Build Notes");
    expect(article).toHaveTextContent("Max Komen · September 2026");
    const toc = screen.getByRole("navigation", { name: "Contents" });
    expect(within(toc).getAllByRole("link").map((a) => a.textContent)).toEqual(n.sections.map((s) => s.title));
    expect(within(toc).getAllByRole("link")[0]).toHaveAttribute("href", `#${n.sections[0].id}`);
    for (const s of n.sections) expect(within(article).getByRole("heading", { level: 3, name: s.title })).toBeInTheDocument();
    expect(screen.getByText("Rendered from docs/desk/BUILD_NOTES.md · same file in the repo")).toBeInTheDocument();
    expect(document.querySelector(".dk")?.textContent).not.toMatch(/(?<![\p{L}\p{N}])(established|significant)(?![\p{L}\p{N}])/iu);
    // Every block of the file without a held word, in the file's order.
    const text = (article.textContent ?? "").replace(/\s+/g, " ");
    let at = 0;
    const blocks = fileBlocks(NOTES_MD).filter((b) => !/(?<![\p{L}\p{N}])(established|significant)(?![\p{L}\p{N}])/iu.test(b));
    expect(blocks.length).toBeGreaterThan(15);
    for (const b of blocks) {
      const i = text.indexOf(b, at);
      expect(i, b.slice(0, 60)).toBeGreaterThanOrEqual(at);
      at = i + b.length;
    }
  });

  it("marks the section a reader jumps to, from the list or on arrival by #section", async () => {
    const { unmount } = renderTab();
    const toc = await screen.findByRole("navigation", { name: "Contents" });
    const links = within(toc).getAllByRole("link");
    expect(links[0]).toHaveAttribute("aria-current", "location");
    fireEvent.click(links[2]);
    expect(links[2]).toHaveAttribute("aria-current", "location");
    expect(links[0]).not.toHaveAttribute("aria-current");
    unmount();
    const id = readNotes(NOTES_MD).sections[1].id;
    renderTab(`/desk/build-notes#${id}`);
    const toc2 = await screen.findByRole("navigation", { name: "Contents" });
    expect(within(toc2).getAllByRole("link")[1]).toHaveAttribute("aria-current", "location");
  });

  it("a build without the file says so, and a file without a title takes the tab's name", () => {
    const page = deskPageBySlug("build-notes")!;
    const { unmount } = renderWithProviders(<BuildNotesView page={page} md="" />, { route: "/desk/build-notes" });
    expect(screen.getByRole("status")).toHaveTextContent("Awaiting the notes file: docs/desk/BUILD_NOTES.md is not in this build.");
    expect(screen.queryByRole("navigation", { name: "Contents" })).toBeNull();
    expect(screen.queryByText(/Rendered from docs\/desk\/BUILD_NOTES\.md/)).toBeNull();
    unmount();
    renderWithProviders(<BuildNotesView page={page} md={"Lead only.\n\n## One\nBody."} />, { route: "/desk/build-notes" });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Build Notes");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("a malformed #… is no section, and a section titled like a fixed id keeps its own (R2-1, R2-8)", () => {
    const page = deskPageBySlug("build-notes")!;
    renderWithProviders(<BuildNotesView page={page} md={"# Notes\n\n## Title\nA.\n\n## Title h\nB.\n\n## Title\nC."} />, { route: "/desk/build-notes#%E0%A4%A" });
    expect(screen.getByRole("article")).toHaveAccessibleName("Notes");
    expect(screen.getAllByRole("region").map((r) => r.getAttribute("aria-label") ?? r.textContent?.slice(0, 7))).toHaveLength(3);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(within(screen.getByRole("navigation", { name: "Contents" })).getAllByRole("link")[0]).toHaveAttribute("aria-current", "location");
  });
});
