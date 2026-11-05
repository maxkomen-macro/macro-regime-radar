/**
 * DV01 on the Position Monitor (desk-upgrade/dv01-spec/DV01_SPEC.md, revision 2, approved by Max on
 * 2026-11-04): a signed, first-order sensitivity, in % of NAV per +1 bp, of a hypothetical
 * constant-maturity US Treasury proxy. Positive means an estimated gain for a +1 bp rise in the stated
 * rate. It is never the DV01 of an actual bond, future or holding. Pure: no state, no requests; the
 * yields are `/macro`'s `curve.today`, the ones P1c's monitor reads.
 */

import { dayLong, isFiniteNumber, MINUS } from "../kit/format";
import type { Levels, Served } from "./monitor";
import { namedSeriesOf, parseSeries, type PositionRecord, type Tenor } from "./store";

/** Each tenor's constant maturity in years (§3): T does not shorten as a position ages. */
export const TENOR_YEARS: Readonly<Record<Tenor, number>> = { "3m": 0.25, "2y": 2, "5y": 5, "10y": 10, "30y": 30 };

/** The stored bond ETFs: their DV01 needs the fund's duration, which the store does not hold (§2). */
export const BOND_ETFS: readonly string[] = ["AGG", "IEF", "LQD", "HYG", "TLT"];

/** The yields, in percent, the proxy is defined for, inclusive (§6, design review DR-05 to DR-07). */
export const YIELD_MIN_PCT = -5;
export const YIELD_MAX_PCT = 50;

/** Below this many % NAV per bp a DV01 is shown as "<0.000001", never rounded to 0 (§6, DR-02). */
export const DV01_FLOOR = 1e-6;

/** The netting tolerance of a spread's two legs (§5, DR-05), relative to the larger leg. */
export const NETTING_TOL = 1e-9;

/** The small-y switch of the coupon-tenor duration (§4.1, DR-02). */
const SMALL_Y = 1e-8;

/** The proxy a tenor's yield prices: a par coupon Treasury (y > 0), a zero-coupon one (y ≤ 0), or the 3m bill. */
export type ProxyKind = "par" | "zero" | "bill";

export function proxyKind(tenor: Tenor, y: number): ProxyKind {
  if (tenor === "3m") return "bill";
  return y > 0 ? "par" : "zero";
}

/**
 * Modified duration of the tenor's proxy at decimal yield y (§4.1, §4.2), from the closed forms only:
 *   3m bill (simple-interest bond-equivalent):  τ / (1 + yτ), τ = 0.25
 *   coupon tenors, y ≥ 1e-8:  −expm1(−2T·log1p(y/2)) / y   (par, coupon = y)
 *   coupon tenors, 0 < y < 1e-8:  T − T(2T+1)y/4           (its expansion; y/2 may underflow)
 *   y = 0:  T;   y < 0:  T / (1 + y/2)                       (zero coupon)
 * NaN for a yield that is not finite or whose price base is not positive.
 */
export function duration(tenor: Tenor, y: number): number {
  if (!Number.isFinite(y)) return NaN;
  if (tenor === "3m") {
    const tau = TENOR_YEARS["3m"];
    return 1 + y * tau > 0 ? tau / (1 + y * tau) : NaN;
  }
  const T = TENOR_YEARS[tenor];
  if (y >= SMALL_Y) return -Math.expm1(-2 * T * Math.log1p(y / 2)) / y;
  if (y > 0) return T - (T * (2 * T + 1) * y) / 4;
  if (y === 0) return T;
  return 1 + y / 2 > 0 ? T / (1 + y / 2) : NaN;
}

/** One proxy leg as the row shows it: the tenor's served yield (percent) and date, and its duration. */
export interface Leg {
  tenor: Tenor;
  yield_pct: number;
  date: string;
  proxy: ProxyKind;
  duration: number;
}

