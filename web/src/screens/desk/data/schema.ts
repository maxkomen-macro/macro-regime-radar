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
 * - A strict list (a basket's legs) is one fact: one bad row invalidates it.
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
      for (const [key, f] of Object.entries(spec.fields)) {
        if (!(key in v) || v[key] === undefined) {
          if (required(f)) return INVALID;
          continue;
        }
        const c = check(v[key], f);
        if (c !== INVALID) {
          out[key] = c;
          continue;
        }
        if (required(f)) return INVALID;
        const fb = fallback(f);
        if (fb === INVALID) delete out[key];
        else out[key] = fb;
      }
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
const read = o({ label: "s?", text: "s!", tone: "s" });
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

const positionCompact = {
  id: "s!",
  name: "s!",
  instrument: "s!",
  direction: e(["long", "short"]),
  size_nav: "n",
  room_pct: "n",
  to_level: o({ value: "n!", unit: "s" }, { nul: true }),
  opened: "s",
  horizon_days: "n",
  day: "n",
} as const;

const question = o(
  {
    shock: "s!",
    // §12.2: null for a cross.
    window: "n",
    move: e(["up2s", "down2s", "cross_above", "cross_below"], { req: true }),
    while: "s!",
    target: "s!",
    horizon: "n!",
    target_unit: e(["log_return", "log_change", "bp"]),
    display_unit: e(["percent", "bp"]),
    target_label: "s",
  },
  { req: true },
);

const pricePoint = o({ date: "s!", close: "n", ma50: "n", ma200: "n" });
const relPoint = o({ date: "s!", rel: "n" });
const regimeTrend = o({ label: "s!", print: "s", growth: "s", inflation: "s", months_in: "n", since: "s", freq: "s", source: "s" });
const BANDS = ["low", "elevated", "high_risk"] as const;
const recessionScore = { score: "n", probability_month: "s", inputs_through: "s", band: e(BANDS), band_edges: t(["n!", "n!"], { nul: true }), freq: "s", source: "s" } as const;
const nextPrint = o({ date: "s!", flip_threshold_mom: "n", flips_to: "s?" }, { nul: true });
const curvePoint = o({ "3m": "n", "2y": "n", "5y": "n", "10y": "n", "30y": "n", date: "s" });
const basketLeg = o({ symbol: "s!", name: "s?", weight: "n!" });
const priced = {
  prices_as_of: "s",
  benchmark: o({ symbol: "s!", label: "s!" }),
  ret_3m: "n",
  bench_ret_3m: "n",
  residual: "n",
  residual_window: "n",
  falsifies_at: "n",
  month_ago: "n",
  vol: "n",
  bench_vol: "n",
  vol_ratio: "n",
  beta: "n",
  series: l(o({ date: "s!", value: "n" })),
  reads: reads(["chart", "beta"]),
} as const;

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
  skew_band_edges: t(["n!", "n!"], { nul: true }),
  reads: reads(["skew", "iv_rv", "term_meaning", "term", "gauge"]),
} as const;
const SECTORS = {
  window_months: "n",
  leadership: l(o({ etf: "s!", name: "s!", short: "s", rel_ret: "n" })),
  pattern: "s",
  breadth: o({
    above_50: o({ n: "n", of: "n", month_ago: "n", by_etf: m("b") }),
    above_200: o({ n: "n", of: "n", by_etf: m("b"), broad: "b" }),
    eqw_vs_cap_3m: "n",
    eqw_vs_cap_series: l(relPoint),
    small_vs_large_series: l(relPoint),
  }),
  reads: reads(["leadership_brief", "leadership", "breadth"]),
  words: o({ pattern: "s", above_200: "s", eqw: "s" }),
  error: "s",
  missing: l("s"),
} as const;

