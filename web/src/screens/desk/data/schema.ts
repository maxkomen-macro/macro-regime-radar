/**
 * The Desk's response schemas (Codex R-09, R-10): what every field of every
 * §12 answer must be, checked once at the response boundary (`data/api.ts`)
 * before any page reads it. They mirror `./types.ts` field for field.
 *
 * The rules, so a page can trust the shape and guard only values:
 * - A statistic (`n`) that is not a finite number becomes null; the page
 *   prints "Awaiting refresh" under its label (§1.7) or "—" in a cell.
 * - A field a block cannot be read without (`!`) that is missing or of the
 *   wrong kind makes the whole block invalid: an optional block is removed
 *   (its panel says Awaiting refresh), a row is dropped from its list, a
 *   required top-level block makes the answer unreadable.
 * - Any other field of the wrong kind is removed (a nullable one, `?`, is
 *   set to null), so a page never reads a number where it expects words.
 * - A strict list (the 12-asset matrix's rows) is one fact: one bad row invalidates it.
 * - Keys the schema does not name pass through untouched (the Sectors
 *   not-ingested `error`, a field B adds before this file knows it).
 */

// ── The language ──────────────────────────────────────────────────────────

/** Leaves: s string, n statistic, b boolean, * anything; `!` required; `?` nullable (a bad value becomes null). */
type Leaf = "s" | "s!" | "s?" | "n" | "n!" | "b" | "b!" | "b?" | "*";
interface Obj {
  k: "obj";
  fields: Record<string, Spec>;
  req?: boolean;
  nul?: boolean;
}
interface List {
  k: "list";
  of: Spec;
  req?: boolean;
  strict?: boolean;
}
interface MapOf {
  k: "map";
  of: Spec;
  req?: boolean;
}
interface Enum {
  k: "enum";
  of: readonly string[];
  req?: boolean;
  /** Served null on purpose (§12.5: "null when unavailable"): null passes, and a bad value becomes null. */
  nul?: boolean;
}
interface Tuple {
  k: "tuple";
  of: Spec[];
  req?: boolean;
  nul?: boolean;
}
export type Spec = Leaf | Obj | List | MapOf | Enum | Tuple;

export const o = (fields: Record<string, Spec>, opts: { req?: boolean; nul?: boolean } = {}): Obj => ({ k: "obj", fields, ...opts });
export const l = (of: Spec, opts: { req?: boolean; strict?: boolean } = {}): List => ({ k: "list", of, ...opts });
export const m = (of: Spec, opts: { req?: boolean } = {}): MapOf => ({ k: "map", of, ...opts });
export const e = (of: readonly string[], opts: { req?: boolean; nul?: boolean } = {}): Enum => ({ k: "enum", of, ...opts });
export const t = (of: Spec[], opts: { req?: boolean; nul?: boolean } = {}): Tuple => ({ k: "tuple", of, ...opts });

const INVALID = Symbol("invalid");

/** Where an object records the rows its lists lost at the boundary: `{ signals: 2 }` (Codex R-16). */
export const DROPPED = "_dropped";

/** How many rows of `o[key]` could not be read at the boundary (0 when none, or when `o` is not an object). */
export function droppedOf(o: unknown, key: string): number {
  const d = o && typeof o === "object" ? (o as Record<string, unknown>)[DROPPED] : undefined;
  const n = d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}
type Checked = unknown | typeof INVALID;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function required(spec: Spec): boolean {
  return typeof spec === "string" ? spec.endsWith("!") : !!spec.req;
}

/** What a bad optional value becomes: null for a statistic or a nullable leaf, else removed. */
function fallback(spec: Spec): null | typeof INVALID {
  if (spec === "n" || spec === "s?" || spec === "b?") return null;
  if (typeof spec !== "string" && (spec.k === "obj" || spec.k === "tuple" || spec.k === "enum") && spec.nul) return null;
  return INVALID;
}

