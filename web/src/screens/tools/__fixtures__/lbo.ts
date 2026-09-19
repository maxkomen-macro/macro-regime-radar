/**
 * LBO fixtures for the Phase 9 suites (docs/redesign-v2/checklists/09-tools.md
 * section E.1): the `/api/lbo/defaults` payload in the Phase 6 shape, its two
 * variants (the engine's "unavailable" fallback; the error branch is simply an
 * unmatched route, which stubFetch answers 404), a `/api/credit/metrics` body
 * for the Credit state row, and a deterministic `/api/lbo/run` stub that
 * answers from the posted body with the engine's own algebra
 * (src/analytics/lbo.py run_lbo_model), so a slider move is observable and the
 * served identities the equity bridge relies on hold: entry_equity = entry_ev
 * + fees - entry_debt, exit_equity = exit_ev - exit_debt, exit_ev - entry_ev =
 * growth + multiple change. Dated Sep 2026; every expected number in the
 * suites is computed from `lboModel`, never the mockup's 10.0x / 6.0x / 7% deal.
 */
import type { CreditMetrics, LboDefaults, LboRequest, LboResponse, LboResult, LboSensitivity, LboYear } from "../../../api/types";
import { BASE_INPUTS } from "../lbo-deal";

/** Saturday Sep 12 2026, 15:00Z: the Sep 01 monthly stamp is 11 days old (current), the Aug 2026 return history 42 days (current). */
export const NOW = new Date("2026-09-12T15:00:00Z");

export const LIVE_RATE = 6.98;
export const LBO_DEFAULTS: LboDefaults = { fedfunds: 4.33, hy_oas_pct: 2.65, lbo_all_in_rate: LIVE_RATE, data_as_of: "2026-09-01" };
/** The engine's module fallback payload (lbo.py:32-37): FRED rows missing, stamped "unavailable". */
export const LBO_DEFAULTS_FALLBACK: LboDefaults = { fedfunds: 5.33, hy_oas_pct: 3.27, lbo_all_in_rate: 8.6, data_as_of: "unavailable" };
/** The stated fallback rate the calculator runs at with no live rate on file. */
export const STATED_RATE = 8.5;

/** The default deal at the live rate: what the base run posts at rest. */
export const BASE_REQ: LboRequest = { ...BASE_INPUTS, interest_rate: LIVE_RATE };

/** The server's exact not-viable message, em-dash included: the `tidyProse` input the outputs card must clean. */
export const LEVERAGE_MSG = "Leverage too high — debt exceeds entry EV plus fees";
export const UNDERWATER_MSG = "Deal underwater at exit";

/** Only `credit_label` is read on this tab (the Credit state row). */
export const CREDIT_METRICS = { credit_label: "Normal", credit_label_color: "#2ecc71", hy_oas: 2.65, ig_oas: 0.81, data_as_of: "2026-09-01" } as unknown as CreditMetrics;

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * The engine's algebra on one request. The not-viable gate follows the
 * checklist's stub rule (leverage at or above the entry multiple, with the
 * server's exact message); the engine's own gate is `entry_equity <= 0`, one
 * fee margin wider, which the e2e spec accounts for against the real server.
 */
const CASH_FOR_DEBT_SERVICE = 0.6;