export const SCHEMAS: Readonly<Record<string, Obj>> = {
  "/overview": o({
    ...envelope,
    since_last_close: o({
      new_fires: l(o({ slug: "s!", label: "s!" })),
      still_firing: l(o({ slug: "s!", label: "s!", day: "n" })),
      vol_change_pts: "n",
      regime_changed: "b",
      regime_from: "s?",
      regime_to: "s?",
      refreshed_at_utc: "s",
    }),
    tiles: o({
      regime: regimeTrend,
      recession: o({ ...recessionScore }),
      // The trend tile names the trend from its two flags: without both it says nothing (Codex G1-9).
      trend: o({ above_50: "b!", above_200: "b!", since: "s", since_signal: "s", since_verdict: e(VERDICTS), date: "s" }),
      vol: o({ vix: "n", date: "s", freq: "s", source: "s" }),
    }),
    active_signals: l(ledgerRow),
    monitored: l(o(positionCompact)),
    data_status: "s",
  }),
  "/ledger": o({ ...envelope, verdict_rule: "s", horizon: "n", comparison_session: "s?", prev_session: "s?", scored_n: "n", unavailable_n: "n", signals: l(ledgerRow) }),
  "/technicals": o({
    ...envelope,
    instrument: o({ symbol: "s!", label: "s!" }),
    price: "n",
    chg_1d: "n",
    ma50: "n",
    ma200: "n",
    vs_ma50: "n",
    vs_ma200: "n",
    ret_1y: "n",
    trend: "s",
    move_20d_sigma: "n",
    move_20d_word: "s",
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
    current: o({ label: "s", print: "s", latest_print: "s", growth: "s", inflation: "s", months_in: "n", since: "s", freq: "s", source: "s" }),
    history: l(o({ month: "s!", regime: "s!" })),
    recession: o({
      ...recessionScore,
      feature_months: m("s!"),
      year_ago: o({ score: "n", probability_month: "s" }, { nul: true }),
      peak: o({ score: "n", probability_month: "s", window: "s" }, { nul: true }),
      training: o({ start: "s!", end: "s!" }, { nul: true }),
      methodology: "s",
    }),
    stats: l(o({ regime: "s!", months: "n", spx_mo: "n", up_pct: "n", vix_avg: "n", stock_bond_corr: "n" })),
    next_prints: o({ cpi: nextPrint, indpro: nextPrint }),
    changes: l(o({ month: "s!", from: "s!", to: "s!", spx_1m: "n" })),
    reads: reads(["stats", "changes"]),
  }),
  "/macro": o({
    ...envelope,
    curve: o({ today: curvePoint, month_ago: curvePoint, "2s10s_bp": "n", "2s10s_chg_bp": "n", "10y_chg_bp": "n" }),
    stock_bond: o({
      today: "n",
      year_ago: "n",
      flipped: "s?",
      hedging: "b?",
      words: o({ today: "s", year_ago: "s", flipped: "s" }),
      series: l(o({ date: "s!", corr: "n" })),
    }),
    credit: o({
      hy: "n",
      hy_pct_3y: "n",
      hy_range_3y: t(["n", "n"], { nul: true }),
      ig: "n",
      series: l(o({ date: "s!", hy: "n" })),
      peak_12m: o({ date: "s!", hy: "n" }, { nul: true }),
      band_edges: t(["n!", "n!"], { nul: true }),
      words: o({ hy: "s", ig: "s", range: "s" }),
    }),
    correlations: l(o({ asset: "s!", corr: "n", meaning: "s" })),
    // The matrix is one grid: its names and every row of values, or nothing (Codex G1-5).
    matrix: o({ assets: l("s!", { req: true, strict: true }), labels: l("s!", { strict: true }), window: "n", values: l(l("n", { strict: true }), { req: true, strict: true }) }),
    reads: reads(["curve", "front_end", "stock_bond", "credit", "correlations"]),
  }),
  "/study": o({
    ...envelope,
    inputs_hash: "s",
    served_from_cache: "b",
    elapsed_ms: "n",
    slug: "s?",
    // Every number in a study answers its question: without its six slots nothing can be labelled (Codex G1-1).
    question,
    matched_n: "n",
    selected_horizon: "n",
    sample_start: "s?",
    firing_now: "b",
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
        worst: o({ ret: "n", date: "s" }, { nul: true }),
        best: o({ ret: "n", date: "s" }, { nul: true }),
      }),
    ),
    by_regime: l(o({ h: "n", regime: "s!", n: "n", up_pct: "n", median: "n" })),
    unlabeled_n: "n",
    last_events: l(o({ date: "s!", regime: "s", ret_20: "n" })),
    provenance: o({ bootstrap: "n", entry: "s", cooldown: "n", series_start: m("s!") }),
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
        available: "b!",
        unavailable: o({ reason: "s!", until: "s?" }, { nul: true }),
        question: o({ shock: "s!", window: "n", move: e(["up2s", "down2s", "cross_above", "cross_below"], { req: true }), while: "s!", target: "s!" }, { nul: true }),
        allowed_horizons: l("n!"),
      }),
    ),
  }),
  "/study/events": o({ ...envelope, slug: "s?", events: l(o({ date: "s!", regime: "s", ret_5: "n", ret_10: "n", ret_20: "n", ret_60: "n" })) }),
  "/positions": o({
    ...envelope,
    positions: l(
      o({
        ...positionCompact,
        falsifies_at: o({ label: "s!", value: "n", unit: "s?" }, { nul: true }),
        now: o({ value: "n", unit: "s", date: "s" }, { nul: true }),
        dv01: "n",
        variant: "s",
        pre_mortem: "s",
        red_team: "s",
        study_slug: "s?",
      }),
    ),
    closed_90d: o({ falsified: "n", expired: "n", premortem_right: t(["n", "n"], { nul: true }) }),
  }),
  "/pipeline": o({
    ...envelope,
    last_refresh_utc: "s?",
    validation: "s",
    groups: l(
      o({
        name: "s!",
        source: "s",
        freq: "s",
        status: "s",
        status_text: "s",
        note: "s?",
        series: l(o({ label: "s!", id: "s!", from: "s", as_of: "s", feeds: l("s!"), status: "s", note: "s?" })),
      }),
    ),
  }),
  "/basket": o({
    ...envelope,
    ...priced,
    id: "s!",
    name: "s!",
    short: "s",
    instrument: "s",
    rebalance: "s",
    baskets: l(o({ id: "s!", name: "s!" })),
    // A basket's legs are its composition: one bad leg and the basket cannot be read as served (Codex G1-6).
    legs: l(basketLeg, { req: true, strict: true }),
  }),
  "/basket/price": o({ ...envelope, ...priced, legs: l(basketLeg) }),
  "/hedge": o({
    ...envelope,
    mode: "s",
    subject: o({ kind: "s", id: "s?", label: "s!" }),
    surface: "s",
    surface_as_of: "s",
    provider: "s",
    beta: "n",
    options: l(
      o({
        id: "s!",
        label: "s!",
        underlying: "s",
        cost_pct: "n",
        breakeven: "n",
        max_loss: "n",
        protected_range: o({ ndx_from: "n!", ndx_to: "n!", basis: e(["strikes", "table_floor"], { req: true }) }, { nul: true }),
        note: "s",
        hedge_per_100: "n",
        delta: "n",
        legs: l(o({ right: e(["put", "call"], { req: true }), strike: "n!", qty: "n!" }), { strict: true }),
        theta_pct_week: "n",
        roll: o({ date: "s", days: "n", at_dte: "n" }, { nul: true }),
        scenarios: l(o({ ndx: "n!", basket: "n!", hedged: "n!" })),
        scenario_note: "s",
      }),
    ),
    recommended: "s?",
    reads: reads(["why_index", "recommendation"]),
  }),
};

/** The schema for a path (`/basket/<id>` reads as `/basket`). */
export function schemaFor(path: string): Obj | undefined {
  return SCHEMAS[path] ?? (path.startsWith("/basket/") && path !== "/basket/price" ? SCHEMAS["/basket"] : undefined);
}
