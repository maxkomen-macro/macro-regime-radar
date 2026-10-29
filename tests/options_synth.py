"""Synthetic option chains for the Options Finder tests (method finder-2).

Every chain here is invented: a smile, a carry and quotes priced by the engine's own
lattice, with a spread around the value. No provider data is in the repository (it is
public, and real quotes in it could be redistribution). The engine must recover the
inputs these chains were built from: the forward per expiry, each contract's volatility.
"""

from __future__ import annotations

import math
from datetime import date, timedelta, timezone
from functools import lru_cache

from api.calendar import previous_trading_day, session_bounds
from src.desk import options_finder as of
from src.desk import options_math as om

SESSION = date(2026, 10, 23)
S0 = 100.0
Q_TRUE = 0.004
CURVE_ROWS = {"DGS3MO": [("2026-10-23", 4.10)], "DGS2": [("2026-10-23", 3.70)], "DGS5": [("2026-10-23", 3.80)]}
EXPIRIES = [date(2026, 11, 20), date(2026, 12, 18), date(2027, 1, 15), date(2027, 2, 19), date(2027, 3, 19),
            date(2027, 4, 16), date(2027, 5, 21), date(2027, 6, 18), date(2027, 9, 17), date(2027, 12, 17)]
CAL_THROUGH = date(2027, 12, 31)


def _closes() -> dict:
    out, d = {}, SESSION
    while d <= CAL_THROUGH:
        b = session_bounds(d)
        if b:
            out[d] = b[1].astimezone(timezone.utc)
        d += timedelta(days=1)
    return out


CLOSES = _closes()
HIST = [("2026-09-14", 0.51), ("2026-06-13", 0.51), ("2026-03-13", 0.49), ("2025-12-12", 0.49)]
DIV_ROWS = [{"ex_date": ex, "cum_session": previous_trading_day(date.fromisoformat(ex)).isoformat(), "amount": a,
             "period": "Quarterly", "declared_on": None} for ex, a in HIST]


def smile(k: float, f: float, tau: float) -> float:
    x = math.log(k / f)
    return 0.24 - 0.12 * x + 0.35 * x * x + 0.02 / math.sqrt(max(tau, 1 / 52))


def market(root: str = "SYN", spot: float = S0, sessions_behind: int = 0) -> of.Market:
    return of.Market(SESSION, spot, CURVE_ROWS, CLOSES, CAL_THROUGH, SESSION, sessions_behind, root)


def row(contract: str, kind: str, strike: float, exp: date, bid: float, ask: float, sigma: float | None = None,
        oi: float = 500, session: date = SESSION) -> dict:
    return {"contract": contract, "type": kind, "strike": strike, "exp_date": exp.isoformat(), "bid": bid, "ask": ask,
            "bid_session": session.isoformat(), "ask_session": session.isoformat(), "open_interest": oi,
            "implied_vol": sigma, "delta": None, "theta": None, "last_quote": "2026-10-23T20:00:00Z", "_sigma": sigma}


def symbol(root: str, exp: date, kind: str, strike: float) -> str:
    return f"{root}{exp:%y%m%d}{'C' if kind == 'call' else 'P'}{int(round(strike * 1000)):08d}"


def build(spot: float, q: float, div_rows: list[dict], expiries: list[date], strikes: list[float], root: str,
          spread: float = 0.02, oi: float = 500, cents: bool = True) -> tuple[list[dict], dict]:
    """Rows priced by the lattice at each contract's smile volatility, quoted around the value: to the cent,
    or (cents False) symmetric and unrounded, so the mid is the model value."""
    curve, _, _ = of.build_curve(CURVE_ROWS, SESSION)
    divs, _ = of.normalize_dividends(div_rows, spot)
    sched, _ = of.schedule(divs, SESSION, expiries[-1], of.Sessions(CLOSES, CAL_THROUGH))
    ctxs, meta, truth = [], [], {}
    for e in expiries:
        days = (e - SESSION).days
        tau = days / 365
        rho = curve.rate(tau)
        dv = of.owed(sched, SESSION, e)
        pv = sum(a * math.exp(-rho * d / 365) for d, a in dv)
        fwd = (spot - pv) * math.exp((rho - q) * tau)
        truth[e] = fwd
        for k in strikes:
            for kind in ("call", "put"):
                sg = smile(k, fwd, tau)
                ctxs.append(om.Context(kind == "call", spot, k, days, rho, q, sg, dv))
                meta.append((e, k, kind, sg))
    vals, _, _ = om.american(ctxs)
    rows = []
    for (e, k, kind, sg), v in zip(meta, vals):
        v = float(v)
        if cents:
            half = max(0.01, round(spread * v, 2))
            bid, ask = math.floor((v - half) * 100) / 100, math.ceil((v + half) * 100) / 100
        else:
            half = max(0.01, spread * v)
            bid, ask = v - half, v + half
        if bid < 0.01:
            continue
        rows.append(row(symbol(root, e, kind, k), kind, k, e, bid, ask, sg, oi))
    return rows, truth