export type Dv01 =
  /** A tenor's yield: DV01 = ± size × D × 0.01, in % NAV per +1 bp of the yield (§4.3). */
  | { kind: "yield"; size: number; leg: Leg; dv01: number }
  /**
   * A spread (§5): the longer-maturity leg is the reference leg, sized at the saved size; the shorter leg
   * is h = D_L / D_S times it. Market values and sensitivities are signed % NAV (a long bond is +).
   */
  | {
      kind: "spread";
      name: string;
      size: number;
      short: Leg;
      long: Leg;
      h: number;
      mv_short: number;
      mv_long: number;
      gross: number;
      sens_short: number;
      sens_long: number;
      dv01: number;
    }
  | { kind: "unknown"; why: string }
  /** `/macro` not answered yet: the card's loading line shows (§7, DR-10). */
  | { kind: "loading" }
  | { kind: "not_modelled" };

/**
 * The series a position's DV01 is about (§2, DR-03): read from its structured record, never its name. An
 * instrument subject resolves its recorded id by P1c's name rules; a study subject (carried from the Event
 * Study) its automatic trigger, the position's own quantity under §9's gate rule. Null otherwise.
 */
/** What classifies a position (§2): its subject, monitoring and trigger series, saved or as Save would write them. */
export type Classified = Pick<PositionRecord, "subject" | "monitoring"> & { trigger: { series: unknown } | null };

export function rateSeriesOf(p: Classified): ReturnType<typeof parseSeries> | null {
  const s = p.subject;
  let r: ReturnType<typeof parseSeries> = null;
  if (s && s.kind === "instrument" && typeof s.id === "string") r = parseSeries(namedSeriesOf(s.id));
  else if (s && s.kind === "study" && p.monitoring === "automatic") r = parseSeries(p.trigger?.series);
  return r && (r.kind === "yield" || r.kind === "spread") ? r : null;
}

/** A spread position, whether or not its DV01 can be computed today (the Monitored card's total, §7). */
export const isSpreadPosition = (p: Classified): boolean => rateSeriesOf(p)?.kind === "spread";

function legOf(tenor: Tenor, served: Served | undefined): Leg | { why: string } {
  if (!served || !isFiniteNumber(served.value)) return { why: `the ${tenor} yield is not served` };
  const v = served.value;
  if (v < YIELD_MIN_PCT || v > YIELD_MAX_PCT)
    return { why: `the ${tenor} yield ${v}% is outside the ${MINUS}5% to 50% range this proxy is defined for` };
  const y = v / 100;
  const d = duration(tenor, y);
  if (!Number.isFinite(d) || !(d > 0)) return { why: "the duration is not a usable number" };
  return { tenor, yield_pct: v, date: served.date, proxy: proxyKind(tenor, y), duration: d };
}

/** Finite both as a fraction of NAV and as the % NAV the row prints (DR-07). */
const shown = (x: number) => Number.isFinite(x) && Number.isFinite(x * 100);

/** A position's DV01 against today's served yields, or why there is none (§2 to §6). */
export function dv01Of(p: Classified & Pick<PositionRecord, "direction" | "size_nav">, levels: Levels): Dv01 {
  const s = p.subject;
  const r = rateSeriesOf(p);
  if (!r) {
    const id = s && s.kind === "instrument" && typeof s.id === "string" ? s.id.trim().toUpperCase() : "";
    return BOND_ETFS.includes(id) ? { kind: "unknown", why: "the fund's duration is not stored" } : { kind: "not_modelled" };
  }
  if (p.size_nav === null || p.size_nav === undefined) return { kind: "unknown", why: "no size saved" };
  const size = p.size_nav;
  if (!isFiniteNumber(size) || size < 0 || size > 1) return { kind: "unknown", why: "the size is not a share of NAV from 0 to 100%" };
  const sign = p.direction === "short" ? -1 : 1;
  // §7 (DR-10): a request still asked, or failed, is said as such, never as a tenor the curve does not serve.
  if (levels.rates === "loading") return { kind: "loading" };
  if (levels.rates === "failed") return { kind: "unknown", why: "the yields could not be loaded" };
  const tenors = levels.tenors ?? {};
  if (r.kind === "yield") {
    const leg = legOf(r.tenor, tenors[r.tenor]);
    if ("why" in leg) return { kind: "unknown", why: leg.why };
    const dv01 = sign * size * leg.duration * 0.01;
    if (!shown(dv01)) return { kind: "unknown", why: "the result is not a usable number" };
    return { kind: "yield", size, leg, dv01 };
  }
  if (r.kind !== "spread") return { kind: "not_modelled" };
  const a = legOf(r.short, tenors[r.short]);
  if ("why" in a) return { kind: "unknown", why: a.why };
  const b = legOf(r.long, tenors[r.long]);
  if ("why" in b) return { kind: "unknown", why: b.why };
  if (a.date !== b.date) return { kind: "unknown", why: "the legs are not served on the same date" };
  return spreadFrom(r.name, size, sign, a, b);
}

