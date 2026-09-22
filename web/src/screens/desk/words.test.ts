import { describe, expect, it } from "vitest";
import { BANNED_WORDS } from "./positions/gate";
import { moveInWords, oddsInWords, sessionsInWords, timesInTen } from "./words";

const banned = new RegExp(`\\b(${BANNED_WORDS.join("|")})\\b`, "i");

describe("numbers as words", () => {
  it("says about N times in ten", () => {
    expect(timesInTen(0.61)).toBe("about six times in ten");
    expect(timesInTen(0.5)).toBe("about half the time");
    expect(timesInTen(0.02)).toBe("fewer than one time in twenty");
    expect(timesInTen(0.97)).toBe("more than nineteen times in twenty");
    expect(timesInTen(null)).toBe("no reading");
  });
  it("sizes a move with a closed vocabulary and the unit", () => {
    expect(moveInWords(1.1, "%")).toBe("a modest gain of about 1.1%");
    expect(moveInWords(-0.4, "%")).toBe("a small loss of about 0.4%");
    expect(moveInWords(0.05, "%")).toBe("roughly flat");
    expect(moveInWords(-22, "bp")).toBe("a sizeable fall of about 22 bp");
    expect(moveInWords(-55, "bp")).toBe("a large fall of about 55 bp");
    expect(oddsInWords(0.116)).toBe("about one in ten");
    expect(sessionsInWords(20)).toBe("20 sessions");
    expect(sessionsInWords(5)).toBe("5 sessions");
    expect(sessionsInWords(1)).toBe("one session");
  });
  it("never uses a word the language check flags", () => {
    const samples = [0, 0.01, 0.1, 0.5, 0.9, 0.99, 1].flatMap((p) => [timesInTen(p), oddsInWords(p)]);
    samples.push(moveInWords(0, "%"), moveInWords(50, "%"), moveInWords(-500, "bp"));
    for (const s of samples) expect(s, s).not.toMatch(banned);
  });
});
