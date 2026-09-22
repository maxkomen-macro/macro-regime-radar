/**
 * `lib/sentences.ts` (Iteration 1, N4): the splitter behind the News cards'
 * four-sentence AI read. Abbreviations, initials, decimals and citation runs
 * never end a sentence; nothing is lost in the split.
 */
import { describe, expect, it } from "vitest";
import { splitSentences, takeSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits on terminal punctuation followed by a capital, a digit or an opening quote", () => {
    expect(splitSentences("Growth holds up. Inflation cools! Is the Fed done? 2026 says maybe.")).toEqual([
      "Growth holds up.",
      "Inflation cools!",
      "Is the Fed done?",
      "2026 says maybe.",
    ]);
  });

  it("keeps abbreviations, initials and decimals inside their sentence", () => {
    const text = "U.S. Treasury yields rose 2.9% after J. Powell spoke. The Dec. meeting matters, e.g. for cuts. Markets agree.";
    expect(splitSentences(text)).toEqual(["U.S. Treasury yields rose 2.9% after J. Powell spoke.", "The Dec. meeting matters, e.g. for cuts.", "Markets agree."]);
  });

  it("keeps citation markers and closing quotes with the sentence they close", () => {
    expect(splitSentences('Futures priced one cut.[1][2] The statement read "patient." Traders sold.')).toEqual([
      "Futures priced one cut.[1][2]",
      'The statement read "patient."',
      "Traders sold.",
    ]);
  });

  it("never drops text: the pieces join back to the collapsed input", () => {
    const text = "  One  sentence\n without an end   and a second? Yes.  ";
    expect(splitSentences(text).join(" ")).toBe("One sentence without an end and a second? Yes.");
  });

  it("returns nothing for empty input", () => {
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences(null)).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
  });
});

describe("takeSentences", () => {
  it("returns the first n sentences and the remainder", () => {
    expect(takeSentences("A one. B two. C three.", 2)).toEqual({ shown: "A one. B two.", rest: "C three.", shownCount: 2 });
    expect(takeSentences("A one.", 4)).toEqual({ shown: "A one.", rest: "", shownCount: 1 });
    expect(takeSentences("A one. B two.", 0)).toEqual({ shown: "", rest: "A one. B two.", shownCount: 0 });
  });
});