/**
 * The two legs of a spread, checked before any number is shown (§5, DR-05): every exposure and sensitivity
 * finite (also in % NAV), non-zero when the size is, and the legs netting within 1e-9.
 */
export function spreadFrom(name: string, size: number, sign: number, short: Leg, long: Leg): Dv01 {
  const h = long.duration / short.duration;
  // A steepener (sign +) is long the shorter-maturity bond and short the longer one; a bond of market value m
  // gains −m × D × 0.01 % NAV for a +1 bp rise in its yield.
  const mvShort = sign * size * h;
  const mvLong = -sign * size;
  const sensShort = -mvShort * short.duration * 0.01;
  const sensLong = -mvLong * long.duration * 0.01;
  const gross = size * (1 + h);
  return checkedSpread({ kind: "spread", name, size, short, long, h, mv_short: mvShort, mv_long: mvLong, gross, sens_short: sensShort, sens_long: sensLong, dv01: sensLong });
}

/** The representability check (§5, DR-05), applied to computed legs. */
export function checkedSpread(v: Extract<Dv01, { kind: "spread" }>): Dv01 {
  const refused: Dv01 = { kind: "unknown", why: "the hedge cannot be represented at these yields" };
  const parts = [v.h, v.mv_short, v.mv_long, v.gross, v.sens_short, v.sens_long];
  if (!parts.every(shown) || !(v.h > 0)) return refused;
  if (v.size > 0 && parts.some((x) => x === 0)) return refused;
  if (Math.abs(v.sens_short + v.sens_long) > NETTING_TOL * Math.max(Math.abs(v.sens_short), Math.abs(v.sens_long))) return refused;
  return v;
}

/** "+0.0041", "−0.00010", "0", "+<0.000001": 2 significant figures in % NAV, never scientific (§7). */
export function dv01Number(x: number, size: number): string {
  if (size === 0) return "0";
  const sign = x < 0 || Object.is(x, -0) ? MINUS : "+";
  const a = Math.abs(x);
  if (a < DV01_FLOOR) return `${sign}<0.000001`;
  if (a >= 100) return `${sign}${Math.round(a).toLocaleString("en-US")}`;
  const decimals = Math.min(7, Math.max(0, 1 - Math.floor(Math.log10(a))));
  return `${sign}${a.toFixed(decimals)}`;
}

/** A signed or plain market value in % NAV to 0.1, "<0.1%" for a positive one under 0.05% (§7). */
export function mvText(frac: number): string {
  const a = Math.abs(frac * 100);
  if (a > 0 && a < 0.05) return "<0.1%";
  return `${a.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/** h to 2 decimals; a positive h under 0.005 reads "<0.01" (§7, DR-06). */
export function hText(h: number): string {
  if (h > 0 && h < 0.005) return "<0.01";
  return h.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


/**
 * The Promote form's line under the size of a spread (§7, DR-08, DR-12 to DR-14), for the position as Save would
 * record it, classified like a saved row: what the size is, and how far both legs exceed it from the same
 * computation as the row; anything the row would refuse gives no multiple. Null when it is not a spread proxy.
 */
export function spreadSizeHelp(p: Classified, levels: Levels): string | null {
  const r = rateSeriesOf(p);
  if (!r || r.kind !== "spread") return null;
  const head = `For a spread, the size is the market value of the ${r.long} leg.`;
  const d = dv01Of({ ...p, direction: "long", size_nav: 1 }, levels);
  if (d.kind !== "spread") return `${head} The ${r.short} leg is sized to offset its DV01; the combined exposure cannot be estimated from the currently served yields.`;
  const times = (1 + d.h).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${head} The ${r.short} leg is sized to offset its DV01, so both legs together come to about ${times} times the size at the yields served for ${dayLong(d.long.date) || d.long.date}.`;
}
