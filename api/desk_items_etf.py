"""api/desk_items_etf.py — the Desk's ETF blocks (desk/fill-etf).

One worker item, `desk_etf` (api/analytics_cache.ITEMS), rebuilt with every
generation, reads the ETFs the full refresh stores in `asset_prices`
(src/desk/series.py, src/market_data/asset_history.py) through the engine's
reader (`event_study.load_level`: completed sessions, provenance-aware,
nothing after the generation's as-of) and computes the blocks the Sectors,
Technicals and Macro tabs serve (DESK_FRAME3_SPEC §12.7, §12.8, §12.14). Each
block is stored as a part (api/desk_items_macro.part), so one that cannot be
computed awaits with its reason while the others serve.

Every series is aligned onto the XNYS session calendar the engine uses
(`event_study.session_calendar`), a session without a close is a gap and is
never filled, and a price that is not finite and positive is a gap too
(`validate_values`). A statistic that needs a close the store does not hold
(before a series' first close, as for XLC before 2018-06-19 and XLRE before
2015-10-08, or a missing session) is null with the reason, never a value.

Rules (the spec names each):
- Sector leadership (§12.14, v3 A-18): over the 60 XNYS sessions to `t`, the
  newest session with an SPY close, rel = ln(P(t)/P(t−60)) − ln(SPY(t)/SPY(t−60))
  on adjusted closes; ranked best first, the rows without one last. Band
  ±0.01 (the bars' green, gray and red).
- Pattern `sector-pattern-v1`: the mean rel of the six cyclical sector ETFs
  (XLB, XLE, XLF, XLI, XLK, XLY) less the mean rel of the three defensive ones
  (XLP, XLU, XLV); XLC and XLRE are in neither group. Above +0.01 "cyclical",
  below −0.01 "defensive", otherwise "mixed"; null unless all nine are served.
- Breadth (§12.14), on the same session `t`, of the eleven sector ETFs only
  (never stocks): a sector is above its 50-day (200-day) average when its close
  on `t` is strictly above the simple mean of its closes over the 50 (200)
  XNYS session slots ending at `t`, every slot holding a close (the §12.7 rule
  for the S&P's averages); one without that close or those slots is "not
  available" with the reason, counted in neither `n` nor `of`. Equal against
  cap weight is RSP's 60-session log return less SPY's, small caps against
  large IWM's; each one-year line is that same 60-session difference on every
  session of the twelve months to `t`.
- Stock–bond correlation (§12.8 `stock_bond`): Pearson's correlation of SPY's
  and TLT's daily log returns (a return on a session needs that session's
  close and the previous session's) over the 60 XNYS return dates ending at
  `t`, the newest session both close on, every pair complete (no forward
  fill); null otherwise. A year ago: the same on the last session on or
  before `t` − 12 calendar months. Flipped: the session whose correlation
  took the sign it holds today, the newest change of sign among the sessions
  with a complete window (a zero or incomplete one is skipped).
- What moves with the S&P (§12.8 `correlations`): the same 60-date Pearson
  correlation of SPY's daily log returns with TLT, IEF, HYG, LQD, GLD, UUP,
  IWM and QQQ (adjusted closes, daily log returns) and, when the store holds
  it, VIX (^VIX, the CBOE close in asset_prices since desk/fill-compute, daily
  log changes of the level), each on its own
  newest session both series hold a value.
- The 12-asset matrix (§12.8 `matrix`, desk/matrix): the same 60-date Pearson
  correlation (`corr_at`) of every pair of SPY, QQQ, IWM, SMH, XLE, TLT, IEF,
  HYG, LQD, GLD, UUP and ^VIX, all ending at one session `t`, the newest on
  which every asset with a valid close has one (Codex R-03: a stored asset
  without any valid close takes no part in choosing it and is "no data" with
  that reason). An asset not stored, or without 60
  complete daily returns (or with no variation) to `t`, is "no data": its row
  and column are null with its reason, never filled. The requested horizon
  (`horizon`, 60) is served apart from what was observed (Codex R-02):
  `window.n` counts the return dates the calendar holds in the window, and
  `coverage` the returns each asset holds there. The lead
  (`matrix-lead-v1`) states whether Treasuries are hedging equities (SPY
  against TLT below zero) and the highest and lowest pairs, from the served
  cells only.

Stdlib at import; numpy, pandas and the engine are imported at the point of
use. The connection is closed in a `finally` (verifier V-54).
"""

from __future__ import annotations

import math
from typing import Any

from api import desk_envelope as env

WINDOW_SESSIONS = 60   # v3 A-18: t − 60 XNYS sessions, "3 months"
WINDOW_MONTHS = 3
BAND = 0.01            # the ±1% band of the leadership bars and the pattern rule
PATTERN_RULE = "sector-pattern-v1"
BENCHMARK = "spy"
SOURCE = "asset_prices"
PROVIDER_WORDS = {"eodhd": "EODHD", "yfinance": "Yahoo"}


def _fin(x: Any) -> bool:
    return isinstance(x, (int, float)) and math.isfinite(x)


def _f(x: Any) -> float | None:
    return float(x) if x is not None and math.isfinite(float(x)) else None


