"""scripts/options_bench/phase4a/population.py — Phase 4a's registered synthetic request population (unserved).

Every request is invented: a chain of quotes built from a stated smile, carry and dividend schedule, and a visitor's
thesis (view, target, date, scan window, budget, fill). No provider data. The population is a stream: request i of a
seed depends only on (seed, i), so the first N requests of a seed are the same whatever N is, and a larger run only
adds requests.

Two seeds are registered (docs/desk/OPTIONS_PHASE4A.md, "Registration"):
- DEV_SEED: Phase 4a's development population. Every Phase 4a measurement reads it, and only it.
- RESERVED_SEED: kept untouched for a later registered validation. Phase 4a never generates it: `requests()`
  refuses it unless `allow_reserved=True`, which no Phase 4a script passes.

Quotes are priced by a lattice pair two levels finer than Tier 1's first pair (2N and 4N steps, extrapolated as
Tier 1 extrapolates, without Tier 1's dividend smoothing), so neither serving configuration prices its own data.
It is not a certified reference: its error is far below a cent on most quotes and is stated as a limitation of the
bench, not ignored. Quotes are rounded to the cent around that value with the request's spread, as the test chains
are (tests/options_synth.py).

Strata the population covers (registered weights in SPEC): chain shapes from short weeklies to LEAP-length
expiries, spots from $10 to $800, no dividends to an 8% quarterly yield and monthly payers, volatility levels from
12% to 90%, spreads from 0.5% to 15%, views up and down, targets from 2% to 30% away, dates from a week to 14 months
out, every scan window, budgets from $300 to $100,000, ask and mid fills, and difficult root-finding cases: deep
in-the-money quotes within a tick of intrinsic (low vega), cheap far out-of-the-money quotes, and quotes below
intrinsic (unidentifiable, which the Finder screens).
"""

from __future__ import annotations

import hashlib
import json
import math
import random
from dataclasses import dataclass, field
from datetime import date, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np

from api.calendar import previous_trading_day, session_bounds
from src.desk import options_finder as of
from src.desk import options_math as om

DEV_SEED = 20261116
RESERVED_SEED = 20261117
SESSION = date(2026, 10, 23)
CAL_THROUGH = date(2029, 6, 29)
CURVE_ROWS = {"DGS3MO": [("2026-10-23", 4.10)], "DGS2": [("2026-10-23", 3.70)], "DGS5": [("2026-10-23", 3.80)]}

SPEC = {
    "version": "phase4a-pop-1",
    "session": SESSION.isoformat(),
    "calendar_through": CAL_THROUGH.isoformat(),
    "curve": CURVE_ROWS,
    "shape": {"monthly": 0.35, "weekly": 0.25, "leaps": 0.25, "short": 0.15},
    "spot_log_uniform": [10.0, 800.0],
    "dividends": {"none": 0.30, "quarterly": 0.45, "high_quarterly": 0.15, "monthly": 0.10},
    "yield_range": {"quarterly": [0.003, 0.03], "high_quarterly": [0.04, 0.08], "monthly": [0.02, 0.06]},
    "residual_q": [0.0, 0.005],
    "vol_level": [0.12, 0.90],
    "spread": {"normal": [0.005, 0.06], "wide_share": 0.10, "wide": [0.08, 0.15]},
    "strike_range": [0.40, 1.80],
    "strike_step_share_log_uniform": [0.002, 0.05],
    "difficult_share": 0.30,
    "difficult": {"near_intrinsic": 0.05, "cheap_wings": 0.05, "below_intrinsic": 0.02},
    "view": {"up": 0.5, "down": 0.5},
    "move": [0.02, 0.30],
    "horizon_days": {"near": [7, 30, 0.30], "mid": [30, 120, 0.40], "far": [120, 420, 0.30]},
    "scan_months": {"1": 0.30, "3": 0.30, "6": 0.25, "12": 0.15},
    "budget_log_uniform": [300.0, 100000.0],
    "fill": {"ask": 0.8, "mid": 0.2},
    "commission": 0.65,
    "oi": [50, 5000],
    "pricing": "lattice pair (2N, 4N), 2·h(4N) − h(2N), no dividend smoothing; cents around it",
}