export function check(v: unknown, spec: Spec): Checked {
  if (typeof spec === "string") {
    switch (spec) {
      case "*":
        return v;
      case "n":
        return finite(v) ? v : null;
      case "n!":
        return finite(v) ? v : INVALID;
      case "s":
      case "s!":
        return typeof v === "string" ? v : INVALID;
      case "s?":
        return typeof v === "string" ? v : null;
      case "b":
      case "b!":
        return typeof v === "boolean" ? v : INVALID;
      case "b?":
        return typeof v === "boolean" ? v : null;
    }
  }
  switch (spec.k) {
    case "enum":
      if (v === null && spec.nul) return null;
      return typeof v === "string" && spec.of.includes(v) ? v : INVALID;
    case "tuple": {
      if (v === null && spec.nul) return null;
      if (!Array.isArray(v) || v.length !== spec.of.length) return INVALID;
      const out = v.map((x, i) => check(x, spec.of[i]));
      return out.some((x) => x === INVALID) ? INVALID : out;
    }
    case "list": {
      if (!Array.isArray(v)) return INVALID;
      const out = v.map((x) => check(x, spec.of));
      if (spec.strict && out.some((x) => x === INVALID)) return INVALID;
      return out.filter((x) => x !== INVALID);
    }
    case "map": {
      if (!isRecord(v)) return INVALID;
      const out: Record<string, unknown> = {};
      for (const [key, x] of Object.entries(v)) {
        const c = check(x, spec.of);
        if (c !== INVALID) out[key] = c;
      }
      return out;
    }
    case "obj": {
      if (v === null && spec.nul) return null;
      if (!isRecord(v)) return INVALID;
      const out: Record<string, unknown> = { ...v };
      delete out[DROPPED];
      const dropped: Record<string, number> = {};
      for (const [key, f] of Object.entries(spec.fields)) {
        if (!(key in v) || v[key] === undefined) {
          if (required(f)) return INVALID;
          continue;
        }
        const c = check(v[key], f);
        // Codex R-16: a list that lost rows at the boundary says how many, so no page counts or claims
        // "none" from what is left.
        if (Array.isArray(c) && Array.isArray(v[key]) && c.length < (v[key] as unknown[]).length) dropped[key] = (v[key] as unknown[]).length - c.length;
        if (c !== INVALID) {
          out[key] = c;
          continue;
        }
        if (required(f)) return INVALID;
        const fb = fallback(f);
        if (fb === INVALID) delete out[key];
        else out[key] = fb;
      }
      if (Object.keys(dropped).length) out[DROPPED] = dropped;
      return out;
    }
  }
}

/** A top-level answer checked against its schema; undefined when it cannot be read. */
export function checkAnswer(body: unknown, spec: Obj): Record<string, unknown> | undefined {
  const c = check(body, spec);
  return c === INVALID || !isRecord(c) ? undefined : c;
}

// ── The shapes (§12, §12.13) ──────────────────────────────────────────────

const VERDICTS = ["reliable", "suggestive", "no_edge", "insufficient"] as const;
/** §12.2: the six moves (the two RSI crossings since desk/fill-compute). */
const MOVES = ["up2s", "down2s", "cross_above", "cross_below", "rsi_above_70", "rsi_below_30"] as const;
/** §12.2, §12.4 (S-06): a listed event always carries its K−2 label; one whose K−2 month has no stored regimes row is counted, never listed. */
const REGIME_LABELS = ["Goldilocks", "Overheating", "Stagflation", "Recession Risk"] as const;
// §12.0: a read names the rule that produced it; a read without one is not served.
const read = o({ label: "s?", text: "s!", tone: e(["normal", "warning"]), rule: "s!" });
const reads = (keys: string[]) => o(Object.fromEntries(keys.map((key) => [key, { ...read, nul: true }])));
const envelope = { as_of: "s", generation_id: "s" } as const;

const ledgerRow = o({
  slug: "s!",
  label: "s!",
  group: "s",
  available: "b",
  unavailable: o({ reason: "s!", until: "s?" }, { nul: true }),
  evaluated_on: "s?",
  stale: "b",
  last_fired: "s?",
  horizon: "n",
  n: "n",
  up_pct: "n",
  median: "n",
  // §12.5: each "required, nullable (null when unavailable)"; an unknown value reads as null (the pill says "—", L-3).
  target_unit: e(["log_return", "log_change", "bp"], { nul: true }),
  display_unit: e(["percent", "bp"], { nul: true }),
  baseline_median: "n",
  vs_normal: "n",
  verdict: e(VERDICTS, { nul: true }),
  firing_now: "b?",
  firing_day: "n",
  sample_start: "s?",
  short: "s",
});

const question = o(
  {
    shock: "s!",
    // §12.2: null for a cross or an RSI crossing.
    window: "n",
    move: e(MOVES, { req: true }),
    while: "s!",
    target: "s!",
    horizon: "n!",
    target_unit: e(["log_return", "log_change", "bp"]),
    display_unit: e(["percent", "bp"]),
  },
  { req: true },
);