class Store:
    """The stored closes of a set of registry series on one XNYS calendar:
    `px[key]` a float array over `sessions` (NaN for a session without a close),
    `first[key]` each series' first stored close, `providers` the providers of
    the rows read. A series the store lacks is absent from `px`."""

    def __init__(self, conn: Any, keys: list[str], cutoff: str) -> None:
        import numpy as np
        import pandas as pd

        from src.desk import event_study as es
        from src.desk import series as registry

        raw: dict[str, Any] = {}
        self.missing: list[str] = []
        self.regimes: Any = None   # the stored regime rows by month (event_study.load_regimes), set by desk_etf
        self._labels: Any = None
        for k in keys:
            try:
                raw[k] = es.load_level(conn, registry.get(k), cutoff)
            except es.NotStored:
                self.missing.append(k)
        self.first = {k: s.index[0].strftime("%Y-%m-%d") for k, s in raw.items()}
        self.last = {k: s.index[-1].strftime("%Y-%m-%d") for k, s in raw.items()}
        self.rows = {k: len(s) for k, s in raw.items()}  # the rows read, before alignment and validation
        self.providers: list[str] = []
        self.provider_by: dict[str, set[str]] = {}
        sym_key = {registry.get(k).series_id: k for k in raw if registry.get(k).table == "asset_prices"}
        if sym_key:
            marks = ",".join("?" * len(sym_key))
            for sym, prov in conn.execute(
                    f"SELECT DISTINCT symbol, provider FROM asset_prices WHERE interval = '1d' AND symbol IN ({marks})", list(sym_key)):
                self.provider_by.setdefault(sym_key[sym], set()).add(prov)
            self.providers = sorted(set().union(*self.provider_by.values())) if self.provider_by else []
        if not raw:
            self.sessions = pd.DatetimeIndex([])
            self.iso: list[str] = []
            self.px: dict[str, Any] = {}
            return
        start = min(s.index[0] for s in raw.values()).strftime("%Y-%m-%d")
        end = max(s.index[-1] for s in raw.values()).strftime("%Y-%m-%d")
        self.sessions = es.sessions_between(es.session_calendar(start, end), start, end)
        self.iso = [d.strftime("%Y-%m-%d") for d in self.sessions]
        self.px = {}
        for k, s in raw.items():
            al, _off, _gaps = es.align(s, self.sessions)
            al, _bad, _why = es.validate_values(al, registry.get(k))
            self.px[k] = al.to_numpy(dtype=float)
        self._np = np

    def labels(self):
        """Each session's regime label under the engine's rule (event_study.regime_at: a session in month K takes
        the row stamped K − 2, else Unlabeled), as an object array over `sessions`; None without regime rows."""
        import numpy as np

        from src.desk import event_study as es

        if self.regimes is None or len(self.regimes) == 0:
            return None
        if self._labels is None:
            self._labels = np.asarray(es.regime_at(self.sessions, self.regimes), dtype=object)
        return self._labels

    def providers_of(self, keys) -> list[str]:
        """The providers of the stored series among `keys`, the ones a block reads
        (desk/fill-compute: the store also holds the VIX, which only the
        correlations read, so a block names its own series' providers only)."""
        return sorted(set().union(*(self.provider_by.get(k, set()) for k in keys)))

    def has(self, key: str) -> bool:
        return key in self.px

    def newest(self, key: str) -> int | None:
        """The index of the newest session with a close of `key`."""
        if key not in self.px:
            return None
        idx = self._np.flatnonzero(self._np.isfinite(self.px[key]))
        return int(idx[-1]) if len(idx) else None

    def close(self, key: str, i: int) -> float | None:
        if key not in self.px or i < 0:
            return None
        v = float(self.px[key][i])
        return v if math.isfinite(v) else None

    def gap_reason(self, key: str, i: int) -> str | None:
        """Why `key` has no close on session i: before its first close, or a gap."""
        if key not in self.px:
            return "not stored in this database"
        if i < 0:
            return "no session that far back in the stored calendar"
        if self.close(key, i) is not None:
            return None
        day = self.iso[i]
        if day < self.first[key]:
            return f"no close on {day}: its history starts {self.first[key]}"
        return f"no close stored for {day}"

    def log_ret(self, key: str, i: int, j: int) -> tuple[float | None, str | None]:
        """ln(P(i)/P(j)), or null with the reason."""
        a, b = self.close(key, i), self.close(key, j)
        if a is None or b is None:
            return None, self.gap_reason(key, i if a is None else j)
        return math.log(a / b), None


def awaiting_refresh(symbols: list[str]) -> env.Awaiting:
    """A block whose inputs this database predates (the full refresh stores them)."""
    names = ", ".join(symbols)
    return env.Awaiting(f"Awaiting refresh: the full refresh stores {names}; this database predates it.")


def provider_words(providers: list[str]) -> list[str]:
    return [PROVIDER_WORDS.get(p, p) for p in providers]


# ── Sector leadership (§12.14) ──────────────────────────────────────────────