def _closes(through: date) -> dict:
    out, d = {}, SESSION
    while d <= through:
        b = session_bounds(d)
        if b:
            out[d] = b[1].astimezone(timezone.utc)
        d += timedelta(days=1)
    return out


@lru_cache(maxsize=1)
def closes() -> dict:
    return _closes(CAL_THROUGH)


def _pick(rng: random.Random, weights: dict) -> str:
    keys = list(weights)
    return rng.choices(keys, weights=[weights[k] for k in keys])[0]


def _third_friday(y: int, m: int) -> date:
    d = date(y, m, 15)
    return d + timedelta(days=(4 - d.weekday()) % 7)


def _session_on_or_before(d: date) -> date:
    cl = closes()
    while d not in cl:
        d -= timedelta(days=1)
    return d


def expiries(shape: str) -> list[date]:
    months = [(2026 + (10 + i) // 12, (10 + i) % 12 + 1) for i in range(0, 40)]   # Nov 2026 onward
    monthly = [_third_friday(y, m) for y, m in months]
    fridays = [SESSION + timedelta(days=7 * i + (4 - SESSION.weekday()) % 7) for i in range(1, 60)]
    if shape == "short":
        out = fridays[:6]
    elif shape == "weekly":
        out = sorted(set(fridays[:8]) | {e for e in monthly if e <= SESSION + timedelta(days=370)})
    elif shape == "monthly":
        out = [e for e in monthly if e <= SESSION + timedelta(days=430)]
    else:  # leaps: monthlies for a year, then June and January out to about 26 months
        out = sorted({e for e in monthly if e <= SESSION + timedelta(days=370)}
                     | {_third_friday(2027, 6), _third_friday(2028, 1), _third_friday(2028, 6), _third_friday(2028, 12)})
    return [_session_on_or_before(e) for e in out if (e - SESSION).days <= of.MAX_EXPIRY_DAYS and e <= CAL_THROUGH]


def dividends(rng: random.Random, kind: str, spot: float) -> list[dict]:
    if kind == "none":
        return []
    lo, hi = SPEC["yield_range"][kind]
    y = rng.uniform(lo, hi)
    per_year = 12 if kind == "monthly" else 4
    amount = round(spot * y / per_year, 2)
    if amount <= 0:
        return []
    gap = 365 // per_year
    first = SESSION - timedelta(days=rng.randrange(5, gap))
    rows = []
    for i in range(per_year):   # the trailing year's history; the Finder projects the schedule from it
        ex = first - timedelta(days=gap * i)
        rows.append({"ex_date": ex.isoformat(), "cum_session": previous_trading_day(ex).isoformat(), "amount": amount,
                     "period": "Monthly" if per_year == 12 else "Quarterly", "declared_on": None})
    return rows


def smile(level: float, k: float, f: float, tau: float) -> float:
    x = math.log(k / f)
    s = level * (1.0 - 0.5 * x + 1.4 * x * x) + 0.02 / math.sqrt(max(tau, 1 / 52))
    return min(max(s, 0.06), 2.5)


def _price(ctxs: list[om.Context]) -> list[float]:
    """The data's value: max(X, 2·h(4N) − h(2N)), batched by days."""
    out = [math.nan] * len(ctxs)
    groups: dict[int, list[int]] = {}
    for i, c in enumerate(ctxs):
        groups.setdefault(c.days, []).append(i)
    for days, gi in groups.items():
        cs = [ctxs[i] for i in gi]
        hs = {}
        for mult in (2, 4):
            _, _, _, h = om._lattice([c.is_call for c in cs], [c.strike / c.spot for c in cs],
                                     np.array([c.rho for c in cs]), np.array([c.q for c in cs]),
                                     np.array([c.sigma for c in cs]), [[(dd, a / c.spot) for dd, a in c.divs] for c in cs],
                                     days, om.steps_for(days) * mult, with_cont=True)
            hs[mult] = h
        for k, i in enumerate(gi):
            c = ctxs[i]
            ex = (c.spot - c.strike) if c.is_call else (c.strike - c.spot)
            out[i] = max(ex, 2.0 * float(hs[4][k]) * c.spot - float(hs[2][k]) * c.spot)
    return out


def _step(spot: float, share: float) -> float:
    raw = spot * share
    return min((0.5, 1.0, 2.5, 5.0, 10.0, 25.0), key=lambda s: abs(math.log(s / raw)))


@dataclass
class Request:
    seed: int
    index: int
    params: dict
    rows: list = field(repr=False)
    other_rows: list = field(repr=False)
    dividends: list = field(repr=False)
    thesis: object = field(repr=False)
    market: object = field(repr=False)

    def run(self, work_limit: int = of.WORK_LIMIT, **kw) -> dict:
        return of.run(self.rows, self.thesis, self.market, other_rows=self.other_rows,
                      dividends={"status": "ok", "rows": self.dividends}, work_limit=work_limit, **kw)


def request(seed: int, index: int, *, allow_reserved: bool = False) -> Request:
    if seed == RESERVED_SEED and not allow_reserved:
        raise PermissionError("the reserved population is kept untouched for a later registered validation")
    rng = random.Random(f"{SPEC['version']}:{seed}:{index}")
    p: dict = {}
    # the chain
    p["shape"] = _pick(rng, SPEC["shape"])
    lo, hi = SPEC["spot_log_uniform"]
    spot = round(math.exp(rng.uniform(math.log(lo), math.log(hi))), 2)
    p["spot"] = spot
    p["dividends"] = _pick(rng, SPEC["dividends"])
    div_rows = dividends(rng, p["dividends"], spot)
    p["q"] = rng.uniform(*SPEC["residual_q"])
    p["vol_level"] = rng.uniform(*SPEC["vol_level"])
    wide = rng.random() < SPEC["spread"]["wide_share"]
    p["spread"] = rng.uniform(*(SPEC["spread"]["wide"] if wide else SPEC["spread"]["normal"]))
    s_lo, s_hi = SPEC["strike_step_share_log_uniform"]
    step = _step(spot, math.exp(rng.uniform(math.log(s_lo), math.log(s_hi))))
    k_lo, k_hi = SPEC["strike_range"]
    strikes = [round(float(k), 2) for k in np.arange(math.ceil(spot * k_lo / step) * step, spot * k_hi + 1e-9, step)]
    p["strike_step"], p["strikes"] = step, len(strikes)
    p["difficult"] = rng.random() < SPEC["difficult_share"]
    exps = expiries(p["shape"])
    p["expiries"] = len(exps)
    root = f"P{index % 1000:03d}"
    # the thesis
    p["view"] = _pick(rng, SPEC["view"])
    move = rng.uniform(*SPEC["move"])
    target = round(spot * (1 + move) if p["view"] == "up" else spot * (1 - move), 2)
    band = _pick(rng, {k: v[2] for k, v in SPEC["horizon_days"].items()})
    h_lo, h_hi, _ = SPEC["horizon_days"][band]
    by = _session_on_or_before(min(SESSION + timedelta(days=rng.randint(h_lo, h_hi)), exps[-1]))
    months = int(_pick(rng, SPEC["scan_months"]))
    lo_b, hi_b = SPEC["budget_log_uniform"]
    budget = round(math.exp(rng.uniform(math.log(lo_b), math.log(hi_b))), 2)
    fill = _pick(rng, SPEC["fill"])
    p.update(target=target, move=move, horizon=band, by=by.isoformat(), scan_months=months, budget=budget, fill=fill)
    thesis = of.Thesis(p["view"], target, by, budget, scan_months=months, fill=fill, commission=SPEC["commission"])
    kind = "call" if p["view"] == "up" else "put"
    win = of.window(thesis, spot)
    k_lo_d, k_hi_d = win["_bounds"]
    exp_to = date.fromisoformat(win["exp_to"])

    def wanted(e: date, k: float, typ: str) -> bool:
        """Only the rows the scan reads are priced: its candidates, and the other type near the money."""
        if not by <= e <= exp_to:
            return False
        return (k_lo_d <= of._dec(k) <= k_hi_d) if typ == kind else (0.8 * spot <= k <= 1.2 * spot)

    curve, _, _ = of.build_curve(CURVE_ROWS, SESSION)
    divs, _ = of.normalize_dividends(div_rows, spot)
    sched, _ = of.schedule(divs, SESSION, exps[-1], of.Sessions(closes(), CAL_THROUGH))
    ctxs, meta = [], []
    for e in exps:
        days = (e - SESSION).days
        tau = days / om.YEAR_DAYS
        rho = curve.rate(tau)
        dv = of.owed(sched, SESSION, e)
        pv = sum(a * math.exp(-rho * d / om.YEAR_DAYS) for d, a in dv)
        if spot - pv <= 0:
            continue
        fwd = (spot - pv) * math.exp((rho - p["q"]) * tau)
        for k in strikes:
            for typ in ("call", "put"):
                if not wanted(e, k, typ):
                    continue
                sg = smile(p["vol_level"], k, fwd, tau)
                c = om.Context(typ == "call", spot, k, days, rho, p["q"], sg, dv)
                if om.in_domain(c) is None:
                    ctxs.append(c)
                    meta.append((e, k, typ))
    vals = _price(ctxs)
    cands, others = [], []
    tags = {"near_intrinsic": 0, "cheap_wings": 0, "below_intrinsic": 0}
    d = SPEC["difficult"]
    for (e, k, typ), v in zip(meta, vals):
        intrinsic = max(spot - k, 0.0) if typ == "call" else max(k - spot, 0.0)
        half = max(0.01, round(p["spread"] * v / 2, 2))
        bid, ask = math.floor((v - half) * 100) / 100, math.ceil((v + half) * 100) / 100
        u = rng.random()
        if p["difficult"]:
            if u < d["near_intrinsic"] and intrinsic > 0.05 * spot:
                bid, ask = round(intrinsic, 2), round(intrinsic + 0.02, 2)
                tags["near_intrinsic"] += 1
            elif u < d["near_intrinsic"] + d["cheap_wings"] and v < 0.10:
                bid, ask = 0.01, 0.05
                tags["cheap_wings"] += 1
            elif u < d["near_intrinsic"] + d["cheap_wings"] + d["below_intrinsic"] and intrinsic > 0.05:
                bid, ask = round(intrinsic - 0.05, 2), round(intrinsic - 0.01, 2)
                tags["below_intrinsic"] += 1
        oi = rng.randint(*SPEC["oi"])
        if bid < 0.01:
            continue
        row = {"contract": f"{root}{e:%y%m%d}{'C' if typ == 'call' else 'P'}{int(round(k * 1000)):08d}", "type": typ,
               "strike": k, "exp_date": e.isoformat(), "bid": bid, "ask": ask, "bid_session": SESSION.isoformat(),
               "ask_session": SESSION.isoformat(), "open_interest": oi, "implied_vol": None, "delta": None,
               "theta": None, "last_quote": "2026-10-23T20:00:00Z"}
        (cands if typ == kind else others).append(row)
    p["difficult_tags"] = tags
    p["candidates"], p["other_rows"] = len(cands), len(others)
    market = of.Market(SESSION, spot, CURVE_ROWS, closes(), CAL_THROUGH, SESSION, 0, root)
    return Request(seed, index, p, cands, others, div_rows, thesis, market)


def requests(seed: int, n: int, *, allow_reserved: bool = False):
    for i in range(n):
        yield request(seed, i, allow_reserved=allow_reserved)


def registration() -> dict:
    """What is registered: the spec, both seeds, and the hash of this file (the generator's code)."""
    src = Path(__file__).read_bytes()
    return {"spec": SPEC, "dev_seed": DEV_SEED, "reserved_seed": RESERVED_SEED,
            "generator_sha256": hashlib.sha256(src).hexdigest(), "spec_sha256":
            hashlib.sha256(json.dumps(SPEC, sort_keys=True).encode()).hexdigest()}