const pricePoint = o({ date: "s!", close: "n", ma50: "n", ma200: "n" });
// desk/usability §14.2: the relative-strength line, rebased to 100 at each range's first point.
const rsPoint = o({ date: "s!", rs: "n", rs_ma50: "n" });
// desk/usability §14.2: the drawdown's and the realized volatility's windows (books' `span` below is the basket's, nullable).
const techSpan = o({ start: "s!", end: "s!", n: "n" });
const relPoint = o({ date: "s!", rel: "n" });
const regimeTrend = o({ label: "s!", print: "s", growth: "s", inflation: "s", months_in: "n", since: "s", freq: "s", source: "s" });
const BANDS = ["low", "elevated", "high_risk"] as const;
const TREND_STATES = ["above_both", "below_both", "mixed", "unavailable"] as const;
const FRESH_STATES = ["current", "stale", "missing"] as const;
const recessionScore = { score: "n", probability_month: "s", inputs_through: "s", band: e(BANDS), band_edges: t(["n!", "n!"], { nul: true }), freq: "s", source: "s" } as const;
const nextPrint = o(
  {
    release_date: "s?",
    reference_month: "s!",
    series: "s",
    threshold_mom: "n",
    operator: e(["<=", ">"], { req: true }),
    flips_to: "s?",
    first_effective_month: "s!",
    from_direction: e(["rising", "falling"], { nul: true }),
    printed_mom: "n",
    printed_direction: e(["rising", "falling"], { nul: true }),
    // Codex R-05, R-06: whether the print's own release is out, and the other axis the flip reads.
    released: "b?",
    other: o({ axis: "s!", series: "s", reference_month: "s!", direction: e(["rising", "falling"], { req: true }), status: e(["published", "assumed"], { req: true }) }, { nul: true }),
    freq: "s",
    source: "s",
  },
  { nul: true },
);
const publishedPrint = o(
  { reference_month: "s!", series: "s", mom: "n", direction: e(["rising", "falling"], { nul: true }), from_direction: e(["rising", "falling"], { nul: true }) },
  { nul: true },
);
// §12.8 (S-24): `dates` names each tenor's date, null for a tenor not stored.
const curvePoint = o({ "3m": "n", "2y": "n", "5y": "n", "10y": "n", "30y": "n", date: "s?", dates: m("s?") });
const seasonRow = o({ month: "n", label: "s!", n: "n", avg: "n", pct_up: "n", first_year: "n", last_year: "n" });
const macdPoint = o({ date: "s!", macd: "n", signal: "n", hist: "n" });
const rsiVisit = o({ date: "s!", rsi: "n", after_20d: "n", after_20d_to: "s?", after_20d_status: e(["complete", "pending", "missing"], { nul: true }) }, { nul: true });
/** The deferred vol and sectors shapes (§12.13), served as `/technicals` blocks and as their own stubs. */
const VOL = {
  source: "s",
  skew_25d_1m_pts: "n",
  skew_pct_2y: "n",
  skew_trend: "s",
  atm_iv_1m: "n",
  realized_20d: "n",
  term: o({ "1m": "n", "3m": "n", "6m": "n" }, { nul: true }),
  history_from: "s",
  dates: m("s"),
} as const;
const SECTORS = {
  window_months: "n",
  window: o({ start: "s!", end: "s!", n: "n" }),
  compared_on: "s",
  unit: "s",
  band: "n",
  benchmark: o({ etf: "s!", name: "s", ret: "n" }),
  leadership: l(o({ etf: "s!", name: "s!", short: "s", group: "s?", rel_ret: "n", ret: "n", first: "s?", reason: "s?" })),
  ranked_n: "n",
  missing: l(o({ etf: "s!", name: "s", reason: "s" })),
  pattern: o({ rule: "s", band: "n", cyclicals: l("s"), defensives: l("s"), word: e(["cyclical", "defensive", "mixed"], { nul: true }), spread: "n", reason: "s?" }),
  date: "s",
  freq: "s",
  source: "s",
  providers: l("s"),
  breadth: o({
    compared_on: "s",
    of_total: "n",
    above_50: o({ n: "n", of: "n", compared_on: "s?", window: o({ start: "s!", end: "s!", n: "n" }), by_etf: m("b"), not_available: l(o({ etf: "s!", reason: "s!" })) }),
    above_200: o({ n: "n", of: "n", compared_on: "s?", window: o({ start: "s!", end: "s!", n: "n" }), by_etf: m("b"), not_available: l(o({ etf: "s!", reason: "s!" })) }),
    eqw_vs_cap_3m: "n",
    eqw_vs_cap_reason: "s?",
    eqw_vs_cap_series: l(relPoint),
    eqw_vs_cap_line_window: o({ start: "s!", end: "s!", n: "n" }, { nul: true }),
    small_vs_large_3m: "n",
    small_vs_large_reason: "s?",
    small_vs_large_series: l(relPoint),
    small_vs_large_line_window: o({ start: "s!", end: "s!", n: "n" }, { nul: true }),
    relative_window: o({ start: "s!", end: "s!", n: "n" }),
    unit: "s",
    date: "s",
    freq: "s",
    source: "s",
    providers: l("s"),
  }),
} as const;