def leadership(store: Store) -> dict:
    """The sectors block's leadership part: each sector ETF's 60-session log
    return less SPY's, ranked, and the pattern word by its rule."""
    from src.desk import series as registry

    sectors = [(t, name, short, group) for t, name, short, group in registry.SECTOR_ETFS]
    keys = [t.lower() for t, *_ in sectors]
    if not store.has(BENCHMARK) or not any(store.has(k) for k in keys):
        raise awaiting_refresh([registry.get(k).series_id for k in (BENCHMARK, *keys) if not store.has(k)])
    t = store.newest(BENCHMARK)
    if t is None or t - WINDOW_SESSIONS < 0:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    t0 = t - WINDOW_SESSIONS
    spy, _why = store.log_ret(BENCHMARK, t, t0)
    if spy is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    rows = []
    for tick, name, short, group in sectors:
        own, why = store.log_ret(tick.lower(), t, t0)
        rows.append({"etf": tick, "name": name, "short": short, "group": group,
                     "rel_ret": None if own is None else own - spy, "ret": own,
                     "first": store.first.get(tick.lower()), "reason": why})
    served = sorted((r for r in rows if r["rel_ret"] is not None), key=lambda r: (-r["rel_ret"], r["etf"]))
    rows = served + [r for r in rows if r["rel_ret"] is None]
    # Codex R-01: the ranking is only among the sectors with data; the rest are named with their reason
    missing = [{"etf": r["etf"], "name": r["name"], "reason": r["reason"]} for r in rows if r["rel_ret"] is None]
    return {
        "window_months": WINDOW_MONTHS,
        "window": {"start": store.iso[t0], "end": store.iso[t], "n": WINDOW_SESSIONS},
        "compared_on": store.iso[t],
        "unit": "log_return",
        "band": BAND,
        "benchmark": {"etf": "SPY", "name": "S&P 500 ETF", "ret": spy},
        "leadership": rows,
        "ranked_n": len(served),
        "missing": missing,
        "pattern": pattern(rows),
        "date": store.iso[t],
        "freq": "daily",
        "source": SOURCE,
        "providers": provider_words(store.providers_of([BENCHMARK, *SECTOR_KEYS])),
    }


def pattern(rows: list[dict]) -> dict:
    """`sector-pattern-v1`: the cyclical group's mean rel less the defensive
    group's; the word by the ±BAND rule, null unless every member is served."""
    groups: dict[str, list[dict]] = {"cyclical": [], "defensive": []}
    for r in rows:
        if r["group"] in groups:
            groups[r["group"]].append(r)
    out = {"rule": PATTERN_RULE, "band": BAND,
           "cyclicals": sorted(r["etf"] for r in groups["cyclical"]),
           "defensives": sorted(r["etf"] for r in groups["defensive"]),
           "word": None, "spread": None, "reason": None}
    lost = sorted(r["etf"] for g in groups.values() for r in g if r["rel_ret"] is None)
    if lost:
        out["reason"] = f"{', '.join(lost)} not served, so the groups cannot be compared."
        return out
    mean = {g: sum(r["rel_ret"] for r in rs) / len(rs) for g, rs in groups.items()}
    spread = mean["cyclical"] - mean["defensive"]
    out["spread"] = spread
    out["word"] = "cyclical" if spread > BAND else "defensive" if spread < -BAND else "mixed"
    return out


# ── Breadth (§12.14) ────────────────────────────────────────────────────────

MA_WINDOWS = (50, 200)
LINE_MONTHS = 12


def above_average(store: Store, key: str, t: int, w: int) -> tuple[bool | None, str | None]:
    """Whether `key`'s close on session t is strictly above the mean of its
    closes over the w session slots ending at t; null with the reason when
    that close or any slot's close is not stored."""
    lo = t - w + 1
    if lo < 0:
        return None, "no session that far back in the stored calendar"
    px = store.px.get(key)
    if px is None:
        return None, "not stored in this database"
    window = px[lo:t + 1]
    gaps = [i for i, v in enumerate(window) if not math.isfinite(float(v))]
    if gaps:
        return None, store.gap_reason(key, lo + gaps[0])
    return bool(float(px[t]) > float(window.mean())), None


def relative_line(store: Store, key: str, t: int) -> tuple[float | None, str | None, list[dict], dict]:
    """`key` against SPY: its 60-session log return less SPY's on t (with the
    reason when null), and the same difference on every session of the twelve
    months to t, a point null where a close it needs is not stored."""
    import pandas as pd

    rel, why = None, None
    own, why = store.log_ret(key, t, t - WINDOW_SESSIONS)
    spy, why_spy = store.log_ret(BENCHMARK, t, t - WINDOW_SESSIONS)
    if own is not None and spy is not None:
        rel = own - spy
    else:
        why = why or why_spy
    since = store.sessions[t] - pd.DateOffset(months=LINE_MONTHS)
    first = int(store.sessions.searchsorted(since, side="right"))
    points = []
    for i in range(first, t + 1):
        a, _ = store.log_ret(key, i, i - WINDOW_SESSIONS)
        b, _ = store.log_ret(BENCHMARK, i, i - WINDOW_SESSIONS)
        points.append({"date": store.iso[i], "rel": None if a is None or b is None else a - b})
    window = {"start": store.iso[first], "end": store.iso[t], "n": len(points)}
    return rel, why, points, window