@lru_cache(maxsize=None)
def chain() -> tuple[tuple[dict, ...], dict]:
    """A $100 stock, quarterly dividends, ten monthly expiries to Dec 2027, $2.50 strikes from 60 to 160."""
    strikes = [60.0 + 2.5 * i for i in range(41)]
    rows, truth = build(S0, Q_TRUE, DIV_ROWS, EXPIRIES, strikes, "SYN")
    return tuple(rows), truth


def rows_for(view: str) -> tuple[list[dict], list[dict]]:
    """Candidates of the view's type, and the other type's near-the-money rows (calibration pairs)."""
    rows, _ = chain()
    kind = "call" if view == "up" else "put"
    return ([dict(r) for r in rows if r["type"] == kind],
            [dict(r) for r in rows if r["type"] != kind and 80 <= r["strike"] <= 120])


def scan(view: str, target: float, by: date, budget: float = 5000.0, months: int = 6, fill: str = "ask",
         commission: float = 0.65, divs: list[dict] | None = None, **kw) -> dict:
    cands, others = rows_for(view)
    t = of.Thesis(view, target, by, budget, scan_months=months, fill=fill, commission=commission)
    return of.run(cands, t, market(), other_rows=others,
                  dividends={"status": "ok", "rows": DIV_ROWS if divs is None else divs}, work_limit=10**12, **kw)


# An AAPL-like weekly chain: $250, weekly expiries to Dec 2027, $5 strikes, a small residual yield.
BIG_S0 = 250.0
BIG_EXPS = [e for e in sorted({date(2026, 10, 30) + timedelta(days=7 * i) for i in range(60)}
                              | {date(2027, 1, 15), date(2027, 6, 18), date(2027, 12, 17)}) if e <= date(2027, 12, 17)]
BIG_HIST = [("2026-08-11", 0.26), ("2026-05-12", 0.26), ("2026-02-10", 0.26)]
BIG_DIV_ROWS = [{"ex_date": ex, "cum_session": previous_trading_day(date.fromisoformat(ex)).isoformat(), "amount": a,
                 "period": "Quarterly"} for ex, a in BIG_HIST]


@lru_cache(maxsize=None)
def big_chain() -> tuple[dict, ...]:
    rows, _ = build(BIG_S0, 0.001, BIG_DIV_ROWS, BIG_EXPS, [float(k) for k in range(150, 451, 5)], "AAPL",
                    spread=0.015, oi=1000)
    return tuple(rows)


def big_scan(view: str, months: int, work_limit: int = 10**12) -> dict:
    rows = big_chain()
    kind = "call" if view == "up" else "put"
    t = of.Thesis(view, 290.0 if view == "up" else 215.0, date(2026, 12, 18), 5000.0, scan_months=months, commission=0.65)
    win = of.window(t, BIG_S0)
    lo, hi = win["_bounds"]
    cands = [dict(r) for r in rows if r["type"] == kind and t.by.isoformat() <= r["exp_date"] <= win["exp_to"]
             and lo <= of._dec(r["strike"]) <= hi]
    others = [dict(r) for r in rows if r["type"] != kind and t.by.isoformat() <= r["exp_date"] <= win["exp_to"]
              and 0.8 * BIG_S0 <= r["strike"] <= 1.2 * BIG_S0]
    return of.run(cands, t, market("AAPL", BIG_S0), other_rows=others,
                  dividends={"status": "ok", "rows": BIG_DIV_ROWS}, work_limit=work_limit)