/** §12.15's pieces (desk/books). */
const span = o({ start: "s!", end: "s!", n: "n" }, { nul: true });
const basketPoint = o({ date: "s!", close: "n", ma50: "n", ma200: "n", rsi: "n", drawdown: "n" });
const comparePoint = o({ date: "s!", basket: "n", qqq: "n", spy: "n", rs_qqq: "n", rs_qqq_ma50: "n", rs_spy: "n", rs_spy_ma50: "n" });
const compareRange = o({ base_date: "s?", points: l(comparePoint) });
const loose = o({ start: "s?", end: "s?", n: "n" });
const benchmark = o({
  symbol: "s!",
  label: "s!",
  price: "n",
  date: "s",
  ret_1y: "n",
  beta_1y: "n",
  corr_1y: "n",
  window_1y: loose,
  reason_1y: "s?",
  beta_60d: "n",
  corr_60d: "n",
  window_60d: loose,
  reason_60d: "s?",
});

export const SCHEMAS: Readonly<Record<string, Obj>> = {
  // §12.17 (desk/usability): the stored instruments; a row without its symbol and name is dropped.
  "/instruments": o({
    ...envelope,
    instruments: l(o({ symbol: "s!", name: "s!", kind: e(["etf", "index"]), first: "s?", last: "s?", source: "s" })),
    // Codex R-08: an instrument whose stored rows could not be read, and why; the rest stand.
    excluded: l(o({ symbol: "s!", reason: "s!" })),
  }),
  "/overview": o({
    ...envelope,
    since_last_close: o({
      comparison_session: "s?",
      prev_session: "s?",
      new_fires: l(o({ slug: "s!", label: "s!", short: "s" })),
      still_firing: l(o({ slug: "s!", label: "s!", short: "s", firing_day: "n" })),
      vol_change_pts: "n",
      regime_changed: "b?",
      regime_from: "s?",
      regime_to: "s?",
      refreshed_at_utc: "s?",
    }),
    tiles: o({
      regime: regimeTrend,
      recession: o({ ...recessionScore }),
      // §12.1: the served state names the trend; without it the tile says nothing (Codex G1-9).
      trend: o({ state: e(TREND_STATES, { req: true }), above_50: "b?", above_200: "b?", state_since: "s?", cross: o({ kind: e(["golden", "death"], { req: true }), date: "s!" }, { nul: true }), date: "s", freq: "s", source: "s" }),
      vol: o({
        vix: "n",
        date: "s",
        freq: "s",
        source: "s",
        // §12.1 (desk/fill-compute): the band on the VIX, and the gap on its own session; a gap without its day claims nothing.
        band: e(["calm", "subdued", "stressed"], { nul: true }),
        band_edges: t(["n!", "n!"], { nul: true }),
        gap: o({ date: "s!", vix: "n", realized_21d: "n", gap_pts: "n", window: o({ start: "s!", end: "s!", n: "n!" }) }, { nul: true }),
      }),
    }),
    active_signals: l(ledgerRow),
    data_status: o({
      state: e(FRESH_STATES, { req: true }),
      contributors: l(o({ series: "s!", observation_date: "s?", expected_observation_date: "s?", state: e(FRESH_STATES, { req: true }), reason: "s" })),
    }),
  }),
  "/ledger": o({ ...envelope, verdict_rule: "s", horizon: "n", comparison_session: "s?", prev_session: "s?", scored_n: "n", unavailable_n: "n", signals: l(ledgerRow) }),
  "/technicals": o({
    ...envelope,
    // desk/usability §14.2: which instrument, and whether its signals are scored (the S&P 500 only).
    symbol: "s",
    name: "s",
    scored: "b",
    drawdown: o({ value: "n", peak: o({ date: "s!", close: "n" }, { nul: true }), window: techSpan, complete: "b" }, { nul: true }),
    realized_vol: o({ value: "n", window: techSpan, annualization: "n" }, { nul: true }),
    rs: o(
      {
        benchmark: "s",
        date: "s",
        value: "n",
        ma50: "n",
        vs_ma50: "n",
        chg_3m: "n",
        chg_3m_dates: o({ from: "s!", to: "s!" }, { nul: true }),
        series: o({ "6m": l(rsPoint), "1y": l(rsPoint), "3y": l(rsPoint) }),
      },
      { nul: true },
    ),
    price: "n",
    // §12.7: the session the price and the averages are dated to.
    date: "s",
    freq: "s",
    source: "s",
    chg_1d: "n",
    chg_1d_dates: o({ from: "s!", to: "s!" }),
    ret_1y: "n",
    ret_1y_dates: o({ from: "s!", to: "s!" }),
    ma50: "n",
    ma200: "n",
    ma50_window: o({ start: "s!", end: "s!", n: "n!" }),
    ma200_window: o({ start: "s!", end: "s!", n: "n!" }),
    vs_ma50: "n",
    vs_ma200: "n",
    trend: o({ state: e(TREND_STATES, { req: true }), state_since: "s?" }),
    move_20d_sigma: "n",
    move_20d_date: "s?",
    // §12.7: RSI(14) and its two zones' last sessions; a visit without its day claims nothing.
    rsi: "n",
    rsi_date: "s?",
    rsi_prev: "n",
    rsi_prev_date: "s?",
    rsi_last_above_70: rsiVisit,
    rsi_last_below_30: rsiVisit,
    // §12.7: MACD(12, 26, 9) on its own session; a crossover without its kind and day claims nothing.
    macd: o(
      {
        date: "s!",
        macd: "n",
        signal: "n",
        hist: "n",
        last_cross: o({ date: "s!", kind: e(["above", "below"], { req: true }) }, { nul: true }),
        params: o({ fast: "n", slow: "n", signal: "n" }),
        series: l(macdPoint),
      },
      { nul: true },
    ),
    // §12.7: the twelve calendar months; a month without its name claims nothing.
    seasonality: o({ rows: l(seasonRow, { req: true }), window: o({ start: "s!", end: "s!", n: "n!" }), freq: "s", source: "s" }, { nul: true }),
    signals_allowlist: l("s!"),
    // Codex R-03: a stock's bars dated after the last completed session, dropped before any figure.
    excluded_bars: o({ n: "n!", after: "s!" }, { nul: true }),
    // A cross without its kind and day claims nothing (Codex G1-9).
    cross: o({ kind: e(["golden", "death"], { req: true }), date: "s!" }, { nul: true }),
    series: o({ "6m": l(pricePoint), "1y": l(pricePoint), "3y": l(pricePoint) }),
    // §12.7: two block envelopes, awaiting on Monday; their data, once ready, is the deferred shape.
    vol: o({ ...VOL }),
    sectors: o({ ...SECTORS }),
  }),
  "/vol": o({ ...envelope, ...VOL }),
  "/sectors": o({ ...envelope, ...SECTORS }),
  "/regime": o({
    ...envelope,
    // The page words a missing label on its own (Regime R-2); the rest of the block still reads.
    current: o({
      label: "s",
      print: "s",
      latest_print: "s",
      growth: "s",
      inflation: "s",
      months_in: "n",
      since: "s",
      freq: "s",
      source: "s",
      // desk/fill-compute: a classifier reading without its month, label and verdict claims nothing.
      classifier: o({ month: "s!", label: "s!", odds: "n", agrees: "b!" }, { nul: true }),
    }),
    history: l(o({ month: "s!", regime: "s!" })),
    history_note: "s",
    history_freq: "s",
    history_source: "s",
    recession: o({
      ...recessionScore,
      feature_months: m("s!"),
      year_ago: o({ score: "n", probability_month: "s" }, { nul: true }),
      peak: o({ score: "n", probability_month: "s", window: "s" }, { nul: true }),
      training: o({ start: "s!", end: "s!" }, { nul: true }),
      methodology: "s",
    }),
    stats: o({
      rows: l(
        o({ regime: "s!", months: "n", spx_n: "n", spx_pending: "n", spx_missing: "n", spx_median_mo: "n", spx_mean_mo: "n", up_pct: "n", vix_avg: "n", vix_days: "n", vix_sessions: "n" }),
        { req: true },
      ),
      window: o({ start: "s!", end: "s!", n: "n!" }),
      governed: o({ start: "s!", end: "s!", n: "n!" }),
      lag_months: "n",
      totals: o({ months: "n", spx_n: "n", spx_pending: "n", spx_missing: "n", vix_days: "n", vix_sessions: "n" }),
      vix_coverage: o({ stored: "b!", first: "s?", last: "s?", off_session_dropped: "n", invalid: "n" }),
      freq: "s",
      source: "s",
    }),
    next_prints: o({
      basis: o({ month: "s!", label: "s!" }, { nul: true }),
      published: l(o({ month: "s!", label: "s!", first_effective_month: "s!", cpi: publishedPrint, indpro: publishedPrint })),
      upcoming_from: o({ month: "s!", label: "s!" }, { nul: true }),
      cpi: nextPrint,
      indpro: nextPrint,
    }),
    changes: o({
      rows: l(o({ effective_month: "s!", stamp_month: "s?", from: "s!", to: "s!", from_month: "s?", spx_1m: "n", spx_1m_status: e(["complete", "pending", "missing"], { nul: true }) }), { req: true }),
      n: "n",
      window: o({ start: "s!", end: "s!", n: "n!" }),
      lag_months: "n",
      freq: "s",
      source: "s",
    }),
    reads: reads(["stats", "changes"]),
  }),
  "/macro": o({
    ...envelope,
    curve: o({ today: curvePoint, month_ago: curvePoint, "2s10s_bp": "n", "2s10s_chg_bp": "n", "10y_chg_bp": "n", freq: "s", source: "s" }),
    stock_bond: o({
      today: "n",
      today_date: "s?",
      today_reason: "s?",
      year_ago: "n",
      year_ago_date: "s?",
      flipped: "s?",
      flipped_on: "s?",
      flipped_to: e(["positive", "negative"], { nul: true }),
      series: l(o({ date: "s!", corr: "n" })),
      window: o({ start: "s!", end: "s!", n: "n" }),
      line_window: o({ start: "s!", end: "s!", n: "n" }),
      stock: o({ etf: "s!", name: "s" }),
      bond: o({ etf: "s!", name: "s" }),
      transform: "s",
      unit: "s",
      date: "s",
      freq: "s",
      source: "s",
      providers: l("s"),
    }),
    credit: o({
      // §12.8: each spread with its own date; a value without its date is not read.
      hy: o({ value: "n", date: "s!", freq: "s", source: "s" }, { nul: true }),
      ig: o({ value: "n", date: "s!", freq: "s", source: "s" }, { nul: true }),
      hy_pct_3y: "n",
      hy_range_3y: t(["n", "n"], { nul: true }),
      rank_window: o({ start: "s!", end: "s!", n: "n", expected_n: "n", valid_n: "n", missing_n: "n", first_obs: "s?", last_obs: "s?" }),
      reason: "s?",
      band: e(["tight", "normal", "wide"], { nul: true }),
      band_edges: t(["n!", "n!"], { nul: true }),
      series: l(o({ date: "s!", hy: "n" })),
      line_window: o({ start: "s!", end: "s!", n: "n" }),
      peak_12m: o({ date: "s!", hy: "n" }, { nul: true }),
    }),
    correlations: l(o({ asset: "s!", symbol: "s", quantity: "s", transform: "s", corr: "n", date: "s?", window: o({ start: "s!", end: "s!", n: "n" }, { nul: true }), reason: "s?" })),
    // The matrix is one grid: its names and every row of values, or nothing (Codex G1-5).
    matrix: o({
      assets: l("s!", { req: true, strict: true }),
      labels: l("s!", { strict: true }),
      no_data: l(o({ symbol: "s!", reason: "s?" })),
      values: l(l("n", { strict: true }), { req: true, strict: true }),
      horizon: "n",
      window: o({ start: "s!", end: "s!", n: "n" }, { nul: true }),
      coverage: l("n"),
      lead: o(
        {
          text: "s?",
          rule: "s",
          hedging: "b?",
          spy_tlt: "n",
          highest: o({ a: "s!", b: "s!", corr: "n!" }, { nul: true }),
          lowest: o({ a: "s!", b: "s!", corr: "n!" }, { nul: true }),
        },
        { nul: true },
      ),
      quantity: "s",
      transform: "s",
      unit: "s",
      date: "s",
      freq: "s",
      source: "s",
      providers: l("s"),
    }),
    reads: reads(["curve", "front_end", "stock_bond", "credit", "correlations"]),
  }),
  "/study": o({
    ...envelope,
    inputs_hash: "s",
    served_from_cache: "b",
    elapsed_ms: "n",
    slug: "s?",
    label: "s",
    short: "s",
    // Every number in a study answers its question: without its six slots nothing can be labelled (Codex G1-1).
    question,
    matched_n: "n",
    selected_horizon: "n",
    data_start: "s?",
    sample_start: "s?",
    sample_end: "s?",
    first_event: "s?",
    firing_now: "b?",
    firing_day: "n",
    evaluated_on: "s?",
    comparison_session: "s?",
    prev_session: "s?",
    stale: "b",
    // Codex R-03: the inputs behind their own tolerance, by registry key.
    stale_inputs: l("s!"),
    last_event: "s?",
    // The verdict box says Awaiting refresh on its own; the numbers still stand.
    verdict: e(VERDICTS),
    verdict_rule: "s",
    verdict_confidence: "n",
    headline: "s",
    why: "s",
    horizons: l(
      o({
        h: "n!",
        label: "s!",
        up_pct: "n",
        up_n: "n",
        n: "n",
        n_incomplete: "n",
        baseline_n: "n",
        median: "n",
        baseline_median: "n",
        baseline_up_pct: "n",
        ci_lo: "n",
        ci_hi: "n",
        n_blocks: "n",
        adverse_share: "n",
        draws: "n",
        method: e(["enumeration", "monte_carlo"]),
        reason: "s?",
        verdict: e(VERDICTS),
        // §12.2: min and max over the completed outcomes, each with its event and entry sessions.
        worst: o({ value: "n", event_date: "s!", entry_date: "s?" }, { nul: true }),
        best: o({ value: "n", event_date: "s!", entry_date: "s?" }, { nul: true }),
      }),
    ),
    by_regime: l(o({ h: "n", regime: "s!", n: "n", up_pct: "n", median: "n" })),
    unlabeled_n: "n",
    // §12.2 (S-05, S-06): entry_date null when the entry session is after the stored data.
    last_events: l(o({ event_date: "s!", entry_date: "s?", regime: e(REGIME_LABELS), value_20: "n" })),
    provenance: o({ entry_rule: "s", cooldown: "n", seed: "n", engine_version: "s", series_start: m("s!") }),
    warnings: l("s!"),
    empty_state: o({ horizon: "n", sentence: "s", fixes: l("s!") }, { nul: true }),
    series: l(o({ key: "s!", label: "s!", roles: l("s!"), ops: l("s!"), unit: "s" })),
    client: o({ horizon: "n", headline: "s!", summary: "s!" }, { nul: true }),
  }),
  "/study/catalog": o({
    ...envelope,
    studies: l(
      o({
        slug: "s!",
        label: "s!",
        short: "s",
        // §12.3 (item 14): the Client view's title, in plain words.
        client_label: "s?",
        available: "b!",
        unavailable: o({ reason: "s!", until: "s?" }, { nul: true }),
        question: o({ shock: "s!", window: "n", move: e(MOVES, { req: true }), while: "s!", target: "s!" }, { nul: true }),
        allowed_horizons: l("n!"),
      }),
    ),
    // Codex R-05: the builder's series, served with the catalog (the same list /study serves).
    series: l(o({ key: "s!", label: "s!", roles: l("s!"), ops: l("s!"), unit: "s" })),
  }),
  // §12.4: every retained event, newest first, with each horizon's exit, value and completeness.
  "/study/events": o({
    ...envelope,
    slug: "s?",
    events: l(
      o({
        event_date: "s!",
        entry_date: "s?",
        regime: e(REGIME_LABELS),
        ...Object.fromEntries([5, 10, 20, 60].flatMap((h) => [[`exit_${h}`, "s?"], [`value_${h}`, "n"], [`complete_${h}`, "b"]])),
      }),
    ),
  }),
  "/basket/price": o({
    ...envelope,
    method: e(["hold", "monthly"]),
    notional: "n",
    provider: "s",
    source: "s",
    freq: "s",
    prices_as_of: "s",
    history_from: "s",
    start: "s",
    start_kind: e(["first_close", "history", "gap"]),
    start_binding: l("s!"),
    start_is_first_close: "b",
    start_gap_session: "s?",
    end: "s",
    sessions: "n",
    missing_sessions: l("s!"),
    rebalances: "n",
    total_return: "n",
    excluded: l(o({ symbol: "s!", n: "n", reason: "s" })),
    legs: l(o({ symbol: "s!", target_weight: "n", weight_now: "n", first_close: "s?", price_end: "n", return: "n", contribution: "n", dollars: "n", adv_usd: "n", adv_window: span, adv_missing: "n", days_to_trade: "n" })),
    concentration: o({ top3_share: "n", top3: l("s!"), effective_n: "n", avg_pairwise_corr: "n", corr_window: span }),
    liquidity: o({ participation: "n", adv_sessions: "n", basket_days: "n", binding: "s?", missing: l("s!"), reason: "s?" }),
    // The index card reads nothing without its session.
    index: o({
      price: "n",
      date: "s!",
      chg_1d: "n",
      chg_1d_dates: o({ from: "s!", to: "s!" }),
      ret_1y: "n",
      ret_1y_dates: o({ from: "s!", to: "s!" }),
      ma50: "n",
      ma200: "n",
      ma50_window: o({ start: "s!", end: "s!", n: "n!" }),
      ma200_window: o({ start: "s!", end: "s!", n: "n!" }),
      vs_ma50: "n",
      vs_ma200: "n",
      trend: o({ state: e(TREND_STATES, { req: true }), state_since: "s?" }),
      cross: o({ kind: e(["golden", "death"], { req: true }), date: "s!" }, { nul: true }),
      crosses: l(o({ kind: e(["golden", "death"], { req: true }), date: "s!" })),
      series: o({ "6m": l(basketPoint), "1y": l(basketPoint) }),
      rsi: "n",
      rsi_date: "s?",
      drawdown: o({ now: "n", peak_date: "s!", peak: "n", max: "n", max_date: "s!", max_peak_date: "s!", since: "s!" }),
      realized_vol_21d: "n",
      realized_vol_window: span,
    }),
    benchmarks: o({ qqq: benchmark, spy: benchmark }),
    compare: o({ "6m": compareRange, "1y": compareRange }),
  }),
  "/basket/hedge": o({
    ...envelope,
    method: e(["hold", "monthly"]),
    notional: "n",
    provider: "s",
    source: "s",
    prices_as_of: "s",
    start: "s",
    ranked_by: e(["r2_1y", "r2_60d"]),
    excluded: l(o({ symbol: "s!", n: "n", reason: "s" })),
    etfs: l(
      o({
        symbol: "s!",
        label: "s",
        rank: "n",
        basis: e(["1y", "60d"], { nul: true }),
        r2_1y: "n",
        r2_60d: "n",
        beta_1y: "n",
        beta_60d: "n",
        hedge_ratio: "n",
        short_usd: "n",
        basket_vol: "n",
        residual_vol: "n",
        vol_reduction: "n",
        window_1y: loose,
        window_60d: loose,
        reason: "s?",
      }),
    ),
    top: "s?",
    stress: l(
      o({
        shock: e(["QQQ", "SPY"], { req: true }),
        move: "n",
        window: o({ start: "s?", end: "s?", n: "n" }, { nul: true }),
        reason: "s?",
        basket_beta: "n",
        basket_move: "n",
        unhedged_usd: "n",
        hedge: "s?",
        hedge_ratio: "n",
        short_usd: "n",
        hedge_beta: "n",
        hedge_move: "n",
        hedge_usd: "n",
        hedged_usd: "n",
        hedged_move: "n",
      }),
    ),
  }),
  "/pipeline": o({
    ...envelope,
    last_refresh_utc: "s?",
    validation: e(["pass", "fail"], { nul: true }),
    groups: l(
      o({
        name: "s!",
        status: e(FRESH_STATES),
        series: l(o({ label: "s!", id: "s!", key: "s?", provider: "s", freq: e(["daily", "weekly", "monthly"]), first: "s?", last: "s?", feeds: l("s!"), status: e(FRESH_STATES), note: "s?" })),
      }),
    ),
  }),
};

/** The schema for a path. */
export function schemaFor(path: string): Obj | undefined {
  return SCHEMAS[path];
}