export function lboModel(r: LboRequest): LboResult {
  const entry_ev = r.ebitda * r.entry_multiple;
  const entry_debt = r.ebitda * r.leverage_ratio;
  const fees = (entry_ev * r.mgmt_fee_pct) / 100;
  const entry_equity = entry_ev + fees - entry_debt;
  if (r.leverage_ratio >= r.entry_multiple || entry_equity <= 0) {
    return {
      entry_ev: r2(entry_ev),
      entry_debt: r2(entry_debt),
      entry_equity: r2(entry_equity),
      exit_ev: null,
      exit_debt: null,
      exit_equity: null,
      moic: null,
      irr: null,
      equity_gain: null,
      schedule: [],
      viable: false,
      error_msg: LEVERAGE_MSG,
    };
  }
  // B1 (2026-09-18): cash for debt service is 60% of EBITDA; it pays interest
  // first (a shortfall is added to the debt), the remainder sweeps against the
  // debt (the amortization floor is part of that sweep), and cash left once the
  // debt is repaid builds up for equity at exit. Mirrors lbo.py run_lbo_model.
  const schedule: LboYear[] = [];
  let debtStart = entry_debt;
  let cashBalance = 0;
  for (let year = 1; year <= r.hold_period; year++) {
    const ebitda = r.ebitda * (1 + r.ebitda_growth_rate / 100) ** year;
    const cash = ebitda * CASH_FOR_DEBT_SERVICE;
    const interest = (debtStart * r.interest_rate) / 100;
    const interestPaid = Math.min(interest, cash);
    const principal = Math.min(debtStart, cash - interestPaid);
    cashBalance += cash - interestPaid - principal;
    const debtEnd = debtStart - principal + (interest - interestPaid);
    schedule.push({ year, ebitda: r2(ebitda), implied_ev: r2(ebitda * r.exit_multiple), debt_start: r2(debtStart), debt_end: r2(debtEnd), interest: r2(interest) });
    debtStart = debtEnd;
  }
  const exit_ev = r.ebitda * (1 + r.ebitda_growth_rate / 100) ** r.hold_period * r.exit_multiple;
  const exit_debt = debtStart;
  const exit_equity = exit_ev - exit_debt + cashBalance;
  if (exit_equity <= 0) {
    return {
      entry_ev: r2(entry_ev),
      entry_debt: r2(entry_debt),
      entry_equity: r2(entry_equity),
      exit_ev: r2(exit_ev),
      exit_debt: r2(exit_debt),
      exit_equity: r2(exit_equity),
      moic: null,
      irr: null,
      equity_gain: r2(exit_equity - entry_equity),
      schedule,
      viable: false,
      error_msg: UNDERWATER_MSG,
    };
  }
  const moic = exit_equity / entry_equity;
  // One terminal cash flow: the engine's binary search converges to the closed form.
  const irr = r2((moic ** (1 / r.hold_period) - 1) * 100);
  return {
    entry_ev: r2(entry_ev),
    entry_debt: r2(entry_debt),
    entry_equity: r2(entry_equity),
    exit_ev: r2(exit_ev),
    exit_debt: r2(exit_debt),
    exit_equity: r2(exit_equity),
    moic: r3(moic),
    irr,
    equity_gain: r2(exit_equity - entry_equity),
    schedule,
    viable: true,
    error_msg: "",
  };
}

const half = (x: number) => Math.round(x * 2) / 2;
const axis = (c: number) => [-1, -0.5, 0, 0.5, 1].map((d) => c + d).filter((v) => v >= 3 && v <= 20);

/**
 * The 5x5 grid api/main.py builds: five entry and five exit multiples around
 * the half-rounded centres (clipped to the 3 to 20 range), every cell a full
 * run. The lowest-entry x lowest-exit corner is forced to null so an "n/a"
 * cell is always on the grid. (JS rounds .25 halves up where Python rounds to
 * even; no fixture request sits on a quarter, so the centres agree.)
 */
export function lboSensitivity(r: LboRequest): LboSensitivity {
  const ec = half(r.entry_multiple);
  const xc = half(r.exit_multiple);
  const entry = axis(ec);
  const exit = axis(xc);
  const grid = entry.map((em) =>
    exit.map((xm) => {
      const cell = lboModel({ ...r, entry_multiple: em, exit_multiple: xm });
      return cell.viable ? cell.irr : null;
    }),
  );
  if (grid.length && grid[0].length) grid[0][0] = null;
  return { entry_multiples: entry, exit_multiples: exit, entry_center: ec, exit_center: xc, irr_grid: grid };
}

/** Every body the screen posted to /api/lbo/run, in order. Reset it in beforeEach. */
export const posted: LboRequest[] = [];

/** The `/api/lbo/run` stub: reads the posted body and answers deterministically. */
export function lboRun(_url: URL, init?: RequestInit): LboResponse {
  const body = JSON.parse(String(init?.body)) as LboRequest;
  posted.push(body);
  return { result: lboModel(body), sensitivity: lboSensitivity(body) };
}

/** A run stub that answers the given result for every body (the not-viable and error branches). */
export const lboRunFixed = (result: LboResult) => (_url: URL, init?: RequestInit): LboResponse => {
  const body = JSON.parse(String(init?.body)) as LboRequest;
  posted.push(body);
  return { result, sensitivity: lboSensitivity(body) };
};

/** The existing LboPanel case's not-viable shape (schedule empty, no exit_debt on the wire). */
export const NOT_VIABLE_LEGACY = {
  viable: false,
  error_msg: "gated",
  entry_ev: 800,
  entry_debt: 450,
  entry_equity: 400,
  exit_equity: null,
  irr: null,
  moic: null,
  schedule: [],
} as unknown as LboResult;

export type LboRoutes = Record<string, (url: URL, init?: RequestInit) => unknown>;

/** The three routes the LBO tool reads. Key order matters only for prefix collisions; none here. */
export function lboRoutes(over: LboRoutes = {}): LboRoutes {
  return {
    "/api/lbo/defaults": () => LBO_DEFAULTS,
    "/api/lbo/run": lboRun,
    "/api/credit/metrics": () => CREDIT_METRICS,
    ...over,
  };
}
