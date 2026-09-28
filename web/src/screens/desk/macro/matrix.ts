/**
 * The 12-asset correlation matrix, read as one fact (Codex R-01, desk/matrix).
 *
 * The response schema (`data/schema.ts`) checks each field's kind; this checks
 * that the grid is the grid the card claims to draw before any of it is
 * drawn: the twelve assets in their order, twelve rows of twelve cells, a
 * symmetric grid with a unit diagonal and every value inside −1 to 1, the
 * no-data list agreeing with the empty rows and columns, and the served lead
 * stating the pairs and values the cells hold. One failed check makes the
 * whole card unavailable with the check's words; a partial or mislabeled grid
 * is not drawn.
 */
import type { MatrixBlock } from "../data/types";

/** §12.8 `matrix.assets`: the registry's series ids, in the served order. */
export const MATRIX_ASSETS = ["SPY", "QQQ", "IWM", "SMH", "XLE", "TLT", "IEF", "HYG", "LQD", "GLD", "UUP", "^VIX"] as const;

/** Two served numbers that must be the same number (the grid's own cells, a lead's copy of one). */
const SAME = 1e-9;
/** A lead prints each value to two decimals, so a printed value is within half a hundredth of its cell. */
const PRINTED = 0.005 + SAME;

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

interface Pair {
  i: number;
  j: number;
  corr: number;
}

/** The off-diagonal pairs with a value, i < j in `assets` order (the order the API's lead reads them). */
export function servedPairs(values: (number | null)[][]): Pair[] {
  const out: Pair[] = [];
  for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++) {
      const v = values[i]?.[j];
      if (fin(v)) out.push({ i, j, corr: v });
    }
  return out;
}

/** The first pair with the largest (`dir` 1) or smallest (`dir` −1) value, as Python's max() and min() pick it. */
function extreme(pairs: Pair[], dir: 1 | -1): Pair | null {
  let best: Pair | null = null;
  for (const p of pairs) if (!best || dir * p.corr > dir * best.corr) best = p;
  return best;
}

/** "SPY and TLT at +0.48" mentions in a sentence, in order. */
const MENTION = /([A-Z^][A-Z0-9^=.]*) and ([A-Z^][A-Z0-9^=.]*) at ([+−-]?\d+\.\d{2})/g;
const NUMBER = /[+−-]?\d+\.\d{2}/g;
const parse = (s: string) => Number(s.replace("−", "-"));

/** Why the lead does not agree with the cells, or null when it does. */
function leadProblem(mx: MatrixBlock, pairs: Pair[]): string | null {
  const lead = mx.lead;
  const sym = mx.assets;
  const at = (a: string, b: string) => mx.values[sym.indexOf(a)]?.[sym.indexOf(b)] ?? null;
  const hi = extreme(pairs, 1);
  const lo = extreme(pairs, -1);
  const spyTlt = at("SPY", "TLT");
  if (!lead) return "the lead is missing";
  if (!pairs.length) return lead.text == null ? null : "the lead states pairs the grid does not serve";
  if (typeof lead.text !== "string" || !lead.text) return "the lead's sentence is missing";
  const samePair = (served: { a: string; b: string; corr: number } | null | undefined, want: Pair) =>
    !!served && served.a === sym[want.i] && served.b === sym[want.j] && Math.abs(served.corr - want.corr) <= SAME;
  if (!samePair(lead.highest, hi as Pair)) return "the lead's highest pair is not the grid's";
  if (!samePair(lead.lowest, lo as Pair)) return "the lead's lowest pair is not the grid's";
  if (fin(spyTlt) ? !fin(lead.spy_tlt) || Math.abs(lead.spy_tlt - spyTlt) > SAME : lead.spy_tlt != null)
    return "the lead's SPY and TLT value is not the grid's";
  if ((lead.hedging ?? null) !== (fin(spyTlt) ? spyTlt < 0 : null)) return "the lead's hedging call does not follow the SPY and TLT cell";
  // The sentence itself: each pair it names with the value it prints, in order, and no other number.
  const want: { a: string; b: string; corr: number }[] = [
    ...(fin(spyTlt) ? [{ a: "SPY", b: "TLT", corr: spyTlt }] : []),
    { a: sym[(hi as Pair).i], b: sym[(hi as Pair).j], corr: (hi as Pair).corr },
    ...(pairs.length > 1 ? [{ a: sym[(lo as Pair).i], b: sym[(lo as Pair).j], corr: (lo as Pair).corr }] : []),
  ];
  const said = [...lead.text.matchAll(MENTION)].map((m) => ({ a: m[1], b: m[2], v: parse(m[3]) }));
  const numbers = lead.text.match(NUMBER) ?? [];
  const agrees =
    said.length === want.length &&
    numbers.length === want.length &&
    said.every((s, k) => s.a === want[k].a && s.b === want[k].b && Math.abs(s.v - want[k].corr) <= PRINTED);
  if (!agrees) return "the lead's sentence does not state the grid's pairs and values";
  if (fin(spyTlt) && !lead.text.includes(spyTlt < 0 ? "are hedging" : "are not hedging")) return "the lead's hedging words do not follow the SPY and TLT cell";
  return null;
}

