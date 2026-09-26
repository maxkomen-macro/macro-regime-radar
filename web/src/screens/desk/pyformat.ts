/**
 * Python-compatible number formatting for the Desk (review R-03). The engine
 * prints its numbers with Python's `format` (`fmt_move`: `+.1f` percent,
 * `+.0f` bp), which rounds the double's exact binary value to the nearest
 * decimal and sends an exact tie to the even digit. JavaScript's `toFixed`
 * rounds a tie away from zero, and a scaled `Math.round` rounds the scaled
 * double, not the value. Here the double is split into its exact integer
 * mantissa and power of two and rounded with BigInt, so every Desk string
 * matches what Python prints for the same double.
 * `scripts/desk_format_fixture.py` writes Python's own strings to
 * `event-study/__fixtures__/py-format.json`; `pyformat.test.ts` checks these
 * formatters against them. Pure, no React.
 */

/** A finite, non-negative double as `mantissa × 2^exponent`, exactly. */
function exactParts(a: number): { mant: bigint; exp: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, a);
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const bits = (hi >>> 20) & 0x7ff;
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  if (bits === 0) return { mant, exp: -1074 }; // subnormal
  mant |= 1n << 52n;
  return { mant, exp: bits - 1075 };
}

/** |x| to `dp` decimals, exactly as Python's `format(abs(x), f".{dp}f")`. */
export function pyFixed(x: number, dp: number): string {
  if (!Number.isFinite(x)) return String(x);
  const { mant, exp } = exactParts(Math.abs(x));
  const scale = 10n ** BigInt(dp);
  let q: bigint;
  if (exp >= 0) {
    q = (mant << BigInt(exp)) * scale;
  } else {
    const num = mant * scale;
    const den = 1n << BigInt(-exp);
    q = num / den;
    const twice = (num % den) * 2n;
    if (twice > den || (twice === den && q % 2n === 1n)) q += 1n;
  }
  const digits = q.toString().padStart(dp + 1, "0");
  return dp > 0 ? `${digits.slice(0, -dp)}.${digits.slice(-dp)}` : digits;
}

/** True for a negative double, negative zero included (Python prints "-0.0"). */
export function isNegative(x: number): boolean {
  return x < 0 || Object.is(x, -0);
}

/** Python's `format(x, f"+.{dp}f")` with the house minus (U+2212). */
export function pySigned(x: number, dp: number): string {
  return `${isNegative(x) ? "−" : "+"}${pyFixed(x, dp)}`;
}

/** Python's `round(x)` for a word or a count: the nearest integer, ties to even. */
export function pyRound(x: number): number {
  return (isNegative(x) ? -1 : 1) * Number(pyFixed(x, 0));
}

/** pyFixed with thousands separators, for a level ("4,523.10"). */
export function pyGrouped(x: number, dp: number): string {
  const [int, frac] = pyFixed(x, dp).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${isNegative(x) && Number(pyFixed(x, dp)) !== 0 ? "−" : ""}${grouped}${frac != null ? `.${frac}` : ""}`;
}