def breadth(store: Store) -> dict:
    """The /sectors breadth block: the eleven sector ETFs against their 50-
    and 200-day averages, RSP and IWM against SPY, all on session t."""
    from src.desk import series as registry

    keys = [t.lower() for t, *_ in registry.SECTOR_ETFS]
    if not store.has(BENCHMARK) or not any(store.has(k) for k in keys):
        raise awaiting_refresh([registry.get(k).series_id for k in (BENCHMARK, *keys) if not store.has(k)])
    t = store.newest(BENCHMARK)
    if t is None or t - WINDOW_SESSIONS < 0:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    out: dict[str, Any] = {"compared_on": store.iso[t], "of_total": len(keys)}
    for w in MA_WINDOWS:
        by, lost = {}, []
        for (tick, *_rest), k in zip(registry.SECTOR_ETFS, keys):
            above, why = above_average(store, k, t, w)
            if above is None:
                lost.append({"etf": tick, "reason": why})
            else:
                by[tick] = above
        out[f"above_{w}"] = {"n": sum(by.values()), "of": len(by), "compared_on": store.iso[t],
                             "window": {"start": store.iso[max(t - w + 1, 0)], "end": store.iso[t], "n": w},
                             "by_etf": by, "not_available": lost}
    for name, key in (("eqw_vs_cap", "rsp"), ("small_vs_large", "iwm")):
        if store.has(key):
            rel, why, points, window = relative_line(store, key, t)
        else:
            rel, why, points, window = None, awaiting_refresh([key.upper()]).reason, [], None
        out[f"{name}_3m"] = rel
        out[f"{name}_reason"] = why if rel is None else None
        out[f"{name}_series"] = points
        out[f"{name}_line_window"] = window
    out["relative_window"] = {"start": store.iso[t - WINDOW_SESSIONS], "end": store.iso[t], "n": WINDOW_SESSIONS}
    out.update({"unit": "log_return", "date": store.iso[t], "freq": "daily", "source": SOURCE,
                "providers": provider_words(store.providers_of([BENCHMARK, *SECTOR_KEYS, "rsp", "iwm"]))})
    return out


# ── Correlations (§12.8) ────────────────────────────────────────────────────

CORR_WINDOW = 60


def daily_returns(store: Store, key: str):
    """Log returns on the calendar: r[i] = ln(P(i) / P(i−1)), NaN unless both closes are stored."""
    import numpy as np

    px = store.px[key]
    r = np.full(len(px), np.nan)
    with np.errstate(invalid="ignore", divide="ignore"):
        r[1:] = np.log(px[1:] / px[:-1])
    return r


def rolling_corr(x, y, w: int = CORR_WINDOW):
    """Pearson's r over each run of w return dates ending at i (NaN before w,
    with any pair incomplete, or with no variance)."""
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view

    out = np.full(len(x), np.nan)
    if len(x) < w:
        return out
    wx, wy = sliding_window_view(x, w), sliding_window_view(y, w)
    ok = np.isfinite(wx).all(axis=1) & np.isfinite(wy).all(axis=1)
    dx = wx - wx.mean(axis=1, keepdims=True)
    dy = wy - wy.mean(axis=1, keepdims=True)
    sxy, sxx, syy = (dx * dy).sum(axis=1), (dx * dx).sum(axis=1), (dy * dy).sum(axis=1)
    with np.errstate(invalid="ignore", divide="ignore"):
        r = sxy / np.sqrt(sxx * syy)
    r[~ok | (sxx == 0) | (syy == 0)] = np.nan
    out[w - 1:] = r
    return out


def both_close(store: Store, a: str, b: str) -> int | None:
    """The newest session on which both series hold a value."""
    import numpy as np

    both = np.flatnonzero(np.isfinite(store.px[a]) & np.isfinite(store.px[b]))
    return int(both[-1]) if len(both) else None


def _corr_at(corr, i: int) -> float | None:
    v = float(corr[i]) if 0 <= i < len(corr) else float("nan")
    return v if math.isfinite(v) else None


def incomplete(store: Store, t: int, w: int = CORR_WINDOW) -> str:
    return f"fewer than {w} complete daily return pairs in the window to {store.iso[t]}"


def why_no_corr(store: Store, x, y, t: int, w: int = CORR_WINDOW) -> str:
    """Why the correlation on session t is null: an incomplete window, or one
    of the two series without any variation in it."""
    import numpy as np

    lo = t - w + 1
    if lo < 0 or not (np.isfinite(x[lo:t + 1]).all() and np.isfinite(y[lo:t + 1]).all()):
        return incomplete(store, t, w)
    return f"no variation in one of the two series in the window to {store.iso[t]}"


def stock_bond_at(store: Store, rs, rt, t: int, w: int = CORR_WINDOW) -> dict:
    """SPY against TLT over w daily returns: today (session t), a year ago, the
    last change of sign and the one-year line (the stock_bond rules, at w)."""
    import numpy as np
    import pandas as pd

    corr = rolling_corr(rs, rt, w)
    today = _corr_at(corr, t)
    ago = int(store.sessions.searchsorted(store.sessions[t] - pd.DateOffset(months=12), side="right")) - 1
    year_ago = _corr_at(corr, ago) if ago >= 0 else None
    first = ago + 1
    series = [{"date": store.iso[i], "corr": _corr_at(corr, i)} for i in range(max(first, 0), t + 1)]
    flipped_on, flipped_to = None, None
    signs = [(i, 1 if corr[i] > 0 else -1) for i in np.flatnonzero(np.isfinite(corr[:t + 1])) if corr[i] != 0]
    for (_, prev), (i, now) in zip(signs, signs[1:]):
        if now != prev:
            flipped_on, flipped_to = store.iso[int(i)], ("positive" if now > 0 else "negative")
    return {
        "today": today, "today_date": store.iso[t], "today_reason": None if today is not None else why_no_corr(store, rs, rt, t, w),
        "year_ago": year_ago, "year_ago_date": store.iso[ago] if ago >= 0 else None,
        "flipped": flipped_on[:7] if flipped_on else None, "flipped_on": flipped_on, "flipped_to": flipped_to,
        "series": series,
        "window": {"start": store.iso[max(t - w + 1, 0)], "end": store.iso[t], "n": w},
        "line_window": {"start": series[0]["date"] if series else store.iso[t], "end": store.iso[t], "n": len(series)},
    }