/**
 * Why a served matrix cannot be drawn, in words, or null when every check
 * holds. The checks, in order: the assets and their labels, the grid's
 * dimensions, the no-data list, each cell (range, symmetry, the diagonal,
 * present exactly when neither asset is listed without data), then the lead.
 */
export function matrixProblem(mx: MatrixBlock | null | undefined): string | null {
  if (!mx) return "the matrix is missing";
  const n = MATRIX_ASSETS.length;
  if (!Array.isArray(mx.assets) || mx.assets.length !== n || mx.assets.some((a, i) => a !== MATRIX_ASSETS[i]))
    return `the assets are not ${MATRIX_ASSETS.join(", ")} in that order`;
  if (!Array.isArray(mx.labels) || mx.labels.length !== n || mx.labels.some((l) => typeof l !== "string" || !l)) return "the assets' names are not twelve";
  const v = mx.values;
  if (!Array.isArray(v) || v.length !== n || v.some((row) => !Array.isArray(row) || row.length !== n)) return "the grid is not 12 by 12";
  const empty = new Set<string>();
  for (const e of Array.isArray(mx.no_data) ? mx.no_data : []) {
    if (!MATRIX_ASSETS.includes(e?.symbol as (typeof MATRIX_ASSETS)[number])) return "the no-data list names an asset outside the grid";
    if (empty.has(e.symbol)) return `the no-data list names ${e.symbol} twice`;
    if (typeof e.reason !== "string" || !e.reason) return `${e.symbol} is listed without data but without its reason`;
    empty.add(e.symbol);
  }
  const sym = mx.assets;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const c = v[i][j];
      const off = empty.has(sym[i]) || empty.has(sym[j]);
      if (off && c != null) return `${empty.has(sym[i]) ? sym[i] : sym[j]} is listed without data but has a value against ${empty.has(sym[i]) ? sym[j] : sym[i]}`;
      if (!off && !fin(c)) return `${sym[i]} and ${sym[j]} have no value though neither is listed without data`;
      if (off) continue;
      if (Math.abs(c as number) > 1 + SAME) return `${sym[i]} and ${sym[j]} have a value outside −1 to 1`;
      if (i === j && Math.abs((c as number) - 1) > SAME) return `the diagonal is not 1 at ${sym[i]}`;
      const mirror = v[j][i];
      if (j > i && (!fin(mirror) || Math.abs((c as number) - mirror) > SAME)) return `the grid is not symmetric at ${sym[i]} and ${sym[j]}`;
    }
  return leadProblem(mx, servedPairs(v));
}
