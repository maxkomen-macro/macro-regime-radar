/**
 * The Desk's formatters against Python's own strings (review R-03). The
 * fixture is written by scripts/desk_format_fixture.py from the engine's
 * fmt_move and Python's format for every move, bound and share in the saved
 * engine payloads plus exact ties, near-ties, negative zero, a subnormal and
 * large values. A move is scaled here exactly as the adapter scales it (×100
 * for a return), so the double formatted is the double Python formatted. The
 * page's minus is U+2212 where Python prints "-"; nothing else may differ.
 */
import { describe, expect, it } from "vitest";
import py from "./event-study/__fixtures__/py-format.json";
import { fmtBound, fmtMove, fmtShare } from "./event-study/format";
import { pyFixed, pyRound, pySigned } from "./pyformat";

const fixture = py as unknown as { pct: [number, string][]; bp: [number, string][]; share: [number, string][]; fixed: [number, number, string, string][] };
const ascii = (s: string) => s.replace(/−/g, "-");

describe("Python-compatible formatting", () => {
  it("moves in percent match the engine's fmt_move for every double", () => {
    const bad = fixture.pct.filter(([x, s]) => ascii(fmtMove(x * 100, "%")) !== s || ascii(fmtBound(x * 100, "%")) !== s);
    expect(bad.map(([x, s]) => `${x}: py ${s} ts ${fmtMove(x * 100, "%")}`)).toEqual([]);
    expect(fixture.pct.length).toBeGreaterThan(100);
  });

  it("moves and bounds in bp match, ties to even included", () => {
    const bad = fixture.bp.filter(([x, s]) => ascii(fmtMove(x, "bp")) !== s || ascii(fmtBound(x, "bp")) !== s);
    expect(bad.map(([x, s]) => `${x}: py ${s} ts ${fmtMove(x, "bp")}`)).toEqual([]);
    expect(ascii(fmtMove(2.5, "bp"))).toBe("+2 bp");
    expect(ascii(fmtMove(3.5, "bp"))).toBe("+4 bp");
    expect(ascii(fmtMove(-0, "bp"))).toBe("-0 bp");
  });

  it("shares print as Python prints x × 100 to a whole percent", () => {
    const bad = fixture.share.filter(([x, s]) => fmtShare(x) !== s);
    expect(bad.map(([x, s]) => `${x}: py ${s} ts ${fmtShare(x)}`)).toEqual([]);
  });

  it("the fixed-point core matches format(x, '.Nf') and '+.Nf'", () => {
    const bad = fixture.fixed.filter(([x, dp, abs, signed]) => pyFixed(x, dp) !== abs || ascii(pySigned(x, dp)) !== signed);
    expect(bad.map(([x, dp, abs, signed]) => `${x} .${dp}f: py ${abs} / ${signed}, ts ${pyFixed(x, dp)} / ${pySigned(x, dp)}`)).toEqual([]);
    // Python's round(): ties to even.
    expect([0.5, 1.5, 2.5, -2.5, 2.4].map(pyRound)).toEqual([0, 2, 2, -2, 2]);
  });
});