def stock_bond(store: Store, views: bool = False) -> dict:
    """The /macro stock_bond block: SPY against TLT, today, a year ago, the
    last change of sign, and the one-year line, at 60 daily returns; with
    `views` (desk P1b) the same at 20, 60 and 120 under `by_horizon`."""
    missing = [k.upper() for k in (BENCHMARK, "tlt") if not store.has(k)]
    if missing:
        raise awaiting_refresh(missing)
    rs, rt = daily_returns(store, BENCHMARK), daily_returns(store, "tlt")
    t = both_close(store, BENCHMARK, "tlt")
    if t is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    return {
        **stock_bond_at(store, rs, rt, t),
        "stock": {"etf": "SPY", "name": "S&P 500 ETF"}, "bond": {"etf": "TLT", "name": "20+ year Treasury ETF"},
        "transform": "daily log return", "unit": "correlation", "date": store.iso[t], "freq": "daily", "source": SOURCE,
        "providers": provider_words(store.providers_of([BENCHMARK, "tlt"])),
        **({"horizons": list(HORIZONS),
            "by_horizon": {str(w): {**stock_bond_at(store, rs, rt, t, w), "horizon": w, "noise_band": noise_band(w)}
                           for w in HORIZONS}} if views else {}),
    }


# The assets the correlations list reads, in the list's order, and VIX when it is stored.
CORR_ASSETS: tuple[tuple[str, str], ...] = (
    ("tlt", "20+ year Treasuries"), ("ief", "7–10 year Treasuries"), ("hyg", "High-yield bonds"),
    ("lqd", "Investment-grade bonds"), ("gld", "Gold"), ("uup", "Dollar"), ("iwm", "Small caps"), ("qqq", "Nasdaq 100"),
)
VIX = ("vix", "VIX")


def corr_at(x, y, t: int, w: int = CORR_WINDOW) -> float | None:
    """Pearson's r of x and y over the w return dates ending at t; null unless every pair is complete."""
    import numpy as np

    if t - w + 1 < 0:
        return None
    a, b = x[t - w + 1:t + 1], y[t - w + 1:t + 1]
    if not (np.isfinite(a).all() and np.isfinite(b).all()):
        return None
    da, db = a - a.mean(), b - b.mean()
    sab, saa, sbb = float((da * db).sum()), float((da * da).sum()), float((db * db).sum())
    if saa == 0 or sbb == 0:
        return None
    r = sab / math.sqrt(saa * sbb)
    return r if math.isfinite(r) else None


def correlations(store: Store, views: bool = False) -> list[dict]:
    """The /macro correlations block: each asset against SPY, 60 daily returns
    to its own newest session with both values; a row the store cannot compute
    says why. VIX is listed only when the store holds it. With `views` (desk P1b),
    each row also carries `by_horizon` (20, 60 and 120 returns to the same
    session) and `by_regime` (CORRELATION_VIEWS.md §4), null when the row has
    no session to end on."""
    from src.desk import series as registry

    if not store.has(BENCHMARK):
        raise awaiting_refresh(["SPY"])
    spy = daily_returns(store, BENCHMARK)
    assets = [*CORR_ASSETS, *([VIX] if store.has(VIX[0]) else [])]
    rows = []
    for key, name in assets:
        spec = registry.get(key)
        row = {"asset": name, "symbol": spec.series_id,
               "quantity": "index level (^VIX)" if key == "vix" else "adjusted close",
               "transform": "daily log change" if key == "vix" else "daily log return",
               "corr": None, "date": None, "window": None, "reason": None,
               **({"by_horizon": None, "by_regime": None} if views else {})}
        if not store.has(key):
            row["reason"] = awaiting_refresh([spec.series_id]).reason
            rows.append(row)
            continue
        t = both_close(store, BENCHMARK, key)
        if t is None:
            row["reason"] = "no session on which both hold a value"
            rows.append(row)
            continue
        ra = daily_returns(store, key)
        r = corr_at(spy, ra, t)
        row.update({"corr": r, "date": store.iso[t],
                    "window": {"start": store.iso[max(t - CORR_WINDOW + 1, 0)], "end": store.iso[t], "n": CORR_WINDOW},
                    "reason": None if r is not None else why_no_corr(store, spy, ra, t)})
        if views:
            row["by_horizon"] = {str(w): pair_at(store, spy, ra, t, w) for w in HORIZONS}
            row["by_regime"] = by_regime(store, spy, ra, t)
        rows.append(row)
    if all(r["corr"] is None and r["reason"] and r["reason"].startswith("Awaiting refresh") for r in rows):
        raise awaiting_refresh([r["symbol"] for r in rows])
    return rows


# ── Correlation windows and correlation by regime (desk P1b) ───────────────
# docs/desk/CORRELATION_VIEWS.md is the method; each rule below names its section.

HORIZONS = (20, 60, 120)          # §3: about one month, one quarter and six months of sessions
NOISE_Z = 1.6448536269514722      # §3: the standard normal's 95th percentile, a two-sided 90% band
NOISE_RULE = "fisher-z-90-iid"
MIN_REGIME_RETURNS = 60           # §4: a regime needs the default window's count of returns
REGIME_HISTORY = "revised"
AS_KNOWN_REASON = ("As known at the time is not available yet: it needs the point-in-time regime history "
                   "(the approved point-in-time plan), which is not built.")


def noise_band(w: int) -> float:
    """§3: Fisher's approximation to how far from zero a sample correlation of
    w independent, identically distributed normal return pairs lands one time
    in ten when the true correlation is zero, tanh(z₀.₉₅ / √(w − 3)). An
    approximate reference under those assumptions (real returns can be more or
    less noisy), never an interval for a served value."""
    return math.tanh(NOISE_Z / math.sqrt(w - 3))


def pair_at(store: Store, x, y, t: int, w: int) -> dict:
    """§3: one pair's correlation over the w return dates ending at t, its window and its reason when null."""
    r = corr_at(x, y, t, w)
    return {"corr": r, "window": {"start": store.iso[max(t - w + 1, 0)], "end": store.iso[t], "n": w},
            "reason": None if r is not None else why_no_corr(store, x, y, t, w), "horizon": w, "noise_band": noise_band(w)}


def pearson(a, b) -> float | None:
    """Pearson's r of two complete, equal-length samples; null without variation (corr_at's formula)."""
    da, db = a - a.mean(), b - b.mean()
    sab, saa, sbb = float((da * db).sum()), float((da * da).sum()), float((db * db).sum())
    if saa == 0 or sbb == 0:
        return None
    r = sab / math.sqrt(saa * sbb)
    return r if math.isfinite(r) else None


def regime_rule() -> str:
    from src.desk import event_study as es

    return (f"A daily return dated in month K takes the regimes row stamped K−{es.REGIME_LAG_MONTHS} months, "
            f"the first month that row could govern (the event study's rule); returns without a row are Unlabeled "
            f"and left out.")


def by_regime(store: Store, x, y, t: int) -> dict:
    """§4: the pair's correlation pooled within each regime of the revised
    history, and over every labelled return, from the pair's first common
    return through session t. Each regime carries n, its first and last
    return, its spells (runs of consecutive months with the label holding a
    return used) and the share of n in the largest spell."""
    import numpy as np

    from src.desk import event_study as es

    out: dict[str, Any] = {"regime_history": REGIME_HISTORY, "rule": regime_rule(), "lag_months": es.REGIME_LAG_MONTHS,
                           "as_known": None, "as_known_reason": AS_KNOWN_REASON, "min_n": MIN_REGIME_RETURNS,
                           "current": None, "current_row": None, "sample": None, "unlabeled_n": None, "incomplete_n": None,
                           "regimes": [], "all": None, "reason": None}
    labels = store.labels()
    if labels is None:
        out["reason"] = "no regime history is stored in this database"
        return out
    both = np.isfinite(x[:t + 1]) & np.isfinite(y[:t + 1])
    idx = np.flatnonzero(both)
    if not len(idx):
        out["reason"] = f"no daily return both series hold through {store.iso[t]}"
        return out
    lo = int(idx[0])
    ok, lab = both[lo:t + 1], labels[lo:t + 1]
    xs, ys = x[lo:t + 1], y[lo:t + 1]
    labelled = lab != es.UNLABELED
    cur = labels[t]
    end = store.sessions[t]
    m = end.year * 12 + end.month - 1 - es.REGIME_LAG_MONTHS  # the month of the row governing session t
    gov = f"{m // 12:04d}-{m % 12 + 1:02d}"
    out.update({"current": None if cur == es.UNLABELED else str(cur), "current_row": None if cur == es.UNLABELED else gov,
                "sample": {"start": store.iso[lo], "end": store.iso[t]},
                "unlabeled_n": int((ok & ~labelled).sum()), "incomplete_n": int((~ok).sum())})
    # Spells: runs of consecutive calendar months with one label (a month without a row breaks a run).
    sess = store.sessions[lo:t + 1]
    mi = np.asarray(sess.year * 12 + sess.month - 1, dtype=int)
    span = np.arange(mi[0], mi[-1] + 1)
    mlab = [labels_of_month(store.regimes, int(m), es.REGIME_LAG_MONTHS) for m in span]
    run = np.zeros(len(span), dtype=int)
    for k in range(1, len(span)):
        run[k] = run[k - 1] + (0 if mlab[k] is not None and mlab[k] == mlab[k - 1] else 1)
    date_run = run[mi - mi[0]]

    def stat(sel, name: str) -> dict:
        n = int(sel.sum())
        row: dict[str, Any] = {"corr": None, "n": n, "first": None, "last": None, "reason": None}
        if n:
            used = np.flatnonzero(sel)
            row["first"], row["last"] = store.iso[lo + int(used[0])], store.iso[lo + int(used[-1])]
        if n < MIN_REGIME_RETURNS:
            row["reason"] = (f"only {n} daily {'return' if n == 1 else 'returns'} in {name}; "
                             f"a correlation needs {MIN_REGIME_RETURNS}")
            return row
        r = pearson(xs[sel], ys[sel])
        row["corr"] = r
        if r is None:
            row["reason"] = f"no variation in one of the two series in {name}"
        return row

    for name in es.REGIME_LABELS:
        sel = ok & (lab == name)
        row = {"regime": name, **stat(sel, name), "spells": 0, "largest_spell_share": None}
        if row["n"]:
            counts = np.bincount(date_run[sel])
            counts = counts[counts > 0]
            row["spells"] = int(len(counts))
            row["largest_spell_share"] = float(counts.max()) / row["n"]
        out["regimes"].append(row)
    out["all"] = stat(ok & labelled, "the labelled history")
    return out


def labels_of_month(months, m: int, lag: int) -> str | None:
    """The label governing calendar month m (year·12 + month − 1): the row stamped m − lag, else None."""
    import pandas as pd

    key = pd.Period(year=(m - lag) // 12, month=(m - lag) % 12 + 1, freq="M")
    v = months.get(key)
    return v if isinstance(v, str) else None


# ── The 12-asset matrix (§12.8 `matrix`, desk/matrix) ──────────────────────

MATRIX_ASSETS: tuple[tuple[str, str], ...] = (
    ("spy", "S&P 500"), ("qqq", "Nasdaq 100"), ("iwm", "Small caps"), ("smh", "Semiconductors"),
    ("xle", "Energy"), ("tlt", "20+ year Treasuries"), ("ief", "7–10 year Treasuries"),
    ("hyg", "High-yield bonds"), ("lqd", "Investment-grade bonds"), ("gld", "Gold"), ("uup", "Dollar"), ("vix", "VIX"),
)
LEAD_RULE = "matrix-lead-v1"


def common_close(store: Store, keys: list[str]) -> int | None:
    """The newest session on which every one of `keys` holds a value."""
    import numpy as np

    if not keys:
        return None
    ok = np.logical_and.reduce([np.isfinite(store.px[k]) for k in keys])
    idx = np.flatnonzero(ok)
    return int(idx[-1]) if len(idx) else None


def coverage(x, t: int, w: int = CORR_WINDOW) -> int:
    """How many of the w return dates ending at t hold a return of x
    (a return needs its session's close and the previous one's)."""
    import numpy as np

    return int(np.isfinite(x[max(t - w + 1, 0):t + 1]).sum())


def why_no_window(store: Store, key: str, x, t: int, w: int = CORR_WINDOW) -> str | None:
    """Why one asset has no w-date window to t, or None when it has one: the
    returns it holds of the w, and the first one missing (Codex R-02)."""
    import numpy as np

    lo = t - w + 1
    have = coverage(x, t, w)
    if have < w:
        if lo < 1:
            first = f"the stored calendar starts {store.iso[0]}"
        else:
            i = lo + int(np.flatnonzero(~np.isfinite(x[lo:t + 1]))[0])
            first = store.gap_reason(key, i) or store.gap_reason(key, i - 1)
        return f"only {have} of {w} daily returns in the window to {store.iso[t]}: {first}"
    w = x[lo:t + 1]
    if float(((w - w.mean()) ** 2).sum()) == 0:
        return f"no variation in the window to {store.iso[t]}"
    return None


def signed(x: float) -> str:
    """+0.44, −0.28, 0.00: the card's own format (MacroPage `corrText`)."""
    s = f"{abs(x):.2f}"
    return "0.00" if s == "0.00" else ("+" if x > 0 else "−") + s


def matrix_lead(symbols: list[str], values: list[list[float | None]]) -> dict:
    """matrix-lead-v1: whether Treasuries are hedging equities (SPY against TLT
    below zero: they are; at or above zero: they are not), then the highest and
    the lowest pair among the off-diagonal cells served. Null parts are left
    out; the sentence is null when no pair is served."""
    idx = {s: i for i, s in enumerate(symbols)}
    pairs = [(values[i][j], i, j) for i in range(len(symbols)) for j in range(i + 1, len(symbols)) if values[i][j] is not None]
    hedge = values[idx["SPY"]][idx["TLT"]]
    if not pairs:
        return {"text": None, "rule": LEAD_RULE, "hedging": None, "spy_tlt": None, "highest": None, "lowest": None}
    hi = max(pairs, key=lambda p: p[0])
    lo = min(pairs, key=lambda p: p[0])
    def pair(p):
        return {"a": symbols[p[1]], "b": symbols[p[2]], "corr": p[0]}

    if len(pairs) == 1:
        pairs_text = f"the one pair served is {symbols[hi[1]]} and {symbols[hi[2]]} at {signed(hi[0])}"
    else:
        pairs_text = (f"the highest pair is {symbols[hi[1]]} and {symbols[hi[2]]} at {signed(hi[0])}"
                      f" and the lowest {symbols[lo[1]]} and {symbols[lo[2]]} at {signed(lo[0])}")
    if hedge is None:
        text = pairs_text[0].upper() + pairs_text[1:] + "."
    else:
        text = f"Treasuries are {'hedging' if hedge < 0 else 'not hedging'} equities (SPY and TLT at {signed(hedge)}); {pairs_text}."
    return {"text": text, "rule": LEAD_RULE, "hedging": None if hedge is None else hedge < 0, "spy_tlt": hedge,
            "highest": pair(hi), "lowest": pair(lo)}


def no_valid_close(store: Store, key: str) -> str:
    """Why a stored series has no valid close: none of its rows survived
    alignment onto the XNYS calendar and validation (Codex R-03)."""
    n = store.rows.get(key, 0)
    return f"no valid close among its {n} stored {'row' if n == 1 else 'rows'} (each must be a finite, positive close on an XNYS session)"


def matrix_at(store: Store, keys: list[str], symbols: list[str], reasons: dict[str, str | None], rets: dict,
              t: int, w: int = CORR_WINDOW) -> dict:
    """The matrix over the w daily returns to session t: every pair of the
    assets with a complete window at w, the others "no data" with the reason
    (`reasons` holds the horizon-free ones: not stored, no valid close)."""
    why = {k: reasons[k] if k not in rets else why_no_window(store, k, rets[k], t, w) for k in keys}
    ok = [k for k in keys if why[k] is None]
    values: list[list[float | None]] = []
    for a in keys:
        row: list[float | None] = []
        for b in keys:
            row.append(corr_at(rets[a], rets[b], t, w) if a in ok and b in ok else None)
        values.append(row)
    # Codex R-02: the requested horizon apart from what was observed. `window.n` counts the return dates the
    # calendar holds in the window (fewer than the horizon when it starts inside it), `coverage` the returns each
    # asset holds there; a pair is served only when both assets hold all `horizon` of them.
    first = max(t - w + 1, 1)
    observed = t - first + 1 if t >= 1 else 0
    return {
        "no_data": [{"symbol": sym, "reason": why[k]} for k, sym in zip(keys, symbols) if why[k] is not None],
        "values": values,
        "window": {"start": store.iso[first] if observed else store.iso[t], "end": store.iso[t], "n": observed},
        "coverage": [coverage(rets[k], t, w) if k in rets else None for k in keys],
        "lead": matrix_lead(symbols, values),
    }


def matrix(store: Store, views: bool = False) -> dict:
    """The /macro matrix block: every pair of the twelve assets over the 60
    daily returns to the newest session every asset with a valid close
    closes on; with `views` (desk P1b) the same at 20, 60 and 120 returns to
    that session under `by_horizon`."""
    from src.desk import series as registry

    keys = [k for k, _ in MATRIX_ASSETS]
    symbols = [registry.get(k).series_id for k in keys]
    stored = [k for k in keys if store.has(k)]
    if not stored:
        raise awaiting_refresh(symbols)
    # Codex R-03: a stored asset without one valid close takes no part in choosing the end session (it would
    # leave no session every asset closes on); its row and column are null with the reason, the rest computed.
    valid = [k for k in stored if store.newest(k) is not None]
    if not valid:
        raise env.Awaiting("Awaiting refresh: none of the twelve assets has a valid close in this database.")
    t = common_close(store, valid)
    if t is None:
        raise env.Awaiting(env.BLOCK_FAILED_REASON)
    rets = {k: daily_returns(store, k) for k in valid}
    reasons: dict[str, str | None] = {}
    for k, sym in zip(keys, symbols):
        if k in rets:
            reasons[k] = None  # judged per horizon (matrix_at)
        elif k in stored:
            reasons[k] = no_valid_close(store, k)
        else:
            reasons[k] = awaiting_refresh([sym]).reason
    at = matrix_at(store, keys, symbols, reasons, rets, t)
    return {
        "assets": symbols, "labels": [name for _, name in MATRIX_ASSETS],
        "no_data": at["no_data"],
        "values": at["values"],
        "horizon": CORR_WINDOW,
        "window": at["window"],
        "coverage": at["coverage"],
        "lead": at["lead"],
        "quantity": "adjusted close (^VIX: index level)", "transform": "daily log return (^VIX: daily log change)",
        "unit": "correlation", "date": store.iso[t], "freq": "daily", "source": SOURCE,
        "providers": provider_words(store.providers_of(valid)),
        **({"horizons": list(HORIZONS),
            "by_horizon": {str(w): {**matrix_at(store, keys, symbols, reasons, rets, t, w), "horizon": w,
                                    "noise_band": noise_band(w)} for w in HORIZONS}} if views else {}),
    }


# ── The item ────────────────────────────────────────────────────────────────

SECTOR_KEYS = ("xlb", "xlc", "xle", "xlf", "xli", "xlk", "xlp", "xlre", "xlu", "xlv", "xly")


def _regimes(conn: Any):
    """The stored regime rows (event_study.load_regimes), or None when the database has no regimes table."""
    import sqlite3

    from src.desk import event_study as es

    try:
        return es.load_regimes(conn)
    except sqlite3.OperationalError:
        return None


def desk_etf(ctx: dict) -> dict:
    """The desk_etf item: each block as a part, read on one connection."""
    from api.desk_items_macro import _connect, part
    from src.desk import event_study as es

    cutoff = es.resolve_as_of(None, es.DB_PATH)
    conn = _connect()
    try:
        store = Store(conn, [BENCHMARK, *SECTOR_KEYS, "rsp", "iwm", *(k for k, _ in CORR_ASSETS), VIX[0], "smh"], cutoff)
        store.regimes = _regimes(conn)
    finally:
        conn.close()
    return {"sectors": part("sectors", lambda: leadership(store)), "breadth": part("breadth", lambda: breadth(store)),
            "stock_bond": part("stock_bond", lambda: stock_bond(store)),
            "correlations": part("correlations", lambda: correlations(store)),
            "matrix": part("matrix", lambda: matrix(store))}
